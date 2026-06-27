## Summary

Added canonical other-income normalization. `EXGRATIA` and `BONUS` now resolve to the same taxable/reporting bucket, so Exgratia is not dropped from Pajak and is not exported as a conflicting duplicate custom column.

## Files Modified

- `src/utils/otherIncomeCanonical.ts`
- `src/utils/otherIncomeCanonical.test.ts`

## Tests

See IMPL-6 summary.
