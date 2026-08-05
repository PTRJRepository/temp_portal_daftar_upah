import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAnalysisReport, fetchAvailablePeriods } from '../services/summaryReportService';
import { generatePDF } from '../utils/pdfGenerator';
import { Printer, RefreshCw, FileText, Settings, X, Search, DollarSign, Clock, TrendingUp } from 'lucide-react';
import AggregationSeederModal from '../components/AggregationSeederModal';
import PrintSignature from '../components/common/PrintSignature';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import { initPrintMode } from '../utils/printOptimizer';
import { getSourceModeLabel } from '../utils/reportPresentationLabels';
import { printReport } from '../utils/printPageSetup';
import { buildAnalysisReportInsights } from '../utils/analysisReportInsights';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';

// Company information for consistent header branding
const COMPANY_INFO = {
    ijl: {
        name: 'PT. IMPIAN JAYA LESTARI',
        logo: '/images/ijl-logo.png',
        logoFallback: '/images/rebinmas.webp'
    },
    all: {
        name: 'PT. REBINMAS JAYA',
        logo: '/images/rebinmas.webp',
        logoFallback: '/images/rebinmas.webp'
    }
};

const getCompanyInfo = (type) => COMPANY_INFO[type] || COMPANY_INFO.all;

const formatPremiumHeaderLabel = (header) => {
    if (header === 'LAINNYA') return 'LAINNYA';
    return String(header || '').replace('PREMI_', '').replace(/_/g, ' ');
};

const getAnalysisRowLabel = (row) => row?.gang_label || row?.gang_code || row?.description || row?.division_code || '-';

export default function AnalysisReportPage({ onBack, initialMonth, initialYear }) {
    const { token, user } = useAuth();
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());
    const [filterType, setFilterType] = useState('all');
    
    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
    }, [initialMonth, initialYear]);

    const [loading, setLoading] = useState(false);
    const [reportData, setReportData] = useState(null);
    const [error, setError] = useState(null);
    const [showSeederModal, setShowSeederModal] = useState(false);
    const [periods, setPeriods] = useState([]);

    // Range Filters
    const [otRange, setOtRange] = useState({ min: '', max: '' });
    const [premiRange, setPremiRange] = useState({ min: '', max: '' });
    const [showFilters, setShowFilters] = useState(false);

    // Load available periods
    useEffect(() => {
        async function loadPeriods() {
            if (!token) return;
            try {
                const result = await fetchAvailablePeriods(token);
                setPeriods(result.periods || []);
            } catch (e) {
                console.error('Failed to load periods:', e);
            }
        }
        loadPeriods();
        initPrintMode();
    }, [token]);

    // Fetch data
    const fetchData = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const data = await fetchAnalysisReport(token, { month, year, type: filterType });
            if (data.success) {
                setReportData(data);
            } else {
                setError(data.error || 'Failed to load report');
            }
        } catch (e) {
            console.error('[AnalysisReportPage] Error:', e);
            setError(e.message || 'Failed to load report');
        } finally {
            setLoading(false);
        }
    }, [token, month, year, filterType]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Formatters
    const formatCurrency = (val) => {
        if (val === null || val === undefined) return '0';
        return new Intl.NumberFormat('id-ID').format(Math.round(val));
    };

    const formatPercent = (val) => {
        if (val === null || val === undefined) return 'Periode baru';
        const sign = val > 0 ? '+' : '';
        return `${sign}${val.toFixed(1)}%`;
    };

    const getDiffClass = (val) => {
        if (val > 0) return 'text-diff-neg'; // Red for increase in cost
        if (val < 0) return 'text-diff-pos'; // Green for decrease in cost
        return 'text-neutral';
    };

    const getMonthName = (m) => {
        const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return months[m] || '';
    };

    const shortMonthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    // Filter Logic
    const filterData = (data, field, range) => {
        if (!data) return [];
        return data.filter(row => {
            const val = row[field];
            const min = range.min !== '' ? parseFloat(range.min) : -Infinity;
            const max = range.max !== '' ? parseFloat(range.max) : Infinity;
            return val >= min && val <= max;
        });
    };

    // Filtered Data Sets
    const filteredMainTable = useMemo(() => {
        let data = reportData?.premi_ot_table || [];
        if (otRange.min || otRange.max) data = filterData(data, 'curr_ot', otRange);
        if (premiRange.min || premiRange.max) data = filterData(data, 'curr_premi', premiRange);
        return data;
    }, [reportData, otRange, premiRange]);

    const analysisInsights = useMemo(() => buildAnalysisReportInsights({
        rows: filteredMainTable,
        totals: reportData?.totals || {},
        headers: reportData?.all_premi_headers || [],
        breakdownTotals: reportData?.breakdown_totals || {},
        topPremiumLimit: 8
    }), [filteredMainTable, reportData]);

    const handleSavePDF = () => {
        const element = document.getElementById('wsp-report-content');
        const filename = `Analysis_Report_${getMonthName(month)}_${year}.pdf`;
        generatePDF(element, filename);
    };

    const handlePrint = () => printReport({ orientation: 'landscape' });

    // Year Options
    const yearOptions = useMemo(() => {
        const years = periods.map(p => p.year);
        return [...new Set(years)].sort((a, b) => b - a);
    }, [periods]);

    const prevMonthName = reportData ? shortMonthNames[reportData.previous_period?.month] : '';
    const currMonthName = reportData ? shortMonthNames[reportData.current_period?.month] : '';
    const prevYearShort = reportData ? reportData.previous_period?.year.toString().substring(2) : '';
    const currYearShort = reportData ? reportData.current_period?.year.toString().substring(2) : '';

    const companyInfo = getCompanyInfo(filterType);
    const periodLabel = reportData ? `${getMonthName(reportData.previous_period?.month)} ${reportData.previous_period?.year} vs ${getMonthName(reportData.current_period?.month)} ${reportData.current_period?.year}` : '';

    return (
        <div className="wsp-container" style={{ padding: '1.5rem', backgroundColor: '#f8fafc' }}>
            {/* Header / Action Bar */}
            <div className="report-header-web no-print">
                <div className="report-header-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button 
                            onClick={onBack} 
                            className="wsp-btn" 
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}
                        >
                            &larr; Kembali
                        </button>
                        <h1>Analysis & Progress Report</h1>
                    </div>
                    <p style={{ marginLeft: '4.5rem' }}>Laporan perbandingan biaya premi dan lembur antar periode.</p>
                    
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', marginLeft: '4.5rem' }}>
                        <select 
                            value={month} 
                            onChange={(e) => setMonth(parseInt(e.target.value))}
                            className="report-filter-badge"
                        >
                            {Array.from({length: 12}, (_, i) => i + 1).map(m => (
                                <option key={m} value={m}>{getMonthName(m)}</option>
                            ))}
                        </select>
                        <select 
                            value={year} 
                            onChange={(e) => setYear(parseInt(e.target.value))}
                            className="report-filter-badge"
                        >
                            {yearOptions.length > 0 ? yearOptions.map(y => (
                                <option key={y} value={y}>{y}</option>
                            )) : <option value={year}>{year}</option>}
                        </select>
                        <select 
                            value={filterType} 
                            onChange={(e) => setFilterType(e.target.value)}
                            className="report-filter-badge"
                        >
                            <option value="all">ALL DIVISIONS</option>
                            <option value="non_ijl">REBINMAS</option>
                            <option value="ijl">IJL ONLY</option>
                        </select>
                    </div>
                </div>

                <div className="report-header-actions">
                    <button onClick={() => setShowFilters(!showFilters)} className={`wsp-btn ${showFilters ? 'wsp-btn-primary' : ''}`}>
                        {showFilters ? <X size={18} /> : <Settings size={18} />} 
                        {showFilters ? 'Tutup Filter' : 'Filter Range'}
                    </button>
                    <button onClick={() => setShowSeederModal(true)} className="wsp-btn" style={{ backgroundColor: '#fffbeb', color: '#92400e' }}>
                        Seed Data
                    </button>
                    <button onClick={handlePrint} className="wsp-btn-primary">
                        <Printer size={18} /> Cetak
                    </button>
                    <button onClick={handleSavePDF} className="wsp-btn-secondary">
                        <FileText size={18} /> PDF
                    </button>
                    <button onClick={fetchData} className="wsp-btn-secondary" disabled={loading}>
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Range Filters Panel */}
            {showFilters && (
                <div className="no-print" style={{ 
                    padding: '1.5rem', 
                    background: '#fff', 
                    border: '1px solid #e2e8f0', 
                    borderRadius: '8px',
                    marginBottom: '1.5rem',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '2rem'
                }}>
                    <RangeInput label="Range Lembur (OT)" range={otRange} setRange={setOtRange} />
                    <RangeInput label="Range Total Premi" range={premiRange} setRange={setPremiRange} />
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="wsp-error" style={{ margin: '2rem auto' }}>
                    <div className="wsp-error-icon">!</div>
                    <div className="wsp-error-title">Gagal Memuat Analisis</div>
                    <div className="wsp-error-message">{error}</div>
                    <button onClick={fetchData} className="wsp-btn-primary" style={{ marginTop: '1rem' }}>Coba Lagi</button>
                </div>
            )}

            {/* Main Document */}
            {!loading && !error && reportData && (
                <div className="wsp-document" id="wsp-report-content">
                    <ReportWatermark />
                    {/* Standardized Professional Header (3-Column Layout) */}
                    <div className="wsp-report-header">
                        {/* Left Section: Logo */}
                        <div className="wsp-logo-section">
                            <img
                                src={companyInfo.logo}
                                alt={companyInfo.name}
                                className="wsp-logo"
                                onError={(e) => {
                                    if (companyInfo.logoFallback) e.target.src = companyInfo.logoFallback;
                                }}
                            />
                        </div>

                        {/* Center Section: Company & Report Title */}
                        <div className="wsp-title-section">
                            <h1 className="wsp-company-name">{companyInfo.name}</h1>
                            <h2 className="wsp-report-title">Monthly Progress & Cost Analysis Report</h2>
                        </div>

                        {/* Right Section: Metadata */}
                        <div className="wsp-meta-section">
                            <div className="wsp-meta-row">
                                <span className="wsp-meta-label">Analysis:</span>
                                <span className="wsp-meta-value">PREMI & LEMBUR</span>
                            </div>
                            <div className="wsp-meta-row">
                                <span className="wsp-meta-label">Period:</span>
                                <span className="wsp-meta-value" style={{ fontSize: '0.7rem' }}>{periodLabel}</span>
                            </div>
                            <div className="wsp-meta-row">
                                <span className="wsp-meta-label">Filter:</span>
                                <span className="wsp-meta-value">{filterType === 'all' ? 'ALL DIVISIONS' : filterType === 'ijl' ? 'IJL ONLY' : 'REBINMAS'}</span>
                            </div>
                        </div>
                    </div>
                    <ReportPrintMetadata
                        mode="Analysis"
                        source={getSourceModeLabel({ sourceMode: 'Analysis API' })}
                        scope={filterType === 'all' ? 'All Divisions' : filterType === 'ijl' ? 'IJL' : 'Rebinmas'}
                        note="KPI berasal dari summary periode; filter range hanya menyaring tabel detail yang sedang ditampilkan."
                    />

                    {/* KPI Comparison Cards */}
                    <div className="wsp-kpi-grid comparison-grid">
                        <KPIComparisonCard 
                            label="Total Premi" 
                            prevLabel={prevMonthName} 
                            currLabel={currMonthName}
                            prevValue={reportData.totals?.prev_premi}
                            currValue={reportData.totals?.curr_premi}
                            diff={reportData.totals?.diff_premi}
                            format={formatCurrency}
                            icon={<DollarSign size={16} />}
                        />
                        <KPIComparisonCard 
                            label="Total Lembur (OT)" 
                            prevLabel={prevMonthName} 
                            currLabel={currMonthName}
                            prevValue={reportData.totals?.prev_ot}
                            currValue={reportData.totals?.curr_ot}
                            diff={reportData.totals?.diff_ot}
                            format={formatCurrency}
                            icon={<Clock size={16} />}
                        />
                        <div className="wsp-kpi-card comparison-card highlight">
                            <div className="wsp-kpi-label flex items-center gap-2"><TrendingUp size={14}/> Progress Summary</div>
                            <div style={{ padding: '0.5rem 0' }}>
                                <div className={`text-sm font-bold ${getDiffClass(reportData.totals?.diff_premi)}`}>
                                    Premi: {reportData.totals?.diff_premi > 0 ? '+' : ''}{formatCurrency(reportData.totals?.diff_premi)}
                                </div>
                                <div className={`text-sm font-bold ${getDiffClass(reportData.totals?.diff_ot)}`} style={{ marginTop: '4px' }}>
                                    Lembur: {reportData.totals?.diff_ot > 0 ? '+' : ''}{formatCurrency(reportData.totals?.diff_ot)}
                                </div>
                            </div>
                            <div className="wsp-kpi-diff neutral" style={{ justifyContent: 'center' }}>
                                <span>VARIANCE PERIODE</span>
                            </div>
                        </div>
                    </div>

                    <AnalysisPrintInsights
                        insights={analysisInsights}
                        totals={reportData.totals || {}}
                        formatCurrency={formatCurrency}
                        formatPercent={formatPercent}
                        getDiffClass={getDiffClass}
                    />

                    {/* Section 1: Summary Premi & OT Analysis (Aggregated by division) */}
                    <AggregatedPremiOTTable
                        groupedRows={analysisInsights.groupedRows}
                        totals={reportData.totals}
                        prevMonthLabel={`${prevMonthName}-${prevYearShort}`}
                        currMonthLabel={`${currMonthName}-${currYearShort}`}
                        formatCurrency={formatCurrency}
                        getDiffClass={getDiffClass}
                    />

                    {/* Section 2: Full Premi Breakdown (Seluruh Variasi Premi) */}
                    <FullPremiBreakdownTable 
                        data={analysisInsights.groupedRows}
                        headers={reportData.all_premi_headers}
                        breakdownTotals={reportData.breakdown_totals}
                        breakdownGrandTotal={reportData.breakdown_grand_total}
                        printPremiHeaders={analysisInsights.printPremiHeaders}
                        printPremiRows={analysisInsights.printPremiRows}
                        otherPremiTotal={analysisInsights.otherPremiTotal}
                        formatCurrency={formatCurrency}
                    />

                    {/* Signature Section */}
                    <div className="print-only">
                        <PrintSignature />
                    </div>

                    {/* Footer */}
                    <footer className="wsp-footer">
                        <div className="wsp-footer-left">
                            <div>Dicetak: {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                            <div style={{ fontSize: '0.65rem' }}>User: {user?.username}</div>
                        </div>
                        <div className="wsp-footer-right">
                            PT. REBINMAS JAYA - PROGRESS ANALYSIS REPORT
                        </div>
                    </footer>
                </div>
            )}

            {/* Aggregation Seeder Modal */}
            <AggregationSeederModal
                isOpen={showSeederModal}
                onClose={() => setShowSeederModal(false)}
                month={month}
                year={year}
                division={null}
            />
        </div>
    );
}

// Sub-components for cleaner code
const RangeInput = ({ label, range, setRange }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
                type="number" 
                placeholder="Min Rp"
                value={range.min}
                onChange={(e) => setRange({ ...range, min: e.target.value })}
                className="wsp-input"
                style={{ flex: 1 }}
            />
            <span style={{ color: '#94a3b8' }}>-</span>
            <input 
                type="number" 
                placeholder="Max Rp"
                value={range.max}
                onChange={(e) => setRange({ ...range, max: e.target.value })}
                className="wsp-input"
                style={{ flex: 1 }}
            />
        </div>
    </div>
);

const KPIComparisonCard = ({ label, prevLabel, currLabel, prevValue, currValue, diff, format, icon }) => {
    const isIncrease = diff > 0;
    return (
        <div className="wsp-kpi-card comparison-card">
            <div className="wsp-kpi-label flex items-center gap-2">{icon} {label}</div>
            <div className="wsp-kpi-compare-row">
                <div className="wsp-kpi-trend-box prev">
                    <div className="trend-label">{prevLabel}</div>
                    <div className="trend-value">{format(prevValue)}</div>
                </div>
                <div className="wsp-kpi-trend-box curr">
                    <div className="trend-label">{currLabel}</div>
                    <div className="trend-value">{format(currValue)}</div>
                </div>
            </div>
            <div className={`wsp-kpi-diff ${isIncrease ? 'pos' : diff < 0 ? 'neg' : 'neutral'}`}>
                <span>Variance:</span>
                <strong>Rp {format(diff)} {isIncrease ? '▲' : diff < 0 ? '▼' : ''}</strong>
            </div>
        </div>
    );
};

const AnalysisPrintInsights = ({ insights, totals, formatCurrency, formatPercent, getDiffClass }) => {
    const formatSignedCurrency = (value) => {
        const sign = value > 0 ? '+' : '';
        return `${sign}${formatCurrency(value)}`;
    };

    const largestDriver = insights.largestCostDriver;
    const largestReducer = insights.largestCostReducer;
    const largestPremium = insights.largestPremiumGang || insights.largestPremiumDivision;
    const largestOvertime = insights.largestOvertimeGang || insights.largestOvertimeDivision;

    return (
        <div className="analysis-print-insights">
            <div className="analysis-print-insight-card">
                <div className="analysis-print-insight-label">Driver terbesar</div>
                <div className={`analysis-print-insight-value ${getDiffClass(largestDriver?.total_diff)}`}>
                    {getAnalysisRowLabel(largestDriver)}
                </div>
                <div className="analysis-print-insight-note">
                    Net variance {formatSignedCurrency(largestDriver?.total_diff || 0)}
                </div>
            </div>
            <div className="analysis-print-insight-card">
                <div className="analysis-print-insight-label">Saving terbesar</div>
                <div className={`analysis-print-insight-value ${getDiffClass(largestReducer?.total_diff)}`}>
                    {getAnalysisRowLabel(largestReducer)}
                </div>
                <div className="analysis-print-insight-note">
                    Net variance {formatSignedCurrency(largestReducer?.total_diff || 0)}
                </div>
            </div>
            <div className="analysis-print-insight-card">
                <div className="analysis-print-insight-label">Premi terbesar</div>
                <div className="analysis-print-insight-value">
                    {getAnalysisRowLabel(largestPremium)}
                </div>
                <div className="analysis-print-insight-note">
                    Current premi {formatCurrency(largestPremium?.curr_premi || 0)}
                </div>
            </div>
            <div className="analysis-print-insight-card">
                <div className="analysis-print-insight-label">Lembur terbesar</div>
                <div className="analysis-print-insight-note strong">
                    {getAnalysisRowLabel(largestOvertime)}
                </div>
                <div className="analysis-print-insight-note">
                    Current OT {formatCurrency(largestOvertime?.curr_ot || 0)}
                </div>
            </div>
        </div>
    );
};

const AggregatedPremiOTTable = ({ groupedRows = [], totals = {}, prevMonthLabel, currMonthLabel, formatCurrency, getDiffClass }) => (
    <div className="analysis-section" style={{ marginTop: '2rem' }}>
        <div className="analysis-section-title" style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderLeft: '4px solid #334155', fontWeight: 700, display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span>Summary Premi & OT Progress - Agregat per Divisi</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>Agregat per Divisi; gang hanya ditampilkan sebagai driver utama</span>
        </div>
        <div className="wsp-table-wrapper">
            <table className="wsp-table analysis-grouped-table">
                <thead>
                    <tr className="wsp-header-master">
                        <th rowSpan="2" style={{ textAlign: 'left', width: '220px' }}>ESTATE / DIVISI</th>
                        <th rowSpan="2" style={{ width: '70px' }}>JUMLAH GANG</th>
                        <th rowSpan="2" style={{ textAlign: 'left', width: '180px' }}>Driver Gang</th>
                        <th colSpan="2">{prevMonthLabel}</th>
                        <th colSpan="2">{currMonthLabel}</th>
                        <th colSpan="3">PROGRESS (VARIANCE)</th>
                    </tr>
                    <tr className="wsp-header-sub">
                        <th>PREMI</th>
                        <th>OT</th>
                        <th>PREMI</th>
                        <th>OT</th>
                        <th>PREMI DIFF</th>
                        <th>OT DIFF</th>
                        <th>NET DIFF</th>
                    </tr>
                </thead>
                <tbody>
                    {groupedRows.length === 0 && (
                        <tr>
                            <td colSpan="10" className="text-left">Tidak ada data divisi untuk periode ini.</td>
                        </tr>
                    )}
                    {groupedRows.map((group) => (
                        <tr className="analysis-group-row" key={group.division_code || group.division_label}>
                            <td className="text-left">
                                <span className="analysis-group-title">{group.division_label}</span>
                            </td>
                            <td className="text-right">{group.gang_count}</td>
                            <td className="text-left">
                                <span className="analysis-gang-code">{group.top_driver?.gang_label || '-'}</span>
                                <span className="analysis-gang-desc">{group.top_driver?.gang_description_label || '-'}</span>
                            </td>
                            <td className="text-right">{formatCurrency(group.prev_premi)}</td>
                            <td className="text-right">{formatCurrency(group.prev_ot)}</td>
                            <td className="text-right">{formatCurrency(group.curr_premi)}</td>
                            <td className="text-right">{formatCurrency(group.curr_ot)}</td>
                            <td className={`text-right ${getDiffClass(group.diff_premi)}`}>{formatCurrency(group.diff_premi)}</td>
                            <td className={`text-right ${getDiffClass(group.diff_ot)}`}>{formatCurrency(group.diff_ot)}</td>
                            <td className={`text-right ${getDiffClass(group.total_diff)}`}>{formatCurrency(group.total_diff)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="wsp-grand-total">
                        <td colSpan="3" className="text-right" style={{ paddingRight: '15px' }}>TOTAL C/ROLL</td>
                        <td className="text-right">{formatCurrency(totals.prev_premi)}</td>
                        <td className="text-right">{formatCurrency(totals.prev_ot)}</td>
                        <td className="text-right">{formatCurrency(totals.curr_premi)}</td>
                        <td className="text-right">{formatCurrency(totals.curr_ot)}</td>
                        <td className="text-right">{formatCurrency(totals.diff_premi)}</td>
                        <td className="text-right">{formatCurrency(totals.diff_ot)}</td>
                        <td className="text-right">{formatCurrency((totals.diff_premi || 0) + (totals.diff_ot || 0))}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>
);

const FullPremiBreakdownTable = ({
    data,
    headers = [],
    breakdownTotals = {},
    breakdownGrandTotal,
    printPremiHeaders = [],
    printPremiRows = [],
    otherPremiTotal = 0,
    formatCurrency
}) => (
    <div className="analysis-section" style={{ marginTop: '3rem', pageBreakBefore: 'always' }}>
        <div className="analysis-section-title" style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderLeft: '4px solid #1e40af', fontWeight: 700, display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span>Uraian Premi Seluruh Variasi (Current Month)</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>Rincian Lengkap Seluruh Premi</span>
        </div>
        <div className="wsp-table-wrapper print-hide" style={{ overflowX: 'auto' }}>
            <table className="wsp-table">
                <thead>
                    <tr className="wsp-header-master">
                        <th style={{ textAlign: 'left', width: '130px', position: 'static', left: 0, zIndex: 5 }}>ESTATE / DIVISI</th>
                        <th style={{ textAlign: 'left', width: '170px' }}>DRIVER GANG</th>
                        {headers.map(h => (
                            <th key={h} className="th-premi-detail" style={{ minWidth: '60px', fontSize: '0.6rem' }}>
                                {h.replace('PREMI_', '').replace(/_/g, ' ')}
                            </th>
                        ))}
                        <th style={{ minWidth: '100px', background: '#334155', color: 'white' }}>TOTAL PREMI</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, idx) => (
                        <tr key={idx}>
                            <td className="text-left font-bold" style={{ position: 'sticky', left: 0, zIndex: 4, background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                {row.division_label || row.division_code}
                            </td>
                            <td className="text-left">
                                <span className="analysis-gang-code">{row.top_driver?.gang_label || '-'}</span>
                                <span className="analysis-gang-desc">{row.top_driver?.gang_description_label || '-'}</span>
                            </td>
                            {headers.map(h => (
                                <td key={h} className="text-right">
                                    {formatCurrency(row.premi_breakdown[h])}
                                </td>
                            ))}
                            <td className="text-right font-bold" style={{ background: '#f8fafc' }}>
                                {formatCurrency(row.curr_premi)}
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="wsp-grand-total">
                        <td className="text-left sticky-col" style={{ position: 'sticky', left: 0, zIndex: 5 }} colSpan="2">TOTAL</td>
                        {headers.map(h => (
                            <td key={h} className="text-right">
                                {formatCurrency(breakdownTotals[h])}
                            </td>
                        ))}
                        <td className="text-right" style={{ background: '#1e293b', color: '#fff' }}>
                            {formatCurrency(breakdownGrandTotal || 0)}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
        <div className="analysis-print-top-premi-wrapper print-only">
            <div className="analysis-print-appendix-title">
                Appendix Print: Top Premi Current Month + LAINNYA
            </div>
            <table className="wsp-table analysis-print-top-premi-table">
                <thead>
                    <tr className="wsp-header-master">
                        <th>ESTATE / DIVISI</th>
                        <th>DRIVER GANG</th>
                        {printPremiHeaders.map(h => (
                            <th key={h}>{formatPremiumHeaderLabel(h)}</th>
                        ))}
                        <th>TOTAL PREMI</th>
                    </tr>
                </thead>
                <tbody>
                    {printPremiRows.map((row, idx) => (
                        <tr key={idx}>
                            <td className="text-left font-bold">{row.division_label || row.division_code}</td>
                            <td className="text-left">
                                <span className="analysis-gang-code">{row.top_driver?.gang_label || '-'}</span>
                                <span className="analysis-gang-desc">{row.top_driver?.gang_description_label || '-'}</span>
                            </td>
                            {printPremiHeaders.map(h => (
                                <td key={h} className="text-right">
                                    {formatCurrency(row.print_breakdown?.[h] || 0)}
                                </td>
                            ))}
                            <td className="text-right font-bold">{formatCurrency(row.curr_premi)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="wsp-grand-total">
                        <td className="text-left" colSpan="2">TOTAL</td>
                        {printPremiHeaders.map(h => (
                            <td key={h} className="text-right">
                                {formatCurrency(h === 'LAINNYA' ? otherPremiTotal : breakdownTotals[h])}
                            </td>
                        ))}
                        <td className="text-right">{formatCurrency(breakdownGrandTotal || 0)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>
);
