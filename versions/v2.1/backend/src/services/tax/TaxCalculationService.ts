/**
 * Tax Calculation Service
 *
 * Centralized service for all tax calculations (PTKP & PPh21 TER).
 * Delegates PTKP mapping to payroll/formulas/PTKPMapper.ts (Single Source of Truth).
 *
 * IMPORTANT: TER rates are LAYERED based on monthly gross income (upah kotor).
 * Each TER category (A, B, C) has 40-44 layers with rates from 0% to 34%.
 * Example for TER A (PTKP TK/0, TK/1, K/0):
 *   - 0 - 5,400,000     → 0.00%
 *   - 5,400,001 - 5,650,000   → 0.25%
 *   - 5,650,001 - 5,950,000   → 0.50%
 *   - ... (continues up to 34% for highest income)
 *
 * Based on PP 58/2023 / PER-16/PJ/2022.
 */

import { Database } from "../../db/client";
import { mapBerasRateToPTKP, mapPTKPToTER, getPTKPAmount } from '../payroll/formulas/PTKPMapper';

/**
 * Input for tax calculation
 */
export interface TaxCalculationInput {
    empCode: string;
    berasRate: number;
    grossIncome: number;
    periodYear: number;
    periodMonth?: number;
}

/**
 * Result of tax calculation
 */
export interface TaxCalculationResult {
    ptkpStatus: string;
    terCategory: string;
    ptkpAmount: number;
    taxRate: number;
    taxAmount: number;
    netTax: number;
    isProgressive: boolean;
    breakdown?: TaxBreakdown[];
}

/**
 * Tax breakdown for progressive calculation
 */
export interface TaxBreakdown {
    tier: number;
    taxableIncome: number;
    rate: number;
    amount: number;
}

/**
 * PTKP Status enumeration
 */
export type PTKPStatus = 'TK/0' | 'TK/1' | 'TK/2' | 'TK/3' | 'K/0' | 'K/1' | 'K/2' | 'K/3' | '-';

/**
 * TER Category enumeration
 */
export type TERCategory = 'TER A' | 'TER B' | 'TER C' | '-';

/**
 * Tax Calculation Service - Single Source of Truth for Tax Calculations
 *
 * PTKP mapping delegated to payroll/formulas/PTKPMapper.ts
 */
export class TaxCalculationService {
    private static instance: TaxCalculationService;

    // TER Rates: Flat rates removed. TaxCalculationService now delegates to pph21TerService
    // which reads layered rates from rule_TER_pajak.json (PP 58/2023 / PER-16/PJ/2022).
    // The actual rate depends on BOTH TER category AND gross income range.
    // Use getTerRate(ptkpStatus, grossIncome) for the correct layered rate.
    // Kept only as fallback marker - DO NOT use these flat values for calculation.
    private static readonly TER_RATES_FALLBACK: Record<TERCategory, number> = {
        'TER A': 0,   // Layered: 0% - 34% depending on income
        'TER B': 0,   // Layered: 0% - 34% depending on income
        'TER C': 0,   // Layered: 0% - 34% depending on income
        '-': 0,       // No tax
    };

    // Progressive tax brackets (for reference)
    private static readonly PROGRESSIVE_BRACKETS = [
        { max: 60000000, rate: 0.05 },
        { max: 250000000, rate: 0.15 },
        { max: 500000000, rate: 0.25 },
        { max: Infinity, rate: 0.35 },
    ];

    private constructor() {}

    public static getInstance(): TaxCalculationService {
        if (!TaxCalculationService.instance) {
            TaxCalculationService.instance = new TaxCalculationService();
        }
        return TaxCalculationService.instance;
    }

    /**
     * Map Beras Rate to PTKP Status
     * Delegates to PTKPMapper (Single Source of Truth)
     *
     * @param berasRate - Rice ration rate (daily or monthly)
     * @returns PTKP status string
     */
    public mapBerasRateToPTKP(berasRate: number): PTKPStatus {
        return mapBerasRateToPTKP(berasRate);
    }

    /**
     * Map PTKP Status to TER Category
     * Delegates to PTKPMapper (Single Source of Truth)
     *
     * @param ptkpStatus - PTKP status (TK/0, TK/1, K/0, etc.)
     * @returns TER category
     */
    public mapPTKPToTER(ptkpStatus: string): TERCategory {
        return mapPTKPToTER(ptkpStatus);
    }

    /**
     * Get PTKP Amount based on status and year
     * Delegates to PTKPMapper (Single Source of Truth)
     *
     * @param ptkpStatus - PTKP status
     * @param year - Tax year
     * @returns Annual PTKP amount
     */
    public getPTKPAmount(ptkpStatus: string, year: number): number {
        return getPTKPAmount(ptkpStatus, year);
    }

    /**
     * Get tax rate based on TER category and gross income
     *
     * IMPORTANT: TER rates are LAYERED based on monthly gross income.
     * This method delegates to pph21TerService which reads from rule_TER_pajak.json.
     *
     * @param terCategory - TER category (TER A, TER B, TER C)
     * @param grossIncome - Monthly gross income (upah kotor bulanan)
     * @returns Decimal tax rate (e.g. 0.0025 for 0.25%)
     */
    public getTaxRate(terCategory: TERCategory, grossIncome: number): number {
        // Map TER category back to PTKP status for pph21TerService
        // We need the ptkpStatus to determine the correct layer
        // Since we only have TER category here, we map back:
        // TER A → any PTKP in TER A (TK/0)
        // TER B → any PTKP in TER B (K/1)
        // TER C → K/3
        const ptkpStatus = this.terCategoryToPTKP(terCategory);
        return this.getTerRateByPTKP(ptkpStatus, grossIncome);
    }

    /**
     * Get TER rate by PTKP status and gross income
     * Delegates to pph21TerService for layered rate lookup
     */
    private getTerRateByPTKP(ptkpStatus: string, grossIncome: number): number {
        try {
            const { pph21TerService } = require('../pph21TerService');
            const result = pph21TerService.calculatePph21Ter(grossIncome, ptkpStatus);
            return result.rate; // Decimal format (e.g. 0.0025)
        } catch (error) {
            console.warn(`[TaxCalculationService] Failed to get TER rate from pph21TerService: ${error}`);
            return 0;
        }
    }

    /**
     * Map TER category back to a representative PTKP status
     */
    private terCategoryToPTKP(terCategory: TERCategory): string {
        switch (terCategory) {
            case 'TER A': return 'TK/0';  // Representative for TER A group
            case 'TER B': return 'K/1';    // Representative for TER B group
            case 'TER C': return 'K/3';   // K/3 is the only TER C
            default: return 'TK/0';
        }
    }

    /**
     * Calculate complete tax for an employee using TER method
     *
     * IMPORTANT: Uses layered TER rates from rule_TER_pajak.json (PP 58/2023).
     * The rate depends on BOTH TER category AND monthly gross income range.
     * This delegates to pph21TerService which reads the layered rates.
     *
     * TER (Tarif Efektif Rata-rata) is different from progressive tax:
     * - Progressive: PPh21 = (Annual Income - PTKP) × marginal rate
     * - TER: PPh21 = Monthly Bruto × Layered Rate (where layer is based on
     *          the "kurang dari PTKP" concept → rate reflects PTKP-adjusted income)
     *
     * Example for TER A, gross income 10,000,000:
     *   - Layer 11: 10,350,001 - 10,700,000 → rate = 2.50%
     *   - PPh21 bulanan = 10,000,000 × 2.50% = 250,000
     *
     * @param input - Tax calculation input
     * @returns Complete tax calculation result
     */
    public calculate(input: TaxCalculationInput): TaxCalculationResult {
        const ptkpStatus = this.mapBerasRateToPTKP(input.berasRate);
        const terCategory = this.mapPTKPToTER(ptkpStatus);
        const ptkpAmount = this.getPTKPAmount(ptkpStatus, input.periodYear);

        // Delegate to pph21TerService for layered TER rate
        let taxRate = 0;
        let taxAmount = 0;
        try {
            const { pph21TerService } = require('../pph21TerService');
            const terResult = pph21TerService.calculatePph21Ter(input.grossIncome, ptkpStatus);
            taxRate = terResult.rate;           // Decimal (e.g. 0.025 for 2.5%)
            taxAmount = terResult.tax_amount;    // Monthly PPh21 in rupiah
        } catch (error) {
            console.warn(`[TaxCalculationService] TER calculation failed: ${error}`);
            // Fallback: calculate manually with progressive-ish approximation
            const annualIncome = input.grossIncome * 12;
            const taxableAnnualIncome = Math.max(0, annualIncome - ptkpAmount);
            // Use TER A base rate as rough fallback
            taxRate = 0.05;
            taxAmount = Math.round(input.grossIncome * taxRate);
        }

        return {
            ptkpStatus,
            terCategory,
            ptkpAmount,
            taxRate,
            taxAmount,
            netTax: taxAmount,
            isProgressive: false,
        };
    }

    /**
     * Calculate tax using progressive method (alternative to TER)
     *
     * @param grossMonthlyIncome - Gross monthly income
     * @param ptkpStatus - PTKP status
     * @param year - Tax year
     * @returns Progressive tax calculation result
     */
    public calculateProgressive(grossMonthlyIncome: number, ptkpStatus: string, year: number): TaxCalculationResult {
        const ptkpAmount = this.getPTKPAmount(ptkpStatus, year);
        const annualIncome = grossMonthlyIncome * 12;
        const taxableIncome = Math.max(0, annualIncome - ptkpAmount);

        // Calculate progressive tax
        const breakdown: TaxBreakdown[] = [];
        let remainingIncome = taxableIncome;
        let totalTax = 0;
        let previousMax = 0;

        for (const bracket of TaxCalculationService.PROGRESSIVE_BRACKETS) {
            const tierIncome = Math.min(remainingIncome, bracket.max - previousMax);

            if (tierIncome > 0) {
                const tierTax = Math.round(tierIncome * bracket.rate);
                totalTax += tierTax;

                breakdown.push({
                    tier: breakdown.length + 1,
                    taxableIncome: tierIncome,
                    rate: bracket.rate,
                    amount: tierTax,
                });

                remainingIncome -= tierIncome;
                previousMax = bracket.max;
            }

            if (remainingIncome <= 0) break;
        }

        return {
            ptkpStatus,
            terCategory: 'TER A', // Not applicable for progressive
            ptkpAmount,
            taxRate: 0, // Not applicable
            taxAmount: Math.round(totalTax / 12),
            netTax: Math.round(totalTax / 12),
            isProgressive: true,
            breakdown,
        };
    }

    /**
     * Get all PTKP statuses for dropdown/form
     */
    public getAllPTKPStatuses(): PTKPStatus[] {
        return ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];
    }

    /**
     * Get all TER categories
     */
    public getTERCategories(): TERCategory[] {
        return ['TER A', 'TER B', 'TER C'];
    }

    /**
     * Validate PTKP status
     */
    public isValidPTKP(status: string): boolean {
        return ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'].includes(status);
    }
}

// Export singleton instance
export const taxCalculationService = TaxCalculationService.getInstance();
