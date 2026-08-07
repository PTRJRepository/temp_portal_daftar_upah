import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis, Tooltip, Cell, LabelList } from 'recharts';
import { AlertTriangle, ArrowLeft, BarChart3, DollarSign, Printer, RefreshCw, Scale, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchAvailablePeriods } from '../services/summaryReportService';
import { fetchTonaseAnalysisReport } from '../services/dashboardService';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import { printReport, usePrintExpand } from '../utils/printPageSetup';
import { C, CARD, SECTION_TITLE, ReportHero, ReportBody, StatCard, MetricInfo, Breadcrumb, EmptyState, chartPalette, DeltaBadge } from '../components/report/reportTheme';
import CostPerTonPanel from '../components/report/CostPerTonPanel';
import { PresentSlide } from '../components/present/PresentSlide';
import { PresentController } from '../components/present/PresentController';
import { usePresentMode } from '../components/present/usePresentMode';
import { decomposeCost, costPerTon, productivity, benchmarkMean, deltaPct, heatColor } from '../utils/costPerTonStory.derive';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';
import '../styles/cost-per-ton-story.css';

const MONTHS = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const fmtNum = (v, d = 0) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtIDR = (v) => (v === null || v === undefined ? '-' : `Rp ${fmtNum(v)}`);
const fmtCompact = (v) => {
    if (v === null || v === undefined) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};
const fmtPercent = (v, d = 1) => (v === null || v === undefined ? '-' : `${fmtNum(v, d)}%`);

export default function TonaseAnalysisReportPage({ onBack, initialMonth, initialYear }) {
    const { token } = useAuth();
    const navigate = useNavigate();
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());
    const [periods, setPeriods] = useState([]);
    const [reportData, setReportData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedDivision, setSelectedDivision] = useState(null); // drill division_code
    const { presenting, activeIndex, enter, exit } = usePresentMode();
    // During print: semua divisi dibedah per-gang (tabel), bukan hanya divisi yang diklik.
    const printExpanded = usePrintExpand();

    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
    }, [initialMonth, initialYear]);

    useEffect(() => {
        async function loadPeriods() {
            if (!token) return;
            try { const r = await fetchAvailablePeriods(token); setPeriods(r.periods || []); } catch (e) { console.error(e); }
        }
        loadPeriods();
    }, [token]);

    const fetchData = useCallback(async () => {
        if (!token) return;
        setLoading(true); setError('');
        try {
            const r = await fetchTonaseAnalysisReport(token, { month, year, division_code: 'REBINMAS' });
            if (r.success) setReportData(r.data); else { setReportData(null); setError(r.error || 'Gagal memuat'); }
        } catch (e) { setReportData(null); setError(e.message || 'Gagal memuat'); }
        finally { setLoading(false); }
    }, [token, month, year]);
    useEffect(() => { fetchData(); }, [fetchData]);

    const kpis = reportData?.kpis || {};
    // Normalize: derive helpers expect total_wage/total_ot/total_premi. Tonase report returns
    // total_upah_kotor (gross) / total_premi / total_hk — no total_ot. Map before use.
    const breakdown = useMemo(() => (reportData?.division_breakdown || []).map(d => ({
        ...d,
        total_wage: d.total_upah_kotor ?? d.total_wage ?? 0,
        total_ot: d.total_ot ?? 0,
    })), [reportData]);
    const details = reportData?.division_details || [];
    const trend = useMemo(() => (reportData?.trend || []).map(t => ({
        ...t,
        total_wage: t.total_upah_kotor ?? t.total_wage ?? 0,
    })), [reportData]);
    const premiumBreakdown = reportData?.premium_breakdown || [];
    const insights = reportData?.insights || {};
    const warnings = reportData?.warnings || [];
    const meta = reportData?.meta || {};

    // Division-first: only divisions with tonase > 0 are "produksi"
    const producingDivs = useMemo(() => breakdown.filter(d => Number(d.total_tonase) > 0), [breakdown]);
    const meanCpt = useMemo(() => benchmarkMean(breakdown), [breakdown]);
    const cptVals = useMemo(() => producingDivs.map(d => costPerTon(d)).filter(v => v != null), [producingDivs]);
    const minCpt = cptVals.length ? Math.min(...cptVals) : null;
    const maxCpt = cptVals.length ? Math.max(...cptVals) : null;

    const periodLabel = `${MONTHS[month] || ''} ${year}`;
    const totalTonase = Number(kpis.total_tonase || 0);
    const hasTonase = totalTonase > 0;

    // drill data
    const drillDetail = useMemo(() => details.find(d => d.division_code === selectedDivision) || null, [details, selectedDivision]);

    // Perbandingan MoM: pasangan periode terakhir vs sebelumnya.
    const currentTrend = trend.length ? trend[trend.length - 1] : null;
    const prevTrend = trend.length >= 2 ? trend[trend.length - 2] : null;
    const momRows = [
        { label: 'Tonase TBS', cur: currentTrend?.total_tonase, prev: prevTrend?.total_tonase, fmt: (v) => `${fmtNum(v, 1)} t`, invert: false },
        { label: 'Upah Kotor / Ton', cur: currentTrend?.upah_kotor_per_ton, prev: prevTrend?.upah_kotor_per_ton, fmt: fmtCompact, invert: true },
        { label: 'Upah Bersih / Ton', cur: currentTrend?.upah_bersih_per_ton, prev: prevTrend?.upah_bersih_per_ton, fmt: fmtCompact, invert: true },
        { label: 'Premi / Ton', cur: currentTrend?.premi_per_ton, prev: prevTrend?.premi_per_ton, fmt: fmtCompact, invert: true },
        { label: 'Upah Kotor / HK', cur: currentTrend?.upah_kotor_per_hk, prev: prevTrend?.upah_kotor_per_hk, fmt: fmtCompact, invert: true },
        { label: 'HK', cur: currentTrend?.total_hk, prev: prevTrend?.total_hk, fmt: (v) => fmtNum(v, 0), invert: false },
        { label: 'Karyawan', cur: currentTrend?.total_employees, prev: prevTrend?.total_employees, fmt: (v) => fmtNum(v, 0), invert: false },
        { label: 'Total Premi', cur: currentTrend?.total_premi, prev: prevTrend?.total_premi, fmt: fmtCompact, invert: false }
    ].filter(r => r.cur !== undefined && r.cur !== null && r.cur !== '' && r.prev !== undefined && r.prev !== null && r.prev !== '');

    // Sebaran tonase per divisi (porsi) + konsentrasi kumulatif (Pareto).
    const shareData = useMemo(() => producingDivs.map((d, i) => ({
        name: d.division_code,
        value: Number(d.total_tonase) || 0,
        pct: Number(d.tonase_share) || 0,
        color: chartPalette[i % chartPalette.length]
    })), [producingDivs]);
    let cumShare = 0;
    const pareto = shareData.map(s => ({ ...s, cum: (cumShare += s.pct) }));

    // History tonase per divisi (wide-format: tiap baris = periode, tiap kolom = divisi).
    const divisionHistory = useMemo(() => {
        const labels = trend.map(t => t.label);
        const metrics = details.filter(d => (d.trend || []).length > 0);
        const rows = labels.map(lbl => {
            const row = { label: lbl };
            metrics.forEach(d => {
                const pt = (d.trend || []).find(t => t.label === lbl);
                row[d.division_code] = Number(pt?.total_tonase || 0);
            });
            return row;
        });
        return { rows, metrics };
    }, [details, trend]);

    const handlePrint = () => printReport({ orientation: 'landscape' });

    if (loading && !reportData) return <div className="cpts-page"><div className="cpts-empty">Memuat analisis tonase…</div></div>;
    if (error && !reportData) return <div className="cpts-page"><ReportBody><EmptyState title="Gagal memuat" message={error} actionLabel="Coba lagi" onAction={fetchData} /></ReportBody></div>;

    return (
        <div className="cpts-page" style={{ fontFamily: 'Inter, sans-serif' }}>
            {/* Print-only header (preserve print workflow) */}
            <div className="print-only" style={{ display: 'none' }}>
                <ReportWatermark />
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <h2>Laporan Analisis Tonase Rebinmas</h2>
                    <p>Periode {periodLabel} · Gang Panen · Sumber: {meta.tonase_source || 'division_tonase'}</p>
                </div>
            </div>

            <ReportHero
                title="Analisis Tonase & Cost per Ton"
                subtitle={`Tonase TBS (PTRJ internal) + cost per ton per divisi · ${periodLabel}`}
                eyebrow="Perkebunan Sawit · Analisis Tonase"
                period={periodLabel}
                actions={
                    <>
                        {onBack && <button onClick={onBack} className="wsp-btn" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.24)', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Kembali</button>}
                        <button onClick={handlePrint} title="Cetak" style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Printer size={14} /> Cetak</button>
                        <button onClick={fetchData} title="Refresh" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.24)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}><RefreshCw size={14} /></button>
                        <select value={`${year}-${month}`} onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); setYear(y); setMonth(m); }} style={{ background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' }}>
                            {(periods.length ? periods : [{ year, month }]).map((p, i) => <option key={i} value={`${p.year}-${p.month}`}>{MONTHS[p.month] || ''} {p.year}</option>)}
                        </select>
                        <button onClick={() => navigate(`/cost-per-ton-story?month=${month}&year=${year}`)} style={{ background: C.upah, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }}>Cost/Ton Story →</button>
                    </>
                }
            />

            <ReportBody>
                {/* PRESENT MODE - tombol Present (mode normal) + HUD deck (present mode) */}
                <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                    <PresentController
                        presenting={presenting}
                        activeIndex={activeIndex}
                        slideCount={9}
                        onEnter={enter}
                        onExit={exit}
                        caption={`Analisis Tonase · ${periodLabel} · Gang Panen`}
                    />
                </div>

                <Breadcrumb items={[
                    { label: 'Analisis Tonase', onClick: () => setSelectedDivision(null) },
                    ...(selectedDivision ? [{ label: selectedDivision, onClick: () => setSelectedDivision(null) }, { label: 'Detail Gang' }] : [])
                ]} />

                <PresentSlide num="01" id="slide-01" title="Gambaran Tonase Periode Berjalan" subtitle="KPI utama: tonase TBS, upah per ton, dan premi">
                {warnings.length > 0 && (
                    <div style={{ marginBottom: 16, padding: '12px 16px', background: C.warnBg || '#FBF1DE', border: `1px solid #EDD9B4`, borderRadius: 10, color: C.lembur || '#B45309', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                        <span>{warnings.join(' · ')}</span>
                    </div>
                )}

                {/* KPI grid — division-level, with interpretation */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                    Ringkasan · Per Divisi <MetricInfo metricKey="total_tonase" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                    <StatCard label="Total Tonase TBS" metricKey="total_tonase" value={`${fmtNum(totalTonase, 2)} t`} note={`${producingDivs.length} divisi produksi`} color={C.upah} />
                    <StatCard label="Upah Kotor / Ton" metricKey="upah_kotor_per_ton" value={hasTonase ? fmtCompact(kpis.upah_kotor_per_ton) : '-'} note={hasTonase ? 'biaya tenaga kerja per ton' : 'tonase belum diisi'} color={C.costTon} />
                    <StatCard label="Upah Kotor / HK" metricKey="upah_kotor_per_hk" value={fmtCompact(kpis.upah_kotor_per_hk)} note={`${fmtNum(kpis.total_hk, 0)} HK`} color={C.lembur} />
                    <StatCard label="Premi / Ton" metricKey="premi_per_ton" value={hasTonase ? fmtCompact(kpis.premi_per_ton) : '-'} note={`porsi premi ${fmtPercent(kpis.premi_share)}`} color={C.premi} />
                    <StatCard label="Gang Panen" value={fmtNum(kpis.gang_count, 0)} note="regu panen (suffix H)" color={C.upahAccent} />
                </div>
                </PresentSlide>

                <PresentSlide num="02" id="slide-02" title="Cost per Ton per Divisi" subtitle="Panel analisis biaya per ton beserta tren historisnya">
                {/* COST/TON COMPREHENSIVE PANEL — reused */}
                <CostPerTonPanel
                    trends={trend}
                    divisionRows={breakdown}
                    title="Analisis Cost per Ton · Per Divisi"
                    loading={loading}
                />
                </PresentSlide>

                <PresentSlide num="03" id="slide-03" title="Perbandingan vs Periode Lalu" subtitle={`Selisih ${periodLabel} dibanding ${prevTrend?.label || 'periode sebelumnya'}`}>
                {momRows.length === 0 ? <EmptyState title="Belum ada perbandingan" message="Butuh minimal 2 periode dalam window tren." /> : (
                    <div style={{ ...CARD, marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                            Selisih vs Periode Lalu <MetricInfo metricKey="total_tonase" />
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                                        {['Metrik', prevTrend?.label || 'Periode Lalu', 'Periode Berjalan', 'Selisih', '%'].map(h => (
                                            <th key={h} style={{ textAlign: h === 'Metrik' ? 'left' : 'right', padding: '10px 12px', color: C.muted, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {momRows.map(r => {
                                        const cur = Number(r.cur); const prev = Number(r.prev);
                                        const delta = cur - prev;
                                        const pct = prev === 0 ? null : (delta / prev) * 100;
                                        return (
                                            <tr key={r.label} style={{ borderBottom: `1px solid ${C.border}` }}>
                                                <td style={{ padding: '11px 12px', fontWeight: 700, color: C.text }}>{r.label}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', color: C.text2 }}>{r.fmt(prev)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 800 }}>{r.fmt(cur)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', color: delta > 0 ? C.upah : delta < 0 ? C.potongan : C.muted }}>{delta > 0 ? '+' : ''}{r.fmt(delta)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px' }}><DeltaBadge pct={pct} invert={r.invert} /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10 }}>Merah pada kolom selisih = penurunan. Warna Δ memakai semantik biaya: tonase & jumlah tenaga naik bagus; upah per ton/HK naik tidak bagus.</div>
                    </div>
                )}
                </PresentSlide>

                <PresentSlide num="04" id="slide-04" title="Breakdown Divisi & Gang" subtitle="Tonase, upah, dan cost per ton tiap divisi produksi">
                {/* Division breakdown table — division-first, cost/ton + benchmark */}
                <div style={{ ...CARD, marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                        Breakdown Divisi <MetricInfo metricKey="cost_per_ton" />
                    </div>
                    {producingDivs.length === 0 ? <EmptyState title="Tidak ada divisi produksi" message="Tonase TBS belum terisi untuk periode ini (sumber: division_tonase, PTRJ01-09 internal)." /> : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                                        {['Divisi', 'Tonase (t)', '% Tonase', 'Upah Kotor', 'Cost/Ton', 'Upah/HK', 'Premi/Ton', 'HK'].map(h => (
                                            <th key={h} style={{ textAlign: h === 'Divisi' ? 'left' : 'right', padding: '10px 12px', color: C.muted, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {producingDivs.sort((a, b) => Number(b.total_tonase) - Number(a.total_tonase)).map(d => {
                                        const cpt = costPerTon(d);
                                        const vsMean = (cpt != null && meanCpt != null) ? ((cpt - meanCpt) / meanCpt) * 100 : null;
                                        return (
                                            <tr key={d.division_code} onClick={() => setSelectedDivision(d.division_code)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = C.surface2} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                                <td style={{ padding: '11px 12px', fontWeight: 800, color: C.text }}>{d.division_code}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(d.total_tonase, 2)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', color: C.text2 }}>{fmtPercent(d.tonase_share)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(d.total_upah_kotor)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: cpt != null && meanCpt != null && cpt > meanCpt ? C.potongan : C.upah }}>
                                                    {cpt != null ? fmtCompact(cpt) : '-'}
                                                    {vsMean != null && <span style={{ fontSize: 10, color: vsMean > 0 ? C.potongan : C.upah, marginLeft: 4 }}>{vsMean > 0 ? '▲' : '▼'}{Math.abs(vsMean).toFixed(0)}%</span>}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(d.upah_kotor_per_hk)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(d.premi_per_ton)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtNum(d.total_hk, 0)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10 }}>Klik baris divisi untuk bedah per-gang (cost/HK). Cost/Ton valid per divisi · tonase = properti divisi dari mill supplier (PTRJ01-09).</div>
                </div>

                {/* DRILL: per-gang (cost/HK only — tonase not valid per gang) */}
                {selectedDivision && drillDetail && (
                    <div style={{ ...CARD, marginBottom: 24, border: `2px solid ${C.upah}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 0 }}>
                                Bedah Divisi {selectedDivision} · Per Gang <MetricInfo metricKey="cost_per_hk" />
                            </div>
                            <button onClick={() => setSelectedDivision(null)} style={{ border: `1px solid ${C.border}`, background: C.surface2, borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: C.upah }}>← Tutup</button>
                        </div>
                        <div style={{ fontSize: 12, color: C.lembur, background: C.warnBg || '#FBF1DE', border: '1px solid #EDD9B4', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                            <span>Cost/Ton tidak ditampilkan per gang (tonase = properti divisi, bukan regu). Bandingkan gang lewat Cost/HK.</span>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                                        {['Gang', 'Deskripsi', 'HK', 'Upah Kotor', 'Cost/HK', 'Premi', 'Karyawan'].map(h => (
                                            <th key={h} style={{ textAlign: h === 'Gang' || h === 'Deskripsi' ? 'left' : 'right', padding: '10px 12px', color: C.muted, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(drillDetail.gang_rows || []).map(g => {
                                        const cphk = Number(g.total_hk) > 0 ? Number(g.total_upah_kotor) / Number(g.total_hk) : 0;
                                        return (
                                            <tr key={g.gang_code} style={{ borderBottom: `1px solid ${C.border}` }}>
                                                <td style={{ padding: '11px 12px', fontWeight: 800 }}>{g.gang_code}</td>
                                                <td style={{ padding: '11px 12px', color: C.text2 }}>{g.gang_description || '-'}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtNum(g.total_hk, 0)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(g.total_upah_kotor)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: C.lembur }}>{fmtCompact(cphk)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(g.total_premi)}</td>
                                                <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtNum(g.total_employees, 0)}</td>
                                            </tr>
                                        );
                                    })}
                                    {(drillDetail.gang_rows || []).length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Tidak ada gang panen di divisi ini.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                </PresentSlide>

                <PresentSlide num="05" id="slide-05" title="Sebaran & Konsentrasi Tonase" subtitle="Porsi tiap divisi dan kumulasi produksi (analisis Pareto)">
                {shareData.length === 0 ? <EmptyState message="Butuh tonase > 0" /> : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24, marginBottom: 24 }}>
                        {/* Donut sebaran */}
                        <div style={{ ...CARD }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                                Sebaran Tonase per Divisi <MetricInfo metricKey="total_tonase" />
                            </div>
                            <div style={{ height: 260 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Tooltip formatter={(v) => `${fmtNum(v, 1)} t`} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                                        <Pie data={shareData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={2}
                                            onClick={(p) => setSelectedDivision(p.name)}
                                            label={(e) => `${e.name} ${fmtPercent(e.pct)}`}
                                            labelLine={{ stroke: C.muted }} style={{ cursor: 'pointer' }}>
                                            {shareData.map(s => <Cell key={s.name} fill={s.color} />)}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, textAlign: 'center' }}>Klik irisan untuk bedah ke per-gang.</div>
                        </div>

                        {/* Pareto: porsi + kumulatif */}
                        <div style={{ ...CARD }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                                Konsentrasi Produksi (Pareto) <MetricInfo metricKey="total_tonase" />
                            </div>
                            {pareto.length === 0 ? <EmptyState message="Butuh tonase > 0" /> : (
                                <>
                                    <div style={{ height: 260 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={pareto} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.muted }} />
                                                <YAxis yAxisId="l" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: C.muted }} domain={[0, 100]} />
                                                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: C.costTon }} domain={[0, 100]} />
                                                <Tooltip contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                                                <Bar yAxisId="l" dataKey="pct" name="Porsi" fill={C.leafMid} barSize={22} radius={[4, 4, 0, 0]} />
                                                <Line yAxisId="r" type="monotone" dataKey="cum" name="Kumulatif" stroke={C.costTon} strokeWidth={2.5} dot={{ r: 3 }} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 12, fontSize: 12 }}>
                                        {pareto.map(s => (
                                            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                                                <span style={{ fontWeight: 700, color: C.text }}>{s.name}</span>
                                                <span style={{ marginLeft: 'auto', color: C.muted }}>{fmtPercent(s.pct)}<span style={{ color: C.costTon }}> · {fmtPercent(s.cum)}</span></span>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>Porsi = kontribusi tonase divisi. Kumulatif naik cepat → produksi terkonsentrasi di sedikit divisi (Pareto).</div>
                                </>
                            )}
                        </div>
                    </div>
                )}
                </PresentSlide>

                <PresentSlide num="06" id="slide-06" title="Komposisi & Efisiensi Cost per Ton" subtitle="Dekomposisi biaya per ton dan peta efisiensi tiap divisi">
                {/* Decomposition + Scatter — deepen cost/ton */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24, marginBottom: 24 }}>
                    {/* Dekomposisi cost/ton */}
                    <div style={{ ...CARD }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                            Komposisi Cost/Ton <MetricInfo metricKey="upah_kotor_per_ton" />
                        </div>
                        {producingDivs.length === 0 ? <EmptyState message="Butuh tonase > 0" /> : (
                            <div style={{ height: 320 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart layout="vertical" data={producingDivs.map(d => {
                                        const dec = decomposeCost(d); const ton = Number(d.total_tonase);
                                        return { name: d.division_code, GajiPokok: dec.gajiPokok / ton, Lembur: dec.lembur / ton, Premi: dec.premi / ton };
                                    }).sort((a, b) => (b.GajiPokok + b.Lembur + b.Premi) - (a.GajiPokok + a.Lembur + a.Premi))} margin={{ left: 30, right: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                                        <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.muted }} />
                                        <YAxis type="category" dataKey="name" width={40} tick={{ fontSize: 12, fill: C.text, fontWeight: 700 }} />
                                        <Tooltip formatter={(v) => fmtIDR(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                                        <Legend />
                                        <Bar dataKey="GajiPokok" stackId="a" fill={C.upah} />
                                        <Bar dataKey="Lembur" stackId="a" fill={C.lembur} />
                                        <Bar dataKey="Premi" stackId="a" fill={C.costTon} radius={[0, 4, 4, 0]} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* Scatter efisiensi */}
                    <div style={{ ...CARD }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                            Efisiensi: Produktivitas vs Cost/Ton <MetricInfo metricKey="cost_per_ton" />
                        </div>
                        {producingDivs.length === 0 ? <EmptyState message="Butuh tonase > 0" /> : (
                            <div style={{ height: 320 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                                        <XAxis type="number" dataKey="prod" name="Produktivitas" unit=" t/HK" tick={{ fontSize: 11, fill: C.muted }} label={{ value: 'Produktivitas (ton/HK)', position: 'insideBottom', offset: -10, fontSize: 11, fill: C.text2 }} />
                                        <YAxis type="number" dataKey="cpt" name="Cost/Ton" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.muted }} label={{ value: 'Cost/Ton', angle: -90, position: 'insideLeft', fontSize: 11, fill: C.text2 }} />
                                        <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => [n === 'cpt' ? fmtIDR(v) : `${fmtNum(v, 3)} t/HK`, n === 'cpt' ? 'Cost/Ton' : 'Produktivitas']} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                                        <Scatter data={producingDivs.map(d => ({ name: d.division_code, prod: productivity(d), cpt: costPerTon(d) })).filter(p => p.cpt != null && p.prod != null)} onClick={(p) => setSelectedDivision(p.name)}>
                                            {producingDivs.map((d, i) => {
                                                const c = costPerTon(d); const p = productivity(d);
                                                const eff = c != null && meanCpt != null && p != null && c < meanCpt;
                                                const over = c != null && meanCpt != null && c > meanCpt;
                                                return <Cell key={i} fill={eff ? C.upah : (over ? C.potongan : C.lembur)} />;
                                            })}
                                            <LabelList dataKey="name" position="top" style={{ fontSize: 10, fontWeight: 700, fill: C.text2 }} />
                                        </Scatter>
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                        {/* Legend per titik: daftar divisi + posisi + status */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 12, fontSize: 12 }}>
                            {producingDivs.map(d => {
                                const c = costPerTon(d); const p = productivity(d);
                                if (c == null || p == null) return null;
                                const eff = c != null && meanCpt != null && c < meanCpt;
                                const over = c != null && meanCpt != null && c > meanCpt;
                                const color = eff ? C.upah : (over ? C.potongan : C.lembur);
                                const status = eff ? 'Bintang' : (over ? 'Perlu perhatian' : 'Rata-rata');
                                return (
                                    <div key={d.division_code} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                        <span style={{ fontWeight: 700, color: C.text }}>{d.division_code}</span>
                                        <span style={{ color: C.muted, fontSize: 11 }}>{fmtNum(p, 2)} t/HK · {fmtCompact(c)}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color }}>{status}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>Hijau = di bawah rata-rata cost/ton (bintang) · Merah = di atas rata-rata (perlu perhatian). Klik titik untuk bedah.</div>
                    </div>
                </div>
                </PresentSlide>

                <PresentSlide num="07" id="slide-07" title="History Tonase per Divisi" subtitle={`Perjalanan tonase tiap divisi sepanjang ${trend.length} periode`}>
                {divisionHistory.metrics.length === 0 ? <EmptyState message="Belum ada data history divisi" /> : (
                    <>
                        <div style={{ ...CARD, marginBottom: 24 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                                Tren Tonase per Divisi <MetricInfo metricKey="total_tonase" />
                            </div>
                            <div style={{ height: 320 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={divisionHistory.rows} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.muted }} />
                                        <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.muted }} />
                                        <Tooltip formatter={(v, n) => [`${fmtNum(v, 1)} t`, n]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                                        <Legend />
                                        {divisionHistory.metrics.map((d, i) => (
                                            <Line key={d.division_code} type="monotone" dataKey={d.division_code} name={d.division_code} stroke={chartPalette[i % chartPalette.length]} strokeWidth={2} dot={{ r: 2.5 }} />
                                        ))}
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                        <div style={{ ...CARD, marginBottom: 24 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                                Matriks History Tonase <MetricInfo metricKey="total_tonase" />
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                                            <th style={{ textAlign: 'left', padding: '10px 12px', color: C.muted, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>Divisi</th>
                                            {divisionHistory.rows.map(r => <th key={r.label} style={{ textAlign: 'right', padding: '10px 12px', color: C.muted, fontWeight: 700, fontSize: 11 }}>{r.label}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {divisionHistory.metrics.map((d, i) => (
                                            <tr key={d.division_code} style={{ borderBottom: `1px solid ${C.border}` }}>
                                                <td style={{ padding: '11px 12px', fontWeight: 800, color: C.text }}>{d.division_code}</td>
                                                {divisionHistory.rows.map(r => (
                                                    <td key={r.label} style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', color: Number(r[d.division_code]) > 0 ? C.text : C.muted }}>{fmtNum(r[d.division_code], 0)}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
                </PresentSlide>

                <PresentSlide num="08" id="slide-08" title="Tren Tonase & Upah per HK" subtitle="Pergerakan tonase dan upah antar periode">
                {/* Trend chart */}
                <div style={{ ...CARD, marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                        Tren — Tonase & Upah/HK <MetricInfo metricKey="total_tonase" />
                    </div>
                    {trend.length === 0 ? <EmptyState message="Belum ada tren" /> : (
                        <div style={{ height: 320 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={trend} margin={{ top: 10, right: 36, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.muted }} />
                                    <YAxis yAxisId="l" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.muted }} />
                                    <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.costTon }} />
                                    <Tooltip formatter={(v, n) => [n === 'total_tonase' ? `${fmtNum(v, 1)} t` : fmtIDR(v), n]} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13 }} />
                                    <Legend />
                                    <Bar yAxisId="l" dataKey="total_tonase" name="Tonase" fill={C.upah} radius={[4, 4, 0, 0]} barSize={20} />
                                    <Line yAxisId="r" type="monotone" dataKey="upah_kotor_per_hk" name="Upah/HK" stroke={C.lembur} strokeWidth={2.5} dot={{ r: 3 }} />
                                    <Line yAxisId="r" type="monotone" dataKey="premi_per_hk" name="Premi/HK" stroke={C.premi} strokeWidth={2} dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
                </PresentSlide>

                <PresentSlide num="09" id="slide-09" title="Insight & Penutup" subtitle="Uraian premi per divisi dan sorotan penting periode ini">
                {/* Premium breakdown */}
                {premiumBreakdown.length > 0 && (
                    <div style={{ ...CARD, marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
                            Uraian Premi per Divisi <MetricInfo metricKey="total_premi" />
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                                        {['Divisi', 'Brondol', 'Pruning', 'Insentif', 'Kinerja', 'Total Premi'].map(h => (
                                            <th key={h} style={{ textAlign: h === 'Divisi' ? 'left' : 'right', padding: '10px 12px', color: C.muted, fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {premiumBreakdown.map(p => (
                                        <tr key={p.division_code} style={{ borderBottom: `1px solid ${C.border}` }}>
                                            <td style={{ padding: '11px 12px', fontWeight: 800 }}>{p.division_code}</td>
                                            <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtCompact(p.brondol)}</td>
                                            <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtCompact(p.pruning)}</td>
                                            <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtCompact(p.insentif)}</td>
                                            <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtCompact(p.kinerja)}</td>
                                            <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmtCompact(p.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Insight strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
                    <InsightBox label="Tonase Tertinggi" value={insights.highest_tonase_period ? `${insights.highest_tonase_period.label || '-'} · ${fmtNum(insights.highest_tonase_period.value, 0)} t` : '-'} icon={<Scale size={16} />} />
                    <InsightBox label="Pergerakan Terbesar" value={insights.largest_tonase_movement ? `${fmtNum(insights.largest_tonase_movement.value, 0)} t (${insights.largest_tonase_movement.direction || '-'})` : '-'} icon={<TrendingUp size={16} />} />
                    <InsightBox label="Tren Upah/HK" value={insights.upah_kotor_hk_trend || '-'} note={insights.upah_kotor_hk_delta != null ? `${insights.upah_kotor_hk_delta >= 0 ? '+' : ''}${fmtPercent(insights.upah_kotor_hk_delta)}` : ''} icon={<BarChart3 size={16} />} />
                    <InsightBox label="Premi Share" value={fmtPercent(kpis.premi_share)} note="porsi premi dalam upah" icon={<DollarSign size={16} />} />
                </div>

                <ReportPrintMetadata mode="Analisis Tonase" scope="Gang Panen (per divisi)" source={meta.tonase_source || 'division_tonase'} note="Tonase dari mill supplier PTRJ01-09 internal. Cost/Ton valid per divisi." />
                </PresentSlide>

                {/* LAMPIRAN CETAK — bedah per-gang untuk SEMUA divisi produksi */}
                {printExpanded && details.length > 0 && (
                    <div className="tonase-print-drills">
                        <div className="cpts-print-title">Lampiran · Uraian Gang per Divisi</div>
                        <div className="cpts-print-sub">Cost/Ton tidak valid per gang (tonase = properti divisi). Bandingkan gang lewat Cost/HK.</div>
                        {producingDivs.map(d => {
                            const det = details.find(x => x.division_code === d.division_code);
                            return det ? <GangDrillTable key={d.division_code} division={d.division_code} rows={det.gang_rows || []} /> : null;
                        })}
                    </div>
                )}
            </ReportBody>
        </div>
    );
}

const GangDrillTable = ({ division, rows }) => (
    <div style={{ ...CARD, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SECTION_TITLE, marginBottom: 16 }}>
            Bedah Divisi {division} · Per Gang <MetricInfo metricKey="cost_per_hk" />
        </div>
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                        {['Gang', 'Deskripsi', 'HK', 'Upah Kotor', 'Cost/HK', 'Premi', 'Karyawan'].map(h => (
                            <th key={h} style={{ textAlign: h === 'Gang' || h === 'Deskripsi' ? 'left' : 'right', padding: '10px 12px', color: C.muted, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(g => {
                        const cphk = Number(g.total_hk) > 0 ? Number(g.total_upah_kotor) / Number(g.total_hk) : 0;
                        return (
                            <tr key={g.gang_code} style={{ borderBottom: `1px solid ${C.border}` }}>
                                <td style={{ padding: '11px 12px', fontWeight: 800 }}>{g.gang_code}</td>
                                <td style={{ padding: '11px 12px', color: C.text2 }}>{g.gang_description || '-'}</td>
                                <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtNum(g.total_hk, 0)}</td>
                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(g.total_upah_kotor)}</td>
                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: C.lembur }}>{fmtCompact(cphk)}</td>
                                <td style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(g.total_premi)}</td>
                                <td style={{ textAlign: 'right', padding: '11px 12px' }}>{fmtNum(g.total_employees, 0)}</td>
                            </tr>
                        );
                    })}
                    {rows.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: C.muted }}>Tidak ada gang panen di divisi ini.</td></tr>}
                </tbody>
            </table>
        </div>
    </div>
);

const InsightBox = ({ label, value, note, icon }) => (
    <div style={{ ...CARD, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted, marginBottom: 8 }}>
            {icon}<span>{label}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{value}</div>
        {note && <div style={{ fontSize: 12, color: C.text2, marginTop: 4 }}>{note}</div>}
    </div>
);
