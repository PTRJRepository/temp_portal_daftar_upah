import { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'
import { login as apiLogin, getMe, getTestToken } from '../services/authService'
import { verifyExternalToken } from '../services/lockedDivisionService'
import cookieService from '../services/cookieService'
import { isProdMode, getProdToken, getProdUser, getUserDivision, hasProdToken, redirectToExternalLogin } from '../utils/prodModeUtils'

// TEST_MODE tidak digunakan lagi - menggunakan cookies untuk session management
// const TEST_MODE = (import.meta.env?.VITE_DEV_MODE === 'true') || (import.meta.env?.DEV_MODE === 'true')

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  // Synchronous Initialization for Prod Mode
  const _inProdMode = isProdMode()
  let _initialToken = ''
  let _initialUser = null
  let _initialLoading = true
  let _initialLockedDiv = null

  // Try to load synchronously from localStorage
  if (_inProdMode && hasProdToken()) {
    const t = getProdToken()
    const u = getProdUser()

    if (t && u) {
      _initialToken = t

      const prodDivision = getUserDivision()
      const userRole = (u.role || '').toUpperCase()
      const isAdmin = userRole === 'ADMIN' || (u.divisi && u.divisi.toUpperCase() === 'ALL' && userRole !== 'VISITOR')

      _initialUser = {
        ...u,
        divisi: isAdmin || userRole === 'VISITOR' ? null : prodDivision,
        divisions: isAdmin || userRole === 'VISITOR' ? [] : (prodDivision ? [prodDivision] : []),
        isExternal: true,
        isProdMode: true,
        isAdmin: isAdmin,
        isVisitor: userRole === 'VISITOR'
      }

      _initialLockedDiv = isAdmin || userRole === 'VISITOR' ? null : prodDivision

      // Set default header immediately 
      axios.defaults.headers.common['Authorization'] = `Bearer ${t}`
      _initialLoading = false // Ready to go!
      console.log('[AuthContext] Synchronously restored Prod session', { user: _initialUser.username, isAdmin })
    }
  }

  const [token, setToken] = useState(_initialToken)
  const [user, setUser] = useState(_initialUser)
  const [loading, setLoading] = useState(_initialLoading)
  const [error, setError] = useState('')
  const [loginInProgress, setLoginInProgress] = useState(false) // Prevent multiple login attempts
  const [isExternalAuth, setIsExternalAuth] = useState(!!_initialToken) // Track if using external token
  const [lockedDivision, setLockedDivision] = useState(_initialLockedDiv) // Division locked from external token

  const checkAuth = async () => {
    try {
      // If we already loaded synchronously in prod mode, don't flicker loading state
      if (isProdMode() && token) {
        return true
      }

      setLoading(true)
      const inProdMode = isProdMode()
      console.log(`[AuthContext] Checking for authentication... (Prod Mode: ${inProdMode})`)

      // ========== PRODUCTION MODE (Port 3001) ==========
      // In Prod Mode, ONLY use localStorage tokens. Division is ALWAYS locked.
      if (inProdMode) {
        console.log('[AuthContext] Production mode detected, using localStorage auth')

        if (hasProdToken()) {
          const prodToken = getProdToken()
          // Verify token validity with backend
          // This prevents "zombie sessions" where localStorage has an expired token but the app loads anyway
          try {
            console.log('[AuthContext] Verifying production token...')
            // We use the same verification logic as external/gateway tokens
            const claims = await verifyExternalToken(prodToken)

            if (claims && claims.valid) {
              const prodUser = getProdUser()
              const prodDivision = getUserDivision()
              // ... rest of logic kept for re-checks if needed ...

              // Check if user is admin (role is ADMIN or divisi is ALL) - excluding VISITOR
              const userRole = (prodUser?.role || '').toUpperCase()
              const userDivisi = (prodUser?.divisi || '').toUpperCase()
              const isAdmin = userRole === 'ADMIN' || (userDivisi === 'ALL' && userRole !== 'VISITOR')

              // Set auth state from localStorage
              setToken(prodToken)
              setUser({
                ...prodUser,
                divisi: isAdmin || userRole === 'VISITOR' ? null : prodDivision,
                divisions: isAdmin || userRole === 'VISITOR' ? [] : (prodDivision ? [prodDivision] : []),
                isExternal: true,
                isProdMode: true,
                isAdmin: isAdmin,
                isVisitor: userRole === 'VISITOR'
              })
              setIsExternalAuth(true)
              setLockedDivision(isAdmin || userRole === 'VISITOR' ? null : prodDivision)
              axios.defaults.headers.common['Authorization'] = `Bearer ${prodToken}`
              setLoading(false)
              return true
            } else {
              console.warn('[AuthContext] Production token verification failed (expired or invalid)')
              redirectToExternalLogin()
              return false
            }
          } catch (e) {
            console.error('[AuthContext] Error verifying production token:', e)
            redirectToExternalLogin()
            return false
          }
        }

        console.log('[AuthContext] No specific production token found, checking for internal cookies...')
        // Fall through to cookie check instead of returning false immediately
      }

      // ========== DEVELOPMENT MODE ==========
      // Priority 1: Check for external token from localStorage (gateway auth)
      if (cookieService.hasExternalToken()) {
        console.log('[AuthContext] Found external token in localStorage, verifying...')
        const externalToken = cookieService.getExternalToken()

        try {
          // Verify token with backend using RS256
          const claims = await verifyExternalToken(externalToken)

          if (claims && claims.valid) {
            console.log('[AuthContext] External token verified successfully')

            // Try to get full user details from localStorage to ensure 'divisi' and other fields are present
            const storedUser = cookieService.getExternalUser()

            setToken(externalToken)
            setUser({
              ...storedUser, // Merge with stored user first
              username: claims.username,
              role: claims.role || storedUser?.role || 'user',
              divisions: claims.divisions || [claims.division].filter(Boolean),
              // Ensure we have the division info for auto-selection
              divisi: claims.division || storedUser?.division || storedUser?.kode_lokasi || storedUser?.unit || storedUser?.divisi || storedUser?.divisions?.[0],
              isExternal: true
            })
            setIsExternalAuth(true)
            setLockedDivision(claims.division || null)
            axios.defaults.headers.common['Authorization'] = `Bearer ${externalToken}`
            setLoading(false)
            return true
          } else {
            console.warn('[AuthContext] Token verification returned invalid status')
            throw new Error('Invalid token status')
          }
        } catch (verifyError) {
          console.error('[AuthContext] External token verification failed:', verifyError)
          // Clear auth and let them login again
          setToken('')
          setUser(null)
          setIsExternalAuth(false)
          setLockedDivision(null)
          setLoading(false)
          return false
        }
      }

      // Priority 2: Check saved authentication in cookies (internal auth)
      console.log('[AuthContext] Checking for saved authentication in cookies')
      const savedToken = cookieService.getToken()
      const savedUser = cookieService.getUser()

      if (savedToken && savedUser) {
        console.log('[AuthContext] Restoring authentication from cookies')
        setToken(savedToken)
        setUser(savedUser)
        setIsExternalAuth(false)
        setLockedDivision(null)
        axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`
        setLoading(false)
        return true
      }

      console.log('[AuthContext] No saved authentication found')
      setToken('')
      setUser(null)
      setIsExternalAuth(false)
      setLockedDivision(null)
      setLoading(false)
      return false
    } catch (error) {
      console.error('[AuthContext] Error checking authentication:', error)
      setLoading(false)
      return false
    }
  }

  useEffect(() => {
    checkAuth()
  }, [])

  // Setup axios response interceptor to handle 401 errors globally
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response, // Pass through successful responses
      (error) => {
        // If we get a 401 Unauthorized error
        if (error.response?.status === 401) {
          console.warn('[AuthContext] 401 Unauthorized detected')

          // In PRODUCTION MODE: Do NOT clear localStorage tokens
          // The external auth system manages these tokens
          // Just log the error but don't trigger a full logout
          if (isProdMode()) {
            console.warn('[AuthContext] Prod mode: 401 error - redirecting to login')
            // Clear in-memory state and redirect to login
            setError('Sesi expired. Mengalihkan ke halaman login...')
            setToken('')
            setUser(null)
            // Redirect to login page (relative URL for proxy compatibility)
            setTimeout(() => {
              window.location.href = '/login'
            }, 1500)
            return Promise.reject(error)
          }

          // DEV MODE: Clear auth data and redirect to login
          console.warn('[AuthContext] Dev mode: Redirecting to login due to 401')
          try {
            cookieService.clearAuth()
            delete axios.defaults.headers.common['Authorization']
          } catch (e) {
            console.error('[AuthContext] Error clearing auth on 401:', e)
          }
          setToken('')
          setUser(null)
          setError('Session expired. Mengalihkan ke halaman login...')
          // Redirect to login page (relative URL)
          setTimeout(() => {
            window.location.href = '/login'
          }, 1500)
        }
        return Promise.reject(error)
      }
    )

    // Cleanup interceptor on unmount
    return () => {
      axios.interceptors.response.eject(interceptor)
    }
  }, []) // Empty dependency array - setup once on mount


  // Auto-login moved to LoginPage in test mode to show the login UI while submitting automatically

  async function login(username, password, rememberMe = true) {
    // Di PROXY MODE (prod), internal login dinonaktifkan
    // User harus login via gateway/proxy
    if (isProdMode()) {
      console.error('[Auth] Proxy mode: Internal login is DISABLED. Please use gateway login.')
      alert('Login internal tidak tersedia dalam mode proxy.\nSilakan login melalui halaman gateway.')
      // Redirect ke gateway login
      redirectToExternalLogin()
      return false
    }

    // Prevent multiple simultaneous login attempts
    if (loginInProgress) {
      console.log('[Auth] Login already in progress, skipping duplicate request')
      return false
    }

    setLoading(true)
    setLoginInProgress(true)
    setError('')
    console.log('[Auth] Starting login process for username:', username)

    try {
      const res = await apiLogin(username, password)
      const tok = res?.access_token
      let usr = res?.user

      console.log('[Auth] Login API response received')

      if (!usr && tok) {
        try {
          console.log('[Auth] Fetching user details with token')
          usr = await getMe(tok)
        } catch (error) {
          console.error('[Auth] Failed to fetch user details:', error)
        }
      }

      if (tok && usr) {
        console.log('[Auth] Login successful, setting authentication state')
        setToken(tok)
        setUser(usr)
        try {
          // Save token and user info using cookieService
          cookieService.saveToken(tok, rememberMe)
          cookieService.saveUser(usr)
          cookieService.saveRememberMe(rememberMe)
          axios.defaults.headers.common['Authorization'] = `Bearer ${tok}`
          console.log('[Auth] Authentication saved to cookies successfully (rememberMe:', rememberMe, ')')
        } catch (error) {
          console.error('[Auth] Failed to save authentication to cookies:', error)
        }
        return true
      }
      throw new Error('Missing token or user')
    } catch (e) {
      console.error('[Auth] Login failed:', e.message)
      // Test token fallback removed - menggunakan cookies untuk session management

      setError('Login failed')
      return false
    } finally {
      setLoading(false)
      setLoginInProgress(false)
    }
  }

  const logout = () => {
    // Hapus SEMUA token dan auth data (internal + proxy/gateway)
    try {
      if (typeof window !== 'undefined') {
        // 1. Hapus token internal (daftar upah service)
        window.localStorage.removeItem('auth-token')
        window.localStorage.removeItem('user')
        window.localStorage.removeItem('disable-cache')
        window.localStorage.removeItem('payroll_remember_me')

        // 2. Hapus token proxy/gateway yang mungkin ada di localStorage
        // Gateway/proxy biasanya menyimpan token dengan nama berbeda
        const gatewayTokenKeys = [
          'gateway-token',
          'proxy-token',
          'connect.sid',      // Session ID express
          'jwt-token',        // JWT token umum
          'access-token',     // Access token umum
          'auth_token',       // Versi underscore
          'session-token',    // Session token
          'app-token'         // App token
        ]

        gatewayTokenKeys.forEach(key => {
          window.localStorage.removeItem(key)
          window.sessionStorage.removeItem(key)
        })

        // 3. Hapus SEMUA localStorage untuk memastikan tidak ada token tertinggal
        // (Opsional - uncomment jika ingin membersihkan SEMUA data)
        // window.localStorage.clear()

        // 4. Hapus dari sessionStorage
        window.sessionStorage.removeItem('auth-token')
        window.sessionStorage.removeItem('user')

        // 5. Hapus cookies yang mungkin ditinggalkan oleh proxy/gateway
        const cookiesToClear = [
          'auth-token',
          'user',
          'token',
          'authorization',
          'connect.sid',
          'gateway-token',
          'jwt-token',
          'access-token'
        ]
        const paths = ['/', '/upah', '/upah/']
        const domains = [window.location.hostname, `.${window.location.hostname}`]

        cookiesToClear.forEach(key => {
          paths.forEach(p => {
            document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${p}; SameSite=Lax;`
            domains.forEach(d => {
              document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${p}; domain=${d}; SameSite=Lax;`
            })
          })
        })

        console.log('[Auth] Cleared ALL auth data (internal + proxy/gateway tokens)')
      }
    } catch (e) {
      console.error('[Auth] Failed to clear external tokens from localStorage:', e)
    }

    // In PRODUCTION MODE (Proxy):
    // Clear auth data dan redirect ke gateway login page
    if (isProdMode()) {
      console.log('[Auth] Proxy mode: Clearing auth and redirecting to gateway')

      delete axios.defaults.headers.common['Authorization']
      setToken('')
      setUser(null)

      // Redirect ke gateway root login
      // Backend akan serve gateway login page, bukan React app
      const gatewayUrl = `${window.location.origin}/login`

      console.log('[Auth] Redirecting to gateway:', gatewayUrl)

      // Force redirect ke gateway login
      window.location.href = gatewayUrl
      return
    }

    // DEV MODE: Clear all authentication data
    try {
      cookieService.clearAuth()
      delete axios.defaults.headers.common['Authorization']
      console.log('[Auth] Logged out successfully, authentication data cleared')
    } catch (error) {
      console.error('[Auth] Error during logout:', error)
      // Fallback manual cleanup
      try {
        document.cookie = 'auth_token=; Max-Age=0; path=/'
        document.cookie = 'payroll_user_info=; Max-Age=0; path=/'
        localStorage.removeItem('payroll_remember_me')
      } catch (_) { }
    }
    setToken('')
    setUser(null)
  }

  const isAuthenticated = !!token
  return (
    <AuthCtx.Provider value={{
      token,
      isAuthenticated,
      user,
      login,
      logout,
      loading,
      error,
      checkAuth,
      isExternalAuth,
      lockedDivision,
      isKeraniUser: (user?.role || '').toLowerCase() === 'kerani',
      isVisitorUser: (user?.role || '').toLowerCase() === 'visitor' || user?.isVisitor
    }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  return useContext(AuthCtx)
}
