import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Ambulance } from './entities';
import { AmbulanceStatus } from '../common/enums';

/**
 * Ambulances Service
 * Ambulance management with status and location updates
 */
@Injectable()
export class AmbulancesService {
  constructor(
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
  ) {}

  /**
   * Find all ambulances (excluding pending for regular users)
   */
  async findAll(): Promise<Ambulance[]> {
    return this.ambulanceRepository.find({
      where: { status: Not(AmbulanceStatus.PENDING) },
    });
  }

  /**
   * Find all ambulances including pending (for admin)
   */
  async findAllIncludingPending(): Promise<Ambulance[]> {
    return this.ambulanceRepository.find();
  }

  /**
   * Find pending ambulances (for admin verification)
   */
  async findPending(): Promise<Ambulance[]> {
    return this.ambulanceRepository.find({
      where: { status: AmbulanceStatus.PENDING },
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
   * Create new ambulance (pending verification)
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
}
