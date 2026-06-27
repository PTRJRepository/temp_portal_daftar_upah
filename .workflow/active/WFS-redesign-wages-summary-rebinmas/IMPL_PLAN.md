# Implementation Plan: Redesign Wages Summary Report Rebinmas

## 1. Requirements Summary

Redesign the existing Wages Summary Rebinmas report to match Alternative 5 - Professional Grid Dark Blue from the supplied PRD and `C:\Users\ITDPC\Downloads\preview.html` reference.

The implementation should deliver:

- Professional dark-blue corporate report styling for web preview and print.
- A standard Wages Summary report with sidebar/topbar context inherited from the existing app and a stronger toolbar/action area.
- Four KPI cards: Total Gang, Total Pekerja, Total HK Checkroll, Total Upah Bersih.
- Main grouped table with Estate/Divisi, Manpower, Deductions, Income, and Perbandingan columns.
- Section, detail, subtotal, and grand total row styles matching the PRD.
- Print/PDF output in A4 landscape with three pages for standard Wages Summary:
  1. Wages Summary utama.
  2. Audit breakdown deductions / potongan.
  3. Audit breakdown income / pendapatan.
- Footer, watermark, metadata chips, audit status, and signature area.
- Selisih visibility and audit flag: `OK` when `selisih === 0`, `Review` otherwise.

Out of scope: formula changes, database changes, backend aggregation changes, approval workflow, digital signatures, employee-level drilldown, and advanced Excel export.

## 2. Architecture Decisions

Use the existing `WagesSummaryRebinmasPage.jsx` entry point and current backend data contract. The summary endpoint already provides the fields required for the main table and audit pages, so the redesign should be a frontend data-shaping and rendering change.

Recommended component strategy:

- Keep page-level mode state, fetching, filters, and existing handlers in `WagesSummaryRebinmasPage.jsx`.
- Add pure data helpers in the same file first, or extract to `frontend/src/utils/wagesSummaryAudit.js` if tests need direct imports.
- Add small render components only when they reduce duplication: report shell/header, audit summary table, audit detail table, audit note/checklist, and footer.
- Scope CSS using `.wages-rebinmas-print-document`, `.wages-rebinmas-page`, `.wages-audit-page`, and related classes to avoid leaking into Summary Report, THR, and comparison modes.
- Reuse `ReportPrintMetadata`, `ReportWatermark`, `PrintSignature`, and `printReport`.

## 3. Task Breakdown

### IMPL-1: Prepare Standard Wages Data Model

Create a frontend data model for the redesigned standard Rebinmas report.

Work items:

- Normalize standard-mode rows from `summaryData` into grouped estate/division rows.
- Derive `total_potongan = total_pph21 + total_spsi` for deduction audit rows.
- Derive `total_income = total_premi_excluding_special || total_premi + total_lembur` for income audit rows.
- Derive `audit_status` / `audit_remark` from `selisih`.
- Derive estate-level audit summaries from group divisions and group subtotals.
- Keep all formatting through the existing `formatNumber` convention.

Acceptance:

- Helper output supports main summary, deduction audit, and income audit from one source.
- Missing numeric values render as `0` in payroll amount contexts.
- No backend calls or formulas are changed.

### IMPL-2: Redesign Web Toolbar And KPI Area

Update standard-mode web preview controls and KPI cards to align with the PRD while preserving existing actions.

Work items:

- Keep division type, period, print, export CSV, refresh, THR mode, comparison, impact report, and edit mode controls.
- Apply professional compact toolbar styling with navy primary action and clear active-mode badges.
- Restyle KPI cards with navy borders, icon boxes, uppercase labels, large values, and sublabels.
- Use `lucide-react` icons already available in the project.

Acceptance:

- Web layout still exposes all existing functional controls.
- KPI cards match the dark-blue corporate visual direction.
- THR/comparison/impact modes remain reachable and are not redesigned accidentally.

### IMPL-3: Build Main Professional Grid Page

Update the standard Wages Summary page markup and styling.

Work items:

- Create a stronger three-column report header: logo, company/report info, print metadata.
- Keep metadata chips: mode, source, scope, estate, and description.
- Use grouped table headers for Estate/Divisi, Manpower, Deductions, Income, and Perbandingan.
- Apply navy headers, soft-blue section/subtotal rows, visible borders, and dark navy grand total.
- Add audit status chips or explicit status metadata derived from selisih totals.
- Preserve inline edit mode controls for SPSI and thumbprint on web only.

Acceptance:

- Main table visually distinguishes section, detail, subtotal, and grand total rows.
- Selisih column is always visible.
- Nonzero selisih gets review styling without changing calculation logic.

### IMPL-4: Add Deduction Audit Print Page

Add the second print page for potongan audit.

Work items:

- Render page 2 only for standard Wages Summary mode.
- Include consistent header, metadata, watermark, and footer.
- Add estate-level summary table: Estate, PPH 21, SPSI, Total Potongan.
- Add audit notes required by the PRD.
- Add detail audit table: Estate/Divisi, Workers, HK, PPH 21, SPSI, Total Potongan, Upah Bersih Portal, Thumb Print, Selisih, Status Audit.

Acceptance:

- Page 2 prints after the main summary page in A4 landscape.
- Rows with nonzero selisih are marked `Review`; zero rows are marked `OK`.
- Totals align with the same data used on page 1.

### IMPL-5: Add Income Audit Print Page And Signature/Footer System

Add the third print page for income audit and finalize page-level print metadata.

Work items:

- Render page 3 only for standard Wages Summary mode.
- Include estate-level summary table: Estate, Total Premi, Lembur, Upah Bersih.
- Add validation checklist required by the PRD.
- Add detail audit table: Estate/Divisi, Workers, HK, Total Premi, Lembur, Total Income, Upah Bersih Portal, Thumb Print, Selisih, Audit Remark.
- Place approval signatures on page 1 and/or page 3 per PRD, with four roles: Admin Payroll, HR Manager, Senior Manager, General Manager.
- Make footer consistently show printed date, system name, and page number `Halaman X dari 3`.

Acceptance:

- Standard print output has exactly the three expected pages by default.
- Page 3 contains checklist and signature area.
- Footer is consistent across all three pages.

### IMPL-6: Consolidate Print CSS For A4 Landscape

Add targeted print CSS and screen preview styles.

Work items:

- Keep `@page { size: A4 landscape; }` for standard Rebinmas print.
- Hide `.no-print`, toolbar, buttons, selects, and web helper elements in print.
- Ensure each print page has stable A4 landscape sizing and `page-break-after: always` except the last page.
- Ensure tables do not overflow horizontally by using fixed table layout, constrained columns, and compact type.
- Apply `print-color-adjust: exact` for navy headers/grand totals while keeping grayscale readability.
- Keep selectors scoped to standard `.wages-rebinmas-print-document` and new page classes.

Acceptance:

- Sidebar/topbar/toolbar are not printed.
- Only report pages print for standard Wages Summary.
- Borders remain visible and grand totals remain high contrast in Chrome/Edge print.

### IMPL-7: Add Focused Tests And Verification

Add tests that lock the redesign behavior without broad snapshot churn.

Recommended tests:

- Pure helper test for audit status and derived totals, if helper is extracted.
- CSS test for A4 landscape, print-only page visibility, page breaks, navy header/grand-total styling, and scoped selectors.
- Component/source test that standard mode includes deduction and income audit page structures.
- Existing print CSS tests continue to pass.

Suggested commands:

```powershell
cd frontend
npx vitest run src/styles/wages-summary-print-simple.test.js src/styles/wages-summary-professional.test.js
npm run build
```

If a helper test is added:

```powershell
cd frontend
npx vitest run src/utils/wagesSummaryAudit.test.js
```

For final visual verification, start the frontend test server and inspect the Wages Rebinmas report in browser print preview.

## 4. Implementation Strategy

Use a phased sequential strategy.

1. Build data helpers first so all three pages use the same computed values.
2. Add audit print page markup behind standard-mode conditions.
3. Update the main report styling and toolbar/KPI styling.
4. Add print CSS after markup is stable.
5. Add tests and run focused verification.
6. Run build only after focused tests pass.

Avoid broad component extraction until the three-page report works. The existing page is large, but a full refactor would increase risk in THR/comparison/impact modes.

## 5. Risk Assessment

Risk: CSS cascade conflicts across existing print files.
Mitigation: Use scoped selectors and add CSS tests for the new standard-mode print classes.

Risk: Three print pages may affect THR/comparison modes.
Mitigation: Render audit pages only when `!thrMode && !comparisonMode && !impactReportMode`.

Risk: Signature/footer page-break behavior may vary in print engines.
Mitigation: Use explicit page containers, `break-after`, and browser print verification.

Risk: Existing worktree has unrelated changes.
Mitigation: Before implementation, re-check `git status --short` and only edit files listed in the implementation task.

## Done Criteria

- Standard Wages Summary Rebinmas web preview matches the Professional Grid Dark Blue direction.
- Standard print output has three A4 landscape pages: summary, deductions audit, income audit.
- KPI cards, metadata, watermark, audit status, footer, and signatures are present.
- Main, deduction, and income totals all derive from the same current backend data.
- Focused tests pass and frontend build succeeds.
