import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

process.env.API_KEY_BYPASS = "test-manual-adjustment-api-key";
process.env.LOG_TO_FILE = "false";

const actualManualAdjustmentServiceModule = await import("../services/manualAdjustmentService");
const actualManualAdjustmentSyncStatusSeederModule = await import("../services/manualAdjustmentSyncStatusSeederService");
const actualAutoBufferManualAdjustmentSeederModule = await import("../services/autoBufferManualAdjustmentSeederService");
const actualTaskCodeOptionServiceModule = await import("../services/taskCodeOptionService");
const actualCacheServiceModule = await import("../services/cacheService");
const manualAdjustmentService = actualManualAdjustmentServiceModule.manualAdjustmentService as any;
const manualAdjustmentSyncStatusSeederService = actualManualAdjustmentSyncStatusSeederModule.manualAdjustmentSyncStatusSeederService as any;
const autoBufferManualAdjustmentSeederService = actualAutoBufferManualAdjustmentSeederModule.autoBufferManualAdjustmentSeederService as any;
const taskCodeOptionService = actualTaskCodeOptionServiceModule.taskCodeOptionService as any;
const cacheService = actualCacheServiceModule.cacheService as any;
const originalManualAdjustmentMethods = {
    getAdjustments: manualAdjustmentService.getAdjustments,
    listAdjustmentNameOptions: manualAdjustmentService.listAdjustmentNameOptions,
    updateManualAdjustmentSyncStatus: manualAdjustmentService.updateManualAdjustmentSyncStatus,
    checkAdtransDirectly: manualAdjustmentService.checkAdtransDirectly,
    listAdtransDocIds: manualAdjustmentService.listAdtransDocIds
};
const originalManualAdjustmentSyncStatusSeederMethods = {
    seedPeriod: manualAdjustmentSyncStatusSeederService.seedPeriod
};
const originalAutoBufferManualAdjustmentSeederMethods = {
    seedPeriod: autoBufferManualAdjustmentSeederService.seedPeriod
};
const originalTaskCodeOptionMethods = {
    searchAutomationAdjustmentOptions: taskCodeOptionService.searchAutomationAdjustmentOptions
};
const originalCacheServiceMethods = {
    clearByPattern: cacheService.clearByPattern
};

const defaultGetAdjustmentsRows = () => [
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
        adjustment_name: "PREMI JAGA",
        amount: 350000,
        remarks: "PREMI JAGA | (AL0018P1A) (AL) TUNJANGAN JAGA GENSET - (AL) TUNJANGAN JAGA GENSET | 350000 | sync:MANUAL | match:MANUAL",
        metadata_json: "{\"input_type\":\"blok\",\"items\":[{\"subblok\":\"P09/03\",\"gang_code\":\"G1H\",\"jumlah\":350000}],\"total_amount\":350000}"
    }
];

let getAdjustmentsRows: any[] = defaultGetAdjustmentsRows();
const getAdjustments = mock(async () => getAdjustmentsRows);

const listAdjustmentNameOptions = mock(async () => [
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
    },
    {
        adjustment_type: "POTONGAN_BERSIH",
        adjustment_name: "POTONGAN PINJAMAN"
    }
]);

const updateManualAdjustmentSyncStatus = mock(async () => ({
    period_month: 4,
    period_year: 2026,
    target_sync_status: "SYNC",
    only_if_adtrans_exists: true,
    dry_run: false,
    matched_count: 2,
    eligible_count: 1,
    adtrans_matched_count: 1,
    updated_count: 1,
    skipped_count: 1,
    rows: [
        {
            id: 12,
            adjustment_type: "PREMI",
            adjustment_name: "PREMI JAGA",
            old_sync_status: "MANUAL",
            new_sync_status: "SYNC",
            status: "UPDATED",
            skip_reason: null
        }
    ]
}));

const checkAdtransDirectly = mock(async () => ({
    totals: [],
    doc_desc_details: [],
    duplicate_report: {
        duplicate_count: 0,
        duplicates: []
    }
}));

const listAdtransDocIds = mock(async () => ["ADIJL26041001", "ADIJL26041002"]);

const seedSyncStatusPeriod = mock(async () => ({
    seeder: "manual_adjustment_sync_status",
    period_month: 4,
    period_year: 2026,
    adjustment_types: ["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH", "AUTO_BUFFER"],
    target_sync_status: "SYNC",
    only_if_adtrans_exists: true,
    dry_run: false,
    matched_count: 10,
    eligible_count: 8,
    adtrans_matched_count: 7,
    updated_count: 6,
    unchanged_count: 1,
    skipped_count: 3,
    partial_count: 1,
    rows: []
}));

const seedAutoBufferPeriod = mock(async () => ({
    period_month: 4,
    period_year: 2026,
    division_code: "AB1",
    gang_code: "ALL",
    source_rows: 25,
    seeded_entries: 100,
    inserted: 100,
    updated: 0,
    deleted_existing: 0,
    preserved_manual: 0,
    skipped_manual_conflicts: 0,
    replace_existing: true,
    value_priority_mode_source: "non_db_ptrj",
    validation: {
        total_rows: 100,
        match_count: 100,
        mismatch_count: 0,
        miss_count: 0
    }
}));

const searchAutomationAdjustmentOptions = mock(async () => [
    {
        category: "premi",
        adjustment_type: "PREMI",
        adjustment_name: "PREMI PRUNING",
        ad_code: "AL0001",
        description: "PREMI PRUNING",
        task_code: "AL0001AB1",
        task_desc: "(AL) PREMI PRUNING",
        base_task_code: "AL0001",
        loc_code: "AB1"
    },
    {
        category: "koreksi",
        adjustment_type: "POTONGAN_KOTOR",
        adjustment_name: "KOREKSI PANEN",
        ad_code: "DE0004",
        description: "KOREKSI PANEN",
        task_code: "DE0004AB1",
        task_desc: "(DE) POTONGAN PREMI",
        base_task_code: "DE0004",
        loc_code: "AB1"
    },
    {
        category: "potongan_upah_bersih",
        adjustment_type: "POTONGAN_BERSIH",
        adjustment_name: "POTONGAN PINJAMAN",
        ad_code: "DE0002",
        description: "POTONGAN PINJAMAN",
        task_code: "DE0002AB1",
        task_desc: "(DE) POTONGAN HUTANG",
        base_task_code: "DE0002",
        loc_code: "AB1"
    }
]);

manualAdjustmentService.getAdjustments = getAdjustments;
manualAdjustmentService.listAdjustmentNameOptions = listAdjustmentNameOptions;
manualAdjustmentService.updateManualAdjustmentSyncStatus = updateManualAdjustmentSyncStatus;
manualAdjustmentService.checkAdtransDirectly = checkAdtransDirectly;
manualAdjustmentService.listAdtransDocIds = listAdtransDocIds;
manualAdjustmentSyncStatusSeederService.seedPeriod = seedSyncStatusPeriod;
autoBufferManualAdjustmentSeederService.seedPeriod = seedAutoBufferPeriod;
taskCodeOptionService.searchAutomationAdjustmentOptions = searchAutomationAdjustmentOptions;
cacheService.clearByPattern = mock(() => {});

describe("manual adjustment by-api-key route", () => {
    afterAll(() => {
        manualAdjustmentService.getAdjustments = originalManualAdjustmentMethods.getAdjustments;
        manualAdjustmentService.listAdjustmentNameOptions = originalManualAdjustmentMethods.listAdjustmentNameOptions;
        manualAdjustmentService.updateManualAdjustmentSyncStatus = originalManualAdjustmentMethods.updateManualAdjustmentSyncStatus;
        manualAdjustmentService.checkAdtransDirectly = originalManualAdjustmentMethods.checkAdtransDirectly;
        manualAdjustmentService.listAdtransDocIds = originalManualAdjustmentMethods.listAdtransDocIds;
        manualAdjustmentSyncStatusSeederService.seedPeriod = originalManualAdjustmentSyncStatusSeederMethods.seedPeriod;
        autoBufferManualAdjustmentSeederService.seedPeriod = originalAutoBufferManualAdjustmentSeederMethods.seedPeriod;
        taskCodeOptionService.searchAutomationAdjustmentOptions = originalTaskCodeOptionMethods.searchAutomationAdjustmentOptions;
        cacheService.clearByPattern = originalCacheServiceMethods.clearByPattern;
    });

    beforeEach(() => {
        getAdjustmentsRows = defaultGetAdjustmentsRows();
        getAdjustments.mockClear();
        listAdjustmentNameOptions.mockClear();
        searchAutomationAdjustmentOptions.mockClear();
        updateManualAdjustmentSyncStatus.mockClear();
        checkAdtransDirectly.mockClear();
        listAdtransDocIds.mockClear();
        seedSyncStatusPeriod.mockClear();
        seedAutoBufferPeriod.mockClear();
        cacheService.clearByPattern.mockClear();
    });

    it("exposes POTONGAN PPH in auto-buffer seeder endpoint metadata", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/seed-auto-buffer",
            {
                method: "POST",
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    period_month: 4,
                    period_year: 2026,
                    division_code: "AB1"
                })
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.message).toContain("POTONGAN PPH");
        expect(body.auto_buffer_items_per_employee).toBe(4);
        expect(body.auto_buffer_adjustments.map((item: any) => item.adjustment_name)).toEqual([
            "TUNJANGAN JABATAN",
            "MASA KERJA",
            "SPSI",
            "POTONGAN PPH"
        ]);
        expect(body.auto_buffer_adjustments.find((item: any) => item.adjustment_name === "POTONGAN PPH")).toMatchObject({
            ad_code: "(DE) POTONGAN PPH21",
            ad_desc: "(DE) POTONGAN PPH21",
            task_desc: "(DE) POTONGAN PPH21",
            amount_source: "pph21_ter",
            comparison_source: "pot_pph21"
        });
        expect(seedAutoBufferPeriod).toHaveBeenCalledWith({
            period_month: 4,
            period_year: 2026,
            division_code: "AB1",
            gang_code: undefined,
            use_history_db: undefined,
            snapshot_version: undefined,
            replace_existing: undefined,
            value_priority_mode: undefined,
            created_by: "api_key_admin"
        });
        expect(cacheService.clearByPattern).toHaveBeenCalledWith(":4:2026");
    });

    it("passes metadata_only to the service and returns grouped metadata flag", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/by-api-key?period_month=4&period_year=2026&division_code=AB1&adjustment_type=PREMI&metadata_only=true&view=grouped",
            {
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key"
                }
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.view).toBe("grouped");
        expect(body.metadata_only).toBe(true);
        expect(body.data[0].gangs[0].employees[0].premium_transactions[0]).toMatchObject({
            adjustment_name: "PREMI JAGA",
            subblok: "P0903",
            subblok_raw: "P09/03",
            amount: 350000,
            ad_code: "AL0018P1A",
            ad_code_desc: "(AL) TUNJANGAN JAGA GENSET",
            ad_desc: "(AL) TUNJANGAN JAGA GENSET",
            task_desc: "(AL) TUNJANGAN JAGA GENSET"
        });
        expect(getAdjustments).toHaveBeenCalledWith(
            4,
            2026,
            undefined,
            undefined,
            "AB1",
            "PREMI",
            undefined,
            true
        );
    });

    it("returns fixed DE potongan premi fields for every koreksi manual adjustment", async () => {
        getAdjustmentsRows = [
            {
                id: 2,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0002",
                nik: "1902050504860002",
                emp_name: "ANI TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "POTONGAN_KOTOR",
                adjustment_name: "KOREKSI PANEN",
                amount: -25000,
                ad_code: "DE9999",
                task_code: "DE9999AB1",
                base_task_code: "DE9999",
                task_desc: "(DE) KOREKSI PANEN",
                remarks: "KOREKSI PANEN | DE9999 - (DE) KOREKSI PANEN | -25000 | sync:MANUAL | match:MANUAL"
            },
            {
                id: 3,
                period_month: 4,
                period_year: 2026,
                emp_code: "A0003",
                nik: "1902050504860003",
                emp_name: "BAMBANG TEST",
                gang_code: "G1H",
                division_code: "AB1",
                adjustment_type: "POTONGAN_KOTOR",
                adjustment_name: "KOREKSI X",
                amount: -10000,
                remarks: "KOREKSI X | (DE) KOREKSI X - (DE) KOREKSI X | -10000 | sync:MANUAL | match:MANUAL"
            }
        ];
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/by-api-key?period_month=4&period_year=2026&division_code=AB1&adjustment_type=POTONGAN_KOTOR",
            {
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key"
                }
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.view).toBe("flat");
        expect(body.data).toHaveLength(2);
        for (const row of body.data) {
            expect(row).toMatchObject({
                ad_code: "DE0004",
                ad_code_desc: "(DE) POTONGAN PREMI",
                ad_desc: "(DE) POTONGAN PREMI",
                task_desc: "(DE) POTONGAN PREMI"
            });
        }
    });

    it("returns enriched flat rows for API key reads", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/by-api-key?period_month=4&period_year=2026&division_code=AB1&adjustment_type=PREMI",
            {
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key"
                }
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.view).toBe("flat");
        expect(body.data[0]).toMatchObject({
            estate: "AB1",
            estate_code: "AB1",
            division_code: "G 1",
            ad_code: "AL0018P1A",
            ad_code_desc: "(AL) TUNJANGAN JAGA GENSET",
            ad_desc: "(AL) TUNJANGAN JAGA GENSET",
            task_desc: "(AL) TUNJANGAN JAGA GENSET"
        });
    });

    it("returns existing manual adjustment name variations grouped by adjustment type", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/adjustment-name-options/by-api-key?period_month=4&period_year=2026&division_code=AB1&gang_code=G1H&adjustment_type=PREMI,POTONGAN_KOTOR,POTONGAN_BERSIH&limit=200",
            {
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key"
                }
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.count).toBe(4);
        expect(body.adjustment_types).toEqual(["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH"]);
        expect(body.adjustment_names_by_type).toEqual({
            PREMI: ["PREMI PRUNING", "PREMI TBS"],
            POTONGAN_KOTOR: ["KOREKSI PANEN"],
            POTONGAN_BERSIH: ["POTONGAN PINJAMAN"]
        });
        expect(body.by_type.PREMI[0]).toMatchObject({
            adjustment_type: "PREMI",
            adjustment_name: "PREMI PRUNING"
        });
        expect(listAdjustmentNameOptions).toHaveBeenCalledWith({
            periodMonth: 4,
            periodYear: 2026,
            search: undefined,
            divisionCode: "AB1",
            gangCode: "G1H",
            limit: 200,
            adjustmentTypes: ["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH"],
            metadataOnly: false
        });
        expect(searchAutomationAdjustmentOptions).not.toHaveBeenCalled();
    });

    it("updates manual adjustment sync status through API key route", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/sync-status/by-api-key",
            {
                method: "POST",
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    period_month: 4,
                    period_year: 2026,
                    division_code: "AB1",
                    adjustment_type: "PREMI",
                    sync_status: "SYNC",
                    only_if_adtrans_exists: true,
                    updated_by: "agent_sync"
                })
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.updated_count).toBe(1);
        expect(updateManualAdjustmentSyncStatus).toHaveBeenCalledWith({
            periodMonth: 4,
            periodYear: 2026,
            divisionCode: "AB1",
            gangCode: undefined,
            empCode: undefined,
            adjustmentTypes: ["PREMI"],
            adjustmentName: undefined,
            ids: undefined,
            syncStatus: "SYNC",
            updatedBy: "agent_sync",
            onlyIfAdtransExists: true,
            dryRun: false,
            limit: undefined
        });
    });

    it("passes adjustment type and specific adjustment name to check-adtrans duplicate endpoint", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/check-adtrans/by-api-key",
            {
                method: "POST",
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    period_month: 4,
                    period_year: 2026,
                    division_code: "IJL",
                    adjustment_type: "PREMI",
                    adjustment_name: "PREMI TBS"
                })
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(checkAdtransDirectly).toHaveBeenCalledWith(
            4,
            2026,
            [],
            [],
            "IJL",
            {
                adjustmentTypes: ["PREMI"],
                adjustmentNames: ["PREMI TBS"],
                docDescs: []
            }
        );
    });

    it("returns only matching ADTRANS DocIDs for the selected config", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/adtrans-doc-ids/by-api-key",
            {
                method: "POST",
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    period_month: 4,
                    period_year: 2026,
                    division_code: "IJL",
                    adjustment_type: "PREMI",
                    adjustment_name: "PREMI TBS"
                })
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body).toEqual({
            success: true,
            count: 2,
            doc_ids: ["ADIJL26041001", "ADIJL26041002"]
        });
        expect(listAdtransDocIds).toHaveBeenCalledWith({
            periodMonth: 4,
            periodYear: 2026,
            empCodes: [],
            filters: [],
            divisionCode: "IJL",
            adjustmentTypes: ["PREMI"],
            adjustmentNames: ["PREMI TBS"],
            docDescs: []
        });
    });

    it("returns matching ADTRANS DocIDs through compatibility aliases", async () => {
        const { payrollRoutes } = await import("./payroll");

        for (const endpoint of ["adtrans-by-docid", "adtrans-by-doid"]) {
            const response = await payrollRoutes.handle(new Request(
                `http://localhost/payroll/manual-adjustment/${endpoint}/by-api-key`,
                {
                    method: "POST",
                    headers: {
                        "X-API-Key": "test-manual-adjustment-api-key",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        period_month: 4,
                        period_year: 2026,
                        division_code: "IJL",
                        adjustment_type: "PREMI",
                        adjustment_name: "PREMI TBS"
                    })
                }
            ));
            const body = await response.json() as any;

            expect(response.status).toBe(200);
            expect(body).toEqual({
                success: true,
                count: 2,
                doc_ids: ["ADIJL26041001", "ADIJL26041002"]
            });
        }
        expect(listAdtransDocIds).toHaveBeenCalledWith({
            periodMonth: 4,
            periodYear: 2026,
            empCodes: [],
            filters: [],
            divisionCode: "IJL",
            adjustmentTypes: ["PREMI"],
            adjustmentNames: ["PREMI TBS"],
            docDescs: []
        });
        expect(listAdtransDocIds).toHaveBeenCalledTimes(2);
    });

    it("runs manual adjustment sync status seeder through API key route", async () => {
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request(
            "http://localhost/payroll/manual-adjustment/seed-sync-status/by-api-key",
            {
                method: "POST",
                headers: {
                    "X-API-Key": "test-manual-adjustment-api-key",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    period_month: 4,
                    period_year: 2026,
                    division_code: "AB1",
                    created_by: "agent_sync"
                })
            }
        ));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.updated_count).toBe(6);
        expect(seedSyncStatusPeriod).toHaveBeenCalledWith({
            period_month: 4,
            period_year: 2026,
            division_code: "AB1",
            gang_code: undefined,
            emp_code: undefined,
            adjustment_types: undefined,
            adjustment_name: undefined,
            ids: undefined,
            sync_status: "SYNC",
            created_by: "agent_sync",
            only_if_adtrans_exists: true,
            dry_run: false,
            limit: undefined
        });
    });
});
