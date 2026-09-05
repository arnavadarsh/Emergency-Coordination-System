import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfilePhotoUrl1780019000000 implements MigrationInterface {
  name = 'AddProfilePhotoUrl1780019000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_photo_url" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "profile_photo_url"`);
  }
}
