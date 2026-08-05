/**
 * CostPerTonAnalysis - Component for calculating and displaying Cost Per Ton analysis
 * Allows switching between different analysis types (by Division, by Gang, etc.)
 * 
 * Calculations:
 * - Cost Per Ton = Total Upah Bersih / Total TBS (Ton)
 * - Cost Per Ton per HK = Cost Per Ton / Total HK
 */

import React, { useState, useMemo } from 'react';
import ReportPrintMetadata from './common/ReportPrintMetadata';
import '../styles/wages-summary-professional.css';
import '../styles/report-print-foundation.css';

// Analysis type configurations
const ANALYSIS_TYPES = {
    DIVISION: {
        label: 'By Division',
        value: 'division',
        description: 'Analisis biaya per ton berdasarkan divisi'
    },
    GANG: {
        label: 'By Gang',
        value: 'gang',
        description: 'Analisis biaya per ton berdasarkan gang'
    },
    ESTATE: {
        label: 'By Estate',
        value: 'estate',
        description: 'Analisis biaya per ton berdasarkan estate'
    }
};

export default function CostPerTonAnalysis({
    summaryData = [],
    grandTotal = null,
    tbsData = null, // External TBS tonnage data (if available)
    onTbsDataChange = null, // Callback to update TBS data
    loading = false
}) {
    // State for analysis type selection
    const [analysisType, setAnalysisType] = useState('division');
    
    // State for manual TBS input (per division/gang)
    const [manualTbsInputs, setManualTbsInputs] = useState({});
    
    // State for global TBS input
    const [globalTbs, setGlobalTbs] = useState('');

    // Format number helper
    const formatNumber = (value, decimals = 0) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return '-';
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(num);
    };

    // Format currency helper
    const formatCurrency = (value) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return '-';
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(num);
    };

    // Handle TBS input change for specific row
    const handleTbsInputChange = (key, value) => {
        const numValue = parseFloat(value) || 0;
        setManualTbsInputs(prev => ({
            ...prev,
            [key]: numValue
        }));
    };

    // Handle global TBS input
    const handleGlobalTbsChange = (value) => {
        setGlobalTbs(value);
    };

    // Calculate Cost Per Ton analysis
    const analysisResult = useMemo(() => {
        if (!summaryData || summaryData.length === 0) {
            return { rows: [], totals: null };
        }

        // Group data based on analysis type
        let groupedData = {};
        
        if (analysisType === 'division') {
            // Group by division (using gang_code prefix or division field)
            summaryData.forEach(row => {
                const divisionKey = row.division || row.gang_code?.substring(0, 3) || 'UNKNOWN';
                if (!groupedData[divisionKey]) {
                    groupedData[divisionKey] = {
                        key: divisionKey,
                        label: row.division || divisionKey,
                        total_upah_bersih: 0,
                        total_hk: 0,
                        total_employees: 0,
                        total_tbs: 0
                    };
                }
                groupedData[divisionKey].total_upah_bersih += Number(row.total_upah_bersih) || 0;
                groupedData[divisionKey].total_hk += Number(row.total_hk) || 0;
                groupedData[divisionKey].total_employees += Number(row.total_employees) || 0;
            });
        } else if (analysisType === 'gang') {
            // Group by gang
            summaryData.forEach(row => {
                const gangKey = row.gang_code || 'UNKNOWN';
                if (!groupedData[gangKey]) {
                    groupedData[gangKey] = {
                        key: gangKey,
                        label: row.gang_description || row.gang_code || gangKey,
                        total_upah_bersih: 0,
                        total_hk: 0,
                        total_employees: 0,
                        total_tbs: 0
                    };
                }
                groupedData[gangKey].total_upah_bersih += Number(row.total_upah_bersih) || 0;
                groupedData[gangKey].total_hk += Number(row.total_hk) || 0;
                groupedData[gangKey].total_employees += Number(row.total_employees) || 0;
            });
        } else if (analysisType === 'estate') {
            // Group by estate (using gang_code prefix or first 2-3 chars)
            summaryData.forEach(row => {
                const estateKey = row.gang_code?.substring(0, 2) || row.gang_description?.split(' ')[0] || 'UNKNOWN';
                if (!groupedData[estateKey]) {
                    groupedData[estateKey] = {
                        key: estateKey,
                        label: row.gang_description?.split(' ')[0] || estateKey,
                        total_upah_bersih: 0,
                        total_hk: 0,
                        total_employees: 0,
                        total_tbs: 0
                    };
                }
                groupedData[estateKey].total_upah_bersih += Number(row.total_upah_bersih) || 0;
                groupedData[estateKey].total_hk += Number(row.total_hk) || 0;
                groupedData[estateKey].total_employees += Number(row.total_employees) || 0;
            });
        }

        // Calculate Cost Per Ton for each group
        const rows = Object.values(groupedData).map(group => {
            // Get TBS from manual input or external data
            const tbsTon = manualTbsInputs[group.key] || 
                          (tbsData && tbsData[group.key]) || 0;
            
            // Cost Per Ton = Total Upah Bersih / Total TBS (Ton)
            const costPerTon = tbsTon > 0 ? group.total_upah_bersih / tbsTon : 0;
            
            // Cost Per Ton per HK = Cost Per Ton / Total HK
            const costPerTonPerHK = group.total_hk > 0 ? costPerTon / group.total_hk : 0;
            
            // Upah per HK = Total Upah / Total HK
            const upahPerHK = group.total_hk > 0 ? group.total_upah_bersih / group.total_hk : 0;

            return {
                ...group,
                tbs_ton: tbsTon,
                cost_per_ton: costPerTon,
                cost_per_ton_per_hk: costPerTonPerHK,
                upah_per_hk: upahPerHK
            };
        });

        // Calculate totals
        const totals = {
            total_upah_bersih: rows.reduce((sum, r) => sum + r.total_upah_bersih, 0),
            total_hk: rows.reduce((sum, r) => sum + r.total_hk, 0),
            total_employees: rows.reduce((sum, r) => sum + r.total_employees, 0),
            total_tbs: rows.reduce((sum, r) => sum + r.tbs_ton, 0)
        };

        // Calculate overall Cost Per Ton
        totals.cost_per_ton = totals.total_tbs > 0 ? 
            totals.total_upah_bersih / totals.total_tbs : 0;
        
        // Calculate overall Cost Per Ton per HK
        totals.cost_per_ton_per_hk = totals.total_hk > 0 ? 
            totals.cost_per_ton / totals.total_hk : 0;
        
        // Calculate overall Upah per HK
        totals.upah_per_hk = totals.total_hk > 0 ? 
            totals.total_upah_bersih / totals.total_hk : 0;

        return { rows, totals };
    }, [summaryData, analysisType, manualTbsInputs, tbsData]);

    // Use grand total if available
    const displayTotals = useMemo(() => {
        if (grandTotal) {
            const totalTbs = analysisResult.totals?.total_tbs || 0;
            const costPerTon = totalTbs > 0 ? grandTotal.total_upah_bersih / totalTbs : 0;
            const costPerTonPerHK = grandTotal.total_hk > 0 ? costPerTon / grandTotal.total_hk : 0;
            const upahPerHK = grandTotal.total_hk > 0 ? grandTotal.total_upah_bersih / grandTotal.total_hk : 0;
            
            return {
                total_upah_bersih: grandTotal.total_upah_bersih,
                total_hk: grandTotal.total_hk,
                total_employees: grandTotal.total_employees,
                total_tbs: totalTbs,
                cost_per_ton: costPerTon,
                cost_per_ton_per_hk: costPerTonPerHK,
                upah_per_hk: upahPerHK
            };
        }
        return analysisResult.totals;
    }, [grandTotal, analysisResult.totals]);

    if (loading) {
        return (
            <div className="wsp-document" style={{ marginTop: '1rem' }}>
                <div className="wsp-loading">
                    <div className="wsp-spinner"></div>
                    Loading analysis...
                </div>
            </div>
        );
    }

    return (
        <div className="wsp-document" style={{ marginTop: '1rem' }}>
            {/* Header */}
            <div className="wsp-letterhead" style={{ padding: '1rem 0' }}>
                <h2 className="wsp-report-title" style={{ fontSize: '1.25rem' }}>
                    COST PER TON ANALYSIS
                </h2>
                <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    {ANALYSIS_TYPES[analysisType.toUpperCase()]?.description || 'Analisis biaya per ton'}
                </p>
                <ReportPrintMetadata
                    mode="Cost Per Ton"
                    source={tbsData ? 'Summary + TBS Data' : 'Summary Data'}
                    scope={ANALYSIS_TYPES[analysisType.toUpperCase()]?.label || analysisType}
                    note="Cost per ton memakai total upah bersih dan TBS yang tersedia atau input manual pada report."
                />
            </div>

            {/* Analysis Type Selector */}
            <div className="wsp-action-bar no-print" style={{ 
                position: 'relative', 
                top: 0, 
                boxShadow: 'none',
                borderBottom: '1px solid #e2e8f0',
                marginBottom: '1rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <label style={{ fontWeight: 600, color: '#475569' }}>Analysis Type:</label>
                    <select
                        value={analysisType}
                        onChange={(e) => setAnalysisType(e.target.value)}
                        className="wsp-select"
                    >
                        {Object.values(ANALYSIS_TYPES).map(type => (
                            <option key={type.value} value={type.value}>
                                {type.label}
                            </option>
                        ))}
                    </select>
                </div>
                
                {/* Global TBS Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontWeight: 600, color: '#475569' }}>Global TBS (Ton):</label>
                    <input
                        type="number"
                        value={globalTbs}
                        onChange={(e) => handleGlobalTbsChange(e.target.value)}
                        placeholder="Enter TBS (Ton)"
                        className="wsp-select"
                        style={{ width: '150px' }}
                    />
                    {globalTbs && (
                        <button
                            onClick={() => {
                                // Distribute global TBS evenly across all rows
                                const perRow = parseFloat(globalTbs) / analysisResult.rows.length;
                                const newInputs = {};
                                analysisResult.rows.forEach(row => {
                                    newInputs[row.key] = perRow;
                                });
                                setManualTbsInputs(newInputs);
                            }}
                            className="wsp-btn"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                        >
                            Distribute Evenly
                        </button>
                    )}
                </div>
            </div>

            {/* KPI Summary Cards */}
            {displayTotals && (
                <div className="wsp-kpi-grid" style={{ marginBottom: '1rem' }}>
                    <div className="wsp-kpi-card">
                        <div className="wsp-kpi-label">TOTAL TBS</div>
                        <div className="wsp-kpi-value">{formatNumber(displayTotals.total_tbs, 2)} Ton</div>
                    </div>
                    <div className="wsp-kpi-card highlight">
                        <div className="wsp-kpi-label">COST PER TON</div>
                        <div className="wsp-kpi-value">{formatCurrency(displayTotals.cost_per_ton)}</div>
                    </div>
                    <div className="wsp-kpi-card secondary">
                        <div className="wsp-kpi-label">COST PER TON / HK</div>
                        <div className="wsp-kpi-value">{formatCurrency(displayTotals.cost_per_ton_per_hk)}</div>
                    </div>
                    <div className="wsp-kpi-card">
                        <div className="wsp-kpi-label">UPAH PER HK</div>
                        <div className="wsp-kpi-value">{formatCurrency(displayTotals.upah_per_hk)}</div>
                    </div>
                </div>
            )}

            {/* Analysis Table */}
            <div className="wsp-table-wrapper">
                <table className="wsp-table">
                    <thead>
                        <tr className="wsp-header-master">
                            <th rowSpan="2" style={{ minWidth: '200px' }}>
                                {analysisType === 'division' ? 'DIVISION' : 
                                 analysisType === 'gang' ? 'GANG' : 'ESTATE'}
                            </th>
                            <th colSpan="2">MANPOWER</th>
                            <th colSpan="2">PRODUCTION</th>
                            <th colSpan="3">COST ANALYSIS</th>
                        </tr>
                        <tr className="wsp-header-sub">
                            <th style={{ width: '70px' }}>WORKERS</th>
                            <th style={{ width: '70px' }}>HK</th>
                            <th style={{ width: '100px' }}>TBS (Ton)</th>
                            <th style={{ width: '120px' }}>TOTAL UPAH</th>
                            <th style={{ width: '120px' }}>COST/TON</th>
                            <th style={{ width: '120px' }}>COST/TON/HK</th>
                            <th style={{ width: '120px' }}>UPAH/HK</th>
                        </tr>
                    </thead>
                    <tbody>
                        {analysisResult.rows.length === 0 ? (
                            <tr>
                                <td colSpan="8" className="text-center" style={{ padding: '2rem' }}>
                                    No data available. Please select a period and division.
                                </td>
                            </tr>
                        ) : (
                            analysisResult.rows.map((row, idx) => (
                                <tr key={row.key || idx}>
                                    <td className="text-left">{row.label}</td>
                                    <td className="text-right">{formatNumber(row.total_employees)}</td>
                                    <td className="text-right">{formatNumber(row.total_hk)}</td>
                                    <td className="text-right">
                                        {/* Editable TBS input */}
                                        <input
                                            type="number"
                                            value={manualTbsInputs[row.key] || ''}
                                            onChange={(e) => handleTbsInputChange(row.key, e.target.value)}
                                            placeholder="0"
                                            className="tbs-input"
                                            style={{
                                                width: '80px',
                                                padding: '0.25rem 0.5rem',
                                                border: '1px solid #cbd5e1',
                                                borderRadius: '4px',
                                                textAlign: 'right',
                                                fontSize: '0.875rem'
                                            }}
                                        />
                                    </td>
                                    <td className="text-right" style={{ fontWeight: 500 }}>
                                        {formatCurrency(row.total_upah_bersih)}
                                    </td>
                                    <td className={`text-right ${row.cost_per_ton > 0 ? 'val-positive' : 'val-zero'}`} style={{ fontWeight: 600 }}>
                                        {formatCurrency(row.cost_per_ton)}
                                    </td>
                                    <td className={`text-right ${row.cost_per_ton_per_hk > 0 ? 'val-positive' : 'val-zero'}`}>
                                        {formatCurrency(row.cost_per_ton_per_hk)}
                                    </td>
                                    <td className="text-right">{formatCurrency(row.upah_per_hk)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>

                    {displayTotals && (
                        <tfoot>
                            <tr className="wsp-grand-total">
                                <td>TOTAL</td>
                                <td className="text-right">{formatNumber(displayTotals.total_employees)}</td>
                                <td className="text-right">{formatNumber(displayTotals.total_hk)}</td>
                                <td className="text-right">{formatNumber(displayTotals.total_tbs, 2)}</td>
                                <td className="text-right">{formatCurrency(displayTotals.total_upah_bersih)}</td>
                                <td className="text-right" style={{ color: '#4ade80', fontWeight: 600 }}>
                                    {formatCurrency(displayTotals.cost_per_ton)}
                                </td>
                                <td className="text-right" style={{ color: '#4ade80' }}>
                                    {formatCurrency(displayTotals.cost_per_ton_per_hk)}
                                </td>
                                <td className="text-right">{formatCurrency(displayTotals.upah_per_hk)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* Formula Explanation */}
            <div style={{ 
                marginTop: '1rem', 
                padding: '1rem', 
                background: '#f8fafc', 
                borderRadius: '8px',
                fontSize: '0.875rem',
                color: '#475569'
            }}>
                <strong>Formula:</strong>
                <ul style={{ margin: '0.5rem 0 0 1.5rem' }}>
                    <li><strong>Cost Per Ton</strong> = Total Upah Bersih ÷ Total TBS (Ton)</li>
                    <li><strong>Cost Per Ton per HK</strong> = Cost Per Ton ÷ Total HK</li>
                    <li><strong>Upah per HK</strong> = Total Upah Bersih ÷ Total HK</li>
                </ul>
            </div>
        </div>
    );
}
