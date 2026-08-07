import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Treemap, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, Cell, LabelList, Legend, LineChart, Line, ReferenceLine } from 'recharts';
import { Printer } from 'lucide-react';
import { EmptyState } from '../components/report/reportTheme';
import { PresentSlide } from '../components/present/PresentSlide';
import { PresentController } from '../components/present/PresentController';
import { usePresentMode } from '../components/present/usePresentMode';
import { printReport, usePrintExpand } from '../utils/printPageSetup';
import { decomposeCost, costPerTon, productivity, benchmarkMean, deltaPct, heatColor, pivotDivisionSeries, movementBuckets } from '../utils/costPerTonStory.derive';
import '../styles/cost-per-ton-story.css';

const fmtIDR = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));
const fmtCompact = (v) => {
    if (v == null) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};
const fmtNum = (v, d = 0) => (v == null ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }));
const fmtPercent = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '-' : `${Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
// Label ringkas per segment stacked bar komposisi: 145.000 → "145k", 850 → "850".
const fmtSeg = (v) => {
    if (v == null || Number(v) === 0) return '';
    const n = Number(v);
    if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return n.toFixed(0);
};
// Label di dalam blok segment — tampil hanya jika segment cukup lebar (>= 44px).
const StackedSegLabel = (props) => {
    const { x, y, width, height, value } = props;
    if (!width || width < 44 || value == null || Number(value) === 0) return null;
    return (
        <text x={x + width / 2} y={y + height / 2} dy="0.32em" textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700} style={{ pointerEvents: 'none' }}>
            {fmtSeg(value)}
        </text>
    );
};

// Count-up animation
function CountUp({ value, format = fmtCompact, duration = 1200 }) {
    const [n, setN] = useState(0);
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || value == null) { setN(value); return; }
        let raf, start;
        const step = (t) => {
            if (!start) start = t;
            const p = Math.min(1, (t - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            setN(value * eased);
            if (p < 1) raf = requestAnimationFrame(step);
        };
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) { raf = requestAnimationFrame(step); io.disconnect(); }
        }, { threshold: 0.3 });
        io.observe(el);
        return () => { cancelAnimationFrame(raf); io.disconnect(); };
    }, [value, duration]);
    return <span ref={ref}>{format(n)}</span>;
}

// Scroll-reveal hook
function useReveal() {
    const ref = useRef(null);
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const el = ref.current; if (!el) return;
        const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.12 });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    return [ref, shown];
}

const GANG_TYPE_LABEL = { harvesting: 'Panen', transport: 'Transport', maintenance: 'Perawatan', uncategorized: 'Lainnya' };
const GANG_TYPE_ORDER = ['harvesting', 'transport', 'maintenance', 'uncategorized'];
const GANG_TYPE_COLOR = { harvesting: '#1F6F43', transport: '#B45309', maintenance: '#0F766E', uncategorized: '#8A958E' };

const ACTS = [
    { id: 'act1', label: 'Total' },
    { id: 'act2', label: 'Divisi' },
    { id: 'act3', label: 'Komposisi' },
    { id: 'act4', label: 'Efisiensi' },
    { id: 'act5', label: 'Anomali' },
    { id: 'act6', label: 'Gerak' },
];

export default function CostPerTonStoryPage() {
    const { token } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const month = parseInt(searchParams.get('month')) || 1;
    const year = parseInt(searchParams.get('year')) || 2026;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [periods, setPeriods] = useState([]);
    const [drill, setDrill] = useState(null);
    const [activeAct, setActiveAct] = useState('act1');
    const drillRef = useRef(null);
    const [trend, setTrend] = useState(null);
    const [trendLoading, setTrendLoading] = useState(false);
    const [trendError, setTrendError] = useState(null);
    const act6Ref = useRef(null);
    // Jenis gang yang ikut dihitung upah kotornya (dibagi tonase divisi). Default: panen saja.
    const [gangTypes, setGangTypes] = useState(['harvesting']);
    const [gangRows, setGangRows] = useState(null);
    // Act 3 drill: { division, component: 'GajiPokok'|'Lembur'|'Premi' }
    const [act3Drill, setAct3Drill] = useState(null);
    // Hero KPI drill: null | 'upah' | 'cpt' | 'tonase'
    const [heroDrill, setHeroDrill] = useState(null);
    const { presenting, activeIndex, enter, exit } = usePresentMode();
    // During print: semua uraian klik-reveal (hero breakdown, bedah gang per divisi, dekomposisi) dirender lengkap.
    const printExpanded = usePrintExpand();

    // Act 6: fetch cross-division cost/ton timeline bersama load utama (data kecil, ~74 rows)
    const trendLoadedKey = useRef('');
    useEffect(() => {
        const key = `${month}-${year}-${gangTypes.join(',')}`;
        if (trendLoadedKey.current === key) return;
        trendLoadedKey.current = key;
        let cancelled = false;
        (async () => {
            setTrendLoading(true); setTrendError(null);
            try {
                const gt = gangTypes.join(',');
                const r = await fetch(`/backend/upah/payroll/dashboard/division-cost-trend?month=${month}&year=${year}&span=8&gang_types=${encodeURIComponent(gt)}`, { headers: { 'X-API-Key': localStorage.getItem('api_key') || '', Authorization: `Bearer ${token}` } });
                const j = await r.json();
                if (cancelled) { trendLoadedKey.current = ''; return; }
                if (j.success) setTrend(j.data.series); else { setTrendError(j.error || 'Gagal memuat gerak divisi'); trendLoadedKey.current = ''; }
            } catch (e) { if (!cancelled) { setTrendError(e.message); trendLoadedKey.current = ''; } }
            finally { if (!cancelled) setTrendLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [token, month, year, gangTypes]);

    useEffect(() => {
        (async () => {
            try {
                const r = await fetch('/backend/upah/payroll/dashboard/available-periods', { headers: { 'X-API-Key': localStorage.getItem('api_key') || '', Authorization: `Bearer ${token}` } });
                const j = await r.json();
                if (j.success) setPeriods(j.data);
            } catch { /* ignore */ }
        })();
    }, [token]);

    // Tanpa pilihan bulan/tahun di URL → lompat langsung ke periode TERAKHIR yang tersedia
    // (available-periods urut DESC: indeks 0 = terbaru), bukan default Januari 2026.
    const hasPeriodParam = searchParams.has('month') && searchParams.has('year');
    const [periodAutoJumped, setPeriodAutoJumped] = useState(false);
    useEffect(() => {
        if (!hasPeriodParam && periods.length > 0 && !periodAutoJumped) {
            const latest = periods[0];
            const n = new URLSearchParams(searchParams);
            n.set('month', String(latest.month));
            n.set('year', String(latest.year));
            setSearchParams(n, { replace: true });
            setPeriodAutoJumped(true);
        }
    }, [periods, hasPeriodParam, periodAutoJumped, searchParams, setSearchParams]);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const headers = { Authorization: `Bearer ${token}` };
            const [rSum, rGang] = await Promise.all([
                fetch(`/backend/upah/payroll/dashboard/executive-summary?month=${month}&year=${year}`, { headers }),
                fetch(`/backend/upah/payroll/dashboard/cost-hk-comparison?month=${month}&year=${year}`, { headers }),
            ]);
            const j = await rSum.json();
            const jg = await rGang.json();
            if (j.success) setData(j.data); else setError(j.error || 'Gagal memuat');
            if (jg?.success) setGangRows(jg.gang_details || []);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }, [token, month, year]);
    useEffect(() => { if (token) load(); }, [load]);

    // Breakdown per divisi: tonase dari executive-summary (authoritative per divisi),
    // upah/HK/premi/lembur/headcount = agregasi gang yang jenisnya dipilih user.
    const breakdown = useMemo(() => {
        const base = data?.breakdown || [];
        // tonase map dari base (authoritative) + fallback dari trend last point
        const tonaseByDiv = new Map(base.map(d => [String(d.division_code).toUpperCase(), Number(d.total_tonase) || 0]));
        if (!gangRows) return base;
        const wanted = new Set(gangTypes);
        const agg = new Map();
        for (const g of gangRows) {
            if (!wanted.has(g.gang_type)) continue;
            const key = String(g.division_code).toUpperCase();
            if (!agg.has(key)) agg.set(key, { wage: 0, lembur: 0, premi: 0, hk: 0, hc: 0, tonase: tonaseByDiv.get(key) ?? 0 });
            const a = agg.get(key);
            a.wage += Number(g.total_cost) || 0;
            a.lembur += Number(g.total_lembur) || 0;
            a.premi += Number(g.total_premi) || 0;
            a.hk += Number(g.total_hk) || 0;
            a.hc += Number(g.headcount) || 0;
        }
        // jika Panen saja → base 3 divs cukup; jika Transport/Perawatan/all → perlu union divs dari agg + tonase
        const allCodes = new Set([...tonaseByDiv.keys(), ...agg.keys()]);
        // filter hanya divs dengan tonase>0 atau ada di agg (punya gang terpilih)
        return [...allCodes].map(code => {
            const a = agg.get(code);
            const tonase = tonaseByDiv.get(code) ?? a?.tonase ?? 0;
            if (!a) {
                const src = base.find(d => String(d.division_code).toUpperCase() === code);
                return src ? { ...src, total_wage: 0, total_ot: 0, total_lembur: 0, total_premi: 0, total_hk: 0, headcount: 0 } : { division_code: code, total_tonase: tonase, total_wage: 0, total_ot: 0, total_lembur: 0, total_premi: 0, total_hk: 0, headcount: 0 };
            }
            const src = base.find(d => String(d.division_code).toUpperCase() === code);
            return { ...(src || { division_code: code }), total_wage: a.wage, total_ot: a.lembur, total_lembur: a.lembur, total_premi: a.premi, total_hk: a.hk, headcount: a.hc, total_tonase: tonase };
        });
    }, [data, gangRows, gangTypes]);
    // History estate yang IKUT gang filter: dibangun dari state `trend` (division-cost-trend
    // dikirim gang_types), bukan data.trends executive-summary yang unfiltered. Ini bikin
    // kartu "Cost per Ton" (overallCpt), "% vs lalu", dan grafik Riwayat selalu sejalan
    // dengan pill Panen/Transport/Perawatan.
    const filteredHistory = useMemo(() => {
        const rows = trend && trend.length > 0 ? trend : (data?.trends || []);
        const byPeriod = new Map();
        for (const r of rows) {
            const m = Number(r.month || r.period_month) || 0;
            const y = Number(r.year || r.period_year) || 0;
            const k = `${y}-${String(m).padStart(2, '0')}`;
            if (!byPeriod.has(k)) byPeriod.set(k, { period: r.period, year: y, month: m, total_wage: 0, total_tonase: 0, total_hk: 0 });
            const p = byPeriod.get(k);
            const ton = Number(r.tonase ?? r.total_tonase) || 0;
            // Hanya wage dari divisi yang BENAR-BENAR memproduksi tonase (tonase > 0) —
            // mirror divsWithTon di KPI. Tanpa ini, wage divisi tanpa tonase (mis. IJL/NRS/WKS)
            // ikut terhitung dan cost/ton grafik meleset tinggi (mis. Sep 2025: 360.106 vs 267.959).
            if (ton > 0) p.total_wage += Number(r.wage ?? r.total_wage) || 0;
            p.total_tonase += ton;
            p.total_hk += Number(r.hk ?? r.total_hk) || 0;
        }
        return [...byPeriod.values()]
            .sort((a, b) => a.year - b.year || a.month - b.month)
            .map(p => ({ ...p, cost_per_ton: p.total_tonase > 0 ? p.total_wage / p.total_tonase : null }));
    }, [trend, data]);
    const currTrend = filteredHistory[filteredHistory.length - 1] || {};
    const prevTrend = filteredHistory[filteredHistory.length - 2] || {};

    const divsWithTon = useMemo(() => breakdown.filter(d => Number(d.total_tonase) > 0), [breakdown]);
    // Divisi ber-tonase yang belum punya data upah (upah_available=0): tonase tetap dihitung,
    // tapi dikecualikan dari cost/ton (wage 0 / tonase = salah tafsir).
    const divsWithUpah = useMemo(() => divsWithTon.filter(d => d.upah_available !== 0), [divsWithTon]);
    const missingWageDivs = useMemo(() => divsWithTon.filter(d => d.upah_available === 0), [divsWithTon]);
    const meanCpt = useMemo(() => benchmarkMean(breakdown), [breakdown]);
    const cptValues = useMemo(() => divsWithUpah.map(d => costPerTon(d)).filter(v => v != null), [divsWithUpah]);
    const minCpt = cptValues.length ? Math.min(...cptValues) : null;
    const maxCpt = cptValues.length ? Math.max(...cptValues) : null;

    const totalWage = divsWithUpah.reduce((s, d) => s + Number(d.total_wage || 0), 0);
    const totalTonase = divsWithUpah.reduce((s, d) => s + Number(d.total_tonase || 0), 0);
    const overallCpt = totalTonase > 0 ? totalWage / totalTonase : null;
    const overallDelta = deltaPct({ total_wage: currTrend.total_wage, total_tonase: currTrend.total_tonase }, { total_wage: prevTrend.total_wage, total_tonase: prevTrend.total_tonase });

    // Act 5: anomali - join breakdown with prev breakdown via trends not available per-div; use overall delta + per-div current cpt vs mean
    const anomali = useMemo(() => {
        if (!meanCpt) return [];
        return divsWithUpah.map(d => {
            const cpt = costPerTon(d);
            const diff = ((cpt - meanCpt) / meanCpt) * 100;
            return { code: d.division_code, cpt, diff, tonase: d.total_tonase, hk: d.total_hk };
        }).sort((a, b) => b.diff - a.diff);
    }, [divsWithUpah, meanCpt]);

    // scroll spy for active act
    useEffect(() => {
        const handlers = ACTS.map(a => {
            const el = document.getElementById(a.id);
            if (!el) return null;
            const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setActiveAct(a.id); }, { threshold: 0.4 });
            io.observe(el);
            return io;
        });
        return () => handlers.forEach(h => h && h.disconnect());
    }, [data]);

    const scrollToAct = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

    const openDrill = (code) => {
        setDrill(code);
        setTimeout(() => drillRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    };

    if (loading) return <div className="cpts-page"><div className="cpts-empty">Memuat cerita cost/ton…</div></div>;
    if (error) return <div className="cpts-page"><EmptyState title="Gagal memuat" message={error} actionLabel="Coba lagi" onAction={load} /></div>;
    if (!data) return null;

    const periodLabel = new Date(year, month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    return (
        <div className="cpts-page">
            {/* Sticky bar */}
            <div className="cpts-sticky-bar">
                <span className="title">Cost per Ton · Story</span>
                <button onClick={() => printReport({ orientation: 'landscape', margin: '6mm' })} title="Cetak laporan lengkap (semua uraian terbuka)" className="cpts-print-btn">
                    <Printer size={14} /> Cetak
                </button>
                <select value={`${year}-${month}`} onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); const n = new URLSearchParams(searchParams); n.set('year', y); n.set('month', m); setSearchParams(n); }}>
                    {(periods.length ? periods : [{ year, month }]).map((p, i) => <option key={i} value={`${p.year}-${p.month}`}>{new Date(p.year, p.month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</option>)}
                </select>
                <div className="cpts-filter-pills" title="Jenis gang yang upah kotornya dihitung (dibagi tonase divisi)">
                    <span className="lbl">Upah:</span>
                    {GANG_TYPE_ORDER.filter(t => t !== 'uncategorized').map(t => {
                        const on = gangTypes.includes(t);
                        return (
                            <button key={t} onClick={() => setGangTypes(prev => on ? (prev.length > 1 ? prev.filter(x => x !== t) : prev) : [...prev, t])}
                                className="cpts-pill"
                                style={{ borderColor: GANG_TYPE_COLOR[t], background: on ? GANG_TYPE_COLOR[t] : 'transparent', color: on ? '#fff' : GANG_TYPE_COLOR[t] }}>
                                {GANG_TYPE_LABEL[t]}
                            </button>
                        );
                    })}
                </div>
                <div className="cpts-act-nav">
                    {ACTS.map(a => <button key={a.id} className={activeAct === a.id ? 'active' : ''} onClick={() => scrollToAct(a.id)}>{a.label}</button>)}
                </div>
                <PresentController
                    presenting={presenting}
                    activeIndex={activeIndex}
                    slideCount={6}
                    onEnter={enter}
                    onExit={exit}
                    caption={`Cost per Ton · ${periodLabel} · Upah ${gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')}`}
                />
            </div>

            {/* Dek interaktif (layar saja; cetakan memakai lampiran tabel) */}
            <div className="cpts-interactive">
            {/* ACT 1 - hero */}
            <PresentSlide num="01" id="act1" title="Berapa yang kita habiskan per ton TBS?" subtitle="Titik mulut: total biaya tenaga kerja panen dibanding tonase TBS yang masuk. Angka ini adalah detak biaya paling kasat mata.">
            <div className="cpts-act in-view">
                {overallCpt == null ? (
                    <EmptyState title="Tonase belum aktif" message="Sumber tonase TBS belum terisi untuk periode ini. Total biaya dan cost/ton tidak dapat dihitung." />
                ) : (
                    <>
                        <div className="cpts-hero-grid">
                            <div className="cpts-hero-card" onClick={() => setHeroDrill(v => v === 'upah' ? null : 'upah')} style={{ cursor: 'pointer' }} title="Klik untuk uraian per divisi"><div className="accent" style={{ background: 'var(--c-upah)' }} /><div className="lbl">Total Upah Kotor Panen</div><div className="big"><CountUp value={totalWage} /></div><div className="sub">{divsWithTon.length} divisi panen · klik untuk uraian</div></div>
                            <div className="cpts-hero-card" onClick={() => setHeroDrill(v => v === 'cpt' ? null : 'cpt')} style={{ cursor: 'pointer' }} title="Klik untuk uraian per divisi"><div className="accent" style={{ background: 'var(--c-cost)' }} /><div className="lbl">Cost per Ton</div><div className="big" style={{ color: 'var(--c-cost)' }}><CountUp value={overallCpt} /></div><div className="sub">{overallDelta == null ? 'periode awal' : `${overallDelta >= 0 ? '▲' : '▼'} ${Math.abs(overallDelta).toFixed(1)}% vs lalu`} · klik uraian</div></div>
                            <div className="cpts-hero-card" onClick={() => setHeroDrill(v => v === 'tonase' ? null : 'tonase')} style={{ cursor: 'pointer' }} title="Klik untuk uraian per divisi"><div className="accent" style={{ background: 'var(--c-leafLight)' }} /><div className="lbl">Tonase TBS</div><div className="big"><CountUp value={totalTonase} format={(v) => `${fmtNum(v, 1)} t`} /></div><div className="sub">dari mill supplier · klik uraian</div></div>
                        </div>
                        {heroDrill && <HeroBreakdown mode={heroDrill} breakdown={divsWithTon} gangRows={gangRows} gangTypes={gangTypes} meanCpt={meanCpt} onClose={() => setHeroDrill(null)} onPickDivision={(code) => { setHeroDrill(null); setDrill(code); setTimeout(() => drillRef.current?.scrollIntoView({ behavior: 'smooth' }), 80); }} />}
                        {missingWageDivs.length > 0 && (
                            <div style={{ marginTop: 16, padding: '11px 14px', background: '#FBF1DE', border: '1px solid #EDD9B4', borderLeft: `4px solid var(--c-warn)`, borderRadius: 10, fontSize: 13, color: 'var(--c-ink2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 800, color: 'var(--c-warn)' }}>⚠</span>
                                <span><b>{missingWageDivs.length} divisi memproduksi tonase tapi data upah belum masuk</b> ({missingWageDivs.map(d => d.division_code).join(', ')}). Tonase tetap dihitung; cost/ton dihitung dari divisi yang sudah punya upah.</span>
                            </div>
                        )}
                        <div className="cpts-hero-punch">
                            {overallDelta == null
                                ? `Setiap ton TBS bulan ini keluar ${fmtCompact(overallCpt)}. Belum ada pembanding bulan lalu.`
                                : overallDelta > 0
                                    ? `Biaya per ton NAIK ${overallDelta.toFixed(1)}% vs bulan lalu · ${fmtCompact(overallCpt)} per ton. Perlu ditelusuran divisi mana yang mendorong kenaikan.`
                                    : `Biaya per ton TURUN ${Math.abs(overallDelta).toFixed(1)}% vs bulan lalu · ${fmtCompact(overallCpt)} per ton. Efisiensi membaik.`}
                        </div>

                        {/* History: total cost/ton + tonase movement across months */}
                        {filteredHistory.length > 1 && (
                            <div style={{ marginTop: 24, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 16, padding: '20px 20px 12px', boxShadow: '0 1px 2px rgba(18,36,26,.05), 0 6px 18px rgba(18,36,26,.08)' }}>
                                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--c-leafMid)', marginBottom: 4 }}>Riwayat {filteredHistory.length} Bulan</div>
                                <div style={{ fontSize: 13, color: 'var(--c-text2)', marginBottom: 12 }}>Garis cokelat = cost/ton (kiri) · Garis hijau = tonase TBS (kanan) · Upah yang dihitung: <strong>{gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')}</strong></div>
                                <div style={{ height: 280 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={filteredHistory} margin={{ top: 8, right: 36, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DFE8E0" />
                                            <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#7C8B80' }} />
                                            <YAxis yAxisId="l" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#7C5A2B' }} />
                                            <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11, fill: '#1F6F43' }} />
                                            <Tooltip
                                                formatter={(val, name) => [name === 'cost_per_ton' ? fmtIDR(val) : `${fmtNum(val, 1)} t`, name === 'cost_per_ton' ? 'Cost/Ton' : 'Tonase']}
                                                contentStyle={{ borderRadius: 10, border: '1px solid #DFE8E0', fontSize: 13 }}
                                                labelStyle={{ fontWeight: 700 }}
                                            />
                                            <Legend formatter={(v) => v === 'cost_per_ton' ? 'Cost/Ton' : 'Tonase TBS'} />
                                            <Line yAxisId="l" type="monotone" dataKey="cost_per_ton" name="cost_per_ton" stroke="#7C5A2B" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                                            <Line yAxisId="r" type="monotone" dataKey="total_tonase" name="total_tonase" stroke="#1F6F43" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
            </PresentSlide>

            {/* ACT 2 - treemap */}
            <Act id="act2" num="02" title="Dari mana datangnya tonase?" lede="Setiap blok = satu divisi, ukuran proporsional tonase, warna = cost/ton (hijau murah → merah mahal). Hover blok untuk detail · Klik blok untuk bedah.">
                {divsWithTon.length === 0 ? <EmptyState title="Tonase belum aktif" message="Tidak ada divisi dengan tonase > 0 di periode ini." /> : (() => {
                    // Ranking cost/ton: 1 = termahal (merah pekat), terakhir = termurah (hijau).
                    // Divisi ber-tonase tanpa data upah (upah_available=0) dikeluarkan dari ranking
                    // cost/ton (cpt=0 menyesatkan) tapi tonasenya tetap tampil di treemap.
                    const ranked = divsWithTon
                        .map(d => ({ d, cpt: d.upah_available === 0 ? null : costPerTon(d), ton: Number(d.total_tonase) || 0, hk: Number(d.total_hk) || 0 }))
                        .filter(x => x.cpt != null && x.ton > 0)
                        .sort((a, b) => b.cpt - a.cpt);
                    const totalTon = ranked.reduce((s, x) => s + x.ton, 0);
                    const worst = ranked.slice(0, 3);
                    const best = ranked.slice(-3).reverse();
                    return (
                        <>
                        <div className="cpts-treemap-wrap">
                            <ResponsiveContainer width="100%" height="100%">
                                <Treemap
                                    data={ranked.map((x, i) => ({
                                        name: x.d.division_code,
                                        size: x.ton,
                                        cpt: x.cpt,
                                        rank: i + 1,
                                        hk: x.hk,
                                        share: totalTon > 0 ? (x.ton / totalTon) * 100 : 0
                                    }))}
                                    dataKey="size" stroke="#fff" content={<TreemapCell minCpt={minCpt} maxCpt={maxCpt} onClick={openDrill} />}>
                                    <Tooltip content={({ payload }) => {
                                        const p = payload?.[0]?.payload;
                                        if (!p) return null;
                                        return (
                                            <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 10, padding: '10px 12px', fontSize: 12, boxShadow: '0 8px 24px rgba(18,36,26,.12)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, marginBottom: 6 }}>
                                                    <span style={{ width: 10, height: 10, borderRadius: 3, background: heatColor(p.cpt, minCpt, maxCpt), flexShrink: 0 }} />
                                                    {p.name} <span style={{ color: 'var(--c-muted)', fontSize: 11 }}>#{p.rank}</span>
                                                </div>
                                                <div>Cost/Ton: <strong>{fmtCompact(p.cpt)}</strong> {p.rank <= 3 && <span style={{ color: 'var(--c-red)' }}>▲ termahal</span>}</div>
                                                <div>Tonase: <strong>{fmtNum(p.size, 1)} t</strong> ({fmtPercent(p.share)} total)</div>
                                                <div style={{ color: 'var(--c-muted)' }}>HK: {fmtNum(p.hk, 0)} · klik untuk bedah</div>
                                            </div>
                                        );
                                    }} />
                                </Treemap>
                            </ResponsiveContainer>
                        </div>

                        {/* Legenda warna: gradien min→max cost/ton + arti tiap warna + rata-rata */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--c-text2)', marginTop: 14, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700 }}>Murah</span>
                            <span style={{ display: 'flex', width: 160, height: 10, borderRadius: 5, overflow: 'hidden', border: '1px solid var(--c-border)' }}>
                                <i style={{ flex: '1 1 0', background: '#1F6F43', display: 'block' }} />
                                <i style={{ flex: '1 1 0', background: '#B45309', display: 'block' }} />
                                <i style={{ flex: '1 1 0', background: '#B3392E', display: 'block' }} />
                            </span>
                            <span style={{ fontWeight: 700 }}>Mahal</span>
                            {minCpt != null && maxCpt != null && (
                                <span style={{ fontSize: 11, color: 'var(--c-muted)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
                                    <span style={{ color: '#1F6F43', fontWeight: 800 }}>{fmtNum(minCpt, 0)}/t</span>
                                    <span style={{ color: '#B45309', fontWeight: 700 }}>{fmtNum((minCpt + maxCpt) / 2, 0)}/t</span>
                                    <span style={{ color: '#B3392E', fontWeight: 800 }}>{fmtNum(maxCpt, 0)}/t</span>
                                </span>
                            )}
                            {meanCpt != null && <span style={{ marginLeft: 'auto', fontWeight: 800, color: 'var(--c-ink)' }}>Rata-rata: {fmtCompact(meanCpt)}/t</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--c-muted)', marginTop: 8, lineHeight: 1.6 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: '#1F6F43', display: 'inline-block' }} /> Hijau = cost/ton di bawah rata-rata (murah / efisien)</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: '#B45309', display: 'inline-block' }} /> Kuning = sekitar rata-rata</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 3, background: '#B3392E', display: 'inline-block' }} /> Merah = cost/ton di atas rata-rata (mahal · perlu perhatian)</span>
                        </div>

                        {/* Ranking di dalam blok komposisi */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 16 }}>
                            <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '12px 14px' }}>
                                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-red)', marginBottom: 8 }}>Cost/Ton Termahal</div>
                                {worst.map(x => (
                                    <div key={x.d.division_code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: 3, background: heatColor(x.cpt, minCpt, maxCpt), flexShrink: 0 }} />
                                        <span style={{ fontWeight: 800 }}>{x.d.division_code}</span>
                                        <span style={{ marginLeft: 'auto', color: 'var(--c-muted)' }}>{fmtCompact(x.cpt)}/t</span>
                                    </div>
                                ))}
                            </div>
                            <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '12px 14px' }}>
                                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1F6F43', marginBottom: 8 }}>Cost/Ton Termurah</div>
                                {best.map(x => (
                                    <div key={x.d.division_code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: 3, background: heatColor(x.cpt, minCpt, maxCpt), flexShrink: 0 }} />
                                        <span style={{ fontWeight: 800 }}>{x.d.division_code}</span>
                                        <span style={{ marginLeft: 'auto', color: 'var(--c-muted)' }}>{fmtCompact(x.cpt)}/t</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        </>
                    );
                })()}
            </Act>

            {/* ACT 3 - dekomposisi */}
            <Act id="act3" num="03" title="Kenapa cost/ton naik?" lede={`Upah kotor gang ${gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')} diurai jadi gaji pokok, lembur, premi, dinormalisasi per ton TBS divisi. Divisi yang mahal karena lembur = cerita operasional berbeda dari yang mahal karena premi.`}>
                {divsWithUpah.length === 0 ? <EmptyState title="Tonase belum aktif" message="Dekomposisi butuh divisi dengan upah + tonase > 0." /> : (
                    <div className="cpts-decomp-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={divsWithUpah.map(d => {
                                const dec = decomposeCost(d); const ton = Number(d.total_tonase);
                                return { name: d.division_code, ton, GajiPokok: dec.gajiPokok / ton, Lembur: dec.lembur / ton, Premi: dec.premi / ton, totGaji: dec.gajiPokok, totLembur: dec.lembur, totPremi: dec.premi };
                            }).sort((a, b) => (b.GajiPokok + b.Lembur + b.Premi) - (a.GajiPokok + a.Lembur + a.Premi))} layout="vertical" margin={{ left: 30, right: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#DFE8E0" />
                                <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#7C8B80' }} label={{ value: 'Rp per ton TBS', position: 'insideBottom', offset: -4, fontSize: 10, fill: '#7C8B80' }} />
                                <YAxis type="category" dataKey="name" width={40} tick={{ fontSize: 12, fill: '#12241A', fontWeight: 700 }} />
                                <Tooltip content={({ payload, label }) => {
                                    const p = payload?.[0]?.payload;
                                    if (!p) return null;
                                    const Row = ({ nama, perTon, total, warna }) => (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 3 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: 2, background: warna, flexShrink: 0 }} />
                                            <span style={{ color: '#7C8B80', minWidth: 62 }}>{nama}</span>
                                            <strong>{fmtIDR(perTon)}/t</strong>
                                            <span style={{ color: '#7C8B80', fontSize: 11 }}>(total {fmtCompact(total)})</span>
                                        </div>
                                    );
                                    return (
                                        <div style={{ background: '#fff', border: '1px solid #DFE8E0', borderRadius: 10, padding: '10px 12px', fontSize: 12 }}>
                                            <div style={{ fontWeight: 800, marginBottom: 2 }}>{label} <span style={{ fontWeight: 400, color: '#7C8B80' }}>· {fmtNum(p.ton, 1)} ton</span></div>
                                            <Row nama="Gaji pokok" perTon={p.GajiPokok} total={p.totGaji} warna="#1F6F43" />
                                            <Row nama="Lembur" perTon={p.Lembur} total={p.totLembur} warna="#B45309" />
                                            <Row nama="Premi" perTon={p.Premi} total={p.totPremi} warna="#7C5A2B" />
                                        </div>
                                    );
                                }} contentStyle={{ borderRadius: 10, border: '1px solid #DFE8E0', fontSize: 13 }} />
                                <Legend />
                                <Bar dataKey="GajiPokok" name="Gaji Pokok / ton" stackId="a" fill="#1F6F43" onClick={(p) => setAct3Drill({ division: p.name, component: 'GajiPokok' })} style={{ cursor: 'pointer' }}>
                                    <LabelList dataKey="GajiPokok" content={<StackedSegLabel />} />
                                </Bar>
                                <Bar dataKey="Lembur" name="Lembur / ton" stackId="a" fill="#B45309" onClick={(p) => setAct3Drill({ division: p.name, component: 'Lembur' })} style={{ cursor: 'pointer' }}>
                                    <LabelList dataKey="Lembur" content={<StackedSegLabel />} />
                                </Bar>
                                <Bar dataKey="Premi" name="Premi / ton" stackId="a" fill="#7C5A2B" radius={[0, 4, 4, 0]} onClick={(p) => setAct3Drill({ division: p.name, component: 'Premi' })} style={{ cursor: 'pointer' }}>
                                    <LabelList dataKey="Premi" content={<StackedSegLabel />} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        <div style={{ fontSize: 11, color: '#7C8B80', marginTop: 6 }}>Klik segmen bar untuk uraian per gang.</div>
                    </div>
                )}
                {act3Drill && (
                    <Act3GangDrill division={act3Drill.division} component={act3Drill.component} gangRows={gangRows} gangTypes={gangTypes} tonase={Number(divsWithTon.find(d => d.division_code === act3Drill.division)?.total_tonase) || 0} onClose={() => setAct3Drill(null)} />
                )}
            </Act>

            {/* ACT 4 - scatter efisiensi */}
            <Act id="act4" num="04" title="Siapa efisien?" lede="Sumbu X = produktivitas (ton/HK), Y = cost/ton. Kuadran kanan-bawah = bintang (produktif & murah), kiri-atas = butuh perhatian. Klik titik untuk bedah.">
                {divsWithUpah.length === 0 ? <EmptyState title="Tonase belum aktif" message="Scatter butuh divisi dengan upah + tonase > 0." /> : (
                    <>
                    <div className="cpts-scatter-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#DFE8E0" />
                                <XAxis type="number" dataKey="prod" name="Produktivitas" unit=" t/HK" tick={{ fontSize: 11, fill: '#7C8B80' }} label={{ value: 'Produktivitas (ton/HK)', position: 'insideBottom', offset: -12, fontSize: 12, fill: '#46584C' }} />
                                <YAxis type="number" dataKey="cpt" name="Cost/Ton" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#7C8B80' }} label={{ value: 'Cost/Ton', angle: -90, position: 'insideLeft', fontSize: 12, fill: '#46584C' }} />
                                <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => [n === 'cpt' ? fmtIDR(v) : `${fmtNum(v, 2)} t/HK`, n === 'cpt' ? 'Cost/Ton' : 'Produktivitas']} contentStyle={{ borderRadius: 10, border: '1px solid #DFE8E0', fontSize: 13 }} />
                                {meanCpt != null && <ReferenceLine y={meanCpt} stroke="#B3392E" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `rata-rata ${fmtCompact(meanCpt)}/t`, position: 'insideTopRight', fontSize: 11, fontWeight: 700, fill: '#B3392E' }} />}
                                <Scatter data={divsWithUpah.map(d => ({ name: d.division_code, prod: productivity(d), cpt: costPerTon(d) })).filter(p => p.cpt != null)} fill="#1F6F43" onClick={(p) => openDrill(p.name)}>
                                    {divsWithUpah.map((d, i) => <Cell key={i} fill={(() => { const p = productivity(d); const c = costPerTon(d); const eff = p != null && meanCpt != null && c < meanCpt && p > (totalTonase / divsWithUpah.reduce((s, x) => s + Number(x.total_hk || 0), 0)); return eff ? '#1F6F43' : (c > meanCpt ? '#B3392E' : '#B45309'); })()} />)}
                                    <LabelList dataKey="name" position="top" style={{ fontSize: 10, fontWeight: 700, fill: '#46584C' }} />
                                </Scatter>
                            </ScatterChart>
                        </ResponsiveContainer>
                    </div>
                    {/* Legend per titik: divisi mana di posisi mana */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 12, fontSize: 12 }}>
                        {divsWithUpah.map(d => {
                            const c = costPerTon(d); const p = productivity(d);
                            if (c == null || p == null) return null;
                            const eff = p != null && meanCpt != null && c < meanCpt && p > (totalTonase / divsWithUpah.reduce((s, x) => s + Number(x.total_hk || 0), 0));
                            const over = meanCpt != null && c > meanCpt;
                            const color = eff ? '#1F6F43' : (over ? '#B3392E' : '#B45309');
                            const status = eff ? 'Bintang' : (over ? 'Perlu perhatian' : 'Rata-rata');
                            return (
                                <div key={d.division_code} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', background: '#F6FAF5', border: '1px solid #DFE8E0', borderRadius: 8 }}>
                                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                    <span style={{ fontWeight: 700, color: '#12241A' }}>{d.division_code}</span>
                                    <span style={{ color: '#7C8B80', fontSize: 11 }}>{fmtNum(p, 2)} t/HK · {fmtCompact(c)}</span>
                                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color }}>{status}</span>
                                </div>
                            );
                        })}
                    </div>
                    </>
                )}
            </Act>

            {/* ACT 5 - anomali */}
            <Act id="act5" num="05" title="Anomali bulan ini" lede="Divisi dengan cost/ton di atas rata-rata estate, diurut dari paling menyimpang. Prioritas review operasional.">
                {anomali.length === 0 ? <EmptyState title="Tidak ada anomali" message="Belum ada data untuk deteksi anomali." /> : (
                    <div className="cpts-anomali-list">
                        {anomali.filter(a => a.diff > 0).map((a, i) => (
                            <div key={a.code} className={`cpts-anomali-row ${a.diff < 15 ? 'minor' : ''}`}>
                                <div className="cpts-anomali-rank">{i + 1}</div>
                                <div><div className="cpts-anomali-name">{a.code}</div><div className="cpts-anomali-sub">{fmtCompact(a.cpt)}/ton · {fmtNum(a.tonase, 1)} t · {fmtNum(a.hk)} HK</div></div>
                                <div className="cpts-anomali-delta bad">+{a.diff.toFixed(1)}%</div>
                                <button onClick={() => openDrill(a.code)} style={{ border: '1px solid var(--c-border)', background: 'var(--c-surface2)', borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: 'var(--c-leafMid)' }}>Bedah →</button>
                            </div>
                        ))}
                        {anomali.filter(a => a.diff > 0).length === 0 && <div className="cpts-empty">Semua divisi di bawah/segari rata-rata. Tidak ada lonjakan signifikan.</div>}
                    </div>
                )}
            </Act>

            {/* ACT 6 - gerak cost/ton tiap divisi (timeline small-multiples) */}
            <Act id="act6" num="06" title="Bagaimana gerak cost/ton tiap divisi?" lede="Tiap panel = satu divisi: garis = gerak cost/ton 8 bulan terakhir, bar abu = tonase TBS. Garis putus = rata-rata divisi itu sendiri. Slope turun = membaik, naik = memburuk.">
                <div ref={act6Ref}>
                    {trendLoading ? <div className="cpts-empty">Memuat gerak 8 bulan…</div>
                    : trendError ? <EmptyState title="Gagal memuat" message={trendError} />
                    : (trend || []).length === 0 ? <EmptyState title="Belum ada riwayat" message="Butuh minimal 2 bulan data untuk menampilkan gerak." />
                    : (() => {
                        const pivot = pivotDivisionSeries(trend);
                        // only divisions with >=2 cost_per_ton points (drops IJL all-null, single-point)
                        const panels = pivot.divisions.filter(d => d.series.filter(s => s.cost_per_ton != null).length >= 2);
                        if (panels.length === 0) return <EmptyState title="Tonase belum lengkap" message="Belum ada divisi dengan tonase cukup untuk gerak." />;
                        // sort by latest cost/ton desc (most expensive top-left)
                        panels.sort((a, b) => (b.latest ?? -Infinity) - (a.latest ?? -Infinity));
                        const buckets = movementBuckets(panels);
                        return (
                            <>
                                <div className="cpts-move-summary">
                                    <span className="cpts-move-pill good">Membaik {buckets.improving.length}</span>
                                    <span className="cpts-move-pill bad">Memburuk {buckets.worsening.length}</span>
                                    <span className="cpts-move-pill flat">Datar {buckets.flat.length}</span>
                                </div>
                                {/* Legenda warna panel: garis = gerak cost/ton, bar abu = tonase. Warna garis mengikuti arah gerak. */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--c-muted)', marginBottom: 10 }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 18, height: 3, borderRadius: 2, background: 'var(--c-upah)', display: 'inline-block' }} /> Membaik (cost/ton turun)</span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 18, height: 3, borderRadius: 2, background: 'var(--c-red)', display: 'inline-block' }} /> Memburuk (cost/ton naik)</span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 18, height: 3, borderRadius: 2, background: 'var(--c-leafMid)', display: 'inline-block' }} /> Datar</span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 10, height: 8, borderRadius: 2, background: '#5E9C7B', opacity: 0.85, display: 'inline-block' }} /> Tonase TBS</span>
                                    <span style={{ marginLeft: 'auto', color: 'var(--c-muted)' }}>Hover panel untuk detail per bulan</span>
                                </div>
                                <div className="cpts-trend-grid">
                                    {panels.map(d => {
                                        const pts = d.series.map(s => ({ periodLabel: s.periodLabel, cost_per_ton: s.cost_per_ton, tonase: s.tonase > 0 ? s.tonase : null }));
                                        const valid = pts.filter(p => p.cost_per_ton != null);
                                        const latest = valid[valid.length - 1]?.cost_per_ton ?? null;
                                        const first = valid[0]?.cost_per_ton ?? null;
                                        const delta = (latest != null && first != null) ? latest - first : null;
                                        const tone = delta == null ? 'flat' : delta < 0 ? 'good' : delta > 0 ? 'bad' : 'flat';
                                        return (
                                            <div key={d.code} className={`cpts-trend-panel tone-${tone}`}>
                                                <div className="cpts-trend-head">
                                                    <span className="cpts-trend-code">{d.code}</span>
                                                    {delta != null && <span className={`cpts-trend-delta ${tone}`}>{delta < 0 ? '▼' : delta > 0 ? '▲' : '●'} {fmtCompact(Math.abs(delta))}</span>}
                                                </div>
                                                <ResponsiveContainer width="100%" height={150}>
                                                    <ComposedChart data={pts} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barCategoryGap="35%">
                                                        <CartesianGrid strokeDasharray="2 4" stroke="var(--c-border)" vertical={false} />
                                                        <XAxis dataKey="periodLabel" tick={{ fontSize: 9, fill: 'var(--c-muted)' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                                                        <YAxis yAxisId="cpt" tick={{ fontSize: 9, fill: 'var(--c-muted)' }} tickFormatter={v => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} width={28} domain={['auto', 'auto']} />
                                                        <YAxis yAxisId="ton" orientation="right" hide domain={[0, dataMax => Math.ceil(dataMax * 1.25)]} />
                                                        <Tooltip content={({ payload, label }) => {
                                                            const p = payload?.[0]?.payload;
                                                            if (!p) return null;
                                                            return (
                                                                <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 8, fontSize: 11, padding: '8px 10px', boxShadow: '0 6px 18px rgba(18,36,26,.12)' }}>
                                                                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{label}</div>
                                                                    <div>Cost/Ton: <strong>{p.cost_per_ton != null ? `${fmtCompact(p.cost_per_ton)}/t` : '-'}</strong></div>
                                                                    <div>Tonase: <strong>{p.tonase != null ? `${fmtNum(p.tonase, 1)} t` : '-'}</strong></div>
                                                                </div>
                                                            );
                                                        }} />
                                                        <ReferenceLine yAxisId="cpt" y={latest} stroke="var(--c-border)" strokeDasharray="2 2" />
                                                        {(() => { const vals = valid.map(p => p.cost_per_ton); const divMean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null; return divMean != null ? <ReferenceLine yAxisId="cpt" y={divMean} stroke="var(--c-muted)" strokeDasharray="4 4" strokeWidth={1} label={{ value: `rata-rata ${fmtCompact(divMean)}/t`, position: 'insideTopRight', fontSize: 9, fill: 'var(--c-muted)' }} /> : null; })()}
                                                        <Bar yAxisId="ton" dataKey="tonase" name="tonase" fill="#5E9C7B" opacity={0.85} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                                                        <Line yAxisId="cpt" type="monotone" dataKey="cost_per_ton" stroke={`var(--c-${tone === 'good' ? 'upah' : tone === 'bad' ? 'red' : 'leafMid'})`} strokeWidth={2.5} dot={{ r: 2 }} connectNulls animationDuration={600} animationEasing="ease-out" />
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        );
                    })()}
                </div>
            </Act>
            </div>{/* /cpts-interactive */}

            {/* LAMPIRAN CETAK — semua uraian klik-reveal, dirender lengkap saat print mode */}
            {printExpanded && (
                <section className="cpts-print-detail">
                    <div className="cpts-print-header">
                        <div className="cpts-print-brand">
                            <img className="cpts-print-logo" src={`${import.meta.env.BASE_URL || '/'}images/rebinmas.webp`} alt="PT. Rebinmas Jaya" />
                            <div>
                                <div className="cpts-print-company">PT. REBINMAS JAYA</div>
                                <div className="cpts-print-title">Laporan Cost per Ton · Story</div>
                                <div className="cpts-print-sub">Periode {periodLabel} · Upah {gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')} · Dicetak {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                            </div>
                        </div>
                        <div className="cpts-print-rule" />
                    </div>
                    <div className="cpts-print-page">
                        <div className="cpts-print-title">Uraian Lengkap per Divisi</div>
                        <div className="cpts-print-sub">Cost/ton = upah kotor ÷ tonase TBS (mill supplier PTRJ01-09 internal). Komponen per ton dihitung dari dekomposisi upah.</div>
                        <table className="cpts-print-table">
                            <thead>
                                <tr>
                                    <th>Divisi</th>
                                    <th style={{ textAlign: 'right' }}>Tonase (t)</th>
                                    <th style={{ textAlign: 'right' }}>Upah Kotor</th>
                                    <th style={{ textAlign: 'right' }}>Gaji Pokok / t</th>
                                    <th style={{ textAlign: 'right' }}>Lembur / t</th>
                                    <th style={{ textAlign: 'right' }}>Premi / t</th>
                                    <th style={{ textAlign: 'right' }}>Cost/Ton</th>
                                    <th style={{ textAlign: 'right' }}>vs rata-rata</th>
                                    <th style={{ textAlign: 'right' }}>Prod. (t/HK)</th>
                                    <th style={{ textAlign: 'right' }}>HK</th>
                                    <th style={{ textAlign: 'right' }}>Orang</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...divsWithUpah].sort((a, b) => costPerTon(b) - costPerTon(a)).map(d => {
                                    const dec = decomposeCost(d); const ton = Number(d.total_tonase);
                                    const cpt = costPerTon(d); const prod = productivity(d);
                                    const vsMean = cpt != null && meanCpt != null ? (cpt - meanCpt) / meanCpt * 100 : null;
                                    return (
                                        <tr key={d.division_code}>
                                            <td style={{ fontWeight: 700 }}>{d.division_code}</td>
                                            <td style={{ textAlign: 'right' }}>{fmtNum(ton, 1)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCompact(d.total_wage)}</td>
                                            <td style={{ textAlign: 'right' }}>{ton > 0 ? fmtCompact(dec.gajiPokok / ton) : '-'}</td>
                                            <td style={{ textAlign: 'right' }}>{ton > 0 ? fmtCompact(dec.lembur / ton) : '-'}</td>
                                            <td style={{ textAlign: 'right' }}>{ton > 0 ? fmtCompact(dec.premi / ton) : '-'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{cpt != null ? fmtCompact(cpt) : '-'}</td>
                                            <td style={{ textAlign: 'right' }}>{vsMean != null ? `${vsMean >= 0 ? '+' : ''}${vsMean.toFixed(1)}%` : '-'}</td>
                                            <td style={{ textAlign: 'right' }}>{prod != null ? fmtNum(prod, 3) : '-'}</td>
                                            <td style={{ textAlign: 'right' }}>{fmtNum(d.total_hk)}</td>
                                            <td style={{ textAlign: 'right' }}>{fmtNum(d.headcount)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td>TOTAL {divsWithUpah.length} DIVISI</td>
                                    <td style={{ textAlign: 'right' }}>{fmtNum(totalTonase, 1)}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtCompact(totalWage)}</td>
                                    <td style={{ textAlign: 'right' }}>{totalTonase > 0 ? fmtCompact(divsWithUpah.reduce((s, d) => { const dec = decomposeCost(d); return s + dec.gajiPokok; }, 0) / totalTonase) : '-'}</td>
                                    <td style={{ textAlign: 'right' }}>{totalTonase > 0 ? fmtCompact(divsWithUpah.reduce((s, d) => s + Number(d.total_lembur || 0), 0) / totalTonase) : '-'}</td>
                                    <td style={{ textAlign: 'right' }}>{totalTonase > 0 ? fmtCompact(divsWithUpah.reduce((s, d) => s + Number(d.total_premi || 0), 0) / totalTonase) : '-'}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 800 }}>{overallCpt != null ? fmtCompact(overallCpt) : '-'}</td>
                                    <td style={{ textAlign: 'right' }}>-</td>
                                    <td style={{ textAlign: 'right' }}>{totalTonase > 0 ? fmtNum(totalTonase / (divsWithUpah.reduce((s, d) => s + Number(d.total_hk || 0), 0) || 1), 3) : '-'}</td>
                                    <td style={{ textAlign: 'right' }}>{fmtNum(divsWithUpah.reduce((s, d) => s + Number(d.total_hk || 0), 0))}</td>
                                    <td style={{ textAlign: 'right' }}>{fmtNum(divsWithUpah.reduce((s, d) => s + Number(d.headcount || 0), 0))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div className="cpts-print-page">
                        <div className="cpts-print-title">Uraian Gang per Divisi</div>
                        <div className="cpts-print-sub">Semua gang sesuai jenis terpilih ({gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')}) · kolom komprehensif upah kotor, lembur, premi, HK, headcount, cost/HK</div>
                        {divsWithTon.map(d => {
                            const gs = (gangRows || []).filter(g => String(g.division_code).toUpperCase() === String(d.division_code).toUpperCase() && gangTypes.includes(g.gang_type));
                            if (gs.length === 0) return null;
                            return (
                                <div key={d.division_code} className="cpts-print-gankset">
                                    <div className="cpts-print-ganghead">{d.division_code} · {gs.length} gang · upah {fmtCompact(gs.reduce((s, g) => s + Number(g.total_cost || 0), 0))}</div>
                                    <table className="cpts-print-table">
                                        <thead>
                                            <tr>
                                                <th>Gang</th>
                                                <th>Jenis</th>
                                                <th style={{ textAlign: 'right' }}>Upah Kotor</th>
                                                <th style={{ textAlign: 'right' }}>Lembur</th>
                                                <th style={{ textAlign: 'right' }}>Premi</th>
                                                <th style={{ textAlign: 'right' }}>HK</th>
                                                <th style={{ textAlign: 'right' }}>Orang</th>
                                                <th style={{ textAlign: 'right' }}>Cost/HK</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {gs.sort((a, b) => Number(b.total_cost) - Number(a.total_cost)).map(g => (
                                                <tr key={`${d.division_code}-${g.gang_code}`}>
                                                    <td style={{ fontWeight: 700 }}>{g.gang_code}</td>
                                                    <td><span style={{ fontSize: 10, fontWeight: 700, color: GANG_TYPE_COLOR[g.gang_type] }}>{GANG_TYPE_LABEL[g.gang_type] || g.gang_type}</span></td>
                                                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCompact(g.total_cost)}</td>
                                                    <td style={{ textAlign: 'right' }}>{fmtCompact(g.total_lembur)}</td>
                                                    <td style={{ textAlign: 'right' }}>{fmtCompact(g.total_premi)}</td>
                                                    <td style={{ textAlign: 'right' }}>{fmtNum(g.total_hk)}</td>
                                                    <td style={{ textAlign: 'right' }}>{fmtNum(g.headcount)}</td>
                                                    <td style={{ textAlign: 'right' }}>{Number(g.total_hk) > 0 ? fmtCompact(Number(g.total_cost) / Number(g.total_hk)) : '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })}
                    </div>
                    <div className="cpts-print-page">
                        <div className="cpts-print-title">Definisi & Catatan</div>
                        <ul className="cpts-print-notes">
                            <li><b>Cost/Ton</b> = upah kotor (gang jenis terpilih) ÷ tonase TBS divisi. Tonase = properti divisi dari mill supplier PTRJ01-09 internal, tidak valid per gang.</li>
                            <li><b>Produktivitas</b> = tonase ÷ HK (ton per hari kerja). Efisien = produktivitas di atas rata-rata dan cost/ton di bawah rata-rata estate.</li>
                            <li><b>Komposisi per ton</b> = gaji pokok, lembur, dan premi di-normalisasi per ton TBS; dipakai menelusuri penyebab naik/turun cost/ton.</li>
                            <li><b>Anomali</b> = divisi dengan cost/ton di atas rata-rata estate, urut paling menyimpang. Prioritas review operasional.</li>
                            <li><b>Upah yang dihitung</b> = gaji pokok + tunjangan + premi untuk gang jenis {gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')} pada periode {periodLabel}.</li>
                            <li><b>Sumber</b>: executive-summary + cost-hk-comparison (agregasi snapshot payroll periode berjalan).</li>
                        </ul>
                    </div>
                </section>
            )}

            {/* Drill panel */}
            {drill && (
                <section ref={drillRef} className="cpts-act in-view">
                    <div className="cpts-drill-panel">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                            <button className="back" onClick={() => setDrill(null)} style={{ marginBottom: 0 }}>← Tutup</button>
                            <span style={{ color: 'var(--c-muted)', fontSize: 12 }}>Bedah:</span>
                            <div className="cpts-filter-pills">
                                {divsWithTon.map(v => (
                                    <button key={v.division_code} className="cpts-pill" onClick={() => setDrill(v.division_code)}
                                        style={{ borderColor: v.division_code === drill ? 'var(--c-leaf)' : 'var(--c-border)', background: v.division_code === drill ? 'var(--c-leaf)' : 'transparent', color: v.division_code === drill ? '#fff' : 'var(--c-muted)' }}>
                                        {v.division_code}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <GangDetail division={drill} gangRows={gangRows} gangTypes={gangTypes} />
                        {(() => {
                            const d = breakdown.find(x => x.division_code === drill); if (!d) return <div className="cpts-empty">Data tidak ditemukan.</div>;
                            const dec = decomposeCost(d); const cpt = costPerTon(d); const prod = productivity(d); const ton = Number(d.total_tonase);
                            return (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 16 }}>
                                    <DrillKpi label="Cost / Ton" value={cpt != null ? fmtCompact(cpt) : '-'} tone={cpt != null && meanCpt != null ? (cpt > meanCpt ? 'bad' : 'good') : 'neutral'} note={meanCpt != null ? `rata-rata ${fmtCompact(meanCpt)}` : ''} />
                                    <DrillKpi label="Produktivitas" value={prod != null ? `${fmtNum(prod, 3)} t/HK` : 'HK 0'} note={`${fmtNum(d.total_hk)} HK`} />
                                    <DrillKpi label="Tonase" value={`${fmtNum(ton, 1)} t`} />
                                    <DrillKpi label="Upah Kotor" value={fmtCompact(d.total_wage)} note={`${d.headcount} karyawan`} />
                                    <DrillKpi label="Gaji Pokok / t" value={ton > 0 ? fmtCompact(dec.gajiPokok / ton) : '-'} note={`${fmtCompact(dec.gajiPokok)}`} />
                                    <DrillKpi label="Lembur / t" value={ton > 0 ? fmtCompact(dec.lembur / ton) : '-'} note={`${fmtCompact(dec.lembur)}`} />
                                    <DrillKpi label="Premi / t" value={ton > 0 ? fmtCompact(dec.premi / ton) : '-'} note={`${fmtCompact(dec.premi)}`} />
                                </div>
                            );
                        })()}
                    </div>
                </section>
            )}
        </div>
    );
}

function HeroBreakdown({ mode, breakdown, gangRows, gangTypes, meanCpt, onClose, onPickDivision }) {
    const isUpah = mode === 'upah', isTon = mode === 'tonase', isCpt = mode === 'cpt';
    const total = isUpah ? breakdown.reduce((s, d) => s + Number(d.total_wage || 0), 0)
        : isTon ? breakdown.reduce((s, d) => s + Number(d.total_tonase || 0), 0) : null;
    const rows = [...breakdown].sort((a, b) => {
        if (isUpah) return Number(b.total_wage) - Number(a.total_wage);
        if (isTon) return Number(b.total_tonase) - Number(a.total_tonase);
        return (costPerTon(b) ?? -1) - (costPerTon(a) ?? -1);
    });
    const title = isUpah ? 'Uraian Upah Kotor Panen per Divisi' : isTon ? 'Uraian Tonase per Divisi' : 'Uraian Cost per Ton per Divisi';
    return (
        <div className="cpts-act3-drill" style={{ marginTop: 16 }}>
            <div className="cpts-act3-drill-head">
                <strong>{title}</strong>
                <span className="meta">{rows.length} divisi ({gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')})</span>
                <button onClick={onClose} className="cpts-btn-ghost">Tutup</button>
            </div>
            <table>
                <thead><tr>
                    <th>Divisi</th><th style={{ textAlign: 'right' }}>{isUpah ? 'Upah Kotor' : isTon ? 'Tonase' : 'Cost/Ton'}</th>
                    <th style={{ textAlign: 'right' }}>{isUpah ? '% total upah' : isTon ? '% tonase' : 'vs rata-rata'}</th>
                    <th style={{ textAlign: 'right' }}>HK</th><th style={{ textAlign: 'right' }}>Orang</th><th />
                </tr></thead>
                <tbody>{rows.map(d => {
                    const cpt = costPerTon(d);
                    const pct = total ? (isUpah ? Number(d.total_wage) / total * 100 : Number(d.total_tonase) / total * 100) : null;
                    const vsMean = isCpt && meanCpt && cpt != null ? (cpt - meanCpt) / meanCpt * 100 : null;
                    return (
                        <tr key={d.division_code}>
                            <td style={{ fontWeight: 700 }}>{d.division_code}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{isUpah ? fmtCompact(d.total_wage) : isTon ? `${fmtNum(d.total_tonase, 1)} t` : (cpt != null ? `${fmtCompact(cpt)}/t` : '-')}</td>
                            <td style={{ textAlign: 'right', color: 'var(--c-muted)' }}>{pct != null ? `${pct.toFixed(1)}%` : vsMean != null ? `${vsMean >= 0 ? '+' : ''}${vsMean.toFixed(1)}%` : '-'}</td>
                            <td style={{ textAlign: 'right', color: 'var(--c-muted)' }}>{fmtNum(d.total_hk)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--c-muted)' }}>{fmtNum(d.headcount)}</td>
                            <td style={{ textAlign: 'right' }}><button className="cpts-btn-ghost" onClick={() => onPickDivision(d.division_code)}>Bedah →</button></td>
                        </tr>
                    );
                })}</tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--c-muted)' }}>Klik Bedah → untuk lihat gang di divisi tersebut.</div>
        </div>
    );
}

const ACT3_COMP = {
    GajiPokok: { label: 'Gaji Pokok', color: '#1F6F43', value: g => Math.max(0, (Number(g.total_cost) || 0) - (Number(g.total_lembur) || 0) - (Number(g.total_premi) || 0)) },
    Lembur: { label: 'Lembur', color: '#B45309', value: g => Number(g.total_lembur) || 0 },
    Premi: { label: 'Premi', color: '#7C5A2B', value: g => Number(g.total_premi) || 0 },
};

function Act3GangDrill({ division, component, gangRows, gangTypes, tonase, onClose }) {
    const comp = ACT3_COMP[component];
    if (!comp) return null;
    const wanted = new Set(gangTypes);
    const rows = (gangRows || [])
        .filter(g => String(g.division_code).toUpperCase() === String(division).toUpperCase() && wanted.has(g.gang_type))
        .map(g => ({ ...g, comp_value: comp.value(g) }))
        .sort((a, b) => b.comp_value - a.comp_value);
    const total = rows.reduce((s, g) => s + g.comp_value, 0);
    return (
        <div className="cpts-act3-drill">
            <div className="cpts-act3-drill-head">
                <strong>{comp.label} · {division}</strong>
                <span className="meta">
                    total {fmtCompact(total)}{tonase > 0 ? ` · ${fmtCompact(total / tonase)}/t (${fmtNum(tonase, 1)} ton)` : ''} · {rows.length} gang ({gangTypes.map(t => GANG_TYPE_LABEL[t]).join(' + ')})
                </span>
                <button onClick={onClose} className="cpts-btn-ghost">Tutup</button>
            </div>
            {rows.length === 0 ? <div className="cpts-empty" style={{ marginTop: 8 }}>Tidak ada gang untuk kombinasi ini.</div> : (
                <table>
                    <thead>
                        <tr>
                            <th>Gang</th><th>Jenis</th><th style={{ textAlign: 'right' }}>{comp.label}</th><th style={{ textAlign: 'right' }}>% komponen</th>
                            {tonase > 0 && <th style={{ textAlign: 'right' }}>per ton</th>}
                            <th style={{ textAlign: 'right' }}>Upah kotor</th><th style={{ textAlign: 'right' }}>HK</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(g => (
                            <tr key={g.gang_code}>
                                <td style={{ fontWeight: 700 }}>{g.gang_code}</td>
                                <td><span style={{ fontSize: 10, fontWeight: 700, color: GANG_TYPE_COLOR[g.gang_type] }}>{GANG_TYPE_LABEL[g.gang_type] || g.gang_type}</span></td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: comp.color }}>{fmtCompact(g.comp_value)}</td>
                                <td style={{ textAlign: 'right', color: 'var(--c-muted)' }}>{total > 0 ? `${(g.comp_value / total * 100).toFixed(1)}%` : '-'}</td>
                                {tonase > 0 && <td style={{ textAlign: 'right', color: 'var(--c-muted)' }}>{fmtCompact(g.comp_value / tonase)}/t</td>}
                                <td style={{ textAlign: 'right', color: 'var(--c-muted)' }}>{fmtCompact(g.total_cost)}</td>
                                <td style={{ textAlign: 'right', color: 'var(--c-muted)' }}>{fmtNum(g.total_hk)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function GangDetail({ division, gangRows, gangTypes }) {
    const [typeFilter, setTypeFilter] = useState('ALL');
    // sinkron dengan filter header: jika header Panen saja → bedah ikut Panen
    useEffect(() => {
        if (!gangTypes || gangTypes.length === 0) return;
        if (gangTypes.length === 1) setTypeFilter(gangTypes[0]);
        else setTypeFilter('ALL');
    }, [gangTypes, division]);

    const gangs = useMemo(() => {
        const rows = (gangRows || []).filter(g => String(g.division_code).toUpperCase() === String(division).toUpperCase());
        // ikuti header: bila header filter single type, pakai itu; bila multi, ikuti pill lokal
        const effective = gangTypes && gangTypes.length === 1 ? gangTypes[0] : typeFilter;
        return effective === 'ALL' ? rows : rows.filter(g => g.gang_type === effective);
    }, [gangRows, division, typeFilter, gangTypes]);

    const totals = useMemo(() => {
        let cost = 0, hk = 0, hc = 0;
        for (const g of gangs) { cost += g.total_cost; hk += g.total_hk; hc += g.headcount; }
        return { cost, hk, hc };
    }, [gangs]);

    if (!gangRows) return <div className="cpts-empty">Memuat gang…</div>;
    if (gangs.length === 0 && typeFilter === 'ALL') return <div className="cpts-empty">Tidak ada gang untuk divisi {division}.</div>;

    return (
        <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Gang di {division}</strong>
                <div style={{ display: 'flex', gap: 6 }}>
                    {['ALL', ...GANG_TYPE_ORDER].map(t => (
                        <button key={t} onClick={() => setTypeFilter(t)}
                            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid var(--c-border)', background: typeFilter === t ? 'var(--c-leaf)' : 'transparent', color: typeFilter === t ? '#fff' : 'var(--c-ink)', cursor: 'pointer' }}>
                            {t === 'ALL' ? 'Semua' : GANG_TYPE_LABEL[t]}
                        </button>
                    ))}
                </div>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-muted)' }}>
                    {gangs.length} gang · {fmtNum(totals.hc)} orang · {fmtNum(totals.hk)} HK · {fmtCompact(totals.cost)}
                </span>
            </div>
            <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 16, right: 24, bottom: 30, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" />
                        <XAxis type="number" dataKey="total_cost" name="Upah Kotor" tickFormatter={v => `${(v / 1e6).toFixed(0)}jt`} tick={{ fontSize: 10, fill: 'var(--c-muted)' }} label={{ value: 'Upah Kotor', position: 'insideBottom', offset: -14, fontSize: 11, fill: 'var(--c-muted)' }} />
                        <YAxis type="number" dataKey="headcount" name="Karyawan" allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--c-muted)' }} label={{ value: 'Jumlah Karyawan', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--c-muted)' }} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
                            const p = payload?.[0]?.payload;
                            if (!p) return null;
                            return (
                                <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '8px 10px', fontSize: 11 }}>
                                    <div style={{ fontWeight: 800 }}>{p.gang_code} <span style={{ fontWeight: 400, color: 'var(--c-muted)' }}>({GANG_TYPE_LABEL[p.gang_type] || p.gang_type})</span></div>
                                    <div>Upah kotor: <strong>{fmtCompact(p.total_cost)}</strong></div>
                                    <div>Karyawan: <strong>{p.headcount}</strong> · HK: {fmtNum(p.total_hk)} · {fmtCompact(p.cost_per_hk)}/HK</div>
                                </div>
                            );
                        }} />
                        {GANG_TYPE_ORDER.map(t => {
                            const pts = gangs.filter(g => g.gang_type === t);
                            if (pts.length === 0) return null;
                            return (
                                <Scatter key={t} name={GANG_TYPE_LABEL[t]} data={pts} fill={GANG_TYPE_COLOR[t]}>
                                    <LabelList dataKey="gang_code" position="top" style={{ fontSize: 9, fontWeight: 700, fill: 'var(--c-muted)' }} />
                                </Scatter>
                            );
                        })}
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

const Act = ({ id, num, title, lede, children }) => {
    const [ref, shown] = useReveal();
    return (
        <PresentSlide num={num} id={id} title={title} subtitle={lede}>
            <div ref={ref} className={`cpts-act ${shown ? 'in-view' : ''}`}>
                {children}
            </div>
        </PresentSlide>
    );
};

const TreemapCell = (props) => {
    const { x, y, width, height, name, cpt, rank, share, minCpt, maxCpt, onClick } = props;
    const [hover, setHover] = useState(false);
    if (width < 1 || height < 1) return null;
    const fill = heatColor(cpt, minCpt, maxCpt);
    return (
        <g onClick={() => onClick && onClick(name)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor: 'pointer' }}>
            <rect x={x} y={y} width={width} height={height} stroke={hover ? '#12241A' : '#fff'} strokeWidth={hover ? 4 : 3} fill={fill} style={{ transition: 'stroke .12s' }} />
            {width > 46 && height > 26 && (
                <>
                    <text x={x + 9} y={y + 26} fill="#fff" fontSize={18} fontWeight={800}>{name}</text>
                    <text x={x + 9} y={y + 50} fill="#fff" fontSize={16} fontWeight={700} stroke="rgba(18,36,26,0.3)" strokeWidth={0.6}>{cpt != null ? `${Math.round(cpt / 1000)}k/t` : ''}{share != null ? ` · ${fmtPercent(share)}` : ''}</text>
                </>
            )}
        </g>
    );
};

const DrillKpi = ({ label, value, note, tone = 'neutral' }) => {
    const color = tone === 'bad' ? 'var(--c-red)' : tone === 'good' ? 'var(--c-upah)' : 'var(--c-ink)';
    return (
        <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--c-muted)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
            {note && <div style={{ fontSize: 11.5, color: 'var(--c-text2)', marginTop: 4 }}>{note}</div>}
        </div>
    );
};
