import { describe, expect, it } from 'vitest';
import {
  calculateRowTotals,
  calculateTotalPotongan,
  calculateTotalPremi,
  processDivisionData,
} from './aggregationUtils';

describe('aggregationUtils payroll formula guards', () => {
  it('excludes premi_pph from gross premi because it is a net-pay addition', () => {
    expect(calculateTotalPremi({
      premi_brondol: 100_000,
      premi_panen: 50_000,
      premi_pph: 25_000,
    })).toBe(150_000);
  });

  it('excludes gross koreksi from net deductions to avoid double deduction', () => {
    const row = {
      pot_koreksi: -10_000,
      pot_pph21: -5_000,
      pot_spsi: 2_000,
      potongan_upah_kotor_total: 10_000,
    };

    expect(calculateTotalPotongan(row)).toBe(7_000);
  });

  it('uses deduction magnitudes when recalculating row totals', () => {
    const row = calculateRowTotals({
      gaji_pokok: 1_000_000,
      total_tunjangan: 0,
      premi_brondol: 100_000,
      premi_pph: 25_000,
      pot_koreksi: -10_000,
      pot_pph21: -5_000,
    });

    expect(row.total_premi).toBe(100_000);
    expect(row.potongan_upah_kotor_total).toBe(10_000);
    expect(row.jumlah_upah_kotor).toBe(1_090_000);
    expect(row.total_potongan).toBe(5_000);
    expect(row.upah_bersih).toBe(1_110_000);
  });

  it('treats pendapatan_lainnya as gross addition and matching net deduction', () => {
    const row = calculateRowTotals({
      gaji_pokok: 1_000_000,
      pendapatan_lainnya: 50_000,
      pot_pph21: 5_000,
    });

    expect(row.jumlah_upah_kotor).toBe(1_050_000);
    expect(row.total_potongan).toBe(55_000);
    expect(row.upah_bersih).toBe(995_000);
  });

  it('does not subtract automatic HK correction again from gross totals', () => {
    const row = calculateRowTotals({
      gaji_pokok: 900_000,
      total_tunjangan: 0,
      koreksi_hk: -100_000,
      pot_koreksi: 100_000,
    });

    expect(row.potongan_upah_kotor_total).toBe(0);
    expect(row.jumlah_upah_kotor).toBe(900_000);
  });

  it('filters active employees with the same jumlah_hk rule as backend totals', () => {
    const rows = processDivisionData({
      A1: [
        { nama: 'Included', jumlah_hk: 1, hari_kerja: 0, gaji_pokok: 100_000 },
        { nama: 'Excluded', jumlah_hk: 0, hari_kerja: 1, gaji_pokok: 999_999 },
      ],
    });

    expect(rows.some((row) => row.nama === 'Included')).toBe(true);
    expect(rows.some((row) => row.nama === 'Excluded')).toBe(false);
  });
});
