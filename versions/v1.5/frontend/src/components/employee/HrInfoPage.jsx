import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { getEmployeeCheckroll, getEmployeeHistoricalData } from '../../services/employeeDetailService'
import LoadingScreen from '../common/LoadingScreen'
import './EmployeeDetailPage.css'

export default function HrInfoPage({
    employeeData,
    month,
    year,
    division,
    onBack
}) {
    const { token } = useAuth()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [checkrollData, setCheckrollData] = useState(null)

    // Historical data (from seeded extend_db_ptrj ONLY)
    const [careerHistory, setCareerHistory] = useState([])
    const [payrollHistory, setPayrollHistory] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)

    // UI state
    const [activeTab, setActiveTab] = useState('profil')

    // NIK Edit state
    const [historyModalNik, setHistoryModalNik] = useState({ isOpen: false, data: null, loading: false })

    const empCode = employeeData?.nik || employeeData?.NIK || ''
    const backendUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8002`;

    const handleEditNik = async (empInfo) => {
        const currentNik = empInfo.actual_nik || empInfo.nik || empCode;
        const newNik = window.prompt("Ubah NIK untuk " + (empInfo.nama || empCode) + ".\n\nMasukkan NIK baru (KTP) atau kosongkan jika ingin kembali ke data awal (Plantware):", currentNik);

        if (newNik === null) return; // cancelled

        try {
            const res = await fetch(`${backendUrl}/employee-hr-data/${empCode}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ field: 'nik_ktp', value: newNik.trim() })
            });
            const json = await res.json();
            if (json.success) {
                alert("NIK berhasil diperbarui!");
                window.location.reload(); // Refresh to catch new actual_nik
            } else {
                alert("Gagal menyimpan NIK: " + json.error);
            }
        } catch (e) {
            alert("Error: " + e.message);
        }
    };

    const openNikHistory = async () => {
        setHistoryModalNik({ isOpen: true, data: null, loading: true });
        try {
            const res = await fetch(`${backendUrl}/employee-hr-data/${empCode}/history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            if (json.success) {
                setHistoryModalNik({ isOpen: true, data: json.data || [], loading: false });
            } else {
                throw new Error(json.error);
            }
        } catch (e) {
            alert("Gagal memuat history NIK: " + e.message);
            setHistoryModalNik(prev => ({ ...prev, loading: false }));
        }
    };

    const handleRollbackNik = async () => {
        if (!window.confirm("Yakin ingin MENGHAPUS versi terbaru ini dan ROLLBACK NIK ke versi sebelumnya?")) return;
        try {
            const res = await fetch(`${backendUrl}/employee-hr-data/${empCode}/rollback`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const json = await res.json();
            if (json.success) {
                alert("Berhasil di-rollback!");
                window.location.reload();
            } else {
                alert("Gagal rollback: " + json.error);
            }
        } catch (e) {
            alert("Error: " + e.message);
        }
    };

    useEffect(() => {
        async function loadData() {
            if (!token || !empCode) {
                setError('Token atau NIK tidak tersedia')
                setLoading(false)
                return
            }

            setLoading(true)
            setError('')

            try {
                const data = await getEmployeeCheckroll(token, empCode, month, year, division);
                setCheckrollData(data)
            } catch (e) {
                console.error('Failed to load checkroll data:', e)
                // Show specific error message from backend (e.g., kerani division restriction)
                const backendError = e?.response?.data?.error || e?.message || String(e);
                setError('Gagal memuat data profil: ' + backendError)
            } finally {
                setLoading(false)
            }
        }
        loadData()
    }, [token, empCode, month, year, division])

    // Lazy load history when user switches tab
    useEffect(() => {
        if ((activeTab === 'karir' || activeTab === 'gaji' || activeTab === 'beras' || activeTab === 'analisis') && payrollHistory.length === 0 && careerHistory.length === 0 && !historyLoading) {
            loadHistoryData()
        }
    }, [activeTab])

    async function loadHistoryData() {
        setHistoryLoading(true)
        try {
            // ALL historical data comes EXCLUSIVELY from extend_db_ptrj (seeded history database)
            const historical = await getEmployeeHistoricalData(token, empCode);
            const data = historical || { career: [], payroll: [] };
            setCareerHistory(data.career || [])
            setPayrollHistory(data.payroll || [])
            console.log(`[HrInfoPage] Seeded data loaded: ${(data.career || []).length} career, ${(data.payroll || []).length} payroll records`);
        } catch (e) {
            console.error("[HrInfoPage] Failed to load seeded history:", e);
        } finally {
            setHistoryLoading(false)
        }
    }

    if (loading) {
        return <LoadingScreen isLoading={true} message="Memuat Profil HR Managerial..." />
    }

    if (error) {
        return (
            <div className="payslip-wrapper" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                    <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>❌</div>
                    <h2 style={{ color: '#1e293b', marginBottom: '1rem' }}>Gagal Memuat Data</h2>
                    <p style={{ color: '#64748b', marginBottom: '2rem' }}>{error}</p>
                    <button onClick={onBack} style={{ padding: '10px 24px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>Kembali</button>
                </div>
            </div>
        )
    }

    const empInfo = checkrollData?.employee || employeeData || {}

    const renderTenure = () => {
        if (!empInfo.join_date) return '-';
        try {
            const joinDate = new Date(empInfo.join_date);
            const now = new Date();
            let years = now.getFullYear() - joinDate.getFullYear();
            let months = now.getMonth() - joinDate.getMonth();
            if (months < 0) { years--; months += 12; }
            return `${years} tahun ${months} bulan`;
        } catch { return '-'; }
    }

    const fmt = (v) => {
        const n = parseFloat(v);
        if (isNaN(n)) return '-';
        return new Intl.NumberFormat('id-ID').format(n);
    }
    const n = (v) => parseFloat(v) || 0;
    const getMonthName = (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1] || m;

    // Styles (More Corporate/Elegant)
    const card = {
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '2rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
        marginBottom: '2rem'
    };
    const th = (bg = '#f8fafc', color = '#475569', border = '#e2e8f0') => ({
        padding: '0.75rem 1rem',
        borderBottom: `2px solid ${border}`,
        backgroundColor: bg,
        color,
        fontSize: '0.8rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        textAlign: 'center',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
    });
    const td = (align = 'left') => ({
        padding: '0.75rem 1rem',
        fontSize: '0.85rem',
        textAlign: align,
        borderBottom: '1px solid #f1f5f9',
        whiteSpace: 'nowrap'
    });

    const tabs = [
        { id: 'profil', label: '👤 Profil' },
        { id: 'karir', label: '📊 Karir & Mutasi' },
        { id: 'jabatan', label: '💼 Tunjangan Jabatan' },
        { id: 'beras', label: '🍚 Tunjangan Beras' },
        { id: 'gaji', label: '💰 Riwayat Gaji' },
        { id: 'analisis', label: '📋 Analisis Lengkap' },
    ];

    return (
        <div style={{ padding: '2rem 3rem', maxWidth: '1600px', margin: '0 auto', fontFamily: '"Inter", system-ui, -apple-system, sans-serif' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ margin: 0, color: '#0f172a', fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.025em' }}>Managerial HR Profile</h1>
                    <p style={{ margin: '0.5rem 0 0', color: '#64748b', fontSize: '1rem' }}>Sistem Informasi Karyawan Enterprise</p>
                </div>
                <button onClick={onBack} style={{
                    padding: '10px 20px',
                    backgroundColor: 'white',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    transition: 'all 0.2s ease'
                }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                    ← Kembali ke Direktori
                </button>
            </div>

            {/* ID Banner - Corporate Profile Style */}
            <div style={{
                ...card,
                display: 'flex',
                alignItems: 'center',
                gap: '2rem',
                padding: '2rem',
                background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                borderLeft: '4px solid #0f172a'
            }}>
                <div style={{
                    width: '80px', height: '80px',
                    borderRadius: '16px',
                    backgroundColor: '#e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '2rem', color: '#334155', fontWeight: 'bold', flexShrink: 0,
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)'
                }}>
                    {(empInfo.nama || 'NN').substring(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                    <h2 style={{ margin: 0, color: '#0f172a', fontSize: '1.5rem', fontWeight: 800 }}>{empInfo.nama || '-'}</h2>
                    <div style={{ display: 'flex', gap: '2rem', color: '#475569', fontSize: '0.95rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ color: '#94a3b8' }}>ID:</span> <strong style={{ color: '#0f172a' }}>{empInfo.nik || empCode}</strong></span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#94a3b8' }}>NIK:</span>
                            <strong style={{ color: '#0f172a' }}>{empInfo.actual_nik || '-'}</strong>
                            <button onClick={() => handleEditNik(empInfo)} style={{ background: 'none', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', backgroundColor: 'white' }} title="Edit NIK">✏️ Edit</button>
                            <button onClick={openNikHistory} style={{ background: 'none', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '10px', padding: '2px 4px', borderRadius: '4px', backgroundColor: 'white' }} title="Riwayat Versi NIK">⏱️ Riwayat</button>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ color: '#94a3b8' }}>Divisi:</span> <strong style={{ color: '#0f172a' }}>{empInfo.loc_code || division || '-'}</strong></span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ color: '#94a3b8' }}>Gang:</span> <strong style={{ color: '#0f172a' }}>{empInfo.gang_code || '-'}</strong></span>
                        <span style={{
                            padding: '4px 12px',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            backgroundColor: empInfo.status === '1' ? '#dcfce7' : '#fee2e2',
                            color: empInfo.status === '1' ? '#166534' : '#991b1b',
                            borderRadius: '9999px'
                        }}>
                            {empInfo.status === '1' ? 'AKTIF' : 'NON-AKTIF'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Tab Navigation - Pill Style */}
            <div style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '2rem',
                overflowX: 'auto',
                padding: '0.5rem',
                backgroundColor: '#f1f5f9',
                borderRadius: '12px',
                border: '1px solid #e2e8f0'
            }}>
                {tabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                        padding: '12px 24px',
                        border: 'none',
                        borderRadius: '8px',
                        backgroundColor: activeTab === tab.id ? '#ffffff' : 'transparent',
                        color: activeTab === tab.id ? '#0f172a' : '#64748b',
                        cursor: 'pointer',
                        fontWeight: activeTab === tab.id ? 700 : 600,
                        fontSize: '0.95rem',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                        boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                    }}>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ==================== TAB: PROFIL ==================== */}
            {activeTab === 'profil' && (
                <div style={card}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
                        <div>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#0369a1', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #bae6fd', paddingBottom: '0.25rem', display: 'inline-block' }}>🏢 Penempatan & Kepegawaian</h3>
                            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.88rem' }}>
                                {[
                                    ['Divisi / Lokasi', empInfo.loc_code || division || '-'],
                                    ['Gang', `${empInfo.gang_code || '-'} ${empInfo.gang_description ? `— ${empInfo.gang_description}` : ''}`],
                                    ['Status', empInfo.status === '1' ? 'Aktif' : empInfo.status === '0' ? 'Non-Aktif' : (empInfo.status || '-')],
                                    ['Tipe Karyawan', empInfo.employee_type || '-'],
                                    ['Tanggal Bergabung', empInfo.join_date ? new Date(empInfo.join_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'],
                                    ['Masa Kerja', renderTenure()],
                                    ['Upah Dasar', `Rp ${fmt(empInfo.upah_dasar)}`],
                                    ['Status PTKP', empInfo.status_ptkp || '-'],
                                    ['Kategori TER', empInfo.kategori_ter || '-'],
                                ].map(([label, value], i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '0.2rem' }}>
                                        <span style={{ color: '#64748b' }}>{label}</span>
                                        <span style={{ fontWeight: 500, color: '#1e293b', textAlign: 'right' }}>{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#b45309', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #fde68a', paddingBottom: '0.25rem', display: 'inline-block' }}>👤 Data Demografis</h3>
                            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.88rem' }}>
                                {[
                                    ['Jenis Kelamin', empInfo.jenis_kelamin === 'P' ? 'Perempuan' : empInfo.jenis_kelamin === 'L' ? 'Laki-laki' : '-'],
                                    ['Tempat Lahir', empInfo.birth_place || '-'],
                                    ['Tanggal Lahir', empInfo.birth_date ? new Date(empInfo.birth_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'],
                                    ['Agama', empInfo.religion || '-'],
                                    ['Status Pernikahan', empInfo.marital_status || '-'],
                                ].map(([label, value], i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '0.2rem' }}>
                                        <span style={{ color: '#64748b' }}>{label}</span>
                                        <span style={{ fontWeight: 500 }}>{value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ==================== TAB: KARIR ==================== */}
            {activeTab === 'karir' && (
                <div style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem', fontWeight: 700 }}>📊 Riwayat Karir & Mutasi Divisi</h3>
                        <span style={{ fontSize: '0.75rem', padding: '4px 12px', backgroundColor: '#f1f5f9', color: '#475569', borderRadius: 'full', fontWeight: 600, border: '1px solid #e2e8f0' }}>Seeded History DB</span>
                    </div>
                    {historyLoading ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                            <div className="spinner" style={{ border: '3px solid #e2e8f0', borderTopColor: '#0f172a', borderRadius: '50%', width: '32px', height: '32px', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                            Memuat riwayat karir...
                        </div>
                    ) : careerHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>Belum ada data karir historis.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {['Periode', 'EmpCode', 'Nama', 'Divisi', 'Lokasi', 'Gang', 'Tipe', 'Status', 'Upah Dasar'].map(h => (
                                            <th key={h} style={th('#f8fafc', '#475569', '#e2e8f0')}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {careerHistory.map((c, i) => (
                                        <tr key={i} style={{ backgroundColor: 'white', transition: 'background-color 0.15s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'white' }}>
                                            <td style={{ ...td(), fontWeight: 700, color: '#0f172a' }}>{getMonthName(c.period_month)} {c.period_year}</td>
                                            <td style={td()}>{c.emp_code || '-'}</td>
                                            <td style={td()}>{c.emp_name || '-'}</td>
                                            <td style={td()}>{c.division_code || '-'}</td>
                                            <td style={td()}>{c.loc_code || '-'}</td>
                                            <td style={td()}>{c.gang_code || '-'}</td>
                                            <td style={td()}>{c.employee_type || '-'}</td>
                                            <td style={td()}>
                                                <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: c.status === '1' ? '#dcfce7' : '#f1f5f9', color: c.status === '1' ? '#166534' : '#475569' }}>
                                                    {c.status || '-'}
                                                </span>
                                            </td>
                                            <td style={{ ...td('right'), fontWeight: 600, color: '#0f172a' }}>Rp {fmt(c.upah_dasar)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ==================== TAB: JABATAN ==================== */}
            {activeTab === 'jabatan' && (
                <div style={card}>
                    <h3 style={{ margin: '0 0 1.5rem 0', color: '#0f172a', fontSize: '1.25rem', fontWeight: 700 }}>💼 Riwayat Tunjangan Jabatan</h3>
                    {historyLoading ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                            <div className="spinner" style={{ border: '3px solid #e2e8f0', borderTopColor: '#0f172a', borderRadius: '50%', width: '32px', height: '32px', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                            Memuat riwayat tunjangan jabatan...
                        </div>
                    ) : payrollHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>Belum ada data tunjangan jabatan.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={th('#f8fafc', '#475569', '#e2e8f0')}>Periode</th>
                                        <th style={th('#f8fafc', '#475569', '#e2e8f0')}>EmpCode</th>
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), textAlign: 'right' }}>Jumlah Tunjangan Jabatan</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payrollHistory.map((p, i) => (
                                        <tr key={i} style={{ backgroundColor: 'white', transition: 'background-color 0.15s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'white' }}>
                                            <td style={{ ...td(), fontWeight: 700, color: '#0f172a' }}>{p.period_label || `${getMonthName(n(p.period_month))} ${p.period_year}`}</td>
                                            <td style={td()}>{(p.nik || p.emp_code || '-').toString().trim()}</td>
                                            <td style={{ ...td('right'), fontWeight: 700, color: '#0ea5e9', fontSize: '0.95rem' }}>Rp {fmt(p.jabatan_jumlah || 0)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ==================== TAB: BERAS ==================== */}
            {activeTab === 'beras' && (
                <div style={card}>
                    <h3 style={{ margin: '0 0 1.5rem 0', color: '#0f172a', fontSize: '1.25rem', fontWeight: 700 }}>🍚 Riwayat Tunjangan Beras</h3>
                    {historyLoading ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                            <div className="spinner" style={{ border: '3px solid #e2e8f0', borderTopColor: '#0f172a', borderRadius: '50%', width: '32px', height: '32px', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                            Memuat riwayat beras...
                        </div>
                    ) : payrollHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>Belum ada data tunjangan beras.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={th('#f8fafc', '#475569', '#e2e8f0')}>Periode</th>
                                        <th style={th('#f8fafc', '#475569', '#e2e8f0')}>EmpCode</th>
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), textAlign: 'right' }}>Rate Beras</th>
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), textAlign: 'right' }}>Jumlah Tunjangan</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payrollHistory.map((p, i) => (
                                        <tr key={i} style={{ backgroundColor: 'white', transition: 'background-color 0.15s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'white' }}>
                                            <td style={{ ...td(), fontWeight: 700, color: '#0f172a' }}>{p.period_label || `${getMonthName(n(p.period_month))} ${p.period_year}`}</td>
                                            <td style={td()}>{(p.nik || p.emp_code || '-').toString().trim()}</td>
                                            <td style={{ ...td('right'), color: '#64748b' }}>Rp {fmt(p.beras_rate)}</td>
                                            <td style={{ ...td('right'), fontWeight: 700, color: '#f59e0b', fontSize: '0.95rem' }}>Rp {fmt(p.beras_jumlah)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ==================== TAB: GAJI ==================== */}
            {activeTab === 'gaji' && (
                <div style={card}>
                    <h3 style={{ margin: '0 0 1.5rem 0', color: '#0f172a', fontSize: '1.25rem', fontWeight: 700 }}>💰 Riwayat Penggajian (Simple View)</h3>
                    {historyLoading ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                            <div className="spinner" style={{ border: '3px solid #e2e8f0', borderTopColor: '#0f172a', borderRadius: '50%', width: '32px', height: '32px', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                            Memuat riwayat penggajian...
                        </div>
                    ) : payrollHistory.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>Belum ada data penggajian.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        {['Periode', 'EmpCode', 'HK', 'Gaji Pokok', 'Total Tunjangan', 'Total Premi', 'Upah Kotor', 'Total Potongan', 'PPH21', 'Upah Bersih'].map(h => (
                                            <th key={h} style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), textAlign: h === 'Periode' || h === 'EmpCode' ? 'left' : 'right' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {payrollHistory.map((p, i) => (
                                        <tr key={i} style={{ backgroundColor: 'white', transition: 'background-color 0.15s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'white' }}>
                                            <td style={{ ...td(), fontWeight: 700, color: '#0f172a' }}>{p.period_label || `${getMonthName(n(p.period_month))} ${p.period_year}`}</td>
                                            <td style={{ ...td(), color: '#64748b', fontSize: '0.75rem' }}>{(p.nik || p.emp_code || '-').toString().trim()}</td>
                                            <td style={{ ...td('right') }}>{n(p.jumlah_hk || p.hari_kerja)}</td>
                                            <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.gaji_pokok_aktual || p.gaji_pokok)}</td>
                                            <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.total_tunjangan)}</td>
                                            <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.total_premi)}</td>
                                            <td style={{ ...td('right'), fontWeight: 700, color: '#0f172a' }}>Rp {fmt(p.jumlah_upah_kotor)}</td>
                                            <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.total_potongan || p.total_potongan_bersih)}</td>
                                            <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pph21_ter || p.pot_pph21)}</td>
                                            <td style={{ ...td('right'), fontWeight: 800, color: '#10b981', fontSize: '0.95rem' }}>Rp {fmt(p.upah_bersih)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ==================== TAB: ANALISIS LENGKAP ==================== */}
            {activeTab === 'analisis' && (
                <div>
                    <h3 style={{ margin: '0 0 1.5rem 0', color: '#0f172a', fontSize: '1.25rem', fontWeight: 700 }}>📋 Analisis Daftar Upah Lengkap — Semua Komponen</h3>
                    {historyLoading ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                            <div className="spinner" style={{ border: '3px solid #e2e8f0', borderTopColor: '#0f172a', borderRadius: '50%', width: '32px', height: '32px', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }}></div>
                            Memuat analisis lengkap...
                        </div>
                    ) : payrollHistory.length === 0 ? (
                        <div style={{ ...card, textAlign: 'center', padding: '3rem', color: '#94a3b8', background: '#f8fafc' }}>Belum ada data.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', backgroundColor: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '2000px' }}>
                                <thead>
                                    {/* Row 1: Group headers */}
                                    <tr>
                                        <th rowSpan={2} style={{ ...th('#f8fafc', '#0f172a', '#e2e8f0'), position: 'sticky', left: 0, zIndex: 2, backgroundColor: '#f8fafc', borderRight: '2px solid #e2e8f0' }}>Periode</th>
                                        <th rowSpan={2} style={{ ...th('#f8fafc', '#0f172a', '#e2e8f0'), borderRight: '2px solid #e2e8f0' }}>EmpCode</th>
                                        <th colSpan={4} style={{ ...th('#f1f5f9', '#334155', '#e2e8f0'), borderRight: '2px solid #e2e8f0' }}>PENGGAJIAN</th>
                                        <th colSpan={5} style={{ ...th('#f8fafc', '#334155', '#e2e8f0'), borderRight: '2px solid #e2e8f0' }}>TUNJANGAN</th>
                                        <th colSpan={3} style={{ ...th('#f1f5f9', '#334155', '#e2e8f0'), borderRight: '2px solid #e2e8f0' }}>PREMI</th>
                                        <th rowSpan={2} style={{ ...th('#f8fafc', '#0f172a', '#cbd5e1'), textAlign: 'right', borderRight: '2px solid #cbd5e1' }}>UPAH KOTOR</th>
                                        <th colSpan={7} style={{ ...th('#f1f5f9', '#334155', '#e2e8f0'), borderRight: '2px solid #e2e8f0' }}>POTONGAN</th>
                                        <th rowSpan={2} style={{ ...th('#f8fafc', '#ef4444', '#cbd5e1'), textAlign: 'right', borderRight: '2px solid #cbd5e1' }}>TOT. POT</th>
                                        <th colSpan={3} style={{ ...th('#f1f5f9', '#334155', '#e2e8f0') }}>PAJAK & HASIL</th>
                                    </tr>
                                    {/* Row 2: Sub headers */}
                                    <tr>
                                        {/* PENGGAJIAN */}
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem' }}>HK</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Upah Dasar</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Gaji Pokok</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right', borderRight: '2px solid #e2e8f0' }}>Koreksi HK</th>
                                        {/* TUNJANGAN */}
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Beras</th>
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Jabatan</th>
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Masa Kerja</th>
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Lembur</th>
                                        <th style={{ ...th('#f8fafc', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right', borderRight: '2px solid #e2e8f0' }}>Tot. Tunj</th>
                                        {/* PREMI */}
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Brondol</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>PPH</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right', borderRight: '2px solid #e2e8f0' }}>Tot. Premi</th>
                                        {/* POTONGAN */}
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>SPSI</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>BPJS Kes (P)</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>BPJS Kes (M)</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>BPJS Pen (P)</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>BPJS Pen (M)</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Astek (P)</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right', borderRight: '2px solid #e2e8f0' }}>Astek (M)</th>
                                        {/* PAJAK & HASIL */}
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>Bruto Pajak</th>
                                        <th style={{ ...th('#f1f5f9', '#475569', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right' }}>PPH21</th>
                                        <th style={{ ...th('#f1f5f9', '#10b981', '#e2e8f0'), fontSize: '0.7rem', textAlign: 'right', fontWeight: 800 }}>UPAH BERSIH</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payrollHistory.map((p, i) => {
                                        return (
                                            <tr key={i} style={{ backgroundColor: 'white', transition: 'background-color 0.15s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc'; e.currentTarget.cells[0].style.backgroundColor = '#f8fafc'; }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'white'; e.currentTarget.cells[0].style.backgroundColor = 'white'; }}>
                                                <td style={{ ...td(), fontWeight: 700, color: '#0f172a', position: 'sticky', left: 0, backgroundColor: 'white', zIndex: 1, borderRight: '2px solid #e2e8f0', transition: 'background-color 0.15s ease' }}>{p.period_label || `${getMonthName(n(p.period_month))} ${p.period_year}`}</td>
                                                <td style={{ ...td(), color: '#64748b', fontSize: '0.75rem', borderRight: '2px solid #e2e8f0' }}>{(p.nik || p.emp_code || '-').toString().trim()}</td>
                                                {/* PENGGAJIAN */}
                                                <td style={{ ...td('center'), color: '#475569' }}>{n(p.jumlah_hk || p.hari_kerja)}</td>
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.upah_dasar)}</td>
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.gaji_pokok_aktual || p.gaji_pokok)}</td>
                                                <td style={{ ...td('right'), color: n(p.koreksi_hk) !== 0 ? '#ef4444' : '#94a3b8', borderRight: '2px solid #e2e8f0' }}>{fmt(p.koreksi_hk)}</td>
                                                {/* TUNJANGAN */}
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.beras_jumlah)}</td>
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.jabatan_jumlah)}</td>
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.masa_kerja_jumlah)}</td>
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.lembur_jumlah)}</td>
                                                <td style={{ ...td('right'), fontWeight: 600, color: '#334155', borderRight: '2px solid #e2e8f0' }}>Rp {fmt(p.total_tunjangan)}</td>
                                                {/* PREMI */}
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.premi_brondol)}</td>
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.premi_pph)}</td>
                                                <td style={{ ...td('right'), fontWeight: 600, color: '#334155', borderRight: '2px solid #e2e8f0' }}>Rp {fmt(p.total_premi)}</td>
                                                {/* UPAH KOTOR */}
                                                <td style={{ ...td('right'), fontWeight: 800, color: '#0f172a', borderRight: '2px solid #cbd5e1', backgroundColor: '#f8fafc' }}>Rp {fmt(p.jumlah_upah_kotor)}</td>
                                                {/* POTONGAN */}
                                                <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pot_spsi)}</td>
                                                <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pot_bpjs_kesehatan_pekerja)}</td>
                                                <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pot_bpjs_kesehatan_majikan)}</td>
                                                <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pot_bpjs_pensiun_pekerja)}</td>
                                                <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pot_bpjs_pensiun_majikan)}</td>
                                                <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pot_astek_pekerja)}</td>
                                                <td style={{ ...td('right'), color: '#ef4444', borderRight: '2px solid #e2e8f0' }}>Rp {fmt(p.pot_astek_majikan)}</td>
                                                {/* TOT POTONGAN */}
                                                <td style={{ ...td('right'), fontWeight: 800, color: '#ef4444', borderRight: '2px solid #cbd5e1', backgroundColor: '#fef2f2' }}>Rp {fmt(p.total_potongan || p.total_potongan_bersih)}</td>
                                                {/* PAJAK & HASIL */}
                                                <td style={{ ...td('right'), color: '#475569' }}>Rp {fmt(p.penghasilan_bruto || p.upah_kotor_pajak)}</td>
                                                <td style={{ ...td('right'), color: '#ef4444' }}>Rp {fmt(p.pph21_ter || p.pot_pph21)}</td>
                                                <td style={{ ...td('right'), fontWeight: 800, color: '#10b981', fontSize: '0.9rem', backgroundColor: '#ecfdf5' }}>Rp {fmt(p.upah_bersih)}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* History Modal for NIK */}
            {historyModalNik.isOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setHistoryModalNik({ isOpen: false, data: null, loading: false })}>
                    <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', width: '90%', maxWidth: '500px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
                            <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.25rem' }}>Riwayat Perubahan NIK</h3>
                            <button onClick={() => setHistoryModalNik({ isOpen: false, data: null, loading: false })} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>×</button>
                        </div>

                        <div style={{ marginBottom: '16px', fontWeight: '600', color: '#334155' }}>Karyawan: {empCode}</div>

                        {historyModalNik.loading ? (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>Memuat riwayat...</div>
                        ) : historyModalNik.data && historyModalNik.data.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {historyModalNik.data.map((h, index) => (
                                    <div key={h.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', backgroundColor: index === 0 ? '#f8fafc' : 'white' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem', color: '#64748b' }}>
                                            <span><strong>Versi:</strong> {h.version} {index === 0 && <span style={{ color: '#10b981' }}>(Terbaru)</span>}</span>
                                            <span>{new Date(h.changed_at).toLocaleString('id-ID')}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f1f5f9', padding: '8px 12px', borderRadius: '6px' }}>
                                            <div style={{ fontSize: '0.9rem' }}>
                                                <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: '8px' }}>{h.old_value || '(Kosong)'}</span>
                                                <span style={{ fontWeight: 700, color: '#0f172a' }}>{h.new_value}</span>
                                            </div>
                                            {index === 0 && (
                                                <button onClick={handleRollbackNik} style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>🗑️ Rollback</button>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '8px' }}>Oleh: {h.changed_by}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px' }}>Belum ada riwayat perubahan NIK (masih menggunakan NIK dari Plantware).</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
