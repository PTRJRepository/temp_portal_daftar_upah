import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Cell
} from 'recharts';
import { Filter, BarChart3, TrendingUp, Info } from 'lucide-react';
import ReportWatermark from '../components/common/ReportWatermark';
import { printReport } from '../utils/printPageSetup';
import '../styles/gang-report-print.css';
import '../styles/report-print-foundation.css';

// Helper Functions
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

const formatTon = (val) => {
    if (val === null || val === undefined) return '0';
    return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val / 1000); // Convert kg to Ton
};

const getGangType = (gangCode) => {
    if (!gangCode) return 'uncategorized';
    const lastChar = gangCode.slice(-1).toUpperCase();
    if (lastChar === 'H') return 'harvesting';
    if (lastChar === 'T') return 'transport';
    if (lastChar === 'M') return 'maintenance';
    return 'uncategorized';
};

const isIJLGang = (gangCode) => {
    if (!gangCode) return false;
    return gangCode.toUpperCase().startsWith('L');
};

const getGangTypeLabel = (type) => {
    const labels = {
        harvesting: 'Panen (Harvesting)',
        transport: 'Transport',
        maintenance: 'Maintenance',
        uncategorized: 'Lainnya'
    };
    return labels[type] || type;
};

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

export default function GangComparisonReportPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    // State
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filter State (Local, synced with URL initially)
    const [divisionFilter, setDivisionFilter] = useState(searchParams.get('division') || 'ALL');
    const [gangTypeFilter, setGangTypeFilter] = useState(searchParams.get('type') || 'ALL');
    const [analysisMode, setAnalysisMode] = useState('HK'); // HK, TON, COST

    // Params from URL (for data fetching)
    const month = searchParams.get('month');
    const year = searchParams.get('year');

    // Fetch Data
    useEffect(() => {
        const fetchData = async () => {
            if (!month || !year) return;
            setLoading(true);
            try {
                // Fetch data from existing endpoint which returns comparison data
                const basePath = '/backend/upah/payroll/dashboard/gang-comparison';
                const query = new URLSearchParams();
                query.append('month', month);
                query.append('year', year);

                const url = `${basePath}?${query.toString()}`;

                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });

                const json = await res.json();
                if (json.success) {
                    setData(json.data);
                } else {
                    setError('Failed to load report data');
                }
            } catch (err) {
                console.error("Report fetch error:", err);
                setError('Network error');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [month, year]);

    // Update URL params when filters change (optional, but good for bookmarking)
    useEffect(() => {
        const newParams = new URLSearchParams(searchParams);
        newParams.set('division', divisionFilter);
        newParams.set('type', gangTypeFilter);
        setSearchParams(newParams);
    }, [divisionFilter, gangTypeFilter, setSearchParams, searchParams]);


    // Filter Logic
    const filteredReportData = useMemo(() => {
        // First enrich
        let result = data.map(gang => ({
            ...gang,
            gang_type: getGangType(gang.gang_code),
            is_ijl: isIJLGang(gang.gang_code),
            // Ensure numeric
            total_wage: parseFloat(gang.total_wage || 0),
            total_hk: parseFloat(gang.total_hk || 0),
            total_production: parseFloat(gang.total_production || 0),
            cost_per_hk: parseFloat(gang.cost_per_hk || 0),
            cost_per_ton: parseFloat(gang.cost_per_ton || 0),
        }));

        // Division Filter
        if (divisionFilter === 'IJL') result = result.filter(g => g.is_ijl);
        if (divisionFilter === 'NON_IJL') result = result.filter(g => !g.is_ijl);

        // Gang Type Filter
        if (gangTypeFilter !== 'ALL') {
            result = result.filter(g => g.gang_type === gangTypeFilter);
        }
        return result;
    }, [data, divisionFilter, gangTypeFilter]);

    // Derived Logic for Charts & Summary
    const analysisMetric = useMemo(() => {
        if (analysisMode === 'TON') return { key: 'cost_per_ton', label: 'Cost / Ton', formatter: formatCurrency };
        if (analysisMode === 'COST') return { key: 'total_wage', label: 'Total Cost', formatter: formatCurrency };
        return { key: 'cost_per_hk', label: 'Cost / HK', formatter: formatCurrency };
    }, [analysisMode]);

    // Sort data for chart (Top 20 worst/highest cost)
    const chartData = useMemo(() => {
        return [...filteredReportData]
            .sort((a, b) => b[analysisMetric.key] - a[analysisMetric.key])
            .slice(0, 20);
    }, [filteredReportData, analysisMetric]);

    // Group Data
    const groupedReportData = useMemo(() => {
        const groups = {
            harvesting: [],
            transport: [],
            maintenance: [],
            uncategorized: []
        };
        filteredReportData.forEach(gang => {
            if (groups[gang.gang_type]) {
                groups[gang.gang_type].push(gang);
            } else {
                groups.uncategorized.push(gang);
            }
        });
        return groups;
    }, [filteredReportData]);

    if (loading) return <div className="p-8 text-center">Loading Report...</div>;
    if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

    return (
        <div className="gang-report-page-container" style={{ padding: '2rem', background: 'white', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
            {/* Header Controls (No Print) */}
            <div className="no-print" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}
                    >
                        ← Back to Dashboard
                    </button>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <button
                                onClick={() => printReport({ orientation: 'landscape' })}
                            style={{ padding: '8px 16px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            <span>🖨️</span> Print Report
                        </button>
                    </div>
                </div>

                {/* Filters & Toggles */}
                <div className="gang-report-controls" style={{
                    padding: '1.5rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '2rem',
                    alignItems: 'center'
                }}>
                    {/* Division Filter */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Filter Divisi</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {['ALL', 'IJL', 'NON_IJL'].map(mode => (
                                <button
                                    key={mode}
                                    onClick={() => {
                                        setDivisionFilter(mode);
                                        // Reset gang type if Non-IJL is selected (as per requirement to hide/disable)
                                        if (mode === 'NON_IJL') setGangTypeFilter('ALL');
                                    }}
                                    style={{
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        border: '1px solid',
                                        borderColor: divisionFilter === mode ? '#2563eb' : '#cbd5e1',
                                        background: divisionFilter === mode ? '#eff6ff' : 'white',
                                        color: divisionFilter === mode ? '#2563eb' : '#64748b',
                                        fontWeight: divisionFilter === mode ? 600 : 400,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {mode === 'ALL' ? 'Semua' : mode === 'IJL' ? 'IJL Only' : 'Non-IJL'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Gang Type Filter (Disabled if Non-IJL) */}
                    {divisionFilter !== 'NON_IJL' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Tipe Gang</label>
                            <select
                                value={gangTypeFilter}
                                onChange={(e) => setGangTypeFilter(e.target.value)}
                                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                            >
                                <option value="ALL">Semua Tipe</option>
                                <option value="harvesting">Panen</option>
                                <option value="transport">Transport</option>
                                <option value="maintenance">Maintenance</option>
                            </select>
                        </div>
                    )}

                    {/* Analysis Mode Toggle */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginLeft: 'auto' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Mode Analisis</label>
                        <div style={{ display: 'flex', backgroundColor: '#e2e8f0', padding: '4px', borderRadius: '8px' }}>
                            {[
                                { id: 'HK', label: 'Cost / HK' },
                                { id: 'TON', label: 'Cost / Ton' },
                                { id: 'COST', label: 'Total Cost' }
                            ].map(option => (
                                <button
                                    key={option.id}
                                    onClick={() => setAnalysisMode(option.id)}
                                    style={{
                                        padding: '6px 16px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: analysisMode === option.id ? 'white' : 'transparent',
                                        color: analysisMode === option.id ? '#0f172a' : '#64748b',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        boxShadow: analysisMode === option.id ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Report Content */}
            <div className="gang-report-content">
                <ReportWatermark />
                {/* Letterhead */}
                <div className="gang-report-letterhead">
                    <img src="/assets/images/rebinmas.webp" alt="Logo" className="gang-report-logo" />
                    <h1 className="gang-report-company-name">PT. REBINMAS JAYA</h1>
                    <h2 className="gang-report-title">LAPORAN PERBANDINGAN {analysisMetric.label.toUpperCase()} PER GANG</h2>
                    <p className="gang-report-period">
                        Periode: {month && year ? `${getMonthName(parseInt(month))} ${year}` : '-'}
                    </p>
                    <p className="gang-report-filter-info">
                        Filter Divisi: {divisionFilter === 'ALL' ? 'Semua Divisi' : divisionFilter === 'IJL' ? 'IJL Only' : 'Non-IJL'}
                        {gangTypeFilter !== 'ALL' && ` | Tipe: ${getGangTypeLabel(gangTypeFilter)}`}
                    </p>
                </div>

                {/* KPI Summary (Analysis Mode Aware) */}
                <div className="gang-report-summary">
                    {/* Always Show Total Cost & Total HK */}
                    <div className="gang-report-summary-card">
                        <div className="gang-report-summary-label">Total Cost</div>
                        <div className="gang-report-summary-value">
                            {formatCurrency(filteredReportData.reduce((sum, g) => sum + g.total_wage, 0))}
                        </div>
                    </div>
                    <div className="gang-report-summary-card">
                        <div className="gang-report-summary-label">Total HK</div>
                        <div className="gang-report-summary-value">
                            {formatNumber(filteredReportData.reduce((sum, g) => sum + g.total_hk, 0))}
                        </div>
                    </div>
                    <div className="gang-report-summary-card">
                        <div className="gang-report-summary-label">Total Produksi (Ton)</div>
                        <div className="gang-report-summary-value">
                            {formatTon(filteredReportData.reduce((sum, g) => sum + g.total_production, 0))}
                        </div>
                    </div>

                    {/* Dynamic Metric Card */}
                    <div className="gang-report-summary-card highlight" style={{ borderColor: '#3b82f6', backgroundColor: '#f0f9ff' }}>
                        <div className="gang-report-summary-label">Rata-rata {analysisMetric.label}</div>
                        <div className="gang-report-summary-value" style={{ color: '#1d4ed8' }}>
                            {(() => {
                                const totalWage = filteredReportData.reduce((sum, g) => sum + g.total_wage, 0);
                                const totalHK = filteredReportData.reduce((sum, g) => sum + g.total_hk, 0);
                                const totalProd = filteredReportData.reduce((sum, g) => sum + g.total_production, 0); // kg

                                if (analysisMode === 'HK') return formatCurrency(totalHK ? totalWage / totalHK : 0);
                                if (analysisMode === 'TON') return formatCurrency(totalProd ? totalWage / (totalProd / 1000) : 0); // Cost per Ton
                                return formatCurrency(totalWage); // Default total cost
                            })()}
                        </div>
                    </div>
                </div>

                {/* Chart Section */}
                <div className="no-print" style={{ marginBottom: '2rem', height: '400px', backgroundColor: '#fff', borderRadius: '8px', padding: '1rem', border: '1px solid #e2e8f0' }}>
                    <h3 className="gang-report-section-title" style={{ marginBottom: '1rem' }}>Top 20 Gang - {analysisMetric.label}</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={chartData}
                            margin={{ top: 20, right: 30, left: 20, bottom: 60 }} // Extra bottom margin for slanted labels
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                                dataKey="gang_code"
                                angle={-45}
                                textAnchor="end"
                                height={60}
                                interval={0}
                                tick={{ fontSize: 12 }}
                            />
                            <YAxis
                                tickFormatter={(val) => {
                                    if (val >= 1000000) return `${(val / 1000000).toFixed(0)}jt`;
                                    if (val >= 1000) return `${(val / 1000).toFixed(0)}rb`;
                                    return val;
                                }}
                            />
                            <Tooltip
                                formatter={(value) => [analysisMetric.formatter(value), analysisMetric.label]}
                                labelFormatter={(label) => `Gang: ${label}`}
                            />
                            <Bar dataKey={analysisMetric.key} radius={[4, 4, 0, 0]}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={getGangTypeColor(entry.gang_type)} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Detail Table */}
                <div className="gang-report-table-wrapper">
                    <h3 className="gang-report-section-title">Detail per Gang</h3>
                    <table className="gang-report-table">
                        <thead>
                            <tr>
                                <th>Kode Gang</th>
                                <th>Divisi</th>
                                <th>Deskripsi</th>
                                <th>Tipe Gang</th>
                                <th className="text-right">Total HK</th>
                                <th className="text-right">Produksi (Ton)</th>
                                <th className="text-right">Total Cost</th>
                                <th className="text-right" style={{ backgroundColor: analysisMode === 'HK' ? '#f1f5f9' : 'transparent' }}>Cost/HK</th>
                                <th className="text-right" style={{ backgroundColor: analysisMode === 'TON' ? '#f1f5f9' : 'transparent' }}>Cost/Ton</th>
                                <th className="text-right">Headcount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(groupedReportData).map(([type, gangs]) =>
                                gangs.length > 0 && (
                                    <React.Fragment key={type}>
                                        <tr className="gang-report-group-header" style={{ backgroundColor: getGangTypeColor(type) + '20' }}>
                                            <td colSpan="10" className="gang-report-group-title">
                                                <span className="gang-report-type-badge" style={{ backgroundColor: getGangTypeColor(type) }}>
                                                    {getGangTypeLabel(type)}
                                                </span>
                                                <span className="gang-report-group-count">({gangs.length} gangs)</span>
                                            </td>
                                        </tr>
                                        {gangs.map((gang, idx) => (
                                            <tr key={gang.gang_code} className={idx % 2 === 0 ? 'gang-report-row-even' : 'gang-report-row-odd'}>
                                                <td className="gang-report-sticky-col">{gang.gang_code}</td>
                                                <td>
                                                    {gang.is_ijl ? (
                                                        <span className="gang-report-badge-ijl">IJL</span>
                                                    ) : (
                                                        <span className="gang-report-badge-non-ijl">Non-IJL</span>
                                                    )}
                                                </td>
                                                <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{gang.gang_description}</td>
                                                <td>
                                                    <span className="gang-report-type-badge" style={{ backgroundColor: getGangTypeColor(gang.gang_type) }}>
                                                        {getGangTypeLabel(gang.gang_type)}
                                                    </span>
                                                </td>
                                                <td className="text-right">{formatNumber(gang.total_hk)}</td>
                                                <td className="text-right">{formatTon(gang.total_production)}</td>
                                                <td className="text-right">{formatCurrency(gang.total_wage)}</td>
                                                <td className="text-right" style={{ fontWeight: analysisMode === 'HK' ? 'bold' : 'normal', backgroundColor: analysisMode === 'HK' ? '#f8fafc' : 'transparent', color: getGangTypeColor(gang.gang_type) }}>
                                                    {formatCurrency(gang.cost_per_hk)}
                                                </td>
                                                <td className="text-right" style={{ fontWeight: analysisMode === 'TON' ? 'bold' : 'normal', backgroundColor: analysisMode === 'TON' ? '#f8fafc' : 'transparent', color: getGangTypeColor(gang.gang_type) }}>
                                                    {formatCurrency(gang.cost_per_ton)}
                                                </td>
                                                <td className="text-right">{formatNumber(gang.headcount)}</td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                )
                            )}
                        </tbody>
                        <tfoot>
                            <tr className="gang-report-grand-total">
                                <td className="gang-report-sticky-col" colSpan="4">GRAND TOTAL</td>
                                <td className="text-right">{formatNumber(filteredReportData.reduce((sum, g) => sum + g.total_hk, 0))}</td>
                                <td className="text-right">{formatTon(filteredReportData.reduce((sum, g) => sum + g.total_production, 0))}</td>
                                <td className="text-right">{formatCurrency(filteredReportData.reduce((sum, g) => sum + g.total_wage, 0))}</td>
                                <td className="text-right">
                                    {(() => {
                                        const totWage = filteredReportData.reduce((sum, g) => sum + g.total_wage, 0);
                                        const totHK = filteredReportData.reduce((sum, g) => sum + g.total_hk, 0);
                                        return formatCurrency(totHK ? totWage / totHK : 0);
                                    })()}
                                </td>
                                <td className="text-right">
                                    {(() => {
                                        const totWage = filteredReportData.reduce((sum, g) => sum + g.total_wage, 0);
                                        const totProd = filteredReportData.reduce((sum, g) => sum + g.total_production, 0);
                                        // Cost per Ton = Total Wage / (Total Prod KG / 1000)
                                        return formatCurrency(totProd ? totWage / (totProd / 1000) : 0);
                                    })()}
                                </td>
                                <td className="text-right">{formatNumber(filteredReportData.reduce((sum, g) => sum + g.headcount, 0))}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* Footer */}
                <div className="gang-report-footer">
                    <p>Dicetak pada: {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
            </div>
        </div>
    );
}
