import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
    fetchEmployeeWagesComparison,
    formatCurrency, 
    formatNumber, 
    getStatusBadge 
} from '../services/wagesService';
import './WagesVerificationSection.css';

/**
 * WagesVerificationSection - Shows wages verification for a specific employee and period
 * 
 * Displays:
 * - Comparison between daftar upah and wages
 * - Verification status badge
 * - Detailed breakdown of differences
 */
export default function WagesVerificationSection({ 
    empCode, 
    month, 
    year,
    payrollData = null // Optional: pass existing payroll data to avoid re-fetch
}) {
    const { token } = useAuth();
    const [comparison, setComparison] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (!token || !empCode || !month || !year) return;
        loadComparison();
    }, [token, empCode, month, year]);

    const loadComparison = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchEmployeeWagesComparison(token, empCode, month, year);
            setComparison(result);
        } catch (err) {
            console.error('Failed to load wages comparison:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="wvs-container wvs-loading">
                <div className="wvs-spinner"></div>
                <span>Memverifikasi...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="wvs-container wvs-error">
                <span className="wvs-error-icon">⚠</span>
                <span>Gagal memuat data wages</span>
            </div>
        );
    }

    if (!comparison) {
        return null;
    }

    const badge = getStatusBadge(comparison.comparison?.status);
    const hasDifference = comparison.comparison?.amount_difference !== 0;

    return (
        <div className={`wvs-container ${comparison.comparison?.status?.toLowerCase()}`}>
            {/* Header with status */}
            <div className="wvs-header" onClick={() => setExpanded(!expanded)}>
                <div className="wvs-title">
                    <span className="wvs-icon">💰</span>
                    <span>Verifikasi Upah Bersih</span>
                </div>
                <div className="wvs-status">
                    <span 
                        className="wvs-badge"
                        style={{ backgroundColor: badge.bgColor, color: badge.color }}
                    >
                        {badge.icon} {badge.label}
                    </span>
                    <button className="wvs-expand-btn">
                        {expanded ? '▼' : '▶'}
                    </button>
                </div>
            </div>

            {/* Quick summary */}
            <div className="wvs-quick-summary">
                <div className="wvs-summary-item">
                    <span className="wvs-label">Daftar Upah:</span>
                    <span className="wvs-value">{formatCurrency(comparison.daftar_upah?.upah_bersih)}</span>
                </div>
                <div className="wvs-summary-item">
                    <span className="wvs-label">Wages:</span>
                    <span className="wvs-value">
                        {comparison.wages 
                            ? formatCurrency(comparison.wages.upah_bersih)
                            : '- Tidak ada data -'}
                    </span>
                </div>
                {hasDifference && (
                    <div className="wvs-summary-item wvs-diff">
                        <span className="wvs-label">Selisih:</span>
                        <span className="wvs-value">
                            {comparison.comparison?.amount_difference > 0 ? '+' : ''}
                            {formatCurrency(comparison.comparison?.amount_difference)}
                        </span>
                    </div>
                )}
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div className="wvs-detail">
                    {/* Daftar Upah Detail */}
                    <div className="wvs-detail-section">
                        <h4>Daftar Upah (Calculated)</h4>
                        <div className="wvs-detail-grid">
                            <div className="wvs-detail-row">
                                <span>HK</span>
                                <span>{formatNumber(comparison.daftar_upah?.jumlah_hk)}</span>
                            </div>
                            <div className="wvs-detail-row">
                                <span>Gaji Pokok</span>
                                <span>{formatCurrency(comparison.daftar_upah?.gaji_pokok)}</span>
                            </div>
                            <div className="wvs-detail-row">
                                <span>Tunjangan</span>
                                <span>{formatCurrency(comparison.daftar_upah?.total_tunjangan)}</span>
                            </div>
                            <div className="wvs-detail-row">
                                <span>Premi</span>
                                <span>{formatCurrency(comparison.daftar_upah?.total_premi)}</span>
                            </div>
                            <div className="wvs-detail-row">
                                <span>Potongan</span>
                                <span className="wvs-neg">{formatCurrency(comparison.daftar_upah?.total_potongan)}</span>
                            </div>
                            <div className="wvs-detail-row wvs-total">
                                <span>Upah Bersih</span>
                                <span>{formatCurrency(comparison.daftar_upah?.upah_bersih)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Wages Detail */}
                    <div className="wvs-detail-section">
                        <h4>Wages (Paid)</h4>
                        {comparison.wages ? (
                            <div className="wvs-detail-grid">
                                <div className="wvs-detail-row">
                                    <span>No. Wages</span>
                                    <span className="wvs-dim">{comparison.wages.wages_no}</span>
                                </div>
                                <div className="wvs-detail-row">
                                    <span>Tanggal</span>
                                    <span className="wvs-dim">
                                        {comparison.wages.wages_date 
                                            ? new Date(comparison.wages.wages_date).toLocaleDateString('id-ID')
                                            : '-'}
                                    </span>
                                </div>
                                <div className="wvs-detail-row">
                                    <span>HK</span>
                                    <span>{formatNumber(comparison.wages.jumlah_hk)}</span>
                                </div>
                                <div className="wvs-detail-row">
                                    <span>Status</span>
                                    <span className="wvs-dim">{comparison.wages.payment_status || '-'}</span>
                                </div>
                                <div className="wvs-detail-row wvs-total">
                                    <span>Upah Bersih</span>
                                    <span>{formatCurrency(comparison.wages.upah_bersih)}</span>
                                </div>
                            </div>
                        ) : (
                            <p className="wvs-no-data">Tidak ada data wages untuk periode ini</p>
                        )}
                    </div>

                    {/* Comparison Analysis */}
                    <div className="wvs-detail-section wvs-analysis">
                        <h4>Analisis Perbedaan</h4>
                        <div className="wvs-comparison-grid">
                            <div className="wvs-comparison-item">
                                <span className="wvs-comp-label">HK Match</span>
                                <span className={`wvs-comp-value ${comparison.comparison?.hk_match ? 'match' : 'diff'}`}>
                                    {comparison.comparison?.hk_match ? '✓ Cocok' : '✗ Berbeda'}
                                </span>
                            </div>
                            <div className="wvs-comparison-item">
                                <span className="wvs-comp-label">Selisih HK</span>
                                <span className={`wvs-comp-value ${comparison.comparison?.hk_difference !== 0 ? 'diff' : ''}`}>
                                    {comparison.comparison?.hk_difference > 0 ? '+' : ''}
                                    {formatNumber(comparison.comparison?.hk_difference)}
                                </span>
                            </div>
                            <div className="wvs-comparison-item">
                                <span className="wvs-comp-label">Amount Match</span>
                                <span className={`wvs-comp-value ${comparison.comparison?.amount_match ? 'match' : 'diff'}`}>
                                    {comparison.comparison?.amount_match ? '✓ Cocok' : '✗ Berbeda'}
                                </span>
                            </div>
                            <div className="wvs-comparison-item">
                                <span className="wvs-comp-label">Selisih Amount</span>
                                <span className={`wvs-comp-value ${comparison.comparison?.amount_difference !== 0 ? 'diff' : ''}`}>
                                    {comparison.comparison?.amount_difference > 0 ? '+' : ''}
                                    {formatCurrency(comparison.comparison?.amount_difference)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
