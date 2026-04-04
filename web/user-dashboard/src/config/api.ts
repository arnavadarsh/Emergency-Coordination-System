/**
 * API Configuration
 */
export const API_CONFIG = {
  BASE_URL: (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000/api',
  
  // Auth endpoints
  LOGIN: '/auth/login',
  
  // User endpoints
  USER_PROFILE: '/user/profile',
  USER_BOOKINGS: '/user/bookings',
  CREATE_BOOKING: '/user/bookings',
  HOSPITALS: '/hospitals',
};
