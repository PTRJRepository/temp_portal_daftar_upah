/**
 * PeriodComparison Component
 *
 * Allows comparison of an employee's payroll data between two different periods
 * Shows side-by-side comparison with differences highlighted
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getEmployeeDetailForPeriod, formatMonthName, formatCurrency } from '../../services/historyService';
import MonthPicker from '../common/MonthPicker';
import './PeriodComparison.css';

export function PeriodComparison({ empCode }) {
    const { token } = useAuth();
    const [period1, setPeriod1] = useState({ month: 1, year: new Date().getFullYear() });
    const [period2, setPeriod2] = useState({ month: 2, year: new Date().getFullYear() });
    const [data1, setData1] = useState(null);
    const [data2, setData2] = useState(null);
    const [loading1, setLoading1] = useState(false);
    const [loading2, setLoading2] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function loadData() {
            if (!token || !empCode) return;

            // Load Period 1
            setLoading1(true);
            try {
                const response = await getEmployeeDetailForPeriod(
                    token,
                    empCode,
                    period1.month,
                    period1.year
                );
                if (response.success) {
                    setData1(response.data);
                } else {
                    setData1(null);
                }
            } catch (err) {
                console.error('[PeriodComparison] Error loading period 1:', err);
                setData1(null);
            } finally {
                setLoading1(false);
            }

            // Load Period 2
            setLoading2(true);
            try {
                const response = await getEmployeeDetailForPeriod(
                    token,
                    empCode,
                    period2.month,
                    period2.year
                );
                if (response.success) {
                    setData2(response.data);
                } else {
                    setData2(null);
                }
            } catch (err) {
                console.error('[PeriodComparison] Error loading period 2:', err);
                setData2(null);
            } finally {
                setLoading2(false);
            }
        }

        loadData();
    }, [token, empCode, period1, period2]);

    const diff = calculateDifference(data1, data2);

    return (
        <div className="period-comparison">
            <h3>⚖️ Perbandingan Periode</h3>

            {/* Period Selectors */}
            <div className="period-selectors">
                <div className="period-selector">
                    <label>Periode 1</label>
                    <MonthPicker
                        month={period1.month}
                        year={period1.year}
                        onMonthChange={(m) => setPeriod1({ ...period1, month: m })}
                        onYearChange={(y) => setPeriod1({ ...period1, year: y })}
                    />
                    {loading1 && <span className="loading-text">Memuat...</span>}
                    {!loading1 && !data1 && <span className="no-data-text">Tidak ada data</span>}
                </div>

                <div className="vs-divider">VS</div>

                <div className="period-selector">
                    <label>Periode 2</label>
                    <MonthPicker
                        month={period2.month}
                        year={period2.year}
                        onMonthChange={(m) => setPeriod2({ ...period2, month: m })}
                        onYearChange={(y) => setPeriod2({ ...period2, year: y })}
                    />
                    {loading2 && <span className="loading-text">Memuat...</span>}
                    {!loading2 && !data2 && <span className="no-data-text">Tidak ada data</span>}
                </div>
            </div>

            {/* Comparison Table */}
            {data1 && data2 && diff && (
                <ComparisonTable data1={data1} data2={data2} diff={diff} />
            )}

            {error && (
                <div className="comparison-error">
                    <p>❌ {error}</p>
                </div>
            )}
        </div>
    );
}

function calculateDifference(data1, data2) {
    if (!data1 || !data2) return null;

    return {
        jumlah_hk: (data2.jumlah_hk || 0) - (data1.jumlah_hk || 0),
        hari_kerja: (data2.hari_kerja || 0) - (data1.hari_kerja || 0),
        gaji_pokok: (data2.gaji_pokok || 0) - (data1.gaji_pokok || 0),
        beras_jumlah: (data2.beras_jumlah || 0) - (data1.beras_jumlah || 0),
        jabatan_jumlah: (data2.jabatan_jumlah || 0) - (data1.jabatan_jumlah || 0),
        masa_kerja_jumlah: (data2.masa_kerja_jumlah || 0) - (data1.masa_kerja_jumlah || 0),
        total_tunjangan: calculateTotalTunjangan(data2) - calculateTotalTunjangan(data1),
        lembur_jam: (data2.lembur_jam || 0) - (data1.lembur_jam || 0),
        lembur_jumlah: (data2.lembur_jumlah || 0) - (data1.lembur_jumlah || 0),
        total_premi: (data2.total_premi || 0) - (data1.total_premi || 0),
        total_potongan: (data2.total_potongan || 0) - (data1.total_potongan || 0),
        upah_kotor: (data2.jumlah_upah_kotor || 0) - (data1.jumlah_upah_kotor || 0),
        upah_bersih: (data2.upah_bersih || 0) - (data1.upah_bersih || 0)
    };
}

function calculateTotalTunjangan(data) {
    return (data.beras_jumlah || 0) +
           (data.jabatan_jumlah || 0) +
           (data.masa_kerja_jumlah || 0);
}

function ComparisonTable({ data1, data2, diff }) {
    const period1Label = `${formatMonthName(data1.period_month)} ${data1.period_year}`;
    const period2Label = `${formatMonthName(data2.period_month)} ${data2.period_year}`;

    const rows = [
        { label: 'Absensi', isSection: true },
        { label: 'Hari Kerja', key1: 'hari_kerja', key2: 'hari_kerja', diffKey: 'hari_kerja', unit: 'hari' },
        { label: 'Jumlah HK', key1: 'jumlah_hk', key2: 'jumlah_hk', diffKey: 'jumlah_hk', unit: '' },

        { label: 'Gaji Pokok', isSection: true },
        { label: 'Gaji Pokok', key1: 'gaji_pokok', key2: 'gaji_pokok', diffKey: 'gaji_pokok', isCurrency: true },

        { label: 'Tunjangan', isSection: true },
        { label: 'Beras', key1: 'beras_jumlah', key2: 'beras_jumlah', diffKey: 'beras_jumlah', isCurrency: true },
        { label: 'Jabatan', key1: 'jabatan_jumlah', key2: 'jabatan_jumlah', diffKey: 'jabatan_jumlah', isCurrency: true },
        { label: 'Masa Kerja', key1: 'masa_kerja_jumlah', key2: 'masa_kerja_jumlah', diffKey: 'masa_kerja_jumlah', isCurrency: true },
        { label: 'Total Tunjangan', customValue1: calculateTotalTunjangan(data1), customValue2: calculateTotalTunjangan(data2), diffKey: 'total_tunjangan', isCurrency: true, bold: true },

        { label: 'Lembur', isSection: true },
        { label: 'Total Jam', key1: 'lembur_jam', key2: 'lembur_jam', diffKey: 'lembur_jam', unit: 'jam' },
        { label: 'Jumlah', key1: 'lembur_jumlah', key2: 'lembur_jumlah', diffKey: 'lembur_jumlah', isCurrency: true },

        { label: 'Premi', isSection: true },
        { label: 'Total Premi', key1: 'total_premi', key2: 'total_premi', diffKey: 'total_premi', isCurrency: true },

        { label: 'Potongan', isSection: true },
        { label: 'Total Potongan', key1: 'total_potongan', key2: 'total_potongan', diffKey: 'total_potongan', isCurrency: true },

        { label: 'Total', isSection: true },
        { label: 'Upah Kotor', key1: 'jumlah_upah_kotor', key2: 'jumlah_upah_kotor', diffKey: 'upah_kotor', isCurrency: true },
        { label: 'Upah Bersih', key1: 'upah_bersih', key2: 'upah_bersih', diffKey: 'upah_bersih', isCurrency: true, bold: true, highlight: true }
    ];

    return (
        <div className="comparison-table-container">
            <table className="comparison-table">
                <thead>
                    <tr>
                        <th>Komponen</th>
                        <th className="period1-col">{period1Label}</th>
                        <th className="diff-col">Selisih</th>
                        <th className="period2-col">{period2Label}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => {
                        if (row.isSection) {
                            return (
                                <tr key={i} className="section-row">
                                    <td colSpan="4">{row.label}</td>
                                </tr>
                            );
                        }

                        const value1 = row.customValue1 !== undefined ? row.customValue1 : (data1[row.key1] || 0);
                        const value2 = row.customValue2 !== undefined ? row.customValue2 : (data2[row.key2] || 0);
                        const diffValue = diff[row.diffKey] || 0;

                        return (
                            <tr key={i} className={row.highlight ? 'highlight-row' : ''}>
                                <td className={row.bold ? 'bold' : ''}>{row.label}</td>
                                <td className="value-cell period1-col">
                                    {row.isCurrency ? formatCurrency(value1) : value1.toFixed(1)}
                                    {row.unit && <span className="unit"> {row.unit}</span>}
                                </td>
                                <td className={`diff-cell ${diffValue > 0 ? 'positive' : diffValue < 0 ? 'negative' : 'neutral'}`}>
                                    {diffValue > 0 && '+'}
                                    {row.isCurrency ? formatCurrency(diffValue) : diffValue.toFixed(1)}
                                    {row.unit && <span className="unit"> {row.unit}</span>}
                                </td>
                                <td className="value-cell period2-col">
                                    {row.isCurrency ? formatCurrency(value2) : value2.toFixed(1)}
                                    {row.unit && <span className="unit"> {row.unit}</span>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default PeriodComparison;
