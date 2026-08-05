/**
 * CarumanDefinitions - Single Source of Truth
 * 
 * Semua persentase BPJS, ASTEK, dan Pensiun didefinisikan di sini.
 * Service lain WAJIB menggunakan fungsi dari file ini.
 * 
 * BASE = (Upah Dasar × 30) + Tunjangan Masa Kerja
 * 
 * Konteks:
 * - "Gaji Standar" = Upah Dasar × 30
 * - "Caruman Base" = Gaji Standar + Tunjangan Masa Kerja
 */

// ============================================================
// RATE DEFINITIONS (Single Source of Truth)
// ============================================================

export const CARUMAN_RATES = {
    // ASTEK / Jamsostek
    ASTEK_PEKERJA_JHT: 0.02,          // JHT Pekerja 2%
    ASTEK_MAJIKAN_JKK_JKM: 0.0084,    // JKK/JKM Majikan 0.84%
    ASTEK_MAJIKAN_JHT: 0.037,         // JHT Majikan 3.7%
    ASTEK_MAJIKAN_TOTAL: 0.0454,       // JKK/JKM + JHT = 0.84% + 3.7% = 4.54%

    // BPJS Kesehatan
    BPJS_KES_PEKERJA: 0.01,           // Kesehatan Pekerja 1%
    BPJS_KES_MAJIKAN: 0.04,           // Kesehatan Majikan 4%

    // BPJS Pensiun
    BPJS_PENSIUN_PEKERJA: 0.01,       // Pensiun Pekerja 1%
    BPJS_PENSIUN_MAJIKAN: 0.02,       // Pensiun Majikan 2%
} as const;

// ============================================================
// RESULT INTERFACE
// ============================================================

export interface CarumanResult {
    /** Base: (Upah Dasar × 30) + Tunjangan Masa Kerja */
    base: number;
    /** Gaji Standar: Upah Dasar × 30 */
    gajiStandar: number;

    // ASTEK
    astek_pekerja_jht: number;         // 2%
    astek_majikan_jkk_jkm: number;     // 0.84%
    astek_majikan_jht: number;         // 3.7%
    astek_majikan_total: number;       // 4.54% (JKK/JKM + JHT)

    // BPJS Kesehatan
    bpjs_kes_pekerja: number;          // 1%
    bpjs_kes_majikan: number;          // 4%

    // BPJS Pensiun
    bpjs_pensiun_pekerja: number;      // 1%
    bpjs_pensiun_majikan: number;      // 2%

    // Aggregated totals
    total_pekerja: number;             // All pekerja portions
    total_majikan: number;             // All majikan portions
    grand_total: number;
}

// ============================================================
// CALCULATION FUNCTIONS
// ============================================================

/**
 * Calculate the Caruman Base.
 * BASE = (Upah Dasar × 30) + Tunjangan Masa Kerja
 */
export function getCarumanBase(upahDasar: number, masaKerjaJumlah: number): number {
    return (upahDasar * 30) + masaKerjaJumlah;
}

/**
 * Get Gaji Standar (Upah Dasar × 30)
 */
export function getGajiStandar(upahDasar: number): number {
    return upahDasar * 30;
}

/** Standard rounding: round to nearest integer */
function r(value: number): number {
    return Math.round(value);
}

/**
 * Calculate ALL caruman components from upah dasar and masa kerja.
 * This is the SINGLE function all services should call.
 */
export function calculateAllCaruman(upahDasar: number, masaKerjaJumlah: number): CarumanResult {
    const gajiStandar = getGajiStandar(upahDasar);
    const base = gajiStandar + masaKerjaJumlah;

    const astek_pekerja_jht = r(base * CARUMAN_RATES.ASTEK_PEKERJA_JHT);
    const astek_majikan_jkk_jkm = r(base * CARUMAN_RATES.ASTEK_MAJIKAN_JKK_JKM);
    const astek_majikan_jht = r(base * CARUMAN_RATES.ASTEK_MAJIKAN_JHT);
    const astek_majikan_total = r(base * CARUMAN_RATES.ASTEK_MAJIKAN_TOTAL);

    const bpjs_kes_pekerja = r(base * CARUMAN_RATES.BPJS_KES_PEKERJA);
    const bpjs_kes_majikan = r(base * CARUMAN_RATES.BPJS_KES_MAJIKAN);

    const bpjs_pensiun_pekerja = r(base * CARUMAN_RATES.BPJS_PENSIUN_PEKERJA);
    const bpjs_pensiun_majikan = r(base * CARUMAN_RATES.BPJS_PENSIUN_MAJIKAN);

    const total_pekerja = astek_pekerja_jht + bpjs_kes_pekerja + bpjs_pensiun_pekerja;
    const total_majikan = astek_majikan_total + bpjs_kes_majikan + bpjs_pensiun_majikan;

    return {
        base,
        gajiStandar,
        astek_pekerja_jht,
        astek_majikan_jkk_jkm,
        astek_majikan_jht,
        astek_majikan_total,
        bpjs_kes_pekerja,
        bpjs_kes_majikan,
        bpjs_pensiun_pekerja,
        bpjs_pensiun_majikan,
        total_pekerja,
        total_majikan,
        grand_total: total_pekerja + total_majikan,
    };
}

/**
 * Convenience: Get only the components needed for PPh21 bruto calculation.
 * PPh21 Bruto uses:
 *  - ASTEK Majikan JKK/JKM (0.84%)
 *  - BPJS Kes Majikan (4%)
 */
export function getCarumanForPph21(upahDasar: number, masaKerjaJumlah: number): {
    base: number;
    gajiStandar: number;
    astek_majikan_084: number;
    bpjs_kes_majikan_4: number;
} {
    const gajiStandar = getGajiStandar(upahDasar);
    const base = gajiStandar + masaKerjaJumlah;
    return {
        base,
        gajiStandar,
        astek_majikan_084: r(base * CARUMAN_RATES.ASTEK_MAJIKAN_JKK_JKM),
        bpjs_kes_majikan_4: r(base * CARUMAN_RATES.BPJS_KES_MAJIKAN),
    };
}
