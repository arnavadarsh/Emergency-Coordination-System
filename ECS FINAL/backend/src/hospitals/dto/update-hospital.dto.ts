import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { HospitalStatus } from '../../common/enums';

/**
 * DTO for updating hospital information
 */
export class UpdateHospitalDto {
  @IsOptional()
  @IsEnum(HospitalStatus)
  serviceStatus?: HospitalStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  availableBeds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalBeds?: number;
}
