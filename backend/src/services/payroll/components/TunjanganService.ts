/**
 * Tunjangan (Allowance) Component Service
 *
 * Calculates allowances: beras, jabatan, masa_kerja, lembur
 */

import { BasePayrollComponentService } from '../BasePayrollComponentService';
import { PayrollCalculationInput, PayrollCalculationResult, BatchPayrollCalculationResult } from '../../../types/payroll/BasePayrollTypes';
import { PayrollComponent } from '../../../types/payroll/PayrollComponent';
import { lemburService } from './LemburService';
import { Database } from '../../../db/client';

export interface TunjanganInput extends PayrollCalculationInput { }

export interface TunjanganOutput {
    beras: PayrollComponent<number>;
    jabatan: PayrollComponent<number>;
    masa_kerja: PayrollComponent<number>;
    lembur: Awaited<ReturnType<typeof lemburService.calculate>>['output'];
    total: PayrollComponent<number>;
}

export class TunjanganService extends BasePayrollComponentService<TunjanganInput, TunjanganOutput> {
    public readonly componentName = 'tunjangan';

    constructor() {
        super();
    }

    protected async calculateSingle(input: TunjanganInput): Promise<PayrollCalculationResult<TunjanganOutput>> {
        try {
            const { emp_code, month, year, jumlah_hk, hari_kerja, masa_kerja_tahun } = input;

            // Fetch tunjangan components
            const [berasJumlah, jabatanJumlah, masaKerjaJumlah] = await Promise.all([
                this.getBerasTunjangan(emp_code, input.server_profile),
                this.getTunjanganAmount(emp_code, month, year, 'JABATAN', input.server_profile),
                this.getTunjanganAmount(emp_code, month, year, 'MASA KERJA', input.server_profile),
            ]);

            // Calculate rates
            const jabatanRate = (hari_kerja || 0) > 0 && jabatanJumlah > 0 ? jabatanJumlah / (hari_kerja || 1) : 0;
            const masaKerjaRate = (hari_kerja || 0) > 0 && masaKerjaJumlah > 0 ? masaKerjaJumlah / (hari_kerja || 1) : 0;

            // Get lembur from lemburService
            const lemburResult = await lemburService.calculate({
                emp_code,
                month,
                year,
                server_profile: input.server_profile,
            });

            const total = berasJumlah + jabatanJumlah + masaKerjaJumlah + lemburResult.output.value.total_amount;

            const output: PayrollComponent<TunjanganOutput> = {
                value: {
                    beras: {
                        value: berasJumlah,
                        meta: this.buildMetadata('CALCULATION', 'Beras allowance', {
                            calculation_basis: 'beras_rate × jumlah_hk',
                            dependencies: ['HR_PAYROLL.beras_rate', 'attendance.jumlah_hk'],
                            taxable: true,
                        }),
                    },
                    jabatan: {
                        value: jabatanJumlah,
                        meta: this.buildMetadata('DATABASE_PLANTWARE', 'Position allowance', {
                            calculation_basis: `jabatan_rate × hari_kerja = ${jabatanRate} × ${hari_kerja}`,
                            dependencies: ['PR_ADTRANS'],
                            taxable: true,
                        }),
                    },
                    masa_kerja: {
                        value: masaKerjaJumlah,
                        meta: this.buildMetadata('DATABASE_PLANTWARE', 'Seniority allowance', {
                            calculation_basis: `masa_kerja_rate × hari_kerja = ${masaKerjaRate} × ${hari_kerja}`,
                            dependencies: ['PR_ADTRANS', 'masa_kerja_tahun'],
                            taxable: true,
                        }),
                    },
                    lembur: lemburResult.output,
                    total: {
                        value: total,
                        meta: this.buildMetadata('CALCULATION', 'Total tunjangan', {
                            calculation_basis: 'beras + jabatan + masa_kerja + lembur',
                            dependencies: ['beras', 'jabatan', 'masa_kerja', 'lembur'],
                            taxable: true,
                        }),
                    },
                },
                meta: this.buildMetadata('CALCULATION', 'Tunjangan Calculation', {
                    dependencies: ['lemburComponent', 'beras', 'jabatan', 'masa_kerja'],
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

    protected async calculateBatchInternal(inputs: TunjanganInput[]): Promise<BatchPayrollCalculationResult<TunjanganOutput>> {
        // For simplicity, delegate to individual calculations
        const results = new Map<string, PayrollCalculationResult<TunjanganOutput>>();
        let cachedCount = 0;

        for (const input of inputs) {
            const result = await this.calculateSingle(input);
            results.set(input.emp_code, result);
            if (result.cached) cachedCount++;
        }

        return {
            results,
            summary: {
                total_calculated: results.size,
                total_errors: 0,
                execution_time_ms: 0,
                cached_count: cachedCount,
            },
            meta: this.buildMetadata('CALCULATION', 'Batch tunjangan calculation'),
        };
    }

    protected getBasisDescription(input: TunjanganInput): string {
        return 'Combined allowances: beras (HR_PAYROLL), jabatan, masa_kerja (PR_ADTRANS), lembur (PR_TASKREGLN)';
    }

    protected getCacheKey(input: TunjanganInput): string {
        return `tunjangan:${input.emp_code}:${input.month}:${input.year}`;
    }

    protected getCacheTTL(): number {
        return 1800;
    }

    // Helper methods
    private async getBerasTunjangan(empCode: string, serverProfile?: string): Promise<number> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const rows = await db.query<{ beras_rate: number }>(`
            SELECT beras_rate FROM HR_PAYROLL WHERE EmpCode = ?
        `, [empCode]);
        return (rows[0]?.beras_rate || 0) * 30; // 30 days default
    }

    private async getTunjanganAmount(
        empCode: string,
        month: number,
        year: number,
        pattern: string,
        serverProfile?: string
    ): Promise<number> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${month.toString().padStart(2, '0')}-${daysInMonth}`;

        // Query BOTH PR_ADTRANS (active) and PR_ADTRANS_ARC (archived) tables
        // This ensures we don't miss data that has been archived
        const rows = await db.query<{ Amount: number }>(`
            SELECT SUM(Amount) as Amount FROM (
                SELECT Amount FROM PR_ADTRANS
                WHERE EmpCode = ? AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE ?
                  AND Status IN (1, 3)
                UNION ALL
                SELECT Amount FROM PR_ADTRANS_ARC
                WHERE EmpCode = ? AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE ?
                  AND Status = 3
            ) combined
        `, [empCode, startDate, endDate, `%${pattern}%`, empCode, startDate, endDate, `%${pattern}%`]);

        return Math.abs(rows[0]?.Amount || 0);
    }
}

export const tunjanganService = new TunjanganService();
