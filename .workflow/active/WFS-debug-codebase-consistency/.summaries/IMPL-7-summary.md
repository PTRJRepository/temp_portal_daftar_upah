# IMPL-7 Documentation And Guardrail Comments

Status: completed

Guardrail comments were added at high-risk boundaries: backend payroll formula normalization, Excel export signed deduction formulas, payslip calculation/display, tax export/display, and frontend export helpers.

Core guidance: never subtract a raw signed deduction or koreksi value; normalize magnitude first, then choose either calculation subtraction or signed Excel addition deliberately.
