import type {
    EmployeeProfileOverrideRow,
    PayrollSnapshotBatchRow,
    PayrollValueOverrideRow
} from "../types/payroll/payrollOverlay";

export function pickLatestProfileOverrides(rows: EmployeeProfileOverrideRow[]) {
    const latest = new Map<string, EmployeeProfileOverrideRow>();

    for (const row of rows) {
        const current = latest.get(row.emp_code);
        if (!current || row.update_index > current.update_index) {
            latest.set(row.emp_code, row);
        }
    }

    return latest;
}

export function buildValueOverrideKey(
    row: Pick<
        PayrollValueOverrideRow,
        "period_year" | "period_month" | "division_code" | "gang_code" | "emp_code" | "field_name"
    >
) {
    return `${row.period_year}:${row.period_month}:${row.division_code}:${row.gang_code}:${row.emp_code}:${row.field_name}`;
}

export function pickLatestValueOverrides(rows: PayrollValueOverrideRow[]) {
    const latest = new Map<string, PayrollValueOverrideRow>();

    for (const row of rows) {
        const key = buildValueOverrideKey(row);
        const current = latest.get(key);
        if (!current || row.update_index > current.update_index) {
            latest.set(key, row);
        }
    }

    return latest;
}

export function pickLatestSnapshotVersion(rows: PayrollSnapshotBatchRow[]) {
    return rows.reduce((max, row) => Math.max(max, Number(row.snapshot_version || 0)), 0);
}

export function resolveSnapshotVersion(
    rows: PayrollSnapshotBatchRow[],
    requestedSnapshotVersion?: number | null
) {
    if (requestedSnapshotVersion == null) {
        return pickLatestSnapshotVersion(rows);
    }

    return rows.some((row) => Number(row.snapshot_version || 0) === requestedSnapshotVersion)
        ? requestedSnapshotVersion
        : null;
}
