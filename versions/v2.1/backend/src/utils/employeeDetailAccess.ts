import { divisionConfigService } from "../services/config/DivisionConfigService";

interface EmployeeDetailAccessOptions {
    userDivisions?: string[];
    requestedDivision?: string | null;
    employeeLocCode?: string | null;
    employeeGangCode?: string | null;
    employeeGangDescription?: string | null;
}

const normalizeDivision = (division?: string | null): string => {
    const normalized = String(division || "").trim();
    return normalized ? divisionConfigService.resolveCode(normalized) : "";
};

export function canAccessEmployeeDetailScope({
    userDivisions = [],
    requestedDivision,
    employeeLocCode,
    employeeGangCode,
    employeeGangDescription
}: EmployeeDetailAccessOptions): boolean {
    const userScopes = new Set(userDivisions.map(normalizeDivision).filter(Boolean));
    if (userScopes.size === 0) return false;

    const employeeDivision = normalizeDivision(employeeLocCode);
    if (employeeDivision && userScopes.has(employeeDivision)) return true;

    const requestedScope = normalizeDivision(requestedDivision);
    const candidateVirtualScopes = Array.from(userScopes).filter(scope => divisionConfigService.isVirtualDivision(scope));

    if (requestedScope && userScopes.has(requestedScope) && divisionConfigService.isVirtualDivision(requestedScope)) {
        candidateVirtualScopes.unshift(requestedScope);
    }

    const gangCode = String(employeeGangCode || "").trim();
    if (!gangCode) return false;

    const seen = new Set<string>();
    return candidateVirtualScopes.some(scope => {
        if (seen.has(scope)) return false;
        seen.add(scope);

        return divisionConfigService.isGangInVirtualDivision(
            gangCode,
            scope,
            employeeGangDescription || undefined,
            employeeLocCode || undefined
        );
    });
}
