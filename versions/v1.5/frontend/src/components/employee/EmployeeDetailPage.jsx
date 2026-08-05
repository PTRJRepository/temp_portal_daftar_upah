/**
 * EmployeeDetailPage - Payslip Style + Matrix
 * Displays employee checkroll data as a formal payslip/receipt
 * followed by Attendance and Overtime matrices
 */
import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { getEmployeeCheckroll } from '../../services/employeeDetailService'
import LoadingScreen from '../common/LoadingScreen'
import SalaryHistoryTable from './SalaryHistoryTable'
import ThumbprintVerification from './ThumbprintVerification'
import { EmployeeTrendsCharts } from './EmployeeTrendsCharts'
import { printReport } from '../../utils/printPageSetup'
import './EmployeeDetailPage.css'

// Helper to format currency
const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-'
    // Handle 0 explicitly if needed, but formatter works.
    return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)
}

const formatMultiplier = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return '-'
    const normalized = Number.isInteger(numeric)
        ? numeric.toFixed(0)
        : numeric.toFixed(2).replace(/\.?0+$/, '')
    return `${normalized}x`
}

// ... existing code ...



// Helper to get month name in Indonesian
const getMonthName = (month) => {
    const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
    return months[month] || ''
}

// Helper to format day type to Indonesian
const formatDayType = (dayType, rawDayType) => {
    // If raw_day_type is provided, use it for proper mapping
    if (rawDayType) {
        const typeMap = {
            'WORKDAY_LONG': 'Hari Kerja Panjang',
            'WORKDAY_SHORT': 'Hari Kerja Pendek',
            'SUNDAY': 'Minggu',
            'HOLIDAY_REGULAR': 'Libur Nasional',
            'HOLIDAY_RELIGIOUS': 'Libur Keagamaan',
        };
        return typeMap[rawDayType] || dayType || '-';
    }

    // Fallback to display value
    const typeMap = {
        'Hari Kerja Panjang': 'Hari Kerja Panjang',
        'Hari Kerja Pendek': 'Hari Kerja Pendek',
        'Minggu': 'Minggu',
        'Libur Nasional': 'Libur Nasional',
        'Libur Keagamaan': 'Libur Keagamaan',
        'Hari Kerja': 'Hari Kerja',
    };
    return typeMap[dayType] || dayType || '-';
}

// Helper to get CSS class for day type badge
const getDayTypeClass = (dayType, rawDayType) => {
    // If raw_day_type is provided, use it for CSS class
    if (rawDayType) {
        const classMap = {
            'WORKDAY_LONG': 'day-type-workday-long',
            'WORKDAY_SHORT': 'day-type-workday-short',
            'SUNDAY': 'day-type-sunday',
            'HOLIDAY_REGULAR': 'day-type-holiday',
            'HOLIDAY_RELIGIOUS': 'day-type-holiday-religious',
        };
        return classMap[rawDayType] || 'day-type-default';
    }

    // Fallback to display value
    const classMap = {
        'Hari Kerja Panjang': 'day-type-workday-long',
        'Hari Kerja Pendek': 'day-type-workday-short',
        'Minggu': 'day-type-sunday',
        'Libur Nasional': 'day-type-holiday',
        'Libur Keagamaan': 'day-type-holiday-religious',
        'Hari Kerja': 'day-type-workday',
    };
    return classMap[dayType] || 'day-type-default';
}

// Attendance status colors (Restored)
const statusColors = {
    hadir: { bg: '#10b981', text: '#fff', label: 'H' },
    alpa: { bg: '#ef4444', text: '#fff', label: 'A' },
    sakit: { bg: '#f59e0b', text: '#fff', label: 'S' },
    cuti: { bg: '#8b5cf6', text: '#fff', label: 'C' },
    cuti_tahunan: { bg: '#8b5cf6', text: '#fff', label: 'C' },
    cuti_nasional: { bg: '#3b82f6', text: '#fff', label: 'L' },
    minggu: { bg: '#6b7280', text: '#fff', label: 'M' },
    libur: { bg: '#3b82f6', text: '#fff', label: 'L' },
    libur_nasional: { bg: '#3b82f6', text: '#fff', label: 'L' },
    libur_keagamaan: { bg: '#3b82f6', text: '#fff', label: 'K' },
    no_data: { bg: '#e5e7eb', text: '#9ca3af', label: '-' }
}

export default function EmployeeDetailPage({
    employeeData,  // Full row data passed from PayrollGrid
    month,
    year,
    division,
    useHistoryDb = null,
    snapshotVersion = null,
    onBack
}) {
    const { token } = useAuth()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [checkrollData, setCheckrollData] = useState(null)
    const [historyModalNik, setHistoryModalNik] = useState({ isOpen: false, data: null, loading: false })
    const [overtimeViewMode, setOvertimeViewMode] = useState('detail')

    // Prefer emp_code (Plantware code like B0075) over nik (KTP number)
    const empCode = employeeData?.emp_code || employeeData?.EmpCode || employeeData?.nik || employeeData?.NIK || ''
    const backendUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8002`;

    const handleEditNik = async (empInfo) => {
        const currentNik = empInfo.actual_nik || empInfo.nik || empCode;
        const newNik = window.prompt("Ubah NIK untuk " + (empInfo.nama || empInfo.EmpName || empCode) + ".\n\nMasukkan NIK baru (KTP) atau kosongkan jika ingin kembali ke data awal (Plantware):", currentNik);

        if (newNik === null) return; // cancelled

        try {
            const res = await fetch(`${backendUrl}/employee-hr-data/${empCode}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ field: 'nik_ktp', value: newNik.trim() })
            });
            const json = await res.json();
            if (json.success) {
                alert("NIK berhasil diperbarui!");
                onBack(); // close detail page to refresh list, or can fetch data again
            } else {
                alert("Gagal menyimpan NIK: " + json.error);
            }
        } catch (e) {
            alert("Error: " + e.message);
        }
    };

    const openNikHistory = async () => {
        setHistoryModalNik({ isOpen: true, data: null, loading: true });
        try {
            const res = await fetch(`${backendUrl}/employee-hr-data/${empCode}/history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            if (json.success) {
                setHistoryModalNik({ isOpen: true, data: json.data || [], loading: false });
            } else {
                throw new Error(json.error);
            }
        } catch (e) {
            alert("Gagal memuat history NIK: " + e.message);
            setHistoryModalNik(prev => ({ ...prev, loading: false }));
        }
    };

    const handleRollbackNik = async () => {
        if (!window.confirm("Yakin ingin MENGHAPUS versi terbaru ini dan ROLLBACK NIK ke versi sebelumnya?")) return;
        try {
            const res = await fetch(`${backendUrl}/employee-hr-data/${empCode}/rollback`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            if (json.success) {
                alert("Berhasil di-rollback!");
                onBack();
            } else {
                alert("Gagal rollback: " + json.error);
            }
        } catch (e) {
            alert("Error: " + e.message);
        }
    };

    useEffect(() => {
        async function loadData() {
            if (!token || !empCode) {
                setError('Token atau NIK tidak tersedia')
                setLoading(false)
                return
            }

            setLoading(true)
            setError('')

            try {
                // Fetch checkroll
                const data = await getEmployeeCheckroll(
                    token,
                    empCode,
                    month,
                    year,
                    division,
                    useHistoryDb,
                    snapshotVersion
                );

                console.log('[EmployeeDetailPage] Received Checkroll Data:', data)
                
                // Check if payroll data is empty
                if (!data || (!data.payroll_data && !data.employee)) {
                    throw new Error(`Tidak ditemukan data payroll untuk karyawan ${empCode} pada periode ${month}/${year}. Pastikan data sudah tersedia di database.`);
                }
                
                setCheckrollData(data)
            } catch (e) {
                console.error('Failed to load checkroll data:', e)
                setError('Gagal memuat data checkroll: ' + (e.message || e))
            } finally {
                setLoading(false)
            }
        }
        loadData()
    }, [token, empCode, month, year, division, useHistoryDb, snapshotVersion])

    if (loading) {
        return <LoadingScreen isLoading={true} message="Memuat Data History HR..." />
    }

    if (error) {
        // Check if it's specifically a history/seeding related error
        const isHistoricalMissing = error.toLowerCase().includes('tidak ditemukan') || error.includes('404');
        const isSeedingRelated = error.toLowerCase().includes('seed') || error.toLowerCase().includes('historis');
        
        return (
            <div className="payslip-wrapper" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="error-screen" style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', maxWidth: '600px' }}>
                    <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>{isHistoricalMissing && isSeedingRelated ? '⏳' : '❌'}</div>
                    <h2 style={{ color: '#1e293b', marginBottom: '1rem' }}>
                        {isHistoricalMissing && isSeedingRelated ? 'Data Periode Lalu Tidak Tersedia' : 'Gagal Memuat Data'}
                    </h2>
                    <p style={{ color: '#64748b', marginBottom: '2rem', lineHeight: '1.6' }}>
                        {isHistoricalMissing && isSeedingRelated
                            ? `Data penggajian untuk bulan ${getMonthName(month)} ${year} belum dapat ditampilkan.`
                            : error}
                    </p>
                    {isHistoricalMissing && isSeedingRelated && (
                        <div style={{ textAlign: 'left', backgroundColor: '#fef3c7', padding: '1.5rem', borderRadius: '8px', border: '1px solid #f59e0b', marginBottom: '2rem' }}>
                            <p style={{ color: '#92400e', fontWeight: '600', marginBottom: '0.5rem' }}>⚠️ Mengapa ini terjadi?</p>
                            <p style={{ color: '#78350f', lineHeight: '1.6', fontSize: '0.9rem' }}>
                                Database utama (<code>db_ptrj</code>) hanya menyimpan data operasional untuk <strong>bulan yang sedang berjalan</strong>. 
                                Untuk periode yang sudah lewat, data harus di-seed (disalin) ke database historis (<code>extend_db_ptrj</code>) terlebih dahulu.
                            </p>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                        <button onClick={onBack} style={{
                            padding: '10px 24px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600'
                        }}>
                            Kembali
                        </button>
                        {isHistoricalMissing && isSeedingRelated && (
                            <button onClick={() => window.open('/seeder', '_blank')} style={{
                                padding: '10px 24px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600'
                            }}>
                                Buka Aggregation Seeder
                            </button>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    // Determine the source of data (priority: checkrollData -> employeeData)
    const data = checkrollData?.payroll_data || employeeData || {}
    const empInfo = checkrollData?.employee || employeeData || {}
    const attendance = checkrollData?.attendance || {}
    const overtime = checkrollData?.overtime || {}
    const harvest = checkrollData?.harvest || []
    const overtimeTransactions = Array.isArray(overtime.list) ? overtime.list : []
    const isOvertimeCompact = overtimeViewMode === 'compact'
    const effectiveUpjValue = (() => {
        const found = overtimeTransactions.find((trx) => Number(trx?.upj_value) > 0)
        return found ? Number(found.upj_value) : 0
    })()

    // Helper to safely get numeric values
    const getNum = (key) => {
        const val = data[key] ?? empInfo[key]
        const numeric = Number(val)
        return Number.isFinite(numeric) ? numeric : 0
    }

    const deductionAmount = (value) => Math.abs(Number(value) || 0)
    const getDeduction = (key) => deductionAmount(data[key] ?? empInfo[key])

    // --- CALCULATIONS & DATA PREPARATION ---

    // 1. Gaji Pokok
    const hk = getNum('hari_kerja') || getNum('jumlah_hk')
    const rate = getNum('upah_dasar') || getNum('upah_harian')
    const gajiPokok = getNum('gaji_pokok') || getNum('upah_pokok') || (hk * rate)

    // 2. Tunjangan Breakdown
    const tunjanganList = [
        { label: 'Tunjangan Beras', value: getNum('beras_jumlah') || getNum('tunjangan_beras') },
        { label: 'Tunjangan Jabatan', value: getNum('jabatan_jumlah') || getNum('tunjangan_jabatan') },
        { label: 'Tunjangan Masa Kerja', value: getNum('masa_kerja_jumlah') || getNum('tunjangan_masa_kerja') },
        // Add other tunjangan if any
    ].filter(item => item.value > 0)

    // 3. Premi Breakdown
    const premiList = []

    // Explicit premiums
    if (getNum('premi_brondol') > 0) premiList.push({ label: 'Premi Brondol', value: getNum('premi_brondol') })

    // Track processed normalized keys to avoid duplicate general premiums
    const processedPremiKeys = new Set()

    if (data.premi_details && data.premi_details.length > 0) {
        data.premi_details.forEach(detail => {
            if (detail.amount > 0) {
                // Determine label from doc_desc or fallback to normalized key
                let baseLabel = detail.doc_desc ? detail.doc_desc : detail.normalized_key;
                if (!baseLabel.toUpperCase().includes('PREMI')) {
                    baseLabel = `Premi ${baseLabel}`;
                }

                premiList.push({
                    label: baseLabel,
                    value: detail.amount,
                    task_code: detail.task_code,
                    task_desc: detail.task_desc,
                    doc_desc: detail.doc_desc
                });
                processedPremiKeys.add(detail.normalized_key)
            }
        });
    }

    // Add any other premiums that were added manually or via other channels (not in premi_details)
    if (data.premi && typeof data.premi === 'object') {
        Object.entries(data.premi).forEach(([key, val]) => {
            if (key !== 'premi_brondol' && val > 0 && !processedPremiKeys.has(key)) {
                // Extract label nicely
                const label = key.replace(/_/g, ' ').replace(/premi /i, '').toUpperCase()
                if (!premiList.some(p => p.label === `PREMI ${label}` || p.label === `Premi ${label}`)) {
                    premiList.push({ label: `Premi ${label}`, value: val })
                }
            }
        })
    } else {
        Object.entries(data).forEach(([key, val]) => {
            if (key.startsWith('premi_') && key !== 'premi_brondol' && key !== 'premi_pph' && key !== 'pot_premi_pph' && typeof val === 'number' && val > 0 && !processedPremiKeys.has(key)) {
                const label = key.replace('premi_', '').replace(/_/g, ' ').toUpperCase()
                if (!premiList.some(p => p.label === `Premi ${label}`)) {
                    premiList.push({ label: `Premi ${label}`, value: val })
                }
            }
        })
    }

    const totalPremi = getNum('total_premi')

    // 4. Lembur
    const lemburJam = getNum('lembur_jam') || getNum('total_jam_lembur')
    const lemburJumlah = getNum('lembur_jumlah') || getNum('total_upah_lembur') || getNum('upah_lembur')

    // 5. Potongan Breakdown
    const potKotorList = []
    if (getDeduction('pot_koreksi') > 0) potKotorList.push({ label: 'Koreksi', value: getDeduction('pot_koreksi') })

    Object.entries(data).forEach(([key, val]) => {
        const amount = deductionAmount(val)
        if (key.startsWith('koreksi_') && typeof val === 'number' && amount > 0) {
            const label = key.replace('koreksi_', '').replace(/_/g, ' ').toUpperCase()
            potKotorList.push({ label: `Koreksi ${label}`, value: amount })
        }
    })

    const subtotalPotKotor = potKotorList.reduce((acc, curr) => acc + curr.value, 0)
    const totalPotKotor = getDeduction('potongan_upah_kotor_total') || subtotalPotKotor

    const potBersihList = [
        { label: 'BPJS Kesehatan', value: getDeduction('pot_bpjs_kesehatan_pekerja') || getDeduction('pot_bpjs_kesehatan') },
        { label: 'BPJS Pensiun', value: getDeduction('pot_bpjs_pensiun_pekerja') || getDeduction('pot_bpjs_pensiun') },
        { label: 'Astek Pekerja', value: getDeduction('pot_astek_pekerja') || getDeduction('pot_astek') },
        { label: 'SPSI', value: getDeduction('pot_spsi') },
        { label: 'PPh 21', value: getDeduction('pot_pph21') || getDeduction('pph21_ter') },
    ].filter(item => item.value > 0)

    const standardPotKeys = ['pot_bpjs_kesehatan_pekerja', 'pot_bpjs_kesehatan', 'pot_bpjs_pensiun_pekerja', 'pot_bpjs_pensiun', 'pot_astek', 'pot_astek_pekerja', 'pot_astek_majikan', 'pot_astek_jumlah', 'pot_spsi', 'pot_pph21', 'pot_koreksi', 'potongan_upah_kotor_total', 'total_potongan', 'pot_bpjs_kesehatan_majikan', 'pot_bpjs_pensiun_majikan', 'pot_bpjs_jumlah']

    Object.entries(data).forEach(([key, val]) => {
        const amount = deductionAmount(val)
        if (key.startsWith('pot_') && !standardPotKeys.includes(key) && !key.includes('total') && !key.includes('majikan') && !key.includes('jumlah') && typeof val === 'number' && amount > 0) {
            const label = key.replace('pot_', '').replace(/_/g, ' ').toUpperCase()
            potBersihList.push({ label: label, value: amount })
        }
    })

    const subtotalPotBersih = potBersihList.reduce((acc, curr) => acc + curr.value, 0)
    const totalPotongan = getDeduction('total_potongan') || subtotalPotBersih

    // Totals
    const jumlahUpahKotor = getNum('jumlah_upah_kotor') || getNum('penghasilan_bruto')
    const upahBersih = getNum('upah_bersih')

    // --- CALENDAR DATA ---
    const daysOfWeek = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
    const dateObj = new Date(year, month - 1, 1)
    const firstDayIndex = dateObj.getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const blanks = Array.from({ length: firstDayIndex }, (_, i) => i)
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

    return (
        <div className="payslip-wrapper">
            {/* 1. PAYSLIP SHEET */}
            <div className="payslip-container">

                {/* HEADLINES */}
                <div className="payslip-header">
                    <div className="company-logo">
                        <img src="/images/rebinmas.webp" alt="Logo" onError={(e) => e.target.style.display = 'none'} />
                    </div>
                    <div className="company-info">
                        <h2>PT REBINMAS JAYA</h2>
                        <h3>SLIP GAJI KARYAWAN <span style={{ fontSize: '0.8rem', color: '#999' }}>(Rev 2)</span></h3>
                        <p className="period">Periode: {getMonthName(month)} {year}</p>
                    </div>
                    <div className="payslip-id">
                        NO: {empCode}/{month}{year}
                    </div>
                </div>

                <hr className="dashed-line" />

                {/* EMPLOYEE INFO */}
                <div className="employee-info-grid">
                    <div className="info-row">
                        <span className="label">ID / NIK KTP</span>
                        <span className="separator">:</span>
                        <span className="value bold" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {empCode} / {empInfo.actual_nik || '-'}
                            <button onClick={e => { e.stopPropagation(); handleEditNik(empInfo); }} style={{ background: 'none', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', backgroundColor: 'white' }} title="Edit NIK">✏️ Edit</button>
                            <button onClick={e => { e.stopPropagation(); openNikHistory(); }} style={{ background: 'none', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', backgroundColor: 'white' }} title="Riwayat Versi NIK">⏱️ Riwayat</button>
                        </span>
                    </div>
                    <div className="info-row">
                        <span className="label">NAMA</span>
                        <span className="separator">:</span>
                        <span className="value bold">{empInfo.nama || empInfo.EmpName}</span>
                    </div>
                    <div className="info-row">
                        <span className="label">JABATAN</span>
                        <span className="separator">:</span>
                        <span className="value">{empInfo.jabatan || '-'}</span>
                    </div>
                    <div className="info-row">
                        <span className="label">UNIT/GANG</span>
                        <span className="separator">:</span>
                        <span className="value">{empInfo.gang_code || empInfo.GangCode} ({division})</span>
                    </div>
                    <div className="info-row">
                        <span className="label">STATUS</span>
                        <span className="separator">:</span>
                        <span className="value">{empInfo.status_karyawan || ''}</span>
                    </div>
                    <div className="info-row">
                        <span className="label">HK / RATE</span>
                        <span className="separator">:</span>
                        <span className="value">{hk} Hari / {formatCurrency(rate)}</span>
                    </div>
                </div>

                <hr className="dashed-line" />

                {/* CONTENT COLUMNS */}
                <div className="payslip-content">

                    {/* LEFT COLUMN: PENERIMAAN */}
                    <div className="content-column">
                        <h4 className="column-title">PENERIMAAN (EARNINGS)</h4>

                        <table className="details-table">
                            <tbody>
                                {/* Gaji Pokok */}
                                <tr>
                                    <td className="item-name">Gaji Pokok</td>
                                    <td className="item-amount">{formatCurrency(gajiPokok)}</td>
                                </tr>

                                {/* Tunjangan Group */}
                                {tunjanganList.length > 0 && (
                                    <>
                                        <tr className="group-header"><td colSpan="2">Tunjangan:</td></tr>
                                        {tunjanganList.map((item, idx) => (
                                            <tr key={`tunj-${idx}`}>
                                                <td className="item-name indent">- {item.label}</td>
                                                <td className="item-amount">{formatCurrency(item.value)}</td>
                                            </tr>
                                        ))}
                                    </>
                                )}

                                {/* Premi Group */}
                                {premiList.length > 0 && (
                                    <>
                                        <tr className="group-header"><td colSpan="2">Premi:</td></tr>
                                        {premiList.map((item, idx) => (
                                            <tr key={`prem-${idx}`}>
                                                <td className="item-name indent" style={{ paddingBottom: item.task_code ? '4px' : undefined }}>
                                                    - {item.label}
                                                    {item.task_code && (
                                                        <div style={{ color: '#64748b', fontSize: '0.85em', marginLeft: '12px', marginTop: '2px', fontStyle: 'italic' }}>
                                                            {item.task_code} {item.task_desc ? `- ${item.task_desc}` : ''}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="item-amount" style={{ verticalAlign: 'top', paddingTop: '4px' }}>{formatCurrency(item.value)}</td>
                                            </tr>
                                        ))}
                                    </>
                                )}

                                {/* Lembur */}
                                {lemburJumlah > 0 && (
                                    <tr>
                                        <td className="item-name">Lembur ({lemburJam} Jam)</td>
                                        <td className="item-amount">{formatCurrency(lemburJumlah)}</td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot>
                                <tr className="subtotal-row">
                                    <td>TOTAL KOTOR</td>
                                    <td>{formatCurrency(jumlahUpahKotor)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* VERTICAL DIVIDER */}
                    <div className="vertical-line"></div>

                    {/* RIGHT COLUMN: POTONGAN */}
                    <div className="content-column">
                        <h4 className="column-title">POTONGAN (DEDUCTIONS)</h4>

                        <table className="details-table">
                            <tbody>
                                {/* Potongan Kotor (Koreksi) */}
                                {potKotorList.length > 0 && (
                                    <>
                                        <tr className="group-header"><td colSpan="2">Potongan Upah Kotor:</td></tr>
                                        {potKotorList.map((item, idx) => (
                                            <tr key={`pot-kotor-${idx}`}>
                                                <td className="item-name indent">- {item.label}</td>
                                                <td className="item-amount red-text">{formatCurrency(item.value)}</td>
                                            </tr>
                                        ))}
                                        <tr className="sub-subtotal-row">
                                            <td className="indent"><i>Subtotal Pot. Kotor</i></td>
                                            <td className="red-text"><i>{formatCurrency(totalPotKotor)}</i></td>
                                        </tr>
                                    </>
                                )}

                                {/* Potongan Bersih */}
                                {potBersihList.length > 0 && (
                                    <>
                                        <tr className="group-header"><td colSpan="2">Potongan Upah Bersih:</td></tr>
                                        {potBersihList.map((item, idx) => (
                                            <tr key={`pot-bersih-${idx}`}>
                                                <td className="item-name indent">- {item.label}</td>
                                                <td className="item-amount red-text">{formatCurrency(item.value)}</td>
                                            </tr>
                                        ))}
                                        <tr className="sub-subtotal-row">
                                            <td className="indent"><i>Subtotal Pot. Bersih</i></td>
                                            <td className="red-text"><i>{formatCurrency(subtotalPotBersih)}</i></td>
                                        </tr>
                                    </>
                                )}
                            </tbody>
                            <tfoot>
                                <tr className="subtotal-row">
                                    <td>TOTAL POTONGAN</td>
                                    <td className="red-text">{formatCurrency(totalPotongan)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                <hr className="dashed-line" />

                {/* TAKE HOME PAY */}
                <div className="thp-section">
                    <div className="thp-label">PENERIMAAN BERSIH (TAKE HOME PAY)</div>
                    <div className="thp-amount">Rp {formatCurrency(upahBersih)}</div>
                    <div className="thp-terbilang">
                        {/* Placeholder for 'Terbilang' logic if needed later */}
                        Ref: {empCode} / {division}
                    </div>
                </div>

                <div className="payslip-footer">
                    <div className="payslip-footer-code">PAYROLL RECORD · {empCode} · {getMonthName(month).toUpperCase()} {year}</div>
                    <div className="timestamp">
                        Dicetak pada: {new Date().toLocaleString('id-ID')}
                    </div>
                </div>

            </div>

            {/* 2. ATTENDANCE & OVERTIME MATRICES (Below Payslip) */}
            <div className="matrix-sections-container">

                {/* HK Discrepancy Banner - IMPROVED VISIBILITY */}
                {(getNum('koreksi_hk') !== 0) && (
                    <div style={{
                        padding: '16px 20px',
                        borderRadius: '10px',
                        marginBottom: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        ...(getNum('koreksi_hk') < 0 ? {
                            backgroundColor: '#fef2f2',
                            border: '3px solid #ef4444',
                            color: '#991b1b'
                        } : {
                            backgroundColor: '#fff7ed',
                            border: '3px solid #f97316',
                            color: '#9a3412'
                        })
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '28px' }}>{getNum('koreksi_hk') < 0 ? '⚠️' : '🔴'}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>
                                    {getNum('koreksi_hk') < 0
                                        ? 'KURANG JAM / PEMBAYARAN TIDAK BENAR'
                                        : 'SALAH SCAN / JAM LEBIH'
                                    }
                                </div>
                                <div style={{ fontSize: '13px', opacity: 0.9 }}>
                                    Koreksi HK: <strong style={{ fontSize: '14px' }}>Rp {formatCurrency(Math.abs(getNum('koreksi_hk')))}</strong>
                                    {' | '}
                                    GP Ideal: Rp {formatCurrency(getNum('gaji_pokok_ideal'))}
                                    {' vs '}
                                    GP Aktual: Rp {formatCurrency(getNum('gaji_pokok_aktual'))}
                                </div>
                            </div>
                        </div>

                        {/* Shortage Details - DETAILED BREAKDOWN */}
                        {data.shortage_details && data.shortage_details.length > 0 && (
                            <div style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                borderRadius: '6px',
                                padding: '10px 14px',
                                marginTop: '4px'
                            }}>
                                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', color: '#dc2626' }}>
                                    📅 Detail {data.shortage_details.length} Hari Kurang Jam (Total: {(data.shortage_total_hours || 0).toFixed(1)} jam):
                                </div>
                                <div style={{ display: 'grid', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {data.shortage_details.map((detail, idx) => (
                                        <div key={idx} style={{
                                            display: 'grid',
                                            gridTemplateColumns: '100px 1fr 80px 80px 80px',
                                            gap: '8px',
                                            fontSize: '11px',
                                            padding: '6px 8px',
                                            backgroundColor: '#fee2e2',
                                            borderRadius: '4px',
                                            border: '1px solid #fecaca'
                                        }}>
                                            <div style={{ fontWeight: 'bold' }}>{detail.date}</div>
                                            <div>{detail.day_name}</div>
                                            <div style={{ textAlign: 'right' }}>Actual: {detail.actual_hours}j</div>
                                            <div style={{ textAlign: 'right' }}>Target: {detail.target_hours}j</div>
                                            <div style={{ textAlign: 'right', fontWeight: 'bold', color: '#dc2626' }}>
                                                Kurang: -{detail.shortage_hours.toFixed(1)}j
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Excess Details */}
                        {data.excess_details && data.excess_details.length > 0 && (
                            <div style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                borderRadius: '6px',
                                padding: '10px 14px',
                                marginTop: '4px'
                            }}>
                                <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', color: '#ea580c' }}>
                                    🔴 Detail {data.excess_details.length} Hari Jam Lebih (Total: +{(data.excess_total_hours || 0).toFixed(1)} jam):
                                </div>
                                <div style={{ display: 'grid', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {data.excess_details.map((detail, idx) => (
                                        <div key={idx} style={{
                                            display: 'grid',
                                            gridTemplateColumns: '100px 1fr 80px 80px 80px',
                                            gap: '8px',
                                            fontSize: '11px',
                                            padding: '6px 8px',
                                            backgroundColor: '#ffedd5',
                                            borderRadius: '4px',
                                            border: '1px solid #fed7aa'
                                        }}>
                                            <div style={{ fontWeight: 'bold' }}>{detail.date}</div>
                                            <div>{detail.day_name}</div>
                                            <div style={{ textAlign: 'right' }}>Actual: {detail.actual_hours}j</div>
                                            <div style={{ textAlign: 'right' }}>Target: {detail.target_hours}j</div>
                                            <div style={{ textAlign: 'right', fontWeight: 'bold', color: '#ea580c' }}>
                                                Lebih: +{detail.excess_hours.toFixed(1)}j
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Attendance Matrix */}
                <div className="matrix-card">
                    <div className="matrix-header gradient-header-blue">
                        <h3>📅 Matriks Kehadiran</h3>
                        <div className="legend">
                            {[
                                { key: 'hadir', label: 'Hadir' },
                                { key: 'alpa', label: 'Alpa' },
                                { key: 'sakit', label: 'Sakit' },
                                { key: 'cuti', label: 'Cuti' },
                                { key: 'minggu', label: 'Minggu' },
                                { key: 'libur', label: 'Libur' },
                                { key: 'libur_keagamaan', label: 'Libur Kemenag' }
                            ].map(({ key, label }) => (
                                <span key={key} className="legend-item">
                                    <span className="legend-dot" style={{ background: statusColors[key]?.bg || '#e5e7eb' }}>{statusColors[key]?.label || '-'}</span>
                                    <span>{label}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="calendar-matrix-container">
                        <div className="calendar-matrix">
                            {daysOfWeek.map(day => <div key={`header-${day}`} className="calendar-day-header">{day}</div>)}
                            {blanks.map(blank => <div key={`blank-${blank}`} className="calendar-cell empty"></div>)}
                            {days.map(day => {
                                const dayData = attendance.matrix?.[day] || { status: 'no_data' }
                                const statusStyle = statusColors[dayData.status] || statusColors.no_data

                                const dateObj = new Date(year, month - 1, day)
                                const dayOfWeek = dateObj.getDay()
                                const isFriday = dayOfWeek === 5
                                const isSunday = dayOfWeek === 0
                                const isHoliday = dayData.is_holiday
                                const hours = dayData.hours || 0
                                const amount = dayData.amount || 0
                                const targetHours = isFriday ? 5 : 7
                                const isShort = hours > 0 && hours < targetHours && !isSunday && !isHoliday
                                const isExcess = hours > targetHours && !isSunday && !isHoliday

                                // Determine cell styling
                                let cellBg = statusStyle.bg
                                let cellColor = statusStyle.text
                                let cellBorder = '1px solid #e5e7eb'
                                let hkIcon = ''

                                if (isShort) {
                                    cellBg = '#fee2e2'
                                    cellColor = '#b91c1c'
                                    cellBorder = '2px solid #ef4444'
                                    hkIcon = '⚠️'
                                } else if (isExcess) {
                                    cellBg = '#fff7ed'
                                    cellColor = '#9a3412'
                                    cellBorder = '2px solid #f97316'
                                    hkIcon = '🔴'
                                }

                                const shortage = isShort ? (targetHours - hours).toFixed(1) : 0
                                const excess = isExcess ? (hours - targetHours).toFixed(1) : 0

                                return (
                                    <div
                                        key={`cell-${day}`}
                                        className="calendar-cell"
                                        style={{
                                            background: cellBg,
                                            color: cellColor,
                                            border: cellBorder,
                                            cursor: 'pointer'
                                        }}
                                        title={`Tanggal ${day}: ${dayData.status}${dayData.remarks ? ` - ${dayData.remarks}` : ''}\nJam: ${hours} / Target: ${targetHours}\nAmount: Rp ${formatCurrency(amount)}${isShort ? `\n⚠️ Kurang ${shortage} Jam` : ''}${isExcess ? `\n🔴 Lebih ${excess} Jam` : ''}`}
                                    >
                                        <div className="calendar-date">{day}</div>
                                        <div className="calendar-status">
                                            {hkIcon ? `${hkIcon} ${statusStyle.label}` : statusStyle.label}
                                        </div>
                                        {hours > 0 && (
                                            <div style={{ fontSize: '0.6rem', marginTop: '1px', fontWeight: 'bold' }}>
                                                {hours}j
                                                {isShort && <span style={{ color: '#dc2626' }}> ⚠️</span>}
                                                {isExcess && <span style={{ color: '#ea580c' }}> 🔴</span>}
                                            </div>
                                        )}
                                        {/* Show amount for ALL days with data, not just non-shortage */}
                                        {amount > 0 && (
                                            <div style={{
                                                fontSize: '0.55rem',
                                                fontWeight: 'bold',
                                                color: isShort ? '#dc2626' : isExcess ? '#ea580c' : '#047857',
                                                marginTop: '1px'
                                            }}>
                                                {formatCurrency(amount)}
                                            </div>
                                        )}
                                        {/* Show shortage/excess indicator */}
                                        {(isShort || isExcess) && (
                                            <div style={{
                                                fontSize: '0.5rem',
                                                fontWeight: 'bold',
                                                color: isShort ? '#dc2626' : '#ea580c',
                                                marginTop: '1px',
                                                backgroundColor: isShort ? 'rgba(220, 38, 38, 0.1)' : 'rgba(234, 88, 12, 0.1)',
                                                borderRadius: '2px',
                                                padding: '1px 2px'
                                            }}>
                                                {isShort ? `-${shortage}j` : `+${excess}j`}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                    {/* Attendance Summary - ENHANCED */}
                    <div className="attendance-summary">
                        <div className="summary-item success">
                            <span className="summary-value">{attendance.summary?.total_hadir || 0}</span>
                            <span className="summary-label">Hadir</span>
                        </div>
                        <div className="summary-item warning">
                            <span className="summary-value">{attendance.summary?.cuti_tahunan || 0}</span>
                            <span className="summary-label">Cuti</span>
                        </div>
                        <div className="summary-item info">
                            <span className="summary-value">{attendance.summary?.cuti_sakit || 0}</span>
                            <span className="summary-label">Sakit</span>
                        </div>
                        <div className="summary-item danger">
                            <span className="summary-value">{attendance.summary?.alpa || 0}</span>
                            <span className="summary-label">Alpa</span>
                        </div>
                        {(data.shortage_total_hours > 0 || data.excess_total_hours > 0) && (
                            <>
                                <div className="summary-item" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                                    <span className="summary-value" style={{ color: '#dc2626' }}>
                                        {data.shortage_total_hours > 0 ? `-${data.shortage_total_hours.toFixed(1)}` : '0'}j
                                    </span>
                                    <span className="summary-label">Kurang Jam</span>
                                </div>
                                <div className="summary-item" style={{ backgroundColor: '#fff7ed', color: '#ea580c' }}>
                                    <span className="summary-value" style={{ color: '#ea580c' }}>
                                        {data.excess_total_hours > 0 ? `+${data.excess_total_hours.toFixed(1)}` : '0'}j
                                    </span>
                                    <span className="summary-label">Jam Lebih</span>
                                </div>
                            </>
                        )}
                        <div className="summary-item" style={{ backgroundColor: '#e0e7ff', color: '#3730a3' }}>
                            <span className="summary-value" style={{ color: '#3730a3', fontWeight: 'bold' }}>
                                {getNum('jumlah_hk') || attendance.summary?.total_hk || 0}
                            </span>
                            <span className="summary-label">Total HK</span>
                        </div>
                    </div>
                </div>

                {/* Daily Activity Details List (New) */}
                {attendance.list && attendance.list.length > 0 && (
                    <div className="matrix-card" style={{ marginTop: '1rem' }}>
                        <div className="matrix-header" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <h3 style={{ color: '#0f172a', fontSize: '1rem' }}>📋 Rincian Aktivitas Harian (Regular)</h3>
                            <div className="overtime-total">
                                Total: <strong>{formatCurrency(attendance.list.reduce((sum, item) => sum + (item.amount || 0), 0))}</strong>
                            </div>
                        </div>
                        <div className="overtime-list">
                            <div className="overtime-summary-box">
                                <table className="overtime-summary-table">
                                    <thead>
                                        <tr>
                                            <th>Tanggal</th>
                                            <th>Status</th>
                                            <th>Pekerjaan</th>
                                            <th style={{ textAlign: 'center' }}>Jam</th>
                                            <th style={{ textAlign: 'right' }}>Rate/Upah</th>
                                            <th style={{ textAlign: 'right' }}>Jumlah</th>
                                            <th style={{ textAlign: 'center' }}>HK</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {attendance.list.map((item, idx) => {
                                            const itemDate = item.date ? new Date(item.date) : null
                                            const itemDayOfWeek = itemDate ? itemDate.getDay() : -1
                                            const itemIsFriday = itemDayOfWeek === 5
                                            const itemIsSunday = itemDayOfWeek === 0
                                            const itemTargetHours = itemIsFriday ? 5 : 7
                                            const itemIsShort = item.hours > 0 && item.hours < itemTargetHours && !itemIsSunday && item.status === 'hadir'
                                            const itemIsExcess = item.hours > itemTargetHours && !itemIsSunday && item.status === 'hadir'

                                            let rowBg = undefined
                                            let hkStatusIcon = '✅'
                                            if (itemIsShort) {
                                                rowBg = '#fef2f2'
                                                hkStatusIcon = '⚠️'
                                            } else if (itemIsExcess) {
                                                rowBg = '#fff7ed'
                                                hkStatusIcon = '🔴'
                                            } else if (item.status !== 'hadir') {
                                                hkStatusIcon = '—'
                                            }

                                            return (
                                                <tr key={idx} style={{ backgroundColor: rowBg }}>
                                                    <td>
                                                        {item.date ? new Date(item.date).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'}
                                                    </td>
                                                    <td>
                                                        <span className="legend-dot" style={{
                                                            display: 'inline-block',
                                                            width: '8px',
                                                            height: '8px',
                                                            borderRadius: '50%',
                                                            marginRight: '6px',
                                                            background: statusColors[item.status]?.bg || '#e5e7eb'
                                                        }}></span>
                                                        {statusColors[item.status]?.label === 'H' ? 'Hadir' : item.remarks || item.status}
                                                    </td>
                                                    <td>
                                                        {item.task_desc}
                                                        {item.task_code && <span style={{ color: '#94a3b8', fontSize: '0.8em', marginLeft: '4px' }}>({item.task_code})</span>}
                                                    </td>
                                                    <td style={{
                                                        textAlign: 'center',
                                                        fontWeight: (itemIsShort || itemIsExcess) ? 'bold' : 'normal',
                                                        color: itemIsShort ? '#dc2626' : (itemIsExcess ? '#ea580c' : undefined)
                                                    }}>
                                                        {item.hours > 0 ? item.hours : '-'}
                                                        {itemIsShort && <span style={{ fontSize: '10px' }}> ⚠️</span>}
                                                        {itemIsExcess && <span style={{ fontSize: '10px' }}> 🔴</span>}
                                                    </td>
                                                    <td style={{ textAlign: 'right', color: '#64748b' }}>
                                                        {item.rate > 0 ? formatCurrency(item.rate) : '-'}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: '600' }}>
                                                        {item.amount > 0 ? formatCurrency(item.amount) : '-'}
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        {hkStatusIcon}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ fontWeight: 'bold', backgroundColor: '#f9fafb' }}>
                                            <td colSpan="3">Total</td>
                                            <td style={{ textAlign: 'center' }}>
                                                {attendance.list.reduce((sum, item) => sum + (item.hours || 0), 0)}
                                            </td>
                                            <td></td>
                                            <td style={{ textAlign: 'right' }}>
                                                {formatCurrency(attendance.list.reduce((sum, item) => sum + (item.amount || 0), 0))}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                )}


                {/* Overtime Matrix */}
                <div className="matrix-card">
                    <div className="matrix-header gradient-header-purple">
                        <h3>⏰ Matriks Lembur</h3>
                        <div className="overtime-total">
                            Total: <strong>{overtime.summary?.total_hours || 0}</strong> jam = <strong>RP {formatCurrency(overtime.list?.reduce((acc, curr) => acc + (curr.amount_formula || 0), 0) || 0)}</strong>
                        </div>
                    </div>
                    <div className="calendar-matrix-container">
                        <div className="calendar-matrix overtime-matrix">
                            {daysOfWeek.map(day => <div key={`ot-header-${day}`} className="calendar-day-header">{day}</div>)}
                            {blanks.map(blank => <div key={`ot-blank-${blank}`} className="calendar-cell empty"></div>)}
                            {days.map(day => {
                                const dayData = overtime.matrix?.[day] || { has_overtime: false, hours: 0, amount_formula: 0 }
                                const displayAmount = dayData.amount_formula || dayData.amount || 0
                                return (
                                    <div
                                        key={`ot-cell-${day}`}
                                        className={`calendar-cell overtime-cell ${dayData.has_overtime ? 'has-overtime' : ''}`}
                                        title={dayData.has_overtime
                                            ? `Tanggal ${day}: ${dayData.hours} jam = Rp ${formatCurrency(displayAmount)}`
                                            : `Tanggal ${day}: Tidak ada lembur`
                                        }
                                    >
                                        <div className="calendar-date">{day}</div>
                                        {dayData.has_overtime && (
                                            <>
                                                <div className="calendar-status ot-hours">{dayData.hours}j</div>
                                                <div className="calendar-status ot-amount">Rp{formatCurrency(displayAmount)}</div>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Overtime List Detail - Per Transaksi */}
                    {overtimeTransactions.length > 0 && (
                        <div className="overtime-list">
                            <h4>📋 Rincian Lembur Per Transaksi</h4>
                            <div className="overtime-upj-help">
                                <div className="overtime-upj-title">UPJ (Upah Per Jam)</div>
                                <p>
                                    UPJ adalah nilai dasar upah per jam yang dipakai untuk hitung lembur.
                                    Rumus umum: <strong>payrate × 30 / 173</strong>.
                                </p>
                                {effectiveUpjValue > 0 && (
                                    <div className="overtime-upj-badge">
                                        UPJ periode ini: <strong>Rp {formatCurrency(effectiveUpjValue)}</strong>
                                    </div>
                                )}
                            </div>

                            {/* Summary Table */}
                            <div className="overtime-table-toolbar">
                                <div className="overtime-mode-toggle" role="group" aria-label="Mode tampilan tabel lembur">
                                    <button
                                        type="button"
                                        className={`overtime-mode-btn ${isOvertimeCompact ? 'active' : ''}`}
                                        onClick={() => setOvertimeViewMode('compact')}
                                    >
                                        Mode Ringkas
                                    </button>
                                    <button
                                        type="button"
                                        className={`overtime-mode-btn ${!isOvertimeCompact ? 'active' : ''}`}
                                        onClick={() => setOvertimeViewMode('detail')}
                                    >
                                        Mode Detail
                                    </button>
                                </div>
                                <span className="overtime-scroll-tip">Header tabel tetap terlihat saat scroll</span>
                            </div>

                            <div className={`overtime-summary-box ${isOvertimeCompact ? 'is-compact' : ''}`}>
                                <table className={`overtime-summary-table ${isOvertimeCompact ? 'is-compact' : ''}`}>
                                    <thead>
                                        <tr>
                                            <th>Tanggal</th>
                                            <th>Hari</th>
                                            <th>Tipe Hari</th>
                                            {!isOvertimeCompact && <th>Pekerjaan</th>}
                                            <th>Jam</th>
                                            {!isOvertimeCompact && <th>Rate (x)</th>}
                                            {!isOvertimeCompact && <th>UPJ</th>}
                                            {!isOvertimeCompact && <th>Rumus</th>}
                                            <th>Jumlah</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {overtimeTransactions
                                            .sort((a, b) => {
                                                // Sort by date
                                                const dateA = a.date || a.trx_date || '';
                                                const dateB = b.date || b.trx_date || '';
                                                return dateA.localeCompare(dateB);
                                            })
                                            .map((trx, idx) => {
                                                const date = trx.date || trx.trx_date || '';
                                                const dayName = trx.day_name || trx.hari || '-';
                                                const dayType = trx.day_type || trx.tipe_hari || '-';
                                                const rawDayType = trx.raw_day_type || null;
                                                const taskCode = trx.task_code || trx.task_desc || 'Lain-lain';
                                                const hours = trx.hours || 0;
                                                const amount = trx.amount_formula || trx.amount || 0;
                                                const upjValue = Number(trx.upj_value) || 0;
                                                const rateValue = Number(trx.formula_rate_total || trx.rate) || 0;
                                                const formulaUraian = trx.formula_uraian || (rateValue > 0 ? `${hours} jam @ ${formatMultiplier(rateValue)}` : '-');

                                                // Format date DD/MM/YYYY
                                                const formattedDate = date ? new Date(date).toLocaleDateString('id-ID', {
                                                    day: '2-digit',
                                                    month: '2-digit',
                                                    year: 'numeric'
                                                }) : '-';

                                                return (
                                                    <tr key={idx}>
                                                        <td>{formattedDate}</td>
                                                        <td>{dayName}</td>
                                                        <td>
                                                            <span className={`day-type-badge ${getDayTypeClass(dayType, rawDayType)}`}>
                                                                {formatDayType(dayType, rawDayType)}
                                                            </span>
                                                        </td>
                                                        {!isOvertimeCompact && <td>{taskCode}</td>}
                                                        <td className="hours-cell">{hours}</td>
                                                        {!isOvertimeCompact && <td className="rate-cell">{formatMultiplier(rateValue)}</td>}
                                                        {!isOvertimeCompact && <td className="upj-cell">{upjValue > 0 ? formatCurrency(upjValue) : '-'}</td>}
                                                        {!isOvertimeCompact && (
                                                            <td className="formula-cell">
                                                                {formulaUraian}
                                                                {upjValue > 0 && (
                                                                    <span className="formula-upj-inline"> × {formatCurrency(upjValue)}</span>
                                                                )}
                                                            </td>
                                                        )}
                                                        <td className="amount-cell">{formatCurrency(amount)}</td>
                                                    </tr>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Total Summary */}
                            <div className="overtime-total-summary">
                                <div className="summary-row">
                                    <span>Total Transaksi:</span>
                                    <strong>{overtimeTransactions.length}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Total Jam:</span>
                                    <strong>{overtimeTransactions.reduce((sum, t) => sum + (t.hours || 0), 0)}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Total Lembur:</span>
                                    <strong>{formatCurrency(overtimeTransactions.reduce((sum, t) => sum + (t.amount_formula || t.amount || 0), 0))}</strong>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Harvest Matrix (Moved from action-buttons) */}
                {harvest && harvest.length > 0 && (
                    <div className="matrix-card">
                        <div className="matrix-header gradient-header-orange">
                            <h3>🌴 Matriks Panen</h3>
                            <div className="overtime-total">
                                Total: <strong>{formatCurrency(harvest.reduce((sum, h) => sum + (h.TotalWeight || 0), 0))}</strong> Kg / <strong>{formatCurrency(harvest.reduce((sum, h) => sum + (h.TotalBunches || 0), 0))}</strong> Jjg
                            </div>
                        </div>

                        <div className="overtime-list">
                            <div className="overtime-summary-box">
                                <table className="overtime-summary-table">
                                    <thead>
                                        <tr>
                                            <th>Tanggal</th>
                                            <th>Gang</th>
                                            <th>Lokasi</th>
                                            <th style={{ textAlign: 'right' }}>Berat (Kg)</th>
                                            <th style={{ textAlign: 'right' }}>Janjang</th>
                                            <th style={{ textAlign: 'right' }}>Upah</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {harvest.map((h, idx) => (
                                            <tr key={idx}>
                                                <td>{new Date(h.TrxDate).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
                                                <td>{h.GrpRef || '-'}</td>
                                                <td>{h.ChargeTo || '-'}</td>
                                                <td style={{ textAlign: 'right', fontWeight: h.TotalWeight > 0 ? 'bold' : 'normal' }}>
                                                    {formatCurrency(h.TotalWeight)}
                                                </td>
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(h.TotalBunches)}</td>
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(h.Amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ fontWeight: 'bold', backgroundColor: '#f9fafb' }}>
                                            <td colSpan="3">Total</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(harvest.reduce((sum, h) => sum + (h.TotalWeight || 0), 0))}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(harvest.reduce((sum, h) => sum + (h.TotalBunches || 0), 0))}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(harvest.reduce((sum, h) => sum + (h.Amount || 0), 0))}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* SALARY HISTORY SECTION */}
            <div className="salary-history-section no-print">
                {/* Thumbprint Verification */}
                <ThumbprintVerification
                    division={division}
                    month={month}
                    year={year}
                    upahBersih={upahBersih}
                />

                {/* Salary History Table */}
                <SalaryHistoryTable
                    key={`sht-${empCode}`}
                    empCode={empCode}
                    months={12}
                    onPeriodClick={(record) => {
                        // Navigate to different period - could implement period switching
                        console.log('Navigate to period:', record.period_month, record.period_year);
                    }}
                />
            </div>
            {/* ACTION BUTTONS (No Print) */}
            <div className="action-buttons no-print">
                <button onClick={onBack} className="btn btn-secondary">Tutup / Kembali</button>
                <button onClick={() => printReport({ orientation: 'portrait', margin: '5mm' })} className="btn btn-primary">🖨️ Cetak Slip Gaji</button>
            </div>

            {/* History Modal for NIK */}
            {historyModalNik.isOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setHistoryModalNik({ isOpen: false, data: null, loading: false })}>
                    <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', width: '90%', maxWidth: '500px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
                            <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem' }}>Riwayat Perubahan NIK</h3>
                            <button onClick={() => setHistoryModalNik({ isOpen: false, data: null, loading: false })} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>×</button>
                        </div>

                        <div style={{ marginBottom: '16px', fontWeight: '600', color: '#334155' }}>Karyawan: {empCode}</div>

                        {historyModalNik.loading ? (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Memuat riwayat...</div>
                        ) : historyModalNik.data && historyModalNik.data.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {historyModalNik.data.map((h, index) => (
                                    <div key={h.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', backgroundColor: index === 0 ? '#f8fafc' : 'white' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem', color: '#64748b' }}>
                                            <span><strong>Versi:</strong> {h.version} {index === 0 && <span style={{ color: '#10b981' }}>(Terbaru)</span>}</span>
                                            <span>{new Date(h.changed_at).toLocaleString('id-ID')}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f1f5f9', padding: '8px 12px', borderRadius: '6px' }}>
                                            <div style={{ fontSize: '0.9rem' }}>
                                                <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: '8px' }}>{h.old_value || '(Kosong)'}</span>
                                                <span style={{ fontWeight: 700, color: '#0f172a' }}>{h.new_value}</span>
                                            </div>
                                            {index === 0 && (
                                                <button onClick={handleRollbackNik} style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>🗑️ Rollback</button>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '8px' }}>Oleh: {h.changed_by}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px' }}>Belum ada riwayat perubahan NIK (masih menggunakan NIK dari Plantware).</div>
                        )}
                    </div>
                </div>
            )}
        </div >
    )
}
