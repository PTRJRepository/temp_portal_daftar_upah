import React, { useMemo } from 'react';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo, DeltaBadge, EmptyState } from './reportTheme';
import { costPerTon, heatColor } from '../../utils/costPerTonStory.derive';

const fmtIDR = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));
const fmtCompact = (v) => {
    if (v == null) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};
const fmtNum = (v, d = 0) => (v == null ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }));

const RatioCard = ({ label, metricKey, value, pct, invert, color, note }) => (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: color }} />
        <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
            {label} <MetricInfo metricKey={metricKey} size={12} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: C.text, lineHeight: 1.05 }}>{value}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {pct != null && <DeltaBadge pct={pct} invert={invert} />}
            {note && <span style={{ fontSize: 11.5, color: C.text2 }}>{note}</span>}
        </div>
    </div>
);

/**
 * CostOfWagePanel — "cost upah terhadap apapun": per ton, per HK, per karyawan, per divisi.
 * Props: trends, breakdown
 */
export default function CostOfWagePanel({ trends = [], breakdown = [] }) {
    const curr = trends[trends.length - 1] || {};
    const prev = trends[trends.length - 2] || {};
    const calc = (c, p) => (!p ? null : ((c - p) / p) * 100);

    const wage = Number(curr.total_wage) || 0;
    const tonase = Number(curr.total_tonase) || 0;
    const hk = Number(curr.total_hk) || 0;
    const headcount = Number(curr.total_headcount) || 0;

    const costTon = curr.cost_per_ton ?? (tonase > 0 ? wage / tonase : null);
    const prevCostTon = prev.cost_per_ton ?? (prev.total_tonase > 0 ? prev.total_wage / prev.total_tonase : null);
    const costHk = curr.cost_per_hk ?? (hk > 0 ? wage / hk : null);
    const prevCostHk = prev.cost_per_hk ?? (prev.total_hk > 0 ? prev.total_wage / prev.total_hk : null);
    const perEmp = headcount > 0 ? wage / headcount : null;
    const prevPerEmp = (prev.total_headcount > 0) ? prev.total_wage / prev.total_headcount : null;
    const tonPerHk = hk > 0 ? tonase / hk : null;
    const prevTonPerHk = (prev.total_hk > 0) ? (prev.total_tonase || 0) / prev.total_hk : null;

    // Per-division ranked bars
    const divCostTon = useMemo(() => (breakdown || [])
        .map(d => ({ code: d.division_code, val: costPerTon(d) }))
        .filter(x => x.val != null).sort((a, b) => b.val - a.val), [breakdown]);
    const divCostHk = useMemo(() => (breakdown || [])
        .map(d => ({ code: d.division_code, val: Number(d.total_hk) > 0 ? Number(d.total_wage) / Number(d.total_hk) : null }))
        .filter(x => x.val != null).sort((a, b) => b.val - a.val), [breakdown]);
    const divTonHk = useMemo(() => (breakdown || [])
        .map(d => ({ code: d.division_code, val: Number(d.total_hk) > 0 ? Number(d.total_tonase) / Number(d.total_hk) : null }))
        .filter(x => x.val != null && Number(x.val) > 0).sort((a, b) => b.val - a.val), [breakdown]);
    const minCpt = divCostTon.length ? Math.min(...divCostTon.map(x => x.val)) : 0;
    const maxCpt = divCostTon.length ? Math.max(...divCostTon.map(x => x.val)) : 0;

    if (wage === 0) return <div style={{ ...CARD, marginBottom: '1.5rem' }}><EmptyState title="Data upah kosong" message="Tidak ada data upah untuk periode ini." /></div>;

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                Cost of Wage · terhadap semua satuan <MetricInfo metricKey="total_upah_kotor" />
            </div>

            {/* Ratio cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
                <RatioCard label="Cost / Ton" metricKey="cost_per_ton" value={fmtCompact(costTon)} pct={calc(costTon, prevCostTon)} invert color={C.costTon} note={tonase > 0 ? `${fmtNum(tonase, 1)} t` : 'tonase 0'} />
                <RatioCard label="Cost / HK" metricKey="cost_per_hk" value={fmtCompact(costHk)} pct={calc(costHk, prevCostHk)} invert color={C.lembur} note={`${fmtNum(hk)} HK`} />
                <RatioCard label="Ton / HK (Produktivitas)" metricKey="total_tonase" value={tonPerHk != null ? `${fmtNum(tonPerHk, 3)} t/HK` : '-'} pct={calc(tonPerHk, prevTonPerHk)} color={C.premi} note={hk > 0 ? `${fmtNum(tonase, 1)} t ÷ ${fmtNum(hk)} HK` : 'HK 0'} />
                <RatioCard label="Tonase TBS" metricKey="total_tonase" value={tonase > 0 ? `${fmtNum(tonase, 1)} t` : '-'} pct={calc(tonase, prev.total_tonase)} color={C.upah} note="mill supplier PTRJ01-09" />
                <RatioCard label="Upah / Karyawan" metricKey="upah_kotor_per_hk" value={fmtCompact(perEmp)} pct={calc(perEmp, prevPerEmp)} invert color={C.upahAccent} note={`${fmtNum(headcount)} orang`} />
                <RatioCard label="Upah Kotor Total" metricKey="total_upah_kotor" value={fmtCompact(wage)} pct={calc(wage, prev.total_wage)} invert color={C.upahAccent} note={`${fmtNum(curr.total_premi ? (curr.total_premi / wage) * 100 : 0, 1)}% premi`} />
            </div>

            {/* 12-bln trend: upah/tonase vs upah/HK */}
            {trends.length > 1 && (
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text2, marginBottom: 8 }}>Tren 12 Bulan · Cost/Ton (ungu) vs Cost/HK (oranye)</div>
                    <div style={{ height: 240 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={trends} margin={{ top: 8, right: 36, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                <XAxis dataKey="period" tick={{ fontSize: 11, fill: C.muted }} />
                                <YAxis yAxisId="l" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.costTon }} />
                                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.lembur }} />
                                <Tooltip formatter={(v, n) => [fmtIDR(v), n === 'cost_per_ton' ? 'Cost/Ton' : 'Cost/HK']} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                                <Line yAxisId="l" type="monotone" dataKey="cost_per_ton" name="Cost/Ton" stroke={C.costTon} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                                <Line yAxisId="r" type="monotone" dataKey="cost_per_hk" name="Cost/HK" stroke={C.lembur} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Per-division ranked bars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
                <RankedBar title="Cost / Ton per Divisi" rows={divCostTon} colorize min={minCpt} max={maxCpt} metricKey="cost_per_ton" />
                <RankedBar title="Cost / HK per Divisi" rows={divCostHk} color={C.lembur} metricKey="cost_per_hk" />
                <RankedBar title="Ton / HK per Divisi" rows={divTonHk} color={C.premi} metricKey="total_tonase" valueFmt="tonhk" />
            </div>
        </div>
    );
}

const RankedBar = ({ title, rows, color, colorize, min, max, metricKey, valueFmt }) => {
    const isTonHk = valueFmt === 'tonhk';
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.text2, marginBottom: 8 }}>
                {title} <MetricInfo metricKey={metricKey} size={12} />
            </div>
            <div style={{ height: Math.max(200, rows.length * 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} layout="vertical" margin={{ left: 36, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                        <XAxis type="number" tickFormatter={(v) => isTonHk ? `${Number(v).toFixed(2)}` : `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: C.muted }} />
                        <YAxis type="category" dataKey="code" width={36} tick={{ fontSize: 12, fill: C.text, fontWeight: 700 }} />
                        <Tooltip formatter={(v) => isTonHk ? `${Number(v).toFixed(3)} t/HK` : fmtIDR(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                        <Bar dataKey="val" radius={[0, 4, 4, 0]}>
                            {rows.map((r, i) => <Cell key={i} fill={colorize ? heatColor(r.val, min, max) : color} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
