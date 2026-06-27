import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./exportPayslipsToExcel.js', import.meta.url), 'utf8');

describe('exportPayslipsToExcel', () => {
  it('exports the payslip batch as four printable cards per portrait sheet like the PDF layout', () => {
    expect(source).toContain('const CARDS_PER_PAGE = 4;');
    expect(source).toContain("orientation: 'portrait'");
    expect(source).toContain('renderPayslipCard(worksheet, item, meta, startRow, startCol);');
    expect(source).toContain('PENERIMAAN');
    expect(source).toContain('POTONGAN');
    expect(source).toContain('PENERIMAAN BERSIH (Take Home Pay)');
    expect(source).toContain('worksheet.pageSetup.printArea');
    expect(source).toContain('function applyCutGuides(worksheet, lastRow)');
    expect(source).toContain('function applyCardOutline(worksheet, startRow, startCol, endRow, endCol)');
    expect(source).toContain('function applySectionDivider(worksheet, startRow, endRow, dividerCol)');
    expect(source).toContain('shrinkToFit: true');
  });

  it('keeps the Excel brondol calculation aligned with the PDF payslip', () => {
    expect(source).toContain('function getKoreksiBrondolTotal(payroll)');
    expect(source).toContain('premiBrondolBase - koreksiBrondolTotal');
    expect(source).toContain("!normalizedKey.includes('brondol')");
  });

  it('keeps premi PPh as a net-pay credit and excludes employer ASTEK totals', () => {
    expect(source).toContain("getNum(payroll, employee, 'pot_astek_pekerja')");
    expect(source).not.toContain("getNum(payroll, employee, 'pot_astek') || getNum(payroll, employee, 'pot_astek_jumlah')");
    expect(source).toContain('const totalPotongan = deductions.reduce(');
    expect(source).not.toContain('), 0) + premiPph;');
  });

  it('declares the footer row before section divider rendering to avoid runtime TDZ failures', () => {
    expect(source.indexOf('const footerRow = endRow;')).toBeLessThan(source.indexOf('applySectionDivider(worksheet, contentStart'));
  });
});
