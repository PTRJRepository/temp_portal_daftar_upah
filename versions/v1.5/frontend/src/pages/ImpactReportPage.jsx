/**
 * ImpactReportPage - Comprehensive Impact Report with 3-table layout
 * Refactored to use "Classic Professional" aesthetic (wsp-*)
 * Supports filtering by estate type: All, Non-IJL, IJL Only
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchImpactReport, fetchAvailablePeriods, updateLuasArea } from '../services/summaryReportService';
import PrintSignature from '../components/common/PrintSignature';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import { getSourceModeLabel } from '../utils/reportPresentationLabels';
import { printReport } from '../utils/printPageSetup';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';

export default function ImpactReportPage({ onBack, initialMonth, initialYear, initialEstateType = 'non-ijl' }) {
    const { token, user } = useAuth();

    // Filters
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());
    const [estateType, setEstateType] = useState(initialEstateType); // 'all', 'non-ijl', 'ijl'

    // Data
    const [reportData, setReportData] = useState(null);
    const [periods, setPeriods] = useState([]);

    // Edit Mode State
    const [editMode, setEditMode] = useState(false);
    const [editingLuasArea, setEditingLuasArea] = useState({});

    // State
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
        if (initialEstateType) setEstateType(initialEstateType);
    }, [initialMonth, initialYear, initialEstateType]);

    // Helper function to check if division is IJL
    const isIJLDivision = (divisionCode, estate) => {
        const code = (divisionCode || '').toUpperCase();
        const desc = (estate || '').toUpperCase();

        // Check if code starts with 'I' followed by a digit (I1, I2, I1A, etc.)
        const ijlCodePattern = /^I\d/;
        if (ijlCodePattern.test(code)) return true;

        // Check description for IJL indicators
        if (desc.includes('IMPIAN JAYA LESTARI') || desc.includes('IJL')) return true;
        if (code === 'IJL') return true;

        return false;
    };

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

    // Fetch impact report data
    const fetchData = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        setError('');

        try {
            const result = await fetchImpactReport(token, { month, year });
            if (result.success) {
                setReportData(result);
            } else {
                setError('Failed to fetch impact report data');
            }
        } catch (e) {
            console.error('Error fetching impact report:', e);
            setError(e.message || 'Failed to fetch impact report data');
        } finally {
            setLoading(false);
        }
    }, [token, month, year]);

    // Fetch data when filters change
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Filter data based on estate type
    const filteredData = useMemo(() => {
        if (!reportData) return null;

        // If showing all, return original data
        if (estateType === 'all') return reportData;

        // Filter main_table
        const filteredMainTable = reportData.main_table?.filter(row => {
            const isIJL = isIJLDivision(row.division_code, row.estate);
            return estateType === 'ijl' ? isIJL : !isIJL;
        }) || [];

        // Filter pruning_table
        const filteredPruningTable = reportData.pruning_table?.filter(row => {
            const isIJL = isIJLDivision(row.division_code, row.estate);
            return estateType === 'ijl' ? isIJL : !isIJL;
        }) || [];

        // Recalculate totals for main_table
        const mainTableTotals = {
            estate: "TOTAL",
            division_code: "",
            luas_ha: filteredMainTable.reduce((sum, r) => sum + (r.luas_ha || 0), 0),
            workers_prev: filteredMainTable.reduce((sum, r) => sum + (r.workers_prev || 0), 0),
            workers_curr: filteredMainTable.reduce((sum, r) => sum + (r.workers_curr || 0), 0),
            workers_diff: filteredMainTable.reduce((sum, r) => sum + (r.workers_diff || 0), 0),
            gaji_prev: filteredMainTable.reduce((sum, r) => sum + (r.gaji_prev || 0), 0),
            gaji_curr: filteredMainTable.reduce((sum, r) => sum + (r.gaji_curr || 0), 0),
            gaji_diff: filteredMainTable.reduce((sum, r) => sum + (r.gaji_diff || 0), 0),
            tbs_prev: filteredMainTable.reduce((sum, r) => sum + (r.tbs_prev || 0), 0),
            tbs_curr: filteredMainTable.reduce((sum, r) => sum + (r.tbs_curr || 0), 0),
            tbs_diff: filteredMainTable.reduce((sum, r) => sum + (r.tbs_diff || 0), 0),
            pct_gaji_naik_turun: 0,
            pct_tbs_diff: 0
        };

        // Calculate percentages
        if (mainTableTotals.gaji_prev > 0) {
            mainTableTotals.pct_gaji_naik_turun = ((mainTableTotals.gaji_diff / mainTableTotals.gaji_prev) * 100);
        }
        if (mainTableTotals.tbs_prev > 0) {
            mainTableTotals.pct_tbs_diff = ((mainTableTotals.tbs_diff / mainTableTotals.tbs_prev) * 100);
        }

        // Recalculate totals for pruning_table
        const pruningTotals = {
            estate: "TOTAL PRUNING",
            division_code: "",
            premi_this_month: filteredPruningTable.reduce((sum, r) => sum + (r.premi_this_month || 0), 0),
            prunning_this_month: filteredPruningTable.reduce((sum, r) => sum + (r.prunning_this_month || 0), 0),
            total: filteredPruningTable.reduce((sum, r) => sum + (r.total || 0), 0)
        };

        // Recalculate HK Analysis based on filtered data
        const upahDasarCurr = reportData.upah_dasar_curr || reportData.upah_dasar || 129220;
        const upahDasarPrev = reportData.upah_dasar_prev || reportData.upah_dasar || 129220;

        // Calculate HK from main table using real HK columns
        const total_hk_curr = filteredMainTable.reduce((sum, r) => sum + (r.hk_curr || 0), 0);
        const total_hk_prev = filteredMainTable.reduce((sum, r) => sum + (r.hk_prev || 0), 0);
        const hk_diff = total_hk_curr - total_hk_prev;

        const gaji_hk_curr = total_hk_curr * upahDasarCurr;
        const gaji_hk_prev = total_hk_prev * upahDasarPrev;

        const gaji_hk_diff = gaji_hk_curr - gaji_hk_prev;

        // Calculate Insentif Panen from main table using real insentif columns
        const insentif_prev_total = filteredMainTable.reduce((sum, r) => sum + (r.insentif_prev || 0), 0);
        const insentif_curr_total = filteredMainTable.reduce((sum, r) => sum + (r.insentif_curr || 0), 0);
        const insentif_diff = insentif_curr_total - insentif_prev_total;

        const hkAnalysis = {
            upah_dasar_curr: upahDasarCurr,
            upah_dasar_prev: upahDasarPrev,
            hk_prev: total_hk_prev,
            hk_curr: total_hk_curr,
            hk_diff: hk_diff,
            gaji_hk_prev: gaji_hk_prev,
            gaji_hk_curr: gaji_hk_curr,
            gaji_hk_diff: gaji_hk_diff,
            insentif_panen_prev: insentif_prev_total,
            insentif_panen_curr: insentif_curr_total,
            insentif_panen_diff: insentif_diff
        };

        // Recalculate Summary Analysis based on filtered data
        // Calculate Premi Estate diff from main table (using total_premi column if available)
        const total_premi_curr = filteredMainTable.reduce((sum, r) => sum + (r.premi_curr || r.total_premi || 0), 0);
        const total_premi_prev = filteredMainTable.reduce((sum, r) => sum + (r.premi_prev || 0), 0);
        const premi_estate_diff = total_premi_curr - total_premi_prev;

        // Calculate OT (Lembur) Estate + Mill diff - include MILL if not IJL mode
        let ot_estate_mill_curr = filteredMainTable.reduce((sum, r) => sum + (r.lembur_curr || r.total_lembur || 0), 0);
        let ot_estate_mill_prev = filteredMainTable.reduce((sum, r) => sum + (r.lembur_prev || 0), 0);
        const ot_estate_mill_diff = ot_estate_mill_curr - ot_estate_mill_prev;

        // Calculate Progressive Pruning diff from main table
        const prunning_curr = filteredMainTable.reduce((sum, r) => sum + (r.prunning_curr || 0), 0);
        const prunning_prev = filteredMainTable.reduce((sum, r) => sum + (r.prunning_prev || 0), 0);
        const progressive_prunning_diff = prunning_curr - prunning_prev;

        // Calculate TOTAL: Sum of all 5 components
        // TOTAL = TURUN_HK + Premi Estate + OT Estate+Mill + Progressive Pruning + Insentif Panen
        const total_impact = gaji_hk_diff + premi_estate_diff + ot_estate_mill_diff + progressive_prunning_diff + insentif_diff;

        const summaryAnalysis = {
            turun_hk_value: gaji_hk_diff,
            premi_estate_diff: premi_estate_diff,
            ot_estate_mill_diff: ot_estate_mill_diff,
            progressive_prunning_diff: progressive_prunning_diff,
            insentif_panen_diff: insentif_diff,
            total_impact: total_impact,
            tonase_tbs_diff: mainTableTotals.tbs_diff,
            // Direction indicators
            turun_hk_label: gaji_hk_diff < 0 ? "TURUN" : gaji_hk_diff > 0 ? "NAIK" : "TETAP",
            premi_estate_label: premi_estate_diff < 0 ? "TURUN" : premi_estate_diff > 0 ? "NAIK" : "TETAP",
            ot_label: ot_estate_mill_diff < 0 ? "TURUN" : ot_estate_mill_diff > 0 ? "NAIK" : "TETAP",
            prunning_label: progressive_prunning_diff < 0 ? "TURUN" : progressive_prunning_diff > 0 ? "NAIK" : "TETAP",
            insentif_label: insentif_diff < 0 ? "TURUN" : insentif_diff > 0 ? "NAIK" : "TETAP",
            tbs_label: mainTableTotals.tbs_diff < 0 ? "TURUN" : mainTableTotals.tbs_diff > 0 ? "NAIK" : "TETAP"
        };

        return {
            ...reportData,
            main_table: filteredMainTable,
            main_table_totals: mainTableTotals,
            pruning_table: filteredPruningTable,
            pruning_totals: pruningTotals,
            hk_analysis: hkAnalysis,
            summary_analysis: summaryAnalysis
        };
    }, [reportData, estateType]);

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

    // Format percentage
    const formatPercentage = (value) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return '-';
        return num.toFixed(2);
    };

    // Get month name
    const getMonthName = (m) => {
        const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return months[m] || '';
    };

    // Get short month name
    const getShortMonthName = (m) => {
        const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
            'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        return months[m] || '';
    };

    // Period labels
    const periodLabel = `MONTH OF ${getMonthName(month).toUpperCase()} ${year}`;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    // Print date
    const printDate = new Date().toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    // Month and year options
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

    const currentYear = new Date().getFullYear();
    const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

    // Handle print
    const handlePrint = () => {
        printReport({ orientation: 'landscape', margin: '0' });
    };

    // Handle Luas Area Change
    const handleLuasAreaChange = (divisionCode, value) => {
        setEditingLuasArea(prev => ({
            ...prev,
            [divisionCode]: value
        }));
    };

    // Handle Save Luas Area
    const handleSaveLuasArea = async (divisionCode, value) => {
        try {
            await updateLuasArea(token, {
                month,
                year,
                division: divisionCode,
                value: parseFloat(value) || 0
            });
            // Refresh data to show updated values
            await fetchData();
        } catch (err) {
            console.error('Failed to save Luas Area:', err);
            alert('Failed to save Luas Area value');
        }
    };

    // Get diff color class - mapped to wsp-* classes
    const getDiffClass = (value, inverse = false) => {
        if (value === 0) return 'text-neutral';
        if (inverse) {
            return value > 0 ? 'text-diff-neg' : 'text-diff-pos';
        }
        return value > 0 ? 'text-diff-pos' : 'text-diff-neg';
    };

    // Render trend indicator with icon
    const renderTrend = (value, inverse = false) => {
        if (value === 0 || value === '0' || value === '0.00') return null;
        const num = parseFloat(value);
        if (isNaN(num)) return null;

        const isPositive = num > 0;
        const color = inverse 
            ? (isPositive ? '#dc2626' : '#16a34a') 
            : (isPositive ? '#16a34a' : '#dc2626');
        const icon = isPositive ? '▲' : '▼';

        return (
            <span className="trend-indicator" style={{ 
                color, 
                marginLeft: '6px', 
                fontWeight: 'bold', 
                fontSize: '0.7rem',
                display: 'inline-flex',
                alignItems: 'center'
            }}>
                {icon}
            </span>
        );
    };

    // Render main table (Table 1)
    const renderMainTable = () => {
        if (!filteredData?.main_table) return null;

        const rows = filteredData.main_table;
        const totals = filteredData.main_table_totals;
        const currLabel = getShortMonthName(month);
        const prevLabel = getShortMonthName(prevMonth);

        return (
            <div className="wsp-table-wrapper impact-main-table-wrapper" style={{ marginBottom: '2rem' }}>
                <table className="wsp-table impact-main-table">
                    <colgroup>
                        <col className="impact-col-estate" />
                        <col className="impact-col-luas" />
                        <col className="impact-col-worker" />
                        <col className="impact-col-worker" />
                        <col className="impact-col-worker" />
                        <col className="impact-col-money" />
                        <col className="impact-col-money" />
                        <col className="impact-col-money" />
                        <col className="impact-col-tbs" />
                        <col className="impact-col-tbs" />
                        <col className="impact-col-tbs" />
                        <col className="impact-col-percent" />
                    </colgroup>
                    <thead>
                        <tr className="wsp-header-master">
                            <th rowSpan="2" className="th-sticky-col" style={{ minWidth: '120px' }}>Estate</th>
                            <th rowSpan="2" style={{ minWidth: '70px' }}>Luas Ha<br />Productive</th>
                            <th colSpan="3" className="th-group-manpower">Jumlah Karyawan</th>
                            <th colSpan="3" className="th-group-income">Nilai Gaji (All)</th>
                            <th colSpan="3" className="th-group-manpower">Tonase TBS</th>
                            <th rowSpan="2" className="th-group-compare">% Gaji<br />Naik/Turun</th>
                        </tr>
                        <tr className="wsp-header-sub">
                            {/* Workers */}
                            <th className="th-group-manpower">{currLabel}-{String(year).slice(-2)}</th>
                            <th className="th-group-manpower">{prevLabel}-{String(prevYear).slice(-2)}</th>
                            <th className="th-group-manpower border-right-section">Diff</th>

                            {/* Gaji */}
                            <th className="th-group-income">{currLabel}-{String(year).slice(-2)}</th>
                            <th className="th-group-income">{prevLabel}-{String(prevYear).slice(-2)}</th>
                            <th className="th-group-income border-right-section">Diff</th>

                            {/* TBS */}
                            <th className="th-group-manpower">{currLabel}-{String(year).slice(-2)}</th>
                            <th className="th-group-manpower">{prevLabel}-{String(prevYear).slice(-2)}</th>
                            <th className="th-group-manpower border-right-section">Diff</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, idx) => (
                            <tr key={idx}>
                                <td className="text-left sticky-col">
                                    <div className="div-code">{row.estate}</div>
                                </td>
                                <td className="text-right border-right-group">
                                    {editMode ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="wsp-input-edit"
                                                value={editingLuasArea[row.division_code] !== undefined ? editingLuasArea[row.division_code] : (row.original_luas_ha ?? row.luas_ha)}
                                                onChange={(e) => handleLuasAreaChange(row.division_code, e.target.value)}
                                                style={{ width: '100%', textAlign: 'right', padding: '2px 4px', border: '1px solid #3b82f6', borderRadius: '4px', backgroundColor: '#ffffff', color: '#0f172a' }}
                                            />
                                            <button
                                                onClick={() => handleSaveLuasArea(row.division_code, editingLuasArea[row.division_code])}
                                                className="wsp-btn-sm"
                                                style={{ fontSize: '0.65rem', padding: '2px 6px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                disabled={editingLuasArea[row.division_code] === undefined}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    ) : (
                                        formatNumber(row.luas_ha, 2)
                                    )}
                                </td>
                                <td className="text-right">{formatNumber(row.workers_curr)}</td>
                                <td className="text-right">{formatNumber(row.workers_prev)}</td>
                                <td className={`text-right border-right-section ${getDiffClass(row.workers_diff)}`}>{formatNumber(row.workers_diff)}</td>
                                <td className="text-right">{formatNumber(row.gaji_curr)}</td>
                                <td className="text-right">{formatNumber(row.gaji_prev)}</td>
                                <td className={`text-right border-right-section ${getDiffClass(row.gaji_diff, true)}`}>{formatNumber(row.gaji_diff)}</td>
                                <td className="text-right">{formatNumber(row.tbs_curr, 2)}</td>
                                <td className="text-right">{formatNumber(row.tbs_prev, 2)}</td>
                                <td className={`text-right border-right-section ${getDiffClass(row.tbs_diff)}`}>
                                    {formatNumber(row.tbs_diff, 2)}
                                    {renderTrend(row.tbs_diff, false)}
                                </td>
                                <td className={`text-right font-bold ${getDiffClass(row.pct_gaji_naik_turun, true)}`} style={{ minWidth: '85px' }}>
                                    {formatPercentage(row.pct_gaji_naik_turun)}%
                                    {renderTrend(row.pct_gaji_naik_turun, true)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="wsp-grand-total">
                            <td className="text-left sticky-col">{totals.estate}</td>
                            <td className="text-right">{formatNumber(totals.luas_ha, 2)}</td>
                            <td className="text-right">{formatNumber(totals.workers_curr)}</td>
                            <td className="text-right">{formatNumber(totals.workers_prev)}</td>
                            <td className={`text-right border-right-section ${getDiffClass(totals.workers_diff)}`}>{formatNumber(totals.workers_diff)}</td>
                            <td className="text-right">{formatNumber(totals.gaji_curr)}</td>
                            <td className="text-right">{formatNumber(totals.gaji_prev)}</td>
                            <td className={`text-right border-right-section ${getDiffClass(totals.gaji_diff, true)}`}>{formatNumber(totals.gaji_diff)}</td>
                            <td className="text-right">{formatNumber(totals.tbs_curr, 2)}</td>
                            <td className="text-right">{formatNumber(totals.tbs_prev, 2)}</td>
                            <td className={`text-right border-right-section ${getDiffClass(totals.tbs_diff)}`}>{formatNumber(totals.tbs_diff, 2)}</td>
                            <td className={`text-right ${getDiffClass(totals.pct_gaji_naik_turun, true)}`}>
                                {formatPercentage(totals.pct_gaji_naik_turun)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    const renderPruningTable = () => {
        if (!filteredData?.pruning_table) return null;

        const rows = filteredData.pruning_table;
        const totals = filteredData.pruning_totals;

        return (
            <div className="wsp-table-wrapper impact-side-table-wrapper" style={{ flex: 1, height: 'fit-content' }}>
                <div className="impact-print-section-title" style={{ padding: '0.65rem 1rem', background: '#0f172a', color: 'white', fontWeight: 800, fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                    PRUNING ANALYSIS
                </div>
                <table className="wsp-table impact-side-table impact-pruning-table">
                    <colgroup>
                        <col className="impact-col-side-estate" />
                        <col className="impact-col-side-money" />
                        <col className="impact-col-side-total" />
                    </colgroup>
                    <thead>
                        <tr className="wsp-header-master">
                            <th rowSpan="2" className="th-sticky-col">Estate</th>
                            <th colSpan="2" className="th-group-income">Realisasi Bulan Ini</th>
                        </tr>
                        <tr className="wsp-header-sub">
                            <th className="th-group-income">Premi Pruning</th>
                            <th className="th-group-income">Total (Income)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, idx) => (
                            <tr key={idx}>
                                <td className="text-left sticky-col">
                                    <div className="div-code">{row.division_code}</div>
                                </td>
                                <td className="text-right">{formatNumber(row.premi_this_month)}</td>
                                <td className="text-right font-semibold">{formatNumber(row.total)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="wsp-grand-total">
                            <td className="text-left sticky-col">{totals.estate}</td>
                            <td className="text-right">{formatNumber(totals.premi_this_month)}</td>
                            <td className="text-right">{formatNumber(totals.total)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    // Render HK Analysis table (Table 3 - Bottom Right)
    const renderHKAnalysisTable = () => {
        if (!filteredData?.hk_analysis || !filteredData?.summary_analysis) return null;

        const hk = filteredData.hk_analysis;
        const summary = filteredData.summary_analysis;
        const currLabel = getMonthName(month);
        const prevLabel = getMonthName(prevMonth);
        const formatShortMonth = (m) => getShortMonthName(m);

        return (
            <div className="wsp-table-wrapper impact-side-table-wrapper" style={{ flex: 1, height: 'fit-content' }}>
                <div className="impact-print-section-title" style={{ padding: '0.65rem 1rem', background: '#0f172a', color: 'white', fontWeight: 800, fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                    FINANCIAL IMPACT SUMMARY
                </div>

                {/* HK Analysis */}
                <table className="wsp-table impact-side-table impact-financial-table" style={{ marginBottom: '0', borderBottom: 'none' }}>
                    <colgroup>
                        <col className="impact-col-finance-desc" />
                        <col className="impact-col-finance-hk" />
                        <col className="impact-col-finance-money" />
                        <col className="impact-col-finance-money" />
                    </colgroup>
                    <thead>
                        <tr className="wsp-header-sub">
                            <th style={{ textAlign: 'left', paddingLeft: '1rem', width: '40%' }}>Description</th>
                            <th>HK</th>
                            <th className="th-group-income">Gaji (HK × Rate)</th>
                            <th className="th-group-income">Insentif</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="text-left" style={{ paddingLeft: '1rem' }}>HK Bulan Lalu ({formatShortMonth(prevMonth)} @ {formatNumber(hk.upah_dasar_prev)})</td>
                            <td className="text-right">{formatNumber(hk.hk_prev)}</td>
                            <td className="text-right">{formatNumber(hk.gaji_hk_prev)}</td>
                            <td className="text-right">{formatNumber(hk.insentif_panen_prev)}</td>
                        </tr>
                        <tr>
                            <td className="text-left" style={{ paddingLeft: '1rem' }}>HK Bulan Ini ({formatShortMonth(month)} @ {formatNumber(hk.upah_dasar_curr)})</td>
                            <td className="text-right">{formatNumber(hk.hk_curr)}</td>
                            <td className="text-right">{formatNumber(hk.gaji_hk_curr)}</td>
                            <td className="text-right">{formatNumber(hk.insentif_panen_curr)}</td>
                        </tr>
                        <tr style={{ background: '#f1f5f9' }}>
                            <td className="text-left font-bold" style={{ paddingLeft: '1rem' }}>SELISIH (Impact)</td>
                            <td className={`text-right font-bold ${getDiffClass(hk.hk_diff)}`}>
                                {hk.hk_diff < 0 ? `(${formatNumber(Math.abs(hk.hk_diff))})` : formatNumber(hk.hk_diff)}
                                {renderTrend(hk.hk_diff, false)}
                            </td>
                            <td className={`text-right font-bold ${getDiffClass(hk.gaji_hk_diff, true)}`}>
                                {hk.gaji_hk_diff < 0 ? `(${formatNumber(Math.abs(hk.gaji_hk_diff))})` : formatNumber(hk.gaji_hk_diff)}
                                {renderTrend(hk.gaji_hk_diff, true)}
                            </td>
                            <td className={`text-right font-bold ${getDiffClass(hk.insentif_panen_diff)}`}>
                                {formatNumber(hk.insentif_panen_diff)}
                                {renderTrend(hk.insentif_panen_diff, false)}
                            </td>
                        </tr>
                    </tbody>
                </table>

                {/* Summary Analysis */}
                <table className="wsp-table impact-side-table impact-summary-table">
                    <colgroup>
                        <col className="impact-col-summary-desc" />
                        <col className="impact-col-summary-value" />
                    </colgroup>
                    <tbody>
                        <tr>
                            <td className="text-left">{summary.turun_hk_label} HK ({currLabel}'{String(year).slice(-2)} - {prevLabel}'{String(prevYear).slice(-2)})</td>
                            <td className={`text-right ${getDiffClass(summary.turun_hk_value, true)}`}>
                                {summary.turun_hk_value < 0 ? `(${formatNumber(Math.abs(summary.turun_hk_value))})` : formatNumber(summary.turun_hk_value)}
                            </td>
                        </tr>
                        <tr>
                            <td className="text-left">Premi Estate <strong>{summary.premi_estate_label}</strong> dari bulan lalu</td>
                            <td className={`text-right ${getDiffClass(summary.premi_estate_diff, true)}`}>
                                {summary.premi_estate_diff < 0 ? `(${formatNumber(Math.abs(summary.premi_estate_diff))})` : formatNumber(summary.premi_estate_diff)}
                            </td>
                        </tr>
                        <tr>
                            <td className="text-left">OT Estate + Mill <strong>{summary.ot_label}</strong> dari bulan lalu</td>
                            <td className={`text-right ${getDiffClass(summary.ot_estate_mill_diff, true)}`}>
                                {summary.ot_estate_mill_diff < 0 ? `(${formatNumber(Math.abs(summary.ot_estate_mill_diff))})` : formatNumber(summary.ot_estate_mill_diff)}
                            </td>
                        </tr>
                        <tr>
                            <td className="text-left">Progressive Pruning <strong>{summary.prunning_label}</strong> dari bulan lalu</td>
                            <td className={`text-right ${getDiffClass(summary.progressive_prunning_diff, true)}`}>
                                {summary.progressive_prunning_diff < 0 ? `(${formatNumber(Math.abs(summary.progressive_prunning_diff))})` : formatNumber(summary.progressive_prunning_diff)}
                            </td>
                        </tr>
                        <tr>
                            <td className="text-left">Insentif Panen <strong>{summary.insentif_label}</strong> dari bulan lalu</td>
                            <td className={`text-right ${getDiffClass(summary.insentif_panen_diff)}`}>
                                {formatNumber(summary.insentif_panen_diff)}
                            </td>
                        </tr>
                        <tr style={{ background: '#0f172a', color: '#fff' }}>
                            <td className="text-center font-bold">TOTAL</td>
                            <td className={`text-right font-bold ${summary.total_impact > 0 ? 'text-diff-neg' : 'text-diff-pos'}`} style={{ color: '#fff' }}>
                                {formatNumber(summary.total_impact)}
                            </td>
                        </tr>
                        <tr style={{ borderTop: '2px solid #333' }}>
                            <td className="text-left">Tonase TBS <strong>{summary.tbs_label}</strong> dari bulan lalu</td>
                            <td className={`text-right font-bold ${getDiffClass(summary.tonase_tbs_diff)}`}>
                                {formatNumber(summary.tonase_tbs_diff, 2)} Ton
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
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

                        <select
                            value={estateType}
                            onChange={(e) => setEstateType(e.target.value)}
                            className="wsp-select"
                            style={{ minWidth: '140px' }}
                        >
                            <option value="all">Semua Estate</option>
                            <option value="non-ijl">Rebinmas</option>
                            <option value="ijl">IJL Only</option>
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
                        onClick={() => setEditMode(!editMode)}
                        className={`wsp-btn ${editMode ? 'wsp-btn-primary' : ''}`}
                        title="Toggle Edit Mode"
                        style={{ marginLeft: '0.5rem' }}
                    >
                        {editMode ? 'Exit Edit' : 'Edit Mode'}
                    </button>
                </div>
            </div>

            {/* Loading State */}
            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
                    <div style={{ width: '40px', height: '40px', border: '3px solid #cbd5e1', borderTop: '3px solid #0f172a', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                    <div style={{ marginTop: '1rem', color: '#64748b' }}>Memuat Impact Report...</div>
                </div>
            ) : error ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#ef4444' }}>
                    <div style={{ fontSize: '2rem' }}>!</div>
                    <div style={{ fontWeight: 700, margin: '1rem 0' }}>Gagal Memuat Data</div>
                    <div>{error}</div>
                    <button onClick={fetchData} className="wsp-btn" style={{ marginTop: '1rem' }}>
                        Coba Lagi
                    </button>
                </div>
            ) : (
                /* Paper Document */
                <div className="wsp-document impact-print-document" id="impact-report-content">
                    <ReportWatermark />
                    {/* Letterhead */}
                    <div className="wsp-letterhead">
                        <img
                            src="/images/rebinmas.webp"
                            alt="PT REBINMAS JAYA"
                            className="wsp-logo"
                        />
                        <h1 className="wsp-company-name">
                            {estateType === 'ijl' ? 'PT. IMPIAN JAYA LESTARI' : 'PT. REBINMAS JAYA'}
                        </h1>
                        <div className="wsp-report-title">
                            IMPACT REPORT
                            {estateType === 'ijl' && ' - ESTATE IJL'}
                            {estateType === 'non-ijl' && ' - ESTATE REBINMAS'}
                        </div>
                        <div className="wsp-report-period">{periodLabel}</div>
                        <ReportPrintMetadata
                            mode="Impact"
                            source={getSourceModeLabel({ sourceMode: 'Impact API' })}
                            scope={estateType === 'all' ? 'Semua Estate' : estateType === 'ijl' ? 'IJL' : 'Rebinmas'}
                            note="Grand total mengikuti data yang terlihat setelah filter estate pada report ini."
                        />
                    </div>

                    {/* Main Table (Top) */}
                    {renderMainTable()}

                    {/* Bottom Section: Two Tables Side by Side */}
                    <div className="wsp-bottom-section impact-bottom-section" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        {/* Pruning Table (Left) */}
                        {renderPruningTable()}

                        {/* HK Analysis Table (Right) */}
                        {renderHKAnalysisTable()}
                    </div>

                    {/* Report Footer & Signatures */}
                    <div className="print-only impact-print-signature" style={{ marginTop: '3rem', pageBreakInside: 'avoid' }}>
                        <PrintSignature />
                    </div>

                    <footer className="wsp-footer" style={{ marginTop: '4rem' }}>
                        <div className="wsp-footer-left">
                            <div>Dicetak: {printDate}</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>User: {user?.username}</div>
                        </div>
                        <div className="wsp-footer-right">
                            {estateType === 'ijl' ? 'PT. IMPIAN JAYA LESTARI' : 'PT. REBINMAS JAYA'}
                        </div>
                    </footer>
                </div>
            )}
        </div>
    );
}
