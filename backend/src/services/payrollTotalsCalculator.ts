/**
 * PayrollTotalsCalculator.ts
 * 
 * Backend utility to calculate all aggregation totals that were previously calculated in the frontend.
 * This ensures consistency and moves all calculation logic to the backend ("Smart Backend, Dumb Frontend").
 * 
 * ⚠️ CRITICAL: This MUST replicate the EXACT same logic as frontend to ensure NO VALUES CHANGE.
 * 
 * Replicates the exact logic from:
 * - frontend/src/pages/Report.jsx (calculateTotalRow, updateGrandTotal)
 * - frontend/src/utils/PayrollAggregator.js (_sumRows, calculateEmployeeFields)
 */

export interface PayrollTotals {
    // Identity fields (empty for totals)
    no: string;
    jenis_kelamin: string;
    nik: string;
    nama: string;

    // Employee count (only for grand totals)
    employee_count: number;

    // Attendance & Identity
    upah_dasar: string;  // Empty string in frontend
    hari_kerja: number;
    upah_pokok: number;
    cuti_tahunan_hari: number;
    cuti_sakit_haid_hari: number;
    cuti_minggu_hari: number;
    cuti_nasional_hari: number;
    jumlah_hk: number;

    // Salary & Allowances
    gaji_pokok: number;
    beras_rate: string;  // Empty string in frontend
    beras_jumlah: number;
    jabatan_rate: string;  // Empty string in frontend
    jabatan_jumlah: number;
    masa_kerja_tahun: string;  // Empty string in frontend
    masa_kerja_jumlah: number;
    lembur_jam: string;  // Empty string in frontend
    lembur_jumlah: number;
    total_tunjangan: number;

    // Other Income (Pendapatan Lainnya)
    pendapatan_thr: number;
    pendapatan_bonus: number;
    pendapatan_custom: number;
    pendapatan_lainnya: number;

    // Premi
    premi_brondol: number;
    premi_pruning: number;
    premi_angkut_material: number;
    premi_angkut_tbs: number;
    premi_harvesting: number;
    premi_harvesting_incentive: number;
    premi_pupuk: number;
    pot_koreksi: number;
    total_premi: number;

    // Gross & Deductions
    jumlah_upah_kotor: number;
    pot_pph21: number;
    pot_kontan: number;
    pot_thr: number;
    pot_pinjam: number;
    pot_kl: number;
    pot_bpjs_kes: number;
    pot_astek: number;
    pot_astek_maj: number;
    pot_astek_jumlah: number;
    pot_bpjs_pek: number;
    pot_bpjs_maj: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_kesehatan_majikan: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_bpjs_pensiun_majikan: number;
    pot_bpjs_jumlah: number;
    pot_bpjs_pekerja_total: number;
    pot_spsi: number;
    total_potongan: number;
    upah_bersih: number;

    // Dynamic fields
    premi?: Record<string, number>;
    potongan_upah_kotor?: Record<string, any>;
    [key: string]: any; // Allow dynamic custom pendapatan fields
}

const ROUNDING_EPSILON = 1e-6;

function roundPayrollTotal(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const epsilon = value >= 0 ? ROUNDING_EPSILON : -ROUNDING_EPSILON;
    return Math.round(value + epsilon);
}

/**
 * Calculate totals for a list of employees, replicating the EXACT frontend logic.
 * 
 * ⚠️ CRITICAL: Filters employees to match EXACT frontend behavior.
 * Frontend filters with: (row.jumlah_hk || 0) > 0
 * 
 * @param employees - Array of employee payroll data
 * @param label - Label for the total row (e.g., "TOTAL GANG A1", "GRAND TOTAL")
 * @returns PayrollTotals object with all aggregated values
 */
export function calculatePayrollTotals(employees: any[], label: string): PayrollTotals {
    if (!employees || employees.length === 0) {
        return createEmptyTotals(label);
    }

    // ⚠️ FILTER: Only include employees with jumlah_hk > 0
    // Frontend filters with: (row.jumlah_hk || 0) > 0 (Report.jsx line 1082)
    // This is DIFFERENT from hari_kerja! jumlah_hk is raw attendance before leave deductions.
    const activeEmployees = employees.filter(emp => {
        const jumlahHk = Number(emp.jumlah_hk || 0);
        return jumlahHk > 0;
    });

    // If no active employees, return empty totals
    if (activeEmployees.length === 0) {
        return createEmptyTotals(label);
    }

    // Helper to sum a numeric field across all ACTIVE employees.
    // Canonical payroll rows should already contain normalized derived values.
    const agg = (field: string): number => {
        return roundPayrollTotal(
            activeEmployees.reduce((total, emp) => {
                const val = Number(emp[field] || 0);
                return total + val;
            }, 0)
        );
    };

    // Helper to sum nested other_incomes array by type - EXACT same as frontend aggOtherIncomes()
    const aggOtherIncomes = (type: string): number => {
        return roundPayrollTotal(
            activeEmployees.reduce((total, emp) => {
                if (emp.other_incomes && Array.isArray(emp.other_incomes)) {
                    const found = emp.other_incomes.find((oi: any) => oi.type === type);
                    if (found) {
                        return total + Number(found.amount || 0);
                    }
                }
                return total;
            }, 0)
        );
    };

    // Helper to sum nested premi object fields - EXACT same as frontend aggNested('premi', k)
    const aggPremi = (field: string): number => {
        return roundPayrollTotal(
            activeEmployees.reduce((total, emp) => {
                if (emp.premi && typeof emp.premi === 'object') {
                    return total + Number(emp.premi[field] || 0);
                }
                return total;
            }, 0)
        );
    };

    // Helper to sum nested potongan object fields from dataExtractorService
    // dataExtractorService stores deductions in emp.potongan with keys like KONTAN, THR, PINJAM, KL
    // payrollTotalsCalculator expects flat fields like pot_kontan, pot_thr, pot_pinjam, pot_kl
    // This helper tries both: flat field first (reportService compatibility), then nested object (dataExtractorService)
    const aggPotongan = (flatField: string, nestedKey: string): number => {
        return roundPayrollTotal(
            activeEmployees.reduce((total, emp) => {
                // First try flat field (from reportService)
                let val = Number(emp[flatField] || 0);
                if (val !== 0) return total + val;
                // Fall back to nested potongan object (from dataExtractorService)
                // Keys in emp.potongan are uppercase: KONTAN, THR, PINJAM, KL
                if (emp.potongan && typeof emp.potongan === 'object') {
                    val = Number(emp.potongan[nestedKey] || 0);
                }
                return total + val;
            }, 0)
        );
    };

    // Calculate all totals matching the frontend Report.jsx logic EXACTLY
    const totals: PayrollTotals = {
        // Identity fields - EXACT same as frontend
        no: '',
        jenis_kelamin: '',
        nik: '',
        nama: label,

        // Employee count
        employee_count: activeEmployees.length,

        // Attendance & Identity - EXACT same fields as frontend
        upah_dasar: '',  // Frontend sets to empty string
        hari_kerja: agg('hari_kerja'),
        upah_pokok: agg('upah_pokok'),
        cuti_tahunan_hari: agg('cuti_tahunan_hari'),
        cuti_sakit_haid_hari: agg('cuti_sakit_haid_hari'),
        cuti_minggu_hari: agg('cuti_minggu_hari'),
        cuti_nasional_hari: agg('cuti_nasional_hari'),
        jumlah_hk: agg('jumlah_hk'),

        // Salary & Allowances - EXACT same fields as frontend
        gaji_pokok: agg('gaji_pokok'),
        beras_rate: '',  // Frontend sets to empty string
        beras_jumlah: agg('beras_jumlah'),
        jabatan_rate: '',  // Frontend sets to empty string
        jabatan_jumlah: agg('jabatan_jumlah'),
        masa_kerja_tahun: '',  // Frontend sets to empty string
        masa_kerja_jumlah: agg('masa_kerja_jumlah'),
        lembur_jam: '',  // Frontend sets to empty string
        lembur_jumlah: agg('lembur_jumlah'),
        total_tunjangan: agg('total_tunjangan'),

        // Other Income - EXACT same as frontend
        pendapatan_thr: aggOtherIncomes('THR'),
        pendapatan_bonus: aggOtherIncomes('BONUS'),
        pendapatan_custom: aggOtherIncomes('CUSTOM'),
        pendapatan_lainnya: agg('pendapatan_lainnya'),

        // Premi - EXACT same fields as frontend
        premi_brondol: agg('premi_brondol'),
        premi_pruning: agg('premi_pruning'),
        premi_angkut_material: agg('premi_angkut_material'),
        premi_angkut_tbs: agg('premi_angkut_tbs'),
        premi_harvesting: agg('premi_harvesting'),
        premi_harvesting_incentive: agg('premi_harvesting_incentive'),
        premi_pupuk: agg('premi_pupuk'),
        pot_koreksi: agg('pot_koreksi'),
        total_premi: agg('total_premi'),

        // Gross & Deductions - EXACT same fields as frontend
        jumlah_upah_kotor: agg('jumlah_upah_kotor'),
        pot_pph21: agg('pot_pph21'),
        pot_kontan: aggPotongan('pot_kontan', 'KONTAN'),
        pot_thr: aggPotongan('pot_thr', 'THR'),
        pot_pinjam: aggPotongan('pot_pinjam', 'PINJAM'),
        pot_kl: aggPotongan('pot_kl', 'KL'),
        pot_bpjs_kes: agg('pot_bpjs_kes'),
        pot_astek: agg('pot_astek'),
        pot_astek_maj: agg('pot_astek_maj'),
        pot_astek_jumlah: agg('pot_astek_jumlah'),
        pot_bpjs_pek: agg('pot_bpjs_pek'),
        pot_bpjs_maj: agg('pot_bpjs_maj'),
        pot_bpjs_kesehatan_pekerja: agg('pot_bpjs_kesehatan_pekerja'),
        pot_bpjs_kesehatan_majikan: agg('pot_bpjs_kesehatan_majikan'),
        pot_bpjs_pensiun_pekerja: agg('pot_bpjs_pensiun_pekerja'),
        pot_bpjs_pensiun_majikan: agg('pot_bpjs_pensiun_majikan'),
        pot_bpjs_jumlah: agg('pot_bpjs_jumlah'),
        pot_bpjs_pekerja_total: agg('pot_bpjs_pekerja_total'),
        pot_spsi: agg('pot_spsi'),
        total_potongan: agg('total_potongan'),
        upah_bersih: agg('upah_bersih'),

        // Dynamic premi fields
        premi: {}
    };

    // Aggregate dynamic premi fields from nested structure - EXACT same as frontend
    // Frontend: if (filteredRows[0]?.premi && typeof filteredRows[0].premi === 'object')
    if (employees[0]?.premi && typeof employees[0].premi === 'object') {
        Object.keys(employees[0].premi).forEach(key => {
            if (key.startsWith('premi_')) {
                totals.premi![key] = aggPremi(key);
            }
        });
    }

    // Aggregate dynamic potongan fields if they exist
    if (employees[0]?.potongan_upah_kotor?.dynamic) {
        totals.potongan_upah_kotor = {
            dynamic: { ...employees[0].potongan_upah_kotor.dynamic }
        };
        Object.keys(employees[0].potongan_upah_kotor.dynamic).forEach(key => {
            totals.potongan_upah_kotor!.dynamic[key] = agg(`potongan_upah_kotor.dynamic.${key}`);
        });
    }

    // Handle custom pendapatan fields (pendapatan_*) - EXACT same as frontend
    // Frontend uses customPendapatanTypes.map(t => [`pendapatan_${t.type.toLowerCase()}`, agg(...)])
    // We auto-discover all pendapatan_* fields from employees
    const customPendapatanKeys = new Set<string>();
    employees.forEach(emp => {
        Object.keys(emp).forEach(key => {
            if (key.startsWith('pendapatan_') &&
                !['pendapatan_thr', 'pendapatan_bonus', 'pendapatan_custom', 'pendapatan_lainnya'].includes(key)) {
                customPendapatanKeys.add(key);
            }
        });
    });

    // Sum custom pendapatan fields
    customPendapatanKeys.forEach(key => {
        totals[key] = agg(key);
    });

    // ⚠️ CRITICAL: Also sum from other_incomes array (for THR, BONUS, CUSTOM, KONTAN, etc.)
    // Frontend uses aggOtherIncomes(type) to get from other_incomes array
    // Calculate ALL types from other_incomes, not just THR/BONUS/CUSTOM
    const otherIncomesTypeSums: Record<string, number> = {};
    
    activeEmployees.forEach(emp => {
        if (emp.other_incomes && Array.isArray(emp.other_incomes)) {
            emp.other_incomes.forEach((oi: any) => {
                const type = oi.type?.toUpperCase();
                const amount = Number(oi.amount || 0);
                if (type && amount !== 0) {
                    if (!otherIncomesTypeSums[type]) otherIncomesTypeSums[type] = 0;
                    otherIncomesTypeSums[type] += amount;
                }
            });
        }
    });

    // Add standard types: THR, BONUS, CUSTOM
    totals.pendapatan_thr = otherIncomesTypeSums['THR'] ? roundPayrollTotal(otherIncomesTypeSums['THR']) : totals.pendapatan_thr;
    totals.pendapatan_bonus = otherIncomesTypeSums['BONUS'] ? roundPayrollTotal(otherIncomesTypeSums['BONUS']) : totals.pendapatan_bonus;
    totals.pendapatan_custom = otherIncomesTypeSums['CUSTOM'] ? roundPayrollTotal(otherIncomesTypeSums['CUSTOM']) : totals.pendapatan_custom;

    // Add custom types from other_incomes (KONTAN, INSENTIF, etc.)
    Object.entries(otherIncomesTypeSums).forEach(([type, sum]) => {
        if (!['THR', 'BONUS', 'CUSTOM'].includes(type)) {
            const fieldKey = `pendapatan_${type.toLowerCase()}`;
            totals[fieldKey] = roundPayrollTotal(sum);
        }
    });

    return totals;
}

/**
 * Create an empty totals object with the specified label
 */
function createEmptyTotals(label: string): PayrollTotals {
    return {
        no: '',
        jenis_kelamin: '',
        nik: '',
        nama: label,
        employee_count: 0,
        upah_dasar: '',
        hari_kerja: 0,
        upah_pokok: 0,
        cuti_tahunan_hari: 0,
        cuti_sakit_haid_hari: 0,
        cuti_minggu_hari: 0,
        cuti_nasional_hari: 0,
        jumlah_hk: 0,
        gaji_pokok: 0,
        beras_rate: '',
        beras_jumlah: 0,
        jabatan_rate: '',
        jabatan_jumlah: 0,
        masa_kerja_tahun: '',
        masa_kerja_jumlah: 0,
        lembur_jam: '',
        lembur_jumlah: 0,
        total_tunjangan: 0,
        pendapatan_thr: 0,
        pendapatan_bonus: 0,
        pendapatan_custom: 0,
        pendapatan_lainnya: 0,
        premi_brondol: 0,
        premi_pruning: 0,
        premi_angkut_material: 0,
        premi_angkut_tbs: 0,
        premi_harvesting: 0,
        premi_harvesting_incentive: 0,
        premi_pupuk: 0,
        pot_koreksi: 0,
        total_premi: 0,
        jumlah_upah_kotor: 0,
        pot_pph21: 0,
        pot_kontan: 0,
        pot_thr: 0,
        pot_pinjam: 0,
        pot_kl: 0,
        pot_bpjs_kes: 0,
        pot_astek: 0,
        pot_astek_maj: 0,
        pot_astek_jumlah: 0,
        pot_bpjs_pek: 0,
        pot_bpjs_maj: 0,
        pot_bpjs_kesehatan_pekerja: 0,
        pot_bpjs_kesehatan_majikan: 0,
        pot_bpjs_pensiun_pekerja: 0,
        pot_bpjs_pensiun_majikan: 0,
        pot_bpjs_jumlah: 0,
        pot_bpjs_pekerja_total: 0,
        pot_spsi: 0,
        total_potongan: 0,
        upah_bersih: 0,
        premi: {}
    };
}

/**
 * Calculate totals for multiple gangs and return a map of gang_code -> totals
 */
export function calculateGangTotalsMap(gangs: Array<{ gang_code: string; employees: any[] }>): Record<string, PayrollTotals> {
    const totalsMap: Record<string, PayrollTotals> = {};
    
    gangs.forEach(gang => {
        totalsMap[gang.gang_code] = calculatePayrollTotals(
            gang.employees,
            `TOTAL ${gang.gang_code}`
        );
    });
    
    return totalsMap;
}

const TOTAL_IDENTITY_FIELDS = new Set([
    'no',
    'jenis_kelamin',
    'nik',
    'nama',
    'upah_dasar',
    'beras_rate',
    'jabatan_rate',
    'masa_kerja_tahun',
    'lembur_jam'
]);

/**
 * Calculate a displayed grand total from already-displayed gang totals.
 *
 * Use this for reconciliation checks and export/display breakdown totals. The
 * canonical division grand total still comes from employee rows via
 * calculatePayrollTotals().
 */
export function calculateGrandTotalFromGangTotals(gangTotals: PayrollTotals[], label: string = 'GRAND TOTAL'): PayrollTotals {
    const grandTotal = createEmptyTotals(label);

    for (const gangTotal of gangTotals) {
        for (const [field, value] of Object.entries(gangTotal)) {
            if (TOTAL_IDENTITY_FIELDS.has(field)) continue;

            if (field === 'premi' && value && typeof value === 'object' && !Array.isArray(value)) {
                grandTotal.premi = grandTotal.premi || {};
                for (const [premiField, premiValue] of Object.entries(value as Record<string, unknown>)) {
                    grandTotal.premi[premiField] = (grandTotal.premi[premiField] || 0) + roundPayrollTotal(Number(premiValue) || 0);
                }
                continue;
            }

            if (field === 'potongan_upah_kotor' && value && typeof value === 'object' && !Array.isArray(value)) {
                const potongan = value as { dynamic?: Record<string, unknown> };
                if (potongan.dynamic) {
                    grandTotal.potongan_upah_kotor = grandTotal.potongan_upah_kotor || { dynamic: {} };
                    grandTotal.potongan_upah_kotor.dynamic = grandTotal.potongan_upah_kotor.dynamic || {};
                    for (const [potonganField, potonganValue] of Object.entries(potongan.dynamic)) {
                        grandTotal.potongan_upah_kotor.dynamic[potonganField] =
                            (grandTotal.potongan_upah_kotor.dynamic[potonganField] || 0) + roundPayrollTotal(Number(potonganValue) || 0);
                    }
                }
                continue;
            }

            if (typeof value === 'number' && Number.isFinite(value)) {
                grandTotal[field] = (Number(grandTotal[field]) || 0) + roundPayrollTotal(value);
            }
        }
    }

    grandTotal.nama = label;
    return grandTotal;
}

function clonePayrollTotals(total: PayrollTotals): PayrollTotals {
    return {
        ...total,
        premi: total.premi ? { ...total.premi } : total.premi,
        potongan_upah_kotor: total.potongan_upah_kotor
            ? {
                ...total.potongan_upah_kotor,
                dynamic: total.potongan_upah_kotor.dynamic
                    ? { ...total.potongan_upah_kotor.dynamic }
                    : total.potongan_upah_kotor.dynamic
            }
            : total.potongan_upah_kotor
    };
}

function pickReconciliationTarget(totals: PayrollTotals[], field: string): number {
    let targetIndex = 0;
    let targetMagnitude = -1;

    totals.forEach((total, index) => {
        const magnitude = Math.abs(Number(total[field]) || 0);
        if (magnitude > targetMagnitude) {
            targetMagnitude = magnitude;
            targetIndex = index;
        }
    });

    return targetIndex;
}

/**
 * Keep canonical division grand totals unchanged while making displayed gang
 * breakdowns add back to that canonical total.
 *
 * Rounding residues usually come from fractional lembur/allowance values. The
 * residue is assigned to the largest contributing gang for each field, so the
 * division total remains the source of truth and breakdown exports reconcile.
 */
export function reconcileGangTotalsToGrandTotal(gangTotals: PayrollTotals[], grandTotal: PayrollTotals): PayrollTotals[] {
    if (!gangTotals.length) return [];

    const reconciled = gangTotals.map(clonePayrollTotals);
    const fields = new Set<string>();

    for (const total of [grandTotal, ...gangTotals]) {
        Object.entries(total).forEach(([field, value]) => {
            if (TOTAL_IDENTITY_FIELDS.has(field)) return;
            if (typeof value === 'number' && Number.isFinite(value)) {
                fields.add(field);
            }
        });
    }

    fields.forEach((field) => {
        const targetValue = roundPayrollTotal(Number(grandTotal[field]) || 0);
        const currentSum = reconciled.reduce((sum, total) => sum + roundPayrollTotal(Number(total[field]) || 0), 0);
        const delta = targetValue - currentSum;
        if (delta === 0) return;

        const targetIndex = pickReconciliationTarget(reconciled, field);
        reconciled[targetIndex][field] = roundPayrollTotal(Number(reconciled[targetIndex][field]) || 0) + delta;
    });

    return reconciled;
}

/**
 * Calculate grand total across all gangs
 */
export function calculateGrandTotal(gangs: Array<{ gang_code: string; employees: any[] }>): PayrollTotals {
    const allEmployees = gangs.flatMap(gang => gang.employees);
    return calculatePayrollTotals(allEmployees, 'GRAND TOTAL');
}

export interface TaxMatrixTotals {
    employee_count: number;
    gaji_pokok_bulanan: number;
    gaji_pokok_ideal: number;
    gaji_pokok_dibayarkan: number;
    // Display-only automatic HK correction. Kept as 0 in totals.
    koreksi_hk: number;
    astek_084: number;
    bpjs_kesehatan_majikan_4_pct: number;
    beras_jumlah: number;
    jabatan_jumlah: number;
    masa_kerja_jumlah: number;
    lembur_jumlah: number;
    total_premi: number;
    pot_koreksi: number;
    taxable_pendapatan_thr: number;
    taxable_pendapatan_bonus: number;
    taxable_pendapatan_custom: number;
    taxable_pendapatan_lainnya: number;
    penghasilan_bruto: number;
    pph21_ter: number;
    pot_astek_pekerja: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_astek_jumlah: number;
    pot_spsi: number;
    pot_pph21: number;
}

const TAX_MATRIX_NUMERIC_FIELDS: Array<keyof Omit<TaxMatrixTotals, 'employee_count'>> = [
    'gaji_pokok_bulanan',
    'gaji_pokok_ideal',
    'gaji_pokok_dibayarkan',
    'astek_084',
    'bpjs_kesehatan_majikan_4_pct',
    'beras_jumlah',
    'jabatan_jumlah',
    'masa_kerja_jumlah',
    'lembur_jumlah',
    'total_premi',
    'pot_koreksi',
    'taxable_pendapatan_thr',
    'taxable_pendapatan_bonus',
    'taxable_pendapatan_custom',
    'taxable_pendapatan_lainnya',
    'penghasilan_bruto',
    'pph21_ter',
    'pot_astek_pekerja',
    'pot_bpjs_kesehatan_pekerja',
    'pot_bpjs_pensiun_pekerja',
    'pot_astek_jumlah',
    'pot_spsi',
    'pot_pph21'
];

function emptyTaxMatrixTotals(): TaxMatrixTotals {
    return {
        employee_count: 0,
        gaji_pokok_bulanan: 0,
        gaji_pokok_ideal: 0,
        gaji_pokok_dibayarkan: 0,
        koreksi_hk: 0,
        astek_084: 0,
        bpjs_kesehatan_majikan_4_pct: 0,
        beras_jumlah: 0,
        jabatan_jumlah: 0,
        masa_kerja_jumlah: 0,
        lembur_jumlah: 0,
        total_premi: 0,
        pot_koreksi: 0,
        taxable_pendapatan_thr: 0,
        taxable_pendapatan_bonus: 0,
        taxable_pendapatan_custom: 0,
        taxable_pendapatan_lainnya: 0,
        penghasilan_bruto: 0,
        pph21_ter: 0,
        pot_astek_pekerja: 0,
        pot_bpjs_kesehatan_pekerja: 0,
        pot_bpjs_pensiun_pekerja: 0,
        pot_astek_jumlah: 0,
        pot_spsi: 0,
        pot_pph21: 0
    };
}

export function calculateTaxMatrixTotals(employees: any[]): TaxMatrixTotals {
    if (!employees || employees.length === 0) {
        return emptyTaxMatrixTotals();
    }

    const totals = emptyTaxMatrixTotals();
    totals.employee_count = employees.length;

    for (const field of TAX_MATRIX_NUMERIC_FIELDS) {
        totals[field] = Math.round(
            employees.reduce((sum, emp) => sum + (Number(emp?.[field]) || 0), 0)
        );
    }

    return totals;
}
