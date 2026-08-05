/**
 * GangOvertimeMatrix - Displays overtime (lembur) hours matrix for all employees in a gang
 * Shows a grid with employee names as rows and days 1-31 as columns
 * Each cell shows overtime hours worked on that day
 *
 * Data sourced from PR_TASKREGLN / PR_TASKREGLN_ARC where OT = 1
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { getGangOvertimeMatrix } from '../services/employeeDetailService'
import { printReport } from '../utils/printPageSetup'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

// Format currency to Indonesian Rupiah
const formatRupiah = (amount) => {
    if (!amount && amount !== 0) return '-'
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount)
}

// Get color intensity based on overtime hours (0-8+ hours scale)
const getOvertimeColor = (hours) => {
    if (!hours || hours <= 0) return { bg: '#f9fafb', color: '#d1d5db', text: '-' }
    if (hours <= 1) return { bg: '#fef9c3', color: '#854d0e', text: `${hours}h` }
    if (hours <= 2) return { bg: '#fde68a', color: '#92400e', text: `${hours}h` }
    if (hours <= 3) return { bg: '#fcd34d', color: '#78350f', text: `${hours}h` }
    if (hours <= 4) return { bg: '#fbbf24', color: '#ffffff', text: `${hours}h` }
    if (hours <= 6) return { bg: '#f59e0b', color: '#ffffff', text: `${hours}h` }
    if (hours <= 8) return { bg: '#d97706', color: '#ffffff', text: `${hours}h` }
    return { bg: '#b45309', color: '#ffffff', text: `${hours}h` }
}

export default function GangOvertimeMatrix({
    token,
    gangCodes,
    month,
    year,
    compact = false,
    division,
    onViewEmployeeDetail = null
}) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [expandedGangs, setExpandedGangs] = useState(new Set())

    const fetchData = useCallback(async () => {
        if (!gangCodes || gangCodes.length === 0 || !month || !year) return

        setLoading(true)
        setError(null)
        try {
            const result = await getGangOvertimeMatrix(token, gangCodes, month, year)
            setData(result)
            if (result?.data) {
                setExpandedGangs(new Set(result.data.map(g => g.gang_code)))
            }
        } catch (err) {
            setError(err.message || 'Gagal memuat data matrix lembur')
        } finally {
            setLoading(false)
        }
    }, [token, gangCodes, month, year])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const toggleGang = (gangCode) => {
        setExpandedGangs(prev => {
            const next = new Set(prev)
            if (next.has(gangCode)) next.delete(gangCode)
            else next.add(gangCode)
            return next
        })
    }

    const handlePrint = () => {
        if (data?.data) {
            setExpandedGangs(new Set(data.data.map(g => g.gang_code)))
            setTimeout(() => {
                printReport({ orientation: 'landscape', margin: '5mm' })
            }, 500)
        }
    }

    const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

    if (!gangCodes || gangCodes.length === 0) {
        return (
            <div className="gom-container">
                <div className="gom-header">
                    <h2>⏰ Matrix Lembur Gang</h2>
                    <span className="gom-period">{MONTHS[month - 1]} {year}</span>
                    {division && <span className="gom-division-badge">{division}</span>}
                </div>
                <div className="gom-empty-state">
                    <div className="gom-empty-icon">📊</div>
                    <h3>Matrix Lembur Belum Tersedia</h3>
                    <p>Data daftar upah sedang dimuat atau belum tersedia untuk periode ini.</p>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="gom-container">
                <div className="gom-loading">
                    <div className="gom-spinner" />
                    <p>Memuat matrix lembur...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="gom-container">
                <div className="gom-error">
                    <p>Error: {error}</p>
                    <button onClick={fetchData} className="gom-retry-btn">Coba Lagi</button>
                </div>
            </div>
        )
    }

    const gangs = data?.data || []
    const meta = data?.meta || {}

    return (
        <div className="gom-container">
            {/* Header */}
            <div className="gom-header">
                <div className="gom-header-left">
                    <h2>Matrix Lembur Gang</h2>
                    <span className="gom-period">{MONTHS[month - 1]} {year}</span>
                    <span className="gom-source-badge">Data overtime (OT=1)</span>
                </div>
                <div className="gom-header-right">
                    <button onClick={handlePrint} className="gom-print-btn" title="Cetak Matrix Lembur">
                        🖨️ Print
                    </button>
                    {meta.execution_time_ms && (
                        <span className="gom-meta">
                            {meta.total_employees} karyawan • {meta.execution_time_ms}ms
                        </span>
                    )}
                </div>
            </div>

            {/* Legend */}
            {!compact && (
                <div className="gom-legend">
                    <span className="gom-legend-item" style={{ background: '#f9fafb', color: '#d1d5db' }}>-</span>
                    <span className="gom-legend-item" style={{ background: '#fef9c3', color: '#854d0e' }}>1h</span>
                    <span className="gom-legend-item" style={{ background: '#fde68a', color: '#92400e' }}>2h</span>
                    <span className="gom-legend-item" style={{ background: '#fcd34d', color: '#78350f' }}>3h</span>
                    <span className="gom-legend-item" style={{ background: '#fbbf24', color: '#ffffff' }}>4h</span>
                    <span className="gom-legend-item" style={{ background: '#f59e0b', color: '#ffffff' }}>6h</span>
                    <span className="gom-legend-item" style={{ background: '#d97706', color: '#ffffff' }}>8h</span>
                    <span className="gom-legend-item" style={{ background: '#b45309', color: '#ffffff' }}>8h+</span>
                    <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '8px' }}>
                        Total Lembur: {formatRupiah(gangs.reduce((sum, g) => sum + g.employees.reduce((s, e) => s + e.total_amount, 0), 0))}
                    </span>
                </div>
            )}

            {/* Content */}
            <div className="gom-content">
                {gangs.length === 0 ? (
                    <div className="gom-empty">Tidak ada data lembur untuk gang yang dipilih pada periode ini.</div>
                ) : (
                    gangs.map(gang => {
                        const isExpanded = expandedGangs.has(gang.gang_code)
                        const days = Array.from({ length: gang.days_in_month }, (_, i) => i + 1)
                        const totalHours = gang.employees.reduce((s, e) => s + e.total_hours, 0)
                        const totalAmount = gang.employees.reduce((s, e) => s + e.total_amount, 0)

                        return (
                            <div key={gang.gang_code} className="gom-gang-section">
                                {/* Gang header */}
                                <div className="gom-gang-header" onClick={() => toggleGang(gang.gang_code)}>
                                    <span className="gom-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
                                    <strong>{gang.gang_code}</strong>
                                    {gang.gang_description && <span className="gom-gang-desc">{gang.gang_description}</span>}
                                    <span className="gom-gang-count">{gang.employees.length} karyawan</span>
                                    <span className="gom-gang-stats">
                                        {gang.employees.filter(e => e.total_hours > 0).length} lembur • {totalHours} jam
                                    </span>
                                </div>

                                {isExpanded && (
                                    <div className="gom-table-wrapper">
                                        <table className="gom-table">
                                            <thead>
                                                <tr>
                                                    <th className="gom-th-no">No</th>
                                                    <th className="gom-th-name">Nama</th>
                                                    {days.map(d => {
                                                        const isSunday = gang.sundays?.includes(d)
                                                        const isHoliday = gang.holidays?.[d]
                                                        return (
                                                            <th key={d}
                                                                className={`gom-th-day ${isSunday ? 'gom-sunday' : ''} ${isHoliday ? 'gom-holiday' : ''}`}
                                                                title={isHoliday || (isSunday ? 'Minggu' : `Tanggal ${d}`)}
                                                            >
                                                                {d}
                                                            </th>
                                                        )
                                                    })}
                                                    <th className="gom-th-sum" title="Total Jam">Jam</th>
                                                    <th className="gom-th-sum gom-th-rupiah" title="Total Rupiah">Rupiah</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {gang.employees.map((emp, idx) => (
                                                    <tr key={emp.emp_code} className={emp.total_hours === 0 ? 'gom-row-empty' : ''}>
                                                        <td className="gom-td-no">{idx + 1}</td>
                                                        <td className="gom-td-name" title={emp.emp_code}>
                                                            <div className="gom-name-cell">
                                                                {typeof onViewEmployeeDetail === 'function' ? (
                                                                    <button
                                                                        type="button"
                                                                        className="gom-emp-detail-btn"
                                                                        title={`Buka detail ${emp.emp_name} (${emp.emp_code})`}
                                                                        onClick={() => onViewEmployeeDetail({
                                                                            emp_code: emp.emp_code,
                                                                            emp_name: emp.emp_name,
                                                                            nik: emp.emp_code,
                                                                            gang_code: gang.gang_code,
                                                                            division
                                                                        })}
                                                                    >
                                                                        {emp.emp_name}
                                                                    </button>
                                                                ) : (
                                                                    <span className="gom-emp-name">{emp.emp_name}</span>
                                                                )}
                                                                <span className="gom-emp-code">{emp.emp_code}</span>
                                                            </div>
                                                        </td>
                                                        {days.map(d => {
                                                            const dayData = emp.daily?.[d]
                                                            const hours = dayData ? dayData.reduce((s, t) => s + t.hours, 0) : 0
                                                            const cfg = getOvertimeColor(hours)
                                                            const isSunday = gang.sundays?.includes(d)
                                                            const isHoliday = gang.holidays?.[d]

                                                            // Determine cell text
                                                            let cellText = '-'
                                                            if (hours > 0) {
                                                                if (dayData.length === 1) {
                                                                    cellText = `${hours}h`
                                                                } else {
                                                                    cellText = `${hours}h*`
                                                                }
                                                            }

                                                            // Determine cell bg override for weekends/holidays with no overtime
                                                            let finalBg = cfg.bg
                                                            let finalColor = cfg.color
                                                            if (hours === 0) {
                                                                if (isSunday) {
                                                                    finalBg = '#f3f4f6'
                                                                    finalColor = '#9ca3af'
                                                                } else if (isHoliday) {
                                                                    finalBg = '#fff7ed'
                                                                    finalColor = '#fbbf24'
                                                                }
                                                            }

                                                            return (
                                                                <td key={d}
                                                                    className={`gom-td-cell ${isSunday ? 'gom-sunday-cell' : ''} ${isHoliday ? 'gom-holiday-cell' : ''}`}
                                                                    style={{ background: finalBg, color: finalColor }}
                                                                    title={dayData ? `${dayData.length} transaksi: ${dayData.map(t => `${t.hours}h (${t.taskDesc || '-'}, ${t.dayType})`).join('; ')}` : (isSunday ? 'Minggu' : isHoliday ? gang.holidays[d] : 'Tidak ada lembur')}
                                                                >
                                                                    {cellText}
                                                                </td>
                                                            )
                                                        })}
                                                        <td className={`gom-td-sum gom-sum-hours ${emp.total_hours > 0 ? 'gom-sum-active' : ''}`}>
                                                            {emp.total_hours > 0 ? emp.total_hours.toFixed(1) : '-'}
                                                        </td>
                                                        <td className={`gom-td-sum gom-sum-rupiah ${emp.total_amount > 0 ? 'gom-sum-active' : ''}`}>
                                                            {emp.total_amount > 0 ? formatRupiah(emp.total_amount) : '-'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="gom-total-row">
                                                    <td colSpan={2} className="gom-td-total-label">
                                                        TOTAL ({gang.employees.length} karyawan)
                                                    </td>
                                                    {days.map(d => {
                                                        const totalDayHours = gang.employees.reduce((s, e) => {
                                                            const dayData = e.daily?.[d]
                                                            return s + (dayData ? dayData.reduce((s2, t) => s2 + t.hours, 0) : 0)
                                                        }, 0)
                                                        const isSunday = gang.sundays?.includes(d)
                                                        const isHoliday = gang.holidays?.[d]
                                                        return (
                                                            <td key={d}
                                                                className={`gom-td-total ${isSunday ? 'gom-sunday-total' : ''} ${isHoliday ? 'gom-holiday-total' : ''}`}
                                                                title={`Total ${totalDayHours}h pada tgl ${d}`}
                                                            >
                                                                {totalDayHours > 0 ? `${totalDayHours.toFixed(1)}h` : ''}
                                                            </td>
                                                        )
                                                    })}
                                                    <td className="gom-td-total gom-total-hours">{totalHours.toFixed(1)}</td>
                                                    <td className="gom-td-total gom-total-rupiah">{formatRupiah(totalAmount)}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>

            <style>{`
                .gom-container {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    width: 100%;
                    background: #fff;
                    border-radius: 12px;
                    border: 1px solid #e5e7eb;
                    overflow: hidden;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
                }
                .gom-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px 20px;
                    border-bottom: 1px solid #e5e7eb;
                    background: linear-gradient(135deg, #fffbeb, #fef3c7);
                }
                .gom-header-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .gom-header-left h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 700;
                    color: #111827;
                }
                .gom-period {
                    background: #d97706;
                    color: #fff;
                    padding: 3px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                }
                .gom-source-badge {
                    background: #eff6ff;
                    color: #1d4ed8;
                    padding: 3px 10px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 500;
                }
                .gom-header-right {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .gom-meta {
                    font-size: 11px;
                    color: #9ca3af;
                }
                .gom-legend {
                    display: flex;
                    gap: 8px;
                    padding: 8px 20px;
                    flex-wrap: wrap;
                    border-bottom: 1px solid #f3f4f6;
                    background: #fafafa;
                    align-items: center;
                }
                .gom-legend-item {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 28px;
                    height: 20px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 600;
                }
                .gom-content {
                    overflow-y: auto;
                    flex: 1;
                    padding: 12px 20px 20px;
                }
                .gom-gang-section {
                    margin-bottom: 12px;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    overflow: hidden;
                }
                .gom-gang-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 14px;
                    background: linear-gradient(135deg, #fffbeb, #fef3c7);
                    cursor: pointer;
                    user-select: none;
                    transition: background 0.15s;
                }
                .gom-gang-header:hover {
                    background: linear-gradient(135deg, #fef3c7, #fde68a);
                }
                .gom-toggle-icon {
                    font-size: 10px;
                    color: #92400e;
                    width: 14px;
                }
                .gom-gang-desc {
                    color: #92400e;
                    font-size: 13px;
                    flex: 1;
                }
                .gom-gang-count {
                    background: #fef3c7;
                    color: #b45309;
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: 600;
                }
                .gom-gang-stats {
                    font-size: 11px;
                    color: #92400e;
                    font-weight: 500;
                }
                .gom-table-wrapper {
                    overflow-x: auto;
                    max-height: 60vh;
                    overflow-y: auto;
                }
                .gom-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 11px;
                    white-space: nowrap;
                }
                .gom-table thead th {
                    position: sticky;
                    top: 0;
                    background: #fffbeb;
                    border-bottom: 2px solid #fde68a;
                    padding: 6px 3px;
                    text-align: center;
                    font-weight: 600;
                    color: #92400e;
                    z-index: 2;
                }
                .gom-th-no {
                    width: 30px;
                    min-width: 30px;
                    position: sticky;
                    left: 0;
                    z-index: 3 !important;
                    background: #fffbeb !important;
                }
                .gom-th-name {
                    min-width: 160px;
                    max-width: 200px;
                    text-align: left !important;
                    padding-left: 8px !important;
                    position: sticky;
                    left: 30px;
                    z-index: 3 !important;
                    background: #fffbeb !important;
                }
                .gom-th-day {
                    min-width: 30px;
                    width: 30px;
                }
                .gom-th-sum {
                    min-width: 45px;
                    background: #fef3c7 !important;
                    color: #b45309 !important;
                }
                .gom-th-rupiah {
                    min-width: 80px !important;
                }
                .gom-sunday {
                    background: #f3f4f6 !important;
                    color: #6b7280 !important;
                }
                .gom-holiday {
                    background: #fff7ed !important;
                    color: #ea580c !important;
                }
                .gom-td-no {
                    text-align: center;
                    color: #9ca3af;
                    position: sticky;
                    left: 0;
                    background: #fff;
                    z-index: 1;
                    border-right: 1px solid #f3f4f6;
                }
                .gom-td-name {
                    padding: 4px 8px;
                    position: sticky;
                    left: 30px;
                    background: #fff;
                    z-index: 1;
                    border-right: 1px solid #f3f4f6;
                    max-width: 200px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .gom-name-cell {
                    display: flex;
                    flex-direction: column;
                }
                .gom-emp-name {
                    font-weight: 600;
                    color: #111827;
                    font-size: 11px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .gom-emp-detail-btn {
                    border: none;
                    background: transparent;
                    color: #b45309;
                    font-weight: 700;
                    font-size: 11px;
                    cursor: pointer;
                    padding: 0;
                    text-align: left;
                    text-decoration: underline;
                    text-underline-offset: 2px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .gom-emp-detail-btn:hover {
                    color: #92400e;
                }
                .gom-emp-code {
                    font-size: 9px;
                    color: #6b7280;
                    font-weight: 400;
                }
                .gom-td-cell {
                    text-align: center;
                    padding: 3px 2px;
                    font-weight: 700;
                    font-size: 10px;
                    border: 1px solid #f3f4f6;
                    cursor: default;
                    transition: transform 0.1s;
                }
                .gom-td-cell:hover {
                    transform: scale(1.2);
                    z-index: 5;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                    border-radius: 3px;
                }
                .gom-sunday-cell {
                    background: #f3f4f6 !important;
                    color: #9ca3af !important;
                }
                .gom-holiday-cell {
                    background: #fff7ed !important;
                    color: #fbbf24 !important;
                }
                .gom-row-empty td {
                    opacity: 0.5;
                }
                .gom-td-sum {
                    text-align: center;
                    font-weight: 600;
                    padding: 3px 4px;
                    border-left: 1px solid #e5e7eb;
                    color: #9ca3af;
                }
                .gom-sum-hours { min-width: 40px; }
                .gom-sum-rupiah { min-width: 75px; text-align: right !important; padding-right: 6px !important; font-size: 10px; }
                .gom-sum-active { color: #b45309 !important; font-weight: 700; }
                .gom-total-row td {
                    background: #fffbeb !important;
                    font-weight: 700;
                    color: #b45309;
                    border-top: 2px solid #fde68a;
                }
                .gom-td-total-label {
                    text-align: center;
                    font-size: 11px;
                    position: sticky;
                    left: 0;
                    z-index: 1;
                }
                .gom-td-total {
                    text-align: center;
                    font-size: 10px;
                }
                .gom-total-hours { color: #b45309 !important; }
                .gom-total-rupiah { text-align: right !important; padding-right: 6px !important; }
                .gom-sunday-total { background: #f3f4f6 !important; color: #9ca3af !important; }
                .gom-holiday-total { background: #fff7ed !important; color: #fbbf24 !important; }
                .gom-loading {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 12px;
                    padding: 48px;
                }
                .gom-spinner {
                    width: 36px;
                    height: 36px;
                    border: 3px solid #fde68a;
                    border-top-color: #d97706;
                    border-radius: 50%;
                    animation: gom-spin 0.7s linear infinite;
                }
                @keyframes gom-spin {
                    to { transform: rotate(360deg); }
                }
                .gom-error {
                    padding: 32px;
                    text-align: center;
                    color: #dc2626;
                }
                .gom-retry-btn {
                    margin-top: 12px;
                    padding: 8px 16px;
                    background: #dc2626;
                    color: #fff;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 600;
                }
                .gom-empty {
                    padding: 32px;
                    text-align: center;
                    color: #9ca3af;
                    font-style: italic;
                }
                .gom-empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 40px;
                    text-align: center;
                }
                .gom-empty-icon {
                    font-size: 64px;
                    margin-bottom: 16px;
                    opacity: 0.5;
                }
                .gom-empty-state h3 {
                    margin: 0 0 8px;
                    font-size: 18px;
                    font-weight: 700;
                    color: #374151;
                }
                .gom-empty-state p {
                    margin: 0;
                    color: #6b7280;
                    font-size: 14px;
                    max-width: 450px;
                    line-height: 1.6;
                }
                .gom-division-badge {
                    background: #fef3c7;
                    color: #92400e;
                    padding: 3px 10px;
                    border-radius: 12px;
                    font-size: 11px;
                    font-weight: 600;
                    border: 1px solid #fcd34d;
                    margin-left: 8px;
                }
                tbody tr:nth-child(even) .gom-td-no,
                tbody tr:nth-child(even) .gom-td-name {
                    background: #fafafa;
                }
                tbody tr:hover .gom-td-no,
                tbody tr:hover .gom-td-name {
                    background: #fffbeb !important;
                }
                .gom-print-btn {
                    padding: 6px 12px;
                    background: #fff;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #92400e;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                    transition: all 0.2s;
                }
                .gom-print-btn:hover {
                    background: #fef3c7;
                    border-color: #fcd34d;
                }
                @media print {
                    @page {
                        size: landscape;
                        margin: 5mm;
                    }
                    body, html {
                       -webkit-print-color-adjust: exact !important;
                       print-color-adjust: exact !important;
                    }
                    .gom-container {
                        width: 100%;
                        background: white;
                        border: none;
                        box-shadow: none;
                        margin: 0;
                        font-family: inherit;
                    }
                    .gom-content {
                        overflow: visible !important;
                        max-height: none !important;
                        padding: 0;
                    }
                    .gom-table-wrapper {
                        overflow: visible !important;
                        max-height: none !important;
                    }

                    /* FIT TABLE TO A4 LANDSCAPE */
                    .gom-table {
                        width: 100% !important;
                        font-size: 8px !important;
                        table-layout: auto !important;
                    }
                    .gom-table thead th {
                        position: static !important;
                        padding: 2px 1px !important;
                        font-size: 8px !important;
                    }
                    .gom-td-no, .gom-td-name {
                        position: static !important;
                        background-color: transparent !important;
                    }
                    /* MINIMIZE COLUMN WIDTHS AND PADDINGS */
                    .gom-th-no, .gom-td-no { min-width: 15px !important; width: 15px !important; font-size: 7px !important; }
                    .gom-th-name, .gom-td-name { min-width: 80px !important; max-width: 110px !important; padding: 1px 2px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .gom-emp-name { font-size: 8px !important; }
                    .gom-emp-code { font-size: 7px !important; }
                    
                    .gom-th-day, .gom-td-cell { min-width: 14px !important; width: 14px !important; padding: 1px 0 !important; font-size: 8px !important; }
                    
                    .gom-th-sum, .gom-td-sum { min-width: 20px !important; font-size: 8px !important; padding: 1px !important; }
                    .gom-th-rupiah, .gom-sum-rupiah { min-width: 40px !important; font-size: 8px !important; }

                    .gom-print-btn, .gom-toggle-icon {
                        display: none !important;
                    }
                    .gom-gang-header {
                        position: static !important;
                        page-break-after: avoid;
                        padding: 4px 8px !important;
                        font-size: 10px !important;
                    }
                    .gom-gang-section {
                        page-break-inside: avoid;
                        margin-bottom: 20px;
                        border: 1px solid #e5e7eb;
                    }
                    .gom-td-total-label {
                        position: static !important;
                        font-size: 9px !important;
                    }
                    .gom-td-total {
                        font-size: 8px !important;
                    }
                }
            `}</style>
        </div>
    )
}
