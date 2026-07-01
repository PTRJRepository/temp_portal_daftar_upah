/**
 * PayrollFormulas - Pure Calculation Functions
 *
 * Single Source of Truth for ALL derived payroll field formulas.
 * No side effects, no DB calls - purely mathematical calculations.
 *
 * IMPORTANT BUSINESS RULES (Final 2026-04-03):
 *
 * There are 3 LEVELS of Gross Wage:
 *
 * 1. UPAH KOTOR (Base Gross - without koreksi/pendapatan_lainnya)
 *    = gaji_pokok_aktual + total_tunjangan + total_premi
 *
 * 2. JUMLAH UPAH KOTOR (Daftar Upah Display)
 *    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya
 *    NOTE: koreksi di-SUBTRACT dari gross, lainnya di-ADD ke gross untuk TAMPILAN saja.
 *
 * 3. PENGHASILAN BRUTO (For PPh21 TER)
 *    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + astek_majikan + bpjs_majikan
 *    NOTE: koreksi & lainnya adalah bagian dari penghasilan kena pajak.
 *
 * 4. UPAH KOTOR PAJAK (For header/tampilan pajak)
 *    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + bpjs_pekerja
 *
 * 5. TOTAL POTONGAN (Total Deductions from Take-Home Pay)
 *    = astek_pekerja + bpjs_kes_pekerja + bpjs_pensiun_pekerja + spsi + pph21 + other_potongan + pendapatan_lainnya
 *    NOTE: koreksi TIDAK masuk total_potongan karena sudah termasuk
 *    dalam jumlah_upah_kotor. Jika masuk total_potongan, akan di-subtract 2x → minus.
 *    NOTE: pendapatan_lainnya (THR+Bonus+Custom+KONTAN) WAJIB masuk total_potongan
 *    karena di jumlah_upah_kotor di-add sebagai tambahan (+), harus di-reduce juga.
 *
 * 6. UPAH BERSIH (Take-Home Pay)
 *    = jumlah_upah_kotor - total_potongan + premi_pph
 *    = (upah_kotor - pot_koreksi + pendapatan_lainnya) - total_potongan + premi_pph
 *
 *    premi_pph = ADDITION (penambah upah bersih), bukan potongan.
 */

import { KomponenKotor, KomponenPotongan, PayrollFormulaResult } from './types';

/**
 * Calculate UPAH KOTOR (Base Gross without koreksi/pendapatan_lainnya)
 *
 * = gaji_pokok_aktual + total_tunjangan + total_premi
 *
 * @param input - Component values
 * @returns upah_kotor value
 */
export function calculateUpahKotor(input: {
    gaji_pokok_aktual: number;
    total_tunjangan: number;
    total_premi: number;
}): number {
    return input.gaji_pokok_aktual + input.total_tunjangan + input.total_premi;
}

/**
 * Calculate Component Kotor breakdown
 *
 * @param input - Component values
 * @returns KomponenKotor breakdown
 */
export function calculateKomponenKotor(input: {
    gaji_pokok_aktual: number;
    total_tunjangan: number;
    lembur_jumlah: number;
    total_premi: number;
    pot_koreksi: number;
    pendapatan_lainnya: number;
}): KomponenKotor {
    const { gaji_pokok_aktual, total_tunjangan, lembur_jumlah, total_premi, pot_koreksi } = input;
    const koreksiAmount = Math.abs(Number(pot_koreksi) || 0);
    // [SIGN-SAFETY] pendapatan_lainnya = earning magnitude, wajib positif.
    const lainnyaAmount = Math.abs(Number(input.pendapatan_lainnya) || 0);

    // tunjangan display excludes lembur (lembur shown separately)
    const tunjangan = total_tunjangan - lembur_jumlah;

    const subtotal = gaji_pokok_aktual + tunjangan + lembur_jumlah + total_premi;

    // koreksi di-SUBTRACT, lainnya di-ADD untuk Grand Subtotal (jumlah_upah_kotor)
    const grand_subtotal = subtotal - koreksiAmount + lainnyaAmount;

    return {
        gaji_pokok: gaji_pokok_aktual,
        tunjangan,
        lembur: lembur_jumlah,
        premi: total_premi,
        subtotal,
        koreksi: koreksiAmount,
        lainnya: lainnyaAmount,
        grand_subtotal,
    };
}

/**
 * Calculate JUMLAH UPAH KOTOR (Daftar Upah Display)
 *
 * = UPAH KOTOR - pot_koreksi + pendapatan_lainnya
 * NOTE: koreksi di-SUBTRACT, lainnya di-ADD ke gross untuk TAMPILAN saja.
 *
 * @param upahKotor - Base gross (gaji + tunjangan + premi, without koreksi/lainnya)
 * @param potKoreksi - Koreksi amount
 * @param pendapatanLainnya - THR + Bonus + Custom + KONTAN
 * @returns jumlah_upah_kotor
 */
 export function calculateJumlahUpahKotor(upahKotor: number, potKoreksi: number, pendapatanLainnya: number): number {
    // [SIGN-SAFETY] koreksi & lainnya wajib magnitude positif.
    return upahKotor - Math.abs(Number(potKoreksi) || 0) + Math.abs(Number(pendapatanLainnya) || 0);
 }

/**
 * Calculate Component Potongan breakdown
 *
 * NOTE: koreksi TIDAK masuk (already in jumlah_upah_kotor)
 * NOTE: pendapatan_lainnya WAJIB masuk (to offset the + in jumlah_upah_kotor)
 *
 * @param input - Deduction components
 * @returns KomponenPotongan breakdown
 */
export function calculateKomponenPotongan(input: {
    pot_astek_pekerja: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_spsi: number;
    pot_pph21: number;
    other_potongan: number;
    pendapatan_lainnya: number;
}): KomponenPotongan {
    // [SIGN-SAFETY] SEMUA komponen potongan wajib magnitude positif.
    // Input negatif (mis. -80000) tidak boleh flip potongan jadi tambahan.
    const astek_pekerja = Math.abs(Number(input.pot_astek_pekerja) || 0);
    const bpjs_kes_pekerja = Math.abs(Number(input.pot_bpjs_kesehatan_pekerja) || 0);
    const bpjs_pensiun_pekerja = Math.abs(Number(input.pot_bpjs_pensiun_pekerja) || 0);
    const spsi = Math.abs(Number(input.pot_spsi) || 0);
    const pph21 = Math.abs(Number(input.pot_pph21) || 0);
    const other = Math.abs(Number(input.other_potongan) || 0);
    const lainnya = Math.abs(Number(input.pendapatan_lainnya) || 0);

    const subtotal = astek_pekerja + bpjs_kes_pekerja + bpjs_pensiun_pekerja
                   + spsi + pph21 + other + lainnya;

    return {
        astek_pekerja,
        bpjs_kes_pekerja,
        bpjs_pensiun_pekerja,
        spsi,
        pph21,
        other,
        lainnya,
        subtotal,
    };
}

/**
 * Calculate TOTAL POTONGAN (Total Deductions from Take-Home Pay)
 *
 * = astek_pekerja + bpjs_kes_pekerja + bpjs_pensiun_pekerja + spsi + pph21 + other_potongan + pendapatan_lainnya
 *
 * NOTE: koreksi TIDAK masuk total_potongan (to avoid double deduction)
 * NOTE: pendapatan_lainnya WAJIB masuk (to offset the + in jumlah_upah_kotor)
 *
 * @param input - Deduction components
 * @returns total_potongan
 */
export function calculateTotalPotongan(input: {
    pot_astek_pekerja: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_spsi: number;
    pot_pph21: number;
    other_potongan: number;
    pendapatan_lainnya: number;
}): number {
    const komponen = calculateKomponenPotongan(input);
    return komponen.subtotal;
}

/**
 * Calculate UPAH KOTOR PAJAK (Taxable Gross for header/pajak display)
 *
 * = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + bpjs_pekerja
 *
 * @param upahKotor - Base gross
 * @param potKoreksi - Koreksi amount
 * @param pendapatanLainnya - THR + Bonus + Custom + KONTAN
 * @param bpjsPekerja - BPJS Kesehatan worker portion
 * @returns upah_kotor_pajak
 */
export function calculateUpahKotorPajak(
    upahKotor: number,
    potKoreksi: number,
    pendapatanLainnya: number,
    bpjsPekerja: number
): number {
    // [SIGN-SAFETY] koreksi, lainnya, bpjs_pekerja wajib magnitude positif.
    return upahKotor
        - Math.abs(Number(potKoreksi) || 0)
        + Math.abs(Number(pendapatanLainnya) || 0)
        + Math.abs(Number(bpjsPekerja) || 0);
}

/**
 * Calculate PENGHASILAN BRUTO (Gross Income for PPh21 TER)
 *
 * = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + astek_majikan + bpjs_majikan
 *
 * @param upahKotor - Base gross
 * @param potKoreksi - Koreksi amount
 * @param pendapatanLainnya - THR + Bonus + Custom + KONTAN
 * @param astekMajikan - ASTEK employer portion
 * @param bpjsMajikan - BPJS Kesehatan employer portion
 * @returns penghasilan_bruto
 */
export function calculatePenghasilanBruto(
    upahKotor: number,
    potKoreksi: number,
    pendapatanLainnya: number,
    astekMajikan: number,
    bpjsMajikan: number
): number {
    // [SIGN-SAFETY] koreksi, lainnya, astek_m, bpjs_m wajib magnitude positif.
    return upahKotor
        - Math.abs(Number(potKoreksi) || 0)
        + Math.abs(Number(pendapatanLainnya) || 0)
        + Math.abs(Number(astekMajikan) || 0)
        + Math.abs(Number(bpjsMajikan) || 0);
}

/**
 * Calculate TOTAL POTONGAN BERSIH (Net Deductions after PREMI_PPH adjustment)
 *
 * = total_potongan - premi_pph
 *
 * @param totalPotongan - Total deductions
 * @param potPremiPph - PREMI_PPH (ADDITION to take-home, not deduction)
 * @returns total_potongan_bersih
 */
export function calculateTotalPotonganBersih(totalPotongan: number, potPremiPph: number): number {
    // [SIGN-SAFETY] premi_pph = ADDITION ke net pay, wajib magnitude positif.
    return totalPotongan - Math.abs(Number(potPremiPph) || 0);
}

/**
 * Calculate UPAH BERSIH (Take-Home Pay)
 *
 * = jumlah_upah_kotor - total_potongan + premi_pph
 * = (upah_kotor - pot_koreksi + pendapatan_lainnya) - total_potongan + premi_pph
 *
 * NOTE: premi_pph = ADDITION (penambah upah bersih), bukan potongan.
 *
 * @param jumlahUpahKotor - jumlah_upah_kotor
 * @param totalPotongan - total_potongan (including pendapatan_lainnya)
 * @param potPremiPph - PREMI_PPH (ADDITION)
 * @returns upah_bersih
 */
export function calculateUpahBersih(jumlahUpahKotor: number, totalPotongan: number, potPremiPph: number): number {
    // [SIGN-SAFETY] premi_pph = ADDITION ke net pay, wajib magnitude positif.
    return jumlahUpahKotor - totalPotongan + Math.abs(Number(potPremiPph) || 0);
}
