import { describe, expect, it } from 'vitest';
import {
  formatCompactIDR,
  formatNumberID,
  toCostCompositionRows,
  toDonutRows,
  toDivisionHeadcountRows,
  toHeadcountTrendRows,
  toSparklinePoints,
  toTonPerHkRows,
  findMissingWageDivisions
} from './dashboardDerivations';

describe('formatters', () => {
  it('formatCompactIDR meringkas miliar/juta dan menangani null', () => {
    expect(formatCompactIDR(1_500_000_000)).toBe('Rp 1,5 M');
    expect(formatCompactIDR(2_000_000)).toBe('Rp 2 jt');
    expect(formatCompactIDR(null)).toBe('-');
    expect(formatCompactIDR('abc')).toBe('-');
  });

  it('formatNumberID memformat ribuan dan menangani null', () => {
    expect(formatNumberID(12345)).toBe('12.345');
    expect(formatNumberID(null)).toBe('-');
  });
});

describe('toCostCompositionRows', () => {
  it('hanya memakai divisi dengan upah tersedia, urut total desc', () => {
    const rows = toCostCompositionRows([
      { division_code: 'ARA', upah_pokok: 700, premi: 200, lembur: 100, upah_available: true },
      { division_code: 'DME', upah_pokok: 0, premi: 0, lembur: 0, upah_available: false },
      { division_code: 'ARC', upah_pokok: 1001, premi: 0, lembur: 0, upah_available: true }
    ]);
    expect(rows.map(r => r.name)).toEqual(['ARC', 'ARA']);
    expect(rows[1]).toEqual({ name: 'ARA', upah_pokok: 700, premi: 200, lembur: 100 });
  });

  it('aman untuk input kosong/undefined', () => {
    expect(toCostCompositionRows()).toEqual([]);
  });
});

describe('toDonutRows / toDivisionHeadcountRows', () => {
  it('toDonutRows memetakan key ke name/value', () => {
    expect(toDonutRows([{ emp_type: 'SKU', headcount: 5 }], 'emp_type'))
      .toEqual([{ name: 'SKU', value: 5 }]);
  });

  it('toDivisionHeadcountRows mengurutkan desc', () => {
    const rows = toDivisionHeadcountRows([
      { division_code: 'ARC', headcount: 3 },
      { division_code: 'ARA', headcount: 9 }
    ]);
    expect(rows.map(r => r.name)).toEqual(['ARA', 'ARC']);
  });
});

describe('toHeadcountTrendRows', () => {
  it('mengganti titik terakhir dengan live total bila agregasi 0', () => {
    const rows = toHeadcountTrendRows([
      { period: 'Mar 2026', total_headcount: 100 },
      { period: 'Apr 2026', total_headcount: 0 }
    ], 120);
    expect(rows[1]).toEqual({ period: 'Apr 2026', headcount: 120, live: true });
  });

  it('tidak mengubah titik terakhir bila agregasi ada', () => {
    const rows = toHeadcountTrendRows([{ period: 'Apr 2026', total_headcount: 100 }], 120);
    expect(rows[0]).toEqual({ period: 'Apr 2026', headcount: 100 });
  });
});

describe('toSparklinePoints / toTonPerHkRows / findMissingWageDivisions', () => {
  it('toSparklinePoints mengambil satu key dari trends', () => {
    expect(toSparklinePoints([{ total_wage: 5 }, { total_wage: 7 }], 'total_wage'))
      .toEqual([{ v: 5 }, { v: 7 }]);
  });

  it('toTonPerHkRows menghitung ton/HK dan melewati divisi tanpa data', () => {
    const rows = toTonPerHkRows([
      { division_code: 'ARA', tonase: 250, total_hk: 200, upah_available: true },
      { division_code: 'DME', tonase: 120, total_hk: 0, upah_available: false }
    ]);
    expect(rows).toEqual([{ name: 'ARA', tonPerHk: 1.25 }]);
  });

  it('findMissingWageDivisions menemukan divisi produksi tanpa upah', () => {
    expect(findMissingWageDivisions([
      { division_code: 'ARA', upah_available: 1, total_tonase: 250 },
      { division_code: 'DME', upah_available: 0, total_tonase: 120 },
      { division_code: 'XYZ', upah_available: 0, total_tonase: 0 }
    ])).toEqual(['DME']);
  });
});
