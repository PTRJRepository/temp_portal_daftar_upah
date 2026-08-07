import React from 'react';
import {
    AreaChart, Area, BarChart, Bar, Cell, LineChart, Line, Legend,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { C, SHADOW, CARD, SECTION_TITLE, chartPalette, EmptyState, Skeleton } from '../report/reportTheme';
import { formatCompactIDR, formatNumberID, toTonPerHkRows } from '../../utils/dashboardDerivations';

const tooltipStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    boxShadow: SHADOW, fontSize: 12, color: C.text
};

const formatTon = (v) => `${formatNumberID(Math.round(v || 0))} ton`;

/**
 * Section Produktivitas: tren tonase, cost/ton vs cost/HK, peringkat ton/HK divisi.
 * Tonase hanya bermakna untuk scope panen — scope lain menampilkan empty state berpenjelasan.
 */
export default function ProductivitySection({ productivityTrend, divisions, loading, scopeLabel }) {
    if (loading) {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={230} />)}
            </div>
        );
    }

    const trend = Array.isArray(productivityTrend) ? productivityTrend : [];
    const hasTonase = trend.some(p => (p.totalTonase || 0) > 0);
    const tonPerHkRows = toTonPerHkRows(divisions);

    if (!hasTonase && tonPerHkRows.length === 0) {
        return (
            <EmptyState
                title="Produktivitas belum tersedia"
                message={`Data tonase tidak tersedia untuk cakupan ${scopeLabel || 'ini'}. Tonase divisi hanya bermakna pada cakupan panen; bila scope panen pun kosong, jalankan Aggregation Seeder.`}
            />
        );
    }

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
            <div style={CARD}>
                <div style={SECTION_TITLE}>Tren Tonase 12 Bulan</div>
                {hasTonase ? (
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumberID(Math.round(v))} width={56} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatTon(v), 'Tonase']} />
                            <Area type="monotone" dataKey="totalTonase" stroke={C.leafDark} strokeWidth={2} fill={C.leafDark} fillOpacity={0.12} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tonase kosong" message="Tonase tidak tersedia untuk cakupan ini." />
                )}
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Cost/Ton vs Cost/HK (12 bln)</div>
                {hasTonase ? (
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatCompactIDR(v), name]} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="costPerTon" name="Cost/Ton" stroke={C.costTon} strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="costPerHk" name="Cost/HK" stroke={C.lembur} strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tren biaya kosong" message="Data agregasi belum tersedia untuk periode ini." />
                )}
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Ton/HK per Divisi</div>
                {tonPerHkRows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(160, tonPerHkRows.length * 34)}>
                        <BarChart data={tonPerHkRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} />
                            <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(2)} ton/HK`, 'Ton/HK']} />
                            <Bar dataKey="tonPerHk" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                                {tonPerHkRows.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Peringkat kosong" message="Belum ada divisi dengan tonase dan HK untuk periode ini." />
                )}
            </div>
        </div>
    );
}
