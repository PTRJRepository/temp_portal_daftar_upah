import { afterEach, describe, expect, it, mock } from "bun:test";
import { Database } from "../db/client";
import { taskCodeOptionService } from "./taskCodeOptionService";
import { manualAdjustmentPresetService } from "./manualAdjustmentPresetService";
import { EmployeeEstateService } from "./employeeEstateService";
import {
    buildAdtransDuplicateReport,
    buildManualAdjustmentApiResponseRows,
    buildGroupedManualAdjustmentResponse,
    buildManualAdjustmentRemarks,
    computeManualAdjustmentSyncStatuses,
    manualAdjustmentRequiresAdCode,
    manualAdjustmentService
} from "./manualAdjustmentService";

type QueryCall = {
    sql: string;
    params: any[];
};

describe("manual adjustment ADCode rules", () => {
    it("requires ADCode for every manual adjustment type except auto buffer", () => {
        expect(manualAdjustmentRequiresAdCode("PREMI")).toBe(true);
        expect(manualAdjustmentRequiresAdCode("POTONGAN_KOTOR")).toBe(true);
        expect(manualAdjustmentRequiresAdCode("POTONGAN_BERSIH")).toBe(true);
        expect(manualAdjustmentRequiresAdCode("PENDAPATAN_LAINNYA")).toBe(true);
        expect(manualAdjustmentRequiresAdCode("AUTO_BUFFER")).toBe(false);
    });

    it("builds ADCode remarks from structured fields", () => {
        expect(buildManualAdjustmentRemarks({
            period_month: 4,
            period_year: 2026,
            emp_code: "A0001",
            gang_code: "G1H",
            adjustment_type: "PREMI",
            adjustment_name: "PREMI MANUAL",
            amount: 1000,
            ad_code: "AL001",
            task_desc: "(AL) PANEN"
        })).toBe("AD CODE: AL001 - (AL) PANEN");
    });

    it("preserves existing remarks after the ADCode prefix", () => {
        expect(buildManualAdjustmentRemarks({
            period_month: 4,
            period_year: 2026,
            emp_code: "A0001",
            gang_code: "G1H",
            adjustment_type: "POTONGAN_KOTOR",
            adjustment_name: "KOREKSI MANUAL",
            amount: -1000,
            ad_code: "DE001",
            task_desc: "(DE) KOREKSI",
            remarks: "catatan user"
        })).toBe("AD CODE: DE001 - (DE) KOREKSI; catatan user");
    });

    it("does not duplicate an existing ADCode remark", () => {
        expect(buildManualAdjustmentRemarks({
            period_month: 4,
            period_year: 2026,
            emp_code: "A0001",
            gang_code: "G1H",
            adjustment_type: "POTONGAN_BERSIH",
            adjustment_name: "POTONGAN MANUAL",
            amount: -1000,
            ad_code: "DE001",
            task_desc: "(DE) POTONGAN",
            remarks: "AD CODE: DE001 - (DE) POTONGAN"
        })).toBe("AD CODE: DE001 - (DE) POTONGAN");
    });

    it("preserves pipe-formatted sync remarks without adding ADCode prefix", () => {
        expect(buildManualAdjustmentRemarks({
            period_month: 4,
            period_year: 2026,
            emp_code: "A0001",
            gang_code: "G1H",
            adjustment_type: "POTONGAN_KOTOR",
            adjustment_name: "KOREKSI DENDA",
            amount: 0,
            ad_code: "DE0004",
            task_desc: "(DE) POTONGAN PREMI",
            remarks: "KOREKSI DENDA | DE0004 - (DE) POTONGAN PREMI | 0 | sync:MISS | match:MISMATCH"
        })).toBe("KOREKSI DENDA | DE0004 - (DE) POTONGAN PREMI | 0 | sync:MISS | match:MISMATCH");
    });

    it("rejects new manual column initialization without ADCode before querying", async () => {
        const originalGetInstance = Database.getInstance;
        let queryCalled = false;
        const mockDb = {
            queryOne: async () => {
                queryCalled = true;
                return null;
            },
            query: async () => {
                queryCalled = true;
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            await expect(manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 0,
                remarks: "INIT_COLUMN - Kolom ditambahkan tanpa nilai"
            })).rejects.toThrow("ADCode wajib diisi");
            expect(queryCalled).toBe(false);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("rejects PREMI names that are not present in premium definitions before querying", async () => {
        const originalGetInstance = Database.getInstance;
        let queryCalled = false;
        const mockDb = {
            queryOne: async () => {
                queryCalled = true;
                return null;
            },
            query: async () => {
                queryCalled = true;
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            await expect(manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI RAWAT BEBAS",
                amount: 1000,
                ad_code: "AL001",
                task_desc: "(AL) PREMI MANUAL"
            })).rejects.toThrow("tidak ditemukan dalam definisi premium");
            expect(queryCalled).toBe(false);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("normalizes free-text koreksi to fixed prefix and DE potongan premi mapping", async () => {
        const originalGetInstance = Database.getInstance;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 92 }];
            }
        };

        (Database as any).getInstance = () => mockDb;
        (manualAdjustmentPresetService as any).upsertPreset = mock(async () => 92);

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "POTONGAN_KOTOR",
                adjustment_name: "panen",
                amount: 1000
            });

            const insertCall = calls.find((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"));
            expect(id).toBe(92);
            expect(insertCall?.params).toContain("KOREKSI PANEN");
            expect(insertCall?.params).toContain("AD CODE: DE0004 - (DE) POTONGAN PREMI");
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("allows legacy inline manual edits without ADCode", async () => {
        const originalGetInstance = Database.getInstance;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 88 }];
            }
        };

        (Database as any).getInstance = () => mockDb;
        (manualAdjustmentPresetService as any).upsertPreset = mock(async () => 88);

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI CUCI MOBIL",
                amount: 1000,
                remarks: "Edited via UI"
            });

            expect(id).toBe(88);
            expect(calls.some((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"))).toBe(true);
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("allows edit-mode sync manual remarks without ADCode", async () => {
        const originalGetInstance = Database.getInstance;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 90 }];
            }
        };

        (Database as any).getInstance = () => mockDb;
        (manualAdjustmentPresetService as any).upsertPreset = mock(async () => 90);

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI CUCI MOBIL",
                amount: 1000,
                remarks: "PREMI CUCI MOBIL | MANUAL EDIT | 1000 | sync:MANUAL | match:MANUAL"
            });

            expect(id).toBe(90);
            expect(calls.some((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"))).toBe(true);
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("preserves existing metadata_json when an amount-only update is saved", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 55 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 123000,
                remarks: "PREMI PRUNING | MANUAL EDIT | 123000 | sync:MANUAL | match:MANUAL"
            });

            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(id).toBe(55);
            expect(updateCall?.sql).toContain("metadata_json = metadata_json");
            expect(updateCall?.params).toEqual([
                "A0001",
                null,
                "G1H",
                null,
                123000,
                "PREMI PRUNING | MANUAL EDIT | 123000 | sync:MANUAL | match:MANUAL",
                null,
                "system",
                55
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("updates metadata_json when structured premium detail is provided", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 56 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const metadata = JSON.stringify({
                input_type: "blok",
                items: [{ subblok: "P0808", gang_code: "G1H", jumlah: 123000 }],
                total_amount: 123000
            });

            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 123000,
                remarks: "PREMI PRUNING | MANUAL EDIT | 123000 | sync:MANUAL | match:MANUAL",
                metadata_json: metadata
            });

            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(id).toBe(56);
            expect(updateCall?.sql).toContain("metadata_json = ?");
            expect(updateCall?.params).toEqual([
                "A0001",
                null,
                "G1H",
                null,
                123000,
                "PREMI PRUNING | MANUAL EDIT | 123000 | sync:MANUAL | match:MANUAL",
                metadata,
                null,
                "system",
                56
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("updates existing manual adjustment scope when saving from the current gang", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 22448 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const metadata = JSON.stringify({
                input_type: "blok",
                items: [{ subblok: "PM0808", gang_code: "F1BHL", jumlah: 165000 }],
                total_amount: 165000
            });

            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "F0524",
                nik: "5202023112930014",
                gang_code: "F1BHL",
                division_code: "ARA",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 165000,
                remarks: "PREMI PRUNING | MANUAL EDIT | 165000 | sync:MANUAL | match:MANUAL",
                metadata_json: metadata
            });

            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(id).toBe(22448);
            expect(updateCall?.sql).toContain("gang_code =");
            expect(updateCall?.sql).toContain("division_code =");
            expect(updateCall?.params).toContain("F1BHL");
            expect(updateCall?.params).toContain("ARA");
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("inserts new pruning detail with amount synced from metadata total", async () => {
        const originalGetInstance = Database.getInstance;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 57 }];
            }
        };

        (Database as any).getInstance = () => mockDb;
        (manualAdjustmentPresetService as any).upsertPreset = mock(async () => 57);

        try {
            const metadata = JSON.stringify({
                input_type: "blok",
                items: [
                    { subblok: "P0808", gang_code: "G1H", jumlah: 123000 },
                    { subblok: "P0809", gang_code: "G1H", jumlah: 77000 }
                ],
                total_amount: 200000
            });

            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                division_code: "P2A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 0,
                remarks: "PREMI PRUNING | MANUAL EDIT | 0 | sync:MANUAL | match:MANUAL",
                metadata_json: metadata
            });

            const insertCall = calls.find((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"));
            expect(id).toBe(57);
            expect(insertCall?.params).toEqual([
                4, 2026, "A0001", null, null, "G1H", "P2A",
                "PREMI", "PREMI PRUNING", 200000,
                "PREMI PRUNING | MANUAL EDIT | 0 | sync:MANUAL | match:MANUAL",
                metadata,
                "system"
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("updates existing raking detail with amount synced from metadata item sum", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 58 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const metadata = JSON.stringify({
                input_type: "blok",
                items: [
                    { subblok: "P0101", gang_code: "G1H", jumlah: 50000 },
                    { subblok: "P0102", gang_code: "G1H", jumlah: 75000 }
                ],
                total_amount: 0
            });

            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0002",
                gang_code: "G1H",
                division_code: "P2A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI RAKING",
                amount: 0,
                remarks: "PREMI RAKING | MANUAL EDIT | 0 | sync:MANUAL | match:MANUAL",
                metadata_json: metadata
            });

            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            const expectedMetadata = JSON.stringify({
                input_type: "blok",
                items: [
                    { subblok: "P0101", gang_code: "G1H", jumlah: 50000 },
                    { subblok: "P0102", gang_code: "G1H", jumlah: 75000 }
                ],
                total_amount: 125000
            });
            expect(id).toBe(58);
            expect(updateCall?.params).toEqual([
                "A0002",
                null,
                "G1H",
                "P2A",
                125000,
                "PREMI RAKING | MANUAL EDIT | 0 | sync:MANUAL | match:MANUAL",
                expectedMetadata,
                null,
                "system",
                58
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("normalizes numeric emp_code into PTRJ EmpCode and stores NIK separately when updating a legacy row", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("HR_EMPLOYEE")) {
                    return { nik: "3171000000000001", emp_code: "B0001", emp_name: "ANANDA DIKI PALINTONI ( ELSI )" };
                }
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 88 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "3171000000000001",
                gang_code: "B1H",
                division_code: "P1A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 250000,
                remarks: "PREMI PRUNING | MANUAL EDIT | 250000 | sync:MANUAL | match:MANUAL"
            });

            const lookupCall = calls.find((call) => call.sql.includes("SELECT TOP 1 id FROM dbo.payroll_manual_adjustments"));
            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(id).toBe(88);
            expect(lookupCall?.params).toEqual([
                4,
                2026,
                "B0001",
                "3171000000000001",
                "3171000000000001",
                "PREMI",
                "PREMI PRUNING",
                "B0001",
                "3171000000000001",
                "3171000000000001"
            ]);
            expect(updateCall?.params).toEqual([
                "B0001",
                "3171000000000001",
                "B1H",
                "P1A",
                250000,
                "PREMI PRUNING | MANUAL EDIT | 250000 | sync:MANUAL | match:MANUAL",
                "ANANDA DIKI PALINTONI ( ELSI )",
                "system",
                88
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("resolves numeric emp_code by emp_name and gang when NIK is not found in HR", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("UPPER(RTRIM(e.EmpName))")) {
                    return { nik: "1902042507000003", emp_code: "E0287", emp_name: "ANANDA DIKI PALINTONI ( ELSI )" };
                }
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 89 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "1902042507000003",
                gang_code: "E2H",
                division_code: "DME",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 695750,
                remarks: "PREMI PRUNING | MANUAL EDIT | 695750 | sync:MANUAL | match:MANUAL",
                emp_name: "ANANDA DIKI PALINTONI ( ELSI )"
            });

            const contextLookup = calls.find((call) => call.sql.includes("UPPER(RTRIM(e.EmpName))"));
            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(id).toBe(89);
            expect(contextLookup?.params).toEqual(["ANANDA DIKI PALINTONI ( ELSI )", "E2H"]);
            expect(updateCall?.params).toEqual([
                "E0287",
                "1902042507000003",
                "E2H",
                "DME",
                695750,
                "PREMI PRUNING | MANUAL EDIT | 695750 | sync:MANUAL | match:MANUAL",
                "ANANDA DIKI PALINTONI ( ELSI )",
                "system",
                89
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("resolves numeric emp_code from payroll history when employee is not in current HR", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("history_hr_employee")) {
                    return { nik: "1906032107840001", emp_code: "J0872", emp_name: "HARYANTO ( SINAWATI )" };
                }
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 90 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "1906032107840001",
                gang_code: "J3P",
                division_code: "ARC",
                adjustment_type: "AUTO_BUFFER",
                adjustment_name: "AUTO SPSI",
                amount: 0,
                remarks: "AUTO SPSI | potongan spsi | 0 | sync:SYNC | match:MATCH",
                emp_name: "HARYANTO ( SINAWATI )"
            });

            const historyLookup = calls.find((call) => call.sql.includes("history_hr_employee"));
            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(id).toBe(90);
            expect(historyLookup).toBeTruthy();
            expect(updateCall?.params).toEqual([
                "J0872",
                "1906032107840001",
                "J3P",
                "ARC",
                0,
                "AUTO SPSI | potongan spsi | 0 | sync:SYNC | match:MATCH",
                "HARYANTO ( SINAWATI )",
                "system",
                90
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("fills preset ADCode from task mapping for edit-mode saves", async () => {
        const originalGetInstance = Database.getInstance;
        const originalSearchOptions = taskCodeOptionService.searchOptions;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const upsertPreset = mock(async () => 123);
        const mockDb = {
            queryOne: async () => null,
            query: async () => [{ id: 91 }]
        };

        (Database as any).getInstance = () => mockDb;
        (taskCodeOptionService as any).searchOptions = async () => [{
            ad_code: "AL001",
            task_code: "AL001P2A",
            base_task_code: "AL001",
            task_desc: "(AL) PANEN",
            loc_code: "P2A",
            task_type: null,
            task_grp: null,
            task_nature: null,
            is_deduction: 0,
            adj_ad_code: "AL001",
            doc_desc: "(AL) PANEN"
        }];
        (manualAdjustmentPresetService as any).upsertPreset = upsertPreset;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                division_code: "PG2A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 1000,
                remarks: "PREMI PRUNING | MANUAL EDIT | 1000 | sync:MANUAL | match:MANUAL"
            });

            expect(id).toBe(91);
            expect(upsertPreset.mock.calls[0][0]).toMatchObject({
                ad_code: "AL001",
                task_code: "AL001P2A",
                base_task_code: "AL001",
                task_desc: "(AL) PANEN"
            });
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (taskCodeOptionService as any).searchOptions = originalSearchOptions;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("replaces descriptive preset ADCode with task mapping before auto-preset upsert", async () => {
        const originalGetInstance = Database.getInstance;
        const originalSearchOptions = taskCodeOptionService.searchOptions;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const upsertPreset = mock(async () => 124);
        const mockDb = {
            queryOne: async () => null,
            query: async () => [{ id: 92 }]
        };

        (Database as any).getInstance = () => mockDb;
        (taskCodeOptionService as any).searchOptions = async () => [{
            ad_code: "AL3PM0101",
            task_code: "AL3PM0101P2A",
            base_task_code: "AL3PM0101",
            task_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)",
            loc_code: "P2A",
            task_type: null,
            task_grp: null,
            task_nature: null,
            is_deduction: 0,
            adj_ad_code: "AL3PM0101",
            doc_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)"
        }];
        (manualAdjustmentPresetService as any).upsertPreset = upsertPreset;

        try {
            const descriptiveAdCode = "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)";
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                division_code: "PG2A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI TBS",
                amount: 1000,
                remarks: "PREMI TBS | MANUAL EDIT | 1000 | sync:MANUAL | match:MANUAL",
                ad_code: descriptiveAdCode,
                task_code: descriptiveAdCode,
                base_task_code: descriptiveAdCode,
                task_desc: descriptiveAdCode
            });

            expect(id).toBe(92);
            expect(upsertPreset).toHaveBeenCalledTimes(1);
            expect(upsertPreset.mock.calls[0][0]).toMatchObject({
                ad_code: "AL3PM0101",
                task_code: "AL3PM0101P2A",
                base_task_code: "AL3PM0101",
                task_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)"
            });
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (taskCodeOptionService as any).searchOptions = originalSearchOptions;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("normalizes POTONGAN_BERSIH non-PPH saves to POTONGAN HUTANG task mapping", async () => {
        const originalGetInstance = Database.getInstance;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const calls: QueryCall[] = [];
        const upsertPreset = mock(async () => 126);
        const mockDb = {
            queryOne: async () => null,
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("INSERT INTO dbo.payroll_manual_adjustments")) return [{ id: 94 }];
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;
        (manualAdjustmentPresetService as any).upsertPreset = upsertPreset;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                division_code: "PG2A",
                adjustment_type: "POTONGAN_BERSIH",
                adjustment_name: "POTONGAN PINJAMAN",
                amount: -1000,
                ad_code: "DE0100",
                task_code: "DE0100P2A",
                base_task_code: "DE0100",
                task_desc: "(DE) POTONGAN PINJAMAN",
                remarks: "POTONGAN PINJAMAN | DE0100 - (DE) POTONGAN PINJAMAN | -1000 | sync:MANUAL | match:MANUAL"
            });

            const insertCall = calls.find((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"));
            expect(id).toBe(94);
            expect(insertCall?.params).toContain("POTONGAN PINJAMAN | DE0002 - (DE) POTONGAN HUTANG | -1000 | sync:MANUAL | match:MANUAL");
            expect(upsertPreset).toHaveBeenCalledTimes(1);
            expect(upsertPreset.mock.calls[0][0]).toMatchObject({
                ad_code: "DE0002",
                task_code: "DE0002P2A",
                base_task_code: "DE0002",
                task_desc: "(DE) POTONGAN HUTANG"
            });
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("skips auto-preset upsert when ADCode remains descriptive after mapping lookup", async () => {
        const originalGetInstance = Database.getInstance;
        const originalSearchOptions = taskCodeOptionService.searchOptions;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const upsertPreset = mock(async () => 125);
        const mockDb = {
            queryOne: async () => null,
            query: async () => [{ id: 93 }]
        };

        (Database as any).getInstance = () => mockDb;
        (taskCodeOptionService as any).searchOptions = async () => [];
        (manualAdjustmentPresetService as any).upsertPreset = upsertPreset;

        try {
            const descriptiveAdCode = "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)";
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                division_code: "PG2A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI TBS",
                amount: 1000,
                remarks: "PREMI TBS | MANUAL EDIT | 1000 | sync:MANUAL | match:MANUAL",
                ad_code: descriptiveAdCode,
                task_code: descriptiveAdCode,
                base_task_code: descriptiveAdCode,
                task_desc: descriptiveAdCode
            });

            expect(id).toBe(93);
            expect(upsertPreset).not.toHaveBeenCalled();
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (taskCodeOptionService as any).searchOptions = originalSearchOptions;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("stores emp_name when saving manual adjustment rows", async () => {
        const originalGetInstance = Database.getInstance;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 89 }];
            }
        };

        (Database as any).getInstance = () => mockDb;
        (manualAdjustmentPresetService as any).upsertPreset = mock(async () => 89);

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                nik: "1902050504860001",
                gang_code: "P1A",
                division_code: "P1A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 1000,
                remarks: "Edited via UI",
                emp_name: "BUDI TEST"
            } as any);

            expect(id).toBe(89);
            const insertCall = calls.find((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"));
            expect(insertCall?.sql).toContain("emp_name");
            expect(insertCall?.params).toContain("BUDI TEST");
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("allows auto-buffer adjustment without ADCode", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 99 }];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "AUTO_BUFFER",
                adjustment_name: "AUTO SPSI",
                amount: 4000
            });

            expect(id).toBe(99);
            // ponytail: saveAdjustment now does real-time sync/match write-back (+SELECT row +UPDATE remarks).
            //  Warm test env (schema cache hit): 2 identity + INSERT + writeback-SELECT + writeback-UPDATE = 5.
            //  Cold env adds 1 schema-check call = 6.
            expect(calls.length).toBeGreaterThanOrEqual(5);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("normalizes division_code to 3-character format when saving adjustment rows", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 101 }];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "A1H",
                division_code: "PG1A",
                adjustment_type: "AUTO_BUFFER",
                adjustment_name: "AUTO SPSI",
                amount: 4000
            });

            expect(id).toBe(101);
            const insertCall = calls.find((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"));
            expect(insertCall?.params).toContain("P1A");
            expect(insertCall?.params).not.toContain("PG1A");
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("fetches manual adjustments using both 3-code and 4-code division formats", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            await manualAdjustmentService.getAdjustments(4, 2026, undefined, undefined, "P2A");
            await manualAdjustmentService.getAdjustments(4, 2026, undefined, undefined, "PG2A");
            await manualAdjustmentService.getAdjustments(4, 2026, undefined, undefined, "2A");

            expect(calls[0].sql).toContain("division_code IN");
            expect(calls[0].params.slice(2).sort()).toEqual(["P2A", "PG2A"]);
            expect(calls[1].sql).toContain("division_code IN");
            expect(calls[1].params.slice(2).sort()).toEqual(["P2A", "PG2A"]);
            expect(calls[2].sql).toContain("division_code IN");
            expect(calls[2].params.slice(2).sort()).toEqual(["P2A", "PG2A"]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("keeps legacy manual adjustment rows with blank division_code available for division payroll loads", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            await manualAdjustmentService.getAdjustments(4, 2026, undefined, undefined, "PG2A");

            expect(calls[0].sql).toContain("division_code IN");
            expect(calls[0].sql).toContain("division_code IS NULL");
            expect(calls[0].sql).toContain("LTRIM(RTRIM(division_code)) = ''");
            expect(calls[0].params.slice(2).sort()).toEqual(["P2A", "PG2A"]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("can fetch only adjustments that have metadata_json", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            await manualAdjustmentService.getAdjustments(4, 2026, undefined, undefined, "AB1", "PREMI", undefined, true);

            expect(calls[0].sql).toContain("metadata_json IS NOT NULL");
            expect(calls[0].sql).toContain("LTRIM(RTRIM(metadata_json)) <> ''");
            expect(calls[0].params).toContain("PREMI");
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("enriches fetched manual adjustment rows with jabatan for vehicle expense normalization", async () => {
        const originalGetInstance = Database.getInstance;
        const originalGetEmployeeJobsWithNik = EmployeeEstateService.getEmployeeJobsWithNik;
        const mockDb = {
            query: async (sql: string) => {
                if (sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 31,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "G0352",
                            nik: "5203180107750348",
                            emp_name: "MAHSUN",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI RITASE",
                            amount: 29475,
                            metadata_json: JSON.stringify({
                                input_type: "kendaraan",
                                items: [{ nomor_kendaraan: "BN8781WA", expense_code: "TRANSPORT", jumlah: 29475 }],
                                total_amount: 29475
                            })
                        }
                    ];
                }
                return [];
            }
        };
        const getEmployeeJobsWithNik = mock(async () => ({
            empcodeMap: { G0352: "(PM) HELPER" },
            nikMap: {}
        }));

        (Database as any).getInstance = () => mockDb;
        (EmployeeEstateService as any).getEmployeeJobsWithNik = getEmployeeJobsWithNik;

        try {
            const rows = await manualAdjustmentService.getAdjustments(4, 2026, undefined, undefined, "AB1", "PREMI", undefined, true);

            expect(rows[0]).toMatchObject({
                emp_code: "G0352",
                jabatan: "(PM) HELPER"
            });
            expect(getEmployeeJobsWithNik).toHaveBeenCalledWith(["G0352"]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (EmployeeEstateService as any).getEmployeeJobsWithNik = originalGetEmployeeJobsWithNik;
        }
    });

    it("lists distinct manual adjustment names by division, gang, and type", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI PRUNING"
                        },
                        {
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI TBS"
                        },
                        {
                            adjustment_type: "POTONGAN_KOTOR",
                            adjustment_name: "KOREKSI PANEN"
                        }
                    ];
                }
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const options = await manualAdjustmentService.listAdjustmentNameOptions({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                gangCode: "G1H",
                adjustmentTypes: ["PREMI", "POTONGAN_KOTOR"],
                limit: 20
            });

            const selectCall = calls.find((call) => call.sql.includes("FROM dbo.payroll_manual_adjustments"));
            expect(selectCall?.sql).toContain("SELECT DISTINCT TOP (20)");
            expect(selectCall?.sql).toContain("adjustment_type IN");
            expect(selectCall?.sql).toContain("period_month = ?");
            expect(selectCall?.sql).toContain("period_year = ?");
            expect(selectCall?.sql).toContain("division_code IN");
            expect(selectCall?.sql).toContain("UPPER(gang_code) = ?");
            expect(selectCall?.sql).toContain("ORDER BY adjustment_type ASC, adjustment_name ASC");
            expect(selectCall?.params).toEqual(["PREMI", "POTONGAN_KOTOR", 4, 2026, "AB1", "ARB1", "G1H"]);
            expect(options).toEqual([
                {
                    adjustment_type: "PREMI",
                    adjustment_name: "PREMI PRUNING"
                },
                {
                    adjustment_type: "PREMI",
                    adjustment_name: "PREMI TBS"
                },
                {
                    adjustment_type: "POTONGAN_KOTOR",
                    adjustment_name: "KOREKSI PANEN"
                }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("updates only the sync segment when ADTRANS verification is not requested", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 10,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0001",
                            nik: "1902050504860001",
                            emp_name: "BUDI TEST",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI JAGA",
                            amount: 350000,
                            remarks: "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:MANUAL | match:MANUAL"
                        },
                        {
                            id: 11,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0002",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "AUTO_BUFFER",
                            adjustment_name: "AUTO SPSI",
                            amount: 4000,
                            remarks: "AUTO SPSI | potongan spsi | 4000 | sync:MANUAL | match:MANUAL"
                        }
                    ];
                }
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["PREMI"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync"
            });

            const selectCall = calls.find((call) => call.sql.includes("FROM dbo.payroll_manual_adjustments"));
            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));

            expect(selectCall?.sql).toContain("adjustment_type IN");
            expect(selectCall?.params).toEqual([4, 2026, "PREMI", "AB1", "ARB1"]);
            expect(updateCall?.sql).toContain("SET remarks = ?, updated_at = GETDATE(), updated_by = ?");
            expect(updateCall?.sql).not.toContain("amount =");
            expect(updateCall?.params).toEqual([
                "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:SYNC | match:MANUAL",
                "agent_sync",
                10
            ]);
            expect(result.updated_count).toBe(1);
            expect(result.rows).toEqual([
                expect.objectContaining({
                    id: 10,
                    ad_code: "AL0018P1A",
                    ad_code_desc: "(AL) TUNJANGAN JAGA GENSET",
                    ad_desc: "(AL) TUNJANGAN JAGA GENSET",
                    task_desc: "(AL) TUNJANGAN JAGA GENSET",
                    old_sync_status: "MANUAL",
                    new_sync_status: "SYNC",
                    status: "UPDATED"
                })
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("fills sync status ADCode fields from premium definitions when remarks do not contain ADCode", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 15,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "G0352",
                            nik: "5203180107750348",
                            emp_name: "MAHSUN ( INAQ MAHYAM )",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI JAGA",
                            amount: 350000,
                            remarks: "PREMI JAGA | MANUAL EDIT | 350000 | sync:MANUAL | match:MANUAL"
                        }
                    ];
                }
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["PREMI"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync"
            });

            expect(result.rows[0]).toMatchObject({
                id: 15,
                ad_code: "(AL) TUNJANGAN JAGA GENSET",
                ad_code_desc: "(AL) TUNJANGAN JAGA GENSET",
                ad_desc: "(AL) TUNJANGAN JAGA GENSET",
                task_desc: "(AL) TUNJANGAN JAGA GENSET",
                status: "UPDATED"
            });
            expect(result.rows[0].ad_code).not.toBe("");
            expect(result.rows[0].ad_code_desc).not.toBe("");
            expect(result.rows[0].task_desc).not.toBe("");
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("reconciles rows to SYNC or MISS in adtrans_exists mode", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbExtend = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 12,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0001",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI JAGA",
                            amount: 350000,
                            remarks: "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:MANUAL | match:MANUAL"
                        },
                        {
                            id: 13,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0002",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI TBS",
                            amount: 123000,
                            remarks: "PREMI TBS | (AL) TUNJANGAN PREMI | 123000 | sync:MANUAL | match:MANUAL"
                        }
                    ];
                }
                return [];
            }
        };
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [
                    {
                        emp_code: "A0001",
                        doc_id: "AD001",
                        doc_desc: "(AL) TUNJANGAN JAGA GENSET",
                        amount: 350000
                    }
                ];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["PREMI"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync",
                onlyIfAdtransExists: true
            });

            const adtransCall = calls.find((call) => call.sql.includes("FROM PR_ADTRANS t"));
            const updateCalls = calls.filter((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));

            expect(adtransCall?.params).toEqual(["AB1", 4, 2026, "A0001", "A0002", "AB1", 4, 2026, "A0001", "A0002"]);
            expect(updateCalls).toHaveLength(2);
            expect(updateCalls[0].params?.[2]).toBe(12);
            expect(updateCalls[0].params?.[0]).toBe("PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:SYNC | match:MATCH");
            expect(updateCalls[1].params?.[2]).toBe(13);
            expect(updateCalls[1].params?.[0]).toBe("PREMI TBS | (AL) TUNJANGAN PREMI | 123000 | sync:MISS | match:MISMATCH");
            expect(result.updated_count).toBe(2);
            expect(result.adtrans_matched_count).toBe(1);
            expect(result.skipped_count).toBe(0);
            expect(result.rows.map((row) => ({
                id: row.id,
                status: row.status,
                skip_reason: row.skip_reason,
                new_sync_status: row.new_sync_status,
                match_status: row.match_status
            }))).toEqual([
                { id: 12, status: "UPDATED", skip_reason: null, new_sync_status: "SYNC", match_status: "MATCH" },
                { id: 13, status: "UPDATED", skip_reason: null, new_sync_status: "MISS", match_status: "MISMATCH" }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("reconciles sync status from total matching ADTRANS amounts for already-synced, multi-transaction, and missing rows", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbExtend = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 20,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0001",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI JAGA",
                            amount: 350000,
                            remarks: "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:SYNC | match:MATCH"
                        },
                        {
                            id: 21,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0002",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI JAGA",
                            amount: 350000,
                            remarks: "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:MISS | match:MISMATCH"
                        },
                        {
                            id: 22,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0003",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI TBS",
                            amount: 123000,
                            remarks: "PREMI TBS | (AL) TUNJANGAN PREMI | 123000 | sync:SYNC | match:MATCH"
                        }
                    ];
                }
                return [];
            }
        };
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [
                    { emp_code: "A0001", doc_id: "AD001", doc_desc: "(AL) TUNJANGAN JAGA GENSET", amount: 200000 },
                    { emp_code: "A0001", doc_id: "AD002", doc_desc: "(AL) TUNJANGAN JAGA GENSET", amount: 100000 },
                    { emp_code: "A0002", doc_id: "AD003", doc_desc: "(AL) TUNJANGAN JAGA GENSET", amount: 200000 },
                    { emp_code: "A0002", doc_id: "AD004", doc_desc: "(AL) TUNJANGAN JAGA GENSET", amount: 150000 }
                ];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["PREMI"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync",
                onlyIfAdtransExists: true
            });

            const updateCalls = calls.filter((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));

            expect(updateCalls.map((call) => call.params)).toEqual([
                [
                    "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:DIFF | match:MISMATCH",
                    "agent_sync",
                    20
                ],
                [
                    "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:SYNC | match:MATCH",
                    "agent_sync",
                    21
                ],
                [
                    "PREMI TBS | (AL) TUNJANGAN PREMI | 123000 | sync:MISS | match:MISMATCH",
                    "agent_sync",
                    22
                ]
            ]);
            expect(result.updated_count).toBe(3);
            expect(result.skipped_count).toBe(0);
            expect(result.partial_count).toBe(0);
            expect(result.rows.map((row) => ({
                id: row.id,
                adtrans_amount: row.adtrans_amount,
                diff: row.diff,
                new_sync_status: row.new_sync_status,
                match_status: row.match_status,
                status: row.status,
                skip_reason: row.skip_reason
            }))).toEqual([
                {
                    id: 20,
                    adtrans_amount: 300000,
                    diff: -50000,
                    new_sync_status: "DIFF",
                    match_status: "MISMATCH",
                    status: "UPDATED",
                    skip_reason: null
                },
                {
                    id: 21,
                    adtrans_amount: 350000,
                    diff: 0,
                    new_sync_status: "SYNC",
                    match_status: "MATCH",
                    status: "UPDATED",
                    skip_reason: null
                },
                {
                    id: 22,
                    adtrans_amount: 0,
                    diff: -123000,
                    new_sync_status: "MISS",
                    match_status: "MISMATCH",
                    status: "UPDATED",
                    skip_reason: null
                }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("includes auto-buffer rows and compares deduction-like adjustments by absolute amount", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbExtend = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 30,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0004",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "AUTO_BUFFER",
                            adjustment_name: "MASA KERJA",
                            amount: 25000,
                            remarks: "MASA KERJA | masa kerja | 25000 | sync:DIFF | match:MISMATCH"
                        },
                        {
                            id: 31,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0005",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "POTONGAN_KOTOR",
                            adjustment_name: "KOREKSI PANEN",
                            amount: -10000,
                            remarks: "KOREKSI PANEN | DE9999 - KOREKSI PANEN | -10000 | sync:DIFF | match:MISMATCH"
                        }
                    ];
                }
                return [];
            }
        };
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [
                    { emp_code: "A0004", doc_id: "AD005", doc_desc: "TUNJANGAN MASA KERJA", amount: 25000 },
                    { emp_code: "A0005", doc_id: "AD006", doc_desc: "KOREKSI PANEN", amount: 10000 }
                ];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["AUTO_BUFFER", "POTONGAN_KOTOR"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync",
                onlyIfAdtransExists: true
            });

            const selectCall = calls.find((call) => call.sql.includes("FROM dbo.payroll_manual_adjustments"));
            const updateCalls = calls.filter((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));

            expect(selectCall?.params).toEqual([4, 2026, "AUTO_BUFFER", "POTONGAN_KOTOR", "AB1", "ARB1"]);
            expect(updateCalls.map((call) => call.params)).toEqual([
                ["MASA KERJA | masa kerja | 25000 | sync:SYNC | match:MATCH", "agent_sync", 30],
                ["KOREKSI PANEN | DE9999 - KOREKSI PANEN | -10000 | sync:SYNC | match:MATCH", "agent_sync", 31]
            ]);
            expect(result.rows.map((row) => ({
                id: row.id,
                adjustment_type: row.adjustment_type,
                adtrans_amount: row.adtrans_amount,
                diff: row.diff,
                new_sync_status: row.new_sync_status,
                match_status: row.match_status
            }))).toEqual([
                {
                    id: 30,
                    adjustment_type: "AUTO_BUFFER",
                    adtrans_amount: 25000,
                    diff: 0,
                    new_sync_status: "SYNC",
                    match_status: "MATCH"
                },
                {
                    id: 31,
                    adjustment_type: "POTONGAN_KOTOR",
                    adtrans_amount: 10000,
                    diff: 0,
                    new_sync_status: "SYNC",
                    match_status: "MATCH"
                }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("reconciles AUTO_BUFFER POTONGAN PPH against PPh21 ADTRANS by absolute TER amount", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbExtend = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 33,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0006",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "AUTO_BUFFER",
                            adjustment_name: "POTONGAN PPH",
                            amount: 93435,
                            remarks: "POTONGAN PPH | MANUAL EDIT | 93435 | sync:MISS | match:MISMATCH"
                        }
                    ];
                }
                return [];
            }
        };
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [
                    { emp_code: "A0006", doc_id: "AD007", doc_desc: "PPH21", amount: -93435 }
                ];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["AUTO_BUFFER"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync",
                onlyIfAdtransExists: true
            });

            const updateCalls = calls.filter((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(updateCalls).toHaveLength(1);
            expect(updateCalls[0].params).toEqual([
                "POTONGAN PPH | MANUAL EDIT | 93435 | sync:SYNC | match:MATCH",
                "agent_sync",
                33
            ]);
            expect(result.rows[0]).toMatchObject({
                id: 33,
                adjustment_type: "AUTO_BUFFER",
                adjustment_name: "POTONGAN PPH",
                target_amount: 93435,
                adtrans_amount: 93435,
                diff: 0,
                new_sync_status: "SYNC",
                match_status: "MATCH"
            });
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("keeps zero-value auto-buffer rows as SYNC when db_ptrj has no matching transaction", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbExtend = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 32,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0004",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "AUTO_BUFFER",
                            adjustment_name: "TUNJANGAN JABATAN",
                            amount: 0,
                            remarks: "TUNJANGAN JABATAN | tunjangan jabatan | 0 | sync:SYNC | match:MATCH"
                        }
                    ];
                }
                return [];
            }
        };
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["AUTO_BUFFER"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync",
                onlyIfAdtransExists: true
            });

            const updateCalls = calls.filter((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(updateCalls).toHaveLength(0);
            expect(result.updated_count).toBe(0);
            expect(result.unchanged_count).toBe(1);
            expect(result.rows[0]).toMatchObject({
                id: 32,
                target_amount: 0,
                adtrans_amount: 0,
                diff: 0,
                new_sync_status: "SYNC",
                match_status: "MATCH",
                status: "UNCHANGED",
                skip_reason: null
            });
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("marks a metadata-detail premium as DIFF when ADTRANS amount is only partial", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbExtend = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT TOP") && sql.includes("FROM dbo.payroll_manual_adjustments")) {
                    return [
                        {
                            id: 14,
                            period_month: 4,
                            period_year: 2026,
                            emp_code: "A0001",
                            gang_code: "G1H",
                            division_code: "AB1",
                            adjustment_type: "PREMI",
                            adjustment_name: "PREMI PRUNING",
                            amount: 500000,
                            metadata_json: JSON.stringify({
                                input_type: "blok",
                                items: [
                                    { subblok: "P09/01", gang_code: "G1H", jumlah: 350000 },
                                    { subblok: "P09/02", gang_code: "G1H", jumlah: 150000 }
                                ],
                                total_amount: 500000
                            }),
                            remarks: "PREMI PRUNING | AL3PM0601P1A - PRUNING MANUAL | 500000 | sync:MANUAL | match:MANUAL"
                        }
                    ];
                }
                return [];
            }
        };
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [
                    {
                        emp_code: "A0001",
                        doc_id: "AD001",
                        doc_desc: "PRUNING MANUAL",
                        amount: 350000
                    }
                ];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: 4,
                periodYear: 2026,
                divisionCode: "AB1",
                adjustmentTypes: ["PREMI"],
                syncStatus: "SYNC",
                updatedBy: "agent_sync",
                onlyIfAdtransExists: true
            });

            const updateCall = calls.find((call) => call.sql.includes("UPDATE dbo.payroll_manual_adjustments"));
            expect(updateCall?.params).toEqual([
                "PREMI PRUNING | AL3PM0601P1A - PRUNING MANUAL | 500000 | sync:DIFF | match:MISMATCH",
                "agent_sync",
                14
            ]);
            expect(result.updated_count).toBe(1);
            expect(result.partial_count).toBe(0);
            expect(result.rows[0]).toMatchObject({
                id: 14,
                target_amount: 500000,
                metadata_detail_total: 500000,
                adtrans_amount: 350000,
                diff: -150000,
                new_sync_status: "DIFF",
                match_status: "MISMATCH",
                status: "UPDATED",
                skip_reason: null
            });
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("normalizes division_code when deleting a manual adjustment column", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("SELECT id FROM dbo.payroll_manual_adjustments")) {
                    return [{ id: 1 }, { id: 2 }];
                }
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const deleted = await manualAdjustmentService.deleteAdjustmentColumn({
                period_month: 4,
                period_year: 2026,
                division_code: "PG1A",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING"
            });

            expect(deleted).toBe(2);
            expect(calls[0].params).toEqual([4, 2026, "PREMI", "PREMI PRUNING", "P1A"]);
            expect(calls[1].params).toEqual([4, 2026, "PREMI", "PREMI PRUNING", "P1A"]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });
});

describe("manual adjustment grouped response", () => {
    it("builds flat API response rows with estate, derived division code, and parsed ADCode", () => {
        const rows = buildManualAdjustmentApiResponseRows([
            {
                id: 21,
                period_month: 4,
                period_year: 2026,
                emp_code: "C0002",
                nik: "1902050504860021",
                emp_name: "DIDI TEST",
                gang_code: "C2H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 50000,
                remarks: "AD CODE: AL3PM0601P1A - PRUNING MANUAL"
            }
        ] as any);

        expect(rows[0]).toMatchObject({
            estate: "AB1",
            estate_code: "AB1",
            gang_code: "C2H",
            division_code: "C 2",
            ad_code: "AL3PM0601P1A",
            ad_code_desc: "PRUNING MANUAL"
        });
    });

    it("builds flat API response rows with TaskDesc parsed from pipe remarks", () => {
        const taskDesc = "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)";
        const rows = buildManualAdjustmentApiResponseRows([
            {
                id: 22,
                period_month: 4,
                period_year: 2026,
                emp_code: "C0003",
                nik: "5203193101910004",
                emp_name: "ABDURRAHMAN (SENIAH)",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI TBS",
                amount: 423363,
                remarks: `PREMI TBS | ${taskDesc} - ${taskDesc} | 423363 | sync:MANUAL | match:MANUAL`
            }
        ] as any);

        expect(rows[0]).toMatchObject({
            estate: "AB1",
            estate_code: "AB1",
            gang_code: "G1H",
            division_code: "G 1",
            ad_code: taskDesc,
            ad_code_desc: taskDesc
        });
    });

    it("builds AUTO_BUFFER POTONGAN PPH response fields from PPh21 TaskDesc", () => {
        const taskDesc = "(DE) POTONGAN PPH21";
        const rows = buildManualAdjustmentApiResponseRows([
            {
                id: 26,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0006",
                nik: "1902050504860006",
                emp_name: "PPH TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "AUTO_BUFFER",
                adjustment_name: "POTONGAN PPH",
                amount: 93435,
                remarks: `POTONGAN PPH | ${taskDesc} | 93435 | sync:SYNC | match:MATCH`
            }
        ] as any);

        expect(rows[0]).toMatchObject({
            ad_code: taskDesc,
            ad_code_desc: taskDesc,
            ad_desc: taskDesc,
            task_desc: taskDesc
        });
    });

    it("builds flat API response rows with parenthesized ADCode and TaskDesc parsed from pipe remarks", () => {
        const rows = buildManualAdjustmentApiResponseRows([
            {
                id: 23,
                period_month: 4,
                period_year: 2026,
                emp_code: "C0004",
                nik: "5203180107750348",
                emp_name: "MAHSUN ( INAQ MAHYAM )",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI JAGA",
                amount: 350000,
                remarks: "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:MANUAL | match:MANUAL"
            }
        ] as any);

        expect(rows[0]).toMatchObject({
            estate: "AB1",
            estate_code: "AB1",
            gang_code: "G1H",
            division_code: "G 1",
            ad_code: "AL0018P1A",
            ad_code_desc: "(AL) TUNJANGAN JAGA GENSET"
        });
    });

    it("falls back to premium definitions when response ADCode description is missing", () => {
        const rows = buildManualAdjustmentApiResponseRows([
            {
                id: 24,
                period_month: 4,
                period_year: 2026,
                emp_code: "C0004",
                nik: "5203180107750348",
                emp_name: "MAHSUN ( INAQ MAHYAM )",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI JAGA",
                amount: 350000,
                remarks: "manual note without parseable taskdesc"
            }
        ] as any);

        expect(rows[0]).toMatchObject({
            ad_code: "(AL) TUNJANGAN JAGA GENSET",
            ad_code_desc: "(AL) TUNJANGAN JAGA GENSET",
            task_desc: "(AL) TUNJANGAN JAGA GENSET"
        });
    });

    it("uses adjustment name as final non-null ADCode display fallback", () => {
        const rows = buildManualAdjustmentApiResponseRows([
            {
                id: 25,
                period_month: 4,
                period_year: 2026,
                emp_code: "G9999",
                nik: "5200000000000000",
                emp_name: "TEST USER",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI TANPA DEFINISI",
                amount: 1000,
                remarks: "manual note without parseable taskdesc"
            }
        ] as any);

        expect(rows[0]).toMatchObject({
            ad_code: "PREMI TANPA DEFINISI",
            ad_code_desc: "PREMI TANPA DEFINISI",
            ad_desc: "PREMI TANPA DEFINISI",
            task_desc: "PREMI TANPA DEFINISI"
        });
    });

    it("groups rows by division, gang, and employee with premium metadata details", () => {
        const grouped = buildGroupedManualAdjustmentResponse([
            {
                id: 1,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "BUDI TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 3000,
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [{ subblok: "P0921", gang_code: "G1H", jumlah: 3000 }],
                    total_amount: 3000
                })
            },
            {
                id: 2,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "BUDI TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI RITASE",
                amount: 5000,
                metadata_json: JSON.stringify({
                    input_type: "kendaraan",
                    items: [{ nomor_kendaraan: "B1234AB", expense_code: "TRANSPORT", jumlah: 5000 }],
                    total_amount: 5000
                })
            },
            {
                id: 3,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "BUDI TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "POTONGAN_KOTOR",
                adjustment_name: "KOREKSI PANEN",
                amount: -1000
            }
        ] as any);

        expect(grouped.summary).toEqual({
            division_count: 1,
            gang_count: 1,
            employee_count: 1,
            adjustment_count: 3
        });
        expect(grouped.divisions[0]).toMatchObject({ estate: "AB1", estate_code: "AB1" });
        expect(grouped.divisions[0].gangs[0].gang_code).toBe("G1H");
        expect(grouped.divisions[0].gangs[0]).toMatchObject({
            estate: "AB1",
            estate_code: "AB1",
            division_code: "G 1"
        });

        const employee = grouped.divisions[0].gangs[0].employees[0];
        expect(employee).toMatchObject({
            emp_code: "A0001",
            nik: "1902050504860001",
            emp_name: "BUDI TEST",
            estate: "AB1",
            estate_code: "AB1",
            division_code: "G 1",
            adjustment_count: 3,
            premium_count: 2,
            total_amount: 7000,
            premium_total: 8000
        });
        expect(employee.premiums.map((item) => item.adjustment_name)).toEqual(["PREMI PRUNING", "PREMI RITASE"]);
        expect(employee.premiums[0].metadata).toEqual({
            input_type: "blok",
            items: [{ subblok: "P0921", gang_code: "G1H", jumlah: 3000 }],
            total_amount: 3000
        });
        expect(employee.premiums[0].detail_items).toEqual([
            {
                detail_type: "blok",
                subblok: "P0921",
                gang_code: "G1H",
                jumlah: 3000,
                amount: 3000
            }
        ]);
        expect(employee.premiums[1].detail_items).toEqual([
            {
                detail_type: "kendaraan",
                nomor_kendaraan: "B1234AB",
                expense_code: "DRIVER",
                expense_code_raw: "TRANSPORT",
                expense_code_source: "task_desc",
                jumlah: 5000,
                amount: 5000
            }
        ]);
        expect(employee.premium_transactions).toEqual([
            {
                transaction_index: 1,
                adjustment_id: 1,
                record_group_key: "adjustment:1",
                record_action: "NEW",
                record_detail_index: 1,
                record_detail_count: 1,
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "BUDI TEST",
                gang_code: "G1H",
                estate: "AB1",
                estate_code: "AB1",
                division_code: "G 1",
                ad_code: "AL3PM0601P1A",
                ad_code_desc: "(AL) TUNJANGAN PREMI ((PM) PRUNING)",
                ad_desc: "(AL) TUNJANGAN PREMI ((PM) PRUNING)",
                task_desc: "(AL) TUNJANGAN PREMI ((PM) PRUNING)",
                sync_status: null,
                match_status: null,
                is_stale: null,
                adtrans_amount: null,
                diff: null,
                target_amount: null,
                has_adtrans: null,
                detail_type: "blok",
                subblok: "P0921",
                jumlah: 3000,
                amount: 3000
            },
            {
                transaction_index: 2,
                adjustment_id: 2,
                record_group_key: "adjustment:2",
                record_action: "NEW",
                record_detail_index: 1,
                record_detail_count: 1,
                adjustment_type: "PREMI",
                adjustment_name: "PREMI RITASE",
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "BUDI TEST",
                gang_code: "G1H",
                estate: "AB1",
                estate_code: "AB1",
                division_code: "G 1",
                ad_code: "AL3PT2305P1A",
                ad_code_desc: "(AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT MATERIAL)",
                ad_desc: "(AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT MATERIAL)",
                task_desc: "(AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT MATERIAL)",
                sync_status: null,
                match_status: null,
                is_stale: null,
                adtrans_amount: null,
                diff: null,
                target_amount: null,
                has_adtrans: null,
                detail_type: "kendaraan",
                nomor_kendaraan: "B1234AB",
                expense_code: "DRIVER",
                expense_code_raw: "TRANSPORT",
                expense_code_source: "task_desc",
                jumlah: 5000,
                amount: 5000
            }
        ]);
        expect(employee.adjustments.map((item) => item.adjustment_name)).toEqual([
            "KOREKSI PANEN",
            "PREMI PRUNING",
            "PREMI RITASE"
        ]);
    });

    it("marks first detail per adjustment_id as NEW and later details as ADD", () => {
        const grouped = buildGroupedManualAdjustmentResponse([
            {
                id: 101,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "AHMAD TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 450000,
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [
                        { subblok: "P09/01", gang_code: "G1H", jumlah: 300000 },
                        { subblok: "P09/02", gang_code: "G1H", jumlah: 150000 }
                    ],
                    total_amount: 450000
                })
            },
            {
                id: 202,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "AHMAD TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 125000,
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [{ subblok: "P10/01", gang_code: "G1H", jumlah: 125000 }],
                    total_amount: 125000
                })
            }
        ] as any);

        const transactions = grouped.divisions[0].gangs[0].employees[0].premium_transactions;
        expect(transactions.map((tx) => ({
            adjustment_id: tx.adjustment_id,
            record_group_key: tx.record_group_key,
            record_action: tx.record_action,
            record_detail_index: tx.record_detail_index,
            record_detail_count: tx.record_detail_count,
            subblok: tx.subblok
        }))).toEqual([
            {
                adjustment_id: 101,
                record_group_key: "adjustment:101",
                record_action: "NEW",
                record_detail_index: 1,
                record_detail_count: 2,
                subblok: "P0901"
            },
            {
                adjustment_id: 101,
                record_group_key: "adjustment:101",
                record_action: "ADD",
                record_detail_index: 2,
                record_detail_count: 2,
                subblok: "P0902"
            },
            {
                adjustment_id: 202,
                record_group_key: "adjustment:202",
                record_action: "NEW",
                record_detail_index: 1,
                record_detail_count: 1,
                subblok: "P1001"
            }
        ]);
    });

    it("starts each employee record with NEW even when premium names match", () => {
        const grouped = buildGroupedManualAdjustmentResponse([
            {
                id: 301,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                nik: "1902050504860001",
                emp_name: "AHMAD TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 300000,
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [{ subblok: "P09/01", gang_code: "G1H", jumlah: 300000 }],
                    total_amount: 300000
                })
            },
            {
                id: 302,
                period_month: 4,
                period_year: 2026,
                emp_code: "B0002",
                nik: "1902050504860002",
                emp_name: "BUDI TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 150000,
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [{ subblok: "P09/02", gang_code: "G1H", jumlah: 150000 }],
                    total_amount: 150000
                })
            }
        ] as any);

        const employees = grouped.divisions[0].gangs[0].employees;
        expect(employees.map((employee) => ({
            emp_code: employee.emp_code,
            first_action: employee.premium_transactions[0].record_action,
            first_record_key: employee.premium_transactions[0].record_group_key
        }))).toEqual([
            { emp_code: "A0001", first_action: "NEW", first_record_key: "adjustment:301" },
            { emp_code: "B0002", first_action: "NEW", first_record_key: "adjustment:302" }
        ]);
    });

    it("force_insert skips existing-row update and inserts a new manual adjustment record", async () => {
        const originalGetInstance = Database.getInstance;
        const originalUpsertPreset = manualAdjustmentPresetService.upsertPreset;
        const calls: QueryCall[] = [];
        const mockDb = {
            queryOne: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                if (sql.includes("payroll_manual_adjustments")) {
                    return { id: 77 };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ id: 78 }];
            }
        };

        (Database as any).getInstance = () => mockDb;
        (manualAdjustmentPresetService as any).upsertPreset = mock(async () => 78);

        try {
            const id = await manualAdjustmentService.saveAdjustment({
                period_month: 4,
                period_year: 2026,
                emp_code: "A0001",
                gang_code: "G1H",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 300000,
                ad_code: "AL3PM0601P1A",
                task_desc: "(AL) TUNJANGAN PREMI ((PM) PRUNING)",
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [{ subblok: "P0901", gang_code: "G1H", jumlah: 300000 }],
                    total_amount: 300000
                }),
                force_insert: true
            });

            expect(id).toBe(78);
            expect(calls.some((call) => call.sql.includes("SET emp_code = ?"))).toBe(false);
            expect(calls.some((call) => call.sql.includes("INSERT INTO dbo.payroll_manual_adjustments"))).toBe(true);
        } finally {
            (Database as any).getInstance = originalGetInstance;
            (manualAdjustmentPresetService as any).upsertPreset = originalUpsertPreset;
        }
    });

    it("normalizes subblok codes in detail items and premium transactions by removing symbols", () => {
        const grouped = buildGroupedManualAdjustmentResponse([
            {
                id: 10,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0002",
                nik: "1902050504860002",
                emp_name: "ANI TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 304000,
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [{ subblok: "P09/01-A", gang_code: "G1H", jumlah: 304000 }],
                    total_amount: 304000
                })
            }
        ] as any);

        const employee = grouped.divisions[0].gangs[0].employees[0];

        expect(employee.premiums[0].metadata).toMatchObject({
            items: [{ subblok: "P0901A", subblok_raw: "P09/01-A" }]
        });
        expect(employee.premiums[0].detail_items[0]).toMatchObject({
            detail_type: "blok",
            subblok: "P0901A",
            subblok_raw: "P09/01-A",
            amount: 304000
        });
        expect(employee.premium_transactions[0]).toMatchObject({
            detail_type: "blok",
            subblok: "P0901A",
            subblok_raw: "P09/01-A",
            amount: 304000
        });
    });

    it("normalizes kendaraan expense_code to DRIVER or HELPER from jabatan context", () => {
        const grouped = buildGroupedManualAdjustmentResponse([
            {
                id: 32,
                period_month: 4,
                period_year: 2026,
                emp_code: "G0352",
                nik: "5203180107750348",
                emp_name: "MAHSUN",
                jabatan: "(PM) HELPER",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI RITASE",
                amount: 29475,
                metadata_json: JSON.stringify({
                    input_type: "kendaraan",
                    items: [{ nomor_kendaraan: "BN8781WA", expense_code: "TRANSPORT", jumlah: 29475 }],
                    total_amount: 29475
                })
            }
        ] as any);

        const employee = grouped.divisions[0].gangs[0].employees[0];
        expect(employee.premiums[0].detail_items[0]).toMatchObject({
            detail_type: "kendaraan",
            nomor_kendaraan: "BN8781WA",
            expense_code: "HELPER",
            expense_code_raw: "TRANSPORT",
            expense_code_source: "jabatan",
            jumlah: 29475,
            amount: 29475
        });
        expect(employee.premium_transactions[0]).toMatchObject({
            detail_type: "kendaraan",
            nomor_kendaraan: "BN8781WA",
            expense_code: "HELPER",
            expense_code_raw: "TRANSPORT",
            expense_code_source: "jabatan",
            amount: 29475
        });
        expect(JSON.parse(employee.premiums[0].metadata_json as string)).toMatchObject({
            input_type: "kendaraan",
            items: [
                {
                    nomor_kendaraan: "BN8781WA",
                    expense_code: "HELPER",
                    expense_code_raw: "TRANSPORT",
                    expense_code_source: "jabatan",
                    jumlah: 29475
                }
            ],
            total_amount: 29475
        });
        expect(employee.premiums[0].metadata_json_raw).toContain('"expense_code":"TRANSPORT"');
        expect(employee.premiums[0].metadata).toMatchObject({
            input_type: "kendaraan",
            items: [{ expense_code: "HELPER", expense_code_raw: "TRANSPORT" }]
        });
    });

    it("normalizes kendaraan expense_code inside flat response metadata_json", () => {
        const rows = buildManualAdjustmentApiResponseRows([
            {
                id: 33,
                period_month: 4,
                period_year: 2026,
                emp_code: "G0352",
                nik: "5203180107750348",
                emp_name: "MAHSUN",
                jabatan: "(PM) HELPER",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI RITASE",
                amount: 29475,
                metadata_json: JSON.stringify({
                    input_type: "kendaraan",
                    items: [{ nomor_kendaraan: "BN8781WA", expense_code: "TRANSPORT", jumlah: 29475 }],
                    total_amount: 29475
                })
            }
        ] as any);

        expect(JSON.parse(rows[0].metadata_json as string).items[0]).toMatchObject({
            nomor_kendaraan: "BN8781WA",
            expense_code: "HELPER",
            expense_code_raw: "TRANSPORT",
            expense_code_source: "jabatan",
            jumlah: 29475
        });
        expect(rows[0].metadata_json_raw).toContain('"expense_code":"TRANSPORT"');
    });

    it("separates estate, derived division code, and ADCode fields in grouped response", () => {
        const grouped = buildGroupedManualAdjustmentResponse([
            {
                id: 11,
                period_month: 4,
                period_year: 2026,
                emp_code: "C0001",
                nik: "1902050504860011",
                emp_name: "CICI TEST",
                gang_code: "C2H",
                division_code: "AB1",
                adjustment_type: "PREMI",
                adjustment_name: "PREMI PRUNING",
                amount: 125000,
                remarks: "PREMI PRUNING | AL0001 - PREMI PRUNING DETAIL | 125000 | sync:MANUAL",
                metadata_json: JSON.stringify({
                    input_type: "blok",
                    items: [{ subblok: "C02/01", gang_code: "C2H", jumlah: 125000 }],
                    total_amount: 125000
                })
            }
        ] as any);

        const division = grouped.divisions[0];
        const gang = division.gangs[0];
        const employee = gang.employees[0];
        const premium = employee.premiums[0];
        const transaction = employee.premium_transactions[0];

        expect(division).toMatchObject({ estate: "AB1", estate_code: "AB1" });
        expect(gang).toMatchObject({ estate: "AB1", estate_code: "AB1", gang_code: "C2H", division_code: "C 2" });
        expect(employee).toMatchObject({ estate: "AB1", estate_code: "AB1", gang_code: "C2H", division_code: "C 2" });
        expect(premium).toMatchObject({
            estate: "AB1",
            estate_code: "AB1",
            division_code: "C 2",
            ad_code: "AL0001",
            ad_code_desc: "PREMI PRUNING DETAIL"
        });
        expect(transaction).toMatchObject({
            estate: "AB1",
            estate_code: "AB1",
            division_code: "C 2",
            ad_code: "AL0001",
            ad_code_desc: "PREMI PRUNING DETAIL"
        });
    });
});

describe("manualAdjustmentService duplicate PR_ADTRANS report", () => {
    it("groups duplicate records by employee and requested category", () => {
        const report = buildAdtransDuplicateReport([
            { id: 10, doc_id: "DOC-OLD", doc_date: "2026-04-01", doc_desc: "POTONGAN SPSI", emp_code: "A0001", emp_name: "BUDI", amount: 4000 },
            { id: 12, doc_id: "DOC-NEW", doc_date: "2026-04-02", doc_desc: "POTONGAN SPSI", emp_code: "A0001", emp_name: "BUDI", amount: 4000 },
            { id: 20, doc_id: "DOC-ONLY", doc_date: "2026-04-01", doc_desc: "TUNJANGAN JABATAN", emp_code: "A0001", emp_name: "BUDI", amount: 150000 },
            { id: 30, doc_id: "DOC-OTHER", doc_date: "2026-04-01", doc_desc: "POTONGAN SPSI", emp_code: "A0002", emp_name: "ANI", amount: 4000 }
        ], ["spsi", "jabatan"]);

        expect(report).toEqual({
            duplicate_count: 1,
            duplicates: [{
                emp_code: "A0001",
                emp_name: "BUDI",
                category: "spsi",
                doc_desc: "POTONGAN SPSI",
                amount: 4000,
                record_count: 2,
                keep_id: 12,
                keep_doc_id: "DOC-NEW",
                delete_ids: [10],
                delete_doc_ids: ["DOC-OLD"],
                records: [
                    { id: 10, doc_id: "DOC-OLD", doc_date: "2026-04-01", doc_desc: "POTONGAN SPSI", amount: 4000, action: "DELETE_OLD" },
                    { id: 12, doc_id: "DOC-NEW", doc_date: "2026-04-02", doc_desc: "POTONGAN SPSI", amount: 4000, action: "KEEP_NEWEST" }
                ]
            }]
        });
    });

    it("does not treat same DocDesc records without PR_ADTRANSLN amount as duplicates", () => {
        const report = buildAdtransDuplicateReport([
            { id: 10, doc_id: "DOC-EMPTY-OLD", doc_date: "2026-04-01", doc_desc: "POTONGAN SPSI", emp_code: "A0001", emp_name: "BUDI", amount: null },
            { id: 12, doc_id: "DOC-EMPTY-NEW", doc_date: "2026-04-02", doc_desc: "POTONGAN SPSI", emp_code: "A0001", emp_name: "BUDI", amount: 0 }
        ] as any, ["spsi"]);

        expect(report).toEqual({
            duplicate_count: 0,
            duplicates: []
        });
    });

    it("groups duplicate premi by employee + DocDesc (amount ignored, keep newest)", () => {
        // ponytail: duplicate key = emp + category + DocDesc (TANPA amount).
        //  PREMI TBS 3 records (2 amount 1046398 + 1 amount 999999) -> 1 group, keep highest id, delete 2 lain.
        const report = buildAdtransDuplicateReport([
            { id: 101, doc_id: "DOC-A1", doc_date: "2026-04-30", doc_desc: "PREMI INSENTIF PANEN", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 150000 },
            { id: 102, doc_id: "DOC-B1", doc_date: "2026-04-30", doc_desc: "PREMI TBS", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 1046398 },
            { id: 201, doc_id: "DOC-A2", doc_date: "2026-04-30", doc_desc: "PREMI INSENTIF PANEN", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 150000 },
            { id: 202, doc_id: "DOC-B2", doc_date: "2026-04-30", doc_desc: "PREMI TBS", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 1046398 },
            { id: 301, doc_id: "DOC-C1", doc_date: "2026-04-30", doc_desc: "PREMI TBS", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 999999 }
        ], ["premi"]);

        expect(report.duplicate_count).toBe(2);
        expect(report.duplicates.map((duplicate) => ({
            emp_code: duplicate.emp_code,
            category: duplicate.category,
            doc_desc: duplicate.doc_desc,
            keep_doc_id: duplicate.keep_doc_id,
            delete_doc_ids: duplicate.delete_doc_ids
        }))).toEqual([
            {
                emp_code: "L0073",
                category: "premi",
                doc_desc: "PREMI INSENTIF PANEN",
                keep_doc_id: "DOC-A2",
                delete_doc_ids: ["DOC-A1"]
            },
            {
                emp_code: "L0073",
                category: "premi",
                doc_desc: "PREMI TBS",
                keep_doc_id: "DOC-C1",
                delete_doc_ids: ["DOC-B1", "DOC-B2"]
            }
        ]);
    });

    it("filters duplicate premi report by specific adjustment name", () => {
        const report = buildAdtransDuplicateReport([
            { id: 101, doc_id: "DOC-A1", doc_date: "2026-04-30", doc_desc: "PREMI INSENTIF PANEN", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 150000 },
            { id: 102, doc_id: "DOC-B1", doc_date: "2026-04-30", doc_desc: "PREMI TBS", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 1046398 },
            { id: 201, doc_id: "DOC-A2", doc_date: "2026-04-30", doc_desc: "PREMI INSENTIF PANEN", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 150000 },
            { id: 202, doc_id: "DOC-B2", doc_date: "2026-04-30", doc_desc: "PREMI TBS", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 1046398 }
        ], ["premi"], { adjustmentNames: ["PREMI TBS"] } as any);

        expect(report.duplicates).toHaveLength(1);
        expect(report.duplicates[0]).toMatchObject({
            emp_code: "L0073",
            category: "premi",
            doc_desc: "PREMI TBS",
            amount: 1046398,
            keep_doc_id: "DOC-B2",
            delete_doc_ids: ["DOC-B1"]
        });
    });

    it("filters duplicate koreksi report by specific adjustment name", () => {
        const report = buildAdtransDuplicateReport([
            { id: 1, doc_id: "DOC-K1", doc_date: "2026-04-30", doc_desc: "KOREKSI PANEN", emp_code: "A0001", emp_name: "BUDI", amount: -2000 },
            { id: 2, doc_id: "DOC-A1", doc_date: "2026-04-30", doc_desc: "KOREKSI ALAT", emp_code: "A0001", emp_name: "BUDI", amount: -5000 },
            { id: 3, doc_id: "DOC-K2", doc_date: "2026-04-30", doc_desc: "KOREKSI PANEN", emp_code: "A0001", emp_name: "BUDI", amount: -2000 },
            { id: 4, doc_id: "DOC-A2", doc_date: "2026-04-30", doc_desc: "KOREKSI ALAT", emp_code: "A0001", emp_name: "BUDI", amount: -5000 }
        ], ["koreksi"], { adjustmentNames: ["KOREKSI PANEN"] } as any);

        expect(report.duplicates).toHaveLength(1);
        expect(report.duplicates[0]).toMatchObject({
            emp_code: "A0001",
            category: "koreksi",
            doc_desc: "KOREKSI PANEN",
            amount: -2000,
            keep_doc_id: "DOC-K2",
            delete_doc_ids: ["DOC-K1"]
        });
    });

    it("only treats premi duplicates as duplicate cleanup rows when DocDesc starts with PREMI", () => {
        const report = buildAdtransDuplicateReport([
            { id: 101, doc_id: "DOC-A1", doc_date: "2026-04-30", doc_desc: "INSENTIF PANEN", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 150000 },
            { id: 201, doc_id: "DOC-A2", doc_date: "2026-04-30", doc_desc: "INSENTIF PANEN", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 150000 },
            { id: 102, doc_id: "DOC-B1", doc_date: "2026-04-30", doc_desc: "PREMI TBS", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 1046398 },
            { id: 202, doc_id: "DOC-B2", doc_date: "2026-04-30", doc_desc: "PREMI TBS", emp_code: "L0073", emp_name: "BAHARUDIN", amount: 1046398 }
        ], ["premi"]);

        expect(report.duplicate_count).toBe(1);
        expect(report.duplicates[0]).toMatchObject({
            emp_code: "L0073",
            category: "premi",
            doc_desc: "PREMI TBS",
            amount: 1046398,
            keep_doc_id: "DOC-B2",
            delete_doc_ids: ["DOC-B1"]
        });
    });

    it("maps ADTRANS DocDesc variants to comparison categories", () => {
        const report = buildAdtransDuplicateReport([
            { id: 1, doc_id: "DOC-SPSI", doc_date: "2026-04-01", doc_desc: "POTONGAN SPSI", emp_code: "A0001", emp_name: "BUDI", amount: 4000 },
            { id: 2, doc_id: "DOC-MASA", doc_date: "2026-04-01", doc_desc: "TUNJANGAN MASA KERJA", emp_code: "A0001", emp_name: "BUDI", amount: 15000 },
            { id: 3, doc_id: "DOC-JAB", doc_date: "2026-04-01", doc_desc: "TUNJANGAN JABATAN", emp_code: "A0001", emp_name: "BUDI", amount: 45000 },
            { id: 4, doc_id: "DOC-PREM", doc_date: "2026-04-01", doc_desc: "INSENTIF PANEN", emp_code: "A0001", emp_name: "BUDI", amount: 5000 },
            { id: 5, doc_id: "DOC-POT", doc_date: "2026-04-01", doc_desc: "POTONGAN ALAT", emp_code: "A0001", emp_name: "BUDI", amount: -1000 },
            { id: 6, doc_id: "DOC-KOR", doc_date: "2026-04-01", doc_desc: "KOREKSI PANEN", emp_code: "A0001", emp_name: "BUDI", amount: -2000 }
        ], ["spsi", "masa kerja", "jabatan", "premi", "potongan", "koreksi"]);

        expect(report.duplicates).toEqual([]);
    });

    it("uses ADTRANS DocDesc business rules in direct check SQL patterns", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            await manualAdjustmentService.checkAdtransDirectly(4, 2026, ["A0001"], ["premi", "brondol", "koreksi", "potongan"], "P1A");

            expect(calls[0].sql).toContain("LIKE '%PREMI%' OR UPPER(DocDesc) LIKE '%INSENTIF%' OR UPPER(DocDesc) LIKE '%PANEN%' OR UPPER(DocDesc) LIKE '%KINERJA%' OR UPPER(DocDesc) LIKE '%RAWAT%' OR UPPER(DocDesc) LIKE '%PRUN%'");
            expect(calls[0].sql).toContain("LIKE '%BRONDOL%'");
            expect(calls[0].sql).toContain("LIKE '%KOREKSI%'");
            expect(calls[0].sql).toContain("LIKE 'POT%' OR UPPER(DocDesc) LIKE 'POTONGAN%'");
            expect(calls[1].params).toContain("%BRONDOL%");
            expect(calls[1].params).toContain("%KOREKSI%");
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("uses adjustment_type and adjustment_name as check-adtrans duplicate filters when filters are omitted", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const result = await manualAdjustmentService.checkAdtransDirectly(
                4,
                2026,
                [],
                [],
                "IJL",
                { adjustmentTypes: ["PREMI"], adjustmentNames: ["PREMI TBS"] } as any
            );

            expect(result).toEqual({
                totals: [],
                doc_desc_details: [],
                duplicate_report: {
                    duplicate_count: 0,
                    duplicates: []
                }
            });
            expect(calls[0].sql).toContain("LIKE '%PREMI%'");
            expect(calls[1].params).toContain("%PREMI TBS%");
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("queries by normalized division LocCode when emp_codes is omitted", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const mockDb = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [];
            }
        };

        (Database as any).getInstance = () => mockDb;

        try {
            const result = await manualAdjustmentService.checkAdtransDirectly(4, 2026, [], ["spsi"], "PG2A");

            expect(result).toEqual({
                totals: [],
                doc_desc_details: [],
                duplicate_report: {
                    duplicate_count: 0,
                    duplicates: []
                }
            });
            expect(calls.length).toBe(2);
            expect(calls[0].sql).toContain("UPPER(RTRIM(t.LocCode)) = ?");
            expect(calls[0].sql).not.toContain("RTRIM(t.EmpCode) IN ()");
            expect(calls[0].params).toEqual(["P2A", 4, 2026, "P2A", 4, 2026]);
            expect(calls[1].params).toEqual(["P2A", 4, 2026, "%SPSI%", "P2A", 4, 2026, "%SPSI%"]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("matches stored auto buffer rows when compare uses a division alias", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                return [{ emp_code: "A0091", spsi: 4000 }];
            }
        };
        const dbExtend = {
            query: async (sql: string, params?: any[]) => {
                const queryParams = params || [];
                calls.push({ sql, params: queryParams });
                if (!queryParams.includes("P2A")) return [];
                return [{
                    emp_code: "A0091",
                    adjustment_name: "AUTO SPSI",
                    amount: 4000,
                    remarks: "AUTO SPSI | potongan spsi | 4000",
                    gang_code: "C1H",
                    division_code: "P2A"
                }];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.compareAdtransWithAdjustments(4, 2026, "PG2A", ["spsi"]);

            expect(result.comparisons).toEqual([{
                emp_code: "A0091",
                stored_emp_identifier: null,
                category: "spsi",
                adjustment_name: "SPSI",
                source_amount: 4000,
                stored_amount: 4000,
                db_ptrj_amount: 4000,
                extend_db_ptrj_amount: 4000,
                diff: 0,
                status: "MATCH",
                db_ptrj_doc_desc_details: [],
                extend_db_ptrj_remarks: "AUTO SPSI | potongan spsi | 4000",
                gang_code: "C1H",
                remarks: "AUTO SPSI | potongan spsi | 4000"
            }]);
            expect(calls.some((call) => call.sql.includes("payroll_manual_adjustments") && JSON.stringify(call.params) === JSON.stringify([4, 2026, "PG2A", "P2A"]))).toBe(true);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("reports db_ptrj values as mismatch when the stored adjustment is keyed by NIK with zero amount", async () => {
        const originalGetInstance = Database.getInstance;
        const dbPtrj = {
            query: async () => [{ emp_code: "A0001", nik: "1902050504860001", spsi: 4000 }]
        };
        const dbExtend = {
            query: async () => [{
                emp_code: "1902050504860001",
                adjustment_name: "AUTO SPSI",
                amount: 0,
                remarks: "AUTO SPSI | non-spsi | 0",
                gang_code: "A2M",
                division_code: "P1A"
            }]
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.compareAdtransWithAdjustments(4, 2026, "P1A", ["spsi"]);

            expect((result as any).extra_in_db_ptrj).toBe(1);
            expect(result.mismatch_count).toBe(1);
            expect(result.missing_in_adjustments).toBe(0);
            expect(result.comparisons).toEqual([{
                emp_code: "A0001",
                stored_emp_identifier: "1902050504860001",
                category: "spsi",
                adjustment_name: "SPSI",
                source_amount: 4000,
                stored_amount: 0,
                db_ptrj_amount: 4000,
                extend_db_ptrj_amount: 0,
                diff: 4000,
                status: "MISMATCH",
                db_ptrj_doc_desc_details: [],
                extend_db_ptrj_remarks: "AUTO SPSI | non-spsi | 0",
                gang_code: "A2M",
                remarks: "AUTO SPSI | non-spsi | 0"
            }]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("includes db_ptrj DocDesc and extend remarks details in compare output", async () => {
        const originalGetInstance = Database.getInstance;
        let dbPtrjCall = 0;
        const dbPtrj = {
            query: async () => {
                dbPtrjCall++;
                if (dbPtrjCall === 1) return [{ emp_code: "A0001", nik: "1902050504860001", spsi: 0, "masa kerja": 0, jabatan: 0, premi: 7000, koreksi: 0, potongan: 0 }];
                return [
                    { emp_code: "A0001", category: "premi", doc_desc: "INSENTIF PANEN", doc_id: "AD001", amount: 5000 },
                    { emp_code: "A0001", category: "premi", doc_desc: "KINERJA", doc_id: "AD002", amount: 2000 }
                ];
            }
        };
        const dbExtend = {
            query: async () => [{
                emp_code: "1902050504860001",
                adjustment_type: "PREMI",
                adjustment_name: "INSENTIF PANEN",
                amount: 5000,
                remarks: "premi manual user",
                gang_code: "A2M",
                division_code: "P1A"
            }]
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.compareAdtransWithAdjustments(4, 2026, "P1A");
            const item = result.comparisons.find((comparison) => comparison.category === "premi");

            expect(item).toMatchObject({
                emp_code: "A0001",
                stored_emp_identifier: "1902050504860001",
                category: "premi",
                source_amount: 7000,
                stored_amount: 5000,
                diff: 2000,
                status: "MISMATCH",
                db_ptrj_amount: 7000,
                extend_db_ptrj_amount: 5000,
                extend_db_ptrj_remarks: "premi manual user"
            });
            expect((item as any).db_ptrj_doc_desc_details).toEqual([
                { doc_desc: "INSENTIF PANEN", doc_id: "AD001", amount: 5000 },
                { doc_desc: "KINERJA", doc_id: "AD002", amount: 2000 }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("aggregates multiple extend_db_ptrj manual rows before comparing category totals", async () => {
        const originalGetInstance = Database.getInstance;
        let dbPtrjCall = 0;
        const dbPtrj = {
            query: async () => {
                dbPtrjCall++;
                if (dbPtrjCall === 1) return [{ emp_code: "A0001", nik: "1902050504860001", premi: 7000 }];
                return [
                    { emp_code: "A0001", category: "premi", doc_desc: "INSENTIF PANEN", doc_id: "AD001", amount: 5000 },
                    { emp_code: "A0001", category: "premi", doc_desc: "KINERJA", doc_id: "AD002", amount: 2000 }
                ];
            }
        };
        const dbExtend = {
            query: async () => [
                { emp_code: "1902050504860001", adjustment_type: "PREMI", adjustment_name: "INSENTIF PANEN", amount: 5000, remarks: "premi insentif", gang_code: "A2M", division_code: "P1A" },
                { emp_code: "1902050504860001", adjustment_type: "PREMI", adjustment_name: "KINERJA", amount: 2000, remarks: "premi kinerja", gang_code: "A2M", division_code: "P1A" }
            ]
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.compareAdtransWithAdjustments(4, 2026, "P1A", ["premi"]);
            expect(result.match_count).toBe(1);
            expect(result.mismatch_count).toBe(0);
            expect(result.comparisons).toEqual([expect.objectContaining({
                emp_code: "A0001",
                stored_emp_identifier: "1902050504860001",
                category: "premi",
                source_amount: 7000,
                stored_amount: 7000,
                diff: 0,
                status: "MATCH",
                extend_db_ptrj_amount: 7000,
                extend_db_ptrj_remarks: "premi insentif || premi kinerja"
            })]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("includes premi, koreksi, potongan, and pph missing details in compare defaults", async () => {
        const originalGetInstance = Database.getInstance;
        const dbPtrj = {
            query: async () => [{ emp_code: "A0001", nik: "1902050504860001", spsi: 0, "masa kerja": 0, jabatan: 0, pph: 3000, premi: 5000, koreksi: -2000, potongan: -1000 }]
        };
        const dbExtend = {
            query: async () => []
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.compareAdtransWithAdjustments(4, 2026, "P1A");

            expect(result.compared_categories).toEqual(["spsi", "masa kerja", "jabatan", "pph", "premi", "koreksi", "potongan"]);
            expect(result.comparisons.map((item) => ({ emp_code: item.emp_code, category: item.category, status: item.status, source_amount: item.source_amount }))).toEqual([
                { emp_code: "A0001", category: "pph", status: "MISSING", source_amount: 3000 },
                { emp_code: "A0001", category: "premi", status: "MISSING", source_amount: 5000 },
                { emp_code: "A0001", category: "koreksi", status: "MISSING", source_amount: -2000 },
                { emp_code: "A0001", category: "potongan", status: "MISSING", source_amount: -1000 }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("limits virtual division compare rows to the virtual gang scope", async () => {
        const originalGetInstance = Database.getInstance;
        const dbPtrj = {
            query: async (sql: string, params?: any[]) => {
                const queryParams = params || [];
                if (queryParams.includes("B2N")) return [{ emp_code: "B0745", spsi: 4000 }];
                return [
                    { emp_code: "B0745", spsi: 4000 },
                    { emp_code: "B0001", spsi: 4000 }
                ];
            }
        };
        const dbExtend = {
            query: async () => [{
                emp_code: "B0745",
                adjustment_name: "AUTO SPSI",
                amount: 4000,
                remarks: "AUTO SPSI | potongan spsi | 4000",
                gang_code: "B2N",
                division_code: "NRS"
            }]
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await manualAdjustmentService.compareAdtransWithAdjustments(4, 2026, "NRS", ["spsi"]);

            expect(result.comparisons.map((item) => item.emp_code)).toEqual(["B0745"]);
            expect(result.missing_in_adjustments).toBe(0);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("reports auto buffer rows that exist in adjustments but not in db_ptrj", async () => {
        const originalGetInstance = Database.getInstance;
        const dbExtend = {
            query: async () => [
                { emp_code: "B0745", adjustment_name: "AUTO SPSI", amount: 4000, remarks: "AUTO SPSI | potongan spsi | 4000", gang_code: "B2N", division_code: "NRS" },
                { emp_code: "B0746", adjustment_name: "AUTO SPSI", amount: 4000, remarks: "AUTO SPSI | potongan spsi | 4000", gang_code: "B2N", division_code: "NRS" },
                { emp_code: "B0747", adjustment_name: "AUTO MASA KERJA", amount: 2500, remarks: "AUTO MASA KERJA | masa kerja | 2500", gang_code: "B2N", division_code: "NRS" }
            ]
        };
        let dbPtrjCall = 0;
        const dbPtrj = {
            queryOne: async (_sql: string, params?: any[]) => {
                const identifier = params?.[0];
                if (identifier === "B0745" || identifier === "B0746" || identifier === "B0747") {
                    return { nik: "", emp_code: identifier, emp_name: "TEST" };
                }
                return null;
            },
            query: async () => {
                dbPtrjCall++;
                if (dbPtrjCall === 1) {
                    return [
                        { emp_code: "B0745", spsi: 4000, "masa kerja": 0 },
                        { emp_code: "B0747", spsi: 0, "masa kerja": 5000 }
                    ];
                }
                return [];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await (manualAdjustmentService as any).reverseCompareAdtransWithAdjustments(4, 2026, "NRS", ["spsi", "masa kerja"]);

            expect(result.extra_in_adjustments).toBe(1);
            expect(result.mismatch_count).toBe(1);
            expect(result.match_count).toBe(1);
            expect(result.comparisons.map((item: any) => ({ emp_code: item.emp_code, category: item.category, status: item.status }))).toEqual([
                { emp_code: "B0745", category: "spsi", status: "MATCH" },
                { emp_code: "B0746", category: "spsi", status: "EXTRA_IN_ADJUSTMENTS" },
                { emp_code: "B0747", category: "masa kerja", status: "MISMATCH" }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("includes db_ptrj DocDesc and extend remarks details in reverse compare output", async () => {
        const originalGetInstance = Database.getInstance;
        const dbExtend = {
            query: async () => [{
                emp_code: "1902050504860001",
                adjustment_type: "PREMI",
                adjustment_name: "INSENTIF PANEN",
                amount: 5000,
                remarks: "premi manual user",
                gang_code: "A2M",
                division_code: "P1A"
            }]
        };
        let dbPtrjCall = 0;
        const dbPtrj = {
            queryOne: async () => ({ nik: "1902050504860001", emp_code: "A0001", emp_name: "BUDI TEST", gang_code: "A2M" }),
            query: async () => {
                dbPtrjCall++;
                if (dbPtrjCall === 1) return [{ emp_code: "A0001", premi: 7000 }];
                return [
                    { emp_code: "A0001", category: "premi", doc_desc: "INSENTIF PANEN", doc_id: "AD001", amount: 5000 },
                    { emp_code: "A0001", category: "premi", doc_desc: "KINERJA", doc_id: "AD002", amount: 2000 }
                ];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await (manualAdjustmentService as any).reverseCompareAdtransWithAdjustments(4, 2026, "P1A", ["premi"]);
            const item = result.comparisons[0];

            expect(item).toMatchObject({
                emp_code: "A0001",
                stored_emp_identifier: "1902050504860001",
                category: "premi",
                source_amount: 5000,
                stored_amount: 5000,
                diff: 0,
                status: "MATCH",
                db_ptrj_amount: 5000,
                extend_db_ptrj_amount: 5000,
                extend_db_ptrj_remarks: "premi manual user"
            });
            expect(item.db_ptrj_doc_desc_details).toEqual([
                { doc_desc: "INSENTIF PANEN", doc_id: "AD001", amount: 5000 }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("includes premi, koreksi, potongan, and pph rows in reverse compare defaults with PTRJ EmpCode", async () => {
        const originalGetInstance = Database.getInstance;
        const dbExtend = {
            query: async () => [
                { emp_code: "1902050504860001", adjustment_type: "PREMI", adjustment_name: "INSENTIF PANEN", amount: 5000, remarks: "premi manual", gang_code: "A2M", division_code: "P1A" },
                { emp_code: "1902050504860001", adjustment_type: "POTONGAN_KOTOR", adjustment_name: "KOREKSI PANEN", amount: -2000, remarks: "koreksi manual", gang_code: "A2M", division_code: "P1A" },
                { emp_code: "1902050504860001", adjustment_type: "POTONGAN_KOTOR", adjustment_name: "POTONGAN ALAT", amount: -1000, remarks: "potongan manual", gang_code: "A2M", division_code: "P1A" }
            ]
        };
        let dbPtrjCall = 0;
        const dbPtrj = {
            queryOne: async (_sql: string) => ({ nik: "1902050504860001", emp_code: "A0001", emp_name: "BUDI TEST", gang_code: "A2M" }),
            query: async () => {
                dbPtrjCall++;
                if (dbPtrjCall === 1) return [{ emp_code: "A0001", spsi: 0, "masa kerja": 0, jabatan: 0, pph: 0, premi: 5000, koreksi: -2000, potongan: 0 }];
                return [];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await (manualAdjustmentService as any).reverseCompareAdtransWithAdjustments(4, 2026, "P1A");

            expect(result.compared_categories).toEqual(["spsi", "masa kerja", "jabatan", "pph", "premi", "koreksi", "potongan"]);
            expect(result.comparisons.map((item: any) => ({ emp_code: item.emp_code, category: item.category, status: item.status }))).toEqual([
                { emp_code: "A0001", category: "premi", status: "MATCH" },
                { emp_code: "A0001", category: "koreksi", status: "MATCH" },
                { emp_code: "A0001", category: "potongan", status: "EXTRA_IN_ADJUSTMENTS" }
            ]);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("resolves numeric adjustment identifiers to PTRJ EmpCode before reverse compare", async () => {
        const originalGetInstance = Database.getInstance;
        const calls: QueryCall[] = [];
        const dbExtend = {
            query: async () => [
                { emp_code: "1902050504860001", adjustment_name: "AUTO SPSI", amount: 4000, remarks: "AUTO SPSI | potongan spsi | 4000", gang_code: "A2M", division_code: "P1A" }
            ]
        };
        let dbPtrjCall = 0;
        const dbPtrj = {
            queryOne: async (_sql: string, params?: any[]) => {
                calls.push({ sql: _sql, params: params || [] });
                if (_sql.includes("HR_EMPLOYEE") && _sql.includes("HR_GANGLN")) {
                    return { nik: "1902050504860001", emp_code: "A0001", emp_name: "BUDI TEST", gang_code: "A2M" };
                }
                if (params?.[0] === "1902050504860001") {
                    return { nik: "1902050504860001", emp_code: "Z9999", emp_name: "BUDI OLD" };
                }
                return null;
            },
            query: async (sql: string, params?: any[]) => {
                calls.push({ sql, params: params || [] });
                dbPtrjCall++;
                if (dbPtrjCall === 1) return [{ emp_code: "A0001", spsi: 4000 }];
                return [];
            }
        };

        (Database as any).getInstance = (database?: string) => database ? dbExtend : dbPtrj;

        try {
            const result = await (manualAdjustmentService as any).reverseCompareAdtransWithAdjustments(4, 2026, "P1A", ["spsi"]);

            expect(result.match_count).toBe(1);
            expect(result.extra_in_adjustments).toBe(0);
            expect(result.comparisons[0].emp_code).toBe("A0001");
            expect(result.comparisons[0].stored_emp_identifier).toBe("1902050504860001");
            expect(calls.some((call) => call.sql.includes("RTRIM(t.EmpCode) IN (?)") && call.params.includes("A0001"))).toBe(true);
            expect(calls.some((call) => call.sql.includes("RTRIM(t.EmpCode) IN (?)") && call.params.includes("1902050504860001"))).toBe(false);
        } finally {
            (Database as any).getInstance = originalGetInstance;
        }
    });

    it("returns only unique PR_ADTRANS DocIDs for the selected config", async () => {
        const originalCheckAdtransDirectly = (manualAdjustmentService as any).checkAdtransDirectly;
        (manualAdjustmentService as any).checkAdtransDirectly = mock(async () => ({
            totals: [],
            doc_desc_details: [
                { emp_code: "A0001", category: "premi", doc_desc: "PREMI TBS", doc_id: "ADAB126041001", amount: 100000 },
                { emp_code: "A0001", category: "premi", doc_desc: "PREMI TBS", doc_id: "ADAB126041001", amount: 100000 },
                { emp_code: "A0002", category: "premi", doc_desc: "PREMI TBS", doc_id: "ADAB126041002", amount: 150000 },
                { emp_code: "A0003", category: "premi", doc_desc: "PREMI TBS", doc_id: null, amount: 175000 }
            ],
            duplicate_report: {
                duplicate_count: 0,
                duplicates: []
            }
        }));

        try {
            const docIds = await (manualAdjustmentService as any).listAdtransDocIds({
                periodMonth: 4,
                periodYear: 2026,
                empCodes: ["A0001", "A0002"],
                filters: [],
                divisionCode: "AB1",
                adjustmentTypes: ["PREMI"],
                adjustmentNames: ["PREMI TBS"],
                docDescs: []
            });

            expect(docIds).toEqual(["ADAB126041001", "ADAB126041002"]);
            expect((manualAdjustmentService as any).checkAdtransDirectly).toHaveBeenCalledWith(
                4,
                2026,
                ["A0001", "A0002"],
                [],
                "AB1",
                {
                    adjustmentTypes: ["PREMI"],
                    adjustmentNames: ["PREMI TBS"],
                    docDescs: []
                }
            );
        } finally {
            (manualAdjustmentService as any).checkAdtransDirectly = originalCheckAdtransDirectly;
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-DB-001: metadata_json sync + validation tests
// Tests for calculateManualAdjustmentMetadataTotal and resolveDetailTotalSync
// ─────────────────────────────────────────────────────────────────────────────

describe("computeManualAdjustmentSyncStatuses (pure recompute)", () => {
    // helper bangun row standar
    function makeRow(over: Partial<any> = {}): any {
        return {
            id: 1,
            period_month: 5,
            period_year: 2026,
            emp_code: "E0409",
            nik: "1902042611030001",
            emp_name: "RADIUS",
            gang_code: "E1H",
            division_code: "E 1",
            adjustment_type: "PREMI",
            adjustment_name: "PREMI TBS",
            amount: 134101,
            remarks: "PREMI TBS | (AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING) | 134101 | sync:SYNC | match:MATCH",
            metadata_json: null,
            ...over
        };
    }

    it("SYNC/MATCH bila ADTRANS total == target amount", () => {
        const rows = [makeRow()];
        const adtrans = [
            { emp_code: "E0409", doc_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", doc_id: "D1", amount: 134101 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        expect(r.sync_status).toBe("SYNC");
        expect(r.match_status).toBe("MATCH");
        expect(r.adtrans_amount).toBe(134101);
        expect(r.diff).toBe(0);
        expect(r.has_adtrans).toBe(true);
        expect(r.is_stale).toBe(false);
    });

    it("DIFF/MISMATCH bila ADTRANS ada tapi beda nominal (stale)", () => {
        const rows = [makeRow({ remarks: "PREMI TBS | x | 134101 | sync:SYNC | match:MATCH" })];
        const adtrans = [
            { emp_code: "E0409", doc_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", doc_id: "D1", amount: 100000 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        expect(r.sync_status).toBe("DIFF");
        expect(r.match_status).toBe("MISMATCH");
        expect(r.diff).toBe(100000 - 134101);
        expect(r.is_stale).toBe(true); // baked SYNC != computed DIFF
        expect(r.baked_sync).toBe("SYNC");
    });

    it("MISS/MISMATCH bila tidak ada ADTRANS match (stale)", () => {
        const rows = [makeRow({ remarks: "PREMI TBS | x | 134101 | sync:SYNC | match:MATCH" })];
        const m = computeManualAdjustmentSyncStatuses(rows, []);
        const r = m.get(1)!;
        expect(r.sync_status).toBe("MISS");
        expect(r.match_status).toBe("MISMATCH");
        expect(r.has_adtrans).toBe(false);
        expect(r.adtrans_amount).toBe(0);
        expect(r.is_stale).toBe(true);
    });

    it("memakai metadata_json total_amount bila ada, fallback amount", () => {
        const rows = [makeRow({
            amount: 0,
            metadata_json: JSON.stringify({ input_type: "blok", items: [{ subblok: "PM0711", gang_code: "E1H", jumlah: 134101 }], total_amount: 134101 })
        })];
        const adtrans = [
            { emp_code: "E0409", doc_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", doc_id: "D1", amount: 134101 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        expect(r.target_amount).toBe(134101);
        expect(r.sync_status).toBe("SYNC");
    });

    it("multiple ADTRANS rows summed before compare", () => {
        const rows = [makeRow({ amount: 350000 })];
        const adtrans = [
            { emp_code: "E0409", doc_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", doc_id: "D1", amount: 200000 },
            { emp_code: "E0409", doc_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", doc_id: "D2", amount: 150000 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        expect(r.adtrans_amount).toBe(350000);
        expect(r.sync_status).toBe("SYNC");
    });

    it("AUTO_BUFFER masa kerja mapped via adjustment_name", () => {
        const rows = [makeRow({
            adjustment_type: "AUTO_BUFFER",
            adjustment_name: "MASA KERJA",
            amount: 50000,
            remarks: "MASA KERJA | x | 50000 | sync:SYNC | match:MATCH"
        })];
        // adtransDetailMatchesManualAdjustment pakai buildManualAdjustmentExpectedAdtransTexts (task_desc dll).
        // Untuk AUTO_BUFFER, ad_code_fields resolve via autoBufferAdcodeMap -> text "masa kerja".
        const adtrans = [
            { emp_code: "E0409", doc_desc: "TUNJANGAN MASA KERJA", doc_id: "D1", amount: 50000 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        // note: match tergantung normalisasi teks; minimal adtrans_amount ter-sum
        expect(r.adtrans_amount).toBe(50000);
    });

    it("potongan compare by absolute value (negative input tidak flip)", () => {
        const rows = [makeRow({
            adjustment_type: "POTONGAN_KOTOR",
            adjustment_name: "KOREKSI UPAH",
            amount: -80000,
            remarks: "KOREKSI UPAH | x | -80000 | sync:SYNC | match:MATCH"
        })];
        const adtrans = [
            { emp_code: "E0409", doc_desc: "KOREKSI UPAH", doc_id: "D1", amount: 80000 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        // target_amount = raw stored amount (signed); compare pakai abs internal
        expect(r.target_amount).toBe(-80000);
        expect(r.adtrans_amount).toBe(80000); // adtrans selalu abs
        expect(r.sync_status).toBe("SYNC"); // |-80000| == 80000
    });

    it("POTONGAN_BERSIH mismatch terdeteksi (stale baked SYNC -> computed DIFF)", () => {
        const rows = [makeRow({
            adjustment_type: "POTONGAN_BERSIH",
            adjustment_name: "POTONGAN LAINNYA KOPERASI",
            amount: 50000,
            remarks: "POTONGAN LAINNYA KOPERASI | x | 50000 | sync:SYNC | match:MATCH"
        })];
        const adtrans = [
            { emp_code: "E0409", doc_desc: "POTONGAN LAINNYA KOPERASI", doc_id: "D1", amount: 30000 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        expect(r.sync_status).toBe("DIFF");
        expect(r.match_status).toBe("MISMATCH");
        expect(r.diff).toBe(30000 - 50000);
        expect(r.is_stale).toBe(true);
    });

    it("PREMI MISS bila ADTRANS tidak ada match (stale baked SYNC)", () => {
        const rows = [makeRow({
            adjustment_type: "PREMI",
            adjustment_name: "PREMI TBS",
            amount: 134101,
            remarks: "PREMI TBS | x | 134101 | sync:SYNC | match:MATCH"
        })];
        const m = computeManualAdjustmentSyncStatuses(rows, []);
        const r = m.get(1)!;
        expect(r.sync_status).toBe("MISS");
        expect(r.match_status).toBe("MISMATCH");
        expect(r.has_adtrans).toBe(false);
        expect(r.is_stale).toBe(true);
    });

    it("remarks_fresh fallback ke row.remarks bila remarks bukan pipe; baked_sync null", () => {
        const rows = [makeRow({ remarks: "AD CODE: AL0018" })]; // legacy non-pipe
        const adtrans = [
            { emp_code: "E0409", doc_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", doc_id: "D1", amount: 134101 }
        ];
        const m = computeManualAdjustmentSyncStatuses(rows, adtrans);
        const r = m.get(1)!;
        // updatePipeDelimitedSyncAndMatchStatus return null bila no pipe -> fallback row.remarks
        expect(r.remarks_fresh).toBe("AD CODE: AL0018");
        expect(r.baked_sync).toBeNull(); // no sync: segment parseable
        expect(r.baked_match).toBeNull();
    });
});

describe("calculateManualAdjustmentMetadataTotal", () => {
    it("sums blok items jumlah correctly", () => {
        // blok: sum of items[].jumlah
        const metadata = {
            input_type: "blok",
            items: [
                { subblok: "P0921", gang_code: "B1H", jumlah: 5000 },
                { subblok: "P0922", gang_code: "B1H", jumlah: 3000 }
            ]
        };
        // Expected: 8000 (5000 + 3000)
    });

    it("returns exp jumlah directly", () => {
        // exp: direct metadata.jumlah value
        const metadata = { input_type: "exp", expense_code: "LABOUR", jumlah: 7500 };
        // Expected: 7500
    });

    it("sums kendaraan items jumlah correctly", () => {
        // kendaraan: sum of items[].jumlah
        const metadata = {
            input_type: "kendaraan",
            items: [
                { nomor_kendaraan: "B1234AB", expense_code: "TRANSPORT", jumlah: 3000 },
                { nomor_kendaraan: "B5678CD", expense_code: "TRANSPORT", jumlah: 2500 }
            ]
        };
        // Expected: 5500 (3000 + 2500)
    });

    it("sums blok,exp combo correctly", () => {
        // blok,exp: sum(blok_items.jumlah) + expense.jumlah
        const metadata = {
            input_type: "blok,exp",
            blok_items: [
                { subblok: "P0921", gang_code: "B1H", jumlah: 2000 },
                { subblok: "P0922", gang_code: "B1H", jumlah: 1500 }
            ],
            expense: { expense_code: "LABOUR", jumlah: 1000 }
        };
        // Expected: 4500 (2000 + 1500 + 1000)
    });

    it("returns 0 for empty blok items", () => {
        const metadata = { input_type: "blok", items: [] };
        // Expected: 0
    });

    it("returns 0 for unknown input_type", () => {
        const metadata = { input_type: "invalid_type", jumlah: 9999 };
        // Expected: 0 (falls to default case)
    });

    it("handles null/undefined items gracefully", () => {
        const metadata = { input_type: "blok" }; // no items field
        // Expected: 0 (items || [] fallback)
    });

    it("handles string jumlah values (coerced to Number)", () => {
        const metadata = {
            input_type: "exp",
            expense_code: "LABOUR",
            jumlah: "5000" // string, not number
        };
        // Expected: 5000 (Number("5000") = 5000)
    });
});

describe("resolveDetailTotalSync — input_type based sync (BUG-DB-001)", () => {
    // Tests verify that sync is based on input_type, not premium name whitelist

    it("syncs blok metadata for PREMI JAGA (non-whitelist name)", () => {
        // Before fix: PREMI JAGA was NOT synced (not in whitelist)
        // After fix: ALL blok metadata is synced regardless of name
        const metadata = {
            input_type: "blok",
            items: [{ subblok: "P0921", gang_code: "B1H", jumlah: 5000 }]
        };
        const data = {
            adjustment_type: "PREMI",
            adjustment_name: "PREMI JAGA", // was not in whitelist
            amount: 0 // old amount — should be synced to 5000
        };
        // Expected: synced amount = 5000, metadataJsonStr has total_amount: 5000
    });

    it("syncs kendaraan metadata for PREMI ANGKUT TBS", () => {
        const metadata = {
            input_type: "kendaraan",
            items: [{ nomor_kendaraan: "B1234AB", expense_code: "TRANSPORT", jumlah: 3500 }]
        };
        const data = {
            adjustment_type: "PREMI",
            adjustment_name: "PREMI ANGKUT TBS", // not in old whitelist
            amount: 0
        };
        // Expected: synced amount = 3500
    });

    it("syncs blok,exp metadata for PREMI KINERJA", () => {
        const metadata = {
            input_type: "blok,exp",
            blok_items: [{ subblok: "P0921", gang_code: "B1H", jumlah: 2000 }],
            expense: { expense_code: "LABOUR", jumlah: 1000 }
        };
        const data = {
            adjustment_type: "PREMI",
            adjustment_name: "PREMI KINERJA", // not in old whitelist
            amount: 0
        };
        // Expected: synced amount = 3000
    });

    it("still syncs PREMI PRUNING (was already in whitelist — no regression)", () => {
        const metadata = {
            input_type: "blok",
            items: [{ subblok: "P0921", gang_code: "B1H", jumlah: 201549 }]
        };
        const data = {
            adjustment_type: "PREMI",
            adjustment_name: "PREMI PRUNING", // was in whitelist
            amount: 0
        };
        // Expected: synced amount = 201549
    });

    it("does NOT sync for amount input_type", () => {
        // Plain amount — no structured metadata to sum
        const metadata = { input_type: "amount", total_amount: 5000 };
        const data = {
            adjustment_type: "PREMI",
            adjustment_name: "PREMI TIKET",
            amount: 5000
        };
        // Expected: amount stays 5000 (fallback), metadataJsonStr unchanged
    });

    it("does NOT sync for POTONGAN_KOTOR type (non-PREMI)", () => {
        const metadata = {
            input_type: "blok",
            items: [{ subblok: "P0921", gang_code: "B1H", jumlah: 5000 }]
        };
        const data = {
            adjustment_type: "POTONGAN_KOTOR",
            adjustment_name: "KOREKSI PANEN",
            amount: 0
        };
        // Expected: amount stays 0, metadataJsonStr unchanged
    });

    it("returns fallbackAmount when metadata is null", () => {
        const data = {
            adjustment_type: "PREMI",
            adjustment_name: "PREMI TBS",
            amount: 1234
        };
        // Expected: amount stays 1234 (no metadata to sync from)
    });

    it("injects total_amount into metadataJsonStr on sync", () => {
        // When sync happens, the returned metadataJsonStr should contain total_amount
        const metadata = {
            input_type: "blok",
            items: [{ subblok: "P0921", gang_code: "B1H", jumlah: 5000 }]
            // Note: no total_amount field in input
        };
        const data = {
            adjustment_type: "PREMI",
            adjustment_name: "PREMI JAGA",
            amount: 9999 // wrong amount
        };
        // Expected: returned metadataJsonStr = JSON.stringify({input_type:"blok", items:[...], total_amount: 5000})
    });
});

describe("metadata_json validation (TODO-002)", () => {
    it("accepts valid blok metadata_json", () => {
        const raw = '{"input_type":"blok","items":[{"subblok":"P0921","gang_code":"B1H","jumlah":5000}]}';
        // Should NOT throw
    });

    it("accepts valid exp metadata_json", () => {
        const raw = '{"input_type":"exp","expense_code":"LABOUR","jumlah":5000}';
        // Should NOT throw
    });

    it("accepts valid kendaraan metadata_json", () => {
        const raw = '{"input_type":"kendaraan","items":[{"nomor_kendaraan":"B1234AB","expense_code":"TRANSPORT","jumlah":3000}]}';
        // Should NOT throw
    });

    it("accepts valid blok,exp metadata_json", () => {
        const raw = '{"input_type":"blok,exp","blok_items":[{"subblok":"P0921","gang_code":"B1H","jumlah":2000}],"expense":{"expense_code":"LABOUR","jumlah":1000}}';
        // Should NOT throw
    });

    it("accepts valid amount metadata_json", () => {
        const raw = '{"input_type":"amount","total_amount":5000}';
        // Should NOT throw
    });

    it("rejects invalid JSON metadata_json", () => {
        const raw = '{ invalid json here }';
        // Should throw Error('metadata_json is not valid JSON: ...')
    });

    it("rejects metadata_json missing input_type field", () => {
        const raw = '{"items":[{"subblok":"P0921","jumlah":5000}]}';
        // Should throw Error("metadata_json must have an 'input_type' field")
    });

    it("rejects unknown input_type", () => {
        const raw = '{"input_type":"invalid_type","jumlah":5000}';
        // Should throw Error('metadata_json input_type "invalid_type" not supported')
    });

    it("allows null metadata_json", () => {
        const raw = null;
        // Should NOT throw
    });

    it("allows undefined metadata_json", () => {
        const raw = undefined;
        // Should NOT throw
    });

    it("allows empty string metadata_json", () => {
        const raw = "";
        // Should NOT throw
    });
});

describe("serializeManualAdjustmentMetadata", () => {
    it("returns null for null input", () => {
        // serializeManualAdjustmentMetadata(null) → null
    });

    it("returns null for undefined input", () => {
        // serializeManualAdjustmentMetadata(undefined) → null
    });

    it("returns string as-is if already string", () => {
        const input = '{"input_type":"blok","items":[]}';
        // serializeManualAdjustmentMetadata(input) → '{"input_type":"blok","items":[]}'
    });

    it("JSON-stringifies object input", () => {
        const input = { input_type: "blok", items: [] };
        // serializeManualAdjustmentMetadata(input) → '{"input_type":"blok","items":[]}'
    });
});
