import * as ExcelJS from 'exceljs';
import { OtherIncomesService } from './otherIncomesService';

export class OtherIncomesExcelService {
    public static async generateExcel(year: number, month: number, divisionCode?: string, gangCode?: string, incomeType?: string): Promise<Buffer> {
        throw new Error("Method not implemented. THR Excel uses generateBankListExcel.");
    }

    private static getAsistensi(gangCode: string): string {
        if (!gangCode) return "1";
        const gc = gangCode.trim().toUpperCase();
        if (gc.startsWith('K2')) return "1";
        const match = gc.match(/\d+/);
        return match ? match[0] : "1";
    }

    public static async generateBankListExcel(year: number, month: number, divisionCode?: string, gangCode?: string): Promise<Buffer> {
        let incomes = await OtherIncomesService.getIncomesWithDetails(year, month, divisionCode, gangCode, 'THR');

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Bank List THR');

        // Determine mode: single division or all divisions
        const isSingleDivision = !!divisionCode && divisionCode !== 'ALL';

        // Title & Header
        worksheet.mergeCells('A1', 'F1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'LIST PEMBAYARAN BANK - THR';
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { horizontal: 'center' };

        worksheet.mergeCells('A2', 'F2');
        const subTitleCell = worksheet.getCell('A2');
        subTitleCell.value = `PERIODE: ${month}/${year} | UNIT: ${divisionCode || 'SEMUA'}`;
        subTitleCell.alignment = { horizontal: 'center' };

        const headerRow = worksheet.getRow(4);
        headerRow.values = ['NO', 'EMPCODE', 'NAMA REKENING', 'NO REKENING', 'BANK', 'JUMLAH (Rp)'];
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
            cell.alignment = { horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        worksheet.columns = [
            { width: 8 },  // NO
            { width: 15 }, // EMPCODE
            { width: 45 }, // NAMA REKENING
            { width: 25 }, // ACCOUNT
            { width: 12 }, // BANK
            { width: 20 }, // AMOUNT
        ];

        let currentRow = 5;
        let totalAll = 0;

        if (isSingleDivision) {
            // ===== SINGLE DIVISION MODE: Group by gang only, subtotal per gang =====
            const gangGrouped: Record<string, any[]> = {};
            incomes.forEach(item => {
                const gcode = item.gang_code || 'TANPA GANG';
                if (!gangGrouped[gcode]) gangGrouped[gcode] = [];
                gangGrouped[gcode].push(item);
            });

            const gangKeys = Object.keys(gangGrouped).sort();

            for (const gcode of gangKeys) {
                // Gang Header
                const gangHeaderRow = worksheet.getRow(currentRow++);
                gangHeaderRow.getCell(1).value = `GANG: ${gcode}`;
                gangHeaderRow.getCell(1).font = { bold: true };
                gangHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                worksheet.mergeCells(`A${currentRow - 1}`, `F${currentRow - 1}`);

                const items = gangGrouped[gcode];
                let gangTotal = 0;

                items.forEach((item, idx) => {
                    const row = worksheet.getRow(currentRow++);
                    this.writeItemRow(row, item, idx);
                    gangTotal += Number(item.amount);
                    for (let i = 1; i <= 6; i++) {
                        row.getCell(i).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                    }
                });

                // Gang Subtotal
                const gangSubRow = worksheet.getRow(currentRow++);
                gangSubRow.getCell(1).value = `SUBTOTAL GANG ${gcode} (${items.length} orang)`;
                gangSubRow.getCell(6).value = gangTotal;
                gangSubRow.getCell(6).numFmt = '#.##0';
                gangSubRow.font = { bold: true, italic: true };
                gangSubRow.getCell(1).alignment = { horizontal: 'right' };
                gangSubRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
                worksheet.mergeCells(`A${currentRow - 1}`, `E${currentRow - 1}`);
                totalAll += gangTotal;
            }
        } else {
            // ===== ALL DIVISIONS MODE: Group by division â†’ gang, subtotals for both =====
            // Group: division_code â†’ gang_code â†’ items
            const divGrouped: Record<string, Record<string, any[]>> = {};
            incomes.forEach(item => {
                const divCode = item.division_code || 'TANPA DIVISI';
                const gcode = item.gang_code || 'TANPA GANG';
                if (!divGrouped[divCode]) divGrouped[divCode] = {};
                if (!divGrouped[divCode][gcode]) divGrouped[divCode][gcode] = [];
                divGrouped[divCode][gcode].push(item);
            });

            const divKeys = Object.keys(divGrouped).sort();

            for (const divKey of divKeys) {
                // Division Header
                const divHeaderRow = worksheet.getRow(currentRow++);
                divHeaderRow.getCell(1).value = `DIVISI: ${divKey}`;
                divHeaderRow.getCell(1).font = { bold: true, size: 12 };
                divHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } };
                worksheet.mergeCells(`A${currentRow - 1}`, `F${currentRow - 1}`);

                const gangs = divGrouped[divKey];
                const gangKeys = Object.keys(gangs).sort();
                let divisionTotal = 0;
                let divisionCount = 0;

                for (const gcode of gangKeys) {
                    // Gang Header
                    const gangHeaderRow = worksheet.getRow(currentRow++);
                    gangHeaderRow.getCell(1).value = `  GANG: ${gcode}`;
                    gangHeaderRow.getCell(1).font = { bold: true };
                    gangHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                    worksheet.mergeCells(`A${currentRow - 1}`, `F${currentRow - 1}`);

                    const items = gangs[gcode];
                    let gangTotal = 0;

                    items.forEach((item, idx) => {
                        const row = worksheet.getRow(currentRow++);
                        this.writeItemRow(row, item, idx);
                        gangTotal += Number(item.amount);
                        for (let i = 1; i <= 6; i++) {
                            row.getCell(i).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                        }
                    });

                    // Gang Subtotal
                    const gangSubRow = worksheet.getRow(currentRow++);
                    gangSubRow.getCell(1).value = `SUBTOTAL GANG ${gcode} (${items.length} orang)`;
                    gangSubRow.getCell(6).value = gangTotal;
                    gangSubRow.getCell(6).numFmt = '#.##0';
                    gangSubRow.font = { bold: true, italic: true };
                    gangSubRow.getCell(1).alignment = { horizontal: 'right' };
                    worksheet.mergeCells(`A${currentRow - 1}`, `E${currentRow - 1}`);
                    divisionTotal += gangTotal;
                    divisionCount += items.length;
                }

                // Division Subtotal
                const divSubRow = worksheet.getRow(currentRow++);
                divSubRow.getCell(1).value = `SUBTOTAL DIVISI ${divKey} (${divisionCount} orang)`;
                divSubRow.getCell(6).value = divisionTotal;
                divSubRow.getCell(6).numFmt = '#.##0';
                divSubRow.font = { bold: true };
                divSubRow.getCell(1).alignment = { horizontal: 'right' };
                divSubRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; });
                worksheet.mergeCells(`A${currentRow - 1}`, `E${currentRow - 1}`);
                totalAll += divisionTotal;
            }
        }

        // Grand Total
        const totalRow = worksheet.getRow(currentRow++);
        totalRow.getCell(1).value = `TOTAL TRANSFER KESELURUHAN (${incomes.length} orang)`;
        totalRow.getCell(6).value = totalAll;
        totalRow.getCell(6).numFmt = '#.##0';
        totalRow.font = { bold: true };
        totalRow.getCell(1).alignment = { horizontal: 'right' };
        totalRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } }; c.font = { color: { argb: 'FFFFFFFF' }, bold: true }; });
        worksheet.mergeCells(`A${currentRow - 1}`, `E${currentRow - 1}`);

        // Signatures
        currentRow += 2; // Add some empty rows before signature

        const titleSignRow = worksheet.getRow(currentRow++);
        titleSignRow.getCell(2).value = 'Dibuat Oleh,';
        titleSignRow.getCell(3).value = 'Diperiksa Oleh,';
        titleSignRow.getCell(4).value = 'Mengetahui,';
        titleSignRow.getCell(5).value = 'Disetujui Oleh,';

        [2, 3, 4, 5].forEach(col => {
            titleSignRow.getCell(col).alignment = { horizontal: 'center' };
            titleSignRow.getCell(col).font = { bold: true };
        });

        // Add 3 empty rows for signature space
        currentRow += 3;

        const spaceSignRow = worksheet.getRow(currentRow++);
        spaceSignRow.getCell(2).value = '( ...................................... )';
        spaceSignRow.getCell(3).value = '( ...................................... )';
        spaceSignRow.getCell(4).value = '( ...................................... )';
        spaceSignRow.getCell(5).value = '( ...................................... )';

        [2, 3, 4, 5].forEach(col => {
            spaceSignRow.getCell(col).alignment = { horizontal: 'center' };
            spaceSignRow.getCell(col).font = { bold: true };
        });

        const roleSignRow = worksheet.getRow(currentRow++);
        roleSignRow.getCell(2).value = 'KTU / Kerani';
        roleSignRow.getCell(3).value = 'Asisten';
        roleSignRow.getCell(4).value = 'Estate Manager';
        roleSignRow.getCell(5).value = 'Senior Manager';

        [2, 3, 4, 5].forEach(col => {
            roleSignRow.getCell(col).alignment = { horizontal: 'center' };
            roleSignRow.getCell(col).font = { size: 11, bold: true };
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return buffer as any as Buffer;
    }

    /**
     * Helper: write a single employee item row
     */
    private static writeItemRow(row: ExcelJS.Row, item: any, idx: number) {
        row.getCell(1).value = idx + 1;
        const empCode = item.emp_code || item.details?.variables?.EMP_CODE || '-';
        const cleanedName = (item.emp_name || '').split('(')[0].trim();
        row.getCell(2).value = empCode;
        row.getCell(2).alignment = { horizontal: 'center' };
        row.getCell(3).value = cleanedName;
        // Validate bank_acc_no: must be numeric, min 5 digits, no dates
        const rawBankAccNo = (item.bank_acc_no || '').trim();
        const bankDigits = rawBankAccNo.replace(/[-\s]/g, '');
        const bankAccNo = rawBankAccNo && /^\d{5,}$/.test(bankDigits) ? rawBankAccNo : '-';
        row.getCell(4).value = bankAccNo;
        row.getCell(4).alignment = { horizontal: 'center' };
        const bankCode = item.bank_code && item.bank_code !== '0' ? item.bank_code : 'BRI';
        row.getCell(5).value = bankCode;
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(6).value = Number(item.amount);
        row.getCell(6).numFmt = '#.##0';
    }

    /**
     * Generate THR Excel Report (Main THR Report with full details)
     */
    public static async generateTHRExcel(year: number, month: number, divisionCode?: string, gangCode?: string): Promise<Buffer> {
        let incomes = await OtherIncomesService.getIncomesWithDetails(year, month, divisionCode, gangCode, 'THR');

        // THR usually targets the next month's holiday
        const displayMonth = month === 12 ? 1 : month + 1;
        const displayYear = month === 12 ? year + 1 : year;
        const monthNames = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
        const mName = monthNames[displayMonth - 1];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan THR');

        // Title
        worksheet.mergeCells('A1', 'O1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'DAFTAR PEMBAYARAN TUNJANGAN HARI RAYA (THR)';
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { horizontal: 'center' };

        worksheet.mergeCells('A2', 'O2');
        const subTitleCell = worksheet.getCell('A2');
        subTitleCell.value = `PT. REBINMAS JAYA`;
        subTitleCell.font = { bold: true };
        subTitleCell.alignment = { horizontal: 'center' };

        worksheet.mergeCells('A3', 'O3');
        const periodCell = worksheet.getCell('A3');
        periodCell.value = `PERIODE THR: ${mName} ${displayYear} | UNIT: ${divisionCode || 'SEMUA'} | GANG: ${gangCode || 'SEMUA'}`;
        periodCell.alignment = { horizontal: 'center' };

        // Summary Cards
        let totalPenuh = 0;
        let totalProporsi = 0;
        let totalMasaKerja = 0;
        let totalBeras = 0;

        incomes.forEach(item => {
            const v = item.details?.variables || {};
            if (v.PROPORTION_FACTOR && v.PROPORTION_FACTOR !== '12/12') {
                totalProporsi++;
            } else {
                totalPenuh++;
            }
            totalMasaKerja += (v.MASA_KERJA_JUMLAH || 0);
            totalBeras += ((v.BERAS_RATE || 0) * 30);
        });

        // Summary row
        worksheet.mergeCells('A5', 'C5');
        worksheet.getCell('A5').value = `Total Karyawan: ${incomes.length}`;
        worksheet.getCell('A5').font = { bold: true };

        worksheet.mergeCells('D5', 'F5');
        worksheet.getCell('D5').value = `THR Penuh: ${totalPenuh} | Proporsi: ${totalProporsi}`;
        worksheet.getCell('D5').font = { bold: true };

        worksheet.mergeCells('G5', 'I5');
        worksheet.getCell('G5').value = `Tunj. Masa Kerja: Rp ${totalMasaKerja.toLocaleString('id-ID')}`;
        worksheet.getCell('G5').font = { bold: true };

        worksheet.mergeCells('J5', 'L5');
        worksheet.getCell('J5').value = `Tunj. Beras: Rp ${totalBeras.toLocaleString('id-ID')}`;
        worksheet.getCell('J5').font = { bold: true };

        // Headers (row 7)
        const headerRow = worksheet.getRow(7);
        const headers = [
            'NO', 'L/P', 'NAMA KARYAWAN', 'AGAMA', 'TGL MASUK',
            'UPAH DASAR', 'UPAH POKOK (30 HK)', 'TUNJ. BERAS RATE', 'TUNJ. BERAS JUMLAH',
            'MASA KERJA (THN)', 'MASA KERJA JUMLAH', 'UPAH KOTOR', 'PAJAK THR', 'KELAYAKAN', 'UPAH BERSIH'
        ];
        headerRow.values = headers;
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
            cell.alignment = { horizontal: 'center', wrapText: true };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        // Column widths
        worksheet.columns = [
            { width: 6 },   // NO
            { width: 6 },   // L/P
            { width: 35 },  // NAMA
            { width: 12 },  // AGAMA
            { width: 12 },  // TGL MASUK
            { width: 15 },  // UPAH DASAR
            { width: 18 },  // UPAH POKOK
            { width: 15 },  // BERAS RATE
            { width: 15 },  // BERAS JUMLAH
            { width: 12 },  // MASA KERJA THN
            { width: 15 },  // MASA KERJA JUMLAH
            { width: 15 },  // UPAH KOTOR
            { width: 12 },  // PAJAK THR
            { width: 12 },  // KELAYAKAN
            { width: 15 },  // UPAH BERSIH
        ];

        // Group by gang
        const groupedData: Record<string, any[]> = {};
        incomes.forEach(item => {
            const gcode = item.gang_code || 'TANPA GANG';
            if (!groupedData[gcode]) groupedData[gcode] = [];
            groupedData[gcode].push(item);
        });

        const gangKeys = Object.keys(groupedData).sort();
        let currentRow = 8;
        let grandTotalKotor = 0;

        for (const gcode of gangKeys) {
            // Gang Header
            const gangHeaderRow = worksheet.getRow(currentRow++);
            gangHeaderRow.getCell(1).value = `GANG: ${gcode}`;
            gangHeaderRow.getCell(1).font = { bold: true, size: 11 };
            gangHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            worksheet.mergeCells(`A${currentRow - 1}`, `O${currentRow - 1}`);

            const items = groupedData[gcode];
            let gangTotalKotor = 0;

            items.forEach((item, idx) => {
                const v = item.details?.variables || {};
                const row = worksheet.getRow(currentRow++);
                const cleanedName = (item.emp_name || '').split('(')[0].trim();
                const amount = Number(item.amount) || 0;
                const pajak = 0; // THR tidak ada pajak
                const upahDasar = v.UPAH_DASAR || item.upah_dasar || 0;
                const berasRate = v.BERAS_RATE || item.beras_rate || 0;
                const berasJumlah = berasRate * 30;
                const masaKerjaJumlah = v.MASA_KERJA_JUMLAH || 0;

                row.getCell(1).value = idx + 1;
                row.getCell(1).alignment = { horizontal: 'center' };
                row.getCell(2).value = v.SEX || item.sex || 'L';
                row.getCell(2).alignment = { horizontal: 'center' };
                row.getCell(3).value = cleanedName;
                row.getCell(4).value = ((item.religion || v.RELIGION || '').replace(/^\d+\s+/, '') || 'TIDAK ADA');
                row.getCell(4).alignment = { horizontal: 'center' };
                row.getCell(5).value = v.JOIN_DATE || item.join_date || '';
                row.getCell(5).alignment = { horizontal: 'center' };
                row.getCell(6).value = Number(upahDasar);
                row.getCell(6).numFmt = '#.##0';
                row.getCell(7).value = Number(upahDasar) * 30;
                row.getCell(7).numFmt = '#.##0';
                row.getCell(8).value = Number(berasRate);
                row.getCell(8).numFmt = '#.##0';
                row.getCell(9).value = Number(berasJumlah);
                row.getCell(9).numFmt = '#.##0';
                row.getCell(10).value = v.MASA_KERJA_TAHUN || 0;
                row.getCell(10).alignment = { horizontal: 'center' };
                row.getCell(11).value = Number(masaKerjaJumlah);
                row.getCell(11).numFmt = '#.##0';
                row.getCell(12).value = amount;
                row.getCell(12).numFmt = '#.##0';
                row.getCell(12).font = { bold: true };
                row.getCell(13).value = pajak;
                row.getCell(13).numFmt = '#.##0';
                row.getCell(14).value = (v.PROPORTION_FACTOR && v.PROPORTION_FACTOR !== '12/12') ? v.PROPORTION_FACTOR : 'PENUH';
                row.getCell(14).alignment = { horizontal: 'center' };
                row.getCell(15).value = amount - pajak;
                row.getCell(15).numFmt = '#.##0';
                row.getCell(15).font = { bold: true };

                // Apply borders to all cells
                for (let i = 1; i <= 15; i++) {
                    row.getCell(i).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                }

                gangTotalKotor += amount;
            });

            // Gang Subtotal
            const gangSubRow = worksheet.getRow(currentRow++);
            gangSubRow.getCell(1).value = `SUBTOTAL GANG ${gcode} (${items.length} orang)`;
            gangSubRow.getCell(12).value = gangTotalKotor;
            gangSubRow.getCell(12).numFmt = '#.##0';
            gangSubRow.getCell(12).font = { bold: true };
            gangSubRow.getCell(15).value = gangTotalKotor;
            gangSubRow.getCell(15).numFmt = '#.##0';
            gangSubRow.getCell(15).font = { bold: true };
            gangSubRow.getCell(1).alignment = { horizontal: 'right' };
            gangSubRow.font = { bold: true, italic: true };
            gangSubRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
            worksheet.mergeCells(`A${currentRow - 1}`, `K${currentRow - 1}`);

            grandTotalKotor += gangTotalKotor;
        }

        // Grand Total
        const totalRow = worksheet.getRow(currentRow++);
        totalRow.getCell(1).value = `TOTAL TRANSFER KESELURUHAN (${incomes.length} orang)`;
        totalRow.getCell(12).value = grandTotalKotor;
        totalRow.getCell(12).numFmt = '#.##0';
        totalRow.getCell(12).font = { bold: true };
        totalRow.getCell(15).value = grandTotalKotor;
        totalRow.getCell(15).numFmt = '#.##0';
        totalRow.getCell(15).font = { bold: true };
        totalRow.getCell(1).alignment = { horizontal: 'right' };
        totalRow.font = { bold: true };
        totalRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } }; c.font = { color: { argb: 'FFFFFFFF' }, bold: true }; });
        worksheet.mergeCells(`A${currentRow - 1}`, `K${currentRow - 1}`);

        // Signatures
        currentRow += 2;

        const titleSignRow = worksheet.getRow(currentRow++);
        titleSignRow.getCell(2).value = 'Dibuat Oleh,';
        titleSignRow.getCell(3).value = 'Diperiksa Oleh,';
        titleSignRow.getCell(4).value = 'Mengetahui,';
        titleSignRow.getCell(5).value = 'Disetujui Oleh,';

        [2, 3, 4, 5].forEach(col => {
            titleSignRow.getCell(col).alignment = { horizontal: 'center' };
            titleSignRow.getCell(col).font = { bold: true };
        });

        currentRow += 3;

        const spaceSignRow = worksheet.getRow(currentRow++);
        spaceSignRow.getCell(2).value = '( ...................................... )';
        spaceSignRow.getCell(3).value = '( ...................................... )';
        spaceSignRow.getCell(4).value = '( ...................................... )';
        spaceSignRow.getCell(5).value = '( ...................................... )';

        [2, 3, 4, 5].forEach(col => {
            spaceSignRow.getCell(col).alignment = { horizontal: 'center' };
            spaceSignRow.getCell(col).font = { bold: true };
        });

        const roleSignRow = worksheet.getRow(currentRow++);
        roleSignRow.getCell(2).value = 'KTU / Kerani';
        roleSignRow.getCell(3).value = 'Asisten';
        roleSignRow.getCell(4).value = 'Estate Manager';
        roleSignRow.getCell(5).value = 'Senior Manager';

        [2, 3, 4, 5].forEach(col => {
            roleSignRow.getCell(col).alignment = { horizontal: 'center' };
            roleSignRow.getCell(col).font = { size: 11, bold: true };
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return buffer as any as Buffer;
    }
}
