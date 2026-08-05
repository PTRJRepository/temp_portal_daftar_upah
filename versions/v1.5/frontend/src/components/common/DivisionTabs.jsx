import React from 'react'
import '../../styles/dashboard-modern.css'

/**
 * Segmented Control Tabs for Division Selection
 * 
 * Props:
 * - divisions: Array of division codes (e.g., ['P1A', 'P1B', 'P2A', 'P2B'])
 * - selected: Currently selected division code
 * - onChange: Callback when division changes
 * - disabled: boolean
 * - isLoading: boolean
 */
export default function DivisionTabs({
    divisions = [],
    selected,
    onChange,
    disabled = false,
    isLoading = false
}) {
    if (divisions.length === 0) {
        return (
            <div className="division-tabs" style={{ justifyContent: 'center', padding: '1rem' }}>
                <span style={{ color: 'var(--neutral-400)', fontStyle: 'italic' }}>
                    {isLoading ? 'Memuat divisi...' : 'Tidak ada divisi tersedia'}
                </span>
            </div>
        )
    }

    return (
        <div
            className="division-tabs"
            role="tablist"
            aria-label="Pilih Divisi"
            style={disabled ? { opacity: 0.6 } : {}}
        >
            {divisions.map((division) => (
                <button
                    key={division}
                    className={`division-tab ${selected === division ? 'active' : ''}`}
                    onClick={() => !disabled && onChange(division)}
                    disabled={disabled}
                    role="tab"
                    aria-selected={selected === division}
                    aria-controls={`panel-${division}`}
                    type="button"
                >
                    {division}
                </button>
            ))}
        </div>
    )
}
