/**
 * Production Mode Utilities
 * Handles authentication and routing for production mode (port 3001)
 * 
 * In production mode:
 * - Token is sourced from localStorage 'auth-token'
 * - User data is sourced from localStorage 'user'
 * - Division is locked (cannot be changed manually)
 * - Login redirects to external gateway login page
 */

// Keys used in localStorage (synced with proxy gateway)
export const PROD_STORAGE_KEYS = {
    AUTH_TOKEN: 'auth-token',
    USER: 'user',
    DISABLE_CACHE: 'disable-cache',
    REMEMBER_ME: 'payroll_remember_me'
}

/**
 * Check if running in production mode (port 3001 or production build)
 */
export const isProdMode = () => {
    // Check if running in production build OR accessed via port 3001
    return import.meta.env.PROD || window.location.port === '3001' || import.meta.env.NODE_ENV === 'production'
}

/**
 * Get the base path for the application
 * In proxy mode (port 3001, VITE_BACKEND_HOST set, or production build), returns '/upah'
 * In direct mode, returns ''
 *
 * NOTE: Cache the base path on first call because window.location.pathname might not be
 * stable during initial React render (e.g., in new tabs opening via window.open)
 */
let cachedBasePath = null;
export const getBasePath = () => {
    if (cachedBasePath !== null) {
        return cachedBasePath;
    }
    // If the browser URL actually starts with /upah, we must be in proxy mode
    // and React Router needs /upah as its basename. Otherwise, if testing locally
    // at root (e.g., /login), the basename must be empty string to avoid Router crash.
    if (window.location.pathname.startsWith('/upah')) {
        cachedBasePath = '/upah';
    } else {
        cachedBasePath = '';
    }
    return cachedBasePath;
}

/**
 * Build a full application path with base path
 * @param {string} path - The relative path (e.g., '/employee/detail')
 * @returns {string} - Full path with base prefix if needed
 */
export const buildAppPath = (path) => {
    const basePath = getBasePath()
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${basePath}${normalizedPath}`
}

/**
 * Get the base URL for external login (gateway login page)
 * Preserves the current origin (e.g., http://ptrjestate.rebinmas.com:3001)
 */
export const getExternalLoginUrl = () => {
    const origin = window.location.origin
    // The gateway login page is at the root /login path
    return `${origin}/login`
}

/**
 * Get auth token from localStorage for production mode
 */
export const getProdToken = () => {
    try {
        return localStorage.getItem(PROD_STORAGE_KEYS.AUTH_TOKEN)
    } catch (e) {
        console.error('[ProdMode] Failed to get auth token:', e)
        return null
    }
}

/**
 * Check if production token exists
 */
export const hasProdToken = () => {
    const token = getProdToken()
    return !!(token && token.length > 0)
}

/**
 * Get user data from localStorage for production mode
 * Structure: { id, name, email, role, createdAt, updatedAt, divisi?, divisions? }
 */
export const getProdUser = () => {
    try {
        const userJson = localStorage.getItem(PROD_STORAGE_KEYS.USER)
        return userJson ? JSON.parse(userJson) : null
    } catch (e) {
        console.error('[ProdMode] Failed to get user data:', e)
        return null
    }
}

/**
 * Extract division from user data
 * Priority:
 * 1. user.divisi (explicit division field)
 * 2. user.divisions[0] (first division in array)
 * 3. Extract from user.name (e.g., "Kerani PG1A" -> "PG1A")
 * 4. null if no division found
 */
export const getUserDivision = () => {
    try {
        const user = getProdUser()
        if (!user) return null

        // Priority 1: Explicit division fields (check multiple common keys from proxy)
        if (user.division) return user.division
        if (user.kode_lokasi) return user.kode_lokasi
        if (user.unit) return user.unit
        if (user.location) return user.location
        if (user.loc_code) return user.loc_code
        if (user.divisi) return user.divisi

        // Priority 2: First division in divisions array  
        if (user.divisions && user.divisions.length > 0) {
            return user.divisions[0]
        }

        // Priority 3: Extract from name (e.g., "Kerani PG1A" -> "PG1A")
        // Common patterns: "Kerani PGE 1A", "Mandor PGE 1B", etc.
        if (user.name) {
            // Pattern for division codes like "PGE 1A", "PGE 1B", "PG1A", "PG1B", etc.
            const divisionPatterns = [
                /\b(PGE?\s*\d+[A-Z]?)\b/i,  // Matches "PGE 1A", "PG1A", "PGE 1", etc.
                /\b(DIV\s*\d+[A-Z]?)\b/i,    // Matches "DIV 1A", "DIV1B", etc.
                /\b([A-Z]{2,3}\s*\d+[A-Z]?)\b/i // Generic 2-3 letter code + number + optional letter
            ]

            for (const pattern of divisionPatterns) {
                const match = user.name.match(pattern)
                if (match) {
                    return match[1].toUpperCase().replace(/\s+/g, ' ')
                }
            }
        }

        return null
    } catch (e) {
        console.error('[ProdMode] Failed to extract user division:', e)
        return null
    }
}

/**
 * Redirect to external login page (for production mode)
 */
export const redirectToExternalLogin = () => {
    // Redirect langsung ke gateway root login
    // Backend akan serve gateway login page (bukan React app)
    const gatewayUrl = `${window.location.origin}/login`

    console.log('[ProdMode] Redirecting to gateway login:', gatewayUrl)

    // Force full page redirect ke gateway
    window.location.href = gatewayUrl
}

/**
 * Check if the current user is an admin or has full access
 * @returns {boolean} - True if user role is ADMIN or divisi is ALL
 */
export const isUserAdmin = () => {
    try {
        const user = getProdUser()
        if (!user) return false

        const role = (user.role || '').toUpperCase()
        const divisi = (user.divisi || '').toUpperCase()

        // Admin if role is ADMIN or divisi is ALL
        return role === 'ADMIN' || divisi === 'ALL'
    } catch (e) {
        console.error('[ProdMode] Failed to check admin status:', e)
        return false
    }
}

/**
 * Get complete production auth data
 */
export const getProdAuthData = () => {
    return {
        token: getProdToken(),
        user: getProdUser(),
        division: getUserDivision(),
        hasToken: hasProdToken(),
        isAdmin: isUserAdmin()
    }
}

export default {
    isProdMode,
    getBasePath,
    buildAppPath,
    getExternalLoginUrl,
    getProdToken,
    hasProdToken,
    getProdUser,
    getUserDivision,
    redirectToExternalLogin,
    getProdAuthData,
    PROD_STORAGE_KEYS
}
