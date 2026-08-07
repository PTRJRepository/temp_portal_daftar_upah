/* Hallmark · component: salary-analysis-page · theme: estate-ledger
 * Per-employee salary drill: division+gang+month → employee roster → click row → full component drawer.
 * Data: GET /payroll/dashboard/wage-distribution (history snapshot, ~200ms) with live
 * /payroll/report/division-raw-tree fallback when snapshot not yet seeded for the period.
 *
 * Fix divisi: semua perubahan filter pakai SATU panggilan setSearchParams lewat
 * buildAnalysisSearchParams (dua panggilan terpisah dari searchParams stale saling menimpa).
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Search, X, RotateCcw, Printer } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, ComposedChart, Line, ScatterChart, Scatter, ZAxis } from 'recharts';
import { ReportHero, ReportBody, StatCard, EmptyState, C, CARD, SHADOW, SHADOW_HOVER, chartPalette, MetricInfo, Breadcrumb } from '../components/report/reportTheme';
import { buildAnalysisSearchParams } from '../utils/salaryAnalysisParams';
import { printReport, usePrintExpand } from '../utils/printPageSetup';
import { PresentSlide } from '../components/present/PresentSlide';
import { PresentController } from '../components/present/PresentController';
import { usePresentMode } from '../components/present/usePresentMode';

// normalize snapshot rows (flat from wage-distribution) → same shape as division-raw-tree employee rows
const normSnapRow = (r) => ({
    ...r,
    nama: r.emp_name || r.nama || '',
    upah_kotor: num(r.upah_kotor) || num(r.jumlah_upah_kotor),
    jumlah_upah_kotor: num(r.jumlah_upah_kotor) || num(r.upah_kotor),
    hari_kerja: num(r.hari_kerja) || num(r.jumlah_hk) || 0,
    kehadiran: num(r.hari_kerja) || num(r.jumlah_hk) || 0,
    gang_code: (r.gang_code || '').trim(),
    division_code: (r.division_code || '').trim(),
});
const normLiveRow = (e, gangCode, div) => ({
    ...e,
    nama: e.nama || e.emp_name || '',
    gang_code: e.gang_code || gangCode || '',
    division_code: div || e.division_code || '',
});
const fmtIDR = (v) => (v == null || isNaN(v) ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v));
const fmtCompact = (v) => {
    if (v == null || isNaN(v)) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
    if (Math.abs(n) >= 1e3) return `Rp ${(n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};
const fmtNum = (v, d = 0) => (v == null || isNaN(v) ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }));
const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };
// Fixed-step salary bands (default 1jt) from 0 → ceil(max/step)*step. More bands = more detail.
const fixedBands = (vals, step = 1_000_000) => {
    const pos = vals.filter(v => v > 0);
    if (pos.length === 0) return [];
    const max = Math.max(...pos);
    const end = Math.ceil(max / step) * step;
    const bands = [];
    for (let lo = 0; lo < end; lo += step) bands.push({ label: `${fmtShort(lo)}–${fmtShort(lo + step)}`, min: lo, max: lo + step });
    return bands;
};
// Round raw band step to a "nice" value (100k/250k/500k/1jt) for readable edges
const niceStep = (raw) => {
    if (raw <= 0) return 500_000;
    const candidates = [100_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000];
    return candidates.find(c => c >= raw) || Math.pow(10, Math.ceil(Math.log10(raw)));
};
// Short label for salary edges: 3_000_000 -> "3jt", 2_500_000 -> "2.5jt"
const fmtShort = (v) => {
    if (v >= 1_000_000) { const m = v / 1_000_000; return (Number.isInteger(m) ? m.toString() : m.toFixed(1).replace(/\.0$/, '')) + 'jt'; }
    if (v >= 1_000) return `${Math.round(v / 1000)}rb`;
    return String(v);
};

// Drawer component groups - mirrors PayrollCalculator formula flow
const GROUPS = [
    { title: 'Identitas', fields: [
        ['emp_code', 'Kode PTRJ'], ['nama', 'Nama'], ['nik', 'NIK'], ['jabatan_estate', 'Jabatan'],
        ['join_date', 'Tanggal Masuk'], ['kategori_ter', 'Kategori Pajak'], ['status_ptkp', 'Status PTKP'], ['gang_code', 'Gang'],
    ]},
    { title: 'Gaji & Tunjangan', fields: [
        ['gaji_pokok', 'Gaji Pokok'], ['gaji_pokok_aktual', 'Gaji Pokok Aktual'], ['kehadiran', 'Kehadiran'],
        ['beras_jumlah', 'Tunjangan Beras'], ['jabatan_jumlah', 'Tunjangan Jabatan'], ['masa_kerja_jumlah', 'Tunjangan Masa Kerja'],
        ['total_tunjangan', 'Total Tunjangan'],
    ]},
    { title: 'Premi', fields: [
        ['premi_brondol_total', 'Premi Brondol'], ['total_premi', 'Total Premi'], ['premi_details', 'Rincian Premi'],
    ]},
    { title: 'Lembur', fields: [
        ['lembur_jam', 'Jam Lembur'], ['lembur_rate', 'Rate Lembur'], ['lembur_jumlah', 'Upah Lembur'],
    ]},
    { title: 'Potongan', fields: [
        ['pot_astek_pekerja', 'Astek Pekerja'], ['pot_bpjs_kesehatan_pekerja', 'BPJS Kesehatan'],
        ['pot_bpjs_pensiun_pekerja', 'BPJS Pensiun'], ['pot_spsi', 'SPSI'], ['pot_pph21', 'PPh21'],
        ['pot_koreksi', 'Koreksi'], ['total_potongan', 'Total Potongan'],
    ]},
    { title: 'Pendapatan Lainnya', fields: [
        ['pendapatan_thr', 'THR'], ['pendapatan_bonus', 'Bonus'], ['pendapatan_custom', 'Lainnya'],
        ['total_pendapatan_lainnya', 'Total Pendapatan Lainnya'],
    ]},
    { title: 'Hasil Upah', fields: [
        ['upah_kotor', 'Upah Kotor'], ['jumlah_upah_kotor', 'Jumlah Upah Kotor'],
        ['total_potongan', 'Total Potongan'], ['upah_bersih', 'Upah Bersih'],
    ]},
];

const COLUMNS = [
    { key: 'emp_code', label: 'Kode', sort: 'str' },
    { key: 'nama', label: 'Nama', sort: 'str' },
    { key: 'gang_code', label: 'Gang', sort: 'str' },
    { key: 'gaji_pokok', label: 'Gaji Pokok', sort: 'num', fmt: fmtCompact, align: 'right' },
    { key: 'lembur_jumlah', label: 'Lembur', sort: 'num', fmt: fmtCompact, align: 'right' },
    { key: 'total_premi', label: 'Premi', sort: 'num', fmt: fmtCompact, align: 'right' },
    { key: 'total_potongan', label: 'Potongan', sort: 'num', fmt: fmtCompact, align: 'right' },
    { key: 'upah_kotor', label: 'Upah Kotor', sort: 'num', fmt: fmtCompact, align: 'right' },
];

export default function SalaryAnalysisPage() {
    const { token } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const division = searchParams.get('division_code') || '';
    const gang = searchParams.get('gang_code') || '';
    // default month/year: latest available period (NOT new Date()) - e.g. data terakhir adalah bulan 7
    const [defaultPeriod, setDefaultPeriod] = useState(null);
    const urlMonth = parseInt(searchParams.get('month'));
    const urlYear = parseInt(searchParams.get('year'));
    const month = urlMonth || defaultPeriod?.month || new Date().getMonth() + 1;
    const year = urlYear || defaultPeriod?.year || new Date().getFullYear();

    const [divisions, setDivisions] = useState([]);
    const [gangs, setGangs] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState('upah_kotor');
    const [sortDir, setSortDir] = useState('desc');
    const [selected, setSelected] = useState(null);
    const [bandFilter, setBandFilter] = useState(null); // salary band label, null = all
    // global view (before division pick) - cross-division salary histogram
    const [globalRoster, setGlobalRoster] = useState([]);
    const [globalLoading, setGlobalLoading] = useState(false);
    const [globalBand, setGlobalBand] = useState(null); // clicked global band, filters cards
    const [typeFilter, setTypeFilter] = useState(null); // clicked work-type card, filters roster
    const [compoSlice, setCompoSlice] = useState(null); // clicked composition slice (component name)
    const [divFilter, setDivFilter] = useState(null); // clicked division bar (ranking/stacked), filters roster
    const [tonaseMap, setTonaseMap] = useState({}); // division_code -> tonase (ton) from wage-distribution response

    // present mode deck (fullscreen scroll-snap)
    const { presenting, activeIndex, enter, exit } = usePresentMode();
    // During print: roster difilter-klik (band/type/komponen/divisi) diabaikan → semua karyawan tercetak; drawer jadi inline.
    const printExpanded = usePrintExpand();

    const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}`, 'X-API-Key': localStorage.getItem('api_key') || '' }), [token]);

    // single atomic URL update - all filter changes go through here (fix ganti divisi)
    const applyParams = useCallback((overrides) => {
        setSearchParams(buildAnalysisSearchParams(searchParams, overrides));
    }, [searchParams, setSearchParams]);

    // Fetch latest available period → default month/year (data terakhir, bukan new Date()).
    // HANYA diterapkan bila URL belum menyebut month/year DAN belum ada roster yang tampil.
    // Setelah roster termuat, periode tidak boleh diganti diam-diam — itu membuat konten
    // yang sudah muncul tiba-tiba hilang (periode baru kosong). Ganti periode lewat dropdown.
    useEffect(() => {
        if (defaultPeriod) return;
        (async () => {
            try {
                const r = await axios.get('/payroll/dashboard/latest-period', { headers: authHeaders });
                if (r.data?.data) {
                    setDefaultPeriod(prev => {
                        if (urlMonth || urlYear) return prev;                 // URL menang
                        if (employees.length > 0 || globalRoster.length > 0) return prev; // jangan ganti saat data tampil
                        return r.data.data;
                    });
                }
            } catch { /* ignore */ }
        })();
    }, [authHeaders, defaultPeriod, urlMonth, urlYear, employees.length, globalRoster.length]);

    // GLOBAL load on mount - snapshot first (fast, ~200ms), live-fill divisions missing from snapshot
    const PRODUCING = ['ARC','DME','ARA','AB1','P1A','P2A','P2B','AB2','P1B','IJL'];
    useEffect(() => {
        if (division) return; // division view handles its own load
        let cancelled = false;
        (async () => {
            setGlobalLoading(true); setError(null);
            try {
                const snap = await axios.get('/payroll/dashboard/wage-distribution', { params: { month, year, division_code: 'ALL' }, headers: authHeaders });
                if (cancelled) return;
                if (snap.data?.tonase) setTonaseMap(snap.data.tonase);
                const snapRows = (snap.data?.data || []).map(normSnapRow);
                const haveDivs = new Set(snapRows.map(r => r.division_code).filter(Boolean));
                const missing = PRODUCING.filter(d => !haveDivs.has(d));
                if (missing.length === 0) {
                    setGlobalRoster(snapRows);
                    return;
                }
                // snapshot under-seeded → live-fetch just the missing divisions (slow, but bounded)
                const results = await Promise.allSettled(missing.map(d =>
                    axios.get('/payroll/report/division-raw-tree', { params: { division_code: d, month, year }, headers: authHeaders })
                        .then(r => { const data = r.data?.data || r.data; const gm = data.gangs || data; const rows = []; Object.values(gm).forEach(g => { (g.employees || g.rows || []).forEach(e => rows.push(normLiveRow(e, g.gang_code || '', d))); }); return rows; })
                ));
                if (cancelled) return;
                const live = [];
                results.forEach(r => { if (r.status === 'fulfilled') live.push(...r.value); });
                setGlobalRoster([...snapRows, ...live]);
            } catch (e) { if (!cancelled) setError(`Gagal memuat sebaran gaji: ${e.response?.status || e.message}`); }
            finally { if (!cancelled) setGlobalLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [authHeaders, month, year, division]);

    // load divisions once
    useEffect(() => {
        (async () => {
            try {
                const r = await axios.get('/payroll/divisions', { headers: authHeaders });
                const arr = Array.isArray(r.data) ? r.data : (r.data?.data || []);
                if (Array.isArray(arr)) setDivisions(arr.filter(d => typeof d === 'string' && d.trim()));
            } catch { /* ignore */ }
        })();
    }, [authHeaders]);

    // load gangs when division changes (param: division, not division_code)
    useEffect(() => {
        if (!division) { setGangs([]); return; }
        (async () => {
            try {
                const r = await axios.get('/payroll/gangs', { params: { division }, headers: authHeaders });
                const arr = Array.isArray(r.data) ? r.data : (r.data?.data || []);
                setGangs(Array.isArray(arr) ? arr : []);
            } catch { setGangs([]); }
        })();
    }, [authHeaders, division]);

    const load = useCallback(async () => {
        if (!division) { setError('Pilih divisi dulu'); setEmployees([]); return; }
        setLoading(true); setError(null); setBandFilter(null); setCompoSlice(null);
        try {
            // snapshot first (fast); fallback to live raw-tree when period not yet seeded
            let rows = [];
            const snap = await axios.get('/payroll/dashboard/wage-distribution', { params: { month, year, division_code: division }, headers: authHeaders });
            const snapArr = (snap.data?.data || []).map(normSnapRow);
            if (snapArr.length > 0) {
                rows = snapArr;
            } else {
                const r = await axios.get('/payroll/report/division-raw-tree', { params: { division_code: division, month, year }, headers: authHeaders });
                const j = r.data;
                if (!j.success && j.error) { setError(j.error); setEmployees([]); return; }
                const data = j.data || j;
                const gangsMap = data.gangs || data;
                Object.values(gangsMap).forEach(g => {
                    const emps = g.employees || g.rows || [];
                    const gangCode = g.gang_code || '';
                    emps.forEach(e => rows.push(normLiveRow(e, gangCode, division)));
                });
            }
            if (gang) rows = rows.filter(e => {
                const gc = String(e.gang_code || '').trim().toUpperCase();
                return gc === String(gang).trim().toUpperCase();
            });
            setEmployees(rows);
        } catch (e) { setError(e.message); setEmployees([]); }
        finally { setLoading(false); }
    }, [authHeaders, division, gang, month, year]);

    useEffect(() => { if (division) load(); }, [load]);

    // Salary distribution: FIXED 1jt bands (detailed, long histogram) - share helper with global view
    const BAND_STEP = 1_000_000;
    const binCounts = (rows) => {
        const vals = rows.map(e => num(e.upah_kotor)).filter(u => u > 0);
        const bands = fixedBands(vals, BAND_STEP);
        if (bands.length === 0) return { bands: [], counts: [] };
        const counts = bands.map(b => ({ band: b.label, count: 0, ...b }));
        for (const e of rows) {
            const u = num(e.upah_kotor);
            let placed = false;
            for (let i = 0; i < bands.length; i++) {
                if (u >= bands[i].min && u < bands[i].max) { counts[i].count += 1; placed = true; break; }
            }
            if (!placed && u >= bands[bands.length - 1].min) counts[counts.length - 1].count += 1; // value at/above last band's min
        }
        return { bands, counts };
    };
    const salaryDist = useMemo(() => binCounts(employees), [employees]);

    const filtered = useMemo(() => {
        let r = employees;
        if (bandFilter && salaryDist.bands.length) {
            const band = salaryDist.bands.find(b => b.label === bandFilter);
            if (band) r = r.filter(e => { const u = num(e.upah_kotor); return u >= band.min && u < band.max; });
        }
        if (compoSlice) {
            const key = compoSlice === 'Gaji Pokok' ? 'gaji_pokok' : compoSlice === 'Lembur' ? 'lembur_jumlah' : compoSlice === 'Premi' ? 'total_premi' : compoSlice === 'Tunjangan' ? 'total_tunjangan' : 'total_potongan';
            r = r.filter(e => Math.abs(num(e[key])) > 0).sort((a, b) => num(b[key]) - num(a[key]));
        }
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            r = r.filter(e => String(e.emp_code || '').toLowerCase().includes(q) || String(e.nama || e.emp_name || '').toLowerCase().includes(q));
        }
        const col = COLUMNS.find(c => c.key === sortKey);
        if (!col) return r;
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...r].sort((a, b) => {
            const av = a[sortKey], bv = b[sortKey];
            if (col.sort === 'num') return (num(av) - num(bv)) * dir;
            return String(av || '').localeCompare(String(bv || '')) * dir;
        });
    }, [employees, bandFilter, compoSlice, salaryDist, search, sortKey, sortDir]);

    // division salary composition (for donut): gaji pokok + lembur + premi of upah kotor
    const compo = useMemo(() => {
        let pokok = 0, lembur = 0, premi = 0;
        for (const e of employees) {
            pokok += Math.abs(num(e.gaji_pokok));
            lembur += Math.abs(num(e.lembur_jumlah));
            premi += Math.abs(num(e.total_premi));
        }
        const compo = [
            { name: 'Gaji Pokok', value: pokok, color: chartPalette[0] },
            { name: 'Lembur', value: lembur, color: C.lembur },
            { name: 'Premi', value: premi, color: chartPalette[2] },
        ].filter(d => d.value > 0);
        const otEarners = [...employees].filter(e => num(e.lembur_jumlah) > 0).sort((a, b) => num(b.lembur_jumlah) - num(a.lembur_jumlah)).slice(0, 8);
        const otBands = fixedBands(employees.map(e => num(e.lembur_jumlah)).filter(v => v > 0), 250_000);
        const otCounts = otBands.map(b => ({ band: b.label, count: 0, ...b }));
        for (const e of employees) {
            const o = num(e.lembur_jumlah);
            for (let i = 0; i < otBands.length; i++) { if (o >= otBands[i].min && o < otBands[i].max) { otCounts[i].count += 1; break; } }
        }
        return { compo, otEarners, otCounts };
    }, [employees]);

    const kpis = useMemo(() => {
        const n = employees.length;
        const totalKotor = employees.reduce((s, e) => s + num(e.upah_kotor), 0);
        const totalPokok = employees.reduce((s, e) => s + num(e.gaji_pokok), 0);
        const totalPremi = employees.reduce((s, e) => s + num(e.total_premi), 0);
        const totalPot = employees.reduce((s, e) => s + num(e.total_potongan), 0);
        const topComp = totalPremi >= totalPokok && totalPremi >= totalPot ? 'Premi' : totalPot >= totalPokok ? 'Potongan' : 'Gaji Pokok';
        return { n, totalKotor, totalPokok, totalPremi, totalPot, topComp, avg: n > 0 ? totalKotor / n : 0 };
    }, [employees]);

    // classify work type from gang_code suffix: last letter H=Panen, T=Transport, else Maintenance
    const classifyTypeOf = (gc) => {
        const s = String(gc || '').trim().toUpperCase();
        const last = s.slice(-1);
        if (last === 'H') return 'Panen';
        if (last === 'T') return 'Transport';
        if (last === 'M') return 'Maintenance';
        return 'Lainnya';
    };

    // cross-division salary histogram (FIXED 1jt bands) + work-type breakdown with member refs for drilldown
    const global = useMemo(() => {
        const vals = globalRoster.map(e => num(e.upah_kotor)).filter(u => u > 0);
        const totalHc = vals.length;
        const totalWage = vals.reduce((s, v) => s + v, 0);
        const { bands, counts } = binCounts(globalRoster);
        // component totals (lintas divisi) for composition donut
        let pokok = 0, lembur = 0, premi = 0, tunj = 0, pot = 0;
        // work-type breakdown: count + total upah + total HK per type + member refs
        const typeMap = new Map();
        for (const e of globalRoster) {
            const t = classifyTypeOf(e.gang_code);
            let agg = typeMap.get(t) || { type: t, count: 0, wage: 0, hk: 0, members: [] };
            agg.count += 1;
            agg.wage += num(e.upah_kotor);
            agg.hk += num(e.hari_kerja || e.kehadiran || 0);
            agg.members.push(e);
            typeMap.set(t, agg);
            pokok += Math.abs(num(e.gaji_pokok));
            lembur += Math.abs(num(e.lembur_jumlah));
            premi += Math.abs(num(e.total_premi));
            tunj += Math.abs(num(e.total_tunjangan));
            pot += Math.abs(num(e.total_potongan));
        }
        const types = [...typeMap.values()].sort((a, b) => b.wage - a.wage);
        const compo = [
            { name: 'Gaji Pokok', value: pokok, color: chartPalette[0] },
            { name: 'Lembur', value: lembur, color: C.lembur },
            { name: 'Premi', value: premi, color: chartPalette[2] },
            { name: 'Tunjangan', value: tunj, color: chartPalette[1] },
            { name: 'Potongan', value: pot, color: C.potongan },
        ].filter(d => d.value > 0);
        // overtime analysis: jam-lembur distribution + top overtime earners
        const otEarners = [...globalRoster].filter(e => num(e.lembur_jumlah) > 0).sort((a, b) => num(b.lembur_jumlah) - num(a.lembur_jumlah)).slice(0, 8);
        const otBands = fixedBands(globalRoster.map(e => num(e.lembur_jumlah)).filter(v => v > 0), 250_000);
        const otCounts = otBands.map(b => ({ band: b.label, count: 0, ...b }));
        for (const e of globalRoster) {
            const o = num(e.lembur_jumlah);
            for (let i = 0; i < otBands.length; i++) { if (o >= otBands[i].min && o < otBands[i].max) { otCounts[i].count += 1; break; } }
        }
        // per-division aggregates (ranking + stacked components)
        const divMap = new Map();
        for (const e of globalRoster) {
            const d = (e.division_code || '').trim();
            if (!d) continue;
            let a = divMap.get(d) || { code: d, count: 0, wage: 0, hk: 0, pokok: 0, lembur: 0, premi: 0, tunj: 0, pot: 0 };
            a.count += 1;
            a.wage += num(e.upah_kotor);
            a.hk += num(e.hari_kerja || e.jumlah_hk || 0);
            a.pokok += Math.abs(num(e.gaji_pokok));
            a.lembur += Math.abs(num(e.lembur_jumlah));
            a.premi += Math.abs(num(e.total_premi));
            a.tunj += Math.abs(num(e.total_tunjangan));
            a.pot += Math.abs(num(e.total_potongan));
            divMap.set(d, a);
        }
        const byDivision = [...divMap.values()].map(a => ({
            ...a, avg: a.count > 0 ? a.wage / a.count : 0, costHK: a.hk > 0 ? a.wage / a.hk : 0,
            tonase: num(tonaseMap[a.code]), costTon: 0,
            stack: { Gaji: a.pokok, Lembur: a.lembur, Premi: a.premi, Tunjangan: a.tunj, Potongan: a.pot }
        })).map(a => ({ ...a, costTon: a.tonase > 0 ? a.wage / a.tonase : 0 }))
          .sort((a, b) => b.avg - a.avg);
        // scatter: HK vs upah_kotor per employee, colored by work type
        const typeColor = (t) => t === 'Panen' ? C.upah : t === 'Transport' ? C.lembur : t === 'Maintenance' ? C.premi : C.muted;
        const scatter = globalRoster.filter(e => num(e.hari_kerja) > 0 && num(e.upah_kotor) > 0)
            .map(e => ({ x: num(e.hari_kerja), y: num(e.upah_kotor), type: classifyTypeOf(e.gang_code), emp: e }));
        const scatterGroups = ['Panen', 'Transport', 'Maintenance', 'Lainnya']
            .map(t => ({ type: t, color: typeColor(t), data: scatter.filter(s => s.type === t) }))
            .filter(g => g.data.length > 0);
        // top 10 earners across all divisions + which component drives them
        const topEarners = [...globalRoster].filter(e => num(e.upah_kotor) > 0)
            .sort((a, b) => num(b.upah_kotor) - num(a.upah_kotor)).slice(0, 10)
            .map(e => {
                const p = Math.abs(num(e.gaji_pokok)), l = Math.abs(num(e.lembur_jumlah)), m = Math.abs(num(e.total_premi));
                const driver = m >= p && m >= l ? 'Premi' : l >= p ? 'Lembur' : 'Gaji Pokok';
                return { emp: e, driver, driverVal: driver === 'Premi' ? m : driver === 'Lembur' ? l : p };
            });
        return { bands, counts, totalHc, totalWage, avgWage: totalHc > 0 ? totalWage / totalHc : 0, types, compo, otEarners, otCounts, byDivision, scatterGroups, topEarners };
    }, [globalRoster, tonaseMap]);

    // jumlah slide deck: division view (3-4) atau global view (5), 0 saat belum ada konten
    const slideCount = division
        ? (!loading && employees.length > 0 ? (compo.otCounts.length > 0 ? 4 : 3) : 0)
        : (!globalLoading && global.counts.length > 0 ? 5 : 0);

    const toggleSort = (key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const clearDivision = () => applyParams({ division: '', gang: '' });

    const breadcrumbs = division
        ? [{ label: 'Semua Divisi', onClick: clearDivision }, { label: division }, ...(gang ? [{ label: gang }] : [])]
        : [];

    const compoKey = (slice) => slice === 'Gaji Pokok' ? 'gaji_pokok' : slice === 'Lembur' ? 'lembur_jumlah' : slice === 'Premi' ? 'total_premi' : slice === 'Tunjangan' ? 'total_tunjangan' : 'total_potongan';

    const activeDrill = globalBand || typeFilter || compoSlice || divFilter;

    // Roster hasil drill global (band/type/komponen/divisi) — sama dengan logika di slide 05.
    const filteredGlobalRoster = useMemo(() => {
        let pool = globalRoster;
        if (globalBand) pool = pool.filter(e => { const u = num(e.upah_kotor); const b = global.bands.find(bd => u >= bd.min && u < bd.max); return b?.label === globalBand; });
        if (typeFilter) pool = pool.filter(e => classifyTypeOf(e.gang_code) === typeFilter);
        if (divFilter) pool = pool.filter(e => (e.division_code || '').trim() === divFilter);
        if (compoSlice) {
            const key = compoKey(compoSlice);
            pool = pool.filter(e => Math.abs(num(e[key])) > 0).sort((a, b) => num(b[key]) - num(a[key]));
        }
        return pool;
    }, [globalRoster, globalBand, typeFilter, divFilter, compoSlice]);

    // Saat print: abaikan filter klik (band/type/komponen/divisi) supaya seluruh karyawan tercetak.
    const rosterRows = printExpanded ? employees : filtered;
    const globalRosterRows = printExpanded ? globalRoster : (activeDrill ? filteredGlobalRoster : []);

    return (
        <>
            <ReportHero
                title="Analisis Gaji per Karyawan"
                subtitle="Roster karyawan + rincian komponen gaji per orang. Klik baris untuk bedah full payslip."
                period={`${String(month).padStart(2, '0')}/${year}`}
                eyebrow="Perkebunan Sawit · Analisis Gaji"
                actions={<>
                    <button className="no-print" onClick={() => printReport({ orientation: 'landscape', margin: '6mm' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: '#111827', color: '#fff', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                        <Printer size={14} /> Cetak
                    </button>
                    <PresentController
                    presenting={presenting}
                    activeIndex={activeIndex}
                    slideCount={slideCount}
                    onEnter={enter}
                    onExit={exit}
                    caption={`Analisis Gaji · ${String(month).padStart(2, '0')}/${year} · ${division ? (gang ? `${division} · ${gang}` : `Divisi ${division}`) : 'Semua Divisi'}`}
                /></>}
            />
            <ReportBody>
                {/* Filter bar */}
                <div className="no-print" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 18, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', boxShadow: SHADOW }}>
                    <Field label="Divisi">
                        <select value={division} onChange={e => applyParams({ division: e.target.value, gang: '' })} style={selectStyle}>
                            <option value="">Pilih divisi</option>
                            {divisions.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </Field>
                    <Field label="Gang (opsional)">
                        <select value={gang} onChange={e => applyParams({ gang: e.target.value })} style={selectStyle} disabled={!gangs.length}>
                            <option value="">Semua Gang</option>
                            {gangs.map(g => <option key={g.gang_code} value={g.gang_code}>{g.gang_code} · {g.description || ''}</option>)}
                        </select>
                    </Field>
                    <Field label="Bulan">
                        <select value={month} onChange={e => applyParams({ month: e.target.value })} style={selectStyle}>
                            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                        </select>
                    </Field>
                    <Field label="Tahun">
                        <select value={year} onChange={e => applyParams({ year: e.target.value })} style={selectStyle}>
                            {[2026, 2025].map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </Field>
                    <button onClick={load} disabled={!division || loading} style={{ background: C.upah, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, fontSize: 13, cursor: division ? 'pointer' : 'not-allowed', opacity: (!division || loading) ? 0.45 : 1, boxShadow: SHADOW }}>
                        {loading ? 'Memuat…' : 'Tampilkan'}
                    </button>
                    {division && (
                        <button onClick={clearDivision} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.border}`, background: C.surface2, borderRadius: 8, padding: '10px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', color: C.upah }}>
                            <RotateCcw size={13} /> Semua Divisi
                        </button>
                    )}
                </div>

                {breadcrumbs.length > 0 && <Breadcrumb items={breadcrumbs} />}

                {error && <EmptyState title="Gagal memuat" message={error} />}

                {!error && division && loading && (
                    <div style={{ ...CARD, padding: 40, textAlign: 'center', color: C.text2 }}>
                        <div style={{ display: 'inline-block', width: 28, height: 28, border: `3px solid ${C.border}`, borderTopColor: C.upah, borderRadius: '50%', animation: 'spin .8s linear infinite', marginBottom: 14 }} />
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Memuat roster {division}…</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Mengambil data karyawan + komponen gaji</div>
                    </div>
                )}

                {!error && division && !loading && employees.length > 0 && (
                    <>
                        <PresentSlide num="01" id="slide-01" title="Potret Upah Divisi" subtitle="Headcount, total upah kotor, gaji pokok, dan premi periode terpilih">
                        {/* KPI */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
                            <KpiCard label="Karyawan" value={fmtNum(kpis.n, 0)} note={`${gang || 'semua gang'} · ${division}`} color={C.leafLight} metric={{ label: 'Jumlah Karyawan', formula: 'Σ baris roster', scope: null, caveat: 'Roster dari snapshot payroll_history_detail periode terpilih, difilter divisi/gang.' }} />
                            <KpiCard label="Total Upah Kotor" value={fmtCompact(kpis.totalKotor)} note={`rata-rata ${fmtCompact(kpis.avg)}/orang`} color={C.upah} metric={{ label: 'Total Upah Kotor', formula: 'Σ jumlah_upah_kotor', scope: null, caveat: 'Sebelum potongan. Termasuk gaji pokok, tunjangan, premi, koreksi, pendapatan lainnya.' }} />
                            <KpiCard label="Total Gaji Pokok" value={fmtCompact(kpis.totalPokok)} note={`${fmtCompact(kpis.totalPokok / (kpis.n || 1))}/orang`} color={C.leafDark} metric={{ label: 'Gaji Pokok', formula: 'Σ gaji_pokok', scope: null, caveat: 'Bagian tetap dari upah, sebelum tunjangan dan premi.' }} />
                            <KpiCard label="Total Premi" value={fmtCompact(kpis.totalPremi)} note={`potongan ${fmtCompact(kpis.totalPot)}`} color={C.lembur} metric={{ label: 'Total Premi', formula: 'Σ total_premi', scope: null, caveat: 'Premi brondol, pruning, insentif, kinerja, ritase, dll.' }} />
                        </div>
                        </PresentSlide>

                        <PresentSlide num="02" id="slide-02" title="Sebaran Upah Kotor" subtitle="Berapa banyak karyawan di tiap kelompok gaji">
                        {/* Salary distribution histogram - count per band */}
                        <Section title="Sebaran Upah Kotor" sub={bandFilter ? `Filter aktif: ${bandFilter} · klik bar lagi untuk reset` : 'Klik bar untuk filter tabel ke kelompok gaji itu'}
                            actions={bandFilter ? <ResetBtn onClick={() => setBandFilter(null)} label="← Semua" /> : null}>
                            <ResponsiveContainer width="100%" height={240}>
                                <ComposedChart data={salaryDist.counts} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                                    <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                                    <XAxis dataKey="band" tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} interval={0} />
                                    <YAxis tick={{ fontSize: 12, fill: C.muted }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                                    <Tooltip cursor={{ fill: 'rgba(31,111,67,0.06)' }} formatter={(v, n) => [`${v} karyawan`, n]} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.text, fontWeight: 700 }} />
                                    <Bar dataKey="count" name="Jumlah" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => { const lab = d?.band || (d?.payload?.band); setBandFilter(bf => bf === lab ? null : lab); }} >
                                        {salaryDist.counts.map((d) => (
                                            <Cell key={d.band} fill={bandFilter === d.band ? C.leafDark : bandFilter && bandFilter !== d.band ? C.border : C.upah} />
                                        ))}
                                    </Bar>
                                    <Line type="monotone" dataKey="count" name="Tren" stroke={C.leafDark} strokeWidth={2} dot={{ r: 3, fill: C.leafDark }} activeDot={{ r: 5 }} isAnimationActive={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </Section>
                        </PresentSlide>

                        <PresentSlide num="03" id="slide-03" title="Komposisi & Roster" subtitle="Pembentuk upah kotor dan daftar karyawan hasil filter">
                        {/* Infographic split: composition donut + visual roster cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 16, marginBottom: 18, alignItems: 'start' }}>
                            <Section title="Komposisi Upah Kotor" sub={`${division} · ${month}/${year}`} style={{ marginBottom: 0 }}>
                                {compo.compo.length === 0 ? <div style={{ color: C.muted, fontSize: 12, padding: 20, textAlign: 'center' }}>Belum ada data komponen.</div> : (
                                    <>
                                        <ResponsiveContainer width="100%" height={200}>
                                            <PieChart>
                                                <Pie data={compo.compo} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={2} strokeWidth={0} cursor="pointer" onClick={(d) => { const n = d?.name || d?.payload?.name; setCompoSlice(s => s === n ? null : n); }}>
                                                    {compo.compo.map(d => <Cell key={d.name} fill={d.color} fillOpacity={compoSlice && compoSlice !== d.name ? 0.3 : 1} />)}
                                                </Pie>
                                                <Tooltip formatter={(v, n) => [fmtCompact(v), n]} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                                            {compo.compo.map(d => (
                                                <div key={d.name} onClick={() => setCompoSlice(s => s === d.name ? null : d.name)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: compoSlice === d.name ? C.surface2 : 'transparent' }}>
                                                    <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                                                    <span style={{ color: C.text2 }}>{d.name}</span>
                                                    <span style={{ marginLeft: 'auto', fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{fmtCompact(d.value)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </Section>

                            {/* Visual roster cards */}
                            <Section title={`Roster Karyawan · ${rosterRows.length}`} sub="Klik kartu untuk bedah payslip lengkap" style={{ marginBottom: 0 }}>
                                <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', marginBottom: 12 }}>
                                    <Search size={14} color={C.muted} />
                                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama / kode…" style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%', color: C.text }} />
                                </div>
                                {rosterRows.length === 0 ? <div style={{ color: C.muted, fontSize: 12, padding: 20, textAlign: 'center' }}>Tidak ada karyawan cocok dengan pencarian.</div> : (
                                    <div className="sal-roster-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
                                        {rosterRows.map(e => {
                                            const uk = num(e.upah_kotor);
                                            const top = salaryDist.bands[salaryDist.bands.length - 1]?.max || 1;
                                            const mid = salaryDist.bands[Math.floor(salaryDist.bands.length / 2)]?.min || 0;
                                            const tone = uk >= (salaryDist.bands[salaryDist.bands.length - 1]?.min || 0) ? C.leafDark : (uk >= mid ? C.upah : C.upahAccent);
                                            return (
                                                <div key={e.emp_code} onClick={() => setSelected(e)} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', transition: 'transform .12s, box-shadow .12s' }} onMouseEnter={ev => { ev.currentTarget.style.transform = 'translateY(-2px)'; ev.currentTarget.style.boxShadow = SHADOW_HOVER; }} onMouseLeave={ev => { ev.currentTarget.style.transform = 'none'; ev.currentTarget.style.boxShadow = 'none'; }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                                        <span style={{ fontWeight: 800, fontSize: 12.5, color: C.text, fontFamily: 'var(--font-mono)' }}>{e.emp_code}</span>
                                                        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, fontFamily: 'var(--font-mono)' }}>{e.gang_code}</span>
                                                    </div>
                                                    <div style={{ fontSize: 11.5, color: C.text2, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nama || e.emp_name || '-'}</div>
                                                    <div style={{ fontSize: 13, fontWeight: 800, color: tone, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{fmtCompact(uk)}</div>
                                                    <div style={{ height: 4, borderRadius: 2, background: C.border, marginTop: 8, overflow: 'hidden' }}>
                                                        <div style={{ width: `${Math.min(100, (uk / top) * 100)}%`, height: '100%', background: tone, borderRadius: 2 }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </Section>
                        </div>
                        </PresentSlide>

                        {/* Overtime analysis (division scope) */}
                        {compo.otCounts.length > 0 && (
                            <PresentSlide num="04" id="slide-04" title="Sorotan Lembur" subtitle="Sebaran upah lembur dan penerima lembur tertinggi">
                            <Section title={`Analisis Lembur · ${division}`} sub="Sebaran upah lembur (per 250rb) + 8 penerima tertinggi · klik kartu untuk payslip">
                                <ResponsiveContainer width="100%" height={160}>
                                    <BarChart data={compo.otCounts} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                                        <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                                        <XAxis dataKey="band" tick={{ fontSize: 10, fill: C.text2 }} tickLine={false} axisLine={false} interval={0} />
                                        <YAxis tick={{ fontSize: 12, fill: C.muted }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                                        <Tooltip cursor={{ fill: 'rgba(180,83,9,0.06)' }} formatter={(v) => [`${v} karyawan`, 'Lembur']} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                                        <Bar dataKey="count" name="Jumlah" radius={[4, 4, 0, 0]} fill={C.lembur} />
                                    </BarChart>
                                </ResponsiveContainer>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginTop: 14 }}>
                                    {compo.otEarners.map(e => (
                                        <div key={e.emp_code} onClick={() => setSelected(e)} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }} onMouseEnter={ev => ev.currentTarget.style.boxShadow = SHADOW_HOVER} onMouseLeave={ev => ev.currentTarget.style.boxShadow = 'none'}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                                <span style={{ fontWeight: 800, fontSize: 11.5, color: C.text, fontFamily: 'var(--font-mono)' }}>{e.emp_code}</span>
                                                <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, fontFamily: 'var(--font-mono)' }}>{e.gang_code}</span>
                                            </div>
                                            <div style={{ fontSize: 11, color: C.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nama || e.emp_name || '-'}</div>
                                            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.lembur, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', marginTop: 4 }}>Lembur {fmtCompact(num(e.lembur_jumlah))}</div>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                            </PresentSlide>
                        )}
                    </>
                )}

                {/* GLOBAL view - cross-division salary histogram + work-type breakdown */}
                {!error && !division && (
                    globalLoading ? (
                        <div style={{ ...CARD, padding: 40, textAlign: 'center' }}>
                            <div style={{ display: 'inline-block', width: 28, height: 28, border: `3px solid ${C.border}`, borderTopColor: C.upah, borderRadius: '50%', animation: 'spin .8s linear infinite', marginBottom: 14 }} />
                            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Memuat sebaran gaji lintas divisi…</div>
                            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Mengambil roster 10 divisi produksi (beberapa detik)</div>
                        </div>
                    ) : global.counts.length > 0 ? (
                        <>
                            <PresentSlide num="01" id="slide-01" title="Potret Upah Lintas Divisi" subtitle="Headcount, total upah, rentang gaji, dan tonase seluruh divisi produksi">
                            {/* KPIs */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
                                <KpiCard label="Total Karyawan" value={fmtNum(global.totalHc, 0)} note="lintas divisi" color={C.leafLight} metric={{ label: 'Total Karyawan', formula: 'Σ baris roster lintas divisi', scope: null, caveat: 'Hanya karyawan dengan upah kotor > 0 pada snapshot periode terpilih.' }} />
                                <KpiCard label="Total Upah Kotor" value={fmtCompact(global.totalWage)} note={`rata-rata ${fmtCompact(global.avgWage)}/orang`} color={C.upah} metric={{ label: 'Total Upah Kotor', formula: 'Σ jumlah_upah_kotor', scope: null, caveat: 'Sebelum potongan, seluruh divisi yang punya snapshot.' }} />
                                <KpiCard label="Rentang Gaji" value={`${fmtShort(global.bands[0]?.min)}–${fmtShort(global.bands[global.bands.length - 1]?.max || 0)}`} note="min–max upah kotor" color={C.lembur} />
                                {(() => { const tt = global.byDivision.reduce((s, d) => s + num(d.tonase), 0); return <KpiCard label="Total Tonase" value={`${fmtNum(tt, 0)} t`} note={tt > 0 ? `cost/ton ${fmtCompact(global.totalWage / tt)}` : 'belum ada tonase'} color={C.costTon} metric={{ label: 'Total Tonase', formula: 'Σ tonase per divisi (division_tonase)', scope: null, caveat: 'Tonase milik divisi, bukan per gang. Cost/ton = upah kotor ÷ tonase.' }} />; })()}
                            </div>
                            </PresentSlide>

                            <PresentSlide num="02" id="slide-02" title="Sebaran Gaji Lintas Divisi" subtitle="Distribusi karyawan per kelompok gaji di semua divisi">
                            {/* Cross-division salary histogram */}
                            <Section title="Sebaran Gaji Lintas Divisi" sub={globalBand ? `Filter: ${globalBand} · klik bar lagi untuk reset` : 'Klik bar untuk lihat karyawan di rentang itu (semua divisi)'}
                                actions={globalBand ? <ResetBtn onClick={() => setGlobalBand(null)} label="← Semua" /> : null}>
                                <ResponsiveContainer width="100%" height={260}>
                                    <ComposedChart data={global.counts} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                                        <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                                        <XAxis dataKey="band" tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} interval={0} />
                                        <YAxis tick={{ fontSize: 12, fill: C.muted }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                                        <Tooltip cursor={{ fill: 'rgba(31,111,67,0.06)' }} formatter={(v, n) => [`${v} karyawan`, n]} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.text, fontWeight: 700 }} />
                                        <Bar dataKey="count" name="Jumlah" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => { const lab = d?.band || d?.payload?.band; setGlobalBand(b => b === lab ? null : lab); }} >
                                            {global.counts.map(d => <Cell key={d.band} fill={globalBand === d.band ? C.leafDark : globalBand && globalBand !== d.band ? C.border : C.upah} />)}
                                        </Bar>
                                        <Line type="monotone" dataKey="count" name="Tren" stroke={C.leafDark} strokeWidth={2} dot={{ r: 3, fill: C.leafDark }} activeDot={{ r: 5 }} isAnimationActive={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </Section>
                            </PresentSlide>

                            <PresentSlide num="03" id="slide-03" title="Breakdown & Efisiensi Divisi" subtitle="Perbandingan komponen gaji, rata-rata upah, dan efisiensi HK antar divisi">
                            {/* Komponen per Divisi (stacked) + Ranking per Divisi */}
                            {global.byDivision.length > 0 && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginBottom: 18, alignItems: 'start' }}>
                                    <Section title="Komponen Gaji per Divisi" sub={divFilter ? `Drill: ${divFilter} · klik bar lagi untuk reset` : 'Stacked: gaji pokok + lembur + premi + tunjangan + potongan. Klik bar untuk drill divisi'}>
                                        <ResponsiveContainer width="100%" height={Math.max(220, global.byDivision.length * 28)}>
                                            <BarChart data={global.byDivision} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={4}>
                                                <CartesianGrid strokeDasharray="2 4" stroke={C.border} horizontal={false} />
                                                <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
                                                <YAxis type="category" dataKey="code" tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} width={48} />
                                                <Tooltip cursor={{ fill: 'rgba(31,111,67,0.06)' }} formatter={(v, n) => [fmtCompact(v), n]} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                                                <Bar dataKey="stack.Gaji" name="Gaji Pokok" stackId="a" fill={C.upah} cursor="pointer" onClick={(d) => { const c = d?.code || d?.payload?.code; setDivFilter(f => f === c ? null : c); }} />
                                                <Bar dataKey="stack.Lembur" name="Lembur" stackId="a" fill={C.lembur} />
                                                <Bar dataKey="stack.Premi" name="Premi" stackId="a" fill={chartPalette[2]} />
                                                <Bar dataKey="stack.Tunjangan" name="Tunjangan" stackId="a" fill={chartPalette[1]} />
                                                <Bar dataKey="stack.Potongan" name="Potongan" stackId="a" fill={C.potongan} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                        <LegendRow items={[['Gaji Pokok', C.upah], ['Lembur', C.lembur], ['Premi', chartPalette[2]], ['Tunjangan', chartPalette[1]], ['Potongan', C.potongan]]} />
                                    </Section>

                                    <Section title="Rata-rata Gaji per Divisi" sub="Klik bar untuk drill roster divisi · tooltip: headcount, tonase, cost/HK, cost/ton">
                                        <ResponsiveContainer width="100%" height={Math.max(220, global.byDivision.length * 28)}>
                                            <BarChart data={global.byDivision} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={4}>
                                                <CartesianGrid strokeDasharray="2 4" stroke={C.border} horizontal={false} />
                                                <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
                                                <YAxis type="category" dataKey="code" tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} width={48} />
                                                <Tooltip cursor={{ fill: 'rgba(31,111,67,0.06)' }} formatter={(v, n) => [fmtCompact(v), n === 'avg' ? 'Avg upah' : n]} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} labelFormatter={(l) => { const d = global.byDivision.find(b => b.code === l); return d ? `${l} · ${d.count} karyawan · tonase ${fmtNum(d.tonase, 0)} t · ${fmtCompact(d.costHK)}/HK · ${fmtCompact(d.costTon)}/ton` : l; }} />
                                                <Bar dataKey="avg" name="avg" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => { const c = d?.code || d?.payload?.code; setDivFilter(f => f === c ? null : c); }} >
                                                    {global.byDivision.map(d => <Cell key={d.code} fill={divFilter === d.code ? C.leafDark : divFilter && divFilter !== d.code ? C.border : C.upah} />)}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </Section>
                                </div>
                            )}

                            {/* Efisiensi Gaji - scatter HK vs upah kotor */}
                            {global.scatterGroups.length > 0 && (
                                <Section title="Efisiensi Gaji · HK vs Upah Kotor" sub="Klik titik untuk bedah payslip · kiri-bawah = HK tinggi tapi gaji rendah (perlu perhatian)">
                                    <ResponsiveContainer width="100%" height={300}>
                                        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                                            <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                                            <XAxis type="number" dataKey="x" name="HK" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={false} label={{ value: 'Hari Kerja', position: 'insideBottom', offset: -12, fontSize: 11, fill: C.text2 }} />
                                            <YAxis type="number" dataKey="y" name="Upah" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={56} />
                                            <ZAxis range={[24, 24]} />
                                            <Tooltip cursor={{ strokeDasharray: '3 3', stroke: C.border }} formatter={(v, n) => [n === 'Upah' ? fmtCompact(v) : `${v} HK`, n]} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                                            {global.scatterGroups.map(g => (
                                                <Scatter key={g.type} name={g.type} data={g.data} fill={g.color} fillOpacity={0.55} cursor="pointer" onClick={(p) => p?.emp && setSelected(p.emp)} />
                                            ))}
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                        </ScatterChart>
                                    </ResponsiveContainer>
                                </Section>
                            )}
                            </PresentSlide>

                            <PresentSlide num="04" id="slide-04" title="Komposisi & Jenis Pekerjaan" subtitle="Pembentuk upah lintas divisi dan pembagian Panen, Transport, Maintenance">
                            {/* Work-type breakdown: Panen / Transport / Maintenance */}
                            {global.types.length > 0 && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
                                    {global.types.map(t => {
                                        const tone = t.type === 'Panen' ? C.upah : t.type === 'Transport' ? C.lembur : t.type === 'Maintenance' ? C.premi : C.muted;
                                        const active = typeFilter === t.type;
                                        return (
                                            <div key={t.type} onClick={() => setTypeFilter(f => f === t.type ? null : t.type)} style={{ background: C.surface, border: `1px solid ${active ? tone : C.border}`, borderRadius: 10, padding: 16, borderTop: `3px solid ${tone}`, cursor: 'pointer', boxShadow: active ? SHADOW_HOVER : SHADOW, transition: 'all .15s' }} onMouseEnter={ev => ev.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={ev => ev.currentTarget.style.transform = 'none'}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                                    <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-display)' }}>{t.type}</div>
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: active ? tone : C.muted }}>{active ? 'aktif · reset' : 'klik →'}</span>
                                                </div>
                                                <div style={{ fontSize: 22, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{fmtNum(t.count, 0)} <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, fontFamily: 'var(--font-body)' }}>karyawan</span></div>
                                                <div style={{ fontSize: 13, color: C.text2, marginTop: 6 }}>{fmtCompact(t.wage)} total · {fmtCompact(t.hk > 0 ? t.wage / t.hk : 0)}/HK</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Composition donut (lintas divisi) + Overtime analysis */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 18, alignItems: 'start' }}>
                                <Section title="Komposisi Gaji Lintas Divisi" sub={compoSlice ? `Drill: ${compoSlice} · klik slice lagi untuk reset` : 'Klik slice donat untuk lihat karyawan dengan komponen itu'} style={{ marginBottom: 0 }}>
                                    {global.compo.length === 0 ? <div style={{ color: C.muted, fontSize: 12, padding: 20, textAlign: 'center' }}>Belum ada data komponen.</div> : (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 240px) minmax(0, 1fr)', gap: 16, alignItems: 'center' }}>
                                            <ResponsiveContainer width="100%" height={200}>
                                                <PieChart>
                                                    <Pie data={global.compo} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={2} strokeWidth={0} cursor="pointer" onClick={(d) => { const n = d?.name || d?.payload?.name; setCompoSlice(s => s === n ? null : n); }}>
                                                        {global.compo.map(d => <Cell key={d.name} fill={d.color} fillOpacity={compoSlice && compoSlice !== d.name ? 0.3 : 1} />)}
                                                    </Pie>
                                                    <Tooltip formatter={(v, n) => [fmtCompact(v), n]} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                                                </PieChart>
                                            </ResponsiveContainer>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {global.compo.map(d => (
                                                    <div key={d.name} onClick={() => setCompoSlice(s => s === d.name ? null : d.name)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: compoSlice === d.name ? C.surface2 : 'transparent' }}>
                                                        <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                                                        <span style={{ color: C.text2 }}>{d.name}</span>
                                                        <span style={{ marginLeft: 'auto', fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{fmtCompact(d.value)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </Section>

                                {global.otCounts.length > 0 && (
                                    <Section title="Analisis Lembur Lintas Divisi" sub="Sebaran upah lembur (per 250rb) + 8 penerima tertinggi · klik kartu untuk payslip" style={{ marginBottom: 0 }}>
                                        <ResponsiveContainer width="100%" height={160}>
                                            <BarChart data={global.otCounts} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                                                <CartesianGrid strokeDasharray="2 4" stroke={C.border} />
                                                <XAxis dataKey="band" tick={{ fontSize: 10, fill: C.text2 }} tickLine={false} axisLine={false} interval={0} />
                                                <YAxis tick={{ fontSize: 12, fill: C.muted }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                                                <Tooltip cursor={{ fill: 'rgba(180,83,9,0.06)' }} formatter={(v) => [`${v} karyawan`, 'Lembur']} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                                                <Bar dataKey="count" name="Jumlah" radius={[4, 4, 0, 0]} fill={C.lembur} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginTop: 12 }}>
                                            {global.otEarners.map(e => (
                                                <div key={e.emp_code} onClick={() => setSelected(e)} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }} onMouseEnter={ev => ev.currentTarget.style.boxShadow = SHADOW_HOVER} onMouseLeave={ev => ev.currentTarget.style.boxShadow = 'none'}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                                        <span style={{ fontWeight: 800, fontSize: 11, color: C.text, fontFamily: 'var(--font-mono)' }}>{e.emp_code}</span>
                                                        <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, fontFamily: 'var(--font-mono)' }}>{e.division_code} · {e.gang_code}</span>
                                                    </div>
                                                    <div style={{ fontSize: 10.5, color: C.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nama || e.emp_name || '-'}</div>
                                                    <div style={{ fontSize: 12, fontWeight: 800, color: C.lembur, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', marginTop: 3 }}>Lembur {fmtCompact(num(e.lembur_jumlah))}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </Section>
                                )}
                            </div>
                            </PresentSlide>

                            <PresentSlide num="05" id="slide-05" title="Sorotan Tertinggi & Drill-down" subtitle="10 gaji tertinggi lintas divisi dan roster hasil drill interaktif">
                            {/* Top Earners - 10 gaji tertinggi lintas divisi + driver komponen */}
                            {global.topEarners.length > 0 && (
                                <Section title="10 Gaji Tertinggi Lintas Divisi" sub="Driver = komponen terbesar yang mendorong gaji (Premi/Lembur/Gaji Pokok). Klik kartu untuk payslip">
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 10 }}>
                                        {global.topEarners.map(({ emp, driver, driverVal }, i) => {
                                            const uk = num(emp.upah_kotor);
                                            const dColor = driver === 'Premi' ? chartPalette[2] : driver === 'Lembur' ? C.lembur : C.upah;
                                            return (
                                                <div key={emp.emp_code} onClick={() => setSelected(emp)} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderLeft: `3px solid ${dColor}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }} onMouseEnter={ev => ev.currentTarget.style.boxShadow = SHADOW_HOVER} onMouseLeave={ev => ev.currentTarget.style.boxShadow = 'none'}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                                        <span style={{ fontWeight: 800, fontSize: 11, color: C.muted, fontFamily: 'var(--font-mono)' }}>#{i + 1}</span>
                                                        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, fontFamily: 'var(--font-mono)' }}>{emp.division_code} · {emp.gang_code}</span>
                                                    </div>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.nama || emp.emp_name || '-'}</div>
                                                    <div style={{ fontSize: 15, fontWeight: 800, color: C.leafDark, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)', marginTop: 4 }}>{fmtCompact(uk)}</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 10.5 }}>
                                                        <span style={{ background: dColor, color: '#fff', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{driver}</span>
                                                        <span style={{ color: C.text2, fontFamily: 'var(--font-mono)' }}>{fmtCompact(driverVal)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </Section>
                            )}

                            {/* Drill roster: band OR work-type OR component OR division */}
                            {(!printExpanded && activeDrill) ? (
                                <Section title={`Roster drill: ${globalBand ? `rentang ${globalBand}` : typeFilter ? `jenis ${typeFilter}` : compoSlice ? `komponen ${compoSlice}` : divFilter ? `divisi ${divFilter}` : ''}`}
                                    actions={<ResetBtn onClick={() => { setGlobalBand(null); setTypeFilter(null); setCompoSlice(null); setDivFilter(null); }} label="← Reset semua" />}>
                                    <div className="sal-roster-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
                                        {globalRosterRows.map(e => (
                                            <div key={e.emp_code} onClick={() => setSelected(e)} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }} onMouseEnter={ev => ev.currentTarget.style.boxShadow = SHADOW_HOVER} onMouseLeave={ev => ev.currentTarget.style.boxShadow = 'none'}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                                    <span style={{ fontWeight: 800, fontSize: 12.5, color: C.text, fontFamily: 'var(--font-mono)' }}>{e.emp_code}</span>
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, fontFamily: 'var(--font-mono)' }}>{e.division_code} · {e.gang_code}</span>
                                                </div>
                                                <div style={{ fontSize: 11.5, color: C.text2, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nama || e.emp_name || '-'}</div>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: C.leafDark, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{fmtCompact(num(e.upah_kotor))}</div>
                                            </div>
                                        ))}
                                    </div>
                                </Section>
                            ) : printExpanded && globalRosterRows.length > 0 ? (
                                <Section title={`Roster Lengkap Lintas Divisi · ${globalRosterRows.length}`} sub="Semua karyawan — filter klik diabaikan pada cetakan">
                                    <div className="sal-roster-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
                                        {globalRosterRows.map(e => (
                                            <div key={e.emp_code} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                                    <span style={{ fontWeight: 800, fontSize: 12.5, color: C.text, fontFamily: 'var(--font-mono)' }}>{e.emp_code}</span>
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, fontFamily: 'var(--font-mono)' }}>{e.division_code} · {e.gang_code}</span>
                                                </div>
                                                <div style={{ fontSize: 11.5, color: C.text2, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nama || e.emp_name || '-'}</div>
                                                <div style={{ fontSize: 13, fontWeight: 800, color: C.leafDark, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{fmtCompact(num(e.upah_kotor))}</div>
                                            </div>
                                        ))}
                                    </div>
                                </Section>
                            ) : null}
                            </PresentSlide>
                        </>
                    ) : <EmptyState title="Tidak ada data global"
                        message={defaultPeriod && (month !== defaultPeriod.month || year !== defaultPeriod.year)
                            ? `Tidak ada data payroll untuk ${month}/${year}. Data tersedia sampai ${defaultPeriod.month}/${defaultPeriod.year}.`
                            : `Tidak ada data payroll untuk ${month}/${year}.`}
                        actionLabel={defaultPeriod && (month !== defaultPeriod.month || year !== defaultPeriod.year) ? `Lihat ${defaultPeriod.month}/${defaultPeriod.year}` : undefined}
                        onAction={defaultPeriod ? () => applyParams({ month: defaultPeriod.month, year: defaultPeriod.year }) : undefined} />
                )}
                {!error && division && !loading && employees.length === 0 && (
                    <EmptyState
                        title="Tidak ada data"
                        message={defaultPeriod && (month !== defaultPeriod.month || year !== defaultPeriod.year)
                            ? `Tidak ada karyawan untuk ${division} ${gang || ''} pada ${month}/${year}. Data tersedia sampai ${defaultPeriod.month}/${defaultPeriod.year}.`
                            : `Tidak ada karyawan untuk ${division} ${gang || ''} pada ${month}/${year}.`}
                        actionLabel={defaultPeriod && (month !== defaultPeriod.month || year !== defaultPeriod.year)
                            ? `Lihat ${defaultPeriod.month}/${defaultPeriod.year}` : undefined}
                        onAction={defaultPeriod ? () => applyParams({ month: defaultPeriod.month, year: defaultPeriod.year }) : undefined}
                    />
                )}
            </ReportBody>

            <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } } @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>

            {/* LAMPIRAN CETAK — data yang di layar hanya muncul saat hover/diklik: distribusi band + definisi */}
            {printExpanded && (
                <div className="sal-print-appendix" style={{ maxWidth: 1320, margin: '0 auto', padding: '0 2.4rem 2rem' }}>
                    <div className="cpts-print-title">Lampiran · Distribusi & Definisi</div>
                    <div className="cpts-print-sub">Periode {String(month).padStart(2, '0')}/{year} · {division ? (gang ? `${division} · ${gang}` : `Divisi ${division}`) : 'Semua Divisi'} · Dicetak {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                    {!division && global.counts.length > 0 && <BandTable title="Sebaran Gaji Lintas Divisi" counts={global.counts} />}
                    {division && salaryDist.counts.length > 0 && <BandTable title="Sebaran Upah Kotor" counts={salaryDist.counts} />}
                    {compo.otCounts.length > 0 && <BandTable title="Sebaran Upah Lembur" counts={compo.otCounts} />}
                    <div className="cpts-print-notes" style={{ fontSize: 12, color: C.text2, lineHeight: 1.7, paddingLeft: 18 }}>
                        <li><b>Kelompok gaji</b>: rentang upah kotor per 1 juta (mis. &lt;1jt, 1–2jt, …, &ge;7jt). Klik bar di layar memfilter roster.</li>
                        <li><b>Upah kotor</b> = jumlah_upah_kotor (gaji pokok + tunjangan + premi + koreksi + pendapatan lainnya), sebelum potongan.</li>
                        <li><b>Komposisi upah</b> = proporsi gaji pokok, lembur, premi terhadap total upah kotor.</li>
                        <li><b>Jenis pekerjaan</b>: suffix kode gang — H = Panen, T = Transport, M = Maintenance, selainnya Lainnya.</li>
                        <li><b>Efisiensi</b>: sebaran HK vs upah kotor; kiri-bawah = HK tinggi tapi gaji rendah (perlu perhatian).</li>
                        <li><b>Sumber</b>: snapshot payroll_history_detail periode terpilih (fallback live raw-tree bila snapshot belum terisi).</li>
                    </div>
                </div>
            )}

            {selected && <DetailDrawer emp={selected} onClose={() => setSelected(null)} printMode={printExpanded} />}
        </>
    );
}

const selectStyle = { border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px', fontSize: 13, background: C.surface, color: C.text, minWidth: 150, cursor: 'pointer', fontFamily: 'var(--font-body)' };

function Field({ label, children }) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-display)' }}>{label}</span>
            {children}
        </label>
    );
}

/** BandTable — jumlah karyawan per kelompok gaji; di layar cuma muncul saat hover chart, dicetak sebagai tabel. */
function BandTable({ title, counts }) {
    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 6 }}>{title}</div>
            <table className="sal-band-table" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                    <tr>
                        <th style={{ textAlign: 'left', padding: '6px 10px', color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1.5px solid ${C.text}` }}>Kelompok</th>
                        <th style={{ textAlign: 'right', padding: '6px 10px', color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1.5px solid ${C.text}` }}>Karyawan</th>
                    </tr>
                </thead>
                <tbody>
                    {counts.map(c => (
                        <tr key={c.band}>
                            <td style={{ padding: '5px 10px', borderBottom: `1px solid ${C.border}` }}>{c.band}</td>
                            <td style={{ textAlign: 'right', padding: '5px 10px', borderBottom: `1px solid ${C.border}`, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{c.count}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Section - kartu standar: eyebrow + hairline + body. */
function Section({ title, sub, actions, children, style }) {
    return (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', marginBottom: 18, boxShadow: SHADOW, ...(style || {}) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.muted, fontFamily: 'var(--font-display)' }}>{title}</div>
                    {sub && <div style={{ fontSize: 12.5, color: C.text2, marginTop: 4 }}>{sub}</div>}
                </div>
                {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>}
            </div>
            {children}
        </div>
    );
}

function ResetBtn({ onClick, label }) {
    return (
        <button onClick={onClick} style={{ border: `1px solid ${C.border}`, background: C.surface2, borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', color: C.upah }}>
            {label}
        </button>
    );
}

function LegendRow({ items }) {
    return (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: C.text2 }}>
            {items.map(([n, c]) => (
                <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{n}
                </span>
            ))}
        </div>
    );
}

/** KpiCard - ledger cell dengan info tooltip (audit: angka dari mana). */
function KpiCard({ label, value, note, color = C.upah, metric }) {
    return (
        <div style={{ ...CARD, padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ width: 22, height: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted }}>{label}</span>
                {metric && <MetricInfo def={metric} size={11} />}
            </div>
            <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: C.text, lineHeight: 1.1, fontFamily: 'var(--font-mono)' }}>{value}</div>
            {note && <div style={{ fontSize: 11.5, color: C.text2, marginTop: 6 }}>{note}</div>}
        </div>
    );
}

function DetailDrawer({ emp, onClose, printMode }) {
    // Saat print: drawer dirender inline (bukan overlay fixed) supaya tercetak penuh.
    if (printMode) {
        return (
            <section className="sal-drawer-print" style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: `3px solid ${C.upah}`, borderRadius: 10, marginBottom: 18, boxShadow: SHADOW }}>
                <div style={{ background: C.leafDark, color: '#fff', padding: '16px 20px', borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.85, fontFamily: 'var(--font-display)' }}>{emp.emp_code} · {emp.gang_code}</div>
                    <h3 style={{ margin: '4px 0 0', fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>{emp.nama || emp.emp_name || '-'}</h3>
                    <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>Upah Kotor {fmtIDR(emp.upah_kotor)}</div>
                </div>
                <div>
                    {GROUPS.map(g => {
                        const rows = g.fields.filter(([k]) => emp[k] != null && emp[k] !== '' && !(typeof emp[k] === 'number' && emp[k] === 0));
                        if (rows.length === 0) return null;
                        return (
                            <div key={g.title} style={{ padding: '10px 20px', borderBottom: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color: C.leafMid, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'var(--font-display)' }}>{g.title}</div>
                                {rows.map(([key, label]) => {
                                    let val = emp[key];
                                    if (typeof val === 'object') val = JSON.stringify(val);
                                    const isMoney = ['gaji_pokok', 'gaji_pokok_aktual', 'beras_jumlah', 'jabatan_jumlah', 'masa_kerja_jumlah', 'total_tunjangan', 'premi_brondol_total', 'total_premi', 'lembur_jumlah', 'lembur_rate', 'pot_astek_pekerja', 'pot_bpjs_kesehatan_pekerja', 'pot_bpjs_pensiun_pekerja', 'pot_spsi', 'pot_pph21', 'pot_koreksi', 'total_potongan', 'pendapatan_thr', 'pendapatan_bonus', 'pendapatan_custom', 'total_pendapatan_lainnya', 'upah_kotor', 'jumlah_upah_kotor', 'upah_bersih'].includes(key);
                                    return (
                                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', fontSize: 12.5 }}>
                                            <span style={{ color: C.text2 }}>{label}</span>
                                            <span style={{ fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                                {isMoney ? fmtIDR(val) : key === 'lembur_jam' ? fmtNum(val, 1) + ' jam' : String(val)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </section>
        );
    }
    return (
        <>
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(21,33,26,0.42)', zIndex: 50, animation: 'fadeIn .18s' }} />
            <aside style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(480px, 92vw)', background: C.surface, boxShadow: '-12px 0 40px rgba(21,33,26,0.22)', zIndex: 51, display: 'flex', flexDirection: 'column', animation: 'slideIn .22s ease-out' }}>
                <div style={{ background: C.leafDark, color: '#fff', padding: '18px 22px', borderBottom: `3px solid ${C.upah}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.85, fontFamily: 'var(--font-display)' }}>{emp.emp_code} · {emp.gang_code}</div>
                            <h3 style={{ margin: '4px 0 0', fontSize: '1.3rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>{emp.nama || emp.emp_name || '-'}</h3>
                        </div>
                        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#fff' }} aria-label="Tutup"><X size={16} /></button>
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Upah Kotor</span>
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>{fmtIDR(emp.upah_kotor)}</span>
                    </div>
                </div>
                <div style={{ overflowY: 'auto', padding: '8px 0', flex: 1 }}>
                    {GROUPS.map(g => {
                        const rows = g.fields.filter(([k]) => emp[k] != null && emp[k] !== '' && !(typeof emp[k] === 'number' && emp[k] === 0));
                        if (rows.length === 0) return null;
                        return (
                            <div key={g.title} style={{ padding: '12px 22px', borderBottom: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color: C.leafMid, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-display)' }}>{g.title}</div>
                                {rows.map(([key, label]) => {
                                    let val = emp[key];
                                    if (typeof val === 'object') val = JSON.stringify(val);
                                    const isMoney = ['gaji_pokok', 'gaji_pokok_aktual', 'beras_jumlah', 'jabatan_jumlah', 'masa_kerja_jumlah', 'total_tunjangan', 'premi_brondol_total', 'total_premi', 'lembur_jumlah', 'lembur_rate', 'pot_astek_pekerja', 'pot_bpjs_kesehatan_pekerja', 'pot_bpjs_pensiun_pekerja', 'pot_spsi', 'pot_pph21', 'pot_koreksi', 'total_potongan', 'pendapatan_thr', 'pendapatan_bonus', 'pendapatan_custom', 'total_pendapatan_lainnya', 'upah_kotor', 'jumlah_upah_kotor', 'upah_bersih'].includes(key);
                                    return (
                                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', fontSize: 13 }}>
                                            <span style={{ color: C.text2 }}>{label}</span>
                                            <span style={{ fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                                {isMoney ? fmtIDR(val) : key === 'lembur_jam' ? fmtNum(val, 1) + ' jam' : String(val)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </aside>
        </>
    );
}
