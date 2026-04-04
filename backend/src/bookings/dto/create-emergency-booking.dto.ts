import { IsNotEmpty, IsString, IsObject, ValidateNested, IsNumber, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

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

export class CreateEmergencyBookingDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;

  @IsString()
  @IsNotEmpty()
  emergencyType: string;

  @IsObject()
  @ValidateNested()
  @Type(() => TriageAnswersDto)
  answers: TriageAnswersDto;
}
