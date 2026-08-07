import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Users, DollarSign } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    AreaChart, Area
} from 'recharts';
import { C, SHADOW, CARD } from '../report/reportTheme';
import { dashJson } from '../../utils/dashboardApi';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `Rp ${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `Rp ${(val / 1000).toFixed(0)}rb`;
    return `Rp ${val.toFixed(0)}`;
};

export default function GangDetailModal({ isOpen, onClose, gangCode, month, year, token }) {
    const [loading, setLoading] = useState(false);
    const [historyData, setHistoryData] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen && gangCode && token) {
            fetchGangHistory();
        }
    }, [isOpen, gangCode, token]);

    const fetchGangHistory = async () => {
        setLoading(true);
        setError(null);
        try {
            const json = await dashJson(`/gang-history?gang_code=${gangCode}&month=${month}&year=${year}`, { token });
            if (json.success) {
                // Format months for display
                const formatted = json.data.map(d => ({
                    ...d,
                    period: `${d.month}/${d.year}`,
                    formattedWage: formatCurrency(d.total_wage),
                    sub_productivity: d.total_hk > 0 ? d.total_premi / d.total_hk : 0,
                    ot_ratio: d.total_wage > 0 ? (d.total_ot / d.total_wage) * 100 : 0
                }));
                setHistoryData(formatted);
            } else {
                setError(json.message || 'Gagal memuat riwayat gang');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const currentMonthData = historyData.length > 0 ? historyData[historyData.length - 1] : null;

    const kpiTile = (icon, label, value, color) => (
        <div style={{ padding: '1rem', backgroundColor: C.surface2, borderRadius: '10px', border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color }}>
                {icon}
                <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: '700', color: C.text, fontVariantNumeric: 'tabular-nums', fontFamily: 'Roboto Mono, monospace' }}>
                {value}
            </div>
        </div>
    );

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(21, 33, 26, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
        }} onClick={onClose}>
            <div style={{
                backgroundColor: C.surface,
                borderRadius: '10px',
                border: `1px solid ${C.border}`,
                width: '100%',
                maxWidth: '900px',
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: SHADOW,
                position: 'relative'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '1.5rem',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    position: 'sticky',
                    top: 0,
                    backgroundColor: C.surface,
                    zIndex: 10
                }}>
                    <div>
                        <div style={{ fontSize: '0.72rem', color: C.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Analisis Detail Gang</div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: C.text, margin: 0, fontFamily: 'var(--font-display)' }}>
                            {gangCode}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px',
                            borderRadius: '8px',
                            border: `1px solid ${C.border}`,
                            backgroundColor: C.surface2,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <X size={20} color={C.muted} />
                    </button>
                </div>

                <div style={{ padding: '1.5rem' }}>
                    {loading ? (
                        <div style={{ padding: '4rem', textAlign: 'center', color: C.muted }}>
                            Memuat riwayat gang...
                        </div>
                    ) : error ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: C.potongan }}>
                            Error: {error}
                        </div>
                    ) : (
                        <>
                            {/* KPI Grid */}
                            {currentMonthData && (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                    gap: '1rem',
                                    marginBottom: '2rem'
                                }}>
                                    {kpiTile(<Users size={18} />, 'Headcount', currentMonthData.headcount, C.upah)}
                                    {kpiTile(<DollarSign size={18} />, 'Total Wage', formatCurrency(currentMonthData.total_wage), C.premi)}
                                    {kpiTile(<TrendingUp size={18} />, 'Cost / HK', formatCurrency(currentMonthData.cost_per_hk), C.costTon)}
                                    {kpiTile(<TrendingUp size={18} />, 'Productivity (Premi/HK)', formatCurrency(currentMonthData.sub_productivity), C.lembur)}
                                </div>
                            )}

                            {/* Charts */}
                            <div style={{ display: 'grid', gap: '2rem' }}>
                                {/* Cost Trend */}
                                <div style={{ backgroundColor: C.surface, borderRadius: '10px', padding: '1rem', border: `1px solid ${C.border}` }}>
                                    <h3 style={{ fontSize: '0.78rem', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>
                                        Tren Cost per HK (6 Bulan)
                                    </h3>
                                    <div style={{ height: '300px' }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={historyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                                <XAxis dataKey="period" tick={{ fill: C.muted, fontSize: 11 }} />
                                                <YAxis tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.gridLine} />
                                                <Tooltip formatter={(val) => formatCurrency(val)} />
                                                <Area type="monotone" dataKey="cost_per_hk" stroke={C.costTon} strokeWidth={2} fill={C.costTon} fillOpacity={0.12} name="Cost/HK" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Wage vs Overtime */}
                                <div style={{ backgroundColor: C.surface, borderRadius: '10px', padding: '1rem', border: `1px solid ${C.border}` }}>
                                    <h3 style={{ fontSize: '0.78rem', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>
                                        Korelasi Input (Upah) vs Output (Premi)
                                    </h3>
                                    <div style={{ height: '300px' }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={historyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.gridLine} />
                                                <XAxis dataKey="period" tick={{ fill: C.muted, fontSize: 11 }} />
                                                <YAxis yAxisId="left" tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={(val) => `${(val / 1000000).toFixed(0)}jt`} />
                                                <YAxis yAxisId="right" orientation="right" tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={(val) => `${(val / 1000000).toFixed(1)}jt`} />
                                                <Tooltip formatter={(val) => formatCurrency(val)} />
                                                <Legend />
                                                <Line yAxisId="left" type="monotone" dataKey="total_wage" stroke={C.upah} name="Total Wage (Input)" strokeWidth={2} />
                                                <Line yAxisId="right" type="monotone" dataKey="total_premi" stroke={C.premi} name="Total Premi (Output)" strokeWidth={2} />
                                                <Line yAxisId="left" type="monotone" dataKey="total_ot" stroke={C.lembur} name="Overtime" strokeWidth={2} strokeDasharray="3 3" />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
