/**
 * CurrentPeriodBadge Component
 *
 * Displays the current payroll period with visual indicator
 * Shows whether the selected period is current, historical, or future
 */

import React from 'react';
import { usePeriodInfo } from '../../hooks/useCurrentPeriod';

export function CurrentPeriodBadge({ month, year, showLabel = true }) {
    const { currentMonth, currentYear, currentDisplay, isHistorical, isCurrentPeriod, isFuturePeriod, periodType } = usePeriodInfo(month, year);

    if (!currentMonth || !currentYear) {
        return null;
    }

    const getBadgeConfig = () => {
        if (isCurrentPeriod) {
            return {
                icon: '📊',
                label: 'Periode Saat Ini',
                className: 'period-current',
                bgColor: '#dbeafe',
                textColor: '#1e40af',
                borderColor: '#3b82f6'
            };
        }
        if (isHistorical) {
            return {
                icon: '📜',
                label: 'Data Historis',
                className: 'period-historical',
                bgColor: '#fef3c7',
                textColor: '#92400e',
                borderColor: '#f59e0b'
            };
        }
        if (isFuturePeriod) {
            return {
                icon: '🔮',
                label: 'Periode Mendatang',
                className: 'period-future',
                bgColor: '#e0e7ff',
                textColor: '#4338ca',
                borderColor: '#8b5cf6'
            };
        }
        return {
            icon: '📅',
            label: 'Periode',
            className: 'period-default',
            bgColor: '#f3f4f6',
            textColor: '#374151',
            borderColor: '#9ca3af'
        };
    };

    const config = getBadgeConfig();
    const selectedDisplay = `${getMonthName(month)} ${year}`;

    return (
        <div className="current-period-badge-container">
            {showLabel && (
                <div className="current-period-info">
                    <span className="current-period-label">Periode Saat Ini:</span>
                    <span className="current-period-value">{currentDisplay}</span>
                </div>
            )}

            <div
                className={`period-indicator period-badge ${config.className}`}
                style={{
                    backgroundColor: config.bgColor,
                    color: config.textColor,
                    border: `1px solid ${config.borderColor}`
                }}
            >
                <span className="period-icon">{config.icon}</span>
                <span className="period-text">{selectedDisplay}</span>
                {showLabel && (
                    <span className="period-type-label">{config.label}</span>
                )}
            </div>
        </div>
    );
}

function getMonthName(month) {
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return months[month - 1] || '';
}

/**
 * Compact version of the period badge for use in tight spaces
 */
export function CompactPeriodBadge({ month, year }) {
    const { isCurrentPeriod, isHistorical, periodType } = usePeriodInfo(month, year);

    const getConfig = () => {
        if (isCurrentPeriod) return { icon: '📊', color: '#3b82f6' };
        if (isHistorical) return { icon: '📜', color: '#f59e0b' };
        return { icon: '🔮', color: '#8b5cf6' };
    };

    const config = getConfig();

    return (
        <div
            className="compact-period-badge"
            style={{ borderColor: config.color }}
            title={periodType === 'current' ? 'Periode Saat Ini' : periodType === 'historical' ? 'Data Historis' : 'Periode Mendatang'}
        >
            <span>{config.icon}</span>
            <span>{month}/{year}</span>
        </div>
    );
}

/**
 * Period selector with badge indicator
 */
export function PeriodSelectorWithBadge({ month, year, onMonthChange, onYearChange, showCurrentInfo = true }) {
    const { currentMonth, currentYear, isHistorical, isCurrentPeriod } = usePeriodInfo(month, year);

    return (
        <div className="period-selector-with-badge">
            {showCurrentInfo && currentMonth && currentYear && (
                <div className="current-period-hint">
                    <small style={{ color: '#6b7280' }}>
                        Periode Saat Ini: {getMonthName(currentMonth)} {currentYear}
                    </small>
                </div>
            )}

            <div className="period-selector-row">
                <div className="period-input-group">
                    <label>Bulan:</label>
                    <select
                        value={month}
                        onChange={(e) => onMonthChange?.(parseInt(e.target.value))}
                        className="period-select"
                    >
                        {Array.from({ length: 12 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>
                                {getMonthName(i + 1)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="period-input-group">
                    <label>Tahun:</label>
                    <select
                        value={year}
                        onChange={(e) => onYearChange?.(parseInt(e.target.value))}
                        className="period-select"
                    >
                        {Array.from({ length: 5 }, (_, i) => {
                            const y = new Date().getFullYear() - 2 + i;
                            return (
                                <option key={y} value={y}>
                                    {y}
                                </option>
                            );
                        })}
                    </select>
                </div>

                <CompactPeriodBadge month={month} year={year} />
            </div>

            {isHistorical && (
                <div className="period-notice historical-notice-compact">
                    <span>📜</span>
                    <small>Mode Data Historis - Data diambil dari database history</small>
                </div>
            )}
        </div>
    );
}

export default CurrentPeriodBadge;
