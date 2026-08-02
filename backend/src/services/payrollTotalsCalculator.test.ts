import { describe, expect, test } from "bun:test";
import {
    calculateGrandTotal,
    calculateGrandTotalFromGangTotals,
    calculatePayrollTotals,
    reconcileGangTotalsToGrandTotal
} from "./payrollTotalsCalculator";

describe("calculatePayrollTotals", () => {
    test("sums jumlah_upah_kotor directly from canonical rows", () => {
        const totals = calculatePayrollTotals(
            [
                {
                    jumlah_hk: 24,
                    jumlah_upah_kotor: 1_500_000,
                    pot_koreksi: 100_000,
                },
                {
                    jumlah_hk: 23,
                    jumlah_upah_kotor: 2_000_000,
                    pot_koreksi: 200_000,
                },
            ],
            "GRAND TOTAL",
        );

        // Canonical rows already carry corrected values; totals must not re-adjust koreksi.
        expect(totals.jumlah_upah_kotor).toBe(3_500_000);
    });

    test("filters out employees with jumlah_hk <= 0", () => {
        const totals = calculatePayrollTotals(
            [
                { jumlah_hk: 0, jumlah_upah_kotor: 9_999_999 },
                { jumlah_hk: 22, jumlah_upah_kotor: 1_000_000 },
            ],
            "GRAND TOTAL",
        );

        expect(totals.employee_count).toBe(1);
        expect(totals.jumlah_upah_kotor).toBe(1_000_000);
    });

    test("rounds half-rupiah payroll totals with floating tolerance", () => {
        const totals = calculatePayrollTotals(
            [
                {
                    jumlah_hk: 1,
                    upah_bersih: 1_038_594_760.4999998,
                    jumlah_upah_kotor: 1_038_594_760.4999998,
                },
            ],
            "GRAND TOTAL",
        );

        expect(totals.upah_bersih).toBe(1_038_594_761);
        expect(totals.jumlah_upah_kotor).toBe(1_038_594_761);
    });

    test("grand total stays canonical while gang breakdown reconciles rounding drift", () => {
        const gangs = [
            {
                gang_code: "G1",
                employees: [
                    {
                        jumlah_hk: 1,
                        jumlah_upah_kotor: 1.4,
                        total_potongan: 0,
                        upah_bersih: 1.4,
                    },
                ],
            },
            {
                gang_code: "G2",
                employees: [
                    {
                        jumlah_hk: 1,
                        jumlah_upah_kotor: 1.4,
                        total_potongan: 0,
                        upah_bersih: 1.4,
                    },
                ],
            },
        ];

        const rawEmployeeGrandTotal = calculatePayrollTotals(
            gangs.flatMap((gang) => gang.employees),
            "GRAND TOTAL",
        );
        const canonicalGrandTotal = calculateGrandTotal(gangs);
        const gangTotals = gangs.map((gang) => calculatePayrollTotals(gang.employees, `TOTAL ${gang.gang_code}`));
        const displayedGrandTotalBeforeReconcile = calculateGrandTotalFromGangTotals(gangTotals);
        const reconciledGangTotals = reconcileGangTotalsToGrandTotal(gangTotals, canonicalGrandTotal);
        const displayedGrandTotalAfterReconcile = calculateGrandTotalFromGangTotals(reconciledGangTotals);

        expect(rawEmployeeGrandTotal.upah_bersih).toBe(3);
        expect(canonicalGrandTotal.upah_bersih).toBe(3);
        expect(displayedGrandTotalBeforeReconcile.upah_bersih).toBe(2);
        expect(displayedGrandTotalAfterReconcile.upah_bersih).toBe(3);
        expect(displayedGrandTotalAfterReconcile.jumlah_upah_kotor).toBe(3);
    });

    test("calculateGrandTotalFromGangTotals preserves dynamic subtotal fields", () => {
        const displayedGrandTotal = calculateGrandTotalFromGangTotals([
            {
                ...calculatePayrollTotals([{ jumlah_hk: 1, upah_bersih: 1 }], "TOTAL G1"),
                pendapatan_kontan: 1.4,
                premi: { premi_dynamic_1: 2.4 },
                potongan_upah_kotor: { dynamic: { pot_dynamic_1: 3.4 } },
            },
            {
                ...calculatePayrollTotals([{ jumlah_hk: 1, upah_bersih: 1 }], "TOTAL G2"),
                pendapatan_kontan: 1.4,
                premi: { premi_dynamic_1: 2.4 },
                potongan_upah_kotor: { dynamic: { pot_dynamic_1: 3.4 } },
            },
        ]);

        expect(displayedGrandTotal.pendapatan_kontan).toBe(2);
        expect(displayedGrandTotal.premi?.premi_dynamic_1).toBe(4);
        expect(displayedGrandTotal.potongan_upah_kotor?.dynamic?.pot_dynamic_1).toBe(6);
    });
});
