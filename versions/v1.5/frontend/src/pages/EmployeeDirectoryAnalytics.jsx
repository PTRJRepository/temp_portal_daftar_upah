import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { buildAppPath } from '../utils/prodModeUtils';
import AgGridWrapper from '../components/common/AgGridWrapper';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';

// Religion visual config
const RELIGION_COLORS = {
    ISLAM: { bg: '#dbeafe', border: '#93c5fd', text: '#1e40af', icon: '🕌' },
    KRISTEN: { bg: '#fce7f3', border: '#f9a8d4', text: '#9d174d', icon: '✝️' },
    KATHOLIK: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', icon: '⛪' },
    HINDU: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', icon: '🪔' },
    BUDHA: { bg: '#fff7ed', border: '#fdba74', text: '#9a3412', icon: '☸️' },
    KONGHUCU: { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '📿' },
};

const DIVISION_CONFIG = {
    'ALL': { label: 'Semua Divisi', short: 'ALL', color: '#64748b', bg: '#f8fafc', border: '#cbd5e1' },
    'PG1A': { label: 'PG1A - Plasma 1 Afdeling', short: 'PG1A', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
    'PG1B': { label: 'PG1B - Plasma 1 Blok', short: 'PG1B', color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
    'PG2A': { label: 'PG2A - Plasma 2 Afdeling', short: 'PG2A', color: '#db2777', bg: '#fdf2f8', border: '#f9a8d4' },
    'PG2B': { label: 'PG2B - Plasma 2 Blok', short: 'PG2B', color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
    'DME': { label: 'DME - Darrur Makmur Estate', short: 'DME', color: '#16a34a', bg: '#f0fdf4', border: '#86efac' },
    'ARA': { label: 'ARA - Area', short: 'ARA', color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
    'AB1': { label: 'AB1 - Afdeling 1', short: 'AB1', color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
    'AB2': { label: 'AB2 - Afdeling 2', short: 'AB2', color: '#c026d3', bg: '#faf5ff', border: '#e9d5ff' },
    'INF': { label: 'INF - Infrastruktur', short: 'INF', color: '#475569', bg: '#f8fafc', border: '#94a3b8' },
    'ARC': { label: 'ARC - Air Ruak Central', short: 'ARC', color: '#0d9488', bg: '#f0fdfa', border: '#5eead4' },
    'IJL': { label: 'IJL - Ijuk', short: 'IJL', color: '#ca8a04', bg: '#fefce8', border: '#fef08a' },
    'MILL': { label: 'MILL - Palm Oil Mill', short: 'MILL', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
    'OFFICE': { label: 'OFFICE - Staff Kantor', short: 'OFFICE', color: '#0f766e', bg: '#f0fdfa', border: '#5eead4' },
    'SEC': { label: 'SEC - Security', short: 'SEC', color: '#1e293b', bg: '#f1f5f9', border: '#94a3b8' },
    'OTHER': { label: 'Lainnya', short: 'OTHER', color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' },
};

// ============================================================================
// API Functions
// ============================================================================

async function fetchEmployeesList(token, filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.division && filters.division !== 'ALL') params.set('division', filters.division);
        if (filters.gang) params.set('gang_code', filters.gang);
        if (filters.religion) params.set('religion', filters.religion);
        if (filters.status) params.set('status', filters.status);
        if (filters.forceHistory) params.set('force_history', 'true');

        const response = await fetch(`${API_BASE_URL}/payroll/employee/list-all?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch');
        const json = await response.json();
        return { data: json.data || [], dataSource: json.dataSource || 'origin' };
    } catch (err) {
        console.error('Error fetching employees:', err);
        return { data: [], dataSource: 'origin' };
    }
}

async function searchEmployees(token, query, limit = 50) {
    if (!query || query.trim().length < 2) return { data: [], dataSource: 'origin' };
    try {
        const response = await fetch(
            `${API_BASE_URL}/payroll/employee/search?q=${encodeURIComponent(query)}&limit=${limit}`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        if (!response.ok) throw new Error('Search failed');
        const json = await response.json();
        return { data: json.data || [], dataSource: json.dataSource || 'origin' };
    } catch (err) {
        console.error('Error searching:', err);
        return { data: [], dataSource: 'origin' };
    }
}

async function fetchGangsByDivision(token, division) {
    if (!division || division === 'ALL') return [];
    try {
        const response = await fetch(
            `${API_BASE_URL}/payroll/employee/available-gangs?division=${encodeURIComponent(division)}`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        if (!response.ok) return [];
        const json = await response.json();
        return json.gangs || [];
    } catch (err) {
        return [];
    }
}

async function fetchAllGangs(token) {
    try {
        const response = await fetch(`${API_BASE_URL}/payroll/employee/available-gangs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return [];
        const json = await response.json();
        return json.gangs || [];
    } catch (err) {
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
        return [];
    }
}

// ============================================================================
// Helpers
// ============================================================================

function getDivisionFromGang(gangCode) {
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
}

function getReligionConfig(religion) {
    const r = (religion || '').toUpperCase().trim();
    if (RELIGION_COLORS[r]) return RELIGION_COLORS[r];
    // Default: hash-based color
    const colors = [
        { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '🏛️' },
        { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', icon: '🏛️' },
        { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', icon: '🏛️' },
        { bg: '#ecfeff', border: '#a5f3fc', text: '#0e7490', icon: '🏛️' },
    ];
    const idx = r.length % colors.length;
    return colors[idx];
}

function formatCurrency(num) {
    if (num === null || num === undefined || num === '-') return '-';
    return 'Rp ' + Number(num).toLocaleString('id-ID');
}

function calculateAge(birthDateStr) {
    if (!birthDateStr) return null;
    try {
        const birth = new Date(birthDateStr);
        if (isNaN(birth.getTime())) return null;
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age >= 0 && age < 100 ? age : null;
    } catch { return null; }
}

function calculateSeniority(joinDateStr) {
    if (!joinDateStr) return null;
    try {
        const join = new Date(joinDateStr);
        if (isNaN(join.getTime())) return null;
        const today = new Date();
        let years = today.getFullYear() - join.getFullYear();
        const m = today.getMonth() - join.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < join.getDate())) years--;
        return years >= 0 ? years : null;
    } catch { return null; }
}

// ============================================================================
// Analytics Computation
// ============================================================================

function computeAnalytics(employees) {
    const total = employees.length;
    if (total === 0) return null;

    const byGender = {};
    let maleCount = 0, femaleCount = 0;
    employees.forEach(e => {
        const g = e.jenis_kelamin || '-';
        byGender[g] = (byGender[g] || 0) + 1;
        if (g === 'L') maleCount++;
        if (g === 'P') femaleCount++;
    });

    const byReligion = {};
    employees.forEach(e => {
        const r = e.religion || 'Tidak Diketahui';
        byReligion[r] = (byReligion[r] || 0) + 1;
    });

    const byDivision = {};
    employees.forEach(e => {
        const div = getDivisionFromGang(e.gang_code);
        byDivision[div] = (byDivision[div] || 0) + 1;
    });

    const byGang = {};
    employees.forEach(e => {
        const g = e.gang_code || '-';
        byGang[g] = (byGang[g] || 0) + 1;
    });

    const byStatus = {};
    let activeCount = 0;
    employees.forEach(e => {
        const s = e.status || '-';
        byStatus[s] = (byStatus[s] || 0) + 1;
        if (s === '1' || s.toUpperCase() === 'ACTIVE' || s.toUpperCase() === 'A') activeCount++;
    });

    // Age
    const ageGroups = { '<20': 0, '20-25': 0, '26-30': 0, '31-35': 0, '36-40': 0, '41-45': 0, '46-50': 0, '51-55': 0, '>55': 0 };
    let totalAge = 0, ageCount = 0;
    employees.forEach(e => {
        const age = calculateAge(e.birth_date);
        if (age !== null) {
            totalAge += age;
            ageCount++;
            if (age < 20) ageGroups['<20']++;
            else if (age <= 25) ageGroups['20-25']++;
            else if (age <= 30) ageGroups['26-30']++;
            else if (age <= 35) ageGroups['31-35']++;
            else if (age <= 40) ageGroups['36-40']++;
            else if (age <= 45) ageGroups['41-45']++;
            else if (age <= 50) ageGroups['46-50']++;
            else if (age <= 55) ageGroups['51-55']++;
            else ageGroups['>55']++;
        }
    });

    // Seniority
    const seniorityGroups = { '<1 Th': 0, '1-3 Th': 0, '4-6 Th': 0, '7-10 Th': 0, '11-15 Th': 0, '>15 Th': 0 };
    let totalSeniority = 0, seniorityCount = 0;
    employees.forEach(e => {
        const yrs = calculateSeniority(e.join_date);
        if (yrs !== null) {
            totalSeniority += yrs;
            seniorityCount++;
            if (yrs < 1) seniorityGroups['<1 Th']++;
            else if (yrs <= 3) seniorityGroups['1-3 Th']++;
            else if (yrs <= 6) seniorityGroups['4-6 Th']++;
            else if (yrs <= 10) seniorityGroups['7-10 Th']++;
            else if (yrs <= 15) seniorityGroups['11-15 Th']++;
            else seniorityGroups['>15 Th']++;
        }
    });

    // Gaji
    const gajiGroups = { '<2 Jt': 0, '2-3 Jt': 0, '3-4 Jt': 0, '4-5 Jt': 0, '5-6 Jt': 0, '>6 Jt': 0 };
    employees.forEach(e => {
        const gaji = e.upah_dasar || 0;
        if (gaji < 2000000) gajiGroups['<2 Jt']++;
        else if (gaji <= 3000000) gajiGroups['2-3 Jt']++;
        else if (gaji <= 4000000) gajiGroups['3-4 Jt']++;
        else if (gaji <= 5000000) gajiGroups['4-5 Jt']++;
        else if (gaji <= 6000000) gajiGroups['5-6 Jt']++;
        else gajiGroups['>6 Jt']++;
    });

    const topGangs = Object.entries(byGang)
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

    return {
        total, maleCount, femaleCount, activeCount,
        byGender, byReligion, byStatus, byDivision, byGang, topGangs,
        ageGroups, seniorityGroups, gajiGroups,
        avgAge: ageCount > 0 ? (totalAge / ageCount).toFixed(1) : '-',
        avgSeniority: seniorityCount > 0 ? (totalSeniority / seniorityCount).toFixed(1) : '-',
        knownAgeCount: ageCount,
        knownSeniorityCount: seniorityCount
    };
}

// ============================================================================
// Sub-Components
// ============================================================================

// KPI Card
function KPICard({ title, value, icon, subtitle, accent }) {
    const colors = {
        blue: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
        green: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
        purple: { bg: '#faf5ff', border: '#e9d5ff', text: '#7e22ce' },
        orange: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412' },
        red: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
        teal: { bg: '#f0fdfa', border: '#99f6e4', text: '#115e59' },
        gray: { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' },
        pink: { bg: '#fdf2f8', border: '#fbcfe8', text: '#9d174d' },
    };
    const c = colors[accent] || colors.blue;
    return (
        <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: '12px', padding: '0.875rem 1.125rem', display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{icon}</span>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: c.text, lineHeight: 1.2 }}>
                    {typeof value === 'number' ? value.toLocaleString('id-ID') : value}
                </div>
                <div style={{ fontSize: '0.7rem', color: c.text, opacity: 0.8, fontWeight: '500' }}>{title}</div>
                {subtitle && <div style={{ fontSize: '0.65rem', color: c.text, opacity: 0.6 }}>{subtitle}</div>}
            </div>
        </div>
    );
}

// Horizontal Bar Chart
function HBarChart({ data, title, maxItems = 8, barColor = '#3b82f6' }) {
    const entries = Object.entries(data)
        .filter(([k, v]) => k && k !== '-' && k !== 'null' && k !== 'undefined')
        .sort((a, b) => b[1] - a[1]).slice(0, maxItems);

    const maxVal = entries.length > 0 ? Math.max(...entries.map(([, v]) => v)) : 1;
    const maxLabelLen = Math.max(...entries.map(([k]) => k.length), 8);

    if (entries.length === 0) {
        return (
            <div style={{ background: 'white', borderRadius: '12px', padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
                <h3 style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.75rem' }}>{title}</h3>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>Tidak ada data</div>
            </div>
        );
    }

    return (
        <div style={{ background: 'white', borderRadius: '12px', padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.75rem' }}>{title}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {entries.map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                        <span style={{ fontSize: '0.7rem', color: '#64748b', minWidth: `${Math.min(maxLabelLen * 0.55, 70)}px`, maxWidth: `${Math.min(maxLabelLen * 0.55, 70)}px`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', flexShrink: 0 }} title={label}>{label}</span>
                        <div style={{ flex: 1, background: '#f1f5f9', borderRadius: '4px', height: '14px', overflow: 'hidden', minWidth: '40px' }}>
                            <div style={{ width: `${maxVal > 0 ? (value / maxVal) * 100 : 0}%`, background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`, height: '100%', borderRadius: '4px', transition: 'width 0.4s ease', minWidth: value > 0 ? '4px' : 0 }} />
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: '600', color: '#334155', minWidth: '32px', textAlign: 'right', flexShrink: 0 }}>{value}</span>
                        <span style={{ fontSize: '0.65rem', color: '#94a3b8', minWidth: '32px', textAlign: 'right', flexShrink: 0 }}>{maxVal > 0 ? `${((value / maxVal) * 100).toFixed(0)}%` : '0%'}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Employee Card (for card view)
function EmployeeCard({ emp, onViewProfile }) {
    const religionConfig = getReligionConfig(emp.religion);
    const isActive = emp.status === '1' || (emp.status || '').toUpperCase() === 'ACTIVE' || (emp.status || '').toUpperCase() === 'A';
    const age = calculateAge(emp.birth_date);
    const seniority = calculateSeniority(emp.join_date);

    return (
        <div style={{
            background: 'white',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            padding: '0.875rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            transition: 'all 0.15s',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
            onMouseOver={e => { e.currentTarget.style.borderColor = '#94a3b8'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}
        >
            {/* Header: Name + Gender */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: '0.875rem', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={emp.nama}>
                        {emp.nama}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: '0.5rem', marginTop: '2px', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'monospace', color: '#1e40af', fontWeight: '600' }}>{emp.new_nik || emp.nik}</span>
                        {emp.actual_nik && emp.actual_nik !== emp.nik && (
                            <span style={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.7rem' }}>NIK: {emp.actual_nik}</span>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <span style={{ padding: '2px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: '700', background: emp.jenis_kelamin === 'L' ? '#dbeafe' : '#fce7f3', color: emp.jenis_kelamin === 'L' ? '#1e40af' : '#9d174d' }}>
                        {emp.jenis_kelamin === 'L' ? '♂' : '♀'}
                    </span>
                    <span style={{ padding: '2px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: '700', background: isActive ? '#dcfce7' : '#fee2e2', color: isActive ? '#166534' : '#991b1b' }}>
                        {isActive ? '✓' : '✗'}
                    </span>
                </div>
            </div>

            {/* Info badges */}
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '600', background: religionConfig.bg, border: `1px solid ${religionConfig.border}`, color: religionConfig.text }}>
                    {religionConfig.icon} {emp.religion || '-'}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '700', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
                    {emp.gang_code || '-'}
                </span>
                {emp.upah_dasar > 0 && (
                    <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '600', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}>
                        {formatCurrency(emp.upah_dasar)}
                    </span>
                )}
            </div>

            {/* Meta: Age + Seniority */}
            {(age !== null || seniority !== null) && (
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: '#94a3b8' }}>
                    {age !== null && <span>🎂 {age} th</span>}
                    {seniority !== null && <span>📅 {seniority} th kerja</span>}
                    {emp.join_date && <span>Masuk: {emp.join_date}</span>}
                </div>
            )}

            {/* Action */}
            <button
                onClick={() => onViewProfile(emp)}
                style={{
                    background: '#3b82f6', color: 'white', border: 'none', padding: '4px 10px',
                    borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600',
                    alignSelf: 'flex-end'
                }}
            >
                👤 Profil HR
            </button>
        </div>
    );
}

// Gang Group Card
function GangGroupCard({ gangCode, count, employees, onClick, active, divisionConfig }) {
    const avgGaji = employees.length > 0
        ? employees.reduce((sum, e) => sum + (e.upah_dasar || 0), 0) / employees.length
        : 0;
    const malePct = employees.length > 0
        ? Math.round((employees.filter(e => e.jenis_kelamin === 'L').length / employees.length) * 100)
        : 0;

    return (
        <div
            onClick={onClick}
            style={{
                background: active ? '#eff6ff' : 'white',
                border: `1px solid ${active ? '#3b82f6' : '#e2e8f0'}`,
                borderRadius: '10px',
                padding: '0.75rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
                boxShadow: active ? '0 2px 8px rgba(59,130,246,0.15)' : '0 1px 2px rgba(0,0,0,0.04)',
            }}
            onMouseOver={e => { if (!active) { e.currentTarget.style.borderColor = '#94a3b8'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}}
            onMouseOut={e => { if (!active) { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                <span style={{ fontWeight: '700', fontSize: '0.9rem', color: active ? '#1d4ed8' : '#1e293b' }}>
                    {gangCode}
                </span>
                <span style={{
                    background: active ? '#3b82f6' : '#f1f5f9',
                    color: active ? 'white' : '#64748b',
                    fontWeight: '700', fontSize: '0.75rem',
                    padding: '2px 8px', borderRadius: '10px'
                }}>
                    {count}
                </span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>♂</span>
                    <span style={{ color: '#64748b' }}>{malePct}%</span>
                </div>
                {avgGaji > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Ø Gaji</span>
                        <span style={{ color: '#16a34a' }}>{(avgGaji / 1000000).toFixed(1)} Jt</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// Religion Stat Card
function ReligionStatCard({ religion, count, total, onClick, active }) {
    const config = getReligionConfig(religion);
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';

    return (
        <div
            onClick={() => onClick(religion)}
            style={{
                background: active ? config.bg : 'white',
                border: `1px solid ${active ? config.border : '#e2e8f0'}`,
                borderRadius: '10px',
                padding: '0.75rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
                boxShadow: active ? `0 2px 8px ${config.border}44` : '0 1px 2px rgba(0,0,0,0.04)',
            }}
            onMouseOver={e => { if (!active) { e.currentTarget.style.borderColor = config.border; e.currentTarget.style.boxShadow = `0 2px 6px ${config.border}44`; }}}
            onMouseOut={e => { if (!active) { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'; }}}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                <span style={{ fontSize: '1.1rem' }}>{config.icon}</span>
                <span style={{ background: active ? config.border : '#f1f5f9', color: active ? config.text : '#64748b', fontWeight: '700', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px' }}>
                    {count}
                </span>
            </div>
            <div style={{ fontWeight: '600', fontSize: '0.8rem', color: config.text, marginBottom: '2px' }}>{religion}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <div style={{ flex: 1, background: '#f1f5f9', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, background: config.border, height: '100%', borderRadius: '3px', transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: '600', minWidth: '36px', textAlign: 'right' }}>{pct}%</span>
            </div>
        </div>
    );
}

// NIK Search Dropdown
function NikSearchDropdown({ results, onSelect, onClose }) {
    if (results.length === 0) return null;

    return (
        <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
            background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: '4px',
            maxHeight: '320px', overflow: 'hidden', display: 'flex', flexDirection: 'column'
        }}>
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600', background: '#f8fafc' }}>
                {results.length} hasil ditemukan
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
                {results.slice(0, 20).map((emp, idx) => (
                    <div
                        key={`${emp.nik}-${idx}`}
                        onClick={() => onSelect(emp)}
                        style={{
                            padding: '0.625rem 0.75rem', borderBottom: '1px solid #f8fafc',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem',
                            transition: 'background 0.1s',
                        }}
                        onMouseOver={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: '600', fontSize: '0.825rem', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {emp.nama}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', display: 'flex', gap: '0.5rem', marginTop: '2px' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: '600', color: '#1e40af' }}>{emp.new_nik || emp.nik}</span>
                                {emp.actual_nik && emp.actual_nik !== emp.nik && (
                                    <span style={{ color: '#94a3b8' }}>NIK: {emp.actual_nik}</span>
                                )}
                                <span style={{ color: '#94a3b8' }}>·</span>
                                <span style={{ fontWeight: '600', color: '#1e40af' }}>{emp.gang_code}</span>
                                <span style={{ color: '#94a3b8' }}>·</span>
                                <span>{emp.religion || '-'}</span>
                            </div>
                        </div>
                        <span style={{
                            padding: '2px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: '700',
                            background: emp.jenis_kelamin === 'L' ? '#dbeafe' : '#fce7f3',
                            color: emp.jenis_kelamin === 'L' ? '#1e40af' : '#9d174d'
                        }}>
                            {emp.jenis_kelamin === 'L' ? 'L' : 'P'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function EmployeeDirectoryAnalytics({ defaultView = 'cards', initialSearchQuery = '' }) {
    const { token, user, isKeraniUser } = useAuth();

    // Kerani locked division
    const keraniDivision = isKeraniUser ? (user?.divisions?.[0] || user?.divisi || null) : null;

    // Filter states - kerani users are locked to their division
    const [division, setDivision] = useState(keraniDivision || 'ALL');
    const [gang, setGang] = useState('');
    const [religion, setReligion] = useState('');
    const [gender, setGender] = useState('');
    const [status, setStatus] = useState('');
    const [searchTerm, setSearchTerm] = useState(initialSearchQuery);

    // Options
    const [availableGangs, setAvailableGangs] = useState([]);
    const [allGangs, setAllGangs] = useState([]);
    const [availableReligions, setAvailableReligions] = useState([]);
    const [availableStatuses, setAvailableStatuses] = useState([]);

    // Data
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    // Data source indicator: 'origin' | 'history'
    const [dataSource, setDataSource] = useState('origin');
    // Force history mode toggle
    const [useHistoryMode, setUseHistoryMode] = useState(false);

    // View: 'table' | 'cards' | 'analytics'
    const [viewMode, setViewMode] = useState(defaultView);

    // NIK search
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const searchTimeout = useRef(null);
    const searchInputRef = useRef(null);
    const searchContainerRef = useRef(null);

    // Load filter options
    useEffect(() => {
        if (!token) return;
        fetchAvailableReligions(token).then(setAvailableReligions);
        fetchAvailableStatuses(token).then(setAvailableStatuses);
        fetchAllGangs(token).then(setAllGangs);
    }, [token]);

    // Handle Initial Search Query
    const initialSearchRan = useRef(false);
    useEffect(() => {
        if (token && initialSearchQuery && !initialSearchRan.current) {
            initialSearchRan.current = true;
            if (searchTimeout.current) clearTimeout(searchTimeout.current);
            setLoading(true);
            searchEmployees(token, initialSearchQuery, 50).then(result => {
                setSearchResults(result.data);
                setEmployees(result.data);
                setDataSource(result.dataSource);
                setShowSearchDropdown(false);
                setHasLoaded(true);
                setLoading(false);
                setViewMode(defaultView);
            }).catch(e => {
                console.error(e);
                setLoading(false);
            });
        }
    }, [token, initialSearchQuery, defaultView]);

    // Load gangs when division changes
    useEffect(() => {
        if (!token || division === 'ALL') {
            setAvailableGangs([]);
            setGang('');
            return;
        }
        fetchGangsByDivision(token, division).then(setAvailableGangs);
        setGang('');
    }, [token, division]);

    // Compute analytics
    const analytics = useMemo(() => employees.length > 0 ? computeAnalytics(employees) : null, [employees]);

    // Compute gang grouping for left panel
    const gangGroups = useMemo(() => {
        if (!analytics) return [];
        return Object.entries(analytics.byGang)
            .sort((a, b) => {
                // Sort by division first, then gang code
                const divA = getDivisionFromGang(a[0]);
                const divB = getDivisionFromGang(b[0]);
                if (divA !== divB) return divA.localeCompare(divB);
                return a[0].localeCompare(b[0]);
            });
    }, [analytics]);

    // Compute religion groups
    const religionGroups = useMemo(() => {
        if (!analytics) return [];
        return Object.entries(analytics.byReligion).sort((a, b) => b[1] - a[1]);
    }, [analytics]);

    // Close search dropdown on outside click
    useEffect(() => {
        function handleClickOutside(e) {
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
                setShowSearchDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // NIK search with debounce
    const handleSearchChange = useCallback((value) => {
        setSearchTerm(value);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);

        if (value.trim().length < 2) {
            setSearchResults([]);
            setShowSearchDropdown(false);
            return;
        }

        searchTimeout.current = setTimeout(async () => {
            const result = await searchEmployees(token, value, 50);
            setSearchResults(result.data);
            setShowSearchDropdown(true);
        }, 300);
    }, [token]);

    // Load employees
    const handleFetch = useCallback(async () => {
        setLoading(true);
        setSearchResults([]);
        setShowSearchDropdown(false);
        try {
            const result = await fetchEmployeesList(token, { division, gang, religion, status, forceHistory: useHistoryMode });
            setEmployees(result.data);
            setDataSource(result.dataSource);
            setHasLoaded(true);
            setViewMode(defaultView);
        } catch (e) {
            console.error(e);
            setEmployees([]);
            setDataSource('origin');
        } finally {
            setLoading(false);
        }
    }, [token, division, gang, religion, status, useHistoryMode]);

    // Search with filters
    const handleFilteredSearch = useCallback(async () => {
        if (searchTerm.trim().length < 2) {
            handleFetch();
            return;
        }
        setLoading(true);
        setSearchResults([]);
        setShowSearchDropdown(false);
        try {
            const result = await searchEmployees(token, searchTerm, 200);
            // Apply client-side filters
            let filtered = result.data;
            if (division && division !== 'ALL') {
                filtered = filtered.filter(e => getDivisionFromGang(e.gang_code) === division);
            }
            if (gang) {
                filtered = filtered.filter(e => (e.gang_code || '').toUpperCase() === gang.toUpperCase());
            }
            if (religion) {
                filtered = filtered.filter(e => (e.religion || '').toUpperCase() === religion.toUpperCase());
            }
            if (gender) {
                filtered = filtered.filter(e => e.jenis_kelamin === gender);
            }
            if (status) {
                filtered = filtered.filter(e => (e.status || '').toUpperCase() === status.toUpperCase());
            }
            setEmployees(filtered);
            setHasLoaded(true);
            setViewMode(defaultView);
        } catch (e) {
            console.error(e);
            setEmployees([]);
        } finally {
            setLoading(false);
        }
    }, [token, searchTerm, division, gang, religion, gender, status, handleFetch]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleFilteredSearch();
    };

    // View profile
    const handleViewProfile = (emp) => {
        const nik = emp.new_nik || emp.actual_nik || emp.nik;
        if (!nik) return;

        // Kerani division check: prevent opening HR info for employees outside their division
        if (isKeraniUser && keraniDivision) {
            const empGang = emp.gang_code || '';
            const empDivision = getDivisionFromGang(empGang);
            if (empDivision !== keraniDivision) {
                alert(`Akses ditolak: Anda hanya dapat melihat profil karyawan dari divisi ${keraniDivision}.`);
                return;
            }
        }

        const params = new URLSearchParams({ nik });
        const path = buildAppPath(`/hr-info?${params.toString()}`);
        window.open(path, '_blank', 'noopener,noreferrer');
    };

    // Select from search dropdown
    const handleSelectFromSearch = (emp) => {
        setSearchTerm('');
        setSearchResults([]);
        setShowSearchDropdown(false);
        setEmployees([emp]);
        setHasLoaded(true);
        setViewMode(defaultView);
    };

    // Clear all filters
    const handleClearFilters = () => {
        // Kerani users are locked to their division
        setDivision(keraniDivision || 'ALL');
        setGang('');
        setReligion('');
        setGender('');
        setStatus('');
        setSearchTerm('');
        setSearchResults([]);
        setShowSearchDropdown(false);
        setEmployees([]);
        setHasLoaded(false);
        setViewMode(defaultView);
        setUseHistoryMode(false);
        setDataSource('origin');
    };

    // Column definitions for AG Grid
    const columnDefs = useMemo(() => [
        { field: 'actual_nik', headerName: 'NIK (KTP)', width: 150, pinned: 'left', cellStyle: { fontSize: '0.8rem' } },
        { field: 'nik', headerName: 'Emp Code', width: 100, cellStyle: { fontSize: '0.8rem', color: '#64748b' } },
        { field: 'nama', headerName: 'Nama Karyawan', flex: 1, minWidth: 180, cellStyle: { fontWeight: '600', fontSize: '0.85rem' } },
        {
            field: 'jenis_kelamin', headerName: 'L/P', width: 60, cellStyle: { textAlign: 'center', fontSize: '0.85rem' },
            cellRenderer: params => {
                const v = params.value;
                return (
                    <span style={{ padding: '2px 6px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', background: v === 'L' ? '#dbeafe' : '#fce7f3', color: v === 'L' ? '#1e40af' : '#9d174d' }}>{v || '-'}</span>
                );
            }
        },
        { field: 'religion', headerName: 'Agama', width: 100, cellStyle: { fontSize: '0.8rem' } },
        {
            field: 'status', headerName: 'Status', width: 90,
            cellRenderer: params => {
                if (!params.value) return '-';
                const v = params.value.trim();
                const isActive = v === '1' || v.toUpperCase() === 'ACTIVE' || v.toUpperCase() === 'A';
                return (
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '600', backgroundColor: isActive ? '#dcfce7' : '#fee2e2', color: isActive ? '#166534' : '#991b1b' }}>
                        {isActive ? 'Aktif' : 'Non-Aktif'}
                    </span>
                );
            }
        },
        { field: 'gang_code', headerName: 'Gang', width: 90, cellStyle: { fontWeight: '600', fontSize: '0.8rem', color: '#1e40af' } },
        {
            field: 'upah_dasar', headerName: 'Upah Dasar', width: 130, type: 'numericColumn',
            cellStyle: { fontSize: '0.8rem', textAlign: 'right' },
            valueFormatter: params => params.value ? 'Rp ' + Number(params.value).toLocaleString('id-ID') : '-'
        },
        { field: 'join_date', headerName: 'Tgl Masuk', width: 100, cellStyle: { fontSize: '0.75rem', color: '#64748b' },
            valueFormatter: params => {
                if (!params.value) return '-';
                try { return new Date(params.value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
                catch { return params.value; }
            }
        },
        {
            headerName: 'Profil HR', width: 110, pinned: 'right',
            cellRenderer: params => (
                <button onClick={() => handleViewProfile(params.data)} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
                    👤 Lihat
                </button>
            )
        }
    ], []);

    // Styles
    const selectStyle = {
        padding: '7px 12px', borderRadius: '6px', border: '1px solid #cbd5e1',
        fontSize: '0.875rem', backgroundColor: 'white', color: '#334155',
        minWidth: '130px', cursor: 'pointer', fontWeight: '500'
    };

    const btnStyle = (active, color = '#3b82f6', bg = '#eff6ff') => ({
        padding: '6px 16px', borderRadius: '6px',
        border: `1px solid ${active ? color : '#cbd5e1'}`,
        background: active ? bg : 'white', color: active ? color : '#64748b',
        cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', transition: 'all 0.15s'
    });

    // ==========================================================================
    // RENDER: Empty State (before load)
    // ==========================================================================
    if (!hasLoaded) {
        return (
            <div style={{ padding: '1.5rem', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc', overflow: 'auto' }}>
                {/* Header */}
                <div style={{ marginBottom: '1.25rem' }}>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                        👥 Sistem Manajemen Karyawan Enterprise
                    </h1>
                    <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
                        Cari karyawan berdasarkan Gang, Agama, atau NIK KTP dengan visualisasi distribusi demografis.
                    </p>
                </div>

                {/* Quick access: Division buttons */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {Object.entries(DIVISION_CONFIG).filter(([k]) => k === 'ALL' || ['PG1A', 'PG2A', 'AB1', 'AB2', 'IJL', 'ARC', 'DME', 'INF', 'MILL'].includes(k)).map(([code, cfg]) => (
                        <button
                            key={code}
                            onClick={() => { setDivision(code); setTimeout(handleFetch, 50); }}
                            disabled={loading}
                            style={{
                                padding: '6px 14px', borderRadius: '6px',
                                border: `1px solid ${cfg.border}`,
                                background: loading ? '#f1f5f9' : cfg.bg,
                                color: loading ? '#94a3b8' : cfg.color,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                fontSize: '0.8rem', fontWeight: '600', transition: 'all 0.15s'
                            }}
                        >
                            {cfg.label}
                        </button>
                    ))}
                </div>

                {/* Empty state card */}
                <div style={{ flex: 1, background: 'white', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0', padding: '3rem', minHeight: '400px' }}>
                    <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>👥</div>
                    <h3 style={{ color: '#334155', marginBottom: '0.5rem' }}>Manajemen Karyawan Terpusat</h3>
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', maxWidth: '480px', marginBottom: '1.5rem', lineHeight: '1.6' }}>
                        Pilih divisi di atas atau gunakan filter untuk menampilkan data karyawan.
                        Anda dapat melihat data dalam <strong>Tampilan Kartu</strong> yang intuitif, <strong>Tabel AG Grid</strong>, atau <strong>Analisis Distribusi</strong>.
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '1rem' }}>
                        <button
                            onClick={() => { setDivision('ALL'); setTimeout(handleFetch, 100); }}
                            disabled={loading}
                            style={{ padding: '10px 24px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.9rem' }}
                        >
                            {loading ? '⏳ Memuat...' : '📋 Lihat Semua Karyawan'}
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {['PG1A', 'PG1B', 'PG2A', 'PG2B', 'AB1', 'AB2', 'IJL'].map(d => (
                            <button
                                key={d}
                                onClick={() => { setDivision(d); setTimeout(handleFetch, 100); }}
                                disabled={loading}
                                style={{ padding: '8px 16px', background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.8rem' }}
                            >
                                {d}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================================================
    // RENDER: Main View (after load)
    // ==========================================================================
    return (
        <div style={{ padding: '1.25rem', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc', overflow: 'hidden' }}>

            {/* Top Header */}
            <div style={{ marginBottom: '1rem', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <div>
                        <h1 style={{ fontSize: '1.35rem', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                            👥 Manajemen Karyawan Enterprise
                            {division !== 'ALL' && (
                                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: DIVISION_CONFIG[division]?.color || '#64748b', marginLeft: '0.5rem' }}>
                                    · {DIVISION_CONFIG[division]?.label || division}
                                </span>
                            )}
                        </h1>
                        <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '2px 0 0' }}>
                            {employees.length.toLocaleString('id-ID')} karyawan
                            {gang && <span> · Gang <strong>{gang}</strong></span>}
                            {religion && <span> · <strong>{religion}</strong></span>}
                            {gender && <span> · {gender === 'L' ? 'Laki-laki' : 'Perempuan'}</span>}
                        </p>
                    </div>
                    {/* View mode toggle & Action Buttons */}
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {/* Data Source Indicator */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                                padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700',
                                background: dataSource === 'history' ? '#fef3c7' : '#dcfce7',
                                color: dataSource === 'history' ? '#92400e' : '#166534',
                                border: `1px solid ${dataSource === 'history' ? '#fcd34d' : '#86efac'}`,
                                display: 'flex', alignItems: 'center', gap: '4px'
                            }}>
                                <span>{dataSource === 'history' ? '📜' : '🗄️'}</span>
                                <span>{dataSource === 'history' ? 'HISTORY DB' : 'ORIGIN DB'}</span>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#64748b', userSelect: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={useHistoryMode}
                                    onChange={(e) => setUseHistoryMode(e.target.checked)}
                                    style={{ cursor: 'pointer', width: '14px', height: '14px' }}
                                />
                                Force History
                            </label>
                        </div>
                        <button
                            onClick={() => alert('Fitur penambahan karyawan baru sedang dalam tahap sinkronisasi dengan ERP Pusat. Silakan hubungi Administrator HR untuk bantuan.')}
                            style={{
                                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                color: 'white', border: 'none', padding: '6px 14px', borderRadius: '8px',
                                fontWeight: '600', fontSize: '0.85rem', cursor: 'pointer',
                                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
                            }}
                        >
                            ➕ Tambah Karyawan
                        </button>
                        <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                            <button onClick={() => setViewMode('cards')} style={{ ...btnStyle(viewMode === 'cards', '#0f172a', '#f1f5f9'), borderRadius: 0, borderRight: '1px solid #e2e8f0', padding: '6px 14px' }}>🃏 Kartu</button>
                            <button onClick={() => setViewMode('table')} style={{ ...btnStyle(viewMode === 'table', '#0f172a', '#f1f5f9'), borderRadius: 0, borderRight: '1px solid #e2e8f0', padding: '6px 14px' }}>📋 Tabel</button>
                            <button onClick={() => setViewMode('analytics')} style={{ ...btnStyle(viewMode === 'analytics', '#0f172a', '#f1f5f9'), borderRadius: 0, padding: '6px 14px' }}>📊 Analisis</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter Bar */}
            <div style={{ backgroundColor: 'white', padding: '0.875rem 1rem', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0', marginBottom: '0.75rem', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
                    <span style={{ color: '#64748b', fontWeight: '600', fontSize: '0.75rem', minWidth: '45px' }}>🔍 Filter:</span>

                    {/* Division Filter - Hidden for kerani users (locked to their division) */}
                    {!isKeraniUser && (
                        <select value={division} onChange={e => setDivision(e.target.value)} style={selectStyle}>
                            {Object.entries(DIVISION_CONFIG).map(([code, cfg]) => (
                                <option key={code} value={code}>{cfg.label}</option>
                            ))}
                        </select>
                    )}
                    {isKeraniUser && keraniDivision && (
                        <span style={{
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                            padding: '0.3rem 0.75rem',
                            borderRadius: '6px',
                            fontSize: '0.78rem',
                            fontWeight: '600',
                            border: '1px solid #fcd34d'
                        }}>
                            Divisi: {keraniDivision}
                        </span>
                    )}

                    <select
                        value={gang} onChange={e => setGang(e.target.value)}
                        style={{ ...selectStyle, minWidth: '140px' }}
                        disabled={division === 'ALL' || availableGangs.length === 0}
                    >
                        <option value="">Semua Gang</option>
                        {availableGangs.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>

                    <select value={religion} onChange={e => setReligion(e.target.value)} style={selectStyle}>
                        <option value="">Semua Agama</option>
                        {availableReligions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>

                    <select value={gender} onChange={e => setGender(e.target.value)} style={selectStyle}>
                        <option value="">Semua Gender</option>
                        <option value="L">Laki-laki (L)</option>
                        <option value="P">Perempuan (P)</option>
                    </select>

                    <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
                        <option value="">Semua Status</option>
                        {availableStatuses.map(s => {
                            const isActive = s === '1' || s.toUpperCase() === 'ACTIVE' || s.toUpperCase() === 'A';
                            return <option key={s} value={s}>{isActive ? `Aktif (${s})` : `Non-Aktif (${s})`}</option>;
                        })}
                    </select>
                </div>

                {/* Search Row */}
                <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
                    {/* NIK Search with autocomplete */}
                    <div style={{ flex: 1, position: 'relative' }} ref={searchContainerRef}>
                        <span style={{ position: 'absolute', left: '10px', top: '8px', fontSize: '1rem' }}>🔍</span>
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchTerm}
                            onChange={e => handleSearchChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={() => searchResults.length > 0 && setShowSearchDropdown(true)}
                            placeholder="Ketik NIK KTP, Emp Code, atau Nama... (minimal 2 karakter)"
                            style={{
                                width: '100%', padding: '8px 8px 8px 34px', borderRadius: '6px',
                                border: '1px solid #cbd5e1', fontSize: '0.875rem', outline: 'none',
                                transition: 'border-color 0.15s'
                            }}
                            onFocusCapture={e => e.currentTarget.style.borderColor = '#3b82f6'}
                            onBlurCapture={e => e.currentTarget.style.borderColor = '#cbd5e1'}
                        />
                        {showSearchDropdown && (
                            <NikSearchDropdown
                                results={searchResults}
                                onSelect={handleSelectFromSearch}
                                onClose={() => setShowSearchDropdown(false)}
                            />
                        )}
                    </div>

                    <button onClick={handleFilteredSearch} disabled={loading}
                        style={{ padding: '8px 18px', backgroundColor: '#0f172a', color: 'white', border: 'none', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                        {loading ? '⏳' : '🔍'} {loading ? 'Memuat...' : 'Cari'}
                    </button>

                    <button onClick={handleFetch} disabled={loading}
                        style={{ padding: '8px 14px', backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                        ↻ Tampilkan
                    </button>

                    <button onClick={handleClearFilters}
                        style={{ padding: '8px 14px', backgroundColor: 'white', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                        ✕ Reset
                    </button>
                </div>

                {/* Active filter chips */}
                {(gang || religion || gender || status || searchTerm) && (
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                        {gang && <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: '600', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', cursor: 'pointer' }} onClick={() => setGang('')}>Gang: {gang} ✕</span>}
                        {religion && <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: '600', background: '#faf5ff', border: '1px solid #e9d5ff', color: '#7e22ce', cursor: 'pointer' }} onClick={() => setReligion('')}>Agama: {religion} ✕</span>}
                        {gender && <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: '600', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', cursor: 'pointer' }} onClick={() => setGender('')}>Gender: {gender} ✕</span>}
                        {status && <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: '600', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', cursor: 'pointer' }} onClick={() => setStatus('')}>Status: {status} ✕</span>}
                    </div>
                )}
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {employees.length === 0 ? (
                    <div style={{ flex: 1, background: 'white', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0', padding: '3rem' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                        <h3 style={{ color: '#334155', marginBottom: '0.5rem' }}>Tidak ada karyawan ditemukan</h3>
                        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Coba ubah filter pencarian.</p>
                    </div>
                ) : viewMode === 'analytics' && analytics ? (
                    // ==========================================================
                    // ANALYTICS VIEW
                    // ==========================================================
                    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '2px' }}>
                        {/* KPI Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.625rem' }}>
                            <KPICard title="Total Karyawan" value={analytics.total} icon="👥" accent="blue" />
                            <KPICard title="Laki-laki" value={analytics.maleCount} icon="♂" accent="blue" subtitle={`${analytics.total > 0 ? ((analytics.maleCount / analytics.total) * 100).toFixed(1) : 0}%`} />
                            <KPICard title="Perempuan" value={analytics.femaleCount} icon="♀" accent="pink" subtitle={`${analytics.total > 0 ? ((analytics.femaleCount / analytics.total) * 100).toFixed(1) : 0}%`} />
                            <KPICard title="Karyawan Aktif" value={analytics.activeCount} icon="✓" accent="green" subtitle={`${analytics.total > 0 ? ((analytics.activeCount / analytics.total) * 100).toFixed(1) : 0}%`} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.625rem' }}>
                            <KPICard title="Rata-rata Usia" value={`${analytics.avgAge} Th`} icon="🎂" accent="purple" subtitle={`${analytics.knownAgeCount} data`} />
                            <KPICard title="Rata-rata Masa Kerja" value={`${analytics.avgSeniority} Th`} icon="📅" accent="teal" subtitle={`${analytics.knownSeniorityCount} data`} />
                            <KPICard title="Jumlah Agama" value={Object.keys(analytics.byReligion).length} icon="🕌" accent="orange" />
                            <KPICard title="Jumlah Gang" value={Object.keys(analytics.byGang).length} icon="🏘️" accent="gray" />
                        </div>

                        {/* Religion + Division + Gang charts */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.625rem' }}>
                            <HBarChart data={analytics.byReligion} title="📊 Distribusi Agama" barColor="#8b5cf6" maxItems={8} />
                            <HBarChart data={analytics.byDivision} title="📊 Distribusi Divisi" barColor="#3b82f6" maxItems={10} />
                            <HBarChart data={analytics.topGangs} title="📊 Top 10 Gang" barColor="#f59e0b" maxItems={10} />
                        </div>

                        {/* Age + Seniority + Gaji */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.625rem' }}>
                            <HBarChart data={analytics.ageGroups} title="📊 Distribusi Usia" barColor="#10b981" maxItems={9} />
                            <HBarChart data={analytics.seniorityGroups} title="📊 Distribusi Masa Kerja" barColor="#06b6d4" maxItems={6} />
                            <HBarChart data={analytics.gajiGroups} title="📊 Distribusi Upah Dasar" barColor="#ef4444" maxItems={6} />
                        </div>

                        {/* Religion detailed table */}
                        <div style={{ background: 'white', borderRadius: '12px', padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
                            <h3 style={{ fontSize: '0.875rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.75rem' }}>📋 Ringkasan per Agama</h3>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc' }}>
                                            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: '600', borderBottom: '2px solid #e2e8f0' }}>Agama</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b', fontWeight: '600', borderBottom: '2px solid #e2e8f0' }}>Jumlah</th>
                                            <th style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b', fontWeight: '600', borderBottom: '2px solid #e2e8f0' }}>%</th>
                                            <th style={{ padding: '8px 12px' }}>Distribusi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(analytics.byReligion).sort((a, b) => b[1] - a[1]).map(([rel, count]) => {
                                            const cfg = getReligionConfig(rel);
                                            return (
                                                <tr key={rel} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '8px 12px' }}>
                                                        <span style={{ fontSize: '0.9rem', marginRight: '4px' }}>{cfg.icon}</span>
                                                        <span style={{ fontWeight: '500', color: '#334155' }}>{rel}</span>
                                                    </td>
                                                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: '700', color: '#1e293b' }}>{count}</td>
                                                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{((count / analytics.total) * 100).toFixed(1)}%</td>
                                                    <td style={{ padding: '8px 12px' }}>
                                                        <div style={{ background: '#f1f5f9', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${(count / analytics.total) * 100}%`, background: cfg.border, height: '100%', borderRadius: '4px' }} />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Gang-by-religion cross table */}
                        <div style={{ background: 'white', borderRadius: '12px', padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' }}>
                            <h3 style={{ fontSize: '0.875rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.75rem' }}>📊 Gang × Agama</h3>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc' }}>
                                            <th style={{ padding: '6px 10px', textAlign: 'left', color: '#64748b', fontWeight: '600', borderBottom: '2px solid #e2e8f0' }}>Gang</th>
                                            <th style={{ padding: '6px 10px', textAlign: 'right', color: '#64748b', fontWeight: '600', borderBottom: '2px solid #e2e8f0' }}>Total</th>
                                            {Object.keys(analytics.byReligion).slice(0, 6).map(r => {
                                                const cfg = getReligionConfig(r);
                                                return <th key={r} style={{ padding: '6px 10px', textAlign: 'center', color: cfg.text, fontWeight: '600', borderBottom: '2px solid #e2e8f0' }}>{cfg.icon}</th>;
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {gangGroups.slice(0, 20).map(([gangCode, gangCount]) => {
                                            const gangEmps = employees.filter(e => (e.gang_code || '') === gangCode);
                                            return (
                                                <tr key={gangCode} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                    <td style={{ padding: '6px 10px', fontWeight: '600', color: '#1e40af' }}>{gangCode}</td>
                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '700' }}>{gangCount}</td>
                                                    {Object.keys(analytics.byReligion).slice(0, 6).map(rel => {
                                                        const cnt = gangEmps.filter(e => (e.religion || '') === rel).length;
                                                        return (
                                                            <td key={rel} style={{ padding: '6px 10px', textAlign: 'center', color: cnt > 0 ? '#334155' : '#cbd5e8', fontWeight: cnt > 0 ? '600' : '400' }}>
                                                                {cnt > 0 ? cnt : '-'}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : viewMode === 'cards' ? (
                    // ==========================================================
                    // CARDS VIEW (default)
                    // ==========================================================
                    <div style={{ flex: 1, display: 'flex', gap: '0.75rem', overflow: 'hidden' }}>
                        {/* Left: Gang Groups */}
                        <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                <span style={{ fontWeight: '700', fontSize: '0.8rem', color: '#1e293b' }}>🏘️ Grup Gang</span>
                                <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>{gangGroups.length} gangs</span>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.375rem', paddingRight: '2px' }}>
                                {/* Religion breakdown */}
                                <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '0.625rem', border: '1px solid #e2e8f0', marginBottom: '0.25rem' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#64748b', marginBottom: '0.375rem' }}>🕌 AGAMA</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                                        {religionGroups.slice(0, 6).map(([rel, count]) => {
                                            const cfg = getReligionConfig(rel);
                                            return (
                                                <div
                                                    key={rel}
                                                    onClick={() => setReligion(religion === rel ? '' : rel)}
                                                    style={{
                                                        padding: '4px 6px', borderRadius: '6px', cursor: 'pointer',
                                                        background: religion === rel ? cfg.bg : 'white',
                                                        border: `1px solid ${religion === rel ? cfg.border : '#e2e8f0'}`,
                                                        transition: 'all 0.15s'
                                                    }}
                                                    title={rel}
                                                >
                                                    <div style={{ fontSize: '0.6rem' }}>{cfg.icon} {rel.length > 6 ? rel.substring(0, 5) + '…' : rel}</div>
                                                    <div style={{ fontSize: '0.7rem', fontWeight: '700', color: cfg.text }}>{count}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Gang list */}
                                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                                    {gangGroups.map(([gangCode, count]) => {
                                        const gangEmps = employees.filter(e => (e.gang_code || '') === gangCode);
                                        const div = getDivisionFromGang(gangCode);
                                        const divCfg = DIVISION_CONFIG[div] || DIVISION_CONFIG.OTHER;
                                        return (
                                            <GangGroupCard
                                                key={gangCode}
                                                gangCode={gangCode}
                                                count={count}
                                                employees={gangEmps}
                                                active={gang === gangCode}
                                                divisionConfig={divCfg}
                                                onClick={() => setGang(gang === gangCode ? '' : gangCode)}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Right: Employee cards grid */}
                        <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.625rem', alignContent: 'start', paddingRight: '2px' }}>
                            {employees.map((emp, idx) => (
                                <EmployeeCard key={`${emp.nik}-${idx}`} emp={emp} onViewProfile={handleViewProfile} />
                            ))}
                        </div>
                    </div>
                ) : (
                    // ==========================================================
                    // TABLE VIEW
                    // ==========================================================
                    <div style={{ flex: 1, backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div className="ag-theme-alpine" style={{ height: '100%', width: '100%' }}>
                                <AgGridWrapper
                                    rowData={employees}
                                    columnDefs={columnDefs}
                                    height="100%"
                                    pagination={true}
                                    paginationPageSize={50}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
