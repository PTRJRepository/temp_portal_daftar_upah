import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchAvailablePeriods } from '../services/summaryReportService';
import { fetchGangComparison, fetchDivisionDetailData } from '../services/dashboardService';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import ReportWatermark from '../components/common/ReportWatermark';
import { printReport } from '../utils/printPageSetup';
import { ArrowLeft, Filter, Download, Printer, Users, BarChart3, TrendingUp, DollarSign, Search } from 'lucide-react';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';

export default function ProductivityReportPage({ onBack, initialMonth, initialYear }) {
    const { token, user } = useAuth();

    // Filters
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());
    
    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
    }, [initialMonth, initialYear]);
    const [estateType, setEstateType] = useState('non-ijl'); // 'all', 'non-ijl', 'ijl'
    
    // Detail View State
    const [selectedDivision, setSelectedDivision] = useState(null);
    const [detailData, setDetailData] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailFilters, setDetailFilters] = useState({
        minOtHours: 0,
        searchName: '',
        gangCode: 'ALL'
    });

    // Data
    const [summaryData, setSummaryData] = useState([]);
    const [periods, setPeriods] = useState([]);

    // State
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Load available periods
    useEffect(() => {
        async function loadPeriods() {
            if (!token) return;
            try {
                const result = await fetchAvailablePeriods(token);
                setPeriods(result.periods || []);
            } catch (e) {
                console.error('Failed to load periods:', e);
            }
        }
        loadPeriods();
    }, [token]);

    // Fetch Summary Data
    const fetchSummary = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError('');
        try {
            const data = await fetchGangComparison(token, { month, year });
            // API returns gang level data, we need to aggregate by division for the main table
            setSummaryData(data || []);
        } catch (e) {
            console.error('Error fetching productivity summary:', e);
            setError(e.message || 'Gagal memuat data ringkasan produktivitas');
        } finally {
            setLoading(false);
        }
    }, [token, month, year]);

    // Fetch Detail Data when division is selected
    const fetchDetail = useCallback(async (divCode) => {
        if (!token || !divCode) return;
        setDetailLoading(true);
        try {
            const data = await fetchDivisionDetailData(token, { month, year, division_code: divCode });
            setDetailData(data);
        } catch (e) {
            console.error('Error fetching division detail:', e);
        } finally {
            setDetailLoading(false);
        }
    }, [token, month, year]);

    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    useEffect(() => {
        if (selectedDivision) {
            fetchDetail(selectedDivision);
        } else {
            setDetailData(null);
        }
    }, [selectedDivision, fetchDetail]);

    // Helper: Check if IJL
    const isIJL = (code) => (code || '').toUpperCase().startsWith('L') || (code || '').toUpperCase() === 'IJL';

    // Process Summary Data: Group gangs by Division
    const divisionSummary = useMemo(() => {
        if (!summaryData.length) return [];

        const divMap = {};
        summaryData.forEach(gang => {
            // Determine division from gang_code prefix (e.g. A1H -> A1)
            // Or use division_code if available in API row (it's not always clean)
            // Based on system rules: IJL gangs start with L.
            const isIjlGang = isIJL(gang.gang_code);
            
            // Skip based on estateType filter
            if (estateType === 'ijl' && !isIjlGang) return;
            if (estateType === 'non-ijl' && isIjlGang) return;

            // Simple division grouping (first 2 chars usually)
            // But let's check if division_code exists from backend
            const divCode = gang.division_code || gang.gang_code.substring(0, 2);
            
            if (!divMap[divCode]) {
                divMap[divCode] = {
                    division_code: divCode,
                    total_wage: 0,
                    total_hk: 0,
                    total_production: 0,
                    headcount: 0,
                    total_ot: 0,
                    gang_count: 0
                };
            }

            divMap[divCode].total_wage += (gang.total_wage || 0);
            divMap[divCode].total_hk += (gang.total_hk || 0);
            divMap[divCode].total_production += (gang.total_production || 0);
            divMap[divCode].headcount += (gang.headcount || 0);
            divMap[divCode].total_ot += (gang.total_ot || 0);
            divMap[divCode].gang_count += 1;
        });

        return Object.values(divMap).sort((a, b) => a.division_code.localeCompare(b.division_code));
    }, [summaryData, estateType]);

    // Grand Totals
    const grandTotals = useMemo(() => {
        return divisionSummary.reduce((acc, div) => ({
            wage: acc.total_wage + div.total_wage,
            hk: acc.total_hk + div.total_hk,
            production: acc.total_production + div.total_production,
            headcount: acc.headcount + div.headcount,
            ot: acc.total_ot + div.total_ot
        }), { total_wage: 0, total_hk: 0, total_production: 0, headcount: 0, total_ot: 0 });
    }, [divisionSummary]);

    // Filtered Detail Employees
    const filteredEmployees = useMemo(() => {
        if (!detailData || !detailData.employees) return [];
        return detailData.employees.filter(emp => {
            const matchesSearch = !detailFilters.searchName || 
                emp.name.toLowerCase().includes(detailFilters.searchName.toLowerCase()) ||
                (emp.new_nik || emp.nik).toLowerCase().includes(detailFilters.searchName.toLowerCase());
            
            const matchesOt = emp.lembur_jam >= detailFilters.minOtHours;
            
            const matchesGang = detailFilters.gangCode === 'ALL' || emp.gang === detailFilters.gangCode;

            return matchesSearch && matchesOt && matchesGang;
        });
    }, [detailData, detailFilters]);

    // Formatters
    const formatNumber = (val, dec = 0) => {
        if (val === null || val === undefined) return '-';
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec
        }).format(val);
    };

    const getMonthName = (m) => {
        return ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][m] || '';
    };

    const handlePrint = () => printReport({ orientation: 'landscape' });

    return (
        <div className="wsp-container">
            {/* Toolbar */}
            <div className="wsp-action-bar no-print">
                <div className="left-section">
                    <button onClick={onBack} className="wsp-btn flex items-center gap-2">
                        <ArrowLeft size={16} /> Kembali
                    </button>
                    
                    <div className="wsp-filter-group flex gap-2">
                        <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="wsp-select">
                            {Array.from({length: 12}, (_, i) => (
                                <option key={i+1} value={i+1}>{getMonthName(i+1)}</option>
                            ))}
                        </select>
                        <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="wsp-select">
                            {periods.map(p => p.year).filter((v, i, a) => a.indexOf(v) === i).map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                        <select value={estateType} onChange={e => setEstateType(e.target.value)} className="wsp-select">
                            <option value="all">Semua Estate</option>
                            <option value="non-ijl">Non-IJL (Rebinmas)</option>
                            <option value="ijl">IJL Only</option>
                        </select>
                    </div>
                </div>

                <div className="right-section flex gap-2">
                    <button onClick={fetchSummary} className="wsp-btn" disabled={loading}>Refresh</button>
                    <button onClick={handlePrint} className="wsp-btn wsp-btn-primary flex items-center gap-2">
                        <Printer size={16} /> Print
                    </button>
                </div>
            </div>

            {/* Document */}
            <div className={`wsp-document ${selectedDivision ? 'has-detail' : ''}`}>
                <ReportWatermark />
                {/* Header */}
                <header className="wsp-letterhead text-center border-b-2 border-slate-800 pb-4 mb-8">
                    <h1 className="wsp-company-name text-2xl font-bold uppercase">
                        {estateType === 'ijl' ? 'PT. IMPIAN JAYA LESTARI' : 'PT. REBINMAS JAYA'}
                    </h1>
                    <h2 className="wsp-report-title text-xl font-semibold my-2">
                        LAPORAN ANALISIS PRODUKTIVITAS & BIAYA UPAH
                    </h2>
                    <p className="wsp-report-period text-slate-600">
                        PERIODE: {getMonthName(month).toUpperCase()} {year}
                    </p>
                    <ReportPrintMetadata
                        mode="Productivity"
                        source="Dashboard API"
                        scope={estateType === 'all' ? 'Semua Estate' : estateType === 'ijl' ? 'IJL' : 'Rebinmas'}
                        estate={estateType === 'ijl' ? 'IJL' : estateType === 'all' ? 'All Available' : 'Rebinmas'}
                        items={[{ label: 'Detail', value: selectedDivision || '' }]}
                        note="Ratio biaya dihitung dari produksi, HK, manpower, dan upah periode yang dipilih."
                    />
                </header>

                {/* KPI Grid */}
                <div className="wsp-kpi-grid mb-8" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                    <div className="wsp-kpi-card">
                        <div className="wsp-kpi-label flex items-center gap-2"><TrendingUp size={14}/> Total Tonase</div>
                        <div className="wsp-kpi-value text-blue-700">{formatNumber(grandTotals.production / 1000, 2)} Ton</div>
                        <div className="wsp-kpi-diff neutral">Produksi Estate</div>
                    </div>
                    <div className="wsp-kpi-card">
                        <div className="wsp-kpi-label flex items-center gap-2"><DollarSign size={14}/> Total Upah</div>
                        <div className="wsp-kpi-value text-emerald-700">Rp {formatNumber(grandTotals.wage)}</div>
                        <div className="wsp-kpi-diff neutral">Upah Bersih Dibayarkan</div>
                    </div>
                    <div className="wsp-kpi-card">
                        <div className="wsp-kpi-label">Average Rp / Kg</div>
                        <div className="wsp-kpi-value">
                            Rp {formatNumber(grandTotals.production > 0 ? grandTotals.wage / (grandTotals.production) : 0, 2)}
                        </div>
                        <div className="wsp-kpi-diff neutral">Efisiensi Biaya Produksi</div>
                    </div>
                    <div className="wsp-kpi-card">
                        <div className="wsp-kpi-label flex items-center gap-2"><Users size={14}/> Manpower</div>
                        <div className="wsp-kpi-value">{formatNumber(grandTotals.headcount)} Org</div>
                        <div className="wsp-kpi-diff neutral">{formatNumber(grandTotals.hk, 1)} Total HK</div>
                    </div>
                </div>

                {/* Summary Table */}
                <div className="wsp-table-wrapper mb-8">
                    <table className="wsp-table productivity-table">
                        <thead>
                            <tr className="wsp-header-master">
                                <th rowSpan="2" className="th-sticky-col">DIVISI</th>
                                <th colSpan="2" className="th-group-manpower">MANPOWER</th>
                                <th colSpan="2" className="th-group-income">PRODUKSI & BIAYA</th>
                                <th colSpan="2" className="th-group-compare">RATIO / EFISIENSI</th>
                                <th rowSpan="2" className="no-print" style={{width: '50px'}}>AKSI</th>
                            </tr>
                            <tr className="wsp-header-sub">
                                <th className="th-group-manpower">Pekerja</th>
                                <th className="th-group-manpower">HK</th>
                                <th className="th-group-income">Tonase (Kg)</th>
                                <th className="th-group-income">Upah Bersih (Rp)</th>
                                <th className="th-group-compare">Rp / HK</th>
                                <th className="th-group-compare">Rp / Kg</th>
                            </tr>
                        </thead>
                        <tbody>
                            {divisionSummary.map((div, idx) => (
                                <tr key={idx} 
                                    className={selectedDivision === div.division_code ? 'row-selected' : 'row-hover'}
                                    onClick={() => setSelectedDivision(selectedDivision === div.division_code ? null : div.division_code)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <td className="text-center font-bold sticky-col">{div.division_code}</td>
                                    <td className="text-right">{formatNumber(div.headcount)}</td>
                                    <td className="text-right">{formatNumber(div.total_hk, 1)}</td>
                                    <td className="text-right font-semibold">{formatNumber(div.total_production, 2)}</td>
                                    <td className="text-right">Rp {formatNumber(div.total_wage)}</td>
                                    <td className="text-right">{formatNumber(div.total_hk > 0 ? div.total_wage / div.total_hk : 0)}</td>
                                    <td className={`text-right font-bold ${div.total_production > 0 && div.total_wage / div.total_production > 1000 ? 'text-red-600' : ''}`}>
                                        {formatNumber(div.total_production > 0 ? div.total_wage / div.total_production : 0, 2)}
                                    </td>
                                    <td className="text-center no-print">
                                        <button className="text-blue-600 hover:underline text-xs">Detail</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="wsp-grand-total">
                                <td className="text-right pr-4 sticky-col font-bold">TOTAL {estateType.toUpperCase()}</td>
                                <td className="text-right">{formatNumber(grandTotals.headcount)}</td>
                                <td className="text-right">{formatNumber(grandTotals.hk, 1)}</td>
                                <td className="text-right">{formatNumber(grandTotals.production, 2)}</td>
                                <td className="text-right">Rp {formatNumber(grandTotals.wage)}</td>
                                <td className="text-right">{formatNumber(grandTotals.hk > 0 ? grandTotals.wage / grandTotals.hk : 0)}</td>
                                <td className="text-right">{formatNumber(grandTotals.production > 0 ? grandTotals.wage / grandTotals.production : 0, 2)}</td>
                                <td className="no-print"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* Drill-down Detail Section */}
                {selectedDivision && (
                    <div className="wsp-detail-section mt-12 pt-8 border-t-2 border-slate-200">
                        <div className="flex justify-between items-end mb-6 no-print">
                            <div>
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <Users className="text-blue-700" /> Detail Karyawan Divisi: {selectedDivision}
                                </h3>
                                <p className="text-slate-500 text-sm">Analisis penggunaan Lembur dan Biaya Perorangan</p>
                            </div>
                            
                            {/* Detail Filters */}
                            <div className="flex gap-4 items-center bg-slate-50 p-4 rounded-lg border border-slate-200 shadow-sm">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cari Nama/NIK</label>
                                    <div className="relative">
                                        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input 
                                            type="text" 
                                            placeholder="Nama atau NIK..."
                                            value={detailFilters.searchName}
                                            onChange={e => setDetailFilters({...detailFilters, searchName: e.target.value})}
                                            className="wsp-input pl-8 py-1 text-sm border-slate-300 rounded"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Filter Lembur (Jam)</label>
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="range" 
                                            min="0" max="100" step="5"
                                            value={detailFilters.minOtHours}
                                            onChange={e => setDetailFilters({...detailFilters, minOtHours: parseInt(e.target.value)})}
                                            className="w-32 accent-blue-600"
                                        />
                                        <span className="font-bold text-blue-700 min-w-[40px] text-sm">{detailFilters.minOtHours}h+</span>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Gang</label>
                                    <select 
                                        value={detailFilters.gangCode}
                                        onChange={e => setDetailFilters({...detailFilters, gangCode: e.target.value})}
                                        className="wsp-select py-1 text-sm border-slate-300 rounded"
                                    >
                                        <option value="ALL">Semua Gang</option>
                                        {/* Dynamic gang list from detail data */}
                                        {[...new Set(detailData?.employees?.map(e => e.gang) || [])].sort().map(g => (
                                            <option key={g} value={g}>{g}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Print Header for Detail */}
                        <div className="only-print mb-4">
                            <h3 className="text-lg font-bold">DETAIL KARYAWAN DIVISI: {selectedDivision}</h3>
                            <p className="text-xs italic">Filter: Lembur ≥ {detailFilters.minOtHours} Jam | Total Data: {filteredEmployees.length}</p>
                        </div>

                        {detailLoading ? (
                            <div className="py-12 text-center text-slate-400 italic">Memuat data detail karyawan...</div>
                        ) : (
                            <div className="wsp-table-wrapper">
                                <table className="wsp-table detail-table">
                                    <thead>
                                        <tr className="wsp-header-sub">
                                            <th className="text-left">NIK</th>
                                            <th className="text-left">NAMA KARYAWAN</th>
                                            <th className="text-center">GANG</th>
                                            <th className="text-right">HK</th>
                                            <th className="text-right">PREMI</th>
                                            <th className={`text-right ${detailFilters.minOtHours > 0 ? 'bg-amber-50 font-bold text-amber-900' : ''}`}>LEMBUR (Jam)</th>
                                            <th className={`text-right ${detailFilters.minOtHours > 0 ? 'bg-amber-50 font-bold text-amber-900' : ''}`}>LEMBUR (Rp)</th>
                                            <th className="text-right">UPAH BERSIH</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredEmployees.length > 0 ? (
                                            filteredEmployees.map((emp, idx) => (
                                                <tr key={idx}>
                                                    <td className="text-left text-xs font-mono">{emp.new_nik || emp.nik}</td>
                                                    <td className="text-left font-semibold">{emp.name}</td>
                                                    <td className="text-center">{emp.gang}</td>
                                                    <td className="text-right">{formatNumber(emp.hk, 1)}</td>
                                                    <td className="text-right">{formatNumber(emp.premi)}</td>
                                                    <td className={`text-right font-bold ${emp.lembur_jam > 20 ? 'text-red-600' : emp.lembur_jam > 0 ? 'text-amber-600' : ''}`}>
                                                        {formatNumber(emp.lembur_jam, 1)}
                                                    </td>
                                                    <td className="text-right">{formatNumber(emp.lembur)}</td>
                                                    <td className="text-right font-bold text-blue-800">Rp {formatNumber(emp.upah_bersih)}</td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="8" className="py-8 text-center text-slate-400 italic">
                                                    Tidak ada karyawan yang memenuhi kriteria filter.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                    {filteredEmployees.length > 0 && (
                                        <tfoot>
                                            <tr className="bg-slate-50 font-bold">
                                                <td colSpan="3" className="text-right pr-4">SUB-TOTAL FILTERED ({filteredEmployees.length} Org)</td>
                                                <td className="text-right">{formatNumber(filteredEmployees.reduce((s, e) => s + e.hk, 0), 1)}</td>
                                                <td className="text-right">{formatNumber(filteredEmployees.reduce((s, e) => s + e.premi, 0))}</td>
                                                <td className="text-right">{formatNumber(filteredEmployees.reduce((s, e) => s + e.lembur_jam, 0), 1)}</td>
                                                <td className="text-right">{formatNumber(filteredEmployees.reduce((s, e) => s + e.lembur, 0))}</td>
                                                <td className="text-right text-blue-900">Rp {formatNumber(filteredEmployees.reduce((s, e) => s + e.upah_bersih, 0))}</td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Legend / Footer Notes */}
                <footer className="wsp-footer mt-12 text-[10px] text-slate-400 italic flex justify-between">
                    <div>
                        * Rp / Kg dihitung dari Total Upah Bersih / Total Tonase Produksi<br />
                        * Data dikelompokkan berdasarkan Estate dan Divisi Operasional
                    </div>
                    <div className="text-right">
                        Dicetak pada: {new Date().toLocaleString('id-ID')}<br />
                        Oleh: {user?.username || 'System Admin'}
                    </div>
                </footer>
            </div>

            {/* Custom Print Style */}
            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    @page { size: landscape; margin: 0.5cm; }
                    .wsp-container { padding: 0; }
                    .wsp-document { box-shadow: none; border: none; max-width: none; width: 100%; }
                    .no-print { display: none !important; }
                    .only-print { display: block !important; }
                    .wsp-table { font-size: 8pt !important; }
                    .wsp-kpi-card { border: 1px solid #ddd !important; padding: 0.5rem !important; }
                    .wsp-kpi-value { font-size: 14pt !important; }
                    .row-selected { background-color: #f1f5f9 !important; -webkit-print-color-adjust: exact; }
                    .bg-amber-50 { background-color: #fffbeb !important; -webkit-print-color-adjust: exact; }
                    .text-red-600 { color: #dc2626 !important; }
                    .text-blue-800 { color: #1e40af !important; }
                }
                .only-print { display: none; }
                .row-selected { background-color: #f1f5f9; border-left: 4px solid #3b82f6; }
                .row-hover:hover { background-color: #f8fafc; }
            `}} />
        </div>
    );
}
