/**
 * PTKP Mapper - Single Source of Truth for beras_rate → PTKP → TER
 *
 * ELIMINATES duplicate mappings in:
 * - TaxCalculationService.ts
 * - PayrollCalculator.ts (getPTKPAmount, getTERCategory)
 * - Pph21TerService.ts (component)
 * - dataExtractorService.ts (local mapBerasRateToPTKP)
 *
 * Based on PP 58/2023 / PER-16/PJ/2022.
 */

import { PTKPStatus, TERCategory } from './types';

/**
 * Canonical Beras Rate → PTKP Status mapping
 *
 * Keys: daily beras rate values (e.g. 2250, 3250, 4200, 4650, etc.)
 * Monthly rates (>= 10000) are normalized by dividing by 30 before lookup.
 */
const BERAS_RATE_TO_PTKP: Record<number, PTKPStatus> = {
    // Standard rates
    2250: 'TK/0',
    3250: 'TK/1',
    4200: 'TK/2',
    3700: 'K/0',
    4650: 'K/1',
    5500: 'K/2',
    6450: 'K/3',
    // Legacy DB mappings (150/kg formulas)
    3150: 'TK/1',
    4050: 'TK/2',
    4950: 'TK/3',
    3600: 'K/0',
    4500: 'K/1',
    5400: 'K/2',
    6300: 'K/3',
    3750: 'K/0',  // Legacy before new 3700 rate
    5550: 'K/2',  // Legacy before new 5500 rate
};

/**
 * PTKP → TER Category mapping (PP 58/2023)
 *
 * TER A: TK/0, TK/1, K/0 (PTKP ≤ 58,500,000)
 * TER B: TK/2, TK/3, K/1, K/2 (PTKP 63,000,000 - 67,500,000)
 * TER C: K/3 (PTKP = 72,000,000)
 */
const PTKP_TO_TER: Record<PTKPStatus, TERCategory> = {
    'TK/0': 'TER A',
    'TK/1': 'TER A',
    'K/0':  'TER A',
    'TK/2': 'TER B',
    'TK/3': 'TER B',
    'K/1':  'TER B',
    'K/2':  'TER B',
    'K/3':  'TER C',
    '-':    '-',
};

/**
 * PTKP annual amounts by year
 */
const PTKP_AMOUNTS: Record<number, Record<PTKPStatus, number>> = {
    2025: {
        'TK/0': 54000000,
        'TK/1': 58500000,
        'TK/2': 63000000,
        'TK/3': 67500000,
        'K/0':  58500000,
        'K/1':  63000000,
        'K/2':  67500000,
        'K/3':  72000000,
        '-':    54000000,
    },
    2026: {
        'TK/0': 54000000,
        'TK/1': 58500000,
        'TK/2': 63000000,
        'TK/3': 67500000,
        'K/0':  58500000,
        'K/1':  63000000,
        'K/2':  67500000,
        'K/3':  72000000,
        '-':    54000000,
    },
};

/**
 * Map beras_rate to PTKP status
 *
 * Handles both daily rates (e.g. 4650) and monthly bulk values (e.g. 135000 = 4650 * 30)
 *
 * @param berasRate - Rice ration rate (daily or monthly)
 * @returns PTKP status string
 */
export function mapBerasRateToPTKP(berasRate: number): PTKPStatus {
    if (!berasRate || berasRate <= 0) return 'TK/0';

    // Handle monthly bulk values (e.g. 135000 = 4500 * 30)
    const normalizedRate = berasRate >= 10000 ? berasRate / 30 : berasRate;

    return BERAS_RATE_TO_PTKP[Math.round(normalizedRate)] || 'TK/0';
}

/**
 * Map PTKP status to TER category (PP 58/2023)
 *
 * @param ptkpStatus - PTKP status (TK/0, TK/1, K/0, etc.)
 * @returns TER category (TER A, TER B, TER C, or '-' for no tax)
 */
export function mapPTKPToTER(ptkpStatus: string): TERCategory {
    if (!ptkpStatus || ptkpStatus === '-') return '-';
    return PTKP_TO_TER[ptkpStatus as PTKPStatus] || 'TER B';
}

/**
 * Get PTKP annual amount for a given status and year
 *
 * @param ptkpStatus - PTKP status
 * @param year - Tax year
 * @returns Annual PTKP amount
 */
export function getPTKPAmount(ptkpStatus: string, year: number): number {
    const yearData = PTKP_AMOUNTS[year];
    if (!yearData) {
        console.warn(`[PTKPMapper] PTKP rates for year ${year} not found, using 2025 rates`);
        return PTKP_AMOUNTS[2025][ptkpStatus as PTKPStatus] || 54000000;
    }
    return yearData[ptkpStatus as PTKPStatus] || 54000000;
}

/**
 * Get TER category from PTKP status
 *
 * @param ptkpStatus - PTKP status
 * @returns TER category
 */
export function getTERCategory(ptkpStatus: string): TERCategory {
    return mapPTKPToTER(ptkpStatus);
}
