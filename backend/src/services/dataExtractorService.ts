import { Database } from "../db/client";
import { ADTRANS_DYNAMIC_PREMI_PATTERNS, mapAdtransPremiField, normalizeAdtransPotonganField, normalizeKnownAdtransPremiField } from "./payroll/adtransDocDescMapping";
import { Config } from "../config";
import { payrollService } from "./payrollService";
import { gangService } from "./gangService";
import { lemburCalculator } from "./lemburCalculator";
import { EmployeeEstateService } from "./employeeEstateService";
import { currentPeriodService } from "./currentPeriodService";
import { PayrollComponentMetadata } from "../types/payroll/PayrollComponent";
import { harvesterService } from "./harvesterService";
import { historyDatabaseService } from "./historyDatabaseService";
// [FIX] Removed static import to prevent circular dependency
// import { lemburService, premiService, tunjanganService, potonganService, pph21TerService, payrollComponentRegistry } from "./payroll";
import { gajiPokokService } from "./payroll/components/GajiPokokService";
import { manualAdjustmentService } from "./manualAdjustmentService";
import { employeeHrDataService } from "./employeeHrDataService";
import { divisionDefinition } from "./divisionDefinition";
import { employeeGangHistoryService } from "./employeeGangHistoryService";
import { OtherIncomesService } from "./otherIncomesService";
import { calculateAllCaruman, getCarumanForPph21 } from './carumanDefinitions';
import { cacheService } from "./cacheService";
// PTKP mapping - Single Source of Truth
import { mapBerasRateToPTKP, mapPTKPToTER } from './payroll/formulas/PTKPMapper';
import { calculateMasaKerjaDisplay, deriveInitialSpsiMember } from "../utils/payrollProfileRules";
import { debug, info, warn, error as logError } from "../utils/logger";
import { PayrollCalculator } from "./payroll/components/PayrollCalculator";
import { applyManualAdjustmentsToEmployee } from "./payroll/manualAdjustments/manualAdjustmentApplier";
import type { ManualAdjustmentFieldSyncMeta } from "./payroll/manualAdjustments/manualAdjustmentApplier";
import { toManualAdjustmentFieldName } from "./payroll/manualAdjustments/manualAdjustmentNaming";
import { payrollAutoBufferService, resolveSyncFrameColor } from "./payroll/payrollAutoBufferService";
import { divisionConfigService } from "./config/DivisionConfigService";
import { buildLeaveSqlExpressions } from "./payroll/extractors/leaveRules";
import { processInBatches } from "../utils/batchProcessor";
import {
    resolvePayrollDivisionCodeForScope,
    resolvePayrollGangPrefixForDivision
} from "../utils/payrollGangScope";
import {
    attachPayrollPeriodAdjustmentNotes,
    resolveAdjustedJabatanJumlah,
    shouldForcePotPph21ToTer
} from "../utils/payrollPeriodAdjustments";
import {
    getCanonicalOtherIncomeType,
    sumOtherIncomeByCanonicalType
} from "../utils/otherIncomeCanonical";

const CATEGORY = "DataExtractor";

export type PayrollValuePriorityMode = "db_ptrj_only" | "non_db_ptrj";

export function normalizePayrollValuePriorityMode(value?: string | null): PayrollValuePriorityMode {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "db_ptrj_only") return "db_ptrj_only";
    return "non_db_ptrj";
}

export interface ManualAdjustmentSourcePolicy {
    applyAmounts: boolean;
    fetchRowsForMetadata: boolean;
    manualBufferOnly: boolean;
}

export function resolveManualAdjustmentSourcePolicy(value?: string | null): ManualAdjustmentSourcePolicy {
    const valuePriorityMode = normalizePayrollValuePriorityMode(value);
    const useNonDbPtrjSources = valuePriorityMode === "non_db_ptrj";
    return {
        applyAmounts: valuePriorityMode !== "db_ptrj_only",
        fetchRowsForMetadata: true,
        manualBufferOnly: useNonDbPtrjSources
    };
}

export function filterRowsExcludedFromDivision<T extends { gang_code?: any }>(
    rows: T[],
    divisionCode?: string | null
): T[] {
    const resolvedDivisionCode = resolvePayrollDivisionCodeForScope(divisionCode);
    if (!resolvedDivisionCode) return rows;

    return rows.filter((row) =>
        !divisionConfigService.isGangExcludedFromDivision(resolvedDivisionCode, row.gang_code || "")
    );
}

export function shouldKeepPayrollRowAfterEffectiveHkFilter(input: {
    jumlahHk?: unknown;
    cutiMingguHari?: unknown;
    cutiNasionalHari?: unknown;
    hasManualAdjustments?: boolean;
}): boolean {
    const effectiveHk = (Number(input.jumlahHk) || 0)
        - ((Number(input.cutiMingguHari) || 0) + (Number(input.cutiNasionalHari) || 0));
    return effectiveHk > 0 || input.hasManualAdjustments === true;
}

export function resolveManualAdjustmentFetchGangCode(gangCode?: string | null, divisionCode?: string | null): string | undefined {
    const normalizedDivision = String(divisionCode || "").trim();
    if (!normalizedDivision) {
        const normalizedGang = String(gangCode || "").trim().toUpperCase();
        return normalizedGang && normalizedGang !== "ALL" ? normalizedGang : undefined;
    }

    // Manual rows can keep an old gang_code after an employee is moved.
    // Fetch by period/division, then match against the current employee list by emp_code/nik.
    return undefined;
}

function pickStaticPotonganForManualBuffer(source: Record<string, number>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(source || {})) {
        const keyUpper = String(key).toUpperCase();
        if (keyUpper === "SPSI" || keyUpper === "PPH21" || keyUpper === "PREMI_PPH") {
            result[key] = Number(rawValue) || 0;
        }
    }
    return result;
}

function parseManualAdjustmentMetadata(value: any): any | null {
    if (!value) return null;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return null;
    }
}

function normalizeManualAdjustmentIdentityKey(value: any): string {
    return String(value || '').trim().toUpperCase();
}

function manualAdjustmentIdentityKeys(source: any): string[] {
    const keys = [
        source?.emp_code,
        source?.nik,
        source?.new_nik,
        source?.actual_nik
    ].map(normalizeManualAdjustmentIdentityKey).filter(Boolean);
    return Array.from(new Set(keys));
}

type ManualAdjustmentIdentityIndex = Map<string, any[]>;

export function buildManualAdjustmentIdentityIndex(adjustments: any[] = []): ManualAdjustmentIdentityIndex {
    const index: ManualAdjustmentIdentityIndex = new Map();
    for (const adjustment of adjustments || []) {
        for (const key of manualAdjustmentIdentityKeys(adjustment)) {
            const current = index.get(key) || [];
            current.push(adjustment);
            index.set(key, current);
        }
    }
    return index;
}

export function getManualAdjustmentsForEmployee(index: ManualAdjustmentIdentityIndex, employee: any): any[] {
    const result: any[] = [];
    const seen = new Set<any>();
    for (const key of manualAdjustmentIdentityKeys(employee)) {
        for (const adjustment of index.get(key) || []) {
            const dedupeKey = adjustment?.id ?? adjustment;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            result.push(adjustment);
        }
    }
    return result;
}

type JoinDateOverlayRow = {
    emp_code?: unknown;
    join_date?: unknown;
};

function addJoinDateRows(target: Map<string, string>, rows: JoinDateOverlayRow[] = []): void {
    for (const row of rows || []) {
        const empCode = normalizeManualAdjustmentIdentityKey(row.emp_code);
        const joinDate = row.join_date;
        if (!empCode || !joinDate || target.has(empCode)) continue;
        target.set(empCode, String(joinDate));
    }
}

export function applyJoinDateSourcesToEmployees(
    employees: Array<{ emp_code?: unknown; join_date?: any }>,
    sources: {
        profileOverrideRows?: JoinDateOverlayRow[];
        valueOverrideRows?: JoinDateOverlayRow[];
        historyRows?: JoinDateOverlayRow[];
    }
): void {
    const joinDateMap = new Map<string, string>();
    addJoinDateRows(joinDateMap, sources.profileOverrideRows);
    addJoinDateRows(joinDateMap, sources.valueOverrideRows);
    addJoinDateRows(joinDateMap, sources.historyRows);

    for (const emp of employees || []) {
        const empCode = normalizeManualAdjustmentIdentityKey(emp.emp_code);
        const joinDate = joinDateMap.get(empCode);
        if (joinDate) {
            emp.join_date = joinDate;
        }
    }
}

export function buildLatestProfileJoinDateQuery(empCodeList: string): string {
    return `
        SELECT emp_code, join_date
        FROM (
            SELECT
                RTRIM(emp_code) as emp_code,
                effective_start_date as join_date,
                ROW_NUMBER() OVER (
                    PARTITION BY RTRIM(emp_code)
                    ORDER BY update_index DESC, id DESC
                ) as rn
            FROM dbo.employee_profile_override_history
            WHERE RTRIM(emp_code) IN (${empCodeList})
              AND effective_start_date IS NOT NULL
              AND is_active_record = 1
        ) latest
        WHERE rn = 1
    `;
}

export function buildLatestValueJoinDateQuery(empCodeList: string): string {
    return `
        SELECT emp_code, join_date
        FROM (
            SELECT
                RTRIM(emp_code) as emp_code,
                text_value as join_date,
                ROW_NUMBER() OVER (
                    PARTITION BY RTRIM(emp_code)
                    ORDER BY update_index DESC, id DESC
                ) as rn
            FROM dbo.payroll_value_override_history
            WHERE RTRIM(emp_code) IN (${empCodeList})
              AND field_name = 'join_date'
              AND text_value IS NOT NULL
              AND is_active_record = 1
        ) latest
        WHERE rn = 1
    `;
}

function buildLatestHistoryJoinDateQuery(empCodeList: string): string {
    return `
        SELECT emp_code, join_date
        FROM (
            SELECT
                RTRIM(emp_code) as emp_code,
                join_date,
                ROW_NUMBER() OVER (
                    PARTITION BY RTRIM(emp_code)
                    ORDER BY id DESC
                ) as rn
            FROM dbo.history_hr_employee
            WHERE RTRIM(emp_code) IN (${empCodeList})
              AND join_date IS NOT NULL
        ) latest
        WHERE rn = 1
          AND join_date IS NOT NULL
    `;
}

export function pickStaticPremiForManualBuffer(source: Record<string, number>): Record<string, number> {
    const brondol = Number(
        source?.brondol
        ?? source?.premi_brondol
        ?? source?.premi_brondol_total
        ?? 0
    ) || 0;

    return brondol !== 0 ? { brondol } : {};
}

type ManualAdjustmentMetadataType = 'PREMI' | 'POTONGAN_KOTOR' | 'POTONGAN_BERSIH';
const DETAIL_TOTAL_MISMATCH_PREMI_NAMES = new Set(['PREMI PRUNING', 'PREMI RAKING']);
type PayrollValueSourceCompareMap = Record<string, { db_ptrj: number | string | boolean | null; active: number | string | boolean | null }>;
type ManualAdjustmentComparisonRow = {
    adjustment_type?: unknown;
    adjustment_name?: unknown;
    amount?: unknown;
    metadata_json?: unknown;
};

function resolveManualAdjustmentMetadataType(value: any): ManualAdjustmentMetadataType | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'PREMI' || normalized === 'POTONGAN_KOTOR' || normalized === 'POTONGAN_BERSIH') {
        return normalized as ManualAdjustmentMetadataType;
    }
    return null;
}

export function attachManualAdjustmentMetadata(
    target: { manual_adjustment_metadata?: Record<string, any>; manual_adjustment_metadata_mismatch?: Record<string, { amount: number; detail_total: number; diff: number; reason?: string }> },
    adjustments: any[]
): void {
    for (const adjustment of adjustments || []) {
        const adjustmentType = resolveManualAdjustmentMetadataType(adjustment.adjustment_type);
        if (!adjustmentType) continue;
        const metadata = parseManualAdjustmentMetadata(adjustment.metadata_json);
        if (!metadata) continue;

        const fieldName = toManualAdjustmentFieldName(adjustmentType, String(adjustment.adjustment_name || ''));
        const amount = Number(adjustment.amount || 0);
        const detailTotal = Number(metadata.total_amount ?? amount) || 0;
        const enrichedMetadata = {
            ...metadata,
            adjustment_type: adjustmentType,
            adjustment_name: adjustment.adjustment_name,
            amount,
            detail_total: detailTotal,
            detail_matches_amount: Math.abs(amount - detailTotal) <= 0.01
        };

        target.manual_adjustment_metadata ||= {};
        target.manual_adjustment_metadata[fieldName] = enrichedMetadata;

        const shouldExposeMismatch = adjustmentType === 'PREMI'
            && DETAIL_TOTAL_MISMATCH_PREMI_NAMES.has(String(adjustment.adjustment_name || '').trim().toUpperCase())
            && Math.abs(amount) > 0.01
            && !enrichedMetadata.detail_matches_amount;

        if (shouldExposeMismatch) {
            target.manual_adjustment_metadata_mismatch ||= {};
            target.manual_adjustment_metadata_mismatch[fieldName] = {
                amount,
                detail_total: detailTotal,
                diff: detailTotal - amount,
                reason: 'Total detail terbaru berbeda dari amount lama. Untuk PREMI PRUNING/RAKING, total detail terbaru dipakai saat simpan.'
            };
        }
    }
}

function normalizeManualCompareFieldIdentity(value: unknown): string {
    return String(value || '')
        .toLowerCase()
        .replace(/berondol/g, 'brondol')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function stripManualCompareFieldPrefix(value: string): string {
    return value
        .replace(/^potongan_lainnya_/, '')
        .replace(/^potongan_/, '')
        .replace(/^koreksi_/, '')
        .replace(/^premi_/, '');
}

function manualCompareFieldMatches(sourceKey: string, targetFieldName: string, adjustmentType: string): boolean {
    const source = normalizeManualCompareFieldIdentity(sourceKey);
    const target = normalizeManualCompareFieldIdentity(targetFieldName);
    if (!source || !target) return false;
    if (source === target) return true;

    if (adjustmentType === 'PREMI') {
        const sourceKnownField = normalizeKnownAdtransPremiField(source);
        const targetKnownField = normalizeKnownAdtransPremiField(target);
        if (sourceKnownField && targetKnownField && sourceKnownField === targetKnownField) {
            return true;
        }
    }

    const typePrefix = adjustmentType === 'PREMI'
        ? 'premi_'
        : adjustmentType === 'POTONGAN_KOTOR'
            ? 'koreksi_'
            : 'potongan_lainnya_';
    if (normalizeManualCompareFieldIdentity(`${typePrefix}${source}`) === target) return true;

    return stripManualCompareFieldPrefix(source) === stripManualCompareFieldPrefix(target);
}

function toManualCompareAmount(value: unknown, adjustmentType: string): number {
    const amount = Number(value) || 0;
    return adjustmentType === 'POTONGAN_KOTOR' || adjustmentType === 'POTONGAN_BERSIH'
        ? Math.abs(amount)
        : amount;
}

function resolveManualAdjustmentCompareAmount(adjustment: ManualAdjustmentComparisonRow): number {
    const metadata = parseManualAdjustmentMetadata(adjustment.metadata_json);
    return Number(metadata?.total_amount ?? adjustment.amount) || 0;
}

function buildManualAdjustmentSourceSyncMetas(adjustments: ManualAdjustmentComparisonRow[] = []): ManualAdjustmentFieldSyncMeta[] {
    const aggregated = new Map<string, ManualAdjustmentFieldSyncMeta>();

    for (const adjustment of adjustments || []) {
        const adjustmentType = resolveManualAdjustmentMetadataType(adjustment.adjustment_type);
        if (!adjustmentType) continue;

        const adjustmentName = String(adjustment.adjustment_name || '');
        const fieldName = toManualAdjustmentFieldName(adjustmentType, adjustmentName);
        const amount = toManualCompareAmount(resolveManualAdjustmentCompareAmount(adjustment), adjustmentType);
        const aggregateKey = `${adjustmentType}:${normalizeManualCompareFieldIdentity(fieldName)}`;
        const current = aggregated.get(aggregateKey);

        if (!current) {
            aggregated.set(aggregateKey, {
                fieldName,
                adjustmentType,
                adjustmentName,
                previousAmount: 0,
                finalAmount: amount,
                hadDbValue: false
            });
            continue;
        }

        current.finalAmount += amount;
        if (adjustmentName) {
            current.adjustmentName = adjustmentName;
        }
    }

    return Array.from(aggregated.values());
}

export function resolveManualAdjustmentDbPtrjCompareAmount(
    syncMeta: Pick<ManualAdjustmentFieldSyncMeta, 'fieldName' | 'adjustmentType' | 'previousAmount'>,
    dbPremiSource: Record<string, number> = {},
    dbPotonganSource: Record<string, number> = {}
): number {
    const source = syncMeta.adjustmentType === 'PREMI' ? dbPremiSource : dbPotonganSource;
    let matchedAmount = 0;
    let matched = false;
    for (const [key, value] of Object.entries(source || {})) {
        if (manualCompareFieldMatches(key, syncMeta.fieldName, syncMeta.adjustmentType)) {
            matchedAmount += toManualCompareAmount(value, syncMeta.adjustmentType);
            matched = true;
        }
    }

    if (matched) return matchedAmount;
    return toManualCompareAmount(syncMeta.previousAmount, syncMeta.adjustmentType);
}

export function attachManualAdjustmentValueSourceComparison(
    valueSyncFrame: Record<string, "red" | "green">,
    valueSourceCompare: PayrollValueSourceCompareMap,
    syncMeta: ManualAdjustmentFieldSyncMeta,
    dbPtrjAmount: number = toManualCompareAmount(syncMeta.previousAmount, syncMeta.adjustmentType)
): void {
    const syncColor = resolveSyncFrameColor(syncMeta.finalAmount, dbPtrjAmount);
    const compare = {
        db_ptrj: dbPtrjAmount,
        active: syncMeta.finalAmount
    };

    valueSyncFrame[syncMeta.fieldName] = syncColor;
    valueSourceCompare[syncMeta.fieldName] = compare;

    if (syncMeta.adjustmentType === 'PREMI' && !syncMeta.fieldName.startsWith('premi_')) {
        const alias = `premi_${syncMeta.fieldName}`;
        valueSyncFrame[alias] = syncColor;
        valueSourceCompare[alias] = compare;
    }

    if (syncMeta.adjustmentType !== 'PREMI') {
        const keyUpper = syncMeta.fieldName.toUpperCase();
        if (!keyUpper.startsWith('KOREKSI') && !syncMeta.fieldName.startsWith('potongan_')) {
            const alias = `potongan_${syncMeta.fieldName}`;
            valueSyncFrame[alias] = syncColor;
            valueSourceCompare[alias] = compare;
        }
    }
}

export function attachManualAdjustmentSourceComparisons(
    valueSyncFrame: Record<string, "red" | "green">,
    valueSourceCompare: PayrollValueSourceCompareMap,
    adjustments: ManualAdjustmentComparisonRow[] = [],
    dbPremiSource: Record<string, number> = {},
    dbPotonganSource: Record<string, number> = {}
): ManualAdjustmentFieldSyncMeta[] {
    const syncMetas = buildManualAdjustmentSourceSyncMetas(adjustments);

    for (const syncMeta of syncMetas) {
        attachManualAdjustmentValueSourceComparison(
            valueSyncFrame,
            valueSourceCompare,
            syncMeta,
            resolveManualAdjustmentDbPtrjCompareAmount(syncMeta, dbPremiSource, dbPotonganSource)
        );
    }

    return syncMetas;
}

export function registerManualAdjustmentMetadataDynamicHeaders(
    adjustments: any[],
    dynamicPremiSet: Set<string>,
    dynamicPotonganSet: Set<string>,
    premiTitleMap: Record<string, string>,
    potonganTitleMap: Record<string, string>
): void {
    for (const adjustment of adjustments || []) {
        const adjustmentType = resolveManualAdjustmentMetadataType(adjustment.adjustment_type);
        if (!adjustmentType) continue;

        const adjustmentName = String(adjustment.adjustment_name || '').trim();
        const fieldName = toManualAdjustmentFieldName(adjustmentType, adjustmentName);
        if (!fieldName) continue;

        if (adjustmentType === 'PREMI') {
            dynamicPremiSet.add(fieldName);
            if (adjustmentName && !premiTitleMap[fieldName]) {
                premiTitleMap[fieldName] = adjustmentName;
            }
            continue;
        }

        dynamicPotonganSet.add(fieldName);
        if (adjustmentName && !potonganTitleMap[fieldName]) {
            potonganTitleMap[fieldName] = adjustmentName;
        }
    }
}

interface EmployeeRow {
    emp_code: string;
    emp_name: string;
    gender: string;
    loc_code: string;
    gang_code: string;
    pay_rate: number;
    beras_rate: number;
    join_date: string | null;
    actual_nik?: string;
    /** 
     * Jabatan = ROLE TEXT (e.g. "Mandor", "Kerani", "Karyawan Panen")
     * Source: extend_db_ptrj (employee_estate OR history_gang_member)
     * NOT from HR_GANGLN - that table only has gang membership.
     */
    jabatan?: string;
    pot_premi_pph?: number;
    res_address?: string;
    // Allow dynamic properties added during progressive extraction
    [key: string]: any;
}

interface CutiData {
    cuti_tahunan: number;
    cuti_sakit_haid: number;
    cuti_minggu: number;
    cuti_nasional: number;
}

interface LemburData {
    jam: number;
    jumlah: number;
}

interface LemburRecord {
    trx_date: string;
    task_code: string;
    task_desc: string;
    day_type: string;
    hours: number;
    rate: number;
    amount: number;
    record_count?: number; // Number of transactions grouped (for grouped task breakdown)
    meta?: PayrollComponentMetadata;
}

interface LemburDataWithDetails extends LemburData {
    records: LemburRecord[];
}

interface ShortageDetail {
    date: string;
    day_name: string;
    actual_hours: number;
    target_hours: number;
    shortage_hours: number;
}

interface ExcessDetail {
    date: string;
    day_name: string;
    actual_hours: number;
    target_hours: number;
    excess_hours: number;
}

interface PayrollRow {
    emp_code?: string;
    nik: string;
    nama: string;
    jabatan_estate?: string;
    jenis_kelamin: string;
    status_ptkp: string;
    kategori_ter: string;
    loc_code: string;
    gang_code: string;
    alamat: string;
    // Upah Dasar: Base wage rate from HR_PAYROLL.PayRate (daily rate)
    // = Gaji Pokok per Hari (rate, bukan jumlah). Sumber: HR_PAYROLL.PayRate (via GajiPokokService)
    upah_dasar: number;
    jumlah_hk: number;
    total_jam_kerja: number;
    has_shortage?: boolean;
    shortage_details?: ShortageDetail[];
    shortage_total_hours?: number;
    has_excess?: boolean;
    excess_details?: ExcessDetail[];
    excess_total_hours?: number;
    hk_warning?: string; // 'kurang_jam' | 'salah_scan' | null
    hari_kerja: number;
    gaji_pokok: number;
    kehadiran: number;
    cuti_tahunan_hari: number;
    cuti_sakit_haid_hari: number;
    cuti_minggu_hari: number;
    cuti_nasional_hari: number;
    // Task/Job Code fields
    task_code?: string;
    task_desc?: string;
    task_type?: string;
    task_uom?: string;
    beras_rate: number;
    beras_jumlah: number;
    /** Tunjangan jabatan RATE (uang/hari) from PR_ADTRANSLN where DocDesc LIKE '%JABATAN%' */
    jabatan_rate: number;
    /** Tunjangan jabatan JUMLAH (total uang) from PR_ADTRANSLN - NOT role text! */
    jabatan_jumlah: number;
    masa_kerja_tahun: number;
    masa_kerja_rate: number;
    masa_kerja_jumlah: number;
    lembur_jam: number;
    lembur_rate: number;
    lembur_jumlah: number;
    lembur_records?: Array<{
        trx_date: string;
        task_code: string;
        task_desc: string;
        day_type: string;
        hours: number;
        rate: number;
        amount: number;       // Calculated amount (from tier-based rate)
        raw_amount: number;   // Amount from PR_TASKREGLN table
        raw_rate: number;     // Rate from PR_TASKREGLN table
        meta?: PayrollComponentMetadata;
    }>;
    // Harvest / Bunches fields (for harvest gangs ending with "H")
    bunches_total?: number;
    bunches_ripe?: number;
    bunches_unripe?: number;
    bunches_underripe?: number;
    bunches_overripe?: number;
    bunches_rotten?: number;
    bunches_abnormal?: number;
    loose_fruit?: number;
    bunches_transactions?: number;
    total_tunjangan: number;
    premi_brondol: number;
    // [PHASE 2.5] Brondol dual source breakdown
    premi_brondol_loosefruit: number;  // From PR_LOOSEFRUIT
    premi_brondol_adtrans: number;     // From PR_ADTRANS (DocDesc containing BRONDOL)
    premi_brondol_total: number;        // Combined total (loosefruit + adtrans)
    premi_pph: number; // PREMI PPH - ADDED (+) to upah_bersih, not subtracted
    total_premi: number;
    premi: Record<string, number>;
    premi_details?: any[];
    jumlah_upah_kotor: number;
    // Caruman ASTEK
    pot_astek_pekerja: number;
    pot_astek_majikan: number;
    pot_astek_jumlah: number;
    // BPJS Kesehatan
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_kesehatan_majikan: number;
    pot_bpjs_kesehatan_jumlah: number;
    // BPJS Pensiun
    pot_bpjs_pensiun_pekerja: number;
    pot_bpjs_pensiun_majikan: number;
    pot_bpjs_pensiun_jumlah: number;
    // New fields for Penggajian Group
    gaji_pokok_ideal: number;
    gaji_pokok_aktual: number;
    koreksi_hk: number;
    // Other deductions
    pot_spsi: number;
    pot_pph21: number;
    pot_koreksi: number;
    premi_koreksi: number;
    potongan_upah_kotor_total: number;
    potongan_upah_kotor_details?: {
        koreksi: number;
        total: number;
    };
    total_potongan: number;
    total_potongan_bersih: number;
    // New calculated tax fields
    // IMPORTANT: ASTEK and BPJS Kesehatan are calculated from payrate × 30 (monthly salary), NOT from actual HK
    gaji_pokok_bulanan: number; // payrate × 30 (for ASTEK/BPJS calculation)
    astek_084: number; // ASTEK/BPJS Pensiun Majikan (0.84%) - calculated from gaji_pokok_bulanan + masa_kerja_jumlah
    bpjs_kesehatan_majikan_4_pct: number; // BPJS Kesehatan Majikan (4%) - calculated from gaji_pokok_bulanan + masa_kerja_jumlah
    penghasilan_bruto: number; // For PPH21 TER: gaji_pokok_aktual + tunjangan + lembur + premi + astek_084 + bpjs_kesehatan_majikan_4_pct
    upah_kotor_pajak: number; // Jumlah Upah Kotor + Astek + BPJS Kesehatan (untuk header/pajak)
    // PPH21 TER fields
    tarif_pajak_ter: number; // TER rate as percentage (e.g., 5 for 5%)
    pph21_ter: number; // Calculated PPH21 amount using TER method
    taxable_pendapatan_lainnya: number; // sama dengan pendapatan_lainnya (semua taxable)
    upah_bersih: number;
    pot_astek: number;
    pot_astek_maj: number;
    pot_bpjs_pekerja_total: number;
    // Other Incomes (THR, Bonus, Custom) - for display and calculation
    other_incomes?: { type: string; name: string; amount: number }[];
    // Taxable breakdown of other incomes (for PAJAK section)
    taxable_pendapatan_thr: number;
    taxable_pendapatan_bonus: number;
    taxable_pendapatan_custom: number;
    value_sync_frame?: Record<string, "red" | "green">;
    value_source_compare?: Record<string, { db_ptrj: number | string | boolean | null; active: number | string | boolean | null }>;
    manual_adjustment_metadata?: Record<string, any>;
    manual_adjustment_metadata_mismatch?: Record<string, { amount: number; detail_total: number; diff: number; reason?: string }>;
    [key: string]: any;
}

function cleanNameFormat(name: string): string {
    if (!name) return '';
    return name.replace(/\([^)]*\)/g, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

const DIVISION_TO_LOCCODE: Record<string, string> = {
    "PG1A": "P1A", "PG1B": "P1B", "PG2A": "P2A", "PG2B": "P2B",
    "DME": "DME", "ARA": "ARA", "ARB1": "AB1", "ARB2": "AB2",
    "INFRA": "INF", "ARC": "ARC", "IJL": "IJL"
};

export class DataExtractorService {
    private static instance: DataExtractorService;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): DataExtractorService {
        if (!DataExtractorService.instance) {
            DataExtractorService.instance = new DataExtractorService();
        }
        return DataExtractorService.instance;
    }

    public async extractPayrollData(
        month: number,
        year: number,
        gangCode: string = "ALL",
        divisionCode?: string,
        specificEmpCode: string | null = null,
        serverProfile?: string,
        includeVirtualGangs: boolean = false,
        useHistoryDb?: boolean | null,
        gangPrefix?: string,
        skipHarvest: boolean = false,
        skipHeavyDetails: boolean = false,
        snapshotVersion?: number | null,
        valuePriorityModeInput?: string | null
    ): Promise<{
        data_rows: PayrollRow[];
        dynamic_premi_headers: string[];
        dynamic_potongan_headers: string[];
        premi_title_map: Record<string, string>;
        potongan_title_map: Record<string, string>;
        meta: { execution_time_ms: number; row_count: number }
    }> {
        const valuePriorityMode = normalizePayrollValuePriorityMode(valuePriorityModeInput);
        const manualAdjustmentPolicy = resolveManualAdjustmentSourcePolicy(valuePriorityMode);
        const useAutoBuffer = valuePriorityMode !== "db_ptrj_only";
        const allowManualAdjustments = manualAdjustmentPolicy.applyAmounts;
        const fetchManualAdjustmentRows = manualAdjustmentPolicy.fetchRowsForMetadata;
        const manualBufferOnlyMode = manualAdjustmentPolicy.manualBufferOnly;
        const startTime = Date.now();
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const endDate = `${nextYear}-${nextMonth.toString().padStart(2, "0")}-01`;
        const resolvedDivisionCode = resolvePayrollDivisionCodeForScope(divisionCode);
        const effectiveGangPrefix = resolvePayrollGangPrefixForDivision(divisionCode, gangPrefix);

        // Calculate days in the selected month for ideal salary calculation
        const daysInMonth = new Date(year, month, 0).getDate();

        // ============================================================
        // ============================================================
        // [OPTIMIZATION] Parallelize: gangService fetch + currentPeriod with timeout fallback
        // ============================================================
        // Get gangs first (fast query)
        const allGangs = await gangService.fetchGangs(divisionCode || undefined, undefined, includeVirtualGangs);
        console.log(`[DataExtractor] allGangs.length=${allGangs.length}, divisionCode=${divisionCode}, gangCode=${gangCode}`);

        // Get current period - if it times out, fall back to using the requested period
        let currentMonth: number;
        let currentYear: number;
        try {
            const currentPeriod = await currentPeriodService.getCurrentPeriod();
            currentMonth = currentPeriod.month;
            currentYear = currentPeriod.year;
        } catch (periodError: any) {
            // If getCurrentPeriod fails (e.g., DB timeout), use the requested period as fallback
            // This ensures the seeder can still work even if the DB is slow
            console.warn(`[DataExtractor] getCurrentPeriod failed: ${periodError.message}. Using requested period ${month}/${year} as fallback.`);
            currentMonth = month;
            currentYear = year;
        }

        // Determine if the selected period is historical (before current period)
        const isHistorical = (year < currentYear) || (year === currentYear && month < currentMonth);

        // [OPTIMIZATION] Cache check
        const cacheKey = cacheService.buildPayrollKey(gangCode, month, year, divisionCode, useHistoryDb);
        const useCache = false;
        if (useCache) {
            const cached = cacheService.get<any>(cacheKey);
            if (cached) {
                return cached;
            }
        }

        // If history mode is on, try to fetch from the snapshot tables first.
        let shouldFetchHistory = isHistorical && historyDatabaseService.isHistoryMode();

        // Explicit override from frontend
        if (useHistoryDb === true) {
            shouldFetchHistory = true;
        } else if (useHistoryDb === false) {
            shouldFetchHistory = false;
        }

        const shouldReadHistorySnapshotForSourceMode = valuePriorityMode === "db_ptrj_only";
        if (shouldFetchHistory && shouldReadHistorySnapshotForSourceMode) {
            try {
                const historyData = await historyDatabaseService.getHistoricalPayrollDataAsExtractorFormat(
                    month, year, gangCode, divisionCode, specificEmpCode
                );

                if (historyData && historyData.data_rows.length > 0) {
                    console.log(`[DataExtractor] Found seeded history: ${historyData.data_rows.length} rows`);
                    historyData.data_rows = filterRowsExcludedFromDivision(historyData.data_rows, divisionCode);
                    // Apply gangPrefix filter if present
                    if (effectiveGangPrefix) {
                        const isNumeric = /^\d+$/.test(effectiveGangPrefix);
                        historyData.data_rows = historyData.data_rows.filter((r: any) => {
                            const gc = (r.gang_code || '').trim().toUpperCase();
                            if (isNumeric) {
                                const asistensi = gc.startsWith('K2') ? '1' : (gc.match(/\d+/)?.[0] ?? null);
                                return asistensi === effectiveGangPrefix;
                            }
                            return gc.startsWith(effectiveGangPrefix.toUpperCase());
                        });
                    }

                    debug(CATEGORY, `Intercepted deep history request for ${month}/${year}. Returning seeded snapshot data. (${historyData.data_rows.length} rows)`);
                    return historyData;
                } else {
                    debug(CATEGORY, `No seeded history found for ${month}/${year}. Falling back to live/archive calculation...`);
                }
            } catch (err) {
                logError(CATEGORY, `Failed to fetch historical snapshot, falling back:`, err);
            }
        }
        // ------------------------------------

        // [GANG MAPPING] Build mapping maps from fetched gangs
        const codeToDesc: Record<string, string> = {};
        const descToCode: Record<string, string> = {};

        allGangs.forEach((g: any) => {
            const code = g.gang_code?.trim().toUpperCase(); // e.g. "AB1"
            const desc = g.description?.trim().toUpperCase(); // e.g. "DIVISI AB1" (from backend/DB)
            if (code && desc) {
                codeToDesc[code] = desc; // AB1 -> DIVISI AB1
                descToCode[desc] = g.gang_code.trim(); // DIVISI AB1 -> AB1 (preserve original casing if possible, but map key is upper)
            }
        });

        let gangCondition = "1=1";
        // Also store the raw gangCode input for path-specific filtering in getEmployees
        let gangCodeInput: string | null = null;
        if (specificEmpCode) {
            gangCondition = `RTRIM(e.EmpCode) = '${specificEmpCode.trim()}'`;
        } else if (gangCode && gangCode !== "ALL") {
            const trimmedInput = gangCode.trim().toUpperCase();
            debug(CATEGORY, `Gang Filter: Input='${gangCode}' (Using exact Code matching)`);
            // Set gangCodeInput so getEmployees can build path-specific conditions
            gangCodeInput = trimmedInput;
            // Default condition using GangCode from HR_GANGLN (live path)
            // getEmployees will override this for historical path
            gangCondition = `(UPPER(RTRIM(gl.GangCode)) = '${trimmedInput}' OR UPPER(RTRIM(g.GangCode)) = '${trimmedInput}' OR UPPER(RTRIM(g.Description)) = '${trimmedInput}')`;
        } else if (divisionCode) {
            // [CRITICAL FIX] Virtual vs Real division gang condition building
            // For virtual divisions (INF, NRS, Workshop), the list of gangs perfectly defines the division.
            // For real divisions (P1A, AB1), they are defined by LocCode and we MUST NOT filter by g.GangCode 
            // strictly using the live gang list. Doing so excludes historical gangs (like "PERCOBAAN") 
            // that were deleted from the live table but still exist in the historical table.
            
            const isVirtual = gangService.isVirtualDivision(divisionCode);
            console.log(`--- REFLI VERSION 1.1.0 ---`);
            console.log(`[DataExtractor] Division: ${divisionCode}, isVirtual: ${isVirtual}, allGangs: ${allGangs.length}`);
            
            if (isVirtual) {
                if (resolvedDivisionCode === 'INF') {
                    // [USER REQUEST] Hardcoded isolation for Infrastruktur: Anything starting with IN
                    gangCondition = `(UPPER(RTRIM(gl.GangCode)) IN ('INF', 'INT') OR UPPER(RTRIM(g.GangCode)) IN ('INF', 'INT'))`;
                } else if (allGangs.length > 0) {
                    const gangCodes = allGangs.map((gang: { gang_code: string }) => `'${gang.gang_code.trim().toUpperCase()}'`).join(',');
                    const gangDescs = allGangs.filter(g => g.description).map((gang: { description: string }) => `'${gang.description.trim().toUpperCase()}'`).join(',');
                    
                    gangCondition = `(UPPER(RTRIM(gl.GangCode)) IN (${gangCodes}) OR UPPER(RTRIM(g.GangCode)) IN (${gangCodes})`;
                    if (gangDescs) {
                        gangCondition += ` OR UPPER(RTRIM(g.Description)) IN (${gangDescs})`;
                    }
                    gangCondition += `)`;
                } else {
                    gangCondition = "1=0";
                }
            } else {
                // Real division (P1A, AB1, etc.): Hybrid approach
                const aliases = gangService.getDivisionCodesWithAliases(divisionCode);
                const placeholders = aliases.map((a: string) => `'${a.toUpperCase()}'`).join(',');
                
                // Base condition: strictly gangs belonging to this division's LocCode
                let locCondition = `(UPPER(RTRIM(g.LocCode)) IN (${placeholders}))`;
                
                // Add explicit gang codes from discovery list (catches cross-division gangs like F1BHL)
                if (allGangs.length > 0) {
                    const gangCodes = allGangs.map((gang: { gang_code: string }) => `'${gang.gang_code.trim().toUpperCase()}'`).join(',');
                    // [CRITICAL] Use gl.GangCode to catch gangs that don't have master records in HR_GANG
                    locCondition = `(${locCondition} OR UPPER(RTRIM(gl.GangCode)) IN (${gangCodes}))`;
                }

                gangCondition = locCondition;

                // Exclude virtual division gangs strictly using divisionConfigService (covers INFRA, NURSERY, WORKSHOP, MEC)
                gangCondition += divisionConfigService.getVirtualExclusionSQL();
            }
            console.log(`[DataExtractor] Final gangCondition: ${gangCondition}`);
        }

        const startTotal = performance.now();
        let employees = await this.getEmployees(gangCondition, month, year, serverProfile, isHistorical, gangCodeInput);
        employees = filterRowsExcludedFromDivision(employees, divisionCode);
        debug(CATEGORY, `Phase 0 - getEmployees: ${(performance.now() - startTotal).toFixed(0)}ms, found ${employees.length} employees`);

        // Apply gangPrefix (Group/Asistensi) filter for LIVE path
        if (effectiveGangPrefix && employees.length > 0) {
            const isNumeric = /^\d+$/.test(effectiveGangPrefix);
            employees = employees.filter(emp => {
                const gc = (emp.gang_code || '').trim().toUpperCase();
                if (isNumeric) {
                    // Extract asistensi number from gang code:
                    // K2xxx → '1' (special case), otherwise first digit sequence
                    const asistensi = gc.startsWith('K2') ? '1' : (gc.match(/\d+/)?.[0] ?? null);
                    return asistensi === effectiveGangPrefix;
                }
                return gc.startsWith(effectiveGangPrefix.toUpperCase());
            });
        }

        if (employees.length === 0) {
            console.log(`[DataExtractor] No employees found! gangCondition=${gangCondition}, gangCode=${gangCode}, divisionCode=${divisionCode}, isHistorical=${isHistorical}`);
            return {
                data_rows: [],
                dynamic_premi_headers: [],
                dynamic_potongan_headers: [],
                premi_title_map: {},
                potongan_title_map: {},
                meta: { execution_time_ms: 0, row_count: 0, cached: false }
            };
        }

        // Enrich join_date and SPSI membership using overlay + history table (extend_db_ptrj).
        if (employees.length > 0) {
            const empCodeList = employees.map(e => `'${e.emp_code}'`).join(',');

            if (empCodeList) {
                try {
                    const extendDb = Database.getExtendedInstance();
                    // Priority 1: profile override from current edit mode.
                    const profileJoinRows = await extendDb.query<any>(buildLatestProfileJoinDateQuery(empCodeList));

                    // Priority 2: legacy period/value override fallback.
                    const valueOverrideRows = await extendDb.query<any>(buildLatestValueJoinDateQuery(empCodeList));

                    // Priority 3: HR history base
                    const historyJoinRows = await extendDb.query<any>(buildLatestHistoryJoinDateQuery(empCodeList));

                    applyJoinDateSourcesToEmployees(employees, {
                        profileOverrideRows: profileJoinRows,
                        valueOverrideRows,
                        historyRows: historyJoinRows
                    });
                } catch (e: any) {
                    warn(CATEGORY, `⚠️ Join date enrichment skipped: ${e.message}`);
                }

                try {
                    const extendDb = Database.getExtendedInstance();
                    const spsiMap = new Map<string, boolean>();

                    // Priority 1: profile override
                    const profileSpsiRows = await extendDb.query<any>(`
                        SELECT p.emp_code, p.is_spsi_member
                        FROM dbo.employee_profile_override_history p
                        INNER JOIN (
                            SELECT emp_code, MAX(id) as max_id
                            FROM dbo.employee_profile_override_history
                            WHERE RTRIM(emp_code) IN (${empCodeList})
                              AND is_spsi_member IS NOT NULL
                            GROUP BY emp_code
                        ) latest ON p.emp_code = latest.emp_code AND p.id = latest.max_id
                    `);
                    for (const row of profileSpsiRows || []) {
                        const empCode = String(row.emp_code || '').trim().toUpperCase();
                        if (!empCode || spsiMap.has(empCode)) continue;
                        spsiMap.set(empCode, !!row.is_spsi_member);
                    }

                    // Priority 2: HR history base
                    const historySpsiRows = await extendDb.query<any>(`
                        SELECT h.emp_code, h.is_spsi_member
                        FROM dbo.history_hr_employee h
                        INNER JOIN (
                            SELECT emp_code, MAX(id) as max_id
                            FROM dbo.history_hr_employee
                            WHERE RTRIM(emp_code) IN (${empCodeList})
                              AND is_spsi_member IS NOT NULL
                            GROUP BY emp_code
                        ) latest ON h.emp_code = latest.emp_code AND h.id = latest.max_id
                    `);
                    for (const row of historySpsiRows || []) {
                        const empCode = String(row.emp_code || '').trim().toUpperCase();
                        if (!empCode || spsiMap.has(empCode)) continue;
                        spsiMap.set(empCode, !!row.is_spsi_member);
                    }

                    for (const emp of employees) {
                        const empCodeKey = String(emp.emp_code || '').trim().toUpperCase();
                        if (spsiMap.has(empCodeKey)) {
                            emp.is_spsi_member = !!spsiMap.get(empCodeKey);
                        }
                    }
                } catch (e: any) {
                    warn(CATEGORY, `⚠️ SPSI membership enrichment skipped: ${e.message}`);
                }
            }
        }

        const empCodes = employees.map(e => e.emp_code);

        const startParallel = performance.now();

        // Helper: wrap a query so timeout/error returns a default value instead of crashing Promise.all
        async function safeQuery<T>(label: string, fn: () => Promise<T>, defaultValue: T): Promise<T> {
            try {
                return await fn();
            } catch (err: any) {
                const isTimeout = err.message?.includes('Timeout') || err.message?.includes('timeout');
                if (isTimeout) {
                    warn(CATEGORY, `⚠️ ${label} timed out — using default (0) values`);
                } else {
                    logError(CATEGORY, `${label} failed — using default values:`, err);
                }
                return defaultValue;
            }
        }

        const emptyPremiResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string>, details: {} as Record<string, any[]> };
        const emptyPotonganResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string> };

        // [OPTIMIZATION] Batch processing: split employees into chunks to prevent SQL timeouts.
        // [PERF] Reduced from 300 to 50 — smaller IN clauses = faster queries (index-friendly).
        // With 900 employees: 18 chunks × 15 queries = 270 queries (all parallel).
        const BATCH_SIZE = 50;
        const empCodeChunks: string[][] = [];
        for (let i = 0; i < empCodes.length; i += BATCH_SIZE) {
            empCodeChunks.push(empCodes.slice(i, i + BATCH_SIZE));
        }

        // Accumulators for batched results
        const attendanceMap: Record<string, any> = {};
        const cuti: Record<string, CutiData> = {};
        const premiResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string>, details: {} as Record<string, any[]> };
        const potonganResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string> };
        const lembur: Record<string, LemburData> = {};
        const lemburWithDetails: Record<string, any> = {};
        const lemburDocDesc: Record<string, number> = {};
        const berasDocDesc: Record<string, number> = {};
        const jabatan: Record<string, number> = {};
        const masaKerja: Record<string, number> = {};
        const upahPokok: Record<string, number> = {};
        const brondol: Record<string, number> = {};
        const taskCodes: Record<string, any> = {};
        const bunchesBatch = new Map();
        const positionHistory = {} as Record<string, string>;

        const harvestEmpCodes = new Set(employees.filter(e => e.gang_code?.toString().toUpperCase().trim().endsWith('H')).map(e => e.emp_code));

        // Global queries that don't depend on empCodes chunks
        // [NIK FIX] Use getEmployeeJobsWithNik() to get dual map: empcode + NIK
        // Karyawan yang pindah gang dapat emp_code baru → jabatan ikut emp_code lama → hilang
        // Solusi: fallback ke NIK saat emp_code tidak ketemu di empcodeMap
        const [jobTitlesResult, manualAdjustmentsRaw] = await Promise.all([
            safeQuery('getJobTitles', async () => {
                const { EmployeeEstateService: EES } = await import("./employeeEstateService");
                return EES.getEmployeeJobsWithNik(empCodes);
            }, { empcodeMap: {} as Record<string, string>, nikMap: {} as Record<string, string> }),
            safeQuery(
                'getManualAdj',
                () => fetchManualAdjustmentRows
                    ? manualAdjustmentService.getAdjustments(month, year, resolveManualAdjustmentFetchGangCode(gangCode, divisionCode), undefined, divisionCode)
                    : Promise.resolve([]),
                []
            )
        ]);
        const jobTitles = jobTitlesResult.empcodeMap;
        const jobTitlesByNik = jobTitlesResult.nikMap;

        // [OPTIMIZATION] Process ALL chunks in PARALLEL instead of sequentially.
        // Each chunk writes to different keys in the same maps (Object.assign merges without overwriting
        // existing keys within the same chunk), so parallel processing is safe and ~Nx faster
        // where N = number of chunks. For 900 employees with BATCH_SIZE=300: 3 chunks → ~3x faster.
        debug(CATEGORY, `Processing ${empCodeChunks.length} chunks in parallel (${empCodeChunks.length}x speedup)...`);

        const emptyPremiForChunk = JSON.parse(JSON.stringify(emptyPremiResult));
        const emptyPotonganForChunk = JSON.parse(JSON.stringify(emptyPotonganResult));

        // Helper: process a single chunk - all queries within are parallel.
        // Using a named function to avoid TypeScript closure inference issues with Promise.all.
        const processChunk = async (chunk: string[], idx: number) => {
            const harvestChunk = chunk.filter(c => harvestEmpCodes.has(c));
            const [attB, cutiB, premiB, potB, lemburCalcB, lemburDetB, lemburDocB, berasDocB, jabatanB, masaKerjaB, upahB, brondolB, taskCodesB, bunchesB, posHistB] = await Promise.all([
                safeQuery(`getAttendance[${idx}]`, () => this.getAttendance(chunk, startDate, endDate, serverProfile), {}),
                safeQuery(`getCuti[${idx}]`, () => this.getCuti(chunk, startDate, endDate, serverProfile), {}),
                safeQuery(`getPremi[${idx}]`, () => this.getPremi(chunk, startDate, endDate, isHistorical, serverProfile), JSON.parse(JSON.stringify(emptyPremiForChunk))),
                safeQuery(`getPotongan[${idx}]`, () => this.getPotongan(chunk, startDate, endDate, serverProfile), JSON.parse(JSON.stringify(emptyPotonganForChunk))),
                skipHeavyDetails
                    ? Promise.resolve({})
                    : safeQuery(`getLemburCalculator[${idx}]`, () => this.getLemburDetailsFromCalculator(chunk, month, year, serverProfile), {}),
                safeQuery(`getLemburDetails[${idx}]`, () => this.getLemburDetailsWithTaskBreakdown(chunk, month, year, serverProfile), {}),
                skipHeavyDetails
                    ? Promise.resolve({})
                    : safeQuery(`getLemburDocDesc[${idx}]`, () => this.getLemburFromDocDesc(chunk, startDate, endDate, serverProfile), {}),
                skipHeavyDetails
                    ? Promise.resolve({})
                    : safeQuery(`getBerasDocDesc[${idx}]`, () => this.getBerasFromDocDesc(chunk, startDate, endDate, serverProfile), {}),
                safeQuery(`getJabatan[${idx}]`, () => this.getTunjanganAmount(chunk, startDate, endDate, "JABATAN", serverProfile), {}),
                safeQuery(`getMasaKerja[${idx}]`, () => this.getTunjanganAmount(chunk, startDate, endDate, "MASA%KERJA", serverProfile), {}),
                safeQuery(`getUpahPokok[${idx}]`, () => this.getUpahPokok(chunk, year, currentYear, serverProfile), {}),
                safeQuery(`getBrondol[${idx}]`, () => this.getBrondol(chunk, startDate, endDate, serverProfile), {}),
                safeQuery(`getTaskCodes[${idx}]`, () => this.getTaskCodes(chunk, startDate, endDate, serverProfile), {}),
                (!skipHarvest && harvestChunk.length > 0) ? safeQuery(`getBunches[${idx}]`, () => this.getBunchesBatch(harvestChunk, month, year), new Map()) : Promise.resolve(new Map()),
                skipHeavyDetails
                    ? Promise.resolve({})
                    : safeQuery(`getPositionHistory[${idx}]`, () => this.getPositionHistory(chunk, month, year), {})
            ]);
            return { attB, cutiB, premiB, potB, lemburCalcB, lemburDetB, lemburDocB, berasDocB, jabatanB, masaKerjaB, upahB, brondolB, taskCodesB, bunchesB, posHistB };
        };

        // Seeder/admin flows prioritize reliability over maximum fan-out.
        // Running every chunk in parallel can overwhelm db_ptrj for large divisions like PG1A.
        const chunkResults = skipHeavyDetails
            ? await processInBatches({
                items: empCodeChunks,
                batchSize: 1,
                label: "DataExtractor.extractPayrollData.sequentialChunks",
                processFn: async (batch, batchIndex) => processChunk(batch[0], batchIndex)
            })
            : await Promise.all(empCodeChunks.map((chunk, idx) => processChunk(chunk, idx)));

        // Merge all chunk results into accumulators
        for (const result of chunkResults) {
            const { attB, cutiB, premiB, potB, lemburCalcB, lemburDetB, lemburDocB, berasDocB, jabatanB, masaKerjaB, upahB, brondolB, taskCodesB, bunchesB, posHistB } = result;

            Object.assign(attendanceMap, attB);
            Object.assign(cuti, cutiB);

            Object.assign(premiResult.amounts, premiB.amounts);
            Object.assign(premiResult.titleMap, premiB.titleMap);
            Object.assign(premiResult.details, premiB.details);

            Object.assign(potonganResult.amounts, potB.amounts);
            Object.assign(potonganResult.titleMap, potB.titleMap);

            Object.assign(lembur, lemburCalcB);
            Object.assign(lemburWithDetails, lemburDetB);
            Object.assign(lemburDocDesc, lemburDocB);
            Object.assign(berasDocDesc, berasDocB);
            Object.assign(jabatan, jabatanB);
            Object.assign(masaKerja, masaKerjaB);
            Object.assign(upahPokok, upahB);
            Object.assign(brondol, brondolB);
            Object.assign(taskCodes, taskCodesB);
            Object.assign(positionHistory, posHistB);

            for (const [k, v] of bunchesB.entries()) bunchesBatch.set(k, v);
        }

        debug(CATEGORY, `Phase 1 (Parallel chunks: ${empCodeChunks.length}): ${(performance.now() - startParallel).toFixed(0)}ms for ${empCodes.length} employees`);

        // ============================================================
        // [OPTIMIZATION] Phase 2: 4 parallel calls
        // ============================================================
        const startPhase2 = performance.now();

        // [NEW] Use GajiPokokService for basic salary calculations in batch
        const gajiPokokInputs = empCodes.map(code => ({
            emp_code: code,
            month,
            year,
            server_profile: serverProfile,
            // Optimization: Pass pre-fetched data so GajiPokokService doesn't re-query
            attendance: attendanceMap[code] || { hk: 0, total_amount_rp: 0 },
            // [FIXED] Only pass upah_dasar if it exists and > 0, otherwise let service fetch from HR_PAYROLL
            // If upahPokok[code] is 0 or undefined, the service will query HR_PAYROLL.PayRate
            upah_dasar: (upahPokok[code] && upahPokok[code] > 0) ? upahPokok[code] : undefined
        }));

        const manualAdjustments = fetchManualAdjustmentRows && Array.isArray(manualAdjustmentsRaw)
            ? manualAdjustmentsRaw
            : [];
        const manualAdjustmentIndex = buildManualAdjustmentIdentityIndex(manualAdjustments);

        // Destructure premi result - uses DocDesc as title
        const { amounts: premi, titleMap: premiTitleMap, details: premiDetails } = premiResult;
        // Destructure potongan result - uses TaskDesc as title
        const { amounts: potongan, titleMap: potonganTitleMap } = potonganResult;

        // ============================================================
        // [OPTIMIZATION] Parallelize: all independent after Promise.all
        // Run concurrently: gajiPokokBatch + OtherIncomes + PTKP + empCode resolution
        // ============================================================
        const [gajiPokokBatchResult, dbOtherIncomes, ptkpMasterRecords, latestEmpCodeMap] = await Promise.all([
            gajiPokokService.calculateBatch(gajiPokokInputs),
            OtherIncomesService.getIncomes(year, month, divisionCode, gangCode),
            (async () => {
                const { ptkpTaxService } = await import('./ptkpTaxService');
                return await ptkpTaxService.getPtkpByYear(year);
            })(),
            (async () => {
                const niksToResolve = employees.map(e => e.actual_nik).filter(Boolean) as string[];
                const prefGangMap = new Map<string, string>();
                if (gangCode && gangCode !== 'ALL') {
                    niksToResolve.forEach(nik => prefGangMap.set(nik.toUpperCase(), gangCode));
                }
                return await employeeGangHistoryService.resolveLatestEmpCodes(niksToResolve, prefGangMap);
            })()
        ]);
        debug(CATEGORY, `Phase 2 (4 parallel calls): ${(performance.now() - startPhase2).toFixed(0)}ms`);

        // [DEBUG] Check if THR records are fetched
        const thrCount = dbOtherIncomes.filter((i: any) => i.income_type === 'THR').length;
        debug("THR FIX", `dbOtherIncomes total=${dbOtherIncomes.length}, THR=${thrCount}, gang=${gangCode}`);
        // ==============================================================================
        // [THR FIX] Pendapatan Lainnya (THR, Bonus, Custom) Storage & Lookup Strategy
        // ==============================================================================
        // PROBLEM: Karyawan yang pindah division mendapat emp_code baru, tapi THR tetap
        // tersimpan dengan emp_code lama di employee_other_incomes.
        //
        // SOLUTION: NIK adalah identifier STABIL yang tidak berubah saat karyawan pindah.
        // emp_code bisa berubah, jadi kita PRIORITASKAN lookup via NIK.
        //
        // DUPLICATE NIK HANDLING: Jika ada NIK duplikat di data THR (karyawan berbeda
        // tapi NIK sama di DB), gunakan komposit key "NIK + NAMA" untuk disambiguate.
        // Nama diambil dari gang member (emp.emp_name dari HR_PAYROLL) untuk matching.
        //
        // LOOKUP PRIORITY:
        //   1. By NIK (primary, stabil)
        //   2. By NIK + emp_name (fallback untuk duplicate NIK)
        //   3. By emp_code (last resort, hanya jika NIK kosong)
        // ==============================================================================

        const dbThpIncomesMap = new Map<string, number>();
        const dbTaxableIncomesMap = new Map<string, number>();
        // Primary storage: key by NIK
        const dbOtherIncomesByNik = new Map<string, { type: string; name: string; amount: number; emp_name?: string }[]>();
        // Fallback storage: key by "NIK + EMP_NAME" for duplicate NIK disambiguation
        const dbOtherIncomesByNikName = new Map<string, { type: string; name: string; amount: number; emp_name?: string }[]>();
        // [NEW] Separate taxable breakdown by income type for PAJAK section display
        const dbTaxableOtherIncomesByNik = new Map<string, { type: string; name: string; amount: number }[]>();
        const dbTaxableOtherIncomesByNikName = new Map<string, { type: string; name: string; amount: number }[]>();
        // [LEVEL 4] Storage by CLEANED NAME — last resort for karyawan pindahan whose NIK
        // in HR_EMPLOYEE differs from NIK stored in employee_other_incomes
        // NOTE: KONTAN uses NIK + EMP_NAME instead of cleaned name to avoid cross-employee contamination
        const dbThpByCleanName = new Map<string, number>();
        const dbTaxableByCleanName = new Map<string, number>();
        const dbOtherIncomesByCleanName = new Map<string, { type: string; name: string; amount: number; emp_name?: string }[]>();
        const dbTaxableOtherByCleanName = new Map<string, { type: string; name: string; amount: number }[]>();
        // [NEW] KONTAN-specific storage: key by NIK + EMP_NAME (from db record)
        // This is more reliable than cleaned_name for KONTAN since different employees
        // can have the same cleaned name (e.g., multiple "SUPRIADI")
        const dbOtherIncomesByNikNameForKontan = new Map<string, { type: string; name: string; amount: number; emp_name?: string }[]>();
        // [NEW] Taxable KONTAN storage by NIK + EMP_NAME for pajak calculation
        const dbTaxableOtherIncomesByNikNameForKontan = new Map<string, { type: string; name: string; amount: number }[]>();

        // [NIK FIX] Count duplicates per NIK+income_type (bukan per NIK saja)
        // Sebelumnya: nikCount per NIK → karyawan dengan THR + KONTAN (2 record, NIK sama)
        // dianggap duplikat NIK → keduanya masuk nikName map, tidak masuk NIK map utama → KONTAN hilang
        // Fix: Hanya anggap duplikat jika ada 2+ record dengan NIK+income_type YG SAMA
        const nikTypeCount = new Map<string, number>(); // key: `${nik}|${income_type}`
        const nikCount = new Map<string, number>();      // kept for backward compat (deprecated usage)
        for (const inc of dbOtherIncomes) {
            const nik = String(inc.nik || '').trim().toUpperCase();
            const itype = String(inc.income_type || '').trim().toUpperCase();
            if (nik) {
                const typeKey = `${nik}|${itype}`;
                nikTypeCount.set(typeKey, (nikTypeCount.get(typeKey) || 0) + 1);
                nikCount.set(nik, (nikCount.get(nik) || 0) + 1); // legacy
            }
        }

        for (const inc of dbOtherIncomes) {
            const nik = String(inc.nik || '').trim().toUpperCase();
            const empCode = String(inc.emp_code || '').trim().toUpperCase();
            // Nama dari DB record (ini adalah nama yang tersimpan di employee_other_incomes)
            const dbEmpName = String(inc.emp_name || '').trim().toUpperCase();
            const incomeEntry = {
                type: inc.income_type,
                name: inc.income_name || inc.income_type,
                amount: Number(inc.amount),
                emp_name: dbEmpName
            };
            const dbCleanName = cleanNameFormat(dbEmpName);
            // KONTAN NIK+NAME key: use emp_name from DB record if available,
            // otherwise fall back to NIK-only key (emp_name is null for KONTAN records entered via UI)
            const nikNameKey = nik ? (dbCleanName ? `${nik}||${dbCleanName}` : nik) : '';
            // [NIK FIX] Use per-type duplicate count for proper dedup detection
            const incType = String(inc.income_type || '').trim().toUpperCase();
            const nikTypeDup = nik ? (nikTypeCount.get(`${nik}|${incType}`) || 0) > 1 : false;

            if (inc.is_paid_in_thp) {
                // Level 1: Store by NIK (prioritas utama)
                if (nik) {
                    dbThpIncomesMap.set(nik, (dbThpIncomesMap.get(nik) || 0) + Number(inc.amount));
                }
                // Level 2: Also store by NIK+NAME only if there's a TRUE duplicate (same income_type, same NIK)
                // [NIK FIX] gunakan nikTypeDup bukan nikCount > 1 agar THR+KONTAN tidak salah dianggap duplikat
                if (nik && nikTypeDup && nikNameKey) {
                    const existing = dbThpIncomesMap.get(nikNameKey) || 0;
                    dbThpIncomesMap.set(nikNameKey, existing + Number(inc.amount));
                }
                // Level 3: Also store by emp_code as fallback (untuk karyawan yang tidak punya nik)
                if (empCode) {
                    dbThpIncomesMap.set(empCode, (dbThpIncomesMap.get(empCode) || 0) + Number(inc.amount));
                }
            }
            if (inc.is_taxable) {
                // Level 1: Store by NIK
                if (nik) {
                    dbTaxableIncomesMap.set(nik, (dbTaxableIncomesMap.get(nik) || 0) + Number(inc.amount));
                    if (!dbTaxableOtherIncomesByNik.has(nik)) {
                        dbTaxableOtherIncomesByNik.set(nik, []);
                    }
                    dbTaxableOtherIncomesByNik.get(nik)!.push(incomeEntry);
                }
                // Level 2: Store by NIK+NAME only for TRUE duplicates (same income_type)
                // [NIK FIX] gunakan nikTypeDup agar KONTAN tidak salah masuk nikName map
                if (nik && nikTypeDup && nikNameKey) {
                    const existing = dbTaxableIncomesMap.get(nikNameKey) || 0;
                    dbTaxableIncomesMap.set(nikNameKey, existing + Number(inc.amount));
                    if (!dbTaxableOtherIncomesByNikName.has(nikNameKey)) {
                        dbTaxableOtherIncomesByNikName.set(nikNameKey, []);
                    }
                    dbTaxableOtherIncomesByNikName.get(nikNameKey)!.push(incomeEntry);
                }
                // Level 3: Store by emp_code as fallback
                if (empCode) {
                    dbTaxableIncomesMap.set(empCode, (dbTaxableIncomesMap.get(empCode) || 0) + Number(inc.amount));
                    if (!dbTaxableOtherIncomesByNik.has(empCode)) {
                        dbTaxableOtherIncomesByNik.set(empCode, []);
                    }
                    dbTaxableOtherIncomesByNik.get(empCode)!.push(incomeEntry);
                }
            }
            // Build primary array: store by NIK (prioritas utama)
            // [NIK FIX] Semua income type (THR, KONTAN, BONUS) harus masuk ke dbOtherIncomesByNik
            // keyed by NIK. Ini memastikan lookup level 1 (by NIK) selalu berhasil.
            if (nik) {
                if (!dbOtherIncomesByNik.has(nik)) {
                    dbOtherIncomesByNik.set(nik, []);
                }
                dbOtherIncomesByNik.get(nik)!.push(incomeEntry);
                // Also store by NIK+NAME only for TRUE duplicates (same income_type)
                // [NIK FIX] gunakan nikTypeDup agar KONTAN tidak salah masuk nikName map
                if (nikTypeDup && nikNameKey) {
                    if (!dbOtherIncomesByNikName.has(nikNameKey)) {
                        dbOtherIncomesByNikName.set(nikNameKey, []);
                    }
                    dbOtherIncomesByNikName.get(nikNameKey)!.push(incomeEntry);
                }
            }
            // Also store by emp_code as fallback
            if (empCode) {
                if (!dbOtherIncomesByNik.has(empCode)) {
                    dbOtherIncomesByNik.set(empCode, []);
                }
                dbOtherIncomesByNik.get(empCode)!.push(incomeEntry);
            }
            // [LEVEL 4] Store by CLEANED NAME as last resort for karyawan pindahan with completely different NIK.
            // IMPORTANT: Only use for THR, BONUS, CUSTOM. Do NOT use for KONTAN (multiple SUPRIADI issue)!
            const isKontan = (inc.income_type || '').toUpperCase() === 'KONTAN' || (inc.income_type || '').toUpperCase() === 'KONTANAN';
            // For KONTAN: store in NIK+NAME fallback map (secondary, in case NIK mismatch)
            // Primary lookup sudah ada via NIK di dbOtherIncomesByNik (di atas)
            if (isKontan && nikNameKey) {
                if (!dbOtherIncomesByNikNameForKontan.has(nikNameKey)) {
                    dbOtherIncomesByNikNameForKontan.set(nikNameKey, []);
                }
                dbOtherIncomesByNikNameForKontan.get(nikNameKey)!.push(incomeEntry);
                // Also store in taxable map
                if (inc.is_taxable) {
                    if (!dbTaxableOtherIncomesByNikNameForKontan.has(nikNameKey)) {
                        dbTaxableOtherIncomesByNikNameForKontan.set(nikNameKey, []);
                    }
                    dbTaxableOtherIncomesByNikNameForKontan.get(nikNameKey)!.push({ type: inc.income_type, name: inc.income_name || inc.income_type, amount: Number(inc.amount) });
                }
            }
            if (dbCleanName && !isKontan) {
                if (inc.is_paid_in_thp) {
                    dbThpByCleanName.set(dbCleanName, (dbThpByCleanName.get(dbCleanName) || 0) + Number(inc.amount));
                }
                if (inc.is_taxable) {
                    dbTaxableByCleanName.set(dbCleanName, (dbTaxableByCleanName.get(dbCleanName) || 0) + Number(inc.amount));
                    if (!dbTaxableOtherByCleanName.has(dbCleanName)) {
                        dbTaxableOtherByCleanName.set(dbCleanName, []);
                    }
                    dbTaxableOtherByCleanName.get(dbCleanName)!.push(incomeEntry);
                }
                if (!dbOtherIncomesByCleanName.has(dbCleanName)) {
                    dbOtherIncomesByCleanName.set(dbCleanName, []);
                }
                dbOtherIncomesByCleanName.get(dbCleanName)!.push(incomeEntry);
            }
        }


        // Build PTKP map from parallel-fetched records
        const dbPtkpMap = new Map<string, string>();
        for (const record of ptkpMasterRecords) {
            if (record.emp_code) {
                dbPtkpMap.set(record.emp_code.trim().toUpperCase(), record.ptkp_status);
            }
        }

        const dataRows: PayrollRow[] = [];
        const dynamicPremiSet = new Set<string>();
        const dynamicPotonganSet = new Set<string>();
        const seenEmpCodes = new Set<string>();
        const startRowProcessing = performance.now();

        for (const emp of employees) {
            const nikClean = emp.actual_nik?.trim().toUpperCase() || "";
            const latestEmpCode = latestEmpCodeMap.get(nikClean) || emp.emp_code;

            const attData = attendanceMap[emp.emp_code] || { hk: 0, total_hours: 0, shortage_count: 0, total_amount_rp: 0 };
            const hk = attData.hk;
            const empCuti = cuti[emp.emp_code] || { cuti_tahunan: 0, cuti_sakit_haid: 0, cuti_minggu: 0, cuti_nasional: 0 };

            // Calculate Effective HK (excluding Sundays and National Holidays)
            // This filters out employees who only have auto-generated holiday attendance but no actual work/leave
            const effective_hk = hk - (empCuti.cuti_minggu + empCuti.cuti_nasional);

            const dbEmpPremiSource = premi[emp.emp_code] || {};
            const dbEmpPotonganSource = potongan[emp.emp_code] || {};
            const empPremi = manualBufferOnlyMode ? pickStaticPremiForManualBuffer(dbEmpPremiSource) : { ...dbEmpPremiSource };
            const empPotongan = manualBufferOnlyMode
                ? pickStaticPotonganForManualBuffer(dbEmpPotonganSource)
                : { ...dbEmpPotonganSource };
            const empLembur = lembur[emp.emp_code] || { jam: 0, jumlah: 0 };
            const empLemburDetails = lemburWithDetails[emp.emp_code] || { jam: 0, jumlah: 0, task_breakdown: [] };
            const empLemburDocDesc = lemburDocDesc[emp.emp_code] || 0;
            const empBerasDocDesc = berasDocDesc[emp.emp_code] || 0;
            const empJabatan = jabatan[emp.emp_code] || 0;
            const empMasaKerjaJumlah = masaKerja[emp.emp_code] || 0;

            const daysInMonth = new Date(year, month, 0).getDate();

            // Get data carefully computed by GajiPokokService
            const gpResult = gajiPokokBatchResult.results.get(emp.emp_code)?.output?.value;
            const empUpahDasar = gpResult?.upah_dasar?.value || emp.pay_rate || 0;

            // Get job title from history override if available, otherwise use real-time
            // [NIK FIX] Fallback ke NIK lookup jika emp_code tidak ketemu (karyawan pindah gang)
            // [JABATAN FIX] Fallback terakhir ke HR_GANGLN.Jabatan (source langsung dari gang member)
            const empJobTitle = positionHistory[emp.emp_code]
                || jobTitles[emp.emp_code]       // lookup by emp_code (existing)
                || jobTitlesByNik[nikClean]      // lookup by NIK (NEW — karyawan pindah gang)
                || (emp.jabatan || "").trim();   // [FIX] Fallback terakhir dari HR_GANGLN.Jabatan

            // ============================================================
            // [PERATURAN BISNIS - EFFECTIVE HK FILTER]
            // Exclude effective_hk = 0, kecuali ada manual adjustment.
            //
            // effective_hk = hk - (cuti_minggu + cuti_nasional)
            // Manual adjustment harus tetap terlihat agar nilai yang pernah diinput
            // di payroll_manual_adjustments tidak hilang dari daftar upah.
            //
            // ATURAN: effective_hk = 0 = TIDAK ADA, kecuali manual adjustment.
            // ============================================================
            const totalCuti = empCuti.cuti_tahunan + empCuti.cuti_sakit_haid + empCuti.cuti_minggu + empCuti.cuti_nasional;
            const hari_kerja = Math.max(0, hk - totalCuti);
            const other_cuti = empCuti.cuti_tahunan + empCuti.cuti_sakit_haid;
            const empAdjustments = getManualAdjustmentsForEmployee(manualAdjustmentIndex, emp);

            if (!shouldKeepPayrollRowAfterEffectiveHkFilter({
                jumlahHk: hk,
                cutiMingguHari: empCuti.cuti_minggu,
                cutiNasionalHari: empCuti.cuti_nasional,
                hasManualAdjustments: empAdjustments.length > 0
            })) continue;

            const upah_pokok = attData.total_amount_rp || 0;
            // [PHASE 2.5] Brondol dual source tracking
            const empBrondolLoosefruit = brondol[emp.emp_code] || 0;
            const empBrondolAdtrans = empPremi["brondol"] || 0; // From PR_ADTRANS (before adding loosefruit)
            const empBrondolTotal = empBrondolLoosefruit + empBrondolAdtrans;
            // Keep empBrondol for backward compatibility (total)
            const empBrondol = empBrondolTotal;

            const masaKerjaDisplay = calculateMasaKerjaDisplay(emp.join_date, month, year);
            const masaKerjaLama = masaKerjaDisplay.years;

            const berasRate = emp.beras_rate > 0 ? emp.beras_rate : 0;
            const berasJumlahBase = berasRate > 0 && hk > 0 ? berasRate * hk : 0;

            const isF2H = emp.gang_code === 'F2H';
            const additionalBeras = isF2H ? empBerasDocDesc : 0;
            const berasJumlah = berasJumlahBase + additionalBeras;

            const dbPotSpsi = Math.abs(dbEmpPotonganSource["SPSI"] || 0);
            const isSpsiMember = typeof emp.is_spsi_member === "boolean"
                ? emp.is_spsi_member
                : deriveInitialSpsiMember(dbPotSpsi);
            const autoBufferVerification = payrollAutoBufferService.calculateVerificationValues({
                jabatanText: empJobTitle,
                roleText: emp.jabatan || "",
                hariKerja: hari_kerja,
                masaKerjaTahun: masaKerjaLama,
                isSpsiMember,
                divisionCode,
                dbJabatanJumlah: empJabatan,
                dbMasaKerjaJumlah: empMasaKerjaJumlah,
                dbPotSpsi,
                useAutoBuffer
            });
            let empJabatanDisplay = autoBufferVerification.display.jabatanAmount;
            let empMasaKerjaDisplay = autoBufferVerification.display.masaKerjaAmount;
            let jabatanRate = autoBufferVerification.display.jabatanRate;
            let masaKerjaRate = autoBufferVerification.display.masaKerjaRate;
            let pot_spsi = autoBufferVerification.display.spsiDeduction;
            const valueSyncFrame: Record<string, "red" | "green"> = {
                ...autoBufferVerification.valueSyncFrame
            };
            const valueSourceCompare: Record<string, { db_ptrj: number | string | boolean | null; active: number | string | boolean | null }> = {
                ...autoBufferVerification.valueSourceCompare,
                is_spsi_member: { db_ptrj: deriveInitialSpsiMember(dbPotSpsi), active: isSpsiMember }
            };

            const empLemburJumlahPure = empLemburDetails.jumlah || 0;
            const empLemburJamPure = empLemburDetails.jam || 0;

            const gaji_pokok_ideal = gpResult?.gaji_pokok_ideal?.value || 0;
            const gaji_pokok_aktual = gpResult?.gaji_pokok_aktual?.value || 0;
            const gaji_pokok = gaji_pokok_aktual;
            const total_tunjangan = berasJumlah + empJabatanDisplay + empMasaKerjaDisplay + empLemburJumlahPure;

            // PREMI CALCULATION - Ensure everything is summed into total_premi
            // [PHASE 2.5] Brondol is now combined at line 570 (empBrondol = empBrondolTotal)
            // empPremi["brondol"] already contains adtrans, we need to add ONLY loosefruit portion
            if (empBrondolLoosefruit > 0) {
                // empPremi["brondol"] currently has adtrans, add loosefruit to combine both sources
                empPremi["brondol"] = (empPremi["brondol"] || 0) + empBrondolLoosefruit;
                premiTitleMap["brondol"] = "PREMI BRONDOL";
            }

            let total_premi = 0;
            for (const [key, val] of Object.entries(empPremi)) {
                // Key could be: brondol, premi_pruning, premi_kinerja, premi_harvesting, etc.
                const amount = Number(val) || 0;
                // [MODIFIED] User requested to exclude ONLY 'koreksi' from total_premi
                // Tiket, panen, pruning, etc. are all included as requested.
                if (key !== "koreksi") {
                    total_premi += amount;
                }

                // Add all individual premiums (except static/excluded ones) to dynamic set for UI columns
                // brondol is a static column (PR_LOOSEFRUIT + PR_ADTRANS), not a dynamic premi type
                if (key !== "koreksi" && key !== "brondol") {
                    dynamicPremiSet.add(key);
                }
            }

            registerManualAdjustmentMetadataDynamicHeaders(
                empAdjustments,
                dynamicPremiSet,
                dynamicPotonganSet,
                premiTitleMap,
                potonganTitleMap
            );
            const premiKeysBefore = new Set(Object.keys(empPremi));
            const potonganKeysBefore = new Set(Object.keys(empPotongan));
            const manualApplied = allowManualAdjustments && empAdjustments.length > 0
                ? applyManualAdjustmentsToEmployee({
                    adjustments: empAdjustments as any[],
                    empPremi,
                    empPotongan,
                    premiTitleMap,
                    potonganTitleMap,
                    mode: 'override'
                })
                : {
                    empPremi,
                    empPotongan,
                    premiTitleMap,
                    potonganTitleMap,
                    koreksiVariations: {},
                    totalPremiDelta: 0,
                    potKoreksiDelta: 0,
                    otherPotonganDelta: 0,
                    fieldSyncMeta: []
                };

            for (const key of Object.keys(manualApplied.empPremi)) {
                if (!premiKeysBefore.has(key)) {
                    dynamicPremiSet.add(key);
                }
            }

            for (const key of Object.keys(manualApplied.empPotongan)) {
                if (!potonganKeysBefore.has(key)) {
                    dynamicPotonganSet.add(key);
                }
            }

            total_premi += manualApplied.totalPremiDelta;
            for (const syncMeta of manualApplied.fieldSyncMeta) {
                attachManualAdjustmentValueSourceComparison(
                    valueSyncFrame,
                    valueSourceCompare,
                    syncMeta,
                    resolveManualAdjustmentDbPtrjCompareAmount(syncMeta, dbEmpPremiSource, dbEmpPotonganSource)
                );
            }
            if (!allowManualAdjustments && empAdjustments.length > 0) {
                attachManualAdjustmentSourceComparisons(
                    valueSyncFrame,
                    valueSourceCompare,
                    empAdjustments,
                    dbEmpPremiSource,
                    dbEmpPotonganSource
                );
            }

            const pot_pph21 = Math.abs(empPotongan["PPH21"] || 0);
            // [NEW] Premi PPH from TaskDesc = 'ACCRUALS-CHECKROLL' (treated as potongan upah bersih)
            const pot_premi_pph = Math.abs(empPotongan["PREMI_PPH"] || 0);

            // [CRITICAL FIX] PREMI_PPH is explicitly excluded from dynamicPotonganSet
            // so it doesn't appear as a generic deduction in the UI. Ensure it is handled 
            // separately as an addition to net wage.

            // [NEW] Handle KOREKSI variations separately
            // Collect all keys that start with "KOREKSI" (KOREKSI, KOREKSI_A, KOREKSI_PANEN, etc.)
            const koreksiVariations: { [key: string]: number } = {};
            let pot_koreksi = 0;

            for (const [key, val] of Object.entries(empPotongan)) {
                const keyUpper = String(key).toUpperCase();
                if (keyUpper.startsWith("KOREKSI")) {
                    const amount = Math.abs(val as number);
                    koreksiVariations[key] = amount;
                    pot_koreksi += amount;
                    dynamicPotonganSet.add(key);
                }
            }

            Object.assign(koreksiVariations, manualApplied.koreksiVariations);

            let other_potongan = 0;
            let db_bpjs_kes = 0;

            for (const [key, val] of Object.entries(empPotongan)) {
                // Skip static fields and KOREKSI, PREMI_PPH (handled above)
                // Use case-insensitive check for KOREKSI to be safe
                const keyUpper = key.toUpperCase();
                if (key === "SPSI" || key === "PPH21" || keyUpper.startsWith("KOREKSI") || key === "PREMI_PPH") {
                    continue;
                }

                if (keyUpper.includes("BPJS")) {
                    if (!keyUpper.includes("MAJIKAN") && !keyUpper.includes("MAJ")) {
                        db_bpjs_kes += Math.abs(val as number);
                    }
                    continue;
                }

                // [CRITICAL FIX 2026-04-03]
                // Prevent DOUBLE DEDUCTION of custom incomes (KONTAN, THR, BONUS) from PR_ADTRANS.
                // These components are now fully managed by employee_other_incomes and aggregated into
                // pendapatan_lainnya_amount, which automatically deducts them in PayrollCalculator.
                // Including them here would subtract them a second time, causing minus Upah Bersih.
                if (keyUpper.includes("KONTAN") || keyUpper.includes("THR") || keyUpper.includes("BONUS")) {
                    continue;
                }

                other_potongan += Math.abs(val as number);
                dynamicPotonganSet.add(key);
            }

            // Manual POTONGAN_BERSIH entries were already merged into empPotongan above,
            // so the loop coverage here is the single source of truth for other_potongan.

            const caruman = calculateAllCaruman(empUpahDasar, empMasaKerjaDisplay);

            const pot_astek_pekerja = caruman.astek_pekerja_jht;
            const pot_astek_majikan = caruman.astek_majikan_total;
            const pot_astek_jumlah = pot_astek_pekerja + pot_astek_majikan;

            const pot_bpjs_kesehatan_pekerja_formula = caruman.bpjs_kes_pekerja;
            const pot_bpjs_kesehatan_pekerja = pot_bpjs_kesehatan_pekerja_formula + db_bpjs_kes;

            const pot_bpjs_kesehatan_majikan = caruman.bpjs_kes_majikan;
            const pot_bpjs_kesehatan_jumlah = pot_bpjs_kesehatan_pekerja + pot_bpjs_kesehatan_majikan;

            const pot_bpjs_pensiun_pekerja = caruman.bpjs_pensiun_pekerja;
            const pot_bpjs_pensiun_majikan = caruman.bpjs_pensiun_majikan;
            const pot_bpjs_pensiun_jumlah = pot_bpjs_pensiun_pekerja + pot_bpjs_pensiun_majikan;

            // ==============================================================================
            // [THR FIX v2] Multi-level lookup — NIK-first for karyawan pindahan
            // ==============================================================================
            // ROOT CAUSE: ALL 1616 THR records in employee_other_incomes have EMPTY emp_code.
            // NIK is the only reliable identifier in the database.
            //
            // PRIORITY:
            //   1. NIK — langsung & simpel (SEMUA record THR disimpan by NIK)
            //   2. NIK + EMP_NAME — duplicate NIK disambiguation
            //   3. emp_code — fallback (untuk case emp_code mulai terisi di masa depan)
            //   4. CLEANED NAME — last resort (karyawan pindahan, NIK berbeda total)
            // ==============================================================================
            const empNik = String(emp.actual_nik || '').trim().toUpperCase();
            const empCodeKey = String(emp.emp_code || '').trim().toUpperCase();
            // Nama dari gang member (HR_PAYROLL) - digunakan untuk NIK+NAME composite key
            const originalEmpName = String(emp.emp_name || '').trim().toUpperCase();
            const empNameForKey = cleanNameFormat(originalEmpName);
            // Composite key: NIK + EMP_NAME (digunakan jika ada duplicate NIK)
            const nikNameKey = empNik && empNameForKey ? `${empNik}||${empNameForKey}` : '';

            // Helper: lookup dengan 4-level fallback
            // [THR FIX] PRIORITY CHANGE: NIK adalah identifier STABIL yang tidak berubah saat karyawan pindah.
            // Data menunjukkan SEMUA 1616 THR record di employee_other_incomes punya emp_code KOSONG
            // dan hanya NIK yang terisi. Jadi NIK jadi prioritas utama.
            //
            // PRIORITY:
            //   1. NIK — langsung (SEMUA record THR disimpan by NIK, emp_code kosong)
            //   2. NIK + EMP_NAME — duplicate NIK disambiguation
            //   3. emp_code — fallback (untuk case di masa depan kalau emp_code mulai terisi)
            //   4. CLEANED NAME — last resort (karyawan pindahan, NIK berbeda total)
            const lookupByNik = (map: Map<string, number>, nameMap?: Map<string, number>) => {
                let val = 0;
                // [DEBUG] Targeted logging for A0778 - trace exact NIK lookup
                if (empCodeKey === 'A0778') {
                    console.log(`[THR DEBUG A0778] lookupByNik: empNik="${empNik}", empCode="${empCodeKey}", name="${empNameForKey}"`);
                    console.log(`[THR DEBUG A0778] lookupByNik: map.size=${map.size}`);
                    console.log(`[THR DEBUG A0778] lookupByNik: map.has(empNik)=${map.has(empNik)}, map.get(empNik)=${map.get(empNik)}`);
                    console.log(`[THR DEBUG A0778] lookupByNik: map.has(empCode)=${map.has(empCodeKey)}, map.get(empCode)=${map.get(empCodeKey)}`);
                    // Check partial match
                    const allNIKLike = [...map.keys()].filter(k => k.includes('1902052707850001'));
                    console.log(`[THR DEBUG A0778] lookupByNik: NIK-like keys: ${JSON.stringify(allNIKLike)}`);
                }
                // Level 1: NIK (prioritas utama — semua THR disimpan by NIK)
                if (empNik) {
                    val = map.get(empNik) || 0;
                }
                // Level 2: NIK + NAMA (duplicate NIK disambiguation)
                if (val === 0 && nikNameKey) {
                    val = map.get(nikNameKey) || 0;
                }
                // Level 3: emp_code (fallback — untuk case emp_code terisi)
                if (val === 0 && empCodeKey) {
                    val = map.get(empCodeKey) || 0;
                }
                // [REMOVED] Level 4: Name-based lookup has been disabled.
                // Reason: employees with the same name (e.g. "SUPRIADI") would share
                // each other's THR/Kontanan values — causing critical data contamination.
                // NIK-based lookup (Level 1) is the only reliable unique identifier.
                if (empCodeKey === 'A0778') {
                    console.log(`[THR DEBUG A0778] lookupByNik FINAL: val=${val}`);
                }
                return val;
            };

            // [DEBUG] Targeted logging for A0778 - trace exact NIK lookup
            if (empCodeKey === 'A0778') {
                const byNik = dbOtherIncomesByNik.get(empNik);
                const byNikName = dbOtherIncomesByNikName.get(nikNameKey);
                const byEmpCode = dbOtherIncomesByNik.get(empCodeKey);
                const byCleanName = dbOtherIncomesByCleanName.get(empNameForKey);
                const allKeys = [...dbOtherIncomesByNik.keys()].slice(0, 20);
                console.log(`[THR DEBUG A0778] empNik="${empNik}", empCode="${empCodeKey}", nikNameKey="${nikNameKey}", empName="${empNameForKey}"`);
                console.log(`[THR DEBUG A0778] map.size=${dbOtherIncomesByNik.size}`);
                console.log(`[THR DEBUG A0778] Level1(NIK)="${empNik}" → ${byNik ? `${byNik.length} entries` : 'NOT FOUND'}`);
                if (byNik) byNik.forEach(e => console.log(`[THR DEBUG A0778]   NIK entry: type=${e.type}, name=${e.name}, amount=${e.amount}`));
                console.log(`[THR DEBUG A0778] Level2(NIK+NAME)="${nikNameKey}" → ${byNikName ? `${byNikName.length} entries` : 'NOT FOUND'}`);
                if (byNikName) byNikName.forEach(e => console.log(`[THR DEBUG A0778]   NIK+NAME entry: type=${e.type}, name=${e.name}, amount=${e.amount}`));
                console.log(`[THR DEBUG A0778] Level3(EC)="${empCodeKey}" → ${byEmpCode ? `${byEmpCode.length} entries` : 'NOT FOUND'}`);
                if (byEmpCode) byEmpCode.forEach(e => console.log(`[THR DEBUG A0778]   EC entry: type=${e.type}, name=${e.name}, amount=${e.amount}`));
                console.log(`[THR DEBUG A0778] Level4(NAME)="${empNameForKey}" → ${byCleanName ? `${byCleanName.length} entries` : 'NOT FOUND'}`);
                if (byCleanName) byCleanName.forEach(e => console.log(`[THR DEBUG A0778]   NAME entry: type=${e.type}, name=${e.name}, amount=${e.amount}`));
                // Check if any key in the map contains our NIK as substring
                const matchingKeys = [...dbOtherIncomesByNik.keys()].filter(k => k.includes('1902052707850001'));
                console.log(`[THR DEBUG A0778] Keys containing target NIK substring: ${JSON.stringify(matchingKeys)}`);
                console.log(`[THR DEBUG A0778] First 10 map keys: ${JSON.stringify(allKeys)}`);
            }

            const lookupOtherIncomes = (map: Map<string, { type: string; name: string; amount: number; emp_name?: string }[]>, nameMap?: Map<string, { type: string; name: string; amount: number; emp_name?: string }[]>) => {
                const results = new Map<string, { type: string; name: string; amount: number; emp_name?: string }>();

                // [THR DEDUP] For THR, if there are multiple entries with the same type
                // (e.g., "Tunjangan Hari Raya" + "Tunjangan Hari Raya (Proporsi 9/12)"),
                // only keep ONE — the non-proportional/full entry.
                // Summing both would double-count and give wrong THR amounts.

                const addEntries = (entries: { type: string; name: string; amount: number; emp_name?: string }[]) => {
                    for (const e of entries) {
                        const key = `${e.type}|${e.name}`;
                        // Keep the first found (prioritize lookup order)
                        if (!results.has(key)) results.set(key, e);
                    }
                };

                let foundInPrimary = false;

                // Level 1: NIK (prioritas utama — semua THR disimpan by NIK)
                if (empNik && map.has(empNik)) {
                    addEntries(map.get(empNik) || []);
                    foundInPrimary = true;
                }

                // Level 2: NIK + NAMA (duplicate NIK disambiguation)
                if (nikNameKey && map.has(nikNameKey)) {
                    addEntries(map.get(nikNameKey) || []);
                    foundInPrimary = true;
                }

                // Level 3: emp_code (fallback — untuk case emp_code terisi manual UI)
                if (empCodeKey && map.has(empCodeKey)) {
                    addEntries(map.get(empCodeKey) || []);
                    foundInPrimary = true;
                }

                // [REMOVED] Level 4: Name-based lookup disabled to prevent cross-contamination.
                // Employees with the same name (e.g. "AHMAD", "SUPRIADI") would receive
                // each other's THR/Kontanan — causing payroll data corruption.
                // All income records MUST be stored with a valid NIK for lookup to work.

                // [THR DEDUP FIX] Collect all THR entries, deduplicate by preferring
                // non-proportional entry over proportional one.
                const thrKeys = Array.from(results.keys()).filter(k => k.startsWith('THR|') || k.startsWith('THR_ADDITIONAL|'));
                if (thrKeys.length > 1) {
                    const thrEntries = thrKeys.map(k => results.get(k)!);
                    const nonProporsi = thrEntries.find(e => !e.name.toUpperCase().includes('PROPORSI'));
                    const proporsi = thrEntries.find(e => e.name.toUpperCase().includes('PROPORSI'));
                    
                    const bestEntry = nonProporsi || proporsi || thrEntries[0];
                    
                    // Remove ALL THR keys
                    for (const k of thrKeys) {
                        results.delete(k);
                    }
                    
                    // Add back only the best one
                    results.set(`${bestEntry.type}|${bestEntry.name}`, bestEntry);
                }

                return Array.from(results.values());
            };

            // [PRE-COMPUTE] Pendapatan Lainnya (THR + Bonus + Custom) for upah_bersih deduction
            const empOtherIncomesBase = lookupOtherIncomes(dbOtherIncomesByNik, dbOtherIncomesByCleanName);
            // [NEW] Also include KONTAN from NIK+NAME map for employees whose NIK doesn't match directly
            // This ensures KONTAN records are found even when the NIK in employee_other_incomes
            // differs from the NIK in HR_EMPLOYEE for this employee.
            const empOtherIncomesKontanNikName = nikNameKey
                ? (dbOtherIncomesByNikNameForKontan.get(nikNameKey) || []).filter(
                    oi => !empOtherIncomesBase.some(existing => existing.type === oi.type && existing.name === oi.name)
                  )
                : [];
            const empOtherIncomes = [...empOtherIncomesBase, ...empOtherIncomesKontanNikName];
            const empTaxableOtherIncomes = lookupOtherIncomes(dbTaxableOtherIncomesByNik, dbTaxableOtherByCleanName);
            // Also check nik+name specific maps for taxable breakdown
            const empTaxableOtherIncomesNikName = nikNameKey ? (dbTaxableOtherIncomesByNikName.get(nikNameKey) || []) : [];
            const empTaxableOtherIncomesAll = [...empTaxableOtherIncomes, ...empTaxableOtherIncomesNikName.filter(
                ni => !empTaxableOtherIncomes.some(existing => existing.type === ni.type && existing.name === ni.name)
            )];

            const getOiByType = (type: string) => sumOtherIncomeByCanonicalType(empOtherIncomes, type);
            const getTaxableOiByType = (type: string, incomeList: { type: string; name: string; amount: number }[]) =>
                sumOtherIncomeByCanonicalType(incomeList, type);

            const taxable_pendapatan_thr = getTaxableOiByType('THR', empTaxableOtherIncomesAll);
            // [DEBUG] Final THR value for A0778
            if (empCodeKey === 'A0778') {
                const pendapatan_thr = getOiByType('THR');
                console.log(`[THR DEBUG A0778] FINAL RESULT: empOtherIncomes=${empOtherIncomes.length} entries`);
                empOtherIncomes.forEach(e => console.log(`[THR DEBUG A0778]   entry: type=${e.type}, name=${e.name}, amount=${e.amount}`));
                console.log(`[THR DEBUG A0778] FINAL: getOiByType('THR')=${pendapatan_thr}, taxable=${taxable_pendapatan_thr}`);
            }
            const taxable_pendapatan_bonus = getTaxableOiByType('BONUS', empTaxableOtherIncomesAll);
            const taxable_pendapatan_custom = getTaxableOiByType('CUSTOM', empTaxableOtherIncomesAll);

            // [DYNAMIC] Discover all non-standard income types and sum them
            const standardTypes = new Set(['THR', 'BONUS', 'CUSTOM']);
            const customTypeAmounts: Record<string, number> = {};
            for (const oi of empOtherIncomes) {
                const oiType = getCanonicalOtherIncomeType(oi);
                if (oiType && !standardTypes.has(oiType)) {
                    customTypeAmounts[oiType] = (customTypeAmounts[oiType] || 0) + Number(oi.amount || 0);
                }
            }
            // [NEW] KONTAN FALLBACK: Also check NIK+NAME map for KONTAN records
            // This catches KONTAN that wasn't matched by NIK lookup (e.g., when the NIK
            // stored in employee_other_incomes differs from the NIK in HR_EMPLOYEE).
            // Uses NIK + emp_name (from db record) for reliable disambiguation.
            if (nikNameKey) {
                const kontanByNikName = dbOtherIncomesByNikNameForKontan.get(nikNameKey) || [];
                for (const oi of kontanByNikName) {
                    const oiType = getCanonicalOtherIncomeType(oi);
                    if (oiType && !standardTypes.has(oiType)) {
                        // DEDUP: only add if not already found via NIK lookup
                        if (!customTypeAmounts[oiType]) {
                            customTypeAmounts[oiType] = 0;
                        }
                        // Check if this specific entry (same type+name) is already in empOtherIncomes
                        const alreadyFound = empOtherIncomes.some(existing =>
                            existing.type === oi.type && existing.name === oi.name
                        );
                        if (!alreadyFound) {
                            customTypeAmounts[oiType] = (customTypeAmounts[oiType] || 0) + Number(oi.amount || 0);
                        }
                    }
                }
            }
            // [DEBUG KONTAN] Log custom type amounts for this employee
            const customTypesTotal = Object.values(customTypeAmounts).reduce((sum, v) => sum + v, 0);
            if (customTypesTotal > 0) {
                debug("KONTAN", `empNik=${empNik}, empCodeKey=${empCodeKey}, customTypeAmounts=`, JSON.stringify(customTypeAmounts));
            }

            // Taxable for custom types
            let taxable_custom_types_total = 0;
            for (const oi of empTaxableOtherIncomesAll) {
                const oiType = getCanonicalOtherIncomeType(oi);
                if (oiType && !standardTypes.has(oiType)) {
                    taxable_custom_types_total += Number(oi.amount || 0);
                }
            }
            // [NEW] KONTAN FALLBACK for taxable: also check NIK+NAME taxable map
            if (nikNameKey) {
                const kontanTaxableByNikName = dbTaxableOtherIncomesByNikNameForKontan.get(nikNameKey) || [];
                for (const oi of kontanTaxableByNikName) {
                    const oiType = getCanonicalOtherIncomeType(oi);
                    if (oiType && !standardTypes.has(oiType)) {
                        // DEDUP: only add if not already counted
                        const alreadyCounted = empTaxableOtherIncomesAll.some(
                            existing => existing.type === oi.type && existing.name === oi.name
                        );
                        if (!alreadyCounted) {
                            taxable_custom_types_total += Number(oi.amount || 0);
                        }
                    }
                }
            }
            const taxable_pendapatan_lainnya = taxable_pendapatan_thr + taxable_pendapatan_bonus + taxable_pendapatan_custom + taxable_custom_types_total;
            // [UPDATED] pendapatan_lainnya_amount = TOTAL all other incomes (THR + Bonus + Custom + Kontan, etc.)
            // ALL of this amount is taxable AND reduces take-home pay via total_potongan
            const pendapatan_lainnya_amount = getOiByType('THR') + getOiByType('BONUS') + getOiByType('CUSTOM') + customTypesTotal;

            // [SINGLE SOURCE OF TRUTH] Use PayrollCalculator for ALL derived field formulas
            // This ensures consistency across ALL tabs: Daftar Upah, Pajak, Summary, Analysis.
            // See PayrollCalculator.ts for full business rule documentation.
            const rawEmpCode = String(emp.emp_code || '').trim().toUpperCase();
            const statusPtkp = dbPtkpMap.get(rawEmpCode) || mapBerasRateToPTKP(berasRate);

            const calc = PayrollCalculator.calculate(
                {
                    // Earnings
                    gaji_pokok_aktual,
                    beras_jumlah: berasJumlah,
                    jabatan_jumlah: empJabatanDisplay,
                    masa_kerja_jumlah: empMasaKerjaDisplay,
                    lembur_jumlah: empLemburJumlahPure,
                    total_tunjangan,
                    total_premi,
                    pot_koreksi,
                    pendapatan_lainnya: pendapatan_lainnya_amount,
                    // Deductions
                    pot_astek_pekerja,
                    pot_bpjs_kesehatan_pekerja,
                    pot_bpjs_pensiun_pekerja,
                    pot_spsi,
                    pot_pph21,
                    other_potongan,
                    pot_premi_pph,
                    // Tax components (employer)
                    astek_majikan: caruman.astek_majikan_jkk_jkm,
                    bpjs_majikan: caruman.bpjs_kes_majikan,
                },
                statusPtkp
            );

            // Extract results from PayrollCalculator
            // [FIX] Extract upah_kotor separately from jumlah_upah_kotor for correct tax/export calculations
            // upah_kotor = gaji_pokok_aktual + total_tunjangan + total_premi (without koreksi)
            // jumlah_upah_kotor = upah_kotor - pot_koreksi + pendapatan_lainnya (with koreksi)
            const {
                upah_kotor,
                jumlah_upah_kotor,
                potongan_upah_kotor,
                upah_kotor_pajak,
                penghasilan_bruto,
                tarif_pajak_ter,
                pph21_ter,
                total_potongan,
                total_potongan_bersih,
                upah_bersih,
            } = calc;

            const rowFound = seenEmpCodes.has(emp.emp_code);
            if (rowFound) continue;
            
            // Keep every employee that passed strict effective_hk validation above.
            seenEmpCodes.add(emp.emp_code);

            // formula handled inside OOP logic
            const koreksi_hk = gpResult?.koreksi_hk?.value || 0;
            const row: PayrollRow = {
                emp_code: emp.emp_code,  // [FIX] Mengambil empcode langsung dari HR_GANGLN
                nik: emp.actual_nik || emp.emp_code,  // Actual NIK KTP (e.g. 1902050504860001)
                new_nik: emp.actual_nik || emp.emp_code,  // NEW: Explicit KTP NIK
                nama: emp.emp_name,
                jabatan_estate: empJobTitle,
                jenis_kelamin: emp.gender === "2" || emp.gender === "P" ? "P" : "L",
                status_ptkp: statusPtkp,
                kategori_ter: mapPTKPToTER(statusPtkp),
                loc_code: emp.loc_code,
                gang_code: emp.gang_code,
                alamat: emp.res_address || "",
                join_date: emp.join_date || null,  // [JOIN_DATE] Latest from history_hr_employee MAX(id), enriched earlier
                tanggal_masuk: emp.join_date || null,  // Alias for Excel export compatibility
                is_spsi_member: isSpsiMember,
                upah_dasar: empUpahDasar,
                jumlah_hk: hk, // [UPDATED] Use Total HK (including Sundays & Holidays) as requested
                total_jam_kerja: attData.total_hours,
                has_shortage: attData.shortage_count > 0,
                shortage_details: attData.shortage_details || [],
                shortage_total_hours: attData.shortage_total_hours || 0,
                has_excess: (attData.excess_details || []).length > 0,
                excess_details: attData.excess_details || [],
                excess_total_hours: attData.excess_total_hours || 0,
                hari_kerja,
                gaji_pokok,
                kehadiran: hari_kerja,
                // Task/Job Code fields
                task_code: taskCodes[emp.emp_code]?.task_code || "",
                task_desc: taskCodes[emp.emp_code]?.task_desc || "",
                task_type: taskCodes[emp.emp_code]?.task_type || "",
                task_uom: taskCodes[emp.emp_code]?.task_uom || "",
                cuti_tahunan_hari: empCuti.cuti_tahunan,
                cuti_sakit_haid_hari: empCuti.cuti_sakit_haid,
                cuti_minggu_hari: empCuti.cuti_minggu,
                cuti_nasional_hari: empCuti.cuti_nasional,
                beras_rate: berasRate,
                beras_jumlah: berasJumlah,
                jabatan_rate: jabatanRate,
                jabatan_jumlah: empJabatanDisplay,
                masa_kerja_tahun: masaKerjaLama,
                masa_kerja_display_years: masaKerjaDisplay.years,
                masa_kerja_display_months: masaKerjaDisplay.months,
                masa_kerja_label: masaKerjaDisplay.label,
                masa_kerja_rate: masaKerjaRate,
                masa_kerja_jumlah: empMasaKerjaDisplay,
                // [FIX] Use pure overtime (OT=1) values to ensure detail records match the total
                lembur_jam: empLemburJamPure,
                lembur_rate: empLemburJumlahPure > 0 && empLemburJamPure > 0 ? empLemburJumlahPure / empLemburJamPure : 0,
                lembur_jumlah: empLemburJumlahPure,
                lembur_records: (empLemburDetails.records || []).map((r: any) => ({
                    ...r,
                    trx_date: r.date || r.trx_date || "", // Map date to trx_date, handle both just in case
                    meta: r.meta
                })),
                // Harvest / Bunches data (only for harvest gangs ending with "H")
                ...(harvesterService.isHarvestGang(emp.gang_code) ? {
                    bunches_total: bunchesBatch.get(emp.emp_code)?.total_bunches || 0,
                    bunches_ripe: bunchesBatch.get(emp.emp_code)?.bunches_ripe || 0,
                    bunches_unripe: bunchesBatch.get(emp.emp_code)?.bunches_unripe || 0,
                    bunches_underripe: bunchesBatch.get(emp.emp_code)?.bunches_underripe || 0,
                    bunches_overripe: bunchesBatch.get(emp.emp_code)?.bunches_overripe || 0,
                    bunches_rotten: bunchesBatch.get(emp.emp_code)?.bunches_rotten || 0,
                    bunches_abnormal: bunchesBatch.get(emp.emp_code)?.bunches_abnormal || 0,
                    loose_fruit: bunchesBatch.get(emp.emp_code)?.loose_fruit || 0,
                    bunches_transactions: bunchesBatch.get(emp.emp_code)?.bunches_transactions || 0,
                } : {}),
                total_tunjangan,
                // [PHASE 2.5] Brondol dual source breakdown
                // Keep premi_brondol for backward compatibility (combined total)
                premi_brondol: empBrondol,
                premi_brondol_loosefruit: empBrondolLoosefruit,
                premi_brondol_adtrans: empBrondolAdtrans,
                premi_brondol_total: empBrondolTotal,
                upah_pokok,
                total_premi,
                // [FIX] Add upah_kotor separately - base gross without koreksi for correct tax/export
                // Formula: upah_kotor = gaji_pokok_aktual + total_tunjangan + total_premi
                upah_kotor,
                jumlah_upah_kotor,
                upah_kotor_pajak,
                pot_astek_majikan,
                pot_astek_jumlah,
                pot_bpjs_kesehatan_pekerja,
                pot_bpjs_kesehatan_majikan,
                pot_bpjs_kesehatan_jumlah,
                pot_bpjs_pensiun_pekerja,
                pot_bpjs_pensiun_majikan,
                pot_bpjs_pensiun_jumlah,
                gaji_pokok_ideal,
                gaji_pokok_aktual,
                koreksi_hk,
                hk_warning: koreksi_hk < 0 ? 'kurang_jam' : (koreksi_hk > 0 ? 'salah_scan' : undefined),
                pot_spsi,
                pot_pph21,
                // [ALIAS] Ensure PPH21 and SPSI are available as keys expected by AggregationService/Frontend
                pph21: pot_pph21,
                spsi: pot_spsi,
                pot_koreksi,
                premi_koreksi: pot_koreksi,
                potongan_upah_kotor_total: pot_koreksi,
                potongan_upah_kotor_details: {
                    koreksi: pot_koreksi,
                    ...koreksiVariations,
                    total: pot_koreksi
                },
                // [FROM PayrollCalculator] Tax-related fields
                gaji_pokok_bulanan: caruman.gajiStandar,
                astek_084: caruman.astek_majikan_jkk_jkm,
                bpjs_kesehatan_majikan_4_pct: caruman.bpjs_kes_majikan,
                penghasilan_bruto,
                tarif_pajak_ter,
                pph21_ter,
                // [FROM PayrollCalculator] total_potongan = astek + bpjs_kes + bpjs_pensiun + spsi + pph21
                total_potongan,
                total_potongan_bersih,
                // [NEW] premi_pph is separate field for display with + sign
                premi_pph: pot_premi_pph,
                taxable_pendapatan_lainnya: calc.taxable_pendapatan_lainnya,
                // Individual taxable breakdown for display
                taxable_pendapatan_thr,
                taxable_pendapatan_bonus,
                taxable_pendapatan_custom,
                upah_bersih,
                // Other Incomes for display (THR, Bonus, Custom, etc.)
                other_incomes: empOtherIncomes,
                // [NEW] Pre-computed income fields for gang_total aggregation
                pendapatan_thr: getOiByType('THR'),
                pendapatan_bonus: getOiByType('BONUS'),
                pendapatan_custom: getOiByType('CUSTOM'),
                // [DYNAMIC] Add pendapatan_{type} for each custom income type
                ...Object.fromEntries(
                    Object.entries(customTypeAmounts).map(([type, amount]) => [
                        `pendapatan_${type.toLowerCase()}`, amount
                    ])
                ),
                pendapatan_lainnya: pendapatan_lainnya_amount,
                total_pendapatan_lainnya: pendapatan_lainnya_amount, // Same as pendapatan_lainnya for display
                // REMOVED: pot_pendapatan_lainnya - sudah masuk PayrollCalculator via pendapatan_lainnya
                // Jika di-output lagi di sini, maka akan double-count di upstream services (reportService, dll)
                // REMOVED: premi: empPremi - causes double-counting in frontend
                // Individual premi fields are already added via ...empPremi below
                pot_astek: pot_astek_pekerja,
                pot_astek_pekerja: pot_astek_pekerja,
                pot_astek_maj: pot_astek_majikan,
                pot_bpjs_pekerja_total: pot_bpjs_kesehatan_pekerja + pot_bpjs_pensiun_pekerja,
                // Add individual koreksi variations as separate fields
                ...koreksiVariations,
                // Add dynamic potongan fields (POTONGAN X, etc.) excluding static fields and PREMI_PPH
                // PREMI_PPH is explicitly excluded to prevent it from being
                // misinterpreted as a generic deduction or premium in export functions.
                // It is already handled as the `premi_pph` field above.
                ...Object.fromEntries(
                    Object.entries(empPotongan).filter(([key]) =>
                        key !== "SPSI" &&
                        key !== "PPH21" &&
                        !String(key).toUpperCase().startsWith("KOREKSI") &&
                        key !== "PREMI_PPH"
                    )
                ),
                ...empPremi,
                // [RESTORED] premi object for aggregation seeder compatibility
                premi: empPremi,
                premi_details: premiDetails[emp.emp_code] || [],
                value_sync_frame: valueSyncFrame,
                value_source_compare: valueSourceCompare
            };
            attachManualAdjustmentMetadata(row, empAdjustments);

            dataRows.push(row);
        }
        debug(CATEGORY, `Phase 3 - Row processing (${employees.length} employees): ${(performance.now() - startRowProcessing).toFixed(0)}ms`);

        const totalMs = Date.now() - startTime;
        const result = {
            data_rows: dataRows,
            dynamic_premi_headers: Array.from(dynamicPremiSet),
            dynamic_potongan_headers: Array.from(dynamicPotonganSet),
            premi_title_map: premiTitleMap,
            potongan_title_map: potonganTitleMap,
            meta: {
                execution_time_ms: totalMs,
                row_count: dataRows.length,
                cached: false
            }
        };

        // [OPTIMIZATION] Cache results for all periods
        // TTL: 1 hour for historical, 60 seconds for current period
        if (useCache && dataRows.length > 0) {
            const ttl = cacheService.getPayrollCacheTtl(month, year, currentMonth, currentYear);
            cacheService.set(cacheKey, result, ttl);
            debug(CATEGORY, `💾 [CACHE SAVE] ${cacheKey} — cached ${dataRows.length} rows (TTL: ${ttl}s)`);
        }

        debug(CATEGORY, `TOTAL: ${totalMs}ms for ${gangCode}/${month}/${year} (${dataRows.length} rows)`);

        return result;
    }

    /**
     * Fallback method to fetch employees from live tables when historical data doesn't exist
     */
    private async getEmployeesFallbackLive(gangCondition: string, serverProfile?: string): Promise<EmployeeRow[]> {
        console.log('[DataExtractor] Using fallback live table query for employees...');
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        
        try {
            const rows = await db.query<any>(`
                SELECT 
                    emp_code, actual_nik, emp_name, gender, loc_code, 
                    gang_code, gang_desc, pay_rate, beras_rate, 
                    join_date, res_address, alamat, hr_emp_type
                FROM (
                    SELECT 
                        RTRIM(e.EmpCode) as emp_code,
                        ISNULL(NULLIF(RTRIM(e.NewICNo), ''), RTRIM(e.EmpCode)) as actual_nik,
                        e.EmpName as emp_name,
                        e.Gender as gender,
                        RTRIM(e.LocCode) as loc_code,
                        RTRIM(gl.GangCode) as gang_code,
                        RTRIM(g.Description) as gang_desc,
                        COALESCE(p.PayRate, 0) as pay_rate,
                        CASE
                            WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                            ELSE COALESCE(p.RiceRation, 0)
                        END as beras_rate,
                        em.AppJoinGrpDate as join_date,
                        e.ResAddress as res_address,
                        e.ResAddress as alamat,
                        e.HREmpType as hr_emp_type,
                        ROW_NUMBER() OVER(PARTITION BY e.EmpCode ORDER BY e.EmpCode DESC) as rn -- Basic dedup
                    FROM HR_EMPLOYEE e
                    INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_GANG g ON gl.GangCode = g.GangCode
                    LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                    WHERE ${gangCondition}
                ) t
                WHERE rn = 1
                ORDER BY emp_code
            `);
            
            console.log(`[DataExtractor] Fallback query returned ${rows.length} employees`);
            return rows;
        } catch (error: any) {
            console.error(`[DataExtractor] Fallback employee query failed: ${error.message}`);
            throw new Error(`Failed to fetch employee data (both historical and live): ${error.message}`);
        }
    }

    public async getEmployees(gangCondition: string, month: number, year: number, serverProfile?: string, isHistorical: boolean = false, gangCodeInput: string | null = null): Promise<EmployeeRow[]> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        console.log(`[DataExtractor.getEmployees] isHistorical=${isHistorical}, gangCondition=${gangCondition}`);


        let rows: any[];

        if (isHistorical) {
            // For historical data, use PR_GANGLN_ARC with AccMonth/AccYear filtering
            let accMonth: number;
            let accYear: number;

            const { accMonth: calculatedAccMonth, accYear: calculatedAccYear } = currentPeriodService.calendarToAccMonth(month, year);
            accMonth = calculatedAccMonth;
            accYear = calculatedAccYear;



            // For historical path: g = PR_GANG (has GangID, Description, no GangCode)
            // Override gangCondition if gangCodeInput is provided
            let historicalCondition = gangCondition;
            if (gangCodeInput && gangCodeInput !== 'ALL') {
                historicalCondition = `(UPPER(RTRIM(g.GangID)) = '${gangCodeInput}' OR UPPER(RTRIM(g.Description)) = '${gangCodeInput}')`;
            } else {
                // Historical tables (PR_GANG) use GangID, and PR_GANGLN doesn't have GangCode column
                historicalCondition = gangCondition.replace(/(gl|g)\.GangCode/ig, 'g.GangID');
            }

            // PR_GANGLN_ARC uses EmpCode column and MasterID to join with PR_GANG
            try {
                // Strict historical query with LEFT JOIN and COALESCE fallback
                rows = await db.query<any>(`
                    SELECT 
                        emp_code, actual_nik, emp_name, gender, loc_code, 
                        gang_code, gang_desc, pay_rate, beras_rate, 
                        join_date, res_address, alamat, hr_emp_type
                    FROM (
                        SELECT 
                            RTRIM(e.EmpCode) as emp_code,
                            e.NewICNo as actual_nik,
                            e.EmpName as emp_name,
                            e.Gender as gender,
                            RTRIM(e.LocCode) as loc_code,
                            COALESCE(RTRIM(g.GangID), RTRIM(g.Description), CAST(gl.MasterID AS VARCHAR)) as gang_code,
                            COALESCE(RTRIM(g.Description), CAST(gl.MasterID AS VARCHAR)) as gang_desc,
                            COALESCE(p.PayRate, 0) as pay_rate,
                            CASE
                                WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                                ELSE COALESCE(p.RiceRation, 0)
                            END as beras_rate,
                            em.AppJoinGrpDate as join_date,
                            e.ResAddress as res_address,
                            e.ResAddress as alamat,
                            e.HREmpType as hr_emp_type,
                            ROW_NUMBER() OVER(PARTITION BY e.EmpCode ORDER BY e.EmpCode DESC) as rn
                        FROM HR_EMPLOYEE e
                        INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode)
                            AND gl.AccMonth = ?
                            AND gl.AccYear = ?
                        LEFT JOIN PR_GANG g ON g.ID = gl.MasterID
                        LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                        LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                        WHERE ${historicalCondition}
                    ) t
                    WHERE rn = 1
                    ORDER BY emp_code
                `, [accMonth, accYear]);

                console.log(`[DataExtractor] Historical query for ${accMonth}/${accYear} returned ${rows.length} rows`);
                
                // [FALLBACK] Try relaxed historical search if strict month/year search yields 0 rows
                if (rows.length === 0) {
                    console.log(`[DataExtractor] Strict historical query returned no data. Attempting relaxed historical query...`);
                    rows = await db.query<any>(`
                        SELECT 
                            emp_code, actual_nik, emp_name, gender, loc_code, 
                            gang_code, gang_desc, pay_rate, beras_rate, 
                            join_date, res_address, hr_emp_type
                        FROM (
                            SELECT 
                                RTRIM(e.EmpCode) as emp_code,
                                e.NewICNo as actual_nik,
                                e.EmpName as emp_name,
                                e.Gender as gender,
                                RTRIM(e.LocCode) as loc_code,
                                COALESCE(RTRIM(g.GangID), RTRIM(g.Description), CAST(gl.MasterID AS VARCHAR)) as gang_code,
                                COALESCE(RTRIM(g.Description), CAST(gl.MasterID AS VARCHAR)) as gang_desc,
                                COALESCE(p.PayRate, 0) as pay_rate,
                                CASE
                                    WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                                    ELSE COALESCE(p.RiceRation, 0)
                                END as beras_rate,
                                em.AppJoinGrpDate as join_date,
                                e.ResAddress as res_address,
                                e.HREmpType as hr_emp_type,
                                ROW_NUMBER() OVER(PARTITION BY e.EmpCode ORDER BY gl.AccYear DESC, gl.AccMonth DESC) as rn
                            FROM HR_EMPLOYEE e
                            INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode)
                            LEFT JOIN PR_GANG g ON g.ID = gl.MasterID
                            LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                            LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                            WHERE ${historicalCondition}
                        ) t
                        WHERE rn = 1
                        ORDER BY emp_code
                    `);
                    console.log(`[DataExtractor] Relaxed historical query returned ${rows.length} rows`);
                }

                // [FALLBACK] If historical query still returns no data, fallback to live tables
                if (rows.length === 0) {
                    console.log(`[DataExtractor] Historical query returned no data. Falling back to live tables for ${month}/${year}...`);
                    return await this.getEmployeesFallbackLive(gangCondition, serverProfile);
                }
            } catch (error: any) {
                console.warn(`[DataExtractor] Historical employee query failed: ${error.message}. Falling back to live tables...`);
                // [FALLBACK] On error, fallback to live tables
                return await this.getEmployeesFallbackLive(gangCondition, serverProfile);
            }
        } else {
            // For current/future data, use HR_GANGLN (current active data)
             try {
                rows = await db.query<any>(`
                    SELECT 
                        RTRIM(e.EmpCode) as emp_code,
                        ISNULL(NULLIF(RTRIM(e.NewICNo), ''), RTRIM(e.EmpCode)) as actual_nik,
                        e.EmpName as emp_name,
                        e.Gender as gender,
                        RTRIM(e.LocCode) as loc_code,
                        RTRIM(gl.GangCode) as gang_code,
                        RTRIM(g.Description) as gang_desc,
                        COALESCE(p.PayRate, 0) as pay_rate,
                        CASE
                            WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                            ELSE COALESCE(p.RiceRation, 0)
                        END as beras_rate,
                        em.AppJoinGrpDate as join_date,
                        e.ResAddress as res_address,
                        e.HREmpType as hr_emp_type
                    FROM HR_EMPLOYEE e
                    INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_GANG g ON gl.GangCode = g.GangCode
                    LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                    WHERE ${gangCondition}
                    ORDER BY emp_code
                `);

                console.log(`[DataExtractor] Live active query returned ${rows.length} rows`);
            } catch (error: any) {
                console.error(`[DataExtractor] Current employee query failed: ${error.message}`);
                throw new Error(`Failed to fetch employee data: ${error.message}`);
            }

            // [FALLBACK] If no data in base table (HR_GANGLN) for current period,
            // try ARC table (PR_GANGLN_ARC) as fallback - data may have been archived
            // This happens when a gang like PERCOBAAN is deleted from live but we are requesting a month
            // that is still technically 'current' according to the server flags.
            if (rows && rows.length === 0) {
                console.log(`[DataExtractor] Live query returned 0 rows. Attempting ARC fallback for ${month}/${year}...`);
                const { accMonth: fallbackAccMonth, accYear: fallbackAccYear } = currentPeriodService.calendarToAccMonth(month, year);

                // Build ARC-compatible gang condition (PR_GANG uses GangID/Description, not GangCode)
                let arcCondition = gangCondition;
                if (gangCodeInput && gangCodeInput !== 'ALL') {
                    arcCondition = `(UPPER(RTRIM(g.GangID)) = '${gangCodeInput}' OR UPPER(RTRIM(g.Description)) = '${gangCodeInput}')`;
                }

                try {
                    rows = await db.query<any>(`
                        SELECT DISTINCT
                            RTRIM(e.EmpCode) as emp_code,
                            e.NewICNo as actual_nik,
                            e.EmpName as emp_name,
                            e.Gender as gender,
                            RTRIM(e.LocCode) as loc_code,
                            COALESCE(RTRIM(g.GangID), RTRIM(g.Description)) as gang_code,
                            RTRIM(g.Description) as gang_desc,
                            COALESCE(p.PayRate, 0) as pay_rate,
                            CASE 
                                WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                                ELSE COALESCE(p.RiceRation, 0)
                            END as beras_rate,
                            em.AppJoinGrpDate as join_date,
                            e.ResAddress as res_address,
                            e.HREmpType as hr_emp_type
                        FROM HR_EMPLOYEE e
                        INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode)
                            AND gl.AccMonth = ?
                            AND gl.AccYear = ?
                        INNER JOIN PR_GANG g ON g.ID = gl.MasterID
                        LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                        LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                        WHERE ${arcCondition}
                        ORDER BY emp_code
                    `, [fallbackAccMonth, fallbackAccYear]);

                    if (rows.length === 0) {
                        console.log(`[DataExtractor] Strict ARC Fallback: no data found for ${month}/${year}. Attempting relaxed fallback...`);
                        rows = await db.query<any>(`
                            SELECT 
                                emp_code, actual_nik, emp_name, gender, loc_code, 
                                gang_code, gang_desc, pay_rate, beras_rate, 
                                join_date, res_address, hr_emp_type
                            FROM (
                                SELECT 
                                    RTRIM(e.EmpCode) as emp_code,
                                    e.NewICNo as actual_nik,
                                    e.EmpName as emp_name,
                                    e.Gender as gender,
                                    RTRIM(e.LocCode) as loc_code,
                                    COALESCE(RTRIM(g.GangID), RTRIM(g.Description)) as gang_code,
                                    RTRIM(g.Description) as gang_desc,
                                    COALESCE(p.PayRate, 0) as pay_rate,
                                    CASE 
                                        WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                                        ELSE COALESCE(p.RiceRation, 0)
                                    END as beras_rate,
                                    em.AppJoinGrpDate as join_date,
                                    e.ResAddress as res_address,
                                    e.HREmpType as hr_emp_type,
                                    ROW_NUMBER() OVER(PARTITION BY e.EmpCode ORDER BY gl.AccYear DESC, gl.AccMonth DESC) as rn
                                FROM HR_EMPLOYEE e
                                INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode)
                                INNER JOIN PR_GANG g ON g.ID = gl.MasterID
                                LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                                WHERE ${arcCondition}
                            ) t
                            WHERE rn = 1
                            ORDER BY emp_code
                        `);
                        console.log(`[DataExtractor] Relaxed ARC Fallback retrieved ${rows.length} rows`);
                    } else {
                        console.log(`[DataExtractor] Strict ARC Fallback retrieved ${rows.length} rows`);
                    }
                } catch (error: any) {
                    console.error(`[DataExtractor] ARC Fallback employee query failed: ${error.message}`);
                }
            }
            
            // [DE-DUPLICATION] Latest Wins logic for append-insert handling
            const employeeMap = new Map<string, any>();
            if (rows && rows.length > 0) {
                for (const r of rows) {
                    const key = r.emp_code;
                    if (key) {
                        // The last one in the database result set wins
                        employeeMap.set(key, r);
                    }
                }
            }
            // Overwrite rows with de-duplicated rows
            rows = Array.from(employeeMap.values());
            console.log(`[DataExtractor] De-duplicated results to ${rows.length} unique employees`);
        }

        // Fetch HR data overrides (e.g. NIK KTP)
        const empCodes = rows.map((r: any) => r.emp_code?.trim()).filter(Boolean);
        const hrDataMap = await employeeHrDataService.getHrDataBulk(empCodes);

        return rows.map((r: any) => {
            const rawGangCode = r.gang_code?.trim() || "";
            const rawLocCode = r.loc_code?.trim() || "";
            const rawDesc = r.gang_desc?.trim() || "";
            
            // Resolve display LocCode (checks for virtual divisions like NRS, INF, etc.)
            const resolvedLocCode = divisionDefinition.getVirtualDivisionForGang(rawGangCode, rawLocCode, rawDesc) || rawLocCode;

            const empCodeClean = r.emp_code?.trim().toUpperCase() || "";
            const hrOverride = hrDataMap.get(empCodeClean);

            // If there's an override for NIK, use it. Otherwise use NewICNo, otherwise use EmpCode
            const finalNik = hrOverride?.nik_ktp?.trim() || r.actual_nik?.trim() || r.emp_code?.trim() || "";
            const finalNpwp = hrOverride?.npwp?.trim() || "";

            return {
                emp_code: r.emp_code?.trim() || "",
                actual_nik: finalNik,
                pajak_npwp: finalNpwp,
                emp_name: r.emp_name?.trim() || "",
                gender: String(r.gender || "1"),
                loc_code: resolvedLocCode,
                gang_code: rawGangCode, // Return exact fetched code
                pay_rate: r.pay_rate || 0,
                beras_rate: r.beras_rate || 0,
                join_date: r.join_date || null,
                res_address: r.res_address?.trim() || "",
                hr_emp_type: r.hr_emp_type?.trim() || "",
                jabatan: "" // Jabatan will be resolved from employee_estate/positionHistory later
            };
        });
    }

    // ============================================================
    // [OPTIMIZATION] Consolidated: 3 queries → 1 query
    // Combines: attendance summary + shortage details + excess details
    // All in a single UNION ALL, processed in-memory
    // ============================================================
    private async getAttendance(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<Record<string, {
        hk: number;
        total_hours: number;
        shortage_count: number;
        total_amount_rp: number;
        shortage_details: Array<{ date: string; day_name: string; actual_hours: number; target_hours: number; shortage_hours: number }>;
        shortage_total_hours: number;
        excess_details: Array<{ date: string; day_name: string; actual_hours: number; target_hours: number; excess_hours: number }>;
        excess_total_hours: number;
    }>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");
        const leaveSql = buildLeaveSqlExpressions("trl", "h");

        // [OPTIMIZATION] Single query: summary + shortage details + excess details
        // Uses a derived table with row_type to distinguish aggregation vs detail rows
        // Row_type: 'A' = summary aggregation, 'S' = shortage detail, 'E' = excess detail
        const rows = await db.query<{
            emp_code: string;
            row_type: string;
            hk: number;
            total_hours: number;
            shortage_count: number;
            total_amount_rp: number;
            detail_date: string | null;
            detail_day_name: string | null;
            detail_hours: number;
            detail_target: number;
        }>(`
            SELECT
                emp_code,
                row_type,
                MAX(hk) as hk,
                MAX(total_hours) as total_hours,
                MAX(shortage_count) as shortage_count,
                MAX(total_amount_rp) as total_amount_rp,
                MAX(detail_date) as detail_date,
                MAX(detail_day_name) as detail_day_name,
                MAX(detail_hours) as detail_hours,
                MAX(detail_target) as detail_target
            FROM (
                -- LIVE: Summary aggregation
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'A' as row_type,
                    COUNT(DISTINCT trl.TrxDate) as hk,
                    SUM(trl.Hours) as total_hours,
                    SUM(CASE
                        WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat')
                            THEN CASE WHEN trl.Hours < 5 AND trl.Hours > 0 THEN 1 ELSE 0 END
                        ELSE CASE WHEN trl.Hours < 7 AND trl.Hours > 0 THEN 1 ELSE 0 END
                    END) as shortage_count,
                    SUM(trl.Amount) as total_amount_rp,
                    NULL as detail_date, NULL as detail_day_name, NULL as detail_hours, NULL as detail_target
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode)

                UNION ALL

                -- ARC: Summary aggregation
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'A' as row_type,
                    COUNT(DISTINCT trl.TrxDate) as hk,
                    SUM(trl.Hours) as total_hours,
                    SUM(CASE
                        WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat')
                            THEN CASE WHEN trl.Hours < 5 AND trl.Hours > 0 THEN 1 ELSE 0 END
                        ELSE CASE WHEN trl.Hours < 7 AND trl.Hours > 0 THEN 1 ELSE 0 END
                    END) as shortage_count,
                    SUM(trl.Amount) as total_amount_rp,
                    NULL as detail_date, NULL as detail_day_name, NULL as detail_hours, NULL as detail_target
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode)

                UNION ALL

                -- LIVE: Shortage detail rows
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'S' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) < CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
                   AND SUM(trl.Hours) > 0

                UNION ALL

                -- ARC: Shortage detail rows
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'S' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) < CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
                   AND SUM(trl.Hours) > 0

                UNION ALL

                -- LIVE: Excess detail rows
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'E' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) > CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END

                UNION ALL

                -- ARC: Excess detail rows
                SELECT
                    RTRIM(trl.EmpCode) as emp_code,
                    'E' as row_type,
                    0 as hk, 0 as total_hours, 0 as shortage_count, 0 as total_amount_rp,
                    CONVERT(varchar, trl.TrxDate, 23) as detail_date,
                    DATENAME(weekday, trl.TrxDate) as detail_day_name,
                    SUM(trl.Hours) as detail_hours,
                    CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END as detail_target
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                GROUP BY RTRIM(trl.EmpCode), trl.TrxDate
                HAVING SUM(trl.Hours) > CASE WHEN DATENAME(weekday, trl.TrxDate) IN ('Friday', 'Jumat') THEN 5 ELSE 7 END
            ) combined
            GROUP BY emp_code, row_type
        `, [startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate]);

        // Build result map
        const result: Record<string, {
            hk: number;
            total_hours: number;
            shortage_count: number;
            total_amount_rp: number;
            shortage_details: Array<{ date: string; day_name: string; actual_hours: number; target_hours: number; shortage_hours: number }>;
            shortage_total_hours: number;
            excess_details: Array<{ date: string; day_name: string; actual_hours: number; target_hours: number; excess_hours: number }>;
            excess_total_hours: number;
        }> = {};

        for (const r of rows) {
            const empCode = r.emp_code?.trim() || "";
            if (!result[empCode]) {
                result[empCode] = {
                    hk: 0, total_hours: 0, shortage_count: 0, total_amount_rp: 0,
                    shortage_details: [], shortage_total_hours: 0,
                    excess_details: [], excess_total_hours: 0
                };
            }

            if (r.row_type === 'A') {
                result[empCode].hk += r.hk || 0;
                result[empCode].total_hours += r.total_hours || 0;
                result[empCode].shortage_count += r.shortage_count || 0;
                result[empCode].total_amount_rp += r.total_amount_rp || 0;
            } else if (r.row_type === 'S') {
                if (r.detail_date && result[empCode]) {
                    const shortage_hours = (r.detail_target || 0) - (r.detail_hours || 0);
                    result[empCode].shortage_details.push({
                        date: r.detail_date,
                        day_name: r.detail_day_name || "",
                        actual_hours: r.detail_hours || 0,
                        target_hours: r.detail_target || 0,
                        shortage_hours
                    });
                    result[empCode].shortage_total_hours += shortage_hours;
                }
            } else if (r.row_type === 'E') {
                if (r.detail_date && result[empCode]) {
                    const excess_hours = (r.detail_hours || 0) - (r.detail_target || 0);
                    result[empCode].excess_details.push({
                        date: r.detail_date,
                        day_name: r.detail_day_name || "",
                        actual_hours: r.detail_hours || 0,
                        target_hours: r.detail_target || 0,
                        excess_hours
                    });
                    result[empCode].excess_total_hours += excess_hours;
                }
            }
        }

        return result;
    }

    private async getCuti(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<Record<string, CutiData>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");
        const leaveSql = buildLeaveSqlExpressions("trl", "h");

        // ============================================================
        // [OPTIMIZATION] Consolidated: 3 queries → 1 query
        // All cuti types (task-based, minggu, nasional) in single round-trip
        // ============================================================
        const rows = await db.query<{ emp_code: string; cuti_tahunan: number; cuti_sakit_haid: number; cuti_minggu: number; cuti_nasional: number }>(`
            SELECT
                RTRIM(EmpCode) as emp_code,
                SUM(cuti_tahunan) as cuti_tahunan,
                SUM(cuti_sakit_haid) as cuti_sakit_haid,
                SUM(cuti_minggu) as cuti_minggu,
                SUM(cuti_nasional) as cuti_nasional
            FROM (
                -- LIVE table: all cuti types via conditional aggregation
                SELECT
                    trl.EmpCode,
                    ${leaveSql.cutiTahunan} as cuti_tahunan,
                    ${leaveSql.cutiSakitHaid} as cuti_sakit_haid,
                    ${leaveSql.cutiMinggu} as cuti_minggu,
                    ${leaveSql.cutiNasional} as cuti_nasional
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND ${leaveSql.whereClause}

                UNION ALL

                -- ARCHIVE table: same conditional aggregation
                SELECT
                    trl.EmpCode,
                    ${leaveSql.cutiTahunan} as cuti_tahunan,
                    ${leaveSql.cutiSakitHaid} as cuti_sakit_haid,
                    ${leaveSql.cutiMinggu} as cuti_minggu,
                    ${leaveSql.cutiNasional} as cuti_nasional
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND ${leaveSql.whereClause}
            ) combined
            GROUP BY RTRIM(EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        // Initialize result with all employees (0 values for those with no cuti)
        const result: Record<string, CutiData> = {};
        for (const emp of empCodes) {
            result[emp] = { cuti_tahunan: 0, cuti_sakit_haid: 0, cuti_minggu: 0, cuti_nasional: 0 };
        }
        // Fill in actual values from query
        for (const r of rows) {
            const emp = r.emp_code?.trim() || "";
            if (result[emp]) {
                result[emp].cuti_tahunan = r.cuti_tahunan || 0;
                result[emp].cuti_sakit_haid = r.cuti_sakit_haid || 0;
                result[emp].cuti_minggu = r.cuti_minggu || 0;
                result[emp].cuti_nasional = r.cuti_nasional || 0;
            }
        }

        return result;
    }

    // [PREMI] Uses DocDesc containing 'PREMI' as column header title
    // [RULE] Exclude premi containing 'PPH' - those should go to potongan instead
    private async getPremi(empCodes: string[], startDate: string, endDate: string, isHistorical: boolean = false, serverProfile?: string): Promise<{ amounts: Record<string, Record<string, number>>; titleMap: Record<string, string>; details: Record<string, any[]> }> {
        if (!empCodes.length) return { amounts: {}, titleMap: {}, details: {} };
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        const premiCondition = ADTRANS_DYNAMIC_PREMI_PATTERNS
            .map((pattern) => `UPPER(t.DocDesc) LIKE '${pattern}'`)
            .join(" OR ");

        // [CRITICAL] INNER JOIN HR_GANGLN ensures only valid gang members from HR_GANGLN are processed
        // This prevents orphaned adtrans records for employees not in the current gang
        let rows = await db.query<{ emp_code: string; doc_desc: string; amount: number; task_code: string; task_desc: string }>(`
            SELECT RTRIM(t.EmpCode) as emp_code, t.DocDesc as doc_desc, SUM(ln.Amount) as amount, ln.TaskCode as task_code, mt.TaskDesc as task_desc
            FROM (
                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS t
                INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?

                UNION ALL

                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS_ARC t
                INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
            ) t
            JOIN (
                SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN
                UNION ALL
                SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN_ARC
            ) ln ON t.ID = ln.MasterID
            LEFT JOIN PR_TASKCODE mt ON ln.TaskCode = mt.TaskCode
            WHERE ${isHistorical ? `(
                  (${premiCondition})
                  AND UPPER(t.DocDesc) NOT LIKE '%PPH%'
                  AND UPPER(t.DocDesc) NOT LIKE '%JABATAN%'
                  AND UPPER(t.DocDesc) NOT LIKE '%BERAS%'
                  AND UPPER(t.DocDesc) NOT LIKE '%LEMBUR%'
                  AND UPPER(t.DocDesc) NOT LIKE '%MASA%'
                  AND UPPER(t.DocDesc) NOT LIKE '%POTONGAN%'
                  AND UPPER(t.DocDesc) NOT LIKE '%KOREKSI%'
                  AND UPPER(t.DocDesc) NOT LIKE '%SPSI%'
                  AND (mt.TaskDesc IS NULL OR mt.TaskDesc <> 'ACCRUALS-CHECKROLL')
              )` : `(
                  (
                      (UPPER(mt.TaskDesc) LIKE '%(AL)%' AND UPPER(mt.TaskDesc) LIKE '%TUNJANGAN%') OR
                      (${premiCondition})
                  )
                  AND (mt.TaskDesc IS NULL OR UPPER(mt.TaskDesc) NOT LIKE '%MASA%')
                  AND (mt.TaskDesc IS NULL OR UPPER(mt.TaskDesc) NOT LIKE '%LEMBUR%')
                  AND (mt.TaskDesc IS NULL OR UPPER(mt.TaskDesc) NOT LIKE '%JABATAN%')
                  AND (mt.TaskDesc IS NULL OR UPPER(mt.TaskDesc) NOT LIKE '%BERAS%')
                  AND UPPER(t.DocDesc) NOT LIKE '%PPH%'
                  AND UPPER(t.DocDesc) NOT LIKE '%JABATAN%'
                  AND UPPER(t.DocDesc) NOT LIKE '%BERAS%'
                  AND UPPER(t.DocDesc) NOT LIKE '%LEMBUR%'
                  AND UPPER(t.DocDesc) NOT LIKE '%MASA%'
                  AND UPPER(t.DocDesc) NOT LIKE '%POTONGAN%'
                  AND UPPER(t.DocDesc) NOT LIKE '%KOREKSI%'
                  AND UPPER(t.DocDesc) NOT LIKE '%SPSI%'
                  AND (mt.TaskDesc IS NULL OR mt.TaskDesc <> 'ACCRUALS-CHECKROLL')
              )`}
              AND ln.Amount > 0
            GROUP BY RTRIM(t.EmpCode), t.DocDesc, ln.TaskCode, mt.TaskDesc
        `, [startDate, endDate, startDate, endDate]);

        const amounts: Record<string, Record<string, number>> = {};
        const titleMap: Record<string, string> = {}; // key (normalized) -> DocDesc (original)
        const details: Record<string, any[]> = {}; // emp_code -> list of detail objects

        for (const r of rows) {
            const emp = r.emp_code?.trim() || "";
            if (!amounts[emp]) amounts[emp] = {};
            if (!details[emp]) details[emp] = [];
            const key = this.normalizePremiName(r.doc_desc || "");
            amounts[emp][key] = (amounts[emp][key] || 0) + (r.amount || 0);

            details[emp].push({
                doc_desc: r.doc_desc?.trim(),
                task_code: r.task_code?.trim(),
                task_desc: r.task_desc?.trim(),
                amount: r.amount,
                normalized_key: key
            });

            // [MODIFIED] Use DocDesc (TaskCode) as title for PREMI as requested
            // so it displays on two lines
            if (!titleMap[key]) {
                const taskCode = r.task_code?.trim();
                const docDesc = r.doc_desc?.trim() || key;
                titleMap[key] = taskCode ? `${docDesc}\n(${taskCode})` : docDesc;
            }
        }

        return { amounts, titleMap, details };
    }

    // ============================================================
    // [OPTIMIZATION] Consolidated: 2 queries → 1 UNION ALL query
    // Combines: main potongan rows + PREMI_PPH (ACCRUALS-CHECKROLL) rows
    // ============================================================
    private async getPotongan(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<{ amounts: Record<string, Record<string, number>>; titleMap: Record<string, string> }> {
        if (!empCodes.length) return { amounts: {}, titleMap: {} };
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        // [OPTIMIZATION] Single query: main potongan + PREMI_PPH (ACCRUALS-CHECKROLL) combined
        // row_type: 'P' = regular potongan, 'X' = PREMI_PPH
        // [CRITICAL] INNER JOIN HR_GANGLN ensures only valid gang members from HR_GANGLN are processed
        let rows = await db.query<{ emp_code: string; doc_desc: string; task_code: string | null; task_desc: string | null; amount: number; row_type: string }>(`
            SELECT
                RTRIM(t.EmpCode) as emp_code,
                t.DocDesc as doc_desc,
                ln.TaskCode as task_code,
                mt.TaskDesc as task_desc,
                SUM(COALESCE(ln.Amount, 0)) as amount,
                CASE WHEN mt.TaskDesc = 'ACCRUALS-CHECKROLL' THEN 'X' ELSE 'P' END as row_type
            FROM (
                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS t
                INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?

                UNION ALL

                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS_ARC t
                INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
            ) t
            JOIN (
                SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN
                UNION ALL
                SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN_ARC
            ) ln ON t.ID = ln.MasterID
            LEFT JOIN PR_TASKCODE mt ON ln.TaskCode = mt.TaskCode
            WHERE (
                -- Main potongan conditions
                (
                    (UPPER(t.DocDesc) LIKE '%PPH%' AND UPPER(t.DocDesc) NOT LIKE '%PREMI%')
                    OR UPPER(t.DocDesc) LIKE '%POT%'
                    OR UPPER(t.DocDesc) LIKE '%BPJS%'
                    OR UPPER(t.DocDesc) LIKE '%PINJAM%'
                    OR UPPER(t.DocDesc) LIKE '%KL%'
                    OR UPPER(t.DocDesc) LIKE '%SPSI%'
                    OR UPPER(t.DocDesc) LIKE '%KOREKSI%'
                    OR UPPER(t.DocDesc) LIKE '%TOTAL%'
                    OR UPPER(t.DocDesc) LIKE '%KONTAN%'
                    OR UPPER(t.DocDesc) LIKE '%ALAT%'
                    OR UPPER(t.DocDesc) LIKE '%THR%'
                    OR UPPER(ln.TaskCode) LIKE '%DEPH21%'
                    OR UPPER(mt.TaskDesc) LIKE '%POTONGAN PPH21%'
                )
                -- PREMI_PPH (ACCRUALS-CHECKROLL) - also included
                OR mt.TaskDesc = 'ACCRUALS-CHECKROLL'
            )
            GROUP BY RTRIM(t.EmpCode), t.DocDesc, ln.TaskCode, mt.TaskDesc,
                CASE WHEN mt.TaskDesc = 'ACCRUALS-CHECKROLL' THEN 'X' ELSE 'P' END
        `, [startDate, endDate, startDate, endDate]);

        const amounts: Record<string, Record<string, number>> = {};
        const titleMap: Record<string, string> = {};

        for (const r of rows) {
            const emp = r.emp_code?.trim() || "";
            if (!amounts[emp]) amounts[emp] = {};

            let key: string;
            // Handle PREMI_PPH separately
            if (r.row_type === 'X') {
                key = "PREMI_PPH";
                if (!titleMap[key]) titleMap[key] = "PREMI PPH";
            } else {
                const { key: k, title } = this.normalizePotonganName(r.doc_desc || "", r.task_desc, r.task_code);
                key = k;
                if (!titleMap[key]) {
                    if (String(key).toUpperCase().startsWith('KOREKSI')) {
                        titleMap[key] = title;
                    } else {
                        const taskCode = r.task_code?.trim();
                        const taskDesc = r.task_desc?.trim();
                        // Show task_desc + task_code in header (similar to premi format)
                        if (taskDesc && taskCode) {
                            titleMap[key] = `${taskDesc}\n(${taskCode})`;
                        } else if (taskCode) {
                            titleMap[key] = taskCode;
                        } else {
                            titleMap[key] = title;
                        }
                    }
                }
            }

            amounts[emp][key] = (amounts[emp][key] || 0) + Math.abs(r.amount || 0);
        }

        return { amounts, titleMap };
    }

    private async getLemburDetailsFromCalculator(empCodes: string[], month: number, year: number, serverProfile?: string): Promise<Record<string, LemburData>> {
        const data = await lemburCalculator.calculateBatchData(empCodes, month, year, serverProfile);
        const result: Record<string, LemburData> = {};
        for (const k in data) {
            result[k] = {
                jam: data[k].total_hours || 0,
                jumlah: data[k].total_payment || 0
            };
        }
        return result;
    }

    private async getLemburDetailsWithTaskBreakdown(empCodes: string[], month: number, year: number, serverProfile?: string): Promise<Record<string, LemburDataWithDetails>> {
        const data = await lemburCalculator.calculateBatchDataWithTaskBreakdown(empCodes, month, year, serverProfile);
        const result: Record<string, LemburDataWithDetails> = {};
        for (const k in data) {
            // Use individual transaction records from lemburCalculator
            // This ensures total lembur = sum of all detail records (no double counting)
            const records = (data[k].records || []).map((rec) => ({
                trx_date: rec.date,
                task_code: rec.task_code,
                task_desc: rec.task_desc,
                day_type: rec.day_type,
                hours: rec.hours,
                rate: rec.rate,
                amount: rec.amount
            }));

            result[k] = {
                jam: data[k].total_hours || 0,
                jumlah: data[k].total_payment || 0,
                records: records
            };
        }
        return result;
    }

    private async getLemburDetails(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<Record<string, LemburData>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        let rows = await db.query<{ emp_code: string; total_hours: number; total_amount: number }>(`
            SELECT RTRIM(EmpCode) as emp_code, SUM(Hours) as total_hours, SUM(Amount) as total_amount
            FROM (
                SELECT trl.EmpCode, trl.Hours, trl.Amount
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate <= ?
                  AND trl.OT = 1

                UNION ALL

                SELECT trl.EmpCode, trl.Hours, trl.Amount
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate <= ?
                  AND trl.OT = 1
            ) combined
            GROUP BY RTRIM(EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, LemburData> = {};
        for (const r of rows) {
            result[r.emp_code?.trim() || ""] = {
                jam: r.total_hours || 0,
                jumlah: r.total_amount || 0
            };
        }
        return result;
    }

    /**
     * Get tunjangan (allowance) AMOUNT from PR_ADTRANSLN
     * 
     * NOTE: This returns MONEY amount, NOT jabatan role text.
     * - "JABATAN" → tunjangan jabatan (uang) from PR_ADTRANSLN.Amount where DocDesc LIKE '%JABATAN%'
     * - "MASA%KERJA" → tunjangan masa kerja (uang)
     * 
     * For jabatan ROLE TEXT (e.g. "Mandor", "Kerani"), see:
     *   - employee_estate.jabatan (extend_db_ptrj)
     *   - history_gang_member.jabatan (extend_db_ptrj)
     *   NOT from HR_GANGLN (that table only has gang membership, not jabatan role).
     */
    private async getTunjanganAmount(empCodes: string[], startDate: string, endDate: string, tunjanganType: string, serverProfile?: string): Promise<Record<string, number>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        let rows = await db.query<{ emp_code: string; total: number }>(`
            SELECT RTRIM(EmpCode) as emp_code, SUM(Amount) as total
            FROM (
                SELECT t.EmpCode, ln.Amount
                FROM PR_ADTRANS t
                JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%${tunjanganType}%'
                  AND ln.Amount > 0
                
                UNION ALL

                SELECT t.EmpCode, ln.Amount
                FROM PR_ADTRANS_ARC t
                JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                WHERE RTRIM(t.EmpCode) IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%${tunjanganType}%'
                  AND ln.Amount > 0
            ) combined
            GROUP BY RTRIM(EmpCode)
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, number> = {};
        for (const r of rows) {
            result[r.emp_code?.trim() || ""] = r.total || 0;
        }
        return result;
    }


    /**
     * Get additional lembur amount from DocDesc containing 'LEMBUR'
     * This is added on top of the standard lembur calculation from OT records
     */
    private async getLemburFromDocDesc(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<Record<string, number>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        // [OPTIMIZATION] Parallelize ARC + base table queries
        // Run both in parallel, then merge results (SUM aggregation handles duplicates)
        const [arcRows, baseRows] = await Promise.all([
            db.query<{ emp_code: string; total: number; doc_desc: string }>(`
                SELECT t.EmpCode as emp_code, SUM(ln.Amount) as total, t.DocDesc as doc_desc
                FROM PR_ADTRANS_ARC t
                JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                WHERE t.EmpCode IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%LEMBUR%'
                  AND ln.Amount > 0
                GROUP BY t.EmpCode, t.DocDesc
            `, [startDate, endDate]),
            db.query<{ emp_code: string; total: number; doc_desc: string }>(`
                SELECT t.EmpCode as emp_code, SUM(ln.Amount) as total, t.DocDesc as doc_desc
                FROM PR_ADTRANS t
                JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                WHERE t.EmpCode IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%LEMBUR%'
                  AND ln.Amount > 0
                GROUP BY t.EmpCode, t.DocDesc
            `, [startDate, endDate])
        ]);

        // Merge results: SUM by emp_code (duplicates from ARC+base are aggregated)
        const allRows = [...arcRows, ...baseRows];
        const result: Record<string, number> = {};
        for (const r of allRows) {
            const empCode = r.emp_code?.trim() || "";
            result[empCode] = (result[empCode] || 0) + (r.total || 0);
        }
        return result;
    }

    /**
     * Get additional beras amount from DocDesc containing 'BERAS'
     * This is added on top of the standard beras calculation (berasRate * HK)
     */
    private async getBerasFromDocDesc(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<Record<string, number>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        // [OPTIMIZATION] Parallelize ARC + base table queries
        // Run both in parallel, then merge results (SUM aggregation handles duplicates)
        const [arcRows, baseRows] = await Promise.all([
            db.query<{ emp_code: string; total: number; doc_desc: string }>(`
                SELECT t.EmpCode as emp_code, SUM(ln.Amount) as total, t.DocDesc as doc_desc
                FROM PR_ADTRANS_ARC t
                JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                WHERE t.EmpCode IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%BERAS%'
                  AND ln.Amount > 0
                GROUP BY t.EmpCode, t.DocDesc
            `, [startDate, endDate]),
            db.query<{ emp_code: string; total: number; doc_desc: string }>(`
                SELECT t.EmpCode as emp_code, SUM(ln.Amount) as total, t.DocDesc as doc_desc
                FROM PR_ADTRANS t
                JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                WHERE t.EmpCode IN (${empList})
                  AND t.DocDate >= ? AND t.DocDate < ?
                  AND UPPER(t.DocDesc) LIKE '%BERAS%'
                  AND ln.Amount > 0
                GROUP BY t.EmpCode, t.DocDesc
            `, [startDate, endDate])
        ]);

        // Merge results: SUM by emp_code (duplicates from ARC+base are aggregated)
        const allRows = [...arcRows, ...baseRows];
        const result: Record<string, number> = {};
        for (const r of allRows) {
            const empCode = r.emp_code?.trim() || "";
            result[empCode] = (result[empCode] || 0) + (r.total || 0);
        }
        return result;
    }

    // [OPTIMIZATION] Added currentYear param to avoid redundant getCurrentPeriod() call
    private async getUpahPokok(empCodes: string[], year: number, currentYear: number, serverProfile?: string): Promise<Record<string, number>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        // For historical years (before current year), we still query HR_CPTRX
        // to get the employee-specific rate, but if the queried rate is <= 134500 (current standard),
        // we'll override it with the historical standard rate for that year.
        const rows = await db.query<{ emp_code: string; upah_dasar: number }>(`
            WITH LatestCPTRX AS(
                SELECT EmpCode, NewRate, ROW_NUMBER() OVER(PARTITION BY EmpCode ORDER BY UpdateDate DESC) as rn
                FROM HR_CPTRX
            )
            SELECT RTRIM(e.EmpCode) as emp_code, COALESCE(lc.NewRate, 0) as upah_dasar
            FROM HR_EMPLOYEE e
            LEFT JOIN LatestCPTRX lc ON RTRIM(lc.EmpCode) = RTRIM(e.EmpCode) AND lc.rn = 1
            WHERE RTRIM(e.EmpCode) IN(${empList})
        `);

        const result: Record<string, number> = {};
        for (const r of rows) {
            let rate = r.upah_dasar || 0;

            // For historical years (before current year), override rate if it's the standard minimum
            // or less (e.g., 2026 standard is 134500) and replace it with historical year's standard rate.
            if (year < currentYear && rate <= 134500) {
                rate = Config.getUpahDasar(year);
            }

            result[r.emp_code?.trim() || ""] = rate;
        }
        return result;
    }

    private normalizePremiName(docDesc: string): string {
        return mapAdtransPremiField(docDesc);
    }

    private normalizePotonganName(docDesc: string, taskDesc?: string | null, taskCode?: string | null): { key: string; title: string } {
        const upper = docDesc.toUpperCase().trim();
        const upperTask = taskDesc ? taskDesc.toUpperCase().trim() : "";
        const upperCode = taskCode ? taskCode.toUpperCase().trim() : "";
        const cleanTitle = docDesc.trim();

        // [RULE 1] Handle KOREKSI variations separately
        // Pattern: KOREKSI, KOREKSI A, KOREKSI PANEN, KOREKSI X, etc.
        // Each variation becomes a separate key for display in POTONGAN UPAH KOTOR
        if (upper.includes("KOREKSI")) {
            return normalizeAdtransPotonganField(cleanTitle);
        }

        // [RULE 1.5] Specific for Potongan PPh21 matching TaskDesc or DocDesc
        // Pebrikiki untuk PPh21 (yang dipotong atau yang menjadi pengurang upah bersih) dengan taskDesc (DEPH21AB1) (DE) POTONGAN PPH21
        if (upperCode.includes("DEPH21") || upperTask.includes("POTONGAN PPH21") || upper.includes("POTONGAN PPH21") || (upper.includes("PPH21") && upper.includes("POTONGAN"))) {
            return { key: "PPH21", title: "Potongan PPh21" };
        }

        // [RULE 2] Static: PPH21 (PPH yang dipotong) - MUST CHECK BEFORE POTONGAN rule
        // Pattern: DocDesc mengandung "PPH" atau "PAJAK" TAPI tidak mengandung "PREMI"
        // Examples:
        //   - "PPH21" → PPH21 ✓
        //   - "POTONGAN PPH 21" → PPH21 ✓ (contains PPH, not PREMI)
        //   - "PREMI PPH 21" → PREMI_PPH_21 ✗ (contains PREMI)
        //   - "PREMI PPH" → PREMI_PPH ✗ (contains PREMI)
        if (upper.includes("PPH") || upper.includes("PAJAK")) {
            // EXCLUDE: If contains PREMI in DocDesc or TaskDesc, don't treat as PPH21
            // User Request: "kecualikan kata premi,,jadi misal docDesc (premi pph tidak masuk ke pph21)"
            if (upper.includes("PREMI") || upperTask.includes("PREMI")) {
                const key = upper.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
                return { key, title: cleanTitle };
            }
            return { key: "PPH21", title: "PPH21" };
        }

        // [RULE 3] Static: SPSI
        if (upper.includes("SPSI")) {
            return { key: "SPSI", title: "SPSI" };
        }

        // [RULE 4] Dynamic POTONGAN X patterns
        // Pattern: POTONGAN, POTONGAN A, POTONGAN BERAS, POT X, etc.
        // Each variation becomes a separate column in POTONGAN UPAH BERSIH
        // NOTE: "POTONGAN PPH 21" is handled by RULE 2 (PPH check above)
        if (upper.startsWith("POTONGAN") || upper.startsWith("POT ") || upper.startsWith("POT_")) {
            const key = upper.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
            return { key, title: cleanTitle };
        }

        // [RULE 5] Default: Use DocDesc as title, normalized key for field name
        const key = upper.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
        return { key, title: cleanTitle };
    }

    /**
     * Fetch bunches data for multiple employees in batch
     * Only returns data for harvest gangs (ending with "H")
     */
    private async getBunchesBatch(empCodes: string[], month: number, year: number): Promise<Map<string, import("../types/harvest").HarvestData>> {
        if (empCodes.length === 0) {
            return new Map();
        }

        try {
            return await harvesterService.getBatchEmployeeBunches(empCodes, month, year);
        } catch (error: any) {
            console.error("[DataExtractor] Error fetching bunches batch:", error.message);
            return new Map();
        }
    }

    private async getBrondol(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<Record<string, number>> {
        if (!empCodes.length) return {};

        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        try {
            // Query PR_LOOSEFRUIT (active + archived) for brondol premium amounts
            // OPTIMIZED:
            // - No RTRIM() on EmpCode in WHERE — allows SQL Server to use EmpCode index
            // - Removed inner GROUP BY — single GROUP BY at outer level is sufficient
            // - Removed subquery wrapper — direct UNION ALL is faster
            // - Sequential smaller batches (size 20) — prevents gateway 30s timeout
            const result: Record<string, number> = {};
            const batchSize = 20; // Small batches to avoid gateway timeout
            const batches = [];

            for (let i = 0; i < empCodes.length; i += batchSize) {
                batches.push(empCodes.slice(i, i + batchSize));
            }

            for (const batch of batches) {
                const batchEmpList = batch.map(e => `'${e}'`).join(",");

                try {
                    const rows = await db.query<any>(`
                        SELECT
                            l.EmpCode as EmpCode,
                            SUM(ISNULL(l.Amount, 0)) as TotalAmount
                        FROM PR_LOOSEFRUITLN l
                        INNER JOIN PR_LOOSEFRUIT m ON l.MasterID = m.ID
                        WHERE l.EmpCode IN (${batchEmpList})
                          AND m.DocDate >= ? AND m.DocDate < ?
                        GROUP BY l.EmpCode

                        UNION ALL

                        SELECT
                            l.EmpCode as EmpCode,
                            SUM(ISNULL(l.Amount, 0)) as TotalAmount
                        FROM PR_LOOSEFRUITLN_ARC l
                        INNER JOIN PR_LOOSEFRUIT_ARC m ON l.MasterID = m.ID
                        WHERE l.EmpCode IN (${batchEmpList})
                          AND m.DocDate >= ? AND m.DocDate < ?
                        GROUP BY l.EmpCode
                    `, [startDate, endDate, startDate, endDate], 60);

                    for (const row of rows) {
                        if (row.EmpCode && row.TotalAmount) {
                            const empCode = (row.EmpCode || "").trim();
                            const amount = parseFloat(row.TotalAmount) || 0;
                            if (!result[empCode] || amount > result[empCode]) {
                                result[empCode] = amount;
                            }
                        }
                    }
                } catch (batchError) {
                    warn("DataExtractor", `Brondol batch query failed for ${batch.length} employees: ${batchError.message || 'unknown error'}`);
                    // Continue with next batch - brondol will be 0 for this batch
                }
            }

            return result;
        } catch (e) {
            // Gracefully handle timeout - brondol will be 0 for affected employees
            const errorMsg = e.message || '';
            if (errorMsg.includes('Timeout') || errorMsg.includes('timeout')) {
                warn("DataExtractor", `PR_LOOSEFRUIT query timed out - returning partial brondol data (this is OK for large datasets)`);
            } else {
                console.error("[DataExtractor] Failed to get brondol from PR_LOOSEFRUIT:", e);
            }
            return {};
        }
    }
    /**
     * Get Job Title (Position) for each employee for the specified month from history table
     */
    private async getPositionHistory(empCodes: string[], month: number, year: number): Promise<Record<string, string>> {
        if (!empCodes.length) return {};
        try {
            const extDb = Database.getExtendedInstance();
            const empList = empCodes.map(e => `'${e}'`).join(",");

            const rows = await extDb.query<{ emp_code: string; position: string }>(`
            SELECT RTRIM(emp_code) as emp_code, position
            FROM history_hr_employee
            WHERE RTRIM(emp_code) IN (${empList})
              AND period_month = ?
              AND period_year = ?
        `, [month, year]);

            const result: Record<string, string> = {};
            for (const r of rows) {
                if (r.emp_code && r.position) {
                    result[r.emp_code.trim()] = r.position.trim();
                }
            }
            return result;
        } catch (e) {
            console.error("[DataExtractor] Failed to get position history:", e);
            return {};
        }
    }

    /**
     * Get Task/Job Code for each employee for the specified month
     * Uses UNION ALL to combine data from both current (PR_TASKREGLN) and historical (PR_TASKREGLN_ARC) tables
     * Returns the most frequent task code for each employee (or the most recent one)
     */
    private async getTaskCodes(empCodes: string[], startDate: string, endDate: string, serverProfile?: string): Promise<Record<string, {
        task_code: string;
        task_desc: string;
        task_type: string;
        task_uom: string;
    }>> {
        if (!empCodes.length) return {};
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const empList = empCodes.map(e => `'${e}'`).join(",");

        // Get task codes with descriptions from both tables, then rank by frequency
        // Using simpler column aliases to avoid SQL Gateway issues
        let rows = await db.query<any>(`
            SELECT EmpCode, TaskCode, TaskDesc, TaskType, UOM
            FROM (
                SELECT
                    RTRIM(trl.EmpCode) as EmpCode,
                    trl.TaskCode,
                    tc.TaskDesc,
                    tc.TaskType,
                    tc.UOM,
                    ROW_NUMBER() OVER (
                        PARTITION BY RTRIM(trl.EmpCode)
                        ORDER BY COUNT(*) DESC, trl.TaskCode
                    ) as rn
                FROM PR_TASKREGLN trl
                INNER JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                LEFT JOIN PR_TASKCODE tc ON trl.TaskCode = tc.TaskCode
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND trl.TaskCode IS NOT NULL
                  AND trl.TaskCode <> ''
                GROUP BY RTRIM(trl.EmpCode), trl.TaskCode, tc.TaskDesc, tc.TaskType, tc.UOM

                UNION ALL

                SELECT
                    RTRIM(trl.EmpCode) as EmpCode,
                    trl.TaskCode,
                    tc.TaskDesc,
                    tc.TaskType,
                    tc.UOM,
                    ROW_NUMBER() OVER (
                        PARTITION BY RTRIM(trl.EmpCode)
                        ORDER BY COUNT(*) DESC, trl.TaskCode
                    ) as rn
                FROM PR_TASKREGLN_ARC trl
                INNER JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                LEFT JOIN PR_TASKCODE tc ON trl.TaskCode = tc.TaskCode
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate < ?
                  AND trl.OT = 0
                  AND trl.TaskCode IS NOT NULL
                  AND trl.TaskCode <> ''
                GROUP BY RTRIM(trl.EmpCode), trl.TaskCode, tc.TaskDesc, tc.TaskType, tc.UOM
            ) RankedTasks
            WHERE rn = 1
        `, [startDate, endDate, startDate, endDate]);

        const result: Record<string, { task_code: string; task_desc: string; task_type: string; task_uom: string }> = {};
        for (const r of rows) {
            const empCode = (r.EmpCode || "").trim();
            result[empCode] = {
                task_code: r.TaskCode || "",
                task_desc: r.TaskDesc || "",
                task_type: r.TaskType || "",
                task_uom: r.UOM || ""
            };
        }
        return result;
    }

    // =========================================================================
    // NEW UNIFIED COMPONENT ARCHITECTURE METHODS
    // These methods use the new component services with metadata
    // =========================================================================

    /**
     * Extract payroll data using new unified component services
     * This method demonstrates the new architecture where all calculations
     * return PayrollComponent with full metadata
     *
     * @experimental - This is the future replacement for extractPayrollData
     */
    public async extractPayrollDataWithComponents(
        month: number,
        year: number,
        gangCode: string = "ALL",
        divisionCode?: string,
        specificEmpCode: string | null = null,
        serverProfile?: string,
        useHistoryDb?: boolean | null
    ): Promise<{
        data_rows: PayrollRow[];
        components: {
            lembur: Record<string, any>;
            premi: Record<string, any>;
            tunjangan: Record<string, any>;
            potongan: Record<string, any>;
            pph21_ter: Record<string, any>;
        };
        meta: { execution_time_ms: number; row_count: number }
    }> {
        const startTime = Date.now();

        // First, get the base data using the existing method
        // Also passing includeVirtualGangs as false by default to match existing signature, and then useHistoryDb.
        const baseResult = await this.extractPayrollData(month, year, gangCode, divisionCode, specificEmpCode, serverProfile, false, useHistoryDb);

        // Then calculate components using the new component services
        const empCodes = baseResult.data_rows.map(row => row.nik);

        // [FIX] Dynamic import to prevent circular dependency
        const { payrollComponentRegistry } = await import("./payroll");

        // Calculate all components in parallel using the registry
        const componentResults = await payrollComponentRegistry.calculateAllBatch(
            empCodes.map(code => ({
                emp_code: code,
                month,
                year,
                server_profile: serverProfile,
            })),
            ['gaji_pokok', 'lembur', 'premi', 'tunjangan', 'potongan', 'pph21_ter']
        );

        // Transform results into organized structure
        const components = {
            gaji_pokok: this.transformComponentResults(componentResults, 'gaji_pokok'),
            lembur: this.transformComponentResults(componentResults, 'lembur'),
            premi: this.transformComponentResults(componentResults, 'premi'),
            tunjangan: this.transformComponentResults(componentResults, 'tunjangan'),
            potongan: this.transformComponentResults(componentResults, 'potongan'),
            pph21_ter: this.transformComponentResults(componentResults, 'pph21_ter'),
        };

        return {
            data_rows: baseResult.data_rows,
            components,
            meta: {
                execution_time_ms: Date.now() - startTime,
                row_count: baseResult.data_rows.length
            }
        };
    }

    /**
     * Transform component results from Map to organized structure
     */
    private transformComponentResults(
        allResults: Record<string, Record<string, any>>,
        componentName: string
    ): Record<string, any> {
        const result: Record<string, any> = {};

        // allResults has structure: { emp_code: { lembur: {...}, premi: {...}, ...} }
        for (const [empCode, empResults] of Object.entries(allResults)) {
            const componentResult = empResults[componentName];
            if (componentResult && componentResult.output) {
                result[empCode] = {
                    value: componentResult.output.value,
                    meta: componentResult.output.meta,
                    execution_time_ms: componentResult.execution_time_ms,
                };
            }
        }

        return result;
    }

    /**
     * Get detailed component data for a single employee
     * Returns all calculations with full metadata traceability
     */
    public async getEmployeeComponentDetails(
        empCode: string,
        month: number,
        year: number,
        serverProfile?: string
    ): Promise<{
        employee: any;
        components: {
            gaji_pokok: any;
            lembur: any;
            premi: any;
            tunjangan: any;
            potongan: any;
            pph21_ter: any;
        };
        calculation_meta: {
            period: { month: number; year: number };
            generated_at: Date;
            execution_time_ms: number;
            service_versions: Record<string, number>;
        };
    }> {
        const startTime = Date.now();

        // [FIX] Dynamic import to prevent circular dependency
        const { lemburService, premiService, tunjanganService, potonganService, pph21TerService, payrollComponentRegistry } = await import("./payroll");

        // Calculate all components for this employee
        const gajiPokokResult = await gajiPokokService.calculate({
            emp_code: empCode,
            month,
            year,
            server_profile: serverProfile,
        });

        const lemburResult = await lemburService.calculate({
            emp_code: empCode,
            month,
            year,
            server_profile: serverProfile,
            include_details: true,
        });

        const premiResult = await premiService.calculate({
            emp_code: empCode,
            month,
            year,
            server_profile: serverProfile,
        });

        const tunjanganResult = await tunjanganService.calculate({
            emp_code: empCode,
            month,
            year,
            server_profile: serverProfile,
        });

        // Get penghasilan_bruto from tunjangan for PPH21 calculation
        const penghasilanBruto = tunjanganResult.output.value.total.value +
            (tunjanganResult.output.value.beras?.value || 0) +
            (tunjanganResult.output.value.jabatan?.value || 0) +
            (tunjanganResult.output.value.masa_kerja?.value || 0) +
            (premiResult.output.value.total_premi || 0);

        const potonganResult = await potonganService.calculate({
            emp_code: empCode,
            month,
            year,
            server_profile: serverProfile,
            penghasilan_bruto: penghasilanBruto,
        });

        const pph21TerResult = await pph21TerService.calculate({
            emp_code: empCode,
            month,
            year,
            server_profile: serverProfile,
            penghasilan_bruto: penghasilanBruto,
        });

        return {
            employee: { emp_code: empCode },
            components: {
                gaji_pokok: gajiPokokResult.output,
                lembur: lemburResult.output,
                premi: premiResult.output,
                tunjangan: tunjanganResult.output,
                potongan: potonganResult.output,
                pph21_ter: pph21TerResult.output,
            },
            calculation_meta: {
                period: { month, year },
                generated_at: new Date(),
                execution_time_ms: Date.now() - startTime,
                service_versions: payrollComponentRegistry.getAllServiceVersions(),
            },
        };
    }

    /**
     * [TRUE LAZY LOADING] Async generator that yields employee data in phases:
     * - Phase 0 (T+0-1s): Employee names ONLY (instant render)
     * - Phase 1 (T+1-3s): + Attendance data (HK, jam kerja)
     * - Phase 2 (T+3-8s): + Overtime + Allowances
     * - Phase 3 (T+8-15s): + Premiums + Deductions
     * - Phase 4 (T+15-20s): + Final calculations (gaji bersih, etc)
     *
     * KEY: Frontend can render rows IMMEDIATELY with names, then progressively
     * update cells as data arrives. Much better UX than waiting 45s for all data.
     */
    public async *extractPayrollDataProgressive(
        month: number,
        year: number,
        gangCode: string = "ALL",
        divisionCode?: string,
        serverProfile?: string,
        gangPrefix?: string,
        useHistoryDb?: boolean | null,
        snapshotVersion?: number | null,
        valuePriorityModeInput?: string | null
    ): AsyncGenerator<{
        phase: 'identity' | 'attendance' | 'overtime' | 'premium' | 'complete';
        gangs: Map<string, any[]>;
        current_gang?: string;
        meta: {
            total_gangs: number;
            total_employees: number;
            processed_employees: number;
            progress_pct: number;
            message: string;
        };
        dynamic_premi_headers?: string[];
        dynamic_potongan_headers?: string[];
        dynamic_premi_titles?: Record<string, string>;
        dynamic_potongan_titles?: Record<string, string>;
    }> {
        const valuePriorityMode = normalizePayrollValuePriorityMode(valuePriorityModeInput);
        const manualAdjustmentPolicy = resolveManualAdjustmentSourcePolicy(valuePriorityMode);
        const useAutoBuffer = valuePriorityMode !== "db_ptrj_only";
        const allowManualAdjustments = manualAdjustmentPolicy.applyAmounts;
        const fetchManualAdjustmentRows = manualAdjustmentPolicy.fetchRowsForMetadata;
        const manualBufferOnlyMode = manualAdjustmentPolicy.manualBufferOnly;
        const startTime = Date.now();
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const endDate = `${nextYear}-${nextMonth.toString().padStart(2, "0")}-01`;
        const resolvedDivisionCode = resolvePayrollDivisionCodeForScope(divisionCode);
        const effectiveGangPrefix = resolvePayrollGangPrefixForDivision(divisionCode, gangPrefix);

        const buildProgressiveGangsMap = (rows: PayrollRow[]): Map<string, any[]> => {
            const gangsMap = new Map<string, any[]>();

            for (const row of rows) {
                const normalizedGangCode = (row.gang_code || "UNKNOWN").trim() || "UNKNOWN";
                if (!gangsMap.has(normalizedGangCode)) {
                    gangsMap.set(normalizedGangCode, []);
                }
                gangsMap.get(normalizedGangCode)!.push(row);
            }

            return gangsMap;
        };

        // Helper: timeout wrapper for enrichment queries - prevents stream from hanging
        async function withTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T | null> {
            try {
                return await Promise.race([
                    promise,
                    new Promise<null>((_, reject) =>
                        setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs)
                    )
                ]);
            } catch (e: any) {
                debug(CATEGORY, `⚠️ ${label} failed/timed out: ${e.message}`);
                return null;
            }
        }

        // NON-BLOCKING: Get gangs first (fast), start currentPeriod in background
        const allGangsPromise = gangService.fetchGangs(divisionCode || undefined, undefined, false);
        const currentPeriodPromise = currentPeriodService.getCurrentPeriod().catch(err => {
            console.error("[DataExtractor] Failed to get current period, using defaults:", err.message);
            return { month: month, year: year, is_cached: false };
        });

        const currentPeriod = await currentPeriodPromise;
        const isHistorical = (year < currentPeriod.year) || (year === currentPeriod.year && month < currentPeriod.month);

        let shouldFetchHistory = isHistorical && historyDatabaseService.isHistoryMode();
        if (useHistoryDb === true) {
            shouldFetchHistory = true;
        } else if (useHistoryDb === false) {
            shouldFetchHistory = false;
        }

        const shouldReadHistorySnapshotForSourceMode = valuePriorityMode === "db_ptrj_only";
        if (shouldFetchHistory && shouldReadHistorySnapshotForSourceMode) {
            const historyResult = await this.extractPayrollData(
                month,
                year,
                gangCode,
                divisionCode,
                null,
                serverProfile,
                false,
                useHistoryDb,
                effectiveGangPrefix,
                false,
                false,
                snapshotVersion,
                valuePriorityMode
            );
            const groupedHistoryRows = buildProgressiveGangsMap(historyResult.data_rows);

            yield {
                phase: "complete",
                gangs: groupedHistoryRows,
                meta: {
                    total_gangs: groupedHistoryRows.size,
                    total_employees: historyResult.data_rows.length,
                    processed_employees: historyResult.data_rows.length,
                    progress_pct: 100,
                    message: "Loaded payroll rows from history snapshot"
                },
                dynamic_premi_headers: historyResult.dynamic_premi_headers,
                dynamic_potongan_headers: historyResult.dynamic_potongan_headers,
                dynamic_premi_titles: historyResult.premi_title_map,
                dynamic_potongan_titles: historyResult.potongan_title_map
            };
            return;
        }

        // Wait for gangs first (faster query)
        const allGangs = await allGangsPromise;

        // Build gang condition
        let gangCondition = "1=1";
        let gangCodeInput: string | null = null;
        if (gangCode && gangCode !== "ALL") {
            gangCodeInput = gangCode.trim().toUpperCase();
            gangCondition = `(UPPER(RTRIM(gl.GangCode)) = '${gangCodeInput}' OR UPPER(RTRIM(g.GangCode)) = '${gangCodeInput}' OR UPPER(RTRIM(g.Description)) = '${gangCodeInput}')`;
        } else if (divisionCode) {
            const isVirtual = gangService.isVirtualDivision(divisionCode);
            console.log(`--- REFLI VERSION 1.1.0 (Progressive) ---`);
            console.log(`[DataExtractor.Progressive] Division: ${divisionCode}, isVirtual: ${isVirtual}, allGangs: ${allGangs.length}`);
            if (isVirtual) {
                if (resolvedDivisionCode === 'INF') {
                    // [USER REQUEST] Hardcoded isolation for Infrastruktur: Strictly INF and INT
                    gangCondition = `(UPPER(RTRIM(gl.GangCode)) IN ('INF', 'INT') OR UPPER(RTRIM(g.GangCode)) IN ('INF', 'INT'))`;
                } else if (allGangs.length > 0) {
                    const gangCodes = allGangs.map((gang: { gang_code: string }) => `'${gang.gang_code.trim().toUpperCase()}'`).join(',');
                    const gangDescs = allGangs.filter(g => g.description).map((gang: { description: string }) => `'${gang.description.trim().toUpperCase()}'`).join(',');
                    
                    gangCondition = `(UPPER(RTRIM(gl.GangCode)) IN (${gangCodes}) OR UPPER(RTRIM(g.GangCode)) IN (${gangCodes})`;
                    if (gangDescs) {
                        gangCondition += ` OR UPPER(RTRIM(g.Description)) IN (${gangDescs})`;
                    }
                    gangCondition += `)`;
                } else {
                    gangCondition = "1=0";
                }
            } else {
                const aliases = gangService.getDivisionCodesWithAliases(divisionCode);
                const placeholders = aliases.map((a: string) => `'${a.toUpperCase()}'`).join(',');
                
                let locCondition = `(UPPER(RTRIM(g.LocCode)) IN (${placeholders}))`;
                
                if (allGangs.length > 0) {
                    const gangCodes = allGangs.map((gang: { gang_code: string }) => `'${gang.gang_code.trim().toUpperCase()}'`).join(',');
                    locCondition = `(${locCondition} OR UPPER(RTRIM(gl.GangCode)) IN (${gangCodes}))`;
                }

                gangCondition = locCondition;

                // Exclude virtual division gangs strictly using divisionConfigService (covers INFRA, NURSERY, WORKSHOP, MEC)
                gangCondition += divisionConfigService.getVirtualExclusionSQL();
            }
        }

        // ═══════════════════════════════════════════════════════
        // PHASE 0: Get employees ONLY (fast, ~1s)
        // ═══════════════════════════════════════════════════════
        const t0 = Date.now();
        
        // Get current period WITHOUT blocking employee query
        const currentMonth = currentPeriod.month;
        const currentYear = currentPeriod.year;
        
        let employees = await this.getEmployees(gangCondition, month, year, serverProfile, isHistorical, gangCodeInput);
        employees = filterRowsExcludedFromDivision(employees, divisionCode);
        const phase0Time = Date.now() - t0;
        debug(CATEGORY, `🚀 Phase 0 (identity): ${phase0Time}ms, ${employees.length} employees`);

        // ═══════════════════════════════════════════════════════
        // PHASE 0b: Enrichment - NIK from extend_db_ptrj history
        // Jabatan: will be added later when history_gang_member has the column
        // ═══════════════════════════════════════════════════════
        if (employees.length > 0) {
            const empCodeList = employees.map(e => `'${e.emp_code}'`).join(',');
            let nikFound = 0;

            // Ensure ALL employees have nik and jabatan fields (even if empty)
            for (const emp of employees) {
                emp.nik = emp.actual_nik || emp.emp_code;  // Default fallback
                emp.jabatan = emp.jabatan || '';            // Default fallback
            }

            // Try NIK from history_hr_employee (extend_db_ptrj)
            // CRITICAL: Wrap with timeout to prevent stream from hanging
            try {
                const extendDb = Database.getExtendedInstance();
                const nikRows = await withTimeout('NIK lookup (history_hr_employee)',
                    extendDb.query<any>(`
                        SELECT RTRIM(emp_code) as emp_code, RTRIM(nik) as nik
                        FROM dbo.history_hr_employee
                        WHERE RTRIM(emp_code) IN (${empCodeList})
                          AND nik IS NOT NULL AND RTRIM(nik) != ''
                    `),
                    5000 // 5 second timeout
                );
                if (nikRows) {
                    const nikMap = new Map<string, string>();
                    for (const row of nikRows) {
                        if (!nikMap.has(row.emp_code)) nikMap.set(row.emp_code, row.nik);
                    }
                    for (const emp of employees) {
                        if (nikMap.has(emp.emp_code)) {
                            const nikVal = nikMap.get(emp.emp_code);
                            emp.actual_nik = nikVal;
                            emp.nik = nikVal;
                            nikFound++;
                        }
                    }
                    debug(CATEGORY, `📋 NIK from history_hr_employee: ${nikFound}/${employees.length}`);
                }
            } catch (e) {
                debug(CATEGORY, `⚠️ history_hr_employee NIK lookup skipped: ${e.message}`);
            }

            // [JOIN_DATE] Get join_date with override support
            // Priority: 1) employee_profile_override_history.effective_start_date (current edit mode),
            //           2) payroll_value_override_history legacy join_date fallback,
            //           3) history_hr_employee seed base.
            let joinDateFound = 0;
            try {
                const extendDb = Database.getExtendedInstance();

                const profileOverrideRows = await withTimeout('Join date lookup (profile override latest)',
                    extendDb.query<any>(buildLatestProfileJoinDateQuery(empCodeList)),
                    5000
                );

                const overrideRows = await withTimeout('Join date lookup (legacy value override latest)',
                    extendDb.query<any>(buildLatestValueJoinDateQuery(empCodeList)),
                    5000
                );
                if (overrideRows && overrideRows.length > 0) {
                    debug(CATEGORY, `📋 Join date from value override: ${overrideRows.length} overrides found`);
                }

                if (profileOverrideRows && profileOverrideRows.length > 0) {
                    debug(CATEGORY, `📋 Join date from profile override latest: ${profileOverrideRows.length} found`);
                }

                const historyRows = await withTimeout('Join date lookup (history_hr_employee latest)',
                    extendDb.query<any>(buildLatestHistoryJoinDateQuery(empCodeList)),
                    5000
                );

                applyJoinDateSourcesToEmployees(employees, {
                    profileOverrideRows,
                    valueOverrideRows: overrideRows,
                    historyRows
                });

                for (const emp of employees) {
                    if (emp.join_date) {
                        joinDateFound++;
                    }
                }
                debug(CATEGORY, `📋 Join date enriched: ${joinDateFound}/${employees.length}`);
            } catch (e) {
                debug(CATEGORY, `⚠️ join_date enrichment skipped: ${e.message}`);
            }

            // [IS_SPSI_MEMBER] Resolve SPSI membership:
            // Priority: 1) employee_profile_override_history, 2) history_hr_employee base.
            let spsiFound = 0;
            try {
                const extendDb = Database.getExtendedInstance();
                const spsiMap = new Map<string, boolean>();

                const profileSpsiRows = await withTimeout('SPSI member lookup (employee_profile_override_history MAX id)',
                    extendDb.query<any>(`
                        SELECT p.emp_code, p.is_spsi_member
                        FROM dbo.employee_profile_override_history p
                        INNER JOIN (
                            SELECT emp_code, MAX(id) as max_id
                            FROM dbo.employee_profile_override_history
                            WHERE RTRIM(emp_code) IN (${empCodeList})
                              AND is_spsi_member IS NOT NULL
                            GROUP BY emp_code
                        ) latest ON p.emp_code = latest.emp_code AND p.id = latest.max_id
                    `),
                    5000
                );

                if (profileSpsiRows && profileSpsiRows.length > 0) {
                    for (const row of profileSpsiRows) {
                        const empCode = String(row.emp_code || '').trim().toUpperCase();
                        if (!empCode || spsiMap.has(empCode)) continue;
                        spsiMap.set(empCode, !!row.is_spsi_member);
                    }
                    debug(CATEGORY, `📋 is_spsi_member from employee_profile_override_history (MAX id): ${profileSpsiRows.length} source rows`);
                }

                const historySpsiRows = await withTimeout('SPSI member lookup (history_hr_employee MAX id)',
                    extendDb.query<any>(`
                        SELECT h.emp_code, h.is_spsi_member
                        FROM dbo.history_hr_employee h
                        INNER JOIN (
                            SELECT emp_code, MAX(id) as max_id
                            FROM dbo.history_hr_employee
                            WHERE RTRIM(emp_code) IN (${empCodeList})
                              AND is_spsi_member IS NOT NULL
                            GROUP BY emp_code
                        ) latest ON h.emp_code = latest.emp_code AND h.id = latest.max_id
                    `),
                    5000
                );

                if (historySpsiRows && historySpsiRows.length > 0) {
                    for (const row of historySpsiRows) {
                        const empCode = String(row.emp_code || '').trim().toUpperCase();
                        if (!empCode || spsiMap.has(empCode)) continue;
                        spsiMap.set(empCode, !!row.is_spsi_member);
                    }
                    debug(CATEGORY, `📋 is_spsi_member from history_hr_employee (MAX id): ${historySpsiRows.length} source rows`);
                }

                // Forward-persistence: emp yang pernah SPSI member di periode < periode ini.
                // Sekali member -> member sampai override false. Cegah flapping null/false.
                const periodStart = year * 12 + (month - 1);
                const priorSpsiRows = await withTimeout('SPSI prior member lookup (history_hr_employee)',
                    extendDb.query<{ emp_code: string }>(`
                        SELECT DISTINCT RTRIM(emp_code) as emp_code
                        FROM dbo.history_hr_employee
                        WHERE RTRIM(emp_code) IN (${empCodeList})
                          AND is_spsi_member = 1
                          AND (period_year * 12 + (period_month - 1)) < ?
                    `, [periodStart]),
                    5000
                );
                const priorSpsiMember = new Set<string>();
                if (priorSpsiRows) {
                    for (const row of priorSpsiRows) {
                        const ec = String(row.emp_code || '').trim().toUpperCase();
                        if (ec) priorSpsiMember.add(ec);
                    }
                    debug(CATEGORY, `📋 SPSI forward-persist candidates (prior member): ${priorSpsiMember.size}`);
                }

                // Auto-buffer SPSI evidence: emp dengan auto-buffer SPSI amount>0 di periode
                // manapun = bukti member. Masuk forward-persist set.
                const autoBufferSpsiRows = await withTimeout('SPSI auto-buffer member lookup',
                    extendDb.query<{ emp_code: string }>(`
                        SELECT DISTINCT RTRIM(emp_code) as emp_code
                        FROM dbo.payroll_manual_adjustments
                        WHERE adjustment_type = 'AUTO_BUFFER'
                          AND adjustment_name = 'SPSI'
                          AND ABS(amount) > 0
                          AND RTRIM(emp_code) IN (${empCodeList})
                    `),
                    5000
                );
                if (autoBufferSpsiRows) {
                    let added = 0;
                    for (const row of autoBufferSpsiRows) {
                        const ec = String(row.emp_code || '').trim().toUpperCase();
                        if (ec && !priorSpsiMember.has(ec)) { priorSpsiMember.add(ec); added++; }
                    }
                    debug(CATEGORY, `📋 SPSI forward-persist candidates (auto-buffer evidence): +${added}`);
                }

                // SSOT SPSI: extend_db_ptrj (override > history).
                // Forward-persistence guard: kalo pernah member di periode sebelumnya (history),
                // tetap member kecuali override false. Live db_ptrj (pot_spsi) hanya comparison,
                // fallback kalau extend tidak punya data sama sekali.
                for (const emp of employees) {
                    const empCodeKey = String(emp.emp_code || '').trim().toUpperCase();
                    let resolved: boolean | null = null;
                    if (spsiMap.has(empCodeKey)) {
                        resolved = !!spsiMap.get(empCodeKey);
                    }
                    // Forward-persistence: kalau extend belum ada nilai, cek history prior member
                    if (resolved === null && priorSpsiMember.has(empCodeKey)) {
                        resolved = true;
                    }
                    // Fallback: live db_ptrj pot_spsi > 0 (comparison source)
                    if (resolved === null) {
                        const liveSpsi = Number(emp.pot_spsi || 0) > 0;
                        if (liveSpsi) resolved = true;
                    }
                    if (resolved !== null) {
                        emp.is_spsi_member = resolved;
                        spsiFound++;
                    }
                }
                debug(CATEGORY, `📋 is_spsi_member enriched: ${spsiFound}/${employees.length} (override/history + forward-persist + live fallback)`);
            } catch (e) {
                debug(CATEGORY, `⚠️ is_spsi_member enrichment skipped: ${e.message}`);
            }

            // Try Jabatan from history_gang_member (extend_db_ptrj)
            // NOTE: Jabatan (role text like "Mandor", "Kerani") is stored in extend_db_ptrj,
            // NOT in HR_GANGLN. HR_GANGLN only has GangMember/GangCode (gang membership), not jabatan.
            // Two sources for jabatan:
            //   1. history_gang_member.jabatan - from manual seed/entry
            //   2. employee_estate.jabatan - from employee estate management
            let jabatanFound = 0;
            try {
                const extendDb = Database.getExtendedInstance();
                const jabatanRows = await withTimeout('Jabatan lookup (history_gang_member)',
                    extendDb.query<any>(`
                        SELECT RTRIM(emp_code) as emp_code, RTRIM(jabatan) as jabatan
                        FROM dbo.history_gang_member
                        WHERE RTRIM(emp_code) IN (${empCodeList})
                          AND jabatan IS NOT NULL AND RTRIM(jabatan) != ''
                    `),
                    5000 // 5 second timeout
                );
                if (jabatanRows) {
                    const jabatanMap = new Map<string, string>();
                    for (const row of jabatanRows) {
                        if (!jabatanMap.has(row.emp_code)) jabatanMap.set(row.emp_code, row.jabatan);
                    }
                    for (const emp of employees) {
                        if (jabatanMap.has(emp.emp_code)) {
                            emp.jabatan = jabatanMap.get(emp.emp_code);
                            jabatanFound++;
                        }
                    }
                    debug(CATEGORY, `📋 Jabatan from history_gang_member: ${jabatanFound}/${employees.length}`);
                }
            } catch (e) {
                debug(CATEGORY, `⚠️ history_gang_member jabatan lookup skipped: ${e.message}`);
            }

            // [FALLBACK] If jabatan still empty, try employee_estate
            // employee_estate is the PRIMARY source for jabatan (role text) when history_gang_member is not seeded
            let jabatanEstateFound = 0;
            try {
                const extendDb = Database.getExtendedInstance();
                const estateRows = await withTimeout('Jabatan lookup (employee_estate fallback)',
                    extendDb.query<any>(`
                        SELECT RTRIM(empcode) as emp_code, RTRIM(jabatan) as jabatan
                        FROM dbo.employee_estate
                        WHERE RTRIM(empcode) IN (${empCodeList})
                          AND jabatan IS NOT NULL AND RTRIM(jabatan) != ''
                    `),
                    5000 // 5 second timeout
                );
                if (estateRows) {
                    const estateMap = new Map<string, string>();
                    for (const row of estateRows) {
                        if (!estateMap.has(row.emp_code)) estateMap.set(row.emp_code, row.jabatan);
                    }
                    for (const emp of employees) {
                        if (!emp.jabatan && estateMap.has(emp.emp_code)) {
                            emp.jabatan = estateMap.get(emp.emp_code);
                            jabatanEstateFound++;
                        }
                    }
                    debug(CATEGORY, `📋 Jabatan from employee_estate (fallback): ${jabatanEstateFound}/${employees.length}`);
                }
            } catch (e) {
                debug(CATEGORY, `⚠️ employee_estate jabatan fallback skipped: ${e.message}`);
            }

            // [JABATAN ESTATE] Get jabatan from employee_estate (extend_db_ptrj) for jabatan_estate field
            // CRITICAL: Wrap with timeout to prevent stream from hanging if query is slow
            let jabatanEstateSectionFound = 0;
            try {
                const { EmployeeEstateService: EES } = await import("./employeeEstateService");
                debug(CATEGORY, `🔍 Attempting to get employee jobs with NIK...`);
                // Timeout wrapper: 5 seconds max for this enrichment query
                const timeoutMs = 5000;
                const currentEmpCodes = employees.map(e => e.emp_code);
                const jobTitlesResult = await Promise.race([
                    EES.getEmployeeJobsWithNik(currentEmpCodes),
                    new Promise<null>((_, reject) =>
                        setTimeout(() => reject(new Error('getEmployeeJobsWithNik timeout (5s)')), timeoutMs)
                    )
                ]).catch((e) => {
                    debug(CATEGORY, `⚠️ employee_estate jabatan lookup timed out: ${e.message}`);
                    return null;
                }) as any;

                if (jobTitlesResult) {
                    const { empcodeMap: estateEmpMap, nikMap: estateNikMap } = jobTitlesResult;
                    debug(CATEGORY, `📊 Loaded estate maps - empcodeMap: ${Object.keys(estateEmpMap).length} entries, nikMap: ${Object.keys(estateNikMap).length} entries`);
                    for (const emp of employees) {
                        const nikClean = (emp.actual_nik || '').trim().toUpperCase();
                        const estateJabatan = estateEmpMap[emp.emp_code] || estateNikMap[nikClean] || '';
                        if (estateJabatan) {
                            emp.jabatan_estate = estateJabatan;
                            jabatanEstateSectionFound++;
                        } else if (emp.jabatan) {
                            // Fallback to history_gang_member jabatan if estate is empty
                            emp.jabatan_estate = emp.jabatan;
                        } else {
                            emp.jabatan_estate = '';
                        }
                    }
                    debug(CATEGORY, `📋 Jabatan estate from employee_estate: ${jabatanEstateSectionFound}/${employees.length}`);
                } else {
                    debug(CATEGORY, `⚠️ jobTitlesResult is null - no estate maps available`);
                }
            } catch (e) {
                debug(CATEGORY, `⚠️ employee_estate jabatan lookup skipped: ${e.message}`);
            }

            // Log enrichment result
            debug(CATEGORY, `📊 Final enrichment: NIK=${nikFound}, Jabatan=${jabatanFound}`);
            for (let i = 0; i < Math.min(3, employees.length); i++) {
                debug(CATEGORY, `  ${employees[i].emp_code}: nik=${employees[i].nik || '-'}, jabatan=${employees[i].jabatan || '-'}`);
            }
        }

        // Apply gangPrefix filter
        if (effectiveGangPrefix && employees.length > 0) {
            const isNumeric = /^\d+$/.test(effectiveGangPrefix);
            employees = employees.filter(emp => {
                const gc = (emp.gang_code || '').trim().toUpperCase();
                if (isNumeric) {
                    const asistensi = gc.startsWith('K2') ? '1' : (gc.match(/\d+/)?.[0] ?? null);
                    return asistensi === effectiveGangPrefix;
                }
                return gc.startsWith(effectiveGangPrefix.toUpperCase());
            });
        }

        if (employees.length === 0) {
            yield {
                phase: 'complete',
                gangs: new Map(),
                meta: { total_gangs: 0, total_employees: 0, processed_employees: 0, progress_pct: 100, message: 'No employees found' }
            };
            return;
        }

        // Build initial gangs map with IDENTITY ONLY (nama, gender, gang)
        const gangsMap = new Map<string, any[]>();
        const gangOrder: string[] = [];
        
        // DEBUG: Log first 3 employees after enrichment
        debug(CATEGORY, `📊 Building gangsMap with ${employees.length} employees. Sample enrichment status:`);
        for (let i = 0; i < Math.min(3, employees.length); i++) {
            const emp = employees[i];
            debug(CATEGORY, `  ${emp.emp_code}: actual_nik=${emp.actual_nik || '(none)'}, jabatan=${emp.jabatan || '(none)'}, role=${emp.role || '(none)'}`);
        }
        
        for (const emp of employees) {
            const gang = emp.gang_code || "UNKNOWN";
            if (!gangsMap.has(gang)) {
                gangsMap.set(gang, []);
                gangOrder.push(gang);
            }
            const masaKerjaIdentity = calculateMasaKerjaDisplay(emp.join_date, month, year);
            const isSpsiIdentity = typeof emp.is_spsi_member === "boolean" ? emp.is_spsi_member : false;
            gangsMap.get(gang)!.push({
                emp_code: emp.emp_code,
                nik: emp.actual_nik || emp.emp_code,  // NIK from extend_db_ptrj or fallback to emp_code
                nama: emp.emp_name,
                gang_code: emp.gang_code,
                loc_code: emp.loc_code,
                gender: emp.gender,
                join_date: emp.join_date || null,
                tanggal_masuk: emp.join_date || null,
                is_spsi_member: isSpsiIdentity,
                masa_kerja_tahun: masaKerjaIdentity.years,
                masa_kerja_display_years: masaKerjaIdentity.years,
                masa_kerja_display_months: masaKerjaIdentity.months,
                masa_kerja_label: masaKerjaIdentity.label,
                // Jabatan ROLE TEXT (e.g. "Mandor", "Kerani") from extend_db_ptrj
                // NOT from HR_GANGLN - Phase 3 enriches this from employee_estate or history_gang_member
                jabatan: emp.jabatan || '',
                jabatan_estate: emp.jabatan_estate || emp.jabatan || '',  // Jabatan from employee_estate (extend_db_ptrj)
                role: emp.role || '',        // Role from history
                alamat: emp.res_address || '', // Map res_address to alamat for frontend
                // Phase markers
                _phase: 0,
                _enriched: false,
                _loading: false
            });
        }

        // ✅ YIELD PHASE 0: Names ONLY - Frontend renders IMMEDIATELY
        yield {
            phase: 'identity',
            gangs: new Map(gangsMap),
            meta: {
                total_gangs: gangsMap.size,
                total_employees: employees.length,
                processed_employees: employees.length,
                progress_pct: 10,
                message: `Loaded ${employees.length} employees. Fetching attendance...`
            }
        };

        // ═══════════════════════════════════════════════════════
        // PHASE 1: LAZY LOAD Attendance + Cuti (Background)
        // ═══════════════════════════════════════════════════════
        const t1 = Date.now();
        const empCodes = employees.map(e => e.emp_code);
        const BATCH_SIZE = 50;
        const empCodeChunks: string[][] = [];
        for (let i = 0; i < empCodes.length; i += BATCH_SIZE) {
            empCodeChunks.push(empCodes.slice(i, i + BATCH_SIZE));
        }

        // Global accumulators for lazy loading
        const globalAttendanceMap: Record<string, any> = {};
        const globalCutiMap: Record<string, any> = {};
        const globalLemburMap: Record<string, any> = {};
        const globalJabatanMap: Record<string, number> = {};
        const globalMasaKerjaMap: Record<string, number> = {};
        const globalUpahPokokMap: Record<string, number> = {};
        const globalBrondolMap: Record<string, number> = {};
        const globalTaskCodesMap: Record<string, any> = {};
        const globalPremiResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string> };
        const globalPotonganResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string> };
        const baselinePotSpsiByEmp: Record<string, number> = {};
        const dynamicPremiSet = new Set<string>();
        const dynamicPotonganSet = new Set<string>();

        async function safeQuery<T>(label: string, fn: () => Promise<T>, defaultValue: T): Promise<T> {
            try {
                return await fn();
            } catch (err: any) {
                warn(CATEGORY, `⚠️ ${label} failed: ${err.message}`);
                return defaultValue;
            }
        }

        const emptyPremiResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string>, details: {} as Record<string, any[]> };
        const emptyPotonganResult = { amounts: {} as Record<string, Record<string, number>>, titleMap: {} as Record<string, string> };
        const manualAdjustmentsPromise = fetchManualAdjustmentRows
            ? safeQuery(
                'manualAdjustments',
                () => manualAdjustmentService.getAdjustments(month, year, resolveManualAdjustmentFetchGangCode(gangCode, divisionCode), undefined, divisionCode),
                [] as any[]
            )
            : Promise.resolve([] as any[]);

        // [PHASE 1] Attendance + Cuti
        debug(CATEGORY, `📋 Phase 1: Loading attendance/cuti...`);
        const phase1Promises = empCodeChunks.map((chunk, idx) => Promise.all([
            safeQuery(`attendance[${idx}]`, () => this.getAttendance(chunk, startDate, endDate, serverProfile), {}),
            safeQuery(`cuti[${idx}]`, () => this.getCuti(chunk, startDate, endDate, serverProfile), {}),
        ]));
        const phase1Results = await Promise.all(phase1Promises);
        for (const [attB, cutiB] of phase1Results) {
            Object.assign(globalAttendanceMap, attB);
            Object.assign(globalCutiMap, cutiB);
        }

        // Update employees with attendance data
        for (const emp of employees) {
            const attData = globalAttendanceMap[emp.emp_code] || { hk: 0, total_hours: 0, total_amount_rp: 0, shortage_count: 0 };
            const empCuti = globalCutiMap[emp.emp_code] || { cuti_tahunan: 0, cuti_sakit_haid: 0, cuti_minggu: 0, cuti_nasional: 0 };
            emp.jumlah_hk = attData.hk || 0;
            emp.total_jam_kerja = attData.total_hours || 0;
            emp.total_amount_rp = attData.total_amount_rp || 0; // Gaji Pokok Aktual dari database
            emp.shortage_count = attData.shortage_count || 0;
            emp.cuti_tahunan_hari = empCuti.cuti_tahunan;
            emp.cuti_sakit_haid_hari = empCuti.cuti_sakit_haid;
            emp.cuti_minggu_hari = empCuti.cuti_minggu;
            emp.cuti_nasional_hari = empCuti.cuti_nasional;
            emp._phase = 1;
        }

        // Update gangsMap with attendance data
        for (const [gangCodeKey, gangEmployees] of gangsMap) {
            for (const emp of gangEmployees) {
                const empData = employees.find(e => e.emp_code === emp.emp_code);
                if (empData) {
                    Object.assign(emp, {
                        jumlah_hk: empData.jumlah_hk,
                        total_jam_kerja: empData.total_jam_kerja,
                        total_amount_rp: empData.total_amount_rp,
                        shortage_count: empData.shortage_count,
                        cuti_tahunan_hari: empData.cuti_tahunan_hari,
                        cuti_sakit_haid_hari: empData.cuti_sakit_haid_hari,
                        cuti_minggu_hari: empData.cuti_minggu_hari,
                        cuti_nasional_hari: empData.cuti_nasional_hari,
                        _phase: 1
                    });
                }
            }
        }

        debug(CATEGORY, `✅ Phase 1 (attendance): ${Date.now() - t1}ms`);
        yield {
            phase: 'attendance',
            gangs: new Map(gangsMap),
            meta: {
                total_gangs: gangsMap.size,
                total_employees: employees.length,
                processed_employees: employees.length,
                progress_pct: 25,
                message: `Attendance loaded. Processing overtime...`
            }
        };

        // ═══════════════════════════════════════════════════════
        // PHASE 2: LAZY LOAD Overtime + Allowances
        // ═══════════════════════════════════════════════════════
        const t2 = Date.now();
        debug(CATEGORY, `⏱️ Phase 2: Loading overtime/allowances...`);

        const phase2Promises = empCodeChunks.map((chunk, idx) => Promise.all([
            safeQuery(`lembur[${idx}]`, () => this.getLemburDetailsWithTaskBreakdown(chunk, month, year, serverProfile), {}),
            safeQuery(`jabatan[${idx}]`, () => this.getTunjanganAmount(chunk, startDate, endDate, "JABATAN", serverProfile), {}),
            safeQuery(`masaKerja[${idx}]`, () => this.getTunjanganAmount(chunk, startDate, endDate, "MASA%KERJA", serverProfile), {}),
            safeQuery(`upahPokok[${idx}]`, () => this.getUpahPokok(chunk, year, currentYear, serverProfile), {}),
        ]));
        const phase2Results = await Promise.all(phase2Promises);
        for (const [lemburB, jabatanB, masaKerjaB, upahB] of phase2Results) {
            Object.assign(globalLemburMap, lemburB);
            Object.assign(globalJabatanMap, jabatanB);
            Object.assign(globalMasaKerjaMap, masaKerjaB);
            Object.assign(globalUpahPokokMap, upahB);
        }

        // Update employees with overtime data
        for (const emp of employees) {
            const empLembur = globalLemburMap[emp.emp_code] || { jam: 0, jumlah: 0, records: [] };
            emp.lembur_jam = empLembur.jam || 0;
            emp.lembur_jumlah = empLembur.jumlah || 0;
            emp.lembur_records = empLembur.records || [];
            emp.jabatan_jumlah = globalJabatanMap[emp.emp_code] || 0;
            emp.masa_kerja_jumlah = globalMasaKerjaMap[emp.emp_code] || 0;
            emp.upah_dasar = globalUpahPokokMap[emp.emp_code] || emp.pay_rate || 0;
            emp._phase = 2;
        }

        // Update gangsMap
        for (const [gangCodeKey, gangEmployees] of gangsMap) {
            for (const emp of gangEmployees) {
                const empData = employees.find(e => e.emp_code === emp.emp_code);
                if (empData) {
                    Object.assign(emp, {
                        lembur_jam: empData.lembur_jam,
                        lembur_jumlah: empData.lembur_jumlah,
                        lembur_records: empData.lembur_records,
                        jabatan_jumlah: empData.jabatan_jumlah,
                        masa_kerja_jumlah: empData.masa_kerja_jumlah,
                        upah_dasar: empData.upah_dasar,
                        _phase: 2
                    });
                }
            }
        }

        debug(CATEGORY, `✅ Phase 2 (overtime/allowances): ${Date.now() - t2}ms`);
        yield {
            phase: 'overtime',
            gangs: new Map(gangsMap),
            meta: {
                total_gangs: gangsMap.size,
                total_employees: employees.length,
                processed_employees: employees.length,
                progress_pct: 50,
                message: `Overtime loaded. Processing premiums...`
            }
        };

        // ═══════════════════════════════════════════════════════
        // PHASE 3: LAZY LOAD Premiums + Deductions
        // ═══════════════════════════════════════════════════════
        const t3 = Date.now();
        debug(CATEGORY, `💰 Phase 3: Loading premiums/deductions...`);

        const phase3Promises = empCodeChunks.map((chunk, idx) => Promise.all([
            safeQuery(`premi[${idx}]`, () => this.getPremi(chunk, startDate, endDate, isHistorical, serverProfile), JSON.parse(JSON.stringify(emptyPremiResult))),
            safeQuery(`potongan[${idx}]`, () => this.getPotongan(chunk, startDate, endDate, serverProfile), JSON.parse(JSON.stringify(emptyPotonganResult))),
            safeQuery(`brondol[${idx}]`, () => this.getBrondol(chunk, startDate, endDate, serverProfile), {}),
            safeQuery(`taskCodes[${idx}]`, () => this.getTaskCodes(chunk, startDate, endDate, serverProfile), {}),
        ]));
        const phase3Results = await Promise.all(phase3Promises);
        for (const [premiB, potB, brondolB, taskCodesB] of phase3Results) {
            Object.assign(globalPremiResult.amounts, premiB.amounts);
            Object.assign(globalPremiResult.titleMap, premiB.titleMap);
            Object.assign(globalPotonganResult.amounts, potB.amounts);
            Object.assign(globalPotonganResult.titleMap, potB.titleMap);
            Object.assign(globalBrondolMap, brondolB);
            Object.assign(globalTaskCodesMap, taskCodesB);

            // Collect dynamic headers
            if (!manualBufferOnlyMode) {
                for (const [, empPremi] of Object.entries(premiB.amounts || {})) {
                    for (const key of Object.keys(empPremi || {})) {
                        if (key !== "koreksi" && key !== "brondol") {
                            // Use prefixed field name to match frontend data
                            const fieldName = key.startsWith('premi_') ? key : `premi_${key}`;
                            dynamicPremiSet.add(fieldName);
                        }
                    }
                }
            }
            for (const [empCode, empPot] of Object.entries(potB.amounts || {})) {
                if (baselinePotSpsiByEmp[empCode] === undefined) {
                    baselinePotSpsiByEmp[empCode] = Math.abs(Number((empPot as any)?.SPSI) || 0);
                }
                if (!manualBufferOnlyMode) {
                    for (const key of Object.keys(empPot || {})) {
                        if (key !== "SPSI" && key !== "PPH21") {
                            // For KOREKSI: use key as-is (e.g., "KOREKSI_1", "KOREKSI_2")
                            // For others: use prefixed name (e.g., "potongan_X")
                            let fieldName;
                            if (String(key).toUpperCase().startsWith("KOREKSI")) {
                                fieldName = key; // Keep KOREKSI fields as-is for frontend matching
                            } else if (key.startsWith('potongan_')) {
                                fieldName = key;
                            } else {
                                fieldName = `potongan_${key}`;
                            }
                            dynamicPotonganSet.add(fieldName);
                        }
                    }
                }
            }
        }

        const manualAdjustmentsRaw = await manualAdjustmentsPromise;
        const manualAdjustmentsByIdentity = buildManualAdjustmentIdentityIndex(
            Array.isArray(manualAdjustmentsRaw) ? manualAdjustmentsRaw : []
        );

        // Update employees with premium data
        for (const emp of employees) {
            const dbEmpPremiSource = globalPremiResult.amounts[emp.emp_code] || {};
            const dbEmpPotonganSource = globalPotonganResult.amounts[emp.emp_code] || {};
            const empPremi = manualBufferOnlyMode ? pickStaticPremiForManualBuffer(dbEmpPremiSource) : { ...dbEmpPremiSource };
            const empPotongan = manualBufferOnlyMode
                ? pickStaticPotonganForManualBuffer(dbEmpPotonganSource)
                : { ...dbEmpPotonganSource };
            const empBrondol = globalBrondolMap[emp.emp_code] || 0;
            const empPremiBrondol = empPremi["brondol"] || 0;
            const valueSyncFrame: Record<string, "red" | "green"> = { ...(emp.value_sync_frame || {}) };

            let total_premi = 0;
            for (const [key, val] of Object.entries(empPremi)) {
                if (key !== "koreksi") total_premi += Number(val) || 0;
            }
            total_premi += empBrondol;

            const empAdjustments = fetchManualAdjustmentRows
                ? getManualAdjustmentsForEmployee(manualAdjustmentsByIdentity, emp)
                : [];
            Object.defineProperty(emp, "_manualAdjustmentCount", {
                value: empAdjustments.length,
                configurable: true,
                writable: true,
                enumerable: false
            });
            registerManualAdjustmentMetadataDynamicHeaders(
                empAdjustments,
                dynamicPremiSet,
                dynamicPotonganSet,
                globalPremiResult.titleMap,
                globalPotonganResult.titleMap
            );
            if (allowManualAdjustments && empAdjustments.length > 0) {
                const premiKeysBefore = new Set(Object.keys(empPremi));
                const potonganKeysBefore = new Set(Object.keys(empPotongan));
                const manualApplied = applyManualAdjustmentsToEmployee({
                    adjustments: empAdjustments as any[],
                    empPremi,
                    empPotongan,
                    premiTitleMap: globalPremiResult.titleMap,
                    potonganTitleMap: globalPotonganResult.titleMap,
                    mode: 'override'
                });

                for (const key of Object.keys(manualApplied.empPremi)) {
                    if (premiKeysBefore.has(key) || key === "koreksi" || key === "brondol") continue;
                    const fieldName = key.startsWith("premi_") ? key : `premi_${key}`;
                    dynamicPremiSet.add(fieldName);
                }

                for (const key of Object.keys(manualApplied.empPotongan)) {
                    if (potonganKeysBefore.has(key)) continue;

                    const keyUpper = String(key).toUpperCase();
                    if (keyUpper === "SPSI" || keyUpper === "PPH21" || keyUpper === "PREMI_PPH") continue;

                    let fieldName: string;
                    if (keyUpper.startsWith("KOREKSI")) {
                        fieldName = key;
                    } else if (key.startsWith("potongan_")) {
                        fieldName = key;
                    } else {
                        fieldName = `potongan_${key}`;
                    }
                    dynamicPotonganSet.add(fieldName);
                }

                total_premi += manualApplied.totalPremiDelta;
                for (const syncMeta of manualApplied.fieldSyncMeta) {
                    attachManualAdjustmentValueSourceComparison(
                        valueSyncFrame,
                        emp.value_source_compare ||= {},
                        syncMeta,
                        resolveManualAdjustmentDbPtrjCompareAmount(syncMeta, dbEmpPremiSource, dbEmpPotonganSource)
                    );
                }
            } else if (empAdjustments.length > 0) {
                attachManualAdjustmentSourceComparisons(
                    valueSyncFrame,
                    emp.value_source_compare ||= {},
                    empAdjustments,
                    dbEmpPremiSource,
                    dbEmpPotonganSource
                );
            }
            attachManualAdjustmentMetadata(emp, empAdjustments);

            globalPremiResult.amounts[emp.emp_code] = empPremi;
            globalPotonganResult.amounts[emp.emp_code] = empPotongan;
            globalBrondolMap[emp.emp_code] = empBrondol;

            emp.premi = empPremi;
            emp.potongan = empPotongan;
            emp.premi_brondol = empBrondol + empPremiBrondol;
            emp.total_premi = total_premi;
            emp.task_code = globalTaskCodesMap[emp.emp_code]?.task_code || "";
            emp.task_desc = globalTaskCodesMap[emp.emp_code]?.task_desc || "";
            emp.value_sync_frame = valueSyncFrame;
            emp._phase = 3;
        }

        // Update gangsMap
        for (const [gangCodeKey, gangEmployees] of gangsMap) {
            for (const emp of gangEmployees) {
                const empData = employees.find(e => e.emp_code === emp.emp_code);
                if (empData) {
                    Object.assign(emp, {
                        premi: empData.premi,
                        potongan: empData.potongan,
                        premi_brondol: empData.premi_brondol,
                        total_premi: empData.total_premi,
                        task_code: empData.task_code,
                        task_desc: empData.task_desc,
                        value_sync_frame: empData.value_sync_frame,
                        value_source_compare: empData.value_source_compare,
                        manual_adjustment_metadata: empData.manual_adjustment_metadata,
                        manual_adjustment_metadata_mismatch: empData.manual_adjustment_metadata_mismatch,
                        _phase: 3
                    });
                }
            }
        }

        debug(CATEGORY, `✅ Phase 3 (premiums/deductions): ${Date.now() - t3}ms`);
        yield {
            phase: 'premium',
            gangs: new Map(gangsMap),
            meta: {
                total_gangs: gangsMap.size,
                total_employees: employees.length,
                processed_employees: employees.length,
                progress_pct: 75,
                message: `Premiums loaded. Calculating final values...`
            },
            dynamic_premi_headers: Array.from(dynamicPremiSet),
            dynamic_potongan_headers: Array.from(dynamicPotonganSet),
            dynamic_premi_titles: globalPremiResult.titleMap,
            dynamic_potongan_titles: globalPotonganResult.titleMap
        };

        // ═══════════════════════════════════════════════════════
        // PHASE 4: FINAL CALCULATIONS (Gaji Bersih, PPh21, etc)
        // ═══════════════════════════════════════════════════════
        const t4 = Date.now();
        debug(CATEGORY, `🧮 Phase 4: Final calculations...`);

        // Build PTKP map with timeout-safe approach
        // Use cached/fast lookup first, async PTKP only if fast
        const dbPtkpMap = new Map<string, string>();
        try {
            // Try to get PTKP with timeout-safe approach
            const { ptkpTaxService } = await import('./ptkpTaxService');
            // Use Promise.race with timeout to prevent hanging
            const ptkpPromise = ptkpTaxService.getPtkpByYear(year);
            const timeoutPromise = new Promise<void>((resolve) => setTimeout(() => resolve(), 2000)); // 2s max for PTKP
            const ptkpMasterRecords = await Promise.race([ptkpPromise, timeoutPromise]) || [];
            for (const record of ptkpMasterRecords) {
                if (record.emp_code) {
                    dbPtkpMap.set(record.emp_code.trim().toUpperCase(), record.ptkp_status);
                }
            }
        } catch (e) {
            warn(CATEGORY, `⚠️ PTKP lookup failed, using default: ${e.message}`);
        }

        // Calculate final values for each employee
        // Use for...of instead of forEach for better performance
        for (let i = 0; i < employees.length; i++) {
            const emp = employees[i];
            const empCode = emp.emp_code;
            const attData = globalAttendanceMap[empCode] || { hk: 0, total_hours: 0, total_amount_rp: 0 };
            const empCuti = globalCutiMap[empCode] || { cuti_tahunan: 0, cuti_sakit_haid: 0, cuti_minggu: 0, cuti_nasional: 0 };
            const empPremi = globalPremiResult.amounts[empCode] || {};
            const empPotongan = globalPotonganResult.amounts[empCode] || {};
            const empLembur = globalLemburMap[empCode] || { jam: 0, jumlah: 0 };
            const hk = attData.hk || 0;
            const berasRate = emp.beras_rate > 0 ? emp.beras_rate : 0;
            const berasJumlah = berasRate > 0 && hk > 0 ? berasRate * hk : 0;
            const upahDasar = globalUpahPokokMap[empCode] || emp.pay_rate || 0;
            const dbJabatanJumlah = globalJabatanMap[empCode] || 0;
            const dbMasaKerjaJumlah = globalMasaKerjaMap[empCode] || 0;
            const dbPotSpsi = baselinePotSpsiByEmp[empCode] ?? Math.abs(Number(empPotongan["SPSI"]) || 0);
            const valueSyncFrame: Record<string, "red" | "green"> = { ...(emp.value_sync_frame || {}) };
            const valueSourceCompare: Record<string, { db_ptrj: number | string | boolean | null; active: number | string | boolean | null }> = {
                ...(emp.value_source_compare || {})
            };

            // [MASA_KERJA] Calculate masa kerja display from join_date
            const masaKerjaDisplay = calculateMasaKerjaDisplay(emp.join_date, month, year);
            const masaKerjaTahun = masaKerjaDisplay.years;
            emp.masa_kerja_tahun = masaKerjaTahun;
            emp.masa_kerja_display_years = masaKerjaDisplay.years;
            emp.masa_kerja_display_months = masaKerjaDisplay.months;
            emp.masa_kerja_label = masaKerjaDisplay.label;

            // Effective HK
            const effective_hk = hk - (empCuti.cuti_minggu + empCuti.cuti_nasional);
            const totalCuti = empCuti.cuti_tahunan + empCuti.cuti_sakit_haid + empCuti.cuti_minggu + empCuti.cuti_nasional;
            const hari_kerja = Math.max(0, hk - totalCuti);
            const other_cuti = empCuti.cuti_tahunan + empCuti.cuti_sakit_haid;

            const isSpsiMember = typeof emp.is_spsi_member === "boolean"
                ? emp.is_spsi_member
                : deriveInitialSpsiMember(dbPotSpsi);
            emp.is_spsi_member = isSpsiMember;
            const autoBufferVerification = payrollAutoBufferService.calculateVerificationValues({
                jabatanText: emp.jabatan_estate || emp.jabatan || "",
                roleText: emp.jabatan || emp.role || "",
                hariKerja: hari_kerja,
                masaKerjaTahun,
                isSpsiMember,
                divisionCode,
                dbJabatanJumlah,
                dbMasaKerjaJumlah,
                dbPotSpsi,
                useAutoBuffer
            });
            let jabatanJumlah = autoBufferVerification.display.jabatanAmount;
            let masaKerjaJumlah = autoBufferVerification.display.masaKerjaAmount;
            let jabatanRate = autoBufferVerification.display.jabatanRate;
            let masaKerjaRate = autoBufferVerification.display.masaKerjaRate;
            let pot_spsi = autoBufferVerification.display.spsiDeduction;
            jabatanJumlah = resolveAdjustedJabatanJumlah(emp, { month, year, divisionCode }, jabatanJumlah);
            if (jabatanJumlah === 0 && autoBufferVerification.display.jabatanAmount !== 0) {
                jabatanRate = 0;
            }
            attachPayrollPeriodAdjustmentNotes(emp, { month, year, divisionCode });
            Object.assign(valueSyncFrame, autoBufferVerification.valueSyncFrame);
            valueSourceCompare.is_spsi_member = { db_ptrj: deriveInitialSpsiMember(dbPotSpsi), active: isSpsiMember };
            Object.assign(valueSourceCompare, autoBufferVerification.valueSourceCompare);

            // Canonical totals:
            // - total_tunjangan is inclusive of lembur_jumlah
            // - derived payroll fields are produced only by PayrollCalculator
            const total_tunjangan = berasJumlah + jabatanJumlah + masaKerjaJumlah + (empLembur.jumlah || 0);
            let total_premi = 0;
            for (const [key, val] of Object.entries(empPremi)) {
                if (key !== "koreksi") total_premi += Number(val) || 0;
            }
            total_premi += (globalBrondolMap[empCode] || 0);

            // Deductions
            const pot_pph21 = Math.abs(empPotongan["PPH21"] || 0);
            const pot_premi_pph = Math.abs(empPotongan["PREMI_PPH"] || 0);
            let pot_koreksi = 0;
            let db_bpjs_kes = 0;
            let other_potongan = 0;
            for (const [key, rawVal] of Object.entries(empPotongan)) {
                const keyUpper = String(key).toUpperCase();
                const value = Math.abs(Number(rawVal) || 0);

                if (keyUpper.startsWith("KOREKSI")) {
                    pot_koreksi += value;
                    continue;
                }

                if (["SPSI", "PPH21", "PREMI_PPH"].includes(keyUpper)) {
                    continue;
                }

                if (keyUpper.includes("BPJS")) {
                    if (!keyUpper.includes("MAJIKAN") && !keyUpper.includes("MAJ")) {
                        db_bpjs_kes += value;
                    }
                    continue;
                }

                // Custom incomes are modeled via employee_other_incomes and rolled into
                // pendapatan_lainnya in Phase 4b, so skip them here to avoid double deduction.
                if (keyUpper.includes("KONTAN") || keyUpper.includes("THR") || keyUpper.includes("BONUS")) {
                    continue;
                }

                other_potongan += value;
            }

            // Calculate payroll components (match GajiPokokService formulas)
            const gaji_pokok_aktual = emp.total_amount_rp || 0; // Already set in Phase 1
            const hk_attendance = emp.jumlah_hk || 0;
            const gaji_pokok_ideal = upahDasar * hk_attendance; // upah_dasar × HK
            const koreksi_hk = gaji_pokok_aktual - gaji_pokok_ideal; // Positive = overpaid, Negative = underpaid

            // Use cached PTKP or default based on beras rate
            const statusPTKP = dbPtkpMap.get(empCode.toUpperCase()) || mapBerasRateToPTKP(berasRate);
            const kategoriTER = mapPTKPToTER(statusPTKP);
            const caruman = calculateAllCaruman(upahDasar, masaKerjaJumlah);
            const pot_astek_pekerja = caruman.astek_pekerja_jht;
            const pot_bpjs_kesehatan_pekerja = caruman.bpjs_kes_pekerja + db_bpjs_kes;
            const pot_bpjs_pensiun_pekerja = caruman.bpjs_pensiun_pekerja;
            const pot_bpjs_pekerja_total = pot_bpjs_kesehatan_pekerja + pot_bpjs_pensiun_pekerja;

            // pendapatan_lainnya is resolved in Phase 4b; use 0 for this base pass.
            const calculatorInput = {
                gaji_pokok_aktual,
                beras_jumlah: berasJumlah,
                jabatan_jumlah: jabatanJumlah,
                masa_kerja_jumlah: masaKerjaJumlah,
                lembur_jumlah: empLembur.jumlah || 0,
                total_tunjangan,
                total_premi,
                pot_koreksi,
                pendapatan_lainnya: 0,
                pot_astek_pekerja,
                pot_bpjs_kesehatan_pekerja,
                pot_bpjs_pensiun_pekerja,
                pot_spsi,
                pot_pph21,
                other_potongan,
                pot_premi_pph,
                astek_majikan: caruman.astek_majikan_jkk_jkm || 0,
                bpjs_majikan: caruman.bpjs_kes_majikan || 0
            };
            let calc = PayrollCalculator.calculate(
                calculatorInput,
                statusPTKP,
                year
            );
            const adjustedPotPph21 = shouldForcePotPph21ToTer(emp, { month, year, divisionCode })
                ? Math.abs(Number(calc.pph21_ter) || 0)
                : pot_pph21;
            if (adjustedPotPph21 !== pot_pph21) {
                calculatorInput.pot_pph21 = adjustedPotPph21;
                calc = PayrollCalculator.calculate(calculatorInput, statusPTKP, year);
            }

            // Apply final data directly to emp object
            emp.hari_kerja = hari_kerja;
            emp.beras_rate = berasRate;
            emp.beras_jumlah = berasJumlah;
            emp.jabatan_jumlah = jabatanJumlah;
            emp.masa_kerja_jumlah = masaKerjaJumlah;
            emp.jabatan_rate = jabatanRate;
            emp.masa_kerja_rate = masaKerjaRate;
            emp.total_tunjangan = total_tunjangan;
            
            // Payroll fields (match frontend columnDefs)
            emp.gaji_pokok_ideal = gaji_pokok_ideal;
            emp.gaji_pokok_aktual = gaji_pokok_aktual;
            emp.gaji_pokok = gaji_pokok_aktual; // Main alias
            emp.gaji_pokok_dibayarkan = gaji_pokok_aktual; // For PAJAK section (GP BAYAR)
            emp.koreksi_hk = koreksi_hk;
            emp.pot_koreksi = pot_koreksi; // Deduction amount (positive magnitude)
            emp.astek_084 = caruman.astek_majikan_jkk_jkm || 0; // ASTEK 0.84% untuk pajak
            
            // Total tunjangan for display
            emp.total_tunjangan_display = total_tunjangan;
            emp.upah_kotor_pajak = calc.upah_kotor_pajak;
            emp.jumlah_upah_kotor = calc.jumlah_upah_kotor;
            emp.penghasilan_bruto = calc.penghasilan_bruto;
            emp.pph21_ter = calc.pph21_ter;
            emp.tarif_pajak_ter = calc.tarif_pajak_ter;
            emp.taxable_pendapatan_lainnya = 0;
            
            // Backend field names (detailed)
            emp.pot_astek = pot_astek_pekerja;
            emp.pot_bpjs_pekerja_total = pot_bpjs_pekerja_total;
            emp.pot_spsi = pot_spsi;
            emp.pot_pph21 = adjustedPotPph21;
            emp.pot_premi_pph = pot_premi_pph; // [FIX] Add for aggregation service
            emp.total_potongan = calc.total_potongan;
            emp.total_potongan_bersih = calc.total_potongan_bersih;
            emp.upah_bersih = calc.upah_bersih;
            
            // Frontend-compatible aliases (for column rendering)
            emp.astek = pot_astek_pekerja; // ASTEK total
            emp.bpjs_kes = pot_bpjs_pekerja_total; // BPJS Kesehatan + Pensiun pekerja
            emp.spsi = pot_spsi;
            emp.pph21 = adjustedPotPph21;
            // [FIX] pph21_ter is the calculated TER tax - do NOT overwrite with pot_pph21
            // pot_pph21 could be 0 if no PPh21 transaction exists in PR_ADTRANS, but TER calculation is still valid
            
            // BPJS detail breakdown (must match frontend columnDefs exactly)
            emp.pot_astek_maj = caruman.astek_majikan_jht || 0;
            emp.pot_bpjs_kesehatan_pekerja = pot_bpjs_kesehatan_pekerja;
            emp.pot_bpjs_kesehatan_majikan = caruman.bpjs_kes_majikan || 0;
            emp.pot_bpjs_pensiun_pekerja = pot_bpjs_pensiun_pekerja;
            emp.pot_bpjs_pensiun_majikan = caruman.bpjs_pensiun_majikan || 0;
            
            // Additional aliases for flexibility
            emp.bpjs_kes_pekerja = pot_bpjs_kesehatan_pekerja;
            emp.bpjs_kes_majikan = caruman.bpjs_kes_majikan || 0;
            emp.bpjs_pensiun_pekerja = pot_bpjs_pensiun_pekerja;
            emp.bpjs_pensiun_majikan = caruman.bpjs_pensiun_majikan || 0;
            emp.astek_jht_pekerja = pot_astek_pekerja;
            emp.astek_jht_majikan = caruman.astek_majikan_jht || 0;

            emp.status_ptkp = statusPTKP;
            emp.kategori_ter = kategoriTER;
            emp.value_sync_frame = valueSyncFrame;
            emp.value_source_compare = valueSourceCompare;
            emp._phase = 4;
            emp._enriched = true;
            emp._loading = false;
        }

        // ═══════════════════════════════════════════════════════
        // PHASE 4b: Other Incomes (THR, Bonus, Custom) from extend_db_ptrj
        // NOTE: employee_other_incomes is in extend_db_ptrj, NOT db_ptrj!
        // ═══════════════════════════════════════════════════════
        try {
            // Use the CORRECT database instance for extend_db_ptrj
            const extDb = Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
            const empCodeList = employees.map(e => `'${e.emp_code}'`).join(',');
            
            // Get other incomes from extend_db_ptrj
            // IMPORTANT: THR records may have empty emp_code, so we also match by NIK
            const nikList = employees.filter(e => e.actual_nik).map(e => `'${e.actual_nik}'`).join(',');
            
            if (!empCodeList && !nikList) {
                debug(CATEGORY, `💰 Skipping other incomes lookup - no emp_codes or NIKs available`);
                return;
            }
            
            const conditions: string[] = [];
            if (empCodeList) conditions.push(`RTRIM(emp_code) IN (${empCodeList})`);
            if (nikList) conditions.push(`RTRIM(nik) IN (${nikList})`);
            
            const incomeRowsRaw = await extDb.query<any>(`
                SELECT id, RTRIM(emp_code) as emp_code, RTRIM(nik) as nik, RTRIM(ISNULL(new_nik, '')) as new_nik, RTRIM(income_type) as income_type,
                       RTRIM(income_name) as income_name, amount
                FROM dbo.employee_other_incomes
                WHERE period_month = ? AND period_year = ?
                  AND (${conditions.join(' OR ')})
                ORDER BY id
            `, [month, year]);
            const incomeRows = OtherIncomesService.deduplicateIncomeRows(incomeRowsRaw);

            debug(CATEGORY, `Found ${incomeRowsRaw?.length || 0} other income records in extend_db_ptrj, ${incomeRows?.length || 0} after latest-record dedupe`);
            
            if (incomeRows?.length === 0) {
                debug(CATEGORY, `💰 WARNING: No other incomes found for month=${month}, year=${year}. Table may be empty or emp_codes may be missing.`);
            }

            // Group by emp_code
            const incomeByEmp = new Map<string, Array<{type: string, name: string, amount: number}>>();
            let matchedByEmpCode = 0;
            let matchedByNik = 0;
            let unmatched = 0;
            
            for (const row of incomeRows) {
                let key = row.emp_code;
                let matched = false;
                
                // Try to match by emp_code first (RTRIM already done in SQL)
                if (key && key.trim()) {
                    const normalizedKey = key.trim().toUpperCase();
                    // Find employee with matching emp_code
                    const emp = employees.find(e => e.emp_code?.trim().toUpperCase() === normalizedKey);
                    if (emp) {
                        key = emp.emp_code;
                        matchedByEmpCode++;
                        matched = true;
                    }
                }
                
                // Fallback: match by NIK if emp_code didn't match
                if (!matched && row.nik && row.nik.trim()) {
                    const normalizedNik = row.nik.trim();
                    const emp = employees.find(e => e.actual_nik === normalizedNik || e.new_nik === normalizedNik);
                    if (emp) {
                        key = emp.emp_code;
                        matchedByNik++;
                        matched = true;
                    }
                }
                
                if (!matched) {
                    unmatched++;
                    console.log(`[Phase 4b] ⚠️ Unmatched income: emp_code="${row.emp_code}", nik="${row.nik}", type="${row.income_type}", amount=${row.amount}`);
                    continue;
                }

                if (!incomeByEmp.has(key)) incomeByEmp.set(key, []);
                incomeByEmp.get(key)!.push({
                    type: getCanonicalOtherIncomeType(row),
                    name: row.income_name,
                    amount: row.amount || 0
                });
            }
            
            debug(CATEGORY, `💰 Matching: ${matchedByEmpCode} by emp_code, ${matchedByNik} by NIK, ${unmatched} unmatched`);

            // Attach to employees and calculate additional income
            let totalEmployeesWithIncome = 0;
            for (const emp of employees) {
                const incomes = incomeByEmp.get(emp.emp_code) || [];
                emp.other_incomes = incomes;

                // Extract specific income types to top-level fields
                for (const inc of incomes) {
                    const fieldKey = `pendapatan_${getCanonicalOtherIncomeType(inc).toLowerCase()}`;
                    emp[fieldKey] = inc.amount;
                }

                // Calculate total_pendapatan_lainnya (THR + Bonus + Custom + KONTAN)
                const totalPendapatanLainnya = incomes.reduce((sum, inc) => sum + (inc.amount || 0), 0);
                emp.total_pendapatan_lainnya = totalPendapatanLainnya;
                emp.pendapatan_lainnya = totalPendapatanLainnya; // Alias for compatibility

                if (incomes.length > 0) {
                    totalEmployeesWithIncome++;
                    console.log(`[Phase 4b] ${emp.emp_code}: Found ${incomes.length} incomes, total=${totalPendapatanLainnya}`);
                }

                // Recalculate derived payroll fields using canonical calculator.
                // This prevents drift between progressive and non-progressive endpoints.
                const potonganMap = (emp.potongan && typeof emp.potongan === 'object')
                    ? emp.potongan
                    : {};
                const pot_pph21 = Math.abs(Number(potonganMap["PPH21"]) || 0);
                const pot_premi_pph = Math.abs(Number(potonganMap["PREMI_PPH"]) || 0);
                let pot_koreksi = 0;
                let db_bpjs_kes = 0;
                let other_potongan = 0;
                for (const [key, rawVal] of Object.entries(potonganMap)) {
                    const keyUpper = String(key).toUpperCase();
                    const value = Math.abs(Number(rawVal) || 0);

                    if (keyUpper.startsWith("KOREKSI")) {
                        pot_koreksi += value;
                        continue;
                    }
                    if (["SPSI", "PPH21", "PREMI_PPH"].includes(keyUpper)) {
                        continue;
                    }
                    if (keyUpper.includes("BPJS")) {
                        if (!keyUpper.includes("MAJIKAN") && !keyUpper.includes("MAJ")) {
                            db_bpjs_kes += value;
                        }
                        continue;
                    }
                    if (keyUpper.includes("KONTAN") || keyUpper.includes("THR") || keyUpper.includes("BONUS")) {
                        continue;
                    }
                    other_potongan += value;
                }

                const caruman = calculateAllCaruman(emp.upah_dasar || emp.pay_rate || 0, emp.masa_kerja_jumlah || 0);
                const pot_astek_pekerja = caruman.astek_pekerja_jht || 0;
                const pot_bpjs_kesehatan_pekerja = (caruman.bpjs_kes_pekerja || 0) + db_bpjs_kes;
                const pot_bpjs_pensiun_pekerja = caruman.bpjs_pensiun_pekerja || 0;
                const statusPTKP = emp.status_ptkp || dbPtkpMap.get(emp.emp_code?.toUpperCase()) || mapBerasRateToPTKP(emp.beras_rate || 0);

                const adjustedJabatanJumlah = resolveAdjustedJabatanJumlah(
                    emp,
                    { month, year, divisionCode },
                    Number(emp.jabatan_jumlah || 0)
                );
                if (adjustedJabatanJumlah !== Number(emp.jabatan_jumlah || 0)) {
                    emp.jabatan_jumlah = adjustedJabatanJumlah;
                    emp.jabatan_rate = 0;
                    emp.total_tunjangan = Number(emp.beras_jumlah || 0)
                        + adjustedJabatanJumlah
                        + Number(emp.masa_kerja_jumlah || 0)
                        + Number(emp.lembur_jumlah || 0);
                }
                attachPayrollPeriodAdjustmentNotes(emp, { month, year, divisionCode });

                const calculatorInput = {
                    gaji_pokok_aktual: Number(emp.gaji_pokok_aktual || emp.gaji_pokok || emp.total_amount_rp || 0),
                    beras_jumlah: Number(emp.beras_jumlah || 0),
                    jabatan_jumlah: adjustedJabatanJumlah,
                    masa_kerja_jumlah: Number(emp.masa_kerja_jumlah || 0),
                    lembur_jumlah: Number(emp.lembur_jumlah || 0),
                    total_tunjangan: Number(emp.total_tunjangan || 0),
                    total_premi: Number(emp.total_premi || 0),
                    pot_koreksi,
                    pendapatan_lainnya: totalPendapatanLainnya,
                    pot_astek_pekerja,
                    pot_bpjs_kesehatan_pekerja,
                    pot_bpjs_pensiun_pekerja,
                    pot_spsi: Number(emp.pot_spsi || 0),
                    pot_pph21,
                    other_potongan,
                    pot_premi_pph,
                    astek_majikan: caruman.astek_majikan_jkk_jkm || 0,
                    bpjs_majikan: caruman.bpjs_kes_majikan || 0
                };
                let calc = PayrollCalculator.calculate(
                    calculatorInput,
                    statusPTKP,
                    year
                );
                const adjustedPotPph21 = shouldForcePotPph21ToTer(emp, { month, year, divisionCode })
                    ? Math.abs(Number(calc.pph21_ter) || 0)
                    : pot_pph21;
                if (adjustedPotPph21 !== pot_pph21) {
                    calculatorInput.pot_pph21 = adjustedPotPph21;
                    calc = PayrollCalculator.calculate(calculatorInput, statusPTKP, year);
                }

                emp.pot_koreksi = pot_koreksi;
                emp.pot_pph21 = adjustedPotPph21;
                emp.pph21 = adjustedPotPph21;
                emp.pot_premi_pph = pot_premi_pph;
                emp.pot_astek = pot_astek_pekerja;
                emp.pot_bpjs_kesehatan_pekerja = pot_bpjs_kesehatan_pekerja;
                emp.pot_bpjs_pensiun_pekerja = pot_bpjs_pensiun_pekerja;
                emp.pot_bpjs_pekerja_total = pot_bpjs_kesehatan_pekerja + pot_bpjs_pensiun_pekerja;

                emp.jumlah_upah_kotor = calc.jumlah_upah_kotor;
                // [FIX] Add upah_kotor separately - base gross without koreksi for correct tax/export
                emp.upah_kotor = calc.upah_kotor;
                emp.upah_kotor_pajak = calc.upah_kotor_pajak;
                emp.penghasilan_bruto = calc.penghasilan_bruto;
                emp.pph21_ter = calc.pph21_ter;
                emp.tarif_pajak_ter = calc.tarif_pajak_ter;
                emp.total_potongan = calc.total_potongan;
                emp.total_potongan_bersih = calc.total_potongan_bersih;
                emp.upah_bersih = calc.upah_bersih;
                emp.taxable_pendapatan_lainnya = totalPendapatanLainnya;
            }
            debug(CATEGORY, `💰 Other incomes: ${totalEmployeesWithIncome}/${employees.length} employees with income`);
            debug(CATEGORY, `💰 Other incomes attached to ${incomeByEmp.size} employees`);
        } catch (e) {
            debug(CATEGORY, `⚠️ Other income lookup skipped: ${e.message}`);
        }

        // Filter & sort employees
        const filteredEmployees = [];
        let filteredOutCount = 0;
        for (const emp of employees) {
            const effective_hk = (emp.jumlah_hk || 0) - ((emp.cuti_minggu_hari || 0) + (emp.cuti_nasional_hari || 0));
            const totalCuti = (emp.cuti_tahunan_hari || 0) + (emp.cuti_sakit_haid_hari || 0) + (emp.cuti_minggu_hari || 0) + (emp.cuti_nasional_hari || 0);
            const hari_kerja = Math.max(0, (emp.jumlah_hk || 0) - totalCuti);
            const other_cuti = (emp.cuti_tahunan_hari || 0) + (emp.cuti_sakit_haid_hari || 0);

            if (shouldKeepPayrollRowAfterEffectiveHkFilter({
                jumlahHk: emp.jumlah_hk,
                cutiMingguHari: emp.cuti_minggu_hari,
                cutiNasionalHari: emp.cuti_nasional_hari,
                hasManualAdjustments: Number((emp as any)._manualAdjustmentCount || 0) > 0
            })) {
                filteredEmployees.push(emp);
            } else {
                filteredOutCount++;
            }
        }

        debug(CATEGORY, `📊 Filter result: ${filteredEmployees.length} kept, ${filteredOutCount} filtered out (effective_hk = 0)`);

        // Sort by emp_code (default sort)
        filteredEmployees.sort((a, b) => (a?.emp_code || '').localeCompare(b?.emp_code || ''));

        // Flatten nested premi/potongan objects to top-level fields for frontend compatibility
        for (const emp of filteredEmployees) {
            if (emp.premi && typeof emp.premi === 'object') {
                for (const [key, val] of Object.entries(emp.premi)) {
                    if (key !== 'brondol' && key !== 'koreksi') {
                        const fieldName = key.startsWith('premi_') ? key : `premi_${key}`;
                        emp[fieldName] = val;
                    }
                }
            }
            if (emp.potongan && typeof emp.potongan === 'object') {
                for (const [key, val] of Object.entries(emp.potongan)) {
                    // KOREKSI fields: keep as-is (KOREKSI_1, KOREKSI_2)
                    // Others: add potongan_ prefix
                    let fieldName;
                    const keyUpper = String(key).toUpperCase();
                    if (keyUpper.startsWith('KOREKSI')) {
                        fieldName = key; // KOREKSI_1, KOREKSI_2, etc.
                    } else if (keyUpper.startsWith('POTONGAN_')) {
                        fieldName = key;
                    } else {
                        fieldName = `potongan_${key}`;
                    }
                    emp[fieldName] = val;
                }
            }
            // Calculate total potongan upah kotor (sum of all KOREKSI)
            let totalKoreksi = 0;
            for (const [key, val] of Object.entries(emp)) {
                if (String(key).toUpperCase().startsWith('KOREKSI') && typeof val === 'number') {
                    totalKoreksi += Math.abs(val);
                }
            }
            emp.potongan_upah_kotor_total = totalKoreksi;
        }

        // Rebuild gangsMap with filtered & sorted data
        gangsMap.clear();
        for (const emp of filteredEmployees) {
            // Safety check: ensure employee has name (could be emp_name or nama)
            const empNama = emp.nama || emp.emp_name;
            if (!emp || !empNama) continue;
            const gang = emp.gang_code || "UNKNOWN";
            if (!gangsMap.has(gang)) gangsMap.set(gang, []);
            
            // Ensure nama field exists for frontend compatibility
            if (!emp.nama) emp.nama = emp.emp_name;
            
            gangsMap.get(gang)!.push(emp);
        }

        const totalTime = Date.now() - startTime;
        const totalEmployees = Array.from(gangsMap.values()).reduce((sum, arr) => sum + arr.length, 0);

        debug(CATEGORY, `✅ Phase 4 (final): ${Date.now() - t4}ms | Total: ${totalTime}ms for ${totalEmployees} employees`);

        yield {
            phase: 'complete',
            gangs: new Map(gangsMap),
            meta: {
                total_gangs: gangsMap.size,
                total_employees: totalEmployees,
                processed_employees: totalEmployees,
                progress_pct: 100,
                message: `✅ Complete! ${totalEmployees} employees in ${(totalTime / 1000).toFixed(1)}s`
            },
            dynamic_premi_headers: Array.from(dynamicPremiSet),
            dynamic_potongan_headers: Array.from(dynamicPotonganSet),
            dynamic_premi_titles: globalPremiResult.titleMap,
            dynamic_potongan_titles: globalPotonganResult.titleMap
        };
    }
}

export const dataExtractorService = DataExtractorService.getInstance();

