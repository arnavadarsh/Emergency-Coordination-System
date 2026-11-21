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
          // The server does not accept this session. Clear it and go to
          // sign-in, which this app serves at the root — '/login' was not a
          // route, so the old redirect landed on nothing.
          TokenStorage.removeToken();
          window.location.href = '/';
        } else if (error.response?.status === 403) {
          // The account is valid but may not do this particular thing. That is
          // not a reason to sign a patient out mid-emergency — surface it to
          // the caller and leave the session alone.
          console.error('[User Dashboard] Request refused (403):', error.response?.config?.url);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Check credentials and return the session, WITHOUT storing it.
   *
   * This app hosts the shared sign-in as well as the patient dashboard, and a
   * browser origin has one storage slot. Persisting every successful sign-in
   * here meant that signing in as a driver, hospital or admin overwrote a
   * patient who was already signed in — mid-case — even though that session was
   * only passing through on its way to another app.
   *
   * The caller stores it when, and only when, it belongs to this origin.
   */
  async authenticate(email: string, password: string) {
    const response = await this.client.post(API_CONFIG.LOGIN, {
      email,
      password,
    });
    return response.data;
  }
}

export default new ApiClient();
