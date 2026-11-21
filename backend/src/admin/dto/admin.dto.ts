import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AmbulanceStatus, AmbulanceType, CAPABILITY_STATUSES, HospitalStatus, UserRole } from '../../common/enums';

// ── People ──────────────────────────────────────────────────────────────────

/** Any field left out is left as it is. `null` unlinks a hospital or ambulance. */
export class AdminUpdateUserDto {
  @IsString() @IsOptional() @MaxLength(100)
  firstName?: string;

  @IsString() @IsOptional() @MaxLength(100)
  lastName?: string;

  @IsString() @IsOptional() @MaxLength(20)
  phoneNumber?: string;

  @IsEmail() @IsOptional()
  email?: string;

  @IsEnum(UserRole) @IsOptional()
  role?: UserRole;

  @IsBoolean() @IsOptional()
  isActive?: boolean;

  @ValidateIf(o => o.hospitalId !== null && o.hospitalId !== undefined) @IsUUID()
  hospitalId?: string | null;

  @ValidateIf(o => o.ambulanceId !== null && o.ambulanceId !== undefined) @IsUUID()
  ambulanceId?: string | null;

  /** Drivers only: shown to patients and hospitals as the driver's licence. */
  @ValidateIf(o => o.licenseNumber !== null && o.licenseNumber !== undefined) @IsString() @MaxLength(50)
  licenseNumber?: string | null;
}

export class AdminResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(72)
  password: string;
}

// ── Hospitals ───────────────────────────────────────────────────────────────

export class AdminCreateHospitalDto {
  @IsString() @MinLength(2) @MaxLength(255)
  name: string;

  @IsString() @MinLength(2)
  address: string;

  @IsString() @MaxLength(20)
  phoneNumber: string;

  @IsEmail() @IsOptional()
  email?: string;

  @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  latitude: number;

  @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  longitude: number;

  @Type(() => Number) @IsInt() @Min(0)
  totalBeds: number;

  @Type(() => Number) @IsInt() @Min(0)
  availableBeds: number;

  @IsEnum(HospitalStatus) @IsOptional()
  status?: HospitalStatus;
}

export class AdminUpdateHospitalDto {
  @IsString() @IsOptional() @MinLength(2) @MaxLength(255)
  name?: string;

  @IsString() @IsOptional() @MinLength(2)
  address?: string;

  @IsString() @IsOptional() @MaxLength(20)
  phoneNumber?: string;

  @ValidateIf(o => o.email !== null && o.email !== undefined && o.email !== '') @IsEmail()
  email?: string | null;

  @Type(() => Number) @IsNumber() @IsOptional() @Min(-90) @Max(90)
  latitude?: number;

  @Type(() => Number) @IsNumber() @IsOptional() @Min(-180) @Max(180)
  longitude?: number;

  @Type(() => Number) @IsInt() @IsOptional() @Min(0)
  totalBeds?: number;

  @Type(() => Number) @IsInt() @IsOptional() @Min(0)
  availableBeds?: number;

  @IsEnum(HospitalStatus) @IsOptional()
  status?: HospitalStatus;
}

export class AdminCapabilityDto {
  @IsString() @IsOptional() @MaxLength(100)
  name?: string;

  @IsIn(CAPABILITY_STATUSES) @IsOptional()
  status?: string;

  @Type(() => Number) @IsInt() @IsOptional() @Min(0)
  capacity?: number;

  @Type(() => Number) @IsInt() @IsOptional() @Min(0)
  currentLoad?: number;
}

// ── Ambulances ──────────────────────────────────────────────────────────────

export class AdminCreateAmbulanceDto {
  @IsString() @MinLength(2) @MaxLength(20)
  vehicleNumber: string;

  @IsEnum(AmbulanceType)
  vehicleType: AmbulanceType;

  @IsEnum(AmbulanceStatus) @IsOptional()
  status?: AmbulanceStatus;

  @Type(() => Number) @IsNumber() @IsOptional() @Min(-90) @Max(90)
  latitude?: number;

  @Type(() => Number) @IsNumber() @IsOptional() @Min(-180) @Max(180)
  longitude?: number;
}

export class AdminUpdateAmbulanceDto {
  @IsString() @IsOptional() @MinLength(2) @MaxLength(20)
  vehicleNumber?: string;

  @IsEnum(AmbulanceType) @IsOptional()
  vehicleType?: AmbulanceType;

  @Type(() => Number) @IsNumber() @IsOptional() @Min(-90) @Max(90)
  latitude?: number;

  @Type(() => Number) @IsNumber() @IsOptional() @Min(-180) @Max(180)
  longitude?: number;
}

// ── Operations ──────────────────────────────────────────────────────────────

export class AdminDispatchDto {
  /** A specific ambulance; leave out for the nearest available one. */
  @IsUUID() @IsOptional()
  ambulanceId?: string;
}

export class AdminReassignDto {
  @IsUUID()
  ambulanceId: string;
}

export class AdminRerouteDto {
  @IsUUID()
  hospitalId: string;
}

export const ADMIN_SETTABLE_DISPATCH_STATUSES = [
  'DISPATCHED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_HOSPITAL', 'AT_HOSPITAL', 'COMPLETED', 'CANCELLED',
];

export class AdminDispatchStatusDto {
  @IsIn(ADMIN_SETTABLE_DISPATCH_STATUSES)
  status: string;
}

// ── System ──────────────────────────────────────────────────────────────────

export class AdminSettingsDto {
  @IsBoolean() @IsOptional()
  autoDispatchEnabled?: boolean;

  @Type(() => Number) @IsInt() @IsOptional() @Min(5) @Max(1440)
  dispatchRetryMaxAgeMinutes?: number;

  @IsBoolean() @IsOptional()
  patientSignupEnabled?: boolean;

  @IsBoolean() @IsOptional()
  contactSmsEnabled?: boolean;
}

export class AdminBroadcastDto {
  @IsString() @MinLength(1) @MaxLength(500)
  message: string;

  @IsIn(['ALL', UserRole.USER, UserRole.DRIVER, UserRole.HOSPITAL, UserRole.ADMIN])
  audience: UserRole | 'ALL';

  @IsIn(['info', 'success', 'warning', 'danger']) @IsOptional()
  tone?: 'info' | 'success' | 'warning' | 'danger';
}

export class AdminTestSmsDto {
  @IsString() @MinLength(6) @MaxLength(20)
  phoneNumber: string;
}

export class AdminAuditQueryDto {
  @Type(() => Number) @IsInt() @IsOptional() @Min(1) @Max(500)
  limit?: number;

  @Type(() => Number) @IsInt() @IsOptional() @Min(0)
  offset?: number;

  @IsString() @IsOptional() @MaxLength(50)
  action?: string;

  @IsString() @IsOptional() @MaxLength(50)
  entityType?: string;

  @IsUUID() @IsOptional()
  actorId?: string;
}
