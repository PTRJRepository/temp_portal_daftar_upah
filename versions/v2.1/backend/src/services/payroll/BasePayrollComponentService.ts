/**
 * Base Payroll Component Service
 *
 * Abstract base class for all payroll component services.
 * Provides common functionality for:
 * - Metadata management
 * - Error handling
 * - Performance tracking
 *
 * All component services (lembur, premi, tunjangan, potongan, etc.)
 * should extend this class.
 */

import { Database } from '../../db/client';
import {
    PayrollCalculationInput,
    PayrollCalculationResult,
    BatchPayrollCalculationResult,
    PayrollCalculationOptions,
    IPayrollComponentService,
} from '../../types/payroll/BasePayrollTypes';
import { PayrollComponent, PayrollComponentMetadata } from '../../types/payroll/PayrollComponent';

/**
 * Abstract base class for all payroll component services
 */
export abstract class BasePayrollComponentService<TInput extends PayrollCalculationInput = PayrollCalculationInput, TOutput = any>
    implements IPayrollComponentService<TInput, TOutput> {
    // Abstract properties that subclasses MUST define
    public abstract readonly componentName: string;

    // Dependencies
    protected db: Database;

    constructor() {
        this.db = Database.getInstance();
    }

    // =========================================================================
    // ABSTRACT METHODS - Must be implemented by subclasses
    // =========================================================================

    /**
     * Calculate for a single employee
     */
    protected abstract calculateSingle(input: TInput): Promise<PayrollCalculationResult<TOutput>>;

    protected abstract calculateBatchInternal(inputs: TInput[]): Promise<BatchPayrollCalculationResult<TOutput>>;

    /**
     * Get calculation basis description for this component
     */
    protected abstract getBasisDescription(input: TInput): string;

    /**
     * Get cache key for this input
     */
    protected abstract getCacheKey(input: TInput): string;

    /**
     * Get cache TTL in seconds
     */
    protected abstract getCacheTTL(): number;

    // =========================================================================
    // PUBLIC INTERFACE
    // =========================================================================

    /**
     * Calculate payroll component for a single employee
     * Handles error handling and performance tracking. Caching is disabled.
     */
    public async calculate(
        input: TInput,
        options: PayrollCalculationOptions = {}
    ): Promise<PayrollCalculationResult<TOutput>> {
        // Perform calculation
        const startTime = performance.now();
        const result = await this.calculateSingle(input);
        result.execution_time_ms = performance.now() - startTime;

        return result;
    }

    /**
     * Calculate payroll component for multiple employees. Caching is disabled.
     */
    public async calculateBatch(
        inputs: TInput[],
        options: PayrollCalculationOptions = {}
    ): Promise<BatchPayrollCalculationResult<TOutput>> {
        const startTime = performance.now();
        const results = new Map<string, PayrollCalculationResult<TOutput>>();
        const errors: string[] = [];

        // Group inputs by period for efficient batch processing
        const groupedInputs = this.groupInputsByPeriod(inputs);

        // Process each group
        for (const [periodKey, periodInputs] of groupedInputs.entries()) {
            try {
                const batchResult = await this.calculateBatchInternal(periodInputs);

                // Add results to map
                for (const [empCode, result] of batchResult.results.entries()) {
                    results.set(empCode, result);
                }

                // Collect errors
                if (batchResult.summary.total_errors > 0) {
                    errors.push(`Period ${periodKey}: ${batchResult.summary.total_errors} errors`);
                }
            } catch (error) {
                errors.push(`Period ${periodKey}: ${error}`);
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
            meta: this.buildMetadata('CALCULATION', `Batch ${this.componentName} calculation`),
        };
    }

    /**
     * Get calculation basis description
     */
    public getCalculationBasis(input: TInput): string {
        return this.getBasisDescription(input);
    }

    /**
     * Get component metadata
     */
    public getComponentMetadata(): PayrollComponentMetadata {
        return this.buildMetadata('CALCULATION', `${this.componentName} component service`);
    }

    // =========================================================================
    // PROTECTED HELPER METHODS
    // =========================================================================

    /**
     * Build standard metadata object
     */
    protected buildMetadata(
        source: PayrollComponentMetadata['source'],
        description: string,
        additional: Partial<PayrollComponentMetadata> = {}
    ): PayrollComponentMetadata {
        return {
            source,
            description,
            last_updated: new Date(),
            calculated_at: new Date(),
            confidence_level: 'high',
            ...additional,
        };
    }

    /**
     * Create error result when calculation fails
     */
    protected createErrorResult(
        input: TInput,
        error: Error
    ): PayrollCalculationResult<TOutput> {
        return {
            component_name: this.componentName,
            input,
            output: {
                value: null as any,
                meta: this.buildMetadata('DEFAULT', `Error: ${error.message}`, {
                    confidence_level: 'low',
                    is_estimated: true,
                    errors: [error.message],
                }),
            },
            errors: [error.message],
            execution_time_ms: 0,
        };
    }

    /**
     * Group inputs by period for efficient batch processing
     */
    protected groupInputsByPeriod(inputs: TInput[]): Map<string, TInput[]> {
        const groups = new Map<string, TInput[]>();

        for (const input of inputs) {
            const key = `${input.year}-${input.month.toString().padStart(2, '0')}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(input);
        }

        return groups;
    }

    /**
     * Parse period key to year and month
     */
    protected parsePeriodKey(key: string): { year: number; month: number } {
        const [year, month] = key.split('-').map(Number);
        return { year, month };
    }
}
