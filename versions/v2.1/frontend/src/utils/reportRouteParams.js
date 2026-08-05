function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseSalaryRangeRouteParams(search, defaults = {}) {
  const params = new URLSearchParams(search || '');
  const fallbackMonth = parsePositiveInteger(defaults.month, new Date().getMonth() + 1);
  const fallbackYear = parsePositiveInteger(defaults.year, new Date().getFullYear());
  const fallbackMinSalary = parsePositiveInteger(defaults.minSalary, 6000000);
  const maxSalary = params.get('max_salary');

  return {
    month: parsePositiveInteger(params.get('month'), fallbackMonth),
    year: parsePositiveInteger(params.get('year'), fallbackYear),
    minSalary: parsePositiveInteger(params.get('min_salary'), fallbackMinSalary),
    maxSalary: maxSalary ? parsePositiveInteger(maxSalary, null) : null,
  };
}
