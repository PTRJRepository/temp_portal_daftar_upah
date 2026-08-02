const NUMERIC_FIELD_PATTERN = /^(jumlah_|total_|pot_|premi_|lembur_|gaji_|upah_|beras_|jabatan_|masa_|koreksi_|penghasilan_|pph21_|tarif_|astek_|bpjs_|thr_|bonus_|exgratia_|pendapatan_|hari_kerja|kehadiran|taxable_)/;
const DEDUCTION_SUFFIX = '_pengurang';
const TOTAL_DISPLAY_ONLY_FIELDS = new Set(['koreksi_hk']);
const ROUNDING_EPSILON = 1e-6;

function roundPayrollTotal(value) {
  const numberValue = Number(value) || 0;
  if (!Number.isFinite(numberValue)) return 0;
  return Math.round(numberValue + (numberValue >= 0 ? ROUNDING_EPSILON : -ROUNDING_EPSILON));
}

export function isPayrollTotalDisplayOnlyField(field = '') {
  return TOTAL_DISPLAY_ONLY_FIELDS.has(field);
}

export function isPayrollNumericField(field = '') {
  if (isPayrollTotalDisplayOnlyField(field)) return false;
  return NUMERIC_FIELD_PATTERN.test(field);
}

const SIGNED_DEDUCTION_FIELDS = new Set([
  'potongan_upah_kotor_total',
  'total_potongan',
  'total_potongan_bersih',
]);

function isGrossKoreksiField(field = '') {
  if (!field || field === 'koreksi_hk') return false;
  return field === 'pot_koreksi'
    || field.startsWith('koreksi_')
    || field.startsWith('potongan_upah_kotor');
}

export function isSignedPayrollDeductionField(field = '') {
  if (!field) return false;
  if (SIGNED_DEDUCTION_FIELDS.has(field) || isGrossKoreksiField(field)) return true;
  if (field === 'total_pendapatan_lainnya_pengurang') return true;
  if (field.startsWith('pendapatan_') && field.endsWith(DEDUCTION_SUFFIX)) return true;
  if (field === 'premi_pph' || field === 'pot_premi_pph') return false;
  if (field.includes('_maj') || field.includes('majikan')) return false;
  if (field.endsWith('_total') || field === 'pot_bpjs_pekerja_total') return false;
  if (field.startsWith('potongan_')) return true;
  return field.startsWith('pot_') && !field.startsWith('pot_koreksi');
}

export function resolveGrandTotalSourceField(field = '') {
  if (field === 'total_pendapatan_lainnya_pengurang') {
    return 'total_pendapatan_lainnya';
  }

  if (field.endsWith(DEDUCTION_SUFFIX)) {
    return field.slice(0, -DEDUCTION_SUFFIX.length);
  }

  if (field.startsWith('taxable_')) {
    return field.replace(/^taxable_/, '');
  }

  return field;
}

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isEmployeeRow = (row) => {
  if (!row || typeof row !== 'object') return false;
  if (row.type === 'employee') return true;
  if (row.type === 'gang_header' || row.type === 'gang_total') return false;
  if (row.isHeader || row.isTotal) return false;
  return true;
};

const isSubtotalRow = (row) => {
  if (!row || typeof row !== 'object') return false;
  return row.type === 'gang_total' || row.type === 'group_total' || row.isSubtotal === true;
};

function sumRowsByField(rows, field, { roundEachRow = false } = {}) {
  const total = rows.reduce((sum, row) => {
    const value = Number(row?.[field] || 0);
    return sum + (roundEachRow ? roundPayrollTotal(value) : value);
  }, 0);
  return roundPayrollTotal(total);
}

function rowsHaveNumericField(rows, field) {
  return rows.some(row => toNumberOrNull(row?.[field]) !== null);
}

export function resolveGrandTotalNumericValue({
  grandTotal = {},
  rows = [],
  field = '',
  preferRows = false,
  preferSubtotalRows = false,
}) {
  if (isPayrollTotalDisplayOnlyField(field)) return 0;

  const sourceField = resolveGrandTotalSourceField(field);
  const sourceRows = Array.isArray(rows) ? rows : [];
  const employeeRows = sourceRows.filter(isEmployeeRow);
  const subtotalRows = sourceRows.filter(isSubtotalRow);

  if (preferRows && employeeRows.length > 0 && rowsHaveNumericField(employeeRows, sourceField)) {
    return sumRowsByField(employeeRows, sourceField);
  }

  if (preferSubtotalRows && subtotalRows.length > 0) {
    return sumRowsByField(subtotalRows, sourceField, { roundEachRow: true });
  }

  const direct = toNumberOrNull(grandTotal[field]);
  if (direct !== null) return roundPayrollTotal(direct);

  const aliased = toNumberOrNull(grandTotal[sourceField]);
  if (aliased !== null) return roundPayrollTotal(aliased);

  if (employeeRows.length === 0) return 0;

  return sumRowsByField(employeeRows, sourceField);
}
