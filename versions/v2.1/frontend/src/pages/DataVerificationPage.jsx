import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import LoadingScreen from '../components/common/LoadingScreen';
import { Search, AlertTriangle, CheckCircle, XCircle, Info, Download, RefreshCw, Filter, ChevronDown, ChevronRight } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';

const STATUS_CONFIG = {
    MATCH: { color: '#047857', bg: '#ecfdf5', icon: CheckCircle, label: 'Sama' },
    MISMATCH: { color: '#b45309', bg: '#fffbeb', icon: AlertTriangle, label: 'Beda' },
    MISSING_IN_DISPLAY: { color: '#dc2626', bg: '#fef2f2', icon: XCircle, label: 'Tidak Ada di Display' },
    MISSING_IN_SOURCE: { color: '#dc2626', bg: '#fef2f2', icon: XCircle, label: 'Tidak Ada di Source' },
    NO_MATCH_IN_DB_PTRJ: { color: '#2563eb', bg: '#eff6ff', icon: Info, label: 'Tidak Ada di DB_PTRJ' },
    MISSING: { color: '#dc2626', bg: '#fef2f2', icon: XCircle, label: 'Tidak Ada' },
    EXTRA_IN_ADJUSTMENTS: { color: '#7c3aed', bg: '#f5f3ff', icon: Info, label: 'Extra di Adjustment' }
};

const SOURCE_LABELS = {
    adtrans: 'DocDesc / ADTrans',
    taskregln_hk: 'HK / Kehadiran',
    taskregln_lembur: 'Lembur',
    hr_payroll: 'Gaji Pokok',
    hr_employee: 'Identitas',
    manual_adjustments: 'Manual Adj'
};

const TAB_OPTIONS = [
    { key: 'all', label: 'Semua' },
    { key: 'adtrans', label: 'DocDesc / ADTrans' },
    { key: 'taskregln_hk', label: 'HK / Kehadiran' },
    { key: 'taskregln_lembur', label: 'Lembur' },
    { key: 'hr_payroll', label: 'Gaji Pokok' },
    { key: 'hr_employee', label: 'Identitas' },
    { key: 'manual_adjustments', label: 'Manual Adj' }
];

function formatNumber(value) {
    if (value === null || value === undefined || value === '') return '-';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
}

function formatDiff(diff) {
    if (diff === null || diff === undefined) return '-';
    const n = Number(diff);
    if (!Number.isFinite(n)) return '-';
    const formatted = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Math.abs(n));
    return n > 0 ? `+${formatted}` : n < 0 ? `-${formatted}` : '0';
}

export default function DataVerificationPage() {
    const { token } = useAuth();
    const { division, month, year, allDivisions } = useReport();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [activeTab, setActiveTab] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedRows, setExpandedRows] = useState(new Set());

    const runVerification = useCallback(async () => {
        if (!division || !month || !year || !token) return;
        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const res = await fetch(`${API_BASE_URL}/payroll/verify/full-by-api-key`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    period_month: Number(month),
                    period_year: Number(year),
                    division_code: division,
                    source_filter: activeTab === 'all' ? undefined : [activeTab]
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            setResult(data.data || data);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [division, month, year, token, activeTab]);

    useEffect(() => {
        if (division && month && year && token) {
            runVerification();
        }
    }, [division, month, year, token]);

    const filteredComparisons = useMemo(() => {
        if (!result?.comparisons) return [];
        let items = result.comparisons;

        if (activeTab !== 'all') {
            items = items.filter(c => c.source === activeTab);
        }

        if (statusFilter !== 'all') {
            items = items.filter(c => c.status === statusFilter);
        }

        if (searchQuery.trim()) {
            const q = searchQuery.trim().toUpperCase();
            items = items.filter(c =>
                (c.emp_code || '').toUpperCase().includes(q) ||
                (c.nik || '').toUpperCase().includes(q) ||
                (c.nama || '').toUpperCase().includes(q) ||
                (c.field || '').toUpperCase().includes(q)
            );
        }

        return items;
    }, [result, activeTab, statusFilter, searchQuery]);

    const summary = result?.summary;

    const toggleRow = (idx) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const exportCSV = () => {
        if (!filteredComparisons.length) return;
        const headers = ['Emp Code', 'NIK', 'Nama', 'Gang', 'Source', 'Field', 'DB_PTRJ Value', 'Display Value', 'Diff', 'Status'];
        const rows = filteredComparisons.map(c => [
            c.emp_code, c.nik || '', c.nama || '', c.gang_code || '',
            c.source, c.field,
            c.db_ptrj_value ?? '', c.display_value ?? '', c.diff ?? '', c.status
        ]);
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `verification_${division}_${month}_${year}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    Data Verification Report
                </h1>
                <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.35rem 0 0' }}>
                    Periode {month}/{year} — Divisi {division}
                </p>
            </div>

            {/* Summary Cards */}
            {summary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {[
                        { label: 'Total Cek', value: summary.total_checks, color: '#334155', bg: '#f8fafc' },
                        { label: 'Sama', value: summary.match_count, color: '#047857', bg: '#ecfdf5' },
                        { label: 'Beda', value: summary.mismatch_count, color: '#b45309', bg: '#fffbeb' },
                        { label: 'Tidak Ada di Display', value: summary.missing_in_display, color: '#dc2626', bg: '#fef2f2' },
                        { label: 'Tidak Ada di Source', value: summary.missing_in_source, color: '#dc2626', bg: '#fef2f2' },
                        { label: 'Tidak Ada di DB_PTRJ', value: summary.no_match_in_db_ptrj, color: '#2563eb', bg: '#eff6ff' }
                    ].map(card => (
                        <div key={card.label} style={{ background: card.bg, border: `1px solid ${card.color}22`, borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: card.color }}>{formatNumber(card.value)}</div>
                            <div style={{ fontSize: '0.75rem', color: card.color, fontWeight: 600, marginTop: '0.15rem' }}>{card.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Source Breakdown */}
            {summary?.by_source && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569', margin: '0 0 0.75rem' }}>Breakdown per Sumber Data</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                        {Object.entries(summary.by_source).map(([source, data]) => (
                            <div key={source} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#fff', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155' }}>{SOURCE_LABELS[source] || source}</span>
                                <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem' }}>
                                    <span style={{ color: '#047857', fontWeight: 700 }}>{data.match}✓</span>
                                    <span style={{ color: '#b45309', fontWeight: 700 }}>{data.mismatch}!</span>
                                    <span style={{ color: '#dc2626', fontWeight: 700 }}>{data.missing_in_display + data.missing_in_source}✗</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Tabs + Filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
                {TAB_OPTIONS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => { setActiveTab(tab.key); setStatusFilter('all'); }}
                        style={{
                            padding: '0.4rem 0.85rem',
                            fontSize: '0.78rem',
                            fontWeight: activeTab === tab.key ? 700 : 500,
                            border: `1px solid ${activeTab === tab.key ? '#3b82f6' : '#cbd5e1'}`,
                            borderRadius: '6px',
                            background: activeTab === tab.key ? '#3b82f6' : '#fff',
                            color: activeTab === tab.key ? '#fff' : '#475569',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                        }}
                    >
                        {tab.label}
                    </button>
                ))}

                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff' }}
                    >
                        <option value="all">Semua Status</option>
                        <option value="MATCH">Sama</option>
                        <option value="MISMATCH">Beda</option>
                        <option value="MISSING_IN_DISPLAY">Tidak Ada di Display</option>
                        <option value="MISSING_IN_SOURCE">Tidak Ada di Source</option>
                        <option value="NO_MATCH_IN_DB_PTRJ">Tidak Ada di DB_PTRJ</option>
                    </select>

                    <div style={{ position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <input
                            type="text"
                            placeholder="Cari emp/NIK/field..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            style={{ padding: '0.35rem 0.6rem 0.35rem 1.75rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px', width: '180px' }}
                        />
                    </div>

                    <button onClick={runVerification} disabled={loading} style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <RefreshCw size={12} /> Refresh
                    </button>

                    <button onClick={exportCSV} disabled={!filteredComparisons.length} style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Download size={12} /> CSV
                    </button>
                </div>
            </div>

            {/* Loading / Error */}
            {loading && <LoadingScreen isLoading={loading} message="Memverifikasi data..." />}
            {error && (
                <div style={{ padding: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.85rem' }}>
                    Error: {error}
                </div>
            )}

            {/* Detail Table */}
            {!loading && !error && filteredComparisons.length > 0 && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                            <thead>
                                <tr style={{ background: '#f1f5f9' }}>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}></th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>Emp Code</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>NIK</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>Nama</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>Source</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>Field</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>DB_PTRJ</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>Display</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'right', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>Diff</th>
                                    <th style={{ padding: '0.55rem 0.65rem', textAlign: 'center', fontWeight: 700, color: '#334155', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredComparisons.slice(0, 500).map((item, idx) => {
                                    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.MISMATCH;
                                    const Icon = cfg.icon;
                                    const isExpanded = expandedRows.has(idx);
                                    const hasDetails = item.db_ptrj_detail && Object.keys(item.db_ptrj_detail).length > 0;

                                    return (
                                        <React.Fragment key={idx}>
                                            <tr style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                                <td style={{ padding: '0.35rem 0.45rem', borderBottom: '1px solid #e2e8f0', width: '24px' }}>
                                                    {hasDetails && (
                                                        <button onClick={() => toggleRow(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#94a3b8' }}>
                                                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                        </button>
                                                    )}
                                                </td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', fontWeight: 600, color: '#334155' }}>{item.emp_code}</td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>{item.nik || '-'}</td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', color: '#334155' }}>{item.nama || '-'}</td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0' }}>
                                                    <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                                                        {SOURCE_LABELS[item.source] || item.source}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', fontWeight: 600, color: '#334155' }}>{item.field}</td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatNumber(item.db_ptrj_value)}</td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatNumber(item.display_value)}</td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: item.diff && Math.abs(Number(item.diff)) > 0.01 ? '#b45309' : '#94a3b8', fontWeight: 700 }}>{formatDiff(item.diff)}</td>
                                                <td style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '9999px', background: cfg.bg, color: cfg.color, fontWeight: 700 }}>
                                                        <Icon size={11} /> {cfg.label}
                                                    </span>
                                                </td>
                                            </tr>
                                            {isExpanded && hasDetails && (
                                                <tr style={{ background: '#f8fafc' }}>
                                                    <td colSpan={10} style={{ padding: '0.5rem 0.65rem 0.5rem 2rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.72rem', color: '#475569' }}>
                                                        <strong>Detail:</strong> {JSON.stringify(item.db_ptrj_detail, null, 2)}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {filteredComparisons.length > 500 && (
                        <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.78rem', color: '#64748b', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                            Menampilkan 500 dari {filteredComparisons.length} item. Gunakan filter untuk mempersempit hasil.
                        </div>
                    )}
                </div>
            )}

            {!loading && !error && filteredComparisons.length === 0 && result && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                    Tidak ada data ditemukan untuk filter yang dipilih.
                </div>
            )}

            {!result && !loading && !error && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                    Pilih divisi dan periode, lalu klik Refresh untuk menjalankan verifikasi.
                </div>
            )}
        </div>
    );
}
