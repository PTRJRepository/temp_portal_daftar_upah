import React from 'react';
import { formatDbPtrjCompareValue } from '../utils/payrollDbPtrjCompareReport';

const summaryItems = [
    { key: 'comparedCount', label: 'Dibandingkan', color: '#334155', background: '#f8fafc' },
    { key: 'matchCount', label: 'Sama', color: '#047857', background: '#ecfdf5' },
    { key: 'mismatchCount', label: 'Beda', color: '#b91c1c', background: '#fef2f2' }
];

const overlayStyle = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.46)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px'
};

const modalStyle = {
    width: 'min(1120px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 48px)',
    background: '#ffffff',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    boxShadow: '0 24px 80px rgba(15, 23, 42, 0.28)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
};

const cellStyle = {
    padding: '0.55rem 0.65rem',
    borderBottom: '1px solid #fecaca',
    fontSize: '0.78rem',
    verticalAlign: 'top'
};

const valueCellStyle = {
    ...cellStyle,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700
};

export default function DbPtrjCompareReportModal({ report, onClose }) {
    if (!report) return null;

    const mismatches = Array.isArray(report.mismatches) ? report.mismatches : [];
    const hasComparableData = Number(report.comparedCount || 0) > 0;
    const periodText = report.month && report.year ? `${report.month}/${report.year}` : '-';
    const scopeText = [
        report.division || 'ALL',
        report.gangPrefix ? `Group ${report.gangPrefix}` : null,
        report.gang && report.gang !== 'ALL' ? report.gang : 'Semua kemandoran',
        periodText
    ].filter(Boolean).join(' / ');

    return (
        <div style={overlayStyle} role="presentation">
            <section
                aria-modal="true"
                role="dialog"
                aria-labelledby="db-ptrj-compare-title"
                style={modalStyle}
            >
                <header style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                    <div>
                        <h2 id="db-ptrj-compare-title" style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: 800 }}>
                            Compare DB_PTRJ
                        </h2>
                        <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.82rem' }}>
                            Active = nilai backend/auto-buffer yang tampil sekarang, DB_PTRJ = nilai asli dari database pembanding.
                        </p>
                        <p style={{ margin: '0.25rem 0 0', color: '#475569', fontSize: '0.78rem', fontWeight: 600 }}>
                            {scopeText}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{ border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', borderRadius: '6px', padding: '0.45rem 0.75rem', cursor: 'pointer', fontWeight: 700 }}
                    >
                        Tutup
                    </button>
                </header>

                <div style={{ padding: '0.85rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.65rem', borderBottom: '1px solid #e2e8f0' }}>
                    {summaryItems.map((item) => (
                        <div key={item.key} style={{ background: item.background, border: `1px solid ${item.color}22`, borderRadius: '6px', padding: '0.65rem 0.75rem' }}>
                            <div style={{ color: '#64748b', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>{item.label}</div>
                            <div style={{ color: item.color, fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.2 }}>{formatDbPtrjCompareValue(report[item.key] || 0)}</div>
                        </div>
                    ))}
                </div>

                <div style={{ overflow: 'auto', padding: '1rem 1.25rem 1.25rem' }}>
                    {!hasComparableData ? (
                        <div style={{ border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '1.25rem', color: '#64748b', background: '#f8fafc', fontWeight: 600 }}>
                            Belum ada data compare DB_PTRJ pada baris Daftar Upah yang sedang tampil.
                        </div>
                    ) : mismatches.length === 0 ? (
                        <div style={{ border: '1px solid #bbf7d0', borderRadius: '8px', padding: '1.25rem', color: '#047857', background: '#ecfdf5', fontWeight: 700 }}>
                            Semua nilai compare DB_PTRJ sama.
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, border: '1px solid #fecaca', borderRadius: '8px', overflow: 'hidden' }}>
                            <thead>
                                <tr style={{ background: '#fee2e2', color: '#7f1d1d' }}>
                                    <th style={{ ...cellStyle, textAlign: 'left', borderBottom: '1px solid #fca5a5' }}>Gang</th>
                                    <th style={{ ...cellStyle, textAlign: 'left', borderBottom: '1px solid #fca5a5' }}>Emp Code</th>
                                    <th style={{ ...cellStyle, textAlign: 'left', borderBottom: '1px solid #fca5a5' }}>Nama</th>
                                    <th style={{ ...cellStyle, textAlign: 'left', borderBottom: '1px solid #fca5a5' }}>Field</th>
                                    <th style={{ ...cellStyle, textAlign: 'right', borderBottom: '1px solid #fca5a5' }}>Active</th>
                                    <th style={{ ...cellStyle, textAlign: 'right', borderBottom: '1px solid #fca5a5' }}>DB_PTRJ</th>
                                    <th style={{ ...cellStyle, textAlign: 'right', borderBottom: '1px solid #fca5a5' }}>Selisih</th>
                                </tr>
                            </thead>
                            <tbody>
                                {mismatches.map((row, index) => (
                                    <tr
                                        key={`${row.emp_code || row.nik || index}-${row.field || row.label || index}`}
                                        className="db-ptrj-compare-report__row--mismatch"
                                        style={{ background: '#fff1f2', boxShadow: 'inset 4px 0 0 #dc2626' }}
                                    >
                                        <td style={cellStyle}>{row.gang_code || '-'}</td>
                                        <td style={cellStyle}>{row.emp_code || row.nik || '-'}</td>
                                        <td style={cellStyle}>{row.nama || '-'}</td>
                                        <td style={{ ...cellStyle, fontWeight: 700, color: '#991b1b' }}>{row.label || row.field || '-'}</td>
                                        <td style={{ ...valueCellStyle, color: '#991b1b' }}>{formatDbPtrjCompareValue(row.active)}</td>
                                        <td style={{ ...valueCellStyle, color: '#991b1b' }}>{formatDbPtrjCompareValue(row.db_ptrj)}</td>
                                        <td style={{ ...valueCellStyle, color: '#7f1d1d' }}>{formatDbPtrjCompareValue(row.diff)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </section>
        </div>
    );
}
