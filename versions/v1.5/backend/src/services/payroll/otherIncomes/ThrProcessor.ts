/**
 * ThrProcessor - THR (Tunjangan Hari Raya) Calculation
 *
 * Handles THR (religious holiday allowance) calculation logic:
 * - Prorated THR based on months of service
 * - Eligibility checks based on join date
 * - Religion-based THR handling
 *
 * Business Rules:
 * - THR = months_of_service / 12 × monthly_salary
 * - Minimum 12 months for full THR
 * - Prorated for < 12 months
 * - Only applies to employees with specific religions (Islam, Kristen, Katolik, Hindu, Buddha)
 *
 * @module payroll/otherIncomes/ThrProcessor
 */

import { Database } from '../../../db/client';
import { info, warn, error as logError } from '../../../utils/logger';

const CATEGORY = "ThrProcessor";

/**
 * THR eligibility result
 */
export interface ThrEligibility {
    eligible: boolean;
    months_of_service: number;
    prorated_ratio: number;
    reason?: string;
}

/**
 * THR calculation result
 */
export interface ThrCalculation {
    emp_code: string;
    thr_amount: number;
    taxable_amount: number;
    is_prorated: boolean;
    months_of_service: number;
    base_salary: number;
}

/**
 * THR configuration
 */
export interface ThrConfig {
    /** Minimum months of service for full THR */
    min_months_for_full: number;
    /** THR religion requirement */
    eligible_religions: string[];
    /** Full THR ratio (12/12 = 1.0) */
    full_thr_ratio: number;
}

/**
 * Default THR configuration
 */
const DEFAULT_CONFIG: ThrConfig = {
    min_months_for_full: 12,
    eligible_religions: ['ISLAM', 'KRISTEN', 'KATOLIK', 'HINDU', 'BUDDHA'],
    full_thr_ratio: 1.0
};

/**
 * Month difference calculator
 *
 * Calculates the number of months between two dates.
 */
function monthDiff(date1: Date, date2: Date): number {
    return (date2.getFullYear() - date1.getFullYear()) * 12 +
           (date2.getMonth() - date1.getMonth());
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr: any): Date | null {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;

    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;

    const parts = String(dateStr).split(/[\/\-]/);
    if (parts.length === 3) {
        if (parts[2].length === 4) {
            d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        } else if (parts[0].length === 4) {
            d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
        if (!isNaN(d.getTime())) return d;
    }

    return null;
}

/**
 * ThrProcessor - Handle THR calculations
 */
export class ThrProcessor {
    private db: Database;
    private config: ThrConfig;

    constructor(db?: Database, config?: Partial<ThrConfig>) {
        this.db = db || Database.getInstance();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check THR eligibility for an employee
     *
     * Determines if an employee is eligible for THR based on:
     * - Join date (must have worked at least 1 month)
     * - Religion (must be in eligible list)
     *
     * @param joinDate - Employee join date
     * @param periodDate - Period date for calculation
     * @param religion - Employee religion
     * @returns ThrEligibility result
     */
    checkEligibility(
        joinDate: string | null,
        periodDate: Date,
        religion?: string | null
    ): ThrEligibility {
        // Must have a join date
        if (!joinDate) {
            return { eligible: false, months_of_service: 0, prorated_ratio: 0, reason: 'No join date' };
        }

        const jd = parseDate(joinDate);
        if (!jd) {
            return { eligible: false, months_of_service: 0, prorated_ratio: 0, reason: 'Invalid join date' };
        }

        // Calculate months of service
        const months = monthDiff(jd, periodDate);

        if (months < 1) {
            return { eligible: false, months_of_service: months, prorated_ratio: 0, reason: 'Less than 1 month of service' };
        }

        // Check religion eligibility
        if (religion) {
            const upperReligion = religion.toUpperCase();
            const isEligibleReligion = this.config.eligible_religions.some(
                r => upperReligion.includes(r)
            );

            if (!isEligibleReligion) {
                return {
                    eligible: false,
                    months_of_service: months,
                    prorated_ratio: 0,
                    reason: `Religion '${religion}' not eligible for THR`
                };
            }
        }

        // Calculate prorated ratio
        const ratio = Math.min(months / 12, this.config.full_thr_ratio);

        return {
            eligible: true,
            months_of_service: months,
            prorated_ratio: ratio,
            reason: ratio < 1.0 ? `Prorated: ${months}/12 months` : 'Full THR'
        };
    }

    /**
     * Calculate prorated THR amount
     *
     * Formula: THR = (months_of_service / 12) × base_salary
     *
     * @param baseSalary - Monthly base salary
     * @param eligibility - Eligibility result from checkEligibility
     * @returns THR amount
     */
    calculateProrated(baseSalary: number, eligibility: ThrEligibility): number {
        if (!eligibility.eligible) {
            return 0;
        }

        return Math.round(baseSalary * eligibility.prorated_ratio);
    }

    /**
     * Calculate THR for multiple employees
     *
     * @param employees - Array of employee data
     * @param periodYear - THR period year
     * @param periodMonth - THR period month
     * @returns Map of emp_code → ThrCalculation
     */
    calculateBatch(
        employees: Array<{
            emp_code: string;
            join_date?: string | null;
            religion?: string | null;
            base_salary: number;
        }>,
        periodYear: number,
        periodMonth: number
    ): Map<string, ThrCalculation> {
        const periodDate = new Date(periodYear, periodMonth - 1, 1);
        const results = new Map<string, ThrCalculation>();

        for (const emp of employees) {
            const eligibility = this.checkEligibility(
                emp.join_date || null,
                periodDate,
                emp.religion
            );

            const thrAmount = this.calculateProrated(emp.base_salary, eligibility);

            results.set(emp.emp_code, {
                emp_code: emp.emp_code,
                thr_amount: thrAmount,
                taxable_amount: thrAmount, // THR is taxable
                is_prorated: eligibility.prorated_ratio < 1.0,
                months_of_service: eligibility.months_of_service,
                base_salary: emp.base_salary
            });
        }

        return results;
    }

    /**
     * Validate THR amount against expected formula
     *
     * @param calculatedAmount - Our calculated THR
     * @param formulaAmount - Expected amount from formula
     * @param tolerance - Acceptable difference percentage
     * @returns True if amounts match within tolerance
     */
    validateAmount(calculatedAmount: number, formulaAmount: number, tolerance = 0.01): boolean {
        if (formulaAmount === 0) {
            return calculatedAmount === 0;
        }

        const diff = Math.abs(calculatedAmount - formulaAmount);
        const ratio = diff / formulaAmount;

        return ratio <= tolerance;
    }

    /**
     * Get religion eligibility
     *
     * @param religion - Religion to check
     * @returns True if eligible for THR
     */
    isEligibleReligion(religion: string | null | undefined): boolean {
        if (!religion) return false;

        const upper = religion.toUpperCase();
        return this.config.eligible_religions.some(r => upper.includes(r));
    }
}

// Singleton instance
let instance: ThrProcessor | null = null;

export function getThrProcessor(): ThrProcessor {
    if (!instance) {
        instance = new ThrProcessor();
    }
    return instance;
}
