# Planning Notes

## User Intent
GOAL: Debug dan audit codebase secara menyeluruh untuk menemukan kesalahan, ketidaksesuaian, dan ketidakkonsistenan.

SCOPE: Backend payroll/tax services, frontend reports/tables/payslips, Excel exports, formulas, tests, and shared payroll sign conventions.

CONTEXT: Repo payroll sedang memiliki banyak perubahan aktif. Jangan revert atau overwrite perubahan yang tidak terkait. Audit harus evidence-based dan menghasilkan temuan yang bisa dieksekusi bertahap.

## Context Findings
- Critical domains: payroll calculation, manual adjustment, potongan/koreksi sign semantics, daftar upah Excel, tax report Excel, payslip print/export, report summary pages, history/aggregation services.
- Critical backend files: `backend/src/services/payroll/components/PayrollCalculator.ts`, `backend/src/services/payroll/formulas/PayrollFormulas.ts`, `backend/src/services/dataExtractorService.ts`, `backend/src/services/reportService.ts`, `backend/src/services/taxReportService.ts`, `backend/src/services/taxReportExcelService.ts`, `backend/src/services/daftarUpahExcelService.ts`, `backend/src/services/payrollTotalsCalculator.ts`.
- Critical frontend files: `frontend/src/components/CustomPayrollTable.jsx`, `frontend/src/components/PayslipCard.jsx`, `frontend/src/utils/exportPayrollToExcel.js`, `frontend/src/utils/exportReportToExcelPro.js`, `frontend/src/utils/exportPayslipsToExcel.js`, `frontend/src/utils/PayrollAggregator.js`, `frontend/src/utils/aggregationUtils.js`, report and tax pages.
- Recent issue class: signed deductions must not be subtracted again. Guardrail: deduction cells rendered as negative must be added in formulas; calculation services that store magnitudes must subtract magnitude once.
- Conflict risk: high. Current worktree includes many modified/untracked files across backend, frontend, styles, tests, images/logs, and workflow artifacts. Plan execution must start with ownership check and avoid broad format/refactor churn.

## Constraints
- Planning only in this session.
- No destructive git operations.
- Preserve user/other-tool changes.
- Use focused tests for each affected domain, then broaden.
- Findings must include exact files, behavior, risk, and verification command.
