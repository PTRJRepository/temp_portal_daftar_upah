import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

// Professional Color Palette
const COLORS = {
    // Elegant dark blue for headers
    headerBg: '0f172a',
    headerText: 'FFFFFF',

    // Column groups (subtle professional tints)
    absensi: 'f8fafc',
    upahDasar: 'f1f5f9',
    tunjangan: 'fdf8f6',
    premi: 'f0fdf4',
    potongan: 'fef2f2',

    // Totals
    gangHeader: 'e2e8f0',
    gangTotal: 'f1f5f9',
    grandTotal: '0f172a',
    grandTotalText: 'FFFFFF',

    border: 'cbd5e1',
    borderDark: '64748b'
};

const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    return isNaN(n) ? '-' : Math.round(n);
};

function getColumnColor(field) {
    if (!field) return null;
    if (field.includes('hari_kerja') || field.includes('cuti') || field === 'jumlah_hk') return COLORS.absensi;
    if (field.includes('upah_dasar') || field.includes('gaji_pokok') || field === 'upah_pokok') return COLORS.upahDasar;
    if (field.startsWith('beras_') || field.startsWith('jabatan_') || field.startsWith('masa_kerja_') || field.startsWith('lembur_') || field === 'total_tunjangan') return COLORS.tunjangan;
    if (field.startsWith('premi') || field === 'total_premi') return COLORS.premi;
    if (field.startsWith('pot_') || field.includes('potongan')) return COLORS.potongan;
    return null;
}

// Helper to get Excel column letter (A, B, C... AA, AB...)
function getColLetter(colIndex) {
    let temp, letter = '';
    while (colIndex > 0) {
        temp = (colIndex - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = (colIndex - temp - 1) / 26;
    }
    return letter;
}

// Flatten hierarchical columns to get the actual data columns
function getFlattenedColumns(colDefs) {
    let flatCols = [];
    colDefs.forEach(col => {
        if (col.children && col.children.length > 0) {
            flatCols = flatCols.concat(getFlattenedColumns(col.children));
        } else {
            flatCols.push(col);
        }
    });
    return flatCols;
}

/**
 * Export Payroll Data to Excel with Formulas and Signatures
 */
export async function exportReportToExcelPro(rows, colDefsOriginal, meta) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PT Rebinmas Jaya';
    workbook.created = new Date();

    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const periodStr = `${monthNames[meta.month - 1]} ${meta.year}`;
    const sheetName = `Upah ${meta.division} ${meta.gangCode}`.substring(0, 31);

    const worksheet = workbook.addWorksheet(sheetName, {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    // Build fully detailed columns tailored for Daftar Upah export
    const buildExportColumns = (rows) => {
        const hasData = (field) => rows.some(r => r[field] !== null && r[field] !== undefined && r[field] !== '' && r[field] !== 0);

        const cols = [
            { field: 'EMP_CODE', headerName: 'EMP CODE', width: 12 },
            { field: 'nik', headerName: 'NIK', width: 18 },
            { field: 'nama', headerName: 'NAMA KARYAWAN', width: 28 },
            { field: 'jenis_kelamin', headerName: 'L/P', width: 6 },
            { field: 'join_date', headerName: 'TGL MASUK', width: 15 }, // Fallback if available
            { field: 'status_ptkp', headerName: 'PTKP', width: 8 },
            { field: 'jabatan_estate', headerName: 'JABATAN', width: 15 },
            { field: 'alamat', headerName: 'ALAMAT', width: 30 },
        ];

        // Kehadiran (Absensi)
        cols.push({ field: 'hari_kerja', headerName: 'HK', width: 6 });
        cols.push({ field: 'cuti_tahunan_hari', headerName: 'CUTI', width: 6 });
        cols.push({ field: 'cuti_sakit_haid_hari', headerName: 'S/H', width: 6 });
        cols.push({ field: 'cuti_minggu_hari', headerName: 'M', width: 6 });
        cols.push({ field: 'cuti_nasional_hari', headerName: 'N', width: 6 });
        cols.push({ field: 'izin_hari', headerName: 'IZIN', width: 6 });
        cols.push({ field: 'tidak_hadir_alpa', headerName: 'ALPA', width: 6 });
        cols.push({ field: 'jumlah_hk', headerName: 'JML HK', width: 8 });
        cols.push({ field: 'total_jam_kerja', headerName: 'TOTAL JAM', width: 12 });

        // Pendapatan & Upah Dasar
        cols.push({ field: 'upah_dasar', headerName: 'UPAH DASAR (BULANAN)', width: 18, isNumeric: true });
        cols.push({ field: 'gaji_pokok_ideal', headerName: 'UMP/UMK', width: 15, isNumeric: true });
        cols.push({ field: 'gaji_pokok', headerName: 'UPAH POKOK', width: 15, isNumeric: true });

        // Tunjangan (Detail Rate dan Jumlah)
        cols.push({ field: 'beras_rate', headerName: 'RATE BERAS', width: 12, isNumeric: true });
        cols.push({ field: 'beras_jumlah', headerName: 'TUNJ BERAS', width: 12, isNumeric: true });
        cols.push({ field: 'jabatan_rate', headerName: 'RATE JABATAN', width: 12, isNumeric: true });
        cols.push({ field: 'jabatan_jumlah', headerName: 'TUNJ JABATAN', width: 12, isNumeric: true });
        cols.push({ field: 'masa_kerja_tahun', headerName: 'LAMA MK', width: 8 });
        cols.push({ field: 'masa_kerja_jumlah', headerName: 'TUNJ MK', width: 12, isNumeric: true });
        cols.push({ field: 'lembur_jam', headerName: 'JAM LEMBUR', width: 10, isNumeric: true });
        cols.push({ field: 'lembur_jumlah', headerName: 'UANG LEMBUR', width: 15, isNumeric: true });

        // Premi - Find all dynamic keys securely
        cols.push({ field: 'premi_brondol', headerName: 'PREMI BRONDOL', width: 12, isNumeric: true });

        let dynamicPremiKeys = [];
        rows.forEach(r => {
            if (r.premi && typeof r.premi === 'object') {
                Object.keys(r.premi).forEach(k => { if (!dynamicPremiKeys.includes(k)) dynamicPremiKeys.push(k); });
            }
            Object.keys(r).forEach(k => {
                if (k.startsWith('premi_') && k !== 'premi_brondol' && k !== 'premi_pph' && !dynamicPremiKeys.includes(k)) dynamicPremiKeys.push(k);
            });
        });

        dynamicPremiKeys.forEach(k => {
            const displayName = k.replace('premi_', '').replace(/_/g, ' ').toUpperCase();
            cols.push({ field: k, headerName: `PREMI ${displayName}`, width: 15, isNumeric: true, resolveNested: 'premi' });
        });

        cols.push({ field: 'total_premi', headerName: 'TOTAL PREMI', width: 15, isNumeric: true });

        // Upah Kotor & Koreksi
        cols.push({ field: 'pot_koreksi', headerName: 'KOREKSI (-)', width: 12, isNumeric: true });
        cols.push({ field: 'jumlah_upah_kotor', headerName: 'UPAH KOTOR', width: 16, isNumeric: true });

        // Potongan Bersih
        cols.push({ field: 'pot_astek', headerName: 'ASTEK (PEKERJA)', width: 14, isNumeric: true });
        cols.push({ field: 'pot_astek_maj', headerName: 'ASTEK (MAJIKAN)', width: 14, isNumeric: true });
        cols.push({ field: 'pot_bpjs_kesehatan_pekerja', headerName: 'BPJS KES (PEKERJA)', width: 14, isNumeric: true });
        cols.push({ field: 'pot_bpjs_kesehatan_majikan', headerName: 'BPJS KES (MAJIKAN)', width: 14, isNumeric: true });
        cols.push({ field: 'pot_bpjs_pensiun_pekerja', headerName: 'BPJS PEN (PEKERJA)', width: 14, isNumeric: true });
        cols.push({ field: 'pot_bpjs_pensiun_majikan', headerName: 'BPJS PEN (MAJIKAN)', width: 14, isNumeric: true });
        cols.push({ field: 'pot_spsi', headerName: 'IURAN SPSI', width: 12, isNumeric: true });
        cols.push({ field: 'pot_pph21', headerName: 'POTONGAN PPH21 (-)', width: 15, isNumeric: true });
        cols.push({ field: 'premi_pph', headerName: 'PREMI PPH (+)', width: 12, isNumeric: true });

        // Dynamic Potongan Bersih
        let dynamicPotKeys = [];
        rows.forEach(r => {
            if (r.potongan_upah_bersih && r.potongan_upah_bersih.dynamic) {
                Object.keys(r.potongan_upah_bersih.dynamic).forEach(k => { if (!dynamicPotKeys.includes(k)) dynamicPotKeys.push(k); });
            }
            Object.keys(r).forEach(k => {
                if ((k.startsWith('pot_') || k.startsWith('POTONGAN_')) && !['pot_astek', 'pot_astek_maj', 'pot_bpjs_kesehatan_majikan', 'pot_bpjs_kesehatan_pekerja', 'pot_bpjs_pensiun_majikan', 'pot_bpjs_pensiun_pekerja', 'pot_spsi', 'pot_pph21', 'pot_koreksi'].includes(k) && !dynamicPotKeys.includes(k)) dynamicPotKeys.push(k);
            });
        });

        dynamicPotKeys.forEach(k => {
            const displayName = k.replace('pot_', '').replace(/_/g, ' ').toUpperCase();
            cols.push({ field: k, headerName: `POT ${displayName}`, width: 15, isNumeric: true, resolveNested: 'potongan_upah_bersih.dynamic' });
        });

        cols.push({ field: 'total_potongan', headerName: 'TOTAL POTONGAN', width: 16, isNumeric: true });

        // Upah Bersih Akhir
        cols.push({ field: 'upah_bersih', headerName: 'UPAH BERSIH', width: 18, isNumeric: true });

        // === ENSURE ALL FIELDS FROM ROWS ARE INCLUDED ===
        // Detect all unique fields from employee rows
        const allFieldsInData = new Set();
        rows.forEach(r => {
            if (!r.isHeader && !r.isTotal && r.type !== 'gang_header' && r.type !== 'gang_total') {
                Object.keys(r).forEach(key => {
                    if (!key.startsWith('_') && key !== 'type' && key !== 'id' && key !== 'isHeader' && key !== 'isTotal') {
                        allFieldsInData.add(key);
                    }
                });
            }
        });

        // Get fields already in cols
        const fieldsAlreadyIncluded = new Set(cols.map(c => c.field));

        // Add missing fields with generic header
        const missingFields = [...allFieldsInData].filter(f => !fieldsAlreadyIncluded.has(f));
        missingFields.forEach(field => {
            const displayName = field.replace(/_/g, ' ').toUpperCase();
            cols.push({
                field,
                headerName: displayName,
                width: 12,
                isNumeric: true
            });
        });

        console.log(`[ExportPro] Added ${missingFields.length} missing fields:`, missingFields);

        return cols.filter(c => {
            // Include column if it has ANY value (including 0) OR is in mandatory list
            const hasAnyValue = rows.some(r => r[c.field] !== null && r[c.field] !== undefined);
            const isMandatory = ['EMP_CODE', 'nik', 'nama', 'jabatan_estate', 'upah_dasar', 'gaji_pokok', 'upah_bersih'].includes(c.field);
            return hasAnyValue || isMandatory;
        });
    };

    const flatCols = buildExportColumns(rows);

    // 1. Report Title
    const titleRow = worksheet.addRow([`DAFTAR UPAH KARYAWAN - ${meta.division}`]);
    titleRow.height = 30;
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: '0f172a' } };
    worksheet.mergeCells(1, 1, 1, flatCols.length);
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    const gangLabel = meta.gangCode === 'ALL' ? 'Semua Gang' : `Gang: ${meta.gangCode}`;
    const subTitleRow = worksheet.addRow([`Periode: ${periodStr} | ${gangLabel}`]);
    subTitleRow.height = 20;
    subTitleRow.getCell(1).font = { size: 12, italic: true, color: { argb: '475569' } };
    worksheet.mergeCells(2, 1, 2, flatCols.length);
    subTitleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    worksheet.addRow([]); // Blank row

    // 2. Headers
    const headerRow = worksheet.addRow(flatCols.map(c => c.headerName || c.field));
    headerRow.height = 45;

    // Helper map for col field to index
    const getColMapping = () => {
        let map = {};
        flatCols.forEach((c, i) => { map[c.field] = getColLetter(i + 1); });
        return map;
    };
    const colMap = getColMapping();

    flatCols.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.font = { bold: true, size: 10, color: { argb: COLORS.headerText } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'medium', color: { argb: COLORS.borderDark } },
            bottom: { style: 'medium', color: { argb: COLORS.borderDark } },
            left: { style: 'thin', color: { argb: COLORS.border } },
            right: { style: 'thin', color: { argb: COLORS.border } }
        };
        worksheet.getColumn(idx + 1).width = col.width || 12;
    });

    const gangTotalRowIndices = [];
    let currentGangStartRow = -1;

    // Secure nested value resolver
    const resolveValue = (row, field, resolveNested) => {
        if (!row) return 0;
        let val = row[field];
        if (val !== undefined && val !== null) return val;

        if (field === 'nik') return row.new_nik || row.nik || '';
        if (['EMP_CODE'].includes(field) && row.emp_code) return row.emp_code;
        if (field === 'join_date' && row.tanggal_masuk) return row.tanggal_masuk;

        if (resolveNested) {
            const parts = resolveNested.split('.');
            let obj = row;
            for (const p of parts) {
                if (!obj || typeof obj !== 'object') return 0;
                obj = obj[p];
            }
            if (obj && obj[field] !== undefined) return obj[field];
        }

        if (field.includes('.')) {
            const parts = field.split('.');
            let obj = row;
            for (const p of parts) {
                if (!obj || typeof obj !== 'object') return 0;
                obj = obj[p];
            }
            return obj || 0;
        }

        return '';
    };

    // 3. Data Rows
    rows.forEach((row) => {
        if (row.isHeader || row.type === 'gang_header') {
            const excelRow = worksheet.addRow(Array(flatCols.length).fill(''));
            excelRow.height = 24;
            worksheet.mergeCells(excelRow.number, 1, excelRow.number, flatCols.length);

            const cell = excelRow.getCell(1);
            cell.value = `DATA GANG: ${row.gang_code}`;
            cell.font = { bold: true, size: 11, color: { argb: '0f172a' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gangHeader } };
            cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
            cell.border = {
                top: { style: 'thin', color: { argb: COLORS.borderDark } },
                bottom: { style: 'thin', color: { argb: COLORS.borderDark } }
            };

            currentGangStartRow = excelRow.number + 1;

        } else if (row.isTotal || row.type === 'gang_total') {
            const excelRow = worksheet.addRow(flatCols.map(() => ''));
            excelRow.height = 25;
            gangTotalRowIndices.push(excelRow.number);

            flatCols.forEach((col, idx) => {
                const cell = excelRow.getCell(idx + 1);

                cell.font = { bold: true, size: 10, color: { argb: '0f172a' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gangTotal } };
                cell.border = {
                    top: { style: 'medium', color: { argb: COLORS.borderDark } },
                    bottom: { style: 'thin', color: { argb: COLORS.borderDark } },
                    left: { style: 'thin', color: { argb: COLORS.border } },
                    right: { style: 'thin', color: { argb: COLORS.border } }
                };

                if (col.field === 'nama') {
                    cell.value = row.nama || `TOTAL GANG ${row.gang_code || ''}`;
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                } else if (col.isNumeric && currentGangStartRow !== -1 && currentGangStartRow < excelRow.number) {
                    const letter = getColLetter(idx + 1);
                    cell.value = { formula: `SUM(${letter}${currentGangStartRow}:${letter}${excelRow.number - 1})` };
                    cell.numFmt = '#,##0';
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                }
            });
            currentGangStartRow = -1;

        } else {
            const excelRow = worksheet.addRow(Array(flatCols.length).fill(''));
            excelRow.height = 20;

            flatCols.forEach((col, idx) => {
                const cell = excelRow.getCell(idx + 1);
                const colColor = getColumnColor(col.field);

                let val = resolveValue(row, col.field, col.resolveNested);
                // Type safety
                if (col.isNumeric && typeof val !== 'number') {
                    const parsed = Number(val);
                    val = isNaN(parsed) ? 0 : parsed;
                }
                if (col.field === 'pot_koreksi') {
                    // Signed deduction invariant: write -amount, then formulas add the cell.
                    val = -Math.abs(Number(val) || 0);
                } else if (
                    col.field !== 'premi_pph'
                    && col.field !== 'pot_premi_pph'
                    && (col.field.startsWith('pot_') || col.field.startsWith('POTONGAN_'))
                    && !col.field.includes('_maj')
                    && !col.field.includes('majikan')
                    && !col.field.endsWith('_total')
                ) {
                    // Never let Excel formulas do -(-deduction). Deduction cells carry the sign.
                    val = -Math.abs(Number(val) || 0);
                }

                cell.font = { size: 9 };
                // CRITICAL: Text wrap MUST BE FALSE for all data per user request
                cell.alignment = { horizontal: col.isNumeric ? 'right' : 'left', vertical: 'middle', wrapText: false };
                cell.border = {
                    top: { style: 'thin', color: { argb: COLORS.border } },
                    bottom: { style: 'thin', color: { argb: COLORS.border } },
                    left: { style: 'thin', color: { argb: COLORS.border } },
                    right: { style: 'thin', color: { argb: COLORS.border } }
                };

                if (colColor) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colColor } };
                }

                if (col.isNumeric) {
                    cell.numFmt = col.field === 'lembur_jam' ? '#,##0.0' : '#,##0';

                    // === APPLY FORMULAS FOR TOTALS ===
                    if (col.field === 'total_premi') {
                        const premCols = flatCols.filter(c => c.field.startsWith('premi_') && c.field !== 'premi_pph').map(c => colMap[c.field]);
                        if (premCols.length > 0) {
                            cell.value = { formula: `SUM(${premCols.map(c => `${c}${excelRow.number}`).join(',')})` };
                            return;
                        }
                    } else if (col.field === 'jumlah_upah_kotor') {
                        const gp = colMap['gaji_pokok'];
                        const tb = colMap['beras_jumlah'];
                        const tj = colMap['jabatan_jumlah'];
                        const tm = colMap['masa_kerja_jumlah'];
                        const tl = colMap['lembur_jumlah'];
                        const tp = colMap['total_premi'];
                        const kor = colMap['pot_koreksi'];
                        const pendLain = colMap['pendapatan_lainnya'] || colMap['total_pendapatan_lainnya'];

                        const tunjanganCols = [tb, tj, tm, tl].filter(Boolean).map(c => `${c}${excelRow.number}`).join(',');

                        if (gp && tp && kor) {
                            const sumFormula = tunjanganCols
                                ? `SUM(${gp}${excelRow.number},${tunjanganCols},${tp}${excelRow.number})`
                                : `SUM(${gp}${excelRow.number},${tp}${excelRow.number})`;
                            // Koreksi is already negative in Excel, so add it to reduce gross.
                            // pendapatan_lainnya is additive in gross to match PayrollCalculator
                            // (jumlah_upah_kotor = upah_kotor - koreksi + pendapatan_lainnya).
                            const pendAdd = pendLain ? `+${pendLain}${excelRow.number}` : '';
                            cell.value = { formula: `${sumFormula}+${kor}${excelRow.number}${pendAdd}` };
                            return;
                        }
                    } else if (col.field === 'total_potongan') {
                        const dedCols = flatCols.filter(c => (c.field.startsWith('pot_') || c.field.startsWith('POTONGAN_')) && c.field !== 'pot_koreksi').map(c => colMap[c.field]);
                        // pendapatan_lainnya is a net deduction (pengurang) per PayrollCalculator
                        // (total_potongan = astek + bpjs + spsi + pph21 + other + pendapatan_lainnya).
                        // Its cell is positive, so negate it here to keep the SUM-of-negatives invariant;
                        // this also makes it cancel with the additive gross term in upah_bersih.
                        const pendLain = colMap['pendapatan_lainnya'] || colMap['total_pendapatan_lainnya'];
                        const pendTerm = pendLain ? `-${pendLain}${excelRow.number}` : '';
                        if (dedCols.length > 0 || pendTerm) {
                            const sumPart = dedCols.length > 0
                                ? `SUM(${dedCols.map(c => `${c}${excelRow.number}`).join(',')})`
                                : '0';
                            cell.value = { formula: `${sumPart}${pendTerm}` };
                            return;
                        }
                    } else if (col.field === 'upah_bersih') {
                        const uk = colMap['jumlah_upah_kotor'];
                        const pphPlus = colMap['premi_pph'];
                        const potTot = colMap['total_potongan'];
                        if (uk && pphPlus && potTot) {
                            // Total potongan is negative; adding it avoids -(-potongan).
                            cell.value = { formula: `SUM(${uk}${excelRow.number},${pphPlus}${excelRow.number},${potTot}${excelRow.number})` };
                            return;
                        }
                    }

                    cell.value = val === null || val === undefined ? 0 : val;
                } else {
                    cell.value = val === null || val === undefined ? '' : val;
                }
            });
        }
    });

    // 4. Grand Total Row with Formulas
    if (gangTotalRowIndices.length > 0) {
        worksheet.addRow([]); // Blank row
        const grandTotalRow = worksheet.addRow(flatCols.map(() => ''));
        grandTotalRow.height = 30;

        flatCols.forEach((col, idx) => {
            const cell = grandTotalRow.getCell(idx + 1);

            cell.font = { bold: true, size: 11, color: { argb: COLORS.grandTotalText } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.grandTotal } };
            cell.border = {
                top: { style: 'thick', color: { argb: '000000' } },
                bottom: { style: 'thick', color: { argb: '000000' } },
                left: { style: 'thin', color: { argb: '334155' } },
                right: { style: 'thin', color: { argb: '334155' } }
            };

            if (col.field === 'nama') {
                cell.value = 'GRAND TOTAL KESELURUHAN';
                cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
            } else if (col.isNumeric) {
                const letter = getColLetter(idx + 1);
                const sumParts = gangTotalRowIndices.map(rNum => `${letter}${rNum}`).join(',');

                cell.value = { formula: `SUM(${sumParts})` };
                cell.numFmt = '#,##0';
                cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
            }
        });
    } else {
        // Single gang layout (no sub-totals, just sum the whole range)
        const grandTotalRow = worksheet.addRow(flatCols.map(() => ''));
        grandTotalRow.height = 30;

        // Data range is from headerRow + 1 to the row before this total
        const startRow = headerRow.number + 1;
        const endRow = grandTotalRow.number - 1;

        flatCols.forEach((col, idx) => {
            const cell = grandTotalRow.getCell(idx + 1);

            cell.font = { bold: true, size: 11, color: { argb: COLORS.grandTotalText } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.grandTotal } };
            cell.border = {
                top: { style: 'thick', color: { argb: '000000' } },
                bottom: { style: 'thick', color: { argb: '000000' } },
                left: { style: 'thin', color: { argb: '334155' } },
                right: { style: 'thin', color: { argb: '334155' } }
            };

            if (col.field === 'nama') {
                cell.value = 'GRAND TOTAL';
                cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
            } else if (col.isNumeric && startRow <= endRow) {
                const letter = getColLetter(idx + 1);
                cell.value = { formula: `SUM(${letter}${startRow}:${letter}${endRow})` };
                cell.numFmt = '#,##0';
                cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: false };
            }
        });
    }

    // 5. Signature Block
    worksheet.addRow([]);
    worksheet.addRow([]);

    const printDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const sigRow1 = worksheet.addRow(['', '', '', `Dicetak pada: ${printDate}`]);
    sigRow1.getCell(4).font = { italic: true };

    worksheet.addRow([]);

    // Creating a layout for 4 signatures spreading across the sheet
    // We'll place them roughly at col 2, col 1/4, col 1/2, col 3/4
    const colCount = flatCols.length;
    const col1 = 2;
    const col2 = Math.max(Math.floor(colCount * 0.3), col1 + 3);
    const col3 = Math.max(Math.floor(colCount * 0.55), col2 + 3);
    const col4 = Math.max(colCount - 2, col3 + 3);

    const titleSignRow = worksheet.addRow(Array(colCount).fill(''));
    titleSignRow.getCell(col1).value = 'Dibuat Oleh,';
    titleSignRow.getCell(col2).value = 'Diperiksa Oleh,';
    titleSignRow.getCell(col3).value = 'Diketahui Oleh,';
    titleSignRow.getCell(col4).value = 'Disetujui Oleh,';

    [col1, col2, col3, col4].forEach(c => {
        titleSignRow.getCell(c).font = { bold: true };
        titleSignRow.getCell(c).alignment = { horizontal: 'center' };
    });

    // 4 Empty rows for signature space
    for (let i = 0; i < 4; i++) worksheet.addRow([]);

    const nameSignRow = worksheet.addRow(Array(colCount).fill(''));
    nameSignRow.getCell(col1).value = '( ...................................... )';
    nameSignRow.getCell(col2).value = '( ...................................... )';
    nameSignRow.getCell(col3).value = '( ...................................... )';
    nameSignRow.getCell(col4).value = '( ...................................... )';

    [col1, col2, col3, col4].forEach(c => {
        nameSignRow.getCell(c).alignment = { horizontal: 'center' };
    });

    const roleSignRow = worksheet.addRow(Array(colCount).fill(''));
    roleSignRow.getCell(col1).value = 'Admin Payroll';
    roleSignRow.getCell(col2).value = 'HR Manager';
    roleSignRow.getCell(col3).value = 'Senior Manager';
    roleSignRow.getCell(col4).value = 'General Manager';

    [col1, col2, col3, col4].forEach(c => {
        roleSignRow.getCell(c).font = { italic: true, size: 9 };
        roleSignRow.getCell(c).alignment = { horizontal: 'center' };
    });

    // 6. Freeze Panes
    // Freeze up to column 4 (usually nik, nama, etc) and first 4 header rows
    worksheet.views = [{
        state: 'frozen',
        xSplit: 4,
        ySplit: 4,
        topLeftCell: 'E5',
        activeCell: 'E5'
    }];

    // Export Action
    const fileName = `Daftar_Upah_${meta.division}_${meta.gangCode === 'ALL' ? 'AllGangs' : meta.gangCode}_${meta.year}${String(meta.month).padStart(2, '0')}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, fileName);

    return fileName;
}
