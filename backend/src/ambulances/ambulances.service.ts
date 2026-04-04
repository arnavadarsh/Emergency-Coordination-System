import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Ambulance } from './entities';
import { AmbulanceStatus } from '../common/enums';

/**
 * Ambulances Service
 * Ambulance management with status and location updates
 */
@Injectable()
export class AmbulancesService implements OnModuleInit {
  constructor(
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
  ) {}

  async onModuleInit(): Promise<void> {
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
        if (!unit.currentLatitude) unit.currentLatitude = 12.9716;
        if (!unit.currentLongitude) unit.currentLongitude = 77.5946;
      }
      await this.ambulanceRepository.save(existingUnits);
      return;
    }

    const seedFleet = [
      {
        vehicleNumber: 'KA01AA1001',
        vehicleType: 'ALS',
        status: AmbulanceStatus.AVAILABLE,
        currentLatitude: 12.9716,
        currentLongitude: 77.5946,
        equipmentList: { oxygen: true, ventilator: true, monitor: true },
      },
      {
        vehicleNumber: 'KA01AA1002',
        vehicleType: 'BLS',
        status: AmbulanceStatus.AVAILABLE,
        currentLatitude: 12.9865,
        currentLongitude: 77.6046,
        equipmentList: { oxygen: true, defibrillator: true },
      },
      {
        vehicleNumber: 'KA01AA1003',
        vehicleType: 'BASIC',
        status: AmbulanceStatus.AVAILABLE,
        currentLatitude: 12.9561,
        currentLongitude: 77.7011,
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
   * DB enum does not include PENDING in this deployment schema.
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
   * Find pending ambulances (for admin verification)
   * PENDING is not present in current DB enum, so return empty list.
   */
  async findPending(): Promise<Ambulance[]> {
    return [];
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
   * Create new ambulance.
   * Use OFFLINE as initial state for compatibility with current DB enum.
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
      status: AmbulanceStatus.OFFLINE,
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
    return this.ambulanceRepository.save(ambulance);
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
    return this.ambulanceRepository.save(ambulance);
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
    return this.ambulanceRepository.save(ambulance);
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
