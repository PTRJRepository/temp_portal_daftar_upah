import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getEmployeeHistory } from '../../services/employeeDetailService';
import { fetchEmployeeWagesHistory, getStatusBadge } from '../../services/wagesService';
import './SalaryHistoryTable.css';

/**
 * SalaryHistoryTable - Comprehensive tabular view of salary history
 * Displays all daftar upah fields in a structured table with sortable columns.
 * Includes expandable rows with payslip-like detail and wages verification.
 */
export default function SalaryHistoryTable({ empCode, months = 12, onPeriodClick }) {
    const [historyData, setHistoryData] = useState([]);
    const [wagesData, setWagesData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortField, setSortField] = useState('period_year');
    const [sortDir, setSortDir] = useState('desc');
    const [expandedRow, setExpandedRow] = useState(null); // period key of expanded row
    const [expandedColumns, setExpandedColumns] = useState({
        absensi: false,
        tunjangan: false,
        potongan: false,
        pajak: false,
        wages: true,
    });
    const { token } = useAuth();

    useEffect(() => {
        if (!empCode || !token) return;
        setLoading(true);
        setError(null);

        // Fetch payroll history (now includes wages_data from backend)
        getEmployeeHistory(token, empCode, { months, includeCurrent: false })
            .then(payrollRes => {
                const payroll = payrollRes.data || [];

                // Process payroll data - wages_data is now included from backend
                const processed = payroll.map(p => {
                    const wagesFromBackend = p.wages_data;

                    return {
                        ...p,
                        wages: wagesFromBackend || null,
                        wages_status: wagesFromBackend
                            ? getWagesStatus(p.upah_bersih, wagesFromBackend?.upah_bersih_pr_wages)
                            : 'NO_WAGES'
                    };
                });

                setHistoryData(processed);
                setWagesData(processed.filter(p => p.wages));
            })
            .catch(err => setError(err.message || 'Failed to load data'))
            .finally(() => setLoading(false));
    }, [empCode, months, token]);

    // Helper to determine wages comparison status
    const getWagesStatus = (upahBersih, wagesBersihPrWages) => {
        if (!wagesBersihPrWages) return 'NO_WAGES';
        const diff = Math.abs((upahBersih || 0) - wagesBersihPrWages);
        if (diff <= 1000) return 'MATCH';
        if (diff <= 10000) return 'MINOR_DIFF';
        return 'MAJOR_DIFF';
    };

    const fmt = (value) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return value;
        if (num === 0) return '0';
        return new Intl.NumberFormat('id-ID').format(Math.round(num));
    };

    const fmtCurrency = (value) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return value;
        return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
    };

    const sorted = useMemo(() => {
        if (!historyData.length) return [];
        return [...historyData].sort((a, b) => {
            let aVal = a[sortField];
            let bVal = b[sortField];
            if (sortField === 'period_year') {
                aVal = a.period_year * 100 + a.period_month;
                bVal = b.period_year * 100 + b.period_month;
            }
            if (typeof aVal === 'string') {
                return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }, [historyData, sortField, sortDir]);

    const totals = useMemo(() => {
        if (!historyData.length) return {};
        const sum = (field) => historyData.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
        return {
            gaji_pokok: sum('gaji_pokok'),
            total_tunjangan: sum('total_tunjangan'),
            lembur_jumlah: sum('lembur_jumlah'),
            total_premi: sum('total_premi'),
            total_potongan: sum('total_potongan'),
            jumlah_upah_kotor: sum('jumlah_upah_kotor'),
            upah_bersih: sum('upah_bersih'),
        };
    }, [historyData]);

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('desc');
        }
    };

    const toggleColumnGroup = (group) => {
        setExpandedColumns(prev => ({ ...prev, [group]: !prev[group] }));
    };

    const toggleExpandRow = (periodKey) => {
        setExpandedRow(prev => prev === periodKey ? null : periodKey);
    };

    const SortIcon = ({ field }) => {
        if (sortField !== field) return <span className="sht-sort-icon">⇅</span>;
        return <span className="sht-sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
    };

    if (loading) {
        return (
            <div className="sht-table-container sht-table-loading">
                <div className="sht-spinner" />
                <p>Loading salary history...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="sht-table-container sht-table-error">
                <p>⚠ {error}</p>
            </div>
        );
    }

    if (!historyData.length) {
        return (
            <div className="sht-table-container sht-table-empty">
                <p>📭 No salary history data available</p>
            </div>
        );
    }

    // Calculate total columns for expanded detail row colspan
    const getColSpan = () => {
        let cols = 10; // base columns: Periode, Gang, HK, Upah Dasar, Gaji Pokok, Tot.Tunj, Lembur, Premi, Tot.Pot, Upah Kotor, Upah Bersih, Status
        cols = 12;
        if (expandedColumns.absensi) cols += 6;
        if (expandedColumns.tunjangan) cols += 3;
        if (expandedColumns.potongan) cols += 6;
        if (expandedColumns.pajak) cols += 4;
        if (expandedColumns.wages) cols += 3;
        return cols;
    };

    return (
        <div className="sht-table-container">
            <div className="sht-table-toolbar">
                <div className="sht-table-info">
                    📊 {historyData.length} periode dimuat — klik baris untuk melihat detail
                </div>
                <div className="sht-column-toggles">
                    {Object.entries({
                        absensi: '📋 Absensi',
                        tunjangan: '🎁 Tunjangan',
                        potongan: '📉 Potongan Detail',
                        pajak: '🏛️ Pajak',
                        wages: '💰 Wages'
                    }).map(([key, label]) => (
                        <button
                            key={key}
                            className={`sht-toggle-btn ${expandedColumns[key] ? 'active' : ''}`}
                            onClick={() => toggleColumnGroup(key)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="sht-table-scroll">
                <table className="sht-table">
                    <thead>
                        <tr>
                            <th onClick={() => handleSort('period_year')} className="sht-th-sticky">
                                Periode <SortIcon field="period_year" />
                            </th>
                            <th>Gang</th>

                            {/* Absensi */}
                            <th onClick={() => handleSort('jumlah_hk')}>HK <SortIcon field="jumlah_hk" /></th>
                            {expandedColumns.absensi && <>
                                <th>Hari Kerja</th>
                                <th>Jam Kerja</th>
                                <th>CT</th>
                                <th>CS</th>
                                <th>CM</th>
                                <th>CN</th>
                            </>}

                            {/* Penggajian */}
                            <th>Upah Dasar</th>
                            <th onClick={() => handleSort('gaji_pokok')}>Gaji Pokok <SortIcon field="gaji_pokok" /></th>

                            {/* Tunjangan */}
                            {expandedColumns.tunjangan && <>
                                <th>Beras</th>
                                <th>Jabatan</th>
                                <th>Masa Kerja</th>
                            </>}
                            <th onClick={() => handleSort('total_tunjangan')}>Tot. Tunj. <SortIcon field="total_tunjangan" /></th>

                            {/* Lembur & Premi */}
                            <th onClick={() => handleSort('lembur_jumlah')}>Lembur <SortIcon field="lembur_jumlah" /></th>
                            <th onClick={() => handleSort('total_premi')}>Premi <SortIcon field="total_premi" /></th>

                            {/* Potongan */}
                            {expandedColumns.potongan && <>
                                <th>SPSI</th>
                                <th>PPH21</th>
                                <th>ASTEK</th>
                                <th>BPJS Kes</th>
                                <th>BPJS Pens</th>
                                <th>Koreksi</th>
                            </>}
                            <th onClick={() => handleSort('total_potongan')}>Tot. Pot. <SortIcon field="total_potongan" /></th>

                            {/* Pajak */}
                            {expandedColumns.pajak && <>
                                <th>PTKP</th>
                                <th>TER</th>
                                <th>Tarif %</th>
                                <th>PPH21 TER</th>
                            </>}

                            {/* Totals */}
                            <th onClick={() => handleSort('jumlah_upah_kotor')}>Upah Kotor <SortIcon field="jumlah_upah_kotor" /></th>
                            <th onClick={() => handleSort('upah_bersih')} className="sht-th-net">
                                Upah Bersih <SortIcon field="upah_bersih" />
                            </th>

                            {/* Wages Verification */}
                            {expandedColumns.wages && <>
                                <th>Wages HK</th>
                                <th>Wages Bersih</th>
                                <th>Selisih</th>
                            </>}
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((row, idx) => {
                            const periodKey = `${row.period_year}_${row.period_month}`;
                            const isExpanded = expandedRow === periodKey;
                            return (
                                <React.Fragment key={periodKey}>
                                    {/* Summary Row */}
                                    <tr
                                        className={`sht-summary-row ${isExpanded ? 'sht-row-expanded' : ''}`}
                                        onClick={() => toggleExpandRow(periodKey)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <td className="sht-td-period">
                                            <span className="sht-expand-icon">{isExpanded ? '▼' : '▶'}</span>
                                            {row.period_label}
                                        </td>
                                        <td className="sht-td-gang">{row.gang_code || '-'}</td>

                                        {/* Absensi */}
                                        <td className="sht-td-num">{row.jumlah_hk || 0}</td>
                                        {expandedColumns.absensi && <>
                                            <td className="sht-td-num sht-td-dim">{row.hari_kerja || 0}</td>
                                            <td className="sht-td-num sht-td-dim">{fmt(row.total_jam_kerja)}</td>
                                            <td className="sht-td-num sht-td-dim">{row.cuti_tahunan_hari || 0}</td>
                                            <td className="sht-td-num sht-td-dim">{row.cuti_sakit_haid_hari || 0}</td>
                                            <td className="sht-td-num sht-td-dim">{row.cuti_minggu_hari || 0}</td>
                                            <td className="sht-td-num sht-td-dim">{row.cuti_nasional_hari || 0}</td>
                                        </>}

                                        {/* Penggajian */}
                                        <td className="sht-td-num sht-td-dim">{fmt(row.upah_dasar)}</td>
                                        <td className="sht-td-num">{fmt(row.gaji_pokok)}</td>

                                        {/* Tunjangan */}
                                        {expandedColumns.tunjangan && <>
                                            <td className="sht-td-num sht-td-dim">{fmt(row.beras_jumlah)}</td>
                                            <td className="sht-td-num sht-td-dim">{fmt(row.jabatan_jumlah)}</td>
                                            <td className="sht-td-num sht-td-dim">{fmt(row.masa_kerja_jumlah)}</td>
                                        </>}
                                        <td className="sht-td-num">{fmt(row.total_tunjangan)}</td>

                                        {/* Lembur & Premi */}
                                        <td className="sht-td-num">{fmt(row.lembur_jumlah)}</td>
                                        <td className="sht-td-num">{fmt(row.total_premi)}</td>

                                        {/* Potongan */}
                                        {expandedColumns.potongan && <>
                                            <td className="sht-td-num sht-td-neg">{fmt(row.pot_spsi)}</td>
                                            <td className="sht-td-num sht-td-neg">{fmt(row.pot_pph21)}</td>
                                            <td className="sht-td-num sht-td-neg">{fmt(row.pot_astek_pekerja || row.pot_astek)}</td>
                                            <td className="sht-td-num sht-td-neg">{fmt(row.pot_bpjs_kesehatan_pekerja)}</td>
                                            <td className="sht-td-num sht-td-neg">{fmt(row.pot_bpjs_pensiun_pekerja)}</td>
                                            <td className="sht-td-num sht-td-neg">{fmt(row.pot_koreksi)}</td>
                                        </>}
                                        <td className="sht-td-num sht-td-neg">{fmt(row.total_potongan)}</td>

                                        {/* Pajak */}
                                        {expandedColumns.pajak && <>
                                            <td className="sht-td-dim">{row.status_ptkp || '-'}</td>
                                            <td className="sht-td-dim">{row.kategori_ter || '-'}</td>
                                            <td className="sht-td-num sht-td-dim">{Number(row.tarif_pajak_ter || 0).toFixed(2)}%</td>
                                            <td className="sht-td-num sht-td-dim">{fmt(row.pph21_ter)}</td>
                                        </>}

                                        {/* Totals */}
                                        <td className="sht-td-num">{fmt(row.jumlah_upah_kotor)}</td>
                                        <td className="sht-td-num sht-td-net">{fmt(row.upah_bersih)}</td>

                                        {/* Wages Verification */}
                                        {expandedColumns.wages && <>
                                            <td className="sht-td-num sht-td-dim">{row.wages_data ? fmt(row.wages_data.jumlah_hk_pr_wages) : '-'}</td>
                                            <td className="sht-td-num sht-td-dim">{row.wages_data ? fmtCurrency(row.wages_data.upah_bersih_pr_wages) : '-'}</td>
                                            <td className={`sht-td-num ${row.wages_data && row.wages_data.upah_bersih_pr_wages !== row.upah_bersih ? 'sht-td-diff' : ''}`}>
                                                {row.wages_data ? fmtCurrency((row.upah_bersih || 0) - row.wages_data.upah_bersih_pr_wages) : '-'}
                                            </td>
                                        </>}
                                        <td>
                                            <WagesStatusBadge status={row.wages_status} />
                                        </td>
                                    </tr>

                                    {/* Expanded Detail Row */}
                                    {isExpanded && (
                                        <tr className="sht-detail-row">
                                            <td colSpan={getColSpan()}>
                                                <ExpandedPayslipDetail row={row} fmt={fmt} fmtCurrency={fmtCurrency} />
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="sht-totals-row">
                            <td colSpan={2 + (expandedColumns.absensi ? 6 : 0)}>TOTAL</td>

                            <td className="sht-td-num">{expandedColumns.absensi ? '' : ''}</td>
                            <td className="sht-td-num">{fmt(totals.gaji_pokok)}</td>
                            <td className="sht-td-num">{fmt(totals.gaji_pokok)}</td>

                            {expandedColumns.tunjangan && <td colSpan={3}></td>}
                            <td className="sht-td-num">{fmt(totals.total_tunjangan)}</td>

                            <td className="sht-td-num">{fmt(totals.lembur_jumlah)}</td>
                            <td className="sht-td-num">{fmt(totals.total_premi)}</td>

                            {expandedColumns.potongan && <td colSpan={6}></td>}
                            <td className="sht-td-num sht-td-neg">{fmt(totals.total_potongan)}</td>

                            {expandedColumns.pajak && <td colSpan={4}></td>}

                            <td className="sht-td-num">{fmt(totals.jumlah_upah_kotor)}</td>
                            <td className="sht-td-num sht-td-net">{fmt(totals.upah_bersih)}</td>

                            {expandedColumns.wages && <td colSpan={3}></td>}
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}

/**
 * ExpandedPayslipDetail - Payslip-like breakdown shown when a history row is expanded.
 * Shows earnings vs deductions side-by-side, plus wages comparison panel.
 */
function ExpandedPayslipDetail({ row, fmt, fmtCurrency }) {
    const n = (key) => Number(row[key]) || 0;
    const deductionAmount = (key) => Math.abs(n(key));

    // --- Earnings ---
    const gajiPokok = n('gaji_pokok') || (n('jumlah_hk') * n('upah_dasar'));

    const tunjanganList = [
        { label: 'Tunjangan Beras', value: n('beras_jumlah'), rate: n('beras_rate') },
        { label: 'Tunjangan Jabatan', value: n('jabatan_jumlah'), rate: n('jabatan_rate') },
        { label: 'Tunjangan Masa Kerja', value: n('masa_kerja_jumlah'), rate: n('masa_kerja_rate'), extra: row.masa_kerja_tahun ? `(${row.masa_kerja_tahun} thn)` : '' },
    ].filter(item => item.value > 0);

    const premiList = [];
    if (n('premi_brondol') > 0) premiList.push({ label: 'Premi Brondol', value: n('premi_brondol') });
    // Dynamic premi
    if (row.premi && typeof row.premi === 'object') {
        Object.entries(row.premi).forEach(([key, val]) => {
            if (key !== 'premi_brondol' && val > 0) {
                const label = key.replace(/_/g, ' ').replace(/premi /i, '').toUpperCase();
                premiList.push({ label: `Premi ${label}`, value: val });
            }
        });
    } else {
        Object.entries(row).forEach(([key, val]) => {
            if (key.startsWith('premi_') && key !== 'premi_brondol' && key !== 'premi_pph' && key !== 'pot_premi_pph' && typeof val === 'number' && val > 0) {
                const label = key.replace('premi_', '').replace(/_/g, ' ').toUpperCase();
                if (!premiList.some(p => p.label === `Premi ${label}`)) {
                    premiList.push({ label: `Premi ${label}`, value: val });
                }
            }
        });
    }

    const lemburJam = n('lembur_jam');
    const lemburJumlah = n('lembur_jumlah');

    // --- Deductions ---
    const potKotorList = [];
    if (deductionAmount('pot_koreksi') > 0) potKotorList.push({ label: 'Koreksi', value: deductionAmount('pot_koreksi') });
    Object.entries(row).forEach(([key, val]) => {
        const amount = Math.abs(Number(val) || 0);
        if (key.startsWith('koreksi_') && typeof val === 'number' && amount > 0) {
            const label = key.replace('koreksi_', '').replace(/_/g, ' ').toUpperCase();
            potKotorList.push({ label: `Koreksi ${label}`, value: amount });
        }
    });

    const potBersihList = [
        { label: 'BPJS Kesehatan', value: deductionAmount('pot_bpjs_kesehatan_pekerja') },
        { label: 'BPJS Pensiun', value: deductionAmount('pot_bpjs_pensiun_pekerja') },
        { label: 'Astek Pekerja', value: deductionAmount('pot_astek_pekerja') || deductionAmount('pot_astek') },
        { label: 'SPSI', value: deductionAmount('pot_spsi') },
        { label: 'PPh 21', value: deductionAmount('pot_pph21') },
    ].filter(item => item.value > 0);

    const jumlahUpahKotor = n('jumlah_upah_kotor');
    const totalPotongan = deductionAmount('total_potongan');
    const upahBersih = n('upah_bersih');
    const totalPremi = n('total_premi');
    const totalTunjangan = n('total_tunjangan');

    // --- Wages Comparison ---
    const wages = row.wages_data; // Use wages_data from backend (PR_WAGES)
    const wagesDiff = wages ? (upahBersih - (wages.upah_bersih_pr_wages || 0)) : null;
    const wagesHkDiff = wages ? (n('jumlah_hk') - (wages.jumlah_hk_pr_wages || 0)) : null;
    const wagesBadge = getStatusBadge(row.wages_status);

    return (
        <div className="sht-expanded-detail">
            {/* Period Header */}
            <div className="sht-detail-header">
                <h4>📋 Detail Daftar Upah — {row.period_label}</h4>
                <span className="sht-detail-gang">{row.gang_code} • {row.nama || row.emp_name || '-'}</span>
            </div>

            <div className="sht-detail-columns">
                {/* LEFT: PENERIMAAN */}
                <div className="sht-detail-col">
                    <h5 className="sht-col-title sht-col-earnings">💰 PENERIMAAN</h5>
                    <table className="sht-detail-table">
                        <tbody>
                            <tr>
                                <td>Gaji Pokok</td>
                                <td className="sht-detail-sub">{n('jumlah_hk')} HK × {fmtCurrency(n('upah_dasar'))}</td>
                                <td className="sht-detail-amount">{fmtCurrency(gajiPokok)}</td>
                            </tr>
                            {tunjanganList.length > 0 && (
                                <>
                                    <tr className="sht-detail-group-header"><td colSpan={3}>Tunjangan</td></tr>
                                    {tunjanganList.map((item, idx) => (
                                        <tr key={`tunj-${idx}`} className="sht-detail-indent">
                                            <td>- {item.label}</td>
                                            <td className="sht-detail-sub">
                                                {item.rate > 0 ? `@ ${fmtCurrency(item.rate)}` : ''} {item.extra || ''}
                                            </td>
                                            <td className="sht-detail-amount">{fmtCurrency(item.value)}</td>
                                        </tr>
                                    ))}
                                    <tr className="sht-detail-subtotal">
                                        <td colSpan={2}>Subtotal Tunjangan</td>
                                        <td className="sht-detail-amount">{fmtCurrency(totalTunjangan)}</td>
                                    </tr>
                                </>
                            )}
                            {premiList.length > 0 && (
                                <>
                                    <tr className="sht-detail-group-header"><td colSpan={3}>Premi</td></tr>
                                    {premiList.map((item, idx) => (
                                        <tr key={`prem-${idx}`} className="sht-detail-indent">
                                            <td>- {item.label}</td>
                                            <td></td>
                                            <td className="sht-detail-amount">{fmtCurrency(item.value)}</td>
                                        </tr>
                                    ))}
                                    <tr className="sht-detail-subtotal">
                                        <td colSpan={2}>Subtotal Premi</td>
                                        <td className="sht-detail-amount">{fmtCurrency(totalPremi)}</td>
                                    </tr>
                                </>
                            )}
                            {lemburJumlah > 0 && (
                                <tr>
                                    <td>Lembur</td>
                                    <td className="sht-detail-sub">{lemburJam} Jam</td>
                                    <td className="sht-detail-amount">{fmtCurrency(lemburJumlah)}</td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot>
                            <tr className="sht-detail-total-row">
                                <td colSpan={2}>TOTAL UPAH KOTOR</td>
                                <td className="sht-detail-amount">{fmtCurrency(jumlahUpahKotor)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* DIVIDER */}
                <div className="sht-detail-divider"></div>

                {/* RIGHT: POTONGAN */}
                <div className="sht-detail-col">
                    <h5 className="sht-col-title sht-col-deductions">📉 POTONGAN</h5>
                    <table className="sht-detail-table">
                        <tbody>
                            {potKotorList.length > 0 && (
                                <>
                                    <tr className="sht-detail-group-header"><td colSpan={3}>Potongan Upah Kotor</td></tr>
                                    {potKotorList.map((item, idx) => (
                                        <tr key={`potk-${idx}`} className="sht-detail-indent">
                                            <td>- {item.label}</td>
                                            <td></td>
                                            <td className="sht-detail-amount sht-text-red">{fmtCurrency(item.value)}</td>
                                        </tr>
                                    ))}
                                </>
                            )}
                            {potBersihList.length > 0 && (
                                <>
                                    <tr className="sht-detail-group-header"><td colSpan={3}>Potongan Upah Bersih</td></tr>
                                    {potBersihList.map((item, idx) => (
                                        <tr key={`potb-${idx}`} className="sht-detail-indent">
                                            <td>- {item.label}</td>
                                            <td></td>
                                            <td className="sht-detail-amount sht-text-red">{fmtCurrency(item.value)}</td>
                                        </tr>
                                    ))}
                                </>
                            )}
                        </tbody>
                        <tfoot>
                            <tr className="sht-detail-total-row">
                                <td colSpan={2}>TOTAL POTONGAN</td>
                                <td className="sht-detail-amount sht-text-red">{fmtCurrency(totalPotongan)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* NET PAY */}
            <div className="sht-detail-net-pay">
                <span className="sht-net-label">UPAH BERSIH (TAKE HOME PAY)</span>
                <span className="sht-net-amount">Rp {fmtCurrency(upahBersih)}</span>
            </div>

            {/* WAGES COMPARISON */}
            <div className="sht-wages-comparison">
                <h5>⚖️ Verifikasi Wages (PR_EMPWAGES)</h5>
                {wages ? (
                    <div className="sht-wages-grid">
                        <div className="sht-wages-item">
                            <span className="sht-wages-label">Daftar Upah HK</span>
                            <span className="sht-wages-value">{fmt(n('jumlah_hk'))}</span>
                        </div>
                        <div className="sht-wages-item sht-wages-vs">
                            <span>vs</span>
                        </div>
                        <div className="sht-wages-item">
                            <span className="sht-wages-label">Wages HK</span>
                            <span className="sht-wages-value">{wages ? fmt(wages.jumlah_hk_pr_wages) : '-'}</span>
                        </div>
                        <div className={`sht-wages-item ${wagesHkDiff !== 0 ? 'sht-wages-diff' : 'sht-wages-match'}`}>
                            <span className="sht-wages-label">Selisih HK</span>
                            <span className="sht-wages-value">{wagesHkDiff !== null ? (wagesHkDiff > 0 ? '+' : '') + wagesHkDiff : '-'}</span>
                        </div>

                        <div className="sht-wages-separator"></div>

                        <div className="sht-wages-item">
                            <span className="sht-wages-label">Daftar Upah Bersih</span>
                            <span className="sht-wages-value sht-text-green">{fmtCurrency(upahBersih)}</span>
                        </div>
                        <div className="sht-wages-item sht-wages-vs">
                            <span>vs</span>
                        </div>
                        <div className="sht-wages-item">
                            <span className="sht-wages-label">Wages Bersih (PR_WAGES)</span>
                            <span className="sht-wages-value sht-text-green">{wages ? fmtCurrency(wages.upah_bersih_pr_wages) : '-'}</span>
                        </div>
                        <div className={`sht-wages-item ${wagesDiff !== null && Math.abs(wagesDiff) > 1000 ? 'sht-wages-diff' : 'sht-wages-match'}`}>
                            <span className="sht-wages-label">Selisih</span>
                            <span className="sht-wages-value">{wagesDiff !== null ? (wagesDiff > 0 ? '+' : '') + fmtCurrency(wagesDiff) : '-'}</span>
                        </div>

                        <div className="sht-wages-status-panel">
                            <span
                                className="sht-wages-badge-large"
                                style={{ backgroundColor: wagesBadge.bgColor, color: wagesBadge.color }}
                            >
                                {wagesBadge.icon} {wagesBadge.label}
                            </span>
                            {wages.wages_no && (
                                <span className="sht-wages-ref">No: {wages.wages_no}</span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="sht-wages-empty">
                        <span>⚠️ Tidak ada data PR_EMPWAGES untuk periode ini</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// Wages Status Badge Component
function WagesStatusBadge({ status }) {
    const badge = getStatusBadge(status);
    return (
        <span
            className="sht-wages-badge"
            style={{ backgroundColor: badge.bgColor, color: badge.color }}
            title={badge.label}
        >
            {badge.icon}
        </span>
    );
}
