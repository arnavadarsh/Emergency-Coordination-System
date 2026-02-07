/**
 * Token Storage Utility
 * Manages JWT token in localStorage
 */
class TokenStorage {
  private static readonly TOKEN_KEY = 'driver_jwt_token';

  static setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  static getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  static removeToken(): void {
    localStorage.removeItem(this.TOKEN_KEY);
  }

  static clearToken(): void {
    this.removeToken();
  }

  static hasToken(): boolean {
    return !!this.getToken();
  }
}

export const tokenStorage = TokenStorage;
export default TokenStorage;
