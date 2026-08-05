/**
 * Enhanced metadata for all payroll components
 * Provides traceability, audit trail, and dependency tracking
 */
export interface PayrollComponentMetadata {
    // Data source identification
    source: 'DATABASE_PLANTWARE' | 'DATABASE_VENUS' | 'CALCULATION' | 'MANUAL' | 'DEFAULT' | 'CACHE';

    // Tax information
    taxable?: boolean;

    // Description and documentation
    description?: string;
    calculation_basis?: string;  // Formula or method used

    // Timestamps
    last_updated?: Date;
    calculated_at?: Date;

    // Confidence and validation
    confidence_level?: 'high' | 'medium' | 'low';
    is_estimated?: boolean;

    // Dependency tracking
    dependencies?: string[];  // What other components/data this depends on

    // Version control
    version?: number;  // Formula version for tracking changes

    // Extended properties for custom use
    [key: string]: any;
}

/**
 * Generic payroll component with value and metadata
 * This is the standard wrapper for ALL payroll data
 */
export interface PayrollComponent<T = number> {
    value: T;
    meta: PayrollComponentMetadata;
}

/**
 * Simplified component for numeric amounts only (legacy support)
 * @deprecated Use PayrollComponent<number> instead
 */
export interface PayrollComponentV2 {
    amount: number;
    meta: PayrollComponentMetadata;
}
