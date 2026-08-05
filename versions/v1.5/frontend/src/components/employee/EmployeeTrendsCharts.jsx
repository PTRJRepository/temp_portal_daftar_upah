/**
 * EmployeeTrendsCharts Component
 *
 * Displays charts showing an employee's salary trends over time
 * Includes line charts, stacked area charts, and bar charts
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getEmployeeHistory, formatMonthName } from '../../services/historyService';
import './EmployeeTrendsCharts.css';

export function EmployeeTrendsCharts({ empCode }) {
    const { token } = useAuth();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    useEffect(() => {
        async function loadHistory() {
            if (!token || !empCode) {
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const response = await getEmployeeHistory(token, empCode);
                if (response.success) {
                    // Sort by period ascending for charts
                    const sorted = [...response.data].sort((a, b) => {
                        const periodA = a.period_year * 100 + a.period_month;
                        const periodB = b.period_year * 100 + b.period_month;
                        return periodA - periodB;
                    });
                    setHistory(sorted);
                } else {
                    setError(response.error || 'Failed to load history');
                }
            } catch (err) {
                console.error('[EmployeeTrendsCharts] Error:', err);
                setError(err.message || 'Failed to load history');
            } finally {
                setLoading(false);
            }
        }

        loadHistory();
    }, [token, empCode]);

    // Prepare chart data
    const chartData = history.map(r => ({
        period: `${r.period_month}/${r.period_year}`,
        periodLabel: formatMonthName(r.period_month),
        year: r.period_year,
        month: r.period_month,
        hk: r.jumlah_hk || 0,
        hari_kerja: r.hari_kerja || 0,
        gajiPokok: r.gaji_pokok || 0,
        tunjanganBeras: r.beras_jumlah || 0,
        tunjanganJabatan: r.jabatan_jumlah || 0,
        tunjanganMasaKerja: r.masa_kerja_jumlah || 0,
        totalTunjangan: (r.beras_jumlah || 0) + (r.jabatan_jumlah || 0) + (r.masa_kerja_jumlah || 0),
        lemburJam: r.lembur_jam || 0,
        lemburJumlah: r.lembur_jumlah || 0,
        premiBrondol: r.premi_brondol || 0,
        totalPremi: r.total_premi || 0,
        totalPotongan: r.total_potongan || 0,
        upahKotor: r.jumlah_upah_kotor || 0,
        upahBersih: r.upah_bersih || 0
    }));

    // Calculate totals and averages
    const stats = {
        avgHK: chartData.length > 0 ? chartData.reduce((sum, d) => sum + d.hk, 0) / chartData.length : 0,
        avgUpahBersih: chartData.length > 0 ? chartData.reduce((sum, d) => sum + d.upahBersih, 0) / chartData.length : 0,
        totalUpahBersih: chartData.reduce((sum, d) => sum + d.upahBersih, 0),
        maxUpahBersih: chartData.length > 0 ? Math.max(...chartData.map(d => d.upahBersih)) : 0,
        minUpahBersih: chartData.length > 0 ? Math.min(...chartData.map(d => d.upahBersih)) : 0
    };

    if (loading) {
        return (
            <div className="employee-trends-charts loading">
                <div className="spinner"></div>
                <p>Memuat data tren...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="employee-trends-charts error">
                <p>❌ {error}</p>
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <div className="employee-trends-charts empty">
                <p>Tidak ada data tren tersedia</p>
            </div>
        );
    }

    return (
        <div className="employee-trends-charts">
            <div className="trends-header">
                <h3>📈 Tren Gaji & Komponen</h3>
                <div className="trends-tabs">
                    <button
                        className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                        onClick={() => setActiveTab('overview')}
                    >
                        Ringkasan
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'upah' ? 'active' : ''}`}
                        onClick={() => setActiveTab('upah')}
                    >
                        Upah Bersih
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'komponen' ? 'active' : ''}`}
                        onClick={() => setActiveTab('komponen')}
                    >
                        Komponen
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'hk' ? 'active' : ''}`}
                        onClick={() => setActiveTab('hk')}
                    >
                        HK & Lembur
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="trends-stats-grid">
                <div className="stat-card">
                    <span className="stat-label">Rata-rata Upah Bersih</span>
                    <span className="stat-value">{formatCurrency(stats.avgUpahBersih)}</span>
                </div>
                <div className="stat-card">
                    <span className="stat-label">Rata-rata HK</span>
                    <span className="stat-value">{stats.avgHK.toFixed(1)}</span>
                </div>
                <div className="stat-card">
                    <span className="stat-label">Tertinggi</span>
                    <span className="stat-value">{formatCurrency(stats.maxUpahBersih)}</span>
                </div>
                <div className="stat-card">
                    <span className="stat-label">Terendah</span>
                    <span className="stat-value">{formatCurrency(stats.minUpahBersih)}</span>
                </div>
            </div>

            {/* Charts */}
            {activeTab === 'overview' && <OverviewChart chartData={chartData} />}
            {activeTab === 'upah' && <UpahBersihChart chartData={chartData} />}
            {activeTab === 'komponen' && <KomponenChart chartData={chartData} />}
            {activeTab === 'hk' && <HKLemburChart chartData={chartData} />}
        </div>
    );
}

// Simple Bar Chart Component
function SimpleBarChart({ data, dataKey, label, color }) {
    const maxValue = Math.max(...data.map(d => d[dataKey]));
    const minValue = Math.min(...data.map(d => d[dataKey]));

    return (
        <div className="simple-bar-chart">
            <div className="chart-header">
                <span className="chart-title">{label}</span>
                <div className="chart-legend">
                    <span className="legend-item">
                        <span className="legend-color" style={{ background: color }}></span>
                        <span className="legend-label">{label}</span>
                    </span>
                </div>
            </div>
            <div className="chart-bars">
                {data.map((d, i) => {
                    const value = d[dataKey];
                    const height = maxValue > 0 ? (value / maxValue) * 100 : 0;
                    return (
                        <div key={i} className="bar-item">
                            <div className="bar-container">
                                <div
                                    className="bar"
                                    style={{ height: `${height}%`, background: color }}
                                    title={`${d.period}: ${formatCurrency(value)}`}
                                >
                                    <span className="bar-value">
                                        {dataKey === 'hk' || dataKey === 'lemburJam' || dataKey === 'hari_kerja'
                                            ? value.toFixed(1)
                                            : formatCurrency(value, true)}
                                    </span>
                                </div>
                            </div>
                            <span className="bar-label">{d.period}</span>
                        </div>
                    );
                })}
            </div>
            <div className="chart-footer">
                <span className="min-label">{formatCurrency(minValue, true)}</span>
                <span className="max-label">{formatCurrency(maxValue, true)}</span>
            </div>
        </div>
    );
}

// Line-style Bar Chart for trends
function TrendBarChart({ data, datasets }) {
    const allValues = datasets.flatMap(ds => data.map(d => d[ds.dataKey]));
    const maxValue = Math.max(...allValues, 1);

    return (
        <div className="trend-bar-chart">
            <div className="chart-header">
                <span className="chart-title">Tren Periode</span>
                <div className="chart-legend">
                    {datasets.map((ds, i) => (
                        <span key={i} className="legend-item">
                            <span className="legend-color" style={{ background: ds.color }}></span>
                            <span className="legend-label">{ds.label}</span>
                        </span>
                    ))}
                </div>
            </div>
            <div className="trend-bars-container">
                {data.map((d, i) => (
                    <div key={i} className="trend-bar-item">
                        <span className="trend-period-label">{d.period}</span>
                        <div className="trend-bars">
                            {datasets.map((ds, j) => {
                                const value = d[ds.dataKey];
                                const width = maxValue > 0 ? (value / maxValue) * 100 : 0;
                                return (
                                    <div key={j} className="trend-bar-row">
                                        <span className="trend-bar-label">{ds.shortLabel}</span>
                                        <div className="trend-bar-wrapper">
                                            <div
                                                className="trend-bar"
                                                style={{ width: `${width}%`, background: ds.color }}
                                                title={`${ds.label}: ${formatCurrency(value)}`}
                                            >
                                                {width > 15 && (
                                                    <span className="trend-bar-value">
                                                        {formatCurrency(value, true)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Overview Chart
function OverviewChart({ chartData }) {
    const datasets = [
        { label: 'Gaji Pokok', dataKey: 'gajiPokok', color: '#3b82f6', shortLabel: 'GP' },
        { label: 'Tunjangan', dataKey: 'totalTunjangan', color: '#10b981', shortLabel: 'TJ' },
        { label: 'Lembur', dataKey: 'lemburJumlah', color: '#f59e0b', shortLabel: 'LB' },
        { label: 'Upah Bersih', dataKey: 'upahBersih', color: '#8b5cf6', shortLabel: 'UB' }
    ];

    return (
        <div className="chart-section">
            <TrendBarChart data={chartData} datasets={datasets} />
        </div>
    );
}

// Upah Bersih Chart
function UpahBersihChart({ chartData }) {
    return (
        <div className="chart-section">
            <SimpleBarChart
                data={chartData}
                dataKey="upahBersih"
                label="Upah Bersih"
                color="#8b5cf6"
            />
        </div>
    );
}

// Komponen Chart
function KomponenChart({ chartData }) {
    const datasets = [
        { label: 'Gaji Pokok', dataKey: 'gajiPokok', color: '#3b82f6', shortLabel: 'GP' },
        { label: 'Tunj. Beras', dataKey: 'tunjanganBeras', color: '#10b981', shortLabel: 'TB' },
        { label: 'Tunj. Jabatan', dataKey: 'tunjanganJabatan', color: '#059669', shortLabel: 'TJ' },
        { label: 'Lembur', dataKey: 'lemburJumlah', color: '#f59e0b', shortLabel: 'LB' },
        { label: 'Premi', dataKey: 'totalPremi', color: '#ef4444', shortLabel: 'PM' }
    ];

    return (
        <div className="chart-section">
            <TrendBarChart data={chartData} datasets={datasets} />
        </div>
    );
}

// HK & Lembur Chart
function HKLemburChart({ chartData }) {
    const datasets = [
        { label: 'Hari Kerja', dataKey: 'hari_kerja', color: '#3b82f6', shortLabel: 'HK' },
        { label: 'Jumlah HK', dataKey: 'hk', color: '#10b981', shortLabel: 'JHK' },
        { label: 'Jam Lembur', dataKey: 'lemburJam', color: '#f59e0b', shortLabel: 'JL' }
    ];

    return (
        <div className="chart-section">
            <TrendBarChart data={chartData} datasets={datasets} />
        </div>
    );
}

// Helper function for currency formatting
function formatCurrency(value, short = false) {
    if (value === null || value === undefined) return '-';
    if (short && value >= 1000000) {
        return (value / 1000000).toFixed(1) + 'jt';
    }
    if (short && value >= 1000) {
        return (value / 1000).toFixed(0) + 'rb';
    }
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

export default EmployeeTrendsCharts;
