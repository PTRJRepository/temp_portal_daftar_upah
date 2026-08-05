/**
 * Aggregation Seeding Routes
 * API endpoints for triggering and managing aggregation seeding to extend_db_ptrj
 * Always uses server_profile_1 for extend_db_ptrj connection
 */

import { Elysia, t } from "elysia";
import { Database } from "../db/client";
import { dataExtractorService } from "../services/dataExtractorService";
import { divisionDefinition } from "../services/divisionDefinition";

import { Config } from "../config";
import { PayrollDataService, AggregationRecord } from "../services/payrollDataService";
import { getForwardAuthorizationHeader } from "../utils/authBypass";

// Interface moved to PayrollDataService


interface SeedResult {
    division: string;
    gang: string;
    employees_processed: number;
    status: string;
}

// Global progress tracker
let seederProgress: {
    is_running: boolean;
    current_division: string;
    current_gang: string;
    divisions_total: number;
    divisions_done: number;
    current_batch: number;
    total_batches: number;
    started_at: string | null;
    last_update: string;
    message: string;
} = {
    is_running: false,
    current_division: '',
    current_gang: '',
    divisions_total: 0,
    divisions_done: 0,
    current_batch: 0,
    total_batches: 0,
    started_at: null,
    last_update: '',
    message: 'Idle'
};

function updateProgress(update: Partial<typeof seederProgress>) {
    Object.assign(seederProgress, update, { last_update: new Date().toISOString() });
    console.log(`[SeederProgress] ${update.message || update.current_division || 'Updating...'}`);
}

export { seederProgress, updateProgress };

export const aggregationSeederRoutes = new Elysia({ prefix: "/payroll/aggregation" })
    .get("/progress", async () => {
        return {
            success: true,
            progress: seederProgress,
            elapsed_seconds: seederProgress.started_at 
                ? Math.floor((Date.now() - new Date(seederProgress.started_at).getTime()) / 1000)
                : 0
        };
    })
    .get("/health", async () => {
        const db = Database.getExtendedInstance();
        try {
            await db.query("SELECT 1");
            return {
                success: true,
                message: `extend_db_ptrj connection successful (${Config.DB_EXTEND_PROFILE})`,
                profile: Config.DB_EXTEND_PROFILE,
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Connection failed: ${error.message}`,
                profile: Config.DB_EXTEND_PROFILE,
                timestamp: new Date().toISOString()
            };
        }
    })
    .post("/seed", async ({ body, headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { division, month, year, force, useParallel } = body;

        try {
            let result;
            
            // Use parallel seeder if requested (faster)
            if (useParallel !== false) {  // Default to parallel
                const { seedAggregationParallel } = await import("./parallelAggregationSeeder");
                const divisions = division ? [division] : await fetchAvailableDivisions();
                result = await seedAggregationParallel(divisions, month, year, authHeader, force || false);
            } else {
                // Fallback to old sequential method (for compatibility)
                result = await seedAggregationToDb(division, month, year, authHeader, force || false);
            }
            
            return {
                success: true,
                data: result
            };
        } catch (error: any) {
            console.error("[AggregationSeeder] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to seed aggregation"
            };
        }
    }, {
        body: t.Object({
            division: t.Optional(t.String()),
            month: t.Numeric(),
            year: t.Numeric(),
            force: t.Optional(t.Boolean())
        })
    })
    // Seed based on exact UI filters (ensures 100% match with Daftar Upah)
    .post("/seed-ui", async ({ body, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { division, month, year, gangCode, gangPrefix } = body;

        try {
            const { seedFromUI } = await import("./uiBasedSeeder");
            const result = await seedFromUI(division, month, year, gangCode, gangPrefix);

            return {
                success: result.success,
                data: {
                    total_gangs: result.total_gangs,
                    total_employees: result.total_employees,
                    results: result.results
                }
            };
        } catch (error: any) {
            console.error("[UI Seeder] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to seed from UI"
            };
        }
    }, {
        body: t.Object({
            division: t.String(),
            month: t.Numeric(),
            year: t.Numeric(),
            gangCode: t.Optional(t.String()),
            gangPrefix: t.Optional(t.String())
        })
    })
    .post("/seed-tonase", async ({ body, headers, set }) => {
        // Seed ONLY tonase (FFB weight) from db_ptrj_mill (server_3)
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { month, year } = body;

        try {
            console.log(`[TonaseSeeder] Starting tonase-only seed for ${month}/${year}...`);
            const db = Database.getExtendedInstance();
            const millDb = Database.getMillInstance();

            // Get all PTRJ FFB records grouped by supplier
            const rows = await millDb.query<{ CustomerCode: string; SupplierName: string; total_weight: string }>(`
                SELECT 
                    T.[CustomerCode],
                    S.[Name] AS SupplierName,
                    SUM(CAST(T.[NetWeight] AS DECIMAL(18,2))) / 1000.0 AS total_weight
                FROM [dbo].[WM_TICKET] T
                LEFT JOIN [dbo].[PU_SUPPLIER] S ON T.[CustomerCode] = S.[SupplierCode]
                WHERE T.[CustomerCode] LIKE 'PTRJ%'
                  AND MONTH(T.[DateReceived]) = ?
                  AND YEAR(T.[DateReceived]) = ?
                  AND T.[ProductCode] = 'FFB'
                GROUP BY T.[CustomerCode], S.[Name]
            `, [month, year]);

            console.log(`[TonaseSeeder] Fetched ${rows.length} FFB records from db_ptrj_mill`);

            // Get all divisions that have aggregation data for this period
            const divisionRows = await db.query<{ division_code: string }>(`
                SELECT DISTINCT division_code
                FROM dbo.daftar_upah_aggregation_history
                WHERE period_month = ? AND period_year = ?
                  AND division_code IS NOT NULL
            `, [month, year]);

            const results: { division: string; tonase: number; status: string }[] = [];

            for (const divRow of divisionRows) {
                const divCode = divRow.division_code.trim();
                // Match tonase by checking if division code appears in supplier name or customer code
                let divTonase = 0;
                for (const row of rows) {
                    const supplierName = (row.SupplierName || '').toUpperCase();
                    const customerCode = (row.CustomerCode || '').toUpperCase();
                    const weight = parseFloat(row.total_weight) || 0;

                    if (supplierName.includes(divCode) || customerCode.includes(divCode)) {
                        divTonase += weight;
                    }
                }

                if (divTonase > 0) {
                    // Update all gang rows for this division with the tonase value
                    await db.query(`
                        UPDATE dbo.daftar_upah_aggregation_history
                        SET total_ffb_weight = ?, total_weight_tbs = ?, updated_at = GETDATE()
                        WHERE division_code = ? AND period_month = ? AND period_year = ?
                    `, [divTonase, divTonase, divCode, month, year]);

                    console.log(`[TonaseSeeder] ${divCode}: ${divTonase.toFixed(2)} tons → updated`);
                    results.push({ division: divCode, tonase: Math.round(divTonase * 100) / 100, status: 'UPDATED' });
                } else {
                    console.log(`[TonaseSeeder] ${divCode}: no tonase data found`);
                    results.push({ division: divCode, tonase: 0, status: 'NO_DATA' });
                }
            }

            return {
                success: true,
                message: `Tonase seeded for ${month}/${year}`,
                total_divisions: results.length,
                updated: results.filter(r => r.status === 'UPDATED').length,
                results
            };
        } catch (error: any) {
            console.error("[TonaseSeeder] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to seed tonase"
            };
        }
    }, {
        body: t.Object({
            month: t.Numeric(),
            year: t.Numeric()
        })
    })
    .get("/seed/progress", async ({ headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        try {
            // Import HistorySeederService to get its static progress
            const { HistorySeederService } = await import("../services/historySeederService");
            const progress = HistorySeederService.getProgress();

            return {
                success: true,
                data: progress
            };
        } catch (error: any) {
            console.error("[AggregationSeeder] Progress Error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch progress"
            };
        }
    })
    .get("/history", async ({ query, headers }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            return { success: false, error: "Unauthorized" };
        }

        const month = parseInt(query.month || "0");
        const year = parseInt(query.year || "0");
        const division = query.division;

        try {
            const db = Database.getExtendedInstance();

            let sql = `
                SELECT
                    id, period_month, period_year, division_code, gang_code, gang_description,
                    total_employees, total_hk, total_hari_kerja,
                    total_upah_dasar, total_upah_pokok, total_gaji_pokok,
                    total_beras, total_jabatan, total_masa_kerja, total_lembur, total_tunjangan,
                    total_premi_brondol, total_premi_prunning, total_premi_insentif, total_premi_kinerja,
                    total_premi, dynamic_premi_data, informasi_tambahan, total_koreksi,
                    total_potongan, total_pph21, total_bpjs_pekerja, total_bpjs_majikan, total_spsi,
                    total_upah_kotor, total_upah_bersih, total_ffb_weight, total_weight_tbs,
                    created_at, updated_at, source_endpoint
                FROM dbo.daftar_upah_aggregation_history
                WHERE 1=1
            `;

            const params: any[] = [];

            if (month > 0) {
                sql += " AND period_month = ?";
                params.push(month);
            }
            if (year > 0) {
                sql += " AND period_year = ?";
                params.push(year);
            }
            if (division) {
                sql += " AND division_code = ?";
                params.push(division);
            }

            sql += " ORDER BY division_code, gang_code";

            const records = await db.query<any>(sql, params.length > 0 ? params : undefined);

            return {
                success: true,
                data: records,
                count: records.length
            };
        } catch (error: any) {
            console.error("[AggregationHistory] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to fetch aggregation history",
                data: []
            };
        }
    })
    .get("/summary", async ({ query, headers }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            return { success: false, error: "Unauthorized" };
        }

        const month = parseInt(query.month || "0");
        const year = parseInt(query.year || "0");

        try {
            const db = Database.getExtendedInstance();

            const summary = await db.query<{
                division_code: string;
                gang_count: number;
                total_emp: number;
                total_hk: number;
                total_upah: number;
                total_premi: number;
                total_lembur: number;
                total_ffb: number;
                total_potongan: number;
                total_pph21: number;
                total_bpjs_pekerja: number;
                total_bpjs_majikan: number;
                total_spsi: number;
            }>(`
                WITH latest_rows AS (
                    SELECT
                        h.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY h.period_month, h.period_year, h.gang_code
                            ORDER BY COALESCE(h.updated_at, h.created_at) DESC, h.id DESC
                        ) as row_rank
                    FROM dbo.daftar_upah_aggregation_history h
                    WHERE h.period_month = ? AND h.period_year = ?
                )
                SELECT
                    h.division_code,
                    COUNT(*) as gang_count,
                    SUM(h.total_employees) as total_emp,
                    SUM(h.total_hk) as total_hk,
                    SUM(h.total_upah_bersih) as total_upah,
                    SUM(h.total_premi) as total_premi,
                    SUM(h.total_lembur) as total_lembur,
                    SUM(h.total_ffb_weight) as total_ffb,
                    SUM(h.total_potongan) as total_potongan,
                    SUM(h.total_pph21) as total_pph21,
                    SUM(h.total_bpjs_pekerja) as total_bpjs_pekerja,
                    SUM(h.total_bpjs_majikan) as total_bpjs_majikan,
                    SUM(h.total_spsi) as total_spsi
                FROM latest_rows h
                WHERE h.row_rank = 1
                GROUP BY h.division_code
                ORDER BY h.division_code
            `, [month, year]);

            const grandTotal = summary.reduce((acc, row) => ({
                division_code: "GRAND TOTAL",
                gang_count: acc.gang_count + (row.gang_count || 0),
                total_emp: acc.total_emp + (row.total_emp || 0),
                total_hk: acc.total_hk + (row.total_hk || 0),
                total_upah: acc.total_upah + (row.total_upah || 0),
                total_premi: acc.total_premi + (row.total_premi || 0),
                total_lembur: acc.total_lembur + (row.total_lembur || 0),
                total_ffb: acc.total_ffb + (row.total_ffb || 0),
                total_potongan: acc.total_potongan + (row.total_potongan || 0),
                total_pph21: acc.total_pph21 + (row.total_pph21 || 0),
                total_bpjs_pekerja: acc.total_bpjs_pekerja + (row.total_bpjs_pekerja || 0),
                total_bpjs_majikan: acc.total_bpjs_majikan + (row.total_bpjs_majikan || 0),
                total_spsi: acc.total_spsi + (row.total_spsi || 0)
            }), {
                division_code: "GRAND TOTAL",
                gang_count: 0,
                total_emp: 0,
                total_hk: 0,
                total_upah: 0,
                total_premi: 0,
                total_lembur: 0,
                total_ffb: 0,
                total_potongan: 0,
                total_pph21: 0,
                total_bpjs_pekerja: 0,
                total_bpjs_majikan: 0,
                total_spsi: 0
            });

            return {
                success: true,
                summary: summary,
                grand_total: grandTotal
            };
        } catch (error: any) {
            console.error("[AggregationSummary] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to fetch aggregation summary",
                summary: [],
                grand_total: null
            };
        }
    })
    .get("/divisions", async ({ headers }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            return { success: false, error: "Unauthorized" };
        }

        try {
            const db = Database.getExtendedInstance();

            const rows = await db.query<{ division_code: string }>(`
                SELECT DISTINCT division_code
                FROM dbo.daftar_upah_aggregation_history
                WHERE division_code IS NOT NULL
                ORDER BY division_code
            `);

            const divisions = rows.map(r => r.division_code);

            return {
                success: true,
                divisions: divisions
            };
        } catch (error: any) {
            console.error("[AggregationDivisions] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to fetch divisions",
                divisions: []
            };
        }
    })
    .get("/periods", async ({ headers }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            return { success: false, error: "Unauthorized" };
        }

        try {
            const db = Database.getExtendedInstance();

            const periods = await db.query<{ period_month: number; period_year: number }>(`
                SELECT DISTINCT period_month, period_year
                FROM dbo.daftar_upah_aggregation_history
                ORDER BY period_year DESC, period_month DESC
            `);

            return {
                success: true,
                periods: periods
            };
        } catch (error: any) {
            console.error("[AggregationPeriods] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to fetch periods",
                periods: []
            };
        }
    })
    .get("/status/:month/:year", async ({ params, headers }) => {
        // Check aggregation status for a specific period
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            return { success: false, error: "Unauthorized" };
        }

        const month = parseInt(params.month);
        const year = parseInt(params.year);

        try {
            const db = Database.getExtendedInstance();

            const statusRecords = await db.query<{
                division_code: string;
                gang_count: number;
            }>(`
                WITH latest_rows AS (
                    SELECT
                        h.division_code,
                        h.gang_code,
                        ROW_NUMBER() OVER (
                            PARTITION BY h.period_month, h.period_year, h.gang_code
                            ORDER BY COALESCE(h.updated_at, h.created_at) DESC, h.id DESC
                        ) as row_rank
                    FROM dbo.daftar_upah_aggregation_history h
                    WHERE h.period_month = ? AND h.period_year = ?
                )
                SELECT h.division_code, COUNT(*) as gang_count
                FROM latest_rows h
                WHERE h.row_rank = 1
                GROUP BY h.division_code
                ORDER BY h.division_code
            `, [month, year]);

            return {
                success: true,
                month,
                year,
                divisions: statusRecords,
                total_gangs: statusRecords.reduce((sum, r) => sum + (r.gang_count || 0), 0)
            };
        } catch (error: any) {
            console.error("[AggregationStatus] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to fetch aggregation status",
                divisions: [],
                total_gangs: 0
            };
        }
    })
    .get("/validate", async ({ query, headers }) => {
        // Validate aggregation totals against real-time payroll calculations
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            return { success: false, error: "Unauthorized" };
        }

        const month = parseInt(query.month);
        const year = parseInt(query.year);
        const divisionCode = query.division; // Optional: validate specific division only

        try {
            const db = Database.getExtendedInstance();

            // Get stored aggregation totals
            const aggWhereClauses = ["period_month = ?", "period_year = ?"];
            const aggParams: any[] = [month, year];
            let latestRowsFilter = "row_rank = 1";

            if (divisionCode) {
                latestRowsFilter += " AND division_code = ?";
                aggParams.push(divisionCode);
            }

            const aggQuery = `
                WITH latest_rows AS (
                    SELECT
                        division_code, gang_code, gang_description,
                        total_employees, total_hk, total_upah_bersih, total_premi,
                        total_lembur, total_pph21, total_spsi, total_potongan,
                        total_premi_insentif, total_premi_kinerja, total_premi_prunning, total_koreksi,
                        ROW_NUMBER() OVER (
                            PARTITION BY period_month, period_year, gang_code
                            ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                        ) as row_rank
                    FROM dbo.daftar_upah_aggregation_history
                    WHERE ${aggWhereClauses.join(" AND ")}
                )
                SELECT
                    division_code, gang_code, gang_description,
                    total_employees, total_hk, total_upah_bersih, total_premi,
                    total_lembur, total_pph21, total_spsi, total_potongan,
                    total_premi_insentif, total_premi_kinerja, total_premi_prunning, total_koreksi
                FROM latest_rows
                WHERE ${latestRowsFilter}
                ORDER BY division_code, gang_code
            `;

            const storedAggregations = await db.query<any>(aggQuery, aggParams);

            // Calculate real-time totals from payroll data
            const realTimeTotals: Record<string, any> = {};

            // Get divisions to validate
            const divisionsToValidate = divisionCode
                ? [divisionCode]
                : [...new Set(storedAggregations.map(a => a.division_code))];

            for (const div of divisionsToValidate) {
                // Extract payroll data using PayrollDataService (Source of Truth)
                try {
                    const authHeader = getForwardAuthorizationHeader(headers) || "";

                    const payrollData = await PayrollDataService.fetchPayrollData(div, month, year, authHeader);

                    // Flatten records from all source divisions
                    let allRecords: AggregationRecord[] = [];
                    Object.values(payrollData).forEach(records => {
                        allRecords = [...allRecords, ...records];
                    });

                    for (const record of allRecords) {
                        const gangCode = record.gang_code;
                        if (!gangCode) continue;

                        const gangKey = `${div}_${gangCode}`;

                        realTimeTotals[gangKey] = {
                            division_code: div,
                            gang_code: gangCode,
                            total_employees: record.total_employees,
                            total_hk: record.total_hk,
                            total_upah_bersih: record.total_upah_bersih,
                            total_premi: record.total_premi,
                            total_lembur: record.total_lembur,
                            total_pph21: record.total_pph21,
                            total_spsi: record.total_spsi,
                            total_potongan: record.total_potongan
                        };
                    }
                } catch (e) {
                    console.error(`[Validation] Failed to fetch payroll data for ${div}:`, e);
                }
            }

            // Log stored aggregation for comparison
            console.log(`[Validation] Stored aggregations found: ${storedAggregations.length}`);
            for (const stored of storedAggregations) {
                console.log(`[Validation] Stored ${stored.division_code}_${stored.gang_code}: upah_bersih=${stored.total_upah_bersih}, HK=${stored.total_hk}, employees=${stored.total_employees}`);
            }

            // Compare stored vs real-time totals
            const discrepancies: any[] = [];
            const tolerances = {
                total_employees: 0,      // Must be exact match
                total_hk: 0.01,          // Small floating point tolerance
                total_upah_bersih: 1,    // 1 rupiah tolerance
                total_premi: 1,
                total_lembur: 1,
                total_pph21: 1,
                total_spsi: 1,
                total_potongan: 1
            };

            for (const stored of storedAggregations) {
                const gangKey = `${stored.division_code}_${stored.gang_code}`;
                const realTime = realTimeTotals[gangKey];

                if (!realTime) {
                    discrepancies.push({
                        division_code: stored.division_code,
                        gang_code: stored.gang_code,
                        status: "MISSING_IN_REALTIME",
                        message: "Gang exists in aggregation but not found in real-time payroll data"
                    });
                    continue;
                }

                // Check each field for discrepancies
                const fieldDiscrepancies: any = {};
                for (const [field, tolerance] of Object.entries(tolerances)) {
                    const storedValue = parseFloat(stored[field]) || 0;
                    const realTimeValue = realTime[field] || 0;
                    const diff = Math.abs(storedValue - realTimeValue);

                    if (diff > tolerance) {
                        fieldDiscrepancies[field] = {
                            stored: storedValue,
                            real_time: realTimeValue,
                            difference: diff
                        };
                    }
                }

                if (Object.keys(fieldDiscrepancies).length > 0) {
                    discrepancies.push({
                        division_code: stored.division_code,
                        gang_code: stored.gang_code,
                        status: "DISCREPANCY_FOUND",
                        field_discrepancies: fieldDiscrepancies
                    });
                }
            }

            // Check for gangs in real-time but not in aggregation
            for (const [gangKey, realTime] of Object.entries(realTimeTotals)) {
                const exists = storedAggregations.some(s =>
                    s.division_code === realTime.division_code && s.gang_code === realTime.gang_code
                );
                if (!exists) {
                    discrepancies.push({
                        division_code: realTime.division_code,
                        gang_code: realTime.gang_code,
                        status: "MISSING_IN_AGGREGATION",
                        message: "Gang found in real-time payroll but not in aggregation table"
                    });
                }
            }

            // Calculate division totals summary
            const divisionSummaries: any[] = [];
            for (const div of divisionsToValidate) {
                const divStored = storedAggregations.filter(a => a.division_code === div);
                const divRealTime = Object.values(realTimeTotals).filter((r: any) => r.division_code === div);

                const storedTotal = divStored.reduce((sum, r) => sum + (parseFloat(r.total_upah_bersih) || 0), 0);
                const realTimeTotal = divRealTime.reduce((sum: number, r: any) => sum + (r.total_upah_bersih || 0), 0);

                divisionSummaries.push({
                    division_code: div,
                    stored_aggregation_total: storedTotal,
                    real_time_payroll_total: realTimeTotal,
                    difference: Math.abs(storedTotal - realTimeTotal),
                    is_match: Math.abs(storedTotal - realTimeTotal) < 1 // Within 1 rupiah tolerance
                });
            }

            return {
                success: true,
                month,
                year,
                division_code: divisionCode || "ALL",
                validation_timestamp: new Date().toISOString(),
                division_summaries: divisionSummaries,
                discrepancies_found: discrepancies.length,
                discrepancies: discrepancies.slice(0, 100), // Limit to first 100
                total_gangs_checked: storedAggregations.length
            };
        } catch (error: any) {
            console.error("[AggregationValidation] Error:", error);
            return {
                success: false,
                error: error.message || "Failed to validate aggregation",
                discrepancies: []
            };
        }
    });

// ===================== HELPER FUNCTIONS =====================

// Helper functions removed as they are now in PayrollDataService

export async function seedAggregationToDb(division: string | undefined, month: number, year: number, authToken: string, force: boolean = false) {
    // UPDATED: Now includes BOTH real and virtual divisions
    // Virtual divisions (WKS_PG, WKS_AR, NRS, INF, etc.) are now seeded separately
    // so they appear as distinct rows in reports, not computed at read time
    const divisions = division ? [division] : await fetchAvailableDivisions();

    // Determine target divisions based on what data exists
    let divisionsToProcess: string[] = [];

    if (division) {
        divisionsToProcess = divisions.filter(d => d === division);
    } else {
        // UPDATED: Include ALL divisions (real + virtual) for comprehensive reporting
        // This ensures virtual divisions have their own aggregated data in the database
        divisionsToProcess = divisions;
        console.log(`[AggregationSeeder] Bulk seeding ${divisionsToProcess.length} divisions (real + virtual): ${divisionsToProcess.join(', ')}`);
    }

    // [CLEANUP] Delete existing data for the target division(s) and period before seeding
    // This ensures a clean slate and prevents duplicate/stale data from previous seeding
    const db = Database.getExtendedInstance();
    for (const div of divisionsToProcess) {
        const dbDivisionCode = DIVISION_CODE_MAP[div] || div;
        console.log(`[AggregationSeeder] Cleaning existing data for ${dbDivisionCode} (${month}/${year})...`);
        
        try {
            const deleteResult = await db.query(`
                DELETE FROM dbo.daftar_upah_aggregation_history
                WHERE period_month = ? AND period_year = ? AND division_code = ?
            `, [month, year, dbDivisionCode]);
            
            const deletedCount = deleteResult?.rowsAffected || 0;
            if (deletedCount > 0) {
                console.log(`[AggregationSeeder] ✅ Deleted ${deletedCount} existing record(s) for ${dbDivisionCode}`);
            }
        } catch (deleteError: any) {
            console.warn(`[AggregationSeeder] ⚠️ Failed to cleanup ${dbDivisionCode}:`, deleteError.message);
            // Continue anyway - the per-gang delete in insertOrUpdateAggregation will handle duplicates
        }
    }

    const results: SeedResult[] = [];
    // Only difference: sourceEndpoint is now 'raw-tree-endpoint'
    const sourceEndpoint = "raw-tree-endpoint";
    const divisionTotals: Record<string, number> = {};

    for (const div of divisionsToProcess) {
        console.log(`[AggregationSeeder] Processing division: ${div} (${month}/${year})`);

        // Check if this is a virtual division
        const isVirtual = divisionDefinition.isVirtualDivision(div);

        let divisionsToQuery: string[];
        let targetDivisionCode: string; // The division code to use when inserting to aggregation

        // NOTE: MILL must be checked BEFORE virtual division check because
        // DivisionConfigService classifies MILL as type='virtual', but it needs special handling
        if (div === 'MILL') {
            // MILL SPECIAL LOGIC
            console.log(`[AggregationSeeder] Processing MILL division using VenusHR data...`);
            try {
                const millData = await fetchMillData(month, year);

                // fetchMillData now returns a complete AggregationRecord - use directly
                targetDivisionCode = div;
                await insertOrUpdateAggregation(targetDivisionCode, month, year, millData, sourceEndpoint);

                // Assuming success if no error thrown
                if (true) {
                    results.push({ division: div, gang: millData.gang_code, employees_processed: millData.total_employees, status: "SUCCESS" });
                } else {
                    results.push({ division: div, gang: "MILL_GENERAL", employees_processed: 0, status: "SKIPPED/FAILED" });
                }
                continue; // Skip standard processing
            } catch (e: any) {
                console.error("[AggregationSeeder] MILL Error:", e);
                results.push({ division: div, gang: "MILL_GENERAL", employees_processed: 0, status: "ERROR: " + e.message });
                continue;
            }
        } else if (isVirtual) {
            // For virtual divisions, we still rely on PayrollDataService to handle the source querying
            // But for the seeder, we iterate differently.
            // Actually PayrollDataService handles the mapping of division -> records.
            // So we can simplify this loop significantly.

            // However, to minimize risk of changing logic, I will keep the outer loop structure
            // but use PayrollDataService to fetch the data.

            // Virtual division logic is now encapsulated in PayrollDataService.fetchPayrollData
            // But we need to know the target division code.
            targetDivisionCode = div;
            console.log(`[AggregationSeeder] Virtual division ${div} processing...`);

            // Use PayrollDataService to fetch data
            // For virtual divisions, it returns data for all source divisions.
            // For normal divisions, it returns data for just that division.
            // We need to aggregate them if it's a virtual division?
            // PayrollDataService.fetchPayrollData returns Record<sourceDiv, AggregationRecord[]>

            try {
                const payrollData = await PayrollDataService.fetchPayrollData(div, month, year, authToken);

                // Collect all records from all returned source divisions
                let allRecords: AggregationRecord[] = [];
                Object.values(payrollData).forEach(records => {
                    allRecords = [...allRecords, ...records];
                });

                if (allRecords.length === 0) {
                    console.log(`[AggregationSeeder] No data found for ${div}`);
                    results.push({ division: div, gang: "ALL", employees_processed: 0, status: "SKIPPED: No data" });
                    continue;
                }

                console.log(`[AggregationSeeder] Fetched ${allRecords.length} records for ${div}`);

                let savedCount = 0;
                let totalEmployees = 0;

                for (const record of allRecords) {
                    // DEBUG: Log PPh21 values being stored
                    console.log(`[AggregationSeeder] ${record.gang_code}: total_pph21=${record.total_pph21}, pot_pph21 source`);

                    // Insert into DB
                    // Note: We use targetDivisionCode (e.g. ESTATE_A_VIRTUAL) even if data came from source (ESTATE_A_1)
                    // This matches previous logic?
                    // Wait, previous logic: "targetDivisionCode = div" (virtual)
                    // And inside loop: "Iterate source divisions" -> "fetchRawTreeData(sourceDiv)"
                    // -> "insertOrUpdateAggregation(targetDivisionCode, ..., record)"
                    // Yes, so we map all records to the targetDivisionCode.

                    await insertOrUpdateAggregation(targetDivisionCode, month, year, record, sourceEndpoint);
                    savedCount++;
                    totalEmployees += record.total_employees;
                }

                // [FIX] Trigger detailed history seeding for this division
                // This ensures that pages requiring detailed history (like Report Pajak) have data.
                // Note: We seed 'div' which is the internal division code (e.g. PG1A)
                try {
                    if (div !== 'MILL') {
                        console.log(`[AggregationSeeder] Auto-triggering history seeder for ${div}...`);
                        const { historySeederService } = await import("../services/historySeederService");
                        await historySeederService.seedPayrollHistory({
                            periodMonth: month,
                            periodYear: year,
                            divisionCode: div,
                            seederMode: 'PAYROLL',
                            force: true
                        });
                        console.log(`[AggregationSeeder] History seeding complete for ${div}`);
                    }
                } catch (historyError: any) {
                    console.error(`[AggregationSeeder] History seeding failed for ${div}:`, historyError.message);
                    // We don't fail the whole aggregation seeder if history seeder fails
                }

                results.push({
                    division: div,
                    gang: `Count: ${savedCount}`,
                    employees_processed: totalEmployees,
                    status: "SUCCESS"
                });

            } catch (error: any) {
                console.error(`[AggregationSeeder] Error processing ${div}:`, error);
                results.push({ division: div, gang: "ALL", employees_processed: 0, status: "ERROR: " + error.message });
            }
        } else {
            targetDivisionCode = div;

            // Use PayrollDataService to fetch data
            // For normal divisions, it returns data for just that division.
            try {
                const payrollData = await PayrollDataService.fetchPayrollData(div, month, year, authToken);

                // Collect all records from all returned source divisions
                let allRecords: AggregationRecord[] = [];
                Object.values(payrollData).forEach(records => {
                    allRecords = [...allRecords, ...records];
                });

                if (allRecords.length === 0) {
                    console.log(`[AggregationSeeder] No data found for ${div}`);
                    results.push({ division: div, gang: "ALL", employees_processed: 0, status: "SKIPPED: No data" });
                    continue;
                }

                console.log(`[AggregationSeeder] Fetched ${allRecords.length} records for ${div}`);

                let savedCount = 0;
                let totalEmployees = 0;

                for (const record of allRecords) {
                    // DEBUG: Log PPh21 values being stored
                    console.log(`[AggregationSeeder] ${record.gang_code}: total_pph21=${record.total_pph21}, pot_pph21 source`);

                    // Insert into DB
                    await insertOrUpdateAggregation(targetDivisionCode, month, year, record, sourceEndpoint);
                    savedCount++;
                    totalEmployees += record.total_employees;
                }

                // [FIX] Trigger detailed history seeding for this division
                // This ensures that pages requiring detailed history (like Report Pajak) have data.
                try {
                    console.log(`[AggregationSeeder] Auto-triggering history seeder for ${div}...`);
                    const { historySeederService } = await import("../services/historySeederService");
                    await historySeederService.seedPayrollHistory({
                        periodMonth: month,
                        periodYear: year,
                        divisionCode: div,
                        seederMode: 'PAYROLL',
                        force: true
                    });
                    console.log(`[AggregationSeeder] History seeding complete for ${div}`);
                } catch (historyError: any) {
                    console.error(`[AggregationSeeder] History seeding failed for ${div}:`, historyError.message);
                    // We don't fail the whole aggregation seeder if history seeder fails
                }

                results.push({
                    division: div,
                    gang: `Count: ${savedCount}`,
                    employees_processed: totalEmployees,
                    status: "SUCCESS"
                });

            } catch (error: any) {
                console.error(`[AggregationSeeder] Error processing ${div}:`, error);
                results.push({ division: div, gang: "ALL", employees_processed: 0, status: "ERROR: " + error.message });
            }
        }
    }

    return {
        total_divisions: results.filter(r => r.status === 'SUCCESS').length,
        processed: results
    };
}







// Process each gang from the raw-tree response






async function fetchAvailableDivisions(): Promise<string[]> {
    // UPDATED: Get ALL divisions (real + virtual) + MILL
    // Virtual divisions are now seeded separately for distinct reporting
    const allDivisions = await divisionDefinition.getAllDivisions(true); // true = include virtual
    return [...allDivisions, 'MILL']; // MILL is special
}

async function checkDivisionHasData(division: string, month: number, year: number): Promise<boolean> {
    try {
        // Use Config.DB_PROFILE for payroll data (main payroll database)
        const result = await dataExtractorService.extractPayrollData(
            month, year, "ALL", division, null, Config.DB_PROFILE
        );
        return result.data_rows && result.data_rows.length > 0;
    } catch {
        return false;
    }
}

/**
 * APPEND-ONLY: Insert aggregation data as a new version record.
 *
 * IMPORTANT: Data Append-Only Pattern (Immutable History)
 * - NEUKAR data existing. Selalu INSERT record baru.
 * - version_index = MAX(version_index) + 1 untuk (gang_code, period_month, period_year) yang sama.
 * - Untuk mengambil data terbaru: SELECT ... WHERE ... ORDER BY version_index DESC
 * - Setiap seeding menghasilkan record baru. Data lama tetap tersimpan.
 *
 * Kenapa: Agar history seeding lengkap dan bisa di-tracking, dan tidak ada
 * data yang ter-overwrite tanpa jejak.
 */
async function insertOrUpdateAggregation(
    division: string,
    month: number,
    year: number,
    aggregation: AggregationRecord,
    sourceEndpoint: string
) {
    const db = Database.getExtendedInstance();

    // Map internal division code to DB standardized code (e.g. PG1A -> P1A)
    const dbDivisionCode = DIVISION_CODE_MAP[division] || division;

    try {
        // [FIX] Delete existing records for this gang/period to prevent duplication
        // This ensures idempotent seeding - running seeder multiple times produces same result
        await db.query(`
            DELETE FROM dbo.daftar_upah_aggregation_history
            WHERE period_month = ? AND period_year = ? AND division_code = ? AND gang_code = ?
        `, [month, year, dbDivisionCode, aggregation.gang_code]);

        // INSERT new record with latest data
        // GETDATE() is used directly in SQL for timestamp fields
        await db.query(`
            INSERT INTO dbo.daftar_upah_aggregation_history (
                period_month, period_year, division_code, gang_code, gang_description,
                total_employees, total_hk, total_hari_kerja,
                total_cuti_tahunan, total_cuti_sakit, total_cuti_minggu, total_cuti_nasional,
                total_upah_dasar, total_upah_pokok, total_gaji_pokok,
                total_beras, total_jabatan, total_masa_kerja, total_lembur, total_tunjangan,
                total_premi_brondol, total_premi_prunning, total_premi_insentif, total_premi_kinerja, total_premi,
                total_potongan, total_pph21, total_bpjs_pekerja, total_bpjs_majikan, total_spsi,
                total_upah_kotor, total_upah_bersih, total_ffb_weight, total_weight_tbs,
                dynamic_premi_data, informasi_tambahan, total_koreksi,
                created_at, updated_at, source_endpoint
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, GETDATE(), GETDATE(), ?
            )
        `, [
            month,
            year,
            dbDivisionCode,
            aggregation.gang_code,
            aggregation.gang_description,
            aggregation.total_employees,
            aggregation.total_hk,
            aggregation.total_hari_kerja,
            aggregation.total_cuti_tahunan,
            aggregation.total_cuti_sakit,
            aggregation.total_cuti_minggu,
            aggregation.total_cuti_nasional,
            aggregation.total_upah_dasar,
            aggregation.total_upah_pokok,
            aggregation.total_gaji_pokok,
            aggregation.total_beras,
            aggregation.total_jabatan,
            aggregation.total_masa_kerja,
            aggregation.total_lembur,
            aggregation.total_tunjangan,
            aggregation.total_premi_brondol,
            aggregation.total_premi_prunning,
            aggregation.total_premi_insentif,
            aggregation.total_premi_kinerja,
            aggregation.total_premi,
            aggregation.total_potongan,
            aggregation.total_pph21,
            aggregation.total_bpjs_pekerja,
            aggregation.total_bpjs_majikan,
            aggregation.total_spsi,
            aggregation.total_upah_kotor,
            aggregation.total_upah_bersih,
            aggregation.total_ffb_weight,
            aggregation.total_weight_tbs,
            aggregation.dynamic_premi_data,
            aggregation.informasi_tambahan,
            aggregation.total_koreksi,
            sourceEndpoint
        ]);
    } catch (error) {
        console.error("[InsertAggregation] Error:", error);
        throw error;
    }
}

// Division mapping for standardization (Internal -> DB/Mill)
const DIVISION_CODE_MAP: Record<string, string> = {
    "PG1A": "P1A", "PG1B": "P1B", "PG2A": "P2A", "PG2B": "P2B",
    "ARB1": "AB1", "ARB2": "AB2",
    "INFRA": "INF", "ARC": "ARC",
    // Ensure 3-letter codes map to themselves or remain as is if not in list
    "DME": "DME", "ARA": "ARA", "IJL": "IJL", "MILL": "MILL"
};

async function fetchFfbWeightForDivision(divisionCode: string, month: number, year: number): Promise<number> {
    try {
        const db = Database.getMillInstance();

        // Use mapped code if available, otherwise original
        const searchCode = DIVISION_CODE_MAP[divisionCode] || divisionCode;

        // Use fuzzy match for division code in both SupplierName and CustomerCode
        const matchPattern = `%${searchCode}%`;

        const result = await db.queryOne<{ total_weight: string }>(`
            SELECT SUM(CAST(T.[NetWeight] AS DECIMAL(18,2))) / 1000.0 AS total_weight
            FROM [dbo].[WM_TICKET] T
            LEFT JOIN [dbo].[PU_SUPPLIER] S ON T.[CustomerCode] = S.[SupplierCode]
            WHERE T.[CustomerCode] LIKE 'PTRJ%'
              AND MONTH(T.[DateReceived]) = ?
              AND YEAR(T.[DateReceived]) = ?
              AND T.[ProductCode] = 'FFB'
              AND (S.[Name] LIKE ? OR T.[CustomerCode] LIKE ?)
        `, [month, year, matchPattern, matchPattern]);

        if (result && result.total_weight) {
            const weight = parseFloat(result.total_weight);
            console.log(`[FFB] ${divisionCode} (mapped: ${searchCode}): ${weight.toFixed(2)} tons`);
            return weight;
        }

        // Debug: List available suppliers for this period if no match
        // This helps us see if the division name is different (e.g. 'DME' vs 'Darrur Makmur Estate')
        const debugCheck = await db.query<{ Code: string, Name: string }>(`
            SELECT DISTINCT TOP 5 T.CustomerCode as Code, S.Name
            FROM [dbo].[WM_TICKET] T
            LEFT JOIN [dbo].[PU_SUPPLIER] S ON T.[CustomerCode] = S.[SupplierCode]
            WHERE T.[CustomerCode] LIKE 'PTRJ%'
              AND MONTH(T.[DateReceived]) = ?
              AND YEAR(T.[DateReceived]) = ?
        `, [month, year]);

        const available = debugCheck.map(r => `${r.Code} (${r.Name})`).join(", ");
        console.log(`[FFB] ${divisionCode}: No data found. Available PTRJ suppliers: [${available || 'NONE'}]`);

        return 0;
    } catch (error: any) {
        // If table doesn't exist or other error, log and return 0
        if (error.message?.includes('Invalid object name') || error.message?.includes('does not exist')) {
            console.warn(`[FFB] WM_TICKET/PU_SUPPLIER table not found in db_ptrj_mill, using 0`);
        } else {
            console.error(`[FFB] Failed to fetch weight for ${divisionCode}:`, error.message);
        }
        return 0;
    }
}


/**
 * Fetch Mill Data from VenusHR database (SERVER_PROFILE_3)
 */
export async function fetchMillData(month: number, year: number) {
    const db = Database.getVenusInstance();
    const monthStr = month.toString().padStart(2, '0');
    const pyNumberPattern = `PYW/PTRJ/${year}${monthStr}%`;

    console.log(`[AggregationSeeder] Fetching MILL data for pattern: ${pyNumberPattern}`);

    // 1. Get Total HK and Employees
    // Using provided logic: (Total_Data_Karyawan * DaysInMonth) - (Total_Mangkir + Total_Unpaid_Leave + Total_Sakit_With_Note)
    const hkQuery = `
        SELECT 
            (Total_Data_Karyawan * DaysInMonth) - (Total_Mangkir + Total_Unpaid_Leave + Total_Sakit_With_Note) AS total_HK,
            Total_Data_Karyawan AS total_employees
        FROM (
            SELECT 
                COUNT([EmployeeID]) AS Total_Data_Karyawan,
                SUM(ISNULL([TAAbsence], 0)) AS Total_Mangkir,
                SUM(ISNULL([UnpaidLeave], 0)) AS Total_Unpaid_Leave,
                SUM(ISNULL([TASick], 0)) AS Total_Sakit_With_Note,
                DAY(EOMONTH(CAST(SUBSTRING(MAX([PYNumber]), 10, 6) + '01' AS DATE))) AS DaysInMonth
            FROM [dbo].[HR_T_PYWeekly_M]
            WHERE [PYNumber] LIKE ? 
        ) AS Subquery;
    `;

    const hkResult = await db.queryOne<{ total_HK: number, total_employees: number }>(hkQuery, [pyNumberPattern]);

    // 2. Get Gaji Bersih (Net Salary) - IsTakeHomePay = 1
    const salaryQuery = `
        SELECT CAST(SUM(CAST([CompAmount] AS DECIMAL(18,2))) AS BIGINT) AS TotalCompAmount
        FROM [dbo].[HR_T_PYWeekly_DComponent]
        WHERE [PYNumber] LIKE ?
          AND [IsTakeHomePay] = 1
    `;
    const salaryResult = await db.queryOne<{ TotalCompAmount: number }>(salaryQuery, [pyNumberPattern]);

    // 3. Get PPh21
    const pphQuery = `
        SELECT CAST(SUM(ABS(CAST([CompAmount] AS DECIMAL(18,2)))) AS BIGINT) AS totalCount
        FROM [dbo].[HR_T_PYWeekly_DComponent]
        WHERE [PYNumber] LIKE ?
          AND [PYCompCode] LIKE '#PPH21%'
    `;
    const pphResult = await db.queryOne<{ totalCount: number }>(pphQuery, [pyNumberPattern]);

    // 4. Get SPSI
    const spsiQuery = `
        SELECT CAST(SUM(ABS(CAST([CompAmount] AS DECIMAL(18,2)))) AS BIGINT) AS totalCount
        FROM [dbo].[HR_T_PYWeekly_DComponent]
        WHERE [PYNumber] LIKE ?
          AND [PYCompCode] LIKE '#POT_spsi%'
    `;
    const spsiResult = await db.queryOne<{ totalCount: number }>(spsiQuery, [pyNumberPattern]);

    // 5. Get Overtime
    const otQuery = `
        SELECT CAST(SUM(CAST([CompAmount] AS DECIMAL(18,2))) AS BIGINT) AS totalCount
        FROM [dbo].[HR_T_PYWeekly_DComponent]
        WHERE [PYNumber] LIKE ?
          AND [PYCompCode] LIKE '%#OT%'
    `;
    const otResult = await db.queryOne<{ totalCount: number }>(otQuery, [pyNumberPattern]);

    // 6. Get Gaji Pokok
    const gpQuery = `
        SELECT CAST(SUM(CAST([CompAmount] AS DECIMAL(18,2))) AS BIGINT) AS totalCount
        FROM [dbo].[HR_T_PYWeekly_DComponent]
        WHERE [PYNumber] LIKE ?
          AND [PYCompCode] = '#GP#'
    `;
    const gpResult = await db.queryOne<{ totalCount: number }>(gpQuery, [pyNumberPattern]);

    // 7. Get Total Deductions (all negative components with IsTakeHomePay=1)
    // Note: CompAmount is stored as nvarchar, use CASE to safely convert
    const dedQuery = `
        SELECT CAST(SUM(CASE WHEN TRY_CAST([CompAmount] AS DECIMAL(18,2)) < 0
                              THEN ABS(TRY_CAST([CompAmount] AS DECIMAL(18,2)))
                              ELSE 0 END) AS BIGINT) AS totalCount
        FROM [dbo].[HR_T_PYWeekly_DComponent]
        WHERE [PYNumber] LIKE ?
          AND [IsTakeHomePay] = 1
    `;
    const dedResult = await db.queryOne<{ totalCount: number }>(dedQuery, [pyNumberPattern]);

    // Log raw results for debugging
    console.log(`[fetchMillData] Salary breakdown:`, {
        gaji_bersih: salaryResult?.TotalCompAmount,
        pph21: pphResult?.totalCount,
        spsi: spsiResult?.totalCount,
        overtime: otResult?.totalCount,
        gaji_pokok: gpResult?.totalCount,
        deductions: dedResult?.totalCount
    });

    // Ensure all values are proper numbers (not BigInt or strings from gateway)
    const bersih = Number(salaryResult?.TotalCompAmount) || 0;
    const pph21 = Math.abs(Number(pphResult?.totalCount) || 0);
    const spsi = Math.abs(Number(spsiResult?.totalCount) || 0);
    const lembur = Math.abs(Number(otResult?.totalCount) || 0);
    const gp = Number(gpResult?.totalCount) || 0;
    const deductions = Math.abs(Number(dedResult?.totalCount) || 0);

    console.log(`[fetchMillData] Processed values:`, { bersih, pph21, spsi, lembur, gp, deductions });

    return {
        total_hk: Number(hkResult?.total_HK) || 0,
        total_employees: Number(hkResult?.total_employees) || 0,
        total_upah_bersih: bersih,  // net/gaji bersih (from IsTakeHomePay=1)
        total_upah_kotor: bersih + deductions,  // gross = net + deductions
        total_pph21: pph21,
        total_spsi: spsi,
        total_lembur: lembur,
        total_gaji_pokok: gp,
        total_potongan: deductions,  // total deductions
        total_tunjangan: 0,  // Not available separately in MILL data
        total_upah_dasar: gp,
        total_upah_pokok: gp,
        gang_code: "MILL_GENERAL",
        gang_description: "General Mill Operations",
        total_hari_kerja: Number(hkResult?.total_HK) || 0,
        total_cuti_tahunan: 0, total_cuti_sakit: 0, total_cuti_minggu: 0, total_cuti_nasional: 0,
        total_beras: 0, total_jabatan: 0, total_masa_kerja: 0,
        total_premi_brondol: 0, total_premi_prunning: 0, total_premi_insentif: 0, total_premi_kinerja: 0, total_premi: 0,
        total_bpjs_pekerja: 0, total_bpjs_majikan: 0,
        total_ffb_weight: 0, total_weight_tbs: 0,
        dynamic_premi_data: "[]", informasi_tambahan: "Source: VenusHR", total_koreksi: 0
    };
}


