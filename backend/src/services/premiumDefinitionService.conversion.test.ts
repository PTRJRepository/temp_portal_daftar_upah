import { test, expect, describe } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PremiumDefinitionService } from "./premiumDefinitionService";

const fixture = [
    { adjustment_type: "PREMI", adjustment_name: "PREMI PRUNING", ad_code: "(AL3PM0601P1A) (AL) TUNJANGAN PREMI ((PM) PRUNING)", task_desc: "(AL) TUNJANGAN PREMI ((PM) PRUNING)", input_type: "blok" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI RAKING", ad_code: "(AL) TUNJANGAN PREMI ((PM) WEEDING - CIRCLE RAKING)", task_desc: "(AL) TUNJANGAN PREMI ((PM) WEEDING - CIRCLE RAKING)", input_type: "blok" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI ANGKUT TBS", ad_code: "(AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT TBS)", task_desc: "(AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT TBS)", input_type: "kendaraan" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI TIKET", ad_code: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", task_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", input_type: "amount" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI JAGA TANGGUNG JAWAB", ad_code: "(AL) TUNJANGAN PREMI (WORKSHOP CONTROL ACCOUNT)", task_desc: "(AL) TUNJANGAN PREMI (WORKSHOP CONTROL ACCOUNT)", input_type: "exp" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI KINERJA", ad_code: "(AL3PM2207P2A) (AL) TUNJANGAN PREMI - TUNJANGAN PREMI KINERJA", task_desc: "(AL) TUNJANGAN PREMI - TUNJANGAN PREMI KINERJA", input_type: "blok,exp" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI MATI", ad_code: "(AL) X", task_desc: "(AL) X", input_type: "amount" as const, is_active: false },
    { adjustment_type: "POTONGAN_BERSIH", adjustment_name: "POTONGAN BPJS", ad_code: "DE0002", task_desc: "(DE) POTONGAN HUTANG", input_type: "amount" as const, is_active: true }
];

function makeService(): PremiumDefinitionService {
    return PremiumDefinitionService.createForFile("__test_conversion_fixture__");
}

// Bypass file load by patching prototype to use fixture
const proto = PremiumDefinitionService.prototype as any;
const origLoad = proto.loadDefinitions;
(proto as any).loadDefinitions = function (this: PremiumDefinitionService) {
    // @ts-ignore - access private for test
    if (this.__fixture) return this.__fixture;
    return origLoad.call(this);
};

function serviceWith(fixtureOverride: any[] = fixture): PremiumDefinitionService {
    const s = makeService();
    (s as any).__fixture = fixtureOverride;
    return s;
}

describe("validatePremiumConversion — blocked pairs", () => {
    test("blok → kendaraan BLOCKED", () => {
        const v = serviceWith().validatePremiumConversion("PREMI PRUNING", "PREMI ANGKUT TBS");
        expect(v.allowed).toBe(false);
        expect(v.reason).toContain("diblokir");
        expect(v.metadata_action).toBe("keep");
    });
    test("kendaraan → blok BLOCKED", () => {
        const v = serviceWith().validatePremiumConversion("PREMI ANGKUT TBS", "PREMI PRUNING");
        expect(v.allowed).toBe(false);
        expect(v.reason).toContain("diblokir");
    });
    test("blok,exp → kendaraan BLOCKED", () => {
        const v = serviceWith().validatePremiumConversion("PREMI KINERJA", "PREMI ANGKUT TBS");
        expect(v.allowed).toBe(false);
        expect(v.reason).toContain("diblokir");
    });
    test("kendaraan → blok,exp BLOCKED", () => {
        const v = serviceWith().validatePremiumConversion("PREMI ANGKUT TBS", "PREMI KINERJA");
        expect(v.allowed).toBe(false);
    });
});

describe("validatePremiumConversion — allowed pairs", () => {
    test("blok → blok ALLOWED keep", () => {
        const v = serviceWith().validatePremiumConversion("PREMI PRUNING", "PREMI RAKING");
        expect(v.allowed).toBe(true);
        expect(v.metadata_action).toBe("keep");
    });
    test("blok → amount ALLOWED drop", () => {
        const v = serviceWith().validatePremiumConversion("PREMI PRUNING", "PREMI TIKET");
        expect(v.allowed).toBe(true);
        expect(v.metadata_action).toBe("drop");
    });
    test("amount → blok ALLOWED seed", () => {
        const v = serviceWith().validatePremiumConversion("PREMI TIKET", "PREMI PRUNING");
        expect(v.allowed).toBe(true);
        expect(v.metadata_action).toBe("seed");
    });
    test("blok → exp ALLOWED remap", () => {
        const v = serviceWith().validatePremiumConversion("PREMI PRUNING", "PREMI JAGA TANGGUNG JAWAB");
        expect(v.allowed).toBe(true);
        expect(v.metadata_action).toBe("remap");
    });
    test("exp → kendaraan ALLOWED remap", () => {
        const v = serviceWith().validatePremiumConversion("PREMI JAGA TANGGUNG JAWAB", "PREMI ANGKUT TBS");
        expect(v.allowed).toBe(true);
        expect(v.metadata_action).toBe("remap");
    });
});

describe("validatePremiumConversion — invalid inputs", () => {
    test("source inactive BLOCKED", () => {
        const v = serviceWith().validatePremiumConversion("PREMI MATI", "PREMI TIKET");
        expect(v.allowed).toBe(false);
        expect(v.reason).toContain("tidak ditemukan");
    });
    test("target not found BLOCKED", () => {
        const v = serviceWith().validatePremiumConversion("PREMI TIKET", "PREMI TIDAK ADA");
        expect(v.allowed).toBe(false);
        expect(v.reason).toContain("tidak ditemukan");
    });
    test("cross adjustment_type BLOCKED", () => {
        const v = serviceWith().validatePremiumConversion("PREMI TIKET", "POTONGAN BPJS");
        expect(v.allowed).toBe(false);
        expect(v.reason).toContain("adjustment_type beda");
    });
});

describe("premium definition potongan bersih defaults", () => {
    test("normalizes non-PPH POTONGAN_BERSIH definitions to POTONGAN HUTANG", () => {
        const dir = mkdtempSync(join(tmpdir(), "premium-definitions-"));
        const file = join(dir, "premium_definitions.json");
        writeFileSync(file, JSON.stringify([
            {
                adjustment_type: "POTONGAN_BERSIH",
                adjustment_name: "POTONGAN BPJS",
                ad_code: "(DE) POTONGAN BPJS",
                task_desc: "(DE) POTONGAN BPJS",
                input_type: "amount",
                is_active: true
            },
            {
                adjustment_type: "POTONGAN_BERSIH",
                adjustment_name: "POTONGAN PPH21",
                ad_code: "DE0099",
                task_desc: "(DE) POTONGAN PPH21",
                input_type: "amount",
                is_active: true
            }
        ]), "utf-8");

        try {
            const definitions = PremiumDefinitionService.createForFile(file).getActiveDefinitions();
            expect(definitions[0]).toMatchObject({
                ad_code: "DE0002",
                task_desc: "(DE) POTONGAN HUTANG"
            });
            expect(definitions[1]).toMatchObject({
                ad_code: "DE0099",
                task_desc: "(DE) POTONGAN PPH21"
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
