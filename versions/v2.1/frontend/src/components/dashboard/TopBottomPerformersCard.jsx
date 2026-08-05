import React from 'react';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)}rb`;
    return val.toFixed(0);
};

export default function TopBottomPerformersCard({ data, loading }) {
    if (loading) {
        return (
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                minHeight: '300px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <div style={{ color: '#64748b' }}>Loading...</div>
            </div>
        );
    }

    if (!data || (!data.top?.length && !data.bottom?.length)) {
        return (
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '1.5rem',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                textAlign: 'center'
            }}>
                <div style={{ color: '#94a3b8' }}>No performance data available</div>
            </div>
        );
    }

    const PerformerCard = ({ title, gangs, isTop }) => (
        <div style={{ flex: 1 }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem'
            }}>
                <span style={{ fontSize: '1.5rem' }}>{isTop ? '🏆' : '⚠️'}</span>
                <h4 style={{
                    margin: 0,
                    fontSize: '1rem',
                    fontWeight: '700',
                    color: isTop ? '#10b981' : '#ef4444'
                }}>
                    {title}
                </h4>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {gangs.map((gang, idx) => (
                    <div
                        key={gang.gang_code}
                        style={{
                            padding: '12px',
                            borderRadius: '8px',
                            background: isTop
                                ? `linear-gradient(135deg, rgba(16, 185, 129, ${0.15 - idx * 0.02}) 0%, rgba(16, 185, 129, ${0.05 - idx * 0.01}) 100%)`
                                : `linear-gradient(135deg, rgba(239, 68, 68, ${0.15 - idx * 0.02}) 0%, rgba(239, 68, 68, ${0.05 - idx * 0.01}) 100%)`,
                            border: `1px solid ${isTop ? '#d1fae5' : '#fee2e2'}`,
                            transition: 'transform 0.2s',
                            cursor: 'pointer'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(4px)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateX(0)'}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontSize: '0.9rem',
                                    fontWeight: '700',
                                    color: '#1e293b',
                                    marginBottom: '2px'
                                }}>
                                    {gang.gang_code}
                                </div>
                                <div style={{
                                    fontSize: '0.75rem',
                                    color: '#64748b',
                                    marginBottom: '6px'
                                }}>
                                    {gang.gang_name}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                    {gang.headcount} emp • {gang.total_hk.toLocaleString()} HK
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{
                                    fontSize: '1.1rem',
                                    fontWeight: '800',
                                    color: isTop ? '#10b981' : '#ef4444'
                                }}>
                                    Rp {formatCurrency(gang.cost_per_hk)}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                                    per HK
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '1.5rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
            <h3 style={{
                fontSize: '1.2rem',
                fontWeight: '700',
                color: '#1e293b',
                marginBottom: '1.5rem'
            }}>
                🎯 Best & Worst Performers
            </h3>

            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '2rem'
            }}>
                {data.top && data.top.length > 0 && (
                    <PerformerCard
                        title="Most Efficient"
                        gangs={data.top}
                        isTop={true}
                    />
                )}
                {data.bottom && data.bottom.length > 0 && (
                    <PerformerCard
                        title="Needs Attention"
                        gangs={data.bottom}
                        isTop={false}
                    />
                )}
            </div>
        </div>
    );
}
