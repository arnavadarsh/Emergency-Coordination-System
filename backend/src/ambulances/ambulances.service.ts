import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ambulance } from './entities';
import { AmbulanceStatus } from '../common/enums';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { shouldSeedDemoData } from '../config/env';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { ACTIVE_DISPATCH_STATUSES } from '../dispatch/dispatch-status';

/**
 * Ambulances Service
 * Ambulance management with status and location updates
 */
@Injectable()
export class AmbulancesService implements OnModuleInit {
  private readonly logger = new Logger(AmbulancesService.name);

  constructor(
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
    @InjectRepository(Dispatch)
    private dispatchRepository: Repository<Dispatch>,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Send an ambulance's current position and state to whoever is watching it:
   * admins (the Live Operations Map), and — while it is on a case — that case's
   * patient and receiving hospital, so their maps move without polling. Nobody
   * else learns where a unit is. Coordinates are cast to Number because the
   * decimal columns come back from pg as strings, which would otherwise reach
   * the client as "28.5463260".
   */
  private async emitAmbulanceUpdate(event: 'ambulance_location_updated' | 'ambulance_status_updated', ambulance: Ambulance): Promise<void> {
    const latitude = Number(ambulance.currentLatitude);
    const longitude = Number(ambulance.currentLongitude);

    const activeDispatch = await this.dispatchRepository.findOne({
      where: { ambulanceId: ambulance.id, status: In(ACTIVE_DISPATCH_STATUSES) },
      relations: ['booking'],
      order: { createdAt: 'DESC' },
    });

    this.realtimeGateway.emitToCase(
      {
        ambulanceId: ambulance.id,
        patientId: activeDispatch?.booking?.userId,
        hospitalIds: [activeDispatch?.hospitalId],
      },
      event,
      {
        id: ambulance.id,
        bookingId: activeDispatch?.bookingId ?? null,
        vehicleNumber: ambulance.vehicleNumber,
        vehicleType: ambulance.vehicleType,
        status: ambulance.status,
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        lastLocationUpdate: ambulance.lastLocationUpdate?.toISOString() ?? null,
        at: new Date().toISOString(),
      },
    );
  }

  async onModuleInit(): Promise<void> {
    // Demo ambulances are written only when seeding is enabled — off by default in
    // production so a deployment never adds rows nobody asked for to the
    // project's real data. See SEED_DEMO_DATA.
    if (!shouldSeedDemoData()) {
      this.logger.log('SEED_DEMO_DATA is off — skipping demo ambulances seeding');
      return;
    }
    await this.ensureDispatchReadyFleet();
  }

  /**
   * Ensure there is at least one AVAILABLE ambulance so emergency booking auto-dispatch can work.
   * For demo/dev stability: activate existing units first, then seed defaults only if needed.
   */
  private async ensureDispatchReadyFleet(): Promise<void> {
    const availableCount = await this.ambulanceRepository.count({
      where: { status: AmbulanceStatus.AVAILABLE },
    });

    if (availableCount > 0) {
      return;
    }

    const existingUnits = await this.ambulanceRepository.find({
      order: { createdAt: 'ASC' },
      take: 3,
    });

    if (existingUnits.length > 0) {
      for (const unit of existingUnits) {
        unit.status = AmbulanceStatus.AVAILABLE;
        if (!unit.currentLatitude) unit.currentLatitude = 28.6304;
        if (!unit.currentLongitude) unit.currentLongitude = 77.2177;
      }
      await this.ambulanceRepository.save(existingUnits);
      return;
    }

    const seedFleet = [
      {
        vehicleNumber: 'DL01AA1001',
        vehicleType: 'ADVANCED',
        status: AmbulanceStatus.AVAILABLE,
        // Connaught Place — central to the seeded Delhi hospitals.
        currentLatitude: 28.6304,
        currentLongitude: 77.2177,
        equipmentList: { oxygen: true, ventilator: true, monitor: true },
      },
      {
        vehicleNumber: 'DL01AA1002',
        vehicleType: 'BASIC',
        status: AmbulanceStatus.AVAILABLE,
        // South Delhi, near AIIMS and Safdarjung.
        currentLatitude: 28.5729,
        currentLongitude: 77.2090,
        equipmentList: { oxygen: true, defibrillator: true },
      },
      {
        vehicleNumber: 'DL01AA1003',
        vehicleType: 'BASIC',
        status: AmbulanceStatus.AVAILABLE,
        // East Delhi, near Lok Nayak.
        currentLatitude: 28.6450,
        currentLongitude: 77.2500,
        equipmentList: { oxygen: true },
      },
    ];

    const toInsert: Ambulance[] = [];
    for (const unit of seedFleet) {
      const exists = await this.ambulanceRepository.findOne({
        where: { vehicleNumber: unit.vehicleNumber },
      });
      if (!exists) {
        toInsert.push(this.ambulanceRepository.create(unit));
      }
    }

    if (toInsert.length > 0) {
      await this.ambulanceRepository.save(toInsert);
    }
  }

  /**
   * Find all ambulances
   */
  async findAll(): Promise<Ambulance[]> {
    return this.ambulanceRepository.find();
  }

  /**
   * Find all ambulances including pending (for admin)
   */
  async findAllIncludingPending(): Promise<Ambulance[]> {
    return this.ambulanceRepository.find();
  }

  /**
   * Ambulances waiting for admin verification. This used to return an empty
   * list unconditionally (the database enum lacked PENDING until migration
   * 1780026000000), so the admin's Pending tab could never show anything.
   */
  async findPending(): Promise<Ambulance[]> {
    return this.ambulanceRepository.find({
      where: { status: AmbulanceStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Find ambulance by ID
   */
  async findById(id: string): Promise<Ambulance | null> {
    return this.ambulanceRepository.findOne({
      where: { id },
    });
  }

  /**
   * Find available ambulances
   */
  async findAvailable(): Promise<Ambulance[]> {
    return this.ambulanceRepository.find({
      where: { status: AmbulanceStatus.AVAILABLE },
    });
  }

  /**
   * Register a new ambulance. It waits as PENDING until an admin verifies it,
   * and is never dispatched before then.
   */
  async create(data: {
    vehicleNumber: string;
    vehicleType: string;
    driverName?: string;
    driverPhone?: string;
    driverLicense?: string;
    currentLatitude?: number;
    currentLongitude?: number;
    equipmentList?: any;
  }): Promise<Ambulance> {
    const ambulance = this.ambulanceRepository.create({
      vehicleNumber: data.vehicleNumber,
      vehicleType: data.vehicleType,
      status: AmbulanceStatus.PENDING,
      currentLatitude: data.currentLatitude,
      currentLongitude: data.currentLongitude,
      equipmentList: {
        driverName: data.driverName,
        driverPhone: data.driverPhone,
        driverLicense: data.driverLicense,
        ...data.equipmentList,
      },
    });
    return this.ambulanceRepository.save(ambulance);
  }

  /**
   * Verify ambulance (admin only)
   */
  async verify(id: string): Promise<Ambulance> {
    const ambulance = await this.findById(id);
    if (!ambulance) {
      throw new NotFoundException('Ambulance not found');
    }
    ambulance.status = AmbulanceStatus.AVAILABLE;
    const saved = await this.ambulanceRepository.save(ambulance);
    this.eventEmitter.emit('ambulance.available', saved.id);
    return saved;
  }

  /**
   * Reject ambulance registration (admin only)
   */
  async reject(id: string): Promise<void> {
    const ambulance = await this.findById(id);
    if (!ambulance) {
      throw new NotFoundException('Ambulance not found');
    }
    await this.ambulanceRepository.remove(ambulance);
  }

  /**
   * Update ambulance status
   */
  async updateStatus(id: string, status: AmbulanceStatus): Promise<Ambulance> {
    const ambulance = await this.findById(id);
    if (!ambulance) {
      throw new NotFoundException('Ambulance not found');
    }

    ambulance.status = status;
    const saved = await this.ambulanceRepository.save(ambulance);
    await this.emitAmbulanceUpdate('ambulance_status_updated', saved);
    if (saved.status === AmbulanceStatus.AVAILABLE) {
      // Lets the dispatch retry worker send this unit to a waiting booking now.
      this.eventEmitter.emit('ambulance.available', saved.id);
    }
    return saved;
  }

  /**
   * Update ambulance location
   */
  async updateLocation(id: string, latitude: number, longitude: number): Promise<Ambulance> {
    const ambulance = await this.findById(id);
    if (!ambulance) {
      throw new NotFoundException('Ambulance not found');
    }

    ambulance.currentLatitude = latitude;
    ambulance.currentLongitude = longitude;
    ambulance.lastLocationUpdate = new Date();
    const saved = await this.ambulanceRepository.save(ambulance);
    await this.emitAmbulanceUpdate('ambulance_location_updated', saved);
    return saved;
  }

  /**
   * Update ambulance equipment list
   */
  async updateEquipment(id: string, equipmentList: any): Promise<Ambulance> {
    const ambulance = await this.findById(id);
    if (!ambulance) {
      throw new NotFoundException('Ambulance not found');
    }

    ambulance.equipmentList = equipmentList;
    return this.ambulanceRepository.save(ambulance);
  }

  /**
   * Find nearby ambulances using Haversine formula
   */
  async findNearby(latitude: number, longitude: number, radiusKm: number = 10): Promise<Ambulance[]> {
    // Using raw SQL for Haversine distance calculation
    const ambulances = await this.ambulanceRepository
      .createQueryBuilder('ambulance')
      .where('ambulance.status = :status', { status: AmbulanceStatus.AVAILABLE })
      .andWhere('ambulance.currentLatitude IS NOT NULL')
      .andWhere('ambulance.currentLongitude IS NOT NULL')
      .andWhere(
        `(6371 * acos(
          cos(radians(:latitude)) * 
          cos(radians(ambulance.currentLatitude)) * 
          cos(radians(ambulance.currentLongitude) - radians(:longitude)) + 
          sin(radians(:latitude)) * 
          sin(radians(ambulance.currentLatitude))
        )) <= :radius`,
        { latitude, longitude, radius: radiusKm }
      )
      .orderBy(
        `(6371 * acos(
          cos(radians(:latitude)) * 
          cos(radians(ambulance.currentLatitude)) * 
          cos(radians(ambulance.currentLongitude) - radians(:longitude)) + 
          sin(radians(:latitude)) * 
          sin(radians(ambulance.currentLatitude))
        ))`,
        'ASC'
      )
      .setParameters({ latitude, longitude })
      .getMany();

    return ambulances;
  }
}
