import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import ReportPrintMetadata from '../components/common/ReportPrintMetadata';
import { fetchDivisions, fetchGangs } from '../services/gangService';
import { fetchReportRowsSimple } from '../services/payrollService';
import {
    buildHighEarnerRows,
    normalizeDivisionOptions,
    normalizeGangOptions,
    REPORT_ROWS_FETCH_LIMIT,
} from '../utils/payrollReportFilters';
import { printReport } from '../utils/printPageSetup';
import '../styles/wages-summary-professional.css'; // Reuse existing styles
import '../styles/report-print-foundation.css';

const HighEarnerReportPage = () => {
    const { token } = useAuth();
    const navigate = useNavigate();

    // State
    const [month, setMonth] = useState(new Date().getMonth() + 1);
    const [year, setYear] = useState(new Date().getFullYear());
    const [limit, setLimit] = useState(6000000);
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [meta, setMeta] = useState(null);
    const [initialLoadDone, setInitialLoadDone] = useState(false);

    // Filters
    const [divisions, setDivisions] = useState([]);
    const [gangs, setGangs] = useState([]);
    const [selectedDivision, setSelectedDivision] = useState('ALL');
    const [selectedGang, setSelectedGang] = useState('ALL');

    // Options
    const monthOptions = [
        { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' },
        { value: 3, label: 'Maret' }, { value: 4, label: 'April' },
        { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
        { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' },
        { value: 9, label: 'September' }, { value: 10, label: 'Oktober' },
        { value: 11, label: 'November' }, { value: 12, label: 'Desember' }
    ];


    useEffect(() => {
        let cancelled = false;

        const loadDivisions = async () => {
            if (!token) return;
            try {
                const result = await fetchDivisions(token);
                if (!cancelled) setDivisions(normalizeDivisionOptions(result));
            } catch (err) {
                console.error("Failed to fetch divisions", err);
            }
        };

        loadDivisions();
        return () => {
            cancelled = true;
        };
    }, [token]);

    useEffect(() => {
        let cancelled = false;

        const loadGangs = async () => {
            if (selectedDivision === 'ALL') {
                setGangs([]);
                setSelectedGang('ALL');
                return;
            }

            if (!token) return;

            try {
                const result = await fetchGangs(token, selectedDivision, null, true);
                if (!cancelled) {
                    setGangs(normalizeGangOptions(result));
                    setSelectedGang('ALL');
                }
            } catch (err) {
                console.error("Failed to fetch gangs", err);
            }
        };

        loadGangs();
        return () => {
            cancelled = true;
        };
    }, [selectedDivision, token]);

    const fetchData = useCallback(async () => {
        if (!token) {
            setError('Token autentikasi tidak tersedia');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const result = await fetchReportRowsSimple(token, {
                month,
                year,
                gang_code: selectedGang !== 'ALL' ? selectedGang : null,
                skip: 0,
                limit: REPORT_ROWS_FETCH_LIMIT,
                summary_only: 'true',
            }, true);

            if (Array.isArray(result)) {
                throw new Error('Gagal mengambil data payroll report');
            }

            const report = buildHighEarnerRows(result?.data || [], {
                limit,
                division: selectedDivision,
                gang: selectedGang,
            });
            setData(report.data);
            setMeta({
                ...(result?.meta || {}),
                ...report.meta,
                source_count: result?.data?.length || 0,
            });
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || err.message || 'Gagal mengambil data');
        } finally {
            setLoading(false);
        }
    }, [token, month, year, limit, selectedDivision, selectedGang]);

    useEffect(() => {
        if (!initialLoadDone && token) {
            setInitialLoadDone(true);
            fetchData();
        }
    }, [fetchData, initialLoadDone, token]);

    // Helper: Format Number
    const formatNumber = (num) => {
        if (!num) return '-';
        return new Intl.NumberFormat('id-ID').format(num);
    };

    return (
        <div className="wsp-container high-earner-container">
            {/* Loading Overlay */}
            {loading && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(255,255,255,0.7)',
                    zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column'
                }}>
                    <div className="spinner-border" style={{
                        width: '3rem', height: '3rem',
                        border: '5px solid #e2e8f0', borderTopColor: '#3b82f6',
                        borderRadius: '50%', animation: 'spin 1s linear infinite'
                    }}></div>
                    <div style={{ marginTop: '1rem', fontWeight: 'bold', color: '#1e3a8a' }}>Loading Data...</div>
                    <style>{`
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    `}</style>
                </div>
            )}

            {/* Action Bar */}
            <div className="wsp-action-bar no-print">
                <div className="left-section">
                    <button onClick={() => navigate(-1)} className="wsp-btn">
                        &larr; Kembali
                    </button>

                    <div className="wsp-filter-group" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Period Selectors */}
                        <select
                            value={month}
                            onChange={(e) => setMonth(parseInt(e.target.value))}
                            className="wsp-select"
                            title="Select Month"
                        >
                            {monthOptions.map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                        <select
                            value={year}
                            onChange={(e) => setYear(parseInt(e.target.value))}
                            className="wsp-select"
                            title="Select Year"
                        >
                            {[...Array(5)].map((_, i) => {
                                const y = new Date().getFullYear() - i;
                                return <option key={y} value={y}>{y}</option>;
                            })}
                        </select>

                        {/* Division Selector */}
                        <select
                            value={selectedDivision}
                            onChange={(e) => setSelectedDivision(e.target.value)}
                            className="wsp-select"
                            title="Filter by Division"
                        >
                            <option value="ALL">Semua Divisi</option>
                            {divisions.map(div => (
                                <option key={div.code} value={div.code}>{div.label}</option>
                            ))}
                        </select>

                        {/* Gang Selector (only if division selected) */}
                        {selectedDivision !== 'ALL' && (
                            <select
                                value={selectedGang}
                                onChange={(e) => setSelectedGang(e.target.value)}
                                className="wsp-select"
                                title="Filter by Gang"
                            >
                                <option value="ALL">Semua Gang</option>
                                {gangs.map(g => (
                                    <option key={g.code} value={g.code}>{g.label}</option>
                                ))}
                            </select>
                        )}


                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', borderLeft: '1px solid #ccc', paddingLeft: '8px', marginLeft: '8px' }}>
                            <span style={{ fontSize: '0.85rem' }}>Limit &gt;</span>
                            <input
                                type="number"
                                value={limit}
                                onChange={(e) => setLimit(e.target.value)}
                                className="wsp-select"
                                style={{ width: '120px' }}
                            />
                        </div>

                        <button onClick={fetchData} className="wsp-btn wsp-btn-primary" disabled={loading}>
                            {loading ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                <div className="right-section">
                    <button onClick={() => printReport({ orientation: 'landscape' })} className="wsp-btn">
                        Print / PDF
                    </button>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '0.5rem', marginBottom: '1rem', margin: '1rem' }}>
                    {error}
                </div>
            )}

            {/* Report Content */}
            <div id="high-earner-report" className="wsp-paper a4-landscape">
                <div className="wsp-header">
                    <div className="wsp-title">LAPORAN GAJI TERTINGGI (High Earners)</div>
                    <div className="wsp-subtitle">
                        Periode: {monthOptions[month - 1]?.label} {year}
                        {selectedDivision !== 'ALL' && ` | Divisi: ${selectedDivision}`}
                        {selectedGang !== 'ALL' && ` | Gang: ${selectedGang}`}
                        {' '}| Limit: Rp {formatNumber(limit)}
                    </div>
                    <ReportPrintMetadata
                        mode="High Earners"
                        source="Payroll Report API"
                        scope={selectedDivision === 'ALL' ? 'Semua Divisi' : selectedDivision}
                        items={[
                            { label: 'Gang', value: selectedGang !== 'ALL' ? selectedGang : '' },
                            { label: 'Limit', value: `Rp ${formatNumber(limit)}` }
                        ]}
                        note="Daftar menampilkan karyawan dengan upah bersih di atas limit yang dipilih."
                    />
                    {meta && (
                        <div className="wsp-meta" style={{ fontSize: '0.8rem', color: '#666' }}>
                            Total Karyawan: {meta.count}
                        </div>
                    )}
                </div>

                <div className="wsp-table-wrapper">
                    <table className="wsp-table">
                        <thead>
                            <tr className="wsp-header-master">
                                <th style={{ width: '30px' }}>#</th>
                                <th>Karyawan</th>
                                <th>Divisi</th>
                                <th className="text-right">Gaji Pokok</th>
                                <th className="text-right">Tunjangan</th>
                                <th className="text-right">Lembur</th>
                                <th className="text-right">Premi</th>
                                <th className="text-right">Potongan</th>
                                <th className="text-right">Total Potongan</th>
                                <th className="text-right">Upah Bersih</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((row, idx) => {
                                const isOvertime = row.lembur_jumlah > 0;
                                return (
                                    <tr key={idx}>
                                        <td>{row.rank}</td>
                                        <td>
                                            <div style={{ fontWeight: 'bold' }}>{row.nama}</div>
                                            <div style={{ fontSize: '0.75rem', color: '#555' }}>
                                                {row.new_nik || row.nik} | {row.jabatan_estate || '-'}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="div-code">{row.gang_code}</div>
                                            <div style={{ fontSize: '0.7rem' }}>{row.loc_code}</div>
                                        </td>
                                        <td className="text-right">{formatNumber(row.gaji_pokok)}</td>
                                        <td className="text-right">
                                            {formatNumber(row.total_tunjangan)}
                                            {/* Details on hover/small */}
                                            <div style={{ fontSize: '0.7rem', color: '#666' }}>
                                                {row.jabatan_jumlah > 0 && `Jab: ${formatNumber(row.jabatan_jumlah)} `}
                                                {row.beras_jumlah > 0 && `Ber: ${formatNumber(row.beras_jumlah)}`}
                                            </div>
                                        </td>
                                        <td className="text-right">
                                            {isOvertime ? (
                                                <span style={{
                                                    backgroundColor: '#fee2e2', color: '#991b1b',
                                                    padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold'
                                                }}>
                                                    {formatNumber(row.lembur_jumlah)}
                                                </span>
                                            ) : '-'}
                                            {row.lembur_jam > 0 && (
                                                <div style={{ fontSize: '0.7rem' }}>({row.lembur_jam} hrs)</div>
                                            )}
                                        </td>
                                        <td className="text-right">
                                            {formatNumber(row.total_premi)}
                                            {/* Top Premi breakdown */}
                                            <div style={{ fontSize: '0.65rem', color: '#666', maxWidth: '150px', marginLeft: 'auto' }}>
                                                {Object.entries(row.premi || {})
                                                    .filter(([_, val]) => val > 0)
                                                    .sort((a, b) => b[1] - a[1]) // Sort desc
                                                    .slice(0, 3) // Top 3 only
                                                    .map(([k, v]) => (
                                                        <div key={k}>{k.replace('PREMI_', '')}: {formatNumber(v)}</div>
                                                    ))
                                                }
                                            </div>
                                        </td>
                                        <td className="text-right" style={{ fontSize: '0.7rem' }}>
                                            <div>SPSI: {formatNumber(row.pot_spsi)}</div>
                                            <div>PPH21: {formatNumber(row.pot_pph21)}</div>
                                            <div>BPJS: {formatNumber(row.pot_bpjs_pekerja_total)}</div>
                                        </td>
                                        <td className="text-right">{formatNumber(row.total_potongan_bersih)}</td>
                                        <td className="text-right font-bold" style={{ fontSize: '1.1em' }}>
                                            {formatNumber(row.upah_bersih)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {data.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="10" className="text-center" style={{ padding: '2rem', fontStyle: 'italic', color: '#666' }}>
                                        Tidak ada data yang ditemukan.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default HighEarnerReportPage;
