import React from 'react';
import { C, CARD, SECTION_TITLE } from './reportTheme';

const GROUPS = [
    {
        title: 'Keuangan & Upah', color: C.upah, links: [
            ['Ringkasan (Summary)', '/summary'], ['Upah Rebinmas', '/wages-rebinmas'], ['Upah IJL', '/wages-ijl'],
            ['Perbandingan Upah', '/wages-comparison'], ['Impact Report', '/impact'], ['Report Pajak (PPh21)', '/report-pajak'],
        ]
    },
    {
        title: 'Analisis Biaya & Produktivitas', color: C.costTon, links: [
            ['Cost/Ton Story', '/cost-per-ton-story'], ['Analisis Tonase', '/tonase-analysis'], ['Produktivitas', '/productivity'],
            ['Analisa Lembur & Premi', '/analysis'], ['Comprehensive', '/comprehensive'], ['Analisis Upah Bersih & Lembur', '/detailed-salary'],
        ]
    },
    {
        title: 'Gang & Divisi', color: C.lembur, links: [
            ['Perbandingan Gang', '/gang-comparison-report'], ['High Earners', '/report/high-earners'],
            ['Salary Range Detail', '/report/salary-range-detail'], ['Detail Upah Bersih', '/detail-upah-bersih'],
        ]
    },
    {
        title: 'Operasional & HR', color: C.upahAccent, links: [
            ['Daftar Upah Operasional', '/operational'], ['Pendapatan Lain', '/pendapatan-tidak-tetap'], ['Produktivitas Kebun (Mill)', '/mill-production'],
            ['Data Verification', '/data-verification'], ['HR Employee Directory', '/employee-directory'],
        ]
    },
];

/**
 * ReportHubFooter — grid semua report link, board jadi launchpad. Props: onNavigate(path)
 */
export default function ReportHubFooter({ onNavigate, month, year }) {
    const withPeriod = (p) => (month && year && !p.includes('operational') ? `${p}${p.includes('?') ? '&' : '?'}month=${month}&year=${year}` : p);
    return (
        <div style={{ ...CARD, marginTop: '1.5rem' }}>
            <div style={{ ...SECTION_TITLE, marginBottom: 16 }}>Semua Laporan · Pusat Akses</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18 }}>
                {GROUPS.map(g => (
                    <div key={g.title}>
                        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: g.color, marginBottom: 10, borderLeft: `3px solid ${g.color}`, paddingLeft: 10 }}>{g.title}</div>
                        <div style={{ display: 'grid', gap: 7 }}>
                            {g.links.map(([label, path]) => (
                                <button key={path} onClick={() => onNavigate && onNavigate(withPeriod(path))}
                                    style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface2, color: C.text2, fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all .15s' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = C.upah; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = C.upah; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = C.surface2; e.currentTarget.style.color = C.text2; e.currentTarget.style.borderColor = C.border; }}>
                                    {label} <span style={{ float: 'right', fontWeight: 800 }}>›</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
