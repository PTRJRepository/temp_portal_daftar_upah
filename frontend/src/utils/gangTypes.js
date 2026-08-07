// ===== SSOT klasifikasi gang =====
// Sebelumnya heuristik ini diduplikasi dengan variasi berbeda di
// GangComparisonChart.jsx, GangComparisonReportPage.jsx, dan ExecutivePayrollPage.jsx.
// Selaras dengan backend: scope 'panen' = RIGHT(UPPER(gang_code),1) = 'H'
// (lihat components/report/metricDefinitions.js SCOPE.PANEN).

/** Nilai opsi "semua gang" yang disepakati lintas halaman. */
export const GANG_ALL = 'ALL';

export const GANG_TYPE = {
    HARVESTING: 'harvesting',
    TRANSPORT: 'transport',
    MAINTENANCE: 'maintenance',
    UNCATEGORIZED: 'uncategorized',
};

/** Tipe gang dari karakter terakhir kode: H=panen, T=transport, M=maintenance. */
export const getGangType = (gangCode) => {
    if (!gangCode) return GANG_TYPE.UNCATEGORIZED;
    const lastChar = String(gangCode).slice(-1).toUpperCase();
    if (lastChar === 'H') return GANG_TYPE.HARVESTING;
    if (lastChar === 'T') return GANG_TYPE.TRANSPORT;
    if (lastChar === 'M') return GANG_TYPE.MAINTENANCE;
    return GANG_TYPE.UNCATEGORIZED;
};

/** Gang panen = suffix 'H' (sesuai SCOPE.PANEN backend). */
export const isPanenGang = (gangCode) => getGangType(gangCode) === GANG_TYPE.HARVESTING;

/** Gang IJL = prefix 'L'. */
export const isIJLGang = (gangCode) => {
    if (!gangCode) return false;
    return String(gangCode).toUpperCase().startsWith('L');
};

export const getGangTypeLabel = (type) => ({
    [GANG_TYPE.HARVESTING]: 'Panen (Harvesting)',
    [GANG_TYPE.TRANSPORT]: 'Transport',
    [GANG_TYPE.MAINTENANCE]: 'Maintenance',
    [GANG_TYPE.UNCATEGORIZED]: 'Lainnya',
}[type] || type);

export const GANG_SCOPE_LABEL = {
    panen: 'Gang Panen',
    maintenance: 'Gang Maintenance',
    transport: 'Gang Transport',
    all: 'Semua Gang',
};

export const getScopeLabel = (scope) => GANG_SCOPE_LABEL[scope] || GANG_SCOPE_LABEL.all;
