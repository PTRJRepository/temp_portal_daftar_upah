/**
 * History Service
 * Service functions for payroll history management
 * Standardized to use axios with relative paths for production proxy support.
 */

import axios from 'axios';

/**
 * Check health of history database connection
 * @param {string} token - Auth token
 */
export async function checkHistoryHealth(token) {
    const response = await axios.get('payroll/history/health', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Seed payroll history data for a specific period and division
 */
export async function seedPayrollHistory(token, periodMonth, periodYear, divisionCode = null, gangCode = null, force = false, seederMode = 'PAYROLL') {
    const body = {
        period_month: periodMonth,
        period_year: periodYear,
        ...(divisionCode && { division_code: divisionCode }),
        ...(gangCode && { gang_code: gangCode }),
        force,
        seederMode
    };

    const response = await axios.post('payroll/history/seed', body, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Get seeder progress (polling endpoint)
 */
export async function getSeederProgress(token) {
    const response = await axios.get('payroll/history/seed/progress', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Force reset stuck seeder
 */
export async function resetSeeder(token, reason = 'Manual reset from UI') {
    const response = await axios.post('payroll/history/seed/reset', { reason }, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Update PTKP Tax for a period year
 */
export async function updatePtkpTax(token, periodYear) {
    const response = await axios.post('payroll/history/ptkp/update', { period_year: periodYear }, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Dry-run PTKP Tax update from parsed Excel JSON
 */
export async function previewExcelPtkpTax(token, periodYear, includeNameFallback = true, parsedFilePath = null) {
    const body = {
        period_year: periodYear,
        include_name_fallback: includeNameFallback,
        ...(parsedFilePath && { parsed_file_path: parsedFilePath })
    };

    const response = await axios.post('payroll/history/ptkp/excel-preview', body, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Preview PTKP Tax update
 */
export async function previewPtkpTax(token, periodYear) {
    const response = await axios.get(`payroll/history/ptkp/preview/${periodYear}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch payroll history list
 */
export async function fetchPayrollHistory(token, periodMonth = null, periodYear = null, divisionCode = null, gangCode = null) {
    const params = {};
    if (periodMonth) params.period_month = periodMonth;
    if (periodYear) params.period_year = periodYear;
    if (divisionCode) params.division_code = divisionCode;
    if (gangCode) params.gang_code = gangCode;

    const response = await axios.get('payroll/history', {
        params,
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch payroll history detail by history_id
 */
export async function fetchPayrollHistoryDetail(token, historyId) {
    const response = await axios.get(`payroll/history/${historyId}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Delete payroll history
 */
export async function deletePayrollHistory(token, historyId) {
    const response = await axios.delete(`payroll/history/${historyId}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Lock payroll history
 */
export async function lockPayrollHistory(token, historyId, reason) {
    const response = await axios.post(`payroll/history/${historyId}/lock`, { reason }, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch audit trail
 */
export async function fetchAuditTrail(token, filters = {}) {
    const params = {};
    if (filters.historyId) params.history_id = filters.historyId;
    if (filters.operation) params.operation = filters.operation;
    if (filters.performedBy) params.performed_by = filters.performedBy;
    if (filters.startDate) params.start_date = filters.startDate;
    if (filters.endDate) params.end_date = filters.endDate;

    const response = await axios.get('payroll/history/audit/trail', {
        params,
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch available periods from history
 */
export async function fetchHistoryPeriods(token) {
    const response = await axios.get('payroll/history/periods/available', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Format month name
 * @param {number} month - Month number (1-12)
 * @returns {string} Month name in Indonesian
 */
export function formatMonthName(month) {
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return months[month - 1] || '';
}

/**
 * Format currency
 */
export function formatCurrency(value) {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

/**
 * Format number
 */
export function formatNumber(value) {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('id-ID').format(value);
}

/**
 * Get current period information
 */
export async function getCurrentPeriod(token) {
    const response = await axios.get('payroll/history/current-period', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Check if a period is historical
 */
export async function isHistoricalPeriod(token, month, year) {
    const response = await axios.get(`payroll/history/is-historical/${month}/${year}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Get employee history timeline
 */
export async function getEmployeeHistory(token, empCode, options = {}) {
    const params = {};
    if (options.months) params.months = options.months.toString();
    if (options.includeCurrent !== undefined) params.include_current = options.includeCurrent.toString();

    const response = await axios.get(`payroll/employee/${empCode}/history`, {
        params,
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Get employee detail for specific period
 */
export async function getEmployeeDetailForPeriod(token, empCode, month, year) {
    const params = {
        month: month.toString(),
        year: year.toString()
    };

    const response = await axios.get(`payroll/employee/${empCode}/checkroll`, {
        params,
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Get gang history for specific period
 */
export async function getGangHistoryForPeriod(token, gangCode, month, year) {
    throw new Error('Gang history endpoint is not yet implemented. Use /payroll/report with gang_code parameter instead.');
}
