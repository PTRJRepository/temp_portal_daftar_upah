/**
 * usePayrollStream.js
 *
 * Custom hook for consuming the SSE streaming endpoint for progressive payroll data.
 * Consumes Server-Sent Events (SSE) from `/payroll/report/division-raw-tree/stream`
 * and provides progressive state updates for the table.
 *
 * Features:
 * - TRUE progressive streaming (chunk-by-chunk, not waiting for full response)
 * - Proper SSE parsing that handles chunk boundaries
 * - Gang-by-gang progressive rendering
 * - Loading state management
 * - Error handling with progress tracking
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { appendSnapshotVersionToSearchParams } from '../utils/payrollSnapshotQuery';
import { resolveEffectiveGangPrefix } from '../utils/payrollRequestScope';

/**
 * Main stream hook
 *
 * @param {Object} params
 * @param {string} params.token - Auth token
 * @param {string} params.division - Division code
 * @param {number} params.month - Month (1-12)
 * @param {number} params.year - Year
 * @param {string|null} params.gangPrefix - Gang prefix filter
 * @param {string|null} params.gangCode - Specific gang code (or "ALL")
 * @param {boolean} params.useHistoryDb - Whether to force snapshot source
 * @param {string} params.valuePriorityMode - Source value priority mode
 * @param {boolean|null} params.enabled - Whether to start streaming
 *
 * @returns {Object} stream state
 */
export function usePayrollStream({ token, division, month, year, gangPrefix, gangCode, useHistoryDb, valuePriorityMode = 'non_db_ptrj', snapshotVersion, refreshTrigger = 0, enabled }) {
    const effectiveGangPrefix = resolveEffectiveGangPrefix(gangCode, gangPrefix, division);

    // State for gangs - array that grows progressively
    const [gangs, setGangs] = useState([]);           // Array of streamed gang objects
    const [meta, setMeta] = useState(null);           // Initial metadata from 'meta' event
    const [progress, setProgress] = useState({
        stage: null,                                  // null | 'connecting' | 'querying' | 'streaming' | 'complete' | 'error'
        message: '',
        processedGangs: 0,
        totalGangs: 0,
        processedEmployees: 0,
        totalEmployees: 0,
        bytesReceived: 0,
        currentGang: null,
        progressPct: 0,                               // 0-100 progressive percentage
        currentPhase: null                            // 'identity' | 'attendance' | 'overtime' | 'premium' | 'deductions' | 'complete'
    });
    const [grandTotal, setGrandTotal] = useState(null);
    const [error, setError] = useState(null);
    const [isComplete, setIsComplete] = useState(false);

    const abortControllerRef = useRef(null);
    const gangsMapRef = useRef({});                   // Track gangs by code for updates
    const mountedRef = useRef(true);

    const startStream = useCallback(async () => {
        console.log('[usePayrollStream] startStream called', { token: !!token, division, month, year, refreshTrigger, enabled });
        if (!token || !division || !month || !year || !enabled) return;

        // Abort any existing stream
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Reset state for new stream
        gangsMapRef.current = {};
        setGangs([]);
        setMeta(null);
        setGrandTotal(null);
        setError(null);
        setIsComplete(false);
        setProgress({
            stage: 'connecting',
            message: 'Menghubungi server...',
            processedGangs: 0,
            totalGangs: 0,
            processedEmployees: 0,
            totalEmployees: 0,
            bytesReceived: 0,
            currentGang: null,
            progressPct: 0,
            currentPhase: null
        });

        try {
            const params = new URLSearchParams({
                division_code: division,
                month: String(month),
                year: String(year),
                use_history: useHistoryDb ? 'true' : 'false'
            });
            if (valuePriorityMode) params.set('value_priority_mode', valuePriorityMode);
            if (effectiveGangPrefix) params.set('gang_prefix', effectiveGangPrefix);
            if (gangCode && gangCode !== 'ALL') params.set('gang_code', gangCode);
            appendSnapshotVersionToSearchParams(params, snapshotVersion);
            const url = `/payroll/report/division-raw-tree/stream?${params.toString()}`;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: controller.signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            if (!response.body) {
                throw new Error('No response body available');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // Process complete SSE events
                while (true) {
                    const delimiterIndex = buffer.indexOf('\n\n');
                    if (delimiterIndex === -1) break;

                    const eventString = buffer.slice(0, delimiterIndex + 2);
                    buffer = buffer.slice(delimiterIndex + 2);

                    const eventMatch = eventString.match(/^event: ([^\n]+)\ndata: ([\s\S]*?)\n\n$/);
                    if (!eventMatch) continue;

                    const eventName = eventMatch[1];
                    const eventData = eventMatch[2];

                    try {
                        const data = JSON.parse(eventData);

                        switch (eventName) {
                            case 'meta': {
                                gangsMapRef.current = {};
                                setMeta(data);
                                setProgress(prev => ({
                                    ...prev,
                                    stage: data.stage || 'querying',
                                    message: data.meta?.query_time_ms ? `Query selesai (${data.meta.query_time_ms}ms)` : 'Menunggu data...',
                                    totalGangs: data.total_gangs || 0,
                                    totalEmployees: data.total_employees || 0
                                }));
                                break;
                            }

                            case 'progress': {
                                setProgress(prev => ({
                                    ...prev,
                                    stage: data.stage || 'streaming',
                                    message: data.message || 'Memproses...',
                                    processedGangs: data.processed_gangs || prev.processedGangs,
                                    totalGangs: data.total_gangs || prev.totalGangs,
                                    processedEmployees: data.processed_employees || prev.processedEmployees,
                                    totalEmployees: data.total_employees || prev.totalEmployees,
                                    currentGang: data.current_gang || prev.currentGang,
                                    progressPct: data.progress_pct || (data.stage === 'complete' ? 100 : 0),
                                    currentPhase: data.current_phase || prev.currentPhase
                                }));
                                break;
                            }

                            case 'gang':
                            case 'gang_update': {
                                const { gang_code, employees, gang_totals, employees_count, gang_index, phase, is_complete } = data;

                                // Track if this gang data is from complete phase (fully enriched)
                                gangsMapRef.current[gang_code] = {
                                    gang_code,
                                    employees,
                                    gang_totals,
                                    employees_count,
                                    gang_index,
                                    phase,
                                    is_complete: is_complete || false
                                };

                                setGangs(prev => {
                                    const next = [...prev];
                                    const existingIdx = next.findIndex(g => g.gang_code === gang_code);
                                    if (existingIdx >= 0) {
                                        // Update existing gang - keep the most enriched version
                                        const existing = next[existingIdx];
                                        const existingPhase = existing.phase || 'identity';
                                        // Only update if new data is more enriched
                                        if ((phase === 'complete' && is_complete) || !existing.is_complete) {
                                            next[existingIdx] = gangsMapRef.current[gang_code];
                                        }
                                    } else {
                                        const insertIdx = next.findIndex(g => g.gang_code > gang_code);
                                        if (insertIdx >= 0) {
                                            next.splice(insertIdx, 0, gangsMapRef.current[gang_code]);
                                        } else {
                                            next.push(gangsMapRef.current[gang_code]);
                                        }
                                    }
                                    return next;
                                });
                                break;
                            }

                            case 'headers': {
                                // Update meta with dynamic headers when they arrive
                                setMeta(prev => ({
                                    ...(prev || {}),
                                    dynamic_premi_headers: data.dynamic_premi_headers || prev?.dynamic_premi_headers || [],
                                    dynamic_potongan_headers: data.dynamic_potongan_headers || prev?.dynamic_potongan_headers || [],
                                    premi_title_map: data.dynamic_premi_titles || prev?.premi_title_map || {},
                                    potongan_title_map: data.dynamic_potongan_titles || prev?.potongan_title_map || {},
                                    snapshot_version: data.snapshot_version ?? prev?.snapshot_version ?? null,
                                    requested_snapshot_version: data.requested_snapshot_version ?? prev?.requested_snapshot_version ?? null,
                                    available_snapshot_versions: data.available_snapshot_versions || prev?.available_snapshot_versions || [],
                                    is_history_snapshot: data.is_history_snapshot ?? prev?.is_history_snapshot ?? false
                                }));
                                break;
                            }

                            case 'complete': {
                                const gangsCount = data.gangs_count ?? data.total_gangs ?? 0;
                                const employeesCount = data.employees_count ?? data.total_employees ?? 0;
                                setGrandTotal(data.grand_total);
                                setIsComplete(true);
                                setProgress(prev => ({
                                    ...prev,
                                    stage: 'complete',
                                    message: `Selesai! ${gangsCount} gang, ${employeesCount} karyawan`,
                                    processedGangs: gangsCount,
                                    totalGangs: gangsCount,
                                    processedEmployees: employeesCount,
                                    totalEmployees: employeesCount,
                                    currentGang: null
                                }));
                                break;
                            }

                            case 'error': {
                                setError(data.message || 'Unknown error');
                                setProgress(prev => ({
                                    ...prev,
                                    stage: 'error',
                                    message: data.message || 'Error'
                                }));
                                break;
                            }
                        }
                    } catch (e) {
                        console.warn('[usePayrollStream] Parse error:', e.message);
                    }
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                return;
            }
            console.error('[usePayrollStream] Error:', err);
            setError(err.message);
            setProgress(prev => ({ ...prev, stage: 'error', message: err.message }));
        }
    }, [token, division, month, year, effectiveGangPrefix, gangCode, useHistoryDb, valuePriorityMode, snapshotVersion, refreshTrigger, enabled]);

    const abort = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            // Note: Do NOT set to null here. The abort() cleanup in useEffect runs
            // synchronously BEFORE the new effect body, which would break the abort
            // check in startStream (it checks `if (abortControllerRef.current)`).
            // We only abort, and let startStream create a fresh AbortController.
        }
    }, []);

    // Auto-start: re-run whenever any filter param or enabled changes.
    // We list ALL relevant params explicitly to guarantee a re-fetch on month/year/division change.
    // startStream captures all these via its own useCallback deps, so calling it here is always fresh.
    useEffect(() => {
        console.log('[usePayrollStream] Params/enabled changed, evaluating stream start', { enabled, division, month, year });
        mountedRef.current = true;
        if (enabled) {
            startStream();
        } else {
            abort();
        }
        return () => {
            mountedRef.current = false;
            abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, division, month, year, effectiveGangPrefix, gangCode, useHistoryDb, valuePriorityMode, snapshotVersion, refreshTrigger, token]);

    // Return stream object with all properties the component expects
    // Component uses: stream.gangs, stream.meta, stream.progress, stream.grandTotal, stream.error, stream.isComplete, stream.gangsMap
    return {
        // gangs array - grows progressively
        gangs,
        // metadata from 'meta' event
        meta,
        // progress info (stage, message, counts, etc)
        progress,
        // grand total from 'complete' event
        grandTotal,
        // error message if any
        error,
        // true when stream is complete
        isComplete,
        // map of gangs by code (for quick lookup)
        gangsMap: gangsMapRef.current,
        // start/abort functions
        startStream,
        abort,
        // total bytes received
        totalBytesReceived: progress.bytesReceived
    };
}
