/**
 * IncomeCategorizer - Categorize Other Incomes into Types
 *
 * Categorizes payroll other_incomes into standardized categories:
 * - THR: Tunjangan Hari Raya (religious holiday allowance)
 * - Bonus: Performance/annual bonuses
 * - Custom: Custom income types from payroll
 * - KONTAN: Cash payments (tunai)
 *
 * Uses DocDesc pattern matching and formula lookups to determine category.
 *
 * @module payroll/otherIncomes/IncomeCategorizer
 */

import { Database } from '../../../db/client';
import { debug, info, warn, error as logError } from '../../../utils/logger';

const CATEGORY = "IncomeCategorizer";

/**
 * Income type classification
 */
export type IncomeType = 'THR' | 'Bonus' | 'Custom' | 'KONTAN' | 'Unknown';

/**
 * Income categorization result
 */
export interface CategorizedIncome {
    income_type: IncomeType;
    income_name: string;
    amount: number;
    is_taxable: boolean;
    is_paid_in_thp: boolean;
}

/**
 * Formula lookup result from database
 */
export interface IncomeFormula {
    formula: string;
    is_paid_in_thp: boolean;
    is_taxable: boolean;
}

/**
 * IncomeCategorizer - Categorizes other incomes
 *
 * Handles the categorization logic for other incomes:
 * - Determines income type from DocDesc patterns
 * - Resolves taxable status from formulas
 * - Identifies KONTAN (cash) payments
 */
export class IncomeCategorizer {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Categorize an income based on its description
     *
     * Uses pattern matching on DocDesc to determine income type:
     * - THR: contains 'THR', 'TUNJANGAN HARI RAYA', 'GajiTHR', etc.
     * - Bonus: contains 'BONUS', 'Bonus', 'INSENTIF', etc.
     * - KONTAN: contains 'KONTAN', 'TUNAI', 'CASH'
     * - Custom: other DocDesc patterns
     *
     * @param docDesc - The document description to categorize
     * @returns IncomeType classification
     */
    categorizeByDocDesc(docDesc: string | null): IncomeType {
        if (!docDesc) return 'Unknown';

        const upper = docDesc.toUpperCase();

        // THR patterns
        if (upper.includes('THR') ||
            upper.includes('TUNJANGAN HARI RAYA') ||
            upper.includes('GAJITHR') ||
            upper.includes('THR GAJI')) {
            return 'THR';
        }

        // Bonus patterns
        if (upper.includes('BONUS') ||
            upper.includes('INSENTIF') ||
            upper.includes('PERFORMANCE')) {
            return 'Bonus';
        }

        // KONTAN patterns (cash payments)
        if (upper.includes('KONTAN') ||
            upper.includes('TUNAI') ||
            upper.includes('CASH')) {
            return 'KONTAN';
        }

        // Custom type - anything that doesn't match above
        return 'Custom';
    }

    /**
     * Get formula for an income type
     *
     * Looks up the formula definition from employee_other_incomes_formula table.
     *
     * @param incomeType - The income type (THR, Bonus, Custom)
     * @param db - Optional database instance
     * @returns Formula configuration or defaults
     */
    async getFormula(incomeType: string): Promise<IncomeFormula> {
        const db = this.db;

        try {
            const rows = await db.query<{ formula: string; is_paid_in_thp: number; is_taxable: number }>(`
                SELECT formula, is_paid_in_thp, is_taxable
                FROM employee_other_incomes_formula
                WHERE income_type = ?
            `, [incomeType]);

            if (rows.length > 0) {
                return {
                    formula: rows[0].formula || '',
                    is_paid_in_thp: Boolean(rows[0].is_paid_in_thp),
                    is_taxable: Boolean(rows[0].is_taxable)
                };
            }
        } catch (e) {
            logError(CATEGORY, `[getFormula] Error fetching formula for ${incomeType}:`, e);
        }

        // Default fallback
        return {
            formula: '',
            is_paid_in_thp: false,
            is_taxable: true
        };
    }

    /**
     * Get blacklist for an income type and period
     *
     * Blacklist contains employee codes that should be excluded from
     * specific income types (e.g., certain employees don't receive THR).
     *
     * @param year - Period year
     * @param month - Period month
     * @param type - Income type to check
     * @param db - Optional database instance
     * @returns Array of blacklisted employee codes
     */
    async getBlacklist(year: number, month: number, type: string): Promise<string[]> {
        const db = this.db;

        try {
            const rows = await db.query<{ emp_code: string }>(`
                SELECT RTRIM(emp_code) as emp_code
                FROM employee_other_incomes_blacklist
                WHERE period_year = ? AND period_month = ? AND income_type = ?
            `, [year, month, type]);

            return rows.map(r => r.emp_code?.trim() || '').filter(Boolean);
        } catch (e) {
            logError(CATEGORY, `[getBlacklist] Error fetching blacklist:`, e);
            return [];
        }
    }

    /**
     * Calculate taxable amount based on income type and formula
     *
     * Determines whether an income is taxable and how it should be
     * included in payslip calculations.
     *
     * @param incomeType - Type of income
     * @param amount - Raw amount
     * @param formula - Optional formula configuration
     * @returns Taxable amount (may be 0 for non-taxable)
     */
    calculateTaxableAmount(incomeType: IncomeType, amount: number, formula?: IncomeFormula): number {
        if (!formula) {
            // Default: THR and Bonus are taxable
            return incomeType === 'KONTAN' ? 0 : amount;
        }

        return formula.is_taxable ? amount : 0;
    }

    /**
     * Check if income should be paid in THP (Take-Home Pay)
     *
     * Some incomes are paid directly in the payslip (THP) while
     * others are separate payments.
     *
     * @param incomeType - Type of income
     * @param formula - Optional formula configuration
     * @returns True if should be included in THP
     */
    isPaidInThp(incomeType: IncomeType, formula?: IncomeFormula): boolean {
        if (formula) {
            return formula.is_paid_in_thp;
        }

        // Default: THR is usually paid in THP
        return incomeType === 'THR';
    }

    /**
     * Categorize multiple incomes at once
     *
     * Processes an array of income records and assigns categories
     * based on DocDesc patterns.
     *
     * @param incomes - Array of income records with doc_desc field
     * @returns Map of emp_code -> categorized incomes
     */
    categorizeBulk<T extends { doc_desc?: string | null }>(
        incomes: T[]
    ): Map<string, CategorizedIncome[]> {
        const result = new Map<string, CategorizedIncome[]>();

        for (const income of incomes) {
            const docDesc = income.doc_desc ?? null;
            const empCode = (income as any).emp_code?.trim() || '';
            const amount = (income as any).amount || 0;

            const incomeType = this.categorizeByDocDesc(docDesc);
            const categorized: CategorizedIncome = {
                income_type: incomeType,
                income_name: docDesc || 'Unknown',
                amount: amount,
                is_taxable: incomeType !== 'KONTAN',
                is_paid_in_thp: incomeType === 'THR'
            };

            const existing = result.get(empCode) || [];
            existing.push(categorized);
            result.set(empCode, existing);
        }

        return result;
    }
}

// Singleton instance
let instance: IncomeCategorizer | null = null;

export function getIncomeCategorizer(): IncomeCategorizer {
    if (!instance) {
        instance = new IncomeCategorizer();
    }
    return instance;
}
