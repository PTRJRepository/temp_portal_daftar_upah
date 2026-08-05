/**
 * Aggregation Seeder Service
 * Service functions for aggregation seeding to extend_db_ptrj
 * Standardized to use axios with relative paths for production proxy support.
 */

import axios from 'axios';

/**
 * Check health of extend_db_ptrj connection
 * @param {string} token - Auth token
 */
export async function checkAggregationHealth(token) {
    const response = await axios.get('payroll/aggregation/health', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Seed aggregation data for a specific period and division
 */
export async function seedAggregation(token, month, year, division = null, force = false) {
    const body = {
        month,
        year,
        ...(division && { division }),
        force
    };

    const response = await axios.post('payroll/aggregation/seed', body, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Seed ONLY tonase (FFB weight) data from db_ptrj_mill
 */
export async function seedTonaseOnly(token, month, year) {
    const body = { month, year };

    const response = await axios.post('payroll/aggregation/seed-tonase', body, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Seed auto buffer values to payroll_manual_adjustments (AUTO_BUFFER)
 */
export async function seedAutoBufferManualAdjustments(token, payload) {
    const response = await axios.post('payroll/manual-adjustment/seed-auto-buffer', payload, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Update sync status for manual adjustments after Plantware input is verified in PR_ADTRANS.
 */
export async function seedManualAdjustmentSyncStatus(token, payload) {
    const response = await axios.post('payroll/manual-adjustment/seed-sync-status', payload, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch aggregation history
 */
export async function fetchAggregationHistory(token, month = null, year = null, division = null) {
    const params = {};
    if (month) params.month = month;
    if (year) params.year = year;
    if (division) params.division = division;

    const response = await axios.get('payroll/aggregation/history', {
        params,
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch aggregation summary by division
 */
export async function fetchAggregationSummary(token, month, year) {
    const response = await axios.get('payroll/aggregation/summary', {
        params: { month, year },
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch available divisions with aggregation data
 */
export async function fetchAggregationDivisions(token) {
    const response = await axios.get('payroll/aggregation/divisions', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch available periods with aggregation data
 */
export async function fetchAggregationPeriods(token) {
    const response = await axios.get('payroll/aggregation/periods', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Sync data to Google Spreadsheet
 */
export async function syncSpreadsheet(token, month, year, division = null, syncType = 'DAFTAR_UPAH') {
    const body = {
        month,
        year,
        ...(division && { division }),
        syncType
    };

    const response = await axios.post('spreadsheet/sync', body, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Fetch aggregation status for a specific period
 */
export async function fetchAggregationStatus(token, month, year) {
    const response = await axios.get(`payroll/aggregation/status/${month}/${year}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    return response.data;
}

/**
 * Format month number to Indonesian month name
 */
export function formatMonthName(month) {
    const monthNames = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return monthNames[month - 1] || '';
}

/**
 * Format currency to Indonesian Rupiah
 */
export function formatCurrency(value) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value || 0);
}

/**
 * Format number with thousand separator
 */
export function formatNumber(value) {
    return new Intl.NumberFormat('id-ID').format(value || 0);
}
