import { describe, expect, test } from "bun:test";
import {
    formatCanonicalOtherIncomeLabel,
    getCanonicalOtherIncomeType,
    resolveCanonicalOtherIncomeType,
    sumOtherIncomeByCanonicalType
} from "./otherIncomeCanonical";

describe("otherIncomeCanonical", () => {
    test("maps exgratia into the bonus taxable/reporting bucket", () => {
        expect(resolveCanonicalOtherIncomeType("EXGRATIA")).toBe("BONUS");
        expect(resolveCanonicalOtherIncomeType("Bonus / Exgratia")).toBe("BONUS");
        expect(getCanonicalOtherIncomeType({ income_type: "Ex Gratia" })).toBe("BONUS");
    });

    test("sums bonus and exgratia exactly once through the canonical bonus bucket", () => {
        const incomes = [
            { type: "BONUS", amount: 100000 },
            { income_type: "EXGRATIA", amount: 250000 },
            { type: "THR", amount: 50000 }
        ];

        expect(sumOtherIncomeByCanonicalType(incomes, "BONUS")).toBe(350000);
        expect(sumOtherIncomeByCanonicalType(incomes, "EXGRATIA")).toBe(350000);
        expect(sumOtherIncomeByCanonicalType(incomes, "THR")).toBe(50000);
    });

    test("uses one display label for bonus and exgratia", () => {
        expect(formatCanonicalOtherIncomeLabel("BONUS")).toBe("PENDAPATAN BONUS");
        expect(formatCanonicalOtherIncomeLabel("EXGRATIA")).toBe("PENDAPATAN BONUS");
        expect(formatCanonicalOtherIncomeLabel("Bonus / Exgratia")).toBe("PENDAPATAN BONUS");
    });
});
