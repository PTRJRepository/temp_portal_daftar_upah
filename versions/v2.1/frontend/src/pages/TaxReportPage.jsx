import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import { fetchMonthlyTaxReport, fetchAnnualTaxReport, fetchAnnualAstekBpjsReport, fetchDecemberTaxReport, downloadMonthlyTaxReportExcelFromDOM, downloadDecemberTaxReportExcel, exportPajakJson } from '../services/taxReportService';
import { fetchDivisions, fetchGangs } from '../services/gangService';
import { Calculator, BarChart2, CalendarDays, Activity, FileWarning, Search, ChevronDown, ChevronRight, DollarSign, Download, Filter } from 'lucide-react';
import { useCurrentPeriod } from '../hooks/useCurrentPeriod';
import PrintSignature from '../components/common/PrintSignature';
import '../styles/TaxReportPage.css';

// LocalStorage keys for tax report persistence
// Note: Month/Year are now shared globally via ReportContext (report_period_month, report_period_year)
const STORAGE_KEYS = {
    ACTIVE_TAB: 'tax_report_active_tab',
    VALUE_PRIORITY_MODE: 'payroll.value_priority_mode'
};

const normalizeValuePriorityMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'db_ptrj_only' ? 'db_ptrj_only' : 'non_db_ptrj';
};

const loadValuePriorityModeFromStorage = () => {
    try {
        return normalizeValuePriorityMode(localStorage.getItem(STORAGE_KEYS.VALUE_PRIORITY_MODE));
    } catch {
        return 'non_db_ptrj';
    }
};

// Load from localStorage
const loadFromStorage = (key, defaultValue) => {
    try {
        const stored = localStorage.getItem(key);
        return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
        return defaultValue;
    }
};

// Save to localStorage
const saveToStorage = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('Failed to save to localStorage:', e);
    }
};

const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const formatNumber = (val) => {
    if (val === null || val === undefined || val === 0) return '-';
    return new Intl.NumberFormat('id-ID').format(Math.round(val));
};

const formatSignedDeduction = (val) => {
    const amount = Math.abs(Number(val) || 0);
    if (amount === 0) return '-';
    // Guardrail: display one explicit minus from ABS magnitude. Do not render `-${raw}`
    // because a negative raw value would become --200 and hide data sign errors.
    return `-${formatNumber(amount)}`;
};

const formatPercent = (val) => {
    if (val === null || val === undefined || val === 0) return '-';
    return `${val.toFixed(2)}%`;
};

const getMonthlyBonusAmount = (emp) => Number(
    emp?.pendapatan_bonus
    ?? emp?.taxable_pendapatan_bonus
    ?? emp?.bonus_amount
    ?? emp?.exgratia_amount
    ?? emp?.pendapatan_kontan
    ?? emp?.kontanan_amount
    ?? 0
) || 0;

// ================================================================
// TAB 1: Pajak Bulanan (Monthly PPH21)
// ================================================================
function MonthlyTaxTab({ token, month, year, setMonth, setYear, division, gang, gangPrefix, refreshKey, useHistory, snapshotVersion, valuePriorityMode }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [downloadingExcel, setDownloadingExcel] = useState(false);
    const [exportingJson, setExportingJson] = useState(false);
    const [expandedRows, setExpandedRows] = useState(new Set());

    const toggleRow = (empCode) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(empCode)) {
            newExpanded.delete(empCode);
        } else {
            newExpanded.add(empCode);
        }
        setExpandedRows(newExpanded);
    };

    const renderGLInfo = (meta) => {
        if (!meta) return null;
        return (
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', display: 'flex', gap: '8px' }}>
                <span>Task: <strong>{meta.task_code}</strong></span>
                <span>DR: <strong>{meta.dr_acct}</strong></span>
                <span>CR: <strong>{meta.cr_acct}</strong></span>
            </div>
        );
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            console.log('[TaxReportPage] Loading monthly tax report with params:', {
                year,
                month,
                division,
                gang,
                gangPrefix,
                monthName: MONTH_NAMES[month - 1],
                useHistory,
                valuePriorityMode
            });
            const result = await fetchMonthlyTaxReport(token, year, month, division, gang, gangPrefix, useHistory, snapshotVersion, valuePriorityMode);
            const summary = result?.summary || {};
            const monthlyTotals = summary?.monthly_table_totals || {};
            const pph21Summary = summary?.pph21 || {};
            console.log('[TaxReportPage] Monthly tax data loaded:', {
                employeeCount: result?.employees?.length || 0,
                total_pot_pph21: monthlyTotals?.pph21_input || 0,
                total_pph21_ter: monthlyTotals?.pph21_ter || 0,
                selisih: pph21Summary?.selisih || 0,
                data_source: result?.data_source,
                sample_employee: result?.employees?.[0] ? {
                    emp_name: result.employees[0].emp_name,
                    pot_pph21: result.employees[0].pot_pph21,
                    pph21_ter: result.employees[0].pph21_ter,
                    penghasilan_bruto: result.employees[0].penghasilan_bruto,
                    tarif_pajak_ter: result.employees[0].tarif_pajak_ter
                } : null,
            });
            setData(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token, year, month, division, gang, gangPrefix, refreshKey, useHistory, snapshotVersion, valuePriorityMode]);

    const handleDownloadExcel = async () => {
        setDownloadingExcel(true);
        try {
            await downloadMonthlyTaxReportExcelFromDOM(token, year, month, division, gang, gangPrefix, data?.employees || [], data?.premiKeys || []);
        } catch (err) {
            alert('Gagal mengunduh Excel: ' + (err.message || 'Unknown error'));
        } finally {
            setDownloadingExcel(false);
        }
    };

    const handleExportJson = async () => {
        setExportingJson(true);
        try {
            // Use the same useHistory state as the displayed data to ensure consistency
            await exportPajakJson(token, year, month, gang || 'ALL', division, gangPrefix, useHistory, snapshotVersion, valuePriorityMode);
        } catch (err) {
            alert('Gagal export JSON: ' + (err.message || 'Unknown error'));
        } finally {
            setExportingJson(false);
        }
    };

    useEffect(() => {
        console.log('[TaxReportPage] useEffect triggered - calling loadData');
        loadData();
    }, [loadData, useHistory, snapshotVersion]);

    if (loading) return (
        <div className="tax-report-loading">
            <span className="spinner"></span> Memuat data pajak bulanan...
        </div>
    );

    if (error) return (
        <div className="tax-report-empty">
            <h3>⚠️ Error</h3>
            <p>{error}</p>
        </div>
    );

    if (!data || data.employees.length === 0) {
        return (
            <div className="tax-report-empty">
                <h3>📊 Tidak Ada Data</h3>
                <p>Tidak ada data pajak untuk periode yang dipilih.</p>
                <div style={{ marginTop: '1rem', textAlign: 'left', maxWidth: '500px' }}>
                    <p><strong>Possible reasons:</strong></p>
                    <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                        <li>Belum memilih <strong>Divisi</strong> - silakan pilih divisi di toolbar atas</li>
                        <li>Belum ada data payroll untuk periode {MONTH_NAMES[month - 1]} {year}</li>
                        <li>Data payroll belum di-extract atau di-seed ke database</li>
                    </ul>
                    <p style={{ marginTop: '1rem' }}><strong>Troubleshooting:</strong></p>
                    <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                        <li>Pastikan divisi sudah dipilih di filter atas</li>
                        <li>Cek halaman "Daftar Upah" apakah ada data untuk periode yang sama</li>
                        <li>Jika data ada di Daftar Upah tapi tidak muncul di sini, coba refresh halaman</li>
                    </ul>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Export & Actions */}
            <div className="tax-report-actions-bar" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem', gap: '8px' }}>
                {data && data.employees.length > 0 && (
                    <>
                        <button
                            onClick={handleExportJson}
                            disabled={exportingJson}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                backgroundColor: exportingJson ? '#94a3b8' : '#6366f1',
                                color: 'white',
                                border: 'none',
                                padding: '8px 16px',
                                borderRadius: '6px',
                                fontWeight: '600',
                                cursor: exportingJson ? 'not-allowed' : 'pointer',
                                opacity: exportingJson ? 0.7 : 1,
                                transition: 'background-color 0.2s'
                            }}
                        >
                            {exportingJson ? '⏳ Exporting...' : '📤 Export JSON'}
                        </button>
                        <button
                            onClick={handleDownloadExcel}
                            disabled={downloadingExcel}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                backgroundColor: downloadingExcel ? '#94a3b8' : '#10b981',
                                color: 'white',
                                border: 'none',
                                padding: '8px 16px',
                                borderRadius: '6px',
                                fontWeight: '600',
                                cursor: downloadingExcel ? 'not-allowed' : 'pointer',
                                opacity: downloadingExcel ? 0.7 : 1,
                                transition: 'background-color 0.2s'
                            }}
                        >
                            <Download size={16} />
                            {downloadingExcel ? 'Mengunduh...' : 'Unduh Excel (DOM)'}
                        </button>
                    </>
                )}
            </div>

            {/* Data Source Indicator */}
            {data && (
                <div className={`tax-data-source-indicator ${data.data_source === 'current' ? 'source-current' : 'source-history'}`}>
                    {data.data_source === 'current' ? (
                        <>🟢 <strong>PERIODE AKTIF (CURRENT)</strong> — Data diambil langsung dari database original (live)</>
                    ) : (
                        <>📦 <strong>PERIODE HISTORY</strong> — Data diambil dari snapshot history database{data.snapshot_version ? ` (v${data.snapshot_version})` : ''}</>
                    )}
                </div>
            )}

            {!data || data.employees.length === 0 ? (
                <div className="tax-report-empty">
                    <h3><FileWarning size={24} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }} /> Tidak Ada Data</h3>
                    <p>Data pajak untuk {MONTH_NAMES[month - 1]} {year} belum tersedia.{data?.data_source !== 'current' ? ' Pastikan data sudah di-seed melalui Aggregation Seeder.' : ''}</p>
                </div>
            ) : (
                <div className="tax-report-table-wrapper">
                    {/* Header for Print Only */}
                    <div className="print-only" style={{ display: 'none', marginBottom: '20px', textAlign: 'center' }}>
                        <h2 style={{ margin: 0, textTransform: 'uppercase' }}>DAFTAR RINCIAN PPH21 KARYAWAN</h2>
                        <h3 style={{ margin: '5px 0', textTransform: 'uppercase' }}>DIVISI: {division} | GANG: {gang || 'SEMUA'}</h3>
                        <p style={{ margin: 0, fontWeight: 'bold' }}>PERIODE: {MONTH_NAMES[month - 1].toUpperCase()} {year}</p>
                        <div style={{ borderBottom: '2px solid black', margin: '15px 0' }}></div>
                    </div>

                    <table className="tax-report-table">
                        <thead>
                            <tr>
                                <th className="col-no">No</th>
                                <th className="col-name">Nama</th>
                                <th>NIK</th>
                                <th>L/P</th>
                                <th>PTKP</th>
                                <th>TER</th>
                                <th>Gang</th>
                                <th>HK</th>
                                <th title="Upah Dasar">U. Dasar</th>
                                <th title="Upah Dasar × HK">GP Idl</th>
                                <th title="Upah Dasar × 30">Gj Std</th>
                                <th title="GP Aktual">GP Akt</th>
                                <th title="GP Aktual - GP Ideal">Kor HK</th>
                                <th title="Pendapatan Lainnya (THR, Bonus, dll)">Pend. Lainnya</th>
                                <th title="Bonus/Exgratia dari data yang tampil di report pajak">Bonus</th>
                                <th title="Upah Kotor">U. Kotor</th>
                                <th title="Penghasilan Bruto">Bruto</th>
                                <th>Tarif (%)</th>
                                <th>PPH21</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.employees.map((emp, idx) => {
                                const isExpanded = expandedRows.has(emp.emp_code);
                                return (
                                    <React.Fragment key={emp.emp_code}>
                                        <tr
                                            onClick={() => toggleRow(emp.emp_code)}
                                            style={{ cursor: 'pointer' }}
                                            className={isExpanded ? 'active-row' : ''}
                                        >
                                            <td className="text-center col-no">
                                                <span style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }}>
                                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </span>
                                                {idx + 1}
                                            </td>
                                            <td className="col-name">{emp.emp_name}</td>
                                            <td className="text-center" style={{ fontSize: '11px' }}>{emp.new_nik || emp.nik || '-'}</td>
                                            <td className="text-center">{emp.gender === 'L' || emp.gender === 'M' ? 'L' : 'P'}</td>
                                            <td className="text-center">{emp.status_ptkp}</td>
                                            <td className="text-center">{emp.kategori_ter}</td>
                                            <td className="text-center">{emp.gang_code}</td>
                                            <td className="text-right">{formatNumber(emp.hk)}</td>
                                            <td className="text-right">{formatNumber(emp.upah_dasar)}</td>
                                            <td className="text-right">{formatNumber(emp.gaji_pokok_ideal)}</td>
                                            <td className="text-right">{formatNumber((emp.upah_dasar || 0) * 30)}</td>
                                            <td className="text-right">{formatNumber(emp.gaji_pokok_aktual)}</td>
                                            <td className="text-right" style={{ color: (emp.koreksi_hk || 0) < 0 ? '#dc2626' : undefined }}>{formatNumber(emp.koreksi_hk)}</td>
                                            <td className="text-right" style={{ color: '#059669', fontWeight: '600' }}>{formatNumber(emp.pendapatan_tidak_tetap_thp || 0)}</td>
                                            <td className="text-right" style={{ color: '#047857', fontWeight: '600' }}>{formatNumber(getMonthlyBonusAmount(emp))}</td>
                                            <td className="text-right">{formatNumber(emp.upah_kotor)}</td>
                                            <td className="text-right">{formatNumber(emp.penghasilan_bruto)}</td>
                                            <td className="text-center">{formatPercent(emp.tarif_pajak_ter)}</td>
                                            <td className="text-right">{formatNumber(emp.pot_pph21 || emp.pph21_ter)}</td>
                                        </tr>
                                        {isExpanded && (
                                            <tr className="expanded-row-detail" style={{ backgroundColor: '#f8fafc' }}>
                                                <td colSpan={19} style={{ padding: '16px' }}>
                                                    <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start' }}>

                                                        {/* RINCIAN UPAH KOTOR */}
                                                        <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: 'white' }}>
                                                            <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', fontSize: '13px', color: '#1e293b' }}>
                                                                Rincian Upah Kotor
                                                            </h4>
                                                            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                                                <tbody>
                                                                    <tr><td style={{ padding: '4px 0' }}>Hari Kerja (HK)</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.hk)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Upah Dasar</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.upah_dasar)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Gaji Pokok Ideal <span style={{ color: '#64748b', fontSize: '10px' }}>(HK × Upah Dasar)</span></td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber((emp.hk || 0) * (emp.upah_dasar || 0))}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Gaji Standar <span style={{ color: '#64748b', fontSize: '10px' }}>(UD × 30)</span></td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber((emp.upah_dasar || 0) * 30)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Gaji Pokok Aktual {renderGLInfo(emp.component_metadata?.gaji_pokok)}</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.gaji_pokok_aktual)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Koreksi HK</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.koreksi_hk)}</td></tr>
                                                                    <tr><td colSpan={2} style={{ height: '8px', borderBottom: '1px dashed #e2e8f0' }}></td></tr>

                                                                    <tr><td style={{ paddingTop: '8px' }}>Tunjangan Beras {renderGLInfo(emp.component_metadata?.tunjangan_beras)}</td><td className="text-right" style={{ paddingTop: '8px' }}>{formatNumber(emp.tunjangan_beras)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Tunjangan Jabatan {renderGLInfo(emp.component_metadata?.tunjangan_jabatan)}</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.tunjangan_jabatan)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Tunjangan Masa Kerja {renderGLInfo(emp.component_metadata?.masa_kerja)}</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.tunjangan_masa_kerja)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0' }}>Tunjangan Lembur {renderGLInfo(emp.component_metadata?.tunjangan_lembur)}</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.tunjangan_lembur)}</td></tr>

                                                                    <tr><td colSpan={2} style={{ height: '8px', borderBottom: '1px dashed #e2e8f0' }}></td></tr>

                                                                    {/* Uraian Premi - Brondol (tetap) + Dynamic Premi Items */}
                                                                    <tr><td colSpan={2} style={{ paddingTop: '8px', fontWeight: 'bold', color: '#7c3aed', fontSize: '11px' }}>Uraian Premi: {renderGLInfo(emp.component_metadata?.premi)}</td></tr>

                                                                    {/* Premi Brondol - Always shown (fixed premise) */}
                                                                    <tr><td style={{ padding: '3px 0 3px 8px', color: '#7c3aed' }}>Brondol</td><td className="text-right" style={{ padding: '3px 0', color: '#7c3aed' }}>{formatNumber(emp.premi_brondol)}</td></tr>
                                                                    {/* Dynamic Premi Items (non-tetap) */}
                                                                    {emp.premi_detail && Object.keys(emp.premi_detail).length > 0 && (
                                                                        Object.entries(emp.premi_detail).map(([name, val]) => (
                                                                            <tr key={name}>
                                                                                <td style={{ padding: '3px 0 3px 8px', color: '#7c3aed' }}>{name}</td>
                                                                                <td className="text-right" style={{ padding: '3px 0', color: '#7c3aed' }}>{formatNumber(val)}</td>
                                                                            </tr>
                                                                        ))
                                                                    )}
                                                                    {/* Show "Lainnya" if there's remaining premi that's not brondol or dynamic */}
                                                                    {(!emp.premi_detail || Object.keys(emp.premi_detail).length === 0) && (emp.total_premi || 0) - (emp.premi_brondol || 0) > 0 && (
                                                                        <tr><td style={{ padding: '3px 0 3px 8px', color: '#7c3aed' }}>Lainnya</td><td className="text-right" style={{ padding: '3px 0', color: '#7c3aed' }}>{formatNumber((emp.total_premi || 0) - (emp.premi_brondol || 0))}</td></tr>
                                                                    )}
                                                                    <tr><td style={{ padding: '4px 0', fontWeight: 'bold' }}>Total Premi</td><td className="text-right" style={{ padding: '4px 0', fontWeight: 'bold' }}>{formatNumber(emp.total_premi)}</td></tr>
                                                                    <tr><td colSpan={2} style={{ height: '8px', borderBottom: '1px dashed #e2e8f0' }}></td></tr>

                                                                    {/* Pendapatan Lainnya (THR, Bonus, Custom) - ADDED to Upah Kotor */}
                                                                    {emp.pendapatan_tidak_tetap_thp > 0 && (
                                                                        <>
                                                                            <tr><td style={{ paddingTop: '8px', fontWeight: '600', color: '#059669' }}>Pendapatan Lainnya (THR/Bonus)</td><td className="text-right" style={{ paddingTop: '8px', color: '#059669' }}>{formatNumber(emp.pendapatan_tidak_tetap_thp)}</td></tr>
                                                                            <tr><td style={{ padding: '4px 0', color: '#047857' }}>Bonus/Exgratia</td><td className="text-right" style={{ padding: '4px 0', color: '#047857' }}>{formatNumber(getMonthlyBonusAmount(emp))}</td></tr>
                                                                            <tr><td colSpan={2} style={{ height: '8px', borderBottom: '1px dashed #e2e8f0' }}></td></tr>
                                                                        </>
                                                                    )}

                                                                    <tr><td style={{ paddingTop: '8px', color: '#dc2626' }}>Potongan Koreksi</td><td className="text-right" style={{ paddingTop: '8px', color: '#dc2626' }}>{formatSignedDeduction(emp.pot_koreksi)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0', fontWeight: 'bold', color: '#dc2626' }}>Total Potongan (Kotor)</td><td className="text-right" style={{ padding: '4px 0', fontWeight: 'bold', color: '#dc2626' }}>{formatSignedDeduction(emp.total_potongan_kotor)}</td></tr>

                                                                    <tr><td colSpan={2} style={{ height: '8px', borderBottom: '1px solid #94a3b8' }}></td></tr>
                                                                    <tr>
                                                                        <td style={{ paddingTop: '8px', fontWeight: 'bold', fontSize: '13px' }}>TOTAL UPAH KOTOR</td>
                                                                        <td className="text-right" style={{ paddingTop: '8px', fontWeight: 'bold', fontSize: '13px', color: '#0f172a' }}>{formatNumber(emp.upah_kotor)}</td>
                                                                    </tr>

                                                                    {/* Other Incomes (THR, Bonus, Custom DB, etc) */}
                                                                    {emp.other_incomes && emp.other_incomes.length > 0 && (
                                                                        <>
                                                                            <tr><td colSpan={2} style={{ height: '8px', borderBottom: '1px dashed #e2e8f0' }}></td></tr>
                                                                            {emp.other_incomes.map((inc, i) => (
                                                                                <tr key={i}>
                                                                                    <td style={{ padding: '4px 0', color: '#059669' }}>{inc.name || inc.type}</td>
                                                                                    <td className="text-right" style={{ padding: '4px 0', color: '#059669' }}>{formatNumber(inc.amount)}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </>
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        {/* RINCIAN PENGHASILAN BRUTO */}
                                                        <div style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: 'white' }}>
                                                            <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', fontSize: '13px', color: '#1e293b' }}>
                                                                Rincian Penghasilan Bruto (Kena Pajak)
                                                            </h4>
                                                            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                                                <tbody>
                                                                    <tr><td style={{ padding: '4px 0' }}>Upah Kotor</td><td className="text-right" style={{ padding: '4px 0' }}>{formatNumber(emp.upah_kotor)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0', color: '#16a34a' }}>(+) BPJS Kesehatan (Ditanggung Majikan 4%) {renderGLInfo(emp.component_metadata?.bpjs_kes_majikan)} <span style={{ color: '#64748b', fontSize: '10px', display: 'block' }}>4% × (Gaji Standar + Tunj. Masa Kerja)</span></td><td className="text-right" style={{ padding: '4px 0', color: '#16a34a' }}>{formatNumber(emp.bpjs_kes_majikan)}</td></tr>
                                                                    <tr><td style={{ padding: '4px 0', color: '#16a34a' }}>(+) ASTEK JKK/JKM (Ditanggung Majikan 0.84%) <span style={{ color: '#64748b', fontSize: '10px', display: 'block' }}>0.84% × (Gaji Standar + Tunj. Masa Kerja)</span></td><td className="text-right" style={{ padding: '4px 0', color: '#16a34a' }}>{formatNumber(emp.astek_jht_majikan)}</td></tr>
                                                                    <tr><td colSpan={2} style={{ height: '8px', borderBottom: '1px solid #94a3b8' }}></td></tr>

                                                                    <tr>
                                                                        <td style={{ paddingTop: '8px', fontWeight: 'bold', fontSize: '13px' }}>TOTAL PENGHASILAN BRUTO</td>
                                                                        <td className="text-right" style={{ paddingTop: '8px', fontWeight: 'bold', fontSize: '13px', color: '#0f172a' }}>{formatNumber(emp.penghasilan_bruto)}</td>
                                                                    </tr>
                                                                    </tbody>
                                                                    </table>

                                                                    <div style={{ marginTop: '24px', padding: '12px', backgroundColor: '#f1f5f9', borderRadius: '4px', borderLeft: '4px solid #3b82f6' }}>
                                                                    <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#1e293b' }}>Kalkulasi PPH21 (Metode TER)</h4>
                                                                    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                                                    <tbody>
                                                                        <tr><td style={{ padding: '2px 0' }}>Status PTKP Master</td><td className="text-right" style={{ padding: '2px 0', fontWeight: 'bold' }}>{emp.status_ptkp}</td></tr>
                                                                        <tr><td style={{ padding: '2px 0' }}>Kategori TER</td><td className="text-right" style={{ padding: '2px 0', fontWeight: 'bold' }}>{emp.kategori_ter}</td></tr>
                                                                        <tr><td style={{ padding: '2px 0' }}>Tarif Pajak Efektif</td><td className="text-right" style={{ padding: '2px 0', fontWeight: 'bold' }}>{formatPercent(emp.tarif_pajak_ter)}</td></tr>
                                                                        <tr><td colSpan={2} style={{ height: '4px', borderBottom: '1px solid #94a3b8' }}></td></tr>
                                                                        <tr>
                                                                            <td style={{ paddingTop: '4px', fontWeight: 'bold' }}>POTONGAN PPH21 {renderGLInfo(emp.component_metadata?.pph21)}</td>
                                                                            <td className="text-right" style={{ paddingTop: '4px', fontWeight: 'bold', color: '#dc2626' }}>{formatNumber(emp.pph21_ter)}</td>
                                                                        </tr>

                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>

                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={7} className="text-right"><strong>GRAND TOTAL</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.monthly_table_totals?.hk || 0)}</strong></td>
                                <td className="text-right">{formatNumber(data.summary?.monthly_table_totals?.upah_dasar || 0)}</td>
                                <td className="text-right">{formatNumber(data.summary?.monthly_table_totals?.gaji_pokok_ideal || 0)}</td>
                                <td className="text-right">{formatNumber(data.summary?.monthly_table_totals?.gaji_standar || 0)}</td>
                                <td className="text-right">{formatNumber(data.summary?.monthly_table_totals?.gaji_pokok_aktual || 0)}</td>
                                <td className="text-right">{formatNumber(data.summary?.monthly_table_totals?.koreksi_hk || 0)}</td>
                                <td className="text-right" style={{ color: '#059669', fontWeight: '600' }}>{formatNumber(data.summary?.monthly_table_totals?.pendapatan_tidak_tetap_thp || 0)}</td>
                                <td className="text-right" style={{ color: '#047857', fontWeight: '600' }}>{formatNumber(data.employees.reduce((sum, emp) => sum + getMonthlyBonusAmount(emp), 0))}</td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.monthly_table_totals?.upah_kotor || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.monthly_table_totals?.penghasilan_bruto || 0)}</strong></td>
                                <td></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.monthly_table_totals?.pph21_input || 0)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>

                    <div className="print-only">
                        <PrintSignature />
                    </div>
                </div>
            )}
        </div>
    );
}

// ================================================================
// TAB 2: Pajak Tahunan (Annual Tax)
// ================================================================
function AnnualTaxTab({ token, month, year, setMonth, setYear, division, gang, gangPrefix, refreshKey }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [subTab, setSubTab] = useState('penghasilan'); // 'penghasilan' | 'kalkulasi'
    const [penghasilanMode, setPenghasilanMode] = useState('gaji'); // 'gaji' | 'masa_kerja'

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchAnnualTaxReport(token, year, month, division, gang, gangPrefix);
            setData(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token, year, month, division, gang, gangPrefix, refreshKey]);

    useEffect(() => { loadData(); }, [loadData]);

    if (loading) return (
        <div className="tax-report-loading">
            <span className="spinner"></span> Memuat data pajak tahunan (12 bulan)...
        </div>
    );

    if (error) return (
        <div className="tax-report-empty">
            <h3>⚠️ Error</h3>
            <p>{error}</p>
        </div>
    );

    return (
        <div>
            {data && (
                <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: '#64748b' }}>
                    Data tersedia: {data.available_months.map(m => MONTH_NAMES[m - 1]).join(', ') || 'Belum ada'}
                </div>
            )}

            {!data || data.employees.length === 0 ? (
                <div className="tax-report-empty">
                    <h3><FileWarning size={24} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }} /> Tidak Ada Data</h3>
                    <p>Data pajak untuk tahun {year} belum tersedia.</p>
                </div>
            ) : (
                <>
                    {/* Laporan Pajak Tahunan - Single Table Structure */}
                    <h3 className="tax-report-section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <DollarSign size={20} /> Laporan Pajak Tahunan — {year}
                    </h3>
                    {/* Sub-tab Navigation */}
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0' }}>
                        <button
                            onClick={() => setSubTab('penghasilan')}
                            style={{
                                padding: '8px 16px',
                                border: 'none',
                                background: 'none',
                                borderBottom: subTab === 'penghasilan' ? '2px solid #3b82f6' : '2px solid transparent',
                                color: subTab === 'penghasilan' ? '#3b82f6' : '#64748b',
                                fontWeight: subTab === 'penghasilan' ? '600' : '400',
                                cursor: 'pointer'
                            }}
                        >
                            Penghasilan Setahun
                        </button>
                        <button
                            onClick={() => setSubTab('kalkulasi')}
                            style={{
                                padding: '8px 16px',
                                border: 'none',
                                background: 'none',
                                borderBottom: subTab === 'kalkulasi' ? '2px solid #3b82f6' : '2px solid transparent',
                                color: subTab === 'kalkulasi' ? '#3b82f6' : '#64748b',
                                fontWeight: subTab === 'kalkulasi' ? '600' : '400',
                                cursor: 'pointer'
                            }}
                        >
                            Kalkulasi Pajak Setahun
                        </button>
                    </div>

                    <div className="tax-report-table-wrapper" style={{ marginBottom: '2rem' }}>
                        {subTab === 'penghasilan' && (
                            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center' }}>
                                <label style={{ marginRight: '1rem', fontWeight: 'bold', color: '#334155' }}>Tampilkan Uraian Bulanan:</label>
                                <select
                                    value={penghasilanMode}
                                    onChange={(e) => setPenghasilanMode(e.target.value)}
                                    style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '1rem', backgroundColor: '#fff' }}
                                >
                                    <optgroup label="PENGHASILAN">
                                        <option value="gaji">Gaji Kotor</option>
                                    </optgroup>
                                    <optgroup label="BPJS & ASTEK">
                                        <option value="bpjs_kesehatan">BPJS Kesehatan 4% (Majikan)</option>
                                        <option value="astek_ins_084">Astek Ins 0.84% (Majikan)</option>
                                        <option value="astek_ins_2">Astek Ins 2% (Pekerja)</option>
                                        <option value="pensiun_1">Pensiun 1% (Pekerja)</option>
                                    </optgroup>
                                </select>
                                <span style={{ marginLeft: '1rem', fontStyle: 'italic', color: '#64748b', fontSize: '0.9em' }}>
                                    *Pilih uraian untuk melihat rincian bulanannya secara spesifik.
                                </span>
                            </div>
                        )}
                        <table className="tax-report-table">
                            <thead>
                                {subTab === 'penghasilan' ? (
                                    <>
                                        <tr>
                                            <th className="col-no" rowSpan={2}>No</th>
                                            <th className="col-name" rowSpan={2}>Name</th>
                                            <th rowSpan={2}>NIK</th>
                                            <th rowSpan={2}>L/P</th>
                                            <th rowSpan={2}>Stat</th>
                                            <th rowSpan={2}>BL</th>
                                            <th colSpan={12} style={{ textAlign: 'center' }}>
                                                URAIAN BULANAN ({
                                                    penghasilanMode === 'gaji' ? 'GAJI KOTOR' :
                                                        penghasilanMode === 'bpjs_kesehatan' ? 'BPJS KES 4%' :
                                                            penghasilanMode === 'astek_ins_084' ? 'ASTEK INS 0.84%' :
                                                                penghasilanMode === 'astek_ins_2' ? 'ASTEK INS 2%' : 'PENSIUN 1%'
                                                })
                                            </th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>
                                                {penghasilanMode === 'gaji' ? 'TOTAL\nGaji' :
                                                    penghasilanMode === 'bpjs_kesehatan' ? 'TOTAL\nBPJS 4%' :
                                                        penghasilanMode === 'astek_ins_084' ? 'TOTAL\nAst 0.84%' :
                                                            penghasilanMode === 'astek_ins_2' ? 'TOTAL\nAst 2%' : 'TOTAL\nPens 1%'}
                                            </th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>THR</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>Bonus</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>Total<br />Setahun</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>PTKP</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }} title="Penghasilan Kena Pajak">PKP</th>
                                        </tr>
                                        <tr>
                                            {MONTH_NAMES.map((name, idx) => (
                                                <th className="sub-header" key={idx} style={{ textAlign: 'center' }}>{name.substring(0, 3)}</th>
                                            ))}
                                        </tr>
                                    </>
                                ) : (
                                    <>
                                        <tr>
                                            <th className="col-no" rowSpan={2}>No</th>
                                            <th className="col-name" rowSpan={2}>Name</th>
                                            <th rowSpan={2}>NIK</th>
                                            <th colSpan={6} style={{ textAlign: 'center' }}>PENGHASILAN SETAHUN</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>Total<br />Bruto</th>
                                            <th colSpan={4} style={{ textAlign: 'center' }}>POTONGAN</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }} title="Penghasilan Neto Setahun/disetahunkan">Neto<br />Setahun</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>PTKP</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }} title="Penghasilan Kena Pajak">PKP</th>
                                            <th rowSpan={2} style={{ textAlign: 'center' }}>PPh21</th>
                                        </tr>
                                        <tr>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>Gaji<br />Kotor</th>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>THR</th>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>Bonus</th>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>BPJS<br />Kes 4%</th>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>Astek<br />0,84%</th>

                                            <th className="sub-header" style={{ textAlign: 'center' }}>Astek<br />2%</th>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>Biaya<br />Jabatan</th>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>Pens<br />1%</th>
                                            <th className="sub-header" style={{ textAlign: 'center' }}>Tot<br />Pot</th>
                                        </tr>
                                    </>
                                )}
                            </thead>
                            <tbody>
                                {data.employees.map((emp, idx) => (
                                    <tr key={emp.emp_code}>
                                        <td className="text-center col-no">{idx + 1}</td>
                                        <td className="col-name">{emp.emp_name}</td>
                                        <td className="text-center" style={{ fontSize: '11px' }}>{emp.new_nik || emp.nik || '-'}</td>

                                        {subTab === 'penghasilan' ? (
                                            <>
                                                <td className="text-center">{emp.gender === 'L' || emp.gender === 'M' ? 'L' : 'P'}</td>
                                                <td className="text-center">{emp.status_ptkp}</td>
                                                <td className="text-center">{emp.kategori_ter}</td>

                                                {Array.from({ length: 12 }, (_, m) => {
                                                    const val = penghasilanMode === 'gaji'
                                                        ? (emp.monthly_gaji_kotor?.[m + 1] || 0)
                                                        : penghasilanMode === 'bpjs_kesehatan'
                                                            ? (emp.monthly_bpjs_kesehatan?.[m + 1] || 0)
                                                            : penghasilanMode === 'astek_ins_084'
                                                                ? (emp.monthly_astek_ins_084?.[m + 1] || 0)
                                                                : penghasilanMode === 'astek_ins_2'
                                                                    ? (emp.monthly_astek_ins_2?.[m + 1] || 0)
                                                                    : (emp.monthly_pensiun_1?.[m + 1] || 0);
                                                    return <td key={m} className="text-right">{formatNumber(val) || '-'}</td>;
                                                })}

                                                <td className="text-right"><strong>{formatNumber(
                                                    penghasilanMode === 'gaji' ? emp.gaji_jan_nov :
                                                        penghasilanMode === 'bpjs_kesehatan' ? emp.bpjs_kesehatan_4pct :
                                                            penghasilanMode === 'astek_ins_084' ? emp.astek_084pct :
                                                                penghasilanMode === 'astek_ins_2' ? emp.astek_ins_2pct : emp.pensiun_1pct
                                                )}</strong></td>
                                                <td className="text-right">{formatNumber(emp.thr)}</td>
                                                <td className="text-right">{formatNumber(emp.bonus)}</td>

                                                <td className="text-right"><strong>{formatNumber((emp.gaji_jan_nov || 0) + (emp.thr || 0) + (emp.bonus || 0))}</strong></td>

                                                <td className="text-right">{formatNumber(emp.ptkp)}</td>
                                                <td className="text-right">{formatNumber(emp.penghasilan_kena_pajak)}</td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="text-right"><strong>{formatNumber(emp.gaji_jan_nov)}</strong></td>
                                                <td className="text-right">{formatNumber(emp.thr)}</td>
                                                <td className="text-right">{formatNumber(emp.bonus)}</td>
                                                <td className="text-right">{formatNumber(emp.bpjs_kesehatan_4pct)}</td>
                                                <td className="text-right">{formatNumber(emp.astek_084pct)}</td>
                                                <td className="text-right"><strong>{formatNumber(emp.total_penghasilan_setahun)}</strong></td>

                                                <td className="text-right">{formatNumber(emp.astek_ins_2pct)}</td>
                                                <td className="text-right">{formatNumber(emp.biaya_jabatan)}</td>
                                                <td className="text-right">{formatNumber(emp.pensiun_1pct)}</td>
                                                <td className="text-right">{formatNumber(emp.total_potongan_tahunan)}</td>

                                                <td className="text-right">{formatNumber(emp.penghasilan_netto_setahun)}</td>
                                                <td className="text-right">{formatNumber(emp.ptkp)}</td>
                                                <td className="text-right">{formatNumber(emp.penghasilan_kena_pajak)}</td>
                                                <td className="text-right"><strong>{formatNumber(emp.pph21_kena_pajak)}</strong></td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                {subTab === 'penghasilan' ? (
                                    <tr>
                                        <td colSpan={6} className="text-right"><strong>TOTAL</strong></td>
                                        {Array.from({ length: 12 }, (_, m) => (
                                            <td key={m} className="text-right">
                                                <strong>{formatNumber((data.summary?.penghasilan?.monthly_totals_by_mode?.[penghasilanMode] || [])[m] || 0) || '-'}</strong>
                                            </td>
                                        ))}
                                        <td className="text-right"><strong>{formatNumber(data.summary?.penghasilan?.totals?.[penghasilanMode] || 0)}</strong></td>

                                        <td className="text-right"><strong>{formatNumber(data.summary?.penghasilan?.totals?.thr || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.penghasilan?.totals?.bonus || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.penghasilan?.totals?.total_setahun || 0)}</strong></td>

                                        <td className="text-right"><strong>{formatNumber(data.summary?.penghasilan?.totals?.ptkp || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.penghasilan?.totals?.pkp || 0)}</strong></td>
                                    </tr>
                                ) : (
                                    <tr>
                                        <td colSpan={3} className="text-right"><strong>TOTAL</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.gaji_jan_nov || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.thr || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.bonus || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.bpjs_kesehatan_4pct || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.astek_084pct || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.total_penghasilan_setahun || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.astek_ins_2pct || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.biaya_jabatan || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.pensiun_1pct || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.total_potongan_tahunan || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.penghasilan_netto_setahun || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.ptkp || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.pkp || 0)}</strong></td>
                                        <td className="text-right"><strong>{formatNumber(data.summary?.kalkulasi?.totals?.pph21_kena_pajak || 0)}</strong></td>
                                    </tr>
                                )}
                            </tfoot>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

// ================================================================
// TAB 3: ASTEK & BPJS Setahun
// ================================================================
function AstekBpjsTab({ token, month, year, setMonth, setYear, division, gang, gangPrefix, refreshKey }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [astekMode, setAstekMode] = useState('total');

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchAnnualAstekBpjsReport(token, year, month, division, gang, gangPrefix);
            setData(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token, year, month, division, gang, gangPrefix, refreshKey]);

    useEffect(() => { loadData(); }, [loadData]);

    if (loading) return (
        <div className="tax-report-loading">
            <span className="spinner"></span> Memuat data ASTEK & BPJS...
        </div>
    );

    if (error) return (
        <div className="tax-report-empty">
            <h3>⚠️ Error</h3>
            <p>{error}</p>
        </div>
    );

    return (
        <div>
            {data && (
                <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: '#64748b' }}>
                    Data tersedia: {data.available_months.map(m => MONTH_NAMES[m - 1]).join(', ') || 'Belum ada'}
                </div>
            )}

            {data && data.employees.length > 0 && (
                <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center' }}>
                    <label style={{ marginRight: '1rem', fontWeight: 'bold', color: '#334155' }}>Tampilkan Uraian Bulanan:</label>
                    <select
                        value={astekMode}
                        onChange={(e) => setAstekMode(e.target.value)}
                        style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '1rem', backgroundColor: '#fff' }}
                    >
                        <option value="total">Total Seluruh BPJS & Astek (Info)</option>
                        <optgroup label="BPJS Kesehatan">
                            <option value="bpjs_kes_majikan">BPJS Kes 4% (Majikan)</option>
                            <option value="bpjs_kes_pekerja">BPJS Kes 1% (Pekerja)</option>
                        </optgroup>
                        <optgroup label="Astek / Jamsostek">
                            <option value="astek_majikan">Astek 0.84% (Majikan)</option>
                            <option value="astek_pekerja">Astek 2% (Pekerja)</option>
                        </optgroup>
                        <optgroup label="BPJS Pensiun">
                            <option value="bpjs_pensiun_majikan">Pensiun 2% (Majikan)</option>
                            <option value="bpjs_pensiun_pekerja">Pensiun 1% (Pekerja)</option>
                        </optgroup>
                    </select>
                    <span style={{ marginLeft: '1rem', fontStyle: 'italic', color: '#64748b', fontSize: '0.9em' }}>
                        *Pilih uraian untuk melihat rincian bulanannya secara spesifik.
                    </span>
                </div>
            )}

            {!data || data.employees.length === 0 ? (
                <div className="tax-report-empty">
                    <h3><FileWarning size={24} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }} /> Tidak Ada Data</h3>
                    <p>Data ASTEK & BPJS untuk tahun {year} belum tersedia.</p>
                </div>
            ) : (
                <div className="tax-report-table-wrapper">
                    <table className="tax-report-table">
                        <thead>
                            <tr>
                                <th className="col-no" rowSpan={2}>No</th>
                                <th className="col-name" rowSpan={2}>Nama</th>
                                <th rowSpan={2}>NIK</th>
                                <th rowSpan={2} title="Upah Dasar (terakhir)">Upah<br />Dasar</th>
                                <th rowSpan={2} title="Upah Dasar × 30">Gaji Std<br />(UD×30)</th>
                                <th colSpan={12} style={{ textAlign: 'center' }}>
                                    URAIAN BULANAN ({
                                        astekMode === 'total' ? 'TOTAL BPJS & ASTEK' :
                                            astekMode === 'bpjs_kes_majikan' ? 'BPJS Kes 4%' :
                                                astekMode === 'bpjs_kes_pekerja' ? 'BPJS Kes 1%' :
                                                    astekMode === 'astek_majikan' ? 'Astek 0.84%' :
                                                        astekMode === 'astek_pekerja' ? 'Astek 2%' :
                                                            astekMode === 'bpjs_pensiun_majikan' ? 'Pensiun 2%' : 'Pensiun 1%'
                                    })
                                </th>
                                <th rowSpan={2}>TOTAL<br />Jan s/d Des</th>
                            </tr>
                            <tr>
                                {MONTH_NAMES.map((name, idx) => (
                                    <th className="sub-header" key={idx}>{name.substring(0, 3)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.employees.map((emp, idx) => {
                                // Calculate ASTEK+BPJS per month based on mode
                                const monthlyTotals = {};
                                let grandTotal = 0;
                                for (let m = 1; m <= 12; m++) {
                                    const md = emp.monthly_data?.[String(m)];
                                    let total = 0;
                                    if (md) {
                                        if (astekMode === 'total') {
                                            total = md.astek_pekerja + md.astek_majikan + md.bpjs_kes_pekerja + md.bpjs_kes_majikan + md.bpjs_pensiun_pekerja + md.bpjs_pensiun_majikan;
                                        } else {
                                            total = md[astekMode] || 0;
                                        }
                                    }
                                    monthlyTotals[m] = total;
                                    grandTotal += total;
                                }

                                return (
                                    <tr key={emp.emp_code}>
                                        <td className="text-center col-no">{idx + 1}</td>
                                        <td className="col-name">{emp.emp_name}</td>
                                        <td className="text-center" style={{ fontSize: '11px' }}>{emp.new_nik || emp.nik || '-'}</td>
                                        <td className="text-right">{formatNumber(emp.total?.upah_dasar ? emp.total.upah_dasar / Object.keys(emp.monthly_data || {}).length : 0)}</td>
                                        <td className="text-right">{formatNumber(emp.total?.gaji_pokok ? emp.total.gaji_pokok / Object.keys(emp.monthly_data || {}).length : 0)}</td>
                                        {Array.from({ length: 12 }, (_, m) => (
                                            <td key={m} className="text-right">
                                                {formatNumber(monthlyTotals[m + 1])}
                                            </td>
                                        ))}
                                        <td className="text-right"><strong>{formatNumber(grandTotal)}</strong></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={4} className="text-right"><strong>TOTAL</strong></td>
                                <td></td>
                                {Array.from({ length: 12 }, (_, m) => (
                                    <td key={m} className="text-right">
                                        {formatNumber((data.summary?.monthly_totals_by_mode?.[astekMode] || [])[m] || 0)}
                                    </td>
                                ))}
                                <td className="text-right">
                                    <strong>{formatNumber(data.summary?.annual_totals_by_mode?.[astekMode] || 0)}</strong>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}

// ================================================================
// TAB 4: List PPh21 Bulanan (Grid)
// ================================================================
function MonthlyPph21GridTab({ token, month, year, setMonth, setYear, division, gang, gangPrefix, refreshKey }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Popup state for detail view
    const [popupData, setPopupData] = useState(null);
    const [popupLoading, setPopupLoading] = useState(false);
    const [popupError, setPopupError] = useState(null);
    const [popupMeta, setPopupMeta] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchAnnualTaxReport(token, year, month, division, gang, gangPrefix);
            setData(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token, year, month, division, gang, gangPrefix, refreshKey]);

    useEffect(() => { loadData(); }, [loadData]);

    // Handler for clicking a PPh21 cell
    const handleCellClick = useCallback(async (emp, monthIdx) => {
        const clickedMonth = monthIdx + 1;
        const monthName = MONTH_NAMES[monthIdx];
        setPopupMeta({ empName: emp.emp_name, empCode: emp.emp_code, monthIdx: clickedMonth, monthName });
        setPopupError(null);
        setPopupData(null);
        setPopupLoading(true);
        try {
            // No caching - always fetch fresh detail for the popup
            const monthlyResult = await fetchMonthlyTaxReport(token, year, clickedMonth, division, gang, gangPrefix);
            
            const empDetail = monthlyResult.employees?.find(
                e => e.emp_code === emp.emp_code || e.emp_code?.trim() === emp.emp_code?.trim()
            );
            if (empDetail) {
                setPopupData(empDetail);
            } else {
                setPopupError(`Data detail untuk ${emp.emp_name} pada bulan ${monthName} tidak ditemukan.`);
            }
        } catch (err) {
            setPopupError(err.message || 'Gagal memuat detail perhitungan.');
        } finally {
            setPopupLoading(false);
        }
    }, [token, year, division, gang]);

    const closePopup = useCallback(() => {
        setPopupData(null);
        setPopupMeta(null);
        setPopupError(null);
        setPopupLoading(false);
    }, []);

    if (loading) return (
        <div className="tax-report-loading">
            <span className="spinner"></span> Memuat data histori PPH21...
        </div>
    );

    if (error) return (
        <div className="tax-report-empty">
            <h3>⚠️ Error</h3>
            <p>{error}</p>
        </div>
    );

    return (
        <div>
            {data && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: '#64748b' }}>
                    Data tersedia: {data.available_months.map(m => MONTH_NAMES[m - 1]).join(', ') || 'Belum ada'}
                </div>
            )}

            <div style={{ marginBottom: '0.75rem', fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
                💡 Klik angka PPh21 pada cell untuk melihat detail perhitungan.
            </div>

            {!data || data.employees.length === 0 ? (
                <div className="tax-report-empty">
                    <h3><FileWarning size={24} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }} /> Tidak Ada Data</h3>
                    <p>Historis potongan PPh21 untuk tahun {year} belum tersedia.</p>
                </div>
            ) : (
                <div className="tax-report-table-wrapper">
                    <table className="tax-report-table">
                        <thead>
                            <tr>
                                <th className="col-no" rowSpan={2}>No</th>
                                <th className="col-name" rowSpan={2}>Nama</th>
                                <th rowSpan={2}>NIK</th>
                                <th rowSpan={2}>NO.NPWP</th>
                                <th colSpan={12} style={{ textAlign: 'center' }}>PPH 21 TAHUN {year}</th>
                            </tr>
                            <tr>
                                {MONTH_NAMES.map((name, idx) => (
                                    <th className="sub-header" key={idx}>{name.toUpperCase()}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.employees.map((emp, idx) => (
                                <tr key={emp.emp_code}>
                                    <td className="text-center col-no">{idx + 1}</td>
                                    <td className="col-name">{emp.emp_name}</td>
                                    <td className="text-center" style={{ fontSize: '11px' }}>{emp.new_nik || emp.nik || '-'}</td>
                                    <td className="text-center">-</td> {/* Placeholder for NPWP */}
                                    {Array.from({ length: 12 }, (_, m) => {
                                        const val = emp.monthly_pph21_adtrans?.[String(m + 1)] || 0;
                                        return (
                                            <td
                                                key={m}
                                                className="text-right pph21-cell-clickable"
                                                onClick={() => handleCellClick(emp, m)}
                                                title={`Klik untuk detail ${emp.emp_name} - ${MONTH_NAMES[m]}`}
                                            >
                                                {formatNumber(val)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={4} className="text-right"><strong>TOTAL PPH21</strong></td>
                                {Array.from({ length: 12 }, (_, m) => (
                                    <td key={m} className="text-right">
                                        <strong>
                                            {formatNumber((data.summary?.monthly_pph21_adtrans_totals || [])[m] || 0)}
                                        </strong>
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* PPh21 Detail Popup Modal */}
            {popupMeta && (
                <div className="pph21-popup-overlay" onClick={closePopup}>
                    <div className="pph21-popup-modal" onClick={e => e.stopPropagation()}>
                        <div className="pph21-popup-header">
                            <h3>📊 Detail Perhitungan PPh21</h3>
                            <button className="pph21-popup-close" onClick={closePopup}>✕</button>
                        </div>

                        {popupLoading ? (
                            <div className="pph21-popup-loading">
                                <span className="spinner"></span> Memuat detail...
                            </div>
                        ) : popupError ? (
                            <div className="pph21-popup-error">
                                <p>⚠️ {popupError}</p>
                            </div>
                        ) : popupData ? (
                            <div className="pph21-popup-body">
                                {/* Employee Info */}
                                <div className="pph21-popup-info">
                                    <div className="pph21-popup-info-row">
                                        <span className="pph21-popup-label">Nama</span>
                                        <span className="pph21-popup-value"><strong>{popupData.emp_name}</strong></span>
                                    </div>
                                    <div className="pph21-popup-info-row">
                                        <span className="pph21-popup-label">Periode</span>
                                        <span className="pph21-popup-value"><strong>{popupMeta.monthName} {year}</strong></span>
                                    </div>
                                    <div className="pph21-popup-info-row">
                                        <span className="pph21-popup-label">Gang</span>
                                        <span className="pph21-popup-value">{popupData.gang_code || '-'}</span>
                                    </div>
                                    <div className="pph21-popup-info-row">
                                        <span className="pph21-popup-label">Status PTKP</span>
                                        <span className="pph21-popup-value">{popupData.status_ptkp}</span>
                                    </div>
                                    <div className="pph21-popup-info-row">
                                        <span className="pph21-popup-label">Kategori TER</span>
                                        <span className="pph21-popup-value">{popupData.kategori_ter}</span>
                                    </div>
                                </div>

                                {/* Calculation Breakdown Table */}
                                <table className="pph21-popup-table">
                                    <thead>
                                        <tr><th colSpan={2} style={{ textAlign: 'left' }}>Komponen Perhitungan</th></tr>
                                    </thead>
                                    <tbody>
                                        <tr className="pph21-popup-section-title"><td colSpan={2}>📋 Penghasilan</td></tr>
                                        <tr><td>Hari Kerja (HK)</td><td className="text-right">{popupData.hk || 0} hari</td></tr>
                                        <tr><td>Upah Dasar</td><td className="text-right">{formatNumber(popupData.upah_dasar || 0)}</td></tr>
                                        <tr><td>Gaji Pokok Ideal <span style={{ color: '#64748b', fontSize: '10px' }}>(HK × UD)</span></td><td className="text-right">{formatNumber((popupData.hk || 0) * (popupData.upah_dasar || 0))}</td></tr>
                                        <tr><td>Gaji Pokok Standar <span style={{ color: '#64748b', fontSize: '10px' }}>(UD × 30)</span></td><td className="text-right">{formatNumber((popupData.upah_dasar || 0) * 30)}</td></tr>
                                        <tr><td>Gaji Pokok Aktual</td><td className="text-right">{formatNumber(popupData.gaji_pokok_aktual || 0)}</td></tr>
                                        <tr><td>Tunjangan Beras</td><td className="text-right">{formatNumber(popupData.tunjangan_beras || 0)}</td></tr>
                                        <tr><td>Tunjangan Jabatan</td><td className="text-right">{formatNumber(popupData.tunjangan_jabatan || 0)}</td></tr>
                                        <tr><td>Tunjangan Masa Kerja</td><td className="text-right">{formatNumber(popupData.tunjangan_masa_kerja || 0)}</td></tr>
                                        <tr><td>Lembur</td><td className="text-right">{formatNumber(popupData.tunjangan_lembur || 0)}</td></tr>
                                        <tr><td>Total Premi</td><td className="text-right">{formatNumber(popupData.total_premi || 0)}</td></tr>

                                        <tr className="pph21-popup-section-title"><td colSpan={2}>🏢 Ditanggung Majikan</td></tr>
                                        <tr><td>BPJS Kes Majikan (4%)</td><td className="text-right">{formatNumber(popupData.bpjs_kes_majikan || 0)}</td></tr>
                                        <tr><td>Astek JHT Majikan (0.84%)</td><td className="text-right">{formatNumber(popupData.astek_jht_majikan || 0)}</td></tr>

                                        <tr className="pph21-popup-section-title"><td colSpan={2}>📊 Potongan</td></tr>
                                        <tr><td>Pot. SPSI</td><td className="text-right">{formatNumber(popupData.pot_spsi || 0)}</td></tr>
                                        <tr><td>Pot. Koreksi</td><td className="text-right">{formatNumber(popupData.pot_koreksi || 0)}</td></tr>

                                        <tr className="pph21-popup-divider"><td colSpan={2}></td></tr>

                                        <tr className="pph21-popup-section-title"><td colSpan={2}>💰 Kalkulasi PPh21 TER</td></tr>
                                        <tr><td>Upah Kotor</td><td className="text-right">{formatNumber(popupData.upah_kotor || 0)}</td></tr>
                                        <tr className="pph21-popup-highlight">
                                            <td><strong>Penghasilan Bruto</strong></td>
                                            <td className="text-right"><strong>{formatNumber(popupData.penghasilan_bruto || 0)}</strong></td>
                                        </tr>
                                        <tr><td>Tarif TER</td><td className="text-right">{formatPercent(popupData.tarif_pajak_ter || 0)}</td></tr>
                                        <tr className="pph21-popup-result">
                                            <td><strong>PPh21 TER</strong></td>
                                            <td className="text-right"><strong>{formatNumber(popupData.pph21_ter || 0)}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>

                                <div className="pph21-popup-formula">
                                    <em>Formula: PPh21 = Penghasilan Bruto × Tarif TER ({formatPercent(popupData.tarif_pajak_ter || 0)})</em>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
}

// ================================================================
// MAIN: TaxReportPage
// ================================================================

// ================================================================
// TAB 5: Pajak Desember (Dedicated Yearly Tax finalization)
// ================================================================
function DecemberTaxTab({ token, year, division, gang, gangPrefix, refreshKey }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [downloadingExcel, setDownloadingExcel] = useState(false);
    const [error, setError] = useState(null);

    // Popup state for detailed view
    const [popupData, setPopupData] = useState(null);
    const [popupMeta, setPopupMeta] = useState(null);

    const openPopup = (emp, type) => {
        let title = '';
        let formula = '';
        if (type === 'premi_asuransi') {
            title = 'Total Premi Asuransi (12 Bulan)';
            formula = 'Formula: BPJS Kes (4%) + Astek JKK/JKM (0.84%)';
        } else if (type === 'iuran_pensiun') {
            title = 'Total Iuran JHT/JP (12 Bulan)';
            formula = 'Formula: Astek JHT (2%) + BPJS Pensiun (1%)';
        } else if (type === 'pph21_setahun') {
            title = 'Kalkulasi PPh 21 Setahun';
        }

        setPopupData(type === 'pph21_setahun' ? emp : emp.monthly_breakdown[type]);
        setPopupMeta({ empName: emp.emp_name, empCode: emp.emp_code, type, title, formula, emp });
    };

    const closePopup = () => {
        setPopupData(null);
        setPopupMeta(null);
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchDecemberTaxReport(token, year, division, gang, gangPrefix);
            setData(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token, year, division, gang, gangPrefix, refreshKey]);

    const handleDownloadExcel = async () => {
        setDownloadingExcel(true);
        try {
            await downloadDecemberTaxReportExcel(token, year, division, gang, gangPrefix);
        } catch (err) {
            alert('Gagal mengunduh Excel: ' + (err.message || 'Unknown error'));
        } finally {
            setDownloadingExcel(false);
        }
    };

    useEffect(() => { loadData(); }, [loadData]);

    if (loading) return (
        <div className="tax-report-loading">
            <span className="spinner"></span> Memuat data Pajak Desember...
        </div>
    );

    if (error) return (
        <div className="tax-report-empty">
            <h3>⚠️ Error</h3>
            <p>{error}</p>
        </div>
    );

    return (
        <div className="tax-report-panel">
            <div className="tax-report-panel-header">
                <h2>Tabulasi Pajak Desember {year}</h2>
                <div className="tax-report-panel-actions">
                    <button className="tax-report-btn" onClick={loadData}>
                        🔄 Refresh
                    </button>
                    {data && data.employees.length > 0 && (
                        <button
                            onClick={handleDownloadExcel}
                            disabled={downloadingExcel}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                backgroundColor: '#10b981',
                                color: 'white',
                                border: 'none',
                                padding: '8px 16px',
                                borderRadius: '6px',
                                fontWeight: '600',
                                cursor: downloadingExcel ? 'not-allowed' : 'pointer',
                                opacity: downloadingExcel ? 0.7 : 1,
                                transition: 'background-color 0.2s'
                            }}
                        >
                            <Download size={14} /> {downloadingExcel ? 'Mengunduh...' : 'Download Excel'}
                        </button>
                    )}
                </div>
            </div>

            {(!data || data.employees.length === 0) ? (
                <div className="tax-report-empty">
                    Tidak ada data pajak desember untuk divisi/gang ini pada tahun {year}.
                </div>
            ) : (
                <div className="tax-report-table-wrapper" style={{ overflowX: 'auto', maxHeight: '70vh' }}>
                    <table className="tax-report-table">
                        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                            <tr>
                                <th rowSpan="2" className="col-no">No</th>
                                <th rowSpan="2" className="col-name" style={{ minWidth: '150px' }}>NAMA KARYAWAN</th>
                                <th rowSpan="2">NIK / PASPOR</th>
                                <th rowSpan="2">NPWP</th>
                                <th rowSpan="2">ALAMAT</th>
                                <th rowSpan="2">JABATAN</th>
                                <th colSpan="3" className="group-header">STATUS KARYAWAN</th>
                                <th colSpan="5" className="group-header">DESEMBER</th>
                                <th colSpan="3" className="group-header">PENGHASILAN TIDAK TERATUR</th>
                                <th colSpan="7" className="group-header">DISETAHUNKAN</th>
                                <th colSpan="3" className="group-header">PENGURANG</th>
                                <th colSpan="6" className="group-header">KALKULASI PAJAK</th>
                            </tr>
                            <tr className="sub-header">
                                {/* Status Karyawan */}
                                <th>L/P</th>
                                <th>PTKP</th>
                                <th>TER</th>

                                {/* Desember */}
                                <th>Gaji Pokok</th>
                                <th>Total Tunjangan</th>
                                <th>Premi JKK/JKM/Kes</th>
                                <th>Tunjangan PPh</th>
                                <th>Ph. Bruto Des</th>

                                {/* Penghasilan Tidak Teratur */}
                                <th>THR</th>
                                <th>BONUS</th>
                                <th>TANTIEM</th>

                                {/* Disetahunkan */}
                                <th>Total Gaji Pokok</th>
                                <th>Total Tunj. Lainnya</th>
                                <th>Total Premi Asuransi</th>
                                <th>Total Tunj. PPh</th>
                                <th>Total Natura</th>
                                <th>Total THR/Bonus</th>
                                <th>Ph. Bruto Setahun</th>

                                {/* Pengurang */}
                                <th>Biaya Jabatan</th>
                                <th>Total Iuran JHT/JP</th>
                                <th>Ph. Netto Setahun</th>

                                {/* Kalkulasi */}
                                <th>PTKP</th>
                                <th>PKP</th>
                                <th>PPh 21 Setahun</th>
                                <th>PPh 21 Non NPWP</th>
                                <th>PPh 21 Jan S.D Nop</th>
                                <th style={{ minWidth: '100px' }}>PPh 21 Desember</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.employees.map((emp) => (
                                <tr key={emp.emp_code}>
                                    <td className="text-center col-no">{emp.no}</td>
                                    <td className="col-name">{emp.emp_name}</td>
                                    <td className="text-center" style={{ fontSize: '11px' }}>{emp.new_nik || emp.nik || '-'}</td>
                                    <td className="text-center">{emp.npwp}</td>
                                    <td style={{ maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={emp.alamat}>{emp.alamat}</td>
                                    <td className="text-center" style={{ fontSize: '11px' }}>{emp.jabatan || '-'}</td>

                                    <td className="text-center">{emp.gender === 'L' || emp.gender === 'M' ? 'L' : 'P'}</td>
                                    <td className="text-center">{emp.status_ptkp}</td>
                                    <td className="text-center">{emp.kategori_ter}</td>

                                    <td className="text-right">{formatNumber(emp.gaji_pokok_des)}</td>
                                    <td className="text-right">{formatNumber(emp.tunjangan_des)}</td>
                                    <td className="text-right">{formatNumber(emp.premi_asuransi_des)}</td>
                                    <td className="text-right">{formatNumber(emp.tunjangan_pph_des)}</td>
                                    <td className="text-right"><strong>{formatNumber(emp.bruto_des)}</strong></td>

                                    <td className="text-right">{formatNumber(emp.thr)}</td>
                                    <td className="text-right">{formatNumber(emp.bonus)}</td>
                                    <td className="text-right">{formatNumber(emp.tantiem)}</td>

                                    <td className="text-right">{formatNumber(emp.gaji_pokok_setahun)}</td>
                                    <td className="text-right">{formatNumber(emp.tunjangan_lainnya_setahun)}</td>
                                    <td
                                        className="text-right pph21-cell-clickable"
                                        style={{ textDecoration: 'underline', color: '#3b82f6' }}
                                        onClick={() => openPopup(emp, 'premi_asuransi')}
                                        title={`Lihat Rincian Premi Asuransi untuk ${emp.emp_name}`}
                                    >
                                        {formatNumber(emp.premi_asuransi_setahun)}
                                    </td>
                                    <td className="text-right">{formatNumber(emp.tunjangan_pph_setahun)}</td>
                                    <td className="text-right">{formatNumber(emp.natura_setahun)}</td>
                                    <td className="text-right">{formatNumber(emp.thr_bonus_tantiem_setahun)}</td>
                                    <td className="text-right"><strong>{formatNumber(emp.bruto_setahun)}</strong></td>

                                    <td className="text-right">{formatNumber(emp.biaya_jabatan)}</td>
                                    <td
                                        className="text-right pph21-cell-clickable"
                                        style={{ textDecoration: 'underline', color: '#3b82f6' }}
                                        onClick={() => openPopup(emp, 'iuran_pensiun')}
                                        title={`Lihat Rincian Iuran JHT/JP untuk ${emp.emp_name}`}
                                    >
                                        {formatNumber(emp.iuran_jht_jp_setahun)}
                                    </td>
                                    <td className="text-right"><strong>{formatNumber(emp.netto_setahun)}</strong></td>

                                    <td className="text-right">{formatNumber(emp.ptkp)}</td>
                                    <td className="text-right">{formatNumber(emp.pkp)}</td>
                                    <td
                                        className="text-right pph21-cell-clickable"
                                        style={{ textDecoration: 'underline', color: '#3b82f6' }}
                                        onClick={() => openPopup(emp, 'pph21_setahun')}
                                        title={`Lihat Kalkulasi PPh21 untuk ${emp.emp_name}`}
                                    >
                                        <strong>{formatNumber(emp.pph21_setahun)}</strong>
                                    </td>
                                    <td className="text-right"><strong>{formatNumber(emp.pph21_setahun)}</strong></td>
                                    <td className="text-right">{formatNumber(emp.pph21_jan_nov)}</td>
                                    <td className="text-right" style={{ backgroundColor: '#f0fdf4', color: '#15803d', fontWeight: 800 }}>
                                        {formatNumber(emp.pph21_desember)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 10 }}>
                            <tr className="summary-row">
                                <td colSpan="10" className="text-right"><strong>TOTAL</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.gaji_pokok_des || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.tunjangan_des || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.premi_asuransi_des || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.tunjangan_pph_des || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.bruto_des || 0)}</strong></td>

                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.thr || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.bonus || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.tantiem || 0)}</strong></td>

                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.gaji_pokok_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.tunjangan_lainnya_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.premi_asuransi_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.tunjangan_pph_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.natura_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.thr_bonus_tantiem_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.bruto_setahun || 0)}</strong></td>

                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.biaya_jabatan || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.iuran_jht_jp_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.netto_setahun || 0)}</strong></td>

                                <td className="text-right"><strong>-</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.pkp || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.pph21_setahun || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.pph21_non_npwp || 0)}</strong></td>
                                <td className="text-right"><strong>{formatNumber(data.summary?.totals?.pph21_jan_nov || 0)}</strong></td>
                                <td className="text-right" style={{ backgroundColor: '#f0fdf4', color: '#15803d', fontWeight: 800 }}>
                                    <strong>{formatNumber(data.summary?.totals?.pph21_desember || 0)}</strong>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* Modal Popup Rincian */}
            {popupMeta && (
                <div className="pph21-popup-overlay" onClick={closePopup}>
                    <div className="pph21-popup-modal" onClick={e => e.stopPropagation()}>
                        <div className="pph21-popup-header">
                            <h3>📊 {popupMeta.title}</h3>
                            <button className="pph21-popup-close" onClick={closePopup}>✕</button>
                        </div>

                        <div className="pph21-popup-body">
                            <div className="pph21-popup-info" style={{ marginBottom: '16px' }}>
                                <div className="pph21-popup-info-row">
                                    <span className="pph21-popup-label">Nama Karyawan</span>
                                    <span className="pph21-popup-value"><strong>{popupMeta.empName}</strong></span>
                                </div>
                                {popupMeta.formula && (
                                    <div className="pph21-popup-info-row" style={{ marginTop: '8px', color: '#64748b' }}>
                                        <span className="pph21-popup-value" style={{ fontStyle: 'italic' }}>{popupMeta.formula}</span>
                                    </div>
                                )}
                            </div>

                            {['premi_asuransi', 'iuran_pensiun'].includes(popupMeta.type) && popupData && (
                                <table className="pph21-popup-table">
                                    <thead>
                                        <tr>
                                            <th>Bulan</th>
                                            <th className="text-right">Nilai (Rp)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Array.from({ length: 12 }, (_, i) => {
                                            const m = i + 1;
                                            return (
                                                <tr key={m}>
                                                    <td>{MONTH_NAMES[m - 1]}</td>
                                                    <td className="text-right">{formatNumber(popupData[String(m)] || 0)}</td>
                                                </tr>
                                            );
                                        })}
                                        <tr className="pph21-popup-result">
                                            <td><strong>TOTAL SETAHUN</strong></td>
                                            <td className="text-right">
                                                <strong>{formatNumber(
                                                    popupMeta.type === 'premi_asuransi'
                                                        ? (popupMeta.emp?.premi_asuransi_setahun || 0)
                                                        : (popupMeta.emp?.iuran_jht_jp_setahun || 0)
                                                )}</strong>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}

                            {popupMeta.type === 'pph21_setahun' && popupMeta.emp && (
                                <table className="pph21-popup-table">
                                    <thead>
                                        <tr><th colSpan={2} style={{ textAlign: 'left' }}>Alur Kalkulasi Pajak PPh 21 Setahun (Progresif)</th></tr>
                                    </thead>
                                    <tbody>
                                        <tr><td>Penghasilan Bruto Setahun</td><td className="text-right">{formatNumber(popupMeta.emp.bruto_setahun)}</td></tr>
                                        <tr><td style={{ color: '#dc2626' }}>(-) Biaya Jabatan (5%)</td><td className="text-right" style={{ color: '#dc2626' }}>{formatNumber(popupMeta.emp.biaya_jabatan)}</td></tr>
                                        <tr><td style={{ color: '#dc2626' }}>(-) Total Iuran JHT/JP</td><td className="text-right" style={{ color: '#dc2626' }}>{formatNumber(popupMeta.emp.iuran_jht_jp_setahun)}</td></tr>
                                        <tr className="pph21-popup-highlight">
                                            <td><strong>Penghasilan Netto Setahun</strong></td>
                                            <td className="text-right"><strong>{formatNumber(popupMeta.emp.netto_setahun)}</strong></td>
                                        </tr>
                                        <tr><td colSpan={2} style={{ height: '4px' }}></td></tr>
                                        <tr><td style={{ color: '#dc2626' }}>(-) PTKP ({popupMeta.emp.status_ptkp})</td><td className="text-right" style={{ color: '#dc2626' }}>{formatNumber(popupMeta.emp.ptkp)}</td></tr>
                                        <tr className="pph21-popup-highlight" style={{ backgroundColor: '#fff3cd' }}>
                                            <td><strong>PKP (Kena Pajak) Rounded</strong></td>
                                            <td className="text-right"><strong>{formatNumber(popupMeta.emp.pkp)}</strong></td>
                                        </tr>
                                        <tr><td colSpan={2} style={{ height: '4px' }}></td></tr>
                                        <tr className="pph21-popup-result" style={{ backgroundColor: '#d1e7dd', color: '#0f5132' }}>
                                            <td><strong>PPh 21 Setahun (Progresif)</strong></td>
                                            <td className="text-right"><strong>{formatNumber(popupMeta.emp.pph21_setahun)}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


export default function TaxReportPage({ onBack, initialMonth, initialYear, initialDivision }) {
    console.log('[TaxReportPage] Component mounted/rendered');
    const { token, user } = useAuth();
    const {
        month, setMonth,
        year, setYear,
        division, setDivision,
        gang, setGang,
        gangPrefix, setGangPrefix,
        gangs, gangLoading,
        allDivisions,
        isLockedMode
    } = useReport();

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined && initialMonth !== month) setMonth(initialMonth);
        if (initialYear !== undefined && initialYear !== year) setYear(initialYear);
        if (initialDivision !== undefined && initialDivision !== division) setDivision(initialDivision);
    }, [initialMonth, initialYear, initialDivision]);

    // Helper to extract Asistensi (Group)
    // Rule: K2 gangs belong to Group 1 (special estate classification).
    // For all other gangs, extract the first digit found in the gang code.
    const getAsistensi = useCallback((gangCode, divCode) => {
        if (!gangCode) return null;
        const gc = gangCode.trim().toUpperCase();
        // K2 gangs belong to Group 1 (special classification)
        if (gc.startsWith('K2')) return '1';
        // Find the first digit in the string for other patterns (e.g., A1H → '1', K1H → '1')
        const match = gc.match(/\d/);
        return match ? match[0] : null;
    }, []);

    const availablePrefixes = useMemo(() => {
        if (!gangs || gangs.length === 0) return [];
        const prefixes = new Set();
        gangs.forEach(g => {
            const asistensi = getAsistensi(g.gang_code, division);
            if (asistensi) {
                prefixes.add(asistensi);
            }
        });
        return Array.from(prefixes).sort((a, b) => Number(a) - Number(b));
    }, [gangs, division, getAsistensi]);
    const navigate = useNavigate();
    const { data: currentPeriodData } = useCurrentPeriod();
    const isHistorical = currentPeriodData ? (year * 100 + month) < (currentPeriodData.year * 100 + currentPeriodData.month) : false;
    const isCurrent = currentPeriodData ? (year * 100 + month) === (currentPeriodData.year * 100 + currentPeriodData.month) : false;

    // Local state for non-shared filters
    const [activeTab, setActiveTab] = useState(() => loadFromStorage(STORAGE_KEYS.ACTIVE_TAB, 'monthly'));
    const [useHistory, setUseHistory] = useState(false);
    const [snapshotVersion, setSnapshotVersion] = useState('');
    const [valuePriorityMode, setValuePriorityMode] = useState(loadValuePriorityModeFromStorage);

    // Initial load from URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('use_history') === 'true') {
            setUseHistory(true);
        }
        setSnapshotVersion(params.get('snapshot_version') || '');
        const sourceModeParam = params.get('value_priority_mode');
        if (sourceModeParam) {
            setValuePriorityMode(normalizeValuePriorityMode(sourceModeParam));
        }
    }, []);

    // Save to localStorage when values change
    useEffect(() => {
        saveToStorage(STORAGE_KEYS.ACTIVE_TAB, activeTab);
    }, [activeTab]);

    const tabs = [
        { key: 'monthly', label: 'Kalkulasi PPH21', icon: <Calculator size={18} /> },
        { key: 'annual', label: 'Pajak Tahunan', icon: <BarChart2 size={18} /> },
        { key: 'pph21_grid', label: 'Historis PPH21 Setahun', icon: <CalendarDays size={18} /> },
        { key: 'astek', label: 'ASTEK & BPJS', icon: <Activity size={18} /> },
        { key: 'december', label: 'Pajak Desember', icon: <FileWarning size={18} /> },
    ];

    const yearOptions = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const baseYear = year > currentYear ? year : currentYear;
        const years = [];
        for (let y = baseYear + 1; y >= baseYear - 4; y--) years.push(y);
        if (!years.includes(year)) years.push(year);
        return years.sort((a, b) => b - a);
    }, [year]);

    return (
        <div className="tax-report-container">
            {/* Toolbar */}
            <div className="tax-report-toolbar">
                <div className="tax-report-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                        className="tax-report-back-btn"
                        onClick={() => navigate('/')}
                        title="Dashboard"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                    </button>
                    <span className="tax-report-title">Report Pajak</span>

                    {currentPeriodData && isCurrent && (
                        <span style={{ color: '#10b981', marginLeft: '6px', fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', background: '#ecfdf5', padding: '4px 8px', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', marginRight: '6px', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} className="animate-pulse"></span>
                            Current Periode
                        </span>
                    )}
                    {currentPeriodData && isHistorical && (
                        <span style={{ color: '#64748b', marginLeft: '6px', fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', background: '#f1f5f9', padding: '4px 8px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#64748b', marginRight: '6px' }}></span>
                            History Periode
                        </span>
                    )}

                    <div className="tax-report-divider"></div>

                    {/* Filter Controls */}
                    <div className="tax-report-filters" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {/* Period Selector */}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <select
                                value={month}
                                onChange={e => setMonth(Number(e.target.value))}
                                className="tax-report-select"
                                style={{ fontWeight: '500' }}
                            >
                                {MONTH_NAMES.map((name, idx) => (
                                    <option key={idx} value={idx + 1}>{name}</option>
                                ))}
                            </select>
                            <select
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                                className="tax-report-select"
                                style={{ fontWeight: '500' }}
                            >
                                {yearOptions.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>

                        <div className="tax-report-divider" style={{ height: '24px', width: '1px', backgroundColor: '#cbd5e1', margin: '0 4px' }}></div>

                        {/* Division Selector */}
                        <select
                            value={division}
                            onChange={(e) => {
                                setDivision(e.target.value);
                                setGang(''); // Reset gang when division changes
                                setGangPrefix('');
                            }}
                            className="tax-report-select"
                            disabled={isLockedMode}
                        >
                            <option value="">Pilih Divisi...</option>
                            {allDivisions.map((div) => (
                                <option key={div} value={div}>{div}</option>
                            ))}
                        </select>

                        {/* Group Selector */}
                        <select
                            value={gangPrefix}
                            onChange={(e) => {
                                setGangPrefix(e.target.value);
                                setGang(''); // Reset gang if group changes
                            }}
                            className="tax-report-select"
                            disabled={!division || gangLoading || availablePrefixes.length === 0}
                        >
                            <option value="">SEMUA GROUP</option>
                            {availablePrefixes.map((prefix) => (
                                <option key={prefix} value={prefix}>Group {prefix}</option>
                            ))}
                        </select>

                        {/* Gang Selector */}
                        <select
                            value={gang}
                            onChange={(e) => setGang(e.target.value)}
                            className="tax-report-select"
                            disabled={!division || gangLoading}
                        >
                            <option value="">SEMUA GANG</option>
                            {gangs.filter(g => {
                                if (!gangPrefix) return true;
                                return getAsistensi(g.gang_code, division) === gangPrefix;
                            }).map((g) => (
                                <option key={g.gang_code} value={g.gang_code}>
                                    {g.gang_code} - {g.description || g.gang_name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="tax-report-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        className={`tax-report-tab ${activeTab === tab.key ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.key)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        {tab.icon} <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="tax-report-content">
                {activeTab === 'monthly' && (
                    <MonthlyTaxTab
                        token={token}
                        month={month}
                        year={year}
                        setMonth={setMonth}
                        setYear={setYear}
                        division={division}
                        gang={gang}
                        gangPrefix={gangPrefix}
                        useHistory={useHistory}
                        snapshotVersion={snapshotVersion}
                        valuePriorityMode={valuePriorityMode}
                    />
                )}
                {activeTab === 'annual' && (
                    <AnnualTaxTab
                        token={token}
                        month={month}
                        year={year}
                        setMonth={setMonth}
                        setYear={setYear}
                        division={division}
                        gang={gang}
                        gangPrefix={gangPrefix}
                    />
                )}
                {activeTab === 'pph21_grid' && (
                    <MonthlyPph21GridTab
                        token={token}
                        month={month}
                        year={year}
                        setMonth={setMonth}
                        setYear={setYear}
                        division={division}
                        gang={gang}
                        gangPrefix={gangPrefix}
                    />
                )}
                {activeTab === 'astek' && (
                    <AstekBpjsTab
                        token={token}
                        month={month}
                        year={year}
                        setMonth={setMonth}
                        setYear={setYear}
                        division={division}
                        gang={gang}
                        gangPrefix={gangPrefix}
                    />
                )}
                {activeTab === 'december' && (
                    <DecemberTaxTab
                        token={token}
                        year={year}
                        division={division}
                        gang={gang}
                        gangPrefix={gangPrefix}
                    />
                )}
            </div>
        </div>
    );
}
