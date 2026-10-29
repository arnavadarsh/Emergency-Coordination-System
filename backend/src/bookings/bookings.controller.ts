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
    
    if (!pickupAddress && !createBookingDto.pickupLatitude) {
      throw new BadRequestException('Pickup location is required');
    }
    
    // Use default coordinates if not provided (could be replaced with geocoding service)
    // Default to a central location if only address is provided
    const pickupLatitude = createBookingDto.pickupLatitude || 28.6139; // Default Delhi coords
    const pickupLongitude = createBookingDto.pickupLongitude || 77.2090;
    
    // Determine severity from triage data if provided
    let severity = createBookingDto.severity || SeverityLevel.MEDIUM;
    if (createBookingDto.triageData) {
      // Auto-determine severity based on triage data
      if (!createBookingDto.triageData.isBreathing || !createBookingDto.triageData.isConscious) {
        severity = SeverityLevel.CRITICAL;
      } else if (createBookingDto.triageData.hasChestPain || createBookingDto.triageData.hasSevereBleeding) {
        severity = SeverityLevel.HIGH;
      } else if (createBookingDto.triageData.severity) {
        severity = createBookingDto.triageData.severity;
      }
    }
    
    return this.bookingsService.create(user.id, {
      pickupLatitude,
      pickupLongitude,
      pickupAddress: pickupAddress || 'Not specified',
      destinationLatitude: createBookingDto.destinationLatitude,
      destinationLongitude: createBookingDto.destinationLongitude,
      destinationAddress,
      severity,
      description: createBookingDto.triageData?.chiefComplaint || createBookingDto.description,
    });
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
