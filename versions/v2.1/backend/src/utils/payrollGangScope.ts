import { divisionConfigService } from "../services/config/DivisionConfigService";

export function resolvePayrollDivisionCodeForScope(divisionCode?: string | null): string | undefined {
    const normalized = String(divisionCode || "").trim();
    if (!normalized) return undefined;
    return divisionConfigService.resolveCode(normalized);
}

export function shouldIgnorePayrollGangPrefix(divisionCode?: string | null): boolean {
    return resolvePayrollDivisionCodeForScope(divisionCode) === "INF";
}

export function resolvePayrollGangPrefixForDivision(
    divisionCode?: string | null,
    gangPrefix?: string | null
): string | undefined {
    const normalizedPrefix = String(gangPrefix || "").trim();
    if (!normalizedPrefix) return undefined;
    if (shouldIgnorePayrollGangPrefix(divisionCode)) return undefined;
    return normalizedPrefix;
}
