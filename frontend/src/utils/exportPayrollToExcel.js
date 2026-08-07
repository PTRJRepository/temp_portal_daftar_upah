/**
 * Export Payroll Data to Excel with Styled Formatting
 * Matches the visual appearance of the CustomPayrollTable grid
 */
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { isPayrollNumericField, isPayrollTotalDisplayOnlyField, isSignedPayrollDeductionField, resolveGrandTotalNumericValue } from './payrollGrandTotalValue';

// Color palette matching ag-grid-professional.css and CustomPayrollTable.css
const COLORS = {
    // Header colors
    headerBg: 'F8FAFC',
    headerText: '1E293B',

    // Column group backgrounds
    absensi: 'F4F7FA',
    upahDasar: 'F7F4EF',
    tunjangan: 'F6F8F2',
    premi: 'F3F7F6',
    potongan: 'F8F4F4',

    // Highlight colors for totals
    totalHk: 'E8EEF5',
    totalHkText: '1F3A5F',
    totalTunjangan: 'F4EBDD',
    totalTunjanganText: '6B4E1F',
    totalPremi: 'E7F0ED',
    totalPremiText: '285C4D',
    totalPotongan: 'F2E5E5',
    totalPotonganText: '7F2D2D',
    upahKotor: 'F7F1DF',
    upahKotorText: '6B541F',
    upahBersih: 'E3EFEA',
    upahBersihText: '285C4D',

    // Row colors
    gangHeader: 'EDF4F1',
    gangTotal: 'E8EEF5',
    grandTotal: '1F2937',
    grandTotalText: 'FFFFFF',

    // Border
    border: 'D8DEE6',
    borderDark: 'A8B1BD'
};

// Format number with Indonesian locale (dot as thousand separator)
const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    if (isNaN(n)) return '-';
    return Math.round(n);
};

const formatDecimal = (value) => {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    if (isNaN(n)) return '-';
    return n;
};

// IMPORTANT DATA VALIDITY RULE:
// Deductions in Excel must be stored as signed negative numbers, while formulas add them.
// Do not build formulas like `gross minus deduction` or `negative ABS(deduction)` here. If deduction
// already exports as -200, subtracting it creates -(-200) and incorrectly increases wages.
function formatPayrollExportNumber(field, value) {
    const formatted = formatNumber(value);
    if (formatted === '-') return formatted;
    return isSignedPayrollDeductionField(field)
        ? -Math.abs(formatted)
        : formatted;
}

export function cleanPayrollExportEmployeeName(value) {
    const cleaned = String(value ?? '')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || '-';
}

export function formatPayrollExportCellValue(row, col, variant = 'detail') {
    const field = col?.field;
    const normalizedVariant = normalizeExportVariant(variant);
    const val = resolvePayrollExportCellRawValue(row, field);

    if (normalizedVariant === 'print' && field === 'nama') {
        return cleanPayrollExportEmployeeName(val);
    }

    if (field === 'lembur_jam') {
        return formatDecimal(val);
    }

    if (typeof val === 'number') {
        return formatPayrollExportNumber(field, val);
    }

    return val ?? '-';
}

function resolvePayrollExportCellRawValue(row, field) {
    if (field === 'total_pendapatan_lainnya_pengurang') {
        return row?.total_pendapatan_lainnya;
    }

    if (typeof field === 'string' && field.startsWith('pendapatan_') && field.endsWith('_pengurang')) {
        return resolvePayrollExportCellRawValue(row, field.replace(/_pengurang$/, ''));
    }

    if (isOtherIncomeDetailField(field)) {
        return row?.[field] ?? resolveOtherIncomeAmountFromRow(row, field);
    }

    return row?.[field];
}

/**
 * Get column background color based on field name
 */
function getColumnColor(field) {
    // Attendance columns
    if (field.includes('hari_kerja') || field.includes('cuti') || field === 'jumlah_hk') {
        return COLORS.absensi;
    }
    // Upah Dasar
    if (field.includes('upah_dasar') || field.includes('gaji_pokok') || field === 'upah_pokok') {
        return COLORS.upahDasar;
    }
    // Tunjangan
    if (field.startsWith('beras_') || field.startsWith('jabatan_') ||
        field.startsWith('masa_kerja_') || field.startsWith('lembur_') ||
        field === 'total_tunjangan') {
        return COLORS.tunjangan;
    }
    // Premi
    if (field.startsWith('premi') || field === 'total_premi') {
        return COLORS.premi;
    }
    // Potongan
    if (field.startsWith('pot_') || field.includes('potongan')) {
        return COLORS.potongan;
    }
    return null;
}

/**
 * Get special highlight styling for total columns
 */
function getTotalColumnStyle(field) {
    if (field === 'jumlah_hk') {
        return { fill: COLORS.totalHk, font: COLORS.totalHkText, bold: true };
    }
    if (field === 'total_tunjangan') {
        return { fill: COLORS.totalTunjangan, font: COLORS.totalTunjanganText, bold: true };
    }
    if (field === 'total_premi') {
        return { fill: COLORS.totalPremi, font: COLORS.totalPremiText, bold: true };
    }
    if (field === 'total_potongan' || field === 'total_potongan_bersih') {
        return { fill: COLORS.totalPotongan, font: COLORS.totalPotonganText, bold: true };
    }
    if (field === 'jumlah_upah_kotor' || field === 'potongan_upah_kotor_total') {
        return { fill: COLORS.upahKotor, font: COLORS.upahKotorText, bold: true };
    }
    if (field === 'upah_bersih') {
        return { fill: COLORS.upahBersih, font: COLORS.upahBersihText, bold: true };
    }
    return null;
}

function getHeaderGroupStyle(label) {
    const normalized = String(label || '').trim().toUpperCase();
    if (normalized.includes('IDENTITAS')) return { fill: '334155', font: 'FFFFFF' };
    if (normalized.includes('ABSENSI')) return { fill: 'E8EEF5', font: '1F3A5F' };
    if (normalized.includes('GAJI') || normalized.includes('UPAH DASAR')) return { fill: 'EDE7DF', font: '5B3A29' };
    if (normalized.includes('TUNJANGAN')) return { fill: 'EAF2EA', font: '2F5D50' };
    if (normalized.includes('PREMI')) return { fill: 'EDEAF4', font: '51446F' };
    if (normalized.includes('PENDAPATAN LAINNYA')) return { fill: 'F6EBDD', font: '7A4E23' };
    if (normalized.includes('POTONGAN')) return { fill: 'F3E5E5', font: '7F2D2D' };
    if (normalized.includes('UPAH KOTOR')) return { fill: 'F7F1DF', font: '6B541F' };
    if (normalized.includes('UPAH BERSIH')) return { fill: 'E8F2EE', font: '285C4D' };
    return { fill: COLORS.headerBg, font: COLORS.headerText };
}

function resolveValuePriorityModeLabel(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    if (normalized === 'db_ptrj_only') return 'DB PTRJ Saja';
    return 'Non DB_PTRJ (Auto Buffer + Manual Adjustment)';
}

const UI_ONLY_EXPORT_FIELDS = new Set([
    'checkbox',
    'actions',
    'selection',
    'manual_adjustment_action',
    'panen_section_disabled'
]);

const TAX_DETAIL_EXPORT_FIELDS = new Set([
    'status_ptkp',
    'kategori_ter',
    'penghasilan_bruto',
    'tarif_pajak_ter',
    'pph21_ter',
    'upah_kotor_pajak'
]);

// Fields that should ALWAYS be included in export (even if not in columnDefs)
const ALWAYS_INCLUDE_EXPORT_FIELDS = new Set([
    'total_pendapatan_lainnya',
    'pendapatan_lainnya',
    'pendapatan_thr',
    'pendapatan_bonus',
    'pendapatan_custom',
    'pendapatan_kontan'
]);

const OTHER_INCOME_TOTAL_FIELDS = new Set([
    'pendapatan_lainnya',
    'total_pendapatan_lainnya',
    'taxable_pendapatan_lainnya',
    'total_pendapatan_lainnya_pengurang'
]);

const OTHER_INCOME_FIELD_ORDER = [
    'pendapatan_thr',
    'pendapatan_kontan',
    'pendapatan_bonus',
    'pendapatan_custom'
];

const UPAH_KOTOR_BREAKDOWN_FIELDS = [
    { field: 'gaji_pokok_aktual', fallbackField: 'gaji_pokok', label: 'GAJI POKOK' },
    { field: 'total_tunjangan', label: 'TUNJANGAN' },
    { field: 'total_premi', label: 'PREMI' },
    { field: 'potongan_upah_kotor_total', label: 'POT. KOTOR (-)' }
];

const SUMMARY_EXPORT_FIELDS = new Set([
    'no',
    'emp_code',
    'nik',
    'nama',
    'jabatan_estate',
    'hari_kerja',
    'jumlah_hk',
    'gaji_pokok',
    'upah_pokok',
    'total_tunjangan',
    'total_premi',
    'total_pendapatan_lainnya',
    'jumlah_upah_kotor',
    'pot_koreksi',
    'pot_astek',
    'pot_bpjs_kesehatan_pekerja',
    'pot_bpjs_pensiun_pekerja',
    'pot_spsi',
    'pot_pph21',
    'premi_pph',
    'total_potongan',
    'total_potongan_bersih',
    'upah_bersih'
]);

const EXPORT_VARIANT_LABELS = {
    summary: 'RINGKAS',
    detail: 'DETAIL',
    print: 'PRINT'
};

const EXPORT_VARIANT_SHEET_NAMES = {
    summary: 'Ringkas',
    detail: 'Detail',
    print: 'Print'
};

const WORKBOOK_EXPORT_VARIANTS = ['detail', 'summary', 'print'];

const PRINT_EXPORT_FIELDS = new Set([
    'emp_code',
    'nama',
    'gaji_pokok_aktual',
    'gaji_pokok_ideal',
    'koreksi_hk',
    'beras_jumlah',
    'jabatan_jumlah',
    'masa_kerja_jumlah',
    'lembur_jumlah',
    'total_tunjangan',
    'total_premi',
    'total_pendapatan_lainnya',
    'jumlah_upah_kotor',
    'pot_astek',
    'pot_bpjs_kesehatan_pekerja',
    'pot_bpjs_pensiun_pekerja',
    'pot_spsi',
    'pot_pph21',
    'premi_pph',
    'total_potongan',
    'total_potongan_bersih',
    'upah_bersih'
]);

function normalizeExportVariant(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'summary' || normalized === 'print') return normalized;
    return 'detail';
}

export function resolvePayrollWorkbookSheetVariants() {
    return [...WORKBOOK_EXPORT_VARIANTS];
}

function isTaxDetailExportField(field) {
    if (!field) return false;
    if (TAX_DETAIL_EXPORT_FIELDS.has(field)) return true;
    return field.startsWith('taxable_pendapatan_');
}

function isOtherIncomeDetailField(field) {
    if (!field || !field.startsWith('pendapatan_')) return false;
    if (OTHER_INCOME_TOTAL_FIELDS.has(field)) return false;
    if (field.endsWith('_pengurang')) return false;
    return true;
}

function isOtherIncomeDeductionField(field) {
    return Boolean(field && field.startsWith('pendapatan_') && field.endsWith('_pengurang'));
}

function isPrintExportField(col) {
    const field = col?.field;
    if (!field) return false;
    if (PRINT_EXPORT_FIELDS.has(field)) return true;
    if (isOtherIncomeDetailField(field)) return true;
    if (isOtherIncomeDeductionField(field)) return true;
    // Dynamic net deductions (pot_xxx) must appear so total_potongan_bersih formula sums them.
    if (isSelectedNetDeductionFormulaField(col, [col])) return true;
    return field.startsWith('premi_') && field !== 'premi_pph';
}

function hasPositiveFieldValue(rows, field) {
    return rows.some((row) => (!row?.type || row?.type === 'employee') && Number(row?.[field] || 0) !== 0);
}

function formatOtherIncomeExportLabel(field) {
    const raw = field.replace(/^pendapatan_/, '').replace(/_/g, ' ').trim().toUpperCase();
    const compact = raw.replace(/\s/g, '');
    const normalized = compact.includes('BONUS') || compact.includes('EXGRATIA')
        ? 'PENDAPATAN BONUS'
        : raw === 'KONTAN' ? 'KONTANAN' : raw;
    return `${normalized || 'LAINNYA'} (+)`;
}

function formatOtherIncomeDeductionExportLabel(field) {
    return formatOtherIncomeExportLabel(field).replace('(+)', '(-)');
}

function normalizeOtherIncomeTypeToField(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!normalized) return null;
    const compact = normalized.replace(/_/g, '');
    if (compact.includes('bonus') || compact.includes('exgratia')) return 'pendapatan_bonus';
    if (compact.includes('thr')) return 'pendapatan_thr';
    if (compact.includes('kontan')) return 'pendapatan_kontan';
    return `pendapatan_${normalized}`;
}

function getOtherIncomeFieldFromIncome(income) {
    return normalizeOtherIncomeTypeToField(income?.type || income?.income_type || income?.name || income?.income_name);
}

function getOtherIncomeAmount(income) {
    return Number(income?.amount ?? income?.value ?? income?.jumlah ?? 0) || 0;
}

function resolveOtherIncomeAmountFromRow(row, field) {
    if (!Array.isArray(row?.other_incomes)) return undefined;
    const total = row.other_incomes.reduce((sum, income) => {
        return getOtherIncomeFieldFromIncome(income) === field ? sum + getOtherIncomeAmount(income) : sum;
    }, 0);
    return total || undefined;
}

function collectOtherIncomeDetailFields(rows) {
    const fields = new Set();
    rows.forEach((row) => {
        // Treat rows with no explicit type (undefined/null) as employee rows too —
        // backend stream omits `type` on employee rows, and skipping them here would
        // drop pendapatan_*_pengurang columns, making total_potongan omit pendapatan_lainnya.
        if (row?.type && row?.type !== 'employee') return;
        Object.keys(row).forEach((field) => {
            if (isOtherIncomeDetailField(field) && hasPositiveFieldValue(rows, field)) {
                fields.add(field);
            }
        });

        if (Array.isArray(row.other_incomes)) {
            row.other_incomes.forEach((income) => {
                const field = getOtherIncomeFieldFromIncome(income);
                if (field && isOtherIncomeDetailField(field) && getOtherIncomeAmount(income) !== 0) {
                    fields.add(field);
                }
            });
        }
    });

    return Array.from(fields).sort((a, b) => {
        const ai = OTHER_INCOME_FIELD_ORDER.indexOf(a);
        const bi = OTHER_INCOME_FIELD_ORDER.indexOf(b);
        if (ai !== -1 || bi !== -1) {
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        }
        return a.localeCompare(b);
    });
}

function buildOtherIncomeExportColumns(rows, existingFields) {
    return collectOtherIncomeDetailFields(rows)
        .filter((field) => !existingFields.has(field))
        .map((field) => ({
            field,
            headers: ['PENDAPATAN LAINNYA', 'URAIAN', null, formatOtherIncomeExportLabel(field)],
            w: 96,
            className: 'text-right'
        }));
}

function buildOtherIncomeDeductionExportColumns(rows, existingFields) {
    return collectOtherIncomeDetailFields(rows)
        .map((field) => `${field}_pengurang`)
        .filter((field) => !existingFields.has(field))
        .map((field) => ({
            field,
            headers: ['POTONGAN UPAH BERSIH', 'PENDAPATAN LAINNYA', null, formatOtherIncomeDeductionExportLabel(field.replace(/_pengurang$/, ''))],
            w: 90,
            className: 'text-right'
        }));
}


function buildUpahKotorBreakdownColumns(rows, existingFields) {
    if (!hasPositiveFieldValue(rows, 'jumlah_upah_kotor')) return [];

    return UPAH_KOTOR_BREAKDOWN_FIELDS
        .filter(({ field, fallbackField }) => hasPositiveFieldValue(rows, field) || (fallbackField && hasPositiveFieldValue(rows, fallbackField)))
        .map(({ field, fallbackField, label }) => ({
            field: existingFields.has(field) || !fallbackField ? field : fallbackField,
            headers: ['UPAH KOTOR', 'URAIAN', null, label],
            w: 96,
            className: 'text-right'
        }));
}

function getExcelColumnName(columnNumber) {
    let name = '';
    let n = columnNumber;
    while (n > 0) {
        const mod = (n - 1) % 26;
        name = String.fromCharCode(65 + mod) + name;
        n = Math.floor((n - mod) / 26);
    }
    return name;
}

function buildColumnIndexMap(columns) {
    return new Map(columns.map((col, idx) => [col.field, idx + 1]));
}

function cellRef(columnIndexMap, field, rowNumber) {
    const col = columnIndexMap.get(field);
    if (!col) return null;
    return `${getExcelColumnName(col)}${rowNumber}`;
}

function numericRef(ref) {
    return ref ? `N(${ref})` : null;
}

function sumRefs(refs) {
    const cleanRefs = refs.filter(Boolean).map(numericRef);
    if (cleanRefs.length === 0) return null;
    return cleanRefs.join('+');
}

function isSelectedNetDeductionFormulaField(col, columns) {
    const field = col?.field || '';
    const headers = Array.isArray(col?.headers) ? col.headers : [];
    const topHeader = String(headers[0] || '').toUpperCase();
    if (!topHeader.includes('POTONGAN UPAH BERSIH') && !topHeader.includes('POTONGAN')) return false;

    if (field === 'total_pendapatan_lainnya_pengurang') return true;
    if (field.startsWith('pendapatan_') && field.endsWith('_pengurang')) {
        return !columns.some((item) => item.field === 'total_pendapatan_lainnya_pengurang');
    }

    if (field === 'pot_astek' || field === 'pot_astek_pekerja') return true;
    if (field === 'pot_bpjs_kesehatan_pekerja') return true;
    if (field === 'pot_bpjs_pensiun_pekerja') return true;
    if (field === 'pot_spsi' || field === 'pot_pph21') return true;

    if (field === 'premi_pph' || field === 'pot_premi_pph') return false;
    if (field === 'total_potongan' || field === 'total_potongan_bersih') return false;
    if (field === 'potongan_upah_kotor_total' || field.startsWith('potongan_upah_kotor')) return false;
    if (field.includes('_maj') || field.includes('majikan')) return false;
    if (field.endsWith('_total') || field === 'pot_bpjs_pekerja_total') return false;

    if (field.startsWith('potongan_')) {
        // ponytail: defensive — BPJS/SPSI/PPH dynamic potongan_lainnya_* nilai sudah masuk static pot_bpjs_*/pot_spsi/pot_pph21.
        // Skip dari SUM agar tidak double-count. Backend (dataExtractorService) juga sudah filter dari dynamicPotonganSet.
        const fLower = field.toLowerCase();
        if (fLower.includes('bpjs') || fLower.includes('spsi') || fLower.includes('pph')) return false;
        return true;
    }
    return field.startsWith('pot_') && !field.startsWith('pot_koreksi');
}

function buildRowFormulaForField(field, columns, columnIndexMap, rowNumber) {
    if (field === 'total_pendapatan_lainnya') {
        const refs = columns
            .filter((col) => isOtherIncomeDetailField(col.field))
            .map((col) => cellRef(columnIndexMap, col.field, rowNumber));
        const formula = sumRefs(refs);
        return formula ? { formula } : null;
    }


    if (field === 'jumlah_upah_kotor') {
        const baseField = ['gaji_pokok_aktual', 'gaji_pokok', 'upah_pokok'].find((candidate) => columnIndexMap.has(candidate));
        const addRefs = [
            baseField ? cellRef(columnIndexMap, baseField, rowNumber) : null,
            cellRef(columnIndexMap, 'total_tunjangan', rowNumber),
            cellRef(columnIndexMap, 'total_premi', rowNumber),
            cellRef(columnIndexMap, 'total_pendapatan_lainnya', rowNumber)
        ].filter(Boolean);
        const subtractRef = cellRef(columnIndexMap, 'potongan_upah_kotor_total', rowNumber);
        const sumFormula = sumRefs(addRefs);
        if (!sumFormula && !subtractRef) return null;
        // Koreksi gross is already negative in its cell, so adding it reduces gross.
        return { formula: `${sumFormula || '0'}${subtractRef ? `+${numericRef(subtractRef)}` : ''}` };
    }

    if (field === 'total_potongan' || field === 'total_potongan_bersih') {
        const refs = columns
            .filter((col) => isSelectedNetDeductionFormulaField(col, columns))
            .map((col) => cellRef(columnIndexMap, col.field, rowNumber));
        const formula = sumRefs(refs);
        if (!formula) return null;
        const premiPphRef = field === 'total_potongan_bersih'
            ? (cellRef(columnIndexMap, 'premi_pph', rowNumber) || cellRef(columnIndexMap, 'pot_premi_pph', rowNumber))
            : null;
        // Net deductions are signed negative; PREMI_PPH is positive addition, so formulas add both.
        return { formula: `${formula}${premiPphRef ? `+${numericRef(premiPphRef)}` : ''}` };
    }

    if (field === 'upah_bersih') {
        const grossRef = cellRef(columnIndexMap, 'jumlah_upah_kotor', rowNumber);
        const deductionRef = cellRef(columnIndexMap, 'total_potongan_bersih', rowNumber) || cellRef(columnIndexMap, 'total_potongan', rowNumber);
        if (!grossRef && !deductionRef) return null;
        // Total potongan is negative, so Upah Bersih uses addition to avoid -(-potongan).
        return { formula: `${numericRef(grossRef) || '0'}+${numericRef(deductionRef) || '0'}` };
    }

    return null;
}

function applyEmployeeRowFormulas(excelRow, columns, columnIndexMap) {
    columns.forEach((col, idx) => {
        const formula = buildRowFormulaForField(col.field, columns, columnIndexMap, excelRow.number);
        if (!formula) return;
        excelRow.getCell(idx + 1).value = formula;
        excelRow.getCell(idx + 1).numFmt = '#,##0';
    });
}

function buildTotalFormulaForColumn(field, columns, columnIndexMap, rowNumbers) {
    if (!isPayrollNumericField(field) || isPayrollTotalDisplayOnlyField(field) || rowNumbers.length === 0) return null;
    const col = columnIndexMap.get(field);
    if (!col) return null;
    const columnName = getExcelColumnName(col);
    return { formula: rowNumbers.map((rowNumber) => `N(${columnName}${rowNumber})`).join('+') };
}

export function buildPayrollExportColumns(rows = [], columnDefs = [], options = {}) {
    const variant = normalizeExportVariant(options.variant || options.exportVariant);
    const baseColumns = columnDefs.filter((col) => {
        const field = col?.field;
        if (!field || UI_ONLY_EXPORT_FIELDS.has(field)) return false;
        if (variant === 'detail') return true;
        if (field === 'total_pendapatan_lainnya_pengurang') return false;
        if (field === 'pot_pph21') return true;
        if (variant === 'summary') {
            if (SUMMARY_EXPORT_FIELDS.has(field)) return true;
            // Dynamic net deductions (pot_xxx) must appear so total_potongan_bersih formula sums them.
            return isSelectedNetDeductionFormulaField(col, [col]);
        }
        if (variant === 'print') return isPrintExportField(col);
        return !isTaxDetailExportField(field);
    });

    const existingFields = new Set(baseColumns.map((col) => col.field));

    // [FIX] Always include total_pendapatan_lainnya if it has positive values in rows
    // This ensures the field is exported even when not in columnDefs (e.g., normal view mode)
    const alwaysIncludeFields = new Set();
    const hasTotalPendapatanLainnya = hasPositiveFieldValue(rows, 'total_pendapatan_lainnya');
    if (!existingFields.has('total_pendapatan_lainnya') && hasTotalPendapatanLainnya) {
        alwaysIncludeFields.add('total_pendapatan_lainnya');
    }

    const otherIncomeColumns = buildOtherIncomeExportColumns(rows, existingFields);
    const otherIncomeDeductionColumns = buildOtherIncomeDeductionExportColumns(rows, existingFields);
    const upahKotorBreakdownColumns = buildUpahKotorBreakdownColumns(rows, existingFields);

    let resultColumns = baseColumns;

    const totalIncomeIndex = baseColumns.findIndex((col) => col.field === 'total_pendapatan_lainnya');
    if (otherIncomeColumns.length > 0 && totalIncomeIndex !== -1) {
        resultColumns = [
            ...baseColumns.slice(0, totalIncomeIndex),
            ...otherIncomeColumns,
            ...baseColumns.slice(totalIncomeIndex)
        ];
    } else if (otherIncomeColumns.length > 0) {
        const totalPremiIndex = baseColumns.findIndex((col) => col.field === 'total_premi');
        resultColumns = totalPremiIndex !== -1 ? [
            ...baseColumns.slice(0, totalPremiIndex + 1),
            ...otherIncomeColumns,
            ...baseColumns.slice(totalPremiIndex + 1)
        ] : [...baseColumns, ...otherIncomeColumns];
    }

    // [FIX] Insert always-include fields (like total_pendapatan_lainnya) if not already in resultColumns
    for (const field of alwaysIncludeFields) {
        if (!resultColumns.some(col => col.field === field)) {
            // Insert before total_premi if it exists, otherwise at the end of premi section
            const totalPremiIdx = resultColumns.findIndex((col) => col.field === 'total_premi');
            const insertCol = {
                field,
                headers: ['PENDAPATAN LAINNYA', null, 'TOTAL (+)'],
                w: 100,
                className: 'text-right font-bold'
            };
            if (totalPremiIdx !== -1) {
                resultColumns.splice(totalPremiIdx + 1, 0, insertCol);
            } else {
                resultColumns.push(insertCol);
            }
        }
    }

    const grossIndex = resultColumns.findIndex((col) => col.field === 'jumlah_upah_kotor');
    if (upahKotorBreakdownColumns.length > 0 && grossIndex !== -1) {
        resultColumns = [
            ...resultColumns.slice(0, grossIndex),
            ...upahKotorBreakdownColumns,
            ...resultColumns.slice(grossIndex)
        ];
    }

    if (otherIncomeDeductionColumns.length > 0) {
        const insertIndex = resultColumns.findIndex((col) =>
            col.field === 'total_potongan'
            || col.field === 'total_potongan_bersih'
        );
        if (insertIndex !== -1) {
            resultColumns = [
                ...resultColumns.slice(0, insertIndex),
                ...otherIncomeDeductionColumns,
                ...resultColumns.slice(insertIndex)
            ];
        }
    }


    return resultColumns;
}

const PAYROLL_EXPORT_UI_PARITY_FIELDS = new Set([
    'total_pendapatan_lainnya',
    'jumlah_upah_kotor',
    'total_potongan',
    'total_potongan_bersih',
    'upah_bersih'
]);

function isPayrollExportEmployeeRow(row) {
    if (!row || typeof row !== 'object') return false;
    if (row.type === 'employee') return true;
    if (row.type === 'gang_header' || row.type === 'gang_total' || row.type === 'grand_total') return false;
    if (row.isHeader || row.isTotal) return false;
    return true;
}

function isPayrollExportParityRow(row) {
    if (isPayrollExportEmployeeRow(row)) return true;
    return row?.type === 'gang_total' || row?.isTotal === true;
}

function resolvePayrollExportEmployeeKey(row, sourceIndex) {
    const key = row?.emp_code || row?.nik || row?.nama || row?.emp_name;
    return String(key || `row-${sourceIndex + 1}`).trim();
}

function resolvePayrollExportParityKey(row, sourceIndex) {
    if (isPayrollExportEmployeeRow(row)) {
        return resolvePayrollExportEmployeeKey(row, sourceIndex);
    }
    return String(row?.gang_code || row?.nama || `subtotal-${sourceIndex + 1}`).trim();
}

function buildPayrollExportValuesByField(row, columns, exportVariant) {
    const valuesByField = {};
    const cells = columns.map((col) => {
        const value = formatPayrollExportCellValue(row, col, exportVariant);
        valuesByField[col.field] = value;
        return { field: col.field, value };
    });
    return { valuesByField, cells };
}

function buildPayrollExportRowModel(row, sourceIndex, columns, exportVariant) {
    const { valuesByField, cells } = buildPayrollExportValuesByField(row, columns, exportVariant);
    return {
        type: row?.type || 'employee',
        sourceIndex,
        sourceRow: row,
        employeeKey: isPayrollExportParityRow(row) ? resolvePayrollExportParityKey(row, sourceIndex) : null,
        valuesByField,
        cells
    };
}

function buildPayrollExportGrandTotalModel(grandTotal, rows, columns, options = {}) {
    if (!grandTotal) return null;

    const employeeCount = rows.filter(isPayrollExportEmployeeRow).length;
    const valuesByField = {};
    const cells = columns.map((col) => {
        let value;
        if (col.field === 'nama') value = 'GRAND TOTAL';
        else if (col.field === 'no') value = '';
        else if (col.field === 'emp_code') value = `${employeeCount} KARYAWAN`;
        else if (isPayrollTotalDisplayOnlyField(col.field)) value = '-';
        else if (isPayrollNumericField(col.field)) {
            value = formatPayrollExportNumber(col.field, resolveGrandTotalNumericValue({
                grandTotal,
                rows,
                field: col.field,
                preferRows: Boolean(options.preferRows),
                preferSubtotalRows: Boolean(options.preferSubtotalRows)
            }));
        } else {
            const val = grandTotal[col.field];
            value = val !== undefined && val !== null && val !== '' ? val : '-';
        }

        valuesByField[col.field] = value;
        return { field: col.field, value };
    });

    return {
        type: 'grand_total',
        sourceRow: grandTotal,
        valuesByField,
        cells
    };
}

export function buildPayrollExportSheetModel(rows = [], columnDefs = [], grandTotal = null, meta = {}, variant = 'detail') {
    const exportVariant = normalizeExportVariant(variant);
    const columns = buildPayrollExportColumns(rows, columnDefs, { variant: exportVariant });
    const variantLabel = EXPORT_VARIANT_LABELS[exportVariant] || EXPORT_VARIANT_LABELS.detail;
    const sheetName = EXPORT_VARIANT_SHEET_NAMES[exportVariant] || variantLabel;

    return {
        variant: exportVariant,
        variantLabel,
        sheetName,
        meta,
        columns,
        rows: rows.map((row, sourceIndex) => buildPayrollExportRowModel(row, sourceIndex, columns, exportVariant)),
        grandTotalRow: buildPayrollExportGrandTotalModel(grandTotal, rows, columns, {
            preferRows: Boolean(meta?.preferRowGrandTotals || meta?.hasPendingEdits),
            preferSubtotalRows: Boolean(meta?.preferSubtotalGrandTotals)
        })
    };
}

export function buildPayrollWorkbookSheetModels(rows = [], columnDefs = [], grandTotal = null, meta = {}) {
    return resolvePayrollWorkbookSheetVariants().map((exportVariant) =>
        buildPayrollExportSheetModel(rows, columnDefs, grandTotal, meta, exportVariant)
    );
}

function shouldGuardPayrollExportField(field, variant, explicitFields = null) {
    if (!field) return false;
    if (explicitFields) return explicitFields.has(field);
    if (PAYROLL_EXPORT_UI_PARITY_FIELDS.has(field)) return true;
    if (variant === 'detail') return true;
    return isPayrollNumericField(field);
}

function comparableExportValue(value) {
    if (value && typeof value === 'object' && 'result' in value) return value.result;
    return value;
}

function exportValuesAreEqual(expected, actual) {
    const a = comparableExportValue(expected);
    const b = comparableExportValue(actual);
    const aNumber = typeof a === 'number' ? a : Number(a);
    const bNumber = typeof b === 'number' ? b : Number(b);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
        return Math.abs(aNumber - bNumber) <= 0.01;
    }
    return String(a ?? '') === String(b ?? '');
}

function describeExportValue(value) {
    const comparable = comparableExportValue(value);
    if (comparable && typeof comparable === 'object') return JSON.stringify(comparable);
    return String(comparable);
}

export function assertPayrollExportUiParity(sheetModel, _sourceRows = [], options = {}) {
    const explicitFields = Array.isArray(options.fields) ? new Set(options.fields) : null;
    const mismatches = [];

    sheetModel.rows
        .filter((rowModel) => isPayrollExportParityRow(rowModel.sourceRow))
        .forEach((rowModel) => {
            sheetModel.columns.forEach((col) => {
                if (!shouldGuardPayrollExportField(col.field, sheetModel.variant, explicitFields)) return;

                const expected = formatPayrollExportCellValue(rowModel.sourceRow, col, sheetModel.variant);
                const actual = rowModel.valuesByField[col.field];
                if (exportValuesAreEqual(expected, actual)) return;

                mismatches.push({
                    sheet: sheetModel.sheetName,
                    variant: sheetModel.variant,
                    employee: rowModel.employeeKey,
                    field: col.field,
                    expected,
                    actual
                });
            });
        });

    if (mismatches.length > 0) {
        const details = mismatches.slice(0, 5).map((item) =>
            `${item.sheet}/${item.employee}/${item.field}: expected ${describeExportValue(item.expected)}, actual ${describeExportValue(item.actual)}`
        ).join('; ');
        throw new Error(`Daftar Upah Excel parity guard failed (${mismatches.length} mismatch${mismatches.length === 1 ? '' : 'es'}): ${details}`);
    }

    return true;
}

/**
 * Build merged header cells from column definitions
 * Returns: Array of { row, col, rowSpan, colSpan, label }
 */
function buildHeaderMerges(enhancedColumnDefs) {
    const numRows = 4;
    const numCols = enhancedColumnDefs.length;
    const grid = Array(numRows).fill(null).map(() => Array(numCols).fill(null));

    // Process each column's headers
    enhancedColumnDefs.forEach((col, colIdx) => {
        const headers = col.headers;

        for (let row = 0; row < numRows; row++) {
            if (grid[row][colIdx] !== null) continue;

            const label = headers[row];
            if (label !== null) {
                let rowSpan = 1;
                for (let r = row + 1; r < numRows; r++) {
                    if (headers[r] === null) rowSpan++;
                    else break;
                }
                for (let r = row; r < row + rowSpan; r++) {
                    grid[r][colIdx] = { label, rowSpan, colSpan: 1, startRow: row, startCol: colIdx };
                }
            }
        }
    });

    // Merge adjacent cells with same label in same row
    for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
            const cell = grid[row][col];
            if (!cell || cell.merged) continue;

            let colspan = 1;
            for (let c = col + 1; c < numCols; c++) {
                const nextCell = grid[row][c];
                if (nextCell && nextCell.label === cell.label &&
                    nextCell.startRow === cell.startRow &&
                    nextCell.rowSpan === cell.rowSpan) {
                    colspan++;
                    nextCell.merged = true;
                } else {
                    break;
                }
            }
            cell.colSpan = colspan;
        }
    }

    // Collect merge instructions
    const merges = [];
    for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
            const cell = grid[row][col];
            if (!cell || cell.merged) continue;
            if (cell.startRow !== row) continue;

            merges.push({
                row: row + 1, // Excel is 1-indexed
                col: col + 1,
                rowSpan: cell.rowSpan,
                colSpan: cell.colSpan,
                label: cell.label || ''
            });
        }
    }

    return merges;
}

/**
 * Main export function
 * @param {Array} rows - Data rows from CustomPayrollTable
 * @param {Array} columnDefs - Column definitions with headers and field names
 * @param {Object} grandTotal - Grand total row data
 * @param {Object} meta - Metadata: { division, gangCode, month, year }
 */
async function exportPayrollSingleSheetToExcel(rows, columnDefs, grandTotal, meta) {
    const exportVariant = normalizeExportVariant(meta?.exportVariant);
    const enhancedColumnDefs = buildPayrollExportColumns(rows, columnDefs, { variant: exportVariant });

    let workbook = new ExcelJS.Workbook();
    workbook.creator = 'PT Rebinmas Jaya - Payroll System';
    workbook.created = new Date();

    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const periodStr = `${monthNames[meta.month - 1]} ${meta.year}`;
    const sheetName = `Daftar Upah ${meta.division}`;
    const sourceModeLabel = resolveValuePriorityModeLabel(meta?.valuePriorityMode);
    const variantLabel = EXPORT_VARIANT_LABELS[exportVariant] || EXPORT_VARIANT_LABELS.detail;

    const worksheet = workbook.addWorksheet(sheetName.substring(0, 31), {
        pageSetup: {
            paperSize: 9, // A4
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0
        }
    });

    // === TITLE ROW ===
    const titleRow = worksheet.addRow([`DAFTAR UPAH KARYAWAN ${variantLabel} - ${meta.division} - ${periodStr}`]);
    titleRow.height = 34;
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: 'FFFFFF' } };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    worksheet.mergeCells(1, 1, 1, enhancedColumnDefs.length);
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // === SUB TITLE ROW ===
    const gangLabel = meta.gangCode === 'ALL' ? 'Semua Gang' : `Gang: ${meta.gangCode}`;
    const subTitleRow = worksheet.addRow([`${gangLabel} | Format: ${variantLabel} | Sumber Nilai: ${sourceModeLabel}`]);
    subTitleRow.height = 22;
    subTitleRow.getCell(1).font = { size: 11, italic: true, color: { argb: '334155' } };
    subTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };
    worksheet.mergeCells(2, 1, 2, enhancedColumnDefs.length);
    subTitleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Empty row
    worksheet.addRow([]);

    // === HEADERS (4 rows) ===
    const headerStartRow = 4;
    const headerMerges = buildHeaderMerges(enhancedColumnDefs);

    // Add 4 empty header rows first
    for (let i = 0; i < 4; i++) {
        const row = worksheet.addRow(Array(enhancedColumnDefs.length).fill(''));
        row.height = 22;
    }

    // Apply header labels and merges
    headerMerges.forEach(merge => {
        const excelRow = headerStartRow + merge.row - 1;
        const excelCol = merge.col;

        const cell = worksheet.getCell(excelRow, excelCol);
        cell.value = merge.label;
        const headerStyle = getHeaderGroupStyle(merge.label);
        cell.font = { bold: true, size: 10, color: { argb: headerStyle.font } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: headerStyle.fill }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: COLORS.border } },
            bottom: { style: 'thin', color: { argb: COLORS.border } },
            left: { style: 'thin', color: { argb: COLORS.border } },
            right: { style: 'thin', color: { argb: COLORS.border } }
        };

        // Merge cells if needed
        if (merge.rowSpan > 1 || merge.colSpan > 1) {
            const endRow = excelRow + merge.rowSpan - 1;
            const endCol = excelCol + merge.colSpan - 1;
            worksheet.mergeCells(excelRow, excelCol, endRow, endCol);
        }
    });

    // === SET COLUMN WIDTHS ===
    enhancedColumnDefs.forEach((col, idx) => {
        worksheet.getColumn(idx + 1).width = Math.max(col.w / 7, 8);
    });
    worksheet.autoFilter = {
        from: { row: headerStartRow + 3, column: 1 },
        to: { row: headerStartRow + 3, column: enhancedColumnDefs.length }
    };
    worksheet.properties.defaultRowHeight = 20;
    worksheet.pageSetup = {
        ...worksheet.pageSetup,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true
    };

    // === DATA ROWS ===
    const dataStartRow = headerStartRow + 4; // After 4 header rows

    rows.forEach((row) => {
        if (row.type === 'gang_header') {
            // Gang header row - full width merge
            const excelRow = worksheet.addRow(Array(enhancedColumnDefs.length).fill(''));
            excelRow.height = 24;

            const startRowNum = excelRow.number;
            worksheet.mergeCells(startRowNum, 1, startRowNum, enhancedColumnDefs.length);

            const cell = excelRow.getCell(1);
            cell.value = `GANG: ${row.gang_code}`;
            cell.font = { bold: true, size: 11, color: { argb: '1B5E20' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: COLORS.gangHeader }
            };
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
            cell.border = {
                top: { style: 'medium', color: { argb: COLORS.borderDark } },
                bottom: { style: 'medium', color: { argb: COLORS.borderDark } }
            };
        } else {
            // Data row (employee or gang_total)
            const rowData = enhancedColumnDefs.map((col) => formatPayrollExportCellValue(row, col, exportVariant));

            const excelRow = worksheet.addRow(rowData);
            excelRow.height = 22;

            // Apply cell styles
            enhancedColumnDefs.forEach((col, idx) => {
                const cell = excelRow.getCell(idx + 1);
                const colColor = getColumnColor(col.field);
                const totalStyle = getTotalColumnStyle(col.field);

                // Base styling
                cell.alignment = {
                    horizontal: col.className?.includes('text-right') ? 'right' :
                        col.className?.includes('text-center') ? 'center' : 'left',
                    vertical: 'middle'
                };
                cell.font = { size: 10 };
                cell.border = {
                    top: { style: 'thin', color: { argb: COLORS.border } },
                    bottom: { style: 'thin', color: { argb: COLORS.border } },
                    left: { style: 'thin', color: { argb: COLORS.border } },
                    right: { style: 'thin', color: { argb: COLORS.border } }
                };

                // Number format for numeric cells
                if (typeof cell.value === 'number') {
                    cell.numFmt = '#,##0';
                }

                // Apply column background color
                if (totalStyle) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: totalStyle.fill }
                    };
                    cell.font = { size: 10, bold: totalStyle.bold, color: { argb: totalStyle.font } };
                } else if (colColor) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: colColor }
                    };
                }

                // Gang total row special styling
                if (row.type === 'gang_total') {
                    cell.font = { ...cell.font, bold: true };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: COLORS.gangTotal }
                    };
                }
            });
        }
    });

    // === GRAND TOTAL ROW ===
    if (grandTotal) {
        const employeeCount = rows.filter((row) => row?.type === 'employee').length;
        const gtRowData = enhancedColumnDefs.map((col) => {
            if (col.field === 'nama') return 'GRAND TOTAL';
            if (col.field === 'no') return '';
            if (col.field === 'emp_code') return `${employeeCount} KARYAWAN`;

            let val = grandTotal[col.field];
            if (isPayrollTotalDisplayOnlyField(col.field)) {
                return '-';
            }
            if (isPayrollNumericField(col.field)) {
                const numericValue = resolveGrandTotalNumericValue({
                    grandTotal,
                    rows,
                    field: col.field
                });
                return formatPayrollExportNumber(col.field, numericValue);
            }

            if (val !== undefined && val !== null && val !== '') return val;
            return '-';
        });

        const gtRow = worksheet.addRow(gtRowData);
        gtRow.height = 28;

        enhancedColumnDefs.forEach((col, idx) => {
            const cell = gtRow.getCell(idx + 1);
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: COLORS.grandTotal }
            };
            cell.font = { bold: true, size: 11, color: { argb: COLORS.grandTotalText } };
            cell.alignment = {
                horizontal: col.className?.includes('text-right') ? 'right' :
                    col.className?.includes('text-center') ? 'center' : 'left',
                vertical: 'middle'
            };
            cell.border = {
                top: { style: 'medium', color: { argb: '0d1b2a' } },
                bottom: { style: 'medium', color: { argb: '0d1b2a' } },
                left: { style: 'thin', color: { argb: '2d4a6f' } },
                right: { style: 'thin', color: { argb: '2d4a6f' } }
            };

            if (typeof cell.value === 'number') {
                cell.numFmt = '#,##0';
            }
        });
    }

    // === SIGNATURE BLOCK ===
    const signatureStartRow = worksheet.rowCount + 3;
    const signerColumns = [
        2,
        Math.max(4, Math.floor(enhancedColumnDefs.length * 0.35)),
        Math.max(6, Math.floor(enhancedColumnDefs.length * 0.65)),
        Math.max(8, enhancedColumnDefs.length - 1)
    ].filter((col, idx, arr) => col <= enhancedColumnDefs.length && arr.indexOf(col) === idx);
    const signatureLabels = ['Dibuat Oleh,', 'Diperiksa Oleh,', 'Diketahui Oleh,', 'Disetujui Oleh,'];
    const signatureRoles = ['Admin Payroll', 'HR Manager', 'Senior Manager', 'General Manager'];
    signerColumns.forEach((col, idx) => {
        const titleCell = worksheet.getCell(signatureStartRow, col);
        titleCell.value = signatureLabels[idx] || 'Disetujui Oleh,';
        titleCell.font = { bold: true, size: 10 };
        titleCell.alignment = { horizontal: 'center' };

        const nameCell = worksheet.getCell(signatureStartRow + 5, col);
        nameCell.value = '( ...................................... )';
        nameCell.alignment = { horizontal: 'center' };

        const roleCell = worksheet.getCell(signatureStartRow + 6, col);
        roleCell.value = signatureRoles[idx] || '';
        roleCell.font = { italic: true, size: 9, color: { argb: '64748B' } };
        roleCell.alignment = { horizontal: 'center' };
    });

    // === FREEZE PANES ===
    worksheet.views = [{
        state: 'frozen',
        xSplit: 2, // Freeze first 2 columns (NO, NAMA)
        ySplit: headerStartRow + 3, // Freeze header rows
        topLeftCell: 'C' + (headerStartRow + 4),
        activeCell: 'C' + (headerStartRow + 4)
    }];

    // === GENERATE FILE ===
    const sourceModeToken = String(meta?.valuePriorityMode || 'non_db_ptrj').trim().toLowerCase() || 'non_db_ptrj';
    const variantToken = EXPORT_VARIANT_LABELS[exportVariant] || EXPORT_VARIANT_LABELS.detail;
    const fileName = `Daftar_Upah_${variantToken}_${meta.division}_${meta.gangCode === 'ALL' ? 'AllGang' : meta.gangCode}_${meta.year}${String(meta.month).padStart(2, '0')}_SRC-${sourceModeToken}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, fileName);

    // Memory Cleaner Frontend: Hapus referensi dari sheet dan workbook yang memakan banyak memori Chrome
    worksheet.spliceRows(1, worksheet.rowCount);
    workbook.removeWorksheet(worksheet.id);
    // @ts-ignore
    workbook = null;

    return fileName;
}

function addPayrollWorkbookWorksheet(workbook, sheetModel, meta, context) {
    const enhancedColumnDefs = sheetModel.columns;
    const variantLabel = sheetModel.variantLabel;
    const sheetName = sheetModel.sheetName;

    const worksheet = workbook.addWorksheet(sheetName.substring(0, 31), {
        pageSetup: {
            paperSize: 9,
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0
        }
    });

    const titleRow = worksheet.addRow([`DAFTAR UPAH KARYAWAN ${variantLabel} - ${meta.division} - ${context.periodStr}`]);
    titleRow.height = 34;
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: 'FFFFFF' } };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F2937' } };
    worksheet.mergeCells(1, 1, 1, enhancedColumnDefs.length);
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    const gangLabel = meta.gangCode === 'ALL' ? 'Semua Gang' : `Gang: ${meta.gangCode}`;
    const subTitleRow = worksheet.addRow([`${gangLabel} | Format: ${variantLabel} | Sumber Nilai: ${context.sourceModeLabel}`]);
    subTitleRow.height = 22;
    subTitleRow.getCell(1).font = { size: 11, italic: true, color: { argb: '334155' } };
    subTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };
    worksheet.mergeCells(2, 1, 2, enhancedColumnDefs.length);
    subTitleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.addRow([]);

    const headerStartRow = 4;
    const headerMerges = buildHeaderMerges(enhancedColumnDefs);
    for (let i = 0; i < 4; i++) {
        const row = worksheet.addRow(Array(enhancedColumnDefs.length).fill(''));
        row.height = 22;
    }

    headerMerges.forEach((merge) => {
        const excelRow = headerStartRow + merge.row - 1;
        const excelCol = merge.col;
        const cell = worksheet.getCell(excelRow, excelCol);
        const headerStyle = getHeaderGroupStyle(merge.label);
        cell.value = merge.label;
        cell.font = { bold: true, size: 10, color: { argb: headerStyle.font } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: headerStyle.fill }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: COLORS.border } },
            bottom: { style: 'thin', color: { argb: COLORS.border } },
            left: { style: 'thin', color: { argb: COLORS.border } },
            right: { style: 'thin', color: { argb: COLORS.border } }
        };

        if (merge.rowSpan > 1 || merge.colSpan > 1) {
            worksheet.mergeCells(
                excelRow,
                excelCol,
                excelRow + merge.rowSpan - 1,
                excelCol + merge.colSpan - 1
            );
        }
    });

    enhancedColumnDefs.forEach((col, idx) => {
        worksheet.getColumn(idx + 1).width = Math.max(col.w / 7, 8);
    });
    worksheet.autoFilter = {
        from: { row: headerStartRow + 3, column: 1 },
        to: { row: headerStartRow + 3, column: enhancedColumnDefs.length }
    };
    worksheet.properties.defaultRowHeight = 20;
    worksheet.pageSetup = {
        ...worksheet.pageSetup,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true
    };

    sheetModel.rows.forEach((rowModel) => {
        const row = rowModel.sourceRow || {};
        if (row.type === 'gang_header') {
            const excelRow = worksheet.addRow(Array(enhancedColumnDefs.length).fill(''));
            excelRow.height = 24;
            worksheet.mergeCells(excelRow.number, 1, excelRow.number, enhancedColumnDefs.length);

            const cell = excelRow.getCell(1);
            cell.value = `GANG: ${row.gang_code}`;
            cell.font = { bold: true, size: 11, color: { argb: '285C4D' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: COLORS.gangHeader }
            };
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
            cell.border = {
                top: { style: 'medium', color: { argb: COLORS.borderDark } },
                bottom: { style: 'medium', color: { argb: COLORS.borderDark } }
            };
            return;
        }

        const rowData = enhancedColumnDefs.map((col) => rowModel.valuesByField[col.field] ?? '-');
        const excelRow = worksheet.addRow(rowData);
        excelRow.height = 22;

        enhancedColumnDefs.forEach((col, idx) => {
            const cell = excelRow.getCell(idx + 1);
            const colColor = getColumnColor(col.field);
            const totalStyle = getTotalColumnStyle(col.field);

            cell.alignment = {
                horizontal: col.className?.includes('text-right') ? 'right' :
                    col.className?.includes('text-center') ? 'center' : 'left',
                vertical: 'middle'
            };
            cell.font = { size: 10 };
            cell.border = {
                top: { style: 'thin', color: { argb: COLORS.border } },
                bottom: { style: 'thin', color: { argb: COLORS.border } },
                left: { style: 'thin', color: { argb: COLORS.border } },
                right: { style: 'thin', color: { argb: COLORS.border } }
            };

            if (typeof cell.value === 'number' || cell.value?.formula) {
                cell.numFmt = '#,##0';
            }

            if (totalStyle) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: totalStyle.fill }
                };
                cell.font = { size: 10, bold: totalStyle.bold, color: { argb: totalStyle.font } };
            } else if (colColor) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: colColor }
                };
            }

            if (row.type === 'gang_total') {
                cell.font = { ...cell.font, bold: true };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: COLORS.gangTotal }
                };
            }
        });
    });

    if (sheetModel.grandTotalRow) {
        const gtRowData = enhancedColumnDefs.map((col) => sheetModel.grandTotalRow.valuesByField[col.field] ?? '-');
        const gtRow = worksheet.addRow(gtRowData);
        gtRow.height = 28;

        enhancedColumnDefs.forEach((col, idx) => {
            const cell = gtRow.getCell(idx + 1);
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: COLORS.grandTotal }
            };
            cell.font = { bold: true, size: 11, color: { argb: COLORS.grandTotalText } };
            cell.alignment = {
                horizontal: col.className?.includes('text-right') ? 'right' :
                    col.className?.includes('text-center') ? 'center' : 'left',
                vertical: 'middle'
            };
            cell.border = {
                top: { style: 'medium', color: { argb: '0d1b2a' } },
                bottom: { style: 'medium', color: { argb: '0d1b2a' } },
                left: { style: 'thin', color: { argb: '2d4a6f' } },
                right: { style: 'thin', color: { argb: '2d4a6f' } }
            };
            if (typeof cell.value === 'number' || cell.value?.formula) {
                cell.numFmt = '#,##0';
            }
        });
    }

    const signatureStartRow = worksheet.rowCount + 3;
    const signerColumns = [
        2,
        Math.max(4, Math.floor(enhancedColumnDefs.length * 0.35)),
        Math.max(6, Math.floor(enhancedColumnDefs.length * 0.65)),
        Math.max(8, enhancedColumnDefs.length - 1)
    ].filter((col, idx, arr) => col <= enhancedColumnDefs.length && arr.indexOf(col) === idx);
    const signatureLabels = ['Dibuat Oleh,', 'Diperiksa Oleh,', 'Diketahui Oleh,', 'Disetujui Oleh,'];
    const signatureRoles = ['Admin Payroll', 'HR Manager', 'Senior Manager', 'General Manager'];
    signerColumns.forEach((col, idx) => {
        const titleCell = worksheet.getCell(signatureStartRow, col);
        titleCell.value = signatureLabels[idx] || 'Disetujui Oleh,';
        titleCell.font = { bold: true, size: 10 };
        titleCell.alignment = { horizontal: 'center' };

        const nameCell = worksheet.getCell(signatureStartRow + 5, col);
        nameCell.value = '( ...................................... )';
        nameCell.alignment = { horizontal: 'center' };

        const roleCell = worksheet.getCell(signatureStartRow + 6, col);
        roleCell.value = signatureRoles[idx] || '';
        roleCell.font = { italic: true, size: 9, color: { argb: '64748B' } };
        roleCell.alignment = { horizontal: 'center' };
    });

    worksheet.views = [{
        state: 'frozen',
        xSplit: 2,
        ySplit: headerStartRow + 3,
        topLeftCell: 'C' + (headerStartRow + 4),
        activeCell: 'C' + (headerStartRow + 4)
    }];

    return worksheet;
}

export async function exportPayrollToExcel(rows, columnDefs, grandTotal, meta) {
    let workbook = new ExcelJS.Workbook();
    workbook.creator = 'PT Rebinmas Jaya - Payroll System';
    workbook.created = new Date();

    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const periodStr = `${monthNames[meta.month - 1]} ${meta.year}`;
    const sourceModeLabel = resolveValuePriorityModeLabel(meta?.valuePriorityMode);
    const context = { periodStr, sourceModeLabel };
    const sheetModels = buildPayrollWorkbookSheetModels(rows, columnDefs, grandTotal, meta);

    sheetModels.forEach((sheetModel) => {
        assertPayrollExportUiParity(sheetModel, rows);
        addPayrollWorkbookWorksheet(workbook, sheetModel, meta, context);
    });

    const sourceModeToken = String(meta?.valuePriorityMode || 'non_db_ptrj').trim().toLowerCase() || 'non_db_ptrj';
    const fileName = `Daftar_Upah_${meta.division}_${meta.gangCode === 'ALL' ? 'AllGang' : meta.gangCode}_${meta.year}${String(meta.month).padStart(2, '0')}_SRC-${sourceModeToken}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, fileName);

    workbook.worksheets.slice().forEach((worksheet) => {
        worksheet.spliceRows(1, worksheet.rowCount);
        workbook.removeWorksheet(worksheet.id);
    });
    // @ts-ignore
    workbook = null;

    return fileName;
}

export default exportPayrollToExcel;
