import React from 'react';
import '../../styles/financial-summary.css';

export default function SummaryKPICards({
    totalWorkers,
    totalHK,
    totalPremi,
    grandTotalNet
}) {
    // Helper to format currency
    const formatCurrency = (val) => {
        return new Intl.NumberFormat('id-ID').format(val || 0);
    };

    return (
        <div className="financial-kpi-grid">
            <div className="financial-kpi-card">
                <div className="financial-kpi-title">Total Workers</div>
                <div className="financial-kpi-value">{formatCurrency(totalWorkers)}</div>
                <div className="financial-kpi-trend">People</div>
            </div>

            <div className="financial-kpi-card">
                <div className="financial-kpi-title">Total HK (Cekroll)</div>
                <div className="financial-kpi-value">{formatCurrency(totalHK)}</div>
                <div className="financial-kpi-trend">Man-Days</div>
            </div>

            <div className="financial-kpi-card">
                <div className="financial-kpi-title">Total Premi</div>
                <div className="financial-kpi-value" style={{ color: '#059669' }}>
                    Rp {formatCurrency(totalPremi)}
                </div>
                <div className="financial-kpi-trend">Performance Pay</div>
            </div>

            <div className="financial-kpi-card" style={{ background: '#f0f9ff', borderColor: '#bae6fd' }}>
                <div className="financial-kpi-title" style={{ color: '#0369a1' }}>Grand Total Net Pay</div>
                <div className="financial-kpi-value" style={{ color: '#0c4a6e', fontSize: '1.75rem' }}>
                    Rp {formatCurrency(grandTotalNet)}
                </div>
                <div className="financial-kpi-trend" style={{ color: '#0ea5e9' }}>Final Payout</div>
            </div>
        </div>
    );
}
