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
import { Printer, ArrowLeft } from 'lucide-react';
import ReportWatermark from '../components/common/ReportWatermark';
import { printReport } from '../utils/printPageSetup';
import { C, SHADOW, CARD } from '../components/report/reportTheme';
import PresentSlide from '../components/present/PresentSlide';
import PresentController from '../components/present/PresentController';
import usePresentMode from '../components/present/usePresentMode';
import { dashJson } from '../utils/dashboardApi';
import { GANG_TYPE, getGangType, isIJLGang, getGangTypeLabel } from '../utils/gangTypes';
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

// Warna per tipe gang - semantik Estate Ledger (aksen tunggal + warna semantik)
const getGangTypeColor = (type) => ({
    [GANG_TYPE.HARVESTING]: C.upah,
    [GANG_TYPE.TRANSPORT]: C.premi,
    [GANG_TYPE.MAINTENANCE]: C.lembur,
    [GANG_TYPE.UNCATEGORIZED]: C.muted,
}[type] || C.muted);

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

    // Present mode: deck fullscreen per slide (toggle html.present-mode + HUD)
    const { presenting, activeIndex, enter, exit } = usePresentMode();

    // Params from URL (for data fetching)
    // Fallback: bulan sebelumnya (periode payroll terbaru) supaya halaman tidak
    // stuck di "Loading Report..." bila dibuka tanpa query month/year.
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    const month = searchParams.get('month') || String(now.getMonth() + 1);
    const year = searchParams.get('year') || String(now.getFullYear());

    // Fetch Data
    useEffect(() => {
        const fetchData = async () => {
            if (!month || !year) return;
            setLoading(true);
            try {
                // Fetch data dari endpoint gang-comparison via helper terpadu
                const query = new URLSearchParams();
                query.append('month', month);
                query.append('year', year);

                const json = await dashJson(`/gang-comparison?${query.toString()}`, { token: localStorage.getItem('token') });

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
            cost_per_ton: gang.cost_per_ton == null ? null : parseFloat(gang.cost_per_ton),
            cost_per_ton_note: gang.cost_per_ton_note || 'Cost/ton valid per divisi',
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

    // Sort data for chart (Top 20 worst/highest cost) - exclude null metric (cost_per_ton now null for panen gangs)
    const chartData = useMemo(() => {
        const key = analysisMetric.key;
        return [...filteredReportData]
            .filter(g => g[key] != null)
            .sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity))
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

    // Label caption HUD present mode: "<Nama Report> · <periode> · <scope>"
    const reportPeriodLabel = month && year ? `${getMonthName(parseInt(month))} ${year}` : '-';
    const divisionScopeLabel = divisionFilter === 'ALL' ? 'Semua Divisi' : divisionFilter === 'IJL' ? 'IJL Only' : 'Non-IJL';

    if (loading) return <div className="p-8 text-center">Loading Report...</div>;
    if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

    return (
        <div className="gang-report-page-container" style={{ padding: '2rem', background: C.cream, minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
            {/* Header Controls (No Print) */}
            <div className="no-print" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '8px 16px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer', color: C.text2, fontWeight: 600, boxShadow: SHADOW }}
                    >
                        <ArrowLeft size={15} strokeWidth={2.2} aria-hidden="true" /> Kembali ke Dashboard
                    </button>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        {/* PRESENT MODE - tombol Present (mode normal) + HUD deck (present mode) */}
                        <PresentController
                            presenting={presenting}
                            activeIndex={activeIndex}
                            slideCount={3}
                            onEnter={enter}
                            onExit={exit}
                            caption={`Perbandingan Gang · ${reportPeriodLabel} · ${divisionScopeLabel}`}
                        />
                        <button
                                onClick={() => printReport({ orientation: 'landscape' })}
                            style={{ padding: '8px 16px', background: C.leafDark, color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: SHADOW }}
                        >
                            <Printer size={15} strokeWidth={2.2} aria-hidden="true" /> Print Report
                        </button>
                    </div>
                </div>

                {/* Filters & Toggles */}
                <div className="gang-report-controls" style={{
                    padding: '1.5rem',
                    background: C.surface,
                    borderRadius: '10px',
                    border: `1px solid ${C.border}`,
                    boxShadow: SHADOW,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '2rem',
                    alignItems: 'center'
                }}>
                    {/* Division Filter */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: C.muted }}>Filter Divisi</label>
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
                                        borderRadius: '8px',
                                        border: '1px solid',
                                        borderColor: divisionFilter === mode ? C.upah : C.border,
                                        background: divisionFilter === mode ? '#E9F2EA' : C.surface,
                                        color: divisionFilter === mode ? C.upah : C.muted,
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
                            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: C.muted }}>Tipe Gang</label>
                            <select
                                value={gangTypeFilter}
                                onChange={(e) => setGangTypeFilter(e.target.value)}
                                style={{ padding: '6px 12px', borderRadius: '8px', border: `1px solid ${C.border}`, color: C.text2, background: C.surface }}
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
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: C.muted }}>Mode Analisis</label>
                        <div style={{ display: 'flex', backgroundColor: C.surface2, border: `1px solid ${C.border}`, padding: '4px', borderRadius: '8px' }}>
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
                                        background: analysisMode === option.id ? C.surface : 'transparent',
                                        color: analysisMode === option.id ? C.text : C.muted,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        boxShadow: analysisMode === option.id ? SHADOW : 'none',
                                        transition: 'all 0.15s'
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
                <PresentSlide num="01" id="slide-01" title="Ringkasan Kinerja Gang" subtitle="Total biaya, hari kerja, dan produksi seluruh gang pada periode terpilih">
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
                    <div className="gang-report-summary-card highlight" style={{ borderColor: C.upah, backgroundColor: '#E9F2EA' }}>
                        <div className="gang-report-summary-label">Rata-rata {analysisMetric.label}</div>
                        <div className="gang-report-summary-value" style={{ color: C.upah }}>
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
                </PresentSlide>

                {/* Chart Section */}
                <PresentSlide num="02" id="slide-02" title="Peringkat Gang Tertinggi" subtitle={`20 gang dengan ${analysisMetric.label} tertinggi, diwarnai per tipe gang`}>
                <div className="no-print" style={{ marginBottom: '2rem', height: '400px', backgroundColor: C.surface, borderRadius: '10px', padding: '1rem', border: `1px solid ${C.border}`, boxShadow: SHADOW }}>
                    <h3 className="gang-report-section-title" style={{ marginBottom: '1rem' }}>Top 20 Gang - {analysisMetric.label}</h3>
                    {analysisMode === 'TON' && chartData.length === 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80%', color: C.muted, fontSize: 14, textAlign: 'center', padding: '0 24px' }}>
                            Cost/Ton valid per divisi, bukan per gang, karena tonase TBS adalah properti divisi.<br />Gunakan mode Cost/HK untuk membandingkan gang, atau buka Analisis Tonase untuk cost/ton per divisi.
                        </div>
                    ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={chartData}
                            margin={{ top: 20, right: 30, left: 20, bottom: 60 }} // Extra bottom margin for slanted labels
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.gridLine} />
                            <XAxis
                                dataKey="gang_code"
                                angle={-45}
                                textAnchor="end"
                                height={60}
                                interval={0}
                                tick={{ fontSize: 12, fill: C.text2 }}
                            />
                            <YAxis
                                tick={{ fontSize: 11, fill: C.muted }}
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
                    )}
                </div>
                </PresentSlide>

                {/* Detail Table */}
                <PresentSlide num="03" id="slide-03" title="Detail per Gang" subtitle="Rincian HK, produksi, dan biaya per gang, dikelompokkan per tipe">
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
                                <th className="text-right" style={{ backgroundColor: analysisMode === 'HK' ? C.surface2 : 'transparent' }}>Cost/HK</th>
                                <th className="text-right" style={{ backgroundColor: analysisMode === 'TON' ? C.surface2 : 'transparent' }}>Cost/Ton</th>
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
                                                <td style={{ fontSize: '0.8rem', color: C.muted }}>{gang.gang_description}</td>
                                                <td>
                                                    <span className="gang-report-type-badge" style={{ backgroundColor: getGangTypeColor(gang.gang_type) }}>
                                                        {getGangTypeLabel(gang.gang_type)}
                                                    </span>
                                                </td>
                                                <td className="text-right">{formatNumber(gang.total_hk)}</td>
                                                <td className="text-right">{formatTon(gang.total_production)}</td>
                                                <td className="text-right">{formatCurrency(gang.total_wage)}</td>
                                                <td className="text-right" style={{ fontWeight: analysisMode === 'HK' ? 'bold' : 'normal', backgroundColor: analysisMode === 'HK' ? C.surface2 : 'transparent', color: getGangTypeColor(gang.gang_type) }}>
                                                    {formatCurrency(gang.cost_per_hk)}
                                                </td>
                                                <td className="text-right" style={{ fontWeight: analysisMode === 'TON' ? 'bold' : 'normal', backgroundColor: analysisMode === 'TON' ? C.surface2 : 'transparent', color: getGangTypeColor(gang.gang_type) }} title={gang.cost_per_ton_note}>
                                                    {gang.cost_per_ton == null ? <span style={{ color: C.muted, fontSize: '0.8rem' }}>per divisi</span> : formatCurrency(gang.cost_per_ton)}
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
                </PresentSlide>
            </div>
        </div>
    );
}
