import React from 'react';
import { Award, AlertTriangle } from 'lucide-react';
import { C, CARD, SECTION_TITLE, EmptyState } from '../report/reportTheme';
import { getScopeLabel } from '../../utils/gangTypes';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)}rb`;
    return val.toFixed(0);
};

export default function TopBottomPerformersCard({ data, loading, scope = 'panen' }) {
    if (loading) {
        return (
            <div style={{
                ...CARD,
                minHeight: '300px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <div style={{ color: C.muted }}>Memuat...</div>
            </div>
        );
    }

    if (!data || (!data.top?.length && !data.bottom?.length)) {
        return (
            <EmptyState
                title="Data performa gang belum tersedia"
                message={`Tidak ada data performa untuk cakupan ${getScopeLabel(scope)} pada periode ini.`}
            />
        );
    }

    const PerformerCard = ({ title, gangs, isTop }) => {
        const accent = isTop ? C.upah : C.potongan;
        const Icon = isTop ? Award : AlertTriangle;
        return (
            <div style={{ flex: 1 }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '1rem',
                    color: accent
                }}>
                    <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
                    <h4 style={{
                        margin: 0,
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: accent
                    }}>
                        {title}
                    </h4>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {gangs.map((gang) => (
                        <div
                            key={gang.gang_code}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                background: C.surface2,
                                border: `1px solid ${C.border}`,
                                borderLeft: `3px solid ${accent}`
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        fontSize: '0.9rem',
                                        fontWeight: '700',
                                        color: C.text,
                                        marginBottom: '2px'
                                    }}>
                                        {gang.gang_code}
                                    </div>
                                    <div style={{
                                        fontSize: '0.75rem',
                                        color: C.muted,
                                        marginBottom: '6px'
                                    }}>
                                        {gang.gang_name}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: C.muted }}>
                                        {gang.headcount} emp • {gang.total_hk.toLocaleString()} HK
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{
                                        fontSize: '1.05rem',
                                        fontWeight: '800',
                                        color: accent,
                                        fontVariantNumeric: 'tabular-nums',
                                        fontFamily: 'Roboto Mono, monospace'
                                    }}>
                                        Rp {formatCurrency(gang.cost_per_hk)}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: C.muted }}>
                                        per HK
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div style={CARD}>
            <h3 style={{ ...SECTION_TITLE, marginBottom: 4 }}>
                Performa Terbaik & Terlemah
            </h3>
            <p style={{ fontSize: '0.85rem', color: C.muted, margin: '0 0 1.25rem 0' }}>
                {getScopeLabel(scope)} · berdasarkan Cost/HK
            </p>

            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '2rem'
            }}>
                {data.top && data.top.length > 0 && (
                    <PerformerCard
                        title="Paling Efisien"
                        gangs={data.top}
                        isTop={true}
                    />
                )}
                {data.bottom && data.bottom.length > 0 && (
                    <PerformerCard
                        title="Perlu Perhatian"
                        gangs={data.bottom}
                        isTop={false}
                    />
                )}
            </div>
        </div>
    );
}
