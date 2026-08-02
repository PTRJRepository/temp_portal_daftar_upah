import { describe, expect, it, vi } from 'vitest';
import { PayrollAggregator } from './PayrollAggregator';
import {
  assertPayrollExportUiParity,
  buildPayrollExportSheetModel,
} from './exportPayrollToExcel';
import { resolveGrandTotalNumericValue } from './payrollGrandTotalValue';

vi.mock('exceljs', () => ({
  default: { Workbook: class Workbook {} },
}));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

const sumRows = (rows, field) => rows.reduce((sum, row) => sum + Number(row?.[field] || 0), 0);

describe('payroll display ledger synchronization', () => {
  it('keeps employee detail, gang totals, footer totals, and Excel export in sync', () => {
    const rawRows = [
      { type: 'gang_header', gang_code: 'G1', id: 'HEADER_G1' },
      {
        type: 'employee',
        gang_code: 'G1',
        emp_code: 'A001',
        nama: 'Sari',
        jumlah_hk: 1,
        jumlah_upah_kotor: 1100.4,
        pendapatan_thr: 50.4,
        total_pendapatan_lainnya: 50.4,
        pot_spsi: 10.4,
        total_potongan_bersih: 100.4,
        upah_bersih: 1000.4,
      },
      {
        type: 'employee',
        gang_code: 'G1',
        emp_code: 'A002',
        nama: 'Rina',
        jumlah_hk: 1,
        jumlah_upah_kotor: 2200.4,
        pendapatan_thr: 60.4,
        total_pendapatan_lainnya: 60.4,
        pot_spsi: 20.4,
        total_potongan_bersih: 200.4,
        upah_bersih: 2000.4,
      },
      {
        type: 'gang_total',
        gang_code: 'G1',
        id: 'TOTAL_G1',
        nama: 'TOTAL GANG G1',
        emp_code: '2 Kary.',
        jumlah_upah_kotor: 0,
        pendapatan_thr: 0,
        total_pendapatan_lainnya: 0,
        pot_spsi: 0,
        total_potongan_bersih: 0,
        upah_bersih: 0,
      },
      { type: 'gang_header', gang_code: 'G2', id: 'HEADER_G2' },
      {
        type: 'employee',
        gang_code: 'G2',
        emp_code: 'A003',
        nama: 'Dewi',
        jumlah_hk: 1,
        jumlah_upah_kotor: 3300.4,
        pendapatan_thr: 70.4,
        total_pendapatan_lainnya: 70.4,
        pot_spsi: 30.4,
        total_potongan_bersih: 300.4,
        upah_bersih: 3000.4,
      },
      {
        type: 'gang_total',
        gang_code: 'G2',
        id: 'TOTAL_G2',
        nama: 'TOTAL GANG G2',
        emp_code: '1 Kary.',
        jumlah_upah_kotor: 0,
        pendapatan_thr: 0,
        total_pendapatan_lainnya: 0,
        pot_spsi: 0,
        total_potongan_bersih: 0,
        upah_bersih: 0,
      },
    ];
    const grandTotal = {
      nama: 'GRAND TOTAL',
      jumlah_upah_kotor: 6601,
      pendapatan_thr: 181,
      total_pendapatan_lainnya: 181,
      pot_spsi: 61,
      total_potongan_bersih: 601,
      upah_bersih: 6001,
    };

    const ledgerRows = PayrollAggregator.buildDisplayLedgerRows(rawRows, grandTotal, {
      allocateToGrandTotal: true,
    });
    const employeeRows = ledgerRows.filter((row) => row.type === 'employee');
    const gangTotalRows = ledgerRows.filter((row) => row.type === 'gang_total');
    const fields = [
      'jumlah_upah_kotor',
      'pendapatan_thr',
      'total_pendapatan_lainnya',
      'pot_spsi',
      'total_potongan_bersih',
      'upah_bersih',
    ];

    for (const field of fields) {
      expect(sumRows(employeeRows, field)).toBe(grandTotal[field]);
      expect(sumRows(gangTotalRows, field)).toBe(grandTotal[field]);
      expect(resolveGrandTotalNumericValue({
        grandTotal,
        rows: ledgerRows,
        field,
        preferRows: true,
      })).toBe(grandTotal[field]);
    }

    expect(resolveGrandTotalNumericValue({
      grandTotal,
      rows: ledgerRows,
      field: 'pendapatan_thr_pengurang',
      preferRows: true,
    })).toBe(grandTotal.pendapatan_thr);
    expect(resolveGrandTotalNumericValue({
      grandTotal,
      rows: ledgerRows,
      field: 'total_pendapatan_lainnya_pengurang',
      preferRows: true,
    })).toBe(grandTotal.total_pendapatan_lainnya);

    const columnDefs = [
      { field: 'emp_code', headers: ['IDENTITAS', null, null, 'EMP CODE'], w: 90 },
      { field: 'nama', headers: ['IDENTITAS', null, null, 'NAMA'], w: 120 },
      { field: 'jumlah_upah_kotor', headers: ['UPAH KOTOR', null, null, 'JUMLAH'], w: 118 },
      { field: 'pendapatan_thr', headers: ['PENDAPATAN LAINNYA', 'URAIAN', null, 'THR (+)'], w: 96 },
      { field: 'total_pendapatan_lainnya', headers: ['PENDAPATAN LAINNYA', null, null, 'TOTAL (+)'], w: 100 },
      { field: 'pendapatan_thr_pengurang', headers: ['POTONGAN UPAH BERSIH', 'PENDAPATAN LAINNYA', null, 'THR (-)'], w: 90 },
      { field: 'total_pendapatan_lainnya_pengurang', headers: ['POTONGAN UPAH BERSIH', 'PENDAPATAN LAINNYA', null, 'PEND. LAIN (-)'], w: 90 },
      { field: 'pot_spsi', headers: ['POTONGAN UPAH BERSIH', null, null, 'SPSI (-)'], w: 86 },
      { field: 'total_potongan_bersih', headers: ['POTONGAN UPAH BERSIH', null, null, 'TOTAL BERSIH'], w: 100 },
      { field: 'upah_bersih', headers: ['UPAH BERSIH', null, null, 'JUMLAH'], w: 115 },
    ];
    const model = buildPayrollExportSheetModel(
      ledgerRows,
      columnDefs,
      grandTotal,
      { preferRowGrandTotals: true },
      'detail'
    );

    expect(assertPayrollExportUiParity(model, ledgerRows)).toBe(true);
    expect(model.grandTotalRow.valuesByField.jumlah_upah_kotor).toBe(6601);
    expect(model.grandTotalRow.valuesByField.pendapatan_thr).toBe(181);
    expect(model.grandTotalRow.valuesByField.total_pendapatan_lainnya).toBe(181);
    expect(model.grandTotalRow.valuesByField.pendapatan_thr_pengurang).toBe(-181);
    expect(model.grandTotalRow.valuesByField.total_pendapatan_lainnya_pengurang).toBe(-181);
    expect(model.grandTotalRow.valuesByField.pot_spsi).toBe(-61);
    expect(model.grandTotalRow.valuesByField.total_potongan_bersih).toBe(-601);
    expect(model.grandTotalRow.valuesByField.upah_bersih).toBe(6001);

    const exportedGangG2 = model.rows.find((row) => row.type === 'gang_total' && row.sourceRow.gang_code === 'G2');
    expect(exportedGangG2.valuesByField.jumlah_upah_kotor).toBe(3301);
    expect(exportedGangG2.valuesByField.pendapatan_thr).toBe(71);
    expect(exportedGangG2.valuesByField.total_pendapatan_lainnya).toBe(71);
    expect(exportedGangG2.valuesByField.pendapatan_thr_pengurang).toBe(-71);
    expect(exportedGangG2.valuesByField.pot_spsi).toBe(-31);
    expect(exportedGangG2.valuesByField.total_potongan_bersih).toBe(-301);
    expect(exportedGangG2.valuesByField.upah_bersih).toBe(3001);
  });
});
