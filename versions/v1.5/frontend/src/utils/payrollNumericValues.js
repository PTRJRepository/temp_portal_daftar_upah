function normalizePayrollNumericInput(value) {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed === "") return "";

  const compact = trimmed.replace(/\s+/g, "");

  // English-style thousands/decimal: 1,234.56
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
    return compact.replace(/,/g, "");
  }

  // Indonesian-style thousands/decimal: 1.234,56
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(compact)) {
    return compact.replace(/\./g, "").replace(",", ".");
  }

  // Decimal comma without thousands: 5,5
  if (/^-?\d+,\d+$/.test(compact)) {
    return compact.replace(",", ".");
  }

  return compact;
}

export function toFinitePayrollNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const normalized = normalizePayrollNumericInput(value);
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function parsePayrollInputNumber(value) {
  if (value === null || value === undefined) return 0;
  if (value === "") return 0;

  const normalized = normalizePayrollNumericInput(value);

  if (normalized === "") return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolvePersistentOriginalNumber(previousOriginal, fallbackOriginal) {
  if (previousOriginal !== null && previousOriginal !== undefined) {
    return toFinitePayrollNumber(previousOriginal);
  }
  return toFinitePayrollNumber(fallbackOriginal);
}
