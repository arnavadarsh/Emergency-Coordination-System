import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial Migration
 * Creates all core tables for Phase 0
 */
export class InitialMigration1706400000000 implements MigrationInterface {
  name = 'InitialMigration1706400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enums
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM ('USER', 'DRIVER', 'HOSPITAL', 'ADMIN');
    `);

    await queryRunner.query(`
      CREATE TYPE "booking_status_enum" AS ENUM ('CREATED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
    `);

    await queryRunner.query(`
      CREATE TYPE "hospital_status_enum" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');
    `);

    await queryRunner.query(`
      CREATE TYPE "hospital_capability_enum" AS ENUM ('ER', 'ICU', 'CARDIAC', 'TRAUMA', 'NEURO', 'OB');
    `);

    await queryRunner.query(`
      CREATE TYPE "severity_level_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
    `);

    await queryRunner.query(`
      CREATE TYPE "ambulance_status_enum" AS ENUM ('AVAILABLE', 'BUSY', 'MAINTENANCE', 'OFFLINE');
    `);

    // Users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" VARCHAR(255) NOT NULL UNIQUE,
        "passwordHash" VARCHAR(255) NOT NULL,
        "role" user_role_enum NOT NULL DEFAULT 'USER',
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "lastLoginAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_email" ON "users" ("email");
    `);

    // User profiles table
    await queryRunner.query(`
      CREATE TABLE "user_profiles" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL,
        "firstName" VARCHAR(100) NOT NULL,
        "lastName" VARCHAR(100) NOT NULL,
        "phoneNumber" VARCHAR(20),
        "address" TEXT,
        "dateOfBirth" DATE,
        "emergencyContact" VARCHAR(50),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_user_profile_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_user_profiles_userId" ON "user_profiles" ("userId");
    `);

    // Hospitals table
    await queryRunner.query(`
      CREATE TABLE "hospitals" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" VARCHAR(255) NOT NULL,
        "address" TEXT NOT NULL,
        "phoneNumber" VARCHAR(20) NOT NULL,
        "email" VARCHAR(255),
        "latitude" DECIMAL(10, 7) NOT NULL,
        "longitude" DECIMAL(10, 7) NOT NULL,
        "status" hospital_status_enum NOT NULL DEFAULT 'ACTIVE',
        "totalBeds" INTEGER NOT NULL DEFAULT 0,
        "availableBeds" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_hospitals_status" ON "hospitals" ("status");
    `);

    // Hospital capabilities table
    await queryRunner.query(`
      CREATE TABLE "hospital_capabilities" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "hospitalId" UUID NOT NULL,
        "capability" hospital_capability_enum NOT NULL,
        "isAvailable" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_hospital_capability_hospital" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_hospital_capabilities_hospital_capability" ON "hospital_capabilities" ("hospitalId", "capability");
    `);

    // Ambulances table
    await queryRunner.query(`
      CREATE TABLE "ambulances" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "vehicleNumber" VARCHAR(50) NOT NULL UNIQUE,
        "vehicleModel" VARCHAR(100) NOT NULL,
        "status" ambulance_status_enum NOT NULL DEFAULT 'AVAILABLE',
        "driverId" UUID,
        "currentLatitude" DECIMAL(10, 7),
        "currentLongitude" DECIMAL(10, 7),
        "lastLocationUpdate" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_ambulance_driver" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_ambulances_status" ON "ambulances" ("status");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_ambulances_driverId" ON "ambulances" ("driverId");
    `);

    // Bookings table
    await queryRunner.query(`
      CREATE TABLE "bookings" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL,
        "status" booking_status_enum NOT NULL DEFAULT 'CREATED',
        "severity" severity_level_enum,
        "description" TEXT,
        "pickupLatitude" DECIMAL(10, 7) NOT NULL,
        "pickupLongitude" DECIMAL(10, 7) NOT NULL,
        "pickupAddress" TEXT,
        "destinationLatitude" DECIMAL(10, 7),
        "destinationLongitude" DECIMAL(10, 7),
        "destinationAddress" TEXT,
        "completedAt" TIMESTAMP,
        "cancelledAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_booking_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_bookings_userId" ON "bookings" ("userId");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_bookings_status" ON "bookings" ("status");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_bookings_createdAt" ON "bookings" ("createdAt");
    `);

    // Dispatches table
    await queryRunner.query(`
      CREATE TABLE "dispatches" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "bookingId" UUID NOT NULL UNIQUE,
        "ambulanceId" UUID NOT NULL,
        "hospitalId" UUID,
        "dispatchedAt" TIMESTAMP,
        "arrivedAtPickupAt" TIMESTAMP,
        "arrivedAtHospitalAt" TIMESTAMP,
        "estimatedTimeMinutes" INTEGER,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_dispatch_booking" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_dispatch_ambulance" FOREIGN KEY ("ambulanceId") REFERENCES "ambulances"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_dispatch_hospital" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_dispatches_bookingId" ON "dispatches" ("bookingId");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_dispatches_ambulanceId" ON "dispatches" ("ambulanceId");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_dispatches_hospitalId" ON "dispatches" ("hospitalId");
    `);

    // Audit logs table
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "entityType" VARCHAR(100) NOT NULL,
        "entityId" UUID NOT NULL,
        "action" VARCHAR(50) NOT NULL,
        "before" JSONB,
        "after" JSONB,
        "actorId" UUID,
        "ipAddress" VARCHAR(50),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_audit_logs_entityType_entityId" ON "audit_logs" ("entityType", "entityId");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_audit_logs_actorId" ON "audit_logs" ("actorId");
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_audit_logs_createdAt" ON "audit_logs" ("createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "dispatches"`);
    await queryRunner.query(`DROP TABLE "bookings"`);
    await queryRunner.query(`DROP TABLE "ambulances"`);
    await queryRunner.query(`DROP TABLE "hospital_capabilities"`);
    await queryRunner.query(`DROP TABLE "hospitals"`);
    await queryRunner.query(`DROP TABLE "user_profiles"`);
    await queryRunner.query(`DROP TABLE "users"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE "ambulance_status_enum"`);
    await queryRunner.query(`DROP TYPE "severity_level_enum"`);
    await queryRunner.query(`DROP TYPE "hospital_capability_enum"`);
    await queryRunner.query(`DROP TYPE "hospital_status_enum"`);
    await queryRunner.query(`DROP TYPE "booking_status_enum"`);
    await queryRunner.query(`DROP TYPE "user_role_enum"`);
  }
}
