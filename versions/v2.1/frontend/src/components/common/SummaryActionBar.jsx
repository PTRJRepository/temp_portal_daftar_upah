import React from 'react';
import '../../styles/financial-summary.css';

export default function SummaryActionBar({
    title,
    subtitle,
    onBack,
    onRefresh,
    onExport,
    periodLabel,
    divisionName,
    disableControls
}) {
    return (
        <div className="financial-action-bar">
            <div className="financial-title-group">
                <button
                    onClick={onBack}
                    className="fin-btn"
                    style={{ marginBottom: '0.75rem', border: 'none', paddingLeft: 0, color: 'var(--fin-primary)' }}
                >
                    ← BACK
                </button>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h1 className="financial-report-title">{title}</h1>
                    <div className="financial-report-subtitle">
                        {subtitle} {divisionName ? `• ${divisionName}` : ''}
                    </div>
                </div>
            </div>

            <div className="financial-actions">
                {periodLabel && (
                    <div className="fin-btn" style={{ cursor: 'default', border: 'none', background: 'transparent', fontWeight: 700, fontSize: '0.9rem' }}>
                        {periodLabel}
                    </div>
                )}

                <button
                    onClick={onRefresh}
                    className="fin-btn"
                    disabled={disableControls}
                >
                    REFRESH
                </button>

                <button
                    onClick={onExport}
                    className="fin-btn fin-btn-primary"
                    disabled={disableControls}
                >
                    EXPORT CSV
                </button>
            </div>
        </div>
    );
}
