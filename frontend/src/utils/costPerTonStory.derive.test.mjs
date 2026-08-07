// Runnable self-check — node costPerTonStory.derive.test.mjs
import assert from 'node:assert';
import { decomposeCost, costPerTon, productivity, benchmarkMean, deltaPct, heatColor, pivotDivisionSeries, movementBuckets } from './costPerTonStory.derive.js';

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('✓ ' + name); } catch (e) { fail++; console.log('✗ ' + name + ' — ' + e.message); } };

check('zero-tonase costPerTon returns null not NaN', () => {
    assert.strictEqual(costPerTon({ total_wage: 1000, total_tonase: 0 }), null);
    assert.strictEqual(costPerTon({ total_wage: 1000, total_tonase: null }), null);
});
check('costPerTon divides wage by tonase', () => {
    assert.strictEqual(costPerTon({ total_wage: 1000, total_tonase: 5 }), 200);
});
check('decomposeCost gajiPokok non-negative', () => {
    const d = decomposeCost({ total_wage: 100, total_ot: 60, total_premi: 50 });
    assert.ok(d.gajiPokok >= 0, 'gajiPokok should be >= 0');
    assert.strictEqual(d.gajiPokok, 0); // 100-60-50 < 0 -> clamped 0
    assert.strictEqual(d.total, 100);
});
check('decomposeCost normal split', () => {
    const d = decomposeCost({ total_wage: 1000, total_ot: 200, total_premi: 300 });
    assert.strictEqual(d.gajiPokok, 500);
    assert.strictEqual(d.lembur, 200);
    assert.strictEqual(d.premi, 300);
});
check('productivity ton/HK null when HK 0', () => {
    assert.strictEqual(productivity({ total_tonase: 100, total_hk: 0 }), null);
});
check('productivity divides tonase by HK', () => {
    assert.strictEqual(productivity({ total_tonase: 100, total_hk: 50 }), 2);
});
check('benchmarkMean excludes zero-tonase divisi', () => {
    const m = benchmarkMean([
        { total_wage: 1000, total_tonase: 10 },
        { total_wage: 500, total_tonase: 0 }, // excluded
        { total_wage: 2000, total_tonase: 20 },
    ]);
    assert.strictEqual(m, (3000) / 30);
});
check('benchmarkMean null when no tonase', () => {
    assert.strictEqual(benchmarkMean([{ total_wage: 100, total_tonase: 0 }]), null);
});
check('deltaPct sign correct', () => {
    assert.ok(deltaPct({ total_wage: 1100, total_tonase: 10 }, { total_wage: 1000, total_tonase: 10 }) > 0);
    assert.ok(deltaPct({ total_wage: 900, total_tonase: 10 }, { total_wage: 1000, total_tonase: 10 }) < 0);
});
check('deltaPct null when no prev', () => {
    assert.strictEqual(deltaPct({ total_wage: 1000, total_tonase: 10 }, { total_wage: 1000, total_tonase: 0 }), null);
});
check('heatColor returns green for min, red for max', () => {
    const g = heatColor(100, 100, 300);
    const r = heatColor(300, 100, 300);
    assert.ok(g.includes('31,111,67') || g.toLowerCase().includes('rgb(31'), 'min should lean green: ' + g);
    assert.ok(r.includes('179,57,46') || r.toLowerCase().includes('rgb(179'), 'max should lean red: ' + r);
});

const PIVOT_FIXTURE = [
    { division_code: 'PTRJ01', month: 7, year: 2026, wage: 1000, tonase: 10, cost_per_ton: 100 },
    { division_code: 'PTRJ01', month: 8, year: 2026, wage: 900, tonase: 10, cost_per_ton: 90 },     // improving
    { division_code: 'PTRJ03', month: 7, year: 2026, wage: 1000, tonase: 10, cost_per_ton: 100 },
    { division_code: 'PTRJ03', month: 8, year: 2026, wage: 1200, tonase: 10, cost_per_ton: 120 },    // worsening
    { division_code: 'PTRJ07', month: 7, year: 2026, wage: 1000, tonase: 10, cost_per_ton: 100 },
    { division_code: 'PTRJ07', month: 8, year: 2026, wage: 1000, tonase: 10, cost_per_ton: 100 },    // flat
    { division_code: 'PTRJ09', month: 8, year: 2026, wage: 500, tonase: 0, cost_per_ton: null },     // single null-only, skipped
];
check('pivotDivisionSeries shape: periods sorted, divisions keyed, meanSeries per period', () => {
    const { periods, divisions, meanSeries } = pivotDivisionSeries(PIVOT_FIXTURE);
    assert.strictEqual(periods.length, 2, 'two unique periods');
    assert.strictEqual(periods[0].key, '2026-07');
    assert.strictEqual(divisions.length, 4, 'four divisions');
    const d1 = divisions.find(d => d.code === 'PTRJ01');
    assert.strictEqual(d1.series.length, 2);
    assert.strictEqual(d1.latest, 90);
    // mean for 2026-07: only divisi with tonase>0 → 3 divisi × (1000/10) sum = 3000 wage / 30 ton = 100
    assert.strictEqual(meanSeries[0].mean, 100);
    assert.strictEqual(meanSeries.length, 2);
});
check('movementBuckets classifies improving/worsening/flat, skips null-only', () => {
    const { divisions } = pivotDivisionSeries(PIVOT_FIXTURE);
    const b = movementBuckets(divisions);
    assert.deepStrictEqual(b.improving.sort(), ['PTRJ01']);
    assert.deepStrictEqual(b.worsening.sort(), ['PTRJ03']);
    assert.deepStrictEqual(b.flat.sort(), ['PTRJ07']);
    assert.ok(!b.improving.includes('PTRJ09') && !b.worsening.includes('PTRJ09') && !b.flat.includes('PTRJ09'), 'PTRJ09 single-point skipped');
});
check('movementBuckets empty/short series no crash', () => {
    const b = movementBuckets([{ code: 'X', series: [{ cost_per_ton: 50 }] }]);
    assert.deepStrictEqual(b.improving, []);
    assert.deepStrictEqual(b.worsening, []);
    assert.deepStrictEqual(b.flat, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
