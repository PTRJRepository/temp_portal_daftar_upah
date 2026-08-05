export function buildPeriodSliderPeriods(minYear, maxYear, now = new Date()) {
  const periods = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      if (year === maxYear) {
        const currentMaxMonth = now.getMonth() + 2;
        if (month > currentMaxMonth) continue;
      }
      periods.push({ month, year });
    }
  }
  return periods;
}

export function getPeriodSliderIndex(periods, month, year) {
  return periods.findIndex((period) => period.month === month && period.year === year);
}

export function getPeriodSliderScrollLeft(index, containerWidth, itemWidth = 80) {
  if (index < 0) return 0;
  return Math.max(0, (index * itemWidth) - (containerWidth / 2) + (itemWidth / 2));
}
