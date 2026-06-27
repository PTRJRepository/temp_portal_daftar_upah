## Summary

Audited the other-income paths used by Daftar Upah, Pajak export, DOM tax export rows, and backend Excel exports. The mismatch came from inconsistent handling of `EXGRATIA`: some paths treated it as a dynamic custom income, while tax-facing paths expected it under the Bonus bucket.

## Files Modified

- `src/utils/otherIncomeCanonical.ts`
- `src/services/dataExtractorService.ts`
- `src/services/taxReportService.ts`
- `src/services/daftarUpahExcelService.ts`
- `src/services/taxReportExcelService.ts`
- `src/utils/taxDomExportRows.ts`

## Tests

See IMPL-6 summary.
