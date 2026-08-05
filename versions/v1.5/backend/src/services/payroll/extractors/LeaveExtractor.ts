/**
 * LeaveExtractor - Extract Cuti (Leave) Data
 *
 * Extracts employee leave data from PR_TASKREGLN and PR_TASKREGLN_ARC tables.
 *
 * Data extracted:
 * - cuti_tahunan: Annual leave (TaskCode LIKE 'GA9129%')
 * - cuti_sakit_haid: Sick leave / menstrual leave (TaskCode LIKE 'GA9126%')
 * - cuti_minggu: Sunday/Hari Minggu (TaskCode LIKE 'GA9127%' OR Sunday without holiday record)
 * - cuti_nasional: National holiday (TaskCode LIKE 'GA9128%' OR HR_GPH holiday record)
 *
 * Source tables:
 * - PR_TASKREGLN (live)
 * - PR_TASKREGLN_ARC (archive)
 *
 * JOIN: PR_TASKREG / PR_TASKREG_ARC for MasterID
 *
 * FILTER: OT = 0 (non-overtime transactions only)
 *
 * @module payroll/extractors/LeaveExtractor
 */

import { Database } from '../../../db/client';
import { buildLeaveSqlExpressions } from './leaveRules';

/**
 * CutiData - Leave breakdown per employee
 */
export interface CutiData {
    cuti_tahunan: number;    // Annual leave days
    cuti_sakit_haid: number; // Sick/menstrual leave days
    cuti_minggu: number;    // Sunday count
    cuti_nasional: number;  // National holiday count
}

/**
 * Query result from consolidated cuti query
 */
interface CutiQueryRow {
    emp_code: string;
    cuti_tahunan: number;
    cuti_sakit_haid: number;
    cuti_minggu: number;
    cuti_nasional: number;
}

export class LeaveExtractor {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Extract leave data for multiple employees
     *
     * Uses consolidated query that fetches ALL cuti types in a single DB round-trip.
     * Combines live (PR_TASKREGLN) and archive (PR_TASKREGLN_ARC) tables.
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → CutiData
     */
    async extract(
        empCodes: string[],
        startDate: string,
        endDate: string,
        serverProfile?: string
    ): Promise<Record<string, CutiData>> {
        if (!empCodes.length) return {};

        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        const empList = empCodes.map(e => `'${e}'`).join(',');
        const leaveSql = buildLeaveSqlExpressions('trl', 'h');

        /**
         * Consolidated query - single round-trip for all cuti types
         *
         * Optimization: Originally 3 separate queries, now 1
         * (dataExtractorService.ts optimization applied 2026)
         */
        const rows = await db.query<CutiQueryRow>(`
            SELECT
                RTRIM(EmpCode) as emp_code,
                SUM(cuti_tahunan) as cuti_tahunan,
                SUM(cuti_sakit_haid) as cuti_sakit_haid,
                SUM(cuti_minggu) as cuti_minggu,
                SUM(cuti_nasional) as cuti_nasional
            FROM (
                -- LIVE table: all cuti types via conditional aggregation
                SELECT
                    trl.EmpCode,
                    ${leaveSql.cutiTahunan} as cuti_tahunan,
                    ${leaveSql.cutiSakitHaid} as cuti_sakit_haid,
                    ${leaveSql.cutiMinggu} as cuti_minggu,
                    ${leaveSql.cutiNasional} as cuti_nasional
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND ${leaveSql.whereClause}

                UNION ALL

                -- ARCHIVE table: same conditional aggregation
                SELECT
                    trl.EmpCode,
                    ${leaveSql.cutiTahunan} as cuti_tahunan,
                    ${leaveSql.cutiSakitHaid} as cuti_sakit_haid,
                    ${leaveSql.cutiMinggu} as cuti_minggu,
                    ${leaveSql.cutiNasional} as cuti_nasional
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND ${leaveSql.whereClause}
            ) combined
            GROUP BY RTRIM(EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        // Initialize result with all employees (0 values for those with no leave)
        const result: Record<string, CutiData> = {};
        for (const emp of empCodes) {
            result[emp] = {
                cuti_tahunan: 0,
                cuti_sakit_haid: 0,
                cuti_minggu: 0,
                cuti_nasional: 0
            };
        }

        // Fill in actual values from query
        for (const r of rows) {
            const emp = r.emp_code?.trim() || '';
            if (result[emp]) {
                result[emp].cuti_tahunan = r.cuti_tahunan || 0;
                result[emp].cuti_sakit_haid = r.cuti_sakit_haid || 0;
                result[emp].cuti_minggu = r.cuti_minggu || 0;
                result[emp].cuti_nasional = r.cuti_nasional || 0;
            }
        }

        return result;
    }
}

// Singleton instance
let instance: LeaveExtractor | null = null;

export function getLeaveExtractor(): LeaveExtractor {
    if (!instance) {
        instance = new LeaveExtractor();
    }
    return instance;
}
