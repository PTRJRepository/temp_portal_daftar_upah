export type CanonicalOtherIncomeType = "THR" | "BONUS" | "KONTAN" | "CUSTOM" | string;

export interface OtherIncomeLike {
    type?: unknown;
    income_type?: unknown;
    category?: unknown;
    name?: unknown;
    income_name?: unknown;
    amount?: unknown;
    taxable_amount?: unknown;
    income_amount?: unknown;
    value?: unknown;
    jumlah?: unknown;
}

export function normalizeOtherIncomeType(value: unknown): string {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function getOtherIncomeRawType(income: OtherIncomeLike): string {
    return normalizeOtherIncomeType(
        income?.type
        ?? income?.income_type
        ?? income?.category
        ?? income?.name
        ?? income?.income_name
    );
}

export function resolveCanonicalOtherIncomeType(value: unknown): CanonicalOtherIncomeType {
    const normalized = normalizeOtherIncomeType(value);
    const compact = normalized.replace(/_/g, "");

    if (!compact) return "";
    if (compact.includes("THR")) return "THR";
    if (compact.includes("BONUS") || compact.includes("EXGRATIA")) return "BONUS";
    if (compact.includes("KONTAN")) return "KONTAN";
    if (compact === "CUSTOM" || compact === "PENDAPATANTIDAKTETAP") return "CUSTOM";
    return normalized;
}

export function getCanonicalOtherIncomeType(income: OtherIncomeLike): CanonicalOtherIncomeType {
    return resolveCanonicalOtherIncomeType(getOtherIncomeRawType(income));
}

export function formatCanonicalOtherIncomeLabel(value: unknown): string {
    const canonicalType = resolveCanonicalOtherIncomeType(value);
    if (canonicalType === "BONUS") return "PENDAPATAN BONUS";
    if (canonicalType === "KONTAN") return "KONTANAN";
    return String(canonicalType || "LAINNYA").replace(/_/g, " ");
}

export function getOtherIncomeAmount(income: OtherIncomeLike): number {
    const numeric = Number(income?.amount ?? income?.taxable_amount ?? income?.income_amount ?? income?.value ?? income?.jumlah ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

export function sumOtherIncomeByCanonicalType(incomes: OtherIncomeLike[] | undefined, type: CanonicalOtherIncomeType): number {
    if (!Array.isArray(incomes)) return 0;
    const canonicalType = resolveCanonicalOtherIncomeType(type);
    return incomes.reduce((sum, income) => {
        return getCanonicalOtherIncomeType(income) === canonicalType
            ? sum + getOtherIncomeAmount(income)
            : sum;
    }, 0);
}
