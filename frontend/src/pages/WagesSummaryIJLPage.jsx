/**
 * WagesSummaryIJLPage - Monthly Wages Summary Report for PT. IMPIAN JAYA LESTARI
 * Isolated data for IJL Estate only.
 * Uses "Classic Professional" aesthetic.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MetricInfo, EmptyState } from '../components/report/reportTheme';
import { fetchAllDivisionsTotals, fetchAvailablePeriods, fetchComparisonSummary, fetchVirtualDivisions, updateSPSI, updateDivisionCell } from '../services/summaryReportService';
import { generatePDF } from '../utils/pdfGenerator';
import ImpactReportPage from './ImpactReportPage';
import PrintSignature from '../components/common/PrintSignature';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import { getDivisionTypeLabel, getReportModeLabel, getSourceModeLabel } from '../utils/reportPresentationLabels';
import { getReportDivisionSummary } from '../utils/divisionPresentation';
import { printReport } from '../utils/printPageSetup';
import PresentSlide from '../components/present/PresentSlide';
import PresentController from '../components/present/PresentController';
import usePresentMode from '../components/present/usePresentMode';
import '../styles/wages-summary-professional.css';
import '../styles/print-optimization.css';
import '../styles/report-print-foundation.css';

export default function WagesSummaryIJLPage({ onBack, initialMonth, initialYear }) {
    const { token, user } = useAuth();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // Present mode: deck fullscreen per slide (toggle html.present-mode + HUD)
    const { presenting, activeIndex, enter, exit } = usePresentMode();

    // Filters - Use initial props if provided
    const [month, setMonth] = useState(initialMonth || null);
    const [year, setYear] = useState(initialYear || null);
    const [divisionType, setDivisionType] = useState('all'); // 'all', 'real', or 'virtual'

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
    }, [initialMonth, initialYear]);

    // Data
    const [periods, setPeriods] = useState([]);
    const [summaryData, setSummaryData] = useState([]);
    const [grandTotal, setGrandTotal] = useState(null);
    const [groupSubtotals, setGroupSubtotals] = useState({});
    const [kpiTotalsData, setKpiTotalsData] = useState(null);
    const [virtualDivisions, setVirtualDivisions] = useState([]);

    // Comparison State - Initialize from URL param
    const [comparisonMode, setComparisonMode] = useState(searchParams.get('mode') === 'comparison');
    const [comparisonData, setComparisonData] = useState(null);
    const [comparisonGrandTotal, setComparisonGrandTotal] = useState(null);

    // Edit Mode State
    const [editMode, setEditMode] = useState(false);
    const [editingSPSI, setEditingSPSI] = useState({});
    const [editingUpahBersih, setEditingUpahBersih] = useState({});

    // Sync comparisonMode if URL search params change
    useEffect(() => {
        const mode = searchParams.get('mode');
        setComparisonMode(mode === 'comparison');
    }, [searchParams]);

    // Impact Report State
    const [impactReportMode, setImpactReportMode] = useState(false);

    // State
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // --- HELPERS (Defined early to be available) ---

    const formatNumber = (value, decimals = 0) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return '-';
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(num);
    };

    const getMonthName = (m) => {
        const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return months[m] || '';
    };

    // Render trend arrow helper
    const renderTrendArrow = (curr, prev, type = 'cost') => {
        const diff = (curr || 0) - (prev || 0);
        if (Math.abs(diff) < 0.01) return null;

        const isUp = diff > 0;
        let arrowClass = '';

        if (type === 'cost') {
            arrowClass = isUp ? 'trend-up' : 'trend-down';
        } else if (type === 'yield') {
            arrowClass = isUp ? 'trend-up-green' : 'trend-down-red';
        }

        return (
            <span className={`trend-indicator ${arrowClass}`}>
                {isUp ? '▲' : '▼'}
            </span>
        );
    };

    // --- DATA LOADING ---

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
    }, [token, initialMonth, initialYear]);

    const fetchData = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        setError('');

        try {
            if (comparisonMode) {
                const result = await fetchComparisonSummary(token, { month, year, scope: 'ijl', divisionType });
                if (result.success) {
                    setComparisonData(result);
                    setComparisonGrandTotal(result.grand_total || null);
                } else {
                    setError('Failed to fetch comparison data');
                }
            } else {
                const result = await fetchAllDivisionsTotals(token, { 
                    month, 
                    year,
                    includeVirtual: divisionType !== 'real', // 'all' or 'virtual' -> true
                    divisionType,
                    scope: 'ijl'
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
    }, [token, month, year, comparisonMode, divisionType]);

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

    // --- IJL DATA (scoped from backend) ---
    const ijlSummaryData = useMemo(() => {
        return summaryData.filter(d => !d.is_grand_total);
    }, [summaryData]);

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
            await fetchData();
        } catch (err) {
            console.error('Failed to save upah bersih:', err);
            alert('Failed to save upah bersih value');
        }
    };

    const ijlGrandTotal = grandTotal;
    const ijlComparisonData = comparisonData;

    // --- VIEW CALCULATIONS ---

    const periodLabel = `${getMonthName(month)} ${year}`;
    const printDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    const monthOptions = [
        { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' }, { value: 3, label: 'Maret' },
        { value: 4, label: 'April' }, { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
        { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' }, { value: 9, label: 'September' },
        { value: 10, label: 'Oktober' }, { value: 11, label: 'November' }, { value: 12, label: 'Desember' }
    ];

    const currentYear = new Date().getFullYear();
    const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

    // Grouping
    const groupedData = useMemo(() => {
        const groups = {};
        const regularData = ijlSummaryData.filter(d => !d.is_subtotal);

        regularData.forEach(div => {
            const prefix = 'I';
            if (!groups[prefix]) {
                groups[prefix] = { key: prefix, label: 'ESTATE IMPIAN JAYA LESTARI', divisions: [], subtotal: null };
            }
            groups[prefix].divisions.push(div);
        });

        if (groups['I']) {
            groups['I'].subtotal = groupSubtotals?.I?.totals || null;
        }
        return groups;
    }, [ijlSummaryData, groupSubtotals]);

    const reportDivisionSummary = useMemo(() => getReportDivisionSummary({
        divisionType,
        rows: comparisonMode ? comparisonData?.divisions : ijlSummaryData
    }), [comparisonData, comparisonMode, divisionType, ijlSummaryData]);

    const kpiTotals = useMemo(() => {
        return {
            divisions: Number(kpiTotalsData?.divisions || 0),
            workers: Number(kpiTotalsData?.workers ?? ijlGrandTotal?.total_employees ?? 0),
            hk: Number(kpiTotalsData?.hk ?? ijlGrandTotal?.total_hk ?? 0),
            netPay: Number(kpiTotalsData?.netPay ?? ijlGrandTotal?.total_manual ?? 0)
        };
    }, [kpiTotalsData, ijlGrandTotal]);

    // --- ACTIONS ---

    const handleSavePDF = () => {
        const element = document.getElementById('wsp-ijl-report-content');
        const filename = `Wages_Summary_IJL_${month}_${year}.pdf`;
        generatePDF(element, filename);
    };

    const handlePrint = () => {
        printReport({ orientation: 'landscape' });
    };

    const handleExport = () => {
        let csv = 'Division,Workers,HK Cekroll,PPH21,SPSI,Total Premi,Total Lembur,Total Upah Bersih\n';
        ijlSummaryData.forEach(row => {
            if (!row.is_grand_total && !row.is_subtotal) {
                csv += `"${row.description || ''}",${row.total_employees || 0},${row.total_hk || 0},${row.total_pph21 || 0},${row.total_spsi || 0},${row.total_premi || 0},${row.total_lembur || 0},${row.total_manual || 0}\n`;
            }
        });
        if (ijlGrandTotal) {
            csv += `"GRAND TOTAL",${ijlGrandTotal.total_employees || 0},${ijlGrandTotal.total_hk || 0},${ijlGrandTotal.total_pph21 || 0},${ijlGrandTotal.total_spsi || 0},${ijlGrandTotal.total_premi || 0},${ijlGrandTotal.total_lembur || 0},${ijlGrandTotal.total_manual || 0}\n`;
        }
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Summary_Wages_IJL_${month}_${year}.csv`;
        link.click();
    };

    // --- RENDERERS ---

    const renderComparisonKPI = () => {
        if (!ijlComparisonData || !ijlComparisonData.kpi_summary) return null;
        const { kpi_summary, previous_period, current_period } = ijlComparisonData;
        const prevLabel = `${getMonthName(previous_period?.month || 11)} ${previous_period?.year || year}`;
        const currLabel = `${getMonthName(current_period?.month || month)} ${current_period?.year || year}`;

        const estateDiff = (kpi_summary.estate_gaji?.current || 0) - (kpi_summary.estate_gaji?.previous || 0);
        const tbsDiff = (kpi_summary.tbs_weight?.current || 0) - (kpi_summary.tbs_weight?.previous || 0);

        return (
            <div className="wsp-kpi-grid comparison-grid">
                <div className="wsp-kpi-card comparison-card">
                    <div className="wsp-kpi-label">Total Gaji Estate (IJL)</div>
                    <div className="wsp-kpi-compare-row">
                        <div className="wsp-kpi-trend-box prev">
                            <div className="trend-label">{prevLabel}</div>
                            <div className="trend-value">Rp {formatNumber(kpi_summary.estate_gaji?.previous)}</div>
                        </div>
                        <div className="wsp-kpi-trend-box curr">
                            <div className="trend-label">{currLabel}</div>
                            <div className="trend-value">Rp {formatNumber(kpi_summary.estate_gaji?.current)}</div>
                        </div>
                    </div>
                    <div className={`wsp-kpi-diff ${estateDiff > 0 ? 'pos' : estateDiff < 0 ? 'neg' : 'neutral'}`}>
                        Δ Rp {formatNumber(estateDiff)} {estateDiff > 0 ? '▲' : estateDiff < 0 ? '▼' : ''}
                    </div>
                </div>
                <div className="wsp-kpi-card comparison-card">
                    <div className="wsp-kpi-label">Total TBS (Ton)</div>
                    <div className="wsp-kpi-compare-row">
                        <div className="wsp-kpi-trend-box prev">
                            <div className="trend-label">{prevLabel}</div>
                            <div className="trend-value">{formatNumber(kpi_summary.tbs_weight?.previous, 2)} Ton</div>
                        </div>
                        <div className="wsp-kpi-trend-box curr">
                            <div className="trend-label">{currLabel}</div>
                            <div className="trend-value">{formatNumber(kpi_summary.tbs_weight?.current, 2)} Ton</div>
                        </div>
                    </div>
                    <div className={`wsp-kpi-diff ${tbsDiff > 0 ? 'neg-invert' : tbsDiff < 0 ? 'pos-invert' : 'neutral'}`}>
                        Δ {formatNumber(tbsDiff, 2)} Ton {tbsDiff > 0 ? '▲' : tbsDiff < 0 ? '▼' : ''}
                    </div>
                </div>
            </div>
        );
    };

    const renderComparisonTable = () => {
        if (!ijlComparisonData || !ijlComparisonData.divisions) return null;
        const { divisions, previous_period, current_period } = ijlComparisonData;
        const prevMonthName = getMonthName(previous_period.month).toUpperCase();
        const currMonthName = getMonthName(current_period.month).toUpperCase();
        const grandTotal = comparisonGrandTotal || {};

        return (
            <div className="wsp-table-wrapper">
                <table className="wsp-table comparison-table">
                    <thead>
                        <tr className="wsp-header-master">
                            <th rowSpan="2" className="th-sticky-col">ESTATE/DIVISION</th>
                            <th colSpan="2" className="th-group-workers">WORKERS / PEKERJA</th>
                            <th colSpan="4" className="th-group-pph">BULAN {currMonthName} {current_period.year}<br /><small style={{ fontWeight: 400, opacity: 0.85 }}>(Uraian)</small></th>
                            <th colSpan="2" className="th-group-prev">{prevMonthName} {previous_period.year}</th>
                            <th colSpan="3" className="th-group-curr">{currMonthName} {current_period.year}</th>
                            <th rowSpan="2" className="th-group-diff">(Perubahan Gaji)</th>
                        </tr>
                        <tr className="wsp-header-sub">
                            <th className="th-group-workers">{prevMonthName.substring(0, 3)}</th>
                            <th className="th-group-workers">{currMonthName.substring(0, 3)}</th>
                            <th className="th-group-pph">POT SPSI</th>
                            <th className="th-group-pph">TOT PREMI</th>
                            <th className="th-group-pph">TOT LEMBUR</th>
                            <th className="th-group-pph">PPH21</th>
                            <th className="th-group-prev">GAJI</th>
                            <th className="th-group-prev">TBS (Ton)</th>
                            <th className="th-group-curr">GAJI</th>
                            <th className="th-group-curr">TBS (Ton)</th>
                            <th className="th-group-curr">THUMB PRINT</th>
                        </tr>
                    </thead>
                    <tbody>
                        {divisions.map((row, idx) => {
                            const currGaji = row.current_month?.gaji || 0;
                            const prevGaji = row.previous_month?.gaji || 0;
                            const calculatedSelisih = currGaji - prevGaji;
                            return (
                                <tr key={idx}>
                                    <td className="text-left division-name sticky-col">
                                        <div className="div-code">{row.division_code}</div>
                                        {row.description && row.description !== row.division_code && <div className="div-desc">{row.description}</div>}
                                    </td>
                                    <td className="text-right border-right-group">{formatNumber(row.workers_previous)}</td>
                                    <td className="text-right border-right-section">
                                        {formatNumber(row.workers_current)}
                                        {renderTrendArrow(row.workers_current, row.workers_previous, 'cost')}
                                    </td>
                                    <td className="text-right">{formatNumber(row.total_spsi_current)}</td>
                                    <td className="text-right">{formatNumber(row.total_premi_current)}</td>
                                    <td className="text-right">{formatNumber(row.total_lembur_current)}</td>
                                    <td className="text-right border-right-section">{formatNumber(row.total_pph21_current)}</td>
                                    <td className="text-right">{formatNumber(prevGaji)}</td>
                                    <td className="text-right border-right-section">{formatNumber(row.previous_month?.tbs_weight, 3)}</td>
                                    <td className="text-right font-semibold">
                                        {formatNumber(currGaji)}
                                        {renderTrendArrow(currGaji, prevGaji, 'cost')}
                                    </td>
                                    <td className="text-right">
                                        {formatNumber(row.current_month?.tbs_weight, 3)}
                                        {renderTrendArrow(row.current_month?.tbs_weight, row.previous_month?.tbs_weight, 'yield')}
                                    </td>
                                    <td className={`text-right font-semibold border-right-section ${Number(row.current_month?.thumb_print ?? 0) === 0 ? 'val-zero' : ''}`}>
                                        {formatNumber(row.current_month?.thumb_print ?? 0)}
                                    </td>
                                    <td className={`text-right font-semibold ${calculatedSelisih > 0 ? 'text-diff-neg' : calculatedSelisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                        <span style={{ marginRight: '6px' }}>
                                            {calculatedSelisih > 0 ? '▲' : calculatedSelisih < 0 ? '▼' : ''}
                                        </span>
                                        {formatNumber(calculatedSelisih)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="wsp-grand-total">
                            <td className="text-left sticky-col">GRAND TOTAL (IJL)</td>
                            <td className="text-right">{formatNumber(grandTotal.workers_previous)}</td>
                            <td className="text-right">{formatNumber(grandTotal.workers_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_spsi_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_premi_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_lembur_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_pph21_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.prev_gaji)}</td>
                            <td className="text-right">{formatNumber(grandTotal.prev_tbs, 3)}</td>
                            <td className="text-right">{formatNumber(grandTotal.curr_thumb_print ?? 0)}</td>
                            <td className="text-right">{formatNumber(grandTotal.curr_tbs, 3)}</td>
                            <td className="text-right">{formatNumber(grandTotal.curr_gaji)}</td>
                            <td className={`text-right font-bold ${grandTotal.selisih > 0 ? 'text-diff-neg' : grandTotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                <span style={{ marginRight: '6px' }}>{grandTotal.selisih > 0 ? '▲' : grandTotal.selisih < 0 ? '▼' : ''}</span>
                                {formatNumber(grandTotal.selisih)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    const renderEstateGroup = (groupKey, group) => {
        if (group.divisions.length === 0) return null;
        return (
            <React.Fragment key={groupKey}>
                <tr className="estate-header"><td colSpan="10">{group.label}</td></tr>
                {group.divisions.map((div, idx) => (
                    <tr key={`${groupKey}-${idx}`}>
                        <td className="text-left division-name sticky-col">
                            <div className="div-code">{div.division_code}</div>
                            {div.description && div.description !== div.division_code && (
                                <div className="div-desc" style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'normal' }}>
                                    {div.description}
                                </div>
                            )}
                        </td>
                        <td className={`text-right ${Number(div.total_employees) === 0 ? 'val-zero' : ''}`}>{formatNumber(div.total_employees)}</td>
                        <td className={`text-right border-right-section ${Number(div.total_hk) === 0 ? 'val-zero' : ''}`}>{formatNumber(div.total_hk)}</td>
                        <td className={`text-right ${Number(div.total_pph21) === 0 ? 'val-zero' : ''}`}>{formatNumber(div.total_pph21)}</td>
                        <td className={`text-right border-right-section ${Number(div.total_spsi) === 0 ? 'val-zero' : ''}`}>{formatNumber(div.total_spsi)}</td>
                        <td className={`text-right ${Number(div.total_premi) === 0 ? 'val-zero' : ''}`}>{formatNumber(div.total_premi)}</td>
                        <td className={`text-right ${Number(div.total_lembur) === 0 ? 'val-zero' : ''}`}>{formatNumber(div.total_lembur)}</td>
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
                        <td className={`text-right ${Number(div.thumb_print ?? 0) === 0 ? 'val-zero' : ''}`}>{formatNumber(div.thumb_print ?? 0)}</td>
                        <td className={`text-right font-semibold ${(div.selisih ?? 0) > 0 ? 'text-diff-neg' : (div.selisih ?? 0) < 0 ? 'text-diff-pos' : 'text-neutral'}`}>{formatNumber(div.selisih ?? 0)}</td>
                    </tr>
                ))}
                {group.subtotal && (
                    <tr className="subtotal">
                        <td className="text-left sticky-col">Sub Total {group.label}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_employees)}</td>
                        <td className="text-right border-right-section">{formatNumber(group.subtotal.total_hk)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_pph21)}</td>
                        <td className="text-right border-right-section">{formatNumber(group.subtotal.total_spsi)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_premi)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.total_lembur)}</td>
                        <td className="text-right border-right-section">{formatNumber(group.subtotal.total_manual)}</td>
                        <td className="text-right">{formatNumber(group.subtotal.thumb_print ?? 0)}</td>
                        <td className={`text-right font-semibold ${(group.subtotal.selisih ?? 0) > 0 ? 'text-diff-neg' : (group.subtotal.selisih ?? 0) < 0 ? 'text-diff-pos' : 'text-neutral'}`}>{formatNumber(group.subtotal.selisih ?? 0)}</td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    return (
        <div className="wsp-container" style={{ backgroundColor: '#EDF3EC', minHeight: '100vh' }}>
            {/* Web header */}
            <div className="no-print" style={{ marginBottom: 16 }}>
                <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#14532D' }}>Wages Summary (IJL) <MetricInfo metricKey="upah_bersih" /></h1>
                <p style={{ color: '#46584C', margin: '4px 0 8px', fontSize: '0.9rem' }}>Laporan rincian upah PT. Impian Jaya Lestari (IJL).</p>
                <button onClick={() => navigate(`/cost-per-ton-story?month=${month || ''}&year=${year || ''}`)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1F6F43', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cost/Ton Story →</button>
            </div>
            {/* Action Bar */}
            <div className="wsp-action-bar no-print">
                <div className="left-section">
                    {onBack && <button onClick={onBack} className="wsp-btn" title="Kembali ke Menu Utama">Kembali</button>}
                    <div className="wsp-filter-group" style={{ display: 'flex', gap: '0.5rem' }}>
                        {/* Division Type Selector (All/Real/Virtual) */}
                        <select 
                            value={divisionType} 
                            onChange={(e) => setDivisionType(e.target.value)} 
                            className="wsp-select"
                            style={{
                                backgroundColor: divisionType === 'virtual' ? '#fef3c7' : divisionType === 'real' ? '#eef2ff' : '#dcfce7',
                                color: divisionType === 'virtual' ? '#92400e' : divisionType === 'real' ? '#4f46e5' : '#166534',
                                borderColor: divisionType === 'virtual' ? '#fde68a' : divisionType === 'real' ? '#c7d2fe' : '#86efac',
                                fontWeight: 'bold'
                            }}
                        >
                            <option value="all">Semua Divisi</option>
                            <option value="real">Divisi Utama Saja</option>
                            <option value="virtual">Divisi Virtual Saja</option>
                        </select>
                        
                        <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className="wsp-select">
                            {monthOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                        <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="wsp-select" style={{ minWidth: '90px' }}>
                            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>
                <div className="right-section">
                    <button onClick={fetchData} className="wsp-btn" disabled={loading} title="Refresh Data">Refresh</button>
                    <button onClick={handlePrint} className="wsp-btn" title="Print this report">Print</button>
                    <button onClick={handleSavePDF} className="wsp-btn" title="Download Report as PDF">Save PDF</button>
                    <button onClick={handleExport} className="wsp-btn wsp-btn-primary" disabled={loading || ijlSummaryData.length === 0} title="Download CSV">Export CSV</button>
                    <button onClick={() => setComparisonMode(!comparisonMode)} className={`wsp-btn ${comparisonMode ? 'wsp-btn-primary' : ''}`} style={{ marginLeft: '0.5rem' }}>
                        {comparisonMode ? 'Report Mode' : 'Comparison Mode'}
                    </button>
                    <button onClick={() => setImpactReportMode(!impactReportMode)} className={`wsp-btn ${impactReportMode ? 'wsp-btn-primary' : ''}`} style={{ marginLeft: '0.5rem' }}>
                        {impactReportMode ? 'Back to Summary' : 'Impact Report'}
                    </button>
                    <button onClick={() => setEditMode(!editMode)} className={`wsp-btn ${editMode ? 'wsp-btn-primary' : ''}`} style={{ marginLeft: '0.5rem' }}>
                        {editMode ? 'Selesai Edit' : 'Edit Nilai'}
                    </button>
                </div>
            </div>

            {/* Render Logic */}
            {impactReportMode ? (
                <ImpactReportPage
                    onBack={() => setImpactReportMode(false)}
                    initialMonth={month}
                    initialYear={year}
                    initialEstateType="ijl"
                />
            ) : (
                <>
                    {loading ? (
                        <div className="wsp-loading"><div className="wsp-spinner"></div><div className="wsp-loading-text">Memuat Laporan IJL...</div></div>
                    ) : error ? (
                        <div className="wsp-error"><div className="wsp-error-title">Gagal Memuat Data</div><div className="wsp-error-message">{error}</div><button onClick={fetchData} className="wsp-btn" style={{ marginTop: '1rem' }}>Coba Lagi</button></div>
                    ) : (
                        <>
                        {/* PRESENT MODE - tombol Present (mode normal) + HUD deck (present mode) */}
                        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                            <PresentController
                                presenting={presenting}
                                activeIndex={activeIndex}
                                slideCount={3}
                                onEnter={enter}
                                onExit={exit}
                                caption={`Wages Summary IJL · ${periodLabel} · ${getDivisionTypeLabel(divisionType)}`}
                            />
                        </div>
                        <div className="wsp-document" id="wsp-ijl-report-content">
                            <ReportWatermark />
                            <PresentSlide num="01" id="slide-01" title="Konteks & Ringkasan" subtitle="Identitas laporan dan indikator utama periode berjalan">
                            <div className="wsp-letterhead">
                                <img src="/images/rebinmas.webp" alt="PT IMPIAN JAYA LESTARI" className="wsp-logo" />
                                <h1 className="wsp-company-name">PT. IMPIAN JAYA LESTARI</h1>
                                <div className="wsp-report-title">{comparisonMode ? 'Monthly Wages Comparison Report' : 'Monthly Wages Summary Report'}</div>
                                <div className="wsp-report-period">Periode: <strong style={{ color: '#0f172a' }}>{periodLabel}</strong></div>
                                <ReportPrintMetadata
                                    mode={getReportModeLabel({ comparisonMode })}
                                    source={getSourceModeLabel({ sourceMode: 'Summary API' })}
                                    scope={getDivisionTypeLabel(divisionType)}
                                    estate="IJL"
                                    items={[{ label: 'Deskripsi', value: reportDivisionSummary }]}
                                    note="Total, subtotal, dan selisih mengikuti agregasi backend untuk periode dan scope IJL yang sedang dicetak."
                                />
                            </div>

                            {comparisonMode ? renderComparisonKPI() : (
                                <div className="wsp-kpi-grid">
                                    <div className="wsp-kpi-card"><div className="wsp-kpi-label">Total Divisi</div><div className="wsp-kpi-value">{formatNumber(kpiTotals.divisions)}</div></div>
                                    <div className="wsp-kpi-card"><div className="wsp-kpi-label">Total Pekerja</div><div className="wsp-kpi-value">{formatNumber(kpiTotals.workers)}</div></div>
                                    <div className="wsp-kpi-card"><div className="wsp-kpi-label">Total HK Checkroll</div><div className="wsp-kpi-value">{formatNumber(kpiTotals.hk)}</div></div>
                                    <div className="wsp-kpi-card highlight"><div className="wsp-kpi-label">Total Upah Bersih</div><div className="wsp-kpi-value">Rp {formatNumber(kpiTotals.netPay)}</div></div>
                                </div>
                            )}
                            </PresentSlide>

                            <PresentSlide num="02" id="slide-02" title={comparisonMode ? 'Perbandingan Upah Antar Periode' : 'Rincian Upah per Divisi'} subtitle={comparisonMode ? 'Gaji, TBS, dan thumb print dibandingkan dengan periode sebelumnya' : 'Manpower, potongan, dan pendapatan seluruh divisi IJL'}>
                            {comparisonMode ? renderComparisonTable() : (
                                <div className="wsp-table-wrapper">
                                    <table className="wsp-table">
                                        <thead>
                                            <tr className="wsp-header-master">
                                                <th rowSpan="2" className="th-sticky-col">ESTATE / DIVISI</th>
                                                <th colSpan="2" className="th-group-manpower">MANPOWER</th>
                                                <th colSpan="2" className="th-group-deductions">DEDUCTIONS / POTONGAN</th>
                                                <th colSpan="3" className="th-group-income">INCOME / PENDAPATAN</th>
                                                <th colSpan="2" className="th-group-compare">PERBANDINGAN</th>
                                            </tr>
                                            <tr className="wsp-header-sub">
                                                <th className="th-group-manpower" style={{ minWidth: '80px' }}>WORKERS</th>
                                                <th className="th-group-manpower border-right-section" style={{ minWidth: '90px' }}>HK</th>
                                                <th className="th-group-deductions" style={{ minWidth: '110px' }}>PPH 21</th>
                                                <th className="th-group-deductions border-right-section" style={{ minWidth: '100px' }}>SPSI</th>
                                                <th className="th-group-income" style={{ minWidth: '120px' }}>TOTAL PREMI</th>
                                                <th className="th-group-income" style={{ minWidth: '120px' }}>LEMBUR</th>
                                                <th className="th-group-income border-right-section" style={{ minWidth: '130px' }}>UPAH BERSIH (Portal)</th>
                                                <th className="th-group-compare" style={{ minWidth: '130px' }}>THUMB PRINT</th>
                                                <th className="th-group-compare" style={{ minWidth: '120px' }}>SELISIH</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {ijlSummaryData.length === 0 ? (
                                                <tr><td colSpan="10" className="text-center" style={{ padding: '4rem' }}>Tidak ada data IJL</td></tr>
                                            ) : (
                                                Object.keys(groupedData).map(key => renderEstateGroup(key, groupedData[key]))
                                            )}
                                        </tbody>
                                        {ijlGrandTotal && (
                                            <tfoot>
                                                <tr className="wsp-grand-total">
                                                    <td className="text-left sticky-col">GRAND TOTAL (IJL)</td>
                                                    <td className="text-right">{formatNumber(ijlGrandTotal.total_employees)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(ijlGrandTotal.total_hk)}</td>
                                                    <td className="text-right">{formatNumber(ijlGrandTotal.total_pph21)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(ijlGrandTotal.total_spsi)}</td>
                                                    <td className="text-right">{formatNumber(ijlGrandTotal.total_premi)}</td>
                                                    <td className="text-right">{formatNumber(ijlGrandTotal.total_lembur)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(ijlGrandTotal.total_manual)}</td>
                                                    <td className={`text-right ${Number(ijlGrandTotal.thumb_print ?? 0) === 0 ? 'val-zero' : ''}`}>{formatNumber(ijlGrandTotal.thumb_print ?? 0)}</td>
                                                    <td className={`text-right font-bold ${(ijlGrandTotal.selisih ?? 0) > 0 ? 'text-diff-neg' : (ijlGrandTotal.selisih ?? 0) < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                                        {formatNumber(ijlGrandTotal.selisih ?? 0)}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            )}
                            </PresentSlide>

                            <PresentSlide num="03" id="slide-03" title="Catatan & Penutup" subtitle="Pengesahan dan informasi cetak laporan">
                            <div className="print-only">
                                <PrintSignature />
                            </div>

                            <footer className="wsp-footer">
                                <div className="wsp-footer-left"><div>Dicetak: {printDate}</div><div>User: {user?.username}</div></div>
                                <div className="wsp-footer-right">PT. IMPIAN JAYA LESTARI</div>
                            </footer>
                            </PresentSlide>
                        </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
