import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)}rb`;
    return val.toFixed(0);
};

export default function GangCostBreakdownChart({ data, loading, onGangClick }) {
    const [sortBy, setSortBy] = useState('total'); // total, base_wage, overtime, premi

    // ALL HOOKS MUST BE BEFORE ANY EARLY RETURNS (React rules of hooks)
    // Transform data for stacked bar chart
    const safeData = Array.isArray(data) ? data : [];
    
    const chartData = useMemo(() => {
        if (safeData.length === 0) return [];
        return safeData.map(gang => {
            const baseWage = (gang.total_wage || 0) - (gang.total_ot || 0) - (gang.total_premi || 0);
            return {
                gang_code: gang.gang_code,
                gang_name: gang.gang_name,
                base_wage: Math.max(0, baseWage),
                overtime: gang.total_ot || 0,
                premi: gang.total_premi || 0,
                total: gang.total_wage || 0,
                headcount: gang.headcount || 0
            };
        });
    }, [safeData]);

    // Sort data
    const sortedData = useMemo(() => {
        if (chartData.length === 0) return [];
        return [...chartData].sort((a, b) => {
            if (sortBy === 'total') return b.total - a.total;
            if (sortBy === 'base_wage') return b.base_wage - a.base_wage;
            if (sortBy === 'overtime') return b.overtime - a.overtime;
            if (sortBy === 'premi') return b.premi - a.premi;
            return 0;
        });
    }, [chartData, sortBy]);

    if (loading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '400px',
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '2rem',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}>
                <div style={{ color: '#64748b', fontSize: '1.1rem' }}>Loading cost breakdown...</div>
            </div>
        );
    }

    if (safeData.length === 0) {
        return (
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '2rem',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                textAlign: 'center'
            }}>
                <div style={{ color: '#94a3b8', fontSize: '1.1rem' }}>No cost data available</div>
            </div>
        );
    }

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div style={{
                    backgroundColor: 'white',
                    padding: '12px 16px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}>
                    <div style={{ fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
                        {data.gang_code}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '8px' }}>
                        {data.gang_name} • {data.headcount} emp
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#334155' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '4px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ width: '10px', height: '10px', backgroundColor: '#3b82f6', borderRadius: '2px' }}></span>
                                Base Wage:
                            </span>
                            <strong>Rp {formatCurrency(data.base_wage)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '4px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ width: '10px', height: '10px', backgroundColor: '#f97316', borderRadius: '2px' }}></span>
                                Overtime:
                            </span>
                            <strong>Rp {formatCurrency(data.overtime)}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '4px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ width: '10px', height: '10px', backgroundColor: '#10b981', borderRadius: '2px' }}></span>
                                Premi:
                            </span>
                            <strong>Rp {formatCurrency(data.premi)}</strong>
                        </div>
                        <div style={{ borderTop: '1px solid #e2e8f0', marginTop: '8px', paddingTop: '4px', fontWeight: '700' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Total:</span>
                                <span>Rp {formatCurrency(data.total)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '1.5rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
                flexWrap: 'wrap',
                gap: '1rem'
            }}>
                <div>
                    <h3 style={{
                        fontSize: '1.2rem',
                        fontWeight: '700',
                        color: '#1e293b',
                        margin: 0
                    }}>
                        💰 Gang Cost Composition
                    </h3>
                    <p style={{
                        fontSize: '0.9rem',
                        color: '#64748b',
                        margin: '4px 0 0 0'
                    }}>
                        Breakdown of wages, overtime, and premi for {sortedData.length} gangs
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '600' }}>
                        Sort by:
                    </label>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            backgroundColor: 'white',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            color: '#334155',
                            cursor: 'pointer',
                            outline: 'none'
                        }}
                    >
                        <option value="total">Total Cost</option>
                        <option value="base_wage">Base Wage</option>
                        <option value="overtime">Overtime</option>
                        <option value="premi">Premi</option>
                    </select>
                </div>
            </div>

            {/* Legend */}
            <div style={{
                display: 'flex',
                gap: '1.5rem',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                flexWrap: 'wrap'
            }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '14px', height: '14px', backgroundColor: '#3b82f6', borderRadius: '3px' }}></span>
                    <span style={{ fontWeight: '600', color: '#334155' }}>Base Wage</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '14px', height: '14px', backgroundColor: '#f97316', borderRadius: '3px' }}></span>
                    <span style={{ fontWeight: '600', color: '#334155' }}>Overtime</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '14px', height: '14px', backgroundColor: '#10b981', borderRadius: '3px' }}></span>
                    <span style={{ fontWeight: '600', color: '#334155' }}>Premi</span>
                </span>
            </div>

            <div style={{ height: Math.max(400, sortedData.length * 35), minHeight: '200px' }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                    <BarChart
                        data={sortedData}
                        layout="vertical"
                        margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                        <XAxis
                            type="number"
                            tickFormatter={(val) => `${(val / 1000000).toFixed(0)}jt`}
                        />
                        <YAxis
                            type="category"
                            dataKey="gang_code"
                            width={90}
                            tick={{ fontSize: 12 }}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar
                            dataKey="base_wage"
                            stackId="a"
                            fill="#3b82f6"
                            name="Base Wage"
                            onClick={(data) => onGangClick && onGangClick(data)}
                            cursor="pointer"
                        />
                        <Bar
                            dataKey="overtime"
                            stackId="a"
                            fill="#f97316"
                            name="Overtime"
                            onClick={(data) => onGangClick && onGangClick(data)}
                            cursor="pointer"
                        />
                        <Bar
                            dataKey="premi"
                            stackId="a"
                            fill="#10b981"
                            name="Premi"
                            radius={[0, 4, 4, 0]}
                            onClick={(data) => onGangClick && onGangClick(data)}
                            cursor="pointer"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Summary Stats */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '1rem',
                marginTop: '1.5rem',
                padding: '1rem',
                backgroundColor: '#f8fafc',
                borderRadius: '8px'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600', marginBottom: '4px' }}>
                        Total Base Wage
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#3b82f6' }}>
                        Rp {formatCurrency(sortedData.reduce((sum, g) => sum + g.base_wage, 0))}
                    </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600', marginBottom: '4px' }}>
                        Total Overtime
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#f97316' }}>
                        Rp {formatCurrency(sortedData.reduce((sum, g) => sum + g.overtime, 0))}
                    </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600', marginBottom: '4px' }}>
                        Total Premi
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#10b981' }}>
                        Rp {formatCurrency(sortedData.reduce((sum, g) => sum + g.premi, 0))}
                    </div>
                </div>
            </div>
        </div>
    );
}
