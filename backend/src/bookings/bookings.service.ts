import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from './entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { TriageReport, EmergencyType } from '../triage/entities/triage.entity';
import { User } from '../users/entities/user.entity';
import { BookingStatus, SeverityLevel, UserRole, AmbulanceStatus } from '../common/enums';
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
  ) {}

  private isHospitalAccepting(status?: string): boolean {
    const normalized = (status || '').toUpperCase();
    return normalized === 'ACTIVE' || normalized === 'ACCEPTING';
  }

  async createEmergencyBooking(createBookingDto: CreateEmergencyBookingDto): Promise<{ bookingId: string; status: BookingStatus }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { userId, location, emergencyType, answers } = createBookingDto;

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
      let derivedEmergencyType: EmergencyType = emergencyType as EmergencyType;
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
      booking.status           = BookingStatus.PENDING;
      booking.severity         = derivedSeverity;     // ← was missing before
      booking.triageReport     = savedTriageReport;

      const savedBooking = await queryRunner.manager.save(booking);

      await queryRunner.commitTransaction();

      this.logger.log(`New emergency booking created: ${savedBooking.id} severity=${derivedSeverity}`);
      this.realtimeGateway.server.emit('booking_created', savedBooking);
      this.eventEmitter.emit('booking.created', savedBooking.id);

      // Pass the in-memory triageReport so autoDispatch doesn't need a DB re-fetch
      this.autoDispatch(savedBooking, savedTriageReport).catch(err =>
        this.logger.error(`[autoDispatch] Failed for emergency booking ${savedBooking.id}`, err.stack),
      );

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
  }): Promise<Booking> {
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
    });
    const savedBooking = await this.bookingRepository.save(booking);

    // Auto-dispatch: Find nearest available ambulance
    await this.autoDispatch(savedBooking);

    return savedBooking;
  }

  /**
   * Auto-dispatch nearest available ambulance to booking
   */
  private async autoDispatch(booking: Booking, preloadedTriage?: TriageReport | null): Promise<void> {
    this.logger.log(`[autoDispatch] START bookingId=${booking.id} pickup=(${booking.pickupLatitude},${booking.pickupLongitude}) preloadedTriage=${preloadedTriage ? 'YES' : 'NO'}`);

    // Find all available ambulances with location
    const availableAmbulances = await this.ambulanceRepository.find({
      where: { status: AmbulanceStatus.AVAILABLE },
    });
    this.logger.log(`[autoDispatch] Available ambulances: ${availableAmbulances.length}`);

    if (availableAmbulances.length === 0) {
      this.logger.warn(`[autoDispatch] No available ambulances — aborting dispatch for booking ${booking.id}`);
      return;
    }

    // Find nearest ambulance using Haversine formula
    let nearestAmbulance = availableAmbulances[0];
    let minDistance = this.calculateDistance(
      booking.pickupLatitude,
      booking.pickupLongitude,
      nearestAmbulance.currentLatitude || booking.pickupLatitude,
      nearestAmbulance.currentLongitude || booking.pickupLongitude,
    );

    for (const ambulance of availableAmbulances) {
      if (ambulance.currentLatitude && ambulance.currentLongitude) {
        const distance = this.calculateDistance(
          booking.pickupLatitude,
          booking.pickupLongitude,
          ambulance.currentLatitude,
          ambulance.currentLongitude,
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearestAmbulance = ambulance;
        }
      }
    }
    this.logger.log(`[autoDispatch] Nearest ambulance: ${nearestAmbulance.vehicleNumber} (${nearestAmbulance.id}), distance=${minDistance.toFixed(2)}km`);

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

    // Update ambulance status
    nearestAmbulance.status = AmbulanceStatus.BUSY;
    await this.ambulanceRepository.save(nearestAmbulance);

    // Update booking status
    booking.status = BookingStatus.ASSIGNED;
    await this.bookingRepository.save(booking);

    // An ambulance is now assigned, which is the moment this case becomes
    // followable: mint the private tracking link and text it to the patient's
    // emergency contacts.
    await this.openTrackingForCase(booking, dispatch);

    // Broadcast to all dashboards. Note the tracking link is deliberately NOT
    // in this payload — it is a secret, and this event goes to every connected
    // dashboard. The patient fetches it from the authenticated share endpoint.
    this.realtimeGateway.server.emit('dispatch_assigned', {
      dispatchId: dispatch.id,
      bookingId: booking.id,
      ambulanceId: nearestAmbulance.id,
      hospitalId: selectedHospital?.id,
      hospitalName: selectedHospital?.name,
      status: dispatch.status,
      assignedAt: dispatch.dispatchedAt,
    });

    // Pre-arrival alert: notify the specific hospital room
    if (selectedHospital) {
      // Use preloaded triage if available; fall back to a DB fetch
      let triage: TriageReport | null = preloadedTriage ?? null;
      if (!triage) {
        const bookingWithTriage = await this.bookingRepository.findOne({
          where: { id: booking.id },
          relations: ['triageReport'],
        });
        triage = bookingWithTriage?.triageReport ?? null;
      }
      this.logger.log(`[autoDispatch] Triage: ${triage ? 'YES (type=' + triage.emergencyType + ', breathing=' + triage.breathing + ')' : 'NO (null)'}`);
      this.logger.log(`[autoDispatch] Emitting pre_arrival_alert to room hospital:${selectedHospital.id} severity=${booking.severity}`);

      // Identify the driver so the receiving hospital knows who is bringing the patient in.
      const driver = await this.driverIdentityService.resolveOne({
        driverId: dispatch.driverId,
        ambulanceId: nearestAmbulance.id,
        vehicleNumber: nearestAmbulance.vehicleNumber,
      });

      // Pull the patient's Medical Profile fresh at alert time so the hospital
      // receives the most recently saved information. Fields the patient never
      // supplied arrive as null and render as "Not Provided" — the alert never
      // carries a guessed blood group, allergy or medication.
      const medicalProfile = await this.medicalProfileService.resolveOne(booking.userId);

      this.realtimeGateway.emitToHospital(selectedHospital.id, 'pre_arrival_alert', {
        dispatchId: dispatch.id,
        bookingId: booking.id,
        ambulanceId: nearestAmbulance.id,
        ambulanceVehicleNumber: nearestAmbulance.vehicleNumber,
        driver,
        ambulanceLocation: {
          latitude: nearestAmbulance.currentLatitude ?? null,
          longitude: nearestAmbulance.currentLongitude ?? null,
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

    this.logger.log(`[autoDispatch] DONE — ambulance ${nearestAmbulance.vehicleNumber} → booking ${booking.id}`);
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
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Update a booking
   */
  async update(id: string, data: {
    status?: BookingStatus;
    description?: string;
  }, user: any): Promise<Booking> {
    const booking = await this.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Users can only update their own bookings
    if (user.role === UserRole.USER && booking.userId !== user.id) {
      throw new ForbiddenException('You can only update your own bookings');
    }

    if (data.status) {
      booking.status = data.status;
      if (data.status === BookingStatus.COMPLETED) {
        booking.completedAt = new Date();
        await this.trackingService.closeForBooking(booking.id, 'COMPLETED');
      } else if (data.status === BookingStatus.CANCELLED) {
        booking.cancelledAt = new Date();
        await this.trackingService.closeForBooking(booking.id, 'CANCELLED');
      }
    }

    if (data.description) {
      booking.description = data.description;
    }

    return this.bookingRepository.save(booking);
  }

  /**
   * Cancel a booking
   */
  async cancel(id: string, user: any): Promise<Booking> {
    const booking = await this.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Users can only cancel their own bookings
    if (user.role === UserRole.USER && booking.userId !== user.id) {
      throw new ForbiddenException('You can only cancel your own bookings');
    }

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

    const dispatch = await this.dispatchRepository.findOne({
      where: { bookingId: id },
      order: { createdAt: 'DESC' },
    });

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
      }
    }

    // The case is over, so the shared link stops working for everyone holding it.
    await this.trackingService.closeForBooking(id, 'CANCELLED');

    return savedBooking;
  }

  /**
   * Get booking tracking information
   */
  async getTrackingInfo(id: string): Promise<any> {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Get dispatch information
    const dispatch = await this.dispatchRepository.findOne({
      where: { bookingId: id },
      relations: ['ambulance'],
      order: { createdAt: 'DESC' },
    });

    const driverIdentity = dispatch
      ? await this.driverIdentityService.resolveOne({
          driverId: dispatch.driverId,
          ambulanceId: dispatch.ambulanceId,
          vehicleNumber: dispatch.ambulance?.vehicleNumber ?? null,
        })
      : null;

    return {
      booking: {
        id: booking.id,
        status: booking.status,
        severity: booking.severity,
        pickupLocation: {
          latitude: booking.pickupLatitude,
          longitude: booking.pickupLongitude,
          address: booking.pickupAddress,
        },
        destinationLocation: booking.destinationLatitude ? {
          latitude: booking.destinationLatitude,
          longitude: booking.destinationLongitude,
          address: booking.destinationAddress,
        } : null,
        createdAt: booking.createdAt,
        completedAt: booking.completedAt,
      },
      dispatch: dispatch ? {
        id: dispatch.id,
        status: dispatch.status,
        dispatchedAt: dispatch.dispatchedAt,
        arrivedAtPickup: dispatch.arrivedAtPickup,
        completedAt: dispatch.completedAt,
        estimatedPickupTime: dispatch.estimatedPickupTime,
        ambulance: dispatch.ambulance ? {
          id: dispatch.ambulance.id,
          vehicleNumber: dispatch.ambulance.vehicleNumber,
          vehicleType: dispatch.ambulance.vehicleType,
          currentLocation: {
            latitude: dispatch.ambulance.currentLatitude,
            longitude: dispatch.ambulance.currentLongitude,
          },
          status: dispatch.ambulance.status,
        } : null,
        driver: driverIdentity,
      } : null,
    };
  }

  /**
   * Get booking statistics for admin
   */
  async getBookingStats(): Promise<any> {
    const totalBookings = await this.bookingRepository.count();
    const completedBookings = await this.bookingRepository.count({
      where: { status: BookingStatus.COMPLETED },
    });
    const cancelledBookings = await this.bookingRepository.count({
      where: { status: BookingStatus.CANCELLED },
    });
    const activeBookings = await this.bookingRepository.count({
      where: [
        { status: BookingStatus.CREATED },
        { status: BookingStatus.ASSIGNED },
        { status: BookingStatus.IN_PROGRESS },
      ],
    });

    // Get bookings by severity
    const criticalBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.CRITICAL },
    });
    const highBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.HIGH },
    });
    const mediumBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.MEDIUM },
    });
    const lowBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.LOW },
    });

    return {
      total: totalBookings,
      completed: completedBookings,
      cancelled: cancelledBookings,
      active: activeBookings,
      completionRate: totalBookings > 0 ? ((completedBookings / totalBookings) * 100).toFixed(2) : 0,
      bySeverity: {
        critical: criticalBookings,
        high: highBookings,
        medium: mediumBookings,
        low: lowBookings,
      },
    };
  }
}
