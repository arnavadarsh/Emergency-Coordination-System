import { IsNotEmpty, IsObject, ValidateNested, IsNumber, IsBoolean, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { EmergencyType } from '../../triage/entities/triage.entity';

class LocationDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}

class TriageAnswersDto {
  @IsNotEmpty()
  breathing: string;

  @IsNotEmpty()
  bleeding: string;

  @IsNotEmpty()
  conscious: string;

  @IsNumber()
  painLevel: number;

  @IsBoolean()
  @IsOptional()
  pregnancy?: boolean;
}

/** The patient is the signed-in account; there is no userId field to spoof. */
export class CreateEmergencyBookingDto {
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;

  /** Must be one of the deployed `triage_reports_emergencytype_enum` values. */
  @IsEnum(EmergencyType)
  emergencyType: EmergencyType;

  @IsObject()
  @ValidateNested()
  @Type(() => TriageAnswersDto)
  answers: TriageAnswersDto;
}
