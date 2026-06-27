## Summary

Aligned `DataExtractorService` and `TaxReportService` with the canonical income rules. Daftar Upah now derives `pendapatan_bonus` through the canonical Bonus/Exgratia bucket, and monthly tax mapping includes top-level Exgratia fallbacks when history rows do not carry `other_incomes` detail.

## Files Modified

- `src/services/dataExtractorService.ts`
- `src/services/taxReportService.ts`

## Tests

See IMPL-6 summary.
