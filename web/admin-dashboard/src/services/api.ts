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
   * Get all users
   */
  async getUsers() {
    const response = await this.client.get(API_CONFIG.USERS);
    return response.data;
  }

  /**
   * Get all hospitals
   */
  async getHospitals() {
    const response = await this.client.get(API_CONFIG.HOSPITALS);
    return response.data;
  }

  /**
   * Get all ambulances
   */
  async getAmbulances() {
    const response = await this.client.get(API_CONFIG.AMBULANCES);
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
   * Get audit logs
   */
  async getAuditLogs(limit?: number) {
    const response = await this.client.get(API_CONFIG.AUDIT, {
      params: { limit },
    });
    return response.data;
  }
}

export default new ApiClient();
