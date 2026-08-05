/**
 * Wages Service
 * 
 * Service functions for wages comparison API calls
 * Used to verify upah_bersih against PR_WAGES/PR_EMPWAGES data
 */

// Detect if we're in proxy mode
const isProxyMode = import.meta.env.VITE_PROXY_MODE === 'true' ||
    import.meta.env.NODE_ENV === 'production' ||
    (import.meta.env.VITE_BACKEND_HOST && import.meta.env.VITE_BACKEND_HOST !== 'localhost');

// Use relative URLs in proxy mode, absolute URLs in direct mode
const getBackendUrl = () => {
    if (isProxyMode) {
        return ''; // Empty string means use relative URLs
    } else {
        return import.meta.env.VITE_BACKEND_BASE || 'http://localhost:8002';
    }
};

/**
 * Fetch wages data for a specific period
 * @param {string} token - Auth token
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {string} division - Division code (optional)
 */
export async function fetchWagesByPeriod(token, month, year, division = null) {
    const baseUrl = getBackendUrl();
    const params = new URLSearchParams();
    if (division) params.append('division', division);

    const url = `${baseUrl}/payroll/wages/period/${month}/${year}?${params.toString()}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch wages: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch recap all divisions (THR mode) - No thumbprint, just totals
 * @param {string} token - Auth token
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {boolean} includeThumbprint - Include thumbprint (default: false)
 */
export async function fetchWagesRecapAll(token, month, year, includeThumbprint = false) {
    const baseUrl = getBackendUrl();
    const params = new URLSearchParams();
    if (includeThumbprint) params.append('include_thumbprint', 'true');

    const url = `${baseUrl}/payroll/wages/recap-all/${month}/${year}?${params.toString()}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch recap all: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch wages comparison data for a specific period
 * @param {string} token - Auth token
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {string} division - Division code (optional)
 * @param {string} gangCode - Gang code (optional)
 */
export async function fetchWagesComparison(token, month, year, division = null, gangCode = null) {
    const baseUrl = getBackendUrl();
    const params = new URLSearchParams();
    if (division) params.append('division', division);
    if (gangCode) params.append('gang_code', gangCode);

    const url = `${baseUrl}/payroll/wages/comparison/${month}/${year}?${params.toString()}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Failed to fetch comparison: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch wages verification summary for a specific period
 * @param {string} token - Auth token
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {string} division - Division code (optional)
 */
export async function fetchWagesVerificationSummary(token, month, year, division = null) {
    const baseUrl = getBackendUrl();
    const params = new URLSearchParams();
    if (division) params.append('division', division);

    const url = `${baseUrl}/payroll/wages/verification/summary/${month}/${year}?${params.toString()}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Failed to fetch verification summary: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch employee wages history
 * @param {string} token - Auth token
 * @param {string} empCode - Employee code
 * @param {number} months - Number of months to fetch (default: 12)
 */
export async function fetchEmployeeWagesHistory(token, empCode, months = 12) {
    const baseUrl = getBackendUrl();
    const params = new URLSearchParams();
    params.append('months', months.toString());

    const url = `${baseUrl}/payroll/wages/employee/${empCode}/history?${params.toString()}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch employee wages history: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch single employee wages comparison
 * @param {string} token - Auth token
 * @param {string} empCode - Employee code
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 */
export async function fetchEmployeeWagesComparison(token, empCode, month, year) {
    const baseUrl = getBackendUrl();
    const params = new URLSearchParams();
    params.append('month', month.toString());
    params.append('year', year.toString());

    const url = `${baseUrl}/payroll/wages/comparison/employee/${empCode}?${params.toString()}`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Failed to fetch employee comparison: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Fetch available wages periods
 * @param {string} token - Auth token
 */
export async function fetchAvailableWagesPeriods(token) {
    const baseUrl = getBackendUrl();
    const url = `${baseUrl}/payroll/wages/periods/available`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch available periods: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Format currency (Indonesian Rupiah)
 * @param {number} value - Number to format
 * @returns {string} Formatted currency string
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
 * Format number with thousand separators
 * @param {number} value - Number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(value) {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('id-ID').format(Math.round(value));
}

/**
 * Get status badge color
 * @param {string} status - Comparison status
 * @returns {object} Badge style and icon
 */
export function getStatusBadge(status) {
    switch (status) {
        case 'MATCH':
            return { color: '#10b981', bgColor: '#d1fae5', icon: '✓', label: 'Cocok' };
        case 'MINOR_DIFF':
            return { color: '#f59e0b', bgColor: '#fef3c7', icon: '⚠', label: 'Selisih Kecil' };
        case 'MAJOR_DIFF':
            return { color: '#ef4444', bgColor: '#fee2e2', icon: '✗', label: 'Selisih Besar' };
        case 'NO_WAGES':
            return { color: '#6b7280', bgColor: '#f3f4f6', icon: '?', label: 'Tidak Ada Data' };
        default:
            return { color: '#6b7280', bgColor: '#f3f4f6', icon: '-', label: 'Unknown' };
    }
}

/**
 * Get month name in Indonesian
 * @param {number} month - Month number (1-12)
 * @returns {string} Month name
 */
export function getMonthName(month) {
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return months[month - 1] || '';
}
