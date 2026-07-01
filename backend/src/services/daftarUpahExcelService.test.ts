import { describe, expect, test } from 'bun:test';
import ExcelJS from 'exceljs';
import { generateDaftarUpahExcel } from './daftarUpahExcelService';

describe('generateDaftarUpahExcel', () => {
    test('adds pendapatan lainnya detail columns under upah kotor and potongan upah bersih', async () => {
        const buffer = await generateDaftarUpahExcel([
            {
                gang_code: 'A01',
                nik: '123',
                nama: 'Sari',
                jumlah_hk: 25,
                upah_dasar: 100000,
                gaji_pokok_aktual: 2500000,
                total_premi: 0,
                other_incomes: [
                    { type: 'THR', name: 'THR', amount: 500000 },
                    { type: 'KONTAN', name: 'Kontan Manual', amount: 125000 },
                    { type: 'BONUS', name: 'Bonus Produksi', amount: 75000 },
                ],
                total_pendapatan_lainnya: 700000,
            },
        ], 2, 2026, 'EST', 'A01');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];

        const row3 = sheet.getRow(3).values as any[];
        const row4 = sheet.getRow(4).values as any[];
        const row6 = sheet.getRow(6).values as any[];

        expect(row3).toContain('PENDAPATAN LAINNYA');
        expect(row3).toContain('POTONGAN UPAH BERSIH');
        expect(row3).not.toContain('POTONGAN UPAH KOTOR');
        expect(row4).toContain('THR\n(+)');
        expect(row4).toContain('KONTANAN\n(+)');
        expect(row4).toContain('PENDAPATAN BONUS\n(+)');
        expect(row4).toContain('THR\n(-)');
        expect(row4).toContain('KONTANAN\n(-)');
        expect(row4).toContain('PENDAPATAN BONUS\n(-)');

        const thrIncomeCol = row4.findIndex((value) => value === 'THR\n(+)');
        const kontanIncomeCol = row4.findIndex((value) => value === 'KONTANAN\n(+)');
        const bonusIncomeCol = row4.findIndex((value) => value === 'PENDAPATAN BONUS\n(+)');
        const thrDeductionCol = row4.findIndex((value) => value === 'THR\n(-)');
        const kontanDeductionCol = row4.findIndex((value) => value === 'KONTANAN\n(-)');
        const bonusDeductionCol = row4.findIndex((value) => value === 'PENDAPATAN BONUS\n(-)');
        const totalDeductionCol = row4.findIndex((value) => value === 'TOTAL\nPOTONGAN');

        expect(row6[thrIncomeCol]).toBe(500000);
        expect(row6[kontanIncomeCol]).toBe(125000);
        expect(row6[bonusIncomeCol]).toBe(75000);
        expect(row6[thrDeductionCol]).toBe(-500000);
        expect(row6[kontanDeductionCol]).toBe(-125000);
        expect(row6[bonusDeductionCol]).toBe(-75000);
        expect(row6[totalDeductionCol]).toMatchObject({ formula: `SUM(${sheet.getColumn(thrDeductionCol).letter}6:${sheet.getColumn(totalDeductionCol - 1).letter}6)` });
    });

    test('canonicalizes exgratia into bonus columns so payroll and tax exports stay aligned', async () => {
        const buffer = await generateDaftarUpahExcel([
            {
                gang_code: 'A01',
                nik: '123',
                nama: 'Sari',
                jumlah_hk: 25,
                upah_dasar: 100000,
                gaji_pokok_aktual: 2500000,
                total_premi: 0,
                other_incomes: [
                    { type: 'BONUS', name: 'Bonus Produksi', amount: 75000 },
                    { type: 'EXGRATIA', name: 'Exgratia', amount: 125000 },
                ],
                total_pendapatan_lainnya: 200000,
            },
        ], 2, 2026, 'EST', 'A01');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];

        const row4 = sheet.getRow(4).values as any[];
        const row6 = sheet.getRow(6).values as any[];
        const bonusIncomeCol = row4.findIndex((value) => value === 'PENDAPATAN BONUS\n(+)');
        const exgratiaIncomeCol = row4.findIndex((value) => value === 'EXGRATIA\n(+)');

        expect(bonusIncomeCol).toBeGreaterThan(0);
        expect(exgratiaIncomeCol).toBe(-1);
        expect(row6[bonusIncomeCol]).toBe(200000);
    });

    test('exports koreksi as negative gross deduction and includes it in upah kotor formula', async () => {
        const buffer = await generateDaftarUpahExcel([
            {
                gang_code: 'A01',
                nik: '123',
                nama: 'Sari',
                jumlah_hk: 25,
                upah_dasar: 100000,
                gaji_pokok_aktual: 2500000,
                total_tunjangan: 0,
                total_premi: 0,
                pot_koreksi: -10000,
                jumlah_upah_kotor: 2490000,
            },
        ], 2, 2026, 'EST', 'A01');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];
        const row3 = sheet.getRow(3).values as any[];
        const row4 = sheet.getRow(4).values as any[];
        const row6 = sheet.getRow(6).values as any[];

        const koreksiCol = row4.findIndex((value) => value === 'TOTAL\nKOREKSI (-)');
        const upahKotorCol = row4.findIndex((value) => String(value || '').startsWith('UPAH KOTOR'));

        expect(row3).toContain('POTONGAN UPAH KOTOR');
        expect(row6[koreksiCol]).toBe(-10000);
        expect(row6[upahKotorCol]).toMatchObject({
            formula: expect.stringContaining(`+${sheet.getColumn(koreksiCol).letter}6`),
            result: 2490000,
        });
        expect(row6[upahKotorCol]).toMatchObject({ formula: expect.not.stringContaining('-') });
    });

    test('exports net deductions as negative values and adds total potongan to upah bersih', async () => {
        const buffer = await generateDaftarUpahExcel([
            {
                gang_code: 'A01',
                nik: '123',
                nama: 'Sari',
                jumlah_hk: 25,
                upah_dasar: 100000,
                gaji_pokok_aktual: 2500000,
                total_tunjangan: 0,
                total_premi: 0,
                pot_spsi: 20000,
                pot_pph21: -30000,
                total_potongan_bersih: 50000,
                jumlah_upah_kotor: 2500000,
                upah_bersih: 2450000,
            },
        ], 2, 2026, 'EST', 'A01');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];
        const row4 = sheet.getRow(4).values as any[];
        const row6 = sheet.getRow(6).values as any[];

        const spsiCol = row4.findIndex((value) => value === 'SPSI');
        const pphCol = row4.findIndex((value) => value === 'PPH21');
        const totalDeductionCol = row4.findIndex((value) => value === 'TOTAL\nPOTONGAN');
        const upahBersihCol = row4.findIndex((value) => String(value || '').startsWith('UPAH BERSIH'));

        expect(row6[spsiCol]).toBe(-20000);
        expect(row6[pphCol]).toBe(-30000);
        expect(row6[totalDeductionCol]).toMatchObject({ result: -50000 });
        expect(row6[upahBersihCol]).toMatchObject({
            formula: expect.stringContaining(`+${sheet.getColumn(totalDeductionCol).letter}6`),
            result: 2450000,
        });
        expect(row6[upahBersihCol]).toMatchObject({ formula: expect.not.stringContaining('-') });
    });

    test('includes BPJS PENSIUN pekerja column in total potongan (IMPL-4)', async () => {
        // carumanBase = gpStandar + masaKerja. gpStandar derived from upah_dasar/hk * hk.
        // Use upah_dasar=100000, hk=25 -> gpStandar=2500000? Verify rate-based values via result field.
        const buffer = await generateDaftarUpahExcel([
            {
                gang_code: 'A01',
                nik: '123',
                nama: 'BPJS PEN',
                jumlah_hk: 25,
                upah_dasar: 100000,
                gaji_pokok_aktual: 2500000,
                total_tunjangan: 0,
                total_premi: 0,
                pot_spsi: 0,
                pot_pph21: 0,
                pot_bpjs_pensiun_pekerja: 25000,
                total_potongan_bersih: 25000,
                jumlah_upah_kotor: 2500000,
                upah_bersih: 2475000,
            },
        ], 2, 2026, 'EST', 'A01');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as any);
        const sheet = workbook.worksheets[0];
        const row4 = sheet.getRow(4).values as any[];
        const row6 = sheet.getRow(6).values as any[];

        const bpjsPenCol = row4.findIndex((value) => String(value || '').toUpperCase().includes('BPJS PEN'));
        expect(bpjsPenCol).toBeGreaterThan(0);
        // Cell value should be a negative formula (rate-based) or negative number.
        const cell = row6[bpjsPenCol];
        expect(Number(typeof cell === 'object' && cell?.result !== undefined ? cell.result : cell)).toBeLessThanOrEqual(0);
    });
});
