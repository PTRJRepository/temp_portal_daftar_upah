/**
 * Base Payroll Types
 *
 * Core type definitions for the unified payroll data architecture.
 * All payroll components should use these standardized interfaces.
 */

import { PayrollComponent, PayrollComponentMetadata } from './PayrollComponent';

/**
 * Standard input for payroll component calculations
 * All component services accept this or an extension of it
 */
export interface PayrollCalculationInput {
    // Employee identification
    emp_code: string;

    // Period
    month: number;
    year: number;

    // Common calculation inputs (optional - not all components need all)
    upah_dasar?: number;
    jumlah_hk?: number;
    hari_kerja?: number;
    payrate?: number;
    beras_rate?: number;
    masa_kerja_tahun?: number;

    // Location context
    gang_code?: string;
    loc_code?: string;
    div_code?: string;

    // Database profile for queries
    server_profile?: string;
}

/**
 * Standard result from payroll component calculation
 * All component services should return this format
 */
export interface PayrollCalculationResult<T = any> {
    component_name: string;
    input: PayrollCalculationInput;
    output: PayrollComponent<T>;
    calculation_details?: Record<string, any>;
    execution_time_ms?: number;
    cached?: boolean;
    errors?: string[];
}

/**
 * Batch calculation result for multiple employees
 */
export interface BatchPayrollCalculationResult<T = any> {
    results: Map<string, PayrollCalculationResult<T>>;  // emp_code -> result
    summary: {
        total_calculated: number;
        total_errors: number;
        execution_time_ms: number;
        cached_count: number;
    };
    meta: PayrollComponentMetadata;
}

/**
 * Options for component calculation
 */
export interface PayrollCalculationOptions {
    useCache?: boolean;
    forceRecalculate?: boolean;
    includeDetails?: boolean;
    timeoutMs?: number;
}

/**
 * Component service interface
 * Defines the contract that all payroll component services must follow
 */
export interface IPayrollComponentService<TInput extends PayrollCalculationInput = PayrollCalculationInput, TOutput = any> {
    readonly componentName: string;

    // Single employee calculation
    calculate(input: TInput, options?: PayrollCalculationOptions): Promise<PayrollCalculationResult<TOutput>>;

    // Batch calculation for multiple employees
    calculateBatch(inputs: TInput[], options?: PayrollCalculationOptions): Promise<BatchPayrollCalculationResult<TOutput>>;

    // Get calculation basis description
    getCalculationBasis(input: TInput): string;

    // Get component metadata
    getComponentMetadata(): PayrollComponentMetadata;
}

/**
 * Day type classification for overtime calculations
 */
export enum DayType {
    WORKDAY_LONG = 'WORKDAY_LONG',      // Mon-Thu, Sat (7 hours)
    WORKDAY_SHORT = 'WORKDAY_SHORT',    // Friday (5.5 hours)
    SUNDAY = 'SUNDAY',                  // Sunday
    HOLIDAY_REGULAR = 'HOLIDAY_REGULAR',      // Regular holidays
    HOLIDAY_RELIGIOUS = 'HOLIDAY_RELIGIOUS'   // Religious holidays
}

/**
 * Overtime breakdown for tier-based calculation
 */
export interface OvertimeBreakdown {
    tier_1_rate: number;
    tier_1_hours: number;
    tier_1_amount: number;
    tier_1_boundary: number;
    tier_2_rate: number;
    tier_2_hours: number;
    tier_2_amount: number;
    tier_3_rate: number;
    tier_3_hours: number;
    tier_3_amount: number;
    total_rate: number;
    total_amount: number;
}
