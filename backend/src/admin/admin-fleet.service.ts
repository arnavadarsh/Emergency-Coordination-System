import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { HospitalCapability } from '../hospitals/entities/hospital-capability.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { User } from '../users/entities/user.entity';
import { HospitalsService } from '../hospitals/hospitals.service';
import { AmbulancesService } from '../ambulances/ambulances.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AmbulanceStatus, HospitalCapability as CapabilityType, HospitalStatus, UserRole } from '../common/enums';
import { ACTIVE_DISPATCH_STATUSES } from '../dispatch/dispatch-status';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminCapabilityDto,
  AdminCreateAmbulanceDto,
  AdminCreateHospitalDto,
  AdminUpdateAmbulanceDto,
  AdminUpdateHospitalDto,
} from './dto/admin.dto';

type Actor = { id: string };

const CAPABILITY_NAMES: Record<CapabilityType, string> = {
  [CapabilityType.ER]: 'Emergency Room',
  [CapabilityType.ICU]: 'Intensive Care',
  [CapabilityType.CARDIAC]: 'Cardiac Care',
  [CapabilityType.TRAUMA]: 'Trauma Centre',
  [CapabilityType.NEURO]: 'Neurology',
  [CapabilityType.OB]: 'Obstetrics',
};

/**
 * Hospitals and ambulances: create, edit, retire. Status and bed changes go
 * through HospitalsService so live ambulances are rerouted exactly as when a
 * hospital changes them itself.
 */
@Injectable()
export class AdminFleetService {
  constructor(
    @InjectRepository(Hospital) private readonly hospitalRepository: Repository<Hospital>,
    @InjectRepository(HospitalCapability) private readonly capabilityRepository: Repository<HospitalCapability>,
    @InjectRepository(Ambulance) private readonly ambulanceRepository: Repository<Ambulance>,
    @InjectRepository(Dispatch) private readonly dispatchRepository: Repository<Dispatch>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly hospitalsService: HospitalsService,
    private readonly ambulancesService: AmbulancesService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly audit: AdminAuditService,
  ) {}

  // ── Hospitals ─────────────────────────────────────────────────────────────

  /** Every hospital with its capabilities, staff logins and incoming ambulances. */
  async listHospitals() {
    const [hospitals, staff, incoming] = await Promise.all([
      this.hospitalRepository.find({ relations: ['capabilities'], order: { name: 'ASC' } }),
      this.userRepository.find({ where: { role: UserRole.HOSPITAL } }),
      this.dispatchRepository.find({ where: { status: In(ACTIVE_DISPATCH_STATUSES) } }),
    ]);
    return hospitals.map(hospital => ({
      ...hospital,
      latitude: Number(hospital.latitude),
      longitude: Number(hospital.longitude),
      staff: staff
        .filter(user => user.hospitalId === hospital.id)
        .map(user => ({ id: user.id, email: user.email, isActive: user.isActive })),
      incomingAmbulances: incoming.filter(dispatch => dispatch.hospitalId === hospital.id).length,
    }));
  }

  private async loadHospital(id: string): Promise<Hospital> {
    const hospital = await this.hospitalRepository.findOne({ where: { id }, relations: ['capabilities'] });
    if (!hospital) throw new NotFoundException('Hospital not found');
    return hospital;
  }

  async createHospital(actor: Actor, dto: AdminCreateHospitalDto) {
    if (dto.availableBeds > dto.totalBeds) {
      throw new BadRequestException('Available beds cannot be more than total beds');
    }
    const saved = await this.hospitalRepository.save(
      this.hospitalRepository.create({
        name: dto.name.trim(),
        address: dto.address.trim(),
        phoneNumber: dto.phoneNumber,
        email: dto.email,
        latitude: dto.latitude,
        longitude: dto.longitude,
        totalBeds: dto.totalBeds,
        availableBeds: dto.availableBeds,
        status: dto.status ?? HospitalStatus.ACCEPTING,
      }),
    );
    await this.audit.record(actor.id, 'HOSPITAL_CREATED', 'Hospital', saved.id, { after: { name: saved.name } });
    return this.loadHospital(saved.id);
  }

  async updateHospital(actor: Actor, id: string, dto: AdminUpdateHospitalDto) {
    const hospital = await this.loadHospital(id);
    const before = {
      name: hospital.name, address: hospital.address, phoneNumber: hospital.phoneNumber, email: hospital.email,
      latitude: Number(hospital.latitude), longitude: Number(hospital.longitude),
      totalBeds: hospital.totalBeds, availableBeds: hospital.availableBeds, status: hospital.status,
    };

    const totalBeds = dto.totalBeds ?? hospital.totalBeds;
    const availableBeds = dto.availableBeds ?? hospital.availableBeds;
    if (availableBeds > totalBeds) {
      throw new BadRequestException('Available beds cannot be more than total beds');
    }

    const details: Partial<Hospital> = {};
    if (dto.name !== undefined) details.name = dto.name.trim();
    if (dto.address !== undefined) details.address = dto.address.trim();
    if (dto.phoneNumber !== undefined) details.phoneNumber = dto.phoneNumber;
    if (dto.email !== undefined) details.email = dto.email || (null as any);
    if (dto.latitude !== undefined) details.latitude = dto.latitude;
    if (dto.longitude !== undefined) details.longitude = dto.longitude;
    if (dto.totalBeds !== undefined) details.totalBeds = dto.totalBeds;
    if (Object.keys(details).length > 0) await this.hospitalRepository.update(id, details);

    // These two reroute ambulances already heading here when the hospital closes or fills up.
    if (dto.availableBeds !== undefined && dto.availableBeds !== hospital.availableBeds) {
      await this.hospitalsService.updateBeds(id, dto.availableBeds);
    }
    if (dto.status !== undefined && dto.status !== hospital.status) {
      await this.hospitalsService.updateStatus(id, dto.status);
    }

    await this.audit.record(actor.id, 'HOSPITAL_UPDATED', 'Hospital', id, { before, changes: dto });
    return this.loadHospital(id);
  }

  /**
   * Remove a hospital that has never received a patient. One with dispatch
   * history is kept for the record — set it to DIVERT to stop new patients.
   */
  async deleteHospital(actor: Actor, id: string) {
    const hospital = await this.loadHospital(id);
    const dispatches = await this.dispatchRepository.count({ where: { hospitalId: id } });
    if (dispatches > 0) {
      throw new ConflictException(
        `${hospital.name} has ${dispatches} dispatch record(s) and is kept for the case history. Set it to DIVERT to stop new patients.`,
      );
    }

    const staff = await this.userRepository.find({ where: { hospitalId: id } });
    if (staff.length > 0) {
      await this.userRepository.update({ hospitalId: id }, { hospitalId: null as any });
      staff.forEach(user => this.realtimeGateway.disconnectUser(user.id));
    }
    await this.capabilityRepository.delete({ hospitalId: id });
    await this.hospitalRepository.delete(id);

    await this.audit.record(actor.id, 'HOSPITAL_DELETED', 'Hospital', id, {
      before: { name: hospital.name, unlinkedStaff: staff.map(user => user.email) },
    });
    return { message: `${hospital.name} was removed.`, unlinkedStaff: staff.map(user => user.email) };
  }

  /** Add a capability, or change one, with the same reroute rules as a hospital's own edit. */
  async upsertCapability(actor: Actor, hospitalId: string, type: CapabilityType, dto: AdminCapabilityDto) {
    if (!Object.values(CapabilityType).includes(type)) {
      throw new BadRequestException(`Unknown capability "${type}"`);
    }
    await this.loadHospital(hospitalId);

    let capability = await this.capabilityRepository.findOne({ where: { hospitalId, capabilityType: type } });
    if (!capability) {
      capability = await this.capabilityRepository.save(
        this.capabilityRepository.create({
          hospitalId,
          capabilityType: type,
          name: dto.name ?? CAPABILITY_NAMES[type],
          status: dto.status ?? 'ACCEPTING',
          capacity: dto.capacity ?? 0,
          currentLoad: dto.currentLoad ?? 0,
        }),
      );
    } else if (dto.name) {
      await this.capabilityRepository.update(capability.id, { name: dto.name });
    }

    const saved = await this.hospitalsService.updateCapability(hospitalId, {
      capabilityType: type,
      status: dto.status,
      capacity: dto.capacity,
      currentLoad: dto.currentLoad,
    });
    await this.audit.record(actor.id, 'CAPABILITY_UPDATED', 'Hospital', hospitalId, { changes: { type, ...dto } });
    return saved;
  }

  async removeCapability(actor: Actor, hospitalId: string, type: CapabilityType) {
    const result = await this.capabilityRepository.delete({ hospitalId, capabilityType: type });
    if (!result.affected) throw new NotFoundException(`This hospital has no ${type} capability`);
    await this.audit.record(actor.id, 'CAPABILITY_REMOVED', 'Hospital', hospitalId, { changes: { type } });
    return { message: `${type} removed.` };
  }

  // ── Ambulances ────────────────────────────────────────────────────────────

  /** Every ambulance with the drivers linked to it and the trip it is on, if any. */
  async listAmbulances() {
    const [ambulances, drivers, active] = await Promise.all([
      this.ambulanceRepository.find({ order: { vehicleNumber: 'ASC' } }),
      this.userRepository.find({ where: { role: UserRole.DRIVER } }),
      this.dispatchRepository.find({ where: { status: In(ACTIVE_DISPATCH_STATUSES) } }),
    ]);
    return ambulances.map(ambulance => {
      const trip = active.find(dispatch => dispatch.ambulanceId === ambulance.id);
      return {
        ...ambulance,
        currentLatitude: ambulance.currentLatitude != null ? Number(ambulance.currentLatitude) : null,
        currentLongitude: ambulance.currentLongitude != null ? Number(ambulance.currentLongitude) : null,
        drivers: drivers
          .filter(user => user.ambulanceId === ambulance.id)
          .map(user => ({ id: user.id, email: user.email, name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(), isActive: user.isActive })),
        activeTrip: trip ? { dispatchId: trip.id, bookingId: trip.bookingId, status: trip.status } : null,
      };
    });
  }

  private async loadAmbulance(id: string): Promise<Ambulance> {
    const ambulance = await this.ambulanceRepository.findOne({ where: { id } });
    if (!ambulance) throw new NotFoundException('Ambulance not found');
    return ambulance;
  }

  private async assertVehicleNumberFree(vehicleNumber: string, exceptId?: string) {
    const existing = await this.ambulanceRepository.findOne({ where: { vehicleNumber } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`An ambulance with number ${vehicleNumber} already exists`);
    }
  }

  async createAmbulance(actor: Actor, dto: AdminCreateAmbulanceDto) {
    const vehicleNumber = dto.vehicleNumber.trim().toUpperCase();
    await this.assertVehicleNumberFree(vehicleNumber);
    const saved = await this.ambulanceRepository.save(
      this.ambulanceRepository.create({
        vehicleNumber,
        vehicleType: dto.vehicleType,
        // Created by an admin, so no verification step — but off duty until someone says otherwise.
        status: dto.status ?? AmbulanceStatus.OFFLINE,
        currentLatitude: dto.latitude,
        currentLongitude: dto.longitude,
        lastLocationUpdate: dto.latitude != null && dto.longitude != null ? new Date() : undefined,
      }),
    );
    if (saved.status === AmbulanceStatus.AVAILABLE) this.eventEmitter.emit('ambulance.available', saved.id);
    await this.audit.record(actor.id, 'AMBULANCE_CREATED', 'Ambulance', saved.id, { after: { vehicleNumber, status: saved.status } });
    return saved;
  }

  async updateAmbulance(actor: Actor, id: string, dto: AdminUpdateAmbulanceDto) {
    const ambulance = await this.loadAmbulance(id);
    const changes: Partial<Ambulance> = {};
    if (dto.vehicleNumber !== undefined) {
      const vehicleNumber = dto.vehicleNumber.trim().toUpperCase();
      if (vehicleNumber !== ambulance.vehicleNumber) {
        await this.assertVehicleNumberFree(vehicleNumber, id);
        changes.vehicleNumber = vehicleNumber;
      }
    }
    if (dto.vehicleType !== undefined) changes.vehicleType = dto.vehicleType;
    if (Object.keys(changes).length > 0) await this.ambulanceRepository.update(id, changes);

    // Through the normal path, so maps and the case's patient see the unit move.
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      await this.ambulancesService.updateLocation(id, dto.latitude, dto.longitude);
    }

    await this.audit.record(actor.id, 'AMBULANCE_UPDATED', 'Ambulance', id, {
      before: { vehicleNumber: ambulance.vehicleNumber, vehicleType: ambulance.vehicleType },
      changes: dto,
    });
    return this.loadAmbulance(id);
  }

  /**
   * Remove an ambulance that has never been dispatched. One with trip history
   * is kept for the record — set it to OFFLINE or MAINTENANCE instead.
   */
  async deleteAmbulance(actor: Actor, id: string) {
    const ambulance = await this.loadAmbulance(id);
    const dispatches = await this.dispatchRepository.count({ where: { ambulanceId: id } });
    if (dispatches > 0) {
      throw new ConflictException(
        `${ambulance.vehicleNumber} has ${dispatches} trip record(s) and is kept for the case history. Set it to OFFLINE instead.`,
      );
    }

    const drivers = await this.userRepository.find({ where: { ambulanceId: id } });
    if (drivers.length > 0) {
      await this.userRepository.update({ ambulanceId: id }, { ambulanceId: null as any });
      drivers.forEach(user => this.realtimeGateway.disconnectUser(user.id));
    }
    await this.ambulanceRepository.delete(id);

    await this.audit.record(actor.id, 'AMBULANCE_DELETED', 'Ambulance', id, {
      before: { vehicleNumber: ambulance.vehicleNumber, unlinkedDrivers: drivers.map(user => user.email) },
    });
    return { message: `${ambulance.vehicleNumber} was removed.`, unlinkedDrivers: drivers.map(user => user.email) };
  }
}
