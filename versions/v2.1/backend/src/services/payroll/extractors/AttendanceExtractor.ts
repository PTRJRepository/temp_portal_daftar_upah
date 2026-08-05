/**
 * AttendanceExtractor - Extract Attendance (HK) Data
 *
 * Extracts employee attendance/work hours from PR_TASKREGLN tables.
 *
 * Data extracted:
 * - hk: Number of working days (distinct transaction dates)
 * - total_hours: Total work hours
 * - shortage_count: Number of days with insufficient hours
 * - total_amount_rp: Total attendance amount
 * - shortage_details: Array of days with shortage hours
 * - excess_details: Array of days with excess hours
 *
 * Source tables:
 * - PR_TASKREGLN (live)
 * - PR_TASKREGLN_ARC (archive)
 *
 * JOIN: PR_TASKREG / PR_TASKREG_ARC for MasterID
 *
 * FILTER: OT = 0 (non-overtime transactions only)
 *
 * Shortage rules:
 * - Friday/Jumat: < 5 hours = shortage (if hours > 0)
 * - Other days: < 7 hours = shortage (if hours > 0)
 *
 * @module payroll/extractors/AttendanceExtractor
 */

import { Database } from '../../../db/client';

/**
 * ShortageDetail - Single day with insufficient work hours
 */
export interface ShortageDetail {
    date: string;
    day_name: string;
    actual_hours: number;
    target_hours: number;
    shortage_hours: number;
}

/**
 * ExcessDetail - Single day with excess work hours
 */
export interface ExcessDetail {
    date: string;
    day_name: string;
    actual_hours: number;
    target_hours: number;
    excess_hours: number;
}

/**
 * AttendanceData - Complete attendance record per employee
 */
export interface AttendanceData {
    hk: number;                          // Number of distinct working days
    total_hours: number;                 // Total work hours
    shortage_count: number;              // Number of shortage days
    total_amount_rp: number;             // Total attendance amount
    shortage_details: ShortageDetail[];  // Individual shortage days
    shortage_total_hours: number;        // Sum of shortage hours
    excess_details: ExcessDetail[];      // Individual excess days
    excess_total_hours: number;          // Sum of excess hours
}

/**
 * Query result row type from consolidated query
 */
interface AttendanceQueryRow {
    emp_code: string;
    row_type: 'A' | 'S' | 'E';  // A=summary aggregation, S=shortage, E=excess
    hk: number;
    total_hours: number;
    shortage_count: number;
    total_amount_rp: number;
    detail_date: string | null;
    detail_day_name: string | null;
    detail_hours: number;
    detail_target: number;
}

export class AttendanceExtractor {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Extract attendance data for multiple employees
     *
     * Uses consolidated query that fetches ALL attendance data in a single DB round-trip.
     * Combines live (PR_TASKREGLN) and archive (PR_TASKREGLN_ARC) tables.
     * Returns summary + shortage details + excess details in one query.
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → AttendanceData
     */
    async extract(
        empCodes: string[],
        startDate: string,
        endDate: string,
        serverProfile?: string
    ): Promise<Record<string, AttendanceData>> {
        if (!empCodes.length) return {};

        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        const empList = empCodes.map(e => `'${e}'`).join(',');

        /**
         * Consolidated query - single round-trip for all attendance data
         *
         * Optimization: Originally 6+ separate queries, now 1
         * Row types:
         *   'A' = Summary aggregation (hk, total_hours, shortage_count, total_amount_rp)
         *   'S' = Shortage detail rows (individual days with insufficient hours)
         *   'E' = Excess detail rows (individual days with excess hours)
         *
         * Shortage thresholds:
         *   Friday/Jumat: < 5 hours (but > 0)
         *   Other days: < 7 hours (but > 0)
         */
        const rows = await db.query<AttendanceQueryRow>(`
            SELECT
                emp_code,
                row_type,
                MAX(hk) as hk,
                MAX(total_hours) as total_hours,
                MAX(shortage_count) as shortage_count,
                MAX(total_amount_rp) as total_amount_rp,
                MAX(detail_date) as detail_date,
                MAX(detail_day_name) as detail_day_name,
                MAX(detail_hours) as detail_hours,
                MAX(detail_target) as detail_target
            FROM (
                -- ============================================
                -- LIVE: Summary aggregation (row_type = 'A')
                -- ============================================
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'A' as row_type,
                    COUNT(DISTINCT trl.TrxDate) as hk,
                    SUM(trl.Hours) as total_hours,
                    SUM(CASE
                        WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat')
                            THEN CASE WHEN trl.Hours < 5 AND trl.Hours > 0 THEN 1 ELSE 0 END
                        ELSE CASE WHEN trl.Hours < 7 AND trl.Hours > 0 THEN 1 ELSE 0 END
                    END) as shortage_count,
                    SUM(trl.Amount) as total_amount_rp,
                    NULL as detail_date, NULL as detail_day_name, NULL as detail_hours, NULL as detail_target
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode)

                UNION ALL

                -- ============================================
                -- ARCHIVE: Summary aggregation (row_type = 'A')
                -- ============================================
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'A' as row_type,
                    COUNT(DISTINCT trl.TrxDate) as hk,
                    SUM(trl.Hours) as total_hours,
                    SUM(CASE
                        WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat')
                            THEN CASE WHEN trl.Hours < 5 AND trl.Hours > 0 THEN 1 ELSE 0 END
                        ELSE CASE WHEN trl.Hours < 7 AND trl.Hours > 0 THEN 1 ELSE 0 END
                    END) as shortage_count,
                    SUM(trl.Amount) as total_amount_rp,
                    NULL as detail_date, NULL as detail_day_name, NULL as detail_hours, NULL as detail_target
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode)

                UNION ALL

                -- ============================================
                -- LIVE: Shortage detail rows (row_type = 'S')
                -- Days with insufficient hours (grouped by date)
                -- ============================================
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'S' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) < CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
                   AND SUM(trl.Hours) > 0

                UNION ALL

                -- ============================================
                -- ARCHIVE: Shortage detail rows (row_type = 'S')
                -- ============================================
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'S' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) < CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
                   AND SUM(trl.Hours) > 0

                UNION ALL

                -- ============================================
                -- LIVE: Excess detail rows (row_type = 'E')
                -- Days with excess hours (grouped by date)
                -- ============================================
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'E' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) > CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END

                UNION ALL

                -- ============================================
                -- ARCHIVE: Excess detail rows (row_type = 'E')
                -- ============================================
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'E' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) > CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
            ) combined
            GROUP BY emp_code, row_type
        `, [
            // LIVE summary params
            startDate, endDate,
            // ARC summary params
            startDate, endDate,
            // LIVE shortage params
            startDate, endDate,
            // ARC shortage params
            startDate, endDate,
            // LIVE excess params
            startDate, endDate,
            // ARC excess params
            startDate, endDate
        ]);

        // Initialize result with all employees (empty attendance)
        const result: Record<string, AttendanceData> = {};
        for (const emp of empCodes) {
            result[emp] = {
                hk: 0,
                total_hours: 0,
                shortage_count: 0,
                total_amount_rp: 0,
                shortage_details: [],
                shortage_total_hours: 0,
                excess_details: [],
                excess_total_hours: 0
            };
        }

        // Process query results
        // First pass: collect summary and detail data per employee
        const summaryMap = new Map<string, Partial<AttendanceData>>();
        const shortageMap = new Map<string, ShortageDetail[]>();
        const excessMap = new Map<string, ExcessDetail[]>();

        for (const r of rows) {
            const emp = r.emp_code?.trim() || '';

            if (r.row_type === 'A') {
                // Summary row
                summaryMap.set(emp, {
                    hk: r.hk || 0,
                    total_hours: r.total_hours || 0,
                    shortage_count: r.shortage_count || 0,
                    total_amount_rp: r.total_amount_rp || 0
                });
            } else if (r.row_type === 'S' && r.detail_date) {
                // Shortage detail row
                const existing = shortageMap.get(emp) || [];
                const shortageHours = (r.detail_target || 0) - (r.detail_hours || 0);
                existing.push({
                    date: r.detail_date,
                    day_name: r.detail_day_name || '',
                    actual_hours: r.detail_hours || 0,
                    target_hours: r.detail_target || 0,
                    shortage_hours: Math.max(0, shortageHours)
                });
                shortageMap.set(emp, existing);
            } else if (r.row_type === 'E' && r.detail_date) {
                // Excess detail row
                const existing = excessMap.get(emp) || [];
                const excessHours = (r.detail_hours || 0) - (r.detail_target || 0);
                existing.push({
                    date: r.detail_date,
                    day_name: r.detail_day_name || '',
                    actual_hours: r.detail_hours || 0,
                    target_hours: r.detail_target || 0,
                    excess_hours: Math.max(0, excessHours)
                });
                excessMap.set(emp, existing);
            }
        }

        // Second pass: assemble final AttendanceData
        for (const emp of empCodes) {
            const summary = summaryMap.get(emp) || {};
            const shortages = shortageMap.get(emp) || [];
            const excesses = excessMap.get(emp) || [];

            result[emp] = {
                hk: summary.hk || 0,
                total_hours: summary.total_hours || 0,
                shortage_count: shortages.length,
                total_amount_rp: summary.total_amount_rp || 0,
                shortage_details: shortages,
                shortage_total_hours: shortages.reduce((sum, s) => sum + s.shortage_hours, 0),
                excess_details: excesses,
                excess_total_hours: excesses.reduce((sum, e) => sum + e.excess_hours, 0)
            };
        }

        return result;
    }
}

// Singleton instance
let instance: AttendanceExtractor | null = null;

export function getAttendanceExtractor(): AttendanceExtractor {
    if (!instance) {
        instance = new AttendanceExtractor();
    }
    return instance;
}
