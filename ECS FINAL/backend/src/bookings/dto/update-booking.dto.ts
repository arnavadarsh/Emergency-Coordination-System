import { IsEnum, IsString, IsOptional } from 'class-validator';
import { BookingStatus } from '../../common/enums';

/**
 * DTO for updating booking
 */
export class UpdateBookingDto {
  @IsEnum(BookingStatus)
  @IsOptional()
  status?: BookingStatus;

  @IsString()
  @IsOptional()
  description?: string;
}
