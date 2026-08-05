import React from 'react';

const REBINMAS_LOGO_SRC = `${import.meta.env.BASE_URL || '/'}images/rebinmas.webp`;

export default function ReportPrintHeader({ title, subtitle, period, meta }) {
  return (
    <div className="srn-paper-header">
      <div className="srn-paper-brand">
        <img className="srn-paper-logo" src={REBINMAS_LOGO_SRC} alt="PT. Rebinmas Jaya" />
        <div className="srn-paper-title-block">
          <h3 className="srn-paper-brand-name">PT. REBINMAS JAYA</h3>
          <p className="srn-paper-brand-sub">{title}</p>
          {subtitle && <p className="srn-paper-brand-subtitle">{subtitle}</p>}
          <p className="srn-paper-brand-period">{period}</p>
        </div>
      </div>

      {meta && (
        <div className="srn-paper-meta">
          {meta}
        </div>
      )}

      <div className="srn-paper-accent-line" aria-hidden="true" />
    </div>
  );
}
