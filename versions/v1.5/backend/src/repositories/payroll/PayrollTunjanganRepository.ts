import { Database } from "../../db/client";
import { error as logError } from "../../utils/logger";
import { Config } from "../../config";

const CATEGORY = "PayrollTunjanganRepository";

export class PayrollTunjanganRepository {
    private static instance: PayrollTunjanganRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollTunjanganRepository {
        if (!PayrollTunjanganRepository.instance) {
            PayrollTunjanganRepository.instance = new PayrollTunjanganRepository();
        }
        return PayrollTunjanganRepository.instance;
    }

    /**
     * Get Tunjangan Jabatan from DocDesc in PR_ADTRANS tables.
     */
    public async getTunjanganJabatan(
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
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE '%JABATAN%' AND Status IN (1, 3)
                    UNION ALL
                    SELECT EmpCode, ID, DocDate FROM PR_ADTRANS_ARC
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE '%JABATAN%' AND Status = 3
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
            logError(CATEGORY, `getTunjanganJabatan failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get additional beras amount from DocDesc containing 'BERAS'.
     */
    public async getBerasFromAdtrans(
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
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE '%BERAS%' AND Status IN (1, 3)
                    UNION ALL
                    SELECT EmpCode, ID, DocDate FROM PR_ADTRANS_ARC
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE '%BERAS%' AND Status = 3
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
            logError(CATEGORY, `getBerasFromAdtrans failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get Upah Dasar (Base Wage Rate) for employees.
     * Handles historical rate override based on year.
     */
    public async getUpahDasarMap(
        empCodes: string[], 
        year: number, 
        serverProfile?: string
    ): Promise<Record<string, number>> {
        if (!empCodes.length) return {};
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");
        const currentYear = new Date().getFullYear();

        try {
            const rows = await db.query<{ emp_code: string; upah_dasar: number }>(`
                WITH LatestCPTRX AS (
                    SELECT EmpCode, NewRate, ROW_NUMBER() OVER(PARTITION BY EmpCode ORDER BY UpdateDate DESC) as rn
                    FROM HR_CPTRX
                )
                SELECT RTRIM(e.EmpCode) as emp_code, COALESCE(lc.NewRate, 0) as upah_dasar
                FROM HR_EMPLOYEE e
                LEFT JOIN LatestCPTRX lc ON RTRIM(lc.EmpCode) = RTRIM(e.EmpCode) AND lc.rn = 1
                WHERE RTRIM(e.EmpCode) IN (${empList})
            `);

            const result: Record<string, number> = {};
            for (const r of rows) {
                let rate = r.upah_dasar || 0;
                // Historical override logic
                if (year < currentYear && rate <= 134500) {
                    rate = Config.getUpahDasar(year);
                }
                result[r.emp_code?.trim() || ""] = rate;
            }
            return result;
        } catch (error: any) {
            logError(CATEGORY, `getUpahDasarMap failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get Masa Kerja Tunjangan amount from DocDesc in PR_ADTRANS tables.
     */
    public async getMasaKerjaJumlah(
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
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE 'MASA%KERJA%' AND Status IN (1, 3)
                    UNION ALL
                    SELECT EmpCode, ID, DocDate FROM PR_ADTRANS_ARC
                    WHERE RTRIM(EmpCode) IN (${empList}) AND DocDate >= ? AND DocDate < ? AND UPPER(DocDesc) LIKE 'MASA%KERJA%' AND Status = 3
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
            logError(CATEGORY, `getMasaKerjaJumlah failed: ${error.message}`);
            throw error;
        }
    }
}

export const payrollTunjanganRepository = PayrollTunjanganRepository.getInstance();
