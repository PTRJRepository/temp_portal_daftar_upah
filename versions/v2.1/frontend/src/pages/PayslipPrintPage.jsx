import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getBatchEmployeeCheckroll, savePayslipHistory } from '../services/payslipService';
import PayslipCard from '../components/PayslipCard';
import { generatePDF } from '../utils/pdfGenerator';
import { Printer, ArrowLeft, FileText, Database, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { buildPayrollSnapshotCacheKey, normalizeSnapshotVersion } from '../utils/payrollSnapshotQuery';
import { printReport } from '../utils/printPageSetup';
import { exportPayslipsToExcel } from '../utils/exportPayslipsToExcel';
import '../styles/payslip-print.css';

/**
 * PayslipPrintPage - Page for printing multiple employee payslips
 * Layout: 4 payslips per A4 page
 */
export default function PayslipPrintPage() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const printRef = useRef(null);

    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [exportingExcel, setExportingExcel] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [payslipData, setPayslipData] = useState([]);
    const [meta, setMeta] = useState(null);

    // Get params from URL
    const empCodes = searchParams.get('emp_codes')?.split(',') || [];
    const month = parseInt(searchParams.get('month')) || new Date().getMonth() + 1;
    const year = parseInt(searchParams.get('year')) || new Date().getFullYear();
    const division = searchParams.get('division') || '';
    const dataKey = searchParams.get('data_key') || '';  // sessionStorage key for UI data
    const useHistory = searchParams.get('use_history') === 'true';
    const snapshotVersion = normalizeSnapshotVersion(searchParams.get('snapshot_version'));

    // Helper function to transform UI row data to PayslipCard format
    function transformUIToPayslipFormat(row, month, year) {
        return {
            emp_code: row.emp_code || row.nik,
            month,
            year,
            employee: {
                nama: row.nama || row.EmpName,
                jabatan: row.jabatan_estate || row.task_desc || row.jabatan || '-',
                gang_code: row.gang_code || row.GangCode,
                alamat: row.alamat || row.res_address || ''
            },
            attendance: {
                summary: {
                    total_hadir: row.hari_kerja || row.kehadiran || 0,
                    cuti_tahunan: row.cuti_tahunan_hari || 0,
                    cuti_sakit: row.cuti_sakit_haid_hari || 0,
                    cuti_minggu: row.cuti_minggu_hari || 0,
                    libur: row.cuti_nasional_hari || 0,
                    alpa: row.alpa || 0
                }
            },
            payroll_data: row  // Pass all UI data directly
        };
    }

    useEffect(() => {
        async function loadData() {
            if (!token || empCodes.length === 0) {
                setError('Tidak ada karyawan yang dipilih');
                setLoading(false);
                return;
            }

            setLoading(true);
            setError('');

            try {
                // OPTIMIZATION 1: Try to read current UI data passed from Daftar Upah.
                // This is MUCH faster than re-fetching from API
                if (dataKey) {
                    const storedData = sessionStorage.getItem(dataKey) || localStorage.getItem(dataKey);
                    if (storedData) {
                        const parsedData = JSON.parse(storedData);
                        const employeeDataMap = parsedData?.data && typeof parsedData.data === 'object'
                            ? parsedData.data
                            : parsedData;
                        console.log('[PayslipPrintPage] ✅ Using fast sessionStorage data from UI');

                        const results = [];
                        empCodes.forEach(code => {
                            const upperCode = code.toUpperCase();
                            const row = employeeDataMap[upperCode];
                            if (row) {
                                // Transform UI row format to PayslipCard format
                                results.push(transformUIToPayslipFormat(row, month, year));
                            }
                        });

                        if (results.length > 0) {
                            setPayslipData(results);
                            setLoading(false);
                            return;
                        }
                    }
                }

                // OPTIMIZATION: Check if data exists in localStorage from CustomPayrollTable
                const storageKey = buildPayrollSnapshotCacheKey({
                    division,
                    month,
                    year,
                    useHistory,
                    snapshotVersion
                });
                const cached = localStorage.getItem(storageKey);

                if (cached) {
                    const { data: employeeDataMap, timestamp } = JSON.parse(cached);
                    // Check if cache is fresh (less than 60 minutes old instead of 15)
                    const isFresh = Date.now() - timestamp < 60 * 60 * 1000;

                    if (isFresh) {
                        const localResults = [];
                        const missingInCache = [];

                        empCodes.forEach(code => {
                            const upperCode = code.toUpperCase();
                            const row = employeeDataMap[upperCode];
                            if (row) {
                                // Transform row into the format PayslipCard expects
                                // Matching CustomPayrollTable row fields to PayslipCard requirements
                                localResults.push({
                                    emp_code: row.emp_code || row.nik,
                                    month,
                                    year,
                                    employee: {
                                        nama: row.emp_name || row.nama,
                                        jabatan: row.jabatan_estate || row.task_desc || row.jabatan,
                                        gang_code: row.gang_code,
                                        alamat: row.alamat || row.res_address || ''
                                    },
                                    attendance: {
                                        summary: {
                                            total_hadir: row.hari_kerja || row.kehadiran || 0,
                                            cuti_tahunan: row.cuti_tahunan_hari || 0,
                                            cuti_sakit: row.cuti_sakit_haid_hari || 0,
                                            cuti_minggu: row.cuti_minggu_hari || 0,
                                            libur: row.cuti_nasional_hari || 0,
                                            alpa: row.alpa || 0
                                        }
                                    },
                                    payroll_data: {
                                        ...row,
                                        // Ensure calculated fields are easily accessible
                                        status_ptkp: row.status_ptkp,
                                        kategori_ter: row.kategori_ter,
                                        tarif_pajak_ter: row.tarif_pajak_ter,
                                        penghasilan_bruto: row.penghasilan_bruto || row.jumlah_upah_kotor,
                                        pph21_ter: row.pph21_ter || row.pot_pph21
                                    }
                                });
                            } else {
                                missingInCache.push(code);
                            }
                        });

                        // If everything was in cache, we're done!
                        if (missingInCache.length === 0) {
                            console.log('[PayslipPrintPage] Using 100% cached data from localStorage');
                            setPayslipData(localResults);
                            setLoading(false);
                            return;
                        }

                        // If some were missing, we proceed to batch fetch for those
                    }
                }

                console.log('[PayslipPrintPage] Fetching data from API...');
                const result = await getBatchEmployeeCheckroll(token, empCodes, month, year, useHistory, snapshotVersion);

                if (result.success) {
                    setPayslipData(result.data || []);
                    setMeta(result.meta);
                } else {
                    setError('Gagal memuat data slip gaji');
                }
            } catch (err) {
                console.error('Failed to load payslip data:', err);
                setError('Gagal memuat data: ' + (err.message || 'Unknown error'));
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, [token, empCodes.join(','), month, year, useHistory, snapshotVersion, division]);

    const handlePrint = () => {
        printReport({ orientation: 'portrait', margin: '0' });
    };

    const handleSaveHistory = async () => {
        if (!token) return;

        setSaving(true);
        setError('');
        setSuccessMessage('');

        try {
            const result = await savePayslipHistory(token, month, year, division);
            if (result.success) {
                setSuccessMessage('✅ Data slip gaji berhasil disimpan ke history database.');
                // Hide message after 5 seconds
                setTimeout(() => setSuccessMessage(''), 5000);
            } else {
                setError('Gagal menyimpan data ke history: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            setError('Error saat menyimpan: ' + (err.message || 'Unknown error'));
        } finally {
            setSaving(false);
        }
    };

    const handleExportPDF = async () => {
        if (!printRef.current) return;
        setExporting(true);
        try {
            const filename = `Slip_Gaji_${division || 'Batch'}_${getMonthName(month)}_${year}.pdf`;
            await generatePDF(printRef.current, filename, {
                jsPDF: { orientation: 'portrait' },
                margin: [0, 0, 0, 0],
                pagebreak: { mode: ['css', 'legacy'], avoid: ['.payslip-card'] }
            });
        } catch (err) {
            console.error('PDF Export error:', err);
        } finally {
            setExporting(false);
        }
    };

    const handleExportExcel = async () => {
        if (!payslipData.length) return;
        setExportingExcel(true);
        try {
            await exportPayslipsToExcel(payslipData, {
                division,
                month,
                year,
                useHistory,
                snapshotVersion
            });
        } catch (err) {
            console.error('Excel Export error:', err);
        } finally {
            setExportingExcel(false);
        }
    };

    const handleBack = () => {
        navigate(-1);
    };

    // Chunk data into groups of 4 for each A4 page
    const chunkArray = (array, size) => {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    };

    const payslipChunks = chunkArray(payslipData, 4);

    // Get month name
    const getMonthName = (m) => {
        const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        return months[m] || '';
    };

    if (loading) {
        return (
            <div className="payslip-preview-container">
                <div className="payslip-loading">
                    <div className="payslip-loading-spinner"></div>
                    <p style={{ marginTop: '1rem', color: '#666' }}>
                        Memuat data slip gaji...
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="payslip-preview-container">
                <div className="payslip-error">
                    <p>❌ {error}</p>
                    <button
                        onClick={handleBack}
                        style={{
                            marginTop: '1rem',
                            padding: '0.5rem 1rem',
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        <ArrowLeft size={16} /> Kembali
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="payslip-preview-container">
            {/* Toolbar - Hidden when printing */}
            <div className="payslip-preview-toolbar">
                <div className="payslip-preview-title">
                    Preview Slip Gaji
                    <span style={{ color: '#666', fontSize: '0.9rem', marginLeft: '1rem' }}>
                        {getMonthName(month)} {year}
                    </span>
                    {useHistory && snapshotVersion && (
                        <span style={{ color: '#7c3aed', fontSize: '0.9rem', marginLeft: '1rem', fontWeight: '600' }}>
                            Snapshot v{snapshotVersion}
                        </span>
                    )}
                    {successMessage && (
                        <span style={{ color: '#059669', fontSize: '0.9rem', marginLeft: '1.5rem', fontWeight: '600' }}>
                            {successMessage}
                        </span>
                    )}
                </div>
                <div className="payslip-preview-actions">
                    <div style={{ marginRight: '1rem', color: '#666', fontSize: '0.9rem' }}>
                        {payslipData.length} karyawan
                        {meta && ` (${meta.successful} berhasil${meta.failed > 0 ? `, ${meta.failed} gagal` : ''})`}
                    </div>
                    <button className="payslip-preview-btn" onClick={handleBack}>
                        <ArrowLeft size={16} /> Kembali
                    </button>
                    <button
                        className="payslip-preview-btn"
                        onClick={handleSaveHistory}
                        disabled={saving}
                        style={successMessage ? { borderColor: '#059669', color: '#059669' } : {}}
                    >
                        {saving ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
                        {saving ? 'Menyimpan...' : 'Simpan ke History'}
                    </button>
                    <button
                        className="payslip-preview-btn"
                        onClick={handleExportPDF}
                        disabled={exporting}
                    >
                        {exporting ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
                        {exporting ? 'Memproses...' : 'Simpan PDF'}
                    </button>
                    <button
                        className="payslip-preview-btn"
                        onClick={handleExportExcel}
                        disabled={exportingExcel}
                    >
                        {exportingExcel ? <RefreshCw size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                        {exportingExcel ? 'Memproses...' : 'Simpan Excel'}
                    </button>
                    <button className="payslip-preview-btn payslip-preview-btn-primary" onClick={handlePrint}>
                        <Printer size={16} /> Print
                    </button>
                </div>
            </div>

            {/* Print Orientation Warning Banner */}
            <div style={{
                background: '#fef3c7',
                borderBottom: '2px solid #f59e0b',
                padding: '8px 20px',
                textAlign: 'center',
                fontSize: '0.85rem'
            }} className="no-print">
                <strong style={{ color: '#b45309' }}>⚠️ WAJIB: </strong>
                <span style={{ color: '#92400e' }}>Saat Print, pilih <strong>Orientation: Portrait</strong> dan <strong>Scale: 100%</strong> agar 4 slip muat di 1 halaman A4</span>
            </div>

            {/* Print Pages */}
            <div className="payslip-print-container" ref={printRef}>
                {payslipChunks.map((chunk, chunkIndex) => (
                    <div
                        key={chunkIndex}
                        className="payslip-a4-page"
                        style={chunkIndex === payslipChunks.length - 1 ? { pageBreakAfter: 'auto' } : {}}
                    >
                        <span className="payslip-cut-line payslip-cut-line--middle" aria-hidden="true"></span>
                        <div className="payslip-grid">
                            {chunk.map((employeeData, slotIndex) => (
                                <PayslipCard
                                    key={employeeData.emp_code || slotIndex}
                                    data={employeeData}
                                    month={month}
                                    year={year}
                                />
                            ))}
                            {/* No empty placeholders - grid handles incomplete pages */}
                        </div>
                    </div>
                ))}
            </div>

            {/* Print Instructions - Hidden when printing */}
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }} className="no-print">
                <div style={{
                    background: '#fef3c7',
                    border: '2px solid #f59e0b',
                    borderRadius: '8px',
                    padding: '12px 20px',
                    marginBottom: '1rem',
                    maxWidth: '600px',
                    margin: '0 auto 1rem auto'
                }}>
                    <strong style={{ color: '#b45309' }}>⚠️ PENTING - Pengaturan Print:</strong>
                    <ul style={{ textAlign: 'left', marginTop: '8px', paddingLeft: '20px' }}>
                        <li><strong>Orientation: Portrait (Tegak)</strong> - WAJIB pilih Portrait</li>
                        <li><strong>Paper Size: A4</strong></li>
                        <li><strong>Scale: 100%</strong> - Jangan pakai "Fit to page"</li>
                        <li><strong>Margins: Minimum</strong></li>
                        <li><strong>Background Graphics: ✓ ON</strong></li>
                    </ul>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <button
                        className="payslip-preview-btn"
                        onClick={handleSaveHistory}
                        disabled={saving}
                    >
                        {saving ? 'Menyimpan History...' : '💾 Simpan ke History Database'}
                    </button>
                    <button
                        className="payslip-preview-btn"
                        onClick={handleExportPDF}
                        disabled={exporting}
                    >
                        {exporting ? 'Memproses PDF...' : '📄 Simpan sebagai PDF'}
                    </button>
                    <button
                        className="payslip-preview-btn"
                        onClick={handleExportExcel}
                        disabled={exportingExcel}
                    >
                        {exportingExcel ? 'Memproses Excel...' : 'Simpan sebagai Excel'}
                    </button>
                    <button
                        className="payslip-preview-btn payslip-preview-btn-primary"
                        onClick={handlePrint}
                    >
                        🖨️ Print Sekarang
                    </button>
                </div>
            </div>
        </div>
    );
}
