import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import './PeriodSlider.css'
import {
    buildPeriodSliderPeriods,
    getPeriodSliderIndex,
    getPeriodSliderScrollLeft,
} from '../../utils/periodSliderState'

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'
]

export default function PeriodSlider({
    currentMonth,
    currentYear,
    onPeriodChange,
    disableControls = false,
    minYear = 2024,
    maxYear = null,
    historyPeriods = [],
    useHistoryDb = false,
    currentProductionMonth = null,
    currentProductionYear = null
}) {
    const [isDragging, setIsDragging] = useState(false)
    const [startX, setStartX] = useState(0)
    const [scrollLeft, setScrollLeft] = useState(0)
    const sliderRef = useRef(null)
    const trackRef = useRef(null)

    const normalizedMonth = Number(currentMonth) || 1
    const normalizedYear = Number(currentYear) || new Date().getFullYear()

    const prodMonth = currentProductionMonth || new Date().getMonth() + 1
    const prodYear = currentProductionYear || new Date().getFullYear()
    const getMaxYear = () => maxYear || new Date().getFullYear() + 1

    const periods = useMemo(
        () => buildPeriodSliderPeriods(minYear, getMaxYear(), new Date()),
        [minYear, maxYear]
    )

    const getTotalWidth = () => periods.length * 80

    const getCurrentIndex = () => (
        getPeriodSliderIndex(periods, normalizedMonth, normalizedYear)
    )

    const isHistoryPeriod = useCallback((month, year) => {
        const periodValue = year * 100 + month
        const prodValue = prodYear * 100 + prodMonth
        const explicitHistory = historyPeriods.some((period) => (
            Number(period?.month) === month && Number(period?.year) === year
        ))
        return explicitHistory || periodValue < prodValue
    }, [historyPeriods, prodMonth, prodYear])

    const scrollToCurrent = useCallback(() => {
        if (!sliderRef.current) return

        const index = getCurrentIndex()
        if (index === -1) return

        const containerWidth = sliderRef.current?.clientWidth || 0
        const scrollPos = getPeriodSliderScrollLeft(index, containerWidth, 80)

        sliderRef.current.scrollTo({
            left: Math.max(0, scrollPos),
            behavior: 'smooth'
        })
    }, [normalizedMonth, normalizedYear, periods])

    useEffect(() => {
        scrollToCurrent()
    }, [scrollToCurrent])

    const handleDragStart = (e) => {
        if (disableControls) return
        setIsDragging(true)
        setStartX(e.pageX - (sliderRef.current?.offsetLeft || 0))
        setScrollLeft(sliderRef.current?.scrollLeft || 0)
    }

    const handleDragMove = (e) => {
        if (!isDragging || disableControls) return
        e.preventDefault()
        const x = e.pageX - (sliderRef.current?.offsetLeft || 0)
        const walk = (x - startX) * 2
        if (sliderRef.current) {
            sliderRef.current.scrollLeft = scrollLeft - walk
        }
    }

    const handleDragEnd = () => {
        setIsDragging(false)
    }

    const handlePeriodClick = (month, year) => {
        if (disableControls || !onPeriodChange) return
        onPeriodChange(month, year)
    }

    const handleKeyDown = (e) => {
        if (disableControls) return

        const currentIndex = getCurrentIndex()
        if (currentIndex === -1) return

        let newIndex = currentIndex

        switch (e.key) {
            case 'ArrowLeft':
                newIndex = Math.max(0, currentIndex - 1)
                break
            case 'ArrowRight':
                newIndex = Math.min(periods.length - 1, currentIndex + 1)
                break
            case 'Home':
                newIndex = 0
                break
            case 'End':
                newIndex = periods.length - 1
                break
            default:
                return
        }

        e.preventDefault()
        const newPeriod = periods[newIndex]
        if (newPeriod && onPeriodChange) {
            onPeriodChange(newPeriod.month, newPeriod.year)
        }
    }

    const goToToday = () => {
        const now = new Date()
        if (onPeriodChange) {
            onPeriodChange(now.getMonth() + 1, now.getFullYear())
        }
    }

    const goBack = () => {
        const currentIndex = getCurrentIndex()
        if (currentIndex > 0) {
            const prevPeriod = periods[currentIndex - 1]
            if (prevPeriod && onPeriodChange) {
                onPeriodChange(prevPeriod.month, prevPeriod.year)
            }
        }
    }

    const goForward = () => {
        const currentIndex = getCurrentIndex()
        if (currentIndex < periods.length - 1) {
            const nextPeriod = periods[currentIndex + 1]
            if (nextPeriod && onPeriodChange) {
                onPeriodChange(nextPeriod.month, nextPeriod.year)
            }
        }
    }

    const now = new Date()
    const isCurrentPeriod = (month, year) => (
        month === now.getMonth() + 1 && year === now.getFullYear()
    )

    const isSelectedPeriod = (month, year) => (
        month === normalizedMonth && year === normalizedYear
    )

    return (
        <div className="period-slider-container">
            <div className="period-slider-header">
                <span className="period-slider-label">
                    {MONTH_NAMES[normalizedMonth - 1]} {normalizedYear}
                </span>
                <div className="period-slider-quick-nav">
                    <button
                        className="period-slider-btn period-slider-btn-small"
                        onClick={goBack}
                        disabled={disableControls || getCurrentIndex() === 0}
                        title="Bulan Sebelumnya"
                    >
                        ‹
                    </button>
                    <button
                        className="period-slider-btn period-slider-btn-small"
                        onClick={goToToday}
                        disabled={disableControls}
                        title="Bulan Ini"
                    >
                        ●
                    </button>
                    <button
                        className="period-slider-btn period-slider-btn-small"
                        onClick={goForward}
                        disabled={disableControls || getCurrentIndex() === periods.length - 1}
                        title="Bulan Selanjutnya"
                    >
                        ›
                    </button>
                </div>
            </div>

            <div
                ref={sliderRef}
                className={`period-slider-track-wrapper ${isDragging ? 'dragging' : ''}`}
                onMouseDown={handleDragStart}
                onMouseMove={handleDragMove}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                role="slider"
                aria-label="Pilih Periode"
                aria-valuemin={0}
                aria-valuemax={periods.length - 1}
                aria-valuenow={getCurrentIndex()}
            >
                <div
                    ref={trackRef}
                    className="period-slider-track"
                    style={{ width: `${getTotalWidth()}px` }}
                >
                    {periods.map((period) => {
                        const isHistory = isHistoryPeriod(period.month, period.year)
                        const isSelected = isSelectedPeriod(period.month, period.year)
                        const isCurrent = isCurrentPeriod(period.month, period.year)

                        return (
                            <button
                                key={`${period.year}-${period.month}`}
                                className={`period-slider-item ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''} ${isHistory ? 'history-period' : ''}`}
                                onClick={() => handlePeriodClick(period.month, period.year)}
                                disabled={disableControls}
                                title={`${MONTH_NAMES[period.month - 1]} ${period.year}${isCurrent ? ' (Bulan Ini)' : ''}${isHistory ? ' - Data History' : ' - Live Data'}`}
                            >
                                <span className="period-slider-month">{MONTH_NAMES[period.month - 1]}</span>
                                <span className="period-slider-year">{period.year}</span>
                                <span className="period-slider-markers" aria-hidden="true">
                                    {isCurrent && <span className="period-slider-marker period-slider-marker-current" title="Bulan Ini">●</span>}
                                    {isHistory && <span className="period-slider-marker period-slider-marker-history" title="Data History">H</span>}
                                    {useHistoryDb && isHistory && <span className="period-slider-marker period-slider-marker-archive" title="History Mode">A</span>}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="period-slider-footer">
                <span className="period-slider-hint">
                    {isDragging ? 'Tahan dan geser...' : 'Klik atau geser untuk navigasi'}
                </span>
                <span className="period-slider-position">
                    {getCurrentIndex() + 1} / {periods.length}
                </span>
            </div>
        </div>
    )
}
