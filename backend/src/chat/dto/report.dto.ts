import { IsString, IsOptional, MaxLength } from 'class-validator';

/** POST /api/chat/:bookingId/report body. */
export class ReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
