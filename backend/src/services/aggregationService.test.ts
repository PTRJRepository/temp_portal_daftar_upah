import { describe, expect, test } from "bun:test";
import { aggregationService } from "./aggregationService";

describe("AggregationService", () => {
    test("uses canonical total_potongan from payroll rows before heuristic deduction sums", () => {
        const response = aggregationService.createAggregatedResponse(
            [
                {
                    jumlah_hk: 1,
                    total_potongan: 10,
                    pot_pph21: 999,
                    pot_spsi: 999,
                    jumlah_upah_kotor: 100,
                    upah_bersih: 90
                }
            ],
            "G1",
            4,
            2026
        );

        expect(response.summary.total_potongan).toBe(10);
        expect(response.summary.total_upah_bersih).toBe(90);
    });
});
