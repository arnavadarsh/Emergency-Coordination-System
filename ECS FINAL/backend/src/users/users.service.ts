import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities';

/**
 * Users Service
 * Handles user CRUD operations
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
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

    await this.userRepository.update(userId, updateData);

    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new Error('Failed to retrieve updated user');
    }
    return updatedUser;
  }
}
