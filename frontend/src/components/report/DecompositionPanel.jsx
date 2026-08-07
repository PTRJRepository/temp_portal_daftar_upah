import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo, EmptyState } from './reportTheme';
import { decomposeCost } from '../../utils/costPerTonStory.derive';

const fmtIDR = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));

/**
 * DecompositionPanel — dekomposisi upah kotor per divisi: gaji pokok / tunjangan / lembur / premi.
 * Toggle absolute vs 100% composition. Props: breakdown (per divisi total_wage/total_ot/total_premi).
 */
export default function DecompositionPanel({ breakdown = [] }) {
    const [pctMode, setPctMode] = useState(false);

    const rows = useMemo(() => (breakdown || [])
        .map(d => {
            const dec = decomposeCost(d);
            const tot = dec.gajiPokok + dec.lembur + dec.premi;
            const base = { code: d.division_code, _tot: tot };
            if (pctMode && tot > 0) {
                return { ...base, GajiPokok: (dec.gajiPokok / tot) * 100, Lembur: (dec.lembur / tot) * 100, Premi: (dec.premi / tot) * 100 };
            }
            return { ...base, GajiPokok: dec.gajiPokok, Lembur: dec.lembur, Premi: dec.premi };
        })
        .sort((a, b) => b._tot - a._tot), [breakdown, pctMode]);

    if (rows.length === 0) return null;

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 0 }}>
                    Dekomposisi Upah Kotor <MetricInfo metricKey="total_upah_kotor" />
                </div>
                <div style={{ display: 'inline-flex', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 999, padding: 3 }}>
                    {[['abs', 'Rp'], ['pct', '100%']].map(([k, lbl]) => (
                        <button key={k} onClick={() => setPctMode(k === 'pct')}
                            style={{ padding: '5px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, transition: 'all .15s', background: (pctMode ? k === 'pct' : k === 'abs') ? C.upah : 'transparent', color: (pctMode ? k === 'pct' : k === 'abs') ? '#fff' : C.text2 }}>
                            {lbl}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ height: Math.max(280, rows.length * 32) }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} layout="vertical" margin={{ left: 36, right: 16 }} stackOffset={pctMode ? 'expand' : 'none'}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                        <XAxis type="number" tickFormatter={(v) => pctMode ? `${Math.round(v)}%` : `${(v / 1e6).toFixed(0)}jt`} tick={{ fontSize: 11, fill: C.muted }} domain={pctMode ? [0, 100] : undefined} />
                        <YAxis type="category" dataKey="code" width={36} tick={{ fontSize: 12, fill: C.text, fontWeight: 700 }} />
                        <Tooltip formatter={(v, name) => [pctMode ? `${Number(v).toFixed(1)}%` : fmtIDR(v), name]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                        <Legend />
                        <Bar dataKey="GajiPokok" name="Gaji Pokok + Tunjangan" stackId="a" fill={C.upah} />
                        <Bar dataKey="Lembur" name="Lembur" stackId="a" fill={C.lembur} />
                        <Bar dataKey="Premi" name="Premi" stackId="a" fill={C.costTon} radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>Gaji Pokok + Tunjangan = upah kotor − lembur − premi. Toggle 100% untuk membandingkan proporsi antar divisi.</div>
        </div>
    );
}
