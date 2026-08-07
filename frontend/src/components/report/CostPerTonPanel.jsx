import React, { useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { C, CARD, SECTION_TITLE, SHADOW_HOVER, MetricInfo, EmptyState, DeltaBadge } from './reportTheme';
import { interpretCostPerTon } from './metricDefinitions';

const fmtIDR = (v) => (v === null || v === undefined) ? '-' :
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v);
const fmtNum = (v) => (v === null || v === undefined) ? '-' : new Intl.NumberFormat('id-ID').format(v);
const fmtCompact = (v) => {
    if (v === null || v === undefined) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};

/** KPI tile kecil di dalam panel. */
const MiniKpi = ({ label, metricKey, value, pct, invert, color }) => (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color }} />
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            {label} <MetricInfo metricKey={metricKey} size={12} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: C.text, lineHeight: 1.05 }}>{value}</div>
        {pct !== undefined && pct !== null && <div style={{ marginTop: 6 }}><DeltaBadge pct={pct} invert={invert} /></div>}
    </div>
);

/**
 * CostPerTonPanel — analisis cost/ton komprehensif, reusable di semua report.
 *
 * Props:
 *  - trends: [{ period, total_wage, total_tonase, cost_per_ton, total_hk, cost_per_hk, total_premi }]
 *  - divisionRows: [{ division_code, total_wage, total_tonase, cost_per_ton, headcount }]  (optional breakdown)
 *  - title: judul section
 *  - loading: bool
 */
export default function CostPerTonPanel({ trends = [], divisionRows = [], title = 'Analisis Cost per Ton', loading = false }) {
    // Normalisasi field: terima total_wage ATAU total_upah_kotor; cost_per_hk ATAU upah_kotor_per_hk
    const norm = (r = {}) => ({
        ...r,
        total_wage: r.total_wage ?? r.total_upah_kotor ?? 0,
        cost_per_hk: r.cost_per_hk ?? r.upah_kotor_per_hk ?? null,
        cost_per_ton: r.cost_per_ton ?? r.upah_kotor_per_ton ?? null
    });
    const ntrends = trends.map(norm);
    const curr = ntrends[ntrends.length - 1] || {};
    const prev = ntrends[ntrends.length - 2] || {};
    const costPerTon = curr.cost_per_ton ?? (curr.total_tonase > 0 ? curr.total_wage / curr.total_tonase : null);
    const prevCostPerTon = prev.cost_per_ton ?? (prev.total_tonase > 0 ? prev.total_wage / prev.total_tonase : null);
    const costPerHk = curr.cost_per_hk ?? (curr.total_hk > 0 ? curr.total_wage / curr.total_hk : null);
    const tonase = curr.total_tonase || 0;
    const hasTonase = tonase > 0;

    const calcChange = (c, p) => (!p ? null : ((c - p) / p) * 100);
    const costTonChange = calcChange(costPerTon, prevCostPerTon);
    const tonaseChange = calcChange(tonase, prev.total_tonase);
    const wageChange = calcChange(curr.total_wage, prev.total_wage);

    const insights = useMemo(() => interpretCostPerTon({ costPerTon, prevCostPerTon, costPerHk, tonase }), [costPerTon, prevCostPerTon, costPerHk, tonase]);

    // Divisi dengan cost/ton tertinggi (perlu perhatian)
    const ranked = useMemo(() => (divisionRows || [])
        .map(d => norm(d))
        .map(d => ({ ...d, cpt: d.total_tonase > 0 ? (d.total_wage / d.total_tonase) : null }))
        .filter(d => d.cpt !== null)
        .sort((a, b) => b.cpt - a.cpt), [divisionRows]);
    const worst = ranked.slice(0, 3);
    const best = ranked.slice(-3).reverse();

    if (loading) {
        return <div style={{ ...CARD, marginBottom: '1.5rem' }}><div style={SECTION_TITLE}>{title}</div><div style={{ color: C.muted, fontSize: 13 }}>Memuat analisis cost/ton…</div></div>;
    }

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                {title} <MetricInfo metricKey="cost_per_ton" />
            </div>

            {!hasTonase ? (
                <EmptyState
                    title="Cost/ton belum aktif"
                    message="Sumber tonase TBS (total_ffb_weight) bernilai 0 untuk periode ini, sehingga cost per ton tidak dapat dihitung. Upah kotor dan headcount tetap akurat. Isi sumber tonase untuk mengaktifkan analisis efisiensi biaya per ton."
                />
            ) : (
                <>
                    {/* KPI row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
                        <MiniKpi label="Cost / Ton" metricKey="cost_per_ton" value={fmtCompact(costPerTon)} pct={costTonChange} invert color={C.costTon} />
                        <MiniKpi label="Tonase TBS" metricKey="total_tonase" value={`${fmtNum(tonase)} t`} pct={tonaseChange} color={C.premi} />
                        <MiniKpi label="Upah Kotor" metricKey="total_upah_kotor" value={fmtCompact(curr.total_wage)} pct={wageChange} invert color={C.upah} />
                        <MiniKpi label="Cost / HK" metricKey="upah_kotor_per_hk" value={fmtCompact(costPerHk)} color={C.lembur} />
                    </div>

                    {/* Interpretation strip */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                        {insights.map((ins, i) => {
                            const palette = ins.tone === 'bad' ? { bg: '#FBE9E6', bd: '#F0CFC9', fg: C.potongan, ic: '▲' }
                                : ins.tone === 'good' ? { bg: '#E4F4EB', bd: '#C4E6D2', fg: C.premi, ic: '▼' }
                                : ins.tone === 'empty' ? { bg: C.warnBg, bd: '#EDD9B4', fg: C.lembur, ic: '▲' }
                                : { bg: '#EAF1FB', bd: '#CBDCF1', fg: '#2C5AA0', ic: 'ℹ' };
                            return (
                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: palette.bg, border: `1px solid ${palette.bd}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, color: palette.fg, fontWeight: 600, lineHeight: 1.45 }}>
                                    <span style={{ flexShrink: 0 }}>{palette.ic}</span><span>{ins.text}</span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Trend chart */}
                    {ntrends.length > 1 && (
                        <div style={{ marginBottom: ranked.length ? 18 : 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: C.text2, marginBottom: 8 }}>Tren · Upah Kotor (bar) vs Cost/Ton (garis)</div>
                            <div style={{ height: 260 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={180}>
                                    <ComposedChart data={ntrends} margin={{ top: 8, right: 36, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                        <XAxis dataKey="period" tick={{ fontSize: 11, fill: C.muted }} />
                                        <YAxis yAxisId="l" tickFormatter={(v) => `${(v / 1e6).toFixed(0)}jt`} tick={{ fontSize: 11, fill: C.muted }} />
                                        <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${(v / 1e3).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.costTon }} />
                                        <Tooltip formatter={(v, name) => [fmtIDR(v), name]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: SHADOW_HOVER, fontSize: 13 }} />
                                        <Bar yAxisId="l" dataKey="total_wage" name="Upah Kotor" fill={C.upah} radius={[4, 4, 0, 0]} barSize={20} />
                                        <Line yAxisId="r" type="monotone" dataKey="cost_per_ton" name="Cost/Ton" stroke={C.costTon} strokeWidth={2.5} dot={{ r: 3 }} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Division ranking */}
                    {ranked.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                            <RankCard title="Cost/Ton Tertinggi" rows={worst} tone="bad" />
                            <RankCard title="Cost/Ton Terendah" rows={best} tone="good" />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

const RankCard = ({ title, rows, tone }) => {
    const bad = tone === 'bad';
    return (
        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: bad ? C.potongan : C.premi, marginBottom: 10 }}>{title}</div>
            {rows.length === 0 ? <div style={{ fontSize: 12, color: C.muted }}>-</div> : rows.map(r => (
                <div key={r.division_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
                    <span style={{ fontWeight: 700, color: C.text }}>{r.division_code}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: bad ? C.potongan : C.premi, fontWeight: 700 }}>{fmtCompact(r.cpt)}/t</span>
                </div>
            ))}
        </div>
    );
};
