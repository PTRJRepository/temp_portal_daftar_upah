import axios from 'axios'

const TEST_MODE = (import.meta.env?.VITE_DEV_MODE === 'true') || (import.meta.env?.DEV_MODE === 'true')

// Get backend URL based on access mode
const getBackendURL = () => {
  // 0. Runtime toggle via localStorage: 'direct' = http://localhost:8002, 'proxy' = relative
  //     ponytail: toggle UI di TopBar (ApiBaseToggle). Upgrade: pindah ke settings page + persist per-user di backend.
  const mode = (() => {
    try { return window.localStorage?.getItem('api_base_mode') } catch { return null }
  })()
  if (mode === 'direct') {
    const directUrl = import.meta.env?.VITE_BACKEND_URL
      || `${window.location.protocol}//${window.location.hostname}:8002`
    console.log('API base mode: DIRECT ->', directUrl)
    return directUrl
  }
  if (mode === 'proxy') {
    console.log('API base mode: PROXY (relative)')
    return ''
  }

  // 1. Explicit VITE_BACKEND_URL from environment
  if (import.meta.env?.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL
  }

  // 1.5. Explicit proxy mode from environment (dev:proxy script)
  if (import.meta.env?.VITE_PROXY_MODE === 'true') {
    console.log('Explicit proxy mode enabled via VITE_PROXY_MODE, using relative path /backend/upah')
    return '/backend/upah'
  }

  // 2. Check if accessed via proxy gateway (port 3001 or path contains /upah/)
  const isProxyGateway = window.location.port === '3001' || window.location.pathname.startsWith('/upah')

  if (isProxyGateway) {
    // Use relative path that goes through proxy gateway
    // Proxy routes: /backend/upah -> localhost:8002
    console.log('Proxy gateway detected, using relative path /backend/upah')
    return '/backend/upah'
  }

  // 3. Default: Use relative path
  // This allows requests to go through the configured Proxy (Vite or Nginx)
  // which is safer and avoids CORS/host binding issues.
  // The Vite proxy is configured to forward /auth, /payroll, etc. to the backend.
  console.log('using relative backend path (via proxy)')
  return ''
}

const _url = getBackendURL()
axios.defaults.baseURL = _url

console.log('HTTP Setup - Backend URL:', _url)
console.log('Current Frontend Host:', window.location.hostname)

// Enable credentials for all requests (important for cookies)
axios.defaults.withCredentials = true

axios.interceptors.request.use(async (config) => {
  try {
    const start = Date.now()
    config.meta = Object.assign({}, config.meta, { start })
    if (TEST_MODE) {
      const u = (config.baseURL || '') + (config.url || '')
      const m = (config.method || 'get').toUpperCase()
      const p = config.params || {}
      console.log(`[HTTP] -> ${m} ${u}`, { params: p, headers: Object.keys(config.headers || {}) })
    }
  } catch (_) { }
  return config
})

axios.interceptors.response.use(
  (res) => {
    try {
      if (TEST_MODE) {
        const start = res.config?.meta?.start || Date.now()
        const dur = Date.now() - start
        const u = (res.config?.baseURL || '') + (res.config?.url || '')
        const m = (res.config?.method || 'get').toUpperCase()
        console.log(`[HTTP] <- ${m} ${u} ${res.status} ${dur}ms`, { length: Array.isArray(res.data) ? res.data.length : undefined })
      }
    } catch (_) { }
    return res
  },
  async (error) => {
    try {
      const cfg = error.config || {}
      const u = (cfg.baseURL || '') + (cfg.url || '')
      const m = (cfg.method || 'get').toUpperCase()
      const start = cfg.meta?.start || Date.now()
      const dur = Date.now() - start

      const status = error?.response?.status
      console.error(`[HTTP] !! ${m} ${u} ${status || 'ERR'} ${dur}ms`, { message: error.message })

      // Auto-Logout on 401 (Invalid Token) ONLY. 
      // Do NOT logout on 403 (Forbidden permissions)
      // Do NOT logout if request was to /auth/login (just a failed login attempt)
      if (status === 401 && !u.includes('/auth/login')) {
        console.warn('[HTTP] 401 Unauthorized. Clearing session and redirecting to login.')

        // In PROD MODE, we don't clear localStorage as it is managed by the gateway
        // But for safety in this specific app context, we might just redirect.
        // However, the request was: "etia tokennya sudah expired saya inign ke halaman login yang versi proxy"

        // Force Redirect to Proxy Login (Relative Path)
        window.location.href = '/login'
      }

    } catch (_) { }
    return Promise.reject(error)
  }
)


