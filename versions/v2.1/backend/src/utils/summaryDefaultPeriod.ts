export type SummaryAvailablePeriod = {
    period_year: number;
    period_month: number;
};

export type SummaryDefaultPeriod = {
    month: number;
    year: number;
};

export function chooseSummaryDefaultPeriod(
    availablePeriods: SummaryAvailablePeriod[],
    currentPeriod: SummaryDefaultPeriod | null
): SummaryDefaultPeriod | null {
    if (!currentPeriod) return availablePeriods[0]
        ? { month: Number(availablePeriods[0].period_month), year: Number(availablePeriods[0].period_year) }
        : null;

    const currentExists = availablePeriods.some(period =>
        Number(period.period_year) === Number(currentPeriod.year)
        && Number(period.period_month) === Number(currentPeriod.month)
    );

    if (currentExists || availablePeriods.length === 0) {
        return currentPeriod;
    }

    const latestAggregationPeriod = availablePeriods[0];
    return {
        month: Number(latestAggregationPeriod.period_month),
        year: Number(latestAggregationPeriod.period_year)
    };
}
