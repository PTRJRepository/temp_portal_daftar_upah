import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import MonthSelector from '../components/common/MonthSelector';
import { isProdMode } from '../utils/prodModeUtils';
import { Settings, Info, BarChart2, ArrowRight, FlaskConical, DollarSign, Calculator } from 'lucide-react';

export default function DashboardHome() {
  const { user } = useAuth();
  const {
    month, setMonth,
    year, setYear,
    division, setDivision,
    gang, setGang,
    gangs, allDivisions,
    gangLoading, isLockedMode, isAdminUser,
    currentPeriod
  } = useReport();

  // Role check: show report_pajak for kerani and non-admin users
  const userRole = (user?.role || '').toLowerCase();
  const canSeeReportPajak = userRole === 'kerani' || (userRole !== 'admin');

  const navigate = useNavigate();

  // Determine report access (simplified, similar to previous MainPage)
  const inProdMode = isProdMode();
  const canAccessReports = isAdminUser || !inProdMode;

  const handleGenerateOperational = () => {
    if (division && gang) {
      navigate('/operational');
    }
  };

  const handleGenerateReportPajak = () => {
    if (division && gang) {
      navigate('/report-pajak');
    }
  };

  return (
    <>
      {/* Page Header */}
      <div style={{
        backgroundColor: '#1e293b',
        borderBottom: '3px solid #2563eb',
        padding: '1.5rem 2rem',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
      }}>
        {/* Left: Page Title */}
        <div>
          <h1 style={{
            fontSize: '1.25rem',
            fontWeight: '700',
            margin: 0,
            color: '#ffffff',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}>
            Dashboard
          </h1>
          <p style={{
            margin: '0.25rem 0 0',
            color: '#94a3b8',
            fontSize: '0.8rem',
            fontWeight: '400',
          }}>
            Sistem Manajemen Data Upah dan Laporan Operasional
          </p>
        </div>

        {/* Right: Quick Stats Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          {/* Division chip */}
          <div style={{
            backgroundColor: 'rgba(37, 99, 235, 0.15)',
            border: '1px solid rgba(37, 99, 235, 0.3)',
            borderRadius: '6px',
            padding: '0.4rem 0.875rem',
            fontSize: '0.75rem',
            color: '#93c5fd',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
          }}>
            <span style={{ opacity: 0.7 }}>Divisi:</span>
            <span style={{ color: '#bfdbfe', fontWeight: '700' }}>{division || '—'}</span>
          </div>
          {/* Period chip */}
          <div style={{
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: '6px',
            padding: '0.4rem 0.875rem',
            fontSize: '0.75rem',
            color: '#6ee7b7',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
          }}>
            <span style={{ opacity: 0.7 }}>Periode:</span>
            <span style={{ color: '#a7f3d0', fontWeight: '700' }}>
              {new Date(year, month - 1).toLocaleString('id-ID', { month: 'short', year: 'numeric' }).toUpperCase()}
            </span>
          </div>
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
            <Settings size={20} className="text-blue-800" /> FILTER PARAMETER
          </h2>

          {/* CURRENT PERIOD INFO BANNER */}
          {currentPeriod && (
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderLeft: '4px solid #3b82f6',
              borderRadius: '6px',
              padding: '1rem',
              marginBottom: '2rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem'
            }}>
              <div style={{ color: '#3b82f6', marginTop: '2px' }}><Info size={20} /></div>
              <div>
                <h4 style={{ margin: '0 0 0.25rem 0', color: '#1e293b', fontSize: '0.95rem', fontWeight: '600' }}>
                  Info Database Aktif: {new Date(currentPeriod.year, currentPeriod.month - 1).toLocaleString('id-ID', { month: 'long', year: 'numeric' })}
                </h4>
                <p style={{ margin: 0, color: '#475569', fontSize: '0.85rem', lineHeight: '1.4' }}>
                  Database utama <b>hanya menyimpan data operasional untuk bulan yang sedang berjalan</b>. Untuk melihat rekapan data penggajian, data karyawan, dan kemandoran bulan-bulan sebelumnya secara akurat, gunakan Laporan/History (Aggregation Seeder).
                </p>
              </div>
            </div>
          )}

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
                  onChange={e => !isLockedMode && setDivision(e.target.value)}
                  disabled={isLockedMode}
                  onFocus={(e) => { e.target.style.borderColor = '#1e3a8a'; e.target.style.boxShadow = '0 0 0 3px rgba(30, 58, 138, 0.1)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#cbd5e1'; e.target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; }}
                >
                  <option value="">Pilih Divisi</option>
                  {allDivisions.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                  {/* Handle case where division is not in allDivisions but exists in state logic handled by context? - Context does it. */}
                </select>
              </div>

              {/* Gang Selection */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#475569', marginBottom: '0.5rem', letterSpacing: '0.025em' }}>
                  GANG / KEMANDORAN
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
                    backgroundColor: gangLoading ? '#f8fafc' : 'white',
                    color: '#334155',
                    outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                  value={gang}
                  onChange={e => setGang(e.target.value)}
                  disabled={gangLoading}
                  onFocus={(e) => { e.target.style.borderColor = '#1e3a8a'; e.target.style.boxShadow = '0 0 0 3px rgba(30, 58, 138, 0.1)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#cbd5e1'; e.target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; }}
                >
                  {gangLoading ? (
                    <option>Memuat data...</option>
                  ) : gangs.length === 0 ? (
                    <option>Menunggu pemilihan divisi...</option>
                  ) : (
                    <>
                      <option value="">Pilih Gang</option>
                      <option value="ALL">SEMUA GANG</option>
                      {gangs.map(g => (
                        <option key={g.gang_code} value={g.gang_code}>
                          {g.gang_code} - {g.description || '-'}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

            </div>
          </div>

          {/* QUICK ACTION BUTTON - Moved INSIDE/NEAR FILTER for accessibility */}
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            {canSeeReportPajak && (
              <button
                onClick={handleGenerateReportPajak}
                disabled={!division || !gang || gangLoading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '1rem 2rem',
                  backgroundColor: (!division || !gang || gangLoading) ? '#e2e8f0' : '#8b5cf6',
                  color: (!division || !gang || gangLoading) ? '#94a3b8' : 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: '700',
                  fontSize: '1rem',
                  cursor: (!division || !gang || gangLoading) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  boxShadow: (!division || !gang || gangLoading) ? 'none' : '0 4px 6px -1px rgba(139, 92, 246, 0.3)'
                }}
              >
                {gangLoading ? 'Memuat Data...' : 'REPORT PAJAK'}
                <Calculator size={18} />
              </button>
            )}
            <button
              onClick={handleGenerateOperational}
              disabled={!division || !gang || gangLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem 2rem',
                backgroundColor: (!division || !gang || gangLoading) ? '#e2e8f0' : '#0ea5e9',
                color: (!division || !gang || gangLoading) ? '#94a3b8' : 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '700',
                fontSize: '1rem',
                cursor: (!division || !gang || gangLoading) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                boxShadow: (!division || !gang || gangLoading) ? 'none' : '0 4px 6px -1px rgba(14, 165, 233, 0.3)'
              }}
            >
              {gangLoading ? 'Memuat Data...' : 'TAMPILKAN DATA UPAH'}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {/* Shortcuts Section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>

          {/* Development/Test Shortcuts (DEV MODE ONLY) */}
          {!inProdMode && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '2rem',
              border: '1px solid #cbd5e1',
              borderTop: '5px solid #f59e0b', // Amber Accent
              boxShadow: '0 4px 6px -2px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.3s ease'
            }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FlaskConical size={20} color="#f59e0b" /> Development & Testing
              </h3>

              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <button
                  onClick={() => navigate('/test/components')}
                  className="dashboard-link-btn"
                  style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  Component Metadata Test <span>›</span>
                </button>
                <button
                  onClick={() => navigate('/seed')}
                  className="dashboard-link-btn"
                  style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  Aggregation Seeder <span>›</span>
                </button>
              </div>
            </div>
          )}

          {/* Analysis & Summary Shortcuts */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '2rem',
            border: '1px solid #cbd5e1',
            borderTop: '5px solid #8b5cf6', // Violet Accent
            boxShadow: '0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            transition: 'all 0.3s ease'
          }}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart2 size={20} color="#8b5cf6" /> Laporan Analisis & Summary
            </h3>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <button
                onClick={() => navigate('/summary')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Summary Report (Accounting) <span>›</span>
              </button>
              <button
                onClick={() => navigate('/wages-comparison')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Summary Wages Comparison <span>›</span>
              </button>
              <button
                onClick={() => navigate('/impact')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Impact Report (Analysis) <span>›</span>
              </button>
              <button
                onClick={() => navigate('/productivity')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Productivity (Tonase vs Upah) <span>›</span>
              </button>
              <button
                onClick={() => navigate('/tonase-analysis')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Analisis Tonase <span>›</span>
              </button>
              <button
                onClick={() => navigate('/detailed-salary')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Analisis Upah Bersih & Lembur <span>›</span>
              </button>
              <button
                onClick={() => navigate('/comprehensive')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Comprehensive Payroll Analysis <span>›</span>
              </button>
              <button
                onClick={() => navigate('/detail-upah-bersih')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                📊 Detail Upah Bersih (Filter) <span>›</span>
              </button>
            </div>
          </div>

          {/* Financial Reports Shortcuts */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '2rem',
            border: '1px solid #cbd5e1',
            borderTop: '5px solid #10b981', // Emerald Accent
            boxShadow: '0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            transition: 'all 0.3s ease'
          }}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#0f172a', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <DollarSign size={20} color="#10b981" /> Laporan Keuangan
            </h3>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <button
                onClick={() => navigate('/wages-rebinmas')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Wages Rebinmas (Current) <span>›</span>
              </button>
              <button
                onClick={() => navigate('/wages-rebinmas?mode=comparison')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Wages Rebinmas (Comparison) <span>›</span>
              </button>
              <button
                onClick={() => navigate('/wages-ijl')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Wages IJL (Current) <span>›</span>
              </button>
              <button
                onClick={() => navigate('/wages-ijl?mode=comparison')}
                className="dashboard-link-btn"
                style={{ textAlign: 'left', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Wages IJL (Comparison) <span>›</span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </>
  );
}
