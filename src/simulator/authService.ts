/**
 * Authentication service for connecting to robots-gateway
 * Uses the same URL configuration as the dev.ts
 */

const LOCAL = typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const CLOUD_RUN_HOST = 'robots-gateway-779307899828.us-west2.run.app';
const GATEWAY_URL = LOCAL
  ? 'http://localhost:8080'
  : `https://${CLOUD_RUN_HOST}`;

export interface AuthResponse {
  sessUuid: string;
  name: string;
}

export interface UserSession {
  sessUuid: string;
  name: string;
  userUuid?: string;
  email?: string;
  username?: string;
  admin?: boolean;
  emailVerified?: boolean;
  flags?: Record<string, unknown>;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Check if user is currently authenticated
 */
export function isAuthenticated(): boolean {
  return !!getSession();
}

/**
 * Get current session from localStorage
 */
export function getSession(): UserSession | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const session = localStorage.getItem('orobot_session');
    return session ? JSON.parse(session) : null;
  } catch {
    return null;
  }
}

/**
 * Save session to localStorage
 */
export function saveSession(session: UserSession): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem('orobot_session', JSON.stringify(session));
  if (typeof document !== 'undefined') {
    document.cookie = `_osess=${session.sessUuid}; path=/`;
  }
}

/**
 * Clear session from localStorage
 */
export function clearSession(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.removeItem('orobot_session');
  if (typeof document !== 'undefined') {
    document.cookie = '_osess=; Max-Age=0; path=/';
  }
}

/**
 * Perform login with email/identifier and password
 */
export async function login(identifier: string, password: string): Promise<UserSession> {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ 
        email: identifier.includes('@') ? identifier : undefined,
        identifier: !identifier.includes('@') ? identifier : undefined,
        password 
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AuthError(
        errorData.error || `Login failed: ${response.status}`,
        response.status,
        errorData.code
      );
    }

    const data: AuthResponse = await response.json();
    
    // Try to get user info
    let userInfo = { name: data.name };
    try {
      const userResponse = await fetch(`${GATEWAY_URL}/api/users/me`, {
        credentials: 'include',
      });
      if (userResponse.ok) {
        const userData = await userResponse.json();
        userInfo = { ...userInfo, ...userData };
      }
    } catch {
      // Ignore - we'll just use the basic info
    }

    const session: UserSession = {
      sessUuid: data.sessUuid,
      ...userInfo
    };
    
    saveSession(session);
    return session;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      error instanceof Error ? error.message : 'Network error during login'
    );
  }
}

/**
 * Perform signup with username, email, and password
 */
export async function signup(username: string, password: string, email?: string): Promise<UserSession> {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ username, email, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AuthError(
        errorData.error || `Signup failed: ${response.status}`,
        response.status,
        errorData.code
      );
    }

    const data: AuthResponse = await response.json();
    
    const session: UserSession = {
      sessUuid: data.sessUuid,
      name: data.name,
      username,
      email
    };
    
    saveSession(session);
    return session;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      error instanceof Error ? error.message : 'Network error during signup'
    );
  }
}

/**
 * Perform logout
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/api/session`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    // Ignore errors during logout
  }
  
  clearSession();
}

/**
 * Start password reset process
 */
export async function startPasswordReset(email: string): Promise<void> {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/start-password-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AuthError(
        errorData.error || `Password reset failed: ${response.status}`,
        response.status,
        errorData.code
      );
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      error instanceof Error ? error.message : 'Network error during password reset'
    );
  }
}

/**
 * Reset password with token
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  try {
    const response = await fetch(`${GATEWAY_URL}/api/password-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AuthError(
        errorData.error || `Password reset failed: ${response.status}`,
        response.status,
        errorData.code
      );
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      error instanceof Error ? error.message : 'Network error during password reset'
    );
  }
}

/**
 * Verify email with token
 */
export async function verifyEmail(token: string): Promise<void> {
  const session = getSession();
  if (!session) {
    throw new AuthError('Session expired. Please login again.');
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/api/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (errorData.reason === 'invalid') {
        throw new AuthError('Invalid or expired verification token');
      }
      throw new AuthError(
        errorData.error || `Email verification failed: ${response.status}`,
        response.status,
        errorData.code
      );
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      error instanceof Error ? error.message : 'Network error during email verification'
    );
  }
}

/**
 * Resend verification email
 */
export async function resendVerification(): Promise<void> {
  const session = getSession();
  if (!session) {
    throw new AuthError('Session expired. Please login again.');
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/api/resend-verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (errorData.err === 'rate_limited') {
        throw new AuthError('Please wait before requesting another verification email');
      }
      throw new AuthError(
        errorData.error || `Resend verification failed: ${response.status}`,
        response.status,
        errorData.code
      );
    }

    const data = await response.json();
    if (data.alreadyVerified) {
      throw new AuthError('Email is already verified');
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      error instanceof Error ? error.message : 'Network error during resend verification'
    );
  }
}

/**
 * Get current user info
 */
export async function getCurrentUser(): Promise<UserSession | null> {
  const session = getSession();
  if (!session) {
    return null;
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/api/users/me`, {
      credentials: 'include',
    });

    if (!response.ok) {
      // If unauthorized, clear session
      if (response.status === 401) {
        clearSession();
        return null;
      }
      throw new AuthError(`Failed to get user info: ${response.status}`, response.status);
    }

    const userData = await response.json();
    const updatedSession: UserSession = {
      ...session,
      ...userData
    };
    
    saveSession(updatedSession);
    return updatedSession;
  } catch {
    return session; // Return cached session on error
  }
}

/**
 * Create authenticated fetch wrapper
 */
export function createAuthenticatedFetch() {
  const session = getSession();
  
  return async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...options.headers,
      'Content-Type': 'application/json',
    };

    return fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  };
}
