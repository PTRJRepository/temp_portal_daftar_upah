/**
 * Tax Report Service
 * 
 * Mengagregasi data pajak dari history tables untuk Report Pajak.
 * - Pajak Bulanan (PPH21 per bulan)
 * - Pajak Tahunan (akumulasi setahun + perhitungan PTKP, Biaya Jabatan, PKP)
 * - ASTEK & BPJS Tahunan (akumulasi per bulan)
 */

import * as fs from 'fs';
import * as path from 'path';
import { historyDatabaseService } from './historyDatabaseService';
import { ptkpTaxService, mapPTKPToTER } from './ptkpTaxService';
import { pph21TerService } from './pph21TerService';
import { divisionDefinition } from './divisionDefinition';
import { OtherIncomesService } from './otherIncomesService';
import { getCarumanForPph21, calculateAllCaruman, CARUMAN_RATES } from './carumanDefinitions';
import { Config } from "../config";
import { DataExtractorService, normalizePayrollValuePriorityMode } from './dataExtractorService';
import { currentPeriodService } from './currentPeriodService';
import { EmployeeEstateService } from './employeeEstateService';
import { cacheService } from './cacheService';
import { filterTaxReportRows, resolveTaxReportDivisionScope } from '../utils/taxReportDivisionScope';
import { sortAndRenumberByEmpCode } from '../utils/employeeSort';
import { collectNikLookupKeys, resolveReportIdentity } from '../utils/taxReportIdentity';
import {
    attachPayrollPeriodAdjustmentNotes,
    resolveAdjustedJabatanJumlah,
    shouldForcePotPph21ToTer
} from '../utils/payrollPeriodAdjustments';
import {
    getCanonicalOtherIncomeType,
    sumOtherIncomeByCanonicalType
} from '../utils/otherIncomeCanonical';

/**
 * Auto-derive jabatan (job title) from the last character of gang code.
 * Rules:
 *   H → Karyawan Panen (harvest)
 *   P → Karyawan Perawatan (maintenance)
 *   T → Operator (transport/tractor)
 *   N → Karyawan Nursery
 *   G → Kerani Gudang
 *   Other → Karyawan
 */
function deriveJabatanFromGang(gangCode: string): string {
    if (!gangCode || gangCode.trim().length === 0) return 'Karyawan';
    const lastChar = gangCode.trim().slice(-1).toUpperCase();
    switch (lastChar) {
        case 'H': return 'Karyawan Panen';
        case 'P': return 'Karyawan Percobaan';
        case 'T': return 'Operator';
        case 'N': return 'Karyawan Nursery';
        case 'G': return 'Kerani Gudang';
        case 'M': return 'Karyawan Perawatan';
        default: return 'Karyawan';
    }
}

// ============================================================
// PTKP Rule from JSON
// ============================================================
interface PtkpRule {
    conditions: { condition: string; value: number }[];
}

let ptkpRules: PtkpRule | null = null;

function loadPtkpRules(): PtkpRule {
    if (ptkpRules) return ptkpRules;

    const possiblePaths = [
        path.resolve(process.cwd(), 'Additional_services/hitung_pajak/rule_PTKP_Tahunan.json'),
        path.resolve(process.cwd(), '../Additional_services/hitung_pajak/rule_PTKP_Tahunan.json'),
        path.resolve(__dirname, '../../Additional_services/hitung_pajak/rule_PTKP_Tahunan.json'),
        path.resolve(import.meta.dir, '../../../Additional_services/hitung_pajak/rule_PTKP_Tahunan.json'),
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            ptkpRules = JSON.parse(raw);
            return ptkpRules!;
        }
    }

    throw new Error(`PTKP rules file not found. Tried: ${possiblePaths.join(', ')}`);
}

function getPtkpValue(ptkpStatus: string): number {
    const rules = loadPtkpRules();
    const normalized = (ptkpStatus || '').toUpperCase().trim();
    const match = rules.conditions.find(c => c.condition.toUpperCase() === normalized);
    return match ? match.value : 54000000; // Default TK/0
}

// ============================================================
// THR and Exgratia from JSON
// ============================================================
interface ThrBonusMaps {
    thrMap: Map<string, number>;
    exgratiaMap: Map<string, number>;
}

let thrBonusMaps: ThrBonusMaps | null = null;

function loadThrBonusMaps(): ThrBonusMaps {
    if (thrBonusMaps) return thrBonusMaps;

    thrBonusMaps = {
        thrMap: new Map(),
        exgratiaMap: new Map()
    };

    const baseDataDir = path.resolve(process.cwd(), '../Additional_services/pajak_kalkulator/data_statis');
    const alternativeDataDir = path.resolve(__dirname, '../../../../Additional_services/pajak_kalkulator/data_statis');

    // Use the first existing directory base
    const dir = fs.existsSync(baseDataDir) ? baseDataDir : (fs.existsSync(alternativeDataDir) ? alternativeDataDir : null);

    if (!dir) {
        console.warn('THR/Bonus data directory not found. THR and Exgratia will be 0.');
        return thrBonusMaps;
    }

    const filesToLoad = [
        path.join(dir, 'infra', 'thr_bonus_infra.json'),
        path.join(dir, '1b', 'thr_bonus_1b.json'),
        path.join(dir, '2a', 'thr_bonus_2a.json')
    ];

    const allBonusData: any[] = [];

    for (const p of filesToLoad) {
        if (fs.existsSync(p)) {
            try {
                const raw = fs.readFileSync(p, 'utf-8');
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    allBonusData.push(...parsed);
                }
            } catch (err) {
                console.error(`Failed to load ${p}:`, err);
            }
        } else {
            console.warn(`File not found: ${p}`);
        }
    }

    // Build Maps
    for (const item of allBonusData) {
        const keyStr = String(item.nik || item.nama || '').trim().toUpperCase();
        if (keyStr) {
            thrBonusMaps.thrMap.set(keyStr, item.thr || 0);
            thrBonusMaps.exgratiaMap.set(keyStr, item.exgratia || item.bonus || 0);
        }
    }

    return thrBonusMaps;
}

// ============================================================
// GL and TaskCode Metadata for Tax Report
// ============================================================
export const TAX_COMPONENT_METADATA: Record<string, TaskCodeMetadata> = {
    "masa_kerja": { task_code: "PT9129", dr_acct: "GA9127", cr_acct: "CL3310" },
    "gaji_pokok": { task_code: "AL0013", dr_acct: "GA9110", cr_acct: "CL3310" },
    "tunjangan_jabatan": { task_code: "GA9128", dr_acct: "GA9128", cr_acct: "CL3310" },
    "tunjangan_lembur": { task_code: "AL0019", dr_acct: "GA9112", cr_acct: "CL3310" },
    "tunjangan_beras": { task_code: "AL0014", dr_acct: "GA9131", cr_acct: "CL3310" },
    "premi": { task_code: "AL3PM2207", dr_acct: "PM2201", cr_acct: "CL3310" },
    "brondol": { task_code: "AL3PM2207", dr_acct: "PM2201", cr_acct: "CL3310" }, // Premi Brondol
    "pph21": { task_code: "DEPH21", dr_acct: "CL3310", cr_acct: "CL3710" },
    "bpjs_kes_pekerja": { task_code: "DEBPJS", dr_acct: "CL3310", cr_acct: "CL3314" },
    "bpjs_kes_majikan": { task_code: "ALBPJS", dr_acct: "GA9120", cr_acct: "CL3314" },
    "astek_jht_majikan": { task_code: "ALASTK", dr_acct: "GA9121", cr_acct: "CL3313" },
    "pot_spsi": { task_code: "DE0005", dr_acct: "CL3310", cr_acct: "CL3315" },
    "thr": { task_code: "GA9116", dr_acct: "GA9116", cr_acct: "CL3310" },
    "bonus": { task_code: "AL0005", dr_acct: "GA9117", cr_acct: "CL3310" }
};

// ============================================================
// THR Periode Rule from JSON
// ============================================================
interface ThrPeriode {
    year: number;
    month: number;
    type: string;
    name: string;
    description: string;
    is_active: boolean;
}

function loadActiveThrPeriode(): ThrPeriode | null {
    // Hardcode THR to March as requested by user
    return {
        year: 2026,
        month: 3,
        type: 'THR',
        name: 'THR 2026',
        description: 'Fixed THR Period (March)',
        is_active: true
    };
}

// ============================================================
// Interfaces
// ============================================================

/**
 * Extract parent name from parentheses in employee name
 * Example: "JOHN DOE (JANE DOE)" → { empName: "JOHN DOE", parentName: "JANE DOE" }
 */
function extractParentName(fullName: string): { empName: string; parentName: string } {
    const match = fullName.match(/\(([^)]+)\)/);
    const parentName = match ? match[1].trim() : '';
    const empName = fullName.replace(/\s*\([^)]*\)\s*/g, '').trim();
    return { empName, parentName };
}

export interface TaskCodeMetadata {
    task_code: string;
    dr_acct: string;
    cr_acct: string;
}

export interface MonthlyTaxRow {
    no: number;
    emp_code: string;
    emp_name: string;
    parent_name?: string;
    nik: string;
    new_nik?: string;
    gender: string;
    status_ptkp: string;
    kategori_ter: string;
    gang_code: string;
    npwp: string;
    alamat: string;
    jabatan: string;
    upah_kotor: number;
    penghasilan_bruto: number;
    tarif_pajak_ter: number;
    pph21_ter: number;
    pot_pph21?: number;

    // GL Metadata for Headers
    component_metadata?: Record<string, TaskCodeMetadata>;

    // Breakdown Details
    hk?: number;
    gaji_pokok_aktual?: number;
    koreksi_hk?: number;

    tunjangan_beras?: number;
    tunjangan_jabatan?: number;
    tunjangan_masa_kerja?: number;
    tunjangan_lembur?: number;
    total_tunjangan?: number;

    /** Dynamic premi map: key = premi name (e.g. 'brondol', 'pruning'), value = amount */
    premi_detail?: Record<string, number>;
    premi_brondol?: number;
    premi_pph?: number;
    total_premi?: number;

    pot_spsi?: number;
    pot_koreksi?: number;
    total_potongan_kotor?: number;

    bpjs_kes_majikan?: number;
    astek_jht_majikan?: number;

    // New fields for enriched report
    upah_dasar?: number;
    gaji_pokok_ideal?: number;  // upah_dasar × HK
    thr_amount?: number;
    exgratia_amount?: number;
    other_incomes?: { type: string; name: string; amount: number }[];
    pendapatan_tidak_tetap_thp?: number; // Total non-regular income for display
    pendapatan_lainnya?: number; // Actual pendapatan_lainnya used in tax calculation

    // [ROBUST] Support field names from both DataExtractor (Daftar Upah) and Tax Report
    beras_jumlah?: number;
    jabatan_jumlah?: number;
    masa_kerja_jumlah?: number;
    lembur_jumlah?: number;
    premi_brondol_total?: number;
    res_address?: string;
    premi?: Record<string, number>;
    [key: string]: any;
}

export interface AnnualIncomeRow {
    no: number;
    emp_code: string;
    emp_name: string;
    parent_name?: string;
    nik: string;
    gender: string;
    status_ptkp: string;
    kategori_ter: string;
    // Monthly income (upah kotor / penghasilan bruto per bulan)
    monthly_income: Record<string, number>; // "1" -> Jan, "2" -> Feb, etc.
    monthly_gaji_kotor: Record<string, number>;
    monthly_masa_kerja: Record<string, number>;
    monthly_bpjs_kesehatan: Record<string, number>;
    monthly_astek_ins_084: Record<string, number>;
    monthly_astek_ins_2: Record<string, number>;
    monthly_pensiun_1: Record<string, number>;
    // Monthly actual PPH21 from TER calculation
    monthly_pph21: Record<string, number>; // "1" -> Jan, "2" -> Feb, etc.
    // Monthly actual PPH21 dari history_adtrans (hanya untuk tab Historis PPH21)
    monthly_pph21_adtrans: Record<string, number>;
    total_income: number;
    gaji_jan_nov: number;
    masa_kerja_jan_nov: number;

    // Header-only placeholders / specific columns
    thr: number;
    bonus: number;
    medical_claim: number;
    bpjs_kesehatan_4pct: number;  // Ditanggung majikan
    astek_084pct: number;         // JKK/JKM ditanggung majikan

    total_penghasilan_setahun: number;

    // Potongan & Perhitungan
    astek_ins_2pct: number;       // JHT ditanggung pekerja
    biaya_jabatan: number;        // 5% of total, max 6.000.000
    pensiun_1pct: number;         // BPJS Pensiun pekerja 1%
    total_potongan_tahunan: number;

    penghasilan_netto_setahun: number;
    ptkp: number;
    penghasilan_kena_pajak: number;
    pph21_kena_pajak: number;
}

export interface DecemberTaxRow {
    no: number;
    emp_code: string;
    emp_name: string;
    parent_name?: string;
    nik: string;
    new_nik?: string;
    npwp: string;
    alamat: string;
    jabatan: string;
    gender: string;
    status_ptkp: string;
    kategori_ter: string;
    masa_kerja_tahun: string;
    masa_kerja_bulan: string;
    gaji_pokok_des: number;
    tunjangan_des: number;
    premi_asuransi_des: number;
    tunjangan_pph_des: number;
    bruto_des: number;
    thr: number;
    bonus: number;
    tantiem: number;
    other_incomes?: { type: string; name: string; amount: number }[];
    gaji_pokok_setahun: number;
    tunjangan_lainnya_setahun: number;
    premi_asuransi_setahun: number;
    tunjangan_pph_setahun: number;
    natura_setahun: number;
    thr_bonus_tantiem_setahun: number;
    bruto_setahun: number;
    biaya_jabatan: number;
    iuran_jht_jp_setahun: number;
    netto_setahun: number;
    ptkp: number;
    pkp: number;
    pph21_setahun: number;
    pph21_jan_nov: number;
    pph21_desember: number;

    // Details for interactive popup
    monthly_breakdown: {
        gaji_pokok: Record<string, number>;
        tunjangan: Record<string, number>;
        premi_asuransi: Record<string, number>;
        iuran_pensiun: Record<string, number>;
        pph21: Record<string, number>;
    };
}

export interface AstekBpjsMonthlyRow {
    no: number;
    emp_code: string;
    emp_name: string;
    nik: string;
    monthly_data: Record<string, {
        upah_dasar: number;
        gaji_pokok: number;  // upah_dasar × 30
        astek_pekerja: number;
        astek_majikan: number;
        bpjs_kes_pekerja: number;
        bpjs_kes_majikan: number;
        bpjs_pensiun_pekerja: number;
        bpjs_pensiun_majikan: number;
        masa_kerja?: number;
    }>;
    total: {
        upah_dasar: number;
        gaji_pokok: number;
        astek_pekerja: number;
        astek_majikan: number;
        bpjs_kes_pekerja: number;
        bpjs_kes_majikan: number;
        bpjs_pensiun_pekerja: number;
        bpjs_pensiun_majikan: number;
        masa_kerja?: number;
    };
}

// ============================================================
// Service
// ============================================================

class TaxReportService {
    private static instance: TaxReportService;
    private constructor() { }

    public static getInstance(): TaxReportService {
        if (!TaxReportService.instance) {
            TaxReportService.instance = new TaxReportService();
        }
        return TaxReportService.instance;
    }

    /**
     * Check if the given period matches the current server month/year
     */
    private async isCurrentPeriod(month: number, year: number): Promise<boolean> {
        const currentPeriod = await currentPeriodService.getCurrentPeriod();
        return month === currentPeriod.month && year === currentPeriod.year;
    }

    /**
     * Fetch payroll data — HISTORY data as primary source for past months, with fallback to LIVE data
     * when history is not available. This ensures seeded data is always preferred for archived periods.
     * @param useHistoryDb - Explicit override to use history database (from UI state)
     */
    private async fetchPayrollData(month: number, year: number, divisionCode: string, gangCode?: string, gangPrefix?: string, useHistoryDb?: boolean, snapshotVersion?: number | null, valuePriorityMode?: string | null) {
        const normalizedValuePriorityMode = normalizePayrollValuePriorityMode(valuePriorityMode);
        console.log(`[TaxReportService] Fetching payroll data via DataExtractorService: div=${divisionCode} m=${month} y=${year} useHistory=${useHistoryDb} snapshotVersion=${snapshotVersion ?? 'latest'} valuePriorityMode=${normalizedValuePriorityMode}`);

        try {
            // [ALIGNMENT] Trust DataExtractorService as the Single Source of Truth
            const result = await DataExtractorService.getInstance().extractPayrollData(
                month, 
                year, 
                gangCode || "ALL", 
                divisionCode, 
                null, 
                Config.DB_PROFILE, // Match payroll.ts
                false, 
                useHistoryDb, 
                gangPrefix, 
                true, // skipHarvest (Match payroll.ts)
                false, // skipHeavyDetails (Match payroll.ts default)
                snapshotVersion,
                normalizedValuePriorityMode
            );

            if (result && result.data_rows.length > 0) {
                // We'll mark isSourceCurrent based on whether it's the current period or or explicitly requested live
                const now = new Date();
                const currentPeriod = { month: now.getMonth() + 1, year: now.getFullYear() };
                const isSourceCurrent = (month === currentPeriod.month && year === currentPeriod.year) || (useHistoryDb === false);
                
                return { data: result, isSourceCurrent };
            }
        } catch (error: any) {
            console.error(`[TaxReportService] Data fetch failed:`, error.message);
        }

        return { data: { data_rows: [], dynamic_premi_headers: [], dynamic_potongan_headers: [] }, isSourceCurrent: true };
    }

    /**
     * Get monthly tax report (PPH21) for a specific period
     */
    public async getMonthlyTaxReport(
        year: number,
        month: number,
        divisionCode?: string,
        gangCode?: string,
        gangPrefix?: string,
        useHistoryDb?: boolean,
        snapshotVersion?: number | null,
        valuePriorityMode?: string | null
    ): Promise<any> {
        const normalizedValuePriorityMode = normalizePayrollValuePriorityMode(valuePriorityMode);
        console.log(`[TaxReportService] getMonthlyTaxReport: year=${year}, month=${month}, division=${divisionCode || 'ALL'}, gang=${gangCode || 'ALL'}, gangPrefix=${gangPrefix || 'none'}, useHistory=${useHistoryDb}, snapshotVersion=${snapshotVersion ?? 'latest'}, valuePriorityMode=${normalizedValuePriorityMode}`);

        const currentPeriod = await currentPeriodService.getCurrentPeriod();
        const snapshotCacheScope = useHistoryDb ? `SNAP_${snapshotVersion ?? 'LATEST'}` : 'LIVE';
        const cacheKey = cacheService.buildPayrollKey(`TAX_M_${gangCode || 'ALL'}_${gangPrefix || 'ALL'}_${snapshotCacheScope}_${normalizedValuePriorityMode}`, month, year, divisionCode, useHistoryDb);
        const shouldCache = cacheService.shouldCache(month, year, currentPeriod.month, currentPeriod.year);

        if (shouldCache) {
            const cachedData = cacheService.get(cacheKey);
            if (cachedData) {
                console.log(`[TaxReportService] Returning cached monthly tax report from memory.`);
                return cachedData;
            }
        }

        // Tax reports must preserve the requested virtual division scope.
        // The shared helper keeps fetch/filter behavior identical across report variants.
        const divisionScope = resolveTaxReportDivisionScope({ divisionCode, gangPrefix });
        const sourceDivisions = [divisionScope.fetchDivisionCode];

        console.log(`[TaxReportService] Source divisions for ${divisionCode || 'ALL'}: ${sourceDivisions.join(', ')}`);

        // Aggregated data from all sources
        const allHistoryRows: any[] = [];
        const dynamicPremiHeaders = new Set<string>();
        const dynamicPotonganHeaders = new Set<string>();
        let finalMeta: any = null;
        let finalIsSourceCurrent = false;

        for (const sourceDiv of sourceDivisions) {
            const { data: chunk, isSourceCurrent: chunkIsSourceCurrent } = await this.fetchPayrollData(
                month, year, sourceDiv, gangCode || 'ALL', gangPrefix, useHistoryDb, snapshotVersion, normalizedValuePriorityMode
            );

            if (chunk?.data_rows) {
                const filteredRows = filterTaxReportRows(chunk.data_rows, divisionScope);

                if (divisionScope.isVirtualDivision && divisionCode) {
                    console.log(`[TaxReportService] Virtual filter (${divisionCode}) on ${sourceDiv}: ${chunk.data_rows.length} -> ${filteredRows.length} rows.`);
                }

                allHistoryRows.push(...filteredRows);
                finalMeta = chunk.meta || finalMeta;
                
                // Merge dynamic headers
                if (chunk.dynamic_premi_headers) chunk.dynamic_premi_headers.forEach((h: string) => dynamicPremiHeaders.add(h));
                if (chunk.dynamic_potongan_headers) chunk.dynamic_potongan_headers.forEach((h: string) => dynamicPotonganHeaders.add(h));
            }
            
            if (chunkIsSourceCurrent) finalIsSourceCurrent = true;
        }

        console.log(`[TaxReportService] Total aggregated rows: ${allHistoryRows.length}, isSourceCurrent=${finalIsSourceCurrent}`);

        if (allHistoryRows.length === 0) {
            return { employees: [], period: { month, year }, total_pph21: 0, premiKeys: [], data_source: finalIsSourceCurrent ? 'current' : 'history', value_priority_mode: normalizedValuePriorityMode };
        }

        const historyData = {
            data_rows: allHistoryRows,
            dynamic_premi_headers: Array.from(dynamicPremiHeaders),
            dynamic_potongan_headers: Array.from(dynamicPotonganHeaders),
            meta: finalMeta || {}
        };

        const effectiveDivisionCode = divisionScope.fetchDivisionCode;

        const ptkpMaster = await ptkpTaxService.getPtkpByYear(year);
        const ptkpMap = new Map<string, string>();
        for (const p of ptkpMaster) {
            ptkpMap.set(p.emp_code.trim(), p.ptkp_status);
        }

        // Fetch jabatan from employee_estate database
        const jabatanMap = await EmployeeEstateService.getEmployeeJobs();
        const newJabatansToSave: any[] = [];

        // Fetch Other Incomes (THR, Bonus, Custom, KONTAN) for the year to get monthly breakdown
        const dbOtherIncomesYear = await OtherIncomesService.getIncomesForYear(year, effectiveDivisionCode, gangCode);
        const dbIncomeByMonthNik = new Map<string, { thr: number, bonus: number, kontan: number, custom: number }>();

        for (const inc of dbOtherIncomesYear) {
            if (inc.is_taxable) {
                const nikKeys = collectNikLookupKeys(inc);
                const type = getCanonicalOtherIncomeType(inc);
                const amt = Number(inc.amount) || 0;

                for (const nik of nikKeys) {
                    const monthKey = `${inc.period_month}_${nik}`;
                    if (!dbIncomeByMonthNik.has(monthKey)) dbIncomeByMonthNik.set(monthKey, { thr: 0, bonus: 0, kontan: 0, custom: 0 });
                    const mData = dbIncomeByMonthNik.get(monthKey)!;

                    // Map income types correctly: THR, KONTAN/KONTANAN, BONUS/EXGRATIA, CUSTOM
                    if (type === 'THR') { mData.thr += amt; }
                    else if (type === 'KONTAN') { mData.kontan += amt; }
                    else if (type === 'BONUS') { mData.bonus += amt; }
                    else { mData.custom += amt; }
                }
            }
        }

        let totalPph21 = 0;
        
        // [DE-DUPLICATION] Use a Map to ensure each employee is counted only once
        // This prevents doubled totals if history data contains overlapping master headers.
        const employeeMap = new Map<string, any>();
        for (const r of historyData.data_rows) {
            const hk = Number(r.jumlah_hk || r.hk || 0);
            const hasIncome = Number(r.jumlah_upah_kotor || 0) > 0;
            
            if (hk > 0 || hasIncome) {
                // Prefer stable person identity so old/new emp_code rows do not double-count one employee.
                const identity = resolveReportIdentity(r);
                const key = String(identity.new_nik || identity.nik || r.actual_nik || r.nik || r.emp_code || '').trim().toUpperCase();
                if (key) {
                    // If multiple records exist, we keep the latest one (or first one found)
                    // In history database, rows are usually sorted by ID, so last one is most recent.
                    employeeMap.set(key, r);
                }
            }
        }

        const activeRows = Array.from(employeeMap.values());
        console.log(`[TaxReportService] De-duplicated ${historyData.data_rows.length} rows down to ${activeRows.length} unique employees.`);

        const mappedEmployees: MonthlyTaxRow[] = activeRows.map((row: any, idx: number) => {
            const empCodeTrimmed = row.emp_code?.trim() || '';
            const masterPtkp = ptkpMap.get(empCodeTrimmed) || row.status_ptkp || 'TK/0';
            const kategoriTer = mapPTKPToTER(masterPtkp);

            // [DEBUG] Log first row's available fields to understand data structure
            if (idx === 0) {
                console.log(`[TAX_REPORT_DEBUG] First row keys:`, Object.keys(row).filter(k => k.includes('pph') || k.includes('ptkp') || k.includes('beras') || k.includes('status')));
                console.log(`[TAX_REPORT_DEBUG] First row pph21_ter=${row.pph21_ter}, status_ptkp=${row.status_ptkp}, beras_rate=${row.beras_rate}`);
            }

            // Fetch breakdown for pure calculation
            const gajiPokokAktual = row.gaji_pokok_aktual || row.gaji_pokok || 0;
            const upahDasar = row.upah_dasar || 0;
            const tunjanganBeras = row.beras_jumlah || 0;
            const tunjanganJabatan = resolveAdjustedJabatanJumlah(
                row,
                { month, year, divisionCode: effectiveDivisionCode },
                row.jabatan_jumlah || 0
            );
            const tunjanganMasaKerja = row.masa_kerja_jumlah || 0;
            const tunjanganLembur = row.lembur_jumlah || 0;
            const totalPremi = row.total_premi || 0;

            // [CENTRALIZED] Calculate ASTEK 0.84% and BPJS Kes 4% from carumanDefinitions
            const pph21Caruman = getCarumanForPph21(upahDasar, tunjanganMasaKerja);
            const astek084 = pph21Caruman.astek_majikan_084;
            const bpjsKesehatanMajikan4Pct = pph21Caruman.bpjs_kes_majikan_4;
            const carumanBase = pph21Caruman.base;

            // [CRITICAL ALIGNMENT] Use values EXACTLY from UI Daftar Upah (DataExtractorService / History)
            // pph21_ter = recalculated PPh21 via TER method (What the UI shows in the PPh21 cell)
            // pot_pph21 = actual PPh21 deduction from PR_ADTRANS (synchronized deduction)
            // penghasilan_bruto = calculated in DataExtractor Phase 4b (same as UI)
            const penghasilanBruto = Number(row.penghasilan_bruto) || 0;
            // [FIXED 2026-04-08] Prioritize pph21_ter to match UI "Pajak" column exactly
            const pph21 = Number(row.pph21_ter) || Number(row.pot_pph21) || 0;
            const potPph21Input = shouldForcePotPph21ToTer(row, { month, year, divisionCode: effectiveDivisionCode })
                ? pph21
                : Number(row.pot_pph21) || 0;
            const tarifPajakTer = Number(row.tarif_pajak_ter) || 0;
            const storedStatusPtkp = row.status_ptkp || masterPtkp;
            attachPayrollPeriodAdjustmentNotes(row, { month, year, divisionCode: effectiveDivisionCode });

            totalPph21 += pph21;

            const reportIdentity = resolveReportIdentity(row);
            const rawEmpNikForBonus = String(reportIdentity.new_nik || reportIdentity.nik || row.nik_ktp || row.nik || '').trim().toUpperCase();

            // [DEBUG] Always log every employee's pph21 for comparison
            if (idx < 5) {
                console.log(`[TAX_REPORT_DEBUG] [${idx}] ${row.emp_code || row.nik}: pot_pph21=${row.pot_pph21 || 'N/A'}, pph21_ter=${row.pph21_ter || 'N/A'}, USED=${pph21}, bruto=${penghasilanBruto}, PTKP=${storedStatusPtkp}, tarif=${tarifPajakTer}`);
            }

            // [ALIGNMENT] Use other_incomes already attached to the row if available
            // If not available (e.g. from history which might have stripped it), fallback to DB fetch
            let empOtherIncomes = row.other_incomes || [];
            
            if (empOtherIncomes.length === 0) {
                // Fetch other incomes from the yearly map if not already in the row
                for (const inc of dbOtherIncomesYear) {
                    const incNikKeys = collectNikLookupKeys(inc);
                    if (incNikKeys.includes(rawEmpNikForBonus) && inc.period_month === month) {
                        empOtherIncomes.push({
                            type: inc.income_type || '',
                            name: inc.income_name || inc.income_type || '',
                            amount: Number(inc.amount) || 0
                        });
                    }
                }
            }

            const empThrAmount = sumOtherIncomeByCanonicalType(empOtherIncomes, 'THR')
                || Number(row.pendapatan_thr || row.taxable_pendapatan_thr || row.thr_amount || 0);
            const empKontanAmount = sumOtherIncomeByCanonicalType(empOtherIncomes, 'KONTAN')
                || Number(row.pendapatan_kontan || row.taxable_pendapatan_kontan || row.kontanan_amount || 0);
            const bonusDirect = Number(row.pendapatan_bonus || row.taxable_pendapatan_bonus || row.bonus || row.bonus_amount || 0);
            const exgratiaSeparate = Number(row.pendapatan_exgratia || row.taxable_pendapatan_exgratia || 0);
            const exgratiaAlias = bonusDirect === 0 ? Number(row.exgratia_amount || 0) : 0;
            const empBonusAmount = sumOtherIncomeByCanonicalType(empOtherIncomes, 'BONUS')
                || (bonusDirect + exgratiaSeparate + exgratiaAlias);
            const empOtherIncomeAmount = empOtherIncomes
                .filter((i: any) => {
                    const type = getCanonicalOtherIncomeType(i);
                    return !['THR', 'KONTAN', 'BONUS'].includes(type);
                })
                .reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0);

            // ============================================================
            // Build premiDetail: extract ALL individual premi items
            // Sources: row.premi (nested object from DataExtractor), 
            //          row.premi_detail (from history DB), 
            //          row.premi_* (flattened top-level fields)
            // BRONDOL sub-keys are consolidated into single BRONDOL.
            // NO "LAINNYA" catch-all — every premi gets its own column.
            // ============================================================
            const premiDetail: Record<string, number> = {};

            // Keys that should be consolidated into single BRONDOL
            const brondolSubKeys = ['BRONDOL LOOSEFRUIT', 'BRONDOL TOTAL', 'BRONDOL ADTRANS',
                                     'BRONDOL_LOOSEFRUIT', 'BRONDOL_TOTAL', 'BRONDOL_ADTRANS',
                                     'brondol_loosefruit', 'brondol_total', 'brondol_adtrans',
                                     'brondol loosefruit', 'brondol total', 'brondol adtrans'];
            // Keys to skip entirely (internal/meta)
            const skipKeys = ['koreksi', 'KOREKSI', 'total', 'TOTAL'];
            let consolidatedBrondol = 0;
            let hasBrondolFromDetail = false;

            // Helper: normalize a premi key to uppercase label
            const normalizePremiKey = (key: string): string => {
                return String(key).toUpperCase().replace(/_/g, ' ').trim();
            };

            // Helper: check if a key is a brondol sub-key
            const isBrondolSubKey = (key: string): boolean => {
                const upper = normalizePremiKey(key);
                return brondolSubKeys.some(bk => upper === bk.toUpperCase());
            };

            // SOURCE 1: row.premi (nested object from DataExtractor Phase 3)
            // Contains keys like 'pruning', 'angkut_material', 'harvesting', 'brondol', etc.
            if (row.premi && typeof row.premi === 'object' && !Array.isArray(row.premi)) {
                for (const [key, value] of Object.entries(row.premi)) {
                    const val = Number(value) || 0;
                    if (val <= 0) continue;
                    if (skipKeys.includes(key)) continue;

                    const upperKey = normalizePremiKey(key);

                    // Consolidate brondol sub-keys
                    if (isBrondolSubKey(key)) {
                        consolidatedBrondol += val;
                        continue;
                    }
                    // 'brondol' key itself → add to consolidatedBrondol
                    if (upperKey === 'BRONDOL') {
                        consolidatedBrondol += val;
                        hasBrondolFromDetail = true;
                        continue;
                    }

                    premiDetail[upperKey] = (premiDetail[upperKey] || 0) + val;
                }
            }

            // SOURCE 2: row.premi_detail (from history database — object or JSON string)
            // Contains keys like 'BRONDOL', 'PRUNING', 'HARVESTING', etc.
            const rawPremiDetail = row.premi_detail;
            let parsedPremiDetail: Record<string, any> | null = null;

            if (rawPremiDetail && typeof rawPremiDetail === 'object' && !Array.isArray(rawPremiDetail)) {
                parsedPremiDetail = rawPremiDetail;
            } else if (rawPremiDetail && typeof rawPremiDetail === 'string') {
                try { parsedPremiDetail = JSON.parse(rawPremiDetail); } catch (_) {}
            }

            if (parsedPremiDetail) {
                for (const [key, value] of Object.entries(parsedPremiDetail)) {
                    const val = Number(value) || 0;
                    if (val <= 0) continue;
                    if (skipKeys.includes(key)) continue;

                    const upperKey = normalizePremiKey(key);

                    if (isBrondolSubKey(key)) {
                        consolidatedBrondol += val;
                        continue;
                    }
                    if (upperKey === 'BRONDOL') {
                        // Only add if not already counted from row.premi
                        if (!hasBrondolFromDetail) {
                            consolidatedBrondol += val;
                            hasBrondolFromDetail = true;
                        }
                        continue;
                    }

                    // Only add if not already set from row.premi (avoid double-counting)
                    if (!premiDetail[upperKey]) {
                        premiDetail[upperKey] = val;
                    }
                }
            }

            // SOURCE 3: row.premi_* flattened top-level fields (fallback for live data)
            // e.g. row.premi_pruning, row.premi_harvesting, row.premi_angkut_material, etc.
            if (Object.keys(premiDetail).length === 0) {
                // Only use flattened fields if we got nothing from nested sources
                for (const [key, value] of Object.entries(row)) {
                    if (!key.startsWith('premi_')) continue;
                    if (key === 'premi_brondol' || key === 'premi_pph' || key === 'premi_detail' || key === 'premi_koreksi') continue;
                    const val = Number(value) || 0;
                    if (val <= 0) continue;

                    const label = normalizePremiKey(key.replace(/^premi_/, ''));
                    if (isBrondolSubKey(label)) {
                        consolidatedBrondol += val;
                        continue;
                    }
                    if (label === 'BRONDOL') {
                        if (!hasBrondolFromDetail) consolidatedBrondol += val;
                        continue;
                    }
                    if (!premiDetail[label]) {
                        premiDetail[label] = val;
                    }
                }
            }

            // BRONDOL: use consolidated value, fallback to row.premi_brondol
            const brondolFinal = consolidatedBrondol > 0 ? consolidatedBrondol : (row.premi_brondol || 0);
            if (brondolFinal > 0) {
                premiDetail['BRONDOL'] = brondolFinal;
            }

            // Resolve jabatan: DB first → auto-derive from gang code
            const empCodeTrimmedJabatan = (row.emp_code || '').trim();
            let resolvedJabatan = jabatanMap[empCodeTrimmedJabatan] || '';
            if (!resolvedJabatan) {
                resolvedJabatan = deriveJabatanFromGang(row.gang_code || '');
                // Store in map so it can be saved later
                jabatanMap[empCodeTrimmedJabatan] = resolvedJabatan;
                newJabatansToSave.push({
                    empcode: empCodeTrimmedJabatan,
                    employee_name: row.nama || row.emp_name || '',
                    gang: row.gang_code || '',
                    divisi_id: effectiveDivisionCode,
                    jabatan: resolvedJabatan
                });
            }

            // Extract parent name from parentheses (e.g., "JOHN DOE (JANE DOE)")
            const rawName = row.nama || row.emp_name || '';
            const { empName, parentName } = extractParentName(rawName);

            return {
                no: idx + 1,
                emp_code: row.emp_code,
                emp_name: empName,
                parent_name: parentName,
                nik: reportIdentity.nik,
                new_nik: reportIdentity.new_nik,
                npwp: reportIdentity.npwp,
                alamat: reportIdentity.alamat,
                jabatan: resolvedJabatan,
                gender: String(row.jenis_kelamin || row.gender || '1'),
                status_ptkp: masterPtkp,
                kategori_ter: kategoriTer,
                gang_code: row.gang_code || '',
                upah_kotor: row.upah_kotor || row.jumlah_upah_kotor || 0,
                penghasilan_bruto: row.penghasilan_bruto || penghasilanBruto,
                tarif_pajak_ter: row.tarif_pajak_ter || tarifPajakTer,
                pph21_ter: pph21,
                // pot_pph21 is the actual PPh21 deduction from PR_ADTRANS (matches Daftar Upah column)
                pot_pph21: potPph21Input,
                component_metadata: TAX_COMPONENT_METADATA,

                // Detailed breakdowns
                hk: row.jumlah_hk || row.hk || 0,
                gaji_pokok_aktual: gajiPokokAktual,
                koreksi_hk: row.koreksi_hk || 0,

                tunjangan_beras: tunjanganBeras,
                tunjangan_jabatan: tunjanganJabatan,
                tunjangan_masa_kerja: tunjanganMasaKerja,
                tunjangan_lembur: tunjanganLembur,
                total_tunjangan: row.total_tunjangan || 0,

                premi_detail: premiDetail,
                premi_brondol: row.premi_brondol || 0,
                premi_pph: row.premi_pph || 0,
                total_premi: totalPremi,

                pot_spsi: row.pot_spsi || 0,
                pot_koreksi: row.pot_koreksi || 0,
                total_potongan_kotor: row.pot_koreksi || 0,

                bpjs_kes_majikan: bpjsKesehatanMajikan4Pct,
                astek_jht_majikan: astek084,

                other_incomes: empOtherIncomes,
                thr_amount: empThrAmount,
                exgratia_amount: empBonusAmount,
                bonus_amount: empBonusAmount,
                kontanan_amount: empKontanAmount,
                pendapatan_thr: empThrAmount,
                pendapatan_bonus: empBonusAmount,
                pendapatan_kontan: empKontanAmount,
                taxable_pendapatan_lainnya: empThrAmount + empBonusAmount + empKontanAmount + empOtherIncomeAmount,
                other_income_amount: empOtherIncomeAmount,
                pendapatan_tidak_tetap_thp: empThrAmount + empBonusAmount + empKontanAmount + empOtherIncomeAmount,
                upah_dasar: upahDasar,
                gaji_pokok_ideal: row.gaji_pokok_ideal || 0,
                carumanBase: carumanBase,
                period_adjustments: row.period_adjustments
            };
        });

        const employees: MonthlyTaxRow[] = sortAndRenumberByEmpCode(mappedEmployees);

        // Collect all unique premi keys across all employees
        // premiDetail already contains clean, normalized keys (no LAINNYA, no brondol sub-keys)
        const premiKeySet = new Set<string>();
        for (const emp of employees) {
            if (emp.premi_detail) {
                for (const k of Object.keys(emp.premi_detail)) {
                    premiKeySet.add(k);
                }
            }
        }
        // Sort: BRONDOL first, then alphabetical
        const premiKeys = Array.from(premiKeySet).sort((a, b) => {
            if (a === 'BRONDOL') return -1;
            if (b === 'BRONDOL') return 1;
            return a.localeCompare(b);
        });

        // Async save any newly derived jabatans to DB
        if (newJabatansToSave.length > 0) {
            EmployeeEstateService.saveEmployeeJobs(newJabatansToSave).catch(e =>
                console.error('[TaxReport] Failed to auto-save derived jabatans:', e)
            );
        }

        const sumMonthly = (selector: (emp: MonthlyTaxRow) => number): number =>
            Math.round(employees.reduce((s, emp) => s + (selector(emp) || 0), 0));

        const monthlyTableTotals = {
            hk: sumMonthly(emp => Number(emp.hk) || 0),
            upah_dasar: sumMonthly(emp => Number(emp.upah_dasar) || 0),
            gaji_pokok_ideal: sumMonthly(emp => Number(emp.gaji_pokok_ideal) || 0),
            gaji_standar: sumMonthly(emp => (Number(emp.upah_dasar) || 0) * 30),
            gaji_pokok_aktual: sumMonthly(emp => Number(emp.gaji_pokok_aktual) || 0),
            koreksi_hk: 0,
            pendapatan_tidak_tetap_thp: sumMonthly(emp => Number(emp.pendapatan_tidak_tetap_thp) || 0),
            upah_kotor: sumMonthly(emp => Number(emp.upah_kotor) || 0),
            penghasilan_bruto: sumMonthly(emp => Number(emp.penghasilan_bruto) || 0),
            pph21_input: sumMonthly(emp => Number(emp.pot_pph21) || 0),
            pph21_ter: sumMonthly(emp => Number(emp.pph21_ter) || 0)
        };

        const finalResult = {
            employees,
            period: { month, year },
            total_pph21: totalPph21,
            total_pot_pph21: monthlyTableTotals.pph21_input,
            premiKeys,
            data_source: finalIsSourceCurrent ? 'current' : 'history',
            value_priority_mode: normalizedValuePriorityMode,
            snapshot_version: historyData.meta?.snapshot_version ?? null,
            requested_snapshot_version: historyData.meta?.requested_snapshot_version ?? null,
            available_snapshot_versions: historyData.meta?.available_snapshot_versions ?? [],
            summary: {
                employee_count: employees.length,
                monthly_table_totals: monthlyTableTotals,
                pph21: {
                    input: monthlyTableTotals.pph21_input,
                    ter: monthlyTableTotals.pph21_ter,
                    selisih: monthlyTableTotals.pph21_ter - monthlyTableTotals.pph21_input
                }
            }
        };

        if (shouldCache) {
            const ttl = cacheService.getPayrollCacheTtl(month, year, currentPeriod.month, currentPeriod.year);
            cacheService.set(cacheKey, finalResult, ttl);
        }

        console.log(`[TaxReportService] getMonthlyTaxReport returning: ${employees.length} employees, total_pph21=${totalPph21}, data_source=${finalIsSourceCurrent ? 'current' : 'history'}`);
        return finalResult;
    }

    /**
     * Get annual tax report — aggregate 12 months of income data
     */
    public async getAnnualTaxReport(
        year: number,
        targetMonth?: number,
        divisionCode?: string,
        gangCode?: string,
        gangPrefix?: string
    ): Promise<any> {
        // Reuse the same scope contract as monthly tax report so virtual divisions
        // behave identically in annual aggregation paths.
        const divisionScope = resolveTaxReportDivisionScope({ divisionCode, gangPrefix });

        // Collect all monthly data
        const monthlyResults: Map<string, any[]> = new Map();
        const availableMonths: number[] = [];

        // Fetch all 12 months concurrently
        const monthPromises = [];
        for (let m = 1; m <= 12; m++) {
            monthPromises.push(
                this.fetchPayrollData(
                    m, year, divisionScope.fetchDivisionCode, gangCode || 'ALL', divisionScope.gangPrefix
                ).then(({ data }) => ({ month: m, data }))
            );
        }

        const allMonthData = await Promise.all(monthPromises);

        // Fetch PTKP mapping for this year
        const ptkpMaster = await ptkpTaxService.getPtkpByYear(year);
        const ptkpMap = new Map<string, string>();
        for (const p of ptkpMaster) {
            ptkpMap.set(p.emp_code.trim(), p.ptkp_status);
        }

        // Build employee map
        const employeeMap = new Map<string, {
            emp_name: string;
            parent_name?: string;
            nik: string;
            gender: string;
            status_ptkp: string;
            kategori_ter: string;
            monthly_income: Record<string, number>;
            monthly_pph21: Record<string, number>;
            monthly_pph21_adtrans: Record<string, number>;
            monthly_astek_pekerja: Record<string, number>;
            monthly_bpjs_pensiun_pekerja: Record<string, number>;
            monthly_bpjs_kes_majikan: Record<string, number>;
            monthly_astek_majikan: Record<string, number>;
            monthly_astek_jumlah: Record<string, number>;
            monthly_thr_factors: Record<string, { masa_kerja_tahun: number, upah_dasar: number, beras_rate: number, masa_kerja_jumlah: number }>;
            monthly_details: Record<string, { hk: number, gaji_pokok: number, masa_kerja: number, upah_dasar: number }>;
            was_in_target_gang: boolean;
        }>();

        // Load THR and Exgratia mappings + active THR Periode BEFORE the loop
        const { thrMap, exgratiaMap } = loadThrBonusMaps();
        const activeThr = loadActiveThrPeriode();

        // --- Fetch Database Other Incomes for the Year ---
        const dbOtherIncomesYear = await OtherIncomesService.getIncomesForYear(year, divisionScope.fetchDivisionCode, gangCode);
        const dbIncomeByMonthNik = new Map<string, { thr: number, bonus: number, kontan: number, custom: number }>();
        const dbIncomeByNik = new Map<string, { thr: number, bonus: number, kontan: number, custom: number }>();

        for (const inc of dbOtherIncomesYear) {
            if (inc.is_taxable) {
                const nikKeys = collectNikLookupKeys(inc);
                const amt = Number(inc.amount) || 0;
                const type = getCanonicalOtherIncomeType(inc);

                for (const nik of nikKeys) {
                    const monthKey = `${inc.period_month}_${nik}`;
                    if (!dbIncomeByMonthNik.has(monthKey)) dbIncomeByMonthNik.set(monthKey, { thr: 0, bonus: 0, kontan: 0, custom: 0 });
                    const mData = dbIncomeByMonthNik.get(monthKey)!;
                    if (!dbIncomeByNik.has(nik)) dbIncomeByNik.set(nik, { thr: 0, bonus: 0, kontan: 0, custom: 0 });
                    const yData = dbIncomeByNik.get(nik)!;

                    if (type === 'THR') { mData.thr += amt; yData.thr += amt; }
                    else if (type === 'KONTAN') { mData.kontan += amt; yData.kontan += amt; }
                    else if (type === 'BONUS') { mData.bonus += amt; yData.bonus += amt; }
                    else { mData.custom += amt; yData.custom += amt; }
                }
            }
        }

        // --- Fetch PPH dari history_adtrans (sumber utama) untuk seluruh tahun ---
        const adtransPphByYear = await historyDatabaseService.getPphFromAdtransByYear(
            year, divisionScope.fetchDivisionCode, gangCode
        );

        for (const { month, data } of allMonthData) {
            if (!data || data.data_rows.length === 0) continue;
            availableMonths.push(month);

            const filteredRows = filterTaxReportRows(data.data_rows, divisionScope);

            for (const row of filteredRows) {
                const empCode = row.emp_code;
                const rawName = row.nama || row.emp_name || '';
                const { empName, parentName } = extractParentName(rawName);
                const reportIdentity = resolveReportIdentity(row);
                
                if (!employeeMap.has(empCode)) {
                    employeeMap.set(empCode, {
                        emp_name: empName,
                        parent_name: parentName,
                        nik: reportIdentity.nik,
                        new_nik: reportIdentity.new_nik,
                        gender: row.jenis_kelamin || '',
                        status_ptkp: row.status_ptkp || '',
                        kategori_ter: row.kategori_ter || '',
                        monthly_income: {},
                        monthly_pph21: {},
                        monthly_pph21_adtrans: {},
                        monthly_astek_pekerja: {},
                        monthly_bpjs_pensiun_pekerja: {},
                        monthly_bpjs_kes_majikan: {},
                        monthly_astek_majikan: {},
                        monthly_astek_jumlah: {},
                        monthly_thr_factors: {},
                        monthly_details: {},
                        was_in_target_gang: false,
                    });
                }

                const emp = employeeMap.get(empCode)!;
                // Use jumlah_upah_kotor as monthly income (upah kotor already has pot_koreksi subtracted)
                // pot_koreksi is a deduction that REDUCES upah kotor, NOT adds to it
                emp.monthly_income[String(month)] = (row.jumlah_upah_kotor !== undefined ? row.jumlah_upah_kotor : null) || row.penghasilan_bruto || 0;
                const empCodeTrimmed = empCode?.trim() || '';
                const masterPtkp = ptkpMap.get(empCodeTrimmed) || row.status_ptkp || 'TK/0';
                const kategoriTer = mapPTKPToTER(masterPtkp);

                // Calculate PPh21 on the fly (TER) untuk report pajak
                // storedPph21 dari pot_pph21 hanya untuk referensi, TIDAK digunakan di report

                const gajiPokokAktual = row.gaji_pokok_aktual || row.gaji_pokok || 0;
                const upahDasar = row.upah_dasar || 0;
                const tunjanganBeras = row.beras_jumlah || 0;
                const tunjanganJabatan = row.jabatan_jumlah || 0;
                const tunjanganMasaKerja = row.masa_kerja_jumlah || 0;
                const tunjanganLembur = row.lembur_jumlah || 0;
                const totalPremi = row.total_premi || 0;

                // [CENTRALIZED] Calculate ASTEK 0.84% and BPJS Kes 4% from carumanDefinitions
                const pph21Caruman = getCarumanForPph21(upahDasar, tunjanganMasaKerja);
                const astek084 = pph21Caruman.astek_majikan_084;
                const bpjsKesehatanMajikan4Pct = pph21Caruman.bpjs_kes_majikan_4;
                const carumanBase = pph21Caruman.base;

                // [CRITICAL FIX] Use same formula as DataExtractorService for consistency
                // Formula: penghasilan_bruto = jumlah_upah_kotor + astek_m + bpjs_m
                // where jumlah_upah_kotor already includes pot_koreksi (as negative value)
                const storedPenghasilanBruto = parseFloat(row.penghasilan_bruto) || 0;
                const storedJumlahUpahKotor = parseFloat(row.jumlah_upah_kotor) || 0;
                let penghasilanBruto: number;

                if (storedPenghasilanBruto > 0) {
                    penghasilanBruto = storedPenghasilanBruto;
                } else if (storedJumlahUpahKotor !== 0) {
                    // Use same formula as DataExtractorService
                    penghasilanBruto = storedJumlahUpahKotor + astek084 + bpjsKesehatanMajikan4Pct;
                } else {
                    // True last resort - without pot_koreksi deduction
                    penghasilanBruto = pph21TerService.calculatePenghasilanBruto(
                        gajiPokokAktual, tunjanganBeras, tunjanganJabatan, tunjanganMasaKerja,
                        tunjanganLembur, totalPremi, astek084, bpjsKesehatanMajikan4Pct, 0,
                        0 // No pendapatan_lainnya for annual
                    );
                }

                // Jika ada THR/Exgratia, tetap tambahkan ke bruto untuk keperluan perhitungan setahun
                const isThrMonth = activeThr && activeThr.month === month && activeThr.year === year;
                let thrAmount = 0;
                let bonusAmount = 0;
                let kontanAmount = 0;
                let otherIncomeAmount = 0;

                const rawEmpNik = String(reportIdentity.new_nik || reportIdentity.nik || row.nik_ktp || row.nik || '').trim().toUpperCase();

                if (isThrMonth) {
                    const masaKerjaTahun = row.masa_kerja_tahun || 0;
                    if (masaKerjaTahun >= 1) {
                        const upahDasar = row.upah_dasar || 0;
                        const berasRate = row.beras_rate || 0;
                        thrAmount = (upahDasar * 30) + (berasRate * 30) + tunjanganMasaKerja;
                    }

                    let rawEmpName = String(row.nama || row.emp_name || '').toUpperCase();
                    rawEmpName = rawEmpName.replace(/\s*\([^)]*\)\s*/g, '').trim();
                    const firstName = rawEmpName.split(' ')[0].trim();

                    if (exgratiaMap.has(rawEmpNik)) {
                        bonusAmount = exgratiaMap.get(rawEmpNik)!;
                    } else if (exgratiaMap.has(rawEmpName)) {
                        bonusAmount = exgratiaMap.get(rawEmpName)!;
                    } else {
                        for (const [jsonName] of thrMap.entries()) {
                            if (jsonName === firstName || rawEmpName.startsWith(jsonName)) {
                                bonusAmount = exgratiaMap.get(jsonName) || 0;
                                break;
                            }
                        }
                    }
                }

                // Database Overrides & Custom Incomes
                const dbKey = `${month}_${rawEmpNik}`;
                if (dbIncomeByMonthNik.has(dbKey)) {
                    const dbData = dbIncomeByMonthNik.get(dbKey)!;
                    if (dbData.thr > 0) thrAmount = dbData.thr;
                    if (dbData.bonus > 0) bonusAmount = dbData.bonus;
                    if (dbData.kontan > 0) kontanAmount = dbData.kontan;
                    if (dbData.custom > 0) otherIncomeAmount = dbData.custom;
                }

                penghasilanBruto += (thrAmount + bonusAmount + kontanAmount + otherIncomeAmount);

                // PPh21 TER calculation (untuk report pajak / kalkulasi)
                const pphResult = pph21TerService.calculatePph21Ter(penghasilanBruto, masterPtkp);
                emp.monthly_pph21[String(month)] = pphResult.tax_amount;

                // PPH21 dari ADTrans (untuk tab Historis PPH21 saja)
                const adtransPphYear = adtransPphByYear.get((empCode || '').trim());
                const adtransPphVal = adtransPphYear ? (adtransPphYear.get(month) || 0) : 0;
                emp.monthly_pph21_adtrans[String(month)] = adtransPphVal;

                emp.monthly_astek_pekerja[String(month)] = row.pot_astek || 0;
                emp.monthly_bpjs_pensiun_pekerja[String(month)] = row.pot_bpjs_pensiun_pekerja || 0;
                emp.monthly_bpjs_kes_majikan[String(month)] = row.pot_bpjs_kesehatan_majikan || 0;
                emp.monthly_astek_majikan[String(month)] = row.pot_astek_maj || 0;
                emp.monthly_astek_jumlah[String(month)] = (row.pot_astek || 0) + (row.pot_astek_maj || 0);

                emp.monthly_details[String(month)] = {
                    hk: row.jumlah_hk || row.hk || 0,
                    gaji_pokok: gajiPokokAktual,
                    masa_kerja: tunjanganMasaKerja,
                    upah_dasar: row.upah_dasar || 0
                };

                emp.monthly_thr_factors[String(month)] = {
                    masa_kerja_tahun: row.masa_kerja_tahun || 0,
                    upah_dasar: row.upah_dasar || 0,
                    beras_rate: row.beras_rate || 0,
                    masa_kerja_jumlah: row.masa_kerja_jumlah || 0
                };

                // Update PTKP/TER if newer month has data
                if (masterPtkp) emp.status_ptkp = masterPtkp;
                if (kategoriTer) emp.kategori_ter = kategoriTer;

                // Check if employee matches target criteria
                if ((targetMonth === undefined || month === targetMonth) &&
                    (!gangCode || gangCode === 'ALL' || row.gang_code === gangCode)) {
                    emp.was_in_target_gang = true;
                }
            }
        }


        // Calculate annual totals
        let employees: AnnualIncomeRow[] = [];
        let idx = 0;

        for (const [empCode, emp] of employeeMap) {
            if (!emp.was_in_target_gang) continue; // Only include employees from the target gang & month

            idx++;

            const totalIncome = Object.values(emp.monthly_income).reduce((sum, v) => sum + v, 0);

            let gajiJanNov = 0;
            let masaKerjaJanNov = 0;
            let astek084pct = 0;
            let astekIns2pct = 0;
            let pensiun1pct = 0;

            let totalDasarCaruman084 = 0; // For accumulating base (Gaji Standar + Masa Kerja) before percentage

            const monthlyGajiKotor: Record<string, number> = {};
            const monthlyMasaKerja: Record<string, number> = {};
            const monthlyBpjsKesehatan: Record<string, number> = {};
            const monthlyAstekIns084: Record<string, number> = {};
            const monthlyAstekIns2: Record<string, number> = {};
            const monthlyPensiun1: Record<string, number> = {};

            // Calculate Jan-Nov totals and manual Astek/Pensiun
            for (let m = 1; m <= 11; m++) {
                const income = emp.monthly_income[String(m)] || 0;
                const details = emp.monthly_details[String(m)];

                if (details) {
                    const gajiKotor = income;
                    masaKerjaJanNov += details.masa_kerja;
                    gajiJanNov += gajiKotor; // Gaji Kotor includes Masa Kerja

                    monthlyGajiKotor[String(m)] = gajiKotor;
                    monthlyMasaKerja[String(m)] = details.masa_kerja;

                    // Accumulate base for Astek 0.84%
                    totalDasarCaruman084 += (details.upah_dasar * 30) + details.masa_kerja;

                    // [CENTRALIZED] Kalkulasi via carumanDefinitions
                    const monthCaruman = calculateAllCaruman(details.upah_dasar, details.masa_kerja);
                    const bpjsKesVal = monthCaruman.bpjs_kes_majikan;
                    const astek084Val = monthCaruman.astek_majikan_jkk_jkm;
                    const astek2Val = monthCaruman.astek_pekerja_jht;
                    const pensiun1Val = monthCaruman.bpjs_pensiun_pekerja;

                    // astek084pct is calculated after loop from accumulated base
                    astekIns2pct += astek2Val;
                    pensiun1pct += pensiun1Val;

                    monthlyBpjsKesehatan[String(m)] = bpjsKesVal;
                    monthlyAstekIns084[String(m)] = astek084Val;
                    monthlyAstekIns2[String(m)] = astek2Val;
                    monthlyPensiun1[String(m)] = pensiun1Val;
                } else if (income > 0) {
                    // Fallback if no details
                    gajiJanNov += income;
                    monthlyGajiKotor[String(m)] = income;
                    monthlyMasaKerja[String(m)] = 0;
                    monthlyBpjsKesehatan[String(m)] = 0;
                    monthlyAstekIns084[String(m)] = 0;
                    monthlyAstekIns2[String(m)] = 0;
                    monthlyPensiun1[String(m)] = 0;
                }
            }

            // Diakumulasi dulu base-nya lalu persentasenya dikalikan menggunakan service OOP caruman
            const accumCaruman = calculateAllCaruman(totalDasarCaruman084 / 30, 0);
            astek084pct = accumCaruman.astek_majikan_jkk_jkm;

            // Fetch variables for specific lookup
            const rawEmpNik = String(emp.nik || '').trim().toUpperCase();
            let rawEmpName = String(emp.emp_name || '').toUpperCase();

            // Remove alias in brackets e.g. "HERI GUNAWAN (SALMAH)" -> "HERI GUNAWAN"
            rawEmpName = rawEmpName.replace(/\s*\(.*?\)\s*/g, '').trim();
            const firstName = rawEmpName.split(' ')[0].trim();

            let thr = 0;
            let customIncomeYear = 0;

            // 1. Dynamic THR Calculation (Fallback)
            if (activeThr) {
                // Get factors from the specific THR month, fallback to latest available month
                let thrFactors = emp.monthly_thr_factors[String(activeThr.month)];
                if (!thrFactors) {
                    for (let m = 12; m >= 1; m--) {
                        if (emp.monthly_thr_factors[String(m)]) {
                            thrFactors = emp.monthly_thr_factors[String(m)];
                            break;
                        }
                    }
                }

                if (thrFactors && thrFactors.masa_kerja_tahun >= 1) {
                    thr = (thrFactors.upah_dasar * 30) + (thrFactors.beras_rate * 30) + thrFactors.masa_kerja_jumlah;
                }
            }

            // 2. Fetch Exgratia (Bonus) from Static JSON (Fallback)
            let bonus = 0;
            let kontanIncomeYear = 0;
            if (exgratiaMap.has(rawEmpNik)) {
                bonus = exgratiaMap.get(rawEmpNik)!;
            } else if (exgratiaMap.has(rawEmpName)) {
                bonus = exgratiaMap.get(rawEmpName)!;
            } else {
                for (const [jsonName, jsonThr] of thrMap.entries()) {
                    if (jsonName === firstName || rawEmpName.startsWith(jsonName)) {
                        bonus = exgratiaMap.get(jsonName) || 0;
                        break;
                    }
                }
            }

            // 3. Database Overrides & Custom Incomes
            if (dbIncomeByNik.has(rawEmpNik)) {
                const dbData = dbIncomeByNik.get(rawEmpNik)!;
                if (dbData.thr > 0) thr = dbData.thr;
                if (dbData.bonus > 0) bonus = dbData.bonus;
                if (dbData.kontan > 0) kontanIncomeYear = dbData.kontan;
                if (dbData.custom > 0) customIncomeYear = dbData.custom;
            }

            // BPJS Kesehatan 4% of total income (employer portion accumulated - typically Jan-Nov based on requirements, but using raw history if not strictly told otherwise. We will use 1-11 to be safe)
            let bpjsKes4pct = 0;
            for (let m = 1; m <= 11; m++) {
                bpjsKes4pct += emp.monthly_bpjs_kes_majikan[String(m)] || 0;
            }

            // ASTEK JHT (Total if needed for other tabs)
            const astekJht = Object.values(emp.monthly_astek_jumlah).reduce((sum, v) => sum + v, 0);

            // Total penghasilan setahun (Gaji + Masa Kerja + BPJS 4% + Astek 0.84% + THR + Bonus) as per image structure calculation
            const totalPenghasilanSetahun = gajiJanNov + masaKerjaJanNov + bpjsKes4pct + astek084pct + thr + bonus + kontanIncomeYear + customIncomeYear;

            // Biaya Jabatan: 5% of Total Penghasilan Setahun, max 6.000.000
            const biayaJabatan = Math.min(totalPenghasilanSetahun * 0.05, 6000000);

            // Total potongan
            const totalPotongan = astekIns2pct + biayaJabatan + pensiun1pct;

            // Penghasilan Netto Setahun
            const penghasilanNetto = totalPenghasilanSetahun - totalPotongan;

            // PTKP from rules (using ptkp_pajak, not beras)
            const ptkpValue = getPtkpValue(emp.status_ptkp);

            // Penghasilan Kena Pajak
            const pkp = Math.max(0, penghasilanNetto - ptkpValue);

            // PPH21 calculation on PKP (progressive rate)
            const pph21 = this.calculateProgressivePph21(pkp);

            employees.push({
                no: idx,
                emp_code: empCode,
                emp_name: emp.emp_name,
                nik: emp.nik,
                gender: emp.gender,
                status_ptkp: emp.status_ptkp,
                kategori_ter: emp.kategori_ter,
                // Monthly income (upah kotor / penghasilan bruto per bulan)
                monthly_income: emp.monthly_income,
                monthly_gaji_kotor: monthlyGajiKotor,
                monthly_masa_kerja: monthlyMasaKerja,
                monthly_bpjs_kesehatan: monthlyBpjsKesehatan,
                monthly_astek_ins_084: monthlyAstekIns084,
                monthly_astek_ins_2: monthlyAstekIns2,
                monthly_pensiun_1: monthlyPensiun1,
                monthly_pph21: emp.monthly_pph21,
                monthly_pph21_adtrans: emp.monthly_pph21_adtrans,
                total_income: totalIncome,
                gaji_jan_nov: gajiJanNov,
                masa_kerja_jan_nov: masaKerjaJanNov,
                thr: thr, // Fetched from static JSON / Dynamic formula
                bonus,
                kontanan: kontanIncomeYear,
                medical_claim: 0, // Header only
                bpjs_kesehatan_4pct: bpjsKes4pct,
                astek_084pct: astek084pct,
                total_penghasilan_setahun: totalPenghasilanSetahun,
                astek_ins_2pct: astekIns2pct,
                biaya_jabatan: biayaJabatan,
                pensiun_1pct: pensiun1pct,
                total_potongan_tahunan: totalPotongan,
                penghasilan_netto_setahun: penghasilanNetto,
                ptkp: ptkpValue,
                penghasilan_kena_pajak: pkp,
                pph21_kena_pajak: pph21,
            });
        }

        employees = sortAndRenumberByEmpCode(employees);

        const monthlyTotalsByMode = {
            gaji: Array.from({ length: 12 }, (_, m) =>
                Math.round(employees.reduce((s, e) => s + (Number(e.monthly_gaji_kotor?.[String(m + 1)]) || 0), 0))
            ),
            bpjs_kesehatan: Array.from({ length: 12 }, (_, m) =>
                Math.round(employees.reduce((s, e) => s + (Number(e.monthly_bpjs_kesehatan?.[String(m + 1)]) || 0), 0))
            ),
            astek_ins_084: Array.from({ length: 12 }, (_, m) =>
                Math.round(employees.reduce((s, e) => s + (Number(e.monthly_astek_ins_084?.[String(m + 1)]) || 0), 0))
            ),
            astek_ins_2: Array.from({ length: 12 }, (_, m) =>
                Math.round(employees.reduce((s, e) => s + (Number(e.monthly_astek_ins_2?.[String(m + 1)]) || 0), 0))
            ),
            pensiun_1: Array.from({ length: 12 }, (_, m) =>
                Math.round(employees.reduce((s, e) => s + (Number(e.monthly_pensiun_1?.[String(m + 1)]) || 0), 0))
            ),
            pph21_adtrans: Array.from({ length: 12 }, (_, m) =>
                Math.round(employees.reduce((s, e) => s + (Number(e.monthly_pph21_adtrans?.[String(m + 1)]) || 0), 0))
            )
        };

        const annualSummary = {
            employee_count: employees.length,
            penghasilan: {
                monthly_totals_by_mode: monthlyTotalsByMode,
                totals: {
                    gaji: Math.round(employees.reduce((s, e) => s + (Number(e.gaji_jan_nov) || 0), 0)),
                    bpjs_kesehatan: Math.round(employees.reduce((s, e) => s + (Number(e.bpjs_kesehatan_4pct) || 0), 0)),
                    astek_ins_084: Math.round(employees.reduce((s, e) => s + (Number(e.astek_084pct) || 0), 0)),
                    astek_ins_2: Math.round(employees.reduce((s, e) => s + (Number(e.astek_ins_2pct) || 0), 0)),
                    pensiun_1: Math.round(employees.reduce((s, e) => s + (Number(e.pensiun_1pct) || 0), 0)),
                    thr: Math.round(employees.reduce((s, e) => s + (Number(e.thr) || 0), 0)),
                    bonus: Math.round(employees.reduce((s, e) => s + (Number(e.bonus) || 0), 0)),
                    total_setahun: Math.round(employees.reduce((s, e) => s + ((Number(e.gaji_jan_nov) || 0) + (Number(e.thr) || 0) + (Number(e.bonus) || 0)), 0)),
                    ptkp: Math.round(employees.reduce((s, e) => s + (Number(e.ptkp) || 0), 0)),
                    pkp: Math.round(employees.reduce((s, e) => s + (Number(e.penghasilan_kena_pajak) || 0), 0))
                }
            },
            kalkulasi: {
                totals: {
                    gaji_jan_nov: Math.round(employees.reduce((s, e) => s + (Number(e.gaji_jan_nov) || 0), 0)),
                    thr: Math.round(employees.reduce((s, e) => s + (Number(e.thr) || 0), 0)),
                    bonus: Math.round(employees.reduce((s, e) => s + (Number(e.bonus) || 0), 0)),
                    bpjs_kesehatan_4pct: Math.round(employees.reduce((s, e) => s + (Number(e.bpjs_kesehatan_4pct) || 0), 0)),
                    astek_084pct: Math.round(employees.reduce((s, e) => s + (Number(e.astek_084pct) || 0), 0)),
                    total_penghasilan_setahun: Math.round(employees.reduce((s, e) => s + (Number(e.total_penghasilan_setahun) || 0), 0)),
                    astek_ins_2pct: Math.round(employees.reduce((s, e) => s + (Number(e.astek_ins_2pct) || 0), 0)),
                    biaya_jabatan: Math.round(employees.reduce((s, e) => s + (Number(e.biaya_jabatan) || 0), 0)),
                    pensiun_1pct: Math.round(employees.reduce((s, e) => s + (Number(e.pensiun_1pct) || 0), 0)),
                    total_potongan_tahunan: Math.round(employees.reduce((s, e) => s + (Number(e.total_potongan_tahunan) || 0), 0)),
                    penghasilan_netto_setahun: Math.round(employees.reduce((s, e) => s + (Number(e.penghasilan_netto_setahun) || 0), 0)),
                    ptkp: Math.round(employees.reduce((s, e) => s + (Number(e.ptkp) || 0), 0)),
                    pkp: Math.round(employees.reduce((s, e) => s + (Number(e.penghasilan_kena_pajak) || 0), 0)),
                    pph21_kena_pajak: Math.round(employees.reduce((s, e) => s + (Number(e.pph21_kena_pajak) || 0), 0))
                }
            },
            monthly_pph21_adtrans_totals: monthlyTotalsByMode.pph21_adtrans
        };

        return {
            employees,
            year,
            available_months: availableMonths.sort((a, b) => a - b),
            summary: annualSummary
        };
    }

    /**
     * Get annual ASTEK & BPJS report — per month per employee
     */
    public async getAnnualAstekBpjsReport(
        year: number,
        targetMonth?: number,
        divisionCode?: string,
        gangCode?: string,
        gangPrefix?: string
    ): Promise<any> {
        // ASTEK/BPJS report follows the same virtual-division scope contract.
        const divisionScope = resolveTaxReportDivisionScope({ divisionCode, gangPrefix });

        const availableMonths: number[] = [];

        // Fetch all 12 months concurrently
        const monthPromises = [];
        for (let m = 1; m <= 12; m++) {
            monthPromises.push(
                this.fetchPayrollData(
                    m, year, divisionScope.fetchDivisionCode, gangCode || 'ALL', divisionScope.gangPrefix
                ).then(({ data }) => ({ month: m, data }))
            );
        }

        const allMonthData = await Promise.all(monthPromises);

        const employeeMap = new Map<string, {
            emp_name: string;
            parent_name?: string;
            nik: string;
            monthly_data: Record<string, {
                upah_dasar: number;
                gaji_pokok: number;
                astek_pekerja: number;
                astek_majikan: number;
                bpjs_kes_pekerja: number;
                bpjs_kes_majikan: number;
                bpjs_pensiun_pekerja: number;
                bpjs_pensiun_majikan: number;
                masa_kerja: number;
            }>;
            was_in_target_gang: boolean;
        }>();

        for (const { month, data } of allMonthData) {
            if (!data || data.data_rows.length === 0) continue;
            availableMonths.push(month);

            const filteredRows = filterTaxReportRows(data.data_rows, divisionScope);

            for (const row of filteredRows) {
                const empCode = row.emp_code;
                const rawName = row.nama || row.emp_name || '';
                const { empName, parentName } = extractParentName(rawName);
                
                if (!employeeMap.has(empCode)) {
                    employeeMap.set(empCode, {
                        emp_name: empName,
                        parent_name: parentName,
                        nik: row.nik || '',
                        monthly_data: {},
                        was_in_target_gang: false,
                    });
                }

                const emp = employeeMap.get(empCode)!;

                // [CENTRALIZED] Calculate via carumanDefinitions
                const upahDasar = row.upah_dasar || 0;
                const gajiPokokBpjs = upahDasar * 30;  // Gaji Pokok = Upah Dasar × 30
                const masaKerja = row.masa_kerja_jumlah || 0;
                const monthCaruman = calculateAllCaruman(upahDasar, masaKerja);

                emp.monthly_data[String(month)] = {
                    upah_dasar: upahDasar,
                    gaji_pokok: gajiPokokBpjs,
                    astek_pekerja: monthCaruman.astek_pekerja_jht,
                    astek_majikan: monthCaruman.astek_majikan_jkk_jkm,
                    bpjs_kes_pekerja: monthCaruman.bpjs_kes_pekerja,
                    bpjs_kes_majikan: monthCaruman.bpjs_kes_majikan,
                    bpjs_pensiun_pekerja: monthCaruman.bpjs_pensiun_pekerja,
                    bpjs_pensiun_majikan: monthCaruman.bpjs_pensiun_majikan,
                    masa_kerja: masaKerja
                };

                // Check if employee matches target criteria
                if ((targetMonth === undefined || month === targetMonth) &&
                    (!gangCode || gangCode === 'ALL' || row.gang_code === gangCode)) {
                    emp.was_in_target_gang = true;
                }
            }
        }

        let employees: AstekBpjsMonthlyRow[] = [];
        let idx = 0;

        for (const [empCode, emp] of employeeMap) {
            if (!emp.was_in_target_gang) continue; // Filter by target criteria

            idx++;

            const total = {
                upah_dasar: 0,
                gaji_pokok: 0,
                astek_pekerja: 0,
                astek_majikan: 0,
                bpjs_kes_pekerja: 0,
                bpjs_kes_majikan: 0,
                bpjs_pensiun_pekerja: 0,
                bpjs_pensiun_majikan: 0,
                masa_kerja: 0,
            };

            for (const monthData of Object.values(emp.monthly_data)) {
                total.upah_dasar += monthData.upah_dasar || 0;
                total.gaji_pokok += monthData.gaji_pokok || 0;
                total.astek_pekerja += monthData.astek_pekerja;
                total.astek_majikan += monthData.astek_majikan;
                total.bpjs_kes_pekerja += monthData.bpjs_kes_pekerja;
                total.bpjs_kes_majikan += monthData.bpjs_kes_majikan;
                total.bpjs_pensiun_pekerja += monthData.bpjs_pensiun_pekerja;
                total.bpjs_pensiun_majikan += monthData.bpjs_pensiun_majikan;
                total.masa_kerja += monthData.masa_kerja || 0;
            }

            // Diakumulasi persentasenya dari total base menggunakan OOP/Centralized Service
            total.astek_majikan = calculateAllCaruman((total.gaji_pokok + total.masa_kerja) / 30, 0).astek_majikan_jkk_jkm;

            employees.push({
                no: idx,
                emp_code: empCode,
                emp_name: emp.emp_name,
                nik: emp.nik,
                monthly_data: emp.monthly_data,
                total,
            });
        }

        employees = sortAndRenumberByEmpCode(employees);

        const modeKeys = [
            'bpjs_kes_majikan',
            'bpjs_kes_pekerja',
            'astek_majikan',
            'astek_pekerja',
            'bpjs_pensiun_majikan',
            'bpjs_pensiun_pekerja'
        ] as const;

        const monthlyTotalsByMode: Record<string, number[]> = {
            total: Array.from({ length: 12 }, (_, m) =>
                Math.round(
                    employees.reduce((s, emp) => {
                        const md = emp.monthly_data?.[String(m + 1)];
                        if (!md) return s;
                        return s
                            + (Number(md.astek_pekerja) || 0)
                            + (Number(md.astek_majikan) || 0)
                            + (Number(md.bpjs_kes_pekerja) || 0)
                            + (Number(md.bpjs_kes_majikan) || 0)
                            + (Number(md.bpjs_pensiun_pekerja) || 0)
                            + (Number(md.bpjs_pensiun_majikan) || 0);
                    }, 0)
                )
            )
        };

        for (const mode of modeKeys) {
            monthlyTotalsByMode[mode] = Array.from({ length: 12 }, (_, m) =>
                Math.round(
                    employees.reduce((s, emp) => {
                        const md = emp.monthly_data?.[String(m + 1)] as any;
                        return s + (Number(md?.[mode]) || 0);
                    }, 0)
                )
            );
        }

        const annualTotalsByMode: Record<string, number> = {
            total: Math.round(
                employees.reduce((s, emp) =>
                    s
                    + (Number(emp.total?.astek_pekerja) || 0)
                    + (Number(emp.total?.astek_majikan) || 0)
                    + (Number(emp.total?.bpjs_kes_pekerja) || 0)
                    + (Number(emp.total?.bpjs_kes_majikan) || 0)
                    + (Number(emp.total?.bpjs_pensiun_pekerja) || 0)
                    + (Number(emp.total?.bpjs_pensiun_majikan) || 0), 0)
            )
        };

        for (const mode of modeKeys) {
            annualTotalsByMode[mode] = Math.round(
                employees.reduce((s, emp) => s + (Number((emp.total as any)?.[mode]) || 0), 0)
            );
        }

        return {
            employees,
            year,
            available_months: availableMonths.sort((a, b) => a - b),
            summary: {
                employee_count: employees.length,
                monthly_totals_by_mode: monthlyTotalsByMode,
                annual_totals_by_mode: annualTotalsByMode
            }
        };
    }

    /**
     * Calculate progressive PPH21 from PKP (Penghasilan Kena Pajak)
     * Progressive tariff:
     *   0 - 60.000.000  => 5%
     *   60.000.001 - 250.000.000 => 15%
     *   250.000.001 - 500.000.000 => 25%
     *   500.000.001 - 5.000.000.000 => 30%
     *   > 5.000.000.000 => 35%
     */
    private calculateProgressivePph21(pkp: number): number {
        if (pkp <= 0) return 0;

        let tax = 0;
        const brackets = [
            { limit: 60000000, rate: 0.05 },
            { limit: 250000000, rate: 0.15 },
            { limit: 500000000, rate: 0.25 },
            { limit: 5000000000, rate: 0.30 },
            { limit: Infinity, rate: 0.35 },
        ];

        let remaining = pkp;
        let prevLimit = 0;

        for (const bracket of brackets) {
            const taxable = Math.min(remaining, bracket.limit - prevLimit);
            if (taxable <= 0) break;
            tax += taxable * bracket.rate;
            remaining -= taxable;
            prevLimit = bracket.limit;
        }

        return Math.round(tax);
    }

    public async getDecemberTaxReport(
        year: number,
        divisionCode?: string,
        gangCode?: string,
        gangPrefix?: string
    ): Promise<any> {
        // December report also keeps virtual divisions in-request, then filters rows
        // with the same helper to avoid divergence from monthly/annual logic.
        const divisionScope = resolveTaxReportDivisionScope({ divisionCode, gangPrefix });

        // Collect all monthly data
        const availableMonths: number[] = [];
        const monthPromises = [];
        for (let m = 1; m <= 12; m++) {
            monthPromises.push(
                this.fetchPayrollData(
                    m, year, divisionScope.fetchDivisionCode, gangCode || 'ALL', divisionScope.gangPrefix
                ).then(({ data }) => ({ month: m, data }))
            );
        }

        const allMonthData = await Promise.all(monthPromises);
        const { thrMap, exgratiaMap } = loadThrBonusMaps();
        const activeThr = loadActiveThrPeriode();

        // Fetch PTKP mapping for this year
        const ptkpMaster = await ptkpTaxService.getPtkpByYear(year);
        const ptkpMap = new Map<string, string>();
        for (const p of ptkpMaster) {
            ptkpMap.set(p.emp_code.trim(), p.ptkp_status);
        }

        // Fetch jabatan from employee_estate database
        const jabatanMap = await EmployeeEstateService.getEmployeeJobs();
        const newJabatansToSave: any[] = [];

        const employeeMap = new Map<string, any>();

        for (const { month, data } of allMonthData) {
            if (!data || data.data_rows.length === 0) continue;
            availableMonths.push(month);

            const filteredRows = filterTaxReportRows(data.data_rows, divisionScope);
            for (const row of filteredRows) {
                const empCode = row.emp_code;
                const reportIdentity = resolveReportIdentity(row);
                if (!employeeMap.has(empCode)) {
                    // Auto-fill jabatan for December report
                    const trimmedEmpCode = (empCode || '').trim();
                    let resolvedJabatan = jabatanMap[trimmedEmpCode] || row.jabatan || '';
                    if (!resolvedJabatan) {
                        resolvedJabatan = deriveJabatanFromGang(row.gang_code || '');
                        jabatanMap[trimmedEmpCode] = resolvedJabatan;
                        newJabatansToSave.push({
                            empcode: trimmedEmpCode,
                            employee_name: row.nama || row.emp_name || '',
                            gang: row.gang_code || '',
                            divisi_id: divisionScope.fetchDivisionCode,
                            jabatan: resolvedJabatan
                        });
                    }

                    const rawName = row.nama || row.emp_name || '';
                    const { empName, parentName } = extractParentName(rawName);

                    employeeMap.set(empCode, {
                        emp_code: empCode,
                        emp_name: empName,
                        parent_name: parentName,
                        nik: reportIdentity.nik,
                        new_nik: reportIdentity.new_nik,
                        npwp: reportIdentity.npwp,
                        alamat: reportIdentity.alamat,
                        jabatan: resolvedJabatan,
                        gender: row.jenis_kelamin || '',
                        status_ptkp: row.status_ptkp || '',
                        kategori_ter: row.kategori_ter || '',
                        monthly_income: {},
                        monthly_details: {},
                        monthly_pph21: {},
                        monthly_premi_asuransi: {},
                        monthly_iuran_pensiun: {},
                        monthly_thr_factors: {},
                        was_in_target_gang: false,
                        masa_kerja_tahun: '00',
                        masa_kerja_bulan: '00'
                    });
                }

                const emp = employeeMap.get(empCode);

                if (month === 12) {
                    const mkTahunStr = String(row.masa_kerja_tahun || '0').padStart(2, '0');
                    const mkBulanStr = String(row.masa_kerja_bulan || '0').padStart(2, '0');
                    emp.masa_kerja_tahun = mkTahunStr;
                    emp.masa_kerja_bulan = mkBulanStr;
                }

                if (!gangCode || gangCode === 'ALL' || row.gang_code === gangCode) {
                    emp.was_in_target_gang = true;
                }

                const empCodeTrimmed = empCode?.trim() || '';
                const masterPtkp = ptkpMap.get(empCodeTrimmed) || row.status_ptkp || 'TK/0';
                const kategoriTer = mapPTKPToTER(masterPtkp);

                // Fetch breakdown for pure calculation
                const gajiPokokAktual = row.gaji_pokok_aktual || row.gaji_pokok || 0;
                const tunjanganBeras = row.beras_jumlah || 0;
                const tunjanganJabatan = row.jabatan_jumlah || 0;
                const tunjanganMasaKerja = row.masa_kerja_jumlah || 0;
                const tunjanganLembur = row.lembur_jumlah || 0;
                const totalPremi = row.total_premi || 0;

                // [CENTRALIZED] Calculate via carumanDefinitions
                const upahDasarCalc = row.upah_dasar || 0;
                const pph21Caruman = getCarumanForPph21(upahDasarCalc, tunjanganMasaKerja);
                const astek084 = pph21Caruman.astek_majikan_084;
                const bpjsKesehatanMajikan4Pct = pph21Caruman.bpjs_kes_majikan_4;

                // [CRITICAL FIX] Use same formula as DataExtractorService for consistency
                // Formula: penghasilan_bruto = jumlah_upah_kotor + astek_m + bpjs_m
                // where jumlah_upah_kotor already includes pot_koreksi (as negative value)
                const storedPenghasilanBruto = parseFloat(row.penghasilan_bruto) || 0;
                const storedJumlahUpahKotor = parseFloat(row.jumlah_upah_kotor) || 0;
                let penghasilanBruto: number;

                if (storedPenghasilanBruto > 0) {
                    penghasilanBruto = storedPenghasilanBruto;
                } else if (storedJumlahUpahKotor !== 0) {
                    // Use same formula as DataExtractorService
                    penghasilanBruto = storedJumlahUpahKotor + astek084 + bpjsKesehatanMajikan4Pct;
                } else {
                    // True last resort - without pot_koreksi deduction
                    penghasilanBruto = pph21TerService.calculatePenghasilanBruto(
                        gajiPokokAktual, tunjanganBeras, tunjanganJabatan, tunjanganMasaKerja,
                        tunjanganLembur, totalPremi, astek084, bpjsKesehatanMajikan4Pct, 0
                    );
                }

                // Purely calculated PPh21 (TER) - untuk report pajak
                const pphResult = pph21TerService.calculatePph21Ter(penghasilanBruto, masterPtkp);

                const hk = row.jumlah_hk || row.hk || 0;
                const gp = gajiPokokAktual;
                const mk = tunjanganMasaKerja;
                const upahDasar = row.upah_dasar || 0;
                const decCaruman = calculateAllCaruman(upahDasar, mk);

                // pot_koreksi is a deduction that REDUCES upah kotor, NOT adds to it
                emp.monthly_income[String(month)] = (row.jumlah_upah_kotor !== undefined ? row.jumlah_upah_kotor : null) || row.upah_kotor || row.penghasilan_bruto || row.total_income || 0;
                emp.monthly_details[String(month)] = { hk, gaji_pokok: gp, masa_kerja: mk, upah_dasar: upahDasar };
                emp.monthly_pph21[String(month)] = pphResult.tax_amount;

                // Premi Asuransi: BPJS Kes 4% + Astek 0.84%
                emp.monthly_premi_asuransi[String(month)] = decCaruman.bpjs_kes_majikan + decCaruman.astek_majikan_jkk_jkm;
                // Iuran Pensiun & JHT: BPJS Pensiun 1% + Astek 2%
                emp.monthly_iuran_pensiun[String(month)] = decCaruman.bpjs_pensiun_pekerja + decCaruman.astek_pekerja_jht;

                if (activeThr && month === activeThr.month) {
                    emp.monthly_thr_factors[String(month)] = {
                        masa_kerja_tahun: row.masa_kerja_tahun || 0,
                        upah_dasar: row.upah_dasar || 0,
                        beras_rate: row.r_beras || row.beras_rate || 0,
                        masa_kerja_jumlah: mk
                    };
                }

                // Update PTKP/TER if newer month has data
                if (masterPtkp) emp.status_ptkp = masterPtkp;
                if (kategoriTer) emp.kategori_ter = kategoriTer;
            }
        }

        let employees: DecemberTaxRow[] = [];
        let idx = 0;

        for (const [empCode, emp] of employeeMap) {
            // Only include those active in target gang
            if (!emp.was_in_target_gang) continue;

            // Check if they have december income
            if (!emp.monthly_income['12']) continue;

            idx++;

            let pph21JanNov = 0;
            let gajiPokokSetahun = 0;
            let premiAsuransiSetahun = 0;
            let iuranSetahun = 0;

            let totalDasarCaruman084Year = 0;
            let bpjsKesMajikanYear = 0;

            for (let m = 1; m <= 11; m++) {
                if (emp.monthly_income[String(m)]) {
                    gajiPokokSetahun += emp.monthly_income[String(m)];
                    iuranSetahun += emp.monthly_iuran_pensiun[String(m)] || 0;
                    pph21JanNov += emp.monthly_pph21[String(m)] || 0;
                }
            }

            // Build detailed monthly breakdown for frontend (1-12)
            const breakdown = {
                gaji_pokok: {} as Record<string, number>,
                tunjangan: {} as Record<string, number>,
                premi_asuransi: {} as Record<string, number>,
                iuran_pensiun: {} as Record<string, number>,
                pph21: {} as Record<string, number>,
            };

            for (let m = 1; m <= 12; m++) {
                const ms = String(m);
                const inc = emp.monthly_income[ms] || 0;
                const det = emp.monthly_details[ms];
                const gp = det ? det.gaji_pokok : 0;
                const tunj = Math.max(0, inc - gp);

                breakdown.gaji_pokok[ms] = inc; // Frontend expects "Gaji Pokok" (Income) here, or we can use inc as Total Income
                // Wait, in previous logic gajiPokokSetahun += incDes; so "Gaji Pokok" in breakdown means the total income before premi.
                // Actually the current code does: gajiPokokSetahun += emp.monthly_income[String(m)];
                // Let's pass the raw values so frontend can show them:
                breakdown.gaji_pokok[ms] = inc;
                breakdown.tunjangan[ms] = tunj;
                breakdown.premi_asuransi[ms] = emp.monthly_premi_asuransi[ms] || 0;
                breakdown.iuran_pensiun[ms] = emp.monthly_iuran_pensiun[ms] || 0;
                breakdown.pph21[ms] = emp.monthly_pph21[ms] || 0;

                if (det) {
                    const upahDasarLocal = det.upah_dasar || 0;
                    totalDasarCaruman084Year += (upahDasarLocal * 30) + det.masa_kerja;
                    const decCaruman = calculateAllCaruman(upahDasarLocal, det.masa_kerja);
                    bpjsKesMajikanYear += decCaruman.bpjs_kes_majikan;
                }
            }

            // December logic
            const incDes = emp.monthly_income['12'] || 0;
            const detDes = emp.monthly_details['12'];
            const gpDes = detDes ? (detDes.gaji_pokok + detDes.masa_kerja) : 0;

            const detGajiPokokDes = detDes ? detDes.gaji_pokok : 0;
            const tunjanganDes = Math.max(0, incDes - detGajiPokokDes);
            const premiDes = emp.monthly_premi_asuransi['12'] || 0;
            const iuranDes = emp.monthly_iuran_pensiun['12'] || 0;
            const brutoDes = incDes + premiDes;

            gajiPokokSetahun += incDes;
            iuranSetahun += iuranDes;

            // Recalculate premi asuransi setahun (BPJS Kes 4% + Astek 0.84% from accumulated base using OOP service)
            const accumCaruman = calculateAllCaruman(totalDasarCaruman084Year / 30, 0);
            premiAsuransiSetahun = bpjsKesMajikanYear + accumCaruman.astek_majikan_jkk_jkm;

            // THR & Bonus
            const rawEmpNik = String(emp.nik || '').trim().toUpperCase();
            let rawEmpName = String(emp.emp_name || '').toUpperCase().replace(/\s*\(.*?\)\s*/g, '').trim();
            const firstName = rawEmpName.split(' ')[0].trim();

            let thr = 0;
            if (activeThr) {
                let thrFactors = emp.monthly_thr_factors[String(activeThr.month)];
                if (!thrFactors) {
                    for (let m = 12; m >= 1; m--) {
                        if (emp.monthly_thr_factors[String(m)]) {
                            thrFactors = emp.monthly_thr_factors[String(m)];
                            break;
                        }
                    }
                }
                if (thrFactors && thrFactors.masa_kerja_tahun >= 1) {
                    thr = (thrFactors.upah_dasar * 30) + (thrFactors.beras_rate * 30) + thrFactors.masa_kerja_jumlah;
                }
            }

            let bonus = 0;
            if (exgratiaMap.has(rawEmpNik)) bonus = exgratiaMap.get(rawEmpNik) || 0;
            else if (exgratiaMap.has(rawEmpName)) bonus = exgratiaMap.get(rawEmpName) || 0;
            else {
                for (const [jsonName, jsonThr] of thrMap.entries()) {
                    if (jsonName === firstName || rawEmpName.startsWith(jsonName)) {
                        bonus = exgratiaMap.get(jsonName) || 0;
                        break;
                    }
                }
            }

            const thrBonusTantiemSetahun = thr + bonus;
            const brutoSetahun = gajiPokokSetahun + premiAsuransiSetahun + thrBonusTantiemSetahun;

            const biayaJabatan = Math.min(brutoSetahun * 0.05, 6000000);
            const nettoSetahun = Math.max(0, brutoSetahun - biayaJabatan - iuranSetahun);

            const ptkpValue = getPtkpValue(emp.status_ptkp);

            // Round down to thousands
            const pkpRaw = Math.max(0, nettoSetahun - ptkpValue);
            const pkp = Math.floor(pkpRaw / 1000) * 1000;

            const pph21Setahun = this.calculateProgressivePph21(pkp);
            const pph21Desember = Math.max(0, pph21Setahun - pph21JanNov);

            employees.push({
                no: idx,
                emp_code: emp.emp_code,
                emp_name: emp.emp_name,
                nik: emp.nik,
                npwp: emp.npwp,
                alamat: emp.alamat,
                jabatan: emp.jabatan,
                gender: emp.gender,
                status_ptkp: emp.status_ptkp,
                kategori_ter: emp.kategori_ter,
                masa_kerja_tahun: emp.masa_kerja_tahun,
                masa_kerja_bulan: emp.masa_kerja_bulan,
                gaji_pokok_des: detGajiPokokDes,
                tunjangan_des: tunjanganDes,
                premi_asuransi_des: premiDes,
                tunjangan_pph_des: 0,
                bruto_des: brutoDes,
                thr: thr,
                bonus: bonus,
                tantiem: 0,
                other_incomes: (thr > 0 || bonus > 0) ? [
                    ...(thr > 0 ? [{ type: 'THR', name: 'THR', amount: thr }] : []),
                    ...(bonus > 0 ? [{ type: 'BONUS', name: 'Bonus/Exgratia', amount: bonus }] : [])
                ] : [],
                gaji_pokok_setahun: gajiPokokSetahun,
                tunjangan_lainnya_setahun: 0,
                premi_asuransi_setahun: premiAsuransiSetahun,
                tunjangan_pph_setahun: 0,
                natura_setahun: 0,
                thr_bonus_tantiem_setahun: thrBonusTantiemSetahun,
                bruto_setahun: brutoSetahun,
                biaya_jabatan: biayaJabatan,
                iuran_jht_jp_setahun: iuranSetahun,
                netto_setahun: nettoSetahun,
                ptkp: ptkpValue,
                pkp: pkp,
                pph21_setahun: pph21Setahun,
                pph21_jan_nov: pph21JanNov,
                pph21_desember: pph21Desember,
                monthly_breakdown: breakdown
            });
        }

        employees = sortAndRenumberByEmpCode(employees);

        const sumDecember = (selector: (emp: DecemberTaxRow) => number): number =>
            Math.round(employees.reduce((s, emp) => s + (selector(emp) || 0), 0));

        const decemberTotals = {
            gaji_pokok_des: sumDecember(e => Number(e.gaji_pokok_des) || 0),
            tunjangan_des: sumDecember(e => Number(e.tunjangan_des) || 0),
            premi_asuransi_des: sumDecember(e => Number(e.premi_asuransi_des) || 0),
            tunjangan_pph_des: sumDecember(e => Number(e.tunjangan_pph_des) || 0),
            bruto_des: sumDecember(e => Number(e.bruto_des) || 0),
            thr: sumDecember(e => Number(e.thr) || 0),
            bonus: sumDecember(e => Number(e.bonus) || 0),
            tantiem: sumDecember(e => Number(e.tantiem) || 0),
            gaji_pokok_setahun: sumDecember(e => Number(e.gaji_pokok_setahun) || 0),
            tunjangan_lainnya_setahun: sumDecember(e => Number(e.tunjangan_lainnya_setahun) || 0),
            premi_asuransi_setahun: sumDecember(e => Number(e.premi_asuransi_setahun) || 0),
            tunjangan_pph_setahun: sumDecember(e => Number(e.tunjangan_pph_setahun) || 0),
            natura_setahun: sumDecember(e => Number(e.natura_setahun) || 0),
            thr_bonus_tantiem_setahun: sumDecember(e => Number(e.thr_bonus_tantiem_setahun) || 0),
            bruto_setahun: sumDecember(e => Number(e.bruto_setahun) || 0),
            biaya_jabatan: sumDecember(e => Number(e.biaya_jabatan) || 0),
            iuran_jht_jp_setahun: sumDecember(e => Number(e.iuran_jht_jp_setahun) || 0),
            netto_setahun: sumDecember(e => Number(e.netto_setahun) || 0),
            pkp: sumDecember(e => Number(e.pkp) || 0),
            pph21_setahun: sumDecember(e => Number(e.pph21_setahun) || 0),
            pph21_non_npwp: sumDecember(e => Number(e.pph21_setahun) || 0),
            pph21_jan_nov: sumDecember(e => Number(e.pph21_jan_nov) || 0),
            pph21_desember: sumDecember(e => Number(e.pph21_desember) || 0)
        };

        return {
            employees,
            year,
            available_months: Array.from(new Set(availableMonths)).sort((a, b) => a - b),
            summary: {
                employee_count: employees.length,
                totals: decemberTotals
            }
        };
    }
}

export const taxReportService = TaxReportService.getInstance();
