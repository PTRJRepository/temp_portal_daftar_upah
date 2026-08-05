/**
 * GangEmployeeInfo - Displays employee information for selected gang/division
 * Shows employee cards with key info: NIK, emp_code, name, attendance stats
 * Uses the same data source as GangAttendanceMatrix for efficiency
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getGangAttendanceMatrix } from '../services/employeeDetailService'
import { compareEmpCodeValues } from '../utils/employeeSort'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const RELIGION_COLORS = {
    'ISLAM': { bg: '#dbeafe', text: '#1e40af', icon: '🕌' },
    'KRISTEN': { bg: '#fce7f3', text: '#9d174d', icon: '✝️' },
    'KATHOLIK': { bg: '#fef3c7', text: '#92400e', icon: '⛪' },
    'HINDU': { bg: '#fee2e2', text: '#991b1b', icon: '🪔' },
    'BUDHA': { bg: '#fff7ed', text: '#9a3412', icon: '☸️' },
    'KONGHUCU': { bg: '#f0fdf4', text: '#166534', icon: '📿' },
}

const DIVISION_COLORS = {
    'PG1A': { bg: '#eff6ff', text: '#1d4ed8' },
    'PG1B': { bg: '#f5f3ff', text: '#7c3aed' },
    'PG2A': { bg: '#fdf2f8', text: '#db2777' },
    'PG2B': { bg: '#fff7ed', text: '#ea580c' },
    'AB1': { bg: '#f5f3ff', text: '#7c3aed' },
    'AB2': { bg: '#faf5ff', text: '#c026d3' },
    'ARA': { bg: '#ecfeff', text: '#0891b2' },
    'ARC': { bg: '#f0fdfa', text: '#0d9488' },
    'IJL': { bg: '#fefce8', text: '#ca8a04' },
    'DME': { bg: '#f0fdf4', text: '#16a34a' },
    'MILL': { bg: '#fef2f2', text: '#dc2626' },
}

function getInitials(name) {
    if (!name) return '?'
    const parts = String(name).trim().split(/\s+/)
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatNumber(n) {
    if (n == null || n === 0) return '-'
    return Number(n).toLocaleString('id-ID')
}

export default function GangEmployeeInfo({ token, gangCodes, month, year, division, onViewEmployeeDetail = null, sortBy: parentSortBy, sortOrder: parentSortOrder, onSortChange }) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [search, setSearch] = useState('')
    
    // Use parent sorting if provided, otherwise fallback to local state
    const [localSortBy, setLocalSortBy] = useState('emp_code')
    const [localSortOrder, setLocalSortOrder] = useState('asc')
    
    const sortBy = parentSortBy || localSortBy
    const sortOrder = parentSortOrder || localSortOrder

    const fetchData = useCallback(async () => {
        if (!gangCodes || gangCodes.length === 0 || !month || !year) return

        setLoading(true)
        setError(null)
        try {
            const result = await getGangAttendanceMatrix(token, gangCodes, month, year)
            setData(result)
        } catch (err) {
            setError(err.message || 'Gagal memuat data karyawan')
        } finally {
            setLoading(false)
        }
    }, [token, gangCodes, month, year])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Flatten all employees from all gangs
    const allEmployees = useMemo(() => {
        if (!data?.data) return []
        const employees = []
        for (const gang of data.data) {
            for (const emp of (gang.employees || [])) {
                employees.push({
                    ...emp,
                    _gang_code: gang.gang_code,
                    _gang_desc: gang.gang_description,
                })
            }
        }
        return employees
    }, [data])

    // Filter by search
    const filteredEmployees = useMemo(() => {
        if (!search.trim()) return allEmployees
        const q = search.toLowerCase()
        return allEmployees.filter(emp =>
            (emp.emp_name || '').toLowerCase().includes(q) ||
            (emp.new_nik || emp.nik || '').toLowerCase().includes(q) ||
            (emp.emp_code || '').toLowerCase().includes(q) ||
            (emp._gang_code || '').toLowerCase().includes(q)
        )
    }, [allEmployees, search])

    // Sort
    const sortedEmployees = useMemo(() => {
        const sorted = [...filteredEmployees]
        sorted.sort((a, b) => {
            const direction = sortOrder === 'asc' ? 1 : -1

            if (sortBy === 'emp_code') {
                return direction * compareEmpCodeValues(a.emp_code, b.emp_code)
            }

            let va, vb
            if (sortBy === 'name') {
                va = (a.emp_name || '').toLowerCase()
                vb = (b.emp_name || '').toLowerCase()
            } else if (sortBy === 'hk') {
                va = (a.summary?.total_hk || 0)
                vb = (b.summary?.total_hk || 0)
            }
            if (va < vb) return -direction
            if (va > vb) return direction
            return 0
        })
        return sorted
    }, [filteredEmployees, sortBy, sortOrder])

    // Stats
    const stats = useMemo(() => {
        const total = allEmployees.length
        const aktif = allEmployees.filter(e => (e.summary?.total_hk || 0) > 0).length
        const alpa = allEmployees.filter(e => (e.summary?.alpa || 0) > 0).length
        const avgHk = total > 0
            ? (allEmployees.reduce((s, e) => s + (e.summary?.total_hk || 0), 0) / total).toFixed(1)
            : 0
        return { total, aktif, alpa, avgHk }
    }, [allEmployees])

    const handleSort = (field) => {
        if (onSortChange) {
            // Use parent callback
            onSortChange(field)
        } else {
            // Use local state
            if (localSortBy === field) {
                setLocalSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
            } else {
                setLocalSortBy(field)
                setLocalSortOrder('asc')
            }
        }
    }

    const handleEmployeeClick = (emp) => {
        if (onViewEmployeeDetail) {
            onViewEmployeeDetail(emp)
        }
    }

    const gangColor = (gangCode) => DIVISION_COLORS[gangCode] || { bg: '#f8fafc', text: '#475569' }
    const divColor = DIVISION_COLORS[division] || { bg: '#f8fafc', text: '#475569' }

    if (!gangCodes || gangCodes.length === 0) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👥</div>
                <h3 style={{ color: '#334155', marginBottom: '0.5rem' }}>Informasi Karyawan</h3>
                <p>Pilih gang untuk melihat informasi karyawan</p>
            </div>
        )
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: 'white' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>👥 Informasi Karyawan</h2>
                        <span style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600' }}>
                            {MONTHS[month - 1]} {year}
                        </span>
                        {division && (
                            <span style={{ background: divColor.bg, color: divColor.text, padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600' }}>
                                {division}
                            </span>
                        )}
                    </div>
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{
                            width: '40px', height: '40px', border: '3px solid #e2e8f0',
                            borderTop: '3px solid #1e3a8a', borderRadius: '50%',
                            animation: 'spin 1s linear infinite', margin: '0 auto 1rem'
                        }} />
                        <p style={{ color: '#64748b' }}>Memuat data karyawan...</p>
                    </div>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        )
    }

    if (error) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: 'white' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>👥 Informasi Karyawan</h2>
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                        <p style={{ color: '#dc2626', marginBottom: '1rem' }}>{error}</p>
                        <button onClick={fetchData} style={{
                            padding: '0.5rem 1rem', background: '#1e3a8a', color: 'white',
                            border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600'
                        }}>🔄 Coba Lagi</button>
                    </div>
                </div>
            </div>
        )
    }

    const gangs = data?.data || []

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f8fafc' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: 'white', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>👥 Informasi Karyawan</h2>
                    <span style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600' }}>
                        {MONTHS[month - 1]} {year}
                    </span>
                    {division && (
                        <span style={{ background: divColor.bg, color: divColor.text, padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600' }}>
                            {division}
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {data?.meta?.execution_time_ms && (
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                            {stats.total} karyawan • {data.meta.execution_time_ms}ms
                        </span>
                    )}
                </div>
            </div>

            {/* Stats Bar */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem',
                padding: '1rem 1.5rem', background: 'white',
                borderBottom: '1px solid #e2e8f0', flexShrink: 0
            }}>
                <div style={{ background: '#eff6ff', borderRadius: '10px', padding: '0.75rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e40af' }}>{stats.total}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Total Karyawan</div>
                </div>
                <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '0.75rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#16a34a' }}>{stats.aktif}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Aktif (HK &gt; 0)</div>
                </div>
                <div style={{ background: '#fef2f2', borderRadius: '10px', padding: '0.75rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#dc2626' }}>{stats.alpa}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Ada Alpa</div>
                </div>
                <div style={{ background: '#fdf4ff', borderRadius: '10px', padding: '0.75rem 1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#9333ea' }}>{stats.avgHk}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Rata-rata HK</div>
                </div>
            </div>

            {/* Search & Controls */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1.5rem',
                background: 'white', borderBottom: '1px solid #e2e8f0', flexShrink: 0
            }}>
                {/* Search */}
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '1rem' }}>🔍</span>
                    <input
                        type="text"
                        placeholder="Cari nama, NIK, atau emp code..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{
                            width: '100%', padding: '0.5rem 0.75rem 0.5rem 2.25rem',
                            border: '1px solid #e2e8f0', borderRadius: '8px',
                            fontSize: '0.85rem', outline: 'none',
                            transition: 'border-color 0.2s'
                        }}
                        onFocus={e => e.target.style.borderColor = '#1e3a8a'}
                        onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                    />
                </div>

                {/* Result count */}
                {search && (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {sortedEmployees.length} dari {allEmployees.length}
                    </span>
                )}
            </div>

            {/* Employee Cards Grid */}
            <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.5rem' }}>
                {sortedEmployees.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                        <p>Tidak ada karyawan yang cocok dengan pencarian</p>
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem'
                    }}>
                        {sortedEmployees.map((emp, idx) => {
                            const gc = gangColor(emp._gang_code)
                            const hk = emp.summary?.total_hk || 0
                            const hadir = emp.summary?.hadir || 0
                            const cuti = (emp.summary?.cuti_tahunan || 0) + (emp.summary?.cuti_sakit || 0)
                            const alpa = emp.summary?.alpa || 0
                            const displayNik = emp.new_nik || emp.nik || '-'

                            return (
                                <div
                                    key={emp.emp_code || idx}
                                    onClick={() => handleEmployeeClick(emp)}
                                    style={{
                                        background: 'white',
                                        borderRadius: '12px',
                                        border: '1px solid #e2e8f0',
                                        padding: '1rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(30,58,138,0.12)'
                                        e.currentTarget.style.transform = 'translateY(-2px)'
                                        e.currentTarget.style.borderColor = '#1e3a8a'
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'
                                        e.currentTarget.style.transform = 'translateY(0)'
                                        e.currentTarget.style.borderColor = '#e2e8f0'
                                    }}
                                >
                                    {/* Top row: Avatar + Name */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                        {/* Avatar */}
                                        <div style={{
                                            width: '42px', height: '42px', borderRadius: '10px',
                                            background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: 'white', fontWeight: '700', fontSize: '0.9rem',
                                            flexShrink: 0
                                        }}>
                                            {getInitials(emp.emp_name)}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {emp.emp_name || '-'}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: '#64748b', display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '2px' }}>
                                                <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: '600' }}>
                                                    {emp.emp_code || '-'}
                                                </span>
                                                <span style={{
                                                    background: gc.bg, color: gc.text, padding: '1px 6px',
                                                    borderRadius: '4px', fontWeight: '600', fontSize: '0.65rem'
                                                }}>
                                                    {emp._gang_code}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* NIK */}
                                    <div style={{
                                        background: '#f8fafc', borderRadius: '8px', padding: '0.4rem 0.6rem',
                                        marginBottom: '0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}>
                                        <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: '600' }}>NIK / KTP</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#1e40af', fontWeight: '700' }}>
                                            {displayNik.length > 14 ? displayNik.substring(0, 6) + '...' + displayNik.substring(displayNik.length - 4) : displayNik}
                                        </span>
                                    </div>

                                    {/* Attendance Stats Row */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.35rem', marginBottom: '0.5rem' }}>
                                        <div style={{ textAlign: 'center', padding: '0.35rem 0.25rem', background: hk > 0 ? '#f0fdf4' : '#fef2f2', borderRadius: '6px' }}>
                                            <div style={{ fontWeight: '700', fontSize: '0.8rem', color: hk > 0 ? '#16a34a' : '#dc2626' }}>{hk}</div>
                                            <div style={{ fontSize: '0.6rem', color: '#64748b' }}>HK</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '0.35rem 0.25rem', background: '#f0fdf4', borderRadius: '6px' }}>
                                            <div style={{ fontWeight: '700', fontSize: '0.8rem', color: '#16a34a' }}>{hadir}</div>
                                            <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Hadir</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '0.35rem 0.25rem', background: cuti > 0 ? '#fef3c7' : '#f8fafc', borderRadius: '6px' }}>
                                            <div style={{ fontWeight: '700', fontSize: '0.8rem', color: cuti > 0 ? '#92400e' : '#94a3b8' }}>{cuti}</div>
                                            <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Cuti</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '0.35rem 0.25rem', background: alpa > 0 ? '#fef2f2' : '#f8fafc', borderRadius: '6px' }}>
                                            <div style={{ fontWeight: '700', fontSize: '0.8rem', color: alpa > 0 ? '#dc2626' : '#94a3b8' }}>{alpa}</div>
                                            <div style={{ fontSize: '0.6rem', color: '#64748b' }}>Alpa</div>
                                        </div>
                                    </div>

                                    {/* Bank & Bottom info */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                                        <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                                            {emp.bank_acc_no ? `💳 ${emp.bank_acc_no.substring(0, 4)}...` : '💳 -'}
                                        </span>
                                        <span style={{ fontSize: '0.65rem', color: '#1e40af', fontWeight: '600' }}>
                                            →
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </div>
    )
}
