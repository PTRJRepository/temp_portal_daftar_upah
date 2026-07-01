import { describe, expect, it, vi } from 'vitest';

// Capture cells written to the worksheet so we can assert formula contents
// without a real ExcelJS install (nodejs exceljs import is broken in this env).
const captured = { rows: [] };

function makeCell(rowNum, colNum) {
  return {
    _value: undefined,
    get value() { return this._value; },
    set value(v) {
      this._value = v;
      captured.rows[rowNum] = captured.rows[rowNum] || {};
      captured.rows[rowNum][colNum] = v;
    },
    font: {}, fill: {}, alignment: {}, border: {}, numFmt: null,
  };
}

vi.mock('exceljs', () => {
  const Worksheet = class {
    constructor() { this._rowNum = 0; this._cols = []; this._headerToCol = {}; }
    addRow(values) {
      this._rowNum += 1;
      const row = {
        number: this._rowNum,
        height: 20,
        _cells: {},
        getCell: (idx) => { row._cells[idx] = row._cells[idx] || makeCell(this._rowNum, idx); return row._cells[idx]; },
        eachCell: (cb) => { Object.keys(row._cells).forEach((k, i) => cb(row._cells[k], Number(k))); },
      };
      if (Array.isArray(values)) {
        values.forEach((v, i) => { const c = row.getCell(i + 1); if (v !== undefined && v !== '') c.value = v; });
      }
      // Track header row (row 4) field->col mapping via headerName values
      return row;
    }
    mergeCells() {}
    getColumn(idx) { this._cols[idx] = this._cols[idx] || { width: 12 }; return this._cols[idx]; }
    get views() { return []; }
    set views(v) {}
    get pageSetup() { return {}; }
    set pageSetup(v) {}
  };
  const Workbook = class {
    constructor() { this.creator = ''; this.created = new Date(0); }
    addWorksheet() { this.ws = new Worksheet(); return this.ws; }
    get xlsx() { return { writeBuffer: async () => Buffer.from('x') }; }
  };
  return { default: { Workbook } };
});

vi.mock('file-saver', () => ({ saveAs: (blob) => { captured.blob = blob; } }));

import { exportReportToExcelPro } from './exportReportToExcelPro';

// ponytail: pendapatan_lainnya invariant — additive in jumlah_upah_kotor,
// negated in total_potongan — so it cancels in upah_bersih and intermediate
// totals match backend PayrollCalculator. Upgrade: share formula builder
// with exportPayrollToExcel.

const baseEmployee = {
  type: 'employee',
  EMP_CODE: 'A0001',
  nik: '1101',
  nama: 'TEST EMP',
  hari_kerja: 25,
  jumlah_hk: 25,
  gaji_pokok: 3_000_000,
  beras_jumlah: 200_000,
  jabatan_jumlah: 300_000,
  masa_kerja_jumlah: 100_000,
  lembur_jumlah: 0,
  total_tunjangan: 600_000,
  premi_brondol: 150_000,
  total_premi: 150_000,
  pot_koreksi: 0,
  pot_astek: 60_000,
  pot_bpjs_kesehatan_pekerja: 30_000,
  pot_bpjs_pensiun_pekerja: 30_000,
  pot_spsi: 5_000,
  pot_pph21: 100_000,
  premi_pph: 50_000,
  pendapatan_lainnya: 1_000_000,
  total_pendapatan_lainnya: 1_000_000,
  // Pre-computed totals (backend rows carry these). Must be non-zero so
  // buildExportColumns keeps the columns; formulas still override cell value.
  jumlah_upah_kotor: 4_750_000,
  total_potongan: 1_225_000,
  upah_bersih: 3_575_000,
};

function buildRows(emp) {
  return [
    { type: 'gang_header', gang_code: 'G1' },
    { ...emp },
    { type: 'gang_total', gang_code: 'G1' },
  ];
}

async function captureSheet(rows) {
  captured.rows = [];
  await exportReportToExcelPro(rows, [], { division: 'DME', gangCode: 'ALL', month: 4, year: 2026 });
  return captured.rows;
}

function findHeaderCol(rows, headerText) {
  const headerRow = rows[4] || {};
  let col = -1;
  const target = headerText.toUpperCase();
  for (const [k, v] of Object.entries(headerRow)) {
    if (String(v || '').toUpperCase() === target) col = Number(k);
  }
  return col;
}

function colLetter(colNum) {
  let s = '';
  while (colNum > 0) { const t = (colNum - 1) % 26; s = String.fromCharCode(65 + t) + s; colNum = (colNum - t - 1) / 26; }
  return s;
}

function dataCellFormula(rows, headerText) {
  const col = findHeaderCol(rows, headerText);
  expect(col, `header "${headerText}" not found`).toBeGreaterThan(0);
  // find first data row whose cell at this col is a formula object
  for (let r = 5; r <= Object.keys(rows).length + 5; r++) {
    const row = rows[r] || {};
    const v = row[col];
    if (v && typeof v === 'object' && v.formula) return String(v.formula);
  }
  return '';
}

describe('exportReportToExcelPro — pendapatan_lainnya parity (IMPL-1/IMPL-2)', () => {
  it('jumlah_upah_kotor formula includes pendapatan_lainnya (additive)', async () => {
    const rows = await captureSheet(buildRows(baseEmployee));
    const formula = dataCellFormula(rows, 'UPAH KOTOR');
    const pCol = findHeaderCol(rows, 'PENDAPATAN LAINNYA');
    const letter = colLetter(pCol);
    expect(formula).toContain(`+${letter}`);
  });

  it('total_potongan formula includes pendapatan_lainnya (as pengurang)', async () => {
    const rows = await captureSheet(buildRows(baseEmployee));
    const formula = dataCellFormula(rows, 'TOTAL POTONGAN');
    const pCol = findHeaderCol(rows, 'PENDAPATAN LAINNYA');
    const letter = colLetter(pCol);
    expect(formula).toContain(`-${letter}`);
  });

  it('employee with pendapatan_lainnya=0 still produces valid formulas', async () => {
    const emp = { ...baseEmployee, pendapatan_lainnya: 0, total_pendapatan_lainnya: 0, jumlah_upah_kotor: 3_750_000, total_potongan: 225_000, upah_bersih: 3_575_000 };
    const rows = await captureSheet(buildRows(emp));
    expect(dataCellFormula(rows, 'UPAH KOTOR')).toBeTruthy();
    expect(dataCellFormula(rows, 'TOTAL POTONGAN')).toBeTruthy();
  });
});
