import axios, { AxiosInstance } from 'axios';
import { API_CONFIG } from '../config/api';
import TokenStorage from '../utils/tokenStorage';

/**
 * API Client
 * Axios instance with authentication and error handling
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
          window.location.href = 'http://localhost:3004';
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
    TokenStorage.setToken(response.data.accessToken);
    return response.data;
  }

  /**
   * Get all bookings
   */
  async getBookings() {
    const response = await this.client.get(API_CONFIG.BOOKINGS);
    return response.data;
  }

  /**
   * Get all dispatches
   */
  async getDispatches() {
    const response = await this.client.get(API_CONFIG.DISPATCH);
    return response.data;
  }

  /**
   * Get hospitals
   */
  async getHospitals() {
    const response = await this.client.get(API_CONFIG.HOSPITALS);
    return response.data;
  }

  /**
   * Get dashboard stats
   */
  async getDashboardStats() {
    const response = await this.client.get(API_CONFIG.DASHBOARD);
    return response.data;
  }

  /**
   * Get current user
   */
  async getCurrentUser() {
    const response = await this.client.get(API_CONFIG.USERS_ME);
    return response.data;
  }
}

export default new ApiClient();
