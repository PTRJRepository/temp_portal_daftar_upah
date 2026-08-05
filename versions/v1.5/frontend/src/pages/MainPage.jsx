import React, { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { fetchGangs, fetchDivisions } from '../services/gangService'
import { getLockedGangs } from '../services/lockedDivisionService'
import { useCurrentPeriod } from '../hooks/useCurrentPeriod'
import CustomPayrollTable from '../components/CustomPayrollTable'
import LoadingScreen from '../components/common/LoadingScreen'
import MonthSelector from '../components/common/MonthSelector'
import ReportToolbar from '../components/common/ReportToolbar'
import SummaryReportPage from './SummaryReportPage'
import WagesSummaryRebinmasPage from './WagesSummaryRebinmasPage'
import WagesSummaryIJLPage from './WagesSummaryIJLPage'
import AnalysisReportPage from './AnalysisReportPage'
import AggregationSeederPage from './AggregationSeederPage'
import PayrollAnalysisPage from './PayrollAnalysisPage'
import GangAttendanceMatrix from '../components/GangAttendanceMatrix'
import GangOvertimeMatrix from '../components/GangOvertimeMatrix'
import GangEmployeeInfo from '../components/GangEmployeeInfo'
import PayrollTaxMatrix from '../components/PayrollTaxMatrix'
import { isProdMode, getUserDivision, buildAppPath } from '../utils/prodModeUtils'
import { openEmployeeDetailPage } from '../utils/employeeDetailNavigation'
import { checkReportAccess } from '../services/summaryReportService'
import { buildSelectedEmployeeRowMap } from '../utils/payrollRowAccessors'
import { getDaftarUpahDownloadActionCopy } from '../utils/payrollDownloadAction'
import {
  getAllowedDivisionsForUser,
  isDivisionAllowed,
  isValidPeriod,
  loadLegacyPayrollSelection,
  loadPayrollSelection,
  savePayrollSelection
} from '../utils/payrollSelectionStorage'

// Check if running in dev/test mode (admin mode)
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

export default function MainPage({ lockedDiv = null }) {
  const { user, token, logout, lockedDivision } = useAuth()

  // Detect production mode or external locked division
  const inProdMode = isProdMode()
  const prodDivision = inProdMode ? getUserDivision() : null

  // Check if user is admin (admin users are not locked to a division even in prod mode)
  // Admin = role is ADMIN or divisi is ALL
  const isAdminUser = user?.isAdmin === true ||
    (user?.role && user.role.toUpperCase() === 'ADMIN') ||
    (user?.divisi && user.divisi.toUpperCase() === 'ALL')

  // Determine if we're in locked mode (from prop, auth context, or prod mode)
  // Admin users are NOT in locked mode even if in production
  const externalLockedDiv = isAdminUser ? null : (lockedDiv || lockedDivision || null)
  const isLockedMode = !isAdminUser && !!(externalLockedDiv || prodDivision)

  // Use current period from API as the default period when no valid saved selection exists
  const { month, setMonth, year, setYear, data: currentPeriodData, loading: currentPeriodLoading } = useCurrentPeriod()

  // Calculate if currently viewed period is historical
  const isHistorical = currentPeriodData ? (year * 100 + month) < (currentPeriodData.year * 100 + currentPeriodData.month) : false;

  // Get current production period for PeriodSlider history indicator
  const currentProductionMonth = currentPeriodData?.month
  const currentProductionYear = currentPeriodData?.year

  const [division, setDivision] = useState('')
  const [gang, setGang] = useState('')
  const [gangPrefix, setGangPrefix] = useState('1')
  const [filtersInitialized, setFiltersInitialized] = useState(false)

  const [gangs, setGangs] = useState([])
  const [gangLoading, setGangLoading] = useState(false)
  const [allDivisions, setAllDivisions] = useState([])

  // Helper to extract Asistensi (group number) from gang code
  // Rule: any gang starting with K2 belongs to Group 1, otherwise extract the numeric part
  const getAsistensi = useCallback((gangCode) => {
    if (!gangCode) return null;
    const gc = gangCode.trim().toUpperCase();
    if (gc.startsWith('K2')) return '1';
    const match = gc.match(/\d+/);
    return match ? match[0] : null;
  }, []);

  const getAvailablePrefixes = useCallback((gangList) => {
    if (!gangList || gangList.length === 0) return []
    const prefixes = new Set()
    gangList.forEach(g => {
      const a = getAsistensi(g.gang_code)
      if (a) prefixes.add(a)
    })
    return Array.from(prefixes).sort((a, b) => Number(a) - Number(b))
  }, [getAsistensi])

  // Compute available asistensi groups from loaded gangs
  const availablePrefixes = useMemo(() => getAvailablePrefixes(gangs), [gangs, getAvailablePrefixes]);

  const [gridLoading, setGridLoading] = useState(false)
  const [isReportGenerated, setIsReportGenerated] = useState(false)
  const [showSummaryReport, setShowSummaryReport] = useState(false)
  const [showWagesRebinmas, setShowWagesRebinmas] = useState(false)
  const [showWagesIJL, setShowWagesIJL] = useState(false)
  const [showAnalysisReport, setShowAnalysisReport] = useState(false)
  const [showAggregationSeeder, setShowAggregationSeeder] = useState(false)
  const [showPayrollAnalysis, setShowComprehensivePerformance] = useState(false)
  const [rowCount, setRowCount] = useState(0)
  const [fontSize, setFontSize] = useState(100) // Default 100% font size
  const [exportHandler, setExportHandler] = useState(null) // Export function from CustomPayrollTable
  const [exportLoading, setExportLoading] = useState(false)
  const [canAccessReports, setCanAccessReports] = useState(DEV_MODE) // Default to DEV_MODE, will be checked via API
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Edit Mode State (New)
  const [isEditMode, setIsEditMode] = useState(false)
  const [valuePriorityMode, setValuePriorityMode] = useState('non_db_ptrj')

  // Period Slider Mode State (enabled by default)
  const [usePeriodSlider, setUsePeriodSlider] = useState(true)
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(() => {
    try {
      return localStorage.getItem('payroll.headerCollapsed') === 'true'
    } catch {
      return false
    }
  })

  // Matrix View State
  // Matrix View State
  const [activeMatrixView, setActiveMatrixView] = useState(null) // null | 'attendance' | 'overtime' | 'employee' | 'pajak'

  // Employee sorting state (for employee info view)
  const [employeeSortBy, setEmployeeSortBy] = useState('emp_code') // 'name' | 'emp_code' | 'hk'
  const [employeeSortOrder, setEmployeeSortOrder] = useState('asc') // 'asc' | 'desc'

  // Employee selection state for payslip printing
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [payrollRowsGetter, setPayrollRowsGetter] = useState(null)

  // Handle toggle single employee selection
  const handleToggleEmployeeSelection = (nik) => {
    setSelectedEmployees(prev => {
      if (prev.includes(nik)) {
        return prev.filter(n => n !== nik)
      } else {
        return [...prev, nik]
      }
    })
  }

  // Handle select all employees
  const handleSelectAllEmployees = (nikList) => {
    setSelectedEmployees(nikList)
  }

  // Handle clear all selections
  const handleClearSelections = () => {
    setSelectedEmployees([])
  }

  // Handle print payslip for selected employees
  const handlePrintPayslip = () => {
    if (selectedEmployees.length === 0) {
      alert('Silakan pilih minimal 1 karyawan terlebih dahulu')
      return
    }

    // OPTIMIZATION: Pull current employee rows on-demand from the table
    // instead of keeping a full copy in parent state all the time.
    const currentRows = payrollRowsGetter ? payrollRowsGetter() : []
    const selectedData = buildSelectedEmployeeRowMap(currentRows, selectedEmployees)
    if (Object.keys(selectedData).length === 0) {
      alert('Data payslip dari tabel belum siap. Coba tunggu sebentar lalu ulangi.')
      return
    }

    // Store in sessionStorage for the payslip page to read
    const storageKey = `payslip_data_${month}_${year}_${Date.now()}`
    sessionStorage.setItem(storageKey, JSON.stringify(selectedData))

    const params = new URLSearchParams({
      emp_codes: selectedEmployees.join(','),
      month: month,
      year: year,
      division: division,
      data_key: storageKey  // Pass the sessionStorage key
    })

    const payslipPath = buildAppPath(`/payslip-print?${params.toString()}`)
    window.open(payslipPath, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    try {
      localStorage.setItem('payroll.headerCollapsed', String(isHeaderCollapsed))
    } catch {
      // Ignore storage failures in private/incognito modes.
    }
  }, [isHeaderCollapsed])

  // Refresh handler
  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  // Seed aggregation handler - uses EXACT same data as UI
  const [isSeeding, setIsSeeding] = useState(false)
  const [seedingStatus, setSeedingStatus] = useState('')
  const handleSeedData = async () => {
    if (!token) return
    if (!window.confirm(`Seed data PERSIS seperti yang tampil di UI untuk ${MONTHS[month-1]} ${year}?`)) return
    
    setIsSeeding(true)
    setSeedingStatus('Extracting data from UI...')
    
    try {
      // Use seed-ui endpoint with EXACT same parameters as current UI view
      const response = await axios.post('payroll/aggregation/seed-ui', {
        division: division || 'ALL',
        month,
        year,
        gangCode: gang || null,  // Current gang filter
        gangPrefix: gangPrefix || null  // Current group filter
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      const result = response.data
      
      if (result.success) {
        const gangCount = result.data?.total_gangs || 0
        const empCount = result.data?.total_employees || 0
        setSeedingStatus(`Success! ${gangCount} gangs, ${empCount} employees seeded`)

        // Show breakdown in console
        if (result.data?.results) {
          console.log('Seeded gangs:', result.data.results.map(r => `${r.gang_code}: ${r.upah_bersih.toLocaleString('id-ID')}`).join(', '))
        }

        setTimeout(() => {
          setSeedingStatus('')
          handleRefresh()
        }, 3000)
      } else {
        setSeedingStatus(`Error: ${result.error || 'Unknown error'}`)
      }
    } catch (e) {
      console.error('UI Seed error:', e)
      setSeedingStatus(`Error: ${e.message}`)
    } finally {
      setIsSeeding(false)
    }
  }

  // Employee sorting handler
  const handleEmployeeSort = (field) => {
    if (employeeSortBy === field) {
      setEmployeeSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setEmployeeSortBy(field)
      setEmployeeSortOrder('asc')
    }
  }

  // Font Size handlers (relative adjustment)
  const handleFontIncrease = () => setFontSize(prev => Math.min(prev + 10, 150))
  const handleFontDecrease = () => setFontSize(prev => Math.max(prev - 10, 60))
  const handleFontReset = () => setFontSize(100)

  // Export to Excel handler
  const handleExportExcel = async () => {
    if (!exportHandler) {
      alert('Data belum siap untuk di-export')
      return
    }
    setExportLoading(true)
    try {
      await exportHandler()
    } finally {
      setExportLoading(false)
    }
  }
  const daftarUpahDownloadAction = getDaftarUpahDownloadActionCopy(exportLoading)

  // Handler for viewing employee detail (called from PayrollGrid context menu)
  const handleViewEmployeeDetail = (employeeData) => {
    const detailPath = openEmployeeDetailPage({
      employeeData,
      month,
      year,
      division: division || '',
      useHistoryDb: isHistorical
    })

    if (!detailPath) {
      console.error('[MainPage] Cannot view detail: emp_code is missing', employeeData)
    }
  }

  // Handler for viewing employee HR Profile (called from PayrollGrid context menu)
  const handleOpenHrProfile = (employeeData) => {
    const empCode = employeeData.emp_code || employeeData.EmpCode || employeeData.nik || employeeData.NIK
    if (!empCode) {
      console.error('[MainPage] Cannot view HR profile: emp_code is missing', employeeData)
      return
    }

    const params = new URLSearchParams({ nik: empCode })
    const hrPath = buildAppPath(`/hr-info?${params.toString()}`)
    window.open(hrPath, '_blank', 'noopener,noreferrer')
  }

  // Fetch divisions from API (database)
  useEffect(() => {
    async function loadDivisions() {
      if (!token) return
      try {
        const divisions = await fetchDivisions(token)
        setAllDivisions(divisions || [])

      } catch (e) {
        console.error('[MainPage] Failed to load divisions from API:', e)
        setAllDivisions([])
      }
    }
    loadDivisions()
  }, [token])

  // Check report access for proxy mode
  // simplified report access check (no API call)
  useEffect(() => {
    // In Prod Mode, only admins can access additional reports
    if (inProdMode) {
      setCanAccessReports(isAdminUser)
    } else {
      // In Dev Mode, allow access by default
      setCanAccessReports(true)
    }
  }, [inProdMode, isAdminUser])

  const storageContext = useMemo(() => ({
    isAdminUser,
    isLockedMode,
    externalLockedDiv,
    prodDivision
  }), [isAdminUser, isLockedMode, externalLockedDiv, prodDivision])

  const allowedDivisions = useMemo(() => {
    return getAllowedDivisionsForUser(user, allDivisions, storageContext)
  }, [user, allDivisions, storageContext])

  const loadGangList = useCallback(async (selectedDivision) => {
    if (!selectedDivision || !token) return []
    return isLockedMode
      ? await getLockedGangs(token, selectedDivision)
      : await fetchGangs(token, selectedDivision, null, true)
  }, [token, isLockedMode])

  useEffect(() => {
    let cancelled = false

    async function initializeFilters() {
      if (!token || !user || currentPeriodLoading) return
      if (!currentPeriodData?.month || !currentPeriodData?.year) return
      if (allowedDivisions.length === 0 && !externalLockedDiv && !prodDivision) return

      const savedSelection = loadPayrollSelection(user, storageContext)
      const legacySelection = savedSelection ? null : loadLegacyPayrollSelection()
      const candidateSelection = savedSelection || legacySelection || {}

      const resolvedMonth = isValidPeriod(candidateSelection.month, candidateSelection.year)
        ? Number(candidateSelection.month)
        : currentPeriodData.month
      const resolvedYear = isValidPeriod(candidateSelection.month, candidateSelection.year)
        ? Number(candidateSelection.year)
        : currentPeriodData.year

      let resolvedDivision = ''
      if (!isAdminUser && externalLockedDiv) {
        resolvedDivision = externalLockedDiv
      } else if (!isAdminUser && prodDivision) {
        resolvedDivision = prodDivision
      } else if (isDivisionAllowed(candidateSelection.division, allowedDivisions, isAdminUser)) {
        resolvedDivision = candidateSelection.division
      } else {
        resolvedDivision = allowedDivisions[0] || ''
      }

      let list = []
      if (resolvedDivision) {
        setGangLoading(true)
        try {
          list = await loadGangList(resolvedDivision)
        } catch (e) {
          console.error('Failed to load gangs:', e)
          list = []
        }
      }

      if (cancelled) return

      const availableGroupPrefixes = getAvailablePrefixes(list)
      const savedGang = candidateSelection.gang
      const resolvedGang = savedGang === 'ALL' || list.some(g => g.gang_code === savedGang)
        ? savedGang
        : 'ALL'
      const savedPrefix = candidateSelection.gangPrefix
      const resolvedGangPrefix = savedPrefix && availableGroupPrefixes.includes(savedPrefix)
        ? savedPrefix
        : (availableGroupPrefixes.includes('1') ? '1' : (availableGroupPrefixes[0] || ''))

      setMonth(resolvedMonth)
      setYear(resolvedYear)
      setDivision(resolvedDivision)
      setGangs(list || [])
      setGang(resolvedGang)
      setGangPrefix(resolvedGangPrefix)
      setFiltersInitialized(true)
      setGangLoading(false)
    }

    if (!filtersInitialized) {
      initializeFilters()
    }

    return () => {
      cancelled = true
    }
  }, [
    token,
    user,
    currentPeriodLoading,
    currentPeriodData,
    allowedDivisions,
    externalLockedDiv,
    prodDivision,
    isAdminUser,
    storageContext,
    loadGangList,
    getAvailablePrefixes,
    setMonth,
    setYear,
    filtersInitialized
  ])

  // Load Gangs when Division changes after initialization
  useEffect(() => {
    async function load() {
      if (!filtersInitialized) return
      if (!division || !token) {
        setGangs([])
        setGang('')
        setGangPrefix(prev => prev || '1')
        return
      }
      setGangLoading(true)
      try {
        const list = await loadGangList(division)

        if (list && list.length > 0) {
          setGangs(list)
          if (!gang || (gang !== 'ALL' && !list.find(g => g.gang_code === gang))) {
            setGang('ALL')
          }
          const availableGroupPrefixes = getAvailablePrefixes(list)
          if (gangPrefix && !availableGroupPrefixes.includes(gangPrefix)) {
            setGangPrefix(availableGroupPrefixes.includes('1') ? '1' : (availableGroupPrefixes[0] || ''))
          }
        } else {
          setGangs([])
          setGang('ALL')
        }
      } catch (e) {
        console.error('Failed to load gangs:', e)
        setGangs([])
        setGang('ALL')
      } finally {
        setGangLoading(false)
      }
    }
    load()
  }, [division, token, filtersInitialized, loadGangList])

  // Reset gang when division changes
  const handleDivisionChange = (newDivision) => {
    setDivision(newDivision)
    setGang('ALL') // Default to ALL for operational
    // Keep gangPrefix at '1' (default) instead of clearing to all
    setGangPrefix('1')
    setGangs([]) // Clear gangs list
    setActiveMatrixView(null) // Reset matrix view when division changes
  }

  // Reset matrix view when gang changes
  useEffect(() => {
    if (gang) {
      setActiveMatrixView(null)
    }
  }, [gang])

  useEffect(() => {
    if (!filtersInitialized || !user || !month || !year) return
    savePayrollSelection(user, storageContext, {
      month,
      year,
      division,
      gang,
      gangPrefix
    })
  }, [filtersInitialized, user, storageContext, month, year, division, gang, gangPrefix])

  // Filter gang list by current asistensi prefix
  const filteredGangs = useMemo(() => {
    if (!gangPrefix) return gangs;
    return gangs.filter(g => getAsistensi(g.gang_code) === gangPrefix);
  }, [gangs, gangPrefix, getAsistensi]);

  const handleMonthChange = (e) => {
    const val = e.target.value // "YYYY-MM"
    if (val) {
      const [y, m] = val.split('-')
      setYear(parseInt(y))
      setMonth(parseInt(m))
    }
  }

  const handleGenerate = () => {
    if (division && gang) {
      setIsReportGenerated(true)
    }
  }

  // Handler for Summary Report
  const handleShowSummaryReport = () => {
    setShowSummaryReport(true)
  }

  const handleBackFromSummary = () => {
    setShowSummaryReport(false)
  }

  // Handler for Wages Rebinmas Report
  const handleShowWagesRebinmas = () => {
    setShowWagesRebinmas(true)
  }

  const handleBackFromWagesRebinmas = () => {
    setShowWagesRebinmas(false)
  }

  // Handler for Wages IJL Report
  const handleShowWagesIJL = () => {
    setShowWagesIJL(true)
  }

  const handleBackFromWagesIJL = () => {
    setShowWagesIJL(false)
  }

  // Handler for Analysis Report
  const handleShowAnalysisReport = () => {
    setShowAnalysisReport(true)
  }

  const handleBackFromAnalysis = () => {
    setShowAnalysisReport(false)
  }

  // Handler for Aggregation Seeder
  const handleShowAggregationSeeder = () => {
    setShowAggregationSeeder(true)
  }

  const handleBackFromAggregationSeeder = () => {
    setShowAggregationSeeder(false)
  }

  // Handler for Comprehensive Performance Page
  const handleShowPayrollAnalysis = () => {
    setShowComprehensivePerformance(true)
  }

  const handleBackFromPayrollAnalysis = () => {
    setShowComprehensivePerformance(false)
  }

  // -- SHOW WAGES IJL REPORT PAGE --
  if (showWagesIJL) {
    return (
      <WagesSummaryIJLPage
        onBack={handleBackFromWagesIJL}
        initialMonth={month}
        initialYear={year}
      />
    )
  }

  // -- SHOW ANALYSIS REPORT PAGE --
  if (showAnalysisReport) {
    return (
      <AnalysisReportPage
        onBack={handleBackFromAnalysis}
        initialMonth={month}
        initialYear={year}
      />
    )
  }

  // -- SHOW AGGREGATION SEEDER PAGE --
  if (showAggregationSeeder) {
    return (
      <AggregationSeederPage
        onBack={handleBackFromAggregationSeeder}
        initialMonth={month}
        initialYear={year}
      />
    )
  }

  // -- SHOW WAGES REBINMAS REPORT PAGE --
  if (showWagesRebinmas) {
    return (
      <WagesSummaryRebinmasPage
        onBack={handleBackFromWagesRebinmas}
        initialMonth={month}
        initialYear={year}
      />
    )
  }

  // -- SHOW SUMMARY REPORT PAGE --
  if (showSummaryReport) {
    return (
      <SummaryReportPage
        onBack={handleBackFromSummary}
        initialDivision={division}
        initialMonth={month}
        initialYear={year}
      />
    )
  }

  // -- SHOW COMPREHENSIVE PERFORMANCE PAGE --
  if (showPayrollAnalysis) {
    return (
      <PayrollAnalysisPage
        onBack={handleBackFromPayrollAnalysis}
        initialMonth={month}
        initialYear={year}
        initialDivision={division}
      />
    )
  }

  // -- SELECTION SCREEN (Formal Professional Theme) --
  if (!isReportGenerated) {
    return (
      <div style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#f8fafc', // Very light gray background
        fontFamily: "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        overflow: 'hidden',
        color: '#334155'
      }}>
        {/* SIDEBAR */}
        <div style={{
          width: '260px',
          backgroundColor: '#1e293b', // Dark Slate/Navy for Sidebar
          color: '#f1f5f9',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          boxShadow: '4px 0 10px rgba(0,0,0,0.05)'
        }}>
          {/* Sidebar Header */}
          <div style={{ padding: '1.5rem', borderBottom: '1px solid #334155' }}>
            <img src="/images/rebinmas.webp" alt="PT Rebinmas Jaya" style={{ height: '40px', marginBottom: '1rem', display: 'block' }} />
            <div style={{ fontWeight: '600', fontSize: '0.9rem', letterSpacing: '0.05em', color: '#94a3b8', textTransform: 'uppercase' }}>Payroll System</div>
            <div style={{ fontWeight: '700', fontSize: '1.1rem', color: '#ffffff' }}>PT Rebinmas Jaya</div>
          </div>

          {/* Navigation Links */}
          <div style={{ padding: '1.5rem 1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#334155',
              color: '#ffffff',
              borderRadius: '6px',
              fontWeight: '500',
              fontSize: '0.9rem',
              cursor: 'default',
              borderLeft: '4px solid #3b82f6'
            }}>
              Dashboard
            </div>

            {/* Laporan Analisis Payroll Link */}
            <div
              onClick={handleShowPayrollAnalysis}
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'transparent',
                color: '#94a3b8',
                borderRadius: '6px',
                fontWeight: '500',
                fontSize: '0.9rem',
                cursor: 'pointer',
                borderLeft: '4px solid transparent',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#334155'; e.currentTarget.style.color = '#ffffff'; }}
              onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              Laporan Analisis Payroll
            </div>

            {/* Manajemen Karyawan Link */}
            <div
              onClick={() => {
                const path = buildAppPath('/employee-directory');
                window.location.href = path;
              }}
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'transparent',
                color: '#94a3b8',
                borderRadius: '6px',
                fontWeight: '500',
                fontSize: '0.9rem',
                cursor: 'pointer',
                borderLeft: '4px solid transparent',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#334155'; e.currentTarget.style.color = '#ffffff'; }}
              onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              Manajemen Karyawan
            </div>
          </div>

          {/* User Profile & Logout */}
          <div style={{ padding: '1.5rem', borderTop: '1px solid #334155', backgroundColor: '#1e293b' }}>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#ffffff' }}>{user?.username}</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{user?.role || 'Staff'}</div>
            </div>
            <button
              onClick={logout}
              style={{
                width: '100%',
                padding: '0.6rem',
                border: '1px solid #475569',
                backgroundColor: 'transparent',
                color: '#cbd5e1',
                borderRadius: '4px',
                fontWeight: '500',
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textAlign: 'center'
              }}
              onMouseOver={(e) => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
              onMouseOut={(e) => { e.target.style.borderColor = '#475569'; e.target.style.color = '#cbd5e1'; }}
            >
              Logout
            </button>
          </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Header / Hero Section */}
          <div style={{
            height: '160px',
            width: '100%',
            backgroundImage: 'url("/images/wallpaper_loading_screen.webp")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-end'
          }}>
            {/* Dark Overlay for Text Readability */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.6)' // Darker overlay for formality
            }} />
            <div style={{ position: 'relative', padding: '2rem', width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
              <h1 style={{ fontSize: '1.75rem', fontWeight: '600', margin: 0, color: '#ffffff', letterSpacing: '-0.025em' }}>
                Selamat Datang, {user?.username}
              </h1>
              <p style={{ margin: '0.5rem 0 0', color: '#e2e8f0', fontSize: '0.95rem', fontWeight: '400' }}>
                Sistem Manajemen Data Upah dan Laporan Operasional
              </p>
            </div>
          </div>

          <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

            {/* FILTER SECTION CARD */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '2.5rem',
              border: '1px solid #cbd5e1',
              borderTop: '5px solid #1e3a8a', // Navy Accent
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
              marginBottom: '2.5rem',
              position: 'relative'
            }}>
              <h2 style={{
                fontSize: '1rem',
                fontWeight: '700',
                color: '#1e3a8a',
                marginBottom: '2rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '2px solid #f1f5f9',
                paddingBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{ fontSize: '1.25rem' }}>⚙️</span> FILTER PARAMETER
              </h2>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem', alignItems: 'flex-start' }}>
                {/* Left Column: Calendar (Fixed Width) */}
                <div style={{ flex: '0 0 320px', minWidth: '280px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#475569', marginBottom: '0.75rem', letterSpacing: '0.025em' }}>
                    PERIODE LAPORAN
                  </label>
                  <MonthSelector
                    month={month}
                    year={year}
                    onChange={(m, y) => { setMonth(m); setYear(y); }}
                  />
                </div>

                {/* Right Column: Division & Gang (Flexible) */}
                <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                  {/* Division Selection */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem', letterSpacing: '0.025em' }}>
                      DIVISI {isLockedMode && <span style={{ color: '#d97706', fontSize: '0.75rem', marginLeft: '4px' }}>(LOCKED)</span>}
                    </label>
                    <select
                      className="input-field"
                      style={{
                        width: '100%',
                        height: '48px', // Slightly taller for better click area
                        padding: '0 1rem',
                        fontSize: '0.95rem',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        backgroundColor: isLockedMode ? '#fffbeb' : 'white',
                        cursor: isLockedMode ? 'not-allowed' : 'pointer',
                        color: '#334155',
                        outline: 'none',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                      value={division}
                      onChange={e => !isLockedMode && handleDivisionChange(e.target.value)}
                      disabled={isLockedMode}
                      onFocus={(e) => { e.target.style.borderColor = '#1e3a8a'; e.target.style.boxShadow = '0 0 0 3px rgba(30, 58, 138, 0.1)'; }}
                      onBlur={(e) => { e.target.style.borderColor = '#cbd5e1'; e.target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; }}
                    >
                      <option value="">Pilih Divisi</option>
                      {allowedDivisions.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                      {isLockedMode && externalLockedDiv && !allowedDivisions.includes(externalLockedDiv) && (
                        <option key={externalLockedDiv} value={externalLockedDiv}>{externalLockedDiv}</option>
                      )}
                    </select>
                  </div>

                  {/* Group / Asistensi Selection */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem', letterSpacing: '0.025em' }}>
                      GROUP / ASISTENSI
                    </label>
                    <select
                      className="input-field"
                      style={{
                        width: '100%',
                        height: '48px',
                        padding: '0 1rem',
                        fontSize: '0.95rem',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        cursor: (!division || gangLoading) ? 'not-allowed' : 'pointer',
                        backgroundColor: gangPrefix ? '#eff6ff' : 'white',
                        borderColor: gangPrefix ? '#93c5fd' : '#cbd5e1',
                        color: '#334155',
                        outline: 'none',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                      value={gangPrefix}
                      onChange={e => {
                        setGangPrefix(e.target.value);
                        setGang('ALL'); // Reset to ALL when group changes
                      }}
                      disabled={!division || gangLoading}
                      onFocus={(e) => { e.target.style.borderColor = '#1e3a8a'; e.target.style.boxShadow = '0 0 0 3px rgba(30, 58, 138, 0.1)'; }}
                      onBlur={(e) => { e.target.style.borderColor = gangPrefix ? '#93c5fd' : '#cbd5e1'; e.target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; }}
                    >
                      <option value="">SEMUA GROUP</option>
                      {availablePrefixes.map(prefix => (
                        <option key={prefix} value={prefix}>Group {prefix}</option>
                      ))}
                    </select>
                  </div>

                  {/* Gang Selection */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem', letterSpacing: '0.025em' }}>
                      GANG / KEMANDORAN
                      {gangPrefix && <span style={{ color: '#3b82f6', fontSize: '0.75rem', marginLeft: '6px', fontWeight: '500' }}>(Group {gangPrefix})</span>}
                    </label>
                    <select
                      className="input-field"
                      style={{
                        width: '100%',
                        height: '48px',
                        padding: '0 1rem',
                        fontSize: '0.95rem',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        cursor: gangLoading ? 'wait' : 'pointer',
                        backgroundColor: gangLoading ? '#f8fafc' : (gang === 'ALL' ? '#f0fdf4' : 'white'),
                        borderColor: gang === 'ALL' ? '#86efac' : '#cbd5e1',
                        color: '#334155',
                        outline: 'none',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                      value={gang}
                      onChange={e => {
                        const selectedGang = e.target.value;
                        setGang(selectedGang);

                        // When selecting a specific gang, auto-update gangPrefix to match that gang's group.
                        // When selecting "SEMUA GANG", clear gangPrefix so the request covers the whole division.
                        if (selectedGang !== 'ALL') {
                          const groupOfGang = getAsistensi(selectedGang);
                          if (groupOfGang) {
                            setGangPrefix(groupOfGang);
                          }
                        } else {
                          setGangPrefix('');
                        }
                      }}
                      disabled={gangLoading}
                      onFocus={(e) => { e.target.style.borderColor = '#1e3a8a'; e.target.style.boxShadow = '0 0 0 3px rgba(30, 58, 138, 0.1)'; }}
                      onBlur={(e) => { e.target.style.borderColor = gang === 'ALL' ? '#86efac' : '#cbd5e1'; e.target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; }}
                    >
                      {gangLoading ? (
                        <option>Memuat data...</option>
                      ) : gangs.length === 0 ? (
                        <option>Menunggu pemilihan divisi...</option>
                      ) : (
                        <>
                          {/* "SEMUA GANG" option — only show when NO group filter is active */}
                          {!gangPrefix && (
                            <option value="ALL">🌐 SEMUA GANG – Seluruh Divisi</option>
                          )}
                          {/* When group filter IS active, show "SEMUA GANG DALAM GROUP X" option */}
                          {gangPrefix && (
                            <option value="ALL">
                              🌐 SEMUA GANG – Group {gangPrefix} ({filteredGangs.length} gang)
                            </option>
                          )}
                          {/* Individual gang options — always filtered by gangPrefix */}
                          {filteredGangs.map(g => (
                            <option key={g.gang_code} value={g.gang_code}>
                              {g.gang_code} - {g.description || '-'}
                            </option>
                          ))}
</>
                      )}
                    </select>
                    {division && gang === 'ALL' && (
                      <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>✅</span> {gangPrefix ? `Menampilkan seluruh karyawan Group ${gangPrefix}` : `Menampilkan seluruh karyawan divisi ${division}`}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </div>

            {/* REPORTS SECTION */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>

              {/* Primary Report Card */}
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '2rem',
                border: '1px solid #cbd5e1',
                borderTop: '5px solid #0ea5e9', // Sky Blue Accent
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                height: '100%',
                transition: 'all 0.3s ease',
                cursor: 'default'
              }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: '#0ea5e9' }}>📋</span> Laporan Operasional
                  </h3>
                  <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '2rem' }}>
                    Akses detail upah harian, perhitungan premi, lembur, dan potongan per karyawan. Data ditampilkan dalam format grid interaktif.
                  </p>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={!division || !gang || gangLoading}
                  style={{
                    width: '100%',
                    padding: '1rem',
                    backgroundColor: (!division || !gang || gangLoading) ? '#e2e8f0' : '#1e3a8a', // Dark Navy Button
                    color: (!division || !gang || gangLoading) ? '#94a3b8' : 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: '700',
                    fontSize: '0.95rem',
                    cursor: (!division || !gang || gangLoading) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    boxShadow: (!division || !gang || gangLoading) ? 'none' : '0 4px 6px -1px rgba(30, 58, 138, 0.3)'
                  }}
                >
                  {gangLoading ? 'Memuat Data...' : 'TAMPILKAN DATA UPAH'}
                </button>
              </div>

              {/* Matrix Cards Section - Appears after filter when division+gang selected */}
              {division && gang && !gangLoading && gangs.length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '1.5rem',
                  marginBottom: '2.5rem'
                }}>
                  {/* Employee Info Card */}
                  <div style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    border: '1px solid #cbd5e1',
                    borderTop: '5px solid #8b5cf6',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.07)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                    onClick={() => setActiveMatrixView(activeMatrixView === 'employee' ? null : 'employee')}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 20px -4px rgba(139, 92, 246, 0.2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.07)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{
                        width: '48px', height: '48px',
                        background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
                        borderRadius: '10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.5rem'
                      }}>
                        👥
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                          Info Karyawan
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '2px 0 0' }}>
                          {gang === 'ALL' ? `${gangs.length} gang` : gang} • {MONTHS[month - 1]} {year}
                        </p>
                      </div>
                      <div style={{ marginLeft: 'auto' }}>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          background: activeMatrixView === 'employee' ? '#7c3aed' : '#8b5cf6',
                          color: 'white',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          {activeMatrixView === 'employee' ? '● AKTIF' : 'LIHAT'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {['NIK KTP', 'EmpCode', 'Bank'].map(s => (
                        <span key={s} style={{
                          fontSize: '0.7rem', fontWeight: '600',
                          background: '#f5f3ff', color: '#7c3aed',
                          padding: '2px 8px', borderRadius: '6px',
                          border: '1px solid #ddd6fe'
                        }}>{s}</span>
                      ))}
                    </div>
                    <div style={{
                      fontSize: '0.75rem', color: '#64748b',
                      borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem'
                    }}>
                      Klik untuk melihat informasi karyawan per gang
                    </div>
                  </div>

                  {/* Attendance Matrix Card */}
                  <div style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    border: '1px solid #cbd5e1',
                    borderTop: '5px solid #10b981',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.07)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                    onClick={() => setActiveMatrixView(activeMatrixView === 'attendance' ? null : 'attendance')}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 20px -4px rgba(16, 185, 129, 0.2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.07)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{
                        width: '48px', height: '48px',
                        background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
                        borderRadius: '10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.5rem'
                      }}>
                        📅
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                          Matrix Absensi
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '2px 0 0' }}>
                          {gang === 'ALL' ? `${gangs.length} gang` : gang} • {MONTHS[month - 1]} {year}
                        </p>
                      </div>
                      <div style={{ marginLeft: 'auto' }}>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          background: activeMatrixView === 'attendance' ? '#059669' : '#10b981',
                          color: 'white',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          {activeMatrixView === 'attendance' ? '● AKTIF' : 'LIHAT'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {['H Hadir', 'C Cuti', 'S Sakit', 'M Minggu', 'N Libur', 'A Alpa'].map(s => (
                        <span key={s} style={{
                          fontSize: '0.7rem', fontWeight: '600',
                          background: '#f8fafc', color: '#475569',
                          padding: '2px 8px', borderRadius: '6px',
                          border: '1px solid #e2e8f0'
                        }}>{s}</span>
                      ))}
                    </div>
                    <div style={{
                      fontSize: '0.75rem', color: '#64748b',
                      borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem'
                    }}>
                      Klik untuk melihat matrix kehadiran harian per karyawan
                    </div>
                  </div>

                  {/* Overtime Matrix Card */}
                  <div style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    border: '1px solid #cbd5e1',
                    borderTop: '5px solid #f59e0b',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.07)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                    onClick={() => setActiveMatrixView(activeMatrixView === 'overtime' ? null : 'overtime')}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 20px -4px rgba(245, 158, 11, 0.2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.07)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{
                        width: '48px', height: '48px',
                        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                        borderRadius: '10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.5rem'
                      }}>
                        ⏰
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                          Matrix Lembur
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '2px 0 0' }}>
                          {gang === 'ALL' ? `${gangs.length} gang` : gang} • {MONTHS[month - 1]} {year}
                        </p>
                      </div>
                      <div style={{ marginLeft: 'auto' }}>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          background: activeMatrixView === 'overtime' ? '#d97706' : '#f59e0b',
                          color: 'white',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          {activeMatrixView === 'overtime' ? '● AKTIF' : 'LIHAT'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {['OT=1', 'Hari Kerja', 'Minggu', 'Libur'].map(s => (
                        <span key={s} style={{
                          fontSize: '0.7rem', fontWeight: '600',
                          background: '#fffbeb', color: '#92400e',
                          padding: '2px 8px', borderRadius: '6px',
                          border: '1px solid #fde68a'
                        }}>{s}</span>
                      ))}
                    </div>
                    <div style={{
                      fontSize: '0.75rem', color: '#64748b',
                      borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem'
                    }}>
                      Klik untuk melihat matrix jam lembur harian per karyawan
                    </div>
                  </div>

                  {/* Tax (Pajak) Matrix Card */}
                  <div style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    border: '1px solid #cbd5e1',
                    borderTop: '5px solid #dc2626',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.07)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                    onClick={() => setActiveMatrixView(activeMatrixView === 'pajak' ? null : 'pajak')}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 20px -4px rgba(220, 38, 38, 0.2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.07)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{
                        width: '48px', height: '48px',
                        background: 'linear-gradient(135deg, #fee2e2, #fecaca)',
                        borderRadius: '10px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.5rem'
                      }}>
                        💰
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                          Detail Pajak
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '2px 0 0' }}>
                          {gang === 'ALL' ? `${gangs.length} gang` : gang} • {MONTHS[month - 1]} {year}
                        </p>
                      </div>
                      <div style={{ marginLeft: 'auto' }}>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          background: activeMatrixView === 'pajak' ? '#b91c1c' : '#dc2626',
                          color: 'white',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          {activeMatrixView === 'pajak' ? '● AKTIF' : 'LIHAT'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {['PTKP', 'TER', 'PPh21', 'BPJS', 'ASTEK'].map(s => (
                        <span key={s} style={{
                          fontSize: '0.7rem', fontWeight: '600',
                          background: '#fef2f2', color: '#dc2626',
                          padding: '2px 8px', borderRadius: '6px',
                          border: '1px solid #fecaca'
                        }}>{s}</span>
                      ))}
                    </div>
                    <div style={{
                      fontSize: '0.75rem', color: '#64748b',
                      borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem'
                    }}>
                      Klik untuk melihat rincian perhitungan pajak per karyawan
                    </div>
                  </div>
                </div>
              )}

              {/* Secondary Reports Card */}
              {canAccessReports && (
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '2rem',
                  border: '1px solid #cbd5e1',
                  borderTop: '5px solid #8b5cf6', // Violet Accent
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                  height: '100%',
                  transition: 'all 0.3s ease'
                }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <h3 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: '#8b5cf6' }}>📊</span> Laporan Analisis & Summary
                  </h3>
                  <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '2rem' }}>
                    Rekapitulasi total upah, laporan financial wages (Rebinmas & IJL), dan analisis komparatif overtime/premi.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                    {division && (
                      <button
                        onClick={handleShowSummaryReport}
                        style={{
                          padding: '0.9rem',
                          backgroundColor: '#ffffff',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontWeight: '600',
                          fontSize: '0.9rem',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.borderColor = '#8b5cf6'; e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.backgroundColor = '#f5f3ff'; }}
                        onMouseOut={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.backgroundColor = '#ffffff'; }}
                      >
                        Summary Report (Per Gang)
                        <span style={{ fontSize: '1.2em' }}>›</span>
                      </button>
                    )}

                    <button
                      onClick={handleShowWagesRebinmas}
                      style={{
                        padding: '0.9rem',
                        backgroundColor: '#ffffff',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.backgroundColor = '#eff6ff'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.backgroundColor = '#ffffff'; }}
                    >
                      Wages Rebinmas Report
                      <span style={{ fontSize: '1.2em' }}>›</span>
                    </button>

                    <button
                      onClick={handleShowWagesIJL}
                      style={{
                        padding: '0.9rem',
                        backgroundColor: '#ffffff',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.color = '#059669'; e.currentTarget.style.backgroundColor = '#ecfdf5'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.backgroundColor = '#ffffff'; }}
                    >
                      Wages Report (IJL)
                      <span style={{ fontSize: '1.2em' }}>›</span>
                    </button>

                    <button
                      onClick={() => window.open(buildAppPath('/report-pajak'), '_blank')}
                      style={{
                        padding: '0.9rem',
                        backgroundColor: '#ffffff',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#8b5cf6'; e.currentTarget.style.color = '#7c3aed'; e.currentTarget.style.backgroundColor = '#f5f3ff'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.backgroundColor = '#ffffff'; }}
                    >
                      Report Pajak (Tahunan & Bulanan)
                      <span style={{ fontSize: '1.2em' }}>›</span>
                    </button>

                    <button
                      onClick={handleShowAnalysisReport}
                      style={{
                        padding: '0.9rem',
                        backgroundColor: '#ffffff',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#ea580c'; e.currentTarget.style.backgroundColor = '#fff7ed'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.backgroundColor = '#ffffff'; }}
                    >
                      Analysis OT & Premi
                      <span style={{ fontSize: '1.2em' }}>›</span>
                    </button>

                    <button
                      onClick={handleSeedData}
                      disabled={isSeeding}
                      style={{
                        padding: '0.9rem',
                        backgroundColor: isSeeding ? '#fef3c7' : '#10b981',
                        color: isSeeding ? '#92400e' : '#ffffff',
                        border: `1px solid ${isSeeding ? '#fde68a' : '#059669'}`,
                        borderRadius: '6px',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: isSeeding ? 'wait' : 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        opacity: isSeeding ? 0.7 : 1
                      }}
                      onMouseOver={(e) => { if (!isSeeding) { e.currentTarget.style.backgroundColor = '#059669'; e.currentTarget.style.color = '#ffffff'; }}}
                      onMouseOut={(e) => { if (!isSeeding) { e.currentTarget.style.backgroundColor = '#10b981'; e.currentTarget.style.color = '#ffffff'; }}}
                    >
                      {isSeeding ? '⏳ Seeding...' : '🚀 Seed Data'}
                    </button>

                    <button
                      onClick={handleShowAggregationSeeder}
                      style={{
                        padding: '0.9rem',
                        backgroundColor: '#ffffff',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#4f46e5'; e.currentTarget.style.backgroundColor = '#eef2ff'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.backgroundColor = '#ffffff'; }}
                    >
                      Aggregation Seeder
                      <span style={{ fontSize: '1.2em' }}>›</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    )
  }

  // -- DASHBOARD SCREEN (Grid View) --
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', background: 'var(--bg-body)', position: 'relative' }}>

      {isHeaderCollapsed && (
        <button
          type="button"
          onClick={() => setIsHeaderCollapsed(false)}
          aria-label="Tampilkan header aplikasi"
          aria-expanded="false"
          title="Tampilkan header aplikasi"
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '96px',
            height: '24px',
            border: '1px solid rgba(15, 23, 42, 0.18)',
            borderTop: 'none',
            borderRadius: '0 0 999px 999px',
            background: 'linear-gradient(180deg, #0f172a 0%, #1e3a8a 100%)',
            color: '#ffffff',
            zIndex: 80,
            cursor: 'pointer',
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.24)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '0.08em'
          }}
        >
          <span style={{ lineHeight: 1 }}>⌄</span>
          <span style={{ width: '28px', height: '3px', borderRadius: '999px', background: 'rgba(255,255,255,0.72)' }} />
        </button>
      )}

      {/* Top Header Navigation - STICKY */}
      {!isHeaderCollapsed && <div style={{
        height: '50px',
        background: '#ffffff',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        zIndex: 50,
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        position: 'sticky',
        top: 0,
        left: 0,
        right: 0,
        flexShrink: 0,
      }}>

        {/* Seeding Status Indicator */}
        {seedingStatus && (
          <div style={{
            position: 'absolute',
            top: '50px',
            left: 0,
            right: 0,
            padding: '0.5rem 1.5rem',
            backgroundColor: seedingStatus.includes('Success') || seedingStatus.includes('berhasil') ? '#d1fae5' : seedingStatus.includes('Error') || seedingStatus.includes('Gagal') ? '#fee2e2' : '#fef3c7',
            borderBottom: `1px solid ${seedingStatus.includes('Success') || seedingStatus.includes('berhasil') ? '#10b981' : seedingStatus.includes('Error') || seedingStatus.includes('Gagal') ? '#ef4444' : '#f59e0b'}`,
            zIndex: 49,
            fontWeight: '600',
            fontSize: '0.85rem',
            color: seedingStatus.includes('Success') || seedingStatus.includes('berhasil') ? '#065f46' : seedingStatus.includes('Error') || seedingStatus.includes('Gagal') ? '#991b1b' : '#92400e',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {seedingStatus.includes('berhasil') ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            ) : seedingStatus.includes('Gagal') || seedingStatus.includes('Error') ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            {seedingStatus}
          </div>
        )}

        {/* Brand & Title */}
        <div className="flex-center gap-4">
          <button
            type="button"
            onClick={() => setIsHeaderCollapsed(true)}
            aria-label="Sembunyikan header aplikasi"
            aria-expanded="true"
            title="Sembunyikan header aplikasi"
            style={{
              width: '30px',
              height: '30px',
              border: '1px solid var(--neutral-200)',
              borderRadius: '999px',
              background: '#f8fafc',
              color: '#334155',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 900,
              boxShadow: '0 1px 2px rgba(15,23,42,0.08)'
            }}
          >
            ⌃
          </button>
          <img src="/images/rebinmas.webp" alt="Logo" style={{ height: '32px' }} onError={(e) => e.target.style.display = 'none'} />
          <div style={{ borderLeft: '1px solid var(--neutral-200)', paddingLeft: '1rem' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--primary-900)', lineHeight: 1.1 }}>PT REBINMAS JAYA</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--neutral-500)', letterSpacing: '0.05em', display: 'flex', alignItems: 'center' }}>
              <span>PAYROLL SYSTEM {isLockedMode && <span style={{ color: '#f59e0b' }}>• 🔒 {division}</span>}</span>

              {!isHistorical && currentPeriodData && (
                <span style={{ color: '#10b981', marginLeft: '6px', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                  <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', marginRight: '4px', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} className="animate-pulse"></span>
                  Current Periode
                </span>
              )}
              {isHistorical && currentPeriodData && (
                <span style={{ color: '#64748b', marginLeft: '6px', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                  <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#64748b', marginRight: '4px' }}></span>
                  History Periode
                </span>
              )}

            </div>
          </div>
        </div>

        {/* Center Controls */}
        <div className="flex-center gap-4" style={{ flex: 1, justifyContent: 'center', maxWidth: '1000px', padding: '0 16px' }}>

          <ReportToolbar
            month={month}
            year={year}
            division={division}
            divisions={isLockedMode ? [division] : (allDivisions.length > 0 ? allDivisions : (user?.divisions || []))}
            gangCode={gang}
            gangs={gangs}  // Full gang objects with description
            gangPrefix={gangPrefix}
            onGangPrefixChange={setGangPrefix}
            onMonthYearChange={(m, y) => { console.log('[MainPage] onMonthYearChange:', m, y); setMonth(m); setYear(y); }}
            onDivisionChange={isLockedMode ? () => { } : handleDivisionChange}
            onGangChange={(g) => setGang(g)}
            disableControls={gridLoading}
            divisionLocked={isLockedMode}
            onRefresh={handleRefresh}
            usePeriodSlider={usePeriodSlider}
            viewMode={activeMatrixView || 'table'}
            onViewModeChange={(mode) => {
              if (mode === 'table') setActiveMatrixView(null);
              else if (mode === 'attendance') setActiveMatrixView('attendance');
              else if (mode === 'overtime') setActiveMatrixView('overtime');
              else if (mode === 'employee') setActiveMatrixView('employee');
            }}
            onTogglePeriodSlider={setUsePeriodSlider}
            useHistoryDb={isHistorical}
            employeeSortBy={employeeSortBy}
            employeeSortOrder={employeeSortOrder}
            onEmployeeSort={handleEmployeeSort}
            showEmployeeSort={activeMatrixView === 'employee'}
            showDaftarUpahSort={true}
            fontSize={fontSize}
            onFontIncrease={handleFontIncrease}
            onFontDecrease={handleFontDecrease}
            onFontReset={handleFontReset}
            onSeedData={handleSeedData}
            isSeeding={isSeeding}
          />
        </div>

        {/* Right Actions */}
        <div className="flex-center gap-4">
          {/* Row Count Badge */}
          {isReportGenerated && rowCount > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, #1a365d 0%, #2d4a6f 100%)',
              color: '#ffffff',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
              fontSize: '0.8rem',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}>
              <span>👥</span>
              <span>{rowCount} Karyawan</span>
            </div>
          )}

          {/* Font Size Controls - hidden in table mode, handled by toolbar */}
          {isReportGenerated && activeMatrixView && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: '#f3f4f6',
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #e5e7eb'
            }}>
              <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '500' }}>Aa</span>
              <button
                onClick={handleFontDecrease}
                disabled={fontSize <= 60}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: fontSize <= 60 ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  padding: '2px 6px',
                  color: fontSize <= 60 ? '#9ca3af' : '#374151',
                  fontWeight: '600'
                }}
                title="Perkecil Font"
              >
                −
              </button>
              <button
                onClick={handleFontReset}
                style={{
                  background: fontSize === 100 ? '#1a365d' : '#ffffff',
                  color: fontSize === 100 ? '#ffffff' : '#374151',
                  border: '1px solid #d1d5db',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '3px',
                  fontWeight: '600',
                  minWidth: '45px'
                }}
                title="Reset ke 100%"
              >
                {fontSize}%
              </button>
              <button
                onClick={handleFontIncrease}
                disabled={fontSize >= 150}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: fontSize >= 150 ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  padding: '2px 6px',
                  color: fontSize >= 150 ? '#9ca3af' : '#374151',
                  fontWeight: '600'
                }}
                title="Perbesar Font"
              >
                +
              </button>
            </div>
          )}

          {/* Unduh Daftar Upah Button */}
          {isReportGenerated && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px', border: '1px solid #d8dee6', borderRadius: '10px', background: '#f8fafc' }}>
              <button
                onClick={handleExportExcel}
                disabled={exportLoading || !exportHandler}
                style={{
                  background: exportLoading || !exportHandler ? '#f1f5f9' : '#f3faf8',
                  color: exportLoading || !exportHandler ? '#94a3b8' : '#285c4d',
                  border: exportLoading || !exportHandler ? '1px solid #d1d5db' : '1px solid #b9cdc8',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  fontSize: '0.76rem',
                  fontWeight: '800',
                  cursor: exportLoading || !exportHandler ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  height: '34px',
                  boxShadow: exportLoading || !exportHandler ? 'none' : '0 4px 12px rgba(40, 92, 77, 0.10)'
                }}
                title={daftarUpahDownloadAction.title}
              >
                <span>{daftarUpahDownloadAction.icon}</span>
                <span>{daftarUpahDownloadAction.label}</span>
              </button>
            </div>
          )}

          {/* Edit Mode Toggle Button */}
          {isReportGenerated && (
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              style={{
                background: isEditMode ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'white',
                color: isEditMode ? '#ffffff' : '#334155',
                border: '1px solid #cbd5e1',
                padding: '0.4rem 0.8rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                height: '36px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                transition: 'all 0.2s'
              }}
              title={isEditMode ? "Matikan Edit Mode" : "Aktifkan Edit Mode"}
            >
              <span>{isEditMode ? '🔓' : '🔒'}</span>
              <span>{isEditMode ? 'Edit Aktif' : 'Edit Mode'}</span>
            </button>
          )}

          {/* Print Slip Gaji Button */}
          {selectedEmployees.length > 0 && (
            <button
              onClick={handlePrintPayslip}
              style={{
                background: '#f8fafc',
                color: '#1f3a5f',
                border: '1px solid #c8d2dc',
                padding: '0.45rem 0.75rem',
                borderRadius: '8px',
                fontSize: '0.76rem',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                height: '38px',
                boxShadow: '0 4px 12px rgba(31, 58, 95, 0.10)'
              }}
              title={`Print Slip Gaji untuk ${selectedEmployees.length} karyawan`}
            >
              <span style={{ minWidth: 30, height: 24, borderRadius: '6px', background: '#1f3a5f', color: '#ffffff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.68rem', fontWeight: 900 }}>SLIP</span>
              <span>Print Slip Gaji ({selectedEmployees.length})</span>
            </button>
          )}

          {/* Clear Selection Button */}
          {selectedEmployees.length > 0 && (
            <button
              onClick={handleClearSelections}
              style={{
                background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '0.4rem 0.8rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                height: '36px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              title="Batalkan semua pilihan"
            >
              <span>✕</span>
              <span>Batalkan ({selectedEmployees.length})</span>
            </button>
          )}

          <div style={{ textAlign: 'right', display: 'none', '@media (min-width: 768px)': { display: 'block' } }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)' }}>{user?.username || 'User'}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--primary-600)' }}>{user?.role || 'Staff'}</div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={logout}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', height: '36px' }}
            title="Logout"
          >
            🚪
          </button>
        </div>
      </div>}

      {/* Main Content - Full Grid with Font Size Control */}
      <div style={{ flex: 1, width: '100%', position: 'relative', overflow: 'auto' }}>
        {division && gang ? (
          <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            <>
              {/* Show matrix views - use display toggling to avoid unmount/remount */}
              <div style={{ display: activeMatrixView === 'attendance' ? 'flex' : 'none', width: '100%', height: '100%', overflow: 'hidden', padding: '1rem', flexDirection: 'column' }}>
                <GangAttendanceMatrix
                  token={token}
                  gangCodes={gang === 'ALL' ? gangs.map(g => g.gang_code) : [gang]}
                  month={month}
                  year={year}
                  division={division}
                  includeFaceVerification={false}
                />
              </div>
              <div style={{ display: activeMatrixView === 'overtime' ? 'flex' : 'none', width: '100%', height: '100%', overflow: 'hidden', padding: '1rem', flexDirection: 'column' }}>
                <GangOvertimeMatrix
                  token={token}
                  gangCodes={gang === 'ALL' ? gangs.map(g => g.gang_code) : [gang]}
                  month={month}
                  year={year}
                  division={division}
                />
              </div>
              <div style={{ display: activeMatrixView === 'employee' ? 'flex' : 'none', width: '100%', height: '100%', overflow: 'hidden', flexDirection: 'column' }}>
                <GangEmployeeInfo
                  token={token}
                  gangCodes={gang === 'ALL' ? gangs.map(g => g.gang_code) : [gang]}
                  month={month}
                  year={year}
                  division={division}
                  onViewEmployeeDetail={handleViewEmployeeDetail}
                  sortBy={employeeSortBy}
                  sortOrder={employeeSortOrder}
                  onSortChange={handleEmployeeSort}
                />
              </div>
              <div style={{ display: activeMatrixView === 'pajak' ? 'flex' : 'none', width: '100%', height: '100%', overflow: 'hidden', flexDirection: 'column', position: 'relative' }}>
                <PayrollTaxMatrix
                  token={token}
                  gangCodes={gang === 'ALL' ? gangs.map(g => g.gang_code) : [gang]}
                  month={month}
                  year={year}
                  division={division}
                  useHistoryDb={isHistorical}
                />
              </div>
            </>
            {/* Payroll table - always mounted, hidden with display:none when matrix active */}
            <div style={{ display: !activeMatrixView ? 'block' : 'none', width: '100%', height: '100%' }}>
              <CustomPayrollTable
                token={token}
                month={month}
                year={year}
                division={division}
                gangCode={gang}
                gangPrefix={gangPrefix}
                gangLoading={gangLoading}
                onViewEmployeeDetail={handleViewEmployeeDetail}
                onOpenHrProfile={handleOpenHrProfile}
                fontSize={fontSize}
                onExportReady={(handler) => setExportHandler(() => handler)}
                onRowsGetterReady={(getter) => setPayrollRowsGetter(() => getter)}
                refreshTrigger={refreshTrigger}
                selectedEmployees={selectedEmployees}
                onToggleEmployeeSelection={handleToggleEmployeeSelection}
                onSelectAllEmployees={handleSelectAllEmployees}
                isEditMode={isEditMode}
                valuePriorityMode={valuePriorityMode}
                onValuePriorityModeChange={setValuePriorityMode}
                useHistoryDb={isHistorical}
                onRefresh={() => setRefreshTrigger(prev => prev + 1)}
                sortBy={activeMatrixView === 'employee' ? undefined : employeeSortBy}
                sortOrder={activeMatrixView === 'employee' ? undefined : employeeSortOrder}
              />
            </div>
          </div>
        ) : (
          <div className="flex-center h-full flex-col text-neutral-400">
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👆</div>
            <div>Silakan pilih Divisi dan Gang di menu atas untuk menampilkan data</div>
          </div>
        )}

        {/* Loading Overlay for Grid Actions */}
        <LoadingScreen
          isLoading={gridLoading}
          message="Memproses Data..."
          gangCode={gang}
          month={month}
          year={year}
          steps={[
            { name: 'Sinkronisasi Database', duration: 1000 },
            { name: 'Hitung Premi & Potongan', duration: 1500 },
            { name: 'Finalisasi Laporan', duration: 800 }
          ]}
        />
      </div>
    </div>
  )
}
