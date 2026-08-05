import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
    fetchWagesComparison, 
    fetchAvailableWagesPeriods,
    formatCurrency, 
    formatNumber, 
    getStatusBadge,
    getMonthName 
} from '../services/wagesService';
import { fetchDivisions } from '../services/gangService';
import PrintSignature from './common/PrintSignature';
import ReportPrintMetadata from './common/ReportPrintMetadata';
import ReportWatermark from './common/ReportWatermark';
import { getReportDivisionSummary } from '../utils/divisionPresentation';
import { printReport } from '../utils/printPageSetup';
import './PayrollHistoryComparison.css';
import '../styles/report-print-foundation.css';

/**
 * PayrollHistoryComparison - Detailed comparison between Daftar Upah and Wages
 * 
 * Features:
 * - Period selector (month/year)
 * - Division filter
 * - Comparison table with verification status
 * - Summary KPI cards
 * - Export functionality
 * - Detailed daftar upah breakdown (tunjangan, premi, potongan)
 * - Full daftar upah detail modal
 */
export default function PayrollHistoryComparison({ 
    initialMonth, 
    initialYear, 
    initialDivision,
    onBack 
}) {
    const { token } = useAuth();

    // Filters
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());
    const [division, setDivision] = useState(initialDivision || '');

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialDivision !== undefined) setDivision(initialDivision);
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
    }, [initialDivision, initialMonth, initialYear]);
    
    // Data
    const [comparisonData, setComparisonData] = useState(null);
    const [availablePeriods, setAvailablePeriods] = useState([]);
    const [divisions, setDivisions] = useState([]);
    const [group, setGroup] = useState(''); // New: Group filter
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    
    // View options
    const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, MATCH, MINOR_DIFF, MAJOR_DIFF, NO_WAGES
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedRows, setExpandedRows] = useState({});
    
    // Fetch available periods and divisions on mount
    useEffect(() => {
        if (!token) return;
        
        fetchAvailableWagesPeriods(token)
            .then(res => setAvailablePeriods(res.data || []))
            .catch(err => console.error('Failed to fetch available periods:', err));
            
        fetchDivisions(token)
            .then(res => setDivisions(res || []))
            .catch(err => console.error('Failed to fetch divisions:', err));
    }, [token]);
    
    // Fetch comparison data when filters change
    useEffect(() => {
        if (!token) return;
        loadComparisonData();
    }, [token, month, year, division]);
    
    const loadComparisonData = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchWagesComparison(token, month, year, division || null);
            setComparisonData(result);
        } catch (err) {
            console.error('Failed to load comparison data:', err);
            setError(err.message || 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };
    
    // Helper to extract Asistensi/Group
    const getAsistensi = useCallback((gc, div) => {
        if (!gc) return null;
        const g = gc.trim().toUpperCase();
        if (g.startsWith('K2')) return "1";
        const match = g.match(/\d+/);
        return match ? match[0] : null;
    }, []);

    // Filter data based on status and search
    const filteredData = useMemo(() => {
        if (!comparisonData?.data) return [];
        
        let data = [...comparisonData.data];
        
        // Filter by status
        if (filterStatus !== 'ALL') {
            data = data.filter(item => item.comparison.status === filterStatus);
        }

        // Filter by Group
        if (group) {
            data = data.filter(item => getAsistensi(item.gang_code || item.gang, division) === group);
        }
        
        // Filter by search term
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            data = data.filter(item => 
                (item.nama || '').toLowerCase().includes(term) ||
                (item.nik || '').toLowerCase().includes(term) ||
                (item.emp_code || '').toLowerCase().includes(term) ||
                (item.gang_code || '').toLowerCase().includes(term)
            );
        }
        
        return data;
    }, [comparisonData, filterStatus, group, searchTerm, division, getAsistensi]);
    
    // Summary statistics
    const summaryStats = useMemo(() => {
        if (!comparisonData?.summary) return null;
        return comparisonData.summary;
    }, [comparisonData]);
    
    const toggleRow = (empCode) => {
        setExpandedRows(prev => ({
            ...prev,
            [empCode]: !prev[empCode]
        }));
    };

    // Calculate available groups based on data
    const availableGroups = useMemo(() => {
        if (!comparisonData?.data) return [];
        const groups = new Set();
        comparisonData.data.forEach(item => {
            const asist = getAsistensi(item.gang_code || item.gang, division);
            if (asist) groups.add(asist);
        });
        return Array.from(groups).sort((a, b) => Number(a) - Number(b));
    }, [comparisonData, division, getAsistensi]);

    const reportDivisionSummary = useMemo(() => getReportDivisionSummary({
        division,
        rows: filteredData
    }), [division, filteredData]);
    
    const handleExport = () => {
        if (!filteredData.length) return;

        // Create CSV content
        const headers = [
            'NIK', 'Nama', 'Gang', 'Divisi',
            'HK (Daftar Upah)', 'Tonase (Kg)',
            'HK (Wages)', 'HK Diff',
            'Upah Bersih (Daftar Upah)', 'Upah Bersih (Wages)', 'Upah Diff',
            'Status'
        ];

        const rows = filteredData.map(item => [
            item.nik || '',
            item.nama || '',
            item.gang_code || '',
            item.division_code || '',
            item.daftar_upah?.jumlah_hk || 0,
            item.daftar_upah?.tonase || 0,
            item.wages?.jumlah_hk || 0,
            item.comparison?.hk_difference || 0,
            item.daftar_upah?.upah_bersih || 0,
            item.wages?.upah_bersih || 0,
            item.comparison?.amount_difference || 0,
            item.comparison?.status || ''
        ]);
        
        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
        
        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `wages_comparison_${month}_${year}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };
    
    // Loading state
    if (loading) {
        return (
            <div className="phc-container phc-loading">
                <div className="phc-spinner"></div>
                <p>Memuat data perbandingan...</p>
            </div>
        );
    }
    
    // Error state
    if (error) {
        return (
            <div className="phc-container phc-error">
                <div className="phc-error-icon">⚠</div>
                <p>{error}</p>
                <button onClick={loadComparisonData} className="phc-btn phc-btn-primary">
                    Coba Lagi
                </button>
            </div>
        );
    }
    
    return (
        <div className="phc-container">
            <ReportWatermark />
            {/* Print Header */}
            <div className="phc-print-header only-print">
                <h1 className="phc-print-title">SUMMARY WAGES COMPARISON REPORT</h1>
                <div className="phc-print-meta">
                    <div className="phc-print-meta-item">
                        <strong>Periode:</strong> {getMonthName(month)} {year}
                    </div>
                    <div className="phc-print-meta-item">
                        <strong>Divisi:</strong> {division || 'Semua Divisi'}
                    </div>
                    {group && (
                        <div className="phc-print-meta-item">
                            <strong>Group:</strong> {group}
                        </div>
                    )}
                    <div className="phc-print-meta-item">
                        <strong>Dicetak pada:</strong> {new Date().toLocaleString('id-ID')}
                    </div>
                </div>
                <ReportPrintMetadata
                    mode="Wages Verification"
                    source="PR_EMPWAGES"
                    items={[{ label: 'Pembanding', value: 'Upah Bersih' }]}
                    scope={reportDivisionSummary}
                    note="Detail Wages hanya tersedia untuk nilai net wages yang bisa dibandingkan dengan daftar upah."
                />
            </div>

            {/* Header */}
            <div className="phc-header">
                <div className="phc-header-left">
                    {onBack && (
                        <button onClick={onBack} className="phc-btn phc-btn-back">
                            ← Kembali
                        </button>
                    )}
                    <h1 className="phc-title">Summary Wages Comparison</h1>
                    <span className="phc-period-badge">
                        {getMonthName(month)} {year}
                    </span>
                </div>
                <div className="phc-header-right">
                    <button onClick={() => printReport({ orientation: 'landscape' })} className="phc-btn phc-btn-print">
                        🖨️ Cetak Laporan
                    </button>
                    <button onClick={handleExport} className="phc-btn phc-btn-export" disabled={!filteredData.length}>
                        📥 Export CSV
                    </button>
                </div>
            </div>
            
            {/* Filters */}
            <div className="phc-filters">
                <div className="phc-filter-group">
                    <label>Bulan</label>
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                            <option key={m} value={m}>{getMonthName(m)}</option>
                        ))}
                    </select>
                </div>
                <div className="phc-filter-group">
                    <label>Tahun</label>
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                        {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>
                <div className="phc-filter-group">
                    <label>Divisi</label>
                    <select value={division} onChange={(e) => {
                        setDivision(e.target.value);
                        setGroup(''); // Reset group when division changes
                    }}>
                        <option value="">Semua Divisi</option>
                        {divisions.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                </div>

                <div className="phc-filter-group">
                    <label>Group</label>
                    <select value={group} onChange={(e) => setGroup(e.target.value)}>
                        <option value="">Semua Group</option>
                        {availableGroups.map(g => (
                            <option key={g} value={g}>Group {g}</option>
                        ))}
                    </select>
                </div>
                <div className="phc-filter-group">
                    <label>Status</label>
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                        <option value="ALL">Semua Status</option>
                        <option value="MATCH">✓ Cocok</option>
                        <option value="MINOR_DIFF">⚠ Selisih Kecil</option>
                        <option value="MAJOR_DIFF">✗ Selisih Besar</option>
                        <option value="NO_WAGES">? Tidak Ada Data</option>
                    </select>
                </div>
                <div className="phc-filter-group phc-search">
                    <label>Cari</label>
                    <input 
                        type="text" 
                        placeholder="NIK, Nama, Gang..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>
            
            {/* Summary KPI Cards */}
            {summaryStats && (
                <div className="phc-summary-cards">
                    <div className="phc-kpi-card">
                        <div className="phc-kpi-label">Total Karyawan</div>
                        <div className="phc-kpi-value">{formatNumber(summaryStats.total_employees)}</div>
                    </div>
                    <div className="phc-kpi-card phc-kpi-match">
                        <div className="phc-kpi-label">✓ Cocok</div>
                        <div className="phc-kpi-value">{formatNumber(summaryStats.matched)}</div>
                        <div className="phc-kpi-percent">
                            {summaryStats.total_employees > 0 
                                ? ((summaryStats.matched / summaryStats.total_employees) * 100).toFixed(1) 
                                : 0}%
                        </div>
                    </div>
                    <div className="phc-kpi-card phc-kpi-minor">
                        <div className="phc-kpi-label">⚠ Selisih Kecil</div>
                        <div className="phc-kpi-value">{formatNumber(summaryStats.minor_differences)}</div>
                    </div>
                    <div className="phc-kpi-card phc-kpi-major">
                        <div className="phc-kpi-label">✗ Selisih Besar</div>
                        <div className="phc-kpi-value">{formatNumber(summaryStats.major_differences)}</div>
                    </div>
                    <div className="phc-kpi-card phc-kpi-no-data">
                        <div className="phc-kpi-label">? Tidak Ada Data</div>
                        <div className="phc-kpi-value">{formatNumber(summaryStats.no_wages_data)}</div>
                    </div>
                    <div className="phc-kpi-card phc-kpi-variance">
                        <div className="phc-kpi-label">Total Selisih</div>
                        <div className="phc-kpi-value">{formatCurrency(summaryStats.total_variance)}</div>
                    </div>
                </div>
            )}
            
            {/* Comparison Table */}
            <div className="phc-table-container">
                <table className="phc-table">
                    <thead>
                        <tr className="phc-header-group">
                            <th rowSpan="2" className="phc-th-sticky">No</th>
                            <th rowSpan="2">NIK</th>
                            <th rowSpan="2">Nama</th>
                            <th rowSpan="2">Gang</th>
                            <th colSpan="7" className="phc-th-group">DAFTAR UPAH</th>
                            <th colSpan="3" className="phc-th-group wages">WAGES</th>
                            <th colSpan="3" className="phc-th-group comparison">PERBANDINGAN</th>
                            <th rowSpan="2">Status</th>
                        </tr>
                        <tr className="phc-header-cols">
                            <th>HK</th>
                            <th>Tonase</th>
                            <th>Gaji Pokok</th>
                            <th>Tunjangan</th>
                            <th>Premi</th>
                            <th>Potongan</th>
                            <th>Upah Bersih</th>
                            <th>HK</th>
                            <th>Upah Bersih</th>
                            <th>No. Wages</th>
                            <th>HK Diff</th>
                            <th>Amount Diff</th>
                            <th>Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredData.length === 0 ? (
                            <tr className="phc-empty-row">
                                <td colSpan="17" className="phc-empty-cell">
                                    {comparisonData?.data?.length === 0
                                        ? 'Tidak ada data untuk periode ini'
                                        : 'Tidak ada data yang sesuai filter'}
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((item, idx) => {
                                const badge = getStatusBadge(item.comparison?.status);
                                const isExpanded = expandedRows[item.emp_code];

                                return (
                                    <React.Fragment key={item.emp_code || idx}>
                                        <tr className={`phc-data-row ${item.comparison?.status?.toLowerCase()}`}>
                                            <td className="phc-td-sticky">{idx + 1}</td>
                                            <td>{item.nik || '-'}</td>
                                            <td className="phc-td-name">{item.nama || '-'}</td>
                                            <td>{item.gang_code || '-'}</td>

                                            {/* Daftar Upah columns */}
                                            <td className="phc-td-num">{formatNumber(item.daftar_upah?.jumlah_hk)}</td>
                                            <td className="phc-td-num">{formatNumber(item.daftar_upah?.tonase, 2)}</td>
                                            <td className="phc-td-num">{formatCurrency(item.daftar_upah?.gaji_pokok)}</td>
                                            <td className="phc-td-num">{formatCurrency(item.daftar_upah?.total_tunjangan)}</td>
                                            <td className="phc-td-num">{formatCurrency(item.daftar_upah?.total_premi)}</td>
                                            <td className="phc-td-num phc-td-neg">{formatCurrency(item.daftar_upah?.total_potongan)}</td>
                                            <td className="phc-td-num phc-td-highlight">{formatCurrency(item.daftar_upah?.upah_bersih)}</td>

                                            {/* Wages columns */}
                                            <td className="phc-td-num">{formatNumber(item.wages?.jumlah_hk)}</td>
                                            <td className="phc-td-num phc-td-highlight">{formatCurrency(item.wages?.upah_bersih)}</td>
                                            <td className="phc-td-dim">{item.wages?.wages_no || '-'}</td>

                                            {/* Comparison columns */}
                                            <td className={`phc-td-num ${item.comparison?.hk_difference !== 0 ? 'phc-td-diff' : ''}`}>
                                                {item.comparison?.hk_difference > 0 ? '+' : ''}{formatNumber(item.comparison?.hk_difference)}
                                            </td>
                                            <td className={`phc-td-num ${item.comparison?.amount_difference !== 0 ? 'phc-td-diff' : ''}`}>
                                                {item.comparison?.amount_difference > 0 ? '+' : ''}{formatCurrency(item.comparison?.amount_difference)}
                                            </td>
                                            <td>
                                                <button
                                                    className="phc-expand-btn"
                                                    onClick={() => toggleRow(item.emp_code)}
                                                >
                                                    {isExpanded ? '▼' : '▶'}
                                                </button>
                                            </td>

                                            {/* Status badge */}
                                            <td>
                                                <span
                                                    className="phc-status-badge"
                                                    style={{
                                                        backgroundColor: badge.bgColor,
                                                        color: badge.color
                                                    }}
                                                >
                                                    {badge.icon} {badge.label}
                                                </span>
                                            </td>
                                        </tr>
                                        
                                        {/* Expanded detail row */}
                                        {isExpanded && (
                                            <tr className="phc-detail-row">
                                                <td colSpan="17" className="phc-detail-cell">
                                                    <div className="phc-detail-content">
                                                        {/* Daftar Upah Detail - Full Breakdown */}
                                                        <div className="phc-detail-section">
                                                            <h4>📋 Detail Daftar Upah</h4>
                                                            <div className="phc-detail-grid">
                                                                <div className="phc-detail-group-header" style={{ gridColumn: 'span 2' }}>
                                                                    <strong>Absensi & Produksi</strong>
                                                                </div>
                                                                <div><span>HK:</span> <strong>{formatNumber(item.daftar_upah?.jumlah_hk)}</strong></div>
                                                                <div><span>Tonase:</span> <strong>{formatNumber(item.daftar_upah?.tonase, 2)} Ton</strong></div>
                                                                <div><span>Upah Dasar:</span> {formatCurrency(item.daftar_upah?.upah_dasar)}</div>

                                                                <div className="phc-detail-group-header" style={{ gridColumn: 'span 2' }}>
                                                                    <strong>Penggajian</strong>
                                                                </div>
                                                                <div><span>Gaji Pokok:</span> <strong>{formatCurrency(item.daftar_upah?.gaji_pokok)}</strong></div>
                                                                <div><span>Upah Kotor:</span> {formatCurrency(item.daftar_upah?.jumlah_upah_kotor)}</div>
                                                            </div>
                                                        </div>

                                                        {/* Tunjangan Detail */}
                                                        <div className="phc-detail-section">
                                                            <h4>🎁 Tunjangan Detail</h4>
                                                            <div className="phc-detail-grid">
                                                                <div><span>Beras:</span> {formatCurrency(item.daftar_upah?.beras_jumlah)}</div>
                                                                <div><span>Jabatan:</span> {formatCurrency(item.daftar_upah?.jabatan_jumlah)}</div>
                                                                <div><span>Masa Kerja:</span> {formatCurrency(item.daftar_upah?.masa_kerja_jumlah)}</div>
                                                                <div><span><strong>Total Tunjangan:</strong></span> <strong>{formatCurrency(item.daftar_upah?.total_tunjangan)}</strong></div>
                                                            </div>
                                                            
                                                            <h4 style={{ marginTop: '16px' }}>⏱️ Lembur</h4>
                                                            <div className="phc-detail-grid">
                                                                <div><span>Jam Lembur:</span> {item.daftar_upah?.lembur_jam || 0} jam</div>
                                                                <div><span>Jumlah Lembur:</span> {formatCurrency(item.daftar_upah?.lembur_jumlah)}</div>
                                                            </div>
                                                        </div>

                                                        {/* Premi Detail */}
                                                        <div className="phc-detail-section">
                                                            <h4>⭐ Premi Detail</h4>
                                                            <div className="phc-detail-grid">
                                                                <div><span>Premi Brondol:</span> {formatCurrency(item.daftar_upah?.premi_brondol)}</div>
                                                                <div><span>Premi PPH:</span> {formatCurrency(item.daftar_upah?.premi_pph)}</div>
                                                                <div><span><strong>Total Premi:</strong></span> <strong>{formatCurrency(item.daftar_upah?.total_premi)}</strong></div>
                                                            </div>
                                                            
                                                            <h4 style={{ marginTop: '16px' }}>🏛️ Pajak (PPH21 TER)</h4>
                                                            <div className="phc-detail-grid">
                                                                <div><span>PTKP:</span> {item.daftar_upah?.status_ptkp || '-'}</div>
                                                                <div><span>Kategori TER:</span> {item.daftar_upah?.kategori_ter || '-'}</div>
                                                                <div><span>Tarif:</span> {Number(item.daftar_upah?.tarif_pajak_ter || 0).toFixed(2)}%</div>
                                                                <div><span>PPH21 TER:</span> {formatCurrency(item.daftar_upah?.pph21_ter)}</div>
                                                            </div>
                                                        </div>

                                                        {/* Potongan Detail */}
                                                        <div className="phc-detail-section">
                                                            <h4>📉 Potongan Detail</h4>
                                                            <div className="phc-detail-grid">
                                                                <div><span>SPSI:</span> <span className="phc-text-neg">{formatCurrency(item.daftar_upah?.pot_spsi)}</span></div>
                                                                <div><span>PPH21:</span> <span className="phc-text-neg">{formatCurrency(item.daftar_upah?.pot_pph21)}</span></div>
                                                                <div><span>ASTEK Pekerja:</span> <span className="phc-text-neg">{formatCurrency(item.daftar_upah?.pot_astek_pekerja)}</span></div>
                                                                <div><span>BPJS Kes. Pekerja:</span> <span className="phc-text-neg">{formatCurrency(item.daftar_upah?.pot_bpjs_kesehatan_pekerja)}</span></div>
                                                                <div><span>BPJS Pens. Pekerja:</span> <span className="phc-text-neg">{formatCurrency(item.daftar_upah?.pot_bpjs_pensiun_pekerja)}</span></div>
                                                                <div><span>Koreksi:</span> <span className="phc-text-neg">{formatCurrency(item.daftar_upah?.pot_koreksi)}</span></div>
                                                                <div style={{ gridColumn: 'span 2', borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                                                                    <span><strong>Total Potongan:</strong></span> 
                                                                    <strong className="phc-text-neg">{formatCurrency(item.daftar_upah?.total_potongan)}</strong>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Wages Data */}
                                                        <div className="phc-detail-section">
                                                            <h4>💰 Data Wages (Sistem)</h4>
                                                            {item.wages ? (
                                                                <div className="phc-detail-grid">
                                                                    <div><span>No. Wages:</span> {item.wages.wages_no}</div>
                                                                    <div><span>Tanggal:</span> {item.wages.wages_date ? new Date(item.wages.wages_date).toLocaleDateString('id-ID') : '-'}</div>
                                                                    <div><span>HK (Wages):</span> {formatNumber(item.wages.jumlah_hk)}</div>
                                                                    <div><span>Upah Dasar:</span> {formatCurrency(item.wages.upah_dasar)}</div>
                                                                    <div><span>Gaji Pokok:</span> {formatCurrency(item.wages.gaji_pokok)}</div>
                                                                    <div><span>Total Tunjangan:</span> {formatCurrency(item.wages.total_tunjangan)}</div>
                                                                    <div><span>Total Premi:</span> {formatCurrency(item.wages.total_premi)}</div>
                                                                    <div><span>Total Potongan:</span> <span className="phc-text-neg">{formatCurrency(item.wages.total_potongan)}</span></div>
                                                                    <div style={{ gridColumn: 'span 2', borderTop: '1px solid #e5e7eb', paddingTop: '8px', marginTop: '8px' }}>
                                                                        <span><strong>Upah Bersih (Wages):</strong></span> 
                                                                        <strong>{formatCurrency(item.wages.upah_bersih)}</strong>
                                                                    </div>
                                                                    <div><span>Status:</span> {item.wages.payment_status || '-'}</div>
                                                                </div>
                                                            ) : (
                                                                <p className="phc-no-data">Tidak ada data wages</p>
                                                            )}
                                                        </div>

                                                        {/* Comparison Summary */}
                                                        <div className="phc-detail-section phc-comparison-summary">
                                                            <h4>📊 Ringkasan Perbandingan</h4>
                                                            <div className="phc-detail-grid">
                                                                <div>
                                                                    <span>Selisih HK:</span> 
                                                                    <span className={item.comparison?.hk_difference !== 0 ? 'phc-text-diff' : 'phc-text-ok'}>
                                                                        {item.comparison?.hk_difference > 0 ? '+' : ''}{formatNumber(item.comparison?.hk_difference)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span>Selisih Upah Bersih:</span> 
                                                                    <span className={item.comparison?.amount_difference !== 0 ? 'phc-text-diff' : 'phc-text-ok'}>
                                                                        {item.comparison?.amount_difference > 0 ? '+' : ''}{formatCurrency(item.comparison?.amount_difference)}
                                                                    </span>
                                                                </div>
                                                                <div style={{ gridColumn: 'span 2' }}>
                                                                    <span><strong>Upah Bersih (Daftar Upah):</strong></span>
                                                                    <strong className="phc-text-highlight">{formatCurrency(item.daftar_upah?.upah_bersih)}</strong>
                                                                </div>
                                                                <div style={{ gridColumn: 'span 2' }}>
                                                                    <span><strong>Upah Bersih (Wages):</strong></span>
                                                                    <strong>{item.wages ? formatCurrency(item.wages.upah_bersih) : '-'}</strong>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
            
            {/* Footer info */}
            <div className="comparison-report-container">
                <div className="phc-footer">
                    <div className="phc-footer-info">
                        Menampilkan {filteredData.length} dari {comparisonData?.data?.length || 0} data
                    </div>
                    <div className="phc-footer-legend">
                        <span className="phc-legend-item">
                            <span className="phc-legend-badge match">✓</span> Cocok (selisih ≤ Rp 1.000)
                        </span>
                        <span className="phc-legend-item">
                            <span className="phc-legend-badge minor">⚠</span> Selisih Kecil (≤ Rp 10.000)
                        </span>
                        <span className="phc-legend-item">
                            <span className="phc-legend-badge major">✗</span> Selisih Besar (&gt; Rp 10.000)
                        </span>
                    </div>
                </div>
                
                <div className="print-only">
                    <PrintSignature />
                </div>
            </div>
        </div>
    );
}
