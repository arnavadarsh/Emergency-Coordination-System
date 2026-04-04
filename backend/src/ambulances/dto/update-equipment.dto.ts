import { IsObject } from 'class-validator';

/**
 * DTO for updating ambulance equipment
 */
export class UpdateEquipmentDto {
  @IsObject()
  equipmentList: any;
}
