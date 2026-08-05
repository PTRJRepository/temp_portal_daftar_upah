import { parseBooleanQueryParam, parsePositiveIntegerQueryParam } from "./queryParsers";

export interface MonthlyTaxQueryInput {
    year?: string;
    month?: string;
    division?: string;
    gang?: string;
    gangPrefix?: string;
    use_history?: string;
    snapshot_version?: string;
    value_priority_mode?: string;
}

export interface MonthlyTaxUserScope {
    role?: string | null;
    divisions?: string[] | null;
}

export interface ResolvedMonthlyTaxQuery {
    year: number;
    month: number;
    division?: string;
    gang?: string;
    gangPrefix?: string;
    useHistoryDb: boolean;
    snapshotVersion: number | null;
    valuePriorityMode: "db_ptrj_only" | "non_db_ptrj";
    hasValidPeriod: boolean;
}

function normalizeOptionalString(value?: string): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeValuePriorityMode(value?: string): "db_ptrj_only" | "non_db_ptrj" {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "db_ptrj_only") return "db_ptrj_only";
    return "non_db_ptrj";
}

export function resolveMonthlyTaxQuery(
    query: MonthlyTaxQueryInput,
    currentUser?: MonthlyTaxUserScope | null
): ResolvedMonthlyTaxQuery {
    const year = Number.parseInt(query.year ?? "", 10);
    const month = Number.parseInt(query.month ?? "", 10);

    let division = normalizeOptionalString(query.division);
    const gang = normalizeOptionalString(query.gang);
    const gangPrefix = normalizeOptionalString(query.gangPrefix);

    if (currentUser?.role?.toLowerCase() === "kerani" && currentUser.divisions && currentUser.divisions.length > 0) {
        division = normalizeOptionalString(currentUser.divisions[0]);
    }

    return {
        year,
        month,
        division,
        gang,
        gangPrefix,
        useHistoryDb: parseBooleanQueryParam(query.use_history) ?? false,
        snapshotVersion: parsePositiveIntegerQueryParam(query.snapshot_version),
        valuePriorityMode: normalizeValuePriorityMode(query.value_priority_mode),
        hasValidPeriod: Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
    };
}
