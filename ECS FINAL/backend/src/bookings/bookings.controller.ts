import { Controller, Get, Post, Patch, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { UserRole, BookingStatus, SeverityLevel } from '../common/enums';

interface CreateBookingDto {
  // Location can be provided as coordinates or address
  pickupLatitude?: number;
  pickupLongitude?: number;
  pickupAddress?: string;
  pickupLocation?: string; // Frontend sends this
  destinationLatitude?: number;
  destinationLongitude?: number;
  destinationAddress?: string;
  dropoffLocation?: string; // Frontend sends this
  severity?: SeverityLevel;
  description?: string;
  bookingType?: string;
  triageData?: any;
}

interface UpdateBookingDto {
  status?: BookingStatus;
  description?: string;
}

/**
 * Bookings Controller
 * Endpoints for booking management
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.HOSPITAL)
  async findAll() {
    return this.bookingsService.findAll();
  }

  @Get('my-bookings')
  @Roles(UserRole.USER)
  async findMyBookings(@CurrentUser() user: any) {
    return this.bookingsService.findByUser(user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }

  @Post()
  @Roles(UserRole.USER)
  async create(@CurrentUser() user: any, @Body() createBookingDto: CreateBookingDto) {
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
  @Roles(UserRole.USER, UserRole.ADMIN, UserRole.HOSPITAL)
  async update(
    @Param('id') id: string,
    @Body() updateBookingDto: UpdateBookingDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.update(id, updateBookingDto, user);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.USER, UserRole.ADMIN)
  async cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.cancel(id, user);
  }
}
