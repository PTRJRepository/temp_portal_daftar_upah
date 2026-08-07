import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo, EmptyState } from './reportTheme';
import { pivotDivisionSeries, movementBuckets } from '../../utils/costPerTonStory.derive';

const fmtCompact = (v) => {
    if (v == null) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    if (Math.abs(n) >= 1e3) return `Rp ${(n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })}k`;
    return `Rp ${n}`;
};

/**
 * DivisionTimelineGrid — small-multiples cost/ton timeline per divisi (8 bln).
 * Props: rows (flat division×month rows from division-cost-trend), onDrill, loading
 */
export default function DivisionTimelineGrid({ rows = [], onDrill, loading }) {
    const pivot = useMemo(() => pivotDivisionSeries(rows), [rows]);
    const buckets = useMemo(() => movementBuckets(pivot.divisions), [pivot]);
    const meanByPeriod = useMemo(() => Object.fromEntries((pivot.meanSeries || []).map(m => [m.periodKey, m.mean])), [pivot]);

    if (loading) return <div style={{ ...CARD, marginBottom: '1.5rem' }}><div style={SECTION_TITLE}>Gerak Cost/Ton per Divisi</div><div style={{ color: C.muted, fontSize: 13 }}>Memuat timeline divisi…</div></div>;
    if (!pivot.divisions || pivot.divisions.length === 0) return <div style={{ ...CARD, marginBottom: '1.5rem' }}><EmptyState title="Timeline divisi belum tersedia" message="Data deret waktu per divisi tidak ditemukan." /></div>;

    const toneOf = (code) => buckets.improving.includes(code) ? 'good' : buckets.worsening.includes(code) ? 'bad' : 'flat';

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 8 }}>
                Gerak Cost/Ton per Divisi (8 Bulan) <MetricInfo metricKey="cost_per_ton" />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {buckets.improving.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: '#E4F4EB', border: '1px solid #C4E6D2', color: C.upah }}>▼ Membaik ({buckets.improving.length})</span>}
                {buckets.worsening.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: '#FBE9E8', border: '1px solid #F2C9C6', color: C.potongan }}>▲ Memburuk ({buckets.worsening.length})</span>}
                {buckets.flat.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: C.surface2, border: `1px solid ${C.border}`, color: C.muted }}>◆ Stabil ({buckets.flat.length})</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                {pivot.divisions.map(d => {
                    const tone = toneOf(d.code);
                    const first = d.series.find(s => s.cost_per_ton != null)?.cost_per_ton;
                    const last = d.latest;
                    const delta = (first != null && last != null && first !== 0) ? ((last - first) / first) * 100 : null;
                    const pts = d.series.map(s => ({ label: s.periodLabel, val: s.cost_per_ton, mean: meanByPeriod[s.periodKey] }));
                    return (
                        <div key={d.code} onClick={() => onDrill && onDrill(d.code)} style={{ background: C.surface, border: `1px solid ${tone === 'good' ? '#C4E6D2' : tone === 'bad' ? '#F2C9C6' : C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer', minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontWeight: 800, fontSize: 13, color: C.text }}>{d.code}</span>
                                {delta != null && <span style={{ fontSize: 11, fontWeight: 700, color: tone === 'good' ? C.upah : tone === 'bad' ? C.potongan : C.muted }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%</span>}
                            </div>
                            <div style={{ height: 90 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={pts} margin={{ top: 4, right: 6, bottom: 4, left: 6 }}>
                                        <XAxis dataKey="label" hide />
                                        <YAxis hide domain={['auto', 'auto']} />
                                        <Tooltip formatter={(v, n) => [fmtCompact(v), n === 'val' ? d.code : 'Rata-rata']} contentStyle={{ borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12 }} />
                                        <Line type="monotone" dataKey="val" stroke={tone === 'good' ? C.upah : tone === 'bad' ? C.potongan : C.lembur} strokeWidth={2} dot={false} connectNulls />
                                        <Line type="monotone" dataKey="mean" stroke={C.muted} strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{last != null ? `${fmtCompact(last)}/t` : '-'} · garis putus = rata-rata</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
