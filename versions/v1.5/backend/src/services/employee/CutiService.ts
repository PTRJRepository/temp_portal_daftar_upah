/**
 * Cuti Service
 *
 * Centralized service for managing employee leave (cuti) data.
 * Provides:
 * - Leave type classification
 * - Working days calculation after leave
 * - Leave balance management
 *
 * Note: This service provides calculation logic.
 * Actual leave records are stored in the database.
 */

import { Database } from "../../db/client";

/**
 * Leave type enumeration
 */
export enum CutiType {
    TAHUNAN = 'TAHUNAN',
    SAKIT = 'SAKIT',
    HAID = 'HAID',
    MINGGU = 'MINGGU',
    NASIONAL = 'NASIONAL',
    MELAHIRKAN = 'MELAHIRKAN',
    KHUSUS = 'KHUSUS'
}

/**
 * Input for leave calculation
 */
export interface CutiCalculationInput {
    totalHk: number;              // Total hari kerja (HK)
    cutiTahunan: number;         // Annual leave days
    cutiSakit: number;           // Sick leave days
    cutiHaid: number;            // Menstrual leave days
    cutiMinggu: number;          // Sunday leave (HK Minggu)
    cutiNasional: number;        // National holiday leave (HK Libur)
}

/**
 * Result of leave calculation
 */
export interface CutiCalculationResult {
    totalCutiDays: number;
    cutiTahunanDays: number;
    cutiSakitDays: number;
    cutiMingguDays: number;
    cutiNasionalDays: number;
    effectiveWorkingDays: number;
    hasAnyLeave: boolean;
    isExcludedFromPayroll: boolean;
}

/**
 * Employee leave data from database
 */
export interface CutiData {
    empCode: string;
    periodMonth: number;
    periodYear: number;
    totalHk: number;  // Total working days (HK)
    cuti_tahunan: number;
    cuti_sakit_haid: number;
    cuti_minggu: number;
    cuti_nasional: number;
}

/**
 * Cuti Service - Single Source of Truth for Leave Calculations
 */
export class CutiService {
    private static instance: CutiService;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): CutiService {
        if (!CutiService.instance) {
            CutiService.instance = new CutiService();
        }
        return CutiService.instance;
    }

    /**
     * Calculate working days after deducting all leave
     *
     * This is the CRITICAL calculation used for payroll filtering.
     * Based on MEMORY.md rules:
     * - Only HK Minggu/Libur Nasional (0 work days) → FILTERED OUT
     * - 0 HK but HAS other leave (tahunan, sakit/haid) → KEPT
     * - HK work > 0 → Always KEPT
     */
    public calculateWorkingDays(input: CutiCalculationInput): CutiCalculationResult {
        const {
            totalHk,
            cutiTahunan,
            cutiSakit,
            cutiMinggu,
            cutiNasional
        } = input;

        // Total leave days (excluding haid which is part of sakit)
        const totalLeaveDays = cutiTahunan + cutiSakit + cutiMinggu + cutiNasional;

        // Effective working days = HK - (Minggu + Nasional)
        // This is what determines if employee appears in payroll
        const effectiveWorkingDays = Math.max(0, totalHk - cutiMinggu - cutiNasional);

        // Check if employee should be excluded
        // Only exclude if: effective HK <= 0 AND no other leave
        const otherLeave = cutiTahunan + cutiSakit;
        const isExcludedFromPayroll = effectiveWorkingDays <= 0 && otherLeave === 0;

        return {
            totalCutiDays: totalLeaveDays,
            cutiTahunanDays: cutiTahunan,
            cutiSakitDays: cutiSakit, // Already includes haid (cuti_sakit_haid)
            cutiMingguDays: cutiMinggu,
            cutiNasionalDays: cutiNasional,
            effectiveWorkingDays,
            hasAnyLeave: totalLeaveDays > 0,
            isExcludedFromPayroll,
        };
    }

    /**
     * Check if employee should be excluded from payroll
     * This is the FILTER LOGIC used in dataExtractorService.ts
     *
     * Based on MEMORY.md:
     * - effective_work_hk = hk - (cuti_minggu + cuti_nasional)
     * - other_cuti = cuti_tahunan + cuti_sakit_haid
     * - IF effective_work_hk <= 0 AND other_cuti == 0 → FILTER OUT
     */
    public shouldExcludeFromPayroll(empCuti: CutiData): boolean {
        const effectiveWorkHk = empCuti.totalHk -
            (empCuti.cuti_minggu || 0) -
            (empCuti.cuti_nasional || 0);

        const otherCuti = (empCuti.cuti_tahunan || 0) +
            (empCuti.cuti_sakit_haid || 0);

        return effectiveWorkHk <= 0 && otherCuti === 0;
    }

    /**
     * Get cuti data for an employee for a specific period
     */
    public async getCutiData(empCode: string, month: number, year: number): Promise<CutiData | null> {
        try {
            // Query from PR_TASKREGLN or PR_TASKREG
            // This is a placeholder - actual implementation depends on database schema
            const rows = await this.db.query<{
                emp_code: string;
                total_hk: number;
                cuti_tahunan: number;
                cuti_sakit_haid: number;
                cuti_minggu: number;
                cuti_nasional: number;
            }>(`
                SELECT TOP 1
                    EmpCode as emp_code,
                    ISNULL(HK, 0) as total_hk,
                    ISNULL(CutiTahunan, 0) as cuti_tahunan,
                    ISNULL(CutiSakitHaid, 0) as cuti_sakit_haid,
                    ISNULL(CutiMinggu, 0) as cuti_minggu,
                    ISNULL(CutiNasional, 0) as cuti_nasional
                FROM PR_TASKREG
                WHERE EmpCode = ? AND PeriodMonth = ? AND PeriodYear = ?
            `, [empCode, month, year]);

            if (!rows[0]) return null;

            return {
                empCode: rows[0].emp_code,
                periodMonth: month,
                periodYear: year,
                totalHk: rows[0].total_hk,
                cuti_tahunan: rows[0].cuti_tahunan,
                cuti_sakit_haid: rows[0].cuti_sakit_haid,
                cuti_minggu: rows[0].cuti_minggu,
                cuti_nasional: rows[0].cuti_nasional,
            };
        } catch (error) {
            console.error(`[CutiService] Error getting cuti data for ${empCode}:`, error);
            return null;
        }
    }

    /**
     * Get all leave types as array
     */
    public getAllCutiTypes(): CutiType[] {
        return Object.values(CutiType);
    }

    /**
     * Check if a leave type is valid
     */
    public isValidCutiType(type: string): boolean {
        return Object.values(CutiType).includes(type as CutiType);
    }

    /**
     * Get human-readable name for cuti type
     */
    public getCutiTypeName(type: CutiType): string {
        const names: Record<CutiType, string> = {
            [CutiType.TAHUNAN]: 'Cuti Tahunan',
            [CutiType.SAKIT]: 'Cuti Sakit',
            [CutiType.HAID]: 'Cuti Haid',
            [CutiType.MINGGU]: 'Hari Minggu',
            [CutiType.NASIONAL]: 'Libur Nasional',
            [CutiType.MELAHIRKAN]: 'Cuti Melahirkan',
            [CutiType.KHUSUS]: 'Cuti Khusus',
        };
        return names[type] || type;
    }
}

// Export singleton instance
export const cutiService = CutiService.getInstance();
