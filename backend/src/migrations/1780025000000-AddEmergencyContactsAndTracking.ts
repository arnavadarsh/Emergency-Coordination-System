import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Shareable ambulance tracking + emergency contact notification.
 *
 *   emergency_contacts     — who a patient wants told when help is dispatched
 *   tracking_links         — one private, login-free link per case
 *   tracking_notifications — the once-per-case record of who was already texted
 *
 * Primary keys default to gen_random_uuid(), which is built into Postgres 13+
 * and needs no extension — the same default the users and bookings tables use.
 */
export class AddEmergencyContactsAndTracking1780025000000 implements MigrationInterface {
    name = 'AddEmergencyContactsAndTracking1780025000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "emergency_contacts" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "user_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "phone_number" character varying(20) NOT NULL,
                "relation" character varying(40) NOT NULL,
                "notify_by_sms" boolean NOT NULL DEFAULT true,
                "opted_out_at" TIMESTAMP,
                "opt_out_token" character varying(64) NOT NULL,
                "last_notified_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_emergency_contacts" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_emergency_contacts_opt_out_token" UNIQUE ("opt_out_token"),
                CONSTRAINT "FK_emergency_contacts_user" FOREIGN KEY ("user_id")
                    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_emergency_contacts_user_id"
            ON "emergency_contacts" ("user_id")
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "tracking_links" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "token" character varying(64) NOT NULL,
                "booking_id" uuid NOT NULL,
                "dispatch_id" uuid,
                "expires_at" TIMESTAMP NOT NULL,
                "closed_at" TIMESTAMP,
                "close_reason" character varying(20),
                "view_count" integer NOT NULL DEFAULT 0,
                "last_viewed_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_tracking_links" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_tracking_links_token" UNIQUE ("token"),
                -- One link per case for its whole life, so a link already texted
                -- to the family is never replaced by a second dispatch event.
                CONSTRAINT "UQ_tracking_links_booking" UNIQUE ("booking_id"),
                CONSTRAINT "FK_tracking_links_booking" FOREIGN KEY ("booking_id")
                    REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "tracking_notifications" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "booking_id" uuid NOT NULL,
                "contact_id" uuid NOT NULL,
                "tracking_link_id" uuid,
                "phone_number" character varying(20) NOT NULL,
                "channel" character varying(10) NOT NULL DEFAULT 'SMS',
                "status" character varying(12) NOT NULL DEFAULT 'QUEUED',
                "provider" character varying(20),
                "provider_message_id" character varying(120),
                "error" text,
                "sent_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_tracking_notifications" PRIMARY KEY ("id"),
                -- Enforces "each contact is messaged once per case", even if two
                -- dispatch events for the same booking race each other.
                CONSTRAINT "UQ_tracking_notifications_booking_contact" UNIQUE ("booking_id", "contact_id"),
                CONSTRAINT "FK_tracking_notifications_booking" FOREIGN KEY ("booking_id")
                    REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        // No FK to emergency_contacts on purpose: deleting a contact must not
        // erase the record that they were already alerted about a live case.
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tracking_notifications_booking_id"
            ON "tracking_notifications" ("booking_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tracking_notifications_booking_id"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "tracking_notifications"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "tracking_links"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_emergency_contacts_user_id"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "emergency_contacts"`);
    }
}
