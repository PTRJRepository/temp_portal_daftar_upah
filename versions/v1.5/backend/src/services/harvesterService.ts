/**
 * Service untuk mengambil data bunches (hasil panen) dari tabel PR_HARVESTER_ARC dan PR_HARVESTERLN_ARC
 */

import { Database } from "../db/client";
import { Config } from "../config";
import type { HarvestData, HarvestDataRaw, HarvestExtendedData, HarvestMasterData, HarvestLineData } from "../types/harvest";

export class HarvesterService {
    private static instance: HarvesterService;
    private db: Database;
    private stagingAvailable: boolean;

    private constructor() {
        this.db = Database.getInstance();
        // Sesuai permintaan user: Abaikan penggunaan database staging
        this.stagingAvailable = false;
        console.log("[HarvesterService] Staging DB disabled by default as requested");
    }

    public static getInstance(): HarvesterService {
        if (!HarvesterService.instance) {
            HarvesterService.instance = new HarvesterService();
        }
        return HarvesterService.instance;
    }

    /**
     * Cek apakah suatu gang adalah gang panen (berakhiran dengan "H")
     */
    public isHarvestGang(gangCode: string): boolean {
        if (!gangCode) return false;
        return gangCode.trim().toUpperCase().endsWith("H");
    }

    /**
     * Ambil data bunches untuk karyawan tertentu dalam periode tertentu
     * PREFER: Ambil dari Staging (Ffbscannerdata)
     * FALLBACK: Ambil dari PR_HARVESTERLN_ARC (Legacy)
     */
    public async getEmployeeBunches(empCode: string, month: number, year: number): Promise<HarvestData> {
        // 1. Coba ambil dari Staging terlebih dahulu (skip if previously failed)
        if (this.stagingAvailable) {
            try {
                const stagingData = await this.getEmployeeBunchesFromStaging(empCode, month, year);
                if (stagingData.total_bunches > 0 || stagingData.bunches_transactions > 0) {
                    return stagingData;
                }
            } catch (e) {
                this.stagingAvailable = false;
                console.warn("[HarvesterService] Staging unreachable, disabling for this session. Falling back to legacy.");
            }
        }

        const defaultData: HarvestData = {
            total_bunches: 0,
            bunches_ripe: 0,
            bunches_unripe: 0,
            bunches_round: 0,
            bunches_transactions: 0,
        };

        try {
            // Logic Lama (Legacy) - OPTIMIZED
            // Query dari kedua tabel: aktif dan archive
            // PR_HARVESTERLN_ACC (aktif) dan PR_HARVESTERLN_ARC (archive)
            // Added NOLOCK hint and use AccMonth/AccYear for better index usage
            const sql = `
                SELECT
                    l.EmpCode,
                    SUM(ISNULL(l.TotalBunches, 0)) as TotalBunches,
                    SUM(ISNULL(l.Ripe, 0)) as Ripe,
                    SUM(ISNULL(l.Unripe, 0)) as Unripe,
                    SUM(ISNULL(l.TotalRound, 0)) as TotalRound,
                    COUNT(*) as TrxCount
                FROM PR_HARVESTERLN_ACC l WITH (NOLOCK)
                INNER JOIN PR_HARVESTER_ACC m WITH (NOLOCK) ON l.MasterID = m.ID
                WHERE l.EmpCode = ?
                    AND m.AccMonth = ? AND m.AccYear = ?
                GROUP BY l.EmpCode

                UNION ALL

                SELECT
                    l.EmpCode,
                    SUM(ISNULL(l.TotalBunches, 0)) as TotalBunches,
                    SUM(ISNULL(l.Ripe, 0)) as Ripe,
                    SUM(ISNULL(l.Unripe, 0)) as Unripe,
                    SUM(ISNULL(l.TotalRound, 0)) as TotalRound,
                    COUNT(*) as TrxCount
                FROM PR_HARVESTERLN_ARC l WITH (NOLOCK)
                INNER JOIN PR_HARVESTER_ARC m WITH (NOLOCK) ON l.MasterID = m.ID
                WHERE l.EmpCode = ?
                    AND m.AccMonth = ? AND m.AccYear = ?
                GROUP BY l.EmpCode
            `;

            const results = await this.db.query<HarvestDataRaw>(sql, [empCode, month, year, empCode, month, year], 90);

            if (results.length > 0) {
                // Aggregate results karena UNION ALL bisa menghasilkan multiple baris
                let totalBunches = 0, ripe = 0, unripe = 0, totalRound = 0, trxCount = 0;
                for (const row of results) {
                    totalBunches += row.TotalBunches || 0;
                    ripe += row.Ripe || 0;
                    unripe += row.Unripe || 0;
                    totalRound += row.TotalRound || 0;
                    trxCount += row.TrxCount || 0;
                }
                return {
                    total_bunches: totalBunches,
                    bunches_ripe: ripe,
                    bunches_unripe: unripe,
                    bunches_round: totalRound,
                    bunches_transactions: trxCount,
                };
            }

            return defaultData;

        } catch (error: any) {
            console.error("[HarvesterService] Error fetching employee bunches:", error.message);
            return defaultData;
        }
    }

    /**
     * Ambil data bunches untuk beberapa karyawan sekaligus (batch)
     * Digunakan untuk mengoptimalkan query saat mengambil data payroll
     */
    public async getBatchEmployeeBunches(empCodes: string[], month: number, year: number): Promise<Map<string, HarvestData>> {
        const resultMap = new Map<string, HarvestData>();

        // Default data untuk setiap karyawan
        for (const empCode of empCodes) {
            resultMap.set(empCode, {
                total_bunches: 0,
                bunches_ripe: 0,
                bunches_unripe: 0,
                bunches_round: 0,
                bunches_transactions: 0,
            });
        }

        if (empCodes.length === 0) {
            return resultMap;
        }

        // 1. Coba ambil dari Staging (skip if previously failed)
        if (this.stagingAvailable) {
            try {
                const stagingMap = await this.getBatchEmployeeBunchesFromStaging(empCodes, month, year);

                // Check if stagingMap actually has any non-zero data
                let hasStagingData = false;
                for (const val of stagingMap.values()) {
                    if (val.total_bunches > 0 || val.bunches_transactions > 0) {
                        hasStagingData = true;
                        break;
                    }
                }

                if (hasStagingData) {
                    for (const [key, val] of stagingMap) {
                        if (val.total_bunches > 0 || val.bunches_transactions > 0) {
                            resultMap.set(key, val);
                        }
                    }
                    return resultMap;
                }
            } catch (e) {
                this.stagingAvailable = false;
                console.warn("[HarvesterService] Staging unreachable, disabling for this session.");
            }
        }

        try {
            console.log("[HarvesterService] Fetching bunches (LEGACY) for", empCodes.length, "employees, month:", month, "year:", year);

            // CHUNKING: SQL Server supports max 2100 params.
            // Legacy query uses empCodes 1x + 2 (month/year), so max chunk = floor((2100 - 2) / 1) ≈ 2098
            // Using conservative chunk size of 500 to avoid timeout
            const CHUNK_SIZE = 500;
            const allLegacyResults: HarvestDataRaw[] = [];

            for (let ci = 0; ci < empCodes.length; ci += CHUNK_SIZE) {
                const chunk = empCodes.slice(ci, ci + CHUNK_SIZE);
                const placeholders = chunk.map(() => "?").join(",");

                // OPTIMIZED: Use JOIN with master table (PR_HARVESTER_ARC) for date filtering
                // Added NOLOCK hint to prevent blocking during concurrent reads
                const sql = `
                    SELECT l.EmpCode,
                        SUM(ISNULL(l.TotalBunches, 0)) as TotalBunches,
                        SUM(ISNULL(l.Ripe, 0)) as Ripe,
                        SUM(ISNULL(l.Unripe, 0)) as Unripe,
                        0 as TotalRound,
                        COUNT(*) as TrxCount
                    FROM PR_HARVESTERLN_ARC l WITH (NOLOCK)
                    INNER JOIN PR_HARVESTER_ARC m WITH (NOLOCK) ON l.MasterID = m.ID
                    WHERE l.EmpCode IN (${placeholders})
                        AND m.AccMonth = ? AND m.AccYear = ?
                    GROUP BY l.EmpCode
                `;

                const params = [...chunk, month, year];
                // Use longer timeout (120s) for large batch queries to prevent timeout on large datasets
                const chunkResults = await this.db.query<HarvestDataRaw>(sql, params, 120);
                allLegacyResults.push(...chunkResults);
            }

            const results = allLegacyResults;

            // Aggregate results karena UNION ALL bisa menghasilkan multiple baris per EmpCode
            const aggregatedMap = new Map<string, HarvestDataRaw>();
            for (const row of results) {
                const existing = aggregatedMap.get(row.EmpCode);
                if (existing) {
                    // Sum dengan data yang sudah ada
                    existing.TotalBunches = (existing.TotalBunches || 0) + (row.TotalBunches || 0);
                    existing.Ripe = (existing.Ripe || 0) + (row.Ripe || 0);
                    existing.Unripe = (existing.Unripe || 0) + (row.Unripe || 0);
                    existing.TotalRound = (existing.TotalRound || 0) + (row.TotalRound || 0);
                    existing.TrxCount = (existing.TrxCount || 0) + (row.TrxCount || 0);
                } else {
                    aggregatedMap.set(row.EmpCode, row);
                }
            }

            // Set final results
            for (const [empCode, row] of aggregatedMap) {
                resultMap.set(empCode, {
                    total_bunches: row.TotalBunches || 0,
                    bunches_ripe: row.Ripe || 0,
                    bunches_unripe: row.Unripe || 0,
                    bunches_round: row.TotalRound || 0,
                    bunches_transactions: row.TrxCount || 0,
                });
            }

        } catch (error: any) {
            const isTimeout = error.message?.includes('Timeout') || error.message?.includes('timeout');
            if (isTimeout) {
                console.warn(`[HarvesterService] ⚠️ Bunches query timed out for ${empCodes.length} employees. Returning 0 for all bunches data.`);
            } else {
                console.error("[HarvesterService] Error fetching batch bunches:", error.message);
                console.error("[HarvesterService] Error stack:", error.stack);
            }
        }

        return resultMap;
    }

    /**
     * Ambil data bunches untuk satu gang (dari Master table)
     * Digunakan untuk validasi dan summary
     */
    public async getGangBunchesFromMaster(gangCode: string, month: number, year: number): Promise<number> {
        try {
            // OPTIMIZED: Added NOLOCK hint
            const sql = `
                SELECT SUM(TotalBunches) as TotalBunches
                FROM PR_HARVESTER_ARC WITH (NOLOCK)
                WHERE GangCode = ?
                    AND AccMonth = ? AND AccYear = ?
            `;

            const result = await this.db.query<{ TotalBunches: number }>(sql, [gangCode, month, year], 60);

            if (result.length > 0) {
                return result[0].TotalBunches || 0;
            }

            return 0;

        } catch (error: any) {
            console.error("[HarvesterService] Error fetching gang bunches:", error.message);
            return 0;
        }
    }

    /**
     * Ambil data bunches lengkap (extended) untuk karyawan
     * Termasuk data master dan line
     */
    public async getEmployeeBunchesExtended(empCode: string, gangCode: string, month: number, year: number): Promise<HarvestExtendedData | null> {
        try {
            // OPTIMIZED: Added NOLOCK hint and use AccMonth/AccYear for better index usage
            const lineSql = `
                SELECT TOP 1
                    m.GangCode,
                    m.DocDate,
                    l.EmpCode,
                    SUM(l.TotalBunches) as TotalBunches,
                    SUM(l.Ripe) as Ripe,
                    SUM(l.Unripe) as Unripe,
                    SUM(l.TotalRound) as TotalRound,
                    COUNT(*) as TrxCount
                FROM PR_HARVESTERLN_ARC l WITH (NOLOCK)
                INNER JOIN PR_HARVESTER_ARC m WITH (NOLOCK) ON l.MasterID = m.ID
                WHERE l.EmpCode = ?
                    AND m.GangCode = ?
                    AND m.AccMonth = ?
                    AND m.AccYear = ?
                GROUP BY m.GangCode, m.DocDate, l.EmpCode
            `;

            const results = await this.db.query<any>(lineSql, [empCode, gangCode, month, year], 90);

            if (results.length > 0) {
                const row = results[0];
                return {
                    gang_code: row.GangCode,
                    emp_code: row.EmpCode,
                    emp_name: row.EmpName,
                    month: month,
                    year: year,
                    doc_date: new Date(row.DocDate),
                    total_bunches: row.TotalBunches || 0,
                    bunches_ripe: row.Ripe || 0,
                    bunches_unripe: row.Unripe || 0,
                    bunches_round: row.TotalRound || 0,
                    bunches_transactions: row.TrxCount || 0,
                };
            }

            return null;

        } catch (error: any) {
            console.error("[HarvesterService] Error fetching extended bunches:", error.message);
            return null;
        }
    }

    /**
     * Ambil data panen harian untuk satu karyawan dalam satu bulan
     * Mengembalikan list transaksi harian dengan Berat (Kg) dan Janjang/Bunches
     */
    public async getDailyEmployeeHarvest(empCode: string, month: number, year: number): Promise<HarvestLineData[]> {
        try {
            // OPTIMIZED: Added NOLOCK hint and use AccMonth/AccYear for better index usage
            const sql = `
                SELECT
                    l.ID,
                    l.MasterID,
                    l.EmpCode,
                    l.EmpName,
                    l.TrxDate,
                    m.GangCode,
                    m.LocCode,
                    SUM(l.TotalBunches) as TotalBunches,
                    SUM(l.TotalWeight) as TotalWeight,
                    SUM(l.Ripe) as Ripe,
                    SUM(l.Unripe) as Unripe,
                    MAX(l.Rate) as Rate,
                    SUM(l.Amount) as Amount
                FROM PR_HARVESTERLN_ARC l WITH (NOLOCK)
                INNER JOIN PR_HARVESTER_ARC m WITH (NOLOCK) ON l.MasterID = m.ID
                WHERE l.EmpCode = ?
                    AND m.AccMonth = ?
                    AND m.AccYear = ?
                GROUP BY l.ID, l.MasterID, l.EmpCode, l.EmpName, l.TrxDate, m.GangCode, m.LocCode
                ORDER BY l.TrxDate
            `;

            // Use 90s timeout for individual employee harvest query
            const results = await this.db.query<any>(sql, [empCode, month, year], 90);

            // Map result ke type HarvestLineData (atau subset yang kita butuhkan)
            return results.map(row => ({
                ID: row.ID,
                MasterID: row.MasterID,
                GangMember: true, // Asumsi
                EmpCode: row.EmpCode,
                EmpName: row.EmpName,
                TaskCode: 'HARVEST', // Placeholder
                TaskRtnVal: 0,
                GrpRef: row.GangCode, // Pakai GangCode sebagai referensi grup
                ChargeTo: row.LocCode,
                Hours: 0, // Panen biasanya by result, bukan jam (kecuali HK)
                Ripe: row.Ripe || 0,
                Unripe: row.Unripe || 0,
                TotalBunches: row.TotalBunches || 0,
                Rate: row.Rate || 0,
                ABW: 0,
                Amount: row.Amount || 0,
                Status: 1,
                TrxDate: new Date(row.TrxDate),
                TotalRound: 0,
                TotalWeight: row.TotalWeight || 0
            }));

        } catch (error: any) {
            console.error("[HarvesterService] Error fetching daily employee harvest:", error.message);
            return [];
        }
    }

    /**
     * Ambil data bunches dari Staging Database (Ffbscannerdata)
     * Digunakan sebagai alternatif atau pengganti PR_HARVESTERLN
     */
    public async getEmployeeBunchesFromStaging(empCode: string, month: number, year: number): Promise<HarvestData> {
        const defaultData: HarvestData = {
            total_bunches: 0,
            bunches_ripe: 0,
            bunches_unripe: 0,
            bunches_round: 0,
            bunches_transactions: 0,
            bunches_underripe: 0,
            bunches_overripe: 0,
            bunches_rotten: 0,
            bunches_abnormal: 0,
            loose_fruit: 0
        };

        try {
            // Gunakan profile yang sama dengan main DB (Server 2), tapi arahkan ke staging database
            const stagingDb = Database.getInstance(Config.DB_STAGING_DATABASE, Config.DB_STAGING_PROFILE);

            const sql = `
                SELECT
                    WORKERCODE as EmpCode,
                    -- Total Bunches = Sum of all categories
                    SUM(ISNULL(RIPE, 0) + ISNULL(UNRIPE, 0) + ISNULL(UNDERRIPE, 0) + ISNULL(OVERRIPE, 0) + ISNULL(ROTTEN, 0) + ISNULL(ABNORMAL, 0)) as TotalBunches,
                    SUM(ISNULL(RIPE, 0)) as Ripe,
                    SUM(ISNULL(UNRIPE, 0)) as Unripe,
                    SUM(ISNULL(UNDERRIPE, 0)) as Underripe,
                    SUM(ISNULL(OVERRIPE, 0)) as Overripe,
                    SUM(ISNULL(ROTTEN, 0)) as Rotten,
                    SUM(ISNULL(ABNORMAL, 0)) as Abnormal,
                    SUM(ISNULL(LOOSEFRUIT, 0)) as Loosefruit,
                    0 as TotalRound, -- Tidak ada kolom Round di Ffbscannerdata
                    COUNT(*) as TrxCount
                FROM [${Config.DB_STAGING_DATABASE}].[dbo].[Ffbscannerdata]
                WHERE WORKERCODE = ?
                    AND MONTH(TRANSDATE) = ?
                    AND YEAR(TRANSDATE) = ?
                    AND (TRANSSTATUS = 'OK' OR TRANSSTATUS LIKE 'OK%')
                GROUP BY WORKERCODE
            `;

            const results = await stagingDb.query<HarvestDataRaw>(sql, [empCode, month, year]);

            if (results.length > 0) {
                const row = results[0];
                return {
                    total_bunches: row.TotalBunches || 0,
                    bunches_ripe: row.Ripe || 0,
                    bunches_unripe: row.Unripe || 0,
                    bunches_round: row.TotalRound || 0,
                    bunches_transactions: row.TrxCount || 0,
                    bunches_underripe: row.Underripe || 0,
                    bunches_overripe: row.Overripe || 0,
                    bunches_rotten: row.Rotten || 0,
                    bunches_abnormal: row.Abnormal || 0,
                    loose_fruit: row.Loosefruit || 0
                };
            }

            return defaultData;

        } catch (error: any) {
            console.error("[HarvesterService] Error fetching employee bunches from staging:", error.message);
            return defaultData;
        }
    }

    /**
     * Batch retrieval from Staging
     */
    public async getBatchEmployeeBunchesFromStaging(empCodes: string[], month: number, year: number): Promise<Map<string, HarvestData>> {
        const resultMap = new Map<string, HarvestData>();

        // Default data
        for (const empCode of empCodes) {
            resultMap.set(empCode, {
                total_bunches: 0,
                bunches_ripe: 0,
                bunches_unripe: 0,
                bunches_round: 0,
                bunches_transactions: 0,
                bunches_underripe: 0,
                bunches_overripe: 0,
                bunches_rotten: 0,
                bunches_abnormal: 0,
                loose_fruit: 0
            });
        }

        if (empCodes.length === 0) return resultMap;

        try {
            const stagingDb = Database.getInstance(Config.DB_STAGING_DATABASE, Config.DB_STAGING_PROFILE);

            // CHUNKING: SQL Server max 2100 params. Staging uses empCodes 1x + 2 (month, year)
            const STAGING_CHUNK = 1800;
            const allStagingResults: HarvestDataRaw[] = [];

            for (let ci = 0; ci < empCodes.length; ci += STAGING_CHUNK) {
                const chunk = empCodes.slice(ci, ci + STAGING_CHUNK);
                const placeholders = chunk.map(() => "?").join(",");

                const sql = `
                    SELECT
                        WORKERCODE as EmpCode,
                        SUM(ISNULL(RIPE, 0) + ISNULL(UNRIPE, 0) + ISNULL(UNDERRIPE, 0) + ISNULL(OVERRIPE, 0) + ISNULL(ROTTEN, 0) + ISNULL(ABNORMAL, 0)) as TotalBunches,
                        SUM(ISNULL(RIPE, 0)) as Ripe,
                        SUM(ISNULL(UNRIPE, 0)) as Unripe,
                        SUM(ISNULL(UNDERRIPE, 0)) as Underripe,
                        SUM(ISNULL(OVERRIPE, 0)) as Overripe,
                        SUM(ISNULL(ROTTEN, 0)) as Rotten,
                        SUM(ISNULL(ABNORMAL, 0)) as Abnormal,
                        SUM(ISNULL(LOOSEFRUIT, 0)) as Loosefruit,
                        0 as TotalRound,
                        COUNT(*) as TrxCount
                    FROM [${Config.DB_STAGING_DATABASE}].[dbo].[Ffbscannerdata]
                    WHERE WORKERCODE IN (${placeholders})
                        AND MONTH(TRANSDATE) = ?
                        AND YEAR(TRANSDATE) = ?
                        AND (TRANSSTATUS = 'OK' OR TRANSSTATUS LIKE 'OK%')
                    GROUP BY WORKERCODE
                `;

                const params = [...chunk, month, year];
                const chunkResults = await stagingDb.query<HarvestDataRaw>(sql, params);
                allStagingResults.push(...chunkResults);
            }

            for (const row of allStagingResults) {
                resultMap.set(row.EmpCode, {
                    total_bunches: row.TotalBunches || 0,
                    bunches_ripe: row.Ripe || 0,
                    bunches_unripe: row.Unripe || 0,
                    bunches_round: row.TotalRound || 0,
                    bunches_transactions: row.TrxCount || 0,
                    bunches_underripe: row.Underripe || 0,
                    bunches_overripe: row.Overripe || 0,
                    bunches_rotten: row.Rotten || 0,
                    bunches_abnormal: row.Abnormal || 0,
                    loose_fruit: row.Loosefruit || 0
                });
            }

            console.log(`[HarvesterService] Fetched batch from Staging: ${allStagingResults.length} rows`);

        } catch (error: any) {
            console.error("[HarvesterService] Error fetching batch bunches from staging:", error.message);
        }

        return resultMap;
    }
}


export const harvesterService = HarvesterService.getInstance();
