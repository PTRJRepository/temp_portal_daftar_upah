type EmployeeSortRow = {
    emp_code?: unknown;
    no?: number;
};

function normalizeEmpCode(value: unknown): string {
    return String(value ?? "").trim().toUpperCase();
}

export function compareEmpCodeValues(a: unknown, b: unknown): number {
    const aCode = normalizeEmpCode(a);
    const bCode = normalizeEmpCode(b);

    if (!aCode && !bCode) return 0;
    if (!aCode) return 1;
    if (!bCode) return -1;

    return aCode.localeCompare(bCode, "en", {
        numeric: true,
        sensitivity: "base"
    });
}

export function sortByEmpCode<T extends EmployeeSortRow>(rows: readonly T[]): T[] {
    return [...rows].sort((a, b) => compareEmpCodeValues(a.emp_code, b.emp_code));
}

export function sortAndRenumberByEmpCode<T extends EmployeeSortRow>(rows: readonly T[]): Array<T & { no: number }> {
    return sortByEmpCode(rows).map((row, index) => ({
        ...row,
        no: index + 1
    }));
}
