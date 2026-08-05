import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { buildAppPath } from '../utils/prodModeUtils';
import LoadingScreen from '../components/common/LoadingScreen';
import AgGridWrapper from '../components/common/AgGridWrapper';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';

async function searchEmployees(token, query, limit = 200) {
    if (!query || query.trim().length === 0) return [];

    try {
        const response = await fetch(`${API_BASE_URL}/payroll/employee/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to search');
        const json = await response.json();
        return json.data || [];
    } catch (err) {
        console.error('Error searching employees:', err);
        return [];
    }
}

async function listEmployees(token, { division, religion, status, limit = 500 } = {}) {
    try {
        const params = new URLSearchParams();
        if (division) params.set('division', division);
        if (religion) params.set('religion', religion);
        if (status) params.set('status', status);
        params.set('limit', String(limit));

        const response = await fetch(`${API_BASE_URL}/payroll/employee/list?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to list');
        const json = await response.json();
        return json.data || [];
    } catch (err) {
        console.error('Error listing employees:', err);
        return [];
    }
}

async function fetchAvailableReligions(token) {
    try {
        const response = await fetch(`${API_BASE_URL}/payroll/employee/available-religions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return [];
        const json = await response.json();
        return json.religions || [];
    } catch (err) {
        console.error('Error fetching religions:', err);
        return [];
    }
}

async function fetchAvailableStatuses(token) {
    try {
        const response = await fetch(`${API_BASE_URL}/payroll/employee/available-statuses`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return [];
        const json = await response.json();
        return json.statuses || [];
    } catch (err) {
        console.error('Error fetching statuses:', err);
        return [];
    }
}

const DIVISIONS = [
    'ALL', 'PG1A', 'PG1B', 'PG2A', 'PG2B', 'DME', 'ARA', 'ARB1', 'ARB2',
    'INFRA', 'ARC', 'IJL', 'STF-OFFICE', 'SECURITY'
];

export default function EmployeeDirectoryPage() {
    const navigate = useNavigate();
    const { token, user, isKeraniUser } = useAuth();

    const [searchTerm, setSearchTerm] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState([]);
    const [hasSearched, setHasSearched] = useState(false);

    // Kerani locked division
    const keraniDivision = isKeraniUser ? (user?.divisions?.[0] || user?.divisi || null) : null;

    // Filter states - kerani users are locked to their division
    const [filterDivision, setFilterDivision] = useState(keraniDivision || 'ALL');
    const [filterReligion, setFilterReligion] = useState('');
    const [filterGender, setFilterGender] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    // Available filter options
    const [availableReligions, setAvailableReligions] = useState([]);
    const [availableStatuses, setAvailableStatuses] = useState([]);

    // Load filter options on mount
    useEffect(() => {
        if (!token) return;
        fetchAvailableReligions(token).then(setAvailableReligions);
        fetchAvailableStatuses(token).then(setAvailableStatuses);
    }, [token]);

    const handleSearch = useCallback(async (e) => {
        if (e) e.preventDefault();

        setIsSearching(true);
        setHasSearched(true);

        try {
            let data;

            if (searchTerm && searchTerm.trim().length >= 2) {
                // Text search mode - kerani restriction is handled server-side
                data = await searchEmployees(token, searchTerm);
            } else {
                // Filter-only mode — use list endpoint
                // Kerani users are locked to their division server-side
                data = await listEmployees(token, {
                    division: keraniDivision || (filterDivision !== 'ALL' ? filterDivision : undefined),
                    religion: filterReligion || undefined,
                    status: filterStatus || undefined,
                });
            }

            // Apply client-side gender filter (since backend doesn't have a gender param)
            if (filterGender) {
                data = data.filter(emp => emp.jenis_kelamin === filterGender);
            }

            // Apply client-side religion/status filter for search results (search endpoint doesn't filter these server-side)
            if (searchTerm && searchTerm.trim().length >= 2) {
                if (filterReligion) {
                    data = data.filter(emp => (emp.religion || '').toUpperCase() === filterReligion.toUpperCase());
                }
                if (filterStatus) {
                    data = data.filter(emp => (emp.status || '').toUpperCase() === filterStatus.toUpperCase());
                }
                if (filterDivision && filterDivision !== 'ALL') {
                    // The search result has gang_code; use first letter(s) matching division prefix
                    // This is approximate; the server already handles it for /search with division param
                }
            }

            setResults(data);
        } catch (error) {
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    }, [searchTerm, token, filterDivision, filterReligion, filterGender, filterStatus]);

    // Auto-search on Enter key
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleSearch(e);
        }
    };

    // Helper: derive division from gang code (same logic as EmployeeDirectoryAnalytics)
    const getDivisionFromGang = (gangCode) => {
        if (!gangCode) return 'OTHER';
        const gc = gangCode.toUpperCase();
        if (gc.startsWith('A')) return 'PG1A';
        if (gc.startsWith('B')) return 'PG1B';
        if (gc.startsWith('C')) return 'PG2A';
        if (gc.startsWith('D')) return 'PG2B';
        if (gc.startsWith('E')) return 'DME';
        if (gc.startsWith('F')) return 'ARA';
        if (gc.startsWith('G')) return 'AB1';
        if (gc.startsWith('H')) return 'AB2';
        if (gc.startsWith('I')) return 'INF';
        if (gc.startsWith('J')) return 'ARC';
        if (gc.startsWith('L')) return 'IJL';
        if (gc.startsWith('M') || gc.startsWith('ML')) return 'MILL';
        if (gc.startsWith('O')) return 'OFFICE';
        if (gc.startsWith('SEC')) return 'SEC';
        return 'OTHER';
    };

    const handleViewProfile = (nik, empData) => {
        if (!nik) return;

        // Kerani division check: prevent opening HR info for employees outside their division
        if (isKeraniUser && keraniDivision) {
            const empGang = empData?.gang_code || '';
            const empDivision = getDivisionFromGang(empGang);
            if (empDivision !== keraniDivision) {
                alert(`Akses ditolak: Anda hanya dapat melihat profil karyawan dari divisi ${keraniDivision}.`);
                return;
            }
        }

        const params = new URLSearchParams({ nik });
        const detailPath = buildAppPath(`/hr-info?${params.toString()}`);
        window.open(detailPath, '_blank', 'noopener,noreferrer');
    };

    // Column Definitions for AG Grid
    const columnDefs = useMemo(() => [
        {
            field: 'actual_nik',
            headerName: 'NIK (KTP)',
            width: 160,
            pinned: 'left'
        },
        { field: 'nik', headerName: 'Emp Code', width: 120 },
        { field: 'nama', headerName: 'Nama Karyawan', flex: 1, minWidth: 200 },
        { field: 'jenis_kelamin', headerName: 'L/P', width: 70 },
        { field: 'religion', headerName: 'Agama', width: 100 },
        {
            field: 'status', headerName: 'Status', width: 90,
            cellRenderer: params => {
                if (!params.value) return '-';
                const val = params.value.trim();
                const isActive = val === '1' || val.toUpperCase() === 'ACTIVE' || val.toUpperCase() === 'A';
                return (
                    <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: isActive ? '#dcfce7' : '#fee2e2',
                        color: isActive ? '#166534' : '#991b1b'
                    }}>
                        {isActive ? 'Aktif' : 'Non-Aktif'}
                    </span>
                );
            }
        },
        { field: 'loc_code', headerName: 'Lokasi', width: 90 },
        { field: 'gang_code', headerName: 'Gang', width: 90 },
        {
            headerName: 'Aksi',
            width: 150,
            pinned: 'right',
            cellRenderer: (params) => {
                if (!params.data) return null;
                const nikTarget = params.data.actual_nik || params.data.nik;
                return (
                    <button
                        onClick={() => handleViewProfile(nikTarget, params.data)}
                        style={{
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            padding: '4px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                        }}
                    >
                        Lihat Profil HR
                    </button>
                );
            }
        }
    ], []);

    const selectStyle = {
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid #cbd5e1',
        fontSize: '0.9rem',
        backgroundColor: 'white',
        color: '#334155',
        minWidth: '120px'
    };

    return (
        <div style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc' }}>

            <div style={{ marginBottom: '1.5rem' }}>
                <h1 style={{ fontSize: '1.8rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.5rem' }}>
                    Employee Directory (HR)
                </h1>
                <p style={{ color: '#64748b' }}>
                    Cari riwayat dan profil karyawan berdasarkan NIK KTP atau Nama. Gunakan filter untuk mempersempit hasil.
                </p>
            </div>

            {/* Search + Filters */}
            <div style={{
                backgroundColor: 'white',
                padding: '1.25rem 1.5rem',
                borderRadius: '8px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                marginBottom: '1rem',
            }}>
                {/* Search bar row */}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '12px', top: '10px', color: '#94a3b8' }}>
                            🔍
                        </span>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Masukkan NIK KTP, Emp Code, atau Nama Karyawan... (kosongkan untuk filter saja)"
                            style={{
                                width: '100%',
                                padding: '10px 10px 10px 36px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                fontSize: '1rem'
                            }}
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        disabled={isSearching}
                        style={{
                            padding: '10px 24px',
                            backgroundColor: '#0f172a',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: isSearching ? 'not-allowed' : 'pointer',
                            fontWeight: '600',
                            fontSize: '1rem',
                            minWidth: '120px'
                        }}
                    >
                        {isSearching ? 'Mencari...' : 'Cari / Filter'}
                    </button>
                </div>

                {/* Filter row */}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#64748b', fontWeight: '600', fontSize: '0.85rem', marginRight: '0.25rem' }}>
                        Filter:
                    </span>

                    {/* Division Filter - Hidden for kerani users (locked to their division) */}
                    {!isKeraniUser && (
                        <select
                            value={filterDivision}
                            onChange={(e) => setFilterDivision(e.target.value)}
                            style={selectStyle}
                        >
                            {DIVISIONS.map(d => (
                                <option key={d} value={d}>{d === 'ALL' ? 'Semua Divisi' : d}</option>
                            ))}
                        </select>
                    )}
                    {isKeraniUser && keraniDivision && (
                        <span style={{
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            border: '1px solid #fcd34d'
                        }}>
                            Divisi: {keraniDivision}
                        </span>
                    )}

                    {/* Religion Filter */}
                    <select
                        value={filterReligion}
                        onChange={(e) => setFilterReligion(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="">Semua Agama</option>
                        {availableReligions.map(r => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>

                    {/* Gender Filter */}
                    <select
                        value={filterGender}
                        onChange={(e) => setFilterGender(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="">Semua Jenis Kelamin</option>
                        <option value="L">Laki-laki (L)</option>
                        <option value="P">Perempuan (P)</option>
                    </select>

                    {/* Status Filter */}
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="">Semua Status</option>
                        {availableStatuses.map(s => {
                            const isActive = s === '1' || s.toUpperCase() === 'ACTIVE' || s.toUpperCase() === 'A';
                            const label = isActive ? `Aktif (${s})` : `Non-Aktif (${s})`;
                            return <option key={s} value={s}>{label}</option>;
                        })}
                    </select>
                </div>
            </div>

            <div style={{ flex: 1, backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {hasSearched ? (
                    <>
                        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: '600', color: '#334155' }}>Hasil Pencarian</span>
                            <span style={{ color: '#64748b', fontSize: '0.9rem' }}>{results.length} karyawan ditemukan</span>
                        </div>
                        {results.length > 0 ? (
                            <div className="ag-theme-alpine" style={{ flex: 1, width: '100%' }}>
                                <AgGridWrapper
                                    rowData={results}
                                    columnDefs={columnDefs}
                                    height="100%"
                                />
                            </div>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
                                <h3>Data tidak ditemukan</h3>
                                <p>Coba gunakan kata kunci pencarian yang lain atau ubah filter.</p>
                            </div>
                        )}
                    </>
                ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👥</div>
                        <h3>Mulai Pencarian</h3>
                        <p>Ketikkan nama atau NIK, atau klik "Cari / Filter" dengan filter yang sudah diatur.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
