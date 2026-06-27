import React from 'react';

/**
 * ReportMiniStats - 4-column mini statistics grid
 * Icons: D (divisi), G (gang), P (premi), T (tanggal)
 */
export default function ReportMiniStats({ totalDivisi, totalGang, totalJenisPremi, printDate }) {
  const stats = [
    {
      icon: 'D',
      label: 'Total Divisi',
      value: totalDivisi ?? '-',
    },
    {
      icon: 'G',
      label: 'Total Gang',
      value: totalGang ?? '-',
    },
    {
      icon: 'P',
      label: 'Jenis Premi',
      value: totalJenisPremi ?? '-',
    },
    {
      icon: 'T',
      label: 'Tanggal Cetak',
      value: printDate ?? '-',
    },
  ];

  return (
    <div className="srn-mini-stats">
      {stats.map((s, idx) => (
        <div key={idx} className="srn-mini">
          <div className="srn-mini-icon">{s.icon}</div>
          <div>
            <div className="srn-mini-label">{s.label}</div>
            <div className="srn-mini-value">{s.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}