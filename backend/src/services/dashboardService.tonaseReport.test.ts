import { afterEach, describe, expect, it } from "bun:test";
import { dashboardService } from "./dashboardService";

describe("DashboardService tonase analysis report", () => {
    const service = dashboardService as any;
    const originalExtendDb = service.extendDb;
    const originalGetGangProduction = service.getGangProduction;
    const originalGetHarvesterBunches = service.getHarvesterBunches;

    afterEach(() => {
        service.extendDb = originalExtendDb;
        service.getGangProduction = originalGetGangProduction;
        service.getHarvesterBunches = originalGetHarvesterBunches;
    });

    // Mock DB yang membedakan query aggregation (latest_rows) vs division_tonase,
    // karena getTonaseAnalysisReport membaca tonase otoritatif dari division_tonase.
    const mockDb = (aggRows: any[], dtRows: any[], capture?: (sql: string) => void) => ({
        query: async (query: string) => {
            if (String(query).includes("division_tonase")) return dtRows;
            if (capture) capture(query);
            return aggRows;
        }
    });

    it("builds a 5-month harvest-gang report with upah bersih and premi efficiency metrics", async () => {
        let sql = "";
        service.extendDb = mockDb(
            [
                {
                    period_month: 1,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 100000,
                    total_hk: 5,
                    total_premi: 10000,
                    total_premi_brondol: 2000,
                    total_premi_prunning: 3000,
                    total_premi_insentif: 4000,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 5,
                    total_weight_tbs: 5,
                    total_employees: 3
                },
                {
                    period_month: 3,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 160000,
                    total_hk: 8,
                    total_premi: 24000,
                    total_premi_brondol: 4000,
                    total_premi_prunning: 5000,
                    total_premi_insentif: 6000,
                    total_premi_kinerja: 7000,
                    total_ffb_weight: 8,
                    total_weight_tbs: 8,
                    total_employees: 4
                },
                {
                    period_month: 4,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 240000,
                    total_hk: 12,
                    total_premi: 36000,
                    total_premi_brondol: 6000,
                    total_premi_prunning: 6000,
                    total_premi_insentif: 8000,
                    total_premi_kinerja: 10000,
                    total_ffb_weight: 0,
                    total_weight_tbs: 0,
                    total_employees: 5
                },
                {
                    period_month: 5,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 200000,
                    total_upah_kotor: 220000,
                    total_hk: 10,
                    total_premi: 30000,
                    total_premi_brondol: 5000,
                    total_premi_prunning: 7000,
                    total_premi_insentif: 8000,
                    total_premi_kinerja: 4000,
                    total_ffb_weight: 10,
                    total_weight_tbs: 10,
                    total_employees: 4
                },
                {
                    period_month: 5,
                    period_year: 2026,
                    gang_code: "B1M",
                    division_code: "B1",
                    gang_description: "Rawat B1",
                    total_upah_bersih: 900000,
                    total_hk: 99,
                    total_premi: 90000,
                    total_premi_brondol: 90000,
                    total_premi_prunning: 0,
                    total_premi_insentif: 0,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 0,
                    total_weight_tbs: 0,
                    total_employees: 9
                }
            ],
            [
                { period_month: 1, period_year: 2026, division_code: "A1", tonase: 5 },
                { period_month: 3, period_year: 2026, division_code: "A1", tonase: 8 },
                { period_month: 4, period_year: 2026, division_code: "A1", tonase: 12 },
                { period_month: 5, period_year: 2026, division_code: "A1", tonase: 10 }
            ],
            (q) => { sql = q; }
        );
        service.getGangProduction = async (month: number, year: number) => {
            if (month === 4 && year === 2026) return new Map([["A1H", 12000]]);
            return new Map();
        };
        service.getHarvesterBunches = async () => new Map();

        const report = await service.getTonaseAnalysisReport(5, 2026);

        expect(sql).toContain("ROW_NUMBER() OVER");
        expect(sql).toContain("agg.row_rank = 1");
        expect(sql).toContain("agg.division_code NOT LIKE 'L%'");
        expect(sql).toContain("SUM(ISNULL(agg.total_weight_tbs, 0)) as total_weight_tbs");
        expect(sql).not.toContain("RIGHT(UPPER(LTRIM(RTRIM(agg.gang_code))), 1) = 'H'");
        expect(report.meta.scope).toBe("SELURUH REBINMAS");
        expect(report.meta.period_window.map((p: any) => `${p.month}-${p.year}`)).toEqual([
            "1-2026",
            "2-2026",
            "3-2026",
            "4-2026",
            "5-2026"
        ]);
        expect(report.trend).toHaveLength(5);
        expect(report.trend[1].total_tonase).toBe(0);
        expect(report.trend[3].total_tonase).toBe(12);
        expect(report.kpis.total_tonase).toBe(10);
        expect(report.kpis.upah_covered_tonase).toBe(10);
        expect(report.kpis.upah_coverage).toBe(100);
        expect(report.kpis.total_hk).toBe(10);
        expect(report.kpis.total_upah_bersih).toBe(200000);
        expect(report.kpis.total_premi).toBe(30000);
        expect(report.kpis.upah_bersih_per_hk).toBe(20000);
        expect(report.kpis.upah_kotor_per_hk).toBe(22000);
        expect(report.kpis.premi_per_hk).toBe(3000);
        expect(report.kpis.upah_bersih_per_ton).toBe(20000);
        expect(report.kpis.upah_kotor_per_ton).toBe(22000);
        expect(report.kpis.premi_per_ton).toBe(3000);
        expect(report.kpis.premi_share).toBe(13.64);
        expect(report.premium_breakdown.map((p: any) => p.key)).toEqual([
            "insentif",
            "prunning",
            "brondol",
            "kinerja",
            "lainnya"
        ]);
        expect(report.premium_breakdown.find((p: any) => p.key === "lainnya").total_amount).toBe(6000);
        expect(report.insights.highest_tonase_period).toEqual({ label: "Apr 2026", value: 12 });
        expect(report.insights.upah_coverage).toBe(100);
        expect(report.warnings).toEqual([]);
    });

    it("marks per-HK and per-ton metrics unavailable when HK and tonase are zero", async () => {
        service.extendDb = mockDb(
            [
                {
                    period_month: 5,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 1000,
                    total_hk: 0,
                    total_premi: 100,
                    total_premi_brondol: 100,
                    total_premi_prunning: 0,
                    total_premi_insentif: 0,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 0,
                    total_weight_tbs: 0,
                    total_employees: 1
                }
            ],
            []
        );
        service.getGangProduction = async () => new Map();
        service.getHarvesterBunches = async () => new Map();

        const report = await service.getTonaseAnalysisReport(5, 2026);

        expect(report.kpis.total_tonase).toBe(0);
        expect(report.kpis.upah_covered_tonase).toBe(0);
        expect(report.kpis.upah_bersih_per_hk).toBeNull();
        expect(report.kpis.premi_per_hk).toBeNull();
        expect(report.kpis.upah_bersih_per_ton).toBeNull();
        expect(report.kpis.premi_per_ton).toBeNull();
        expect(report.warnings).toContain("Tonase belum tersedia untuk 1 gang panen pada periode terpilih.");
        expect(report.warnings).toContain("Total HK gang panen nol pada periode terpilih; metrik per HK tidak tersedia.");
    });

    it("reads tonase from all latest aggregation rows while keeping HK and premium metrics harvest-only", async () => {
        service.extendDb = mockDb(
            [
                {
                    period_month: 4,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 120000,
                    total_hk: 6,
                    total_premi: 12000,
                    total_premi_brondol: 3000,
                    total_premi_prunning: 3000,
                    total_premi_insentif: 3000,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 0,
                    total_weight_tbs: 0,
                    total_employees: 4
                },
                {
                    period_month: 4,
                    period_year: 2026,
                    gang_code: "A1T",
                    division_code: "A1",
                    gang_description: "Transport A1",
                    total_upah_bersih: 500000,
                    total_hk: 20,
                    total_premi: 50000,
                    total_premi_brondol: 50000,
                    total_premi_prunning: 0,
                    total_premi_insentif: 0,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 15,
                    total_weight_tbs: 15,
                    total_employees: 8
                },
                {
                    period_month: 5,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 200000,
                    total_hk: 10,
                    total_premi: 30000,
                    total_premi_brondol: 5000,
                    total_premi_prunning: 7000,
                    total_premi_insentif: 8000,
                    total_premi_kinerja: 4000,
                    total_ffb_weight: 0,
                    total_weight_tbs: 0,
                    total_employees: 4
                },
                {
                    period_month: 5,
                    period_year: 2026,
                    gang_code: "A1T",
                    division_code: "A1",
                    gang_description: "Transport A1",
                    total_upah_bersih: 800000,
                    total_hk: 40,
                    total_premi: 80000,
                    total_premi_brondol: 80000,
                    total_premi_prunning: 0,
                    total_premi_insentif: 0,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 20,
                    total_weight_tbs: 20,
                    total_employees: 9
                },
                {
                    period_month: 5,
                    period_year: 2026,
                    gang_code: "A2T",
                    division_code: "A2",
                    gang_description: "Transport A2",
                    total_upah_bersih: 600000,
                    total_hk: 30,
                    total_premi: 60000,
                    total_premi_brondol: 60000,
                    total_premi_prunning: 0,
                    total_premi_insentif: 0,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 35,
                    total_weight_tbs: 35,
                    total_employees: 7
                }
            ],
            [
                { period_month: 4, period_year: 2026, division_code: "A1", tonase: 15 },
                { period_month: 5, period_year: 2026, division_code: "A1", tonase: 20 },
                { period_month: 5, period_year: 2026, division_code: "A2", tonase: 35 }
            ]
        );
        service.getGangProduction = async () => new Map();
        service.getHarvesterBunches = async () => new Map();

        const report = await service.getTonaseAnalysisReport(5, 2026);

        expect(report.trend[3].total_tonase).toBe(15);
        expect(report.kpis.total_tonase).toBe(55);
        expect(report.kpis.upah_covered_tonase).toBe(55);
        expect(report.kpis.upah_coverage).toBe(100);
        expect(report.kpis.total_hk).toBe(10);
        expect(report.kpis.total_upah_bersih).toBe(200000);
        expect(report.kpis.total_premi).toBe(30000);
        expect(report.kpis.upah_bersih_per_hk).toBe(20000);
        expect(report.kpis.premi_per_hk).toBe(3000);
        expect(report.kpis.upah_bersih_per_ton).toBe(3636);
        expect(report.kpis.premi_per_ton).toBe(545);

        expect(report.division_breakdown.map((row: any) => row.division_code)).toEqual(["A2", "A1"]);
        const divisionA1 = report.division_breakdown.find((row: any) => row.division_code === "A1");
        const divisionA2 = report.division_breakdown.find((row: any) => row.division_code === "A2");
        expect(divisionA1.total_tonase).toBe(20);
        expect(divisionA1.upah_available).toBe(1);
        expect(divisionA1.total_hk).toBe(10);
        expect(divisionA1.total_upah_bersih).toBe(200000);
        expect(divisionA1.total_premi).toBe(30000);
        expect(divisionA1.upah_bersih_per_hk).toBe(20000);
        expect(divisionA1.premi_per_hk).toBe(3000);
        expect(divisionA1.upah_bersih_per_ton).toBe(10000);
        expect(divisionA1.premi_per_ton).toBe(1500);
        expect(divisionA1.tonase_share).toBe(36.36);
        expect(divisionA2.total_tonase).toBe(35);
        expect(divisionA2.upah_available).toBe(1);
        expect(divisionA2.total_hk).toBe(0);
        expect(divisionA2.upah_bersih_per_hk).toBeNull();
        expect(divisionA2.premi_per_ton).toBeNull();
        expect(divisionA2.tonase_share).toBe(63.64);

        expect(report.division_details.map((row: any) => row.division_code)).toEqual(["A2", "A1"]);
        const detailA1 = report.division_details.find((row: any) => row.division_code === "A1");
        const detailA2 = report.division_details.find((row: any) => row.division_code === "A2");
        expect(detailA1.summary.total_tonase).toBe(20);
        expect(detailA1.trend.map((row: any) => row.period_key)).toEqual([
            "2026-01",
            "2026-02",
            "2026-03",
            "2026-04",
            "2026-05"
        ]);
        expect(detailA1.trend[3]).toEqual(expect.objectContaining({
            total_tonase: 15,
            total_hk: 6,
            total_upah_bersih: 120000,
            total_premi: 12000,
            upah_bersih_per_hk: 20000,
            premi_per_hk: 2000
        }));
        expect(detailA1.trend[4]).toEqual(expect.objectContaining({
            total_tonase: 20,
            total_hk: 10,
            total_upah_bersih: 200000,
            total_premi: 30000,
            upah_bersih_per_hk: 20000,
            premi_per_hk: 3000,
            premi_per_ton: 1500
        }));
        expect(detailA1.gang_rows).toEqual([
            expect.objectContaining({
                gang_code: "A1H",
                gang_type: "harvesting",
                total_hk: 10,
                total_upah_bersih: 200000,
                total_premi: 30000,
                upah_bersih_per_hk: 20000,
                premi_per_hk: 3000
            })
        ]);
        expect(detailA1.tonase_rows).toEqual([
            expect.objectContaining({
                gang_code: "A1T",
                gang_type: "transport",
                total_tonase: 20
            })
        ]);
        expect(detailA2.summary.total_tonase).toBe(35);
        expect(detailA2.trend[4]).toEqual(expect.objectContaining({
            total_tonase: 35,
            total_hk: 0,
            upah_bersih_per_hk: null
        }));
        expect(detailA2.gang_rows).toEqual([]);
        expect(detailA2.tonase_rows).toEqual([
            expect.objectContaining({
                gang_code: "A2T",
                total_tonase: 35
            })
        ]);
    });

    it("keeps tonase-only divisions visible (upah_available=0) and warns about missing upah (July-like)", async () => {
        // July 2026 scenario: A1 punya payroll (panen), A2 sudah produksi tonase tapi payroll belum masuk.
        service.extendDb = mockDb(
            [
                {
                    period_month: 7,
                    period_year: 2026,
                    gang_code: "A1H",
                    division_code: "A1",
                    gang_description: "Panen A1",
                    total_upah_bersih: 100000,
                    total_upah_kotor: 120000,
                    total_hk: 5,
                    total_premi: 10000,
                    total_premi_brondol: 2000,
                    total_premi_prunning: 3000,
                    total_premi_insentif: 4000,
                    total_premi_kinerja: 0,
                    total_ffb_weight: 0,
                    total_weight_tbs: 0,
                    total_employees: 3
                }
            ],
            [
                { period_month: 7, period_year: 2026, division_code: "A1", tonase: 10 },
                { period_month: 7, period_year: 2026, division_code: "A2", tonase: 40 }
            ]
        );
        service.getGangProduction = async () => new Map();
        service.getHarvesterBunches = async () => new Map();

        const report = await service.getTonaseAnalysisReport(7, 2026);

        // Tonase total jujur mencakup kedua divisi; per-ton metrics hanya dari divisi ber-upah.
        expect(report.kpis.total_tonase).toBe(50);
        expect(report.kpis.upah_covered_tonase).toBe(10);
        expect(report.kpis.upah_coverage).toBe(20);
        expect(report.kpis.upah_bersih_per_ton).toBe(10000);
        expect(report.kpis.upah_bersih_per_hk).toBe(20000);

        const breakdown = report.division_breakdown;
        expect(breakdown.map((r: any) => r.division_code)).toEqual(["A2", "A1"]);
        const a1 = breakdown.find((r: any) => r.division_code === "A1");
        const a2 = breakdown.find((r: any) => r.division_code === "A2");
        expect(a1.upah_available).toBe(1);
        expect(a1.upah_bersih_per_ton).toBe(10000);
        expect(a2.total_tonase).toBe(40);
        expect(a2.upah_available).toBe(0);
        expect(a2.total_hk).toBe(0);
        expect(a2.upah_bersih_per_ton).toBeNull();

        // Division detail tetap muncul walau belum punya gang rows.
        const detailA2 = report.division_details.find((d: any) => d.division_code === "A2");
        expect(detailA2.summary.total_tonase).toBe(40);
        expect(detailA2.summary.upah_available).toBe(0);
        expect(detailA2.gang_rows).toEqual([]);
        expect(detailA2.tonase_rows).toEqual([]);

        const joined = report.warnings.join(" | ");
        expect(joined).toContain("1 divisi memproduksi 40 t tapi data upah belum masuk");
        expect(joined).toContain("cakupan upah 20%");
        expect(report.insights.upah_coverage).toBe(20);
        expect(report.insights.highest_tonase_period).toEqual({ label: "Jul 2026", value: 50 });
        expect(report.insights.largest_tonase_movement).toEqual(expect.objectContaining({ value: 50, direction: "naik" }));
    });
});
