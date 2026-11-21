import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { HospitalCapability } from '../hospitals/entities/hospital-capability.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { TrackingLink } from '../tracking/entities/tracking-link.entity';
import { CaseChatMessage } from '../realtime/entities/case-chat-message.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { HospitalsModule } from '../hospitals/hospitals.module';
import { AmbulancesModule } from '../ambulances/ambulances.module';
import { TrackingModule } from '../tracking/tracking.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { HealthModule } from '../health/health.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersService } from './admin-users.service';
import { AdminFleetService } from './admin-fleet.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminSystemService } from './admin-system.service';
import {
  AdminFleetController,
  AdminOperationsController,
  AdminSystemController,
  AdminUsersController,
} from './admin.controller';

/**
 * The admin control centre: every control over people, fleet, live cases and
 * the system itself, under /api/admin, admin-only and fully audited. Nothing
 * imports this module back, so it can depend on all the others.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Hospital, HospitalCapability, Ambulance, Booking, Dispatch, TrackingLink, CaseChatMessage, AuditLog]),
    UsersModule,
    AuditModule,
    BookingsModule,
    DispatchModule,
    HospitalsModule,
    AmbulancesModule,
    TrackingModule,
    RealtimeModule,
    HealthModule,
  ],
  controllers: [AdminUsersController, AdminFleetController, AdminOperationsController, AdminSystemController],
  providers: [AdminAuditService, AdminUsersService, AdminFleetService, AdminOperationsService, AdminSystemService],
})
export class AdminModule {}
