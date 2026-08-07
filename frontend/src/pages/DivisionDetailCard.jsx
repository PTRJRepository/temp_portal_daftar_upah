import React, { useState, useEffect, useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import WageDistributionChart, { grossOf } from '../components/dashboard/WageDistributionChart';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val);
};


export default function DivisionDetailCard({ division, data, loading, onBack, initialEmp }) {
    const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'employees'
    const [employeeFilters, setEmployeeFilters] = useState({ minNetWage: 0, maxNetWage: 0, minOvertime: 0, minPremi: 0, search: '' });
    const [filteredEmployees, setFilteredEmployees] = useState([]);
    const [selectedEmp, setSelectedEmp] = useState(null); // drill-down uraian gaji
    const [rangeFilter, setRangeFilter] = useState(null); // { idx, min, max, label } dari chart distribusi

    // Karyawan yang dirender: hasil filter toolbar + filter range dari chart (upah kotor)
    const displayEmployees = useMemo(() => {
        if (!rangeFilter) return filteredEmployees;
        return filteredEmployees.filter(emp => {
            const v = grossOf(emp);
            return v >= rangeFilter.min && v < rangeFilter.max;
        });
    }, [filteredEmployees, rangeFilter]);

    // Deep-link: buka modal karyawan langsung dari URL (?emp=CODE)
    useEffect(() => {
        if (initialEmp && data?.employees?.length) {
            const found = data.employees.find(e => e.emp_code === initialEmp || e.nik === initialEmp || e.new_nik === initialEmp);
            if (found) {
                setActiveTab('employees');
                setSelectedEmp(found);
            }
        }
    }, [initialEmp, data?.employees]);

    // Initialize filtered employees when data changes
    useEffect(() => {
        if (data?.employees) {
            setFilteredEmployees(data.employees);
        }
    }, [data]);

    // Filter Logic
    useEffect(() => {
        if (!data?.employees) return;
        const filtered = data.employees.filter(emp =>
            (emp.name.toLowerCase().includes(employeeFilters.search.toLowerCase()) || (emp.new_nik || emp.nik).includes(employeeFilters.search)) &&
            emp.upah_bersih >= (employeeFilters.minNetWage || 0) &&
            (!employeeFilters.maxNetWage || emp.upah_bersih <= employeeFilters.maxNetWage) &&
            emp.lembur >= employeeFilters.minOvertime &&
            emp.premi >= employeeFilters.minPremi
        );
        setFilteredEmployees(filtered);
    }, [employeeFilters, data]);

    if (loading) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f8fafc', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ color: '#64748b', fontSize: '1.2rem' }}>Loading division details...</div>
            </div>
        );
    }

    if (!data) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
                <div style={{ color: '#ef4444', marginBottom: '1rem' }}>Failed to load division data</div>
                <button onClick={onBack} style={{ padding: '0.5rem 1rem', backgroundColor: '#3b82f6', color: 'white', borderRadius: '6px', border: 'none', cursor: 'pointer' }}>
                    Back to Dashboard
                </button>
            </div>
        );
    }

    return (
        <div style={{ padding: '2rem', backgroundColor: '#f8fafc', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                        onClick={onBack}
                        style={{
                            background: 'white',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            padding: '0.5rem 1rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            color: '#64748b',
                            fontWeight: '600',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                    >
                        ← Back
                    </button>
                    <div>
                        <h1 style={{ fontSize: '1.8rem', fontWeight: '800', color: '#1e293b', margin: 0 }}>
                            {division} Division Analysis
                        </h1>
                        <p style={{ color: '#64748b', marginTop: '0.25rem' }}>Detailed breakdown of costs and employee data</p>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0' }}>
                <button
                    onClick={() => setActiveTab('overview')}
                    style={{
                        padding: '1rem 1.5rem',
                        borderBottom: activeTab === 'overview' ? '3px solid #3b82f6' : '3px solid transparent',
                        color: activeTab === 'overview' ? '#3b82f6' : '#64748b',
                        fontWeight: '700',
                        background: 'transparent',
                        border: 'none',
                        borderBottomWidth: '3px',
                        borderBottomStyle: 'solid',
                        cursor: 'pointer',
                        fontSize: '1rem'
                    }}
                >
                    Overview
                </button>
                <button
                    onClick={() => setActiveTab('employees')}
                    style={{
                        padding: '1rem 1.5rem',
                        borderBottom: activeTab === 'employees' ? '3px solid #3b82f6' : '3px solid transparent',
                        color: activeTab === 'employees' ? '#3b82f6' : '#64748b',
                        fontWeight: '700',
                        background: 'transparent',
                        border: 'none',
                        borderBottomWidth: '3px',
                        borderBottomStyle: 'solid',
                        cursor: 'pointer',
                        fontSize: '1rem'
                    }}
                >
                    Employee Details
                </button>
            </div>

            {activeTab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
                    {/* Gang Breakdown */}
                    <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1.5rem' }}>
                            Gang Breakdown ({data.gangs?.length || 0})
                        </h3>
                        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                            <table style={{ width: '100%', fontSize: '0.9rem', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', position: 'sticky', top: 0 }}>
                                        <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>Gang</th>
                                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>Total Wage</th>
                                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>Emp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.gangs
                                        ?.sort((a, b) => (b.total_upah_bersih || b.total_wage || 0) - (a.total_upah_bersih || a.total_wage || 0))
                                        .map((gang, idx) => (
                                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '12px' }}>
                                                    <div style={{ fontWeight: '600', color: '#334155' }}>{gang.gang_code}</div>
                                                    {gang.description && gang.description !== gang.gang_code && (
                                                        <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '2px' }}>{gang.description}</div>
                                                    )}
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'right', color: '#3b82f6', fontWeight: '600' }}>
                                                    {formatCurrency(gang.total_upah_bersih || gang.total_wage || 0)}
                                                </td>
                                                <td style={{ padding: '12px', textAlign: 'right', color: '#64748b' }}>{gang.total_employees || '-'}</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Premi Analysis */}
                    <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1.5rem' }}>
                            Premi Composition
                        </h3>
                        {data.premi && data.premi.length > 0 ? (
                            <>
                                <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
                                    <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Total Premi</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#10b981' }}>
                                        {formatCurrency(data.premi.reduce((sum, p) => sum + p.value, 0))}
                                    </div>
                                </div>
                                <div style={{ height: '300px' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={data.premi}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={100}
                                                paddingAngle={2}
                                                dataKey="value"
                                            >
                                                {data.premi.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'][index % 5]} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={(val) => formatCurrency(val)} />
                                            <Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>No premi data</div>
                        )}
                    </div>

                    {/* Overtime Analysis */}
                    <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', gridColumn: 'span 2' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1.5rem' }}>
                            ⏰ Overtime Analysis by Task
                        </h3>
                        {data.overtime && data.overtime.length > 0 ? (
                            <div style={{ height: '400px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.overtime} margin={{ top: 20, right: 30, left: 40, bottom: 60 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} fontSize={11} />
                                        <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(1)}jt`} />
                                        <Tooltip formatter={(val) => formatCurrency(val)} />
                                        <Bar dataKey="value" fill="#f97316" name="Overtime Cost" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>No overtime data</div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'employees' && (
                <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                    {/* Filters */}
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '2rem', padding: '1.5rem', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '250px' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem' }}>Search Employee (Name/NIK)</label>
                            <input
                                type="text"
                                placeholder="e.g. Budi or 12345"
                                value={employeeFilters.search}
                                onChange={(e) => setEmployeeFilters(prev => ({ ...prev, search: e.target.value }))}
                                style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            {/* Net Wage Range */}
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem' }}>Upah Bersih (min – max)</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <input
                                        type="number"
                                        placeholder="Min"
                                        value={employeeFilters.minNetWage || ''}
                                        onChange={(e) => setEmployeeFilters(prev => ({ ...prev, minNetWage: Number(e.target.value) || 0 }))}
                                        style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', width: '110px' }}
                                    />
                                    <span style={{ color: '#94a3b8', fontWeight: 700 }}>–</span>
                                    <input
                                        type="number"
                                        placeholder="Max"
                                        value={employeeFilters.maxNetWage || ''}
                                        onChange={(e) => setEmployeeFilters(prev => ({ ...prev, maxNetWage: Number(e.target.value) || 0 }))}
                                        style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', width: '110px' }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', width: '150px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem' }}>Min Overtime</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={employeeFilters.minOvertime}
                                    onChange={(e) => setEmployeeFilters(prev => ({ ...prev, minOvertime: Number(e.target.value) }))}
                                    style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', width: '150px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem' }}>Min Premi</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={employeeFilters.minPremi}
                                    onChange={(e) => setEmployeeFilters(prev => ({ ...prev, minPremi: Number(e.target.value) }))}
                                    style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Distribusi upah kotor: line chart frekuensi, klik dot = filter range */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <WageDistributionChart
                            employees={filteredEmployees}
                            activeRange={rangeFilter}
                            onRangeSelect={setRangeFilter}
                        />
                    </div>

                    {/* Data Grid */}
                    <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead style={{ backgroundColor: '#f1f5f9' }}>
                                <tr>
                                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>NIK</th>
                                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Name</th>
                                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Gang</th>
                                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Position</th>
                                    <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>HK</th>
                                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Basic Pay</th>
                                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Overtime</th>
                                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Premi</th>
                                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Upah Kotor</th>
                                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Net Wage</th>
                                    <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Uraian</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayEmployees.length > 0 ? (
                                    displayEmployees.map((emp, idx) => (
                                        <tr key={idx}
                                            onClick={() => setSelectedEmp(emp)}
                                            title="Klik untuk lihat uraian gaji"
                                            style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: idx % 2 === 0 ? 'white' : '#f8fafc', cursor: 'pointer' }}
                                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#eff6ff'}
                                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? 'white' : '#f8fafc'}
                                        >
                                            <td style={{ padding: '12px', fontFamily: 'monospace', color: '#64748b' }}>{emp.new_nik || emp.nik}</td>
                                            <td style={{ padding: '12px', fontWeight: '600', color: '#334155' }}>{emp.name}</td>
                                            <td style={{ padding: '12px', color: '#64748b' }}>{emp.gang}</td>
                                            <td style={{ padding: '12px', color: '#64748b' }}>{emp.role}</td>
                                            <td style={{ padding: '12px', textAlign: 'center', fontWeight: '600' }}>{emp.hk}</td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>{formatCurrency(emp.gaji_pokok)}</td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: emp.lembur > 0 ? '#ea580c' : 'inherit', fontWeight: emp.lembur > 0 ? '600' : 'normal' }}>
                                                {formatCurrency(emp.lembur)}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: emp.premi > 0 ? '#10b981' : 'inherit', fontWeight: emp.premi > 0 ? '600' : 'normal' }}>
                                                {formatCurrency(emp.premi)}
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#1d4ed8' }}>{formatCurrency(emp.breakdown?.jumlah_upah_kotor ?? emp.breakdown?.upah_kotor ?? 0)}</td>
                                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: '700', color: '#1e293b' }}>{formatCurrency(emp.upah_bersih)}</td>
                                            <td style={{ padding: '12px', textAlign: 'center' }}>
                                                <span style={{ color: '#3b82f6', fontWeight: '700', fontSize: '1rem' }}>→</span>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="11" style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                                            No employees found matching the current filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.9rem', textAlign: 'right' }}>
                        Showing {displayEmployees.length} of {data.employees?.length || 0} employees{rangeFilter ? ` (range ${rangeFilter.label})` : ''}
                    </div>
                </div>
            )}

            {/* Modal Uraian Gaji Karyawan */}
            {selectedEmp && (
                <div onClick={() => setSelectedEmp(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: 'white' }}>
                            <div>
                                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#1e293b' }}>{selectedEmp.name}</div>
                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{selectedEmp.new_nik || selectedEmp.nik} · {selectedEmp.gang} · {selectedEmp.role}</div>
                            </div>
                            <button onClick={() => setSelectedEmp(null)} style={{ border: 'none', background: '#f1f5f9', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontSize: '1rem', color: '#64748b' }}>×</button>
                        </div>
                        <div style={{ padding: '1.5rem' }}>
                            {(() => {
                                const b = selectedEmp.breakdown || {};
                                const premiItems = selectedEmp.premi_items || [];
                                const totalPremiItems = premiItems.reduce((s, x) => s + x.amount, 0);
                                const premiPalette = ['#1B9E77', '#34A853', '#7BC47F', '#A7D7A9', '#0E7490', '#3E7CB1'];
                                const Row = ({ label, value, bold, color }) => (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', fontWeight: bold ? '700' : '400', color: color || '#334155' }}>
                                        <span>{label}</span><span>{formatCurrency(value)}</span>
                                    </div>
                                );
                                return (
                                    <>
                                        <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#10b981', textTransform: 'uppercase', margin: '0.5rem 0' }}>Pendapatan</div>
                                        <Row label="Gaji Pokok Aktual" value={b.gaji_pokok_aktual} />
                                        <Row label="Tunjangan Beras" value={b.beras_jumlah} />
                                        <Row label="Tunjangan Jabatan" value={b.jabatan_jumlah} />
                                        <Row label="Tunjangan Masa Kerja" value={b.masa_kerja_jumlah} />
                                        <Row label="Lembur" value={b.lembur_jumlah} />
                                        <Row label="Total Premi" value={b.total_premi} />
                                        <Row label="Pendapatan Lainnya" value={b.pendapatan_lainnya} />
                                        <Row label="Jumlah Upah Kotor" value={b.jumlah_upah_kotor} bold color="#1d4ed8" />
                                        {premiItems.length > 0 && (
                                            <>
                                                <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1B9E77', textTransform: 'uppercase', margin: '1rem 0 0.5rem' }}>Uraian Premi</div>
                                                {premiItems.map((p, i) => {
                                                    const share = totalPremiItems > 0 ? (p.amount / totalPremiItems) * 100 : 0;
                                                    const col = premiPalette[i % premiPalette.length];
                                                    return (
                                                        <div key={p.key} style={{ marginBottom: '0.6rem' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 3 }}>
                                                                <span style={{ color: '#334155', fontWeight: 600 }}>{p.label}</span>
                                                                <span style={{ fontWeight: 700, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(p.amount)} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({share.toFixed(0)}%)</span></span>
                                                            </div>
                                                            <div style={{ height: 6, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                                                                <div style={{ height: '100%', width: `${share}%`, background: col, borderRadius: 999, transition: 'width .4s' }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </>
                                        )}
                                        <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#ef4444', textTransform: 'uppercase', margin: '1rem 0 0.5rem' }}>Potongan</div>
                                        <Row label="Koreksi" value={b.pot_koreksi} />
                                        <Row label="ASTEK Pekerja" value={b.pot_astek_pekerja} />
                                        <Row label="BPJS Kesehatan Pekerja" value={b.pot_bpjs_kesehatan_pekerja} />
                                        <Row label="BPJS Pensiun Pekerja" value={b.pot_bpjs_pensiun_pekerja} />
                                        <Row label="SPSI" value={b.pot_spsi} />
                                        <Row label="PPh21" value={b.pot_pph21} />
                                        <Row label="Total Potongan" value={b.total_potongan} bold color="#ef4444" />
                                        <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0fdf4', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontWeight: '800', color: '#166534' }}>Upah Bersih</span>
                                            <span style={{ fontWeight: '800', fontSize: '1.3rem', color: '#166534' }}>{formatCurrency(b.upah_bersih)}</span>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
