export function parseBooleanQueryParam(value?: string | boolean | null): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return null;

    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;

    return null;
}

export function parsePositiveIntegerQueryParam(value?: string | number | null): number | null {
    if (typeof value === "number") {
        return Number.isInteger(value) && value > 0 ? value : null;
    }
    if (typeof value !== "string") return null;

    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;

    const parsed = Number.parseInt(normalized, 10);
    return parsed > 0 ? parsed : null;
}
