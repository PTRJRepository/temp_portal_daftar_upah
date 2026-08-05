import { Database } from "../../db/client";

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
 */
export class EmployeeHrDataRepository {
    private static instance: EmployeeHrDataRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getExtendedInstance();
    }

    public static getInstance(): EmployeeHrDataRepository {
        if (!EmployeeHrDataRepository.instance) {
            EmployeeHrDataRepository.instance = new EmployeeHrDataRepository();
        }
        return EmployeeHrDataRepository.instance;
    }

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
        } catch (e) {
            console.error("[EmployeeHrDataRepository] Error ensuring tables:", e);
        }
    }

    public async getHrData(empCode: string): Promise<EmployeeHrData | null> {
        try {
            const rows = await this.db.query<EmployeeHrData>(
                `SELECT * FROM dbo.employee_hr_data WHERE RTRIM(emp_code) = RTRIM(?)`,
                [empCode.trim()]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (e) {
            console.error(`[EmployeeHrDataRepository] Error getting HR data for ${empCode}:`, e);
            return null;
        }
    }

    public async getHrDataBulk(empCodes: string[]): Promise<Map<string, EmployeeHrData>> {
        if (!empCodes || empCodes.length === 0) return new Map();
        const map = new Map<string, EmployeeHrData>();
        const CHUNK_SIZE = 500;
        for (let i = 0; i < empCodes.length; i += CHUNK_SIZE) {
            const chunk = empCodes.slice(i, i + CHUNK_SIZE);
            const rows = await this.db.query<EmployeeHrData>(
                `SELECT * FROM dbo.employee_hr_data WHERE RTRIM(emp_code) IN (${chunk.map(() => '?').join(',')})`,
                chunk
            );
            for (const row of rows) map.set(row.emp_code.trim().toUpperCase(), row);
        }
        return map;
    }

    public async updateHrDataField(empCode: string, fieldName: string, newValue: string, username: string = 'system'): Promise<boolean> {
        const cleanEmpCode = empCode.trim().toUpperCase();
        if (fieldName === 'nik_ktp' || fieldName === 'nik') throw new Error(`NIK (nik_ktp) is immutable.`);
        const existing = await this.getHrData(cleanEmpCode);
        let oldValue = existing ? (existing as any)[fieldName] || '' : '';
        let newVersion = existing ? (existing.version || 1) + 1 : 1;
        if (oldValue === newValue) return true;

        if (existing) {
            return await this.db.transaction([
                { sql: `UPDATE dbo.employee_hr_data SET [${fieldName}] = ?, updated_at = GETDATE(), updated_by = ?, version = ? WHERE RTRIM(emp_code) = RTRIM(?)`, params: [newValue, username, newVersion, cleanEmpCode] },
                { sql: `INSERT INTO dbo.employee_hr_data_history (emp_code, field_name, old_value, new_value, changed_by, version) VALUES (?, ?, ?, ?, ?, ?)`, params: [cleanEmpCode, fieldName, oldValue, newValue, username, newVersion] }
            ]);
        } else {
            return await this.db.transaction([
                { sql: `INSERT INTO dbo.employee_hr_data (emp_code, updated_by, version, [${fieldName}]) VALUES (?, ?, ?, ?)`, params: [cleanEmpCode, username, 1, newValue] },
                { sql: `INSERT INTO dbo.employee_hr_data_history (emp_code, field_name, old_value, new_value, changed_by, version) VALUES (?, ?, ?, ?, ?, 1)`, params: [cleanEmpCode, fieldName, oldValue, newValue, username] }
            ]);
        }
    }

    public async getHrDataHistory(empCode: string): Promise<EmployeeHrDataHistory[]> {
        return await this.db.query<EmployeeHrDataHistory>(`SELECT * FROM dbo.employee_hr_data_history WHERE RTRIM(emp_code) = RTRIM(?) ORDER BY changed_at DESC`, [empCode.trim()]);
    }
}

export const employeeHrDataRepository = EmployeeHrDataRepository.getInstance();
