# Implementation Plan: Payroll and Tax Export Income Alignment

## 1. Requirements Summary

Fix mismatches between:
- Daftar Upah on-screen data.
- Export Daftar Upah.
- Export Pajak.

Reported symptoms:
- Some employee names appear twice in Daftar Upah for Bonus/Exgratia.
- Bonus and Exgratia are treated as the same business bucket in tax export, but not consistently in Daftar Upah/export Daftar Upah.
- Exgratia appears in Daftar Upah but can be missing from Pajak.
- Some employees are missing from one output while present in another.

Success criteria:
- The same employee set is used across Daftar Upah, export Daftar Upah, and monthly tax export for the same period/division/gang/source mode.
- `BONUS` and `EXGRATIA` use one explicit canonical rule, so they are not displayed once as Bonus and again as Exgratia unless the product intentionally requires two separate columns.
- Exgratia values visible in Daftar Upah are included in Pajak taxable income/export exactly once.
- Export totals match visible row totals for other income, gross wage, taxable gross, and PPh21.
- Focused regression tests cover the duplicate and missing-row cases.

## 2. Architecture Decisions

1. Keep `DataExtractorService` as the canonical payroll row source.
2. Add or reuse a small canonical other-income resolver instead of duplicating ad hoc `BONUS`/`EXGRATIA` matching in each export.
3. Prefer stable employee identity (`new_nik`/actual NIK) for cross-report comparison and de-duplication; fall back to `emp_code` only when NIK is unavailable.
4. Preserve existing signed-deduction export formulas. Do not change deduction arithmetic while fixing income classification.
5. Patch narrowly because related files already contain uncommitted work.

## 3. Task Breakdown

### IMPL-1: Audit Reproduction and Baseline Comparison

Build a focused diagnostic that compares rows from DataExtractor, monthly tax report mapping, backend Daftar Upah Excel inputs, and frontend export column generation for the same period/division/gang. The audit should identify duplicate employee identities, missing identities, and income bucket differences.

Depends on: none.

### IMPL-2: Centralize Other Income Canonicalization

Create a shared helper for other income type normalization and category resolution. Required categories: `THR`, `BONUS`, `KONTAN`, `CUSTOM`, and dynamic custom categories. `EXGRATIA` must map into the same taxable/reporting bucket as `BONUS` unless the UI explicitly renders a separate non-overlapping Exgratia column.

Depends on: IMPL-1.

### IMPL-3: Align DataExtractor and Tax Report Mapping

Use the shared helper in `DataExtractorService` and `TaxReportService` so top-level fields, taxable fields, and `other_incomes` details agree. Ensure `EXGRATIA` visible in Daftar Upah flows into Pajak, and ensure `pendapatan_bonus`, `taxable_pendapatan_bonus`, `bonus_amount`, and `exgratia_amount` are not independently summed twice.

Depends on: IMPL-2.

### IMPL-4: Align Excel Export Column Discovery

Update `daftarUpahExcelService`, `taxReportExcelService`, `taxDomExportRows`, and frontend `exportPayrollToExcel` where needed so they consume canonical fields consistently. Keep one display/export column for the canonical Bonus/Exgratia bucket unless requirements explicitly say to show two columns with non-overlapping amounts.

Depends on: IMPL-2, IMPL-3.

### IMPL-5: Fix Employee Identity De-duplication and Missing Rows

Review tax report active row de-duplication and export row construction. Prefer NIK/new_nik identity where available, preserve one active row per person, and add diagnostics when two emp_codes map to the same stable identity.

Depends on: IMPL-1.

### IMPL-6: Regression Tests

Add backend tests for canonical income resolution, tax report row mapping, and Excel export values. Add/update frontend export tests only if frontend export code changes.

Depends on: IMPL-2, IMPL-3, IMPL-4, IMPL-5.

## 4. Implementation Strategy

Sequential execution is recommended.

1. Start with an audit/test fixture that reproduces Bonus/Exgratia split and employee identity mismatch.
2. Implement canonical income helper with tests.
3. Wire helper into backend data shaping first.
4. Update export services after backend row semantics are stable.
5. Run focused tests, then broader related tests.

## 5. Risk Assessment

High-risk areas:
- Existing uncommitted work touches the same files.
- Changing Bonus/Exgratia classification can affect tax totals and take-home calculations.
- Dedupe changes can alter row counts and summary totals.

Mitigations:
- Patch only the helper and direct call sites.
- Keep old aliases populated for compatibility, but derive them from one canonical amount.
- Add tests that compare both row-level values and totals.

## 6. Verification Commands

Run the smallest relevant tests first:

```powershell
bun test src/services/daftarUpahExcelService.test.ts
bun test src/services/taxReportExcelService.test.ts
bun test src/utils/taxDomExportRows.test.ts
```

If frontend export changes are made from the repo root/frontend:

```powershell
npx vitest run src/utils/exportPayrollToExcel.test.js src/services/taxReportService.test.js
```

Then broaden if implementation touches calculator/extractor behavior:

```powershell
bun test src/services/payroll/components/PayrollCalculator.test.ts src/services/dataExtractorService.manualAdjustmentPolicy.test.ts
```
