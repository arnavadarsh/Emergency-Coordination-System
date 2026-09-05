import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body for the contact-side alert switch on the public tracking page.
 * Omitting the flag means "stop messaging me" — the common case.
 */
export class OptOutDto {
  @IsOptional()
  @IsBoolean()
  optOut?: boolean;
}
