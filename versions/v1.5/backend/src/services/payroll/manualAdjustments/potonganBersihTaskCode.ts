const LOC_CODE_BY_DIVISION: Record<string, string> = {
    PG1A: "P1A",
    P1A: "P1A",
    PLASMA1A: "P1A",
    "1A": "P1A",
    PG1B: "P1B",
    P1B: "P1B",
    PLASMA1B: "P1B",
    "1B": "P1B",
    PG2A: "P2A",
    P2A: "P2A",
    PLASMA2A: "P2A",
    "2A": "P2A",
    PG2B: "P2B",
    P2B: "P2B",
    PLASMA2B: "P2B",
    "2B": "P2B",
    ARB1: "AB1",
    AB1: "AB1",
    "AB-1": "AB1",
    ARB2: "AB2",
    AB2: "AB2",
    "AB-2": "AB2",
    AREC: "ARC",
    ARC: "ARC",
    ARA: "ARA",
    DME: "DME",
    IJL: "IJL"
};

const HUTANG_TASK_CODE_BY_LOC: Record<string, string> = {
    AB1: "DE0002AB1",
    AB2: "DE0002AB2",
    ARA: "DE0002ARA",
    ARC: "DE0002ARC",
    DME: "DE0002DME",
    IJL: "DE0002IJL",
    P1A: "DE0002P1A",
    P1B: "DE0002P1B",
    P2A: "DE0002P2A",
    P2B: "DE0002P2B"
};

export const POTONGAN_BERSIH_HUTANG_AD_CODE = "DE0002";
export const POTONGAN_BERSIH_HUTANG_TASK_DESC = "(DE) POTONGAN HUTANG";

export interface PotonganBersihHutangTaskCodeMapping {
    ad_code: string;
    task_code: string;
    base_task_code: string;
    task_desc: string;
}

function normalizeLocCode(value?: string | null): string {
    const normalized = String(value || "").trim().replace(/\s+/g, "_").toUpperCase();
    return LOC_CODE_BY_DIVISION[normalized] || normalized;
}

export function containsPphDeductionText(value: unknown): boolean {
    return /\bPPH(?:\s*0?21)?\b/i.test(String(value || ""));
}

export function resolvePotonganBersihHutangTaskCode(
    divisionOrLocCode?: string | null
): PotonganBersihHutangTaskCodeMapping {
    const locCode = normalizeLocCode(divisionOrLocCode);
    const taskCode = HUTANG_TASK_CODE_BY_LOC[locCode] || POTONGAN_BERSIH_HUTANG_AD_CODE;

    return {
        ad_code: POTONGAN_BERSIH_HUTANG_AD_CODE,
        task_code: taskCode,
        base_task_code: POTONGAN_BERSIH_HUTANG_AD_CODE,
        task_desc: POTONGAN_BERSIH_HUTANG_TASK_DESC
    };
}
