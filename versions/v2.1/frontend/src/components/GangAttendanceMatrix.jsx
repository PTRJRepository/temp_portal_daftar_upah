/**
 * GangAttendanceMatrix - Displays attendance matrix for all employees in a gang.
 * Shows employee rows and day columns with attendance status or amount.
 */
import { useState, useEffect, useCallback } from 'react'
import { getGangAttendanceMatrix } from '../services/employeeDetailService'
import { fetchGangs } from '../services/gangService'
import { printReport } from '../utils/printPageSetup'

const STATUS_CONFIG = {
    H: { label: 'Hadir', color: '#166534', bg: '#dcfce7', short: 'H' },
    C: { label: 'Cuti Tahunan', color: '#7c3aed', bg: '#f3e8ff', short: 'C' },
    S: { label: 'Sakit', color: '#b91c1c', bg: '#fee2e2', short: 'S' },
    M: { label: 'Minggu', color: '#475569', bg: '#f1f5f9', short: 'M' },
    N: { label: 'Libur Nasional', color: '#c2410c', bg: '#fff7ed', short: 'N' },
    L: { label: 'Libur', color: '#c2410c', bg: '#fff7ed', short: 'L' },
    A: { label: 'Alpa', color: '#991b1b', bg: '#fecaca', short: 'A' },
    '-': { label: 'No Data', color: '#64748b', bg: '#f8fafc', short: '-' }
}

const STATUS_ALIAS_MAP = {
    H: 'H',
    HADIR: 'H',
    C: 'C',
    CUTI: 'C',
    CUTI_TAHUNAN: 'C',
    S: 'S',
    SAKIT: 'S',
    CUTI_SAKIT: 'S',
    M: 'M',
    MINGGU: 'M',
    CUTI_MINGGU: 'M',
    N: 'N',
    LIBUR_NASIONAL: 'N',
    LIBUR_KEAGAMAAN: 'L',
    L: 'L',
    LIBUR: 'L',
    A: 'A',
    ALPA: 'A',
    NO_DATA: '-',
    '-': '-'
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const fmtCurrency = (val) => {
    if (val === null || val === undefined || isNaN(val)) return '-'
    return new Intl.NumberFormat('id-ID', {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(val)
}

const fmtCompactAmount = (val) => {
    const numeric = Number(val)
    if (!Number.isFinite(numeric) || numeric <= 0) return ''
    if (numeric < 1000) return `${numeric}`

    const inThousands = numeric / 1000
    const compact = Number.isInteger(inThousands)
        ? `${inThousands}`
        : inThousands.toFixed(1).replace(/\.0$/, '')
    return `${compact}k`
}

const fmtHourBadge = (hours) => {
    const numeric = Number(hours)
    if (!Number.isFinite(numeric) || numeric <= 0) return '0j'
    return `${Number.isInteger(numeric) ? numeric : numeric.toFixed(1).replace(/\.0$/, '')}j`
}

const toNumber = (value) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : 0
}

const getTargetHoursForDay = (day, month, year) => {
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
        return 7
    }
    return new Date(year, month - 1, day).getDay() === 5 ? 5 : 7
}

const normalizeStatusCode = ({ rawStatus, rawRemarks, isSunday, isHoliday, hours, amount }) => {
    const normalized = String(rawStatus ?? '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_')
    const normalizedRemarks = String(rawRemarks ?? '').trim().toUpperCase()

    if (STATUS_ALIAS_MAP[normalized]) {
        return STATUS_ALIAS_MAP[normalized]
    }

    if (!normalized || normalized === 'NO_DATA') {
        if (isSunday) return 'M'
        if (isHoliday) return 'N'
        return '-'
    }

    // Heuristic fallback (keep aligned with EmployeeDetail semantics)
    if (normalized.includes('SAKIT') || normalizedRemarks.includes('SAKIT')) return 'S'
    if (normalized.includes('CUTI') || normalizedRemarks.includes('CUTI')) return 'C'
    if (normalized.includes('ALPA') || normalizedRemarks.includes('ALPA')) return 'A'
    if (normalized.includes('MINGGU') || normalizedRemarks.includes('MINGGU')) return 'M'
    if (normalized.includes('LIBUR') || normalizedRemarks.includes('LIBUR')) return isHoliday ? 'N' : 'L'

    if (isSunday) return 'M'
    if (isHoliday) return 'N'

    if (hours > 0 || amount > 0) return 'H'
    return '-'
}

const buildDayState = ({ dayData, day, month, year, isSunday, isHoliday }) => {
    const hours = toNumber(dayData?.hours)
    const amount = toNumber(dayData?.amount)
    const remarks = typeof dayData?.remarks === 'string' ? dayData.remarks.trim() : ''
    const statusCode = normalizeStatusCode({
        rawStatus: dayData?.status,
        rawRemarks: remarks,
        isSunday,
        isHoliday,
        hours,
        amount
    })
    const cfg = STATUS_CONFIG[statusCode] || STATUS_CONFIG['-']
    const targetHours = getTargetHoursForDay(day, month, year)
    const isShort = statusCode === 'H' && hours > 0 && hours < targetHours && !isSunday && !isHoliday

    return {
        statusCode,
        cfg,
        hours,
        amount,
        isShort,
        targetHours,
        remarks
    }
}

const buildPeriodLabel = (month, year) => {
    if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year)) {
        return `${MONTHS[month - 1]} ${year}`
    }
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
        return MONTHS[month - 1]
    }
    return '-'
}

export default function GangAttendanceMatrix({
    token,
    gangCodes,
    month,
    year,
    division,
    includeFaceVerification = true,
    onViewEmployeeDetail = null
}) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [expandedGangs, setExpandedGangs] = useState(new Set())
    const [resolvedGangCodes, setResolvedGangCodes] = useState(null)
    const [displayMode, setDisplayMode] = useState('status')

    useEffect(() => {
        if (gangCodes && gangCodes.length > 0) {
            setResolvedGangCodes(gangCodes)
            return
        }
        if (!division || !token) {
            setResolvedGangCodes([])
            return
        }

        let cancelled = false
        const loadGangs = async () => {
            try {
                const gangs = await fetchGangs(token, division, null, true)
                if (!cancelled && gangs && gangs.length > 0) {
                    setResolvedGangCodes(gangs.map(g => g.gang_code))
                } else {
                    setResolvedGangCodes([])
                }
            } catch (e) {
                console.error('[GangAttendanceMatrix] Failed to load gangs:', e)
                if (!cancelled) setResolvedGangCodes([])
            }
        }

        loadGangs()
        return () => { cancelled = true }
    }, [gangCodes, division, token])

    const fetchData = useCallback(async () => {
        const codes = resolvedGangCodes
        if (!codes || codes.length === 0 || !month || !year) return

        setLoading(true)
        setError(null)
        try {
            const result = await getGangAttendanceMatrix(token, codes, month, year, includeFaceVerification)
            setData(result)
            if (result?.data) {
                setExpandedGangs(new Set(result.data.map(g => g.gang_code)))
            }
        } catch (err) {
            setError(err.message || 'Gagal memuat data matrix absensi')
        } finally {
            setLoading(false)
        }
    }, [token, resolvedGangCodes, month, year, includeFaceVerification])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const periodLabel = buildPeriodLabel(month, year)
    const hasRequestedGangs = Array.isArray(resolvedGangCodes) && resolvedGangCodes.length > 0

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

    const renderHeader = (rightContent = null) => (
        <div className="gam-header">
            <div className="gam-header-left">
                <h2>Matriks Absensi Gang</h2>
                <span className="gam-period">{periodLabel}</span>
                {division && <span className="gam-division-badge">{division}</span>}
                <span className="gam-source-badge">Data Historis</span>
            </div>
            {rightContent && <div className="gam-header-right">{rightContent}</div>}
        </div>
    )

    if (resolvedGangCodes === null) {
        return (
            <div className="gam-inline-container">
                {renderHeader()}
                <div className="gam-loading">
                    <div className="gam-spinner" />
                    <p>Memuat daftar gang...</p>
                </div>
            </div>
        )
    }

    if (!hasRequestedGangs) {
        return (
            <div className="gam-inline-container">
                {renderHeader()}
                <div className="gam-empty-state">
                    <h3>Matriks absensi belum tersedia</h3>
                    <p>Data karyawan untuk periode ini belum ditemukan. Pastikan data payroll periode terkait sudah tergenerate.</p>
                    <div className="gam-empty-hint">
                        Periode: <strong>{periodLabel}</strong>
                    </div>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="gam-inline-container">
                {renderHeader()}
                <div className="gam-loading">
                    <div className="gam-spinner" />
                    <p>Memuat matriks absensi...</p>
                    <span className="gam-loading-detail">Mengambil data {resolvedGangCodes.length} gang</span>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="gam-inline-container">
                {renderHeader()}
                <div className="gam-error">
                    <p>{error}</p>
                    <button onClick={fetchData} className="gam-retry-btn">Coba lagi</button>
                </div>
            </div>
        )
    }

    const gangs = data?.data || []
    const meta = data?.meta || {}

    return (
        <div className="gam-inline-container">
            {renderHeader(
                <>
                    <div className="gam-mode-toggle" role="group" aria-label="Attendance matrix display mode">
                        <button
                            type="button"
                            className={`gam-mode-btn ${displayMode === 'status' ? 'active' : ''}`}
                            onClick={() => setDisplayMode('status')}
                        >
                            Status
                        </button>
                        <button
                            type="button"
                            className={`gam-mode-btn ${displayMode === 'amount' ? 'active' : ''}`}
                            onClick={() => setDisplayMode('amount')}
                        >
                            Amount
                        </button>
                    </div>
                    <button onClick={handlePrint} className="gam-print-btn" title="Cetak matrix absensi">
                        Print
                    </button>
                    {meta.execution_time_ms && (
                        <span className="gam-meta">{meta.total_employees} karyawan | {meta.execution_time_ms}ms</span>
                    )}
                </>
            )}

            <div className="gam-legend">
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                    <span key={key} className="gam-legend-item" style={{ background: cfg.bg, color: cfg.color }}>
                        <strong>{cfg.short}</strong> {cfg.label}
                    </span>
                ))}
                <span className="gam-legend-item" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
                    <strong>WRN</strong> Kurang Jam
                </span>
                {includeFaceVerification && (
                    <>
                        <span className="gam-legend-divider" />
                        <span className="gam-face-legend-item" style={{ color: '#047857', background: '#d1fae5' }}>
                            <strong>V</strong> Face OK
                        </span>
                        <span className="gam-face-legend-item" style={{ color: '#b91c1c', background: '#fef2f2' }}>
                            <strong>X</strong> No Face
                        </span>
                    </>
                )}
            </div>

            <div className="gam-content">
                {gangs.length === 0 ? (
                    <div className="gam-empty">Tidak ada data absensi untuk gang yang dipilih pada periode ini.</div>
                ) : (
                    gangs.map(gang => {
                        const isExpanded = expandedGangs.has(gang.gang_code)
                        const days = Array.from({ length: gang.days_in_month || 0 }, (_, i) => i + 1)
                        const sundaySet = new Set((gang.sundays || []).map(Number))
                        const holidaySet = new Set(Object.keys(gang.holidays || {}).map(Number))

                        const employeesWithStates = (gang.employees || []).map(emp => {
                            const dayStates = days.map((day) => {
                                const dayData = emp.daily?.[day]
                                const isSunday = sundaySet.has(day)
                                const isHoliday = holidaySet.has(day) || dayData?.is_holiday === true
                                return buildDayState({ dayData, day, month, year, isSunday, isHoliday })
                            })

                            const computedSummary = dayStates.reduce((acc, state) => {
                                if (state.statusCode === 'H') acc.hadir++
                                if (state.statusCode === 'C') acc.cuti_tahunan++
                                if (state.statusCode === 'S') acc.cuti_sakit++
                                if (state.statusCode === 'A') acc.alpa++
                                return acc
                            }, {
                                hadir: 0,
                                cuti_tahunan: 0,
                                cuti_sakit: 0,
                                alpa: 0,
                                total_hk: 0
                            })
                            computedSummary.total_hk = computedSummary.hadir + computedSummary.cuti_tahunan + computedSummary.cuti_sakit

                            return {
                                emp,
                                dayStates,
                                summary: computedSummary
                            }
                        })

                        const dayHadirTotals = days.map((_, idx) => (
                            employeesWithStates.reduce((sum, row) => {
                                return sum + (row.dayStates[idx]?.statusCode === 'H' ? 1 : 0)
                            }, 0)
                        ))

                        const gangTotals = employeesWithStates.reduce((acc, row) => {
                            acc.hadir += row.summary.hadir
                            acc.cuti_tahunan += row.summary.cuti_tahunan
                            acc.cuti_sakit += row.summary.cuti_sakit
                            acc.alpa += row.summary.alpa
                            acc.total_hk += row.summary.total_hk
                            return acc
                        }, {
                            hadir: 0,
                            cuti_tahunan: 0,
                            cuti_sakit: 0,
                            alpa: 0,
                            total_hk: 0
                        })

                        return (
                            <div key={gang.gang_code} className="gam-gang-section">
                                <div className="gam-gang-header" onClick={() => toggleGang(gang.gang_code)}>
                                    <span className="gam-toggle-icon">{isExpanded ? 'v' : '>'}</span>
                                    <strong>{gang.gang_code}</strong>
                                    <span className="gam-gang-desc">{gang.gang_description || '-'}</span>
                                    <span className="gam-gang-count">{gang.employees.length} karyawan</span>
                                </div>

                                {isExpanded && (
                                    <div className="gam-table-wrapper">
                                        <table className="gam-table">
                                            <thead>
                                                <tr>
                                                    <th className="gam-th-no">No</th>
                                                    <th className="gam-th-empcode">EmpCode</th>
                                                    <th className="gam-th-name">Nama</th>
                                                    {days.map(d => {
                                                        const isSunday = sundaySet.has(d)
                                                        const isHoliday = holidaySet.has(d)
                                                        return (
                                                            <th
                                                                key={d}
                                                                className={`gam-th-day ${isSunday ? 'gam-sunday' : ''} ${isHoliday ? 'gam-holiday' : ''}`}
                                                                title={isHoliday ? (gang.holidays?.[d] || 'Libur') : (isSunday ? 'Minggu' : `Tanggal ${d}`)}
                                                            >
                                                                {d}
                                                            </th>
                                                        )
                                                    })}
                                                    <th className="gam-th-sum" title="Hadir">H</th>
                                                    <th className="gam-th-sum" title="Cuti">C</th>
                                                    <th className="gam-th-sum" title="Sakit">S</th>
                                                    <th className="gam-th-sum" title="Alpa">A</th>
                                                    <th className="gam-th-sum" title="Total HK">HK</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {employeesWithStates.map((row, idx) => (
                                                    <tr key={row.emp.emp_code}>
                                                        <td className="gam-td-no">{idx + 1}</td>
                                                        <td className="gam-td-empcode" title={`Rekening: ${row.emp.bank_acc_no || '-'}`}>
                                                            {row.emp.emp_code}
                                                        </td>
                                                        <td className="gam-td-name" title={`${row.emp.emp_name} (${row.emp.emp_code})`}>
                                                            {typeof onViewEmployeeDetail === 'function' ? (
                                                                <button
                                                                    type="button"
                                                                    className="gam-emp-detail-btn"
                                                                    title={`Buka detail ${row.emp.emp_name} (${row.emp.emp_code})`}
                                                                    onClick={() => onViewEmployeeDetail({
                                                                        emp_code: row.emp.emp_code,
                                                                        emp_name: row.emp.emp_name,
                                                                        nik: row.emp.emp_code,
                                                                        gang_code: gang.gang_code,
                                                                        division
                                                                    })}
                                                                >
                                                                    {row.emp.emp_name}
                                                                </button>
                                                            ) : (
                                                                <span className="gam-emp-name-text">{row.emp.emp_name}</span>
                                                            )}
                                                        </td>
                                                        {row.dayStates.map((state, dayIdx) => {
                                                            const day = days[dayIdx]
                                                            const dayData = row.emp.daily?.[day]
                                                            const faceVerif = row.emp.face_verification?.[day]
                                                            const hasFaceData = faceVerif !== undefined
                                                            const faceOk = faceVerif === true
                                                            const shortage = state.isShort ? (state.targetHours - state.hours).toFixed(1) : '0'

                                                            let displayValue = state.cfg.short
                                                            if (displayMode === 'amount' && state.amount > 0) {
                                                                displayValue = fmtCompactAmount(state.amount) || state.cfg.short
                                                            } else if (state.isShort) {
                                                                displayValue = fmtHourBadge(state.hours)
                                                            }

                                                            const cellStyle = {
                                                                background: state.cfg.bg,
                                                                color: state.cfg.color,
                                                                fontSize: '10px'
                                                            }
                                                            if (displayMode === 'amount' && state.amount > 0) {
                                                                cellStyle.fontSize = displayValue.length > 3 ? '8px' : '9px'
                                                            } else if (state.isShort) {
                                                                cellStyle.background = '#fef3c7'
                                                                cellStyle.color = '#92400e'
                                                                cellStyle.fontSize = '8px'
                                                            }

                                                            const tooltip = [
                                                                `${row.emp.emp_name} - Tgl ${day}: ${state.cfg.label}`,
                                                                state.remarks ? `Keterangan: ${state.remarks}` : null,
                                                                `Jam: ${state.hours} / Target: ${state.targetHours}`,
                                                                state.amount > 0 ? `Amount: Rp ${fmtCurrency(state.amount)}` : null,
                                                                state.isShort ? `Warning: Kurang ${shortage} jam` : null,
                                                                hasFaceData ? (faceOk ? 'Face: OK' : 'Face: Belum') : null
                                                            ].filter(Boolean).join('\n')

                                                            return (
                                                                <td
                                                                    key={day}
                                                                    className={`gam-td-cell ${hasFaceData ? (faceOk ? 'gam-cell-face-ok' : 'gam-cell-face-no') : ''} ${state.isShort ? 'gam-cell-short' : ''}`}
                                                                    style={cellStyle}
                                                                    title={tooltip}
                                                                >
                                                                    {hasFaceData && (
                                                                        <span className={`gam-face-badge ${faceOk ? 'gam-face-badge-ok' : 'gam-face-badge-no'}`}>
                                                                            {faceOk ? 'V' : 'X'}
                                                                        </span>
                                                                    )}
                                                                    <span className="gam-cell-status">{displayValue}</span>
                                                                </td>
                                                            )
                                                        })}
                                                        <td className="gam-td-sum gam-sum-hadir">{row.summary.hadir}</td>
                                                        <td className="gam-td-sum gam-sum-cuti">{row.summary.cuti_tahunan}</td>
                                                        <td className="gam-td-sum gam-sum-sakit">{row.summary.cuti_sakit}</td>
                                                        <td className="gam-td-sum gam-sum-alpa">{row.summary.alpa}</td>
                                                        <td className="gam-td-sum gam-sum-hk">{row.summary.total_hk}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="gam-total-row">
                                                    <td colSpan={3} className="gam-td-total-label">TOTAL</td>
                                                    {days.map((day, idx) => (
                                                        <td key={day} className="gam-td-total" title={`${dayHadirTotals[idx]} hadir pada tgl ${day}`}>
                                                            {dayHadirTotals[idx] || ''}
                                                        </td>
                                                    ))}
                                                    <td className="gam-td-total">{gangTotals.hadir}</td>
                                                    <td className="gam-td-total">{gangTotals.cuti_tahunan}</td>
                                                    <td className="gam-td-total">{gangTotals.cuti_sakit}</td>
                                                    <td className="gam-td-total">{gangTotals.alpa}</td>
                                                    <td className="gam-td-total">{gangTotals.total_hk}</td>
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
                .gam-inline-container {
                    display: flex;
                    flex-direction: column;
                    flex: 0 0 auto;
                    min-height: 0;
                    width: 100%;
                    background: #ffffff;
                    border: 1px solid #1a365d;
                    border-radius: 10px;
                    overflow: hidden;
                    font-family: 'IBM Plex Sans', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }
                .gam-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    padding: 12px 16px;
                    border-bottom: 1px solid #dbe4ee;
                    background: #f8fafc;
                }
                .gam-header-left {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .gam-header-left h2 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 700;
                    color: #0f172a;
                }
                .gam-period {
                    padding: 3px 8px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                    background: #0f172a;
                    color: #f8fafc;
                }
                .gam-source-badge {
                    padding: 3px 8px;
                    border-radius: 999px;
                    border: 1px solid #bfdbfe;
                    background: #eff6ff;
                    color: #1d4ed8;
                    font-size: 11px;
                    font-weight: 700;
                }
                .gam-division-badge {
                    padding: 3px 8px;
                    border-radius: 999px;
                    border: 1px solid #fde68a;
                    background: #fffbeb;
                    color: #92400e;
                    font-size: 11px;
                    font-weight: 700;
                }
                .gam-header-right {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                }
                .gam-mode-toggle {
                    display: inline-flex;
                    align-items: center;
                    padding: 2px;
                    border: 1px solid #cbd5e1;
                    border-radius: 999px;
                    background: #ffffff;
                }
                .gam-mode-btn {
                    border: none;
                    background: transparent;
                    color: #475569;
                    padding: 6px 10px;
                    border-radius: 999px;
                    font-size: 12px;
                    font-weight: 700;
                    cursor: pointer;
                }
                .gam-mode-btn.active {
                    background: #0f172a;
                    color: #ffffff;
                }
                .gam-print-btn {
                    border: 1px solid #cbd5e1;
                    border-radius: 999px;
                    background: #ffffff;
                    color: #0f172a;
                    font-size: 12px;
                    font-weight: 700;
                    padding: 6px 12px;
                    cursor: pointer;
                }
                .gam-print-btn:hover {
                    background: #f8fafc;
                }
                .gam-meta {
                    font-size: 11px;
                    color: #64748b;
                    font-weight: 600;
                }
                .gam-legend {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 16px;
                    flex-wrap: wrap;
                    border-bottom: 1px solid #e2e8f0;
                    background: #ffffff;
                }
                .gam-legend-item {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    border-radius: 6px;
                    border: 1px solid rgba(15, 23, 42, 0.08);
                    padding: 2px 7px;
                    font-size: 11px;
                    font-weight: 600;
                }
                .gam-face-legend-item {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    border-radius: 6px;
                    padding: 2px 7px;
                    font-size: 11px;
                    font-weight: 700;
                    border: 1px solid rgba(15, 23, 42, 0.08);
                }
                .gam-legend-divider {
                    width: 1px;
                    height: 16px;
                    background: #cbd5e1;
                    margin: 0 2px;
                }
                .gam-content {
                    overflow-x: auto;
                    overflow-y: auto;
                    flex: 1 1 auto;
                    min-height: 220px;
                    max-height: min(68vh, 720px);
                    padding: 12px 16px 16px;
                    background: #ffffff;
                }
                .gam-gang-section {
                    border: 1px solid #dbe4ee;
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 12px;
                }
                .gam-gang-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    background: #f8fafc;
                    border-bottom: 1px solid #e2e8f0;
                    cursor: pointer;
                    user-select: none;
                    position: sticky;
                    top: 0;
                    z-index: 5;
                }
                .gam-toggle-icon {
                    width: 12px;
                    color: #475569;
                    font-weight: 700;
                    font-size: 11px;
                }
                .gam-gang-desc {
                    color: #64748b;
                    font-size: 12px;
                    flex: 1;
                }
                .gam-gang-count {
                    padding: 2px 8px;
                    border-radius: 999px;
                    border: 1px solid #bfdbfe;
                    background: #eff6ff;
                    color: #1d4ed8;
                    font-size: 11px;
                    font-weight: 700;
                }
                .gam-table-wrapper {
                    overflow-x: auto;
                    overflow-y: auto;
                    min-width: 0;
                    width: 100%;
                    max-height: min(56vh, 560px);
                    overscroll-behavior: contain;
                }
                .gam-table {
                    width: max-content;
                    min-width: 100%;
                    border-collapse: collapse;
                    white-space: nowrap;
                    font-size: 11px;
                }
                .gam-table thead th {
                    position: sticky;
                    top: 0;
                    z-index: 2;
                    background: #0f172a;
                    color: #f8fafc;
                    border: 1px solid #1e293b;
                    padding: 4px 3px;
                    text-align: center;
                    font-weight: 700;
                }
                .gam-th-no,
                .gam-td-no {
                    min-width: 28px;
                    width: 28px;
                    max-width: 28px;
                    position: sticky;
                    left: 0;
                    z-index: 3;
                }
                .gam-th-empcode,
                .gam-td-empcode {
                    min-width: 82px;
                    max-width: 90px;
                    position: sticky;
                    left: 28px;
                    z-index: 3;
                }
                .gam-th-name,
                .gam-td-name {
                    min-width: 160px;
                    max-width: 180px;
                    position: sticky;
                    left: 110px;
                    z-index: 3;
                }
                .gam-th-no,
                .gam-th-empcode,
                .gam-th-name {
                    background: #0f172a !important;
                    color: #f8fafc;
                }
                .gam-td-no,
                .gam-td-empcode,
                .gam-td-name {
                    border: 1px solid #e2e8f0;
                    background: #ffffff;
                }
                .gam-td-no {
                    text-align: center;
                    color: #64748b;
                    font-weight: 600;
                }
                .gam-td-empcode {
                    padding: 3px 6px;
                    text-align: left;
                    font-size: 10px;
                    color: #1d4ed8;
                    font-weight: 700;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .gam-td-name {
                    padding: 3px 8px;
                    text-align: left;
                    color: #0f172a;
                    font-weight: 600;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .gam-emp-name-text {
                    display: inline-block;
                    max-width: 100%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .gam-emp-detail-btn {
                    border: none;
                    background: transparent;
                    color: #1d4ed8;
                    font-size: 11px;
                    font-weight: 700;
                    padding: 0;
                    cursor: pointer;
                    text-align: left;
                    max-width: 100%;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    text-decoration: underline;
                    text-underline-offset: 2px;
                }
                .gam-emp-detail-btn:hover {
                    color: #1e3a8a;
                }
                .gam-th-day,
                .gam-td-cell {
                    min-width: 32px;
                    width: 32px;
                    max-width: 32px;
                }
                .gam-th-day {
                    padding: 4px 1px;
                }
                .gam-sunday {
                    background: #7f1d1d !important;
                }
                .gam-holiday {
                    background: #78350f !important;
                }
                .gam-td-cell {
                    border: 1px solid #e2e8f0;
                    text-align: center;
                    padding: 2px;
                    font-weight: 700;
                    position: relative;
                }
                .gam-td-cell:hover {
                    outline: 1px solid #93c5fd;
                    outline-offset: -1px;
                }
                .gam-cell-short {
                    padding-left: 1px;
                    padding-right: 1px;
                }
                .gam-face-badge {
                    display: inline-block;
                    font-size: 8px;
                    font-weight: 800;
                    line-height: 1;
                    margin-right: 1px;
                }
                .gam-face-badge-ok { color: #047857; }
                .gam-face-badge-no { color: #b91c1c; }
                .gam-cell-status {
                    font-weight: 700;
                    font-size: 10px;
                }
                .gam-th-sum {
                    min-width: 30px;
                    background: #1e293b !important;
                }
                .gam-td-sum,
                .gam-td-total {
                    min-width: 30px;
                    text-align: center;
                    border: 1px solid #e2e8f0;
                    font-weight: 700;
                    padding: 3px 4px;
                }
                .gam-sum-hadir { color: #166534; background: #f0fdf4; }
                .gam-sum-cuti { color: #6d28d9; background: #f5f3ff; }
                .gam-sum-sakit { color: #b91c1c; background: #fef2f2; }
                .gam-sum-alpa { color: #991b1b; background: #fee2e2; }
                .gam-sum-hk { color: #1d4ed8; background: #eff6ff; }
                .gam-total-row td {
                    background: #f8fafc !important;
                    border-top: 2px solid #cbd5e1;
                    color: #334155;
                    font-weight: 800;
                }
                .gam-td-total-label {
                    text-align: center;
                    font-size: 11px;
                    position: sticky;
                    left: 0;
                    z-index: 2;
                }
                .gam-loading,
                .gam-error,
                .gam-empty-state,
                .gam-empty {
                    text-align: center;
                    padding: 36px 20px;
                    color: #475569;
                }
                .gam-loading {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 10px;
                }
                .gam-spinner {
                    width: 32px;
                    height: 32px;
                    border: 3px solid #e2e8f0;
                    border-top-color: #1d4ed8;
                    border-radius: 50%;
                    animation: gam-spin 0.8s linear infinite;
                }
                .gam-loading-detail {
                    font-size: 12px;
                    color: #64748b;
                }
                .gam-empty-state h3 {
                    margin: 0 0 8px;
                    color: #0f172a;
                    font-size: 16px;
                    font-weight: 700;
                }
                .gam-empty-state p {
                    margin: 0 0 12px;
                    font-size: 14px;
                    color: #64748b;
                    line-height: 1.5;
                }
                .gam-empty-hint {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 10px;
                    border: 1px solid #fde68a;
                    border-radius: 8px;
                    background: #fffbeb;
                    color: #92400e;
                    font-size: 12px;
                    font-weight: 600;
                }
                .gam-retry-btn {
                    margin-top: 8px;
                    border: 1px solid #1d4ed8;
                    background: #1d4ed8;
                    color: #ffffff;
                    border-radius: 6px;
                    padding: 8px 14px;
                    font-size: 12px;
                    font-weight: 700;
                    cursor: pointer;
                }
                .gam-retry-btn:hover {
                    background: #1e40af;
                    border-color: #1e40af;
                }
                @keyframes gam-spin {
                    to { transform: rotate(360deg); }
                }
                @media print {
                    @page {
                        size: landscape;
                        margin: 5mm;
                    }
                    .gam-inline-container {
                        border: none;
                        border-radius: 0;
                        box-shadow: none;
                    }
                    .gam-print-btn,
                    .gam-mode-toggle {
                        display: none !important;
                    }
                    .gam-content,
                    .gam-table-wrapper {
                        overflow: visible !important;
                    }
                    .gam-table {
                        font-size: 8px !important;
                    }
                    .gam-table thead th {
                        position: static !important;
                        padding: 2px 1px !important;
                    }
                    .gam-th-no, .gam-td-no {
                        min-width: 14px !important;
                        width: 14px !important;
                    }
                    .gam-th-empcode, .gam-td-empcode {
                        min-width: 40px !important;
                        max-width: 50px !important;
                        padding: 1px !important;
                    }
                    .gam-th-name, .gam-td-name {
                        min-width: 74px !important;
                        max-width: 94px !important;
                        padding: 1px 2px !important;
                    }
                    .gam-th-day, .gam-td-cell {
                        min-width: 14px !important;
                        width: 14px !important;
                        padding: 1px 0 !important;
                    }
                    .gam-face-badge {
                        display: none !important;
                    }
                    .gam-th-sum, .gam-td-sum, .gam-td-total {
                        min-width: 16px !important;
                        font-size: 8px !important;
                    }
                }
            `}</style>
        </div>
    )
}
