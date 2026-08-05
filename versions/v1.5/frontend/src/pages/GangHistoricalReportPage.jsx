/**
 * GangHistoricalReportPage
 *
 * Displays historical payroll report for a gang
 * Automatically switches to history mode when viewing historical periods
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePeriodInfo } from '../hooks/useCurrentPeriod';
import { getGangHistoryForPeriod, getCurrentPeriod, fetchPayrollHistory, formatMonthName, formatCurrency } from '../services/historyService';
import MonthPicker from '../components/common/MonthPicker';
import LoadingScreen from '../components/common/LoadingScreen';
import { CurrentPeriodBadge } from '../components/common/CurrentPeriodBadge';
import './GangHistoricalReportPage.css';

export default function GangHistoricalReportPage({ division, gangCode: initialGangCode, onBack }) {
    const { token } = useAuth();
    const [selectedGang, setSelectedGang] = useState(initialGangCode || 'ALL');
    const [selectedPeriod, setSelectedPeriod] = useState({ month: 1, year: new Date().getFullYear() });

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialGangCode !== undefined) setSelectedGang(initialGangCode);
    }, [initialGangCode]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const { currentMonth, currentYear, isHistorical, periodType } = usePeriodInfo(selectedPeriod.month, selectedPeriod.year);

    useEffect(() => {
        async function loadData() {
            if (!token) return;

            setLoading(true);
            setError(null);

            try {
                // Check if we're in historical mode
                const periodCheck = await getCurrentPeriod(token);
                const currentMonthFromApi = periodCheck.data?.month;
                const currentYearFromApi = periodCheck.data?.year;

                const requested = selectedPeriod.year * 100 + selectedPeriod.month;
                const current = currentYearFromApi * 100 + currentMonthFromApi;
                const isHistoricalPeriod = requested < current;

                if (isHistoricalPeriod) {
                    // Use historical data
                    if (selectedGang !== 'ALL') {
                        const historyResponse = await getGangHistoryForPeriod(
                            token,
                            selectedGang,
                            selectedPeriod.month,
                            selectedPeriod.year
                        );
                        if (historyResponse.success) {
                            setData({
                                employees: historyResponse.data,
                                source: 'history',
                                period: selectedPeriod
                            });
                        } else {
                            setError(historyResponse.error || 'Failed to load historical data');
                        }
                    } else {
                        setError('Please select a specific gang for historical data');
                    }
                } else {
                    // Would need to call the regular payroll API for current period
                    // For now, show message that current period is not yet supported
                    setError('Gunakan halaman Daftar Upah untuk periode saat ini');
                }
            } catch (err) {
                console.error('[GangHistoricalReportPage] Error:', err);
                setError(err.message || 'Failed to load data');
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, [token, selectedGang, selectedPeriod]);

    const calculateStats = () => {
        if (!data || !data.employees) return null;

        const employees = data.employees;
        return {
            totalEmployees: employees.length,
            totalHK: employees.reduce((sum, e) => sum + (e.jumlah_hk || 0), 0),
            avgHK: employees.length > 0 ? employees.reduce((sum, e) => sum + (e.jumlah_hk || 0), 0) / employees.length : 0,
            totalUpahBersih: employees.reduce((sum, e) => sum + (e.upah_bersih || 0), 0),
            avgUpahBersih: employees.length > 0 ? employees.reduce((sum, e) => sum + (e.upah_bersih || 0), 0) / employees.length : 0,
            totalLembur: employees.reduce((sum, e) => sum + (e.lembur_jumlah || 0), 0),
            totalPremi: employees.reduce((sum, e) => sum + (e.total_premi || 0), 0)
        };
    };

    const stats = calculateStats();

    return (
        <div className="gang-historical-report-page">
            <div className="page-header">
                <button className="back-btn" onClick={onBack}>← Kembali</button>
                <div className="header-info">
                    <h1>Daftar Upah - Historical Report</h1>
                    <p>Laporan gaji historis berdasarkan data yang telah disimpan</p>
                </div>
            </div>

            {/* Filters */}
            <div className="filters-container">
                <div className="filter-section">
                    <label>Pilih Gang:</label>
                    <select
                        value={selectedGang}
                        onChange={(e) => setSelectedGang(e.target.value)}
                        className="gang-select"
                    >
                        <option value="">-- Pilih Gang --</option>
                        {/* Gang options would be loaded from context or API */}
                        <option value="A1A">A1A - Gang Example</option>
                        <option value="A1B">A1B - Gang Example</option>
                        {/* Add more gangs as needed */}
                    </select>
                </div>

                <div className="filter-section">
                    <MonthPicker
                        month={selectedPeriod.month}
                        year={selectedPeriod.year}
                        onMonthChange={(m) => setSelectedPeriod({ ...selectedPeriod, month: m })}
                        onYearChange={(y) => setSelectedPeriod({ ...selectedPeriod, year: y })}
                    />
                </div>

                <CurrentPeriodBadge month={selectedPeriod.month} year={selectedPeriod.year} />
            </div>

            {/* Loading State */}
            {loading && (
                <LoadingScreen isLoading={true} message="Memuat data historis..." />
            )}

            {/* Error State */}
            {error && !loading && (
                <div className="error-container">
                    <div className="error-message">⚠️ {error}</div>
                    <p className="error-hint">
                        Pastikan data untuk periode {formatMonthName(selectedPeriod.month)} {selectedPeriod.year} telah di-seed.
                        Gunakan fitur "Seeding History" untuk menyimpan data historis.
                    </p>
                </div>
            )}

            {/* Data Display */}
            {!loading && !error && data && data.employees && (
                <>
                    {/* Stats Cards */}
                    {stats && (
                        <div className="stats-grid">
                            <div className="stat-card">
                                <span className="stat-label">Total Karyawan</span>
                                <span className="stat-value">{stats.totalEmployees}</span>
                            </div>
                            <div className="stat-card">
                                <span className="stat-label">Total HK</span>
                                <span className="stat-value">{stats.totalHK.toFixed(1)}</span>
                            </div>
                            <div className="stat-card">
                                <span className="stat-label">Total Upah Bersih</span>
                                <span className="stat-value">{formatCurrency(stats.totalUpahBersih)}</span>
                            </div>
                            <div className="stat-card">
                                <span className="stat-label">Rata-rata Upah Bersih</span>
                                <span className="stat-value">{formatCurrency(stats.avgUpahBersih)}</span>
                            </div>
                        </div>
                    )}

                    {/* Table */}
                    <div className="table-container">
                        <table className="historical-table">
                            <thead>
                                <tr>
                                    <th rowSpan="2">No</th>
                                    <th rowSpan="2">NIK</th>
                                    <th rowSpan="2">Nama</th>
                                    <th rowSpan="2">Gang</th>
                                    <th colspan="2">Absensi</th>
                                    <th colspan="4">Tunjangan</th>
                                    <th colspan="2">Lembur</th>
                                    <th rowSpan="2">Total Potongan</th>
                                    <th rowSpan="2">Upah Bersih</th>
                                </tr>
                                <tr>
                                    <th>HK</th>
                                    <th>Hari Kerja</th>
                                    <th>Beras</th>
                                    <th>Jabatan</th>
                                    <th>Masa Kerja</th>
                                    <th>Total</th>
                                    <th>Jam</th>
                                    <th>Jumlah</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.employees.map((emp, index) => (
                                    <tr key={emp.id || index}>
                                        <td>{index + 1}</td>
                                        <td>{emp.new_nik || emp.nik || emp.emp_code}</td>
                                        <td>{emp.emp_name || emp.nama}</td>
                                        <td>{emp.gang_code}</td>
                                        <td className="number">{emp.jumlah_hk || 0}</td>
                                        <td className="number">{emp.hari_kerja || 0}</td>
                                        <td className="number">{formatCurrency(emp.beras_jumlah)}</td>
                                        <td className="number">{formatCurrency(emp.jabatan_jumlah)}</td>
                                        <td className="number">{formatCurrency(emp.masa_kerja_jumlah)}</td>
                                        <td className="number">{formatCurrency(
                                            (emp.beras_jumlah || 0) +
                                            (emp.jabatan_jumlah || 0) +
                                            (emp.masa_kerja_jumlah || 0)
                                        )}</td>
                                        <td className="number">{emp.lembur_jam || 0}</td>
                                        <td className="number">{formatCurrency(emp.lembur_jumlah)}</td>
                                        <td className="number">{formatCurrency(emp.total_potongan)}</td>
                                        <td className="number highlight">{formatCurrency(emp.upah_bersih)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                {stats && (
                                    <tr className="footer-row">
                                        <td colSpan="4"><strong>TOTAL</strong></td>
                                        <td className="number"><strong>{stats.totalHK.toFixed(1)}</strong></td>
                                        <td></td>
                                        <td colSpan="4"></td>
                                        <td className="number"><strong>{stats.totalLembur.toFixed(1)}</strong></td>
                                        <td></td>
                                        <td></td>
                                        <td className="number highlight"><strong>{formatCurrency(stats.totalUpahBersih)}</strong></td>
                                    </tr>
                                )}
                            </tfoot>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
