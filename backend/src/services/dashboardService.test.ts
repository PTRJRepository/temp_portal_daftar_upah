import { afterEach, describe, expect, it } from "bun:test";
import { dashboardService } from "./dashboardService";
import { dashboardRoutes } from "../api/dashboardRoutes";

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

    // Fragmen SQL konvensi scopeGangSql untuk scope 'panen' (suffix 'H')
    const HARVEST_FILTER_AGG = "RIGHT(UPPER(LTRIM(RTRIM(agg.gang_code))), 1) IN ('H')";
    const HARVEST_FILTER_H = "RIGHT(UPPER(LTRIM(RTRIM(h.gang_code))), 1) IN ('H')";

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

describe("DashboardService headcount summary", () => {
    const service = dashboardService as any;
    const originalHrDb = service.hrDb;

    afterEach(() => {
        service.hrDb = originalHrDb;
    });

    const masterRows = [
        { loc_code: "ARA", hr_emp_type: "SKU", gender: "1", join_date: "2020-01-10" },
        { loc_code: "ARA", hr_emp_type: "BHL", gender: "2", join_date: "2026-03-05" },
        { loc_code: "ARC", hr_emp_type: null, gender: "M", join_date: null },
        { loc_code: "", hr_emp_type: "sku", gender: "P", join_date: "2025-12-20" }
    ];

    it("mengagregasi total, divisi, tipe karyawan, gender, dan tren join 12 bulan", async () => {
        service.hrDb = { query: async () => masterRows };

        const result = await dashboardService.getHeadcountSummary(4, 2026);

        expect(result.total).toBe(4);
        expect(result.by_division).toEqual([
            { division_code: "ARA", headcount: 2 },
            { division_code: "ARC", headcount: 1 },
            { division_code: "UNKNOWN", headcount: 1 }
        ]);
        expect(result.by_emp_type).toEqual([
            { emp_type: "SKU", headcount: 2 },
            { emp_type: "BHL", headcount: 1 },
            { emp_type: "LAINNYA", headcount: 1 }
        ]);
        expect(result.by_gender).toEqual([
            { gender: "L", headcount: 2 },
            { gender: "P", headcount: 2 }
        ]);
        // Window 12 bulan untuk periode akhir Apr 2026 = Mei 2025..Apr 2026
        expect(result.join_trend_12m).toHaveLength(12);
        expect(result.join_trend_12m.find((p: any) => p.month === 3 && p.year === 2026).joined).toBe(1);
        expect(result.join_trend_12m.find((p: any) => p.month === 12 && p.year === 2025).joined).toBe(1);
        expect(result.join_trend_12m.find((p: any) => p.month === 1 && p.year === 2026).joined).toBe(0);
    });

    it("menandai sumber KPI headcount: aggregation bila ada, live bila kosong", () => {
        expect(dashboardService.withLiveHeadcountFallback({ curr_headcount: 120 }, 999))
            .toEqual({ curr_headcount: 120, headcount_source: "aggregation" });
        expect(dashboardService.withLiveHeadcountFallback({ curr_headcount: 0 }, 999))
            .toEqual({ curr_headcount: 999, headcount_source: "live" });
    });
});

describe("DashboardService cost structure", () => {
    const service = dashboardService as any;
    const originalExtendDb = service.extendDb;

    afterEach(() => {
        service.extendDb = originalExtendDb;
    });

    it("menurunkan upah pokok, rasio biaya, dan total dari breakdown divisi", async () => {
        service.extendDb = {
            query: async () => [
                { division_code: "ARA", total_wage: 1000, total_ot: 100, total_premi: 200, headcount: 10, total_hk: 200, total_potongan: 50, total_spsi: 5, total_pph21: 15, total_bpjs_pekerja: 30, total_koreksi: 0, total_tonase: 250, upah_available: 1 },
                { division_code: "DME", total_wage: 0, total_ot: 0, total_premi: 0, headcount: 0, total_hk: 0, total_potongan: 0, total_spsi: 0, total_pph21: 0, total_bpjs_pekerja: 0, total_koreksi: 0, total_tonase: 120, upah_available: 0 }
            ]
        };

        const result = await dashboardService.getCostStructure(4, 2026, 'panen');

        expect(result.divisions[0]).toMatchObject({
            division_code: "ARA",
            upah_pokok: 700,
            premi: 200,
            lembur: 100,
            cost_per_head: 100,
            cost_per_hk: 5,
            cost_per_ton: 4,
            upah_available: true
        });
        // Divisi produksi tanpa data upah: rasio null + flag false (bukan angka 0 menyesatkan)
        expect(result.divisions[1]).toMatchObject({
            division_code: "DME",
            cost_per_head: null,
            cost_per_hk: null,
            cost_per_ton: null,
            upah_available: false
        });
        expect(result.totals).toMatchObject({
            upah_pokok: 700,
            total_wage: 1000,
            headcount: 10,
            total_hk: 200,
            tonase: 370
        });
    });
});

describe("dashboard routes headcount & cost structure", () => {
    const service = dashboardService as any;
    const originalHrDb = service.hrDb;
    const originalExtendDb = service.extendDb;

    afterEach(() => {
        service.hrDb = originalHrDb;
        service.extendDb = originalExtendDb;
    });

    it("GET /headcount-summary mengembalikan ringkasan live", async () => {
        service.hrDb = { query: async () => [{ loc_code: "ARA", hr_emp_type: "SKU", gender: "1", join_date: null }] };

        const res = await dashboardRoutes.handle(new Request("http://localhost/payroll/dashboard/headcount-summary?month=4&year=2026"));
        const json = await res.json();

        expect(json.success).toBe(true);
        expect(json.data.total).toBe(1);
        expect(json.data.by_division).toEqual([{ division_code: "ARA", headcount: 1 }]);
    });

    it("GET /cost-structure mengembalikan komposisi biaya", async () => {
        service.extendDb = {
            query: async () => [
                { division_code: "ARA", total_wage: 1000, total_ot: 100, total_premi: 200, headcount: 10, total_hk: 200, total_potongan: 0, total_spsi: 0, total_pph21: 0, total_bpjs_pekerja: 0, total_koreksi: 0, total_tonase: 250, upah_available: 1 }
            ]
        };

        const res = await dashboardRoutes.handle(new Request("http://localhost/payroll/dashboard/cost-structure?month=4&year=2026&scope=panen"));
        const json = await res.json();

        expect(json.success).toBe(true);
        expect(json.data.divisions[0].upah_pokok).toBe(700);
    });

    it("GET /executive-summary memakai fallback live saat headcount agregasi kosong", async () => {
        service.extendDb = { query: async () => [] };
        service.hrDb = { query: async () => [{ loc_code: "ARA", hr_emp_type: "SKU", gender: "1", join_date: null }] };

        const res = await dashboardRoutes.handle(new Request("http://localhost/payroll/dashboard/executive-summary?month=4&year=2026"));
        const json = await res.json();

        expect(json.success).toBe(true);
        expect(json.data.kpi.curr_headcount).toBe(1);
        expect(json.data.kpi.headcount_source).toBe("live");
    });
});
