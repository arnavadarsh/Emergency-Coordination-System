import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCaseChatMessages1780018000000 implements MigrationInterface {
  name = 'AddCaseChatMessages1780018000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "case_chat_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "room_id" character varying(80) NOT NULL, "booking_id" uuid, "dispatch_id" uuid, "sender_role" character varying(20) NOT NULL, "sender_name" character varying(80) NOT NULL, "message" character varying(500) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_case_chat_messages_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_case_chat_messages_room_created" ON "case_chat_messages" ("room_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_case_chat_messages_booking" ON "case_chat_messages" ("booking_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_case_chat_messages_dispatch" ON "case_chat_messages" ("dispatch_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "case_chat_messages"`);
  }
}
