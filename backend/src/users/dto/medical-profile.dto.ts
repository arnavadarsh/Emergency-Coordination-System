import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Medical Profile payload — used both when creating a patient ID and when
 * editing the profile later.
 *
 * Every field is optional, so an ID can be created with none of them. Sending a
 * field as an empty string is how a client *removes* outdated information: the
 * service normalises blanks to NULL. Omitting a field entirely leaves whatever
 * is already stored untouched.
 */
export class MedicalProfileDto {
  /** Blood group, e.g. "O+". Constrained to the width of the `blood_type` column. */
  @IsString()
  @IsOptional()
  @MaxLength(5)
  bloodGroup?: string;

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
}
