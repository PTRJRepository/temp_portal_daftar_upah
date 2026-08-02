import { describe, expect, it } from 'vitest';
import { PayrollAggregator } from './PayrollAggregator';

describe('PayrollAggregator totals', () => {
  it('does not total automatic koreksi HK because it is display-only', () => {
    const totals = PayrollAggregator.calculateGrandTotal([
      { type: 'employee', jumlah_hk: 24, koreksi_hk: -100000 },
      { type: 'employee', jumlah_hk: 23, koreksi_hk: 25000 },
    ]);

    expect(totals.jumlah_hk).toBe(47);
    expect(totals.koreksi_hk).toBeUndefined();
  });

  it('filters active employees by jumlah_hk to match backend payroll totals', () => {
    const rows = PayrollAggregator.flattenData({
      gangs: [
        {
          gang_code: 'A1',
          employees: [
            { nama: 'Included', jumlah_hk: 1, hari_kerja: 0, gaji_pokok: 100000 },
            { nama: 'Excluded', jumlah_hk: 0, hari_kerja: 1, gaji_pokok: 999999 },
          ],
        },
      ],
    });

    expect(rows.map((row) => row.nama)).toEqual(['Included']);
  });

  it('does not show automatic HK correction as potongan upah kotor', () => {
    const row = PayrollAggregator.calculateEmployeeFields({
      jumlah_hk: 24,
      gaji_pokok_aktual: 900_000,
      koreksi_hk: -100_000,
      pot_koreksi: 100_000,
      potongan_upah_kotor_total: 100_000,
      jumlah_upah_kotor: 900_000,
    });

    expect(row.potongan_upah_kotor_total).toBe(0);
    expect(row.jumlah_upah_kotor).toBe(900_000);
  });

  it('keeps canonical grand total and reconciles displayed gang breakdowns', () => {
    const rows = [
      { type: 'employee', gang_code: 'G1', jumlah_hk: 1, upah_bersih: 1.4 },
      { type: 'employee', gang_code: 'G2', jumlah_hk: 1, upah_bersih: 1.4 },
    ];

    const rawGrandTotal = PayrollAggregator.calculateGrandTotal(rows);
    const displayedGangTotals = [
      PayrollAggregator.calculateGangTotals('G1', rows),
      PayrollAggregator.calculateGangTotals('G2', rows),
    ];
    const displayedGrandTotalBeforeReconcile = PayrollAggregator.calculateGrandTotalFromGangTotals(displayedGangTotals);
    const reconciledGangTotals = PayrollAggregator.reconcileGangTotalsToGrandTotal(displayedGangTotals, rawGrandTotal);
    const displayedGrandTotalAfterReconcile = PayrollAggregator.calculateGrandTotalFromGangTotals(reconciledGangTotals);

    expect(Math.round(rawGrandTotal.upah_bersih)).toBe(3);
    expect(displayedGrandTotalBeforeReconcile.upah_bersih).toBe(2);
    expect(displayedGrandTotalAfterReconcile.upah_bersih).toBe(3);
  });

  it('rounds displayed subtotal sums with floating tolerance', () => {
    const displayedGrandTotal = PayrollAggregator.calculateGrandTotalFromGangTotals([
      { upah_bersih: 1_038_594_760.4999998 },
    ]);

    expect(displayedGrandTotal.upah_bersih).toBe(1_038_594_761);
  });

  it('builds a balanced display ledger from employees to gang totals and grand total', () => {
    const rows = [
      { type: 'gang_header', gang_code: 'G1' },
      { type: 'employee', gang_code: 'G1', emp_code: 'A001', jumlah_hk: 1, upah_bersih: 1.4 },
      { type: 'gang_total', gang_code: 'G1', id: 'TOTAL_G1', nama: 'TOTAL GANG G1', emp_code: '1 Kary.', upah_bersih: 1 },
      { type: 'gang_header', gang_code: 'G2' },
      { type: 'employee', gang_code: 'G2', emp_code: 'A002', jumlah_hk: 1, upah_bersih: 1.4 },
      { type: 'gang_total', gang_code: 'G2', id: 'TOTAL_G2', nama: 'TOTAL GANG G2', emp_code: '1 Kary.', upah_bersih: 1 },
    ];

    const reconciledRows = PayrollAggregator.buildDisplayLedgerRows(rows, { upah_bersih: 3 }, {
      allocateToGrandTotal: true,
    });
    const displayedEmployees = reconciledRows.filter(row => row.type === 'employee');
    const displayedGrandTotal = PayrollAggregator.calculateGrandTotalFromGangTotals(
      reconciledRows.filter(row => row.type === 'gang_total')
    );

    expect(displayedEmployees.reduce((sum, row) => sum + row.upah_bersih, 0)).toBe(3);
    expect(displayedGrandTotal.upah_bersih).toBe(3);
    expect(reconciledRows[2]).toMatchObject({
      type: 'gang_total',
      gang_code: 'G1',
      id: 'TOTAL_G1',
      nama: 'TOTAL GANG G1',
      emp_code: '1 Kary.',
    });
  });

  it('builds displayed gang total rows from employee rows when edits are pending', () => {
    const rows = [
      { type: 'gang_header', gang_code: 'G1' },
      { type: 'employee', gang_code: 'G1', emp_code: 'A001', jumlah_hk: 1, upah_bersih: 1500 },
      { type: 'gang_total', gang_code: 'G1', id: 'TOTAL_G1', nama: 'TOTAL GANG G1', emp_code: '1 Kary.', upah_bersih: 1 },
      { type: 'gang_header', gang_code: 'G2' },
      { type: 'employee', gang_code: 'G2', emp_code: 'A002', jumlah_hk: 1, upah_bersih: 2500 },
      { type: 'gang_total', gang_code: 'G2', id: 'TOTAL_G2', nama: 'TOTAL GANG G2', emp_code: '1 Kary.', upah_bersih: 1 },
    ];

    const reconciledRows = PayrollAggregator.buildDisplayLedgerRows(rows);
    const displayedGangTotals = reconciledRows.filter(row => row.type === 'gang_total');
    const displayedGrandTotal = PayrollAggregator.calculateGrandTotalFromGangTotals(displayedGangTotals);

    expect(displayedGangTotals.map(row => row.upah_bersih)).toEqual([1500, 2500]);
    expect(displayedGrandTotal.upah_bersih).toBe(4000);
  });
});
