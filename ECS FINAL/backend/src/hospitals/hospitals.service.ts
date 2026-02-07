import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital } from './entities';

/**
 * Hospitals Service
 * Hospital management with status updates
 */
@Injectable()
export class HospitalsService {
  constructor(
    @InjectRepository(Hospital)
    private hospitalRepository: Repository<Hospital>,
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
}
