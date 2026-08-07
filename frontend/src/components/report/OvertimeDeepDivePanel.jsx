import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, Line, ComposedChart } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo } from './reportTheme';

const fmtIDR = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));
const fmtCompact = (v) => {
    if (v == null) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};
const fmtNum = (v, d = 0) => (v == null ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }));

/**
 * OvertimeDeepDivePanel — overtime share + trend 12-bln + per-divisi stacked vs budget.
 * Props: trends, breakdown (per divisi total_wage/total_ot/total_premi)
 */
export default function OvertimeDeepDivePanel({ trends = [], breakdown = [] }) {
    const curr = trends[trends.length - 1] || {};
    const prev = trends[trends.length - 2] || {};
    const currShare = curr.total_wage > 0 ? (curr.total_ot / curr.total_wage) * 100 : 0;
    const prevShare = prev.total_wage > 0 ? (prev.total_ot / prev.total_wage) * 100 : 0;
    const dShare = currShare - prevShare;

    const perDiv = useMemo(() => (breakdown || [])
        .map(d => ({ code: d.division_code, ot: Number(d.total_ot) || 0, share: Number(d.total_wage) > 0 ? (Number(d.total_ot) / Number(d.total_wage)) * 100 : 0 }))
        .filter(x => x.ot > 0).sort((a, b) => b.ot - a.ot), [breakdown]);

    const trendData = trends.map(t => ({ period: t.period || `${t.month}/${t.year}`, ot: t.total_ot, share: t.total_wage > 0 ? (t.total_ot / t.total_wage) * 100 : 0 }));

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 8 }}>Deep Dive: Lembur <MetricInfo metricKey="total_lembur" /></div>
            <div style={{ fontSize: 12.5, color: C.text2, marginBottom: 14 }}>
                Lembur periode ini <span style={{ color: C.lembur, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{currShare.toFixed(1)}%</span> dari upah kotor
                {dShare !== 0 && <span style={{ color: dShare > 0 ? C.potongan : C.upah, fontSize: 11.5, marginLeft: 8, fontWeight: 700 }}>{dShare > 0 ? '▲' : '▼'} {Math.abs(dShare).toFixed(1)}pp vs lalu</span>}
                <span style={{ color: C.muted, marginLeft: 8 }}>· {fmtCompact(curr.total_ot)} · {trendData.length} bulan</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px,1fr))', gap: 20 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>Tren Lembur & Share (12-bln)</div>
                    <div style={{ height: 240 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={trendData} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                <XAxis dataKey="period" tick={{ fontSize: 10, fill: C.muted }} interval="preserveStartEnd" />
                                <YAxis yAxisId="l" tickFormatter={(v) => `${(v / 1e6).toFixed(0)}jt`} tick={{ fontSize: 10, fill: C.lembur }} />
                                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v.toFixed(1)}%`} tick={{ fontSize: 10, fill: C.text2 }} />
                                <Tooltip formatter={(v, n) => [n === 'ot' ? fmtIDR(v) : `${Number(v).toFixed(1)}%`, n === 'ot' ? 'Lembur' : 'Share %']} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                                <Bar yAxisId="l" dataKey="ot" name="Lembur (Rp)" fill="#B45309" fillOpacity={0.9} radius={[4, 4, 0, 0]} />
                                <Line yAxisId="r" type="monotone" dataKey="share" name="Share %" stroke="#7C5A2B" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>Lembur per Divisi (share % di label · total ambil dari jumlah di sebelah)</div>
                    <div style={{ height: Math.max(220, perDiv.length * 28) }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={perDiv} layout="vertical" margin={{ left: 32, right: 12 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                                <XAxis type="number" tickFormatter={(v) => `${(v / 1e6).toFixed(0)}jt`} tick={{ fontSize: 10, fill: C.muted }} />
                                <YAxis type="category" dataKey="code" width={36} tick={{ fontSize: 12, fill: C.text, fontWeight: 700 }} />
                                <Tooltip formatter={(v, n) => [n === 'ot' ? fmtIDR(v) : `${Number(v).toFixed(1)}%`, n === 'ot' ? 'Lembur' : 'Share %']} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                                <Bar dataKey="ot" radius={[0, 6, 6, 0]} fill="#B45309" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
