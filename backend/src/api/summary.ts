import { Elysia, t } from "elysia";
import { summaryService } from "../services/summaryService";
import { divisionDefinition } from "../services/divisionDefinition";
import { AuthService } from "../services/authService";
import { UserRole } from "../types/user";
import { Config } from "../config";
import { deductionAdjustmentService } from "../services/deductionAdjustmentService";
import { luasAreaService } from "../services/luasAreaService";
import { thumbprintService } from "../services/thumbprintService";
import { divisionOverrideService } from "../services/divisionOverrideService";
import { parseBooleanQueryParam } from "../utils/queryParsers";
import { resolveUserFromHeaders } from "../utils/authBypass";
import { chooseSummaryDefaultPeriod } from "../utils/summaryDefaultPeriod";
import { filterRowsBySummaryDivisionType, normalizeSummaryDivisionType } from "../utils/summaryReportScope";

const authService = AuthService.getInstance();
type SummaryScope = "all" | "rebinmas" | "ijl";

const SUMMARY_GROUP_LABELS: Record<string, string> = {
    P: "ESTATE PARIT GUNUNG",
    A: "ESTATE AIR RUAK",
    N: "NURSERY",
    W: "WORKSHOP (PG & AR)",
    K: "DARRUR MAKMUR ESTATE",
    I: "DIVISI INFRASTRUKTUR",
    M: "OPERASI MILL"
};

const parseSummaryScope = (value?: string): SummaryScope => {
    const normalized = (value || "").toLowerCase();
    if (normalized === "rebinmas" || normalized === "ijl") return normalized;
    return "all";
};

const isIJLDivision = (divisionCode?: string, description?: string): boolean => {
    const code = (divisionCode || "").toUpperCase();
    const desc = (description || "").toUpperCase();
    if (/^I\d/.test(code)) return true;
    if (desc.includes("IMPIAN JAYA LESTARI")) return true;
    if (desc.includes("IJL")) return true;
    if (desc.includes("ESTATE I ")) return true;
    return false;
};

const isIncludedByScope = (scope: SummaryScope, divisionCode?: string, description?: string): boolean => {
    if (scope === "all") return true;
    const ijlDivision = isIJLDivision(divisionCode, description);
    return scope === "ijl" ? ijlDivision : !ijlDivision;
};

const getGroupPrefix = (divisionCode?: string, description?: string): string => {
    const code = (divisionCode || "").toUpperCase();
    const desc = (description || "").toUpperCase();
    let prefix = (description || divisionCode || "").charAt(0).toUpperCase() || "#";
    if (code === "INF" || desc.includes("INFRA")) prefix = "I";
    if (code === "NRS" || desc.includes("NURSERY")) prefix = "N";
    if (code.startsWith("WKS") || desc.includes("WORKSHOP")) prefix = "W";
    return prefix;
};

const emptySummaryTotals = () => ({
    total_premi: 0,
    total_employees: 0,
    total_hk: 0,
    total_upah_bersih: 0,
    total_pph21: 0,
    total_spsi: 0,
    total_lembur: 0,
    total_gangs: 0,
    thumb_print: 0,
    total_manual: 0,
    selisih: 0,
    total_premi_excluding_special: 0
});

const accumulateSummaryTotals = (acc: ReturnType<typeof emptySummaryTotals>, row: any) => {
    acc.total_premi += Number(row.total_premi || 0);
    acc.total_employees += Number(row.total_employees || 0);
    acc.total_hk += Number(row.total_hk || 0);
    acc.total_upah_bersih += Number(row.total_upah_bersih || 0);
    acc.total_pph21 += Number(row.total_pph21 || 0);
    acc.total_spsi += Number(row.total_spsi || 0);
    acc.total_lembur += Number(row.total_lembur || 0);
    acc.total_gangs += Number(row.total_gangs || 0);
    acc.thumb_print += Number(row.thumb_print || 0);
    acc.total_manual += Number(row.total_manual || 0);
    acc.selisih += Number(row.selisih || 0);
    acc.total_premi_excluding_special += Number(row.total_premi_excluding_special || row.total_premi || 0);
    return acc;
};

const buildSummaryTotals = (rows: any[]) => rows.reduce(
    (acc, row) => accumulateSummaryTotals(acc, row),
    emptySummaryTotals()
);

const buildSummaryGroupSubtotals = (rows: any[]) => {
    const groups: Record<string, { key: string; label: string; totals: ReturnType<typeof emptySummaryTotals> }> = {};
    for (const row of rows) {
        const key = getGroupPrefix(row.division_code, row.description);
        if (!groups[key]) {
            groups[key] = {
                key,
                label: SUMMARY_GROUP_LABELS[key] || `ESTATE ${key}`,
                totals: emptySummaryTotals()
            };
        }
        accumulateSummaryTotals(groups[key].totals, row);
    }
    return groups;
};

const buildSummaryKpiTotals = (rows: any[]) => {
    const totals = buildSummaryTotals(rows);
    return {
        divisions: rows.length,
        workers: totals.total_employees,
        hk: totals.total_hk,
        netPay: totals.total_manual,
        gangs: totals.total_gangs
    };
};

const emptyComparisonGrandTotal = () => ({
    workers_previous: 0,
    workers_current: 0,
    total_pph21_current: 0,
    total_spsi_current: 0,
    total_premi_previous: 0,
    total_premi_current: 0,
    total_prunning_previous: 0,
    total_prunning_current: 0,
    total_brondol_previous: 0,
    total_brondol_current: 0,
    total_insentif_previous: 0,
    total_insentif_current: 0,
    total_kinerja_previous: 0,
    total_kinerja_current: 0,
    total_lembur_previous: 0,
    total_lembur_current: 0,
    prev_gaji: 0,
    prev_tbs: 0,
    prev_thumb_print: 0,
    curr_gaji: 0,
    curr_tbs: 0,
    curr_thumb_print: 0,
    selisih: 0
});

const buildComparisonGrandTotal = (rows: any[]) => rows.reduce((acc, row) => {
    acc.workers_previous += Number(row.workers_previous || 0);
    acc.workers_current += Number(row.workers_current || 0);
    acc.total_pph21_current += Number(row.total_pph21_current || 0);
    acc.total_spsi_current += Number(row.total_spsi_current || 0);
    acc.total_premi_previous += Number(row.total_premi_previous || 0);
    acc.total_premi_current += Number(row.total_premi_current || 0);
    acc.total_prunning_previous += Number(row.total_prunning_previous || 0);
    acc.total_prunning_current += Number(row.total_prunning_current || 0);
    acc.total_brondol_previous += Number(row.total_brondol_previous || 0);
    acc.total_brondol_current += Number(row.total_brondol_current || 0);
    acc.total_insentif_previous += Number(row.total_insentif_previous || 0);
    acc.total_insentif_current += Number(row.total_insentif_current || 0);
    acc.total_kinerja_previous += Number(row.total_kinerja_previous || 0);
    acc.total_kinerja_current += Number(row.total_kinerja_current || 0);
    acc.total_lembur_previous += Number(row.total_lembur_previous || 0);
    acc.total_lembur_current += Number(row.total_lembur_current || 0);
    acc.prev_gaji += Number(row.previous_month?.gaji || 0);
    acc.prev_tbs += Number(row.previous_month?.tbs_weight || 0);
    acc.prev_thumb_print += Number(row.previous_month?.thumb_print || 0);
    acc.curr_gaji += Number(row.current_month?.gaji || 0);
    acc.curr_tbs += Number(row.current_month?.tbs_weight || 0);
    acc.curr_thumb_print += Number(row.current_month?.thumb_print || 0);
    acc.selisih += Number(row.selisih || 0);
    return acc;
}, emptyComparisonGrandTotal());

const buildComparisonKpiSummary = (rows: any[]) => {
    const estateRows = rows.filter((r) => (r.division_code || "").toUpperCase() !== "MILL");
    const millRows = rows.filter((r) => (r.division_code || "").toUpperCase() === "MILL");
    const sum = (targetRows: any[], selector: (row: any) => number) =>
        targetRows.reduce((acc, row) => acc + selector(row), 0);

    return {
        estate_gaji: {
            current: sum(estateRows, (row) => Number(row.current_month?.gaji || 0)),
            previous: sum(estateRows, (row) => Number(row.previous_month?.gaji || 0))
        },
        mill_gaji: {
            current: sum(millRows, (row) => Number(row.current_month?.gaji || 0)),
            previous: sum(millRows, (row) => Number(row.previous_month?.gaji || 0))
        },
        tbs_weight: {
            current: sum(rows, (row) => Number(row.current_month?.tbs_weight || 0)),
            previous: sum(rows, (row) => Number(row.previous_month?.tbs_weight || 0))
        },
        total_premi: {
            current: sum(rows, (row) => Number(row.total_premi_current || 0)),
            previous: sum(rows, (row) => Number(row.total_premi_previous || 0))
        },
        total_lembur: {
            current: sum(rows, (row) => Number(row.total_lembur_current || 0)),
            previous: sum(rows, (row) => Number(row.total_lembur_previous || 0))
        }
    };
};

const buildComparisonPremiBreakdownCurrent = (rows: any[]) => ({
    total_prunning_previous: rows.reduce((acc, row) => acc + Number(row.total_prunning_previous || 0), 0),
    total_prunning_current: rows.reduce((acc, row) => acc + Number(row.total_prunning_current || 0), 0),
    total_brondol_previous: rows.reduce((acc, row) => acc + Number(row.total_brondol_previous || 0), 0),
    total_brondol_current: rows.reduce((acc, row) => acc + Number(row.total_brondol_current || 0), 0),
    total_insentif_previous: rows.reduce((acc, row) => acc + Number(row.total_insentif_previous || 0), 0),
    total_insentif_current: rows.reduce((acc, row) => acc + Number(row.total_insentif_current || 0), 0),
    total_kinerja_previous: rows.reduce((acc, row) => acc + Number(row.total_kinerja_previous || 0), 0),
    total_kinerja_current: rows.reduce((acc, row) => acc + Number(row.total_kinerja_current || 0), 0)
});

export const summaryRoutes = new Elysia({ prefix: "/payroll/summary" })
    .derive(async ({ headers }) => {
        const user = await resolveUserFromHeaders(headers, authService);
        return { user };
    })
    .onBeforeHandle(({ user, set }) => {
        if (!user) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
    })
    // --- Access Check ---
    .get("/access-check", async ({ user }) => {
        return {
            success: true,
            can_access_reports: true,
            is_proxy_mode: Config.USE_PROXY,
            is_admin: user?.role === UserRole.ADMIN,
            auth_mode: Config.AUTH_MODE
        };
    })
    // --- Periods ---
    .get("/periods", async ({ query }) => {
        const periods = await summaryService.getAvailablePeriods(query.division);
        const currentPeriod = await summaryService.getLatestBaseDataPeriod();
        const defaultPeriod = chooseSummaryDefaultPeriod(periods, currentPeriod);
        return { success: true, count: periods.length, periods, default_period: defaultPeriod };
    }, {
        query: t.Object({
            division: t.Optional(t.String())
        })
    })
    // --- Divisions ---
    .get("/divisions", async () => {
        // UPDATED: Include virtual divisions by default for comprehensive reporting
        const divisions = await summaryService.getDivisionsFromHrGang(true);
        return { success: true, count: divisions.length, divisions };
    })
    // --- Virtual Divisions ---
    .get("/virtual-divisions", async () => {
        // Get only virtual divisions for separate dropdown
        const allDivisions = await summaryService.getDivisionsFromHrGang(true);
        const realDivisions = await summaryService.getDivisionsFromHrGang(false);
        const virtualDivisions = allDivisions.filter(d => !realDivisions.includes(d));
        return { success: true, count: virtualDivisions.length, divisions: virtualDivisions };
    })
    // --- Gangs by LocCode ---
    .get("/gangs/:loc_code", async ({ params }) => {
        const gangs = await divisionDefinition.getGangsForDivision(params.loc_code);
        return { success: true, loc_code: params.loc_code, count: gangs.length, gangs };
    })
    // --- Health ---
    .get("/health", () => ({
        success: true,
        database: "extend_db_ptrj",
        message: "Connection OK"
    }))
    // --- All Divisions Summary ---
    .get("/all-divisions", async ({ query, set }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const useHistory = parseBooleanQueryParam(query.use_history) ?? false;
        const divisionType = normalizeSummaryDivisionType(query.division_type);
        const includeVirtual = divisionType === "virtual"
            ? true
            : divisionType === "real"
                ? false
                : query.include_virtual === 'true'; // Optional parameter to include virtual divisions
        const scope = parseSummaryScope(query.scope);

        try {
            summaryService.setUseHistoryDb(useHistory);
            // ⚠️ OPTIMIZED: Summary Report ALWAYS uses extend_db_ptrj (SERVER_PROFILE_1)
            // includeVirtual controls whether virtual divisions (INF, NRS, WKS_PG, WKS_AR, ARC, MILL) are included
            const data = await summaryService.getAllDivisionsPremiTotals(month, year, includeVirtual);
            const leafRows = data.filter(row => !row.is_subtotal && !row.is_grand_total);
            const scopedByCompanyRows = leafRows.filter(row => isIncludedByScope(scope, row.division_code, row.description));
            const scopedRows = filterRowsBySummaryDivisionType(scopedByCompanyRows, divisionType);
            const grandTotal = buildSummaryTotals(scopedRows);
            const grandTotalLabel = scope === "ijl" ? "GRAND TOTAL (IJL)" : scope === "rebinmas" ? "GRAND TOTAL (REBINMAS)" : "GRAND TOTAL";

            return {
                success: true,
                month,
                year,
                scope,
                division_type: divisionType,
                use_history: useHistory,
                count: scopedRows.length,
                data: scopedRows,
                kpi_totals: buildSummaryKpiTotals(scopedRows),
                group_subtotals: buildSummaryGroupSubtotals(scopedRows),
                grand_total: {
                    description: grandTotalLabel,
                    ...grandTotal,
                    is_grand_total: true
                }
            };
        } catch (error: any) {
            console.error("[SummaryRoutes] Error in all-divisions report:", error);
            console.error("[SummaryRoutes] Error details:", {
                message: error.message,
                stack: error.stack?.substring(0, 500),
                month,
                year,
                includeVirtual
            });
            set.status = 500;
            return { 
                success: false, 
                error: error.message || "Failed to fetch all divisions summary",
                details: process.env.RUN_MODE === 'dev' ? error.stack : undefined
            };
        } finally {
            summaryService.setUseHistoryDb(false);
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            use_history: t.Optional(t.String()),
            include_virtual: t.Optional(t.String()), // Set to 'true' to include virtual divisions
            scope: t.Optional(t.String()),
            division_type: t.Optional(t.String())
        })
    })
    // --- Division Detail Summary ---
    .get("/division", async ({ query }) => {
        const { division, month, year } = query;
        const useHistory = parseBooleanQueryParam(query.use_history) ?? false;
        const includeVirtual = query.include_virtual === 'true'; // Support virtual divisions

        try {
            summaryService.setUseHistoryDb(useHistory);
            // Allow empty division for "ALL" - remove the requirement
            const result = await summaryService.getDivisionSummary(
                division || undefined,
                month ? parseInt(month) : undefined,
                year ? parseInt(year) : undefined,
                includeVirtual // Pass includeVirtual flag
            );
            return {
                success: true,
                count: result.data.length,
                data: result.data,
                grand_total: result.grand_total,
                comparison_total: result.comparison_total,
                filtered_headers: result.filtered_headers
            };
        } finally {
            summaryService.setUseHistoryDb(false);
        }
    }, {
        query: t.Object({
            division: t.Optional(t.String()),
            month: t.Optional(t.String()),
            year: t.Optional(t.String()),
            use_history: t.Optional(t.String()),
            include_virtual: t.Optional(t.String()) // Set to 'true' to include virtual divisions
        })
    })
    // --- Comparison Report ---
    .get("/comparison", async ({ query, set }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const useHistory = parseBooleanQueryParam(query.use_history) ?? false;
        const scope = parseSummaryScope(query.scope);
        const divisionType = normalizeSummaryDivisionType(query.division_type);

        try {
            summaryService.setUseHistoryDb(useHistory);
            const result = await summaryService.getAllDivisionsComparison(month, year);
            const scopedByCompanyDivisions = (result.divisions || []).filter((row: any) =>
                isIncludedByScope(scope, row.division_code, row.description)
            );
            const scopedDivisions = filterRowsBySummaryDivisionType(scopedByCompanyDivisions, divisionType);
            return {
                success: true,
                ...result,
                scope,
                division_type: divisionType,
                count: scopedDivisions.length,
                divisions: scopedDivisions,
                kpi_summary: buildComparisonKpiSummary(scopedDivisions),
                grand_total: buildComparisonGrandTotal(scopedDivisions),
                premi_breakdown_current: buildComparisonPremiBreakdownCurrent(scopedDivisions)
            };
        } catch (error: any) {
            console.error("[SummaryRoutes] Error in comparison report:", error);
            console.error("[SummaryRoutes] Error details:", {
                message: error.message,
                stack: error.stack?.substring(0, 500),
                month,
                year
            });
            set.status = 500;
            return { 
                success: false, 
                error: error.message || "Failed to fetch comparison report",
                details: process.env.RUN_MODE === 'dev' ? error.stack : undefined
            };
        } finally {
            summaryService.setUseHistoryDb(false);
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            use_history: t.Optional(t.String()),
            scope: t.Optional(t.String()),
            division_type: t.Optional(t.String())
        })
    })
    // --- Impact Report ---
    .get("/impact-report", async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const useHistory = parseBooleanQueryParam(query.use_history) ?? false;

        try {
            summaryService.setUseHistoryDb(useHistory);
            const result = await summaryService.getImpactReportData(month, year);
            return result;
        } finally {
            summaryService.setUseHistoryDb(false);
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            use_history: t.Optional(t.String())
        })
    })
    // --- Analysis Report ---
    .get("/analysis-report", async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const useHistory = parseBooleanQueryParam(query.use_history) ?? false;

        try {
            summaryService.setUseHistoryDb(useHistory);
            const result = await summaryService.getAnalysisReportData(month, year, query.type);
            return result;
        } finally {
            summaryService.setUseHistoryDb(false);
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            type: t.Optional(t.String()),
            use_history: t.Optional(t.String())
        })
    })
    // --- Mill PKS Totals ---
    .get("/mill-totals", async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const result = await summaryService.getMillTotals(month, year);
        return result;
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })
    // --- Division Descriptions ---
    .get("/division-descriptions", async () => {
        const descriptions = await summaryService.getDivisionDescriptionsMap();
        return { success: true, descriptions };
    })
    // --- Gang Descriptions (Real-time from HR_GANG + Divisi_Description) ---
    .get("/gang-descriptions", async () => {
        const descriptions = await summaryService.getAllGangDescriptions();
        return { success: true, descriptions };
    })
    // --- Premi Headers for Division ---
    .get("/premi-headers/:loc_code", async ({ params, query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const headers = await summaryService.getPremiHeadersForDivision(params.loc_code, month, year);
        return {
            success: true,
            loc_code: params.loc_code,
            month,
            year,
            count: headers.length,
            headers
        };
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })
    // --- Update Thumbprint Data ---
    .post("/thumbprint", async ({ body }) => {
        const { month, year, division_code, value } = body;

        // Ensure thumbprintService is available (imported from service, ideally should be exported via summaryService or used directly)
        // Since we didn't export it in summaryService, we'll import it here.
        // Assuming we add the import at the top of this file.
        const success = await summaryService.updateThumbprint(month, year, division_code, value);
        return { success };
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            division_code: t.String(),
            value: t.Number()
        })
    })
    // --- Get Available Thumbprint Months ---
    .get("/thumbprint-months", async () => {
        const months = await thumbprintService.getAvailableMonths();
        return { success: true, months };
    })
    // --- Get Thumbprint Comparison ---
    .get("/thumbprint-comparison", async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const comparison = await thumbprintService.getThumbprintComparison(month, year);
        return { success: true, ...comparison };
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })
    // --- Update PPH21 Adjustment ---
    .post("/update-pph21", async ({ body }) => {
        const { month, year, division_code, value } = body;
        const success = await deductionAdjustmentService.updatePPH21(month, year, division_code, value);
        return { success };
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            division_code: t.String(),
            value: t.Number()
        })
    })
    // --- Update SPSI Adjustment ---
    .post("/update-spsi", async ({ body }) => {
        const { month, year, division_code, value } = body;
        const success = await deductionAdjustmentService.updateSPSI(month, year, division_code, value);
        return { success };
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            division_code: t.String(),
            value: t.Number()
        })
    })
    // --- Update Both Deductions at Once ---
    .post("/update-deductions", async ({ body }) => {
        const { month, year, division_code, pph21, spsi } = body;
        const success = await deductionAdjustmentService.updateDeductions(month, year, division_code, pph21, spsi);
        return { success };
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            division_code: t.String(),
            pph21: t.Number(),
            spsi: t.Number()
        })
    })
    // --- Get Deduction Adjustments for Period ---
    .get("/deduction-adjustments", async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const adjustments = await deductionAdjustmentService.getAdjustmentData(month, year);
        return { success: true, adjustments };
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })
    // --- Update Luas Area Adjustment ---
    .post("/update-luas-area", async ({ body }) => {
        const { month, year, division_code, value } = body;
        const success = await luasAreaService.updateLuasArea(month, year, division_code, value);
        return { success };
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            division_code: t.String(),
            value: t.Number()
        })
    })
    // --- Get Luas Area Adjustments for Period ---
    .get("/luas-area-adjustments", async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const adjustments = await luasAreaService.getLuasAreaData(month, year);
        return { success: true, adjustments };
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })
    // --- Update Gang-Level Summary Cell ---
    .post("/update-gang", async ({ body }) => {
        const { month, year, gang_code, field, value } = body;
        try {
            const success = await summaryService.updateGangCell(month, year, gang_code, field, value);
            return { success, message: 'Cell updated successfully' };
        } catch (error: any) {
            return { success: false, error: error.message || 'Failed to update cell' };
        }
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            gang_code: t.String(),
            field: t.String(),
            value: t.Number()
        })
    })
    // --- Update Division-Level Summary Cell ---
    .post("/update-division-cell", async ({ body }) => {
        const { month, year, division_code, field, value } = body;
        try {
            const allowedFields = [
                'total_upah_bersih',
                'total_premi',
                'total_lembur',
                'total_pph21',
                'total_spsi',
                'total_employees',
                'total_hk'
            ];
            if (!allowedFields.includes(field)) {
                return { success: false, error: `Invalid field: ${field}` };
            }
            const success = await divisionOverrideService.updateOverride(month, year, division_code, field, value);
            return { success, message: 'Division override saved' };
        } catch (error: any) {
            return { success: false, error: error.message || 'Failed to update division cell' };
        }
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            division_code: t.String(),
            field: t.String(),
            value: t.Number()
        })
    })
    // --- Detailed Gang Analysis ---
    .get("/gang-analysis-detail", async ({ query }) => {
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const gangCode = query.gang_code;

        if (!gangCode) {
            return { success: false, error: "gang_code is required" };
        }

        const result = await summaryService.getGangDetailedAnalysis(gangCode, month, year);
        return result;
    }, {
        query: t.Object({
            gang_code: t.String(),
            month: t.String(),
            year: t.String()
        })
    });
