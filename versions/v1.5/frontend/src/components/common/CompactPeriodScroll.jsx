import React, { useState, useRef, useEffect, useMemo } from 'react'

const MONTH_NAMES = [
    { short: 'Jan', full: 'Januari' },
    { short: 'Feb', full: 'Februari' },
    { short: 'Mar', full: 'Maret' },
    { short: 'Apr', full: 'April' },
    { short: 'Mei', full: 'Mei' },
    { short: 'Jun', full: 'Juni' },
    { short: 'Jul', full: 'Juli' },
    { short: 'Agu', full: 'Agustus' },
    { short: 'Sep', full: 'September' },
    { short: 'Okt', full: 'Oktober' },
    { short: 'Nov', full: 'November' },
    { short: 'Des', full: 'Desember' }
]

/**
 * Professional Dropdown Period Selector
 *
 * Replaces scrollable card buttons with clean month/year dropdowns.
 * Shows current period display with quick navigation arrows.
 */
export default function CompactPeriodScroll({
    month,
    year,
    onChange,
    minYear = 2024,
    disableControls = false
}) {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef(null)

    const currentMonthIndex = (month != null ? month : new Date().getMonth() + 1) - 1

    // Generate available years
    const availableYears = useMemo(() => {
        const now = new Date()
        const currentYear = now.getFullYear()
        const years = []
        for (let y = minYear; y <= currentYear + 1; y++) {
            years.push(y)
        }
        return years
    }, [minYear])

    // Check if period is "current" (today's date)
    const isCurrentPeriod = useMemo(() => {
        const now = new Date()
        return month === now.getMonth() + 1 && year === now.getFullYear()
    }, [month, year])

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handlePrevMonth = () => {
        if (disableControls) return
        if (month === 1) onChange(12, year - 1)
        else onChange(month - 1, year)
    }

    const handleNextMonth = () => {
        if (disableControls) return
        if (month === 12) onChange(1, year + 1)
        else onChange(month + 1, year)
    }

    const handleMonthSelect = (m) => {
        if (disableControls) return
        onChange(m, year)
        setIsOpen(false)
    }

    const handleYearChange = (e) => {
        if (disableControls) return
        const newYear = parseInt(e.target.value)
        onChange(month, newYear)
    }

    const handlePrevYear = () => {
        if (disableControls) return
        const idx = availableYears.indexOf(year)
        if (idx > 0) onChange(month, availableYears[idx - 1])
    }

    const handleNextYear = () => {
        if (disableControls) return
        const idx = availableYears.indexOf(year)
        if (idx < availableYears.length - 1) onChange(month, availableYears[idx + 1])
    }

    const displayPeriod = `${MONTH_NAMES[currentMonthIndex].full} ${year}`

    return (
        <div ref={dropdownRef} style={{ position: 'relative', minWidth: '240px' }}>
            {/* Period Display with Arrows */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0',
                backgroundColor: 'white',
                border: `1px solid ${isOpen ? '#3b82f6' : '#e2e8f0'}`,
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: isOpen ? '0 0 0 3px rgba(59, 130, 246, 0.1)' : '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'all 0.2s ease',
                opacity: disableControls ? 0.6 : 1
            }}>
                {/* Prev Month Arrow */}
                <button
                    onClick={handlePrevMonth}
                    disabled={disableControls}
                    style={{
                        width: '36px',
                        height: '36px',
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: disableControls ? 'not-allowed' : 'pointer',
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s',
                        flexShrink: 0
                    }}
                    onMouseOver={(e) => { if (!disableControls) { e.currentTarget.style.backgroundColor = '#f1f5f9'; e.currentTarget.style.color = '#1e3a8a' } }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#64748b' }}
                    title="Bulan sebelumnya"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>

                {/* Dropdown Trigger */}
                <button
                    onClick={() => !disableControls && setIsOpen(!isOpen)}
                    disabled={disableControls}
                    style={{
                        flex: 1,
                        height: '36px',
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderLeft: '1px solid #f1f5f9',
                        borderRight: '1px solid #f1f5f9',
                        cursor: disableControls ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '0 12px',
                        transition: 'all 0.15s',
                        fontFamily: "'Inter', 'Segoe UI', sans-serif"
                    }}
                    title="Pilih periode"
                >
                    {/* Current period indicator dot */}
                    <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: isCurrentPeriod ? '#10b981' : '#94a3b8',
                        flexShrink: 0
                    }} />

                    {/* Period text */}
                    <span style={{
                        fontSize: '12px',
                        fontWeight: '700',
                        color: '#1e3a8a',
                        letterSpacing: '0.025em',
                        whiteSpace: 'nowrap'
                    }}>
                        {displayPeriod}
                    </span>

                    {/* Dropdown chevron */}
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#64748b"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                            flexShrink: 0,
                            transition: 'transform 0.2s',
                            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
                        }}
                    >
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </button>

                {/* Next Month Arrow */}
                <button
                    onClick={handleNextMonth}
                    disabled={disableControls}
                    style={{
                        width: '36px',
                        height: '36px',
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: disableControls ? 'not-allowed' : 'pointer',
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s',
                        flexShrink: 0
                    }}
                    onMouseOver={(e) => { if (!disableControls) { e.currentTarget.style.backgroundColor = '#f1f5f9'; e.currentTarget.style.color = '#1e3a8a' } }}
                    onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#64748b' }}
                    title="Bulan berikutnya"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>
            </div>

            {/* Dropdown Panel */}
            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.12), 0 4px 10px rgba(0,0,0,0.08)',
                    zIndex: 1000,
                    overflow: 'hidden',
                    animation: 'dropdownFadeIn 0.15s ease'
                }}>
                    {/* Year Navigation */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderBottom: '1px solid #f1f5f9',
                        backgroundColor: '#f8fafc'
                    }}>
                        <button
                            onClick={handlePrevYear}
                            disabled={availableYears.indexOf(year) === 0 || disableControls}
                            style={{
                                width: '28px',
                                height: '28px',
                                backgroundColor: 'white',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                cursor: (availableYears.indexOf(year) === 0 || disableControls) ? 'not-allowed' : 'pointer',
                                color: (availableYears.indexOf(year) === 0 || disableControls) ? '#cbd5e1' : '#64748b',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s'
                            }}
                            onMouseOver={(e) => { if (availableYears.indexOf(year) > 0 && !disableControls) { e.currentTarget.style.borderColor = '#1e3a8a'; e.currentTarget.style.color = '#1e3a8a' } }}
                            onMouseOut={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b' }}
                            title="Tahun sebelumnya"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                        </button>

                        <select
                            value={year}
                            onChange={handleYearChange}
                            disabled={disableControls}
                            style={{
                                height: '32px',
                                padding: '0 8px',
                                backgroundColor: 'white',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                fontSize: '13px',
                                fontWeight: '700',
                                color: '#1e3a8a',
                                cursor: disableControls ? 'not-allowed' : 'pointer',
                                outline: 'none',
                                textAlign: 'center',
                                appearance: 'none',
                                WebkitAppearance: 'none',
                                MozAppearance: 'none'
                            }}
                        >
                            {availableYears.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>

                        <button
                            onClick={handleNextYear}
                            disabled={availableYears.indexOf(year) === availableYears.length - 1 || disableControls}
                            style={{
                                width: '28px',
                                height: '28px',
                                backgroundColor: 'white',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                cursor: (availableYears.indexOf(year) === availableYears.length - 1 || disableControls) ? 'not-allowed' : 'pointer',
                                color: (availableYears.indexOf(year) === availableYears.length - 1 || disableControls) ? '#cbd5e1' : '#64748b',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s'
                            }}
                            onMouseOver={(e) => { if (availableYears.indexOf(year) < availableYears.length - 1 && !disableControls) { e.currentTarget.style.borderColor = '#1e3a8a'; e.currentTarget.style.color = '#1e3a8a' } }}
                            onMouseOut={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#64748b' }}
                            title="Tahun berikutnya"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </button>
                    </div>

                    {/* Month Grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '4px',
                        padding: '10px'
                    }}>
                        {MONTH_NAMES.map((m, idx) => {
                            const monthNum = idx + 1
                            const isSelected = monthNum === month
                            const isCurrent = monthNum === new Date().getMonth() + 1 && year === new Date().getFullYear()

                            return (
                                <button
                                    key={monthNum}
                                    onClick={() => handleMonthSelect(monthNum)}
                                    disabled={disableControls}
                                    style={{
                                        padding: '8px 4px',
                                        backgroundColor: isSelected ? '#1e3a8a' : 'transparent',
                                        color: isSelected ? 'white' : '#475569',
                                        border: isSelected ? '1px solid #1e3a8a' : '1px solid transparent',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: isSelected ? '700' : '600',
                                        cursor: disableControls ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.1s',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '2px',
                                        position: 'relative',
                                        boxShadow: isSelected ? '0 2px 6px rgba(30, 58, 138, 0.25)' : 'none'
                                    }}
                                    onMouseOver={(e) => { if (!disableControls && !isSelected) { e.currentTarget.style.backgroundColor = '#eff6ff'; e.currentTarget.style.color = '#1e3a8a' } }}
                                    onMouseOut={(e) => { if (!isSelected) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#475569' } }}
                                >
                                    <span style={{ fontSize: '10px', opacity: 0.7, fontWeight: 500 }}>{m.short}</span>
                                    <span>{m.full}</span>
                                    {isCurrent && !isSelected && (
                                        <div style={{
                                            position: 'absolute',
                                            bottom: '3px',
                                            width: '4px',
                                            height: '4px',
                                            borderRadius: '50%',
                                            backgroundColor: '#10b981'
                                        }} />
                                    )}
                                </button>
                            )
                        })}
                    </div>

                    {/* Quick Actions */}
                    <div style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '8px 10px 10px',
                        borderTop: '1px solid #f1f5f9'
                    }}>
                        <button
                            onClick={() => {
                                const now = new Date()
                                onChange(now.getMonth() + 1, now.getFullYear())
                                setIsOpen(false)
                            }}
                            disabled={disableControls}
                            style={{
                                flex: 1,
                                padding: '6px 8px',
                                backgroundColor: isCurrentPeriod ? '#f0fdf4' : '#f8fafc',
                                border: `1px solid ${isCurrentPeriod ? '#86efac' : '#e2e8f0'}`,
                                borderRadius: '6px',
                                fontSize: '10px',
                                fontWeight: '600',
                                color: isCurrentPeriod ? '#16a34a' : '#64748b',
                                cursor: disableControls ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px'
                            }}
                            onMouseOver={(e) => { if (!disableControls) { e.currentTarget.style.backgroundColor = '#f0fdf4'; e.currentTarget.style.borderColor = '#86efac'; e.currentTarget.style.color = '#16a34a' } }}
                            onMouseOut={(e) => { e.currentTarget.style.backgroundColor = isCurrentPeriod ? '#f0fdf4' : '#f8fafc'; e.currentTarget.style.borderColor = isCurrentPeriod ? '#86efac' : '#e2e8f0'; e.currentTarget.style.color = isCurrentPeriod ? '#16a34a' : '#64748b' }}
                        >
                            {isCurrentPeriod ? (
                                <>
                                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                                    Sekarang
                                </>
                            ) : 'Periode Sekarang'}
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes dropdownFadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    )
}
