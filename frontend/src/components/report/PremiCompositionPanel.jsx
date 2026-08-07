import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo, EmptyState } from './reportTheme';

const fmtIDR = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));
const fmtCompact = (v) => {
    if (v == null) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};

const PREMI_COLORS = { brondol: '#0F766E', pruning: '#1F6F43', insentif: '#B45309', kinerja: '#2E9E6B', lainnya: '#94A3B8' };

/**
 * PremiCompositionPanel — premi share dalam upah kotor + komposisi jenis premi + per-divisi ranking.
 * Props: trends, breakdown (breakdown may lack premi detail — aggregate premiumBreakdown from dashboardService)
 */
export default function PremiCompositionPanel({ trends = [], breakdown = [], premiumBreakdown = [] }) {
    const curr = trends[trends.length - 1] || {};
    const prev = trends[trends.length - 2] || {};
    const share = curr.total_wage > 0 ? (curr.total_premi / curr.total_wage) * 100 : 0;
    const prevShare = prev.total_wage > 0 ? (prev.total_premi / prev.total_wage) * 100 : 0;
    const dShare = share - prevShare;

    const composition = useMemo(() => {
        // breakdown per divisi may have premiumBreakdown detail
        const hasDetail = premiumBreakdown.length > 0;
        const src = hasDetail ? premiumBreakdown : breakdown;
        let tot = { brondol: 0, pruning: 0, insentif: 0, kinerja: 0, lainnya: 0 };
        src.forEach(d => {
            tot.brondol += Number(d.brondol ?? d.total_premi_brondol ?? 0) || 0;
            tot.pruning += Number(d.pruning ?? d.total_premi_prunning ?? 0) || 0;
            tot.insentif += Number(d.insentif ?? d.total_premi_insentif ?? 0) || 0;
            tot.kinerja += Number(d.kinerja ?? d.total_premi_kinerja ?? 0) || 0;
            const other = Number(d.total_premi || 0) - (Number(d.brondol ?? d.total_premi_brondol ?? 0) + Number(d.pruning ?? d.total_premi_prunning ?? 0) + Number(d.insentif ?? d.total_premi_insentif ?? 0) + Number(d.kinerja ?? d.total_premi_kinerja ?? 0));
            if (other > 0) tot.lainnya += other;
        });
        return Object.entries(tot).filter(([, v]) => v > 0).map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), value: v, color: PREMI_COLORS[k] || PREMI_COLORS.lainnya }));
    }, [breakdown, premiumBreakdown]);

    const trendData = trends.map(t => ({ period: t.period || `${t.month}/${t.year}`, share: t.total_wage > 0 ? (t.total_premi / t.total_wage) * 100 : 0 }));

    const perDiv = useMemo(() => (breakdown || [])
        .map(d => ({ code: d.division_code, premi: Number(d.total_premi) || 0, share: Number(d.total_wage) > 0 ? (Number(d.total_premi) / Number(d.total_wage)) * 100 : 0 }))
        .filter(x => x.premi > 0).sort((a, b) => b.premi - a.premi), [breakdown]);

    if ((curr.total_premi || 0) === 0 && composition.length === 0 && perDiv.length === 0) {
        return <div style={{ ...CARD, marginBottom: '1.5rem' }}><EmptyState title="Data premi kosong" message="Belum ada total_premi untuk periode ini." /></div>;
    }

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 8 }}>Premi & Komposisi <MetricInfo metricKey="total_premi" /></div>
            <div style={{ fontSize: 12.5, color: C.text2, marginBottom: 14 }}>
                Premi <span style={{ color: C.premi, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{share.toFixed(1)}%</span> dari upah kotor
                {dShare !== 0 && <span style={{ color: dShare > 0 ? C.potongan : C.upah, fontSize: 11.5, marginLeft: 8, fontWeight: 700 }}>{dShare > 0 ? '▲' : '▼'} {Math.abs(dShare).toFixed(1)}pp vs lalu</span>}
                <span style={{ color: C.muted, marginLeft: 8 }}>· {fmtCompact(curr.total_premi)} · {trendData.length} bulan</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px,1fr))', gap: 18 }}>
                {/* Komposisi donat */}
                {composition.length > 0 && (
                    <div style={{ height: 280 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>Komposisi Jenis Premi</div>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={composition} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius="42%" outerRadius="68%" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                    {composition.map((e, i) => <Cell key={i} fill={e.color} />)}
                                </Pie>
                                <Tooltip formatter={(v) => fmtIDR(v)} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Tren premi share */}
                <div style={{ height: 240 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>Tren Premi Share (12-bln)</div>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={trendData} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                            <XAxis dataKey="period" tick={{ fontSize: 10, fill: C.muted }} interval="preserveStartEnd" />
                            <YAxis tickFormatter={(v) => `${v.toFixed(1)}%`} tick={{ fontSize: 10, fill: C.premi }} />
                            <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Premi share']} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                            <Bar dataKey="share" fill="#2E9E6B" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Per-divisi premi ranking */}
                {perDiv.length > 0 && (
                    <div style={{ height: Math.max(220, perDiv.length * 28) }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>Premi per Divisi (share % di tooltip)</div>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={perDiv} layout="vertical" margin={{ left: 32, right: 12 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                                <XAxis type="number" tickFormatter={(v) => `${(v / 1e6).toFixed(0)}jt`} tick={{ fontSize: 10, fill: C.muted }} />
                                <YAxis type="category" dataKey="code" width={36} tick={{ fontSize: 12, fill: C.text, fontWeight: 700 }} />
                                <Tooltip formatter={(v, n) => [n === 'premi' ? fmtIDR(v) : `${Number(v).toFixed(1)}%`, n]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
                                <Bar dataKey="premi" fill="#2E9E6B" radius={[0, 6, 6, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
