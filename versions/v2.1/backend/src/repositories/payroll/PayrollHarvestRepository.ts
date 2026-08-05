import { Database } from "../../db/client";
import { error as logError } from "../../utils/logger";

const CATEGORY = "PayrollHarvestRepository";

export class PayrollHarvestRepository {
    private static instance: PayrollHarvestRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollHarvestRepository {
        if (!PayrollHarvestRepository.instance) {
            PayrollHarvestRepository.instance = new PayrollHarvestRepository();
        }
        return PayrollHarvestRepository.instance;
    }

    /**
     * Get Brondol (Loose Fruit) premiums for employees.
     */
    public async getBrondol(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        serverProfile?: string
    ): Promise<Record<string, number>> {
        if (!empCodes.length) return {};
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            // [PHASE 2.5] Sum Amount from PR_LOOSEFRUIT (Brondol)
            // Combined with adtrans PREMI BRONDOL in main logic
            const rows = await db.query<{ emp_code: string; total: number }>(`
                SELECT RTRIM(EmpCode) as emp_code, SUM(Amount) as total
                FROM (
                    SELECT EmpCode, Amount FROM PR_LOOSEFRUIT
                    WHERE EmpCode IN (${empList}) AND TrxDate >= ? AND TrxDate < ?
                    UNION ALL
                    SELECT EmpCode, Amount FROM PR_LOOSEFRUIT_ARC
                    WHERE EmpCode IN (${empList}) AND TrxDate >= ? AND TrxDate < ?
                ) t
                GROUP BY EmpCode
            `, [startDate, endDate, startDate, endDate]);

            const result: Record<string, number> = {};
            for (const r of rows) {
                result[r.emp_code?.trim() || ""] = r.total || 0;
            }
            return result;
        } catch (error: any) {
            logError(CATEGORY, `getBrondol failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get harvest data (bunches and loose fruit details) for employees.
     */
    public async getBunchesBatch(
        empCodes: string[], 
        month: number, 
        year: number, 
        serverProfile?: string
    ): Promise<Map<string, any>> {
        if (!empCodes.length) return new Map();
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            const rows = await db.query<any>(`
                SELECT 
                    RTRIM(EmpCode) as emp_code,
                    SUM(COALESCE(BunchTotal, 0)) as total,
                    SUM(COALESCE(Bunch1, 0)) as ripe,
                    SUM(COALESCE(Bunch2, 0)) as unripe,
                    SUM(COALESCE(Bunch3, 0)) as underripe,
                    SUM(COALESCE(Bunch4, 0)) as overripe,
                    SUM(COALESCE(Bunch5, 0)) as rotten,
                    SUM(COALESCE(Bunch6, 0)) as abnormal,
                    SUM(COALESCE(LooseFruit, 0)) as loose_fruit,
                    COUNT(*) as transactions
                FROM (
                    SELECT EmpCode, BunchTotal, Bunch1, Bunch2, Bunch3, Bunch4, Bunch5, Bunch6, LooseFruit 
                    FROM PR_HARVEST 
                    WHERE EmpCode IN (${empList}) AND MONTH(TrxDate) = ? AND YEAR(TrxDate) = ?
                    UNION ALL
                    SELECT EmpCode, BunchTotal, Bunch1, Bunch2, Bunch3, Bunch4, Bunch5, Bunch6, LooseFruit 
                    FROM PR_HARVEST_ARC 
                    WHERE EmpCode IN (${empList}) AND MONTH(TrxDate) = ? AND YEAR(TrxDate) = ?
                ) t
                GROUP BY EmpCode
            `, [month, year, month, year]);

            const resultMap = new Map<string, any>();
            for (const row of rows) {
                resultMap.set(row.emp_code?.trim() || "", row);
            }
            return resultMap;
        } catch (error: any) {
            logError(CATEGORY, `getBunchesBatch failed: ${error.message}`);
            throw error;
        }
    }
}

export const payrollHarvestRepository = PayrollHarvestRepository.getInstance();
