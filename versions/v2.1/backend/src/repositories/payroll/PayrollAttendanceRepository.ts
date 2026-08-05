import { Database } from "../../db/client";
import { debug, warn, error as logError } from "../../utils/logger";

const CATEGORY = "PayrollAttendanceRepository";

export interface AttendanceResult {
    hk: number;
    total_hours: number;
    shortage_count: number;
    total_amount_rp: number;
    shortage_details: Array<{ 
        date: string; 
        day_name: string; 
        actual_hours: number; 
        target_hours: number; 
        shortage_hours: number 
    }>;
    shortage_total_hours: number;
    excess_details: Array<{ 
        date: string; 
        day_name: string; 
        actual_hours: number; 
        target_hours: number; 
        excess_hours: number 
    }>;
    excess_total_hours: number;
}

export class PayrollAttendanceRepository {
    private static instance: PayrollAttendanceRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollAttendanceRepository {
        if (!PayrollAttendanceRepository.instance) {
            PayrollAttendanceRepository.instance = new PayrollAttendanceRepository();
        }
        return PayrollAttendanceRepository.instance;
    }

    /**
     * Get attendance summary and details for a list of employees.
     * Consolidates 3 queries into 1 using UNION ALL and conditional aggregation.
     */
    public async getAttendance(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        serverProfile?: string
    ): Promise<Record<string, AttendanceResult>> {
        if (!empCodes.length) return {};
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            const rows = await db.query<{
                emp_code: string;
                row_type: string;
                hk: number;
                total_hours: number;
                shortage_count: number;
                total_amount_rp: number;
                detail_date: string | null;
                detail_day_name: string | null;
                detail_hours: number;
                detail_target: number;
            }>(`
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
                    -- LIVE: Summary aggregation
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
                      AND trl.OT = 0
                    GROUP BY RTRIM(trl.EmpCode)

                    UNION ALL

                    -- ARC: Summary aggregation
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
                      AND trl.OT = 0
                    GROUP BY RTRIM(trl.EmpCode)

                    UNION ALL

                    -- LIVE: Shortage detail rows
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
                      AND trl.OT = 0
                    GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                    HAVING SUM(trl.Hours) < CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
                       AND SUM(trl.Hours) > 0

                    UNION ALL

                    -- ARC: Shortage detail rows
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
                      AND trl.OT = 0
                    GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                    HAVING SUM(trl.Hours) < CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
                       AND SUM(trl.Hours) > 0

                    UNION ALL

                    -- LIVE: Excess detail rows
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
                      AND trl.OT = 0
                    GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                    HAVING SUM(trl.Hours) > CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END

                    UNION ALL

                    -- ARC: Excess detail rows
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
                      AND trl.OT = 0
                    GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                    HAVING SUM(trl.Hours) > CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
                ) combined
                GROUP BY emp_code, row_type
            `, [startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate]);

            const result: Record<string, AttendanceResult> = {};

            for (const r of rows) {
                const empCode = r.emp_code?.trim() || "";
                if (!result[empCode]) {
                    result[empCode] = {
                        hk: 0, total_hours: 0, shortage_count: 0, total_amount_rp: 0,
                        shortage_details: [], shortage_total_hours: 0,
                        excess_details: [], excess_total_hours: 0
                    };
                }

                if (r.row_type === 'A') {
                    result[empCode].hk += r.hk || 0;
                    result[empCode].total_hours += r.total_hours || 0;
                    result[empCode].shortage_count += r.shortage_count || 0;
                    result[empCode].total_amount_rp += r.total_amount_rp || 0;
                } else if (r.row_type === 'S') {
                    if (r.detail_date) {
                        const shortage_hours = (r.detail_target || 0) - (r.detail_hours || 0);
                        result[empCode].shortage_details.push({
                            date: r.detail_date,
                            day_name: r.detail_day_name || "",
                            actual_hours: r.detail_hours || 0,
                            target_hours: r.detail_target || 0,
                            shortage_hours
                        });
                        result[empCode].shortage_total_hours += shortage_hours;
                    }
                } else if (r.row_type === 'E') {
                    if (r.detail_date) {
                        const excess_hours = (r.detail_hours || 0) - (r.detail_target || 0);
                        result[empCode].excess_details.push({
                            date: r.detail_date,
                            day_name: r.detail_day_name || "",
                            actual_hours: r.detail_hours || 0,
                            target_hours: r.detail_target || 0,
                            excess_hours
                        });
                        result[empCode].excess_total_hours += excess_hours;
                    }
                }
            }

            return result;
        } catch (error: any) {
            logError(CATEGORY, `getAttendance failed: ${error.message}`);
            throw error;
        }
    }
}

export const payrollAttendanceRepository = PayrollAttendanceRepository.getInstance();
