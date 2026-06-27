# IMPL-3 Excel Export Formula Audit

Status: completed

Excel exporters were audited for double-negative risk. Guardrail now is: write deduction/koreksi cells as signed negative values, then add those cells in formulas. Do not generate formulas that subtract already-signed cells.

Daftar Upah Excel now includes pendapatan lainnya detail columns in Upah Kotor and Potongan Upah Bersih, with deduction-side values signed negative.
