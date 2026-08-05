import axios from 'axios'

async function wait(ms) { return new Promise(res => setTimeout(res, ms)) }

function normalizeMonthYear(month, year) {
  let m = month
  let y = year
  if (typeof m === 'string') {
    if (m.includes('-')) {
      const [yy, mm] = m.split('-')
      m = parseInt(mm, 10)
      if (!y) y = parseInt(yy, 10)
    } else {
      m = parseInt(m, 10)
    }
  }
  if (typeof y === 'string') {
    y = parseInt(y, 10)
  }
  return { month: m, year: y }
}

async function requestWithRetry(url, config, retries = 2, delayMs = 300, timeoutMs = 10000) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await axios.get(url, { timeout: timeoutMs, ...config })
      return r
    } catch (err) {
      lastErr = err
      if (attempt === retries) break
      await wait(delayMs)
      delayMs = Math.min(delayMs * 2, 2000)
    }
  }
  throw lastErr
}

export async function fetchReportRows(token, { month, year, gang_code, division, fields, skip, limit, benchmark = false, monitor = false, use_history = null, gang_prefix = null }) {
  const params = {}
  const norm = normalizeMonthYear(month, year)
  if (norm.month) params.month = norm.month
  if (norm.year) params.year = norm.year
  if (gang_code) params.gang_code = gang_code
  if (division) params.division = division
  if (Array.isArray(fields) && fields.length > 0) params.fields = fields.join(',')
  if (typeof skip === 'number') params.skip = skip
  if (typeof limit === 'number') params.limit = limit
  if (benchmark) params.benchmark = true
  if (monitor) params.monitor = true
  if (use_history !== null) params.use_history = use_history
  if (gang_prefix) params.gang_prefix = gang_prefix
  const config = { params }
  if (token) config.headers = { Authorization: `Bearer ${token}` }
  const r = await requestWithRetry('payroll/report', config, 2, 300, 60000)
  return r.data
}

/**
 * Fetch payroll rows for a specific gang.
 * Uses /payroll/report endpoint which returns { data: [...], gangs: [...], grand_total: {...}, ... }
 * 
 * ALWAYS returns full response with totals for proper aggregation
 */
export async function fetchReportRowsSimple(token, { month, year, gang_code, division, skip = 0, limit = 50, use_history = null, server_profile = null, summary_only = null }, returnFullResponse = true) {
  const params = {}
  const norm = normalizeMonthYear(month, year)
  if (norm.month) params.month = norm.month
  if (norm.year) params.year = norm.year
  if (gang_code) params.gang_code = gang_code
  if (division) params.division = division
  if (typeof skip === 'number') params.skip = skip
  if (typeof limit === 'number') params.limit = limit
  if (use_history !== null) params.use_history = use_history
  if (server_profile) params.server_profile = server_profile
  if (summary_only !== null) params.summary_only = summary_only

  const config = { params }
  if (token) config.headers = { Authorization: `Bearer ${token}` }

  try {
    const r = await requestWithRetry('payroll/report', config, 2, 500, 120000)
    // Endpoint returns { data: [...], gangs: [...], grand_total: {...}, meta: {...}, ... }
    if (returnFullResponse) {
      // Return full response with backend-calculated totals
      return r.data || {}
    }
    // Legacy behavior: extract just the data array
    return r.data?.data ?? []
  } catch (error) {
    console.error('[PayrollService] fetchReportRowsSimple failed:', error)
    return []
  }
}

export async function fetchReportDivisionOptimized(token, { division, month, year, use_history = null, gang_prefix = null }) {
  const params = {}
  const norm = normalizeMonthYear(month, year)
  if (norm.month) params.month = norm.month
  if (norm.year) params.year = norm.year
  if (division) params.div = division // Map 'division' to 'div' for locked/report/raw-tree
  if (use_history !== null) params.use_history = use_history
  if (gang_prefix) params.gang_prefix = gang_prefix

  const config = { params }
  if (token) config.headers = { Authorization: `Bearer ${token}` }

  try {
    const r = await requestWithRetry('payroll/locked/report/raw-tree', config, 1, 500, 120000)
    return r.data
  } catch (error) {
    console.error('[PayrollService] Failed to fetch optimized division report:', error)
    throw error
  }
}

export async function fetchReportAggregate(token, { month, year, gang_code, division }) {
  const params = {}
  const norm = normalizeMonthYear(month, year)
  if (norm.month) params.month = norm.month
  if (norm.year) params.year = norm.year
  if (gang_code) params.gang_code = gang_code
  if (division) params.division = division
  const config = { params }
  if (token) config.headers = { Authorization: `Bearer ${token}` }
  
  const r = await requestWithRetry('payroll/report/aggregate', config, 1, 500, 90000)
  return r.data
}

export async function fetchReportCount(token, { month, year, gang_code, division }) {
  const params = {}
  const norm = normalizeMonthYear(month, year)
  if (norm.month) params.month = norm.month
  if (norm.year) params.year = norm.year
  if (gang_code) params.gang_code = gang_code
  if (division) params.division = division
  const config = { params }
  if (token) config.headers = { Authorization: `Bearer ${token}` }
  
  const r = await requestWithRetry('payroll/report/count', config, 2, 300, 10000)
  return r.data
}

/**
 * Smart batching for large field requests to prevent connection pool exhaustion
 * Splits requests with many fields into smaller batches of 15 fields each
 */
export async function fetchReportRowsBatched(token, { month, year, gang_code, division, fields, skip, limit, benchmark = false, monitor = false, use_history = null }) {
  // If no fields or small field count, use regular request
  if (!fields || fields.length <= 15) {
    return await fetchReportRows(token, { month, year, gang_code, division, fields, skip, limit, benchmark, monitor, use_history })
  }

  console.log(`[PayrollService] Using smart batching for ${fields.length} fields`)

  // Split fields into batches of 15
  const BATCH_SIZE = 15
  // Ensure 'nik' is in every batch for proper merging
  const fieldBatches = []
  for (let i = 0; i < fields.length; i += BATCH_SIZE) {
    const batch = fields.slice(i, i + BATCH_SIZE)
    if (!batch.includes('nik')) batch.push('nik')
    fieldBatches.push(batch)
  }

  console.log(`[PayrollService] Split into ${fieldBatches.length} batches of max ${BATCH_SIZE} fields`)

  // Fetch data for each batch sequentially to avoid connection pool pressure
  const batchResults = []
  for (let i = 0; i < fieldBatches.length; i++) {
    const batchFields = fieldBatches[i]
    console.log(`[PayrollService] Fetching batch ${i + 1}/${fieldBatches.length} with ${batchFields.length} fields`)

    try {
      const batchData = await fetchReportRows(token, {
        month,
        year,
        gang_code,
        division,
        fields: batchFields,
        skip: skip || 0,
        limit: limit || 1000,
        benchmark,
        monitor,
        use_history
      })

      if (batchData && batchData.length > 0) {
        batchResults.push(batchData)
      }
    } catch (error) {
      console.error(`[PayrollService] Batch ${i + 1} failed:`, error)
      throw new Error(`Batch ${i + 1} failed: ${error.message}`)
    }
  }

  if (batchResults.length === 0) {
    return []
  }

  // Merge batch results by row index/nik
  const mergedResults = []
  const firstBatch = batchResults[0]

  for (let i = 0; i < firstBatch.length; i++) {
    const mergedRow = { ...firstBatch[i] }

    // Merge data from other batches based on NIK or row index
    for (let j = 1; j < batchResults.length; j++) {
      const batch = batchResults[j]
      if (i < batch.length) {
        // Use NIK as the key to match rows across batches
        const nik = mergedRow.nik || mergedRow.NIK
        const batchRow = batch.find(row => (row.nik || row.NIK) === nik) || batch[i]

        // Deep merge for 'premi' and other objects to avoid overwriting
        for (const key in batchRow) {
          if (key === 'premi' && typeof batchRow[key] === 'object' && batchRow[key] !== null) {
            mergedRow[key] = { ...mergedRow[key], ...batchRow[key] }
          } else {
            mergedRow[key] = batchRow[key]
          }
        }
      }
    }

    mergedResults.push(mergedRow)
  }

  console.log(`[PayrollService] Merged ${batchResults.length} batches into ${mergedResults.length} complete rows`)

  // Return merged results directly as they are already paginated
  return mergedResults
}
// ==================== COMPONENT SERVICE API METHODS ====================
// These methods use the new unified component-based architecture

/**
 * Fetch payroll data with component metadata
 * Returns PayrollComponent<T> structure for each payroll item
 */
export async function fetchPayrollWithComponents(token, { month, year, gang_code, division, use_history = null }) {
  const params = {}
  const norm = normalizeMonthYear(month, year)
  if (norm.month) params.month = norm.month
  if (norm.year) params.year = norm.year
  if (gang_code) params.gang_code = gang_code
  if (division) params.division = division
  if (use_history !== null) params.use_history = use_history

  const config = { params }
  if (token) config.headers = { Authorization: `Bearer ${token}` }

  try {
    const r = await requestWithRetry('payroll/report-with-components', config, 1, 500, 90000)
    return r.data
  } catch (error) {
    console.error('[PayrollService] Failed to fetch payroll with components:', error)
    throw error
  }
}

/**
 * Fetch detailed component breakdown for a single employee
 * Returns detailed PayrollComponent data with metadata for each component
 */
export async function fetchEmployeeComponents(token, empCode, month, year, division) {
  const params = {}
  const norm = normalizeMonthYear(month, year)
  if (norm.month) params.month = norm.month
  if (norm.year) params.year = norm.year
  if (division) params.division = division

  const config = { params }
  if (token) config.headers = { Authorization: `Bearer ${token}` }

  try {
    const r = await requestWithRetry(`payroll/employee/${empCode}/components`, config, 1, 500, 60000)
    return r.data
  } catch (error) {
    console.error('[PayrollService] Failed to fetch employee components:', error)
    throw error
  }
}

/**
 * Fetch component registry status
 * Returns health status and version info for all registered component services
 */
export async function fetchComponentRegistry(token) {
  const config = {}
  if (token) config.headers = { Authorization: `Bearer ${token}` }

  try {
    const r = await requestWithRetry('payroll/components/registry', config, 1, 300, 10000)
    return r.data
  } catch (error) {
    console.error('[PayrollService] Failed to fetch component registry:', error)
    throw error
  }
}
