/**
 * API Configuration
 */
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  
  // Auth endpoints
  LOGIN: '/auth/login',
  
  // Dashboard endpoints
  DASHBOARD: '/dashboard/hospital',
  
  // Hospital endpoints
  HOSPITALS: '/hospitals',
  
  // Bookings endpoints
  BOOKINGS: '/bookings',
  
  // Dispatch endpoints
  DISPATCH: '/dispatch',
  
  // User endpoints
  USERS_ME: '/users/me',
};
