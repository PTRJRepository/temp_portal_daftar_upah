import { describe, expect, it } from "bun:test";
import { buildAutomationAdjustmentOptions, type TaskCodeOption } from "./taskCodeOptionService";

describe("buildAutomationAdjustmentOptions", () => {
    it("returns automation-ready premi, koreksi, and potongan upah bersih options with description as adjustment_name", () => {
        const options: TaskCodeOption[] = [
            {
                ad_code: "A100",
                task_code: "A100P1A",
                task_desc: "(AL) INSENTIF PANEN",
                loc_code: "P1A",
                task_type: null,
                task_grp: null,
                task_nature: null,
                is_deduction: 0,
                adj_ad_code: null,
                doc_desc: "(AL) INSENTIF PANEN",
                base_task_code: "A100"
            },
            {
                ad_code: "D200",
                task_code: "D200P1A",
                task_desc: "(DE) KOREKSI PANEN",
                loc_code: "P1A",
                task_type: null,
                task_grp: null,
                task_nature: null,
                is_deduction: 1,
                adj_ad_code: null,
                doc_desc: "(DE) KOREKSI PANEN",
                base_task_code: "D200"
            },
            {
                ad_code: "D300",
                task_code: "D300P1A",
                task_desc: "(DE) POTONGAN PINJAMAN",
                loc_code: "P1A",
                task_type: null,
                task_grp: null,
                task_nature: null,
                is_deduction: 1,
                adj_ad_code: null,
                doc_desc: "(DE) POTONGAN PINJAMAN",
                base_task_code: "D300"
            },
            {
                ad_code: "D400",
                task_code: "D400P1A",
                task_desc: "(DE) SPSI",
                loc_code: "P1A",
                task_type: null,
                task_grp: null,
                task_nature: null,
                is_deduction: 1,
                adj_ad_code: null,
                doc_desc: "(DE) SPSI",
                base_task_code: "D400"
            },
            {
                ad_code: "D500",
                task_code: "D500P1A",
                task_desc: "(DE) POTONGAN PPH21",
                loc_code: "P1A",
                task_type: null,
                task_grp: null,
                task_nature: null,
                is_deduction: 1,
                adj_ad_code: null,
                doc_desc: "(DE) POTONGAN PPH21",
                base_task_code: "D500"
            }
        ];

        expect(buildAutomationAdjustmentOptions(options)).toEqual([
            {
                category: "premi",
                adjustment_type: "PREMI",
                adjustment_name: "INSENTIF PANEN",
                ad_code: "A100",
                description: "INSENTIF PANEN",
                task_code: "A100P1A",
                task_desc: "(AL) INSENTIF PANEN",
                base_task_code: "A100",
                loc_code: "P1A"
            },
            {
                category: "koreksi",
                adjustment_type: "POTONGAN_KOTOR",
                adjustment_name: "KOREKSI PANEN",
                ad_code: "D200",
                description: "KOREKSI PANEN",
                task_code: "D200P1A",
                task_desc: "(DE) KOREKSI PANEN",
                base_task_code: "D200",
                loc_code: "P1A"
            },
            {
                category: "potongan_upah_bersih",
                adjustment_type: "POTONGAN_BERSIH",
                adjustment_name: "POTONGAN PINJAMAN",
                ad_code: "DE0002",
                description: "POTONGAN PINJAMAN",
                task_code: "DE0002P1A",
                task_desc: "(DE) POTONGAN HUTANG",
                base_task_code: "DE0002",
                loc_code: "P1A"
            }
        ]);
    });
});
