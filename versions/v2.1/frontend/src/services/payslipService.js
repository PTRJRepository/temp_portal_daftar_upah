/**
 * Payslip Service - Fetches batch payslip data for multiple employees
 */
import axios from 'axios'
import { appendSnapshotVersionToObject } from '../utils/payrollSnapshotQuery'

// Base URL changes based on mode
const getBaseUrl = () => {
    const backendHost = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL

    if (backendHost) {
        const host = backendHost.endsWith('/') ? backendHost.slice(0, -1) : backendHost
        return `${host}/payroll/employee`
    }

    return '/payroll/employee'
}

/**
 * Get batch employee checkroll data for payslip printing
 * @param {string} token - JWT token
 * @param {string[]} empCodes - Array of employee codes
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Promise<Object>} Batch checkroll data
 */
export async function getBatchEmployeeCheckroll(token, empCodes, month, year, useHistory = null, snapshotVersion = null) {
    try {
        if (!empCodes || empCodes.length === 0) {
            throw new Error('No employee codes provided')
        }

        const body = {
            emp_codes: empCodes,
            month,
            year
        }
        if (useHistory !== null && useHistory !== undefined) body.use_history = useHistory
        appendSnapshotVersionToObject(body, snapshotVersion)

        const baseUrl = getBaseUrl()
        console.log(`[PayslipService] Fetching batch checkroll for ${empCodes.length} employees using POST`)

        const response = await axios.post(`${baseUrl}/batch-checkroll`, body, {
            headers: { Authorization: `Bearer ${token}` }
        })

        return response.data
    } catch (error) {
        console.error('[PayslipService] Failed to get batch checkroll:', error)
        throw error
    }
}

/**
 * Get single employee checkroll (wrapper for consistency)
 * @param {string} token - JWT token
 * @param {string} empCode - Employee code
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Promise<Object>} Checkroll data
 */
/**
 * Save payslip data to history database
 * @param {string} token - JWT token
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {string} division - Division code (optional)
 * @returns {Promise<Object>} Result of the save operation
 */
export async function savePayslipHistory(token, month, year, division = '') {
    try {
        const backendHost = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL
        const host = backendHost?.endsWith('/') ? backendHost.slice(0, -1) : (backendHost || '')
        const url = `${host}/payroll/history/seed`

        const body = {
            period_month: month,
            period_year: year,
            division_code: division || undefined,
            force: true // Usually want to overwrite if re-saving from print page
        }

        const response = await axios.post(url, body, {
            headers: { Authorization: `Bearer ${token}` }
        })

        return response.data
    } catch (error) {
        console.error('[PayslipService] Failed to save payslip history:', error)
        throw error
    }
}
