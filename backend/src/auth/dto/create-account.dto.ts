import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../common/enums';

/**
 * An account created by an admin — the only way to get a role other than USER.
 *
 * A HOSPITAL account must be tied to its facility, either an existing hospital
 * by `hospitalId` or a new one from `hospitalName`. A DRIVER account is tied to
 * its ambulance by `vehicleNumber`.
 */
export class CreateAccountDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /** Staff accounts can read patient records, so they get a longer minimum. */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phoneNumber?: string;

  @IsEnum(UserRole)
  role: UserRole;

  /** HOSPITAL: link to this existing hospital. */
  @IsUUID()
  @IsOptional()
  hospitalId?: string;

  /** HOSPITAL: or register a new hospital under this name. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  hospitalName?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  /** DRIVER: the ambulance this driver operates. Linked, or registered as pending. */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  vehicleNumber?: string;

  /** DRIVER: driving licence number, shown to patients and hospitals. */
  @IsString()
  @IsOptional()
  @MaxLength(50)
  licenseNumber?: string;
}
