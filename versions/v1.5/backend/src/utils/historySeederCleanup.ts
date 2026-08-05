export interface HistorySeederCleanupInput {
    periodMonth: number;
    periodYear: number;
    divisionCode?: string;
    gangCode?: string;
    force?: boolean;
}

export interface HistorySeederCleanupPolicy {
    shouldDeleteAggregationHistory: boolean;
    shouldDeletePayrollHistory: boolean;
    hasScopedDivision: boolean;
}

function hasSpecificDivision(divisionCode?: string): boolean {
    return typeof divisionCode === "string" && divisionCode.trim().length > 0 && divisionCode.trim().toUpperCase() !== "ALL";
}

export function resolveHistorySeederCleanupPolicy(
    options: HistorySeederCleanupInput
): HistorySeederCleanupPolicy {
    const hasScopedDivision = hasSpecificDivision(options.divisionCode);
    const shouldDeleteScopedHistory = Boolean(options.force) && hasScopedDivision;

    return {
        shouldDeleteAggregationHistory: shouldDeleteScopedHistory,
        shouldDeletePayrollHistory: shouldDeleteScopedHistory,
        hasScopedDivision
    };
}
