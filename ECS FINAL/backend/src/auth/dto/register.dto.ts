import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsOptional, IsNumber } from 'class-validator';
import { UserRole } from '../../common/enums';

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
}
