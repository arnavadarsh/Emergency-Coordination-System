import { IsEmail, IsString, IsOptional, MinLength, IsEnum, IsPhoneNumber, IsDateString } from 'class-validator';
import { UserRole } from '../../common/enums';

/**
 * DTO for creating a new user
 */
export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  address?: string;
}
