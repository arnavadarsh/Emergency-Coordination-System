import { IsNumber, IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { SeverityLevel } from '../../common/enums';

/**
 * DTO for creating a new booking
 */
export class CreateBookingDto {
  @IsNumber()
  @IsOptional()
  pickupLatitude?: number;

  @IsNumber()
  @IsOptional()
  pickupLongitude?: number;

  @IsString()
  @IsOptional()
  pickupAddress?: string;

  @IsString()
  @IsOptional()
  pickupLocation?: string;

  @IsNumber()
  @IsOptional()
  destinationLatitude?: number;

  @IsNumber()
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

  @IsString()
  @IsOptional()
  bookingType?: string;

  @IsObject()
  @IsOptional()
  triageData?: any;
}
