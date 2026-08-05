/**
 * PayrollTaxMatrix - Displays detailed tax information for payroll employees
 * Shows PTKP status, TER category, gross income breakdown, and PPh21 calculation
 *
 * Follows the same pattern as GangOvertimeMatrix / GangEmployeeInfo
 * Uses the payroll data API to display tax-focused columns
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { getLockedRawTree } from '../services/lockedDivisionService'
import { compareEmpCodeValues } from '../utils/employeeSort'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const formatRupiah = (amount) => {
    if (amount == null || amount === 0) return '-'
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount)
}

const formatNumber = (amount) => {
    if (amount == null || amount === 0) return '-'
    return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(amount))
}

const formatSignedDeduction = (amount) => {
    const value = Math.abs(Number(amount) || 0)
    if (value === 0) return '-'
    // Guardrail: use one minus plus ABS magnitude. Never concatenate '-' with raw values.
    return `-${formatNumber(value)}`
}

const formatPercent = (val) => {
    if (val == null || val === 0) return '0%'
    return `${Number(val).toFixed(2)}%`
}

// PTKP Status color mapping
const getPtkpColor = (status) => {
    if (!status) return { bg: '#f1f5f9', text: '#64748b' }
    const colors = {
        'TK/0': { bg: '#dbeafe', text: '#1d4ed8' },
        'TK/1': { bg: '#dbeafe', text: '#1e40af' },
        'TK/2': { bg: '#bfdbfe', text: '#1e3a8a' },
        'TK/3': { bg: '#93c5fd', text: '#1e3a8a' },
        'K/0': { bg: '#dcfce7', text: '#166534' },
        'K/1': { bg: '#bbf7d0', text: '#14532d' },
        'K/2': { bg: '#86efac', text: '#14532d' },
        'K/3': { bg: '#4ade80', text: '#14532d' },
    }
    return colors[status] || { bg: '#f1f5f9', text: '#64748b' }
}

// TER Category color mapping
const getTerColor = (kategori) => {
    if (!kategori) return { bg: '#f1f5f9', text: '#64748b' }
    const colors = {
        'TER A': { bg: '#fef3c7', text: '#92400e' },
        'TER B': { bg: '#fed7aa', text: '#9a3412' },
        'TER C': { bg: '#fecaca', text: '#991b1b' },
    }
    return colors[kategori] || { bg: '#f1f5f9', text: '#64748b' }
}

// Tax row breakdown columns
const TAX_COLUMNS = [
    { key: 'status_ptkp', label: 'PTKP', badge: true, badgeFn: getPtkpColor, align: 'center' },
    { key: 'kategori_ter', label: 'TER', badge: true, badgeFn: getTerColor, align: 'center' },
    { key: 'gaji_pokok_bulanan', label: 'Gaji Pokok\nBulanan', align: 'right' },
    { key: 'gaji_pokok_ideal', label: 'Gaji Pokok\nIdeal', align: 'right' },
    { key: 'gaji_pokok_dibayarkan', label: 'GP\nDibayarkan', align: 'right' },
    { key: 'koreksi_hk', label: 'Koreksi\nHK', align: 'right' },
    { key: 'astek_084', label: 'ASTEK\n0.84%', align: 'right', sub: 'JKK/JKM Majikan' },
    { key: 'bpjs_kesehatan_majikan_4_pct', label: 'BPJS Kes\n4%', align: 'right', sub: 'Majikan' },
    { key: 'beras_jumlah', label: 'Tunjangan\nBeras', align: 'right' },
    { key: 'jabatan_jumlah', label: 'Tunjangan\nJabatan', align: 'right' },
    { key: 'masa_kerja_jumlah', label: 'Tunjangan\nMasa Kerja', align: 'right' },
    { key: 'lembur_jumlah', label: 'Lembur', align: 'right' },
    { key: 'total_premi', label: 'Total\nPremi', align: 'right' },
    { key: 'pot_koreksi', label: 'Pot\nKoreksi', align: 'right' },
    { key: 'taxable_pendapatan_thr', label: 'THR\nTaxable', align: 'right' },
    { key: 'taxable_pendapatan_bonus', label: 'Bonus\nTaxable', align: 'right' },
    { key: 'taxable_pendapatan_custom', label: 'Custom\nTaxable', align: 'right' },
    { key: 'taxable_pendapatan_lainnya', label: 'Total\nTaxable', align: 'right', bold: true },
    { key: 'penghasilan_bruto', label: 'Penghasilan\nBruto', align: 'right', bold: true, highlight: true },
    { key: 'tarif_pajak_ter', label: 'Tarif\nTER (%)', align: 'center' },
    { key: 'pph21_ter', label: 'PPH21\nTER', align: 'right', bold: true },
]

// Additional columns - pot Pekerja (shown in tooltip/detail)
const PEKERJA_COLUMNS = [
    { key: 'pot_astek_pekerja', label: 'JHT\nPekerja 2%', align: 'right' },
    { key: 'pot_bpjs_kesehatan_pekerja', label: 'BPJS Kes\nPekerja 1%', align: 'right' },
    { key: 'pot_bpjs_pensiun_pekerja', label: 'BPJS Pensiun\nPekerja 1%', align: 'right' },
    { key: 'pot_astek_jumlah', label: 'Total ASTEK\n+ BPJS Pekerja', align: 'right' },
    { key: 'pot_spsi', label: 'SPSI', align: 'right' },
    { key: 'pot_pph21', label: 'PPH21\n(dari ADTRANS)', align: 'right' },
]

export default function PayrollTaxMatrix({ token, gangCodes, month, year, division, onViewEmployeeDetail = null, useHistoryDb = false }) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [showPekerjaDetail, setShowPekerjaDetail] = useState(false)
    const [search, setSearch] = useState('')
    const [sortBy, setSortBy] = useState('emp_code')
    const [sortOrder, setSortOrder] = useState('asc')

    const fetchData = useCallback(async () => {
        if (!gangCodes || gangCodes.length === 0 || !month || !year) return

        setLoading(true)
        setError(null)
        try {
            const selectedGangCode =
                Array.isArray(gangCodes) && gangCodes.length === 1 ? gangCodes[0] : null

            // Fetch raw tree data which contains all employee payroll rows
            const result = await getLockedRawTree(
                token,
                division,
                month,
                year,
                useHistoryDb,
                null,
                null,
                selectedGangCode
            )
            setData(result)
        } catch (err) {
            setError(err.message || 'Gagal memuat data pajak')
        } finally {
            setLoading(false)
        }
    }, [token, gangCodes, month, year, division, useHistoryDb])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Flatten employees from all gangs
    const allEmployees = useMemo(() => {
        if (!data?.gangs) return []
        const employees = []
        for (const gangData of data.gangs) {
            if (gangData.employees && Array.isArray(gangData.employees)) {
                for (const emp of gangData.employees) {
                    employees.push({
                        ...emp,
                        gang_code: gangData.gang_code,
                    })
                }
            }
        }
        return employees
    }, [data])

    // Filter by search
    const filteredEmployees = useMemo(() => {
        let result = allEmployees
        if (search.trim()) {
            const q = search.toLowerCase()
            result = result.filter(emp =>
                (emp.nama || '').toLowerCase().includes(q) ||
                (emp.nik || '').toLowerCase().includes(q) ||
                (emp.emp_code || '').toLowerCase().includes(q)
            )
        }
        // Sort
        result = [...result].sort((a, b) => {
            const direction = sortOrder === 'asc' ? 1 : -1
            if (sortBy === 'emp_code') {
                return direction * compareEmpCodeValues(a.emp_code, b.emp_code)
            }

            let aVal = a[sortBy] || ''
            let bVal = b[sortBy] || ''
            if (typeof aVal === 'string') aVal = aVal.toLowerCase()
            if (typeof bVal === 'string') bVal = bVal.toLowerCase()
            if (aVal < bVal) return -direction
            if (aVal > bVal) return direction
            return 0
        })
        return result
    }, [allEmployees, search, sortBy, sortOrder])

    const handleSort = (key) => {
        if (sortBy === key) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortBy(key)
            setSortOrder('asc')
        }
    }

    const SortIcon = ({ columnKey }) => {
        if (sortBy !== columnKey) return <span style={{ opacity: 0.3, marginLeft: 2 }}>↕</span>
        return <span style={{ opacity: 1, marginLeft: 2 }}>{sortOrder === 'asc' ? '↑' : '↓'}</span>
    }

    // Summary stats are backend-calculated to keep one source of truth
    const summaryStats = useMemo(() => {
        const totals = data?.tax_matrix_totals || {}
        return {
            count: Number(totals.employee_count) || 0,
            gaji_pokok_bulanan: Number(totals.gaji_pokok_bulanan) || 0,
            gaji_pokok_ideal: Number(totals.gaji_pokok_ideal) || 0,
            gaji_pokok_dibayarkan: Number(totals.gaji_pokok_dibayarkan) || 0,
            koreksi_hk: Number(totals.koreksi_hk) || 0,
            astek_084: Number(totals.astek_084) || 0,
            bpjs_kesehatan_majikan_4_pct: Number(totals.bpjs_kesehatan_majikan_4_pct) || 0,
            beras_jumlah: Number(totals.beras_jumlah) || 0,
            jabatan_jumlah: Number(totals.jabatan_jumlah) || 0,
            masa_kerja_jumlah: Number(totals.masa_kerja_jumlah) || 0,
            lembur_jumlah: Number(totals.lembur_jumlah) || 0,
            total_premi: Number(totals.total_premi) || 0,
            pot_koreksi: Number(totals.pot_koreksi) || 0,
            taxable_pendapatan_thr: Number(totals.taxable_pendapatan_thr) || 0,
            taxable_pendapatan_bonus: Number(totals.taxable_pendapatan_bonus) || 0,
            taxable_pendapatan_lainnya: Number(totals.taxable_pendapatan_lainnya) || 0,
            penghasilan_bruto: Number(totals.penghasilan_bruto) || 0,
            pph21_ter: Number(totals.pph21_ter) || 0,
            pot_astek_pekerja: Number(totals.pot_astek_pekerja) || 0,
            pot_bpjs_kesehatan_pekerja: Number(totals.pot_bpjs_kesehatan_pekerja) || 0,
            pot_bpjs_pensiun_pekerja: Number(totals.pot_bpjs_pensiun_pekerja) || 0,
            pot_astek_jumlah: Number(totals.pot_astek_jumlah) || 0,
            pot_spsi: Number(totals.pot_spsi) || 0,
            pot_pph21: Number(totals.pot_pph21) || 0,
        }
    }, [data])

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '1rem' }}>
                <div style={{
                    width: '48px', height: '48px', border: '4px solid #e2e8f0',
                    borderTopColor: '#dc2626', borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }} />
                <div style={{ color: '#64748b', fontSize: '0.875rem' }}>Memuat data pajak...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '2rem' }}>⚠️</div>
                <div style={{ color: '#dc2626', fontWeight: 600 }}>Error</div>
                <div style={{ color: '#64748b', fontSize: '0.875rem' }}>{error}</div>
                <button onClick={fetchData} style={{ marginTop: '0.5rem', padding: '6px 16px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    Coba Lagi
                </button>
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                .tax-matrix-table { border-collapse: collapse; width: 100%; font-size: 11px; }
                .tax-matrix-table th { position: sticky; top: 0; z-index: 10; background: #1e293b; color: white; padding: 5px 6px; border: 1px solid #334155; white-space: pre-line; text-align: center; font-weight: 600; cursor: pointer; user-select: none; }
                .tax-matrix-table th:hover { background: #334155; }
                .tax-matrix-table td { padding: 4px 6px; border: 1px solid #e2e8f0; vertical-align: middle; }
                .tax-matrix-table tr:nth-child(even) td { background: #f8fafc; }
                .tax-matrix-table tr:hover td { background: #fef2f2 !important; }
                .tax-header-row { background: #7f1d1d !important; }
                .tax-section-header { background: #991b1b !important; }
                .tax-highlight { background: #fef3c7 !important; }
                .tax-subheader { background: #f1f5f9 !important; color: #64748b !important; font-size: 10px !important; font-weight: normal !important; }
                .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
                .sortable { cursor: pointer; }
                .sortable:hover { text-decoration: underline; }
            `}</style>

            {/* Header Controls */}
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.1rem' }}>💰</span>
                    <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>Detail Pajak Karyawan</span>
                </div>

                {/* KPI Summary */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '4px 10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#991b1b', fontWeight: 600 }}>KARYAWAN</div>
                        <div style={{ fontSize: '0.9rem', color: '#dc2626', fontWeight: 700 }}>{summaryStats.count}</div>
                    </div>
                    <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '4px 10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#92400e', fontWeight: 600 }}>PENGHASILAN BRUTO</div>
                        <div style={{ fontSize: '0.9rem', color: '#d97706', fontWeight: 700 }}>{formatRupiah(summaryStats.penghasilan_bruto)}</div>
                    </div>
                    <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '8px', padding: '4px 10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: '#991b1b', fontWeight: 600 }}>PPH21 TER</div>
                        <div style={{ fontSize: '0.9rem', color: '#dc2626', fontWeight: 700 }}>{formatRupiah(summaryStats.pph21_ter)}</div>
                    </div>
                </div>

                {/* Search */}
                <input
                    type="text"
                    placeholder="Cari NIK / Nama / Emp Code..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                        padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
                        fontSize: '0.8rem', outline: 'none', minWidth: '160px'
                    }}
                />

                {/* Toggle pekerja detail */}
                <button
                    onClick={() => setShowPekerjaDetail(prev => !prev)}
                    style={{
                        padding: '4px 10px', border: '1px solid', borderRadius: '6px',
                        fontSize: '0.75rem', cursor: 'pointer',
                        background: showPekerjaDetail ? '#1e40af' : '#eff6ff',
                        borderColor: showPekerjaDetail ? '#1e3a8a' : '#bfdbfe',
                        color: showPekerjaDetail ? 'white' : '#1e40af',
                        fontWeight: 600,
                    }}
                >
                    {showPekerjaDetail ? '◉' : '○'} Pot. Pekerja
                </button>

                {/* Gang info */}
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {gangCodes.length === 1 ? gangCodes[0] : `${gangCodes.length} gang`} • {MONTHS[month - 1]} {year}
                </div>
            </div>

            {/* Legend */}
            <div style={{ padding: '4px 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    <span style={{ fontWeight: 600 }}>PTKP:</span>{' '}
                    <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8' }}>TK</span> Tidak Kawin •{' '}
                    <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>K</span> Kawin •{' '}
                    angka = tanggungan
                </span>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    <span style={{ fontWeight: 600 }}>TER:</span>{' '}
                    <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>A</span> TK/0,TK/1,K/0 •{' '}
                    <span className="badge" style={{ background: '#fed7aa', color: '#9a3412' }}>B</span> TK/2,K/1,K/2 •{' '}
                    <span className="badge" style={{ background: '#fecaca', color: '#991b1b' }}>C</span> K/3
                </span>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    <span style={{ fontWeight: 600 }}>Klik header</span> untuk sorting
                </span>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    Footer total mengikuti nilai API backend (single source of truth)
                </span>
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                <table className="tax-matrix-table">
                    <thead>
                        <tr className="tax-header-row">
                            <th rowSpan={2} className="sortable" onClick={() => handleSort('nik')} style={{ minWidth: '80px', zIndex: 11 }}>
                                NIK <SortIcon columnKey="nik" />
                            </th>
                            <th rowSpan={2} className="sortable" onClick={() => handleSort('nama')} style={{ minWidth: '150px', zIndex: 11 }}>
                                Nama <SortIcon columnKey="nama" />
                            </th>
                            <th rowSpan={2} className="sortable" onClick={() => handleSort('gang_code')} style={{ minWidth: '60px', zIndex: 11 }}>
                                Gang <SortIcon columnKey="gang_code" />
                            </th>
                            <th rowSpan={2} style={{ minWidth: '50px', background: '#7f1d1d', zIndex: 11 }}>
                                PTKP
                            </th>
                            <th rowSpan={2} style={{ minWidth: '50px', background: '#7f1d1d', zIndex: 11 }}>
                                TER
                            </th>
                            {/* GP Section */}
                            <th colSpan={4} className="tax-section-header" style={{ textAlign: 'center', minWidth: '280px' }}>
                                GAJI POKOK
                            </th>
                            {/* Biaya Jabatan */}
                            <th colSpan={2} className="tax-section-header" style={{ textAlign: 'center', minWidth: '170px', background: '#b45309' }}>
                                BIAYA JABATAN (MAJIKAN)
                            </th>
                            {/* Tunjangan */}
                            <th colSpan={4} className="tax-section-header" style={{ textAlign: 'center', minWidth: '340px', background: '#0369a1' }}>
                                TUNJANGAN
                            </th>
                            {/* Pendapatan */}
                            <th colSpan={5} className="tax-section-header" style={{ textAlign: 'center', minWidth: '425px', background: '#7c3aed' }}>
                                PENDAPATAN & KOREKSI
                            </th>
                            {/* Bruto */}
                            <th rowSpan={2} className="sortable" onClick={() => handleSort('penghasilan_bruto')} style={{ minWidth: '110px', background: '#b91c1c', zIndex: 11 }}>
                                PENGHASILAN<br />BRUTO <SortIcon columnKey="penghasilan_bruto" />
                            </th>
                            {/* PPh21 */}
                            <th rowSpan={2} className="sortable" onClick={() => handleSort('tarif_pajak_ter')} style={{ minWidth: '60px', background: '#7f1d1d', zIndex: 11 }}>
                                TARIF<br />TER
                            </th>
                            <th rowSpan={2} className="sortable" onClick={() => handleSort('pph21_ter')} style={{ minWidth: '90px', background: '#7f1d1d', zIndex: 11 }}>
                                PPH21<br />TER <SortIcon columnKey="pph21_ter" />
                            </th>
                        </tr>
                        <tr>
                            {/* GP sub-headers */}
                            <th className="tax-subheader sortable" onClick={() => handleSort('gaji_pokok_bulanan')}>
                                Bulanan <SortIcon columnKey="gaji_pokok_bulanan" />
                            </th>
                            <th className="tax-subheader sortable" onClick={() => handleSort('gaji_pokok_ideal')}>
                                Ideal <SortIcon columnKey="gaji_pokok_ideal" />
                            </th>
                            <th className="tax-subheader sortable" onClick={() => handleSort('gaji_pokok_dibayarkan')}>
                                Dibayar <SortIcon columnKey="gaji_pokok_dibayarkan" />
                            </th>
                            <th className="tax-subheader">Koreksi HK</th>
                            {/* Biaya Jabatan sub */}
                            <th className="tax-subheader" style={{ background: '#92400e' }}>ASTEK 0.84%</th>
                            <th className="tax-subheader" style={{ background: '#92400e' }}>BPJS Kes 4%</th>
                            {/* Tunjangan sub */}
                            <th className="tax-subheader" style={{ background: '#0369a1' }}>Beras</th>
                            <th className="tax-subheader" style={{ background: '#0369a1' }}>Jabatan</th>
                            <th className="tax-subheader" style={{ background: '#0369a1' }}>Masa Kerja</th>
                            <th className="tax-subheader" style={{ background: '#0369a1' }}>Lembur</th>
                            {/* Pendapatan sub */}
                            <th className="tax-subheader" style={{ background: '#6d28d9' }}>Premi Total</th>
                            <th className="tax-subheader" style={{ background: '#6d28d9' }}>Pot Koreksi</th>
                            <th className="tax-subheader" style={{ background: '#6d28d9' }}>THR</th>
                            <th className="tax-subheader" style={{ background: '#6d28d9' }}>Bonus</th>
                            <th className="tax-subheader" style={{ background: '#6d28d9' }}>Total Taxable</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredEmployees.length === 0 ? (
                            <tr>
                                <td colSpan={22} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                                    {search ? 'Tidak ada karyawan yang cocok dengan pencarian' : 'Tidak ada data karyawan'}
                                </td>
                            </tr>
                        ) : (
                            filteredEmployees.map((emp, idx) => {
                                const ptkpColor = getPtkpColor(emp.status_ptkp)
                                const terColor = getTerColor(emp.kategori_ter)

                                return (
                                    <tr key={emp.emp_code || emp.nik || idx}>
                                        <td style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 600 }}>{emp.nik || '-'}</td>
                                        <td style={{ fontWeight: 600, color: '#1e293b', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                            title={emp.nama}>
                                            {emp.nama || '-'}
                                        </td>
                                        <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: '10px' }}>{emp.gang_code || '-'}</td>

                                        {/* PTKP Badge */}
                                        <td style={{ textAlign: 'center' }}>
                                            <span className="badge" style={{ background: ptkpColor.bg, color: ptkpColor.text }}>
                                                {emp.status_ptkp || '-'}
                                            </span>
                                        </td>

                                        {/* TER Badge */}
                                        <td style={{ textAlign: 'center' }}>
                                            <span className="badge" style={{ background: terColor.bg, color: terColor.text }}>
                                                {emp.kategori_ter || '-'}
                                            </span>
                                        </td>

                                        {/* Gaji Pokok */}
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.gaji_pokok_bulanan)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.gaji_pokok_ideal)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.gaji_pokok_dibayarkan)}</td>
                                        <td style={{ textAlign: 'right', color: '#d97706' }}>{formatNumber(emp.koreksi_hk)}</td>

                                        {/* Biaya Jabatan (Majikan) */}
                                        <td style={{ textAlign: 'right', color: '#7c3aed', background: '#faf5ff' }}>{formatNumber(emp.astek_084)}</td>
                                        <td style={{ textAlign: 'right', color: '#7c3aed', background: '#faf5ff' }}>{formatNumber(emp.bpjs_kesehatan_majikan_4_pct)}</td>

                                        {/* Tunjangan */}
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.beras_jumlah)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.jabatan_jumlah)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.masa_kerja_jumlah)}</td>
                                        <td style={{ textAlign: 'right', color: '#d97706' }}>{formatNumber(emp.lembur_jumlah)}</td>

                                        {/* Pendapatan */}
                                        <td style={{ textAlign: 'right', color: '#059669' }}>{formatNumber(emp.total_premi)}</td>
                                        <td style={{ textAlign: 'right', color: '#dc2626' }}>{formatSignedDeduction(emp.pot_koreksi)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.taxable_pendapatan_thr)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(emp.taxable_pendapatan_bonus)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, background: '#f5f3ff' }}>{formatNumber(emp.taxable_pendapatan_lainnya)}</td>

                                        {/* Penghasilan Bruto */}
                                        <td style={{ textAlign: 'right', fontWeight: 700, background: '#fef2f2', color: '#991b1b', borderLeft: '2px solid #dc2626' }}>
                                            {formatRupiah(emp.penghasilan_bruto)}
                                        </td>

                                        {/* Tarif TER */}
                                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#dc2626' }}>
                                            {formatPercent(emp.tarif_pajak_ter)}
                                        </td>

                                        {/* PPH21 */}
                                        <td style={{ textAlign: 'right', fontWeight: 700, background: '#fef2f2', color: '#991b1b' }}>
                                            {formatRupiah(emp.pph21_ter)}
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                    {/* Footer Summary */}
                    <tfoot>
                        <tr style={{ background: '#1e293b', color: 'white', fontWeight: 700 }}>
                            <td colSpan={5} style={{ textAlign: 'center', padding: '6px' }}>
                                TOTAL API ({summaryStats.count} karyawan)
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.gaji_pokok_bulanan)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.gaji_pokok_ideal)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.gaji_pokok_dibayarkan)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#fbbf24' }}>
                                {formatNumber(summaryStats.koreksi_hk)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#c4b5fd' }}>
                                {formatNumber(summaryStats.astek_084)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#c4b5fd' }}>
                                {formatNumber(summaryStats.bpjs_kesehatan_majikan_4_pct)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.beras_jumlah)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.jabatan_jumlah)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.masa_kerja_jumlah)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#fbbf24' }}>
                                {formatNumber(summaryStats.lembur_jumlah)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#6ee7b7' }}>
                                {formatNumber(summaryStats.total_premi)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#fca5a5' }}>
                                {formatSignedDeduction(summaryStats.pot_koreksi)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.taxable_pendapatan_thr)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                                {formatNumber(summaryStats.taxable_pendapatan_bonus)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#c4b5fd' }}>
                                {formatNumber(summaryStats.taxable_pendapatan_lainnya)}
                            </td>
                            <td style={{ textAlign: 'right', padding: '4px 6px', color: '#fca5a5', fontSize: '12px', borderLeft: '2px solid #fca5a5' }}>
                                {formatRupiah(summaryStats.penghasilan_bruto)}
                            </td>
                            <td colSpan={2} style={{ textAlign: 'right', padding: '4px 6px', color: '#fca5a5', fontSize: '12px' }}>
                                {formatRupiah(summaryStats.pph21_ter)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Potongan Pekerja Detail Panel */}
            {showPekerjaDetail && (
                <div style={{
                    position: 'absolute', bottom: '1rem', right: '1rem',
                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.15)', padding: '1rem',
                    zIndex: 100, maxWidth: '500px', maxHeight: '300px', overflow: 'auto'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.85rem' }}>Potongan Pekerja (Bukan Biaya Jabatan)</span>
                        <button
                            onClick={() => setShowPekerjaDetail(false)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}
                        >
                            ✕
                        </button>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem' }}>
                        * Ini adalah potongan yang dibayar oleh pekerja, bukan ditanggung majikan
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                            <tr style={{ background: '#eff6ff' }}>
                                <th style={{ padding: '4px 6px', textAlign: 'left', border: '1px solid #bfdbfe' }}>Komponen</th>
                                <th style={{ padding: '4px 6px', textAlign: 'right', border: '1px solid #bfdbfe' }}>Per Karyawan</th>
                                <th style={{ padding: '4px 6px', textAlign: 'right', border: '1px solid #bfdbfe' }}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[
                                { label: 'JHT Pekerja 2%', key: 'pot_astek_pekerja' },
                                { label: 'BPJS Kesehatan Pekerja 1%', key: 'pot_bpjs_kesehatan_pekerja' },
                                { label: 'BPJS Pensiun Pekerja 1%', key: 'pot_bpjs_pensiun_pekerja' },
                                { label: 'SPSI', key: 'pot_spsi' },
                                { label: 'PPH21 (dari ADTRANS)', key: 'pot_pph21' },
                            ].map(({ label, key }) => {
                                const total = Number(summaryStats[key]) || 0
                                const perEmployee = summaryStats.count > 0 ? total / summaryStats.count : 0
                                return (
                                    <tr key={key}>
                                        <td style={{ padding: '3px 6px', border: '1px solid #e2e8f0' }}>{label}</td>
                                        <td style={{ padding: '3px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{formatNumber(perEmployee)}</td>
                                        <td style={{ padding: '3px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>{formatRupiah(total)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Formula explanation */}
            <div style={{ padding: '6px 1rem', background: '#fffbeb', borderTop: '1px solid #fde68a', fontSize: '0.7rem', color: '#92400e', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 700 }}>Formula:</span>
                <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: '3px' }}>
                    Penghasilan Bruto = GP Dibayarkan + Tunjangan (Beras+Jabatan+MK) + Lembur + Premi + ASTEK 0.84% + BPJS Kes 4% + Pendapatan Taxable - Pot. Koreksi
                </code>
                <span style={{ fontWeight: 700, marginLeft: '0.5rem' }}>|</span>
                <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: '3px' }}>
                    PPH21 TER = Penghasilan Bruto × Tarif TER (%)
                </code>
            </div>
        </div>
    )
}
