
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell, Legend, LineChart, Line, LabelList
} from 'recharts';
import { Printer } from 'lucide-react';
import { FileText, ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';
import LoadingScreen from '../components/common/LoadingScreen';
import DivisionDetailCard from './DivisionDetailCard';
import GangComparisonChart from '../components/dashboard/GangComparisonChart';
import TopBottomPerformersCard from '../components/dashboard/TopBottomPerformersCard';
import GangTrendChart from '../components/dashboard/GangTrendChart';
import GangDetailModal from '../components/dashboard/GangDetailModal';
import CostHKComparisonReport from '../components/CostHKComparisonReport';
import { printReport } from '../utils/printPageSetup';
import { C, SHADOW, CARD, SECTION_TITLE, ReportHero, DeltaBadge, MetricInfo, ScopeToggle, Breadcrumb, EmptyState } from '../components/report/reportTheme';
import { dashJson } from '../utils/dashboardApi';
import { getScopeLabel } from '../utils/gangTypes';
import CostPerTonPanel from '../components/report/CostPerTonPanel';
import ExecSummaryStrip from '../components/report/ExecSummaryStrip';
import CostOfWagePanel from '../components/report/CostOfWagePanel';
import DecompositionPanel from '../components/report/DecompositionPanel';
import EfficiencyQuadrant from '../components/report/EfficiencyQuadrant';
import DivisionTimelineGrid from '../components/report/DivisionTimelineGrid';
import ReportHubFooter from '../components/report/ReportHubFooter';
import WageDistributionChart from '../components/dashboard/WageDistributionChart';
import { SlideNav } from '../components/report/SlideNav';
import PresentSlide from '../components/present/PresentSlide';
import PresentController from '../components/present/PresentController';
import usePresentMode from '../components/present/usePresentMode';
import PotonganBreakdownPanel from '../components/report/PotonganBreakdownPanel';
import OvertimeDeepDivePanel from '../components/report/OvertimeDeepDivePanel';
import PremiCompositionPanel from '../components/report/PremiCompositionPanel';
import HeadcountHkPanel from '../components/report/HeadcountHkPanel';
import {
    buildExecutiveAlertRows,
    buildExecutiveDivisionRows,
    buildExecutivePrintSummary,
    buildExecutiveTrendRows
} from '../utils/executivePayrollPrintReport';
import '../styles/executive-payroll-print.css';

// Helper to format currency
const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val);
};

// Ringkas IDR: >=1e9 -> "Rp 1,24 M", >=1e6 -> "Rp 124 jt"
const formatCompactIDR = (val) => {
    if (val === null || val === undefined) return '-';
    const n = Number(val);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};

const formatNumber = (val) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('id-ID').format(val);
};

// ===== Visual system: Estate Ledger tokens diimpor dari reportTheme (SSOT) =====

// Sparkline mini dari trends
const Spark = ({ data, dataKey, color }) => (
    <ResponsiveContainer width="100%" height={42}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} isAnimationActive={false} />
        </AreaChart>
    </ResponsiveContainer>
);

// Hero KPI card - ledger cell: flat, tick semantik di atas label, angka mono tabular
const HeroKpiCard = ({ label, metricKey, value, pct, invert, sparkData, sparkKey, color, compact, link, onLink }) => {
    return (
        <div style={{ ...CARD, padding: '16px 18px' }}>
            <div style={{ width: 24, height: 2, background: color, marginBottom: 10 }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                {label} {metricKey && <MetricInfo metricKey={metricKey} />}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', fontFamily: 'Roboto Mono, monospace', color: C.text, marginBottom: 8, lineHeight: 1.05 }}>
                {compact ? formatCompactIDR(value) : value}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {pct !== null && pct !== undefined && <DeltaBadge pct={pct} invert={invert} />}
                {link && (
                    <button onClick={() => onLink && onLink(link)} style={{ border: 'none', background: 'none', color: C.upah, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                        Lihat detail →
                    </button>
                )}
            </div>
            {sparkData && sparkKey && <div style={{ marginTop: 12 }}><Spark data={sparkData} dataKey={sparkKey} color={color} /></div>}
        </div>
    );
};

// Report launcher - navigasi ke report spoke, bawa month/year
const REPORT_LINKS = [
    { key: 'story', label: 'Cost/Ton Story', route: '/cost-per-ton-story' },
    { key: 'tonase', label: 'Analisis Tonase', route: '/tonase-analysis' },
    { key: 'summary', label: 'Ringkasan', route: '/summary' },
    { key: 'wages', label: 'Upah Rebinmas', route: '/wages-rebinmas' },
    { key: 'productivity', label: 'Produktivitas', route: '/productivity' },
    { key: 'gang', label: 'Perbandingan Gang', route: '/gang-comparison-report' },
];
const ReportLauncher = ({ month, year, onNavigate }) => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, marginRight: 4 }}>Laporan:</span>
        {REPORT_LINKS.map(r => (
            <button key={r.key} onClick={() => onNavigate(`${r.route}?month=${month}&year=${year}`)}
                style={{ padding: '7px 14px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.surface, color: C.upah, fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: SHADOW, transition: 'all .15s' }}
                onMouseOver={(e) => { e.currentTarget.style.background = C.upah; e.currentTarget.style.color = '#fff'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.upah; }}>
                {r.label} →
            </button>
        ))}
    </div>
);

// Insight strip: alert wage spikes + tren cost/ton (strip datar, bukan kartu gradien)
const InsightStrip = ({ spikes, costChange, onSpikeClick }) => {
    const items = [];
    if (Array.isArray(spikes)) {
        spikes.slice(0, 3).forEach(s => {
            const pct = s.increasePercent ?? s.increase_percent ?? s.percentage ?? s.percent;
            const code = s.gang_code ?? s.gangCode ?? s.id ?? s.name;
            const cause = s.dominant_component ?? s.component;
            items.push({ key: code, text: `${code} Cost/HK naik ${Number(pct || 0).toFixed(1)}%${cause ? `, ${cause}` : ''}`, ref: code });
        });
    }
    if (costChange !== null && Math.abs(costChange) > 10) {
        items.unshift({ key: 'cost', text: `Cost/Ton ${costChange >= 0 ? 'naik' : 'turun'} ${Math.abs(costChange).toFixed(1)}% vs bulan lalu`, ref: null });
    }
    if (items.length === 0) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 8, background: C.surface2, border: `1px solid ${C.border}`, color: C.upah, fontSize: 13, fontWeight: 600 }}>
                <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" />
                Tidak ada anomali signifikan bulan ini
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {items.map(it => (
                <button key={it.key} onClick={() => it.ref && onSpikeClick && onSpikeClick(it.ref)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: C.warnBg, border: `1px solid #E5CFA3`, color: C.lembur, fontSize: 13, fontWeight: 600, cursor: it.ref ? 'pointer' : 'default' }}>
                    <AlertTriangle size={14} strokeWidth={2.2} aria-hidden="true" />
                    {it.text}
                </button>
            ))}
        </div>
    );
};

export default function ExecutivePayrollPage({ onBack, initialMonth, initialYear }) {
    const { token } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [availablePeriods, setAvailablePeriods] = useState([]);

    // Filters - URL query param = single source of truth (shareable + back browser jalan)
    const urlMonth = parseInt(searchParams.get('month')) || null;
    const urlYear = parseInt(searchParams.get('year')) || null;
    const [month, setMonth] = useState(urlMonth || initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(urlYear || initialYear || new Date().getFullYear());

    // Sync month/year -> URL
    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        next.set('month', String(month));
        next.set('year', String(year));
        if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [month, year]);

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
    }, [initialMonth, initialYear]);

    // Comparison State
    const [filterOptions, setFilterOptions] = useState({ divisions: [], gangs: [] });
    const [compMode, setCompMode] = useState('division');
    const [selectedItems, setSelectedItems] = useState([]);
    const [compData, setCompData] = useState(null);
    const [compLoading, setCompLoading] = useState(false);

    // Division Detail Modal State
    const [selectedDivision, setSelectedDivision] = useState(null);
    const [divisionDetails, setDivisionDetails] = useState(null);
    const [divisionDetailsLoading, setDivisionDetailsLoading] = useState(false);

    // Employee Detail State (New)
    const [employeeData, setEmployeeData] = useState([]);
    const [wageDistEmployees, setWageDistEmployees] = useState([]); // overview: semua divisi
    const [wageDistLoading, setWageDistLoading] = useState(false);
    const [filteredEmployees, setFilteredEmployees] = useState([]);
    const [detailedOvertime, setDetailedOvertime] = useState([]);
    const [employeeFilters, setEmployeeFilters] = useState({
        minNetWage: 0,
        minOvertime: 0,
        minPremi: 0,
        search: ''
    });
    const [activeTab, setActiveTab] = useState('overview');

    // Cost/HK Report Tab State
    const [showCostHKReport, setShowCostHKReport] = useState(false);

    // Main Filter State (Header)
    const [selectedFilterDivision, setSelectedFilterDivision] = useState('ALL');

    // Gang Comparison Charts State
    const [gangComparisonData, setGangComparisonData] = useState([]);
    const [topBottomData, setTopBottomData] = useState({ top: [], bottom: [] });
    const [gangChartsLoading, setGangChartsLoading] = useState(false);

    // Gang Detail Modal State
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedGangCode, setSelectedGangCode] = useState(null);

    // Active slide for nav highlight (scroll-spy)
    const [activeSlide, setActiveSlide] = useState('slide-01');
    useEffect(() => {
        const ids = ['slide-01', 'slide-02', 'slide-03', 'slide-04', 'slide-05', 'slide-06'];
        const observers = ids.map(id => {
            const el = document.getElementById(id);
            if (!el) return null;
            const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setActiveSlide(id); }, { rootMargin: '-30% 0px -55% 0px' });
            io.observe(el);
            return io;
        });
        return () => observers.forEach(o => o && o.disconnect());
    }, [data]);

    // Division timeline (lazy - only when its section scrolls into view)
    const [divTrendRows, setDivTrendRows] = useState([]);
    const [divTrendLoading, setDivTrendLoading] = useState(false);
    const divTrendLoadedKey = React.useRef('');
    const divTimelineRef = React.useRef(null);
    useEffect(() => {
        const el = divTimelineRef.current;
        if (!el) return;
        const key = `${month}-${year}`;
        const io = new IntersectionObserver(async (entries) => {
            if (!entries[0].isIntersecting) return;
            io.disconnect();
            if (divTrendLoadedKey.current === key) return;
            divTrendLoadedKey.current = key;
            setDivTrendLoading(true);
            try {
                const j = await dashJson(`/division-cost-trend?month=${month}&year=${year}&span=8`, { token });
                if (j.success) setDivTrendRows(j.data?.series || j.data || []); else divTrendLoadedKey.current = '';
            } catch { divTrendLoadedKey.current = ''; }
            finally { setDivTrendLoading(false); }
        }, { rootMargin: '200px' });
        io.observe(el);
        return () => io.disconnect();
    }, [token, month, year]);

    // Load available periods
    useEffect(() => {
        async function loadPeriods() {
            try {
                const json = await dashJson('/available-periods', { token });
                if (json.success) {
                    setAvailablePeriods(json.data);
                }
            } catch (e) {
                console.error("Failed to load available periods:", e);
            }
        }
        if (token) loadPeriods();
    }, [token]);


    // Auto-select latest period on mount AND load filters
    useEffect(() => {
        async function initializeDashboard() {
            try {
                // Step 1: Get latest period
                const periodJson = await dashJson('/latest-period', { token });

                if (periodJson.success) {
                    const { month: latestMonth, year: latestYear } = periodJson.data;

                    // Only switch if we are strictly using defaults (not user provided props)
                    if (!initialMonth && !initialYear) {
                        if (latestYear !== year || latestMonth !== month) {
                            console.log(`Switching to latest data period: ${latestMonth}/${latestYear}`);
                            setMonth(latestMonth);
                            setYear(latestYear);

                            // Step 2: Load filters for the latest period immediately
                            const filterJson = await dashJson(`/filter-options?month=${latestMonth}&year=${latestYear}`, { token });
                            if (filterJson.success) {
                                setFilterOptions(filterJson.data);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to initialize dashboard:", e);
            }
        }
        if (token) initializeDashboard();
    }, [token]);

    // Fetch semua karyawan (ALL divisi) untuk chart distribusi upah kotor di overview
    useEffect(() => {
        async function loadWageDistribution() {
            if (!token || !month || !year) return;
            setWageDistLoading(true);
            try {
                const json = await dashJson(`/wage-distribution?month=${month}&year=${year}&division_code=ALL`, { token });
                setWageDistEmployees(json.success ? (json.data || []) : []);
            } catch (e) {
                console.error('Wage distribution fetch failed:', e);
                setWageDistEmployees([]);
            } finally {
                setWageDistLoading(false);
            }
        }
        loadWageDistribution();
    }, [token, month, year]);

    const [gangScope, setGangScope] = useState(() => searchParams.get('scope') || 'panen');
    // Present mode: deck fullscreen per slide (toggle html.present-mode + HUD)
    const { presenting, activeIndex, enter, exit } = usePresentMode();
    const drillTo = (targetId) => document.getElementById(targetId)?.scrollIntoView({behavior:'smooth', block:'start'});
    useEffect(() => { const p=new URLSearchParams(searchParams); p.set('scope',gangScope); if(p.toString()!==searchParams.toString()) setSearchParams(p,{replace:true}); }, [gangScope]);
    useEffect(() => {
        async function loadDashboard() {
            setLoading(true);
            try {
                const json = await dashJson(`/executive-summary?month=${month}&year=${year}&scope=${gangScope}`, { token });
                if (json.success) {
                    setData(json.data);
                } else {
                    setError(json.error);
                }
            } catch (e) {
                console.error("Failed to load dashboard:", e);
                setError(e.message);
            } finally {
                setLoading(false);
            }
        }
        if (token && month && year) loadDashboard();
    }, [token, month, year, gangScope]);

    // Load Filter Options when period changes (user selection)
    // Use ref to prevent duplicate API calls for same period
    const lastPeriodRef = useRef('');
    useEffect(() => {
        const currentPeriod = `${year}-${month}`;
        // Skip if we already loaded this period
        if (currentPeriod === lastPeriodRef.current) return;

        async function loadFilters() {
            try {
                // Fetch basic filter options (divisions)
                const json = await dashJson(`/filter-options?month=${month}&year=${year}`, { token });

                if (json.success) {
                    setFilterOptions(prev => {
                        // Only update if data actually changed
                        const divisionsChanged = JSON.stringify(prev.divisions) !== JSON.stringify(json.data.divisions);
                        return divisionsChanged ? json.data : prev;
                    });
                }
                lastPeriodRef.current = currentPeriod;
            } catch (e) {
                console.error("Failed to load filters:", e);
            }
        }
        // Only load filters if month/year changed by user (not initial load)
        if (token && month && year) {
            loadFilters();
        }
    }, [token, month, year]);

    const handleCompare = async () => {
        if (selectedItems.length === 0) return;
        setCompLoading(true);
        try {
            const json = await dashJson('/comparison', {
                token,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: compMode,
                    codes: selectedItems,
                    month,
                    year
                })
            });
            if (json.success) {
                setCompData(json.data);
            }
        } catch (e) {
            console.error("Comparison failed:", e);
        } finally {
            setCompLoading(false);
        }
    };

    // Fetch Division Details (gangs, premi, and overtime breakdown)
    // Use useCallback to prevent infinite re-renders
    const fetchDivisionDetails = useCallback(async (divisionCode) => {
        setSelectedDivision(divisionCode);
        // Sync division -> URL (deep-linkable)
        const next = new URLSearchParams(searchParams);
        next.set('division', divisionCode);
        next.set('month', String(month));
        next.set('year', String(year));
        setSearchParams(next, { replace: true });
        setDivisionDetailsLoading(true);
        setDivisionDetails(null);
        setEmployeeData([]);
        setFilteredEmployees([]);
        setDetailedOvertime([]);
        setEmployeeFilters({ minNetWage: 0, minOvertime: 0, minPremi: 0, search: '' });
        setActiveTab('overview'); // 'overview', 'overtime', 'employees'

        try {
            // Parallel Fetching
            const [gangData, premiData, otData, detailData] = await Promise.all([
                dashJson(`/aggregated-gang-data?month=${month}&year=${year}&division_code=${divisionCode}`, { token }),
                dashJson(`/premi-analysis?month=${month}&year=${year}&division_code=${divisionCode}`, { token }),
                dashJson(`/overtime-analysis?month=${month}&year=${year}&division_code=${divisionCode}`, { token }),
                dashJson(`/division-detail-data?month=${month}&year=${year}&division_code=${divisionCode}`, { token })
            ]);

            setDivisionDetails({
                gangs: gangData.success ? gangData.data : [],
                premi: premiData.success ? premiData.data : [],
                overtime: otData.success ? otData.data : []
            });

            if (detailData.success) {
                setEmployeeData(detailData.data.employees || []);
                setFilteredEmployees(detailData.data.employees || []);
                setDetailedOvertime(detailData.data.overtimeBreakdown || []);
            }
        } catch (e) {
            console.error("Failed to fetch division details:", e);
            setDivisionDetails({ gangs: [], premi: [], overtime: [] });
        } finally {
            setDivisionDetailsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, month, year]);

    // Handle bar click
    const handleDivisionBarClick = (data) => {
        if (data && data.name) {
            fetchDivisionDetails(data.name);
        }
    };

    // Deep-link: buka division langsung dari URL (?division=X)
    const urlDivision = searchParams.get('division');
    const deepLinkDone = useRef(false);
    useEffect(() => {
        if (!deepLinkDone.current && urlDivision && token) {
            deepLinkDone.current = true;
            setSelectedFilterDivision(urlDivision); // memicu fetchDivisionDetails via effect
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlDivision, token]);

    // Load Gang Comparison Charts Data
    useEffect(() => {
        async function loadGangCharts() {
            if (!token || !month || !year) return;

            setGangChartsLoading(true);
            try {
                const divParam = selectedFilterDivision !== 'ALL' ? `&division_code=${selectedFilterDivision}` : '';

                // Fetch gang comparison (scope diteruskan agar konsisten dengan KPI/tren)
                const compJson = await dashJson(`/gang-comparison?month=${month}&year=${year}${divParam}&scope=${gangScope}`, { token });
                if (compJson.success) {
                    setGangComparisonData(compJson.data);
                }

                // Fetch top/bottom performers
                const topBottomJson = await dashJson(`/top-bottom-gangs?month=${month}&year=${year}${divParam}&scope=${gangScope}`, { token });
                if (topBottomJson.success) {
                    setTopBottomData(topBottomJson.data);
                }
            } catch (e) {
                console.error("Failed to load gang charts:", e);
            } finally {
                setGangChartsLoading(false);
            }
        }

        loadGangCharts();
    }, [token, month, year, selectedFilterDivision, gangScope]);

    // Derived Data for Charts
    const divisionChartData = useMemo(() => {
        if (!data || !data.breakdown) return [];
        // All Divisions sorted by Wage - show stacked breakdown
        return data.breakdown
            .sort((a, b) => b.total_wage - a.total_wage)
            .map(d => {
                const total = d.total_wage || 1; // Avoid division by zero
                const overtime = d.total_ot || 0;
                const premi = d.total_premi || 0;
                const base = Math.max(0, total - overtime - premi); // Base = Total - OT - Premi

                return {
                    name: d.division_code,
                    Total: total,
                    Base: base,
                    Overtime: overtime,
                    Premi: premi,
                    // Percentages for tooltip
                    basePercent: ((base / total) * 100).toFixed(1),
                    otPercent: ((overtime / total) * 100).toFixed(1),
                    premiPercent: ((premi / total) * 100).toFixed(1)
                };
            });
    }, [data?.breakdown]);

    // Trigger detail fetch when division filter changes
    useEffect(() => {
        if (selectedFilterDivision !== 'ALL') {
            fetchDivisionDetails(selectedFilterDivision);
        } else {
            // clear details if back to ALL
            setDivisionDetails(null);
        }
    }, [selectedFilterDivision, month, year, fetchDivisionDetails]);

    const productivityData = useMemo(() => {
        if (!data || !data.productivityTrend) return [];
        return data.productivityTrend;
    }, [data?.productivityTrend]);

    const wageSpikes = useMemo(() => {
        if (!data || !data.wageSpikes) return [];
        return data.wageSpikes;
    }, [data?.wageSpikes]);

    const kpi = data?.kpi || null;
    const trends = Array.isArray(data?.trends) ? data.trends : [];
    const percent = (value, total) => total > 0 ? ((value / total) * 100).toFixed(1) : 0;

    const calcChange = (curr, prev) => {
        if (!prev) return 0;
        return ((curr - prev) / prev) * 100;
    };

    const wageChange = kpi ? calcChange(kpi.curr_wage, kpi.prev_wage) : 0;
    const otChange = kpi ? calcChange(kpi.curr_ot, kpi.prev_ot) : 0;
    const headChange = kpi ? calcChange(kpi.curr_headcount, kpi.prev_headcount) : 0;
    const currentTrend = trends[trends.length - 1] || {};
    const prevTrend = trends[trends.length - 2] || {};
    const costPerTon = currentTrend.cost_per_ton ?? null;
    const costPerTonChange = costPerTon !== null && prevTrend.cost_per_ton ? calcChange(costPerTon, prevTrend.cost_per_ton) : 0;
    const tonaseChange = calcChange(currentTrend.total_tonase || 0, prevTrend.total_tonase || 0);
    const premiShare = currentTrend.total_wage > 0 ? ((currentTrend.total_premi || 0) / currentTrend.total_wage) * 100 : 0;
    const prevPremiShare = prevTrend.total_wage > 0 ? ((prevTrend.total_premi || 0) / prevTrend.total_wage) * 100 : 0;
    const premiShareChange = premiShare - prevPremiShare;
    const sparkTrends = trends.slice(-12);
    const premiShareSpark = sparkTrends.map(t => ({ ...t, premiShareVal: t.total_wage > 0 ? ((t.total_premi || 0) / t.total_wage) * 100 : 0 }));
    const reportPeriodLabel = new Date(year, month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const printGeneratedAt = new Date().toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const activePrintFilters = [
        selectedFilterDivision === 'ALL' ? 'Semua Divisi' : `Divisi ${selectedFilterDivision}`,
        getScopeLabel(gangScope)
    ].join(' / ');
    const printSummary = useMemo(() => buildExecutivePrintSummary({
        kpi,
        breakdown: data?.breakdown,
        efficiency: data?.efficiency,
        productivityTrend: data?.productivityTrend,
        wageSpikes
    }), [kpi, data?.breakdown, data?.efficiency, data?.productivityTrend, wageSpikes]);
    const printDivisionRows = useMemo(() => buildExecutiveDivisionRows({
        breakdown: data?.breakdown,
        efficiency: data?.efficiency
    }), [data?.breakdown, data?.efficiency]);
    const printTrendRows = useMemo(() => buildExecutiveTrendRows({
        trends,
        productivityTrend: productivityData
    }), [trends, productivityData]);
    const printAlertRows = useMemo(() => buildExecutiveAlertRows(wageSpikes), [wageSpikes]);
    const printGangRows = useMemo(() => (Array.isArray(data?.gangBreakdown) ? data.gangBreakdown : [])
        .map((gang) => {
            const totalWage = Number(gang.total_wage) || 0;
            const overtime = Number(gang.total_ot) || 0;
            return {
                gangCode: gang.gang_code || '-',
                totalWage,
                overtime,
                headcount: Number(gang.headcount) || 0,
                overtimeShare: totalWage > 0 ? (overtime / totalWage) * 100 : 0
            };
        })
        .sort((a, b) => b.totalWage - a.totalWage), [data?.gangBreakdown]);

    const handlePrintExecutiveReport = () => {
        printReport({ orientation: 'landscape', margin: '0' });
    };

    if (loading) return <LoadingScreen isLoading={true} message="Loading Executive Dashboard..." />;
    if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;
    if (!data) return null;

    return (
        <>
            {selectedFilterDivision !== 'ALL' ? (
                <DivisionDetailCard
                    division={selectedFilterDivision}
                    data={divisionDetails}
                    loading={divisionDetailsLoading}
                    initialEmp={searchParams.get('emp')}
                    onBack={() => {
                        setSelectedFilterDivision('ALL');
                        const next = new URLSearchParams(searchParams);
                        next.delete('division');
                        next.delete('emp');
                        setSearchParams(next, { replace: true });
                    }}
                />
            ) : (
                <div className="executive-payroll-page" style={{ background: C.pageBg, minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
                    {/* MASTHEAD - datar ala ledger: paper, hairline bawah, tanpa gradient/motif */}
                    <div className="executive-page-header no-print">
                        <ReportHero
                            eyebrow="Perkebunan Sawit · Executive"
                            title="Daftar Upah Analysis"
                            subtitle={`Kinerja biaya, upah kotor, cost per ton · ${getScopeLabel(gangScope)}`}
                            period={reportPeriodLabel}
                            actions={(
                                <>
                                    {/* Cost/HK Report Button */}
                                    <button
                                        onClick={() => setShowCostHKReport(!showCostHKReport)}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.45rem',
                                            padding: '0.5rem 1rem',
                                            background: showCostHKReport ? C.upah : C.surface,
                                            color: showCostHKReport ? '#fff' : C.text2,
                                            borderRadius: '8px',
                                            border: `1px solid ${showCostHKReport ? C.upah : C.border}`,
                                            fontWeight: '600',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: SHADOW,
                                            minWidth: '140px',
                                            justifyContent: 'center'
                                        }}
                                    >
                                        {showCostHKReport
                                            ? (<><ArrowLeft size={16} strokeWidth={2.2} aria-hidden="true" /><span>Kembali ke Dashboard</span></>)
                                            : (<><FileText size={16} strokeWidth={2.2} aria-hidden="true" /><span>Laporan Cost/HK</span></>)}
                                    </button>

                                    {!showCostHKReport && (
                                        <>
                                            <button
                                                type="button"
                                                className="executive-print-button"
                                                aria-label="Cetak executive payroll report"
                                                onClick={handlePrintExecutiveReport}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.45rem',
                                                    padding: '0.5rem 1rem',
                                                    background: C.leafDark,
                                                    color: 'white',
                                                    borderRadius: '8px',
                                                    border: `1px solid ${C.leafDark}`,
                                                    fontWeight: '700',
                                                    cursor: 'pointer',
                                                    outline: 'none',
                                                    boxShadow: SHADOW,
                                                    minWidth: '132px',
                                                    justifyContent: 'center'
                                                }}
                                            >
                                                <span
                                                    className="executive-print-button-icon"
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        width: '1.35rem',
                                                        height: '1.35rem',
                                                        borderRadius: '6px',
                                                        background: 'white',
                                                        color: C.leafDark,
                                                        flex: '0 0 auto'
                                                    }}
                                                >
                                                    <Printer size={17} strokeWidth={2.4} aria-hidden="true" />
                                                </span>
                                                <span>Cetak Report</span>
                                            </button>

                                            {/* Division Filter */}
                                            <select
                                                value={selectedFilterDivision}
                                                onChange={(e) => setSelectedFilterDivision(e.target.value)}
                                                style={{
                                                    padding: '0.5rem 1rem',
                                                    background: C.surface,
                                                    borderRadius: '8px',
                                                    border: `1px solid ${C.border}`,
                                                    fontWeight: '600',
                                                    color: C.text2,
                                                    cursor: 'pointer',
                                                    outline: 'none',
                                                    boxShadow: SHADOW,
                                                    minWidth: '120px'
                                                }}
                                            >
                                                <option value="ALL">Semua Divisi</option>
                                                {(Array.isArray(filterOptions.divisions) ? filterOptions.divisions : []).map((div, idx) => (
                                                    <option key={idx} value={div}>{div}</option>
                                                ))}
                                            </select>

                                            {/* Period Select */}
                                            <select
                                                value={`${year}-${month}`}
                                                onChange={(e) => {
                                                    const [y, m] = e.target.value.split('-').map(Number);
                                                    setYear(y);
                                                    setMonth(m);
                                                }}
                                                style={{
                                                    padding: '0.5rem 1rem',
                                                    background: C.surface,
                                                    borderRadius: '8px',
                                                    border: `1px solid ${C.border}`,
                                                    fontWeight: '600',
                                                    color: C.text2,
                                                    cursor: 'pointer',
                                                    outline: 'none',
                                                    boxShadow: SHADOW
                                                }}
                                            >
                                                {(Array.isArray(availablePeriods) && availablePeriods.length > 0) ? (
                                                    availablePeriods.map((p, idx) => (
                                                        <option key={idx} value={`${p.year}-${p.month}`}>
                                                            {new Date(p.year, p.month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                                                        </option>
                                                    ))
                                                ) : (
                                                    <option value={`${year}-${month}`}>
                                                        {new Date(year, month - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                                                    </option>
                                                )}
                                            </select>
                                        </>
                                    )}
                                </>
                            )}
                        />
                    </div>

                    {/* PRESENT MODE - tombol Present (mode normal) + HUD deck (present mode) */}
                    <div className="no-print" style={{ maxWidth: 1320, margin: '0 auto', padding: '0.75rem 2.5rem 0', display: 'flex', justifyContent: 'flex-end' }}>
                        <PresentController
                            presenting={presenting}
                            activeIndex={activeIndex}
                            slideCount={6}
                            onEnter={enter}
                            onExit={exit}
                            caption={`Executive · ${reportPeriodLabel} · ${getScopeLabel(gangScope)}`}
                        />
                    </div>

                    {/* CONTENT WRAPPER */}
                    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '1.5rem 2.5rem 3rem', position: 'relative' }}>
                        <Breadcrumb items={[
                            { label: 'Executive Board', onClick: () => { setSelectedFilterDivision('ALL'); setShowCostHKReport(false); } },
                            ...(showCostHKReport ? [{ label: 'Laporan Cost/HK' }] : []),
                            ...(selectedFilterDivision !== 'ALL' ? [{ label: `Divisi ${selectedFilterDivision}` }] : [])
                        ]} />

                    {!showCostHKReport && (
                        <section id="executive-print-report" className="executive-print-report print-only">
                            <header className="executive-print-header">
                                <div>
                                    <div className="executive-print-eyebrow">EXECUTIVE PAYROLL REPORT</div>
                                    <h2>Daftar Upah Analysis Keseluruhan</h2>
                                    <p>Periode {reportPeriodLabel} | {activePrintFilters}</p>
                                </div>
                                <div className="executive-print-meta-box">
                                    <span>Dicetak</span>
                                    <strong>{printGeneratedAt}</strong>
                                    <span>Sumber</span>
                                    <strong>Payroll Dashboard</strong>
                                </div>
                            </header>

                            <div className="executive-print-kpi-grid">
                                <article className="executive-print-kpi-card">
                                    <span>Total Payroll</span>
                                    <strong>{formatCurrency(printSummary.totalWage)}</strong>
                                    <small>{printSummary.wageChange >= 0 ? '+' : ''}{printSummary.wageChange.toFixed(1)}% vs bulan lalu</small>
                                </article>
                                <article className="executive-print-kpi-card">
                                    <span>Total Lembur</span>
                                    <strong>{formatCurrency(printSummary.totalOvertime)}</strong>
                                    <small>{printSummary.overtimeShare.toFixed(1)}% dari payroll</small>
                                </article>
                                <article className="executive-print-kpi-card">
                                    <span>Headcount</span>
                                    <strong>{formatNumber(printSummary.headcount)}</strong>
                                    <small>{printSummary.headcountChange >= 0 ? '+' : ''}{printSummary.headcountChange.toFixed(1)}% vs bulan lalu</small>
                                </article>
                                <article className="executive-print-kpi-card">
                                    <span>Cost/HK Terakhir</span>
                                    <strong>{formatCurrency(printSummary.latestCostPerHk)}</strong>
                                    <small>berdasarkan tren produktivitas</small>
                                </article>
                                <article className="executive-print-kpi-card">
                                    <span>Alert Gang</span>
                                    <strong>{formatNumber(printSummary.alertCount)}</strong>
                                    <small>lonjakan Cost/HK terdeteksi</small>
                                </article>
                            </div>

                            <div className="executive-print-insight-grid">
                                <article>
                                    <span>Fokus payroll terbesar</span>
                                    <strong>{printSummary.largestPayrollDivision?.divisionCode || '-'}</strong>
                                    <small>{formatCurrency(printSummary.largestPayrollDivision?.totalWage || 0)} - {printSummary.largestPayrollDivision?.payrollShare.toFixed(1) || '0.0'}% dari total</small>
                                </article>
                                <article>
                                    <span>Lembur terbesar</span>
                                    <strong>{printSummary.largestOvertimeDivision?.divisionCode || '-'}</strong>
                                    <small>{formatCurrency(printSummary.largestOvertimeDivision?.overtime || 0)} - {printSummary.largestOvertimeDivision?.overtimeShare.toFixed(1) || '0.0'}% dari payroll divisi</small>
                                </article>
                                <article>
                                    <span>Cost/HK tertinggi</span>
                                    <strong>{printSummary.highestCostPerHkDivision?.divisionCode || '-'}</strong>
                                    <small>{formatCurrency(printSummary.highestCostPerHkDivision?.costPerHk || 0)} per HK</small>
                                </article>
                                <article>
                                    <span>Arah biaya</span>
                                    <strong>{printSummary.wageChange >= 0 ? 'Naik' : 'Turun'}</strong>
                                    <small>Payroll {printSummary.wageChange >= 0 ? '+' : ''}{printSummary.wageChange.toFixed(1)}%, lembur {printSummary.overtimeChange >= 0 ? '+' : ''}{printSummary.overtimeChange.toFixed(1)}%</small>
                                </article>
                            </div>

                            <section className="executive-print-section">
                                <div className="executive-print-section-title">
                                    <h3>Ringkasan Divisi</h3>
                                    <span>diurutkan dari payroll terbesar</span>
                                </div>
                                <table className="executive-print-table executive-print-division-table">
                                    <thead>
                                        <tr>
                                            <th>Divisi</th>
                                            <th>Total Upah</th>
                                            <th>% Total</th>
                                            <th>Lembur</th>
                                            <th>% OT</th>
                                            <th>Premi</th>
                                            <th>HK</th>
                                            <th>Cost/HK</th>
                                            <th>Headcount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {printDivisionRows.length === 0 ? (
                                            <tr>
                                                <td colSpan="9">Tidak ada data divisi.</td>
                                            </tr>
                                        ) : printDivisionRows.map((row) => (
                                            <tr key={row.divisionCode}>
                                                <td className="text-center strong">{row.divisionCode}</td>
                                                <td className="text-right">{formatCurrency(row.totalWage)}</td>
                                                <td className="text-right">{row.payrollShare.toFixed(1)}%</td>
                                                <td className="text-right">{formatCurrency(row.overtime)}</td>
                                                <td className="text-right">{row.overtimeShare.toFixed(1)}%</td>
                                                <td className="text-right">{formatCurrency(row.premi)}</td>
                                                <td className="text-right">{formatNumber(row.totalHk)}</td>
                                                <td className="text-right">{formatCurrency(row.costPerHk)}</td>
                                                <td className="text-right">{formatNumber(row.headcount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td>Total</td>
                                            <td className="text-right">{formatCurrency(printSummary.totalWage)}</td>
                                            <td className="text-right">100.0%</td>
                                            <td className="text-right">{formatCurrency(printSummary.totalOvertime)}</td>
                                            <td className="text-right">{printSummary.overtimeShare.toFixed(1)}%</td>
                                            <td colSpan="4"></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </section>

                            <div className="executive-print-two-column">
                                <section className="executive-print-section">
                                    <div className="executive-print-section-title">
                                        <h3>Tren 12 Periode</h3>
                                        <span>payroll, lembur, dan produktivitas</span>
                                    </div>
                                    <table className="executive-print-table executive-print-trend-table">
                                        <thead>
                                            <tr>
                                                <th>Periode</th>
                                                <th>Total Upah</th>
                                                <th>Lembur</th>
                                                <th>% OT</th>
                                                <th>HK</th>
                                                <th>Cost/HK</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {printTrendRows.length === 0 ? (
                                                <tr>
                                                    <td colSpan="6">Tidak ada data tren.</td>
                                                </tr>
                                            ) : printTrendRows.map((row) => (
                                                <tr key={row.period}>
                                                    <td className="strong">{row.period}</td>
                                                    <td className="text-right">{formatCurrency(row.totalWage)}</td>
                                                    <td className="text-right">{formatCurrency(row.overtime)}</td>
                                                    <td className="text-right">{row.overtimeShare.toFixed(1)}%</td>
                                                    <td className="text-right">{formatNumber(row.totalHk)}</td>
                                                    <td className="text-right">{formatCurrency(row.costPerHk)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </section>

                                <section className="executive-print-section">
                                    <div className="executive-print-section-title">
                                        <h3>Top Gang by Cost</h3>
                                        <span>15 gang biaya tertinggi</span>
                                    </div>
                                    <table className="executive-print-table executive-print-gang-table">
                                        <thead>
                                            <tr>
                                                <th>Gang</th>
                                                <th>Total Upah</th>
                                                <th>Lembur</th>
                                                <th>% OT</th>
                                                <th>Headcount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {printGangRows.length === 0 ? (
                                                <tr>
                                                    <td colSpan="5">Tidak ada data gang.</td>
                                                </tr>
                                            ) : printGangRows.map((row) => (
                                                <tr key={row.gangCode}>
                                                    <td className="strong">{row.gangCode}</td>
                                                    <td className="text-right">{formatCurrency(row.totalWage)}</td>
                                                    <td className="text-right">{formatCurrency(row.overtime)}</td>
                                                    <td className="text-right">{row.overtimeShare.toFixed(1)}%</td>
                                                    <td className="text-right">{formatNumber(row.headcount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </section>
                            </div>

                            <section className="executive-print-section executive-print-alert-section">
                                <div className="executive-print-section-title">
                                    <h3>Gang Cost/HK Alert</h3>
                                    <span>prioritas review operasional</span>
                                </div>
                                <table className="executive-print-table executive-print-alert-table">
                                    <thead>
                                        <tr>
                                            <th>Gang</th>
                                            <th>Keterangan</th>
                                            <th>Kenaikan</th>
                                            <th>Cost/HK Kini</th>
                                            <th>Selisih</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {printAlertRows.length === 0 ? (
                                            <tr>
                                                <td colSpan="5">Tidak ada lonjakan Cost/HK di periode ini.</td>
                                            </tr>
                                        ) : printAlertRows.map((row) => (
                                            <tr key={row.gangCode}>
                                                <td className="strong">{row.gangCode}</td>
                                                <td>{row.label}</td>
                                                <td className="text-right">{row.increasePercent.toFixed(1)}%</td>
                                                <td className="text-right">{formatCurrency(row.currentCostPerHk)}</td>
                                                <td className="text-right">{formatCurrency(row.difference)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>
                        </section>
                    )}

                    <div className="executive-dashboard-screen">
                    {/* Cost/HK Report */}
                    {showCostHKReport ? (
                        <CostHKComparisonReport
                            initialMonth={month}
                            initialYear={year}
                        />
                    ) : (
                        <>

                            {/* REPORT LAUNCHER */}
                            <div style={{ marginBottom: '1.25rem' }}>
                                <ReportLauncher month={month} year={year} onNavigate={(to) => navigate(to)} />
                            </div>

                            <SlideNav activeId={activeSlide} slides={[
                                { id: 'slide-01', num: '01', label: 'Ringkasan' },
                                { id: 'slide-02', num: '02', label: 'Upah' },
                                { id: 'slide-03', num: '03', label: 'Tonase & Cost' },
                                { id: 'slide-04', num: '04', label: 'Divisi & Gang' },
                                { id: 'slide-05', num: '05', label: 'Efisiensi' },
                                { id: 'slide-06', num: '06', label: 'Laporan' }
                            ]} />

                            <PresentSlide num="01" id="slide-01" title="Ringkasan Eksekutif" subtitle="Kinerja utama bulan berjalan dalam satu pandangan">
                            {/* HERO KPI ROW */}
                            {kpi && (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                                        <div style={{ ...SECTION_TITLE, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            Kinerja Utama · {getScopeLabel(gangScope)} (Upah Kotor)
                                            <MetricInfo metricKey="total_upah_kotor" />
                                        </div>
                                        <ScopeToggle value={gangScope} onChange={setGangScope} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 20 }}>
                                        <HeroKpiCard label="Total Upah Kotor" metricKey="total_upah_kotor" value={kpi.curr_wage} pct={wageChange} invert sparkData={sparkTrends} sparkKey="total_wage" color={C.upah} compact onLink={()=>drillTo('slide-02')} />
                                        <HeroKpiCard label="Cost / Ton" metricKey="cost_per_ton" value={costPerTon !== null ? costPerTon : null} pct={costPerTonChange} invert sparkData={sparkTrends} sparkKey="cost_per_ton" color={C.costTon} compact onLink={()=>drillTo('slide-03')} />
                                        <HeroKpiCard label="Tonase" metricKey="total_tonase" value={`${formatNumber(currentTrend.total_tonase || 0)} t`} pct={tonaseChange} sparkData={sparkTrends} sparkKey="total_tonase" color={C.premi} onLink={()=>drillTo('slide-03')} />
                                        <HeroKpiCard label="Headcount" metricKey="headcount_panen" value={formatNumber(kpi.curr_headcount)} pct={headChange} sparkData={sparkTrends} sparkKey="total_headcount" color={C.upahAccent} onLink={()=>drillTo('slide-04')} />
                                        <HeroKpiCard label="Premi Share" metricKey="premi_share" value={`${premiShare.toFixed(1)}%`} pct={premiShareChange} invert sparkData={premiShareSpark} sparkKey="premiShareVal" color={C.lembur} onLink={()=>drillTo('slide-02')} />
                                    </div>
                                    {(currentTrend.total_tonase || 0) === 0 && (
                                        <div style={{ marginTop: 16 }}>
                                            <EmptyState
                                                title="Tonase & Cost/Ton belum aktif"
                                                message="Sumber tonase TBS (total_ffb_weight) bernilai 0 untuk periode ini. Upah kotor & headcount tetap akurat, hanya metrik per-ton yang menunggu data tonase diisi."
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* INSIGHT STRIP */}
                            <div style={{ marginBottom: '1.5rem' }}>
                                <InsightStrip spikes={wageSpikes} costChange={costPerTonChange} onSpikeClick={(code) => { setSelectedGangCode(code); setDetailModalOpen(true); }} />
                            </div>

                            {/* EXEC SUMMARY STRIP - naratif otomatis */}
                            <ExecSummaryStrip trends={trends} breakdown={Array.isArray(data?.breakdown) ? data.breakdown : []} wageSpikes={wageSpikes} periodLabel={reportPeriodLabel} />
                            </PresentSlide>

                            <PresentSlide num="02" id="slide-02" title="Upah & Komponen" subtitle="Dekomposisi upah kotor, lembur, dan premi">
                            {/* DEKOMPOSISI UPAH KOTOR */}
                            <DecompositionPanel breakdown={Array.isArray(data?.breakdown) ? data.breakdown : []} />

                            {/* KPI ANALISIS GRID - Analisis KPI - Gang Panen */}
                            <div style={{ marginBottom: '1.5rem' }}>
                                <div style={{ ...SECTION_TITLE, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    Analisis KPI · {getScopeLabel(gangScope)}
                                    <MetricInfo metricKey="total_upah_kotor" />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                                    {/* 1. Lembur Share */}
                                    {(() => {
                                        const curr = trends[trends.length - 1] || {};
                                        const prev = trends[trends.length - 2] || {};
                                        const currShare = curr.total_wage > 0 ? ((curr.total_ot || 0) / curr.total_wage) * 100 : 0;
                                        const prevShare = prev.total_wage > 0 ? ((prev.total_ot || 0) / prev.total_wage) * 100 : 0;
                                        const shareChange = currShare - prevShare;
                                        const sparkData = trends.slice(-12).map(t => ({ ...t, lemburShare: t.total_wage > 0 ? ((t.total_ot || 0) / t.total_wage) * 100 : 0 }));
                                        return (
                                            <div style={CARD}>
                                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    Lembur Share <MetricInfo metricKey="total_lembur" />
                                                </div>
                                                <div style={{ fontSize: 28, fontWeight: 800, color: C.lembur, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{currShare.toFixed(1)}%</div>
                                                <DeltaBadge pct={shareChange} invert={true} />
                                                <div style={{ marginTop: 12 }}><Spark data={sparkData} dataKey="lemburShare" color={C.lembur} /></div>
                                            </div>
                                        );
                                    })()}

                                    {/* 2. Upah per Karyawan */}
                                    {(() => {
                                        const curr = trends[trends.length - 1] || {};
                                        const prev = trends[trends.length - 2] || {};
                                        const currVal = curr.total_headcount > 0 ? (curr.total_wage || 0) / curr.total_headcount : 0;
                                        const prevVal = prev.total_headcount > 0 ? (prev.total_wage || 0) / prev.total_headcount : 0;
                                        const change = calcChange(currVal, prevVal);
                                        return (
                                            <div style={CARD}>
                                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    Upah per Karyawan <MetricInfo metricKey="upah_kotor_per_hk" />
                                                </div>
                                                <div style={{ fontSize: 28, fontWeight: 800, color: C.upah, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{formatCompactIDR(currVal)}</div>
                                                <DeltaBadge pct={change} invert={true} />
                                            </div>
                                        );
                                    })()}

                                    {/* 3. Premi Share + dekomposisi */}
                                    {(() => {
                                        const curr = trends[trends.length - 1] || {};
                                        const prev = trends[trends.length - 2] || {};
                                        const currShare = curr.total_wage > 0 ? ((curr.total_premi || 0) / curr.total_wage) * 100 : 0;
                                        const prevShare = prev.total_wage > 0 ? ((prev.total_premi || 0) / prev.total_wage) * 100 : 0;
                                        const shareChange = currShare - prevShare;
                                        const premiDecomp = (Array.isArray(data?.breakdown) ? data.breakdown : [])
                                            .filter(d => d.total_premi > 0)
                                            .sort((a, b) => b.total_premi - a.total_premi)
                                            .slice(0, 5)
                                            .map(d => ({ name: d.division_code, Premi: d.total_premi }));
                                        return (
                                            <div style={CARD}>
                                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    Premi Share <MetricInfo metricKey="premi_share" />
                                                </div>
                                                <div style={{ fontSize: 28, fontWeight: 800, color: C.premi, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{currShare.toFixed(1)}%</div>
                                                <DeltaBadge pct={shareChange} invert={true} />
                                                {premiDecomp.length > 0 && (
                                                    <div style={{ marginTop: 12, height: 80 }}>
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <BarChart data={premiDecomp} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                                                                <XAxis type="number" hide />
                                                                <YAxis dataKey="name" type="category" width={40} fontSize={9} tick={{ fill: C.muted }} />
                                                                <Bar dataKey="Premi" fill={C.premi} radius={[0, 4, 4, 0]} barSize={10} />
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* 4. HK Utilization */}
                                    {(() => {
                                        const curr = trends[trends.length - 1] || {};
                                        const hkPerHead = curr.total_headcount > 0 ? (curr.total_hk || 0) / curr.total_headcount : 0;
                                        return (
                                            <div style={CARD}>
                                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    HK Utilization <MetricInfo metricKey="cost_per_hk" />
                                                </div>
                                                <div style={{ fontSize: 28, fontWeight: 800, color: C.upahAccent, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{hkPerHead.toFixed(1)}</div>
                                                <div style={{ fontSize: 11, color: C.muted }}>HK per orang (rata-rata hari kerja)</div>
                                            </div>
                                        );
                                    })()}

                                    {/* 5. Tunjangan */}
                                    {(() => {
                                        const curr = trends[trends.length - 1] || {};
                                        const hasTunjangan = curr.total_tunjangan !== undefined && curr.total_tunjangan !== null;
                                        if (!hasTunjangan) return null;
                                        return (
                                            <div style={CARD}>
                                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, marginBottom: 8 }}>Tunjangan</div>
                                                <div style={{ fontSize: 28, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{formatCompactIDR(curr.total_tunjangan)}</div>
                                            </div>
                                        );
                                    })()}

                                    {/* 6. Cost / HK */}
                                    {(() => {
                                        const curr = trends[trends.length - 1] || {};
                                        const prev = trends[trends.length - 2] || {};
                                        const costHk = curr.cost_per_hk ?? null;
                                        const prevCostHk = prev.cost_per_hk ?? null;
                                        const change = costHk !== null && prevCostHk ? calcChange(costHk, prevCostHk) : 0;
                                        return (
                                            <div style={CARD}>
                                                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    Cost / HK <MetricInfo metricKey="cost_per_hk" />
                                                </div>
                                                <div style={{ fontSize: 28, fontWeight: 800, color: C.costTon, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>{costHk !== null ? formatCurrency(costHk) : '-'}</div>
                                                {costHk !== null && <DeltaBadge pct={change} invert={true} />}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* POTONGAN BREAKDOWN */}
                            <PotonganBreakdownPanel breakdown={data.breakdown} onDrill={fetchDivisionDetails} />

                            {/* KPI tambahan - kreatif & rapi */}
                            <OvertimeDeepDivePanel trends={trends} breakdown={data.breakdown} />
                            <PremiCompositionPanel trends={trends} breakdown={data.breakdown} premiumBreakdown={data.premiumBreakdown || []} />
                            <HeadcountHkPanel trends={trends} breakdown={data.breakdown} />

                            {/* DISTRIBUSI UPAH KOTOR - semua divisi, klik dot drill ke salary-range report */}
                            {!wageDistLoading && wageDistEmployees.length > 0 && (
                                <div style={{ ...CARD, marginBottom: '1.5rem' }}>
                                    <div style={SECTION_TITLE}>Sebaran Karyawan per Rentang Upah Kotor</div>
                                    <WageDistributionChart
                                        employees={wageDistEmployees}
                                        activeRange={null}
                                        onRangeSelect={(r) => {
                                            if (r) navigate(`/report/salary-range-detail?month=${month}&year=${year}&min_salary=${r.min}&max_salary=${r.max}`);
                                        }}
                                    />
                                </div>
                            )}
                            </PresentSlide>

                            <PresentSlide num="03" id="slide-03" title="Tonase & Cost" subtitle="Produksi TBS dan biaya per ton">
                            {/* COST/TON COMPREHENSIVE PANEL */}
                            <CostPerTonPanel
                                trends={trends}
                                divisionRows={Array.isArray(data?.breakdown) ? data.breakdown : []}
                                title={`Analisis Cost per Ton · ${getScopeLabel(gangScope)}`}
                                loading={loading}
                            />

                            {/* COST OF WAGE - cost upah terhadap semua satuan */}
                            <CostOfWagePanel trends={trends} breakdown={Array.isArray(data?.breakdown) ? data.breakdown : []} />
                            </PresentSlide>

                            <PresentSlide num="04" id="slide-04" title="Divisi & Gang" subtitle="Perbandingan kinerja antar divisi dan gang">
                            {/* Secondary Charts Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem' }}>
                                {/* Division Breakdown - Full Stacked Bar */}
                                <div style={{ ...CARD }}>
                                    <div style={{ ...SECTION_TITLE, marginBottom: 12 }}>Division Cost Breakdown ({divisionChartData.length} divisi) <MetricInfo metricKey="total_upah_kotor" /></div>
                                    <div style={{ display: 'flex', gap: '0.9rem', marginBottom: '0.8rem', fontSize: '0.76rem', color: C.text2 }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <span style={{ width: 12, height: 12, backgroundColor: C.upah, borderRadius: 2 }} />
                                            Gaji Pokok + Tunjangan
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <span style={{ width: 12, height: 12, backgroundColor: C.lembur, borderRadius: 2 }} />
                                            Lembur
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <span style={{ width: 12, height: 12, backgroundColor: C.premi, borderRadius: 2 }} />
                                            Premi
                                        </span>
                                    </div>
                                    <div style={{ height: Math.max(300, divisionChartData.length * 30), minHeight: '200px' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                            <BarChart data={divisionChartData} layout="vertical" margin={{ left: 40, right: 10 }}>
                                                <XAxis type="number" tickFormatter={(val) => `${(val / 1000000).toFixed(0)}jt`} fontSize={10} />
                                                <YAxis dataKey="name" type="category" width={35} fontSize={11} />
                                                <Tooltip
                                                    content={({ active, payload, label }) => {
                                                        if (!active || !payload?.length) return null;
                                                        const d = payload[0]?.payload;
                                                        return (
                                                            <div style={{
                                                                background: C.surface,
                                                                padding: '10px',
                                                                borderRadius: '8px',
                                                                border: `1px solid ${C.border}`,
                                                                boxShadow: SHADOW,
                                                                fontSize: '0.8rem'
                                                            }}>
                                                                <div style={{ fontWeight: '700', marginBottom: '6px', color: C.text }}>{label}</div>
                                                                <div style={{ color: C.muted, marginBottom: '4px' }}>
                                                                    Total: {formatCurrency(d.Total)}
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: C.text2 }}>
                                                                    <span style={{ color: C.upah }}>■</span>
                                                                    Base: {formatCurrency(d.Base)} ({d.basePercent}%)
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: C.text2 }}>
                                                                    <span style={{ color: C.lembur }}>■</span>
                                                                    Lembur: {formatCurrency(d.Overtime)} ({d.otPercent}%)
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: C.text2 }}>
                                                                    <span style={{ color: C.premi }}>■</span>
                                                                    Premi: {formatCurrency(d.Premi)} ({d.premiPercent}%)
                                                                </div>
                                                            </div>
                                                        );
                                                    }}
                                                />
                                                <Bar dataKey="Base" stackId="a" fill={C.upah} barSize={22} cursor="pointer" onClick={handleDivisionBarClick} />
                                                <Bar dataKey="Overtime" stackId="a" fill={C.lembur} barSize={22} cursor="pointer" onClick={handleDivisionBarClick} />
                                                <Bar dataKey="Premi" stackId="a" fill={C.premi} radius={[0, 4, 4, 0]} barSize={22} cursor="pointer" onClick={handleDivisionBarClick}>
                                                    <LabelList dataKey="Total" position="right" formatter={(v) => formatCompactIDR(v)} style={{ fontSize: 10, fill: C.text2, fontWeight: 700 }} />
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                            </div>

                            {/* Gang Performance Charts Section */}
                            <TopBottomPerformersCard
                                data={topBottomData}
                                loading={gangChartsLoading}
                                scope={gangScope}
                            />

                            <div style={{ marginTop: '2rem' }}>
                                <GangComparisonChart
                                    data={gangComparisonData}
                                    loading={gangChartsLoading}
                                    month={month}
                                    year={year}
                                    scope={gangScope}
                                    onGangClick={(data) => {
                                        if (data?.gang_code) {
                                            setSelectedGangCode(data.gang_code);
                                            setDetailModalOpen(true);
                                        }
                                    }}
                                />
                            </div>

                            {/* Gang Trend Comparison - Multi-line chart */}
                            <div style={{ marginTop: '2rem' }}>
                                <GangTrendChart
                                    token={token}
                                    month={month}
                                    year={year}
                                    divisionCode={selectedFilterDivision}
                                    scope={gangScope}
                                />
                            </div>

                            {/* Per-division cost/ton timeline (lazy fetch on view) */}
                            <div ref={divTimelineRef} style={{ marginTop: '2rem' }}>
                                <DivisionTimelineGrid rows={divTrendRows} loading={divTrendLoading} onDrill={(code) => fetchDivisionDetails(code)} />
                            </div>
                            </PresentSlide>

                            <PresentSlide num="05" id="slide-05" title="Efisiensi" subtitle="Efisiensi biaya dan sinyal anomali operasional">
                            {/* EFISIENSI QUADRANT - produktivitas vs cost/ton */}
                            <EfficiencyQuadrant breakdown={Array.isArray(data?.breakdown) ? data.breakdown : []} onDrill={(code) => fetchDivisionDetails(code)} />

                            {/* Phase 2: Productivity & Alerts */}
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', marginTop: '1.5rem', marginBottom: '2rem' }}>
                                {/* Productivity Trend */}
                                <div style={{ ...CARD }}>
                                    <div style={{ ...SECTION_TITLE, marginBottom: 12 }}>Workforce Productivity Trend <MetricInfo metricKey="cost_per_hk" /></div>
                                    <div style={{ height: '350px', minHeight: '200px' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                            <LineChart data={productivityData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="period" angle={-45} textAnchor="end" height={60} interval={0} fontSize={10} />
                                                <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} domain={['auto', 'auto']} />
                                                <Tooltip formatter={(val, name) => [formatCurrency(val), name === 'costPerHk' ? 'Cost/HK' : name]} />
                                                <Legend />
                                                <Line type="monotone" dataKey="costPerHk" stroke={C.costTon} strokeWidth={3} name="Cost/HK" activeDot={{ r: 8 }} />
                                                <Line type="monotone" dataKey="totalHk" stroke={C.muted} strokeWidth={2} name="Total HK" yAxisId="right" hide={true} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Wage Spikes / Alerts */}
                                <div style={{ ...CARD }}>
                                    <div style={{ ...SECTION_TITLE, marginBottom: 12, color: C.potongan, borderLeftColor: C.potongan, display: 'flex', alignItems: 'center', gap: 6 }}>Gang Cost Spikes (Cost/HK) <MetricInfo metricKey="cost_per_hk" /></div>
                                    <div style={{ overflowY: 'auto', maxHeight: '350px' }}>
                                        {!Array.isArray(wageSpikes) || wageSpikes.length === 0 ? (
                                            <div style={{ padding: '2rem', textAlign: 'center', color: C.muted }}>Tidak ada anomali terdeteksi bulan ini.</div>
                                        ) : (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: `2px solid ${C.border}`, textAlign: 'left' }}>
                                                        <th style={{ padding: '0.75rem', color: C.muted }}>Gang</th>
                                                        <th style={{ padding: '0.75rem', color: C.muted, textAlign: 'right' }}>Kenaikan</th>
                                                        <th style={{ padding: '0.75rem', color: C.muted, textAlign: 'right' }}>Cost/HK</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {wageSpikes.map((spike, idx) => (
                                                        <tr key={idx} style={{ borderBottom: `1px solid ${C.surface2}` }}>
                                                            <td style={{ padding: '0.75rem' }}>
                                                                <div style={{ fontWeight: '600', color: C.text }}>{spike.name}</div>
                                                                <div style={{ fontSize: '0.75rem', color: C.muted }}>{spike.id} • {spike.gang}</div>
                                                            </td>
                                                            <td style={{ padding: '0.75rem', textAlign: 'right', color: C.potongan, fontWeight: '700', fontVariantNumeric: 'tabular-nums' }}>
                                                                +{spike.percentage.toFixed(1)}%
                                                            </td>
                                                            <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                                                                {formatCurrency(spike.currentWage)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            </div>

                            </PresentSlide>

                            <PresentSlide num="06" id="slide-06" title="Laporan" subtitle="Akses cepat ke laporan rinci">
                            {/* REPORT HUB FOOTER - semua report */}
                            <ReportHubFooter onNavigate={(to) => navigate(to)} month={month} year={year} />
                            </PresentSlide>

                            {/* Division Details Modal - REMOVED, Replaced by DivisionDetailCard View */}
                            {/* Gang Detail Modal */}
                            <GangDetailModal
                                isOpen={detailModalOpen}
                                onClose={() => setDetailModalOpen(false)}
                                gangCode={selectedGangCode}
                                month={month}
                                year={year}
                                token={token}
                            />
                        </>
                    )}
                    </div>
                </div>
                </div>
            )}
        </>
    );
}
