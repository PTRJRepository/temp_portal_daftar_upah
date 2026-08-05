import { describe, expect, test } from "bun:test";
import { prepareDomTaxExcelRows } from "./taxDomExportRows";

describe("prepareDomTaxExcelRows", () => {
    test("builds Excel-ready premium detail from DOM rows without database extraction", () => {
        const componentMetadata = {
            pph21: {
                task_code: "TX001",
                task_desc: "PPh21",
                dr_acct: "6000",
                cr_acct: "2000"
            }
        };

        const result = prepareDomTaxExcelRows(
            [
                {
                    emp_code: "A0001",
                    nama: "Siti",
                    gaji_pokok_ideal: 100000,
                    gaji_pokok_aktual: 80000,
                    exgratia_amount: 50000,
                    other_incomes: [
                        { income_type: "THR", income_name: "THR", amount: 25000 },
                        { income_type: "KONTAN", income_name: "Kontanan", amount: 15000 }
                    ],
                    pph21_ter: 7500,
                    pot_pph21: 4000,
                    premi: {
                        pruning: 30000,
                        brondol: 20000,
                        PPH21: 99999,
                        KOREKSI: 11111
                    },
                    premi_pruning: 30000,
                    premi_brondol: 20000
                }
            ],
            ["premi_pruning", "premi_brondol"],
            componentMetadata
        );

        expect(result.totalPph21).toBe(7500);
        expect(result.employees[0].component_metadata).toBe(componentMetadata);
        expect(result.employees[0].bonus).toBe(50000);
        expect(result.employees[0].bonus_amount).toBe(50000);
        expect(result.employees[0].pendapatan_bonus).toBe(50000);
        expect(result.employees[0].pendapatan_thr).toBe(25000);
        expect(result.employees[0].pendapatan_kontan).toBe(15000);
        // pot_alpa_cth tidak lagi di-set di taxDomExportRows — potongan alpa dihitung di
        // taxReportExcelService dengan upah_dasar × jumlah_hari_dalam_bulan (bukan ×HK).
        expect(result.employees[0].pot_alpa_cth).toBeUndefined();
        expect(result.employees[0].premi_detail).toEqual({
            premi_pruning: 30000,
            premi_brondol: 20000
        });
    });

    test("keeps exgratia visible to tax export by canonicalizing it into bonus", () => {
        const result = prepareDomTaxExcelRows([
            {
                emp_code: "A0002",
                nama: "Rina",
                other_incomes: [
                    { income_type: "EXGRATIA", income_name: "Exgratia", amount: 125000 }
                ],
                pph21_ter: 0
            }
        ]);

        expect(result.employees[0].bonus).toBe(125000);
        expect(result.employees[0].bonus_amount).toBe(125000);
        expect(result.employees[0].pendapatan_bonus).toBe(125000);
    });

    test("keeps positive HK correction as lebih_hk instead of pot_alpa", () => {
        const result = prepareDomTaxExcelRows([
            {
                emp_code: "A0003",
                nama: "Dedi",
                gaji_pokok_ideal: 100000,
                gaji_pokok_aktual: 115000,
                koreksi_hk: 15000
            }
        ]);

        expect(result.employees[0].pot_alpa_cth).toBeUndefined();
        expect(result.employees[0].lebih_hk).toBe(15000);
    });
});
