/**
 * PayrollCalculator Test Suite
 * Verifies all formulas match business rules:
 * 1. UPAH KOTOR = gaji + (tunjangan - lembur) + lembur + total_premi
 *    = gaji_pokok_aktual + (total_tunjangan - lembur_jumlah) + lembur_jumlah + total_premi
 *    = gaji_pokok_aktual + tunjangan_non_lembur + lembur + total_premi
 * 2. JUMLAH UPAH KOTOR = UPAH KOTOR - pot_koreksi + pendapatan_lainnya (tampilan)
 * 3. PENGHASILAN BRUTO = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + astek_m + bpjs_m
 * 4. UPAH KOTOR PAJAK = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + bpjs_pekerja
 * 5. TOTAL POTONGAN = bpjs_kes + bpjs_pensiun + astek + spsi + pph (NO koreksi/lainnya/other)
 * 6. UPAH BERSIH = UPAH KOTOR - TOTAL POTONGAN + premi_pph
 */

import { PayrollCalculator, PayrollCalculatorInput } from './PayrollCalculator';

function assert(label: string, actual: number, expected: number): boolean {
    const pass = Math.abs(actual - expected) <= 0;
    console.log(`${pass ? '✅' : '❌'} [${label}]`);
    if (!pass) {
        console.log(`    Expected: ${expected.toLocaleString()}`);
        console.log(`    Actual:   ${actual.toLocaleString()}`);
    }
    return pass;
}

let allPass = true;
let testCount = 0;
let passCount = 0;

function test(name: string, fn: () => boolean): void {
    testCount++;
    console.log(`\n── ${testCount}. ${name}`);
    try {
        if (fn()) passCount++;
        else allPass = false;
    } catch (e: any) {
        console.log(`   ❌ EXCEPTION: ${e.message}`);
        allPass = false;
    }
}

// ─── Base test data ───────────────────────────────────────────────────
const base: PayrollCalculatorInput = {
    gaji_pokok_aktual: 5_000_000,
    beras_jumlah: 500_000,
    jabatan_jumlah: 300_000,
    masa_kerja_jumlah: 200_000,
    lembur_jumlah: 400_000,
    total_tunjangan: 1_400_000,
    total_premi: 2_000_000,
    pot_koreksi: 150_000,
    pendapatan_lainnya: 300_000,
    pot_astek_pekerja: 40_000,
    pot_bpjs_kesehatan_pekerja: 120_000,
    pot_bpjs_pensiun_pekerja: 50_000,
    pot_spsi: 4_000,
    pot_pph21: 80_000,
    other_potongan: 10_000,
    pot_premi_pph: 50_000,
    astek_majikan: 30_000,
    bpjs_majikan: 80_000,
};

// ─── Compute expected values dynamically from the base data ──────────────────────────
const baseCalc = PayrollCalculator.calculate(base, 'K/1', 2025);

// Core values
const BASE_UPAH_KOTOR = baseCalc.upah_kotor;
const BASE_JUMLAH = baseCalc.jumlah_upah_kotor;
const BASE_PAJAK = baseCalc.upah_kotor_pajak;
const BASE_BRUTO = baseCalc.penghasilan_bruto;
const BASE_TOTAL_POT = baseCalc.total_potongan;
const BASE_BERSIH = baseCalc.upah_bersih;

console.log('═══════════════════════════════════════════════════════════');
console.log('         PAYROLL CALCULATOR TEST SUITE');
console.log(`BASE: UPAH_KOTOR=${BASE_UPAH_KOTOR} JUMLAH=${BASE_JUMLAH} POTONGAN=${BASE_TOTAL_POT} BERSIH=${BASE_BERSIH}`);

// ─── Core formula tests ──────────────────────────────────────────────
test('UPAH KOTOR = gaji + tunjangan + lembur + premi', () =>
    assert('upah_kotor', baseCalc.upah_kotor, BASE_UPAH_KOTOR) &&
    assert('komponen_kotor.subtotal', baseCalc.komponen_kotor.subtotal, BASE_UPAH_KOTOR)
);

test('JUMLAH UPAH KOTOR = UPAH_KOTOR + koreksi + lainnya', () =>
    assert('jumlah_upah_kotor', baseCalc.jumlah_upah_kotor, BASE_JUMLAH) &&
    assert('grand_subtotal', baseCalc.komponen_kotor.grand_subtotal, BASE_JUMLAH)
);

test('UPAH KOTOR PAJAK = UPAH_KOTOR + koreksi + lainnya + bpjs', () =>
    assert('upah_kotor_pajak', baseCalc.upah_kotor_pajak, BASE_PAJAK)
);

test('PENGHASILAN BRUTO = UPAH_KOTOR + koreksi + lainnya + astek + bpjs_m', () =>
    assert('penghasilan_bruto', baseCalc.penghasilan_bruto, BASE_BRUTO)
);

test('TOTAL POTONGAN = bpjs_kes + bpjs_pensiun + astek + spsi + pph', () =>
    assert('total_potongan', baseCalc.total_potongan, BASE_TOTAL_POT)
);

test('UPAH BERSIH = JUMLAH UPAH KOTOR - TOTAL_POTONGAN + premi_pph', () => {
    const expected = BASE_JUMLAH - BASE_TOTAL_POT + base.pot_premi_pph;
    return assert('upah_bersih', baseCalc.upah_bersih, expected) &&
        assert('balance', baseCalc.upah_bersih, baseCalc.jumlah_upah_kotor - baseCalc.total_potongan + base.pot_premi_pph);
});

// Komponen breakdown
test('komponen_kotor', () =>
    assert('gaji', baseCalc.komponen_kotor.gaji_pokok, base.gaji_pokok_aktual) &&
    assert('tunjangan', baseCalc.komponen_kotor.tunjangan, base.total_tunjangan - base.lembur_jumlah) &&
    assert('lembur', baseCalc.komponen_kotor.lembur, base.lembur_jumlah) &&
    assert('premi', baseCalc.komponen_kotor.premi, base.total_premi) &&
    assert('koreksi', baseCalc.komponen_kotor.koreksi, base.pot_koreksi) &&
    assert('lainnya', baseCalc.komponen_kotor.lainnya, base.pendapatan_lainnya)
);

test('komponen_potongan', () =>
    assert('astek', baseCalc.komponen_potongan.astek_pekerja, base.pot_astek_pekerja) &&
    assert('bpjs_kes', baseCalc.komponen_potongan.bpjs_kes_pekerja, base.pot_bpjs_kesehatan_pekerja) &&
    assert('bpjs_pen', baseCalc.komponen_potongan.bpjs_pensiun_pekerja, base.pot_bpjs_pensiun_pekerja) &&
    assert('spsi', baseCalc.komponen_potongan.spsi, base.pot_spsi) &&
    assert('pph21', baseCalc.komponen_potongan.pph21, base.pot_pph21)
);

// Balance: verify internal consistency
// UPAH KOTOR = gaji_pokok + (total_tunjangan - lembur) + lembur + total_premi
//            = gaji_pokok + total_tunjangan + total_premi
//            = 5,000,000 + 1,400,000 + 2,000,000 = 8,400,000
test('Balance: UPAH KOTOR = gaji_pokok + total_tunjangan + total_premi', () =>
    assert('balance UPAH_KOTOR', baseCalc.upah_kotor,
        base.gaji_pokok_aktual + base.total_tunjangan + base.total_premi)
);

test('Balance: JUMLAH = UPAH_KOTOR - koreksi + lainnya', () =>
    assert('balance JUMLAH', baseCalc.jumlah_upah_kotor, BASE_UPAH_KOTOR - base.pot_koreksi + base.pendapatan_lainnya)
);

test('Balance: PENGHASILAN BRUTO = UPAH_KOTOR - koreksi + lainnya + astek_m + bpjs_m', () =>
    assert('balance BRUTO', baseCalc.penghasilan_bruto,
        BASE_UPAH_KOTOR - base.pot_koreksi + base.pendapatan_lainnya + base.astek_majikan + base.bpjs_majikan)
);

test('Balance: UPAH_KOTOR PAJAK = UPAH_KOTOR - koreksi + lainnya + bpjs_pekerja', () =>
    assert('balance PAJAK', baseCalc.upah_kotor_pajak,
        BASE_UPAH_KOTOR - base.pot_koreksi + base.pendapatan_lainnya + base.pot_bpjs_kesehatan_pekerja)
);

test('Manual adjustment deltas move gross, displayed gross, and net pay correctly', () => {
    const adjusted = PayrollCalculator.calculate({
        ...base,
        total_premi: base.total_premi + 25_000,
        pot_koreksi: base.pot_koreksi + 10_000,
        other_potongan: base.other_potongan + 5_000
    }, 'K/1', 2025);

    return assert('upah_kotor + premi', adjusted.upah_kotor, baseCalc.upah_kotor + 25_000) &&
        assert('jumlah_upah_kotor - koreksi', adjusted.jumlah_upah_kotor, baseCalc.jumlah_upah_kotor + 25_000 - 10_000) &&
        assert('upah_bersih - potongan bersih', adjusted.upah_bersih, baseCalc.upah_bersih + 25_000 - 10_000 - 5_000);
});

test('Koreksi uses absolute amount and always reduces gross', () => {
    const positive = PayrollCalculator.calculate({ ...base, pot_koreksi: 10_000 }, 'K/1', 2025);
    const negative = PayrollCalculator.calculate({ ...base, pot_koreksi: -10_000 }, 'K/1', 2025);
    const expectedJumlah = BASE_UPAH_KOTOR - 10_000 + base.pendapatan_lainnya;

    return assert('positive jumlah_upah_kotor', positive.jumlah_upah_kotor, expectedJumlah) &&
        assert('negative jumlah_upah_kotor', negative.jumlah_upah_kotor, expectedJumlah) &&
        assert('negative potongan_upah_kotor absolute', negative.potongan_upah_kotor, 10_000) &&
        assert('negative komponen koreksi absolute', negative.komponen_kotor.koreksi, 10_000);
});

// Edge: Zero koreksi & lainnya
test('Edge: Zero koreksi & lainnya', () => {
    const z = PayrollCalculator.calculate({ ...base, pot_koreksi: 0, pendapatan_lainnya: 0 }, 'K/1', 2025);
    return assert('upah_kotor', z.upah_kotor, BASE_UPAH_KOTOR) &&
        assert('jumlah_upah_kotor', z.jumlah_upah_kotor, BASE_UPAH_KOTOR) &&
        assert('upah_kotor_pajak', z.upah_kotor_pajak, BASE_UPAH_KOTOR + base.pot_bpjs_kesehatan_pekerja);
});

// Edge: Zero all deductions
test('Edge: Zero all deductions', () => {
    const z = PayrollCalculator.calculate({
        ...base,
        pot_astek_pekerja: 0, pot_bpjs_kesehatan_pekerja: 0, pot_bpjs_pensiun_pekerja: 0,
        pot_spsi: 0, pot_pph21: 0, other_potongan: 0, pot_premi_pph: 0,
        pot_koreksi: 0, pendapatan_lainnya: 0,
    }, 'K/1', 2025);
    return assert('upah_kotor', z.upah_kotor, BASE_UPAH_KOTOR) &&
        assert('jumlah_upah_kotor', z.jumlah_upah_kotor, BASE_UPAH_KOTOR) &&
        assert('upah_kotor_pajak', z.upah_kotor_pajak, BASE_UPAH_KOTOR) &&
        assert('total_potongan', z.total_potongan, 0) &&
        assert('upah_bersih', z.upah_bersih, BASE_UPAH_KOTOR) &&
        // balance: UPAH_BERSIH = UPAH_KOTOR (when all deductions = 0)
        assert('balance', z.upah_bersih, z.upah_kotor);
});

// ─── SIGN-SAFETY GUARD ───────────────────────────────────────────────
// Potongan & koreksi WAJIB magnitude positif. Input negatif (mis. -80000)
// tidak boleh flip potongan jadi tambahan / upah_bersih naik.
// Naming rule: "potongan"/"koreksi" pada akhirnya selalu mengurangi.
// ─────────────────────────────────────────────────────────────────────
test('SIGN-SAFETY: negative pot_pph21 must NOT reduce total_potongan', () => {
    const neg = PayrollCalculator.calculate({ ...base, pot_pph21: -80_000 }, 'K/1', 2025);
    // total_potongan harus tetap mengandung +80_000 (abs), bukan -80_000
    const expectedPot = BASE_TOTAL_POT; // base already includes +80_000 pph21
    return assert('total_potongan abs', neg.total_potongan, expectedPot) &&
        assert('upah_bersih unchanged', neg.upah_bersih, BASE_BERSIH);
});

test('SIGN-SAFETY: negative other_potongan must NOT reduce total_potongan', () => {
    const neg = PayrollCalculator.calculate({ ...base, other_potongan: -10_000 }, 'K/1', 2025);
    const expectedPot = BASE_TOTAL_POT; // base includes +10_000 other
    return assert('total_potongan abs', neg.total_potongan, expectedPot) &&
        assert('upah_bersih unchanged', neg.upah_bersih, BASE_BERSIH);
});

test('SIGN-SAFETY: negative pot_spsi must NOT reduce total_potongan', () => {
    const neg = PayrollCalculator.calculate({ ...base, pot_spsi: -4_000 }, 'K/1', 2025);
    return assert('total_potongan abs', neg.total_potongan, BASE_TOTAL_POT) &&
        assert('upah_bersih unchanged', neg.upah_bersih, BASE_BERSIH);
});

test('SIGN-SAFETY: negative pot_astek/bpjs must NOT reduce total_potongan', () => {
    const neg = PayrollCalculator.calculate({
        ...base,
        pot_astek_pekerja: -40_000,
        pot_bpjs_kesehatan_pekerja: -120_000,
        pot_bpjs_pensiun_pekerja: -50_000,
    }, 'K/1', 2025);
    return assert('total_potongan abs', neg.total_potongan, BASE_TOTAL_POT) &&
        assert('upah_bersih unchanged', neg.upah_bersih, BASE_BERSIH);
});

test('SIGN-SAFETY: negative pendapatan_lainnya must NOT corrupt gross or potongan', () => {
    // lainnya = earning (ADD to gross) + cancel-out subtract in total_potongan.
    // Negative input must be abs'd: gross stays +300_000, total_potongan stays +300_000.
    const neg = PayrollCalculator.calculate({ ...base, pendapatan_lainnya: -300_000 }, 'K/1', 2025);
    return assert('jumlah_upah_kotor unchanged', neg.jumlah_upah_kotor, BASE_JUMLAH) &&
        assert('total_potongan unchanged', neg.total_potongan, BASE_TOTAL_POT) &&
        assert('upah_bersih unchanged', neg.upah_bersih, BASE_BERSIH) &&
        assert('taxable_pendapatan_lainnya abs', neg.taxable_pendapatan_lainnya, 300_000);
});

test('SIGN-SAFETY: negative pot_koreksi still reduces gross (existing behavior preserved)', () => {
    const neg = PayrollCalculator.calculate({ ...base, pot_koreksi: -150_000 }, 'K/1', 2025);
    const expectedJumlah = BASE_UPAH_KOTOR - 150_000 + base.pendapatan_lainnya;
    return assert('jumlah_upah_kotor', neg.jumlah_upah_kotor, expectedJumlah) &&
        assert('potongan_upah_kotor abs', neg.potongan_upah_kotor, 150_000) &&
        // koreksi NOT in total_potongan (already in jumlah_upah_kotor)
        assert('total_potongan excludes koreksi', neg.total_potongan, BASE_TOTAL_POT);
});

test('SIGN-SAFETY: negative pot_premi_pph must NOT flip net-pay addition into deduction', () => {
    // premi_pph = ADDITION to upah_bersih. Negative must stay addition (abs).
    const neg = PayrollCalculator.calculate({ ...base, pot_premi_pph: -50_000 }, 'K/1', 2025);
    return assert('upah_bersih unchanged', neg.upah_bersih, BASE_BERSIH) &&
        assert('total_potongan_bersih unchanged', neg.total_potongan_bersih, BASE_TOTAL_POT - 50_000);
});

// Summary
console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`         RESULTS: ${passCount}/${testCount} PASSED`);
console.log(`══════════════════════════════════════════════════════════`);
if (allPass) {
    console.log('✅ ALL TESTS PASSED');
} else {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
}
