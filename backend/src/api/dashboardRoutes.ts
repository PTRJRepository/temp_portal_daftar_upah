import { Elysia, t } from "elysia";
import { dashboardService } from "../services/dashboardService";
import { historyDatabaseService } from "../services/historyDatabaseService";
import { Database } from "../db/client";

export const dashboardRoutes = new Elysia({ prefix: "/payroll/dashboard" })
    .get("/wage-distribution", async ({ query, set }) => {
        // Sebaran upah kotor karyawan dari history snapshot terbaru (extend_db_ptrj)
        // + tonase per divisi (division_tonase) agar frontend bisa hitung cost/ton
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionCode = query.division_code || 'ALL';
            const rows = await historyDatabaseService.getWageDistribution(month, year, divisionCode);
            // tonase map: division_code -> tonase (ton) from division_tonase for this period
            const db = Database.getExtendedInstance();
            const tonRows = await db.query<{ division_code: string; tonase: number }>(`
                SELECT RTRIM(division_code) AS division_code, ISNULL(tonase, 0) AS tonase
                FROM dbo.division_tonase WHERE period_month = ? AND period_year = ?
            `, [month, year]);
            const tonase = {};
            for (const r of tonRows) tonase[r.division_code.trim()] = Number(r.tonase) || 0;
            return { success: true, data: rows, tonase, meta: { count: rows.length, month, year, division_code: divisionCode } };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.Optional(t.String())
        })
    })
    .get("/executive-summary", async ({ query, set }) => {
        try {
            const month = query.month ? parseInt(query.month) : new Date().getMonth() + 1;
            const year = query.year ? parseInt(query.year) : new Date().getFullYear();
            const scope = ['panen','maintenance','transport','all'].includes(query.scope) ? query.scope : 'panen';

            const trends = await dashboardService.getPayrollTrend(month, year, scope);
            const breakdown = await dashboardService.getDivisionBreakdown(month, year, scope);
            const gangBreakdown = await dashboardService.getGangBreakdown(month, year, 15, scope);
            const efficiency = await dashboardService.getDivisionEfficiency(month, year, scope);

            const productivityTrend = await dashboardService.getProductivityTrend(month, year, scope);
            const wageSpikes = await dashboardService.getWageSpikes(month, year, scope);

            // KPI calculation (Current vs Previous Month in the trend series)
            const current = trends[trends.length - 1] || {};
            const prev = trends[trends.length - 2] || {};

            const kpi = {
                curr_wage: current.total_wage || 0,
                prev_wage: prev.total_wage || 0,
                curr_ot: current.total_ot || 0,
                prev_ot: prev.total_ot || 0,
                curr_headcount: current.total_headcount || 0,
                prev_headcount: prev.total_headcount || 0
            };

            return {
                success: true,
                data: {
                    trends,
                    breakdown,
                    gangBreakdown,
                    efficiency,
                    productivityTrend,
                    wageSpikes,
                    kpi,
                    gangScope: scope
                }
            };
        } catch (e: any) {
            set.status = 500;
            return {
                success: false,
                error: e.message
            };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            scope: t.Optional(t.Union([t.Literal('panen'), t.Literal('maintenance'), t.Literal('transport'), t.Literal('all')]))
        })
    })
    .get('/division-cost-trend', async ({ query, set }) => {
        try {
            const month = query.month ? parseInt(query.month) : new Date().getMonth() + 1;
            const year = query.year ? parseInt(query.year) : new Date().getFullYear();
            const span = query.span ? Math.min(Math.max(parseInt(query.span) || 8, 2), 24) : 8;
            const gangTypes = query.gang_types ? String(query.gang_types).split(',').map(s => s.trim()).filter(Boolean) : ['harvesting'];

            const series = await dashboardService.getDivisionCostTrend(month, year, span, gangTypes);
            return { success: true, data: { series, span, endMonth: month, endYear: year } };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.Optional(t.String()),
            year: t.Optional(t.String()),
            span: t.Optional(t.String()),
            gang_types: t.Optional(t.String())
        })
    })
    .get('/latest-period', async ({ set }) => {
        try {
            const period = await dashboardService.getLatestPeriod();
            return { success: true, data: period };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    })
    .get('/available-periods', async ({ set }) => {
        try {
            const periods = await dashboardService.getAvailablePeriods();
            return { success: true, data: periods };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    })
    .get('/filter-options', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const options = await dashboardService.getFilterOptions(month, year);
            return { success: true, data: options };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })
    .post('/comparison', async ({ body, set }) => {
        try {
            const { type, codes, month, year } = body;
            const data = await dashboardService.getComparisonData(type, codes, month, year);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            type: t.Union([t.Literal('division'), t.Literal('gang')]),
            codes: t.Array(t.String()),
            month: t.Numeric(),
            year: t.Numeric()
        })
    })
    .get('/aggregation/gang-data', async ({ query, set }) => {
        try {
            const division = query.division_code;
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const data = await dashboardService.getAggregatedGangData(division, month, year);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            division_code: t.String(),
            month: t.String(),
            year: t.String()
        })
    })
    .get('/aggregated-gang-data', async ({ query, set }) => {
        try {
            const division = query.division_code;
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const data = await dashboardService.getAggregatedGangData(division, month, year);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            division_code: t.String(),
            month: t.String(),
            year: t.String()
        })
    })
    .get('/premi-analysis', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const division = query.division_code;
            const data = await dashboardService.getPremiAnalysis(month, year, division);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.Optional(t.String())
        })
    })
    .get('/premi-by-division', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const data = await dashboardService.getPremiByDivision(month, year);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })
    .get('/overtime-analysis', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionCode = query.division_code;
            const data = await dashboardService.getOvertimeAnalysis(month, year, divisionCode);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.Optional(t.String())
        })
    })
    .get('/division-detail-data', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionCode = query.division_code;

            if (!divisionCode) {
                return { success: false, error: "Division code is required" };
            }

            const data = await dashboardService.getDivisionDetailData(month, year, divisionCode);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.String()
        })
    })
    .get('/gang-comparison', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionCode = query.division_code;
            // Tanpa param scope: perilaku lama (semua gang). scope=panen: hanya gang suffix 'H'.
            const scope = ['panen','maintenance','transport','all'].includes(query.scope) ? query.scope : undefined;
            const data = await dashboardService.getGangComparison(month, year, divisionCode, scope);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.Optional(t.String()),
            scope: t.Optional(t.String())
        })
    })
    .get('/top-bottom-gangs', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionCode = query.division_code;
            // Tanpa param scope: perilaku lama (semua gang). scope=panen: hanya gang suffix 'H'.
            const scope = ['panen','maintenance','transport','all'].includes(query.scope) ? query.scope : undefined;
            const data = await dashboardService.getTopBottomGangs(month, year, divisionCode, scope);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.Optional(t.String()),
            scope: t.Optional(t.String())
        })
    })

    .get('/gang-history', async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const gangCode = query.gang_code;

        try {
            const data = await dashboardService.getGangHistory(gangCode, month, year);
            return {
                success: true,
                data
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            gang_code: t.String()
        })
    })

    .get('/all-gangs-trend', async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const divisionCode = query.division_code;
        // Tanpa param scope: perilaku lama (semua gang). scope=panen: hanya gang suffix 'H'.
        const scope = ['panen','maintenance','transport','all'].includes(query.scope) ? query.scope : undefined;

        try {
            const data = await dashboardService.getAllGangsTrend(month, year, divisionCode, scope);
            return {
                success: true,
                data
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.Optional(t.String()),
            scope: t.Optional(t.String())
        })
    })

    .get('/tonase-analysis-report', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionCode = query.division_code;
            const data = await dashboardService.getTonaseAnalysisReport(month, year, divisionCode);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_code: t.Optional(t.String())
        })
    })

    /**
     * Cost per HK Comparison Report
     * Groups by gang type (Harvesting/Transport/Maintenance)
     */
    .get('/cost-hk-comparison', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionFilter = query.division_filter || 'ALL';
            const gangTypeFilter = query.gang_type_filter || 'ALL';

            // Parse gang_codes from comma-separated string
            let gangCodes: string[] | undefined;
            if (query.gang_codes) {
                gangCodes = query.gang_codes.split(',').filter(g => g.trim());
            }

            const data = await dashboardService.getCostHKComparison(month, year, divisionFilter, gangCodes, gangTypeFilter);
            return data;
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            division_filter: t.Optional(t.String()),
            gang_type_filter: t.Optional(t.String()),
            gang_codes: t.Optional(t.String())
        })
    })

    /**
     * Get available gangs for filter dropdown
     */
    .get('/available-gangs', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const gangs = await dashboardService.getAvailableGangs(month, year);
            return { success: true, data: gangs };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    });
