import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import MonthSelector from '../components/common/MonthSelector';
import { isProdMode } from '../utils/prodModeUtils';
import { dashJson } from '../utils/dashboardApi';
import { getScopeLabel } from '../utils/gangTypes';
import {
    AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
    Settings, Info, BarChart2, ArrowRight, FlaskConical, DollarSign, Calculator,
    TrendingUp, Layers, Scale, Activity, AlertTriangle, Wallet
} from 'lucide-react';

// ===== Estate Ledger: tema bersama (SSOT: reportTheme) =====
import {
    C, SHADOW, CARD, SECTION_TITLE, chartPalette,
    ReportHero, ReportBody, StatCard, ScopeToggle, EmptyState
} from '../components/report/reportTheme';
import PresentSlide from '../components/present/PresentSlide';
import PresentController from '../components/present/PresentController';
import usePresentMode from '../components/present/usePresentMode';

// ===== Formatters =====
const formatCompactIDR = (val) => {
    if (val === null || val === undefined || isNaN(val)) return '-';
    const n = Number(val);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};
const formatNumber = (val) => {
    if (val === null || val === undefined || isNaN(val)) return '-';
    return new Intl.NumberFormat('id-ID').format(val);
};
const calcChange = (curr, prev) => {
    if (!prev) return null;
    return ((curr - prev) / prev) * 100;
};

// Tile launcher besar (flat, satu aksen daun)
const Tile = ({ icon, title, desc, onClick }) => {
    const [hover, setHover] = React.useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '1.1rem 1.2rem',
                background: C.surface, border: `1px solid ${hover ? C.leafMid : C.border}`, boxShadow: SHADOW,
                transition: 'border-color .15s ease', minHeight: 108,
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ background: '#E9F2EA', border: '1px solid #C4DBC8', color: C.leafMid, borderRadius: 8, padding: 7, display: 'inline-flex' }}>{icon}</span>
                <ArrowRight size={17} style={{ color: hover ? C.leafMid : C.muted, transition: 'color .15s' }} />
            </div>
            <div>
                <div style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.01em', color: hover ? C.leafMid : C.text, transition: 'color .15s' }}>{title}</div>
                {desc && <div style={{ fontSize: '0.76rem', color: C.muted, marginTop: 2, fontWeight: 500 }}>{desc}</div>}
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

// Loading skeleton (pulse halus, bukan spinner)
const SkeletonBlock = ({ height = 120 }) => (
    <div className="el-skeleton" style={{ height, borderRadius: 10, background: C.surface2, border: `1px solid ${C.border}` }} />
);

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

    // ===== Derivasi KPI =====
    const kpi = dashData?.kpi || null;
    const trends = useMemo(() => (Array.isArray(dashData?.trends) ? dashData.trends : []), [dashData?.trends]);
    const currentTrend = trends[trends.length - 1] || {};
    const prevTrend = trends[trends.length - 2] || {};
    const costPerTon = currentTrend.cost_per_ton ?? null;
    const scopeLabel = getScopeLabel(scope);

    const wageSpikes = useMemo(() => (Array.isArray(dashData?.wageSpikes) ? dashData.wageSpikes : []), [dashData?.wageSpikes]);

    const divisionChartData = useMemo(() => {
        if (!dashData?.breakdown) return [];
        return [...dashData.breakdown]
            .sort((a, b) => (b.total_wage || 0) - (a.total_wage || 0))
            .map(d => ({ name: d.division_code, total: d.total_wage || 0, premi: d.total_premi || 0, ot: d.total_ot || 0 }));
    }, [dashData?.breakdown]);

    const tooltipStyle = {
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
        boxShadow: SHADOW, fontSize: 12, color: C.text
    };

    return (
        <div style={{ minHeight: '100%', background: C.pageBg, fontFamily: 'var(--font-body)' }}>
            <style>{`.el-skeleton{animation:elPulse 1.4s ease-in-out infinite}@keyframes elPulse{0%,100%{opacity:.55}50%{opacity:1}}`}</style>

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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: '1.6rem' }}>
                        {Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} height={104} />)}
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: '1.6rem' }}>
                        <StatCard label="Total Upah Kotor" value={formatCompactIDR(kpi.curr_wage)} pct={calcChange(kpi.curr_wage, kpi.prev_wage) ?? undefined} color={C.upah} note="vs bulan lalu" />
                        <StatCard label="Premi" value={formatCompactIDR(currentTrend.total_premi)} pct={calcChange(currentTrend.total_premi, prevTrend.total_premi) ?? undefined} color={C.premi} note="vs bulan lalu" />
                        <StatCard label="Lembur" value={formatCompactIDR(kpi.curr_ot)} pct={calcChange(kpi.curr_ot, kpi.prev_ot) ?? undefined} color={C.lembur} invert note="vs bulan lalu" />
                        <StatCard label="Headcount" value={formatNumber(kpi.curr_headcount)} pct={calcChange(kpi.curr_headcount, kpi.prev_headcount) ?? undefined} color={C.leafLight} note="karyawan" />
                        <StatCard label="Tonase" value={`${formatNumber(Math.round(currentTrend.total_tonase || 0))} ton`} pct={calcChange(currentTrend.total_tonase, prevTrend.total_tonase) ?? undefined} color={C.leafDark} note="vs bulan lalu" />
                        <StatCard label="Cost/Ton" value={costPerTon !== null ? formatCompactIDR(costPerTon) : '-'} pct={calcChange(costPerTon, prevTrend.cost_per_ton) ?? undefined} color={C.costTon} invert note="upah per ton" />
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
                </PresentSlide>

                <PresentSlide num="02" id="slide-02" title="Tren dan Breakdown Divisi" subtitle="Pergerakan upah 12 bulan dan sebaran upah antar divisi">
                {/* CHARTS: tren upah 12 bulan + breakdown divisi */}
                {!dashLoading && !dashError && trends.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.2rem', marginBottom: '1.8rem' }}>
                        <div style={CARD}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                                <div style={SECTION_TITLE}>Tren Upah 12 Bulan</div>
                                <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                            </div>
                            <ResponsiveContainer width="100%" height={230}>
                                <AreaChart data={trends} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <CartesianGrid stroke={C.gridLine} vertical={false} />
                                    <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                                    <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCompactIDR(v), 'Total Upah']} />
                                    <Area type="monotone" dataKey="total_wage" stroke={C.upah} strokeWidth={2} fill={C.upah} fillOpacity={0.12} isAnimationActive={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        <div style={CARD}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                                <div style={SECTION_TITLE}>Upah per Divisi ({periodLabel})</div>
                                <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                            </div>
                            {divisionChartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={230}>
                                    <BarChart data={divisionChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid stroke={C.gridLine} vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} />
                                        <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCompactIDR(v), 'Total Upah']} />
                                        <Bar dataKey="total" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                            {divisionChartData.map((_, i) => (
                                                <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <EmptyState title="Breakdown divisi kosong" message="Belum ada data divisi untuk periode ini." />
                            )}
                        </div>
                    </div>
                )}
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

                {/* FEATURED ANALYSIS TILES */}
                <div style={{ marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={SECTION_TITLE}>Analisis Utama</span>
                    <span style={{ flex: 1, height: 1, background: C.border }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                    <Tile icon={<TrendingUp size={19} />} title="Executive Board" desc="KPI CEO, cost/ton, insight" onClick={() => navigate('/executive')} />
                    <Tile icon={<BarChart2 size={19} />} title="Cost/Ton Story" desc="Infografis interaktif, presentasi" onClick={() => navigate('/cost-per-ton-story')} />
                    <Tile icon={<Wallet size={19} />} title="Analisis Gaji" desc="Roster + rincian komponen per karyawan" onClick={() => navigate('/salary-analysis')} />
                    <Tile icon={<Scale size={19} />} title="Analisis Tonase" desc="Biaya per ton & per HK" onClick={() => navigate('/tonase-analysis')} />
                    <Tile icon={<Activity size={19} />} title="Produktivitas" desc="Tonase vs upah" onClick={() => navigate('/productivity')} />
                    <Tile icon={<Layers size={19} />} title="Comprehensive" desc="Analisis payroll menyeluruh" onClick={() => navigate('/comprehensive')} />
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
