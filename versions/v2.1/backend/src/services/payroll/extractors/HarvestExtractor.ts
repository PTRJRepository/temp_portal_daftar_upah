/**
 * HarvestExtractor - Extract FFB Harvesting (Panen) Data
 *
 * Extracts employee harvesting/bunches data from PR_TASKREGLN tables.
 * Used for harvest gangs (gang codes ending with "H" like 'H1H', 'H2H').
 *
 * Data extracted:
 * - bunches_total: Total harvested bunches
 * - bunches_ripe: Ripe bunches
 * - bunches_unripe: Unripe bunches
 * - bunches_underripe: Underripe bunches
 * - bunches_overripe: Overripe bunches
 * - bunches_rotten: Rotten bunches
 * - bunches_abnormal: Abnormal bunches
 * - loose_fruit: Loose fruit weight
 * - bunches_transactions: Number of harvest transactions
 *
 * Source tables:
 * - PR_TASKREGLN (live) - Harvest task codes
 * - PR_TASKREGLN_ARC (archive)
 *
 * JOIN: PR_TASKREG / PR_TASKREG_ARC for MasterID
 *
 * FILTER:
 * - OT = 0 (non-overtime transactions)
 * - TaskCode patterns: 'GA9101%' through 'GA9108%' (harvest task codes)
 * - Only for harvest gangs (ending with "H")
 *
 * Note: This extractor is only used for gangs that perform harvesting.
 * For non-harvest gangs, all bunches fields will be 0.
 *
 * @module payroll/extractors/HarvestExtractor
 */

import { Database } from '../../../db/client';

/**
 * HarvestData - Complete harvest record per employee
 */
export interface HarvestData {
    bunches_total: number;
    bunches_ripe: number;
    bunches_unripe: number;
    bunches_underripe: number;
    bunches_overripe: number;
    bunches_rotten: number;
    bunches_abnormal: number;
    loose_fruit: number;
    bunches_transactions: number;
}

/**
 * Query result row type from harvest query
 */
interface HarvestQueryRow {
    emp_code: string;
    bunches_total: number;
    bunches_ripe: number;
    bunches_unripe: number;
    bunches_underripe: number;
    bunches_overripe: number;
    bunches_rotten: number;
    bunches_abnormal: number;
    loose_fruit: number;
    bunches_transactions: number;
}

/**
 * Task code to bunch category mapping
 *
 * PR_TASKREGLN stores harvest data with different TaskCodes:
 * - GA9101: Normal ripe bunches
 * - GA9102: Unripe bunches
 * - GA9103: Underripe bunches
 * - GA9104: Overripe bunches
 * - GA9105: Rotten bunches
 * - GA9106: Abnormal bunches
 * - GA9107: Loose fruit (if tracked in taskregln)
 * - GA9108: Total/count transactions
 */
const HARVEST_TASK_CODES = {
    RIPE: 'GA9101%',
    UNRIPE: 'GA9102%',
    UNDERRIPE: 'GA9103%',
    OVERRIPE: 'GA9104%',
    ROTTEN: 'GA9105%',
    ABNORMAL: 'GA9106%',
    LOOSE_FRUIT: 'GA9107%',
    TRANSACTIONS: 'GA9108%'
};

export class HarvestExtractor {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Extract harvest data for multiple employees
     *
     * Queries PR_TASKREGLN for harvest task codes (GA9101% - GA9108%).
     * Combines live and archive tables for complete coverage.
     *
     * Only includes OT = 0 transactions (non-overtime).
     *
     * @param empCodes - Array of employee codes to fetch
     * @param startDate - Period start (YYYY-MM-DD)
     * @param endDate - Period end (YYYY-MM-DD)
     * @param serverProfile - Optional DB profile override
     * @returns Record mapping empCode → HarvestData
     */
    async extract(
        empCodes: string[],
        startDate: string,
        endDate: string,
        serverProfile?: string
    ): Promise<Record<string, HarvestData>> {
        if (!empCodes.length) return {};

        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        const empList = empCodes.map(e => `'${e}'`).join(',');

        /**
         * Harvest data query using conditional aggregation
         *
         * Each TaskCode pattern maps to a specific bunch category:
         * - GA9101 = Ripe (matang)
         * - GA9102 = Unripe (mentah)
         * - GA9103 = Underripe (kurang matang)
         * - GA9104 = Overripe (lewat matang)
         * - GA9105 = Rotten (busuk)
         * - GA9106 = Abnormal (abnormal)
         * - GA9107 = Loose fruit (buah lepas)
         * - GA9108 = Transaction count
         *
         * Uses Amount field for bunch counts (standard in harvest tracking)
         */
        const rows = await db.query<HarvestQueryRow>(`
            SELECT
                RTRIM(trl.EmpCode) as emp_code,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9101%' THEN trl.Amount ELSE 0 END) as bunches_ripe,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9102%' THEN trl.Amount ELSE 0 END) as bunches_unripe,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9103%' THEN trl.Amount ELSE 0 END) as bunches_underripe,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9104%' THEN trl.Amount ELSE 0 END) as bunches_overripe,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9105%' THEN trl.Amount ELSE 0 END) as bunches_rotten,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9106%' THEN trl.Amount ELSE 0 END) as bunches_abnormal,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9107%' THEN trl.Amount ELSE 0 END) as loose_fruit,
                SUM(CASE WHEN trl.TaskCode LIKE 'GA9108%' THEN trl.Amount ELSE 0 END) as bunches_transactions
            FROM (
                -- LIVE table
                SELECT trl.EmpCode, trl.TaskCode, trl.Amount
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND (
                      trl.TaskCode LIKE 'GA9101%'
                      OR trl.TaskCode LIKE 'GA9102%'
                      OR trl.TaskCode LIKE 'GA9103%'
                      OR trl.TaskCode LIKE 'GA9104%'
                      OR trl.TaskCode LIKE 'GA9105%'
                      OR trl.TaskCode LIKE 'GA9106%'
                      OR trl.TaskCode LIKE 'GA9107%'
                      OR trl.TaskCode LIKE 'GA9108%'
                  )

                UNION ALL

                -- ARCHIVE table
                SELECT trl.EmpCode, trl.TaskCode, trl.Amount
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ?
                  AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND (
                      trl.TaskCode LIKE 'GA9101%'
                      OR trl.TaskCode LIKE 'GA9102%'
                      OR trl.TaskCode LIKE 'GA9103%'
                      OR trl.TaskCode LIKE 'GA9104%'
                      OR trl.TaskCode LIKE 'GA9105%'
                      OR trl.TaskCode LIKE 'GA9106%'
                      OR trl.TaskCode LIKE 'GA9107%'
                      OR trl.TaskCode LIKE 'GA9108%'
                  )
            ) trl
            GROUP BY RTRIM(trl.EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        // Initialize result with all employees (0 values for non-harvest)
        const result: Record<string, HarvestData> = {};
        for (const emp of empCodes) {
            result[emp] = {
                bunches_total: 0,
                bunches_ripe: 0,
                bunches_unripe: 0,
                bunches_underripe: 0,
                bunches_overripe: 0,
                bunches_rotten: 0,
                bunches_abnormal: 0,
                loose_fruit: 0,
                bunches_transactions: 0
            };
        }

        // Fill in actual values from query
        for (const r of rows) {
            const emp = r.emp_code?.trim() || '';
            if (result[emp]) {
                const bunches_ripe = r.bunches_ripe || 0;
                const bunches_unripe = r.bunches_unripe || 0;
                const bunches_underripe = r.bunches_underripe || 0;
                const bunches_overripe = r.bunches_overripe || 0;
                const bunches_rotten = r.bunches_rotten || 0;
                const bunches_abnormal = r.bunches_abnormal || 0;

                result[emp] = {
                    bunches_total: bunches_ripe + bunches_unripe + bunches_underripe + bunches_overripe + bunches_rotten + bunches_abnormal,
                    bunches_ripe: bunches_ripe,
                    bunches_unripe: bunches_unripe,
                    bunches_underripe: bunches_underripe,
                    bunches_overripe: bunches_overripe,
                    bunches_rotten: bunches_rotten,
                    bunches_abnormal: bunches_abnormal,
                    loose_fruit: r.loose_fruit || 0,
                    bunches_transactions: r.bunches_transactions || 0
                };
            }
        }

        return result;
    }
}

// Singleton instance
let instance: HarvestExtractor | null = null;

export function getHarvestExtractor(): HarvestExtractor {
    if (!instance) {
        instance = new HarvestExtractor();
    }
    return instance;
}
