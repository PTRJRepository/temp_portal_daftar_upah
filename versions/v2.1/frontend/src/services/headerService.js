import axios from 'axios'
import { isProdMode } from '../utils/prodModeUtils'

// Client-side cache for headers and columns
const headerCache = new Map()
const columnCache = new Map()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes in milliseconds
// In-flight request registries to prevent duplicate axios calls
const inFlightHeaders = new Map()
const inFlightColumns = new Map()

const DISABLE_CACHE = (import.meta.env?.VITE_DISABLE_CACHE === 'true')
  || (import.meta.env?.VITE_DEV_MODE === 'true')
  || (import.meta.env?.DEV_MODE === 'true')

const getCacheKey = (token, month, year, gangCode) => {
  return `${token || 'guest'}_${gangCode || 'all'}_${year || 'current'}_${month || 'current'}`
}

const getFromCache = (cache, key) => {
  if (DISABLE_CACHE) return null
  const cached = cache.get(key)
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`Cache hit for ${cache === headerCache ? 'headers' : 'columns'}: ${key}`)
    return cached.data
  }
  if (cached) {
    cache.delete(key) // Remove expired cache
  }
  return null
}

const setCache = (cache, key, data) => {
  if (DISABLE_CACHE) return
  cache.set(key, { data, timestamp: Date.now() })
  console.log(`Cached ${cache === headerCache ? 'headers' : 'columns'} for key: ${key}`)
}

export const fetchDynamicHeaders = async (token, month = null, year = null, gangCode = null) => {
  const cacheKey = getCacheKey(token, month, year, gangCode)

  // Try to get from cache first
  if (!DISABLE_CACHE) {
    const cachedHeaders = getFromCache(headerCache, cacheKey)
    if (cachedHeaders) {
      return cachedHeaders
    }
  }

  const params = {}
  if (month) params.month = month
  if (year) params.year = year
  if (gangCode) params.gang_code = gangCode

  // Add cache buster in development
  if (DISABLE_CACHE) {
    params._cb = Date.now()
    params._nocache = 'true'
  }

  const config = {
    params,
    timeout: 45000 // Increased timeout to 45 seconds for database queries
  }
  if (token) config.headers = { Authorization: `Bearer ${token}` }

  // Return existing in-flight promise if present (disabled in test/dev)
  if (!DISABLE_CACHE && inFlightHeaders.has(cacheKey)) {
    return await inFlightHeaders.get(cacheKey)
  }

  try {
    console.log(`[Headers API] Fetching dynamic headers for: ${gangCode || 'all'} ${month}-${year}`)
    console.log(`[Headers API] Request: GET /payroll/headers with params:`, JSON.stringify(params, null, 2))
    const startTime = Date.now()

    const promise = axios.get('/payroll/headers', config)
    if (!DISABLE_CACHE) inFlightHeaders.set(cacheKey, promise)
    const response = await promise
    const data = response.data

    const fetchTime = Date.now() - startTime
    console.log(`[Headers API] Response received in ${fetchTime}ms`)
    console.log(`[Headers API] Header structure:`, data ? '✅ Valid' : '❌ Empty')

    // Cache the response
    setCache(headerCache, cacheKey, data)
    if (!DISABLE_CACHE) inFlightHeaders.delete(cacheKey)

    return data
  } catch (e) {
    console.error('[Headers API] Failed to fetch dynamic headers:', e)
    if (!DISABLE_CACHE) inFlightHeaders.delete(cacheKey)

    // Enhanced error logging
    const errorDetails = {
      message: e.message,
      code: e.code,
      response: e.response?.status,
      responseText: e.response?.data?.detail || e.response?.data,
      url: '/payroll/headers',
      params: params,
      timestamp: new Date().toISOString()
    }
    console.error('[Headers API] Error details:', JSON.stringify(errorDetails, null, 2))

    // Direct error - no static fallback, always require database connection
    throw new Error(`Database connection failed for headers: ${e.message}. Status: ${e.response?.status || 'Network Error'}. Please check database connectivity and try again.`)
  }
}

/**
 * Fetch columns from locked endpoint (for production mode)
 * Uses /payroll/locked/columns which supports RS256 external tokens
 * NO FALLBACK - requires database connection
 */
const fetchLockedColumns = async (token, month = null, year = null, gangCode = null, division = null) => {
  // Get division from localStorage if not provided
  let div = division
  if (!div) {
    try {
      const userJson = localStorage.getItem('user')
      if (userJson) {
        const user = JSON.parse(userJson)
        div = user.divisi || user.divisions?.[0] || null

        // Try to extract from name if no explicit division
        if (!div && user.name) {
          const match = user.name.match(/\b(PGE?\s*\d+[A-Z]?)\b/i)
          if (match) div = match[1].toUpperCase().replace(/\s+/g, ' ')
        }
      }
    } catch (e) {
      console.error('[Columns API] Failed to get division from localStorage:', e)
    }
  }

  if (!div) {
    throw new Error('Division tidak ditemukan. Silakan login ulang atau hubungi administrator.')
  }

  const params = { div }
  if (month) params.month = month
  if (year) params.year = year
  if (gangCode) params.gang_code = gangCode

  // Add cache buster
  params._cb = Date.now()
  params._nocache = 'true'

  const config = {
    params,
    timeout: 45000,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  }

  console.log(`[Columns API] Fetching LOCKED columns from /payroll/locked/columns for div=${div}`)
  const startTime = Date.now()

  const response = await axios.get('/payroll/locked/columns', config)
  const data = response.data

  const fetchTime = Date.now() - startTime
  console.log(`[Columns API] LOCKED columns fetched in ${fetchTime}ms, count=${data?.length}`)

  if (!data || data.length === 0) {
    throw new Error('Struktur kolom tidak tersedia dari database. Silakan periksa koneksi database.')
  }

  return data
}

// NOTE: getStaticFallbackColumns has been removed.
// All column structures must now come from the database API.
// This ensures consistency and prevents hardcoded premi/potongan columns.

export const fetchColumnDefinitions = async (token, month = null, year = null, gangCode = null, division = null) => {
  // In PRODUCTION MODE, use the locked columns endpoint
  // This uses RS256 auth that works with the external token from localStorage
  if (isProdMode()) {
    console.log('[Columns API] Production mode: Using LOCKED columns endpoint')
    return await fetchLockedColumns(token, month, year, gangCode, division)
  }

  const cacheKey = getCacheKey(token, month, year, gangCode)

  // Try to get from cache first
  if (!DISABLE_CACHE) {
    const cachedColumns = getFromCache(columnCache, cacheKey)
    if (cachedColumns) {
      return cachedColumns
    }
  }

  const params = {}
  if (month) params.month = month
  if (year) params.year = year
  if (gangCode) params.gang_code = gangCode

  // Add cache buster in development
  if (DISABLE_CACHE) {
    params._cb = Date.now()
    params._nocache = 'true'
  }

  const config = {
    params,
    timeout: 45000 // Increased timeout to 45 seconds for database queries
  }
  if (token) config.headers = { Authorization: `Bearer ${token}` }

  if (!DISABLE_CACHE && inFlightColumns.has(cacheKey)) {
    return await inFlightColumns.get(cacheKey)
  }

  try {
    console.log(`Fetching column definitions for: ${gangCode || 'all'} ${month}-${year}`)
    const startTime = Date.now()

    const promise = axios.get('/payroll/columns', config)
    if (!DISABLE_CACHE) inFlightColumns.set(cacheKey, promise)
    const response = await promise
    const data = response.data

    const fetchTime = Date.now() - startTime
    console.log(`Column definitions fetched in ${fetchTime}ms`)
    console.log('[Columns API] Raw response data:', data)
    console.log('[Columns API] Data type:', typeof data)
    console.log('[Columns API] Is array?:', Array.isArray(data))
    console.log('[Columns API] Data length:', data?.length)

    // Cache the response
    setCache(columnCache, cacheKey, data)
    if (!DISABLE_CACHE) inFlightColumns.delete(cacheKey)

    return data
  } catch (e) {
    if (!DISABLE_CACHE) inFlightColumns.delete(cacheKey)

    // Try once more with fallback flag
    try {
      const fallbackParams = Object.assign({}, params, { fallback: true })
      const fallbackConfig = { params: fallbackParams, timeout: 10000 }
      if (token) fallbackConfig.headers = { Authorization: `Bearer ${token}` }
      const r = await axios.get('/payroll/columns', fallbackConfig)
      const data = r.data

      if (!data || data.length === 0) {
        throw new Error('Empty response from API')
      }

      setCache(columnCache, cacheKey, data)
      return data
    } catch (fallbackErr) {
      // NO STATIC FALLBACK - throw error with details
      console.error('[Columns API] All attempts failed:', e.message, fallbackErr?.message)
      throw new Error(`Gagal mengambil struktur kolom dari database. ${e.message}. Pastikan koneksi database berjalan dengan baik.`)
    }
  }
}

// Clear cache utility function
export const clearCache = () => {
  headerCache.clear()
  columnCache.clear()
  console.log('Header and column caches cleared')
}

// Cache status utility function
export const getCacheStatus = () => {
  return {
    headersCache: {
      size: headerCache.size,
      keys: Array.from(headerCache.keys())
    },
    columnsCache: {
      size: columnCache.size,
      keys: Array.from(columnCache.keys())
    }
  }
}

export const formatCurrency = (value) => {
  if (value === null || value === undefined) return '-'
  const n = Number(value)
  if (isNaN(n)) return 'Error'
  if (n === 0) return '-' // Treat 0 as - per convention

  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(n)
}

export const formatNumber = (value) => {
  if (value === null || value === undefined) return '-'
  const n = Number(value)
  if (isNaN(n)) return 'Error'
  if (n === 0) return '-'

  return new Intl.NumberFormat('id-ID').format(n)
}

export const getMonthName = (monthNumber) => {
  const months = [
    '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ]
  return months[monthNumber] || ''
}


// Auto-hide by zero totals has been removed; backend now filters dynamic headers
