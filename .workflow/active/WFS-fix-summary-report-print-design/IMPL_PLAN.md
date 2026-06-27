# Implementation Plan: Fix Summary Report Print Design

## Goal

Repair the Summary Report Payroll design issues reported by the user, with priority on print/PDF output:

- Logo must not be cropped.
- Header decoration must not distract from the report title/kop.
- Printed report must include company logo, company name, report title, period, metadata, and footer on all three pages.
- Print layout must remain A4 landscape and formal.

## Scope

### In Scope

- `ReportPrintHeader` visual structure.
- Summary Report print CSS in `summary-report-new.css`.
- Print page header usage in `SummaryReportPage.jsx` if needed.
- Focused frontend tests for print header and CSS behavior.
- Visual verification through frontend build/test and browser print media inspection where feasible.

### Out of Scope

- Payroll calculation changes.
- Backend/API changes.
- Database changes.
- Export Excel/CSV changes unless print button behavior depends on them.

## Implementation Tasks

### IMPL-1: Stabilize Print Header And Logo

Update `frontend/src/components/common/ReportPrintHeader.jsx` so the print header uses a non-cropped, print-friendly logo/kop.

Recommended changes:

- Replace the CSS-only `.srn-paper-logo` block with an inline SVG logo mark or explicit markup that survives print without relying on background images.
- Remove the current large curved SVG decoration or replace it with a subtle, bounded accent rule.
- Structure header as: logo + company identity on left, report metadata on right.
- Add semantic class hooks such as `.srn-paper-logo-mark`, `.srn-paper-title-block`, and `.srn-paper-accent-line`.

Acceptance for this task:

- Logo has stable width/height and `overflow: visible` or proper viewBox.
- Header decoration cannot overlap logo/meta.
- Print header component still accepts `title`, `period`, and `meta`.

### IMPL-2: Fix Print CSS For A4 Landscape Output

Update `frontend/src/styles/summary-report-new.css` print rules.

Recommended changes:

- Ensure `.srn-paper-header`, `.srn-paper-brand`, `.srn-paper-logo`, and related logo SVG classes are visible under `@media print`.
- Add `print-color-adjust: exact` and `-webkit-print-color-adjust: exact` to print paper/header elements.
- Remove or reduce header gradient/decorative SVG in print.
- Replace heavy header border with a formal thin navy rule plus accent segment.
- Ensure `.srn-paper` uses `box-sizing: border-box` and does not clip the header logo.
- Keep `width: 297mm`, `height: 210mm`, `padding: 10mm`, and `page-break-after: always`.

Acceptance for this task:

- Every `.srn-paper` page has visible logo/kop in print media.
- Header content is not clipped by `.srn-paper` overflow.
- Footer remains visible with page numbering.

### IMPL-3: Preserve Existing Summary Report Behavior

Review `frontend/src/pages/SummaryReportPage.jsx` to confirm all three print pages still render `ReportPrintHeader` and that print button calls the existing print behavior.

Recommended changes:

- Only change page markup if needed to pass title/subtitle/metadata more clearly.
- Do not alter payroll data calculations or table rendering.
- Keep print pages ordered Summary, Uraian Premi, Detail Gang.

Acceptance for this task:

- Page 1, page 2, and page 3 each render the improved `ReportPrintHeader`.
- Signature area remains on page 1.
- Footer page numbers remain `Hal. 1 / 3`, `Hal. 2 / 3`, `Hal. 3 / 3`.

### IMPL-4: Add/Update Tests

Update focused tests to lock the print fixes.

Recommended tests:

- Component/source test verifies `ReportPrintHeader` contains print-friendly logo markup and no longer depends only on CSS background logo.
- CSS test verifies print visibility rules for `.srn-paper-header`, logo mark, and metadata.
- CSS test verifies the distracting header decoration is hidden or reduced in print.
- Existing print foundation tests continue to pass.

Acceptance for this task:

- Focused Vitest tests pass.
- No snapshot or broad unrelated test churn.

### IMPL-5: Verify Build And Visual Print Output

Run the smallest relevant tests first, then build.

Recommended commands:

```powershell
cd frontend
npx vitest run src/pages/SummaryReportPage.printHeader.test.js src/styles/report-print-foundation.test.js
npm run build
```

If a local dev server is needed for visual inspection:

```powershell
cd frontend
npm run dev:test
```

Then inspect the Summary Report page in browser/print media to confirm:

- Logo is not cropped.
- Header/kop appears on all three print pages.
- Accent/header decoration is restrained.
- A4 landscape pages are not cutting off header/footer.

## Risk Notes

- The relevant frontend files are already modified/untracked in the worktree. Implementation should inspect `git diff -- frontend/src/pages/SummaryReportPage.jsx frontend/src/pages/SummaryReportPage.printHeader.test.js frontend/src/styles/report-print-foundation.test.js` and avoid overwriting unrelated work.
- Browser print may hide background colors if user disables background printing. Inline SVG logo and text-based kop reduce this risk.
- Existing CSS tests may assert older WSP print behavior; keep additions scoped to `srn-*` classes to avoid breaking legacy report print foundations.

## Done Criteria

- Printout header/logo/kop appears on pages 1, 2, and 3.
- Logo is not cropped in preview or print media.
- Header gradient/decorative lines no longer distract from report identity.
- Focused tests pass.
- Frontend build succeeds.
