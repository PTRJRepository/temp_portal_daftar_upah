/**
 * Employee Detail Service - Fetches checkroll data for individual employees
 */
import axios from 'axios'
import { isProdMode } from '../utils/prodModeUtils'

// Base URL changes based on mode - use locked endpoint for proxy/prod mode (RS256 auth)
const getBaseUrl = () => {
    // Check for explicit backend URL in environment variables
    const backendHost = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL

    if (backendHost) {
        // Remove trailing slash if present
        const host = backendHost.endsWith('/') ? backendHost.slice(0, -1) : backendHost
        return `${host}/payroll/employee`
    }

    // Default: Bun backend uses standard routes relative to current origin
    return '/payroll/employee'
}

/**
 * Get employee checkroll detail with attendance and overtime matrices
 * @param {string} token - JWT token
 * @param {string} empCode - Employee code
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {string} division - Division code (optional)
 * @returns {Promise<Object>} Checkroll data with attendance and overtime matrices
 * 
 *
 * 
 * 
 */



const hasQueryValue = (value) => value !== null && value !== undefined && value !== ''

const toBooleanQueryValue = (value) => {
    if (!hasQueryValue(value)) return null
    if (typeof value === 'boolean') return value
    return String(value).trim().toLowerCase() === 'true'
}

export async function getEmployeeCheckroll(token, empCode, month, year, division = null, useHistoryDb = null, snapshotVersion = null) {
    try {
        const params = { month, year }
        if (division) {
            params.div = division
        }
        if (hasQueryValue(useHistoryDb)) {
            params.use_history = toBooleanQueryValue(useHistoryDb).toString()
        }
        if (hasQueryValue(snapshotVersion)) {
            params.snapshot_version = String(snapshotVersion)
        }

        const baseUrl = getBaseUrl()
        const encodedEmpCode = encodeURIComponent(String(empCode || '').trim())

        const response = await axios.get(`${baseUrl}/${encodedEmpCode}/checkroll`, {
            headers: { Authorization: `Bearer ${token}` },
            params
        })
        return response.data
    } catch (error) {
        console.error('[EmployeeDetailService] Failed to get employee checkroll:', error)
        throw error
    }
}

/**
 * Get employee component breakdown with metadata
 * Uses the new unified component-based architecture
 * @param {string} token - JWT token
 * @param {string} empCode - Employee code
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {string} division - Division code (optional)
 * @returns {Promise<Object>} Component data with metadata for each payroll component
 */
export async function getEmployeeComponents(token, empCode, month, year, division = null) {
    try {
        const params = { month, year }
        if (division) {
            params.division = division
        }

        const baseUrl = getBaseUrl()

        const response = await axios.get(`${baseUrl}/${empCode}/components`, {
            headers: { Authorization: `Bearer ${token}` },
            params
        })
        return response.data
    } catch (error) {
        console.error('[EmployeeDetailService] Failed to get employee components:', error)
        throw error
    }
}

/**
 * Get employee history (multiple periods)
 * Returns payroll data for an employee across multiple periods
 * @param {string} token - JWT token
 * @param {string} empCode - Employee code
 * @param {Object} options - Options
 * @param {number} options.months - Number of months to fetch (default: 12)
 * @param {boolean} options.includeCurrent - Include current period (default: false)
 * @returns {Promise<Object>} Employee history data
 */
export async function getEmployeeHistory(token, empCode, options = {}) {
    try {
        const { months = 12, includeCurrent = false } = options
        const params = {
            months: months.toString(),
            include_current: includeCurrent.toString()
        }

        const baseUrl = getBaseUrl()

        const response = await axios.get(`${baseUrl}/${empCode}/history`, {
            headers: { Authorization: `Bearer ${token}` },
            params
        })
        return response.data
    } catch (error) {
        console.error('[EmployeeDetailService] Failed to get employee history:', error)
        throw error
    }
}

/**
 * Get employee HR history changelog
 * @param {string} token - JWT token
 * @param {string} empCode - Employee code
 * @returns {Promise<Array>} Changelog data
 */
export async function getHrChangelog(token, empCode) {
    try {
        const baseUrl = getBaseUrl()
        const response = await axios.get(`${baseUrl}/${empCode}/hr-changelog`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[EmployeeDetailService] Failed to get HR changelog:', error)
        throw error
    }
}

/**
 * Get true historical data for HR Info across all seeded months
 * @param {string} token - JWT token
 * @param {string} empCode - Employee code
 * @returns {Promise<Object>} Object containing career and payroll history arrays
 */
export async function getEmployeeHistoricalData(token, empCode) {
    try {
        // Check for explicit backend URL in environment variables
        const backendHost = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL
        let host = '';
        if (backendHost) {
            host = backendHost.endsWith('/') ? backendHost.slice(0, -1) : backendHost;
        }

        const response = await axios.get(`${host}/payroll/history/employee/${empCode}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data?.data || { career: [], payroll: [] };
    } catch (error) {
        console.error('[EmployeeDetailService] Failed to get employee historical data:', error)
        throw error
    }
}

/**
 * Get gang attendance matrix for one or more gangs
 * Data comes from extend_db_ptrj (history_gang_member + history_taskreg)
 * EmpCode is the primary key — NIK and bank account derived from it
 * @param {string} token - JWT token
 * @param {string[]} gangCodes - Array of gang codes
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {boolean} includeFaceVerification - Whether to include face verification data (default: true)
 * @returns {Promise<Object>} Gang attendance matrix data
 */
export async function getGangAttendanceMatrix(token, gangCodes, month, year, includeFaceVerification = true) {
    try {
        const baseUrl = getBaseUrl()
        const params = {
            gang_codes: gangCodes.join(','),
            month: month.toString(),
            year: year.toString(),
            include_face_verification: includeFaceVerification.toString()
        }

        const response = await axios.get(`${baseUrl}/gang-attendance-matrix`, {
            headers: { Authorization: `Bearer ${token}` },
            params,
            timeout: 120000 // 120s timeout for large gangs with face verification
        })
        return response.data
    } catch (error) {
        console.error('[EmployeeDetailService] Failed to get gang attendance matrix:', error)
        throw error
    }
}

/**
 * Get gang overtime (lembur) matrix for one or more gangs
 * Shows overtime hours per employee per day from PR_TASKREGLN where OT = 1
 * @param {string} token - JWT token
 * @param {string[]} gangCodes - Array of gang codes
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Promise<Object>} Gang overtime matrix data
 */
export async function getGangOvertimeMatrix(token, gangCodes, month, year) {
    try {
        const baseUrl = getBaseUrl()
        const params = {
            gang_codes: gangCodes.join(','),
            month: month.toString(),
            year: year.toString()
        }

        const response = await axios.get(`${baseUrl}/gang-overtime-matrix`, {
            headers: { Authorization: `Bearer ${token}` },
            params,
            timeout: 60000
        })
        return response.data
    } catch (error) {
        console.error('[EmployeeDetailService] Failed to get gang overtime matrix:', error)
        throw error
    }
}
