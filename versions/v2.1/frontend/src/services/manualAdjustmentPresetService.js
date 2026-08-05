import axios from 'axios';

function authHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchManualAdjustmentPresets(token, params = {}) {
    const response = await axios.get('payroll/manual-adjustment-presets', {
        params,
        headers: authHeaders(token)
    });
    return response.data;
}

export async function createManualAdjustmentPreset(token, payload) {
    const response = await axios.post('payroll/manual-adjustment-presets', payload, {
        headers: authHeaders(token)
    });
    return response.data;
}

export async function deleteManualAdjustmentPreset(token, id) {
    const response = await axios.delete(`payroll/manual-adjustment-presets/${id}`, {
        headers: authHeaders(token)
    });
    return response.data;
}

export async function inferManualAdjustmentPresetFromRemarks(token, remarks) {
    const response = await axios.post('payroll/manual-adjustment-presets/infer', { remarks }, {
        headers: authHeaders(token)
    });
    return response.data;
}
