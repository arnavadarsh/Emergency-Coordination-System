import { IsNotEmpty, IsString, IsNumber, IsBoolean, IsOptional } from 'class-validator';

/**
 * DTO for creating a saved location
 */
export class CreateSavedLocationDto {
  @IsNotEmpty()
  @IsString()
  label: string;

  @IsNotEmpty()
  @IsString()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  latitude: number;

  @IsNotEmpty()
  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * DTO for updating a saved location
 */
export class UpdateSavedLocationDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
