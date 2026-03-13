import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, SavedLocation } from './entities';

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
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
    });
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
    };
  }): Promise<User> {
    const newUser = this.userRepository.create({
      email: data.email,
      password: data.password,
      role: data.role,
      firstName: data.profile.firstName,
      lastName: data.profile.lastName,
      phoneNumber: data.profile.phoneNumber,
      address: data.profile.address,
      latitude: data.profile.latitude,
      longitude: data.profile.longitude,
    });

    return await this.userRepository.save(newUser);
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
    bloodType?: string;
    medicalNotes?: string;
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
    if (profileData.bloodType !== undefined) updateData.bloodType = profileData.bloodType;
    if (profileData.medicalNotes !== undefined) updateData.medicalNotes = profileData.medicalNotes;

    await this.userRepository.update(userId, updateData);

    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new Error('Failed to retrieve updated user');
    }
    return updatedUser;
  }

  /**
   * Get medical records for a user
   */
  async getMedicalRecords(userId: string): Promise<{
    bloodType?: string;
    medicalNotes?: string;
    emergencyContact?: string;
  }> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      bloodType: user.bloodType,
      medicalNotes: user.medicalNotes,
      emergencyContact: user.emergencyContact,
    };
  }

  /**
   * Update medical records
   */
  async updateMedicalRecords(userId: string, data: {
    bloodType?: string;
    medicalNotes?: string;
    emergencyContact?: string;
  }): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: any = {};
    if (data.bloodType !== undefined) updateData.bloodType = data.bloodType;
    if (data.medicalNotes !== undefined) updateData.medicalNotes = data.medicalNotes;
    if (data.emergencyContact !== undefined) updateData.emergencyContact = data.emergencyContact;

    await this.userRepository.update(userId, updateData);
    
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
