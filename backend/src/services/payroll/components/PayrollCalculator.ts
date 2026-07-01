/**
 * PayrollCalculator - Single Source of Truth for all derived payroll field formulas
 *
 * This class centralizes ALL calculations of derived payroll fields to ensure
 * consistency across every tab/service/report in the system.
 *
 * IMPORTANT BUSINESS RULES (Final 2026-04-03):
 *
 * ADA 3 LEVEL UPAH:
 *
 * 1. UPAH KOTOR (Gross dasar - tanpa koreksi/pendapatan_lainnya)
 *    = gaji_pokok_aktual + total_tunjangan + total_premi
 *
 * 2. JUMLAH UPAH KOTOR (Tampilan Daftar Upah)
 *    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya
 *    NOTE: koreksi di-SUBTRACT dari gross, lainnya di-ADD ke gross untuk TAMPILAN saja.
 *
 * 3. PENGHASILAN BRUTO (Untuk PPh21 TER)
 *    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya
 *      + astek_majikan + bpjs_majikan
 *    NOTE: koreksi & lainnya adalah bagian dari penghasilan kena pajak.
 *
 * 4. UPAH KOTOR PAJAK (Untuk header/tampilan pajak)
 *    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + bpjs_pekerja
 *
 * 5. TOTAL POTONGAN (Total Pengurangan dari Take-Home Pay)
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
 *
 * PTKP mapping delegated to payroll/formulas/PTKPMapper.ts (Single Source of Truth)
 */

import { getPTKPAmount, getTERCategory } from '../formulas/PTKPMapper';

export interface PayrollCalculatorInput {
    // Earnings components
    gaji_pokok_aktual: number;
    beras_jumlah: number;
    jabatan_jumlah: number;
    masa_kerja_jumlah: number;
    lembur_jumlah: number;
    total_tunjangan: number;   // beras + jabatan + masa_kerja + lembur
    total_premi: number;       // all premi EXCLUDING koreksi (koreksi handled separately)
    pot_koreksi: number;       // displayed separately in potongan_upah_kotor; subtracted in gross display
    pendapatan_lainnya: number; // THR + Bonus + Custom + custom types; ALL taxable

    // Deductions components
    pot_astek_pekerja: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_spsi: number;
    pot_pph21: number;
    other_potongan: number; // all other dynamic potongan
    pot_premi_pph: number;  // PREMI_PPH = ADDITION, not deduction

    // Tax calculation components (employer portions)
    astek_majikan: number;   // 0.84% of (payrate * 30 + masa_kerja)
    bpjs_majikan: number;    // 4% of (payrate * 30 + masa_kerja)
}

export interface PayrollCalculatorResult {
    // Core gross wage (3 levels)
    upah_kotor: number;           // UPAH KOTOR: gaji + tunjangan + total_premi (tanpa koreksi/lainnya)
    jumlah_upah_kotor: number;    // Tampilan: upah_kotor - pot_koreksi + pendapatan_lainnya
    potongan_upah_kotor: number;   // pot_koreksi (displayed separately)

    // Tax calculation
    upah_kotor_pajak: number;    // taxable: upah_kotor - pot_koreksi + pendapatan_lainnya + bpjs_pekerja
    penghasilan_bruto: number;    // for PPh21 TER: upah_kotor - pot_koreksi + pendapatan_lainnya + astek_m + bpjs_m
    tarif_pajak_ter: number;       // TER rate percentage (5, 15, or 25)
    pph21_ter: number;            // PPh21 using TER method
    taxable_pendapatan_lainnya: number; // same as pendapatan_lainnya (all taxable)

    // Total deductions
    total_potongan: number;      // astek + bpjs_kes + bpjs_pensiun + spsi + pph21 (NO koreksi, NO lainnya)
    total_potongan_bersih: number; // total_potongan - premi_pph

    // Take-home pay
    upah_bersih: number;          // jumlah_upah_kotor - total_potongan + premi_pph

    // Component breakdown for display
    komponen_kotor: {
        gaji_pokok: number;
        tunjangan: number;       // without lembur
        lembur: number;
        premi: number;           // all premi excluding koreksi
        subtotal: number;        // = UPAH KOTOR (tanpa koreksi/lainnya)
        koreksi: number;         // pot_koreksi (separate display)
        lainnya: number;          // THR, Bonus, Custom, etc.
        grand_subtotal: number;   // = JUMLAH UPAH KOTOR (dengan koreksi/lainnya)
    };
    komponen_potongan: {
        astek_pekerja: number;
        bpjs_kes_pekerja: number;
        bpjs_pensiun_pekerja: number;
        spsi: number;
        pph21: number;
        subtotal: number;        // = TOTAL POTONGAN (tanpa koreksi/lainnya)
    };
}

export class PayrollCalculator {
    public static calculate(
        input: PayrollCalculatorInput,
        statusPtkp: string = '-',
        periodYear: number = new Date().getFullYear()
    ): PayrollCalculatorResult {
        const potKoreksi = Math.abs(Number(input.pot_koreksi) || 0);

        // ─────────────────────────────────────────────────────────
        // 1. UPAH KOTOR (Gross dasar - tanpa koreksi/lainnya)
        //    Digunakan sebagai basis untuk semua perhitungan.
        // ─────────────────────────────────────────────────────────
        const komponen_kotor = {
            gaji_pokok: input.gaji_pokok_aktual,
            tunjangan: input.total_tunjangan - input.lembur_jumlah, // exclude lembur from tunjangan display
            lembur: input.lembur_jumlah,
            premi: input.total_premi,          // excludes koreksi (koreksi shown separately)
            subtotal: 0, // computed below
            koreksi: potKoreksi,
            lainnya: Math.abs(Number(input.pendapatan_lainnya) || 0), // [SIGN-SAFETY] earning magnitude, wajib positif
            grand_subtotal: 0, // computed below
        };
        komponen_kotor.subtotal =
            komponen_kotor.gaji_pokok +
            komponen_kotor.tunjangan +
            komponen_kotor.lembur +
            komponen_kotor.premi;

        // ─────────────────────────────────────────────────────────
        // 2. JUMLAH UPAH KOTOR (Tampilan Daftar Upah)
        //    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya
        // ─────────────────────────────────────────────────────────
        komponen_kotor.grand_subtotal =
            komponen_kotor.subtotal -
            komponen_kotor.koreksi +
            komponen_kotor.lainnya;

        const upah_kotor = komponen_kotor.subtotal;
        const jumlah_upah_kotor = komponen_kotor.grand_subtotal;
        const potongan_upah_kotor = potKoreksi;

        // ─────────────────────────────────────────────────────────
        // 3. UPAH KOTOR PAJAK (Taxable Gross for header/pajak display)
        //    = UPAH KOTOR - pot_koreksi + pendapatan_lainnya + bpjs_pekerja
        //    [SIGN-SAFETY] pendapatan_lainnya & bpjs_pekerja di-abs: earning/magnitude
        //    wajib positif. Input negatif tidak boleh flip gross.
        // ─────────────────────────────────────────────────────────
        const upah_kotor_pajak =
            komponen_kotor.subtotal
            - potKoreksi
            + Math.abs(Number(input.pendapatan_lainnya) || 0)
            + Math.abs(Number(input.pot_bpjs_kesehatan_pekerja) || 0);

        // ─────────────────────────────────────────────────────────
        // 4. TOTAL POTONGAN (Total Pengurangan dari Take-Home Pay)
        //    = astek + bpjs_kes + bpjs_pensiun + spsi + pph21 + other + pendapatan_lainnya
        //    NOTE: koreksi TIDAK masuk total_potongan karena sudah termasuk
        //    di jumlah_upah_kotor (Grand Subtotal). Jika masuk total_potongan,
        //    maka akan di-subtract 2x → upah_bersih minus.
        //    NOTE: pendapatan_lainnya (THR+Bonus+Custom+KONTAN) di-subtract di sini
        //    karena di jumlah_upah_kotor di-add sebagai tambahan (+) Gross.
        // ─────────────────────────────────────────────────────────
        const komponen_potongan = {
            astek_pekerja: Math.abs(Number(input.pot_astek_pekerja) || 0),
            bpjs_kes_pekerja: Math.abs(Number(input.pot_bpjs_kesehatan_pekerja) || 0),
            bpjs_pensiun_pekerja: Math.abs(Number(input.pot_bpjs_pensiun_pekerja) || 0),
            spsi: Math.abs(Number(input.pot_spsi) || 0),
            pph21: Math.abs(Number(input.pot_pph21) || 0),
            other: Math.abs(Number(input.other_potongan) || 0),
            lainnya: Math.abs(Number(input.pendapatan_lainnya) || 0),
            subtotal: 0, // computed below
        };
        komponen_potongan.subtotal =
            komponen_potongan.astek_pekerja +
            komponen_potongan.bpjs_kes_pekerja +
            komponen_potongan.bpjs_pensiun_pekerja +
            komponen_potongan.spsi +
            komponen_potongan.pph21 +
            komponen_potongan.other +
            komponen_potongan.lainnya;

        const total_potongan = komponen_potongan.subtotal;

        // ─────────────────────────────────────────────────────────
        // 5. TOTAL POTONGAN BERSIH (Net Deductions after PREMI_PPH adjustment)
        //    = total_potongan - premi_pph
        //    [SIGN-SAFETY] premi_pph di-abs: ADDITION ke net pay, wajib positif magnitude.
        // ─────────────────────────────────────────────────────────
        const total_potongan_bersih = total_potongan - Math.abs(Number(input.pot_premi_pph) || 0);

        // ─────────────────────────────────────────────────────────
        // 6. PENGHASILAN BRUTO (Gross Income for PPh21 TER)
        //    = JUMLAH UPAH KOTOR + astek_majikan + bpjs_majikan
        //    where: JUMLAH UPAH KOTOR = upah_kotor - pot_koreksi + pendapatan_lainnya
        //    This ensures penghasilan_bruto ALWAYS includes pendapatan_lainnya (THR, Bonus, Custom, KONTAN)
        // ─────────────────────────────────────────────────────────
        const penghasilan_bruto =
            jumlah_upah_kotor
            + Math.abs(Number(input.astek_majikan) || 0)
            + Math.abs(Number(input.bpjs_majikan) || 0);

        // ─────────────────────────────────────────────────────────
        // 7. PPh21 TER Calculation
        // ─────────────────────────────────────────────────────────
        const ptkpAmount = this.getPTKPAmount(statusPtkp, periodYear);
        let rate = 0;
        let tax = 0;
        try {
            const { pph21TerService } = require('../../pph21TerService');
            const terResult = pph21TerService.calculatePph21Ter(penghasilan_bruto, statusPtkp);
            rate = terResult.rate_percent;
            tax = terResult.tax_amount;
        } catch (e) {
            console.error("Failed to calculate TER using pph21TerService, fallback to 0", e);
        }

        // ─────────────────────────────────────────────────────────
        // 8. UPAH BERSIH (Take-Home Pay)
        //    = JUMLAH UPAH KOTOR - total_potongan + premi_pph
        //    = (upah_kotor - pot_koreksi + pendapatan_lainnya) - total_potongan + premi_pph
        //    dimana: total_potongan = astek + bpjs + spsi + pph21 + other + pendapatan_lainnya
        // ─────────────────────────────────────────────────────────
        const upah_bersih = jumlah_upah_kotor - total_potongan + Math.abs(Number(input.pot_premi_pph) || 0);

        return {
            // Core gross
            upah_kotor,
            jumlah_upah_kotor,
            potongan_upah_kotor,
            // Tax
            upah_kotor_pajak,
            penghasilan_bruto,
            tarif_pajak_ter: rate,
            pph21_ter: tax,
            taxable_pendapatan_lainnya: Math.abs(Number(input.pendapatan_lainnya) || 0),
            // Deductions
            total_potongan,
            total_potongan_bersih,
            // Take-home
            upah_bersih,
            // Breakdown
            komponen_kotor,
            komponen_potongan,
        };
    }

    private static getPTKPAmount(statusPtkp: string, year: number): number {
        return getPTKPAmount(statusPtkp, year);
    }

    private static getTERCategory(statusPtkp: string): string {
        return getTERCategory(statusPtkp);
    }
}
