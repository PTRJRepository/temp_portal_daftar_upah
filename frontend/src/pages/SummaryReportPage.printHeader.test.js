import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./SummaryReportPage.jsx', import.meta.url), 'utf8');
const headerSource = readFileSync(new URL('../components/common/ReportPrintHeader.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/summary-report-new.css', import.meta.url), 'utf8');

describe('SummaryReportPage redesigned print header', () => {
  it('renders the company kop on all three printable pages', () => {
    expect(pageSource.match(/<ReportPrintHeader/g)).toHaveLength(3);
    expect(pageSource).toContain('id="print-page-1"');
    expect(pageSource).toContain('id={`print-page-${pageNumber}`}');
    expect(pageSource).toContain('id={`print-page-${pageNumber}`}');
    expect(pageSource).toContain('Hal. 1 / {totalPages}');
    expect(pageSource).toContain('Hal. {pageNumber} / {totalPages}');
    expect(pageSource).toContain('detailPrintPages.map');
    expect(pageSource.indexOf('detailPrintPages.map')).toBeLessThan(pageSource.indexOf('<PrintPage2'));
    expect(pageSource).toContain('pageNumber={pageIdx + 2}');
    expect(pageSource).toContain('pageNumber={premiPrintPageNumber}');
  });

  it('uses the Rebinmas asset logo instead of a generated/background-only print logo', () => {
    expect(headerSource).toContain('className="srn-paper-logo"');
    expect(headerSource).toContain('REBINMAS_LOGO_SRC');
    expect(headerSource).toContain('images/rebinmas.webp');
    expect(pageSource).toContain('REBINMAS_LOGO_SRC');
    expect(headerSource).toContain('PT. REBINMAS JAYA');
    expect(headerSource).toContain('srn-paper-accent-line');
    expect(headerSource).not.toContain('srn-paper-header-deco');
  });

  it('keeps print logo, metadata, and accent line visible without cropping', () => {
    expect(css).toMatch(/\.srn-paper\s*{[\s\S]*aspect-ratio:\s*297\s*\/\s*210;/);
    expect(css).toMatch(/\.srn-paper\s*{[\s\S]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.srn-paper-logo\s*{[\s\S]*overflow:\s*visible;/);
    expect(css).toMatch(/\.srn-paper-logo\s*{[\s\S]*object-fit:\s*contain;/);
    expect(css).toMatch(/\.srn-paper-meta\s*{[\s\S]*white-space:\s*pre-line;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper-header\s*{[\s\S]*display:\s*grid\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper-logo\s*{[\s\S]*object-fit:\s*contain\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper-accent-line\s*{[\s\S]*display:\s*block\s*!important;/);
  });

  it('keeps thumbprint as right-side table columns and printable A4 setup', () => {
    expect(pageSource).toContain('<th>THUMBPRINT</th>');
    expect(pageSource).toContain('<th>SELISIH</th>');
    expect(pageSource).toContain('summary-compare-cell');
    expect(pageSource).toContain('function buildThumbprintRowSpans');
    expect(pageSource).toContain('function formatComparisonThumbprint');
    expect(pageSource).toContain('function formatComparisonSelisih');
    expect(pageSource).toContain('rowSpan={comparisonCell.rowSpan}');
    expect(pageSource).toContain('Lanjutan Detail Per Gang / Estate');
    expect(pageSource).toContain('thumb_print');
    expect(pageSource).toContain('PRINT_SUMMARY_ROWS');
    expect(pageSource).toContain('PRINT_DETAIL_ROWS_PER_PAGE');
    expect(pageSource).toContain('filteredData.slice(PRINT_SUMMARY_ROWS)');
    expect(pageSource).toContain('chunkRows(detailPrintRows, PRINT_DETAIL_ROWS_PER_PAGE)');
    expect(pageSource).toContain("printReport({ orientation: 'landscape' })");
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*@page\s*{[\s\S]*margin:\s*6mm;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper\s*{[\s\S]*overflow:\s*visible\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper\s*{[\s\S]*display:\s*flex\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper\s*{[\s\S]*flex-direction:\s*column\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper \+ \.srn-paper\s*{[\s\S]*break-before:\s*page\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper-header\s*{[\s\S]*break-after:\s*avoid\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-page-container > :not\(\.srn-print-section\),[\s\S]*\.srn-content-body > :not\(\.srn-print-section\)\s*{[\s\S]*display:\s*none\s*!important;/);
  });

  it('keeps print rowspan cells aligned and places signatures after the gang detail table', () => {
    const printPage2Block = pageSource.slice(
      pageSource.indexOf('function PrintPage2'),
      pageSource.indexOf('// ---- Print Page 3')
    );
    const printPage3Block = pageSource.slice(
      pageSource.indexOf('function PrintPage3'),
      pageSource.indexOf('// ===== MAIN COMPONENT')
    );

    expect(pageSource).not.toContain('<td className="num-cell summary-compare-cell">-</td>');
    expect(pageSource).toContain('{comparisonCell && (');
    expect(pageSource).toContain('formatComparisonThumbprint(comparisonCell)');
    expect(pageSource).toContain('formatComparisonSelisih(comparisonCell)');
    expect(printPage2Block).not.toContain('srn-paper-with-signature');
    expect(printPage2Block).not.toContain('<SignatureSection />');
    expect(printPage3Block).toContain("isLastDetailPage ? ' srn-paper-with-signature' : ''");
    expect(printPage3Block).toContain('{isLastDetailPage && <SignatureSection />}');
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper-with-signature\s*{[\s\S]*min-height:\s*calc\(210mm - 12mm\)\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-signatures\s*{[\s\S]*display:\s*grid\s*!important;/);
    expect(css).toMatch(/@media\s+print\s*{[\s\S]*\.srn-paper-with-signature \.srn-paper-footer\s*{[\s\S]*position:\s*static\s*!important;/);
  });

  it('uses gang composition for the distribution chart when a division is selected', () => {
    expect(pageSource).toContain('function DistributionDonutChart');
    expect(pageSource).toContain("selectedDivisionLevel ? 'Distribusi Premi Per Gang' : 'Distribusi Premi Per Divisi'");
    expect(pageSource).toContain("? (row.gang_description || row.gang_code || 'Lainnya')");
  });

  it('builds the premium detail page from the selected division totals and previous extend_db_ptrj period', () => {
    expect(pageSource).toContain('function buildPremiBreakdown');
    expect(pageSource).toContain('const [previousSummaryData, setPreviousSummaryData] = useState([])');
    expect(pageSource).toContain('useHistory: true');
    expect(pageSource).toContain('previousPeriodLabel');
    expect(pageSource).toContain('premiBreakdownData={premiBreakdownData}');
    expect(pageSource).toContain('previousGrandTotal={previousGrandTotal}');
    expect(pageSource).toContain('<th>BULAN LALU</th>');
    expect(pageSource).toContain('<th>SELISIH</th>');
    expect(pageSource).toContain('{formatNumber(grandTotal?.total_premi)}');
    expect(pageSource).not.toContain("{ no: 1, name: 'Premi Raking'");
    expect(pageSource).not.toContain('2.263.864.707');
    expect(pageSource).toContain('Pilih satu divisi terlebih dahulu');
  });

  it('defaults the report to the primary AB1 division and keeps premium print rows bounded', () => {
    expect(pageSource).toContain("const DEFAULT_DIVISION = 'AB1'");
    expect(pageSource).toContain('useState(initialDivision || DEFAULT_DIVISION)');
    expect(pageSource).toContain("useState('real')");
    expect(pageSource).toContain('PRINT_PREMI_ROWS');
    expect(pageSource).toContain('function compactPremiRowsForPrint');
    expect(pageSource).toContain('const printPremiRows = compactPremiRowsForPrint(premiBreakdownData)');
  });
});
