import ExcelJS from 'exceljs';
import { ManualAdjustmentService } from './manualAdjustmentService';
import { premiumDefinitionService } from './premiumDefinitionService';

export interface PremiumImportRow {
    empcode: string;
    gang_code: string;
    subblok: string;
    jumlah: number;
    jenis: string;
    record_action: PremiumImportRecordAction | null;
    row_number: number;
}

export interface PremiumImportResult {
    success: boolean;
    imported: number;
    skipped: number;
    errors: string[];
    details: { empcode: string; jenis: string; totalAmount: number; itemCount: number }[];
}

const ALLOWED_JENIS = ['PREMI PRUNING', 'PREMI RAKING'];

type PremiumImportRecordAction = 'NEW' | 'ADD';

type PremiumImportGroup = {
    empcode: string;
    jenis: string;
    gang_code: string;
    items: { subblok: string; gang_code: string; jumlah: number }[];
    force_insert: boolean;
};

function normalizeJenis(value: string): string {
    const cleaned = String(value || '').toUpperCase().trim();
    if (cleaned === 'PRUNING' || cleaned === 'PREMI PRUNING') return 'PREMI PRUNING';
    if (cleaned === 'RAKING' || cleaned === 'CIRCLE RAKING' || cleaned === 'PREMI RAKING') return 'PREMI RAKING';
    return cleaned;
}

function normalizeRecordAction(value: unknown): PremiumImportRecordAction | null {
    const cleaned = String(value || '').toUpperCase().trim();
    if (!cleaned) return null;
    if (['NEW', 'N', 'BARU'].includes(cleaned)) return 'NEW';
    if (['ADD', 'A', 'TAMBAH', 'LANJUT', 'CONTINUE', 'CONTINUATION'].includes(cleaned)) return 'ADD';
    throw new Error(`Aksi "${value}" tidak dikenal. Pakai NEW atau ADD.`);
}

export async function importPremiumExcel(
    buffer: Buffer,
    periodMonth: number,
    periodYear: number,
    divisionCode: string,
    manualAdjustmentService: ManualAdjustmentService
): Promise<PremiumImportResult> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        return { success: false, imported: 0, skipped: 0, errors: ['File Excel kosong atau tidak memiliki worksheet.'], details: [] };
    }

    const groups: PremiumImportGroup[] = [];
    const seenRecordKeys = new Set<string>();
    let activeGroup: PremiumImportGroup | null = null;
    const errors: string[] = [];

    const startGroup = (row: PremiumImportRow): PremiumImportGroup => {
        const key = `${row.empcode}||${row.jenis}`;
        const group: PremiumImportGroup = {
            empcode: row.empcode,
            jenis: row.jenis,
            gang_code: row.gang_code,
            items: [],
            force_insert: seenRecordKeys.has(key)
        };
        seenRecordKeys.add(key);
        groups.push(group);
        activeGroup = group;
        return group;
    };

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row
        const values = row.values as any[];
        const rawEmpcode = String(values[1] || '').trim();
        const rawGangCode = String(values[2] || '').trim();
        const subblok = String(values[3] || '').trim();
        const jumlah = parseFloat(values[4]) || 0;
        const rawJenis = normalizeJenis(values[5]);

        if (!rawEmpcode && !rawGangCode && !subblok && !values[4] && !rawJenis && !values[6]) {
            return;
        }

        let recordAction: PremiumImportRecordAction | null = null;
        try {
            recordAction = normalizeRecordAction(values[6]);
        } catch (e: any) {
            errors.push(`Baris ${rowNumber}: ${e.message || String(e)}`);
            return;
        }

        if (!rawEmpcode && (!activeGroup || recordAction === 'NEW')) {
            errors.push(`Baris ${rowNumber}: Empcode kosong untuk record baru, dilewati.`);
            return;
        }
        const empcode = rawEmpcode || activeGroup!.empcode;
        const gangCode = rawGangCode || activeGroup?.gang_code || '';
        const jenis = rawJenis || activeGroup?.jenis || '';

        if (!subblok) {
            errors.push(`Baris ${rowNumber}: Subblok kosong untuk ${empcode}, dilewati.`);
            return;
        }
        if (jumlah <= 0) {
            errors.push(`Baris ${rowNumber}: Jumlah tidak valid untuk ${empcode}, dilewati.`);
            return;
        }
        if (!ALLOWED_JENIS.includes(jenis)) {
            errors.push(`Baris ${rowNumber}: Jenis "${jenis}" tidak diizinkan. Hanya PREMI PRUNING dan PREMI RAKING.`);
            return;
        }

        const parsedRow: PremiumImportRow = {
            empcode,
            gang_code: gangCode,
            subblok,
            jumlah,
            jenis,
            record_action: recordAction,
            row_number: rowNumber
        };

        let targetGroup: PremiumImportGroup;
        if (recordAction === 'ADD') {
            if (!activeGroup) {
                errors.push(`Baris ${rowNumber}: ADD tidak punya record aktif sebelumnya.`);
                return;
            }
            if (rawEmpcode && rawEmpcode !== activeGroup.empcode) {
                errors.push(`Baris ${rowNumber}: ADD tidak boleh mengganti empcode dari ${activeGroup.empcode} ke ${rawEmpcode}. Gunakan NEW.`);
                return;
            }
            if (rawJenis && rawJenis !== activeGroup.jenis) {
                errors.push(`Baris ${rowNumber}: ADD tidak boleh mengganti jenis dari ${activeGroup.jenis} ke ${rawJenis}. Gunakan NEW.`);
                return;
            }
            targetGroup = activeGroup;
        } else if (recordAction === 'NEW') {
            targetGroup = startGroup(parsedRow);
        } else if (activeGroup && activeGroup.empcode === empcode && activeGroup.jenis === jenis) {
            targetGroup = activeGroup;
        } else {
            targetGroup = startGroup(parsedRow);
        }

        targetGroup.items.push({ subblok: parsedRow.subblok, gang_code: parsedRow.gang_code, jumlah: parsedRow.jumlah });
    });

    if (groups.length === 0) {
        return { success: false, imported: 0, skipped: 0, errors: ['Tidak ada baris valid untuk diimport.', ...errors], details: [] };
    }

    const definitions = premiumDefinitionService.getActiveDefinitions();
    let imported = 0;
    let skipped = 0;
    const details: { empcode: string; jenis: string; totalAmount: number; itemCount: number }[] = [];

    for (const group of groups) {
        const empcode = group.empcode;
        const def = definitions.find((d) => d.adjustment_name === group.jenis);
        if (!def) {
            errors.push(`${empcode}: Definisi untuk "${group.jenis}" tidak ditemukan.`);
            skipped++;
            continue;
        }

        const totalAmount = group.items.reduce((sum, item) => sum + item.jumlah, 0);
        const metadataJson = {
            input_type: 'blok',
            items: group.items.map((item) => ({
                subblok: item.subblok,
                gang_code: item.gang_code,
                jumlah: item.jumlah
            })),
            total_amount: totalAmount
        };

        try {
            await manualAdjustmentService.saveAdjustment({
                period_month: periodMonth,
                period_year: periodYear,
                emp_code: empcode,
                nik: empcode,
                gang_code: group.gang_code,
                division_code: divisionCode,
                adjustment_type: 'PREMI',
                adjustment_name: group.jenis,
                amount: totalAmount,
                ad_code: def.ad_code,
                task_desc: def.task_desc,
                remarks: `${group.jenis} | ${def.ad_code} | ${totalAmount} | sync:MANUAL | match:MANUAL | IMPORT_EXCEL`,
                metadata_json: JSON.stringify(metadataJson),
                force_insert: group.force_insert
            });
            imported++;
            details.push({ empcode, jenis: group.jenis, totalAmount, itemCount: group.items.length });
        } catch (e: any) {
            errors.push(`${empcode}: Gagal menyimpan — ${e.message || String(e)}`);
            skipped++;
        }
    }

    return { success: imported > 0, imported, skipped, errors, details };
}
