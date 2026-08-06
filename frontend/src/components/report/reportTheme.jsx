import React from 'react';

// ===== Sawit Finance — shared theme tokens (light, elegant, palm green) =====
export const C = {
    upah: '#1E7A45', upahAccent: '#3E9E63', premi: '#2E9E6B', lembur: '#D98A1F',
    potongan: '#C8463C', costTon: '#6C4FC4', warn: '#D98A1F', warnBg: '#FBF1DE',
    text: '#12241A', text2: '#46584C', muted: '#7C8B80', border: '#DFE8E0',
    surface: '#FFFFFF', surface2: '#F6FAF5', pageBg: '#EDF3EC', gridLine: '#E4ECE2',
    leafDark: '#14532D', leafMid: '#1E7A45', leafLight: '#4CBB6B', cream: '#F7F9F4'
};
export const SHADOW = '0 1px 2px rgba(18,36,26,.05), 0 6px 18px rgba(18,36,26,.08)';
export const SHADOW_HOVER = '0 14px 34px rgba(18,36,26,.16)';
export const CARD = { background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, padding: 24, boxShadow: SHADOW };
export const SECTION_TITLE = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.leafMid, borderLeft: `3px solid ${C.leafMid}`, paddingLeft: 12, marginBottom: 16 };

// Palm-leaf SVG motif (decorative, absolute-positioned inside hero)
const LeafMotif = ({ size = 320, opacity = 0.14, style = {} }) => (
    <svg style={{ position: 'absolute', pointerEvents: 'none', ...style }} width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <path d="M50 0 C60 25 75 40 100 50 C75 60 60 75 50 100 C40 75 25 60 0 50 C25 40 40 25 50 0 Z" fill="#fff" opacity={opacity} />
    </svg>
);

/**
 * ReportHero — consistent sawit-finance page header for every report.
 * Props: title, subtitle, period (string), actions (ReactNode), eyebrow (small over-label)
 */
export function ReportHero({ title, subtitle, period, eyebrow = 'Perkebunan Sawit · Laporan', actions }) {
    return (
        <div style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(115deg, ${C.leafDark} 0%, ${C.leafMid} 55%, ${C.leafLight} 100%)`, padding: '1.8rem 2.4rem 4.2rem', color: '#fff' }}>
            <LeafMotif size={320} opacity={0.14} style={{ right: -20, top: -30 }} />
            <LeafMotif size={200} opacity={0.10} style={{ right: 140, bottom: -60 }} />
            <div style={{ position: 'relative', maxWidth: 1320, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 6 }}>{eyebrow}</div>
                    <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{title}</h1>
                    {subtitle && <p style={{ margin: '0.4rem 0 0', color: 'rgba(255,255,255,0.86)', fontSize: '0.9rem', maxWidth: 620 }}>{subtitle}</p>}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {period && (
                        <span style={{ background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.24)', borderRadius: 999, padding: '6px 14px', fontSize: '0.82rem', fontWeight: 700 }}>
                            {period}
                        </span>
                    )}
                    {actions}
                </div>
            </div>
        </div>
    );
}

/** PageBody — content wrapper that overlaps the hero, consistent max-width + spacing. */
export function ReportBody({ children }) {
    return (
        <div style={{ background: C.pageBg, minHeight: '100%', paddingBottom: '2.5rem' }}>
            <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 2.4rem', marginTop: '-2.6rem', position: 'relative' }}>
                {children}
            </div>
        </div>
    );
}

/** DeltaBadge — semantic % change pill (invert=true → increase is bad). */
export function DeltaBadge({ pct, invert = false }) {
    if (pct === null || pct === undefined || isNaN(pct)) return null;
    const bad = (pct >= 0) === invert;
    const color = bad ? C.potongan : C.premi;
    const bg = bad ? '#FBE9E6' : '#E4F4EB';
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color, background: bg, border: `1px solid ${bad ? '#F0CFC9' : '#C4E6D2'}` }}>
            {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
        </span>
    );
}

/** StatCard — compact KPI tile for report pages. */
export function StatCard({ label, value, note, color = C.upah, pct, invert }) {
    const [hover, setHover] = React.useState(false);
    return (
        <div
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            style={{ ...CARD, padding: '16px 18px', position: 'relative', overflow: 'hidden', transform: hover ? 'translateY(-2px)' : 'none', boxShadow: hover ? SHADOW_HOVER : SHADOW, transition: 'box-shadow .18s, transform .18s' }}
        >
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: color, borderRadius: '4px 0 0 4px' }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: C.text, lineHeight: 1.05, marginBottom: 6 }}>{value}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {pct !== undefined && <DeltaBadge pct={pct} invert={invert} />}
                {note && <span style={{ fontSize: 11.5, color: C.text2 }}>{note}</span>}
            </div>
        </div>
    );
}

export default ReportHero;
