// Cookie Service untuk menyimpan informasi login dan session
import Cookies from 'js-cookie'

const TOKEN_KEY = 'payroll_auth_token'
const USER_KEY = 'payroll_user_info'
const REMEMBER_KEY = 'payroll_remember_me'

// Use localStorage for token persistence (more reliable than cookies across sessions)
// localStorage persists until explicitly cleared, survives browser restarts
const LOCAL_TOKEN_KEY = 'payroll_auth_token_local'

export const cookieService = {
  // Save authentication token - uses localStorage for persistence
  saveToken: (token, rememberMe = false) => {
    try {
      // Always use localStorage for token - cookies are unreliable across sessions
      localStorage.setItem(LOCAL_TOKEN_KEY, token)
      localStorage.setItem(REMEMBER_KEY, rememberMe)
      console.log('[CookieService] Token saved to localStorage successfully')
    } catch (error) {
      console.error('[CookieService] Failed to save token:', error)
      // Fallback to cookie if localStorage fails
      try {
        Cookies.set(TOKEN_KEY, token, {
          expires: rememberMe ? 30 : 7,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'Lax', // Changed from 'strict' to 'Lax' for better compatibility
          path: '/'
        })
      } catch (fallbackError) {
        console.error('[CookieService] Fallback cookie save also failed:', fallbackError)
      }
    }
  },

  // Get authentication token - checks localStorage first, then falls back to cookie
  getToken: () => {
    try {
      // Try localStorage first (primary storage)
      const localToken = localStorage.getItem(LOCAL_TOKEN_KEY)
      if (localToken) {
        return localToken
      }
      // Fallback to cookie
      return Cookies.get(TOKEN_KEY)
    } catch (error) {
      console.error('[CookieService] Failed to get token:', error)
      return null
    }
  },

  // Save user information - uses localStorage for persistence
  saveUser: (user) => {
    try {
      // Use localStorage for user data - more reliable than cookies
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      console.log('[CookieService] User info saved to localStorage:', { username: user.username, divisions: user.divisions?.length })
    } catch (error) {
      console.error('[CookieService] Failed to save user:', error)
    }
  },

  // Get user information - checks localStorage first, then falls back to cookie
  getUser: () => {
    try {
      // Try localStorage first (primary storage)
      const userJson = localStorage.getItem(USER_KEY)
      if (userJson) {
        return JSON.parse(userJson)
      }
      // Fallback to cookie
      const cookieUser = Cookies.get(USER_KEY)
      return cookieUser ? JSON.parse(cookieUser) : null
    } catch (error) {
      console.error('[CookieService] Failed to get user:', error)
      return null
    }
  },

  // Save remember me preference
  saveRememberMe: (rememberMe) => {
    try {
      localStorage.setItem(REMEMBER_KEY, rememberMe)
      if (!rememberMe) {
        // Jika tidak remember me, hapus token yang ada
        cookieService.clearToken()
        cookieService.clearUser()
      }
    } catch (error) {
      console.error('[CookieService] Failed to save remember me:', error)
    }
  },

  // Get remember me preference
  getRememberMe: () => {
    try {
      return localStorage.getItem(REMEMBER_KEY) === 'true'
    } catch (error) {
      console.error('[CookieService] Failed to get remember me:', error)
      return false
    }
  },

  // Clear all authentication data
  clearAuth: () => {
    try {
      // Clear localStorage token (primary storage)
      localStorage.removeItem(LOCAL_TOKEN_KEY)
      localStorage.removeItem(REMEMBER_KEY)
      // Also clear cookie for safety
      Cookies.remove(TOKEN_KEY, { path: '/' })
      Cookies.remove(USER_KEY, { path: '/' })
      console.log('[CookieService] Authentication data cleared')
    } catch (error) {
      console.error('[CookieService] Failed to clear auth data:', error)
    }
  },

  // Clear token only
  clearToken: () => {
    try {
      // Clear localStorage token (primary storage)
      localStorage.removeItem(LOCAL_TOKEN_KEY)
      // Also clear cookie for safety
      Cookies.remove(TOKEN_KEY, { path: '/' })
    } catch (error) {
      console.error('[CookieService] Failed to clear token:', error)
    }
  },

  // Clear user info only
  clearUser: () => {
    try {
      // Clear localStorage user (primary storage)
      localStorage.removeItem(USER_KEY)
      // Also clear cookie for safety
      Cookies.remove(USER_KEY, { path: '/' })
    } catch (error) {
      console.error('[CookieService] Failed to clear user:', error)
    }
  },

  // Check if user is logged in
  isLoggedIn: () => {
    const token = cookieService.getToken()
    const user = cookieService.getUser()
    return !!(token && user)
  },

  // Get authentication header
  getAuthHeader: () => {
    const token = cookieService.getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  },

  // ========== External Token Functions ==========
  // For tokens from external systems (e.g., gateway auth) stored in localStorage

  // External token key (from gateway/dashboard system)
  EXTERNAL_TOKEN_KEY: 'auth-token',

  // Get external token from localStorage (cross-origin shared token)
  getExternalToken: () => {
    try {
      return localStorage.getItem('auth-token')
    } catch (error) {
      console.error('[CookieService] Failed to get external token:', error)
      return null
    }
  },

  // Check if external token exists
  hasExternalToken: () => {
    try {
      const token = localStorage.getItem('auth-token')
      return !!(token && token.length > 0)
    } catch (error) {
      console.error('[CookieService] Failed to check external token:', error)
      return false
    }
  },

  // Get external user from localStorage
  getExternalUser: () => {
    try {
      const userJson = localStorage.getItem('user')
      return userJson ? JSON.parse(userJson) : null
    } catch (error) {
      console.error('[CookieService] Failed to get external user:', error)
      return null
    }
  },

  // Get authentication header for external token
  getExternalAuthHeader: () => {
    try {
      const token = localStorage.getItem('auth-token')
      return token ? { Authorization: `Bearer ${token}` } : {}
    } catch (error) {
      console.error('[CookieService] Failed to get external auth header:', error)
      return {}
    }
  }
}

export default cookieService