import { useEffect, useState } from 'react';

const PRINT_PAGE_SETUP_ID = 'report-print-page-setup';

const PRINT_EXPAND_CLASS = 'print-expanded';
let printModeActive = false;

// Subscribers notified on enter/exit so React components re-render revealed content.
const listeners = new Set();
function emitPrintModeChange() {
  listeners.forEach((fn) => fn(printModeActive));
}

export function isPrintModeActive() {
  return printModeActive;
}

export function enterPrintMode() {
  if (printModeActive || typeof document === 'undefined') return;
  printModeActive = true;
  document.documentElement.classList.add(PRINT_EXPAND_CLASS);
  emitPrintModeChange();
}

export function exitPrintMode() {
  if (!printModeActive || typeof document === 'undefined') return;
  printModeActive = false;
  document.documentElement.classList.remove(PRINT_EXPAND_CLASS);
  emitPrintModeChange();
}

/**
 * React hook: true while a print is in progress, so components can reveal
 * state-hidden content (tabs, expanded rows, "show detail" toggles).
 * Works for both the in-app print button and Ctrl+P.
 */
export function usePrintExpand() {
  const [active, setActive] = useState(isPrintModeActive());

  useEffect(() => {
    listeners.add(setActive);
    return () => listeners.delete(setActive);
  }, []);

  useEffect(() => {
    const onBefore = () => enterPrintMode();
    const onAfter = () => exitPrintMode();
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, []);

  return active;
}

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
  enterPrintMode();
  // One frame lets React commit the revealed content before the dialog opens.
  const defer = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 0);
  defer(() => {
    window.print();
    exitPrintMode();
  });
}
