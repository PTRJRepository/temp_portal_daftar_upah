import React from 'react';
import { AlertTriangle, BarChart3 } from 'lucide-react';
import { usePrintExpand } from '../../utils/printPageSetup';

// ===== Estate Ledger — shared theme tokens (SSOT mirror dari tokens.css) =====
// Keys preserved for backward compat across 25+ page files.
// Spec: docs/superpowers/specs/2026-08-07-estate-ledger-redesign-design.md
export const C = {
    upah: '#1F6F43', upahAccent: '#3D8B62', premi: '#0F766E', lembur: '#B45309',
    potongan: '#B3392E', costTon: '#7C5A2B', warn: '#B45309', warnBg: '#F7EBD9',
    text: '#15211A', text2: '#3D4A41', muted: '#6E7A70', border: '#E0DED2',
    surface: '#FFFFFF', surface2: '#F5F3EC', pageBg: '#F0EEE6', gridLine: '#E8E6DB',
    leafDark: '#143D28', leafMid: '#1F6F43', leafLight: '#5E9C7B', cream: '#F7F5EF'
};
export const SHADOW = '0 1px 2px rgba(21,33,26,.04), 0 4px 14px rgba(21,33,26,.06)';
export const SHADOW_HOVER = '0 10px 28px rgba(21,33,26,.10)';
export const CARD = { background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, padding: 24, boxShadow: SHADOW };
export const SECTION_TITLE = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted, marginBottom: 16, fontFamily: 'var(--font-display)' };

/** Chart palette — estate semantic hues, shared across all recharts panels. */
export const chartPalette = [
    C.leafMid,    // primary series
    C.leafLight,
    C.premi,
    C.lembur,
    C.potongan,
    C.costTon,
];

/**
 * ReportHero — masthead datar ala ledger cetak: paper, hairline bawah,
 * judul display besar, meta sebagai teks. Tanpa gradient/motif/glass.
 * Props: title, subtitle, period (string), actions (ReactNode), eyebrow (small over-label)
 */
export function ReportHero({ title, subtitle, period, eyebrow = 'Portal Estate · Daftar Upah', actions, className }) {
    return (
        <div className={className} style={{ background: C.cream, borderBottom: `1px solid ${C.border}`, padding: '1.75rem 2.4rem 1.6rem', color: C.text }}>
            <div style={{ maxWidth: 1320, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1.25rem', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                    {eyebrow && (
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, marginBottom: 8, fontFamily: 'var(--font-display)' }}>{eyebrow}</div>
                    )}
                    <h1 style={{ margin: 0, fontSize: 'clamp(1.5rem, 2.5vw, 2.1rem)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, fontFamily: 'var(--font-display)', color: C.text, overflowWrap: 'anywhere' }}>{title}</h1>
                    {subtitle && <p style={{ margin: '0.45rem 0 0', color: C.text2, fontSize: '0.9rem', maxWidth: 620 }}>{subtitle}</p>}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {period && (
                        <span style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px', fontSize: '0.82rem', fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
                            {period}
                        </span>
                    )}
                    {actions}
                </div>
            </div>
        </div>
    );
}

/** ReportBody — content wrapper, konsisten max-width + spacing (tanpa overlap hero). */
export function ReportBody({ children }) {
    return (
        <div style={{ background: C.pageBg, minHeight: '100%', paddingBottom: '2.5rem' }}>
            <div style={{ maxWidth: 1320, margin: '0 auto', padding: '1.8rem 2.4rem 0' }}>
                {children}
            </div>
        </div>
    );
}

/** DeltaBadge — perubahan % sebagai teks semantik (invert=true → kenaikan buruk). */
export function DeltaBadge({ pct, invert = false }) {
    if (pct === null || pct === undefined || isNaN(pct)) return null;
    const bad = (pct >= 0) === invert;
    const color = bad ? C.potongan : C.upah;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
            {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
        </span>
    );
}

/** StatCard — ledger cell: flat, hairline, angka mono tabular, tick semantik tipis.
 *  Prop opsional: badge (pill kecil di samping label), sparkline (ReactNode strip penuh di dasar kartu).
 *  Angka value nowrap + font clamp supaya tidak pernah jatuh ke baris baru saat kartu sempit. */
export function StatCard({ label, value, note, color = C.upah, pct, invert, badge, sparkline }) {
    const [hover, setHover] = React.useState(false);
    return (
        <div
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            style={{ ...CARD, padding: '16px 18px', borderColor: hover ? C.leafLight : C.border, transition: 'border-color .15s', minWidth: 0 }}
        >
            <div style={{ width: 24, height: 2, background: color, marginBottom: 10 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                {badge && (
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.premi, background: '#E3EFEC', border: '1px solid #BFD8D3', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>{badge}</span>
                )}
            </div>
            <div style={{ fontSize: 'clamp(14px, 1.15vw, 24px)', fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: C.text, lineHeight: 1.05, marginBottom: 6, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {pct !== undefined && <DeltaBadge pct={pct} invert={invert} />}
                {note && <span style={{ fontSize: 11.5, color: C.text2 }}>{note}</span>}
            </div>
            {sparkline && <div style={{ height: 32, marginTop: 10 }}>{sparkline}</div>}
        </div>
    );
}

// ===== Interpretation system — "angka ini dari mana?" =====
import { getMetric, SOURCE_TABLE, SCOPE } from './metricDefinitions';

/**
 * MetricInfo — badge "i" + tooltip menjelaskan definisi, rumus, sumber, cakupan.
 * Dipakai di samping label KPI/judul chart. Hover = tooltip, klik = pin.
 * Props: metricKey (key di METRICS) atau {label, formula, column, scope, caveat} manual.
 */
export function MetricInfo({ metricKey, def, size = 13 }) {
    const d = def || getMetric(metricKey);
    const [open, setOpen] = React.useState(false);
    const wrapRef = React.useRef(null);
    // Saat print: keterangan audit (yang biasanya cuma muncul di hover/klik) dirender inline
    // supaya "angka ini dari mana?" ikut tercetak.
    const printExpanded = usePrintExpand();

    React.useEffect(() => {
        if (!open) return;
        const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    return (
        <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
            <button
                type="button"
                aria-label={`Info ${d.label}`}
                onClick={() => setOpen(o => !o)}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                style={{
                    width: size + 4, height: size + 4, borderRadius: '50%', border: `1px solid ${C.border}`,
                    background: C.surface2, color: C.leafMid, fontSize: size - 3, fontWeight: 800,
                    cursor: 'help', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0
                }}
            >i</button>
            {printExpanded && d && (
                <span className="metric-info-print-note">
                    {d.formula && <span><b>Rumus:</b> {d.formula}</span>}
                    {d.column && <span><b>Kolom:</b> {d.column}</span>}
                    {d.scope?.label && <span><b>Cakupan:</b> {d.scope.label}{d.scope.desc ? ` — ${d.scope.desc}` : ''}</span>}
                    {d.caveat && <span><b>Catatan:</b> {d.caveat}</span>}
                </span>
            )}
            {open && (
                <div style={{
                    position: 'absolute', zIndex: 50, top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
                    width: 280, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                    boxShadow: SHADOW_HOVER, padding: '14px 16px', textAlign: 'left', pointerEvents: 'auto'
                }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 6 }}>{d.label}</div>
                    {d.scope && (
                        <div style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.leafMid, background: '#E9F2EA', border: '1px solid #C4DBC8', borderRadius: 999, padding: '2px 8px', marginBottom: 8 }}>
                            Cakupan: {d.scope.label}
                        </div>
                    )}
                    {d.formula && <InfoRow k="Rumus" v={d.formula} mono />}
                    {d.column && <InfoRow k="Kolom" v={d.column} mono />}
                    <InfoRow k="Sumber" v={SOURCE_TABLE.AGG} mono small />
                    {d.scope?.desc && <div style={{ fontSize: 11.5, color: C.text2, marginTop: 6, lineHeight: 1.45 }}>{d.scope.desc}</div>}
                    {d.caveat && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, color: C.lembur, background: C.warnBg, border: '1px solid #E5CFA3', borderRadius: 8, padding: '6px 8px', marginTop: 8, lineHeight: 1.4 }}>
                            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                            <span>{d.caveat}</span>
                        </div>
                    )}
                </div>
            )}
        </span>
    );
}
const InfoRow = ({ k, v, mono, small }) => (
    <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: small ? 10.5 : 11.5 }}>
        <span style={{ color: C.muted, fontWeight: 700, flexShrink: 0, minWidth: 44 }}>{k}</span>
        <span style={{ color: C.text, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', wordBreak: 'break-word' }}>{v}</span>
    </div>
);

/**
 * ScopeToggle — pilih cakupan gang: Panen / Maintenance / Transport / Semua.
 * Props: value ('panen'|'maintenance'|'transport'|'all'), onChange(key)
 */
export function ScopeToggle({ value = 'panen', onChange }) {
    const opts = [SCOPE.PANEN, SCOPE.MAINTENANCE, SCOPE.TRANSPORT, SCOPE.ALL];
    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'inline-flex', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 999, padding: 3 }}>
                {opts.map(o => {
                    const active = value === o.key;
                    return (
                        <button key={o.key} type="button" onClick={() => onChange && onChange(o.key)}
                            title={o.desc}
                            style={{
                                padding: '5px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                                fontWeight: 700, fontSize: 12.5, transition: 'all .15s',
                                background: active ? C.upah : 'transparent', color: active ? '#fff' : C.text2
                            }}>
                            {o.label}
                        </button>
                    );
                })}
            </div>
            <MetricInfo def={{ label: 'Cakupan Gang', formula: null, column: null, scope: null, caveat: 'Suffix kode gang: H=panen, M=maintenance, T=transport. Toggle ini mengubah cakupan semua angka di halaman.' }} />
        </div>
    );
}

/**
 * Breadcrumb — posisi drill-down L0→L5 (overview → divisi → gang → karyawan).
 * Props: items = [{label, onClick?}] — item terakhir = aktif (non-clickable).
 */
export function Breadcrumb({ items = [] }) {
    if (!items.length) return null;
    return (
        <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, marginBottom: 14 }}>
            {items.map((it, i) => {
                const last = i === items.length - 1;
                return (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {i > 0 && <span style={{ color: C.muted }}>›</span>}
                        {last || !it.onClick ? (
                            <span style={{ fontWeight: 700, color: C.text }}>{it.label}</span>
                        ) : (
                            <button type="button" onClick={it.onClick}
                                style={{ border: 'none', background: 'none', color: C.upah, fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13 }}>
                                {it.label}
                            </button>
                        )}
                    </span>
                );
            })}
        </nav>
    );
}

/**
 * EmptyState — ganti "-" / grafik kosong dengan penjelasan + aksi.
 * Props: title, message, actionLabel?, onAction?
 */
export function EmptyState({ title = 'Data belum tersedia', message, actionLabel, onAction }) {
    return (
        <div style={{ ...CARD, textAlign: 'center', padding: '40px 24px', borderStyle: 'dashed', background: C.surface2 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: C.muted, opacity: 0.7 }}>
                <BarChart3 size={30} strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>{title}</div>
            {message && <div style={{ fontSize: 13, color: C.text2, maxWidth: 420, margin: '0 auto', lineHeight: 1.5 }}>{message}</div>}
            {actionLabel && onAction && (
                <button type="button" onClick={onAction}
                    style={{ marginTop: 14, padding: '8px 18px', borderRadius: 8, border: 'none', background: C.upah, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    {actionLabel}
                </button>
            )}
        </div>
    );
}

/** Skeleton — blok loading pulse halus. Prop: height (px). */
export function Skeleton({ height = 120 }) {
    return (
        <div style={{ height, borderRadius: 10, background: C.surface2, border: `1px solid ${C.border}`, animation: 'elPulse 1.4s ease-in-out infinite' }}>
            <style>{`@keyframes elPulse{0%,100%{opacity:.55}50%{opacity:1}}`}</style>
        </div>
    );
}

/** SectionHeader — judul section konsisten: SECTION_TITLE + meta kecil + garis. */
export function SectionHeader({ title, meta }) {
    return (
        <div style={{ marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...SECTION_TITLE, marginBottom: 0 }}>{title}</span>
            {meta && <span style={{ fontSize: 11, color: C.muted }}>{meta}</span>}
            <span style={{ flex: 1, height: 1, background: C.border }} />
        </div>
    );
}

export default ReportHero;
