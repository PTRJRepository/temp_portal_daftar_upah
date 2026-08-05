/**
 * SpreadsheetSyncPage - Web UI for Dedicated Spreadsheet Synchronization
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    checkAggregationHealth,
    syncSpreadsheet,
    fetchAggregationDivisions,
    formatMonthName
} from '../services/aggregationSeederService';
import '../styles/aggregation-seeder.css';

export default function SpreadsheetSyncPage({ onBack }) {
    const { token, user } = useAuth();

    // Parameters
    const [division, setDivision] = useState('ALL');
    const [month, setMonth] = useState(new Date().getMonth() + 1);
    const [year, setYear] = useState(new Date().getFullYear());
    const [syncType, setSyncType] = useState('DAFTAR_UPAH');

    // Data
    const [divisions, setDivisions] = useState(['ALL']);

    // State
    const [isSyncing, setIsSyncing] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('checking');
    const [logs, setLogs] = useState([]);

    // Log ref for auto-scroll
    const logEndRef = useRef(null);

    // Add log entry
    const addLog = useCallback((message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString('id-ID');
        setLogs(prev => [...prev, { timestamp, message, type }]);
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    // Check connection on mount
    useEffect(() => {
        async function checkConnection() {
            if (!token) return;
            setConnectionStatus('checking');
            addLog('🔌 Checking database connection...');
            try {
                const result = await checkAggregationHealth(token);
                if (result.success) {
                    setConnectionStatus('connected');
                    addLog('✅ Database connection OK', 'success');
                } else {
                    setConnectionStatus('error');
                    addLog(`❌ Connection failed: ${result.message}`, 'error');
                }
            } catch (e) {
                setConnectionStatus('error');
                addLog(`❌ Connection error: ${e.message}`, 'error');
            }
        }
        checkConnection();
    }, [token, addLog]);

    // Load divisions
    useEffect(() => {
        async function loadDivisions() {
            if (!token) return;
            try {
                const result = await fetchAggregationDivisions(token);
                if (result.success && result.divisions?.length > 0) {
                    setDivisions(['ALL', ...result.divisions]);
                }
            } catch (e) {
                addLog(`⚠️ Failed to load divisions: ${e.message}`, 'warn');
            }
        }
        loadDivisions();
    }, [token, addLog]);

    // Run spreadsheet sync
    const handleSyncSpreadsheet = async () => {
        if (isSyncing) return;

        setIsSyncing(true);
        addLog('='.repeat(40), 'info');
        addLog('🔄 Starting Spreadsheet Sync...', 'info');
        addLog(`📅 Period: ${formatMonthName(month)} ${year}`);
        addLog(`📊 Division: ${division === 'ALL' ? 'All Divisions' : division}`);
        addLog(`📑 Type: ${syncType}`);

        try {
            const result = await syncSpreadsheet(
                token,
                month,
                year,
                division === 'ALL' ? null : division,
                syncType
            );

            if (result.success) {
                addLog('✅ Spreadsheet Sync complete!', 'success');
                if (result.results) {
                    const synced = result.results.filter(r => r.status === 'SUCCESS').length;
                    const missed = result.results.filter(r => r.status === 'SKIPPED_NO_DATA').length;
                    const failed = result.results.filter(r => r.status === 'FAILED' || r.status === 'ERROR').length;
                    addLog(`📈 Synced: ${synced}, Miss: ${missed}, Failed: ${failed}`);

                    result.results
                        .filter(r => r.status === 'FAILED' || r.status === 'ERROR')
                        .forEach(r => {
                        addLog(`❌ ${r.division}: ${r.error || r.message || 'Unknown error'}`, 'error');
                    });
                }
            } else {
                addLog(`❌ Sync failed: ${result.error}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Sync Error: ${e.message}`, 'error');
        } finally {
            setIsSyncing(false);
        }
    };

    // Clear logs
    const handleClearLogs = () => {
        setLogs([]);
    };

    // Date Options
    const dateOptions = {
        months: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: formatMonthName(i + 1) })),
        years: Array.from({ length: 7 }, (_, i) => 2024 + i)
    };

    // Sync Types Configuration
    const SYNC_TYPES = [
        {
            id: 'DAFTAR_UPAH',
            title: 'Daftar Upah',
            description: 'Laporan Gaji Bulanan Perorangan (dengan Analisis Lembur & Premi)',
            icon: '💰',
            active: true
        },
        {
            id: 'ANALISIS_PAYROLL',
            title: 'Laporan Analisis Payroll',
            description: 'Daftar Upah + Detail Lembur per Task + Premi per Jenis',
            icon: '📊',
            active: true
        },
        {
            id: 'SUMMARY_WAGES',
            title: 'Wages Summary',
            description: 'Rekapitulasi Upah & Impact Report',
            icon: '📈',
            active: true
        },
        {
            id: 'PPH21',
            title: 'Pajak PPh21',
            description: 'Laporan Potongan Pajak Bulanan',
            icon: '🧾',
            active: false
        },
        {
            id: 'BPJS',
            title: 'Laporan BPJS',
            description: 'Rincian Iuran BPJS TK & Kesehatan',
            icon: '🏥',
            active: false
        }
    ];

    return (
        <div className="agg-container">
            {/* Header / Action Bar */}
            <div className="agg-header sticky-header">
                <div className="agg-header-left">
                    {onBack && (
                        <button onClick={onBack} className="agg-btn agg-btn-back">
                            ← Back
                        </button>
                    )}
                    <div className="agg-title-block">
                        <h1 className="agg-title">📑 Spreadsheet Sync</h1>
                    </div>
                </div>

                {/* Main Actions in Header for Visibility */}
                <div className="agg-header-center">
                    <select
                        value={division}
                        onChange={(e) => setDivision(e.target.value)}
                        disabled={isSyncing || syncType === 'SUMMARY_WAGES'}
                        className="agg-header-select"
                        title={syncType === 'SUMMARY_WAGES' ? "Summary Sync applies to ALL divisions" : "Select Division"}
                    >
                        {divisions.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>

                    <select
                        value={month}
                        onChange={(e) => setMonth(parseInt(e.target.value))}
                        disabled={isSyncing}
                        className="agg-header-select"
                        title="Select Month"
                    >
                        {dateOptions.months.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>

                    <select
                        value={year}
                        onChange={(e) => setYear(parseInt(e.target.value))}
                        disabled={isSyncing}
                        className="agg-header-select"
                        title="Select Year"
                    >
                        {dateOptions.years.map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>

                    <button
                        onClick={handleSyncSpreadsheet}
                        disabled={isSyncing || connectionStatus !== 'connected'}
                        className="agg-btn agg-btn-primary"
                    >
                        {isSyncing ? '⏳ Syncing...' : '🚀 Sync Now'}
                    </button>
                </div>

                <div className="agg-header-right">
                    <div className={`agg-status-dot ${connectionStatus}`} title={connectionStatus}></div>
                </div>
            </div>

            <div className="agg-content-split">
                {/* Left: Sync Type Grid */}
                <div className="agg-left-pane">
                    <div className="pane-header">
                        <h3 className="pane-title">Select Report Type</h3>
                    </div>
                    <div className="sync-card-grid">
                        {SYNC_TYPES.map(type => (
                            <div
                                key={type.id}
                                className={`sync-card ${syncType === type.id ? 'selected' : ''} ${!type.active ? 'disabled' : ''}`}
                                onClick={() => type.active && setSyncType(type.id)}
                            >
                                <div className="sync-icon">{type.icon}</div>
                                <div className="sync-info">
                                    <h4>{type.title}</h4>
                                    <p>{type.description}</p>
                                </div>
                                {syncType === type.id && <div className="sync-check">✓</div>}
                            </div>
                        ))}
                    </div>

                    {/* Quick Stats or Instructions */}
                    <div className="sync-instructions" style={{ padding: '0 1rem', color: '#64748b', fontSize: '0.9rem' }}>
                        <p>ℹ️ <strong>Current Sync:</strong> {syncType === 'DAFTAR_UPAH' ? 'Daftar Upah Lengkap' : syncType === 'ANALISIS_PAYROLL' ? 'Daftar Upah + Analisis Lembur & Premi' : syncType === 'SUMMARY_WAGES' ? 'Wages Summary Report' : syncType}</p>
                        <p>Select a report type above, your desired period and division from the top bar, then click <b>Sync Now</b>.</p>
                        {syncType === 'DAFTAR_UPAH' && (
                            <p>📋 <strong>Format:</strong> Daftar Upah dengan header bertingkat, gang headers, gang totals, grand total.</p>
                        )}
                        {syncType === 'ANALISIS_PAYROLL' && (
                            <p>📋 <strong>Format:</strong> Daftar Upah + Analisis Lembur (per task) + Analisis Premi (per jenis) di kolom sebelah kanan.</p>
                        )}
                        {syncType === 'SUMMARY_WAGES' && (
                            <p>📋 <strong>Format:</strong> Dashboard summary dengan KPI dan impact analysis.</p>
                        )}
                    </div>
                </div>

                {/* Right: Logs */}
                <div className="agg-right-pane">
                    <div className="pane-header">
                        <h3 className="pane-title">Sync Logs</h3>
                        <button onClick={handleClearLogs} className="agg-btn-xs">Clear</button>
                    </div>
                    <div className="agg-log-content">
                        {logs.length === 0 ? (
                            <div className="agg-log-empty">Waiting to start...</div>
                        ) : (
                            logs.map((log, idx) => (
                                <div key={idx} className={`agg-log-entry ${log.type}`}>
                                    <span className="agg-log-time">[{log.timestamp}]</span>
                                    <span className="agg-log-msg">{log.message}</span>
                                </div>
                            ))
                        )}
                        <div ref={logEndRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}
