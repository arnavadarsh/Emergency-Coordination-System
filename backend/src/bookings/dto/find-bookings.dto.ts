import { IsString, IsOptional, IsEnum } from 'class-validator';
import { BookingStatus } from '../../common/enums';

export class FindBookingsDto {
  @IsEnum(BookingStatus)
  @IsOptional()
  status?: BookingStatus;

  @IsString()
  @IsOptional()
  userId?: string;
}
