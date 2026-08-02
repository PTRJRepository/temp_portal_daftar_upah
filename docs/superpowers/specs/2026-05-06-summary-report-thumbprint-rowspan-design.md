# Summary Report Thumbprint Rowspan Design

## Context

`SummaryReportPage.jsx` renders payroll summary detail by gang. The normal screen table and the print-only summary table currently end at `TOTAL UPAH BERSIH`.

Thumbprint data already exists at division level in the summary backend flow. The Rebinmas wages summary report already displays `THUMB PRINT` and `SELISIH`, but Summary Report detail does not.

## Goal

Add division-level `THUMB PRINT` and `SELISIH` columns to Summary Report detail, placed on the far right after `TOTAL UPAH BERSIH`.

For each division in the report, show one merged thumbprint cell and one merged selisih cell spanning all gang rows in that division.

## Proposed Behavior

For payroll mode only:

1. Add `THUMB PRINT` and `SELISIH` columns to the right of `TOTAL UPAH BERSIH`.
2. Group rendered payroll rows by `division_code` while preserving the existing order.
3. Calculate division comparison values from the visible rows:
   - `division_upah_bersih = sum(total_upah_bersih)` for the division rows.
   - `thumb_print = division-level thumbprint value for the current period`.
   - `selisih = thumb_print > 0 ? division_upah_bersih - thumb_print : 0`.
4. Render those values once per division using `rowSpan` equal to the number of visible gang rows in that division.
5. Keep group label rows for print, but do not duplicate thumbprint values on each gang row.
6. Include grand total thumbprint and selisih in table footers and CSV export.

## Data Flow

Backend `summaryService.getDivisionSummary()` should attach the current period thumbprint data to each gang summary row using `division_code`.

The frontend should not fetch thumbprint separately. It should consume fields from the existing `fetchDivisionSummary()` response:

- `thumb_print`
- `selisih`

For filtered/grouped display, frontend should recompute visible grand totals so group filters remain accurate.

## UI Scope

Modify only Summary Report detail payroll mode:

- Screen payroll table.
- Print-only payroll table.
- Payroll CSV export.
- Payroll footer totals.

THR mode remains unchanged.

## Signature Placement Baseline

Summary Report signatures must be printed after the table that lists gang-level detail rows (`Detail Per Gang / Estate` or its continuation), not on the premium appendix / `Uraian Premi Per Jenis` page.

This placement is part of the report layout contract:

- `Uraian Premi Per Jenis` is an appendix page and must not render the approval signature section.
- The last `Detail Per Gang / Estate` print page renders the signature section immediately after the detail table and before the footer.
- Print tests should guard this placement so future layout changes do not move signatures back to appendix pages.

## Testing

Use test-first changes.

Frontend source-inspection coverage should assert that `SummaryReportPage.jsx`:

- Adds `THUMB PRINT` and `SELISIH` headers.
- Uses `rowSpan` for division-level comparison cells.
- Includes thumbprint and selisih in the print table footer.

Backend coverage should assert that `summaryService.getDivisionSummary()` rows expose division thumbprint and selisih values when thumbprint data exists.

Focused commands:

```bash
cd frontend && npx vitest run src/pages/SummaryReportPage.printHeader.test.js
cd backend && bun test src/services/summaryService.test.ts
```

## Risks

Thumbprint is division-level, while the report rows are gang-level. Repeating the value per gang would be misleading, so the row-spanned cell is required.

If a visible filter hides some gang rows, selisih should compare the visible upah bersih subtotal against the same division thumbprint. This makes the printed filtered report internally consistent, but the user should interpret filtered selisih as a filtered subtotal comparison rather than full-division reconciliation.
