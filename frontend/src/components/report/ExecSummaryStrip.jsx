import React, { useMemo } from 'react';
import { C, CARD } from './reportTheme';
import { costPerTon, benchmarkMean, deltaPct } from '../../utils/costPerTonStory.derive';

const fmtCompact = (v) => {
    if (v == null) return '-';
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
};

/**
 * ExecSummaryStrip — 3-4 kalimat naratif otomatis dari data. Presentational headline.
 * Props: trends, breakdown, wageSpikes, periodLabel
 */
export default function ExecSummaryStrip({ trends = [], breakdown = [], wageSpikes = [], periodLabel }) {
    const summary = useMemo(() => {
        const out = [];
        const curr = trends[trends.length - 1] || {};
        const prev = trends[trends.length - 2] || {};
        const mean = benchmarkMean(breakdown);

        // Arah biaya
        const d = deltaPct({ total_wage: curr.total_wage, total_tonase: curr.total_tonase }, { total_wage: prev.total_wage, total_tonase: prev.total_tonase });
        if (d != null) {
            out.push({
                tone: d > 0 ? 'bad' : 'good',
                icon: d > 0 ? '▲' : '▼',
                text: d > 0
                    ? `Biaya per ton NAIK ${Math.abs(d).toFixed(1)}% dibanding bulan lalu · total upah panen ${fmtCompact(curr.total_wage)} untuk ${Number(curr.total_tonase || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })} ton TBS.`
                    : `Biaya per ton TURUN ${Math.abs(d).toFixed(1)}% dibanding bulan lalu · efisiensi membaik pada ${periodLabel || 'periode ini'}.`
            });
        }

        // Divisi paling efisien & paling boros (cost/ton vs mean)
        const withCpt = breakdown
            .map(b => ({ code: b.division_code, cpt: costPerTon(b) }))
            .filter(x => x.cpt != null)
            .sort((a, b) => a.cpt - b.cpt);
        if (withCpt.length >= 2 && mean != null) {
            const best = withCpt[0];
            const worst = withCpt[withCpt.length - 1];
            const worstPct = ((worst.cpt - mean) / mean) * 100;
            out.push({
                tone: 'info', icon: '●',
                text: `${best.code} paling efisien (${fmtCompact(best.cpt)}/ton), sedangkan ${worst.code} paling tinggi (${fmtCompact(worst.cpt)}/ton, ${worstPct > 0 ? '+' : ''}${worstPct.toFixed(0)}% di atas rata-rata estate).`
            });
        }

        // Driver komposisi (premi vs lembur share)
        const premiShare = curr.total_wage > 0 ? (curr.total_premi / curr.total_wage) * 100 : 0;
        const otShare = curr.total_wage > 0 ? (curr.total_ot / curr.total_wage) * 100 : 0;
        if (curr.total_wage > 0) {
            const driver = premiShare >= otShare ? `premi ${premiShare.toFixed(1)}%` : `lembur ${otShare.toFixed(1)}%`;
            out.push({
                tone: 'neutral', icon: '◆',
                text: `Komponen variabel terbesar dalam upah kotor adalah ${driver} dari total upah · pantau jika porsinya terus membesar.`
            });
        }

        // Anomali
        if (Array.isArray(wageSpikes) && wageSpikes.length > 0) {
            const top = wageSpikes[0];
            const code = top.gang_code ?? top.gang ?? top.name ?? top.id;
            const pct = top.increasePercent ?? top.percentage ?? 0;
            out.push({
                tone: 'warn', icon: '▲',
                text: `${wageSpikes.length} gang menunjukkan lonjakan biaya signifikan; tertinggi ${code} (+${Number(pct).toFixed(1)}%).`
            });
        }

        return out;
    }, [trends, breakdown, wageSpikes, periodLabel]);

    if (summary.length === 0) return null;

    const toneStyle = {
        good: { bg: '#E4F4EB', bd: '#C4E6D2', fg: C.upah },
        bad: { bg: '#FBE9E6', bd: '#F0CFC9', fg: C.potongan },
        warn: { bg: C.warnBg || '#FBF1DE', bd: '#EDD9B4', fg: C.lembur },
        info: { bg: '#EAF1FB', bd: '#CBDCF1', fg: '#2C5AA0' },
        neutral: { bg: C.surface2, bd: C.border, fg: C.text2 },
    };

    return (
        <div style={{ ...CARD, marginBottom: '1.5rem', borderLeft: `4px solid ${C.leafMid}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: C.leafMid, marginBottom: 12 }}>
                Ringkasan Eksekutif · {periodLabel}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {summary.map((s, i) => {
                    const t = toneStyle[s.tone] || toneStyle.neutral;
                    return (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, fontWeight: 600, color: t.fg, lineHeight: 1.5 }}>
                            <span style={{ flexShrink: 0, fontSize: 16 }}>{s.icon}</span>
                            <span>{s.text}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
