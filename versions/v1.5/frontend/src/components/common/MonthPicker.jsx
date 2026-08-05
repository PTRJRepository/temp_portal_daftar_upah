import React, { useState, useRef, useEffect } from 'react'
import '../../styles/dashboard-modern.css'

const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
]

const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

/**
 * Interactive Month Picker Widget
 * 
 * Props:
 * - value: string in format 'YYYY-MM' (e.g., '2025-11')
 * - onChange: callback with new value in 'YYYY-MM' format
 * - disabled: boolean
 */
export default function MonthPicker({ value, onChange, disabled = false }) {
    const [isOpen, setIsOpen] = useState(false)
    const [viewYear, setViewYear] = useState(new Date().getFullYear())
    const containerRef = useRef(null)

    // Parse value
    const [selectedYear, selectedMonth] = value
        ? value.split('-').map(Number)
        : [new Date().getFullYear(), new Date().getMonth() + 1]

    // Current date for highlighting
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1

    // Initialize view year from selected year
    useEffect(() => {
        if (selectedYear) {
            setViewYear(selectedYear)
        }
    }, [selectedYear])

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handlePrevMonth = (e) => {
        e.stopPropagation()
        if (disabled) return

        let newMonth = selectedMonth - 1
        let newYear = selectedYear
        if (newMonth < 1) {
            newMonth = 12
            newYear -= 1
        }
        onChange(`${newYear}-${String(newMonth).padStart(2, '0')}`)
    }

    const handleNextMonth = (e) => {
        e.stopPropagation()
        if (disabled) return

        let newMonth = selectedMonth + 1
        let newYear = selectedYear
        if (newMonth > 12) {
            newMonth = 1
            newYear += 1
        }
        onChange(`${newYear}-${String(newMonth).padStart(2, '0')}`)
    }

    const handleMonthSelect = (monthIndex) => {
        if (disabled) return
        onChange(`${viewYear}-${String(monthIndex + 1).padStart(2, '0')}`)
        setIsOpen(false)
    }

    const handleYearPrev = (e) => {
        e.stopPropagation()
        setViewYear(prev => prev - 1)
    }

    const handleYearNext = (e) => {
        e.stopPropagation()
        setViewYear(prev => prev + 1)
    }

    const displayText = `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`

    return (
        <div className="month-picker" ref={containerRef}>
            <div
                className={`month-picker-display ${isOpen ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            >
                {/* Previous Arrow */}
                <button
                    className="month-picker-arrow"
                    onClick={handlePrevMonth}
                    disabled={disabled}
                    type="button"
                    aria-label="Previous month"
                >
                    ‹
                </button>

                {/* Current Month Display */}
                <span
                    className="month-picker-current"
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                >
                    {displayText}
                </span>

                {/* Next Arrow */}
                <button
                    className="month-picker-arrow"
                    onClick={handleNextMonth}
                    disabled={disabled}
                    type="button"
                    aria-label="Next month"
                >
                    ›
                </button>
            </div>

            {/* Dropdown Grid */}
            {isOpen && !disabled && (
                <div className="month-picker-dropdown">
                    {/* Year Navigation */}
                    <div className="month-picker-year-nav">
                        <button
                            className="month-picker-arrow"
                            onClick={handleYearPrev}
                            type="button"
                            aria-label="Previous year"
                        >
                            ‹
                        </button>
                        <span className="month-picker-year">{viewYear}</span>
                        <button
                            className="month-picker-arrow"
                            onClick={handleYearNext}
                            type="button"
                            aria-label="Next year"
                        >
                            ›
                        </button>
                    </div>

                    {/* Month Grid */}
                    <div className="month-grid">
                        {MONTHS.map((month, index) => {
                            const isSelected = viewYear === selectedYear && index + 1 === selectedMonth
                            const isCurrent = viewYear === currentYear && index + 1 === currentMonth

                            return (
                                <button
                                    key={month}
                                    className={`month-grid-item ${isSelected ? 'selected' : ''} ${isCurrent && !isSelected ? 'current' : ''}`}
                                    onClick={() => handleMonthSelect(index)}
                                    type="button"
                                >
                                    {month}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
