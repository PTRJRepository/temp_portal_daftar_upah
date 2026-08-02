/**
 * Summary Report Service
 * Fetches aggregation data from /payroll/summary endpoints
 */

import axios from 'axios';

// Use relative path to leverage Vite Proxy (or httpSetup default)
const getBackendBase = () => {
    // Return empty string to allow axios to use relative path (e.g. /payroll/...)
    // This allows the request to go through the Vite Proxy (in dev) or Nginx (in prod)
    // which handles the redirection to the correct backend port (8002).
    return ''
}
const BACKEND_BASE = getBackendBase();

/**
 * Fetch summary data for a division
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {string} [params.division] - Division code filter
 * @param {number} [params.month] - Month filter (1-12)
 * @param {number} [params.year] - Year filter
 * @returns {Promise<Object>} Summary data response
 */
export async function fetchDivisionSummary(token, { division, month, year, useHistory = false, includeVirtual = false }) {
    const params = new URLSearchParams();

    if (division) params.append('division', division);
    if (month) params.append('month', month.toString());
    if (year) params.append('year', year.toString());
    if (useHistory) params.append('use_history', 'true');
    if (includeVirtual) params.append('include_virtual', 'true');

    const url = `${BACKEND_BASE}/payroll/summary/division?${params.toString()}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch available periods
 * @param {string} token - Auth token
 * @param {string} [division] - Optional division filter
 * @returns {Promise<Object>} Periods data
 */
export async function fetchAvailablePeriods(token, division = null) {
    const params = division ? `?division=${division}` : '';
    const url = `${BACKEND_BASE}/payroll/summary/periods${params}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch divisions with available data (REAL divisions only, excluding virtual)
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Divisions data
 */
export async function fetchDivisionsWithData(token) {
    const url = `${BACKEND_BASE}/payroll/summary/divisions`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch VIRTUAL divisions list (for separate dropdown)
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Virtual divisions data
 */
export async function fetchVirtualDivisions(token) {
    const url = `${BACKEND_BASE}/payroll/summary/virtual-divisions`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Health check for summary service
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Health status
 */
export async function checkSummaryHealth(token) {
    const url = `${BACKEND_BASE}/payroll/summary/health`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch gangs for a specific LocCode (division) with descriptions
 * @param {string} token - Auth token
 * @param {string} locCode - LocCode/Division to fetch gangs for
 * @returns {Promise<Object>} Gangs data with descriptions
 */
export async function fetchGangsByLocCode(token, locCode) {
    const url = `${BACKEND_BASE}/payroll/summary/gangs/${encodeURIComponent(locCode)}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch aggregated premi totals for all divisions for a specific period
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @returns {Promise<Object>} All divisions summary data
 */
export async function fetchAllDivisionsTotals(token, { month, year, useHistory = false, includeVirtual = false, scope = 'all', divisionType = 'all' }) {
    let url = `${BACKEND_BASE}/payroll/summary/all-divisions?month=${month}&year=${year}`;
    if (useHistory) url += '&use_history=true';
    if (includeVirtual) url += '&include_virtual=true';
    if (scope && scope !== 'all') url += `&scope=${encodeURIComponent(scope)}`;
    if (divisionType && divisionType !== 'all') url += `&division_type=${encodeURIComponent(divisionType)}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch comparison summary data (Current vs Previous Month)
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @returns {Promise<Object>} Comparison data
 */
export async function fetchComparisonSummary(token, { month, year, useHistory = false, scope = 'all', divisionType = 'all' }) {
    let url = `${BACKEND_BASE}/payroll/summary/comparison?month=${month}&year=${year}`;
    if (useHistory) url += '&use_history=true';
    if (scope && scope !== 'all') url += `&scope=${encodeURIComponent(scope)}`;
    if (divisionType && divisionType !== 'all') url += `&division_type=${encodeURIComponent(divisionType)}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch Impact Report data (3-table structure with HK analysis)
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @returns {Promise<Object>} Impact Report data
 */
export async function fetchImpactReport(token, { month, year, useHistory = false }) {
    let url = `${BACKEND_BASE}/payroll/summary/impact-report?month=${month}&year=${year}`;
    if (useHistory) url += '&use_history=true';

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}


/**
 * Update thumbprint value for a specific division and period
 * @param {string} token - Auth token
 * @param {Object} params - parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.division - Division code
 * @param {number} params.value - New thumbprint value
 * @returns {Promise<Object>} Result
 */
export async function updateThumbprint(token, { month, year, division, value }) {
    const url = `${BACKEND_BASE}/payroll/summary/thumbprint`;

    const response = await axios.post(url, {
        month,
        year,
        division_code: division,
        value
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Update PPH21 value for a specific division and period
 * @param {string} token - Auth token
 * @param {Object} params - parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.division - Division code
 * @param {number} params.value - New PPH21 value (adjustment amount)
 * @returns {Promise<Object>} Result
 */
export async function updatePPH21(token, { month, year, division, value }) {
    const url = `${BACKEND_BASE}/payroll/summary/update-pph21`;

    const response = await axios.post(url, {
        month,
        year,
        division_code: division,
        value
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Update SPSI value for a specific division and period
 * @param {string} token - Auth token
 * @param {Object} params - parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.division - Division code
 * @param {number} params.value - New SPSI value (adjustment amount)
 * @returns {Promise<Object>} Result
 */
export async function updateSPSI(token, { month, year, division, value }) {
    const url = `${BACKEND_BASE}/payroll/summary/update-spsi`;

    const response = await axios.post(url, {
        month,
        year,
        division_code: division,
        value
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Update both PPH21 and SPSI at once
 * @param {string} token - Auth token
 * @param {Object} params - parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.division - Division code
 * @param {number} params.pph21 - New PPH21 value
 * @param {number} params.spsi - New SPSI value
 * @returns {Promise<Object>} Result
 */
export async function updateDeductions(token, { month, year, division, pph21, spsi }) {
    const url = `${BACKEND_BASE}/payroll/summary/update-deductions`;

    const response = await axios.post(url, {
        month,
        year,
        division_code: division,
        pph21,
        spsi
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch deduction adjustments for a period
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @returns {Promise<Object>} Deduction adjustments data
 */
export async function fetchDeductionAdjustments(token, { month, year }) {
    const url = `${BACKEND_BASE}/payroll/summary/deduction-adjustments?month=${month}&year=${year}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Update Luas Area (Productive Area in Hectares) for a specific division and period
 * @param {string} token - Auth token
 * @param {Object} params - parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.division - Division code
 * @param {number} params.value - New luas area value (in hectares)
 * @returns {Promise<Object>} Result
 */
export async function updateLuasArea(token, { month, year, division, value }) {
    const url = `${BACKEND_BASE}/payroll/summary/update-luas-area`;

    const response = await axios.post(url, {
        month,
        year,
        division_code: division,
        value
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch Luas Area adjustments for a period
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @returns {Promise<Object>} Luas area adjustments data
 */
export async function fetchLuasAreaAdjustments(token, { month, year }) {
    const url = `${BACKEND_BASE}/payroll/summary/luas-area-adjustments?month=${month}&year=${year}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Fetch Analysis Report data (Premi & OT, Progressive Pruning)
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @returns {Promise<Object>} Analysis Report data
 */
export async function fetchAnalysisReport(token, { month, year, type = 'all', useHistory = false }) {
    let url = `${BACKEND_BASE}/payroll/summary/analysis-report?month=${month}&year=${year}&type=${type}`;
    if (useHistory) url += '&use_history=true';

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Update a single cell value in gang summary data
 * @param {string} token - Auth token
 * @param {Object} params - parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.gang_code - Gang code
 * @param {string} params.field - Field name to update
 * @param {number} params.value - New value
 * @returns {Promise<Object>} Result
 */
export async function updateGangCell(token, { month, year, gang_code, field, value }) {
    const url = `${BACKEND_BASE}/payroll/summary/update-gang`;

    const response = await axios.post(url, {
        month,
        year,
        gang_code,
        field,
        value
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Update a single division-level summary cell via override storage
 * @param {string} token - Auth token
 * @param {Object} params - parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} params.division_code - Division code
 * @param {string} params.field - Field name to update
 * @param {number} params.value - New value
 * @returns {Promise<Object>} Result
 */
export async function updateDivisionCell(token, { month, year, division_code, field, value }) {
    const url = `${BACKEND_BASE}/payroll/summary/update-division-cell`;

    const response = await axios.post(url, {
        month,
        year,
        division_code,
        field,
        value
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

export default {
    fetchDivisionSummary,
    fetchAvailablePeriods,
    fetchDivisionsWithData,
    fetchVirtualDivisions,
    checkSummaryHealth,
    fetchGangsByLocCode,
    fetchAllDivisionsTotals,
    fetchComparisonSummary,
    fetchImpactReport,
    fetchAnalysisReport,
    updateThumbprint,
    updatePPH21,
    updateSPSI,
    updateDeductions,
    fetchDeductionAdjustments,
    updateLuasArea,
    fetchLuasAreaAdjustments,
    updateGangCell
};

/**
 * Check if current user can access reports (admin in proxy mode)
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Access check result
 */
export async function checkReportAccess(token) {
    const url = `${BACKEND_BASE}/payroll/summary/access-check`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}

/**
 * Validate aggregation totals against real-time payroll calculations
 * @param {string} token - Auth token
 * @param {Object} params - Query parameters
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string} [params.division] - Optional division code
 * @returns {Promise<Object>} Validation results
 */
export async function validateAggregation(token, { month, year, division }) {
    const params = new URLSearchParams();
    params.append('month', month);
    params.append('year', year);
    if (division) params.append('division', division);

    const url = `${BACKEND_BASE}/payroll/aggregation/validate?${params.toString()}`;

    const response = await axios.get(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data;
}



/**
 * Seed aggregation data for all divisions
 */
export async function seedAggregation(token, { month, year, force = true }) {
    const response = await axios.post(`${BACKEND_BASE}/payroll/aggregation/seed`, {
        month,
        year,
        force
    }, {
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        }
    });

    return response.data;
}
