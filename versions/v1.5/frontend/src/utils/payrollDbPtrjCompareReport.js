const FIELD_LABELS = {
    is_spsi_member: 'Status SPSI',
    jabatan_jumlah: 'Tunjangan Jabatan',
    jabatan_rate: 'Rate Jabatan',
    masa_kerja_jumlah: 'Masa Kerja',
    masa_kerja_rate: 'Rate Masa Kerja',
    pot_spsi: 'SPSI',
    spsi: 'SPSI'
};

function toComparableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function valuesMatch(active, dbPtrj) {
    const activeNumber = toComparableNumber(active);
    const dbNumber = toComparableNumber(dbPtrj);
    if (activeNumber !== null && dbNumber !== null) {
        return Math.abs(activeNumber - dbNumber) <= 0.01;
    }
    return String(active ?? '').trim() === String(dbPtrj ?? '').trim();
}

function diffValue(active, dbPtrj) {
    const activeNumber = toComparableNumber(active);
    const dbNumber = toComparableNumber(dbPtrj);
    if (activeNumber === null || dbNumber === null) return null;
    return activeNumber - dbNumber;
}

function labelForField(field) {
    return FIELD_LABELS[field] || String(field || '').replace(/_/g, ' ').trim().toUpperCase();
}

export function buildDbPtrjCompareReport(rows = []) {
    const comparisons = [];
    let comparedCount = 0;
    let matchCount = 0;
    let mismatchCount = 0;

    for (const row of rows || []) {
        if (!row || row.type !== 'employee') continue;
        const compareMap = row.value_source_compare || {};

        for (const [field, compare] of Object.entries(compareMap)) {
            if (!compare || typeof compare !== 'object') continue;
            if (!Object.prototype.hasOwnProperty.call(compare, 'active') || !Object.prototype.hasOwnProperty.call(compare, 'db_ptrj')) {
                continue;
            }

            const active = compare.active;
            const dbPtrj = compare.db_ptrj;
            const isMatch = valuesMatch(active, dbPtrj);
            comparedCount += 1;

            if (isMatch) {
                matchCount += 1;
                continue;
            }

            mismatchCount += 1;
            comparisons.push({
                emp_code: row.emp_code || '',
                nik: row.nik || row.new_nik || '',
                nama: row.nama || row.emp_name || '',
                gang_code: row.gang_code || '',
                field,
                label: labelForField(field),
                active,
                db_ptrj: dbPtrj,
                diff: diffValue(active, dbPtrj)
            });
        }
    }

    comparisons.sort((a, b) => {
        const gangCompare = String(a.gang_code).localeCompare(String(b.gang_code), undefined, { numeric: true, sensitivity: 'base' });
        if (gangCompare !== 0) return gangCompare;
        const empCompare = String(a.emp_code).localeCompare(String(b.emp_code), undefined, { numeric: true, sensitivity: 'base' });
        if (empCompare !== 0) return empCompare;
        return String(a.field).localeCompare(String(b.field));
    });

    return {
        comparedCount,
        matchCount,
        mismatchCount,
        mismatches: comparisons
    };
}

export function formatDbPtrjCompareValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
    const numeric = Number(value);
    if (Number.isFinite(numeric) && String(value).trim() !== '') {
        return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(numeric);
    }
    return String(value);
}
