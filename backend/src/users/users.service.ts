import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, SavedLocation } from './entities';
import {
  MedicalProfile,
  MedicalProfileInput,
  buildMedicalProfile,
  normalizeMedicalField,
} from '../common/medical-profile';
import { UserRole } from '../common/enums';

/**
 * Column-level Medical Profile writes. A `null` clears the column — that is how
 * the Profile editor removes outdated information; an absent key leaves the
 * stored value untouched.
 */
interface MedicalProfileColumns {
  bloodType?: string | null;
  allergies?: string | null;
  chronicConditions?: string | null;
  currentMedications?: string | null;
  medicalProfileUpdatedAt?: Date;
}

/**
 * Users Service
 * Handles user CRUD operations
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(SavedLocation)
    private savedLocationRepository: Repository<SavedLocation>,
  ) {}

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
    });
  }

  /**
   * Find user by email. The password hash is NOT included — see the entity.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
    });
  }

  /**
   * Find user by email including the password hash. Only authentication should call this.
   */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Replace a user's password hash. Callers must hash before calling.
   */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.userRepository.update(userId, { password: passwordHash });
  }

  /**
   * Create a new user with profile
   */
  async create(data: {
    email: string;
    password: string;
    role?: any;
    profile: {
      firstName: string;
      lastName: string;
      phoneNumber?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      /** Optional Medical Profile. Omitting it still creates a valid patient ID. */
      medicalProfile?: MedicalProfileInput;
    };
  }): Promise<User> {
    const newUser = this.userRepository.create({
      email: data.email,
      password: data.password,
      // Defaulted here rather than relying on the column default: the deployed
      // Postgres schema declares `role` NOT NULL with no DEFAULT, so an omitted
      // role (every ordinary patient sign-up) would otherwise insert NULL and
      // fail. The entity's `default:` only applies when TypeORM generates the
      // schema, which it never does against a live database.
      role: data.role ?? UserRole.USER,
      firstName: data.profile.firstName,
      lastName: data.profile.lastName,
      phoneNumber: data.profile.phoneNumber,
      address: data.profile.address,
      latitude: data.profile.latitude,
      longitude: data.profile.longitude,
    });

    // Medical Profile is optional at ID creation. `medicalProfileUpdatedAt` is
    // only stamped when something was actually supplied, so "never filled in"
    // stays distinguishable from "filled in and later cleared".
    Object.assign(newUser, this.buildMedicalProfileUpdate(data.profile.medicalProfile));

    return await this.userRepository.save(newUser);
  }

  /**
   * Translate a Medical Profile payload into column updates.
   *
   * Omitted fields are left out of the result (existing values survive), while a
   * blank string clears the column to NULL — that is how the Profile editor
   * removes outdated information. Returns `{}` when nothing was supplied, so
   * callers can spread it unconditionally.
   */
  private buildMedicalProfileUpdate(input?: MedicalProfileInput | null): MedicalProfileColumns {
    if (!input) return {};

    const update: MedicalProfileColumns = {};
    let touched = false;

    if (input.bloodGroup !== undefined) {
      update.bloodType = normalizeMedicalField(input.bloodGroup);
      touched = true;
    }
    if (input.allergies !== undefined) {
      update.allergies = normalizeMedicalField(input.allergies);
      touched = true;
    }
    if (input.chronicConditions !== undefined) {
      update.chronicConditions = normalizeMedicalField(input.chronicConditions);
      touched = true;
    }
    if (input.currentMedications !== undefined) {
      update.currentMedications = normalizeMedicalField(input.currentMedications);
      touched = true;
    }

    if (touched) update.medicalProfileUpdatedAt = new Date();
    return update;
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
    });
  }

  /**
   * Find all users (admin only)
   */
  async findAll(): Promise<User[]> {
    return this.userRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find users with pagination and filters (admin only)
   */
  async findWithFilters(options: {
    page?: number;
    limit?: number;
    search?: string;
    role?: any;
    status?: 'active' | 'inactive';
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  }): Promise<{
    data: User[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const sortBy = options.sortBy || 'createdAt';
    const sortOrder = options.sortOrder || 'DESC';

    const query = this.userRepository.createQueryBuilder('user');

    // Search filter
    if (options.search) {
      query.andWhere(
        '(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search OR user.phoneNumber LIKE :search)',
        { search: `%${options.search}%` }
      );
    }

    // Role filter
    if (options.role) {
      query.andWhere('user.role = :role', { role: options.role });
    }

    // Status filter
    if (options.status) {
      const isActive = options.status === 'active';
      query.andWhere('user.isActive = :isActive', { isActive });
    }

    // Get total count
    const total = await query.getCount();

    // Apply sorting and pagination
    query.orderBy(`user.${sortBy}`, sortOrder);
    query.skip((page - 1) * limit);
    query.take(limit);

    const data = await query.getMany();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Update user active status
   */
  async updateActiveStatus(userId: string, isActive: boolean): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(userId, { isActive });
    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new Error('Failed to retrieve updated user');
    }
    return updatedUser;
  }

  /**
   * Update user role
   */
  async updateRole(userId: string, role: any): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(userId, { role });
    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new Error('Failed to retrieve updated user');
    }
    return updatedUser;
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, profileData: {
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    address?: string;
    emergencyContact?: string;
    dateOfBirth?: string;
    /** Blood group, e.g. "O+". `bloodType` is the legacy alias for the same column. */
    bloodGroup?: string;
    bloodType?: string;
    allergies?: string;
    chronicConditions?: string;
    currentMedications?: string;
    medicalNotes?: string;
    profilePhotoUrl?: string;
  }): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: any = {};
    if (profileData.firstName !== undefined) updateData.firstName = profileData.firstName;
    if (profileData.lastName !== undefined) updateData.lastName = profileData.lastName;
    if (profileData.phoneNumber !== undefined) updateData.phoneNumber = profileData.phoneNumber;
    if (profileData.address !== undefined) updateData.address = profileData.address;
    if (profileData.emergencyContact !== undefined) updateData.emergencyContact = profileData.emergencyContact;
    if (profileData.dateOfBirth !== undefined) updateData.dateOfBirth = new Date(profileData.dateOfBirth);
    if (profileData.medicalNotes !== undefined) updateData.medicalNotes = profileData.medicalNotes;

    // Medical Profile fields travel on the same profile save, so a patient can
    // edit personal details and medical information in one action.
    Object.assign(updateData, this.buildMedicalProfileUpdate({
      bloodGroup: profileData.bloodGroup ?? profileData.bloodType,
      allergies: profileData.allergies,
      chronicConditions: profileData.chronicConditions,
      currentMedications: profileData.currentMedications,
    }));
    if (profileData.profilePhotoUrl !== undefined) {
      updateData.profilePhotoUrl = profileData.profilePhotoUrl.trim() || null;
    }

    await this.userRepository.update(userId, updateData);

    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new Error('Failed to retrieve updated user');
    }
    return updatedUser;
  }

  /**
   * Read a patient's Medical Profile.
   *
   * Fields the patient has not supplied come back as `null`, with a parallel
   * `display` block already substituted with "Not Provided" — no caller ever has
   * to invent a value.
   */
  async getMedicalProfile(userId: string): Promise<MedicalProfile> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return buildMedicalProfile(user);
  }

  /**
   * Save a patient's Medical Profile without touching the rest of their ID.
   *
   * Adding, updating and removing all go through here: an omitted field keeps
   * its stored value, a blank field is cleared to NULL. The saved values become
   * what triage, pre-alerts and reports read from that moment on.
   */
  async updateMedicalProfile(userId: string, data: MedicalProfileInput): Promise<MedicalProfile> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData = this.buildMedicalProfileUpdate(data);
    if (Object.keys(updateData).length > 0) {
      await this.userRepository.update(userId, updateData as any);
    }

    return this.getMedicalProfile(userId);
  }

  /**
   * Get medical records for a user.
   * Returns the structured Medical Profile alongside the legacy free-text fields.
   */
  async getMedicalRecords(userId: string): Promise<{
    bloodType?: string;
    medicalNotes?: string;
    emergencyContact?: string;
    medicalProfile: MedicalProfile;
  }> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      bloodType: user.bloodType,
      medicalNotes: user.medicalNotes,
      emergencyContact: user.emergencyContact,
      medicalProfile: buildMedicalProfile(user),
    };
  }

  /**
   * Update medical records.
   * Accepts the structured Medical Profile fields as well as the legacy ones.
   */
  async updateMedicalRecords(userId: string, data: {
    bloodType?: string;
    bloodGroup?: string;
    allergies?: string;
    chronicConditions?: string;
    currentMedications?: string;
    medicalNotes?: string;
    emergencyContact?: string;
  }): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: any = {};
    if (data.medicalNotes !== undefined) updateData.medicalNotes = data.medicalNotes;
    if (data.emergencyContact !== undefined) updateData.emergencyContact = data.emergencyContact;

    Object.assign(updateData, this.buildMedicalProfileUpdate({
      bloodGroup: data.bloodGroup ?? data.bloodType,
      allergies: data.allergies,
      chronicConditions: data.chronicConditions,
      currentMedications: data.currentMedications,
    }));

    if (Object.keys(updateData).length > 0) {
      await this.userRepository.update(userId, updateData);
    }

    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new Error('Failed to retrieve updated user');
    }
    return updatedUser;
  }

  /**
   * Find users by role
   */
  async findByRole(role: any): Promise<User[]> {
    return this.userRepository.find({
      where: { role },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get user statistics
   */
  async getUserStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    usersByRole: Record<string, number>;
  }> {
    const allUsers = await this.userRepository.find();
    
    const totalUsers = allUsers.length;
    const activeUsers = allUsers.filter(u => u.isActive).length;
    const inactiveUsers = totalUsers - activeUsers;
    
    const usersByRole: Record<string, number> = {};
    allUsers.forEach(user => {
      const role = user.role || 'USER';
      usersByRole[role] = (usersByRole[role] || 0) + 1;
    });

    return {
      totalUsers,
      activeUsers,
      inactiveUsers,
      usersByRole,
    };
  }

  /**
   * Get user's saved locations
   */
  async getSavedLocations(userId: string): Promise<SavedLocation[]> {
    return this.savedLocationRepository.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Create a new saved location
   */
  async createSavedLocation(userId: string, data: {
    label: string;
    address: string;
    latitude: number;
    longitude: number;
    isDefault?: boolean;
  }): Promise<SavedLocation> {
    // If setting as default, unset other defaults
    if (data.isDefault) {
      await this.savedLocationRepository.update(
        { userId },
        { isDefault: false }
      );
    }

    const savedLocation = this.savedLocationRepository.create({
      userId,
      ...data,
    });

    return await this.savedLocationRepository.save(savedLocation);
  }

  /**
   * Update a saved location
   */
  async updateSavedLocation(
    userId: string,
    locationId: string,
    data: {
      label?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      isDefault?: boolean;
    }
  ): Promise<SavedLocation> {
    const location = await this.savedLocationRepository.findOne({
      where: { id: locationId, userId },
    });

    if (!location) {
      throw new NotFoundException('Saved location not found');
    }

    // If setting as default, unset other defaults
    if (data.isDefault) {
      await this.savedLocationRepository.update(
        { userId },
        { isDefault: false }
      );
    }

    await this.savedLocationRepository.update(locationId, data);

    const updated = await this.savedLocationRepository.findOne({
      where: { id: locationId },
    });

    if (!updated) {
      throw new Error('Failed to retrieve updated location');
    }

    return updated;
  }

  /**
   * Delete a saved location
   */
  async deleteSavedLocation(userId: string, locationId: string): Promise<void> {
    const location = await this.savedLocationRepository.findOne({
      where: { id: locationId, userId },
    });

    if (!location) {
      throw new NotFoundException('Saved location not found');
    }

    await this.savedLocationRepository.delete(locationId);
  }

  /**
   * Get notification preferences
   */
  async getNotificationPreferences(userId: string): Promise<{
    emailNotifications: boolean;
    smsNotifications: boolean;
    pushNotifications: boolean;
  }> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      emailNotifications: user.emailNotifications ?? true,
      smsNotifications: user.smsNotifications ?? true,
      pushNotifications: user.pushNotifications ?? true,
    };
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(
    userId: string,
    data: {
      emailNotifications?: boolean;
      smsNotifications?: boolean;
      pushNotifications?: boolean;
    }
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(userId, data);

    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new Error('Failed to retrieve updated user');
    }

    return updatedUser;
  }
}
