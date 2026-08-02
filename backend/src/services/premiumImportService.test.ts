import { describe, expect, it, mock } from "bun:test";
import ExcelJS from "exceljs";
import { importPremiumExcel } from "./premiumImportService";
import type { ManualAdjustmentService } from "./manualAdjustmentService";

async function buildWorkbookBuffer(rows: unknown[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Premi");
    worksheet.addRow(["empcode", "gang_code", "subblok", "jumlah", "jenis", "action"]);
    for (const row of rows) {
        worksheet.addRow(row);
    }
    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data as ArrayBuffer);
}

function createManualAdjustmentServiceMock() {
    const payloads: any[] = [];
    const saveAdjustment = mock(async (payload: any) => {
        payloads.push(payload);
        return payloads.length;
    });
    return {
        service: { saveAdjustment } as unknown as ManualAdjustmentService,
        payloads,
        saveAdjustment
    };
}

describe("premiumImportService", () => {
    it("imports contiguous same employee and premium rows as one metadata record", async () => {
        const buffer = await buildWorkbookBuffer([
            ["A0001", "G1H", "P09/01", 300000, "PRUNING", ""],
            ["A0001", "G1H", "P09/02", 150000, "PRUNING", ""]
        ]);
        const { service, payloads } = createManualAdjustmentServiceMock();

        const result = await importPremiumExcel(buffer, 4, 2026, "AB1", service);

        expect(result.success).toBe(true);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({
            emp_code: "A0001",
            adjustment_name: "PREMI PRUNING",
            amount: 450000,
            force_insert: false
        });
        expect(JSON.parse(payloads[0].metadata_json)).toMatchObject({
            input_type: "blok",
            items: [
                { subblok: "P09/01", gang_code: "G1H", jumlah: 300000 },
                { subblok: "P09/02", gang_code: "G1H", jumlah: 150000 }
            ],
            total_amount: 450000
        });
    });

    it("starts a new payload when employee changes", async () => {
        const buffer = await buildWorkbookBuffer([
            ["A0001", "G1H", "P09/01", 300000, "PRUNING", ""],
            ["B0002", "G1H", "P09/02", 150000, "PRUNING", ""]
        ]);
        const { service, payloads } = createManualAdjustmentServiceMock();

        const result = await importPremiumExcel(buffer, 4, 2026, "AB1", service);

        expect(result.success).toBe(true);
        expect(payloads.map((payload) => payload.emp_code)).toEqual(["A0001", "B0002"]);
        expect(payloads.map((payload) => JSON.parse(payload.metadata_json).items.length)).toEqual([1, 1]);
    });

    it("allows blank ADD continuation rows inside the active record", async () => {
        const buffer = await buildWorkbookBuffer([
            ["A0001", "G1H", "P09/01", 300000, "PRUNING", "NEW"],
            ["", "", "P09/02", 150000, "", "ADD"]
        ]);
        const { service, payloads } = createManualAdjustmentServiceMock();

        const result = await importPremiumExcel(buffer, 4, 2026, "AB1", service);

        expect(result.success).toBe(true);
        expect(payloads).toHaveLength(1);
        expect(JSON.parse(payloads[0].metadata_json).items).toEqual([
            { subblok: "P09/01", gang_code: "G1H", jumlah: 300000 },
            { subblok: "P09/02", gang_code: "G1H", jumlah: 150000 }
        ]);
    });

    it("rejects ADD when it changes employee identity", async () => {
        const buffer = await buildWorkbookBuffer([
            ["A0001", "G1H", "P09/01", 300000, "PRUNING", "NEW"],
            ["B0002", "G1H", "P09/02", 150000, "PRUNING", "ADD"]
        ]);
        const { service, payloads } = createManualAdjustmentServiceMock();

        const result = await importPremiumExcel(buffer, 4, 2026, "AB1", service);

        expect(result.success).toBe(true);
        expect(payloads).toHaveLength(1);
        expect(result.errors).toContain("Baris 3: ADD tidak boleh mengganti empcode dari A0001 ke B0002. Gunakan NEW.");
    });

    it("keeps explicit NEW records separate for the same employee and premium", async () => {
        const buffer = await buildWorkbookBuffer([
            ["A0001", "G1H", "P09/01", 300000, "PRUNING", "NEW"],
            ["A0001", "G1H", "P09/02", 150000, "PRUNING", "NEW"]
        ]);
        const { service, payloads } = createManualAdjustmentServiceMock();

        const result = await importPremiumExcel(buffer, 4, 2026, "AB1", service);

        expect(result.success).toBe(true);
        expect(payloads).toHaveLength(2);
        expect(payloads.map((payload) => payload.force_insert)).toEqual([false, true]);
        expect(payloads.map((payload) => JSON.parse(payload.metadata_json).items)).toEqual([
            [{ subblok: "P09/01", gang_code: "G1H", jumlah: 300000 }],
            [{ subblok: "P09/02", gang_code: "G1H", jumlah: 150000 }]
        ]);
    });
});
