import { Database } from "../db/client";
import { Config } from "../config";
import { Elysia, t } from "elysia";
import { gangService } from "../services/gangService";
import { headerService } from "../services/headerService";
import { payrollService } from "../services/payrollService";
import { AuthService } from "../services/authService";
import { currentPeriodService } from "../services/currentPeriodService";
import { taxReportService } from "../services/taxReportService";
import { divisionConfigService } from "../services/config/DivisionConfigService";
import { dataExtractorService } from "../services/dataExtractorService";
import { User, UserRole } from "../types/user";
import { parseBooleanQueryParam, parsePositiveIntegerQueryParam } from "../utils/queryParsers";
import { hasValidApiKeyBypass, resolveUserFromHeaders } from "../utils/authBypass";
import { sortByEmpCode } from "../utils/employeeSort";
import { AUTO_BUFFER_ADCODE_BY_ADJUSTMENT_NAME } from "../services/payroll/manualAdjustments/autoBufferAdcodeMap";


const authService = AuthService.getInstance();

/**
 * [PERFORMANCE] Strip heavy per-row array fields before sending JSON to browser.
 * Fields like shortage_details[], excess_details[], other_incomes[] are not needed
 * by the summary table but can make JSON 5-20x larger → browser "Aw, Snap!" crash.
 *
 * Notes on kept fields:
 * - has_shortage / has_excess: boolean flags, needed by table cell renderer for coloring
 * - shortage_total_hours / excess_total_hours: summary totals, needed for tooltip summary
 * - shortage_details[] / excess_details[]: REMOVED — detail arrays, not used in table view
 */
function slimEmployee(emp: any): any {
    const { shortage_details, excess_details, other_incomes, lembur_records, ...rest } = emp;
    return rest;
}

function sortedSlimStreamEmployees(employees: readonly any[]): any[] {
    return sortByEmpCode(employees).map((emp: any) => {
        const { _phase, _enriched, _loading, ...rest } = emp;
        return slimEmployee(rest);
    });
}

// Helper to get user from header
async function getUserFromHeader(headers: Record<string, string | undefined>): Promise<User | null> {
    return resolveUserFromHeaders(headers, authService, { allowSystemToken: true });
}

const ADJUSTMENT_NAME_OPTION_TYPES = ["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH"] as const;
type AdjustmentNameOptionType = typeof ADJUSTMENT_NAME_OPTION_TYPES[number];
const AUTO_BUFFER_SEED_ENDPOINT_ADJUSTMENTS = Object.entries(AUTO_BUFFER_ADCODE_BY_ADJUSTMENT_NAME).map(([adjustmentName, adDesc]) => ({
    adjustment_name: adjustmentName,
    ad_code: adDesc,
    ad_desc: adDesc,
    task_desc: adDesc,
    amount_source: adjustmentName === "POTONGAN PPH" ? "pph21_ter" : undefined,
    comparison_source: adjustmentName === "POTONGAN PPH" ? "pot_pph21" : undefined
}));

function buildAutoBufferSeedEndpointResponse(result: any) {
    return {
        success: true,
        message: "Auto buffer berhasil disimpan ke payroll_manual_adjustments (AUTO_BUFFER): TUNJANGAN JABATAN, MASA KERJA, SPSI, POTONGAN PPH",
        auto_buffer_items_per_employee: AUTO_BUFFER_SEED_ENDPOINT_ADJUSTMENTS.length,
        auto_buffer_adjustments: AUTO_BUFFER_SEED_ENDPOINT_ADJUSTMENTS,
        data: result
    };
}

function parseAdjustmentNameOptionTypes(value?: string): { types: AdjustmentNameOptionType[]; invalid: string[] } {
    const aliases: Record<string, AdjustmentNameOptionType> = {
        PREMI: "PREMI",
        KOREKSI: "POTONGAN_KOTOR",
        POTONGAN_KOTOR: "POTONGAN_KOTOR",
        POTONGAN_UPAH_KOTOR: "POTONGAN_KOTOR",
        POTONGAN_BERSIH: "POTONGAN_BERSIH",
        POTONGAN_UPAH_BERSIH: "POTONGAN_BERSIH"
    };
    const rawTypes = String(value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
    if (rawTypes.length === 0) return { types: [...ADJUSTMENT_NAME_OPTION_TYPES], invalid: [] };

    const invalid: string[] = [];
    const types: AdjustmentNameOptionType[] = [];
    for (const rawType of rawTypes) {
        const resolved = aliases[rawType];
        if (!resolved) {
            invalid.push(rawType);
            continue;
        }
        if (!types.includes(resolved)) types.push(resolved);
    }

    return { types, invalid };
}

function parseStringArrayInput(value: unknown): string[] {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    return values
        .flatMap((item) => String(item || "").split(","))
        .map((item) => item.trim())
        .filter(Boolean);
}

const ADTRANS_DOC_IDS_BODY_SCHEMA = t.Object({
    period_month: t.Number(),
    period_year: t.Number(),
    emp_codes: t.Optional(t.Array(t.String())),
    filters: t.Optional(t.Array(t.String())),
    adjustment_type: t.Optional(t.Union([t.String(), t.Array(t.String())])),
    adjustment_types: t.Optional(t.Array(t.String())),
    adjustment_name: t.Optional(t.Union([t.String(), t.Array(t.String())])),
    adjustment_names: t.Optional(t.Array(t.String())),
    doc_desc: t.Optional(t.Union([t.String(), t.Array(t.String())])),
    doc_descs: t.Optional(t.Array(t.String())),
    division_code: t.Optional(t.String()),
    gang_code: t.Optional(t.String())
});

async function handleAdtransDocIdsByApiKey({ body, headers, set }: {
    body: unknown;
    headers: Record<string, string | undefined>;
    set: any;
}) {
    try {
        const apiKey = headers["x-api-key"];
        if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
            set.status = 401;
            return { success: false, message: "Unauthorized - Invalid API Key" };
        }

        const data = body as any;
        const { period_month, period_year, emp_codes = [], division_code, gang_code } = data;
        const filters = parseStringArrayInput(data.filters);
        const adjustmentTypes = [
            ...parseStringArrayInput(data.adjustment_type),
            ...parseStringArrayInput(data.adjustment_types)
        ];
        const adjustmentNames = [
            ...parseStringArrayInput(data.adjustment_name),
            ...parseStringArrayInput(data.adjustment_names)
        ];
        const docDescs = [
            ...parseStringArrayInput(data.doc_desc),
            ...parseStringArrayInput(data.doc_descs)
        ];

        if (!period_month || !period_year) {
            set.status = 400;
            return { success: false, message: "period_month and period_year are required" };
        }

        if ((!Array.isArray(emp_codes) || emp_codes.length === 0) && !division_code && !gang_code) {
            set.status = 400;
            return { success: false, message: "emp_codes array, division_code, or gang_code is required" };
        }

        if (filters.length === 0 && adjustmentTypes.length === 0 && adjustmentNames.length === 0 && docDescs.length === 0) {
            set.status = 400;
            return { success: false, message: "filters, adjustment_type, adjustment_name, or doc_desc is required" };
        }

        const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
        const docIds = await manualAdjustmentService.listAdtransDocIds({
            periodMonth: Number(period_month),
            periodYear: Number(period_year),
            empCodes: emp_codes,
            filters,
            divisionCode: division_code,
            gangCode: gang_code,
            adjustmentTypes,
            adjustmentNames,
            docDescs
        });

        return {
            success: true,
            count: docIds.length,
            doc_ids: docIds
        };
    } catch (e: any) {
        console.error("[PayrollRoutes] manual-adjustment/adtrans-doc-ids error:", e);
        set.status = 500;
        return { success: false, message: e.message || "Internal server error" };
    }
}

export const payrollRoutes = new Elysia({ prefix: "/payroll" })
    .derive(async ({ headers }) => {
        try {
            const user = await getUserFromHeader(headers);
            return { currentUser: user };
        } catch (e) {
            console.error("[PayrollRoutes] Derive error:", e);
            return { currentUser: null };
        }
    })
    .onBeforeHandle(({ currentUser, set }) => {
        if (!currentUser) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
    })
    // --- Divisions ---
    .get("/divisions", async ({ currentUser }): Promise<any> => {
        if (currentUser) {
            return authService.getAccessibleDivisions(currentUser);
        }
        // Exclude virtual divisions - they are derived at read time from real divisions
        const divisions = await gangService.getAllDivisions(false);
        return divisions;
    })
    .get("/subdivisions", async ({ set }) => {
        try {
            const subDivisions: any[] = [];
            return subDivisions;
        } catch (e) {
            set.status = 500;
            return { message: "Failed to fetch sub-divisions" };
        }
    })
    // --- Current Period ---
    .get("/current-period", async ({ set }) => {
        try {
            const period = await currentPeriodService.getCurrentPeriod();
            return period;
        } catch (e: any) {
            set.status = 500;
            return { message: `Failed to get current period: ${e.message}` };
        }
    })
    // --- Gangs ---
    .get("/gangs", async ({ query, currentUser, set }): Promise<any> => {
        try {
            const division = query.division === "ALL" ? undefined : query.division;
            const search = query.search || undefined;

            // Permission check
            if (currentUser && (currentUser.role !== UserRole.ADMIN)) {
                if (division && !currentUser.divisions.includes(division)) {
                    set.status = 403;
                    return { message: "Division not accessible" };
                }
            }

            const gangs = await gangService.fetchGangs(division, search);
            return gangs;
        } catch (e: any) {
            set.status = 500;
            return { message: `Failed to fetch gangs: ${e.message}` };
        }
    }, {
        query: t.Object({
            division: t.Optional(t.String()),
            search: t.Optional(t.String()),
            force: t.Optional(t.String())
        })
    })
    .get("/gangs/by-loc", async ({ query, set }) => {
        try {
            const codes = await gangService.fetchGangsByLocCode(query.loc_code);
            if (codes.length === 0) {
                set.status = 404;
                return { message: `No gangs found for locCode ${query.loc_code}` };
            }
            return codes;
        } catch (e: any) {
            set.status = 500;
            return { message: `Failed to fetch gangs by locCode: ${e.message}` };
        }
    }, {
        query: t.Object({
            loc_code: t.String(),
            force: t.Optional(t.String())
        })
    })
    .get("/gang/:gang_code/info", async ({ params, set }) => {
        try {
            const info = await gangService.getGangInfo(params.gang_code);
            return info;
        } catch (e: any) {
            set.status = 500;
            return { message: `Failed to get gang info: ${e.message}` };
        }
    })
    // --- Headers (Full Implementation) ---
    .get("/headers", async ({ query, set }) => {
        try {
            const month = query.month ? parseInt(query.month) : undefined;
            const year = query.year ? parseInt(query.year) : undefined;
            const gangCode = query.gang_code || undefined;

            const result = await headerService.generateDynamicHeaders(month, year, gangCode);
            return result;
        } catch (e: any) {
            set.status = 500;
            return { message: `Failed to generate headers: ${e.message}` };
        }
    }, {
        query: t.Object({
            month: t.Optional(t.String()),
            year: t.Optional(t.String()),
            gang_code: t.Optional(t.String())
        })
    })
    // --- Columns (Full Implementation) ---
    .get("/columns", async ({ query, set }): Promise<any> => {
        try {
            const month = query.month ? parseInt(query.month) : undefined;
            const year = query.year ? parseInt(query.year) : undefined;
            const gangCode = query.gang_code || undefined;

            const columns = await headerService.getColumnDefinitions(month, year, gangCode);
            return columns;
        } catch (e: any) {
            set.status = 500;
            return { message: `Failed to generate column definitions: ${e.message}` };
        }
    }, {
        query: t.Object({
            month: t.Optional(t.String()),
            year: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            fallback: t.Optional(t.String())
        })
    })
    // --- Calculate (using PayrollService) ---
    .post("/calculate", async ({ body }) => {
        const { upah_dasar, hk_count, allowances, deductions } = body as any;

        const result = payrollService.calculate(upah_dasar, hk_count, allowances || {}, deductions || {});
        return result;
    }, {
        body: t.Object({
            upah_dasar: t.Number(),
            hk_count: t.Number(),
            allowances: t.Optional(t.Record(t.String(), t.Number())),
            deductions: t.Optional(t.Record(t.String(), t.Number()))
        })
    })
    // --- Manual Adjustment TaskCode Options ---
    .get("/manual-adjustment/taskcode-options", async ({ query, set }) => {
        try {
            const { taskCodeOptionService } = await import("../services/taskCodeOptionService");
            const data = await taskCodeOptionService.searchOptions({
                search: query.search || undefined,
                divisionCode: query.division_code || undefined,
                limit: query.limit ? Number(query.limit) : undefined
            });

            return { success: true, count: data.length, data };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/taskcode-options error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            search: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            limit: t.Optional(t.String())
        })
    })
    .get("/manual-adjustment/automation-options/by-api-key", async ({ query, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"] || headers["X-API-Key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, error: "Invalid API key" };
            }

            const { taskCodeOptionService } = await import("../services/taskCodeOptionService");
            const data = await taskCodeOptionService.searchAutomationAdjustmentOptions({
                search: query.search || undefined,
                divisionCode: query.division_code || undefined,
                limit: query.limit ? Number(query.limit) : undefined,
                categories: query.categories ? String(query.categories).split(",") : undefined
            });

            return { success: true, count: data.length, data };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/automation-options/by-api-key error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            search: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            categories: t.Optional(t.String())
        })
    })
    .get("/manual-adjustment/adjustment-name-options/by-api-key", async ({ query, headers, set }) => {
        try {
            if (!hasValidApiKeyBypass(headers as Record<string, string | undefined>)) {
                set.status = 401;
                return { success: false, error: "Unauthorized: invalid x-api-key" };
            }

            const parsedTypes = parseAdjustmentNameOptionTypes(query.adjustment_type || query.adjustment_types);
            if (parsedTypes.invalid.length > 0) {
                set.status = 400;
                return {
                    success: false,
                    error: `adjustment_type tidak valid: ${parsedTypes.invalid.join(", ")}`,
                    allowed_adjustment_types: [...ADJUSTMENT_NAME_OPTION_TYPES]
                };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const metadataOnly = ["1", "true", "yes", "metadata"].includes(String(query.metadata_only || query.has_metadata || "").trim().toLowerCase());
            const data = await manualAdjustmentService.listAdjustmentNameOptions({
                periodMonth: query.period_month ? Number(query.period_month) : undefined,
                periodYear: query.period_year ? Number(query.period_year) : undefined,
                search: query.search || undefined,
                divisionCode: query.division_code || query.estate || undefined,
                gangCode: query.gang_code || undefined,
                limit: query.limit ? Number(query.limit) : undefined,
                adjustmentTypes: parsedTypes.types,
                metadataOnly
            });
            const byType = Object.fromEntries(parsedTypes.types.map((type) => [
                type,
                data.filter((option) => option.adjustment_type === type)
            ]));
            const adjustmentNamesByType = Object.fromEntries(parsedTypes.types.map((type) => [
                type,
                Array.from(new Set(data
                    .filter((option) => option.adjustment_type === type)
                    .map((option) => option.adjustment_name)))
            ]));

            return {
                success: true,
                count: data.length,
                adjustment_types: parsedTypes.types,
                by_type: byType,
                adjustment_names_by_type: adjustmentNamesByType,
                data
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/adjustment-name-options/by-api-key error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            adjustment_type: t.Optional(t.String()),
            adjustment_types: t.Optional(t.String()),
            period_month: t.Optional(t.String()),
            period_year: t.Optional(t.String()),
            search: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            estate: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            metadata_only: t.Optional(t.String()),
            has_metadata: t.Optional(t.String()),
            limit: t.Optional(t.String())
        })
    })
    // --- Manual Adjustment Presets ---
    .get("/manual-adjustment-presets", async ({ query, set }) => {
        try {
            const { manualAdjustmentPresetService } = await import("../services/manualAdjustmentPresetService");
            const data = await manualAdjustmentPresetService.listPresets({
                adjustmentType: query.adjustment_type || undefined,
                search: query.search || undefined,
                divisionCode: query.division_code || undefined,
                includeInactive: parseBooleanQueryParam(query.include_inactive)
            });

            return { success: true, count: data.length, data };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment-presets GET error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            adjustment_type: t.Optional(t.String()),
            search: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            include_inactive: t.Optional(t.String())
        })
    })
    .post("/manual-adjustment-presets", async ({ body, currentUser, set }) => {
        try {
            const { manualAdjustmentPresetService } = await import("../services/manualAdjustmentPresetService");
            const { resolveManualAdjustmentPresetMapping } = await import("../services/manualAdjustmentService");
            const input = body as any;
            const mappedFields = await resolveManualAdjustmentPresetMapping(input, input.adjustment_name);
            const presetInput = { ...input, ...mappedFields };
            const id = await manualAdjustmentPresetService.upsertPreset(presetInput, currentUser?.username || "system");
            return { success: true, id, message: "Manual adjustment preset saved successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment-presets POST error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            adjustment_type: t.String(),
            adjustment_name: t.String(),
            ad_code: t.Optional(t.String()),
            task_code: t.Optional(t.String()),
            base_task_code: t.Optional(t.String()),
            task_desc: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            remarks_template: t.Optional(t.String())
        })
    })
    .post("/manual-adjustment-presets/infer", async ({ body, set }) => {
        try {
            const {
                inferManualAdjustmentAdCodeFromRemarks,
                normalizeManualAdjustmentPresetName
            } = await import("../utils/manualAdjustmentRemarkParser");
            const data = body as any;
            return {
                success: true,
                adjustment_name: normalizeManualAdjustmentPresetName(data.remarks),
                ...inferManualAdjustmentAdCodeFromRemarks(data.remarks)
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment-presets infer error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            remarks: t.String()
        })
    })
    .delete("/manual-adjustment-presets/:id", async ({ params, currentUser, set }) => {
        try {
            const id = Number(params.id);
            if (!Number.isInteger(id) || id <= 0) {
                set.status = 400;
                return { success: false, error: "id tidak valid" };
            }

            const { manualAdjustmentPresetService } = await import("../services/manualAdjustmentPresetService");
            await manualAdjustmentPresetService.deletePreset(id, currentUser?.username || "system");
            return { success: true, message: "Manual adjustment preset deleted successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment-presets DELETE error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() })
    })
    // --- Save Manual Edit ---
    .post("/manual-edit", async ({ body, currentUser, set }) => {
        try {
            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            const data = body as any;
            console.log(`[manual-edit] Incoming payload:`, JSON.stringify({
                period_month: data.period_month,
                period_year: data.period_year,
                nik: data.nik,
                emp_code: data.emp_code,
                emp_name: data.emp_name,
                gang_code: data.gang_code,
                adjustment_type: data.adjustment_type,
                adjustment_name: data.adjustment_name,
                amount: data.amount
            }));

            const username = currentUser?.username || 'system';
            const resultId = await manualAdjustmentService.saveAdjustment(data, username);

            // Always clear cache after save to ensure fresh data on next load
            // Use suffix matching because keys format is payroll_data:{gangCode}:{month}:{year}
            const pattern = `:${data.period_month}:${data.period_year}`;
            cacheService.clearByPattern(pattern);
            console.log(`[PayrollRoutes] Cleared cache for pattern: ${pattern} after manual edit`);

            return { success: true, id: resultId, message: "Manual adjustment saved successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-edit error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            nik: t.Optional(t.String()),  // Real NIK (KTP) - for PENDAPATAN_LAINNYA
            emp_code: t.String(),
            emp_name: t.Optional(t.String()),
            gang_code: t.String(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(), // PREMI, POTONGAN_KOTOR, POTONGAN_BERSIH, PENDAPATAN_LAINNYA
            adjustment_name: t.String(),
            amount: t.Number(),
            remarks: t.Optional(t.String()),
            metadata_json: t.Optional(t.String()),
            ad_code: t.Optional(t.String()),
            task_code: t.Optional(t.String()),
            base_task_code: t.Optional(t.String()),
            task_desc: t.Optional(t.String())
        })
    })
    // --- Manual Adjustment for authenticated UI ---
    .get("/manual-adjustment", async ({ query, set }) => {
        try {
            const periodMonth = Number(query.period_month);
            const periodYear = Number(query.period_year);

            if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
                set.status = 400;
                return { success: false, error: "period_month harus 1-12" };
            }

            if (!Number.isInteger(periodYear) || periodYear < 2000) {
                set.status = 400;
                return { success: false, error: "period_year tidak valid" };
            }

            const {
                manualAdjustmentService
            } = await import("../services/manualAdjustmentService");
            const metadataOnly = ["1", "true", "yes", "metadata"].includes(String(query.metadata_only || query.has_metadata || "").trim().toLowerCase());
            // ponytail: recompute_sync default true (real-time vs ADTRANS). Set =0/false untuk legacy baked-remarks path.
            const recomputeSync = !["0", "false", "no", "off"].includes(String(query.recompute_sync || "").trim().toLowerCase());

            if (recomputeSync) {
                const apiRows = await manualAdjustmentService.getAdjustmentsWithSyncRecompute(
                    periodMonth,
                    periodYear,
                    query.gang_code || undefined,
                    query.emp_code || undefined,
                    query.division_code || undefined,
                    query.adjustment_type || undefined,
                    query.adjustment_name || undefined,
                    metadataOnly
                );
                return { success: true, count: apiRows.length, data: apiRows };
            }

            const rows = await manualAdjustmentService.getAdjustments(
                periodMonth,
                periodYear,
                query.gang_code || undefined,
                query.emp_code || undefined,
                query.division_code || undefined,
                query.adjustment_type || undefined,
                query.adjustment_name || undefined,
                metadataOnly
            );
            const { buildManualAdjustmentApiResponseRows } = await import("../services/manualAdjustmentService");

            return { success: true, count: rows.length, data: buildManualAdjustmentApiResponseRows(rows) };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment GET error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            period_month: t.String(),
            period_year: t.String(),
            gang_code: t.Optional(t.String()),
            emp_code: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            adjustment_type: t.Optional(t.String()),
            adjustment_name: t.Optional(t.String()),
            metadata_only: t.Optional(t.String()),
            has_metadata: t.Optional(t.String()),
            recompute_sync: t.Optional(t.String())
        })
    })
    .post("/manual-adjustment", async ({ body, currentUser, set }) => {
        try {
            const data = body as any;
            const allowedTypes = ["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH", "PENDAPATAN_LAINNYA"];

            if (!allowedTypes.includes(data.adjustment_type)) {
                set.status = 400;
                return { success: false, error: "adjustment_type tidak valid untuk input UI" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            const resultId = await manualAdjustmentService.saveAdjustment(data, currentUser?.username || "system");

            const pattern = `:${data.period_month}:${data.period_year}`;
            cacheService.clearByPattern(pattern);

            return { success: true, id: resultId, message: "Manual adjustment saved successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment POST error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            nik: t.Optional(t.String()),
            emp_code: t.String(),
            emp_name: t.Optional(t.String()),
            gang_code: t.String(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(),
            adjustment_name: t.String(),
            amount: t.Number(),
            remarks: t.Optional(t.String()),
            metadata_json: t.Optional(t.String()),
            ad_code: t.Optional(t.String()),
            task_code: t.Optional(t.String()),
            base_task_code: t.Optional(t.String()),
            task_desc: t.Optional(t.String())
        })
    })
    // --- Validate premium conversion (lightweight, no DB) ---
    .get("/manual-adjustment/validate-conversion", async ({ query, set }) => {
        try {
            const { premiumDefinitionService } = await import("../services/premiumDefinitionService");
            const validation = premiumDefinitionService.validatePremiumConversion(query.from, query.to);
            return { success: true, validation };
        } catch (e: any) {
            console.error("[PayrollRoutes] validate-conversion error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            from: t.String(),
            to: t.String()
        })
    })
    // --- Convert premium type (per-column bulk) ---
    .post("/manual-adjustment/convert-type", async ({ body, currentUser, set }) => {
        try {
            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { premiumDefinitionService } = await import("../services/premiumDefinitionService");
            // Pre-check validation gate — return 422 with reason if blocked
            const validation = premiumDefinitionService.validatePremiumConversion(body.from_adjustment_name, body.to_adjustment_name);
            if (!validation.allowed) {
                set.status = 422;
                return { success: false, error: validation.reason, validation };
            }
            const { cacheService } = await import("../services/cacheService");
            const result = await manualAdjustmentService.convertAdjustmentType({
                ...body,
                updated_by: currentUser?.username || "system"
            });
            cacheService.clearByPattern(`:${body.period_month}:${body.period_year}`);
            return { success: true, ...result };
        } catch (e: any) {
            console.error("[PayrollRoutes] convert-type error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(),
            from_adjustment_name: t.String(),
            to_adjustment_name: t.String()
        })
    })
    .delete("/manual-adjustment/column", async ({ query, set }) => {
        try {
            const periodMonth = Number(query.period_month);
            const periodYear = Number(query.period_year);
            if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
                set.status = 400;
                return { success: false, error: "period_month tidak valid" };
            }
            if (!Number.isInteger(periodYear) || periodYear < 2000) {
                set.status = 400;
                return { success: false, error: "period_year tidak valid" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            const deletedCount = await manualAdjustmentService.deleteAdjustmentColumn({
                period_month: periodMonth,
                period_year: periodYear,
                division_code: query.division_code || undefined,
                adjustment_type: query.adjustment_type,
                adjustment_name: query.adjustment_name
            });

            cacheService.clearByPattern(`:${periodMonth}:${periodYear}`);
            return { success: true, deleted_count: deletedCount, message: "Manual adjustment column deleted successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment column DELETE error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            period_month: t.String(),
            period_year: t.String(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(),
            adjustment_name: t.String()
        })
    })
    .delete("/manual-adjustment/:id", async ({ params, query, set }) => {
        try {
            const id = Number(params.id);
            if (!Number.isInteger(id) || id <= 0) {
                set.status = 400;
                return { success: false, error: "id tidak valid" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            await manualAdjustmentService.deleteAdjustment(id);

            if (query.period_month && query.period_year) {
                cacheService.clearByPattern(`:${query.period_month}:${query.period_year}`);
            } else {
                cacheService.clear();
            }

            return { success: true, message: "Manual adjustment deleted successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment DELETE error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        query: t.Object({
            period_month: t.Optional(t.String()),
            period_year: t.Optional(t.String())
        })
    })
    // --- Manual Adjustment via API Key Bypass (x-api-key) ---
    .get("/manual-adjustment/by-api-key", async ({ query, headers, set }) => {
        try {
            if (!hasValidApiKeyBypass(headers as Record<string, string | undefined>)) {
                set.status = 401;
                return { success: false, error: "Unauthorized: invalid x-api-key" };
            }

            const periodMonth = Number(query.period_month);
            const periodYear = Number(query.period_year);

            if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
                set.status = 400;
                return { success: false, error: "period_month harus 1-12" };
            }

            if (!Number.isInteger(periodYear) || periodYear < 2000) {
                set.status = 400;
                return { success: false, error: "period_year tidak valid" };
            }

            const {
                manualAdjustmentService
            } = await import("../services/manualAdjustmentService");
            const metadataOnly = ["1", "true", "yes", "metadata"].includes(String(query.metadata_only || query.has_metadata || "").trim().toLowerCase());
            const recomputeSync = !["0", "false", "no", "off"].includes(String(query.recompute_sync || "").trim().toLowerCase());

            // ponytail: recompute_sync default true (real-time vs ADTRANS). =0/false -> legacy baked-remarks path.
            let dataRows: any[];
            if (recomputeSync) {
                dataRows = await manualAdjustmentService.getAdjustmentsWithSyncRecompute(
                    periodMonth,
                    periodYear,
                    query.gang_code || undefined,
                    query.emp_code || undefined,
                    query.division_code || undefined,
                    query.adjustment_type || undefined,
                    query.adjustment_name || undefined,
                    metadataOnly
                );
            } else {
                const r = await manualAdjustmentService.getAdjustments(
                    periodMonth, periodYear,
                    query.gang_code || undefined,
                    query.emp_code || undefined,
                    query.division_code || undefined,
                    query.adjustment_type || undefined,
                    query.adjustment_name || undefined,
                    metadataOnly
                );
                const { buildManualAdjustmentApiResponseRows } = await import("../services/manualAdjustmentService");
                dataRows = buildManualAdjustmentApiResponseRows(r);
            }

            if (String(query.view || "").trim().toLowerCase() === "grouped") {
                const { buildGroupedManualAdjustmentResponse } = await import("../services/manualAdjustmentService");
                const grouped = buildGroupedManualAdjustmentResponse(dataRows);
                return {
                    success: true,
                    view: "grouped",
                    metadata_only: metadataOnly,
                    count: dataRows.length,
                    summary: grouped.summary,
                    data: grouped.divisions
                };
            }

            return {
                success: true,
                view: "flat",
                metadata_only: metadataOnly,
                count: dataRows.length,
                data: dataRows
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/by-api-key GET error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            period_month: t.String(),
            period_year: t.String(),
            gang_code: t.Optional(t.String()),
            emp_code: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            adjustment_type: t.Optional(t.String()),
            adjustment_name: t.Optional(t.String()),
            view: t.Optional(t.String()),
            metadata_only: t.Optional(t.String()),
            has_metadata: t.Optional(t.String()),
            recompute_sync: t.Optional(t.String())
        })
    })
    .post("/manual-adjustment/by-api-key", async ({ body, headers, set }) => {
        try {
            if (!hasValidApiKeyBypass(headers as Record<string, string | undefined>)) {
                set.status = 401;
                return { success: false, error: "Unauthorized: invalid x-api-key" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            const data = body as any;
            const resultId = await manualAdjustmentService.saveAdjustment(data, "api_key_bypass");

            const pattern = `:${data.period_month}:${data.period_year}`;
            cacheService.clearByPattern(pattern);

            return { success: true, id: resultId, message: "Manual adjustment saved successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/by-api-key POST error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            nik: t.Optional(t.String()),
            emp_code: t.String(),
            gang_code: t.String(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(),
            adjustment_name: t.String(),
            amount: t.Number(),
            remarks: t.Optional(t.String()),
            metadata_json: t.Optional(t.String()),
            ad_code: t.Optional(t.String()),
            task_code: t.Optional(t.String()),
            base_task_code: t.Optional(t.String()),
            task_desc: t.Optional(t.String())
        })
    })
    .post("/manual-adjustment/sync-status/by-api-key", async ({ body, headers, set }) => {
        try {
            if (!hasValidApiKeyBypass(headers as Record<string, string | undefined>)) {
                set.status = 401;
                return { success: false, error: "Unauthorized: invalid x-api-key" };
            }

            const data = body as any;
            const adjustmentTypes = Array.isArray(data.adjustment_types)
                ? data.adjustment_types
                : data.adjustment_type
                    ? String(data.adjustment_type).split(",")
                    : undefined;
            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
                periodMonth: Number(data.period_month),
                periodYear: Number(data.period_year),
                divisionCode: data.division_code || data.estate || undefined,
                gangCode: data.gang_code || undefined,
                empCode: data.emp_code || undefined,
                adjustmentTypes,
                adjustmentName: data.adjustment_name || undefined,
                ids: Array.isArray(data.ids) ? data.ids : undefined,
                syncStatus: data.sync_status || "SYNC",
                updatedBy: data.updated_by || data.created_by || "sync_status_api",
                onlyIfAdtransExists: data.only_if_adtrans_exists === true,
                dryRun: data.dry_run === true,
                limit: data.limit ? Number(data.limit) : undefined
            });

            if (!result.dry_run && result.updated_count > 0) {
                cacheService.clearByPattern(`:${data.period_month}:${data.period_year}`);
            }

            return {
                success: true,
                message: `Sync status update checked ${result.matched_count} rows and updated ${result.updated_count}`,
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/sync-status/by-api-key error:", e);
            set.status = 500;
            return { success: false, error: e.message || "Internal server error" };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.Optional(t.String()),
            estate: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            emp_code: t.Optional(t.String()),
            adjustment_type: t.Optional(t.String()),
            adjustment_types: t.Optional(t.Array(t.String())),
            adjustment_name: t.Optional(t.String()),
            ids: t.Optional(t.Array(t.Number())),
            sync_status: t.Optional(t.String()),
            updated_by: t.Optional(t.String()),
            created_by: t.Optional(t.String()),
            only_if_adtrans_exists: t.Optional(t.Boolean()),
            dry_run: t.Optional(t.Boolean()),
            limit: t.Optional(t.Number())
        })
    })
    /**
     * SNAPSHOT TABLES ARE IMMUTABLE.
     * NEVER WRITE USER EDITS DIRECTLY INTO SNAPSHOT TABLES.
     * ALL MANUAL CHANGES MUST GO TO OVERLAY HISTORY TABLES.
     */
    .post("/overrides/profile", async ({ body, currentUser, set }) => {
        try {
            const { payrollOverlayService } = await import("../services/payrollOverlayService");
            const { cacheService } = await import("../services/cacheService");
            const username = currentUser?.username || "system";
            const id = await payrollOverlayService.saveProfileOverride({
                ...(body as any),
                changed_by: username,
                change_source: "DAFTAR_UPAH_UI"
            });

            cacheService.clear();
            return { success: true, id };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            emp_code: t.String(),
            nik: t.Optional(t.String()),
            is_spsi_member: t.Optional(t.Boolean()),
            effective_start_date: t.Optional(t.Union([t.String(), t.Null()])),
            employee_status_at_change: t.Optional(t.String()),
            change_reason: t.Optional(t.String())
        })
    })
    /**
     * SNAPSHOT TABLES ARE IMMUTABLE.
     * NEVER WRITE USER EDITS DIRECTLY INTO SNAPSHOT TABLES.
     * ALL MANUAL CHANGES MUST GO TO OVERLAY HISTORY TABLES.
     */
    .post("/overrides/values", async ({ body, currentUser, set }) => {
        try {
            const { payrollOverlayService } = await import("../services/payrollOverlayService");
            const { cacheService } = await import("../services/cacheService");
            const username = currentUser?.username || "system";
            const ids = await payrollOverlayService.saveValueOverrides((body as any).items, username);

            cacheService.clear();
            return { success: true, ids };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            items: t.Array(t.Object({
                period_month: t.Number(),
                period_year: t.Number(),
                division_code: t.String(),
                gang_code: t.String(),
                emp_code: t.String(),
                nik: t.Optional(t.String()),
                field_name: t.String(),
                field_group: t.String(),
                numeric_value: t.Optional(t.Union([t.Number(), t.Null()])),
                text_value: t.Optional(t.Union([t.String(), t.Null()])),
                change_reason: t.Optional(t.String())
            }))
        })
    })
    /**
     * Join Date Override
     * Updates join_date via employee_profile_override_history.effective_start_date
     * This overrides join_date from history_hr_employee
     */
    .post("/overrides/join-date", async ({ body, currentUser, set }) => {
        try {
            const { payrollOverlayService } = await import("../services/payrollOverlayService");
            const { cacheService } = await import("../services/cacheService");
            const username = currentUser?.username || "system";
            const { emp_code, join_date, change_reason } = body as { emp_code: string; join_date: string; change_reason?: string };

            if (!emp_code || !join_date) {
                set.status = 400;
                return { success: false, error: "emp_code and join_date are required" };
            }

            const id = await payrollOverlayService.saveProfileOverride({
                emp_code,
                effective_start_date: join_date,
                changed_by: username,
                change_source: "DAFTAR_UPAH_UI",
                change_reason: change_reason || `Join date updated to ${join_date}`
            });

            cacheService.clear();
            return { success: true, id };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            emp_code: t.String(),
            join_date: t.String(),
            change_reason: t.Optional(t.String())
        })
    })
    // --- BPJS Calculation (New) ---
    .get("/bpjs-calculate", async ({ query }) => {
        const masaKerjaJumlah = parseFloat(query.masa_kerja_jumlah || "0");
        const upahDasar = parseFloat(query.upah_dasar || "0");
        const components = payrollService.calculateBpjsComponents(masaKerjaJumlah, upahDasar);
        return components;
    }, {
        query: t.Object({
            masa_kerja_jumlah: t.Optional(t.String()),
            upah_dasar: t.Optional(t.String())
        })
    })
    // --- Report: Division Raw Tree ---
    .get("/report/division-raw-tree", async ({ query, set }): Promise<any> => {
        try {

            const divisionCode = query.division_code;
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const useHistoryDb = parseBooleanQueryParam(query.use_history) ?? false;
            const gangPrefix = query.gang_prefix;
            const snapshotVersion = parsePositiveIntegerQueryParam(query.snapshot_version);
            const valuePriorityMode = query.value_priority_mode;

            if (!divisionCode || !month || !year) {
                set.status = 400;
                return { error: "division_code, month, and year are required" };
            }

            // [OPTIMIZATION] The user explicitly requested to skip heavy bunches data (tandan) for the main table view
            const skipHarvest = true;

            // [DEBUG] Log input parameters
            console.log(`[PayrollRoutes] /report/division-raw-tree | div=${divisionCode} month=${month} year=${year} gangPrefix=${gangPrefix || 'none'} valuePriorityMode=${valuePriorityMode || 'non_db_ptrj'} DB_PROFILE=${Config.DB_PROFILE} useHistory=${useHistoryDb} RUN_MODE=${Config.RUN_MODE}`);

            const result = await dataExtractorService.extractPayrollData(
                month,
                year,
                "ALL",
                divisionCode,
                null,
                Config.DB_PROFILE,
                false,
                useHistoryDb,
                gangPrefix,
                skipHarvest,
                false,
                snapshotVersion,
                valuePriorityMode
            );

            // [DEBUG] Log result summary
            const dataRows = sortByEmpCode(result.data_rows);
            const uniqueGangs = new Set(dataRows.map(r => r.gang_code || "UNKNOWN"));
            console.log(`[PayrollRoutes] /report/division-raw-tree RESULT | data_rows=${dataRows.length} gangs=${uniqueGangs.size} | gangPrefix=${gangPrefix}`);

            // [NEW] Use centralized payrollTotalsCalculator for consistent totals
            const { calculatePayrollTotals, calculateTaxMatrixTotals, reconcileGangTotalsToGrandTotal } = await import("../services/payrollTotalsCalculator");
            const grandTotal = calculatePayrollTotals(dataRows, 'GRAND TOTAL');

            // Group by gang and calculate totals
            const gangsMap: Record<string, any[]> = {};
            for (const row of dataRows) {
                const gang = row.gang_code || "UNKNOWN";
                if (!gangsMap[gang]) gangsMap[gang] = [];
                gangsMap[gang].push(row);
            }

            console.log(`[PayrollRoutes] division-raw-tree: division=${divisionCode}, month=${month}, year=${year}, gangPrefix=${gangPrefix || 'none'}`);
            console.log(`[PayrollRoutes] division-raw-tree: data_rows count=${dataRows.length}, gangs count=${Object.keys(gangsMap).length}`);
            console.log(`[PayrollRoutes] division-raw-tree: dynamic_premi=${result.dynamic_premi_headers?.length || 0}, dynamic_pot=${result.dynamic_potongan_headers?.length || 0}`);

            // Build gangs list with pre-calculated totals
            const gangsList = Object.entries(gangsMap)
                .map(([gang_code, employees]) => ({
                    gang_code,
                    employees: employees.map(slimEmployee),  // Strip heavy arrays before sending
                    gang_totals: calculatePayrollTotals(employees, `TOTAL ${gang_code}`),  // Pre-calculated totals from FULL data
                    tax_matrix_totals: calculateTaxMatrixTotals(employees)
                }))
                .sort((a, b) => a.gang_code.localeCompare(b.gang_code));

            const reconciledGangTotals = reconcileGangTotalsToGrandTotal(
                gangsList.map((gang) => gang.gang_totals),
                grandTotal
            );
            gangsList.forEach((gang, index) => {
                gang.gang_totals = reconciledGangTotals[index];
            });

            const response = {
                division: divisionCode,
                month,
                year,
                gangs: gangsList,
                grand_total: grandTotal,  // Division-level totals
                tax_matrix_totals: calculateTaxMatrixTotals(dataRows),
                dynamic_premi_headers: result.dynamic_premi_headers || [],
                dynamic_potongan_headers: result.dynamic_potongan_headers || [],
                premi_title_map: result.premi_title_map || {},
                potongan_title_map: result.potongan_title_map || {},
                meta: result.meta || {}
            };

            console.log(`[PayrollRoutes] division-raw-tree: returning response with ${gangsList.length} gangs`);
            return response;
        } catch (e: any) {
            console.error("[PayrollRoutes] division-raw-tree error:", e);
            set.status = String(e?.message || "").includes("Snapshot version") ? 404 : 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            division_code: t.String(),
            month: t.String(),
            year: t.String(),
            use_history: t.Optional(t.String()),
            gang_prefix: t.Optional(t.String()),
            snapshot_version: t.Optional(t.String()),
            value_priority_mode: t.Optional(t.String())
        })
    })
    // --- Seed Auto Buffer -> Manual Adjustment ---
    
    /**
     * @route POST /payroll/manual-adjustment/check-adtrans/by-api-key
     * @description Checks PR_ADTRANS directly for given employees and specific allowance/deduction patterns
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/check-adtrans/by-api-key", async ({ body, headers, set }) => {
        try {
            // Verify API Key
            const apiKey = headers["x-api-key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, message: "Unauthorized - Invalid API Key" };
            }

            const data = body as any;
            const { period_month, period_year, emp_codes = [], division_code } = data;
            const filters = parseStringArrayInput(data.filters);
            const adjustmentTypes = [
                ...parseStringArrayInput(data.adjustment_type),
                ...parseStringArrayInput(data.adjustment_types)
            ];
            const adjustmentNames = [
                ...parseStringArrayInput(data.adjustment_name),
                ...parseStringArrayInput(data.adjustment_names)
            ];
            const docDescs = [
                ...parseStringArrayInput(data.doc_desc),
                ...parseStringArrayInput(data.doc_descs)
            ];

            if (!period_month || !period_year) {
                set.status = 400;
                return { success: false, message: "period_month and period_year are required" };
            }

            if ((!Array.isArray(emp_codes) || emp_codes.length === 0) && !division_code) {
                set.status = 400;
                return { success: false, message: "emp_codes array or division_code is required" };
            }

            if (filters.length === 0 && adjustmentTypes.length === 0 && adjustmentNames.length === 0 && docDescs.length === 0) {
                set.status = 400;
                return { success: false, message: "filters, adjustment_type, adjustment_name, or doc_desc is required" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const result = await manualAdjustmentService.checkAdtransDirectly(
                Number(period_month),
                Number(period_year),
                emp_codes,
                filters,
                division_code,
                {
                    adjustmentTypes,
                    adjustmentNames,
                    docDescs
                }
            );

            return {
                success: true,
                message: "Adtrans check completed successfully",
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/check-adtrans error:", e);
            set.status = 500;
            return { success: false, message: e.message || "Internal server error" };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            emp_codes: t.Optional(t.Array(t.String())),
            filters: t.Optional(t.Array(t.String())),
            adjustment_type: t.Optional(t.Union([t.String(), t.Array(t.String())])),
            adjustment_types: t.Optional(t.Array(t.String())),
            adjustment_name: t.Optional(t.Union([t.String(), t.Array(t.String())])),
            adjustment_names: t.Optional(t.Array(t.String())),
            doc_desc: t.Optional(t.Union([t.String(), t.Array(t.String())])),
            doc_descs: t.Optional(t.Array(t.String())),
            division_code: t.Optional(t.String())
        })
    })

    /**
     * @route POST /payroll/manual-adjustment/adtrans-doc-ids/by-api-key
     * @description Return only PR_ADTRANS/PR_ADTRANS_ARC DocID values matching selected config.
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/adtrans-doc-ids/by-api-key", handleAdtransDocIdsByApiKey, {
        body: ADTRANS_DOC_IDS_BODY_SCHEMA
    })
    /**
     * @route POST /payroll/manual-adjustment/adtrans-by-docid/by-api-key
     * @description Compatibility alias for automation that asks for ADTRANS records by DocID.
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/adtrans-by-docid/by-api-key", handleAdtransDocIdsByApiKey, {
        body: ADTRANS_DOC_IDS_BODY_SCHEMA
    })
    /**
     * @route POST /payroll/manual-adjustment/adtrans-by-doid/by-api-key
     * @description Typo-compatible alias for adtrans-by-docid.
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/adtrans-by-doid/by-api-key", handleAdtransDocIdsByApiKey, {
        body: ADTRANS_DOC_IDS_BODY_SCHEMA
    })

    /**
     * @route POST /payroll/manual-adjustment/compare-adtrans/by-api-key
     * @description Compare PR_ADTRANS (db_ptrj) values with payroll_manual_adjustments (extend_db_ptrj).
     *              Returns per-employee per-category comparison showing source vs stored amount.
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/compare-adtrans/by-api-key", async ({ body, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, message: "Unauthorized - Invalid API Key" };
            }

            const data = body as any;
            const { period_month, period_year, division_code, filters } = data;

            if (!period_month || !period_year) {
                set.status = 400;
                return { success: false, message: "period_month and period_year are required" };
            }

            if (!division_code) {
                set.status = 400;
                return { success: false, message: "division_code is required" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const result = await manualAdjustmentService.compareAdtransWithAdjustments(
                Number(period_month),
                Number(period_year),
                division_code,
                filters || ['spsi', 'masa kerja', 'jabatan', 'premi', 'koreksi', 'potongan']
            );

            return {
                success: true,
                message: "Comparison completed successfully",
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/compare-adtrans error:", e);
            set.status = 500;
            return { success: false, message: e.message || "Internal server error" };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            filters: t.Optional(t.Array(t.String()))
        })
    })

    /**
     * @route POST /payroll/manual-adjustment/reverse-compare-adtrans/by-api-key
     * @description Compare payroll_manual_adjustments (extend_db_ptrj) values with PR_ADTRANS (db_ptrj).
     *              Returns stored AUTO_BUFFER rows that match, mismatch, or exist only in adjustments.
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/reverse-compare-adtrans/by-api-key", async ({ body, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, message: "Unauthorized - Invalid API Key" };
            }

            const data = body as any;
            const { period_month, period_year, division_code, filters } = data;

            if (!period_month || !period_year) {
                set.status = 400;
                return { success: false, message: "period_month and period_year are required" };
            }

            if (!division_code) {
                set.status = 400;
                return { success: false, message: "division_code is required" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const result = await manualAdjustmentService.reverseCompareAdtransWithAdjustments(
                Number(period_month),
                Number(period_year),
                division_code,
                filters || ['spsi', 'masa kerja', 'jabatan', 'premi', 'koreksi', 'potongan']
            );

            return {
                success: true,
                message: "Reverse comparison completed successfully",
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/reverse-compare-adtrans error:", e);
            set.status = 500;
            return { success: false, message: e.message || "Internal server error" };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            filters: t.Optional(t.Array(t.String()))
        })
    })

    /**
     * @route POST /payroll/manual-adjustment/sync-adtrans/by-api-key
     * @description Sync PR_ADTRANS (db_ptrj) values into payroll_manual_adjustments (extend_db_ptrj).
     *              Only syncs items that are MISMATCH or MISSING from comparison.
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/sync-adtrans/by-api-key", async ({ body, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, message: "Unauthorized - Invalid API Key" };
            }

            const data = body as any;
            const { period_month, period_year, division_code, filters, sync_mode, created_by } = data;

            if (!period_month || !period_year) {
                set.status = 400;
                return { success: false, message: "period_month and period_year are required" };
            }

            if (!division_code) {
                set.status = 400;
                return { success: false, message: "division_code is required" };
            }

            const validSyncModes = ['MISSING_ONLY', 'MISMATCH_AND_MISSING', 'ALL'];
            const syncMode = validSyncModes.includes(sync_mode) ? sync_mode : 'MISMATCH_AND_MISSING';

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");

            const result = await manualAdjustmentService.syncAdtransToAdjustments(
                Number(period_month),
                Number(period_year),
                division_code,
                filters || ['spsi', 'masa kerja', 'jabatan', 'premi', 'koreksi', 'potongan'],
                syncMode as 'MISSING_ONLY' | 'MISMATCH_AND_MISSING' | 'ALL',
                created_by || 'sync_adtrans_api'
            );

            // Clear cache for this period
            const pattern = `:${period_month}:${period_year}`;
            cacheService.clearByPattern(pattern);

            return {
                success: true,
                message: `Sync completed: ${result.synced_count} records synced, ${result.skipped_match} matches skipped`,
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/sync-adtrans error:", e);
            set.status = 500;
            return { success: false, message: e.message || "Internal server error" };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            filters: t.Optional(t.Array(t.String())),
            sync_mode: t.Optional(t.String()),
            created_by: t.Optional(t.String())
        })
    })

    // ─── Verification Endpoints ─────────────────────────────────────────────

    /**
     * @route POST /payroll/verify/full-by-api-key
     * @description Full verification across ALL data sources (PR_ADTRANS, PR_TASKREGLN, HR_PAYROLL, HR_EMPLOYEE, manual adjustments).
     * @access Public (with X-API-Key)
     */
    .post("/verify/full-by-api-key", async ({ body, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"] || headers["X-API-Key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, error: "Invalid API key" };
            }

            const { payrollVerificationService } = await import("../services/payrollVerificationService");
            const result = await payrollVerificationService.verifyFullPayroll(
                Number(body.period_month),
                Number(body.period_year),
                String(body.division_code),
                body.gang_code || undefined,
                body.emp_codes?.length ? body.emp_codes : undefined,
                body.source_filter?.length ? body.source_filter : undefined
            );

            return { success: true, data: result };
        } catch (e: any) {
            console.error("[PayrollRoutes] verify/full error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            gang_code: t.Optional(t.String()),
            emp_codes: t.Optional(t.Array(t.String())),
            source_filter: t.Optional(t.Array(t.String()))
        })
    })

    /**
     * @route POST /payroll/verify/granular-adtrans/by-api-key
     * @description Granular per-DocDesc verification for PR_ADTRANS.
     * @access Public (with X-API-Key)
     */
    .post("/verify/granular-adtrans/by-api-key", async ({ body, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"] || headers["X-API-Key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, error: "Invalid API key" };
            }

            const { manualAdjustmentVerificationService } = await import("../services/manualAdjustmentVerificationService");
            const result = await manualAdjustmentVerificationService.verifyGranularAdtrans(
                Number(body.period_month),
                Number(body.period_year),
                String(body.division_code),
                body.adjustment_types || ["PREMI", "POTONGAN_KOTOR", "AUTO_BUFFER"],
                body.emp_codes?.length ? body.emp_codes : undefined,
                body.include_doc_desc_details !== false
            );

            return { success: true, data: result };
        } catch (e: any) {
            console.error("[PayrollRoutes] verify/granular-adtrans error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            adjustment_types: t.Optional(t.Array(t.String())),
            emp_codes: t.Optional(t.Array(t.String())),
            include_doc_desc_details: t.Optional(t.Boolean())
        })
    })

    /**
     * @route POST /payroll/verify/consistency/by-api-key
     * @description Check adjustment_name = DocDesc consistency between extend_db_ptrj and db_ptrj.
     * @access Public (with X-API-Key)
     */
    .post("/verify/consistency/by-api-key", async ({ body, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"] || headers["X-API-Key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, error: "Invalid API key" };
            }

            const { manualAdjustmentVerificationService } = await import("../services/manualAdjustmentVerificationService");
            const result = await manualAdjustmentVerificationService.verifyAdjustmentNameConsistency(
                Number(body.period_month),
                Number(body.period_year),
                String(body.division_code),
                (body.check_scope as "all" | "auto_buffer" | "manual") || "all"
            );

            return { success: true, data: result };
        } catch (e: any) {
            console.error("[PayrollRoutes] verify/consistency error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            check_scope: t.Optional(t.String())
        })
    })

    /**
     * @route POST /payroll/manual-adjustment/save-verified/by-api-key
     * @description Save manual adjustment with verification against db_ptrj.
     *              verify_mode: "warn" (default) | "strict" | "skip"
     * @access Public (with X-API-Key)
     */
    .post("/manual-adjustment/save-verified/by-api-key", async ({ body, headers, set }) => {
        try {
            const apiKey = headers["x-api-key"] || headers["X-API-Key"];
            if (!apiKey || apiKey !== Config.API_KEY_BYPASS) {
                set.status = 401;
                return { success: false, error: "Invalid API key" };
            }

            const { manualAdjustmentVerificationService } = await import("../services/manualAdjustmentVerificationService");
            const result = await manualAdjustmentVerificationService.saveVerifiedAdjustment(
                body,
                "api_key_user",
                (body.verify_mode as "warn" | "strict" | "skip") || "warn"
            );

            if (result.verification?.status === "MISMATCH" && body.verify_mode === "strict") {
                set.status = 409;
                return { success: false, error: "VERIFICATION_FAILED", verification: result.verification };
            }

            return { success: true, id: result.id, action: result.action, verification: result.verification };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/save-verified error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            emp_code: t.String(),
            nik: t.Optional(t.String()),
            emp_name: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            division_code: t.String(),
            adjustment_type: t.String(),
            adjustment_name: t.String(),
            amount: t.Number(),
            ad_code: t.Optional(t.String()),
            task_code: t.Optional(t.String()),
            base_task_code: t.Optional(t.String()),
            task_desc: t.Optional(t.String()),
            remarks: t.Optional(t.String()),
            metadata_json: t.Optional(t.String()),
            verify_mode: t.Optional(t.String())
        })
    })

    .post("/manual-adjustment/seed-sync-status/by-api-key", async ({ body, headers, set }) => {
        try {
            if (!hasValidApiKeyBypass(headers as Record<string, string | undefined>)) {
                set.status = 401;
                return { success: false, error: "Unauthorized: invalid x-api-key" };
            }

            const payload = body as any;
            const { manualAdjustmentSyncStatusSeederService } = await import("../services/manualAdjustmentSyncStatusSeederService");
            const { cacheService } = await import("../services/cacheService");
            const result = await manualAdjustmentSyncStatusSeederService.seedPeriod({
                period_month: payload.period_month,
                period_year: payload.period_year,
                division_code: payload.division_code || payload.estate || undefined,
                gang_code: payload.gang_code || undefined,
                emp_code: payload.emp_code || undefined,
                adjustment_types: Array.isArray(payload.adjustment_types)
                    ? payload.adjustment_types
                    : payload.adjustment_type
                        ? String(payload.adjustment_type).split(",")
                        : undefined,
                adjustment_name: payload.adjustment_name || undefined,
                ids: Array.isArray(payload.ids) ? payload.ids : undefined,
                sync_status: payload.sync_status || "SYNC",
                created_by: payload.created_by || payload.updated_by || "sync_status_seeder_api",
                only_if_adtrans_exists: payload.only_if_adtrans_exists !== false,
                dry_run: payload.dry_run === true,
                limit: payload.limit ? Number(payload.limit) : undefined
            });

            if (!result.dry_run && result.updated_count > 0) {
                cacheService.clearByPattern(`:${payload.period_month}:${payload.period_year}`);
            }

            return {
                success: true,
                message: `Manual adjustment sync-status seeder checked ${result.matched_count} rows and updated ${result.updated_count}`,
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/seed-sync-status/by-api-key error:", e);
            set.status = 500;
            return { success: false, error: e.message || "Internal server error" };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.Optional(t.String()),
            estate: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            emp_code: t.Optional(t.String()),
            adjustment_type: t.Optional(t.String()),
            adjustment_types: t.Optional(t.Array(t.String())),
            adjustment_name: t.Optional(t.String()),
            ids: t.Optional(t.Array(t.Number())),
            sync_status: t.Optional(t.String()),
            created_by: t.Optional(t.String()),
            updated_by: t.Optional(t.String()),
            only_if_adtrans_exists: t.Optional(t.Boolean()),
            dry_run: t.Optional(t.Boolean()),
            limit: t.Optional(t.Number())
        })
    })

    .post("/manual-adjustment/seed-auto-buffer", async ({ body, currentUser, set }) => {
        try {
            const { autoBufferManualAdjustmentSeederService } = await import("../services/autoBufferManualAdjustmentSeederService");
            const { cacheService } = await import("../services/cacheService");
            const payload = body as any;

            const result = await autoBufferManualAdjustmentSeederService.seedPeriod({
                period_month: payload.period_month,
                period_year: payload.period_year,
                division_code: payload.division_code,
                gang_code: payload.gang_code,
                use_history_db: payload.use_history_db,
                snapshot_version: payload.snapshot_version,
                replace_existing: payload.replace_existing,
                value_priority_mode: payload.value_priority_mode,
                created_by: currentUser?.username || "system"
            });

            const pattern = `:${payload.period_month}:${payload.period_year}`;
            cacheService.clearByPattern(pattern);

            return buildAutoBufferSeedEndpointResponse(result);
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/seed-auto-buffer error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            gang_code: t.Optional(t.String()),
            use_history_db: t.Optional(t.Boolean()),
            snapshot_version: t.Optional(t.Number()),
            replace_existing: t.Optional(t.Boolean()),
            value_priority_mode: t.Optional(t.String())
        })
    })

    .post("/manual-adjustment/seed-sync-status", async ({ body, currentUser, set }) => {
        try {
            const { manualAdjustmentSyncStatusSeederService } = await import("../services/manualAdjustmentSyncStatusSeederService");
            const { cacheService } = await import("../services/cacheService");
            const payload = body as any;

            const result = await manualAdjustmentSyncStatusSeederService.seedPeriod({
                period_month: payload.period_month,
                period_year: payload.period_year,
                division_code: payload.division_code || payload.estate || undefined,
                gang_code: payload.gang_code || undefined,
                emp_code: payload.emp_code || undefined,
                adjustment_types: Array.isArray(payload.adjustment_types)
                    ? payload.adjustment_types
                    : payload.adjustment_type
                        ? String(payload.adjustment_type).split(",")
                        : undefined,
                adjustment_name: payload.adjustment_name || undefined,
                ids: Array.isArray(payload.ids) ? payload.ids : undefined,
                sync_status: payload.sync_status || "SYNC",
                created_by: payload.created_by || currentUser?.username || "sync_status_seeder",
                only_if_adtrans_exists: payload.only_if_adtrans_exists !== false,
                dry_run: payload.dry_run === true,
                limit: payload.limit ? Number(payload.limit) : undefined
            });

            if (!result.dry_run && result.updated_count > 0) {
                cacheService.clearByPattern(`:${payload.period_month}:${payload.period_year}`);
            }

            return {
                success: true,
                message: "Manual adjustment sync status seeder selesai",
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] manual-adjustment/seed-sync-status error:", e);
            set.status = 500;
            return { success: false, error: e.message || "Internal server error" };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.Optional(t.String()),
            estate: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            emp_code: t.Optional(t.String()),
            adjustment_type: t.Optional(t.String()),
            adjustment_types: t.Optional(t.Array(t.String())),
            adjustment_name: t.Optional(t.String()),
            ids: t.Optional(t.Array(t.Number())),
            sync_status: t.Optional(t.String()),
            created_by: t.Optional(t.String()),
            only_if_adtrans_exists: t.Optional(t.Boolean()),
            dry_run: t.Optional(t.Boolean()),
            limit: t.Optional(t.Number())
        })
    })
    // --- Locked Report: Raw Tree (Alias for Proxy/Frontend Compat) ---
    .get("/locked/report/raw-tree", async ({ query, set, currentUser }): Promise<any> => {
        try {

            // Frontend sends 'div' instead of 'division_code' for this endpoint
            const divisionCode = query.div;
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const useHistoryDb = parseBooleanQueryParam(query.use_history);
            const snapshotVersion = parsePositiveIntegerQueryParam(query.snapshot_version);
            const valuePriorityMode = query.value_priority_mode;

            if (!divisionCode || !month || !year) {
                set.status = 400;
                return { error: "div, month, and year are required" };
            }

            // PERMISSION CHECK
            if (!currentUser) {
                set.status = 401;
                return { error: "Unauthorized" };
            }

            // PERMISSION CHECK - Enforce for KERANI
            // ADMIN = All access
            // USER = All access (Legacy behavior retained for backward compatibility if needed, or strictly enforce?)
            // KERANI = RESTRICTED to assigned divisions

            if (currentUser.role === UserRole.KERANI) {
                // Normalize requested division using divisionDefinition resolveDivisionCode
                // This handles AREC -> ARC, WORKSHOP AR -> WKS_AR, etc.
                const { divisionDefinition } = await import("../services/divisionDefinition");
                const requestedDiv = divisionDefinition.resolveDivisionCode(String(divisionCode).trim().toUpperCase());



                const hasPermission = currentUser.divisions.some(d => {
                    // Also normalize user's division using resolveDivisionCode
                    const div = divisionDefinition.resolveDivisionCode(String(d).trim().toUpperCase());
                    const match = div === requestedDiv;

                    return match;
                });

                if (!hasPermission) {
                    console.warn(`[PayrollRoutes] KERANI ${currentUser.username} denied. Divs: ${JSON.stringify(currentUser.divisions)}, Req: ${requestedDiv}`);
                    // console.log(`[DEBUG] permission check failed`);
                    set.status = 403;
                    return { error: `Access refused: You do not have permission for division ${divisionCode}` };
                }
            }

            /*
            if (currentUser.role !== UserRole.ADMIN) {
                console.log(`[PayrollRoutes DEBUG Report] Permission Check for User: ${currentUser.username}, Requested: '${divisionCode}', UserDivs: ${JSON.stringify(currentUser.divisions)}`);

                // Normalize for comparison
                const requestedDiv = String(divisionCode).trim().toUpperCase();

                // Check if ANY user division (or its alias) matches the requests
                const hasPermission = currentUser.divisions.some(d => {
                    const div = String(d).trim().toUpperCase();
                    if (div === requestedDiv) return true;

                    // Helper: Convert P1A -> PG1A and vice versa via alias mapping
                    const alias = gangService.convertDivisionToLocCode(div);
                    if (alias === requestedDiv) return true;

                    return false;
                });

                if (!hasPermission) {
                    console.warn(`[PayrollRoutes] User ${currentUser.username} attempted to access unauthorized division: ${divisionCode}`);
                    set.status = 403;
                    return { error: `Access refused: You do not have permission for division ${divisionCode}` };
                }
            */

            const includeVirtual = query.include_virtual === 'true';
            const gangPrefix = query.gang_prefix;
            const gangCode = query.gang_code || "ALL";

            // Use Config.DB_PROFILE for payroll data (main payroll database)

            // [OPTIMIZATION] Skip heavy bunches data (tandan) for the main table view
            const skipHarvest = true;

        console.log(`[PayrollRoutes] /locked/report/raw-tree | div=${divisionCode} month=${month} year=${year} gangCode=${gangCode} gangPrefix=${gangPrefix} valuePriorityMode=${valuePriorityMode || 'non_db_ptrj'} useHistory=${useHistoryDb}`);

            const result = await dataExtractorService.extractPayrollData(
                month,
                year,
                gangCode,
                divisionCode,
                null,
                Config.DB_PROFILE,
                includeVirtual,
                useHistoryDb,
                gangPrefix,
                skipHarvest,
                false,
                snapshotVersion,
                valuePriorityMode
            );

            // [DEBUG] Log result summary
            const dataRows = sortByEmpCode(result?.data_rows || []);
            const empCount = dataRows.length;
            const uniqueGangs = new Set(dataRows.map(r => r.gang_code || "UNKNOWN"));
            const gangCount = uniqueGangs.size;
            console.log(`[PayrollRoutes] /locked/report/raw-tree RESULT | gangs=${gangCount} employees=${empCount} | gangCode=${gangCode} | gangPrefix=${gangPrefix}`);

            // [NEW] Use centralized payrollTotalsCalculator for consistent totals
            const { calculatePayrollTotals, calculateTaxMatrixTotals, reconcileGangTotalsToGrandTotal } = await import("../services/payrollTotalsCalculator");
            const grandTotal = calculatePayrollTotals(dataRows, 'GRAND TOTAL');

            // Group by gang and calculate totals
            const gangsMap: Record<string, any[]> = {};
            for (const row of dataRows) {
                const gang = row.gang_code || "UNKNOWN";
                if (!gangsMap[gang]) gangsMap[gang] = [];
                gangsMap[gang].push(row);
            }

            // Build gangs list with pre-calculated totals
            const gangsList = Object.entries(gangsMap)
                .map(([gang_code, employees]) => ({
                    gang_code,
                    employees: employees.map(slimEmployee),  // Strip heavy arrays before sending
                    gang_totals: calculatePayrollTotals(employees, `TOTAL ${gang_code}`),  // Pre-calculated totals from FULL data
                    tax_matrix_totals: calculateTaxMatrixTotals(employees)
                }))
                .sort((a, b) => a.gang_code.localeCompare(b.gang_code));

            const reconciledGangTotals = reconcileGangTotalsToGrandTotal(
                gangsList.map((gang) => gang.gang_totals),
                grandTotal
            );
            gangsList.forEach((gang, index) => {
                gang.gang_totals = reconciledGangTotals[index];
            });



            return {
                division: divisionCode,
                month,
                year,
                gangs: gangsList,
                grand_total: grandTotal,  // Division-level totals
                tax_matrix_totals: calculateTaxMatrixTotals(dataRows),
                dynamic_premi_headers: result.dynamic_premi_headers,
                dynamic_potongan_headers: result.dynamic_potongan_headers,
                premi_title_map: result.premi_title_map,
                potongan_title_map: result.potongan_title_map,
                meta: result.meta
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/report/raw-tree error:", e);
            set.status = String(e?.message || "").includes("Snapshot version") ? 404 : 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            div: t.String(),
            month: t.String(),
            year: t.String(),
            include_virtual: t.Optional(t.String()),
            use_history: t.Optional(t.String()),
            gang_prefix: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            snapshot_version: t.Optional(t.String()),
            value_priority_mode: t.Optional(t.String())
        })
    })
    // --- Locked Manual Edit ---
    .post("/locked/manual-edit", async ({ body, set, currentUser }) => {
        try {
            // PERMISSION CHECK
            if (!currentUser) {
                set.status = 401;
                return { error: "Unauthorized" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            const data = body as any;

            const username = currentUser?.username || 'system';
            const resultId = await manualAdjustmentService.saveAdjustment(data, username);

            // Always clear cache after save to ensure fresh data on next load
            // Use suffix matching because keys format is payroll_data:{gangCode}:{month}:{year}
            const pattern = `:${data.period_month}:${data.period_year}`;
            cacheService.clearByPattern(pattern);
            console.log(`[PayrollRoutes] Cleared cache for pattern: ${pattern} after locked manual edit`);

            return { success: true, id: resultId, message: "Manual adjustment saved successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/manual-edit error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            nik: t.Optional(t.String()),  // Real NIK (KTP) - for PENDAPATAN_LAINNYA
            emp_code: t.String(),
            emp_name: t.Optional(t.String()),
            gang_code: t.String(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(), // PREMI, POTONGAN_KOTOR, POTONGAN_BERSIH, PENDAPATAN_LAINNYA
            adjustment_name: t.String(),
            amount: t.Number(),
            remarks: t.Optional(t.String()),
            metadata_json: t.Optional(t.String()),
            ad_code: t.Optional(t.String()),
            task_code: t.Optional(t.String()),
            base_task_code: t.Optional(t.String()),
            task_desc: t.Optional(t.String())
        })
    })
    // --- Locked: validate premium conversion ---
    .get("/locked/manual-adjustment/validate-conversion", async ({ query, set, currentUser }) => {
        try {
            if (!currentUser) {
                set.status = 401;
                return { success: false, error: "Unauthorized" };
            }
            const { premiumDefinitionService } = await import("../services/premiumDefinitionService");
            const validation = premiumDefinitionService.validatePremiumConversion(query.from, query.to);
            return { success: true, validation };
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/validate-conversion error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            from: t.String(),
            to: t.String()
        })
    })
    // --- Locked: convert premium type (per-column bulk) ---
    .post("/locked/manual-adjustment/convert-type", async ({ body, set, currentUser }) => {
        try {
            if (!currentUser) {
                set.status = 401;
                return { success: false, error: "Unauthorized" };
            }
            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { premiumDefinitionService } = await import("../services/premiumDefinitionService");
            const validation = premiumDefinitionService.validatePremiumConversion(body.from_adjustment_name, body.to_adjustment_name);
            if (!validation.allowed) {
                set.status = 422;
                return { success: false, error: validation.reason, validation };
            }
            const { cacheService } = await import("../services/cacheService");
            const result = await manualAdjustmentService.convertAdjustmentType({
                ...body,
                updated_by: currentUser?.username || "system"
            });
            cacheService.clearByPattern(`:${body.period_month}:${body.period_year}`);
            return { success: true, ...result };
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/convert-type error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(),
            from_adjustment_name: t.String(),
            to_adjustment_name: t.String()
        })
    })
    .delete("/locked/manual-adjustment/column", async ({ query, set, currentUser }) => {
        try {
            if (!currentUser) {
                set.status = 401;
                return { success: false, error: "Unauthorized" };
            }

            const periodMonth = Number(query.period_month);
            const periodYear = Number(query.period_year);
            if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
                set.status = 400;
                return { success: false, error: "period_month tidak valid" };
            }
            if (!Number.isInteger(periodYear) || periodYear < 2000) {
                set.status = 400;
                return { success: false, error: "period_year tidak valid" };
            }

            const { manualAdjustmentService } = await import("../services/manualAdjustmentService");
            const { cacheService } = await import("../services/cacheService");
            const deletedCount = await manualAdjustmentService.deleteAdjustmentColumn({
                period_month: periodMonth,
                period_year: periodYear,
                division_code: query.division_code || undefined,
                adjustment_type: query.adjustment_type,
                adjustment_name: query.adjustment_name
            });

            cacheService.clearByPattern(`:${periodMonth}:${periodYear}`);
            return { success: true, deleted_count: deletedCount, message: "Manual adjustment column deleted successfully." };
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/manual-adjustment column DELETE error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            period_month: t.String(),
            period_year: t.String(),
            division_code: t.Optional(t.String()),
            adjustment_type: t.String(),
            adjustment_name: t.String()
        })
    })
    // --- Explicit Strict Income Deletion (Kontan/THR) ---
    .post("/locked/income-delete", async ({ body, set, currentUser }) => {
        try {
            if (!currentUser) { set.status = 401; return { error: "Unauthorized" }; }
            const { Database } = await import("../db/client");
            const { cacheService } = await import("../services/cacheService");
            const data = body as any;
            const db = Database.getExtendedInstance();
            
            const incomeType = String(data.income_type || '').toUpperCase().trim();
            const realNik = (data.nik || '').trim();
            
            if (!incomeType || !realNik || !data.period_month || !data.period_year) {
                set.status = 400; return { error: "income_type, nik, period_month, period_year required" };
            }

            // Strictly delete ONLY this income type for this employee
            await db.query(`
                DELETE FROM employee_other_incomes 
                WHERE nik = ? AND period_month = ? AND period_year = ? AND income_type = ?
            `, [realNik, data.period_month, data.period_year, incomeType]);
            
            const pattern = `:${data.period_month}:${data.period_year}`;
            cacheService.clearByPattern(pattern);
            console.log(`[PayrollRoutes] Cleared cache for pattern: ${pattern} after income delete`);

            return { success: true, message: `${incomeType} deleted successfully for NIK ${realNik}` };
        } catch (e: any) {
            set.status = 500; return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            nik: t.String(),
            period_month: t.Number(),
            period_year: t.Number(),
            income_type: t.String()
        })
    })
    // --- Locked Pendapatan Lainnya Edit (Generic: Kontanan, Insentif, etc.) ---
    .post("/locked/pendapatan-lainnya-edit", async ({ body, set, currentUser }) => {
        try {
            if (!currentUser) {
                set.status = 401;
                return { error: "Unauthorized" };
            }

            const { Database } = await import("../db/client");
            const { cacheService } = await import("../services/cacheService");
            const data = body as any;

            const db = Database.getExtendedInstance();
            const parsedAmount = parseFloat(data.amount?.toString()) || 0;
            const incomeType = String(data.income_type || '').toUpperCase().trim().replace(/\s+/g, '_');
            const incomeName = String(data.income_name || data.income_type || '').trim();

            if (!incomeType) {
                set.status = 400;
                return { error: "income_type is required" };
            }

            // Look for existing record for this NIK + emp_name + income_type in this period
            // Using NIK + emp_name to disambiguate employees that may share the same NIK
            const existing = await db.query(`
                SELECT id FROM employee_other_incomes 
                WHERE nik = ? AND emp_name = ? AND period_year = ? AND period_month = ? AND income_type = ?
            `, [data.nik, data.emp_name, data.period_year, data.period_month, incomeType]);

            const clearPeriodCache = () => {
                const pattern = `payroll_data:${data.period_month}:${data.period_year}`;
                cacheService.clearByPattern(pattern);
                console.log(`[PayrollRoutes] Cleared cache for pattern: ${pattern} after saving ${incomeType}`);
            };

            if (existing && existing.length > 0) {
                if (parsedAmount === 0) {
                    await db.query(`DELETE FROM employee_other_incomes WHERE id = ?`, [existing[0].id]);
                    clearPeriodCache();
                    return { success: true, action: 'deleted', message: `${incomeName} removed.` };
                } else {
                    await db.query(`
                        UPDATE employee_other_incomes 
                        SET amount = ?, emp_name = ?, gang_code = ?, division_code = ?, income_name = ?, updated_at = GETDATE()
                        WHERE id = ?
                    `, [parsedAmount, data.emp_name, data.gang_code, data.division_code || null, incomeName, existing[0].id]);
                    clearPeriodCache();
                    return { success: true, action: 'updated', id: existing[0].id, message: `${incomeName} updated.` };
                }
            } else {
                if (parsedAmount === 0) {
                    return { success: true, action: 'skipped', message: "Zero amount, nothing saved." };
                }
                await db.query(`
                    INSERT INTO employee_other_incomes (
                        nik, emp_name, division_code, gang_code, period_year, period_month,
                        income_type, income_name, amount, is_paid_in_thp, is_taxable
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
                `, [data.nik, data.emp_name, data.division_code || null, data.gang_code, data.period_year, data.period_month, incomeType, incomeName, parsedAmount]);
                clearPeriodCache();
                return { success: true, action: 'inserted', message: `${incomeName} saved.` };
            }
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/pendapatan-lainnya-edit error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            nik: t.String(),
            emp_name: t.String(),
            period_month: t.Number(),
            period_year: t.Number(),
            amount: t.Number(),
            gang_code: t.String(),
            division_code: t.Optional(t.String()),
            income_type: t.String(),
            income_name: t.Optional(t.String())
        })
    })
    // --- Locked Pendapatan Lainnya Custom Types ---
    .get("/locked/pendapatan-lainnya-types", async ({ query, set, currentUser }): Promise<any> => {
        try {
            if (!currentUser) {
                set.status = 401;
                return { error: "Unauthorized" };
            }

            const { Database } = await import("../db/client");
            const db = Database.getExtendedInstance();
            const month = parseInt(query.month as string) || new Date().getMonth() + 1;
            const year = parseInt(query.year as string) || new Date().getFullYear();

            // Fetch distinct custom income types for this period
            // Exclude standard types (THR, BONUS, CUSTOM) that come from the OtherIncomes bulk system
            const rows = await db.query<{ income_type: string; income_name: string }>(`
                SELECT DISTINCT income_type, income_name 
                FROM employee_other_incomes
                WHERE period_year = ? AND period_month = ?
                  AND income_type NOT IN ('THR', 'BONUS', 'CUSTOM')
                ORDER BY income_type
            `, [year, month]);

            const types = rows.map(r => ({
                type: r.income_type,
                name: r.income_name || r.income_type
            }));

            return { success: true, types };
        } catch (e: any) {
            console.error("[PayrollRoutes] pendapatan-lainnya-types error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    })
    // --- Locked Gangs List ---
    .get("/locked/gangs", async ({ query, set, currentUser }): Promise<any> => {
        try {
            // Frontend service likely sends 'div' based on previous pattern, 
            // but let's support 'division' too just in case.
            const divisionCode = query.div || query.division;

            if (!divisionCode) {
                set.status = 400;
                return { error: "Division code is required" };
            }

            // PERMISSION CHECK - RELAXED TO MATCH PYTHON BACKEND
            if (!currentUser) {
                set.status = 401;
                return { error: "Unauthorized" };
            }

            // PERMISSION CHECK - Enforce for KERANI
            // The Python backend (payroll_locked.py) does NOT check if the user has the division in their token.
            // However, for KERANI, we need to be STRICT.

            if (currentUser.role === UserRole.KERANI) {
                // Normalize requested division using divisionDefinition resolveDivisionCode
                // This handles AREC -> ARC, WORKSHOP AR -> WKS_AR, etc.
                const { divisionDefinition } = await import("../services/divisionDefinition");
                const requestedDiv = divisionDefinition.resolveDivisionCode(String(divisionCode).trim().toUpperCase());



                const hasPermission = currentUser.divisions.some(d => {
                    // Also normalize user's division using resolveDivisionCode
                    const div = divisionDefinition.resolveDivisionCode(String(d).trim().toUpperCase());
                    const match = div === requestedDiv;

                    return match;
                });

                if (!hasPermission) {
                    console.warn(`[PayrollRoutes] KERANI ${currentUser.username} attempted to access unauthorized gangs for division: ${divisionCode}`);
                    set.status = 403;
                    return { error: `Access denied. You have ${JSON.stringify(currentUser.divisions)}, but requested ${divisionCode}` };
                }
            }

            /*
            if (currentUser.role !== UserRole.ADMIN) {
                console.log(`[PayrollRoutes DEBUG] Permission Check for User: ${currentUser.username}, Requested: '${divisionCode}', UserDivs: ${JSON.stringify(currentUser.divisions)}`);
     
                // Normalize for comparison
                const requestedDiv = String(divisionCode).trim().toUpperCase();
     
                // Check if ANY user division (or its alias) matches the requests
                // This handles P1A vs PG1A mismatches
                const hasPermission = currentUser.divisions.some(d => {
                    const div = String(d).trim().toUpperCase();
                    if (div === requestedDiv) return true;
     
                    // Helper: Convert P1A -> PG1A and vice versa is tricky if GangService only does one way.
                    // But GangService has convertDivisionToLocCode (PG1A -> P1A).
                    // So if User has PG1A, convert to P1A and check.
                    const alias = gangService.convertDivisionToLocCode(div);
                    if (alias === requestedDiv) return true;
     
                    return false;
                });
     
                if (!hasPermission) {
                    console.warn(`[PayrollRoutes] User ${currentUser.username} attempted to access unauthorized gangs for division: ${divisionCode}`);
                    set.status = 403;
                    return { error: `Access denied. You have ${JSON.stringify(currentUser.divisions)}, but requested ${divisionCode}` };
                }
            }
            */

            const gangs = await gangService.fetchGangs(divisionCode);
            return gangs;
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/gangs error:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            div: t.Optional(t.String()),
            division: t.Optional(t.String())
        })
    })
    // --- Report: Gang Grid ---
    .get("/report", async ({ query, set }): Promise<any> => {
        try {
            const { calculatePayrollTotals, reconcileGangTotalsToGrandTotal } = await import("../services/payrollTotalsCalculator");

            const gangCode = query.gang_code || "ALL";
            const month = parseInt(query.month || String(new Date().getMonth() + 1));
            const year = parseInt(query.year || String(new Date().getFullYear()));
            const useHistoryDb = parseBooleanQueryParam(query.use_history);
            const gangPrefix = query.gang_prefix;
            const serverProfile = query.server_profile || Config.DB_PROFILE;
            const skipHeavyDetails = query.summary_only === 'true';
            const snapshotVersion = parsePositiveIntegerQueryParam(query.snapshot_version);

            // Use provided serverProfile or default to Config.DB_PROFILE
            const result = await dataExtractorService.extractPayrollData(month, year, gangCode, undefined, null, serverProfile, false, useHistoryDb, gangPrefix, false, skipHeavyDetails, snapshotVersion);

            // [NEW] Calculate totals on backend to replace frontend calculation
            // Group data by gang_code
            const gangsMap: Record<string, any[]> = {};
            const dataRows = sortByEmpCode(result.data_rows);

            dataRows.forEach((row: any) => {
                const gang = row.gang_code || "UNKNOWN";
                if (!gangsMap[gang]) gangsMap[gang] = [];
                gangsMap[gang].push(row);
            });

            // Calculate gang totals
            const gangsList = Object.entries(gangsMap).map(([gang_code, employees]) => ({
                gang_code,
                employees,
                gang_totals: calculatePayrollTotals(employees, `TOTAL ${gang_code}`)
            }));

            const grandTotal = calculatePayrollTotals(dataRows, 'GRAND TOTAL');
            const reconciledGangTotals = reconcileGangTotalsToGrandTotal(
                gangsList.map((gang) => gang.gang_totals),
                grandTotal
            );
            gangsList.forEach((gang, index) => {
                gang.gang_totals = reconciledGangTotals[index];
            });

            return {
                gang_code: gangCode,
                month,
                year,
                data: dataRows,
                gangs: gangsList,
                grand_total: grandTotal,
                dynamic_premi_headers: result.dynamic_premi_headers,
                dynamic_potongan_headers: result.dynamic_potongan_headers,
                meta: result.meta
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] report error:", e);
            set.status = String(e?.message || "").includes("Snapshot version") ? 404 : 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            gang_code: t.Optional(t.String()),
            month: t.Optional(t.String()),
            year: t.Optional(t.String()),
            skip: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            use_history: t.Optional(t.String()),
            gang_prefix: t.Optional(t.String()),
            server_profile: t.Optional(t.String()),
            summary_only: t.Optional(t.String()),
            snapshot_version: t.Optional(t.String())
        })
    })

    // =========================================================================
    // NEW COMPONENT ARCHITECTURE ENDPOINTS
    // These endpoints expose the new unified component services with metadata
    // =========================================================================

    /**
     * Get payroll report with full component metadata
     * This endpoint demonstrates the new architecture where all calculations
     * return PayrollComponent with traceable metadata
     */
    .get("/report-with-components", async ({ query, set }): Promise<any> => {
        try {

            const gangCode = query.gang_code || "ALL";
            const month = parseInt(query.month || String(new Date().getMonth() + 1));
            const year = parseInt(query.year || String(new Date().getFullYear()));
            const useHistoryDb = parseBooleanQueryParam(query.use_history);

            // Use new component-based extraction method
            const result = await dataExtractorService.extractPayrollDataWithComponents(month, year, gangCode, undefined, null, Config.DB_PROFILE, useHistoryDb);

            return {
                gang_code: gangCode,
                month,
                year,
                data: sortByEmpCode(result.data_rows),
                components: result.components,  // All component data with metadata
                meta: result.meta
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] report-with-components error:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            gang_code: t.Optional(t.String()),
            month: t.Optional(t.String()),
            year: t.Optional(t.String()),
            use_history: t.Optional(t.String())
        })
    })

    /**
     * Get detailed component breakdown for a single employee
     * Returns all calculations with full metadata traceability
     */
    .get("/employee/:emp_code/components", async ({ params, query, set }): Promise<any> => {
        try {

            const empCode = params.emp_code;
            const month = parseInt(query.month || String(new Date().getMonth() + 1));
            const year = parseInt(query.year || String(new Date().getFullYear()));

            const result = await dataExtractorService.getEmployeeComponentDetails(empCode, month, year, Config.DB_PROFILE);

            return result;
        } catch (e: any) {
            console.error("[PayrollRoutes] employee components error:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({
            emp_code: t.String()
        }),
        query: t.Object({
            month: t.Optional(t.String()),
            year: t.Optional(t.String())
        })
    })

    /**
     * TEST ENDPOINT: Diagnose jabatan, THR, and KONTAN data availability
     * Tests the full chain: gang → employees → employee_estate / employee_other_incomes
     */
    .get("/test/jabatan-thr-kontan", async ({ query, set }) => {
        try {
            const db = Database.getExtendedInstance();
            const dbMain = Database.getInstance();
            const { OtherIncomesService } = await import("../services/otherIncomesService");

            const gangCode = (query.gang_code as string) || 'H1H';
            const month = parseInt(query.month as string) || 3;
            const year = parseInt(query.year as string) || 2026;

            const result: any = {
                params: { gang_code: gangCode, month, year },
                timestamp: new Date().toISOString()
            };

            // STEP 1: Get employees in the gang
            const gangEmployees = await dbMain.query(`
                SELECT TOP 20
                    RTRIM(e.EmpCode) as emp_code,
                    RTRIM(e.NewICNo) as nik,
                    RTRIM(e.EmpName) as emp_name,
                    RTRIM(gl.GangCode) as gang_code,
                    e.Status
                FROM HR_EMPLOYEE e
                INNER JOIN HR_GANGLN gl ON e.EmpCode = gl.GangMember
                INNER JOIN HR_GANG g ON gl.GangCode = g.GangCode
                WHERE gl.GangCode = ?
                ORDER BY e.EmpName
            `, [gangCode]);

            result.step1_employees = {
                total: gangEmployees.length,
                sample: gangEmployees.slice(0, 5).map((e: any) => ({
                    emp_code: e.emp_code,
                    nik: e.nik || '(empty)',
                    emp_name: e.emp_name
                }))
            };

            if (gangEmployees.length === 0) {
                result.conclusion = 'FAIL';
                result.message = `No employees found for gang ${gangCode}`;
                return result;
            }

            const empCodes = gangEmployees.map((e: any) => e.emp_code);
            const niks = gangEmployees.map((e: any) => (e.nik || '').trim().toUpperCase()).filter(Boolean);

            // STEP 2: Check employee_estate (JABATAN)
            const estateRows = await db.query(`
                SELECT empcode, employee_name, gang, jabatan
                FROM employee_estate
                WHERE empcode IN (${empCodes.map(() => '?').join(',')})
            `, empCodes);

            const estateMap = new Map<string, string>();
            estateRows.forEach((r: any) => estateMap.set(r.empcode?.trim().toUpperCase(), r.jabatan));

            // Also check by nik
            const estateRowsByNik = await db.query(`
                SELECT nik, employee_name, gang, jabatan
                FROM employee_estate
                WHERE nik IN (${niks.map(() => '?').join(',')})
            `, niks);
            estateRowsByNik.forEach((r: any) => {
                const key = (r.nik || '').trim().toUpperCase();
                if (key && !estateMap.has(key)) {
                    estateMap.set(key, r.jabatan);
                }
            });

            const totalEstateCount = await db.query(`SELECT COUNT(*) as cnt FROM employee_estate`);
            result.step2_jabatan = {
                table_total_records: totalEstateCount[0]?.cnt || 0,
                records_for_gang: estateRows.length,
                matched_by_empcode: estateRows.length,
                matched_by_nik: estateRowsByNik.length,
                sample: estateRows.slice(0, 5).map((r: any) => ({
                    empcode: r.empcode,
                    jabatan: r.jabatan
                })),
                status: estateRows.length > 0 ? 'OK' : 'EMPTY - seed needed'
            };

            // STEP 3: Check employee_other_incomes (THR + KONTAN)
            const otherIncomes = await OtherIncomesService.getIncomes(year, month, undefined, gangCode);
            const thrRecords = otherIncomes.filter((i: any) => i.income_type === 'THR');
            const kontanRecords = otherIncomes.filter((i: any) => i.income_type === 'KONTAN' || i.income_type === 'KONTANAN');

            // Match against gang employees
            let thrMatched = 0;
            let kontanMatched = 0;
            const thrSample: any[] = [];
            const kontanSample: any[] = [];

            for (const emp of gangEmployees) {
                const nikKey = (emp.nik || '').trim().toUpperCase();
                const empCodeKey = (emp.emp_code || '').trim().toUpperCase();

                const hasThr = thrRecords.some((r: any) =>
                    ((r.nik || '').trim().toUpperCase() === nikKey && nikKey) ||
                    ((r.emp_code || '').trim().toUpperCase() === empCodeKey && empCodeKey)
                );
                const hasKontan = kontanRecords.some((r: any) =>
                    ((r.nik || '').trim().toUpperCase() === nikKey && nikKey) ||
                    ((r.emp_code || '').trim().toUpperCase() === empCodeKey && empCodeKey)
                );

                if (hasThr) {
                    thrMatched++;
                    if (thrSample.length < 5) {
                        const rec = thrRecords.find((r: any) =>
                            ((r.nik || '').trim().toUpperCase() === nikKey && nikKey) ||
                            ((r.emp_code || '').trim().toUpperCase() === empCodeKey && empCodeKey)
                        );
                        thrSample.push({ emp_name: emp.emp_name, nik: nikKey || empCodeKey, amount: rec?.amount });
                    }
                }
                if (hasKontan) {
                    kontanMatched++;
                    if (kontanSample.length < 5) {
                        const rec = kontanRecords.find((r: any) =>
                            ((r.nik || '').trim().toUpperCase() === nikKey && nikKey) ||
                            ((r.emp_code || '').trim().toUpperCase() === empCodeKey && empCodeKey)
                        );
                        kontanSample.push({ emp_name: emp.emp_name, nik: nikKey || empCodeKey, amount: rec?.amount });
                    }
                }
            }

            const totalThrInDb = await db.query(`SELECT COUNT(*) as cnt FROM employee_other_incomes WHERE income_type = 'THR' AND period_year = ? AND period_month = ?`, [year, month]);
            const totalKontanInDb = await db.query(`SELECT COUNT(*) as cnt FROM employee_other_incomes WHERE income_type IN ('KONTAN','KONTANAN') AND period_year = ? AND period_month = ?`, [year, month]);

            result.step3_thr = {
                db_total_records: totalThrInDb[0]?.cnt || 0,
                for_gang: thrRecords.length,
                matched_to_gang_employees: thrMatched,
                gang_employees_total: gangEmployees.length,
                sample: thrSample,
                status: thrMatched > 0 ? 'OK' : 'EMPTY'
            };

            result.step4_kontan = {
                db_total_records: totalKontanInDb[0]?.cnt || 0,
                for_gang: kontanRecords.length,
                matched_to_gang_employees: kontanMatched,
                gang_employees_total: gangEmployees.length,
                sample: kontanSample,
                status: kontanMatched > 0 ? 'OK' : 'EMPTY - KONTAN data not seeded'
            };

            // CONCLUSION
            const allOk = thrMatched > 0 && kontanMatched >= 0 && estateRows.length > 0;
            result.conclusion = allOk ? 'PASS' : 'PARTIAL';
            result.message = allOk
                ? `Jabatan: ${estateRows.length} records, THR: ${thrMatched}/${gangEmployees.length} employees, KONTAN: ${kontanMatched} employees`
                : `Some data is missing. Seed missing tables.`;

            return result;
        } catch (e: any) {
            console.error("[PayrollRoutes] test/jabatan-thr-kontan error:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            gang_code: t.Optional(t.String()),
            month: t.Optional(t.String()),
            year: t.Optional(t.String())
        })
    })

    /**
     * Get component registry health status
     * Returns all registered components and their versions
     */
    .get("/components/registry", async () => {
        try {
            const { payrollComponentRegistry } = await import("../services/payroll");

            const health = payrollComponentRegistry.getHealthStatus();

            return health;
        } catch (e: any) {
            console.error("[PayrollRoutes] components registry error:", e);
            return { error: e.message };
        }
    })

    /**
     * PROGRESSIVE STREAMING ENDPOINT
     *
     * Uses Server-Sent Events (SSE) to stream gang data progressively.
     *
     * Flow:
     * 1. Run ALL heavy DB queries in parallel (same as original)
     * 2. Group employees by gang
     * 3. Stream each gang batch as it's processed
     * 4. Stream final grand_total when all gangs are done
     *
     * This allows the frontend to start rendering rows BEFORE all data is processed.
     *
     * Event types:
     * - meta: { total_gangs, total_employees, dynamic_headers, execution_time_ms }
     * - progress: { stage, message, processed_gangs, total_gangs }
     * - gang: { gang_code, employees[], gang_totals, chunk_index }
     * - complete: { grand_total, total_execution_ms }
     * - error: { message }
     */
    // Progressive streaming endpoint - uses SSE to stream data progressively
    // Falls back to standard fetch if SSE not supported
    .get("/report/division-raw-tree/stream", async ({ headers, query, set, currentUser }): Promise<any> => {
        const user = currentUser;
        if (!user) {
            set.status = 401;
            return { error: "Unauthorized" };
        }

        const divisionCode = query.division_code;
        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const gangPrefix = query.gang_prefix;
        const gangCode = query.gang_code || "ALL";
        const useHistoryDb = parseBooleanQueryParam(query.use_history as string | undefined) ?? false;
        const snapshotVersion = parsePositiveIntegerQueryParam(query.snapshot_version as string | undefined);
        const valuePriorityMode = query.value_priority_mode as string | undefined;

        if (!divisionCode || !month || !year) {
            set.status = 400;
            return { error: "division_code, month, and year are required" };
        }

        // Permission check - Use NORMALIZED division check like non-SSE endpoints
        if (user && user.role !== UserRole.ADMIN) {
            const { divisionDefinition } = await import("../services/divisionDefinition");
            const requestedDiv = divisionDefinition.resolveDivisionCode(String(divisionCode).trim().toUpperCase());

            const hasPermission = user.divisions.some(d => {
                const div = divisionDefinition.resolveDivisionCode(String(d).trim().toUpperCase());
                return div === requestedDiv;
            });

            if (!hasPermission) {
                console.warn(`[Stream] KERANI/USER ${user.username} denied. Divs: ${JSON.stringify(user.divisions)}, Req: ${requestedDiv}`);
                set.status = 403;
                return { error: "Division not accessible" };
            }
        }

        console.log(`[Stream] Starting progressive | div=${divisionCode} month=${month} year=${year} gangCode=${gangCode} valuePriorityMode=${valuePriorityMode || 'non_db_ptrj'} useHistory=${useHistoryDb}`);

        const encoder = new TextEncoder();
        let cancelled = false;

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    // Import services
                    const { Config } = await import("../config");
                    const { calculatePayrollTotals, reconcileGangTotalsToGrandTotal } = await import("../services/payrollTotalsCalculator");

                    // Send initial progress
                    controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify({
                        stage: 'connecting',
                        message: 'Menghubungi server...',
                        processed_gangs: 0,
                        total_gangs: 0
                    })}\n\n`));

                    // Use TRUE lazy loading extraction - yields data in phases
                    const progressiveStream = dataExtractorService.extractPayrollDataProgressive(
                        month, year, gangCode, divisionCode,
                        Config.DB_PROFILE, gangPrefix, useHistoryDb, snapshotVersion, valuePriorityMode
                    );

                    let gangIndex = 0;
                    const gangOrder: string[] = [];
                    let lastMeta: any = null;
                    let lastPhase = '';
                    const streamStartTime = Date.now();

                    const allDynamicPremiHeaders = new Set<string>();
                    const allDynamicPotonganHeaders = new Set<string>();
                    let globalPremiTitleMap: Record<string, string> = {};
                    let globalPotonganTitleMap: Record<string, string> = {};

                    let streamComplete = false;

                    for await (const chunk of progressiveStream) {
                        if (cancelled) break;

                        const { phase, gangs, current_gang, meta, dynamic_premi_headers, dynamic_potongan_headers, dynamic_premi_titles, dynamic_potongan_titles } = chunk;

                        // Track gang order from identity phase
                        if (phase === 'identity' && gangOrder.length === 0) {
                            gangOrder.push(...Array.from(gangs.keys()).sort());
                        }

                        // Update dynamic headers as they arrive
                        if (dynamic_premi_headers) {
                            dynamic_premi_headers.forEach(h => allDynamicPremiHeaders.add(h));
                        }
                        if (dynamic_potongan_headers) {
                            dynamic_potongan_headers.forEach(h => allDynamicPotonganHeaders.add(h));
                        }
                        if (dynamic_premi_titles) {
                            Object.assign(globalPremiTitleMap, dynamic_premi_titles);
                        }
                        if (dynamic_potongan_titles) {
                            Object.assign(globalPotonganTitleMap, dynamic_potongan_titles);
                        }

                        if (phase !== lastPhase) {
                            console.log(`[Stream] Phase ${phase}: ${meta.message}`);
                            lastPhase = phase;
                        }

                        lastMeta = meta;

                        // Phase 0: Identity (names only)
                        if (phase === 'identity') {
                            controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({
                                division: divisionCode,
                                month,
                                year,
                                total_gangs: meta.total_gangs,
                                total_employees: meta.total_employees,
                                dynamic_premi_headers: [],
                                dynamic_potongan_headers: [],
                                stage: 'identity',
                                query_time_ms: 0
                            })}\n\n`));

                            // Send all gangs with names only
                            for (const [gangCodeKey, employees] of gangs) {
                                const idx = gangOrder.indexOf(gangCodeKey);
                                const slimEmployees = sortedSlimStreamEmployees(employees);

                                controller.enqueue(encoder.encode(`event: gang\ndata: ${JSON.stringify({
                                    gang_code: gangCodeKey,
                                    employees: slimEmployees,
                                    gang_index: idx >= 0 ? idx : gangIndex++,
                                    employees_count: slimEmployees.length,
                                    phase: 'identity',
                                    is_complete: false
                                })}\n\n`));
                            }

                            controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify({
                                stage: 'identity_loaded',
                                message: meta.message,
                                processed_gangs: meta.total_gangs,
                                total_gangs: meta.total_gangs,
                                progress_pct: meta.progress_pct
                            })}\n\n`));
                        }

                        // Phase 1-3: Progressive enrichment
                        if (phase === 'attendance' || phase === 'overtime' || phase === 'premium') {
                            const stageMap: Record<string, string> = {
                                'attendance': 'attendance_loaded',
                                'overtime': 'overtime_loaded',
                                'premium': 'premium_loaded'
                            };

                            // Send updated gangs
                            for (const [gangCodeKey, employees] of gangs) {
                                const idx = gangOrder.indexOf(gangCodeKey);
                                const slimEmployees = sortedSlimStreamEmployees(employees);

                                controller.enqueue(encoder.encode(`event: gang_update\ndata: ${JSON.stringify({
                                    gang_code: gangCodeKey,
                                    employees: slimEmployees,
                                    gang_index: idx,
                                    phase: phase,
                                    is_complete: false
                                })}\n\n`));
                            }

                            controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify({
                                stage: stageMap[phase] || 'loading',
                                message: meta.message,
                                processed_gangs: meta.total_gangs,
                                total_gangs: meta.total_gangs,
                                progress_pct: meta.progress_pct
                            })}\n\n`));
                        }

                        // Complete phase
                        if (phase === 'complete') {
                            console.log(`[Stream] ✅ Complete: ${meta.message}`);

                            const completedGangPayloads = Array.from(gangs.entries()).map(([gangCodeKey, employees]) => ({
                                gangCodeKey,
                                employees,
                                gangTotals: null as any
                            }));

                            completedGangPayloads.forEach((gang) => {
                                gang.gangTotals = calculatePayrollTotals(gang.employees, `TOTAL ${gang.gangCodeKey}`);
                            });

                            const grandTotal = calculatePayrollTotals(
                                completedGangPayloads.flatMap((gang) => gang.employees),
                                "GRAND TOTAL"
                            );
                            const reconciledGangTotals = reconcileGangTotalsToGrandTotal(
                                completedGangPayloads.map((gang) => gang.gangTotals),
                                grandTotal
                            );
                            completedGangPayloads.forEach((gang, index) => {
                                gang.gangTotals = reconciledGangTotals[index];
                            });

                            // Send final filtered & sorted gangs with gang_totals
                            for (const { gangCodeKey, employees, gangTotals } of completedGangPayloads) {
                                const idx = gangOrder.indexOf(gangCodeKey);
                                const slimEmployees = sortedSlimStreamEmployees(employees);

                                controller.enqueue(encoder.encode(`event: gang\ndata: ${JSON.stringify({
                                    gang_code: gangCodeKey,
                                    employees: slimEmployees,
                                    gang_index: idx >= 0 ? idx : gangIndex++,
                                    employees_count: slimEmployees.length,
                                    gang_totals: gangTotals,
                                    phase: 'complete',
                                    is_complete: true
                                })}\n\n`));
                            }

                            controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify({
                                stage: 'complete',
                                message: meta.message,
                                total_gangs: meta.total_gangs,
                                progress_pct: 100
                            })}\n\n`));

                            // Send final headers
                            controller.enqueue(encoder.encode(`event: headers\ndata: ${JSON.stringify({
                                dynamic_premi_headers: Array.from(allDynamicPremiHeaders),
                                dynamic_potongan_headers: Array.from(allDynamicPotonganHeaders),
                                dynamic_premi_titles: globalPremiTitleMap,
                                dynamic_potongan_titles: globalPotonganTitleMap,
                                snapshot_version: meta.snapshot_version ?? null,
                                requested_snapshot_version: meta.requested_snapshot_version ?? null,
                                available_snapshot_versions: meta.available_snapshot_versions ?? [],
                                is_history_snapshot: meta.is_history_snapshot ?? false
                            })}\n\n`));

                            controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify({
                                message: meta.message,
                                grand_total: grandTotal,
                                total_execution_ms: Date.now() - streamStartTime,
                                total_gangs: meta.total_gangs,
                                total_employees: meta.total_employees,
                                gangs_count: meta.total_gangs,
                                employees_count: meta.total_employees
                            })}\n\n`));

                            streamComplete = true;
                        }
                    }

                    // Only close controller after the stream has truly finished
                    if (streamComplete) {
                        controller.close();
                    }

                } catch (e: any) {
                    console.error('[Stream] Error:', e);
                    try {
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`));
                        controller.close();
                    } catch {}
                }
            },
            cancel() {
                cancelled = true;
            }
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
            }
        });
    }, {
        query: t.Object({
            division_code: t.String(),
            month: t.String(),
            year: t.String(),
            gang_prefix: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            use_history: t.Optional(t.String()),
            snapshot_version: t.Optional(t.String()),
            value_priority_mode: t.Optional(t.String())
        })
    })
    .post("/locked/manual-adjustment/seed-auto-buffer", async ({ body, set, currentUser }) => {
        try {
            const { autoBufferManualAdjustmentSeederService } = await import("../services/autoBufferManualAdjustmentSeederService");
            const { cacheService } = await import("../services/cacheService");
            const payload = body as any;

            const result = await autoBufferManualAdjustmentSeederService.seedPeriod({
                period_month: payload.period_month,
                period_year: payload.period_year,
                division_code: payload.division_code,
                gang_code: payload.gang_code,
                use_history_db: payload.use_history_db,
                snapshot_version: payload.snapshot_version,
                replace_existing: payload.replace_existing,
                value_priority_mode: payload.value_priority_mode,
                created_by: currentUser?.username || "system"
            });

            const pattern = `:${payload.period_month}:${payload.period_year}`;
            cacheService.clearByPattern(pattern);

            return buildAutoBufferSeedEndpointResponse(result);
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/manual-adjustment/seed-auto-buffer error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            gang_code: t.Optional(t.String()),
            use_history_db: t.Optional(t.Boolean()),
            snapshot_version: t.Optional(t.Number()),
            replace_existing: t.Optional(t.Boolean()),
            value_priority_mode: t.Optional(t.String())
        })
    })
    .post("/locked/manual-adjustment/auto-buffer-validate", async ({ body, set, currentUser }) => {
        try {
            const { autoBufferManualAdjustmentSeederService } = await import("../services/autoBufferManualAdjustmentSeederService");
            const payload = body as any;

            const result = await autoBufferManualAdjustmentSeederService.validatePeriod({
                period_month: payload.period_month,
                period_year: payload.period_year,
                division_code: payload.division_code,
                gang_code: payload.gang_code,
                created_by: currentUser?.username || "system"
            });

            return {
                success: true,
                message: "Auto buffer validation completed",
                data: result
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] locked/manual-adjustment/auto-buffer-validate error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            period_month: t.Number(),
            period_year: t.Number(),
            division_code: t.String(),
            gang_code: t.Optional(t.String())
        })
    })

    /**
     * Cache warming endpoint - pre-populates cache for fast subsequent requests
     * POST /api/payroll/warm-cache
     */
    .post("/warm-cache", async ({ body, set }): Promise<any> => {
        try {
            const { divisionConfigService } = await import("../services/config/DivisionConfigService");
            const { currentPeriodService } = await import("../services/currentPeriodService");
            const { cacheService } = await import("../services/cacheService");
            const { Config } = await import("../config");

            const data = body as any;
            const division = data?.division || 'ALL';
            const month = data?.month;
            const year = data?.year;

            // Get current period if not specified
            let targetMonth = month;
            let targetYear = year;
            if (!targetMonth || !targetYear) {
                const current = await currentPeriodService.getCurrentPeriod();
                targetMonth = current.month;
                targetYear = current.year;
            }

            console.log(`[CacheWarm] Starting cache warm for div=${division} month=${targetMonth} year=${targetYear}`);

            const startTime = Date.now();
            let gangsWarmed = 0;
            let employeesWarmed = 0;
            let errors = 0;

            if (division === 'ALL') {
                // Warm cache for all REAL divisions only (exclude virtual divisions)
                // Virtual divisions are derived at read time from real divisions
                const divisions = divisionConfigService.getAllDivisionCodes().filter(d => !divisionConfigService.isVirtualDivision(d));
                for (const div of divisions) {
                    try {
                        const result = await dataExtractorService.extractPayrollData(
                            targetMonth, targetYear, "ALL", div, null,
                            Config.DB_PROFILE, false, null, undefined, true, true
                        );
                        gangsWarmed++;
                        employeesWarmed += result.data_rows.length;
                    } catch (e: any) {
                        errors++;
                        console.error(`[CacheWarm] Error warming ${div}:`, e?.message || e);
                    }
                }
            } else {
                // Warm cache for specific division
                const result = await dataExtractorService.extractPayrollData(
                    targetMonth, targetYear, "ALL", division, null,
                    Config.DB_PROFILE, false, null, undefined, true, true
                );
                gangsWarmed++;
                employeesWarmed += result.data_rows.length;
            }

            const elapsed = Date.now() - startTime;
            console.log(`[CacheWarm] Complete: ${gangsWarmed} divisions, ${employeesWarmed} employees in ${elapsed}ms, errors: ${errors}`);

            return {
                success: true,
                warmed: {
                    divisions: gangsWarmed,
                    employees: employeesWarmed,
                    elapsed_ms: elapsed,
                    errors
                }
            };
        } catch (e: any) {
            console.error('[CacheWarm] Error:', e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            division: t.Optional(t.String()),
            month: t.Optional(t.Number()),
            year: t.Optional(t.Number())
        })
    })

    /**
     * Get cache statistics
     */
    .get("/cache-stats", async (): Promise<any> => {
        const { cacheService } = await import("../services/cacheService");
        return cacheService.getStats();
    })

    /**
     * Gang Payroll Summary - used by GangAttendanceMatrix to show money columns
     * Returns: emp_code, jumlah_upah_kotor, koreksi_hk, pot_koreksi, pph21_ter, upah_bersih
     * Source: db_ptrj via dataExtractorService (same data source as the main payroll table)
     */
    .get("/gang-payroll-summary", async ({ query, set }): Promise<any> => {
        try {
            const month = parseInt(query.month);
            const year = parseInt(query.year);
            const gangCodes = (query.gang_codes || '').split(',').map((c: string) => c.trim()).filter(Boolean);

            if (!month || !year || gangCodes.length === 0) {
                set.status = 400;
                return { error: "month, year, and gang_codes are required" };
            }

            // Use dataExtractorService which queries db_ptrj
            // Extract payroll data for ALL gangs, then filter by requested gangCodes
            const skipHarvest = true;
            const result = await dataExtractorService.extractPayrollData(
                month, year, "ALL", undefined, null, Config.DB_PROFILE, false, null, undefined, skipHarvest
            );

            // Filter to only the requested gang codes and extract summary fields
            const gangCodesSet = new Set(gangCodes.map((c: string) => c.trim().toUpperCase()));
            const data = sortByEmpCode(result.data_rows
                .filter((row: any) => gangCodesSet.has((row.gang_code || '').trim().toUpperCase()))
                .map((row: any) => ({
                    emp_code: (row.emp_code || row.nik || '').trim(),
                    gang_code: (row.gang_code || '').trim(),
                    jumlah_upah_kotor: Number(row.jumlah_upah_kotor) || 0,
                    koreksi_hk: Number(row.koreksi_hk) || 0,
                    pot_koreksi: Number(row.pot_koreksi) || 0,
                    pph21_ter: Number(row.pph21_ter || row.pot_pph21) || 0,
                    upah_bersih: Number(row.upah_bersih) || 0,
                    gaji_pokok_aktual: Number(row.gaji_pokok_aktual) || 0,
                    total_tunjangan: Number(row.total_tunjangan) || 0,
                    total_premi: Number(row.total_premi) || 0,
                })));

            return {
                data,
                meta: {
                    month,
                    year,
                    total_employees: data.length,
                    gang_codes: gangCodes
                }
            };
        } catch (e: any) {
            console.error("[PayrollRoutes] gang-payroll-summary error:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            gang_codes: t.String()
        })
    })

    // ================================================================
    // GET /payroll/export/pajak
    // Export PPh21 TER calculation + PPh21 input (pot_pph21) per emp_code
    // Query params: month, year, gang (optional, default ALL)
    // ================================================================
    .get("/export/pajak", async ({ query, set }) => {
        try {
            const month = parseInt(query.month as string);
            const year = parseInt(query.year as string);
            const gang = query.gang as string || undefined;
            const division = query.div as string || undefined;
            const gangPrefix = query.gang_prefix as string || undefined;
            const useHistoryDb = parseBooleanQueryParam(query.use_history) ?? false;
            const snapshotVersion = parsePositiveIntegerQueryParam(query.snapshot_version as string | undefined);
            const valuePriorityMode = query.value_priority_mode as string | undefined;

            if (!month || !year || month < 1 || month > 12) {
                set.status = 400;
                return { error: "Invalid month or year" };
            }

            const result = await taxReportService.getMonthlyTaxReport(year, month, division, gang, gangPrefix, useHistoryDb, snapshotVersion, valuePriorityMode);

            // Build emp_code → pajak mapping
            const employeesMap: Record<string, any> = {};
            for (const emp of result.employees) {
                employeesMap[emp.emp_code] = {
                    emp_code: emp.emp_code,
                    emp_name: emp.emp_name,
                    nik: emp.nik,
                    gang_code: emp.gang_code,
                    jabatan: emp.jabatan,
                    status_ptkp: emp.status_ptkp,
                    kategori_ter: emp.kategori_ter,
                    // Calculated TER
                    penghasilan_bruto: emp.penghasilan_bruto,
                    tarif_pajak_ter: emp.tarif_pajak_ter,
                    pph21_ter: emp.pph21_ter,
                    // Input PPh21 from PR_ADTRANS (pot_pph21 in potongan upah bersih)
                    pph21_input: emp.pot_pph21 ?? null,
                    // Selisih = input - ter
                    selisih: (emp.pot_pph21 ?? 0) - (emp.pph21_ter ?? 0),
                    // Income
                    upah_kotor: emp.upah_kotor,
                    total_tunjangan: emp.total_tunjangan,
                    total_premi: emp.total_premi,
                    hk: emp.hk,
                    // Potongan components
                    pot_spsi: emp.pot_spsi,
                    pot_koreksi: emp.pot_koreksi,
                    bpjs_kes_majikan: emp.bpjs_kes_majikan,
                    astek_jht_majikan: emp.astek_jht_majikan,
                    // Restoration of THR and Kontan
                    thr_amount: emp.thr_amount || 0,
                    exgratia_amount: emp.exgratia_amount || 0,
                    other_income_amount: emp.other_income_amount || 0,
                };
            }

            // [FIX] Use pot_pph21 (actual deduction) as primary total to match Daftar Upah grand total
            // pph21_ter is calculated TER which may differ from actual deduction for some employees
            const actualPph21Total = result.employees.reduce((s: number, e: any) => s + (e.pot_pph21 ?? 0), 0);
            const payload = {
                tipe: "pajak_export",
                periode: { bulan: month, tahun: year },
                gang: gang || "ALL",
                generated_at: new Date().toISOString(),
                data_source: result.data_source,
                total_pph21: actualPph21Total,           // Matches Daftar Upah grand total
                total_pph21_input: actualPph21Total,   // Legacy alias (same value)
                total_pph21_ter: result.total_pph21,    // Calculated TER (for comparison)
                selisih_total: result.total_pph21 - actualPph21Total, // TER - actual
                employee_count: result.employees.length,
                employees: employeesMap,
            };

            const filename = `PAJAK_${gang || "ALL"}_${month}_${year}.json`;
            const jsonBody = JSON.stringify(payload);
            console.log(`[PayrollRoutes] /export/pajak: JSON size=${jsonBody.length} bytes, employees=${result.employees.length}`);

            return new Response(jsonBody, {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Disposition": `attachment; filename="${filename}"`,
                    "Content-Length": String(jsonBody.length)
                }
            });
        } catch (e: any) {
            console.error("[PayrollRoutes] /export/pajak error:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String(),
            gang: t.Optional(t.String()),
            div: t.Optional(t.String()),
            gang_prefix: t.Optional(t.String()),
            use_history: t.Optional(t.String()),
            snapshot_version: t.Optional(t.String()),
            value_priority_mode: t.Optional(t.String()),
        })
    })
    // --- Premium Definitions (from JSON file) ---
    .get("/premium-definitions", async ({ set }) => {
        try {
            set.headers["Cache-Control"] = "no-store, max-age=0";
            const { premiumDefinitionService } = await import("../services/premiumDefinitionService");
            const definitions = premiumDefinitionService.getActiveDefinitions();
            return { success: true, count: definitions.length, data: definitions };
        } catch (e: any) {
            console.error("[PayrollRoutes] premium-definitions GET error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    })
    .post("/premium-definitions", async ({ body, set }) => {
        try {
            const { premiumDefinitionService } = await import("../services/premiumDefinitionService");
            const data = body as any;
            premiumDefinitionService.addOrUpdateDefinition({
                adjustment_type: data.adjustment_type,
                adjustment_name: data.adjustment_name,
                ad_code: data.ad_code,
                task_desc: data.task_desc,
                input_type: data.input_type,
                is_active: data.is_active ?? true
            });
            return { success: true, message: "Premium definition saved." };
        } catch (e: any) {
            console.error("[PayrollRoutes] premium-definitions POST error:", e);
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            adjustment_name: t.String(),
            ad_code: t.String(),
            task_desc: t.String(),
            input_type: t.String(),
            adjustment_type: t.Optional(t.String()),
            is_active: t.Optional(t.Boolean())
        })
    })
    .post("/premium-import-excel", async ({ body, query, set }) => {
        try {
            const { importPremiumExcel } = await import("../services/premiumImportService");
            const { ManualAdjustmentService } = await import("../services/manualAdjustmentService");
            const file = (body as any)?.file;
            if (!file || !file.data) {
                set.status = 400;
                return { success: false, error: "File Excel wajib diunggah." };
            }
            const buffer = Buffer.from(file.data);
            const periodMonth = Number((query as any)?.period_month);
            const periodYear = Number((query as any)?.period_year);
            const divisionCode = String((query as any)?.division_code || 'ALL');
            if (!periodMonth || !periodYear) {
                set.status = 400;
                return { success: false, error: "period_month dan period_year wajib diisi." };
            }
            const service = ManualAdjustmentService.getInstance();
            const result = await importPremiumExcel(buffer, periodMonth, periodYear, divisionCode, service);
            if (!result.success) set.status = 400;
            return { success: result.success, ...result };
        } catch (e: any) {
            console.error("[PayrollRoutes] premium-import-excel error:", e);
            set.status = 500;
            return { success: false, error: e.message || "Gagal mengimpor Excel." };
        }
    })
    .post("/premium-import-excel", async ({ body, query, set }) => {
        try {
            const { importPremiumExcel } = await import("../services/premiumImportService");
            const { ManualAdjustmentService } = await import("../services/manualAdjustmentService");
            const file = (body as any)?.file;
            if (!file || !file.data) {
                set.status = 400;
                return { success: false, error: "File Excel wajib diunggah." };
            }
            const buffer = Buffer.from(file.data);
            const periodMonth = Number((query as any)?.period_month);
            const periodYear = Number((query as any)?.period_year);
            const divisionCode = String((query as any)?.division_code || 'ALL');
            if (!periodMonth || !periodYear) {
                set.status = 400;
                return { success: false, error: "period_month dan period_year wajib diisi." };
            }
            const service = ManualAdjustmentService.getInstance();
            const result = await importPremiumExcel(buffer, periodMonth, periodYear, divisionCode, service);
            if (!result.success) set.status = 400;
            return { success: result.success, ...result };
        } catch (e: any) {
            console.error("[PayrollRoutes] premium-import-excel error:", e);
            set.status = 500;
            return { success: false, error: e.message || "Gagal mengimpor Excel." };
        }
    })
