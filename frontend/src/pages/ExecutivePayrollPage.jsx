
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell, PieChart, Pie, Legend, LineChart, Line, ComposedChart, LabelList
} from 'recharts';
import { Printer } from 'lucide-react';
import LoadingScreen from '../components/common/LoadingScreen';
import PremiCompositionChart from '../components/dashboard/PremiCompositionChart';
import DivisionDetailCard from './DivisionDetailCard';
import KPICard from '../components/dashboard/KPICard';
import GangComparisonChart from '../components/dashboard/GangComparisonChart';
import TopBottomPerformersCard from '../components/dashboard/TopBottomPerformersCard';
import GangCostBreakdownChart from '../components/dashboard/GangCostBreakdownChart';
import GangTrendChart from '../components/dashboard/GangTrendChart';
import GangDetailModal from '../components/dashboard/GangDetailModal';
import CostHKComparisonReport from '../components/CostHKComparisonReport';
import { printReport } from '../utils/printPageSetup';
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

// ===== CEO BOARD VISUAL SYSTEM — SAWIT FINANCE (light, elegan, hijau daun) =====
const C = {
    upah: '#1E7A45', upahAccent: '#3E9E63', premi: '#2E9E6B', lembur: '#D98A1F',
    potongan: '#C8463C', costTon: '#6C4FC4', warn: '#D98A1F', warnBg: '#FBF1DE',
    text: '#12241A', text2: '#46584C', muted: '#7C8B80', border: '#DFE8E0',
    surface: '#FFFFFF', surface2: '#F6FAF5', pageBg: '#EDF3EC', gridLine: '#E4ECE2',
    leafDark: '#14532D', leafMid: '#1E7A45', leafLight: '#4CBB6B', cream: '#F7F9F4'
};
const SHADOW = '0 1px 2px rgba(18,36,26,.05), 0 6px 18px rgba(18,36,26,.08)';
const SHADOW_HOVER = '0 14px 34px rgba(18,36,26,.16)';
const CARD = { background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, padding: 24, boxShadow: SHADOW };
const SECTION_TITLE = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.leafMid, borderLeft: `3px solid ${C.leafMid}`, paddingLeft: 12, marginBottom: 16 };

// Delta badge: invert=true => kenaikan BURUK (cost/ton, lembur)
const DeltaBadge = ({ pct, invert = false }) => {
    const bad = (pct >= 0) === invert;
    const color = bad ? C.potongan : C.premi;
    const bg = bad ? '#FBE9E6' : '#E4F4EB';
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color, background: bg, border: `1px solid ${bad ? '#F0CFC9' : '#C4E6D2'}` }}>
            {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
        </span>
    );
};

// Sparkline mini dari trends
const Spark = ({ data, dataKey, color }) => (
    <ResponsiveContainer width="100%" height={42}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} isAnimationActive={false} />
        </AreaChart>
    </ResponsiveContainer>
);

// Hero KPI card — terminal pro: glow aksen kiri, angka besar tabular
const HeroKpiCard = ({ label, value, pct, invert, sparkData, sparkKey, color, hero, compact, link, onLink }) => {
    const [hover, setHover] = React.useState(false);
    return (
        <div
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            style={{
                ...CARD, padding: '18px 20px', position: 'relative', overflow: 'hidden',
                transform: hover ? 'translateY(-2px)' : 'none', boxShadow: hover ? SHADOW_HOVER : SHADOW,
                transition: 'box-shadow .2s, transform .2s',
                ...(hero ? { border: `1px solid ${color}55`, boxShadow: `${SHADOW}, 0 0 24px ${color}22` } : {})
            }}
        >
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: color, borderRadius: '4px 0 0 4px' }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, marginBottom: 8 }}>{label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: C.text, marginBottom: 8, lineHeight: 1 }}>
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

// Report launcher — navigasi ke report spoke, bawa month/year
const REPORT_LINKS = [
    { key: 'tonase', label: 'Cost per Ton', route: '/tonase-analysis' },
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

// Insight strip: alert wage spikes + tren cost/ton
const InsightStrip = ({ spikes, costChange, onSpikeClick }) => {
    const items = [];
    if (Array.isArray(spikes)) {
        spikes.slice(0, 3).forEach(s => {
            const pct = s.increasePercent ?? s.increase_percent ?? s.percentage ?? s.percent;
            const code = s.gang_code ?? s.gangCode ?? s.id ?? s.name;
            const cause = s.dominant_component ?? s.component;
            items.push({ key: code, text: `${code} Cost/HK naik ${Number(pct || 0).toFixed(1)}%${cause ? ` — ${cause}` : ''}`, ref: code });
        });
    }
    if (costChange !== null && Math.abs(costChange) > 10) {
        items.unshift({ key: 'cost', text: `Cost/Ton ${costChange >= 0 ? 'naik' : 'turun'} ${Math.abs(costChange).toFixed(1)}% vs bulan lalu`, ref: null });
    }
    if (items.length === 0) {
        return (
            <div style={{ padding: '10px 16px', borderRadius: 10, background: '#E4F4EB', border: `1px solid #C4E6D2`, color: C.premi, fontSize: 13, fontWeight: 600 }}>
                ✓ Tidak ada anomali signifikan bulan ini
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {items.map(it => (
                <button key={it.key} onClick={() => it.ref && onSpikeClick && onSpikeClick(it.ref)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, background: C.warnBg, border: `1px solid #EDD9B4`, color: C.lembur, fontSize: 13, fontWeight: 600, cursor: it.ref ? 'pointer' : 'default' }}>
                    ⚠ {it.text}
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

    // Filters — URL query param = single source of truth (shareable + back browser jalan)
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
    const [selectedGangType, setSelectedGangType] = useState('ALL'); // New Filter
    const [selectedFilterGang, setSelectedFilterGang] = useState('ALL');
    const [availableGangs, setAvailableGangs] = useState([]);

    // Gang Comparison Charts State
    const [gangComparisonData, setGangComparisonData] = useState([]);
    const [topBottomData, setTopBottomData] = useState({ top: [], bottom: [] });
    const [gangChartsLoading, setGangChartsLoading] = useState(false);

    // Gang Detail Modal State
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedGangCode, setSelectedGangCode] = useState(null);

    // Load available periods
    useEffect(() => {
        async function loadPeriods() {
            try {
                // Use relative URL for proxy mode compatibility
                const apiUrl = '/backend/upah/payroll/dashboard';
                const res = await fetch(`${apiUrl}/available-periods`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const json = await res.json();
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
                const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';

                // Step 1: Get latest period
                const periodRes = await fetch(`${apiUrl}/payroll/dashboard/latest-period`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const periodJson = await periodRes.json();

                if (periodJson.success) {
                    const { month: latestMonth, year: latestYear } = periodJson.data;

                    // Only switch if we are strictly using defaults (not user provided props)
                    if (!initialMonth && !initialYear) {
                        if (latestYear !== year || latestMonth !== month) {
                            console.log(`Switching to latest data period: ${latestMonth}/${latestYear}`);
                            setMonth(latestMonth);
                            setYear(latestYear);

                            // Step 2: Load filters for the latest period immediately
                            const filterRes = await fetch(`${apiUrl}/payroll/dashboard/filter-options?month=${latestMonth}&year=${latestYear}`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            const filterJson = await filterRes.json();
                            if (filterJson.success) {
                                setFilterOptions(filterJson.data);
                                setAvailableGangs((filterJson.data.gangs || []).sort());
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

    useEffect(() => {
        async function loadDashboard() {
            setLoading(true);
            try {
                const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
                const res = await fetch(`${apiUrl}/payroll/dashboard/executive-summary?month=${month}&year=${year}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const json = await res.json();
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
    }, [token, month, year]);

    // Load Filter Options when period changes (user selection)
    // Use ref to prevent duplicate API calls for same period
    const lastPeriodRef = useRef('');
    useEffect(() => {
        const currentPeriod = `${year}-${month}`;
        // Skip if we already loaded this period
        if (currentPeriod === lastPeriodRef.current) return;

        async function loadFilters() {
            try {
                const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
                // Fetch basic filter options (divisions)
                const res = await fetch(`${apiUrl}/payroll/dashboard/filter-options?month=${month}&year=${year}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const json = await res.json();

                // Fetch Detailed Gang Info for smarter filtering
                const gangRes = await fetch(`${apiUrl}/payroll/dashboard/available-gangs?month=${month}&year=${year}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const gangJson = await gangRes.json();

                if (json.success) {
                    setFilterOptions(prev => {
                        // Only update if data actually changed
                        const newData = {
                            ...json.data,
                            gangDetails: gangJson.success ? gangJson.data : []
                        };
                        // Simple comparison - check if divisions or gang codes changed
                        const divisionsChanged = JSON.stringify(prev.divisions) !== JSON.stringify(json.data.divisions);
                        const gangCodesChanged = JSON.stringify(prev.gangDetails?.map(g => g.gang_code)) !==
                            JSON.stringify(gangJson.data?.map(g => g.gang_code));
                        if (divisionsChanged || gangCodesChanged) {
                            return newData;
                        }
                        return prev;
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

    // Memoize gang details to prevent unnecessary re-renders
    const gangDetails = useMemo(() => filterOptions.gangDetails ?? [], [filterOptions.gangDetails]);

    // Filter gangs when division or gang type changes
    useEffect(() => {
        let gangs = gangDetails;

        // 1. Division Filter
        if (selectedFilterDivision !== 'ALL') {
            gangs = gangs.filter(g => g.division_code === selectedFilterDivision || g.gang_code.startsWith(selectedFilterDivision));
        }

        // 2. Gang Type Filter
        if (selectedGangType !== 'ALL') {
            if (selectedGangType === 'PANEN_L') {
                // Special case: Gang Panen (Forecast/L-Series) - Starts with 'L' or Suffix 'H'
                // User request: "IJL gang dengan awalan kode L" and "Gang Panen".
                // Let's filter by 'L' prefix OR 'H' suffix to be inclusive for 'Panen' unless distinct.
                gangs = gangs.filter(g => g.gang_code.startsWith('L') || g.gang_code.endsWith('H'));
            } else if (selectedGangType === 'IJL') {
                gangs = gangs.filter(g => g.is_ijl || g.gang_code.startsWith('L'));
            } else if (selectedGangType === 'NON_IJL') {
                gangs = gangs.filter(g => !g.is_ijl && !g.gang_code.startsWith('L'));
            } else {
                gangs = gangs.filter(g => g.gang_type === selectedGangType);
            }
        }

        // Extract Codes & Sort
        const gangCodes = gangs.map(g => g.gang_code).sort((a, b) => a.localeCompare(b));
        setAvailableGangs(gangCodes.length > 0 ? gangCodes : []);

        // Reset gang selection if not in list
        if (selectedFilterGang !== 'ALL' && !gangCodes.includes(selectedFilterGang)) {
            setSelectedFilterGang('ALL');
        }
    }, [selectedFilterDivision, selectedGangType, gangDetails]);

    const handleCompare = async () => {
        if (selectedItems.length === 0) return;
        setCompLoading(true);
        try {
            const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
            const res = await fetch(`${apiUrl}/payroll/dashboard/comparison`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: compMode,
                    codes: selectedItems,
                    month,
                    year
                })
            });
            const json = await res.json();
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
            const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
            const headers = { 'Authorization': `Bearer ${token}` };

            // Parallel Fetching
            const [gangRes, premiRes, otRes, detailRes] = await Promise.all([
                fetch(`${apiUrl}/payroll/dashboard/aggregated-gang-data?month=${month}&year=${year}&division_code=${divisionCode}`, { headers }),
                fetch(`${apiUrl}/payroll/dashboard/premi-analysis?month=${month}&year=${year}&division_code=${divisionCode}`, { headers }),
                fetch(`${apiUrl}/payroll/dashboard/overtime-analysis?month=${month}&year=${year}&division_code=${divisionCode}`, { headers }),
                fetch(`${apiUrl}/payroll/dashboard/division-detail-data?month=${month}&year=${year}&division_code=${divisionCode}`, { headers })
            ]);

            const gangData = await gangRes.json();
            const premiData = await premiRes.json();
            const otData = await otRes.json();
            const detailData = await detailRes.json();

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
                const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';
                const divParam = selectedFilterDivision !== 'ALL' ? `&division_code=${selectedFilterDivision}` : '';

                // Fetch gang comparison
                const compRes = await fetch(`${apiUrl}/payroll/dashboard/gang-comparison?month=${month}&year=${year}${divParam}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const compJson = await compRes.json();
                if (compJson.success) {
                    setGangComparisonData(compJson.data);
                }

                // Fetch top/bottom performers
                const topBottomRes = await fetch(`${apiUrl}/payroll/dashboard/top-bottom-gangs?month=${month}&year=${year}${divParam}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const topBottomJson = await topBottomRes.json();
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
    }, [token, month, year, selectedFilterDivision]);

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

    const gangChartData = useMemo(() => {
        if (!data || !data.gangBreakdown) return [];
        return data.gangBreakdown.map(g => ({
            name: g.gang_code,
            Wage: g.total_wage,
            Overtime: g.total_ot
        }));
    }, [data?.gangBreakdown]);

    // Overtime Distribution Chart Data
    const overtimeChartData = useMemo(() => {
        if (!data || !data.breakdown) return [];
        const baseData = data.breakdown;
        const totalOT = baseData.reduce((sum, d) => sum + (d.total_ot || 0), 0);
        return baseData
            .filter(d => d.total_ot > 0)
            .sort((a, b) => b.total_ot - a.total_ot)
            .map(d => ({
                name: d.division_code,
                Overtime: d.total_ot || 0,
                percent: totalOT > 0 ? ((d.total_ot / totalOT) * 100).toFixed(1) : 0
            }));
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

    const efficiencyData = useMemo(() => {
        if (!data || !data.efficiency) return [];
        return data.efficiency.map(d => ({
            name: d.division_code,
            costPerHead: d.headcount > 0 ? d.total_cost / d.headcount : 0,
            headcount: d.headcount,
            totalCost: d.total_cost
        })).sort((a, b) => b.costPerHead - a.costPerHead).slice(0, 15); // Top 15 by cost per head
    }, [data?.efficiency]);

    const productivityData = useMemo(() => {
        if (!data || !data.productivityTrend) return [];
        return data.productivityTrend;
    }, [data?.productivityTrend]);

    const wageSpikes = useMemo(() => {
        if (!data || !data.wageSpikes) return [];
        return data.wageSpikes;
    }, [data?.wageSpikes]);

    const costComposition = useMemo(() => {
        if (!data || !data.kpi) return [];
        const wage = data.kpi.curr_wage || 0;
        const ot = data.kpi.curr_ot || 0;

        return [
            { name: 'Overtime', value: ot, color: C.lembur },
            { name: 'Regular Pay & Premi', value: Math.max(0, wage - ot), color: C.upah }
        ];
    }, [data?.kpi]);

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
        selectedGangType === 'ALL' ? 'Semua Tipe Gang' : selectedGangType,
        selectedFilterGang === 'ALL' ? 'Semua Gang' : `Gang ${selectedFilterGang}`
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
                <div className="executive-payroll-page" style={{ background: C.pageBg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
                    {/* HERO HEADER — gradasi sawit + motif daun */}
                    <div className="executive-page-header no-print" style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(115deg, ${C.leafDark} 0%, ${C.leafMid} 55%, ${C.leafLight} 100%)`, padding: '2rem 2.5rem 4.6rem', color: '#fff', marginBottom: 0 }}>
                        {/* motif daun */}
                        <svg style={{ position: 'absolute', right: -20, top: -30, opacity: 0.14 }} width="340" height="340" viewBox="0 0 100 100" fill="none"><path d="M50 0 C60 25 75 40 100 50 C75 60 60 75 50 100 C40 75 25 60 0 50 C25 40 40 25 50 0 Z" fill="#fff"/></svg>
                        <svg style={{ position: 'absolute', right: 130, bottom: -50, opacity: 0.10 }} width="220" height="220" viewBox="0 0 100 100" fill="none"><path d="M50 0 C60 25 75 40 100 50 C75 60 60 75 50 100 C40 75 25 60 0 50 C25 40 40 25 50 0 Z" fill="#fff"/></svg>
                        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 6 }}>Perkebunan Sawit · Executive</div>
                                <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#fff', margin: 0, letterSpacing: '-0.02em' }}>Daftar Upah Analysis</h1>
                                <p style={{ color: 'rgba(255,255,255,0.85)', marginTop: '0.4rem', fontSize: '0.92rem' }}>Kinerja biaya panen · upah kotor · cost per ton — {reportPeriodLabel}</p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {/* Cost/HK Report Button */}
                            <button
                                onClick={() => setShowCostHKReport(!showCostHKReport)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    background: showCostHKReport ? '#0f172a' : 'white',
                                    color: showCostHKReport ? 'white' : '#334155',
                                    borderRadius: '8px',
                                    border: '1px solid #e2e8f0',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    outline: 'none',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                    minWidth: '140px'
                                }}
                            >
                                {showCostHKReport ? '← Kembali ke Dashboard' : '📊 Laporan Cost/HK'}
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
                                            background: '#111827',
                                            color: 'white',
                                            borderRadius: '8px',
                                            border: '1px solid #111827',
                                            fontWeight: '700',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
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
                                                color: '#111827',
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
                                            background: 'white',
                                            borderRadius: '8px',
                                            border: '1px solid #e2e8f0',
                                            fontWeight: '600',
                                            color: '#334155',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                            minWidth: '120px'
                                        }}
                                    >
                                        <option value="ALL">Semua Divisi</option>
                                        {(Array.isArray(filterOptions.divisions) ? filterOptions.divisions : []).map((div, idx) => (
                                            <option key={idx} value={div}>{div}</option>
                                        ))}
                                    </select>

                                    {/* Gang Type Filter */}
                                    <select
                                        value={selectedGangType}
                                        onChange={(e) => setSelectedGangType(e.target.value)}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            background: 'white',
                                            borderRadius: '8px',
                                            border: '1px solid #e2e8f0',
                                            fontWeight: '600',
                                            color: '#334155',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                            minWidth: '130px'
                                        }}
                                    >
                                        <option value="ALL">Semua Tipe</option>
                                        <option value="PANEN_L">Panen (Prefix L)</option>
                                        <option value="harvesting">Panen (Suffix H)</option>
                                        <option value="transport">Transport</option>
                                        <option value="IJL">IJL Only</option>
                                        <option value="NON_IJL">Non-IJL</option>
                                    </select>

                                    {/* Gang Filter */}
                                    <select
                                        value={selectedFilterGang}
                                        onChange={(e) => setSelectedFilterGang(e.target.value)}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            background: 'white',
                                            borderRadius: '8px',
                                            border: '1px solid #e2e8f0',
                                            fontWeight: '600',
                                            color: '#334155',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                            minWidth: '120px'
                                        }}
                                    >
                                        <option value="ALL">Semua Gang</option>
                                        {availableGangs.map((gang, idx) => (
                                            <option key={idx} value={gang}>{gang}</option>
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
                                            background: 'white',
                                            borderRadius: '8px',
                                            border: '1px solid #e2e8f0',
                                            fontWeight: '600',
                                            color: '#334155',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
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
                            </div>
                        </div>
                    </div>

                    {/* CONTENT WRAPPER — overlap hero */}
                    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 2.5rem 3rem', marginTop: '-3rem', position: 'relative' }}>

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

                            {/* HERO KPI ROW */}
                            {kpi && (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <div style={SECTION_TITLE}>Kinerja Utama — Gang Panen (Upah Kotor)</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 20 }}>
                                        <HeroKpiCard label="Total Upah Kotor" value={kpi.curr_wage} pct={wageChange} invert sparkData={sparkTrends} sparkKey="total_wage" color={C.upah} compact link={`/summary?month=${month}&year=${year}`} onLink={navigate} />
                                        <HeroKpiCard label="Cost / Ton" value={costPerTon !== null ? costPerTon : null} pct={costPerTonChange} invert sparkData={sparkTrends} sparkKey="cost_per_ton" color={C.costTon} hero compact link={`/tonase-analysis?month=${month}&year=${year}`} onLink={navigate} />
                                        <HeroKpiCard label="Tonase" value={`${formatNumber(currentTrend.total_tonase || 0)} t`} pct={tonaseChange} sparkData={sparkTrends} sparkKey="total_tonase" color={C.premi} link={`/tonase-analysis?month=${month}&year=${year}`} onLink={navigate} />
                                        <HeroKpiCard label="Headcount Panen" value={formatNumber(kpi.curr_headcount)} pct={headChange} sparkData={sparkTrends} sparkKey="total_headcount" color={C.upahAccent} link={`/wages-rebinmas?month=${month}&year=${year}`} onLink={navigate} />
                                        <HeroKpiCard label="Premi Share" value={`${premiShare.toFixed(1)}%`} pct={premiShareChange} invert sparkData={premiShareSpark} sparkKey="premiShareVal" color={C.lembur} link={`/productivity?month=${month}&year=${year}`} onLink={navigate} />
                                    </div>
                                </div>
                            )}

                            {/* INSIGHT STRIP */}
                            <div style={{ marginBottom: '1.5rem' }}>
                                <InsightStrip spikes={wageSpikes} costChange={costPerTonChange} onSpikeClick={(code) => fetchDivisionDetails(code)} />
                            </div>

                            {/* Main Trend Chart */}
                            <div style={{ ...CARD, marginBottom: '1.5rem' }}>
                                <div style={SECTION_TITLE}>Tren 12 Bulan — Upah Kotor &amp; Cost/Ton</div>
                                <div style={{ height: '380px', width: '100%', minHeight: '200px' }}>
                                    <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                        <ComposedChart data={trends} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.border} />
                                            <XAxis dataKey="period" tick={{ fontSize: 11, fill: C.muted }} />
                                            <YAxis yAxisId="left" tickFormatter={(val) => `${(val / 1000000).toFixed(0)}jt`} tick={{ fontSize: 11, fill: C.muted }} />
                                            <YAxis yAxisId="right" orientation="right" tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: C.costTon }} />
                                            <Tooltip
                                                formatter={(val, name) => [formatCurrency(val), name]}
                                                contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: SHADOW_HOVER, fontSize: 13 }}
                                                labelStyle={{ fontWeight: 700, color: C.text }}
                                            />
                                            <Legend />
                                            <Bar yAxisId="left" dataKey="total_wage" name="Upah Kotor" fill={C.upah} radius={[4, 4, 0, 0]} barSize={26} />
                                            <Line yAxisId="right" type="monotone" dataKey="cost_per_ton" name="Cost/Ton" stroke={C.costTon} strokeWidth={2.5} dot={{ r: 3 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Interactive Comparison Widget */}
                            <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', marginBottom: '2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', margin: 0 }}>Interactive Comparison</h3>

                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        {/* Mode Toggle */}
                                        <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
                                            <button
                                                onClick={() => { setCompMode('division'); setSelectedItems([]); setCompData(null); }}
                                                style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: compMode === 'division' ? 'white' : 'transparent', boxShadow: compMode === 'division' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none', fontWeight: '600', color: compMode === 'division' ? '#0f172a' : '#64748b', cursor: 'pointer' }}
                                            >
                                                Division
                                            </button>
                                            <button
                                                onClick={() => { setCompMode('gang'); setSelectedItems([]); setCompData(null); }}
                                                style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: compMode === 'gang' ? 'white' : 'transparent', boxShadow: compMode === 'gang' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none', fontWeight: '600', color: compMode === 'gang' ? '#0f172a' : '#64748b', cursor: 'pointer' }}
                                            >
                                                Gang
                                            </button>
                                        </div>

                                        {/* Multi-Select */}
                                        <select
                                            multiple
                                            value={selectedItems}
                                            onChange={(e) => {
                                                const options = [...e.target.selectedOptions];
                                                const values = options.map(o => o.value);
                                                setSelectedItems(values);
                                            }}
                                            style={{ padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: '8px', minWidth: '200px', height: '40px' }}
                                        >
                                            {(compMode === 'division' 
                                                ? (Array.isArray(filterOptions.divisions) ? filterOptions.divisions : []) 
                                                : (Array.isArray(filterOptions.gangs) ? filterOptions.gangs : [])
                                            ).map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>

                                        <button
                                            onClick={handleCompare}
                                            disabled={compLoading || selectedItems.length === 0}
                                            style={{ backgroundColor: '#3b82f6', color: 'white', border: 'none', padding: '0.5rem 1.5rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', opacity: (compLoading || selectedItems.length === 0) ? 0.7 : 1 }}
                                        >
                                            {compLoading ? 'Loading...' : 'Compare'}
                                        </button>
                                    </div>
                                </div>

                                {/* Comparison Charts */}
                                {compData && Array.isArray(compData) && compData.length > 0 && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                                        <div style={{ height: '300px', minHeight: '200px' }}>
                                            <h4 style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem', textAlign: 'center' }}>Total Wage</h4>
                                            <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                                <BarChart data={compData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="name" fontSize={10} interval={0} angle={-45} textAnchor="end" height={60} />
                                                    <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`} />
                                                    <Tooltip formatter={(val) => formatCurrency(val)} />
                                                    <Bar dataKey="total_wage" fill="#3b82f6" name="Wage" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div style={{ height: '300px', minHeight: '200px' }}>
                                            <h4 style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem', textAlign: 'center' }}>Overtime</h4>
                                            <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                                <BarChart data={compData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="name" fontSize={10} interval={0} angle={-45} textAnchor="end" height={60} />
                                                    <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`} />
                                                    <Tooltip formatter={(val) => formatCurrency(val)} />
                                                    <Bar dataKey="total_ot" fill="#f59e0b" name="Overtime" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div style={{ height: '300px', minHeight: '200px' }}>
                                            <h4 style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem', textAlign: 'center' }}>Productivity (Cost/HK)</h4>
                                            <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                                <BarChart data={compData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="name" fontSize={10} interval={0} angle={-45} textAnchor="end" height={60} />
                                                    <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                                                    <Tooltip formatter={(val) => formatCurrency(val)} />
                                                    <Bar dataKey="cost_per_hk" fill="#10b981" name="Cost/HK" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                                {!compData && !compLoading && (
                                    <div style={{ textAlign: 'center', color: '#cbd5e1', padding: '3rem' }}>
                                        Select items and click Compare to see specific metrics
                                    </div>
                                )}
                            </div>

                            {/* Secondary Charts Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
                                {/* Division Breakdown - Full Stacked Bar */}
                                <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '0.5rem' }}>
                                        Division Cost Breakdown ({divisionChartData.length} divisions)
                                    </h3>
                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.75rem' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ width: '12px', height: '12px', backgroundColor: '#3b82f6', borderRadius: '2px' }}></span>
                                            Gaji Pokok + Tunjangan
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ width: '12px', height: '12px', backgroundColor: '#f97316', borderRadius: '2px' }}></span>
                                            Lembur
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ width: '12px', height: '12px', backgroundColor: '#10b981', borderRadius: '2px' }}></span>
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
                                                                background: 'white',
                                                                padding: '10px',
                                                                borderRadius: '8px',
                                                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                                                fontSize: '0.8rem'
                                                            }}>
                                                                <div style={{ fontWeight: '700', marginBottom: '6px' }}>{label}</div>
                                                                <div style={{ color: '#64748b', marginBottom: '4px' }}>
                                                                    Total: {formatCurrency(d.Total)}
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                    <span style={{ color: '#3b82f6' }}>■</span>
                                                                    Base: {formatCurrency(d.Base)} ({d.basePercent}%)
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                    <span style={{ color: '#f97316' }}>■</span>
                                                                    Lembur: {formatCurrency(d.Overtime)} ({d.otPercent}%)
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                    <span style={{ color: '#10b981' }}>■</span>
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

                                {/* Cost Composition Donut */}
                                <div style={CARD}>
                                    <div style={SECTION_TITLE}>Komposisi Biaya</div>
                                    <div style={{ height: '300px', position: 'relative', minHeight: '200px' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                            <PieChart>
                                                <Pie
                                                    data={Array.isArray(costComposition) ? costComposition : []}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={70}
                                                    outerRadius={100}
                                                    paddingAngle={3}
                                                    dataKey="value"
                                                >
                                                    {Array.isArray(costComposition) && costComposition.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip formatter={(val) => formatCurrency(val)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: SHADOW_HOVER }} />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div style={{ position: 'absolute', top: '44%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.muted }}>Total</div>
                                            <div style={{ fontSize: 20, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{formatCompactIDR(kpi?.curr_wage || 0)}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Premi Analysis - Full Width Row */}
                            <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', marginTop: '2rem' }}>
                                <PremiCompositionChart month={month} year={year} division="ALL" />
                            </div>

                            {/* Overtime Distribution - Full Width Row */}
                            <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', marginTop: '2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', margin: 0 }}>
                                        ⏰ Distribusi Lembur per Divisi ({overtimeChartData.length} divisions)
                                    </h3>
                                    <div style={{
                                        backgroundColor: '#fff7ed',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        fontSize: '0.9rem',
                                        fontWeight: '600',
                                        color: '#ea580c'
                                    }}>
                                        Total: {formatCurrency(Array.isArray(overtimeChartData) ? overtimeChartData.reduce((sum, d) => sum + (d.Overtime || 0), 0) : 0)}
                                    </div>
                                </div>
                                {Array.isArray(overtimeChartData) && overtimeChartData.length > 0 ? (
                                    <div style={{ height: Math.max(300, overtimeChartData.length * 32), minHeight: '200px' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                            <BarChart data={overtimeChartData} layout="vertical" margin={{ left: 40, right: 80 }}>
                                                <XAxis type="number" tickFormatter={(val) => `${(val / 1000000).toFixed(0)} jt`} fontSize={10} />
                                                <YAxis dataKey="name" type="category" width={35} fontSize={11} />
                                                <Tooltip
                                                    content={({ active, payload, label }) => {
                                                        if (!active || !payload?.length) return null;
                                                        const d = payload[0]?.payload;
                                                        return (
                                                            <div style={{
                                                                background: 'white',
                                                                padding: '10px',
                                                                borderRadius: '8px',
                                                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                                                fontSize: '0.85rem'
                                                            }}>
                                                                <div style={{ fontWeight: '700', marginBottom: '4px' }}>Divisi: {label}</div>
                                                                <div style={{ color: '#ea580c' }}>
                                                                    Lembur: {formatCurrency(d?.Overtime || 0)} ({d?.percent || 0}%)
                                                                </div>
                                                            </div>
                                                        );
                                                    }}
                                                />
                                                <Bar
                                                    dataKey="Overtime"
                                                    fill="#f97316"
                                                    radius={[0, 4, 4, 0]}
                                                    barSize={24}
                                                    label={({ x, y, width, height, value, payload }) => {
                                                        if (!payload) return null;
                                                        return (
                                                            <text
                                                                x={x + width + 5}
                                                                y={y + height / 2}
                                                                fill="#64748b"
                                                                fontSize={10}
                                                                dominantBaseline="middle"
                                                            >
                                                                {formatCurrency(value)} ({payload.percent || 0}%)
                                                            </text>
                                                        );
                                                    }}
                                                />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                                        No overtime data available for this period
                                    </div>
                                )}
                            </div>

                            {/* Advanced Analysis Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem', marginTop: '2rem' }}>
                                {/* Gang Comparison */}
                                <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1.5rem' }}>Top 15 Gangs by Cost</h3>
                                    <div style={{ height: '350px', minHeight: '200px' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                            <BarChart data={gangChartData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" angle={-45} textAnchor="end" height={60} interval={0} fontSize={10} />
                                                <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`} />
                                                <Tooltip formatter={(val) => formatCurrency(val)} />
                                                <Legend />
                                                <Bar dataKey="Wage" stackId="a" fill="#3b82f6" name="Total Wages" />
                                                <Bar dataKey="Overtime" stackId="a" fill="#f59e0b" name="Overtime" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Division Efficiency */}
                                <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1.5rem' }}>Cost Efficiency (Avg Cost per Employee)</h3>
                                    <div style={{ height: '350px', minHeight: '200px' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                            <BarChart data={efficiencyData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" angle={-45} textAnchor="end" height={60} interval={0} fontSize={10} />
                                                <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(1)}jt`} />
                                                <Tooltip formatter={(val, name) => [formatCurrency(val), name === 'costPerHead' ? 'Avg Cost/Head' : name]} />
                                                <Bar dataKey="costPerHead" fill="#10b981" name="Avg Cost per Employee" onClick={(data) => console.log(data)} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {/* Gang Performance Charts Section */}
                            <TopBottomPerformersCard
                                data={topBottomData}
                                loading={gangChartsLoading}
                            />

                            <div style={{ marginTop: '2rem' }}>
                                <GangComparisonChart
                                    data={gangComparisonData}
                                    loading={gangChartsLoading}
                                    month={month}
                                    year={year}
                                    onGangClick={(data) => {
                                        if (data?.gang_code) {
                                            setSelectedGangCode(data.gang_code);
                                            setDetailModalOpen(true);
                                        }
                                    }}
                                />
                            </div>

                            {/* Gang Cost Breakdown - Shows composition of costs */}
                            <div style={{ marginTop: '2rem' }}>
                                <GangCostBreakdownChart
                                    data={gangComparisonData}
                                    loading={gangChartsLoading}
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
                                />
                            </div>

                            {/* Phase 2: Productivity & Alerts */}
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginTop: '2rem', marginBottom: '3rem' }}>
                                {/* Productivity Trend */}
                                <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1.5rem' }}>Workforce Productivity Trend (Avg Cost / Man-Day)</h3>
                                    <div style={{ height: '350px', minHeight: '200px' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                                            <LineChart data={productivityData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="period" angle={-45} textAnchor="end" height={60} interval={0} fontSize={10} />
                                                <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} domain={['auto', 'auto']} />
                                                <Tooltip formatter={(val, name) => [formatCurrency(val), name === 'costPerHk' ? 'Cost/HK' : name]} />
                                                <Legend />
                                                <Line type="monotone" dataKey="costPerHk" stroke="#8b5cf6" strokeWidth={3} name="Cost/HK" activeDot={{ r: 8 }} />
                                                <Line type="monotone" dataKey="totalHk" stroke="#cbd5e1" strokeWidth={2} name="Total HK" yAxisId="right" hide={true} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Wage Spikes / Alerts */}
                                <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#ef4444', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ backgroundColor: '#fee2e2', padding: '4px 8px', borderRadius: '6px' }}>⚠️ Gang Cost Spikes (Cost/HK)</span>
                                    </h3>
                                    <div style={{ overflowY: 'auto', maxHeight: '350px' }}>
                                        {!Array.isArray(wageSpikes) || wageSpikes.length === 0 ? (
                                            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No anomalies detected this month.</div>
                                        ) : (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '2px solid #f1f5f9', textAlign: 'left' }}>
                                                        <th style={{ padding: '0.75rem', color: '#64748b' }}>Gang</th>
                                                        <th style={{ padding: '0.75rem', color: '#64748b', textAlign: 'right' }}>Increase</th>
                                                        <th style={{ padding: '0.75rem', color: '#64748b', textAlign: 'right' }}>Cost/HK</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {wageSpikes.map((spike, idx) => (
                                                        <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                                                            <td style={{ padding: '0.75rem' }}>
                                                                <div style={{ fontWeight: '600', color: '#334155' }}>{spike.name}</div>
                                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{spike.id} • {spike.gang}</div>
                                                            </td>
                                                            <td style={{ padding: '0.75rem', textAlign: 'right', color: '#ef4444', fontWeight: '700' }}>
                                                                +{spike.percentage.toFixed(1)}%
                                                            </td>
                                                            <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600' }}>
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
