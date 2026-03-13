import { IsEnum } from 'class-validator';
import { HospitalStatus } from '../../common/enums';

/**
 * DTO for updating hospital service status
 */
export class UpdateStatusDto {
  @IsEnum(HospitalStatus)
  serviceStatus: HospitalStatus;
}
