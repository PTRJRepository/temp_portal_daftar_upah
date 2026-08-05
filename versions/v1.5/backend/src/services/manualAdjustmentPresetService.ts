import { Config } from "../config";
import { Database } from "../db/client";
import { normalizeManualAdjustmentPresetName } from "../utils/manualAdjustmentRemarkParser";

export interface ManualAdjustmentPreset {
    id?: number;
    adjustment_type: string;
    adjustment_name: string;
    ad_code: string;
    task_code?: string | null;
    base_task_code?: string | null;
    task_desc?: string | null;
    division_code?: string | null;
    remarks_template?: string | null;
    is_active?: boolean | number;
    created_by?: string | null;
    created_at?: string | Date;
    updated_by?: string | null;
    updated_at?: string | Date;
}

export interface ManualAdjustmentPresetListInput {
    adjustmentType?: string;
    search?: string;
    divisionCode?: string;
    includeInactive?: boolean;
}

function normalizeText(value: unknown): string {
    return String(value || "").trim();
}

function normalizeCode(value: unknown): string {
    return normalizeText(value).toUpperCase();
}

export class ManualAdjustmentPresetService {
    private static instance: ManualAdjustmentPresetService;
    private db: Database;

    public constructor(db?: Database) {
        this.db = db || Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    public static getInstance(): ManualAdjustmentPresetService {
        if (!ManualAdjustmentPresetService.instance) {
            ManualAdjustmentPresetService.instance = new ManualAdjustmentPresetService();
        }
        return ManualAdjustmentPresetService.instance;
    }

    public async ensureTable(): Promise<void> {
        await this.db.query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'payroll_manual_adjustment_presets')
            BEGIN
                CREATE TABLE dbo.payroll_manual_adjustment_presets (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    adjustment_type NVARCHAR(50) NOT NULL,
                    adjustment_name NVARCHAR(255) NOT NULL,
                    ad_code NVARCHAR(50) NOT NULL,
                    task_code NVARCHAR(50) NULL,
                    base_task_code NVARCHAR(50) NULL,
                    task_desc NVARCHAR(255) NULL,
                    division_code NVARCHAR(50) NULL,
                    remarks_template NVARCHAR(500) NULL,
                    is_active BIT NOT NULL DEFAULT 1,
                    created_by NVARCHAR(100) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    updated_by NVARCHAR(100) NULL,
                    updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
                );

                CREATE INDEX IX_payroll_manual_adjustment_presets_lookup
                    ON dbo.payroll_manual_adjustment_presets (is_active, adjustment_type, adjustment_name, division_code);
            END

            -- Migrate: add remarks_template if table exists from before this column
            IF NOT EXISTS (
                SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'payroll_manual_adjustment_presets' AND COLUMN_NAME = 'remarks_template'
            )
            BEGIN
                ALTER TABLE dbo.payroll_manual_adjustment_presets ADD remarks_template NVARCHAR(500) NULL;
            END
        `, []);
    }

    public async listPresets(input: ManualAdjustmentPresetListInput = {}): Promise<ManualAdjustmentPreset[]> {
        await this.ensureTable();

        let query = `
            SELECT
                id,
                adjustment_type,
                adjustment_name,
                ad_code,
                task_code,
                base_task_code,
                task_desc,
                division_code,
                remarks_template,
                is_active,
                created_by,
                created_at,
                updated_by,
                updated_at
            FROM dbo.payroll_manual_adjustment_presets
            WHERE 1 = 1
        `;
        const params: any[] = [];

        if (!input.includeInactive) {
            query += ` AND is_active = 1`;
        }

        if (input.adjustmentType) {
            query += ` AND adjustment_type = ?`;
            params.push(normalizeCode(input.adjustmentType));
        }

        if (input.search) {
            query += ` AND adjustment_name LIKE ?`;
            params.push(`%${normalizeManualAdjustmentPresetName(input.search)}%`);
        }

        if (input.divisionCode && input.divisionCode !== "ALL") {
            query += ` AND (division_code = ? OR division_code IS NULL OR division_code = '')`;
            params.push(normalizeCode(input.divisionCode));
        }

        query += ` ORDER BY adjustment_type, adjustment_name, division_code`;

        return await this.db.query<ManualAdjustmentPreset>(query, params);
    }

    public async createPreset(input: ManualAdjustmentPreset, user?: string): Promise<number> {
        await this.ensureTable();

        const adjustmentType = normalizeCode(input.adjustment_type);
        const adjustmentName = normalizeManualAdjustmentPresetName(input.adjustment_name);
        const adCode = normalizeCode(input.ad_code);

        if (!adjustmentType) throw new Error("adjustment_type wajib diisi");
        if (!adjustmentName) throw new Error("adjustment_name wajib diisi");
        if (!adCode) throw new Error("ad_code wajib diisi");

        const result = await this.db.query<{ id: number }>(`
            INSERT INTO dbo.payroll_manual_adjustment_presets (
                adjustment_type,
                adjustment_name,
                ad_code,
                task_code,
                base_task_code,
                task_desc,
                division_code,
                remarks_template,
                is_active,
                created_by,
                updated_by
            ) OUTPUT INSERTED.id VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `, [
            adjustmentType,
            adjustmentName,
            adCode,
            normalizeCode(input.task_code) || null,
            normalizeCode(input.base_task_code) || adCode,
            normalizeText(input.task_desc) || null,
            normalizeCode(input.division_code) || null,
            normalizeText(input.remarks_template) || null,
            user || "system",
            user || "system"
        ]);

        return result[0]?.id || 0;
    }

    public async upsertPreset(input: ManualAdjustmentPreset, user?: string): Promise<number> {
        await this.ensureTable();

        const adjustmentType = normalizeCode(input.adjustment_type);
        const adjustmentName = normalizeManualAdjustmentPresetName(input.adjustment_name);
        const adCode = normalizeCode(input.ad_code);
        const divisionCode = normalizeCode(input.division_code) || null;

        if (!adjustmentType) throw new Error("adjustment_type wajib diisi");
        if (!adjustmentName) throw new Error("adjustment_name wajib diisi");
        if (!adCode) throw new Error("ad_code wajib diisi");

        // Check existing by unique key: adjustment_name + ad_code + division_code
        const existing = await this.db.queryOne<{ id: number }>(`
            SELECT id FROM dbo.payroll_manual_adjustment_presets
            WHERE adjustment_type = ?
              AND adjustment_name = ?
              AND ad_code = ?
              AND (division_code = ? OR (division_code IS NULL AND ? IS NULL))
        `, [adjustmentType, adjustmentName, adCode, divisionCode, divisionCode]);

        if (existing) {
            // Update existing (reactivate if inactive)
            await this.db.query(`
                UPDATE dbo.payroll_manual_adjustment_presets
                SET is_active = 1,
                    task_code = ?,
                    base_task_code = ?,
                    task_desc = ?,
                    remarks_template = ?,
                    updated_by = ?,
                    updated_at = SYSDATETIME()
                WHERE id = ?
            `, [
                normalizeCode(input.task_code) || null,
                normalizeCode(input.base_task_code) || adCode,
                normalizeText(input.task_desc) || null,
                normalizeText(input.remarks_template) || null,
                user || "system",
                existing.id
            ]);
            return existing.id;
        }

        // Insert new
        return await this.createPreset(input, user);
    }

    public async deletePreset(id: number, user?: string): Promise<void> {
        await this.ensureTable();
        await this.db.query(`
            UPDATE dbo.payroll_manual_adjustment_presets
            SET is_active = 0, updated_by = ?, updated_at = SYSDATETIME()
            WHERE id = ?
        `, [user || "system", id]);
    }
}

export const manualAdjustmentPresetService = ManualAdjustmentPresetService.getInstance();
