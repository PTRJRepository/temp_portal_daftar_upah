import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Line, Legend } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo, EmptyState } from './reportTheme';

/**
 * HeadcountHkPanel — headcount & HK utilization + trend 12-bln.
 * Props: trends (total_headcount/total_hk), breakdown (per divisi headcount/total_hk/human_per_hk)
 */
export default function HeadcountHkPanel({ trends = [], breakdown = [] }) {
    const curr = trends[trends.length - 1] || {};
    const prev = trends[trends.length - 2] || {};
    const hkPer = curr.total_headcount > 0 ? curr.total_hk / curr.total_headcount : 0;
    const prevHkPer = prev.total_headcount > 0 ? prev.total_hk / prev.total_headcount : 0;
    const dHkPer = hkPer - prevHkPer;

    const perDiv = useMemo(() => (breakdown || [])
        .map(d => ({ code: d.division_code, hc: Number(d.headcount) || 0, hk: Number(d.total_hk) || 0, hkPer: Number(d.headcount) > 0 ? Number(d.total_hk) / Number(d.headcount) : 0 }))
        .filter(x => x.hc > 0).sort((a, b) => b.hc - a.hc), [breakdown]);

    const trendData = trends.map(t => ({
        period: t.period || `${t.month}/${t.year}`,
        hc: t.total_headcount,
        hk: t.total_hk,
        hkPer: Number(t.total_headcount) > 0 ? Number(t.total_hk) / Number(t.total_headcount) : 0
    }));

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 8 }}>Karyawan & Hari Kerja (HK) <MetricInfo metricKey="headcount_panen" /></div>
            <div style={{ fontSize: 12.5, color: C.text2, marginBottom: 14 }}>
                <span style={{ color: C.text, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{Number(curr.total_headcount || 0).toLocaleString('id-ID')} orang</span>
                <span style={{ color: C.muted, margin: '0 6px' }}>·</span>
                <span style={{ color: C.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Number(curr.total_hk || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })} HK</span>
                <span style={{ color: C.muted, margin: '0 6px' }}>·</span>
                HK/orang <span style={{ color: C.upah, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{hkPer.toFixed(2)}</span>
                {dHkPer !== 0 && <span style={{ color: dHkPer > 0 ? C.potongan : C.upah, fontSize: 11.5, marginLeft: 8, fontWeight: 700 }}>{dHkPer > 0 ? '▲' : '▼'} {Math.abs(dHkPer).toFixed(2)} vs lalu</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px,1fr))', gap: 20 }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>Headcount, HK & HK/Orang (12-bln)</div>
                    <div style={{ height: 260 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={trendData} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                <XAxis dataKey="period" tick={{ fontSize: 10, fill: C.muted }} interval="preserveStartEnd" />
                                <YAxis yAxisId="l" tick={{ fontSize: 10, fill: C.upah }} />
                                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => (Number(v) || 0).toFixed(1)} tick={{ fontSize: 10, fill: C.lembur }} />
                                <Tooltip formatter={(v, n) => [String(v), n === 'hkPer' ? 'HK/orang' : n === 'hk' ? 'HK' : 'Headcount']} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                                <Bar yAxisId="l" dataKey="hc" name="Headcount" fill="#1F6F43" fillOpacity={0.65} radius={[4, 4, 0, 0]} />
                                <Bar yAxisId="l" dataKey="hk" name="HK" fill="#94A3B8" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
                                <Line yAxisId="r" type="monotone" dataKey="hkPer" name="HK/orang" stroke="#B45309" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>Headcount & HK per Divisi</div>
                    <div style={{ height: Math.max(260, perDiv.length * 30) }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={perDiv} layout="vertical" margin={{ left: 36, right: 12 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: C.muted }} />
                                <YAxis type="category" dataKey="code" width={36} tick={{ fontSize: 12, fill: C.text, fontWeight: 700 }} />
                                <Tooltip formatter={(v, n) => [String(v), n === 'hkPer' ? 'HK/orang' : n]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                                <Legend />
                                <Bar dataKey="hc" name="Headcount" stackId="a" fill="#1F6F43" />
                                <Bar dataKey="hk" name="HK" stackId="a" fill="#94A3B8" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
