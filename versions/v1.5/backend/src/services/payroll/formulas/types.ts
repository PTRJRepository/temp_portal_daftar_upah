/**
 * Shared Types for Payroll Formulas
 *
 * These interfaces are the canonical type definitions for ALL payroll calculations.
 * Single Source of Truth - do not duplicate across services.
 */

/**
 * PTKP Status based on marital status and number of dependents
 */
export type PTKPStatus = 'TK/0' | 'TK/1' | 'TK/2' | 'TK/3' | 'K/0' | 'K/1' | 'K/2' | 'K/3' | '-';

/**
 * TER Category (Tarif Efektif Rata-rata) - PP 58/2023
 */
export type TERCategory = 'TER A' | 'TER B' | 'TER C' | '-';

/**
 * Input for PayrollCalculator - matches PayrollCalculatorInput exactly
 */
export interface PayrollFormulaInput {
    // Earnings components
    gaji_pokok_aktual: number;
    beras_jumlah: number;
    jabatan_jumlah: number;
    masa_kerja_jumlah: number;
    lembur_jumlah: number;
    total_tunjangan: number;    // beras + jabatan + masa_kerja + lembur
    total_premi: number;        // all premi EXCLUDING koreksi
    pot_koreksi: number;        // koreksi HK - subtracted in gross display, NOT in total_potongan
    pendapatan_lainnya: number;  // THR + Bonus + Custom + KONTAN - in both gross AND total_potongan

    // Deductions (worker/employee portions)
    pot_astek_pekerja: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_spsi: number;
    pot_pph21: number;
    other_potongan: number;
    pot_premi_pph: number;  // PREMI_PPH = ADDITION, not deduction

    // Tax calculation (employer portions)
    astek_majikan: number;
    bpjs_majikan: number;
}

/**
 * Result from PayrollCalculator - matches PayrollCalculatorResult exactly
 */
export interface PayrollFormulaResult {
    // Core gross wage (3 levels)
    upah_kotor: number;           // gaji + tunjangan + total_premi (tanpa koreksi/lainnya)
    jumlah_upah_kotor: number;    // upah_kotor - pot_koreksi + pendapatan_lainnya
    potongan_upah_kotor: number;   // pot_koreksi (displayed separately)

    // Tax calculation
    upah_kotor_pajak: number;    // taxable: upah_kotor - pot_koreksi + pendapatan_lainnya + bpjs_pekerja
    penghasilan_bruto: number;    // for PPh21 TER: upah_kotor - pot_koreksi + pendapatan_lainnya + astek_m + bpjs_m
    tarif_pajak_ter: number;       // TER rate percentage
    pph21_ter: number;            // PPh21 using TER method
    taxable_pendapatan_lainnya: number;

    // Total deductions
    total_potongan: number;      // astek + bpjs_kes + bpjs_pensiun + spsi + pph21 + other + lainnya (NO koreksi)
    total_potongan_bersih: number; // total_potongan - premi_pph

    // Take-home pay
    upah_bersih: number;          // jumlah_upah_kotor - total_potongan + premi_pph

    // Component breakdowns
    komponen_kotor: KomponenKotor;
    komponen_potongan: KomponenPotongan;
}

/**
 * Breakdown of gross wage components
 */
export interface KomponenKotor {
    gaji_pokok: number;
    tunjangan: number;  // total_tunjangan - lembur_jumlah (for display)
    lembur: number;
    premi: number;
    subtotal: number;   // gaji_pokok + tunjangan + lembur + premi
    koreksi: number;
    lainnya: number;
    grand_subtotal: number;  // subtotal - koreksi + lainnya = jumlah_upah_kotor
}

/**
 * Breakdown of deduction components
 */
export interface KomponenPotongan {
    astek_pekerja: number;
    bpjs_kes_pekerja: number;
    bpjs_pensiun_pekerja: number;
    spsi: number;
    pph21: number;
    other: number;
    lainnya: number;  // pendapatan_lainnya (for structural integrity)
    subtotal: number;  // total_potongan
}

/**
 * Pendapatan Lainnya breakdown
 */
export interface PendapatanLainnyaBreakdown {
    thr: number;
    bonus: number;
    custom: number;
    kontan: number;
    total: number;  // thr + bonus + custom + kontan
}
