import React from 'react';

export const getColorCode = (name) => {
    const map = { red: '#ef4444', blue: '#3b82f6', green: '#10b981', orange: '#f59e0b', gray: '#94a3b8' };
    return map[name] || '#94a3b8';
};

const KPICard = ({ title, value, subValue, trend, color }) => (
    <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', borderLeft: `4px solid ${getColorCode(color)}` }}>
        <p style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem', textTransform: 'uppercase' }}>{title}</p>
        <p style={{ fontSize: '1.5rem', fontWeight: '800', color: '#1e293b', marginBottom: '0.25rem' }}>{value}</p>
        <p style={{ fontSize: '0.875rem', color: trend === 'up' && color !== 'green' ? '#ef4444' : '#10b981', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            {trend === 'up' ? '▲' : '▼'} {subValue}
        </p>
    </div>
);

export default KPICard;
