/**
 * AggregationSeederPage - Web UI for Payroll Aggregation Seeder
 * Equivalent to the Python Tkinter gui_app.py but as a React component
 *
 * MODIFIED: Added History Seeder functionality (terpisah dari aggregation seeder)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
    checkAggregationHealth,
    seedAggregation,
    seedAutoBufferManualAdjustments,
    seedManualAdjustmentSyncStatus,
    fetchAggregationSummary,
    fetchAggregationDivisions,
    fetchAggregationPeriods,
    fetchAggregationStatus,
    syncSpreadsheet,
    formatMonthName as formatAggMonthName,
    formatCurrency,
    formatNumber
} from '../services/aggregationSeederService';
import {
    checkHistoryHealth,
    seedPayrollHistory,
    getSeederProgress,
    resetSeeder,
    formatMonthName,
    previewExcelPtkpTax,
    previewPtkpTax,
    updatePtkpTax
} from '../services/historyService';
import '../styles/aggregation-seeder.css';

const MANUAL_SYNC_ADJUSTMENT_TYPES = ['PREMI', 'POTONGAN_KOTOR', 'POTONGAN_BERSIH', 'AUTO_BUFFER'];
const MANUAL_SYNC_LIMIT = 5000;
const MANUAL_SYNC_KNOWN_DIVISIONS = [
    'PG1A',
    'PG1B',
    'PG2A',
    'PG2B',
    'PGE',
    'AB1',
    'AB2',
    'ARA',
    'ARC',
    'DME',
    'IJL',
    'INF',
    'NRS',
    'WKS_AR',
    'WKS_PG',
    'WORKSHOP',
    'MILL'
];

function manualSyncDivisionGroupKey(value) {
    const code = String(value || '').trim().toUpperCase();
    const aliases = {
        '1A': 'P1A',
        P1A: 'P1A',
        PG1A: 'P1A',
        '1B': 'P1B',
        P1B: 'P1B',
        PG1B: 'P1B',
        '2A': 'P2A',
        P2A: 'P2A',
        PG2A: 'P2A',
        '2B': 'P2B',
        P2B: 'P2B',
        PG2B: 'P2B',
        ARB1: 'AB1',
        ARB2: 'AB2',
        AREC: 'ARC'
    };
    return aliases[code] || code;
}

function buildManualSyncTargetDivisions(selectedDivision, availableDivisions) {
    if (selectedDivision !== 'ALL') return [selectedDivision];

    const seen = new Set();
    return [...MANUAL_SYNC_KNOWN_DIVISIONS, ...availableDivisions]
        .map((item) => String(item || '').trim().toUpperCase())
        .filter((item) => item && item !== 'ALL')
        .filter((item) => {
            const key = manualSyncDivisionGroupKey(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

export default function AggregationSeederPage({ onBack, initialMonth, initialYear }) {
    const { token, user } = useAuth();

    // Parameters
    const [division, setDivision] = useState('ALL');
    const [month, setMonth] = useState(initialMonth || null);
    const [year, setYear] = useState(initialYear || null);
    const [syncType, setSyncType] = useState('DAFTAR_UPAH');
    const [historySeederType, setHistorySeederType] = useState('PAYROLL');

    // Data
    const [divisions, setDivisions] = useState(['ALL']);
    const [summaryData, setSummaryData] = useState([]);
    const [grandTotal, setGrandTotal] = useState(null);

    // State
    const [isRunning, setIsRunning] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isAutoBufferSeeding, setIsAutoBufferSeeding] = useState(false);
    const [isManualSyncSeeding, setIsManualSyncSeeding] = useState(false);
    const [isHistoryRunning, setIsHistoryRunning] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('checking');
    const [historyConnectionStatus, setHistoryConnectionStatus] = useState('checking');
    const [logs, setLogs] = useState([]);
    const [showSummary, setShowSummary] = useState(false);
    const [seederProgress, setSeederProgress] = useState(null);
    const [isPtkpRunning, setIsPtkpRunning] = useState(false);
    const [ptkpOperation, setPtkpOperation] = useState(null);

    // Log ref for auto-scroll
    const logEndRef = useRef(null);

    useEffect(() => {
        if (initialMonth) setMonth(initialMonth);
        if (initialYear) setYear(initialYear);
    }, [initialMonth, initialYear]);

    // Add log entry
    const addLog = useCallback((message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString('id-ID');
        setLogs(prev => [...prev, { timestamp, message, type }]);
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    // Poll seeder progress while running
    useEffect(() => {
        if (!isHistoryRunning) return;
        const interval = setInterval(async () => {
            try {
                const progress = await getSeederProgress(token);
                if (progress) setSeederProgress(progress);
                if (progress && !progress.is_running) {
                    clearInterval(interval);
                }
            } catch (e) { /* ignore */ }
        }, 2000);
        return () => clearInterval(interval);
    }, [isHistoryRunning, token]);

    // Check connection on mount
    useEffect(() => {
        async function checkConnection() {
            if (!token) {
                addLog('❌ ERROR: No authentication token found! Please login first.', 'error');
                addLog('💡 Solution: Login to the payroll application (Port 8002) first, then try again.', 'warn');
                setConnectionStatus('error');
                setHistoryConnectionStatus('error');
                return;
            }

            setConnectionStatus('checking');
            setHistoryConnectionStatus('checking');
            addLog('🔌 Checking database connections...');

            // Check aggregation database
            try {
                const result = await checkAggregationHealth(token);
                if (result.success) {
                    setConnectionStatus('connected');
                    addLog('✅ Aggregation DB connection OK', 'success');
                } else {
                    setConnectionStatus('error');
                    addLog(`❌ Aggregation DB connection failed: ${result.message}`, 'error');
                }
            } catch (e) {
                setConnectionStatus('error');
                addLog(`❌ Aggregation DB connection error: ${e.message}`, 'error');
            }

            // Check history database
            try {
                const result = await checkHistoryHealth(token);
                if (result.success) {
                    setHistoryConnectionStatus('connected');
                    const modeDisplay = result.mode || result.run_mode || (result.history_mode ? 'history' : 'realtime');
                    addLog(`✅ History DB connection OK (${modeDisplay} mode)`, 'success');
                } else {
                    setHistoryConnectionStatus('error');
                    addLog(`❌ History DB connection failed: ${result.message}`, 'error');
                }
            } catch (e) {
                setHistoryConnectionStatus('error');
                addLog(`❌ History DB connection error: ${e.message}`, 'error');
            }

            // Fetch active database period and set as default
            try {
                const baseUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || '';
                const periodRes = await fetch(`${baseUrl}/payroll/current-period`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (periodRes.ok) {
                    const periodData = await periodRes.json();
                    if (periodData.month && periodData.year) {
                        if (!initialMonth) setMonth(periodData.month);
                        if (!initialYear) setYear(periodData.year);
                        addLog(`📅 Database aktif: ${formatMonthName(periodData.month)} ${periodData.year}`);
                    }
                }
            } catch (e) {
                // Non-critical, keep system date defaults
            }
        }
        checkConnection();
    }, [token, addLog, initialMonth, initialYear]);

    // Load divisions
    useEffect(() => {
        async function loadDivisions() {
            if (!token) return;
            try {
                const result = await fetchAggregationDivisions(token);
                if (result.success && result.divisions?.length > 0) {
                    setDivisions(['ALL', ...result.divisions]);
                    addLog(`✅ Loaded ${result.divisions.length} divisions`);
                }
            } catch (e) {
                addLog(`⚠️ Failed to load divisions: ${e.message}`, 'warn');
            }
        }
        loadDivisions();
    }, [token, addLog]);

    // Run seeder
    const handleRunSeeder = async () => {
        if (isRunning || isAutoBufferSeeding || isManualSyncSeeding) return;
        if (connectionStatus !== 'connected') {
            addLog('❌ Database not connected. Cannot run seeder.', 'error');
            return;
        }

        setIsRunning(true);
        setLogs([]);
        addLog('🚀 Starting aggregation seeder...');
        addLog(`📅 Period: ${formatMonthName(month)} ${year}`);
        addLog(`📊 Division: ${division === 'ALL' ? 'All Divisions' : division}`);

        try {
            addLog('📡 Fetching data and auto-triggering history seeder (needed for Pajak)...', 'info');
            const result = await seedAggregation(
                token,
                month,
                year,
                division === 'ALL' ? null : division,
                false
            );

            if (result.success) {
                addLog('='.repeat(40), 'info');
                addLog('✅ Seeding complete!', 'success');
                addLog(`📊 Processed ${result.data?.total_divisions || 0} divisions`);

                if (result.data?.processed) {
                    for (const item of result.data.processed) {
                        addLog(`  ✅ ${item.division}/${item.gang}: ${item.employees_processed} employees`);
                    }
                }
            } else {
                addLog(`❌ Seeding failed: ${result.error}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Error: ${e.message}`, 'error');
        } finally {
            setIsRunning(false);
        }
    };

    // Seed auto buffer values into manual adjustment table (AUTO_BUFFER)
    const handleSeedAutoBuffer = async () => {
        if (isAutoBufferSeeding || isManualSyncSeeding || isRunning || isSyncing || isHistoryRunning || isPtkpRunning) return;
        if (connectionStatus !== 'connected') {
            addLog('ERROR: Database not connected. Cannot run auto buffer seeder.', 'error');
            return;
        }

        const targetDivisions = division === 'ALL'
            ? divisions.filter((item) => item && item !== 'ALL')
            : [division];

        if (targetDivisions.length === 0) {
            addLog('ERROR: No target division available for auto buffer seeding.', 'error');
            return;
        }

        const scopeLabel = division === 'ALL'
            ? `ALL divisions (${targetDivisions.length})`
            : division;
        const confirmMsg = `Seed Auto Buffer -> Manual Adjustment for ${scopeLabel} period ${formatMonthName(month)} ${year}?`;
        if (!window.confirm(confirmMsg)) return;

        setIsAutoBufferSeeding(true);
        addLog('='.repeat(40), 'info');
        addLog('Starting Auto Buffer -> Manual Adjustment seeder...');
        addLog(`Period: ${formatMonthName(month)} ${year}`);
        addLog(`Scope: ${scopeLabel}`);

        let successCount = 0;
        let failedCount = 0;
        const aggregate = {
            source_rows: 0,
            seeded_entries: 0,
            inserted: 0,
            updated: 0,
            deleted_existing: 0
        };

        try {
            for (const divisionCode of targetDivisions) {
                addLog(`Seeding AUTO_BUFFER for division ${divisionCode}...`, 'info');
                try {
                    const result = await seedAutoBufferManualAdjustments(token, {
                        period_month: month,
                        period_year: year,
                        division_code: divisionCode,
                        gang_code: 'ALL',
                        use_history_db: false,
                        replace_existing: true
                    });

                    if (!result?.success) {
                        failedCount += 1;
                        addLog(`${divisionCode}: ${result?.error || 'Seeder failed'}`, 'error');
                        continue;
                    }

                    const data = result.data || {};
                    successCount += 1;
                    aggregate.source_rows += Number(data.source_rows || 0);
                    aggregate.seeded_entries += Number(data.seeded_entries || 0);
                    aggregate.inserted += Number(data.inserted || 0);
                    aggregate.updated += Number(data.updated || 0);
                    aggregate.deleted_existing += Number(data.deleted_existing || 0);

                    addLog(
                        `${divisionCode}: rows=${Number(data.source_rows || 0)}, seed=${Number(data.seeded_entries || 0)}, insert=${Number(data.inserted || 0)}, update=${Number(data.updated || 0)}`,
                        'success'
                    );
                } catch (error) {
                    failedCount += 1;
                    const message = error?.response?.data?.error || error?.message || 'Seeder failed';
                    addLog(`${divisionCode}: ${message}`, 'error');
                }
            }

            addLog('='.repeat(40), 'info');
            if (failedCount === 0) {
                addLog('Auto buffer seeding completed.', 'success');
            } else {
                addLog(`Auto buffer seeding completed with ${failedCount} failure(s).`, 'warn');
            }
            addLog(`Success divisions: ${successCount}/${targetDivisions.length}`);
            addLog(`Total source rows: ${aggregate.source_rows}`);
            addLog(`Total seeded entries: ${aggregate.seeded_entries}`);
            addLog(`Total inserted: ${aggregate.inserted}`);
            addLog(`Total updated: ${aggregate.updated}`);
            addLog(`Total replaced(old rows): ${aggregate.deleted_existing}`);
        } finally {
            setIsAutoBufferSeeding(false);
        }
    };

    // Update sync: status for manual adjustment rows after matching PR_ADTRANS is found.
    const handleSeedManualSyncStatus = async () => {
        if (isManualSyncSeeding || isAutoBufferSeeding || isRunning || isSyncing || isHistoryRunning || isPtkpRunning) return;
        if (connectionStatus !== 'connected') {
            addLog('ERROR: Database not connected. Cannot run manual adjustment sync status seeder.', 'error');
            return;
        }

        const targetDivisions = buildManualSyncTargetDivisions(division, divisions);

        if (targetDivisions.length === 0) {
            addLog('ERROR: No target division available for manual adjustment sync status seeder.', 'error');
            return;
        }

        const scopeLabel = division === 'ALL'
            ? `ALL divisions (${targetDivisions.length})`
            : division;
        const confirmMsg = `Update sync status remarks for PREMI, KOREKSI/POTONGAN_KOTOR, POTONGAN_BERSIH, and AUTO_BUFFER in ${scopeLabel} period ${formatMonthName(month)} ${year}?\n\nRows will be rechecked against current PR_ADTRANS/PR_ADTRANS_ARC totals. Existing sync:SYNC rows can become sync:DIFF or sync:MISS if db_ptrj no longer matches. Target 0 without db_ptrj transaction stays sync:SYNC.`;
        if (!window.confirm(confirmMsg)) return;

        setIsManualSyncSeeding(true);
        addLog('='.repeat(40), 'info');
        addLog('Starting Manual Adjustment Sync Status audit/update...');
        addLog(`Period: ${formatMonthName(month)} ${year}`);
        addLog(`Scope: ${scopeLabel}`);
        addLog(`Types: ${MANUAL_SYNC_ADJUSTMENT_TYPES.join(', ')}`);
        addLog('Method: recheck every matching row against PR_ADTRANS/PR_ADTRANS_ARC totals, including old sync:SYNC rows.');
        addLog('Result status: SYNC when totals match, DIFF when ADTRANS exists but amount differs, MISS when non-zero target has no matching ADTRANS. Target 0 without ADTRANS stays SYNC.');
        addLog(`Limit per division request: ${MANUAL_SYNC_LIMIT} rows`);
        if (division === 'ALL') {
            addLog(`Target divisions: ${targetDivisions.join(', ')}`);
        }

        let successCount = 0;
        let failedCount = 0;
        const aggregate = {
            matched_count: 0,
            eligible_count: 0,
            adtrans_matched_count: 0,
            updated_count: 0,
            unchanged_count: 0,
            skipped_count: 0,
            sync_count: 0,
            diff_count: 0,
            miss_count: 0,
            old_sync_problem_count: 0
        };

        try {
            for (const divisionCode of targetDivisions) {
                addLog(`Updating sync status for division ${divisionCode}...`, 'info');
                try {
                    const result = await seedManualAdjustmentSyncStatus(token, {
                        period_month: month,
                        period_year: year,
                        division_code: divisionCode,
                        adjustment_types: MANUAL_SYNC_ADJUSTMENT_TYPES,
                        sync_status: 'SYNC',
                        only_if_adtrans_exists: true,
                        dry_run: false,
                        limit: MANUAL_SYNC_LIMIT,
                        created_by: user?.username || 'seeder_ui'
                    });

                    if (!result?.success) {
                        failedCount += 1;
                        addLog(`${divisionCode}: ${result?.error || 'Sync status seeder failed'}`, 'error');
                        continue;
                    }

                    const data = result.data || {};
                    successCount += 1;
                    aggregate.matched_count += Number(data.matched_count || 0);
                    aggregate.eligible_count += Number(data.eligible_count || 0);
                    aggregate.adtrans_matched_count += Number(data.adtrans_matched_count || 0);
                    aggregate.updated_count += Number(data.updated_count || 0);
                    aggregate.unchanged_count += Number(data.unchanged_count || 0);
                    aggregate.skipped_count += Number(data.skipped_count || 0);
                    if (Number(data.matched_count || 0) >= MANUAL_SYNC_LIMIT) {
                        addLog(`${divisionCode}: WARNING matched rows reached limit ${MANUAL_SYNC_LIMIT}. Run this division with narrower gang/employee scope if needed.`, 'warn');
                    }
                    const rows = Array.isArray(data.rows) ? data.rows : [];
                    const syncCount = rows.filter((row) => String(row?.new_sync_status || '').toUpperCase() === 'SYNC').length;
                    const diffCount = rows.filter((row) => String(row?.new_sync_status || '').toUpperCase() === 'DIFF').length;
                    const missCount = rows.filter((row) => String(row?.new_sync_status || '').toUpperCase() === 'MISS').length;
                    const oldSyncProblemRows = rows.filter((row) => {
                        const oldStatus = String(row?.old_sync_status || '').toUpperCase();
                        const newStatus = String(row?.new_sync_status || '').toUpperCase();
                        return oldStatus === 'SYNC' && newStatus && newStatus !== 'SYNC';
                    });
                    aggregate.sync_count += syncCount;
                    aggregate.diff_count += diffCount;
                    aggregate.miss_count += missCount;
                    aggregate.old_sync_problem_count += oldSyncProblemRows.length;

                    addLog(
                        `${divisionCode}: matched=${Number(data.matched_count || 0)}, updated=${Number(data.updated_count || 0)}, sync=${syncCount}, diff=${diffCount}, miss=${missCount}, skipped=${Number(data.skipped_count || 0)}`,
                        diffCount || missCount || oldSyncProblemRows.length ? 'warn' : 'success'
                    );
                    if (oldSyncProblemRows.length > 0) {
                        addLog(`${divisionCode}: WARNING ${oldSyncProblemRows.length} row lama sync:SYNC berubah menjadi DIFF/MISS setelah cek db_ptrj.`, 'error');
                        oldSyncProblemRows.slice(0, 5).forEach((row) => {
                            addLog(
                                `  id=${row.id} emp=${row.emp_code} type=${row.adjustment_type} name=${row.adjustment_name} old=${row.old_sync_status} new=${row.new_sync_status} target=${row.target_amount} db_ptrj=${row.adtrans_amount} diff=${row.diff}`,
                                'error'
                            );
                        });
                    }
                } catch (error) {
                    failedCount += 1;
                    const message = error?.response?.data?.error || error?.message || 'Sync status seeder failed';
                    addLog(`${divisionCode}: ${message}`, 'error');
                }
            }

            addLog('='.repeat(40), 'info');
            if (failedCount === 0) {
                addLog('Manual adjustment sync status seeding completed.', 'success');
            } else {
                addLog(`Manual adjustment sync status seeding completed with ${failedCount} failure(s).`, 'warn');
            }
            addLog(`Success divisions: ${successCount}/${targetDivisions.length}`);
            addLog(`Total matched rows: ${aggregate.matched_count}`);
            addLog(`Total eligible rows: ${aggregate.eligible_count}`);
            addLog(`Total ADTRANS matched: ${aggregate.adtrans_matched_count}`);
            addLog(`Total updated: ${aggregate.updated_count}`);
            addLog(`Total unchanged: ${aggregate.unchanged_count}`);
            addLog(`Total SYNC: ${aggregate.sync_count}`);
            addLog(`Total DIFF: ${aggregate.diff_count}`);
            addLog(`Total MISS: ${aggregate.miss_count}`);
            addLog(`Old sync:SYNC changed to DIFF/MISS: ${aggregate.old_sync_problem_count}`, aggregate.old_sync_problem_count > 0 ? 'error' : 'success');
            addLog(`Total skipped: ${aggregate.skipped_count}`);
        } finally {
            setIsManualSyncSeeding(false);
        }
    };

    // Run spreadsheet sync
    const handleSyncSpreadsheet = async () => {
        if (isSyncing || isRunning || isAutoBufferSeeding || isManualSyncSeeding) return;

        setIsSyncing(true);
        addLog('='.repeat(40), 'info');
        addLog('🔄 Starting Spreadsheet Sync...', 'info');
        addLog(`📅 Period: ${formatMonthName(month)} ${year}`);
        addLog(`📊 Division: ${division === 'ALL' ? 'All Divisions' : division}`);

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

                    // Log details for failures
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

    // View summary
    const handleViewSummary = async () => {
        addLog(`📋 Loading summary for ${formatMonthName(month)} ${year}...`);
        try {
            const result = await fetchAggregationSummary(token, month, year);
            if (result.success) {
                setSummaryData(result.summary || []);
                setGrandTotal(result.grand_total || null);
                setShowSummary(true);
                addLog(`✅ Loaded ${result.summary?.length || 0} division records`, 'success');
            } else {
                addLog(`❌ Failed to load summary: ${result.error}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Error: ${e.message}`, 'error');
        }
    };

    // Check status
    const handleCheckStatus = async () => {
        addLog(`🔍 Checking status for ${formatMonthName(month)} ${year}...`);
        try {
            const result = await fetchAggregationStatus(token, month, year);
            if (result.success) {
                addLog(`📊 Total gangs seeded: ${result.total_gangs}`);
                if (result.divisions?.length > 0) {
                    for (const div of result.divisions) {
                        addLog(`  • ${div.division_code}: ${div.gang_count} gangs`);
                    }
                } else {
                    addLog('⚠️ No data found for this period', 'warn');
                }
            }
        } catch (e) {
            addLog(`❌ Error: ${e.message}`, 'error');
        }
    };

    // Run history seeder (terpisah dari aggregation seeder)
    const handleRunHistorySeeder = async () => {
        if (isHistoryRunning || isAutoBufferSeeding || isManualSyncSeeding) return;

        // Check authentication first
        if (!token) {
            addLog('❌ ERROR: Not authenticated!', 'error');
            addLog('💡 Please login to the payroll application first (Port 8002)', 'warn');
            alert('⚠️ Anda belum login!\n\nSilakan login ke aplikasi payroll di Port 8002 terlebih dahulu, kemudian coba lagi.');
            return;
        }

        if (historyConnectionStatus !== 'connected') {
            addLog('❌ History database not connected. Cannot run history seeder.', 'error');
            return;
        }

        // Additional check: Warn if trying to seed current period with PAYROLL mode
        // because raw data might not be available yet
        const currentPeriodFromLog = logs.find(l => l.message.includes('Database aktif'));
        const currentDate = new Date();
        const isCurrentPeriod = (month === currentDate.getMonth() + 1 && year === currentDate.getFullYear());
        const isNearCurrentPeriod = (month >= currentDate.getMonth() && year === currentDate.getFullYear()) ||
            (month <= currentDate.getMonth() + 1 && year === currentDate.getFullYear());

        if (historySeederType === 'PAYROLL' && isCurrentPeriod) {
            const confirmMsg = `⚠️ Anda sedang mencoba menyimpan data untuk periode berjalan (${formatMonthName(month)} ${year}).\n\nData payroll untuk periode berjalan mungkin belum lengkap di database mentah.\n\nRekomendasi:\n1. Gunakan mode 'ALL' untuk menyimpan semua data (payroll + HR)\n2. Atau tunggu hingga akhir periode untuk hasil yang lebih akurat\n\nLanjutkan juga?`;
            if (!window.confirm(confirmMsg)) {
                addLog('⚠️ Seed dibatalkan oleh pengguna', 'warn');
                return;
            }
        }

        setIsHistoryRunning(true);
        addLog('='.repeat(40), 'info');
        addLog('🚀 Starting HISTORY seeder (terpisah)...');
        addLog(`📅 Period: ${formatMonthName(month)} ${year}`);
        addLog(`📊 Division: ${division === 'ALL' ? 'All Divisions' : division}`);
        addLog(`🔧 Mode: ${historySeederType}`);

        // Show helpful message for first-time users
        if (historySeederType === 'PAYROLL' && division === 'ALL') {
            addLog('💡 Tip: Untuk seeding pertama, coba dengan division spesifik terlebih dahulu', 'info');
        }

        try {
            // Start progress poller
            let lastStatus = '';
            let progressCount = 0;
            const poller = setInterval(async () => {
                try {
                    const progress = await getSeederProgress(token);
                    if (progress) setSeederProgress(progress);
                    if (progress?.is_running) {
                        progressCount++;
                        const p = progress;
                        // Only log every 5th progress update to avoid log spam
                        if (progressCount % 5 === 0) {
                            const statusMsg = `⏳ [${p.current_division || '...'}] Gangs: ${p.gangs_done}/${p.gangs_total} | Emp: ${p.employees_processed} | ${p.current_step}`;
                            if (statusMsg !== lastStatus) {
                                addLog(statusMsg, 'debug');
                                lastStatus = statusMsg;
                            }
                        }
                    }
                } catch (e) { /* ignore polling errors */ }
            }, 2000);

            const result = await seedPayrollHistory(
                token,
                month,
                year,
                division === 'ALL' ? null : division,
                null, // gang_code - seed all gangs
                false, // force
                historySeederType
            );

            clearInterval(poller); // Stop poller

            if (result.success) {
                addLog('='.repeat(40), 'info');
                addLog(`✅ History seeding complete! Mode: ${historySeederType}`, 'success');
                addLog(`📊 Total employees: ${result.data?.total_employees || 0}`);

                const records = result.data?.records_inserted;
                if (records) {
                    addLog(`📋 Records inserted:`);
                    if (records.master !== undefined) addLog(`  • Master: ${records.master}`);
                    if (records.detail !== undefined) addLog(`  • Detail: ${records.detail}`);
                    if (records.taskreg !== undefined) addLog(`  • Taskreg: ${records.taskreg}`);
                    if (records.adtrans !== undefined) addLog(`  • ADTrans: ${records.adtrans}`);
                    if (records.gang_member !== undefined) addLog(`  • Gang Member: ${records.gang_member}`);
                    if (records.hr_employee !== undefined) addLog(`  • HR Employee: ${records.hr_employee}`);
                    if (records.hr_gang !== undefined) addLog(`  • HR Gang: ${records.hr_gang}`);
                }

                if (result.data?.history_id) {
                    addLog(`🔑 History ID: ${result.data.history_id}`);
                }

                // Success feedback
                if (result.data?.total_employees === 0) {
                    addLog('⚠️ Perhatian: 0 employees diproses. Periksa apakah data exists untuk periode ini.', 'warn');
                }
            } else {
                addLog(`❌ History seeding failed: ${result.error || 'Unknown error'}`, 'error');
                if (result.errors?.length > 0) {
                    result.errors.forEach(err => {
                        addLog(`  • ${err}`, 'error');
                        // Provide helpful suggestions based on error type
                        if (err.includes('No payroll data found')) {
                            addLog('💡 Saran: Coba gunakan mode ALL_HR atau ALL untuk menyimpan data HR saja', 'info');
                            addLog('💡 Atau pastikan data payroll sudah ada di database mentah (PR_GANGLN_ARC)', 'info');
                        }
                    });
                }
            }
        } catch (e) {
            const backendError = e?.response?.data;
            const detailedErrors = Array.isArray(backendError?.errors) ? backendError.errors : [];
            const primaryError = backendError?.error || backendError?.message || e.message || 'Unknown error';

            addLog(`❌ Error: ${primaryError}`, 'error');
            detailedErrors.forEach(err => addLog(`  • ${err}`, 'error'));

            if (backendError?.details && !detailedErrors.length) {
                addLog(`  • ${backendError.details}`, 'error');
            }

            if (primaryError?.includes('Unable to connect')) {
                addLog('💡 Error koneksi database. Pastikan SQL Gateway dan database server berjalan.', 'error');
            }
        } finally {
            setIsHistoryRunning(false);
        }
    };

    // Force reset stuck seeder
    const handleResetSeeder = async () => {
        if (!window.confirm('⚠️ Apakah Anda yakin ingin mereset seeder yang sedang berjalan?\n\nIni akan membatalkan proses seeding yang sedang berjalan dan memungkinkan Anda untuk memulai ulang.')) {
            return;
        }

        addLog('='.repeat(40), 'info');
        addLog('🔄 Force resetting History Seeder...', 'warn');

        try {
            const result = await resetSeeder(token, 'Manual reset from UI by user');
            if (result.success) {
                addLog('✅ Seeder has been reset successfully', 'success');
                addLog(`📝 Reason: ${result.reason || 'Manual reset'}`, 'info');
                setSeederProgress(null);
            } else {
                addLog(`❌ Failed to reset seeder: ${result.error}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Reset error: ${e.message}`, 'error');
        }
    };

    // Clear logs
    const handleClearLogs = () => {
        setLogs([]);
    };

    // Run PTKP Preview
    const handlePreviewPtkp = async () => {
        if (isPtkpRunning) return;
        if (historyConnectionStatus !== 'connected') {
            addLog('❌ History DB not connected. Cannot preview PTKP.', 'error');
            return;
        }

        setIsPtkpRunning(true);
        setPtkpOperation('rice-preview');
        addLog('='.repeat(40), 'info');
        addLog(`🔍 Previewing PTKP Update for Year ${year}...`);

        try {
            const res = await previewPtkpTax(token, year);
            if (res.success) {
                const { total_employees, existing_records, distribution } = res.data;
                addLog(`✅ Preview successful`, 'success');
                addLog(`👥 Total Karyawan Aktif: ${total_employees}`);
                addLog(`📂 Data Lama di Tabel: ${existing_records}`);

                addLog('📊 Distribusi PTKP Baru:');
                Object.entries(distribution).forEach(([ptkp, count]) => {
                    addLog(`   • Status ${ptkp}: ${count} Karyawan`);
                });
            } else {
                addLog(`❌ Preview failed: ${res.error}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Preview error: ${e.message}`, 'error');
        } finally {
            setIsPtkpRunning(false);
            setPtkpOperation(null);
        }
    };

    // Run Excel PTKP dry-run
    const handlePreviewExcelPtkp = async () => {
        if (isPtkpRunning) return;
        if (historyConnectionStatus !== 'connected') {
            addLog('ERROR: History DB not connected. Cannot dry-run Excel PTKP.', 'error');
            return;
        }

        setIsPtkpRunning(true);
        setPtkpOperation('excel-dry-run');
        addLog('='.repeat(40), 'info');
        addLog(`DRY RUN Excel PTKP for Year ${year}...`);

        try {
            const res = await previewExcelPtkpTax(token, year, true);
            if (res.success) {
                const {
                    parsed_file_path,
                    total_employees,
                    records_inserted,
                    records_updated,
                    records_skipped,
                    summary
                } = res.data;
                addLog('DRY RUN only - no database changes were made.', 'warn');
                addLog(`Parsed JSON: ${parsed_file_path}`);
                addLog(`Rows parsed: ${summary?.total_rows ?? total_employees}`);
                addLog(`Would insert: ${records_inserted}`);
                addLog(`Would update: ${records_updated}`);
                addLog(`Would skip/no write: ${records_skipped}`);
                addLog(`Already same: ${summary?.already_same ?? 0}`);
                addLog(`Validation skipped: ${summary?.skipped ?? 0}`);
                addLog(`Warnings: ${summary?.warnings ?? 0}`);

                if (summary?.by_action) {
                    addLog('Action summary:');
                    Object.entries(summary.by_action).forEach(([action, count]) => {
                        addLog(`   - ${action}: ${count}`);
                    });
                }
            } else {
                addLog(`Excel PTKP dry-run failed: ${res.error}`, 'error');
                if (res.errors?.length > 0) {
                    res.errors.forEach(err => addLog(`   - ${err}`, 'error'));
                }
            }
        } catch (e) {
            addLog(`Excel PTKP dry-run error: ${e.message}`, 'error');
        } finally {
            setIsPtkpRunning(false);
            setPtkpOperation(null);
        }
    };

    // Run PTKP Update
    const handleRunPtkpUpdate = async () => {
        if (isPtkpRunning) return;
        if (historyConnectionStatus !== 'connected') {
            addLog('❌ History DB not connected. Cannot update PTKP.', 'error');
            return;
        }

        if (!window.confirm(`Anda yakin ingin melakukan update PTKP untuk tahun ${year}? Semua perhitungan pada tahun ini akan terpengaruh.`)) {
            return;
        }

        setIsPtkpRunning(true);
        setPtkpOperation('update');
        addLog('='.repeat(40), 'info');
        addLog(`🚀 Starting PTKP Update for Year ${year}...`);

        try {
            const res = await updatePtkpTax(token, year);
            if (res.success) {
                const { records_inserted, records_updated, records_skipped } = res.data;
                addLog(`✅ Update PTKP Selesai!`, 'success');
                addLog(`📋 Inserted: ${records_inserted}`);
                addLog(`🔄 Updated: ${records_updated}`);
                addLog(`⏭️ Skipped: ${records_skipped}`);
            } else {
                addLog(`❌ Update PTKP failed: ${res.error}`, 'error');
                if (res.errors?.length > 0) {
                    res.errors.forEach(err => addLog(`   • ${err}`, 'error'));
                }
            }
        } catch (e) {
            addLog(`❌ Update error: ${e.message}`, 'error');
        } finally {
            setIsPtkpRunning(false);
            setPtkpOperation(null);
        }
    };

    // Month options
    const monthOptions = Array.from({ length: 12 }, (_, i) => ({
        value: i + 1,
        label: formatMonthName(i + 1)
    }));

    // Year options
    const yearOptions = Array.from({ length: 7 }, (_, i) => 2020 + i);

    return (
        <div className="agg-container">
            {/* Header */}
            <div className="agg-header">
                <div className="agg-header-left">
                    {onBack && (
                        <button onClick={onBack} className="agg-btn agg-btn-back">
                            ← Kembali
                        </button>
                    )}
                    <div className="agg-title-block">
                        <h1 className="agg-title">📊 Aggregation Seeder</h1>
                        <p className="agg-subtitle">Seed payroll aggregation data to extend_db_ptrj</p>
                    </div>
                </div>
                <div className="agg-header-right">
                    <span className={`agg-connection-badge ${connectionStatus}`}>
                        {connectionStatus === 'connected' && '✅ Connected'}
                        {connectionStatus === 'checking' && '🔄 Checking...'}
                        {connectionStatus === 'error' && '❌ Disconnected'}
                    </span>
                </div>
            </div>

            <div className="agg-content">
                {/* Left Panel - Parameters & Actions */}
                <div className="agg-panel agg-params-panel">
                    <h2 className="agg-panel-title">Parameters</h2>

                    {/* Division */}
                    <div className="agg-form-group">
                        <label>Division</label>
                        <select
                            value={division}
                            onChange={(e) => setDivision(e.target.value)}
                            disabled={isRunning || isAutoBufferSeeding || isManualSyncSeeding}
                        >
                            {divisions.map(d => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                    </div>

                    {/* Month */}
                    <div className="agg-form-group">
                        <label>Month</label>
                        <select
                            value={month}
                            onChange={(e) => setMonth(parseInt(e.target.value))}
                            disabled={isRunning || isAutoBufferSeeding || isManualSyncSeeding}
                        >
                            {monthOptions.map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Year */}
                    <div className="agg-form-group">
                        <label>Year</label>
                        <select
                            value={year}
                            onChange={(e) => setYear(parseInt(e.target.value))}
                            disabled={isRunning || isAutoBufferSeeding || isManualSyncSeeding}
                        >
                            {yearOptions.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>

                    {/* Sync Type */}
                    <div className="agg-form-group">
                        <label>Sync Type</label>
                        <select
                            value={syncType}
                            onChange={(e) => setSyncType(e.target.value)}
                            disabled={isRunning || isSyncing || isAutoBufferSeeding || isManualSyncSeeding}
                        >
                            <option value="DAFTAR_UPAH">Daftar Upah</option>
                            <option value="OTHER_REPORT" disabled>Laporan Lain (Coming Soon)</option>
                        </select>
                    </div>

                    <hr className="agg-divider" />

                    {/* Action Buttons */}
                    <button
                        onClick={handleRunSeeder}
                        disabled={isRunning || isAutoBufferSeeding || isManualSyncSeeding || connectionStatus !== 'connected'}
                        className="agg-btn agg-btn-primary"
                    >
                        {isRunning ? '⏳ Running...' : '🚀 Run Seeder'}
                    </button>

                    <button
                        onClick={handleSeedAutoBuffer}
                        disabled={isRunning || isSyncing || isHistoryRunning || isAutoBufferSeeding || isManualSyncSeeding || connectionStatus !== 'connected'}
                        className="agg-btn"
                        style={{ backgroundColor: '#f59e0b', borderColor: '#d97706', color: 'white', marginTop: '8px' }}
                    >
                        {isAutoBufferSeeding ? 'â³ Seeding Auto Buffer...' : 'ðŸ§ª Seed Auto Buffer -> Manual Adj'}
                    </button>

                    <button
                        onClick={handleSeedManualSyncStatus}
                        disabled={isRunning || isSyncing || isHistoryRunning || isAutoBufferSeeding || isManualSyncSeeding || connectionStatus !== 'connected'}
                        className="agg-btn"
                        style={{ backgroundColor: '#2563eb', borderColor: '#1d4ed8', color: 'white', marginTop: '8px' }}
                    >
                        {isManualSyncSeeding ? 'Updating Sync Status...' : 'Update Sync Status Manual Adj'}
                    </button>

                    <button
                        onClick={handleSyncSpreadsheet}
                        disabled={isRunning || isSyncing || isAutoBufferSeeding || isManualSyncSeeding || connectionStatus !== 'connected'}
                        className="agg-btn agg-btn-success"
                        style={{ backgroundColor: '#10b981', borderColor: '#059669', color: 'white', marginTop: '8px' }}
                    >
                        {isSyncing ? '⏳ Syncing...' : 'sheets Sync to Spreadsheet'}
                    </button>

                    <button
                        onClick={handleCheckStatus}
                        disabled={isRunning || isSyncing || isAutoBufferSeeding || isManualSyncSeeding}
                        className="agg-btn agg-btn-secondary"
                    >
                        🔍 Check Status
                    </button>

                    <button
                        onClick={handleViewSummary}
                        disabled={isRunning || isAutoBufferSeeding || isManualSyncSeeding}
                        className="agg-btn agg-btn-secondary"
                    >
                        📈 View Summary
                    </button>

                    <hr className="agg-divider" />

                    <h3 className="agg-panel-subtitle" style={{ marginTop: '20px', fontSize: '14px', color: '#6b7280' }}>⚙️ History Operations</h3>

                    <div className="agg-form-group">
                        <label>History Seeder Type</label>
                        <select
                            value={historySeederType}
                            onChange={(e) => setHistorySeederType(e.target.value)}
                            disabled={isHistoryRunning || isRunning || isAutoBufferSeeding || isManualSyncSeeding}
                        >
                            <option value="PAYROLL">Payroll & Transactions (Master/Detail)</option>
                            <option value="EMPLOYEE_HR">Data Karyawan (HR Employee)</option>
                            <option value="GANG_HR">Data Kemandoran (HR Gang)</option>
                            <option value="ALL_HR">Semua Data HR</option>
                            <option value="ALL">Semua Data (Payroll + HR)</option>
                        </select>
                        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '6px', lineHeight: '1.5', padding: '8px', backgroundColor: '#f9fafb', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
                            {historySeederType === 'PAYROLL' && (
                                <span>📋 <strong>Payroll & Transactions</strong> — Menyimpan snapshot lengkap daftar upah ke tabel history (header + detail). Termasuk gaji pokok, tunjangan, potongan, lembur, dan panen. <em>Proses ini membutuhkan waktu ±2-5 menit untuk seluruh divisi.</em></span>
                            )}
                            {historySeederType === 'EMPLOYEE_HR' && (
                                <span>👤 <strong>Data Karyawan</strong> — Menyimpan data master karyawan (NIK, nama, jabatan, divisi, tanggal masuk). Digunakan untuk profil HR dan career tracking.</span>
                            )}
                            {historySeederType === 'GANG_HR' && (
                                <span>👥 <strong>Data Kemandoran</strong> — Menyimpan struktur gang/kemandoran dan relasinya ke divisi.</span>
                            )}
                            {historySeederType === 'ALL_HR' && (
                                <span>🏢 <strong>Semua Data HR</strong> — Menjalankan seed Employee + Gang sekaligus. Tidak termasuk data payroll/upah.</span>
                            )}
                            {historySeederType === 'ALL' && (
                                <span>⚡ <strong>Semua Data</strong> — Menjalankan Payroll + Employee + Gang sekaligus. <em>Proses terlama, bisa memakan waktu ±5-10 menit.</em></span>
                            )}
                        </div>
                    </div>

                    {/* Seeder Progress Indicator */}
                    {(isHistoryRunning || (seederProgress && seederProgress.is_running)) && seederProgress && (
                        <div style={{
                            padding: '10px 12px',
                            backgroundColor: '#ede9fe',
                            borderRadius: '6px',
                            border: '1px solid #c4b5fd',
                            marginTop: '8px',
                            fontSize: '12px'
                        }}>
                            <div style={{ fontWeight: 600, color: '#6d28d9', marginBottom: '6px' }}>
                                🔄 {seederProgress.current_step}
                            </div>
                            {seederProgress.current_division && (
                                <div style={{ color: '#7c3aed', marginBottom: '4px' }}>
                                    📍 Divisi: {seederProgress.current_division} | Periode: {seederProgress.period}
                                </div>
                            )}
                            {seederProgress.gangs_total > 0 && (
                                <>
                                    <div style={{
                                        width: '100%', height: '8px', backgroundColor: '#ddd5f3',
                                        borderRadius: '4px', overflow: 'hidden', marginBottom: '4px'
                                    }}>
                                        <div style={{
                                            width: `${Math.round((seederProgress.gangs_done / seederProgress.gangs_total) * 100)}%`,
                                            height: '100%', backgroundColor: '#7c3aed',
                                            borderRadius: '4px', transition: 'width 0.5s ease'
                                        }} />
                                    </div>
                                    <div style={{ color: '#6b7280' }}>
                                        Gang: {seederProgress.gangs_done}/{seederProgress.gangs_total}
                                        {seederProgress.current_gang && ` — ${seederProgress.current_gang}`}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Show completion status */}
                    {seederProgress && !seederProgress.is_running && seederProgress.current_step && seederProgress.current_step !== 'idle' && !isHistoryRunning && (
                        <div style={{
                            padding: '8px 12px', borderRadius: '6px', marginTop: '8px', fontSize: '12px',
                            backgroundColor: seederProgress.current_step.includes('✅') ? '#ecfdf5' : '#fef2f2',
                            border: `1px solid ${seederProgress.current_step.includes('✅') ? '#a7f3d0' : '#fecaca'}`,
                            color: seederProgress.current_step.includes('✅') ? '#065f46' : '#991b1b'
                        }}>
                            {seederProgress.current_step}
                        </div>
                    )}

                    <button
                        onClick={handleRunHistorySeeder}
                        disabled={isHistoryRunning || isRunning || isAutoBufferSeeding || isManualSyncSeeding || historyConnectionStatus !== 'connected'}
                        className="agg-btn"
                        style={{
                            backgroundColor: '#8b5cf6',
                            borderColor: '#7c3aed',
                            color: 'white',
                            marginTop: '8px'
                        }}
                        title="Simpan data lengkap ke history tables (terpisah dari aggregation)"
                    >
                        {isHistoryRunning ? '⏳ Saving History...' : '💾 Save to History'}
                    </button>

                    {/* Reset Button - Show only when seeder is stuck or running */}
                    {(isHistoryRunning || (seederProgress && seederProgress.is_running)) && (
                        <button
                            onClick={handleResetSeeder}
                            className="agg-btn"
                            style={{
                                backgroundColor: '#f59e0b',
                                borderColor: '#d97706',
                                color: 'white',
                                marginTop: '8px',
                                width: '100%'
                            }}
                            title="Force reset seeder yang sedang berjalan (untuk stuck seeder)"
                        >
                            ⚠️ Reset Stuck Seeder
                        </button>
                    )}

                    <hr className="agg-divider" />

                    <h3 className="agg-panel-subtitle" style={{ marginTop: '20px', fontSize: '14px', color: '#6b7280' }}>💳 Master PTKP Operations</h3>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '6px', lineHeight: '1.5', padding: '8px', backgroundColor: '#fdf4ff', borderRadius: '4px', border: '1px solid #fbcfe8', marginBottom: '12px' }}>
                        Update dan kalkulasi status Penghasilan Tidak Kena Pajak (PTKP) tahunan berdasarkan Data Karyawan. Update ini dipengaruhi oleh 'Tahun' yang dipilih di parameter atas.
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                            onClick={handlePreviewPtkp}
                            disabled={isPtkpRunning || isHistoryRunning || isRunning || isAutoBufferSeeding || isManualSyncSeeding || historyConnectionStatus !== 'connected'}
                            className="agg-btn"
                            style={{
                                flex: '1 1 140px',
                                backgroundColor: '#f0fdf4',
                                borderColor: '#bbf7d0',
                                color: '#166534',
                            }}
                            title="Preview data karyawan dan distribusi PTKP pajak (Tidak mengubah database)"
                        >
                            {isPtkpRunning && ptkpOperation === 'rice-preview' ? '⏳ Previewing...' : '🔍 Preview PTKP'}
                        </button>

                        <button
                            onClick={handlePreviewExcelPtkp}
                            disabled={isPtkpRunning || isHistoryRunning || isRunning || isAutoBufferSeeding || isManualSyncSeeding || historyConnectionStatus !== 'connected'}
                            className="agg-btn"
                            style={{
                                flex: '1 1 170px',
                                backgroundColor: '#eff6ff',
                                borderColor: '#bfdbfe',
                                color: '#1d4ed8',
                            }}
                            title="Dry-run update PTKP dari JSON parsing Excel tanpa mengubah database"
                        >
                            {isPtkpRunning && ptkpOperation === 'excel-dry-run' ? 'Dry-running...' : 'DRY RUN Excel PTKP'}
                        </button>

                        <button
                            onClick={handleRunPtkpUpdate}
                            disabled={isPtkpRunning || isHistoryRunning || isRunning || isAutoBufferSeeding || isManualSyncSeeding || historyConnectionStatus !== 'connected'}
                            className="agg-btn"
                            style={{
                                flex: '2 1 190px',
                                backgroundColor: '#db2777',
                                borderColor: '#be185d',
                                color: 'white',
                            }}
                            title="Update Master PTKP untuk seluruh karyawan di tahun yang dipilih"
                        >
                            {isPtkpRunning && ptkpOperation === 'update' ? '⏳ Updating...' : '📝 Execute PTKP Update'}
                        </button>
                    </div>

                    <hr className="agg-divider" />

                    <button
                        onClick={handleClearLogs}
                        className="agg-btn agg-btn-outline"
                    >
                        🗑️ Clear Log
                    </button>
                </div>

                {/* Right Panel - Log / Summary */}
                <div className="agg-panel agg-log-panel">
                    <div className="agg-panel-header">
                        <h2 className="agg-panel-title">
                            {showSummary ? 'Division Summary' : 'Log'}
                        </h2>
                        {showSummary && (
                            <button
                                onClick={() => setShowSummary(false)}
                                className="agg-btn agg-btn-sm"
                            >
                                ← Back to Log
                            </button>
                        )}
                    </div>

                    {showSummary ? (
                        /* Summary Table */
                        <div className="agg-summary-table-wrapper">
                            <table className="agg-summary-table">
                                <thead>
                                    <tr>
                                        <th>Division</th>
                                        <th>Gangs</th>
                                        <th>Employees</th>
                                        <th>HK</th>
                                        <th>Total Upah</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summaryData.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="agg-empty-row">
                                                No data for this period
                                            </td>
                                        </tr>
                                    ) : (
                                        summaryData.map((row, idx) => (
                                            <tr key={idx}>
                                                <td>{row.division_code}</td>
                                                <td className="text-right">{formatNumber(row.gang_count)}</td>
                                                <td className="text-right">{formatNumber(row.total_emp)}</td>
                                                <td className="text-right">{formatNumber(row.total_hk)}</td>
                                                <td className="text-right">{formatCurrency(row.total_upah)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                                {grandTotal && (
                                    <tfoot>
                                        <tr className="agg-total-row">
                                            <td>TOTAL</td>
                                            <td className="text-right">{formatNumber(grandTotal.gang_count)}</td>
                                            <td className="text-right">{formatNumber(grandTotal.total_emp)}</td>
                                            <td className="text-right">{formatNumber(grandTotal.total_hk)}</td>
                                            <td className="text-right">{formatCurrency(grandTotal.total_upah)}</td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    ) : (
                        /* Log Panel */
                        <div className="agg-log-content">
                            {logs.length === 0 ? (
                                <div className="agg-log-empty">
                                    Waiting for action...
                                </div>
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
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="agg-footer">
                <span>User: {user?.username}</span>
                <span>Period: {formatMonthName(month)} {year}</span>
            </div>
        </div>
    );
}
