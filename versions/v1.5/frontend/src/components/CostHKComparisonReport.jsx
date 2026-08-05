/**
 * Cost/HK Comparison Report Component
 * Professional report showing cost per Hari Kerja by gang type
 * Gang classification: H=Harvesting, T=Transport, M=Maintenance
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchCostHKComparison, fetchAvailableGangs, exportToCSV } from '../services/costHKService';
import ReportPrintMetadata from './common/ReportPrintMetadata';
import ReportWatermark from './common/ReportWatermark';
import { printReport } from '../utils/printPageSetup';
import '../styles/cost-hk-report.css';
import '../styles/report-print-foundation.css';

// Format currency
const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(value);
};

// Format number
const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('id-ID').format(value);
};

// Get month name
const getMonthName = (month) => {
    const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return months[month] || '';
};

// Get gang type label
const getGangTypeLabel = (type) => {
    const labels = {
        harvesting: 'Panen (Harvesting)',
        transport: 'Transport',
        maintenance: 'Maintenance',
        uncategorized: 'Lainnya'
    };
    return labels[type] || type;
};

// Get gang type color
const getGangTypeColor = (type) => {
    const colors = {
        harvesting: '#16a34a', // green
        transport: '#2563eb', // blue
        maintenance: '#d97706', // amber
        uncategorized: '#64748b' // gray
    };
    return colors[type] || '#64748b';
};

export default function CostHKComparisonReport({ initialMonth, initialYear }) {
    const { token } = useAuth();

    // State
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());
    const [divisionFilter, setDivisionFilter] = useState('ALL');
    const [gangTypeFilter, setGangTypeFilter] = useState('ALL');
    const [selectedGangs, setSelectedGangs] = useState([]);
    const [availableGangs, setAvailableGangs] = useState([]);
    const [reportData, setReportData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);

    // Fetch available gangs when period changes
    useEffect(() => {
        async function loadGangs() {
            if (!token) return;
            try {
                const result = await fetchAvailableGangs(token, month, year);
                if (result.success) {
                    setAvailableGangs(result.data || []);
                }
            } catch (e) {
                console.error('Failed to load gangs:', e);
            }
        }
        loadGangs();
    }, [token, month, year]);

    // Fetch report data
    const fetchData = useCallback(async () => {
        if (!token) return;

        setLoading(true);
        setError('');

        try {
            const result = await fetchCostHKComparison(token, {
                month,
                year,
                divisionFilter,
                gangTypeFilter,
                gangCodes: selectedGangs
            });

            if (result.success) {
                setReportData(result);
            } else {
                setError(result.error || 'Failed to fetch data');
            }
        } catch (e) {
            console.error('Error fetching cost/HK data:', e);
            setError(e.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    }, [token, month, year, divisionFilter, selectedGangs]);

    // Fetch data when filters change
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownOpen && !event.target.closest('.cost-hk-gang-filter')) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [dropdownOpen]);

    // Handle print
    const handlePrint = () => {
        printReport({ orientation: 'landscape' });
    };

    // Handle export
    const handleExport = () => {
        if (reportData) {
            const filename = `cost-hk-comparison-${month}-${year}.csv`;
            exportToCSV(reportData, filename);
        }
    };

    // Handle gang selection
    const handleGangToggle = (gangCode) => {
        setSelectedGangs(prev => {
            if (prev.includes(gangCode)) {
                return prev.filter(g => g !== gangCode);
            }
            return [...prev, gangCode];
        });
    };

    // Handle select all gangs
    const handleSelectAllGangs = () => {
        if (selectedGangs.length === availableGangs.length) {
            setSelectedGangs([]);
        } else {
            setSelectedGangs(availableGangs.map(g => g.gang_code));
        }
    };

    // Filter gangs by type
    const filteredGangs = useMemo(() => {
        if (selectedGangs.length === 0) {
            return reportData?.gang_details || [];
        }
        return (reportData?.gang_details || []).filter(g => selectedGangs.includes(g.gang_code));
    }, [reportData, selectedGangs]);

    // Group gangs by type for display - sorted alphabetically
    const groupedGangs = useMemo(() => {
        const groups = {
            harvesting: [],
            transport: [],
            maintenance: [],
            uncategorized: []
        };

        filteredGangs.forEach(gang => {
            if (groups[gang.gang_type]) {
                groups[gang.gang_type].push(gang);
            } else {
                groups.uncategorized.push(gang);
            }
        });

        // Sort each group alphabetically by gang_code
        Object.keys(groups).forEach(type => {
            groups[type].sort((a, b) => a.gang_code.localeCompare(b.gang_code));
        });

        return groups;
    }, [filteredGangs]);

    // Year options
    const currentYear = new Date().getFullYear();
    const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

    // Month options
    const monthOptions = [
        { value: 1, label: 'Januari' },
        { value: 2, label: 'Februari' },
        { value: 3, label: 'Maret' },
        { value: 4, label: 'April' },
        { value: 5, label: 'Mei' },
        { value: 6, label: 'Juni' },
        { value: 7, label: 'Juli' },
        { value: 8, label: 'Agustus' },
        { value: 9, label: 'September' },
        { value: 10, label: 'Oktober' },
        { value: 11, label: 'November' },
        { value: 12, label: 'Desember' }
    ];

    return (
        <div className="cost-hk-container">
            {/* Action Bar */}
            <div className="cost-hk-action-bar no-print">
                <div className="cost-hk-filters">
                    {/* Month Selector */}
                    <select
                        className="cost-hk-select"
                        value={month}
                        onChange={(e) => setMonth(parseInt(e.target.value))}
                    >
                        {monthOptions.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>

                    {/* Year Selector */}
                    <select
                        className="cost-hk-select"
                        value={year}
                        onChange={(e) => setYear(parseInt(e.target.value))}
                    >
                        {yearOptions.map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>

                    {/* Division Filter - IJL gangs start with 'L' */}
                    <select
                        className="cost-hk-select"
                        value={divisionFilter}
                        onChange={(e) => setDivisionFilter(e.target.value)}
                    >
                        <option value="ALL">Semua Divisi</option>
                        <option value="IJL">IJL Only (Kode L)</option>
                        <option value="NON_IJL">Non-IJL</option>
                    </select>

                    {/* Gang Type Filter */}
                    <select
                        className="cost-hk-select"
                        value={gangTypeFilter}
                        onChange={(e) => setGangTypeFilter(e.target.value)}
                    >
                        <option value="ALL">Semua Tipe Gang</option>
                        <option value="harvesting">🌾 Panen (Harvesting)</option>
                        <option value="transport">🚛 Transport</option>
                        <option value="maintenance">🔧 Maintenance</option>
                        <option value="uncategorized">📋 Lainnya</option>
                    </select>

                    {/* Gang Multi-select */}
                    <div className="cost-hk-gang-filter">
                        <button
                            className="cost-hk-btn cost-hk-btn-secondary"
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                        >
                            Pilih Gang ({selectedGangs.length}/{availableGangs.length})
                        </button>
                        <div className={`cost-hk-dropdown ${dropdownOpen ? 'show' : ''}`}>
                            <div className="cost-hk-dropdown-header">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={selectedGangs.length === availableGangs.length}
                                        onChange={handleSelectAllGangs}
                                    />
                                    Pilih Semua
                                </label>
                            </div>
                            <div className="cost-hk-dropdown-list">
                                {availableGangs.map(gang => (
                                    <label key={gang.gang_code} className="cost-hk-dropdown-item">
                                        <input
                                            type="checkbox"
                                            checked={selectedGangs.includes(gang.gang_code)}
                                            onChange={() => handleGangToggle(gang.gang_code)}
                                        />
                                        <span className="gang-code">{gang.gang_code}</span>
                                        <span className="gang-desc" title={gang.gang_description}>
                                            {gang.gang_description?.length > 20
                                                ? gang.gang_description.substring(0, 20) + '...'
                                                : gang.gang_description}
                                        </span>
                                        <span className="gang-type" style={{ color: getGangTypeColor(gang.gang_type) }}>
                                            {getGangTypeLabel(gang.gang_type)}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="cost-hk-actions">
                    <button className="cost-hk-btn cost-hk-btn-primary" onClick={handlePrint}>
                        🖨️ Print Report
                    </button>
                    <button className="cost-hk-btn cost-hk-btn-secondary" onClick={handleExport}>
                        📊 Export CSV
                    </button>
                </div>
            </div>

            {/* Report Content */}
            <div className="cost-hk-report">
                <ReportWatermark />
                {/* Letterhead */}
                <div className="cost-hk-letterhead">
                    <img src="/assets/images/rebinmas.webp" alt="Logo" className="cost-hk-logo" />
                    <h1 className="cost-hk-company-name">PT. REBINMAS JAYA</h1>
                    <h2 className="cost-hk-report-title">LAPORAN PERBANDINGAN COST/HK</h2>
                    <p className="cost-hk-report-period">
                        Periode: {getMonthName(month)} {year}
                    </p>
                    <p className="cost-hk-report-filter">
                        Filter Divisi: {divisionFilter === 'ALL' ? 'Semua Divisi' : divisionFilter === 'IJL' ? 'IJL Only' : 'Non-IJL'}
                        {selectedGangs.length > 0 && ` | Gangs: ${selectedGangs.length} terpilih`}
                    </p>
                    <ReportPrintMetadata
                        mode="Cost/HK Comparison"
                        source="Cost HK API"
                        scope={divisionFilter === 'ALL' ? 'Semua Divisi' : divisionFilter === 'IJL' ? 'IJL Only' : 'Non-IJL'}
                        items={[{ label: 'Gang Terpilih', value: selectedGangs.length > 0 ? selectedGangs.length : '' }]}
                        note="Cost/HK dihitung dari total cost dibagi total HK pada gang yang masuk filter."
                    />
                </div>

                {/* Loading State */}
                {loading && (
                    <div className="cost-hk-loading">
                        <div className="cost-hk-spinner"></div>
                        <p>Memuat data...</p>
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className="cost-hk-error">
                        <p>Error: {error}</p>
                    </div>
                )}

                {/* Report Data */}
                {!loading && reportData && (
                    <>
                        {/* Summary Cards */}
                        <div className="cost-hk-summary">
                            <div className="cost-hk-summary-card total">
                                <div className="cost-hk-summary-label">Total Cost</div>
                                <div className="cost-hk-summary-value">
                                    {formatCurrency(reportData.grand_total.total_cost)}
                                </div>
                            </div>
                            <div className="cost-hk-summary-card total">
                                <div className="cost-hk-summary-label">Total HK</div>
                                <div className="cost-hk-summary-value">
                                    {formatNumber(reportData.grand_total.total_hk)}
                                </div>
                            </div>
                            <div className="cost-hk-summary-card highlight">
                                <div className="cost-hk-summary-label">Rata-rata Cost/HK</div>
                                <div className="cost-hk-summary-value">
                                    {formatCurrency(reportData.grand_total.cost_per_hk)}
                                </div>
                            </div>
                        </div>

                        {/* Summary by Gang Type */}
                        <div className="cost-hk-type-summary">
                            <h3 className="cost-hk-section-title">Ringkasan per Tipe Gang</h3>
                            <div className="cost-hk-type-cards">
                                {Object.entries(reportData.summary || {}).map(([type, data]) => (
                                    <div key={type} className="cost-hk-type-card" style={{ borderColor: getGangTypeColor(type) }}>
                                        <div className="cost-hk-type-header" style={{ backgroundColor: getGangTypeColor(type) }}>
                                            <span className="cost-hk-type-name">{getGangTypeLabel(type)}</span>
                                            <span className="cost-hk-type-count">{data.count} gangs</span>
                                        </div>
                                        <div className="cost-hk-type-body">
                                            <div className="cost-hk-type-row">
                                                <span>Total Cost:</span>
                                                <span>{formatCurrency(data.total_cost)}</span>
                                            </div>
                                            <div className="cost-hk-type-row">
                                                <span>Total HK:</span>
                                                <span>{formatNumber(data.total_hk)}</span>
                                            </div>
                                            <div className="cost-hk-type-row highlight">
                                                <span>Cost/HK:</span>
                                                <span>{formatCurrency(data.cost_per_hk)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Detailed Table */}
                        <div className="cost-hk-table-wrapper">
                            <h3 className="cost-hk-section-title">Detail per Gang</h3>
                            <table className="cost-hk-table">
                                <thead>
                                    <tr>
                                        <th className="sticky-col">Kode Gang</th>
                                        <th>Deskripsi</th>
                                        <th>Divisi</th>
                                        <th>Tipe Gang</th>
                                        <th className="text-right">Total HK</th>
                                        <th className="text-right">Total Cost</th>
                                        <th className="text-right highlight">Cost/HK</th>
                                        <th className="text-right">Headcount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(groupedGangs).map(([type, gangs]) => (
                                        gangs.length > 0 && (
                                            <React.Fragment key={type}>
                                                <tr className="cost-hk-group-header" style={{ backgroundColor: getGangTypeColor(type) + '20' }}>
                                                    <td colSpan="8" className="cost-hk-group-title">
                                                        <span className="cost-hk-type-badge" style={{ backgroundColor: getGangTypeColor(type) }}>
                                                            {getGangTypeLabel(type)}
                                                        </span>
                                                        <span className="cost-hk-group-count">({gangs.length} gangs)</span>
                                                    </td>
                                                </tr>
                                                {gangs.map((gang, idx) => (
                                                    <tr key={gang.gang_code} className={idx % 2 === 0 ? 'even' : 'odd'}>
                                                        <td className="sticky-col font-medium">{gang.gang_code}</td>
                                                        <td className="text-left" title={gang.gang_description}>
                                                            {gang.gang_description?.length > 25
                                                                ? gang.gang_description.substring(0, 25) + '...'
                                                                : gang.gang_description}
                                                        </td>
                                                        <td>{gang.division_code}</td>
                                                        <td>
                                                            <span className="cost-hk-type-badge" style={{ backgroundColor: getGangTypeColor(gang.gang_type) }}>
                                                                {getGangTypeLabel(gang.gang_type)}
                                                            </span>
                                                        </td>
                                                        <td className="text-right">{formatNumber(gang.total_hk)}</td>
                                                        <td className="text-right">{formatCurrency(gang.total_cost)}</td>
                                                        <td className="text-right font-bold" style={{ color: getGangTypeColor(gang.gang_type) }}>
                                                            {formatCurrency(gang.cost_per_hk)}
                                                        </td>
                                                        <td className="text-right">{formatNumber(gang.headcount)}</td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        )
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="cost-hk-grand-total">
                                        <td className="sticky-col" colSpan="4">GRAND TOTAL</td>
                                        <td className="text-right">{formatNumber(reportData.grand_total.total_hk)}</td>
                                        <td className="text-right">{formatCurrency(reportData.grand_total.total_cost)}</td>
                                        <td className="text-right">{formatCurrency(reportData.grand_total.cost_per_hk)}</td>
                                        <td className="text-right">{formatNumber(filteredGangs.reduce((sum, g) => sum + g.headcount, 0))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Footer */}
                        <div className="cost-hk-footer">
                            <p>Dicetak pada: {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
