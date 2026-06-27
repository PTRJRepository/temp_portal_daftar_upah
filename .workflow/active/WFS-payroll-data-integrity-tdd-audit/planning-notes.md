# TDD Planning Notes

## User Intent
TDD: Payroll data integrity audit
GOAL: Temukan bug yang harus diperbaiki karena aplikasi payroll tidak boleh menghasilkan selisih data, salah tanda, double count, atau rumus yang menyimpang antara backend, web, slip gaji, pajak, dan Excel.
SCOPE: Payroll calculation engines, frontend aggregators, employee detail breakdown, tax/report totals, Excel exports, manual adjustment/koreksi, and attendance filtering.
CONTEXT: Repo sudah punya workflow sebelumnya untuk koreksi/pendapatan lainnya. Worktree sedang kotor; rencana ini tidak mengeksekusi perbaikan produksi.
TEST_FOCUS: Unit tests, parity tests, formula snapshot tests, sign-normalization tests, edge cases with positive/negative koreksi, zero attendance, other income, PPh/premi PPH, and employer-vs-worker deductions.

## Context Findings
- Critical files: `backend/src/services/payroll/components/PayrollCalculator.ts`, `backend/src/services/payroll/formulas/PayrollFormulas.ts`, `backend/src/services/payrollTotalsCalculator.ts`, `backend/src/services/reportService.ts`, `backend/src/services/daftarUpahExcelService.ts`, `backend/src/services/taxReportExcelService.ts`, `frontend/src/utils/aggregationUtils.js`, `frontend/src/utils/PayrollAggregator.js`, `frontend/src/utils/employeePayrollBreakdown.js`, `frontend/src/utils/exportPayrollToExcel.js`, `frontend/src/utils/exportReportToExcelPro.js`, `frontend/src/utils/exportPayslipsToExcel.js`, `frontend/src/components/PayslipCard.jsx`, `frontend/src/components/PayrollTaxMatrix.jsx`, `frontend/src/pages/TaxReportPage.jsx`.
- Conflict risk: high. Banyak file payroll/report sedang berubah dan ada session aktif sebelumnya `WFS-debug-codebase-consistency`.
- Strong suspected defects to test first:
  - `frontend/src/utils/aggregationUtils.js` menghitung `total_premi` dari semua `premi_*`, sehingga `premi_pph` berisiko ikut masuk gross padahal business rule menyebut `premi_pph` adalah penambah upah bersih, bukan komponen gross.
  - `frontend/src/utils/aggregationUtils.js` memasukkan `pot_koreksi` ke `calculateTotalPotongan` karena `pot_` prefix, padahal komentar formula backend menyebut koreksi sudah mengurangi `jumlah_upah_kotor` dan tidak boleh masuk total potongan bersih.
  - Filter karyawan aktif tidak konsisten: `PayrollAggregator.flattenData` memakai `hari_kerja || kehadiran`, `aggregationUtils.processDivisionData` memakai `jumlah_hk`, dan `backend/src/services/payrollTotalsCalculator.ts` memakai `jumlah_hk`.
  - `frontend/src/utils/employeePayrollBreakdown.js` memakai `amount > 0` untuk koreksi/potongan, sehingga input negatif bisa hilang dari rincian employee detail.
  - `employeePayrollBreakdown.js` fallback `pot_astek || pot_astek_jumlah` berisiko memakai jumlah ASTEK pekerja+majikan sebagai potongan pekerja bila field pekerja kosong.
  - Dynamic nested potongan bersih di beberapa aggregator masih memakai nilai raw, belum selalu absolut/magnitude.
- Constraint: setiap perbaikan harus dimulai dengan test gagal dulu, lalu implementasi minimal, lalu refactor.

## Test Context
- Backend framework: Bun test (`bun test ...`).
- Frontend framework: Vitest (`npx vitest run ...`).
- Existing relevant tests: `PayrollCalculator.test.ts`, `aggregationAdapter.test.ts`, `payrollTotalsCalculator.test.ts`, `taxReportExcelService.test.ts`, `daftarUpahExcelService.test.ts`, `PayrollAggregator.test.js`, `aggregationUtils` has no direct dedicated test yet, `employeePayrollBreakdown.test.js`, `exportPayrollToExcel.test.js`, `exportPayslipsToExcel.test.js`, `PayslipCard.test.jsx`, `taxReportService.test.js`.
- Coverage gap: no single parity fixture that proves backend totals, frontend aggregator, web breakdown, payslip, and Excel use the same payroll invariant.

## TDD Principles
- NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
- Red phase must prove current behavior fails before editing production code.
- Green phase must be the smallest correction that preserves existing business rules.
- Refactor phase must keep all focused tests passing and remove duplicate formula logic only where safe.
