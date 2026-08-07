// ===== Helper murni Dashboard Command Center =====
// Formatter + data shaping untuk section dashboard. Tanpa IO — mudah diuji.

/** Rupiah ringkas: Rp 1,5 M / Rp 2 jt / Rp 12.345. '-' untuk null/NaN. */
export function formatCompactIDR(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    const n = Number(val);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
}

/** Angka ribuan id-ID. '-' untuk null/NaN. */
export function formatNumberID(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    return new Intl.NumberFormat('id-ID').format(val);
}

/** Stacked bar komposisi biaya: satu baris per divisi (hanya yang upah-nya tersedia). */
export function toCostCompositionRows(divisions = []) {
    return (divisions || [])
        .filter(d => d && d.upah_available)
        .map(d => ({
            name: d.division_code,
            upah_pokok: d.upah_pokok || 0,
            premi: d.premi || 0,
            lembur: d.lembur || 0
        }))
        .sort((a, b) => (b.upah_pokok + b.premi + b.lembur) - (a.upah_pokok + a.premi + a.lembur));
}

/** Donut: [{ [key], headcount }] → [{ name, value }]. */
export function toDonutRows(pairs = [], key) {
    return (pairs || []).map(p => ({ name: p[key] ?? '-', value: p.headcount || 0 }));
}

/** Horizontal bar headcount per divisi (desc). */
export function toDivisionHeadcountRows(byDivision = []) {
    return [...(byDivision || [])]
        .sort((a, b) => (b.headcount || 0) - (a.headcount || 0))
        .map(d => ({ name: d.division_code, headcount: d.headcount || 0 }));
}

/** Tren headcount 12 bln; titik terakhir diganti total live bila agregasi kosong (0). */
export function toHeadcountTrendRows(trends = [], liveTotal = null) {
    const rows = (trends || []).map(t => ({ period: t.period, headcount: t.total_headcount || 0 }));
    if (rows.length && liveTotal && rows[rows.length - 1].headcount === 0) {
        rows[rows.length - 1] = { ...rows[rows.length - 1], headcount: liveTotal, live: true };
    }
    return rows;
}

/** Sparkline KPI: ambil satu key dari trends → [{ v }]. */
export function toSparklinePoints(trends = [], key) {
    return (trends || []).map(t => ({ v: t?.[key] ?? 0 }));
}

/** Peringkat ton/HK per divisi (desc). Divisi tanpa upah/HK/tonase dilewati. */
export function toTonPerHkRows(divisions = []) {
    return (divisions || [])
        .filter(d => d && d.upah_available && d.total_hk > 0 && d.tonase > 0)
        .map(d => ({ name: d.division_code, tonPerHk: d.tonase / d.total_hk }))
        .sort((a, b) => b.tonPerHk - a.tonPerHk);
}

/** Divisi yang sudah produksi (tonase > 0) tapi data upahnya belum tersedia. */
export function findMissingWageDivisions(breakdown = []) {
    return (breakdown || [])
        .filter(d => d && !d.upah_available && (d.total_tonase || 0) > 0)
        .map(d => d.division_code);
}
