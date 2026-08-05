const PROFILE_FIELDS = new Set(["is_spsi_member", "effective_start_date"]);
const VALUE_FIELDS = new Set(["premi_dynamic", "pot_koreksi", "pot_lainnya"]);

function normalizeDateValue(value) {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

export function splitPayrollEdits({ month, year, division, edits }) {
    const profileMap = new Map();
    const valueItems = [];

    for (const edit of edits) {
        if (!edit || !edit.field) continue;

        if (PROFILE_FIELDS.has(edit.field)) {
            const key = edit.emp_code;
            const current = profileMap.get(key) || {
                emp_code: edit.emp_code,
                nik: edit.nik,
                effective_start_date: null,
                employee_status_at_change: edit.employee_status || null
            };

            if (edit.field === "effective_start_date") {
                current.effective_start_date = normalizeDateValue(edit.value);
            } else {
                current[edit.field] = !!edit.value;
            }

            profileMap.set(key, current);
            continue;
        }

        if (VALUE_FIELDS.has(edit.field)) {
            valueItems.push({
                period_month: month,
                period_year: year,
                division_code: division,
                gang_code: edit.gang_code,
                emp_code: edit.emp_code,
                nik: edit.nik,
                field_name: edit.field,
                field_group: edit.field.startsWith("premi") ? "PREMI" : "POTONGAN",
                numeric_value: Number(edit.value || 0)
            });
        }
    }

    return {
        profileItems: [...profileMap.values()],
        valueItems
    };
}
