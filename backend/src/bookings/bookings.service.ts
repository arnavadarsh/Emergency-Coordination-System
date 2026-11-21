import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from './entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { TriageReport, EmergencyType } from '../triage/entities/triage.entity';
import { User } from '../users/entities/user.entity';
import { BookingStatus, SeverityLevel, AmbulanceStatus } from '../common/enums';
import { FindBookingsDto } from './dto/find-bookings.dto';
import { CreateEmergencyBookingDto } from './dto/create-emergency-booking.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TriageService } from '../triage/triage.service';
import { HospitalRankingService } from '../hospitals/hospital-ranking.service';
import { DriverIdentityService } from '../users/driver-identity.service';
import { MedicalProfileService } from '../users/medical-profile.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingNotifierService } from '../tracking/tracking-notifier.service';
import { TravelTimeService } from '../common/travel-time/travel-time.service';
import { CaseAccessService } from '../access/case-access.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { canonicalDispatchStatus } from '../dispatch/dispatch-status';
import { haversineKm } from '../common/geo';

/**
 * How long before its requested time a scheduled booking is given an
 * ambulance — long enough for the unit to drive there, short enough not to
 * hold a unit idle that an emergency could use.
 */
export const SCHEDULED_DISPATCH_LEAD_MINUTES = 20;

/**
 * Bookings Service
 * Booking management with CRUD operations and auto-dispatch
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(Dispatch)
    private dispatchRepository: Repository<Dispatch>,
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
    @InjectRepository(Hospital)
    private hospitalRepository: Repository<Hospital>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly triageService: TriageService,
    private readonly hospitalRankingService: HospitalRankingService,
    private readonly driverIdentityService: DriverIdentityService,
    private readonly medicalProfileService: MedicalProfileService,
    private readonly trackingService: TrackingService,
    private readonly trackingNotifier: TrackingNotifierService,
    private readonly travelTime: TravelTimeService,
    private readonly caseAccess: CaseAccessService,
    private readonly settings: SystemSettingsService,
  ) {}

  private isHospitalAccepting(status?: string): boolean {
    const normalized = (status || '').toUpperCase();
    return normalized === 'ACTIVE' || normalized === 'ACCEPTING';
  }

  async createEmergencyBooking(userId: string, createBookingDto: CreateEmergencyBookingDto): Promise<{ bookingId: string; status: BookingStatus }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { location, emergencyType, answers } = createBookingDto;

      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // ── Derive severity from triage answers ──────────────────────────────
      // Build an answers map compatible with TriageService.assessEmergency()
      const triageAnswers: Record<string, string> = {
        emergency_type: emergencyType || '',
        breathing: String(answers.breathing) === 'true' ? 'Yes' : 'No',
        bleeding:  String(answers.bleeding) === 'true' ? 'Yes' : 'No',
        conscious: String(answers.conscious) === 'true' ? 'Yes' : 'No',
        pain_level: String(answers.painLevel ?? 0),
        pregnant_check: answers.pregnancy ? 'Yes' : 'No',
      };

      let derivedSeverity: SeverityLevel = SeverityLevel.MEDIUM;
      const derivedEmergencyType: EmergencyType = emergencyType as EmergencyType;
      try {
        const assessment = await this.triageService.assessEmergency(triageAnswers);
        // Map TriageService severity string → SeverityLevel enum
        const severityMap: Record<string, SeverityLevel> = {
          CRITICAL: SeverityLevel.CRITICAL,
          HIGH:     SeverityLevel.HIGH,
          MODERATE: SeverityLevel.MEDIUM,
          MEDIUM:   SeverityLevel.MEDIUM,
          LOW:      SeverityLevel.LOW,
        };
        derivedSeverity = severityMap[assessment.severity.toUpperCase()] ?? SeverityLevel.MEDIUM;
        this.logger.log(`[createEmergencyBooking] Derived severity=${derivedSeverity} from triage answers`);
      } catch (triageErr) {
        this.logger.warn(`[createEmergencyBooking] TriageService.assessEmergency failed, using MEDIUM: ${triageErr.message}`);
      }

      // ── Build and save TriageReport ──────────────────────────────────────
      const triageReport = new TriageReport();
      triageReport.emergencyType = derivedEmergencyType;
      triageReport.breathing = String(answers.breathing) === 'true';
      triageReport.bleeding  = String(answers.bleeding) === 'true';
      triageReport.conscious = String(answers.conscious) === 'true';
      triageReport.painLevel = answers.painLevel ?? 0;
      triageReport.pregnancy = answers.pregnancy || false;

      const savedTriageReport = await queryRunner.manager.save(triageReport);

      // ── Build and save Booking ───────────────────────────────────────────
      const booking = new Booking();
      booking.userId           = userId;
      booking.pickupLatitude   = location.lat;
      booking.pickupLongitude  = location.lng;
      // Set explicitly: the deployed schema declares booking_type NOT NULL with
      // no database default, so relying on the entity's `default:` (which only
      // applies when TypeORM generates the schema) inserted NULL and failed.
      booking.bookingType      = 'EMERGENCY';
      booking.status           = BookingStatus.PENDING;
      booking.severity         = derivedSeverity;     // ← was missing before
      booking.triageReport     = savedTriageReport;

      const savedBooking = await queryRunner.manager.save(booking);

      await queryRunner.commitTransaction();

      this.logger.log(`New emergency booking created: ${savedBooking.id} severity=${derivedSeverity}`);
      // Admin consoles only, and only what a queue row needs — this used to go
      // to every connected socket with the whole entity attached.
      this.realtimeGateway.emitToAdmins('booking_created', {
        id: savedBooking.id,
        status: savedBooking.status,
        severity: savedBooking.severity,
        createdAt: savedBooking.createdAt,
      });
      this.eventEmitter.emit('booking.created', savedBooking.id);

      // Pass the in-memory triageReport so tryDispatch doesn't need a DB re-fetch
      if (this.settings.get('autoDispatchEnabled')) {
        this.tryDispatch(savedBooking, savedTriageReport).catch(err =>
          this.logger.error(`[autoDispatch] Failed for emergency booking ${savedBooking.id}`, err.stack),
        );
      } else {
        this.logger.warn(`[autoDispatch] Auto-dispatch is off — booking ${savedBooking.id} waits for an admin`);
      }

      return {
        bookingId: savedBooking.id,
        status: savedBooking.status,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to create emergency booking', error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Find all bookings, each carrying the patient's identity and Medical Profile.
   *
   * Feeds the admin booking list and its exported report, which is why the
   * Medical Profile rides along: the profile is resolved from the patient row at
   * read time, so an exported report always reflects the latest saved values.
   */
  async findAll(findBookingsDto: FindBookingsDto): Promise<any[]> {
    const bookings = await this.bookingRepository.find({
      where: findBookingsDto,
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });

    return bookings.map(booking => ({
      ...booking,
      patientName: this.patientDisplayName(booking.user),
      patientEmail: booking.user?.email ?? null,
      patientPhone: booking.user?.phoneNumber ?? null,
      medicalProfile: this.medicalProfileService.fromUser(booking.user),
    }));
  }

  /** Patient's display name, falling back to the email local part. */
  private patientDisplayName(patient?: User | null): string {
    if (!patient) return 'Patient';
    const fullName = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim();
    return fullName || patient.email?.split('@')[0] || 'Patient';
  }

  /**
   * Full ECS case report for one booking.
   *
   * Combines, in one record: the patient, their Medical Profile, the emergency,
   * the triage assessment and the dispatch/treatment timeline. The Medical
   * Profile is supporting patient information presented alongside the triage
   * data — it does not alter how the case was triaged.
   *
   * The profile is read live from the patient's row, so a report generated after
   * a profile edit shows the updated information.
   */
  async buildCaseReport(id: string): Promise<any> {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: ['user', 'triageReport'],
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const dispatch = await this.dispatchRepository.findOne({
      where: { bookingId: id },
      relations: ['ambulance', 'hospital'],
      order: { createdAt: 'DESC' },
    });

    const driver = dispatch
      ? await this.driverIdentityService.resolveOne({
          driverId: dispatch.driverId,
          ambulanceId: dispatch.ambulanceId,
          vehicleNumber: dispatch.ambulance?.vehicleNumber ?? null,
        })
      : null;

    const medicalProfile = this.medicalProfileService.fromUser(booking.user);
    const triage = booking.triageReport ?? null;

    return {
      reportId: `ECS-${booking.id.slice(0, 8).toUpperCase()}`,
      generatedAt: new Date().toISOString(),

      patient: {
        id: booking.userId,
        name: this.patientDisplayName(booking.user),
        email: booking.user?.email ?? null,
        phoneNumber: booking.user?.phoneNumber ?? null,
        dateOfBirth: booking.user?.dateOfBirth ?? null,
        address: booking.user?.address ?? null,
        emergencyContact: booking.user?.emergencyContact ?? null,
      },

      // Supporting patient information — the standing clinical background.
      medicalProfile,

      emergency: {
        bookingId: booking.id,
        status: booking.status,
        bookingType: booking.bookingType,
        severity: booking.severity,
        description: booking.description ?? null,
        pickupAddress: booking.pickupAddress ?? null,
        pickupLatitude: booking.pickupLatitude ?? null,
        pickupLongitude: booking.pickupLongitude ?? null,
        destinationAddress: booking.destinationAddress ?? null,
        createdAt: booking.createdAt ?? null,
        completedAt: booking.completedAt ?? null,
        cancelledAt: booking.cancelledAt ?? null,
      },

      triage: triage ? {
        emergencyType: triage.emergencyType,
        breathing: triage.breathing,
        bleeding: triage.bleeding,
        conscious: triage.conscious,
        painLevel: triage.painLevel,
        pregnancy: triage.pregnancy,
      } : null,

      treatment: dispatch ? {
        dispatchId: dispatch.id,
        status: dispatch.status,
        ambulanceVehicleNumber: dispatch.ambulance?.vehicleNumber ?? null,
        ambulanceType: dispatch.ambulance?.vehicleType ?? null,
        driver,
        hospitalName: dispatch.hospital?.name ?? booking.destinationAddress ?? null,
        hospitalAddress: dispatch.hospital?.address ?? null,
        dispatchedAt: dispatch.dispatchedAt ?? null,
        arrivedAtPickup: dispatch.arrivedAtPickup ?? null,
        departedPickup: dispatch.departedPickup ?? null,
        arrivedAtHospital: dispatch.arrivedAtHospital ?? null,
        completedAt: dispatch.completedAt ?? null,
        estimatedPickupTimeMinutes: dispatch.estimatedPickupTime ?? null,
        actualDistanceKm: dispatch.actualDistanceKm ?? null,
        notes: dispatch.notes ?? null,
      } : null,
    };
  }

  /**
   * Find booking by ID
   */
  async findById(id: string): Promise<Booking | null> {
    return this.bookingRepository.findOne({
      where: { id },
      relations: ['user'],
    });
  }

  /**
   * What GET /bookings/:id returns: the booking, its dispatch summary, and of
   * the patient only who they are. Contact details and clinical background stay
   * behind the case report.
   */
  toBookingView(booking: Booking, dispatch: Dispatch | null) {
    return {
      id: booking.id,
      status: booking.status,
      bookingType: booking.bookingType,
      severity: booking.severity,
      description: booking.description ?? null,
      pickupAddress: booking.pickupAddress ?? null,
      pickupLatitude: booking.pickupLatitude,
      pickupLongitude: booking.pickupLongitude,
      destinationAddress: booking.destinationAddress ?? null,
      destinationLatitude: booking.destinationLatitude ?? null,
      destinationLongitude: booking.destinationLongitude ?? null,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      completedAt: booking.completedAt ?? null,
      cancelledAt: booking.cancelledAt ?? null,
      patient: {
        id: booking.userId,
        name: this.patientDisplayName(booking.user),
      },
      dispatch: dispatch ? {
        id: dispatch.id,
        status: dispatch.status,
        ambulanceId: dispatch.ambulanceId,
        hospitalId: dispatch.hospitalId ?? null,
        dispatchedAt: dispatch.dispatchedAt ?? null,
        estimatedPickupTime: dispatch.estimatedPickupTime ?? null,
      } : null,
    };
  }

  /**
   * Find bookings by user
   */
  async findByUser(userId: string): Promise<Booking[]> {
    return this.bookingRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Create a new booking and auto-dispatch nearest ambulance
   */
  async create(userId: string, data: {
    pickupLatitude: number;
    pickupLongitude: number;
    pickupAddress: string;
    destinationLatitude?: number;
    destinationLongitude?: number;
    destinationAddress?: string;
    severity?: SeverityLevel;
    description?: string;
    bookingType?: string;
    scheduledTime?: Date | null;
    triage?: Pick<TriageReport, 'emergencyType' | 'breathing' | 'bleeding' | 'conscious' | 'painLevel' | 'pregnancy'>;
  }): Promise<Booking> {
    // Saved first so the booking can point at it. A triage report that fails
    // to save must not stop an ambulance being sent.
    let triageReport: TriageReport | null = null;
    if (data.triage) {
      try {
        triageReport = await this.dataSource.getRepository(TriageReport).save(
          Object.assign(new TriageReport(), data.triage),
        );
      } catch (error: any) {
        this.logger.warn(`[create] Could not save the triage report, booking continues without it: ${error?.message ?? error}`);
      }
    }

    const booking = this.bookingRepository.create({
      userId,
      pickupLatitude: data.pickupLatitude,
      pickupLongitude: data.pickupLongitude,
      pickupAddress: data.pickupAddress,
      destinationLatitude: data.destinationLatitude,
      destinationLongitude: data.destinationLongitude,
      destinationAddress: data.destinationAddress,
      severity: data.severity || SeverityLevel.MEDIUM,
      description: data.description,
      status: BookingStatus.CREATED,
      bookingType: data.bookingType || 'EMERGENCY',
      scheduledTime: data.scheduledTime ?? null,
      ...(triageReport ? { triageReport } : {}),
    });
    const savedBooking = await this.bookingRepository.save(booking);
    this.realtimeGateway.emitToAdmins('booking_created', {
      id: savedBooking.id,
      status: savedBooking.status,
      severity: savedBooking.severity,
      createdAt: savedBooking.createdAt,
    });

    // Auto-dispatch: Find nearest available ambulance. With auto-dispatch
    // switched off by an admin, the booking waits in the admin queue instead.
    // A scheduled transport still some way off waits for the retry worker,
    // which dispatches it shortly before it is due — sending a unit now would
    // take it away from emergencies for no reason.
    const dueAt = savedBooking.scheduledTime ? new Date(savedBooking.scheduledTime).getTime() : 0;
    const notDueYet = dueAt - Date.now() > SCHEDULED_DISPATCH_LEAD_MINUTES * 60_000;
    if (this.settings.get('autoDispatchEnabled') && !notDueYet) {
      await this.tryDispatch(savedBooking, triageReport);
    }

    return savedBooking;
  }

  /**
   * Bookings still waiting for an ambulance: open, never dispatched, and recent
   * enough that sending one now still makes sense. Oldest first; the retry
   * worker re-orders by severity.
   *
   * A scheduled booking counts from its requested time, not from when it was
   * made: it is not waiting until it is nearly due, and it must not be dropped
   * as "too old" for having been booked days ahead.
   */
  async findWaitingForAmbulance(maxAgeMinutes: number, limit: number): Promise<Booking[]> {
    const since = new Date(Date.now() - maxAgeMinutes * 60_000);
    return this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoin(Dispatch, 'dispatch', 'dispatch.bookingId = booking.id')
      .leftJoinAndSelect('booking.triageReport', 'triage')
      .where('booking.status IN (:...statuses)', { statuses: [BookingStatus.PENDING, BookingStatus.CREATED] })
      .andWhere(new Brackets(due => {
        due
          .where('booking.scheduledTime IS NULL AND booking.createdAt >= :since')
          .orWhere('booking.scheduledTime IS NOT NULL AND booking.scheduledTime <= :dueBy AND booking.scheduledTime >= :since');
      }))
      .setParameters({ since, dueBy: new Date(Date.now() + SCHEDULED_DISPATCH_LEAD_MINUTES * 60_000) })
      .andWhere('dispatch.id IS NULL')
      .orderBy('booking.createdAt', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Take an AVAILABLE ambulance for this booking, atomically. The status check
   * is part of the UPDATE, so when two bookings race for the same unit exactly
   * one of them gets it — reading the status and then writing it would let
   * both through.
   */
  private async claimAmbulance(ambulanceId: string): Promise<boolean> {
    const result = await this.ambulanceRepository
      .createQueryBuilder()
      .update(Ambulance)
      .set({ status: AmbulanceStatus.BUSY })
      .where('id = :id AND status = :available', { id: ambulanceId, available: AmbulanceStatus.AVAILABLE })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private async releaseAmbulance(ambulanceId: string): Promise<void> {
    await this.ambulanceRepository
      .createQueryBuilder()
      .update(Ambulance)
      .set({ status: AmbulanceStatus.AVAILABLE })
      .where('id = :id AND status = :busy', { id: ambulanceId, busy: AmbulanceStatus.BUSY })
      .execute();
  }

  /**
   * Dispatch the nearest available ambulance to a booking.
   *
   * Returns false when nothing could be sent — no ambulance free, or the booking
   * is no longer waiting — and leaves the booking open, so the retry worker
   * (DispatchRetryService) picks it up the moment a unit frees.
   */
  async tryDispatch(booking: Booking, preloadedTriage?: TriageReport | null): Promise<boolean> {
    this.logger.log(`[autoDispatch] START bookingId=${booking.id} pickup=(${booking.pickupLatitude},${booking.pickupLongitude}) preloadedTriage=${preloadedTriage ? 'YES' : 'NO'}`);

    const availableAmbulances = await this.ambulanceRepository.find({
      where: { status: AmbulanceStatus.AVAILABLE },
    });
    this.logger.log(`[autoDispatch] Available ambulances: ${availableAmbulances.length}`);

    if (availableAmbulances.length === 0) {
      this.logger.warn(`[autoDispatch] No available ambulances — booking ${booking.id} waits for the retry worker`);
      return false;
    }

    // Nearest first by straight-line distance. A unit that has never reported
    // a position goes last rather than counting as zero distance away.
    const candidates = availableAmbulances
      .map(ambulance => ({
        ambulance,
        distance: ambulance.currentLatitude != null && ambulance.currentLongitude != null
          ? haversineKm(
              Number(booking.pickupLatitude),
              Number(booking.pickupLongitude),
              Number(ambulance.currentLatitude),
              Number(ambulance.currentLongitude),
            )
          : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.distance - b.distance);

    let nearestAmbulance: Ambulance | null = null;
    let minDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (await this.claimAmbulance(candidate.ambulance.id)) {
        nearestAmbulance = candidate.ambulance;
        nearestAmbulance.status = AmbulanceStatus.BUSY;
        minDistance = candidate.distance;
        break;
      }
    }

    if (!nearestAmbulance) {
      this.logger.warn(`[autoDispatch] Every available ambulance was taken by another booking — ${booking.id} waits`);
      return false;
    }
    this.logger.log(`[autoDispatch] Nearest ambulance: ${nearestAmbulance.vehicleNumber} (${nearestAmbulance.id}), distance=${Number.isFinite(minDistance) ? minDistance.toFixed(2) : '?'}km`);

    try {
      return await this.completeDispatch(booking, nearestAmbulance, preloadedTriage);
    } catch (error) {
      // Nothing was assigned, so the unit must go back into the pool.
      await this.releaseAmbulance(nearestAmbulance.id);
      throw error;
    }
  }

  private async completeDispatch(
    booking: Booking,
    nearestAmbulance: Ambulance,
    preloadedTriage?: TriageReport | null,
  ): Promise<boolean> {
    // The booking may have been cancelled, or dispatched by a concurrent retry,
    // since it was read.
    const current = await this.bookingRepository.findOne({ where: { id: booking.id } });
    const alreadyDispatched = (await this.dispatchRepository.count({ where: { bookingId: booking.id } })) > 0;
    if (!current || ![BookingStatus.PENDING, BookingStatus.CREATED].includes(current.status) || alreadyDispatched) {
      this.logger.log(`[autoDispatch] Booking ${booking.id} no longer needs an ambulance — releasing ${nearestAmbulance.vehicleNumber}`);
      await this.releaseAmbulance(nearestAmbulance.id);
      return false;
    }

    // Load all hospitals with capabilities in a single query (avoids N+1 for ICU/load scoring)
    const hospitals = await this.hospitalRepository.find({
      relations: ['capabilities'],
    });
    this.logger.log(`[autoDispatch] Total hospitals in DB: ${hospitals.length}`);

    const eligibleHospitals = hospitals.filter(hospital =>
      this.isHospitalAccepting(hospital.status as any) &&
      (hospital.availableBeds ?? 0) > 0
    );
    this.logger.log(`[autoDispatch] Eligible hospitals for assignment: ${eligibleHospitals.length}`);

    // Derive emergency type from triage (available without an extra DB call)
    const emergencyTypeForRanking =
      preloadedTriage?.emergencyType ?? booking.triageReport?.emergencyType ?? null;

    // Rank hospitals on driving time and suitability, from both real positions:
    // the patient's (where the transport leg starts) and the assigned
    // ambulance's (which decides whether a hospital is ahead of it or behind).
    const ranking = await this.hospitalRankingService.selectBest(eligibleHospitals, {
      pickupLatitude: booking.pickupLatitude,
      pickupLongitude: booking.pickupLongitude,
      ambulanceLatitude: nearestAmbulance.currentLatitude,
      ambulanceLongitude: nearestAmbulance.currentLongitude,
      patientOnBoard: false,
      severity: booking.severity ?? undefined,
      emergencyType: emergencyTypeForRanking,
    });

    const selectedHospital: Hospital | null = ranking?.best ?? null;

    if (selectedHospital) {
      this.logger.log(
        `[autoDispatch] Selected hospital: "${selectedHospital.name}" (${selectedHospital.id}) — ` +
        `${ranking?.rankedList[0]?.reason ?? 'no reasoning available'}`,
      );
      booking.destinationLatitude = Number(selectedHospital.latitude);
      booking.destinationLongitude = Number(selectedHospital.longitude);
      booking.destinationAddress = selectedHospital.name;
    } else {
      this.logger.warn(`[autoDispatch] No hospitals in DB — proceeding without hospital assignment`);
    }

    // Time for the ambulance to reach the patient, from where it actually is —
    // live traffic when a routing key is configured, a distance estimate
    // otherwise. This is the ETA the patient and their family are shown.
    const pickupEta = await this.travelTime.estimateOne(
      {
        latitude: Number(nearestAmbulance.currentLatitude ?? booking.pickupLatitude),
        longitude: Number(nearestAmbulance.currentLongitude ?? booking.pickupLongitude),
      },
      { latitude: Number(booking.pickupLatitude), longitude: Number(booking.pickupLongitude) },
    );

    // Create dispatch
    const dispatch = this.dispatchRepository.create({
      bookingId: booking.id,
      ambulanceId: nearestAmbulance.id,
      hospitalId: selectedHospital?.id,
      status: 'DISPATCHED',
      dispatchedAt: new Date(),
      estimatedPickupTime: pickupEta.minutes,
      // Transport leg to the selected hospital, from the same ranking pass.
      estimatedHospitalTime: ranking?.bestEtaMinutes,
    });
    await this.dispatchRepository.save(dispatch);
    this.logger.log(`[autoDispatch] Dispatch saved: ${dispatch.id}`);

    // The ambulance was already marked BUSY when it was claimed.

    // Update booking status
    booking.status = BookingStatus.ASSIGNED;
    await this.bookingRepository.save(booking);

    // An ambulance is now assigned, which is the moment this case becomes
    // followable: mint the private tracking link and text it to the patient's
    // emergency contacts.
    await this.openTrackingForCase(booking, dispatch);

    // Tell the people on this case — the patient, the ambulance's driver, the
    // receiving hospital — and admins. The tracking link is still deliberately
    // NOT in this payload; the patient fetches it from the authenticated share
    // endpoint.
    this.realtimeGateway.emitToCase(
      { patientId: booking.userId, ambulanceId: nearestAmbulance.id, hospitalIds: [selectedHospital?.id] },
      'dispatch_assigned',
      {
        dispatchId: dispatch.id,
        bookingId: booking.id,
        ambulanceId: nearestAmbulance.id,
        hospitalId: selectedHospital?.id,
        hospitalName: selectedHospital?.name,
        status: dispatch.status,
        assignedAt: dispatch.dispatchedAt,
      },
    );

    // Pre-arrival alert: notify the specific hospital room
    if (selectedHospital) {
      await this.sendPreArrivalAlert(selectedHospital.id, booking, dispatch, nearestAmbulance, preloadedTriage);
    }

    this.logger.log(`[autoDispatch] DONE — ambulance ${nearestAmbulance.vehicleNumber} → booking ${booking.id}`);
    return true;
  }

  /**
   * Tell a hospital an ambulance is bringing it this patient: the unit, who is
   * driving, the triage answers and the patient's Medical Profile. Sent on
   * dispatch, and again whenever an admin changes the ambulance or the
   * destination.
   */
  async sendPreArrivalAlert(
    hospitalId: string,
    booking: Booking,
    dispatch: Dispatch,
    ambulance: Ambulance,
    preloadedTriage?: TriageReport | null,
  ): Promise<void> {
    // Use preloaded triage if available; fall back to a DB fetch
    let triage: TriageReport | null = preloadedTriage ?? null;
    if (!triage) {
      const bookingWithTriage = await this.bookingRepository.findOne({
        where: { id: booking.id },
        relations: ['triageReport'],
      });
      triage = bookingWithTriage?.triageReport ?? null;
    }
    this.logger.log(`[autoDispatch] Emitting pre_arrival_alert to room hospital:${hospitalId} severity=${booking.severity}`);

    // Identify the driver so the receiving hospital knows who is bringing the patient in.
    const driver = await this.driverIdentityService.resolveOne({
      driverId: dispatch.driverId,
      ambulanceId: ambulance.id,
      vehicleNumber: ambulance.vehicleNumber,
    });

    // Pull the patient's Medical Profile fresh at alert time so the hospital
    // receives the most recently saved information. Fields the patient never
    // supplied arrive as null and render as "Not Provided" — the alert never
    // carries a guessed blood group, allergy or medication.
    const medicalProfile = await this.medicalProfileService.resolveOne(booking.userId);

    this.realtimeGateway.emitToHospital(hospitalId, 'pre_arrival_alert', {
      dispatchId: dispatch.id,
      bookingId: booking.id,
      ambulanceId: ambulance.id,
      ambulanceVehicleNumber: ambulance.vehicleNumber,
      driver,
      ambulanceLocation: {
        latitude: ambulance.currentLatitude ?? null,
        longitude: ambulance.currentLongitude ?? null,
      },
      patientSeverity: booking.severity || SeverityLevel.MEDIUM,
      emergencyType: triage?.emergencyType ?? null,
      triage: triage ? {
        breathing: triage.breathing,
        bleeding: triage.bleeding,
        conscious: triage.conscious,
        painLevel: triage.painLevel,
        pregnancy: triage.pregnancy,
      } : null,
      medicalProfile,
      etaMinutes: dispatch.estimatedPickupTime ?? null,
      status: dispatch.status,
      alertedAt: new Date().toISOString(),
    });
  }

  // ── Admin overrides ───────────────────────────────────────────────────────

  /**
   * Admin dispatch of a waiting booking: to the given ambulance, or to the
   * nearest free one. Works whether auto-dispatch is on or off, and for
   * bookings the retry worker has given up on.
   */
  async dispatchManually(bookingId: string, ambulanceId?: string): Promise<Dispatch> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId }, relations: ['triageReport'] });
    if (!booking) throw new NotFoundException('Booking not found');
    if (![BookingStatus.PENDING, BookingStatus.CREATED].includes(booking.status)) {
      throw new ConflictException(`This booking is ${booking.status.toLowerCase()}, not waiting for an ambulance.`);
    }
    if ((await this.dispatchRepository.count({ where: { bookingId } })) > 0) {
      throw new ConflictException('This booking already has an ambulance.');
    }

    let assigned = false;
    if (ambulanceId) {
      const ambulance = await this.ambulanceRepository.findOne({ where: { id: ambulanceId } });
      if (!ambulance) throw new NotFoundException('Ambulance not found');
      if (!(await this.claimAmbulance(ambulance.id))) {
        throw new ConflictException(`${ambulance.vehicleNumber} is ${String(ambulance.status).toLowerCase()}, not available.`);
      }
      ambulance.status = AmbulanceStatus.BUSY;
      try {
        assigned = await this.completeDispatch(booking, ambulance, booking.triageReport ?? null);
      } catch (error) {
        await this.releaseAmbulance(ambulance.id);
        throw error;
      }
    } else {
      assigned = await this.tryDispatch(booking, booking.triageReport ?? null);
    }

    const dispatch = assigned ? await this.dispatchRepository.findOne({ where: { bookingId } }) : null;
    if (!dispatch) throw new ConflictException('No ambulance is available right now.');
    return dispatch;
  }

  /**
   * Put a different ambulance on a trip that has not picked the patient up
   * yet. The old unit goes back into the pool and its driver's screen clears;
   * the new unit starts the trip from the beginning.
   */
  async reassignAmbulance(dispatchId: string, ambulanceId: string): Promise<Dispatch> {
    const dispatch = await this.dispatchRepository.findOne({ where: { id: dispatchId }, relations: ['booking', 'ambulance'] });
    if (!dispatch?.booking) throw new NotFoundException('Dispatch not found');
    if (!['DISPATCHED', 'EN_ROUTE_PICKUP'].includes(canonicalDispatchStatus(dispatch.status))) {
      throw new ConflictException('The ambulance can only be changed before the patient is picked up.');
    }
    if (dispatch.ambulanceId === ambulanceId) return dispatch;

    const next = await this.ambulanceRepository.findOne({ where: { id: ambulanceId } });
    if (!next) throw new NotFoundException('Ambulance not found');
    if (!(await this.claimAmbulance(next.id))) {
      throw new ConflictException(`${next.vehicleNumber} is ${String(next.status).toLowerCase()}, not available.`);
    }
    next.status = AmbulanceStatus.BUSY;

    const previousAmbulanceId = dispatch.ambulanceId;
    const previousDriverId = dispatch.driverId;
    const pickupEta = await this.travelTime.estimateOne(
      {
        latitude: Number(next.currentLatitude ?? dispatch.booking.pickupLatitude),
        longitude: Number(next.currentLongitude ?? dispatch.booking.pickupLongitude),
      },
      { latitude: Number(dispatch.booking.pickupLatitude), longitude: Number(dispatch.booking.pickupLongitude) },
    );

    dispatch.ambulanceId = next.id;
    dispatch.ambulance = next;
    dispatch.driverId = null as any;
    dispatch.status = 'DISPATCHED';
    dispatch.dispatchedAt = new Date();
    dispatch.estimatedPickupTime = pickupEta.minutes;
    const saved = await this.dispatchRepository.save(dispatch);
    await this.bookingRepository.update(dispatch.bookingId, { status: BookingStatus.ASSIGNED });

    await this.releaseAmbulance(previousAmbulanceId);
    this.eventEmitter.emit('ambulance.available', previousAmbulanceId);

    const payload = {
      dispatchId: saved.id,
      bookingId: saved.bookingId,
      ambulanceId: next.id,
      previousAmbulanceId,
      hospitalId: saved.hospitalId,
      status: saved.status,
      reason: 'ADMIN_REASSIGNED',
    };
    // The old crew is taken off the case; the new crew, patient and hospital see the new unit.
    this.realtimeGateway.emitToCase(
      { ambulanceId: previousAmbulanceId, driverId: previousDriverId },
      'dispatch_status_updated',
      { ...payload, status: 'REASSIGNED' },
    );
    this.realtimeGateway.emitToCase(
      { patientId: dispatch.booking.userId, ambulanceId: next.id, hospitalIds: [saved.hospitalId] },
      'dispatch_assigned',
      payload,
    );
    if (saved.hospitalId) await this.sendPreArrivalAlert(saved.hospitalId, dispatch.booking, saved, next);

    return saved;
  }

  /**
   * Send an active trip to a different hospital. The hospital it is leaving
   * is told, and the new one gets a full pre-arrival alert.
   */
  async changeDestination(dispatchId: string, hospitalId: string): Promise<Dispatch> {
    const dispatch = await this.dispatchRepository.findOne({ where: { id: dispatchId }, relations: ['booking', 'ambulance', 'hospital'] });
    if (!dispatch?.booking) throw new NotFoundException('Dispatch not found');
    if (['COMPLETED', 'CANCELLED', 'AT_HOSPITAL'].includes(dispatch.status)) {
      throw new ConflictException(`The trip is ${dispatch.status.toLowerCase().replace(/_/g, ' ')}; the destination can no longer change.`);
    }
    const hospital = await this.hospitalRepository.findOne({ where: { id: hospitalId } });
    if (!hospital) throw new NotFoundException('Hospital not found');
    if (dispatch.hospitalId === hospital.id) return dispatch;

    const previousHospital = dispatch.hospital ?? null;
    const transportEta = await this.travelTime.estimateOne(
      {
        latitude: Number(dispatch.booking.pickupLatitude),
        longitude: Number(dispatch.booking.pickupLongitude),
      },
      { latitude: Number(hospital.latitude), longitude: Number(hospital.longitude) },
    );

    dispatch.hospitalId = hospital.id;
    dispatch.hospital = hospital;
    dispatch.estimatedHospitalTime = transportEta.minutes;
    const saved = await this.dispatchRepository.save(dispatch);
    await this.bookingRepository.update(dispatch.bookingId, {
      destinationAddress: hospital.name,
      destinationLatitude: Number(hospital.latitude),
      destinationLongitude: Number(hospital.longitude),
    });

    this.realtimeGateway.emitToCase(
      {
        patientId: dispatch.booking.userId,
        ambulanceId: dispatch.ambulanceId,
        driverId: dispatch.driverId,
        hospitalIds: [previousHospital?.id, hospital.id],
      },
      'dispatch_diverted',
      {
        dispatchId: saved.id,
        bookingId: saved.bookingId,
        userId: dispatch.booking.userId,
        ambulanceId: saved.ambulanceId,
        oldHospital: previousHospital ? { id: previousHospital.id, name: previousHospital.name } : null,
        newHospital: {
          id: hospital.id,
          name: hospital.name,
          address: hospital.address,
          latitude: Number(hospital.latitude),
          longitude: Number(hospital.longitude),
        },
        reason: 'Destination changed by an administrator',
        message: previousHospital
          ? `Destination changed from ${previousHospital.name} to ${hospital.name}`
          : `Destination set to ${hospital.name}`,
      },
    );
    if (dispatch.ambulance) await this.sendPreArrivalAlert(hospital.id, dispatch.booking, saved, dispatch.ambulance);

    return saved;
  }

  /**
   * Open shareable tracking for a case and tell the family.
   *
   * Relatives get a link they can open in any browser — no login, no app — so
   * whoever is with the patient never has to break off to make phone calls.
   *
   * Neither half of this may hold up or fail a dispatch: the link is created
   * inside a try/catch, and the SMS fan-out is deliberately not awaited, since
   * an SMS gateway's latency has no business sitting in the dispatch path.
   */
  private async openTrackingForCase(booking: Booking, dispatch: Dispatch): Promise<void> {
    try {
      const link = await this.trackingService.issueForCase(booking.id, dispatch.id);
      this.logger.log(`[autoDispatch] Tracking link ready for booking ${booking.id}`);

      this.trackingNotifier
        .notifyContactsForCase(booking.userId, booking.id, link)
        .catch(err =>
          this.logger.error(`[autoDispatch] Emergency contact alerts failed for booking ${booking.id}`, err.stack),
        );
    } catch (err) {
      this.logger.error(`[autoDispatch] Could not open tracking for booking ${booking.id}`, err.stack);
    }
  }

  /**
   * Update a booking. Patients may only cancel their own (or edit its
   * description); a hospital may only touch cases it is receiving.
   */
  async update(id: string, data: {
    status?: BookingStatus;
    description?: string;
  }, user: any): Promise<Booking> {
    const { booking, dispatch, role } = await this.caseAccess.assertCaseAccess(user, id, ['patient', 'hospital', 'admin']);

    if (role === 'patient' && data.status && data.status !== BookingStatus.CANCELLED) {
      throw new ForbiddenException('You can only cancel your own bookings');
    }

    if (data.description) {
      booking.description = data.description;
    }

    // Cancelling has to release the ambulance and stop the trip, not just
    // relabel the booking — one path for every caller.
    if (data.status === BookingStatus.CANCELLED) {
      if (data.description) await this.bookingRepository.save(booking);
      return this.cancelCase(booking, dispatch);
    }

    if (data.status) {
      booking.status = data.status;
      if (data.status === BookingStatus.COMPLETED) {
        booking.completedAt = new Date();
        await this.trackingService.closeForBooking(booking.id, 'COMPLETED');
      }
    }

    return this.bookingRepository.save(booking);
  }

  /**
   * Cancel a booking. Patients may cancel their own; admins any.
   */
  async cancel(id: string, user: any): Promise<Booking> {
    const { booking, dispatch } = await this.caseAccess.assertCaseAccess(user, id, ['patient', 'admin']);
    return this.cancelCase(booking, dispatch);
  }

  private async cancelCase(booking: Booking, dispatch: Dispatch | null): Promise<Booking> {
    // Can only cancel if not completed or already cancelled
    if (booking.status === BookingStatus.COMPLETED) {
      throw new ForbiddenException('Cannot cancel a completed booking');
    }

    // Idempotent cancel: return current state instead of throwing when already cancelled.
    if (booking.status === BookingStatus.CANCELLED) {
      return booking;
    }

    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    const savedBooking = await this.bookingRepository.save(booking);

    if (dispatch && dispatch.status !== 'CANCELLED') {
      dispatch.status = 'CANCELLED';
      await this.dispatchRepository.save(dispatch);
    }

    if (dispatch?.ambulanceId) {
      const ambulance = await this.ambulanceRepository.findOne({
        where: { id: dispatch.ambulanceId },
      });
      if (ambulance && ambulance.status !== AmbulanceStatus.AVAILABLE) {
        ambulance.status = AmbulanceStatus.AVAILABLE;
        await this.ambulanceRepository.save(ambulance);
        // A booking may be waiting for exactly this unit.
        this.eventEmitter.emit('ambulance.available', ambulance.id);
      }
    }

    // The case is over, so the shared link stops working for everyone holding it.
    await this.trackingService.closeForBooking(booking.id, 'CANCELLED');

    // The driver and the hospital stop the trip now, not on their next refresh.
    if (dispatch) {
      this.realtimeGateway.emitToCase(
        { patientId: booking.userId, ambulanceId: dispatch.ambulanceId, hospitalIds: [dispatch.hospitalId] },
        'dispatch_status_updated',
        {
          dispatchId: dispatch.id,
          bookingId: booking.id,
          ambulanceId: dispatch.ambulanceId,
          status: 'CANCELLED',
        },
      );
    }

    return savedBooking;
  }

  /**
   * Get booking statistics for admin — one grouped query instead of eight counts.
   */
  async getBookingStats(): Promise<any> {
    const rows: { status: BookingStatus; severity: SeverityLevel | null; count: string | number }[] = await this.bookingRepository
      .createQueryBuilder('booking')
      .select('booking.status', 'status')
      .addSelect('booking.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .groupBy('booking.status')
      .addGroupBy('booking.severity')
      .getRawMany();

    const sum = (predicate: (row: typeof rows[number]) => boolean) =>
      rows.filter(predicate).reduce((total, row) => total + Number(row.count), 0);

    const totalBookings = sum(() => true);
    const completedBookings = sum(row => row.status === BookingStatus.COMPLETED);
    const activeStatuses = [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS];

    return {
      total: totalBookings,
      completed: completedBookings,
      cancelled: sum(row => row.status === BookingStatus.CANCELLED),
      active: sum(row => activeStatuses.includes(row.status)),
      completionRate: totalBookings > 0 ? ((completedBookings / totalBookings) * 100).toFixed(2) : 0,
      bySeverity: {
        critical: sum(row => row.severity === SeverityLevel.CRITICAL),
        high: sum(row => row.severity === SeverityLevel.HIGH),
        medium: sum(row => row.severity === SeverityLevel.MEDIUM),
        low: sum(row => row.severity === SeverityLevel.LOW),
      },
    };
  }
}
