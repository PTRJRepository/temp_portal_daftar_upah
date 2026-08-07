import React from 'react';

function formatRupiah(value) {
  if (!value && value !== 0) return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  if (num >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toFixed(2)} M`;
  if (num >= 1_000_000) return `Rp ${(num / 1_000_000).toFixed(2)} JT`;
  return `Rp ${num.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatNumber(value) {
  if (!value && value !== 0) return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  return num.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * ReportKpiCards - 4-column KPI card grid with change indicators
 */
export default function ReportKpiCards({ grandTotal, periodLabel, isLoading }) {
  if (isLoading) {
    return (
      <div className="srn-kpi-grid">
        {[1,2,3,4].map(i => (
          <div key={i} className="srn-kpi-card">
            <div className="srn-kpi-label">Loading...</div>
            <div className="srn-kpi-value">-</div>
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Workers',
      value: formatNumber(grandTotal?.total_employees),
      change: null,
      highlight: false,
    },
    {
      label: 'Total HK Chekroll',
      value: formatNumber(grandTotal?.total_hk),
      change: null,
      highlight: false,
    },
    {
      label: 'Total Premi',
      value: formatRupiah(grandTotal?.total_premi),
      change: '+5.76% vs prev',
      highlight: false,
    },
    {
      label: 'Total Upah Bersih',
      value: formatRupiah(grandTotal?.total_upah_bersih),
      change: '+5.21% vs prev',
      highlight: true,
    },
  ];

  return (
    <div className="srn-kpi-grid">
      {cards.map((card, idx) => (
        <div key={idx} className={`srn-kpi-card${card.highlight ? ' highlight' : ''}`}>
          <div className="srn-kpi-label">{card.label}</div>
          <div className="srn-kpi-value">{card.value}</div>
          {card.change && (
            <div className="srn-kpi-change">
              <span className="srn-kpi-change-icon">↑</span>
              {card.change.replace('+', '')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * PrintKpiRow - Compact KPI row for print pages
 */
export function PrintKpiRow({ items }) {
  return (
    <div className="srn-print-kpis">
      {items.map((item, idx) => (
        <div key={idx} className="srn-print-kpi">
          <label>{item.label}</label>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}