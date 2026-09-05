import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO for saving an emergency contact.
 *
 * `relation` is free text rather than an enum: the dashboard offers the usual
 * choices (Parent, Spouse, Sibling, Child, Friend…), but families do not fit a
 * fixed list, and the value is only ever displayed back to the patient.
 */
export class CreateEmergencyContactDto {
  @IsString()
  @IsNotEmpty({ message: 'Contact name is required' })
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @MinLength(6)
  @MaxLength(20)
  phoneNumber: string;

  @IsString()
  @IsNotEmpty({ message: 'Relation is required' })
  @MaxLength(40)
  relation: string;

  /** Include this contact in the automatic alert. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  notifyBySms?: boolean;
}

/** Every field optional — the patient can edit any part of a contact at any time. */
export class UpdateEmergencyContactDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Contact name cannot be empty' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Relation cannot be empty' })
  @MaxLength(40)
  relation?: string;

  @IsOptional()
  @IsBoolean()
  notifyBySms?: boolean;
}
