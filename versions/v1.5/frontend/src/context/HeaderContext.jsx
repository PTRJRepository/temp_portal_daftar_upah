import React, { createContext, useContext, useState, useCallback } from 'react'
import { fetchDynamicHeaders, fetchColumnDefinitions } from '../services/headerService'

const HeaderContext = createContext()

export const useHeader = () => {
  const context = useContext(HeaderContext)
  if (!context) {
    throw new Error('useHeader must be used within a HeaderProvider')
  }
  return context
}

export const HeaderProvider = ({ children }) => {
  const [preloadedHeaders, setPreloadedHeaders] = useState({})
  const [preloadingStatus, setPreloadingStatus] = useState({})

  const preloadHeaders = useCallback(async (token, month, year, gangCode) => {
    const key = `${gangCode}_${year}_${month}`

    // Check if already preloaded
    if (preloadedHeaders[key]) {
      console.log('[HeaderContext] Headers already preloaded for', key)
      return preloadedHeaders[key]
    }

    // Check if currently preloading
    if (preloadingStatus[key]) {
      console.log('[HeaderContext] Headers currently preloading for', key)
      return preloadingStatus[key]
    }

    console.log('[HeaderContext] Starting preload headers for', key)

    // Create preloading promise
    const preloadingPromise = (async () => {
      try {
        setPreloadingStatus(prev => ({ ...prev, [key]: true }))

        const [headersData, columnDefsData] = await Promise.all([
          fetchDynamicHeaders(token, month, year, gangCode),
          fetchColumnDefinitions(token, month, year, gangCode)
        ])

        const result = {
          headersData,
          columnDefsData,
          timestamp: Date.now()
        }

        setPreloadedHeaders(prev => ({ ...prev, [key]: result }))
        console.log('[HeaderContext] Headers preloaded successfully for', key)

        return result
      } catch (error) {
        console.error('[HeaderContext] Failed to preload headers for', key, error)
        // Remove from loading status on error
        setPreloadingStatus(prev => ({ ...prev, [key]: false }))
        throw error
      } finally {
        setPreloadingStatus(prev => ({ ...prev, [key]: false }))
      }
    })()

    return preloadingPromise
  }, [preloadedHeaders, preloadingStatus])

  const clearPreloadedHeaders = useCallback(() => {
    setPreloadedHeaders({})
    setPreloadingStatus({})
    console.log('[HeaderContext] All preloaded headers cleared')
  }, [])

  const isHeadersPreloaded = useCallback((token, month, year, gangCode) => {
    const key = `${gangCode}_${year}_${month}`
    return !!preloadedHeaders[key]
  }, [preloadedHeaders])

  const getPreloadedHeaders = useCallback((token, month, year, gangCode) => {
    const key = `${gangCode}_${year}_${month}`
    return preloadedHeaders[key] || null
  }, [preloadedHeaders])

  const value = {
    preloadHeaders,
    clearPreloadedHeaders,
    isHeadersPreloaded,
    getPreloadedHeaders,
    preloadingStatus
  }

  return (
    <HeaderContext.Provider value={value}>
      {children}
    </HeaderContext.Provider>
  )
}