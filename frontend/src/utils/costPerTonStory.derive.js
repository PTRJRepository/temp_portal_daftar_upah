// ===== Cost/Ton Story — pure derivations (no React, testable) =====

/** Gaji pokok = upah kotor − lembur − premi. Tidak boleh negatif. */
export function decomposeCost(row) {
    const wage = Number(row?.total_wage) || 0;
    const ot = Math.abs(Number(row?.total_ot) || 0);
    const premi = Math.abs(Number(row?.total_premi) || 0);
    const gajiPokok = Math.max(0, wage - ot - premi);
    return { gajiPokok, lembur: ot, premi, total: wage };
}

/** Cost per ton. Null bila tonase 0 (jangan NaN/Infinity). */
export function costPerTon(row) {
    const tonase = Number(row?.total_tonase) || 0;
    if (tonase <= 0) return null;
    const wage = Number(row?.total_wage) || 0;
    return wage / tonase;
}

/** Produktivitas ton/HK. Null bila HK 0. */
export function productivity(row) {
    const hk = Number(row?.total_hk) || 0;
    if (hk <= 0) return null;
    const tonase = Number(row?.total_tonase) || 0;
    return tonase / hk;
}

/** Rata-rata cost/ton lintas divisi (hanya yang punya tonase). */
export function benchmarkMean(rows) {
    let totWage = 0, totTon = 0;
    for (const r of rows || []) {
        const ton = Number(r?.total_tonase) || 0;
        if (ton > 0) { totWage += Number(r?.total_wage) || 0; totTon += ton; }
    }
    return totTon > 0 ? totWage / totTon : null;
}

/** Delta % cost/ton vs periode sebelumnya. Null bila tak ada pembanding. */
export function deltaPct(curr, prev) {
    const c = costPerTon(curr);
    const p = costPerTon(prev);
    if (c == null || p == null || p === 0) return null;
    return ((c - p) / p) * 100;
}

/**
 * Pivot flat (division × month) rows into per-division series + estate mean series.
 * Rows may carry either backend pre-computed cost_per_ton or raw wage/tonase.
 * Returns { periods, divisions, meanSeries }.
 */
export function pivotDivisionSeries(rows) {
    const arr = (rows || []).filter(r => r && r.division_code);
    const periodKey = r => `${r.year}-${String(r.month).padStart(2, '0')}`;
    const periodLabel = r => r.period || `${monthShort(r.month)} ${r.year}`;

    // ordered unique periods
    const periodMap = new Map();
    for (const r of arr) {
        const k = periodKey(r);
        if (!periodMap.has(k)) periodMap.set(k, { key: k, label: periodLabel(r), month: r.month, year: r.year });
    }
    const periods = [...periodMap.values()].sort((a, b) => a.key.localeCompare(b.key));

    // group rows by division
    const byDiv = new Map();
    for (const r of arr) {
        const code = String(r.division_code).trim().toUpperCase();
        if (!byDiv.has(code)) byDiv.set(code, []);
        byDiv.get(code).push(r);
    }

    const divisions = [...byDiv.entries()].map(([code, rs]) => {
        rs.sort((a, b) => periodKey(a).localeCompare(periodKey(b)));
        const series = rs.map(r => {
            const cpt = r.cost_per_ton != null ? Number(r.cost_per_ton) : costPerTon(r);
            return { periodKey: periodKey(r), periodLabel: periodLabel(r), cost_per_ton: cpt, wage: Number(r.wage ?? r.total_wage) || 0, tonase: Number(r.tonase ?? r.total_tonase) || 0 };
        });
        const latest = series[series.length - 1]?.cost_per_ton ?? null;
        return { code, series, latest };
    });

    // estate mean per period = sum(wage)/sum(tonase) across divisions with tonase>0
    const meanSeries = periods.map(p => {
        let totWage = 0, totTon = 0;
        for (const d of divisions) {
            const pt = d.series.find(s => s.periodKey === p.key);
            if (pt && pt.tonase > 0) { totWage += pt.wage; totTon += pt.tonase; }
        }
        return { periodKey: p.key, periodLabel: p.label, mean: totTon > 0 ? totWage / totTon : null };
    });

    return { periods, divisions, meanSeries };
}

/**
 * Classify divisions by cost/ton movement: improving (down), worsening (up), flat.
 * Uses first vs last non-null cost_per_ton. Skips divisions with <2 valid points.
 */
export function movementBuckets(divisions) {
    const improving = [], worsening = [], flat = [];
    for (const d of (divisions || [])) {
        const pts = (d.series || []).filter(s => s.cost_per_ton != null);
        if (pts.length < 2) continue;
        const first = pts[0].cost_per_ton;
        const last = pts[pts.length - 1].cost_per_ton;
        const delta = last - first;
        const eps = Math.max(Math.abs(first) * 0.001, 1); // 0.1% tolerance, min 1 Rp
        if (Math.abs(delta) <= eps) flat.push(d.code);
        else if (delta < 0) improving.push(d.code);
        else worsening.push(d.code);
    }
    return { improving, worsening, flat };
}

function monthShort(m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[(m - 1)] || "";
}

/** Heatmap color dari cost/ton relatif min/max. Hijau=murah, merah=mahal. */
export function heatColor(value, min, max) {
    if (value == null || min == null || max == null || max === min) return '#9CA3AF';
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    // green (#1F6F43) -> amber (#B45309) -> red (#B3392E)
    if (t < 0.5) {
        const k = t / 0.5;
        return lerpColor([0x1F, 0x6F, 0x43], [0xB4, 0x53, 0x09], k);
    }
    const k = (t - 0.5) / 0.5;
    return lerpColor([0xB4, 0x53, 0x09], [0xB3, 0x39, 0x2E], k);
}
function lerpColor(a, b, t) {
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
}
