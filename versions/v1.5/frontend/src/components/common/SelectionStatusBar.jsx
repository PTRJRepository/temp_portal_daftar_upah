import React from 'react';

const formatNumber = (num) => {
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(num);
};

export default function SelectionStatusBar({ stats }) {
    if (!stats || stats.count === 0) return null;

    return (
        <div className="selection-status-bar">
            <div className="stat-item">
                <strong>Count:</strong> {stats.count}
            </div>
            <div className="stat-item">
                <strong>Sum:</strong> {formatNumber(stats.sum)}
            </div>
            <div className="stat-item">
                <strong>Avg:</strong> {formatNumber(stats.avg)}
            </div>
            <div className="stat-item">
                <strong>Min:</strong> {formatNumber(stats.min)}
            </div>
            <div className="stat-item">
                <strong>Max:</strong> {formatNumber(stats.max)}
            </div>
        </div>
    );
}
