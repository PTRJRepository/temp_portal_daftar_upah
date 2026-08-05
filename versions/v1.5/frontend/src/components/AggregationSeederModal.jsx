/**
 * AggregationSeederModal - Modal for seeding aggregation data
 */

import React, { useState, useEffect } from 'react';
import {
    seedAggregation,
    seedTonaseOnly,
    fetchAggregationStatus,
    formatMonthName,
    formatNumber,
    formatCurrency
} from '../services/aggregationSeederService';

export default function AggregationSeederModal({ isOpen, onClose, month, year, division, token }) {
    const [status, setStatus] = useState(null);
    const [seeding, setSeeding] = useState(false);
    const [seedingProgress, setSeedingProgress] = useState([]);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    // Load current status when modal opens
    useEffect(() => {
        if (isOpen && token) {
            loadStatus();
        }
    }, [isOpen, month, year, token]);

    const loadStatus = async () => {
        if (!token) {
            console.error('No token available');
            return;
        }
        try {
            const response = await fetchAggregationStatus(token, month, year);
            setStatus(response);
        } catch (e) {
            console.error('Failed to load status:', e);
        }
    };

    const handleSeed = async () => {
        if (!token) {
            setError('No authentication token available');
            return;
        }
        setSeeding(true);
        setError('');
        setSeedingProgress([{ message: `Starting aggregation for ${formatMonthName(month)} ${year}...`, time: new Date() }]);

        try {
            const response = await seedAggregation(token, month, year, division, false);

            if (response.success) {
                setResult(response.data);
                setSeedingProgress(prev => [
                    ...prev,
                    { message: `Aggregation completed!`, time: new Date() },
                    { message: `Processed ${response.data.total_divisions} divisions`, time: new Date() }
                ]);

                // Reload status
                await loadStatus();

                // Auto close after 2 seconds
                setTimeout(() => {
                    onClose();
                }, 2000);
            } else {
                setError(response.error || 'Failed to seed aggregation');
            }
        } catch (e) {
            setError(e.message || 'Failed to seed aggregation');
        } finally {
            setSeeding(false);
        }
    };

    const handleForceSeed = async () => {
        if (!token) {
            setError('No authentication token available');
            return;
        }
        setSeeding(true);
        setError('');
        setSeedingProgress([{ message: `Force seeding for ${formatMonthName(month)} ${year}...`, time: new Date() }]);

        try {
            const response = await seedAggregation(token, month, year, division, true);

            if (response.success) {
                setResult(response.data);
                setSeedingProgress(prev => [
                    ...prev,
                    { message: `Force aggregation completed!`, time: new Date() },
                    { message: `Processed ${response.data.total_divisions} divisions`, time: new Date() }
                ]);

                await loadStatus();

                setTimeout(() => {
                    onClose();
                }, 2000);
            } else {
                setError(response.error || 'Failed to seed aggregation');
            }
        } catch (e) {
            setError(e.message || 'Failed to seed aggregation');
        } finally {
            setSeeding(false);
        }
    };

    const handleSeedTonase = async () => {
        if (!token) {
            setError('No authentication token available');
            return;
        }
        setSeeding(true);
        setError('');
        setSeedingProgress([{ message: `Seeding tonase from db_ptrj_mill for ${formatMonthName(month)} ${year}...`, time: new Date() }]);

        try {
            const response = await seedTonaseOnly(token, month, year);

            if (response.success) {
                setResult(response);
                const updatedCount = response.updated || 0;
                const resultDetails = (response.results || []).filter(r => r.status === 'UPDATED');
                setSeedingProgress(prev => [
                    ...prev,
                    { message: `Tonase seeding completed! ${updatedCount} divisions updated.`, time: new Date() },
                    ...resultDetails.map(r => ({ message: `  ${r.division}: ${r.tonase} ton`, time: new Date() }))
                ]);

                await loadStatus();

                setTimeout(() => {
                    onClose();
                }, 3000);
            } else {
                setError(response.error || 'Failed to seed tonase');
            }
        } catch (e) {
            setError(e.message || 'Failed to seed tonase');
        } finally {
            setSeeding(false);
        }
    };

    if (!isOpen) return null;

    const hasExistingData = status && status.divisions && status.divisions.length > 0;
    const totalGangs = status?.total_gangs || 0;

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000
        }}>
            <div className="modal-content" style={{
                background: '#f8fafc',
                borderRadius: '0.5rem',
                padding: '1.5rem',
                minWidth: '600px',
                maxWidth: '800px',
                maxHeight: '80vh',
                overflow: 'auto',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
                        Seed Aggregation Data
                    </h2>
                    <button
                        onClick={onClose}
                        disabled={seeding}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: seeding ? 'not-allowed' : 'pointer',
                            opacity: seeding ? 0.5 : 1
                        }}
                    >
                        &times;
                    </button>
                </div>

                {/* Period Info */}
                <div style={{
                    background: 'white',
                    padding: '1rem',
                    borderRadius: '0.375rem',
                    marginBottom: '1rem',
                    border: '1px solid #e2e8f0'
                }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem' }}>
                        <div><strong>Period:</strong> {formatMonthName(month)} {year}</div>
                        <div><strong>Division:</strong> {division || 'ALL'}</div>
                    </div>
                </div>

                {/* Current Status */}
                {status && (
                    <div style={{
                        background: hasExistingData ? '#f0fdf4' : '#fef9c3',
                        padding: '1rem',
                        borderRadius: '0.375rem',
                        marginBottom: '1rem',
                        border: `1px solid ${hasExistingData ? '#86efac' : '#fde047'}`
                    }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                            Current Status:
                        </div>
                        {hasExistingData ? (
                            <div style={{ fontSize: '0.875rem', color: '#166534' }}>
                                <div>Existing aggregation data found for {status.divisions.length} division(s)</div>
                                <div>Total gangs: {totalGangs}</div>
                                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                                    {status.divisions.map(d => `${d.division_code} (${d.gang_count})`).join(', ')}
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.875rem', color: '#854d0e' }}>
                                No existing aggregation data for this period.
                            </div>
                        )}
                    </div>
                )}

                {/* Progress Messages */}
                {seedingProgress.length > 0 && (
                    <div style={{
                        background: '#f1f5f9',
                        padding: '1rem',
                        borderRadius: '0.375rem',
                        marginBottom: '1rem',
                        fontSize: '0.875rem'
                    }}>
                        {seedingProgress.map((msg, i) => (
                            <div key={i} style={{ marginBottom: '0.25rem' }}>
                                {msg.message}
                            </div>
                        ))}
                        {seeding && (
                            <div style={{ marginTop: '0.5rem', color: '#3b82f6' }}>
                                Processing...
                            </div>
                        )}
                    </div>
                )}

                {/* Result */}
                {result && (
                    <div style={{
                        background: '#f0fdf4',
                        padding: '1rem',
                        borderRadius: '0.375rem',
                        marginBottom: '1rem',
                        fontSize: '0.875rem',
                        border: '1px solid #86efac'
                    }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#166534' }}>
                            Success!
                        </div>
                        <div>Processed {result.processed?.length || 0} gangs</div>
                        {result.processed && result.processed.slice(0, 5).map((p, i) => (
                            <div key={i} style={{ fontSize: '0.75rem', marginLeft: '1rem' }}>
                                {p.division} - {p.gang}: {p.employees_processed} employees
                            </div>
                        ))}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div style={{
                        background: '#fef2f2',
                        color: '#991b1b',
                        padding: '1rem',
                        borderRadius: '0.375rem',
                        marginBottom: '1rem',
                        fontSize: '0.875rem',
                        border: '1px solid #fca5a5'
                    }}>
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button
                        onClick={onClose}
                        disabled={seeding}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #cbd5e1',
                            background: 'white',
                            cursor: seeding ? 'not-allowed' : 'pointer',
                            opacity: seeding ? 0.5 : 1
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSeedTonase}
                        disabled={seeding}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #06b6d4',
                            background: '#22d3ee',
                            color: '#164e63',
                            cursor: seeding ? 'not-allowed' : 'pointer',
                            opacity: seeding ? 0.5 : 1,
                            fontWeight: 500
                        }}
                    >
                        {seeding ? 'Processing...' : '🏭 Seed Tonase'}
                    </button>
                    <button
                        onClick={handleForceSeed}
                        disabled={seeding}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #f59e0b',
                            background: '#fbbf24',
                            color: '#78350f',
                            cursor: seeding ? 'not-allowed' : 'pointer',
                            opacity: seeding ? 0.5 : 1,
                            fontWeight: 500
                        }}
                    >
                        {seeding ? 'Processing...' : 'Force Seed'}
                    </button>
                    <button
                        onClick={handleSeed}
                        disabled={seeding}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.375rem',
                            border: 'none',
                            background: seeding ? '#94a3b8' : '#22c55e',
                            color: 'white',
                            cursor: seeding ? 'not-allowed' : 'pointer',
                            fontWeight: 500
                        }}
                    >
                        {seeding ? 'Processing...' : 'Seed Aggregation'}
                    </button>
                </div>
            </div>
        </div>
    );
}
