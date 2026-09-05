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
