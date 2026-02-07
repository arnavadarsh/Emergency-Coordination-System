import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // Use existing database schema
        logging: configService.get('app.nodeEnv') === 'development',
        ssl: {
          rejectUnauthorized: false, // Required for Supabase
        },
      }),
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
