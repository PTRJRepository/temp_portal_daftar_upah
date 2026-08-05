import React, { useState, useEffect } from 'react';
import {
    ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList
} from 'recharts';

// Using Rebinmas official colors - extended palette for many items
const COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
    '#06b6d4', '#d946ef', '#84cc16', '#f97316', '#ec4899',
    '#14b8a6', '#6366f1', '#eab308', '#22c55e', '#a855f7',
    '#0ea5e9', '#fb7185', '#4ade80', '#facc15', '#c084fc'
];

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (Math.abs(val) >= 1000000000) {
        return `Rp ${(val / 1000000000).toFixed(2)} M`;
    }
    if (Math.abs(val) >= 1000000) {
        return `Rp ${(val / 1000000).toFixed(1)} jt`;
    }
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val);
};

// Clean up premi name for display
const cleanPremiName = (name) => {
    return name
        .replace(/^premi_/i, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

const PremiCompositionChart = ({ month, year, division }) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState('bar'); // Default to bar for many items

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
                const queryParams = new URLSearchParams({
                    month: String(month),
                    year: String(year),
                    ...(division && division !== 'ALL' && { division_code: division })
                });

                const response = await fetch(`${apiUrl}/payroll/dashboard/premi-analysis?${queryParams}`);
                const result = await response.json();

                if (result.success) {
                    // Clean up names for display
                    const cleanedData = result.data.map(item => ({
                        ...item,
                        displayName: cleanPremiName(item.name)
                    }));
                    setData(cleanedData);
                } else {
                    setError(result.error);
                }
            } catch (err) {
                console.error("Failed to fetch premi analysis:", err);
                setError("Failed to load data");
            } finally {
                setLoading(false);
            }
        };

        if (month && year) {
            fetchData();
        }
    }, [month, year, division]);

    // Calculate total and percentages
    const total = data.reduce((sum, item) => sum + item.value, 0);
    const sortedData = [...data].sort((a, b) => b.value - a.value);

    // Dynamic height based on number of items
    const chartHeight = Math.max(400, sortedData.length * 28);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem', color: '#64748b' }}>
                <span>Loading premi data...</span>
            </div>
        );
    }

    if (error || data.length === 0) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                <p>No detailed premi data available</p>
            </div>
        );
    }

    // Custom label for bar chart with callout style
    const renderCustomBarLabel = ({ x, y, width, value, index }) => {
        const item = sortedData[index];
        const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
        return (
            <text
                x={x + width + 8}
                y={y + 10}
                fill="#475569"
                fontSize={11}
                fontWeight="500"
            >
                {formatCurrency(value)} ({percentage}%)
            </text>
        );
    };

    return (
        <div style={{ width: '100%' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', margin: 0 }}>
                    Komposisi Premi ({sortedData.length} jenis)
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        onClick={() => setViewMode('pie')}
                        style={{
                            padding: '4px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: viewMode === 'pie' ? '#3b82f6' : '#e2e8f0',
                            color: viewMode === 'pie' ? 'white' : '#64748b',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.8rem'
                        }}
                    >
                        Pie
                    </button>
                    <button
                        onClick={() => setViewMode('bar')}
                        style={{
                            padding: '4px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: viewMode === 'bar' ? '#3b82f6' : '#e2e8f0',
                            color: viewMode === 'bar' ? 'white' : '#64748b',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.8rem'
                        }}
                    >
                        Bar
                    </button>
                </div>
            </div>

            {/* Total Summary */}
            <div style={{
                backgroundColor: '#f8fafc',
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                textAlign: 'center'
            }}>
                <div style={{ color: '#64748b', fontSize: '0.85rem' }}>Total Premi</div>
                <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#1e293b' }}>{formatCurrency(total)}</div>
            </div>

            {/* Chart */}
            <div style={{ height: viewMode === 'bar' ? chartHeight : 350, width: '100%', minHeight: '200px' }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                    {viewMode === 'pie' ? (
                        <PieChart>
                            <Pie
                                data={sortedData.slice(0, 10)} // Limit pie to top 10 for readability
                                cx="50%"
                                cy="50%"
                                labelLine={true}
                                outerRadius={100}
                                fill="#8884d8"
                                dataKey="value"
                                nameKey="displayName"
                                label={({ displayName, percent }) => `${displayName} (${(percent * 100).toFixed(0)}%)`}
                            >
                                {sortedData.slice(0, 10).map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                            <Legend />
                        </PieChart>
                    ) : (
                        <BarChart
                            data={sortedData}
                            layout="vertical"
                            margin={{ left: 120, right: 150, top: 10, bottom: 10 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                            <XAxis
                                type="number"
                                tickFormatter={(val) => `${(val / 1000000).toFixed(0)}jt`}
                                fontSize={10}
                            />
                            <YAxis
                                dataKey="displayName"
                                type="category"
                                width={110}
                                fontSize={11}
                                tick={{ fill: '#334155' }}
                            />
                            <Tooltip formatter={(value) => formatCurrency(value)} />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                {sortedData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                                <LabelList
                                    dataKey="value"
                                    position="right"
                                    content={renderCustomBarLabel}
                                />
                            </Bar>
                        </BarChart>
                    )}
                </ResponsiveContainer>
            </div>

            {/* Compact Summary Table - Top 5 only */}
            <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#64748b' }}>
                <strong>Top 5 Kontributor:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
                    {sortedData.slice(0, 5).map((item, index) => (
                        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{
                                width: '10px',
                                height: '10px',
                                borderRadius: '2px',
                                backgroundColor: COLORS[index % COLORS.length],
                                display: 'inline-block'
                            }}></span>
                            <span>{item.displayName}: {formatCurrency(item.value)} ({(item.value / total * 100).toFixed(1)}%)</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PremiCompositionChart;
