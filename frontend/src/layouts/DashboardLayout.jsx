import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import { getBasePath, isProdMode } from '../utils/prodModeUtils';
import {
    Home, FileText, BarChart2, DollarSign, TrendingUp, Users,
    Settings, ChevronRight, LogOut, ShieldCheck,
    PieChart, Menu, X, Database, CalendarDays, ChevronDown, ChevronUp,
    Wallet, Scale, Activity
} from 'lucide-react';

// ─── Design System: Estate Ledger ────────────────────────────────────────────
// Aesthetic: editorial ledger, flat surfaces, satu aksen daun
// Typography: Sora display + Inter body (loaded in index.html)
// Color: sidebar flat forest (C.leafDark) + topbar paper hairline + page canvas
// SSOT warna: reportTheme (mirror tokens.css)

import { C } from '../components/report/reportTheme';

// ─── Sidebar tokens (turunan dari SSOT reportTheme) ──────────────────────────
const SIDEBAR = {
    bg:          C.leafDark,                 // Flat forest, tanpa gradient
    hover:       'rgba(255,255,255,0.08)',   // Hover biasa: sedikit lebih terang
    active:      'rgba(31,111,67,0.5)',      // Item aktif: aksen daun (C.leafMid)
    activeBar:   C.leafLight,                // Left accent bar on active
    border:      'rgba(255,255,255,0.10)',
    text:        'rgba(226,240,231,0.62)',
    textBright:  '#F0F9F2',
    section:     'rgba(140,190,156,0.55)',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// ponytail: runtime API base toggle (direct 8002 vs proxy relative).
//  Upgrade: pindah ke settings page + persist per-user di backend kalau perlu multi-user preset.
function ApiBaseToggle() {
    const [mode, setMode] = useState(() => {
        try { return window.localStorage?.getItem('api_base_mode') || 'proxy' } catch { return 'proxy' }
    })
    const toggle = () => {
        const next = mode === 'direct' ? 'proxy' : 'direct'
        try { window.localStorage?.setItem('api_base_mode', next) } catch { /* ignore */ }
        setMode(next)
        // reload supaya httpSetup.js re-eval axios.defaults.baseURL
        window.location.reload()
    }
    return (
        <button
            onClick={toggle}
            title={mode === 'direct' ? 'API base: DIRECT (localhost:8002). Klik → PROXY' : 'API base: PROXY (relative). Klik → DIRECT'}
            style={{
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                backgroundColor: mode === 'direct' ? 'rgba(179, 57, 46, 0.10)' : 'rgba(31, 111, 67, 0.10)',
                border: `1px solid ${mode === 'direct' ? 'rgba(179,57,46,0.35)' : 'rgba(31,111,67,0.35)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '0.3rem 0.6rem',
                fontSize: '0.7rem',
                color: mode === 'direct' ? C.potongan : C.upah,
                fontWeight: '600',
                cursor: 'pointer',
                flexShrink: 0,
            }}
        >
            <Database size={12} />
            <span>{mode === 'direct' ? 'DIRECT' : 'PROXY'}</span>
        </button>
    )
}

function TopBar({ user, collapsed, onToggle, periodDisplay }) {
    return (
        <div className="no-print" style={{
            height: '56px',
            backgroundColor: C.cream,
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 1.25rem',
            gap: '1rem',
            flexShrink: 0,
            zIndex: 30,
            position: 'relative',
        }}>
            {/* Sidebar Toggle */}
            <button
                onClick={onToggle}
                style={{
                    width: '36px', height: '36px',
                    backgroundColor: 'transparent',
                    border: `1px solid ${C.border}`,
                    borderRadius: 'var(--radius-sm)',
                    color: C.muted,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-paper-2)'; e.currentTarget.style.color = C.upah; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = C.muted; }}
                title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
                {collapsed ? <Menu size={18} /> : <X size={18} />}
            </button>

            {/* Divider */}
            <div style={{ width: '1px', height: '28px', backgroundColor: C.border }} />

            {/* Company Branding */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
                <img
                    src={`${getBasePath()}/images/rebinmas.webp`}
                    alt="PT Rebinmas Jaya"
                    style={{ height: '28px', display: 'block' }}
                />
                {!collapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: '700', color: C.text, letterSpacing: '0.02em', fontFamily: 'var(--font-display)' }}>
                            PT REBINMAS JAYA
                        </span>
                        <span style={{ fontSize: '0.65rem', color: C.muted, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            Portal Estate · Payroll
                        </span>
                    </div>
                )}
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Header Actions Portal Target */}
            <div id="header-actions-portal" style={{ display: 'flex', alignItems: 'center' }}></div>

            {/* API Base Toggle (DIRECT 8002 ↔ PROXY), dev only */}
            {!isProdMode() && <ApiBaseToggle />}

            {/* Period Badge */}
            {periodDisplay && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    backgroundColor: 'rgba(31, 111, 67, 0.08)',
                    border: '1px solid rgba(31, 111, 67, 0.28)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.75rem',
                    color: C.upah,
                    fontWeight: '600',
                }}>
                    <CalendarDays size={14} />
                    <span>{periodDisplay}</span>
                </div>
            )}

            {/* Divider */}
            <div style={{ width: '1px', height: '28px', backgroundColor: C.border }} />

            {/* User Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: C.text }}>
                        {user?.username}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {user?.role || 'Staff'}
                    </span>
                </div>
                {/* Avatar Circle, flat leaf accent */}
                <div style={{
                    width: '34px', height: '34px',
                    background: C.leafMid,
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8rem', fontWeight: '700', color: '#fff',
                    flexShrink: 0,
                    border: `2px solid ${C.leafLight}`,
                }}>
                    {user?.username ? user.username.charAt(0).toUpperCase() : 'U'}
                </div>
            </div>
        </div>
    );
}

function CollapsibleSection({ title, children, defaultOpen = true, collapsed }) {
    const [open, setOpen] = useState(defaultOpen);
    const location = useLocation();

    // Auto-open if any child is active
    const hasActiveChild = React.useMemo(() => {
        return false; // Simplified - always respect manual toggle
    }, []);

    return (
        <div style={{ marginBottom: '0.25rem' }}>
            {title && (
                <button
                    onClick={() => setOpen(!open)}
                    style={{
                        width: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: collapsed ? '0.5rem 0' : '0.5rem 0.75rem',
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: SIDEBAR.section,
                        fontSize: '0.62rem',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        transition: 'color 0.15s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.color = SIDEBAR.textBright}
                    onMouseOut={(e) => e.currentTarget.style.color = SIDEBAR.section}
                >
                    {!collapsed && <span>{title}</span>}
                    {!collapsed && (
                        open ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    )}
                </button>
            )}
            {open && children}
        </div>
    );
}

function NavItem({ to, icon: Icon, label, description, end = false, collapsed }) {
    const location = useLocation();
    const isActive = end
        ? location.pathname === to
        : location.pathname.startsWith(to);

    return (
        <NavLink
            to={to}
            end={end}
            style={{
                display: 'flex',
                alignItems: collapsed ? 'center' : 'flex-start',
                gap: '0.625rem',
                padding: collapsed ? '0.625rem 0' : '0.55rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                textDecoration: 'none',
                transition: 'all 0.15s',
                backgroundColor: isActive ? SIDEBAR.active : 'transparent',
                color: isActive ? SIDEBAR.textBright : SIDEBAR.text,
                borderLeft: isActive ? '3px solid ' + SIDEBAR.activeBar : '3px solid transparent',
                marginBottom: '2px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                fontFamily: 'var(--font-body)',
            }}
            title={collapsed ? label : ''}
            onMouseOver={(e) => {
                if (!isActive) {
                    e.currentTarget.style.backgroundColor = SIDEBAR.hover;
                    e.currentTarget.style.color = SIDEBAR.textBright;
                }
            }}
            onMouseOut={(e) => {
                if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = SIDEBAR.text;
                }
            }}
        >
            <div style={{ flexShrink: 0, marginTop: collapsed ? 0 : '1px', opacity: isActive ? 1 : 0.85 }}>
                <Icon size={18} />
            </div>
            {!collapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{
                        fontSize: '0.85rem', fontWeight: isActive ? '600' : '500',
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>
                        {label}
                    </span>
                    {description && (
                        <span style={{
                            fontSize: '0.65rem', color: 'rgba(140,190,156,0.5)', marginTop: '2px',
                            lineHeight: 1.3, display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                        }}>
                            {description}
                        </span>
                    )}
                </div>
            )}
        </NavLink>
    );
}

// ─── Main Layout ─────────────────────────────────────────────────────────────
const DashboardLayout = () => {
    const { user, logout, isKeraniUser } = useAuth();
    const { isAdminUser } = useReport();
    const navigate = useNavigate();
    const location = useLocation();

    const [collapsed, setCollapsed] = useState(false);
    const [reportsOpen, setReportsOpen] = useState(false);

    const basePath = getBasePath();
    const autoCloseTimerRef = useRef(null);

    // Auto-close sidebar after 10 seconds of inactivity
    useEffect(() => {
        const sidebar = document.querySelector('[data-sidebar]');
        if (!sidebar) return;

        const clearAutoClose = () => {
            if (autoCloseTimerRef.current) {
                clearTimeout(autoCloseTimerRef.current);
                autoCloseTimerRef.current = null;
            }
        };

        const startAutoClose = () => {
            if (collapsed) return;
            clearAutoClose();
            autoCloseTimerRef.current = setTimeout(() => {
                setCollapsed(true);
            }, 10000);
        };

        // Start timer when sidebar is expanded
        startAutoClose();

        // Reset timer on any sidebar interaction
        sidebar.addEventListener('mouseenter', startAutoClose);
        sidebar.addEventListener('mousemove', startAutoClose);
        sidebar.addEventListener('click', startAutoClose);

        return () => {
            clearAutoClose();
            sidebar.removeEventListener('mouseenter', startAutoClose);
            sidebar.removeEventListener('mousemove', startAutoClose);
            sidebar.removeEventListener('click', startAutoClose);
        };
    }, [collapsed]);

    // Close reports menu if sidebar collapses
    useEffect(() => {
        if (collapsed) setReportsOpen(false);
    }, [collapsed]);

    // Auto-expand reports if on a reports page
    useEffect(() => {
        const reportsPaths = ['/summary', '/wages', '/comprehensive', '/report-pajak', '/analysis', '/tonase-analysis', '/executive', '/impact'];
        const isReports = reportsPaths.some(p => location.pathname.includes(p));
        setReportsOpen(isReports);
    }, [location.pathname]);

    const sidebarWidth = collapsed ? '72px' : '248px';

    // ─── Navigation Config ─────────────────────────────────────────────────────
    // indent: true = item disembunyikan dari user kerani (lihat filter di render loop);
    // pertahankan flag ini pada semua item report agar visibilitas kerani tidak berubah.
    // Sidebar sengaja ramping; report lanjutan lainnya diakses dari panel di Dashboard.
    const navItems = [
        { section: 'Utama', items: [
            { to: '/', icon: Home, label: 'Dashboard', description: 'Ringkasan & metrik', end: true },
        ]},
        { section: 'Analisis Utama', items: [
            { to: '/executive', icon: TrendingUp, label: 'Executive Analysis', description: 'Analisis eksekutif', indent: true },
            { to: '/salary-analysis', icon: Wallet, label: 'Analisis Gaji', description: 'Roster & komponen gaji', indent: true },
            { to: '/tonase-analysis', icon: Scale, label: 'Analisis Tonase', description: 'Tonase, HK, premi panen', indent: true },
            { to: '/cost-per-ton-story', icon: BarChart2, label: 'Cost/Ton Story', description: 'Infografis biaya per ton', indent: true },
            { to: '/comprehensive', icon: PieChart, label: 'Analisis Payroll', description: 'Breakdown komponen upah', parent: true },
            { to: '/productivity', icon: Activity, label: 'Produktivitas', description: 'Tonase vs upah', indent: true },
        ]},
        { section: 'Laporan Keuangan', items: [
            { to: '/wages-rebinmas', icon: DollarSign, label: 'Wages Rebinmas', description: 'Upah Rebinmas saat ini', indent: true },
            { to: '/wages-rebinmas?mode=comparison', icon: ShieldCheck, label: 'Wages Comparison', description: 'Perbandingan upah', indent: true },
            { to: '/wages-ijl', icon: DollarSign, label: 'Wages IJL', description: 'Upah IJL', indent: true },
            { to: '/summary', icon: BarChart2, label: 'Summary Report', description: 'Rekap per divisi', indent: true },
            { to: '/wages-comparison', icon: BarChart2, label: 'Summary Comparison', description: 'Perbandingan ringkasan', indent: true },
        ]},
        { section: 'Operasional', items: [
            { to: '/operational', icon: FileText, label: 'Daftar Upah', description: 'Filter upah operasional' },
            { to: '/pendapatan-tidak-tetap', icon: DollarSign, label: 'Pendapatan Lain', description: 'Pendapatan tidak tetap' },
            { to: '/mill-production', icon: BarChart2, label: 'Produktivitas Kebun', description: 'Tonase FFB, HK & biaya' },
            { to: '/report-pajak', icon: FileText, label: 'Report Pajak (PPh21)', description: 'Laporan pajak', indent: true },
        ]},
    ];

    const adminItems = { section: 'Admin', items: [
        { to: '/seed', icon: Settings, label: 'Aggregation Seeder', description: 'Re-aggregation data manual' },
        { to: '/spreadsheet-sync', icon: Database, label: 'Spreadsheet Sync', description: 'Sinkronisasi spreadsheet' },
        { to: '/employee-directory', icon: Users, label: 'HR Employee Directory', description: 'Database HR' },
        { to: '/test/components', icon: Settings, label: 'Lainnya', description: 'Routing sementara' },
    ]};

    const isReportsPathActive = [
        '/summary', '/wages', '/comprehensive', '/report-pajak',
        '/analysis', '/tonase-analysis', '/executive', '/impact'
    ].some(p => location.pathname.includes(p));

    const isAdminPath = ['/seed', '/spreadsheet-sync', '/employee-directory', '/test'].some(p =>
        location.pathname.startsWith(p)
    );

    return (
        <div className="dashboard-layout-root" style={{
            display: 'flex',
            height: '100vh',
            width: '100vw',
            backgroundColor: C.pageBg,
            fontFamily: 'var(--font-body)',
            overflow: 'hidden',
            color: 'var(--color-ink)',
        }}>
            {/* Backdrop for mobile */}
            <div
                className="no-print"
                onClick={() => setCollapsed(true)}
                style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: collapsed ? 'rgba(0,0,0,0)' : 'rgba(14,35,24,0.5)',
                    zIndex: 15,
                    backdropFilter: collapsed ? 'none' : 'blur(2px)',
                    WebkitBackdropFilter: collapsed ? 'none' : 'blur(2px)',
                    cursor: collapsed ? 'default' : 'pointer',
                    pointerEvents: collapsed ? 'none' : 'auto',
                    transition: 'background-color 0.3s, backdrop-filter 0.3s',
                    display: 'none', // Hidden on desktop, shown via media query if needed
                }}
            />

            {/* ─── SIDEBAR ─────────────────────────────────────────────────── */}
            <div data-sidebar className="no-print" style={{
                width: sidebarWidth,
                height: '100%',
                background: SIDEBAR.bg,
                display: 'flex',
                flexDirection: 'column',
                zIndex: 20,
                boxShadow: '2px 0 8px rgba(21,33,26,0.18)',
                transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                flexShrink: 0,
            }}>
                {/* Collapsed Logo */}
                {collapsed && (
                    <div style={{
                        height: '56px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderBottom: `1px solid ${SIDEBAR.border}`,
                        padding: '0 0.75rem',
                    }}>
                        <img
                            src={`${basePath}/images/rebinmas.webp`}
                            alt="PT Rebinmas Jaya"
                            style={{ height: '26px', display: 'block' }}
                        />
                    </div>
                )}

                {/* Sidebar Nav */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto', overflowX: 'hidden',
                    padding: '0.75rem 0.5rem',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(94,156,123,0.35) transparent',
                }}>
                    {/* Nav Sections */}
                    {navItems.map((section) => (
                        <CollapsibleSection key={section.section} title={section.section} collapsed={collapsed}>
                            {section.items.map((item) => {
                                // Skip kerani-restricted items
                                if (!isKeraniUser || !item.indent) {
                                    const Icon = item.icon;
                                    return (
                                        <NavItem
                                            key={item.to}
                                            to={item.to}
                                            icon={Icon}
                                            label={item.label}
                                            description={item.description}
                                            end={item.end}
                                            collapsed={collapsed}
                                        />
                                    );
                                }
                                return null;
                            })}
                        </CollapsibleSection>
                    ))}

                    {/* Admin Section */}
                    {isAdminUser && (
                        <CollapsibleSection title="Admin" collapsed={collapsed}>
                            {adminItems.items.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <NavItem
                                        key={item.to}
                                        to={item.to}
                                        icon={Icon}
                                        label={item.label}
                                        description={item.description}
                                        collapsed={collapsed}
                                    />
                                );
                            })}
                        </CollapsibleSection>
                    )}
                </div>

                {/* Sidebar Footer */}
                <div style={{
                    borderTop: `1px solid ${SIDEBAR.border}`,
                    padding: collapsed ? '0.75rem 0.5rem' : '0.75rem',
                    backgroundColor: 'rgba(10,26,17,0.6)',
                }}>
                    {/* Logout Button */}
                    <button
                        onClick={logout}
                        title="Logout"
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: collapsed ? 'center' : 'flex-start',
                            gap: '0.5rem',
                            padding: collapsed ? '0.5rem' : '0.5rem 0.75rem',
                            backgroundColor: 'transparent',
                            border: `1px solid ${SIDEBAR.border}`,
                            borderRadius: 'var(--radius-md)',
                            color: 'rgba(226,240,231,0.6)',
                            fontSize: '0.8rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.borderColor = C.potongan;
                            e.currentTarget.style.color = '#F2B8B3';
                            e.currentTarget.style.backgroundColor = 'rgba(179, 57, 46, 0.14)';
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.borderColor = SIDEBAR.border;
                            e.currentTarget.style.color = 'rgba(226,240,231,0.6)';
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                    >
                        <LogOut size={16} />
                        {!collapsed && <span>Logout</span>}
                    </button>

                    {/* Version */}
                    {!collapsed && (
                        <div style={{
                            textAlign: 'center',
                            marginTop: '0.5rem',
                            fontSize: '0.6rem',
                            color: 'rgba(140,190,156,0.45)',
                            letterSpacing: '0.02em',
                        }}>
                            Portal Estate v2.0
                        </div>
                    )}
                </div>
            </div>

            {/* ─── MAIN AREA ────────────────────────────────────────────────── */}
            <div className="dashboard-layout-main" style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minWidth: 0,
            }}>
                {/* Top Bar */}
                <TopBar
                    user={user}
                    collapsed={collapsed}
                    onToggle={() => setCollapsed(!collapsed)}
                    periodDisplay={null}
                />

                {/* Content - key forces Outlet remount on navigation, fixing stuck UI bug */}
                <div className="dashboard-layout-content print-content-area" style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                }}>
                    <Outlet key={location.pathname} />
                </div>
            </div>
        </div>
    );
};

export default DashboardLayout;
