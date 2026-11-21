import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  IsIn,
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

  /**
   * Public sign-up only ever creates a patient account. The field is still
   * accepted so a client sending `role: "USER"` keeps working, but any other
   * value is refused: a self-chosen HOSPITAL or DRIVER role used to link the new
   * login to whichever hospital or ambulance matched the name typed in, and an
   * ADMIN role handed out the whole system. Staff accounts are created by an
   * admin — see POST /auth/accounts.
   */
  @IsIn([UserRole.USER], {
    message: 'Sign-up creates patient accounts only. Hospital, driver and admin accounts are created by an administrator.',
  })
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
