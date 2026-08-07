import { afterEach, describe, expect, it } from "bun:test";
import { dashboardService } from "./dashboardService";

describe("DashboardService aggregation reads", () => {
    const service = dashboardService as any;
    const originalExtendDb = service.extendDb;
    const originalGetGangProduction = service.getGangProduction;
    const originalGetHarvesterBunches = service.getHarvesterBunches;

    afterEach(() => {
        service.extendDb = originalExtendDb;
        service.getGangProduction = originalGetGangProduction;
        service.getHarvesterBunches = originalGetHarvesterBunches;
    });

    it("uses latest aggregation rows for division breakdown totals", async () => {
        let sql = "";
        service.extendDb = {
            query: async (query: string) => {
                sql = query;
                return [];
            }
        };

        await dashboardService.getDivisionBreakdown(4, 2026);

        expect(sql).toContain("ROW_NUMBER() OVER");
        expect(sql).toContain("PARTITION BY h.period_month, h.period_year, h.gang_code");
        expect(sql).toContain("FROM latest_rows h");
        expect(sql).toContain("h.row_rank = 1");
    });

    it("uses latest aggregation rows for gang comparison totals", async () => {
        let sql = "";
        service.extendDb = {
            query: async (query: string) => {
                sql = query;
                return [{
                    gang_code: "A01",
                    gang_description: "AFD A01",
                    total_wage: 100,
                    total_hk: 2,
                    headcount: 1,
                    total_ot: 0,
                    total_premi: 0,
                    total_production_db: 0
                }];
            }
        };
        service.getGangProduction = async () => new Map();
        service.getHarvesterBunches = async () => new Map();

        const rows = await dashboardService.getGangComparison(4, 2026);

        expect(sql).toContain("ROW_NUMBER() OVER");
        expect(sql).toContain("FROM latest_rows agg");
        expect(sql).toContain("agg.row_rank = 1");
        expect(rows[0].cost_per_hk).toBe(50);
    });
});

describe("DashboardService gang scope filter", () => {
    const service = dashboardService as any;
    const originalExtendDb = service.extendDb;
    const originalGetGangProduction = service.getGangProduction;
    const originalGetHarvesterBunches = service.getHarvesterBunches;

    // Fragmen SQL konvensi harvestGangSql untuk scope 'panen' (suffix 'H')
    const HARVEST_FILTER_AGG = "RIGHT(UPPER(LTRIM(RTRIM(agg.gang_code))), 1) = 'H'";
    const HARVEST_FILTER_H = "RIGHT(UPPER(LTRIM(RTRIM(h.gang_code))), 1) = 'H'";

    const gangRows = [
        { gang_code: "A1H", gang_description: "Panen A1", total_wage: 100, total_hk: 2, headcount: 1, total_ot: 0, total_premi: 0, total_production_db: 0 },
        { gang_code: "B1M", gang_description: "Rawat B1", total_wage: 400, total_hk: 4, headcount: 2, total_ot: 0, total_premi: 0, total_production_db: 0 },
        { gang_code: "C1T", gang_description: "Angkut C1", total_wage: 150, total_hk: 6, headcount: 3, total_ot: 0, total_premi: 0, total_production_db: 0 }
    ];

    afterEach(() => {
        service.extendDb = originalExtendDb;
        service.getGangProduction = originalGetGangProduction;
        service.getHarvesterBunches = originalGetHarvesterBunches;
    });

    // Mock DB yang meniru efek filter SQL: bila fragmen filter panen ada di query,
    // DB hanya mengembalikan gang ber-suffix 'H'.
    const mockGangDb = () => {
        let sql = "";
        service.extendDb = {
            query: async (query: string) => {
                sql = query;
                if (query.includes(HARVEST_FILTER_AGG) || query.includes(HARVEST_FILTER_H)) {
                    return gangRows.filter(r => r.gang_code.trim().toUpperCase().endsWith("H"));
                }
                return gangRows;
            }
        };
        service.getGangProduction = async () => new Map();
        service.getHarvesterBunches = async () => new Map();
        return () => sql;
    };

    it("getGangComparison tanpa scope tidak memfilter gang (perilaku lama)", async () => {
        const getSql = mockGangDb();

        const rows = await dashboardService.getGangComparison(4, 2026);

        expect(getSql()).not.toContain(HARVEST_FILTER_AGG);
        expect(rows.map((r: any) => r.gang_code)).toEqual(["B1M", "A1H", "C1T"]);
    });

    it("getGangComparison scope=panen memfilter hanya gang suffix H", async () => {
        const getSql = mockGangDb();

        const rows = await dashboardService.getGangComparison(4, 2026, undefined, 'panen');

        expect(getSql()).toContain(HARVEST_FILTER_AGG);
        expect(rows.map((r: any) => r.gang_code)).toEqual(["A1H"]);
    });

    it("getGangComparison scope=all tidak memfilter gang", async () => {
        const getSql = mockGangDb();

        const rows = await dashboardService.getGangComparison(4, 2026, undefined, 'all');

        expect(getSql()).not.toContain(HARVEST_FILTER_AGG);
        expect(rows).toHaveLength(3);
    });

    it("getTopBottomGangs meneruskan scope panen ke getGangComparison", async () => {
        const getSql = mockGangDb();

        const result = await dashboardService.getTopBottomGangs(4, 2026, undefined, 'panen');

        expect(getSql()).toContain(HARVEST_FILTER_AGG);
        expect(result.top.map((r: any) => r.gang_code)).toEqual(["A1H"]);
    });

    it("getAllGangsTrend scope=panen menambahkan filter suffix H pada SQL", async () => {
        const getSql = mockGangDb();

        await dashboardService.getAllGangsTrend(4, 2026, undefined, 'panen');

        expect(getSql()).toContain(HARVEST_FILTER_H);
    });

    it("getAllGangsTrend tanpa scope tidak menambahkan filter panen", async () => {
        const getSql = mockGangDb();

        await dashboardService.getAllGangsTrend(4, 2026);

        expect(getSql()).not.toContain(HARVEST_FILTER_H);
    });
});
