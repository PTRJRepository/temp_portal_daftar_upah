import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import React from 'react'
import { AgGridReact } from 'ag-grid-react'
import HierHeaderGroup from '../components/common/HierHeaderGroup'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
// Import new theme styling
import '../styles/theme.css'
import '../styles/ag-grid-professional.css'
import '../styles/report-edit-mode.css'

import { fetchReportRowsBatched, fetchReportRowsSimple, fetchReportCount, fetchReportDivisionOptimized } from '../services/payrollService'
import { fetchColumnDefinitions } from '../services/headerService'
import { login } from '../services/authService'
import { fetchGangInfo, fetchGangs } from '../services/gangService'
import LoadingScreen from '../components/common/LoadingScreen'
import SelectionStats from '../components/common/SelectionStats'
import DashboardLayout from '../components/layout/DashboardLayout'
import ReportToolbar from '../components/common/ReportToolbar'
import GangFilter from '../components/common/GangFilter'
import { GangFilterProvider } from '../context/GangFilterContext'
import { useGangFilter } from '../context/GangFilterContext'
import { exportReportToExcelPro } from '../utils/exportReportToExcelPro'
import GangAttendanceMatrix from '../components/GangAttendanceMatrix'
import GangOvertimeMatrix from '../components/GangOvertimeMatrix'

// Check if running in development mode
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true' || import.meta.env.DEV_MODE === 'true'

const GangHeaderRenderer = (params) => {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: 'var(--neutral-100)',
      color: 'var(--text-main)',
      fontWeight: '700',
      display: 'flex',
      alignItems: 'center',
      paddingLeft: '16px',
      fontSize: '13px',
      borderBottom: '1px solid var(--border-color)'
    }}>
      🏭 {params.data.gang_code}
    </div>
  )
}

// Inner component that uses the gang filter context
function ReportContent({ token, user, month, year, gang_code, division, onLoad, onBack, gangPrefix: gangPrefixProp = null }) {
  const gangFilter = useGangFilter()

  // State for overrides
  const [authToken, setAuthToken] = useState(token || null)
  const [overrideMonth, setOverrideMonth] = useState(null)
  const [overrideYear, setOverrideYear] = useState(null)
  const [overrideGangCode, setOverrideGangCode] = useState(null)

  // Database mode state
  const [useHistory, setUseHistory] = useState(false)

  // State for gang selector
  const [availableGangs, setAvailableGangs] = useState([])
  const [overrideDivision, setOverrideDivision] = useState(null)
  const [allGangs, setAllGangs] = useState([])
  const [allDivisions, setAllDivisions] = useState([])

  // [FIX] Matrix gang codes - loaded independently from available gangs, not from rows
  // This ensures attendance/lembur matrix works even without payroll (Daftar Upah) data loaded
  const matrixGangCodes = React.useMemo(() => {
    // Always prefer availableGangs (already filtered by division + gang filter)
    if (availableGangs.length > 0) {
      return [...new Set(availableGangs.map(g => g.gang_code).filter(Boolean))]
    }
    // Fallback to rows (Daftar Upah data) - may be empty for Estate PC
    if (rows.length > 0) {
      return [...new Set(rows.map(r => r.gang_code).filter(Boolean))]
    }
    return []
  }, [availableGangs, rows])

  // In development mode, use default values if props are not provided
  const devMonth = DEV_MODE ? (month || undefined) : month
  const devYear = DEV_MODE ? (year || undefined) : year
  const devGangCode = DEV_MODE ? (gang_code || undefined) : gang_code

  // Derived values (Declared ONCE here at the top)
  const finalGangCode = overrideGangCode || devGangCode || gang_code
  const finalMonth = overrideMonth || devMonth || month
  const finalYear = overrideYear || devYear || year
  const finalDivision = overrideDivision || division

  // Normalize for hooks
  const activeMonth = typeof finalMonth === 'string' && finalMonth.includes('-') ? parseInt(finalMonth.split('-')[1], 10) : finalMonth
  const activeYear = typeof finalMonth === 'string' && finalMonth.includes('-') ? parseInt(finalMonth.split('-')[0], 10) : finalYear

  const [rows, setRows] = useState([])
  const [pinnedBottom, setPinnedBottom] = useState([])
  const [columnDefs, setColumnDefs] = useState([])
  const [error, setError] = useState('')
  const computeRulesRef = useRef({})

  const gridRef = useRef(null)
  const dataInitRef = useRef(false)
  const requestIdRef = useRef(0)
  const autoHideMapRef = useRef({})
  // [FIX] Store rows in a ref so datasource can synchronously access current data without state timing issues
  const rowsDataRef = useRef([])

  const [loading, setLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0, status: '' })
  const [isIncrementalLoading, setIsIncrementalLoading] = useState(false)
  const [firstBatchReady, setFirstBatchReady] = useState(false)
  const [firstBatchAttempted, setFirstBatchAttempted] = useState(false)
  const [initialRowsPreview, setInitialRowsPreview] = useState([])
  // [FIX] Gate AG Grid rendering until data is actually ready to prevent "loading done but no data" flicker
  const [dataReady, setDataReady] = useState(false)
  const [gangInfo, setGangInfo] = useState(null)
  const [selectionStats, setSelectionStats] = useState({ count: 0, sum: 0, average: 0 })
  const [viewMode, setViewMode] = useState('table') // 'table' | 'matrix'

  // --- JOB TITLE FEATURE STATE ---
  const [jobTitles, setJobTitles] = useState({})
  const [unsavedJobs, setUnsavedJobs] = useState({})
  const [isSavingJobs, setIsSavingJobs] = useState(false)

  // --- NIK EDIT MODE STATE ---
  const [editModeNik, setEditModeNik] = useState(false)
  const [pendingNikEdits, setPendingNikEdits] = useState({})
  const [isSavingNik, setIsSavingNik] = useState(false)
  const [historyModalNik, setHistoryModalNik] = useState({ isOpen: false, data: null, empCode: null, loading: false })

  // --- DYNAMIC PENDAPATAN LAINNYA EDIT MODE ---
  const [editModePendapatan, setEditModePendapatan] = useState(false)
  const [customPendapatanTypes, setCustomPendapatanTypes] = useState([]) // [{type: 'KONTANAN', name: 'Kontanan'}, ...]
  const [pendingPendapatanEdits, setPendingPendapatanEdits] = useState({}) // { 'NIK::NAMA::TYPE': { nik, emp_name, gang_code, amount, income_type, income_name } }
  const [isSavingPendapatan, setIsSavingPendapatan] = useState(false)
  const [showAddPendapatanPopup, setShowAddPendapatanPopup] = useState(false)
  const [newPendapatanName, setNewPendapatanName] = useState('')

  // [NEW] Slim employee rows to save memory in frontend state
  const slimEmployeeFrontend = useCallback((emp) => {
    if (!emp) return emp;
    // Strip heavy detail arrays that aren't needed for the main table
    // Keep other_incomes as it's needed for calculations
    const { shortage_details, excess_details, lembur_records, ...rest } = emp;
    return rest;
  }, []);

  const handleNikChange = useCallback((empcode, newVal, oldVal, rowData) => {
    if (newVal === oldVal) return;
    setPendingNikEdits(prev => ({
      ...prev,
      [empcode]: { emp_code: empcode, nama: rowData.nama, old_nik: oldVal, new_nik: newVal }
    }))
  }, [])

  const handleSaveNikEdits = async () => {
    if (Object.keys(pendingNikEdits).length === 0) return
    setIsSavingNik(true)
    try {
      const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`
      const promises = Object.values(pendingNikEdits).map(edit =>
        fetch(`${backendUrl}/employee-hr-data/${edit.emp_code}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authToken ? `Bearer ${authToken}` : ''
          },
          body: JSON.stringify({ field: 'nik_ktp', value: String(edit.new_nik) })
        }).then(res => res.json())
      )

      const results = await Promise.all(promises)
      const failed = results.filter(r => !r.success)
      if (failed.length > 0) {
        alert(`Failed to save ${failed.length} NIK records.`)
      } else {
        setPendingNikEdits({})
        alert('Successfully saved NIK updates!')
      }
    } catch (e) {
      alert('Error saving NIK edits: ' + e.message)
    } finally {
      setIsSavingNik(false)
    }
  }

  const openNikHistory = async (empcode) => {
    setHistoryModalNik({ isOpen: true, data: null, empCode: empcode, loading: true })
    try {
      const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`
      const res = await fetch(`${backendUrl}/employee-hr-data/${empcode}/history`)
      const json = await res.json()
      if (json.success) {
        setHistoryModalNik({ isOpen: true, data: json.data, empCode: empcode, loading: false })
      } else {
        throw new Error(json.error)
      }
    } catch (e) {
      alert("Failed to load history: " + e.message)
      setHistoryModalNik(prev => ({ ...prev, loading: false }))
    }
  }

  // Refresh grid cells when edit mode toggles so the pencil icon appears immediately
  useEffect(() => {
    if (gridRef.current && gridRef.current.api) {
      // Use redrawRows to fully unmount and mount React cell renderers
      gridRef.current.api.redrawRows()
    }
  }, [editModeNik])

  // Generic pendapatan lainnya edit handler
  const handlePendapatanChange = useCallback((nik, empName, gangCode, incomeType, incomeName, newVal) => {
    const amount = parseFloat(newVal) || 0;
    // KEY: Use NIK + Nama + TYPE to disambiguate employees with the same NIK
    const key = `${nik}::${empName}::${incomeType}`;
    setPendingPendapatanEdits(prev => ({
      ...prev,
      [key]: { nik, emp_name: empName, gang_code: gangCode, amount, income_type: incomeType, income_name: incomeName }
    }))
  }, [])

  const handleAddPendapatanType = (name) => {
    if (!name || !name.trim()) return;
    const type = name.trim().toUpperCase().replace(/\s+/g, '_');
    const displayName = name.trim();
    // Don't add duplicate
    if (customPendapatanTypes.some(t => t.type === type)) {
      alert(`Tipe "${displayName}" sudah ada.`);
      return;
    }
    setCustomPendapatanTypes(prev => [...prev, { type, name: displayName }]);
    setNewPendapatanName('');
    setShowAddPendapatanPopup(false);
  }

  const handleRemovePendapatanType = (type) => {
    setCustomPendapatanTypes(prev => prev.filter(t => t.type !== type));
    // Remove pending edits for this type (key format: NIK::NAMA::TYPE)
    setPendingPendapatanEdits(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(key => {
        if (key.endsWith(`::${type}`)) delete next[key];
      });
      return next;
    });
  }

  const handleSavePendapatanEdits = async () => {
    if (Object.keys(pendingPendapatanEdits).length === 0) return
    setIsSavingPendapatan(true)
    try {
      const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`
      const promises = Object.values(pendingPendapatanEdits).map(edit =>
        fetch(`${backendUrl}/payroll/locked/pendapatan-lainnya-edit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authToken ? `Bearer ${authToken}` : ''
          },
          body: JSON.stringify({
            nik: edit.nik,
            emp_name: edit.emp_name,
            period_month: parseInt(activeMonth),
            period_year: parseInt(activeYear),
            amount: edit.amount,
            gang_code: edit.gang_code,
            division_code: finalDivision || '',
            income_type: edit.income_type,
            income_name: edit.income_name
          })
        }).then(res => res.json())
      )

      const results = await Promise.all(promises)
      const failed = results.filter(r => !r.success)
      if (failed.length > 0) {
        alert(`Gagal menyimpan ${failed.length} record.`)
      } else {
        setPendingPendapatanEdits({})
        alert('Pendapatan Lainnya berhasil disimpan! Data akan di-refresh.')
        setRows([])
        setPinnedBottom([])
        dataInitRef.current = false
      }
    } catch (e) {
      alert('Error menyimpan: ' + e.message)
    } finally {
      setIsSavingPendapatan(false)
    }
  }

  // Fetch existing custom income types when period changes
  useEffect(() => {
    if (!authToken || !activeMonth || !activeYear) return;
    (async () => {
      try {
        const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`;
        const res = await fetch(
          `${backendUrl}/payroll/locked/pendapatan-lainnya-types?month=${activeMonth}&year=${activeYear}`,
          { headers: { 'Authorization': authToken ? `Bearer ${authToken}` : '' } }
        );
        const json = await res.json();
        if (json.success && json.types) {
          setCustomPendapatanTypes(json.types);
        }
      } catch (e) {
        console.error('[Report] Failed to fetch custom pendapatan types:', e);
      }
    })();
  }, [authToken, activeMonth, activeYear])

  // Refresh grid cells when pendapatan edit mode toggles
  useEffect(() => {
    if (gridRef.current && gridRef.current.api) {
      gridRef.current.api.redrawRows()
    }
  }, [editModePendapatan, customPendapatanTypes])

  // Fetch job titles
  useEffect(() => {
    async function loadJobTitles() {
      try {
        // Construct dynamic backend URL based on current hostname
        const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`
        const res = await fetch(`${backendUrl}/employee-estate`)
        const json = await res.json()
        if (json.success) {
          setJobTitles(json.data || {})
        }
      } catch (e) {
        console.error("Failed to load job titles", e)
      }
    }
    loadJobTitles()
  }, [])

  const handleJobChange = useCallback((empcode, newVal, rowData) => {
    setJobTitles(prev => ({ ...prev, [empcode]: newVal }))
    setUnsavedJobs(prev => ({
      ...prev,
      [empcode]: {
        empcode: empcode,
        employee_name: rowData.nama,
        gang: rowData.gang_code || finalGangCode, // Fallback if gang not in row
        divisi_id: rowData.divisi_id || finalDivision, // Fallback
        jabatan: newVal
      }
    }))
  }, [finalGangCode, finalDivision])

  const handleSaveJobs = async () => {
    if (Object.keys(unsavedJobs).length === 0) return
    setIsSavingJobs(true)
    try {
      const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`
      const payload = { jobs: Object.values(unsavedJobs) }

      const res = await fetch(`${backendUrl}/employee-estate/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const json = await res.json()
      if (json.success) {
        setUnsavedJobs({})
        alert(`Successfully saved ${json.count} job titles!`)
      } else {
        alert('Failed to save: ' + json.error)
      }
    } catch (e) {
      alert('Error saving jobs: ' + e.message)
    } finally {
      setIsSavingJobs(false)
    }
  }

  const useInfinite = String(finalGangCode).toUpperCase() !== 'ALL'
  const INFINITE_BATCH_SIZE = 200

  const applyComputeToRows = (rows, rules) => {
    if (!Array.isArray(rows)) return []
    return rows
  }

  // Load gangs and divisions (reacts to finalDivision to properly fetch virtual gangs)
  useEffect(() => {
    async function loadFilterData() {
      if (!authToken) return

      try {
        gangFilter.setLoading(true)
        const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`

        // 1. Fetch divisions
        let divisionsList = []
        const divisionsResponse = await fetch(`${backendUrl}/payroll/divisions`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        if (divisionsResponse.ok) {
          divisionsList = await divisionsResponse.json()
          setAllDivisions(divisionsList || [])
        }

        // 2. Fetch gangs specifically for the selected division
        let gangsList = []
        if (finalDivision) {
          const isKeraniUser = (user?.role || '').toLowerCase() === 'kerani'
          const isLockedMode = !user?.isAdmin && !user?.isVisitor && (user?.divisi === finalDivision || isKeraniUser)

          let url = `${backendUrl}/payroll/gangs?division=${finalDivision}&force=true`
          if (isLockedMode) {
            url = `${backendUrl}/payroll/locked/gangs?div=${finalDivision}`
          }

          const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authToken}` }
          })

          if (response.ok) {
            gangsList = await response.json()
          }
        } else {
          // Fallback if no division is selected
          const response = await fetch(`${backendUrl}/payroll/gangs`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
          })
          if (response.ok) gangsList = await response.json()
        }

        setAllGangs(gangsList || [])

        // Set available data in context so GangFilter only shows relevant Sub-Divisions
        gangFilter.setAvailableData({
          gangs: gangsList || [],
          divisions: divisionsList || []
        })

      } catch (error) {
        console.error('Failed to load gangs and divisions:', error)
        gangFilter.setError('Failed to load filter data')
      } finally {
        gangFilter.setLoading(false)
      }
    }

    loadFilterData()
  }, [authToken, finalDivision, user])

  // Load available gangs for the dropdown (filtered by GangFilter UI)
  useEffect(() => {
    if (finalDivision && authToken) {
      // Apply gang filter if active
      let gangsToLoad = allGangs
      if (gangFilter.filters.hasActiveFilter && gangFilter.filters.subDivisions.length > 0) {
        gangsToLoad = gangFilter.getFilteredGangs()
      }
      // Pass objects directly, DO NOT map to strings so ReportToolbar can read g.gang_code and g.description
      setAvailableGangs(gangsToLoad || [])
    } else {
      setAvailableGangs([])
    }
  }, [finalDivision, authToken, allGangs, gangFilter.filters])

  // Helper to calculate total row for a gang - NOW USES BACKEND TOTALS WHEN AVAILABLE
  const calculateTotalRow = useCallback((filteredRows, gang, backendGangTotal = null) => {
    // If backend provides pre-calculated totals, use them directly
    if (backendGangTotal) {
      return {
        ...backendGangTotal,
        isTotal: true,
        gang_code: gang
      };
    }

    // Fallback to frontend calculation if backend total not available
    const agg = (field) => Math.round(filteredRows.reduce((a, b) => a + Number(b[field] || 0), 0))

    // Helper function to aggregate nested other_incomes array
    const aggOtherIncomes = (type) => {
      return filteredRows.reduce((sum, row) => {
        if (row.other_incomes && Array.isArray(row.other_incomes)) {
          const target = String(type || '').toUpperCase();
          row.other_incomes.forEach((oi) => {
            const rawType = String(oi.type || oi.income_type || oi.name || oi.income_name || '').toUpperCase();
            const normalizedType = rawType.includes('EXGRATIA') || rawType.includes('BONUS') ? 'BONUS' : rawType.includes('KONTAN') ? 'KONTAN' : rawType;
            if (normalizedType === target) sum += Number(oi.amount || 0);
          });
        }
        return sum;
      }, 0);
    };

    const totalRow = {
      isTotal: true,
      no: '', jenis_kelamin: '', nik: '', nama: `TOTAL ${gang}`,
      upah_dasar: '', hari_kerja: agg('hari_kerja'), upah_pokok: agg('upah_pokok'),
      cuti_tahunan_hari: agg('cuti_tahunan_hari'), cuti_sakit_haid_hari: agg('cuti_sakit_haid_hari'), cuti_minggu_hari: agg('cuti_minggu_hari'), cuti_nasional_hari: agg('cuti_nasional_hari'), jumlah_hk: agg('jumlah_hk'),
      gaji_pokok: agg('gaji_pokok'), beras_rate: '', beras_jumlah: agg('beras_jumlah'), jabatan_rate: '', jabatan_jumlah: agg('jabatan_jumlah'), masa_kerja_tahun: '', masa_kerja_jumlah: agg('masa_kerja_jumlah'), lembur_jam: '', lembur_jumlah: agg('lembur_jumlah'), total_tunjangan: agg('total_tunjangan'),
      // [DYNAMIC] Pendapatan Lainnya
      pendapatan_thr: Math.round(aggOtherIncomes('THR')),
      pendapatan_bonus: Math.round(aggOtherIncomes('BONUS')),
      pendapatan_kontan: Math.round(aggOtherIncomes('KONTAN')),
      pendapatan_custom: Math.round(aggOtherIncomes('CUSTOM')),
      // Dynamic custom types aggregation
      ...Object.fromEntries(
        customPendapatanTypes.map(t => [`pendapatan_${t.type.toLowerCase()}`, agg(`pendapatan_${t.type.toLowerCase()}`)])
      ),
      pendapatan_lainnya: agg('pendapatan_lainnya'),
      premi_brondol: agg('premi_brondol'), premi_pruning: agg('premi_pruning'), premi_angkut_material: agg('premi_angkut_material'), premi_angkut_tbs: agg('premi_angkut_tbs'), premi_harvesting: agg('premi_harvesting'), premi_harvesting_incentive: agg('premi_harvesting_incentive'), premi_pupuk: agg('premi_pupuk'),
      pot_koreksi: agg('pot_koreksi'),
      total_premi: agg('total_premi'),
      jumlah_upah_kotor: agg('jumlah_upah_kotor'),
      pot_pph21: agg('pot_pph21'), pot_kontan: agg('pot_kontan'), pot_thr: agg('pot_thr'), pot_pinjam: agg('pot_pinjam'), pot_kl: agg('pot_kl'), pot_bpjs_kes: agg('pot_bpjs_kes'),
      pot_astek: agg('pot_astek'), pot_astek_maj: agg('pot_astek_maj'), pot_astek_jumlah: agg('pot_astek_jumlah'),
      pot_bpjs_pek: agg('pot_bpjs_pek'), pot_bpjs_maj: agg('pot_bpjs_maj'),
      pot_bpjs_kesehatan_pekerja: agg('pot_bpjs_kesehatan_pekerja'),
      pot_bpjs_kesehatan_majikan: agg('pot_bpjs_kesehatan_majikan'),
      pot_bpjs_pensiun_pekerja: agg('pot_bpjs_pensiun_pekerja'),
      pot_bpjs_pensiun_majikan: agg('pot_bpjs_pensiun_majikan'),
      pot_bpjs_jumlah: agg('pot_bpjs_jumlah'),
      pot_bpjs_pekerja_total: agg('pot_bpjs_pekerja_total'),
      pot_spsi: agg('pot_spsi'),
      total_potongan: agg('total_potongan'), upah_bersih: agg('upah_bersih')
    }

    // Add dynamic premi fields from nested structure
    if (filteredRows[0]?.premi && typeof filteredRows[0].premi === 'object') {
      Object.keys(filteredRows[0].premi).forEach(key => {
        if (key.startsWith('premi_')) {
          totalRow[`premi.${key}`] = agg(`premi.${key}`)
        }
      })
    }

    return totalRow
  }, [customPendapatanTypes])

  // Helper to update Grand Total incrementally - NOW USES BACKEND TOTALS WHEN AVAILABLE
  const updateGrandTotal = useCallback((allRows, backendGrandTotal = null) => {
    // If backend provides pre-calculated grand total, use it directly
    if (backendGrandTotal) {
      setPinnedBottom([{ ...backendGrandTotal, isGrandTotal: true }]);
      return;
    }

    // Fallback to frontend calculation if backend total not available
    const dataRows = allRows.filter(r => !r.isHeader && !r.isTotal)
    if (dataRows.length === 0) {
      setPinnedBottom([])
      return
    }

    const agg = (field) => Math.round(dataRows.reduce((a, b) => a + Number(b[field] || 0), 0))
    const aggNested = (objProp, key) => Math.round(dataRows.reduce((a, b) => {
      const val = (b[objProp] && b[objProp][key]) ? Number(b[objProp][key]) : 0
      return a + val
    }, 0))

    const aggOtherIncomesGrand = (type) => {
      return dataRows.reduce((sum, row) => {
        if (row.other_incomes && Array.isArray(row.other_incomes)) {
          const target = String(type || '').toUpperCase();
          row.other_incomes.forEach((oi) => {
            const rawType = String(oi.type || oi.income_type || oi.name || oi.income_name || '').toUpperCase();
            const normalizedType = rawType.includes('EXGRATIA') || rawType.includes('BONUS') ? 'BONUS' : rawType.includes('KONTAN') ? 'KONTAN' : rawType;
            if (normalizedType === target) sum += Number(oi.amount || 0);
          });
        }
        return sum;
      }, 0);
    };

    const grand = {
      no: '', jenis_kelamin: '', nik: '', nama: 'GRAND TOTAL',
      upah_dasar: '', hari_kerja: agg('hari_kerja'), upah_pokok: agg('upah_pokok'),
      cuti_tahunan_hari: agg('cuti_tahunan_hari'), cuti_sakit_haid_hari: agg('cuti_sakit_haid_hari'), cuti_minggu_hari: agg('cuti_minggu_hari'), cuti_nasional_hari: agg('cuti_nasional_hari'), jumlah_hk: agg('jumlah_hk'),
      gaji_pokok: agg('gaji_pokok'), beras_rate: '', beras_jumlah: agg('beras_jumlah'), jabatan_rate: '', jabatan_jumlah: agg('jabatan_jumlah'), masa_kerja_tahun: '', masa_kerja_jumlah: agg('masa_kerja_jumlah'), lembur_jam: '', lembur_jumlah: agg('lembur_jumlah'), total_tunjangan: agg('total_tunjangan'),
      pendapatan_thr: Math.round(aggOtherIncomesGrand('THR')),
      pendapatan_bonus: Math.round(aggOtherIncomesGrand('BONUS')),
      pendapatan_kontan: Math.round(aggOtherIncomesGrand('KONTAN')),
      pendapatan_custom: Math.round(aggOtherIncomesGrand('CUSTOM')),
      ...Object.fromEntries(
        customPendapatanTypes.map(t => [`pendapatan_${t.type.toLowerCase()}`, agg(`pendapatan_${t.type.toLowerCase()}`)])
      ),
      pendapatan_lainnya: agg('pendapatan_lainnya'),
      premi_brondol: agg('premi_brondol'), premi_pruning: agg('premi_pruning'), premi_angkut_material: agg('premi_angkut_material'), premi_angkut_tbs: agg('premi_angkut_tbs'), premi_harvesting: agg('premi_harvesting'), premi_harvesting_incentive: agg('premi_harvesting_incentive'), premi_pupuk: agg('premi_pupuk'),
      pot_koreksi: agg('pot_koreksi'),
      total_premi: agg('total_premi'),
      jumlah_upah_kotor: agg('jumlah_upah_kotor'),
      pot_pph21: agg('pot_pph21'), pot_kontan: agg('pot_kontan'), pot_thr: agg('pot_thr'), pot_pinjam: agg('pot_pinjam'), pot_kl: agg('pot_kl'), pot_bpjs_kes: agg('pot_bpjs_kes'),
      pot_astek: agg('pot_astek'), pot_astek_maj: agg('pot_astek_maj'), pot_astek_jumlah: agg('pot_astek_jumlah'),
      pot_bpjs_pek: agg('pot_bpjs_pek'), pot_bpjs_maj: agg('pot_bpjs_maj'),
      pot_bpjs_kesehatan_pekerja: agg('pot_bpjs_kesehatan_pekerja'),
      pot_bpjs_kesehatan_majikan: agg('pot_bpjs_kesehatan_majikan'),
      pot_bpjs_pensiun_pekerja: agg('pot_bpjs_pensiun_pekerja'),
      pot_bpjs_pensiun_majikan: agg('pot_bpjs_pensiun_majikan'),
      pot_bpjs_jumlah: agg('pot_bpjs_jumlah'),
      pot_bpjs_pekerja_total: agg('pot_bpjs_pekerja_total'),
      pot_spsi: agg('pot_spsi'),
      total_potongan: agg('total_potongan'), upah_bersih: agg('upah_bersih'),
      premi: {}
    }

    const premiKeys = new Set()
    dataRows.forEach(r => { if (r.premi) Object.keys(r.premi).forEach(k => premiKeys.add(k)) })
    premiKeys.forEach(k => { grand.premi[k] = aggNested('premi', k) })

    setPinnedBottom([grand])
  }, [customPendapatanTypes])

  // Render Division Incremental Logic with Parallel Server Fetchers
  const renderDivisionIncremental = async (token, division, month, year, gangs) => {
    if (!gangs || gangs.length === 0) {
      setDataReady(true)
      return
    }

    const myRequestId = ++requestIdRef.current;

    try {
      setIsIncrementalLoading(true)
      setLoadProgress({ current: 0, total: gangs.length, status: 'Menyiapkan pemuatan paralel...' })
      
      const resultsMap = new Map();
      let loadedCount = 0;
      const activeGangs = new Set();

      // Group gangs by server profile
      const serverGroups = {};
      gangs.forEach(g => {
        const p = g.server_profile || 'SERVER_PROFILE_1';
        if (!serverGroups[p]) serverGroups[p] = [];
        serverGroups[p].push(g);
      });

      const updateUI = () => {
        if (myRequestId !== requestIdRef.current) return;
        
        // Flatten map to rows, sorted by gang_code
        const sortedGangs = Array.from(resultsMap.keys()).sort();
        const flat = [];
        sortedGangs.forEach(g => {
          const { filtered } = resultsMap.get(g);
          if (filtered.length > 0) {
            flat.push({ isHeader: true, gang_code: g, id: `HEADER_${g}` });
            flat.push(...filtered);
            flat.push(calculateTotalRow(filtered, g));
          }
        });
        
        setRows(flat);
        rowsDataRef.current = flat;
        updateGrandTotal(flat);
        recomputeAutoHideMap(flat);
        
        if (loadedCount > 0 && !dataReady) {
          setDataReady(true);
          setFirstBatchReady(true);
        }
      };

      // Worker for each server group
      const serverWorker = async (profile, groupGangs) => {
        // Process this server in batches of 2 to avoid blocking
        for (let i = 0; i < groupGangs.length; i += 2) {
          if (myRequestId !== requestIdRef.current) return;

          const batch = groupGangs.slice(i, i + 2);
          batch.forEach(g => activeGangs.add(g.gang_code));
          
          setLoadProgress(prev => ({ 
            ...prev, 
            status: activeGangs.size > 0 ? `Aktif: ${Array.from(activeGangs).join(', ')}` : 'Memproses...'
          }));

          const batchResults = await Promise.all(batch.map(g => 
            fetchReportRowsSimple(token, { 
              month, year, gang_code: g.gang_code, division, 
              skip: 0, limit: 2000, use_history: useHistory,
              server_profile: g.server_profile,
              summary_only: 'true'
            }).then(data => ({ gang: g.gang_code, employees: data }))
          ));

          if (myRequestId !== requestIdRef.current) return;

          for (const res of batchResults) {
            const { gang, employees } = res;
            activeGangs.delete(gang);
            loadedCount++;
            
            if (!employees || employees.length === 0) {
              resultsMap.set(gang, { employees: [], filtered: [] });
              continue;
            }

            const computed = applyComputeToRows(employees, computeRulesRef.current);
            const filtered = computed.filter(r => (r.jumlah_hk || 0) > 0).map(slimEmployeeFrontend);
            
            resultsMap.set(gang, { employees, filtered });
          }

          // Batch UI update
          updateUI();

          setLoadProgress(prev => ({ 
            ...prev, 
            current: loadedCount,
            status: activeGangs.size > 0 ? `Aktif: ${Array.from(activeGangs).join(', ')}` : 'Memproses...'
          }));
        }
      };

      // Start all server workers in parallel
      await Promise.all(Object.entries(serverGroups).map(([profile, grp]) => serverWorker(profile, grp)));

      if (myRequestId === requestIdRef.current) {
        setIsIncrementalLoading(false);
        setLoadProgress(prev => ({ ...prev, status: 'Selesai', current: gangs.length }));
        if (typeof onLoad === 'function') onLoad();
      }

    } catch (e) {
      if (myRequestId === requestIdRef.current) {
        console.error("Incremental load error:", e);
        setError("Gagal memuat data secara bertahap");
        setIsIncrementalLoading(false);
      }
    }
  }

  // Column Types Definition
  const columnTypes = useMemo(() => ({
    rightAligned: {
      headerClass: 'ag-right-aligned-header',
      cellStyle: { textAlign: 'right' }
    },
    leftAligned: {
      headerClass: 'ag-left-aligned-header',
      cellStyle: { textAlign: 'left' }
    },
    centerAligned: {
      headerClass: 'ag-center-aligned-header',
      cellStyle: { textAlign: 'center' }
    },
    textColumn: {
      filter: 'agTextColumnFilter',
    },
    numericColumn: {
      filter: 'agNumberColumnFilter',
      type: 'rightAligned'
    }
  }), [])

  const baseCol = useMemo(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 100,
    enableCellTextSelection: true,
    enableRangeSelection: true,
    suppressMenu: true,
    headerClass: 'ag-header-cell-text-bold',
    wrapHeaderText: true,
    autoHeaderHeight: true
  }), [])

  // Debounce ref for selection stats
  const selectionTimeoutRef = useRef(null)

  const onRangeSelectionChanged = useCallback((event) => {
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current)
    }

    selectionTimeoutRef.current = setTimeout(() => {
      const cellRanges = event.api.getCellRanges();
      if (!cellRanges || cellRanges.length === 0) {
        setSelectionStats({ count: 0, sum: 0, average: 0 });
        return;
      }

      let sum = 0;
      let count = 0;

      cellRanges.forEach(range => {
        const startRowIndex = Math.min(range.startRow.rowIndex, range.endRow.rowIndex);
        const endRowIndex = Math.max(range.startRow.rowIndex, range.endRow.rowIndex);

        for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
          const rowNode = event.api.getDisplayedRowAtIndex(rowIndex);
          if (rowNode) {
            range.columns.forEach(column => {
              const value = event.api.getValue(column, rowNode);
              const numValue = Number(value);
              if (!isNaN(numValue) && value !== null && value !== undefined && value !== '') {
                sum += numValue;
                count++;
              }
            });
          }
        }
      });

      setSelectionStats({
        count,
        sum: count > 0 ? sum : 0,
        average: count > 0 ? sum / count : 0
      });
    }, 300);
  }, []);

  const onCellClicked = useCallback((params) => {
    if (params.context.editModeNik && params.colDef.field === 'nik') return; // Do not toggle Row Selection if editing NIK

    if (params.colDef.field === 'nik' || params.colDef.field === 'nama') {
      params.node.setSelected(!params.node.isSelected())
    }
  }, [])

  const rowClassRules = useMemo(() => ({
    'row-odd': params => params.data && !params.data.isHeader && !params.data.isTotal && params.node.rowIndex % 2 === 0,
    'row-even': params => params.data && !params.data.isHeader && !params.data.isTotal && params.node.rowIndex % 2 === 1,
    'grand-total': params => params.node.footer || (params.data && params.data.isTotal),
    'gang-header': params => params.data && params.data.isHeader,
    'row-grand-total': params => params.data && (params.data.isTotal || params.data.nama === 'GRAND TOTAL')
  }), [])

  // 1. Fetch Column Definitions
  useEffect(() => {
    async function loadColumnDefinitions() {
      if (!activeMonth || !activeYear || !finalGangCode) return;

      setLoadingStatus('Loading column definitions...')
      setError('')

      let targetGangCode = finalGangCode
      if (String(finalGangCode).toUpperCase() === 'ALL') {
        targetGangCode = 'H1H'
      }

      try {
        let activeToken = authToken
        if (!activeToken && DEV_MODE) {
          try {
            const res = await login('admin', 'admin')
            setAuthToken(res.access_token)
            activeToken = res.access_token
          } catch (autoErr) { }
        }

        try {
          const cols = await fetchColumnDefinitions(activeToken, activeMonth, activeYear, targetGangCode)
          const normalized = Array.isArray(cols) ? cols : (Array.isArray(cols?.columns) ? cols.columns : [])
          const transformed = removePlaceholderPotonganHeaders(relocateDynamicPotonganHeaders(normalized))
          ensureHierarchicalOrThrow(transformed)
          const enhanced = enhanceColumnsRecursive(transformed, 0)

          // Define frontend sequence column (NO)
          const seqCol = {
            headerName: 'NO',
            field: 'frontend_no',
            width: 50,
            minWidth: 50,
            pinned: 'left',
            type: 'textColumn',
            valueGetter: params => {
              try {
                if (params.data?.nama === 'GRAND TOTAL' || params.data?.isHeader || params.data?.isTotal) return '';
                return params.node.rowIndex + 1
              } catch (e) {
                return ''
              }
            },
            cellStyle: { textAlign: 'center', color: 'var(--text-secondary)' }
          }

          const finalCols = enhanced.map(col => {
            if (col.headerName === 'IDENTITAS' || (col.children && col.children.some(c => c.field === 'nik'))) {
              const kids = col.children || []
              const nikCol = kids.find(c => c.field === 'nik')
              const empCodeCol = kids.find(c => c.field === 'emp_code')
              const namaCol = kids.find(c => c.field === 'nama')
              const lpCol = kids.find(c => c.field === 'jenis_kelamin')

              const usedFields = new Set(['nik', 'nama', 'jenis_kelamin', 'no', 'emp_code'])

              const otherCols = kids.filter(c => !usedFields.has(c.field))

              if (nikCol) {
                nikCol.pinned = 'left';
                nikCol.width = 150;
                nikCol.minWidth = 150;

                // Edit Mode config via context so we don't need to rebuild columns
                nikCol.editable = (params) => params.context.editModeNik;
                nikCol.cellStyle = (params) => {
                  return params.context.editModeNik ? {
                    backgroundColor: '#fffbeb',
                    border: '1px solid #eab308',
                    cursor: 'text'
                  } : {};
                }
                nikCol.valueSetter = (params) => {
                  const newVal = String(params.newValue || '').trim();
                  const oldVal = String(params.oldValue || '').trim();
                  if (newVal !== oldVal) {
                    params.data[params.colDef.field] = newVal;
                    params.context.onNikChange(params.data.emp_code, newVal, oldVal, params.data);
                    return true;
                  }
                  return false;
                };

                // Cell renderer for edit and history button
                nikCol.cellRenderer = (params) => {
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', height: '100%' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{params.value}</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {params.context.editModeNik && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              params.api.startEditingCell({
                                rowIndex: params.node.rowIndex,
                                colKey: params.column.getId()
                              });
                            }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: '12px' }}
                            title="Edit NIK"
                          >
                            ✏️
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); params.context.openNikHistory(params.data.emp_code); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: '12px', opacity: 0.6 }}
                          title="Lihat Riwayat Versi"
                        >
                          ⏱️
                        </button>
                      </div>
                    </div>
                  );
                };
              }

              // Configure emp_code column with default sort
              if (empCodeCol) {
                empCodeCol.width = 100;
                empCodeCol.minWidth = 80;
                empCodeCol.sort = 'asc'; // Default sort by emp_code ascending
              } else {
                // Create emp_code column if it doesn't exist in backend response
                const newEmpCodeCol = {
                  headerName: 'EMP Code',
                  field: 'emp_code',
                  width: 100,
                  minWidth: 80,
                  sort: 'asc', // Default sort by emp_code ascending
                  type: 'textColumn',
                  cellStyle: { textAlign: 'left' }
                };
                // We'll add it manually if backend doesn't provide it
                kids.push(newEmpCodeCol);
              }

              if (namaCol) { 
                namaCol.pinned = 'left'; 
                namaCol.width = 220;
                // Make name column sortable with visual indicator
                namaCol.sortable = true;
              }
              if (lpCol) { lpCol.width = 50; lpCol.minWidth = 50; }

              const newChildren = []
              if (nikCol) newChildren.push(nikCol)
              // Add emp_code column right after nik
              const finalEmpCodeCol = kids.find(c => c.field === 'emp_code')
              if (finalEmpCodeCol) newChildren.push(finalEmpCodeCol)
              if (namaCol) newChildren.push(namaCol)
              newChildren.push({ ...seqCol, pinned: undefined })
              if (lpCol) newChildren.push(lpCol)
              newChildren.push(...otherCols)

              return { ...col, children: newChildren }
            }
            return col
          })

          // --- INJECT JABATAN COLUMN ---
          let injected = false;
          const injectJabatanRecursive = (colsList) => {
            for (let i = 0; i < colsList.length; i++) {
              const c = colsList[i];
              if (c.children) {
                injectJabatanRecursive(c.children);
              } else if (c.field === 'beras_jumlah' || c.field === 'beras_rate' || c.field === 'tunjangan_beras') {
                // Found injection point
                colsList.splice(i, 0, {
                  headerName: 'JABATAN',
                  field: 'jabatan_frontend', // Virtual field
                  width: 110,
                  editable: true,
                  cellEditor: 'agSelectCellEditor',
                  cellEditorParams: {
                    values: ['Karyawan', 'Operator', 'Helper', 'Kerani', 'Mandor']
                  },
                  cellStyle: (params) => {
                    return {
                      backgroundColor: '#fffbeb', // Light yellow to indicate editable
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer'
                    }
                  },
                  valueGetter: (params) => {
                    // Get from local state via context, or default 'Karyawan'
                    if (!params.data || !params.data.nik) return '';
                    return params.context.jobTitles[params.data.nik] || 'Karyawan';
                  },
                  valueSetter: (params) => {
                    const newVal = params.newValue;
                    if (newVal) {
                      params.context.onJobChange(params.data.nik, newVal, params.data);
                      return true;
                    }
                    return false;
                  }
                });
                injected = true;
                // Move index forward to skip the newly added col
                i++;
              }
            }
          }
          injectJabatanRecursive(finalCols);

          setColumnDefs(finalCols)
        } catch (colErr) {
          computeRulesRef.current = {}
          setError('Failed to load column definitions')
        }
      } catch (e) {
        console.error('Failed to initialize column definitions loading:', e)
      } finally {
        setLoadingStatus('Column definitions loaded successfully')
      }
    }

    loadColumnDefinitions()
  }, [authToken, activeMonth, activeYear, finalGangCode])

  // 2. Fetch Data
  useEffect(() => {
    async function run() {
      if (!activeMonth || !activeYear || !finalGangCode) return;
      // Wait for columns to be ready before fetching data to ensure proper rendering
      if (columnDefs.length === 0) return;

      setLoading(true);
      setDataReady(false); // [FIX] Prevent grid mount until data is confirmed ready
      setLoadingStatus('Loading payroll data...')
      setError('')
      try {
        let activeToken = authToken
        if (!activeToken && DEV_MODE) {
          try {
            const res = await login('admin', 'admin')
            setAuthToken(res.access_token)
            activeToken = res.access_token
          } catch (autoErr) { }
        }

        if (String(finalGangCode).toUpperCase() === 'ALL') {
          await renderDivisionIncremental(activeToken, finalDivision, activeMonth, activeYear, allGangs)
        } else {
          const response = await fetchReportRowsSimple(activeToken, { month: activeMonth, year: activeYear, gang_code: finalGangCode, division: finalDivision, skip: 0, limit: INFINITE_BATCH_SIZE, use_history: useHistory }, true)
          
          // Extract data and backend totals from response
          const data = response?.data || response
          const backendGrandTotal = response?.grand_total
          const backendGangs = response?.gangs || []

          // [DEBUG] Log backend totals
          console.log('[Report] Backend totals:', {
            hasGrandTotal: !!backendGrandTotal,
            upah_bersih: backendGrandTotal?.upah_bersih,
            jumlah_upah_kotor: backendGrandTotal?.jumlah_upah_kotor,
            total_potongan: backendGrandTotal?.total_potongan,
            pendapatan_thr: backendGrandTotal?.pendapatan_thr,
            pendapatan_kontan: backendGrandTotal?.pendapatan_kontan,
            pendapatan_lainnya: backendGrandTotal?.pendapatan_lainnya,
            gangsCount: backendGangs?.length || 0
          });

          const computed = applyComputeToRows(data, computeRulesRef.current)
          // [PERATURAN BISNIS - ALWAYS ACTIVE FILTER] Safety net: exclude 0 HK
          const filtered = computed.filter(row => (row.jumlah_hk || 0) > 0).map(slimEmployeeFrontend);

          setRows(filtered)
          const safe = Array.isArray(filtered) ? filtered : []
          rowsDataRef.current = safe // [FIX] Sync to ref so datasource can access synchronously
          recomputeAutoHideMap(safe)
          setInitialRowsPreview(safe.slice(0, INFINITE_BATCH_SIZE))
          setFirstBatchAttempted(true)
          setFirstBatchReady(safe.length > 0)
          setDataReady(true) // [FIX] Data is now confirmed ready - grid can safely render

          // [NEW] Use backend grand total if available, otherwise fallback to frontend calculation
          if (backendGrandTotal) {
            updateGrandTotal(safe, backendGrandTotal)
          } else {
            const agg = (field) => Math.round(safe.reduce((a, b) => a + Number(b[field] || 0), 0))

            // Helper for nested aggregation
            const aggNested = (objProp, key) => Math.round(safe.reduce((a, b) => {
              const val = (b[objProp] && b[objProp][key]) ? Number(b[objProp][key]) : 0
              return a + val
            }, 0))

            // Helper function to aggregate nested other_incomes array for Grand Total
            const aggOtherIncomesGrand = (type) => {
              return safe.reduce((sum, row) => {
                if (row.other_incomes && Array.isArray(row.other_incomes)) {
                  const target = String(type || '').toUpperCase();
                  row.other_incomes.forEach((oi) => {
                    const rawType = String(oi.type || oi.income_type || oi.name || oi.income_name || '').toUpperCase();
                    const normalizedType = rawType.includes('EXGRATIA') || rawType.includes('BONUS') ? 'BONUS' : rawType.includes('KONTAN') ? 'KONTAN' : rawType;
                    if (normalizedType === target) sum += Number(oi.amount || 0);
                  });
                }
                return sum;
              }, 0);
            };

            if (safe.length > 0) {
              const grand = {
                no: '', jenis_kelamin: '', nik: '', nama: 'GRAND TOTAL',
                upah_dasar: '', hari_kerja: agg('hari_kerja'), upah_pokok: agg('upah_pokok'),
                cuti_tahunan_hari: agg('cuti_tahunan_hari'), cuti_sakit_haid_hari: agg('cuti_sakit_haid_hari'), cuti_minggu_hari: agg('cuti_minggu_hari'), cuti_nasional_hari: agg('cuti_nasional_hari'), jumlah_hk: agg('jumlah_hk'),
                gaji_pokok: agg('gaji_pokok'), beras_rate: '', beras_jumlah: agg('beras_jumlah'), jabatan_rate: '', jabatan_jumlah: agg('jabatan_jumlah'), masa_kerja_tahun: '', masa_kerja_jumlah: agg('masa_kerja_jumlah'), lembur_jam: '', lembur_jumlah: agg('lembur_jumlah'), total_tunjangan: agg('total_tunjangan'),
                // [DYNAMIC] Pendapatan Lainnya
                pendapatan_thr: Math.round(aggOtherIncomesGrand('THR')),
                pendapatan_bonus: Math.round(aggOtherIncomesGrand('BONUS')),
                pendapatan_kontan: Math.round(aggOtherIncomesGrand('KONTAN')),
                pendapatan_custom: Math.round(aggOtherIncomesGrand('CUSTOM')),
                // Dynamic custom types aggregation
                ...Object.fromEntries(
                  customPendapatanTypes.map(t => [`pendapatan_${t.type.toLowerCase()}`, agg(`pendapatan_${t.type.toLowerCase()}`)])
                ),
                pendapatan_lainnya: agg('pendapatan_lainnya'),
                premi_brondol: agg('premi_brondol'), premi_pruning: agg('premi_pruning'), premi_angkut_material: agg('premi_angkut_material'), premi_angkut_tbs: agg('premi_angkut_tbs'), premi_harvesting: agg('premi_harvesting'), premi_harvesting_incentive: agg('premi_harvesting_incentive'), premi_pupuk: agg('premi_pupuk'),
                pot_koreksi: agg('pot_koreksi'),
                total_premi: agg('total_premi'),
                jumlah_upah_kotor: agg('jumlah_upah_kotor'),
                pot_pph21: agg('pot_pph21'), pot_kontan: agg('pot_kontan'), pot_thr: agg('pot_thr'), pot_pinjam: agg('pot_pinjam'), pot_kl: agg('pot_kl'), pot_bpjs_kes: agg('pot_bpjs_kes'),
                pot_astek: agg('pot_astek'), pot_astek_maj: agg('pot_astek_maj'), pot_astek_jumlah: agg('pot_astek_jumlah'),
                pot_bpjs_pek: agg('pot_bpjs_pek'), pot_bpjs_maj: agg('pot_bpjs_maj'),
                pot_bpjs_kesehatan_pekerja: agg('pot_bpjs_kesehatan_pekerja'),
                pot_bpjs_kesehatan_majikan: agg('pot_bpjs_kesehatan_majikan'),
                pot_bpjs_pensiun_pekerja: agg('pot_bpjs_pensiun_pekerja'),
                pot_bpjs_pensiun_majikan: agg('pot_bpjs_pensiun_majikan'),
                pot_bpjs_jumlah: agg('pot_bpjs_jumlah'),
                pot_bpjs_pekerja_total: agg('pot_bpjs_pekerja_total'),
                pot_spsi: agg('pot_spsi'),
                total_potongan: agg('total_potongan'), upah_bersih: agg('upah_bersih'),
                premi: {} // Initialize nested premi object
              }

              // Aggregate nested premi fields
              const premiKeys = new Set()
              safe.forEach(r => {
                if (r.premi) Object.keys(r.premi).forEach(k => premiKeys.add(k))
              })

              premiKeys.forEach(k => {
                const val = aggNested('premi', k)
                grand.premi[k] = val
              })

              // Add dynamic potongan from nested structure
              if (safe[0] && safe[0].potongan_upah_kotor && safe[0].potongan_upah_kotor.dynamic) {
                Object.keys(safe[0].potongan_upah_kotor.dynamic).forEach(key => {
                  const f = `potongan_upah_kotor.dynamic.${key}`
                  const sum = agg(f)
                  if (sum > 0) grand[f] = sum
                })
              }
              setPinnedBottom([grand])
            } else {
              setPinnedBottom([])
            }
          }
        }
      } catch (e) {
        setError('Failed to load report data: ' + e.message)
        setRows([])
        setPinnedBottom([])
      } finally {
        setLoading(false)
        setLoadingStatus('')
        if (typeof onLoad === 'function') onLoad()
      }
    }

    // Trigger run when dependencies change
    run()
  }, [authToken, activeMonth, activeYear, finalGangCode, columnDefs, useHistory, customPendapatanTypes, slimEmployeeFrontend])

  useEffect(() => {
    let active = true
      ; (async () => {
        try {
          if (authToken && finalGangCode) {
            if (String(finalGangCode).toUpperCase() === 'ALL') {
              if (active) setGangInfo({ division: finalDivision, description: 'All gangs in division (Incremental)', loc_code: '' })
            } else {
              const info = await fetchGangInfo(authToken, finalGangCode)
              if (active) setGangInfo(info)
            }
          }
        } catch (_) { }
      })()
    return () => { active = false }
  }, [authToken, finalGangCode, finalDivision])

  const removeLeavesBy = (cols, pred) => {
    const removed = []
    const walk = list => {
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]
        if (c && Array.isArray(c.children)) {
          walk(c.children)
          if (c.children.length === 0) list.splice(i, 1)
        } else if (c && pred(c)) {
          removed.push(c)
          list.splice(i, 1)
        }
      }
    }
    const top = Array.isArray(cols) ? cols.slice() : []
    walk(top)
    return { top, removed }
  }
  const relocateDynamicPotonganHeaders = cols => {
    const pred = leaf => {
      const f = String(leaf.field || '')
      const h = String(leaf.headerName || '').toUpperCase().trim()
      if (f.startsWith('pot_dynamic_')) return false // Removed field, skip
      if (f.includes('potongan_upah_kotor.dynamic')) return true
      if (h.startsWith('POT')) return true
      if (h.includes('POTONG')) return true
      return false
    }
    const r = removeLeavesBy(cols, pred)
    if (r.removed.length === 0) return r.top
    const potonganGroupName = 'POTONGAN LAINNYA'
    let attached = false
    for (const g of r.top) {
      if (g && Array.isArray(g.children)) {
        const name = String(g.headerName || '').toUpperCase()
        if (name.includes('POTONGAN')) {
          g.children.push({ headerName: potonganGroupName, children: r.removed })
          attached = true
          break
        }
      }
    }
    if (!attached) {
      r.top.push({ headerName: potonganGroupName, children: r.removed })
    }
    return r.top
  }
  const removePlaceholderPotonganHeaders = cols => {
    const pred = leaf => {
      const f = String(leaf.field || '')
      const h = String(leaf.headerName || '').toUpperCase()
      const isPotTotal = /^pot_total_\d+$/.test(f)
      const isPotonganFamily = h.includes('POTONGAN') || f.startsWith('pot_') || f.includes('potongan_upah_kotor.dynamic')
      const hasTestWord = h.includes('TEST') || h.includes('CONTOH') || h.includes('SAMPLE')
      return isPotTotal || (isPotonganFamily && hasTestWord)
    }
    const r = removeLeavesBy(cols, pred)
    return r.top
  }

  // Enhanced column definitions with proper formatting
  const formatLeaf = useCallback((col) => {
    const cfg = { ...col, ...baseCol }
    const moneyFields = ['upah_dasar', 'upah_pokok', 'gaji_pokok', 'beras_jumlah', 'jabatan_jumlah', 'masa_kerja_jumlah', 'lembur_jumlah', 'total_tunjangan', 'premi_brondol', 'premi_pruning', 'premi_angkut_material', 'premi_angkut_tbs', 'premi_harvesting', 'premi_harvesting_incentive', 'premi_pupuk', 'total_premi', 'jumlah_upah_kotor', 'pot_pph21', 'pot_koreksi', 'total_potongan', 'upah_bersih', 'premi_dynamic_1', 'premi_dynamic_2', 'premi_dynamic_3', 'premi_dynamic_4', 'premi_dynamic_5', 'premi_dynamic_6', 'premi_dynamic_7', 'pot_dynamic_1', 'pot_dynamic_2', 'pot_dynamic_3', 'pot_dynamic_4', 'pot_dynamic_5', 'pot_dynamic_6', 'pot_dynamic_7', 'pot_bpjs_kesehatan_pekerja', 'pot_bpjs_kesehatan_majikan', 'pot_bpjs_pensiun_pekerja', 'pot_bpjs_pensiun_majikan', 'pot_bpjs_pekerja_total', 'pot_spsi', 'pendapatan_thr', 'pendapatan_bonus', 'pendapatan_kontan', 'pendapatan_custom', 'pendapatan_lainnya',
      // Dynamic custom pendapatan types
      ...customPendapatanTypes.map(t => `pendapatan_${t.type.toLowerCase()}`)
    ]
    const intFields = ['no', 'hari_kerja', 'cuti_tahunan_hari', 'cuti_sakit_haid_hari', 'cuti_minggu_hari', 'cuti_nasional_hari', 'tidak_hadir_cth', 'tidak_hadir_alpa', 'jumlah_hk', 'masa_kerja_tahun', 'bunches_total', 'bunches_ripe', 'bunches_unripe', 'bunches_round', 'bunches_transactions']
    const decimalFields = ['lembur_jam']

    // Universal value getter for all field access - handles both flat and nested structures
    const createUniversalValueGetter = (field) => {
      return (params) => {
        const row = params.data;
        if (!row) return 0;

        // Try direct field access first (most common case)
        let value = row[field];
        if (value !== undefined && value !== null && value !== '') {
          return Number(value) || 0;
        }

        // Handle nested object access for dot notation fields (e.g., 'premi.brondol')
        if (field.includes('.')) {
          const [objectName, propertyName] = field.split('.');
          if (row[objectName] && typeof row[objectName] === 'object' && row[objectName][propertyName] !== undefined) {
            return Number(row[objectName][propertyName]) || 0;
          }
        }

        // Handle special cases for premium fields that might be nested
        if (field.startsWith('premi_') && row.premi && typeof row.premi === 'object') {
          const propertyName = field.replace('premi_', '');
          if (row.premi[propertyName] !== undefined) {
            return Number(row.premi[propertyName]) || 0;
          }
        }

        // Handle nested object access for potongan_upah_kotor.dynamic
        if (field.includes('potongan_upah_kotor.dynamic.')) {
          const dynamicKey = field.replace('potongan_upah_kotor.dynamic.', '');
          if (row.potongan_upah_kotor?.dynamic?.[dynamicKey] !== undefined) {
            return Number(row.potongan_upah_kotor.dynamic[dynamicKey]) || 0;
          }
        }

        return 0;
      };
    };

    // Helper function for integer formatting
    const formatInteger = (value) => {
      const v = value
      if (v === null || v === undefined) return ''
      const n = Number(v)
      const iv = isNaN(n) ? 0 : Math.round(n)
      return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(iv)
    }

    // Helper function for decimal formatting (1 decimal place, e.g., 1.5 hours)
    const formatDecimal = (value) => {
      const v = value
      if (v === null || v === undefined) return ''
      const n = Number(v)
      if (isNaN(n)) return ''
      return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)
    }

    // STYLING RULES APPLICATION
    const f = String(cfg.field || '')
    const hdr = String(cfg.headerName || '').toUpperCase()

    // 1. Identitas
    if (['no', 'nik', 'nama', 'jenis_kelamin'].includes(f) || hdr.includes('IDENTITAS')) {
      cfg.headerClass = (cfg.headerClass || '') + ' header-section-identitas'
    }

    // 2. Absensi
    const isAbsensi = f.includes('hari_kerja') || f.includes('cuti_') || f.includes('tidak_hadir') || f.includes('jumlah_hk') || hdr.includes('ABSENSI')
    if (isAbsensi) {
      cfg.headerClass = (cfg.headerClass || '') + ' header-section-absensi'
      if (!['nama', 'nik'].includes(f)) cfg.cellClass = (cfg.cellClass || '') + ' cell-absensi'
    }

    // 3. Income (Upah & Tunjangan)
    const isIncome = hdr.includes('UPAH') || hdr.includes('TUNJANGAN') || f.startsWith('beras_') || f.startsWith('jabatan_') || f.startsWith('masa_kerja_') || f.startsWith('lembur_') || f === 'upah_dasar' || f === 'upah_pokok' || f === 'gaji_pokok'
    if (isIncome) {
      cfg.headerClass = (cfg.headerClass || '') + ' header-section-income'
      if (moneyFields.includes(f)) cfg.cellClass = (cfg.cellClass || '') + ' cell-income cell-accounting'
    }

    // 4. Premi
    const isPremi = hdr.includes('PREMI') || f.startsWith('premi_')
    if (isPremi) {
      cfg.headerClass = (cfg.headerClass || '') + ' header-section-premi'
      if (moneyFields.includes(f)) cfg.cellClass = (cfg.cellClass || '') + ' cell-premi cell-accounting'
    }

    // 5. Deduction (Potongan)
    const isDeduction = hdr.includes('POTONGAN') || hdr.includes('ASTEK') || hdr.includes('BPJS') || f.startsWith('pot_') || f.includes('potongan_upah_kotor.dynamic')
    if (isDeduction) {
      cfg.headerClass = (cfg.headerClass || '') + ' header-section-deduction'
      if (moneyFields.includes(f)) cfg.cellClass = (cfg.cellClass || '') + ' cell-deduction cell-accounting'
    }

    // 6. Net Salary (Special)
    if (f === 'upah_bersih') {
      cfg.headerClass = (cfg.headerClass || '') + ' header-section-net'
      cfg.cellClass = (cfg.cellClass || '') + ' cell-net-salary cell-accounting'
    }

    // 7. Dynamic Pendapatan Lainnya Edit Mode
    const customPendapatanField = f.startsWith('pendapatan_') && !['pendapatan_bonus', 'pendapatan_kontan', 'pendapatan_custom', 'pendapatan_lainnya'].includes(f);
    if (customPendapatanField) {
      const fieldType = f.replace('pendapatan_', '').toUpperCase();
      const typeInfo = (params) => {
        if (fieldType === 'THR') return { type: 'THR', name: 'Tunjangan Hari Raya' };
        return (params.context.customPendapatanTypes || []).find(t => t.type === fieldType);
      }
      cfg.editable = (params) => params.context.editModePendapatan && !!typeInfo(params) && !params.data?.isHeader && !params.data?.isTotal;
      cfg.cellStyle = (params) => {
        if (params.context.editModePendapatan && !!typeInfo(params) && !params.data?.isHeader && !params.data?.isTotal) {
          return {
            backgroundColor: '#ecfdf5',
            border: '1px solid #10b981',
            cursor: 'text',
            textAlign: 'right'
          };
        }
        return { textAlign: 'right' };
      };
      cfg.valueSetter = (params) => {
        const parseSafely = (v) => {
          if (!v) return 0;
          if (typeof v === 'number') return v;
          return parseFloat(String(v).replace(/\./g, '').replace(/,/g, '.')) || 0;
        };
        const newVal = parseSafely(params.newValue);
        const oldVal = parseSafely(params.oldValue);
        if (newVal !== oldVal) {
          params.data[f] = newVal;
          const ti = typeInfo(params);
          if (params.context.onPendapatanChange && ti) {
            params.context.onPendapatanChange(
              params.data.nik,
              params.data.nama,
              params.data.gang_code,
              ti.type,
              ti.name,
              newVal
            );
          }
          return true;
        }
        return false;
      };
      cfg.cellRenderer = (params) => {
        if (params.data?.isHeader || params.data?.isTotal) {
          return params.value ? new Intl.NumberFormat('id-ID').format(Math.round(params.value)) : '';
        }
        const val = Number(params.value) || 0;
        const isEditable = params.context.editModePendapatan && !!typeInfo(params);
        return (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', height: '100%' }}>
            <span style={{ flex: 1, textAlign: 'right' }}>{val ? new Intl.NumberFormat('id-ID').format(Math.round(val)) : '0'}</span>
            {isEditable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  params.api.startEditingCell({
                    rowIndex: params.node.rowIndex,
                    colKey: params.column.getId()
                  });
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: '11px', marginLeft: '4px' }}
                title={`Edit ${(typeInfo(params) || {}).name || fieldType}`}
              >
                ✏️
              </button>
            )}
          </div>
        );
      };
    }

    // Apply universal value getter for all fields that need it
    if (cfg.field && (moneyFields.includes(cfg.field) || intFields.includes(cfg.field) ||
      cfg.field.startsWith('premi_') || cfg.field.includes('potongan_upah_kotor.dynamic') ||
      cfg.field.includes('.'))) {
      if (!cfg.valueGetter) {
        cfg.valueGetter = createUniversalValueGetter(cfg.field)
      }
    }

    // Value Formatting
    if (cfg.field && moneyFields.includes(cfg.field)) {
      cfg.valueFormatter = p => formatInteger(p.value)
      cfg.type = 'rightAligned'
    } else if (cfg.field && intFields.includes(cfg.field)) {
      cfg.valueFormatter = p => formatInteger(p.value)
      cfg.type = 'rightAligned'
    } else if (cfg.field && decimalFields.includes(cfg.field)) {
      cfg.valueFormatter = p => formatDecimal(p.value)
      cfg.type = 'rightAligned'
    } else if (cfg.field && ['nama'].includes(cfg.field)) {
      cfg.cellStyle = { textAlign: 'left', fontWeight: '600' }; cfg.type = 'leftAligned'; cfg.pinned = 'left'
    } else if (cfg.field && ['nik', 'jenis_kelamin'].includes(cfg.field)) {
      cfg.cellStyle = { textAlign: 'center' }; cfg.type = 'centerAligned'
    } else if (cfg.field === 'phone') {
      cfg.hide = true
    } else if (cfg.field) {
      cfg.valueFormatter = p => {
        if (p.value === null || p.value === undefined) return ''
        if (typeof p.value === 'number') return formatInteger(p.value)
        return p.value
      }
    }

    return cfg
  }, [baseCol, customPendapatanTypes])

  const enhanceColumnsRecursive = (cols, depth = 0) => {
    if (!Array.isArray(cols)) return []
    const out = []
    for (const c of cols) {
      if (c.children && Array.isArray(c.children)) {
        const kids = enhanceColumnsRecursive(c.children, depth + 1)
        const visibleKids = kids.filter(k => !k.hide)
        if (visibleKids.length > 0) {
          let headerClass = `hdr-level-${depth + 1}`
          const hdr = String(c.headerName || '').toUpperCase()
          if (hdr.includes('ABSENSI')) headerClass += ' header-section-absensi'
          if (hdr.includes('UPAH') || hdr.includes('TUNJANGAN')) headerClass += ' header-section-income'
          if (hdr.includes('PREMI')) headerClass += ' header-section-premi'
          if (hdr.includes('POTONGAN')) headerClass += ' header-section-deduction'

          out.push({ ...c, children: visibleKids, headerGroupComponent: 'HierHeaderGroup', marryChildren: true, headerClass })
        }
      } else {
        const leaf = formatLeaf(c)
        if (!leaf.hide) out.push(leaf)
      }
    }
    return out
  }

  const ensureHierarchicalOrThrow = (cols) => {
    const arr = Array.isArray(cols) ? cols : []
    const hasGroup = arr.some(c => Array.isArray(c.children) && c.children.length > 0)
  }

  const recomputeAutoHideMap = (dataRows) => {
    try {
      const neverHide = new Set([
        'no', 'nik', 'nama', 'jenis_kelamin', 'upah_bersih', 'jumlah_upah_kotor', 'total_tunjangan', 'total_premi', 'gaji_pokok', 'upah_pokok', 'hari_kerja', 'jumlah_hk',
        'total_potongan', 'pendapatan_thr', 'pendapatan_bonus', 'pendapatan_kontan', 'pendapatan_custom', 'pendapatan_lainnya',
        ...customPendapatanTypes.map(t => `pendapatan_${t.type.toLowerCase()}`)
      ])

      if (dataRows[0]?.potongan_upah_kotor?.dynamic) {
        Object.keys(dataRows[0].potongan_upah_kotor.dynamic).forEach(key => {
          neverHide.add(`potongan_upah_kotor.dynamic.${key}`)
        })
      }
      const fields = new Set()
      for (const r of dataRows || []) Object.keys(r || {}).forEach(f => fields.add(f))
      const m = {}
      for (const f of fields) {
        if (neverHide.has(f)) { m[f] = false; continue }
        let allEmpty = true
        for (const r of dataRows || []) {
          const v = r[f]
          if (v === null || v === undefined) continue
          if (typeof v === 'number') { if (v !== 0) { allEmpty = false; break } }
          else {
            const sv = String(v).trim()
            if (sv !== '' && sv !== '0' && sv !== '0.0') { allEmpty = false; break }
          }
        }
        m[f] = allEmpty
      }
      autoHideMapRef.current = m
    } catch { }
  }

  const handleExportExcel = async () => {
    if (!rows || rows.length === 0) {
      alert('Tidak ada data untuk di-export.');
      return;
    }
    try {
      setIsExporting(true);
      setLoadingStatus('Generating Excel Worksheet in progress...');
      await exportReportToExcelPro(rows, columnDefs, {
        division: finalDivision,
        gangCode: finalGangCode,
        month: activeMonth,
        year: activeYear
      });
    } catch (err) {
      console.error('Failed to export to Excel:', err);
      alert('Gagal membuat file Excel: ' + err.message);
    } finally {
      setIsExporting(false);
      setLoadingStatus('');
    }
  }

  const handleDownloadDaftarUpahExcel = async () => {
    try {
      setIsDownloadingExcel(true);
      const backendUrl = `${window.location.protocol}//${window.location.hostname}:8002`;
      const params = new URLSearchParams({
        month: activeMonth,
        year: activeYear,
        division: finalDivision || 'ALL',
        gang: finalGangCode || 'ALL'
      });
      const res = await fetch(`${backendUrl}/reports/excel?${params}`, {
        headers: { Authorization: authToken ? `Bearer ${authToken}` : '' }
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Daftar_Upah_${finalDivision || 'ALL'}_${finalGangCode || 'ALL'}_${activeMonth}_${activeYear}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download Daftar Upah Excel:', err);
      alert('Gagal mengunduh Daftar Upah Excel: ' + (err.message || 'Unknown error'));
    } finally {
      setIsDownloadingExcel(false);
    }
  };

  const autoSizeAll = () => {
    if (!gridRef.current?.columnApi) return
    const allIds = []
    gridRef.current.columnApi.getColumns().forEach(c => allIds.push(c.getId()))
    gridRef.current.columnApi.autoSizeColumns(allIds)
  }

  if (error) return (
    <DashboardLayout title="Report Error">
      <div className="flex-center" style={{ height: '100%', flexDirection: 'column', color: 'var(--danger-700)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
        <div>{error}</div>
        <button className="btn btn-secondary" onClick={() => window.location.reload()} style={{ marginTop: '1rem' }}>Reload</button>
      </div>
    </DashboardLayout>
  )

  return (
    <DashboardLayout
      title="Daftar Upah Karyawan"
      subtitle={`${(overrideMonth || finalMonth) ? new Date(2000, (overrideMonth || finalMonth) - 1).toLocaleString('id-ID', { month: 'long' }) : '-'} ${(overrideYear || finalYear) || '-'} • Gang ${finalGangCode || '-'}`}
      actions={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <ReportToolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            month={activeMonth}
            year={activeYear}
            division={finalDivision}
            divisions={allDivisions || []}
            gangCode={finalGangCode}
            gangs={availableGangs}
            onMonthYearChange={(m, y) => {
              setRows([])
              setPinnedBottom([])
              setOverrideMonth(m)
              setOverrideYear(y)
              dataInitRef.current = false
            }}
            onDivisionChange={(newDivision) => {
              if (newDivision && newDivision !== finalDivision) {
                setRows([])
                setPinnedBottom([])
                setOverrideDivision(newDivision)
                setOverrideGangCode(null)
                dataInitRef.current = false
              }
            }}
            onGangChange={(newGangCode) => {
              if (newGangCode && newGangCode !== finalGangCode) {
                setRows([])
                setPinnedBottom([])
                setOverrideGangCode(newGangCode)
                dataInitRef.current = false
              }
            }}
            onExport={handleExportExcel}
            onAutoSize={autoSizeAll}
            onBack={onBack}
            disableControls={loading || isExporting}
            editMode={editModeNik}
            onEditModeToggle={() => setEditModeNik(p => !p)}
            useHistory={useHistory}
            onHistoryChange={(val) => {
              setUseHistory(val);
              setRows([]);
              setPinnedBottom([]);
              dataInitRef.current = false;
            }}
            isDownloadingExcel={isDownloadingExcel}
            onDownloadExcel={handleDownloadDaftarUpahExcel}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px', position: 'relative' }}>
            <button
              onClick={() => setEditModePendapatan(p => !p)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: editModePendapatan ? '2px solid #10b981' : '1px solid #d1d5db',
                backgroundColor: editModePendapatan ? '#ecfdf5' : '#fff',
                color: editModePendapatan ? '#065f46' : '#374151',
                cursor: 'pointer',
                fontWeight: editModePendapatan ? '700' : '500',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s'
              }}
              title={editModePendapatan ? 'Nonaktifkan edit Pendapatan Lainnya' : 'Aktifkan edit Pendapatan Lainnya'}
            >
              💰 {editModePendapatan ? 'Pend. Lainnya ON' : 'Pend. Lainnya'}
            </button>
            {editModePendapatan && (
              <button
                onClick={() => setShowAddPendapatanPopup(p => !p)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #10b981',
                  backgroundColor: '#d1fae5',
                  color: '#065f46',
                  cursor: 'pointer',
                  fontWeight: '700',
                  fontSize: '14px',
                  lineHeight: '1'
                }}
                title="Tambah kolom Pendapatan Lainnya baru"
              >
                +
              </button>
            )}
            {editModePendapatan && customPendapatanTypes.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {customPendapatanTypes.map(t => (
                  <span key={t.type} style={{
                    padding: '3px 8px',
                    borderRadius: '12px',
                    backgroundColor: '#d1fae5',
                    color: '#065f46',
                    fontSize: '11px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {t.name}
                    <button
                      onClick={() => handleRemovePendapatanType(t.type)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontSize: '12px', padding: '0', lineHeight: '1' }}
                      title={`Hapus kolom ${t.name}`}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            {showAddPendapatanPopup && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '6px',
                backgroundColor: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                padding: '12px',
                zIndex: 1000,
                minWidth: '220px'
              }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>Tambah Pendapatan Lainnya</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={newPendapatanName}
                    onChange={e => setNewPendapatanName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddPendapatanType(newPendapatanName); }}
                    placeholder="Nama kolom"
                    autoFocus
                    style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '12px' }}
                  />
                  <button onClick={() => handleAddPendapatanType(newPendapatanName)} disabled={!newPendapatanName.trim()} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>Tambah</button>
                </div>
              </div>
            )}
          </div>
        </div>
      }
    >
      <GangFilter
        gangs={gangFilter.availableData.gangs}
        divisions={gangFilter.availableData.divisions}
        selectedFilters={gangFilter.filters}
        onFiltersChange={(filters) => {
          gangFilter.setFilters(filters)
          setRows([])
          setPinnedBottom([])
          dataInitRef.current = false
        }}
        isLoading={gangFilter.isLoading}
      />

      {isIncrementalLoading && (
        <div style={{ padding: '10px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>{loadProgress.status}</span>
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#0f172a' }}>{loadProgress.current} / {loadProgress.total} ({Math.round((loadProgress.current / loadProgress.total) * 100)}%)</span>
          </div>
          <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${(loadProgress.current / loadProgress.total) * 100}%`, height: '100%', backgroundColor: '#3b82f6', transition: 'width 0.3s ease-in-out' }} className="progress-bar-animated" />
          </div>
        </div>
      )}

      {loading && !isIncrementalLoading && (
        <LoadingScreen isLoading={true} message={loadingStatus || 'Memuat data...'} gangCode={finalGangCode} month={activeMonth} year={activeYear} />
      )}

      {viewMode === 'table' ? (
        <React.Fragment>
          {(!loading && dataReady && rows.length === 0 && finalGangCode && !error) ? (
            <div className="flex-center" style={{ height: '300px', flexDirection: 'column' }}>
              <div style={{ fontSize: '3rem' }}>📭</div>
              <h3>Data Belum Tersedia</h3>
            </div>
          ) : dataReady ? (
            <div style={{ flex: 1, width: '100%' }} className="ag-theme-alpine">
              <AgGridReact
                ref={gridRef}
                context={{ jobTitles, onJobChange: handleJobChange, editModeNik, onNikChange: handleNikChange, openNikHistory, editModePendapatan, customPendapatanTypes, onPendapatanChange: handlePendapatanChange }}
                columnDefs={columnDefs}
                rowData={rows}
                columnTypes={columnTypes}
                rowModelType={String(finalGangCode).toUpperCase() === 'ALL' ? 'clientSide' : 'infinite'}
                getRowId={params => params.data?.id || params.data?.nik || params.data?.NIK || params.data?.no}
                defaultColDef={baseCol}
                rowClassRules={rowClassRules}
                pinnedBottomRowData={pinnedBottom}
                rowSelection={'multiple'}
                rowBuffer={20}
                onRangeSelectionChanged={onRangeSelectionChanged}
                onCellClicked={onCellClicked}
                animateRows={true}
                rowHeight={32}
                isFullWidthRow={(params) => params.rowNode.data?.isHeader}
                fullWidthCellRenderer={GangHeaderRenderer}
                onGridReady={params => {
                  if (String(finalGangCode).toUpperCase() !== 'ALL') {
                    const datasource = {
                      getRows: async rq => {
                        const start = rq.startRow
                        const end = rq.endRow
                        let batch = []
                        if (start === 0 && rowsDataRef.current.length > 0) {
                          batch = rowsDataRef.current.slice(0, end - start)
                        } else {
                          batch = await fetchReportRowsBatched(authToken, { month: activeMonth, year: activeYear, gang_code: finalGangCode, division: finalDivision, skip: start, limit: end - start })
                        }
                        if (batch?.length > 0) {
                          const filtered = applyComputeToRows(batch, computeRulesRef.current).filter(row => (row.jumlah_hk || 0) > 0).map(slimEmployeeFrontend);
                          rq.successCallback(filtered, -1)
                        } else rq.successCallback([], 0)
                      }
                    }
                    params.api.setDatasource(datasource)
                  }
                }}
              />
            </div>
          ) : null}

          {Object.keys(pendingNikEdits).length > 0 && (
            <div className="report-save-bar">
              <span>Pending: {Object.keys(pendingNikEdits).length} NIK diubah</span>
              <button className="btn btn-primary" onClick={handleSaveNikEdits}>SIMPAN PERUBAHAN NIK</button>
            </div>
          )}

          {Object.keys(pendingPendapatanEdits).length > 0 && (
            <div className="report-save-bar" style={{ borderColor: '#10b981', backgroundColor: '#ecfdf5' }}>
              <span>Pending: {Object.keys(pendingPendapatanEdits).length} Pendapatan diubah</span>
              <button className="btn btn-primary" onClick={handleSavePendapatanEdits}>SIMPAN PENDAPATAN</button>
            </div>
          )}
        </React.Fragment>
      ) : viewMode === 'attendance' ? (
        <GangAttendanceMatrix token={authToken} gangCodes={matrixGangCodes} month={activeMonth} year={activeYear} division={finalDivision} includeFaceVerification={false} />
      ) : viewMode === 'overtime' ? (
        <GangOvertimeMatrix token={authToken} gangCodes={matrixGangCodes} month={activeMonth} year={activeYear} division={finalDivision} />
      ) : (
        // 'employee' view mode - show simple employee list
        <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👤</div>
          <h3 style={{ color: '#374151' }}>Mode Karyawan</h3>
          <p>Fitur daftar karyawan individu sedang dalam pengembangan.</p>
        </div>
      )}

      <SelectionStats selection={selectionStats} />
    </DashboardLayout>
  )
}

export default function ReportWrapper(props) {
  return <GangFilterProvider><ReportContent {...props} /></GangFilterProvider>
}
