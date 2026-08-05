/**
 * History Routes
 * 
 * API endpoints untuk operasi history payroll:
 * - POST /payroll/history/seed - Menyimpan data history dari periode tertentu
 * - GET /payroll/history - Mengambil data history
 * - GET /payroll/history/:id - Mengambil detail history
 * - DELETE /payroll/history/:id - Menghapus data history
 * - POST /payroll/history/:id/lock - Mengunci data history
 * - GET /payroll/history/audit - Audit trail
 */

import { Elysia, t } from "elysia";
import { historyDatabaseService } from "../services/historyDatabaseService";
import { historySeederService, SeederOptions, HistorySeederService } from "../services/historySeederService";
import { Config } from "../config";
import { currentPeriodService } from "../services/currentPeriodService";
import { ptkpTaxService } from "../services/ptkpTaxService";
import { ptkpExcelDryRunService } from "../services/ptkpExcelDryRunService";
import { upahBersihDetailService, FilterMode } from "../services/upahBersihDetailService";
import {
    getForwardAuthorizationHeader,
    hasValidApiKeyBypass
} from "../utils/authBypass";

// Helper to get month name in Indonesian
function getMonthName(month: number): string {
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return months[month - 1] || '';
}

// Helper to get client IP
function getClientIP(headers: Record<string, string | undefined>): string {
    return headers["x-forwarded-for"] ||
        headers["x-real-ip"] ||
        headers["remote-addr"] ||
        "unknown";
}

export const historyRoutes = new Elysia({ prefix: "/payroll/history" })
    // Health check
    .get("/health", async () => {
        const isHistoryMode = historyDatabaseService.isHistoryMode();
        return {
            success: true,
            history_mode: isHistoryMode,
            run_mode: Config.RUN_MODE,
            mode: Config.RUN_MODE, // Added for frontend compatibility
            databases: {
                payroll: isHistoryMode ? Config.DB_EXTEND_DATABASE : Config.DEFAULT_DATABASE,
                transaction: isHistoryMode ? process.env.DB_EXTEND_TRANS_DATABASE : Config.DEFAULT_DATABASE
            },
            timestamp: new Date().toISOString()
        };
    })

    // Seeder progress (poll every 2s from frontend)
    .get("/seed/progress", () => {
        return HistorySeederService.getProgress();
    })

    // Force reset seeder (for stuck seeder recovery)
    .post("/seed/reset", async ({ body, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { reason } = body;
        console.log(`[HistoryRoutes] Force resetting seeder. Reason: ${reason || 'Not provided'}`);
        
        HistorySeederService.forceReset(reason || 'Manual reset from API');
        
        return {
            success: true,
            message: 'Seeder has been reset successfully',
            reason: reason || 'Manual reset'
        };
    }, {
        body: t.Object({
            reason: t.Optional(t.String())
        })
    })

    // Run migration: adds missing columns to payroll_history_detail / history_metadata
    // Call once after deploying the updated codebase.
    .post("/migrate", async ({ headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const db = historyDatabaseService.getPayrollDatabase();
        const results: { stmt: string; status: string; error?: string }[] = [];

        const migrations = [
            // payroll_history_detail: missing rate/detail snapshot columns
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='beras_rate') ALTER TABLE dbo.payroll_history_detail ADD beras_rate DECIMAL(18,4) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='jabatan_rate') ALTER TABLE dbo.payroll_history_detail ADD jabatan_rate DECIMAL(18,4) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='masa_kerja_rate') ALTER TABLE dbo.payroll_history_detail ADD masa_kerja_rate DECIMAL(18,4) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='lembur_jam') ALTER TABLE dbo.payroll_history_detail ADD lembur_jam DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='lembur_rate') ALTER TABLE dbo.payroll_history_detail ADD lembur_rate DECIMAL(18,4) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='lembur_records') ALTER TABLE dbo.payroll_history_detail ADD lembur_records NVARCHAR(MAX) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='total_tunjangan') ALTER TABLE dbo.payroll_history_detail ADD total_tunjangan DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='upah_pokok') ALTER TABLE dbo.payroll_history_detail ADD upah_pokok DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='premi_brondol_loosefruit') ALTER TABLE dbo.payroll_history_detail ADD premi_brondol_loosefruit DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='premi_brondol_adtrans') ALTER TABLE dbo.payroll_history_detail ADD premi_brondol_adtrans DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='premi_brondol_total') ALTER TABLE dbo.payroll_history_detail ADD premi_brondol_total DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='premi_pph') ALTER TABLE dbo.payroll_history_detail ADD premi_pph DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='premi_detail') ALTER TABLE dbo.payroll_history_detail ADD premi_detail NVARCHAR(MAX) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='pot_astek_pekerja') ALTER TABLE dbo.payroll_history_detail ADD pot_astek_pekerja DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='pot_astek_majikan') ALTER TABLE dbo.payroll_history_detail ADD pot_astek_majikan DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='pot_astek_jumlah') ALTER TABLE dbo.payroll_history_detail ADD pot_astek_jumlah DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='potongan_detail') ALTER TABLE dbo.payroll_history_detail ADD potongan_detail NVARCHAR(MAX) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='total_potongan_bersih') ALTER TABLE dbo.payroll_history_detail ADD total_potongan_bersih DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='upah_kotor_pajak') ALTER TABLE dbo.payroll_history_detail ADD upah_kotor_pajak DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='penghasilan_bruto') ALTER TABLE dbo.payroll_history_detail ADD penghasilan_bruto DECIMAL(18,2) NULL DEFAULT 0`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='task_code') ALTER TABLE dbo.payroll_history_detail ADD task_code VARCHAR(20) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='task_desc') ALTER TABLE dbo.payroll_history_detail ADD task_desc NVARCHAR(100) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='shortage_details') ALTER TABLE dbo.payroll_history_detail ADD shortage_details NVARCHAR(MAX) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='shortage_total_hours') ALTER TABLE dbo.payroll_history_detail ADD shortage_total_hours DECIMAL(18,2) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='jabatan') ALTER TABLE dbo.payroll_history_detail ADD jabatan NVARCHAR(100) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='is_spsi_member') ALTER TABLE dbo.payroll_history_detail ADD is_spsi_member BIT NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='new_nik') ALTER TABLE dbo.payroll_history_detail ADD new_nik VARCHAR(50) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='snapshot_batch_id') ALTER TABLE dbo.payroll_history_detail ADD snapshot_batch_id BIGINT NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='snapshot_version') ALTER TABLE dbo.payroll_history_detail ADD snapshot_version INT NULL`,
            // payroll_history_header: snapshot linkage
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_header' AND COLUMN_NAME='snapshot_batch_id') ALTER TABLE dbo.payroll_history_header ADD snapshot_batch_id BIGINT NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='payroll_history_header' AND COLUMN_NAME='snapshot_version') ALTER TABLE dbo.payroll_history_header ADD snapshot_version INT NULL`,
            // history_metadata: missing audit columns
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='operation') ALTER TABLE dbo.history_metadata ADD operation VARCHAR(20) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='entity_type') ALTER TABLE dbo.history_metadata ADD entity_type VARCHAR(30) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='entity_id') ALTER TABLE dbo.history_metadata ADD entity_id INT NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='gang_code') ALTER TABLE dbo.history_metadata ADD gang_code VARCHAR(20) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='description') ALTER TABLE dbo.history_metadata ADD description NVARCHAR(255) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='old_values') ALTER TABLE dbo.history_metadata ADD old_values NVARCHAR(MAX) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='new_values') ALTER TABLE dbo.history_metadata ADD new_values NVARCHAR(MAX) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='record_count') ALTER TABLE dbo.history_metadata ADD record_count INT NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='status') ALTER TABLE dbo.history_metadata ADD status VARCHAR(20) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='error_message') ALTER TABLE dbo.history_metadata ADD error_message NVARCHAR(MAX) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='performed_by') ALTER TABLE dbo.history_metadata ADD performed_by VARCHAR(100) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='performed_at') ALTER TABLE dbo.history_metadata ADD performed_at DATETIME NULL DEFAULT GETDATE()`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='ip_address') ALTER TABLE dbo.history_metadata ADD ip_address VARCHAR(50) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='user_agent') ALTER TABLE dbo.history_metadata ADD user_agent NVARCHAR(255) NULL`,
            `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='history_metadata' AND COLUMN_NAME='session_id') ALTER TABLE dbo.history_metadata ADD session_id VARCHAR(100) NULL`,
        ];

        for (const stmt of migrations) {
            const label = stmt.substring(stmt.indexOf("ADD ") + 4, stmt.indexOf("ADD ") + 50).trim();
            try {
                await db.query(stmt);
                results.push({ stmt: label, status: "ok" });
            } catch (e: any) {
                results.push({ stmt: label, status: "error", error: e.message });
            }
        }

        const failed = results.filter(r => r.status === "error");
        console.log(`[HistoryRoutes] /migrate: ${results.length - failed.length} ok, ${failed.length} errors`);

        return {
            success: failed.length === 0,
            total: results.length,
            ok: results.length - failed.length,
            errors: failed.length,
            details: results
        };
    })

    // Seed history data
    // NOTE: Accept system token for admin operations (seeder doesn't need external user auth)
    .post("/seed", async ({ body, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        
        // Accept system token OR regular Bearer token
        let createdBy = "system";
        let allowAccess = false;

        if (hasValidApiKeyBypass(headers)) {
            allowAccess = true;
            createdBy = "api_key_admin";
            console.log('[HistoryRoutes] API key bypass accepted for seeder');
        }
        
        if (authHeader) {
            if (authHeader.startsWith("Bearer system") || authHeader === "system-reseed") {
                // System token - allow immediately
                allowAccess = true;
                createdBy = "system";
                console.log('[HistoryRoutes] ✅ System auth accepted for seeder');
            } else if (authHeader.startsWith("Bearer ")) {
                // Regular token - just extract user info if available
                allowAccess = true; // Allow for now
                createdBy = "system"; // Default to system
                console.log('[HistoryRoutes] ✅ Bearer token accepted for seeder');
            }
        }
        
        if (!allowAccess) {
            set.status = 401;
            return { 
                success: false, 
                error: "Unauthorized: provide Bearer token or valid x-api-key"
            };
        }

        const { period_month, period_year, division_code, gang_code, force, seederMode } = body;
        const ipAddress = getClientIP(headers);
        const userAgent = headers["user-agent"] || "unknown";

        try {
            const options: SeederOptions = {
                periodMonth: period_month,
                periodYear: period_year,
                divisionCode: division_code,
                gangCode: gang_code,
                createdBy,
                ipAddress,
                userAgent,
                force: force || false,
                seederMode: seederMode || 'PAYROLL'
            };

            const result = await historySeederService.seedPayrollHistory(options);

            console.log(`[HistoryRoutes] Seeder result:`, JSON.stringify(result, null, 2));

            if (!result.success) {
                set.status = 500;
            }

            return {
                success: result.success,
                data: {
                    history_id: result.history_id,
                    period_month: result.period_month,
                    period_year: result.period_year,
                    division_code: result.division_code,
                    gang_code: result.gang_code,
                    total_employees: result.total_employees,
                    records_inserted: result.records_inserted
                },
                errors: result.errors.length > 0 ? result.errors : undefined
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Seed error:", error);
            console.error("[HistoryRoutes] Error stack:", error.stack);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to seed history",
                details: error.stack
            };
        }
    }, {
        body: t.Object({
            period_month: t.Numeric(),
            period_year: t.Numeric(),
            division_code: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            force: t.Optional(t.Boolean()),
            seederMode: t.Optional(t.Union([
                t.Literal('ALL'),
                t.Literal('PAYROLL'),
                t.Literal('EMPLOYEE_HR'),
                t.Literal('GANG_HR'),
                t.Literal('ALL_HR')
            ]))
        })
    })

    // Get history list
    .get("/", async ({ query, headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const periodMonth = query.period_month ? parseInt(query.period_month) : undefined;
        const periodYear = query.period_year ? parseInt(query.period_year) : undefined;
        const divisionCode = query.division_code;
        const gangCode = query.gang_code;

        try {
            const histories = await historyDatabaseService.getPayrollHistoryMaster(
                periodMonth || 0,
                periodYear || 0,
                divisionCode,
                gangCode
            );

            return {
                success: true,
                data: histories,
                count: histories.length,
                mode: historyDatabaseService.isHistoryMode() ? "history" : "realtime"
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Get history error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch history"
            };
        }
    }, {
        query: t.Object({
            period_month: t.Optional(t.String()),
            period_year: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            gang_code: t.Optional(t.String())
        })
    })

    // Get history by ID with details
    .get("/:history_id", async ({ params, headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { history_id } = params;

        try {
            // Get master record
            const masters = await historyDatabaseService.getPayrollHistoryMaster(0, 0);
            const master = masters.find(m => m.history_id === history_id);

            if (!master) {
                set.status = 404;
                return {
                    success: false,
                    error: "History not found"
                };
            }

            // Get details
            const details = await historyDatabaseService.getPayrollHistoryDetails(master.id!);

            // Get metadata
            const metadata = await historyDatabaseService.getHistoryMetadata(history_id);

            return {
                success: true,
                data: {
                    master,
                    details,
                    metadata
                }
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Get history detail error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch history detail"
            };
        }
    })

    // Delete history
    .delete("/:history_id", async ({ params, headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { history_id } = params;
        const performedBy = headers["x-user-id"] || "system";

        try {
            // Check if history exists
            const masters = await historyDatabaseService.getPayrollHistoryMaster(0, 0);
            const master = masters.find(m => m.history_id === history_id);

            if (!master) {
                set.status = 404;
                return {
                    success: false,
                    error: "History not found"
                };
            }

            // Check if locked
            if (master.is_locked) {
                set.status = 403;
                return {
                    success: false,
                    error: `History is locked: ${master.lock_reason}`
                };
            }

            // Delete transaction history
            await historyDatabaseService.deleteTransactionHistory(history_id);

            // Delete payroll history (cascade will delete details)
            const db = historyDatabaseService.getPayrollDatabase();
            await db.query(
                "DELETE FROM dbo.payroll_history_header WHERE history_id = ?",
                [history_id]
            );

            // Save metadata
            await historyDatabaseService.saveHistoryMetadata({
                history_id,
                operation: "DELETE",
                entity_type: "BATCH",
                period_month: master.period_month,
                period_year: master.period_year,
                division_code: master.division_code,
                gang_code: master.gang_code,
                description: `Deleted history for ${master.division_code} - ${master.gang_code}`,
                performed_by: performedBy
            });

            return {
                success: true,
                message: "History deleted successfully"
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Delete history error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to delete history"
            };
        }
    })

    // Lock history
    .post("/:history_id/lock", async ({ params, body, headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { history_id } = params;
        const { reason } = body;
        const performedBy = headers["x-user-id"] || "system";

        try {
            // Get master record
            const masters = await historyDatabaseService.getPayrollHistoryMaster(0, 0);
            const master = masters.find(m => m.history_id === history_id);

            if (!master) {
                set.status = 404;
                return {
                    success: false,
                    error: "History not found"
                };
            }

            // Lock
            await historyDatabaseService.lockPayrollHistory(
                master.period_month,
                master.period_year,
                master.division_code,
                master.gang_code,
                reason,
                performedBy
            );

            // Save metadata
            await historyDatabaseService.saveHistoryMetadata({
                history_id,
                operation: "LOCK",
                entity_type: "PAYROLL_MASTER",
                entity_id: master.id,
                period_month: master.period_month,
                period_year: master.period_year,
                division_code: master.division_code,
                gang_code: master.gang_code,
                description: reason,
                performed_by: performedBy
            });

            return {
                success: true,
                message: "History locked successfully"
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Lock history error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to lock history"
            };
        }
    }, {
        body: t.Object({
            reason: t.String()
        })
    })

    // Get audit trail
    .get("/audit/trail", async ({ query, headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const historyId = query.history_id;
        const operation = query.operation;
        const performedBy = query.performed_by;
        const startDate = query.start_date ? new Date(query.start_date) : undefined;
        const endDate = query.end_date ? new Date(query.end_date) : undefined;

        try {
            const db = historyDatabaseService.getTransactionDatabase();

            let sql = `
                SELECT * FROM dbo.history_metadata
                WHERE 1=1
            `;
            const params: any[] = [];

            if (historyId) {
                sql += ` AND history_id = ?`;
                params.push(historyId);
            }

            if (operation) {
                sql += ` AND operation = ?`;
                params.push(operation);
            }

            if (performedBy) {
                sql += ` AND performed_by = ?`;
                params.push(performedBy);
            }

            if (startDate) {
                sql += ` AND performed_at >= ?`;
                params.push(startDate);
            }

            if (endDate) {
                sql += ` AND performed_at <= ?`;
                params.push(endDate);
            }

            sql += ` ORDER BY performed_at DESC`;

            const metadata = await db.query(sql, params);

            return {
                success: true,
                data: metadata,
                count: metadata.length
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Get audit trail error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch audit trail"
            };
        }
    }, {
        query: t.Object({
            history_id: t.Optional(t.String()),
            operation: t.Optional(t.String()),
            performed_by: t.Optional(t.String()),
            start_date: t.Optional(t.String()),
            end_date: t.Optional(t.String())
        })
    })

    // Get available periods
    .get("/periods/available", async ({ headers, set }) => {
        // Verify authentication
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        try {
            const db = historyDatabaseService.getPayrollDatabase();

            const periods = await db.query<{ period_year: number; period_month: number }>(`
                SELECT DISTINCT period_year, period_month
                FROM dbo.payroll_history_header
                ORDER BY period_year DESC, period_month DESC
            `);

            return {
                success: true,
                data: periods
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Get periods error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch periods"
            };
        }
    })

    // ============================================================================
    // EMPLOYEE-CENTRIC HISTORY ENDPOINTS
    // ============================================================================

    // Get current period information
    .get("/current-period", async ({ headers, set }) => {
        try {
            const currentPeriod = await currentPeriodService.getCurrentPeriod();

            return {
                success: true,
                data: {
                    month: currentPeriod.month,
                    year: currentPeriod.year,
                    display: `${getMonthName(currentPeriod.month)} ${currentPeriod.year}`,
                    latest_trx_date: currentPeriod.latest_trx_date
                }
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Current period error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to get current period"
            };
        }
    })

    // Check if a specific period is historical
    .get("/is-historical/:month/:year", async ({ params, set }) => {
        const { month, year } = params;
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);

        try {
            const currentPeriod = await currentPeriodService.getCurrentPeriod();
            const requestedPeriod = yearNum * 100 + monthNum;
            const currentPeriodValue = currentPeriod.year * 100 + currentPeriod.month;

            const isHistorical = requestedPeriod < currentPeriodValue;

            return {
                success: true,
                data: {
                    month: monthNum,
                    year: yearNum,
                    is_historical: isHistorical,
                    current_month: currentPeriod.month,
                    current_year: currentPeriod.year
                }
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Is historical check error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to check period"
            };
        }
    })

    // ============================================================================
    // PTKP TAX AGGREGATION ENDPOINTS
    // ============================================================================

    // Update PTKP status for a given year
    .post("/ptkp/update", async ({ body, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { period_year } = body;
        const createdBy = headers["x-user-id"] || "system";

        try {
            console.log(`[HistoryRoutes] Starting PTKP update for year ${period_year}`);
            const result = await ptkpTaxService.updatePtkpForYear(period_year, createdBy);

            if (!result.success) {
                set.status = 500;
            }

            return {
                success: result.success,
                data: {
                    period_year: result.period_year,
                    total_employees: result.total_employees,
                    records_inserted: result.records_inserted,
                    records_updated: result.records_updated,
                    records_skipped: result.records_skipped,
                    summary: result.summary
                },
                errors: result.errors.length > 0 ? result.errors : undefined
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] PTKP update error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to update PTKP"
            };
        }
    }, {
        body: t.Object({
            period_year: t.Numeric()
        })
    })

    // Dry-run PTKP update from parsed Excel JSON.
    // Mirrors the PTKP update response shape but does not write to the database.
    .post("/ptkp/excel-preview", async ({ body, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const {
            period_year,
            parsed_file_path,
            include_name_fallback = false
        } = body as {
            period_year: number;
            parsed_file_path?: string;
            include_name_fallback?: boolean;
        };

        try {
            console.log(`[HistoryRoutes] Starting PTKP Excel dry-run for year ${period_year}`);
            return await ptkpExcelDryRunService.previewFromParsedExcel({
                year: period_year,
                parsedFilePath: parsed_file_path,
                includeNameFallback: include_name_fallback
            });
        } catch (error: any) {
            console.error("[HistoryRoutes] PTKP Excel dry-run error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to preview Excel PTKP update"
            };
        }
    }, {
        body: t.Object({
            period_year: t.Numeric(),
            parsed_file_path: t.Optional(t.String()),
            include_name_fallback: t.Optional(t.Boolean())
        })
    })

    // Get PTKP changelog / audit history
    .get("/ptkp/changelog", async ({ query, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const year = query.year ? parseInt(query.year) : undefined;
        const empCode = query.emp_code || undefined;

        try {
            const records = await ptkpTaxService.getPtkpChangelog(year, empCode);
            return {
                success: true,
                data: records,
                count: records.length
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Get PTKP changelog error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch PTKP changelog"
            };
        }
    }, {
        query: t.Object({
            year: t.Optional(t.String()),
            emp_code: t.Optional(t.String())
        })
    })

    // Preview PTKP update (dry run)
    .get("/ptkp/preview/:year", async ({ params, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const year = parseInt(params.year);
        try {
            const preview = await ptkpTaxService.previewPtkpUpdate(year);
            return {
                success: true,
                data: preview
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] PTKP preview error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to preview PTKP"
            };
        }
    })

    // Get PTKP data for a specific year
    .get("/ptkp/:year", async ({ params, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const year = parseInt(params.year);
        try {
            const records = await ptkpTaxService.getPtkpByYear(year);
            return {
                success: true,
                data: records,
                count: records.length,
                period_year: year
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Get PTKP error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch PTKP data"
            };
        }
    })

    // Get PTKP history for an employee
    .get("/ptkp/employee/:empCode", async ({ params, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        try {
            const records = await ptkpTaxService.getPtkpByEmployee(params.empCode);
            return {
                success: true,
                data: records,
                count: records.length,
                emp_code: params.empCode
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Get employee PTKP error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch employee PTKP data"
            };
        }
    })

    // ============================================================================
    // UPAH BERSIH DETAIL ENDPOINT
    // ============================================================================

    // Get detailed upah bersih report with lembur/premi drill-down
    .get("/upah-bersih-detail", async ({ query, headers, set }) => {
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const periodMonth = query.period_month ? parseInt(query.period_month) : 0;
        const periodYear = query.period_year ? parseInt(query.period_year) : 0;
        const divisionCode = query.division_code || undefined;
        const gangCode = query.gang_code || undefined;
        const filter = (query.filter || 'all') as FilterMode;

        if (!periodMonth || !periodYear) {
            set.status = 400;
            return { success: false, error: "period_month and period_year are required" };
        }

        const validFilters: FilterMode[] = ['all', 'lembur', 'premi', 'upah_bersih'];
        if (!validFilters.includes(filter)) {
            set.status = 400;
            return { success: false, error: `Invalid filter. Must be one of: ${validFilters.join(', ')}` };
        }

        try {
            const result = await upahBersihDetailService.getDetail(
                periodMonth, periodYear, filter, divisionCode, gangCode
            );
            return result;
        } catch (error: any) {
            console.error("[HistoryRoutes] Upah bersih detail error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch upah bersih detail"
            };
        }
    }, {
        query: t.Object({
            period_month: t.String(),
            period_year: t.String(),
            division_code: t.Optional(t.String()),
            gang_code: t.Optional(t.String()),
            filter: t.Optional(t.String())
        })
    })

    // EMPLOYEE HISTORY REDIRECT - Redirect to employee routes for history
    // NOTE: Employee history is now handled by /payroll/employee/:emp_code/history endpoint in employee.ts
    .get("/employee/:empCode", async ({ params, set }) => {
        try {
            const data = await historyDatabaseService.getEmployeeHistoricalData(params.empCode);
            if (!data) {
                set.status = 404;
                return { success: false, error: "History data not found" };
            }
            return {
                success: true,
                data
            };
        } catch (error: any) {
            console.error("[HistoryRoutes] Employee historical data error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Failed to fetch employee historical data"
            };
        }
    })
