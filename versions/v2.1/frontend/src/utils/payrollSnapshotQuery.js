export function normalizeSnapshotVersion(snapshotVersion) {
    if (snapshotVersion === null || snapshotVersion === undefined) return null;

    const normalized = String(snapshotVersion).trim();
    if (!/^\d+$/.test(normalized)) return null;

    const parsed = Number.parseInt(normalized, 10);
    return parsed > 0 ? parsed : null;
}

export function appendSnapshotVersionToObject(params, snapshotVersion) {
    const normalized = normalizeSnapshotVersion(snapshotVersion);
    if (normalized !== null) {
        params.snapshot_version = String(normalized);
    }
    return params;
}

export function appendSnapshotVersionToSearchParams(searchParams, snapshotVersion) {
    const normalized = normalizeSnapshotVersion(snapshotVersion);
    if (normalized !== null) {
        searchParams.set('snapshot_version', String(normalized));
    }
    return searchParams;
}

export function buildPayrollSnapshotCacheKey({ division, month, year, useHistory, snapshotVersion }) {
    const scope = useHistory ? 'hist' : 'origin';
    if (!useHistory) {
        return `payroll_cache_${division}_${month}_${year}_${scope}`;
    }

    const normalized = normalizeSnapshotVersion(snapshotVersion);
    const versionLabel = normalized === null ? 'latest' : `v${normalized}`;
    return `payroll_cache_${division}_${month}_${year}_${scope}_${versionLabel}`;
}
