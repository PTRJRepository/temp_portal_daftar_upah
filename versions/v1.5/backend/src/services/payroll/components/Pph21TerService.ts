/**
 * PPH21 TER Component Service
 *
 * Calculates PPH21 tax using TER (Tarif Efektif Rata-rata) method
 * Based on PP 58 Tahun 2023
 *
 * IMPORTANT: Penghasilan Bruto for PPH21 calculation includes:
 * - Gaji Pokok Aktual
 * - Tunjangan (Beras, Jabatan, Masa Kerja)
 * - Lembur
 * - Premi
 * - ASTEK/BPJS Pensiun Majikan (0.84%)
 * - BPJS Kesehatan Majikan (4%)
 */

import { Database } from '../../../db/client';
import { BasePayrollComponentService } from '../BasePayrollComponentService';
import { pph21TerService as mainPph21TerService } from '../../pph21TerService';
import { PayrollCalculationInput, PayrollCalculationResult, BatchPayrollCalculationResult } from '../../../types/payroll/BasePayrollTypes';
import { PayrollComponent } from '../../../types/payroll/PayrollComponent';
import { mapBerasRateToPTKP } from '../../payroll/formulas/PTKPMapper';

export interface Pph21Input extends PayrollCalculationInput {
    penghasilan_bruto: number;
    beras_rate?: number;
}

export interface Pph21Output {
    ptkp_status: string;
    ter_category: string;
    gross_income: number;
    rate_percent: number;
    rate_decimal: number;
    tax_amount: number;
}
export class Pph21TerService extends BasePayrollComponentService<Pph21Input, Pph21Output> {
    public readonly componentName = 'pph21_ter';

    constructor() {
        super();
        this.db = Database.getInstance();
    }

    protected async calculateSingle(input: Pph21Input): Promise<PayrollCalculationResult<Pph21Output>> {
        try {
            const { penghasilan_bruto, beras_rate: providedBerasRate } = input;
            const ptkp_status_override = (input as any).ptkp_status_override;

            // Get beras_rate if not provided
            let beras_rate = providedBerasRate;
            if (beras_rate === undefined) {
                beras_rate = await this.getBerasRate(input.emp_code, input.server_profile);
            }

            // Map beras_rate to PTKP status
            let ptkp_status = ptkp_status_override;
            if (!ptkp_status) {
                ptkp_status = mapBerasRateToPTKP(beras_rate);
            }

            // Calculate PPH21 using the main TER service (with full progressive brackets)
            const terResult = mainPph21TerService.calculatePph21Ter(penghasilan_bruto, ptkp_status);

            const output: PayrollComponent<Pph21Output> = {
                value: {
                    ptkp_status: terResult.ptkp_status,
                    ter_category: terResult.ter_category,
                    gross_income: terResult.gross_income,
                    rate_percent: terResult.rate_percent,
                    rate_decimal: terResult.rate,
                    tax_amount: terResult.tax_amount,
                },
                meta: this.buildMetadata('CALCULATION', 'PPH21 Tax using TER Method (PP 58/2023)', {
                    calculation_basis: `penghasilan_bruto (${penghasilan_bruto}) × tarif (${terResult.rate_percent}% for ${terResult.ter_category})`,
                    dependencies: ['penghasilan_bruto', 'beras_rate'],
                    version: 2,
                    taxable: false,
                    ptkp_status,
                    ter_category: terResult.ter_category,
                }),
            };

            return {
                component_name: this.componentName,
                input,
                output,
                cached: false,
            };
        } catch (error) {
            return this.createErrorResult(input, error as Error);
        }
    }

    protected async calculateBatchInternal(inputs: Pph21Input[]): Promise<BatchPayrollCalculationResult<Pph21Output>> {
        const results = new Map<string, PayrollCalculationResult<Pph21Output>>();
        let cachedCount = 0;
        let errorCount = 0;

        if (inputs.length === 0) {
            return {
                results,
                summary: { total_calculated: 0, total_errors: 0, execution_time_ms: 0, cached_count: 0 },
                meta: this.buildMetadata('CALCULATION', 'Empty PPH21 TER calculation')
            };
        }

        // Batch fetch beras_rates first
        const empCodes = inputs.map(i => i.emp_code);
        const berasRates = await this.batchGetBerasRate(empCodes, inputs[0].server_profile);

        // Fetch Master PTKP records for the given year
        const { ptkpTaxService } = await import('../../ptkpTaxService');
        const ptkpMasterRecords = await ptkpTaxService.getPtkpByYear(inputs[0].year);
        const ptkpMap = new Map<string, string>();
        for (const record of ptkpMasterRecords) {
            if (record.emp_code) {
                ptkpMap.set(record.emp_code.trim().toUpperCase(), record.ptkp_status);
            }
        }

        for (const input of inputs) {
            try {
                const matchedPtkp = ptkpMap.get(input.emp_code.trim().toUpperCase());
                // Pass matchedPtkp down as any to avoid interface strictness issues if we don't change Pph21Input
                const inputWithRate = { ...input, beras_rate: berasRates[input.emp_code], ptkp_status_override: matchedPtkp } as any;
                const result = await this.calculateSingle(inputWithRate);
                results.set(input.emp_code, result);
                if (result.cached) cachedCount++;
            } catch (error) {
                errorCount++;
                results.set(input.emp_code, this.createErrorResult(input, error as Error));
            }
        }

        return {
            results,
            summary: {
                total_calculated: results.size - errorCount,
                total_errors: errorCount,
                execution_time_ms: 0,
                cached_count: cachedCount,
            },
            meta: this.buildMetadata('CALCULATION', 'Batch PPH21 TER calculation'),
        };
    }

    protected getBasisDescription(input: Pph21Input): string {
        return 'TER Method (PP 58/2023): penghasilan_bruto × tarif (progressive based on bruto + PTKP status)';
    }

    protected getCacheKey(input: Pph21Input): string {
        return `pph21_ter:${input.emp_code}:${input.month}:${input.year}:${input.penghasilan_bruto}`;
    }

    protected getCacheTTL(): number {
        return 3600;
    }

    // Helper methods
    private async getBerasRate(empCode: string, serverProfile?: string): Promise<number> {
        const { Database } = await import('../../../db/client');
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : Database.getInstance();

        const rows = await db.query<{ beras_rate: number }>(`
            SELECT beras_rate FROM HR_PAYROLL WHERE EmpCode = ?
        `, [empCode]);

        return rows[0]?.beras_rate || 0;
    }

    private async batchGetBerasRate(empCodes: string[], serverProfile?: string): Promise<Record<string, number>> {
        const { Database } = await import('../../../db/client');
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : Database.getInstance();

        const empList = empCodes.map(e => `'${e}'`).join(',');
        const rows = await db.query<{ EmpCode: string; beras_rate: number }>(`
            SELECT EmpCode, beras_rate FROM HR_PAYROLL WHERE RTRIM(EmpCode) IN (${empList})
        `);

        const result: Record<string, number> = {};
        for (const row of rows) {
            result[row.EmpCode?.trim() || ''] = row.beras_rate || 0;
        }
        return result;
    }
}

export const pph21TerService = new Pph21TerService();
