/**
 * WagesComparisonPage - Page for viewing wages comparison
 *
 * Route: /wages-comparison
 * Accessible from main navigation or Report page
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Scale, ListChecks, CalendarDays } from 'lucide-react';
import PayrollHistoryComparison from '../components/PayrollHistoryComparison';
import { MetricInfo, C } from '../components/report/reportTheme';
import { getMonthName } from '../services/wagesService';
import PresentSlide from '../components/present/PresentSlide';
import PresentController from '../components/present/PresentController';
import usePresentMode from '../components/present/usePresentMode';

const CONTEXT_CARD = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '18px 20px',
};

const CONTEXT_LABEL = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: C.muted,
    marginBottom: 8,
};

export default function WagesComparisonPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Get initial values from URL params
    const initialMonth = searchParams.get('month') ? parseInt(searchParams.get('month')) : undefined;
    const initialYear = searchParams.get('year') ? parseInt(searchParams.get('year')) : undefined;
    const initialDivision = searchParams.get('division') || undefined;

    // Present mode: deck fullscreen per slide (toggle html.present-mode + HUD)
    const { presenting, activeIndex, enter, exit } = usePresentMode();

    const handleBack = () => {
        navigate(-1); // Go back to previous page
    };

    // Label caption HUD: "<Nama Report> · <periode> · <scope>" (selaras default PayrollHistoryComparison)
    const periodMonth = initialMonth || new Date().getMonth() + 1;
    const periodYear = initialYear || new Date().getFullYear();
    const periodLabel = `${getMonthName(periodMonth)} ${periodYear}`;
    const scopeLabel = initialDivision || 'Semua Divisi';

    return (
        <div className="wages-comparison-page">
            <div className="no-print" style={{ padding: '12px 20px', background: '#E9F2EA', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #C4DBC8' }}>
                <span style={{ fontWeight: 800, color: '#143D28', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Perbandingan Upah <MetricInfo metricKey="upah_bersih" /></span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* PRESENT MODE - tombol Present (mode normal) + HUD deck (present mode) */}
                    <PresentController
                        presenting={presenting}
                        activeIndex={activeIndex}
                        slideCount={3}
                        onEnter={enter}
                        onExit={exit}
                        caption={`Perbandingan Upah · ${periodLabel} · ${scopeLabel}`}
                    />
                    <button onClick={() => navigate(`/cost-per-ton-story?month=${initialMonth || ''}&year=${initialYear || ''}`)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1F6F43', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cost/Ton Story →</button>
                </div>
            </div>

            <PresentSlide num="01" id="slide-01" title="Konteks Verifikasi Upah" subtitle="Dasar perbandingan Daftar Upah dengan data Wages sistem pada periode berjalan">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20 }}>
                    <div style={{ ...CONTEXT_CARD, borderLeft: `4px solid ${C.upah}` }}>
                        <div style={CONTEXT_LABEL}><Scale size={14} strokeWidth={2.2} aria-hidden="true" /> Sumber Data</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Daftar Upah vs Wages Sistem</div>
                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.55 }}>Nilai hasil olah payroll (Daftar Upah) dicocokkan dengan data wages tersimpan di sistem (PR_EMPWAGES) untuk setiap karyawan.</div>
                    </div>
                    <div style={{ ...CONTEXT_CARD, borderLeft: `4px solid ${C.premi}` }}>
                        <div style={CONTEXT_LABEL}><ListChecks size={14} strokeWidth={2.2} aria-hidden="true" /> Metrik Pembanding</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>HK dan Upah Bersih</div>
                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.55 }}>Hari kerja dan upah bersih dibandingkan per karyawan; status Cocok bila selisih upah bersih tidak lebih dari Rp 1.000.</div>
                    </div>
                    <div style={{ ...CONTEXT_CARD, borderLeft: `4px solid ${C.lembur}` }}>
                        <div style={CONTEXT_LABEL}><CalendarDays size={14} strokeWidth={2.2} aria-hidden="true" /> Cakupan</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>{periodLabel} · {scopeLabel}</div>
                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.55 }}>Periode dan divisi mengikuti filter di dalam tabel; status verifikasi dapat disaring lewat filter Status dan Group.</div>
                    </div>
                </div>
            </PresentSlide>

            <PresentSlide num="02" id="slide-02" title="Tabel Perbandingan per Karyawan" subtitle="HK dan upah bersih Daftar Upah vs Wages, lengkap dengan status selisih">
                <PayrollHistoryComparison
                    initialMonth={initialMonth}
                    initialYear={initialYear}
                    initialDivision={initialDivision}
                    onBack={handleBack}
                />
            </PresentSlide>

            <PresentSlide num="03" id="slide-03" title="Catatan Pembacaan" subtitle="Ambang status verifikasi dan cara menindaklanjuti selisih">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                    <div style={CONTEXT_CARD}>
                        <div style={CONTEXT_LABEL}>Ambang Status</div>
                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.9 }}>
                            <div><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.upah, marginRight: 8 }} />Cocok · selisih upah bersih ≤ Rp 1.000</div>
                            <div><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.lembur, marginRight: 8 }} />Selisih Kecil · selisih ≤ Rp 10.000</div>
                            <div><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.potongan, marginRight: 8 }} />Selisih Besar · selisih &gt; Rp 10.000</div>
                            <div><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.muted, marginRight: 8 }} />Tidak Ada Data · wages pembanding belum tersedia</div>
                        </div>
                    </div>
                    <div style={CONTEXT_CARD}>
                        <div style={CONTEXT_LABEL}>Tindak Lanjut</div>
                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.9 }}>
                            <div>Gunakan filter Status dan Group untuk menyaring baris berselisih.</div>
                            <div>Klik tombol panah di kolom Detail untuk rincian tunjangan, premi, dan potongan.</div>
                            <div>Export CSV untuk audit, atau Cetak Laporan untuk arsip landscape.</div>
                        </div>
                    </div>
                </div>
            </PresentSlide>
        </div>
    );
}
