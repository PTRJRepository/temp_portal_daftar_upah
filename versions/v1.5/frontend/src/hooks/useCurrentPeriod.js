import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchCurrentPeriod } from '../services/gangService'
import { isHistoricalPeriod as checkIsHistorical } from '../services/historyService'

/**
 * Custom hook to fetch and use the current payroll period
 * 
 * The current period is determined by the backend from PR_TASKREGLN_ARC
 * and is calculated as: latest period + 1 month
 * 
 * @returns {Object} { month, year, setMonth, setYear, loading, error, refetch, display, isCurrent }
 */
export function useCurrentPeriod() {
  const { token } = useAuth()

  // ponytail: fallback bulan 6 (Juni) + tahun berjalan saat API current period gagal/null.
  //  upgrade: hapus fallback saat backend current-period stabil, atau jadikan konstanta config.
  const FALLBACK_MONTH = 6
  const FALLBACK_YEAR = new Date().getFullYear()

  const [monthState, setMonthState] = useState(null)
  const [yearState, setYearState] = useState(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  // Simple state setters
  const setMonth = useCallback((val) => {
    setMonthState(val)
  }, [])

  const setYear = useCallback((val) => {
    setYearState(val)
  }, [])

  const loadCurrentPeriod = useCallback(async () => {
    if (!token) {
      setMonthState(FALLBACK_MONTH)
      setYearState(FALLBACK_YEAR)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const currentPeriod = await fetchCurrentPeriod(token)
      console.log('[useCurrentPeriod] Loaded current period from API:', currentPeriod)

      if (currentPeriod && currentPeriod.month && currentPeriod.year) {
        setData(currentPeriod)
        setMonth(currentPeriod.month)
        setYear(currentPeriod.year)
      } else {
        // API success tapi null → fallback bulan 6
        setMonth(FALLBACK_MONTH)
        setYear(FALLBACK_YEAR)
      }
    } catch (e) {
      console.error('[useCurrentPeriod] Failed to load current period from API:', e)
      setError(e)
      setMonth(FALLBACK_MONTH)
      setYear(FALLBACK_YEAR)
    } finally {
      setLoading(false)
    }
  }, [token, setMonth, setYear, FALLBACK_MONTH, FALLBACK_YEAR])

  useEffect(() => {
    loadCurrentPeriod()
  }, [loadCurrentPeriod])

  // Display name for the current period
  const display = useMemo(() => {
    if (!monthState || !yearState) return ''
    return getMonthName(monthState) + ' ' + yearState
  }, [monthState, yearState])

  return {
    month: monthState,
    year: yearState,
    setMonth,
    setYear,
    loading,
    error,
    refetch: loadCurrentPeriod,
    display,
    data,
    isCurrent: (checkMonth, checkYear) => monthState === checkMonth && yearState === checkYear
  }
}

/**
 * Hook to check if a specific period is historical
 * @param {number} month - Month to check
 * @param {number} year - Year to check
 * @returns {Object} { isHistorical, loading, error }
 */
export function useIsHistoricalPeriod(month, year) {
  const { token } = useAuth()
  const { month: currentMonth, year: currentYear } = useCurrentPeriod()
  const [isHistorical, setIsHistorical] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function check() {
      if (!token || month === undefined || year === undefined) {
        setIsHistorical(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const response = await checkIsHistorical(token, month, year)
        if (response.success) {
          setIsHistorical(response.data.is_historical)
        } else {
          setError(response.error || 'Failed to check period')
        }
      } catch (err) {
        console.error('[useIsHistoricalPeriod] Error:', err)
        setError(err.message || 'Failed to check period')
        if (currentMonth && currentYear) {
          const requested = year * 100 + month
          const current = currentYear * 100 + currentMonth
          setIsHistorical(requested < current)
        } else {
          setIsHistorical(null)
        }
      } finally {
        setLoading(false)
      }
    }

    check()
  }, [token, month, year, currentMonth, currentYear])

  return { isHistorical, loading, error }
}

/**
 * Combined hook that provides both current period and historical check
 * @param {number} month - Month to compare
 * @param {number} year - Year to compare
 * @returns {Object} Combined period information
 */
export function usePeriodInfo(month, year) {
  const { month: currentMonth, year: currentYear, loading: currentLoading, data } = useCurrentPeriod()

  // Compute if the requested period is historical (derived from current period)
  const isHistorical = useMemo(() => {
    if (month === undefined || year === undefined || currentMonth === undefined || currentYear === undefined) {
      return null
    }
    const requested = year * 100 + month
    const current = currentYear * 100 + currentMonth
    return requested < current
  }, [month, year, currentMonth, currentYear])

  // Get period comparison info
  const periodDiff = useMemo(() => {
    if (month === undefined || year === undefined || currentMonth === undefined || currentYear === undefined) {
      return null
    }
    const requested = year * 100 + month
    const current = currentYear * 100 + currentMonth
    return current - requested // Positive = historical, 0 = current, negative = future
  }, [month, year, currentMonth, currentYear])

  const isCurrentPeriod = periodDiff === 0
  const isFuturePeriod = periodDiff !== null && periodDiff < 0

  return {
    currentMonth,
    currentYear,
    currentDisplay: data?.display || getMonthName(currentMonth) + ' ' + currentYear,
    isHistorical,
    periodDiff,
    isCurrentPeriod,
    isFuturePeriod,
    loading: currentLoading,
    periodType: isCurrentPeriod ? 'current' : (isHistorical ? 'historical' : 'future')
  }
}

/**
 * Get month name in Indonesian
 * @param {number} month - Month number (1-12)
 * @returns {string} Month name
 */
function getMonthName(month) {
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ]
  return months[month - 1] || ''
}

/**
 * Format period as display string
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {string} Formatted period string
 */
export function formatPeriod(month, year) {
  return getMonthName(month) + ' ' + year
}

/**
 * Parse period string to month/year
 * @param {string} periodStr - Period string (e.g., "01/2025" or "Januari 2025")
 * @returns {Object|null} { month, year }
 */
export function parsePeriod(periodStr) {
  // Try MM/YYYY format first
  const slashMatch = periodStr.match(/(\d{1,2})\/(\d{4})/)
  if (slashMatch) {
    return { month: parseInt(slashMatch[1]), year: parseInt(slashMatch[2]) }
  }

  // Try month name format
  const months = [
    'januari', 'februari', 'maret', 'april', 'mei', 'juni',
    'juli', 'agustus', 'september', 'oktober', 'november', 'desember'
  ]
  const lowerStr = periodStr.toLowerCase()
  for (let i = 0; i < months.length; i++) {
    if (lowerStr.includes(months[i])) {
      const yearMatch = periodStr.match(/\d{4}/)
      return {
        month: i + 1,
        year: yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear()
      }
    }
  }

  return null
}
