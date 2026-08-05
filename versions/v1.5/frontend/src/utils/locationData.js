/**
 * Indonesian Location Data Utility
 * Data sourced from ibnux.github.io/data-indonesia (DAFTAR-API-LOKAL-INDONESIA)
 *
 * Base API: https://ibnux.github.io/data-indonesia/
 * Endpoints:
 *   - /provinsi.json         → All provinces
 *   - /kabupaten/{id}.json   → Regencies by province ID
 *   - /kecamatan/{id}.json   → Districts by regency ID
 *   - /kelurahan/{id}.json   → Villages by district ID
 */

const API_BASE = 'https://ibnux.github.io/data-indonesia'

// Cache for location data (persists during session)
const cache = {
  provinces: null,
  regencies: {},     // { provinceId: [...] }
  districts: {},      // { regencyId: [...] }
  villages: {},       // { districtId: [...] }
  loading: {
    provinces: false,
    regencies: {},
    districts: {}
  }
}

// Generate loading messages from location data
function generateLocationMessages() {
  const messages = []
  const provinces = cache.provinces || []

  // Messages about Indonesia in general
  messages.push('Indonesia memiliki 38 provinsi dan 514 kabupaten/kota')
  messages.push('Data wilayah Indonesia mencakup hingga tingkat desa/kelurahan')
  messages.push('Total terdapat 7.000+ kecamatan dan 80.000+ desa di Indonesia')
  messages.push('PT Rebinmas Jaya beroperasi di wilayah Sumatera Selatan')

  if (provinces.length > 0) {
    // Pick 5 random provinces (with defensive null check)
    const shuffled = [...provinces].sort(() => Math.random() - 0.5).slice(0, 5)
    shuffled.forEach(prov => {
      if (prov?.name) {
        messages.push(`Memuat data wilayah: Provinsi ${prov.name}`)
      }
    })

    // Generate regency-level messages
    Object.values(cache.regencies).slice(0, 5).forEach(regencies => {
      if (regencies && regencies.length > 0) {
        const reg = regencies[Math.floor(Math.random() * regencies.length)]
        if (reg?.name) {
          messages.push(`Kabupaten/Kota: ${reg.name}`)
        }
      }
    })
  }

  // Specific location messages related to PT Rebinmas area (Sumatera Selatan)
  const sumateraSelatan = provinces.find(p =>
    p?.name && p.name.toLowerCase().includes('sumatera selatan')
  )
  if (sumateraSelatan) {
    const regencies = cache.regencies[sumateraSelatan.id]
    if (regencies) {
      regencies.forEach(reg => {
        if (reg?.name) {
          messages.push(`Memuat data ${reg.name}, Sumatera Selatan`)
        }
      })
    }
  }

  // General data loading messages with locations
  messages.push('Menghubungi server di Jakarta, Bandung, Surabaya, dan Semarang')
  messages.push('Sinkronisasi data dari berbagai数据中心 wilayah Indonesia')
  messages.push('Mengakses database region Sumatera, Jawa, Kalimantan, dan Sulawesi')
  messages.push('Memuat referensi kode wilayah untuk 38 provinsi Indonesia')

  return messages
}

/**
 * Fetch all provinces from ibnux API
 */
export async function fetchProvinces() {
  if (cache.provinces) return cache.provinces
  if (cache.loading.provinces) return null

  cache.loading.provinces = true
  try {
    const res = await fetch(`${API_BASE}/provinsi.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    cache.provinces = (data || []).map(item => ({
      id: String(item?.id || ''),
      name: item?.name || ''
    })).filter(p => p.id && p.name) // Filter out any null/undefined entries
    return cache.provinces
  } catch (err) {
    console.warn('[LocationData] Failed to fetch provinces:', err.message)
    return null
  } finally {
    cache.loading.provinces = false
  }
}

/**
 * Fetch regencies for a given province ID
 */
export async function fetchRegencies(provinceId) {
  if (cache.regencies[provinceId]) return cache.regencies[provinceId]
  if (cache.loading.regencies[provinceId]) return null

  cache.loading.regencies[provinceId] = true
  try {
    const res = await fetch(`${API_BASE}/kabupaten/${provinceId}.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    cache.regencies[provinceId] = (data || []).map(item => ({
      id: String(item?.id || ''),
      name: item?.name || '',
      provinceId: String(provinceId)
    })).filter(r => r.id && r.name)
    return cache.regencies[provinceId]
  } catch (err) {
    console.warn(`[LocationData] Failed to fetch regencies for province ${provinceId}:`, err.message)
    return null
  } finally {
    cache.loading.regencies[provinceId] = false
  }
}

/**
 * Fetch districts for a given regency ID
 */
export async function fetchDistricts(regencyId) {
  if (cache.districts[regencyId]) return cache.districts[regencyId]

  try {
    const res = await fetch(`${API_BASE}/kecamatan/${regencyId}.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    cache.districts[regencyId] = (data || []).map(item => ({
      id: String(item?.id || ''),
      name: item?.name || '',
      regencyId: String(regencyId)
    })).filter(d => d.id && d.name)
    return cache.districts[regencyId]
  } catch (err) {
    console.warn(`[LocationData] Failed to fetch districts for regency ${regencyId}:`, err.message)
    return null
  }
}

/**
 * Initialize location data by fetching provinces and key regencies
 * Call this once at app startup
 */
export async function initializeLocationData() {
  const provinces = await fetchProvinces()
  if (!provinces) return

  // Pre-fetch regencies for key provinces (for diverse location messages)
  // Focus on provinces where PT Rebinmas or similar palm oil companies operate
  const targetProvinces = [
    'sumatera selatan',  // Main operational area
    'riau',
    'jambi',
    'bengkulu',
    'sumatera barat',
    'jawa tengah',
    'kalimantan tengah',
    'sulawesi selatan'
  ]

  for (const prov of provinces) {
    if (!prov?.name) continue
    const isTarget = targetProvinces.some(t =>
      prov.name.toLowerCase().includes(t)
    )
    if (isTarget || prov.name.toLowerCase().includes('sumatera')) {
      await fetchRegencies(prov.id)
      // Only fetch first 2 target provinces fully to avoid too many requests
      if (targetProvinces.filter(t => provinces.some(p =>
        p?.name && p.name.toLowerCase().includes(t)
      )).length <= 2) break
    }
  }
}

/**
 * Get a random location message
 */
export function getRandomLocationMessage() {
  const messages = generateLocationMessages()
  return messages[Math.floor(Math.random() * messages.length)]
}

/**
 * Get all cached location messages (for cycling)
 */
export function getAllLocationMessages() {
  return generateLocationMessages()
}

// Export cache for debugging
export function getLocationCache() {
  return cache
}
