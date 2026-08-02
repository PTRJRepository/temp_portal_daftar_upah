import { describe, expect, it } from "bun:test";
import {
    attachManualAdjustmentSourceComparisons,
    attachManualAdjustmentValueSourceComparison,
    normalizePayrollValuePriorityMode,
    pickStaticPremiForManualBuffer,
    resolveManualAdjustmentDbPtrjCompareAmount,
    resolveManualAdjustmentFetchGangCode,
    resolveManualAdjustmentSourcePolicy,
    shouldKeepPayrollRowAfterEffectiveHkFilter
} from "./dataExtractorService";

describe("resolveManualAdjustmentSourcePolicy", () => {
    it("normalizes old smart/manual-buffer inputs into the single non-DB_PTRJ mode", () => {
        expect(normalizePayrollValuePriorityMode()).toBe("non_db_ptrj");
        expect(normalizePayrollValuePriorityMode("smart")).toBe("non_db_ptrj");
        expect(normalizePayrollValuePriorityMode("manual_buffer_only")).toBe("non_db_ptrj");
        expect(normalizePayrollValuePriorityMode("non_db_ptrj")).toBe("non_db_ptrj");
        expect(normalizePayrollValuePriorityMode("db_ptrj_only")).toBe("db_ptrj_only");
    });

    it("keeps extend_db_ptrj metadata available in DB_PTRJ-only mode without applying manual amounts", () => {
        expect(resolveManualAdjustmentSourcePolicy("db_ptrj_only")).toEqual({
            applyAmounts: false,
            fetchRowsForMetadata: true,
            manualBufferOnly: false
        });
    });

    it("uses auto-buffer/manual-adjustment sources in non-DB_PTRJ mode", () => {
        expect(resolveManualAdjustmentSourcePolicy("non_db_ptrj")).toEqual({
            applyAmounts: true,
            fetchRowsForMetadata: true,
            manualBufferOnly: true
        });
    });

    it("keeps DB_PTRJ brondol as the only static premi in non-DB_PTRJ mode", () => {
        expect(pickStaticPremiForManualBuffer({
            brondol: 125000,
            premi_pruning: 50000,
            premi_kinerja: 75000
        })).toEqual({
            brondol: 125000
        });
    });

    it("keeps zero-effective-HK employees when they have manual adjustment rows", () => {
        expect(shouldKeepPayrollRowAfterEffectiveHkFilter({
            jumlahHk: 2,
            cutiMingguHari: 1,
            cutiNasionalHari: 1,
            hasManualAdjustments: true
        })).toBe(true);

        expect(shouldKeepPayrollRowAfterEffectiveHkFilter({
            jumlahHk: 2,
            cutiMingguHari: 1,
            cutiNasionalHari: 1,
            hasManualAdjustments: false
        })).toBe(false);
    });

    it("fetches manual adjustments by division instead of current gang so moved employees keep manual premiums", () => {
        expect(resolveManualAdjustmentFetchGangCode("C3M", "PG2A")).toBeUndefined();
        expect(resolveManualAdjustmentFetchGangCode("ALL", "PG2A")).toBeUndefined();
        expect(resolveManualAdjustmentFetchGangCode()).toBeUndefined();
    });

    it("keeps the gang filter when no division scope exists", () => {
        expect(resolveManualAdjustmentFetchGangCode("C3M")).toBe("C3M");
        expect(resolveManualAdjustmentFetchGangCode("ALL")).toBeUndefined();
    });

    it("adds manual adjustment compare entries for koreksi and potongan bersih fields", () => {
        const frame: Record<string, "red" | "green"> = {};
        const compare: Record<string, { db_ptrj: number; active: number }> = {};

        attachManualAdjustmentValueSourceComparison(frame, compare, {
            fieldName: "koreksi_denda_panen",
            adjustmentType: "POTONGAN_KOTOR",
            adjustmentName: "KOREKSI DENDA PANEN",
            previousAmount: 7000,
            finalAmount: 10000,
            hadDbValue: true
        });
        attachManualAdjustmentValueSourceComparison(frame, compare, {
            fieldName: "potongan_lainnya_kasbon",
            adjustmentType: "POTONGAN_BERSIH",
            adjustmentName: "POTONGAN LAINNYA KASBON",
            previousAmount: 2000,
            finalAmount: 5000,
            hadDbValue: true
        });

        expect(frame.koreksi_denda_panen).toBe("red");
        expect(frame.potongan_lainnya_kasbon).toBe("red");
        expect(compare.koreksi_denda_panen).toEqual({ db_ptrj: 7000, active: 10000 });
        expect(compare.potongan_lainnya_kasbon).toEqual({ db_ptrj: 2000, active: 5000 });
    });

    it("uses summed DB_PTRJ premium amount for manual adjustment compare color", () => {
        const syncMeta = {
            fieldName: "premi_jaga",
            adjustmentType: "PREMI" as const,
            adjustmentName: "PREMI JAGA",
            previousAmount: 0,
            finalAmount: 350000,
            hadDbValue: false
        };
        const dbPtrjAmount = resolveManualAdjustmentDbPtrjCompareAmount(
            syncMeta,
            { premi_jaga: 200000, JAGA: 150000 },
            {}
        );
        const frame: Record<string, "red" | "green"> = {};
        const compare: Record<string, { db_ptrj: number; active: number }> = {};

        attachManualAdjustmentValueSourceComparison(frame, compare, syncMeta, dbPtrjAmount);

        expect(dbPtrjAmount).toBe(350000);
        expect(frame.premi_jaga).toBe("green");
        expect(compare.premi_jaga).toEqual({ db_ptrj: 350000, active: 350000 });
    });

    it("does not mark manual-only fields red when no DB_PTRJ counterpart exists", () => {
        const syncMeta = {
            fieldName: "premi_tiket_manual",
            adjustmentType: "PREMI" as const,
            adjustmentName: "PREMI TIKET MANUAL",
            previousAmount: 0,
            finalAmount: 125000,
            hadDbValue: false
        };
        const dbPtrjAmount = resolveManualAdjustmentDbPtrjCompareAmount(syncMeta, {}, {});
        const frame: Record<string, "red" | "green"> = {};
        const compare: Record<string, { db_ptrj: number; active: number }> = {};

        attachManualAdjustmentValueSourceComparison(frame, compare, syncMeta, dbPtrjAmount);

        expect(dbPtrjAmount).toBeNull();
        expect(frame).toEqual({});
        expect(compare).toEqual({});
    });

    it("matches DB_PTRJ premi jaga variants to the manual adjustment name field", () => {
        const syncMeta = {
            fieldName: "premi_jaga",
            adjustmentType: "PREMI" as const,
            adjustmentName: "PREMI JAGA",
            previousAmount: 0,
            finalAmount: 250000,
            hadDbValue: false
        };

        const dbPtrjAmount = resolveManualAdjustmentDbPtrjCompareAmount(
            syncMeta,
            { premi_jaga_genset: 250000, premi_jaga_tanggung_jawab: 400000 },
            {}
        );

        expect(dbPtrjAmount).toBe(250000);
    });

    it("matches DB_PTRJ koreksi brondol variants to the manual adjustment field name", () => {
        const syncMeta = {
            fieldName: "koreksi_brondol",
            adjustmentType: "POTONGAN_KOTOR" as const,
            adjustmentName: "KOREKSI BRONDOL",
            previousAmount: 0,
            finalAmount: 27500,
            hadDbValue: false
        };

        const dbPtrjAmount = resolveManualAdjustmentDbPtrjCompareAmount(
            syncMeta,
            {},
            { KOREKSI_BERONDOL: -27500 }
        );

        expect(dbPtrjAmount).toBe(27500);
    });

    it("adds comparison frames for manual koreksi and potongan without applying manual amounts", () => {
        const frame: Record<string, "red" | "green"> = {};
        const compare: Record<string, { db_ptrj: number; active: number }> = {};
        const dbPremiSource = { premi_pruning: 100000 };
        const dbPotonganSource = {
            koreksi_brondol: -5000,
            potongan_lainnya_kasbon: -3000
        };

        const syncMetas = attachManualAdjustmentSourceComparisons(
            frame,
            compare,
            [
                { adjustment_type: "POTONGAN_KOTOR", adjustment_name: "KOREKSI BRONDOL", amount: 7000 },
                { adjustment_type: "POTONGAN_BERSIH", adjustment_name: "POTONGAN LAINNYA KASBON", amount: 3000 }
            ],
            dbPremiSource,
            dbPotonganSource
        );

        expect(syncMetas.map((item) => item.fieldName)).toEqual(["koreksi_brondol", "potongan_lainnya_kasbon"]);
        expect(frame.koreksi_brondol).toBe("red");
        expect(frame.potongan_lainnya_kasbon).toBe("green");
        expect(compare.koreksi_brondol).toEqual({ db_ptrj: 5000, active: 7000 });
        expect(compare.potongan_lainnya_kasbon).toEqual({ db_ptrj: 3000, active: 3000 });
        expect(dbPotonganSource.koreksi_brondol).toBe(-5000);
    });
});
