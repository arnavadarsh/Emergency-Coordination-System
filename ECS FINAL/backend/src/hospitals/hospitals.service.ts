import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital, HospitalCapability } from './entities';
import { UpdateCapabilityDto } from './dto';
import { HospitalStatus } from '../common/enums';

/**
 * Hospitals Service
 * Hospital management with status updates
 */
@Injectable()
export class HospitalsService {
  constructor(
    @InjectRepository(Hospital)
    private hospitalRepository: Repository<Hospital>,
    @InjectRepository(HospitalCapability)
    private capabilityRepository: Repository<HospitalCapability>,
  ) {}

  /**
   * Find all hospitals
   */
  async findAll(): Promise<Hospital[]> {
    return this.hospitalRepository.find({
      relations: ['capabilities'],
    });
  }

  /**
   * Find hospital by ID
   */
  async findById(id: string): Promise<Hospital | null> {
    return this.hospitalRepository.findOne({
      where: { id },
      relations: ['capabilities'],
    });
  }

  /**
   * Update hospital
   */
  async update(id: string, data: {
    serviceStatus?: string;
    availableBeds?: number;
    totalBeds?: number;
  }): Promise<Hospital> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    if (data.serviceStatus) {
      hospital.status = data.serviceStatus as any;
    }
    if (data.availableBeds !== undefined) {
      hospital.availableBeds = data.availableBeds;
    }
    if (data.totalBeds !== undefined) {
      hospital.totalBeds = data.totalBeds;
    }

    return this.hospitalRepository.save(hospital);
  }

  /**
   * Update hospital status
   */
  async updateStatus(id: string, serviceStatus: string): Promise<Hospital> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    hospital.status = serviceStatus as any;
    return this.hospitalRepository.save(hospital);
  }

  /**
   * Update available beds
   */
  async updateBeds(id: string, availableBeds: number): Promise<Hospital> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    hospital.availableBeds = availableBeds;
    return this.hospitalRepository.save(hospital);
  }

  /**
   * Update hospital capability status
   */
  async updateCapability(id: string, data: UpdateCapabilityDto): Promise<HospitalCapability> {
    const capability = await this.capabilityRepository.findOne({
      where: {
        hospitalId: id,
        capabilityType: data.capabilityType,
      },
    });

    if (!capability) {
      throw new NotFoundException(`Capability ${data.capabilityType} not found for hospital`);
    }

    if (data.status !== undefined) {
      capability.status = data.status;
    }
    if (data.capacity !== undefined) {
      capability.capacity = data.capacity;
    }
    if (data.currentLoad !== undefined) {
      capability.currentLoad = data.currentLoad;
    }

    return this.capabilityRepository.save(capability);
  }

  /**
   * Find nearby hospitals using Haversine formula
   */
  async findNearby(latitude: number, longitude: number, radiusKm: number = 10): Promise<Hospital[]> {
    // Using raw SQL for Haversine distance calculation
    const hospitals = await this.hospitalRepository
      .createQueryBuilder('hospital')
      .leftJoinAndSelect('hospital.capabilities', 'capabilities')
      .where('hospital.status = :status', { status: HospitalStatus.ACTIVE })
      .andWhere(
        `(6371 * acos(
          cos(radians(:latitude)) * 
          cos(radians(hospital.latitude)) * 
          cos(radians(hospital.longitude) - radians(:longitude)) + 
          sin(radians(:latitude)) * 
          sin(radians(hospital.latitude))
        )) <= :radius`,
        { latitude, longitude, radius: radiusKm }
      )
      .orderBy(
        `(6371 * acos(
          cos(radians(:latitude)) * 
          cos(radians(hospital.latitude)) * 
          cos(radians(hospital.longitude) - radians(:longitude)) + 
          sin(radians(:latitude)) * 
          sin(radians(hospital.latitude))
        ))`,
        'ASC'
      )
      .setParameters({ latitude, longitude })
      .getMany();

    return hospitals;
  }

  /**
   * Get hospital statistics
   */
  async getHospitalStats(id: string): Promise<any> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    const bedUtilization = hospital.totalBeds > 0 
      ? ((hospital.totalBeds - hospital.availableBeds) / hospital.totalBeds) * 100 
      : 0;

    return {
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      totalBeds: hospital.totalBeds,
      availableBeds: hospital.availableBeds,
      occupiedBeds: hospital.totalBeds - hospital.availableBeds,
      bedUtilization: Math.round(bedUtilization),
      status: hospital.status,
      capabilities: hospital.capabilities || [],
    };
  }
}
