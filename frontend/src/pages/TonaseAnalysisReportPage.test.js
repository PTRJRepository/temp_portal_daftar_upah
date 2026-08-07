import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TonaseAnalysisReportPage.jsx', import.meta.url), 'utf8');

describe('TonaseAnalysisReportPage source', () => {
  it('uses the tonase report API and print workflow', () => {
    expect(source).toContain("import { fetchTonaseAnalysisReport } from '../services/dashboardService';");
    expect(source).toContain("printReport({ orientation: 'landscape' })");
    expect(source).toContain("division_code: 'REBINMAS'");
    expect(source).toContain('reportData?.division_breakdown');
    expect(source).toContain('reportData?.division_details');
  });

  it('renders the requested efficiency metrics and drilldown', () => {
    expect(source).toContain('Total Tonase TBS');
    expect(source).toContain('Upah Kotor / Ton');
    expect(source).toContain('Upah Kotor / HK');
    expect(source).toContain('Premi / Ton');
    expect(source).toContain('Gang Panen');
    expect(source).toContain('Breakdown Divisi');
    expect(source).toContain('Komposisi Cost/Ton');
    expect(source).toContain('Efisiensi: Produktivitas vs Cost/Ton');
    expect(source).toContain('Tren — Tonase & Upah/HK');
    expect(source).toContain('Uraian Premi per Divisi');
    expect(source).toContain('selectedDivision');
    expect(source).toContain('Bedah Divisi');
    expect(source).toContain('CostPerTonPanel');
  });
});
