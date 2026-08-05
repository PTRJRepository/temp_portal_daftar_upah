const TOTAL_OTHER_INCOME_FIELD = 'pendapatan_lainnya';
const MANUAL_KONTAN_FIELD = 'pendapatan_kontan';

export function getOtherIncomeDetailFields(activeFields = [], options = {}) {
  const { includeKontan = false } = options;
  const seen = new Set();
  const detailFields = [];

  for (const field of activeFields) {
    if (!field || field === TOTAL_OTHER_INCOME_FIELD) continue;
    if (!includeKontan && field === MANUAL_KONTAN_FIELD) continue;
    if (seen.has(field)) continue;
    seen.add(field);
    detailFields.push(field);
  }

  if (includeKontan && !seen.has(MANUAL_KONTAN_FIELD)) {
    detailFields.push(MANUAL_KONTAN_FIELD);
  }

  return detailFields;
}

export function formatOtherIncomeColumnLabel(field, suffix = '') {
  const rawLabel = String(field || '')
    .replace(/^pendapatan_/, '')
    .toUpperCase();
  const compactLabel = rawLabel.replace(/[^A-Z0-9]+/g, '');
  const baseLabel = compactLabel.includes('BONUS') || compactLabel.includes('EXGRATIA')
    ? 'PENDAPATAN BONUS'
    : rawLabel;

  return suffix ? `${baseLabel} ${suffix}` : baseLabel;
}
