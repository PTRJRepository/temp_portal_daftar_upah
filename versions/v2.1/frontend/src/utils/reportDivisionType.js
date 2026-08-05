export const REPORT_DIVISION_TYPES = Object.freeze({
  ALL: 'all',
  REAL: 'real',
  VIRTUAL: 'virtual',
});

export const VIRTUAL_REPORT_DIVISION_CODES = new Set([
  'INF',
  'NRS',
  'WKS_PG',
  'WKS_AR',
  'WORKSHOP',
]);

export function normalizeDivisionType(value = REPORT_DIVISION_TYPES.ALL) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === REPORT_DIVISION_TYPES.REAL) return REPORT_DIVISION_TYPES.REAL;
  if (normalized === REPORT_DIVISION_TYPES.VIRTUAL) return REPORT_DIVISION_TYPES.VIRTUAL;
  return REPORT_DIVISION_TYPES.ALL;
}

export function isVirtualReportDivision(divisionCode) {
  return VIRTUAL_REPORT_DIVISION_CODES.has(String(divisionCode || '').trim().toUpperCase());
}

export function filterRowsByDivisionType(rows = [], divisionType = REPORT_DIVISION_TYPES.ALL) {
  const normalizedType = normalizeDivisionType(divisionType);
  if (normalizedType === REPORT_DIVISION_TYPES.ALL) return rows;

  return rows.filter(row => {
    const virtual = isVirtualReportDivision(row?.division_code);
    return normalizedType === REPORT_DIVISION_TYPES.VIRTUAL ? virtual : !virtual;
  });
}
