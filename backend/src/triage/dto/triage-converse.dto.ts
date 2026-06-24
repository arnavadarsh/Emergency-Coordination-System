import {
  IsArray,
  IsIn,
  IsString,
  IsOptional,
  ValidateNested,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/** One turn in the running triage conversation, sent from the client. */
export class ConverseMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  text: string;
}

/** POST /api/triage/converse request body. */
export class TriageConverseDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ConverseMessageDto)
  messages: ConverseMessageDto[];

  /** Language the assistant should reply in (e.g. "Hindi"). Defaults to English.
   *  Answer values stay canonical English regardless. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  lang?: string;
}
