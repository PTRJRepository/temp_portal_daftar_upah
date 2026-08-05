/**
 * EmployeeHistoryPage - Wrapper for Employee Detail with History Tabs
 *
 * Provides tabbed interface for viewing employee data:
 * - Current Period: Shows current period payslip and matrices
 * - Salary History: Timeline of salary across periods
 * - Trends: Charts showing salary trends
 * - Comparison: Compare two different periods
 */

import React, { useState } from 'react';
import { usePeriodInfo } from '../../hooks/useCurrentPeriod';
import EmployeeDetailPage from './EmployeeDetailPage';
import SalaryHistoryTimeline from './SalaryHistoryTimeline';
import SalaryHistoryTable from './SalaryHistoryTable';
import { EmployeeTrendsCharts } from './EmployeeTrendsCharts';
import { PeriodComparison } from './PeriodComparison';
import './EmployeeHistoryPage.css';

export default function EmployeeHistoryPage({
    employeeData,
    month,
    year,
    division,
    onBack
}) {
    const [activeTab, setActiveTab] = useState('current');
    const [historyView, setHistoryView] = useState('timeline'); // 'timeline' or 'table'
    const { currentPeriod, isHistorical, periodType } = usePeriodInfo(month, year);

    const empCode = employeeData?.nik || employeeData?.NIK || '';

    // If viewing historical period, auto-switch to history tab
    React.useEffect(() => {
        if (isHistorical && activeTab === 'current') {
            setActiveTab('history');
        }
    }, [isHistorical, activeTab]);

    const tabs = [
        { id: 'current', label: '📋 Periode Ini', visible: true },
        { id: 'history', label: '📜 Riwayat Gaji', visible: true },
        { id: 'history_table', label: '📊 Tabel Gaji', visible: true },
        { id: 'trends', label: '📈 Tren & Statistik', visible: true },
        { id: 'comparison', label: '⚖️ Perbandingan', visible: true }
    ];

    return (
        <div className="employee-history-page">
            {/* Header with period info */}
            <div className="history-page-header">
                <button className="back-btn" onClick={onBack}>
                    ← Kembali
                </button>
                <div className="period-info">
                    <h2>{employeeData?.nama || employeeData?.NAMA || 'Employee Detail'}</h2>
                    <p className="emp-code">{empCode}</p>
                    <div className="period-badges">
                        <span className={`period-badge period-${periodType}`}>
                            {periodType === 'current' && '📊 Periode Saat Ini'}
                            {periodType === 'historical' && '📜 Data Historis'}
                            {periodType === 'future' && '🔮 Periode Mendatang'}
                        </span>
                        <span className="period-display">
                            {getMonthName(month)} {year}
                        </span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="history-tabs">
                {tabs.map(tab => (
                    tab.visible && (
                        <button
                            key={tab.id}
                            className={`history-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    )
                ))}
            </div>

            {/* Tab Content */}
            <div className="history-tab-content">
                {activeTab === 'current' && (
                    <div className="tab-pane">
                        {isHistorical ? (
                            <div className="historical-notice">
                                <p>ℹ️ Anda sedang melihat data historis untuk {getMonthName(month)} {year}.</p>
                                <p>Gunakan tab "Riwayat Gaji" untuk melihat daftar lengkap semua periode.</p>
                            </div>
                        ) : null}
                        <EmployeeDetailPage
                            employeeData={employeeData}
                            month={month}
                            year={year}
                            division={division}
                        />
                    </div>
                )}

                {activeTab === 'history' && (
                    <div className="tab-pane">
                        <SalaryHistoryTimeline empCode={empCode} months={12} />
                    </div>
                )}

                {activeTab === 'history_table' && (
                    <div className="tab-pane">
                        <SalaryHistoryTable empCode={empCode} months={12} />
                    </div>
                )}

                {activeTab === 'trends' && (
                    <div className="tab-pane">
                        <EmployeeTrendsCharts empCode={empCode} />
                    </div>
                )}

                {activeTab === 'comparison' && (
                    <div className="tab-pane">
                        <PeriodComparison empCode={empCode} />
                    </div>
                )}
            </div>
        </div>
    );
}

function getMonthName(month) {
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return months[month - 1] || '';
}
