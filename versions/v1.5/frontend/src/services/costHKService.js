/**
 * Cost/HK Comparison Report Service
 * API calls for Cost per Hari Kerja comparison report
 */

import axios from 'axios';

// Get the API base URL - use relative path when behind proxy, absolute when direct
const getApiBaseUrl = () => {
    // Check if we're running behind a proxy (detect by checking if we're not on localhost)
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

    // If not localhost, we're likely behind a proxy - use relative path
    if (!isLocalhost) {
        return '';
    }

    // For localhost development, use the explicit backend URL
    return import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
};

const API_BASE_URL = getApiBaseUrl();

/**
 * Fetch Cost/HK comparison data
 * @param {string} token - Authentication token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.divisionFilter - 'ALL', 'IJL', or 'NON_IJL'
 * @param {string} params.gangTypeFilter - 'ALL', 'harvesting', 'transport', 'maintenance'
 * @param {string[]} params.gangCodes - Array of gang codes to filter
 * @returns {Promise<Object>} Cost/HK comparison data
 */
export async function fetchCostHKComparison(token, { month, year, divisionFilter = 'ALL', gangTypeFilter = 'ALL', gangCodes = [] }) {
    try {
        const params = {
            month: month.toString(),
            year: year.toString(),
            division_filter: divisionFilter,
            gang_type_filter: gangTypeFilter
        };

        if (gangCodes && gangCodes.length > 0) {
            params.gang_codes = gangCodes.join(',');
        }

        const response = await axios.get(`${API_BASE_URL}/payroll/dashboard/cost-hk-comparison`, {
            params,
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 60000
        });

        return response.data;
    } catch (error) {
        console.error('[CostHKService] Error fetching cost/HK comparison:', error);
        throw error;
    }
}

/**
 * Fetch available gangs for filter dropdown
 * @param {string} token - Authentication token
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Promise<Object>} List of available gangs
 */
export async function fetchAvailableGangs(token, month, year) {
    try {
        const response = await axios.get(`${API_BASE_URL}/payroll/dashboard/available-gangs`, {
            params: {
                month: month.toString(),
                year: year.toString()
            },
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 30000
        });

        return response.data;
    } catch (error) {
        console.error('[CostHKService] Error fetching available gangs:', error);
        throw error;
    }
}

/**
 * Export Cost/HK data to CSV
 * @param {Object} data - Report data
 * @param {string} filename - Output filename
 */
export function exportToCSV(data, filename = 'cost-hk-comparison.csv') {
    if (!data || !data.gang_details) {
        console.warn('[CostHKService] No data to export');
        return;
    }

    const headers = [
        'Gang Code',
        'Division',
        'Gang Type',
        'Total HK',
        'Total Cost (Rp)',
        'Cost/HK (Rp)',
        'Headcount'
    ];

    const rows = data.gang_details.map(gang => [
        gang.gang_code,
        gang.division_code,
        gang.gang_type,
        gang.total_hk,
        gang.total_cost,
        gang.cost_per_hk,
        gang.headcount
    ]);

    // Add summary rows
    rows.push([]);
    rows.push(['SUMMARY BY GANG TYPE', '', '', '', '', '', '']);
    
    Object.entries(data.summary || {}).forEach(([type, summary]) => {
        rows.push([
            '',
            type.toUpperCase(),
            '',
            summary.total_hk,
            summary.total_cost,
            summary.cost_per_hk,
            ''
        ]);
    });

    rows.push([]);
    rows.push(['GRAND TOTAL', '', '', '', data.grand_total.total_hk, data.grand_total.total_cost, data.grand_total.cost_per_hk]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => {
            if (typeof cell === 'string' && cell.includes(',')) {
                return `"${cell}"`;
            }
            return cell;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}
