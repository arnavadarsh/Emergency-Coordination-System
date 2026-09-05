import { IsString, IsOptional, IsDateString, IsPhoneNumber, MaxLength } from 'class-validator';

/**
 * DTO for updating user profile
 */
export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  emergencyContact?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  // ── Medical Profile ─────────────────────────────────────────────────────
  // All optional. Send a field as "" to clear it; omit it to leave it as-is.

  /** Blood group, e.g. "O+". Preferred name for the field. */
  @IsString()
  @IsOptional()
  @MaxLength(5)
  bloodGroup?: string;

  /** Legacy alias for `bloodGroup`, kept so older clients keep working. */
  @IsString()
  @IsOptional()
  @MaxLength(5)
  bloodType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  allergies?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  chronicConditions?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  currentMedications?: string;

  @IsString()
  @IsOptional()
  medicalNotes?: string;

  /** Public URL or data URI of the profile photo. Surfaced as driver identity on tracking/pre-arrival views. */
  @IsString()
  @IsOptional()
  profilePhotoUrl?: string;
}
