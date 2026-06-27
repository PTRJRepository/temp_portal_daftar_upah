# IMPL-2 Payroll Formula And Sign-Semantics Audit

Status: completed

Payroll formula paths were audited and adjusted so koreksi uses absolute magnitude before it affects gross, tax gross, and bruto calculations. This keeps input `10` and `-10` equivalent: both reduce wages by `10`.

Covered areas include PayrollCalculator, PayrollFormulas, aggregation adapter, and report service handling.
