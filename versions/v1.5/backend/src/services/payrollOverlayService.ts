import { Database } from "../db/client";
import type { EmployeeProfileOverrideRow, PayrollValueOverrideRow } from "../types/payroll/payrollOverlay";
import { pickLatestProfileOverrides, pickLatestValueOverrides } from "../utils/payrollOverlayLatest";
import { normalizeEffectiveStartDate } from "../utils/payrollProfileRules";

type QueryableDb = Pick<Database, "query" | "queryOne">;

function toSpsiBit(value: boolean | number | string | null | undefined): 0 | 1 {
    return value === true || value === 1 || value === "1" ? 1 : 0;
}

export interface SaveProfileOverrideInput {
    emp_code: string;
    nik?: string | null;
    is_spsi_member?: boolean | null;
    effective_start_date?: string | null;
    changed_by: string;
    change_reason?: string | null;
    change_source: string;
    employee_status_at_change?: string | null;
}

export interface SaveValueOverrideInput {
    period_month: number;
    period_year: number;
    division_code: string;
    gang_code: string;
    emp_code: string;
    nik?: string | null;
    field_name: string;
    field_group: string;
    numeric_value?: number | null;
    text_value?: string | null;
    change_reason?: string | null;
}

/**
 * SNAPSHOT TABLES ARE IMMUTABLE.
 * NEVER WRITE USER EDITS DIRECTLY INTO SNAPSHOT TABLES.
 * ALL MANUAL CHANGES MUST GO TO OVERLAY HISTORY TABLES.
 * LATEST OVERLAY MUST ALWAYS BE RESOLVED BY HIGHEST update_index.
 */
export class PayrollOverlayService {
    constructor(private readonly db: QueryableDb = Database.getExtendedInstance()) {}

    private async resolveSpsiMemberBitForInsert(input: SaveProfileOverrideInput): Promise<0 | 1> {
        if (typeof input.is_spsi_member === "boolean") {
            return input.is_spsi_member ? 1 : 0;
        }

        const latestOverride = await this.db.queryOne<{ is_spsi_member: boolean | number | string | null }>(`
            SELECT TOP 1 is_spsi_member
            FROM dbo.employee_profile_override_history
            WHERE emp_code = ?
              AND is_active_record = 1
              AND is_spsi_member IS NOT NULL
            ORDER BY update_index DESC, id DESC
        `, [input.emp_code]);

        if (latestOverride?.is_spsi_member !== null && latestOverride?.is_spsi_member !== undefined) {
            return toSpsiBit(latestOverride.is_spsi_member);
        }

        const latestHistory = await this.db.queryOne<{ is_spsi_member: boolean | number | string | null }>(`
            SELECT TOP 1 is_spsi_member
            FROM dbo.history_hr_employee
            WHERE emp_code = ?
              AND is_spsi_member IS NOT NULL
            ORDER BY id DESC
        `, [input.emp_code]);

        return toSpsiBit(latestHistory?.is_spsi_member);
    }

    async saveProfileOverride(input: SaveProfileOverrideInput) {
        const isSpsiMemberBit = await this.resolveSpsiMemberBitForInsert(input);

        const next = await this.db.queryOne<{ next_index: number }>(`
            SELECT ISNULL(MAX(update_index), 0) + 1 AS next_index
            FROM dbo.employee_profile_override_history
            WHERE emp_code = ?
        `, [input.emp_code]);

        const result = await this.db.query<{ id: number }>(`
            INSERT INTO dbo.employee_profile_override_history (
                emp_code,
                nik,
                is_spsi_member,
                effective_start_date,
                employee_status_at_change,
                update_index,
                change_source,
                change_reason,
                changed_by
            ) OUTPUT INSERTED.id
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            input.emp_code,
            input.nik || null,
            isSpsiMemberBit,
            normalizeEffectiveStartDate(input.effective_start_date),
            input.employee_status_at_change || null,
            next?.next_index || 1,
            input.change_source,
            input.change_reason || null,
            input.changed_by
        ]);

        return result[0]?.id;
    }

    async saveValueOverrides(items: SaveValueOverrideInput[], changedBy: string, changeSource: string = "DAFTAR_UPAH_UI") {
        const ids: number[] = [];

        for (const item of items) {
            const next = await this.db.queryOne<{ next_index: number }>(`
                SELECT ISNULL(MAX(update_index), 0) + 1 AS next_index
                FROM dbo.payroll_value_override_history
                WHERE period_month = ?
                  AND period_year = ?
                  AND division_code = ?
                  AND gang_code = ?
                  AND emp_code = ?
                  AND field_name = ?
            `, [
                item.period_month,
                item.period_year,
                item.division_code,
                item.gang_code,
                item.emp_code,
                item.field_name
            ]);

            const result = await this.db.query<{ id: number }>(`
                INSERT INTO dbo.payroll_value_override_history (
                    period_month,
                    period_year,
                    division_code,
                    gang_code,
                    emp_code,
                    nik,
                    field_name,
                    field_group,
                    numeric_value,
                    text_value,
                    update_index,
                    change_source,
                    change_reason,
                    changed_by
                ) OUTPUT INSERTED.id
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                item.period_month,
                item.period_year,
                item.division_code,
                item.gang_code,
                item.emp_code,
                item.nik || null,
                item.field_name,
                item.field_group,
                item.numeric_value ?? null,
                item.text_value?.trim() ? item.text_value.trim() : null,
                next?.next_index || 1,
                changeSource,
                item.change_reason || null,
                changedBy
            ]);

            if (result[0]?.id) {
                ids.push(result[0].id);
            }
        }

        return ids;
    }

    async getLatestProfileOverrides(empCodes: string[]) {
        if (!empCodes.length) {
            return new Map<string, EmployeeProfileOverrideRow>();
        }

        const placeholders = empCodes.map(() => "?").join(",");
        const rows = await this.db.query<EmployeeProfileOverrideRow>(`
            SELECT
                emp_code,
                nik,
                is_spsi_member,
                CONVERT(VARCHAR(10), effective_start_date, 23) AS effective_start_date,
                update_index
            FROM dbo.employee_profile_override_history
            WHERE emp_code IN (${placeholders})
              AND is_active_record = 1
        `, empCodes);

        return pickLatestProfileOverrides(rows);
    }

    async getLatestValueOverrides(scope: {
        month: number;
        year: number;
        divisionCode?: string;
        gangCode?: string;
    }) {
        const whereClauses = [
            "period_month = ?",
            "period_year = ?",
            "is_active_record = 1"
        ];
        const params: any[] = [scope.month, scope.year];

        if (scope.divisionCode && scope.divisionCode !== "ALL") {
            whereClauses.push("division_code = ?");
            params.push(scope.divisionCode);
        }

        if (scope.gangCode && scope.gangCode !== "ALL") {
            whereClauses.push("gang_code = ?");
            params.push(scope.gangCode);
        }

        const rows = await this.db.query<PayrollValueOverrideRow>(`
            SELECT
                period_month,
                period_year,
                division_code,
                gang_code,
                emp_code,
                field_name,
                numeric_value,
                text_value,
                update_index
            FROM dbo.payroll_value_override_history
            WHERE ${whereClauses.join(" AND ")}
        `, params);

        return pickLatestValueOverrides(rows);
    }
}

export const payrollOverlayService = new PayrollOverlayService();
