import { IsString, MaxLength } from 'class-validator';

/** POST /api/chat/message/:messageId/translate body. */
export class TranslateDto {
  /** Target language name or code, e.g. "Hindi" / "hi". */
  @IsString()
  @MaxLength(40)
  lang: string;
}
