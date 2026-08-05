import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import summaryReportService from '../services/summaryReportService';
import MonthSelector from '../components/common/MonthSelector';
import ReportToolbar from '../components/common/ReportToolbar';
import LoadingScreen from '../components/common/LoadingScreen';

const DetailedSalaryAnalysisPage = ({ onBack, initialMonth, initialYear, initialDivision }) => {
    const { token } = useAuth();
    const [month, setMonth] = useState(initialMonth || new Date().getMonth() + 1);
    const [year, setYear] = useState(initialYear || new Date().getFullYear());

    const [divisions, setDivisions] = useState([]);
    const [division, setDivision] = useState(initialDivision || '');

    // Sync state with props when they change (fix navigation freeze)
    useEffect(() => {
        if (initialMonth !== undefined) setMonth(initialMonth);
        if (initialYear !== undefined) setYear(initialYear);
        if (initialDivision !== undefined) setDivision(initialDivision);
    }, [initialMonth, initialYear, initialDivision]);
    const [gangs, setGangs] = useState([]);
    const [gang, setGang] = useState('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);

    // Fetch Divisions
    useEffect(() => {
        const fetchDiv = async () => {
            try {
                const res = await summaryReportService.fetchDivisionsWithData(token);
                if (res.success) {
                    setDivisions(res.divisions);
                    if (!division && res.divisions.length > 0) {
                        setDivision(res.divisions[0].loc_code);
                    }
                }
            } catch (err) {
                console.error(err);
            }
        };
        if (token) fetchDiv();
    }, [token]);

    // Fetch Gangs when Division changes
    useEffect(() => {
        const fetchGangs = async () => {
            if (!division || division === 'ALL') return;
            try {
                const res = await summaryReportService.fetchGangsByLocCode(token, division);
                if (res.success) {
                    setGangs(res.gangs);
                    if (res.gangs.length > 0) {
                        setGang(res.gangs[0].gang_code);
                    } else {
                        setGang('');
                    }
                }
            } catch (err) {
                console.error(err);
            }
        };
        if (token && division) fetchGangs();
    }, [token, division]);

    const handleFetchData = async () => {
        if (!gang) {
            setError("Silakan pilih Gang terlebih dahulu");
            return;
        }

        setLoading(true);
        setError(null);
        setData(null);

        try {
            const res = await summaryReportService.fetchGangAnalysisDetail(token, {
                gang_code: gang,
                month,
                year
            });

            if (res.success) {
                setData(res);
            } else {
                setError(res.error || "Gagal memuat data detail gang");
            }
        } catch (err) {
            setError(err.message || "Terjadi kesalahan saat memuat data");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (value) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value || 0);
    };

    const formatSignedDeductionCurrency = (value) => {
        // Guardrail: render one explicit minus from ABS magnitude. Never concatenate
        // '-' with raw values because negative raw values become confusing --200 output.
        const amount = Math.abs(Number(value) || 0);
        return amount === 0 ? formatCurrency(0) : `-${formatCurrency(amount)}`;
    };

    const formatNumber = (value) => {
        return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value || 0);
    };

    const renderSummaryCard = (title, value, subtitle, highlight = false) => (
        <div style={{
            padding: '1.25rem',
            backgroundColor: highlight ? '#eff6ff' : '#ffffff',
            border: `1px solid ${highlight ? '#bfdbfe' : '#e2e8f0'}`,
            borderRadius: '0.5rem',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
        }}>
            <span style={{ fontSize: '0.875rem', color: highlight ? '#1d4ed8' : '#64748b', fontWeight: '500' }}>{title}</span>
            <span style={{ fontSize: '1.5rem', fontWeight: '700', color: highlight ? '#1e3a8a' : '#1e293b' }}>
                {title.toLowerCase().includes('hk') ? formatNumber(value) : formatCurrency(value)}
            </span>
            {subtitle && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{subtitle}</span>}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#f8fafc' }}>
            <div className="no-print">
                <ReportToolbar
                    title="Analisis Upah Bersih & Lembur"
                    onBack={onBack}
                    actions={
                        <>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <select
                                    value={division}
                                    onChange={e => setDivision(e.target.value)}
                                    style={{
                                        padding: '0.375rem 2rem 0.375rem 0.75rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #d1d5db',
                                        fontSize: '0.875rem'
                                    }}
                                >
                                    <option value="" disabled>Pilih Divisi</option>
                                    {divisions.map(d => (
                                        <option key={d.loc_code} value={d.loc_code}>{d.loc_code} - {d.description}</option>
                                    ))}
                                </select>
                                <select
                                    value={gang}
                                    onChange={e => setGang(e.target.value)}
                                    disabled={!division || gangs.length === 0}
                                    style={{
                                        padding: '0.375rem 2rem 0.375rem 0.75rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #d1d5db',
                                        fontSize: '0.875rem',
                                        backgroundColor: (!division || gangs.length === 0) ? '#f3f4f6' : 'white'
                                    }}
                                >
                                    <option value="" disabled>Pilih Gang</option>
                                    {gangs.map(g => (
                                        <option key={g.gang_code} value={g.gang_code}>{g.gang_code} - {g.description}</option>
                                    ))}
                                </select>
                                <MonthSelector
                                    selectedMonth={month}
                                    selectedYear={year}
                                    onChange={(m, y) => { setMonth(m); setYear(y); }}
                                />
                                <button
                                    onClick={handleFetchData}
                                    disabled={loading || !gang}
                                    style={{
                                        padding: '0.375rem 1rem',
                                        backgroundColor: '#3b82f6',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.375rem',
                                        fontWeight: '500',
                                        cursor: (loading || !gang) ? 'not-allowed' : 'pointer',
                                        opacity: (loading || !gang) ? 0.7 : 1
                                    }}
                                >
                                    {loading ? 'Memuat...' : 'Tampilkan Analisis'}
                                </button>
                            </div>
                        </>
                    }
                />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
                {loading && <LoadingScreen isLoading={true} message="Menganalisis data gang..." />}

                {error && (
                    <div style={{ padding: '1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#b91c1c', marginBottom: '1rem' }}>
                        {error}
                    </div>
                )}

                {!loading && !error && !data && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#64748b' }}>
                        Pilih divisi, gang, dan periode lalu klik "Tampilkan Analisis"
                    </div>
                )}

                {!loading && data && data.summary_breakdown && (
                    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                        {/* Header Info */}
                        <div>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0f172a', marginBottom: '0.25rem' }}>
                                Analisis Gang: {data.gang_code} - {data.summary_breakdown.gang_description}
                            </h2>
                            <p style={{ color: '#64748b' }}>Periode: {month}-{year} | Jumlah Pekerja: {data.summary_breakdown.total_employees}</p>
                        </div>

                        {/* Summary Metrics */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                            {renderSummaryCard('Total Upah Bersih', parseFloat(data.summary_breakdown.total_upah_bersih), 'Setelah potongan', true)}
                            {renderSummaryCard('Total HK', parseFloat(data.summary_breakdown.total_hk), 'Hari Kerja')}
                            {renderSummaryCard('Gaji Pokok', parseFloat(data.summary_breakdown.total_gaji_pokok), 'Sebelum tunjangan/premi')}
                            {renderSummaryCard('Total Premi', parseFloat(data.summary_breakdown.total_premi), 'Insentif & Kinerja')}
                            {renderSummaryCard('Total Lembur', parseFloat(data.summary_breakdown.total_lembur), 'Total bayaran overtime', parseFloat(data.summary_breakdown.total_lembur) > 0)}
                            {renderSummaryCard('Total Potongan', parseFloat(data.summary_breakdown.total_potongan), 'BPJS, Pajak, SPSI, dll')}
                        </div>

                        {/* detailed upah breakdown grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                            {/* Rincian Upah */}
                            <div style={{ backgroundColor: '#ffffff', borderRadius: '0.5rem', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)' }}>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1e293b', marginBottom: '1rem', borderBottom: '2px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                                    Rincian Komponen Upah Kotor
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Gaji Pokok</span><span style={{ fontWeight: '500' }}>{formatCurrency(data.summary_breakdown.total_gaji_pokok)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tunjungan Beras</span><span style={{ fontWeight: '500' }}>{formatCurrency(data.summary_breakdown.total_beras)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tunjungan Jabatan</span><span style={{ fontWeight: '500' }}>{formatCurrency(data.summary_breakdown.total_jabatan)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Masa Kerja</span><span style={{ fontWeight: '500' }}>{formatCurrency(data.summary_breakdown.total_masa_kerja)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Lembur</span><span style={{ fontWeight: '500', color: '#b45309' }}>{formatCurrency(data.summary_breakdown.total_lembur)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total Premi</span><span style={{ fontWeight: '500', color: '#15803d' }}>{formatCurrency(data.summary_breakdown.total_premi)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: '0.75rem', fontWeight: 'bold' }}><span>Total Upah Kotor</span><span>{formatCurrency(data.summary_breakdown.total_upah_kotor)}</span></div>
                                </div>
                            </div>

                            {/* Rincian Potongan */}
                            <div style={{ backgroundColor: '#ffffff', borderRadius: '0.5rem', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)' }}>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1e293b', marginBottom: '1rem', borderBottom: '2px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                                    Rincian Potongan
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>BPJS Kesehatan (Pekerja)</span><span style={{ fontWeight: '500', color: '#b91c1c' }}>{formatCurrency(data.summary_breakdown.total_bpjs_pekerja)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>PPh21</span><span style={{ fontWeight: '500', color: '#b91c1c' }}>{formatCurrency(data.summary_breakdown.total_pph21)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>SPSI</span><span style={{ fontWeight: '500', color: '#b91c1c' }}>{formatCurrency(data.summary_breakdown.total_spsi)}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: '0.75rem', fontWeight: 'bold' }}><span>Total Potongan</span><span style={{ color: '#b91c1c' }}>{formatSignedDeductionCurrency(data.summary_breakdown.total_potongan)}</span></div>
                                </div>
                            </div>
                        </div>

                        {/* Detail Lembur Analysis */}
                        <div style={{ backgroundColor: '#ffffff', borderRadius: '0.5rem', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '2px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1e293b' }}>
                                    Analisis Jenis Task Lembur Tertinggi
                                </h3>
                                <span style={{ backgroundColor: '#fff7ed', color: '#c2410c', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.875rem', fontWeight: '500' }}>
                                    Total Records: {data.lembur_analysis.total_records} Karyawan Lembur
                                </span>
                            </div>

                            {data.lembur_analysis.tasks && data.lembur_analysis.tasks.length > 0 ? (
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                            <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#475569' }}>Task Code</th>
                                            <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#475569' }}>Task Description</th>
                                            <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#475569', textAlign: 'right' }}>Total Hours</th>
                                            <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#475569', textAlign: 'right' }}>Total Amount (Rp)</th>
                                            <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#475569', textAlign: 'right' }}>% dari Total Lembur</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.lembur_analysis.tasks.map((task, idx) => {
                                            const totalAmount = parseFloat(data.summary_breakdown.total_lembur);
                                            const percentage = totalAmount > 0 ? ((task.total_amount / totalAmount) * 100).toFixed(1) : 0;
                                            return (
                                                <tr key={task.task_code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '0.75rem 1rem', color: '#334155', fontWeight: '500' }}>{task.task_code}</td>
                                                    <td style={{ padding: '0.75rem 1rem', color: '#334155' }}>{task.task_desc}</td>
                                                    <td style={{ padding: '0.75rem 1rem', color: '#0f172a', textAlign: 'right', fontWeight: '500' }}>{formatNumber(task.total_hours)}</td>
                                                    <td style={{ padding: '0.75rem 1rem', color: '#b45309', textAlign: 'right', fontWeight: '600' }}>{formatCurrency(task.total_amount)}</td>
                                                    <td style={{ padding: '0.75rem 1rem', color: '#64748b', textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                                            <span>{percentage}%</span>
                                                            <div style={{ width: '50px', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                                                <div style={{ width: `${percentage}%`, height: '100%', backgroundColor: '#f59e0b' }}></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>
                                            <td colSpan="2" style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>TOTAL KESELURUHAN</td>
                                            <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                                                {formatNumber(data.lembur_analysis.tasks.reduce((sum, task) => sum + task.total_hours, 0))}
                                            </td>
                                            <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#b45309' }}>
                                                {formatCurrency(data.lembur_analysis.tasks.reduce((sum, task) => sum + task.total_amount, 0))}
                                            </td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            ) : (
                                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                                    Tidak ada data lembur untuk gang ini pada periode yang dipilih.
                                </div>
                            )}
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};

export default DetailedSalaryAnalysisPage;
