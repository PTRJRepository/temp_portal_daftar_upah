export const DEFAULT_PAYROLL_CACHE_EMPLOYEE_LIMIT = 400;

export function resolvePayrollClientRuntimePolicy({
    dataReady = false,
    hasRows = false,
    usesStream = false,
    streamComplete = false,
    hasPendingEdits = false,
    employeeCount = 0,
    maxCachedEmployees = DEFAULT_PAYROLL_CACHE_EMPLOYEE_LIMIT
} = {}) {
    if (!dataReady || !hasRows) {
        return {
            shouldMirrorStreamRows: false,
            shouldPublishToParent: false,
            shouldPersistCache: false
        };
    }

    const streamSettled = !usesStream || streamComplete;
    const shouldPublishToParent = streamSettled;
    const shouldPersistCache = streamSettled && employeeCount > 0 && employeeCount <= maxCachedEmployees;
    const shouldMirrorStreamRows = usesStream && streamComplete && !hasPendingEdits;

    return {
        shouldMirrorStreamRows,
        shouldPublishToParent,
        shouldPersistCache
    };
}
