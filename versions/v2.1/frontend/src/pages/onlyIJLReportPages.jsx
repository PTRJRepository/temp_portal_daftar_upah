/**
 * WagesSummaryRebinmasPage - Professional Wages Summary Report
 * Premium financial statement layout for PT. REBINMAS JAYA
 * No AG-Grid - uses custom HTML/CSS for print-ready output
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAllDivisionsTotals, fetchAvailablePeriods, fetchComparisonSummary } from '../services/summaryReportService';
import ImpactReportPage from './ImpactReportPage';
import { printReport } from '../utils/printPageSetup';
import '../styles/wages-summary-professional.css';

export default function WagesSummaryRebinmasPage({ onBack }) {
    const { token, user } = useAuth();

    // Filters - Default to current month
    const [month, setMonth] = useState(new Date().getMonth() + 1);
    const [year, setYear] = useState(new Date().getFullYear());

    // Data
    const [periods, setPeriods] = useState([]);
    const [summaryData, setSummaryData] = useState([]);
    const [grandTotal, setGrandTotal] = useState(null);

    // Comparison State
    const [comparisonMode, setComparisonMode] = useState(false);
    const [comparisonData, setComparisonData] = useState(null);

    // Impact Report State
    const [impactReportMode, setImpactReportMode] = useState(false);

    // State
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
    }, [token]);

    // Fetch summary data
    const fetchData = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        setError('');

        try {
            if (comparisonMode) {
                const result = await fetchComparisonSummary(token, { month, year });
                if (result.success) {
                    setComparisonData(result);
                } else {
                    setError('Failed to fetch comparison data');
                }
            } else {
                const result = await fetchAllDivisionsTotals(token, { month, year });
                if (result.success) {
                    setSummaryData(result.data || []);
                    setGrandTotal(result.grand_total || null);
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
    }, [token, month, year, comparisonMode]);

    // Fetch data when filters change
    useEffect(() => {
        fetchData();
    }, [fetchData]);

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

    // Group data by estate prefix - DYNAMIC to include ALL divisions
    const groupedData = useMemo(() => {
        // Label mapping for known estate prefixes
        const LABEL_MAP = {
            'I': 'DIVISI INFRASTRUKTUR',
            'M': 'OPERASI MILL',
        };


        const groups = {};

        // Filter regular vs subtotal
        const regularData = summaryData.filter(d => !d.is_subtotal && !d.is_grand_total);
        const subtotals = summaryData.filter(d => d.is_subtotal);

        // Group ALL divisions dynamically by first character
        regularData.forEach(div => {
            const desc = div.description || '';
            const prefix = desc.charAt(0).toUpperCase();

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

        // Match subtotals to groups
        subtotals.forEach(st => {
            const desc = (st.description || '').toUpperCase();
            Object.keys(groups).forEach(key => {
                const labelWords = groups[key].label.replace('ESTATE ', '').split(' ');
                const match = labelWords.some(w => w.length > 2 && desc.includes(w));
                if (match) {
                    groups[key].subtotal = st;
                }
            });
        });

        // Convert to array and sort (P, A, D first, then others alphabetically)
        const sortOrder = ['P', 'A', 'D', 'I', 'L', 'N', 'W', 'T', 'K', 'S', 'M'];
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
    }, [summaryData]);

    // Calculate KPI totals
    const kpiTotals = useMemo(() => {
        const divisionCount = summaryData.filter(d => !d.is_subtotal && !d.is_grand_total).length;
        return {
            divisions: divisionCount,
            workers: grandTotal?.total_employees || 0,
            hk: grandTotal?.total_hk || 0,
            netPay: grandTotal?.total_manual || 0
        };
    }, [summaryData, grandTotal]);

    // Render Comparison KPI Cards
    const renderComparisonKPI = () => {
        if (!comparisonData || !comparisonData.kpi_summary) return null;
        const { kpi_summary, previous_period, current_period } = comparisonData;
        const prevLabel = `${getMonthName(previous_period?.month || 11)} ${previous_period?.year || year}`;
        const currLabel = `${getMonthName(current_period?.month || month)} ${current_period?.year || year}`;

        const estateDiff = (kpi_summary.estate_gaji?.current || 0) - (kpi_summary.estate_gaji?.previous || 0);
        const millDiff = (kpi_summary.mill_gaji?.current || 0) - (kpi_summary.mill_gaji?.previous || 0);
        const tbsDiff = (kpi_summary.tbs_weight?.current || 0) - (kpi_summary.tbs_weight?.previous || 0);

        return (
            <div className="wsp-kpi-grid comparison-grid">
                {/* Estate Gaji Card */}
                <div className="wsp-kpi-card comparison-card">
                    <div className="wsp-kpi-label">Total Gaji Estate (Excl. Mill)</div>
                    <div className="wsp-kpi-compare-row">
                        <div className="wsp-kpi-trend-box prev">
                            <div className="trend-label">{prevLabel}</div>
                            <div className="trend-value">
                                Rp {formatNumber(kpi_summary.estate_gaji?.previous)}
                            </div>
                        </div>
                        <div className="wsp-kpi-trend-box curr">
                            <div className="trend-label">{currLabel}</div>
                            <div className="trend-value">
                                Rp {formatNumber(kpi_summary.estate_gaji?.current)}
                            </div>
                        </div>
                    </div>
                    <div className={`wsp-kpi-diff ${estateDiff > 0 ? 'pos' : estateDiff < 0 ? 'neg' : 'neutral'}`}>
                        Δ Rp {formatNumber(estateDiff)} {estateDiff > 0 ? '▲' : estateDiff < 0 ? '▼' : ''}
                    </div>
                </div>

                {/* Mill Gaji Card */}
                <div className="wsp-kpi-card comparison-card">
                    <div className="wsp-kpi-label">Total Gaji Mill PKS</div>
                    <div className="wsp-kpi-compare-row">
                        <div className="wsp-kpi-trend-box prev">
                            <div className="trend-label">{prevLabel}</div>
                            <div className="trend-value">
                                Rp {formatNumber(kpi_summary.mill_gaji?.previous)}
                            </div>
                        </div>
                        <div className="wsp-kpi-trend-box curr">
                            <div className="trend-label">{currLabel}</div>
                            <div className="trend-value">
                                Rp {formatNumber(kpi_summary.mill_gaji?.current)}
                            </div>
                        </div>
                    </div>
                    <div className={`wsp-kpi-diff ${millDiff > 0 ? 'pos' : millDiff < 0 ? 'neg' : 'neutral'}`}>
                        Δ Rp {formatNumber(millDiff)} {millDiff > 0 ? '▲' : millDiff < 0 ? '▼' : ''}
                    </div>
                </div>

                {/* TBS Weight Card */}
                <div className="wsp-kpi-card comparison-card">
                    <div className="wsp-kpi-label">Total TBS (Ton)</div>
                    <div className="wsp-kpi-compare-row">
                        <div className="wsp-kpi-trend-box prev">
                            <div className="trend-label">{prevLabel}</div>
                            <div className="trend-value">
                                {formatNumber(kpi_summary.tbs_weight?.previous, 2)} Ton
                            </div>
                        </div>
                        <div className="wsp-kpi-trend-box curr">
                            <div className="trend-label">{currLabel}</div>
                            <div className="trend-value">
                                {formatNumber(kpi_summary.tbs_weight?.current, 2)} Ton
                            </div>
                        </div>
                    </div>
                    <div className={`wsp-kpi-diff ${tbsDiff > 0 ? 'neg-invert' : tbsDiff < 0 ? 'pos-invert' : 'neutral'}`}>
                        Δ {formatNumber(tbsDiff, 2)} Ton {tbsDiff > 0 ? '▲' : tbsDiff < 0 ? '▼' : ''}
                    </div>
                </div>
            </div>
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
                {isUp ? '▲' : '▼'}
            </span>
        );
    };

    // Render comparison table
    const renderComparisonTable = () => {
        if (!comparisonData || !comparisonData.divisions) return null;

        const { divisions, previous_period, current_period } = comparisonData;
        const prevMonthName = getMonthName(previous_period.month).toUpperCase();
        const currMonthName = getMonthName(current_period.month).toUpperCase();

        // Calculate grand totals
        const grandTotal = {
            workers_previous: divisions.reduce((sum, d) => sum + (d.workers_previous || 0), 0),
            workers_current: divisions.reduce((sum, d) => sum + (d.workers_current || 0), 0),
            total_pph21_current: divisions.reduce((sum, d) => sum + (d.total_pph21_current || 0), 0),
            total_spsi_current: divisions.reduce((sum, d) => sum + (d.total_spsi_current || 0), 0),
            total_premi_current: divisions.reduce((sum, d) => sum + (d.total_premi_current || 0), 0),
            total_lembur_current: divisions.reduce((sum, d) => sum + (d.total_lembur_current || 0), 0),
            prev_gaji: divisions.reduce((sum, d) => sum + (d.previous_month?.gaji || 0), 0),
            prev_tbs: divisions.reduce((sum, d) => sum + (d.previous_month?.tbs_weight || 0), 0),
            curr_gaji: divisions.reduce((sum, d) => sum + (d.current_month?.gaji || 0), 0),
            curr_tbs: divisions.reduce((sum, d) => sum + (d.current_month?.tbs_weight || 0), 0),
            selisih: divisions.reduce((sum, d) => sum + (d.selisih || 0), 0)
        };

        return (
            <div className="wsp-table-wrapper">
                <table className="wsp-table comparison-table">
                    <thead>
                        {/* Master Header */}
                        <tr className="wsp-header-master">
                            <th rowSpan="2" className="th-sticky-col">ESTATE/DIVISION</th>
                            <th colSpan="2" className="th-group-workers">WORKERS / PEKERJA</th>
                            <th colSpan="4" className="th-group-pph">TOTAL PPH 21<br /><small>(MASA {currMonthName} {current_period.year})</small></th>
                            <th colSpan="2" className="th-group-prev">{prevMonthName} {previous_period.year}</th>
                            <th colSpan="3" className="th-group-curr">{currMonthName} {current_period.year}</th>
                            <th rowSpan="2" className="th-group-diff">(Perubahan Gaji)</th>
                        </tr>
                        {/* Sub Header */}
                        <tr className="wsp-header-sub">
                            {/* Workers */}
                            <th className="th-group-workers">{prevMonthName.substring(0, 3)}</th>
                            <th className="th-group-workers">{currMonthName.substring(0, 3)}</th>

                            {/* Current Month Details */}
                            <th className="th-group-pph">POT SPSI</th>
                            <th className="th-group-pph">TOT PREMI</th>
                            <th className="th-group-pph">TOT LEMBUR</th>
                            <th className="th-group-pph">PPH21</th>

                            {/* Previous Month Totals */}
                            <th className="th-group-prev">GAJI</th>
                            <th className="th-group-prev">TBS (Ton)</th>

                            {/* Current Month Totals */}
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
                                    {/* Division: separate code and desc */}
                                    <td className="text-left division-name sticky-col">
                                        <div className="div-code">{row.division_code}</div>
                                        {row.description && row.description !== row.division_code && (
                                            <div className="div-desc">
                                                {row.description}
                                            </div>
                                        )}
                                    </td>

                                    {/* Workers */}
                                    <td className="text-right border-right-group">{formatNumber(row.workers_previous)}</td>
                                    <td className="text-right border-right-section">
                                        {formatNumber(row.workers_current)}
                                        {renderTrendArrow(row.workers_current, row.workers_previous, 'cost')}
                                    </td>

                                    {/* Current Details */}
                                    <td className="text-right">{formatNumber(row.total_spsi_current)}</td>
                                    <td className="text-right">{formatNumber(row.total_premi_current)}</td>
                                    <td className="text-right">{formatNumber(row.total_lembur_current)}</td>
                                    <td className="text-right border-right-section">{formatNumber(row.total_pph21_current)}</td>

                                    {/* Previous Month */}
                                    <td className="text-right">{formatNumber(prevGaji)}</td>
                                    <td className="text-right border-right-section">{formatNumber(row.previous_month?.tbs_weight, 3)}</td>

                                    {/* Current Month */}
                                    <td className="text-right font-semibold">
                                        {formatNumber(currGaji)}
                                        {renderTrendArrow(currGaji, prevGaji, 'cost')}
                                    </td>
                                    <td className="text-right">
                                        {formatNumber(row.current_month?.tbs_weight, 3)}
                                        {renderTrendArrow(row.current_month?.tbs_weight, row.previous_month?.tbs_weight, 'yield')}
                                    </td>
                                    <td className="text-right font-semibold border-right-section">{formatNumber(currGaji)}</td>

                                    {/* SELISIH - calculated gaji difference */}
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
                            <td className="text-left sticky-col">SUB TOTAL</td>
                            <td className="text-right">{formatNumber(grandTotal.workers_previous)}</td>
                            <td className="text-right">{formatNumber(grandTotal.workers_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_spsi_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_premi_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_lembur_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.total_pph21_current)}</td>
                            <td className="text-right">{formatNumber(grandTotal.prev_gaji)}</td>
                            <td className="text-right">{formatNumber(grandTotal.prev_tbs, 3)}</td>
                            <td className="text-right">{formatNumber(grandTotal.curr_gaji)}</td>
                            <td className="text-right">{formatNumber(grandTotal.curr_tbs, 3)}</td>
                            <td className="text-right">{formatNumber(grandTotal.curr_gaji)}</td>
                            <td className={`text-right font-bold ${grandTotal.selisih > 0 ? 'text-diff-neg' : grandTotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                <span style={{ marginRight: '6px' }}>
                                    {grandTotal.selisih > 0 ? '▲' : grandTotal.selisih < 0 ? '▼' : ''}
                                </span>
                                {formatNumber(grandTotal.selisih)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    // Handle print
    const handlePrint = () => {
        printReport({ orientation: 'landscape' });
    };

    // Handle export CSV
    const handleExport = () => {
        let csv = 'Division,Workers,HK Cekroll,PPH21,SPSI,Total Premi,Total Lembur,Total Upah Bersih\n';

        summaryData.forEach(row => {
            if (!row.is_grand_total) {
                csv += `"${row.description || ''}",${row.total_employees || 0},${row.total_hk || 0},${row.total_pph21 || 0},${row.total_spsi || 0},${row.total_premi || 0},${row.total_lembur || 0},${row.total_manual || 0}\n`;
            }
        });

        if (grandTotal) {
            csv += `"GRAND TOTAL",${grandTotal.total_employees || 0},${grandTotal.total_hk || 0},${grandTotal.total_pph21 || 0},${grandTotal.total_spsi || 0},${grandTotal.total_premi || 0},${grandTotal.total_lembur || 0},${grandTotal.total_manual || 0}\n`;
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Summary_Wages_Rebinmas_${month}_${year}.csv`;
        link.click();
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
                            <div className="div-code">{div.description}</div>
                            {/* Assuming description is the code for now, or if there's a separate desc logic */}
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
                            {formatNumber(div.total_spsi)}
                        </td>
                        {/* Premi Column */}
                        <td className={`text-right ${Number(div.total_premi) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.total_premi)}
                        </td>
                        {/* Lembur */}
                        <td className={`text-right ${Number(div.total_lembur) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.total_lembur)}
                        </td>
                        {/* Portal (Net Pay) */}
                        <td className={`text-right border-right-section ${Number(div.total_manual) === 0 ? 'val-zero' : 'val-positive'}`}>
                            {formatNumber(div.total_manual)}
                        </td>
                        {/* Thumb Print */}
                        <td className={`text-right ${Number(div.thumb_print) === 0 ? 'val-zero' : ''}`}>
                            {formatNumber(div.thumb_print)}
                        </td>
                        {/* Selisih */}
                        <td className={`text-right font-semibold ${div.selisih > 0 ? 'text-diff-neg' : div.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                            {formatNumber(div.selisih)}
                        </td>
                    </tr>
                ))}

                {/* Subtotal Row */}
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
                        <td className="text-right">{formatNumber(group.subtotal.thumb_print || 0)}</td>
                        <td className={`text-right font-semibold ${group.subtotal.selisih > 0 ? 'text-diff-neg' : group.subtotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                            {formatNumber(group.subtotal.selisih || 0)}
                        </td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    return (
        <div className="wsp-container">
            {/* Action Bar */}
            <div className="wsp-action-bar no-print">
                <div className="left-section">
                    {onBack && (
                        <button onClick={onBack} className="wsp-btn" title="Kembali ke Menu Utama">
                            Kembali
                        </button>
                    )}

                    <div className="wsp-filter-group" style={{ display: 'flex', gap: '0.5rem' }}>
                        <select
                            value={month}
                            onChange={(e) => setMonth(parseInt(e.target.value))}
                            className="wsp-select"
                        >
                            {monthOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>

                        <select
                            value={year}
                            onChange={(e) => setYear(parseInt(e.target.value))}
                            className="wsp-select"
                            style={{ minWidth: '90px' }}
                        >
                            {yearOptions.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="right-section">
                    <button
                        onClick={fetchData}
                        className="wsp-btn"
                        disabled={loading}
                        title="Refresh Data"
                    >
                        Refresh
                    </button>
                    <button onClick={handlePrint} className="wsp-btn" title="Print this report">
                        Print
                    </button>
                    <button
                        onClick={handleExport}
                        className="wsp-btn wsp-btn-primary"
                        disabled={loading || (!comparisonMode && summaryData.length === 0)}
                        title="Download as CSV"
                    >
                        Export CSV
                    </button>
                    <button
                        onClick={() => setComparisonMode(!comparisonMode)}
                        className={`wsp-btn ${comparisonMode ? 'wsp-btn-primary' : ''}`}
                        title="Toggle Comparison Mode"
                        style={{ marginLeft: '0.5rem' }}
                        disabled={impactReportMode}
                    >
                        {comparisonMode ? 'Report Mode' : 'Comparison Mode'}
                    </button>
                    <button
                        onClick={() => setImpactReportMode(!impactReportMode)}
                        className={`wsp-btn ${impactReportMode ? 'wsp-btn-primary' : ''}`}
                        title="Toggle Impact Report Mode"
                        style={{ marginLeft: '0.5rem' }}
                    >
                        {impactReportMode ? 'Back to Summary' : 'Impact Report'}
                    </button>
                </div>
            </div>

            {/* Impact Report Mode - Render Full Page */}
            {impactReportMode ? (
                <ImpactReportPage onBack={() => setImpactReportMode(false)} />
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
                        /* Paper Document */
                        <div className="wsp-document">
                            {/* Letterhead */}
                            <div className="wsp-letterhead">
                                <img src="/images/rebinmas.webp" alt="PT REBINMAS JAYA" className="wsp-logo" />
                                <h1 className="wsp-company-name">PT. REBINMAS JAYA</h1>
                                <div className="wsp-report-title">
                                    {comparisonMode ? 'Monthly Wages Comparison Report' : 'Monthly Wages Summary Report'}
                                </div>
                                <div className="wsp-report-period">Periode: <strong style={{ color: '#0f172a' }}>{periodLabel}</strong></div>
                            </div>

                            {/* KPI Cards */}
                            {comparisonMode ? renderComparisonKPI() : (
                                <div className="wsp-kpi-grid">
                                    <div className="wsp-kpi-card">
                                        <div className="wsp-kpi-label">Total Divisi</div>
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

                            {/* Data Table */}
                            {comparisonMode ? renderComparisonTable() : (
                                <div className="wsp-table-wrapper">
                                    <table className="wsp-table">
                                        <thead>
                                            {/* Master Header Level */}
                                            <tr className="wsp-header-master">
                                                <th rowSpan="2" className="th-sticky-col">ESTATE / DIVISI</th>
                                                <th colSpan="2" className="th-group-manpower">MANPOWER</th>
                                                <th colSpan="2" className="th-group-deductions">DEDUCTIONS / POTONGAN</th>
                                                <th colSpan="3" className="th-group-income">INCOME / PENDAPATAN</th>
                                                <th colSpan="2" className="th-group-compare">PERBANDINGAN</th>
                                            </tr>
                                            {/* Sub Header Level */}
                                            <tr className="wsp-header-sub">
                                                <th className="th-group-manpower" style={{ minWidth: '80px' }}>WORKERS</th>
                                                <th className="th-group-manpower border-right-section" style={{ minWidth: '90px' }}>HK</th>

                                                {/* Deductions Group */}
                                                <th className="th-group-deductions" style={{ minWidth: '110px' }}>PPH 21</th>
                                                <th className="th-group-deductions border-right-section" style={{ minWidth: '100px' }}>SPSI</th>

                                                {/* Income Group */}
                                                <th className="th-group-income" style={{ minWidth: '120px' }}>TOTAL PREMI</th>
                                                <th className="th-group-income" style={{ minWidth: '120px' }}>LEMBUR</th>
                                                <th className="th-group-income border-right-section" style={{ minWidth: '130px' }}>UPAH BERSIH (Portal)</th>

                                                {/* Comparison Group */}
                                                <th className="th-group-compare" style={{ minWidth: '130px' }}>THUMB PRINT</th>
                                                <th className="th-group-compare" style={{ minWidth: '120px' }}>SELISIH</th>
                                            </tr>
                                        </thead>

                                        <tbody>
                                            {summaryData.length === 0 ? (
                                                <tr>
                                                    <td colSpan="10" style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                                                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
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
                                        {grandTotal && (
                                            <tfoot>
                                                <tr className="wsp-grand-total">
                                                    <td className="text-left sticky-col">GRAND TOTAL</td>
                                                    <td className="text-right">{formatNumber(grandTotal.total_employees)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(grandTotal.total_hk)}</td>
                                                    <td className="text-right">{formatNumber(grandTotal.total_pph21)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(grandTotal.total_spsi)}</td>
                                                    <td className="text-right">{formatNumber(grandTotal.total_premi)}</td>
                                                    <td className="text-right">{formatNumber(grandTotal.total_lembur)}</td>
                                                    <td className="text-right border-right-section">{formatNumber(grandTotal.total_manual)}</td>
                                                    <td className="text-right">{formatNumber(grandTotal.thumb_print)}</td>
                                                    <td className={`text-right font-bold ${grandTotal.selisih > 0 ? 'text-diff-neg' : grandTotal.selisih < 0 ? 'text-diff-pos' : 'text-neutral'}`}>
                                                        {formatNumber(grandTotal.selisih)}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            )}

                            {/* Signature Section */}
                            <div className="wsp-signature-section">
                                <div className="wsp-signature-block">
                                    <div className="wsp-signature-title">DIBUAT OLEH :</div>
                                    <div className="wsp-signature-name">( ........................................ )</div>
                                    <div className="wsp-signature-role">Admin Payroll</div>
                                </div>
                                <div className="wsp-signature-block">
                                    <div className="wsp-signature-title">DIPERIKSA OLEH :</div>
                                    <div className="wsp-signature-name">( ........................................ )</div>
                                    <div className="wsp-signature-role">HR Manager</div>
                                </div>
                                <div className="wsp-signature-block">
                                    <div className="wsp-signature-title">DIKETAHUI OLEH :</div>
                                    <div className="wsp-signature-name">( ........................................ )</div>
                                    <div className="wsp-signature-role">Senior Manager</div>
                                </div>
                                <div className="wsp-signature-block">
                                    <div className="wsp-signature-title">DISETUJUI OLEH :</div>
                                    <div className="wsp-signature-name">( ........................................ )</div>
                                    <div className="wsp-signature-role">General Manager</div>
                                </div>
                            </div>

                            {/* Report Footer */}
                            <footer className="wsp-footer" style={{ marginTop: '4rem' }}>
                                <div className="wsp-footer-left">
                                    <div>Dicetak: {printDate}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>User: {user?.username}</div>
                                </div>
                                <div className="wsp-footer-right">
                                    PT. REBINMAS JAYA
                                </div>
                            </footer>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
