export interface MasaKerjaDisplay {
    years: number;
    months: number;
    label: string;
}

type PayrollDateInput = string | Date | null | undefined;

function toYmdLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseValidPayrollDate(value: PayrollDateInput): Date | null {
    const normalized = normalizeEffectiveStartDate(value);
    if (!normalized) return null;

    const parsed = new Date(normalized.includes("T") ? normalized : `${normalized}T00:00:00`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1905) {
        return parsed;
    }

    const fallbackParsed = new Date(normalized);
    if (!Number.isNaN(fallbackParsed.getTime()) && fallbackParsed.getFullYear() > 1905) {
        return fallbackParsed;
    }

    return null;
}

function formatPayrollDate(date: Date): string {
    return date.toISOString().split("T")[0];
}

export function deriveInitialSpsiMember(potSpsi: number | null | undefined): boolean {
    return Number(potSpsi || 0) > 0;
}

export function normalizeEffectiveStartDate(value: PayrollDateInput): string | null {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime()) || value.getFullYear() <= 1905) return null;
        return toYmdLocal(value);
    }

    const trimmed = String(value || "").trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    // Typical SQL datetime: "2024-01-15 00:00:00.000"
    const sqlDatePrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s/);
    if (sqlDatePrefix?.[1]) {
        return sqlDatePrefix[1];
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1905) {
        return toYmdLocal(parsed);
    }

    return null;
}

export function resolveThrCompatibleEffectiveStartDate(
    appJoinDate: PayrollDateInput,
    appJoinGrpDate: PayrollDateInput,
    fallbackDate?: PayrollDateInput
): string | null {
    const date1 = parseValidPayrollDate(appJoinDate);
    const date2 = parseValidPayrollDate(appJoinGrpDate);
    const fallback = parseValidPayrollDate(fallbackDate);

    if (date1 && date2) {
        return formatPayrollDate(date1.getTime() > date2.getTime() ? date1 : date2);
    }

    if (date1 || date2) {
        return formatPayrollDate((date1 || date2)!);
    }

    return fallback ? formatPayrollDate(fallback) : null;
}

export function calculateMasaKerjaDisplay(
    startDate: PayrollDateInput,
    month: number,
    year: number
): MasaKerjaDisplay {
    const start = parseValidPayrollDate(startDate);
    if (!start) {
        return {
            years: 0,
            months: 0,
            label: "0 bln"
        };
    }

    const period = new Date(year, month - 1, 1);
    const totalMonths = Math.max(
        0,
        (period.getFullYear() - start.getFullYear()) * 12 + (period.getMonth() - start.getMonth())
    );
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    return {
        years,
        months,
        label: years > 0 ? `${years} thn ${months} bln` : `${months} bln`
    };
}
