import { shouldIgnoreGangPrefixForDivision } from './payrollRequestScope';

export function resolveGangPrefixAfterAvailablePrefixesChange({
    division,
    gangPrefix,
    availablePrefixes = []
}) {
    if (shouldIgnoreGangPrefixForDivision(division)) {
        return '';
    }

    const normalizedPrefix = String(gangPrefix || '').trim();
    if (!normalizedPrefix) {
        return '';
    }

    if (!Array.isArray(availablePrefixes) || availablePrefixes.length === 0) {
        return normalizedPrefix;
    }

    return availablePrefixes.includes(normalizedPrefix) ? normalizedPrefix : '';
}
