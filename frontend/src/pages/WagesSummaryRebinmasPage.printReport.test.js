import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./WagesSummaryRebinmasPage.jsx', import.meta.url), 'utf8');

describe('WagesSummaryRebinmasPage print report wiring', () => {
  it('exports the full standard wages print set to PDF', () => {
    expect(source).toContain("document.getElementById(isStandardWagesMode ? 'wsp-report-print-set' : 'wsp-report-content')");
    expect(source).toContain('id="wsp-report-print-set"');
    expect(source).toContain('renderInfographicAppendixPage()');
    expect(source).toContain('LAMPIRAN INFOGRAFIS WAGES SUMMARY');
    expect(source).toContain('Halaman 1 dari 2');
  });
});
