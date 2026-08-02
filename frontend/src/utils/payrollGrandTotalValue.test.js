import { describe, expect, it } from 'vitest';
import {
  isPayrollNumericField,
  isSignedPayrollDeductionField,
  resolveGrandTotalNumericValue,
  resolveGrandTotalSourceField,
} from './payrollGrandTotalValue';

describe('resolveGrandTotalSourceField', () => {
  it('maps deduction suffix field to the source income field', () => {
    expect(resolveGrandTotalSourceField('pendapatan_thr_pengurang')).toBe('pendapatan_thr');
    expect(resolveGrandTotalSourceField('total_pendapatan_lainnya_pengurang')).toBe('total_pendapatan_lainnya');
  });
});

describe('resolveGrandTotalNumericValue', () => {
  it('uses alias field from grand total when direct key is missing', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { pendapatan_thr: 135000 },
      rows: [],
      field: 'pendapatan_thr_pengurang',
    });

    expect(value).toBe(135000);
  });

  it('falls back to summing only employee rows when grand total does not provide the key', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: {},
      rows: [
        { type: 'employee', premi_insentif: 1000 },
        { type: 'employee', premi_insentif: 2500 },
        { type: 'gang_total', premi_insentif: 999999 },
      ],
      field: 'premi_insentif',
    });

    expect(value).toBe(3500);
  });

  it('can prefer live row sum over stale grand total value when edits are pending', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { pendapatan_kontan: 1000 },
      rows: [
        { type: 'employee', pendapatan_kontan: 2500 },
        { type: 'employee', pendapatan_kontan: 1500 },
      ],
      field: 'pendapatan_kontan',
      preferRows: true,
    });

    expect(value).toBe(4000);
  });

  it('can prefer displayed subtotal rows so global totals match grouped breakdown exports', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { upah_bersih: 3000 },
      rows: [
        { type: 'employee', upah_bersih: 1000.4 },
        { type: 'employee', upah_bersih: 1000.4 },
        { type: 'gang_total', upah_bersih: 1001.4 },
        { type: 'gang_total', upah_bersih: 1001.4 },
      ],
      field: 'upah_bersih',
      preferSubtotalRows: true,
    });

    expect(value).toBe(2002);
  });

  it('keeps existing grandTotal priority when subtotal rows are unavailable', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { upah_bersih: 1 },
      rows: [
        { type: 'employee', upah_bersih: 1000.4 },
        { type: 'employee', upah_bersih: 1000.4 },
      ],
      field: 'upah_bersih',
      preferSubtotalRows: true,
    });

    expect(value).toBe(1);
  });

  it('keeps direct grand total priority over displayed subtotal rows by default', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { upah_bersih: 1_038_594_761 },
      rows: [
        { type: 'gang_total', upah_bersih: 1_038_594_760 },
      ],
      field: 'upah_bersih',
    });

    expect(value).toBe(1_038_594_761);
  });

  it('prefers employee rows over subtotal rows when both override flags are enabled', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { upah_bersih: 1 },
      rows: [
        { type: 'employee', upah_bersih: 1500 },
        { type: 'employee', upah_bersih: 2500 },
        { type: 'gang_total', upah_bersih: 9999 },
      ],
      field: 'upah_bersih',
      preferRows: true,
      preferSubtotalRows: true,
    });

    expect(value).toBe(4000);
  });

  it('falls back to direct grand total when preferred rows do not contain the field', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { upah_bersih: 1234 },
      rows: [
        { type: 'employee', emp_code: 'A001', total_premi: 100 },
      ],
      field: 'upah_bersih',
      preferRows: true,
    });

    expect(value).toBe(1234);
  });

  it('rounds direct grand total half-rupiah values with floating tolerance', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { upah_bersih: 1_038_594_760.4999998 },
      rows: [],
      field: 'upah_bersih',
    });

    expect(value).toBe(1_038_594_761);
  });

  it('rounds displayed subtotal rows with floating tolerance', () => {
    const value = resolveGrandTotalNumericValue({
      grandTotal: { upah_bersih: 0 },
      rows: [
        { type: 'gang_total', upah_bersih: 1_038_594_760.4999998 },
      ],
      field: 'upah_bersih',
      preferSubtotalRows: true,
    });

    expect(value).toBe(1_038_594_761);
  });

  it('does not total automatic koreksi HK because it is display-only', () => {
    expect(isPayrollNumericField('koreksi_hk')).toBe(false);
    expect(resolveGrandTotalNumericValue({
      grandTotal: { koreksi_hk: -999999 },
      rows: [
        { type: 'employee', koreksi_hk: -100000 },
        { type: 'employee', koreksi_hk: 25000 },
      ],
      field: 'koreksi_hk',
      preferRows: true,
    })).toBe(0);
  });
});

describe('isPayrollNumericField', () => {
  it('detects known numeric payroll patterns', () => {
    expect(isPayrollNumericField('pendapatan_thr_pengurang')).toBe(true);
    expect(isPayrollNumericField('taxable_pendapatan_lainnya')).toBe(true);
    expect(isPayrollNumericField('nama')).toBe(false);
  });
});

describe('isSignedPayrollDeductionField', () => {
  it('marks payroll deduction fields that must display/export as negative', () => {
    expect(isSignedPayrollDeductionField('pot_spsi')).toBe(true);
    expect(isSignedPayrollDeductionField('pot_pph21')).toBe(true);
    expect(isSignedPayrollDeductionField('potongan_lainnya')).toBe(true);
    expect(isSignedPayrollDeductionField('pendapatan_thr_pengurang')).toBe(true);
    expect(isSignedPayrollDeductionField('total_pendapatan_lainnya_pengurang')).toBe(true);
    expect(isSignedPayrollDeductionField('total_potongan_bersih')).toBe(true);
    expect(isSignedPayrollDeductionField('potongan_upah_kotor_total')).toBe(true);
  });

  it('keeps employer, premium tax, and non-deduction totals positive', () => {
    expect(isSignedPayrollDeductionField('pot_bpjs_kesehatan_majikan')).toBe(false);
    expect(isSignedPayrollDeductionField('pot_bpjs_pekerja_total')).toBe(false);
    expect(isSignedPayrollDeductionField('premi_pph')).toBe(false);
    expect(isSignedPayrollDeductionField('total_premi')).toBe(false);
    expect(isSignedPayrollDeductionField('upah_bersih')).toBe(false);
  });
});
