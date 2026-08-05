import { Elysia, t } from "elysia";
import { dashboardService } from "../services/dashboardService";

export const dashboardRoutes = new Elysia({ prefix: "/payroll/dashboard" })
    .get("/executive-summary", async ({ query, set }) => {
        try {
            const month = query.month ? parseInt(query.month) : new Date().getMonth() + 1;
            const year = query.year ? parseInt(query.year) : new Date().getFullYear();

            const trends = await dashboardService.getPayrollTrend(month, year);
            const breakdown = await dashboardService.getDivisionBreakdown(month, year);
            const gangBreakdown = await dashboardService.getGangBreakdown(month, year);
            const efficiency = await dashboardService.getDivisionEfficiency(month, year);

            const productivityTrend = await dashboardService.getProductivityTrend(month, year);
            const wageSpikes = await dashboardService.getWageSpikes(month, year);

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
                    kpi
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
            year: t.String()
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
            const data = await dashboardService.getGangComparison(month, year, divisionCode);
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
    .get('/top-bottom-gangs', async ({ query, set }) => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const divisionCode = query.division_code;
            const data = await dashboardService.getTopBottomGangs(month, year, divisionCode);
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

        try {
            const data = await dashboardService.getAllGangsTrend(month, year, divisionCode);
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
            division_code: t.Optional(t.String())
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
