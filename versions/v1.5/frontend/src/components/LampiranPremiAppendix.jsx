/**
 * LampiranPremiAppendix - Enhanced Comprehensive Premium Appendix
 * Features: Premium Matrix, Visual Breakdown, Interactive Cards, Print-Optimized
 */

import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import ReportWatermark from '../components/common/ReportWatermark';
import '../styles/LampiranPremiAppendix.css';

// Color palette - Premium earthy tones for PT REBINMAS
const COLORS = {
    primary: '#1e293b',      // Dark slate
    secondary: '#334155',    // Slate
    accent: '#3b82f6',       // Blue
    success: '#10b981',      // Green
    warning: '#f59e0b',      // Amber
    danger: '#ef4444',       // Red
    muted: '#64748b',        // Muted gray
    light: '#f1f5f9',       // Light gray
    white: '#ffffff',
    border: '#e2e8f0',
    gold: '#d97706',          // Premium gold
    teal: '#0d9488'          // Teal accent
};

// Premium type colors for charts and badges
const PREMIUM_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
    '#14b8a6', '#f43f5e', '#0ea5e9', '#84cc16', '#a855f7'
];

// Format number to Indonesian locale
const formatNumber = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    const num = Number(value);
    if (isNaN(num)) return '-';
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(Math.round(num));
};

// Format to millions (for compact display)
const formatMillions = (value) => {
    const num = Number(value) || 0;
    if (num >= 1000000) {
        return `Rp ${(num / 1000000).toFixed(1)}jt`;
    } else if (num >= 1000) {
        return `Rp ${(num / 1000).toFixed(0)}rb`;
    }
    return `Rp ${num.toFixed(0)}`;
};

// Extract assistance/group from gang code
const getAsistensi = (gc) => {
    if (!gc) return null;
    const g = gc.trim().toUpperCase();
    if (g.startsWith('K2')) return '1';
    const match = g.match(/\d/);
    return match ? match[0] : null;
};

// Get short name for premium type (max 15 chars)
const getShortName = (name) => {
    if (!name) return 'LAIN';
    // Remove common prefixes
    let short = name
        .replace(/^(PREMI\s+)+/i, '')
        .replace(/^TUNJANGAN\s+PREMI\s*/i, '')
        .replace(/\s*\([^)]+\)\s*/g, ' ')
        .trim();
    if (short.length > 12) {
        short = short.substring(0, 10) + '..';
    }
    return short;
};

export default function LampiranPremiAppendix({
    filteredSummaryData,
    filteredGrandTotal,
    companyInfo,
    periodLabel,
    reportDivisionSummary,
    printDate,
    user,
    dynamicPremiHeaders
}) {
    // Get dynamic premium value from row
    const getDynamicPremiValue = (row, headerName) => {
        if (!row._dynamic_premi_list || !Array.isArray(row._dynamic_premi_list)) return 0;
        const item = row._dynamic_premi_list.find(
            p => p.header && p.header.toLowerCase() === headerName.toLowerCase()
        );
        return item ? parseFloat(item.total || 0) : 0;
    };

    // Build lampiran data structure: Division > Group > Gang
    const lampiranData = useMemo(() => {
        const divisionsMap = new Map();

        filteredSummaryData.forEach(row => {
            const divKey = row.division_code || 'LAINNYA';
            if (!divisionsMap.has(divKey)) {
                divisionsMap.set(divKey, {
                    division_code: divKey,
                    gangs: [],
                    subtotal_premi: 0,
                    subtotal_dynamic: {}
                });
            }
            const divData = divisionsMap.get(divKey);
            divData.gangs.push(row);
            divData.subtotal_premi += Number(row.total_premi || 0);

            if (row._dynamic_premi_list) {
                row._dynamic_premi_list.forEach(dp => {
                    const h = dp.header;
                    divData.subtotal_dynamic[h] = (divData.subtotal_dynamic[h] || 0) + Number(dp.total || 0);
                });
            }
        });

        const result = Array.from(divisionsMap.values()).map(div => {
            const groupsMap = new Map();
            div.gangs.forEach(gang => {
                const groupKey = getAsistensi(gang.gang_code) || 'LAINNYA';
                if (!groupsMap.has(groupKey)) {
                    groupsMap.set(groupKey, { group: groupKey, gangs: [] });
                }
                groupsMap.get(groupKey).gangs.push(gang);
            });

            const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => {
                const aNum = Number(a.group);
                const bNum = Number(b.group);
                if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) return aNum - bNum;
                if (isNaN(aNum)) return 1;
                if (isNaN(bNum)) return -1;
                return String(a.group).localeCompare(String(b.group));
            });

            return { ...div, groups: sortedGroups };
        });

        return result.sort((a, b) => String(a.division_code).localeCompare(String(b.division_code)));
    }, [filteredSummaryData]);

    // Chart data: Division distribution
    const divisionChartData = useMemo(() => {
        return lampiranData.map(div => ({
            name: div.division_code,
            fullName: `Estate ${div.division_code}`,
            value: div.subtotal_premi,
            percentage: filteredGrandTotal?.total_premi > 0
                ? ((div.subtotal_premi / filteredGrandTotal.total_premi) * 100).toFixed(1)
                : 0,
            gangCount: div.gangs.length
        }));
    }, [lampiranData, filteredGrandTotal]);

    // Chart data: Premium type distribution (sorted by value)
    const premiumTypeChartData = useMemo(() => {
        if (!filteredGrandTotal?.dynamic_premi_totals) return [];
        return Object.entries(filteredGrandTotal.dynamic_premi_totals)
            .filter(([_, v]) => Number(v) > 0)
            .map(([k, v]) => ({
                name: getShortName(k),
                fullName: k,
                value: Number(v),
                percentage: filteredGrandTotal.total_premi > 0
                    ? ((Number(v) / filteredGrandTotal.total_premi) * 100).toFixed(1)
                    : 0
            }))
            .sort((a, b) => b.value - a.value);
    }, [filteredGrandTotal]);

    // Chart data: Top gangs by premium
    const topGangsData = useMemo(() => {
        return [...filteredSummaryData]
            .sort((a, b) => Number(b.total_premi || 0) - Number(a.total_premi || 0))
            .slice(0, 12)
            .map(g => ({
                name: g.gang_code,
                fullName: g.gang_description || g.gang_code,
                value: Number(g.total_premi || 0)
            }));
    }, [filteredSummaryData]);

    // Premium matrix: all premium types per division
    const premiumMatrix = useMemo(() => {
        const matrix = [];
        const premiumTypes = premiumTypeChartData.map(p => p.fullName);

        lampiranData.forEach(div => {
            const row = {
                division: div.division_code,
                total: div.subtotal_premi,
                premiums: {}
            };
            premiumTypes.forEach(type => {
                row.premiums[type] = div.subtotal_dynamic[type] || 0;
            });
            matrix.push(row);
        });
        return matrix;
    }, [lampiranData, premiumTypeChartData]);

    // Build breakdown badges for a gang
    const buildPremiumBadges = (row) => {
        if (!dynamicPremiHeaders || !dynamicPremiHeaders.length) return null;

        const badges = dynamicPremiHeaders
            .map((header, idx) => {
                const value = getDynamicPremiValue(row, header);
                if (Number(value || 0) === 0) return null;
                return {
                    header,
                    shortName: getShortName(header),
                    value,
                    color: PREMIUM_COLORS[idx % PREMIUM_COLORS.length]
                };
            })
            .filter(Boolean);

        return badges;
    };

    const filteredGrandTotalLabel = 'GRAND TOTAL';

    return (
        <div className="lampiran-premi-appendix" id="summary-premi-appendix-content">
            <ReportWatermark />

            {/* Enhanced Header */}
            <div className="lampiran-header-enhanced">
                <div className="lampiran-header-left">
                    <img
                        src={companyInfo.logo}
                        alt={companyInfo.name}
                        className="lampiran-logo"
                        onError={(e) => { e.target.src = companyInfo.logoFallback; }}
                    />
                    <div className="lampiran-header-info">
                        <h1 className="lampiran-company">{companyInfo.name}</h1>
                        <div className="lampiran-title">LAMPIRAN REPORT II - REKAPITULASI TOTAL PREMI</div>
                        <div className="lampiran-period">
                            <span className="lampiran-period-badge">{reportDivisionSummary}</span>
                            <span className="lampiran-period-divider">|</span>
                            <span className="lampiran-period-value">{periodLabel}</span>
                        </div>
                    </div>
                </div>
                <div className="lampiran-header-stats">
                    <div className="lampiran-stat-item">
                        <span className="lampiran-stat-value">{lampiranData.length}</span>
                        <span className="lampiran-stat-label">Estate</span>
                    </div>
                    <div className="lampiran-stat-item">
                        <span className="lampiran-stat-value">{filteredSummaryData.length}</span>
                        <span className="lampiran-stat-label">Gang</span>
                    </div>
                    <div className="lampiran-stat-item">
                        <span className="lampiran-stat-value">{premiumTypeChartData.length}</span>
                        <span className="lampiran-stat-label">Jenis Premi</span>
                    </div>
                </div>
            </div>

            {/* KPI Summary Cards */}
            <div className="lampiran-kpi-row">
                <div className="lampiran-kpi-card lampiran-kpi-hero">
                    <div className="lampiran-kpi-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                        </svg>
                    </div>
                    <div className="lampiran-kpi-content">
                        <div className="lampiran-kpi-label">TOTAL PREMI</div>
                        <div className="lampiran-kpi-value">Rp {formatNumber(filteredGrandTotal?.total_premi || 0)}</div>
                        <div className="lampiran-kpi-meta">Seluruh Estate</div>
                    </div>
                </div>
                <div className="lampiran-kpi-card">
                    <div className="lampiran-kpi-icon secondary">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                    </div>
                    <div className="lampiran-kpi-content">
                        <div className="lampiran-kpi-label">RATA-RATA PER GANG</div>
                        <div className="lampiran-kpi-value small">
                            {filteredSummaryData.length > 0
                                ? formatMillions(filteredGrandTotal?.total_premi / filteredSummaryData.length)
                                : '-'}
                        </div>
                        <div className="lampiran-kpi-meta">Periode {periodLabel}</div>
                    </div>
                </div>
                <div className="lampiran-kpi-card">
                    <div className="lampiran-kpi-icon accent">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                    </div>
                    <div className="lampiran-kpi-content">
                        <div className="lampiran-kpi-label">PREMI TERBESAR</div>
                        <div className="lampiran-kpi-value small">
                            {premiumTypeChartData[0]?.fullName || '-'}
                        </div>
                        <div className="lampiran-kpi-meta">
                            {premiumTypeChartData[0] ? formatMillions(premiumTypeChartData[0].value) : ''}
                        </div>
                    </div>
                </div>
                <div className="lampiran-kpi-card">
                    <div className="lampiran-kpi-icon success">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                    </div>
                    <div className="lampiran-kpi-content">
                        <div className="lampiran-kpi-label">ESTATE TERBANYAK</div>
                        <div className="lampiran-kpi-value small">
                            {lampiranData.reduce((max, div) =>
                                div.gangs.length > max.gangs.length ? div : max,
                                { gangs: [] }
                            ).division_code || '-'}
                        </div>
                        <div className="lampiran-kpi-meta">
                            {lampiranData.reduce((max, div) =>
                                div.gangs.length > max ? div.gangs.length : max,
                                0
                            )} Gang
                        </div>
                    </div>
                </div>
            </div>

            {/* Premium Type Legend */}
            <div className="lampiran-premi-legend">
                <div className="lampiran-legend-title">KETERANGAN JENIS PREMI</div>
                <div className="lampiran-legend-items">
                    {premiumTypeChartData.map((premi, idx) => (
                        <div key={premi.fullName} className="lampiran-legend-item">
                            <span
                                className="lampiran-legend-color"
                                style={{ backgroundColor: PREMIUM_COLORS[idx % PREMIUM_COLORS.length] }}
                            />
                            <span className="lampiran-legend-name">{premi.fullName}</span>
                            <span className="lampiran-legend-value">{formatNumber(premi.value)}</span>
                            <span className="lampiran-legend-percent">({premi.percentage}%)</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Charts Section */}
            <div className="lampiran-charts-grid">
                {/* Division Distribution Pie */}
                <div className="lampiran-chart-card lampiran-chart-donut">
                    <div className="lampiran-chart-header">
                        <div className="lampiran-chart-title">DISTRIBUSI PREMI PER ESTATE</div>
                        <div className="lampiran-chart-subtitle">Persentase each wilayah</div>
                    </div>
                    <div className="lampiran-chart-container">
                        <ResponsiveContainer width="100%" height={280}>
                            <PieChart>
                                <Pie
                                    data={divisionChartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={110}
                                    paddingAngle={3}
                                    dataKey="value"
                                    label={({ name, percentage }) => `${name}: ${percentage}%`}
                                    labelLine={false}
                                >
                                    {divisionChartData.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={PREMIUM_COLORS[index % PREMIUM_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value, name, props) => [
                                        `Rp ${formatNumber(value)}`,
                                        `${props.payload.gangCount} gang`
                                    ]}
                                    contentStyle={{
                                        backgroundColor: COLORS.primary,
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontSize: '12px'
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="lampiran-chart-legend">
                        {divisionChartData.map((div, idx) => (
                            <div key={div.name} className="lampiran-chart-legend-item">
                                <span
                                    className="lampiran-legend-dot"
                                    style={{ backgroundColor: PREMIUM_COLORS[idx % PREMIUM_COLORS.length] }}
                                />
                                <span className="lampiran-legend-label">{div.name}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Premium Type Bar Chart */}
                <div className="lampiran-chart-card lampiran-chart-bar">
                    <div className="lampiran-chart-header">
                        <div className="lampiran-chart-title">NILAI PER JENIS PREMI</div>
                        <div className="lampiran-chart-subtitle">Total per kategori premi</div>
                    </div>
                    <div className="lampiran-chart-container">
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={premiumTypeChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                                <XAxis type="number" tickFormatter={(v) => `Rp ${(v/1000000).toFixed(0)}jt`} />
                                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
                                <Tooltip
                                    formatter={(value, name, props) => [`Rp ${formatNumber(value)}`, props.payload.fullName]}
                                    contentStyle={{
                                        backgroundColor: COLORS.primary,
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontSize: '12px'
                                    }}
                                />
                                <Bar dataKey="value" radius={[0, 4, 4, 0]} label={{ position: 'right', formatter: (v) => formatMillions(v) }}>
                                    {premiumTypeChartData.map((_, index) => (
                                        <Cell key={`bar-${index}`} fill={PREMIUM_COLORS[index % PREMIUM_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Top Gangs Chart */}
                <div className="lampiran-chart-card lampiran-chart-wide">
                    <div className="lampiran-chart-header">
                        <div className="lampiran-chart-title">TOP GANG DENGAN PREMI TERTINGGI</div>
                        <div className="lampiran-chart-subtitle">12 gang dengan nilai premi terbesar</div>
                    </div>
                    <div className="lampiran-chart-container">
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={topGangsData} layout="vertical" margin={{ left: 10, right: 50 }}>
                                <XAxis type="number" tickFormatter={(v) => `Rp ${(v/1000000).toFixed(1)}jt`} />
                                <YAxis type="category" dataKey="name" width={50} tick={{ fontSize: 9 }} />
                                <Tooltip
                                    formatter={(value, name, props) => [
                                        `Rp ${formatNumber(value)}`,
                                        props.payload.fullName
                                    ]}
                                    contentStyle={{
                                        backgroundColor: COLORS.primary,
                                        border: 'none',
                                        borderRadius: '8px',
                                        fontSize: '12px'
                                    }}
                                />
                                <Bar dataKey="value" fill={COLORS.accent} radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Premium Matrix Table */}
            <div className="lampiran-matrix-section">
                <div className="lampiran-matrix-header">
                    <div className="lampiran-matrix-title">MATRIKS PREMI PER ESTATE</div>
                    <div className="lampiran-matrix-subtitle">Rincian total setiap jenis premi per estate</div>
                </div>
                <div className="lampiran-matrix-wrapper">
                    <table className="lampiran-matrix-table">
                        <thead>
                            <tr>
                                <th className="lampiran-matrix-th-estate">ESTATE</th>
                                <th className="lampiran-matrix-th-gang">GANG</th>
                                {premiumTypeChartData.slice(0, 8).map((premi, idx) => (
                                    <th key={premi.fullName} className="lampiran-matrix-th-premi" style={{
                                        backgroundColor: PREMIUM_COLORS[idx % PREMIUM_COLORS.length] + '20',
                                        borderBottomColor: PREMIUM_COLORS[idx % PREMIUM_COLORS.length]
                                    }}>
                                        <div className="lampiran-matrix-th-content">
                                            <span className="lampiran-matrix-th-name">{getShortName(premi.fullName)}</span>
                                            <span className="lampiran-matrix-th-total">Rp {formatNumber(premi.value)}</span>
                                        </div>
                                    </th>
                                ))}
                                <th className="lampiran-matrix-th-total-col">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lampiranData.map((div, divIdx) => (
                                <React.Fragment key={`div-${div.division_code}`}>
                                    {div.groups.map((grp, grpIdx) => (
                                        <React.Fragment key={`grp-${div.division_code}-${grp.group}`}>
                                            {grp.gangs.map((gang, gangIdx) => {
                                                const badges = buildPremiumBadges(gang);
                                                return (
                                                    <tr key={`gang-${gang.gang_code || gangIdx}`} className="lampiran-matrix-gang-row">
                                                        <td className="lampiran-matrix-estate-cell">
                                                            {gangIdx === 0 && grpIdx === 0 ? div.division_code : ''}
                                                        </td>
                                                        <td className="lampiran-matrix-gang-cell">
                                                            <div className="lampiran-matrix-gang-name">{gang.gang_code}</div>
                                                            {gang.gang_description && gang.gang_description !== gang.gang_code && (
                                                                <div className="lampiran-matrix-gang-desc">{gang.gang_description}</div>
                                                            )}
                                                        </td>
                                                        {premiumTypeChartData.slice(0, 8).map((premi, idx) => {
                                                            const val = getDynamicPremiValue(gang, premi.fullName);
                                                            return (
                                                                <td key={premi.fullName} className="lampiran-matrix-premi-cell">
                                                                    <span className={`lampiran-matrix-badge ${Number(val) === 0 ? 'zero' : ''}`}
                                                                        style={{
                                                                            backgroundColor: Number(val) > 0
                                                                                ? PREMIUM_COLORS[idx % PREMIUM_COLORS.length] + '15'
                                                                                : '#f1f5f9',
                                                                            borderColor: Number(val) > 0
                                                                                ? PREMIUM_COLORS[idx % PREMIUM_COLORS.length] + '40'
                                                                                : '#e2e8f0'
                                                                        }}
                                                                    >
                                                                        {Number(val) > 0 ? formatNumber(val) : '-'}
                                                                    </span>
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="lampiran-matrix-total-cell">
                                                            <span className="lampiran-matrix-total-value">
                                                                {formatNumber(gang.total_premi)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {/* Group Subtotal */}
                                            <tr className="lampiran-matrix-group-subtotal">
                                                <td colSpan="2" className="lampiran-matrix-subtotal-label">
                                                    SUBTOTAL GROUP {grp.group}
                                                </td>
                                                {premiumTypeChartData.slice(0, 8).map((premi, idx) => {
                                                    const groupTotal = grp.gangs.reduce((sum, g) => sum + getDynamicPremiValue(g, premi.fullName), 0);
                                                    return (
                                                        <td key={premi.fullName} className="lampiran-matrix-subtotal-value">
                                                            {formatNumber(groupTotal)}
                                                        </td>
                                                    );
                                                })}
                                                <td className="lampiran-matrix-subtotal-total">
                                                    {formatNumber(grp.gangs.reduce((sum, g) => sum + Number(g.total_premi || 0), 0))}
                                                </td>
                                            </tr>
                                        </React.Fragment>
                                    ))}
                                    {/* Division Subtotal */}
                                    <tr className="lampiran-matrix-div-subtotal">
                                        <td colSpan="2" className="lampiran-matrix-subtotal-label">
                                            SUBTOTAL {div.division_code}
                                        </td>
                                        {premiumTypeChartData.slice(0, 8).map((premi, idx) => (
                                            <td key={premi.fullName} className="lampiran-matrix-subtotal-value">
                                                {formatNumber(div.subtotal_dynamic[premi.fullName] || 0)}
                                            </td>
                                        ))}
                                        <td className="lampiran-matrix-subtotal-total">
                                            {formatNumber(div.subtotal_premi)}
                                        </td>
                                    </tr>
                                </React.Fragment>
                            ))}
                        </tbody>
                        {filteredGrandTotal && (
                            <tfoot>
                                <tr className="lampiran-matrix-grand-total">
                                    <td colSpan="2">{filteredGrandTotalLabel}</td>
                                    {premiumTypeChartData.slice(0, 8).map((premi, idx) => (
                                        <td key={premi.fullName}>
                                            {formatNumber(filteredGrandTotal.dynamic_premi_totals?.[premi.fullName] || 0)}
                                        </td>
                                    ))}
                                    <td>{formatNumber(filteredGrandTotal.total_premi)}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Detailed Breakdown Table */}
            <div className="lampiran-table-section">
                <div className="lampiran-table-header">
                    <div className="lampiran-table-title">REKAPITULASI DETAIL PER GANG</div>
                    <div className="lampiran-table-subtitle">Detail uraian premi dan breakdown per gang</div>
                </div>
                <div className="lampiran-table-wrapper">
                    <table className="lampiran-table">
                        <thead>
                            <tr className="lampiran-thead-row">
                                <th className="lampiran-th-no">NO</th>
                                <th className="lampiran-th-gang">ESTATE / GANG</th>
                                <th className="lampiran-th-premi">TOTAL PREMI</th>
                                <th className="lampiran-th-detail">URAIAN PREMI (BREAKDOWN)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSummaryData.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="lampiran-no-data">No Data Available</td>
                                </tr>
                            ) : lampiranData.map((div, divIdx) => {
                                let rowNo = 0;

                                return (
                                    <React.Fragment key={`div-${div.division_code}`}>
                                        {/* Division Header */}
                                        <tr className="lampiran-division-header">
                                            <td colSpan="4" className="lampiran-division-cell">
                                                <div className="lampiran-division-left">
                                                    <span className="lampiran-division-badge">
                                                        ESTATE
                                                    </span>
                                                    <span className="lampiran-division-name">{div.division_code}</span>
                                                </div>
                                                <div className="lampiran-division-right">
                                                    <span className="lampiran-division-gang-count">{div.gangs.length} gang</span>
                                                    <span className="lampiran-division-total">
                                                        <span className="lampiran-division-total-label">Subtotal:</span>
                                                        <span className="lampiran-division-total-value">Rp {formatNumber(div.subtotal_premi)}</span>
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Groups and Gang Rows */}
                                        {div.groups.map((grp, grpIdx) => {
                                            let groupPremi = 0;
                                            grp.gangs.forEach(g => groupPremi += Number(g.total_premi || 0));

                                            return (
                                                <React.Fragment key={`div-${div.division_code}-grp-${grp.group}`}>
                                                    {/* Group Header */}
                                                    <tr className="lampiran-group-header">
                                                        <td colSpan="4" className="lampiran-group-cell">
                                                            <span className="lampiran-group-badge">GROUP {grp.group}</span>
                                                            <span className="lampiran-group-count">{grp.gangs.length} gang</span>
                                                        </td>
                                                    </tr>

                                                    {/* Gang Rows */}
                                                    {grp.gangs.map((gang, gangIdx) => {
                                                        rowNo++;
                                                        const hasDesc = gang.gang_description && gang.gang_description !== gang.gang_code;
                                                        const gangName = hasDesc ? gang.gang_description : gang.gang_code;
                                                        const badges = buildPremiumBadges(gang);

                                                        return (
                                                            <tr key={`gang-${gang.gang_code || gangIdx}`} className="lampiran-gang-row">
                                                                <td className="lampiran-cell-no">{rowNo}</td>
                                                                <td className="lampiran-cell-gang">
                                                                    <span className="lampiran-gang-code">{gang.gang_code}</span>
                                                                    {hasDesc && (
                                                                        <span className="lampiran-gang-name">{gangName}</span>
                                                                    )}
                                                                </td>
                                                                <td className="lampiran-cell-premi">
                                                                    <span className="lampiran-premi-amount">Rp {formatNumber(gang.total_premi)}</span>
                                                                </td>
                                                                <td className="lampiran-cell-detail">
                                                                    <div className="lampiran-premi-badges">
                                                                        {badges && badges.length > 0 ? (
                                                                            badges.map((badge, idx) => (
                                                                                <span
                                                                                    key={idx}
                                                                                    className="lampiran-premi-badge"
                                                                                    style={{
                                                                                        backgroundColor: badge.color + '15',
                                                                                        borderColor: badge.color + '50',
                                                                                        color: badge.color
                                                                                    }}
                                                                                >
                                                                                    <span className="lampiran-badge-name">{badge.shortName}</span>
                                                                                    <span className="lampiran-badge-value">{formatNumber(badge.value)}</span>
                                                                                </span>
                                                                            ))
                                                                        ) : (
                                                                            <span className="lampiran-no-premi">-</span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}

                                                    {/* Group Subtotal */}
                                                    <tr className="lampiran-group-subtotal">
                                                        <td colSpan="2" className="lampiran-subtotal-label">
                                                            SUBTOTAL GROUP {grp.group}
                                                        </td>
                                                        <td className="lampiran-subtotal-value">{formatNumber(groupPremi)}</td>
                                                        <td className="lampiran-subtotal-detail">-</td>
                                                    </tr>
                                                </React.Fragment>
                                            );
                                        })}

                                        {/* Division Subtotal */}
                                        <tr className="lampiran-division-subtotal">
                                            <td colSpan="2" className="lampiran-subtotal-label">
                                                SUBTOTAL {div.division_code}
                                            </td>
                                            <td className="lampiran-subtotal-value">{formatNumber(div.subtotal_premi)}</td>
                                            <td className="lampiran-subtotal-detail">
                                                <div className="lampiran-div-breakdown">
                                                    {Object.entries(div.subtotal_dynamic)
                                                        .filter(([_, v]) => Number(v) > 0)
                                                        .slice(0, 5)
                                                        .map(([k, v]) => (
                                                            <span key={k} className="lampiran-div-breakdown-item">
                                                                {getShortName(k)}: {formatNumber(v)}
                                                            </span>
                                                        ))}
                                                </div>
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                        {filteredGrandTotal && (
                            <tfoot>
                                <tr className="lampiran-grand-total">
                                    <td colSpan="2">{filteredGrandTotalLabel}</td>
                                    <td>{formatNumber(filteredGrandTotal.total_premi)}</td>
                                    <td>
                                        <div className="lampiran-grand-breakdown">
                                            {Object.entries(filteredGrandTotal.dynamic_premi_totals || {})
                                                .filter(([_, v]) => Number(v) > 0)
                                                .map(([k, v]) => (
                                                    <span key={k} className="lampiran-grand-breakdown-item">
                                                        {getShortName(k)}: {formatNumber(v)}
                                                    </span>
                                                ))}
                                        </div>
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Footer */}
            <footer className="lampiran-footer">
                <div className="lampiran-footer-left">
                    <span>Dicetak: {printDate}</span>
                    <span className="lampiran-footer-user">User: {user?.username}</span>
                </div>
                <div className="lampiran-footer-right">
                    {companyInfo.name}
                </div>
            </footer>
        </div>
    );
}