import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { generateMonthlyTaxExcel } from "./taxReportExcelService";

describe("generateMonthlyTaxExcel", () => {
    test("uses DOM component values so standard-sheet bruto equals visible component sum", async () => {
        const buffer = await generateMonthlyTaxExcel(
            {
                period: { month: 4, year: 2026 },
                total_pph21: 1234,
                employees: [
                    {
                        emp_code: "A0001",
                        emp_name: "Siti",
                        nik: "123",
                        npwp: "-",
                        alamat: "Estate",
                        jabatan: "Karyawan",
                        gender: "L",
                        status_ptkp: "TK/0",
                        kategori_ter: "A",
                        upah_dasar: 999999,
                        gaji_pokok_bulanan: 110000,
                        gaji_pokok_dibayarkan: 100000,
                        pot_alpa_cth: -10000,
                        astek_084pct: 840,
                        bpjs_kes_majikan: 4000,
                        beras_jumlah: 12000,
                        jabatan_jumlah: 15000,
                        lembur_jumlah: 7000,
                        masa_kerja_jumlah: 3000,
                        premi_detail: { premi_insentif_panen: 50000 },
                        pot_koreksi: 2000,
                        pendapatan_thr: 6000,
                        bonus: 8000,
                        pendapatan_kontan: 7000,
                        penghasilan_bruto: 210840,
                        tarif_pajak_ter: 1,
                        pph21_ter: 1234
                    } as any
                ]
            },
            2026,
            4,
            "AB1",
            "A1H",
            ["premi_insentif_panen"]
        );

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.getWorksheet("Format Standar Pajak");

        expect(sheet).toBeDefined();
        expect(sheet!.getCell("K5").value).toBe(110000);
        expect(sheet!.getCell("L5").value).toBe(-10000);
        expect(sheet!.getCell("M5").value).toBe(0);
        expect(sheet!.getCell("N5").value).toBe(840);
        expect(sheet!.getCell("V5").value).toBe(6000);
        expect(sheet!.getCell("W5").value).toBe(8000);
        expect(sheet!.getCell("X5").value).toBe(7000);

        const brutoCell = sheet!.getCell("Y5").value as ExcelJS.CellFormulaValue;
        expect(brutoCell.formula).toBe("SUM(K5:X5)");
        expect(brutoCell.result).toBe(210840);
    });

    test("exports positive HK correction as Lebih HK beside Pot. Alpa", async () => {
        const buffer = await generateMonthlyTaxExcel(
            {
                period: { month: 4, year: 2026 },
                total_pph21: 0,
                employees: [
                    {
                        emp_code: "A0003",
                        emp_name: "Dedi",
                        nik: "789",
                        npwp: "-",
                        alamat: "Estate",
                        jabatan: "Karyawan",
                        gender: "L",
                        status_ptkp: "TK/0",
                        kategori_ter: "A",
                        gaji_pokok_bulanan: 100000,
                        gaji_pokok_dibayarkan: 115000,
                        koreksi_hk: 15000,
                        penghasilan_bruto: 115000,
                        tarif_pajak_ter: 0,
                        pph21_ter: 0
                    } as any
                ]
            },
            2026,
            4,
            "AB1",
            "A1H",
            []
        );

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.getWorksheet("Format Standar Pajak");

        expect(sheet!.getCell("L4").value).toBe("Pot. Alpa (-)");
        expect(sheet!.getCell("M4").value).toBe("Lebih HK (+)");
        expect(sheet!.getCell("L5").value).toBe(0);
        expect(sheet!.getCell("M5").value).toBe(15000);
        expect(sheet!.getCell("U5").value).toBe(0);

        const brutoCell = sheet!.getCell("Y5").value as ExcelJS.CellFormulaValue;
        expect(brutoCell.formula).toBe("SUM(K5:X5)");
        expect(brutoCell.result).toBe(115000);
    });

    test("exports top-level exgratia as bonus so pajak does not drop Daftar Upah income", async () => {
        const buffer = await generateMonthlyTaxExcel(
            {
                period: { month: 4, year: 2026 },
                total_pph21: 0,
                employees: [
                    {
                        emp_code: "A0002",
                        emp_name: "Rina",
                        nik: "456",
                        npwp: "-",
                        alamat: "Estate",
                        jabatan: "Karyawan",
                        gender: "P",
                        status_ptkp: "TK/0",
                        kategori_ter: "A",
                        pendapatan_exgratia: 125000,
                        penghasilan_bruto: 125000,
                        tarif_pajak_ter: 0,
                        pph21_ter: 0
                    } as any
                ]
            },
            2026,
            4,
            "AB1",
            "A1H",
            []
        );

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.getWorksheet("Format Standar Pajak");

        expect(sheet!.getCell("W5").value).toBe(125000);
    });
});
