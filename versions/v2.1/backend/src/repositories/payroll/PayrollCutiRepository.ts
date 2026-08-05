import { Database } from "../../db/client";
import { CutiData } from "../../types/payroll/dataExtractor";
import { error as logError } from "../../utils/logger";
import { buildLeaveSqlExpressions } from "../../services/payroll/extractors/leaveRules";

const CATEGORY = "PayrollCutiRepository";

export class PayrollCutiRepository {
    private static instance: PayrollCutiRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollCutiRepository {
        if (!PayrollCutiRepository.instance) {
            PayrollCutiRepository.instance = new PayrollCutiRepository();
        }
        return PayrollCutiRepository.instance;
    }

    /**
     * Get consolidated cuti data for multiple employees.
     * Combines 4 types of cuti in a single round-trip.
     */
    public async getCuti(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        serverProfile?: string
    ): Promise<Record<string, CutiData>> {
        if (!empCodes.length) return {};
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");
        const leaveSql = buildLeaveSqlExpressions("trl", "h");

        try {
            const rows = await db.query<{ 
                emp_code: string; 
                cuti_tahunan: number; 
                cuti_sakit_haid: number; 
                cuti_minggu: number; 
                cuti_nasional: number 
            }>(`
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
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
                      AND trl.TrxDate >= ? AND trl.TrxDate < ?
                      AND trl.OT = 0
                      AND ${leaveSql.whereClause}
                ) combined
                GROUP BY RTRIM(EmpCode)
            `, [startDate, endDate, startDate, endDate]);

            // Initialize result with all employees (0 values for those with no cuti)
            const result: Record<string, CutiData> = {};
            for (const emp of empCodes) {
                result[emp] = { cuti_tahunan: 0, cuti_sakit_haid: 0, cuti_minggu: 0, cuti_nasional: 0 };
            }
            
            // Fill in actual values from query
            for (const r of rows) {
                const emp = r.emp_code?.trim() || "";
                if (result[emp]) {
                    result[emp].cuti_tahunan = r.cuti_tahunan || 0;
                    result[emp].cuti_sakit_haid = r.cuti_sakit_haid || 0;
                    result[emp].cuti_minggu = r.cuti_minggu || 0;
                    result[emp].cuti_nasional = r.cuti_nasional || 0;
                }
            }

            return result;
        } catch (error: any) {
            logError(CATEGORY, `getCuti failed: ${error.message}`);
            throw error;
        }
    }
}

export const payrollCutiRepository = PayrollCutiRepository.getInstance();
