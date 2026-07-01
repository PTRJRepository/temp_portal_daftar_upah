/**
 * Aggregation Adapter - Convert aggregation row data to PayrollCalculatorInput
 *
 * This adapter bridges the gap between:
 * 1. Raw row data from aggregation queries (with various field name formats)
 * 2. The structured PayrollCalculatorInput interface
 *
 * IMPORTANT: This adapter ONLY adapts field shapes and names.
 * It does NOT recalculate values - all calculations go through PayrollCalculator.
 */

import { PayrollFormulaInput } from '../types';

/**
 * Safely get numeric value from a row, handling various field name formats
 */
function getNumeric(row: any, ...keys: string[]): number {
    for (const key of keys) {
        const val = row[key];
        if (val !== null && val !== undefined && val !== '') {
            const num = Number(val);
            if (!isNaN(num)) return num;
        }
    }
    return 0;
}

/**
 * Check if row has an explicit numeric value for the given key.
 * This lets us distinguish "field absent" vs "field present with 0".
 */
function hasNumeric(row: any, key: string): boolean {
    const val = row?.[key];
    if (val === null || val === undefined || val === '') return false;
    return !isNaN(Number(val));
}

/**
 * Calculate total tunjangan from row components
 */
function calculateRowTotalTunjangan(row: any): number {
    // Canonical contract:
    // - if total_tunjangan is provided, treat it as authoritative.
    // - only derive from components when total_tunjangan is missing.
    if (hasNumeric(row, 'total_tunjangan')) {
        return getNumeric(row, 'total_tunjangan');
    }
    return getNumeric(row, 'beras_jumlah')
        + getNumeric(row, 'jabatan_jumlah')
        + getNumeric(row, 'masa_kerja_jumlah')
        + getNumeric(row, 'lembur_jumlah');
}

/**
 * Calculate total premi from row components
 */
function calculateRowTotalPremi(row: any): number {
    const premiCols = [
        'premi_brondol', 'premi_pruning',
        'premi_dynamic_1', 'premi_dynamic_2', 'premi_dynamic_3',
        'premi_dynamic_4', 'premi_dynamic_5', 'premi_dynamic_6', 'premi_dynamic_7',
    ];
    return premiCols.reduce((sum, col) => sum + getNumeric(row, col), 0);
}

/**
 * Convert aggregation row data to PayrollCalculatorInput
 *
 * Handles:
 * - Alternative field names (gaji_pokok vs gaji_pokok_aktual)
 * - Missing fields (defaults to 0)
 * - Field aliases (pot_astek_pekerja vs astek_pekerja)
 *
 * @param row - Raw aggregation row data
 * @returns PayrollCalculatorInput ready for PayrollCalculator.calculate()
 */
export function rowToPayrollCalculatorInput(row: any): PayrollFormulaInput {
    const totalPremi = getNumeric(row, 'total_premi') || calculateRowTotalPremi(row);
    const totalTunjangan = getNumeric(row, 'total_tunjangan') || calculateRowTotalTunjangan(row);
    const gajiPokok = getNumeric(row, 'gaji_pokok_aktual') || getNumeric(row, 'gaji_pokok') || 0;

    return {
        // Earnings components
        gaji_pokok_aktual: gajiPokok,
        beras_jumlah: getNumeric(row, 'beras_jumlah'),
        jabatan_jumlah: getNumeric(row, 'jabatan_jumlah'),
        masa_kerja_jumlah: getNumeric(row, 'masa_kerja_jumlah'),
        lembur_jumlah: getNumeric(row, 'lembur_jumlah'),
        total_tunjangan: totalTunjangan,
        total_premi: totalPremi,
        pot_koreksi: Math.abs(getNumeric(row, 'pot_koreksi') || getNumeric(row, 'koreksi') || 0),
        // [SIGN-SAFETY] pendapatan_lainnya = earning magnitude, wajib positif.
        pendapatan_lainnya: Math.abs(getNumeric(row, 'pendapatan_lainnya')
            || getNumeric(row, 'pot_pendapatan_lainnya')
            || getNumeric(row, 'pendapatan_thr')
            || 0),

        // Deductions (worker portions) — [SIGN-SAFETY] wajib magnitude positif.
        pot_astek_pekerja: Math.abs(getNumeric(row, 'pot_astek_pekerja') || getNumeric(row, 'astek_pekerja') || 0),
        pot_bpjs_kesehatan_pekerja: Math.abs(getNumeric(row, 'pot_bpjs_kesehatan_pekerja') || getNumeric(row, 'bpjs_kes_pekerja') || 0),
        pot_bpjs_pensiun_pekerja: Math.abs(getNumeric(row, 'pot_bpjs_pensiun_pekerja') || getNumeric(row, 'bpjs_pensiun_pekerja') || 0),
        pot_spsi: Math.abs(getNumeric(row, 'pot_spsi') || getNumeric(row, 'spsi') || 0),
        pot_pph21: Math.abs(getNumeric(row, 'pot_pph21') || getNumeric(row, 'pph21') || 0),
        other_potongan: Math.abs(getNumeric(row, 'other_potongan') || 0),
        pot_premi_pph: Math.abs(getNumeric(row, 'pot_premi_pph') || getNumeric(row, 'premi_pph') || 0),

        // Tax calculation (employer portions) — [SIGN-SAFETY] magnitude positif.
        astek_majikan: Math.abs(getNumeric(row, 'astek_majikan') || 0),
        bpjs_majikan: Math.abs(getNumeric(row, 'bpjs_majikan') || 0),
    };
}
