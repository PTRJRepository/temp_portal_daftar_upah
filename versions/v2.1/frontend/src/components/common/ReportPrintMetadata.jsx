import React from 'react';

export default function ReportPrintMetadata({
  mode,
  source,
  scope,
  estate,
  note,
  items = [],
}) {
  const metadataItems = [
    { label: 'Mode', value: mode },
    { label: 'Sumber', value: source },
    { label: 'Scope', value: scope },
    { label: 'Estate', value: estate },
    ...items,
  ].filter((item) => String(item?.value ?? '').trim() !== '');

  if (metadataItems.length === 0 && !note) return null;

  return (
    <>
      {metadataItems.length > 0 && (
        <div className="report-print-meta-grid">
          {metadataItems.map((item) => (
            <span className="report-source-badge" key={`${item.label}:${item.value}`}>
              {item.label}: {item.value}
            </span>
          ))}
        </div>
      )}
      {note && (
        <div className="report-print-note">
          {note}
        </div>
      )}
    </>
  );
}
