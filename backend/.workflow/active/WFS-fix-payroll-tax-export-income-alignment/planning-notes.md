# Planning Notes

## User Intent
GOAL: Samakan angka dan nama karyawan antara tampilan Daftar Upah, export Pajak, dan export Daftar Upah.

SCOPE: Backend payroll/tax data shaping and Excel export alignment; frontend export Daftar Upah if needed.

CONTEXT: User reports Bonus and Exgratia appear doubled or split incorrectly, and some employees do not appear in one output.

## Clarification From User
- `EXGRATIA` muncul di Daftar Upah, tetapi tidak muncul di Pajak.
- Masalah utama adalah tidak ada konsistensi antar jalur data: kadang `BONUS` dan `EXGRATIA` dianggap sama, kadang dipisah, sehingga bisa hilang dari Pajak atau tampil double.
- Fix harus memastikan `EXGRATIA` tetap masuk objek pajak/taxable, dengan label/kolom yang konsisten dan tidak dihitung dua kali.

## Recent Session Awareness
- Found recent parent-level sessions: WFS-payroll-data-integrity-tdd-audit, WFS-debug-codebase-consistency, WFS-redesign-wages-summary-rebinmas, WFS-fix-summary-report-print-design.
- Current worktree has many pre-existing modified files, including payroll/tax/export files. Treat these as intentional WIP and do not overwrite blindly.

## Context Findings
- Daftar Upah source of truth is `src/services/dataExtractorService.ts` via `extractPayrollData`.
- Backend Daftar Upah Excel uses `src/services/daftarUpahExcelService.ts` and discovers `pendapatan_*` fields plus `other_incomes`.
- Frontend Daftar Upah export uses `../frontend/src/utils/exportPayrollToExcel.js` and builds dynamic `pendapatan_*` and `*_pengurang` columns.
- Monthly tax report fetches the same extractor through `src/services/taxReportService.ts`, then remaps rows for `taxReportExcelService`.
- Tax export has multiple Bonus/Exgratia fallback paths: `pendapatan_bonus`, `taxable_pendapatan_bonus`, `bonus`, `bonus_amount`, `exgratia_amount`, and `other_incomes` matching `BONUS` or `EXGRATIA`.
- In `DataExtractorService`, exact `getOiByType('BONUS')` does not include `EXGRATIA`, while tax export intentionally merges `BONUS` and `EXGRATIA`. This can make Daftar Upah show Exgratia as a separate dynamic field while tax export shows it under Bonus.
- Updated user clarification: current observed bug is worse than label mismatch: `EXGRATIA` can be visible in Daftar Upah but absent from Pajak, so the tax mapping must consume canonical `BONUS/EXGRATIA` from the same source fields used by Daftar Upah.
- `TaxReportService` de-duplicates monthly rows by `emp_code || nik || actual_nik`; if old/new emp_code rows exist for the same NIK, one employee can appear twice or an intended row can be replaced inconsistently.

## Conflict Risk
Medium/high because the files involved already have uncommitted edits and the same data fields are shared by reports, exports, and tax calculations.
