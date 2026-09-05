import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { EmergencyContact } from './entities/emergency-contact.entity';
import { SmsService } from '../notifications/sms.service';

/**
 * The shape returned to the patient. `optedOut` is exposed read-only: the
 * patient can see that a relative unsubscribed, and why that contact is no
 * longer being messaged, but cannot re-subscribe them from here.
 */
export interface EmergencyContactView {
  id: string;
  name: string;
  phoneNumber: string;
  relation: string;
  notifyBySms: boolean;
  optedOut: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
}

/**
 * Emergency Contacts Service
 *
 * The people a patient wants told when an ambulance is assigned to them.
 * Everything here is the patient's own list — add, edit and remove at any time.
 *
 * Two rules protect the people on the list rather than the patient:
 *   - a number is stored once per patient, so nobody is texted twice per case;
 *   - a contact who opted out stays opted out, whatever the patient edits.
 */
@Injectable()
export class EmergencyContactsService {
  private readonly logger = new Logger(EmergencyContactsService.name);

  /** Bounds the SMS fan-out one emergency can trigger. */
  private static readonly MAX_CONTACTS_PER_USER = 10;

  constructor(
    @InjectRepository(EmergencyContact)
    private readonly contactRepository: Repository<EmergencyContact>,
    private readonly smsService: SmsService,
  ) {}

  async findAll(userId: string): Promise<EmergencyContactView[]> {
    const contacts = await this.contactRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return contacts.map(contact => this.toView(contact));
  }

  async create(
    userId: string,
    data: { name: string; phoneNumber: string; relation: string; notifyBySms?: boolean },
  ): Promise<EmergencyContactView> {
    const count = await this.contactRepository.count({ where: { userId } });
    if (count >= EmergencyContactsService.MAX_CONTACTS_PER_USER) {
      throw new BadRequestException(
        `You can save up to ${EmergencyContactsService.MAX_CONTACTS_PER_USER} emergency contacts.`,
      );
    }

    const phoneNumber = this.requireDialableNumber(data.phoneNumber);
    await this.assertNumberIsNew(userId, phoneNumber);

    const contact = this.contactRepository.create({
      userId,
      name: data.name.trim(),
      phoneNumber,
      relation: data.relation.trim(),
      notifyBySms: data.notifyBySms ?? true,
      optOutToken: randomBytes(16).toString('base64url'),
    });

    const saved = await this.contactRepository.save(contact);
    this.logger.log(`[contacts] Emergency contact added for user ${userId}`);
    return this.toView(saved);
  }

  async update(
    userId: string,
    contactId: string,
    data: { name?: string; phoneNumber?: string; relation?: string; notifyBySms?: boolean },
  ): Promise<EmergencyContactView> {
    const contact = await this.requireOwned(userId, contactId);

    if (data.phoneNumber !== undefined) {
      const phoneNumber = this.requireDialableNumber(data.phoneNumber);
      if (phoneNumber !== contact.phoneNumber) {
        await this.assertNumberIsNew(userId, phoneNumber, contactId);
        contact.phoneNumber = phoneNumber;
      }
    }

    if (data.name !== undefined) contact.name = data.name.trim();
    if (data.relation !== undefined) contact.relation = data.relation.trim();
    if (data.notifyBySms !== undefined) contact.notifyBySms = data.notifyBySms;

    // `optedOutAt` is intentionally not editable here — see the entity.

    const saved = await this.contactRepository.save(contact);
    return this.toView(saved);
  }

  async remove(userId: string, contactId: string): Promise<void> {
    const contact = await this.requireOwned(userId, contactId);
    await this.contactRepository.delete(contact.id);
    this.logger.log(`[contacts] Emergency contact removed for user ${userId}`);
  }

  private async requireOwned(userId: string, contactId: string): Promise<EmergencyContact> {
    const contact = await this.contactRepository.findOne({ where: { id: contactId, userId } });
    if (!contact) {
      throw new NotFoundException('Emergency contact not found');
    }
    return contact;
  }

  /**
   * Normalise to a dialable number, or reject. Validating at save time means a
   * typo surfaces while the patient is calmly editing their profile, not during
   * an emergency when the alert silently fails to send.
   */
  private requireDialableNumber(raw: string): string {
    const normalized = this.smsService.normalizeNumber(raw);
    if (!normalized) {
      throw new BadRequestException('Enter a valid phone number, including the country code if it is not Indian.');
    }
    return normalized;
  }

  private async assertNumberIsNew(userId: string, phoneNumber: string, exceptId?: string): Promise<void> {
    const duplicate = await this.contactRepository.findOne({
      where: exceptId
        ? { userId, phoneNumber, id: Not(exceptId) }
        : { userId, phoneNumber },
    });
    if (duplicate) {
      throw new BadRequestException(`${duplicate.name} is already saved with this number.`);
    }
  }

  private toView(contact: EmergencyContact): EmergencyContactView {
    return {
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      relation: contact.relation,
      notifyBySms: contact.notifyBySms,
      optedOut: contact.optedOutAt !== null,
      lastNotifiedAt: contact.lastNotifiedAt ? new Date(contact.lastNotifiedAt).toISOString() : null,
      createdAt: new Date(contact.createdAt).toISOString(),
    };
  }
}
