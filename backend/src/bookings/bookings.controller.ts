import { Controller, Post, Body, Get, Param, Patch, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateEmergencyBookingDto } from './dto/create-emergency-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { FindBookingsDto } from './dto/find-bookings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, SeverityLevel } from '../common/enums';
import { CreateBookingDto as CreateLegacyBookingDto } from './dto/create-booking.dto';
import { CaseAccessService } from '../access/case-access.service';
import { EmergencyType } from '../triage/entities/triage.entity';

/** The triage engine's category names, as stored on a triage report. */
const EMERGENCY_TYPE_BY_CATEGORY: Record<string, EmergencyType> = {
  cardiac: EmergencyType.CARDIAC,
  stroke: EmergencyType.NEURO,
  neurological: EmergencyType.NEURO,
  trauma: EmergencyType.TRAUMA,
  respiratory: EmergencyType.RESPIRATORY,
  obstetric: EmergencyType.OBSTETRIC,
  other: EmergencyType.OTHER,
};

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly caseAccess: CaseAccessService,
  ) {}

  /**
   * Structured emergency request. The patient is always the signed-in account —
   * this used to be unauthenticated and took `userId` from the body, so anyone
   * could raise a case (and send a real ambulance) in another person's name.
   */
  @Post('emergency')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  createEmergencyBooking(@CurrentUser() user: any, @Body() createBookingDto: CreateEmergencyBookingDto) {
    return this.bookingsService.createEmergencyBooking(user.id, createBookingDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll(@Query() findBookingsDto: FindBookingsDto) {
    return this.bookingsService.findAll(findBookingsDto);
  }

  @Get('my-bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async findMyBookings(@CurrentUser() user: any) {
    return this.bookingsService.findByUser(user.id);
  }

  /**
   * One booking, for the people on the case only. Returns the booking and the
   * patient's id and name — not the account row it used to return in full
   * (email, phone, address, date of birth, medical history) to anyone holding
   * the id. Responders who need the clinical picture use /bookings/:id/report.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    const { booking, dispatch } = await this.caseAccess.assertCaseAccess(user, id, undefined, ['user']);
    return this.bookingsService.toBookingView(booking, dispatch);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async create(@CurrentUser() user: any, @Body() createBookingDto: CreateLegacyBookingDto) {
    // Support both coordinate-based and address-based booking
    const pickupAddress = createBookingDto.pickupAddress || createBookingDto.pickupLocation;
    const destinationAddress = createBookingDto.destinationAddress || createBookingDto.dropoffLocation;
    
    // The pickup point decides which ambulance goes and where it drives, so it
    // has to be a real position. A booking with only an address used to be
    // given a fixed point in central Delhi — and an ambulance was sent there.
    const pickupLatitude = createBookingDto.pickupLatitude;
    const pickupLongitude = createBookingDto.pickupLongitude;
    if (
      typeof pickupLatitude !== 'number' || typeof pickupLongitude !== 'number' ||
      !Number.isFinite(pickupLatitude) || !Number.isFinite(pickupLongitude)
    ) {
      throw new BadRequestException('Pickup coordinates are required: set the pickup point on the map or share your location');
    }
    
    // A scheduled transport needs a time, and one that has not already gone.
    const isScheduled = createBookingDto.bookingType === 'SCHEDULED';
    const scheduledTime = isScheduled && createBookingDto.scheduledTime ? new Date(createBookingDto.scheduledTime) : null;
    if (isScheduled && !scheduledTime) {
      throw new BadRequestException('A scheduled booking needs a date and time');
    }
    if (scheduledTime && scheduledTime.getTime() < Date.now() - 5 * 60_000) {
      throw new BadRequestException('The scheduled time has already passed');
    }
    const facilities = Object.entries(createBookingDto.ambulanceFacilities ?? {})
      .filter(([, wanted]) => wanted === true)
      .map(([name]) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());

    const severity = this.resolveSeverity(createBookingDto.severity, createBookingDto.triageData);
    
    return this.bookingsService.create(user.id, {
      pickupLatitude,
      pickupLongitude,
      pickupAddress: pickupAddress || 'Not specified',
      destinationLatitude: createBookingDto.destinationLatitude,
      destinationLongitude: createBookingDto.destinationLongitude,
      destinationAddress,
      severity,
      description:
        [
          createBookingDto.triageData?.chiefComplaint || createBookingDto.description,
          isScheduled && facilities.length > 0 ? `Requested: ${facilities.join(', ')}` : null,
        ].filter(Boolean).join(' · ') || undefined,
      bookingType: isScheduled ? 'SCHEDULED' : 'EMERGENCY',
      scheduledTime,
      triage: isScheduled ? undefined : this.toTriageInput(createBookingDto.triageData),
    });
  }

  /**
   * The severity a booking is dispatched at: the highest of what the caller
   * asked for and what the triage findings themselves demand.
   *
   * The findings can only raise it. They used to replace it, so a CRITICAL
   * request that mentioned chest pain was stored as HIGH; and a missing
   * breathing/consciousness answer counted as "no", making it CRITICAL.
   */
  private resolveSeverity(requested: SeverityLevel | undefined, triageData: any): SeverityLevel {
    const order = [SeverityLevel.LOW, SeverityLevel.MEDIUM, SeverityLevel.HIGH, SeverityLevel.CRITICAL];
    const valid = (value: unknown): SeverityLevel | null =>
      order.includes(value as SeverityLevel) ? (value as SeverityLevel) : null;

    const candidates: SeverityLevel[] = [];
    const asked = valid(requested);
    if (asked) candidates.push(asked);

    if (triageData && typeof triageData === 'object') {
      const fromTriage = valid(triageData.severity);
      if (fromTriage) candidates.push(fromTriage);
      // Only an explicit "no" is a red flag — the same rule as toTriageInput.
      if (triageData.isBreathing === false || triageData.isConscious === false) {
        candidates.push(SeverityLevel.CRITICAL);
      } else if (triageData.hasChestPain === true || triageData.hasSevereBleeding === true) {
        candidates.push(SeverityLevel.HIGH);
      }
    }

    if (candidates.length === 0) return SeverityLevel.MEDIUM;
    return candidates.reduce((worst, next) => (order.indexOf(next) > order.indexOf(worst) ? next : worst));
  }

  /**
   * The triage findings sent with a booking, in the shape a triage report
   * stores. Without this the hospital's pre-arrival alert and the hospital
   * ranking knew only the severity, not what kind of emergency it was.
   */
  private toTriageInput(triageData: any) {
    if (!triageData || typeof triageData !== 'object') return undefined;

    const category = String(triageData.emergencyType ?? '').toLowerCase();
    const emergencyType =
      EMERGENCY_TYPE_BY_CATEGORY[category] ??
      (triageData.hasChestPain ? EmergencyType.CARDIAC : EmergencyType.OTHER);
    const painLevel = Number(triageData.painLevel);

    return {
      emergencyType,
      // Unknown counts as "breathing"/"conscious": only an explicit false is a red flag.
      breathing: triageData.isBreathing !== false,
      conscious: triageData.isConscious !== false,
      bleeding: triageData.hasSevereBleeding === true,
      painLevel: Number.isFinite(painLevel) ? Math.max(0, Math.min(10, Math.round(painLevel))) : 0,
      pregnancy: triageData.isPregnant === true,
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN, UserRole.HOSPITAL)
  async update(
    @Param('id') id: string,
    @Body() updateBookingDto: UpdateBookingDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.update(id, updateBookingDto, user);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  async cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.cancel(id, user);
  }

  // There is deliberately no GET /bookings/:id/tracking any more. It served the
  // live ambulance view to anyone who knew a booking id, with no login. Family
  // members follow a case through the secret link (/tracking/public/:token);
  // the patient sees the same live view on their own dashboard.

  /**
   * Full ECS case report: patient, Medical Profile, emergency, triage and the
   * dispatch/treatment timeline in one record. Limited to the hospital and
   * driver on this case, and admins.
   *
   * The Medical Profile is resolved live from the patient's profile, so a report
   * generated after a profile edit carries the updated values.
   */
  @Get(':id/report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.HOSPITAL, UserRole.DRIVER)
  async getCaseReport(@Param('id') id: string, @CurrentUser() user: any) {
    await this.caseAccess.assertCaseAccess(user, id, ['admin', 'hospital', 'driver']);
    return this.bookingsService.buildCaseReport(id);
  }

  @Get('stats/overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getBookingStats() {
    return this.bookingsService.getBookingStats();
  }
}
