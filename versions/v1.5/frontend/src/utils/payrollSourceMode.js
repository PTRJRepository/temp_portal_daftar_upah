export function getPayrollPeriodMode({ month, year, currentPeriod, fallbackDate = new Date() }) {
    const fallbackMonth = fallbackDate.getMonth() + 1;
    const fallbackYear = fallbackDate.getFullYear();
    const currentMonth = currentPeriod?.month ?? fallbackMonth;
    const currentYear = currentPeriod?.year ?? fallbackYear;
    const requestedValue = (Number(year) || 0) * 100 + (Number(month) || 0);
    const currentValue = currentYear * 100 + currentMonth;

    return {
        currentMonth,
        currentYear,
        isHistoricalPeriod: requestedValue < currentValue
    };
}

export function resolveEffectiveUseHistoryDb({ isHistoricalPeriod, useHistoryDb }) {
    if (isHistoricalPeriod) {
        return true;
    }

    return Boolean(useHistoryDb);
}
