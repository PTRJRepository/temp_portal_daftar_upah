import { divisionDefinition } from "../services/divisionDefinition";

export interface TaxReportDivisionScopeOptions {
    divisionCode?: string;
    gangPrefix?: string;
}

export interface TaxReportDivisionScope {
    requestedDivisionCode?: string;
    fetchDivisionCode: string;
    gangPrefix?: string;
    isVirtualDivision: boolean;
}

interface TaxReportRowLike {
    gang_code?: string;
    gang_description?: string;
    gang_desc?: string;
    task_desc?: string;
    [key: string]: any;
}

function normalizeOptionalString(value?: string): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toUpperCase() : undefined;
}

/**
 * Canonical scope contract for tax-report services.
 *
 * Important:
 * - Virtual divisions stay on their requested division code. We do NOT remap
 *   them to a source division in report services because that breaks row-level
 *   matching consistency across monthly/annual/December report paths.
 * - gangPrefix is normalized, but virtual divisions still rely on the virtual
 *   matcher as the authoritative row filter.
 */
export function resolveTaxReportDivisionScope(
    options: TaxReportDivisionScopeOptions
): TaxReportDivisionScope {
    const requestedDivisionCode = normalizeOptionalString(options.divisionCode);
    const gangPrefix = normalizeOptionalString(options.gangPrefix);

    return {
        requestedDivisionCode,
        fetchDivisionCode: requestedDivisionCode || "ALL",
        gangPrefix,
        isVirtualDivision: requestedDivisionCode
            ? divisionDefinition.isVirtualDivision(requestedDivisionCode)
            : false
    };
}

/**
 * Apply the report row filter that matches the scope contract above.
 *
 * Order matters:
 * 1. Virtual division matcher wins and ignores gangPrefix.
 * 2. Non-virtual scopes may still use explicit gangPrefix filtering.
 */
export function filterTaxReportRows<T extends TaxReportRowLike>(
    rows: T[],
    scope: TaxReportDivisionScope
): T[] {
    if (scope.isVirtualDivision && scope.requestedDivisionCode) {
        return rows.filter((row) =>
            divisionDefinition.matchGangToVirtualDivision(
                row.gang_code || "",
                scope.requestedDivisionCode!,
                row.gang_description || row.gang_desc || row.task_desc || ""
            )
        );
    }

    if (!scope.gangPrefix) {
        return rows;
    }

    const trimmedPrefix = scope.gangPrefix.trim();
    const isNumericPrefix = /^\d+$/.test(trimmedPrefix);

    return rows.filter((row) => {
        const gangCode = (row.gang_code || "").trim();
        if (isNumericPrefix) {
            return divisionDefinition.getAsistensiFromGang(gangCode, scope.fetchDivisionCode) === trimmedPrefix;
        }
        return gangCode.startsWith(trimmedPrefix);
    });
}
