/**
 * Token Storage Utility
 * Manages JWT token and user data in localStorage
 */
class TokenStorage {
  private static readonly TOKEN_KEY = 'user_jwt_token';
  private static readonly USER_KEY = 'user_data';

  static setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  static getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  static setUser(user: any): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  static getUser(): any {
    const userData = localStorage.getItem(this.USER_KEY);
    if (!userData) return null;
    try {
      return JSON.parse(userData);
    } catch {
      // A damaged entry must not crash every page load; treat it as signed out.
      localStorage.removeItem(this.USER_KEY);
      return null;
    }
  }

  static getUserRole(): string | null {
    const user = this.getUser();
    return user?.role || null;
  }

  static removeToken(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
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
