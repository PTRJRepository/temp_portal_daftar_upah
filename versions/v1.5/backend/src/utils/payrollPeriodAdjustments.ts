type PayrollAdjustmentContext = {
    month: number;
    year: number;
    divisionCode?: string | null;
};

type PayrollAdjustmentRow = {
    emp_code?: unknown;
    emp_name?: unknown;
    nama?: unknown;
    loc_code?: unknown;
    division_code?: unknown;
    pph21_ter?: unknown;
    pot_pph21?: unknown;
    pph21?: unknown;
    [key: string]: any;
};

export type PayrollPeriodAdjustment = {
    code: string;
    comment: string;
    jabatanJumlahOverride?: number;
    forcePotPph21ToTer?: boolean;
};

function normalizeCode(value: unknown): string {
    return String(value || "").trim().toUpperCase();
}

function isMay2026(context: PayrollAdjustmentContext): boolean {
    return Number(context.month) === 5 && Number(context.year) === 2026;
}

function rowMatchesDivision(row: PayrollAdjustmentRow, context: PayrollAdjustmentContext, divisionCode: string): boolean {
    const expected = normalizeCode(divisionCode);
    return [context.divisionCode, row.division_code, row.loc_code]
        .map(normalizeCode)
        .some((code) => code === expected);
}

/**
 * One-off payroll corrections that must stay period-scoped.
 *
 * Add new temporary rules here, with an explicit period and comment, so normal
 * payroll behavior remains unchanged outside the stated month/year.
 */
export function getPayrollPeriodAdjustments(
    row: PayrollAdjustmentRow,
    context: PayrollAdjustmentContext
): PayrollPeriodAdjustment[] {
    if (!isMay2026(context)) return [];

    const empCode = normalizeCode(row.emp_code);
    const adjustments: PayrollPeriodAdjustment[] = [];

    if (empCode === "B0088") {
        adjustments.push({
            code: "2026-05-B0088-JABATAN-ZERO",
            jabatanJumlahOverride: 0,
            comment: "Mei 2026 only: B0088 ZUWIRDA (SURYATI) tunjangan jabatan disesuaikan menjadi 0."
        });
    }

    if (empCode === "F0529" && rowMatchesDivision(row, context, "ARA")) {
        adjustments.push({
            code: "2026-05-ARA-F0529-PPH21-TER",
            forcePotPph21ToTer: true,
            comment: "Mei 2026 only: F0529 divisi ARA potongan PPh21 disamakan dengan PPh21 TER."
        });
    }

    return adjustments;
}

export function resolveAdjustedJabatanJumlah(
    row: PayrollAdjustmentRow,
    context: PayrollAdjustmentContext,
    currentValue: number
): number {
    const adjustment = getPayrollPeriodAdjustments(row, context)
        .find((item) => item.jabatanJumlahOverride !== undefined);
    return adjustment ? Number(adjustment.jabatanJumlahOverride) || 0 : currentValue;
}

export function shouldForcePotPph21ToTer(row: PayrollAdjustmentRow, context: PayrollAdjustmentContext): boolean {
    return getPayrollPeriodAdjustments(row, context).some((item) => item.forcePotPph21ToTer === true);
}

export function attachPayrollPeriodAdjustmentNotes(row: PayrollAdjustmentRow, context: PayrollAdjustmentContext): void {
    const adjustments = getPayrollPeriodAdjustments(row, context);
    if (adjustments.length === 0) return;

    row.period_adjustments = adjustments.map(({ code, comment }) => ({ code, comment }));
}

