/**
 * DeductionExtractor - Extract Potongan (Deduction) Data
 *
 * Extracts employee deduction data from PR_ADTRANS tables.
 *
 * Data extracted:
 * - amounts: Record<empCode, Record<docDesc, totalAmount>> - deductions by type
 * - titleMap: Record<docDesc, normalizedTitle> - display titles for columns
 *
 * Source tables:
 * - PR_ADTRANS + PR_ADTRANSLN (live)
 * - PR_ADTRANS_ARC + PR_ADTRANSLN_ARC (archive)
 *
 * JOIN: PR_ADTRANS → PR_ADTRANSLN on ID = MasterID
 *
 * FILTER:
 * - Amount < 0 (negative = deduction)
 * - DocDesc does NOT start with 'POT' (those go to separate koreksi handling)
 * - Excludes: SPSI, BERAS, JABATAN, MASA, LEMBUR, PPH variants
 *
 * Note: Deductions with DocDesc starting with 'POT' are handled separately
 * as they represent correction items (koreksi) not standard deductions.
 *
 * @module payroll/extractors/DeductionExtractor
 */

import { Database } from '../../../db/client';

/**
 * DeductionResult - Deduction extraction result
 */
export interface DeductionResult {
    /** Employee code → { docDesc → amount } mapping */
    amounts: Record<string, Record<string, number>>;
    /** DocDesc → display title mapping for column headers */
    titleMap: Record<string, string>;
}

/**
 * Query result row type
 */
interface DeductionQueryRow {
    emp_code: string;
    doc_desc: string;
    amount: number;
}

/**
 * Normalize DocDesc for display title
 *
 * Transforms raw DocDesc to cleaner display format:
 * - 'BPJS KESEHATAN' → 'BPJS KESEHATAN'
 * - 'ASTEK' → 'ASTEK'
 * - 'PPh21' → 'PPh21'
 */
function normalizeDocDesc(docDesc: string | null): string {
    if (!docDesc) return 'POTONGAN';
    return docDesc.trim().toUpperCase();
}

export class DeductionExtractor {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Extract deduction data for multiple employees
     *
     * Queries PR_ADTRANS where Amount < 0 (deductions).
     * Combines live and archive tables for complete coverage.
     *
     * Deduction types typically include:
     * - BPJS Kesehatan
     * - ASTEK / BP Jamsostek
     * - SPSI
     * - PPH21 / PPh21
     *
     * Excluded patterns:
     * - DocDesc starting with 'POT' (koreksi/corrections)
     * - SPSI, BERAS, JABATAN, MASA, LEMBUR (separate handling)
     * - PPH variants (separate PPh21 calculation)
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns DeductionResult with amounts and titleMap
     */
    async extract(
        empCodes: string[],
        startDate: string,
        endDate: string,
        serverProfile?: string
    ): Promise<DeductionResult> {
        if (!empCodes.length) return { amounts: {}, titleMap: {} };

        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        const empList = empCodes.map(e => `'${e}'`).join(',');

        /**
         * Query deductions (Amount < 0) from PR_ADTRANS
         *
         * Excludes:
         * - DocDesc starting with 'POT' (koreksi - handled separately)
         * - PPH variants (handled by PPh21 TER calculation)
         * - SPSI (has dedicated field)
         * - BERAS, JABATAN, MASA (tunjangan, not potongan)
         * - LEMBUR (handled by overtime extractor)
         */
        const rows = await db.query<DeductionQueryRow>(`
            SELECT
                RTRIM(t.EmpCode) as emp_code,
                t.DocDesc as doc_desc,
                SUM(ln.Amount) as amount
            FROM (
                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS t
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ?
                  AND t.DocDate < ?
                  AND ln.Amount < 0
                  AND t.Status IN (1, 3)

                UNION ALL

                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS_ARC t
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ?
                  AND t.DocDate < ?
                  AND ln.Amount < 0
                  AND t.Status = 3
            ) t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE ln.Amount < 0
              AND UPPER(t.DocDesc) NOT LIKE 'POT%'
              AND UPPER(t.DocDesc) NOT LIKE '%PPH%'
              AND UPPER(t.DocDesc) NOT LIKE 'SPSI'
              AND UPPER(t.DocDesc) NOT LIKE 'BERAS'
              AND UPPER(t.DocDesc) NOT LIKE 'JABATAN'
              AND UPPER(t.DocDesc) NOT LIKE 'MASA%'
              AND UPPER(t.DocDesc) NOT LIKE 'LEMBUR%'
            GROUP BY RTRIM(t.EmpCode), t.DocDesc
            ORDER BY emp_code, doc_desc
        `, [startDate, endDate, startDate, endDate]);

        // Build result structures
        const amounts: Record<string, Record<string, number>> = {};
        const titleMap: Record<string, string> = {};

        // Initialize for all employees
        for (const emp of empCodes) {
            amounts[emp] = {};
        }

        // Process rows - accumulate absolute values
        for (const r of rows) {
            const emp = r.emp_code?.trim() || '';
            const docDesc = normalizeDocDesc(r.doc_desc);

            if (!amounts[emp]) {
                amounts[emp] = {};
            }

            // Amount is negative, store absolute value for deductions
            amounts[emp][docDesc] = (amounts[emp][docDesc] || 0) + Math.abs(r.amount || 0);

            // Build title map for column headers
            if (!titleMap[docDesc]) {
                titleMap[docDesc] = docDesc;
            }
        }

        return { amounts, titleMap };
    }

    /**
     * Extract SPSI deduction specifically
     *
     * SPSI is a fixed deduction amount (typically Rp 4.000)
     * stored in PR_ADTRANS with DocDesc = 'SPSI'
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → SPSI deduction amount
     */
    async extractSpsi(
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
                RTRIM(t.EmpCode) as emp_code,
                SUM(ABS(ln.Amount)) as total_amount
            FROM PR_ADTRANS t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) IN (${empList})
              AND t.DocDate >= ?
              AND t.DocDate < ?
              AND UPPER(t.DocDesc) = 'SPSI'
              AND t.Status = 1
            GROUP BY RTRIM(t.EmpCode)

            UNION ALL

            SELECT
                RTRIM(t.EmpCode) as emp_code,
                SUM(ABS(ln.Amount)) as total_amount
            FROM PR_ADTRANS_ARC t
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) IN (${empList})
              AND t.DocDate >= ?
              AND t.DocDate < ?
              AND UPPER(t.DocDesc) = 'SPSI'
              AND t.Status = 3
            GROUP BY RTRIM(t.EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, number> = {};
        for (const r of rows) {
            result[r.emp_code?.trim() || ''] = r.total_amount || 0;
        }
        return result;
    }

    /**
     * Extract Koreksi (correction) deductions
     *
     * Koreksi items have DocDesc starting with 'POT' and represent
     * correction/deduction items that reduce the upah_kotor.
     *
     * IMPORTANT: pot_koreksi is ADDED to jumlah_upah_kotor (as negative adjustment)
     * but NOT included in total_potongan (to avoid double deduction).
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → total koreksi amount
     */
    async extractKoreksi(
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
                RTRIM(t.EmpCode) as emp_code,
                SUM(ABS(ln.Amount)) as total_amount
            FROM PR_ADTRANS t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) IN (${empList})
              AND t.DocDate >= ?
              AND t.DocDate < ?
              AND UPPER(t.DocDesc) LIKE 'POT%'
              AND t.Status = 1
            GROUP BY RTRIM(t.EmpCode)

            UNION ALL

            SELECT
                RTRIM(t.EmpCode) as emp_code,
                SUM(ABS(ln.Amount)) as total_amount
            FROM PR_ADTRANS_ARC t
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) IN (${empList})
              AND t.DocDate >= ?
              AND t.DocDate < ?
              AND UPPER(t.DocDesc) LIKE 'POT%'
              AND t.Status = 3
            GROUP BY RTRIM(t.EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, number> = {};
        for (const r of rows) {
            result[r.emp_code?.trim() || ''] = r.total_amount || 0;
        }
        return result;
    }
}

// Singleton instance
let instance: DeductionExtractor | null = null;

export function getDeductionExtractor(): DeductionExtractor {
    if (!instance) {
        instance = new DeductionExtractor();
    }
    return instance;
}
