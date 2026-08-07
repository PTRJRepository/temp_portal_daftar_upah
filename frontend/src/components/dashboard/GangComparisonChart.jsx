import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Printer } from 'lucide-react';
import { C, SHADOW, CARD, SECTION_TITLE, EmptyState } from '../report/reportTheme';
import { getGangType, isIJLGang, getGangTypeLabel, GANG_TYPE, getScopeLabel } from '../../utils/gangTypes';
import '../../styles/gang-report-print.css';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `Rp ${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `Rp ${(val / 1000).toFixed(0)}rb`;
    return `Rp ${val.toFixed(0)}`;
};

const formatNumber = (val) => {
    if (val === null || val === undefined) return '0';
    return new Intl.NumberFormat('id-ID').format(val);
};

// Format bunches with K suffix for large numbers
const formatBunches = (val) => {
    if (val === null || val === undefined) return '0';
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    return val.toString();
};

// Color coding based on performance (cost/HK) — semantik Estate Ledger
const getPerformanceColor = (value, allValues, metric) => {
    if (metric !== 'cost_per_hk') return C.upah; // aksen tunggal untuk metrik lain

    if (!allValues || allValues.length === 0) return C.upah;

    const sorted = [...allValues].sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)];
    const p75 = sorted[Math.floor(sorted.length * 0.75)];

    if (value <= p25) return C.upah;      // top performer (cost/HK rendah)
    if (value >= p75) return C.potongan;  // perlu perhatian (cost/HK tinggi)
    return C.lembur;                       // rata-rata
};

export default function GangComparisonChart({ data, loading, onGangClick, month, year, scope = 'panen' }) {
    const navigate = useNavigate(); // Hook for navigation
    const [sortBy, setSortBy] = useState('cost_per_hk');

    // ALL HOOKS MUST BE BEFORE ANY EARLY RETURNS (React rules of hooks)
    // Enrich data with gang type and division info (heuristik dari utils/gangTypes, SSOT)
    const safeData = Array.isArray(data) ? data : [];
    const enrichedData = useMemo(() => {
        if (safeData.length === 0) return [];
        return safeData.map(gang => ({
            ...gang,
            gang_type: getGangType(gang.gang_code),
            is_ijl: isIJLGang(gang.gang_code)
        }));
    }, [safeData]);

    // Sort Data
    const sortedData = useMemo(() => {
        if (enrichedData.length === 0) return [];
        return [...enrichedData].sort((a, b) => b[sortBy] - a[sortBy]);
    }, [enrichedData, sortBy]);

    const handleGenerateReport = () => {
        const params = new URLSearchParams({
            month: month,
            year: year,
            division: 'ALL',
            type: 'ALL'
        });
        navigate(`/gang-comparison-report?${params.toString()}`);
    };

    if (loading) {
        return (
            <div style={{ ...CARD, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
                <div style={{ color: C.muted, fontSize: '1rem' }}>Memuat perbandingan gang...</div>
            </div>
        );
    }

    if (safeData.length === 0) {
        return (
            <EmptyState
                title="Data gang belum tersedia"
                message={`Tidak ada data gang untuk cakupan ${getScopeLabel(scope)} pada periode ini.`}
            />
        );
    }

    // Config based on sort metric
    const getMetricConfig = () => {
        switch (sortBy) {
            case 'cost_per_hk': return { label: 'Cost/HK', formatter: formatCurrency };
            case 'total_wage': return { label: 'Total Wage', formatter: formatCurrency };
            case 'headcount': return { label: 'Headcount', formatter: (val) => `${val} Emp` };
            case 'total_hk': return { label: 'Total HK', formatter: (val) => val.toLocaleString() };
            case 'total_ffb_bunches': return { label: 'FFB Bunches', formatter: formatBunches };
            default: return { label: 'Value', formatter: (val) => val };
        }
    };

    const metricConfig = getMetricConfig();
    const allMetricValues = safeData.map(d => d[sortBy]);

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const gang = payload[0].payload;
            const gangType = getGangType(gang.gang_code);
            const isHarvesting = gangType === GANG_TYPE.HARVESTING;

            return (
                <div style={{
                    backgroundColor: C.surface,
                    padding: '12px 16px',
                    border: `1px solid ${C.border}`,
                    borderRadius: '8px',
                    boxShadow: SHADOW
                }}>
                    <div style={{ fontWeight: '700', color: C.text, marginBottom: '8px' }}>
                        {gang.gang_code}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: C.muted, marginBottom: '8px' }}>
                        {gang.gang_name || gang.gang_description}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: C.text2 }}>
                        <div><strong>Cost/HK:</strong> {formatCurrency(gang.cost_per_hk)}</div>
                        <div><strong>Headcount:</strong> {gang.headcount} emp</div>
                        <div><strong>Total HK:</strong> {gang.total_hk.toLocaleString()}</div>
                        <div><strong>Total Wage:</strong> {formatCurrency(gang.total_wage)}</div>
                        <div><strong>Gang Type:</strong> {getGangTypeLabel(gangType)}</div>
                        {isHarvesting && gang.total_ffb_bunches > 0 && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${C.border}` }}>
                                <div style={{ color: C.upah, fontWeight: '600' }}>
                                    FFB Bunches: {formatNumber(gang.total_ffb_bunches)}
                                </div>
                                {gang.harvester_count > 0 && (
                                    <div style={{ color: C.muted, fontSize: '0.85rem' }}>
                                        Harvesters: {gang.harvester_count} emp
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div style={CARD}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1.5rem',
                flexWrap: 'wrap',
                gap: '1rem'
            }}>
                <div>
                    <h3 style={{ ...SECTION_TITLE, marginBottom: 6 }}>
                        Perbandingan Kinerja Gang
                    </h3>
                    <p style={{
                        fontSize: '0.85rem',
                        color: C.muted,
                        margin: '0 0 8px 0'
                    }}>
                        {getScopeLabel(scope)} · diurutkan per <span style={{ fontWeight: '600', color: C.upah }}>{metricConfig.label}</span> · {data.length} gang
                    </p>
                    <button
                        onClick={handleGenerateReport}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.4rem 0.8rem',
                            background: C.surface,
                            color: C.upah,
                            border: `1px solid ${C.border}`,
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            boxShadow: SHADOW
                        }}
                    >
                        <Printer size={14} strokeWidth={2.2} aria-hidden="true" />
                        Generate Report
                    </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', color: C.muted, fontWeight: '600' }}>
                        Sort by:
                    </label>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '8px',
                            border: `1px solid ${C.border}`,
                            backgroundColor: C.surface,
                            fontSize: '0.85rem',
                            fontWeight: '600',
                            color: C.text2,
                            cursor: 'pointer',
                            outline: 'none'
                        }}
                    >
                        <option value="cost_per_hk">Cost per HK</option>
                        <option value="total_wage">Total Wage</option>
                        <option value="headcount">Headcount</option>
                        <option value="total_hk">Total HK</option>
                        <option value="total_ffb_bunches">FFB Bunches</option>
                    </select>
                </div>
            </div>

            <div style={{ height: Math.max(400, safeData.length * 35), minHeight: '200px' }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                    <BarChart
                        data={sortedData}
                        layout="vertical"
                        margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke={C.gridLine} />
                        <XAxis
                            type="number"
                            tick={{ fill: C.muted, fontSize: 11 }}
                            tickFormatter={(val) => {
                                if (sortBy === 'headcount') return val;
                                if (sortBy === 'total_ffb_bunches') return formatBunches(val);
                                return `${(val / 1000).toFixed(0)}k`;
                            }}
                        />
                        <YAxis
                            type="category"
                            dataKey="gang_code"
                            width={90}
                            tick={{ fontSize: 12, fill: C.text2 }}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar
                            dataKey={sortBy}
                            name={metricConfig.label}
                            radius={[0, 4, 4, 0]}
                            onClick={onGangClick}
                            cursor="pointer"
                        >
                            {sortedData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={getPerformanceColor(entry[sortBy], allMetricValues, sortBy)}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
