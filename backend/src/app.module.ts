import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import smsConfig from './config/sms.config';
import trackingConfig from './config/tracking.config';
import geminiConfig from './config/gemini.config';
import rateLimitConfig from './config/rate-limit.config';
import travelTimeConfig from './config/travel-time.config';
import supabaseConfig from './config/supabase.config';
import { isSqlite } from './config/env';

// Module imports
import { AuthModule } from './auth/auth.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { AmbulancesModule } from './ambulances/ambulances.module';
import { BookingsModule } from './bookings/bookings.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { TriageController } from './triage/triage.controller';
import { TriageModule } from './triage/triage.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TrackingModule } from './tracking/tracking.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { TravelTimeModule } from './common/travel-time/travel-time.module';
import { HealthModule } from './health/health.module';

/**
 * Main Application Module
 * Wires together all modules and configuration
 */
@Module({
  imports: [
    // Event Emitter
    EventEmitterModule.forRoot(),

    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        smsConfig,
        trackingConfig,
        geminiConfig,
        rateLimitConfig,
        travelTimeConfig,
        supabaseConfig,
      ],
    }),

    // Database - supports both SQLite (local) and PostgreSQL (Supabase)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        if (isSqlite()) {
          // SQLITE_DB_PATH lets a throwaway database be used for a test run
          // without touching the checked-in local one.
          const database = process.env.SQLITE_DB_PATH || __dirname + '/../ecs_local.db';
          console.log(`Using local SQLite database: ${database}`);
          return {
            type: 'better-sqlite3' as any,
            database,
            entities: [__dirname + '/**/*.entity{.ts,.js}'],
            synchronize: true,
            logging: false,
          };
        }

        // Supabase Postgres — the single home for every persisted row.
        const url = configService.get<string>('database.url');
        const connection = url
          ? { url }
          : {
              host: configService.get('database.host'),
              port: configService.get('database.port'),
              username: configService.get('database.username'),
              password: configService.get('database.password'),
              database: configService.get('database.database'),
            };

        console.log(
          url
            ? 'Using Postgres via DATABASE_URL (Supabase)'
            : `Using Postgres at ${configService.get('database.host')}:${configService.get('database.port')}`,
        );

        return {
          type: 'postgres',
          ...connection,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          // Schema changes go through migrations, never an automatic sync: a
          // synchronize against a live Supabase project can drop columns.
          synchronize: false,
          migrationsRun: configService.get<boolean>('database.migrationsRun', false),
          logging: configService.get('app.nodeEnv') === 'development',
          ssl: configService.get('database.ssl'),
          extra: {
            connectionTimeoutMillis: 15000,
            // Supabase's pooler caps connections; stay well inside it so a
            // restart or a second instance cannot lock the project out.
            max: parseInt(process.env.DB_POOL_MAX || '10', 10),
          },
        };
      },
      inject: [ConfigService],
    }),

    // Request ceilings for paid third-party APIs (global — shared counters)
    RateLimitModule,

    // Road travel times behind hospital selection (global — shared cache/budget)
    TravelTimeModule,

    // Outbound messaging (global — SMS is used across features)
    NotificationsModule,

    // Feature modules
    AuthModule,
    UploadsModule,
    UsersModule,
    HospitalsModule,
    AmbulancesModule,
    BookingsModule,
    DispatchModule,
    TriageModule,
    RealtimeModule,
    AuditModule,
    DashboardModule,
    TrackingModule,
    HealthModule,
  ],
})
export class AppModule {}
