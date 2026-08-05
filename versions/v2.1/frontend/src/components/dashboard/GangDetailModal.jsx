import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Users, DollarSign, Calendar } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    AreaChart, Area
} from 'recharts';

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
            const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
            const res = await fetch(`${apiUrl}/payroll/dashboard/gang-history?gang_code=${gangCode}&month=${month}&year=${year}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
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
                setError(json.message || 'Failed to fetch history');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const currentMonthData = historyData.length > 0 ? historyData[historyData.length - 1] : null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
        }} onClick={onClose}>
            <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '900px',
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                position: 'relative'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '1.5rem',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    position: 'sticky',
                    top: 0,
                    backgroundColor: 'white',
                    zIndex: 10
                }}>
                    <div>
                        <div style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: '600' }}>Gang Detail Analysis</div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#1e293b', margin: 0 }}>
                            {gangCode}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px',
                            borderRadius: '50%',
                            border: 'none',
                            backgroundColor: '#f1f5f9',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <X size={20} color="#64748b" />
                    </button>
                </div>

                <div style={{ padding: '1.5rem' }}>
                    {loading ? (
                        <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
                            Loading gang history...
                        </div>
                    ) : error ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
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
                                    <div style={{ padding: '1rem', backgroundColor: '#eff6ff', borderRadius: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#3b82f6' }}>
                                            <Users size={18} />
                                            <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>Headcount</span>
                                        </div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>
                                            {currentMonthData.headcount}
                                        </div>
                                    </div>
                                    <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#10b981' }}>
                                            <DollarSign size={18} />
                                            <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>Total Wage</span>
                                        </div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>
                                            {formatCurrency(currentMonthData.total_wage)}
                                        </div>
                                    </div>
                                    <div style={{ padding: '1rem', backgroundColor: '#fff7ed', borderRadius: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#f97316' }}>
                                            <TrendingUp size={18} />
                                            <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>Cost / HK</span>
                                        </div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>
                                            {formatCurrency(currentMonthData.cost_per_hk)}
                                        </div>
                                    </div>
                                    <div style={{ padding: '1rem', backgroundColor: '#faf5ff', borderRadius: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#a855f7' }}>
                                            <TrendingUp size={18} />
                                            <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>Productivity (Premi/HK)</span>
                                        </div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b' }}>
                                            {formatCurrency(currentMonthData.sub_productivity)}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Charts */}
                            <div style={{ display: 'grid', gap: '2rem' }}>
                                {/* Cost Trend */}
                                <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '1rem', border: '1px solid #e2e8f0' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1rem' }}>
                                        6-Month Cost per HK Trend
                                    </h3>
                                    <div style={{ height: '300px' }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={historyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <XAxis dataKey="period" />
                                                <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <Tooltip formatter={(val) => formatCurrency(val)} />
                                                <Area type="monotone" dataKey="cost_per_hk" stroke="#f59e0b" fillOpacity={1} fill="url(#colorCost)" name="Cost/HK" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Wage vs Overtime */}
                                <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '1rem', border: '1px solid #e2e8f0' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1rem' }}>
                                        Input (Wage) vs Output (Premi) Correlation
                                    </h3>
                                    <div style={{ height: '300px' }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={historyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="period" />
                                                <YAxis yAxisId="left" tickFormatter={(val) => `${(val / 1000000).toFixed(0)}jt`} />
                                                <YAxis yAxisId="right" orientation="right" tickFormatter={(val) => `${(val / 1000000).toFixed(1)}jt`} />
                                                <Tooltip formatter={(val) => formatCurrency(val)} />
                                                <Legend />
                                                <Line yAxisId="left" type="monotone" dataKey="total_wage" stroke="#3b82f6" name="Total Wage (Input)" strokeWidth={2} />
                                                <Line yAxisId="right" type="monotone" dataKey="total_premi" stroke="#10b981" name="Total Premi (Output)" strokeWidth={2} />
                                                <Line yAxisId="left" type="monotone" dataKey="total_ot" stroke="#f97316" name="Overtime" strokeWidth={2} strokeDasharray="3 3" />
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
