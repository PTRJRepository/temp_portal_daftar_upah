/**
 * Locked Division Service
 * Services for division-locked payroll endpoints using external JWT tokens
 */
import axios from 'axios'
import { appendSnapshotVersionToObject } from '../utils/payrollSnapshotQuery'

// We omit the leading slash so Axios properly appends this to its defaults.baseURL
// instead of treating it as an absolute path that bypasses the proxy mapping.
const BASE_URL = 'payroll/locked'

/**
 * Verify external token and get user claims
 * @param {string} token - External JWT token
 * @returns {Promise<object|null>} User claims if valid, null if invalid
 */
export async function verifyExternalToken(token) {
    try {
        const response = await axios.get(`${BASE_URL}/verify`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Token verification failed:', error)
        return null
    }
}

/**
 * Get locked division info
 * @param {string} token - JWT token
 * @param {string} div - Locked division code
 */
export async function getLockedInfo(token, div) {
    try {
        const response = await axios.get(`${BASE_URL}/info`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { div }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to get locked info:', error)
        throw error
    }
}

/**
 * Get gangs for locked division
 * @param {string} token - JWT token  
 * @param {string} div - Locked division code
 * @param {string} search - Optional search filter
 */
export async function getLockedGangs(token, div, search = null) {
    try {
        const params = { div }
        if (search) params.search = search

        const response = await axios.get(`${BASE_URL}/gangs`, {
            headers: { Authorization: `Bearer ${token}` },
            params
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to get locked gangs:', error)
        throw error
    }
}

/**
 * Get payroll report for locked division
 * @param {string} token - JWT token
 * @param {string} div - Locked division code
 * @param {string} gangCode - Gang code (or 'ALL')
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {number} skip - Pagination skip
 * @param {number} limit - Pagination limit
 */
export async function getLockedReport(token, div, gangCode, month, year, skip = 0, limit = 500) {
    try {
        const params = {
            div,
            month,
            year,
            skip,
            limit
        }
        if (gangCode && gangCode !== 'ALL') {
            params.gang_code = gangCode
        }

        const response = await axios.get(`${BASE_URL}/report`, {
            headers: { Authorization: `Bearer ${token}` },
            params
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to get locked report:', error)
        throw error
    }
}

/**
 * Get raw tree data for locked division
 * @param {string} token - JWT token
 * @param {string} div - Locked division code
 * @param {number} month - Month
 * @param {number} year - Year
 * @param {boolean} useHistoryDb - Use historical snapshot
 * @param {string} gangPrefix - Optional prefix (Asistensi)
 */
export async function getLockedRawTree(token, div, month, year, useHistoryDb = false, gangPrefix = null, snapshotVersion = null, gangCode = null, valuePriorityMode = 'non_db_ptrj') {
    try {
        const params = { div, month, year };
        if (useHistoryDb) params.use_history = 'true';
        if (valuePriorityMode) params.value_priority_mode = valuePriorityMode;
        if (gangPrefix) params.gang_prefix = gangPrefix;
        if (gangCode && gangCode !== 'ALL') params.gang_code = gangCode;
        appendSnapshotVersionToObject(params, snapshotVersion);

        const response = await axios.get(`${BASE_URL}/report/raw-tree`, {
            headers: { Authorization: `Bearer ${token}` },
            params
        })
        console.log('[getLockedRawTree] EXACT axios response.data:', response.data, 'typeof data:', typeof response.data, 'isArray:', Array.isArray(response.data));
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to get locked raw tree:', error)
        throw error
    }
}

export default {
    verifyExternalToken,
    getLockedInfo,
    getLockedGangs,
    getLockedReport,
    getLockedRawTree,
    seedLockedAutoBufferToManualAdjustment
}

/**
 * Save manual adjustment for locked division
 * @param {string} token - JWT token
 * @param {object} payload - Adjustment data
 */
export async function saveLockedManualEdit(token, payload) {
    try {
        const response = await axios.post(`${BASE_URL}/manual-edit`, payload, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to save manual edit:', error)
        throw error
    }
}

export async function deleteLockedManualAdjustmentColumn(token, params = {}) {
    try {
        const response = await axios.delete(`${BASE_URL}/manual-adjustment/column`, {
            params,
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to delete manual adjustment column:', error)
        throw error
    }
}

export async function validateLockedPremiumConversion(token, { from, to }) {
    try {
        const response = await axios.get(`${BASE_URL}/manual-adjustment/validate-conversion`, {
            params: { from, to },
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to validate premium conversion:', error)
        throw error
    }
}

export async function convertLockedPremiumType(token, payload) {
    try {
        const response = await axios.post(`${BASE_URL}/manual-adjustment/convert-type`, payload, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to convert premium type:', error)
        throw error
    }
}

export async function saveLockedProfileOverride(token, payload) {
    try {
        const response = await axios.post(`payroll/overrides/profile`, payload, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to save profile override:', error)
        throw error
    }
}

export async function saveLockedValueOverrides(token, payload) {
    try {
        const response = await axios.post(`payroll/overrides/values`, payload, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to save value overrides:', error)
        throw error
    }
}

export async function seedLockedAutoBufferToManualAdjustment(token, payload) {
    try {
        const response = await axios.post(`${BASE_URL}/manual-adjustment/seed-auto-buffer`, payload, {
            headers: { Authorization: `Bearer ${token}` }
        })
        return response.data
    } catch (error) {
        console.error('[LockedDivisionService] Failed to seed auto buffer to manual adjustment:', error)
        throw error
    }
}
