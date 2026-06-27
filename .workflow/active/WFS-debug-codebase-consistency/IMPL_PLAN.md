# Implementation Plan: Whole-Codebase Debugging And Consistency Audit

## 1. Requirements Summary

Audit the full payroll portal codebase for defects, inconsistencies, and mismatched behavior. The highest-risk area is payroll validity: koreksi, potongan, upah kotor, upah bersih, pajak, payslip, and Excel exports must use one coherent sign convention.

This plan is read-first and evidence-based. It does not execute implementation by itself.

## 2. Architecture Decisions

- Treat backend calculation rows as canonical numeric data unless a report explicitly documents a display-only transformation.
- Use positive magnitudes for calculation deductions in backend services.
- Use signed negative cells only in Excel/display layers that explicitly require negative rendering.
- Never create formula patterns that subtract a signed negative deduction, such as `gross - (-200)`.
- Keep audit findings separated by module to avoid broad, conflicting edits in the current dirty worktree.

## 3. Task Breakdown

### IMPL-1: Baseline Inventory And Ownership Snapshot
Collect current git status, active workflow sessions, changed files, test commands, and likely ownership boundaries. Mark unrelated dirty files as out-of-scope unless directly implicated.

### IMPL-2: Payroll Formula And Sign-Semantics Audit
Trace `pot_koreksi`, `potongan_upah_kotor_total`, `total_potongan`, `total_potongan_bersih`, `jumlah_upah_kotor`, `upah_bersih`, and `penghasilan_bruto` from extraction through calculators and report shaping.

### IMPL-3: Excel Export Formula Audit
Audit Daftar Upah, Pro report export, tax Excel, and payslip Excel for signed cell conventions, formula direction, totals rows, and guardrails against `-(-amount)`.

### IMPL-4: Frontend Display And Payslip Audit
Review payroll table, tax report page, tax matrix, employee detail, salary history, and payslip print for mismatched signs, duplicated totals, and display-only vs calculation value confusion.

### IMPL-5: Data Source Consistency Audit
Compare DB_PTRJ-only, Non DB_PTRJ/manual adjustment, history, tax, wages verification, and summary report paths to identify cases where the same employee-period can produce different totals.

### IMPL-6: Regression Test Matrix
Add or update tests for positive/negative koreksi, positive/negative net deductions, pendapatan lainnya double-entry, tax report export, payslip render/export, and formula string guards.

### IMPL-7: Documentation And Guardrail Comments
Centralize the sign convention and add succinct comments only at dangerous boundary points: data normalization, Excel signed output, display helpers, and formula builders.

### IMPL-8: Verification Sweep
Run focused backend/frontend tests, then module builds. Produce a final audit report listing confirmed fixes, remaining risks, and deferred items.

## 4. Implementation Strategy

Recommended execution is sequential with limited parallel review:

1. IMPL-1 first to protect existing changes.
2. IMPL-2 and IMPL-3 can be reviewed in parallel, but edits should be serialized because they touch shared payroll semantics.
3. IMPL-4 and IMPL-5 follow after formula invariants are documented.
4. IMPL-6 must be added alongside every behavioral correction.
5. IMPL-8 runs only after all scoped changes are complete.

## 5. Risk Assessment

- High payroll validity risk if signs are mixed between calculation magnitude and signed display value.
- High collaboration risk because worktree already has many modified/untracked files.
- Medium regression risk in report pages because many screens duplicate formatting and totals logic.
- Medium test runtime risk; prefer focused tests before `npm run build` or broad suites.

## 6. Acceptance Criteria

- No high-risk formula path can create `-(-potongan)` or subtract a signed deduction cell.
- Backend calculator treats `pot_koreksi: 10` and `pot_koreksi: -10` identically.
- Excel exports and payslips have explicit tests for signed and magnitude semantics.
- All changed modules have focused tests passing.
- Final report clearly separates fixed issues, open findings, and intentionally deferred cleanup.
