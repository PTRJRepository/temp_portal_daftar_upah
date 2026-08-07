import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { C, CARD, SECTION_TITLE, MetricInfo, EmptyState } from './reportTheme';

const fmtIDR = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));
const fmtCompact = (v) => {
    if (v == null) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};

const COMPONENTS = [
    { key: 'spsi', label: 'SPSI', color: '#7C5A2B' },
    { key: 'pph21', label: 'PPH21', color: '#B3392E' },
    { key: 'bpjs', label: 'BPJS Pekerja', color: '#2E9E6B' },
    { key: 'koreksi', label: 'Koreksi', color: '#B45309' },
];

/**
 * PotonganBreakdownPanel — dekomposisi potongan per divisi, drill ke divisi.
 * Props: breakdown (per divisi total_potongan/total_spsi/total_pph21/total_bpjs_pekerja/total_koreksi), onDrill
 */
export default function PotonganBreakdownPanel({ breakdown = [], onDrill }) {
    const [showTable, setShowTable] = useState(false);

    const rows = useMemo(() => (breakdown || [])
        .map(d => ({
            code: d.division_code,
            spsi: Math.abs(Number(d.total_spsi) || 0),
            pph21: Math.abs(Number(d.total_pph21) || 0),
            bpjs: Math.abs(Number(d.total_bpjs_pekerja) || 0),
            koreksi: Math.abs(Number(d.total_koreksi) || 0),
            total: Math.abs(Number(d.total_potongan) || 0),
        }))
        .filter(r => r.total > 0 || r.spsi + r.pph21 + r.bpjs + r.koreksi > 0)
        .sort((a, b) => b.total - a.total), [breakdown]);

    const totalAll = rows.reduce((s, r) => s + r.total, 0);

    if (rows.length === 0) return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 12 }}>Potongan Karyawan <MetricInfo metricKey="upah_bersih" /></div>
            <EmptyState title="Tidak ada potongan" message="Tidak ada potongan tercatat untuk periode ini." />
        </div>
    );

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 0 }}>
                    Potongan Karyawan per Divisi <MetricInfo metricKey="upah_bersih" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: C.text2, fontWeight: 700 }}>Total: <span style={{ color: C.potongan, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(totalAll)}</span></span>
                    <button onClick={() => setShowTable(v => !v)} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface2, color: C.upah, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                        {showTable ? 'Lihat Grafik' : 'Lihat Tabel'}
                    </button>
                </div>
            </div>

            {!showTable ? (
                <div style={{ height: Math.max(280, rows.length * 32) }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={rows} layout="vertical" margin={{ left: 36, right: 16 }} onClick={(s) => { const c = s?.activePayload?.[0]?.payload?.code; if (c && onDrill) onDrill(c); }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                            <XAxis type="number" tickFormatter={(v) => `${(v / 1e6).toFixed(0)}jt`} tick={{ fontSize: 11, fill: C.muted }} />
                            <YAxis type="category" dataKey="code" width={36} tick={{ fontSize: 12, fill: C.text, fontWeight: 700 }} />
                            <Tooltip formatter={(v, n) => [fmtIDR(v), n]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                            <Legend />
                            {COMPONENTS.map(cp => <Bar key={cp.key} dataKey={cp.key} name={cp.label} stackId="a" fill={cp.color} />)}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                                {['Divisi', 'SPSI', 'PPH21', 'BPJS Pekerja', 'Koreksi', 'Total Potongan'].map(h => (
                                    <th key={h} style={{ textAlign: h === 'Divisi' ? 'left' : 'right', padding: '10px 12px', color: C.muted, fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.code} onClick={() => onDrill && onDrill(r.code)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = C.surface2} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                    <td style={{ padding: '11px 12px', fontWeight: 800 }}>{r.code}</td>
                                    <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(r.spsi)}</td>
                                    <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(r.pph21)}</td>
                                    <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(r.bpjs)}</td>
                                    <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(r.koreksi)}</td>
                                    <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: C.potongan }}>{fmtCompact(r.total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>Klik baris/divisi untuk drill. Potongan = pengurang upah kotor → upah bersih.</div>
        </div>
    );
}
