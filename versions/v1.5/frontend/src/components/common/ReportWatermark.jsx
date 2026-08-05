import React from 'react';

export default function ReportWatermark({
  imageSrc = '/images/rebinmas.webp',
  tileCount = 42,
}) {
  const safeTileCount = Number.isFinite(Number(tileCount))
    ? Math.max(1, Number(tileCount))
    : 42;

  return (
    <div className="report-watermark" aria-hidden="true">
      <div className="report-watermark__pattern">
        {Array.from({ length: safeTileCount }, (_, idx) => (
          <span key={idx} className="report-watermark__tile">
            <img className="report-watermark__image" src={imageSrc} alt="" />
          </span>
        ))}
      </div>
    </div>
  );
}
