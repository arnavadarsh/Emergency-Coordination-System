import axios, { AxiosInstance } from 'axios';
import { API_CONFIG } from '../config/api';
import TokenStorage from '../utils/tokenStorage';

/**
 * API Client for Driver Dashboard
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
    
    // Validate role
    if (response.data.user.role !== 'DRIVER') {
      throw new Error('Invalid credentials: Not a driver account');
    }
    
    TokenStorage.setToken(response.data.accessToken);
    return response.data;
  }

  /**
   * Get driver profile
   */
  async getDriverProfile() {
    const response = await this.client.get(API_CONFIG.DRIVER_PROFILE);
    return response.data;
  }

  /**
   * Get driver dispatches
   */
  async getDriverDispatches() {
    const response = await this.client.get(API_CONFIG.DRIVER_DISPATCHES);
    return response.data;
  }

  /**
   * Update dispatch status
   */
  async updateDispatchStatus(dispatchId: string, status: string) {
    const response = await this.client.patch(
      `${API_CONFIG.UPDATE_DISPATCH_STATUS}/${dispatchId}/status`,
      { status }
    );
    return response.data;
  }
}

export default new ApiClient();
