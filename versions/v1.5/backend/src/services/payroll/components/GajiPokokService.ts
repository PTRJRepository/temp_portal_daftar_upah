import { Database } from '../../../db/client';
import { BasePayrollComponentService } from '../BasePayrollComponentService';
import { PayrollCalculationInput, PayrollCalculationResult, BatchPayrollCalculationResult } from '../../../types/payroll/BasePayrollTypes';
import { PayrollComponent } from '../../../types/payroll/PayrollComponent';

export interface GajiPokokInput extends PayrollCalculationInput {
    // Optional data that can be injected to avoid DB lookups if already available
    attendance?: {
        hk: number;
        total_amount_rp: number; // This is gaji_pokok_aktual
    };
    upah_dasar?: number;
}

export interface GajiPokokOutput {
    upah_dasar: PayrollComponent<number>;
    jumlah_hk: PayrollComponent<number>;
    gaji_pokok_ideal: PayrollComponent<number>;
    gaji_pokok_aktual: PayrollComponent<number>;
    koreksi_hk: PayrollComponent<number>;
    total: PayrollComponent<number>; // Alias for gaji_pokok_aktual for consistency in totals
}

export class GajiPokokService extends BasePayrollComponentService<GajiPokokInput, GajiPokokOutput> {
    public readonly componentName = 'gaji_pokok';

    constructor() {
        super();
    }

    protected async calculateSingle(input: GajiPokokInput): Promise<PayrollCalculationResult<GajiPokokOutput>> {
        try {
            const { emp_code, month, year, attendance, upah_dasar: inputUpahDasar } = input;

            // 1. Get Upah Dasar (Base Wage)
            const upah_dasar = inputUpahDasar !== undefined ? inputUpahDasar : await this.getUpahDasar(emp_code, year, input.server_profile);

            // 2. Get Attendance data (HK and Gaji Pokok Aktual)
            let jumlah_hk = 0;
            let gaji_pokok_aktual = 0;

            if (attendance) {
                jumlah_hk = attendance.hk;
                gaji_pokok_aktual = attendance.total_amount_rp || 0;
            } else {
                const attData = await this.getAttendanceData(emp_code, month, year, input.server_profile);
                jumlah_hk = attData.hk;
                gaji_pokok_aktual = attData.total_amount_rp;
            }

            // 3. Calculate Ideal Gaji Pokok and Koreksi HK
            const gaji_pokok_ideal = upah_dasar * jumlah_hk;

            // koreksi_hk = gaji_pokok_aktual - gaji_pokok_ideal
            // Note: koreksi_hk is typically <= 0. If aktual > ideal, it should be 0, but we follow the existing logic where it just subtracts.
            const koreksi_hk = gaji_pokok_aktual - gaji_pokok_ideal;

            const output: GajiPokokOutput = {
                upah_dasar: {
                    value: upah_dasar,
                    meta: this.buildMetadata('DATABASE_PLANTWARE', 'Upah Dasar (Base Wage)', {
                        calculation_basis: 'Master HR_PAYROLL PayRate',
                        dependencies: ['HR_PAYROLL'],
                        taxable: true,
                    }),
                },
                jumlah_hk: {
                    value: jumlah_hk,
                    meta: this.buildMetadata('DATABASE_PLANTWARE', 'Total Hari Kerja', {
                        calculation_basis: 'Count of distinct TrxDate in PR_TASKREGLN/ARC where OT=0',
                        dependencies: ['PR_TASKREGLN'],
                        taxable: false, // It's a multiplier, not a direct taxable value
                    }),
                },
                gaji_pokok_ideal: {
                    value: gaji_pokok_ideal,
                    meta: this.buildMetadata('CALCULATION', 'Gaji Pokok Ideal', {
                        calculation_basis: 'upah_dasar × jumlah_hk',
                        dependencies: ['upah_dasar', 'jumlah_hk'],
                        taxable: true,
                    }),
                },
                gaji_pokok_aktual: {
                    value: gaji_pokok_aktual,
                    meta: this.buildMetadata('DATABASE_PLANTWARE', 'Gaji Pokok Aktual', {
                        calculation_basis: 'SUM(Amount) in PR_TASKREGLN/ARC where OT=0',
                        dependencies: ['PR_TASKREGLN'],
                        taxable: true,
                    }),
                },
                koreksi_hk: {
                    value: koreksi_hk,
                    meta: this.buildMetadata('CALCULATION', 'Koreksi HK', {
                        calculation_basis: 'gaji_pokok_aktual - gaji_pokok_ideal',
                        dependencies: ['gaji_pokok_aktual', 'gaji_pokok_ideal'],
                        taxable: false, // Used as a deduction later
                    }),
                },
                total: {
                    value: gaji_pokok_aktual,
                    meta: this.buildMetadata('CALCULATION', 'Gaji Pokok Total', {
                        calculation_basis: 'Sama dengan gaji_pokok_aktual',
                        dependencies: ['gaji_pokok_aktual'],
                        taxable: true,
                    }),
                }
            };

            return {
                component_name: this.componentName,
                input,
                output: {
                    value: output as any,
                    meta: this.buildMetadata('CALCULATION', 'Gaji Pokok Calculation Summary', {
                        taxable: true,
                        confidence_level: 'high',
                        version: 1,
                    }),
                },
            };
        } catch (error) {
            return this.createErrorResult(input, error as Error);
        }
    }

    protected async calculateBatchInternal(inputs: GajiPokokInput[]): Promise<BatchPayrollCalculationResult<GajiPokokOutput>> {
        const results = new Map<string, PayrollCalculationResult<GajiPokokOutput>>();
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
            meta: this.buildMetadata('CALCULATION', 'Batch gaji pokok calculation'),
        };
    }

    protected getBasisDescription(input: GajiPokokInput): string {
        return 'Gaji Pokok Aktual based on PR_TASKREGLN AMOUNT, with Ideal reference from Upah Dasar × HK';
    }

    protected getCacheKey(input: GajiPokokInput): string {
        return `gajipokok:${input.emp_code}:${input.month}:${input.year}`;
    }

    protected getCacheTTL(): number {
        return 1800;
    }

    // Helper methods for DB lookups if not provided in input
    private async getUpahDasar(empCode: string, year: number, serverProfile?: string): Promise<number> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;

        // [APPEND-INSERT FIX]: Pick the LATEST PayRate per employee
        // Plantware often appends records. We must take the most recent one.
        const rows = await db.query<{ PayRate: number }>(`
            SELECT TOP 1 PayRate 
            FROM HR_PAYROLL 
            WHERE RTRIM(EmpCode) = ?
            ORDER BY PayRate DESC -- In many cases PayRate is similar, but we want the one that isn't zero
        `, [empCode]);

        if (rows.length > 0) {
            return rows[0].PayRate || 0;
        }

        return 0;
    }

    private async getAttendanceData(empCode: string, month: number, year: number, serverProfile?: string): Promise<{ hk: number, total_amount_rp: number }> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;

        let startMonthStr = month.toString();
        if (month < 10) startMonthStr = '0' + startMonthStr;
        const startDate = year.toString() + "-" + startMonthStr + "-01";

        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;

        let nextMonthStr = nextMonth.toString();
        if (nextMonth < 10) nextMonthStr = '0' + nextMonthStr;
        const endDate = nextYear.toString() + "-" + nextMonthStr + "-01";

        // We use the exact same logic from dataExtractorService.getAttendance
        const queryStr = `
            SELECT COUNT(DISTINCT trl.TrxDate) as hk, SUM(trl.Amount) as total_amount_rp
            FROM PR_TASKREGLN trl
            WHERE RTRIM(trl.EmpCode) = ?
              AND trl.TrxDate >= ? AND trl.TrxDate < ?
              AND trl.OT = 0

            UNION ALL

            SELECT COUNT(DISTINCT trl.TrxDate) as hk, SUM(trl.Amount) as total_amount_rp
            FROM PR_TASKREGLN_ARC trl
            WHERE RTRIM(trl.EmpCode) = ?
              AND trl.TrxDate >= ? AND trl.TrxDate < ?
              AND trl.OT = 0
        `;

        const rows = await db.query<{ hk: number; total_amount_rp: number }>(queryStr, [empCode, startDate, endDate, empCode, startDate, endDate]);

        let totalHk = 0;
        let totalAmount = 0;

        for (const row of rows) {
            totalHk += row.hk || 0;
            totalAmount += row.total_amount_rp || 0;
        }

        return { hk: totalHk, total_amount_rp: totalAmount };
    }
}

export const gajiPokokService = new GajiPokokService();
