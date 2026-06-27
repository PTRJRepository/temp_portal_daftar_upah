# TDD Implementation Plan: Payroll Data Integrity Audit

## 1. Requirements Summary

Payroll must not silently produce wrong money values. The execution phase must find and fix calculation bugs using TDD only: write a failing test, prove failure, implement the smallest correction, then refactor under passing tests.

Primary invariant:

- Backend/internal math uses positive deduction magnitudes.
- Display/Excel may show signed negative deductions, but formulas add signed cells and never subtract already-negative values.
- Koreksi always reduces gross whether source input is `10` or `-10`.
- Premi PPH is a net-pay addition, not gross premi.
- Worker deductions and employer contributions must not be mixed in upah bersih.

## 2. Test Strategy

- Backend: Bun tests for formula engines, totals calculators, report rows, tax report rows, and Excel generators.
- Frontend: Vitest tests for aggregation utilities, PayrollAggregator, employee detail breakdown, payslip, tax display, and Excel export helpers.
- Use small explicit fixtures with hand-calculated expected totals.
- Every task must include both positive and negative source values where signs matter.
- Add parity tests before changing duplicate formula code.

## 3. Task Breakdown With Red-Green-Refactor Cycles

### IMPL-1: Frontend Aggregation Gross/Net Formula Integrity

Risk: `aggregationUtils.calculateTotalPremi` can include `premi_pph` in gross premi, and `calculateTotalPotongan` can include `pot_koreksi`, causing gross/net drift or double deduction.

Red: Add tests proving `premi_pph` is excluded from gross premi and `pot_koreksi` is excluded from net deductions because koreksi already reduces gross.

Green: Correct the inclusion/exclusion rules in `frontend/src/utils/aggregationUtils.js` with absolute magnitude handling for deduction fields.

Refactor: Centralize field classification helpers in the same file and keep comments aligned with the formulas.

### IMPL-2: Employee Detail Breakdown Sign And Worker-Deduction Safety

Risk: `employeePayrollBreakdown.js` drops negative koreksi/potongan because it checks `amount > 0`, and can use `pot_astek_jumlah` as worker deduction fallback.

Red: Add tests where `pot_koreksi=-10000`, `koreksi_denda=-5000`, `pot_pph21=-7000`, and ASTEK has separate worker/employer/total fields.

Green: Normalize deduction details with `Math.abs` and prefer worker-only ASTEK fields over `*_jumlah` totals.

Refactor: Add a small deduction magnitude helper and use it consistently in breakdown lists.

### IMPL-3: Attendance Filter Parity Across Backend And Frontend Totals

Risk: Backend totals and frontend flattening use different active employee filters (`jumlah_hk` vs `hari_kerja`/`kehadiran`), which can change totals for employees with leave/corrections.

Red: Add paired backend/frontend tests with employees where `jumlah_hk > 0` but `hari_kerja = 0`, and the reverse if valid in domain data.

Green: Choose one documented active-employee rule and align `PayrollAggregator`, `aggregationUtils`, and `payrollTotalsCalculator` to it.

Refactor: Extract or document a single rule name in tests so future changes are explicit.

### IMPL-4: Backend/Frontend Payroll Formula Parity Fixture

Risk: There are multiple formula engines. A fix in one can leave report/web/export values inconsistent.

Red: Create a shared fixture by duplicating exact input values in backend and frontend tests: gaji, tunjangan, premi, premi_pph, koreksi positive/negative, BPJS worker/employer, ASTEK worker/employer, PPh, SPSI, other income.

Green: Align frontend aggregator outputs to backend `PayrollCalculator` outputs or stop recalculating fields where backend is authoritative.

Refactor: Keep the fixture small and reusable; avoid introducing a new runtime dependency between frontend and backend.

### IMPL-5: Other Income Double-Entry And Taxability Consistency

Risk: Pendapatan lainnya must appear in gross detail and net deduction detail; tax report and Excel must not lose custom types such as KONTANAN/INSENTIF or double count total and detail fields.

Red: Add tests for THR, BONUS, KONTANAN/custom type, total only fallback, and both web/export/tax rows.

Green: Normalize other-income discovery and detail mapping so each type appears exactly once in Upah Kotor and once as Potongan Upah Bersih where required.

Refactor: Reuse label/type normalization helpers where local module boundaries allow it.

### IMPL-6: Tax And PPh Field Precedence Safety

Risk: Code paths use `pot_pph21`, `pph21_ter`, `potongan_pph21`, and `premi_pph` with different meanings. Wrong fallback can change net pay or tax report values.

Red: Add tests where these fields intentionally differ, proving which field is authoritative for tax matrix, payslip, report Excel, and net wage.

Green: Implement explicit precedence helpers and remove ambiguous `a || b` fallback where zero is meaningful.

Refactor: Document the field meanings near the helpers and update tests for zero-value precedence.

### IMPL-7: Excel Formula Guard Scanner And Export Snapshot Tests

Risk: Future Excel code can reintroduce `-(-amount)` or subtract signed deduction cells.

Red: Add a focused test that scans Excel exporter source/formula outputs for dangerous patterns and snapshot-checks representative formulas.

Green: Fix any exporter formulas that subtract signed cells or write unsigned deduction cells in signed sections.

Refactor: Put the scanner patterns in one test helper with clear comments.

### IMPL-8: Manual Adjustment/Koreksi End-To-End Normalization

Risk: Manual adjustments can enter through API, metadata, nested dynamic potongan, or flat fields; inconsistent signs can affect web, backend totals, payslip, and Excel differently.

Red: Add tests for manual adjustment values `10`, `-10`, nested `potongan_upah_kotor.dynamic`, and flat `koreksi_*` fields through backend adapter and frontend aggregator/export.

Green: Normalize once at each boundary and ensure all consumer outputs match the invariant.

Refactor: Add guardrail comments only where they prevent sign mistakes.

## 4. Implementation Strategy

1. Execute tasks in order. IMPL-1 and IMPL-2 are highest risk because they show likely local defects from code inspection.
2. Keep each task small: add one failing test file/change, run focused test, implement, run focused test again.
3. After IMPL-4, run a broader parity sweep because duplicate formula engines are the main systemic risk.
4. Do not make broad refactors until tests prove the formulas are aligned.

## 5. Risk Assessment

- High: Payroll values can be wrong if frontend recalculates with different rules than backend.
- High: Dirty worktree means execution must avoid unrelated changes.
- Medium: Some suspected defects may be display-only, but still dangerous because users export or inspect those values.
- Medium: Full DB reconciliation requires representative payroll data; this TDD plan focuses first on deterministic code fixtures.

## 6. Verification Commands

- Backend focused: `cd backend && bun test src/services/payroll/components/PayrollCalculator.test.ts src/services/payroll/formulas/adapters/aggregationAdapter.test.ts src/services/payrollTotalsCalculator.test.ts src/services/daftarUpahExcelService.test.ts src/services/taxReportExcelService.test.ts`
- Frontend focused: `cd frontend && npx vitest run src/utils/aggregationUtils.test.js src/utils/PayrollAggregator.test.js src/utils/employeePayrollBreakdown.test.js src/utils/exportPayrollToExcel.test.js src/utils/exportPayslipsToExcel.test.js src/components/PayslipCard.test.jsx`
- Final build: `cd frontend && npm run build`
