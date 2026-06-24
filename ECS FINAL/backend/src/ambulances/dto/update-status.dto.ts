import { IsEnum } from 'class-validator';
import { AmbulanceStatus } from '../../common/enums';

/**
 * DTO for updating ambulance status
 */
export class UpdateStatusDto {
  @IsEnum(AmbulanceStatus)
  status: AmbulanceStatus;
}
