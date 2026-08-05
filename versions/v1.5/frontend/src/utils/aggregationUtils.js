/**
 * Aggregation Utilities for Payroll Data
 * 
 * Provides client-side aggregation functions to calculate totals and grand totals
 * for payroll data, reducing server load and enabling faster rendering.
 */

/**
 * Safely convert value to number, return 0 if invalid
 */
const safeNumber = (value) => {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
};

const deductionMagnitude = (value) => Math.abs(safeNumber(value));

const isNetPayAdditionPremi = (key) => key === 'premi_pph' || key === 'pot_premi_pph';

const isGrossKoreksiDeduction = (key) => key === 'pot_koreksi' || key === 'koreksi' || key.startsWith('koreksi_');

const getOtherIncomeTotal = (row) => {
    if (row.total_pendapatan_lainnya !== undefined && row.total_pendapatan_lainnya !== null) {
        return safeNumber(row.total_pendapatan_lainnya);
    }
    return safeNumber(row.pendapatan_lainnya);
};

/**
 * Calculate total tunjangan (allowances) for a row
 * Formula: beras_jumlah + jabatan_jumlah + masa_kerja_jumlah + lembur_jumlah
 */
export const calculateTotalTunjangan = (row) => {
    return safeNumber(row.beras_jumlah) +
        safeNumber(row.jabatan_jumlah) +
        safeNumber(row.masa_kerja_jumlah) +
        safeNumber(row.lembur_jumlah);
};

/**
 * Calculate total premi for a row
 * Cell-Based Aggregation: Sums all keys starting with 'premi_'
 * Excludes 'total_premi' to avoid double counting.
 * Ignores hidden/nested 'premi' object to strictly follow rendered columns.
 */
export const calculateTotalPremi = (row) => {
    let total = 0;

    Object.keys(row).forEach(key => {
        if (key.startsWith('premi_') && key !== 'total_premi' && !isNetPayAdditionPremi(key)) {
            total += safeNumber(row[key]);
        }
    });

    return total;
};

/**
 * Calculate potongan upah kotor total
 * Formula: ABS(pot_koreksi) dari POTONGAN (bukan dari HK difference)
 *
 * [FIX] JANGAN include koreksi_hk karena itu sudah termasuk di gaji_pokok_aktual.
 * gaji_pokok_aktual dari PR_TASKREGLN SUDAH termasuk koreksi dari scan HK.
 * Jika kita kurangkan lagi koreksi_hk, maka akan terjadi double deduction.
 */
export const calculatePotonganUpahKotorTotal = (row) => {
    // pot_koreksi adalah koreksi dari POTONGAN (jika ada), BUKAN dari HK difference
    const potKoreksi = Math.abs(safeNumber(row.pot_koreksi));
    const automaticHk = Math.abs(safeNumber(row.koreksi_hk));

    // [SIGN-SAFETY / DOUBLE-DEDUCTION GUARD]
    // Jika |pot_koreksi| == |koreksi_hk|, pot_koreksi adalah mirror HK difference
    // (sudah termasuk di gaji_pokok_aktual dari PR_TASKREGLN), BUKAN dari POTONGAN table.
    // Exclude agar tidak double-deduct. Mirror resolveGrossDeductionWithoutAutomaticHk di CustomPayrollTable.
    let total = (potKoreksi > 0 && automaticHk > 0 && Math.abs(potKoreksi - automaticHk) <= 1)
        ? 0
        : potKoreksi;

    // [FIX] JANGAN tambahkan koreksi_hk karena sudah termasuk dalam gaji_pokok_aktual
    // koreksi_hk = gaji_pokok_aktual - gaji_pokok_ideal (sudah termasuk di gp_aktual)

    // Add all dynamic potongan from the nested structure (exclude koreksi which is already in gp_aktual)
    if (row.potongan_upah_kotor && row.potongan_upah_kotor.dynamic) {
        for (const [key, value] of Object.entries(row.potongan_upah_kotor.dynamic)) {
            // Exclude koreksi keys - they're already in gaji_pokok_aktual
            if (key === 'koreksi' || key.startsWith('koreksi')) {
                continue; // Skip koreksi - already in gp_aktual
            }
            total += Math.abs(safeNumber(value));
        }
    }

    return total;
};

/**
 * Calculate total potongan (total deductions)
 * Cell-Based Aggregation: Sums all valid deduction columns from the row.
 * For Caruman ASTEK: Only includes 'pekerja' (bpjs_pek) values
 * Excludes columns containing 'majikan', 'total', 'jumlah'.
 */
export const calculateTotalPotongan = (row) => {
    let total = 0;
    let hasExplicitOtherIncomeDeduction = false;

    Object.keys(row).forEach(key => {
        const k = key.toLowerCase();

        if (k === 'total_pendapatan_lainnya_pengurang') {
            hasExplicitOtherIncomeDeduction = true;
            total += deductionMagnitude(row[key]);
            return;
        }

        // 1. Inclusion: Must be a deduction column
        // Starts with 'pot_' or 'bpjs_' or is a known deduction key
        // Include ALL ASTEK fields (pekerja, majikan, jumlah) for total potongan calculation
        // But only pekerja portion should count towards "Total Potongan Upah Bersih"
        const isDeduction = k.startsWith('pot_') ||
                            k.startsWith('bpjs_') ||
                            k === 'bpjs_pek' ||      // Caruman ASTEK pekerja (explicitly included)
                            k === 'pot_bpjs_pek' ||   // Alternative Caruman ASTEK pekerja field (fallback)
                            k === 'pot_astek' ||      // Caruman ASTEK pekerja (actual field used)
                            ['pph21', 'spsi', 'koreksi'].includes(k);

        if (!isDeduction) return;

        // Koreksi gross is already applied in jumlah_upah_kotor. Including it
        // here would deduct the same correction twice from upah_bersih.
        if (isGrossKoreksiDeduction(k)) return;

        // 2. Exclusion: Exclude majikan, total, jumlah fields from "Total Potongan Upah Bersih" calculation
        if (k.includes('majikan') || k.includes('total') || k.includes('jumlah')) return;

        // 3. Specific exclusion for suffix '_maj' or segment '_maj_' (common in astek/bpjs keys)
        if (k.endsWith('_maj') || k.includes('_maj_')) return;

        // 4. Safety: Exclude aggregate fields if they happen to match patterns (unlikely but safe)
        if (k === 'potongan_upah_kotor_total') return;

        if (k === 'pot_pendapatan_lainnya') {
            hasExplicitOtherIncomeDeduction = true;
        }

        // 4. For Caruman ASTEK specifically, only include pekerja portion (bpjs_pek)
        // The exclusion logic above already handles this by excluding 'majikan' and 'jumlah'

        total += deductionMagnitude(row[key]);
    });

    if (!hasExplicitOtherIncomeDeduction) {
        total += deductionMagnitude(getOtherIncomeTotal(row));
    }

    return total;
};

/**
 * Calculate upah kotor (gross wage)
 * Formula: gaji_pokok + total_tunjangan + total_premi - ABS(potongan_upah_kotor_total)
 */
export const calculateUpahKotor = (row) => {
    const gajiPokok = safeNumber(row.gaji_pokok);
    const totalTunjangan = calculateTotalTunjangan(row);
    const totalPremi = calculateTotalPremi(row);
    const potonganUpahKotor = calculatePotonganUpahKotorTotal(row);
    const pendapatanLainnya = getOtherIncomeTotal(row);

    return gajiPokok + totalTunjangan + totalPremi - potonganUpahKotor + pendapatanLainnya;
};

/**
 * Calculate upah bersih (net wage)
 * Formula: (Gaji + Tunjangan + Premi) - Total Potongan (Cell Based)
 * Note: We do NOT use upah_kotor here because upah_kotor already subtracts Potongan Upah Kotor,
 * and Total Potongan (Cell Based) ALSO includes Potongan Upah Kotor components.
 * Using (Upah Kotor - Total Potongan) would double-subtract those components.
 */
export const calculateUpahBersih = (row) => {
    const jumlahUpahKotor = calculateUpahKotor(row);
    const totalPotongan = calculateTotalPotongan(row);
    const premiPph = safeNumber(row.premi_pph) || safeNumber(row.pot_premi_pph);

    return jumlahUpahKotor - totalPotongan + premiPph;
};

/**
 * Recalculate all derived fields for a row
 * Updates the row object in place with calculated values
 */
export const calculateRowTotals = (row) => {
    row.total_tunjangan = calculateTotalTunjangan(row);
    row.total_premi = calculateTotalPremi(row);
    row.potongan_upah_kotor_total = calculatePotonganUpahKotorTotal(row);
    row.total_potongan = calculateTotalPotongan(row);
    row.jumlah_upah_kotor = calculateUpahKotor(row);
    row.upah_kotor_premi = row.jumlah_upah_kotor; // Alias
    row.upah_bersih = calculateUpahBersih(row);

    return row;
};

/**
 * Get all numeric field names from a row
 * Returns array of field names that should be aggregated
 */
const getNumericFields = (row) => {
    const numericFields = new Set();

    // Standard numeric fields
    const standardFields = [
        'upah_dasar', 'upah_pokok', 'gaji_pokok', 'hari_kerja',
        'beras_jumlah', 'jabatan_jumlah', 'masa_kerja_jumlah', 'lembur_jumlah',
        'total_tunjangan', 'total_premi', 'jumlah_upah_kotor', 'upah_kotor_premi',
        'potongan_upah_kotor_total', 'total_potongan', 'upah_bersih',
        'cuti_tahunan_hari', 'cuti_sakit_haid_hari', 'cuti_minggu_hari',
        'cuti_nasional_hari', 'jumlah_hk', 'masa_kerja_tahun', 'lembur_jam',
        'pot_pph21', 'pot_kontan', 'pot_thr', 'pot_pinjam', 'pot_kl',
        'pot_tiket', 'pot_alat', 'pot_spsi', 'pot_koreksi',
        'pot_bpjs_kesehatan_pekerja', 'pot_bpjs_kesehatan_majikan',
        'pot_bpjs_pensiun_pekerja', 'pot_bpjs_pensiun_majikan',
        'pot_bpjs_pekerja_total', 'pot_bpjs_jumlah',
        'pot_bpjs_kesehatan_total', 'pot_bpjs_pensiun_total',
        'premi_brondol'
    ];

    standardFields.forEach(f => numericFields.add(f));

    // Add dynamic fields from nested structures
    if (row.premi && typeof row.premi === 'object') {
        Object.keys(row.premi).forEach(key => {
            if (key.startsWith('premi_')) {
                numericFields.add(`premi.${key}`);
            }
        });
    }

    if (row.potongan_upah_kotor && row.potongan_upah_kotor.dynamic) {
        Object.keys(row.potongan_upah_kotor.dynamic).forEach(key => {
            numericFields.add(`potongan_upah_kotor.dynamic.${key}`);
        });
    }

    if (row.potongan_upah_bersih && row.potongan_upah_bersih.dynamic) {
        Object.keys(row.potongan_upah_bersih.dynamic).forEach(key => {
            numericFields.add(`potongan_upah_bersih.dynamic.${key}`);
        });
    }

    return Array.from(numericFields);
};

/**
 * Calculate grand total for multiple rows
 * Returns an object with aggregated values for all numeric fields
 */
export const calculateGrandTotal = (rows, options = {}) => {
    if (!rows || rows.length === 0) {
        return {};
    }

    const total = {
        count: rows.length,
        isTotal: true,
        no: '',
        jenis_kelamin: '',
        nik: '',
        nama: options.totalName || 'GRAND TOTAL'
    };

    // Get all numeric fields from first row
    const numericFields = getNumericFields(rows[0]);

    // Sum all numeric fields
    numericFields.forEach(field => {
        let sum = 0;

        rows.forEach(row => {
            let value = 0;

            // Handle nested premi fields
            if (field.includes('.')) {
                const parts = field.split('.');
                value = safeNumber(row[parts[0]]?.[parts[1]]);
            } else {
                value = safeNumber(row[field]);
            }

            sum += value;
        });

        // Only include if non-zero or if it's an important field
        const importantFields = ['jumlah_upah_kotor', 'upah_bersih', 'total_tunjangan',
            'total_premi', 'total_potongan', 'gaji_pokok'];
        if (sum !== 0 || importantFields.includes(field)) {
            total[field] = Math.round(sum);
        }
    });

    // Ensure calculated totals are accurate
    total.total_tunjangan = Math.round(
        safeNumber(total.beras_jumlah) +
        safeNumber(total.jabatan_jumlah) +
        safeNumber(total.masa_kerja_jumlah) +
        safeNumber(total.lembur_jumlah)
    );

    // total_premi should already be calculated from the backend
    // But ensure it includes all premi components if not
    if (!total.total_premi && total.premi_brondol) {
        let premiSum = safeNumber(total.premi_brondol);
        // If there are nested premi fields, add them
        if (total.premi && typeof total.premi === 'object') {
            Object.values(total.premi).forEach(value => {
                premiSum += safeNumber(value);
            });
        }
        total.total_premi = Math.round(premiSum);
    }

    return total;
};

/**
 * Aggregate rows by gang_code
 * Returns object with gang_code as keys and aggregated data as values
 */
export const aggregateByGang = (rows) => {
    const gangMap = {};

    rows.forEach(row => {
        const gangCode = row.gang_code || 'UNKNOWN';

        if (!gangMap[gangCode]) {
            gangMap[gangCode] = [];
        }

        gangMap[gangCode].push(row);
    });

    const result = {};

    Object.keys(gangMap).forEach(gangCode => {
        const gangRows = gangMap[gangCode];
        result[gangCode] = {
            rows: gangRows,
            total: calculateGrandTotal(gangRows, { totalName: `TOTAL ${gangCode}` })
        };
    });

    return result;
};

/**
 * Format aggregated value for display
 * Supports different format types: currency, integer, decimal, percentage
 */
export const formatAggregatedValue = (value, format = 'integer') => {
    if (value === null || value === undefined || isNaN(value)) {
        return '-';
    }

    const num = Number(value);

    switch (format) {
        case 'currency':
        case 'integer':
            return new Intl.NumberFormat('id-ID', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(Math.round(num));

        case 'decimal':
            return new Intl.NumberFormat('id-ID', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(num);

        case 'percentage':
            return new Intl.NumberFormat('id-ID', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1
            }).format(num) + '%';

        default:
            return String(num);
    }
};

/**
 * Process division data and prepare for rendering
 * Takes grouped data by gang and returns flattened structure with totals
 */
export const processDivisionData = (groupedData, options = {}) => {
    const flatRows = [];
    const sortedGangs = Object.keys(groupedData).sort();

    // Division-wide grand total accumulator
    const divisionGrandTotal = {
        isDivisionTotal: true,
        no: '',
        jenis_kelamin: '',
        nik: '',
        nama: options.divisionName ? `GRAND TOTAL ${options.divisionName}` : 'GRAND TOTAL DIVISI',
        id: 'GRAND_TOTAL_DIVISION'
    };

    for (const gangCode of sortedGangs) {
        const gangRows = groupedData[gangCode];

        if (!gangRows || gangRows.length === 0) continue;

        // Recalculate all row totals
        const processedRows = gangRows.map(row => calculateRowTotals({ ...row }));

        // ============================================================
        // [PERATURAN BISNIS - ALWAYS ACTIVE FILTER]
        // FILTER: Selalu exclude karyawan dengan kehadiran = 0
        //
        // Rule: EXCLUDE if jumlah_hk <= 0
        // This is always active (not optional) to match backend behavior.
        // ============================================================
        const filteredRows = processedRows.filter(r => (r.jumlah_hk || 0) > 0);

        if (filteredRows.length === 0) continue;

        // Add gang header
        flatRows.push({
            isHeader: true,
            gang_code: gangCode,
            id: `HEADER_${gangCode}`,
            nama: `GANG: ${gangCode}`
        });

        // Add gang rows
        flatRows.push(...filteredRows);

        // Calculate gang total
        const gangTotal = calculateGrandTotal(filteredRows, {
            totalName: `TOTAL ${gangCode}`
        });
        gangTotal.gang_code = gangCode;
        gangTotal.id = `TOTAL_${gangCode}`;

        flatRows.push(gangTotal);

        // Accumulate to division grand total
        Object.keys(gangTotal).forEach(key => {
            if (key !== 'isTotal' && key !== 'nama' && key !== 'gang_code' &&
                key !== 'id' && key !== 'count' && typeof gangTotal[key] === 'number') {
                divisionGrandTotal[key] = (divisionGrandTotal[key] || 0) + gangTotal[key];
            }
        });
    }

    // Add division grand total at the end
    if (flatRows.length > 0) {
        flatRows.push(divisionGrandTotal);
    }

    return flatRows;
};

export default {
    calculateTotalTunjangan,
    calculateTotalPremi,
    calculatePotonganUpahKotorTotal,
    calculateTotalPotongan,
    calculateUpahKotor,
    calculateUpahBersih,
    calculateRowTotals,
    calculateGrandTotal,
    aggregateByGang,
    formatAggregatedValue,
    processDivisionData
};
