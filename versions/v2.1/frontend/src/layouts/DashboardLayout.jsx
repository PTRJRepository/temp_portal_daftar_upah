import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import { getBasePath } from '../utils/prodModeUtils';
import {
    Home, FileText, BarChart2, DollarSign, TrendingUp, Users,
    Settings, ChevronRight, LogOut, ShieldCheck,
    PieChart, Menu, X, Database, CalendarDays, ChevronDown, ChevronUp,
    CheckCircle
} from 'lucide-react';

// ─── Design System: Corporate Utility ────────────────────────────────────────
// Aesthetic: Enterprise ERP / Banking-grade professional
// Typography: System stack with strong weight contrast
// Color: Deep slate sidebar + navy top bar + crisp whites
// Spatial: Tight, purposeful — no decoration without function

// ─── Color Tokens ────────────────────────────────────────────────────────────
const C = {
    sidebarBg:    '#0f172a',   // Deepest slate
    sidebarHover:  '#1e293b',  // Slightly lighter
    sidebarActive: '#1d3a5c',  // Navy active
    sidebarBorder: '#334155',   // Subtle dividers
    sidebarText:   '#94a3b8',   // Muted text
    sidebarTextBright: '#e2e8f0', // Bright text

    topbarBg:     '#1e293b',   // Dark navy top bar
    topbarBorder: '#2563eb',   // Blue accent line bottom
    topbarText:   '#f1f5f9',
    topbarMuted:   '#64748b',

    contentBg:     '#f8fafc',  // Very light gray content
    white:         '#ffffff',
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
                backgroundColor: mode === 'direct' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                border: `1px solid ${mode === 'direct' ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`,
                borderRadius: '6px',
                padding: '0.3rem 0.6rem',
                fontSize: '0.7rem',
                color: mode === 'direct' ? '#fca5a5' : '#86efac',
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
            backgroundColor: C.topbarBg,
            borderBottom: `2px solid ${C.topbarBorder}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 1.25rem',
            gap: '1rem',
            flexShrink: 0,
            zIndex: 30,
            position: 'relative',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
            {/* Sidebar Toggle */}
            <button
                onClick={onToggle}
                style={{
                    width: '36px', height: '36px',
                    backgroundColor: 'transparent',
                    border: `1px solid ${C.sidebarBorder}`,
                    borderRadius: '6px',
                    color: C.sidebarText,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = C.sidebarHover; e.currentTarget.style.color = C.sidebarTextBright; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = C.sidebarText; }}
                title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
                {collapsed ? <Menu size={18} /> : <X size={18} />}
            </button>

            {/* Divider */}
            <div style={{ width: '1px', height: '28px', backgroundColor: C.sidebarBorder }} />

            {/* Company Branding */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
                <img
                    src={`${getBasePath()}/images/rebinmas.webp`}
                    alt="PT Rebinmas Jaya"
                    style={{ height: '28px', display: 'block' }}
                />
                {!collapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: '700', color: C.white, letterSpacing: '0.02em' }}>
                            PT REBINMAS JAYA
                        </span>
                        <span style={{ fontSize: '0.65rem', color: C.topbarMuted, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            Payroll System
                        </span>
                    </div>
                )}
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Header Actions Portal Target */}
            <div id="header-actions-portal" style={{ display: 'flex', alignItems: 'center' }}></div>

            {/* API Base Toggle (DIRECT 8002 ↔ PROXY) */}
            <ApiBaseToggle />

            {/* Period Badge */}
            {periodDisplay && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    backgroundColor: 'rgba(37, 99, 235, 0.15)',
                    border: '1px solid rgba(37, 99, 235, 0.3)',
                    borderRadius: '6px',
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.75rem',
                    color: '#93c5fd',
                    fontWeight: '600',
                }}>
                    <CalendarDays size={14} />
                    <span>{periodDisplay}</span>
                </div>
            )}

            {/* Divider */}
            <div style={{ width: '1px', height: '28px', backgroundColor: C.sidebarBorder }} />

            {/* User Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: C.white }}>
                        {user?.username}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: C.topbarMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {user?.role || 'Staff'}
                    </span>
                </div>
                {/* Avatar Circle */}
                <div style={{
                    width: '34px', height: '34px',
                    backgroundColor: '#2563eb',
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8rem', fontWeight: '700', color: C.white,
                    flexShrink: 0,
                    border: '2px solid rgba(37, 99, 235, 0.4)',
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
                        color: '#475569',
                        fontSize: '0.65rem',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        transition: 'color 0.15s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.color = '#64748b'}
                    onMouseOut={(e) => e.currentTarget.style.color = '#475569'}
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
                padding: collapsed ? '0.625rem 0' : '0.625rem 0.75rem',
                borderRadius: '6px',
                cursor: 'pointer',
                textDecoration: 'none',
                transition: 'all 0.15s',
                backgroundColor: isActive ? C.sidebarActive : 'transparent',
                color: isActive ? C.sidebarTextBright : C.sidebarText,
                borderLeft: isActive ? '3px solid #2563eb' : '3px solid transparent',
                marginBottom: '2px',
                justifyContent: collapsed ? 'center' : 'flex-start',
            }}
            title={collapsed ? label : ''}
            onMouseOver={(e) => {
                if (!isActive) {
                    e.currentTarget.style.backgroundColor = C.sidebarHover;
                    e.currentTarget.style.color = C.sidebarTextBright;
                }
            }}
            onMouseOut={(e) => {
                if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = C.sidebarText;
                }
            }}
        >
            <div style={{ flexShrink: 0, marginTop: collapsed ? 0 : '1px' }}>
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
                            fontSize: '0.65rem', color: '#64748b', marginTop: '2px',
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
    const navItems = [
        { section: 'Utama', items: [
            { to: '/', icon: Home, label: 'Dashboard', description: 'Ringkasan & metrik', end: true },
        ]},
        { section: 'Operasional', items: [
            { to: '/operational', icon: FileText, label: 'Daftar Upah', description: 'Filter upah operasional' },
            { to: '/pendapatan-tidak-tetap', icon: DollarSign, label: 'Pendapatan Lain', description: 'Pendapatan tidak tetap' },
            { to: '/mill-production', icon: BarChart2, label: 'Produktivitas Kebun', description: 'Tonase FFB, HK & biaya' },
        ]},
        { section: 'Analisis & Laporan', items: [
            { to: '/comprehensive', icon: PieChart, label: 'Analisis Payroll', description: 'Breakdown komponen upah', parent: true },
            { to: '/summary', icon: BarChart2, label: 'Summary Report', description: 'Rekap per divisi', indent: true },
            { to: '/wages-rebinmas', icon: DollarSign, label: 'Wages Rebinmas', description: 'Upah Rebinmas saat ini', indent: true },
            { to: '/wages-rebinmas?mode=comparison', icon: ShieldCheck, label: 'Wages Comparison', description: 'Perbandingan upah', indent: true },
            { to: '/wages-ijl', icon: DollarSign, label: 'Wages IJL', description: 'Upah IJL', indent: true },
            { to: '/wages-comparison', icon: BarChart2, label: 'Summary Comparison', description: 'Perbandingan ringkasan', indent: true },
            { to: '/impact', icon: TrendingUp, label: 'Impact Report', description: 'Analisis dampak', indent: true },
            { to: '/analysis', icon: TrendingUp, label: 'Analisa Lembur & Premi', description: 'Lembur dan premi detail', indent: true },
            { to: '/tonase-analysis', icon: BarChart2, label: 'Analisis Tonase', description: 'Tonase, HK, premi panen', indent: true },
            { to: '/executive', icon: BarChart2, label: 'Executive Analysis', description: 'Analisis eksekutif', indent: true },
            { to: '/report-pajak', icon: FileText, label: 'Report Pajak (PPh21)', description: 'Laporan pajak', indent: true },
            { to: '/data-verification', icon: CheckCircle, label: 'Data Verification', description: 'Verifikasi konsistensi data', indent: true },
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
            backgroundColor: C.contentBg,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            overflow: 'hidden',
            color: '#334155',
        }}>
            {/* Backdrop for mobile */}
            <div
                className="no-print"
                onClick={() => setCollapsed(true)}
                style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: collapsed ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.5)',
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
                backgroundColor: C.sidebarBg,
                display: 'flex',
                flexDirection: 'column',
                zIndex: 20,
                boxShadow: '2px 0 12px rgba(0,0,0,0.15)',
                transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                flexShrink: 0,
            }}>
                {/* Collapsed Logo */}
                {collapsed && (
                    <div style={{
                        height: '56px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderBottom: `1px solid ${C.sidebarBorder}`,
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
                    scrollbarColor: '#334155 transparent',
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
                    borderTop: `1px solid ${C.sidebarBorder}`,
                    padding: collapsed ? '0.75rem 0.5rem' : '0.75rem',
                    backgroundColor: '#0c1322',
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
                            border: `1px solid ${C.sidebarBorder}`,
                            borderRadius: '6px',
                            color: '#94a3b8',
                            fontSize: '0.8rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.borderColor = '#ef4444';
                            e.currentTarget.style.color = '#fca5a5';
                            e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.borderColor = C.sidebarBorder;
                            e.currentTarget.style.color = '#94a3b8';
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
                            color: '#475569',
                            letterSpacing: '0.02em',
                        }}>
                            Payroll System v2.0
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
