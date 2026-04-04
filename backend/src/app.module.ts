import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';

// Module imports
import { AuthModule } from './auth/auth.module';
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
      load: [appConfig, databaseConfig, jwtConfig],
    }),

    // Database - supports both SQLite (local) and PostgreSQL (Supabase)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const useSqlite = process.env.USE_SQLITE === 'true';

        if (useSqlite) {
          console.log('Using local SQLite database');
          return {
            type: 'better-sqlite3' as any,
            database: __dirname + '/../ecs_local.db',
            entities: [__dirname + '/**/*.entity{.ts,.js}'],
            synchronize: true,
            logging: false,
          };
        }

        return {
          type: 'postgres',
          host: configService.get('database.host'),
          port: configService.get('database.port'),
          username: configService.get('database.username'),
          password: configService.get('database.password'),
          database: configService.get('database.database'),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: false,
          logging: configService.get('app.nodeEnv') === 'development',
          ssl: { rejectUnauthorized: false },
          extra: { connectionTimeoutMillis: 15000 },
        };
      },
      inject: [ConfigService],
    }),

    // Feature modules
    AuthModule,
    UsersModule,
    HospitalsModule,
    AmbulancesModule,
    BookingsModule,
    DispatchModule,
    TriageModule,
    RealtimeModule,
    AuditModule,
    DashboardModule,
  ],
})
export class AppModule {}
