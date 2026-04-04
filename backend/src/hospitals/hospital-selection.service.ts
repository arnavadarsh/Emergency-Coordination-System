
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { HospitalCapability as HospitalCapabilityEnum } from '../common/enums';
import { HospitalCapability } from './entities/hospital-capability.entity';

@Injectable()
export class HospitalSelectionService {
  private readonly logger = new Logger(HospitalSelectionService.name);

  constructor(
    @InjectRepository(Hospital)
    private readonly hospitalRepository: Repository<Hospital>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('booking.triaged')
  async handleBookingTriagedEvent(booking: Booking) {
    this.logger.log(`Hospital selection process started for booking: ${booking.id}`);
    try {
      await this.selectHospital(booking);
    } catch (error) {
      this.logger.error(`Hospital selection failed for booking ${booking.id}`, error.stack);
    }
  }

  private async selectHospital(booking: Booking): Promise<void> {
    const requirements = booking.requirements || {};
    const { pickupLatitude, pickupLongitude } = booking;

    const hospitals = await this.findAvailableHospitals(requirements);

    if (hospitals.length === 0) {
      this.logger.warn(`No suitable hospitals found for booking: ${booking.id}`);
      return;
    }

    const scoredHospitals = this.scoreHospitals(hospitals, requirements, pickupLatitude, pickupLongitude);

    const bestHospital = scoredHospitals[0];
    const alternativeHospitals = scoredHospitals.slice(1, 4);

    booking.hospital = bestHospital.hospital;
    booking.rankedHospitals = alternativeHospitals.map(h => h.hospital.id);

    const savedBooking = await this.bookingRepository.save(booking);

    this.realtimeGateway.server.emit('hospital_selected', {
      bookingId: booking.id,
      hospital: bestHospital.hospital,
      alternatives: alternativeHospitals.map(h => h.hospital),
    });
    
    this.eventEmitter.emit('hospital.selected', savedBooking);
    this.logger.log(`Best hospital selected for booking ${booking.id}: ${bestHospital.hospital.name}`);
  }

  private async findAvailableHospitals(requirements: any): Promise<Hospital[]> {
    const requiredCapabilities = [];
    if (requirements.traumaSupport) {
      requiredCapabilities.push(HospitalCapabilityEnum.TRAUMA);
    }
    if (requirements.cardiacSupport) {
      requiredCapabilities.push(HospitalCapabilityEnum.CARDIAC);
    }

    const query = this.hospitalRepository.createQueryBuilder('hospital')
      .leftJoinAndSelect('hospital.capabilities', 'capability')
      .where('hospital.availableBeds > 0');

    if (requirements.icu) {
      query.andWhere('hospital.availableBeds > 0');
    }

    if (requiredCapabilities.length > 0) {
      query.andWhere((qb) => {
        const subQuery = qb.subQuery()
          .select('1')
          .from('hospital_capabilities', 'hc')
          .where('hc.hospital_id = hospital.id')
          .andWhere('hc.capability_type IN (:...capabilities)')
          .getQuery();
        return `EXISTS ${subQuery}`;
      }).setParameter('capabilities', requiredCapabilities);
    }

    return query.getMany();
  }

  private scoreHospitals(hospitals: Hospital[], requirements: any, userLat: number, userLng: number) {
    return hospitals.map(hospital => {
      const distance = this.calculateDistance(userLat, userLng, hospital.latitude, hospital.longitude);
      const etaScore = 1 / (1 + distance); // Simplified ETA score
      const capacityScore = hospital.totalBeds > 0 ? hospital.availableBeds / hospital.totalBeds : 0;
      const specializationScore = this.calculateSpecializationScore(hospital, requirements);

      const score = (0.5 * etaScore) + (0.3 * capacityScore) + (0.2 * specializationScore);

      return { hospital, score };
    }).sort((a, b) => b.score - a.score);
  }

  private calculateSpecializationScore(hospital: Hospital, requirements: any): number {
    let score = 0;
    const hospitalCapabilities = hospital.capabilities.map(c => c.capabilityType);

    if (requirements.traumaSupport && hospitalCapabilities.includes(HospitalCapabilityEnum.TRAUMA)) {
      score += 1;
    }
    if (requirements.cardiacSupport && hospitalCapabilities.includes(HospitalCapabilityEnum.CARDIAC)) {
      score += 1;
    }
    // Normalize score
    const requiredCount = (requirements.traumaSupport ? 1 : 0) + (requirements.cardiacSupport ? 1 : 0);
    return requiredCount > 0 ? score / requiredCount : 0;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the earth in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
