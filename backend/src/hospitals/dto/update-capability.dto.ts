import { IsEnum, IsString, IsOptional, IsInt, Min } from 'class-validator';
import { HospitalCapability } from '../../common/enums';

/**
 * DTO for updating hospital capability status
 */
export class UpdateCapabilityDto {
  @IsEnum(HospitalCapability)
  capabilityType: HospitalCapability;

  @IsOptional()
  @IsString()
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
