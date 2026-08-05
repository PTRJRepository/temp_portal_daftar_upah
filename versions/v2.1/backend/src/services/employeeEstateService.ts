
import { Database } from "../db/client";

/**
 * IMPORTANT: DATA APPEND-ONLY PATTERN RULES (Immutable History)
 *
 * PRINSIP: Sistem TIDAK menimpa atau mengedit data existing. Selalu tambahkan record baru.
 *
 * PENERAPAN:
 * 1. NIK (empcode) TIDAK BISA di-update - Jika empcode sudah ada di database,
 *    JANGAN update meskipun nilainya berubah di Plantware/db_ptrj.
 *    Data lama tetap disimpan untuk histori.
 * 2. Hanya INSERT data baru jika empcode belum ada.
 * 3. Untuk tracking perubahan, pertimbangkan menambahkan version_index atau history table.
 *
 * Kenapa penting:
 * - NIK adalah identifier utama karyawan - tidak boleh berubah
 * - History data karyawan tetap utuh
 * - Audit trail lengkap untuk semua perubahan data
 */

export interface EmployeeJobData {
    empcode: string;
    employee_name: string;
    gang: string;
    divisi_id: string;
    jabatan: string;
}

export class EmployeeEstateService {

    /**
     * Ensure the table exists
     */
    static async initTable(): Promise<void> {
        const db = Database.getExtendedInstance();
        try {
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'employee_estate')
                BEGIN
                    CREATE TABLE employee_estate (
                        empcode VARCHAR(50) PRIMARY KEY,
                        employee_name VARCHAR(255),
                        gang VARCHAR(50),
                        divisi_id VARCHAR(50),
                        jabatan VARCHAR(100),
                        updated_at DATETIME DEFAULT GETDATE()
                    )
                END

                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'history_employee_jabatan_changelog')
                BEGIN
                    CREATE TABLE history_employee_jabatan_changelog (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        empcode VARCHAR(50) NOT NULL,
                        jabatan_lama VARCHAR(100) NULL,
                        jabatan_baru VARCHAR(100) NOT NULL,
                        changed_at DATETIME DEFAULT GETDATE(),
                        changed_by VARCHAR(100) NULL
                    )
                END
            `);
        } catch (error) {
            console.error('[EmployeeEstateService] Failed to init table:', error);
        }
    }

    /**
     * Save or update employee job titles in bulk
     */
    static async saveEmployeeJobs(jobs: EmployeeJobData[]): Promise<{ success: boolean; count: number }> {
        if (!jobs || jobs.length === 0) return { success: true, count: 0 };

        await this.initTable();
        const db = Database.getExtendedInstance();

        // Use a transaction of upsert statements
        // Since SQL Gateway handles batching, we can construct a robust MERGE or simple upsert loop
        // Given SQL Server, MERGE is appropriate.

        const queries = jobs.map(job => {
            // Always trim all fields to handle spaces in identifiers
            const empcode = (job.empcode || '').trim();
            const jabatan = (job.jabatan || 'karyawan panen').trim();
            const employee_name = (job.employee_name || '').trim();
            const gang = (job.gang || '').trim();
            const divisi_id = (job.divisi_id || '').trim();

            return {
                sql: `
                    MERGE INTO employee_estate AS target
                    USING (SELECT ? AS empcode) AS source
                    ON (RTRIM(target.empcode) = RTRIM(source.empcode))
                    WHEN MATCHED THEN
                        UPDATE SET
                            jabatan = ?,
                            employee_name = ?,
                            gang = ?,
                            divisi_id = ?,
                            updated_at = GETDATE()
                    WHEN NOT MATCHED THEN
                        INSERT (empcode, employee_name, gang, divisi_id, jabatan, updated_at)
                        VALUES (?, ?, ?, ?, ?, GETDATE());
                `,
                params: [
                    empcode,
                    jabatan,
                    employee_name,
                    gang,
                    divisi_id,
                    empcode,
                    employee_name,
                    gang,
                    divisi_id,
                    jabatan
                ]
            };
        });

        // Execute in batch/transaction
        const result = await db.transaction(queries);
        return { success: result, count: jobs.length };
    }

    /**
     * Update a single employee's job title
     */
    static async updateJobTitle(rawEmpCode: string, jobTitle: string, changedBy: string = 'system'): Promise<boolean> {
        await this.initTable();
        const db = Database.getExtendedInstance();

        // Always trim to handle spaces in input
        const empCode = (rawEmpCode || '').trim();
        const jabatan = (jobTitle || '').trim();

        try {
            // First get the old job title
            const oldRecord = await db.query<{ jabatan: string }>(
                "SELECT jabatan FROM employee_estate WHERE RTRIM(empcode) = ?",
                [empCode]
            );
            const jabatanLama = oldRecord.length > 0 ? (oldRecord[0].jabatan || '').trim() : null;

            // Save to history changelog if it actually changed or is new
            if (jabatanLama !== jabatan) {
                await db.query(`
                    INSERT INTO history_employee_jabatan_changelog
                    (empcode, jabatan_lama, jabatan_baru, changed_by)
                    VALUES (?, ?, ?, ?)
                `, [empCode, jabatanLama, jabatan, changedBy]);
            }

            await db.query(`
                MERGE INTO employee_estate AS target
                USING (SELECT ? AS empcode, ? AS jabatan) AS source
                ON (RTRIM(target.empcode) = RTRIM(source.empcode))
                WHEN MATCHED THEN
                    UPDATE SET jabatan = source.jabatan, updated_at = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (empcode, jabatan, updated_at)
                    VALUES (source.empcode, source.jabatan, GETDATE());
            `, [empCode, jabatan]);
            return true;
        } catch (e) {
            console.error(`[EmployeeEstateService] Update failed for '${rawEmpCode}':`, e);
            throw e;
        }
    }

    /**
     * Get all employee job titles mapping
     */
    static async getEmployeeJobs(): Promise<Record<string, string>> {
        await this.initTable();
        const db = Database.getExtendedInstance();

        // Return blank object if table query fails (soft fail)
        try {
            const rows = await db.query<{ empcode: string, jabatan: string }>(
                "SELECT empcode, jabatan FROM employee_estate"
            );

            const map: Record<string, string> = {};
            rows.forEach(r => {
                // Always trim empcode and jabatan to handle spaces in data
                map[(r.empcode || '').trim()] = (r.jabatan || '').trim();
            });
            return map;
        } catch (e) {
            console.warn('[EmployeeEstateService] Could not fetch jobs (first run?):', e);
            return {};
        }
    }

    /**
     * Get employee job titles with DUAL MAP: by empcode AND by NIK.
     *
     * MASALAH: Karyawan yang pindah gang mendapat emp_code baru,
     * tapi jabatan disimpan dengan emp_code LAMA di employee_estate.
     * Lookup via emp_code baru GAGAL → jabatan kosong.
     *
     * SOLUSI: Join employee_estate dengan HR_EMPLOYEE untuk mendapat NIK (NewICNo),
     * lalu return dua map:
     *   - empcodeMap: { empcode → jabatan }  (existing, untuk backward compat)
     *   - nikMap:     { nik → jabatan }       (NEW, untuk karyawan yang ganti emp_code)
     *
     * Lookup di dataExtractorService harus cek empcodeMap dulu, fallback ke nikMap.
     */
    /**
     * Get employee job titles with DUAL MAP: by empcode AND by NIK.
     * 
     * @param filterEmpCodes Optional array of emp_codes to filter the lookup.
     *                       Significantly reduces DB queries and processing time.
     */
    static async getEmployeeJobsWithNik(filterEmpCodes?: string[]): Promise<{
        empcodeMap: Record<string, string>;
        nikMap: Record<string, string>;
    }> {
        await this.initTable();
        const extDb = Database.getExtendedInstance();
        const mainDb = Database.getInstance();

        const empcodeMap: Record<string, string> = {};
        const nikMap: Record<string, string> = {};

        try {
            // Step 1: Get all jabatan from employee_estate (extend DB)
            let estateRows: { empcode: string; jabatan: string }[] = [];
            
            if (filterEmpCodes && filterEmpCodes.length > 0) {
                // If filter specified, only query those specific codes
                const CHUNK_SIZE = 500;
                for (let i = 0; i < filterEmpCodes.length; i += CHUNK_SIZE) {
                    const chunk = filterEmpCodes.slice(i, i + CHUNK_SIZE);
                    const placeholders = chunk.map(() => '?').join(',');
                    const chunkRows = await extDb.query<{ empcode: string; jabatan: string }>(
                        `SELECT empcode, jabatan FROM employee_estate WHERE jabatan IS NOT NULL AND jabatan <> '' AND RTRIM(empcode) IN (${placeholders})`,
                        chunk
                    );
                    estateRows.push(...chunkRows);
                }
            } else {
                // Return all jabatan
                estateRows = await extDb.query<{ empcode: string; jabatan: string }>(
                    "SELECT empcode, jabatan FROM employee_estate WHERE jabatan IS NOT NULL AND jabatan <> ''"
                );
            }

            if (estateRows.length === 0) {
                return { empcodeMap, nikMap };
            }

            // Build empcodeMap first.
            // IMPORTANT: Some old records in employee_estate have empcode stored as a NIK
            // (16-digit numeric e.g. "1902052002200001") instead of a Plantware EmpCode (e.g. "A001").
            // These NIK-format empcodes won't match HR_EMPLOYEE.EmpCode, so we detect them
            // and put them DIRECTLY into nikMap — no HR_EMPLOYEE join needed.
            const empCodes: string[] = [];         // Normal Plantware emp_codes (e.g. "A001", "C0744")
            const nikLikeEmpcodes: string[] = [];  // empcode values that look like NIKs (16-digit)

            const NIK_REGEX = /^\d{16}$/; // NIK is exactly 16 digits

            for (const r of estateRows) {
                const ec = (r.empcode || '').trim();
                const jb = (r.jabatan || '').trim();
                if (!ec || !jb) continue;

                empcodeMap[ec] = jb;

                if (NIK_REGEX.test(ec)) {
                    // empcode IS a NIK — map directly to nikMap without HR_EMPLOYEE join
                    const ecUpper = ec.toUpperCase();
                    if (!nikMap[ecUpper]) {
                        nikMap[ecUpper] = jb;
                    }
                    nikLikeEmpcodes.push(ec);
                } else {
                    // Normal Plantware emp_code — need HR_EMPLOYEE join to resolve NIK
                    empCodes.push(ec);
                }
            }

            // Step 2: Query HR_EMPLOYEE (main DB) to get NIK (NewICNo) for normal Plantware emp_codes
            // Chunked to avoid SQL 2100 param limit
            const CHUNK = 500;
            for (let i = 0; i < empCodes.length; i += CHUNK) {
                const chunk = empCodes.slice(i, i + CHUNK);
                const placeholders = chunk.map(() => '?').join(',');
                try {
                    const hrRows = await mainDb.query<{ EmpCode: string; NewICNo: string }>(
                        `SELECT RTRIM(EmpCode) as EmpCode, RTRIM(ISNULL(NewICNo,'')) as NewICNo
                         FROM HR_EMPLOYEE
                         WHERE RTRIM(EmpCode) IN (${placeholders})`,
                        chunk
                    );
                    for (const hr of hrRows) {
                        const ec = (hr.EmpCode || '').trim().toUpperCase();
                        const nik = (hr.NewICNo || '').trim().toUpperCase();
                        if (nik && empcodeMap[ec] && !nikMap[nik]) {
                            nikMap[nik] = empcodeMap[ec];
                        }
                    }
                } catch (e) {
                    console.warn('[EmployeeEstateService] Could not join with HR_EMPLOYEE for chunk:', e);
                }
            }

            // Step 3: Reverse NIK lookup for NIK-format empcodes.
            // Query HR_EMPLOYEE WHERE NewICNo IN (nikLikeEmpcodes) to find the CURRENT
            // Plantware emp_code for these employees. This lets direct emp_code lookup work too.
            if (nikLikeEmpcodes.length > 0) {
                for (let i = 0; i < nikLikeEmpcodes.length; i += CHUNK) {
                    const chunk = nikLikeEmpcodes.slice(i, i + CHUNK);
                    const placeholders = chunk.map(() => '?').join(',');
                    try {
                        const hrRows = await mainDb.query<{ EmpCode: string; NewICNo: string }>(
                            `SELECT RTRIM(EmpCode) as EmpCode, RTRIM(ISNULL(NewICNo,'')) as NewICNo
                             FROM HR_EMPLOYEE
                             WHERE RTRIM(ISNULL(NewICNo,'')) IN (${placeholders})`,
                            chunk
                        );
                        for (const hr of hrRows) {
                            const ec = (hr.EmpCode || '').trim().toUpperCase();
                            const nik = (hr.NewICNo || '').trim().toUpperCase();
                            // Bridge: current Plantware emp_code → jabatan via NIK
                            if (nik && nikMap[nik] && !empcodeMap[ec]) {
                                empcodeMap[ec] = nikMap[nik];
                            }
                        }
                    } catch (e) {
                        console.warn('[EmployeeEstateService] Could not reverse-lookup NIK empcodes:', e);
                    }
                }
            }

            console.log(`[EmployeeEstateService] Final maps: empcodeMap=${Object.keys(empcodeMap).length}, nikMap=${Object.keys(nikMap).length}`);


            return { empcodeMap, nikMap };
        } catch (e) {
            console.warn('[EmployeeEstateService] getEmployeeJobsWithNik failed:', e);
            return { empcodeMap, nikMap };
        }
    }
}
