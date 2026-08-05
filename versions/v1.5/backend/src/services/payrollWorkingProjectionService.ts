import { deriveInitialSpsiMember, calculateMasaKerjaDisplay } from "../utils/payrollProfileRules";
import { buildValueOverrideKey } from "../utils/payrollOverlayLatest";

interface ProjectionInputRow {
    emp_code: string;
    nik?: string | null;
    gang_code?: string | null;
    division_code?: string | null;
    join_date?: string | null;
    pot_spsi?: number | null;
    premi_dynamic?: number | null;
    pot_koreksi?: number | null;
    pot_lainnya?: number | null;
    [key: string]: any;
}

export class PayrollWorkingProjectionService {
    applyOverrides(input: {
        month: number;
        year: number;
        rows: ProjectionInputRow[];
        profileOverrides: Map<string, any>;
        valueOverrides: Map<string, any>;
    }) {
        return input.rows.map((row) => {
            const profile = input.profileOverrides.get(row.emp_code);
            const effectiveStart = profile?.effective_start_date || row.join_date || null;
            const masaKerja = calculateMasaKerjaDisplay(effectiveStart, input.month, input.year);

            const output = {
                ...row,
                is_spsi_member: profile?.is_spsi_member ?? deriveInitialSpsiMember(row.pot_spsi),
                effective_start_date: effectiveStart,
                masa_kerja_display_years: masaKerja.years,
                masa_kerja_display_months: masaKerja.months,
                masa_kerja_label: masaKerja.label
            };

            for (const fieldName of ["premi_dynamic", "pot_koreksi", "pot_lainnya"]) {
                const key = buildValueOverrideKey({
                    period_year: input.year,
                    period_month: input.month,
                    division_code: row.division_code || "",
                    gang_code: row.gang_code || "",
                    emp_code: row.emp_code,
                    field_name: fieldName
                });
                const latest = input.valueOverrides.get(key);
                if (latest && latest.numeric_value !== null && latest.numeric_value !== undefined) {
                    output[fieldName] = Number(latest.numeric_value);
                }
            }

            return output;
        });
    }
}

export const payrollWorkingProjectionService = new PayrollWorkingProjectionService();
