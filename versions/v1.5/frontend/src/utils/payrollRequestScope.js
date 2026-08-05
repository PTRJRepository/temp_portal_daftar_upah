export function normalizePayrollDivisionCode(division) {
    const normalized = String(division || '').trim().toUpperCase();
    if (normalized === 'INFRA' || normalized === 'INFRASTRUKTUR') {
        return 'INF';
    }
    return normalized;
}

export function shouldIgnoreGangPrefixForDivision(division) {
    return normalizePayrollDivisionCode(division) === 'INF';
}

export function resolveEffectiveGangPrefix(gangCode, gangPrefix, division = null) {
    if (gangCode && gangCode !== 'ALL') {
        return null;
    }

    if (shouldIgnoreGangPrefixForDivision(division)) {
        return null;
    }

    return gangPrefix || null;
}

export function buildPayrollRequestScopeKey({
    division,
    month,
    year,
    gangCode,
    gangPrefix,
    useHistoryDb,
    snapshotVersion
}) {
    return JSON.stringify({
        division: division || null,
        month: month || null,
        year: year || null,
        gangCode: gangCode || null,
        gangPrefix: resolveEffectiveGangPrefix(gangCode, gangPrefix, division),
        useHistoryDb: Boolean(useHistoryDb),
        snapshotVersion: snapshotVersion ?? null
    });
}
