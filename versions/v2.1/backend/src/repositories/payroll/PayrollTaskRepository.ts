import { Database } from "../../db/client";
import { error as logError } from "../../utils/logger";

const CATEGORY = "PayrollTaskRepository";

export class PayrollTaskRepository {
    private static instance: PayrollTaskRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollTaskRepository {
        if (!PayrollTaskRepository.instance) {
            PayrollTaskRepository.instance = new PayrollTaskRepository();
        }
        return PayrollTaskRepository.instance;
    }

    /**
     * Get primary task codes for employees within a date range.
     * Picks the task code with the highest HK.
     */
    public async getPrimaryTaskCodes(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        serverProfile?: string
    ): Promise<Record<string, any>> {
        if (!empCodes.length) return {};
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            const rows = await db.query<any>(`
                SELECT emp_code, task_code, task_desc, task_type, task_uom
                FROM (
                    SELECT 
                        RTRIM(EmpCode) as emp_code, 
                        RTRIM(TaskCode) as task_code, 
                        RTRIM(TaskDesc) as task_desc, 
                        RTRIM(TaskType) as task_type, 
                        RTRIM(TaskUom) as task_uom,
                        ROW_NUMBER() OVER(PARTITION BY EmpCode ORDER BY COUNT(*) DESC) as rn
                    FROM (
                        SELECT trl.EmpCode, trl.TaskCode, mt.TaskDesc, mt.TaskType, mt.TaskUom
                        FROM PR_TASKREGLN trl
                        JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                        LEFT JOIN PR_TASKCODE mt ON trl.TaskCode = mt.TaskCode
                        WHERE trl.EmpCode IN (${empList}) AND trl.TrxDate >= ? AND trl.TrxDate < ? AND trl.OT = 0
                        UNION ALL
                        SELECT trl.EmpCode, trl.TaskCode, mt.TaskDesc, mt.TaskType, mt.TaskUom
                        FROM PR_TASKREGLN_ARC trl
                        JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                        LEFT JOIN PR_TASKCODE mt ON trl.TaskCode = mt.TaskCode
                        WHERE trl.EmpCode IN (${empList}) AND trl.TrxDate >= ? AND trl.TrxDate < ? AND trl.OT = 0
                    ) t
                    GROUP BY EmpCode, TaskCode, TaskDesc, TaskType, TaskUom
                ) t2
                WHERE rn = 1
            `, [startDate, endDate, startDate, endDate]);

            const result: Record<string, any> = {};
            for (const r of rows) {
                result[r.emp_code?.trim() || ""] = r;
            }
            return result;
        } catch (error: any) {
            logError(CATEGORY, `getPrimaryTaskCodes failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get position history for employees.
     * Extracts Jabatan from extend_db_ptrj.history_gang_member or employee_estate.
     */
    public async getPositionHistory(
        empCodes: string[], 
        month: number, 
        year: number, 
        serverProfile?: string
    ): Promise<Record<string, string>> {
        if (!empCodes.length) return {};
        
        // Always uses the primary database for extend_db_ptrj
        const db = this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            // [OPTIMIZATION] COALESCE history_gang_member.jabatan with employee_estate.jabatan
            const rows = await db.query<{ emp_code: string; jabatan: string }>(`
                SELECT 
                    RTRIM(e.EmpCode) as emp_code,
                    COALESCE(RTRIM(hgm.jabatan), RTRIM(ee.jabatan), '') as jabatan
                FROM HR_EMPLOYEE e
                LEFT JOIN extend_db_ptrj.dbo.history_gang_member hgm ON RTRIM(hgm.emp_code) = RTRIM(e.EmpCode)
                    AND hgm.month = ? AND hgm.year = ?
                LEFT JOIN extend_db_ptrj.dbo.employee_estate ee ON RTRIM(ee.emp_code) = RTRIM(e.EmpCode)
                WHERE e.EmpCode IN (${empList})
            `, [month, year]);

            const result: Record<string, string> = {};
            for (const r of rows) {
                result[r.emp_code?.trim() || ""] = r.jabatan || "";
            }
            return result;
        } catch (error: any) {
            logError(CATEGORY, `getPositionHistory failed: ${error.message}`);
            throw error;
        }
    }
}

export const payrollTaskRepository = PayrollTaskRepository.getInstance();
