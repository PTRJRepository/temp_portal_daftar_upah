import { sumOtherIncomeByCanonicalType } from "./otherIncomeCanonical";

type ComponentMetadata = Record<string, unknown>;

function toNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function firstNonZeroNumber(...values: unknown[]): number {
    for (const value of values) {
        const numeric = toNumber(value);
        if (numeric !== 0) return numeric;
    }
    return 0;
}
function resolveThrValue(emp: Record<string, any>): number {
    return firstNonZeroNumber(
        emp.pendapatan_thr,
        emp.taxable_pendapatan_thr,
        emp.thr_amount,
        emp.THR,
        emp.thr,
        emp.THR_AMOUNT,
        sumOtherIncomeByCanonicalType(emp.other_incomes, "THR")
    );
}

function resolveBonusValue(emp: Record<string, any>): number {
    const bonusDirect = firstNonZeroNumber(
        emp.pendapatan_bonus,
        emp.taxable_pendapatan_bonus,
        emp.bonus,
        emp.bonus_amount
    );
    const exgratiaSeparate = toNumber(emp.pendapatan_exgratia) || toNumber(emp.taxable_pendapatan_exgratia);
    const exgratiaAlias = bonusDirect === 0 ? toNumber(emp.exgratia_amount) : 0;

    return firstNonZeroNumber(
        bonusDirect + exgratiaSeparate + exgratiaAlias,
        sumOtherIncomeByCanonicalType(emp.other_incomes, "BONUS")
    );
}

function resolveKontanValue(emp: Record<string, any>): number {
    return firstNonZeroNumber(
        emp.pendapatan_kontan,
        emp.taxable_pendapatan_kontan,
        emp.kontanan_amount,
        emp.KONTANAN,
        emp.KONTAN,
        sumOtherIncomeByCanonicalType(emp.other_incomes, "KONTAN")
    );
}

function normalizePremiumLookupKey(value: string): string {
    return String(value || "")
        .trim()
        .replace(/\s+/g, "_")
        .toLowerCase();
}

function shouldSkipPremiumKey(value: string): boolean {
    const upper = String(value || "").toUpperCase();
    return upper.includes("PPH") || upper.includes("KOREKSI") || upper.includes("ADJ");
}

function resolvePremiumValue(emp: Record<string, any>, rawKey: string): number {
    const key = String(rawKey || "").trim();
    if (!key) return 0;

    const normalized = normalizePremiumLookupKey(key);
    const stripped = normalized.replace(/^premi_/, "");
    const candidates = [
        key,
        key.toUpperCase().replace(/ /g, "_"),
        normalized,
        stripped,
        `premi_${stripped}`
    ];

    for (const candidate of candidates) {
        if (emp[candidate] !== undefined) {
            const value = toNumber(emp[candidate]);
            if (value !== 0) return value;
        }
    }

    const premi = emp.premi;
    if (premi && typeof premi === "object" && !Array.isArray(premi)) {
        for (const candidate of candidates) {
            if (premi[candidate] !== undefined) {
                const value = toNumber(premi[candidate]);
                if (value !== 0) return value;
            }
        }
    }

    if (stripped === "brondol") {
        return toNumber(emp.premi_brondol_total) || toNumber(emp.premi_brondol);
    }

    return 0;
}

function buildDomPremiumDetail(emp: Record<string, any>, premiKeys: string[]): Record<string, number> {
    const detail: Record<string, number> = {};

    if (emp.premi_detail && typeof emp.premi_detail === "object" && !Array.isArray(emp.premi_detail)) {
        for (const [key, value] of Object.entries(emp.premi_detail)) {
            if (shouldSkipPremiumKey(key)) continue;
            const numeric = toNumber(value);
            if (numeric !== 0) detail[key] = numeric;
        }
    }

    for (const key of premiKeys) {
        if (!key || shouldSkipPremiumKey(key)) continue;
        const value = resolvePremiumValue(emp, key);
        if (value !== 0) detail[key] = value;
    }

    const brondolValue = toNumber(emp.premi_brondol_total) || toNumber(emp.premi_brondol);
    if (brondolValue !== 0 && !Object.keys(detail).some((key) => normalizePremiumLookupKey(key) === "premi_brondol" || normalizePremiumLookupKey(key) === "brondol")) {
        detail.BRONDOL = brondolValue;
    }

    return detail;
}

export function prepareDomTaxExcelRows(
    employees: Array<Record<string, any>>,
    premiKeys: string[] = [],
    componentMetadata: ComponentMetadata = {}
): { employees: Array<Record<string, any>>; totalPph21: number } {
    let totalPph21 = 0;
    console.log(`[prepareDomTaxExcelRows] Input: ${employees.length} employees, ${premiKeys.length} premiKeys`);
    const preparedEmployees = (Array.isArray(employees) ? employees : []).map((emp, idx) => {
        const next: Record<string, any> = {
            ...emp,
            component_metadata: componentMetadata
        };

        const premiumDetail = buildDomPremiumDetail(next, Array.isArray(premiKeys) ? premiKeys : []);
        if (Object.keys(premiumDetail).length > 0) {
            next.premi_detail = premiumDetail;
        }

        const thr = resolveThrValue(next);
        const bonus = resolveBonusValue(next);
        const kontan = resolveKontanValue(next);
        next.pendapatan_thr = thr;
        if (next.thr_amount === undefined) next.thr_amount = thr;
        next.bonus = bonus;
        next.pendapatan_bonus = bonus;
        if (next.bonus_amount === undefined) next.bonus_amount = bonus;
        next.pendapatan_kontan = kontan;
        if (next.kontanan_amount === undefined) next.kontanan_amount = kontan;

        if (!next.pot_alpa_cth && !next.pot_alpa) {
            const ideal = toNumber(next.gaji_pokok_ideal);
            const actual = toNumber(next.gaji_pokok_aktual);
            if (ideal > 0 && actual > 0 && ideal > actual) {
                next.pot_alpa_cth = -(ideal - actual);
            }
        }

        if (!next.lebih_hk && !next.lebih_hk_cth) {
            const ideal = toNumber(next.gaji_pokok_ideal);
            const actual = toNumber(next.gaji_pokok_aktual);
            const koreksiHk = toNumber(next.koreksi_hk);
            const lebihHk = koreksiHk > 0 ? koreksiHk : (ideal > 0 && actual > ideal ? actual - ideal : 0);
            if (lebihHk > 0) {
                next.lebih_hk = lebihHk;
            }
        }

        const pph21Val = toNumber(next.pph21_ter) || toNumber(next.potongan_pph21) || toNumber(next.pot_pph21);
        totalPph21 += pph21Val;
        // Debug first employee
        if (idx === 0) {
            console.log(`[prepareDomTaxExcelRows] First emp: pph21_ter=${next.pph21_ter}, pot_pph21=${next.pot_pph21}, calculated=${pph21Val}`);
        }
        return next;
    });
    console.log(`[prepareDomTaxExcelRows] Output: ${preparedEmployees.length} employees, totalPph21=${totalPph21}`);

    return { employees: preparedEmployees, totalPph21 };
}
