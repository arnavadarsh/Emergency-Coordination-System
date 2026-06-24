import { IsNumber, IsLatitude, IsLongitude } from 'class-validator';

/**
 * DTO for updating ambulance location
 */
export class UpdateLocationDto {
  @IsNumber()
  @IsLatitude()
  latitude: number;

  @IsNumber()
  @IsLongitude()
  longitude: number;
}
