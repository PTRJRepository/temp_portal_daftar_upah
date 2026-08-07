import React from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { C, SHADOW, CARD, SECTION_TITLE, EmptyState, Skeleton } from '../report/reportTheme';
import { formatCompactIDR, formatNumberID, toCostCompositionRows } from '../../utils/dashboardDerivations';

const tooltipStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    boxShadow: SHADOW, fontSize: 12, color: C.text
};

const thStyle = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, padding: '6px 8px', borderBottom: `1px solid ${C.border}` };
const tdStyle = { fontSize: 12.5, color: C.text, padding: '7px 8px', borderBottom: `1px solid ${C.gridLine}`, fontVariantNumeric: 'tabular-nums' };

/**
 * Section Efisiensi & Struktur Biaya.
 * Komposisi biaya + efisiensi per divisi (dari /cost-structure, ikut scope),
 * tren upah 12 bulan + top gang (dari /executive-summary).
 */
export default function CostStructureSection({ costData, trends, gangBreakdown, loading, error, onRetry, periodLabel, scopeLabel }) {
    if (loading) {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.2rem' }}>
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={240} />)}
            </div>
        );
    }
    if (error || !costData) {
        return (
            <EmptyState
                title="Struktur biaya belum tersedia"
                message={error ? `Gagal memuat: ${error}` : 'Data agregasi belum tersedia untuk periode ini. Jalankan Aggregation Seeder.'}
                actionLabel="Muat Ulang"
                onAction={onRetry}
            />
        );
    }

    const compositionRows = toCostCompositionRows(costData.divisions);
    const divisions = Array.isArray(costData.divisions) ? costData.divisions : [];
    const efficiencyRows = divisions.filter(d => d.upah_available);
    const maxCostPerTon = Math.max(...efficiencyRows.map(d => d.cost_per_ton || 0), 0);
    const topGangs = (Array.isArray(gangBreakdown) ? gangBreakdown : []).slice(0, 5);
    const totals = costData.totals || {};
    const deductionCells = [
        { label: 'Potongan', value: totals.potongan },
        { label: 'PPh 21', value: totals.pph21 },
        { label: 'SPSI', value: totals.spsi },
        { label: 'BPJS Pekerja', value: totals.bpjs_pekerja }
    ];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.2rem' }}>
            {/* Tren upah 12 bulan (dipindah dari grid chart lama) */}
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={SECTION_TITLE}>Tren Upah 12 Bulan</div>
                    <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                </div>
                {trends.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={trends} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCompactIDR(v), 'Total Upah']} />
                            <Area type="monotone" dataKey="total_wage" stroke={C.upah} strokeWidth={2} fill={C.upah} fillOpacity={0.12} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tren belum tersedia" message="Data agregasi 12 bulan belum ada. Jalankan Aggregation Seeder." />
                )}
            </div>

            {/* Komposisi biaya per divisi */}
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={SECTION_TITLE}>Komposisi Biaya per Divisi ({periodLabel})</div>
                    <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                </div>
                {compositionRows.length > 0 ? (
                    <>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={compositionRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={C.gridLine} vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} />
                                <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                                <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatCompactIDR(v), name]} />
                                <Bar dataKey="upah_pokok" stackId="biaya" fill={C.leafMid} name="Upah Pokok" isAnimationActive={false} />
                                <Bar dataKey="premi" stackId="biaya" fill={C.premi} name="Premi" isAnimationActive={false} />
                                <Bar dataKey="lembur" stackId="biaya" fill={C.lembur} name="Lembur" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                        <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                            {[['Upah Pokok', C.leafMid], ['Premi', C.premi], ['Lembur', C.lembur]].map(([label, color]) => (
                                <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.text2, fontWeight: 600 }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />{label}
                                </span>
                            ))}
                        </div>
                    </>
                ) : (
                    <EmptyState title="Komposisi kosong" message="Belum ada divisi dengan data upah untuk periode ini." />
                )}
            </div>

            {/* Efisiensi per divisi */}
            <div style={CARD}>
                <div style={SECTION_TITLE}>Efisiensi per Divisi</div>
                {efficiencyRows.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thStyle}>Divisi</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Upah/HK</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Upah/Orang</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Cost/Ton</th>
                            </tr>
                        </thead>
                        <tbody>
                            {efficiencyRows.map(d => (
                                <tr key={d.division_code}>
                                    <td style={{ ...tdStyle, fontWeight: 700 }}>{d.division_code}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.cost_per_hk !== null ? formatCompactIDR(d.cost_per_hk) : '-'}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.cost_per_head !== null ? formatCompactIDR(d.cost_per_head) : '-'}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                                            {d.cost_per_ton !== null && maxCostPerTon > 0 && (
                                                <span style={{ width: `${Math.max(6, (d.cost_per_ton / maxCostPerTon) * 56)}px`, height: 6, borderRadius: 3, background: C.costTon, opacity: 0.75, display: 'inline-block' }} />
                                            )}
                                            <span>{d.cost_per_ton !== null ? formatCompactIDR(d.cost_per_ton) : '-'}</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <EmptyState title="Efisiensi kosong" message="Belum ada divisi dengan data upah untuk periode ini." />
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 14 }}>
                    {deductionCells.map(cell => (
                        <div key={cell.label} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted }}>{cell.label}</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: C.potongan, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{formatCompactIDR(cell.value)}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Top 5 gang biaya tertinggi */}
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={SECTION_TITLE}>Top 5 Gang Biaya Tertinggi</div>
                    <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                </div>
                {topGangs.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thStyle}>#</th>
                                <th style={thStyle}>Gang</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Total Upah</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>HK</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topGangs.map((g, i) => (
                                <tr key={g.gang_code}>
                                    <td style={{ ...tdStyle, color: C.muted, fontWeight: 700 }}>{i + 1}</td>
                                    <td style={{ ...tdStyle, fontWeight: 700 }}>{g.gang_code}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactIDR(g.total_wage)}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatNumberID(g.headcount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <EmptyState title="Data gang kosong" message="Belum ada breakdown gang untuk periode ini." />
                )}
            </div>
        </div>
    );
}
