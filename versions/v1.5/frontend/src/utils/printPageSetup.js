const PRINT_PAGE_SETUP_ID = 'report-print-page-setup';

export function ensureReportPrintPageSetup({ orientation = 'landscape', margin = '8mm' } = {}) {
  if (typeof document === 'undefined') return;

  const normalizedOrientation = orientation === 'portrait' ? 'portrait' : 'landscape';
  const style = document.getElementById(PRINT_PAGE_SETUP_ID) || document.createElement('style');
  style.id = PRINT_PAGE_SETUP_ID;
  style.textContent = `
@page {
  size: A4 ${normalizedOrientation};
  margin: ${margin};
}
@media print {
  @page {
    size: A4 ${normalizedOrientation};
    margin: ${margin};
  }
  html,
  body,
  #root {
    width: 100% !important;
    height: auto !important;
    overflow: visible !important;
  }
}
`;

  if (!style.parentNode) {
    document.head.appendChild(style);
  }
}

export function printReport({ orientation = 'landscape', margin = '8mm' } = {}) {
  ensureReportPrintPageSetup({ orientation, margin });
  window.print();
}
