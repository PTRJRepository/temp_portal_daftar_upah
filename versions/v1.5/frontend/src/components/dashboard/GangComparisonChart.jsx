import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import '../../styles/gang-report-print.css';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `Rp ${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `Rp ${(val / 1000).toFixed(0)}rb`;
    return `Rp ${val.toFixed(0)}`;
};

const formatNumber = (val) => {
    if (val === null || val === undefined) return '0';
    return new Intl.NumberFormat('id-ID').format(val);
};

// Format bunches with K suffix for large numbers
const formatBunches = (val) => {
    if (val === null || val === undefined) return '0';
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    return val.toString();
};

// Get gang type from last character of gang code
const getGangType = (gangCode) => {
    if (!gangCode) return 'uncategorized';
    const lastChar = gangCode.slice(-1).toUpperCase();
    if (lastChar === 'H') return 'harvesting';
    if (lastChar === 'T') return 'transport';
    if (lastChar === 'M') return 'maintenance';
    return 'uncategorized';
};

// Check if gang belongs to IJL division (Starts with L)
const isIJLGang = (gangCode) => {
    if (!gangCode) return false;
    return gangCode.toUpperCase().startsWith('L');
};

// Get gang type label
const getGangTypeLabel = (type) => {
    const labels = {
        harvesting: 'Panen (Harvesting)',
        transport: 'Transport',
        maintenance: 'Maintenance',
        uncategorized: 'Lainnya'
    };
    return labels[type] || type;
};

// Get gang type color
const getGangTypeColor = (type) => {
    const colors = {
        harvesting: '#16a34a',
        transport: '#2563eb',
        maintenance: '#d97706',
        uncategorized: '#64748b'
    };
    return colors[type] || '#64748b';
};

// Helper to get month name
const getMonthName = (monthNum) => {
    const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return months[monthNum] || '';
};

// Color coding based on performance (cost/HK)
const getPerformanceColor = (value, allValues, metric) => {
    if (metric !== 'cost_per_hk') return '#3b82f6'; // Default blue for other metrics

    if (!allValues || allValues.length === 0) return '#3b82f6';

    const sorted = [...allValues].sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p75 = sorted[Math.floor(sorted.length * 0.75)];

    if (value <= p25) return '#10b981'; // Green - Top performers (Low Cost/HK)
    if (value >= p75) return '#ef4444'; // Red - Needs attention (High Cost/HK)
    return '#f59e0b'; // Orange - Average
};


// ... existing helpers ...

export default function GangComparisonChart({ data, loading, onGangClick, month, year }) {
    const navigate = useNavigate(); // Hook for navigation
    const [sortBy, setSortBy] = useState('cost_per_hk');

    // ALL HOOKS MUST BE BEFORE ANY EARLY RETURNS (React rules of hooks)
    // Enrich data with gang type and division info
    const safeData = Array.isArray(data) ? data : [];
    const enrichedData = useMemo(() => {
        if (safeData.length === 0) return [];
        return safeData.map(gang => ({
            ...gang,
            gang_type: getGangType(gang.gang_code),
            is_ijl: isIJLGang(gang.gang_code)
        }));
    }, [safeData]);

    // Sort Data
    const sortedData = useMemo(() => {
        if (enrichedData.length === 0) return [];
        return [...enrichedData].sort((a, b) => b[sortBy] - a[sortBy]);
    }, [enrichedData, sortBy]);

    const handleGenerateReport = () => {
        const params = new URLSearchParams({
            month: month,
            year: year,
            division: 'ALL',
            type: 'ALL'
        });
        navigate(`/gang-comparison-report?${params.toString()}`);
    };

    if (loading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '400px',
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '2rem'
            }}>
                <div style={{ color: '#64748b', fontSize: '1.1rem' }}>Loading gang comparison...</div>
            </div>
        );
    }

    if (safeData.length === 0) {
        return (
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '2rem',
                textAlign: 'center'
            }}>
                <div style={{ color: '#94a3b8', fontSize: '1.1rem' }}>No gang data available</div>
            </div>
        );
    }

    // Config based on sort metric
    const getMetricConfig = () => {
        switch (sortBy) {
            case 'cost_per_hk': return { label: 'Cost/HK', formatter: formatCurrency };
            case 'total_wage': return { label: 'Total Wage', formatter: formatCurrency };
            case 'headcount': return { label: 'Headcount', formatter: (val) => `${val} Emp` };
            case 'total_hk': return { label: 'Total HK', formatter: (val) => val.toLocaleString() };
            case 'total_ffb_bunches': return { label: 'FFB Bunches', formatter: formatBunches };
            default: return { label: 'Value', formatter: (val) => val };
        }
    };

    const metricConfig = getMetricConfig();
    const allMetricValues = safeData.map(d => d[sortBy]);

    // Removed Report Data Logic (moved to page)

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const gang = payload[0].payload;
            const gangType = getGangType(gang.gang_code);
            const isHarvesting = gangType === 'harvesting';
            
            return (
                <div style={{
                    backgroundColor: 'white',
                    padding: '12px 16px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}>
                    <div style={{ fontWeight: '700', color: '#1e293b', marginBottom: '8px' }}>
                        {gang.gang_code}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '8px' }}>
                        {gang.gang_name || gang.gang_description}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#334155' }}>
                        <div><strong>Cost/HK:</strong> {formatCurrency(gang.cost_per_hk)}</div>
                        <div><strong>Headcount:</strong> {gang.headcount} emp</div>
                        <div><strong>Total HK:</strong> {gang.total_hk.toLocaleString()}</div>
                        <div><strong>Total Wage:</strong> {formatCurrency(gang.total_wage)}</div>
                        <div><strong>Gang Type:</strong> {getGangTypeLabel(gangType)}</div>
                        {isHarvesting && gang.total_ffb_bunches > 0 && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                                <div style={{ color: '#16a34a', fontWeight: '600' }}>
                                    🌴 FFB Bunches: {formatNumber(gang.total_ffb_bunches)}
                                </div>
                                {gang.harvester_count > 0 && (
                                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                                        Harvesters: {gang.harvester_count} emp
                                    </div>
                                )}
                            </div>
                        )}
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
                        📊 Gang Performance Comparison
                    </h3>
                    <button
                        onClick={handleGenerateReport}
                        style={{
                            padding: '0.4rem 0.8rem',
                            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            boxShadow: '0 2px 4px rgba(15, 23, 42, 0.2)',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.transform = 'translateY(-1px)'}
                        onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
                    >
                        🖨️ Generate Report
                    </button>
                    <p style={{
                        fontSize: '0.9rem',
                        color: '#64748b',
                        margin: '4px 0 0 0'
                    }}>
                        Comparing by <span style={{ fontWeight: '600', color: '#3b82f6' }}>{metricConfig.label}</span> | {data.length} gangs
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
                        <option value="cost_per_hk">Cost per HK</option>
                        <option value="total_wage">Total Wage</option>
                        <option value="headcount">Headcount</option>
                        <option value="total_hk">Total HK</option>
                        <option value="total_ffb_bunches">FFB Bunches</option>
                    </select>
                </div>
            </div>

            <div style={{ height: Math.max(400, safeData.length * 35), minHeight: '200px' }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                    <BarChart
                        data={sortedData}
                        layout="vertical"
                        margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                        <XAxis
                            type="number"
                            tickFormatter={(val) => {
                                if (sortBy === 'headcount') return val;
                                if (sortBy === 'total_ffb_bunches') return formatBunches(val);
                                return `${(val / 1000).toFixed(0)}k`;
                            }}
                        />
                        <YAxis
                            type="category"
                            dataKey="gang_code"
                            width={90}
                            tick={{ fontSize: 12 }}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar
                            dataKey={sortBy}
                            name={metricConfig.label}
                            radius={[0, 4, 4, 0]}
                            onClick={onGangClick}
                            cursor="pointer"
                        >
                            {sortedData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={getPerformanceColor(entry[sortBy], allMetricValues, sortBy)}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Modal Removed */}
        </div>
    );
}
