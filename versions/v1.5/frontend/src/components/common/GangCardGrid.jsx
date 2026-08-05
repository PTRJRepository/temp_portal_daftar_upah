import React, { useState, useMemo } from 'react'
import '../../styles/dashboard-modern.css'

/**
 * Searchable Card Grid for Gang/Kemandoran Selection
 * 
 * Props:
 * - gangs: Array of gang objects with gang_code and description
 * - selected: Currently selected gang code
 * - onChange: Callback when gang changes
 * - disabled: boolean
 * - isLoading: boolean
 * - showAllOption: boolean - whether to show "ALL GANGS" option
 */
export default function GangCardGrid({
    gangs = [],
    selected,
    onChange,
    disabled = false,
    isLoading = false,
    showAllOption = true
}) {
    const [searchTerm, setSearchTerm] = useState('')

    // Filter gangs based on search
    const filteredGangs = useMemo(() => {
        if (!searchTerm) return gangs

        const term = searchTerm.toUpperCase()
        return gangs.filter(gang => {
            const code = typeof gang === 'string' ? gang : gang.gang_code || ''
            const desc = typeof gang === 'string' ? '' : gang.description || ''
            return code.toUpperCase().includes(term) || desc.toUpperCase().includes(term)
        })
    }, [gangs, searchTerm])

    const getGangCode = (gang) => typeof gang === 'string' ? gang : gang.gang_code || ''
    const getGangDesc = (gang) => typeof gang === 'string' ? '' : gang.description || ''

    if (isLoading) {
        return (
            <div className="gang-card-grid-container">
                <div className="empty-state">
                    <div className="empty-state-icon">⏳</div>
                    <div className="empty-state-text">Memuat data gang...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="gang-card-grid-container">
            {/* Search Bar */}
            <div className="gang-search-container">
                <span className="gang-search-icon">🔍</span>
                <input
                    type="text"
                    className="gang-search-input"
                    placeholder="Cari Mandoran..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    disabled={disabled}
                />
            </div>

            {/* Card Grid */}
            <div className="gang-card-grid">
                {/* All Gangs Option */}
                {showAllOption && !searchTerm && (
                    <div
                        className={`gang-card all-gangs ${selected === 'ALL' ? 'selected' : ''}`}
                        onClick={() => !disabled && onChange('ALL')}
                        role="button"
                        tabIndex={0}
                        onKeyPress={(e) => e.key === 'Enter' && !disabled && onChange('ALL')}
                    >
                        <div className="gang-card-code">📋 SEMUA GANG</div>
                        <div className="gang-card-desc">
                            Tampilkan laporan gabungan untuk {gangs.length} gang
                        </div>
                    </div>
                )}

                {/* Individual Gang Cards */}
                {filteredGangs.map((gang) => {
                    const code = getGangCode(gang)
                    const desc = getGangDesc(gang)

                    return (
                        <div
                            key={code}
                            className={`gang-card ${selected === code ? 'selected' : ''}`}
                            onClick={() => !disabled && onChange(code)}
                            role="button"
                            tabIndex={0}
                            onKeyPress={(e) => e.key === 'Enter' && !disabled && onChange(code)}
                        >
                            <div className="gang-card-code">{code}</div>
                            {desc && <div className="gang-card-desc">{desc}</div>}
                        </div>
                    )
                })}

                {/* Empty State */}
                {filteredGangs.length === 0 && !isLoading && (
                    <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                        <div className="empty-state-icon">🔎</div>
                        <div className="empty-state-text">
                            {gangs.length === 0
                                ? 'Tidak ada gang untuk divisi ini'
                                : `Tidak ditemukan gang "${searchTerm}"`}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
