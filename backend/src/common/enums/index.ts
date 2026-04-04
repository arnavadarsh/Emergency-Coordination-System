/**
 * User roles for RBAC
 * Used throughout the system for access control
 */
export enum UserRole {
  USER = 'USER',
  DRIVER = 'DRIVER',
  HOSPITAL = 'HOSPITAL',
  ADMIN = 'ADMIN',
}

/**
 * Booking status enum
 * Tracks the lifecycle of a booking
 */
export enum BookingStatus {
  PENDING = 'PENDING',
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/**
 * Hospital status enum
 */
export enum HospitalStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  MAINTENANCE = 'MAINTENANCE',
}

/**
 * Hospital capability types
 */
export enum HospitalCapability {
  ER = 'ER',
  ICU = 'ICU',
  CARDIAC = 'CARDIAC',
  TRAUMA = 'TRAUMA',
  NEURO = 'NEURO',
  OB = 'OB',
}

/**
 * Severity level (placeholder for future triage logic)
 */
export enum SeverityLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Ambulance availability status
 */
export enum AmbulanceStatus {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  BUSY = 'BUSY',
  MAINTENANCE = 'MAINTENANCE',
  OFFLINE = 'OFFLINE',
  PENDING = 'PENDING', // Pending admin verification
}

/**
 * Driver registration status
 */
export enum DriverStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}
