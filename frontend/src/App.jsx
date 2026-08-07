import { useEffect, useState, useMemo, useCallback, lazy, Suspense, memo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ReportProvider, useReport } from './context/ReportContext'
import LoadingScreen from './components/common/LoadingScreen'
import ErrorBoundary from './components/common/ErrorBoundary'
import { isProdMode, getUserDivision, redirectToExternalLogin, buildAppPath, getBasePath } from './utils/prodModeUtils'
import { openEmployeeDetailPage } from './utils/employeeDetailNavigation'
import DashboardLayout from './layouts/DashboardLayout'
import ReportToolbar from './components/common/ReportToolbar'
import './styles/print-overrides.css'

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const VALUE_PRIORITY_MODE_STORAGE_KEY = 'payroll.value_priority_mode';

const normalizeValuePriorityMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'db_ptrj_only') return 'db_ptrj_only';
  return 'non_db_ptrj';
};

const VALUE_PRIORITY_MODE_META = {
  non_db_ptrj: {
    label: 'Non DB_PTRJ: Auto Buffer + Manual Adjustment',
    color: '#16a34a',
    ringColor: '#86efac',
    haloColor: 'rgba(22, 163, 74, 0.18)'
  },
  db_ptrj_only: {
    label: 'DB PTRJ saja',
    color: '#2563eb',
    ringColor: '#93c5fd',
    haloColor: 'rgba(37, 99, 235, 0.18)'
  }
};

// Lazy load pages - TEMPORARILY STATIC
import DashboardHome from './pages/DashboardHome'
import EmployeeDetailRoute from './pages/EmployeeDetailRoute'
import HrInfoRoute from './pages/HrInfoRoute'
import LoginPage from './pages/LoginPage'
import PayslipPrintPage from './pages/PayslipPrintPage'

// Report Pages
import CustomPayrollTable from './components/CustomPayrollTable'
import DbPtrjCompareReportModal from './components/DbPtrjCompareReportModal'
import GangAttendanceMatrix from './components/GangAttendanceMatrix'
import GangOvertimeMatrix from './components/GangOvertimeMatrix'
import GangEmployeeInfo from './components/GangEmployeeInfo'
import EmployeeDirectoryPage from './pages/EmployeeDirectoryAnalytics'
import SummaryReportPage from './pages/SummaryReportPage'
import WagesSummaryRebinmasPage from './pages/WagesSummaryRebinmasPage'
import WagesSummaryIJLPage from './pages/WagesSummaryIJLPage'
import AnalysisReportPage from './pages/AnalysisReportPage'
import AggregationSeederPage from './pages/AggregationSeederPage'
import SpreadsheetSyncPage from './pages/SpreadsheetSyncPage'
import PayrollAnalysisPage from './pages/PayrollAnalysisPage'
import ExecutivePayrollPage from './pages/ExecutivePayrollPage'
import GangComparisonReportPage from './pages/GangComparisonReportPage'
import WagesComparisonPage from './pages/WagesComparisonPage'
import ImpactReportPage from './pages/ImpactReportPage'
import TaxReportPage from './pages/TaxReportPage'
import OtherIncomesPage from './pages/OtherIncomesPage'
import { downloadMonthlyTaxReportExcelFromDOM } from './services/taxReportService'
import { fetchManualEditAllowed } from './services/manualAdjustmentService'
import { appendSnapshotVersionToSearchParams, normalizeSnapshotVersion } from './utils/payrollSnapshotQuery'
import { shouldIgnoreGangPrefixForDivision } from './utils/payrollRequestScope'
import { resolveGangPrefixAfterAvailablePrefixesChange } from './utils/payrollGangPrefixState'
import { getPayrollPeriodMode, resolveEffectiveUseHistoryDb } from './utils/payrollSourceMode'
import { buildPayslipEmployeeRowMap, getEmployeeRows, resolvePayslipEmployeeCodes } from './utils/payrollRowAccessors'
import { buildDbPtrjCompareReport } from './utils/payrollDbPtrjCompareReport'
import { getDaftarUpahDownloadActionCopy } from './utils/payrollDownloadAction'
import ProductivityReportPage from './pages/ProductivityReportPage'
import DetailedSalaryAnalysisPage from './pages/DetailedSalaryAnalysisPage'
import MillProductionReport from './pages/MillProductionReport'
import TonaseAnalysisReportPage from './pages/TonaseAnalysisReportPage'
import CostPerTonStoryPage from './pages/CostPerTonStoryPage'
import SalaryAnalysisPage from './pages/SalaryAnalysisPage'
import UpahBersihDetailPage from './pages/UpahBersihDetailPage'
import DataVerificationPage from './pages/DataVerificationPage'
import HighEarnerReportPage from './pages/HighEarnerReportPage'
import SalaryRangeDetailPage from './pages/SalaryRangeDetailPage'
import ServerMonitor from './components/monitor/ServerMonitor'
import { parseSalaryRangeRouteParams } from './utils/reportRouteParams'

// Development/Test Pages
const ComponentMetadataTestPage = lazy(() => import('./pages/ComponentMetadataTestPage'))

// Wrapper for Operational Report
const OperationalReportWrapper = () => {
  const {
    division, setDivision,
    gang, setGang,
    month, year, setMonth, setYear,
    allDivisions, gangs,
    gangLoading, isAdminUser, isLockedMode, currentPeriod, currentPeriodLoading
  } = useReport();
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [fontSize, setFontSize] = useState(100);
  const [exportHandler, setExportHandler] = useState(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [taxDomExportLoading, setTaxDomExportLoading] = useState(false);
  const [payrollRowsGetter, setPayrollRowsGetter] = useState(null);
  const [dbPtrjCompareReport, setDbPtrjCompareReport] = useState(null);
  const [domPremiKeys, setDomPremiKeys] = useState([]);
  const [payrollDataLoaded, setPayrollDataLoaded] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [manualEditAllowed, setManualEditAllowed] = useState(true);
  const [manualEditBlockReason, setManualEditBlockReason] = useState('');

  // Rule cutoff manual input: jika tanggal hari ini > 3, semua input manual dari mode edit diblok.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchManualEditAllowed(token);
        if (cancelled) return;
        setManualEditAllowed(res?.allowed !== false);
        setManualEditBlockReason(res?.reason || '');
      } catch {
        // Gagal fetch → default izinkan (jangan block user saat API error)
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleToggleEditMode = () => {
    if (!manualEditAllowed) {
      alert(manualEditBlockReason || 'Input manual diblokir: tanggal hari ini > 3.');
      return;
    }
    setIsEditMode(prev => !prev);
  };
  const [useHistoryDb, setUseHistoryDb] = useState(false);
  const [snapshotVersion, setSnapshotVersion] = useState('');
  const [resolvedSnapshotVersion, setResolvedSnapshotVersion] = useState(null);
  const [availableSnapshotVersions, setAvailableSnapshotVersions] = useState([]);
  const [gangPrefix, setGangPrefix] = useState('');
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'attendance' | 'overtime' | 'employee-directory'
  const [hrSearchNik, setHrSearchNik] = useState('');
  const [headerValuePriorityMode, setHeaderValuePriorityMode] = useState(() => {
    try {
      if (typeof window === 'undefined') return 'non_db_ptrj';
      return normalizeValuePriorityMode(localStorage.getItem(VALUE_PRIORITY_MODE_STORAGE_KEY));
    } catch {
      return 'non_db_ptrj';
    }
  });
  const headerValuePriorityMeta = VALUE_PRIORITY_MODE_META[headerValuePriorityMode] || VALUE_PRIORITY_MODE_META.non_db_ptrj;

  // Employee sorting state
  const [employeeSortBy, setEmployeeSortBy] = useState('emp_code'); // 'name' | 'emp_code' | 'nik'
  const [employeeSortOrder, setEmployeeSortOrder] = useState('asc'); // 'asc' | 'desc'

  // Seed data state
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedingStatus, setSeedingStatus] = useState('');

  // Dropdown portal state
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [openActionSubmenu, setOpenActionSubmenu] = useState('downloads');
  const [portalTarget, setPortalTarget] = useState(null);
  const dropdownRef = useRef(null);
  const { isHistoricalPeriod } = useMemo(() => getPayrollPeriodMode({
    month,
    year,
    currentPeriod
  }), [currentPeriod, month, year]);
  const effectiveUseHistoryDb = useMemo(() => resolveEffectiveUseHistoryDb({
    isHistoricalPeriod,
    useHistoryDb
  }), [isHistoricalPeriod, useHistoryDb]);
  const effectiveSnapshotVersion = useMemo(
    () => normalizeSnapshotVersion(snapshotVersion) ?? resolvedSnapshotVersion,
    [snapshotVersion, resolvedSnapshotVersion]
  );

  useEffect(() => {
    setPortalTarget(document.getElementById('header-actions-portal'));
  }, []);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== VALUE_PRIORITY_MODE_STORAGE_KEY) return;
      setHeaderValuePriorityMode(normalizeValuePriorityMode(event.newValue));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsActionsOpen(false);
      }
    };
    if (isActionsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isActionsOpen]);

  useEffect(() => {
    if (isActionsOpen) {
      setOpenActionSubmenu('downloads');
    }
  }, [isActionsOpen]);

  // Using location.pathname as key FORCES remount when navigating, solving 'stuck' UI
  // Note: We return the actual content here, or wrap it.
  
  // Reset gangPrefix when division changes
  useEffect(() => {
    setGangPrefix('');
  }, [division]);

  useEffect(() => {
    setSnapshotVersion('');
    setResolvedSnapshotVersion(null);
    setAvailableSnapshotVersions([]);
    setPayrollDataLoaded(false); // Reset when period changes
    setDomPremiKeys([]); // Clear old premi keys when period changes
  }, [division, month, year, gang, gangPrefix, effectiveUseHistoryDb]);

  // Sync state with global context if props were passed (usually via SummaryReportWrapper style logic)
  // but here it's a direct route component.

  // Helper to extract Group number from gang code
  const getAsistensi = useCallback((gangCode) => {
    if (!gangCode) return null;
    const gc = gangCode.trim().toUpperCase();
    if (gc.startsWith('K2')) return '1';
    const match = gc.match(/\d/);
    return match ? match[0] : null;
  }, []);

  // Filter gangs by group prefix
  const filteredGangs = useMemo(() => {
    if (!gangPrefix || shouldIgnoreGangPrefixForDivision(division)) return gangs;
    return gangs.filter(g => getAsistensi(g.gang_code) === gangPrefix);
  }, [division, gangs, gangPrefix, getAsistensi]);

  // Available asistensi prefixes from loaded gangs
  const availablePrefixes = useMemo(() => {
    if (shouldIgnoreGangPrefixForDivision(division)) return [];
    if (!gangs || gangs.length === 0) return [];
    const prefixes = new Set();
    gangs.forEach(g => {
      const a = getAsistensi(g.gang_code);
      if (a) prefixes.add(a);
    });
    return Array.from(prefixes).sort((a, b) => Number(a) - Number(b));
  }, [division, gangs, getAsistensi]);

  // Keep the selected group unless it is no longer valid for the current division.
  useEffect(() => {
      const nextPrefix = resolveGangPrefixAfterAvailablePrefixesChange({
        division,
        gangPrefix,
        availablePrefixes
      });
      if (gangPrefix !== nextPrefix) {
          setGangPrefix(nextPrefix);
      }
  }, [availablePrefixes, division, gangPrefix, setGangPrefix]);

  // Layout state for selectors
  // If not admin and locked mode, division is read-only
  const canChangeDivision = isAdminUser || !isLockedMode;

  const handleFontIncrease = () => setFontSize(prev => Math.min(prev + 10, 150))
  const handleFontDecrease = () => setFontSize(prev => Math.max(prev - 10, 60))
  const handleFontReset = () => setFontSize(100)
  
  const handleEmployeeSort = (field) => {
    if (employeeSortBy === field) {
      setEmployeeSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setEmployeeSortBy(field)
      setEmployeeSortOrder('asc')
    }
  }

  const handlePayrollDataLoaded = useCallback((payload) => {
    setDomPremiKeys(payload?.dynamic_premi_headers || [])
    setPayrollDataLoaded(true) // Mark that payroll data has been loaded
    const meta = payload?.meta || {}
    setResolvedSnapshotVersion(meta.snapshot_version ?? null)
    setAvailableSnapshotVersions(Array.isArray(meta.available_snapshot_versions) ? meta.available_snapshot_versions : [])
  }, [])

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

  const handleExportTaxExcelDom = async () => {
    const rows = payrollRowsGetter ? payrollRowsGetter() : []
    const domEmployeesData = getEmployeeRows(rows)
    console.log('[handleExportTaxExcelDom] payrollRowsGetter is:', payrollRowsGetter ? 'SET' : 'NULL');
    console.log('[handleExportTaxExcelDom] payrollDataLoaded:', payrollDataLoaded);
    console.log('[handleExportTaxExcelDom] raw rows:', rows?.length || 0, 'employees:', domEmployeesData?.length || 0);

    // Validate that data is ready
    if (!payrollDataLoaded) {
      alert('Data masih dimuat. Silakan tunggu hingga data selesai dimuat.');
      return;
    }

    if (!domEmployeesData || domEmployeesData.length === 0) {
      alert('Data Daftar Upah belum siap atau kosong. Pastikan data sudah tampil di tabel.');
      return;
    }

    setTaxDomExportLoading(true);
    try {
      console.log('[handleExportTaxExcelDom] Calling downloadMonthlyTaxReportExcelFromDOM with', domEmployeesData.length, 'employees')
      // Debug: log first employee structure
      console.log('[handleExportTaxExcelDom] First employee:', JSON.stringify(domEmployeesData[0]).substring(0, 800));
      await downloadMonthlyTaxReportExcelFromDOM(token, year, month, division, gang, gangPrefix, domEmployeesData, domPremiKeys);
      console.log('[handleExportTaxExcelDom] Export completed successfully');
    } catch (err) {
      console.error('[handleExportTaxExcelDom] Export failed:', err);
      alert('Gagal mengunduh pajak DOM: ' + (err.message || 'Unknown error'));
    } finally {
      setTaxDomExportLoading(false);
    }
  }

  const handleOpenDbPtrjCompareReport = useCallback(() => {
    const rows = payrollRowsGetter ? payrollRowsGetter() : [];
    const report = buildDbPtrjCompareReport(rows);
    setDbPtrjCompareReport({
      ...report,
      division,
      gang,
      gangPrefix,
      month,
      year,
      generatedAt: new Date().toISOString()
    });
    setIsActionsOpen(false);
  }, [division, gang, gangPrefix, month, payrollRowsGetter, year]);

  const handleOpenTaxReport = () => {
    const params = new URLSearchParams({
      division: division || '',
      month: String(month),
      year: String(year),
      gang: gang || '',
      gangPrefix: gangPrefix || '',
      use_history: effectiveUseHistoryDb ? 'true' : 'false',
      value_priority_mode: headerValuePriorityMode
    });
    appendSnapshotVersionToSearchParams(params, effectiveSnapshotVersion)
    const taxPath = buildAppPath(`/report-pajak?${params.toString()}`);
    window.open(taxPath, '_blank', 'noopener,noreferrer');
  }

  const handleToggleEmployeeSelection = (nik) => {
    setSelectedEmployees(prev => {
      if (prev.includes(nik)) {
        return prev.filter(code => code !== nik);
      } else {
        return [...prev, nik];
      }
    });
  };

  const handleSelectAllEmployees = (employeeNikList) => {
    setSelectedEmployees(employeeNikList);
  };

  const handleClearSelection = () => {
    setSelectedEmployees([]);
  };

  const handlePrintPayslips = () => {
    const rows = payrollRowsGetter ? payrollRowsGetter() : [];
    const employeeCodes = resolvePayslipEmployeeCodes(selectedEmployees, rows);

    if (employeeCodes.length === 0) {
      alert('Data karyawan belum siap atau kosong untuk cetak slip gaji.');
      return;
    }

    const params = new URLSearchParams({
      emp_codes: employeeCodes.join(','),
      month: month,
      year: year,
      division: division,
      use_history: effectiveUseHistoryDb ? 'true' : 'false'
    });
    appendSnapshotVersionToSearchParams(params, effectiveSnapshotVersion)

    const currentPayslipRows = buildPayslipEmployeeRowMap(rows, selectedEmployees);
    if (Object.keys(currentPayslipRows).length > 0) {
      const dataKey = `payslip-print-${division || 'all'}-${year}-${month}-${Date.now()}`;
      const payload = JSON.stringify(currentPayslipRows);
      try {
        sessionStorage.setItem(dataKey, payload);
      } catch (err) {
        console.warn('[OperationalReport] Failed to save payslip data to sessionStorage:', err);
      }
      try {
        localStorage.setItem(dataKey, payload);
      } catch (err) {
        console.warn('[OperationalReport] Failed to save payslip data to localStorage:', err);
      }
      params.set('data_key', dataKey);
    }

    const printPath = buildAppPath(`/payslip-print?${params.toString()}`);
    window.open(printPath, '_blank', 'noopener,noreferrer');
  };

  const handleViewEmployeeDetail = (employeeData) => {
    console.log('[OperationalReport] Opening detail tab for employee:', employeeData)

    const detailPath = openEmployeeDetailPage({
      employeeData,
      month,
      year,
      division,
      useHistoryDb: effectiveUseHistoryDb,
      snapshotVersion: effectiveSnapshotVersion
    })

    if (!detailPath) {
      console.error('[OperationalReport] Cannot view detail: emp_code is missing', employeeData)
    }
  }

  const handleOpenHrProfile = (employeeData) => {
    console.log('[OperationalReport] Context Menu: Opening HR Profile tab for employee:', employeeData);
    const empCode = employeeData.emp_code || employeeData.EmpCode || employeeData.nik || employeeData.NIK;
    if (empCode) {
        const params = new URLSearchParams({ nik: empCode });
        const hrPath = buildAppPath(`/hr-info?${params.toString()}`);
        window.open(hrPath, '_blank', 'noopener,noreferrer');
    } else {
        console.error('[OperationalReport] Cannot view HR Profile: emp_code is missing');
    }
  };

  // Seed data handler
  const handleSeedData = async () => {
    if (!token) return
    if (!window.confirm(`Seed data PERSIS seperti yang tampil di UI untuk ${MONTHS[month-1]} ${year}?`)) return

    setIsSeeding(true)
    setSeedingStatus('Extracting data from UI...')

    try {
      const response = await fetch('/payroll/aggregation/seed-ui', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          division: division || 'ALL',
          month,
          year,
          gangCode: gang || null,
          gangPrefix: gangPrefix || null
        })
      })

      const result = await response.json()

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

  // Generate last 3 months for quick select
  const previousPeriods = useMemo(() => {
    const periods = [];
    const currentDate = new Date(year, month - 1, 1); // month is 1-indexed in our state

    for (let i = 1; i <= 3; i++) {
      const prevDate = new Date(currentDate);
      prevDate.setMonth(currentDate.getMonth() - i);
      periods.push({
        month: prevDate.getMonth() + 1, // 1-indexed
        year: prevDate.getFullYear(),
        label: prevDate.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
      });
    }
    return periods;
  }, [month, year]);
  const isDbPtrjCompareDisabled = viewMode !== 'table' || !payrollRowsGetter;
  const displayedPayslipEmployeeCodes = useMemo(() => {
    if (!payrollRowsGetter) return [];
    try {
      return resolvePayslipEmployeeCodes([], payrollRowsGetter());
    } catch {
      return [];
    }
  }, [payrollRowsGetter]);
  const payslipEmployeeCount = selectedEmployees.length > 0
    ? selectedEmployees.length
    : displayedPayslipEmployeeCodes.length;
  const payslipActionLabel = selectedEmployees.length > 0
    ? `Slip Gaji (${selectedEmployees.length})`
    : (displayedPayslipEmployeeCodes.length > 0 ? `Slip Gaji (Semua ${displayedPayslipEmployeeCodes.length})` : 'Slip Gaji');
  const payslipActionTitle = selectedEmployees.length > 0
    ? `Cetak slip gaji ${selectedEmployees.length} karyawan terpilih`
    : (displayedPayslipEmployeeCodes.length > 0
      ? `Cetak slip gaji semua ${displayedPayslipEmployeeCodes.length} karyawan yang tampil`
      : 'Data karyawan belum siap untuk cetak slip gaji');
  const actionMenuTone = (tone) => {
    const tones = {
      navy: { bg: '#f8fafc', text: '#1f3a5f', border: '#c8d2dc', badge: '#1f3a5f' },
      green: { bg: '#f3faf8', text: '#285c4d', border: '#b9cdc8', badge: '#2f5d50' },
      red: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', badge: '#b91c1c' },
      purple: { bg: '#faf5ff', text: '#6b21a8', border: '#d8b4fe', badge: '#6b21a8' },
      amber: { bg: '#fffbeb', text: '#92400e', border: '#fde68a', badge: '#92400e' },
      slate: { bg: '#f8fafc', text: '#334155', border: '#e2e8f0', badge: '#475569' }
    };
    return tones[tone] || tones.slate;
  };
  const actionMenuItemStyle = (enabled, tone = 'slate') => {
    const colors = actionMenuTone(tone);
    return {
      textAlign: 'left',
      padding: '0.62rem 0.7rem',
      borderRadius: '8px',
      border: enabled ? `1px solid ${colors.border}` : '1px solid #d1d5db',
      background: enabled ? colors.bg : '#f1f5f9',
      color: enabled ? colors.text : '#94a3b8',
      cursor: enabled ? 'pointer' : 'not-allowed',
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      fontWeight: 800,
      boxShadow: enabled ? '0 6px 14px rgba(15, 23, 42, 0.08)' : 'none'
    };
  };
  const actionMenuBadgeStyle = (enabled, tone = 'slate') => {
    const colors = actionMenuTone(tone);
    return {
      minWidth: 30,
      height: 24,
      borderRadius: '6px',
      background: enabled ? colors.badge : '#e5e7eb',
      color: enabled ? '#ffffff' : '#9ca3af',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      fontSize: '0.68rem',
      fontWeight: 900
    };
  };
  const actionSubmenuToggleStyle = (active) => ({
    width: '100%',
    border: 'none',
    borderRadius: '8px',
    padding: '0.58rem 0.65rem',
    background: active ? '#e2e8f0' : '#f8fafc',
    color: '#0f172a',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontWeight: 900,
    fontSize: '0.78rem',
    letterSpacing: '0.02em'
  });

  if (!division) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
        <h3>Belum ada divisi yang dipilih</h3>
        <p>Silakan kembali ke <a href="/" style={{ color: '#3b82f6', textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); navigate('/'); }}>Dashboard</a>.</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {dbPtrjCompareReport && (
        <DbPtrjCompareReportModal
          report={dbPtrjCompareReport}
          onClose={() => setDbPtrjCompareReport(null)}
        />
      )}

      {/* Seeding Status Indicator (Only renders when seeding is active) */}
      {seedingStatus && (
        <div style={{
          padding: '0 1.25rem',
          borderBottom: '1px solid #e2e8f0',
          background: 'linear-gradient(to bottom, #ffffff, #f8fafc)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
          flexShrink: 0
        }}>
          <div style={{
            padding: '0.5rem 0',
            backgroundColor: seedingStatus.includes('Success') || seedingStatus.includes('berhasil') ? '#d1fae5' : seedingStatus.includes('Error') || seedingStatus.includes('Gagal') ? '#fee2e2' : '#fef3c7',
            borderBottom: `1px solid ${seedingStatus.includes('Success') || seedingStatus.includes('berhasil') ? '#10b981' : seedingStatus.includes('Error') || seedingStatus.includes('Gagal') ? '#ef4444' : '#f59e0b'}`,
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
        </div>
      )}

        {/* Filter Bar Portaled into TopBar */}
        {portalTarget && createPortal(
        <>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'nowrap',
        }}>
          {/* Left: View Mode & Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => navigate('/')}
              style={{
                background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', color: '#f1f5f9',
                display: 'flex', alignItems: 'center', padding: '4px', borderRadius: '4px'
              }}
              title="Kembali"
              onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'; }}
              onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'; }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            
            {/* View Mode Dropdown */}
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
              style={{
                height: '32px',
                padding: '0 30px 0 10px',
                border: '1px solid #dee2e6',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                color: '#1e3a5f',
                backgroundColor: '#f8f9fa',
                cursor: 'pointer',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%231e3a5f' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                backgroundPosition: 'right 0.5rem center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '1em'
              }}
            >
              <option value="table">💰 Daftar Upah</option>
              <option value="attendance">📅 Absensi</option>
              <option value="overtime">⏰ Lembur</option>
              <option value="employee-directory">👥 Info Karyawan</option>
            </select>
          </div>

          {/* Center: Inline Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, justifyContent: 'center' }}>
            <select value={division} onChange={(e) => canChangeDivision && setDivision(e.target.value)} disabled={!canChangeDivision} style={{ height: '30px', padding: '0 24px 0 8px', border: '1px solid #dee2e6', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: !canChangeDivision ? '#e9ecef' : 'white', cursor: !canChangeDivision ? 'not-allowed' : 'pointer', fontWeight: '500', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.3rem center', backgroundRepeat: 'no-repeat', backgroundSize: '0.8em' }}>
              {allDivisions.map(d => (<option key={d} value={d}>{d}</option>))}
            </select>

            {availablePrefixes.length > 0 && (
              <select value={gangPrefix} onChange={(e) => { setGangPrefix(e.target.value); setGang('ALL'); }} style={{ height: '30px', padding: '0 24px 0 8px', border: `1px solid ${gangPrefix ? '#1e3a5f' : '#dee2e6'}`, borderRadius: '4px', fontSize: '0.8rem', backgroundColor: gangPrefix ? '#f8f9fa' : 'white', color: gangPrefix ? '#1e3a5f' : '#212529', cursor: 'pointer', fontWeight: gangPrefix ? '600' : '500', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.3rem center', backgroundRepeat: 'no-repeat', backgroundSize: '0.8em' }}>
                <option value="">Semua Group</option>
                {availablePrefixes.map(prefix => (<option key={prefix} value={prefix}>Group {prefix}</option>))}
              </select>
            )}

            <select value={gang || ""} onChange={(e) => { const v = e.target.value; setGang(v); if (v !== 'ALL') setGangPrefix(getAsistensi(v) || ''); }} disabled={gangLoading} style={{ height: '30px', padding: '0 24px 0 8px', border: `1px solid ${gang && gang !== 'ALL' ? '#2d6a4f' : '#dee2e6'}`, borderRadius: '4px', fontSize: '0.8rem', backgroundColor: gangLoading ? '#e9ecef' : (gang && gang !== 'ALL' ? '#d4edda' : 'white'), color: gang && gang !== 'ALL' ? '#155724' : '#212529', cursor: gangLoading ? 'wait' : 'pointer', fontWeight: gang && gang !== 'ALL' ? '600' : '500', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.3rem center', backgroundRepeat: 'no-repeat', backgroundSize: '0.8em', maxWidth: '180px' }}>
              {gangLoading ? <option>Memuat...</option> : (
                <>
                  <option value="ALL">🌐 Semua Kemandoran</option>
                  {filteredGangs.map(g => (<option key={g.gang_code} value={g.gang_code}>{g.gang_code} — {g.description || '-'}</option>))}
                </>
              )}
            </select>

            <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} style={{ height: '30px', padding: '0 24px 0 8px', border: '1px solid #dee2e6', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'white', cursor: 'pointer', fontWeight: '500', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.3rem center', backgroundRepeat: 'no-repeat', backgroundSize: '0.8em' }}>
              {['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'].map((name, i) => (<option key={i+1} value={i+1}>{name}</option>))}
            </select>

            <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} style={{ height: '30px', padding: '0 24px 0 8px', border: '1px solid #dee2e6', borderRadius: '4px', fontSize: '0.8rem', backgroundColor: 'white', cursor: 'pointer', fontWeight: '500', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.3rem center', backgroundRepeat: 'no-repeat', backgroundSize: '0.8em' }}>
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (<option key={y} value={y}>{y}</option>))}
            </select>
          </div>

          {/* Right: Highlighted Edit Button */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              onClick={handleToggleEditMode}
              disabled={!manualEditAllowed}
              title={manualEditAllowed ? (isEditMode ? "Matikan Edit Mode" : "Aktifkan Edit Mode (Data Tabel)") : (manualEditBlockReason || "Input manual diblokir")}
              style={{
                height: '32px',
                padding: '0 16px',
                backgroundColor: isEditMode ? '#d97706' : (manualEditAllowed ? 'rgba(245, 158, 11, 0.1)' : 'rgba(108, 117, 125, 0.1)'),
                color: isEditMode ? '#ffffff' : (manualEditAllowed ? '#f59e0b' : '#adb5bd'),
                border: `1px solid ${isEditMode ? '#b45309' : (manualEditAllowed ? '#f59e0b' : '#ced4da')}`,
                borderRadius: '6px',
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: manualEditAllowed ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
                boxShadow: isEditMode ? '0 2px 4px rgba(217, 119, 6, 0.3)' : 'none'
              }}
            >
              <span>{isEditMode ? '🔓' : '✏️'}</span>
              {isEditMode ? 'Edit Aktif' : (manualEditAllowed ? 'Mode Edit' : 'Edit Diblokir')}
            </button>
          </div>
        </div>

        {/* Action Buttons (Hidden Dropdown items that render in TopBar) */}
          {viewMode === 'table' && (
            <span
              title={`Sumber Nilai Aktif: ${headerValuePriorityMeta.label}`}
              aria-label={`Sumber Nilai Aktif: ${headerValuePriorityMeta.label}`}
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '999px',
                border: '2px solid #ffffff',
                backgroundColor: headerValuePriorityMeta.color,
                boxShadow: `0 0 0 1px ${headerValuePriorityMeta.ringColor}, 0 0 0 4px ${headerValuePriorityMeta.haloColor}`,
                marginRight: '8px',
                flexShrink: 0
              }}
            />
          )}
          <div style={{ position: 'relative', zIndex: 220 }} ref={dropdownRef}>
            <button
              onClick={() => setIsActionsOpen(!isActionsOpen)}
              style={{
                padding: '0.4rem 0.85rem',
                backgroundColor: isActionsOpen ? '#1e293b' : 'transparent',
                color: isActionsOpen ? '#f1f5f9' : '#94a3b8',
                border: `1px solid ${isActionsOpen ? '#334155' : 'transparent'}`,
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s'
              }}
              onMouseOver={(e) => {
                if (!isActionsOpen) {
                  e.currentTarget.style.backgroundColor = '#1e293b';
                  e.currentTarget.style.color = '#f1f5f9';
                }
              }}
              onMouseOut={(e) => {
                if (!isActionsOpen) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#94a3b8';
                }
              }}
              title="Toolbar Actions"
            >
              🛠️ Actions ▾
            </button>
            
            {isActionsOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '0.5rem',
                backgroundColor: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                padding: '0.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                zIndex: 240,
                minWidth: '260px'
              }}>
                <button
                  onClick={() => setOpenActionSubmenu(openActionSubmenu === 'downloads' ? '' : 'downloads')}
                  style={actionSubmenuToggleStyle(openActionSubmenu === 'downloads')}
                  title="Tampilkan submenu unduh"
                >
                  <span>UNDUH</span>
                  <span>{openActionSubmenu === 'downloads' ? 'v' : '>'}</span>
                </button>

                {openActionSubmenu === 'downloads' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0 6px 8px', borderLeft: '2px solid #e2e8f0' }}>
                    <button
                      onClick={handleExportTaxExcelDom}
                      disabled={taxDomExportLoading || !payrollDataLoaded}
                      style={actionMenuItemStyle(payrollDataLoaded && !taxDomExportLoading, 'navy')}
                      title={!payrollDataLoaded ? 'Tunggu data selesai dimuat terlebih dahulu' : 'Unduh report pajak akunting dari data yang tampil di Daftar Upah'}
                    >
                      <span style={actionMenuBadgeStyle(payrollDataLoaded && !taxDomExportLoading, 'navy')}>TAX</span>
                      <span>{taxDomExportLoading ? 'Mengunduh Report...' : (!payrollDataLoaded ? 'Memuat Data...' : 'Unduh Report Pajak')}</span>
                    </button>

                    <button
                      onClick={handleExportExcel}
                      disabled={!exportHandler || exportLoading}
                      style={actionMenuItemStyle(Boolean(exportHandler) && !exportLoading, 'green')}
                      title={daftarUpahDownloadAction.title}
                    >
                      <span style={actionMenuBadgeStyle(Boolean(exportHandler) && !exportLoading, 'green')}>{daftarUpahDownloadAction.icon}</span>
                      <span>{daftarUpahDownloadAction.label}</span>
                    </button>
                  </div>
                )}

                <button
                  onClick={handlePrintPayslips}
                  disabled={payslipEmployeeCount === 0}
                  style={actionMenuItemStyle(payslipEmployeeCount > 0, 'navy')}
                  title={payslipActionTitle}
                >
                  <span style={actionMenuBadgeStyle(payslipEmployeeCount > 0, 'navy')}>SLIP</span>
                  <span>{payslipActionLabel}</span>
                </button>

                <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>

                <button
                  onClick={() => setOpenActionSubmenu(openActionSubmenu === 'settings' ? '' : 'settings')}
                  style={actionSubmenuToggleStyle(openActionSubmenu === 'settings')}
                  title="Tampilkan submenu pengaturan"
                >
                  <span>PENGATURAN</span>
                  <span>{openActionSubmenu === 'settings' ? 'v' : '>'}</span>
                </button>

                {openActionSubmenu === 'settings' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0 0 8px', borderLeft: '2px solid #e2e8f0' }}>
                <button onClick={handleSeedData} disabled={isSeeding} style={{ textAlign: 'left', padding: '0.5rem', borderRadius: '4px', border: 'none', background: isSeeding ? '#fef3c7' : 'transparent', color: isSeeding ? '#92400e' : '#334155', cursor: isSeeding ? 'wait' : 'pointer', display: 'flex', gap: '8px', alignItems: 'center' }} title="Memuat Ulang / Seed Data Sesuai Pilihan Layar">
                  {isSeeding ? '⏳ Seeding...' : '🌱 Seed Data UI'}
                </button>
                
                {/* Column Toggles Portal Target */}
                <div id="column-toggles-portal"></div>
                
                {/* DB Mode Toggle */}
                <button
                  onClick={() => {
                    if (!isHistoricalPeriod) {
                      setUseHistoryDb(!useHistoryDb);
                    }
                  }}
                  disabled={isHistoricalPeriod}
                  style={{
                    textAlign: 'left',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: 'none',
                    background: effectiveUseHistoryDb ? '#f3e8ff' : 'transparent',
                    color: effectiveUseHistoryDb ? '#6b21a8' : '#334155',
                    cursor: isHistoricalPeriod ? 'default' : 'pointer',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    opacity: isHistoricalPeriod ? 0.9 : 1
                  }}
                  title={isHistoricalPeriod ? 'Periode historis otomatis memakai History DB' : 'Ganti antara Database History & Origin'}
                >
                  {isHistoricalPeriod ? '📚 Mode: History DB (Auto)' : (effectiveUseHistoryDb ? '📚 Mode: History DB' : '⚡ Mode: Origin DB')}
                </button>

                {effectiveUseHistoryDb && (
                  <div style={{ padding: '0.35rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.75rem', color: '#6b7280' }}>Snapshot Version</label>
                    <select
                      value={snapshotVersion}
                      onChange={(e) => setSnapshotVersion(e.target.value)}
                      style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #d8b4fe', background: '#faf5ff', color: '#581c87' }}
                    >
                      <option value="">
                        {resolvedSnapshotVersion ? `Latest (v${resolvedSnapshotVersion})` : 'Latest snapshot'}
                      </option>
                      {availableSnapshotVersions.map((version) => (
                        <option key={version} value={String(version)}>
                          {`Version ${version}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={handleOpenDbPtrjCompareReport}
                  disabled={isDbPtrjCompareDisabled}
                  style={{
                    textAlign: 'left',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: 'none',
                    background: isDbPtrjCompareDisabled ? 'transparent' : '#fef2f2',
                    color: isDbPtrjCompareDisabled ? '#94a3b8' : '#b91c1c',
                    cursor: isDbPtrjCompareDisabled ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    fontWeight: 700
                  }}
                  title="Bandingkan nilai active/backend dengan nilai asli DB_PTRJ pada baris yang sedang tampil"
                >
                  Compare DB_PTRJ
                </button>
                
                <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>
                
                {/* Font Controls */}
                <div style={{ display: 'flex', padding: '0.2rem', gap: '4px' }}>
                  <button onClick={handleFontDecrease} style={{ flex: 1, padding: '0.4rem', background: '#f1f5f9', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }} title="Perkecil Text">A-</button>
                  <button onClick={handleFontReset} style={{ flex: 1, padding: '0.4rem', background: '#f1f5f9', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }} title="Reset Text">Reset</button>
                  <button onClick={handleFontIncrease} style={{ flex: 1, padding: '0.4rem', background: '#f1f5f9', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }} title="Perbesar Text">A+</button>
                </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </>, portalTarget)}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {viewMode === 'table' ? (
          <CustomPayrollTable
            token={token}
            division={division}
            gangCode={gang}
            month={month}
            year={year}
            fontSize={fontSize}
            onExportReady={setExportHandler}
            onViewEmployeeDetail={handleViewEmployeeDetail}
            onOpenHrProfile={handleOpenHrProfile}
            selectedEmployees={selectedEmployees}
            onToggleEmployeeSelection={handleToggleEmployeeSelection}
            onSelectAllEmployees={handleSelectAllEmployees}
            onDataLoaded={handlePayrollDataLoaded}
            onRowsGetterReady={(getter) => setPayrollRowsGetter(() => getter)}
            onValuePriorityModeResolved={setHeaderValuePriorityMode}
            isEditMode={isEditMode}
            useHistoryDb={effectiveUseHistoryDb}
            snapshotVersion={snapshotVersion}
            gangPrefix={gangPrefix || null}
            gangLoading={gangLoading}
            currentPeriodLoading={currentPeriodLoading}
            sortBy={employeeSortBy}
            sortOrder={employeeSortOrder}
            onSortChange={handleEmployeeSort}
          />
        ) : viewMode === 'employee-directory' ? (
          <GangEmployeeInfo
            token={token}
            gangCodes={gang === 'ALL' ? (filteredGangs.length > 0 ? filteredGangs : gangs).map(g => g.gang_code) : [gang]}
            month={month}
            year={year}
            division={division}
            onViewEmployeeDetail={handleViewEmployeeDetail}
            sortBy={employeeSortBy}
            sortOrder={employeeSortOrder}
            onSortChange={handleEmployeeSort}
          />
        ) : viewMode === 'attendance' ? (
          <GangAttendanceMatrix
            token={token}
            gangCodes={gang === 'ALL' ? ( gangs.map(g => g.gang_code)) : [gang]}
            month={month}
            year={year}
            division={division}
            onViewEmployeeDetail={handleViewEmployeeDetail}
          />
        ) : (
          <GangOvertimeMatrix
            token={token}
            gangCodes={gang === 'ALL' ? ( gangs.map(g => g.gang_code)) : [gang]}
            month={month}
            year={year}
            division={division}
            onViewEmployeeDetail={handleViewEmployeeDetail}
          />
        )}
      </div>
    </div>
  );
};

OperationalReportWrapper.displayName = 'OperationalReportWrapper';

// Protected Route Wrapper
// Di proxy/prod mode, redirect ke root /login (gateway login), bukan /upah/login.
// window.location.replace bypass React Router basename (/upah) → langsung ke origin root.
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    if (isProdMode()) {
      redirectToExternalLogin();
    } else {
      window.location.replace('/login');
    }
    return null;
  }
  return children;
};

function AppInner() {
  const { isAuthenticated, loading, isKeraniUser } = useAuth()
  const inProdMode = isProdMode()

  const navigate = useNavigate()
  const location = useLocation()

  // URL Path Management & Role Redirects
  useEffect(() => {
    console.log('[AppInner] location changed:', location.pathname, 'key:', location.key);
    if (!loading) {
      // Use location.pathname from React Router to get path relative to basename
      const currentPath = location.pathname
      const isLoginPath = currentPath === '/login' || currentPath.endsWith('/login')

      // 1. PROXY MODE: kalau gateway/external token sudah ada, langsung masuk (auto-login).
      //    Tanpa token → arahkan ke halaman login internal (bukan gateway /login).
      //    External-user SSO tetap jalan: AuthContext checkAuth restore token gateway dari localStorage.
      if (inProdMode && !isAuthenticated && !isLoginPath) {
        console.log('[App] Proxy mode: Not authenticated, going to internal login')
        navigate('/login', { replace: true })
        return
      }

      // 2. DEV MODE: External Login Redirect
      if (!isAuthenticated && !isLoginPath && !inProdMode) {
        console.log('[App] Dev mode: Not authenticated, redirecting to login')
        // Hard redirect ke root /login — bypass React Router basename (/upah) supaya tidak jadi /upah/login
        window.location.replace('/login')
        return
      }

      // 2b. sudah login tapi masih di /login → masuk ke app root (dev & proxy)
      if (isAuthenticated && isLoginPath) {
        navigate('/', { replace: true })
        return
      }

      // 2. KERANI Role Redirect
      // Kerani can ONLY access: /operational, /employee/detail, /payslip-print, /hr-info, /report-pajak, /employee-directory, /pendapatan-tidak-tetap
      if (isAuthenticated && isKeraniUser) {
        const allowedPaths = [
          '/',
          '/operational',
          '/employee/detail',
          '/payslip-print',
          '/hr-info',
          '/login',
          '/report-pajak',
          '/employee-directory',
          '/pendapatan-tidak-tetap'
        ];
        const isAllowed = allowedPaths.some(p => currentPath === p || currentPath.startsWith(p));

        if (!isAllowed) {
          console.log('[App] Kerani user restricted to Operational page. Redirecting from:', currentPath);
          navigate('/operational', { replace: true });
        }
      }
    }
  }, [isAuthenticated, loading, inProdMode, isKeraniUser, navigate, location])

  if (loading) {
    return <LoadingScreen isLoading={true} message="Menyiapkan sistem..." />
  }

  console.log('[AppInner] rendering Routes for location:', location.pathname);

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen isLoading={true} message="Memuat halaman..." />}>
        <Routes>
          {/* Internal Login Route - dev & proxy mode */}
          <Route path="/login" element={<LoginPage />} />

          {/* Employee Detail Route - From Daftar Upah (Operational: payslip, attendance matrix) */}
          <Route path="/employee/detail" element={
            <ProtectedRoute>
              <div style={{ height: '100vh', width: '100vw', overflowY: 'auto', overflowX: 'hidden', backgroundColor: '#e5e7eb' }}>
                <EmployeeDetailRoute />
              </div>
            </ProtectedRoute>
          } />

          {/* HR Info Route - From Employee Directory (Managerial: profile, career history) */}
          <Route path="/hr-info" element={
            <ProtectedRoute>
              <div style={{ height: '100vh', width: '100vw', overflow: 'auto', backgroundColor: '#f8fafc' }}>
                <HrInfoRoute />
              </div>
            </ProtectedRoute>
          } />

          {/* Payslip Print Route */}
          <Route path="/payslip-print" element={
            <ProtectedRoute>
              <PayslipPrintPage />
            </ProtectedRoute>
          } />

          {/* Gang Comparison Report Route */}
          <Route path="/gang-comparison-report" element={
            <ProtectedRoute>
              <GangComparisonReportPage />
            </ProtectedRoute>
          } />

          {/* Dashboard Layout Routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardHome key={location.pathname + location.search} />} />

            <Route path="operational" element={<OperationalReportWrapper key={location.pathname + location.search} />} />
            <Route path="employee-directory" element={<SummaryReportWrapper component={EmployeeDirectoryPage} />} />

            <Route path="summary" element={<SummaryReportWrapper component={SummaryReportPage} />} />
            <Route path="wages-rebinmas" element={<SummaryReportWrapper component={WagesSummaryRebinmasPage} />} />
            <Route path="wages-ijl" element={<SummaryReportWrapper component={WagesSummaryIJLPage} />} />
            <Route path="analysis" element={<SummaryReportWrapper component={AnalysisReportPage} />} />
            <Route path="comprehensive" element={<SummaryReportWrapper component={PayrollAnalysisPage} />} />
            <Route path="impact" element={<SummaryReportWrapper component={ImpactReportPage} />} />
            <Route path="executive" element={<SummaryReportWrapper component={ExecutivePayrollPage} />} />
            <Route path="seed" element={<SummaryReportWrapper component={AggregationSeederPage} />} />
            <Route path="spreadsheet-sync" element={<SummaryReportWrapper component={SpreadsheetSyncPage} />} />
            <Route path="wages-comparison" element={<SummaryReportWrapper component={WagesComparisonPage} />} />
            <Route path="pendapatan-tidak-tetap" element={<SummaryReportWrapper component={OtherIncomesPage} />} />
            <Route path="report-pajak" element={<SummaryReportWrapper component={TaxReportPage} />} />
            <Route path="productivity" element={<SummaryReportWrapper component={ProductivityReportPage} />} />
            <Route path="detailed-salary" element={<SummaryReportWrapper component={DetailedSalaryAnalysisPage} />} />
            <Route path="mill-production" element={<SummaryReportWrapper component={MillProductionReport} />} />
            <Route path="tonase-analysis" element={<SummaryReportWrapper component={TonaseAnalysisReportPage} />} />
            <Route path="cost-per-ton-story" element={<SummaryReportWrapper component={CostPerTonStoryPage} />} />
            <Route path="salary-analysis" element={<SummaryReportWrapper component={SalaryAnalysisPage} />} />
            <Route path="detail-upah-bersih" element={<SummaryReportWrapper component={UpahBersihDetailPage} />} />
            <Route path="data-verification" element={<SummaryReportWrapper component={DataVerificationPage} />} />
            <Route path="server-monitor" element={<ServerMonitor />} />
            <Route path="report/high-earners" element={<HighEarnerReportPage />} />
            <Route path="report/salary-range-detail" element={<SalaryRangeReportWrapper />} />

            {/* Development/Test Pages */}
            <Route path="test/components" element={<SummaryReportWrapper component={ComponentMetadataTestPage} />} />

          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

// Wrapper to pass context values to existing pages
const SummaryReportWrapper = ({ component: Component }) => {
  const { month, year, division } = useReport();
  const navigate = useNavigate();
  const location = useLocation();

  // Existing pages have onBack prop. We can map it to navigate(-1) or navigate('/')
  const handleBack = () => navigate('/');

  // Using location.pathname + search as key FORCES remount when navigating, 
  // solving the 'stuck UI' bug even when query params change
  return <Component
    key={location.pathname + location.search}
    onBack={handleBack}
    initialMonth={month}
    initialYear={year}
    initialDivision={division}
  />
}

const SalaryRangeReportWrapper = () => {
  const { month, year } = useReport();
  const navigate = useNavigate();
  const location = useLocation();
  const routeParams = useMemo(() => parseSalaryRangeRouteParams(location.search, {
    month,
    year,
    minSalary: 6000000
  }), [location.search, month, year]);

  return <SalaryRangeDetailPage
    key={location.pathname + location.search}
    onBack={() => navigate('/')}
    initialMonth={routeParams.month}
    initialYear={routeParams.year}
    initialMinSalary={routeParams.minSalary}
    initialMaxSalary={routeParams.maxSalary}
  />
}

export default function App() {
  // Get base path for proxy mode: '/upah' when accessed via proxy, '' otherwise
  const basename = getBasePath();

  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <ReportProvider>
          <AppInner />
        </ReportProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
