/**
 * Upah Bersih Detail Service
 * Frontend service to fetch detailed upah bersih report data
 */
import axios from 'axios'

const getBaseUrl = () => {
    const backendHost = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL
    if (backendHost) {
        const host = backendHost.endsWith('/') ? backendHost.slice(0, -1) : backendHost
        return `${host}/payroll/history`
    }
    return '/payroll/history'
}

/**
 * Fetch detailed upah bersih report with drill-down
 * @param {string} token - JWT auth token
 * @param {number} month - Period month (1-12)
 * @param {number} year - Period year
 * @param {string} filter - Filter mode: 'all' | 'lembur' | 'premi' | 'upah_bersih'
 * @param {string} divisionCode - Optional division filter
 * @param {string} gangCode - Optional gang filter
 * @returns {Promise<Object>} Grouped detail data
 */
export async function fetchUpahBersihDetail(token, month, year, filter = 'all', divisionCode = null, gangCode = null) {
    try {
        const params = {
            period_month: month,
            period_year: year,
            filter
        }
        if (divisionCode && divisionCode !== 'ALL') {
            params.division_code = divisionCode
        }
        if (gangCode && gangCode !== 'ALL') {
            params.gang_code = gangCode
        }

        const baseUrl = getBaseUrl()
        const response = await axios.get(`${baseUrl}/upah-bersih-detail`, {
            headers: { Authorization: `Bearer ${token}` },
            params
        })
        return response.data
    } catch (error) {
        console.error('[UpahBersihDetailService] Failed to fetch detail:', error)
        throw error
    }
}
