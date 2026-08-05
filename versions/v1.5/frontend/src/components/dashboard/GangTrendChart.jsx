import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Plus, X, Search } from 'lucide-react';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `Rp ${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `Rp ${(val / 1000).toFixed(0)}rb`;
    return `Rp ${val.toFixed(0)}`;
};

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'];

const METRICS = [
    { key: 'cost_per_hk', label: 'Cost / HK', formatter: formatCurrency },
    { key: 'total_wage', label: 'Total Wage', formatter: formatCurrency },
    { key: 'total_ot', label: 'Total Overtime', formatter: formatCurrency },
    { key: 'total_premi', label: 'Total Premi', formatter: formatCurrency },
    { key: 'headcount', label: 'Headcount', formatter: (v) => `${v} Emp` },
];

export default function GangTrendChart({ token, month, year, divisionCode }) {
    const [rawData, setRawData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedGangs, setSelectedGangs] = useState([]); // Array of strings
    const [availableGangs, setAvailableGangs] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [metric, setMetric] = useState('cost_per_hk');

    useEffect(() => {
        if (token && month && year) {
            fetchTrends();
        }
    }, [token, month, year, divisionCode]);

    const fetchTrends = async () => {
        setLoading(true);
        try {
            const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';

            // Safe URL construction
            const params = new URLSearchParams({
                month: month,
                year: year
            });
            if (divisionCode) params.append('division_code', divisionCode);

            const url = `${apiUrl}/payroll/dashboard/all-gangs-trend?${params.toString()}`;

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            if (json.success) {
                setRawData(json.data);

                // Extract unique gangs
                const unique = [...new Set(json.data.map(d => d.gang_code))].sort();
                setAvailableGangs(unique);

                // Default selection: Top 3 by current month cost if nothing selected
                if (selectedGangs.length === 0 && unique.length > 0) {
                    setSelectedGangs(unique.slice(0, 5));
                } else {
                    // Filter out selected gangs that are no longer available (e.g. division change)
                    setSelectedGangs(prev => prev.filter(g => unique.includes(g)));
                }
            }
        } catch (e) {
            console.error("Failed to fetch trends", e);
        } finally {
            setLoading(false);
        }
    };

    // Pivot Data for Chart
    const chartData = useMemo(() => {
        if (!rawData.length) return [];

        const periods = [...new Set(rawData.map(d => `${d.month}/${d.year}`))];
        const periodObjs = [];

        // Calculate benchmarks per period
        const periodBenchmarks = {};

        rawData.forEach(d => {
            const key = `${d.year}-${String(d.month).padStart(2, '0')}`;
            if (!periodObjs.find(p => p.key === key)) {
                periodObjs.push({ key, year: d.year, month: d.month, label: `${d.month}/${d.year}` });
            }

            // Accumulate for benchmark
            const val = d[metric];
            if (val !== null && val !== undefined) {
                if (!periodBenchmarks[key]) periodBenchmarks[key] = { sum: 0, count: 0 };
                periodBenchmarks[key].sum += val;
                periodBenchmarks[key].count += 1;
            }
        });
        periodObjs.sort((a, b) => a.key.localeCompare(b.key));

        return periodObjs.map(p => {
            const row = { name: p.label };
            // Gang lines
            selectedGangs.forEach(g => {
                const entry = rawData.find(d => d.gang_code === g && d.month === p.month && d.year === p.year);
                row[g] = entry ? entry[metric] : null;
            });
            // Benchmark line
            const bench = periodBenchmarks[p.key];
            row['benchmark'] = bench && bench.count > 0 ? bench.sum / bench.count : null;

            return row;
        });

    }, [rawData, selectedGangs, metric]);

    const toggleGang = (gang) => {
        if (selectedGangs.includes(gang)) {
            setSelectedGangs(prev => prev.filter(g => g !== gang));
        } else {
            if (selectedGangs.length >= 10) {
                alert("Maximum 10 gangs can be compared at once");
                return;
            }
            setSelectedGangs(prev => [...prev, gang]);
        }
    };

    const filteredOptions = availableGangs.filter(g =>
        g.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !selectedGangs.includes(g)
    );

    const activeMetricConfig = METRICS.find(m => m.key === metric) || METRICS[0];

    if (loading && !rawData.length) return <div className="p-8 text-center text-gray-400">Loading trends...</div>;

    return (
        <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '1.5rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            marginBottom: '2rem'
        }}>
            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                        📈 {activeMetricConfig.label} Trend Analysis
                    </h3>
                    <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '4px 0 0 0' }}>
                        Compare historical {activeMetricConfig.label.toLowerCase()} across gangs (Last 6 Months)
                    </p>
                </div>

                {/* Metric Selector */}
                <select
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    style={{
                        padding: '8px 12px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '8px',
                        fontSize: '0.9rem',
                        color: '#334155',
                        outline: 'none',
                        cursor: 'pointer',
                        backgroundColor: '#f8fafc'
                    }}
                >
                    {METRICS.map(m => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                </select>
            </div>

            {/* Controls */}
            <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                    {selectedGangs.map((g, idx) => (
                        <span key={g} style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            backgroundColor: '#f1f5f9',
                            color: '#334155',
                            padding: '4px 8px',
                            borderRadius: '16px',
                            fontSize: '0.85rem',
                            fontWeight: '500',
                            border: `1px solid ${COLORS[idx % COLORS.length]}`
                        }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS[idx % COLORS.length] }}></span>
                            {g}
                            <button onClick={() => toggleGang(g)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                                <X size={14} />
                            </button>
                        </span>
                    ))}

                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 12px',
                                borderRadius: '16px',
                                border: '1px dashed #cbd5e1',
                                backgroundColor: 'white',
                                color: '#64748b',
                                fontSize: '0.85rem',
                                cursor: 'pointer'
                            }}
                        >
                            <Plus size={14} /> Add Gang
                        </button>

                        {isDropdownOpen && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '4px',
                                width: '250px',
                                backgroundColor: 'white',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                zIndex: 50,
                                maxHeight: '300px',
                                display: 'flex',
                                flexDirection: 'column'
                            }}>
                                <div style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f8fafc', padding: '6px', borderRadius: '6px' }}>
                                        <Search size={14} color="#94a3b8" />
                                        <input
                                            type="text"
                                            placeholder="Search gang..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.85rem' }}
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div style={{ overflowY: 'auto', flex: 1 }}>
                                    {filteredOptions.length > 0 ? (
                                        filteredOptions.map(g => (
                                            <div
                                                key={g}
                                                onClick={() => { toggleGang(g); setIsDropdownOpen(false); setSearchTerm(''); }}
                                                style={{
                                                    padding: '8px 12px',
                                                    fontSize: '0.9rem',
                                                    color: '#334155',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.target.style.backgroundColor = '#f1f5f9'}
                                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                                            >
                                                {g}
                                            </div>
                                        ))
                                    ) : (
                                        <div style={{ padding: '12px', fontSize: '0.85rem', color: '#94a3b8', textAlign: 'center' }}>No gangs found</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ height: '350px', minHeight: '200px' }}>
                {selectedGangs.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="name" />
                            <YAxis tickFormatter={(val) => activeMetricConfig.key === 'headcount' ? val : `${(val / 1000).toFixed(0)}k`} />
                            <Tooltip formatter={(val) => activeMetricConfig.formatter(val)} />
                            <Legend />
                            {selectedGangs.map((gang, idx) => (
                                <Line
                                    key={gang}
                                    type="monotone"
                                    dataKey={gang}
                                    stroke={COLORS[idx % COLORS.length]}
                                    strokeWidth={2}
                                    dot={{ r: 4 }}
                                    activeDot={{ r: 6 }}
                                />
                            ))}
                            {/* Benchmark Line */}
                            <Line
                                type="monotone"
                                dataKey="benchmark"
                                name="Division Avg"
                                stroke="#94a3b8"
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                dot={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', border: '2px dashed #e2e8f0', borderRadius: '8px' }}>
                        Select gangs to visualize trends
                    </div>
                )}
            </div>
        </div>
    );
}
