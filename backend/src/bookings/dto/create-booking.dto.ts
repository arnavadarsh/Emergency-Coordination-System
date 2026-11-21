import { IsNumber, IsString, IsOptional, IsEnum, IsObject, IsIn, IsISO8601, Min, Max } from 'class-validator';
import { SeverityLevel } from '../../common/enums';

/**
 * DTO for creating a new booking
 */
export class CreateBookingDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  pickupLatitude?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  pickupLongitude?: number;

  @IsString()
  @IsOptional()
  pickupAddress?: string;

  @IsString()
  @IsOptional()
  pickupLocation?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  destinationLatitude?: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  destinationLongitude?: number;

  @IsString()
  @IsOptional()
  destinationAddress?: string;

  @IsString()
  @IsOptional()
  dropoffLocation?: string;

  @IsEnum(SeverityLevel)
  @IsOptional()
  severity?: SeverityLevel;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(['EMERGENCY', 'SCHEDULED'])
  @IsOptional()
  bookingType?: string;

  /** Required for a SCHEDULED booking: when the ambulance is wanted, ISO-8601. */
  @IsISO8601()
  @IsOptional()
  scheduledTime?: string;

  /** Equipment asked for on a SCHEDULED booking, e.g. { oxygenSupport: true }. */
  @IsObject()
  @IsOptional()
  ambulanceFacilities?: Record<string, boolean>;

  @IsObject()
  @IsOptional()
  triageData?: any;
}
