## Summary

Added and ran focused regression coverage for canonical Bonus/Exgratia behavior across helper logic, Daftar Upah Excel, Pajak Excel, and DOM tax export rows.

## Tests

Passed:

```powershell
bun test src/utils/otherIncomeCanonical.test.ts src/utils/taxDomExportRows.test.ts src/services/daftarUpahExcelService.test.ts src/services/taxReportExcelService.test.ts src/services/dataExtractorService.manualAdjustmentPolicy.test.ts src/services/dataExtractorService.manualAdjustmentMetadata.test.ts src/services/payroll/components/PayrollCalculator.test.ts src/services/payroll/formulas/adapters/aggregationAdapter.test.ts
```

Result: 31 pass, 0 fail.

Also passed frontend browser-export coverage:

```powershell
npx vitest run src/utils/exportPayrollToExcel.test.js
```

Result: 14 pass, 0 fail.
