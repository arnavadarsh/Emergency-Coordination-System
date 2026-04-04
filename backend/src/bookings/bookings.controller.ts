import { Controller, Post, Body, Get, Param, Patch, Delete, Query, UseGuards, BadRequestException } from '@nestjs/common';
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

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('emergency')
  createEmergencyBooking(@Body() createBookingDto: CreateEmergencyBookingDto) {
    return this.bookingsService.createEmergencyBooking(createBookingDto);
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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findById(id);
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

  @Get(':id/tracking')
  async getTracking(@Param('id') id: string) {
    return this.bookingsService.getTrackingInfo(id);
  }

  @Get('stats/overview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getBookingStats() {
    return this.bookingsService.getBookingStats();
  }
}
