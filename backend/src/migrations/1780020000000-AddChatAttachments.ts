import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatAttachments1780020000000 implements MigrationInterface {
  name = 'AddChatAttachments1780020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "case_chat_messages" ADD COLUMN IF NOT EXISTS "attachment_url" text`);
    await queryRunner.query(`ALTER TABLE "case_chat_messages" ADD COLUMN IF NOT EXISTS "attachment_type" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "case_chat_messages" ADD COLUMN IF NOT EXISTS "attachment_name" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "case_chat_messages" ADD COLUMN IF NOT EXISTS "attachment_size" integer`);
    await queryRunner.query(`ALTER TABLE "case_chat_messages" ADD COLUMN IF NOT EXISTS "attachment_width" integer`);
    await queryRunner.query(`ALTER TABLE "case_chat_messages" ADD COLUMN IF NOT EXISTS "attachment_height" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['url', 'type', 'name', 'size', 'width', 'height']) {
      await queryRunner.query(`ALTER TABLE "case_chat_messages" DROP COLUMN IF EXISTS "attachment_${column}"`);
    }
  }
}
