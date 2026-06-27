import { describe, expect, it } from 'vitest';
import { buildWagesAuditModel, getAuditStatus, getWagesPremiTotal, toPayrollNumber } from './wagesSummaryAudit';

describe('wagesSummaryAudit', () => {
  it('normalizes payroll numbers and audit status', () => {
    expect(toPayrollNumber('1200')).toBe(1200);
    expect(toPayrollNumber('bad')).toBe(0);
    expect(getAuditStatus(0)).toBe('OK');
    expect(getAuditStatus(-1)).toBe('Review');
  });

  it('prefers total_premi_excluding_special for report premi totals', () => {
    expect(getWagesPremiTotal({ total_premi_excluding_special: 90, total_premi: 120 })).toBe(90);
    expect(getWagesPremiTotal({ total_premi: 120 })).toBe(120);
  });

  it('builds deduction and income audit rows from grouped wages data', () => {
    const model = buildWagesAuditModel({
      P: {
        label: 'ESTATE PARIT GUNUNG',
        divisions: [
          {
            description: 'Parit Gunung 1A',
            division_code: 'P1A',
            total_employees: 189,
            total_hk: 5696,
            total_pph21: 2020512,
            total_spsi: 640000,
            total_premi_excluding_special: 89196125,
            total_lembur: 27032168,
            total_manual: 876902345,
            thumb_print: 876902346,
            selisih: -1,
          },
        ],
        subtotal: null,
      },
    }, {
      total_employees: 189,
      total_hk: 5696,
      total_pph21: 2020512,
      total_spsi: 640000,
      total_premi_excluding_special: 89196125,
      total_lembur: 27032168,
      total_manual: 876902345,
      thumb_print: 876902346,
      selisih: -1,
    });

    expect(model.deductionRows).toHaveLength(1);
    expect(model.deductionRows[0]).toMatchObject({
      totalPotongan: 2660512,
      totalIncome: 116228293,
      auditStatus: 'Review',
      auditRemark: 'Review',
    });
    expect(model.deductionEstateSummary[0].totalPotongan).toBe(2660512);
    expect(model.grandTotal.totalPotongan).toBe(2660512);
    expect(model.grandTotal.totalIncome).toBe(116228293);
  });
});

