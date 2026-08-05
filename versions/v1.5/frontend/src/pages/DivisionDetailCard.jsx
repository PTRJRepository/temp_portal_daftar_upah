import React, { useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts';

const formatCurrency = (val) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val);
};


export default function DivisionDetailCard({ division, data, loading, onBack }) {
    const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'employees'
    const [employeeFilters, setEmployeeFilters] = useState({ minNetWage: 0, minOvertime: 0, minPremi: 0, search: '' });
    const [filteredEmployees, setFilteredEmployees] = useState([]);

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
            emp.upah_bersih >= employeeFilters.minNetWage &&
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
                    📊 Overview
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
                    👥 Employee Details
                </button>
            </div>

            {activeTab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
                    {/* Gang Breakdown */}
                    <div style={{ backgroundColor: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#334155', marginBottom: '1.5rem' }}>
                            👥 Gang Breakdown ({data.gangs?.length || 0})
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
                            💰 Premi Composition
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
                            {/* Min Wages Inputs */}
                            <div style={{ display: 'flex', flexDirection: 'column', width: '150px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem' }}>Min Net Wage</label>
                                <input
                                    type="number"
                                    placeholder="0"
                                    value={employeeFilters.minNetWage}
                                    onChange={(e) => setEmployeeFilters(prev => ({ ...prev, minNetWage: Number(e.target.value) }))}
                                    style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                                />
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
                                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Deductions</th>
                                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cbd5e1', color: '#475569' }}>Net Wage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEmployees.length > 0 ? (
                                    filteredEmployees.map((emp, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
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
                                            <td style={{ padding: '12px', textAlign: 'right', color: '#ef4444' }}>{formatCurrency(emp.potongan)}</td>
                                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: '700', color: '#1e293b' }}>{formatCurrency(emp.upah_bersih)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="10" style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                                            No employees found matching the current filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.9rem', textAlign: 'right' }}>
                        Showing {filteredEmployees.length} of {data.employees?.length || 0} employees
                    </div>
                </div>
            )}
        </div>
    );
}
