import type { EmployeeProfileOverrideRow } from "../types/payroll/payrollOverlay";
import { pickLatestProfileOverrides } from "../utils/payrollOverlayLatest";
import {
    deriveInitialSpsiMember,
    resolveThrCompatibleEffectiveStartDate
} from "../utils/payrollProfileRules";

export class PayrollProfileSeedService {
    async buildSeedRowFromMarch(row: {
        emp_code: string;
        nik?: string | null;
        pot_spsi?: number | null;
        join_date?: string | null;
        app_join_date?: string | null;
        app_join_grp_date?: string | null;
    }) {
        return {
            emp_code: row.emp_code,
            nik: row.nik || null,
            is_spsi_member: deriveInitialSpsiMember(row.pot_spsi),
            effective_start_date: resolveThrCompatibleEffectiveStartDate(
                row.app_join_date,
                row.app_join_grp_date,
                row.join_date || null
            )
        };
    }

    resolveSpsiMember(empCode: string, seededMembers: Map<string, boolean>, profileOverrides: Map<string, EmployeeProfileOverrideRow>) {
        return profileOverrides.get(empCode)?.is_spsi_member ?? seededMembers.get(empCode) ?? false;
    }

    pickLatestProfileOverrides(rows: EmployeeProfileOverrideRow[]) {
        return pickLatestProfileOverrides(rows);
    }
}

export const payrollProfileSeedService = new PayrollProfileSeedService();
