import React, { useState, useEffect, useMemo } from 'react'
import '../../styles/theme.css'

/**
 * Enhanced GangFilter Component
 *
 * Allows filtering gangs by Division and Sub-Division with improved UI/UX.
 *
 * Props:
 * - divisions: Array of division codes (e.g., ['PG1A', 'PG1B', 'PG2A'])
 * - gangs: Array of gang objects with gang_code and description
 * - selectedFilters: Object with divisions and subDivisions arrays
 * - onFiltersChange: Callback when filters change (e.g., (filters) => ...)
 * - isLoading: Boolean indicating if data is loading
 * - className: Additional CSS classes
 */
export default function GangFilter({
  divisions = [],
  gangs = [],
  selectedFilters = {},
  onFiltersChange,
  isLoading = false,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(true)
  const [selectedDivisions, setSelectedDivisions] = useState([])
  const [selectedSubDivisions, setSelectedSubDivisions] = useState([])

  // Group gangs by sub-division (first 2 characters)
  const gangGrouping = useMemo(() => {
    const grouping = {}

    gangs.forEach(gang => {
      const gangCode = (gang.gang_code || '').trim()
      if (gangCode.length >= 2) {
        const subDiv = gangCode.substring(0, 2)
        if (!grouping[subDiv]) {
          grouping[subDiv] = {
            subDivision: subDiv,
            gangs: [],
            name: getSubDivisionName(subDiv)
          }
        }
        grouping[subDiv].gangs.push({
          ...gang,
          gang_code: gangCode,
          description: (gang.description || '').trim()
        })
      }
    })

    return grouping
  }, [gangs])

  // Get sub-division name mapping
  const getSubDivisionName = (subDiv) => {
    const nameMap = {
      'A1': 'Air Batu',
      'A2': 'Air Kundo',
      'A3': 'Air Hijau',
      'AM': 'Workshop',
      'AS': 'Staff'
    }
    return nameMap[subDiv] || subDiv
  }

  // Initialize filters from props
  useEffect(() => {
    if (selectedFilters.divisions) {
      setSelectedDivisions(selectedFilters.divisions)
    }
    if (selectedFilters.subDivisions) {
      setSelectedSubDivisions(selectedFilters.subDivisions)
    }
  }, [selectedFilters])

  const handleDivisionChange = (division) => {
    const newSelected = selectedDivisions.includes(division)
      ? selectedDivisions.filter(d => d !== division)
      : [...selectedDivisions, division]

    setSelectedDivisions(newSelected)
  }

  const handleSubDivisionChange = (subDivision) => {
    const newSelected = selectedSubDivisions.includes(subDivision)
      ? selectedSubDivisions.filter(s => s !== subDivision)
      : [...selectedSubDivisions, subDivision]

    setSelectedSubDivisions(newSelected)
  }

  // Keyboard navigation
  const handleKeyDown = (e, action) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }

  const handleSelectAllSubDivisions = (checked) => {
    if (checked) {
      setSelectedSubDivisions(Object.keys(gangGrouping))
    } else {
      setSelectedSubDivisions([])
    }
  }

  const applyFilters = () => {
    onFiltersChange({
      divisions: selectedDivisions,
      subDivisions: selectedSubDivisions,
      hasActiveFilter: selectedDivisions.length > 0 || selectedSubDivisions.length > 0
    })
  }

  const resetFilters = () => {
    setSelectedDivisions([])
    setSelectedSubDivisions([])
    onFiltersChange({
      divisions: [],
      subDivisions: [],
      hasActiveFilter: false
    })
  }

  const getActiveFiltersCount = () => {
    return selectedDivisions.length + selectedSubDivisions.length
  }

  const getTotalGangsInSelection = () => {
    let count = 0
    if (selectedSubDivisions.length === 0) {
      count = gangs.length
    } else {
      selectedSubDivisions.forEach(subDiv => {
        if (gangGrouping[subDiv]) {
          count += gangGrouping[subDiv].gangs.length
        }
      })
    }
    return count
  }

  const hasActiveFilter = selectedFilters.hasActiveFilter || false
  const availableSubDivisions = Object.keys(gangGrouping)
  const isAllSubDivisionsSelected = availableSubDivisions.length > 0 && selectedSubDivisions.length === availableSubDivisions.length

  return (
    <div className={`gang-filter-container ${className}`} style={{
      backgroundColor: 'var(--neutral-50)',
      padding: '1rem',
      borderRadius: '8px',
      border: hasActiveFilter ? '2px solid var(--primary-300)' : '1px solid var(--neutral-200)',
      marginBottom: '1.5rem',
      transition: 'all 0.2s ease'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🔍</span>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>Filter Data Gang</h3>
          {getActiveFiltersCount() > 0 && (
            <span style={{
              backgroundColor: 'var(--primary-600)',
              color: 'white',
              fontSize: '0.75rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '999px',
              fontWeight: '600'
            }}>
              {getActiveFiltersCount()}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--neutral-600)' }}
          aria-label={isOpen ? "Collapse filter" : "Expand filter"}
        >
          {isOpen ? '▼' : '▲'}
        </button>
      </div>

      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Active Filters Summary */}
          {hasActiveFilter && (
            <div style={{
              padding: '0.75rem',
              backgroundColor: 'var(--primary-50)',
              border: '1px solid var(--primary-200)',
              borderRadius: '6px',
              fontSize: '0.9rem'
            }}>
              <div style={{ fontWeight: '600', color: 'var(--primary-800)', marginBottom: '0.25rem' }}>
                Filter Aktif ({getActiveFiltersCount()}):
              </div>
              <div style={{ color: 'var(--primary-700)' }}>
                {getTotalGangsInSelection()} gang akan ditampilkan
              </div>
            </div>
          )}

          {/* Divisions Section */}
          {divisions.length > 0 && (
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Divisi Utama
              </label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: '0.5rem',
                maxHeight: '120px',
                overflowY: 'auto',
                padding: '0.75rem',
                backgroundColor: 'white',
                border: '1px solid var(--neutral-300)',
                borderRadius: '6px'
              }}>
                {divisions.map(division => (
                  <label
                    key={division}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      borderRadius: '4px',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--neutral-100)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                    onKeyDown={(e) => handleKeyDown(e, () => handleDivisionChange(division))}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDivisions.includes(division)}
                      onChange={() => handleDivisionChange(division)}
                      disabled={isLoading}
                      style={{ width: '16px', height: '16px' }}
                      aria-label={`Pilih divisi ${division}`}
                      aria-describedby={`div-${division}-desc`}
                    />
                    <span id={`div-${division}-desc`}>{division}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Sub-divisions Section */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ margin: 0, fontWeight: '600' }}>
                Sub-Divisi (Kelompok Gang)
              </label>
              {availableSubDivisions.length > 0 && (
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={isAllSubDivisionsSelected}
                    onChange={(e) => handleSelectAllSubDivisions(e.target.checked)}
                    disabled={isLoading}
                    style={{ width: '16px', height: '16px' }}
                    aria-label="Pilih semua sub-divisi"
                  />
                  <span style={{ fontWeight: '600' }}>Pilih Semua</span>
                </label>
              )}
            </div>

            {availableSubDivisions.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.75rem' }}>
                {Object.values(gangGrouping).map(group => (
                  <div key={group.subDivision} style={{
                    border: selectedSubDivisions.includes(group.subDivision)
                      ? '2px solid var(--primary-300)'
                      : '1px solid var(--neutral-200)',
                    borderRadius: '8px',
                    padding: '1rem',
                    backgroundColor: selectedSubDivisions.includes(group.subDivision)
                      ? 'var(--primary-50)'
                      : 'white',
                    transition: 'all 0.2s ease'
                  }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      cursor: 'pointer',
                      marginBottom: '0.5rem'
                    }}
                    onKeyDown={(e) => handleKeyDown(e, () => handleSubDivisionChange(group.subDivision))}
                    role="group"
                    aria-labelledby={`subdiv-${group.subDivision}-label`}
                    aria-describedby={`subdiv-${group.subDivision}-desc`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSubDivisions.includes(group.subDivision)}
                      onChange={() => handleSubDivisionChange(group.subDivision)}
                      disabled={isLoading}
                      style={{ width: '18px', height: '18px' }}
                      aria-label={`Pilih sub-divisi ${group.name} (${group.subDivision})`}
                    />
                    <div>
                      <div
                        id={`subdiv-${group.subDivision}-label`}
                        style={{ fontWeight: '600', color: 'var(--text-main)' }}
                      >
                        {group.name} ({group.subDivision})
                      </div>
                      <div
                        id={`subdiv-${group.subDivision}-desc`}
                        style={{ fontSize: '0.8rem', color: 'var(--neutral-600)' }}
                      >
                        {group.gangs.length} gang
                      </div>
                    </div>
                  </label>

                    {/* Gang Preview */}
                    {selectedSubDivisions.includes(group.subDivision) && (
                      <div style={{ marginLeft: '2.25rem', fontSize: '0.75rem', color: 'var(--neutral-700)' }}>
                        {group.gangs.map(gang => (
                          <div key={gang.gang_code} style={{ marginBottom: '0.25rem' }}>
                            <strong>{gang.gang_code}:</strong> {gang.description}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: '1rem',
                textAlign: 'center',
                color: 'var(--neutral-500)',
                fontStyle: 'italic',
                backgroundColor: 'var(--neutral-100)',
                borderRadius: '6px'
              }}>
                Tidak ada data sub-divisi
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              onClick={resetFilters}
              disabled={isLoading}
              style={{ flex: 1 }}
              aria-label="Reset semua filter gang"
            >
              Reset Filter
            </button>
            <button
              className="btn btn-primary"
              onClick={applyFilters}
              disabled={isLoading}
              style={{ flex: 1 }}
              aria-label="Terapkan filter yang dipilih"
            >
              Terapkan Filter
            </button>
          </div>

          {isLoading && (
            <div style={{
              fontSize: '0.9rem',
              color: 'var(--primary-600)',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}>
              <span>⏳</span> Sedang memproses data...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
