import React, { useState, useEffect, useRef } from 'react';
import { getMillProductionSummary } from '../services/millProductionService';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, ComposedChart, Line
} from 'recharts';
import { Calendar, Scale, RefreshCw, Users, DollarSign, TrendingUp, Printer } from 'lucide-react';
import ReportWatermark from '../components/common/ReportWatermark';
import { printReport } from '../utils/printPageSetup';
import './MillProductionReport.css';
import '../styles/report-print-foundation.css';

const MillProductionReport = () => {
    const [month, setMonth] = useState('2');
    const [year, setYear] = useState('2026');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Month-over-Month comparison state
    const [compareMode, setCompareMode] = useState(false);
    const [prevMonth, setPrevMonth] = useState('1');
    const [prevYear, setPrevYear] = useState('2026');
    const [prevData, setPrevData] = useState([]);
    const [loadingPrev, setLoadingPrev] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getMillProductionSummary(parseInt(month), parseInt(year));
            setData(result);
        } catch (err) {
            setError(err.message || 'Terjadi kesalahan saat mengambil data');
            setData([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchPrevData = async () => {
        setLoadingPrev(true);
        try {
            const result = await getMillProductionSummary(parseInt(prevMonth), parseInt(prevYear));
            setPrevData(result);
        } catch (err) {
            console.error('Error fetching previous period data:', err);
            setPrevData([]);
        } finally {
            setLoadingPrev(false);
        }
    };

    useEffect(() => {
        fetchData();
        if (compareMode) fetchPrevData();
    }, [month, year, prevMonth, prevYear, compareMode]);

    const handlePrint = () => printReport({ orientation: 'landscape' });

    // Month helpers
    const monthName = (m) => new Date(0, parseInt(m) - 1).toLocaleString('id-ID', { month: 'long' });
    const currentMonthName = monthName(month);
    const prevMonthName = monthName(prevMonth);

    // Helper: merge current and previous data for comparison
    const getMergedRow = (curr, prev) => {
        if (!curr && !prev) return null;
        const c = curr || {};
        const p = prev || {};
        const deltaTon = (c.total_ffb_ton || 0) - (p.total_ffb_ton || 0);
        const deltaPercent = (p.total_ffb_ton || 0) > 0 ? (deltaTon / (p.total_ffb_ton || 1)) * 100 : 0;
        return {
            ...c,
            prev_ton: p.total_ffb_ton || 0,
            prev_hk: p.total_hk || 0,
            prev_upah: p.total_upah_bersih || 0,
            prev_premi: p.total_premi || 0,
            prev_lembur: p.total_lembur || 0,
            prev_employees: p.total_employees || 0,
            delta_ton: deltaTon,
            delta_ton_pct: deltaPercent,
            delta_hk: (c.total_hk || 0) - (p.total_hk || 0),
            delta_upah: (c.total_upah_bersih || 0) - (p.total_upah_bersih || 0),
            delta_premi: (c.total_premi || 0) - (p.total_premi || 0),
            delta_lembur: (c.total_lembur || 0) - (p.total_lembur || 0),
        };
    };

    // Build merged comparison data aligned by division
    const mergedData = compareMode ? data.map(row => {
        const prevRow = prevData.find(p => p.division_code === row.division_code) || {};
        return getMergedRow(row, prevRow);
    }) : [];

    // Summaries
    const totalTonnage = data.reduce((a, c) => a + (c.total_ffb_ton || 0), 0);
    const totalHK = data.reduce((a, c) => a + (c.total_hk || 0), 0);
    const totalCost = data.reduce((a, c) => a + (c.total_upah_bersih || 0), 0);
    const totalPremi = data.reduce((a, c) => a + (c.total_premi || 0), 0);
    const totalLembur = data.reduce((a, c) => a + (c.total_lembur || 0), 0);
    const totalEmployees = data.reduce((a, c) => a + (c.total_employees || 0), 0);
    const avgTonPerHK = totalHK > 0 ? totalTonnage / totalHK : 0;
    const avgCostPerTon = totalTonnage > 0 ? totalCost / totalTonnage : 0;

    const fmt = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n || 0);
    const fmtCur = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n || 0);

    return (
        <div className="mill-report-container">
            <ReportWatermark />
            {/* Header */}
            <div className="mill-report-header no-print">
                <div>
                    <h1 className="mill-report-title">Analisis Produktivitas Kebun</h1>
                    <p className="mill-report-subtitle">
                        {compareMode
                            ? `Perbandingan ${prevMonthName} ${prevYear} vs ${currentMonthName} ${year}`
                            : `Tonase FFB, HK, dan biaya upah per divisi — ${currentMonthName} ${year}`}
                    </p>
                </div>
                <div className="mill-report-controls">
                    {compareMode && (
                        <div className="mom-period-selectors">
                            <span className="mom-vs-label">vs</span>
                            <div className="control-group">
                                <Calendar size={18} className="control-icon" />
                                <select value={prevMonth} onChange={e => setPrevMonth(e.target.value)} className="month-select">
                                    {[...Array(12).keys()].map(i => (
                                        <option key={i + 1} value={i + 1}>{new Date(0, i).toLocaleString('id-ID', { month: 'long' })}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="control-group">
                                <select value={prevYear} onChange={e => setPrevYear(e.target.value)} className="year-select">
                                    {[2024, 2025, 2026, 2027].map(y => (<option key={y} value={y}>{y}</option>))}
                                </select>
                            </div>
                        </div>
                    )}
                    <div className="control-group">
                        <Calendar size={18} className="control-icon" />
                        <select value={month} onChange={e => setMonth(e.target.value)} className="month-select">
                            {[...Array(12).keys()].map(i => (
                                <option key={i + 1} value={i + 1}>{new Date(0, i).toLocaleString('id-ID', { month: 'long' })}</option>
                            ))}
                        </select>
                    </div>
                    <div className="control-group">
                        <select value={year} onChange={e => setYear(e.target.value)} className="year-select">
                            {[2024, 2025, 2026, 2027].map(y => (<option key={y} value={y}>{y}</option>))}
                        </select>
                    </div>
                    <button onClick={fetchData} className="refresh-button" disabled={loading}>
                        <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
                    </button>
                    <button onClick={() => setCompareMode(!compareMode)} className="compare-toggle-btn">
                        {compareMode ? 'Single Month' : 'Compare Months'}
                    </button>
                    <button onClick={handlePrint} className="print-button" disabled={loading || data.length === 0}>
                        <Printer size={16} /> Print
                    </button>
                </div>
            </div>

            {/* Print Header */}
            <div className="print-header print-only">
                <h1>PT REBINMAS JAYA</h1>
                <h2>Analisis Produktivitas Kebun</h2>
                <p>Periode: {currentMonthName} {year}{compareMode ? ` vs ${prevMonthName} ${prevYear}` : ''}</p>
            </div>

            {error && <div className="error-banner no-print">{error}</div>}

            {!error && !loading && (
                <>
                    {/* KPI Cards */}
                    <div className="mill-summary-cards no-print">
                        {compareMode ? (
                            <>
                                {/* Comparison KPIs */}
                                {(() => {
                                    const prevTotalTon = prevData.reduce((a, c) => a + (c.total_ffb_ton || 0), 0);
                                    const prevTotalHK = prevData.reduce((a, c) => a + (c.total_hk || 0), 0);
                                    const prevTotalCost = prevData.reduce((a, c) => a + (c.total_upah_bersih || 0), 0);
                                    const prevTotalEmp = prevData.reduce((a, c) => a + (c.total_employees || 0), 0);
                                    const prevAvgTonHK = prevTotalHK > 0 ? prevTotalTon / prevTotalHK : 0;
                                    const prevCostPerTon = prevTotalTon > 0 ? prevTotalCost / prevTotalTon : 0;

                                    const deltaTon = totalTonnage - prevTotalTon;
                                    const deltaTonPct = prevTotalTon > 0 ? (deltaTon / prevTotalTon) * 100 : 0;
                                    const deltaHK = totalHK - prevTotalHK;
                                    const deltaCost = totalCost - prevTotalCost;
                                    const deltaCostPct = prevTotalCost > 0 ? (deltaCost / prevTotalCost) * 100 : 0;

                                    const DeltaCard = ({ label, cur, prev, delta, deltaPct, unit, formatFn }) => {
                                        const isPositive = delta >= 0;
                                        return (
                                            <div className="mom-kpi-card">
                                                <div className="mom-kpi-current">
                                                    <span className="mom-kpi-label">Current</span>
                                                    <span className="mom-kpi-value">{formatFn ? formatFn(cur) : fmt(cur)} <span className="mom-kpi-unit">{unit}</span></span>
                                                </div>
                                                <div className="mom-kpi-prev">
                                                    <span className="mom-kpi-label">Prev</span>
                                                    <span className="mom-kpi-value-prev">{formatFn ? formatFn(prev) : fmt(prev)} <span className="mom-kpi-unit">{unit}</span></span>
                                                </div>
                                                <div className={`mom-kpi-delta ${isPositive ? 'positive' : 'negative'}`}>
                                                    <span className="mom-kpi-delta-val">{isPositive ? '+' : ''}{formatFn ? formatFn(delta) : fmt(delta)}</span>
                                                    <span className="mom-kpi-delta-pct">{isPositive ? '+' : ''}{deltaPct.toFixed(1)}%</span>
                                                    <span className="mom-kpi-trend">{isPositive ? '▲' : '▼'}</span>
                                                </div>
                                            </div>
                                        );
                                    };

                                    return (
                                        <>
                                            <DeltaCard label="Tonase FFB" cur={totalTonnage} prev={prevTotalTon} delta={deltaTon} deltaPct={deltaTonPct} unit="Ton" />
                                            <DeltaCard label="Total HK" cur={totalHK} prev={prevTotalHK} delta={deltaHK} deltaPct={0} unit="HK" />
                                            <DeltaCard label="Biaya Upah" cur={totalCost} prev={prevTotalCost} delta={deltaCost} deltaPct={deltaCostPct} unit="" formatFn={fmtCur} />
                                            <DeltaCard label="Efisiensi" cur={avgTonPerHK} prev={prevAvgTonHK} delta={avgTonPerHK - prevAvgTonHK} deltaPct={prevAvgTonHK > 0 ? ((avgTonPerHK - prevAvgTonHK) / prevAvgTonHK) * 100 : 0} unit="Ton/HK" />
                                        </>
                                    );
                                })()}
                            </>
                        ) : (
                            <>
                                {/* Single Month KPIs */}
                                <div className="summary-card var-green">
                                    <div className="card-icon-wrapper"><Scale size={24} /></div>
                                    <div className="card-content">
                                        <h3>Total Tonase FFB</h3>
                                        <p className="card-value">{fmt(totalTonnage)} <span className="unit">Ton</span></p>
                                    </div>
                                </div>
                                <div className="summary-card var-amber">
                                    <div className="card-icon-wrapper"><Users size={24} /></div>
                                    <div className="card-content">
                                        <h3>Tenaga Kerja</h3>
                                        <p className="card-value">{fmt(totalHK)} <span className="unit">HK</span></p>
                                        <p className="card-subvalue">{fmt(totalEmployees)} karyawan</p>
                                    </div>
                                </div>
                                <div className="summary-card var-red">
                                    <div className="card-icon-wrapper"><DollarSign size={24} /></div>
                                    <div className="card-content">
                                        <h3>Total Biaya Upah</h3>
                                        <p className="card-value" style={{ fontSize: '1.35rem' }}>{fmtCur(totalCost)}</p>
                                    </div>
                                </div>
                                <div className="summary-card var-purple">
                                    <div className="card-icon-wrapper"><TrendingUp size={24} /></div>
                                    <div className="card-content">
                                        <h3>Efisiensi</h3>
                                        <p className="card-value">{fmt(avgTonPerHK)} <span className="unit">Ton/HK</span></p>
                                        <p className="card-subvalue">{fmtCur(avgCostPerTon)} / Ton</p>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Charts - hidden in print */}
                    <div className="mill-charts-grid no-print">
                        {compareMode ? (
                            <>
                                {/* Comparison Chart: Tonase both periods */}
                                <div className="chart-panel">
                                    <h3 className="chart-title">Perbandingan Tonase FFB: {currentMonthName} {year} vs {prevMonthName} {prevYear}</h3>
                                    <ResponsiveContainer width="100%" height={360}>
                                        <ComposedChart data={mergedData} margin={{ top: 20, right: 40, left: 20, bottom: 60 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                            <XAxis dataKey="division_code" tick={{ fill: '#6b7280', fontSize: 13, fontWeight: 600 }} />
                                            <YAxis yAxisId="left" tick={{ fill: '#10b981', fontSize: 12 }} label={{ value: 'Ton', angle: -90, position: 'insideLeft', fill: '#10b981' }} />
                                            <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                                formatter={(v, name) => name.includes('Cur') ? [fmt(v) + ' Ton', name] : [fmt(v) + ' Ton', name]} />
                                            <Legend />
                                            <Bar yAxisId="left" dataKey="total_ffb_ton" name={`${currentMonthName} ${year}`} radius={[4, 4, 0, 0]} fill="#10b981" />
                                            <Bar yAxisId="left" dataKey="prev_ton" name={`${prevMonthName} ${prevYear}`} radius={[4, 4, 0, 0]} fill="#94a3b8" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                                {/* Comparison Chart: Delta per division */}
                                <div className="chart-panel">
                                    <h3 className="chart-title">Perubahan Tonase per Divisi (Δ Ton)</h3>
                                    <ResponsiveContainer width="100%" height={360}>
                                        <ComposedChart data={mergedData} margin={{ top: 20, right: 40, left: 20, bottom: 60 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                            <XAxis dataKey="division_code" tick={{ fill: '#6b7280', fontSize: 13, fontWeight: 600 }} />
                                            <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} label={{ value: 'Δ Ton', angle: -90, position: 'insideLeft', fill: '#6b7280' }} />
                                            <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                                formatter={(v, name) => [fmt(v) + ' Ton', name]} />
                                            <Legend />
                                            <Bar dataKey="delta_ton" name="Δ Tonase" radius={[4, 4, 0, 0]} fill="#10b981" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Single Month Charts */}
                                <div className="chart-panel">
                                    <h3 className="chart-title">Tonase FFB vs Hari Kerja (HK) per Divisi</h3>
                                    <ResponsiveContainer width="100%" height={360}>
                                        <ComposedChart data={data} margin={{ top: 20, right: 40, left: 20, bottom: 60 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                            <XAxis dataKey="division_code" tick={{ fill: '#6b7280', fontSize: 13, fontWeight: 600 }} />
                                            <YAxis yAxisId="left" tick={{ fill: '#10b981', fontSize: 12 }} label={{ value: 'Ton', angle: -90, position: 'insideLeft', fill: '#10b981' }} />
                                            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#f59e0b', fontSize: 12 }} label={{ value: 'HK', angle: 90, position: 'insideRight', fill: '#f59e0b' }} />
                                            <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                                formatter={(v, name) => name === 'Tonase (Ton)' ? [fmt(v) + ' Ton', name] : [fmt(v), name]} />
                                            <Legend />
                                            <Bar yAxisId="left" dataKey="total_ffb_ton" name="Tonase (Ton)" radius={[4, 4, 0, 0]} fill="#10b981" />
                                            <Bar yAxisId="right" dataKey="total_hk" name="HK" radius={[4, 4, 0, 0]} fill="#f59e0b" opacity={0.75} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="chart-panel">
                                    <h3 className="chart-title">Biaya per Ton & Produktivitas (Ton/HK)</h3>
                                    <ResponsiveContainer width="100%" height={360}>
                                        <ComposedChart data={data} margin={{ top: 20, right: 40, left: 20, bottom: 60 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                            <XAxis dataKey="division_code" tick={{ fill: '#6b7280', fontSize: 13, fontWeight: 600 }} />
                                            <YAxis yAxisId="left" tick={{ fill: '#ef4444', fontSize: 12 }} label={{ value: 'Rp/Ton', angle: -90, position: 'insideLeft', fill: '#ef4444' }} />
                                            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#8b5cf6', fontSize: 12 }} label={{ value: 'Ton/HK', angle: 90, position: 'insideRight', fill: '#8b5cf6' }} />
                                            <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                                formatter={(v, name) => name === 'Biaya / Ton' ? [fmtCur(v), name] : [fmt(v), name]} />
                                            <Legend />
                                            <Bar yAxisId="left" dataKey="cost_per_ton" name="Biaya / Ton" radius={[4, 4, 0, 0]} fill="#ef4444" opacity={0.8} />
                                            <Line yAxisId="right" type="monotone" dataKey="ton_per_hk" name="Ton / HK" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 5, fill: '#8b5cf6' }} activeDot={{ r: 7 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Data Table - shown in print */}
                    <div className="mill-data-table-container">
                        <h3 className="table-title">
                            {compareMode
                                ? `Detail Perbandingan: ${prevMonthName} ${prevYear} vs ${currentMonthName} ${year}`
                                : 'Detail Analisis Produktivitas per Divisi'}
                        </h3>
                        <div className="table-wrapper">
                            <table className="mill-data-table">
                                <thead>
                                    <tr>
                                        <th>No</th>
                                        <th>Divisi</th>
                                        {compareMode ? (
                                            <>
                                                <th className="text-right">Pekerja</th>
                                                <th className="text-right">HK Prev</th>
                                                <th className="text-right">HK Cur</th>
                                                <th className="text-right">Δ HK</th>
                                                <th className="text-right">Ton Prev</th>
                                                <th className="text-right">Ton Cur</th>
                                                <th className="text-right">Δ Ton</th>
                                                <th className="text-right">Δ %</th>
                                                <th className="text-right">Trend</th>
                                            </>
                                        ) : (
                                            <>
                                                <th className="text-right">Pekerja</th>
                                                <th className="text-right">HK</th>
                                                <th className="text-right">Tonase (Ton)</th>
                                                <th className="text-right">Total Upah</th>
                                                <th className="text-right">Premi</th>
                                                <th className="text-right">Lembur</th>
                                                <th className="text-right">Ton/HK</th>
                                                <th className="text-right">Biaya/Ton</th>
                                                <th className="text-right">%</th>
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {compareMode ? (
                                        mergedData.map((row, idx) => (
                                            <tr key={idx}>
                                                <td className="text-center">{idx + 1}</td>
                                                <td className="font-semibold">{row.division_code}</td>
                                                <td className="text-right">{fmt(row.prev_employees)}</td>
                                                <td className="text-right text-gray-500">{fmt(row.prev_hk)}</td>
                                                <td className="text-right text-amber-600 font-semibold">{fmt(row.total_hk)}</td>
                                                <td className={`text-right font-semibold ${row.delta_hk >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {row.delta_hk >= 0 ? '+' : ''}{fmt(row.delta_hk)}
                                                </td>
                                                <td className="text-right text-gray-500">{fmt(row.prev_ton)}</td>
                                                <td className="text-right font-semibold text-emerald-600">{fmt(row.total_ffb_ton)}</td>
                                                <td className={`text-right font-semibold ${row.delta_ton >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {row.delta_ton >= 0 ? '+' : ''}{fmt(row.delta_ton)}
                                                </td>
                                                <td className={`text-right font-semibold ${row.delta_ton_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {row.delta_ton_pct >= 0 ? '+' : ''}{row.delta_ton_pct.toFixed(1)}%
                                                </td>
                                                <td className="text-center">
                                                    <span className={`mom-trend-badge ${row.delta_ton >= 0 ? 'up' : 'down'}`}>
                                                        {row.delta_ton >= 0 ? '▲' : '▼'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        data.map((row, idx) => (
                                            <tr key={idx}>
                                                <td className="text-center">{idx + 1}</td>
                                                <td className="font-semibold">{row.division_code}</td>
                                                <td className="text-right">{fmt(row.total_employees)}</td>
                                                <td className="text-right text-amber-600 font-semibold">{fmt(row.total_hk)}</td>
                                                <td className="text-right font-semibold text-emerald-600">{fmt(row.total_ffb_ton)}</td>
                                                <td className="text-right">{fmtCur(row.total_upah_bersih)}</td>
                                                <td className="text-right">{fmtCur(row.total_premi)}</td>
                                                <td className="text-right">{fmtCur(row.total_lembur)}</td>
                                                <td className="text-right font-semibold text-purple-600">{fmt(row.ton_per_hk)}</td>
                                                <td className="text-right text-red-600">{fmtCur(row.cost_per_ton)}</td>
                                                <td className="text-right text-gray-500">
                                                    {totalTonnage > 0 ? ((row.total_ffb_ton / totalTonnage) * 100).toFixed(1) + '%' : '-'}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                    {(data.length === 0 || mergedData.length === 0) && (
                                        <tr><td colSpan={compareMode ? 11 : 11} className="text-center" style={{ padding: '2rem', color: '#9ca3af' }}>Tidak ada data.</td></tr>
                                    )}
                                </tbody>
                                {compareMode ? (
                                    mergedData.length > 0 && (() => {
                                        const prevTotalTon = prevData.reduce((a, c) => a + (c.total_ffb_ton || 0), 0);
                                        const prevTotalHK = prevData.reduce((a, c) => a + (c.total_hk || 0), 0);
                                        const deltaTotalTon = totalTonnage - prevTotalTon;
                                        const deltaTotalHK = totalHK - prevTotalHK;
                                        const deltaTotalTonPct = prevTotalTon > 0 ? (deltaTotalTon / prevTotalTon) * 100 : 0;
                                        return (
                                            <tfoot>
                                                <tr className="font-bold bg-gray-50">
                                                    <td colSpan="2" className="text-right">TOTAL</td>
                                                    <td className="text-right">{fmt(totalEmployees)}</td>
                                                    <td className="text-right text-gray-600">{fmt(prevTotalHK)}</td>
                                                    <td className="text-right text-amber-700">{fmt(totalHK)}</td>
                                                    <td className={`text-right ${deltaTotalHK >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                                        {deltaTotalHK >= 0 ? '+' : ''}{fmt(deltaTotalHK)}
                                                    </td>
                                                    <td className="text-right text-gray-600">{fmt(prevTotalTon)}</td>
                                                    <td className="text-right text-emerald-700">{fmt(totalTonnage)}</td>
                                                    <td className={`text-right ${deltaTotalTon >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                                        {deltaTotalTon >= 0 ? '+' : ''}{fmt(deltaTotalTon)}
                                                    </td>
                                                    <td className={`text-right ${deltaTotalTonPct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                                        {deltaTotalTonPct >= 0 ? '+' : ''}{deltaTotalTonPct.toFixed(1)}%
                                                    </td>
                                                    <td className="text-center">
                                                        <span className={`mom-trend-badge ${deltaTotalTon >= 0 ? 'up' : 'down'}`}>
                                                            {deltaTotalTon >= 0 ? '▲' : '▼'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        );
                                    })()
                                ) : (
                                    data.length > 0 && (
                                        <tfoot>
                                            <tr className="font-bold bg-gray-50">
                                                <td colSpan="2" className="text-right">TOTAL</td>
                                                <td className="text-right">{fmt(totalEmployees)}</td>
                                                <td className="text-right text-amber-700">{fmt(totalHK)}</td>
                                                <td className="text-right text-emerald-700">{fmt(totalTonnage)}</td>
                                                <td className="text-right">{fmtCur(totalCost)}</td>
                                                <td className="text-right">{fmtCur(totalPremi)}</td>
                                                <td className="text-right">{fmtCur(totalLembur)}</td>
                                                <td className="text-right text-purple-700">{fmt(avgTonPerHK)}</td>
                                                <td className="text-right text-red-700">{fmtCur(avgCostPerTon)}</td>
                                                <td className="text-right">100%</td>
                                            </tr>
                                        </tfoot>
                                    )
                                )}
                            </table>
                        </div>
                    </div>

                    {/* Print Summary */}
                    <div className="print-summary print-only">
                        <div className="print-summary-row">
                            <span>Total Tonase FFB:</span><strong>{fmt(totalTonnage)} Ton</strong>
                        </div>
                        {compareMode && (
                            <div className="print-summary-row">
                                <span>vs {prevMonthName} {prevYear}:</span><strong>{fmt(prevData.reduce((a, c) => a + (c.total_ffb_ton || 0), 0))} Ton</strong>
                            </div>
                        )}
                        <div className="print-summary-row">
                            <span>Total HK:</span><strong>{fmt(totalHK)}</strong>
                        </div>
                        <div className="print-summary-row">
                            <span>Total Biaya Upah:</span><strong>{fmtCur(totalCost)}</strong>
                        </div>
                        <div className="print-summary-row">
                            <span>Rata-rata Ton/HK:</span><strong>{fmt(avgTonPerHK)}</strong>
                        </div>
                        <div className="print-summary-row">
                            <span>Rata-rata Biaya/Ton:</span><strong>{fmtCur(avgCostPerTon)}</strong>
                        </div>
                    </div>
                </>
            )}

            {loading && (
                <div className="loading-state no-print">
                    <div className="spinner"></div>
                    <p>Mengambil data produktivitas kebun...</p>
                </div>
            )}
        </div>
    );
};

export default MillProductionReport;
