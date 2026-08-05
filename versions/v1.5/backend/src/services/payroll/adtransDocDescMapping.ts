export const ADTRANS_DYNAMIC_PREMI_PATTERNS = ["%PREMI%", "%INSENTIF%", "%PANEN%", "%KINERJA%", "%RAWAT%", "%PRUN%"];

function normalizeUpper(value: string): string {
    return String(value || "").trim().toUpperCase();
}

function normalizeFieldWords(value: string): string {
    return String(value || "").replace(/\bBERONDOL\b/gi, "BRONDOL");
}

function normalizeKey(value: string): string {
    return normalizeFieldWords(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function stripPremiumFieldPrefix(value: string): string {
    return value
        .replace(/^tunjangan_premi_/, "")
        .replace(/^tunjangan_/, "")
        .replace(/^premi_/, "");
}

export function normalizeKnownAdtransPremiField(value: string): string | null {
    const suffix = stripPremiumFieldPrefix(normalizeKey(value));
    if (!suffix) return null;

    if (suffix === "jaga_tanggung_jawab") return "premi_jaga_tanggung_jawab";

    if ([
        "jaga",
        "jaga_cuci_unit",
        "jaga_ganset",
        "jaga_genset",
        "jaga_genst"
    ].includes(suffix)) {
        return "premi_jaga";
    }

    return null;
}

export function normalizeAdtransFilter(filter: string): string {
    const filterKey = String(filter || "").toLowerCase().trim();

    if (filterKey.includes("spsi")) return "spsi";
    if (filterKey.includes("pph") || filterKey.includes("pajak")) return "pph";
    if (filterKey.includes("masa")) return "masa kerja";
    if (filterKey.includes("jabatan")) return "jabatan";
    if (filterKey.includes("brondol")) return "brondol";
    if (filterKey.includes("koreksi")) return "koreksi";
    if (filterKey.includes("premi")) return "premi";
    if (filterKey.includes("potongan")) return "potongan";

    return filterKey;
}

export function isBrondolDocDesc(docDesc: string): boolean {
    const upper = normalizeUpper(docDesc);
    if (!upper.includes("BRONDOL")) return false;
    return !/\bBANTU\b/.test(upper);
}

export function isDynamicPremiDocDesc(docDesc: string): boolean {
    const upper = normalizeUpper(docDesc);
    if (!upper || isBrondolDocDesc(upper)) return false;
    if (["PPH", "JABATAN", "BERAS", "LEMBUR", "MASA", "POTONGAN", "KOREKSI", "SPSI"].some((keyword) => upper.includes(keyword))) return false;
    return ["PREMI", "INSENTIF", "PANEN", "KINERJA", "RAWAT", "PRUN"].some((keyword) => upper.includes(keyword));
}

export function isDynamicPotonganDocDesc(docDesc: string): boolean {
    const upper = normalizeUpper(docDesc);
    if (!upper) return false;
    if (upper.includes("KOREKSI")) return true;
    if (upper.includes("SPSI") || upper.includes("PPH")) return false;
    return upper.startsWith("POTONGAN") || upper.startsWith("POT ") || upper.startsWith("POT_");
}

export function normalizeAdtransPremiField(docDesc: string): string {
    const knownField = normalizeKnownAdtransPremiField(docDesc);
    if (knownField) return knownField;

    const normalized = stripPremiumFieldPrefix(normalizeKey(docDesc));
    return normalized ? `premi_${normalized}` : "";
}

export function mapAdtransPremiField(docDesc: string): string {
    if (isBrondolDocDesc(docDesc)) return "brondol";
    return normalizeAdtransPremiField(docDesc);
}

export function normalizeAdtransPotonganField(docDesc: string): { key: string; title: string } {
    const title = String(docDesc || "").trim();
    return { key: normalizeKey(title), title };
}

export function buildAdtransDocDescSqlPatterns(filter: string): string[] {
    const category = normalizeAdtransFilter(filter);

    if (category === "spsi") return ["%SPSI%"];
    if (category === "pph") return ["%PPH%", "%PAJAK%"];
    if (category === "masa kerja") return ["%MASA%KERJA%"];
    if (category === "jabatan") return ["%JABATAN%"];
    if (category === "brondol") return ["%BRONDOL%"];
    if (category === "koreksi") return ["%KOREKSI%"];
    if (category === "premi") return ADTRANS_DYNAMIC_PREMI_PATTERNS;
    if (category === "potongan") return ["POT%", "POTONGAN%"];

    return [`%${category.toUpperCase()}%`];
}

export function buildAdtransDocDescSqlCondition(columnName: string, filter: string): string {
    const category = normalizeAdtransFilter(filter);
    if (category === "pph") {
        return `((UPPER(${columnName}) LIKE '%PPH%' OR UPPER(${columnName}) LIKE '%PAJAK%') AND UPPER(${columnName}) NOT LIKE '%PREMI%')`;
    }

    return buildAdtransDocDescSqlPatterns(filter)
        .map((pattern) => `UPPER(${columnName}) LIKE '${pattern.replace(/'/g, "''")}'`)
        .join(" OR ");
}

export function matchesAdtransDocDescFilter(docDesc: string, filter: string): boolean {
    const category = normalizeAdtransFilter(filter);
    const upper = normalizeUpper(docDesc);

    if (category === "spsi") return upper.includes("SPSI");
    if (category === "pph") return (upper.includes("PPH") || upper.includes("PAJAK")) && !upper.includes("PREMI");
    if (category === "masa kerja") return upper.includes("MASA") && upper.includes("KERJA");
    if (category === "jabatan") return upper.includes("JABATAN");
    if (category === "brondol") return isBrondolDocDesc(upper);
    if (category === "koreksi") return upper.includes("KOREKSI");
    if (category === "premi") return isDynamicPremiDocDesc(upper);
    if (category === "potongan") return !upper.includes("KOREKSI") && isDynamicPotonganDocDesc(upper);

    return upper.includes(category.toUpperCase());
}
