/**
 * Premi (Premium) Component Service
 *
 * Calculates premiums from PR_ADTRANS where DocDesc contains 'PREMI'.
 * Extends BasePayrollComponentService for consistent architecture.
 */

import { Database } from '../../../db/client';
import { BasePayrollComponentService } from '../BasePayrollComponentService';
import {
    PayrollCalculationInput,
    PayrollCalculationResult,
    BatchPayrollCalculationResult,
} from '../../../types/payroll/BasePayrollTypes';
import { PayrollComponent, PayrollComponentMetadata } from '../../../types/payroll/PayrollComponent';

/**
 * Input for premi calculation
 */
export interface PremiInput extends PayrollCalculationInput {
    exclude_patterns?: string[];  // e.g., ['PPH', 'LEMBUR', 'BRONDOL', 'PRUN']
}

/**
 * Output from premi calculation
 */
export interface PremiOutput {
    total_premi: number;
    breakdown: Record<string, PayrollComponent<number>>;  // Field name -> component
    brondol: PayrollComponent<number>;
    pruning: PayrollComponent<number>;
    dynamic_premi: PayrollComponent<number>[];
}

/**
 * Premi Service - Component service for premium calculation
 */
export class PremiService extends BasePayrollComponentService<PremiInput, PremiOutput> {
    public readonly componentName = 'premi';

    // Default exclude patterns
    private readonly DEFAULT_EXCLUDE_PATTERNS = [
        'PPH',
        'PPH21',
        'PPH 21',
        'LEMBUR',
        'BRONDOL',
        'PRUN',
        'PRUNING',
        'PRUNING',
        'KOREKSI',
        'KOREKSI PANEN',
        'POTONGAN KOREKSI',
        'SPSI',
        'TUNJANGAN JABATAN',
        'TUNJANGAN MASA KERJA',
        'TUNJANGAN BERAS',
        'JABATAN',
        'BERAS',
        'MASA',
        'POTONGAN',
    ];

    constructor() {
        super();
    }

    // =========================================================================
    // REQUIRED ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    /**
     * Calculate premi for a single employee
     */
    protected async calculateSingle(input: PremiInput): Promise<PayrollCalculationResult<PremiOutput>> {
        try {
            const { emp_code, month, year, exclude_patterns = [] } = input;
            const allExcludes = [...this.DEFAULT_EXCLUDE_PATTERNS, ...exclude_patterns];

            // Fetch premi from database
            const premiData = await this.fetchPremiFromDatabase(emp_code, month, year, allExcludes, input.server_profile);

            // Process and categorize
            const output = this.processPremiData(premiData, allExcludes);

            const resultOutput: PayrollComponent<PremiOutput> = {
                value: output,
                meta: this.buildMetadata('DATABASE_PLANTWARE', 'Premium from PR_ADTRANS', {
                    taxable: true,
                    calculation_basis: this.getCalculationBasis(input),
                    dependencies: ['PR_ADTRANS', 'PR_TASKCODE'],
                    confidence_level: 'high',
                    version: 1,
                }),
            };

            return {
                component_name: this.componentName,
                input,
                output: resultOutput,
            };
        } catch (error) {
            return this.createErrorResult(input, error as Error);
        }
    }

    /**
     * Calculate premi for multiple employees (batch)
     */
    protected async calculateBatchInternal(inputs: PremiInput[]): Promise<BatchPayrollCalculationResult<PremiOutput>> {
        const startTime = performance.now();
        const results = new Map<string, PayrollCalculationResult<PremiOutput>>();
        const errors: string[] = [];

        // Group by period
        const groupedInputs = this.groupInputsByPeriod(inputs);

        for (const [periodKey, periodInputs] of groupedInputs.entries()) {
            const { year, month } = this.parsePeriodKey(periodKey);
            const empCodes = periodInputs.map((i) => i.emp_code);
            const allExcludes = [...this.DEFAULT_EXCLUDE_PATTERNS];

            try {
                // Batch fetch all employees for this period
                const batchData = await this.fetchBatchPremi(empCodes, month, year, allExcludes, inputs[0].server_profile);

                // Process each employee
                for (const periodInput of periodInputs) {
                    const empData = batchData[periodInput.emp_code] || {};
                    const output = this.processPremiData(empData, allExcludes);

                    const resultOutput: PayrollComponent<PremiOutput> = {
                        value: output,
                        meta: this.buildMetadata('DATABASE_PLANTWARE', 'Batch premium calculation', {
                            taxable: true,
                            calculation_basis: this.getCalculationBasis(periodInput),
                            dependencies: ['PR_ADTRANS', 'PR_TASKCODE'],
                            confidence_level: 'high',
                            version: 1,
                        }),
                    };

                    results.set(periodInput.emp_code, {
                        component_name: this.componentName,
                        input: periodInput,
                        output: resultOutput,
                    });
                }
            } catch (error) {
                errors.push(`Period ${periodKey}: ${error}`);

                // Create error results for this group
                for (const periodInput of periodInputs) {
                    results.set(periodInput.emp_code, this.createErrorResult(periodInput, error as Error));
                }
            }
        }

        return {
            results,
            summary: {
                total_calculated: results.size,
                total_errors: errors.length,
                execution_time_ms: performance.now() - startTime,
                cached_count: 0,
            },
            meta: this.buildMetadata('CALCULATION', 'Batch premi calculation', {
                confidence_level: 'high',
            }),
        };
    }

    /**
     * Get calculation basis description
     */
    protected getBasisDescription(input: PremiInput): string {
        return `SUM(Amount) from PR_ADTRANS WHERE DocDesc LIKE '%PREMI%' AND TrxDate IN period ${input.month}/${input.year}`;
    }

    /**
     * Get cache key
     */
    protected getCacheKey(input: PremiInput): string {
        return `premi:${input.emp_code}:${input.month}:${input.year}`;
    }

    /**
     * Get cache TTL (30 minutes - premi changes less frequently)
     */
    protected getCacheTTL(): number {
        return 1800;
    }

    // =========================================================================
    // PRIVATE HELPER METHODS
    // =========================================================================

    /**
     * Fetch premi from database for single employee
     */
    private async fetchPremiFromDatabase(
        emp_code: string,
        month: number,
        year: number,
        exclude_patterns: string[],
        serverProfile?: string
    ): Promise<Record<string, number>> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${month.toString().padStart(2, '0')}-${daysInMonth}`;

        // Query BOTH PR_ADTRANS (active) and PR_ADTRANS_ARC (archived) tables
        const rows = await db.query<{
            DocDesc: string;
            Amount: number;
        }>(`
            SELECT DocDesc, SUM(Amount) as Amount
            FROM (
                SELECT DocDesc, Amount FROM PR_ADTRANS
                WHERE EmpCode = ?
                  AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE '%PREMI%'
                  AND Status IN (1, 3)
                UNION ALL
                SELECT DocDesc, Amount FROM PR_ADTRANS_ARC
                WHERE EmpCode = ?
                  AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE '%PREMI%'
                  AND Status = 3
            ) combined
            GROUP BY DocDesc
        `, [emp_code, startDate, endDate, emp_code, startDate, endDate]);

        // Filter and categorize
        const result: Record<string, number> = {};
        for (const row of rows) {
            const docDesc = (row.DocDesc || '').trim();

            // Check if this item should be excluded
            if (this.shouldExclude(docDesc, exclude_patterns)) {
                continue;
            }

            // Use clean field name
            const fieldName = this.cleanFieldName(docDesc);
            result[fieldName] = (result[fieldName] || 0) + (row.Amount || 0);
        }

        return result;
    }

    /**
     * Fetch premi for multiple employees (batch)
     */
    private async fetchBatchPremi(
        emp_codes: string[],
        month: number,
        year: number,
        exclude_patterns: string[],
        serverProfile?: string
    ): Promise<Record<string, Record<string, number>>> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${month.toString().padStart(2, '0')}-${daysInMonth}`;

        const empList = emp_codes.map((e) => `'${e}'`).join(',');

        // Query BOTH PR_ADTRANS (active) and PR_ADTRANS_ARC (archived) tables
        const rows = await db.query<{
            EmpCode: string;
            DocDesc: string;
            Amount: number;
        }>(`
            SELECT EmpCode, DocDesc, SUM(Amount) as Amount
            FROM (
                SELECT EmpCode, DocDesc, Amount FROM PR_ADTRANS
                WHERE RTRIM(EmpCode) IN (${empList})
                  AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE '%PREMI%'
                  AND Status IN (1, 3)
                UNION ALL
                SELECT EmpCode, DocDesc, Amount FROM PR_ADTRANS_ARC
                WHERE RTRIM(EmpCode) IN (${empList})
                  AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE '%PREMI%'
                  AND Status = 3
            ) combined
            GROUP BY EmpCode, DocDesc
        `, [startDate, endDate, startDate, endDate]);

        // Organize by employee
        const result: Record<string, Record<string, number>> = {};
        for (const emp_code of emp_codes) {
            result[emp_code] = {};
        }

        for (const row of rows) {
            const empCode = row.EmpCode?.trim();
            const docDesc = (row.DocDesc || '').trim();

            if (!result[empCode]) continue;

            // Check if this item should be excluded
            if (this.shouldExclude(docDesc, exclude_patterns)) {
                continue;
            }

            const fieldName = this.cleanFieldName(docDesc);
            result[empCode][fieldName] = (result[empCode][fieldName] || 0) + (row.Amount || 0);
        }

        return result;
    }

    /**
     * Process premi data into output structure
     */
    private processPremiData(
        premiData: Record<string, number>,
        exclude_patterns: string[]
    ): PremiOutput {
        const breakdown: Record<string, PayrollComponent<number>> = {};
        let brondolAmount = 0;
        let pruningAmount = 0;
        const dynamicPremi: PayrollComponent<number>[] = [];

        // Categorize each premi item
        for (const [key, amount] of Object.entries(premiData)) {
            const component: PayrollComponent<number> = {
                value: amount,
                meta: this.buildMetadata('DATABASE_PLANTWARE', `Premium: ${key}`, {
                    calculation_basis: `SUM(Amount) where DocDesc='${key}'`,
                    confidence_level: 'high',
                }),
            };

            // Check for brondol
            if (this.matchesPattern(key, ['BRONDOL'])) {
                brondolAmount += amount;
                breakdown[`premi_brondol`] = component;
            }
            // Check for pruning
            else if (this.matchesPattern(key, ['PRUN', 'PRUNING'])) {
                pruningAmount += amount;
                breakdown[`premi_pruning`] = component;
            }
            // Dynamic premi
            else {
                dynamicPremi.push(component);
                breakdown[key] = component;
            }
        }

        // Calculate total
        const totalPremi = Object.values(premiData).reduce((sum, val) => sum + val, 0);

        return {
            total_premi: totalPremi,
            breakdown,
            brondol: {
                value: brondolAmount,
                meta: this.buildMetadata('DATABASE_PLANTWARE', 'Brondol premium (aggregated)', {
                    calculation_basis: 'SUM of all BRONDOL-related premiums',
                    confidence_level: 'high',
                }),
            },
            pruning: {
                value: pruningAmount,
                meta: this.buildMetadata('DATABASE_PLANTWARE', 'Pruning premium (aggregated)', {
                    calculation_basis: 'SUM of all PRUNING-related premiums',
                    confidence_level: 'high',
                }),
            },
            dynamic_premi: dynamicPremi,
        };
    }

    /**
     * Check if a DocDesc should be excluded
     */
    private shouldExclude(docDesc: string, patterns: string[]): boolean {
        const upperDesc = docDesc.toUpperCase();
        return patterns.some((pattern) => upperDesc.includes(pattern.toUpperCase()));
    }

    /**
     * Check if DocDesc matches any of the given patterns
     */
    private matchesPattern(docDesc: string, patterns: string[]): boolean {
        const upperDesc = docDesc.toUpperCase();
        return patterns.some((pattern) => upperDesc.includes(pattern.toUpperCase()));
    }

    /**
     * Clean DocDesc to create valid field name
     */
    private cleanFieldName(docDesc: string): string {
        return docDesc
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }
}

// Export singleton instance
export const premiService = new PremiService();
