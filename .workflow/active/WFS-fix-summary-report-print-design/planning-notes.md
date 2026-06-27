# Planning Notes

## User Request

User has an existing PRD for Summary Report Payroll redesign using Alternative 6, Clean Modern Corporate Dark Blue. Current defects:

- Report logo is cropped.
- Header gradient/decoration is visually distracting.
- Printed output loses the logo and company letterhead/kop.
- Printout design needs primary attention.

## Context Gathered

- Main page: `frontend/src/pages/SummaryReportPage.jsx`
- Print header component: `frontend/src/components/common/ReportPrintHeader.jsx`
- New design styles: `frontend/src/styles/summary-report-new.css`
- Existing tests:
  - `frontend/src/pages/SummaryReportPage.printHeader.test.js`
  - `frontend/src/styles/report-print-foundation.test.js`

## Existing Implementation Notes

- Print pages are rendered as three `article.srn-paper` nodes: `print-page-1`, `print-page-2`, `print-page-3`.
- `ReportPrintHeader` currently renders a CSS-only logo block plus an SVG top-right curved decoration.
- `.srn-paper` uses `overflow: hidden`, fixed print dimensions, and `padding: 10mm` under print.
- Header decoration is positioned absolute at top-right and can compete with metadata/kop.
- The logo is a small background-gradient div, so print engines may omit or degrade it when background printing is disabled.

## Conflict / Worktree Risk

The worktree has many existing modified files, including all relevant files for this task:

- `frontend/src/pages/SummaryReportPage.jsx`
- `frontend/src/pages/SummaryReportPage.printHeader.test.js`
- `frontend/src/styles/report-print-foundation.test.js`
- Untracked `frontend/src/components/common/ReportPrintHeader.jsx`
- Untracked `frontend/src/styles/summary-report-new.css`

Implementation must inspect diffs before editing and only touch the files required for this task.

## Planning Decision

Keep the current report structure, but simplify and harden the print header:

- Use a real inline SVG logo mark instead of CSS background logo.
- Replace distracting gradient/curved decoration with a restrained corporate rule/accent line.
- Make the print header self-contained and visible in print.
- Add CSS print rules that force logo, letterhead, metadata, and footer visibility.
- Add tests that protect the logo/kop and reduced header decoration behavior.
