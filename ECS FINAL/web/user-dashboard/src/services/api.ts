import axios, { AxiosInstance } from 'axios';
import { API_CONFIG } from '../config/api';
import TokenStorage from '../utils/tokenStorage';

/**
 * API Client for User Dashboard
 */
class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor - add token
    this.client.interceptors.request.use(
      (config) => {
        const token = TokenStorage.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          TokenStorage.removeToken();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Login
   */
  async login(email: string, password: string) {
    const response = await this.client.post(API_CONFIG.LOGIN, {
      email,
      password,
    });
    
    // Store token and user data (no role restriction - allow all roles)
    TokenStorage.setToken(response.data.accessToken);
    TokenStorage.setUser(response.data.user);
    return response.data;
  }

  /**
   * Get user profile
   */
  async getUserProfile() {
    const response = await this.client.get(API_CONFIG.USER_PROFILE);
    return response.data;
  }

  /**
   * Get user bookings
   */
  async getUserBookings() {
    const response = await this.client.get(API_CONFIG.USER_BOOKINGS);
    return response.data;
  }

  /**
   * Create booking
   */
  async createBooking(bookingData: any) {
    const response = await this.client.post(API_CONFIG.CREATE_BOOKING, bookingData);
    return response.data;
  }

  /**
   * Get hospitals
   */
  async getHospitals() {
    const response = await this.client.get(API_CONFIG.HOSPITALS);
    return response.data;
  }
}

export default new ApiClient();
