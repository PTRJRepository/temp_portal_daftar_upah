import ExcelJS from 'exceljs';
import { MonthlyTaxRow, DecemberTaxRow } from './taxReportService';
import { CARUMAN_RATES } from './carumanDefinitions';
import { sumOtherIncomeByCanonicalType } from '../utils/otherIncomeCanonical';

// Helper: convert column index (1-based) to Excel letter(s)
function colLetter(n: number): string {
    let letter = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        n = Math.floor((n - 1) / 26);
    }
    return letter;
}

function firstNonZeroNumber(...values: unknown[]): number {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric !== 0) return numeric;
    }
    return 0;
}

function firstFiniteNumberValue(...values: unknown[]): number {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return 0;
}

function resolvePotonganAlpa(emp: any, fallbackDiff: number): number {
    const explicitPotonganAlpa = firstFiniteNumberValue(emp?.pot_alpa_cth, emp?.pot_alpa);
    if (explicitPotonganAlpa !== 0) {
        return explicitPotonganAlpa > 0 ? -explicitPotonganAlpa : explicitPotonganAlpa;
    }
    return Math.min(0, fallbackDiff);
}

function resolveLebihHk(emp: any, fallbackDiff: number): number {
    const explicitLebihHk = firstFiniteNumberValue(emp?.lebih_hk, emp?.lebih_hk_cth, emp?.koreksi_hk_lebih, emp?.koreksi_hk_plus);
    if (explicitLebihHk !== 0) return Math.max(0, explicitLebihHk);

    const explicitKoreksiHk = firstFiniteNumberValue(emp?.koreksi_hk);
    const koreksiHk = explicitKoreksiHk !== 0 ? explicitKoreksiHk : fallbackDiff;
    return Math.max(0, koreksiHk);
}

function resolveTaxOtherIncomeAmounts(emp: any): { thr: number; bonus: number; kontan: number } {
    const thrFromItems = sumOtherIncomeByCanonicalType(emp?.other_incomes, 'THR');
    const bonusFromItems = sumOtherIncomeByCanonicalType(emp?.other_incomes, 'BONUS');
    const kontanFromItems = sumOtherIncomeByCanonicalType(emp?.other_incomes, 'KONTAN');
    const bonusDirect = firstNonZeroNumber(emp?.pendapatan_bonus, emp?.taxable_pendapatan_bonus, emp?.bonus, emp?.bonus_amount);
    const exgratiaSeparate = Number(emp?.pendapatan_exgratia || emp?.taxable_pendapatan_exgratia || 0) || 0;
    const exgratiaAlias = bonusDirect === 0 ? (Number(emp?.exgratia_amount || 0) || 0) : 0;

    return {
        thr: firstNonZeroNumber(emp?.pendapatan_thr, emp?.taxable_pendapatan_thr, emp?.thr_amount, emp?.THR, emp?.thr, emp?.THR_AMOUNT, thrFromItems),
        bonus: firstNonZeroNumber(bonusDirect + exgratiaSeparate + exgratiaAlias, bonusFromItems),
        kontan: firstNonZeroNumber(emp?.pendapatan_kontan, emp?.taxable_pendapatan_kontan, emp?.kontanan_amount, emp?.KONTANAN, emp?.KONTAN, kontanFromItems)
    };
}

/**
 * Service to generate an Excel file containing detailed PPH21 Tax Calculations
 * with native Excel formulas embedded.
 * Premi columns are DYNAMIC – one column per identified premi type.
 *
 * Includes:
 * - Sheet 1: Monthly PPH21 Calculation
 * - Sheet 2: Premi Breakdown (daftar lengkap premi yang diperhitungkan)
 */
export const generateMonthlyTaxExcel = async (
    data: { employees: MonthlyTaxRow[], period: { month: number; year: number; }, total_pph21: number; },
    year: number,
    month: number,
    division: string,
    gang: string,
    premiKeys?: string[],
    labels?: { divisionLabel?: string; gangLabel?: string }
): Promise<Buffer> => {
    console.log(`[generateMonthlyTaxExcel] START - employees=${data?.employees?.length}, year=${year}, month=${month}, division=${division}, gang=${gang}`);
    console.log(`[generateMonthlyTaxExcel] First emp keys: ${data?.employees?.[0] ? Object.keys(data.employees[0]).join(', ') : 'NONE'}`);
    console.log(`[generateMonthlyTaxExcel] premiKeys parameter: ${premiKeys ? premiKeys.join(', ') : 'NOT PROVIDED'}`);

    // --- Discover dynamic premi keys ---
    const discoveredPremiKeys = new Set<string>();
    let empWithPremiDetail = 0;
    let empWithPremiDetailEmpty = 0;
    for (const emp of data.employees) {
        if (emp.premi_detail) {
            empWithPremiDetail++;
            if (Object.keys(emp.premi_detail).length > 0) {
                for (const k of Object.keys(emp.premi_detail)) {
                    discoveredPremiKeys.add(k);
                }
            } else {
                empWithPremiDetailEmpty++;
            }
        }
    }
    console.log(`[generateMonthlyTaxExcel] Discovery: ${empWithPremiDetail} employees have premi_detail, ${empWithPremiDetailEmpty} have empty premi_detail`);
    console.log(`[generateMonthlyTaxExcel] Discovered premi keys: ${Array.from(discoveredPremiKeys).join(', ')}`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PT. Rebinmas Jaya - Auto Report System';
    workbook.created = new Date();

    // Create worksheets in the desired order (Sheet 1: Format Standar Pajak)
    const stdSheetName = 'Format Standar Pajak';
    const stdSheet = workbook.addWorksheet(stdSheetName);

    const sheetName = `PPH21 - ${division} - ${gang || 'ALL'} - ${month}_${year}`;
    const sheet = workbook.addWorksheet(sheetName.substring(0, 31));

    const summarySheetName = 'Rincian Premi';
    const summarySheet = workbook.addWorksheet(summarySheetName);

    // Sort: BRONDOL first, then alphabetical (no LAINNYA catch-all — every premi has its own column)
    // [FIX] Always include BRONDOL if it exists in discoveredPremiKeys, even if premiKeys is provided
    // This is because BRONDOL comes from a separate field (premi_brondol) not in dynamic_premi_headers
    let allPremiKeys: string[];
    if (premiKeys && premiKeys.length > 0) {
        // Start with frontend-provided keys
        allPremiKeys = [...premiKeys];
        // Always add BRONDOL if it exists in discoveredPremiKeys but not in provided keys
        if (discoveredPremiKeys.has('BRONDOL') && !allPremiKeys.includes('BRONDOL')) {
            allPremiKeys.unshift('BRONDOL'); // Add at beginning
        }
        // Sort with BRONDOL first
        allPremiKeys.sort((a, b) => {
            if (a === 'BRONDOL') return -1;
            if (b === 'BRONDOL') return 1;
            return a.localeCompare(b);
        });
    } else {
        allPremiKeys = Array.from(discoveredPremiKeys).sort((a, b) => {
            if (a === 'BRONDOL') return -1;
            if (b === 'BRONDOL') return 1;
            return a.localeCompare(b);
        });
    }

    // If no premi data found, use a minimal default
    if (allPremiKeys.length === 0) allPremiKeys.push('BRONDOL');

    // Calculate premi totals for summary sheet
    const premiSummary: Record<string, { jumlah: number; karyawan: number; total: number }> = {};
    for (const key of allPremiKeys) {
        premiSummary[key] = { jumlah: 0, karyawan: 0, total: 0 };
    }
    for (const emp of data.employees) {
        if (emp.premi_detail) {
            for (const [key, value] of Object.entries(emp.premi_detail)) {
                if (premiSummary[key]) {
                    premiSummary[key].jumlah += (value || 0);
                    premiSummary[key].karyawan += (value || 0) > 0 ? 1 : 0;
                    premiSummary[key].total += 1; // count all employees
                }
            }
        }
    }

    // Helper for styling headers
    const applyHeaderStyle = (cell: ExcelJS.Cell, bgColor: string = '1E3A8A', color: string = 'FFFFFF') => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.font = { color: { argb: color }, bold: true, size: 10, name: 'Arial' };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' },
            bottom: { style: 'thin' }, right: { style: 'thin' }
        };
    };

    // ─────────────────────────────────────────────────────────
    // Column layout (dynamic based on premi count)
    // ─────────────────────────────────────────────────────────
    // Fixed columns:
    //  1: NO, 2: ID KARYAWAN, 3: NAMA, 4: NAMA ORANG TUA, 5: NIK, 6: L/P, 7: STAT, 8: GANG, 9: KAT TER     → IDENTITAS
    //  10: HK, 11: UPAH DASAR, 12: GAJI STANDAR, 13: GP IDEAL, 14: GP AKTUAL, 15: KOREKSI → STRUKTUR UPAH
    //  16: BERAS, 17: JABATAN, 18: SERVICE TIME ALLOW (Lembur)  → TUNJANGAN
    // Dynamic premi cols (19 .. 18+N) → URAIAN PREMI
    //  18+N+1: TOTAL PREMI
    // Fixed after premi:
    //  POT KOREKSI, THR, BONUS, KONTANAN, BPJS KES 4%, ASTEK 0.84%, UPAH KOTOR, PENGHASILAN BRUTO, TARIF TER, PPH21

    const COL_NO = 1;
    const COL_EMP_CODE = 2;
    const COL_NAMA = 3;
    const COL_PARENT_NAME = 4;
    const COL_NIK = 5;
    const COL_ALAMAT = 6;
    const COL_GENDER = 7;
    const COL_STAT = 8;
    const COL_GANG = 9;
    const COL_KAT = 10;
    const COL_HK = 11;
    const COL_UPAH_DASAR = 12;
    const COL_GAJI_STANDAR = 13;
    const COL_GP_IDEAL = 14;
    const COL_GP_AKTUAL = 15;
    const COL_KOREKSI = 16;
    const COL_POT_ALPA = 17; // Potongan Alpa (between KOREKSI and TUNJANGAN)
    const COL_LEBIH_HK = 18; // Positive HK correction, displayed as income
    const COL_BERAS = 19;
    const COL_JABATAN = 20;
    const COL_MASA_KERJA = 21;
    const COL_SERVICE_TIME = 22; // Service Time Allow = Lembur value

    // Dynamic premi columns
    const COL_PREMI_START = COL_SERVICE_TIME + 1;
    const COL_PREMI_END = COL_PREMI_START + allPremiKeys.length - 1;  // inclusive
    const COL_TOTAL_PREMI = COL_PREMI_END + 1;

    // Fixed after premi (THR and Bonus/Exgratia shown for reference)
    const COL_POT_KOREKSI = COL_TOTAL_PREMI + 1;
    const COL_THR = COL_POT_KOREKSI + 1;
    const COL_BONUS = COL_THR + 1;
    const COL_KONTAN = COL_BONUS + 1;
    const COL_BPJS_KES = COL_KONTAN + 1;
    const COL_ASTEK = COL_BPJS_KES + 1;
    const COL_UPAH_KOTOR = COL_ASTEK + 1;
    const COL_BRUTO = COL_UPAH_KOTOR + 1;
    const COL_TARIF_TER = COL_BRUTO + 1;
    const COL_PPH21 = COL_TARIF_TER + 1;
    const TOTAL_COLS = COL_PPH21;

    // Helper for column letter
    const L = colLetter;

    // Define column widths
    const colWidths: number[] = [];
    for (let i = 1; i <= TOTAL_COLS; i++) {
        if (i <= 10) colWidths.push(i === 2 ? 15 : i === 3 ? 25 : i === 4 ? 20 : i === 6 ? 30 : i <= 10 ? 8 : 5);
        else if (i <= 16) colWidths.push(15);
        else if (i === COL_POT_ALPA) colWidths.push(13); // pot_alpa column
        else if (i === COL_LEBIH_HK) colWidths.push(13); // lebih_hk column
        else if (i <= COL_SERVICE_TIME) colWidths.push(12);
        else if (i < COL_TOTAL_PREMI) colWidths.push(13); // premi columns
        else if (i === COL_TOTAL_PREMI) colWidths.push(15);
        else if (i <= COL_KONTAN) colWidths.push(15);
        else if (i <= COL_ASTEK) colWidths.push(15);
        else colWidths.push(18);
    }
    sheet.columns = colWidths.map((w, i) => ({ key: `col${i + 1}`, width: w }));

    // ─────────────────────────────────────────────────────────
    // ROW 1: Title
    // ─────────────────────────────────────────────────────────
    sheet.mergeCells(`A1:${L(TOTAL_COLS)}1`);
    const titleCell = sheet.getCell('A1');
    const divisionTitle = labels?.divisionLabel || division;
    const gangTitle = labels?.gangLabel || gang || 'ALL';
    titleCell.value = `DAFTAR RINCIAN KALKULASI PPH21 - DIVISI: ${divisionTitle} | GANG: ${gangTitle} | PERIODE: ${month}/${year}`;
    titleCell.font = { size: 14, bold: true, name: 'Arial' };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // ─────────────────────────────────────────────────────────
    // ROW 2: TaskCode (AccCode)
    // ─────────────────────────────────────────────────────────
    const mainMetaRef = data.employees[0]?.component_metadata || {};

    // Define subHeaders first so we can use them for Row 2 and Row 5
    const subHeaders: { col: number; label: string; bg: string; fg: string; meta_key?: string }[] = [
        { col: COL_NO, label: 'NO', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_EMP_CODE, label: 'ID KARYAWAN', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_NAMA, label: 'NAMA', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_PARENT_NAME, label: 'NAMA ORANG TUA', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_NIK, label: 'NIK', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_ALAMAT, label: 'ALAMAT', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_GENDER, label: 'L/P', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_STAT, label: 'STAT', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_GANG, label: 'GANG', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_KAT, label: 'KAT TER', bg: '1E3A8A', fg: 'FFFFFF' },
        { col: COL_HK, label: 'HK', bg: 'F1F5F9', fg: '0F172A' },
        { col: COL_UPAH_DASAR, label: 'UPAH DASAR', bg: 'F1F5F9', fg: '0F172A' },
        { col: COL_GAJI_STANDAR, label: 'GAJI STANDAR\n(×Hari Bln)', bg: 'F1F5F9', fg: '0F172A' },
        { col: COL_GP_IDEAL, label: 'GP IDEAL\n(×HK)', bg: 'F1F5F9', fg: '0F172A' },
        { col: COL_GP_AKTUAL, label: 'GP AKTUAL', bg: 'F1F5F9', fg: '0F172A', meta_key: 'gaji_pokok' },
        { col: COL_KOREKSI, label: 'KOREKSI\n(Aktual-Ideal)', bg: 'F1F5F9', fg: '0F172A' },
        { col: COL_POT_ALPA, label: 'POT. ALPA (-)', bg: 'F1F5F9', fg: '0F172A' },
        { col: COL_LEBIH_HK, label: 'LEBIH HK (+)', bg: 'F1F5F9', fg: '0F172A' },
        { col: COL_BERAS, label: 'BERAS', bg: 'E2E8F0', fg: '0F172A', meta_key: 'tunjangan_beras' },
        { col: COL_JABATAN, label: 'JABATAN', bg: 'E2E8F0', fg: '0F172A', meta_key: 'tunjangan_jabatan' },
        { col: COL_MASA_KERJA, label: 'MASA KERJA', bg: 'E2E8F0', fg: '0F172A', meta_key: 'masa_kerja' },
        { col: COL_SERVICE_TIME, label: 'SERVICE TIME\nALLOW', bg: 'E2E8F0', fg: '0F172A', meta_key: 'tunjangan_lembur' },
    ];

    // Dynamic premi sub-headers
    for (let i = 0; i < allPremiKeys.length; i++) {
        const keyName = allPremiKeys[i];
        // BRONDOL uses its own metadata entry for proper AccCode
        const metaKey = keyName.toUpperCase() === 'BRONDOL' ? 'brondol' : 'premi';
        subHeaders.push({ col: COL_PREMI_START + i, label: keyName, bg: 'CBD5E1', fg: '0F172A', meta_key: metaKey });
    }
    subHeaders.push({ col: COL_TOTAL_PREMI, label: 'TOTAL PREMI\n(SUM Premi)', bg: 'CBD5E1', fg: '0F172A' });
    subHeaders.push({ col: COL_POT_KOREKSI, label: 'POT KOREKSI (-)', bg: 'FCA5A5', fg: '0F172A' });
    subHeaders.push({ col: COL_THR, label: 'THR', bg: 'FEF3C7', fg: '0F172A', meta_key: 'thr' });
    subHeaders.push({ col: COL_BONUS, label: 'BONUS', bg: 'FEF3C7', fg: '0F172A', meta_key: 'bonus' });
    subHeaders.push({ col: COL_KONTAN, label: 'KONTANAN', bg: 'FEF3C7', fg: '0F172A' });
    subHeaders.push({ col: COL_BPJS_KES, label: `BPJS KES\n${(CARUMAN_RATES.BPJS_KES_MAJIKAN * 100).toFixed(0)}%\n(×GPStandar+MK)`, bg: 'F1F5F9', fg: '0F172A', meta_key: 'bpjs_kes_majikan' });
    subHeaders.push({ col: COL_ASTEK, label: `ASTEK\n${(CARUMAN_RATES.ASTEK_MAJIKAN_JKK_JKM * 100).toFixed(2)}%\n(×GPStandar+MK)`, bg: 'F1F5F9', fg: '0F172A', meta_key: 'astek_jht_majikan' });
    subHeaders.push({ col: COL_UPAH_KOTOR, label: 'UPAH KOTOR\n(GP_Aktual+Tunj+Premi)', bg: '0F172A', fg: 'FFFFFF' });
    subHeaders.push({ col: COL_BRUTO, label: 'PENGHASILAN\nBRUTO', bg: '0F172A', fg: 'FFFFFF' });
    subHeaders.push({ col: COL_TARIF_TER, label: 'TARIF TER (%)', bg: '0F172A', fg: 'FFFFFF' });
    subHeaders.push({ col: COL_PPH21, label: 'PPH21\n(ROUND Bruto×Tarif)', bg: '0F172A', fg: 'FFFFFF', meta_key: 'pph21' });

    // ROW 2: TaskCode (AccCode - task codes like AL0013, GA9128)
    console.log(`[generateMonthlyTaxExcel] DEBUG: data.employees[0] component_metadata type: ${typeof data.employees[0]?.component_metadata}, value: ${JSON.stringify(data.employees[0]?.component_metadata)}`);
    console.log(`[generateMonthlyTaxExcel] mainMetaRef keys: ${Object.keys(mainMetaRef).join(', ')}`);
    console.log(`[generateMonthlyTaxExcel] First employee has component_metadata: ${!!data.employees[0]?.component_metadata}`);
    if (data.employees[0]?.component_metadata) {
        console.log(`[generateMonthlyTaxExcel] component_metadata entries:`, JSON.stringify(data.employees[0].component_metadata));
    }
    const mainTaskRow = sheet.getRow(2);
    mainTaskRow.height = 20;
    subHeaders.forEach(({ col, meta_key }) => {
        const cell = mainTaskRow.getCell(col);
        if (meta_key && mainMetaRef[meta_key]) {
            cell.value = mainMetaRef[meta_key].task_code;
        }
        applyHeaderStyle(cell, 'F8FAFC', '64748B');
        cell.font = { size: 8, italic: true, name: 'Arial', color: { argb: '64748B' } };
    });

    // ─────────────────────────────────────────────────────────
    // ROW 3: GL Accounts (AccCode - DR:XXX CR:XXX - NEW!)
    // ─────────────────────────────────────────────────────────
    const glAccRow = sheet.getRow(3);
    glAccRow.height = 20;
    let glAccCount = 0;
    subHeaders.forEach(({ col, meta_key }) => {
        const cell = glAccRow.getCell(col);
        if (meta_key && mainMetaRef[meta_key]) {
            cell.value = `DR:${mainMetaRef[meta_key].dr_acct} CR:${mainMetaRef[meta_key].cr_acct}`;
            glAccCount++;
        }
        applyHeaderStyle(cell, 'F8FAFC', '64748B');
        cell.font = { size: 7, italic: true, name: 'Arial', color: { argb: '64748B' } };
    });
    console.log(`[generateMonthlyTaxExcel] GL Accounts row: wrote ${glAccCount} cells with DR/CR values`);

    // ─────────────────────────────────────────────────────────
    // ROW 4: Group headers
    // ─────────────────────────────────────────────────────────
    const premiEndLetter = L(COL_PREMI_END);
    const premiStartLetter = L(COL_PREMI_START);
    const totalPremiLetter = L(COL_TOTAL_PREMI);

    // IDENTITAS
    sheet.mergeCells(`A4:${L(COL_KAT)}4`);
    sheet.getCell('A4').value = 'IDENTITAS';
    applyHeaderStyle(sheet.getCell('A4'), '1E3A8A', 'FFFFFF');

    // STRUKTUR UPAH
    sheet.mergeCells(`${L(COL_HK)}4:${L(COL_LEBIH_HK)}4`);
    sheet.getCell(`${L(COL_HK)}4`).value = 'STRUKTUR UPAH';
    applyHeaderStyle(sheet.getCell(`${L(COL_HK)}4`), 'F1F5F9', '0F172A');

    // TUNJANGAN
    sheet.mergeCells(`${L(COL_BERAS)}4:${L(COL_SERVICE_TIME)}4`);
    sheet.getCell(`${L(COL_BERAS)}4`).value = 'TUNJANGAN';
    applyHeaderStyle(sheet.getCell(`${L(COL_BERAS)}4`), 'E2E8F0', '0F172A');

    // URAIAN PREMI (spans all premi cols + total premi)
    const premiGroupEnd = L(COL_TOTAL_PREMI);
    if (COL_PREMI_START === COL_TOTAL_PREMI) {
        // only one column: no merge needed
        sheet.getCell(`${premiStartLetter}4`).value = 'Uraian Premi';
        applyHeaderStyle(sheet.getCell(`${premiStartLetter}4`), 'CBD5E1', '0F172A');
    } else {
        sheet.mergeCells(`${premiStartLetter}4:${premiGroupEnd}4`);
        sheet.getCell(`${premiStartLetter}4`).value = 'Uraian Premi';
        applyHeaderStyle(sheet.getCell(`${premiStartLetter}4`), 'CBD5E1', '0F172A');
    }

    // POTONGAN (single cell)
    sheet.getCell(`${L(COL_POT_KOREKSI)}4`).value = 'POTONGAN';
    applyHeaderStyle(sheet.getCell(`${L(COL_POT_KOREKSI)}4`), 'FCA5A5', '0F172A');

    // PENDAPATAN LAINNYA (THR, Bonus, Kontanan)
    if (COL_THR !== COL_KONTAN) {
        sheet.mergeCells(`${L(COL_THR)}4:${L(COL_KONTAN)}4`);
    }
    sheet.getCell(`${L(COL_THR)}4`).value = 'PENDAPATAN\nLAINNYA';
    applyHeaderStyle(sheet.getCell(`${L(COL_THR)}4`), 'FEF3C7', '0F172A');

    // JAMINAN MAJIKAN
    sheet.mergeCells(`${L(COL_BPJS_KES)}4:${L(COL_ASTEK)}4`);
    sheet.getCell(`${L(COL_BPJS_KES)}4`).value = 'JAMINAN MAJIKAN';
    applyHeaderStyle(sheet.getCell(`${L(COL_BPJS_KES)}4`), 'F1F5F9', '0F172A');

    // KALKULASI PPH21
    sheet.mergeCells(`${L(COL_UPAH_KOTOR)}4:${L(COL_PPH21)}4`);
    sheet.getCell(`${L(COL_UPAH_KOTOR)}4`).value = 'KALKULASI PPH21';
    applyHeaderStyle(sheet.getCell(`${L(COL_UPAH_KOTOR)}4`), '1E293B', 'FFFFFF');

    // ─────────────────────────────────────────────────────────
    // ROW 5: Sub-headers (column labels)
    // ─────────────────────────────────────────────────────────
    subHeaders.forEach(({ col, label, bg, fg }) => {
        const cell = sheet.getCell(5, col);
        cell.value = label;
        applyHeaderStyle(cell, bg, fg);
    });
    sheet.getRow(5).height = 45;

    // ─────────────────────────────────────────────────────────
    // Data rows (row 6 onwards)
    // ─────────────────────────────────────────────────────────
    const numFormat = '#.##0';
    const DATA_START = 6;
    let currentRowIndex = DATA_START;
    let rowsAdded = 0;

    console.log(`[generateMonthlyTaxExcel MAIN] About to loop through ${data.employees.length} employees`);

    data.employees.forEach((emp, idx) => {
        const row = sheet.getRow(currentRowIndex);
        const r = currentRowIndex;

        // Log first 3 employees being processed
        if (idx < 3) {
            console.log(`[generateMonthlyTaxExcel MAIN] Processing employee ${idx + 1}:`, {
                emp_code: emp.emp_code,
                nama: emp.emp_name || emp.nama,
                emp_name: emp.emp_name,
                no: emp.no,
                hk: emp.hk,
                status_ptkp: emp.status_ptkp
            });
        }

        // Identity
        const rawNameMain = emp.emp_name || '';
        const nameMatchMain = rawNameMain.match(/\(([^)]+)\)/);
        const parentNameMain = nameMatchMain ? nameMatchMain[1].trim() : (emp.parent_name || '');
        const cleanNameMain = rawNameMain.replace(/\s*\([^)]*\)\s*/g, '').trim();

        row.getCell(COL_NO).value = emp.no || (currentRowIndex - DATA_START + 1);
        row.getCell(COL_EMP_CODE).value = emp.emp_code || '';
        row.getCell(COL_NAMA).value = cleanNameMain;
        row.getCell(COL_PARENT_NAME).value = parentNameMain;
        row.getCell(COL_NIK).value = emp.new_nik || emp.nik || '';
        // [ROBUST] Support multiple field names for address from DOM vs Tax Report
        row.getCell(COL_ALAMAT).value = emp.alamat || emp.res_address || emp.ResAddress || emp.ALAMAT || emp.address || '';
        row.getCell(COL_GENDER).value = emp.gender;
        row.getCell(COL_STAT).value = emp.status_ptkp;
        row.getCell(COL_GANG).value = emp.gang_code;
        row.getCell(COL_KAT).value = emp.kategori_ter;

        // Struktur Upah
        row.getCell(COL_HK).value = emp.hk || 0;
        row.getCell(COL_UPAH_DASAR).value = emp.upah_dasar || 0;

        // Gaji Standar = Upah Dasar × 30
        const lUD = L(COL_UPAH_DASAR);
        const lHK = L(COL_HK);
        const lGS = L(COL_GAJI_STANDAR);
        const lGI = L(COL_GP_IDEAL);
        const lGA = L(COL_GP_AKTUAL);
        const lKor = L(COL_KOREKSI);
        const lBeras = L(COL_BERAS);
        const lJab = L(COL_JABATAN);
        const lST = L(COL_SERVICE_TIME);
        const lTotalPremi = L(COL_TOTAL_PREMI);
        const lPremiStart = L(COL_PREMI_START);
        const lPremiEnd = L(COL_PREMI_END);
        const lPotKor = L(COL_POT_KOREKSI);
        const lTHR = L(COL_THR);
        const lBpjs = L(COL_BPJS_KES);
        const lAstek = L(COL_ASTEK);
        const lUK = L(COL_UPAH_KOTOR);
        const lBruto = L(COL_BRUTO);
        const lTarif = L(COL_TARIF_TER);
        const lPph = L(COL_PPH21);

        const daysInMonthMain = new Date(typeof year === 'string' ? parseInt(year, 10) : year, typeof month === 'string' ? parseInt(month, 10) : month, 0).getDate();
        row.getCell(COL_GAJI_STANDAR).value = (emp.upah_dasar || 0) * daysInMonthMain;
        row.getCell(COL_GP_IDEAL).value = emp.gaji_pokok_ideal || 0;
        row.getCell(COL_GP_AKTUAL).value = emp.gaji_pokok_aktual || 0;
        row.getCell(COL_KOREKSI).value = emp.koreksi_hk || 0;

        // Potongan Alpa (from gaji difference: GP_IDEAL - GP_AKTUAL when negative)
        const hkDiffMainFromFields = (Number(emp.gaji_pokok_aktual) || 0) - (Number(emp.gaji_pokok_ideal) || 0);
        const explicitKoreksiHkMain = firstFiniteNumberValue(emp.koreksi_hk);
        const hkDiffMain = explicitKoreksiHkMain !== 0 ? explicitKoreksiHkMain : hkDiffMainFromFields;
        const potAlpa = resolvePotonganAlpa(emp, hkDiffMain);
        const lebihHk = resolveLebihHk(emp, hkDiffMain);
        row.getCell(COL_POT_ALPA).value = potAlpa;
        row.getCell(COL_LEBIH_HK).value = lebihHk;

        // Tunjangan — Service Time Allow = Lembur
        // [ROBUST] Handle multiple field names (Daftar Upah vs Tax Report mapped names)
        row.getCell(COL_BERAS).value = emp.tunjangan_beras ?? emp.beras_jumlah ?? 0;
        row.getCell(COL_JABATAN).value = emp.tunjangan_jabatan ?? emp.jabatan_jumlah ?? 0;
        row.getCell(COL_MASA_KERJA).value = emp.tunjangan_masa_kerja ?? emp.masa_kerja_jumlah ?? 0;
        row.getCell(COL_SERVICE_TIME).value = emp.tunjangan_lembur ?? emp.lembur_jumlah ?? 0; // Lembur → Service Time Allow

        // Dynamic Premi columns
        // [DOM DATA] Read from premi_detail (from backend API) or top-level DOM properties
        for (let i = 0; i < allPremiKeys.length; i++) {
            const colIdx = COL_PREMI_START + i;
            const keyName = allPremiKeys[i];
            const normalizedKey = keyName.toUpperCase().replace(/ /g, '_');
            const lowerKey = normalizedKey.toLowerCase();
            const strippedKey = lowerKey.replace(/^premi_/, ''); // e.g. "pruning"

            let val = 0;
            if (emp.premi_detail && emp.premi_detail[keyName] !== undefined) {
                val = emp.premi_detail[keyName];
            } else if (emp.premi_detail && emp.premi_detail[normalizedKey] !== undefined) {
                val = emp.premi_detail[normalizedKey];
            } else if (emp.premi && emp.premi[keyName] !== undefined) {
                val = emp.premi[keyName];
            } else if (emp.premi && emp.premi[normalizedKey] !== undefined) {
                val = emp.premi[normalizedKey];
            } else if (emp.premi && emp.premi[lowerKey] !== undefined) {
                val = emp.premi[lowerKey];
            } else if (emp[keyName] !== undefined) {
                val = emp[keyName];
            } else if (emp[normalizedKey] !== undefined) {
                val = emp[normalizedKey];
            } else if (emp[lowerKey] !== undefined) { // DOM properties hit: emp.premi_pruning
                val = emp[lowerKey];
            } else if (emp[`premi_${strippedKey}`] !== undefined) {
                val = emp[`premi_${strippedKey}`];
            } else if (emp[strippedKey] !== undefined) {
                val = emp[strippedKey];
            } else if (strippedKey === 'brondol' && (emp.premi_brondol || emp.premi_brondol_total)) {
                val = emp.premi_brondol || emp.premi_brondol_total || 0;
            }

            row.getCell(colIdx).value = val || 0;
        }

        // Total Premi = exact numeric value from UI/DB
        row.getCell(COL_TOTAL_PREMI).value = emp.total_premi || 0;

        // Debug first employee premi
        if ((emp.no || 1) === 1) {
            console.log(`[generateMonthlyTaxExcel MAIN SHEET] First employee premi:`, {
                emp_name: emp.emp_name,
                premi_detail_keys: emp.premi_detail ? Object.keys(emp.premi_detail) : [],
                premi_detail: emp.premi_detail,
                total_premi: emp.total_premi,
                allPremiKeys: allPremiKeys.slice(0, 10)
            });
        }

        // Potongan Koreksi (displayed as negative — it's a deduction)
        // Signed deduction invariant: write koreksi as -ABS(amount). Formulas must ADD
        // this cell, never subtract it, to avoid invalid -(-200) sign flips.
        row.getCell(COL_POT_KOREKSI).value = -Math.abs(Number(emp.pot_koreksi || 0));



        // Pendapatan Lainnya (THR, Bonus, Kontanan)
        // [DOM DATA] Use values directly from DOM - these are what the user sees in UI
        const otherIncomeAmounts = resolveTaxOtherIncomeAmounts(emp);
        const thrVal = otherIncomeAmounts.thr;
        const bonusVal = otherIncomeAmounts.bonus;
        const kontanVal = otherIncomeAmounts.kontan;
        row.getCell(COL_THR).value = thrVal;
        row.getCell(COL_BONUS).value = bonusVal;
        row.getCell(COL_KONTAN).value = kontanVal;

        // Debug first employee
        if ((emp.no || 1) === 1) {
            console.log(`[generateMonthlyTaxExcel MAIN SHEET] First employee THR/bonus:`, {
                emp_name: emp.emp_name,
                thr_amount: emp.thr_amount,
                THR: emp.THR,
                finalThr: thrVal,
                exgratia_amount: emp.exgratia_amount,
                kontanan_amount: emp.kontanan_amount,
                KONTANAN: emp.KONTANAN,
                bonus: emp.bonus,
                finalBonus: bonusVal,
                finalKontan: kontanVal
            });
        }

        // Jaminan Majikan (based on Gaji Standar + Masa Kerja)
        // Masa Kerja column was removed from display, so use hardcoded values
        row.getCell(COL_BPJS_KES).value = emp.bpjs_kes_majikan || 0;
        row.getCell(COL_ASTEK).value = emp.astek_jht_majikan || 0;

        // UPAH KOTOR = exact numeric value from UI/DB
        // Formulas cause inconsistencies when user opens Excel if backend uses custom capping/rules
        row.getCell(COL_UPAH_KOTOR).value = emp.upah_kotor || 0;

        // PENGHASILAN BRUTO — use DIRECT value from UI Daftar Upah (not reconstructed via formula)
        // [FIX] Formula reconstruction produced different totals than the UI.
        // The UI value (penghasilan_bruto) is the single source of truth.
        row.getCell(COL_BRUTO).value = emp.penghasilan_bruto || 0;

        // TER Rate (percentage format)
        row.getCell(COL_TARIF_TER).value = (emp.tarif_pajak_ter || 0) / 100;
        row.getCell(COL_TARIF_TER).numFmt = '0.00%';

        // PPH21 — As requested, use pph21_ter (the calculated PPh21 TER amount)
        // Fallbacks provided for actual deductions
        row.getCell(COL_PPH21).value = emp.pph21_ter ?? emp.potongan_pph21 ?? emp.pot_pph21 ?? 0;

        // Apply number formats
        for (let c = COL_HK; c <= TOTAL_COLS; c++) {
            if (c !== COL_TARIF_TER) row.getCell(c).numFmt = numFormat;
        }
        // Text columns
        [COL_GENDER, COL_STAT, COL_GANG, COL_KAT].forEach(c => {
            row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
        });

        // Borders
        for (let c = 1; c <= TOTAL_COLS; c++) {
            row.getCell(c).border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' }, right: { style: 'thin' }
            };
        }

        currentRowIndex++;
    });

    console.log(`[generateMonthlyTaxExcel MAIN] Loop complete. Processed ${data.employees.length} employees, last row index: ${currentRowIndex - 1}`);

    // ─────────────────────────────────────────────────────────
    // Footer: Grand Total row
    // ─────────────────────────────────────────────────────────
    const footerRow = sheet.getRow(currentRowIndex);
    sheet.mergeCells(`A${currentRowIndex}:${L(COL_KAT)}${currentRowIndex}`);
    footerRow.getCell(1).value = 'GRAND TOTAL';
    footerRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    footerRow.getCell(1).font = { bold: true };

    const numericCols = [
        COL_HK, COL_UPAH_DASAR, COL_GAJI_STANDAR, COL_GP_IDEAL, COL_GP_AKTUAL, COL_KOREKSI,
        COL_POT_ALPA, COL_LEBIH_HK,
        COL_BERAS, COL_JABATAN, COL_MASA_KERJA, COL_SERVICE_TIME,
        ...Array.from({ length: allPremiKeys.length }, (_, i) => COL_PREMI_START + i),
        COL_TOTAL_PREMI, COL_POT_KOREKSI, COL_THR, COL_BONUS, COL_KONTAN,
        COL_BPJS_KES, COL_ASTEK, COL_UPAH_KOTOR, COL_BRUTO, COL_PPH21
    ];

    numericCols.forEach(c => {
        const cell = footerRow.getCell(c);
        cell.value = { formula: `SUM(${L(c)}${DATA_START}:${L(c)}${currentRowIndex - 1})` };
        cell.numFmt = numFormat;
        cell.font = { bold: true };
    });

    for (let c = 1; c <= TOTAL_COLS; c++) {
        footerRow.getCell(c).border = {
            top: { style: 'medium' }, left: { style: 'thin' },
            bottom: { style: 'medium' }, right: { style: 'thin' }
        };
        footerRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    }

    currentRowIndex += 3;

    // ─────────────────────────────────────────────────────────
    // Signature block
    // ─────────────────────────────────────────────────────────
    const ttdStartRow = currentRowIndex;
    const ttdEndRow = ttdStartRow + 5;

    const sigCols = [
        { label: 'Dibuat Oleh:', title: 'Admin HR / Payroll', col: L(COL_NAMA) },
        { label: 'Diperiksa Oleh:', title: 'HR Manager', col: L(Math.floor(TOTAL_COLS / 2)) },
        { label: 'Disetujui Oleh:', title: 'General Manager', col: L(COL_UPAH_KOTOR) },
    ];

    sigCols.forEach(({ label, title, col }) => {
        const labelCell = sheet.getCell(`${col}${ttdStartRow}`);
        labelCell.value = label;
        labelCell.font = { bold: true };
        labelCell.alignment = { horizontal: 'center' };

        const nameCell = sheet.getCell(`${col}${ttdEndRow}`);
        nameCell.value = '(_____________________)';
        nameCell.alignment = { horizontal: 'center' };
        nameCell.font = { bold: true };

        const titleCell = sheet.getCell(`${col}${ttdEndRow + 1}`);
        titleCell.value = title;
        titleCell.alignment = { horizontal: 'center' };
    });

    // ─────────────────────────────────────────────────────────
    // SHEET 2: RINCIAN PREMI YANG DIPERHITUNGKAN DALAM PPH21
    // ─────────────────────────────────────────────────────────
    // Sheet variable created upfront

    // Header
    summarySheet.mergeCells('A1:E1');
    const summaryTitleCell = summarySheet.getCell('A1');
    summaryTitleCell.value = `DAFTAR LENGKAP PREMI YANG DIPERHITUNGKAN DALAM PPh21`;
    summaryTitleCell.font = { size: 14, bold: true, name: 'Arial', color: { argb: '1E3A8A' } };
    summaryTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    summarySheet.mergeCells('A2:E2');
    const summaryPeriodCell = summarySheet.getCell('A2');
    summaryPeriodCell.value = `DIVISI: ${division} | GANG: ${gang || 'ALL'} | PERIODE: ${month}/${year}`;
    summaryPeriodCell.font = { size: 11, bold: true, name: 'Arial' };
    summaryPeriodCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // Empty row
    summarySheet.getRow(3).height = 15;

    // Column headers
    const summaryHeaders = [
        { col: 1, label: 'NO', width: 6 },
        { col: 2, label: 'JENIS PREMI', width: 35 },
        { col: 3, label: 'JUMLAH KARYAWAN', width: 18 },
        { col: 4, label: 'TOTAL (Rp)', width: 20 },
        { col: 5, label: 'RATA-RATA/KARYAWAN (Rp)', width: 22 }
    ];

    summarySheet.columns = summaryHeaders.map(h => ({ key: `col${h.col}`, width: h.width }));

    const headerRow = summarySheet.getRow(4);
    summaryHeaders.forEach(h => {
        const cell = headerRow.getCell(h.col);
        cell.value = h.label;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E3A8A' } };
        cell.font = { color: { argb: 'FFFFFF' }, bold: true, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    headerRow.height = 30;

    // Data rows
    let summaryRowIdx = 5;
    let grandTotalPremi = 0;
    const totalEmployees = data.employees.length;

    allPremiKeys.forEach((key, idx) => {
        const row = summarySheet.getRow(summaryRowIdx);
        const summary = premiSummary[key];

        row.getCell(1).value = idx + 1;
        row.getCell(2).value = key;
        row.getCell(3).value = summary.karyawan;
        row.getCell(4).value = summary.jumlah;

        const avg = summary.karyawan > 0 ? summary.jumlah / summary.karyawan : 0;
        row.getCell(5).value = avg;

        // Format numbers
        row.getCell(3).numFmt = '#.##0';
        row.getCell(4).numFmt = '#.##0';
        row.getCell(5).numFmt = '#.##0';

        // Style
        for (let c = 1; c <= 5; c++) {
            const cell = row.getCell(c);
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            cell.alignment = { vertical: 'middle', horizontal: c === 2 ? 'left' : 'right' };
        }

        grandTotalPremi += summary.jumlah;
        summaryRowIdx++;
    });

    // Total row
    const totalRow = summarySheet.getRow(summaryRowIdx);
    totalRow.getCell(1).value = '';
    totalRow.getCell(2).value = 'GRAND TOTAL';
    totalRow.getCell(3).value = totalEmployees;
    totalRow.getCell(4).value = grandTotalPremi;
    totalRow.getCell(5).value = { formula: `D${summaryRowIdx}/C${summaryRowIdx}` };

    for (let c = 1; c <= 5; c++) {
        const cell = totalRow.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D1E7DD' } };
        cell.font = { bold: true, color: { argb: '0F5132' } };
        cell.border = { top: { style: 'medium' }, left: { style: 'thin' }, bottom: { style: 'medium' }, right: { style: 'thin' } };
        cell.alignment = { vertical: 'middle', horizontal: c === 2 ? 'left' : 'right' };
        cell.numFmt = c >= 3 ? '#.##0' : 'General';
    }

    // Add note below table
    summaryRowIdx += 2;
    const noteRow1 = summarySheet.getRow(summaryRowIdx);
    noteRow1.getCell(1).value = 'CATATAN:';
    noteRow1.getCell(1).font = { bold: true };
    summarySheet.mergeCells(`A${summaryRowIdx}:E${summaryRowIdx}`);

    summaryRowIdx++;
    const noteRow2 = summarySheet.getRow(summaryRowIdx);
    noteRow2.getCell(1).value = '1. Premi di atas merupakan premi yang diperhitungkan dalam Penghasilan Bruto untuk perhitungan PPh21.';
    summarySheet.mergeCells(`A${summaryRowIdx}:E${summaryRowIdx}`);

    summaryRowIdx++;
    const noteRow3 = summarySheet.getRow(summaryRowIdx);
    noteRow3.getCell(1).value = '2. JUMLAH KARYAWAN = karyawan yang menerima premi tersebut (nilai > 0).';
    summarySheet.mergeCells(`A${summaryRowIdx}:E${summaryRowIdx}`);

    summaryRowIdx++;
    const noteRow4 = summarySheet.getRow(summaryRowIdx);
    noteRow4.getCell(1).value = '3. TOTAL PREMI dihitung dari semua karyawan (termasuk yang nilainya 0).';
    summarySheet.mergeCells(`A${summaryRowIdx}:E${summaryRowIdx}`);

    // ─────────────────────────────────────────────────────────
    // SHEET 3: FORMAT STANDAR PAJAK (Dynamic Premi + Formula)
    // ─────────────────────────────────────────────────────────
    // Sheet variable created upfront
    stdSheet.pageSetup.orientation = 'landscape';
    stdSheet.pageSetup.paperSize = 9; // A4
    stdSheet.pageSetup.fitToPage = true;
    stdSheet.pageSetup.fitToWidth = 1;
    stdSheet.pageSetup.fitToHeight = 0;
    stdSheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

    // --- Build dynamic column layout ---
    const STD_COL_NO = 1;
    const STD_COL_NAMA = 2;
    const STD_COL_EMP_CODE = 3;
    const STD_COL_NIK = 4;
    const STD_COL_NPWP = 5;
    const STD_COL_ALAMAT = 6;
    const STD_COL_JABATAN = 7;
    const STD_COL_GENDER = 8;
    const STD_COL_PTKP = 9;
    const STD_COL_TER = 10;

    const STD_COL_GAJI_POKOK = 11;
    const STD_COL_POT_ALPA = 12;
    const STD_COL_LEBIH_HK = 13;
    const STD_COL_ASTEK = 14;
    const STD_COL_BPJS_KES = 15;
    const STD_COL_BERAS = 16;
    const STD_COL_JAB = 17;
    const STD_COL_SERVICE_TIME = 18;
    const STD_COL_MK = 19;

    const STD_COL_PREMI_START = STD_COL_MK + 1;
    const STD_COL_PREMI_END = STD_COL_PREMI_START + allPremiKeys.length - 1;

    const STD_COL_POT_KOR = STD_COL_PREMI_END + 1;
    const STD_COL_THR = STD_COL_POT_KOR + 1;
    const STD_COL_BONUS = STD_COL_THR + 1;
    const STD_COL_OTHER_INCOME = STD_COL_BONUS + 1;
    const STD_COL_BRUTO = STD_COL_OTHER_INCOME + 1;
    const STD_COL_TARIF = STD_COL_BRUTO + 1;
    const STD_COL_PPH21 = STD_COL_TARIF + 1;
    const STD_TOTAL_COLS = STD_COL_PPH21;

    // Build headers array
    const stdHeaders: { header: string; width: number; meta_key?: string }[] = [
        { header: 'NO.', width: 5 },
        { header: 'NAMA KARYAWAN', width: 28 },
        { header: 'ID KARYAWAN', width: 15 },
        { header: 'N I K', width: 18 },
        { header: 'N P W P', width: 18 },
        { header: 'A L A M A T', width: 35 },
        { header: 'JABATAN', width: 20 },
        { header: 'L/P', width: 5 },
        { header: 'PTKP', width: 8 },
        { header: 'TER', width: 8 },
        { header: 'Gaji Pokok', width: 15, meta_key: 'gaji_pokok' },
        { header: 'Pot. Alpa (-)', width: 15 },
        { header: 'Lebih HK (+)', width: 15 },
        { header: `Astek Ins\n(${(CARUMAN_RATES.ASTEK_MAJIKAN_JKK_JKM * 100).toFixed(2)}%)`, width: 15, meta_key: 'astek_jht_majikan' },
        { header: `BPJS KES\n(${(CARUMAN_RATES.BPJS_KES_MAJIKAN * 100).toFixed(0)}%)`, width: 15, meta_key: 'bpjs_kes_majikan' },
        { header: 'Rice Allow', width: 15, meta_key: 'tunjangan_beras' },
        { header: 'Structural Allow', width: 15, meta_key: 'tunjangan_jabatan' },
        { header: 'Service Time Allow', width: 15, meta_key: 'tunjangan_lembur' },
        { header: 'Masa Kerja', width: 15, meta_key: 'masa_kerja' },
    ];

    for (const key of allPremiKeys) {
        const metaKey = key.toUpperCase() === 'BRONDOL' ? 'brondol' : 'premi';
        stdHeaders.push({ header: key, width: 15, meta_key: metaKey });
    }

    stdHeaders.push({ header: 'Potongan\nKoreksi (-)', width: 15 });
    stdHeaders.push({ header: 'THR', width: 15, meta_key: 'thr' });
    stdHeaders.push({ header: 'Bonus', width: 15, meta_key: 'bonus' });
    stdHeaders.push({ header: 'Kontanan', width: 15 });
    stdHeaders.push({ header: 'Penghasilan\nBruto', width: 18 });
    stdHeaders.push({ header: 'Tarif\nTER', width: 10 });
    stdHeaders.push({ header: 'PPh 21', width: 15, meta_key: 'pph21' });

    stdSheet.columns = stdHeaders.map((col, idx) => ({ key: `col${idx}`, width: col.width }));

    const sL = colLetter;

    // --- Row 1: Title ---
    stdSheet.mergeCells(`A1:${sL(STD_TOTAL_COLS)}1`);
    const stdTitleCell = stdSheet.getCell('A1');
    stdTitleCell.value = `DAFTAR RINCIAN PPH21 - ${divisionTitle} - ${gangTitle} - PERIODE ${month}/${year}`;
    stdTitleCell.font = { size: 16, bold: true, name: 'Arial', color: { argb: '1E293B' } };
    stdTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    stdSheet.getRow(1).height = 35;

    // --- Header Row 2 (TaskCode) ---
    const taskRow = stdSheet.getRow(2);
    taskRow.height = 20;
    const metaRef = data.employees[0]?.component_metadata || {};
    stdHeaders.forEach((col, idx) => {
        const cell = taskRow.getCell(idx + 1);
        if (col.meta_key && metaRef[col.meta_key]) {
            cell.value = metaRef[col.meta_key].task_code;
        }
        applyHeaderStyle(cell, 'F8FAFC', '64748B');
        cell.font = { size: 8, italic: true, name: 'Arial', color: { argb: '64748B' } };
    });

    // --- Header Row 3 (GL Accounts) ---
    const glRow = stdSheet.getRow(3);
    glRow.height = 20;
    stdHeaders.forEach((col, idx) => {
        const cell = glRow.getCell(idx + 1);
        if (col.meta_key && metaRef[col.meta_key]) {
            cell.value = `DR:${metaRef[col.meta_key].dr_acct} CR:${metaRef[col.meta_key].cr_acct}`;
        }
        applyHeaderStyle(cell, 'F8FAFC', '64748B');
        cell.font = { size: 7, italic: true, name: 'Arial', color: { argb: '64748B' } };
    });

    // --- Header Row 4 (Main Labels) ---
    const stdHeaderRow = stdSheet.getRow(4);
    stdHeaderRow.height = 45;
    stdHeaders.forEach((col, idx) => {
        const cell = stdHeaderRow.getCell(idx + 1);
        cell.value = col.header;
        applyHeaderStyle(cell, '334155', 'FFFFFF'); // Professional Slate color
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    // Letter mappings for formulas
    const sGP = sL(STD_COL_GAJI_POKOK);
    const sAstek = sL(STD_COL_ASTEK);
    const sBpjs = sL(STD_COL_BPJS_KES);
    const sBeras = sL(STD_COL_BERAS);
    const sJab = sL(STD_COL_JAB);
    const sST = sL(STD_COL_SERVICE_TIME);
    const sMK = sL(STD_COL_MK);
    const sPremiStart = sL(STD_COL_PREMI_START);
    const sPremiEnd = sL(STD_COL_PREMI_END);
    const sPotKor = sL(STD_COL_POT_KOR);
    const sTHR = sL(STD_COL_THR);
    const sBruto = sL(STD_COL_BRUTO);
    const sTarif = sL(STD_COL_TARIF);
    const sPph = sL(STD_COL_PPH21);

    let stdRowIdx = 5;
    data.employees.forEach((emp, i) => {
        if (!emp) return; // Skip null entries

        try {
            const row = stdSheet.getRow(stdRowIdx);
            const r = stdRowIdx;

            // [ROBUST] Safe logging for debug - avoid logging the whole object to prevent crashes on circular/massive data
            if (i < 2) {
                const gpIdeal = Number(emp.gaji_pokok_ideal || (Number(emp.upah_dasar) || 0) * new Date(year, month, 0).getDate()) || 0;
                const gpActual = Number(emp.gaji_pokok_dibayarkan || emp.gaji_pokok_aktual || 0) || 0;
                console.log(`[TaxReport Excel DOM] Processing employee ${i + 1}: Name=${(emp.emp_name || '').substring(0, 20)}, Code=${emp.emp_code}, GP_Ideal=${gpIdeal}, GP_Actual=${gpActual}`);
            }

            const daysInMonth = new Date(year, month, 0).getDate();

            const upahDasar = Number(emp.upah_dasar || 0);
            const gajiPokokDibayar = firstFiniteNumberValue(emp.gaji_pokok_dibayarkan, emp.gaji_pokok_aktual, emp.gaji_pokok);
            const explicitPotonganAlpa = firstFiniteNumberValue(emp.pot_alpa_cth, emp.pot_alpa);
            const gajiPokokFallback = upahDasar > 0
                ? upahDasar * daysInMonth
                : explicitPotonganAlpa !== 0
                    ? gajiPokokDibayar - (explicitPotonganAlpa > 0 ? -explicitPotonganAlpa : explicitPotonganAlpa)
                    : gajiPokokDibayar;
            const gajiPokokValue = firstFiniteNumberValue(emp.gaji_pokok_bulanan, emp.gaji_pokok_standar, gajiPokokFallback);
            const explicitKoreksiHkStd = firstFiniteNumberValue(emp.koreksi_hk);
            const hkDiffStd = explicitKoreksiHkStd !== 0 ? explicitKoreksiHkStd : gajiPokokDibayar - gajiPokokValue;
            const potonganAlpa = resolvePotonganAlpa(emp, hkDiffStd);
            const lebihHk = resolveLebihHk(emp, hkDiffStd);

            // Debug first employee
            if (i === 0) {
                console.log(`[generateMonthlyTaxExcel STD SHEET] First employee:`, {
                    emp_name: emp.emp_name || emp.NAMA_KARYAWAN || emp.nama || '',
                    upahDasar,
                    gajiPokokValue,
                    potonganAlpa,
                    lebihHk
                });
            }

            // [REVISED] Clean name for standard sheet
            const rawNameStd = emp.emp_name || emp.NAMA_KARYAWAN || emp.nama || '';
            const cleanNameStd = rawNameStd.replace(/\s*\([^)]*\)\s*/g, '').trim();

            row.getCell(STD_COL_NO).value = i + 1;
            row.getCell(STD_COL_NAMA).value = cleanNameStd;
            row.getCell(STD_COL_EMP_CODE).value = emp.emp_code || emp.ID_KARYAWAN || '';
            row.getCell(STD_COL_NIK).value = emp.new_nik || emp.nik || emp.NIK || emp.nik_ktp || '';
            row.getCell(STD_COL_NPWP).value = emp.npwp || emp.NPWP || '-';
            row.getCell(STD_COL_ALAMAT).value = emp.alamat || emp.res_address || emp.ALAMAT || emp.address || '';
            row.getCell(STD_COL_JABATAN).value = emp.jabatan || emp.JABATAN || emp.position || '';
            row.getCell(STD_COL_GENDER).value = emp.gender === '1' || emp.gender === 'L' ? 'L' : 'P';
            row.getCell(STD_COL_PTKP).value = emp.status_ptkp || emp.ptkp || emp.PTKP || '';
            row.getCell(STD_COL_TER).value = emp.kategori_ter || emp.kategori || emp.TER || '';

            row.getCell(STD_COL_GAJI_POKOK).value = gajiPokokValue;
            row.getCell(STD_COL_POT_ALPA).value = potonganAlpa;
            row.getCell(STD_COL_LEBIH_HK).value = lebihHk;
            row.getCell(STD_COL_ASTEK).value = firstFiniteNumberValue(emp.astek_084, emp.astek_084pct, emp.astek_jht_majikan, emp.ASTEK_INS);
            row.getCell(STD_COL_BPJS_KES).value = firstFiniteNumberValue(emp.pot_bpjs_kesehatan_majikan, emp.bpjs_kes_majikan, emp.bpjs_kesehatan_majikan_4_pct, emp.BPJS_KESEHATAN);
            row.getCell(STD_COL_BERAS).value = firstFiniteNumberValue(emp.beras_jumlah, emp.tunjangan_beras, emp.rice_allow);
            row.getCell(STD_COL_JAB).value = firstFiniteNumberValue(emp.jabatan_jumlah, emp.tunjangan_jabatan, emp.structural_allow);
            row.getCell(STD_COL_SERVICE_TIME).value = firstFiniteNumberValue(emp.lembur_jumlah, emp.tunjangan_lembur, emp.service_time_allow);
            row.getCell(STD_COL_MK).value = firstFiniteNumberValue(emp.masa_kerja_jumlah, emp.tunjangan_masa_kerja, emp.masa_kerja);

            for (let pi = 0; pi < allPremiKeys.length; pi++) {
                const colIdx = STD_COL_PREMI_START + pi;
                const keyName = allPremiKeys[pi];
                const normalizedKey = keyName.toUpperCase().replace(/ /g, '_');
                const lowerKey = normalizedKey.toLowerCase();
                const strippedKey = lowerKey.replace(/^premi_/, ''); // e.g. "pruning"

                let val = 0;
                if (emp.premi_detail && emp.premi_detail[keyName] !== undefined) {
                    val = emp.premi_detail[keyName];
                } else if (emp.premi_detail && emp.premi_detail[normalizedKey] !== undefined) {
                    val = emp.premi_detail[normalizedKey];
                } else if (emp[lowerKey] !== undefined) {
                    val = emp[lowerKey];
                } else if (emp[`premi_${strippedKey}`] !== undefined) {
                    val = emp[`premi_${strippedKey}`];
                } else if (strippedKey === 'brondol' && (emp.premi_brondol || emp.premi_brondol_total)) {
                    val = emp.premi_brondol || emp.premi_brondol_total || 0;
                }

                row.getCell(colIdx).value = val || 0;
            }

            // [FIX] Potongan Koreksi - should be NEGATIVE (e.g., -12)
            // Signed deduction invariant: write koreksi as -ABS(amount). Formulas must ADD
            // this cell, never subtract it, to avoid invalid -(-200) sign flips.
            const potKoreksiVal = Math.abs(Number(emp.pot_koreksi || 0));
            row.getCell(STD_COL_POT_KOR).value = -potKoreksiVal;

            // Pendapatan Lainnya (THR, Bonus, Kontanan)
            const otherIncomeAmounts = resolveTaxOtherIncomeAmounts(emp);
            // [FIX] Use direct values from DataExtractor for consistency with Daftar Upah
            const thrVal = Number(emp.thr_amount ?? emp.pendapatan_thr ?? otherIncomeAmounts.thr ?? 0);
            const bonusVal = Number(emp.exgratia_amount ?? emp.bonus_amount ?? emp.bonus ?? otherIncomeAmounts.bonus ?? 0);
            const kontanVal = Number(emp.kontanan_amount ?? emp.pendapatan_kontan ?? otherIncomeAmounts.kontan ?? 0);
            row.getCell(STD_COL_THR).value = thrVal;
            row.getCell(STD_COL_BONUS).value = bonusVal;
            row.getCell(STD_COL_OTHER_INCOME).value = kontanVal;

            // PENGHASILAN BRUTO — use direct value from UI/DB (not reconstructed)
            row.getCell(STD_COL_BRUTO).value = emp.penghasilan_bruto || 0;

            row.getCell(STD_COL_TARIF).value = (Number(emp.tarif_pajak_ter || emp.TARIF_TER || emp.tarif || 0)) / 100;
            row.getCell(STD_COL_TARIF).numFmt = '0.00%';

            // PPH21 — directly use pph21_ter as requested
            const pph21Value = Number(emp.pph21_ter ?? emp.potongan_pph21 ?? emp.pot_pph21 ?? 0);
            row.getCell(STD_COL_PPH21).value = pph21Value;

            // [DEBUG] Log PPH21 mapping for first 2 employees
            if (i < 2) {
                console.log(`[TaxReport Excel] PPH21 mapping for ${emp.emp_name}:`, {
                    pot_pph21_from_UI: emp.pot_pph21,
                    pph21_ter_from_UI: emp.pph21_ter,
                    final_value_used: pph21Value
                });
            }

            for (let c = STD_COL_GAJI_POKOK; c <= STD_TOTAL_COLS; c++) {
                if (c !== STD_COL_TARIF) row.getCell(c).numFmt = numFormat;
            }

            [STD_COL_NO, STD_COL_GENDER, STD_COL_PTKP, STD_COL_TER].forEach(c =>
                row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }
            );

            row.getCell(STD_COL_NAMA).alignment = { wrapText: true, vertical: 'middle' };
            row.getCell(STD_COL_ALAMAT).alignment = { wrapText: true, vertical: 'middle' };

            for (let c = 1; c <= STD_TOTAL_COLS; c++) {
                row.getCell(c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                if (i % 2 === 1) {
                    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                }
            }

            stdRowIdx++;
        } catch (err: any) {
            console.error(`[TaxReport Excel DOM] CRITICAL ERROR processing employee at index ${i}:`, err);
            // We continue to next employee to avoid crashing the whole report
        }
    });

    // Grand Total Row
    const stdFooter = stdSheet.getRow(stdRowIdx);
    stdSheet.mergeCells(`A${stdRowIdx}:${sL(STD_COL_TER)}${stdRowIdx}`);
    stdFooter.getCell(1).value = 'GRAND TOTAL';
    stdFooter.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    stdFooter.getCell(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    stdFooter.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '334155' } };

    for (let c = STD_COL_GAJI_POKOK; c <= STD_TOTAL_COLS; c++) {
        if (c !== STD_COL_TARIF) {
            const letter = sL(c);
            stdFooter.getCell(c).value = { formula: `SUM(${letter}5:${letter}${stdRowIdx - 1})` };
            stdFooter.getCell(c).numFmt = numFormat;
        }
        stdFooter.getCell(c).font = { bold: true, color: { argb: 'FFFFFF' } };
        stdFooter.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '334155' } };
        stdFooter.getCell(c).border = { top: { style: 'medium' }, left: { style: 'thin' }, bottom: { style: 'medium' }, right: { style: 'thin' } };
    }

    // --- Signatures ---
    stdRowIdx += 2;
    const sigRow1 = stdSheet.getRow(stdRowIdx);
    const sigRowEnd = sigRow1.number + 5;

    const sigLabels = [
        { label: 'Dibuat Oleh:', title: 'Admin Payroll', col: sL(2) },
        { label: 'Diperiksa Oleh:', title: 'HR Manager', col: sL(Math.floor(STD_TOTAL_COLS / 2)) },
        { label: 'Disetujui Oleh:', title: 'General Manager', col: sL(STD_TOTAL_COLS - 2) }
    ];

    sigLabels.forEach(sig => {
        stdSheet.getCell(`${sig.col}${stdRowIdx}`).value = sig.label;
        stdSheet.getCell(`${sig.col}${stdRowIdx}`).font = { bold: true, name: 'Arial' };
        stdSheet.getCell(`${sig.col}${stdRowIdx}`).alignment = { horizontal: 'center' };

        stdSheet.getCell(`${sig.col}${sigRowEnd}`).value = '( _____________________ )';
        stdSheet.getCell(`${sig.col}${sigRowEnd}`).alignment = { horizontal: 'center' };

        stdSheet.getCell(`${sig.col}${sigRowEnd + 1}`).value = sig.title;
        stdSheet.getCell(`${sig.col}${sigRowEnd + 1}`).alignment = { horizontal: 'center' };
        stdSheet.getCell(`${sig.col}${sigRowEnd + 1}`).font = { italic: true, size: 9 };
    });

    console.log(`[generateMonthlyTaxExcel] Calling workbook.xlsx.writeBuffer()...`);
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Explicit Memory Cleanup
    try {
        workbook.removeWorksheet(stdSheet.id);
        workbook.removeWorksheet(sheet.id);
        workbook.removeWorksheet(summarySheet.id);
    } catch(e) {}
    
    console.log(`[generateMonthlyTaxExcel] writeBuffer returned ${(buffer as any).byteLength || (buffer as any).length || 0} bytes`);
    if (buffer && ((buffer as any).byteLength > 0 || (buffer as any).length > 0)) {
        console.log(`[generateMonthlyTaxExcel] SUCCESS`);
    } else {
        console.error(`[generateMonthlyTaxExcel] WARNING - buffer is empty!`);
    }
    return Buffer.from(buffer);
};

/**
 * Service to generate an Excel file containing December Tax Calculations
 * with a secondary sheet for Monthly Breakdown details.
 */
export const generateDecemberTaxExcel = async (
    data: { employees: DecemberTaxRow[] },
    year: number,
    division: string,
    gang: string
): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PT. Rebinmas Jaya - Auto Report System';
    workbook.created = new Date();

    const applyHeaderStyle = (cell: ExcelJS.Cell, bgColor: string, color: string = 'FFFFFF') => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.font = { color: { argb: color }, bold: true, size: 10, name: 'Arial' };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    };

    const numFormat = '#.##0';

    // ==========================================
    // SHEET 1: PAJAK DESEMBER
    // ==========================================
    const mainSheetName = `Pajak Des - ${division} - ${gang || 'ALL'}`;
    const mainSheet = workbook.addWorksheet(mainSheetName.substring(0, 31));

    mainSheet.mergeCells('A1:AG1');
    const titleCell = mainSheet.getCell('A1');
    titleCell.value = `TABULASI PAJAK DESEMBER - DIVISI: ${division} | GANG: ${gang || 'ALL'} | TAHUN: ${year}`;
    titleCell.font = { size: 14, bold: true, name: 'Arial' };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // Row 3: Main Group Headers
    mainSheet.getCell('A3').value = 'IDENTITAS'; mainSheet.mergeCells('A3:F3');
    applyHeaderStyle(mainSheet.getCell('A3'), '1E293B');
    mainSheet.getCell('G3').value = 'STATUS KARYAWAN'; mainSheet.mergeCells('G3:I3');
    applyHeaderStyle(mainSheet.getCell('G3'), '1E293B');
    mainSheet.getCell('J3').value = 'DESEMBER'; mainSheet.mergeCells('J3:N3');
    applyHeaderStyle(mainSheet.getCell('J3'), '1E3A8A');
    mainSheet.getCell('O3').value = 'PENGHASILAN TIDAK TERATUR'; mainSheet.mergeCells('O3:Q3');
    applyHeaderStyle(mainSheet.getCell('O3'), 'B45309');
    mainSheet.getCell('R3').value = 'DISETAHUNKAN'; mainSheet.mergeCells('R3:X3');
    applyHeaderStyle(mainSheet.getCell('R3'), '0284C7');
    mainSheet.getCell('Y3').value = 'PENGURANG'; mainSheet.mergeCells('Y3:AA3');
    applyHeaderStyle(mainSheet.getCell('Y3'), 'B91C1C');
    mainSheet.getCell('AB3').value = 'KALKULASI PAJAK'; mainSheet.mergeCells('AB3:AG3');
    applyHeaderStyle(mainSheet.getCell('AB3'), '15803D');

    // Row 4: Sub Headers
    const mainCols = [
        /* A */ { header: 'NO', width: 5 },
        /* B */ { header: 'NAMA KARYAWAN', width: 25 },
        /* C */ { header: 'NIK / PASPOR', width: 18 },
        /* D */ { header: 'NPWP', width: 20 },
        /* E */ { header: 'ALAMAT', width: 25 },
        /* F */ { header: 'JABATAN', width: 15 },
        /* G */ { header: 'L/P', width: 5 },
        /* H */ { header: 'PTKP', width: 8 },
        /* I */ { header: 'TER', width: 8 },
        /* J */ { header: 'Gaji Pokok', width: 15, group: 'blue' },
        /* K */ { header: 'Total Tunjangan', width: 15, group: 'blue' },
        /* L */ { header: 'Premi Asuransi\n(BPJS+Astek)', width: 15, group: 'blue' },
        /* M */ { header: 'Tunjangan PPh', width: 15, group: 'blue' },
        /* N */ { header: 'Ph. Bruto Des\n(J+K+L+M)', width: 15, group: 'blue' },
        /* O */ { header: 'THR', width: 15, group: 'orange' },
        /* P */ { header: 'BONUS', width: 15, group: 'orange' },
        /* Q */ { header: 'TANTIEM', width: 15, group: 'orange' },
        /* R */ { header: 'Total Gaji Pokok\n(Setahun)', width: 15, group: 'lightblue' },
        /* S */ { header: 'Total Tunj.\nLainnya', width: 15, group: 'lightblue' },
        /* T */ { header: 'Total Premi\nAsuransi', width: 18, group: 'lightblue' },
        /* U */ { header: 'Total Tunj.\nPPh', width: 15, group: 'lightblue' },
        /* V */ { header: 'Total Natura', width: 15, group: 'lightblue' },
        /* W */ { header: 'Total THR/\nBonus', width: 15, group: 'lightblue' },
        /* X */ { header: 'Ph. Bruto\nSetahun\n(R+S+T+U+V+W)', width: 18, group: 'lightblue' },
        /* Y */ { header: 'Biaya Jabatan\n(5%×X, max 6jt)', width: 15, group: 'red' },
        /* Z */ { header: 'Total Iuran\nJHT/JP', width: 18, group: 'red' },
        /* AA */ { header: 'Ph. Netto\nSetahun\n(X-Y-Z)', width: 18, group: 'red' },
        /* AB */ { header: 'PTKP', width: 15, group: 'green' },
        /* AC */ { header: 'PKP\n(AA-AB)', width: 15, group: 'green' },
        /* AD */ { header: 'PPh 21\nSetahun', width: 18, group: 'green' },
        /* AE */ { header: 'PPh 21\nNon NPWP', width: 18, group: 'green' },
        /* AF */ { header: 'PPh 21\nJan S.D Nop', width: 18, group: 'green' },
        /* AG */ { header: 'PPh 21\nDesember\n(AD-AF)', width: 18, group: 'green' },
    ];

    mainSheet.columns = mainCols.map((col, idx) => ({ key: `col${idx}`, width: col.width }));

    mainCols.forEach((col, index) => {
        const cell = mainSheet.getCell(4, index + 1);
        cell.value = col.header;
        let bgColor = 'F8FAFC';
        let fgColor = '0F172A';
        if (col.group === 'blue') { bgColor = '1E3A8A'; fgColor = 'FFFFFF'; }
        else if (col.group === 'orange') { bgColor = 'B45309'; fgColor = 'FFFFFF'; }
        else if (col.group === 'lightblue') { bgColor = '0284C7'; fgColor = 'FFFFFF'; }
        else if (col.group === 'red') { bgColor = 'B91C1C'; fgColor = 'FFFFFF'; }
        else if (col.group === 'green') { bgColor = '15803D'; fgColor = 'FFFFFF'; }
        applyHeaderStyle(cell, bgColor, fgColor);
    });
    mainSheet.getRow(4).height = 45;

    let mainRowIdx = 5;
    data.employees.forEach((emp) => {
        const row = mainSheet.getRow(mainRowIdx);
        const r = mainRowIdx;

        // Static data (cols A-I: 1-9)
        row.getCell(1).value = emp.no;
        row.getCell(2).value = emp.emp_name;
        row.getCell(3).value = emp.new_nik || emp.nik;
        row.getCell(4).value = emp.npwp;
        row.getCell(5).value = emp.alamat;
        row.getCell(6).value = emp.jabatan;
        row.getCell(7).value = emp.gender;
        row.getCell(8).value = emp.status_ptkp;
        row.getCell(9).value = emp.kategori_ter;

        // Desember (J-N: cols 10-14)
        row.getCell(10).value = emp.gaji_pokok_des;   // J: Gaji Pokok Des
        row.getCell(11).value = emp.tunjangan_des;     // K: Total Tunjangan Des
        row.getCell(12).value = emp.premi_asuransi_des; // L: Premi Asuransi Des
        row.getCell(13).value = emp.tunjangan_pph_des;  // M: Tunjangan PPh Des
        // N: Ph Bruto Des = J + K + L + M
        row.getCell(14).value = { formula: `J${r}+K${r}+L${r}+M${r}`, result: emp.bruto_des };

        // Pendapatan Tidak Teratur (O-Q: cols 15-17)
        row.getCell(15).value = emp.thr;      // O
        row.getCell(16).value = emp.bonus;    // P
        row.getCell(17).value = emp.tantiem;  // Q

        // Disetahunkan (R-X: cols 18-24)
        row.getCell(18).value = emp.gaji_pokok_setahun;        // R
        row.getCell(19).value = emp.tunjangan_lainnya_setahun; // S
        row.getCell(20).value = emp.premi_asuransi_setahun;    // T
        row.getCell(21).value = emp.tunjangan_pph_setahun;     // U
        row.getCell(22).value = emp.natura_setahun;            // V
        row.getCell(23).value = emp.thr_bonus_tantiem_setahun; // W
        // X: Ph Bruto Setahun = R+S+T+U+V+W
        row.getCell(24).value = { formula: `R${r}+S${r}+T${r}+U${r}+V${r}+W${r}`, result: emp.bruto_setahun };

        // Pengurang (Y-AA: cols 25-27)
        // Y: Biaya Jabatan = MIN(X*5%, 6000000)
        row.getCell(25).value = { formula: `MIN(X${r}*0.05,6000000)`, result: emp.biaya_jabatan };
        row.getCell(26).value = emp.iuran_jht_jp_setahun;  // Z
        // AA: Netto = X - Y - Z
        row.getCell(27).value = { formula: `X${r}-Y${r}-Z${r}`, result: emp.netto_setahun };

        // Kalkulasi Pajak (AB-AG: cols 28-33)
        row.getCell(28).value = emp.ptkp;           // AB
        // AC: PKP = AA - AB (min 0)
        row.getCell(29).value = { formula: `MAX(AA${r}-AB${r},0)`, result: emp.pkp };
        row.getCell(30).value = emp.pph21_setahun;  // AD
        // AE: PPh21 Non NPWP = AD × 120%
        row.getCell(31).value = { formula: `AD${r}*1.2`, result: emp.pph21_setahun };
        row.getCell(32).value = emp.pph21_jan_nov;  // AF
        // AG: PPh21 Desember = AD - AF
        row.getCell(33).value = { formula: `AD${r}-AF${r}`, result: emp.pph21_desember };

        // Number formats
        for (let c = 10; c <= 33; c++) {
            row.getCell(c).numFmt = numFormat;
        }

        // Borders
        for (let c = 1; c <= 33; c++) {
            row.getCell(c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        }

        // Highlight December PPh21
        row.getCell(33).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D1E7DD' } };
        row.getCell(33).font = { color: { argb: '0F5132' }, bold: true };

        mainRowIdx++;
    });

    // Main Sheet Grand Total
    const mainFooter = mainSheet.getRow(mainRowIdx);
    mainSheet.mergeCells(`A${mainRowIdx}:I${mainRowIdx}`);
    mainFooter.getCell('A').value = 'GRAND TOTAL';
    mainFooter.getCell('A').alignment = { horizontal: 'right', vertical: 'middle' };
    mainFooter.getCell('A').font = { bold: true };
    mainFooter.getCell('A').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };

    for (let c = 10; c <= 33; c++) {
        const cell = mainFooter.getCell(c);
        cell.value = { formula: `SUM(${mainSheet.getColumn(c).letter}5:${mainSheet.getColumn(c).letter}${mainRowIdx - 1})` };
        cell.numFmt = numFormat;
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
        cell.border = { top: { style: 'medium' }, left: { style: 'thin' }, bottom: { style: 'medium' }, right: { style: 'thin' } };
    }
    mainFooter.getCell(33).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D1E7DD' } };
    mainFooter.getCell(33).font = { color: { argb: '0F5132' }, bold: true };

    // ==========================================
    // SHEET 2: LAMPIRAN URAIAN BULANAN
    // ==========================================
    const detailSheetName = `Uraian Bulanan_Des_${year}`;
    const detailSheet = workbook.addWorksheet(detailSheetName.substring(0, 31));

    const detailCols = [
        { header: 'NO', width: 5 }, { header: 'NAMA KARYAWAN', width: 25 }, { header: 'NIK', width: 15 },
        { header: 'KOMPONEN', width: 22 },
        { header: 'JAN', width: 12 }, { header: 'FEB', width: 12 }, { header: 'MAR', width: 12 },
        { header: 'APR', width: 12 }, { header: 'MEI', width: 12 }, { header: 'JUN', width: 12 },
        { header: 'JUL', width: 12 }, { header: 'AGU', width: 12 }, { header: 'SEP', width: 12 },
        { header: 'OKT', width: 12 }, { header: 'NOV', width: 12 }, { header: 'DES', width: 12 },
        { header: 'TOTAL SETAHUN\n(SUM Jan-Des)', width: 16 }
    ];
    detailSheet.columns = detailCols.map((col, idx) => ({ key: `col${idx}`, width: col.width }));

    detailSheet.getRow(1).height = 35;
    detailCols.forEach((col, index) => {
        const cell = detailSheet.getCell(1, index + 1);
        cell.value = col.header;
        applyHeaderStyle(cell, '1E293B', 'FFFFFF');
    });

    let detailRowIdx = 2;
    const components = [
        { key: 'gaji_pokok', label: '1. Gaji Pokok' },
        { key: 'tunjangan', label: '2. Tunjangan' },
        { key: 'premi_asuransi', label: '3. Premi Asuransi\n(BPJS Kes 4%+Astek 0.84%)' },
        { key: 'iuran_pensiun', label: '4. Iuran Pensiun' },
        { key: 'pph21', label: '5. PPh 21' }
    ];

    data.employees.forEach((emp, i) => {
        components.forEach((comp, cIdx) => {
            const row = detailSheet.getRow(detailRowIdx);

            if (cIdx === 0) {
                row.getCell(1).value = i + 1;
                row.getCell(2).value = emp.emp_name;
                row.getCell(3).value = emp.new_nik || emp.nik;
            }

            row.getCell(4).value = comp.label;

            let firstCellAddr = '';
            let lastCellAddr = '';

            for (let m = 1; m <= 12; m++) {
                const key = comp.key as keyof typeof emp.monthly_breakdown;
                const val = emp.monthly_breakdown?.[key]?.[String(m)] || 0;
                const cell = row.getCell(4 + m);
                cell.value = val;
                cell.numFmt = numFormat;
                if (m === 1) firstCellAddr = cell.address;
                if (m === 12) lastCellAddr = cell.address;
            }

            // Total Column with SUM formula
            const totalCell = row.getCell(17);
            if (firstCellAddr && lastCellAddr) {
                totalCell.value = { formula: `SUM(${firstCellAddr}:${lastCellAddr})` };
            }
            totalCell.numFmt = numFormat;
            totalCell.font = { bold: true };

            // Borders
            for (let colId = 1; colId <= 17; colId++) {
                row.getCell(colId).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            }

            if (i % 2 !== 0) {
                for (let colId = 1; colId <= 17; colId++) {
                    const c = row.getCell(colId);
                    if (!c.fill || (c.fill as any).fgColor === undefined) {
                        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                    }
                }
            }

            detailRowIdx++;
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    
    // Explicit Memory Cleanup
    try {
        workbook.removeWorksheet(mainSheet.id);
        if (detailSheet) workbook.removeWorksheet(detailSheet.id);
    } catch(e) {}
    
    return Buffer.from(buffer);
};
