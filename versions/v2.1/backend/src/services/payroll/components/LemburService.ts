/**
 * Lembur (Overtime) Component Service
 *
 * Calculates overtime (lembur) payments with tier-based rates.
 * Extends BasePayrollComponentService for consistent architecture.
 *
 * This service wraps the existing lemburCalculator while adding
 * metadata support and standardized interfaces.
 */

import { Database } from '../../../db/client';
import { lemburCalculator } from '../../lemburCalculator';
import { payrollService } from '../../payrollService';
import { BasePayrollComponentService } from '../BasePayrollComponentService';
import {
    PayrollCalculationInput,
    PayrollCalculationResult,
    BatchPayrollCalculationResult,
    PayrollCalculationOptions,
} from '../../../types/payroll/BasePayrollTypes';
import { PayrollComponent, PayrollComponentMetadata } from '../../../types/payroll/PayrollComponent';
import { DayType, getDayTypeDisplayName } from '../../lemburCalculator';

/**
 * Input for lembur calculation
 */
export interface LemburInput extends PayrollCalculationInput {
    include_details?: boolean;
    upj?: number;  // Optional override UPJ
}

/**
 * Output from lembur calculation
 */
export interface LemburOutput {
    total_hours: number;
    total_amount: number;
    records: LemburRecord[];
    breakdown: {
        by_day_type: Record<string, { hours: number; amount: number; count: number }>;
        by_task: Record<string, { hours: number; amount: number; count: number }>;
    };
}

/**
 * Individual overtime transaction record with metadata
 */
export interface LemburRecord {
    trx_date: string;      // Format: YYYY-MM-DD
    day_name: string;      // Minggu, Senin, etc.
    day_type: string;      // Hari Kerja, Minggu, Libur Umum, Libur Keagamaan
    task_code: string;
    task_desc: string;
    hours: number;
    rate: number;          // Weighted average rate
    amount: number;
    /** Human-readable rate description, e.g.: "7 jam @ 1.5x + 7 jam @ 2x" */
    uraian: string;
    /** UPJ value used in calculation */
    upj_value: number;
    meta: PayrollComponentMetadata;
}

/**
 * Lembur Service - Component service for overtime calculation
 */
export class LemburService extends BasePayrollComponentService<LemburInput, LemburOutput> {
    public readonly componentName = 'lembur';

    // Default UPJ from environment
    private defaultUpj: number;

    constructor() {
        super();
        this.defaultUpj = parseFloat(process.env.LEMBUR_UPJ || '17257');
    }

    // =========================================================================
    // REQUIRED ABSTRACT METHOD IMPLEMENTATIONS
    // =========================================================================

    /**
     * Calculate overtime for a single employee
     */
    protected async calculateSingle(input: LemburInput): Promise<PayrollCalculationResult<LemburOutput>> {
        const { emp_code, month, year, include_details = true, upj } = input;

        try {
            // Get UPJ (override or calculate from payrate)
            const effectiveUpj = upj || await this.getEmployeeUpj(emp_code, input.server_profile);

            // Use existing lemburCalculator for calculation
            const calculatorResult = await lemburCalculator.calculate(emp_code, month, year, effectiveUpj);

            // Transform to our standard format
            const records = this.transformRecords(calculatorResult.records);
            const output: PayrollComponent<LemburOutput> = {
                value: {
                    total_hours: calculatorResult.total_hours || 0,
                    total_amount: calculatorResult.total_payment || 0,
                    records,
                    breakdown: this.createBreakdown(records),
                },
                meta: this.buildMetadata('CALCULATION', 'Overtime payment from PR_TASKREGLN with OT=1', {
                    taxable: true,
                    calculation_basis: this.getCalculationBasis(input),
                    dependencies: ['PR_TASKREGLN', 'PR_TASKCODE', 'HR_GPH'],
                    confidence_level: 'high',
                    version: 1,
                }),
            };

            return {
                component_name: this.componentName,
                input,
                output,
            };
        } catch (error) {
            return this.createErrorResult(input, error as Error);
        }
    }

    /**
     * Calculate overtime for multiple employees
     */
    protected async calculateBatchInternal(inputs: LemburInput[]): Promise<BatchPayrollCalculationResult<LemburOutput>> {
        const startTime = performance.now();
        const results = new Map<string, PayrollCalculationResult<LemburOutput>>();
        const errors: string[] = [];

        // Group inputs by period
        const groupedInputs = this.groupInputsByPeriod(inputs);

        for (const [periodKey, periodInputs] of groupedInputs.entries()) {
            const { year, month } = this.parsePeriodKey(periodKey);
            const empCodes = periodInputs.map((i) => i.emp_code);

            try {
                // Use existing batch calculation from lemburCalculator
                const batchResult = await lemburCalculator.calculateBatchDataWithTaskBreakdown(
                    empCodes,
                    month,
                    year,
                    inputs[0].server_profile
                );

                // Transform each employee's result
                for (const periodInput of periodInputs) {
                    const empData = batchResult[periodInput.emp_code];
                    if (!empData) continue;

                    const records = this.transformBatchRecords(empData.records || []);
                    const output: PayrollComponent<LemburOutput> = {
                        value: {
                            total_hours: empData.total_hours || 0,
                            total_amount: empData.total_payment || 0,
                            records,
                            breakdown: this.createBreakdown(records),
                        },
                        meta: this.buildMetadata('CALCULATION', 'Batch overtime calculation', {
                            taxable: true,
                            calculation_basis: this.getCalculationBasis(periodInput),
                            dependencies: ['PR_TASKREGLN', 'PR_TASKCODE', 'HR_GPH'],
                            confidence_level: 'high',
                            version: 1,
                        }),
                    };

                    results.set(periodInput.emp_code, {
                        component_name: this.componentName,
                        input: periodInput,
                        output,
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
            meta: this.buildMetadata('CALCULATION', 'Batch lembur calculation', {
                confidence_level: 'high',
            }),
        };
    }

    /**
     * Get calculation basis description
     */
    protected getBasisDescription(input: LemburInput): string {
        const upj = input.upj || this.defaultUpj;
        return `UPJ: ${upj}, Period: ${input.month}/${input.year}, Source: PR_TASKREGLN WHERE OT=1`;
    }

    /**
     * Get cache key for this input
     */
    protected getCacheKey(input: LemburInput): string {
        return `lembur:${input.emp_code}:${input.month}:${input.year}:${input.include_details}`;
    }

    /**
     * Get cache TTL (1 hour)
     */
    protected getCacheTTL(): number {
        return 3600;
    }

    // =========================================================================
    // PRIVATE HELPER METHODS
    // =========================================================================

    /**
     * Get employee UPJ (calculate from payrate or use default)
     */
    private async getEmployeeUpj(empCode: string, serverProfile?: string): Promise<number> {
        try {
            const payrates = await payrollService.getPayratesMap([empCode], serverProfile);
            const payrate = payrates[empCode] || 0;
            return payrate > 0 ? (payrate * 30) / 173 : this.defaultUpj;
        } catch {
            return this.defaultUpj;
        }
    }

    /**
     * Transform calculator records to our format with metadata
     */
    private transformRecords(records: any[]): LemburRecord[] {
        return records.map((rec) => {
            const date = rec.trx_date instanceof Date ? rec.trx_date : new Date(rec.trx_date);
            return {
                trx_date: date.toISOString().substring(0, 10),
                day_name: this.getDayName(date),
                day_type: rec.day_type ? getDayTypeDisplayName(rec.day_type) : '-',
                task_code: rec.task_code || '',
                task_desc: rec.task_desc || rec.task_code || '-',
                hours: rec.hours || 0,
                rate: rec.breakdown?.total_rate || 0,
                amount: rec.breakdown?.total_amount || rec.amount || 0,
                uraian: rec.breakdown?.uraian || '',
                upj_value: rec.breakdown?.upj_value || 0,
                meta: this.buildMetadata('DATABASE_PLANTWARE', `Overtime transaction on ${rec.trx_date}`, {
                    calculation_basis: `Hours: ${rec.hours}, Rate: ${rec.breakdown?.total_rate || 0}`,
                    confidence_level: 'high',
                }),
            };
        });
    }

    /**
     * Transform batch records (from calculateBatchDataWithTaskBreakdown)
     */
    private transformBatchRecords(records: any[]): LemburRecord[] {
        return records.map((rec) => ({
            trx_date: rec.date || '',
            day_name: rec.day_name || '',
            day_type: rec.day_type || '',
            task_code: rec.task_code || '',
            task_desc: rec.task_desc || rec.task_code || '-',
            hours: rec.hours || 0,
            rate: rec.rate || 0,
            amount: rec.amount || 0,
            uraian: rec.uraian || '',
            upj_value: rec.upj_value || 0,
            meta: this.buildMetadata('DATABASE_PLANTWARE', `Overtime transaction`, {
                calculation_basis: `Hours: ${rec.hours}, Rate: ${rec.rate}`,
                confidence_level: 'high',
            }),
        }));
    }

    /**
     * Create breakdown by day type and task
     */
    private createBreakdown(records: LemburRecord[]): LemburOutput['breakdown'] {
        const by_day_type: Record<string, { hours: number; amount: number; count: number }> = {};
        const by_task: Record<string, { hours: number; amount: number; count: number }> = {};

        for (const record of records) {
            // Group by day type
            if (!by_day_type[record.day_type]) {
                by_day_type[record.day_type] = { hours: 0, amount: 0, count: 0 };
            }
            by_day_type[record.day_type].hours += record.hours;
            by_day_type[record.day_type].amount += record.amount;
            by_day_type[record.day_type].count += 1;

            // Group by task
            if (!by_task[record.task_desc]) {
                by_task[record.task_desc] = { hours: 0, amount: 0, count: 0 };
            }
            by_task[record.task_desc].hours += record.hours;
            by_task[record.task_desc].amount += record.amount;
            by_task[record.task_desc].count += 1;
        }

        return { by_day_type, by_task };
    }

    /**
     * Get day name from date
     */
    private getDayName(date: Date): string {
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        return days[date.getDay()];
    }
}

// Export singleton instance
export const lemburService = new LemburService();

// Export backward compatibility wrapper (keeps existing API working)
export const lemburCalculatorCompat = {
    calculate: (empCode: string, month: number, year: number, upj?: number) => {
        return lemburCalculator.calculate(empCode, month, year, upj);
    },
    calculateBatchData: (empCodes: string[], month: number, year: number, serverProfile?: string) => {
        return lemburCalculator.calculateBatchData(empCodes, month, year, serverProfile);
    },
    calculateBatchDataWithTaskBreakdown: (empCodes: string[], month: number, year: number, serverProfile?: string) => {
        return lemburCalculator.calculateBatchDataWithTaskBreakdown(empCodes, month, year, serverProfile);
    },
};
