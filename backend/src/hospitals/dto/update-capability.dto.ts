import { IsEnum, IsIn, IsOptional, IsInt, Min } from 'class-validator';
import { CAPABILITY_STATUSES, HospitalCapability } from '../../common/enums';

/**
 * DTO for updating hospital capability status
 */
export class UpdateCapabilityDto {
  @IsEnum(HospitalCapability)
  capabilityType: HospitalCapability;

  @IsOptional()
  @IsIn(CAPABILITY_STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentLoad?: number;
}
