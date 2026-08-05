/**
 * UpahBersihDetailPage
 * 
 * Report page for detailed upah bersih (net wages) with drill-down
 * into lembur (overtime) and premi (premium) activity records.
 * Data is sourced from extend_db_ptrj history tables for fast retrieval.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchUpahBersihDetail } from '../services/upahBersihDetailService'
import { fetchDivisions, fetchGangs } from '../services/gangService'
import LoadingScreen from '../components/common/LoadingScreen'
import '../styles/upah-bersih-detail.css'

const FILTER_OPTIONS = [
    { value: 'all', label: 'Semua', icon: '📋' },
    { value: 'lembur', label: 'Lembur', icon: '⏰' },
    { value: 'premi', label: 'Premi', icon: '💰' },
    { value: 'upah_bersih', label: 'Upah Bersih', icon: '💵' },
]

const MONTHS = [
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
    { value: 12, label: 'Desember' },
]

const formatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '-'
    return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)
}

const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    try {
        const d = new Date(dateStr)
        return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
    } catch {
        return dateStr
    }
}

export default function UpahBersihDetailPage({ onBack, initialMonth, initialYear, initialDivision }) {
    const { token, user } = useAuth();
    const now = new Date();
    const [month, setMonth] = useState(initialMonth || now.getMonth() + 1)
    const [year, setYear] = useState(initialYear || now.getFullYear())
    const [division, setDivision] = useState(initialDivision || 'ALL')

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
        if (initialDivision !== undefined) setDivision(initialDivision);
    }, [initialMonth, initialYear, initialDivision]);
    const [gangCode, setGangCode] = useState('ALL')
    const [filter, setFilter] = useState('all')
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [divisions, setDivisions] = useState([])
    const [gangs, setGangs] = useState([])
    const [expandedGangs, setExpandedGangs] = useState(new Set())
    const [expandedEmployees, setExpandedEmployees] = useState(new Set())

    // Load divisions
    useEffect(() => {
        async function loadDivisions() {
            try {
                const result = await fetchDivisions(token)
                if (result?.data) {
                    setDivisions(result.data)
                } else if (Array.isArray(result)) {
                    setDivisions(result)
                }
            } catch (e) {
                console.error('Failed to load divisions:', e)
            }
        }
        if (token) loadDivisions()
    }, [token])

    // Load gangs when division changes
    useEffect(() => {
        async function loadGangs() {
            try {
                const result = await fetchGangs(token, division !== 'ALL' ? division : null)
                if (result?.data) {
                    setGangs(result.data)
                } else if (Array.isArray(result)) {
                    setGangs(result)
                }
            } catch (e) {
                console.error('Failed to load gangs:', e)
                setGangs([])
            }
        }
        if (token) loadGangs()
        setGangCode('ALL')
    }, [token, division])

    // Fetch data handler
    const handleFetch = useCallback(async () => {
        if (!token) return
        setLoading(true)
        setError('')
        setExpandedGangs(new Set())
        setExpandedEmployees(new Set())

        try {
            const result = await fetchUpahBersihDetail(
                token, month, year, filter,
                division !== 'ALL' ? division : null,
                gangCode !== 'ALL' ? gangCode : null
            )

            if (result.success) {
                setData(result)
                // Auto-expand all gangs if few results
                if (result.gangs && result.gangs.length <= 5) {
                    setExpandedGangs(new Set(result.gangs.map(g => g.gang_code)))
                }
            } else {
                setError(result.error || 'Gagal mengambil data')
            }
        } catch (e) {
            setError(e.response?.data?.error || e.message || 'Network error')
        } finally {
            setLoading(false)
        }
    }, [token, month, year, filter, division, gangCode])

    // Toggle gang expansion
    const toggleGang = (gangCode) => {
        setExpandedGangs(prev => {
            const next = new Set(prev)
            if (next.has(gangCode)) {
                next.delete(gangCode)
            } else {
                next.add(gangCode)
            }
            return next
        })
    }

    // Toggle employee activity expansion
    const toggleEmployee = (empKey) => {
        setExpandedEmployees(prev => {
            const next = new Set(prev)
            if (next.has(empKey)) {
                next.delete(empKey)
            } else {
                next.add(empKey)
            }
            return next
        })
    }

    const getFilterLabel = () => {
        const opt = FILTER_OPTIONS.find(f => f.value === filter)
        return opt ? `${opt.icon} ${opt.label}` : filter
    }

    const getMonthLabel = (m) => {
        const opt = MONTHS.find(mo => mo.value === m)
        return opt ? opt.label : m
    }

    return (
        <div className="ubd-container">
            {/* Header */}
            <div className="ubd-header">
                <h1>
                    <span className="icon">📊</span>
                    Detail Upah Bersih
                </h1>
                {onBack && (
                    <button className="ubd-back-btn" onClick={onBack}>
                        ← Kembali
                    </button>
                )}
            </div>

            {/* Toolbar */}
            <div className="ubd-toolbar">
                <div className="field-group">
                    <label>Bulan</label>
                    <select value={month} onChange={e => setMonth(parseInt(e.target.value))}>
                        {MONTHS.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>
                </div>

                <div className="field-group">
                    <label>Tahun</label>
                    <select value={year} onChange={e => setYear(parseInt(e.target.value))}>
                        {[2024, 2025, 2026, 2027].map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>

                <div className="field-group">
                    <label>Divisi</label>
                    <select value={division} onChange={e => setDivision(e.target.value)}>
                        <option value="ALL">Semua Divisi</option>
                        {divisions.map(d => (
                            <option key={d.DivisionCode || d.division_code || d} value={d.DivisionCode || d.division_code || d}>
                                {d.DivisionName || d.division_name || d.DivisionCode || d.division_code || d}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="field-group">
                    <label>Gang</label>
                    <select value={gangCode} onChange={e => setGangCode(e.target.value)}>
                        <option value="ALL">Semua Gang</option>
                        {gangs.map(g => (
                            <option key={g.GangCode || g.gang_code || g} value={g.GangCode || g.gang_code || g}>
                                {g.GangCode || g.gang_code || g} {g.GangDescription ? `- ${g.GangDescription}` : ''}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="field-group">
                    <label>Filter</label>
                    <select value={filter} onChange={e => setFilter(e.target.value)}>
                        {FILTER_OPTIONS.map(f => (
                            <option key={f.value} value={f.value}>{f.icon} {f.label}</option>
                        ))}
                    </select>
                </div>

                <button className="ubd-fetch-btn" onClick={handleFetch} disabled={loading}>
                    {loading ? '⏳ Memuat...' : '🔍 Tampilkan'}
                </button>
            </div>

            {/* Loading */}
            {loading && <LoadingScreen isLoading={true} message="Mengambil detail upah bersih..." />}

            {/* Error */}
            {error && !loading && (
                <div className="ubd-empty">
                    <div className="empty-icon">❌</div>
                    <h3>Terjadi Kesalahan</h3>
                    <p>{error}</p>
                </div>
            )}

            {/* Data Content */}
            {data && !loading && !error && (
                <>
                    {/* Summary Cards */}
                    <div className="ubd-summary">
                        <div className="ubd-summary-card">
                            <div className="card-label">Total Karyawan</div>
                            <div className="card-value">{data.summary?.total_employees || 0}</div>
                        </div>
                        <div className="ubd-summary-card">
                            <div className="card-label">Total Gang</div>
                            <div className="card-value">{data.summary?.total_gangs || 0}</div>
                        </div>
                        <div className="ubd-summary-card highlight">
                            <div className="card-label">⏰ Total Lembur</div>
                            <div className="card-value">Rp {formatCurrency(data.summary?.grand_total_lembur)}</div>
                        </div>
                        <div className="ubd-summary-card highlight">
                            <div className="card-label">💰 Total Premi</div>
                            <div className="card-value">Rp {formatCurrency(data.summary?.grand_total_premi)}</div>
                        </div>
                        <div className="ubd-summary-card green">
                            <div className="card-label">💵 Total Upah Bersih</div>
                            <div className="card-value">Rp {formatCurrency(data.summary?.grand_total_upah_bersih)}</div>
                        </div>
                    </div>

                    {/* Period & Filter Info */}
                    <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            Periode: <strong>{getMonthLabel(data.period_month)} {data.period_year}</strong>
                        </span>
                        <span className="ubd-filter-badge active">
                            Filter: {getFilterLabel()}
                        </span>
                    </div>

                    {/* Gang Groups */}
                    {data.gangs && data.gangs.length > 0 ? (
                        data.gangs.map(gang => {
                            const isGangExpanded = expandedGangs.has(gang.gang_code)

                            return (
                                <div key={gang.gang_code} className="ubd-gang-group">
                                    {/* Gang Header */}
                                    <div className="ubd-gang-header" onClick={() => toggleGang(gang.gang_code)}>
                                        <div className="gang-info">
                                            <span className="gang-code">{gang.gang_code}</span>
                                            <span className="gang-desc">{gang.gang_description}</span>
                                        </div>
                                        <div className="gang-stats">
                                            <span>👥 <span className="stat-value">{gang.employee_count}</span> karyawan</span>
                                            {gang.total_lembur > 0 && (
                                                <span>⏰ <span className="stat-value">Rp {formatCurrency(gang.total_lembur)}</span></span>
                                            )}
                                            {gang.total_premi > 0 && (
                                                <span>💰 <span className="stat-value">Rp {formatCurrency(gang.total_premi)}</span></span>
                                            )}
                                            <span>💵 <span className="stat-value">Rp {formatCurrency(gang.total_upah_bersih)}</span></span>
                                            <span className={`toggle-icon ${isGangExpanded ? 'expanded' : ''}`}>▼</span>
                                        </div>
                                    </div>

                                    {/* Expanded Employee Table */}
                                    {isGangExpanded && (
                                        <>
                                            <div className="ubd-table-wrapper">
                                                <table className="ubd-table">
                                                    <thead>
                                                        <tr>
                                                            <th className="col-emp">Emp Code</th>
                                                            <th className="col-name">Nama</th>
                                                            <th className="col-task">Task Code</th>
                                                            <th className="col-hk">HK</th>
                                                            <th className="col-amount">Gaji Pokok</th>
                                                            <th className="col-amount">Lembur</th>
                                                            <th className="col-amount">Premi</th>
                                                            <th className="col-amount">Potongan</th>
                                                            <th className="col-amount">Upah Bersih</th>
                                                            <th className="col-actions">Detail</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {gang.employees.map(emp => {
                                                            const empKey = `${gang.gang_code}-${emp.emp_code}`
                                                            const isEmpExpanded = expandedEmployees.has(empKey)
                                                            const hasActivities = emp.activities && emp.activities.length > 0

                                                            return (
                                                                <React.Fragment key={empKey}>
                                                                    <tr
                                                                        className="emp-row"
                                                                        onClick={() => hasActivities && toggleEmployee(empKey)}
                                                                    >
                                                                        <td className="emp-code">{emp.emp_code}</td>
                                                                        <td className="emp-name" title={emp.emp_name}>{emp.emp_name}</td>
                                                                        <td title={emp.task_desc}>{emp.task_code || '-'}</td>
                                                                        <td className="text-center">{emp.jumlah_hk || emp.hari_kerja}</td>
                                                                        <td className="text-right">{formatCurrency(emp.gaji_pokok)}</td>
                                                                        <td className="text-right" style={emp.lembur_jumlah > 0 ? { color: '#d97706', fontWeight: 600 } : {}}>
                                                                            {emp.lembur_jumlah > 0 ? formatCurrency(emp.lembur_jumlah) : '-'}
                                                                            {emp.lembur_jam > 0 && (
                                                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{emp.lembur_jam} jam</div>
                                                                            )}
                                                                        </td>
                                                                        <td className="text-right" style={emp.total_premi > 0 ? { color: '#2563eb', fontWeight: 600 } : {}}>
                                                                            {emp.total_premi > 0 ? formatCurrency(emp.total_premi) : '-'}
                                                                        </td>
                                                                        <td className="text-right" style={{ color: '#dc2626' }}>
                                                                            {emp.total_potongan > 0 ? formatCurrency(emp.total_potongan) : '-'}
                                                                        </td>
                                                                        <td className="text-right" style={{ fontWeight: 700, color: '#15803d' }}>
                                                                            {formatCurrency(emp.upah_bersih)}
                                                                        </td>
                                                                        <td className="text-center">
                                                                            {hasActivities ? (
                                                                                <button
                                                                                    className={`ubd-expand-btn ${isEmpExpanded ? 'expanded' : ''}`}
                                                                                    onClick={(e) => { e.stopPropagation(); toggleEmployee(empKey) }}
                                                                                    title={`${emp.activities.length} aktivitas`}
                                                                                >
                                                                                    {isEmpExpanded ? '▲' : '▼'} {emp.activities.length}
                                                                                </button>
                                                                            ) : (
                                                                                <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>-</span>
                                                                            )}
                                                                        </td>
                                                                    </tr>

                                                                    {/* Activity Detail Rows */}
                                                                    {isEmpExpanded && emp.activities.map((act, idx) => (
                                                                        <tr key={`${empKey}-act-${idx}`} className="ubd-activity-row">
                                                                            <td className="act-date">{formatDate(act.date)}</td>
                                                                            <td colSpan="2">
                                                                                <span className={`act-category ${act.is_overtime ? 'lembur' : 'premi'}`}>
                                                                                    {act.category}
                                                                                </span>
                                                                                {' '}
                                                                                {act.doc_desc || act.task_desc || '-'}
                                                                            </td>
                                                                            <td className="text-center">{act.hours > 0 ? act.hours : '-'}</td>
                                                                            <td></td>
                                                                            <td className="text-right" style={act.is_overtime ? { color: '#d97706' } : {}}>
                                                                                {act.is_overtime && act.amount > 0 ? formatCurrency(act.amount) : '-'}
                                                                            </td>
                                                                            <td className="text-right" style={!act.is_overtime ? { color: '#2563eb' } : {}}>
                                                                                {!act.is_overtime && act.amount > 0 ? formatCurrency(act.amount) : '-'}
                                                                            </td>
                                                                            <td></td>
                                                                            <td></td>
                                                                            <td className="text-center" style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                                                                                {act.task_code || ''}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </React.Fragment>
                                                            )
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Gang Subtotal */}
                                            <div className="ubd-gang-subtotal">
                                                <div className="subtotal-item">
                                                    <span className="subtotal-label">Subtotal Lembur:</span>
                                                    <span className="subtotal-value">Rp {formatCurrency(gang.total_lembur)}</span>
                                                </div>
                                                <div className="subtotal-item">
                                                    <span className="subtotal-label">Subtotal Premi:</span>
                                                    <span className="subtotal-value">Rp {formatCurrency(gang.total_premi)}</span>
                                                </div>
                                                <div className="subtotal-item">
                                                    <span className="subtotal-label">Subtotal Upah Bersih:</span>
                                                    <span className="subtotal-value" style={{ color: '#15803d' }}>Rp {formatCurrency(gang.total_upah_bersih)}</span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )
                        })
                    ) : (
                        <div className="ubd-empty">
                            <div className="empty-icon">📭</div>
                            <h3>Tidak Ada Data</h3>
                            <p>
                                Tidak ditemukan data untuk periode {getMonthLabel(data.period_month)} {data.period_year}
                                {filter !== 'all' && ` dengan filter ${getFilterLabel()}`}.
                                Pastikan data sudah di-seed melalui Aggregation Seeder.
                            </p>
                        </div>
                    )}

                    {/* Execution Time */}
                    {data.execution_time_ms !== undefined && (
                        <div className="ubd-execution-time">
                            Query selesai dalam {data.execution_time_ms}ms
                        </div>
                    )}
                </>
            )}

            {/* Initial State */}
            {!data && !loading && !error && (
                <div className="ubd-empty">
                    <div className="empty-icon">📊</div>
                    <h3>Detail Upah Bersih</h3>
                    <p>Pilih periode dan filter, lalu klik "Tampilkan" untuk melihat detail data upah bersih per karyawan dengan rincian lembur dan premi.</p>
                </div>
            )}
        </div>
    )
}
