/**
 * API Configuration
 */
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  
  // Auth endpoints
  LOGIN: '/auth/login',
  
  // Driver endpoints
  DRIVER_PROFILE: '/driver/profile',
  DRIVER_DISPATCHES: '/driver/dispatches',
  UPDATE_DISPATCH_STATUS: '/driver/dispatches',
};
