import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import MonthSelector from '../components/common/MonthSelector';
import { isProdMode } from '../utils/prodModeUtils';
import { dashJson } from '../utils/dashboardApi';
import { getScopeLabel } from '../utils/gangTypes';
import {
    AreaChart, Area, ResponsiveContainer
} from 'recharts';
import {
    Settings, Info, BarChart2, ArrowRight, FlaskConical, DollarSign, Calculator,
    TrendingUp, Layers, Scale, Activity, AlertTriangle, Wallet
} from 'lucide-react';

// ===== Estate Ledger: tema bersama (SSOT: reportTheme) =====
import {
    C, SHADOW, CARD, SECTION_TITLE,
    ReportHero, ReportBody, StatCard, ScopeToggle, EmptyState, Skeleton, SectionHeader
} from '../components/report/reportTheme';
import {
    formatCompactIDR, formatNumberID, toSparklinePoints, findMissingWageDivisions
} from '../utils/dashboardDerivations';
import HeadcountSection from '../components/dashboard/HeadcountSection';
import CostStructureSection from '../components/dashboard/CostStructureSection';
import ProductivitySection from '../components/dashboard/ProductivitySection';
import PresentSlide from '../components/present/PresentSlide';
import PresentController from '../components/present/PresentController';
import usePresentMode from '../components/present/usePresentMode';

// ===== Formatters (formatCompactIDR/formatNumberID di-import dari dashboardDerivations) =====
const calcChange = (curr, prev) => {
    if (!prev) return null;
    return ((curr - prev) / prev) * 100;
};

// Tile launcher besar (flat, satu aksen daun). highlight = tile report utama (forest fill)
const Tile = ({ icon, title, desc, onClick, highlight = false }) => {
    const [hover, setHover] = React.useState(false);
    const s = highlight ? {
        bg: hover ? C.leafMid : C.leafDark,
        border: hover ? C.leafMid : C.leafDark,
        chipBg: 'rgba(255,255,255,0.14)', chipBorder: 'rgba(255,255,255,0.28)', chipColor: '#EAF5EE',
        title: '#FFFFFF', desc: 'rgba(234,245,238,0.72)', arrow: hover ? '#FFFFFF' : 'rgba(234,245,238,0.6)',
    } : {
        bg: C.surface,
        border: hover ? C.leafMid : C.border,
        chipBg: '#E9F2EA', chipBorder: '#C4DBC8', chipColor: C.leafMid,
        title: hover ? C.leafMid : C.text, desc: C.muted, arrow: hover ? C.leafMid : C.muted,
    };
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '1.1rem 1.2rem',
                background: s.bg, border: `1px solid ${s.border}`, boxShadow: SHADOW,
                transition: 'all .15s ease', minHeight: 108,
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ background: s.chipBg, border: `1px solid ${s.chipBorder}`, color: s.chipColor, borderRadius: 8, padding: 7, display: 'inline-flex' }}>{icon}</span>
                <ArrowRight size={17} style={{ color: s.arrow, transition: 'color .15s' }} />
            </div>
            <div>
                <div style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.01em', color: s.title, transition: 'color .15s' }}>{title}</div>
                {desc && <div style={{ fontSize: '0.76rem', color: s.desc, marginTop: 2, fontWeight: 500 }}>{desc}</div>}
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
                textAlign: 'left', padding: '0.65rem 0.9rem', border: `1px solid ${hover ? C.leafLight : C.border}`,
                borderRadius: 8, background: hover ? C.surface2 : C.surface, cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontWeight: 600, fontSize: '0.87rem', color: hover ? C.leafMid : C.text2, transition: 'all .15s'
            }}
        >
            {label} <span style={{ color: hover ? C.leafMid : C.muted, fontWeight: 800 }}>›</span>
        </button>
    );
};

export default function DashboardHome() {
    const { user, token } = useAuth();
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
    // Present mode: deck fullscreen per slide (toggle html.present-mode + HUD)
    const { presenting, activeIndex, enter, exit } = usePresentMode();

    const goOperational = () => ready && navigate('/operational');
    const goPajak = () => ready && navigate('/report-pajak');

    // ===== Data executive-summary (KPI, tren, breakdown, anomali) =====
    const [scope, setScope] = useState('panen');
    const [dashData, setDashData] = useState(null);
    const [dashLoading, setDashLoading] = useState(true);
    const [dashError, setDashError] = useState(null);

    const loadDashboard = useCallback(async () => {
        if (!token || !month || !year) return;
        setDashLoading(true);
        setDashError(null);
        try {
            // Pola sama dengan ExecutivePayrollPage: month, year, scope
            const json = await dashJson(`/executive-summary?month=${month}&year=${year}&scope=${scope}`, { token });
            if (json.success) {
                setDashData(json.data);
            } else {
                setDashData(null);
                setDashError(json.error || 'Gagal memuat ringkasan dashboard');
            }
        } catch (e) {
            console.error('Failed to load dashboard home summary:', e);
            setDashData(null);
            setDashError(e.message);
        } finally {
            setDashLoading(false);
        }
    }, [token, month, year, scope]);

    useEffect(() => { loadDashboard(); }, [loadDashboard]);

    // ===== Data kepersonaliaan (live master, fetch independen) =====
    const [headData, setHeadData] = useState(null);
    const [headLoading, setHeadLoading] = useState(true);
    const [headError, setHeadError] = useState(null);

    const loadHeadcount = useCallback(async () => {
        if (!token || !month || !year) return;
        setHeadLoading(true);
        setHeadError(null);
        try {
            const json = await dashJson(`/headcount-summary?month=${month}&year=${year}`, { token });
            if (json.success) {
                setHeadData(json.data);
            } else {
                setHeadData(null);
                setHeadError(json.error || 'Gagal memuat data kepersonaliaan');
            }
        } catch (e) {
            console.error('Failed to load headcount summary:', e);
            setHeadData(null);
            setHeadError(e.message);
        } finally {
            setHeadLoading(false);
        }
    }, [token, month, year]);

    useEffect(() => { loadHeadcount(); }, [loadHeadcount]);

    // ===== Data struktur biaya (agregasi, ikut scope) =====
    const [costData, setCostData] = useState(null);
    const [costLoading, setCostLoading] = useState(true);
    const [costError, setCostError] = useState(null);

    const loadCostStructure = useCallback(async () => {
        if (!token || !month || !year) return;
        setCostLoading(true);
        setCostError(null);
        try {
            const json = await dashJson(`/cost-structure?month=${month}&year=${year}&scope=${scope}`, { token });
            if (json.success) {
                setCostData(json.data);
            } else {
                setCostData(null);
                setCostError(json.error || 'Gagal memuat struktur biaya');
            }
        } catch (e) {
            console.error('Failed to load cost structure:', e);
            setCostData(null);
            setCostError(e.message);
        } finally {
            setCostLoading(false);
        }
    }, [token, month, year, scope]);

    useEffect(() => { loadCostStructure(); }, [loadCostStructure]);

    // ===== Derivasi KPI =====
    const kpi = dashData?.kpi || null;
    const trends = useMemo(() => (Array.isArray(dashData?.trends) ? dashData.trends : []), [dashData?.trends]);
    const currentTrend = trends[trends.length - 1] || {};
    const prevTrend = trends[trends.length - 2] || {};
    const costPerTon = currentTrend.cost_per_ton ?? null;
    const scopeLabel = getScopeLabel(scope);

    const wageSpikes = useMemo(() => (Array.isArray(dashData?.wageSpikes) ? dashData.wageSpikes : []), [dashData?.wageSpikes]);

    const missingWageDivisions = useMemo(
        () => findMissingWageDivisions(dashData?.breakdown),
        [dashData?.breakdown]
    );

    const sparkFor = (key, color) => (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={toSparklinePoints(trends, key)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.15} isAnimationActive={false} />
            </AreaChart>
        </ResponsiveContainer>
    );

    return (
        <div style={{ minHeight: '100%', background: C.pageBg, fontFamily: 'var(--font-body)' }}>
            {/* MASTHEAD datar */}
            <ReportHero
                eyebrow="Portal Estate · Daftar Upah"
                title={`Dashboard${user?.full_name || user?.username ? `, ${user?.full_name || user?.username}` : ''}`}
                subtitle="Pusat kendali laporan penggajian, pilih periode dan divisi lalu jelajahi analisis biaya, produktivitas, dan keuangan."
                period={periodLabel}
            />

            {/* PRESENT MODE - tombol Present (mode normal) + HUD deck (present mode) */}
            <div className="no-print" style={{ maxWidth: 1320, margin: '0 auto', padding: '0.75rem 2.4rem 0', display: 'flex', justifyContent: 'flex-end' }}>
                <PresentController
                    presenting={presenting}
                    activeIndex={activeIndex}
                    slideCount={2}
                    onEnter={enter}
                    onExit={exit}
                    caption={`Dashboard · ${periodLabel} · ${scopeLabel}`}
                />
            </div>

            <ReportBody>
                <PresentSlide num="01" id="slide-01" title="Ringkasan Kinerja" subtitle="KPI utama periode berjalan dalam satu pandangan">
                {/* KPI BAND: 6 ledger cell */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={SECTION_TITLE}>Ringkasan {periodLabel}</span>
                        <span style={{ fontSize: 11, color: C.muted }}>Cakupan: {scopeLabel}</span>
                    </div>
                    <ScopeToggle value={scope} onChange={setScope} />
                </div>

                {dashLoading ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12, marginBottom: '1.6rem' }}>
                        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={104} />)}
                    </div>
                ) : dashError || !kpi ? (
                    <div style={{ marginBottom: '1.6rem' }}>
                        <EmptyState
                            title="Ringkasan belum tersedia"
                            message={dashError ? `Gagal memuat data: ${dashError}` : 'Data executive summary kosong untuk periode ini.'}
                            actionLabel="Muat Ulang"
                            onAction={loadDashboard}
                        />
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12, marginBottom: '1.6rem' }}>
                        <StatCard label="Total Upah Kotor" value={formatCompactIDR(kpi.curr_wage)} pct={calcChange(kpi.curr_wage, kpi.prev_wage) ?? undefined} color={C.upah} note="vs bulan lalu" sparkline={sparkFor('total_wage', C.upah)} />
                        <StatCard label="Premi" value={formatCompactIDR(currentTrend.total_premi)} pct={calcChange(currentTrend.total_premi, prevTrend.total_premi) ?? undefined} color={C.premi} note="vs bulan lalu" sparkline={sparkFor('total_premi', C.premi)} />
                        <StatCard label="Lembur" value={formatCompactIDR(kpi.curr_ot)} pct={calcChange(kpi.curr_ot, kpi.prev_ot) ?? undefined} color={C.lembur} invert note="vs bulan lalu" sparkline={sparkFor('total_ot', C.lembur)} />
                        <StatCard label="Headcount" value={formatNumberID(kpi.curr_headcount)} pct={calcChange(kpi.curr_headcount, kpi.prev_headcount) ?? undefined} color={C.leafLight} note="karyawan" badge={kpi.headcount_source === 'live' ? 'live' : undefined} sparkline={sparkFor('total_headcount', C.leafLight)} />
                        <StatCard label="Tonase" value={`${formatNumberID(Math.round(currentTrend.total_tonase || 0))} ton`} pct={calcChange(currentTrend.total_tonase, prevTrend.total_tonase) ?? undefined} color={C.leafDark} note="vs bulan lalu" sparkline={sparkFor('total_tonase', C.leafDark)} />
                        <StatCard label="Cost/Ton" value={costPerTon !== null ? formatCompactIDR(costPerTon) : '-'} pct={calcChange(costPerTon, prevTrend.cost_per_ton) ?? undefined} color={C.costTon} invert note="upah per ton" sparkline={sparkFor('cost_per_ton', C.costTon)} />
                    </div>
                )}

                {/* INSIGHT STRIP: anomali lonjakan Cost/HK gang */}
                {!dashLoading && wageSpikes.length > 0 && (
                    <div style={{
                        ...CARD, padding: '12px 16px', marginBottom: '1.6rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                        borderLeft: `3px solid ${C.lembur}`
                    }}>
                        <span style={{ color: C.lembur, display: 'inline-flex', flexShrink: 0 }}><AlertTriangle size={17} /></span>
                        <span style={{ fontSize: '0.84rem', color: C.text2, lineHeight: 1.5 }}>
                            <b style={{ color: C.text }}>{wageSpikes.length} gang lonjak &gt;15% (Cost/HK):</b>{' '}
                            {wageSpikes.map(s => `${s.name} +${s.percentage.toFixed(0)}%`).join(', ')}
                        </span>
                        <button
                            onClick={() => navigate('/executive')}
                            style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.upah, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                            Lihat Executive Board <ArrowRight size={14} />
                        </button>
                    </div>
                )}

                {/* INSIGHT STRIP: divisi sudah produksi tapi upah belum tersedia */}
                {!dashLoading && missingWageDivisions.length > 0 && (
                    <div style={{
                        ...CARD, padding: '12px 16px', marginBottom: '1.6rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                        borderLeft: `3px solid ${C.warn}`
                    }}>
                        <span style={{ color: C.warn, display: 'inline-flex', flexShrink: 0 }}><AlertTriangle size={17} /></span>
                        <span style={{ fontSize: '0.84rem', color: C.text2, lineHeight: 1.5 }}>
                            <b style={{ color: C.text }}>{missingWageDivisions.length} divisi sudah produksi tapi upah belum tersedia:</b>{' '}
                            {missingWageDivisions.join(', ')}. Jalankan Aggregation Seeder agar analisis biaya lengkap.
                        </span>
                        <button
                            onClick={() => navigate('/seed')}
                            style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.upah, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                            Buka Aggregation Seeder <ArrowRight size={14} />
                        </button>
                    </div>
                )}
                </PresentSlide>

                {/* FEATURED ANALYSIS TILES: report utama ditaruh paling depan */}
                <SectionHeader title="Report &amp; Analisis Utama" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                    <Tile icon={<TrendingUp size={19} />} title="Executive Board" desc="KPI CEO, cost/ton, insight" onClick={() => navigate('/executive')} highlight />
                    <Tile icon={<Wallet size={19} />} title="Analisis Gaji" desc="Roster + rincian komponen per karyawan" onClick={() => navigate('/salary-analysis')} highlight />
                    <Tile icon={<Scale size={19} />} title="Analisis Tonase" desc="Biaya per ton & per HK" onClick={() => navigate('/tonase-analysis')} highlight />
                    <Tile icon={<BarChart2 size={19} />} title="Cost/Ton Story" desc="Infografis interaktif, presentasi" onClick={() => navigate('/cost-per-ton-story')} highlight />
                    <Tile icon={<Activity size={19} />} title="Produktivitas" desc="Tonase vs upah" onClick={() => navigate('/productivity')} />
                    <Tile icon={<Layers size={19} />} title="Comprehensive" desc="Analisis payroll menyeluruh" onClick={() => navigate('/comprehensive')} />
                </div>

                <PresentSlide num="02" id="slide-02" title="Analisis Komprehensif" subtitle="Kepersonaliaan, struktur biaya, dan produktivitas dalam satu pandangan">
                {/* SECTION: Kepersonaliaan & Headcount */}
                <SectionHeader title="Kepersonaliaan & Headcount" meta="Sumber: master karyawan live · seluruh divisi" />
                <div style={{ marginBottom: '1.8rem' }}>
                    <HeadcountSection
                        data={headData}
                        trends={trends}
                        loading={headLoading}
                        error={headError}
                        onRetry={loadHeadcount}
                    />
                </div>

                {/* SECTION: Efisiensi & Struktur Biaya */}
                <SectionHeader title="Efisiensi & Struktur Biaya" meta={`${periodLabel} · ${scopeLabel}`} />
                <div style={{ marginBottom: '1.8rem' }}>
                    <CostStructureSection
                        costData={costData}
                        trends={trends}
                        gangBreakdown={dashData?.gangBreakdown}
                        loading={costLoading}
                        error={costError}
                        onRetry={loadCostStructure}
                        periodLabel={periodLabel}
                        scopeLabel={scopeLabel}
                    />
                </div>

                {/* SECTION: Produktivitas */}
                <SectionHeader title="Produktivitas" meta={scopeLabel} />
                <div style={{ marginBottom: '1.8rem' }}>
                    <ProductivitySection
                        productivityTrend={dashData?.productivityTrend}
                        divisions={costData?.divisions}
                        loading={dashLoading || costLoading}
                        scopeLabel={scopeLabel}
                    />
                </div>
                </PresentSlide>

                {/* FILTER CARD */}
                <div style={{ ...CARD, padding: '1.6rem 1.8rem', marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.3rem' }}>
                        <span style={{ background: '#E9F2EA', border: '1px solid #C4DBC8', color: C.leafMid, borderRadius: 8, padding: 6, display: 'inline-flex' }}><Settings size={17} /></span>
                        <h2 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: C.leafMid, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filter Parameter</h2>
                    </div>

                    {currentPeriod && (
                        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.leafMid}`, borderRadius: 8, padding: '0.85rem 1rem', marginBottom: '1.3rem', display: 'flex', gap: 10 }}>
                            <Info size={17} style={{ color: C.leafMid, flexShrink: 0, marginTop: 2 }} />
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
                                    style={{ width: '100%', height: 44, padding: '0 1rem', fontSize: '0.92rem', border: `1px solid ${C.border}`, borderRadius: 8, backgroundColor: isLockedMode ? C.warnBg : C.surface, cursor: isLockedMode ? 'not-allowed' : 'pointer', color: C.text, outline: 'none' }}
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
                                    style={{ width: '100%', height: 44, padding: '0 1rem', fontSize: '0.92rem', border: `1px solid ${C.border}`, borderRadius: 8, cursor: gangLoading ? 'wait' : 'pointer', backgroundColor: gangLoading ? C.surface2 : C.surface, color: C.text, outline: 'none' }}
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
                    <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.9rem', flexWrap: 'wrap' }}>
                        {canSeeReportPajak && (
                            <button
                                onClick={goPajak} disabled={!ready}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.8rem 1.5rem', background: ready ? C.surface : C.surface2, color: ready ? C.costTon : C.muted, border: `1px solid ${ready ? C.costTon : C.border}`, borderRadius: 8, fontWeight: 700, fontSize: '0.88rem', cursor: ready ? 'pointer' : 'not-allowed', letterSpacing: '0.03em', transition: 'all .15s' }}
                            >
                                {gangLoading ? 'Memuat...' : 'REPORT PAJAK'} <Calculator size={16} />
                            </button>
                        )}
                        <button
                            onClick={goOperational} disabled={!ready}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.8rem 1.7rem', background: ready ? C.upah : C.surface2, color: ready ? '#fff' : C.muted, border: `1px solid ${ready ? C.upah : C.border}`, borderRadius: 8, fontWeight: 700, fontSize: '0.88rem', cursor: ready ? 'pointer' : 'not-allowed', letterSpacing: '0.03em', transition: 'all .15s' }}
                        >
                            {gangLoading ? 'Memuat...' : 'TAMPILKAN DATA UPAH'} <ArrowRight size={16} />
                        </button>
                    </div>
                </div>

                {/* REPORT PANELS */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
                    <div style={{ ...CARD, padding: '1.3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                            <span style={{ background: '#EFE9DC', border: '1px solid #D8CBAF', color: C.costTon, borderRadius: 8, padding: 6, display: 'inline-flex' }}><BarChart2 size={17} /></span>
                            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: C.text }}>Laporan Analisis &amp; Summary</h3>
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

                    <div style={{ ...CARD, padding: '1.3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                            <span style={{ background: '#E3EFEC', border: '1px solid #BFD8D3', color: C.premi, borderRadius: 8, padding: 6, display: 'inline-flex' }}><DollarSign size={17} /></span>
                            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: C.text }}>Laporan Keuangan</h3>
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                            <LinkRow label="Wages Rebinmas (Current)" onClick={() => navigate('/wages-rebinmas')} />
                            <LinkRow label="Wages Rebinmas (Comparison)" onClick={() => navigate('/wages-rebinmas?mode=comparison')} />
                            <LinkRow label="Wages IJL (Current)" onClick={() => navigate('/wages-ijl')} />
                            <LinkRow label="Wages IJL (Comparison)" onClick={() => navigate('/wages-ijl?mode=comparison')} />
                            <LinkRow label="Detail Upah Bersih" onClick={() => navigate('/detail-upah-bersih')} />
                        </div>
                    </div>

                    {/* LAPORAN LANJUTAN, orphan/hidden reports surfaced */}
                    <div style={{ ...CARD, padding: '1.3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                            <span style={{ background: C.warnBg, border: '1px solid #E5CFA3', color: C.lembur, borderRadius: 8, padding: 6, display: 'inline-flex' }}><TrendingUp size={17} /></span>
                            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: C.text }}>Laporan Lanjutan &amp; Lainnya</h3>
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                            <LinkRow label="Perbandingan Gang" onClick={() => navigate('/gang-comparison-report')} />
                            <LinkRow label="High Earners (Penghasilan Tertinggi)" onClick={() => navigate('/report/high-earners')} />
                            <LinkRow label="Salary Range Detail" onClick={() => navigate('/report/salary-range-detail')} />
                            <LinkRow label="Pendapatan Tidak Tetap / Lain" onClick={() => navigate('/pendapatan-tidak-tetap')} />
                            <LinkRow label="Produktivitas Kebun (Mill)" onClick={() => navigate('/mill-production')} />
                            <LinkRow label="Data Verification" onClick={() => navigate('/data-verification')} />
                        </div>
                    </div>

                    {!inProdMode && (
                        <div style={{ ...CARD, padding: '1.3rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
                                <span style={{ background: C.warnBg, border: '1px solid #E5CFA3', color: C.lembur, borderRadius: 8, padding: 6, display: 'inline-flex' }}><FlaskConical size={17} /></span>
                                <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: C.text }}>Development &amp; Testing</h3>
                            </div>
                            <div style={{ display: 'grid', gap: 8 }}>
                                <LinkRow label="Component Metadata Test" onClick={() => navigate('/test/components')} />
                                <LinkRow label="Aggregation Seeder" onClick={() => navigate('/seed')} />
                                <LinkRow label="Spreadsheet Sync" onClick={() => navigate('/spreadsheet-sync')} />
                            </div>
                        </div>
                    )}
                </div>
            </ReportBody>
        </div>
    );
}
