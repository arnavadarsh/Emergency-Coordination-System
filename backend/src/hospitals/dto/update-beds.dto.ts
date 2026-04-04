import { IsInt, Min } from 'class-validator';

/**
 * DTO for updating hospital bed availability
 */
export class UpdateBedsDto {
  @IsInt()
  @Min(0)
  availableBeds: number;
}
