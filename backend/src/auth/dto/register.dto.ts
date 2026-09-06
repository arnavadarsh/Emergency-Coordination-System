import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  IsEnum,
  IsOptional,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '../../common/enums';
import { MedicalProfileDto } from '../../users/dto/medical-profile.dto';

/**
 * DTO for user registration
 */
export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  // bcrypt only reads the first 72 bytes; anything longer would be silently truncated.
  @MaxLength(72)
  password: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  // ── Role-specific details ────────────────────────────────────────────────
  // The shared sign-up form collects these for hospital and driver accounts.
  // They were previously undeclared, and the global ValidationPipe runs with
  // forbidNonWhitelisted, so every hospital and driver registration was
  // rejected with "property hospitalName should not exist".

  /** HOSPITAL: the facility this login administers. Linked, or created. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  hospitalName?: string;

  /** DRIVER: driving licence number, shown to patients and hospitals. */
  @IsString()
  @IsOptional()
  @MaxLength(50)
  licenseNumber?: string;

  /** DRIVER: the ambulance to link this driver to. */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  vehicleNumber?: string;

  /**
   * Optional Medical Profile captured while creating the patient ID.
   *
   * Entirely optional — registration succeeds with the whole object omitted, or
   * with any subset of its fields. Anything left out can be added later from the
   * Profile section.
   */
  @ValidateNested()
  @Type(() => MedicalProfileDto)
  @IsOptional()
  medicalProfile?: MedicalProfileDto;
}
