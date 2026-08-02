/**
 * Potongan (Deduction) Component Service
 *
 * Calculates deductions: astek, bpjs, spsi, pph21, dynamic potongans
 */

import { Database } from '../../../db/client';
import { BasePayrollComponentService } from '../BasePayrollComponentService';
import { PayrollCalculationInput, PayrollCalculationResult, BatchPayrollCalculationResult } from '../../../types/payroll/BasePayrollTypes';
import { PayrollComponent } from '../../../types/payroll/PayrollComponent';
import { pph21TerService } from './Pph21TerService';
import { calculateAllCaruman } from '../../carumanDefinitions';
import { gajiPokokService } from './GajiPokokService';

export interface PotonganInput extends PayrollCalculationInput {
    penghasilan_bruto?: number;
    beras_rate?: number;
    gaji_standar?: number; // upah_dasar * 30
    masa_kerja_jumlah?: number;
}

export interface PotonganOutput {
    astek: PayrollComponent<{ pekerja: number; majikan: number; jumlah: number }>;
    bpjs: {
        kesehatan: PayrollComponent<{ pekerja: number; majikan: number; jumlah: number }>;
        pensiun: PayrollComponent<{ pekerja: number; majikan: number; jumlah: number }>;
        total: PayrollComponent<number>;
    };
    spsi: PayrollComponent<number>;
    pph21: PayrollComponent<number>;
    dynamic_potongan: Record<string, PayrollComponent<number>>;
    total: PayrollComponent<number>;
}

export class PotonganService extends BasePayrollComponentService<PotonganInput, PotonganOutput> {
    public readonly componentName = 'potongan';

    constructor() {
        super();
    }

    protected async calculateSingle(input: PotonganInput): Promise<PayrollCalculationResult<PotonganOutput>> {
        try {
            const { emp_code, month, year, penghasilan_bruto, beras_rate, gaji_standar: inputGajiStandar, masa_kerja_jumlah: inputMasaKerja } = input;

            // Get base data for BPJS if not provided
            let gajiStandar = inputGajiStandar;
            let masaKerjaJumlah = inputMasaKerja;

            if (gajiStandar === undefined || masaKerjaJumlah === undefined) {
                const gpInput = { emp_code, month, year, server_profile: input.server_profile };
                const gpResult = await gajiPokokService.calculate(gpInput);
                const tunjanganMasaKerjaDesc = await this.getTunjanganAmount(emp_code, month, year, 'MASA KERJA', input.server_profile);

                if (gajiStandar === undefined) gajiStandar = gpResult.output.value.upah_dasar.value * 30;
                if (masaKerjaJumlah === undefined) masaKerjaJumlah = tunjanganMasaKerjaDesc;
            }

            // Calculate BPJS and ASTEK using centralized definitions
            // The definition uses upahDasar, not gajiStandar, but upahDasar = gajiStandar / 30
            const upahDasar = (gajiStandar || 0) / 30;
            const carumanResult = calculateAllCaruman(upahDasar, masaKerjaJumlah || 0);

            const spsiResult = await this.calculateSPSI(emp_code, input.server_profile);
            const pph21Input = { ...input, penghasilan_bruto: penghasilan_bruto || 0 };
            const pph21Result = await pph21TerService.calculate(pph21Input);

            // Fetch dynamic potongans
            const dynamicPotongan = await this.fetchDynamicPotongan(emp_code, month, year, input.server_profile);

            // Calculate totals
            const totalCaruman = carumanResult.astek_majikan_total + carumanResult.astek_pekerja_jht +
                carumanResult.bpjs_kes_majikan + carumanResult.bpjs_kes_pekerja +
                carumanResult.bpjs_pensiun_majikan + carumanResult.bpjs_pensiun_pekerja;
            const total = totalCaruman + spsiResult + pph21Result.output.value.tax_amount +
                Object.values(dynamicPotongan).reduce((sum, p) => sum + p.value, 0);

            const output: PotonganOutput = {
                astek: {
                    value: {
                        pekerja: carumanResult.astek_pekerja_jht,
                        majikan: carumanResult.astek_majikan_total,
                        jumlah: carumanResult.astek_pekerja_jht + carumanResult.astek_majikan_total,
                    },
                    meta: this.buildMetadata('CALCULATION', 'ASTEK (Jamsostek)', {
                        calculation_basis: 'JHT Pekerja 2%, JHT+JKK/JKM Majikan 4.54% dari (Upah Dasar*30 + Masa Kerja)',
                        dependencies: ['gajiStandar', 'masaKerjaJumlah'],
                        taxable: false,
                    }),
                },
                bpjs: {
                    kesehatan: {
                        value: {
                            pekerja: carumanResult.bpjs_kes_pekerja,
                            majikan: carumanResult.bpjs_kes_majikan,
                            jumlah: carumanResult.bpjs_kes_pekerja + carumanResult.bpjs_kes_majikan,
                        },
                        meta: this.buildMetadata('CALCULATION', 'BPJS Kesehatan', {
                            calculation_basis: 'Pekerja 1%, Majikan 4% dari (Upah Dasar*30 + Masa Kerja)',
                            dependencies: ['gajiStandar', 'masaKerjaJumlah'],
                            taxable: false,
                        }),
                    },
                    pensiun: {
                        value: {
                            pekerja: carumanResult.bpjs_pensiun_pekerja,
                            majikan: carumanResult.bpjs_pensiun_majikan,
                            jumlah: carumanResult.bpjs_pensiun_pekerja + carumanResult.bpjs_pensiun_majikan,
                        },
                        meta: this.buildMetadata('CALCULATION', 'BPJS Pensiun', {
                            calculation_basis: 'Pekerja 1%, Majikan 2% dari (Upah Dasar*30 + Masa Kerja)',
                            dependencies: ['gajiStandar', 'masaKerjaJumlah'],
                            taxable: false,
                        }),
                    },
                    total: {
                        value: (carumanResult.bpjs_kes_pekerja + carumanResult.bpjs_kes_majikan) + (carumanResult.bpjs_pensiun_pekerja + carumanResult.bpjs_pensiun_majikan),
                        meta: this.buildMetadata('CALCULATION', 'Total BPJS', {
                            calculation_basis: 'kesehatan + pensiun',
                            dependencies: ['bpjs.kesehatan', 'bpjs.pensiun'],
                            taxable: false,
                        }),
                    },
                },
                spsi: {
                    value: spsiResult,
                    meta: this.buildMetadata('CALCULATION', 'SPSI Union Dues', {
                        calculation_basis: 'Fixed amount (4000) from HR_PAYROLL',
                        dependencies: ['HR_PAYROLL'],
                        taxable: false,
                    }),
                },
                pph21: {
                    value: pph21Result.output.value.tax_amount,
                    meta: pph21Result.output.meta
                },
                dynamic_potongan: dynamicPotongan,
                total: {
                    value: total,
                    meta: this.buildMetadata('CALCULATION', 'Total Potongan', {
                        calculation_basis: 'astek + bpjs + spsi + pph21 + dynamic',
                        dependencies: ['astek', 'bpjs', 'spsi', 'pph21', 'dynamic'],
                        taxable: false,
                    }),
                },
            };

            return {
                component_name: this.componentName,
                input,
                output: {
                    value: output as any,
                    meta: this.buildMetadata('CALCULATION', 'Total Potongan Calculation', {
                        taxable: false,
                        confidence_level: 'high',
                        version: 1,
                    }),
                },
            };
        } catch (error) {
            return this.createErrorResult(input, error as Error);
        }
    }

    protected async calculateBatchInternal(inputs: PotonganInput[]): Promise<BatchPayrollCalculationResult<PotonganOutput>> {
        const results = new Map<string, PayrollCalculationResult<PotonganOutput>>();
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
            meta: this.buildMetadata('CALCULATION', 'Batch potongan calculation'),
        };
    }

    protected getBasisDescription(input: PotonganInput): string {
        return 'BPJS (gajiStandar + masaKerja), ASTEK (gajiStandar + masaKerja), SPSI, PPH21 (TER), dynamic PR_ADTRANS';
    }

    protected getCacheKey(input: PotonganInput): string {
        return `potongan:${input.emp_code}:${input.month}:${input.year}`;
    }

    protected getCacheTTL(): number {
        return 1800;
    }

    // Helper methods
    private async getTunjanganAmount(
        empCode: string,
        month: number,
        year: number,
        pattern: string,
        serverProfile?: string
    ): Promise<number> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;

        let startMonthStr = month.toString();
        if (month < 10) startMonthStr = '0' + startMonthStr;
        const startDate = year.toString() + "-" + startMonthStr + "-01";

        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = year.toString() + "-" + startMonthStr + "-" + daysInMonth.toString();

        // Query BOTH PR_ADTRANS (active) and PR_ADTRANS_ARC (archived) tables
        const queryStr = `
            SELECT SUM(Amount) as Amount FROM (
                SELECT Amount FROM PR_ADTRANS
                WHERE RTRIM(EmpCode) = ? AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE ?
                  AND Status IN (1, 3)
                UNION ALL
                SELECT Amount FROM PR_ADTRANS_ARC
                WHERE RTRIM(EmpCode) = ? AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE ?
                  AND Status = 3
            ) combined
        `;

        const rows = await db.query<{ Amount: number }>(queryStr, [empCode, startDate, endDate, "%" + pattern + "%", empCode, startDate, endDate, "%" + pattern + "%"]);

        return Math.abs(rows[0]?.Amount || 0);
    }

    private async calculateSPSI(empCode: string, serverProfile?: string): Promise<number> {
        return 4000; // SPSI Union Dues usually fixed
    }

    private async fetchDynamicPotongan(
        empCode: string,
        month: number,
        year: number,
        serverProfile?: string
    ): Promise<Record<string, PayrollComponent<number>>> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        let startMonthStr = month.toString();
        if (month < 10) startMonthStr = '0' + startMonthStr;
        const startDate = year.toString() + "-" + startMonthStr + "-01";

        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = year.toString() + "-" + startMonthStr + "-" + daysInMonth.toString();

        // Exclude standard potongans
        const excludePatterns = ['POT', 'SPSI', 'BERAS', 'JABATAN', 'MASA', 'LEMBUR', 'PPH', 'PREMI', 'ASTEK', 'BPJS', 'ADJ'];

        // Query BOTH PR_ADTRANS (active) and PR_ADTRANS_ARC (archived) tables
        const queryStr = `
            SELECT DocDesc, SUM(Amount) as Amount
            FROM (
                SELECT DocDesc, Amount FROM PR_ADTRANS
                WHERE RTRIM(EmpCode) = ? AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE 'POT%'
                  AND Status IN (1, 3)
                UNION ALL
                SELECT DocDesc, Amount FROM PR_ADTRANS_ARC
                WHERE RTRIM(EmpCode) = ? AND TrxDate >= ? AND TrxDate <= ?
                  AND DocDesc LIKE 'POT%'
                  AND Status = 3
            ) combined
            GROUP BY DocDesc
        `;

        const rows = await db.query<{ DocDesc: string; Amount: number }>(queryStr, [empCode, startDate, endDate, empCode, startDate, endDate]);

        const result: Record<string, PayrollComponent<number>> = {};
        for (const row of rows) {
            const docDesc = (row.DocDesc || '').trim();
            if (this.shouldExclude(docDesc, excludePatterns)) continue;

            const fieldName = this.cleanFieldName(docDesc.replace('POT_', ''));
            result[fieldName] = {
                value: Math.abs(row.Amount || 0),
                meta: this.buildMetadata('DATABASE_PLANTWARE', "Deduction: " + docDesc, {
                    calculation_basis: "SUM(Amount) where DocDesc='" + docDesc + "'",
                    dependencies: ['PR_ADTRANS'],
                    taxable: false,
                }),
            };
        }

        return result;
    }

    private shouldExclude(docDesc: string, patterns: string[]): boolean {
        const upperDesc = docDesc.toUpperCase();
        return patterns.some((pattern) => upperDesc.includes(pattern.toUpperCase()));
    }

    private cleanFieldName(str: string): string {
        return str.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    }
}

export const potonganService = new PotonganService();
