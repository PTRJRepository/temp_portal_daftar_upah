import axios from 'axios';

function authHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchTaskCodeOptions(token, { search = '', divisionCode = '', limit = 50 } = {}) {
    const response = await axios.get('payroll/manual-adjustment/taskcode-options', {
        params: {
            ...(search ? { search } : {}),
            ...(divisionCode ? { division_code: divisionCode } : {}),
            limit
        },
        headers: authHeaders(token)
    });
    return response.data;
}

export async function fetchManualAdjustments(token, params) {
    const response = await axios.get('payroll/manual-adjustment', {
        params,
        headers: authHeaders(token)
    });
    return response.data;
}

export async function fetchManualEditAllowed(token) {
    const response = await axios.get('payroll/manual-adjustment/allowed', {
        headers: authHeaders(token)
    });
    return response.data;
}

export async function saveManualAdjustment(token, payload) {
    const response = await axios.post('payroll/manual-adjustment', payload, {
        headers: authHeaders(token)
    });
    return response.data;
}

export async function deleteManualAdjustment(token, id, params = {}) {
    const response = await axios.delete(`payroll/manual-adjustment/${id}`, {
        params,
        headers: authHeaders(token)
    });
    return response.data;
}

export async function deleteManualAdjustmentColumn(token, params = {}) {
    const response = await axios.delete('payroll/manual-adjustment/column', {
        params,
        headers: authHeaders(token)
    });
    return response.data;
}

// --- Premium Type Conversion ---

export async function validatePremiumConversion(token, { from, to }) {
    const response = await axios.get('payroll/manual-adjustment/validate-conversion', {
        params: { from, to },
        headers: authHeaders(token)
    });
    return response.data;
}

export async function convertPremiumType(token, payload) {
    const response = await axios.post('payroll/manual-adjustment/convert-type', payload, {
        headers: authHeaders(token)
    });
    return response.data;
}

// --- Premium Definitions ---

export async function fetchPremiumDefinitions(token) {
    const response = await axios.get('payroll/premium-definitions', {
        params: { _: Date.now() },
        headers: {
            ...authHeaders(token),
            'Cache-Control': 'no-cache'
        }
    });
    return response.data;
}

export async function savePremiumDefinition(token, payload) {
    const response = await axios.post('payroll/premium-definitions', payload, {
        headers: authHeaders(token)
    });
    return response.data;
}

export async function importPremiumExcel(token, formData, periodMonth, periodYear) {
    const response = await axios.post(
        `payroll/premium-import-excel?period_month=${periodMonth}&period_year=${periodYear}`,
        formData,
        {
            headers: {
                ...authHeaders(token),
                'Content-Type': 'multipart/form-data'
            }
        }
    );
    return response.data;
}
