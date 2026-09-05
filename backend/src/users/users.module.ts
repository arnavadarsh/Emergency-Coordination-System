import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DriverIdentityService } from './driver-identity.service';
import { MedicalProfileService } from './medical-profile.service';
import { EmergencyContactsService } from './emergency-contacts.service';
import { User, SavedLocation, EmergencyContact } from './entities';

/**
 * Users Module
 * Manages user data and profiles
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, SavedLocation, EmergencyContact])],
  controllers: [UsersController],
  providers: [UsersService, DriverIdentityService, MedicalProfileService, EmergencyContactsService],
  exports: [UsersService, DriverIdentityService, MedicalProfileService, EmergencyContactsService],
})
export class UsersModule {}
