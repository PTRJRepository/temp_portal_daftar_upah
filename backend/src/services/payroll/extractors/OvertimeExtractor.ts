/**
 * OvertimeExtractor - Extract Lembur (Overtime) Data
 *
 * Extracts employee overtime data from PR_TASKREGLN tables.
 *
 * Data extracted:
 * - LemburData: { jam, jumlah } - total hours and amount
 * - LemburDataWithDetails: includes records[] with individual transactions
 *
 * Source tables:
 * - PR_TASKREGLN (live) where OT = 1
 * - PR_TASKREGLN_ARC (archive) where OT = 1
 *
 * JOIN: PR_TASKREG / PR_TASKREG_ARC for MasterID
 *
 * FILTER: OT = 1 (overtime transactions only)
 *
 * Note: Additional Lembur from DocDesc containing 'LEMBUR' is extracted separately
 * via getLemburFromDocDesc() method.
 *
 * @module payroll/extractors/OvertimeExtractor
 */

import { Database } from '../../../db/client';
import { lemburCalculator } from '../../lemburCalculator';
import { PayrollComponentMetadata } from '../../../types/payroll/PayrollComponent';

/**
 * LemburRecord - Single overtime transaction
 */
export interface LemburRecord {
    trx_date: string;
    task_code: string;
    task_desc: string;
    day_type: string;
    hours: number;
    rate: number;
    amount: number;
    record_count?: number;        // Number of transactions grouped (for grouped task breakdown)
    meta?: PayrollComponentMetadata;
}

/**
 * LemburData - Basic overtime totals
 */
export interface LemburData {
    jam: number;
    jumlah: number;
}

/**
 * LemburDataWithDetails - Overtime totals with individual transaction records
 */
export interface LemburDataWithDetails extends LemburData {
    records: LemburRecord[];
}

/**
 * OvertimeExtractor - Extract overtime data
 *
 * Provides multiple extraction methods:
 * 1. extract(): Basic totals via direct SQL query
 * 2. extractFromCalculator(): Totals via lemburCalculator service
 * 3. extractWithTaskBreakdown(): Totals + individual records via lemburCalculator
 * 4. extractFromDocDesc(): Additional Lembur from PR_ADTRANS DocDesc containing 'LEMBUR'
 */
export class OvertimeExtractor {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Extract overtime data via direct SQL query
     *
     * Combines live (PR_TASKREGLN) and archive (PR_TASKREGLN_ARC) tables.
     * OT = 1 filter ensures only pure overtime transactions.
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → LemburData
     */
    async extract(
        empCodes: string[],
        startDate: string,
        endDate: string,
        serverProfile?: string
    ): Promise<Record<string, LemburData>> {
        if (!empCodes.length) return {};

        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        const empList = empCodes.map(e => `'${e}'`).join(',');

        const rows = await db.query<{ emp_code: string; total_hours: number; total_amount: number }>(`
            SELECT RTRIM(EmpCode) as emp_code, SUM(Hours) as total_hours, SUM(Amount) as total_amount
            FROM (
                SELECT trl.EmpCode, trl.Hours, trl.Amount
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate <= ?
                  AND trl.OT = 1

                UNION ALL

                SELECT trl.EmpCode, trl.Hours, trl.Amount
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate <= ?
                  AND trl.OT = 1
            ) combined
            GROUP BY RTRIM(EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, LemburData> = {};
        for (const r of rows) {
            result[r.emp_code?.trim() || ''] = {
                jam: r.total_hours || 0,
                jumlah: r.total_amount || 0
            };
        }
        return result;
    }

    /**
     * Extract overtime totals via lemburCalculator service
     *
     * Uses the centralized lemburCalculator for consistent tier-based calculations.
     * This provides calculated amounts based on UPJ and tier rates.
     *
     * @param empCodes - Array of employee codes to fetch
     * @param month - Period month
     * @param year - Period year
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → LemburData (jam, jumlah)
     */
    async extractFromCalculator(
        empCodes: string[],
        month: number,
        year: number,
        serverProfile?: string
    ): Promise<Record<string, LemburData>> {
        const data = await lemburCalculator.calculateBatchData(empCodes, month, year, serverProfile);
        const result: Record<string, LemburData> = {};
        for (const k in data) {
            result[k] = {
                jam: data[k].total_hours || 0,
                jumlah: data[k].total_payment || 0
            };
        }
        return result;
    }

    /**
     * Extract overtime with full task breakdown via lemburCalculator service
     *
     * Returns totals AND individual transaction records.
     * Each record includes: trx_date, task_code, task_desc, day_type, hours, rate, amount.
     * This ensures total lembur = sum of all detail records (no double counting).
     *
     * @param empCodes - Array of employee codes to fetch
     * @param month - Period month
     * @param year - Period year
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → LemburDataWithDetails
     */
    async extractWithTaskBreakdown(
        empCodes: string[],
        month: number,
        year: number,
        serverProfile?: string
    ): Promise<Record<string, LemburDataWithDetails>> {
        const data = await lemburCalculator.calculateBatchDataWithTaskBreakdown(empCodes, month, year, serverProfile);
        const result: Record<string, LemburDataWithDetails> = {};

        for (const k in data) {
            const records = (data[k].records || []).map((rec: any) => ({
                trx_date: rec.date,
                task_code: rec.task_code,
                task_desc: rec.task_desc,
                day_type: rec.day_type,
                hours: rec.hours,
                rate: rec.rate,
                amount: rec.amount
            }));

            result[k] = {
                jam: data[k].total_hours || 0,
                jumlah: data[k].total_payment || 0,
                records: records
            };
        }
        return result;
    }

    /**
     * Extract additional Lembur from PR_ADTRANS DocDesc containing 'LEMBUR'
     *
     * This is separate from the standard OT=1 overtime calculations.
     * Some payroll systems record additional Lembur amounts in PR_ADTRANS
     * with DocDesc containing 'LEMBUR' keyword.
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → additional lembur amount
     */
    async extractFromDocDesc(
        empCodes: string[],
        startDate: string,
        endDate: string,
        serverProfile?: string
    ): Promise<Record<string, number>> {
        if (!empCodes.length) return {};

        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        const empList = empCodes.map(e => `'${e}'`).join(',');

        const rows = await db.query<{ emp_code: string; total_amount: number }>(`
            SELECT RTRIM(t.EmpCode) as emp_code, SUM(ln.Amount) as total_amount
            FROM PR_ADTRANS t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) IN (${empList})
              AND t.DocDate >= ?
              AND t.DocDate < ?
              AND UPPER(t.DocDesc) LIKE '%LEMBUR%'
              AND ln.Amount > 0
              AND t.Status IN (1, 3)
            GROUP BY RTRIM(t.EmpCode)

            UNION ALL

            SELECT RTRIM(t.EmpCode) as emp_code, SUM(ln.Amount) as total_amount
            FROM PR_ADTRANS_ARC t
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) IN (${empList})
              AND t.DocDate >= ?
              AND t.DocDate < ?
              AND UPPER(t.DocDesc) LIKE '%LEMBUR%'
              AND ln.Amount > 0
              AND t.Status = 3
            GROUP BY RTRIM(t.EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, number> = {};
        for (const r of rows) {
            result[r.emp_code?.trim() || ''] = r.total_amount || 0;
        }
        return result;
    }
}

// Singleton instance
let instance: OvertimeExtractor | null = null;

export function getOvertimeExtractor(): OvertimeExtractor {
    if (!instance) {
        instance = new OvertimeExtractor();
    }
    return instance;
}
