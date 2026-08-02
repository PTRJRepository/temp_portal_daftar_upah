import { Database } from "../../db/client";
import { LemburData, LemburRecord } from "../../types/payroll/dataExtractor";
import { error as logError } from "../../utils/logger";

const CATEGORY = "PayrollLemburRepository";

export class PayrollLemburRepository {
    private static instance: PayrollLemburRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollLemburRepository {
        if (!PayrollLemburRepository.instance) {
            PayrollLemburRepository.instance = new PayrollLemburRepository();
        }
        return PayrollLemburRepository.instance;
    }

    /**
     * Get simple lembur summary (hours and amounts) from database.
     * This bypasses the calculator and returns raw database values.
     */
    public async getLemburSummary(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        serverProfile?: string
    ): Promise<Record<string, LemburData>> {
        if (!empCodes.length) return {};
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            const rows = await db.query<{ emp_code: string; total_hours: number; total_amount: number }>(`
                SELECT RTRIM(EmpCode) as emp_code, SUM(Hours) as total_hours, SUM(Amount) as total_amount
                FROM (
                    SELECT trl.EmpCode, trl.Hours, trl.Amount
                    FROM PR_TASKREGLN trl
                    JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                    WHERE RTRIM(trl.EmpCode) IN (${empList})
                      AND trl.TrxDate >= ? AND trl.TrxDate <= ?
                      AND trl.OT = 1

                    UNION ALL

                    SELECT trl.EmpCode, trl.Hours, trl.Amount
                    FROM PR_TASKREGLN_ARC trl
                    JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                    WHERE RTRIM(trl.EmpCode) IN (${empList})
                      AND trl.TrxDate >= ? AND trl.TrxDate <= ?
                      AND trl.OT = 1
                ) combined
                GROUP BY RTRIM(EmpCode)
            `, [startDate, endDate, startDate, endDate]);

            const result: Record<string, LemburData> = {};
            for (const r of rows) {
                result[r.emp_code?.trim() || ""] = {
                    jam: r.total_hours || 0,
                    jumlah: r.total_amount || 0
                };
            }
            return result;
        } catch (error: any) {
            logError(CATEGORY, `getLemburSummary failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get Lembur values from DocDesc in PR_ADTRANS tables.
     */
    public async getLemburFromAdtrans(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        serverProfile?: string
    ): Promise<Record<string, number>> {
        if (!empCodes.length) return {};
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            const rows = await db.query<{ emp_code: string; amount: number }>(`
                SELECT RTRIM(t.EmpCode) as emp_code, SUM(ln.Amount) as amount
                FROM (
                    SELECT EmpCode, ID, DocDate FROM PR_ADTRANS
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE '%LEMBUR%' AND Status IN (1, 3)
                    UNION ALL
                    SELECT EmpCode, ID, DocDate FROM PR_ADTRANS_ARC
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE '%LEMBUR%' AND Status = 3
                ) t
                JOIN (
                    SELECT MasterID, Amount FROM PR_ADTRANSLN
                    UNION ALL
                    SELECT MasterID, Amount FROM PR_ADTRANSLN_ARC
                ) ln ON t.ID = ln.MasterID
                GROUP BY RTRIM(t.EmpCode)
            `, [startDate, endDate, startDate, endDate]);

            const result: Record<string, number> = {};
            for (const r of rows) {
                result[r.emp_code?.trim() || ""] = r.amount || 0;
            }
            return result;
        } catch (error: any) {
            logError(CATEGORY, `getLemburFromAdtrans failed: ${error.message}`);
            throw error;
        }
    }
}

export const payrollLemburRepository = PayrollLemburRepository.getInstance();
