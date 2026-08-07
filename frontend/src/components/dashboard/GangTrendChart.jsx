import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Plus, X, Search, AlertTriangle } from 'lucide-react';
import { C, SHADOW, CARD, SECTION_TITLE, chartPalette } from '../report/reportTheme';
import { dashJson } from '../../utils/dashboardApi';
import { getScopeLabel } from '../../utils/gangTypes';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `Rp ${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `Rp ${(val / 1000).toFixed(0)}rb`;
    return `Rp ${val.toFixed(0)}`;
};

const COLORS = chartPalette;

const METRICS = [
    { key: 'cost_per_hk', label: 'Cost / HK', formatter: formatCurrency },
    { key: 'cost_per_ton', label: 'Cost / Ton', formatter: formatCurrency },
    { key: 'total_wage', label: 'Total Wage', formatter: formatCurrency },
    { key: 'total_ot', label: 'Total Overtime', formatter: formatCurrency },
    { key: 'total_premi', label: 'Total Premi', formatter: formatCurrency },
    { key: 'headcount', label: 'Headcount', formatter: (v) => `${v} Emp` },
];

export default function GangTrendChart({ token, month, year, divisionCode, scope = 'panen' }) {
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
    }, [token, month, year, divisionCode, scope]);

    const fetchTrends = async () => {
        setLoading(true);
        try {
            // Safe URL construction (scope diteruskan agar konsisten dengan toggle halaman)
            const params = new URLSearchParams({
                month: month,
                year: year,
                scope: scope
            });
            if (divisionCode) params.append('division_code', divisionCode);

            const json = await dashJson(`/all-gangs-trend?${params.toString()}`, { token });
            if (json.success) {
                setRawData(json.data);

                // Extract unique gangs
                const unique = [...new Set(json.data.map(d => d.gang_code))].sort();
                setAvailableGangs(unique);

                // Default selection: Top 3 by current month cost if nothing selected
                if (selectedGangs.length === 0 && unique.length > 0) {
                    setSelectedGangs(unique.slice(0, 5));
                } else {
                    // Filter out selected gangs that are no longer available (e.g. division/scope change)
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

    if (loading && !rawData.length) {
        return (
            <div style={{ ...CARD, marginBottom: '2rem', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
                Memuat tren gang...
            </div>
        );
    }

    return (
        <div style={{ ...CARD, marginBottom: '2rem' }}>
            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                    <h3 style={{ ...SECTION_TITLE, marginBottom: 4 }}>
                        Tren {activeMetricConfig.label}
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: C.muted, margin: 0 }}>
                        {getScopeLabel(scope)} · perbandingan historis {activeMetricConfig.label.toLowerCase()} antar gang (6 bulan terakhir)
                    </p>
                    {metric === 'cost_per_ton' && (
                        <p style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.78rem', color: C.lembur, margin: '6px 0 0 0', fontWeight: 600 }}>
                            <AlertTriangle size={13} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                            Cost/ton per gang memakai tonase divisi (broadcast), gang dalam divisi yang sama tampil identik. Angka valid per divisi.
                        </p>
                    )}
                </div>

                {/* Metric Selector */}
                <select
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    style={{
                        padding: '8px 12px',
                        border: `1px solid ${C.border}`,
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        color: C.text2,
                        outline: 'none',
                        cursor: 'pointer',
                        backgroundColor: C.surface
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
                            backgroundColor: C.surface2,
                            color: C.text2,
                            padding: '4px 8px',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            fontWeight: '500',
                            border: `1px solid ${COLORS[idx % COLORS.length]}`
                        }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS[idx % COLORS.length] }}></span>
                            {g}
                            <button onClick={() => toggleGang(g)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: C.muted }}>
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
                                borderRadius: '8px',
                                border: `1px dashed ${C.border}`,
                                backgroundColor: C.surface,
                                color: C.muted,
                                fontSize: '0.85rem',
                                cursor: 'pointer'
                            }}
                        >
                            <Plus size={14} /> Tambah Gang
                        </button>

                        {isDropdownOpen && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '4px',
                                width: '250px',
                                backgroundColor: C.surface,
                                border: `1px solid ${C.border}`,
                                borderRadius: '8px',
                                boxShadow: SHADOW,
                                zIndex: 50,
                                maxHeight: '300px',
                                display: 'flex',
                                flexDirection: 'column'
                            }}>
                                <div style={{ padding: '8px', borderBottom: `1px solid ${C.border}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: C.surface2, padding: '6px', borderRadius: '6px' }}>
                                        <Search size={14} color={C.muted} />
                                        <input
                                            type="text"
                                            placeholder="Cari gang..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.85rem', color: C.text }}
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
                                                    color: C.text2,
                                                    cursor: 'pointer',
                                                    transition: 'background 0.15s'
                                                }}
                                                onMouseEnter={(e) => e.target.style.backgroundColor = C.surface2}
                                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                                            >
                                                {g}
                                            </div>
                                        ))
                                    ) : (
                                        <div style={{ padding: '12px', fontSize: '0.85rem', color: C.muted, textAlign: 'center' }}>Tidak ada gang ditemukan</div>
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
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.gridLine} />
                            <XAxis dataKey="name" tick={{ fill: C.muted, fontSize: 11 }} />
                            <YAxis tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={(val) => activeMetricConfig.key === 'headcount' ? val : `${(val / 1000).toFixed(0)}k`} />
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
                                name="Rata-rata"
                                stroke={C.muted}
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                dot={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, border: `1px dashed ${C.border}`, borderRadius: '8px', background: C.surface2 }}>
                        Pilih gang untuk menampilkan tren
                    </div>
                )}
            </div>
        </div>
    );
}
