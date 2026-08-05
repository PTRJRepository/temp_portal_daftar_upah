import { Database } from "../db/client";
import { debug, error as logError } from "../utils/logger";
import { PayrollCalculator } from "./payroll/components/PayrollCalculator";
import { gajiPokokService } from "./payroll/components/GajiPokokService";
import { dataExtractorService } from "./dataExtractorService";

const CATEGORY = "PayrollService";

/**
 * PayrollService - High-level payroll business operations
 * Refactored to delegate calculations to specialized component services.
 */
export class PayrollService {
    private static instance: PayrollService;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollService {
        if (!PayrollService.instance) {
            PayrollService.instance = new PayrollService();
        }
        return PayrollService.instance;
    }

    /**
     * Get detailed payroll report for a gang
     */
    public async getGangPayrollReport(month: number, year: number, gangCode: string, divisionCode?: string) {
        return dataExtractorService.extractWages({
            month, year, divisionCode, gangCode, useCache: true
        });
    }

    /**
     * Check if payroll is finalized for a period
     */
    public async isPayrollFinalized(month: number, year: number, divisionCode: string): Promise<boolean> {
        try {
            const histDb = Database.getExtendedInstance();
            const row = await histDb.queryOne<{ is_locked: boolean }>(
                `SELECT TOP 1 is_locked FROM dbo.payroll_history_header
                 WHERE period_month = ? AND period_year = ? AND division_code = ?`,
                [month, year, divisionCode]
            );
            return !!row?.is_locked;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get PayRates (upah_dasar) for multiple employees from HR_PAYROLL
     * Returns Record<empCode, payRate>
     *
     * CRITICAL: Uses TOP 1 with ORDER BY PayRate DESC to get the LATEST non-zero payrate
     * This follows the APPEND-INSERT pattern where multiple records exist per employee
     */
    public async getPayratesMap(empCodes: string[], serverProfile?: string): Promise<Record<string, number>> {
        if (!empCodes || empCodes.length === 0) return {};

        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const result: Record<string, number> = {};

        try {
            // Build parameterized IN clause
            const placeholders = empCodes.map(() => '?').join(',');
            const query = `
                SELECT EmpCode, PayRate
                FROM HR_PAYROLL
                WHERE RTRIM(EmpCode) IN (${placeholders})
            `;

            const rows = await db.query<{ EmpCode: string; PayRate: number }>(query, empCodes);

            // Group by empCode and pick the latest (highest/non-zero) payrate
            const empPayrates: Record<string, number[]> = {};
            for (const row of rows) {
                const empCode = row.EmpCode?.trim() || '';
                if (!empCode) continue;
                if (!empPayrates[empCode]) empPayrates[empCode] = [];
                empPayrates[empCode].push(row.PayRate || 0);
            }

            // For each employee, pick the highest non-zero payrate
            for (const empCode of empCodes) {
                const empCodeTrimmed = empCode.trim();
                const payrates = empPayrates[empCodeTrimmed] || [];
                // Filter non-zero and pick the highest
                const nonZero = payrates.filter(p => p > 0);
                if (nonZero.length > 0) {
                    result[empCodeTrimmed] = Math.max(...nonZero);
                } else {
                    result[empCodeTrimmed] = 0;
                }
            }
        } catch (e) {
            logError(CATEGORY, "getPayratesMap failed", e);
            // Return empty - caller should handle fallback to default UPJ
        }

        return result;
    }
}

export const payrollService = PayrollService.getInstance();
