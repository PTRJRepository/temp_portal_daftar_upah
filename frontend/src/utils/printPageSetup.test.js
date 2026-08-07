/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureReportPrintPageSetup, printReport, enterPrintMode, exitPrintMode, isPrintModeActive } from './printPageSetup';

describe('printPageSetup', () => {
  afterEach(() => {
    document.getElementById('report-print-page-setup')?.remove();
    vi.restoreAllMocks();
  });

  it('injects a landscape A4 page setup by default', () => {
    ensureReportPrintPageSetup();

    const style = document.getElementById('report-print-page-setup');
    expect(style?.textContent).toContain('size: A4 landscape');
    expect(style?.textContent).toContain('margin: 8mm');
  });

  it('replaces the print setup when portrait is explicitly requested', () => {
    ensureReportPrintPageSetup();
    ensureReportPrintPageSetup({ orientation: 'portrait', margin: '0' });

    const style = document.getElementById('report-print-page-setup');
    expect(style?.textContent).toContain('size: A4 portrait');
    expect(style?.textContent).toContain('margin: 0');
    expect(style?.textContent).not.toContain('size: A4 landscape');
  });

  it('injects setup before opening the print dialog', async () => {
    window.print = vi.fn();

    printReport({ orientation: 'landscape', margin: '5mm' });

    expect(document.getElementById('report-print-page-setup')?.textContent).toContain('margin: 5mm');
    // Print is deferred one frame so React can commit revealed content first.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(isPrintModeActive()).toBe(false);
  });

  it('toggles print mode on enter/exit so components can reveal hidden content', () => {
    enterPrintMode();
    expect(isPrintModeActive()).toBe(true);
    expect(document.documentElement.classList.contains('print-expanded')).toBe(true);
    exitPrintMode();
    expect(isPrintModeActive()).toBe(false);
    expect(document.documentElement.classList.contains('print-expanded')).toBe(false);
  });
});
