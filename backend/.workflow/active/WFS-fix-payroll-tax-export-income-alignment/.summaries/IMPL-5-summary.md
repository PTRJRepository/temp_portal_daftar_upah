## Summary

Adjusted monthly tax report row de-duplication to prefer stable report identity (`new_nik`/NIK) before `emp_code`, reducing old/new emp-code duplicate rows for the same employee.

## Files Modified

- `src/services/taxReportService.ts`

## Tests

See IMPL-6 summary.
