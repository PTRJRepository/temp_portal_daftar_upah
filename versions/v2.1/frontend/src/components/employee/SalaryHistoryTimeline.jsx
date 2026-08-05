import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getEmployeeHistory } from '../../services/employeeDetailService';
import './SalaryHistoryTimeline.css';

/**
 * SalaryHistoryTimeline - Professional salary history display
 * Shows comprehensive daftar upah data per period with expandable detail sections.
 */
export default function SalaryHistoryTimeline({ empCode, months = 12 }) {
    const [historyData, setHistoryData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedPeriods, setExpandedPeriods] = useState({});
    const [expandedSections, setExpandedSections] = useState({});
    const { token } = useAuth();

    useEffect(() => {
        if (!empCode || !token) return;
        setLoading(true);
        setError(null);
        getEmployeeHistory(token, empCode, { months, includeCurrent: false })
            .then(res => {
                setHistoryData(res.data || []);
            })
            .catch(err => {
                console.error('[SalaryHistoryTimeline] Error:', err);
                setError(err.message || 'Failed to load history');
            })
            .finally(() => setLoading(false));
    }, [empCode, months, token]);

    // Format number with thousand separators
    const fmt = (value) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = Number(value);
        if (isNaN(num)) return value;
        if (num === 0) return '0';
        return new Intl.NumberFormat('id-ID').format(Math.round(num));
    };

    // Format with sign
    const fmtSigned = (value) => {
        const num = Number(value) || 0;
        if (num === 0) return '0';
        const prefix = num > 0 ? '+' : '';
        return prefix + new Intl.NumberFormat('id-ID').format(Math.round(num));
    };

    // Stats computation
    const stats = useMemo(() => {
        if (!historyData || historyData.length === 0) return null;
        const wages = historyData.map(d => d.upah_bersih || 0).filter(v => v > 0);
        if (wages.length === 0) return null;
        const sum = wages.reduce((a, b) => a + b, 0);
        const avg = sum / wages.length;
        const min = Math.min(...wages);
        const max = Math.max(...wages);
        // Trend: compare last 2 periods
        let trend = 0;
        if (historyData.length >= 2) {
            const latest = historyData[0]?.upah_bersih || 0;
            const previous = historyData[1]?.upah_bersih || 0;
            trend = previous > 0 ? ((latest - previous) / previous) * 100 : 0;
        }
        return { sum, avg, min, max, trend, count: wages.length };
    }, [historyData]);

    const togglePeriod = (key) => {
        setExpandedPeriods(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleSection = (periodKey, sectionKey) => {
        const fullKey = `${periodKey}_${sectionKey}`;
        setExpandedSections(prev => ({ ...prev, [fullKey]: !prev[fullKey] }));
    };

    const isSectionExpanded = (periodKey, sectionKey) => {
        return expandedSections[`${periodKey}_${sectionKey}`] ?? false;
    };

    // Loading
    if (loading) {
        return (
            <div className="sht-container sht-loading">
                <div className="sht-spinner" />
                <p>Memuat riwayat gaji...</p>
            </div>
        );
    }

    // Error
    if (error) {
        return (
            <div className="sht-container sht-error">
                <span className="sht-error-icon">⚠</span>
                <p>{error}</p>
            </div>
        );
    }

    // Empty
    if (!historyData || historyData.length === 0) {
        return (
            <div className="sht-container sht-empty">
                <span className="sht-empty-icon">📭</span>
                <p>Tidak ada data riwayat gaji</p>
            </div>
        );
    }

    // Detail Section Component
    const DetailSection = ({ periodKey, sectionKey, title, icon, color, children }) => {
        const isOpen = isSectionExpanded(periodKey, sectionKey);
        return (
            <div className={`sht-detail-section sht-section-${color}`}>
                <div className="sht-section-header" onClick={() => toggleSection(periodKey, sectionKey)}>
                    <span className="sht-section-icon">{icon}</span>
                    <span className="sht-section-title">{title}</span>
                    <span className={`sht-section-chevron ${isOpen ? 'open' : ''}`}>▶</span>
                </div>
                {isOpen && <div className="sht-section-body">{children}</div>}
            </div>
        );
    };

    // Detail Row Component
    const Row = ({ label, value, isRate, isTotal, isNegative, isHighlight, isMuted }) => (
        <div className={`sht-row ${isTotal ? 'sht-row-total' : ''} ${isHighlight ? 'sht-row-highlight' : ''} ${isMuted ? 'sht-row-muted' : ''}`}>
            <span className="sht-row-label">{label}</span>
            <span className={`sht-row-value ${isNegative ? 'sht-val-negative' : ''} ${isRate ? 'sht-val-rate' : ''}`}>
                {isRate ? `@${fmt(value)}` : fmt(value)}
            </span>
        </div>
    );

    return (
        <div className="sht-container">
            {/* Statistics Banner */}
            {stats && (
                <div className="sht-stats-banner">
                    <div className="sht-stat">
                        <span className="sht-stat-label">Rata-rata</span>
                        <span className="sht-stat-value">{fmt(stats.avg)}</span>
                    </div>
                    <div className="sht-stat">
                        <span className="sht-stat-label">Terendah</span>
                        <span className="sht-stat-value sht-val-low">{fmt(stats.min)}</span>
                    </div>
                    <div className="sht-stat">
                        <span className="sht-stat-label">Tertinggi</span>
                        <span className="sht-stat-value sht-val-high">{fmt(stats.max)}</span>
                    </div>
                    <div className="sht-stat">
                        <span className="sht-stat-label">Total ({stats.count} bln)</span>
                        <span className="sht-stat-value">{fmt(stats.sum)}</span>
                    </div>
                    <div className="sht-stat">
                        <span className="sht-stat-label">Tren</span>
                        <span className={`sht-stat-value ${stats.trend >= 0 ? 'sht-val-high' : 'sht-val-low'}`}>
                            {stats.trend >= 0 ? '▲' : '▼'} {Math.abs(stats.trend).toFixed(1)}%
                        </span>
                    </div>
                </div>
            )}

            {/* Timeline */}
            <div className="sht-timeline">
                {historyData.map((item, idx) => {
                    const periodKey = `${item.period_year}_${item.period_month}`;
                    const isExpanded = expandedPeriods[periodKey];

                    // Trend vs previous period
                    const prevItem = historyData[idx + 1]; // array is newest-first
                    const prevNet = prevItem?.upah_bersih || 0;
                    const currNet = item.upah_bersih || 0;
                    const diff = prevNet > 0 ? currNet - prevNet : 0;
                    const diffPct = prevNet > 0 ? ((diff / prevNet) * 100).toFixed(1) : null;

                    return (
                        <div key={periodKey} className={`sht-card ${isExpanded ? 'expanded' : ''}`}>
                            {/* Card Header */}
                            <div className="sht-card-header" onClick={() => togglePeriod(periodKey)}>
                                <div className="sht-card-left">
                                    <div className="sht-period-badge">
                                        <span className="sht-period-month">{item.period_label?.split(' ')[0] || ''}</span>
                                        <span className="sht-period-year">{item.period_year}</span>
                                    </div>
                                    <div className="sht-card-meta">
                                        <span className="sht-gang-badge">{item.gang_code || '-'}</span>
                                        <span className="sht-loc-badge">{item.loc_code || '-'}</span>
                                    </div>
                                </div>

                                <div className="sht-card-summary">
                                    <div className="sht-summary-item">
                                        <span className="sht-s-label">HK</span>
                                        <span className="sht-s-value">{item.jumlah_hk || 0}</span>
                                    </div>
                                    <div className="sht-summary-item">
                                        <span className="sht-s-label">Gaji Pokok</span>
                                        <span className="sht-s-value">{fmt(item.gaji_pokok)}</span>
                                    </div>
                                    <div className="sht-summary-item">
                                        <span className="sht-s-label">Tunjangan</span>
                                        <span className="sht-s-value">{fmt(item.total_tunjangan)}</span>
                                    </div>
                                    <div className="sht-summary-item">
                                        <span className="sht-s-label">Premi</span>
                                        <span className="sht-s-value">{fmt(item.total_premi)}</span>
                                    </div>
                                    <div className="sht-summary-item">
                                        <span className="sht-s-label">Potongan</span>
                                        <span className="sht-s-value sht-val-negative">{fmt(item.total_potongan)}</span>
                                    </div>
                                    <div className="sht-summary-item sht-summary-highlight">
                                        <span className="sht-s-label">Upah Bersih</span>
                                        <span className="sht-s-value sht-s-net">{fmt(item.upah_bersih)}</span>
                                    </div>
                                    {diffPct && (
                                        <div className={`sht-trend-badge ${diff >= 0 ? 'up' : 'down'}`}>
                                            {diff >= 0 ? '▲' : '▼'} {Math.abs(diffPct)}%
                                        </div>
                                    )}
                                </div>

                                <span className={`sht-chevron ${isExpanded ? 'open' : ''}`}>▶</span>
                            </div>

                            {/* Card Body - Expanded Detail */}
                            {isExpanded && (
                                <div className="sht-card-body">
                                    {/* === ABSENSI === */}
                                    <DetailSection periodKey={periodKey} sectionKey="absensi" title="Absensi" icon="📋" color="blue">
                                        <Row label="Jumlah HK" value={item.jumlah_hk} />
                                        <Row label="Hari Kerja (efektif)" value={item.hari_kerja} />
                                        <Row label="Total Jam Kerja" value={item.total_jam_kerja} />
                                        <Row label="Cuti Tahunan" value={item.cuti_tahunan_hari} isMuted />
                                        <Row label="Cuti Sakit/Haid" value={item.cuti_sakit_haid_hari} isMuted />
                                        <Row label="Cuti Minggu" value={item.cuti_minggu_hari} isMuted />
                                        <Row label="Cuti Nasional" value={item.cuti_nasional_hari} isMuted />
                                    </DetailSection>

                                    {/* === PENGGAJIAN === */}
                                    <DetailSection periodKey={periodKey} sectionKey="penggajian" title="Penggajian" icon="💰" color="green">
                                        <Row label="Upah Dasar (payrate)" value={item.upah_dasar} isRate />
                                        <Row label="Gaji Pokok Ideal (rate × HK)" value={item.gaji_pokok_ideal} isMuted />
                                        <Row label="Gaji Pokok Aktual" value={item.gaji_pokok_aktual || item.gaji_pokok} />
                                        <Row label="Koreksi HK" value={item.koreksi_hk} isNegative={item.koreksi_hk < 0} />
                                        <Row label="Gaji Pokok Bulanan (rate × 30)" value={item.gaji_pokok_bulanan} isMuted />
                                    </DetailSection>

                                    {/* === TUNJANGAN === */}
                                    <DetailSection periodKey={periodKey} sectionKey="tunjangan" title="Tunjangan" icon="🎁" color="teal">
                                        <Row label="Beras (rate)" value={item.beras_rate} isRate />
                                        <Row label="Beras (jumlah)" value={item.beras_jumlah} />
                                        <Row label="Jabatan (rate)" value={item.jabatan_rate} isRate />
                                        <Row label="Jabatan (jumlah)" value={item.jabatan_jumlah} />
                                        <Row label="Masa Kerja (tahun)" value={item.masa_kerja_tahun} />
                                        <Row label="Masa Kerja (rate)" value={item.masa_kerja_rate} isRate />
                                        <Row label="Masa Kerja (jumlah)" value={item.masa_kerja_jumlah} />
                                        <Row label="Total Tunjangan" value={item.total_tunjangan} isTotal />
                                    </DetailSection>

                                    {/* === LEMBUR === */}
                                    <DetailSection periodKey={periodKey} sectionKey="lembur" title="Lembur" icon="⏰" color="orange">
                                        <Row label="Jam Lembur" value={item.lembur_jam} />
                                        <Row label="Rate Lembur" value={item.lembur_rate} isRate />
                                        <Row label="Jumlah Lembur" value={item.lembur_jumlah} isTotal />
                                    </DetailSection>

                                    {/* === PREMI === */}
                                    <DetailSection periodKey={periodKey} sectionKey="premi" title="Premi" icon="🏆" color="purple">
                                        <Row label="Brondol" value={item.premi_brondol} />
                                        {item.premi_pph > 0 && <Row label="PPH (penambah)" value={item.premi_pph} />}
                                        {/* Dynamic premi fields */}
                                        {item.premi && typeof item.premi === 'object' && Object.entries(item.premi)
                                            .filter(([k]) => k !== 'brondol' && k !== 'koreksi')
                                            .map(([key, val]) => (
                                                <Row key={key} label={key.replace(/_/g, ' ').toUpperCase()} value={val} />
                                            ))}
                                        <Row label="Total Premi" value={item.total_premi} isTotal />
                                    </DetailSection>

                                    {/* === POTONGAN UPAH KOTOR === */}
                                    {(item.pot_koreksi > 0 || item.premi_koreksi > 0) && (
                                        <DetailSection periodKey={periodKey} sectionKey="pot_kotor" title="Potongan Upah Kotor" icon="✂️" color="amber">
                                            <Row label="Koreksi" value={item.pot_koreksi || item.premi_koreksi} isNegative />
                                            {item.potongan_upah_kotor_details && Object.entries(item.potongan_upah_kotor_details)
                                                .filter(([k]) => k !== 'total' && k !== 'koreksi')
                                                .map(([key, val]) => (
                                                    <Row key={key} label={key.replace(/_/g, ' ').toUpperCase()} value={val} isMuted />
                                                ))}
                                        </DetailSection>
                                    )}

                                    {/* === POTONGAN UPAH BERSIH === */}
                                    <DetailSection periodKey={periodKey} sectionKey="potongan" title="Potongan Upah Bersih" icon="📉" color="red">
                                        <Row label="SPSI" value={item.pot_spsi} isNegative />
                                        <Row label="PPH21" value={item.pot_pph21} isNegative />
                                        <Row label="ASTEK Pekerja" value={item.pot_astek_pekerja || item.pot_astek} isNegative />
                                        <Row label="ASTEK Majikan" value={item.pot_astek_majikan || item.pot_astek_maj} isMuted />
                                        <Row label="ASTEK Jumlah" value={item.pot_astek_jumlah} isMuted />
                                        <Row label="BPJS Kes. Pekerja" value={item.pot_bpjs_kesehatan_pekerja} isNegative />
                                        <Row label="BPJS Kes. Majikan" value={item.pot_bpjs_kesehatan_majikan} isMuted />
                                        <Row label="BPJS Pensiun Pekerja" value={item.pot_bpjs_pensiun_pekerja} isNegative />
                                        <Row label="BPJS Pensiun Majikan" value={item.pot_bpjs_pensiun_majikan} isMuted />
                                        {item.premi_pph > 0 && <Row label="Premi PPH (penambah)" value={`+${fmt(item.premi_pph)}`} />}
                                        <Row label="Total Potongan" value={item.total_potongan} isTotal isNegative />
                                    </DetailSection>

                                    {/* === PAJAK PPH21 === */}
                                    <DetailSection periodKey={periodKey} sectionKey="pajak" title="PPH21 TER" icon="🏛️" color="slate">
                                        <Row label="Status PTKP" value={item.status_ptkp || '-'} />
                                        <Row label="Kategori TER" value={item.kategori_ter || '-'} />
                                        <Row label="Penghasilan Bruto" value={item.penghasilan_bruto} />
                                        <Row label="Upah Kotor Pajak" value={item.upah_kotor_pajak} />
                                        <Row label="ASTEK 0.84%" value={item.astek_084} isMuted />
                                        <Row label="BPJS Kes. Majikan 4%" value={item.bpjs_kesehatan_majikan_4_pct} isMuted />
                                        <Row label="Tarif TER" value={`${Number(item.tarif_pajak_ter || 0).toFixed(2)}%`} />
                                        <Row label="PPH21 TER" value={item.pph21_ter} isTotal />
                                    </DetailSection>

                                    {/* === RINGKASAN FINAL === */}
                                    <div className="sht-final-summary">
                                        <div className="sht-final-row">
                                            <span>Jumlah Upah Kotor</span>
                                            <span>{fmt(item.jumlah_upah_kotor)}</span>
                                        </div>
                                        <div className="sht-final-row sht-final-negative">
                                            <span>Total Potongan</span>
                                            <span>-{fmt(item.total_potongan)}</span>
                                        </div>
                                        {item.premi_pph > 0 && (
                                            <div className="sht-final-row sht-final-positive">
                                                <span>Premi PPH</span>
                                                <span>+{fmt(item.premi_pph)}</span>
                                            </div>
                                        )}
                                        <div className="sht-final-row sht-final-net">
                                            <span>💵 Upah Bersih</span>
                                            <span>{fmt(item.upah_bersih)}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
