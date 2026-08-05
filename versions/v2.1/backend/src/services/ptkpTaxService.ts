/**
 * PTKP Tax Service
 *
 * Service khusus untuk mengelola data PTKP (Penghasilan Tidak Kena Pajak).
 * Terpisah dari seeder biasa - hanya diaktifkan secara manual.
 *
 * Mekanisme:
 * 1. Membaca RiceRation (beras_rate) dari HR_PAYROLL di origin DB
 * 2. Meng-convert ke status PTKP (TK/0, K/0, K/1, K/2, K/3, TK/1, TK/2, TK/3)
 * 3. Menentukan kategori TER (TER A, TER B, TER C)
 * 4. Menyimpan ke tabel history_ptkp_pajak di extend_db_ptrj (per tahun)
 * 5. Mengupdate ptkp_pajak di history_hr_employee
 *
 * PTKP bersifat persistent per tahun - tidak berubah sampai ganti tahun.
 *
 * PTKP mapping delegated to payroll/formulas/PTKPMapper.ts (Single Source of Truth)
 */

import { Database } from "../db/client";
import { Config } from "../config";
import { mapBerasRateToPTKP, mapPTKPToTER } from './payroll/formulas/PTKPMapper';

// Re-export for backward compatibility - consumers import from ptkpTaxService
export { mapBerasRateToPTKP, mapPTKPToTER };

// ============================================================
// Interfaces
// ============================================================

export interface PtkpRecord {
    id?: number;
    period_year: number;
    emp_code: string;
    emp_name?: string;
    nik?: string;
    division_code?: string;
    gang_code?: string;
    loc_code?: string;
    beras_rate: number;
    ptkp_status: string;
    kategori_ter?: string;
    source?: string;
    created_at?: Date;
    updated_at?: Date;
    created_by?: string;
}

export interface PtkpUpdateResult {
    success: boolean;
    period_year: number;
    total_employees: number;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    errors: string[];
    summary: {
        ptkp_distribution: Record<string, number>;
        ter_distribution: Record<string, number>;
    };
}

export interface PtkpChangelogRecord {
    id?: number;
    period_year: number;
    emp_code: string;
    old_ptkp_status: string | null;
    new_ptkp_status: string;
    old_kategori_ter: string | null;
    new_kategori_ter: string;
    source: string;
    changed_by: string;
    changed_at?: Date | string;
    remarks?: string;
}

// ============================================================
// Service
// ============================================================

export class PtkpTaxService {
    private static instance: PtkpTaxService;

    private constructor() { }

    public static getInstance(): PtkpTaxService {
        if (!PtkpTaxService.instance) {
            PtkpTaxService.instance = new PtkpTaxService();
        }
        return PtkpTaxService.instance;
    }

    /**
     * Get the extend database (for history_ptkp_pajak table)
     */
    private getExtendDb(): Database {
        return Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    /**
     * Get the origin database (for reading HR_PAYROLL / RiceRation)
     */
    private getOriginDb(): Database {
        return Database.getInstance();
    }

    /**
     * Ensure the history_ptkp_pajak table exists in extend_db_ptrj
     * NOTE: This method uses sys.objects which is blocked by the DB gateway.
     * The table must be pre-created via direct SQL connection.
     * This method is kept for reference only.
     */
    private async ensureTable(): Promise<void> {
        // Table is pre-created via direct SQL setup script.
        // The DB gateway blocks sys.objects queries, so we cannot auto-create.
        console.log('[PtkpTaxService] Table history_ptkp_pajak assumed to exist (pre-created)');
    }

    /**
     * Ensure the changelog table exists. Uses IF NOT EXISTS so safe to call repeatedly.
     */
    public async ensureChangelogTable(): Promise<void> {
        const db = this.getExtendDb();
        try {
            await db.query(`
                IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'history_ptkp_pajak_changelog' AND TABLE_SCHEMA = 'dbo')
                CREATE TABLE dbo.history_ptkp_pajak_changelog (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    period_year INT NOT NULL,
                    emp_code VARCHAR(50) NOT NULL,
                    old_ptkp_status VARCHAR(10) NULL,
                    new_ptkp_status VARCHAR(10) NOT NULL,
                    old_kategori_ter VARCHAR(10) NULL,
                    new_kategori_ter VARCHAR(10) NOT NULL,
                    source VARCHAR(50) NOT NULL,
                    changed_by VARCHAR(100) NOT NULL DEFAULT 'system',
                    changed_at DATETIME NOT NULL DEFAULT GETDATE(),
                    remarks NVARCHAR(255) NULL
                )
            `);
            console.log('[PtkpTaxService] Changelog table ensured');
        } catch (e: any) {
            console.error('[PtkpTaxService] Error ensuring changelog table:', e.message);
        }
    }

    /**
     * Insert a changelog record for a PTKP change
     */
    private async insertChangelog(
        year: number, empCode: string,
        oldStatus: string | null, newStatus: string,
        source: string, changedBy: string,
        remarks?: string
    ): Promise<void> {
        const db = this.getExtendDb();
        const oldTer = oldStatus ? mapPTKPToTER(oldStatus) : null;
        const newTer = mapPTKPToTER(newStatus);
        try {
            await db.query(`
                INSERT INTO dbo.history_ptkp_pajak_changelog
                (period_year, emp_code, old_ptkp_status, new_ptkp_status, old_kategori_ter, new_kategori_ter, source, changed_by, remarks)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [year, empCode.trim().toUpperCase(), oldStatus, newStatus, oldTer, newTer, source, changedBy, remarks || null]);
        } catch (e: any) {
            console.error(`[PtkpTaxService] Error inserting changelog for ${empCode}:`, e.message);
        }
    }

    /**
     * Get PTKP changelog records, optionally filtered by year and/or emp_code
     */
    public async getPtkpChangelog(year?: number, empCode?: string): Promise<PtkpChangelogRecord[]> {
        const db = this.getExtendDb();
        try {
            await this.ensureChangelogTable();
            let sql = `SELECT * FROM dbo.history_ptkp_pajak_changelog WHERE 1=1`;
            const params: any[] = [];
            if (year) { sql += ` AND period_year = ?`; params.push(year); }
            if (empCode) { sql += ` AND RTRIM(emp_code) = ?`; params.push(empCode.trim().toUpperCase()); }
            sql += ` ORDER BY changed_at DESC`;
            return await db.query<PtkpChangelogRecord>(sql, params);
        } catch (e: any) {
            console.error('[PtkpTaxService] Error fetching changelog:', e.message);
            return [];
        }
    }

    /**
     * Main method: Update PTKP for a given year
     * 
     * Reads all employees from origin DB (HR_PAYROLL), converts beras_rate → PTKP,
     * and saves to history_ptkp_pajak in extend_db_ptrj.
     */
    public async updatePtkpForYear(year: number, createdBy: string = 'system'): Promise<PtkpUpdateResult> {
        const result: PtkpUpdateResult = {
            success: false,
            period_year: year,
            total_employees: 0,
            records_inserted: 0,
            records_updated: 0,
            records_skipped: 0,
            errors: [],
            summary: {
                ptkp_distribution: {},
                ter_distribution: {},
            }
        };

        try {
            // Table is pre-created via direct SQL setup
            await this.ensureChangelogTable();

            // 2. Fetch all employees with their beras_rate from origin DB
            const originDb = this.getOriginDb();
            const employees = await originDb.query<{
                emp_code: string;
                emp_name: string;
                nik: string;
                division_code: string;
                gang_code: string;
                loc_code: string;
                beras_rate: number;
            }>(`
                SELECT DISTINCT
                    RTRIM(e.EmpCode) as emp_code,
                    RTRIM(e.EmpName) as emp_name,
                    RTRIM(e.NewICNo) as nik,
                    RTRIM(g.LocCode) as division_code,
                    RTRIM(g.GangCode) as gang_code,
                    RTRIM(g.LocCode) as loc_code,
                    CASE 
                        WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                        ELSE COALESCE(p.RiceRation, 0)
                    END as beras_rate
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                LEFT JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                LEFT JOIN HR_GANG g ON RTRIM(g.GangCode) = RTRIM(gl.GangCode)
                WHERE e.Status = '1'
                ORDER BY emp_code
            `);

            result.total_employees = employees.length;
            console.log(`[PtkpTaxService] Found ${employees.length} active employees for PTKP update (year: ${year})`);

            if (employees.length === 0) {
                result.errors.push('No active employees found');
                return result;
            }

            // 3. Process each employee
            const extendDb = this.getExtendDb();

            for (const emp of employees) {
                try {
                    const ptkpStatus = mapBerasRateToPTKP(emp.beras_rate);
                    const kategoriTer = mapPTKPToTER(ptkpStatus);

                    // Track distribution
                    result.summary.ptkp_distribution[ptkpStatus] = (result.summary.ptkp_distribution[ptkpStatus] || 0) + 1;
                    result.summary.ter_distribution[kategoriTer] = (result.summary.ter_distribution[kategoriTer] || 0) + 1;

                    // Check if record exists
                    const existing = await extendDb.queryOne<{ id: number; ptkp_status: string }>(`
                        SELECT id, ptkp_status FROM dbo.history_ptkp_pajak
                        WHERE period_year = ? AND RTRIM(emp_code) = ?
                    `, [year, emp.emp_code]);

                    if (existing) {
                        // Update only if changed
                        if (existing.ptkp_status !== ptkpStatus) {
                            await extendDb.query(`
                                UPDATE dbo.history_ptkp_pajak SET
                                    emp_name = ?, nik = ?, division_code = ?, gang_code = ?, loc_code = ?,
                                    beras_rate = ?, ptkp_status = ?, kategori_ter = ?,
                                    updated_at = GETDATE(), created_by = ?
                                WHERE id = ?
                            `, [
                                emp.emp_name, emp.nik, emp.division_code, emp.gang_code, emp.loc_code,
                                emp.beras_rate, ptkpStatus, kategoriTer,
                                createdBy, existing.id
                            ]);
                            // Log changelog for seeder update
                            await this.insertChangelog(year, emp.emp_code, existing.ptkp_status, ptkpStatus, 'SEEDER', createdBy);
                            result.records_updated++;
                        } else {
                            result.records_skipped++;
                        }
                    } else {
                        // Insert new
                        await extendDb.query(`
                            INSERT INTO dbo.history_ptkp_pajak (
                                period_year, emp_code, emp_name, nik, division_code, gang_code, loc_code,
                                beras_rate, ptkp_status, kategori_ter, source, created_by
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HR_PAYROLL.RiceRation', ?)
                        `, [
                            year, emp.emp_code, emp.emp_name, emp.nik,
                            emp.division_code, emp.gang_code, emp.loc_code,
                            emp.beras_rate, ptkpStatus, kategoriTer, createdBy
                        ]);
                        // Log changelog for seeder insert
                        await this.insertChangelog(year, emp.emp_code, null, ptkpStatus, 'SEEDER', createdBy, 'Initial seeder insert');
                        result.records_inserted++;
                    }
                } catch (err: any) {
                    result.errors.push(`Error for ${emp.emp_code}: ${err.message}`);
                }
            }

            // 4. Also update ptkp_pajak in history_hr_employee for this year
            try {
                await this.syncPtkpToHistoryHrEmployee(year);
                console.log(`[PtkpTaxService] Synced PTKP to history_hr_employee for year ${year}`);
            } catch (err: any) {
                result.errors.push(`Error syncing to history_hr_employee: ${err.message}`);
            }

            result.success = result.errors.length === 0;
            console.log(`[PtkpTaxService] PTKP update complete for year ${year}: ${result.records_inserted} inserted, ${result.records_updated} updated, ${result.records_skipped} skipped`);

        } catch (error: any) {
            result.errors.push(`Fatal error: ${error.message}`);
            console.error('[PtkpTaxService] Fatal error:', error);
        }

        return result;
    }

    /**
     * Sync PTKP status from history_ptkp_pajak back to history_hr_employee
     * Updates ptkp_pajak field for all records in the given year
     */
    private async syncPtkpToHistoryHrEmployee(year: number): Promise<void> {
        const extendDb = this.getExtendDb();

        await extendDb.query(`
            UPDATE h SET
                h.ptkp_pajak = p.ptkp_status
            FROM dbo.history_hr_employee h
            INNER JOIN dbo.history_ptkp_pajak p 
                ON RTRIM(h.emp_code) = RTRIM(p.emp_code) 
                AND p.period_year = ?
            WHERE h.period_year = ?
        `, [year, year]);
    }

    /**
     * Update PTKP status for a specific employee and year
     * Will insert if not exists, or update if exists
     */
    public async updatePtkpStatus(year: number, empCode: string, ptkpStatus: string, updatedBy: string = 'system'): Promise<boolean> {
        const extendDb = this.getExtendDb();
        const originDb = this.getOriginDb();
        const cleanEmpCode = empCode.trim().toUpperCase();
        const kategoriTer = mapPTKPToTER(ptkpStatus);

        try {
            await this.ensureChangelogTable();
            // Check if record exists
            const existing = await extendDb.queryOne<{ id: number; ptkp_status: string }>(`
                SELECT id, ptkp_status FROM dbo.history_ptkp_pajak
                WHERE period_year = ? AND RTRIM(emp_code) = ?
            `, [year, cleanEmpCode]);

            if (existing) {
                // Update only if changed
                if (existing.ptkp_status !== ptkpStatus) {
                    // Log changelog for portal edit
                    await this.insertChangelog(year, cleanEmpCode, existing.ptkp_status, ptkpStatus, 'MANUAL_PORTAL', updatedBy, 'Edited via Daftar Upah portal');
                    await extendDb.query(`
                        UPDATE dbo.history_ptkp_pajak SET
                            ptkp_status = ?, kategori_ter = ?,
                            updated_at = GETDATE(), created_by = ?
                        WHERE id = ?
                    `, [ptkpStatus, kategoriTer, updatedBy, existing.id]);
                }
            } else {
                // Get basic info from origin db to insert new record
                const empInfo = await originDb.queryOne<{ emp_name: string, nik: string, division_code: string, gang_code: string, loc_code: string, beras_rate: number }>(`
                    SELECT
                        RTRIM(e.EmpName) as emp_name,
                        RTRIM(e.NewICNo) as nik,
                        RTRIM(g.LocCode) as division_code,
                        RTRIM(g.GangCode) as gang_code,
                        RTRIM(g.LocCode) as loc_code,
                        CASE 
                            WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                            ELSE COALESCE(p.RiceRation, 0)
                        END as beras_rate
                    FROM HR_EMPLOYEE e
                    LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_GANG g ON RTRIM(g.GangCode) = RTRIM(gl.GangCode)
                    WHERE RTRIM(e.EmpCode) = ?
                `, [cleanEmpCode]);

                await extendDb.query(`
                    INSERT INTO dbo.history_ptkp_pajak (
                        period_year, emp_code, emp_name, nik, division_code, gang_code, loc_code,
                        beras_rate, ptkp_status, kategori_ter, source, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_PORTAL', ?)
                `, [
                    year, cleanEmpCode, empInfo?.emp_name || '', empInfo?.nik || '',
                    empInfo?.division_code || '', empInfo?.gang_code || '', empInfo?.loc_code || '',
                    empInfo?.beras_rate || 0, ptkpStatus, kategoriTer, updatedBy
                ]);
            }

            // Sync specifically for this employee
            await extendDb.query(`
                UPDATE dbo.history_hr_employee SET
                    ptkp_pajak = ?
                WHERE period_year = ? AND RTRIM(emp_code) = ?
            `, [ptkpStatus, year, cleanEmpCode]);

            return true;
        } catch (error: any) {
            console.error(`[PtkpTaxService] Error updating PTKP for ${cleanEmpCode} year ${year}:`, error.message);
            throw error;
        }
    }

    /**
     * Get all PTKP records for a specific year
     */
    public async getPtkpByYear(year: number): Promise<PtkpRecord[]> {
        const db = this.getExtendDb();

        try {
            // Ensure table exists first
            await this.ensureTable();

            return await db.query<PtkpRecord>(`
                SELECT * FROM dbo.history_ptkp_pajak
                WHERE period_year = ?
                ORDER BY emp_code
            `, [year]);
        } catch (error: any) {
            console.error(`[PtkpTaxService] Error fetching PTKP for year ${year}:`, error.message);
            return [];
        }
    }

    /**
     * Get PTKP history for a specific employee (across all years)
     */
    public async getPtkpByEmployee(empCode: string): Promise<PtkpRecord[]> {
        const db = this.getExtendDb();

        try {
            // Ensure table exists first
            await this.ensureTable();

            return await db.query<PtkpRecord>(`
                SELECT * FROM dbo.history_ptkp_pajak
                WHERE RTRIM(emp_code) = ?
                ORDER BY period_year DESC
            `, [empCode]);
        } catch (error: any) {
            console.error(`[PtkpTaxService] Error fetching PTKP for employee ${empCode}:`, error.message);
            return [];
        }
    }

    /**
     * Get summary/preview of what will change if PTKP is updated
     * Useful for showing a preview before confirming the update
     */
    public async previewPtkpUpdate(year: number): Promise<{
        total_employees: number;
        existing_records: number;
        preview: Array<{
            emp_code: string;
            emp_name: string;
            beras_rate: number;
            current_ptkp: string | null;
            new_ptkp: string;
            will_change: boolean;
        }>;
        distribution: Record<string, number>;
    }> {
        try {
            const originDb = this.getOriginDb();
            const extendDb = this.getExtendDb();

            const employees = await originDb.query<{
                emp_code: string;
                emp_name: string;
                beras_rate: number;
            }>(`
                SELECT DISTINCT
                    RTRIM(e.EmpCode) as emp_code,
                    RTRIM(e.EmpName) as emp_name,
                    CASE 
                        WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                        ELSE COALESCE(p.RiceRation, 0)
                    END as beras_rate
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                WHERE e.Status = '1'
                ORDER BY emp_code
            `);

            // Get existing PTKP records
            const existingRecords = await extendDb.query<{ emp_code: string; ptkp_status: string }>(`
                SELECT RTRIM(emp_code) as emp_code, ptkp_status
                FROM dbo.history_ptkp_pajak
                WHERE period_year = ?
            `, [year]);

            const existingMap = new Map<string, string>();
            for (const r of existingRecords) {
                existingMap.set(r.emp_code, r.ptkp_status);
            }

            const distribution: Record<string, number> = {};
            const preview = employees.map(emp => {
                const newPtkp = mapBerasRateToPTKP(emp.beras_rate);
                const currentPtkp = existingMap.get(emp.emp_code) || null;

                distribution[newPtkp] = (distribution[newPtkp] || 0) + 1;

                return {
                    emp_code: emp.emp_code,
                    emp_name: emp.emp_name,
                    beras_rate: emp.beras_rate,
                    current_ptkp: currentPtkp,
                    new_ptkp: newPtkp,
                    will_change: currentPtkp !== newPtkp
                };
            });

            return {
                total_employees: employees.length,
                existing_records: existingRecords.length,
                preview,
                distribution
            };
        } catch (error: any) {
            console.error('[PtkpTaxService] Error previewing PTKP update:', error.message);
            return {
                total_employees: 0,
                existing_records: 0,
                preview: [],
                distribution: {}
            };
        }
    }
}

export const ptkpTaxService = PtkpTaxService.getInstance();
