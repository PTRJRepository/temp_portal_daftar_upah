import { Database } from "../db/client";

type QueryableDb = Pick<Database, "query" | "queryOne">;

/**
 * SNAPSHOT TABLES ARE IMMUTABLE.
 * NEVER OVERWRITE EXISTING SNAPSHOT ROWS.
 * NEW SNAPSHOT RUNS MUST CREATE snapshot_version + 1.
 */
export class PayrollSnapshotBatchService {
    private schemaEnsured = false;

    constructor(private readonly db: QueryableDb = Database.getExtendedInstance()) {}

    private async ensureSchema(): Promise<void> {
        if (this.schemaEnsured) return;

        await this.db.query(`
            IF NOT EXISTS (
                SELECT *
                FROM sys.objects
                WHERE object_id = OBJECT_ID(N'[dbo].[payroll_snapshot_batch]')
                  AND type in (N'U')
            )
            BEGIN
                CREATE TABLE [dbo].[payroll_snapshot_batch] (
                    [id] BIGINT IDENTITY(1,1) NOT NULL,
                    [period_month] INT NOT NULL,
                    [period_year] INT NOT NULL,
                    [division_code] NVARCHAR(32) NOT NULL,
                    [gang_code] NVARCHAR(32) NOT NULL,
                    [snapshot_version] INT NOT NULL,
                    [base_source] NVARCHAR(64) NOT NULL,
                    [overlay_profile_cutoff] DATETIME2 NULL,
                    [overlay_value_cutoff] DATETIME2 NULL,
                    [created_by] NVARCHAR(128) NOT NULL,
                    [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_snapshot_batch_created_at_runtime] DEFAULT SYSUTCDATETIME(),
                    [status] NVARCHAR(32) NOT NULL,
                    [notes] NVARCHAR(255) NULL,
                    CONSTRAINT [PK_payroll_snapshot_batch] PRIMARY KEY CLUSTERED ([id] ASC)
                );
            END
        `);

        await this.db.query(`
            IF NOT EXISTS (
                SELECT *
                FROM sys.indexes
                WHERE name = 'IX_payroll_snapshot_batch_scope_version'
            )
            BEGIN
                CREATE UNIQUE NONCLUSTERED INDEX [IX_payroll_snapshot_batch_scope_version]
                ON [dbo].[payroll_snapshot_batch] (
                    [period_year] ASC,
                    [period_month] ASC,
                    [division_code] ASC,
                    [gang_code] ASC,
                    [snapshot_version] ASC
                );
            END
        `);

        this.schemaEnsured = true;
    }

    async createNextBatch(scope: {
        period_month: number;
        period_year: number;
        division_code: string;
        gang_code: string;
        created_by: string;
    }) {
        await this.ensureSchema();

        const latest = await this.db.queryOne<{ latest_version: number }>(`
            SELECT ISNULL(MAX(snapshot_version), 0) AS latest_version
            FROM dbo.payroll_snapshot_batch
            WHERE period_month = ?
              AND period_year = ?
              AND division_code = ?
              AND gang_code = ?
        `, [scope.period_month, scope.period_year, scope.division_code, scope.gang_code]);

        const nextVersion = Number(latest?.latest_version || 0) + 1;

        const result = await this.db.query<{ id: number; snapshot_version: number }>(`
            INSERT INTO dbo.payroll_snapshot_batch (
                period_month,
                period_year,
                division_code,
                gang_code,
                snapshot_version,
                base_source,
                status,
                created_by
            ) OUTPUT INSERTED.id, INSERTED.snapshot_version
            VALUES (?, ?, ?, ?, ?, 'db_ptrj', 'completed', ?)
        `, [
            scope.period_month,
            scope.period_year,
            scope.division_code,
            scope.gang_code,
            nextVersion,
            scope.created_by
        ]);

        return result[0];
    }
}

export const payrollSnapshotBatchService = new PayrollSnapshotBatchService();
