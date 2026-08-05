/**
 * Gang Filter Service
 *
 * Handles filtering logic for gangs by divisions and sub-divisions.
 * Provides utilities for grouping, filtering, and managing gang data.
 */

class GangFilterService {
  /**
   * Group gangs by sub-division (first 2 characters of gang code)
   */
  static groupGangsBySubDivision(gangs = []) {
    const grouping = {}

    gangs.forEach(gang => {
      const gangCode = (gang.gang_code || '').trim()
      if (gangCode.length >= 2) {
        const subDiv = gangCode.substring(0, 2)
        if (!grouping[subDiv]) {
          grouping[subDiv] = {
            subDivision: subDiv,
            gangs: [],
            name: this.getSubDivisionName(subDiv)
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
  }

  /**
   * Get user-friendly name for sub-division
   */
  static getSubDivisionName(subDiv) {
    const nameMap = {
      'A1': 'Air Batu',
      'A2': 'Air Kundo',
      'A3': 'Air Hijau',
      'AM': 'Workshop',
      'AS': 'Staff'
    }
    return nameMap[subDiv] || subDiv
  }

  /**
   * Extract sub-division from gang code
   */
  static extractSubDivision(gangCode) {
    const code = (gangCode || '').trim()
    return code.length >= 2 ? code.substring(0, 2) : 'OTHER'
  }

  /**
   * Get unique sub-divisions from gangs array
   */
  static getUniqueSubDivisions(gangs = []) {
    const subDivisions = new Set()
    gangs.forEach(gang => {
      const subDiv = this.extractSubDivision(gang.gang_code)
      subDivisions.add(subDiv)
    })
    return Array.from(subDivisions).sort()
  }

  /**
   * Filter gangs by sub-divisions
   */
  static filterGangsBySubDivisions(gangs = [], selectedSubDivisions = []) {
    if (selectedSubDivisions.length === 0) {
      return gangs
    }

    return gangs.filter(gang => {
      const subDiv = this.extractSubDivision(gang.gang_code)
      return selectedSubDivisions.includes(subDiv)
    })
  }

  /**
   * Filter gangs by divisions
   */
  static filterGangsByDivisions(gangs = [], selectedDivisions = []) {
    if (selectedDivisions.length === 0) {
      return gangs
    }

    // This assumes gangs have a division field or similar
    // Adjust according to your actual data structure
    return gangs.filter(gang => {
      const division = gang.division || gang.unit_kerja || ''
      return selectedDivisions.some(div =>
        division.toLowerCase().includes(div.toLowerCase())
      )
    })
  }

  /**
   * Apply multiple filters to gangs
   */
  static applyFilters(gangs = [], filters = {}) {
    const { divisions = [], subDivisions = [] } = filters

    let filteredGangs = [...gangs]

    // Apply division filter
    if (divisions.length > 0) {
      filteredGangs = this.filterGangsByDivisions(filteredGangs, divisions)
    }

    // Apply sub-division filter
    if (subDivisions.length > 0) {
      filteredGangs = this.filterGangsBySubDivisions(filteredGangs, subDivisions)
    }

    return filteredGangs
  }

  /**
   * Get filter statistics
   */
  static getFilterStats(gangs = [], filters = {}) {
    const totalGangs = gangs.length
    const filteredGangs = this.applyFilters(gangs, filters)

    const gangGrouping = this.groupGangsBySubDivision(gangs)
    const selectedSubDivisions = filters.subDivisions || []

    let totalInSelection = 0
    if (selectedSubDivisions.length === 0) {
      totalInSelection = totalGangs
    } else {
      selectedSubDivisions.forEach(subDiv => {
        if (gangGrouping[subDiv]) {
          totalInSelection += gangGrouping[subDiv].gangs.length
        }
      })
    }

    return {
      totalGangs,
      filteredGangsCount: filteredGangs.length,
      totalInSelection,
      availableSubDivisions: Object.keys(gangGrouping),
      hasActiveFilter: filters.hasActiveFilter || false
    }
  }

  /**
   * Validate filter configuration
   */
  static validateFilters(filters = {}, availableData = {}) {
    const { divisions = [], subDivisions = [] } = filters
    const { divisions: availableDivisions = [], gangs = [] } = availableData

    const gangGrouping = this.groupGangsBySubDivision(gangs)
    const availableSubDivisions = Object.keys(gangGrouping)

    const validation = {
      isValid: true,
      errors: [],
      warnings: []
    }

    // Check if selected divisions exist
    const invalidDivisions = divisions.filter(div =>
      !availableDivisions.includes(div)
    )
    if (invalidDivisions.length > 0) {
      validation.isValid = false
      validation.errors.push(`Invalid divisions: ${invalidDivisions.join(', ')}`)
    }

    // Check if selected sub-divisions exist
    const invalidSubDivisions = subDivisions.filter(subDiv =>
      !availableSubDivisions.includes(subDiv)
    )
    if (invalidSubDivisions.length > 0) {
      validation.isValid = false
      validation.errors.push(`Invalid sub-divisions: ${invalidSubDivisions.join(', ')}`)
    }

    return validation
  }

  /**
   * Create filter summary for display
   */
  static createFilterSummary(filters = {}, gangs = []) {
    const { divisions = [], subDivisions = [] } = filters
    const gangGrouping = this.groupGangsBySubDivision(gangs)

    const summary = {
      text: '',
      count: 0,
      details: []
    }

    if (divisions.length === 0 && subDivisions.length === 0) {
      summary.text = 'Menampilkan semua data'
      return summary
    }

    const parts = []

    if (divisions.length > 0) {
      parts.push(`Divisi: ${divisions.join(', ')}`)
      summary.details.push(...divisions.map(div => ({ type: 'division', value: div })))
    }

    if (subDivisions.length > 0) {
      const subDivNames = subDivisions.map(subDiv =>
        this.getSubDivisionName(subDiv)
      )
      parts.push(`Sub-divisi: ${subDivNames.join(', ')}`)
      summary.details.push(...subDivisions.map(subDiv => ({
        type: 'subDivision',
        value: subDiv,
        name: this.getSubDivisionName(subDiv)
      })))
    }

    summary.text = parts.join(' | ')
    summary.count = divisions.length + subDivisions.length

    return summary
  }

  /**
   * Save filters to localStorage
   */
  static saveFiltersToStorage(filters = {}, storageKey = 'gangFilters') {
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters))
      return true
    } catch (error) {
      console.error('Error saving filters to storage:', error)
      return false
    }
  }

  /**
   * Load filters from localStorage
   */
  static loadFiltersFromStorage(storageKey = 'gangFilters') {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : {}
    } catch (error) {
      console.error('Error loading filters from storage:', error)
      return {}
    }
  }

  /**
   * Clear filters from localStorage
   */
  static clearFiltersFromStorage(storageKey = 'gangFilters') {
    try {
      localStorage.removeItem(storageKey)
      return true
    } catch (error) {
      console.error('Error clearing filters from storage:', error)
      return false
    }
  }

  /**
   * Get recommended filters based on usage patterns
   */
  static getRecommendedFilters(gangs = [], userHistory = []) {
    const gangGrouping = this.groupGangsBySubDivision(gangs)
    const subDivisions = Object.keys(gangGrouping)

    // Sort sub-divisions by gang count (most used first)
    const sortedSubDivisions = subDivisions
      .map(subDiv => ({
        subDiv,
        count: gangGrouping[subDiv].gangs.length,
        name: gangGrouping[subDiv].name
      }))
      .sort((a, b) => b.count - a.count)

    return {
      mostPopular: sortedSubDivisions.slice(0, 3),
      all: sortedSubDivisions
    }
  }
}

export default GangFilterService