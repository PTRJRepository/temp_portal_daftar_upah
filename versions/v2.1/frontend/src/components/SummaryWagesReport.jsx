import React, { useMemo, useEffect } from 'react';
import '../styles/summary-wages-print.css';
import PrintModeSelector from './common/PrintModeSelector';
import ReportWatermark from './common/ReportWatermark';
import { initPrintMode } from '../utils/printOptimizer';
import { printReport } from '../utils/printPageSetup';
import '../styles/report-print-foundation.css';

/**
 * SummaryWagesReport - A custom print-ready financial statement component
 * This component renders a classic professional report layout, NOT using AG-Grid.
 */
export default function SummaryWagesReport({
    rows = [],
    pinnedBottom = [],
    kpiData = {},
    companyName = 'PT. REBINMAS JAYA',
    reportTitle = 'SUMMARY WAGES',
    periodLabel = '',
    divisionName = '',
    onBack,
    onExport,
    loading = false
}) {
    // Initialize print mode on mount
    useEffect(() => {
        initPrintMode();
    }, []);

    // Format number with thousand separators
    const formatNumber = (value) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return value;
        return new Intl.NumberFormat('id-ID').format(Math.round(num));
    };

    // Get current date for print
    const printDate = new Date().toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    const IjlReport = useMemo(() => {
        const ijlRows = rows.filter((row) => row.divisionName === 'IJL');

        return ijlRows;
    }, []);

    // Process rows to separate gang headers, data rows, and subtotals
    const processedData = useMemo(() => {
        const result = [];
        let currentGang = null;

        rows.forEach((row, index) => {
            if (row.isHeader) {
                currentGang = row.gang_code;
                result.push({ type: 'gang-header', gang_code: row.gang_code, key: `header-${index}` });
            } else if (row.isTotal) {
                result.push({ type: 'subtotal', data: row, key: `subtotal-${index}` });
            } else if (!row.isHeader && !row.isTotal && row.nama !== 'GRAND TOTAL') {
                result.push({ type: 'data', data: row, gang_code: currentGang, key: `data-${index}` });
            }
        });

        // Add grand total from pinnedBottom
        if (pinnedBottom && pinnedBottom.length > 0) {
            result.push({ type: 'grand-total', data: pinnedBottom[0], key: 'grand-total' });
        }

        return result;
    }, [rows, pinnedBottom]);

    // Handle print
    const handlePrint = () => {
        printReport({ orientation: 'landscape' });
    };

    if (loading) {
        return (
            <div className="summary-wages-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>...</div>
                    <div style={{ color: '#64748b' }}>Generating Report...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="summary-wages-container">
            {/* Action Bar */}
            <div className="sw-action-bar">
                <button onClick={onBack} className="sw-btn">
                    BACK
                </button>
                <div className="btn-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <PrintModeSelector onPrint={handlePrint} />
                    <button onClick={handlePrint} className="sw-btn">
                        PRINT REPORT
                    </button>
                    <button onClick={onExport} className="sw-btn sw-btn-primary">
                        EXPORT CSV
                    </button>
                </div>
            </div>

            {/* Document (Paper) */}
            <div className="sw-document">
                <ReportWatermark />
                {/* Letterhead */}
                <header className="sw-letterhead">
                    <h1 className="sw-company-name">{companyName}</h1>
                    <h2 className="sw-report-title">{reportTitle}</h2>
                    <div className="sw-report-period">Periode: {periodLabel}</div>
                    {divisionName && <div className="sw-report-division">Divisi: {divisionName}</div>}
                </header>

                {/* KPI Cards */}
                <div className="sw-kpi-grid">
                    <div className="sw-kpi-card">
                        <div className="sw-kpi-label">Total Pekerja</div>
                        <div className="sw-kpi-value">{formatNumber(kpiData.totalWorkers)}</div>
                    </div>
                    <div className="sw-kpi-card">
                        <div className="sw-kpi-label">Total HK</div>
                        <div className="sw-kpi-value">{formatNumber(kpiData.totalHK)}</div>
                    </div>
                    <div className="sw-kpi-card">
                        <div className="sw-kpi-label">Total Premi</div>
                        <div className="sw-kpi-value">{formatNumber(kpiData.totalPremi)}</div>
                    </div>
                    <div className="sw-kpi-card highlight">
                        <div className="sw-kpi-label">Total Upah Bersih</div>
                        <div className="sw-kpi-value">{formatNumber(kpiData.grandTotalNet)}</div>
                    </div>
                </div>

                {/* Data Table */}
                <div className="sw-table-wrapper">
                    <table className="sw-table">
                        <thead>
                            {/* Level 1: Column Groups */}
                            <tr className="sw-header-group">
                                <th colSpan="3" style={{ borderRight: '2px solid #fff' }}>IDENTITAS</th>
                                <th colSpan="2" style={{ borderRight: '2px solid #fff' }}>ABSENSI</th>
                                <th colSpan="1" style={{ borderRight: '2px solid #fff' }}>GAJI POKOK</th>
                                <th colSpan="1" style={{ borderRight: '2px solid #fff' }}>TUNJANGAN</th>
                                <th colSpan="1" style={{ borderRight: '2px solid #fff' }}>PREMI</th>
                                <th colSpan="1" style={{ borderRight: '2px solid #fff' }}>POTONGAN</th>
                                <th colSpan="1">UPAH BERSIH</th>
                            </tr>
                            {/* Level 2: Column Names */}
                            <tr className="sw-header-cols">
                                <th style={{ width: '30px' }}>No</th>
                                <th style={{ width: 'auto' }}>Nama</th>
                                <th style={{ width: '65px' }}>NIK</th>
                                <th className="text-right" style={{ width: '40px' }}>HK</th>
                                <th className="text-right" style={{ width: '40px' }}>Lembur</th>
                                <th className="text-right" style={{ width: '90px' }}>Gaji Pokok</th>
                                <th className="text-right" style={{ width: '90px' }}>Total Tunj.</th>
                                <th className="text-right" style={{ width: '90px' }}>Total Premi</th>
                                <th className="text-right" style={{ width: '90px' }}>Total Pot.</th>
                                <th className="text-right" style={{ width: '100px' }}>Upah Bersih</th>
                            </tr>
                        </thead>
                        <tbody>
                            {processedData.map((item, idx) => {
                                if (item.type === 'gang-header') {
                                    return (
                                        <tr key={item.key} className="gang-header">
                                            <td colSpan="10">GANG: {item.gang_code}</td>
                                        </tr>
                                    );
                                }

                                if (item.type === 'subtotal') {
                                    const row = item.data;
                                    return (
                                        <tr key={item.key} className="subtotal">
                                            <td colSpan="3" className="text-left">{row.nama || 'SUB TOTAL'}</td>
                                            <td className="text-right">{formatNumber(row.jumlah_hk)}</td>
                                            <td className="text-right">{formatNumber(row.lembur_jam)}</td>
                                            <td className="text-right">{formatNumber(row.gaji_pokok)}</td>
                                            <td className="text-right">{formatNumber(row.total_tunjangan)}</td>
                                            <td className="text-right">{formatNumber(row.total_premi)}</td>
                                            <td className="text-right">{formatNumber(row.total_potongan)}</td>
                                            <td className="text-right">{formatNumber(row.upah_bersih)}</td>
                                        </tr>
                                    );
                                }

                                if (item.type === 'grand-total') {
                                    const row = item.data;
                                    return (
                                        <tr key={item.key} className="grand-total">
                                            <td colSpan="3" className="text-left">GRAND TOTAL</td>
                                            <td className="text-right">{formatNumber(row.jumlah_hk)}</td>
                                            <td className="text-right">{formatNumber(row.lembur_jam)}</td>
                                            <td className="text-right">{formatNumber(row.gaji_pokok)}</td>
                                            <td className="text-right">{formatNumber(row.total_tunjangan)}</td>
                                            <td className="text-right">{formatNumber(row.total_premi)}</td>
                                            <td className="text-right">{formatNumber(row.total_potongan)}</td>
                                            <td className="text-right">{formatNumber(row.upah_bersih)}</td>
                                        </tr>
                                    );
                                }

                                // Regular data row
                                const row = item.data;
                                const rowNum = idx + 1;

                                return (
                                    <tr key={item.key}>
                                        <td className="text-center">{rowNum}</td>
                                        <td className="text-left">{row.nama}</td>
                                        <td className="text-center">{row.new_nik || row.nik}</td>
                                        <td className={`text-right ${Number(row.jumlah_hk) === 0 ? 'val-zero' : 'val-positive'}`}>
                                            {formatNumber(row.jumlah_hk)}
                                        </td>
                                        <td className={`text-right ${Number(row.lembur_jam) === 0 ? 'val-zero' : 'val-positive'}`}>
                                            {formatNumber(row.lembur_jam)}
                                        </td>
                                        <td className={`text-right ${Number(row.gaji_pokok) === 0 ? 'val-zero' : 'val-positive'}`}>
                                            {formatNumber(row.gaji_pokok)}
                                        </td>
                                        <td className={`text-right ${Number(row.total_tunjangan) === 0 ? 'val-zero' : 'val-positive'}`}>
                                            {formatNumber(row.total_tunjangan)}
                                        </td>
                                        <td className={`text-right ${Number(row.total_premi) === 0 ? 'val-zero' : 'val-positive'}`}>
                                            {formatNumber(row.total_premi)}
                                        </td>
                                        <td className={`text-right ${Number(row.total_potongan) === 0 ? 'val-zero' : 'val-positive'}`}>
                                            {formatNumber(row.total_potongan)}
                                        </td>
                                        <td className="text-right val-positive" style={{ fontWeight: 600 }}>
                                            {formatNumber(row.upah_bersih)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Signature Section */}
                <div className="sw-signature-section">
                    <div className="sw-signature-block">
                        <div className="sw-signature-title">DIBUAT OLEH :</div>
                        <div className="sw-signature-name">( ........................................ )</div>
                        <div className="sw-signature-role">Admin Payroll</div>
                    </div>
                    <div className="sw-signature-block">
                        <div className="sw-signature-title">DIPERIKSA OLEH :</div>
                        <div className="sw-signature-name">( ........................................ )</div>
                        <div className="sw-signature-role">HR Manager</div>
                    </div>
                    <div className="sw-signature-block">
                        <div className="sw-signature-title">DIKETAHUI OLEH :</div>
                        <div className="sw-signature-name">( ........................................ )</div>
                        <div className="sw-signature-role">Senior Manager</div>
                    </div>
                    <div className="sw-signature-block">
                        <div className="sw-signature-title">DISETUJUI OLEH :</div>
                        <div className="sw-signature-name">( ........................................ )</div>
                        <div className="sw-signature-role">General Manager</div>
                    </div>
                </div>

                {/* Footer */}
                <footer className="sw-footer">
                    <div>Dicetak pada: {printDate}</div>
                    <div>{companyName} - {reportTitle}</div>
                </footer>
            </div>
        </div>
    );
}
