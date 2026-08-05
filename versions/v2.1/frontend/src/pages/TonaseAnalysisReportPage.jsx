import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import { AlertTriangle, ArrowLeft, BarChart3, DollarSign, Printer, RefreshCw, Scale, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchAvailablePeriods } from '../services/summaryReportService';
import { fetchTonaseAnalysisReport } from '../services/dashboardService';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import { printReport } from '../utils/printPageSetup';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';

const MONTHS = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const formatNumber = (value, decimals = 0) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(Number(value));
};

const formatCurrency = (value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return `Rp ${formatNumber(value)}`;
};

const formatPercent = (value, decimals = 2) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return `${formatNumber(value, decimals)}%`;
};

const formatSignedTon = (value) => {
    if (value === null || value === undefined) return '-';
    const sign = value > 0 ? '+' : '';
    return `${sign}${formatNumber(value, 2)} ton`;
};

const getTrendText = (trend) => {
    if (trend === 'rising') return 'naik';
    if (trend === 'falling') return 'turun';
    if (trend === 'flat') return 'stabil';
    return 'belum tersedia';
};

const KpiCard = ({ icon, label, value, note, tone = 'slate' }) => (
    <div className={`tonase-kpi-card tonase-tone-${tone}`}>
        <div className="tonase-kpi-label">
            {icon}
            <span>{label}</span>
        </div>
        <div className="tonase-kpi-value">{value}</div>
        <div className="tonase-kpi-note">{note}</div>
    </div>
);

const InsightItem = ({ label, value, note }) => (
    <div className="tonase-insight-item">
        <div className="tonase-insight-label">{label}</div>
        <div className="tonase-insight-value">{value}</div>
        <div className="tonase-insight-note">{note}</div>
    </div>
);

export default function TonaseAnalysisReportPage({ onBack, initialMonth, initialYear }) {
    const { token, user } = useAuth();
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());
    const [periods, setPeriods] = useState([]);
    const [reportData, setReportData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [viewMode, setViewMode] = useState('summary');
    const [detailViewMode, setDetailViewMode] = useState('current_month');
    const [selectedDivisionCode, setSelectedDivisionCode] = useState('');

    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
    }, [initialMonth, initialYear]);

    useEffect(() => {
        async function loadPeriods() {
            if (!token) return;
            try {
                const result = await fetchAvailablePeriods(token);
                setPeriods(result.periods || []);
            } catch (err) {
                console.error('[TonaseAnalysisReportPage] Failed to load periods:', err);
            }
        }
        loadPeriods();
    }, [token]);

    const fetchData = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError('');
        try {
            const result = await fetchTonaseAnalysisReport(token, { month, year, division_code: 'REBINMAS' });
            if (result.success) {
                setReportData(result.data);
            } else {
                setReportData(null);
                setError(result.error || 'Gagal memuat laporan tonase');
            }
        } catch (err) {
            console.error('[TonaseAnalysisReportPage] Error:', err);
            setReportData(null);
            setError(err.message || 'Gagal memuat laporan tonase');
        } finally {
            setLoading(false);
        }
    }, [token, month, year]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const yearOptions = useMemo(() => {
        const years = periods.map(period => period.year);
        const uniqueYears = [...new Set(years)].sort((a, b) => b - a);
        return uniqueYears.length > 0 ? uniqueYears : [year];
    }, [periods, year]);

    const divisionBreakdown = useMemo(() => reportData ? (reportData.division_breakdown || []) : [], [reportData]);
    const divisionDetails = useMemo(() => reportData ? (reportData.division_details || []) : [], [reportData]);
    const selectedDivisionDetail = divisionDetails.find(row => row.division_code === selectedDivisionCode) || divisionDetails[0] || null;
    const selectedDivisionSummary = selectedDivisionDetail?.summary || {};

    useEffect(() => {
        if (divisionDetails.length === 0) {
            if (selectedDivisionCode) setSelectedDivisionCode('');
            return;
        }
        if (!selectedDivisionCode || !divisionDetails.some(row => row.division_code === selectedDivisionCode)) {
            setSelectedDivisionCode(divisionDetails[0].division_code);
        }
    }, [divisionDetails, selectedDivisionCode]);

    const kpis = reportData?.kpis || {};
    const isDetailMode = viewMode === 'detail';
    const detailModeLabel = detailViewMode === 'current_month' ? 'Current Month' : 'Trend 5 Bulan';
    const activeScopeLabel = isDetailMode
        ? `${selectedDivisionDetail?.division_code || '-'} - ${detailModeLabel}`
        : 'Seluruh Rebinmas';
    const displayModeKey = isDetailMode ? detailViewMode : 'summary';
    const displayKpis = isDetailMode ? selectedDivisionSummary : kpis;
    const chartData = useMemo(() => {
        const rows = isDetailMode ? (selectedDivisionDetail?.trend || []) : (reportData?.trend || []);
        return rows.map(row => ({
            ...row,
            label: row.label,
            tonase: row.total_tonase || 0,
            upahPerHk: row.upah_bersih_per_hk || 0,
            premiPerHk: row.premi_per_hk || 0
        }));
    }, [isDetailMode, reportData, selectedDivisionDetail]);
    const insights = reportData?.insights || {};
    const highestTonase = insights.highest_tonase_period;
    const largestMovement = insights.largest_tonase_movement;
    const warnings = reportData?.warnings || [];
    const periodLabel = `${MONTHS[month]} ${year}`;
    const handlePrint = () => printReport({ orientation: 'landscape' });
    const handleDisplayModeChange = (nextMode) => {
        if (nextMode === 'summary') {
            setViewMode('summary');
            return;
        }
        setViewMode('detail');
        setDetailViewMode(nextMode);
    };
    const modeControls = (
        <>
            <div className="tonase-mode-tabs tonase-display-mode-tabs">
                <button type="button" className={displayModeKey === 'summary' ? 'active' : ''} onClick={() => handleDisplayModeChange('summary')}>
                    Ringkasan Rebinmas
                </button>
                <button type="button" className={displayModeKey === 'current_month' ? 'active' : ''} onClick={() => handleDisplayModeChange('current_month')}>
                    Detail Current Month
                </button>
                <button type="button" className={displayModeKey === 'trend_5_month' ? 'active' : ''} onClick={() => handleDisplayModeChange('trend_5_month')}>
                    Detail Trend 5 Bulan
                </button>
            </div>
            {isDetailMode && (
                <select
                    value={selectedDivisionCode}
                    onChange={event => setSelectedDivisionCode(event.target.value)}
                    className="report-filter-badge tonase-detail-select"
                >
                    {divisionDetails.map(row => (
                        <option key={row.division_code} value={row.division_code}>
                            {row.division_code}
                        </option>
                    ))}
                </select>
            )}
        </>
    );

    return (
        <div className="wsp-container tonase-report-page">
            <div className="report-header-web no-print">
                <div className="report-header-info">
                    <div className="tonase-toolbar-title">
                        <button onClick={onBack} className="wsp-btn tonase-back-btn">
                            <ArrowLeft size={16} /> Kembali
                        </button>
                        <div>
                            <h1>Analisis Tonase</h1>
                            <p>Pergerakan tonase total Rebinmas 5 bulan, Cost/HK gang panen, dan uraian premi.</p>
                        </div>
                    </div>
                    <div className="tonase-filter-row">
                        <select value={month} onChange={event => setMonth(parseInt(event.target.value))} className="report-filter-badge">
                            {MONTHS.slice(1).map((label, index) => (
                                <option key={label} value={index + 1}>{label}</option>
                            ))}
                        </select>
                        <select value={year} onChange={event => setYear(parseInt(event.target.value))} className="report-filter-badge">
                            {yearOptions.map(optionYear => (
                                <option key={optionYear} value={optionYear}>{optionYear}</option>
                            ))}
                        </select>
                    </div>
                    <div className="tonase-mode-row">
                        {modeControls}
                    </div>
                </div>
                <div className="report-header-actions">
                    <button onClick={fetchData} className="wsp-btn-secondary" disabled={loading}>
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Refresh
                    </button>
                    <button onClick={handlePrint} className="wsp-btn-primary" disabled={loading || !reportData}>
                        <Printer size={18} /> Cetak
                    </button>
                </div>
            </div>

            {error && (
                <div className="wsp-error tonase-error">
                    <div className="wsp-error-icon">!</div>
                    <div className="wsp-error-title">Gagal Memuat Laporan Tonase</div>
                    <div className="wsp-error-message">{error}</div>
                    <button onClick={fetchData} className="wsp-btn-primary">Coba Lagi</button>
                </div>
            )}

            {loading && (
                <div className="wsp-loading no-print">
                    <div className="wsp-spinner"></div>
                    <div className="wsp-loading-text">Memuat analisis tonase...</div>
                </div>
            )}

            {!loading && !error && reportData && (
                <div className="wsp-document tonase-document" id="tonase-analysis-report-content">
                    <ReportWatermark />
                    <div className="wsp-report-header">
                        <div className="wsp-logo-section">
                            <img src="/images/rebinmas.webp" alt="PT Rebinmas Jaya" className="wsp-logo" />
                        </div>
                        <div className="wsp-title-section">
                            <h1 className="wsp-company-name">PT. REBINMAS JAYA</h1>
                            <h2 className="wsp-report-title">Laporan Analisis Tonase Rebinmas</h2>
                        </div>
                        <div className="wsp-meta-section">
                            <div className="wsp-meta-row">
                                <span className="wsp-meta-label">Periode:</span>
                                <span className="wsp-meta-value">{periodLabel}</span>
                            </div>
                            <div className="wsp-meta-row">
                                <span className="wsp-meta-label">Scope:</span>
                                <span className="wsp-meta-value">{activeScopeLabel}</span>
                            </div>
                            <div className="wsp-meta-row">
                                <span className="wsp-meta-label">Metrik HK:</span>
                                <span className="wsp-meta-value">Gang Panen</span>
                            </div>
                        </div>
                    </div>

                    <ReportPrintMetadata
                        mode="Analisis Tonase"
                        source={reportData.meta?.tonase_source || 'extend_db_ptrj.dbo.daftar_upah_aggregation_history'}
                        scope={`${activeScopeLabel} - Gang Panen`}
                        note="Tonase memakai total Rebinmas dari aggregation history. Metrik HK, upah bersih/HK, dan premi/HK memakai gang panen."
                    />

                    <div className="tonase-document-mode no-print">
                        <div className="tonase-document-mode-label">Mode Tampilan</div>
                        {modeControls}
                    </div>

                    <div className="tonase-active-scope">
                        <span>{isDetailMode ? 'Mode Detail Aktif' : 'Mode Ringkasan'}</span>
                        <strong>{activeScopeLabel}</strong>
                    </div>

                    {warnings.length > 0 && (
                        <div className="tonase-warning-strip">
                            <AlertTriangle size={16} />
                            <div>
                                {warnings.map((warning, index) => (
                                    <div key={index}>{warning}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="tonase-kpi-grid">
                        <KpiCard
                            icon={<Scale size={16} />}
                            label="Total Tonase"
                            value={`${formatNumber(displayKpis.total_tonase, 2)} ton`}
                            note={`${formatNumber(displayKpis.gang_count)} gang panen`}
                            tone="green"
                        />
                        <KpiCard
                            icon={<DollarSign size={16} />}
                            label="Upah Bersih / HK"
                            value={formatCurrency(displayKpis.upah_bersih_per_hk)}
                            note={`Total HK ${formatNumber(displayKpis.total_hk, 2)}`}
                            tone="blue"
                        />
                        <KpiCard
                            icon={<TrendingUp size={16} />}
                            label="Premi / HK"
                            value={formatCurrency(displayKpis.premi_per_hk)}
                            note={`Total premi ${formatCurrency(displayKpis.total_premi)}`}
                            tone="amber"
                        />
                        <KpiCard
                            icon={<BarChart3 size={16} />}
                            label="Upah Bersih / Ton"
                            value={formatCurrency(displayKpis.upah_bersih_per_ton)}
                            note={`Upah bersih ${formatCurrency(displayKpis.total_upah_bersih)}`}
                            tone="cyan"
                        />
                        <KpiCard
                            icon={<DollarSign size={16} />}
                            label="Premi / Ton"
                            value={formatCurrency(displayKpis.premi_per_ton)}
                            note={`Porsi premi ${formatPercent(displayKpis.premi_share)}`}
                            tone="rose"
                        />
                    </div>

                    <div className="tonase-insight-strip">
                        <InsightItem
                            label="Puncak tonase"
                            value={highestTonase ? highestTonase.label : '-'}
                            note={highestTonase ? `${formatNumber(highestTonase.total_tonase, 2)} ton` : 'Data belum tersedia'}
                        />
                        <InsightItem
                            label="Pergerakan terbesar"
                            value={largestMovement ? `${largestMovement.from_label} ke ${largestMovement.to_label}` : '-'}
                            note={largestMovement ? formatSignedTon(largestMovement.delta_tonase) : 'Data belum tersedia'}
                        />
                        <InsightItem
                            label="Arah upah/HK"
                            value={getTrendText(insights.upah_bersih_hk_trend)}
                            note={insights.upah_bersih_hk_delta === null || insights.upah_bersih_hk_delta === undefined ? 'Perbandingan belum tersedia' : `${formatCurrency(insights.upah_bersih_hk_delta)} vs bulan sebelumnya`}
                        />
                        <InsightItem
                            label="Porsi premi"
                            value={formatPercent(insights.premium_share)}
                            note="Dari total upah bersih gang panen"
                        />
                    </div>

                    <section className="tonase-section tonase-division-breakdown">
                        <div className="tonase-section-header">
                            <h3>Breakdown Divisi/Estate</h3>
                            <span>Total Seluruh Rebinmas dipecah per kode estate/divisi</span>
                        </div>
                        <table className="wsp-table division-breakdown-table">
                            <thead>
                                <tr>
                                    <th>Divisi/Estate</th>
                                    <th className="text-right">Tonase</th>
                                    <th className="text-right">Share Tonase</th>
                                    <th className="text-right">HK Panen</th>
                                    <th className="text-right">Upah Bersih</th>
                                    <th className="text-right">Premi</th>
                                    <th className="text-right">Upah/HK</th>
                                    <th className="text-right">Premi/HK</th>
                                    <th className="text-right">Premi/Ton</th>
                                </tr>
                            </thead>
                            <tbody>
                                {divisionBreakdown.map(row => (
                                    <tr
                                        key={row.division_code}
                                        className={`tonase-clickable-row ${selectedDivisionCode === row.division_code ? 'tonase-selected-row' : ''}`}
                                        onClick={() => {
                                            setSelectedDivisionCode(row.division_code);
                                            setViewMode('detail');
                                            setDetailViewMode('current_month');
                                        }}
                                        title={`Lihat detail ${row.division_code}`}
                                    >
                                        <td className="font-bold tonase-division-code">{row.division_code}</td>
                                        <td className="text-right">{formatNumber(row.total_tonase, 2)}</td>
                                        <td className="text-right">{formatPercent(row.tonase_share)}</td>
                                        <td className="text-right">{formatNumber(row.total_hk, 2)}</td>
                                        <td className="text-right">{formatCurrency(row.total_upah_bersih)}</td>
                                        <td className="text-right">{formatCurrency(row.total_premi)}</td>
                                        <td className="text-right">{formatCurrency(row.upah_bersih_per_hk)}</td>
                                        <td className="text-right">{formatCurrency(row.premi_per_hk)}</td>
                                        <td className="text-right">{formatCurrency(row.premi_per_ton)}</td>
                                    </tr>
                                ))}
                                {divisionBreakdown.length === 0 && (
                                    <tr>
                                        <td colSpan="9" className="text-center tonase-muted-cell">Tidak ada breakdown divisi pada periode ini.</td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td className="font-bold">Total Seluruh Rebinmas</td>
                                    <td className="text-right">{formatNumber(kpis.total_tonase, 2)}</td>
                                    <td className="text-right">100,00%</td>
                                    <td className="text-right">{formatNumber(kpis.total_hk, 2)}</td>
                                    <td className="text-right">{formatCurrency(kpis.total_upah_bersih)}</td>
                                    <td className="text-right">{formatCurrency(kpis.total_premi)}</td>
                                    <td className="text-right">{formatCurrency(kpis.upah_bersih_per_hk)}</td>
                                    <td className="text-right">{formatCurrency(kpis.premi_per_hk)}</td>
                                    <td className="text-right">{formatCurrency(kpis.premi_per_ton)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </section>

                    {viewMode === 'detail' && (
                        <section className="tonase-section tonase-current-detail">
                            <div className="tonase-section-header">
                                <h3>{detailViewMode === 'current_month' ? 'Detail Current Month' : 'Detail Trend 5 Bulan'} - {selectedDivisionDetail?.division_code || '-'}</h3>
                                <span>{detailViewMode === 'current_month' ? periodLabel : 'Pergerakan 5 bulan divisi terpilih'}</span>
                            </div>
                            {detailViewMode === 'current_month' && (
                                <>
                                    <div className="tonase-detail-card-grid">
                                        <div className="tonase-detail-card">
                                            <span>Tonase</span>
                                            <strong>{formatNumber(selectedDivisionSummary.total_tonase, 2)} ton</strong>
                                        </div>
                                        <div className="tonase-detail-card">
                                            <span>HK Panen</span>
                                            <strong>{formatNumber(selectedDivisionSummary.total_hk, 2)}</strong>
                                        </div>
                                        <div className="tonase-detail-card">
                                            <span>Upah/HK</span>
                                            <strong>{formatCurrency(selectedDivisionSummary.upah_bersih_per_hk)}</strong>
                                        </div>
                                        <div className="tonase-detail-card">
                                            <span>Premi/HK</span>
                                            <strong>{formatCurrency(selectedDivisionSummary.premi_per_hk)}</strong>
                                        </div>
                                        <div className="tonase-detail-card">
                                            <span>Share Tonase</span>
                                            <strong>{formatPercent(selectedDivisionSummary.tonase_share)}</strong>
                                        </div>
                                    </div>

                                    <div className="tonase-detail-table-grid">
                                        <section>
                                            <div className="tonase-subsection-title">Gang Panen</div>
                                            <table className="wsp-table tonase-detail-mode-table">
                                                <thead>
                                                    <tr>
                                                        <th>Gang</th>
                                                        <th>Deskripsi</th>
                                                        <th className="text-right">HK</th>
                                                        <th className="text-right">Upah Bersih</th>
                                                        <th className="text-right">Premi</th>
                                                        <th className="text-right">Upah/HK</th>
                                                        <th className="text-right">Premi/HK</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(selectedDivisionDetail?.gang_rows || []).map(row => (
                                                        <tr key={row.gang_code}>
                                                            <td className="font-bold">{row.gang_code}</td>
                                                            <td>{row.gang_description}</td>
                                                            <td className="text-right">{formatNumber(row.total_hk, 2)}</td>
                                                            <td className="text-right">{formatCurrency(row.total_upah_bersih)}</td>
                                                            <td className="text-right">{formatCurrency(row.total_premi)}</td>
                                                            <td className="text-right">{formatCurrency(row.upah_bersih_per_hk)}</td>
                                                            <td className="text-right">{formatCurrency(row.premi_per_hk)}</td>
                                                        </tr>
                                                    ))}
                                                    {(selectedDivisionDetail?.gang_rows || []).length === 0 && (
                                                        <tr>
                                                            <td colSpan="7" className="text-center tonase-muted-cell">Tidak ada gang panen pada divisi ini.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </section>

                                        <section>
                                            <div className="tonase-subsection-title">Sumber Tonase</div>
                                            <table className="wsp-table tonase-detail-mode-table">
                                                <thead>
                                                    <tr>
                                                        <th>Gang</th>
                                                        <th>Deskripsi</th>
                                                        <th>Tipe</th>
                                                        <th className="text-right">Tonase</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(selectedDivisionDetail?.tonase_rows || []).map(row => (
                                                        <tr key={`${row.gang_code}-${row.gang_type}`}>
                                                            <td className="font-bold">{row.gang_code}</td>
                                                            <td>{row.gang_description}</td>
                                                            <td>{row.gang_type}</td>
                                                            <td className="text-right">{formatNumber(row.total_tonase, 2)}</td>
                                                        </tr>
                                                    ))}
                                                    {(selectedDivisionDetail?.tonase_rows || []).length === 0 && (
                                                        <tr>
                                                            <td colSpan="4" className="text-center tonase-muted-cell">Tidak ada sumber tonase pada divisi ini.</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </section>
                                    </div>
                                </>
                            )}
                            {detailViewMode === 'trend_5_month' && (
                                <table className="wsp-table tonase-detail-mode-table">
                                    <thead>
                                        <tr>
                                            <th>Periode</th>
                                            <th className="text-right">Tonase</th>
                                            <th className="text-right">HK Panen</th>
                                            <th className="text-right">Upah Bersih</th>
                                            <th className="text-right">Premi</th>
                                            <th className="text-right">Upah/HK</th>
                                            <th className="text-right">Premi/HK</th>
                                            <th className="text-right">Premi/Ton</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedDivisionDetail?.trend || []).map(row => (
                                            <tr key={row.period_key}>
                                                <td className="font-bold">{row.label}</td>
                                                <td className="text-right">{formatNumber(row.total_tonase, 2)}</td>
                                                <td className="text-right">{formatNumber(row.total_hk, 2)}</td>
                                                <td className="text-right">{formatCurrency(row.total_upah_bersih)}</td>
                                                <td className="text-right">{formatCurrency(row.total_premi)}</td>
                                                <td className="text-right">{formatCurrency(row.upah_bersih_per_hk)}</td>
                                                <td className="text-right">{formatCurrency(row.premi_per_hk)}</td>
                                                <td className="text-right">{formatCurrency(row.premi_per_ton)}</td>
                                            </tr>
                                        ))}
                                        {(selectedDivisionDetail?.trend || []).length === 0 && (
                                            <tr>
                                                <td colSpan="8" className="text-center tonase-muted-cell">Trend 5 bulan divisi belum tersedia.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </section>
                    )}

                    <section className="tonase-section tonase-trend-chart">
                        <div className="tonase-section-header">
                            <h3>Grafik Pergerakan Tonase dan Efisiensi</h3>
                            <span>{isDetailMode ? `5 bulan terakhir untuk ${selectedDivisionDetail?.division_code || '-'}` : '5 bulan terakhir total Rebinmas'}</span>
                        </div>
                        <div className="tonase-chart-frame">
                            <ResponsiveContainer width="100%" height={300}>
                                <ComposedChart data={chartData} margin={{ top: 16, right: 32, bottom: 16, left: 12 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe3ea" />
                                    <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 12 }} />
                                    <YAxis yAxisId="left" tick={{ fill: '#047857', fontSize: 12 }} label={{ value: 'Tonase', angle: -90, position: 'insideLeft', fill: '#047857' }} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#1d4ed8', fontSize: 12 }} label={{ value: 'Rp/HK', angle: 90, position: 'insideRight', fill: '#1d4ed8' }} />
                                    <Tooltip
                                        formatter={(value, name) => {
                                            if (name === 'Tonase') return [`${formatNumber(value, 2)} ton`, name];
                                            return [formatCurrency(value), name];
                                        }}
                                        labelStyle={{ fontWeight: 700, color: '#0f172a' }}
                                    />
                                    <Legend />
                                    <Bar yAxisId="left" dataKey="tonase" name="Tonase" fill="#059669" radius={[4, 4, 0, 0]} />
                                    <Line yAxisId="right" type="monotone" dataKey="upahPerHk" name="Upah Bersih/HK" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 4 }} />
                                    <Line yAxisId="right" type="monotone" dataKey="premiPerHk" name="Premi/HK" stroke="#d97706" strokeWidth={3} dot={{ r: 4 }} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </section>

                    <div className="tonase-grid-two">
                        <section className="tonase-section">
                            <div className="tonase-section-header">
                                <h3>Uraian Premi</h3>
                                <span>Dampak per HK dan per ton</span>
                            </div>
                            <table className="wsp-table premium-breakdown-table">
                                <thead>
                                    <tr>
                                        <th>Jenis Premi</th>
                                        <th className="text-right">Total</th>
                                        <th className="text-right">Per HK</th>
                                        <th className="text-right">Per Ton</th>
                                        <th className="text-right">Share</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(reportData.premium_breakdown || []).map(row => (
                                        <tr key={row.key}>
                                            <td className="font-bold">{row.label}</td>
                                            <td className="text-right">{formatCurrency(row.total_amount)}</td>
                                            <td className="text-right">{formatCurrency(row.per_hk)}</td>
                                            <td className="text-right">{formatCurrency(row.per_ton)}</td>
                                            <td className="text-right">{formatPercent(row.share)}</td>
                                        </tr>
                                    ))}
                                    {(reportData.premium_breakdown || []).length === 0 && (
                                        <tr>
                                            <td colSpan="5" className="text-center tonase-muted-cell">Tidak ada premi pada periode ini.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </section>

                        <section className="tonase-section">
                            <div className="tonase-section-header">
                                <h3>Ringkasan 5 Bulan</h3>
                                <span>Total seluruh Rebinmas</span>
                            </div>
                            <table className="wsp-table tonase-summary-table">
                                <thead>
                                    <tr>
                                        <th>Periode</th>
                                        <th className="text-right">Tonase</th>
                                        <th className="text-right">HK</th>
                                        <th className="text-right">Upah/HK</th>
                                        <th className="text-right">Premi/HK</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(reportData.trend || []).map(row => (
                                        <tr key={row.period_key}>
                                            <td className="font-bold">{row.label}</td>
                                            <td className="text-right">{formatNumber(row.total_tonase, 2)}</td>
                                            <td className="text-right">{formatNumber(row.total_hk, 2)}</td>
                                            <td className="text-right">{formatCurrency(row.upah_bersih_per_hk)}</td>
                                            <td className="text-right">{formatCurrency(row.premi_per_hk)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    </div>

                    <section className="tonase-section tonase-monthly-detail">
                        <div className="tonase-section-header">
                            <h3>Detail Metrik Bulanan</h3>
                            <span>Upah bersih dan premi dibandingkan dengan tonase</span>
                        </div>
                        <table className="wsp-table tonase-detail-table">
                            <thead>
                                <tr>
                                    <th>Periode</th>
                                    <th className="text-right">Tonase</th>
                                    <th className="text-right">HK</th>
                                    <th className="text-right">Upah Bersih</th>
                                    <th className="text-right">Premi</th>
                                    <th className="text-right">Upah/Ton</th>
                                    <th className="text-right">Premi/Ton</th>
                                    <th className="text-right">Premi Share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(reportData.trend || []).map(row => (
                                    <tr key={row.period_key}>
                                        <td className="font-bold">{row.label}</td>
                                        <td className="text-right">{formatNumber(row.total_tonase, 2)}</td>
                                        <td className="text-right">{formatNumber(row.total_hk, 2)}</td>
                                        <td className="text-right">{formatCurrency(row.total_upah_bersih)}</td>
                                        <td className="text-right">{formatCurrency(row.total_premi)}</td>
                                        <td className="text-right">{formatCurrency(row.upah_bersih_per_ton)}</td>
                                        <td className="text-right">{formatCurrency(row.premi_per_ton)}</td>
                                        <td className="text-right">{formatPercent(row.premi_share)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>

                    <footer className="wsp-footer">
                        <div>
                            Dicetak: {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                            <br />
                            User: {user?.username || 'System'}
                        </div>
                        <div className="wsp-footer-right">PT. REBINMAS JAYA - ANALISIS TONASE</div>
                    </footer>
                </div>
            )}

            <style dangerouslySetInnerHTML={{ __html: `
                .tonase-report-page {
                    padding: 1.5rem;
                    background: #f8fafc;
                }
                .tonase-toolbar-title {
                    display: flex;
                    align-items: flex-start;
                    gap: 1rem;
                }
                .tonase-back-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.4rem;
                    padding: 0.45rem 0.8rem;
                    font-size: 0.8rem;
                }
                .tonase-filter-row {
                    display: flex;
                    gap: 0.5rem;
                    margin-top: 0.8rem;
                    margin-left: 4.7rem;
                }
                .tonase-mode-row {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-top: 0.65rem;
                    margin-left: 4.7rem;
                    flex-wrap: wrap;
                }
                .tonase-mode-tabs {
                    display: inline-flex;
                    border: 1px solid #cbd5e1;
                    background: #fff;
                }
                .tonase-mode-tabs button {
                    border: 0;
                    border-right: 1px solid #cbd5e1;
                    background: transparent;
                    color: #475569;
                    padding: 0.48rem 0.8rem;
                    font-size: 0.78rem;
                    font-weight: 800;
                    cursor: pointer;
                }
                .tonase-mode-tabs button:last-child {
                    border-right: 0;
                }
                .tonase-mode-tabs button.active {
                    background: #0f766e;
                    color: #fff;
                }
                .tonase-display-mode-tabs {
                    max-width: 100%;
                    flex-wrap: wrap;
                }
                .tonase-display-mode-tabs button {
                    min-height: 34px;
                    white-space: nowrap;
                }
                .tonase-detail-select {
                    min-width: 132px;
                }
                .tonase-document {
                    max-width: 1320px;
                }
                .tonase-document-mode {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    flex-wrap: wrap;
                    padding: 0.75rem 0.9rem;
                    margin: 0.85rem 0;
                    border: 1px solid #cbd5e1;
                    background: #f8fafc;
                }
                .tonase-document-mode-label {
                    color: #334155;
                    font-size: 0.75rem;
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .tonase-active-scope {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 1rem;
                    padding: 0.65rem 0.9rem;
                    margin: 0.75rem 0 1rem;
                    border-left: 4px solid #0f766e;
                    background: #ecfdf5;
                    color: #064e3b;
                }
                .tonase-active-scope span {
                    font-size: 0.72rem;
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .tonase-active-scope strong {
                    font-size: 0.95rem;
                    font-weight: 900;
                    text-align: right;
                }
                .tonase-warning-strip {
                    display: flex;
                    gap: 0.75rem;
                    align-items: flex-start;
                    padding: 0.75rem 1rem;
                    margin-bottom: 1rem;
                    border: 1px solid #f59e0b;
                    border-left: 4px solid #d97706;
                    background: #fffbeb;
                    color: #78350f;
                    font-size: 0.82rem;
                    font-weight: 600;
                }
                .tonase-kpi-grid {
                    display: grid;
                    grid-template-columns: repeat(5, minmax(0, 1fr));
                    gap: 0.8rem;
                    margin: 1rem 0;
                }
                .tonase-kpi-card {
                    border: 1px solid #d8e1ea;
                    border-top: 4px solid #64748b;
                    background: #fff;
                    padding: 0.85rem;
                    min-height: 104px;
                }
                .tonase-kpi-label {
                    display: flex;
                    align-items: center;
                    gap: 0.4rem;
                    color: #475569;
                    font-size: 0.72rem;
                    text-transform: uppercase;
                    font-weight: 800;
                    letter-spacing: 0.04em;
                }
                .tonase-kpi-value {
                    margin-top: 0.45rem;
                    color: #0f172a;
                    font-size: 1.25rem;
                    font-weight: 900;
                    line-height: 1.15;
                }
                .tonase-kpi-note {
                    margin-top: 0.35rem;
                    color: #64748b;
                    font-size: 0.72rem;
                    font-weight: 600;
                    line-height: 1.3;
                }
                .tonase-tone-green { border-top-color: #059669; }
                .tonase-tone-blue { border-top-color: #1d4ed8; }
                .tonase-tone-amber { border-top-color: #d97706; }
                .tonase-tone-cyan { border-top-color: #0891b2; }
                .tonase-tone-rose { border-top-color: #be123c; }
                .tonase-insight-strip {
                    display: grid;
                    grid-template-columns: repeat(4, minmax(0, 1fr));
                    gap: 0.8rem;
                    margin: 1rem 0 1.25rem;
                }
                .tonase-insight-item {
                    border: 1px solid #d8e1ea;
                    background: #f8fafc;
                    padding: 0.8rem;
                }
                .tonase-insight-label {
                    color: #64748b;
                    font-size: 0.68rem;
                    text-transform: uppercase;
                    font-weight: 800;
                    letter-spacing: 0.05em;
                }
                .tonase-insight-value {
                    margin-top: 0.3rem;
                    color: #0f172a;
                    font-size: 0.95rem;
                    font-weight: 900;
                }
                .tonase-insight-note {
                    margin-top: 0.2rem;
                    color: #475569;
                    font-size: 0.72rem;
                    line-height: 1.35;
                }
                .tonase-section {
                    margin-top: 1rem;
                    padding-top: 0.2rem;
                }
                .tonase-section-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    gap: 1rem;
                    padding: 0.65rem 0.8rem;
                    margin-bottom: 0.65rem;
                    border-left: 4px solid #334155;
                    background: #f8fafc;
                }
                .tonase-section-header h3 {
                    margin: 0;
                    font-size: 0.95rem;
                    color: #0f172a;
                    font-weight: 900;
                }
                .tonase-section-header span {
                    color: #64748b;
                    font-size: 0.72rem;
                    font-weight: 700;
                }
                .tonase-chart-frame {
                    border: 1px solid #d8e1ea;
                    background: #fff;
                    padding: 0.75rem;
                    min-height: 320px;
                }
                .tonase-grid-two {
                    display: grid;
                    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
                    gap: 1rem;
                    align-items: start;
                }
                .division-breakdown-table,
                .premium-breakdown-table,
                .tonase-summary-table,
                .tonase-detail-table {
                    table-layout: fixed;
                    width: 100%;
                }
                .division-breakdown-table tfoot td {
                    border-top: 2px solid #334155;
                    background: #eef4f8;
                    color: #0f172a;
                    font-weight: 900;
                }
                .tonase-clickable-row {
                    cursor: pointer;
                }
                .tonase-clickable-row:hover td {
                    background: #ecfdf5;
                }
                .tonase-selected-row td {
                    background: #dff7ef !important;
                }
                .tonase-division-code {
                    color: #0f766e;
                    letter-spacing: 0.02em;
                }
                .tonase-detail-card-grid {
                    display: grid;
                    grid-template-columns: repeat(5, minmax(0, 1fr));
                    gap: 0.75rem;
                    margin-bottom: 0.85rem;
                }
                .tonase-detail-card {
                    border: 1px solid #d8e1ea;
                    background: #fff;
                    padding: 0.75rem;
                }
                .tonase-detail-card span {
                    display: block;
                    color: #64748b;
                    font-size: 0.68rem;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .tonase-detail-card strong {
                    display: block;
                    margin-top: 0.25rem;
                    color: #0f172a;
                    font-size: 1rem;
                    line-height: 1.2;
                }
                .tonase-detail-table-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr);
                    gap: 1rem;
                    align-items: start;
                }
                .tonase-subsection-title {
                    margin-bottom: 0.4rem;
                    color: #0f172a;
                    font-size: 0.82rem;
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                }
                .tonase-detail-mode-table {
                    table-layout: fixed;
                    width: 100%;
                }
                .tonase-muted-cell {
                    padding: 1rem;
                    color: #64748b;
                    font-style: italic;
                }
                .tonase-error {
                    max-width: 720px;
                    margin: 2rem auto;
                }
                @media (max-width: 900px) {
                    .tonase-filter-row,
                    .tonase-mode-row {
                        margin-left: 0;
                    }
                    .tonase-document-mode {
                        align-items: stretch;
                    }
                    .tonase-display-mode-tabs {
                        width: 100%;
                    }
                    .tonase-display-mode-tabs button {
                        flex: 1 1 150px;
                    }
                    .tonase-detail-select {
                        width: 100%;
                    }
                    .tonase-kpi-grid,
                    .tonase-insight-strip,
                    .tonase-detail-card-grid,
                    .tonase-grid-two,
                    .tonase-detail-table-grid {
                        grid-template-columns: 1fr;
                    }
                }
                @media print {
                    @page {
                        size: A4 landscape;
                        margin: 8mm;
                    }
                    .tonase-report-page {
                        padding: 0 !important;
                        background: #fff !important;
                    }
                    #tonase-analysis-report-content {
                        width: 100% !important;
                        max-width: none !important;
                        box-shadow: none !important;
                        border: none !important;
                        padding: 8mm !important;
                    }
                    #tonase-analysis-report-content .tonase-kpi-grid {
                        grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
                        gap: 5mm !important;
                        margin: 4mm 0 !important;
                    }
                    #tonase-analysis-report-content .tonase-kpi-card {
                        min-height: 22mm !important;
                        padding: 3mm !important;
                        break-inside: avoid !important;
                    }
                    #tonase-analysis-report-content .tonase-kpi-label {
                        font-size: 6.5pt !important;
                    }
                    #tonase-analysis-report-content .tonase-kpi-value {
                        font-size: 12pt !important;
                    }
                    #tonase-analysis-report-content .tonase-kpi-note {
                        font-size: 6.5pt !important;
                    }
                    #tonase-analysis-report-content .tonase-insight-strip {
                        grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
                        gap: 4mm !important;
                        margin: 4mm 0 !important;
                    }
                    #tonase-analysis-report-content .tonase-insight-item {
                        padding: 2.5mm !important;
                        break-inside: avoid !important;
                    }
                    #tonase-analysis-report-content .tonase-chart-frame {
                        height: 70mm !important;
                        min-height: 70mm !important;
                        padding: 2mm !important;
                        break-inside: avoid !important;
                    }
                    #tonase-analysis-report-content .tonase-division-breakdown {
                        break-inside: avoid !important;
                    }
                    #tonase-analysis-report-content .tonase-current-detail {
                        break-inside: avoid !important;
                    }
                    #tonase-analysis-report-content .tonase-detail-card-grid {
                        grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
                        gap: 3mm !important;
                    }
                    #tonase-analysis-report-content .tonase-detail-card {
                        padding: 2mm !important;
                    }
                    #tonase-analysis-report-content .tonase-detail-card span {
                        font-size: 6.5pt !important;
                    }
                    #tonase-analysis-report-content .tonase-detail-card strong {
                        font-size: 9pt !important;
                    }
                    #tonase-analysis-report-content .tonase-detail-table-grid {
                        grid-template-columns: 1.4fr 0.8fr !important;
                        gap: 4mm !important;
                    }
                    #tonase-analysis-report-content .tonase-grid-two {
                        grid-template-columns: 1.15fr 0.85fr !important;
                        gap: 5mm !important;
                    }
                    #tonase-analysis-report-content .wsp-table {
                        font-size: 7pt !important;
                    }
                    #tonase-analysis-report-content .wsp-table th,
                    #tonase-analysis-report-content .wsp-table td {
                        padding: 2.4mm 2mm !important;
                        overflow-wrap: anywhere !important;
                    }
                    #tonase-analysis-report-content .tonase-monthly-detail {
                        page-break-before: auto !important;
                        break-before: auto !important;
                    }
                }
            `}} />
        </div>
    );
}
