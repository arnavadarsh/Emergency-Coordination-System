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
  ACCEPTING = 'ACCEPTING',
  LIMITED = 'LIMITED',
  DIVERT = 'DIVERT',
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
 * Ambulance vehicle types — the values of the deployed `ambulance_type` enum.
 */
export enum AmbulanceType {
  BASIC = 'BASIC',
  ADVANCED = 'ADVANCED',
  CRITICAL_CARE = 'CRITICAL_CARE',
}

/**
 * Status of a hospital capability — stored in the deployed schema with the
 * same `hospital_service_status` enum as a hospital's own intake status.
 */
export const CAPABILITY_STATUSES = ['ACCEPTING', 'LIMITED', 'DIVERT'];

/**
 * Driver registration status
 */
export enum DriverStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}
