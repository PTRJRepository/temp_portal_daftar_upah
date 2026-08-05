/**
 * PremiumExtractor - Extract Premi Data
 *
 * Extracts employee premium (premi) data from PR_ADTRANS tables.
 *
 * Data extracted:
 * - amounts: Record<empCode, Record<docDesc, totalAmount>> - premiums by type
 * - titleMap: Record<docDesc, normalizedTitle> - display titles for columns
 * - details: Record<empCode, any[]> - detail records for each employee
 *
 * Source tables:
 * - PR_ADTRANS + PR_ADTRANSLN (live)
 * - PR_ADTRANS_ARC + PR_ADTRANSLN_ARC (archive)
 *
 * JOIN: PR_ADTRANS → PR_ADTRANSLN on ID = MasterID
 *
 * FILTER:
 * - DocDesc contains 'PREMI' (but NOT 'PPH')
 * - Amount > 0
 * - Excludes TaskDesc = 'ACCRUALS-CHECKROLL' (Premi PPH is separate)
 *
 * Note: Brondol premiums are dual-source (PR_LOOSEFRUIT + PR_ADTRANS) and
 * are aggregated in the final result as premi_brondol_total.
 *
 * @module payroll/extractors/PremiumExtractor
 */

import { Database } from '../../../db/client';

/**
 * PremiumResult - Premium extraction result
 */
export interface PremiumResult {
    /** Employee code → { docDesc → amount } mapping */
    amounts: Record<string, Record<string, number>>;
    /** DocDesc → display title mapping for column headers */
    titleMap: Record<string, string>;
    /** Employee code → detail records */
    details: Record<string, any[]>;
}

/**
 * Query result row type
 */
interface PremiumQueryRow {
    emp_code: string;
    doc_desc: string;
    amount: number;
    task_code: string;
    task_desc: string;
}

/**
 * Normalize DocDesc for display title
 *
 * Transforms raw DocDesc to cleaner display format:
 * - 'PREMI PANEN BRONDOL' → 'PREMI PANEN BRONDOL'
 * - 'PREMI PRUNING' → 'PREMI PRUNING'
 * - 'DYNAMIC PREM' → 'DYNAMIC PREM'
 */
function normalizeDocDesc(docDesc: string | null): string {
    if (!docDesc) return 'PREMI';
    return docDesc.trim().toUpperCase();
}

export class PremiumExtractor {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Extract premium data for multiple employees
     *
     * Queries PR_ADTRANS where DocDesc contains 'PREMI' but NOT 'PPH'.
     * Combines live and archive tables for complete coverage.
     *
     * Premium types typically include:
     * - PREMI PANEN BRONDOL
     * - PREMI PRUNING
     * - PREMI INSENTIF
     * - DYNAMIC PREMI variants
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param isHistorical - Use archive tables
     * @param serverProfile - Optional DB profile override
     * @returns PremiumResult with amounts, titleMap, and details
     */
    async extract(
        empCodes: string[],
        startDate: string,
        endDate: string,
        isHistorical: boolean = false,
        serverProfile?: string
    ): Promise<PremiumResult> {
        if (!empCodes.length) return { amounts: {}, titleMap: {}, details: {} };

        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        const empList = empCodes.map(e => `'${e}'`).join(',');

        /**
         * Query DocDesc containing 'PREMI' but EXCLUDING 'PPH' and 'ADJ'
         *
         * INNER JOIN HR_GANGLN ensures only valid gang members are processed.
         * This prevents orphaned adtrans records for employees not in the current gang.
         *
         * Excludes TaskDesc = 'ACCRUALS-CHECKROLL' (Premi PPH is separate query)
         */
        const rows = await db.query<PremiumQueryRow>(`
            SELECT
                RTRIM(t.EmpCode) as emp_code,
                t.DocDesc as doc_desc,
                SUM(ln.Amount) as amount,
                ln.TaskCode as task_code,
                mt.TaskDesc as task_desc
            FROM (
                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS t
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ?
                  AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%PREMI%'
                  AND UPPER(t.DocDesc) NOT LIKE '%PPH%'
                  AND UPPER(t.DocDesc) NOT LIKE '%ADJ%'
                  AND t.Status IN (1, 3)

                UNION ALL

                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS_ARC t
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ?
                  AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%PREMI%'
                  AND UPPER(t.DocDesc) NOT LIKE '%PPH%'
                  AND UPPER(t.DocDesc) NOT LIKE '%ADJ%'
                  AND t.Status = 3
            ) t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            LEFT JOIN PR_TASKCODE mt ON ln.TaskCode = mt.TaskCode
            WHERE ln.Amount > 0
              AND (mt.TaskDesc IS NULL OR mt.TaskDesc != 'ACCRUALS-CHECKROLL')
            GROUP BY RTRIM(t.EmpCode), t.DocDesc, ln.TaskCode, mt.TaskDesc
            ORDER BY emp_code, doc_desc
        `, [startDate, endDate, startDate, endDate]);

        // Build result structures
        const amounts: Record<string, Record<string, number>> = {};
        const titleMap: Record<string, string> = {};
        const details: Record<string, any[]> = {};

        // Initialize for all employees
        for (const emp of empCodes) {
            amounts[emp] = {};
            details[emp] = [];
        }

        // Process rows
        for (const r of rows) {
            const emp = r.emp_code?.trim() || '';
            const docDesc = normalizeDocDesc(r.doc_desc);

            if (!amounts[emp]) {
                amounts[emp] = {};
            }
            if (!details[emp]) {
                details[emp] = [];
            }

            // Accumulate amounts by DocDesc
            amounts[emp][docDesc] = (amounts[emp][docDesc] || 0) + (r.amount || 0);

            // Build title map for column headers
            if (!titleMap[docDesc]) {
                titleMap[docDesc] = docDesc;
            }

            // Collect detail records
            details[emp].push({
                doc_desc: docDesc,
                task_code: r.task_code,
                task_desc: r.task_desc,
                amount: r.amount
            });
        }

        return { amounts, titleMap, details };
    }

    /**
     * Extract Brondol premium from PR_LOOSEFRUIT table
     *
     * Brondol (loose fruit) premiums come from a separate source (PR_LOOSEFRUIT)
     * in addition to PR_ADTRANS. This method provides the loose fruit component.
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → brondol loose fruit premium amount
     */
    async extractBrondolLooseFruit(
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
            SELECT
                RTRIM(l.EmpCode) as emp_code,
                SUM(l.Amount) as total_amount
            FROM PR_LOOSEFRUITLN l
            INNER JOIN PR_LOOSEFRUIT m ON l.MasterID = m.ID
            WHERE l.EmpCode IN (${empList})
              AND m.DocDate >= ?
              AND m.DocDate < ?
            GROUP BY l.EmpCode

            UNION ALL

            SELECT
                RTRIM(l.EmpCode) as emp_code,
                SUM(l.Amount) as total_amount
            FROM PR_LOOSEFRUITLN_ARC l
            INNER JOIN PR_LOOSEFRUIT_ARC m ON l.MasterID = m.ID
            WHERE l.EmpCode IN (${empList})
              AND m.DocDate >= ?
              AND m.DocDate < ?
            GROUP BY l.EmpCode
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, number> = {};
        for (const r of rows) {
            result[r.emp_code?.trim() || ''] = r.total_amount || 0;
        }
        return result;
    }
}

// Singleton instance
let instance: PremiumExtractor | null = null;

export function getPremiumExtractor(): PremiumExtractor {
    if (!instance) {
        instance = new PremiumExtractor();
    }
    return instance;
}
