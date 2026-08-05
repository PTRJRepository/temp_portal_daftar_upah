import { toFinitePayrollNumber } from './payrollNumericValues';

export const REPORT_ROWS_FETCH_LIMIT = 100000;

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function firstDefined(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key];
    }
  }
  return 0;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function getRowDivision(row) {
  return firstDefined(row, [
    'loc_code',
    'division_code',
    'division',
    'divisi',
    'kode_divisi',
    'estate_code',
  ]);
}

function getRowGang(row) {
  return firstDefined(row, ['gang_code', 'gang', 'kode_gang']);
}

function matchesDivision(row, selectedDivision) {
  const selected = normalizeCode(selectedDivision);
  if (!selected || selected === 'ALL') return true;

  const rowDivision = normalizeCode(getRowDivision(row));
  if (!rowDivision) return true;
  return rowDivision === selected;
}

function matchesGang(row, selectedGang) {
  const selected = normalizeCode(selectedGang);
  if (!selected || selected === 'ALL') return true;

  const rowGang = normalizeCode(getRowGang(row));
  return rowGang === selected;
}

function getUpahBersih(row) {
  return toFinitePayrollNumber(row?.upah_bersih);
}

function sumBy(rows, keys) {
  return rows.reduce((sum, row) => sum + toFinitePayrollNumber(firstDefined(row, keys)), 0);
}

function buildCommonMeta(rows, extra = {}) {
  const wages = rows.map(getUpahBersih);
  const sumUpahBersih = wages.reduce((sum, value) => sum + value, 0);

  return {
    ...extra,
    count: rows.length,
    sum_upah_bersih: sumUpahBersih,
    avg_upah_bersih: rows.length > 0 ? sumUpahBersih / rows.length : 0,
    max_upah_bersih: rows.length > 0 ? Math.max(...wages) : 0,
    min_upah_bersih: rows.length > 0 ? Math.min(...wages) : 0,
    sum_gaji_pokok: sumBy(rows, ['gaji_pokok_aktual', 'gaji_pokok']),
    sum_tunjangan: sumBy(rows, ['total_tunjangan']),
    sum_lembur: sumBy(rows, ['lembur_jumlah']),
    sum_premi: sumBy(rows, ['total_premi']),
    sum_potongan: sumBy(rows, ['total_potongan_bersih', 'total_potongan']),
    sum_jabatan: sumBy(rows, ['jabatan_jumlah']),
    sum_beras: sumBy(rows, ['beras_jumlah']),
    sum_masa_kerja: sumBy(rows, ['masa_kerja_jumlah', 'masa_kerja_amount']),
  };
}

function sortAndRank(rows) {
  return [...rows]
    .sort((a, b) => getUpahBersih(b) - getUpahBersih(a))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

export function buildHighEarnerRows(rowsPayload, { limit = 6000000, division = 'ALL', gang = 'ALL' } = {}) {
  const threshold = toFinitePayrollNumber(limit);
  const rows = unwrapRows(rowsPayload)
    .filter((row) => matchesDivision(row, division))
    .filter((row) => matchesGang(row, gang))
    .filter((row) => getUpahBersih(row) > threshold);
  const data = sortAndRank(rows);

  return {
    data,
    meta: buildCommonMeta(data, { limit: threshold }),
  };
}

export function buildSalaryRangeRows(rowsPayload, { minSalary = 0, maxSalary = null } = {}) {
  const min = toFinitePayrollNumber(minSalary);
  const hasMax = maxSalary !== null && maxSalary !== undefined && maxSalary !== '';
  const max = hasMax ? toFinitePayrollNumber(maxSalary) : null;
  const rows = unwrapRows(rowsPayload).filter((row) => {
    const upahBersih = getUpahBersih(row);
    return upahBersih > min && (max === null || upahBersih <= max);
  });
  const data = sortAndRank(rows);

  return {
    data,
    meta: buildCommonMeta(data, {
      min_salary: min,
      max_salary: max,
    }),
  };
}

function normalizeOptions(payload, codeKeys, labelKeys, labelFormatter = null) {
  const seen = new Set();
  return unwrapRows(payload)
    .map((item) => {
      if (typeof item === 'string') {
        const code = item.trim();
        return code ? { code, label: code } : null;
      }

      const code = String(firstDefined(item, codeKeys) || '').trim();
      if (!code) return null;

      const rawLabel = String(firstDefined(item, labelKeys) || '').trim();
      const label = labelFormatter ? labelFormatter(code, rawLabel) : (rawLabel || code);
      return { code, label };
    })
    .filter(Boolean)
    .filter((option) => {
      const key = normalizeCode(option.code);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeDivisionOptions(payload) {
  return normalizeOptions(
    payload,
    ['code', 'division_code', 'loc_code', 'value'],
    ['name', 'label', 'description']
  );
}

export function normalizeGangOptions(payload) {
  return normalizeOptions(
    payload,
    ['gang_code', 'code', 'value'],
    ['description', 'name', 'label'],
    (code, label) => (label && label !== code ? `${code} - ${label}` : code)
  );
}
