import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import MonthSelector from '../components/common/MonthSelector';
import { isProdMode } from '../utils/prodModeUtils';
import {
  Settings, Info, BarChart2, ArrowRight, FlaskConical, DollarSign, Calculator,
  TrendingUp, Layers, Scale, Activity, FileText, GitCompare, Wallet, Sparkles
} from 'lucide-react';

// ===== Visual system (selaras CEO board) =====
const C = {
  navy: '#0F4C81', navyDark: '#0B3A63', accent: '#3E7CB1', premi: '#1B9E77',
  lembur: '#E8871A', costTon: '#6D28D9', text: '#0F172A', text2: '#475569',
  muted: '#64748B', border: '#E2E8F0', surface: '#FFFFFF'
};
const SHADOW = '0 1px 2px rgba(15,23,42,.06), 0 4px 14px rgba(15,23,42,.07)';
const SHADOW_HOVER = '0 12px 32px rgba(15,23,42,.14)';

// Tile launcher besar
const Tile = ({ icon, title, desc, grad, onClick }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', overflow: 'hidden', textAlign: 'left', border: 'none', cursor: 'pointer',
        borderRadius: 16, padding: '1.4rem 1.4rem 1.2rem', background: grad, color: '#fff',
        boxShadow: hover ? SHADOW_HOVER : SHADOW, transform: hover ? 'translateY(-3px)' : 'none',
        transition: 'transform .18s ease, box-shadow .18s ease', minHeight: 118, display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
      }}
    >
      <div style={{ position: 'absolute', right: -18, top: -18, width: 90, height: 90, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 12, padding: 8, display: 'inline-flex' }}>{icon}</span>
        <ArrowRight size={18} style={{ opacity: hover ? 1 : 0.6, transform: hover ? 'translateX(2px)' : 'none', transition: 'all .18s' }} />
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: '1.02rem', letterSpacing: '-0.01em' }}>{title}</div>
        {desc && <div style={{ fontSize: '0.78rem', opacity: 0.85, marginTop: 2, fontWeight: 500 }}>{desc}</div>}
      </div>
    </button>
  );
};

// Link row kecil (daftar report di dalam panel)
const LinkRow = ({ label, onClick }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: 'left', padding: '0.7rem 0.9rem', border: `1px solid ${hover ? C.navy : C.border}`,
        borderRadius: 10, background: hover ? '#F4F8FC' : '#fff', cursor: 'pointer',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontWeight: 600, fontSize: '0.88rem', color: hover ? C.navy : C.text2, transition: 'all .15s'
      }}
    >
      {label} <span style={{ color: hover ? C.navy : '#cbd5e1', fontWeight: 800 }}>›</span>
    </button>
  );
};

export default function DashboardHome() {
  const { user } = useAuth();
  const {
    month, setMonth, year, setYear, division, setDivision, gang, setGang,
    gangs, allDivisions, gangLoading, isLockedMode, isAdminUser, currentPeriod
  } = useReport();

  const userRole = (user?.role || '').toLowerCase();
  const canSeeReportPajak = userRole === 'kerani' || (userRole !== 'admin');
  const navigate = useNavigate();
  const inProdMode = isProdMode();
  const canAccessReports = isAdminUser || !inProdMode;

  const periodLabel = useMemo(
    () => new Date(year, month - 1).toLocaleString('id-ID', { month: 'long', year: 'numeric' }),
    [month, year]
  );
  const ready = division && gang && !gangLoading;

  const goOperational = () => ready && navigate('/operational');
  const goPajak = () => ready && navigate('/report-pajak');

  return (
    <div style={{ minHeight: '100%', background: '#F1F5F9', fontFamily: 'Inter, sans-serif' }}>
      {/* HERO HEADER */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: `linear-gradient(120deg, ${C.navyDark} 0%, ${C.navy} 55%, ${C.accent} 100%)`,
        padding: '2.4rem 2.5rem 5.2rem', color: '#fff'
      }}>
        <div style={{ position: 'absolute', right: -60, top: -60, width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ position: 'absolute', right: 80, bottom: -80, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ maxWidth: 1240, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Sparkles size={18} style={{ opacity: 0.9 }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.9 }}>Portal Daftar Upah</span>
          </div>
          <h1 style={{ margin: 0, fontSize: '2.1rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            Selamat datang{user?.full_name || user?.username ? `, ${user?.full_name || user?.username}` : ''}
          </h1>
          <p style={{ margin: '0.6rem 0 0', color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', maxWidth: 560 }}>
            Pusat kendali laporan penggajian — pilih periode &amp; divisi, lalu jelajahi analisis biaya, produktivitas, dan keuangan.
          </p>
          {/* Chips */}
          <div style={{ display: 'flex', gap: 10, marginTop: '1.2rem', flexWrap: 'wrap' }}>
            <span style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 999, padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700 }}>
              Periode: {periodLabel}
            </span>
            <span style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 999, padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700 }}>
              Divisi: {division || '—'}
            </span>
            {gang && <span style={{ background: 'rgba(27,158,119,0.28)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 999, padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700 }}>
              Gang: {gang}
            </span>}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 2.5rem 3rem', marginTop: '-3rem', position: 'relative' }}>

        {/* FILTER CARD (overlap hero) */}
        <div style={{ background: C.surface, borderRadius: 18, padding: '1.8rem 2rem', border: `1px solid ${C.border}`, boxShadow: SHADOW, marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.4rem' }}>
            <span style={{ background: '#E8F1F8', color: C.navy, borderRadius: 10, padding: 7, display: 'inline-flex' }}><Settings size={18} /></span>
            <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filter Parameter</h2>
          </div>

          {currentPeriod && (
            <div style={{ background: '#F0F7FF', border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.navy}`, borderRadius: 10, padding: '0.9rem 1rem', marginBottom: '1.4rem', display: 'flex', gap: 10 }}>
              <Info size={18} style={{ color: C.navy, flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.83rem', color: C.text2, lineHeight: 1.5 }}>
                <b style={{ color: C.text }}>Database aktif: {new Date(currentPeriod.year, currentPeriod.month - 1).toLocaleString('id-ID', { month: 'long', year: 'numeric' })}.</b> Data operasional hanya bulan berjalan; untuk rekapan bulan sebelumnya gunakan Laporan/History (Aggregation Seeder).
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'flex-start' }}>
            <div style={{ flex: '0 0 320px', minWidth: 280 }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: C.muted, marginBottom: '0.6rem', letterSpacing: '0.04em' }}>PERIODE LAPORAN</label>
              <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
            </div>

            <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: C.muted, marginBottom: '0.5rem', letterSpacing: '0.04em' }}>
                  DIVISI {isLockedMode && <span style={{ color: C.lembur, fontSize: '0.72rem' }}>(LOCKED)</span>}
                </label>
                <select
                  className="input-field"
                  style={{ width: '100%', height: 46, padding: '0 1rem', fontSize: '0.92rem', border: `1px solid ${C.border}`, borderRadius: 10, backgroundColor: isLockedMode ? '#FFFBEB' : '#fff', cursor: isLockedMode ? 'not-allowed' : 'pointer', color: C.text, outline: 'none' }}
                  value={division}
                  onChange={e => !isLockedMode && setDivision(e.target.value)}
                  disabled={isLockedMode}
                >
                  <option value="">Pilih Divisi</option>
                  {allDivisions.map(d => (<option key={d} value={d}>{d}</option>))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: C.muted, marginBottom: '0.5rem', letterSpacing: '0.04em' }}>GANG / KEMANDORAN</label>
                <select
                  className="input-field"
                  style={{ width: '100%', height: 46, padding: '0 1rem', fontSize: '0.92rem', border: `1px solid ${C.border}`, borderRadius: 10, cursor: gangLoading ? 'wait' : 'pointer', backgroundColor: gangLoading ? '#F8FAFC' : '#fff', color: C.text, outline: 'none' }}
                  value={gang}
                  onChange={e => setGang(e.target.value)}
                  disabled={gangLoading}
                >
                  {gangLoading ? (<option>Memuat data...</option>) : gangs.length === 0 ? (<option>Menunggu pemilihan divisi...</option>) : (
                    <>
                      <option value="">Pilih Gang</option>
                      <option value="ALL">SEMUA GANG</option>
                      {gangs.map(g => (<option key={g.gang_code} value={g.gang_code}>{g.gang_code} - {g.description || '-'}</option>))}
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div style={{ marginTop: '1.6rem', display: 'flex', justifyContent: 'flex-end', gap: '0.9rem', flexWrap: 'wrap' }}>
            {canSeeReportPajak && (
              <button
                onClick={goPajak} disabled={!ready}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.85rem 1.6rem', background: ready ? `linear-gradient(135deg, ${C.costTon}, #8B5CF6)` : '#E2E8F0', color: ready ? '#fff' : '#94A3B8', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.9rem', cursor: ready ? 'pointer' : 'not-allowed', letterSpacing: '0.03em', boxShadow: ready ? '0 6px 16px rgba(109,40,217,0.28)' : 'none', transition: 'all .18s' }}
              >
                {gangLoading ? 'Memuat...' : 'REPORT PAJAK'} <Calculator size={17} />
              </button>
            )}
            <button
              onClick={goOperational} disabled={!ready}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.85rem 1.8rem', background: ready ? `linear-gradient(135deg, ${C.navy}, ${C.accent})` : '#E2E8F0', color: ready ? '#fff' : '#94A3B8', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.9rem', cursor: ready ? 'pointer' : 'not-allowed', letterSpacing: '0.03em', boxShadow: ready ? '0 6px 16px rgba(15,76,129,0.28)' : 'none', transition: 'all .18s' }}
            >
              {gangLoading ? 'Memuat...' : 'TAMPILKAN DATA UPAH'} <ArrowRight size={17} />
            </button>
          </div>
        </div>

        {/* FEATURED ANALYSIS TILES */}
        <div style={{ marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: C.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Analisis Utama</span>
          <span style={{ flex: 1, height: 1, background: C.border }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1.1rem', marginBottom: '2rem' }}>
          <Tile icon={<TrendingUp size={20} />} title="Executive Board" desc="KPI CEO · cost/ton · insight" grad="linear-gradient(135deg,#0F4C81,#3E7CB1)" onClick={() => navigate('/executive')} />
          <Tile icon={<Scale size={20} />} title="Analisis Tonase" desc="Biaya per ton & per HK" grad="linear-gradient(135deg,#1B9E77,#34A853)" onClick={() => navigate('/tonase-analysis')} />
          <Tile icon={<Activity size={20} />} title="Produktivitas" desc="Tonase vs upah" grad="linear-gradient(135deg,#E8871A,#F59E0B)" onClick={() => navigate('/productivity')} />
          <Tile icon={<Layers size={20} />} title="Comprehensive" desc="Analisis payroll menyeluruh" grad="linear-gradient(135deg,#6D28D9,#8B5CF6)" onClick={() => navigate('/comprehensive')} />
        </div>

        {/* REPORT PANELS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.4rem' }}>
          <div style={{ background: C.surface, borderRadius: 16, padding: '1.4rem', border: `1px solid ${C.border}`, boxShadow: SHADOW }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
              <span style={{ background: '#F1EBFB', color: C.costTon, borderRadius: 10, padding: 7, display: 'inline-flex' }}><BarChart2 size={18} /></span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: C.text }}>Laporan Analisis &amp; Summary</h3>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <LinkRow label="Summary Report (Accounting)" onClick={() => navigate('/summary')} />
              <LinkRow label="Summary Wages Comparison" onClick={() => navigate('/wages-comparison')} />
              <LinkRow label="Impact Report (Analysis)" onClick={() => navigate('/impact')} />
              <LinkRow label="Analisa Lembur & Premi" onClick={() => navigate('/analysis')} />
              <LinkRow label="Analisis Upah Bersih & Lembur" onClick={() => navigate('/detailed-salary')} />
              <LinkRow label="Detail Upah Bersih (Filter)" onClick={() => navigate('/detail-upah-bersih')} />
            </div>
          </div>

          <div style={{ background: C.surface, borderRadius: 16, padding: '1.4rem', border: `1px solid ${C.border}`, boxShadow: SHADOW }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
              <span style={{ background: '#E6F6F1', color: C.premi, borderRadius: 10, padding: 7, display: 'inline-flex' }}><DollarSign size={18} /></span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: C.text }}>Laporan Keuangan</h3>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <LinkRow label="Wages Rebinmas (Current)" onClick={() => navigate('/wages-rebinmas')} />
              <LinkRow label="Wages Rebinmas (Comparison)" onClick={() => navigate('/wages-rebinmas?mode=comparison')} />
              <LinkRow label="Wages IJL (Current)" onClick={() => navigate('/wages-ijl')} />
              <LinkRow label="Wages IJL (Comparison)" onClick={() => navigate('/wages-ijl?mode=comparison')} />
              <LinkRow label="Detail Upah Bersih" onClick={() => navigate('/detail-upah-bersih')} />
            </div>
          </div>

          {!inProdMode && (
            <div style={{ background: C.surface, borderRadius: 16, padding: '1.4rem', border: `1px solid ${C.border}`, boxShadow: SHADOW }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                <span style={{ background: '#FEF3C7', color: '#D97706', borderRadius: 10, padding: 7, display: 'inline-flex' }}><FlaskConical size={18} /></span>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: C.text }}>Development &amp; Testing</h3>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <LinkRow label="Component Metadata Test" onClick={() => navigate('/test/components')} />
                <LinkRow label="Aggregation Seeder" onClick={() => navigate('/seed')} />
                <LinkRow label="Spreadsheet Sync" onClick={() => navigate('/spreadsheet-sync')} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
