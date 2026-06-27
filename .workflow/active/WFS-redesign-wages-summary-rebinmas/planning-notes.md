# Planning Notes

## User Intent

GOAL: Redesign the Wages Summary / Rekapitulasi Daftar Upah Rebinmas report to match the supplied PRD and `preview.html` reference for Alternative 5 - Professional Grid Dark Blue.

SCOPE: Frontend implementation plan for the existing Wages Rebinmas report page, toolbar, KPI cards, main summary table, print/PDF layout, and added audit breakdown pages for deductions and income. Keep backend formulas and database unchanged.

CONTEXT: The existing implementation is `frontend/src/pages/WagesSummaryRebinmasPage.jsx`, backed by `frontend/src/services/summaryReportService.js`, styled mainly by `frontend/src/styles/wages-summary-professional.css`, `frontend/src/styles/wages-summary-print-simple.css`, and shared print foundation CSS.

## Session Awareness

- Recent overlapping session: `.workflow/active/WFS-fix-summary-report-print-design`, completed on 2026-06-05.
- That session targeted Summary Report print header/logo behavior, not Wages Rebinmas directly, but it introduced reusable print-header lessons: avoid cropped logo, preserve formal kop, keep A4 landscape print stable.
- Current git worktree contains many unrelated uncommitted changes. Implementation must only edit Wages Rebinmas files and any focused tests created for this task.

## Context Findings

- `WagesSummaryRebinmasPage.jsx` already fetches summary data, groups rows by estate prefix, renders KPI cards, supports print, CSV export, THR mode, comparison mode, impact report mode, edit mode, and thumbprint/SPSI edits.
- Standard Rebinmas summary currently renders one printable `.wsp-document` page. The PRD requires a three-page print set: main summary, deductions audit breakdown, and income audit breakdown.
- Existing fields already cover most PRD data: `total_employees`, `total_hk`, `total_pph21`, `total_spsi`, `total_premi_excluding_special || total_premi`, `total_lembur`, `total_manual`, `thumb_print`, and `selisih`.
- Audit status can be derived client-side from `selisih === 0 ? 'OK' : 'Review'` without backend changes.
- Existing print CSS has competing rules between `wages-summary-professional.css`, `wages-summary-print-simple.css`, and `report-print-foundation.css`; this is the main implementation risk.

## Constraints

- Do not change payroll formulas, backend aggregation, or database structure.
- Preserve THR, comparison, impact report, CSV export, print, edit mode, and existing data fetch behavior.
- Use existing data contracts where possible; derive audit-page summaries from current `summaryData`, `groupedData`, `groupSubtotals`, and `grandTotal`.
- Keep print Chrome/Edge first, A4 landscape for standard Rebinmas summary.
- Add focused tests for rendering helpers/CSS behavior rather than broad snapshots.
