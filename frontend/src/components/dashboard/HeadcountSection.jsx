import React from 'react';
import {
    BarChart, Bar, Cell, LineChart, Line, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { C, SHADOW, CARD, SECTION_TITLE, chartPalette, EmptyState, Skeleton } from '../report/reportTheme';
import { toDivisionHeadcountRows, toDonutRows, toHeadcountTrendRows } from '../../utils/dashboardDerivations';

const tooltipStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    boxShadow: SHADOW, fontSize: 12, color: C.text
};

// Donut + legenda manual (warna dari chartPalette)
const Donut = ({ rows }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ResponsiveContainer width={140} height={140}>
            <PieChart>
                <Pie data={rows} dataKey="value" nameKey="name" innerRadius={40} outerRadius={62} paddingAngle={2} isAnimationActive={false}>
                    {rows.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
        </ResponsiveContainer>
        <div style={{ display: 'grid', gap: 6 }}>
            {rows.map((r, i) => (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: chartPalette[i % chartPalette.length], flexShrink: 0 }} />
                    <span style={{ color: C.text2, fontWeight: 600 }}>{r.name}</span>
                    <span style={{ color: C.text, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.value.toLocaleString('id-ID')}</span>
                </div>
            ))}
        </div>
    </div>
);

/**
 * Section Kepersonaliaan & Headcount.
 * Sumber: master karyawan live (selalu seluruh karyawan, tidak ikut scope gang).
 */
export default function HeadcountSection({ data, trends, loading, error, onRetry }) {
    if (loading) {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={220} />)}
            </div>
        );
    }
    if (error || !data) {
        return (
            <EmptyState
                title="Data kepersonaliaan belum tersedia"
                message={error ? `Gagal memuat: ${error}` : 'Master karyawan tidak mengembalikan data.'}
                actionLabel="Muat Ulang"
                onAction={onRetry}
            />
        );
    }

    const divisionRows = toDivisionHeadcountRows(data.by_division);
    const empTypeRows = toDonutRows(data.by_emp_type, 'emp_type');
    const genderRows = toDonutRows(data.by_gender, 'gender');
    const trendRows = toHeadcountTrendRows(trends, data.total);
    const joinRows = Array.isArray(data.join_trend_12m) ? data.join_trend_12m : [];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={SECTION_TITLE}>Headcount per Divisi</div>
                    <span style={{ fontSize: 11, color: C.muted }}>Total aktif: {(data.total || 0).toLocaleString('id-ID')}</span>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(180, divisionRows.length * 34)}>
                    <BarChart data={divisionRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid stroke={C.gridLine} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Headcount']} />
                        <Bar dataKey="headcount" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                            {divisionRows.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Tren Headcount 12 Bulan</div>
                {trendRows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} width={52} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, name, item) => [`${v}${item?.payload?.live ? ' (live)' : ''}`, 'Headcount']} />
                            <Line type="monotone" dataKey="headcount" stroke={C.leafMid} strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tren belum tersedia" message="Data agregasi 12 bulan belum ada. Jalankan Aggregation Seeder." />
                )}
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Komposisi Status Karyawan</div>
                <Donut rows={empTypeRows} />
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Gender &amp; Karyawan Masuk (12 bln)</div>
                <Donut rows={genderRows} />
                <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={joinRows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Masuk']} />
                        <Bar dataKey="joined" fill={C.premi} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
