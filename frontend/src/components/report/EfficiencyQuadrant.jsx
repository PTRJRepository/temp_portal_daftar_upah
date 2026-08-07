import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo, EmptyState } from './reportTheme';
import { costPerTon, productivity, benchmarkMean } from '../../utils/costPerTonStory.derive';

const fmtIDR = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));
const fmtNum = (v, d = 0) => (v == null ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }));

/**
 * EfficiencyQuadrant — scatter produktivitas (ton/HK) vs cost/ton per divisi + quadrant labels.
 * Props: breakdown, onDrill(divisionCode), movements {improving,worsening,flat} (optional)
 */
export default function EfficiencyQuadrant({ breakdown = [], onDrill, movements }) {
    const mean = useMemo(() => benchmarkMean(breakdown), [breakdown]);
    const totTon = (breakdown || []).reduce((s, x) => s + Number(x.total_tonase || 0), 0);
    const totHk = (breakdown || []).reduce((s, x) => s + Number(x.total_hk || 0), 0);
    const meanProd = totHk > 0 ? totTon / totHk : 0;

    const pts = useMemo(() => (breakdown || [])
        .map(d => ({ name: d.division_code, prod: productivity(d), cpt: costPerTon(d) }))
        .filter(p => p.cpt != null && p.prod != null), [breakdown]);

    if (pts.length === 0) return <div style={{ ...CARD, marginBottom: '1.5rem' }}><EmptyState title="Efisiensi belum aktif" message="Butuh tonase & HK > 0 per divisi." /></div>;

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 8 }}>
                Efisiensi Divisi · Produktivitas vs Cost/Ton <MetricInfo metricKey="cost_per_ton" />
            </div>
            <div style={{ fontSize: 12, color: C.text2, marginBottom: 12 }}>
                Kanan-bawah = bintang (produktif & murah) · kiri-atas = perlu perhatian. Klik titik untuk bedah.
            </div>

            {movements && (movements.improving.length + movements.worsening.length + movements.flat.length) > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    {movements.improving.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: '#E4F4EB', border: '1px solid #C4E6D2', color: C.upah }}>▼ Membaik: {movements.improving.join(', ')}</span>}
                    {movements.worsening.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: '#FBE9E8', border: '1px solid #F2C9C6', color: C.potongan }}>▲ Memburuk: {movements.worsening.join(', ')}</span>}
                    {movements.flat.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: C.surface2, border: `1px solid ${C.border}`, color: C.muted }}>◆ Stabil: {movements.flat.join(', ')}</span>}
                </div>
            )}

            <div style={{ height: 380, position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 30, bottom: 34, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis type="number" dataKey="prod" name="Produktivitas" unit=" t/HK" tick={{ fontSize: 11, fill: C.muted }} label={{ value: 'Produktivitas (ton/HK)', position: 'insideBottom', offset: -12, fontSize: 12, fill: C.text2 }} />
                        <YAxis type="number" dataKey="cpt" name="Cost/Ton" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.muted }} label={{ value: 'Cost/Ton', angle: -90, position: 'insideLeft', fontSize: 12, fill: C.text2 }} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => [n === 'cpt' ? fmtIDR(v) : `${fmtNum(v, 3)} t/HK`, n === 'cpt' ? 'Cost/Ton' : 'Produktivitas']} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                        <Scatter data={pts} onClick={(p) => onDrill && onDrill(p.name)}>
                            {pts.map((p, i) => {
                                const eff = mean != null && p.cpt < mean && p.prod > meanProd;
                                const over = mean != null && p.cpt > mean;
                                return <Cell key={i} fill={eff ? C.upah : (over ? C.potongan : C.lembur)} />;
                            })}
                            <LabelList dataKey="name" position="top" style={{ fontSize: 10, fontWeight: 700, fill: C.text2 }} />
                        </Scatter>
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>Hijau = efisien (cost/ton &lt; rata-rata &amp; produktivitas &gt; rata-rata) · Merah = di atas rata-rata cost/ton · Amber = rata-rata.</div>
        </div>
    );
}
