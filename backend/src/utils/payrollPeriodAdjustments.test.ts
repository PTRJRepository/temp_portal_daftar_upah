import { describe, expect, test } from "bun:test";
import {
    attachPayrollPeriodAdjustmentNotes,
    resolveAdjustedJabatanJumlah,
    shouldForcePotPph21ToTer
} from "./payrollPeriodAdjustments";

describe("payrollPeriodAdjustments", () => {
    test("zeros B0088 jabatan allowance only for May 2026", () => {
        const row = { emp_code: "B0088", emp_name: "ZUWIRDA ( SURYATI )" };

        expect(resolveAdjustedJabatanJumlah(row, { month: 5, year: 2026, divisionCode: "ARA" }, 150000)).toBe(0);
        expect(resolveAdjustedJabatanJumlah(row, { month: 6, year: 2026, divisionCode: "ARA" }, 150000)).toBe(150000);
        expect(resolveAdjustedJabatanJumlah(row, { month: 5, year: 2025, divisionCode: "ARA" }, 150000)).toBe(150000);
    });

    test("forces F0529 ARA PPh21 input to TER only for May 2026", () => {
        const row = { emp_code: "F0529", loc_code: "ARA" };

        expect(shouldForcePotPph21ToTer(row, { month: 5, year: 2026, divisionCode: "ARA" })).toBe(true);
        expect(shouldForcePotPph21ToTer(row, { month: 6, year: 2026, divisionCode: "ARA" })).toBe(false);
        expect(shouldForcePotPph21ToTer(row, { month: 5, year: 2026, divisionCode: "PG1A" })).toBe(true);
        expect(shouldForcePotPph21ToTer({ emp_code: "F0529", loc_code: "PG1A" }, { month: 5, year: 2026, divisionCode: "PG1A" })).toBe(false);
    });

    test("attaches auditable comments for applied adjustments", () => {
        const row: Record<string, any> = { emp_code: "B0088" };

        attachPayrollPeriodAdjustmentNotes(row, { month: 5, year: 2026, divisionCode: "ARA" });

        expect(row.period_adjustments).toEqual([
            {
                code: "2026-05-B0088-JABATAN-ZERO",
                comment: "Mei 2026 only: B0088 ZUWIRDA (SURYATI) tunjangan jabatan disesuaikan menjadi 0."
            }
        ]);
    });
});

