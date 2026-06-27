import { describe, expect, test } from "bun:test";
import { OtherIncomesService } from "./otherIncomesService";

describe("OtherIncomesService income deduplication", () => {
    test("keeps only the latest record for the same emp_code and canonical income type", () => {
        const dedupe = OtherIncomesService.deduplicateIncomeRows.bind(OtherIncomesService);

        const rows = dedupe([
            {
                id: 23871,
                emp_code: "B0097",
                nik: "1902014311880001",
                income_type: "BONUS",
                income_name: "EXGRATIA 2025",
                amount: 100000
            },
            {
                id: 25281,
                emp_code: "B0097",
                nik: "1906044311880001",
                income_type: "BONUS",
                income_name: "EXGRATIA PG 1B GUNUNG RUM MEI 2026",
                amount: 100000
            }
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(25281);
        expect(rows[0].amount).toBe(100000);
    });

    test("keeps the latest id even when rows arrive out of order", () => {
        const dedupe = OtherIncomesService.deduplicateIncomeRows.bind(OtherIncomesService);

        const rows = dedupe([
            { id: 2, emp_code: "B0097", nik: "N1", income_type: "BONUS", income_name: "EXGRATIA", amount: 100000 },
            { id: 1, emp_code: "B0097", nik: "N0", income_type: "BONUS", income_name: "EXGRATIA", amount: 200000 }
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(2);
        expect(rows[0].amount).toBe(100000);
    });

    test("keeps separate canonical income types for the same employee", () => {
        const dedupe = OtherIncomesService.deduplicateIncomeRows.bind(OtherIncomesService);

        const rows = dedupe([
            { id: 1, emp_code: "B0097", nik: "N1", income_type: "THR", amount: 4000000 },
            { id: 2, emp_code: "B0097", nik: "N1", income_type: "BONUS", income_name: "EXGRATIA", amount: 100000 }
        ]);

        expect(rows.map((row: any) => row.id).sort()).toEqual([1, 2]);
    });

    test("keeps latest records separately per payroll period", () => {
        const dedupe = OtherIncomesService.deduplicateIncomeRows.bind(OtherIncomesService);

        const rows = dedupe([
            { id: 1, emp_code: "B0097", period_year: 2026, period_month: 5, income_type: "BONUS", amount: 100000 },
            { id: 2, emp_code: "B0097", period_year: 2026, period_month: 5, income_type: "EXGRATIA", amount: 150000 },
            { id: 3, emp_code: "B0097", period_year: 2026, period_month: 6, income_type: "BONUS", amount: 200000 }
        ]);

        expect(rows).toHaveLength(2);
        expect(rows.map((row: any) => row.id).sort()).toEqual([2, 3]);
        expect(rows.reduce((sum: number, row: any) => sum + row.amount, 0)).toBe(350000);
    });
});
