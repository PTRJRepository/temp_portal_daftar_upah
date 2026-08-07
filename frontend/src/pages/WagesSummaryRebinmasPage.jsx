/**
 * WagesSummaryRebinmasPage - Professional Wages Summary Report
 * Premium financial statement layout for PT. REBINMAS JAYA
 * No AG-Grid - uses custom HTML/CSS for print-ready output
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus, Printer, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { MetricInfo, EmptyState } from '../components/report/reportTheme';
import { fetchAllDivisionsTotals, fetchAvailablePeriods, fetchComparisonSummary, fetchVirtualDivisions, updateSPSI, updateDivisionCell } from '../services/summaryReportService';
import { fetchWagesRecapAll } from '../services/wagesService';
import { otherIncomesService } from '../services/otherIncomesService';
import { generatePDF } from '../utils/pdfGenerator';
import ImpactReportPage from './ImpactReportPage';
import PrintModeSelector from '../components/common/PrintModeSelector';
import PrintSignature from '../components/common/PrintSignature';
import CompactPeriodScroll from '../components/common/CompactPeriodScroll';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import PresentSlide from '../components/present/PresentSlide';
import PresentController from '../components/present/PresentController';
import usePresentMode from '../components/present/usePresentMode';
import { initPrintMode } from '../utils/printOptimizer';
import { getDivisionTypeLabel, getReportModeLabel, getSourceModeLabel } from '../utils/reportPresentationLabels';
import { getReportDivisionSummary } from '../utils/divisionPresentation';
import { printReport } from '../utils/printPageSetup';
import { buildWagesAuditModel } from '../utils/wagesSummaryAudit';
import '../styles/wages-summary-professional.css';
import '../styles/wages-summary-print-simple.css';
import '../styles/report-print-foundation.css';

export default function WagesSummaryRebinmasPage({ onBack, initialMonth, initialYear }) {
    const { token, user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    // Filters - Use selected payroll period when provided
    const [month, setMonth] = useState(initialMonth || null);
    const [year, setYear] = useState(initialYear || null);
    const [divisionType, setDivisionType] = useState('all'); // 'all', 'real', or 'virtual'

    useEffect(() => {
        if (initialMonth) setMonth(initialMonth);
        if (initialYear) setYear(initialYear);
    }, [initialMonth, initialYear]);

    // Data
    const [periods, setPeriods] = useState([]);
    const [summaryData, setSummaryData] = useState([]);
    const [grandTotal, setGrandTotal] = useState(null);
    const [groupSubtotals, setGroupSubtotals] = useState({});
    const [kpiTotalsData, setKpiTotalsData] = useState(null);
    const [virtualDivisions, setVirtualDivisions] = useState([]);

    // Comparison State
    const [comparisonMode, setComparisonMode] = useState(searchParams.get('mode') === 'comparison');
    const [comparisonData, setComparisonData] = useState(null);
    const [comparisonGrandTotal, setComparisonGrandTotal] = useState(null);
    const [comparisonPremiBreakdown, setComparisonPremiBreakdown] = useState(null);

    // THR Mode State - Rekap Semua Divisi (tanpa thumbprint)
    const [thrMode, setThrMode] = useState(searchParams.get('mode') === 'thr');
    const [thrData, setThrData] = useState(null);
    const [thrIjlFilter, setThrIjlFilter] = useState('non-ijl'); // 'non-ijl' or 'ijl-only'

    // Sync modes if URL search params change
    useEffect(() => {
        const mode = searchParams.get('mode');
        setComparisonMode(mode === 'comparison');
        setThrMode(mode === 'thr');
    }, [searchParams]);

    // Impact Report State
    const [impactReportMode, setImpactReportMode] = useState(false);

    const handleComparisonModeToggle = useCallback(() => {
        const nextParams = new URLSearchParams(searchParams);
        if (comparisonMode) {
            nextParams.delete('mode');
        } else {
            nextParams.set('mode', 'comparison');
        }
        setSearchParams(nextParams);
    }, [comparisonMode, searchParams, setSearchParams]);

    // Edit Mode State
    const [editMode, setEditMode] = useState(false);
    const [editingValues, setEditingValues] = useState({});
    const [editingSPSI, setEditingSPSI] = useState({});
    const [editingUpahBersih, setEditingUpahBersih] = useState({});

    // State
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // History DB mode - when ON, queries go to extend_db_ptrj instead of db_ptrj
    const [useHistory, setUseHistory] = useState(false);

    // Load available periods & Initialize print mode
    useEffect(() => {
        async function loadPeriods() {
            if (!token) return;
            try {
                const result = await fetchAvailablePeriods(token);
                setPeriods(result.periods || []);

                if (!initialMonth && !initialYear && result.default_period && result.default_period.month && result.default_period.year) {
                    setMonth(result.default_period.month);
                    setYear(result.default_period.year);
                }
            } catch (e) {
                console.error('Failed to load periods:', e);
            }
        }
        loadPeriods();

        // Initialize print mode for optimized printing
        initPrintMode();
    }, [token, initialMonth, initialYear]);

    // Fetch summary data
    const fetchData = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        setError('');

        try {
            if (comparisonMode) {
                const result = await fetchComparisonSummary(token, { month, year, useHistory, scope: 'rebinmas', divisionType });
                if (result.success) {
                    console.log('[WagesComparison] Comparison data received:', result);
                    console.log('[WagesComparison] Sample division data:', result.divisions?.[0]);
                    setComparisonData(result);
                    setComparisonGrandTotal(result.grand_total || null);
                    setComparisonPremiBreakdown(result.premi_breakdown_current || null);
                } else {
                    setError('Failed to fetch comparison data');
                }
            } else if (thrMode) {
                // THR Mode - Rekap Semua Divisi (tanpa thumbprint)
                // thrIjlFilter: 'non-ijl' = exclude IJL, 'ijl-only' = only IJL
                const excludeIjl = thrIjlFilter === 'non-ijl';
                const ijlOnly = thrIjlFilter === 'ijl-only';
                const result = await otherIncomesService.getThrRecapAll(year, month, excludeIjl, ijlOnly);
                if (result.success !== false) {
                    setThrData(result);
                } else {
                    setError('Failed to fetch THR recap data');
                }
            } else {
                const result = await fetchAllDivisionsTotals(token, { 
                    month, 
                    year, 
                    useHistory,
                    includeVirtual: divisionType !== 'real', // 'all' or 'virtual' -> true
                    divisionType,
                    scope: 'rebinmas'
                });
                if (result.success) {
                    setSummaryData(result.data || []);
                    setGrandTotal(result.grand_total || null);
                    setGroupSubtotals(result.group_subtotals || {});
                    setKpiTotalsData(result.kpi_totals || null);
                } else {
                    setError('Failed to fetch summary data');
                }
            }
        } catch (e) {
            console.error('Error fetching summary:', e);
            setError(e.message || 'Failed to fetch summary data');
        } finally {
            setLoading(false);
        }
    }, [token, month, year, comparisonMode, thrMode, thrIjlFilter, useHistory, divisionType]);

    // Handle Thumbprint Change
    const handleThumbprintChange = (divisionKey, value) => {
        setEditingValues(prev => ({
            ...prev,
            [divisionKey]: value
        }));
    };

    // Handle Save Thumbprint
    const handleSaveThumbprint = async (divisionCode, value) => {
        if (!month || !year) {
            alert('Periode belum dimuat. Tunggu data selesai dimuat lalu coba lagi.');
            return;
        }
        try {
            await import('../services/summaryReportService').then(mod =>
                mod.updateThumbprint(token, {
                    month,
                    year,
                    division: divisionCode,
                    value: parseFloat(value) || 0
                })
            );
            // Refresh data to show updated totals/selisih
            await fetchData();
        } catch (err) {
            console.error('Failed to save thumbprint:', err);
            alert('Failed to save value');
        }
    };

    // Handle SPSI Change
    const handleSPSIChange = (divisionCode, value) => {
        setEditingSPSI(prev => ({
            ...prev,
            [divisionCode]: value
        }));
    };

    // Handle Save SPSI
    const handleSaveSPSI = async (divisionCode, value) => {
        try {
            await updateSPSI(token, {
                month,
                year,
                division: divisionCode,
                value: parseFloat(value) || 0
            });
            // Refresh data to show updated totals
            await fetchData();
        } catch (err) {
            console.error('Failed to save SPSI:', err);
            alert('Failed to save SPSI value');
        }
    };

    // Handle Upah Bersih Change
    const handleUpahBersihChange = (divisionCode, value) => {
        setEditingUpahBersih(prev => ({
            ...prev,
            [divisionCode]: value
        }));
    };

    // Handle Save Upah Bersih
    const handleSaveUpahBersih = async (divisionCode, value) => {
        try {
            await updateDivisionCell(token, {
                month,
                year,
                division_code: divisionCode,
                field: 'total_upah_bersih',
                value: parseFloat(value) || 0
            });
            // Refresh data to show updated totals
            await fetchData();
        } catch (err) {
            console.error('Failed to save upah bersih:', err);
            alert('Failed to save upah bersih value');
        }
    };


    // Fetch data when filters change
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Load virtual divisions
    useEffect(() => {
        async function loadVirtualDivisions() {
            if (!token) return;
            try {
                const result = await fetchVirtualDivisions(token);
                setVirtualDivisions(result.divisions || []);
            } catch (e) {
                console.error('Failed to load virtual divisions:', e);
            }
        }
        loadVirtualDivisions();
    }, [token]);

    // Format number with thousand separators
    const formatNumber = (value, decimals = 0) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return '-';
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(num);
    };

    // Get month name
    const getMonthName = (m) => {
        const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return months[m] || '';
    };

    // Period label
    const periodLabel = `${getMonthName(month)} ${year}`;

    // Print date
    const printDate = new Date().toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    // Present mode: deck fullscreen per slide (toggle html.present-mode + HUD)
    const { presenting, activeIndex, enter, exit } = usePresentMode();
    const presentScope = thrMode
        ? (thrIjlFilter === 'ijl-only' ? 'THR IJL Only' : 'THR Non-IJL')
        : getDivisionTypeLabel(divisionType);
    const presentCaption = `Wages Summary Rebinmas · ${periodLabel} · ${presentScope}`;

    // Month options
    const monthOptions = [
        { value: 1, label: 'Januari' },
        { value: 2, label: 'Februari' },
        { value: 3, label: 'Maret' },
        { value: 4, label: 'April' },
        { value: 5, label: 'Mei' },
        { value: 6, label: 'Juni' },
        { value: 7, label: 'Juli' },
        { value: 8, label: 'Agustus' },
        { value: 9, label: 'September' },
        { value: 10, label: 'Oktober' },
        { value: 11, label: 'November' },
        { value: 12, label: 'Desember' }
    ];

    // Year options (last 5 years)
    const currentYear = new Date().getFullYear();
    const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

    // Group data by estate prefix (subtotal comes from backend)
    const groupedData = useMemo(() => {
        // Label mapping for known estate prefixes
        const LABEL_MAP = {
            'P': 'ESTATE PARIT GUNUNG',
            'A': 'ESTATE AIR RUAK',
            'N': 'NURSERY',
            'W': 'WORKSHOP (PG & AR)',
            'K': 'DARRUR MAKMUR ESTATE',
            'I': 'DIVISI INFRASTRUKTUR',
            'M': 'OPERASI MILL',
        };

        const groups = {};

        // Filter regular vs subtotal
        const regularData = summaryData.filter(d =>
            !d.is_subtotal &&
            !d.is_grand_total &&
            !(d.description || '').toLowerCase().includes('total') // Double check to exclude any total rows
        );

        // Group ALL divisions dynamically by first character
        regularData.forEach(div => {
            const desc = div.description || div.division_code || '';
            let prefix = desc.charAt(0).toUpperCase();

            // Special handling for INFRASTRUKTUR if it uses 'INF' code
            if (div.division_code === 'INF' || desc.toUpperCase().includes('INFRA')) prefix = 'I';
            // Special handling for NURSERY if it uses 'NRS' code
            if (div.division_code === 'NRS' || desc.toUpperCase().includes('NURSERY')) prefix = 'N';
            // Special handling for WORKSHOP
            if (div.division_code?.startsWith('WKS') || desc.toUpperCase().includes('WORKSHOP')) prefix = 'W';

            if (!groups[prefix]) {
                groups[prefix] = {
                    key: prefix,
                    label: LABEL_MAP[prefix] || `ESTATE ${prefix}`,
                    divisions: [],
                    subtotal: null
                };
            }
            groups[prefix].divisions.push(div);
        });

        // Subtotals from backend response
        Object.keys(groups).forEach(key => {
            groups[key].subtotal = groupSubtotals?.[key]?.totals || null;
        });

        // Convert to array and sort (P, A, N, W, K first, then others alphabetically)
        const sortOrder = ['P', 'A', 'N', 'W', 'K', 'D', 'I', 'L', 'T', 'S', 'M'];
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            const idxA = sortOrder.indexOf(a);
            const idxB = sortOrder.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        // Return as ordered object
        const orderedGroups = {};
        sortedKeys.forEach(k => orderedGroups[k] = groups[k]);
        return orderedGroups;
    }, [summaryData, groupSubtotals]);

    const reportDivisionSummary = useMemo(() => getReportDivisionSummary({
        divisionType,
        rows: comparisonMode ? comparisonData?.divisions : thrMode ? thrData?.divisions : summaryData
    }), [comparisonData, comparisonMode, divisionType, summaryData, thrData, thrMode]);

    // KPI totals from backend
    const kpiTotals = useMemo(() => {
        return {
            divisions: Number(kpiTotalsData?.gangs ?? kpiTotalsData?.divisions ?? 0),
            workers: Number(kpiTotalsData?.workers ?? grandTotal?.total_employees ?? 0),
            hk: Number(kpiTotalsData?.hk ?? grandTotal?.total_hk ?? 0),
            netPay: Number(kpiTotalsData?.netPay ?? grandTotal?.total_manual ?? 0)
        };
    }, [kpiTotalsData, grandTotal]);

    const calculatedGrandTotal = grandTotal;
    const isStandardWagesMode = !thrMode && !comparisonMode;
    const auditReport = useMemo(() => (
        isStandardWagesMode ? buildWagesAuditModel(groupedData, calculatedGrandTotal) : null
    ), [calculatedGrandTotal, groupedData, isStandardWagesMode]);

    // Render Comparison KPI Cards
    const renderComparisonKPI = () => {
        if (!comparisonData || !comparisonData.kpi_summary) return null;
        const { previous_period, current_period, kpi_summary } = comparisonData;
        const prevLabel = `${getMonthName(previous_period?.month || 11)} ${previous_period?.year || year}`;
        const currLabel = `${getMonthName(current_period?.month || month)} ${current_period?.year || year}`;

        const totalGaji = kpi_summary.estate_gaji || { previous: 0, current: 0 };
        const totalPremi = kpi_summary.total_premi || { previous: 0, current: 0 };
        const totalLembur = kpi_summary.total_lembur || { previous: 0, current: 0 };
        const totalTonase = kpi_summary.tbs_weight || { previous: 0, current: 0 };
        const premiBreakdownCurrent = comparisonPremiBreakdown || {};

        // Premi breakdown totals for current month (from backend)
        const totalPruning = {
            previous: Number(premiBreakdownCurrent.total_prunning_previous ?? comparisonGrandTotal?.total_prunning_previous ?? 0),
            current: Number(premiBreakdownCurrent.total_prunning_current ?? comparisonGrandTotal?.total_prunning_current ?? 0)
        };
        const totalBrondol = {
            previous: Number(premiBreakdownCurrent.total_brondol_previous ?? comparisonGrandTotal?.total_brondol_previous ?? 0),
            current: Number(premiBreakdownCurrent.total_brondol_current ?? comparisonGrandTotal?.total_brondol_current ?? 0)
        };
        const totalInsentif = {
            previous: Number(premiBreakdownCurrent.total_insentif_previous ?? comparisonGrandTotal?.total_insentif_previous ?? 0),
            current: Number(premiBreakdownCurrent.total_insentif_current ?? comparisonGrandTotal?.total_insentif_current ?? 0)
        };
        const totalKinerja = {
            previous: Number(premiBreakdownCurrent.total_kinerja_previous ?? comparisonGrandTotal?.total_kinerja_previous ?? 0),
            current: Number(premiBreakdownCurrent.total_kinerja_current ?? comparisonGrandTotal?.total_kinerja_current ?? 0)
        };

        const formatMetricValue = (value, { prefix = '', suffix = '', decimals = 0 } = {}) => {
            const formatted = formatNumber(value, decimals);
            return `${prefix}${formatted}${suffix ? ` ${suffix}` : ''}`;
        };

        const getComparisonDelta = (current, previous, positiveDirection = 'down') => {
            const currentValue = Number(current || 0);
            const previousValue = Number(previous || 0);
            const diff = currentValue - previousValue;
            const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
            const tone = direction === 'flat' ? 'neutral' : direction === positiveDirection ? 'good' : 'bad';
            const percent = Math.abs(previousValue) > 0 ? (Math.abs(diff) / Math.abs(previousValue)) * 100 : null;
            const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;

            return {
                diff,
                absDiff: Math.abs(diff),
                direction,
                tone,
                percent,
                Icon,
                label: direction === 'up' ? 'Naik' : direction === 'down' ? 'Turun' : 'Tetap'
            };
        };

        const renderComparisonMetricCard = ({
            label,
            current,
            previous,
            accent = '#0f172a',
            prefix = '',
            suffix = '',
            decimals = 0,
            positiveDirection = 'down'
        }) => {
            const delta = getComparisonDelta(current, previous, positiveDirection);
            const DirectionIcon = delta.Icon;
            const currentText = formatMetricValue(current, { prefix, suffix, decimals });
            const previousText = formatMetricValue(previous, { prefix, suffix, decimals });
            const diffSign = delta.diff > 0 ? '+' : delta.diff < 0 ? '-' : '';
            const diffText = `${diffSign}${formatMetricValue(delta.absDiff, { prefix, suffix, decimals })}`;

            return (
                <div className={`wsp-kpi-card comparison-card ${delta.tone}`} style={{ '--kpi-accent': accent }}>
                    <div className="wsp-kpi-label">{label}</div>
                    <div className="wsp-kpi-value comparison-main-value">{currentText}</div>
                    <div className="wsp-kpi-previous-line">
                        <span>{prevLabel}</span>
                        <strong>{previousText}</strong>
                    </div>
                    <div className={`wsp-kpi-delta-chip ${delta.direction} ${delta.tone}`}>
                        <DirectionIcon size={15} strokeWidth={2.6} />
                        <span>{delta.label}</span>
                        <strong>{diffText}</strong>
                        {delta.percent !== null && (
                            <small>{formatNumber(delta.percent, 1)}%</small>
                        )}
                    </div>
                </div>
            );
        };

        const renderMiniComparisonCard = ({ label, metric, accent }) => {
            const delta = getComparisonDelta(metric.current, metric.previous, 'down');
            const DirectionIcon = delta.Icon;
            const diffSign = delta.diff > 0 ? '+' : delta.diff < 0 ? '-' : '';

            return (
                <div className={`wsp-mini-kpi-card ${delta.tone}`} style={{ '--kpi-accent': accent }}>
                    <div className="wsp-mini-kpi-head">
                        <span>{label}</span>
                        <span className={`wsp-kpi-direction ${delta.direction} ${delta.tone}`}>
                            <DirectionIcon size={14} strokeWidth={2.6} />
                        </span>
                    </div>
                    <div className="wsp-mini-kpi-value">{formatMetricValue(metric.current)}</div>
                    <div className="wsp-mini-kpi-meta">
                        <span>{prevLabel}: {formatMetricValue(metric.previous)}</span>
                        <strong>{diffSign}{formatMetricValue(delta.absDiff)}</strong>
                    </div>
                </div>
            );
        };

        return (
            <>
                {/* Main KPI Row */}
                <div className="wsp-kpi-grid comparison-grid">
                    {renderComparisonMetricCard({
                        label: 'Total Upah Bersih',
                        current: totalGaji.current,
                        previous: totalGaji.previous,
                        accent: '#0f172a',
                        prefix: 'Rp ',
                        positiveDirection: 'down'
                    })}
                    {renderComparisonMetricCard({
                        label: 'Total Premi',
                        current: totalPremi.current,
                        previous: totalPremi.previous,
                        accent: '#B45309',
                        prefix: 'Rp ',
                        positiveDirection: 'down'
                    })}
                    {renderComparisonMetricCard({
                        label: 'Total Lembur',
                        current: totalLembur.current,
                        previous: totalLembur.previous,
                        accent: '#B45309',
                        prefix: 'Rp ',
                        positiveDirection: 'down'
                    })}
                    {renderComparisonMetricCard({
                        label: 'Total Tonase TBS',
                        current: totalTonase.current,
                        previous: totalTonase.previous,
                        accent: '#10b981',
                        suffix: 'Ton',
                        decimals: 2,
                        positiveDirection: 'up'
                    })}
                </div>

                {/* Premi Breakdown Mini Cards */}
                <div className="wsp-mini-kpi-grid">
                    {renderMiniComparisonCard({ label: 'Pruning', metric: totalPruning, accent: '#B45309' })}
                    {renderMiniComparisonCard({ label: 'Brondol', metric: totalBrondol, accent: '#ef4444' })}
                    {renderMiniComparisonCard({ label: 'Insentif Panen', metric: totalInsentif, accent: '#16a34a' })}
                    {renderMiniComparisonCard({ label: 'Kinerja', metric: totalKinerja, accent: '#2563eb' })}
                </div>
            </>
        );
    };

    // Render trend arrow helper
    const renderTrendArrow = (curr, prev, type = 'cost') => {
        const diff = (curr || 0) - (prev || 0);
        if (Math.abs(diff) < 0.01) return null; // No significant change

        const isUp = diff > 0;
        let arrowClass = '';

        if (type === 'cost') {
            arrowClass = isUp ? 'trend-up' : 'trend-down'; // Cost: Up=Red, Down=Green
        } else if (type === 'yield') {
            arrowClass = isUp ? 'trend-up-green' : 'trend-down-red'; // Yield: Up=Green, Down=Red
        }

        return (
            <span className={`trend-indicator ${arrowClass}`}>
                {isUp ? <ArrowUpRight size={12} strokeWidth={2.6} /> : <ArrowDownRight size={12} strokeWidth={2.6} />}
            </span>
        );
    };

    const renderTrendValue = (value, current, previous, type = 'cost', decimals = 0) => (
        <span className="wages-comparison-cell-value">
            <span>{formatNumber(value, decimals)}</span>
            {renderTrendArrow(current, previous, type)}
        </span>
    );

    // Render comparison table
    const renderComparisonTable = () => {
        if (!comparisonData || !comparisonData.divisions) return null;

        const { divisions = [], previous_period, current_period } = comparisonData;
        const prevMonthName = getMonthName(previous_period.month).toUpperCase();
        const currMonthName = getMonthName(current_period.month).toUpperCase();
        const grandTotal = comparisonGrandTotal || {};
        return (
            <>
            <div className="wsp-table-wrapper wages-comparison-screen-wrapper no-print">
                <table className="wsp-table comparison-table wages-rebinmas-comparison-table">
                    <colgroup>
                        <col className="wages-comparison-col-division" />
                        <col className="wages-comparison-col-workers" />
                        <col className="wages-comparison-col-workers" />
                        <col className="wages-comparison-col-premi-detail" />
                        <col className="wages-comparison-col-premi-detail" />
                        <col className="wages-comparison-col-premi-detail" />
                        <col className="wages-comparison-col-premi-detail" />
                        <col className="wages-comparison-col-premi-total" />
                        <col className="wages-comparison-col-lembur" />
                        <col className="wages-comparison-col-pph" />
                        <col className="wages-comparison-col-spsi" />
                        <col className="wages-comparison-col-gaji" />
                        <col className="wages-comparison-col-tbs" />
                        <col className="wages-comparison-col-gaji" />
                        <col className="wages-comparison-col-tbs" />
                        <col className="wages-comparison-col-selisih" />
                    </colgroup>
                    <thead>
                        {/* SCREEN VERSION of Comparison Headers */}
                        <tr className="wsp-header-master no-print report-screen-header">
                            <th rowSpan="2" className="th-sticky-col th-gang-name" style={{ width: '25%' }}>ESTATE / DIVISI</th>
                            <th colSpan="2" className="th-group-manpower">MANPOWER</th>
                            <th colSpan="5" className="th-group-premi">PREMI ({currMonthName})</th>
                            <th colSpan="3" className="th-group-uraian">Lembur dan Potongan</th>
                            <th colSpan="2" className="th-group-prev">REKAP {prevMonthName.substring(0, 3)}</th>
                            <th colSpan="2" className="th-group-curr">REKAP {currMonthName.substring(0, 3)}</th>
                            <th rowSpan="2" className="th-group-diff">SELISIH</th>
                        </tr>
                        <tr className="wsp-header-sub no-print report-screen-header">
                            <th className="th-group-workers">{prevMonthName.substring(0, 3)}</th>
                            <th className="th-group-workers">{currMonthName.substring(0, 3)}</th>
                            <th className="th-group-premi">PRUNING</th>
                            <th className="th-group-premi">BRONDOL</th>
                            <th className="th-group-premi">INSENTIF</th>
                            <th className="th-group-premi">KINERJA</th>
                            <th className="th-group-premi" style={{ fontWeight: 800 }}>TOTAL</th>
                            <th className="th-group-uraian">LEMBUR</th>
                            <th className="th-group-uraian">PPH21</th>
                            <th className="th-group-uraian">SPSI</th>
                            <th className="th-group-prev">GAJI</th>
                            <th className="th-group-prev">TBS (Ton)</th>
                            <th className="th-group-curr">GAJI</th>
                            <th className="th-group-curr">TBS (Ton)</th>
                        </tr>

                        {/* PRINT VERSION of Comparison Headers (Simplified) */}
                        <tr className="wsp-header-master print-only report-print-header">
                            <th rowSpan="2" className="th-sticky-col th-gang-name" style={{ width: '25%' }}>ESTATE / DIVISI</th>
                            <th colSpan="2" className="th-group-manpower">MANPOWER</th>
                            <th colSpan="1" className="th-group-premi">TOTAL PREMI</th>
                            <th colSpan="3" className="th-group-uraian">Lembur dan Potongan</th>
                            <th colSpan="2" className="th-group-prev">REKAP {prevMonthName.substring(0, 3)}</th>
                            <th colSpan="2" className="th-group-curr">REKAP {currMonthName.substring(0, 3)}</th>
                            <th rowSpan="2" className="th-group-diff">SELISIH</th>
                        </tr>
                        <tr className="wsp-header-sub print-only report-print-header">
                            <th className="th-group-workers">{prevMonthName.substring(0, 3)}</th>
                            <th className="th-group-workers">{currMonthName.substring(0, 3)}</th>
                            <th className="th-group-premi" style={{ fontWeight: 800 }}>TOTAL</th>
                            <th className="th-group-uraian">LEMBUR</th>
                            <th className="th-group-uraian">PPH21</th>
                            <th className="th-group-uraian">SPSI</th>
                            <th className="th-group-prev">GAJI</th>
                            <th className="th-group-prev">TBS (Ton)</th>
                            <th className="th-group-curr">GAJI</th>
                            <th className="th-group-curr">TBS (Ton)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {divisions.map((row, idx) => {
                            const currGaji = row.current_month?.gaji || 0;
                            const prevGaji = row.previous_month?.gaji || 0;
                            const calculatedSelisih = currGaji - prevGaji;
                            return (
                                <tr key={idx}>
                                    {/* Division: separate code and desc */}
                                    <td className="text-left division-name sticky-col">
                                        {row.description && row.description !== row.division_code ? (
                                            <>
                                                <div className="div-desc">
                                                    {row.description}
                                                </div>
                                                <div className="div-code">{row.division_code}</div>
                                            </>
                                        ) : (
                                            <div className="div-desc">
                                                {row.division_code}
                                            </div>
                                        )}
                                    </td>

                                    {/* Workers */}
                                    <td className="text-right border-right-group">{formatNumber(row.workers_previous)}</td>
                                    <td className="text-right border-right-section">
                                        {renderTrendValue(row.workers_current, row.workers_current, row.workers_previous, 'cost')}
                                    </td>

                                    {/* Premi Breakdown - Hide detail in print */}
                                    <td className={`text-right no-print ${(row.total_prunning_current || 0) === 0 ? 'val-zero' : ''}`}>{formatNumber(row.total_prunning_current || 0)}</td>
                                    <td className={`text-right no-print ${(row.total_brondol_current || 0) === 0 ? 'val-zero' : ''}`}>{formatNumber(row.total_brondol_current || 0)}</td>
                                    <td className={`text-right no-print ${(row.total_insentif_current || 0) === 0 ? 'val-zero' : ''}`}>{formatNumber(row.total_insentif_current || 0)}</td>
                                    <td className={`text-right no-print ${(row.total_kinerja_current || 0) === 0 ? 'val-zero' : ''}`}>{formatNumber(row.total_kinerja_current || 0)}</td>
                                    {/* Keep Total Premi in print */}
                                    <td className="text-right border-right-section" style={{ fontWeight: 700 }}>
                                        {renderTrendValue(row.total_premi_current, row.total_premi_current, row.total_premi_previous, 'cost')}
                                    </td>

                                    {/* Lembur & Deductions */}
                                    <td className="text-right">
                                        {renderTrendValue(row.total_lembur_current, row.total_lembur_current, row.total_lembur_previous, 'cost')}
                                    </td>
                                    <td className="text-right">{formatNumber(row.total_pph21_current)}</td>
                                    <td className="text-right border-right-section">{formatNumber(row.total_spsi_current)}</td>

                                    {/* Previous Month */}
                                    <td className="text-right">{formatNumber(prevGaji)}</td>
                                    <td className={`text-right border-right-section ${(row.previous_month?.tbs_weight || 0) > 0 ? 'tonase-highlight' : ''}`}>
                                        {formatNumber(row.previous_month?.tbs_weight, 3)}
                                    </td>

                                    {/* Current Month */}
                                    <td className="text-right font-semibold">
                                        {renderTrendValue(currGaji, currGaji, prevGaji, 'cost')}
                                    </td>
                                    <td className={`text-right border-right-section font-semibold ${(row.current_month?.tbs_weight || 0) > 0 ? 'tonase-highlight' : ''}`}>
                                        {renderTrendValue(row.current_month?.tbs_weight, row.current_month?.tbs_weight, row.previous_month?.tbs_weight, 'yield', 3)}
                                    </td>

                                    {/* SELISIH - calculated gaji difference */}
                                    <td className={`text-right font-semibold ${calculatedSelisih > 0 ? 'text-diff-neg' : calculatedSelisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                        {renderTrendValue(calculatedSelisih, calculatedSelisih, 0, 'cost')}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="wsp-grand-total">
                            <td className="text-left sticky-col">SUB TOTAL</td>
                            <td className="text-right">{formatNumber(grandTotal.workers_previous)}</td>
                            <td className="text-right">
                                {renderTrendValue(grandTotal.workers_current, grandTotal.workers_current, grandTotal.workers_previous, 'cost')}
                            </td>
                            <td className="text-right no-print">{formatNumber(grandTotal.total_prunning_current)}</td>
                            <td className="text-right no-print">{formatNumber(grandTotal.total_brondol_current)}</td>
                            <td className="text-right no-print">{formatNumber(grandTotal.total_insentif_current)}</td>
                            <td className="text-right no-print">{formatNumber(grandTotal.total_kinerja_current)}</td>
                            <td className="text-right" style={{ fontWeight: 800 }}>
                                {renderTrendValue(grandTotal.total_premi_current, grandTotal.total_premi_current, grandTotal.total_premi_previous, 'cost')}
                            </td>
                            <td className="text-right">
                                {renderTrendValue(grandTotal.total_lembur_current, grandTotal.total_lembur_current, grandTotal.total_lembur_previous, 'cost')}
                            </td>
                            <td className="text-right">{formatNumber(grandTotal.total_pph21_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_spsi_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.prev_gaji)}</td>
                            <td className={`text-right ${grandTotal.prev_tbs > 0 ? 'tonase-highlight' : ''}`}>{formatNumber(grandTotal.prev_tbs, 3)}</td>
                            <td className="text-right">
                                {renderTrendValue(grandTotal.curr_gaji, grandTotal.curr_gaji, grandTotal.prev_gaji, 'cost')}
                            </td>
                            <td className={`text-right ${grandTotal.curr_tbs > 0 ? 'tonase-highlight' : ''}`}>
                                {renderTrendValue(grandTotal.curr_tbs, grandTotal.curr_tbs, grandTotal.prev_tbs, 'yield', 3)}
                            </td>
                            <td className={`text-right font-bold ${grandTotal.selisih > 0 ? 'text-diff-neg' : grandTotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                {renderTrendValue(grandTotal.selisih, grandTotal.selisih, 0, 'cost')}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div className="wsp-table-wrapper wages-comparison-print-wrapper print-only">
                <table className="wsp-table wages-comparison-print-table">
                    <colgroup>
                        <col className="wages-print-col-division" />
                        <col className="wages-print-col-workers" />
                        <col className="wages-print-col-workers" />
                        <col className="wages-print-col-premi" />
                        <col className="wages-print-col-lembur" />
                        <col className="wages-print-col-pph" />
                        <col className="wages-print-col-spsi" />
                        <col className="wages-print-col-gaji" />
                        <col className="wages-print-col-gaji" />
                        <col className="wages-print-col-selisih" />
                        <col className="wages-print-col-tbs" />
                        <col className="wages-print-col-tbs" />
                    </colgroup>
                    <thead>
                        <tr className="wsp-header-master">
                            <th rowSpan="2">ESTATE / DIVISI</th>
                            <th colSpan="2">MANPOWER</th>
                            <th colSpan="2">PENDAPATAN {currMonthName.substring(0, 3)}</th>
                            <th colSpan="2">POTONGAN</th>
                            <th colSpan="3">UPAH BERSIH</th>
                            <th colSpan="2">TBS (TON)</th>
                        </tr>
                        <tr className="wsp-header-sub">
                            <th>{prevMonthName.substring(0, 3)}</th>
                            <th>{currMonthName.substring(0, 3)}</th>
                            <th>PREMI</th>
                            <th>LEMBUR</th>
                            <th>PPH21</th>
                            <th>SPSI</th>
                            <th>{prevMonthName.substring(0, 3)}</th>
                            <th>{currMonthName.substring(0, 3)}</th>
                            <th>PERUBAHAN</th>
                            <th>{prevMonthName.substring(0, 3)}</th>
                            <th>{currMonthName.substring(0, 3)}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {divisions.map((row, idx) => {
                            const currGaji = row.current_month?.gaji || 0;
                            const prevGaji = row.previous_month?.gaji || 0;
                            const calculatedSelisih = currGaji - prevGaji;
                            return (
                                <tr key={`print-comparison-${row.division_code || idx}`}>
                                    <td className="division-name">
                                        {row.description && row.description !== row.division_code ? (
                                            <>
                                                <div className="div-desc">{row.description}</div>
                                                <div className="div-code">{row.division_code}</div>
                                            </>
                                        ) : (
                                            <div className="div-desc">{row.division_code}</div>
                                        )}
                                    </td>
                                    <td>{formatNumber(row.workers_previous)}</td>
                                    <td>{renderTrendValue(row.workers_current, row.workers_current, row.workers_previous, 'cost')}</td>
                                    <td>{renderTrendValue(row.total_premi_current, row.total_premi_current, row.total_premi_previous, 'cost')}</td>
                                    <td>{renderTrendValue(row.total_lembur_current, row.total_lembur_current, row.total_lembur_previous, 'cost')}</td>
                                    <td>{formatNumber(row.total_pph21_current)}</td>
                                    <td>{formatNumber(row.total_spsi_current)}</td>
                                    <td>{formatNumber(prevGaji)}</td>
                                    <td>{renderTrendValue(currGaji, currGaji, prevGaji, 'cost')}</td>
                                    <td className={calculatedSelisih > 0 ? 'text-diff-neg' : calculatedSelisih < 0 ? 'text-diff-pos' : 'text-neutral'}>
                                        {renderTrendValue(calculatedSelisih, calculatedSelisih, 0, 'cost')}
                                    </td>
                                    <td>{formatNumber(row.previous_month?.tbs_weight, 2)}</td>
                                    <td>{renderTrendValue(row.current_month?.tbs_weight, row.current_month?.tbs_weight, row.previous_month?.tbs_weight, 'yield', 2)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="wsp-grand-total">
                            <td>GRAND TOTAL</td>
                            <td>{formatNumber(grandTotal.workers_previous)}</td>
                            <td>{renderTrendValue(grandTotal.workers_current, grandTotal.workers_current, grandTotal.workers_previous, 'cost')}</td>
                            <td>{renderTrendValue(grandTotal.total_premi_current, grandTotal.total_premi_current, grandTotal.total_premi_previous, 'cost')}</td>
                            <td>{renderTrendValue(grandTotal.total_lembur_current, grandTotal.total_lembur_current, grandTotal.total_lembur_previous, 'cost')}</td>
                            <td>{formatNumber(grandTotal.total_pph21_current)}</td>
                            <td>{formatNumber(grandTotal.total_spsi_current)}</td>
                            <td>{formatNumber(grandTotal.prev_gaji)}</td>
                            <td>{renderTrendValue(grandTotal.curr_gaji, grandTotal.curr_gaji, grandTotal.prev_gaji, 'cost')}</td>
                            <td className={grandTotal.selisih > 0 ? 'text-diff-neg' : grandTotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}>
                                {renderTrendValue(grandTotal.selisih, grandTotal.selisih, 0, 'cost')}
                            </td>
                            <td>{formatNumber(grandTotal.prev_tbs, 2)}</td>
                            <td>{renderTrendValue(grandTotal.curr_tbs, grandTotal.curr_tbs, grandTotal.prev_tbs, 'yield', 2)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            </>
        );
    };

    // Handle Save PDF
    const handleSavePDF = () => {
        const element = document.getElementById(isStandardWagesMode ? 'wsp-report-print-set' : 'wsp-report-content');
        const filename = `Wages_Summary_Rebinmas_${month}_${year}.pdf`;
        generatePDF(element, filename, {
            jsPDF: { orientation: thrMode ? 'portrait' : 'landscape' }
        });
    };

    // Handle print
    const handlePrint = () => {
        printReport({
            orientation: thrMode ? 'portrait' : 'landscape',
            margin: comparisonMode ? '0' : '8mm'
        });
    };

    // Handle export CSV
    const handleExport = () => {
        let csv = 'Division,Workers,HK Cekroll,PPH21,SPSI,Total Premi,Total Lembur,Total Upah Bersih\n';

        summaryData.forEach(row => {
            if (!row.is_grand_total) {
                const totalPremiExcludingSpecial = (row.total_premi_excluding_special || row.total_premi || 0);
                csv += `"${row.description || ''}",${row.total_employees || 0},${row.total_hk || 0},${row.total_pph21 || 0},${row.total_spsi || 0},${totalPremiExcludingSpecial},${row.total_lembur || 0},${row.total_manual || 0}\n`;
            }
        });

        if (grandTotal) {
            const totalPremiExcludingSpecial = (grandTotal.total_premi_excluding_special || grandTotal.total_premi || 0);
            csv += `"GRAND TOTAL",${grandTotal.total_employees || 0},${grandTotal.total_hk || 0},${grandTotal.total_pph21 || 0},${grandTotal.total_spsi || 0},${totalPremiExcludingSpecial},${grandTotal.total_lembur || 0},${grandTotal.total_manual || 0}\n`;
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Summary_Wages_Rebinmas_${month}_${year}.csv`;
        link.click();
    };

    // Handle THR Excel Export - Detailed Employee List
    const handleThrExport = async () => {
        try {
            // Get divisionCode based on filter
            let divisionCode;
            if (thrIjlFilter === 'ijl-only') {
                divisionCode = 'IJL';
            } else if (thrIjlFilter === 'non-ijl') {
                // For non-IJL, we need to export all non-IJL divisions
                // Use the existing export endpoint with incomeType=THR
            }

            // Use the existing exportExcel function which generates detailed THR list
            await otherIncomesService.exportExcel(year, month, divisionCode, undefined, 'THR');
        } catch (error) {
            console.error('Error exporting THR Excel:', error);
            alert('Failed to export THR Excel. Please try again.');
        }
    };

    // Render estate group
    const renderEstateGroup = (groupKey, group) => {
        if (group.divisions.length === 0) return null;

        return (
            <React.Fragment key={groupKey}>
                {/* Estate Header */}
                <tr className="estate-header">
                    <td colSpan="10">{group.label}</td>
                </tr>

                {/* Division Rows */}
                {group.divisions.map((div, idx) => (
                    <tr key={`${groupKey}-${idx}`}>
                        <td className="text-left division-name sticky-col">
                            {div.description && div.description !== div.division_code ? (
                                <>
                                    <div className="div-desc">
                                        {div.description}
                                    </div>
                                    <div className="div-code">{div.division_code}</div>
                                </>
                            ) : (
                                <div className="div-desc">{div.division_code}</div>
                            )}
                        </td>
                        <td className={`text-right ${Number(div.total_employees) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.total_employees)}
                        </td>
                        <td className={`text-right border-right-section ${Number(div.total_hk) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.total_hk)}
                        </td>
                        <td className={`text-right ${Number(div.total_pph21) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.total_pph21)}
                        </td>
                        <td className={`text-right border-right-section ${Number(div.total_spsi) === 0 ? 'val-zero' : ''}`}>
                            {editMode ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <input
                                        type="number"
                                        className="wsp-input-edit"
                                        value={editingSPSI[div.division_code] !== undefined ? editingSPSI[div.division_code] : (div.original_spsi ?? div.total_spsi)}
                                        onChange={(e) => handleSPSIChange(div.division_code, e.target.value)}
                                        style={{ width: '100%', textAlign: 'right', padding: '2px 4px', border: '1px solid #3b82f6', borderRadius: '4px', backgroundColor: '#ffffff', color: '#0f172a' }}
                                    />
                                    <button
                                        onClick={() => handleSaveSPSI(div.division_code, editingSPSI[div.division_code])}
                                        className="wsp-btn-sm"
                                        style={{ fontSize: '0.65rem', padding: '2px 6px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                        disabled={editingSPSI[div.division_code] === undefined}
                                    >
                                        Save
                                    </button>
                                </div>
                            ) : (
                                formatNumber(div.total_spsi)
                            )}
                        </td>
                        {/* Premi Column - Full Total Premi (same as Daftar Upah) */}
                        <td className={`text-right ${Number(div.total_premi_excluding_special) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.total_premi_excluding_special)}
                        </td>
                        {/* Lembur */}
                        <td className={`text-right ${Number(div.total_lembur) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.total_lembur)}
                        </td>
                        {/* Portal (Net Pay) */}
                        <td className={`text-right border-right-section ${Number(div.total_manual) === 0 ? 'val-zero' : 'val-positive'}`}>
                            {editMode ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <input
                                        type="number"
                                        className="wsp-input-edit"
                                        value={editingUpahBersih[div.division_code] !== undefined ? editingUpahBersih[div.division_code] : (div.total_manual ?? div.total_upah_bersih)}
                                        onChange={(e) => handleUpahBersihChange(div.division_code, e.target.value)}
                                        style={{ width: '100%', textAlign: 'right', padding: '2px 4px', border: '1px solid #3b82f6', borderRadius: '4px', backgroundColor: '#ffffff', color: '#0f172a' }}
                                    />
                                    <button
                                        onClick={() => handleSaveUpahBersih(div.division_code, editingUpahBersih[div.division_code])}
                                        className="wsp-btn-sm"
                                        style={{ fontSize: '0.65rem', padding: '2px 6px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                        disabled={editingUpahBersih[div.division_code] === undefined}
                                    >
                                        Save
                                    </button>
                                </div>
                            ) : (
                                formatNumber(div.total_manual)
                            )}
                        </td>
                        {/* Thumb Print */}
                        <td className={`text-right ${Number(div.thumb_print) === 0 ? 'val-zero' : ''}`}>
                            {editMode ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <input
                                        type="number"
                                        className="wsp-input-edit"
                                        value={editingValues[div.division_code] !== undefined ? editingValues[div.division_code] : div.thumb_print}
                                        onChange={(e) => handleThumbprintChange(div.division_code, e.target.value)}
                                        style={{ width: '100%', textAlign: 'right', padding: '2px 4px', border: '1px solid #3b82f6', borderRadius: '4px', backgroundColor: '#ffffff', color: '#0f172a' }}
                                    />
                                    <button
                                        onClick={() => handleSaveThumbprint(div.division_code, editingValues[div.division_code])}
                                        className="wsp-btn-sm"
                                        style={{ fontSize: '0.65rem', padding: '2px 6px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                        disabled={editingValues[div.division_code] === undefined}
                                    >
                                        Save
                                    </button>
                                </div>
                            ) : (
                                formatNumber(div.thumb_print)
                            )}
                        </td>
                        {/* Selisih */}
                        <td className={`text-center font-semibold ${div.selisih > 0 ? 'text-diff-neg' : div.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                            {formatNumber(div.selisih)}
                        </td>
                    </tr>
                ))}

                {/* Subtotal Row */}
                {group.subtotal && (
                    <tr className="subtotal">
                        <td className="text-left sticky-col">GRAND TOTAL {group.label.replace('ESTATE ', '')}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_employees)}</td>
                        <td className="text-right border-right-section">{formatNumber(group.subtotal.total_hk)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_pph21)}</td>
                        <td className="text-right border-right-section">{formatNumber(group.subtotal.total_spsi)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_premi_excluding_special || group.subtotal.total_premi)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_lembur)}</td>
                        <td className="text-right border-right-section">{formatNumber(group.subtotal.total_manual)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.thumb_print || 0)}</td>
                        <td className={`text-center font-semibold ${group.subtotal.selisih > 0 ? 'text-diff-neg' : group.subtotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                            {formatNumber(group.subtotal.selisih || 0)}
                        </td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    const renderAuditFooter = (pageNumber, totalPages = 3) => (
        <footer className="wsp-footer wages-report-footer">
            <div>Dicetak: {printDate}</div>
            <div>Payroll Reporting System - PT. Rebinmas Jaya</div>
            <div>Halaman {pageNumber} dari {totalPages}</div>
        </footer>
    );

    const renderAuditHeader = ({ title, subtitle }) => (
        <>
            <ReportWatermark />
            <div className="wsp-letterhead wages-audit-letterhead">
                <img src="/images/rebinmas.webp" alt="PT REBINMAS JAYA" className="wsp-logo" />
                <h1 className="wsp-company-name">PT. REBINMAS JAYA</h1>
                <div className="wsp-report-title wsp-report-title-main">{title}</div>
                <div className="wsp-report-subtitle">{subtitle}</div>
                <div className="wsp-report-period">
                    Periode: <strong>{periodLabel}</strong>
                </div>
                <ReportPrintMetadata
                    mode={getReportModeLabel({ comparisonMode, thrMode })}
                    source={getSourceModeLabel({ useHistory })}
                    scope={getDivisionTypeLabel(divisionType)}
                    estate="Rebinmas"
                    items={[
                        { label: 'Deskripsi', value: reportDivisionSummary },
                        { label: 'Status Audit', value: auditReport?.grandTotal?.auditStatus }
                    ]}
                    note="Total audit mengikuti data ringkasan backend aktif dan dihitung dari scope yang sama dengan halaman utama."
                />
            </div>
        </>
    );

    const renderStatusBadge = (status) => (
        <span className={`wages-audit-status ${status === 'OK' ? 'ok' : 'review'}`}>{status}</span>
    );

    const renderDeductionAuditPage = () => {
        if (!auditReport) return null;

        return (
            <div className="wsp-document wages-rebinmas-print-document wages-audit-page wages-deduction-audit-page">
                {renderAuditHeader({
                    title: 'AUDIT BREAKDOWN POTONGAN',
                    subtitle: 'Deduction Audit - PPH 21, SPSI, Total Potongan, dan Selisih Thumb Print'
                })}

                <div className="wages-audit-grid two-col">
                    <section className="wages-audit-panel">
                        <h2>Ringkasan Potongan per Estate</h2>
                        <table className="wsp-table wages-audit-summary-table">
                            <thead>
                                <tr>
                                    <th>Estate</th>
                                    <th>PPH 21</th>
                                    <th>SPSI</th>
                                    <th>Total Potongan</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditReport.deductionEstateSummary.map((row) => (
                                    <tr key={`deduction-summary-${row.estateName}`}>
                                        <td>{row.estateName}</td>
                                        <td className="text-right">{formatNumber(row.pph21)}</td>
                                        <td className="text-right">{formatNumber(row.spsi)}</td>
                                        <td className="text-right">{formatNumber(row.totalPotongan)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="wsp-grand-total">
                                    <td>GRAND TOTAL</td>
                                    <td className="text-right">{formatNumber(auditReport.grandTotal.pph21)}</td>
                                    <td className="text-right">{formatNumber(auditReport.grandTotal.spsi)}</td>
                                    <td className="text-right">{formatNumber(auditReport.grandTotal.totalPotongan)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </section>

                    <section className="wages-audit-panel wages-audit-notes">
                        <h2>Audit Notes</h2>
                        <ul>
                            <li>Total potongan harus sama dengan agregasi backend untuk scope aktif.</li>
                            <li>Selisih portal vs thumb print harus dapat dilacak sampai divisi.</li>
                            <li>Format angka menggunakan separator ribuan Indonesia.</li>
                            <li>Baris selisih tidak nol wajib direview sebelum approval.</li>
                        </ul>
                    </section>
                </div>

                <section className="wages-audit-panel full-width">
                    <h2>Tabel Audit Potongan</h2>
                    <table className="wsp-table wages-audit-detail-table wages-deduction-detail-table">
                        <thead>
                            <tr>
                                <th>Estate / Divisi</th>
                                <th>Workers</th>
                                <th>HK</th>
                                <th>PPH 21</th>
                                <th>SPSI</th>
                                <th>Total Potongan</th>
                                <th>Upah Bersih Portal</th>
                                <th>Thumb Print</th>
                                <th>Selisih</th>
                                <th>Status Audit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {auditReport.deductionRows.map((row) => (
                                <tr key={`deduction-${row.divisionCode || row.divisionName}`}>
                                    <td className="division-name"><strong>{row.divisionName}</strong><span>{row.divisionCode}</span></td>
                                    <td className="text-right">{formatNumber(row.workers)}</td>
                                    <td className="text-right">{formatNumber(row.hk)}</td>
                                    <td className="text-right">{formatNumber(row.pph21)}</td>
                                    <td className="text-right">{formatNumber(row.spsi)}</td>
                                    <td className="text-right">{formatNumber(row.totalPotongan)}</td>
                                    <td className="text-right">{formatNumber(row.upahBersihPortal)}</td>
                                    <td className="text-right">{formatNumber(row.thumbPrint)}</td>
                                    <td className={`text-right ${row.selisih === 0 ? 'text-neutral' : 'text-diff-neg'}`}>{formatNumber(row.selisih)}</td>
                                    <td>{renderStatusBadge(row.auditStatus)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="wsp-grand-total">
                                <td>GRAND TOTAL</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.workers)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.hk)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.pph21)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.spsi)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.totalPotongan)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.upahBersihPortal)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.thumbPrint)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.selisih)}</td>
                                <td>{renderStatusBadge(auditReport.grandTotal.auditStatus)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </section>
                {renderAuditFooter(2)}
            </div>
        );
    };

    const renderIncomeAuditPage = () => {
        if (!auditReport) return null;

        return (
            <div className="wsp-document wages-rebinmas-print-document wages-audit-page wages-income-audit-page wages-last-print-page">
                {renderAuditHeader({
                    title: 'AUDIT BREAKDOWN PENDAPATAN',
                    subtitle: 'Income Audit - Total Premi, Lembur, Upah Bersih, dan Validasi Selisih'
                })}

                <div className="wages-audit-grid two-col">
                    <section className="wages-audit-panel">
                        <h2>Ringkasan Income per Estate</h2>
                        <table className="wsp-table wages-audit-summary-table">
                            <thead>
                                <tr>
                                    <th>Estate</th>
                                    <th>Total Premi</th>
                                    <th>Lembur</th>
                                    <th>Upah Bersih</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditReport.incomeEstateSummary.map((row) => (
                                    <tr key={`income-summary-${row.estateName}`}>
                                        <td>{row.estateName}</td>
                                        <td className="text-right">{formatNumber(row.totalPremi)}</td>
                                        <td className="text-right">{formatNumber(row.lembur)}</td>
                                        <td className="text-right">{formatNumber(row.upahBersihPortal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="wsp-grand-total">
                                    <td>GRAND TOTAL</td>
                                    <td className="text-right">{formatNumber(auditReport.grandTotal.totalPremi)}</td>
                                    <td className="text-right">{formatNumber(auditReport.grandTotal.lembur)}</td>
                                    <td className="text-right">{formatNumber(auditReport.grandTotal.upahBersihPortal)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </section>

                    <section className="wages-audit-panel wages-validation-list">
                        <h2>Validation Checklist</h2>
                        <ul>
                            <li>Total upah bersih portal sudah dibandingkan dengan thumb print.</li>
                            <li>Grand total income mengikuti data backend aktif.</li>
                            <li>Baris subtotal dipisahkan per estate/divisi untuk audit cepat.</li>
                        </ul>
                    </section>
                </div>

                <section className="wages-audit-panel full-width">
                    <h2>Tabel Audit Income</h2>
                    <table className="wsp-table wages-audit-detail-table wages-income-detail-table">
                        <thead>
                            <tr>
                                <th>Estate / Divisi</th>
                                <th>Workers</th>
                                <th>HK</th>
                                <th>Total Premi</th>
                                <th>Lembur</th>
                                <th>Total Income</th>
                                <th>Upah Bersih Portal</th>
                                <th>Thumb Print</th>
                                <th>Selisih</th>
                                <th>Audit Remark</th>
                            </tr>
                        </thead>
                        <tbody>
                            {auditReport.incomeRows.map((row) => (
                                <tr key={`income-${row.divisionCode || row.divisionName}`}>
                                    <td className="division-name"><strong>{row.divisionName}</strong><span>{row.divisionCode}</span></td>
                                    <td className="text-right">{formatNumber(row.workers)}</td>
                                    <td className="text-right">{formatNumber(row.hk)}</td>
                                    <td className="text-right">{formatNumber(row.totalPremi)}</td>
                                    <td className="text-right">{formatNumber(row.lembur)}</td>
                                    <td className="text-right">{formatNumber(row.totalIncome)}</td>
                                    <td className="text-right">{formatNumber(row.upahBersihPortal)}</td>
                                    <td className="text-right">{formatNumber(row.thumbPrint)}</td>
                                    <td className={`text-right ${row.selisih === 0 ? 'text-neutral' : 'text-diff-neg'}`}>{formatNumber(row.selisih)}</td>
                                    <td>{row.auditRemark}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="wsp-grand-total">
                                <td>GRAND TOTAL</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.workers)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.hk)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.totalPremi)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.lembur)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.totalIncome)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.upahBersihPortal)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.thumbPrint)}</td>
                                <td className="text-right">{formatNumber(auditReport.grandTotal.selisih)}</td>
                                <td>{auditReport.grandTotal.auditRemark}</td>
                            </tr>
                        </tfoot>
                    </table>
                </section>

                <div className="wages-audit-signature">
                    <PrintSignature />
                </div>
                {renderAuditFooter(3)}
            </div>
        );
    };

    const renderAppendixHeader = ({ title, subtitle }) => (
        <>
            <ReportWatermark />
            <div className="wsp-letterhead wages-infographic-letterhead">
                <img src="/images/rebinmas.webp" alt="PT REBINMAS JAYA" className="wsp-logo" />
                <h1 className="wsp-company-name">PT. REBINMAS JAYA</h1>
                <div className="wsp-report-title wsp-report-title-main">{title}</div>
                <div className="wsp-report-subtitle">{subtitle}</div>
                <div className="wsp-report-period">
                    Periode: <strong>{periodLabel}</strong>
                </div>
                <ReportPrintMetadata
                    mode={getReportModeLabel({ comparisonMode, thrMode })}
                    source={getSourceModeLabel({ useHistory })}
                    scope={getDivisionTypeLabel(divisionType)}
                    estate="Rebinmas"
                    items={[{ label: 'Deskripsi', value: reportDivisionSummary }]}
                    note="Lampiran infografis dihitung dari data backend yang sama dengan tabel utama Wages Summary."
                />
            </div>
        </>
    );

    const renderInfographicAppendixPage = () => {
        if (!auditReport) return null;
        const estateRows = auditReport.estateSummary || [];
        const maxNetPay = Math.max(...estateRows.map(row => row.upahBersihPortal), 1);
        const maxPremi = Math.max(...estateRows.map(row => row.totalPremi), 1);
        const maxLembur = Math.max(...estateRows.map(row => row.lembur), 1);
        const maxPotongan = Math.max(...estateRows.map(row => row.totalPotongan), 1);
        const totalPotongan = auditReport.grandTotal.totalPotongan || 0;
        const totalIncome = auditReport.grandTotal.totalIncome || 0;
        const grandNetPay = auditReport.grandTotal.upahBersihPortal || 0;
        const pphShare = totalPotongan > 0 ? (auditReport.grandTotal.pph21 / totalPotongan) * 100 : 0;
        const spsiShare = totalPotongan > 0 ? (auditReport.grandTotal.spsi / totalPotongan) * 100 : 0;
        const premiShare = totalIncome > 0 ? (auditReport.grandTotal.totalPremi / totalIncome) * 100 : 0;
        const lemburShare = totalIncome > 0 ? (auditReport.grandTotal.lembur / totalIncome) * 100 : 0;
        const cleanRows = estateRows.filter(row => row.workers || row.upahBersihPortal || row.totalPremi || row.lembur);

        return (
            <div className="wsp-document wages-rebinmas-print-document wages-infographic-page wages-last-print-page">
                {renderAppendixHeader({
                    title: 'LAMPIRAN INFOGRAFIS WAGES SUMMARY',
                    subtitle: 'Visualisasi komponen gaji: upah bersih, premi, lembur, potongan, pekerja, dan HK'
                })}

                <div className="wages-infographic-kpi-grid">
                    <div className="wages-infographic-kpi">
                        <span>Total Upah Bersih</span>
                        <strong>Rp {formatNumber(grandNetPay)}</strong>
                        <small>Portal payroll</small>
                    </div>
                    <div className="wages-infographic-kpi">
                        <span>Total Premi</span>
                        <strong>Rp {formatNumber(auditReport.grandTotal.totalPremi)}</strong>
                        <small>Komponen premi</small>
                    </div>
                    <div className="wages-infographic-kpi">
                        <span>Total Lembur</span>
                        <strong>Rp {formatNumber(auditReport.grandTotal.lembur)}</strong>
                        <small>Komponen lembur</small>
                    </div>
                    <div className="wages-infographic-kpi">
                        <span>Pendapatan Variabel</span>
                        <strong>Rp {formatNumber(totalIncome)}</strong>
                        <small>Premi + lembur</small>
                    </div>
                </div>

                <div className="wages-infographic-kpi-grid secondary">
                    <div className="wages-infographic-kpi">
                        <span>Total Potongan</span>
                        <strong>Rp {formatNumber(totalPotongan)}</strong>
                        <small>PPH 21 + SPSI</small>
                    </div>
                    <div className="wages-infographic-kpi">
                        <span>Total PPH 21</span>
                        <strong>Rp {formatNumber(auditReport.grandTotal.pph21)}</strong>
                        <small>Pajak karyawan</small>
                    </div>
                    <div className="wages-infographic-kpi">
                        <span>Total SPSI</span>
                        <strong>Rp {formatNumber(auditReport.grandTotal.spsi)}</strong>
                        <small>Iuran SPSI</small>
                    </div>
                    <div className="wages-infographic-kpi">
                        <span>Total HK</span>
                        <strong>{formatNumber(auditReport.grandTotal.hk)}</strong>
                        <small>Hari kerja checkroll</small>
                    </div>
                </div>

                <div className="wages-infographic-layout">
                    <section className="wages-infographic-panel wide">
                        <h2>Kontribusi Upah Bersih per Estate</h2>
                        <div className="wages-bar-list">
                            {cleanRows.map(row => (
                                <div className="wages-bar-row" key={`netpay-${row.estateName}`}>
                                    <div className="wages-bar-label">{row.estateName}</div>
                                    <div className="wages-bar-track">
                                        <span style={{ width: `${Math.max((row.upahBersihPortal / maxNetPay) * 100, 3)}%` }} />
                                    </div>
                                    <div className="wages-bar-value">{formatNumber(row.upahBersihPortal)}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="wages-infographic-panel">
                        <h2>Premi per Estate</h2>
                        <div className="wages-bar-list compact">
                            {cleanRows.map(row => (
                                <div className="wages-bar-row" key={`premi-${row.estateName}`}>
                                    <div className="wages-bar-label">{row.estateName}</div>
                                    <div className="wages-bar-track premi">
                                        <span style={{ width: `${Math.max((row.totalPremi / maxPremi) * 100, 3)}%` }} />
                                    </div>
                                    <div className="wages-bar-value">{formatNumber(row.totalPremi)}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="wages-infographic-panel">
                        <h2>Lembur per Estate</h2>
                        <div className="wages-bar-list compact">
                            {cleanRows.map(row => (
                                <div className="wages-bar-row" key={`lembur-${row.estateName}`}>
                                    <div className="wages-bar-label">{row.estateName}</div>
                                    <div className="wages-bar-track lembur">
                                        <span style={{ width: `${Math.max((row.lembur / maxLembur) * 100, 3)}%` }} />
                                    </div>
                                    <div className="wages-bar-value">{formatNumber(row.lembur)}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="wages-infographic-panel">
                        <h2>Komposisi Pendapatan</h2>
                        <div className="wages-share-stack">
                            <span className="premi" style={{ width: `${premiShare}%` }}>Premi</span>
                            <span className="lembur" style={{ width: `${lemburShare}%` }}>Lembur</span>
                        </div>
                        <div className="wages-share-legend">
                            <span>Premi: {formatNumber(auditReport.grandTotal.totalPremi)}</span>
                            <span>Lembur: {formatNumber(auditReport.grandTotal.lembur)}</span>
                        </div>
                    </section>

                    <section className="wages-infographic-panel">
                        <h2>Komposisi Potongan</h2>
                        <div className="wages-share-stack deductions">
                            <span className="pph" style={{ width: `${pphShare}%` }}>PPH 21</span>
                            <span className="spsi" style={{ width: `${spsiShare}%` }}>SPSI</span>
                        </div>
                        <div className="wages-share-legend">
                            <span>PPH 21: {formatNumber(auditReport.grandTotal.pph21)}</span>
                            <span>SPSI: {formatNumber(auditReport.grandTotal.spsi)}</span>
                        </div>
                    </section>

                    <section className="wages-infographic-panel wide">
                        <h2>Komponen Gaji per Estate</h2>
                        <table className="wsp-table wages-infographic-table">
                            <thead>
                                <tr>
                                    <th>Estate</th>
                                    <th>Workers</th>
                                    <th>HK</th>
                                    <th>Premi</th>
                                    <th>Lembur</th>
                                    <th>PPH 21</th>
                                    <th>SPSI</th>
                                    <th>Upah Bersih</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cleanRows.map(row => (
                                    <tr key={`components-${row.estateName}`}>
                                        <td>{row.estateName}</td>
                                        <td className="text-right">{formatNumber(row.workers)}</td>
                                        <td className="text-right">{formatNumber(row.hk)}</td>
                                        <td className="text-right">{formatNumber(row.totalPremi)}</td>
                                        <td className="text-right">{formatNumber(row.lembur)}</td>
                                        <td className="text-right">{formatNumber(row.pph21)}</td>
                                        <td className="text-right">{formatNumber(row.spsi)}</td>
                                        <td className="text-right">{formatNumber(row.upahBersihPortal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>

                    <section className="wages-infographic-panel wide">
                        <h2>Potongan per Estate</h2>
                        <div className="wages-bar-list compact">
                            {cleanRows.map(row => (
                                <div className="wages-bar-row" key={`deduction-${row.estateName}`}>
                                    <div className="wages-bar-label">{row.estateName}</div>
                                    <div className="wages-bar-track deduction">
                                        <span style={{ width: `${Math.max((row.totalPotongan / maxPotongan) * 100, 3)}%` }} />
                                    </div>
                                    <div className="wages-bar-value">{formatNumber(row.totalPotongan)}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                </div>
                {renderAuditFooter(2, 2)}
            </div>
        );
    };
    return (
        <div className="wsp-container" style={{ padding: '1.5rem', backgroundColor: '#EDF3EC', minHeight: '100vh' }}>
            {/* Action Bar */}
            <div className="report-header-web no-print">
                <div className="report-header-info">
                    <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Wages Summary (Rebinmas) <MetricInfo metricKey="upah_bersih" /></h1>
                    <p>Laporan rincian upah lengkap untuk entitas PT Rebinmas Jaya.</p>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button onClick={() => navigate(`/cost-per-ton-story?month=${month || ''}&year=${year || ''}`)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1F6F43', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cost/Ton Story →</button>
                        {/* Division Type Selector (All/Real/Virtual) */}
                        <select
                            value={divisionType}
                            onChange={(e) => {
                                setDivisionType(e.target.value);
                            }}
                            className="report-filter-badge"
                            style={{ 
                                cursor: 'pointer', 
                                outline: 'none',
                                backgroundColor: divisionType === 'virtual' ? '#fef3c7' : divisionType === 'real' ? '#F7F5EF' : '#dcfce7',
                                color: divisionType === 'virtual' ? '#92400e' : divisionType === 'real' ? '#15211A' : '#166534',
                                borderColor: divisionType === 'virtual' ? '#fde68a' : divisionType === 'real' ? '#E0DED2' : '#86efac',
                                fontWeight: 'bold'
                            }}
                        >
                            <option value="all">Semua Divisi</option>
                            <option value="real">Divisi Utama Saja</option>
                            <option value="virtual">Divisi Virtual Saja</option>
                        </select>

                        {/* Period Slider (Highlighted & Prominent) */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: '#1F6F43',
                            border: '2px solid #1F6F43',
                            borderRadius: '12px',
                            padding: '5px 12px 5px 8px',
                            boxShadow: '0 2px 8px rgba(21, 33, 26, 0.18)',
                            transition: 'box-shadow 0.2s'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontSize: '10px',
                                fontWeight: '800',
                                color: '#F7F5EF',
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                whiteSpace: 'nowrap'
                            }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F7F5EF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                    <line x1="16" y1="2" x2="16" y2="6"/>
                                    <line x1="8" y1="2" x2="8" y2="6"/>
                                    <line x1="3" y1="10" x2="21" y2="10"/>
                                </svg>
                                Periode
                            </div>
                            <CompactPeriodScroll
                                month={month}
                                year={year}
                                onChange={(m, y) => { setMonth(m); setYear(y); }}
                                disableControls={loading}
                            />
                        </div>

                        <span className="report-filter-badge" style={{ backgroundColor: thrMode ? '#B45309' : (comparisonMode ? '#1F6F43' : '#64748b') }}>
                            {thrMode ? 'Mode THR' : (comparisonMode ? 'Mode Perbandingan' : 'Mode Standar')}
                        </span>
                        {thrMode && (
                            <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
                                <button
                                    onClick={() => setThrIjlFilter('non-ijl')}
                                    className={`report-filter-badge ${thrIjlFilter === 'non-ijl' ? 'wsp-btn-primary' : ''}`}
                                    style={{ backgroundColor: thrIjlFilter === 'non-ijl' ? '#3b82f6' : '#64748b', border: 'none', cursor: 'pointer', padding: '4px 12px', borderRadius: '4px', color: '#fff' }}
                                >
                                    Non-IJL
                                </button>
                                <button
                                    onClick={() => setThrIjlFilter('ijl-only')}
                                    className={`report-filter-badge ${thrIjlFilter === 'ijl-only' ? 'wsp-btn-primary' : ''}`}
                                    style={{ backgroundColor: thrIjlFilter === 'ijl-only' ? '#ef4444' : '#64748b', border: 'none', cursor: 'pointer', padding: '4px 12px', borderRadius: '4px', color: '#fff' }}
                                >
                                    IJL Only
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="report-header-actions">
                    <button onClick={handlePrint} className="wsp-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Printer size={18} /> Cetak Report
                    </button>
                    <button
                        onClick={handleSavePDF}
                        className="wsp-btn-secondary"
                        disabled={loading || (isStandardWagesMode && summaryData.length === 0)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        Save PDF
                    </button>
                    <button
                        onClick={handleExport}
                        className="wsp-btn-secondary"
                        disabled={loading || (!comparisonMode && summaryData.length === 0)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        Export CSV
                    </button>
                    <button
                        onClick={fetchData}
                        className="wsp-btn-secondary"
                        disabled={loading}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <RefreshCw size={18} /> Refresh
                    </button>
                    {thrMode && (
                        <button
                            onClick={handleThrExport}
                            className="wsp-btn-secondary"
                            disabled={!thrData?.divisions?.length}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '0.5rem' }}
                            title="Export THR Summary to Excel"
                        >
                            Export Excel
                        </button>
                    )}
                    <button
                        onClick={() => setThrMode(!thrMode)}
                        className={`wsp-btn ${thrMode ? 'wsp-btn-primary' : ''}`}
                        title="Toggle THR Mode - Rekap Semua Divisi"
                        style={{ marginLeft: '0.5rem', backgroundColor: thrMode ? '#B45309' : '' }}
                        disabled={loading || comparisonMode || impactReportMode}
                    >
                        {thrMode ? 'Back to Summary' : 'THR Mode'}
                    </button>
                    <button
                        onClick={handleComparisonModeToggle}
                        className={`wsp-btn ${comparisonMode ? 'wsp-btn-primary' : ''}`}
                        title="Toggle Wages Comparison Mode"
                        style={{ marginLeft: '0.5rem', backgroundColor: comparisonMode ? '#1F6F43' : '' }}
                        disabled={loading || thrMode || impactReportMode}
                    >
                        {comparisonMode ? 'Back to Wages Summary' : 'Wages Comparison'}
                    </button>
                    <button
                        onClick={() => setImpactReportMode(!impactReportMode)}
                        className={`wsp-btn ${impactReportMode ? 'wsp-btn-primary' : ''}`}
                        title="Toggle Impact Report Mode"
                        style={{ marginLeft: '0.5rem' }}
                    >
                        {impactReportMode ? 'Back to Summary' : 'Impact Report'}
                    </button>
                    <button
                        onClick={() => setEditMode(!editMode)}
                        className={`wsp-btn ${editMode ? 'wsp-btn-warning' : ''}`}
                        title="Toggle Edit Mode"
                        style={{ marginLeft: '0.5rem', backgroundColor: editMode ? '#B45309' : '' }}
                        disabled={comparisonMode || impactReportMode}
                    >
                        {editMode ? 'Exit Edit' : 'Edit Mode'}
                    </button>
                    {/* History DB Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: useHistory ? '#fef3c7' : 'var(--bg-card, #fff)', padding: '0.5rem 1rem', borderRadius: '8px', border: useHistory ? '1px solid #B45309' : '1px solid var(--border-color, #e2e8f0)', marginLeft: '0.5rem', transition: 'all 0.2s' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0, fontWeight: 500, fontSize: '0.875rem', color: useHistory ? '#92400e' : 'inherit' }} title="Ambil data dari history DB (extend_db_ptrj) - origin DB tidak terbebani">
                            <input
                                type="checkbox"
                                checked={useHistory}
                                onChange={(e) => {
                                    setUseHistory(e.target.checked);
                                    setSummaryData([]);
                                    setGrandTotal(null);
                                    setComparisonData(null);
                                }}
                                style={{ width: '16px', height: '16px', accentColor: '#B45309' }}
                            />
                            Mode History
                        </label>
                    </div>
                </div>
            </div>

            {/* Impact Report Mode - Render Full Page */}
            {impactReportMode ? (
                <ImpactReportPage
                    onBack={() => setImpactReportMode(false)}
                    initialMonth={month}
                    initialYear={year}
                    initialEstateType="non-ijl"
                />
            ) : (
                <>
                    {/* Loading State */}
                    {loading ? (
                        <div className="wsp-loading">
                            <div className="wsp-spinner"></div>
                            <div className="wsp-loading-text">Memuat Financial Report...</div>
                        </div>
                    ) : error ? (
                        <div className="wsp-error">
                            <div className="wsp-error-icon">!</div>
                            <div className="wsp-error-title">Gagal Memuat Data</div>
                            <div className="wsp-error-message">{error}</div>
                            <button onClick={fetchData} className="wsp-btn" style={{ marginTop: '1rem' }}>
                                Coba Lagi
                            </button>
                        </div>
                    ) : (
                        <>
                        {/* PRESENT MODE - tombol Present (mode normal) + HUD deck (present mode) */}
                        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                            <PresentController
                                presenting={presenting}
                                activeIndex={activeIndex}
                                slideCount={isStandardWagesMode ? 4 : 3}
                                onEnter={enter}
                                onExit={exit}
                                caption={presentCaption}
                            />
                        </div>
                        <div id="wsp-report-print-set" className={`wages-report-print-set ${isStandardWagesMode ? 'standard-wages-print-set' : ''}`}>
                        {/* Paper Document */}
                        <div className={`wsp-document ${thrMode ? 'thr-print-document' : `wages-rebinmas-print-document ${comparisonMode ? 'wages-comparison-page' : 'wages-summary-page'}`}`} id="wsp-report-content">
                            <ReportWatermark />
                            <PresentSlide num="01" id="slide-01" title="Konteks & Ringkasan" subtitle="Identitas laporan, periode, cakupan divisi, dan indikator utama upah">
                            {/* Letterhead */}
                            <div className="wsp-letterhead">
                                <img src="/images/rebinmas.webp" alt="PT REBINMAS JAYA" className="wsp-logo" />
                                <h1 className="wsp-company-name">
                                    {/* If THR mode and IJL Only filter, show PT IMPIAN JAYA LESTARI */}
                                    {thrMode && thrIjlFilter === 'ijl-only'
                                        ? 'PT. IMPIAN JAYA LESTARI'
                                        : 'PT. REBINMAS JAYA'}
                                </h1>
                                <div className="wsp-report-title wsp-report-title-main" style={{
                                    fontSize: '1.5rem',
                                    fontWeight: '700',
                                    margin: '1rem 0 0.5rem 0',
                                    textAlign: 'center',
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px'
                                }}>
                                    {thrMode ? 'REKAPITULASI TUNJANGAN HARI RAYA (THR SUMMARY)' : (comparisonMode ? 'LAPORAN PERBANDINGAN UPAH BULANAN (WAGES COMPARISON)' : 'REKAPITULASI DAFTAR UPAH (WAGES SUMMARY)')}
                                </div>
                                <div className="wsp-report-subtitle" style={{
                                    fontSize: '1rem',
                                    fontWeight: '500',
                                    textAlign: 'center',
                                    color: '#475569',
                                    marginBottom: '0.5rem'
                                }}>
                                    {!thrMode && !comparisonMode && 'WAGES SUMMARY REPORT - PT. REBINMAS JAYA'}
                                    {comparisonMode && 'WAGES COMPARISON REPORT - PT. REBINMAS JAYA'}
                                    {thrMode && thrIjlFilter === 'ijl-only' && 'THR REPORT - PT. IMPIAN JAYA LESTARI'}
                                </div>
                                <div className="wsp-report-period" style={{
                                    fontSize: '0.95rem',
                                    textAlign: 'center',
                                    marginTop: '0.5rem',
                                    padding: '0.5rem 1rem',
                                    backgroundColor: '#f1f5f9',
                                    borderRadius: '6px',
                                    display: 'inline-block',
                                    width: 'auto',
                                    marginLeft: 'auto',
                                    marginRight: 'auto'
                                }}>
                                    {thrMode && <span style={{ marginRight: '1rem' }}>Division: <strong style={{ color: '#0f172a' }}>ALL</strong> | </span>}
                                    Periode: <strong style={{ color: '#0f172a' }}>{periodLabel}</strong>
                                </div>
                                <ReportPrintMetadata
                                    mode={getReportModeLabel({ comparisonMode, thrMode })}
                                    source={getSourceModeLabel({ useHistory, sourceMode: thrMode ? 'THR Recap' : '' })}
                                    scope={!thrMode ? getDivisionTypeLabel(divisionType) : ''}
                                    estate="Rebinmas"
                                    items={[{ label: 'Deskripsi', value: reportDivisionSummary }]}
                                    note="Total, subtotal, dan selisih mengikuti agregasi backend untuk periode dan scope yang sedang dicetak."
                                />
                            </div>

                            {/* KPI Cards */}
                            {thrMode ? (
                                <div className="wsp-kpi-grid">
                                    <div className="wsp-kpi-card" style={{ borderLeft: '4px solid #B45309' }}>
                                        <div className="wsp-kpi-label">Total Divisi</div>
                                        <div className="wsp-kpi-value">{thrData?.divisions?.length || 0}</div>
                                    </div>
                                    <div className="wsp-kpi-card" style={{ borderLeft: '4px solid #B45309' }}>
                                        <div className="wsp-kpi-label">Pekerja Full (12/12)</div>
                                        <div className="wsp-kpi-value">{formatNumber(thrData?.grand_total?.full_workers || 0)}</div>
                                    </div>
                                    <div className="wsp-kpi-card" style={{ borderLeft: '4px solid #B45309' }}>
                                        <div className="wsp-kpi-label">Pekerja Proporsi</div>
                                        <div className="wsp-kpi-value">{formatNumber(thrData?.grand_total?.prop_workers || 0)}</div>
                                    </div>
                                    <div className="wsp-kpi-card highlight" style={{ borderLeft: '4px solid #B45309' }}>
                                        <div className="wsp-kpi-label">Total THR</div>
                                        <div className="wsp-kpi-value">Rp {formatNumber(thrData?.grand_total?.total_thr || 0)}</div>
                                    </div>
                                </div>
                            ) : comparisonMode ? renderComparisonKPI() : (
                                <div className="wsp-kpi-grid">
                                    <div className="wsp-kpi-card">
                                        <div className="wsp-kpi-label">Total Gang</div>
                                        <div className="wsp-kpi-value">{formatNumber(kpiTotals.divisions)}</div>
                                    </div>
                                    <div className="wsp-kpi-card">
                                        <div className="wsp-kpi-label">Total Pekerja</div>
                                        <div className="wsp-kpi-value">{formatNumber(kpiTotals.workers)}</div>
                                    </div>
                                    <div className="wsp-kpi-card">
                                        <div className="wsp-kpi-label">Total HK Checkroll</div>
                                        <div className="wsp-kpi-value">{formatNumber(kpiTotals.hk)}</div>
                                    </div>
                                    <div className="wsp-kpi-card highlight">
                                        <div className="wsp-kpi-label">Total Upah Bersih</div>
                                        <div className="wsp-kpi-value">Rp {formatNumber(kpiTotals.netPay)}</div>
                                    </div>
                                </div>
                            )}
                            </PresentSlide>

                            <PresentSlide num="02" id="slide-02" title={thrMode ? 'Tabel Rekapitulasi THR' : (comparisonMode ? 'Tabel Perbandingan Upah' : 'Tabel Daftar Upah')} subtitle={thrMode ? 'Rincian manpower, tunjangan beras, masa kerja, dan total THR per divisi' : (comparisonMode ? 'Perbandingan komponen upah terhadap periode sebelumnya per divisi' : 'Rincian manpower, potongan, pendapatan, dan selisih thumb print per divisi')}>
                            {/* Data Table */}
                            {thrMode ? (
                                <div className="wsp-table-wrapper">
                                    <table className="wsp-table">
                                        <thead>
                                            {/* Master Header Level */}
                                            <tr className="wsp-header-master">
                                                <th rowSpan="2" className="th-sticky-col" style={{ minWidth: '300px', width: '300px' }}>ESTATE / DIVISI</th>
                                                <th colSpan="3" className="th-group-manpower">MANPOWER</th>
                                                <th colSpan="2" className="th-group-income">RINCIAN THR</th>
                                                <th rowSpan="2" className="th-group-income">TOTAL THR</th>
                                            </tr>
                                            {/* Sub Header Level */}
                                            <tr className="wsp-header-sub">
                                                <th className="th-group-manpower" style={{ minWidth: '80px' }}>WORKERS</th>
                                                <th className="th-group-manpower" style={{ minWidth: '80px' }}>FULL</th>
                                                <th className="th-group-manpower border-right-section" style={{ minWidth: '80px' }}>PROPORSI</th>

                                                <th className="th-group-income" style={{ minWidth: '140px' }}>TUNJ. BERAS</th>
                                                <th className="th-group-income border-right-section" style={{ minWidth: '140px' }}>MASA KERJA</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {thrData?.divisions?.map((div, idx) => (
                                                <tr key={idx}>
                                                    <td className="text-left">{div.division} {div.division !== div.gang_description ? `(${div.gang_description})` : ''}</td>
                                                    <td className={`text-right ${!Number(div.karyawan_count) && 'val-zero'}`}>{formatNumber(div.karyawan_count)}</td>
                                                    <td className={`text-right ${!Number(div.full_workers) && 'val-zero'}`}>{formatNumber(div.full_workers)}</td>
                                                    <td className={`text-right border-right-section ${!Number(div.prop_workers) && 'val-zero'}`}>{formatNumber(div.prop_workers)}</td>
                                                    <td className={`text-right ${!Number(div.total_tunjangan_beras) && 'val-zero'}`}>
                                                        {formatNumber(div.total_tunjangan_beras)}
                                                    </td>
                                                    <td className={`text-right border-right-section ${!Number(div.total_masa_kerja) && 'val-zero'}`}>
                                                        {formatNumber(div.total_masa_kerja)}
                                                    </td>
                                                    <td className={`text-right ${!Number(div.total_thr) ? 'val-zero' : 'val-positive'}`} style={{ fontWeight: 600 }}>
                                                        {formatNumber(div.total_thr)}
                                                    </td>
                                                </tr>
                                            ))}
                                            <tr className="wsp-grand-total">
                                                <td>GRAND TOTAL</td>
                                                <td className="text-right">{formatNumber(thrData?.grand_total?.total_employees || 0)}</td>
                                                <td className="text-right">{formatNumber(thrData?.grand_total?.full_workers || 0)}</td>
                                                <td className="text-right border-right-section">{formatNumber(thrData?.grand_total?.prop_workers || 0)}</td>
                                                <td className="text-right">
                                                    {formatNumber(thrData?.grand_total?.total_tunjangan_beras || 0)}
                                                </td>
                                                <td className="text-right border-right-section">
                                                    {formatNumber(thrData?.grand_total?.total_masa_kerja || 0)}
                                                </td>
                                                <td className="text-right" style={{ fontWeight: 700, color: '#16a34a' }}>
                                                    {formatNumber(thrData?.grand_total?.total_thr || 0)}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            ) : comparisonMode ? renderComparisonTable() : (
                                <div className="wsp-table-wrapper">
                                    <table className="wsp-table wages-rebinmas-summary-table">
                                        <colgroup>
                                            <col className="wages-col-division" />
                                            <col className="wages-col-workers" />
                                            <col className="wages-col-hk" />
                                            <col className="wages-col-pph" />
                                            <col className="wages-col-spsi" />
                                            <col className="wages-col-premi" />
                                            <col className="wages-col-lembur" />
                                            <col className="wages-col-netpay" />
                                            <col className="wages-col-thumbprint" />
                                            <col className="wages-col-diff" />
                                        </colgroup>
                                        <thead>
                                            {/* SCREEN VERSION of Summary Headers */}
                                            <tr className="wsp-header-master no-print report-screen-header">
                                                <th rowSpan="2" className="th-sticky-col th-gang-name" style={{ width: '25%' }}>ESTATE / DIVISI</th>
                                                <th colSpan="2" className="th-group-manpower">MANPOWER</th>
                                                <th colSpan="2" className="th-group-deductions">DEDUCTIONS / POTONGAN</th>
                                                <th colSpan="3" className="th-group-income">INCOME / PENDAPATAN</th>
                                                <th colSpan="2" className="th-group-compare">PERBANDINGAN</th>
                                            </tr>
                                            <tr className="wsp-header-sub no-print report-screen-header">
                                                <th className="th-group-manpower">WORKERS</th>
                                                <th className="th-group-manpower border-right-section">HK</th>
                                                <th className="th-group-deductions">PPH 21</th>
                                                <th className="th-group-deductions border-right-section">SPSI</th>
                                                <th className="th-group-income">TOTAL PREMI</th>
                                                <th className="th-group-income">LEMBUR</th>
                                                <th className="th-group-income border-right-section">UPAH BERSIH (Portal)</th>
                                                <th className="th-group-compare">THUMB PRINT</th>
                                                <th className="th-group-compare">SELISIH</th>
                                            </tr>

                                            {/* PRINT VERSION of Summary Headers */}
                                            <tr className="wsp-header-master print-only report-print-header">
                                                <th rowSpan="2" className="th-sticky-col th-gang-name" style={{ width: '25%' }}>ESTATE / DIVISI</th>
                                                <th colSpan="2" className="th-group-manpower">MANPOWER</th>
                                                <th colSpan="2" className="th-group-deductions">DEDUCTIONS / POTONGAN</th>
                                                <th colSpan="3" className="th-group-income">INCOME / PENDAPATAN</th>
                                                <th colSpan="2" className="th-group-compare">PERBANDINGAN</th>
                                            </tr>
                                            <tr className="wsp-header-sub print-only report-print-header">
                                                <th className="th-group-manpower">WORKERS</th>
                                                <th className="th-group-manpower border-right-section">HK</th>
                                                <th className="th-group-deductions">PPH 21</th>
                                                <th className="th-group-deductions border-right-section">SPSI</th>
                                                <th className="th-group-income">TOTAL PREMI</th>
                                                <th className="th-group-income">LEMBUR</th>
                                                <th className="th-group-income border-right-section">UPAH BERSIH (Portal)</th>
                                                <th className="th-group-compare">THUMB PRINT</th>
                                                <th className="th-group-compare">SELISIH</th>
                                            </tr>
                                        </thead>

                                        <tbody>
                                            {summaryData.length === 0 ? (
                                                <tr>
                                                    <td colSpan="10" style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                                                        <div>Tidak ada data tersedia untuk periode ini</div>
                                                    </td>
                                                </tr>
                                            ) : (
                                                <>
                                                    {Object.keys(groupedData).map(key =>
                                                        renderEstateGroup(key, groupedData[key])
                                                    )}
                                                </>
                                            )}
                                        </tbody>
                                        {calculatedGrandTotal && (
                                            <tfoot>
                                                <tr className="wsp-grand-total">
                                                    <td className="text-left sticky-col">GRAND TOTAL</td>
                                                    <td className="text-right">{formatNumber(calculatedGrandTotal.total_employees)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(calculatedGrandTotal.total_hk)}</td>
                                                    <td className="text-right">{formatNumber(calculatedGrandTotal.total_pph21)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(calculatedGrandTotal.total_spsi)}</td>
                                                    <td className="text-right">{formatNumber(calculatedGrandTotal.total_premi_excluding_special || calculatedGrandTotal.total_premi)}</td>
                                                    <td className="text-right">{formatNumber(calculatedGrandTotal.total_lembur)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(calculatedGrandTotal.total_manual)}</td>
                                                    <td className="text-right">{formatNumber(calculatedGrandTotal.thumb_print)}</td>
                                                    <td className={`text-center font-bold ${calculatedGrandTotal.selisih > 0 ? 'text-diff-neg' : calculatedGrandTotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                                        {formatNumber(calculatedGrandTotal.selisih)}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            )}
                            </PresentSlide>

                            <PresentSlide num="03" id="slide-03" title="Penutup & Pengesahan" subtitle="Papan penanda tangan dan keterangan cetak resmi laporan">
                            {/* Signature / Papan Penanda Tangan - visible on screen AND print */}
                            <div style={{
                                marginTop: '40px',
                                padding: '20px 24px',
                                background: '#F7F5EF',
                                border: '2px solid #E0DED2',
                                borderRadius: '12px',
                                boxShadow: '0 2px 8px rgba(21, 33, 26, 0.06)'
                            }} className="no-print">
                                <div style={{
                                    fontSize: '0.68rem',
                                    fontWeight: '800',
                                    color: '#1F6F43',
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    textAlign: 'center',
                                    marginBottom: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '10px'
                                }}>
                                    <span style={{ display: 'inline-block', width: '48px', height: '1px', background: '#E0DED2' }} />
                                    Papan Penanda Tangan
                                    <span style={{ display: 'inline-block', width: '48px', height: '1px', background: '#E0DED2' }} />
                                </div>
                                <PrintSignature />
                            </div>
                            {/* Print-only version */}
                            <div className="print-only" style={{ marginTop: '40px' }}>
                                <PrintSignature />
                            </div>

                            {/* Report Footer */}
                            <footer className="wsp-footer wages-report-footer" style={{ marginTop: '4rem' }}>
                                <div className="wsp-footer-left">
                                    <div>Dicetak: {printDate}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>User: {user?.username}</div>
                                </div>
                                <div className="wsp-footer-right">
                                    {isStandardWagesMode ? 'Halaman 1 dari 2' : 'PT. REBINMAS JAYA'}
                                </div>
                            </footer>
                            </PresentSlide>
                        </div>
                        {isStandardWagesMode && (
                            <PresentSlide num="04" id="slide-04" title="Lampiran Infografis" subtitle="Visualisasi ringkas komposisi upah dan potongan periode ini">
                                {renderInfographicAppendixPage()}
                            </PresentSlide>
                        )}
                        </div>
                        </>
                    )}
                </>
            )}

            {/* Present mode: lembar paper jadi panggung gelap, kartu & tabel tetap terang.
                Header slide hanya penanda storyboard di layar; tidak ikut cetak maupun PDF. */}
            <style dangerouslySetInnerHTML={{ __html: `
                html.present-mode .wsp-container { background: transparent !important; padding: 0 !important; }
                html.present-mode .report-header-web { display: none !important; }
                html.present-mode .wsp-document { background: transparent !important; box-shadow: none !important; border: none !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
                html.present-mode .wsp-letterhead { border-bottom-color: #223528 !important; }
                html.present-mode .wsp-company-name, html.present-mode .wsp-report-title { color: #F3F1E8 !important; }
                html.present-mode .wsp-report-subtitle { color: #93A596 !important; }
                html.present-mode .report-print-note { color: #93A596 !important; }
                html.present-mode .wsp-table-wrapper { background: #fff; border-radius: 10px; }
                html.present-mode .wsp-footer { color: #93A596 !important; }
                @media print {
                    #wsp-report-print-set .present-slide { margin: 0 !important; }
                    #wsp-report-print-set .present-slide-header { display: none !important; }
                }
                .pdf-export-active .present-slide { margin: 0 !important; }
                .pdf-export-active .present-slide-header { display: none !important; }
            `}} />
        </div>
    );
}






