import { Database } from "../../db/client";

/**
 * IMPORTANT: DATA APPEND-ONLY PATTERN RULES (Immutable History)
 *
 * PRINSIP: Sistem TIDAK menimpa atau mengedit data existing. Selalu tambahkan record baru.
 */

export interface EmployeeJobData {
    empcode: string;
    employee_name: string;
    gang: string;
    divisi_id: string;
    jabatan: string;
}

export class EmployeeEstateRepository {

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
            console.error('[EmployeeEstateRepository] Failed to init table:', error);
        }
    }

    /**
     * Save or update employee job titles in bulk
     */
    static async saveEmployeeJobs(jobs: EmployeeJobData[]): Promise<{ success: boolean; count: number }> {
        if (!jobs || jobs.length === 0) return { success: true, count: 0 };

        await this.initTable();
        const db = Database.getExtendedInstance();

        const queries = jobs.map(job => {
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
                params: [empcode, jabatan, employee_name, gang, divisi_id, empcode, employee_name, gang, divisi_id, jabatan]
            };
        });

        const result = await db.transaction(queries);
        return { success: result, count: jobs.length };
    }

    /**
     * Update a single employee's job title
     */
    static async updateJobTitle(rawEmpCode: string, jobTitle: string, changedBy: string = 'system'): Promise<boolean> {
        await this.initTable();
        const db = Database.getExtendedInstance();
        const empCode = (rawEmpCode || '').trim();
        const jabatan = (jobTitle || '').trim();

        try {
            const oldRecord = await db.query<{ jabatan: string }>("SELECT jabatan FROM employee_estate WHERE RTRIM(empcode) = ?", [empCode]);
            const jabatanLama = oldRecord.length > 0 ? (oldRecord[0].jabatan || '').trim() : null;

            if (jabatanLama !== jabatan) {
                await db.query(`
                    INSERT INTO history_employee_jabatan_changelog (empcode, jabatan_lama, jabatan_baru, changed_by)
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
            console.error(`[EmployeeEstateRepository] Update failed for '${rawEmpCode}':`, e);
            throw e;
        }
    }

    /**
     * Get employee job titles with DUAL MAP: by empcode AND by NIK.
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
            let estateRows: { empcode: string; jabatan: string }[] = [];
            if (filterEmpCodes && filterEmpCodes.length > 0) {
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
                estateRows = await extDb.query<{ empcode: string; jabatan: string }>("SELECT empcode, jabatan FROM employee_estate WHERE jabatan IS NOT NULL AND jabatan <> ''");
            }

            if (estateRows.length === 0) return { empcodeMap, nikMap };

            const empCodes: string[] = [];
            const nikLikeEmpcodes: string[] = [];
            const NIK_REGEX = /^\d{16}$/;

            for (const r of estateRows) {
                const ec = (r.empcode || '').trim();
                const jb = (r.jabatan || '').trim();
                if (!ec || !jb) continue;
                empcodeMap[ec] = jb;
                if (NIK_REGEX.test(ec)) {
                    nikMap[ec.toUpperCase()] = jb;
                    nikLikeEmpcodes.push(ec);
                } else {
                    empCodes.push(ec);
                }
            }

            const CHUNK = 500;
            for (let i = 0; i < empCodes.length; i += CHUNK) {
                const chunk = empCodes.slice(i, i + CHUNK);
                const hrRows = await mainDb.query<{ EmpCode: string; NewICNo: string }>(
                    `SELECT RTRIM(EmpCode) as EmpCode, RTRIM(ISNULL(NewICNo,'')) as NewICNo FROM HR_EMPLOYEE WHERE RTRIM(EmpCode) IN (${chunk.map(() => '?').join(',')})`,
                    chunk
                );
                for (const hr of hrRows) {
                    const ec = (hr.EmpCode || '').trim().toUpperCase();
                    const nik = (hr.NewICNo || '').trim().toUpperCase();
                    if (nik && empcodeMap[ec] && !nikMap[nik]) nikMap[nik] = empcodeMap[ec];
                }
            }

            if (nikLikeEmpcodes.length > 0) {
                for (let i = 0; i < nikLikeEmpcodes.length; i += CHUNK) {
                    const chunk = nikLikeEmpcodes.slice(i, i + CHUNK);
                    const hrRows = await mainDb.query<{ EmpCode: string; NewICNo: string }>(
                        `SELECT RTRIM(EmpCode) as EmpCode, RTRIM(ISNULL(NewICNo,'')) as NewICNo FROM HR_EMPLOYEE WHERE RTRIM(ISNULL(NewICNo,'')) IN (${chunk.map(() => '?').join(',')})`,
                        chunk
                    );
                    for (const hr of hrRows) {
                        const ec = (hr.EmpCode || '').trim().toUpperCase();
                        const nik = (hr.NewICNo || '').trim().toUpperCase();
                        if (nik && nikMap[nik] && !empcodeMap[ec]) empcodeMap[ec] = nikMap[nik];
                    }
                }
            }

            return { empcodeMap, nikMap };
        } catch (e) {
            console.warn('[EmployeeEstateRepository] getEmployeeJobsWithNik failed:', e);
            return { empcodeMap, nikMap };
        }
    }
}

export const employeeEstateRepository = EmployeeEstateRepository;
