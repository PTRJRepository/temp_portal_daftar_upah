export type SummaryDivisionType = "all" | "real" | "virtual";

const VIRTUAL_SUMMARY_DIVISION_CODES = new Set([
    "INF",
    "NRS",
    "WKS_PG",
    "WKS_AR",
    "WORKSHOP"
]);

export function normalizeSummaryDivisionType(value?: string | null): SummaryDivisionType {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "real") return "real";
    if (normalized === "virtual") return "virtual";
    return "all";
}

export function isVirtualSummaryDivision(divisionCode?: string | null): boolean {
    return VIRTUAL_SUMMARY_DIVISION_CODES.has(String(divisionCode || "").trim().toUpperCase());
}

export function filterRowsBySummaryDivisionType<T extends { division_code?: string | null }>(
    rows: T[],
    divisionType?: string | null
): T[] {
    const normalizedType = normalizeSummaryDivisionType(divisionType);
    if (normalizedType === "all") return rows;

    return rows.filter(row => {
        const virtual = isVirtualSummaryDivision(row.division_code);
        return normalizedType === "virtual" ? virtual : !virtual;
    });
}
