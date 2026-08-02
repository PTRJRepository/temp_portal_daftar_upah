import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('exceljs', () => ({
  default: { Workbook: class Workbook {} },
}));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

import {
  assertPayrollExportUiParity,
  buildPayrollExportSheetModel,
  buildPayrollExportColumns,
  buildPayrollWorkbookSheetModels,
  formatPayrollExportCellValue,
  resolvePayrollWorkbookSheetVariants,
} from './exportPayrollToExcel';

const source = readFileSync(new URL('./exportPayrollToExcel.js', import.meta.url), 'utf8');

describe('buildPayrollExportColumns', () => {
  it('uses portal columns without appending raw row fields', () => {
    const rows = [
      {
        type: 'employee',
        nama: 'Sari',
        pot_pph21: 12000,
        pph21_ter: 18000,
        status_ptkp: 'K/1',
        manual_adjustment_metadata: { premi_pruning: { source: 'manual_adjustment' } },
      },
    ];
    const columnDefs = [
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'pot_pph21', headers: ['POTONGAN', null, null, 'PPH21'], w: 90 },
    ];

    const fields = buildPayrollExportColumns(rows, columnDefs).map((col) => col.field);

    expect(fields).toEqual(['nama', 'pot_pph21']);
  });

  it('keeps Daftar Upah detail columns including tax details', () => {
    const columnDefs = [
      { field: 'status_ptkp', headers: ['PAJAK', null, null, 'PTKP'], w: 80 },
      { field: 'kategori_ter', headers: ['PAJAK', null, null, 'TER'], w: 55 },
      { field: 'penghasilan_bruto', headers: ['PAJAK', null, null, 'BRUTO'], w: 110 },
      { field: 'tarif_pajak_ter', headers: ['PAJAK', null, null, 'TER (%)'], w: 80 },
      { field: 'pph21_ter', headers: ['PAJAK', null, null, 'PPH21 TER'], w: 95 },
      { field: 'premi_pph', headers: ['POTONGAN', null, null, 'PREMI PPH (+)'], w: 90 },
      { field: 'taxable_pendapatan_lainnya', headers: ['PAJAK', 'OBJEK', null, 'TOTAL'], w: 85 },
      { field: 'pot_pph21', headers: ['POTONGAN', null, null, 'PPH21'], w: 90 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'TOTAL'], w: 110 },
    ];

    const fields = buildPayrollExportColumns([], columnDefs).map((col) => col.field);

    expect(fields).toEqual([
      'status_ptkp',
      'kategori_ter',
      'penghasilan_bruto',
      'tarif_pajak_ter',
      'pph21_ter',
      'premi_pph',
      'taxable_pendapatan_lainnya',
      'pot_pph21',
      'upah_bersih',
    ]);
  });

  it('adds controlled other-income detail columns before the total column', () => {
    const rows = [
      {
        type: 'employee',
        nama: 'Sari',
        pendapatan_thr: 500000,
        pendapatan_kontan: 125000,
        total_pendapatan_lainnya: 625000,
        taxable_pendapatan_thr: 500000,
      },
    ];
    const columnDefs = [
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'TOTAL'], w: 110 },
    ];

    const columns = buildPayrollExportColumns(rows, columnDefs);

    expect(columns.map((col) => col.field)).toEqual([
      'nama',
      'pendapatan_thr',
      'pendapatan_kontan',
      'total_pendapatan_lainnya',
      'upah_bersih',
    ]);
    expect(columns.find((col) => col.field === 'pendapatan_thr')?.headers).toEqual([
      'PENDAPATAN LAINNYA',
      'URAIAN',
      null,
      'THR (+)',
    ]);
    expect(columns.find((col) => col.field === 'pendapatan_kontan')?.headers[3]).toBe('KONTANAN (+)');
  });

  it('keeps total pendapatan lainnya when only later employee rows have values', () => {
    const rows = [
      { type: 'employee', emp_code: 'A001', nama: 'Sari', total_pendapatan_lainnya: 0 },
      { type: 'employee', emp_code: 'A002', nama: 'Rina', total_pendapatan_lainnya: 125000 },
    ];
    const columnDefs = [
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'total_premi', headers: ['PREMI', null, null, 'TOTAL'], w: 95 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];

    const fields = buildPayrollExportColumns(rows, columnDefs).map((col) => col.field);

    expect(fields).toContain('total_pendapatan_lainnya');
  });

  it('builds a compact Ringkas version with core columns and other-income details', () => {
    const rows = [
      {
        type: 'employee',
        emp_code: 'A001',
        nama: 'Sari',
        pendapatan_thr: 500000,
        pendapatan_kontan: 125000,
        total_pendapatan_lainnya: 625000,
      },
    ];
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'status_ptkp', headers: ['PAJAK', null, null, 'PTKP'], w: 80 },
      { field: 'hari_kerja', headers: ['ABSENSI', null, null, 'HK'], w: 60 },
      { field: 'gaji_pokok', headers: ['GAJI POKOK', null, null, 'AKTUAL'], w: 90 },
      { field: 'beras_jumlah', headers: ['TUNJANGAN', null, null, 'BERAS'], w: 90 },
      { field: 'total_tunjangan', headers: ['TUNJANGAN', null, null, 'TOTAL'], w: 90 },
      { field: 'total_premi', headers: ['PREMI', null, null, 'TOTAL'], w: 90 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'pot_astek', headers: ['POTONGAN', null, null, 'ASTEK'], w: 90 },
      { field: 'pot_pph21', headers: ['POTONGAN', null, null, 'PPH21'], w: 90 },
      { field: 'total_potongan', headers: ['POTONGAN', null, null, 'TOTAL'], w: 90 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'TOTAL'], w: 110 },
    ];

    const fields = buildPayrollExportColumns(rows, columnDefs, { variant: 'summary' }).map((col) => col.field);

    expect(fields).toEqual([
      'emp_code',
      'nama',
      'hari_kerja',
      'gaji_pokok',
      'total_tunjangan',
      'total_premi',
      'pendapatan_thr',
      'pendapatan_kontan',
      'total_pendapatan_lainnya',
      'pot_astek',
      'pot_pph21',
      'pendapatan_thr_pengurang',
      'pendapatan_kontan_pengurang',
      'total_potongan',
      'upah_bersih',
    ]);
  });

  it('builds a Print report version with identity, payroll, all allowance and premium columns', () => {
    const rows = [
      {
        type: 'employee',
        emp_code: 'A001',
        nama: 'Sari (K2)',
        premi_pruning: 325000,
        pendapatan_thr: 500000,
        pendapatan_kontan: 125000,
        total_pendapatan_lainnya: 625000,
      },
    ];
    const columnDefs = [
      { field: 'no', headers: ['IDENTITAS', null, null, 'NO'], w: 35 },
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'manual_adjustment_action', headers: ['IDENTITAS', null, null, 'MANUAL'], w: 72 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'nik', headers: ['IDENTITAS', null, null, 'NIK'], w: 90 },
      { field: 'status_ptkp', headers: ['PAJAK', null, null, 'PTKP'], w: 80 },
      { field: 'gaji_pokok_aktual', headers: ['GAJI', null, null, 'GP AKTUAL'], w: 95 },
      { field: 'gaji_pokok_ideal', headers: ['GAJI', null, null, 'GP IDEAL'], w: 85 },
      { field: 'koreksi_hk', headers: ['GAJI', null, null, 'KOR. HK'], w: 85 },
      { field: 'beras_rate', headers: ['TUNJANGAN', 'BERAS', null, 'RATE'], w: 60 },
      { field: 'beras_jumlah', headers: ['TUNJANGAN', 'BERAS', null, 'JUMLAH'], w: 80 },
      { field: 'jabatan_jumlah', headers: ['TUNJANGAN', 'JABATAN', null, 'JUMLAH'], w: 80 },
      { field: 'masa_kerja_jumlah', headers: ['TUNJANGAN', 'MASA KERJA', null, 'JUMLAH'], w: 80 },
      { field: 'lembur_jumlah', headers: ['TUNJANGAN', 'LEMBUR', null, 'JUMLAH'], w: 80 },
      { field: 'total_tunjangan', headers: ['TUNJANGAN', null, null, 'TOTAL'], w: 95 },
      { field: 'premi_brondol', headers: ['PREMI', null, null, 'BRONDOL'], w: 80 },
      { field: 'premi_pruning', headers: ['PREMI', null, null, 'PRUNING'], w: 90 },
      { field: 'total_premi', headers: ['PREMI', null, null, 'TOTAL'], w: 95 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'jumlah_upah_kotor', headers: ['UPAH KOTOR', null, null, 'JUMLAH'], w: 118 },
      { field: 'pot_astek', headers: ['POTONGAN', null, null, 'ASTEK'], w: 75 },
      { field: 'pot_spsi', headers: ['POTONGAN', null, null, 'SPSI'], w: 86 },
      { field: 'pot_pph21', headers: ['POTONGAN', null, null, 'PPH21'], w: 86 },
      { field: 'premi_pph', headers: ['POTONGAN', null, null, 'PREMI PPH'], w: 90 },
      { field: 'total_potongan_bersih', headers: ['POTONGAN', null, null, 'TOTAL'], w: 100 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];

    const fields = buildPayrollExportColumns(rows, columnDefs, { variant: 'print' }).map((col) => col.field);

    expect(fields).toEqual([
      'emp_code',
      'nama',
      'gaji_pokok_aktual',
      'gaji_pokok_ideal',
      'koreksi_hk',
      'beras_jumlah',
      'jabatan_jumlah',
      'masa_kerja_jumlah',
      'lembur_jumlah',
      'total_tunjangan',
      'premi_brondol',
      'premi_pruning',
      'total_premi',
      'pendapatan_thr',
      'pendapatan_kontan',
      'total_pendapatan_lainnya',
      'jumlah_upah_kotor',
      'pot_astek',
      'pot_spsi',
      'pot_pph21',
      'premi_pph',
      'pendapatan_thr_pengurang',
      'pendapatan_kontan_pengurang',
      'total_potongan_bersih',
      'upah_bersih',
    ]);
  });

  it('cleans parenthesized employee name details for Print export cells', () => {
    const value = formatPayrollExportCellValue(
      { type: 'employee', nama: 'Sari   (K2 Mandor)  Lestari (OLD)' },
      { field: 'nama' },
      'print'
    );

    expect(value).toBe('Sari Lestari');
  });

  it('expands gross breakdowns and exports after-gross other-income deductions as detail columns', () => {
    const rows = [
      {
        type: 'employee',
        nama: 'Sari',
        gaji_pokok_aktual: 1000000,
        total_tunjangan: 200000,
        total_premi: 300000,
        pendapatan_thr: 500000,
        pendapatan_kontan: 125000,
        pendapatan_bonus: 75000,
        total_pendapatan_lainnya: 700000,
        total_pendapatan_lainnya_pengurang: 700000,
        potongan_upah_kotor_total: 50000,
        jumlah_upah_kotor: 2150000,
      },
    ];
    const columnDefs = [
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'jumlah_upah_kotor', headers: ['UPAH KOTOR', null, null, 'JUMLAH'], w: 118 },
      { field: 'total_pendapatan_lainnya_pengurang', headers: ['POTONGAN UPAH BERSIH', 'SETELAH UPAH KOTOR', null, 'PEND. LAIN (-)'], w: 90 },
      { field: 'total_potongan', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL'], w: 90 },
    ];

    const columns = buildPayrollExportColumns(rows, columnDefs);
    const fields = columns.map((col) => col.field);

    expect(fields).toEqual([
      'nama',
      'pendapatan_thr',
      'pendapatan_kontan',
      'pendapatan_bonus',
      'total_pendapatan_lainnya',
      'gaji_pokok',
      'total_tunjangan',
      'total_premi',
      'potongan_upah_kotor_total',
      'jumlah_upah_kotor',
      'total_pendapatan_lainnya_pengurang',
      'pendapatan_thr_pengurang',
      'pendapatan_kontan_pengurang',
      'pendapatan_bonus_pengurang',
      'total_potongan',
    ]);
    expect(columns.find((col) => col.field === 'pendapatan_bonus')?.headers).toEqual([
      'PENDAPATAN LAINNYA',
      'URAIAN',
      null,
      'PENDAPATAN BONUS (+)',
    ]);
    expect(columns.find((col) => col.field === 'pendapatan_bonus_pengurang')?.headers).toEqual([
      'POTONGAN UPAH BERSIH',
      'PENDAPATAN LAINNYA',
      null,
      'PENDAPATAN BONUS (-)',
    ]);
  });

  it('exports other-income deduction cells from their source income values', () => {
    const row = {
      type: 'employee',
      pendapatan_thr: 500000,
      other_incomes: [{ type: 'KONTAN', name: 'Kontan Manual', amount: 125000 }],
      total_pendapatan_lainnya: 625000,
    };

    expect(formatPayrollExportCellValue(row, { field: 'pendapatan_thr_pengurang' })).toBe(-500000);
    expect(formatPayrollExportCellValue(row, { field: 'pendapatan_kontan_pengurang' })).toBe(-125000);
    expect(formatPayrollExportCellValue(row, { field: 'total_pendapatan_lainnya_pengurang' })).toBe(-625000);
  });

  it('exports net deduction cells as negative values so formulas can add them', () => {
    expect(formatPayrollExportCellValue({ pot_spsi: 20000 }, { field: 'pot_spsi' })).toBe(-20000);
    expect(formatPayrollExportCellValue({ pot_pph21: -30000 }, { field: 'pot_pph21' })).toBe(-30000);
    expect(formatPayrollExportCellValue({ total_potongan_bersih: 50000 }, { field: 'total_potongan_bersih' })).toBe(-50000);
  });

  it('exports koreksi gross deductions as negative values even when source is positive or negative', () => {
    expect(formatPayrollExportCellValue({ pot_koreksi: 10000 }, { field: 'pot_koreksi' })).toBe(-10000);
    expect(formatPayrollExportCellValue({ koreksi_denda_panen: -10000 }, { field: 'koreksi_denda_panen' })).toBe(-10000);
    expect(formatPayrollExportCellValue({ potongan_upah_kotor_total: 10000 }, { field: 'potongan_upah_kotor_total' })).toBe(-10000);
  });

  it('builds gross-deduction other-income details from other_incomes arrays', () => {
    const rows = [
      {
        type: 'employee',
        nama: 'Sari',
        other_incomes: [
          { type: 'THR', name: 'THR', amount: 500000 },
          { type: 'KONTAN', name: 'Kontan Manual', amount: 125000 },
          { type: 'BONUS', name: 'Bonus Produksi', amount: 75000 },
        ],
        total_pendapatan_lainnya: 700000,
        jumlah_upah_kotor: 1700000,
      },
    ];
    const columnDefs = [
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'jumlah_upah_kotor', headers: ['UPAH KOTOR', null, null, 'JUMLAH'], w: 118 },
      { field: 'total_potongan', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL'], w: 90 },
    ];

    const columns = buildPayrollExportColumns(rows, columnDefs);
    const fields = columns.map((col) => col.field);

    expect(fields).toEqual([
      'nama',
      'pendapatan_thr',
      'pendapatan_kontan',
      'pendapatan_bonus',
      'total_pendapatan_lainnya',
      'jumlah_upah_kotor',
      'pendapatan_thr_pengurang',
      'pendapatan_kontan_pengurang',
      'pendapatan_bonus_pengurang',
      'total_potongan',
    ]);
  });

  it('canonicalizes exgratia into bonus columns in the browser Daftar Upah export', () => {
    const rows = [
      {
        type: 'employee',
        nama: 'Rina',
        other_incomes: [
          { type: 'BONUS', name: 'Bonus Produksi', amount: 75000 },
          { type: 'EXGRATIA', name: 'Exgratia', amount: 125000 },
        ],
        total_pendapatan_lainnya: 200000,
        jumlah_upah_kotor: 1200000,
      },
    ];
    const columnDefs = [
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'jumlah_upah_kotor', headers: ['UPAH KOTOR', null, null, 'JUMLAH'], w: 118 },
      { field: 'total_potongan', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL'], w: 90 },
    ];

    const columns = buildPayrollExportColumns(rows, columnDefs);
    const fields = columns.map((col) => col.field);

    expect(fields).toContain('pendapatan_bonus');
    expect(fields).toContain('pendapatan_bonus_pengurang');
    expect(fields).not.toContain('pendapatan_exgratia');
    expect(fields).not.toContain('pendapatan_exgratia_pengurang');
    expect(formatPayrollExportCellValue(rows[0], { field: 'pendapatan_bonus' })).toBe(200000);
    expect(formatPayrollExportCellValue(rows[0], { field: 'pendapatan_bonus_pengurang' })).toBe(-200000);
  });

  it('keeps parity-critical values from the UI source in every workbook sheet model', () => {
    const rows = [
      { type: 'gang_header', gang_code: 'A01' },
      {
        type: 'employee',
        emp_code: 'A001',
        nik: 'N001',
        nama: 'Sari',
        gaji_pokok_aktual: 1000000,
        total_tunjangan: 200000,
        total_premi: 300000,
        pendapatan_thr: 500000,
        pendapatan_kontan: 125000,
        total_pendapatan_lainnya: 625000,
        potongan_upah_kotor_total: 50000,
        jumlah_upah_kotor: 2075000,
        pot_astek: 80000,
        pot_bpjs_kesehatan_pekerja: 40000,
        pot_bpjs_pensiun_pekerja: 40000,
        pot_spsi: 4000,
        pot_pph21: 30000,
        premi_pph: 10000,
        total_potongan: 819000,
        total_potongan_bersih: 829000,
        upah_bersih: 1256000,
      },
      {
        type: 'gang_total',
        gang_code: 'A01',
        total_pendapatan_lainnya: 625000,
        jumlah_upah_kotor: 2075000,
        total_potongan: 819000,
        total_potongan_bersih: 829000,
        upah_bersih: 1256000,
      },
    ];
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'gaji_pokok_aktual', headers: ['GAJI', null, null, 'GP AKTUAL'], w: 95 },
      { field: 'total_tunjangan', headers: ['TUNJANGAN', null, null, 'TOTAL'], w: 95 },
      { field: 'total_premi', headers: ['PREMI', null, null, 'TOTAL'], w: 95 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'potongan_upah_kotor_total', headers: ['POTONGAN UPAH KOTOR', null, null, 'TOTAL'], w: 95 },
      { field: 'jumlah_upah_kotor', headers: ['UPAH KOTOR', null, null, 'JUMLAH'], w: 118 },
      { field: 'pot_astek', headers: ['POTONGAN UPAH BERSIH', 'CARUMAN', 'ASTEK', 'PEK.'], w: 75 },
      { field: 'pot_bpjs_kesehatan_pekerja', headers: ['POTONGAN UPAH BERSIH', 'CARUMAN', 'BPJS KES', 'PEK.'], w: 75 },
      { field: 'pot_bpjs_pensiun_pekerja', headers: ['POTONGAN UPAH BERSIH', 'CARUMAN', 'BPJS PEN', 'PEK.'], w: 75 },
      { field: 'pot_spsi', headers: ['POTONGAN UPAH BERSIH', null, null, 'SPSI'], w: 86 },
      { field: 'pot_pph21', headers: ['POTONGAN UPAH BERSIH', null, null, 'PPH21'], w: 86 },
      { field: 'premi_pph', headers: ['POTONGAN UPAH BERSIH', null, null, 'PREMI PPH'], w: 90 },
      { field: 'total_potongan', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL'], w: 100 },
      { field: 'total_potongan_bersih', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL BERSIH'], w: 100 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];
    const models = buildPayrollWorkbookSheetModels(rows, columnDefs, rows[2], {
      division: 'P1A',
      gangCode: 'A01',
      month: 6,
      year: 2026,
    });

    for (const model of models) {
      const employee = model.rows.find((row) => row.type === 'employee');
      expect(employee.valuesByField.upah_bersih).toBe(1256000);
      if (employee.valuesByField.jumlah_upah_kotor !== undefined) {
        expect(employee.valuesByField.jumlah_upah_kotor).toBe(2075000);
      }
      if (employee.valuesByField.total_potongan_bersih !== undefined) {
        expect(employee.valuesByField.total_potongan_bersih).toBe(-829000);
      }
      expect(assertPayrollExportUiParity(model, rows)).toBe(true);
    }
  });

  it('fails loudly when a sheet model diverges from the UI source value', () => {
    const rows = [{ type: 'employee', emp_code: 'A001', nama: 'Sari', upah_bersih: 1256000 }];
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];
    const model = buildPayrollExportSheetModel(rows, columnDefs, null, {}, 'detail');
    model.rows[0].valuesByField.upah_bersih = 1;

    expect(() => assertPayrollExportUiParity(model, rows)).toThrow(/Detail\/A001\/upah_bersih: expected 1256000, actual 1/);
  });

  it('fails loudly when exported gang totals diverge from the UI source value', () => {
    const rows = [
      { type: 'gang_header', gang_code: 'A01' },
      { type: 'employee', emp_code: 'A001', nama: 'Sari', gang_code: 'A01', upah_bersih: 1256000 },
      { type: 'gang_total', gang_code: 'A01', nama: 'TOTAL GANG A01', upah_bersih: 1256000 },
    ];
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];
    const model = buildPayrollExportSheetModel(rows, columnDefs, null, {}, 'detail');
    const gangTotal = model.rows.find((row) => row.type === 'gang_total');
    gangTotal.valuesByField.upah_bersih = 1;

    expect(() => assertPayrollExportUiParity(model, rows)).toThrow(/Detail\/A01\/upah_bersih: expected 1256000, actual 1/);
  });

  it('uses row sums for grand totals when the UI footer is showing pending edit values', () => {
    const rows = [
      { type: 'employee', emp_code: 'A001', nama: 'Sari', upah_bersih: 1256000, total_potongan_bersih: 829000 },
      { type: 'employee', emp_code: 'A002', nama: 'Rina', upah_bersih: 2440000, total_potongan_bersih: 60000 },
    ];
    const staleBackendGrandTotal = {
      upah_bersih: 1,
      total_potongan_bersih: 2,
    };
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'total_potongan_bersih', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL BERSIH'], w: 100 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];

    const model = buildPayrollExportSheetModel(
      rows,
      columnDefs,
      staleBackendGrandTotal,
      { preferRowGrandTotals: true },
      'detail'
    );

    expect(model.grandTotalRow.valuesByField.upah_bersih).toBe(3696000);
    expect(model.grandTotalRow.valuesByField.total_potongan_bersih).toBe(-889000);
  });

  it('uses backend grand total over displayed subtotal rows by default', () => {
    const rows = [
      { type: 'gang_header', gang_code: 'G1' },
      { type: 'employee', emp_code: 'A001', nama: 'Sari', upah_bersih: 1000.4 },
      { type: 'gang_total', gang_code: 'G1', upah_bersih: 1001.4 },
      { type: 'gang_header', gang_code: 'G2' },
      { type: 'employee', emp_code: 'A002', nama: 'Rina', upah_bersih: 1000.4 },
      { type: 'gang_total', gang_code: 'G2', upah_bersih: 1001.4 },
    ];
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];

    const model = buildPayrollExportSheetModel(
      rows,
      columnDefs,
      { upah_bersih: 3000 },
      {},
      'detail'
    );

    expect(model.grandTotalRow.valuesByField.upah_bersih).toBe(3000);
  });

  it('can explicitly use displayed subtotal rows for grand totals', () => {
    const rows = [
      { type: 'gang_header', gang_code: 'G1' },
      { type: 'employee', emp_code: 'A001', nama: 'Sari', upah_bersih: 1000.4 },
      { type: 'gang_total', gang_code: 'G1', upah_bersih: 1001.4 },
      { type: 'gang_header', gang_code: 'G2' },
      { type: 'employee', emp_code: 'A002', nama: 'Rina', upah_bersih: 1000.4 },
      { type: 'gang_total', gang_code: 'G2', upah_bersih: 1001.4 },
    ];
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];

    const model = buildPayrollExportSheetModel(
      rows,
      columnDefs,
      { upah_bersih: 3000 },
      { preferSubtotalGrandTotals: true },
      'detail'
    );

    expect(model.grandTotalRow.valuesByField.upah_bersih).toBe(2002);
  });

  it('uses sheet models and a parity guard instead of recalculating exported employee rows', () => {
    expect(source).toContain('function buildRowFormulaForField');
    expect(source).toContain('function isSelectedNetDeductionFormulaField');
    expect(source).toContain('function numericRef(ref)');
    expect(source).toContain('refs.filter(Boolean).map(numericRef)');
    expect(source).toContain("field === 'total_potongan' || field === 'total_potongan_bersih'");
    expect(source).toContain("field.includes('_maj') || field.includes('majikan')");
    expect(source).toContain("field.endsWith('_total') || field === 'pot_bpjs_pekerja_total'");
    expect(source).toContain("field === 'total_potongan_bersih'");
    expect(source).toContain('`+${numericRef(premiPphRef)}`');
    expect(source).toContain('`+${numericRef(subtractRef)}`');
    expect(source).toContain("`${numericRef(grossRef) || '0'}+${numericRef(deductionRef) || '0'}`");
    expect(source).not.toContain('-ABS(');
    expect(source).not.toContain('`-${numericRef(subtractRef)}`');
    expect(source).not.toContain("`${numericRef(grossRef) || '0'}-${numericRef(deductionRef) || '0'}`");
    expect(source).toContain('buildPayrollWorkbookSheetModels(rows, columnDefs, grandTotal, meta)');
    expect(source).toContain('assertPayrollExportUiParity(sheetModel, rows);');
    expect(source).not.toContain('applyEmployeeRowFormulas(excelRow, enhancedColumnDefs, columnIndexMap);');
    expect(source).not.toContain('buildTotalFormulaForColumn(col.field, enhancedColumnDefs, columnIndexMap, currentGroupEmployeeRows);');
    expect(source).not.toContain('buildTotalFormulaForColumn(col.field, enhancedColumnDefs, columnIndexMap, employeeExcelRows);');
  });

  it('uses one workbook with Detail as the first sheet, then Ringkas and Print', () => {
    expect(resolvePayrollWorkbookSheetVariants()).toEqual(['detail', 'summary', 'print']);
  });

  it('includes astek and BPJS worker columns in print and summary so total_potongan matches detail', () => {
    const rows = [{
      type: 'employee',
      pot_astek: 80000,
      pot_bpjs_kesehatan_pekerja: 40000,
      pot_bpjs_pensiun_pekerja: 40000,
      pot_spsi: 4000,
      pot_pph21: 0,
      total_pendapatan_lainnya: 0,
    }];
    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'jumlah_upah_kotor', headers: ['UPAH KOTOR', null, null, 'JUMLAH'], w: 90 },
      { field: 'pot_astek', headers: ['POTONGAN UPAH BERSIH', 'CARUMAN', 'ASTEK', 'PEK.'], w: 75 },
      { field: 'pot_bpjs_kesehatan_pekerja', headers: ['POTONGAN UPAH BERSIH', 'CARUMAN', 'BPJS KES', 'PEK.'], w: 75 },
      { field: 'pot_bpjs_pensiun_pekerja', headers: ['POTONGAN UPAH BERSIH', 'CARUMAN', 'BPJS PEN', 'PEK.'], w: 75 },
      { field: 'pot_spsi', headers: ['POTONGAN UPAH BERSIH', null, null, 'SPSI'], w: 86 },
      { field: 'pot_pph21', headers: ['POTONGAN UPAH BERSIH', null, null, 'PPH21'], w: 86 },
      { field: 'total_potongan', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL'], w: 100 },
    ];

    for (const variant of ['detail', 'summary', 'print']) {
      const fields = buildPayrollExportColumns(rows, columnDefs, { variant }).map((col) => col.field);
      expect(fields).toContain('pot_astek');
      expect(fields).toContain('pot_bpjs_kesehatan_pekerja');
      expect(fields).toContain('pot_bpjs_pensiun_pekerja');
    }
  });
});
