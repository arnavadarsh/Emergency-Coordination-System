import { IsBoolean } from 'class-validator';

/**
 * DTO for updating user status
 */
export class UpdateStatusDto {
  @IsBoolean()
  isActive: boolean;
}
