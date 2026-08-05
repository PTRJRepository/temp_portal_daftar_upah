/**
 * PayrollAnalysisPage - Laporan Analisis Payroll Comprehensive
 *
 * Halaman analisis payroll dengan breakdown detail komponen:
 * - KPI Cards
 * - Summary of Top OT Tasks (New)
 * - Filter tabs (Semua, Lembur, Premi, Tunjangan, Potongan)
 * - Custom HTML Table (print-optimized)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchGangs, fetchDivisions } from '../services/gangService';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import { printReport } from '../utils/printPageSetup';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';
import { initPrintMode } from '../utils/printOptimizer';
import { TrendingUp, Clock, AlertTriangle, ChevronDown, Printer, Download, RefreshCw, Filter } from 'lucide-react';

const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export default function PayrollAnalysisPage({
  initialMonth = new Date().getMonth() + 1,
  initialYear = new Date().getFullYear(),
  initialDivision = '',
  onBack
}) {
  const { token, user } = useAuth();

  // State for filters
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);
  const [division, setDivision] = useState(initialDivision);
  const [gang, setGang] = useState('');

  // Sync state with props when they change
  useEffect(() => {
    if (initialDivision !== undefined) setDivision(initialDivision);
    if (initialMonth !== undefined) setMonth(initialMonth);
    if (initialYear !== undefined) setYear(initialYear);
  }, [initialDivision, initialMonth, initialYear]);

  // State for data
  const [rawData, setRawData] = useState([]);
  const [aggregatedData, setAggregatedData] = useState(null);
  const [allDivisions, setAllDivisions] = useState([]);
  const [gangs, setGangs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // [NEW] Backend-provided grand total for KPIs (single source of truth)
  const [backendGrandTotal, setBackendGrandTotal] = useState(null);

  // State for active tab
  const [activeTab, setActiveTab] = useState('semua');

  // State for range filters per tab
  const [rangeFilters, setRangeFilters] = useState({
    semua: { min: 0, max: null },
    karyawan: { min: 0, max: null },
    lembur: { min: 0, max: null },
    premi: { min: 0, max: null },
    tunjangan: { min: 0, max: null },
    potongan: { min: 0, max: null }
  });

  // Init print mode on mount
  useEffect(() => {
    initPrintMode();
  }, []);

  // Load gangs when division changes
  useEffect(() => {
    async function loadGangs() {
      try {
        const gangList = await fetchGangs(token, division);
        setGangs(gangList || []);
        setGang('ALL');
      } catch (e) {
        console.error('[PayrollAnalysis] Failed to load gangs:', e);
      }
    }
    if (token && division && division !== 'ALL') loadGangs();
  }, [token, division]);

  // Fetch aggregated data for KPIs
  const fetchAggregatedData = async () => {
    if (!token || !division) return;
    try {
      const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
      const response = await fetch(
        `${apiUrl}/payroll/dashboard/aggregation/gang-data?division_code=${division}&month=${month}&year=${year}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (response.ok) {
        const json = await response.json();
        if (json.success) {
          setAggregatedData(json.data);
        }
      }
    } catch (e) {
      console.error('[PayrollAnalysis] Failed to fetch aggregated data:', e);
    }
  };

  // Fetch payroll data
  const fetchData = useCallback(async (overrideDivisions = null) => {
    if (!token) {
      setRawData([]);
      return;
    }
    setLoading(true);
    setError(null);
    setAggregatedData(null);

    fetchAggregatedData();

    try {
      const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
      let targetDivisions = [division];

      // If division is "ALL", we need allDivisions. Use override if provided.
      if (!division || division === 'ALL') {
        targetDivisions = overrideDivisions || allDivisions;
      }

      // If we still don't have divisions yet, wait for them
      if (!targetDivisions || targetDivisions.length === 0) {
        setRawData([]);
        setLoading(false);
        return;
      }

      const divisionPromises = targetDivisions.map(divCode => {
        const gangParam = (divCode === division && gang && gang !== 'ALL') ? `&gang_code=${gang}` : '';
        return fetch(
          `${apiUrl}/payroll/report/division-raw-tree?division_code=${divCode}&month=${month}&year=${year}${gangParam}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        ).then(res => res.json());
      });

      const results = await Promise.all(divisionPromises);

      let allEmployees = [];
      // [NEW] Accumulate grand_total from all divisions (single source of truth)
      let accumulatedGrandTotal = null;

      results.forEach(result => {
        if (result.gangs && Array.isArray(result.gangs)) {
          result.gangs.forEach(gangData => {
            const shouldInclude = !gang || gang === 'ALL' || gangData.gang_code === gang;
            if (shouldInclude && gangData.employees && Array.isArray(gangData.employees)) {
              allEmployees = allEmployees.concat(gangData.employees);
            }
          });
        }

        // Accumulate grand_total from each division response
        if (result.grand_total) {
          if (!accumulatedGrandTotal) {
            accumulatedGrandTotal = { ...result.grand_total };
          } else {
            // Sum numeric fields for grand total across divisions
            Object.keys(accumulatedGrandTotal).forEach(key => {
              if (typeof accumulatedGrandTotal[key] === 'number' && key !== 'hari_kerja_count') {
                accumulatedGrandTotal[key] += Number(result.grand_total[key] || 0);
              }
            });
          }
        }
      });

      setRawData(allEmployees);
      setBackendGrandTotal(accumulatedGrandTotal);
    } catch (e) {
      console.error('[PayrollAnalysis] Error fetching data:', e);
      setError(e.message || 'Failed to fetch data');
      setRawData([]);
    } finally {
      setLoading(false);
    }
  }, [token, division, gang, month, year, allDivisions]);

  // Load divisions first, then fetch data
  useEffect(() => {
    let cancelled = false;

    async function loadAndFetch() {
      // Load divisions if not yet loaded
      if (allDivisions.length === 0 && token) {
        try {
          const divs = await fetchDivisions(token);
          if (cancelled) return;
          setAllDivisions(divs || []);
        } catch (e) {
          console.error('[PayrollAnalysis] Failed to load divisions:', e);
          if (cancelled) return;
          setError('Failed to load divisions');
          return;
        }
      }
      // Then fetch data
      await fetchData();
    }

    loadAndFetch();

    return () => {
      cancelled = true;
    };
  }, [token, division, gang, month, year]);

  // Filter data
  const filteredData = useMemo(() => {
    const filter = rangeFilters[activeTab] || { min: 0, max: null };

    return rawData.filter(row => {
      let value = 0;
      let hasData = true;

      switch (activeTab) {
        case 'semua':
          value = row.upah_bersih || 0;
          hasData = true;
          break;
        case 'karyawan':
          value = row.upah_bersih || 0;
          hasData = true;
          break;
        case 'lembur':
          value = row.lembur_jumlah || 0;
          hasData = value > 0;
          break;
        case 'premi':
          value = row.total_premi || 0;
          hasData = value > 0;
          break;
        case 'tunjangan':
          value = row.total_tunjangan || 0;
          hasData = value > 0;
          break;
        case 'potongan':
          value = row.total_potongan_bersih || 0;
          hasData = value > 0;
          break;
        default:
          return true;
      }

      const minMatch = value >= filter.min;
      const maxMatch = filter.max === null || value <= filter.max;
      return hasData && minMatch && maxMatch;
    });
  }, [rawData, activeTab, rangeFilters]);

  // Calculate Summary of OT Tasks
  const topLemburTasks = useMemo(() => {
    const taskMap = {};
    filteredData.forEach(emp => {
      if (emp.lembur_records && Array.isArray(emp.lembur_records)) {
        emp.lembur_records.forEach(rec => {
          const task = rec.task_desc || rec.task_code || 'LAIN-LAIN';
          if (!taskMap[task]) {
            taskMap[task] = { task, hours: 0, amount: 0, empCount: new Set() };
          }
          taskMap[task].hours += (rec.hours || 0);
          taskMap[task].amount += (rec.amount || 0);
          taskMap[task].empCount.add(emp.nik);
        });
      }
    });

    return Object.values(taskMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [filteredData]);

  // KPI - [FIX] Use backend grand_total for consistent single source of truth
  const kpiData = useMemo(() => {
    // If backend provides grand_total, use it directly (single source of truth)
    if (backendGrandTotal) {
      return {
        employeeCount: backendGrandTotal.employee_count || 0,
        totalHK: backendGrandTotal.jumlah_hk || 0,
        totalPremi: backendGrandTotal.total_premi || 0,
        totalLembur: backendGrandTotal.lembur_jumlah || 0,
        totalUpahBersih: backendGrandTotal.upah_bersih || 0,
        totalTunjangan: backendGrandTotal.total_tunjangan || 0,
        totalPotongan: backendGrandTotal.total_potongan || 0,
      };
    }

    // Fallback to frontend calculation only if backend grand_total not available
    const rawSum = (field) => filteredData.reduce((acc, row) => acc + (row[field] || 0), 0);
    return {
      employeeCount: filteredData.length,
      totalHK: rawSum('jumlah_hk'),
      totalPremi: rawSum('total_premi'),
      totalLembur: rawSum('lembur_jumlah'),
      totalUpahBersih: rawSum('upah_bersih'),
      totalTunjangan: rawSum('total_tunjangan'),
      totalPotongan: rawSum('total_potongan_bersih'),
    };
  }, [backendGrandTotal, filteredData]);

  // Formatters
  const formatNumber = (val) => new Intl.NumberFormat('id-ID').format(Math.round(val || 0));
  const formatCurrency = (val) => 'Rp ' + formatNumber(val);
  const formatDecimal = (val) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1 }).format(val || 0);

  // Group helpers
  const groupLemburByTask = (records) => {
    const grouped = {};
    records.forEach(r => {
      const key = r.task_desc || r.task_code || 'Lain-lain';
      if (!grouped[key]) grouped[key] = { task: key, hours: 0, amount: 0, count: 0 };
      grouped[key].hours += (r.hours || 0);
      grouped[key].amount += (r.amount || 0);
      grouped[key].count += 1;
    });
    return Object.values(grouped).sort((a, b) => b.amount - a.amount);
  };

  const dynamicPremiHeaders = useMemo(() => {
    const headers = new Set();
    rawData.forEach(row => {
      if (row.premi) {
        Object.keys(row.premi).forEach(k => {
          // Exclude static columns: 'premi_brondol' (field), 'brondol' (key in row.premi), 'premi_pruning'
          if (k !== 'premi_brondol' && k !== 'premi_pruning' && k !== 'brondol') headers.add(k);
        });
      }
    });
    return Array.from(headers);
  }, [rawData]);

  const handlePrint = () => printReport({ orientation: 'landscape' });

  return (
    <div className="wsp-container">
      {/* Action Bar */}
      <div className="wsp-action-bar no-print">
        <div className="left-section">
          <button onClick={onBack} className="wsp-btn">&larr; KEMBALI</button>
          <div className="wsp-filter-group" style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="wsp-select">
              {monthNames.map((n, i) => <option key={i+1} value={i+1}>{n}</option>)}
            </select>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="wsp-select">
              {[0,1,2].map(i => <option key={2026-i} value={2026-i}>{2026-i}</option>)}
            </select>
            <select value={division} onChange={e => setDivision(e.target.value)} className="wsp-select" style={{ minWidth: '150px' }}>
              <option value="ALL">SEMUA DIVISI</option>
              {allDivisions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {division !== 'ALL' && (
              <select value={gang} onChange={e => setGang(e.target.value)} className="wsp-select" style={{ minWidth: '150px' }}>
                <option value="ALL">SEMUA GANG</option>
                {gangs.map(g => <option key={g.gang_code} value={g.gang_code}>{g.gang_code}</option>)}
              </select>
            )}
            <button onClick={fetchData} className="wsp-btn wsp-btn-primary" disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> REFRESH
            </button>
          </div>
        </div>
        <div className="right-section">
          <button onClick={handlePrint} className="wsp-btn wsp-btn-primary"><Printer size={16}/> PRINT LAPORAN</button>
        </div>
      </div>

      <div className="wsp-document" id="printable-analysis">
        <ReportWatermark />
        {/* Header */}
        <div className="wsp-letterhead">
          <h1 className="wsp-company-name">PT. REBINMAS JAYA</h1>
          <h2 className="wsp-report-title">LAPORAN KOMPREHENSIF ANALISIS PAYROLL</h2>
          <div className="wsp-report-period">Periode: {monthNames[month-1]} {year}</div>
          <div className="wsp-report-division">
            {division === 'ALL' ? 'SEMUA UNIT OPERASIONAL' : `DIVISI: ${division}`}
            {gang && gang !== 'ALL' && ` | GANG: ${gang}`}
          </div>
          <ReportPrintMetadata
            mode="Payroll Analysis"
            source="Payroll API"
            scope={division === 'ALL' ? 'Semua Unit Operasional' : division}
            items={[
              { label: 'Gang', value: gang && gang !== 'ALL' ? gang : '' },
              { label: 'Tab', value: activeTab?.toUpperCase() }
            ]}
            note="KPI mengikuti data periode; tab dan nilai minimal menyaring detail karyawan yang terlihat."
          />
        </div>

        {/* KPI Grid */}
        <div className="wsp-kpi-grid">
          <div className="wsp-kpi-card">
            <div className="wsp-kpi-label">TOTAL KARYAWAN</div>
            <div className="wsp-kpi-value">{formatNumber(kpiData.employeeCount)}</div>
          </div>
          <div className="wsp-kpi-card">
            <div className="wsp-kpi-label">TOTAL HK KERJA</div>
            <div className="wsp-kpi-value">{formatNumber(kpiData.totalHK)}</div>
          </div>
          <div className="wsp-kpi-card">
            <div className="wsp-kpi-label">TOTAL LEMBUR (OT)</div>
            <div className="wsp-kpi-value text-amber-700">{formatCurrency(kpiData.totalLembur)}</div>
          </div>
          <div className="wsp-kpi-card highlight">
            <div className="wsp-kpi-label">TOTAL UPAH BERSIH</div>
            <div className="wsp-kpi-value">{formatCurrency(kpiData.totalUpahBersih)}</div>
          </div>
        </div>

        {/* Top OT Summary (New Section) */}
        {topLemburTasks.length > 0 && (
          <div className="ot-task-summary-section" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
            <div className="section-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderLeft: '4px solid #d97706', marginBottom: '10px' }}>
              <TrendingUp size={18} className="text-amber-600" />
              <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#92400e' }}>RINGKASAN TUGAS LEMBUR TERBESAR</span>
            </div>
            <div className="task-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {topLemburTasks.map((t, i) => (
                <div key={i} className="task-mini-card" style={{ padding: '10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.task}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>{formatCurrency(t.amount)}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                    <span>{formatDecimal(t.hours)} Jam</span>
                    <span>{t.empCount.size} Org</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs & Filters (No-print) */}
        <div className="no-print" style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            {['semua', 'karyawan', 'lembur', 'premi', 'tunjangan', 'potongan'].map(t => (
              <button key={t} onClick={() => setActiveTab(t)} className={activeTab === t ? 'wsp-btn wsp-btn-primary' : 'wsp-btn'} style={{ borderRadius: '20px', fontSize: '0.75rem' }}>{t === 'karyawan' ? 'KARYAWAN' : t.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Filter size={16} />
            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>MINIMAL NILAI:</span>
            <input type="number" value={rangeFilters[activeTab].min} onChange={e => setRangeFilters({...rangeFilters, [activeTab]: {...rangeFilters[activeTab], min: parseInt(e.target.value) || 0}})} className="wsp-select" style={{ width: '120px' }} />
            <button onClick={() => setRangeFilters({...rangeFilters, [activeTab]: {min: 0, max: null}})} className="wsp-btn" style={{ fontSize: '0.7rem' }}>RESET</button>
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#64748b' }}>Menampilkan {filteredData.length} Karyawan</span>
          </div>
        </div>

        {/* Main Table */}
        <div className="wsp-table-wrapper">
          <table className="wsp-table">
            <thead>
              <tr className="wsp-header-master">
                {activeTab === 'karyawan' ? (
                  <>
                    <th colSpan="4">INFORMASI KARYAWAN</th>
                    <th colSpan="3">STATUS</th>
                    <th colSpan="2">ABSENSI</th>
                    <th colSpan="1">GAJI</th>
                  </>
                ) : (
                  <>
                    <th colSpan="4">INFORMASI KARYAWAN</th>
                    <th colSpan="1">ABSEN</th>
                    {activeTab === 'semua' && <th colSpan="4">TUNJANGAN</th>}
                    {(activeTab === 'semua' || activeTab === 'premi') && <th colSpan={3 + dynamicPremiHeaders.length}>PREMI</th>}
                    {(activeTab === 'semua' || activeTab === 'lembur') && <th colSpan="2">LEMBUR (OT)</th>}
                    {activeTab === 'potongan' && <th colSpan="1">POTONGAN</th>}
                    <th colSpan="1" className="text-right">UPAH BERSIH</th>
                  </>
                )}
              </tr>
              <tr className="wsp-header-sub">
                <th>NIK</th>
                <th>NAMA</th>
                <th>GANG</th>
                {activeTab === 'karyawan' ? (
                  <>
                    <th>JABATAN</th>
                    <th>JK</th>
                    <th>PTKP</th>
                    <th>TER</th>
                    <th className="text-right">HK</th>
                    <th className="text-right">JKERJA</th>
                    <th className="text-right">UPAH DASAR</th>
                  </>
                ) : (
                  <>
                    <th>TUGAS UTAMA</th>
                    <th className="text-right">HK</th>
                    {(activeTab === 'semua' || activeTab === 'tunjangan') && (
                      <><th>BERAS</th><th>JABATAN</th><th>MK</th><th>TOTAL</th></>
                    )}
                    {(activeTab === 'semua' || activeTab === 'premi') && (
                      <>
                        <th>BRONDOL</th><th>PRUNING</th>
                        {dynamicPremiHeaders.map(h => <th key={h}>{h.replace('PREMI_', '').replace(/_/g, ' ')}</th>)}
                        <th>TOTAL</th>
                      </>
                    )}
                    {(activeTab === 'semua' || activeTab === 'lembur') && (
                      <><th>JAM</th><th>RUPIAH</th></>
                    )}
                    {activeTab === 'potongan' && <th>TOTAL POTONGAN</th>}
                    <th className="text-right">DIBAYARKAN</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, idx) => {
                const hasDetails = activeTab === 'lembur' && row.lembur_records?.length > 0;
                return (
                  <React.Fragment key={idx}>
                    <tr className={hasDetails ? 'row-has-detail' : ''}>
                      <td className="font-mono" style={{ fontSize: '0.7rem' }}>{row.new_nik || row.nik}</td>
                      <td style={{ fontWeight: 700 }}>{row.nama}</td>
                      <td>{row.gang_code}</td>

                      {activeTab === 'karyawan' ? (
                        <>
                          <td style={{ fontSize: '0.65rem', maxWidth: '100px', whiteSpace: 'normal' }}>{row.jabatan_estate}</td>
                          <td className="text-center">{row.jenis_kelamin}</td>
                          <td className="text-center">{row.status_ptkp}</td>
                          <td className="text-center">{row.kategori_ter}</td>
                          <td className="text-right">{formatNumber(row.jumlah_hk)}</td>
                          <td className="text-right">{formatDecimal(row.total_jam_kerja)}</td>
                          <td className="text-right font-semibold">{formatCurrency(row.upah_dasar)}</td>
                        </>
                      ) : (
                        <>
                          <td style={{ fontSize: '0.65rem', maxWidth: '120px', whiteSpace: 'normal' }}>{row.task_desc}</td>
                          <td className="text-right">{formatNumber(row.jumlah_hk)}</td>
                        </>
                      )}
                      
                      {(activeTab === 'semua' || activeTab === 'tunjangan') && (
                        <>
                          <td className="text-right">{formatNumber(row.beras_jumlah)}</td>
                          <td className="text-right">{formatNumber(row.jabatan_jumlah)}</td>
                          <td className="text-right">{formatNumber(row.masa_kerja_jumlah)}</td>
                          <td className="text-right font-semibold">{formatNumber(row.total_tunjangan)}</td>
                        </>
                      )}

                      {(activeTab === 'semua' || activeTab === 'premi') && (
                        <>
                          <td className="text-right">{formatNumber(row.premi_brondol)}</td>
                          <td className="text-right">{formatNumber(row.premi_pruning)}</td>
                          {dynamicPremiHeaders.map(h => <td key={h} className="text-right">{formatNumber(row.premi?.[h] || 0)}</td>)}
                          <td className="text-right font-semibold">{formatNumber(row.total_premi)}</td>
                        </>
                      )}

                      {(activeTab === 'semua' || activeTab === 'lembur') && (
                        <>
                          <td className="text-right">{formatDecimal(row.lembur_jam)}</td>
                          <td className="text-right font-bold text-amber-800">{formatNumber(row.lembur_jumlah)}</td>
                        </>
                      )}

                      {activeTab === 'potongan' && <td className="text-right">{formatNumber(row.total_potongan_bersih)}</td>}
                      
                      {activeTab !== 'karyawan' && (
                        <td className="text-right font-bold text-blue-900" style={{ backgroundColor: '#f0f9ff' }}>{formatNumber(row.upah_bersih)}</td>
                      )}
                    </tr>

                    {/* Detailed Task Breakdown for OT */}
                    {hasDetails && (
                      <tr className="detail-row" style={{ backgroundColor: '#fdfcfb' }}>
                        <td colSpan={5} className="no-border"></td>
                        <td colSpan="100%" style={{ padding: '0' }}>
                          <div className="task-breakdown-container" style={{ padding: '8px 12px', borderLeft: '3px solid #fcd34d', margin: '4px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem', fontWeight: 800, color: '#b45309', marginBottom: '6px', textTransform: 'uppercase' }}>
                              <Clock size={12} /> Rincian Pekerjaan Lembur:
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid #fee2e2' }}>
                                  <th style={{ textAlign: 'left', padding: '4px' }}>JENIS PEKERJAAN (TASK)</th>
                                  <th style={{ textAlign: 'right', padding: '4px', width: '60px' }}>FREK.</th>
                                  <th style={{ textAlign: 'right', padding: '4px', width: '80px' }}>TOTAL JAM</th>
                                  <th style={{ textAlign: 'right', padding: '4px', width: '100px' }}>JUMLAH (RP)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {groupLemburByTask(row.lembur_records).map((gt, gi) => (
                                  <tr key={gi} style={{ borderBottom: '1px dotted #e2e8f0' }}>
                                    <td style={{ padding: '4px', fontWeight: 600 }}>{gt.task}</td>
                                    <td style={{ textAlign: 'right', padding: '4px' }}>{gt.count}x</td>
                                    <td style={{ textAlign: 'right', padding: '4px' }}>{formatDecimal(gt.hours)}</td>
                                    <td style={{ textAlign: 'right', padding: '4px', fontWeight: 700 }}>{formatNumber(gt.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="wsp-grand-total">
                <td colSpan="4">TOTAL KESELURUHAN ({filteredData.length} KARYAWAN)</td>
                {activeTab === 'karyawan' ? (
                  <>
                    <td colSpan="3" className="text-right"></td>
                    <td className="text-right">{formatNumber(kpiData.totalHK)}</td>
                    <td colSpan="2" className="text-right"></td>
                  </>
                ) : (
                  <>
                    <td className="text-right">{formatNumber(kpiData.totalHK)}</td>
                    {(activeTab === 'semua' || activeTab === 'tunjangan') && (
                      <td colSpan="4" className="text-right">{formatCurrency(kpiData.totalTunjangan)}</td>
                    )}
                    {(activeTab === 'semua' || activeTab === 'premi') && (
                      <td colSpan={3 + dynamicPremiHeaders.length} className="text-right">{formatCurrency(kpiData.totalPremi)}</td>
                    )}
                    {(activeTab === 'semua' || activeTab === 'lembur') && (
                      <td colSpan="2" className="text-right">{formatCurrency(kpiData.totalLembur)}</td>
                    )}
                    {activeTab === 'potongan' && <td className="text-right">{formatCurrency(kpiData.totalPotongan)}</td>}
                    <td className="text-right">{formatCurrency(kpiData.totalUpahBersih)}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div className="wsp-footer">
          <div>Dicetak: {new Date().toLocaleString('id-ID')} | User: {user?.username}</div>
          <div style={{ fontWeight: 700 }}>LAPORAN ANALISIS PAYROLL KOMPREHENSIF - PT REBINMAS JAYA</div>
        </div>
      </div>

      {/* Internal Print Styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 landscape; margin: 5mm; }
          .wsp-container { padding: 0 !important; background: white !important; }
          .wsp-document { box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .wsp-table-wrapper { border: none !important; overflow: visible !important; }
          .wsp-table { 
            font-size: 6pt !important; 
            table-layout: auto !important; 
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .wsp-table th, .wsp-table td { 
            padding: 2px 1px !important; 
            white-space: normal !important; 
            word-wrap: break-word !important; 
            word-break: break-all !important;
            border: 0.5px solid #000 !important;
            line-height: 1 !important;
          }
          .wsp-header-master th, .wsp-header-sub th { 
            background-color: #f1f5f9 !important; 
            -webkit-print-color-adjust: exact;
            font-weight: 800 !important;
          }
          .task-mini-card { border: 1px solid #ccc !important; box-shadow: none !important; padding: 4px !important; }
          .highlight { background-color: #f1f5f9 !important; -webkit-print-color-adjust: exact; }
          .wsp-grand-total td { background-color: #e2e8f0 !important; -webkit-print-color-adjust: exact; color: #000 !important; font-weight: 800 !important; }
          .ot-task-summary-section .section-header { background-color: #fffbeb !important; -webkit-print-color-adjust: exact; }
          
          /* Hide non-essential columns in "semua" print to avoid extreme overflow if needed */
          /* But for now, let's try to wrap everything */
          
          .font-mono { font-family: monospace !important; }
        }
        .row-has-detail { border-bottom: none !important; }
        .detail-row td { border-top: none !important; padding-top: 0 !important; }
        .no-border { border: none !important; }
      `}} />
    </div>
  );
}
