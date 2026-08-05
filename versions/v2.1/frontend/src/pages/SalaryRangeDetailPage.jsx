/**
 * SalaryRangeDetailPage - Detail Gaji Range Report
 * Menampilkan karyawan dengan gaji dalam range tertentu
 * Format landscape compact dengan breakdown lengkap
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import MonthSelector from '../components/common/MonthSelector';
import LoadingScreen from '../components/common/LoadingScreen';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import { fetchReportRowsSimple } from '../services/payrollService';
import { buildSalaryRangeRows, REPORT_ROWS_FETCH_LIMIT } from '../utils/payrollReportFilters';
import { printReport } from '../utils/printPageSetup';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';

const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const SalaryRangeDetailPage = ({
  onBack,
  initialMonth = new Date().getMonth() + 1,
  initialYear = new Date().getFullYear(),
  initialMinSalary = 6000000,
  initialMaxSalary = null
}) => {
    const { token } = useAuth();

    // State for filters
    const [month, setMonth] = useState(initialMonth);
    const [year, setYear] = useState(initialYear);
    const [minSalary, setMinSalary] = useState(initialMinSalary);
    const [maxSalary, setMaxSalary] = useState(initialMaxSalary);

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
        if (initialMinSalary !== undefined) setMinSalary(initialMinSalary);
        if (initialMaxSalary !== undefined) setMaxSalary(initialMaxSalary);
    }, [initialMonth, initialYear, initialMinSalary, initialMaxSalary]);

    // State for data
    const [data, setData] = useState([]);
    const [meta, setMeta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const monthOptions = [
        { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' },
        { value: 3, label: 'Maret' }, { value: 4, label: 'April' },
        { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
        { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' },
        { value: 9, label: 'September' }, { value: 10, label: 'Oktober' },
        { value: 11, label: 'November' }, { value: 12, label: 'Desember' }
    ];

    const fetchData = useCallback(async () => {
        if (!token) {
            setLoading(false);
            setError('Token autentikasi tidak tersedia');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const result = await fetchReportRowsSimple(token, {
                month,
                year,
                skip: 0,
                limit: REPORT_ROWS_FETCH_LIMIT,
                summary_only: 'true',
            }, true);

            if (Array.isArray(result)) {
                throw new Error('Gagal mengambil data payroll report');
            }

            const report = buildSalaryRangeRows(result?.data || [], {
                minSalary,
                maxSalary,
            });
            setData(report.data);
            setMeta({
                ...(result?.meta || {}),
                ...report.meta,
                source_count: result?.data?.length || 0,
            });
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || err.message || 'Gagal mengambil data');
        } finally {
            setLoading(false);
        }
    }, [token, month, year, minSalary, maxSalary]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Helper: Format currency
    const formatCurrency = (num) => {
        if (!num || num === 0) return '-';
        return new Intl.NumberFormat('id-ID').format(num);
    };

    if (loading) {
        return <LoadingScreen isLoading={loading} message="Memuat data..." />;
    }

    const periodLabel = `${monthNames[month - 1]} ${year}`;

    return (
        <div className="wsp-container salary-range-container">
            {/* Action Bar */}
            <div className="wsp-action-bar no-print">
                <div className="left-section" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <button onClick={onBack} className="wsp-btn">
                        KEMBALI
                    </button>

                    <div className="wsp-filter-group" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <MonthSelector
                            month={month}
                            year={year}
                            onChange={(m, y) => { setMonth(m); setYear(y); }}
                        />

                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>Gaji &gt;</span>
                            <input
                                type="number"
                                value={minSalary}
                                onChange={(e) => setMinSalary(parseInt(e.target.value) || 0)}
                                className="wsp-select"
                                style={{ width: '150px', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>-</span>
                            <input
                                type="number"
                                value={maxSalary || ''}
                                onChange={(e) => setMaxSalary(e.target.value ? parseInt(e.target.value) : null)}
                                placeholder="Maksimal (opsional)"
                                className="wsp-select"
                                style={{ width: '180px', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '6px' }}
                            />
                        </div>
                    </div>
                </div>

                <div className="right-section">
                    <button onClick={() => printReport({ orientation: 'landscape' })} className="wsp-btn">
                        PRINT
                    </button>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {/* Report Content - Landscape */}
            <div id="salary-range-report" className="wsp-paper a4-landscape">
                <div className="wsp-header">
                    <h1 className="wsp-company-name">PT. REBINMAS JAYA</h1>
                    <h2 className="wsp-report-title">LAPORAN DETAIL GAJI RANGE</h2>
                    <div className="wsp-subtitle">
                        Periode: {periodLabel} | Gaji Bersih &gt; Rp {formatCurrency(minSalary)}
                        {maxSalary && ` - Rp ${formatCurrency(maxSalary)}`}
                    </div>
                    <ReportPrintMetadata
                        mode="Salary Range Detail"
                        source="Payroll Report API"
                        scope="Karyawan"
                        items={[
                            { label: 'Min', value: `Rp ${formatCurrency(minSalary)}` },
                            { label: 'Max', value: maxSalary ? `Rp ${formatCurrency(maxSalary)}` : '' }
                        ]}
                        note="Daftar menampilkan karyawan dalam range upah bersih yang dipilih."
                    />
                    {meta && (
                        <div className="wsp-meta" style={{ fontSize: '0.8rem', color: '#666' }}>
                            Total Karyawan: {meta.count} | Total Upah Bersih: Rp {formatCurrency(meta.sum_upah_bersih)}
                        </div>
                    )}
                </div>

                <div className="wsp-table-wrapper">
                    <table className="wsp-table salary-range-table">
                        <thead>
                            <tr className="wsp-header-master">
                                <th rowSpan={2} style={{ width: '40px' }}>#</th>
                                <th rowSpan={2} style={{ width: '180px' }}>Karyawan</th>
                                <th rowSpan={2} style={{ width: '120px' }}>Jabatan</th>
                                <th rowSpan={2} className="text-right" style={{ width: '120px' }}>Gaji Aktual</th>
                                <th colSpan={4} className="text-center">Tunjangan</th>
                                <th rowSpan={2} className="text-right" style={{ width: '100px' }}>Total Pot</th>
                                <th rowSpan={2} className="text-right" style={{ width: '120px' }}>Upah Bersih</th>
                            </tr>
                            <tr className="wsp-header-sub">
                                <th className="text-right" style={{ fontSize: '11px', width: '80px' }}>Jabatan</th>
                                <th className="text-right" style={{ fontSize: '11px', width: '80px' }}>Beras</th>
                                <th className="text-right" style={{ fontSize: '11px', width: '80px' }}>Masa Kerja</th>
                                <th className="text-right" style={{ fontSize: '11px', width: '90px', backgroundColor: '#fee2e2' }}>Lembur</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((row, idx) => {
                                const hasLembur = row.lembur_jumlah > 0;
                                return (
                                    <tr key={idx} className={idx % 2 === 0 ? 'wsp-row-even' : 'wsp-row-odd'}>
                                        <td className="text-center">{row.rank}</td>
                                        <td>
                                            <div style={{ fontWeight: '600', fontSize: '13px' }}>{row.nama}</div>
                                            <div style={{ fontSize: '11px', color: '#666' }}>{row.empcode || row.nik}</div>
                                        </td>
                                        <td style={{ fontSize: '12px' }}>{row.jabatan_estate || '-'}</td>
                                        <td className="text-right">{formatCurrency(row.gaji_pokok_aktual)}</td>

                                        {/* Tunjangan Breakdown */}
                                        <td className="text-right" style={{ fontSize: '11px' }}>
                                            {formatCurrency(row.jabatan_jumlah)}
                                        </td>
                                        <td className="text-right" style={{ fontSize: '11px' }}>
                                            {formatCurrency(row.beras_jumlah)}
                                        </td>
                                        <td className="text-right" style={{ fontSize: '11px' }}>
                                            {formatCurrency(row.masa_kerja_jumlah)}
                                        </td>
                                        <td className="text-right">
                                            {hasLembur ? (
                                                <span className="lembur-highlight">
                                                    {formatCurrency(row.lembur_jumlah)}
                                                </span>
                                            ) : (
                                                <span style={{ color: '#999' }}>-</span>
                                            )}
                                        </td>

                                        {/* Total Potongan */}
                                        <td className="text-right" style={{ fontSize: '11px' }}>
                                            {formatCurrency(row.total_potongan_bersih)}
                                        </td>

                                        {/* Upah Bersih */}
                                        <td className="text-right" style={{ fontWeight: 'bold', fontSize: '13px' }}>
                                            {formatCurrency(row.upah_bersih)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        {meta && (
                            <tfoot className="wsp-footer">
                                <tr style={{ backgroundColor: '#f3f4f6', fontWeight: 'bold' }}>
                                    <td colSpan={3} className="text-right">GRAND TOTAL:</td>
                                    <td className="text-right">{formatCurrency(meta.sum_gaji_pokok)}</td>
                                    <td className="text-right">-</td>
                                    <td className="text-right">-</td>
                                    <td className="text-right">-</td>
                                    <td className="text-right">
                                        <span className={meta.sum_lembur > 0 ? 'lembur-highlight' : ''}>
                                            {formatCurrency(meta.sum_lembur)}
                                        </span>
                                    </td>
                                    <td className="text-right">{formatCurrency(meta.sum_potongan)}</td>
                                    <td className="text-right" style={{ fontSize: '14px' }}>
                                        {formatCurrency(meta.sum_upah_bersih)}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Custom Styles */}
            <style>{`
                .salary-range-container {
                    --paper-width: 297mm;
                    --paper-height: 210mm;
                }

                .salary-range-table {
                    font-size: 12px;
                    border-collapse: collapse;
                    width: 100%;
                }

                .salary-range-table th,
                .salary-range-table td {
                    padding: 6px 8px;
                    border: 1px solid #e5e7eb;
                }

                .wsp-row-even {
                    background-color: #f9fafb;
                }

                .wsp-row-odd {
                    background-color: #ffffff;
                }

                .wsp-row-even:hover,
                .wsp-row-odd:hover {
                    background-color: #e0f2fe !important;
                }

                .lembur-highlight {
                    background: #fee2e2;
                    color: #991b1b;
                    font-weight: bold;
                    padding: 2px 6px;
                    border-radius: 4px;
                    display: inline-block;
                    font-size: 11px;
                }

                .text-center {
                    text-align: center;
                }

                .text-right {
                    text-align: right;
                }

                /* Print optimization */
                @media print {
                    .no-print {
                        display: none !important;
                    }

                    .a4-landscape {
                        width: 297mm;
                        height: 210mm;
                        margin: 0;
                        padding: 10mm;
                        page-break-after: always;
                    }

                    @page {
                        size: A4 landscape;
                        margin: 10mm;
                    }
                }
            `}</style>
        </div>
    );
};

export default SalaryRangeDetailPage;
