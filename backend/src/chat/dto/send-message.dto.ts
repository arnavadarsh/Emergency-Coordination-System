import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';

/** POST /api/chat/:bookingId/messages body. */
export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsIn(['image', 'audio'])
  mediaType?: 'image' | 'audio';

  /** base64 data URL for the attachment (image/voice note). */
  @IsOptional()
  @IsString()
  @MaxLength(16_000_000)
  mediaData?: string;
}
