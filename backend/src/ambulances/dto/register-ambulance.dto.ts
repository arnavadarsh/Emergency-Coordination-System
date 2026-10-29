import { IsString, IsEnum, IsOptional, IsNumber, IsObject } from 'class-validator';
import { AmbulanceType } from '../../common/enums';

/**
 * DTO for registering a new ambulance
 */
export class RegisterAmbulanceDto {
  @IsString()
  vehicleNumber: string;

  @IsEnum(AmbulanceType)
  vehicleType: AmbulanceType;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  driverLicense?: string;

  @IsOptional()
  @IsNumber()
  currentLatitude?: number;

  @IsOptional()
  @IsNumber()
  currentLongitude?: number;

  @IsOptional()
  @IsObject()
  equipmentList?: any;
}
