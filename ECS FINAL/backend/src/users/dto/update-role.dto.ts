import { IsEnum } from 'class-validator';
import { UserRole } from '../../common/enums';

/**
 * DTO for updating user role
 */
export class UpdateRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
