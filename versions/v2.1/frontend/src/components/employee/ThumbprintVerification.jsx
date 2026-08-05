/**
 * ThumbprintVerification Component
 *
 * Displays thumbprint data to verify upah bersih matches wages data
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import './ThumbprintVerification.css';

export function ThumbprintVerification({ division, month, year, upahBersih }) {
    const { token } = useAuth();
    const [thumbprintData, setThumbprintData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    useEffect(() => {
        async function loadThumbprint() {
            if (!token || !division || !month || !year) return;

            setLoading(true);
            try {
                // Load thumbprint data from backend
                const baseUrl = '/api/thumbprint';
                const params = new URLSearchParams({
                    division: division,
                    month: month.toString(),
                    year: year.toString()
                });

                const response = await fetch(`${baseUrl}?${params}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    setThumbprintData(data);
                }
            } catch (err) {
                console.error('[ThumbprintVerification] Error:', err);
            } finally {
                setLoading(false);
            }
        }

        loadThumbprint();
    }, [token, division, month, year]);

    if (loading) {
        return <div className="thumbprint-verification loading">Memuat data thumbprint...</div>;
    }

    if (!thumbprintData) {
        return (
            <div className="thumbprint-verification no-data">
                <span className="info-icon">ℹ️</span>
                <span>Data thumbprint tidak tersedia untuk periode ini</span>
            </div>
        );
    }

    // Get thumbprint value for this period
    const periodKey = `${year}-${month.toString().padStart(2, '0')}`;
    const thumbprintValue = thumbprintData[periodKey];
    const thumbprintNumber = thumbprintValue ? parseFloat(thumbprintValue) : 0;

    // Calculate difference
    const difference = upahBersih ? (upahBersih - thumbprintNumber) : 0;
    const differencePercent = thumbprintNumber > 0 ? (difference / thumbprintNumber) * 100 : 0;
    const isMatch = Math.abs(difference) <= 1000; // Allow 1000 rupiah difference

    return (
        <div className={`thumbprint-verification ${isMatch ? 'match' : 'mismatch'}`}>
            <div className="verification-header" onClick={() => setShowDetails(!showDetails)}>
                <span className="verification-icon">{isMatch ? '✅' : '⚠️'}</span>
                <span className="verification-title">Verifikasi Thumbprint Wages</span>
                <span className="verification-status">
                    {isMatch ? 'COCK' : 'TIDAK COCOK'}
                </span>
                <span className="expand-icon">{showDetails ? '▼' : '▶'}</span>
            </div>

            <div className="verification-summary">
                <div className="summary-item">
                    <span className="label">Upah Bersih:</span>
                    <span className="value">{formatRupiah(upahBersih)}</span>
                </div>
                <div className="summary-item">
                    <span className="label">Thumbprint:</span>
                    <span className="value">{formatRupiah(thumbprintNumber)}</span>
                </div>
                <div className="summary-item diff">
                    <span className="label">Selisih:</span>
                    <span className={`value ${difference < 0 ? 'negative' : difference > 0 ? 'positive' : 'neutral'}`}>
                        {difference < 0 ? '-' : '+'}{formatRupiah(Math.abs(difference))}
                        {` (${differencePercent.toFixed(2)}%)`}
                    </span>
                </div>
            </div>

            {showDetails && (
                <div className="verification-details">
                    <h4>Detail Thumbprint Per Periode</h4>
                    <table className="thumbprint-table">
                        <thead>
                            <tr>
                                <th>Periode</th>
                                <th>Thumbprint</th>
                                <th>Selisih</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(thumbprintData).map(([key, value]) => {
                                const tpValue = parseFloat(value) || 0;
                                const diff = upahBersih ? upahBersih - tpValue : 0;
                                const isCurrentPeriod = key === periodKey;

                                return (
                                    <tr key={key} className={isCurrentPeriod ? 'current-period' : ''}>
                                        <td>{key}</td>
                                        <td className="number">{formatRupiah(tpValue)}</td>
                                        <td className={`number ${Math.abs(diff) <= 1000 ? 'match' : 'mismatch'}`}>
                                            {diff < 0 ? '-' : '+'}{formatRupiah(Math.abs(diff))}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="thumbprint-note">
                        <small>* Selisih maksimal yang diperbolehkan: Rp 1.000</small>
                    </p>
                </div>
            )}
        </div>
    );
}

function formatRupiah(value) {
    if (!value && value !== 0) return '-';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

/**
 * Compact version for inline display
 */
export function CompactThumbprintBadge({ thumbprintValue, actualValue }) {
    const difference = actualValue ? (actualValue - thumbprintValue) : 0;
    const isMatch = Math.abs(difference) <= 1000;

    return (
        <span className={`compact-thumbprint ${isMatch ? 'match' : 'mismatch'}`} title={`Thumbprint: ${formatRupiah(thumbprintValue)}, Selisih: ${difference < 0 ? '-' : '+'}${formatRupiah(Math.abs(difference))}`}>
            {isMatch ? '✅' : '⚠️'} Thumbprint: {formatCompact(thumbprintValue)}
        </span>
    );
}

function formatCompact(value) {
    if (!value && value !== 0) return '-';
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'jt';
    if (value >= 1000) return (value / 1000).toFixed(0) + 'rb';
    return value.toString();
}

export default ThumbprintVerification;
