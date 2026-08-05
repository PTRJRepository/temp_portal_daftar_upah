import { Database } from "../db/client";

export interface EmployeeHrData {
    id?: number;
    emp_code: string;
    nik_ktp: string;
    npwp?: string;
    bank_acc_no?: string;
    bank_code?: string;
    updated_at?: Date | string;
    updated_by?: string;
    version?: number;
}

export interface EmployeeHrDataHistory {
    id?: number;
    emp_code: string;
    field_name: string;
    old_value: string;
    new_value: string;
    changed_at?: Date | string;
    changed_by?: string;
    version: number;
}

/**
 * IMPORTANT: DATA APPEND-ONLY PATTERN RULES (Immutable History)
 *
 * 1. NIK TIDAK BISA di-update - Jika NIK sudah ada, JANGAN update meskipun
 *    nilainya berubah di Plantware atau db_ptrj. Data lama tetap disimpan.
 * 2. Untuk mengambil data terbaru, gunakan version/index terbaru.
 * 3. Semua perubahan dicatat di history table untuk audit trail.
 *
 * Kenapa: Agar history karyawan tetap utuh dan bisa di-tracking dari waktu ke waktu.
 * Jika NIK berubah di db_ptrj, sistem tetap gunakan NIK lama yang sudah tersimpan.
 */
export class EmployeeHrDataService {
    private db: Database;

    constructor() {
        this.db = Database.getExtendedInstance(); // Use extend_db_ptrj
    }

    /**
     * Ensures necessary tables exist in the extended database.
     */
    public async ensureTablesExist(): Promise<void> {
        try {
            await this.db.transaction([
                {
                    sql: `
                        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='employee_hr_data' AND TABLE_SCHEMA='dbo')
                        BEGIN
                            CREATE TABLE dbo.employee_hr_data (
                                id INT IDENTITY(1,1) PRIMARY KEY,
                                emp_code VARCHAR(50) NOT NULL UNIQUE,
                                nik_ktp VARCHAR(50) NULL,
                                npwp VARCHAR(50) NULL,
                                bank_acc_no VARCHAR(50) NULL,
                                bank_code VARCHAR(50) NULL,
                                updated_at DATETIME DEFAULT GETDATE(),
                                updated_by VARCHAR(100) NULL,
                                version INT DEFAULT 1
                            );
                        END
                        ELSE
                        BEGIN
                            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='employee_hr_data' AND COLUMN_NAME='bank_acc_no')
                                ALTER TABLE dbo.employee_hr_data ADD bank_acc_no VARCHAR(50) NULL;
                            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='employee_hr_data' AND COLUMN_NAME='bank_code')
                                ALTER TABLE dbo.employee_hr_data ADD bank_code VARCHAR(50) NULL;
                            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='employee_hr_data' AND COLUMN_NAME='new_nik')
                                ALTER TABLE dbo.employee_hr_data ADD new_nik VARCHAR(50) NULL;
                        END
                    `
                },
                {
                    sql: `
                        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='employee_hr_data_history' AND TABLE_SCHEMA='dbo')
                        CREATE TABLE dbo.employee_hr_data_history (
                            id INT IDENTITY(1,1) PRIMARY KEY,
                            emp_code VARCHAR(50) NOT NULL,
                            field_name VARCHAR(50) NOT NULL,
                            old_value NVARCHAR(255) NULL,
                            new_value NVARCHAR(255) NULL,
                            changed_at DATETIME DEFAULT GETDATE(),
                            changed_by VARCHAR(100) NULL,
                            version INT NOT NULL
                        );
                    `
                }
            ]);
            console.log("[EmployeeHrDataService] Tables ensured successfully");
        } catch (e) {
            console.error("[EmployeeHrDataService] Error ensuring tables:", e);
        }
    }

    /**
     * Get HR data (like NIK override) for a single employee
     */
    public async getHrData(empCode: string): Promise<EmployeeHrData | null> {
        try {
            const rows = await this.db.query<EmployeeHrData>(
                `SELECT * FROM dbo.employee_hr_data WHERE RTRIM(emp_code) = RTRIM(?)`,
                [empCode.trim()]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (e) {
            console.error(`[EmployeeHrDataService] Error getting HR data for ${empCode}:`, e);
            return null;
        }
    }

    /**
     * Bulk fetch HR data for multiple employees
     */
    public async getHrDataBulk(empCodes: string[]): Promise<Map<string, EmployeeHrData>> {
        if (!empCodes || empCodes.length === 0) return new Map();

        try {
            const cleanCodes = empCodes.map(c => c.trim()).filter(c => c.length > 0);
            if (cleanCodes.length === 0) return new Map();

            const map = new Map<string, EmployeeHrData>();
            const CHUNK_SIZE = 500;
            for (let i = 0; i < cleanCodes.length; i += CHUNK_SIZE) {
                const chunk = cleanCodes.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map(() => '?').join(',');

                const rows = await this.db.query<EmployeeHrData>(
                    `SELECT * FROM dbo.employee_hr_data WHERE RTRIM(emp_code) IN (${placeholders})`,
                    chunk
                );

                for (const row of rows) {
                    map.set(row.emp_code.trim().toUpperCase(), row);
                }
            }
            return map;

        } catch (e) {
            console.error(`[EmployeeHrDataService] Error getting bulk HR data:`, e);
            return new Map();
        }
    }

    /**
     * Update HR Data field (e.g. bank_acc_no, npwp) and insert history record.
     *
     * IMPORTANT: DATA APPEND-ONLY PATTERN
     * - NIK (nik_ktp) TIDAK BISA di-update. Ini adalah immutable identifier.
     *   Jika NIK berubah di Plantware/db_ptrj, simpan NIK baru di kolom `new_nik`.
     *   Kolom `nik_ktp` yang lama TIDAK AKAN PERNAH berubah.
     */
    public async updateHrDataField(
        empCode: string,
        fieldName: string,
        newValue: string,
        username: string = "system"
    ): Promise<boolean> {
        try {
            const cleanEmpCode = empCode.trim().toUpperCase();

            if (fieldName === "nik_ktp" || fieldName === "nik") {
                throw new Error(
                    `NIK (nik_ktp) tidak bisa di-edit. ` +
                    `NIK adalah immutable identifier. ` +
                    `Jika NIK berubah di source (Plantware/db_ptrj), ` +
                    `gunakan kolom 'new_nik' untuk tracking perubahan.`
                );
            }

            const existing = await this.getHrData(cleanEmpCode);
            let oldValue = "";
            let newVersion = 1;

            if (existing) {
                oldValue = (existing as any)[fieldName] || "";
                newVersion = (existing.version || 1) + 1;
            }

            if (oldValue === newValue) {
                return true;
            }

            if (existing) {
                const updateSql = `
                    UPDATE dbo.employee_hr_data
                    SET [${fieldName}] = ?,
                        updated_at = GETDATE(),
                        updated_by = ?,
                        version = ?
                    WHERE RTRIM(emp_code) = RTRIM(?)
                `;

                const historySql = `
                    INSERT INTO dbo.employee_hr_data_history
                    (emp_code, field_name, old_value, new_value, changed_by, version)
                    VALUES (?, ?, ?, ?, ?, ?)
                `;

                return await this.db.transaction([
                    { sql: updateSql, params: [newValue, username, newVersion, cleanEmpCode] },
                    { sql: historySql, params: [cleanEmpCode, fieldName, oldValue, newValue, username, newVersion] }
                ]);
            } else {
                const fields = ["emp_code", "updated_by", "version", fieldName];
                const values = [cleanEmpCode, username, 1, newValue];
                const placeholders = values.map(() => "?").join(", ");

                const insertSql = `
                    INSERT INTO dbo.employee_hr_data (${fields.join(", ")})
                    VALUES (${placeholders})
                `;

                const historySql = `
                    INSERT INTO dbo.employee_hr_data_history
                    (emp_code, field_name, old_value, new_value, changed_by, version)
                    VALUES (?, ?, ?, ?, ?, 1)
                `;

                return await this.db.transaction([
                    { sql: insertSql, params: values },
                    { sql: historySql, params: [cleanEmpCode, fieldName, oldValue, newValue, username] }
                ]);
            }

        } catch (e) {
            console.error(`[EmployeeHrDataService] Error updating field ${fieldName} for ${empCode}:`, e);
            throw e;
        }
    }

    /**
     * Get history for a specific employee
     */
    public async getHrDataHistory(empCode: string): Promise<EmployeeHrDataHistory[]> {
        try {
            const rows = await this.db.query<EmployeeHrDataHistory>(
                `SELECT * FROM dbo.employee_hr_data_history
                 WHERE RTRIM(emp_code) = RTRIM(?)
                 ORDER BY changed_at DESC`,
                [empCode.trim()]
            );
            return rows;
        } catch (e) {
            console.error(`[EmployeeHrDataService] Error getting history for ${empCode}:`, e);
            return [];
        }
    }

    /**
     * Rollback the latest HR Data field change.
     * If there's only 1 version, it deletes the override entirely (reverting to Plantware).
     * If there are multiple versions, it deletes the latest history and reverts employee_hr_data to the previous value.
     */
    public async rollbackHrDataField(empCode: string, fieldName: string): Promise<boolean> {
        const cleanEmpCode = empCode.trim().toUpperCase();
        try {
            const historyRows = await this.db.query<EmployeeHrDataHistory>(
                `SELECT * FROM dbo.employee_hr_data_history
                 WHERE RTRIM(emp_code) = RTRIM(?) AND field_name = ?
                 ORDER BY version DESC`,
                [cleanEmpCode, fieldName]
            );

            if (historyRows.length === 0) {
                return false;
            }

            const latestHistory = historyRows[0];

            if (historyRows.length === 1) {
                await this.db.transaction([
                    { sql: `DELETE FROM dbo.employee_hr_data_history WHERE id = ?`, params: [latestHistory.id] },
                    { sql: `DELETE FROM dbo.employee_hr_data WHERE RTRIM(emp_code) = RTRIM(?)`, params: [cleanEmpCode] }
                ]);
                return true;
            }

            const previousHistory = historyRows[1];
            const revertedValue = previousHistory.new_value;
            const revertedVersion = previousHistory.version;

            const updateSql = `
                UPDATE dbo.employee_hr_data
                SET [${fieldName}] = ?,
                    version = ?
                WHERE RTRIM(emp_code) = RTRIM(?)
            `;

            await this.db.transaction([
                { sql: `DELETE FROM dbo.employee_hr_data_history WHERE id = ?`, params: [latestHistory.id] },
                { sql: updateSql, params: [revertedValue, revertedVersion, cleanEmpCode] }
            ]);

            return true;

        } catch (e) {
            console.error(`[EmployeeHrDataService] Error rolling back field ${fieldName} for ${empCode}:`, e);
            throw e;
        }
    }
}

export const employeeHrDataService = new EmployeeHrDataService();
