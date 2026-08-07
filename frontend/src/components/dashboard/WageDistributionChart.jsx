import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { C, SHADOW } from '../report/reportTheme';
import { getGangType, getGangTypeLabel } from '../../utils/gangTypes';

// Upah kotor efektif: jumlah_upah_kotor (dengan koreksi/pendapatan) fallback upah_kotor.
// Dukung dua bentuk row: division-detail-data (nested breakdown) & wage-distribution (flat).
export const grossOf = (emp) => Number(
    emp?.breakdown?.jumlah_upah_kotor ?? emp?.breakdown?.upah_kotor ?? emp?.jumlah_upah_kotor ?? emp?.upah_kotor ?? 0
) || 0;

const formatJt = (v) => `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`;

// Bucket upah kotor ke distribusi frekuensi. bucketSize auto ~12 titik, bulat 100rb.
// ponytail: fixed-step bucket; upgrade path = quantile/FD-rule binning jika distribusi makin skew.
export function buildWageDistribution(employees, bucketSize) {
    const values = employees.map(grossOf).filter(v => v > 0);
    if (!values.length) return { buckets: [], bucketSize: 0 };
    const min = Math.min(...values), max = Math.max(...values);
    const size = bucketSize || Math.max(100000, Math.ceil((max - min) / 12 / 100000) * 100000);
    const startIdx = Math.floor(min / size);
    const endIdx = Math.floor(max / size);
    const buckets = [];
    for (let i = startIdx; i <= endIdx; i++) {
        buckets.push({ idx: i, min: i * size, max: (i + 1) * size, label: `${formatJt(i * size)}–${formatJt((i + 1) * size)}`, count: 0 });
    }
    employees.forEach(emp => {
        const v = grossOf(emp);
        if (v <= 0) return;
        const b = buckets[Math.floor(v / size) - startIdx];
        if (b) b.count++;
    });
    return { buckets, bucketSize: size };
}

// Line chart frekuensi upah kotor; klik dot -> pilih range -> parent filter tabel
export default function WageDistributionChart({ employees, activeRange, onRangeSelect }) {
    const [step, setStep] = useState(0); // 0 = auto
    const { buckets, bucketSize } = useMemo(() => buildWageDistribution(employees, step || undefined), [employees, step]);
    if (!buckets.length) return null;
    const total = buckets.reduce((s, b) => s + b.count, 0);
    const cycleStep = () => setStep(prev => (prev === 0 ? 500000 : prev === 500000 ? 1000000 : prev === 1000000 ? 2000000 : 0));
    const stepLabel = step === 0 ? `Auto (${formatJt(bucketSize)})` : formatJt(step);

    const handleClick = (pt) => {
        if (!pt || !pt.activePayload?.length) return;
        const b = pt.activePayload[0].payload;
        const isSame = activeRange && activeRange.idx === b.idx;
        onRangeSelect(isSame ? null : { idx: b.idx, min: b.min, max: b.max, label: b.label, count: b.count });
    };

    // Segment analysis: categorize employees in selected range by division + gang type
    const segment = useMemo(() => {
        if (!activeRange) return null;
        const inRange = employees.filter(e => { const v = grossOf(e); return v >= activeRange.min && v < activeRange.max; });
        if (!inRange.length) return null;
        const byType = {};
        const byDiv = {};
        inRange.forEach(e => {
            const gc = String(e.gang_code || '').toUpperCase();
            const type = getGangTypeLabel(getGangType(gc));
            byType[type] = (byType[type] || 0) + 1;
            const div = gc.substring(0, 2) || '??';
            byDiv[div] = (byDiv[div] || 0) + 1;
        });
        return { count: inRange.length, byType, byDiv };
    }, [employees, activeRange]);

    return (
        <div style={{ padding: '1.25rem', backgroundColor: C.surface2, borderRadius: '10px', border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text }}>
                    Distribusi Upah Kotor · {total} karyawan
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {activeRange && onRangeSelect && (
                        <button onClick={() => onRangeSelect(null)}
                            style={{ padding: '4px 12px', borderRadius: 8, border: `1px solid ${C.upah}`, background: C.upah, color: 'white', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                            {activeRange.label} ×
                        </button>
                    )}
                    <button onClick={cycleStep} title="Ganti ukuran bucket"
                        style={{ padding: '4px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.upah, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                        Bucket: {stepLabel}
                    </button>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
                <LineChart data={buckets} margin={{ top: 10, right: 20, left: 0, bottom: 20 }} onClick={onRangeSelect ? handleClick : undefined} style={{ cursor: onRangeSelect ? 'pointer' : 'default' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.gridLine} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.muted }} angle={-35} textAnchor="end" height={50} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.muted }} width={36} />
                    <Tooltip formatter={(val) => [`${val} karyawan`, 'Frekuensi']} labelFormatter={(l) => `Upah kotor ${l}`} />
                    <Line type="monotone" dataKey="count" stroke={C.upah} strokeWidth={2.5}
                        dot={(props) => {
                            const { cx, cy, payload } = props;
                            const active = activeRange && activeRange.idx === payload.idx;
                            return <circle key={payload.idx} cx={cx} cy={cy} r={active ? 7 : 4} fill={active ? C.upah : C.surface} stroke={C.upah} strokeWidth={2} />;
                        }}
                        activeDot={{ r: 7 }}
                    />
                </LineChart>
            </ResponsiveContainer>
            {onRangeSelect && (
                <div style={{ fontSize: '0.78rem', color: C.muted, marginTop: '0.25rem' }}>
                    Klik titik untuk filter karyawan pada rentang itu · klik lagi untuk lepas filter
                </div>
            )}

            {/* Segment analysis — kategori & divisi untuk rentang terpilih */}
            {segment && (
                <div style={{ marginTop: '0.9rem', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0.85rem 1rem' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 800, color: C.text, marginBottom: 8 }}>
                        Analisis Segmen {activeRange.label} · {segment.count} karyawan
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, marginBottom: 6 }}>Per Kategori Gang</div>
                            {Object.entries(segment.byType).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                                <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', padding: '3px 0', borderTop: `1px solid ${C.surface2}` }}>
                                    <span style={{ color: C.text2, fontWeight: 600 }}>{type}</span>
                                    <span style={{ color: C.upah, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{n} <span style={{ color: C.muted, fontWeight: 500 }}>({((n / segment.count) * 100).toFixed(0)}%)</span></span>
                                </div>
                            ))}
                        </div>
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, marginBottom: 6 }}>Per Divisi</div>
                            {Object.entries(segment.byDiv).sort((a, b) => b[1] - a[1]).map(([div, n]) => (
                                <div key={div} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', padding: '3px 0', borderTop: `1px solid ${C.surface2}` }}>
                                    <span style={{ color: C.text2, fontWeight: 600 }}>{div}</span>
                                    <span style={{ color: C.upah, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{n} <span style={{ color: C.muted, fontWeight: 500 }}>({((n / segment.count) * 100).toFixed(0)}%)</span></span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
