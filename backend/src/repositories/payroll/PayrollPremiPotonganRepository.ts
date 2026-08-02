import { Database } from "../../db/client";
import { error as logError } from "../../utils/logger";

const CATEGORY = "PayrollPremiPotonganRepository";

export interface PremiPotonganResult {
    amounts: Record<string, Record<string, number>>;
    titleMap: Record<string, string>;
    details?: Record<string, any[]>;
}

export class PayrollPremiPotonganRepository {
    private static instance: PayrollPremiPotonganRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): PayrollPremiPotonganRepository {
        if (!PayrollPremiPotonganRepository.instance) {
            PayrollPremiPotonganRepository.instance = new PayrollPremiPotonganRepository();
        }
        return PayrollPremiPotonganRepository.instance;
    }

    /**
     * Get Premi (Allowances) from PR_ADTRANS tables.
     */
    public async getPremi(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        isHistorical: boolean = false, 
        serverProfile?: string
    ): Promise<PremiPotonganResult> {
        if (!empCodes.length) return { amounts: {}, titleMap: {}, details: {} };
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            const rows = await db.query<{ 
                emp_code: string; 
                doc_desc: string; 
                amount: number; 
                task_code: string; 
                task_desc: string;
                row_type: string;
            }>(`
                -- Combine data from LIVE and ARC adtrans tables
                -- [CRITICAL] INNER JOIN HR_GANGLN ensures only valid members are processed
                SELECT 
                    RTRIM(t.EmpCode) as emp_code, 
                    t.DocDesc as doc_desc, 
                    SUM(ln.Amount) as amount, 
                    ln.TaskCode as task_code, 
                    mt.TaskDesc as task_desc,
                    'P' as row_type
                FROM (
                    SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                    FROM PR_ADTRANS t
                    INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                    WHERE RTRIM(t.EmpCode) IN (${empList})
                      AND t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status IN (1, 3)

                    UNION ALL

                    SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                    FROM PR_ADTRANS_ARC t
                    INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                    WHERE RTRIM(t.EmpCode) IN (${empList})
                      AND t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status = 3
                ) t
                JOIN (
                    SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN
                    UNION ALL
                    SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN_ARC
                ) ln ON t.ID = ln.MasterID
                LEFT JOIN PR_TASKCODE mt ON ln.TaskCode = mt.TaskCode
                WHERE ${isHistorical ? `(
                    UPPER(t.DocDesc) LIKE '%PREMI%'
                    AND UPPER(t.DocDesc) NOT LIKE '%PPH%'
                    AND UPPER(t.DocDesc) NOT LIKE '%JABATAN%'
                    AND UPPER(t.DocDesc) NOT LIKE '%BERAS%'
                    AND UPPER(t.DocDesc) NOT LIKE '%LEMBUR%'
                    AND UPPER(t.DocDesc) NOT LIKE '%MASA%'
                    AND UPPER(t.DocDesc) NOT LIKE '%POTONGAN%'
                    AND UPPER(t.DocDesc) NOT LIKE '%KOREKSI%'
                    AND UPPER(t.DocDesc) NOT LIKE '%SPSI%'
                )` : `(
                    UPPER(t.DocDesc) LIKE '%PREMI%'
                    AND UPPER(t.DocDesc) NOT LIKE '%PPH%'
                    AND UPPER(mt.TaskDesc) NOT LIKE '%PPH%'
                    AND mt.TaskDesc != 'ACCRUALS-CHECKROLL'
                )`}
                GROUP BY RTRIM(t.EmpCode), t.DocDesc, ln.TaskCode, mt.TaskDesc

                UNION ALL

                -- [X] Special: Premi PPH from PR_TASKREGLN for non-historical
                SELECT 
                    RTRIM(trl.EmpCode) as emp_code, 
                    'PREMI PPH' as doc_desc, 
                    SUM(trl.Amount) as amount, 
                    trl.TaskCode as task_code, 
                    tr.DocDesc as task_desc,
                    'X' as row_type
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND (trl.TaskCode = 'GA9115' OR UPPER(tr.DocDesc) LIKE '%PREMI PPH%')
                  AND ${isHistorical ? '1=0' : '1=1'} -- Skip for historical (handled via adtrans in historical)
                GROUP BY RTRIM(trl.EmpCode), trl.TaskCode, tr.DocDesc
            `, [startDate, endDate, startDate, endDate, startDate, endDate]);

            const amounts: Record<string, Record<string, number>> = {};
            const titleMap: Record<string, string> = {};
            const details: Record<string, any[]> = {};

            for (const r of rows) {
                const emp = r.emp_code?.trim() || "";
                if (!amounts[emp]) amounts[emp] = {};
                if (!details[emp]) details[emp] = [];

                let key: string;
                if (r.row_type === 'X') {
                    key = "premi_pph";
                    if (!titleMap[key]) titleMap[key] = "PREMI PPH";
                } else {
                    key = this.normalizePremiName(r.doc_desc || "");
                    if (!titleMap[key]) {
                        const taskCode = r.task_code?.trim();
                        const taskDesc = r.task_desc?.trim();
                        if (taskDesc && taskCode) {
                            titleMap[key] = `${taskDesc}\n(${taskCode})`;
                        } else {
                            titleMap[key] = (r.doc_desc || "").trim();
                        }
                    }
                }

                amounts[emp][key] = (amounts[emp][key] || 0) + (r.amount || 0);
                details[emp].push(r);
            }

            return { amounts, titleMap, details };
        } catch (error: any) {
            logError(CATEGORY, `getPremi failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get Potongan (Deductions) from PR_ADTRANS tables.
     */
    public async getPotongan(
        empCodes: string[], 
        startDate: string, 
        endDate: string, 
        isHistorical: boolean = false, 
        serverProfile?: string
    ): Promise<PremiPotonganResult> {
        if (!empCodes.length) return { amounts: {}, titleMap: {} };
        
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            const rows = await db.query<{ 
                emp_code: string; 
                doc_desc: string; 
                amount: number; 
                task_code: string; 
                task_desc: string;
                row_type: string;
            }>(`
                SELECT 
                    RTRIM(t.EmpCode) as emp_code, 
                    t.DocDesc as doc_desc, 
                    SUM(ln.Amount) as amount, 
                    ln.TaskCode as task_code, 
                    mt.TaskDesc as task_desc,
                    'P' as row_type
                FROM (
                    SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                    FROM PR_ADTRANS t
                    INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                    WHERE RTRIM(t.EmpCode) IN (${empList})
                      AND t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status IN (1, 3)

                    UNION ALL

                    SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                    FROM PR_ADTRANS_ARC t
                    INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                    WHERE RTRIM(t.EmpCode) IN (${empList})
                      AND t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status = 3
                ) t
                JOIN (
                    SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN
                    UNION ALL
                    SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN_ARC
                ) ln ON t.ID = ln.MasterID
                LEFT JOIN PR_TASKCODE mt ON ln.TaskCode = mt.TaskCode
                WHERE (
                    UPPER(t.DocDesc) LIKE '%POTONGAN%'
                    OR UPPER(t.DocDesc) LIKE '%KOREKSI%'
                    OR UPPER(t.DocDesc) LIKE '%SPSI%'
                    OR UPPER(t.DocDesc) LIKE '%PPH%'
                )
                GROUP BY RTRIM(t.EmpCode), t.DocDesc, ln.TaskCode, mt.TaskDesc

                UNION ALL

                -- [X] Special: Potongan PPH21 from PR_TASKREGLN
                SELECT 
                    RTRIM(trl.EmpCode) as emp_code, 
                    'POTONGAN PPH21' as doc_desc, 
                    SUM(trl.Amount) as amount, 
                    trl.TaskCode as task_code, 
                    tr.DocDesc as task_desc,
                    'X' as row_type
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND (trl.TaskCode = 'GA9115' OR UPPER(tr.DocDesc) LIKE '%PPH21%')
                  AND ${isHistorical ? '1=0' : '1=1'}
                GROUP BY RTRIM(trl.EmpCode), trl.TaskCode, tr.DocDesc
            `, [startDate, endDate, startDate, endDate, startDate, endDate]);

            const amounts: Record<string, Record<string, number>> = {};
            const titleMap: Record<string, string> = {};

            for (const r of rows) {
                const emp = r.emp_code?.trim() || "";
                if (!amounts[emp]) amounts[emp] = {};

                let key: string;
                if (r.row_type === 'X') {
                    key = "PREMI_PPH"; // Mapped to this key in original logic
                    if (!titleMap[key]) titleMap[key] = "PREMI PPH";
                } else {
                    const { key: k, title } = this.normalizePotonganName(r.doc_desc || "", r.task_desc, r.task_code);
                    key = k;
                    if (!titleMap[key]) {
                        if (key.startsWith('KOREKSI')) {
                            titleMap[key] = title;
                        } else {
                            const taskCode = r.task_code?.trim();
                            const taskDesc = r.task_desc?.trim();
                            if (taskDesc && taskCode) {
                                titleMap[key] = `${taskDesc}\n(${taskCode})`;
                            } else if (taskCode) {
                                titleMap[key] = taskCode;
                            } else {
                                titleMap[key] = title;
                            }
                        }
                    }
                }

                amounts[emp][key] = (amounts[emp][key] || 0) + Math.abs(r.amount || 0);
            }

            return { amounts, titleMap };
        } catch (error: any) {
            logError(CATEGORY, `getPotongan failed: ${error.message}`);
            throw error;
        }
    }

    private normalizePremiName(docDesc: string): string {
        let name = docDesc.trim().toUpperCase();
        if (name.includes("KOREKSI")) return "koreksi";
        if (name.includes("BRONDOL")) return "brondol";

        name = name
            .replace(/^TUNJANGAN\s*PREMI\s*/i, "")
            .replace(/^PREMI\s*/i, "");

        return `premi_${name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")}`;
    }

    private normalizePotonganName(docDesc: string, taskDesc?: string | null, taskCode?: string | null): { key: string; title: string } {
        const upper = docDesc.toUpperCase().trim();
        const cleanTitle = docDesc.trim();

        if (upper.includes("KOREKSI")) {
            const key = upper.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
            return { key, title: cleanTitle };
        }

        if (upper.includes("PPH") || (taskDesc && taskDesc.toUpperCase().includes("PPH"))) {
            return { key: "pot_pph21", title: "PPH21" };
        }
        if (upper.includes("SPSI") || (taskCode && taskCode.startsWith("GA9112"))) {
            return { key: "pot_spsi", title: "SPSI" };
        }

        const key = `pot_${upper.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")}`;
        return { key, title: cleanTitle };
    }
}

export const payrollPremiPotonganRepository = PayrollPremiPotonganRepository.getInstance();
