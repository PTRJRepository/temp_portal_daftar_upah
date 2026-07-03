import { Database } from "../db/client";
import { employeeIdentityResolverService } from "./employeeIdentityResolverService";
import { Config } from "../config";
import { divisionConfigService } from "./config/DivisionConfigService";
import { taskCodeOptionService, type TaskCodeOption } from "./taskCodeOptionService";
import { premiumDefinitionService } from "./premiumDefinitionService";
import { EmployeeEstateService } from "./employeeEstateService";
import {
    normalizeManualAdjustmentDivisionCode,
    normalizeStoredAdjustmentName,
    shouldDeleteStoredAdjustment
} from "./payroll/manualAdjustments/manualAdjustmentNaming";
import {
    containsPphDeductionText,
    resolvePotonganBersihHutangTaskCode
} from "./payroll/manualAdjustments/potonganBersihTaskCode";
import { normalizeAutoBufferAdjustmentName } from "./payroll/manualAdjustments/autoBufferAdcodeMap";
import {
    inferManualAdjustmentAdCodeFromRemarks,
    parsePipeDelimitedRemarks,
    updatePipeDelimitedSyncAndMatchStatus,
    updatePipeDelimitedSyncStatus
} from "../utils/manualAdjustmentRemarkParser";
import {
    buildAdtransDocDescSqlCondition,
    buildAdtransDocDescSqlPatterns,
    matchesAdtransDocDescFilter,
    normalizeAdtransFilter,
    normalizeAdtransPotonganField,
    mapAdtransPremiField
} from "./payroll/adtransDocDescMapping";

function buildNormalizedSqlNameExpression(columnName: string): string {
    let expression = `UPPER(LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(REPLACE(${columnName}, CHAR(9), ' '), CHAR(10), ' '), CHAR(13), ' '), CHAR(160), ' '))))`;

    for (let i = 0; i < 4; i += 1) {
        expression = `REPLACE(${expression}, '  ', ' ')`;
    }

    return expression;
}

export interface AdtransDuplicateSourceRow {
    id: number;
    doc_id: string;
    doc_date: string;
    doc_desc: string;
    emp_code: string;
    emp_name: string;
    amount: number;
}

type AdtransDocDescDetail = {
    doc_desc: string;
    doc_id: string | null;
    amount: number;
};

type ManualAdjustmentSyncAdtransDetail = AdtransDocDescDetail & {
    emp_code: string;
};

type AdtransDocDescDetailWithCategory = ManualAdjustmentSyncAdtransDetail & {
    category: string;
};

export interface AdtransCheckOptions {
    adjustmentTypes?: string[];
    adjustmentNames?: string[];
    docDescs?: string[];
}

export interface AdtransDocIdLookupInput extends AdtransCheckOptions {
    periodMonth: number;
    periodYear: number;
    empCodes?: string[];
    filters?: string[];
    divisionCode?: string;
    gangCode?: string;
}

type NormalizedAdtransCheckOptions = {
    adjustmentTypes: string[];
    adjustmentNames: string[];
    docDescs: string[];
    docDescFilters: string[];
};

export interface AdtransComparisonItem {
    emp_code: string;
    stored_emp_identifier?: string | null;
    category: string;
    adjustment_name: string;
    source_amount: number;
    stored_amount: number | null;
    db_ptrj_amount?: number;
    extend_db_ptrj_amount?: number | null;
    diff: number | null;
    status: 'MATCH' | 'MISMATCH' | 'MISSING';
    db_ptrj_doc_desc_details?: AdtransDocDescDetail[];
    extend_db_ptrj_remarks?: string | null;
    gang_code: string | null;
    remarks: string | null;
}

export interface ReverseAdtransComparisonItem {
    emp_code: string;
    stored_emp_identifier: string | null;
    category: string;
    adjustment_name: string;
    stored_amount: number;
    source_amount: number;
    db_ptrj_amount?: number;
    extend_db_ptrj_amount?: number;
    diff: number;
    status: 'MATCH' | 'MISMATCH' | 'EXTRA_IN_ADJUSTMENTS';
    db_ptrj_doc_desc_details?: AdtransDocDescDetail[];
    extend_db_ptrj_remarks?: string | null;
    gang_code: string | null;
    division_code: string | null;
    remarks: string | null;
}

function matchesAdtransFilter(docDesc: string, filter: string): boolean {
    return matchesAdtransDocDescFilter(docDesc, filter);
}

function normalizeAdtransDivisionLocCode(divisionCode: string): string {
    const normalized = divisionCode.trim().toUpperCase();
    const locCodeMap: Record<string, string> = {
        PG1A: 'P1A',
        PG1B: 'P1B',
        PG2A: 'P2A',
        PG2B: 'P2B',
        ARB1: 'AB1',
        ARB2: 'AB2',
        AREC: 'ARC',
        PLASMA1A: 'P1A',
        PLASMA1B: 'P1B',
        PLASMA2A: 'P2A',
        PLASMA2B: 'P2B',
        '1A': 'P1A',
        '1B': 'P1B',
        '2A': 'P2A',
        '2B': 'P2B'
    };

    return locCodeMap[normalized] || normalized;
}

/**
 * Resolve a division code (real or virtual) to the LocCode used in PR_ADTRANS.
 * Virtual divisions (e.g. NRS, INF, WKS_AR) have a sourceDivision (e.g. PG1B, PG1A, AB2)
 * that maps to the actual LocCode in db_ptrj.
 */
function resolveAdtransLocCode(divisionCode: string): string {
    const resolved = divisionCode.trim().toUpperCase();
    const sourceDivision = divisionConfigService.getSourceDivision(resolved);
    if (sourceDivision) {
        return normalizeAdtransDivisionLocCode(sourceDivision);
    }
    return normalizeAdtransDivisionLocCode(resolved);
}

function getManualAdjustmentDivisionCodeVariants(divisionCode: string): string[] {
    const normalized = normalizeManualAdjustmentDivisionCode(divisionCode) || normalizeText(divisionCode).toUpperCase();
    if (!normalized) return [];

    const codeGroups = [
        { match: ['1A', 'P1A', 'PG1A'], query: ['P1A', 'PG1A'] },
        { match: ['1B', 'P1B', 'PG1B'], query: ['P1B', 'PG1B'] },
        { match: ['2A', 'P2A', 'PG2A'], query: ['P2A', 'PG2A'] },
        { match: ['2B', 'P2B', 'PG2B'], query: ['P2B', 'PG2B'] },
        { match: ['AB1', 'ARB1'], query: ['AB1', 'ARB1'] },
        { match: ['AB2', 'ARB2'], query: ['AB2', 'ARB2'] },
        { match: ['ARC', 'AREC'], query: ['ARC', 'AREC'] }
    ];

    const matchedGroup = codeGroups.find((group) => group.match.includes(normalized));
    return matchedGroup ? [...matchedGroup.query] : [normalized];
}

function buildAdtransSqlPatterns(filter: string): string[] {
    return buildAdtransDocDescSqlPatterns(filter);
}

function buildAdtransSqlPattern(filter: string): string {
    return buildAdtransSqlPatterns(filter)[0];
}

function buildAdtransSqlCondition(columnName: string, filter: string): string {
    return buildAdtransDocDescSqlCondition(columnName, filter);
}

const DEFAULT_ADTRANS_COMPARE_FILTERS = ['spsi', 'masa kerja', 'jabatan', 'pph', 'premi', 'koreksi', 'potongan'];
const KOREKSI_PREFIX = "KOREKSI";
const KOREKSI_DEFAULT_AD_CODE = "DE0004";
const KOREKSI_DEFAULT_TASK_DESC = "(DE) POTONGAN PREMI";

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function isKoreksiManualAdjustment(row: Pick<ManualAdjustment, "adjustment_type" | "adjustment_name">): boolean {
    const adjustmentType = normalizeText(row.adjustment_type).toUpperCase();
    const adjustmentName = normalizeText(row.adjustment_name).toUpperCase();
    return adjustmentType === "POTONGAN_KOTOR" || adjustmentName.includes(KOREKSI_PREFIX);
}

function resolveKoreksiManualAdjustmentAdCodeFields(): { ad_code: string; ad_code_desc: string; ad_desc: string; task_desc: string } {
    return {
        ad_code: KOREKSI_DEFAULT_AD_CODE,
        ad_code_desc: KOREKSI_DEFAULT_TASK_DESC,
        ad_desc: KOREKSI_DEFAULT_TASK_DESC,
        task_desc: KOREKSI_DEFAULT_TASK_DESC
    };
}

function normalizeAdtransDuplicateDocDesc(value: unknown): string {
    return normalizeText(value).toUpperCase().replace(/\s+/g, " ");
}

function normalizeAdtransDuplicateAmount(value: unknown): string {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function hasAdtransDuplicateAmount(value: unknown): boolean {
    const amount = Number(value || 0);
    return Number.isFinite(amount) && Math.abs(amount) > 0.01;
}

function normalizeStringList(values?: unknown): string[] {
    const rawValues = Array.isArray(values) ? values : values == null ? [] : [values];
    return rawValues
        .flatMap((value) => String(value || "").split(","))
        .map((value) => normalizeText(value))
        .filter(Boolean);
}

function normalizeAdtransCheckOptions(options?: AdtransCheckOptions): NormalizedAdtransCheckOptions {
    const adjustmentTypes = normalizeStringList(options?.adjustmentTypes).map((value) => value.toUpperCase());
    const adjustmentNames = normalizeStringList(options?.adjustmentNames);
    const docDescs = normalizeStringList(options?.docDescs);
    const docDescFilters = Array.from(new Set([...adjustmentNames, ...docDescs].map(normalizeAdtransDuplicateDocDesc).filter(Boolean)));

    return {
        adjustmentTypes,
        adjustmentNames,
        docDescs,
        docDescFilters
    };
}

function mapAdjustmentTypeToAdtransFilters(adjustmentType: string): string[] {
    const normalized = normalizeText(adjustmentType).toUpperCase();
    const aliases: Record<string, string[]> = {
        PREMI: ["premi"],
        KOREKSI: ["koreksi"],
        POTONGAN_KOTOR: ["koreksi"],
        POTONGAN_UPAH_KOTOR: ["koreksi"],
        POTONGAN_BERSIH: ["potongan"],
        POTONGAN_UPAH_BERSIH: ["potongan"],
        SPSI: ["spsi"],
        AUTO_SPSI: ["spsi"],
        JABATAN: ["jabatan"],
        AUTO_JABATAN: ["jabatan"],
        AUTO_TUNJANGAN_JABATAN: ["jabatan"],
        MASA_KERJA: ["masa kerja"],
        AUTO_MASA_KERJA: ["masa kerja"]
    };

    return aliases[normalized] || (normalized ? [normalizeAdtransFilter(normalized)] : []);
}

function inferAdtransFiltersFromDocDescFilters(docDescFilters: string[]): string[] {
    const filters: string[] = [];

    for (const docDesc of docDescFilters) {
        if (/^PREMI(\s|$)/.test(docDesc)) filters.push("premi");
        else if (docDesc.includes("KOREKSI")) filters.push("koreksi");
        else if (/^POT(\s|ONGAN|\b)/.test(docDesc)) filters.push("potongan");
        else if (docDesc.includes("SPSI")) filters.push("spsi");
        else if (docDesc.includes("JABATAN")) filters.push("jabatan");
        else if (docDesc.includes("MASA") && docDesc.includes("KERJA")) filters.push("masa kerja");
    }

    return Array.from(new Set(filters));
}

function resolveAdtransCheckFilters(filters: string[] = [], options?: NormalizedAdtransCheckOptions): string[] {
    const fromFilters = normalizeStringList(filters).map(normalizeAdtransFilter).filter(Boolean);
    const fromTypes = (options?.adjustmentTypes || []).flatMap(mapAdjustmentTypeToAdtransFilters).map(normalizeAdtransFilter).filter(Boolean);
    const fromDocDesc = inferAdtransFiltersFromDocDescFilters(options?.docDescFilters || []);
    const resolved = fromFilters.length ? fromFilters : [...fromTypes, ...fromDocDesc];

    return Array.from(new Set(resolved));
}

function buildSpecificDocDescSqlPatterns(options: NormalizedAdtransCheckOptions): string[] {
    return options.docDescFilters.map((value) => `%${value}%`);
}

function matchesSpecificAdtransDocDesc(docDesc: string, options?: NormalizedAdtransCheckOptions): boolean {
    const filters = options?.docDescFilters || [];
    if (filters.length === 0) return true;

    const normalizedDocDesc = normalizeAdtransDuplicateDocDesc(docDesc);
    return filters.some((filter) => normalizedDocDesc.includes(filter));
}

function matchesAdtransDuplicateFilter(docDesc: string, filter: string): boolean {
    const category = normalizeAdtransFilter(filter);
    const normalizedDocDesc = normalizeAdtransDuplicateDocDesc(docDesc);

    if (category === "premi") {
        return /^PREMI(\s|$)/.test(normalizedDocDesc);
    }

    return matchesAdtransFilter(docDesc, filter);
}

function buildAdtransDocDescDetails(
    rows: AdtransDuplicateSourceRow[],
    filters: string[],
    options?: NormalizedAdtransCheckOptions
): AdtransDocDescDetailWithCategory[] {
    const details: AdtransDocDescDetailWithCategory[] = [];

    for (const row of rows) {
        for (const filter of filters) {
            if (!matchesAdtransFilter(row.doc_desc || '', filter)) continue;
            if (!matchesSpecificAdtransDocDesc(row.doc_desc || '', options)) continue;

            details.push({
                emp_code: normalizeIdentityValue(row.emp_code),
                category: normalizeAdtransFilter(filter),
                doc_desc: normalizeText(row.doc_desc),
                doc_id: row.doc_id ? normalizeText(row.doc_id) : null,
                amount: Number(row.amount || 0)
            });
        }
    }

    return details;
}

function removeLeadingWordPrefix(value: unknown, prefix: string): string {
    return normalizeText(value).replace(new RegExp(`^${prefix}\\s*`, "i"), "").trim();
}

function shouldUseHutangTaskCodeForPotonganBersih(data: ManualAdjustment, adjustmentName?: string): boolean {
    const type = normalizeText(data.adjustment_type).toUpperCase();
    if (type !== "POTONGAN_BERSIH") return false;

    return !containsPphDeductionText([
        adjustmentName || data.adjustment_name,
        data.ad_code,
        data.task_code,
        data.base_task_code,
        data.task_desc,
        data.remarks
    ].join(" "));
}

function buildPotonganBersihHutangAdCodePart(mapping: ReturnType<typeof resolvePotonganBersihHutangTaskCode>): string {
    return `${mapping.ad_code} - ${mapping.task_desc}`;
}

function normalizePotonganBersihHutangRemarks(
    remarks: ManualAdjustment["remarks"],
    mapping: ReturnType<typeof resolvePotonganBersihHutangTaskCode>
): ManualAdjustment["remarks"] {
    const text = normalizeText(remarks);
    if (!text || !text.includes("|")) return remarks;

    const segments = text.split("|").map((segment) => segment.trim());
    if (segments.length < 2) return remarks;

    segments[1] = buildPotonganBersihHutangAdCodePart(mapping);
    return segments.join(" | ");
}

function normalizeManualAdjustmentForSave(data: ManualAdjustment): ManualAdjustment {
    const type = normalizeText(data.adjustment_type).toUpperCase();
    if (type === "POTONGAN_KOTOR") {
        const suffix = removeLeadingWordPrefix(data.adjustment_name, KOREKSI_PREFIX);
        const adjustmentName = `${KOREKSI_PREFIX}${suffix ? ` ${suffix}` : ""}`.trim();

        return {
            ...data,
            adjustment_name: adjustmentName,
            ad_code: KOREKSI_DEFAULT_AD_CODE,
            task_code: KOREKSI_DEFAULT_AD_CODE,
            base_task_code: KOREKSI_DEFAULT_AD_CODE,
            task_desc: KOREKSI_DEFAULT_TASK_DESC
        };
    }

    if (shouldUseHutangTaskCodeForPotonganBersih(data)) {
        const mapping = resolvePotonganBersihHutangTaskCode(data.division_code);
        return {
            ...data,
            ad_code: mapping.ad_code,
            task_code: mapping.task_code,
            base_task_code: mapping.base_task_code,
            task_desc: mapping.task_desc,
            remarks: normalizePotonganBersihHutangRemarks(data.remarks, mapping)
        };
    }

    return data;
}

function resolveManualAdjustmentAdCode(data: Pick<ManualAdjustment, 'ad_code' | 'base_task_code' | 'task_code'>): string {
    return normalizeText(data.ad_code || data.base_task_code || data.task_code).toUpperCase();
}

function normalizeManualAdjustmentPresetCode(value: unknown): string {
    const normalized = normalizeText(value).toUpperCase();
    if (!normalized) return "";

    const parenthesizedCode = normalized.match(/^\(([A-Z]{2}\d[A-Z0-9_-]*)\)/);
    if (parenthesizedCode?.[1]?.length <= 50) return parenthesizedCode[1];

    if (normalized.length <= 50 && /^[A-Z]{2}\d[A-Z0-9_-]*$/.test(normalized)) {
        return normalized;
    }

    return "";
}

function resolveManualAdjustmentPresetCode(data: Pick<ManualAdjustment, 'ad_code' | 'base_task_code' | 'task_code'>): string {
    return normalizeManualAdjustmentPresetCode(data.ad_code)
        || normalizeManualAdjustmentPresetCode(data.base_task_code)
        || normalizeManualAdjustmentPresetCode(data.task_code);
}

export function manualAdjustmentRequiresAdCode(adjustmentType: string): boolean {
    return normalizeText(adjustmentType).toUpperCase() !== 'AUTO_BUFFER';
}

function isPipeDelimitedRemarks(remarks: string): boolean {
    return remarks.includes('|') && /\|\s*-?\d+\s*\|\s*sync:/i.test(remarks);
}

export function buildManualAdjustmentRemarks(data: ManualAdjustment): string | null {
    const existingRemarks = normalizeText(data.remarks);
    const adCode = resolveManualAdjustmentAdCode(data);
    const taskDesc = normalizeText(data.task_desc);

    // If remarks is already in pipe-delimited preset format, preserve it as-is
    if (existingRemarks && isPipeDelimitedRemarks(existingRemarks)) {
        return existingRemarks;
    }

    if (!adCode) {
        return existingRemarks || null;
    }

    const adCodeRemark = `AD CODE: ${adCode}${taskDesc ? ` - ${taskDesc}` : ''}`;
    if (!existingRemarks) return adCodeRemark;
    if (existingRemarks.toUpperCase().includes('AD CODE:') || existingRemarks.toUpperCase().includes('SYNC:')) return existingRemarks;

    return `${adCodeRemark}; ${existingRemarks}`;
}

function validateManualAdjustmentAdCode(data: ManualAdjustment): void {
    if (!manualAdjustmentRequiresAdCode(data.adjustment_type)) return;

    const remarks = normalizeText(data.remarks).toUpperCase();
    const isManualColumnRequest = remarks.includes('INIT_COLUMN') || remarks.includes('AD CODE:');
    if (!isManualColumnRequest) return;
    if (resolveManualAdjustmentAdCode(data)) return;

    throw new Error('ADCode wajib diisi untuk kolom manual adjustment selain auto buffer');
}

function validatePremiumAdjustmentDefinition(data: ManualAdjustment, normalizedAdjustmentName: string): void {
    if (String(data.adjustment_type || '').trim().toUpperCase() !== 'PREMI') return;
    premiumDefinitionService.validatePremiumName(normalizedAdjustmentName);
}

function serializeManualAdjustmentMetadata(metadataJson: unknown): string | null {
    if (!metadataJson) return null;
    return typeof metadataJson === "string" ? metadataJson : JSON.stringify(metadataJson);
}

function calculateManualAdjustmentMetadataTotal(metadata: any): number {
    switch (metadata?.input_type) {
        case "blok":
            return (metadata.items || []).reduce((sum, item) => sum + (Number(item?.jumlah) || 0), 0);
        case "exp":
            return Number(metadata.jumlah) || 0;
        case "kendaraan":
            return (metadata.items || []).reduce((sum, item) => sum + (Number(item?.jumlah) || 0), 0);
        case "blok,exp":
            return (metadata.blok_items || []).reduce((sum, item) => sum + (Number(item?.jumlah) || 0), 0)
                 + (Number(metadata.expense?.jumlah) || 0);
        default:
            return 0;
    }
}

function resolveDetailTotalSync(data: ManualAdjustment, normalizedAdjustmentName: string, metadataJsonStr: string | null, fallbackAmount: number): { amount: number; metadataJsonStr: string | null } {
    // Only PREMI type adjustments have structured metadata
    if (String(data.adjustment_type || "").trim().toUpperCase() !== "PREMI") {
        return { amount: fallbackAmount, metadataJsonStr };
    }

    const metadata = premiumDefinitionService.parseMetadata(metadataJsonStr);
    // No metadata or plain amount type — nothing to sync
    if (!metadata || metadata.input_type === "amount") {
        return { amount: fallbackAmount, metadataJsonStr };
    }

    // Sync amount for ALL detail input types (blok, exp, kendaraan, blok,exp)
    // NOT limited to specific premium names — source of truth is metadata items
    const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);

    // Use calculated total if finite; otherwise fall back to declared total_amount
    let syncedAmount: number;
    if (Number.isFinite(calculatedTotal)) {
        syncedAmount = calculatedTotal;
    } else {
        const declaredTotal = Number((metadata as any).total_amount);
        syncedAmount = Number.isFinite(declaredTotal) ? declaredTotal : fallbackAmount;
    }

    // Always inject the synced total_amount into metadata_json so DB stays consistent
    return {
        amount: syncedAmount,
        metadataJsonStr: JSON.stringify({ ...(metadata as any), total_amount: syncedAmount })
    };
}

/**
 * Build placeholder metadata for seed action (source amount → target structured type).
 * Single-item with jumlah = oldTotal, structure per target input_type.
 */
function seedPlaceholderMetadata(
    targetInputType: string,
    total: number,
    row: Pick<ManualAdjustment, "gang_code">
): Record<string, unknown> | null {
    const gangCode = normalizeText(row.gang_code);
    switch (targetInputType) {
        case "blok":
            return { input_type: "blok", items: [{ subblok: "", gang_code: gangCode, jumlah: total }], total_amount: total };
        case "kendaraan":
            return { input_type: "kendaraan", items: [{ nomor_kendaraan: "", expense_code: "DRIVER", jumlah: total }], total_amount: total };
        case "exp":
            return { input_type: "exp", expense_code: "", jumlah: total, total_amount: total };
        case "blok,exp":
            return { input_type: "blok,exp", blok_items: [{ subblok: "", gang_code: gangCode, jumlah: total }], expense: { expense_code: "", jumlah: 0 }, total_amount: total };
        default:
            return null;
    }
}

/**
 * Remap metadata between compatible (non-blocked) input_types.
 * BLOCKED pairs (blok↔kendaraan, blok,exp→kendaraan) never reach here — validation gate rejects them.
 * Best-effort structural re-map; semantic fields (subblok vs nomor_kendaraan) only mapped within allowed paths.
 */
function remapMetadata(
    oldMetadata: any,
    fromInputType: string,
    toInputType: string,
    row: Pick<ManualAdjustment, "gang_code">,
    fallbackTotal: number
): Record<string, unknown> | null {
    if (!oldMetadata) {
        return seedPlaceholderMetadata(toInputType, fallbackTotal, row);
    }

    const gangCode = normalizeText(row.gang_code);
    const oldItems: any[] = Array.isArray(oldMetadata.items) ? oldMetadata.items : [];
    const oldBlokItems: any[] = Array.isArray(oldMetadata.blok_items) ? oldMetadata.blok_items : [];
    const oldExpense = oldMetadata.expense && typeof oldMetadata.expense === "object" ? oldMetadata.expense : null;
    const oldExpenseCode = normalizeText(oldExpense?.expense_code || oldMetadata.expense_code);

    switch (toInputType) {
        case "blok": {
            // Allowed from: blok, blok,exp, exp, amount. NOT from kendaraan (blocked).
            let items: any[];
            if (fromInputType === "blok") {
                items = oldItems;
            } else if (fromInputType === "blok,exp") {
                items = oldBlokItems;
            } else if (fromInputType === "exp") {
                items = [{ subblok: "", gang_code: gangCode, jumlah: toNumericAmount(oldExpense?.jumlah) || fallbackTotal }];
            } else {
                items = [{ subblok: "", gang_code: gangCode, jumlah: fallbackTotal }];
            }
            return { input_type: "blok", items, total_amount: items.reduce((s, i) => s + toNumericAmount(i.jumlah), 0) };
        }
        case "exp": {
            // Allowed from any. Use expense_code if present, else from items first.
            const jumlah = oldExpense
                ? toNumericAmount(oldExpense.jumlah)
                : oldItems.reduce((s, i) => s + toNumericAmount(i?.jumlah), 0) || fallbackTotal;
            return { input_type: "exp", expense_code: oldExpenseCode, jumlah, total_amount: jumlah };
        }
        case "kendaraan": {
            // Allowed from: kendaraan, exp, amount. NOT from blok/blok,exp (blocked).
            let items: any[];
            if (fromInputType === "kendaraan") {
                items = oldItems;
            } else if (fromInputType === "exp") {
                items = [{ nomor_kendaraan: "", expense_code: oldExpenseCode || "DRIVER", jumlah: toNumericAmount(oldExpense?.jumlah) || fallbackTotal }];
            } else {
                items = [{ nomor_kendaraan: "", expense_code: "DRIVER", jumlah: fallbackTotal }];
            }
            return { input_type: "kendaraan", items, total_amount: items.reduce((s, i) => s + toNumericAmount(i.jumlah), 0) };
        }
        case "blok,exp": {
            // Allowed from: blok, blok,exp, exp, amount. NOT from kendaraan (blocked).
            let blokItems: any[];
            if (fromInputType === "blok") {
                blokItems = oldItems;
            } else if (fromInputType === "blok,exp") {
                blokItems = oldBlokItems;
            } else if (fromInputType === "exp") {
                blokItems = [{ subblok: "", gang_code: gangCode, jumlah: toNumericAmount(oldExpense?.jumlah) || fallbackTotal }];
            } else {
                blokItems = [{ subblok: "", gang_code: gangCode, jumlah: fallbackTotal }];
            }
            const expense = { expense_code: oldExpenseCode, jumlah: 0 };
            return { input_type: "blok,exp", blok_items: blokItems, expense, total_amount: blokItems.reduce((s, i) => s + toNumericAmount(i.jumlah), 0) };
        }
        default:
            return null;
    }
}

function expectedTaskDescPrefix(adjustmentType: string): "(AL)" | "(DE)" | null {
    const type = normalizeText(adjustmentType).toUpperCase();
    if (type === "PREMI") return "(AL)";
    if (type === "POTONGAN_KOTOR" || type === "POTONGAN_BERSIH") return "(DE)";
    return null;
}

function normalizeSearchWords(value: unknown): string[] {
    return normalizeText(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .split(" ")
        .filter((word) => word.length >= 3 && !["PREMI", "POTONGAN", "KOREKSI", "MANUAL", "EDIT", "SYNC", "MATCH"].includes(word));
}

function scoreTaskCodeOption(option: TaskCodeOption, searchWords: string[]): number {
    const haystack = `${option.task_desc} ${option.ad_code} ${option.task_code} ${option.base_task_code || ""}`.toUpperCase();
    return searchWords.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

export async function resolveManualAdjustmentPresetMapping(data: ManualAdjustment, adjustmentName: string): Promise<Partial<ManualAdjustment>> {
    const adjustmentType = normalizeText(data.adjustment_type).toUpperCase();
    if (adjustmentType === "POTONGAN_KOTOR") {
        return {
            ad_code: KOREKSI_DEFAULT_AD_CODE,
            task_code: KOREKSI_DEFAULT_AD_CODE,
            base_task_code: KOREKSI_DEFAULT_AD_CODE,
            task_desc: KOREKSI_DEFAULT_TASK_DESC
        };
    }

    if (shouldUseHutangTaskCodeForPotonganBersih(data, adjustmentName)) {
        return resolvePotonganBersihHutangTaskCode(data.division_code);
    }

    if (resolveManualAdjustmentPresetCode(data)) return {};

    const prefix = expectedTaskDescPrefix(data.adjustment_type);
    if (!prefix) return {};

    const searchWords = normalizeSearchWords(`${adjustmentName} ${data.remarks || ""}`);
    let options = await taskCodeOptionService.searchOptions({
        search: searchWords[0] || undefined,
        divisionCode: data.division_code,
        limit: 100
    });
    let matchingOptions = options.filter((option) => normalizeText(option.task_desc).toUpperCase().startsWith(prefix));
    if (!matchingOptions.length) {
        options = await taskCodeOptionService.searchOptions({
            divisionCode: data.division_code,
            limit: 100
        });
        matchingOptions = options.filter((option) => normalizeText(option.task_desc).toUpperCase().startsWith(prefix));
    }
    const candidates = matchingOptions.length ? matchingOptions : options;
    const sorted = [...candidates].sort((a, b) => scoreTaskCodeOption(b, searchWords) - scoreTaskCodeOption(a, searchWords));
    const selected = sorted[0];
    if (!selected?.ad_code) return {};

    return {
        ad_code: selected.ad_code,
        task_code: selected.task_code,
        base_task_code: selected.base_task_code || selected.ad_code,
        task_desc: selected.task_desc
    };
}

export function buildAdtransDuplicateReport(
    rows: AdtransDuplicateSourceRow[],
    filters: string[],
    options?: AdtransCheckOptions
) {
    const groups = new Map<string, AdtransDuplicateSourceRow[]>();
    const normalizedOptions = normalizeAdtransCheckOptions(options);
    const normalizedFilters = resolveAdtransCheckFilters(filters, normalizedOptions);

    for (const row of rows) {
        if (!hasAdtransDuplicateAmount(row.amount)) continue;

        for (const filter of normalizedFilters) {
            if (!matchesAdtransDuplicateFilter(row.doc_desc || '', filter)) continue;
            if (!matchesSpecificAdtransDocDesc(row.doc_desc || '', normalizedOptions)) continue;

            const category = normalizeAdtransFilter(filter);
            // ponytail: duplicate key = emp_code + category + DocDesc (TANPA amount).
            //  Sebelumnya amount ikut key -> 2 record same emp+DocDesc beda amount -> gak kedeteksi duplikat.
            //  User mau: same DocDesc + same emp = duplikat regardless amount. Keep newest (highest id), delete rest.
            //  Upgrade: kalau perlu toleransi amount (e.g. rounding 1Rp), tambah banding amount di action decision.
            const key = [
                normalizeIdentityValue(row.emp_code),
                category,
                normalizeAdtransDuplicateDocDesc(row.doc_desc)
            ].join('|');
            const groupRows = groups.get(key) || [];
            groupRows.push(row);
            groups.set(key, groupRows);
        }
    }

    const duplicates = Array.from(groups.entries())
        .map(([key, groupRows]) => {
            const [empCode, category] = key.split('|');
            const sortedRows = [...groupRows].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
            const keepRecord = sortedRows[sortedRows.length - 1];
            const deleteRecords = sortedRows.slice(0, -1);

            return {
                emp_code: empCode,
                emp_name: keepRecord?.emp_name || sortedRows[0]?.emp_name || '',
                category,
                doc_desc: keepRecord?.doc_desc || sortedRows[0]?.doc_desc || '',
                amount: Number(keepRecord?.amount || sortedRows[0]?.amount || 0),
                record_count: sortedRows.length,
                keep_id: keepRecord.id,
                keep_doc_id: keepRecord.doc_id,
                delete_ids: deleteRecords.map((record) => record.id),
                delete_doc_ids: deleteRecords.map((record) => record.doc_id),
                records: sortedRows.map((record) => ({
                    id: record.id,
                    doc_id: record.doc_id,
                    doc_date: record.doc_date,
                    doc_desc: record.doc_desc,
                    amount: Number(record.amount || 0),
                    action: record.id === keepRecord.id ? 'KEEP_NEWEST' : 'DELETE_OLD'
                }))
            };
        })
        .filter((duplicate) => duplicate.record_count > 1);

    return {
        duplicate_count: duplicates.length,
        duplicates
    };
}

export interface ManualAdjustment {
    id?: number;
    period_month: number;
    period_year: number;
    nik?: string;       // Real NIK (KTP) - primary identifier
    emp_code: string;   // Emp code (B0065, etc.) - for lookup
    emp_name?: string;
    jabatan?: string;
    jabatan_estate?: string;
    gang_code: string;
    division_code?: string;
    adjustment_type: 'PREMI' | 'POTONGAN_KOTOR' | 'POTONGAN_BERSIH' | 'PENDAPATAN_LAINNYA' | 'AUTO_BUFFER';
    adjustment_name: string;
    amount: number;
    remarks?: string;
    metadata_json?: string | null;  // JSON string containing detail items (blok/exp/kendaraan)
    ad_code?: string;
    task_code?: string;
    base_task_code?: string;
    task_desc?: string;
    force_insert?: boolean;
    created_at?: Date;
    created_by?: string;
    updated_at?: Date;
    updated_by?: string;
}

type ResolvedManualAdjustmentIdentity = {
    empCode: string;
    nik: string | null;
    empName: string | null;
    originalIdentifier: string;
};

export type ManualAdjustmentDetailItem = Record<string, unknown> & {
    detail_type: string;
    amount: number;
};

export type GroupedManualAdjustmentItem = Omit<ManualAdjustment, "nik" | "emp_name" | "division_code" | "metadata_json"> & {
    nik: string | null;
    emp_name: string | null;
    estate: string;
    estate_code: string;
    division_code: string;
    metadata_json: string | null;
    metadata_json_raw?: string | null;
    ad_code: string;
    ad_code_desc: string;
    ad_desc: string;
    task_desc: string;
    metadata: unknown | null;
    metadata_parse_error: string | null;
    detail_items: ManualAdjustmentDetailItem[];
};

export type GroupedManualAdjustmentPremiumTransaction = ManualAdjustmentDetailItem & {
    transaction_index: number;
    adjustment_id: number | null;
    record_group_key: string;
    record_action: "NEW" | "ADD";
    record_detail_index: number;
    record_detail_count: number;
    adjustment_type: string;
    adjustment_name: string;
    emp_code: string;
    nik: string | null;
    emp_name: string | null;
    gang_code: string;
    estate: string;
    estate_code: string;
    division_code: string;
    ad_code: string;
    ad_code_desc: string;
    ad_desc: string;
    task_desc: string;
    // ponytail: computed real-time sync/match dari GET recompute_sync=true, propagated ke grouped premium_transactions
    //  supaya agent filter mismatch via computed field (bukan remarks baked stale).
    sync_status?: string | null;
    match_status?: string | null;
    is_stale?: boolean | null;
    adtrans_amount?: number | null;
    diff?: number | null;
    target_amount?: number | null;
    has_adtrans?: boolean | null;
};

function buildPremiumTransactionRecordGroupKey(
    adjustmentId: number | null,
    employeeKey: string,
    groupedItem: GroupedManualAdjustmentItem,
    rowOrdinal: number
): string {
    if (adjustmentId !== null) {
        return `adjustment:${adjustmentId}`;
    }

    const type = normalizeIdentityValue(groupedItem.adjustment_type) || "UNKNOWN_TYPE";
    const name = normalizeIdentityValue(groupedItem.adjustment_name) || "UNKNOWN_NAME";
    return `fallback:${employeeKey}|${type}|${name}|row:${rowOrdinal}`;
}

export type GroupedManualAdjustmentEmployee = {
    emp_code: string;
    nik: string | null;
    emp_name: string | null;
    gang_code: string;
    estate: string;
    estate_code: string;
    division_code: string;
    adjustment_count: number;
    premium_count: number;
    total_amount: number;
    premium_total: number;
    adjustments: GroupedManualAdjustmentItem[];
    premiums: GroupedManualAdjustmentItem[];
    premium_transactions: GroupedManualAdjustmentPremiumTransaction[];
};

export type GroupedManualAdjustmentGang = {
    gang_code: string;
    estate: string;
    estate_code: string;
    division_code: string;
    employee_count: number;
    adjustment_count: number;
    premium_count: number;
    total_amount: number;
    premium_total: number;
    employees: GroupedManualAdjustmentEmployee[];
};

export type GroupedManualAdjustmentDivision = {
    estate: string;
    estate_code: string;
    employee_count: number;
    gang_count: number;
    adjustment_count: number;
    premium_count: number;
    total_amount: number;
    premium_total: number;
    gangs: GroupedManualAdjustmentGang[];
};

export type GroupedManualAdjustmentResponse = {
    summary: {
        division_count: number;
        gang_count: number;
        employee_count: number;
        adjustment_count: number;
    };
    divisions: GroupedManualAdjustmentDivision[];
};

export type ManualAdjustmentApiResponseRow = Omit<ManualAdjustment, "nik" | "emp_name" | "division_code" | "ad_code" | "metadata_json"> & {
    nik: string | null;
    emp_name: string | null;
    gang_code: string;
    estate: string;
    estate_code: string;
    division_code: string;
    metadata_json: string | null;
    metadata_json_raw?: string | null;
    metadata: unknown | null;
    metadata_parse_error: string | null;
    detail_items: ManualAdjustmentDetailItem[];
    ad_code: string;
    ad_code_desc: string;
    ad_desc: string;
    task_desc: string;
    // recompute real-time vs ADTRANS (optional, saat GET recompute_sync=true)
    sync_status?: string | null;
    match_status?: string | null;
    target_amount?: number | null;
    adtrans_amount?: number | null;
    diff?: number | null;
    is_stale?: boolean | null;
    has_adtrans?: boolean | null;
    baked_sync?: string | null;
    baked_match?: string | null;
};

export type ManualAdjustmentNameOption = {
    adjustment_type: string;
    adjustment_name: string;
};

export type ManualAdjustmentSyncStatusUpdateInput = {
    periodMonth: number;
    periodYear: number;
    divisionCode?: string;
    gangCode?: string;
    empCode?: string;
    adjustmentTypes?: string[];
    adjustmentName?: string;
    ids?: number[];
    syncStatus?: string;
    updatedBy?: string;
    onlyIfAdtransExists?: boolean;
    dryRun?: boolean;
    limit?: number;
};

export type ManualAdjustmentSyncStatusRowResult = {
    id: number;
    emp_code: string;
    nik: string | null;
    emp_name: string | null;
    gang_code: string;
    estate: string;
    adjustment_type: string;
    adjustment_name: string;
    amount: number;
    target_amount: number;
    metadata_detail_total: number | null;
    adtrans_amount: number | null;
    ad_code: string;
    ad_code_desc: string;
    ad_desc: string;
    task_desc: string;
    old_sync_status: string | null;
    new_sync_status: string | null;
    match_status: string | null;
    diff: number | null;
    status: "UPDATED" | "UNCHANGED" | "SKIPPED";
    skip_reason: string | null;
    remarks_before: string | null;
    remarks_after: string | null;
    adtrans_details: AdtransDocDescDetail[];
};

export type ManualAdjustmentSyncStatusUpdateResult = {
    period_month: number;
    period_year: number;
    target_sync_status: string;
    only_if_adtrans_exists: boolean;
    dry_run: boolean;
    matched_count: number;
    eligible_count: number;
    adtrans_matched_count: number;
    updated_count: number;
    unchanged_count: number;
    skipped_count: number;
    partial_count: number;
    rows: ManualAdjustmentSyncStatusRowResult[];
};

function normalizeIdentityValue(value: unknown): string {
    return normalizeText(value).toUpperCase();
}

function isNumericNik(value: unknown): boolean {
    return /^\d{10,}$/.test(normalizeIdentityValue(value));
}

async function resolveManualAdjustmentIdentityByContext(data: ManualAdjustment): Promise<{ emp_code: string; nik: string; emp_name: string } | null> {
    const empName = normalizeText(data.emp_name).toUpperCase();
    const gangCode = normalizeText(data.gang_code).toUpperCase();
    if (!empName || !gangCode) return null;

    const db = Database.getInstance();
    const row = await db.queryOne<any>(`
        SELECT TOP 1
            RTRIM(ISNULL(e.NewICNo, '')) as nik,
            RTRIM(e.EmpCode) as emp_code,
            RTRIM(e.EmpName) as emp_name
        FROM HR_EMPLOYEE e
        JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
        WHERE UPPER(RTRIM(e.EmpName)) = ?
          AND UPPER(RTRIM(gl.GangCode)) = ?
        ORDER BY e.EmpCode DESC
    `, [empName, gangCode]);

    if (!row) return null;
    return {
        nik: normalizeIdentityValue(row.nik),
        emp_code: normalizeIdentityValue(row.emp_code),
        emp_name: normalizeIdentityValue(row.emp_name)
    };
}

async function resolveManualAdjustmentIdentityByHistory(data: ManualAdjustment): Promise<{ emp_code: string; nik: string; emp_name: string } | null> {
    const inputEmpCode = normalizeIdentityValue(data.emp_code);
    const inputNik = normalizeIdentityValue(data.nik);
    const empName = normalizeText(data.emp_name).toUpperCase();
    const gangCode = normalizeText(data.gang_code).toUpperCase();
    if (!inputEmpCode && !inputNik && (!empName || !gangCode)) return null;

    const db = Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    const row = await db.queryOne<any>(`
        SELECT TOP 1
            RTRIM(h.emp_code) as emp_code,
            COALESCE(
                NULLIF(RTRIM(ISNULL(h.nik, '')), ''),
                NULLIF(RTRIM(ISNULL(h.new_nik, '')), ''),
                ?
            ) as nik,
            RTRIM(ISNULL(h.emp_name, '')) as emp_name
        FROM dbo.history_hr_employee h
        WHERE h.period_month = ?
          AND h.period_year = ?
          AND NULLIF(RTRIM(ISNULL(h.emp_code, '')), '') IS NOT NULL
          AND (
              RTRIM(h.emp_code) = ?
              OR NULLIF(RTRIM(ISNULL(h.nik, '')), '') = ?
              OR NULLIF(RTRIM(ISNULL(h.new_nik, '')), '') = ?
              OR NULLIF(RTRIM(ISNULL(h.nik, '')), '') = ?
              OR NULLIF(RTRIM(ISNULL(h.new_nik, '')), '') = ?
              OR (
                  ? <> ''
                  AND ? <> ''
                  AND UPPER(RTRIM(h.emp_name)) = ?
                  AND UPPER(RTRIM(h.gang_code)) = ?
              )
          )
          AND (
              SELECT COUNT(DISTINCT RTRIM(h2.emp_code))
              FROM dbo.history_hr_employee h2
              WHERE h2.period_month = h.period_month
                AND h2.period_year = h.period_year
                AND NULLIF(RTRIM(ISNULL(h2.emp_code, '')), '') IS NOT NULL
                AND (
                    RTRIM(h2.emp_code) = ?
                    OR NULLIF(RTRIM(ISNULL(h2.nik, '')), '') = ?
                    OR NULLIF(RTRIM(ISNULL(h2.new_nik, '')), '') = ?
                    OR NULLIF(RTRIM(ISNULL(h2.nik, '')), '') = ?
                    OR NULLIF(RTRIM(ISNULL(h2.new_nik, '')), '') = ?
                    OR (
                        ? <> ''
                        AND ? <> ''
                        AND UPPER(RTRIM(h2.emp_name)) = ?
                        AND UPPER(RTRIM(h2.gang_code)) = ?
                    )
                )
          ) = 1
        ORDER BY
            CASE
                WHEN RTRIM(h.emp_code) = ? THEN 0
                WHEN NULLIF(RTRIM(ISNULL(h.nik, '')), '') = ? OR NULLIF(RTRIM(ISNULL(h.new_nik, '')), '') = ? THEN 1
                WHEN NULLIF(RTRIM(ISNULL(h.nik, '')), '') = ? OR NULLIF(RTRIM(ISNULL(h.new_nik, '')), '') = ? THEN 2
                ELSE 3
            END,
            h.created_at DESC,
            h.id DESC
    `, [
        isNumericNik(inputEmpCode) ? inputEmpCode : inputNik,
        data.period_month,
        data.period_year,
        inputEmpCode,
        inputEmpCode,
        inputEmpCode,
        inputNik,
        inputNik,
        empName,
        gangCode,
        empName,
        gangCode,
        inputEmpCode,
        inputEmpCode,
        inputEmpCode,
        inputNik,
        inputNik,
        empName,
        gangCode,
        empName,
        gangCode,
        inputEmpCode,
        inputEmpCode,
        inputEmpCode,
        inputNik,
        inputNik
    ]);

    if (!row) return null;
    return {
        nik: normalizeIdentityValue(row.nik),
        emp_code: normalizeIdentityValue(row.emp_code),
        emp_name: normalizeIdentityValue(row.emp_name)
    };
}

async function resolveManualAdjustmentIdentity(data: ManualAdjustment): Promise<ResolvedManualAdjustmentIdentity> {
    const inputEmpCode = normalizeIdentityValue(data.emp_code);
    const inputNik = normalizeIdentityValue(data.nik);
    const lookupIdentifier = inputEmpCode && !isNumericNik(inputEmpCode)
        ? inputEmpCode
        : inputNik || inputEmpCode;
    const fallbackIdentifier = inputNik && inputNik !== lookupIdentifier ? inputNik : inputEmpCode;
    const needsHistoryLookup = isNumericNik(inputEmpCode) || isNumericNik(inputNik);
    const identity = await employeeIdentityResolverService.resolve(lookupIdentifier)
        || (fallbackIdentifier && fallbackIdentifier !== lookupIdentifier
            ? await employeeIdentityResolverService.resolve(fallbackIdentifier)
            : null)
        || await resolveManualAdjustmentIdentityByContext(data)
        || (needsHistoryLookup ? await resolveManualAdjustmentIdentityByHistory(data) : null);

    const resolvedEmpCode = normalizeIdentityValue(identity?.emp_code)
        || (!isNumericNik(inputEmpCode) ? inputEmpCode : "");
    const resolvedNik = normalizeIdentityValue(identity?.nik)
        || (isNumericNik(inputNik) ? inputNik : isNumericNik(inputEmpCode) ? inputEmpCode : "");

    if (!resolvedEmpCode) {
        throw new Error(`NIK/EmpCode "${inputNik || inputEmpCode}" tidak bisa diresolve ke EmpCode PTRJ. Simpan dibatalkan agar payroll_manual_adjustments tetap konsisten.`);
    }

    return {
        empCode: resolvedEmpCode,
        nik: resolvedNik || null,
        empName: normalizeIdentityValue(data.emp_name || identity?.emp_name) || null,
        originalIdentifier: inputEmpCode || inputNik
    };
}

async function resolveManualAdjustmentLookupIdentity(identifier: string): Promise<{ empCode: string | null; nik: string | null; originalIdentifier: string }> {
    const normalized = normalizeIdentityValue(identifier);
    if (!normalized) return { empCode: null, nik: null, originalIdentifier: "" };

    const identity = await employeeIdentityResolverService.resolve(normalized);
    return {
        empCode: normalizeIdentityValue(identity?.emp_code) || (!isNumericNik(normalized) ? normalized : null),
        nik: normalizeIdentityValue(identity?.nik) || (isNumericNik(normalized) ? normalized : null),
        originalIdentifier: normalized
    };
}

function toNumericAmount(value: unknown): number {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
}

function normalizeSubblokCode(value: unknown): string {
    return normalizeText(value).replace(/[^0-9A-Za-z]/g, "");
}

function deriveDivisionCodeFromGangCode(value: unknown): string {
    const normalized = normalizeIdentityValue(value).replace(/[^0-9A-Z]/g, "");
    const code = normalized.slice(0, 2);
    return code ? code.split("").join(" ") : "";
}

async function enrichManualAdjustmentRowsWithJabatan(rows: ManualAdjustment[]): Promise<ManualAdjustment[]> {
    const empCodes = Array.from(new Set(rows
        .map((row) => normalizeIdentityValue(row.emp_code))
        .filter(Boolean)));
    if (empCodes.length === 0) return rows;

    try {
        const jobTitles = await EmployeeEstateService.getEmployeeJobsWithNik(empCodes);
        return rows.map((row) => {
            const existingJabatan = normalizeText(row.jabatan || row.jabatan_estate);
            const empCode = normalizeIdentityValue(row.emp_code);
            const nik = normalizeIdentityValue(row.nik);
            const resolvedJabatan = existingJabatan
                || normalizeText(jobTitles.empcodeMap[empCode])
                || normalizeText(jobTitles.nikMap[nik]);

            return resolvedJabatan ? { ...row, jabatan: resolvedJabatan } : row;
        });
    } catch (error) {
        console.warn("[ManualAdjustmentService] Could not enrich manual adjustments with jabatan:", error);
        return rows;
    }
}

function resolveManualAdjustmentDefinitionAdCodeFields(row: ManualAdjustment): { ad_code: string | null; ad_code_desc: string | null; task_desc: string | null } {
    const adjustmentType = normalizeText(row.adjustment_type).toUpperCase();
    const definition = premiumDefinitionService.getDefinitionByName(normalizeStoredAdjustmentName(row.adjustment_name));
    if (!definition) return { ad_code: null, ad_code_desc: null, task_desc: null };

    const definitionType = normalizeText(definition.adjustment_type || "PREMI").toUpperCase();
    if (definitionType !== adjustmentType) return { ad_code: null, ad_code_desc: null, task_desc: null };

    const taskDesc = normalizeText(definition.task_desc) || null;
    const parsedDefinition = inferManualAdjustmentAdCodeFromRemarks(
        `${definition.adjustment_name} | ${normalizeText(definition.ad_code)}${taskDesc ? ` - ${taskDesc}` : ""} | 0`
    );

    return {
        ad_code: normalizeText(parsedDefinition.adCode || definition.ad_code).toUpperCase() || null,
        ad_code_desc: normalizeText(parsedDefinition.adCodeDesc || taskDesc) || null,
        task_desc: taskDesc
    };
}

function resolveManualAdjustmentResponseAdCodeFields(row: ManualAdjustment): { ad_code: string; ad_code_desc: string; ad_desc: string; task_desc: string } {
    if (isKoreksiManualAdjustment(row)) {
        return resolveKoreksiManualAdjustmentAdCodeFields();
    }

    const inferred = inferManualAdjustmentAdCodeFromRemarks(row.remarks);
    const definition = resolveManualAdjustmentDefinitionAdCodeFields(row);
    const fallbackName = normalizeStoredAdjustmentName(row.adjustment_name) || "UNKNOWN_ADJUSTMENT";
    const taskDesc = normalizeText(row.task_desc || inferred.adCodeDesc || definition.task_desc || definition.ad_code_desc || fallbackName);
    const adCodeDesc = normalizeText(row.task_desc || inferred.adCodeDesc || definition.ad_code_desc || definition.task_desc || taskDesc || fallbackName);
    const adCode = normalizeText(row.ad_code || row.base_task_code || row.task_code || inferred.adCode || definition.ad_code || taskDesc || adCodeDesc || fallbackName).toUpperCase();

    return {
        ad_code: adCode,
        ad_code_desc: adCodeDesc,
        ad_desc: adCodeDesc,
        task_desc: taskDesc
    };
}

function parseManualAdjustmentMetadataValue(value: unknown): { metadata: unknown | null; metadata_parse_error: string | null } {
    if (value == null || value === "") return { metadata: null, metadata_parse_error: null };
    if (typeof value === "object") return { metadata: value, metadata_parse_error: null };

    try {
        return { metadata: JSON.parse(String(value)), metadata_parse_error: null };
    } catch (error: any) {
        return { metadata: null, metadata_parse_error: error?.message || "Invalid metadata_json" };
    }
}

type ManualAdjustmentResponseAdCodeFields = ReturnType<typeof resolveManualAdjustmentResponseAdCodeFields>;

type ManualAdjustmentDetailContext = {
    row?: ManualAdjustment;
    adCodeFields?: ManualAdjustmentResponseAdCodeFields;
};

function resolveVehicleExpenseCodeFromText(value: unknown): "DRIVER" | "HELPER" | null {
    const text = normalizeText(value).toUpperCase();
    if (!text) return null;
    if (/\bHELPER\b/.test(text)) return "HELPER";
    if (/\b(DRIVER|OPERATOR|SOPIR|SUPIR)\b/.test(text)) return "DRIVER";
    return null;
}

function resolveKendaraanExpenseCode(
    item: Record<string, unknown>,
    context: ManualAdjustmentDetailContext
): { code: "DRIVER" | "HELPER"; source: string } | null {
    const candidates: Array<{ source: string; value: unknown }> = [
        { source: "metadata_jabatan", value: item.jabatan || item.jabatan_estate || item.role_jabatan || item.role || item.position || item.job_title },
        { source: "jabatan", value: context.row?.jabatan || context.row?.jabatan_estate },
        { source: "task_desc", value: context.adCodeFields?.task_desc || context.adCodeFields?.ad_code_desc },
        { source: "remarks", value: context.row?.remarks },
        { source: "adjustment_name", value: context.row?.adjustment_name },
        { source: "expense_code", value: item.expense_code }
    ];

    for (const candidate of candidates) {
        const code = resolveVehicleExpenseCodeFromText(candidate.value);
        if (code) return { code, source: candidate.source };
    }

    return null;
}

function buildDetailItem(
    detailType: string,
    item: Record<string, unknown>,
    context: ManualAdjustmentDetailContext = {}
): ManualAdjustmentDetailItem {
    const detailItem: ManualAdjustmentDetailItem = {
        detail_type: detailType,
        ...item,
        amount: toNumericAmount(item.amount ?? item.jumlah ?? item.total_amount)
    };

    if ("subblok" in item) {
        const rawSubblok = normalizeText(item.subblok);
        const normalizedSubblok = normalizeSubblokCode(rawSubblok);

        if (rawSubblok) {
            detailItem.subblok = normalizedSubblok;
            if (normalizedSubblok !== rawSubblok) {
                detailItem.subblok_raw = rawSubblok;
            }
        }
    }

    if (normalizeText(detailType).toLowerCase() === "kendaraan") {
        const normalizedExpense = resolveKendaraanExpenseCode(item, context);
        if (normalizedExpense) {
            const rawExpenseCode = normalizeText(item.expense_code);
            if (rawExpenseCode && rawExpenseCode.toUpperCase() !== normalizedExpense.code) {
                detailItem.expense_code_raw = rawExpenseCode;
            }
            detailItem.expense_code = normalizedExpense.code;
            detailItem.expense_code_source = normalizedExpense.source;
        }
    }

    return detailItem;
}

function buildManualAdjustmentDetailItems(
    metadata: unknown,
    context: ManualAdjustmentDetailContext = {}
): ManualAdjustmentDetailItem[] {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];

    const data = metadata as Record<string, any>;
    const inputType = String(data.input_type || "detail").trim() || "detail";

    if (inputType === "blok,exp") {
        const blokItems = Array.isArray(data.blok_items)
            ? data.blok_items.map((item: Record<string, unknown>) => buildDetailItem("blok", item, context))
            : [];
        const expenseItems = data.expense && typeof data.expense === "object"
            ? [buildDetailItem("exp", data.expense, context)]
            : [];
        return [...blokItems, ...expenseItems];
    }

    if (Array.isArray(data.items)) {
        return data.items
            .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
            .map((item) => buildDetailItem(inputType, item, context));
    }

    if ("jumlah" in data || "amount" in data || "expense_code" in data) {
        return [buildDetailItem(inputType, data, context)];
    }

    return [];
}

function omitDetailType(item: ManualAdjustmentDetailItem): Record<string, unknown> {
    const { detail_type, ...rest } = item;
    return rest;
}

function buildNormalizedMetadataItem(
    originalItem: Record<string, unknown>,
    detailItem: ManualAdjustmentDetailItem | undefined
): Record<string, unknown> {
    if (!detailItem) return { ...originalItem };

    const { detail_type, amount, ...normalizedDetail } = detailItem;
    const normalizedItem: Record<string, unknown> = {
        ...originalItem,
        ...normalizedDetail
    };

    if (!("jumlah" in originalItem) && !("amount" in originalItem)) {
        normalizedItem.amount = amount;
    }

    return normalizedItem;
}

function buildNormalizedManualAdjustmentMetadata(
    metadata: unknown,
    detailItems: ManualAdjustmentDetailItem[]
): unknown | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata ?? null;

    const data = metadata as Record<string, any>;
    const inputType = String(data.input_type || "detail").trim() || "detail";
    const normalizedData: Record<string, unknown> = { ...data };

    if (inputType === "blok,exp") {
        const blokDetails = detailItems.filter((item) => item.detail_type === "blok");
        normalizedData.blok_items = Array.isArray(data.blok_items)
            ? data.blok_items.map((item: Record<string, unknown>, index: number) => buildNormalizedMetadataItem(item, blokDetails[index]))
            : blokDetails.map(omitDetailType);
        const expenseItem = detailItems.find((item) => item.detail_type === "exp");
        if (expenseItem) {
            normalizedData.expense = data.expense && typeof data.expense === "object" && !Array.isArray(data.expense)
                ? buildNormalizedMetadataItem(data.expense, expenseItem)
                : omitDetailType(expenseItem);
        }
        return normalizedData;
    }

    if (Array.isArray(data.items)) {
        normalizedData.items = data.items.map((item: Record<string, unknown>, index: number) => buildNormalizedMetadataItem(item, detailItems[index]));
        return normalizedData;
    }

    if (detailItems.length === 1) {
        return buildNormalizedMetadataItem(normalizedData, detailItems[0]);
    }

    return normalizedData;
}

function buildManualAdjustmentResponseMetadataFields(
    rawMetadataJson: unknown,
    metadata: unknown | null,
    metadataParseError: string | null,
    detailItems: ManualAdjustmentDetailItem[]
): {
    metadata_json: string | null;
    metadata_json_raw?: string | null;
    metadata: unknown | null;
    metadata_parse_error: string | null;
} {
    if (metadataParseError || metadata == null) {
        return {
            metadata_json: rawMetadataJson == null || rawMetadataJson === "" ? null : String(rawMetadataJson),
            metadata: null,
            metadata_parse_error: metadataParseError
        };
    }

    const normalizedMetadata = buildNormalizedManualAdjustmentMetadata(metadata, detailItems);
    const normalizedMetadataJson = normalizedMetadata == null ? null : JSON.stringify(normalizedMetadata);
    const rawMetadataString = rawMetadataJson == null || rawMetadataJson === "" ? null : String(rawMetadataJson);

    return {
        metadata_json: normalizedMetadataJson,
        metadata_json_raw: rawMetadataString && normalizedMetadataJson !== rawMetadataString ? rawMetadataString : undefined,
        metadata: normalizedMetadata,
        metadata_parse_error: null
    };
}

function normalizeSyncStatus(value: unknown): string {
    return normalizeText(value).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function normalizeManualAdjustmentSyncTypes(values?: string[]): string[] {
    const allowedTypes = new Set(["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH", "AUTO_BUFFER"]);
    const aliases: Record<string, string> = {
        PREMI: "PREMI",
        KOREKSI: "POTONGAN_KOTOR",
        POTONGAN_KOTOR: "POTONGAN_KOTOR",
        POTONGAN_UPAH_KOTOR: "POTONGAN_KOTOR",
        POTONGAN_BERSIH: "POTONGAN_BERSIH",
        POTONGAN_UPAH_BERSIH: "POTONGAN_BERSIH",
        AUTO: "AUTO_BUFFER",
        AUTO_BUFFER: "AUTO_BUFFER"
    };

    const normalized = (values && values.length > 0 ? values : Array.from(allowedTypes))
        .flatMap((value) => String(value || "").split(","))
        .map((value) => aliases[normalizeText(value).toUpperCase()] || normalizeText(value).toUpperCase())
        .filter((value) => allowedTypes.has(value));

    return Array.from(new Set(normalized.length ? normalized : Array.from(allowedTypes)));
}

function resolveManualAdjustmentAdtransCategory(row: Pick<ManualAdjustment, "adjustment_type" | "adjustment_name">): string {
    const adjustmentType = normalizeText(row.adjustment_type).toUpperCase();
    const adjustmentName = normalizeText(row.adjustment_name).toUpperCase();
    if (adjustmentType === "PREMI") return "premi";
    if (adjustmentType === "POTONGAN_KOTOR") return adjustmentName.includes("KOREKSI") ? "koreksi" : "potongan";
    if (adjustmentType === "POTONGAN_BERSIH") return "potongan";
    if (adjustmentType === "AUTO_BUFFER") {
        const autoBufferName = normalizeAutoBufferAdjustmentName(adjustmentName);
        if (autoBufferName === "TUNJANGAN JABATAN") return "jabatan";
        if (autoBufferName === "MASA KERJA") return "masa kerja";
        if (autoBufferName === "SPSI") return "spsi";
        if (autoBufferName === "POTONGAN PPH") return "pph";
    }
    return "";
}

function normalizeAdtransComparableText(value: unknown): string {
    return normalizeText(value)
        .toUpperCase()
        .replace(/\((AL|DE)\)/g, " ")
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildManualAdjustmentExpectedAdtransTexts(row: ManualAdjustment): string[] {
    const adCodeFields = resolveManualAdjustmentResponseAdCodeFields(row);
    const values = [
        adCodeFields.task_desc,
        adCodeFields.ad_code_desc,
        row.adjustment_name
    ];

    return Array.from(new Set(values
        .map(normalizeAdtransComparableText)
        .filter((value) => value.length >= 3)));
}

function adtransDetailMatchesManualAdjustment(row: ManualAdjustment, detail: ManualAdjustmentSyncAdtransDetail): boolean {
    const docText = normalizeAdtransComparableText(detail.doc_desc);
    if (!docText) return false;

    const expectedTexts = buildManualAdjustmentExpectedAdtransTexts(row);
    if (expectedTexts.length > 0) {
        if (expectedTexts.some((expected) => docText.includes(expected) || expected.includes(docText))) {
            return true;
        }

        const adjustmentType = normalizeText(row.adjustment_type).toUpperCase();
        const category = resolveManualAdjustmentAdtransCategory(row);
        return adjustmentType === "AUTO_BUFFER" && category
            ? matchesAdtransFilter(detail.doc_desc, category)
            : false;
    }

    const category = resolveManualAdjustmentAdtransCategory(row);
    return category ? matchesAdtransFilter(detail.doc_desc, category) : false;
}

function resolveManualAdjustmentSyncTargetAmount(row: ManualAdjustment): { targetAmount: number; metadataDetailTotal: number | null } {
    const parsedMetadata = parseManualAdjustmentMetadataValue(row.metadata_json);
    const detailItems = buildManualAdjustmentDetailItems(parsedMetadata.metadata);
    const detailTotal = detailItems.reduce((sum, item) => sum + toNumericAmount(item.amount), 0);

    if (detailItems.length > 0 && Math.abs(detailTotal) > 0.01) {
        return {
            targetAmount: detailTotal,
            metadataDetailTotal: detailTotal
        };
    }

    return {
        targetAmount: toNumericAmount(row.amount),
        metadataDetailTotal: detailItems.length > 0 ? detailTotal : null
    };
}

// ponytail: pure recompute sync/match status dari row + ADTRANS details.
//  Tidak tulis DB. Dipakai oleh GET recompute + write-back save + seeder (updateManualAdjustmentSyncStatus).
//  Upgrade: pindah ke module terpisah kalau logic grow (e.g. per-category custom tolerance).
export type ComputedManualAdjustmentSyncStatus = {
    id: number;
    sync_status: string;
    match_status: string;
    target_amount: number;
    metadata_detail_total: number | null;
    adtrans_amount: number;
    diff: number;
    adtrans_details: AdtransDocDescDetail[];
    has_adtrans: boolean;
    baked_sync: string | null;
    baked_match: string | null;
    is_stale: boolean; // computed sync/match ≠ baked remarks
    remarks_fresh: string | null; // remarks dengan sync/match updated (untuk write-back)
};

export function computeManualAdjustmentSyncStatuses(
    rows: ManualAdjustment[],
    adtransDetails: ManualAdjustmentSyncAdtransDetail[]
): Map<number, ComputedManualAdjustmentSyncStatus> {
    const detailsByEmpCode = new Map<string, ManualAdjustmentSyncAdtransDetail[]>();
    for (const detail of adtransDetails) {
        const empCode = normalizeIdentityValue(detail.emp_code);
        if (!detailsByEmpCode.has(empCode)) detailsByEmpCode.set(empCode, []);
        detailsByEmpCode.get(empCode)!.push(detail);
    }

    const result = new Map<number, ComputedManualAdjustmentSyncStatus>();

    for (const row of rows) {
        const id = Number(row.id);
        if (!id) continue;

        const empCode = normalizeIdentityValue(row.emp_code);
        const amountInfo = resolveManualAdjustmentSyncTargetAmount(row);
        const empDetails = detailsByEmpCode.get(empCode) || [];
        const matchingDetails = empDetails.filter((detail) => adtransDetailMatchesManualAdjustment(row, detail));
        const adtransAmountAbs = matchingDetails.reduce((sum, detail) => sum + Math.abs(toNumericAmount(detail.amount)), 0);
        const targetAmountAbs = Math.abs(toNumericAmount(amountInfo.targetAmount));
        const adtransDocDetails = matchingDetails.map((detail) => ({
            doc_desc: detail.doc_desc,
            doc_id: detail.doc_id,
            amount: detail.amount
        }));
        const hasAdtrans = matchingDetails.length > 0;
        const amountsMatch = Math.abs(adtransAmountAbs - targetAmountAbs) <= 0.01;
        const isZeroWithoutAdtransMatch = !hasAdtrans && targetAmountAbs <= 0.01 && adtransAmountAbs <= 0.01;
        const isMatch = (hasAdtrans && amountsMatch) || isZeroWithoutAdtransMatch;
        const nextSyncStatus = isMatch ? "SYNC" : hasAdtrans ? "DIFF" : "MISS";
        const nextMatchStatus = isMatch ? "MATCH" : "MISMATCH";

        // parse baked sync/match dari remarks existing
        const baked = parsePipeDelimitedRemarks(row.remarks);
        const reconciliation = updatePipeDelimitedSyncAndMatchStatus(row.remarks, nextSyncStatus, nextMatchStatus);

        const isStale = (baked.syncStatus !== null && baked.syncStatus !== nextSyncStatus)
            || (baked.matchStatus !== null && baked.matchStatus !== nextMatchStatus);

        result.set(id, {
            id,
            sync_status: nextSyncStatus,
            match_status: nextMatchStatus,
            target_amount: amountInfo.targetAmount,
            metadata_detail_total: amountInfo.metadataDetailTotal,
            adtrans_amount: adtransAmountAbs,
            diff: adtransAmountAbs - targetAmountAbs,
            adtrans_details: adtransDocDetails,
            has_adtrans: hasAdtrans,
            baked_sync: baked.syncStatus,
            baked_match: baked.matchStatus,
            is_stale: isStale,
            remarks_fresh: (reconciliation?.remarks ?? row.remarks) ?? null
        });
    }

    return result;
}

function sortByText<T>(items: T[], selector: (item: T) => unknown): T[] {
    return [...items].sort((a, b) => String(selector(a) || "").localeCompare(String(selector(b) || "")));
}

export function buildManualAdjustmentApiResponseRows(rows: ManualAdjustment[]): ManualAdjustmentApiResponseRow[] {
    return rows.map((row) => {
        const gangCode = normalizeIdentityValue(row.gang_code) || "UNKNOWN_GANG";
        const estateCode = normalizeIdentityValue(row.division_code) || "UNKNOWN_ESTATE";
        const parsedMetadata = parseManualAdjustmentMetadataValue(row.metadata_json);
        const adCodeFields = resolveManualAdjustmentResponseAdCodeFields(row);
        const detailItems = buildManualAdjustmentDetailItems(parsedMetadata.metadata, { row, adCodeFields });
        const metadataFields = buildManualAdjustmentResponseMetadataFields(
            row.metadata_json,
            parsedMetadata.metadata,
            parsedMetadata.metadata_parse_error,
            detailItems
        );

        return {
            ...row,
            emp_code: normalizeIdentityValue(row.emp_code) || "UNKNOWN_EMPLOYEE",
            nik: normalizeIdentityValue(row.nik) || null,
            emp_name: normalizeIdentityValue(row.emp_name) || null,
            gang_code: gangCode,
            estate: estateCode,
            estate_code: estateCode,
            division_code: deriveDivisionCodeFromGangCode(gangCode) || "UNKNOWN_DIVISION",
            ...metadataFields,
            detail_items: detailItems,
            ...adCodeFields
        };
    });
}

export function buildGroupedManualAdjustmentResponse(rows: ManualAdjustment[]): GroupedManualAdjustmentResponse {
    const divisionMap = new Map<string, Map<string, Map<string, GroupedManualAdjustmentEmployee>>>();

    for (const row of rows) {
        const estateCode = normalizeIdentityValue(row.division_code) || "UNKNOWN_ESTATE";
        const gangCode = normalizeIdentityValue(row.gang_code) || "UNKNOWN_GANG";
        const divisionCode = deriveDivisionCodeFromGangCode(gangCode) || "UNKNOWN_DIVISION";
        const empCode = normalizeIdentityValue(row.emp_code) || "UNKNOWN_EMPLOYEE";
        const nik = normalizeIdentityValue(row.nik) || null;
        const empName = normalizeIdentityValue(row.emp_name) || null;
        const employeeKey = `${empCode}|${nik || ""}|${empName || ""}`;

        if (!divisionMap.has(estateCode)) divisionMap.set(estateCode, new Map());
        const gangMap = divisionMap.get(estateCode)!;
        if (!gangMap.has(gangCode)) gangMap.set(gangCode, new Map());
        const employeeMap = gangMap.get(gangCode)!;

        if (!employeeMap.has(employeeKey)) {
            employeeMap.set(employeeKey, {
                emp_code: empCode,
                nik,
                emp_name: empName,
                gang_code: gangCode,
                estate: estateCode,
                estate_code: estateCode,
                division_code: divisionCode,
                adjustment_count: 0,
                premium_count: 0,
                total_amount: 0,
                premium_total: 0,
                adjustments: [],
                premiums: [],
                premium_transactions: []
            });
        }

        const employee = employeeMap.get(employeeKey)!;
        const parsedMetadata = parseManualAdjustmentMetadataValue(row.metadata_json);
        const adCodeFields = resolveManualAdjustmentResponseAdCodeFields(row);
        const detailItems = buildManualAdjustmentDetailItems(parsedMetadata.metadata, { row, adCodeFields });
        const metadataFields = buildManualAdjustmentResponseMetadataFields(
            row.metadata_json,
            parsedMetadata.metadata,
            parsedMetadata.metadata_parse_error,
            detailItems
        );
        const groupedItem: GroupedManualAdjustmentItem = {
            ...row,
            emp_code: empCode,
            nik,
            emp_name: empName,
            gang_code: gangCode,
            estate: estateCode,
            estate_code: estateCode,
            division_code: divisionCode,
            ...metadataFields,
            ...adCodeFields,
            detail_items: detailItems
        };
        const amount = toNumericAmount(row.amount);

        employee.adjustments.push(groupedItem);
        employee.adjustment_count += 1;
        employee.total_amount += amount;
        const employeeAdjustmentOrdinal = employee.adjustment_count;

        if (String(row.adjustment_type || "").toUpperCase() === "PREMI") {
            employee.premiums.push(groupedItem);
            employee.premium_count += 1;
            employee.premium_total += amount;
            const adjustmentId = typeof groupedItem.id === "number" ? groupedItem.id : null;
            const recordGroupKey = buildPremiumTransactionRecordGroupKey(adjustmentId, employeeKey, groupedItem, employeeAdjustmentOrdinal);
            const recordDetailCount = groupedItem.detail_items.length;
            groupedItem.detail_items.forEach((detailItem, detailIndex) => {
                employee.premium_transactions.push({
                    transaction_index: employee.premium_transactions.length + 1,
                    adjustment_id: adjustmentId,
                    adjustment_type: groupedItem.adjustment_type,
                    adjustment_name: groupedItem.adjustment_name,
                    emp_code: employee.emp_code,
                    nik: employee.nik,
                    emp_name: employee.emp_name,
                    gang_code: employee.gang_code,
                    estate: employee.estate,
                    estate_code: employee.estate_code,
                    division_code: employee.division_code,
                    ad_code: groupedItem.ad_code,
                    ad_code_desc: groupedItem.ad_code_desc,
                    ad_desc: groupedItem.ad_desc,
                    task_desc: groupedItem.task_desc,
                    // ponytail: propagate computed sync/match supaya agent filter mismatch via computed field.
                    sync_status: groupedItem.sync_status ?? null,
                    match_status: groupedItem.match_status ?? null,
                    is_stale: groupedItem.is_stale ?? null,
                    adtrans_amount: groupedItem.adtrans_amount ?? null,
                    diff: groupedItem.diff ?? null,
                    target_amount: groupedItem.target_amount ?? null,
                    has_adtrans: groupedItem.has_adtrans ?? null,
                    ...detailItem,
                    record_group_key: recordGroupKey,
                    record_action: detailIndex === 0 ? "NEW" : "ADD",
                    record_detail_index: detailIndex + 1,
                    record_detail_count: recordDetailCount
                });
            });
        }
    }

    const divisions: GroupedManualAdjustmentDivision[] = [];
    let gangCount = 0;
    let employeeCount = 0;

    for (const [estateCode, gangMap] of sortByText(Array.from(divisionMap.entries()), ([estate]) => estate)) {
        const gangs: GroupedManualAdjustmentGang[] = [];

        for (const [gangCode, employeeMap] of sortByText(Array.from(gangMap.entries()), ([gang]) => gang)) {
            const divisionCode = deriveDivisionCodeFromGangCode(gangCode) || "UNKNOWN_DIVISION";
            const employees = sortByText(Array.from(employeeMap.values()), (employee) => employee.emp_name || employee.emp_code)
                .map((employee) => ({
                    ...employee,
                    adjustments: sortByText(employee.adjustments, (item) => item.adjustment_name),
                    premiums: sortByText(employee.premiums, (item) => item.adjustment_name),
                    premium_transactions: [...employee.premium_transactions].sort((a, b) => a.transaction_index - b.transaction_index)
                }));

            const gang: GroupedManualAdjustmentGang = {
                gang_code: gangCode,
                estate: estateCode,
                estate_code: estateCode,
                division_code: divisionCode,
                employee_count: employees.length,
                adjustment_count: employees.reduce((sum, employee) => sum + employee.adjustment_count, 0),
                premium_count: employees.reduce((sum, employee) => sum + employee.premium_count, 0),
                total_amount: employees.reduce((sum, employee) => sum + employee.total_amount, 0),
                premium_total: employees.reduce((sum, employee) => sum + employee.premium_total, 0),
                employees
            };
            gangs.push(gang);
            gangCount += 1;
            employeeCount += employees.length;
        }

        divisions.push({
            estate: estateCode,
            estate_code: estateCode,
            employee_count: gangs.reduce((sum, gang) => sum + gang.employee_count, 0),
            gang_count: gangs.length,
            adjustment_count: gangs.reduce((sum, gang) => sum + gang.adjustment_count, 0),
            premium_count: gangs.reduce((sum, gang) => sum + gang.premium_count, 0),
            total_amount: gangs.reduce((sum, gang) => sum + gang.total_amount, 0),
            premium_total: gangs.reduce((sum, gang) => sum + gang.premium_total, 0),
            gangs
        });
    }

    return {
        summary: {
            division_count: divisions.length,
            gang_count: gangCount,
            employee_count: employeeCount,
            adjustment_count: rows.length
        },
        divisions
    };
}

export class ManualAdjustmentService {
    private static instance: ManualAdjustmentService;
    private static identitySchemaEnsured = false;

    private constructor() { }

    public static getInstance(): ManualAdjustmentService {
        if (!ManualAdjustmentService.instance) {
            ManualAdjustmentService.instance = new ManualAdjustmentService();
        }
        return ManualAdjustmentService.instance;
    }

    private getDatabase(): Database {
        return Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    private async ensureManualAdjustmentIdentitySchema(db: Database): Promise<void> {
        if (ManualAdjustmentService.identitySchemaEnsured) return;

        await db.query(`
            IF COL_LENGTH('dbo.payroll_manual_adjustments', 'nik') IS NULL
            BEGIN
                ALTER TABLE dbo.payroll_manual_adjustments ADD nik VARCHAR(50) NULL;
            END;

            IF COL_LENGTH('dbo.payroll_manual_adjustments', 'emp_name') IS NULL
            BEGIN
                ALTER TABLE dbo.payroll_manual_adjustments ADD emp_name VARCHAR(150) NULL;
            END;

            IF COL_LENGTH('dbo.payroll_manual_adjustments', 'metadata_json') IS NULL
            BEGIN
                ALTER TABLE dbo.payroll_manual_adjustments ADD metadata_json NVARCHAR(MAX) NULL;
            END;

            IF NOT EXISTS (
                SELECT 1 FROM sys.indexes
                WHERE name = 'IX_payroll_manual_adjustments_nik'
                  AND object_id = OBJECT_ID('dbo.payroll_manual_adjustments')
            )
            BEGIN
                CREATE INDEX IX_payroll_manual_adjustments_nik
                    ON dbo.payroll_manual_adjustments (nik, period_year, period_month);
            END;
        `);

        ManualAdjustmentService.identitySchemaEnsured = true;
    }

    /**
     * Get all manual adjustments for a specific period and gang
     */
    public async getAdjustments(
        month: number,
        year: number,
        gangCode?: string,
        empCode?: string,
        divisionCode?: string,
        adjustmentType?: string,
        adjustmentName?: string,
        metadataOnly: boolean = false
    ): Promise<ManualAdjustment[]> {
        const db = this.getDatabase();
        await this.ensureManualAdjustmentIdentitySchema(db);
        let query = `
            SELECT * FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND adjustment_type IN ('PREMI', 'POTONGAN_KOTOR', 'POTONGAN_BERSIH', 'PENDAPATAN_LAINNYA', 'AUTO_BUFFER')
        `;
        const params: any[] = [month, year];

        if (divisionCode) {
            const divisionCodes = getManualAdjustmentDivisionCodeVariants(divisionCode);
            if (divisionCodes.length === 1) {
                query += ` AND (division_code = ? OR division_code IS NULL OR LTRIM(RTRIM(division_code)) = '')`;
                params.push(divisionCodes[0]);
            } else if (divisionCodes.length > 1) {
                query += ` AND (division_code IN (${divisionCodes.map(() => '?').join(', ')}) OR division_code IS NULL OR LTRIM(RTRIM(division_code)) = '')`;
                params.push(...divisionCodes);
            }
        }

        if (gangCode && gangCode !== 'ALL') {
            query += ` AND gang_code = ?`;
            params.push(gangCode);
        }

        if (empCode) {
            const lookup = await resolveManualAdjustmentLookupIdentity(empCode);
            query += ` AND (emp_code = ? OR nik = ? OR emp_code = ?)`;
            params.push(lookup.empCode, lookup.nik, lookup.originalIdentifier);
        }

        if (adjustmentType) {
            const MANUAL_ALIAS_TYPES = ['PREMI', 'POTONGAN_KOTOR', 'POTONGAN_BERSIH', 'PENDAPATAN_LAINNYA'];
            const rawTypes = adjustmentType.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
            const resolvedTypes = rawTypes.flatMap(t =>
                t === 'MANUAL' ? MANUAL_ALIAS_TYPES : [t]
            );
            if (resolvedTypes.length === 1) {
                query += ` AND adjustment_type = ?`;
                params.push(resolvedTypes[0]);
            } else if (resolvedTypes.length > 1) {
                query += ` AND adjustment_type IN (${resolvedTypes.map(() => '?').join(', ')})`;
                params.push(...resolvedTypes);
            }
        }

        if (adjustmentName) {
            query += ` AND UPPER(adjustment_name) LIKE ?`;
            params.push(`%${adjustmentName.toUpperCase()}%`);
        }

        if (metadataOnly) {
            query += ` AND metadata_json IS NOT NULL AND LTRIM(RTRIM(metadata_json)) <> ''`;
        }

        const rows = await db.query<ManualAdjustment>(query, params);
        return await enrichManualAdjustmentRowsWithJabatan(rows);
    }

    /**
     * GET manual adjustments dengan real-time sync/match recompute vs ADTRANS.
     * Mengembalikan ManualAdjustmentApiResponseRow (sudah enriched metadata + ad_code)
     * + computed sync_status/match_status/adtrans_amount/diff/is_stale.
     * remarks baked tetap dipertahankan untuk audit; computed field = source of truth real-time.
     */
    public async getAdjustmentsWithSyncRecompute(
        month: number,
        year: number,
        gangCode?: string,
        empCode?: string,
        divisionCode?: string,
        adjustmentType?: string,
        adjustmentName?: string,
        metadataOnly: boolean = false
    ): Promise<ManualAdjustmentApiResponseRow[]> {
        const rows = await this.getAdjustments(month, year, gangCode, empCode, divisionCode, adjustmentType, adjustmentName, metadataOnly);
        const apiRows = buildManualAdjustmentApiResponseRows(rows);

        if (rows.length === 0) return apiRows;

        // ponytail: batch 1 ADTRANS query untuk semua rows. onlyIfAdtransExists semantics:
        //  rows tanpa ADTRANS match -> MISS/MISMATCH (muncul sbg mismatch, sesuai req user).
        const adtransDetails = await this.fetchManualAdjustmentSyncAdtransDetails(month, year, divisionCode, rows);
        const computedMap = computeManualAdjustmentSyncStatuses(rows, adtransDetails);

        return apiRows.map((row) => {
            const id = Number(row.id);
            const computed = computedMap.get(id);
            if (!computed) return row;
            return {
                ...row,
                sync_status: computed.sync_status,
                match_status: computed.match_status,
                target_amount: computed.target_amount,
                adtrans_amount: computed.adtrans_amount,
                diff: computed.diff,
                is_stale: computed.is_stale,
                has_adtrans: computed.has_adtrans,
                baked_sync: computed.baked_sync,
                baked_match: computed.baked_match
            };
        });
    }

    /**
     * Write-back real-time sync/match remarks untuk 1 row (dipanggil saveAdjustment).
     * Best-effort: gagal silent, jangan fail save. Bangun pipe-delimited remarks bila
     * remarks existing bukan format pipe (legacy "AD CODE:" tanpa sync:/match: segment).
     */
    private async writeBackSyncStatusForId(id: number, user?: string): Promise<void> {
        try {
            if (!id) return;
            const db = this.getDatabase();
            await this.ensureManualAdjustmentIdentitySchema(db);
            const rows = await db.query<ManualAdjustment>(`
                SELECT TOP 1 id, period_month, period_year, emp_code, nik, emp_name, gang_code,
                       division_code, adjustment_type, adjustment_name, amount, remarks, metadata_json
                FROM dbo.payroll_manual_adjustments
                WHERE id = ?
            `, [id]);
            const row = rows[0];
            if (!row) return;

            const adtransDetails = await this.fetchManualAdjustmentSyncAdtransDetails(
                Number(row.period_month), Number(row.period_year), row.division_code || undefined, [row]
            );
            const computedMap = computeManualAdjustmentSyncStatuses([row], adtransDetails);
            const computed = computedMap.get(Number(row.id));
            if (!computed) return;

            // remarks_fresh null bila remarks bukan pipe-delimited -> build pipe format fresh.
            // ponytail: format baku = "name | ad_code | amount | sync:STATUS | match:STATUS".
            let freshRemarks = computed.remarks_fresh;
            if (!freshRemarks) {
                const adCodeFields = resolveManualAdjustmentResponseAdCodeFields(row);
                const adCodePart = adCodeFields.ad_code || adCodeFields.task_desc || '';
                freshRemarks = `${normalizeStoredAdjustmentName(row.adjustment_name)} | ${adCodePart} | ${computed.target_amount} | sync:${computed.sync_status} | match:${computed.match_status}`;
            }

            // cek apakah remarks berubah
            const currentRemarks = String(row.remarks || '').trim();
            if (currentRemarks === String(freshRemarks).trim()) return;

            await db.query(`
                UPDATE dbo.payroll_manual_adjustments
                SET remarks = ?, updated_at = GETDATE(), updated_by = ?
                WHERE id = ?
            `, [freshRemarks, user || 'sync_writeback', id]);
        } catch (e) {
            console.warn('[writeBackSyncStatusForId] best-effort write-back failed:', e);
        }
    }

    public async listAdjustmentNameOptions(input: {
        periodMonth?: number;
        periodYear?: number;
        divisionCode?: string;
        gangCode?: string;
        adjustmentTypes?: string[];
        search?: string;
        metadataOnly?: boolean;
        limit?: number;
    }): Promise<ManualAdjustmentNameOption[]> {
        const db = this.getDatabase();
        await this.ensureManualAdjustmentIdentitySchema(db);

        const allowedTypes = new Set(["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH"]);
        const adjustmentTypes = (input.adjustmentTypes || Array.from(allowedTypes))
            .map((type) => normalizeText(type).toUpperCase())
            .filter((type) => allowedTypes.has(type));
        const resolvedTypes = adjustmentTypes.length ? Array.from(new Set(adjustmentTypes)) : Array.from(allowedTypes);
        const params: any[] = [];
        const limit = Math.min(Math.max(Number(input.limit) || 200, 1), 500);
        let query = `
            SELECT DISTINCT TOP (${limit})
                RTRIM(LTRIM(adjustment_type)) AS adjustment_type,
                RTRIM(LTRIM(adjustment_name)) AS adjustment_name
            FROM dbo.payroll_manual_adjustments
            WHERE adjustment_type IN (${resolvedTypes.map(() => "?").join(", ")})
              AND NULLIF(LTRIM(RTRIM(adjustment_name)), '') IS NOT NULL
        `;
        params.push(...resolvedTypes);

        if (Number.isInteger(input.periodMonth)) {
            query += ` AND period_month = ?`;
            params.push(input.periodMonth);
        }

        if (Number.isInteger(input.periodYear)) {
            query += ` AND period_year = ?`;
            params.push(input.periodYear);
        }

        if (input.divisionCode) {
            const divisionCodes = getManualAdjustmentDivisionCodeVariants(input.divisionCode);
            if (divisionCodes.length === 1) {
                query += ` AND division_code = ?`;
                params.push(divisionCodes[0]);
            } else if (divisionCodes.length > 1) {
                query += ` AND division_code IN (${divisionCodes.map(() => "?").join(", ")})`;
                params.push(...divisionCodes);
            }
        }

        if (input.gangCode) {
            query += ` AND UPPER(gang_code) = ?`;
            params.push(normalizeIdentityValue(input.gangCode));
        }

        if (input.search) {
            query += ` AND UPPER(adjustment_name) LIKE ?`;
            params.push(`%${normalizeText(input.search).toUpperCase()}%`);
        }

        if (input.metadataOnly) {
            query += ` AND metadata_json IS NOT NULL AND LTRIM(RTRIM(metadata_json)) <> ''`;
        }

        query += ` ORDER BY adjustment_type ASC, adjustment_name ASC`;

        return (await db.query<ManualAdjustmentNameOption>(query, params))
            .map((row) => ({
                adjustment_type: normalizeText(row.adjustment_type).toUpperCase(),
                adjustment_name: normalizeStoredAdjustmentName(row.adjustment_name)
            }))
            .filter((row) => row.adjustment_type && row.adjustment_name);
    }

    private async fetchManualAdjustmentSyncAdtransDetails(
        periodMonth: number,
        periodYear: number,
        divisionCode: string | undefined,
        rows: ManualAdjustment[]
    ): Promise<ManualAdjustmentSyncAdtransDetail[]> {
        const empCodes = Array.from(new Set(rows
            .map((row) => normalizeIdentityValue(row.emp_code))
            .filter(Boolean)));
        const locCodes = Array.from(new Set((divisionCode
            ? [resolveAdtransLocCode(divisionCode)]
            : rows.map((row) => resolveAdtransLocCode(normalizeText(row.division_code))))
            .filter(Boolean)));

        if (empCodes.length === 0 || locCodes.length === 0) return [];

        const dbPtrj = Database.getInstance();
        const locSql = locCodes.length === 1
            ? "UPPER(RTRIM(t.LocCode)) = ?"
            : `UPPER(RTRIM(t.LocCode)) IN (${locCodes.map(() => "?").join(", ")})`;
        const empSql = empCodes.length === 1
            ? "RTRIM(t.EmpCode) = ?"
            : `RTRIM(t.EmpCode) IN (${empCodes.map(() => "?").join(", ")})`;
        const selectSql = (headerTable: string, lineTable: string, statusFilter: string) => `
            SELECT
                RTRIM(t.EmpCode) as emp_code,
                RTRIM(t.DocID) as doc_id,
                RTRIM(t.DocDesc) as doc_desc,
                SUM(ln.Amount) as amount
            FROM ${headerTable} t
            JOIN ${lineTable} ln ON t.ID = ln.MasterID
            WHERE ${locSql}
              AND t.PhyMonth = ?
              AND t.PhyYear = ?
              AND ${empSql}
              AND t.Status = ${statusFilter}
            GROUP BY t.EmpCode, t.DocID, t.DocDesc
        `;

        const params = [
            ...locCodes,
            periodMonth,
            periodYear,
            ...empCodes,
            ...locCodes,
            periodMonth,
            periodYear,
            ...empCodes
        ];

        const rowsFromAdtrans = await dbPtrj.query<ManualAdjustmentSyncAdtransDetail>(`
            ${selectSql("PR_ADTRANS", "PR_ADTRANSLN", "1")}
            UNION ALL
            ${selectSql("PR_ADTRANS_ARC", "PR_ADTRANSLN_ARC", "3")}
        `, params);

        return rowsFromAdtrans.map((row) => ({
            emp_code: normalizeIdentityValue(row.emp_code),
            doc_id: row.doc_id ? normalizeText(row.doc_id) : null,
            doc_desc: normalizeText(row.doc_desc),
            amount: toNumericAmount(row.amount)
        }));
    }

    public async updateManualAdjustmentSyncStatus(input: ManualAdjustmentSyncStatusUpdateInput): Promise<ManualAdjustmentSyncStatusUpdateResult> {
        const periodMonth = Number(input.periodMonth);
        const periodYear = Number(input.periodYear);
        if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
            throw new Error("periodMonth harus 1-12");
        }
        if (!Number.isInteger(periodYear) || periodYear < 2000) {
            throw new Error("periodYear tidak valid");
        }

        const targetSyncStatus = normalizeSyncStatus(input.syncStatus || "SYNC");
        if (!targetSyncStatus) throw new Error("syncStatus wajib diisi");

        const db = this.getDatabase();
        await this.ensureManualAdjustmentIdentitySchema(db);
        const adjustmentTypes = normalizeManualAdjustmentSyncTypes(input.adjustmentTypes);
        const ids = Array.from(new Set((input.ids || [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)));
        const limit = Math.min(Math.max(Number(input.limit) || 1000, 1), 5000);
        const params: any[] = [periodMonth, periodYear, ...adjustmentTypes];
        let query = `
            SELECT TOP (${limit})
                id,
                period_month,
                period_year,
                emp_code,
                nik,
                emp_name,
                gang_code,
                division_code,
                adjustment_type,
                adjustment_name,
                amount,
                remarks,
                metadata_json
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ?
              AND period_year = ?
              AND adjustment_type IN (${adjustmentTypes.map(() => "?").join(", ")})
              AND remarks IS NOT NULL
              AND remarks LIKE '%sync:%'
        `;

        if (input.divisionCode) {
            const divisionCodes = getManualAdjustmentDivisionCodeVariants(input.divisionCode);
            if (divisionCodes.length === 1) {
                query += ` AND division_code = ?`;
                params.push(divisionCodes[0]);
            } else if (divisionCodes.length > 1) {
                query += ` AND division_code IN (${divisionCodes.map(() => "?").join(", ")})`;
                params.push(...divisionCodes);
            }
        }

        if (input.gangCode) {
            query += ` AND UPPER(gang_code) = ?`;
            params.push(normalizeIdentityValue(input.gangCode));
        }

        if (input.empCode) {
            const lookup = await resolveManualAdjustmentLookupIdentity(input.empCode);
            query += ` AND (emp_code = ? OR nik = ? OR emp_code = ?)`;
            params.push(lookup.empCode, lookup.nik, lookup.originalIdentifier);
        }

        if (input.adjustmentName) {
            query += ` AND UPPER(adjustment_name) LIKE ?`;
            params.push(`%${normalizeText(input.adjustmentName).toUpperCase()}%`);
        }

        if (ids.length > 0) {
            query += ` AND id IN (${ids.map(() => "?").join(", ")})`;
            params.push(...ids);
        }

        query += ` ORDER BY id ASC`;

        const rows = (await db.query<ManualAdjustment>(query, params))
            .filter((row) => {
                const type = normalizeText(row.adjustment_type).toUpperCase();
                return adjustmentTypes.includes(type);
            });
        const adtransDetails = input.onlyIfAdtransExists
            ? await this.fetchManualAdjustmentSyncAdtransDetails(periodMonth, periodYear, input.divisionCode, rows)
            : [];
        // ponytail: recompute real-time via pure fn; branch onlyIfAdtransExists=false tetap force targetSyncStatus.
        const computedMap = input.onlyIfAdtransExists
            ? computeManualAdjustmentSyncStatuses(rows, adtransDetails)
            : null;

        let eligibleCount = 0;
        let adtransMatchedCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;
        let skippedCount = 0;
        let partialCount = 0;
        const resultRows: ManualAdjustmentSyncStatusRowResult[] = [];

        for (const row of rows) {
            const id = Number(row.id);
            const empCode = normalizeIdentityValue(row.emp_code);
            const estateCode = normalizeIdentityValue(row.division_code);
            const amountInfo = resolveManualAdjustmentSyncTargetAmount(row);
            const adCodeFields = resolveManualAdjustmentResponseAdCodeFields(row);
            const initialUpdate = input.onlyIfAdtransExists
                ? null
                : updatePipeDelimitedSyncStatus(row.remarks, targetSyncStatus);
            const baseResult: ManualAdjustmentSyncStatusRowResult = {
                id,
                emp_code: empCode,
                nik: normalizeIdentityValue(row.nik) || null,
                emp_name: normalizeIdentityValue(row.emp_name) || null,
                gang_code: normalizeIdentityValue(row.gang_code),
                estate: estateCode,
                adjustment_type: normalizeText(row.adjustment_type).toUpperCase(),
                adjustment_name: normalizeStoredAdjustmentName(row.adjustment_name),
                amount: toNumericAmount(row.amount),
                target_amount: amountInfo.targetAmount,
                metadata_detail_total: amountInfo.metadataDetailTotal,
                adtrans_amount: null,
                ad_code: adCodeFields.ad_code,
                ad_code_desc: adCodeFields.ad_code_desc,
                ad_desc: adCodeFields.ad_desc,
                task_desc: adCodeFields.task_desc,
                old_sync_status: initialUpdate?.oldSyncStatus || null,
                new_sync_status: initialUpdate?.newSyncStatus || null,
                match_status: null,
                diff: null,
                status: "SKIPPED",
                skip_reason: null,
                remarks_before: row.remarks || null,
                remarks_after: null,
                adtrans_details: []
            };

            if (!id) {
                skippedCount++;
                resultRows.push({
                    ...baseResult,
                    skip_reason: "SYNC_SEGMENT_NOT_FOUND"
                });
                continue;
            }

            eligibleCount++;
            let update = initialUpdate;

            if (input.onlyIfAdtransExists) {
                const computed = computedMap?.get(id);
                // re-call parser untuk dapat old/new + changed + null-detection (remarks tanpa sync: segment)
                const reconciliationUpdate = computed
                    ? updatePipeDelimitedSyncAndMatchStatus(row.remarks, computed.sync_status, computed.match_status)
                    : null;
                update = reconciliationUpdate;
                baseResult.old_sync_status = reconciliationUpdate?.oldSyncStatus || null;
                baseResult.new_sync_status = reconciliationUpdate?.newSyncStatus || null;
                baseResult.match_status = reconciliationUpdate?.newMatchStatus || null;
                baseResult.adtrans_amount = computed?.adtrans_amount ?? null;
                baseResult.diff = computed?.diff ?? null;
                baseResult.adtrans_details = computed?.adtrans_details ?? [];

                if (!update) {
                    skippedCount++;
                    resultRows.push({
                        ...baseResult,
                        skip_reason: "SYNC_SEGMENT_NOT_FOUND"
                    });
                    continue;
                }

                if (computed?.has_adtrans) {
                    adtransMatchedCount++;
                }
            }

            if (!update) {
                skippedCount++;
                resultRows.push({
                    ...baseResult,
                    skip_reason: "SYNC_SEGMENT_NOT_FOUND"
                });
                continue;
            }

            if (!update.changed) {
                unchangedCount++;
                resultRows.push({
                    ...baseResult,
                    status: "UNCHANGED",
                    remarks_after: update.remarks
                });
                continue;
            }

            if (!input.dryRun) {
                await db.query(`
                    UPDATE dbo.payroll_manual_adjustments
                    SET remarks = ?, updated_at = GETDATE(), updated_by = ?
                    WHERE id = ?
                `, [update.remarks, input.updatedBy || "sync_status_api", id]);
            }

            updatedCount++;
            resultRows.push({
                ...baseResult,
                status: "UPDATED",
                remarks_after: update.remarks
            });
        }

        return {
            period_month: periodMonth,
            period_year: periodYear,
            target_sync_status: targetSyncStatus,
            only_if_adtrans_exists: !!input.onlyIfAdtransExists,
            dry_run: !!input.dryRun,
            matched_count: rows.length,
            eligible_count: eligibleCount,
            adtrans_matched_count: adtransMatchedCount,
            updated_count: updatedCount,
            unchanged_count: unchangedCount,
            skipped_count: skippedCount,
            partial_count: partialCount,
            rows: resultRows
        };
    }

    /**
     * Save PENDAPATAN_LAINNYA (e.g. KONTAN) to employee_other_incomes table.
     * Uses upsert logic: update if exists (same nik/emp_code + period + income_name), insert if not.
     *
     * STORAGE STRATEGY:
     * - nik: Real NIK (KTP) - primary stable identifier for data extractor lookup
     * - emp_code: Employee code (B0065, etc.) - for emp_code-based lookup fallback
     * - Both fields stored so data extractor can find by either
     *
     * The frontend sends both `nik` (real NIK) and `emp_code` (B0065, etc.)
     * to ensure the data extractor can find the record.
     */
    private async saveOtherIncome(db: Database, data: ManualAdjustment, parsedAmount: number, user?: string): Promise<number> {
        const incomeType = data.adjustment_name; // e.g. 'KONTAN'
        const incomeName = normalizeStoredAdjustmentName(data.adjustment_name); // e.g. 'KONTAN'
        const normalizedDivisionCode = normalizeManualAdjustmentDivisionCode(data.division_code);
        // Use real NIK for nik field, emp_code for emp_code field
        const realNik = (data.nik || '').trim().toUpperCase() || (data.emp_code || '').trim().toUpperCase();
        const empCodeVal = (data.emp_code || '').trim().toUpperCase();

        console.log(`[saveOtherIncome] Saving: nik=${realNik}, emp_code=${empCodeVal}, income=${incomeName}, amount=${parsedAmount}`);

        // Check for existing record: try by nik, then by emp_code
        let existing = await db.queryOne<{ id: number; nik: string; emp_code: string }>(`
            SELECT id, nik, emp_code FROM dbo.employee_other_incomes
            WHERE nik = ? AND period_month = ? AND period_year = ?
            AND ${buildNormalizedSqlNameExpression('income_name')} = ?
        `, [realNik, data.period_month, data.period_year, incomeName]);

        // Fallback: check by emp_code if not found by nik
        if (!existing) {
            existing = await db.queryOne<{ id: number; nik: string; emp_code: string }>(`
                SELECT id, nik, emp_code FROM dbo.employee_other_incomes
                WHERE emp_code = ? AND period_month = ? AND period_year = ?
                AND ${buildNormalizedSqlNameExpression('income_name')} = ?
            `, [empCodeVal, data.period_month, data.period_year, incomeName]);
        }

        if (existing) {
            if (parsedAmount === 0) {
                await db.query(`DELETE FROM dbo.employee_other_incomes WHERE id = ?`, [existing.id]);
                console.log(`[saveOtherIncome] Deleted ${incomeName} for nik=${realNik}, emp_code=${empCodeVal}`);
                return existing.id;
            }
            // Update existing: store BOTH nik and emp_code for consistent lookups
            await db.query(`
                UPDATE dbo.employee_other_incomes
                SET nik = ?, emp_code = ?, amount = ?, updated_at = GETDATE()
                WHERE id = ?
            `, [realNik, empCodeVal, parsedAmount, existing.id]);
            console.log(`[saveOtherIncome] Updated ${incomeName}: nik=${realNik}, emp_code=${empCodeVal}: Rp${parsedAmount}`);
            return existing.id;
        } else {
            if (parsedAmount === 0) return 0; // Don't insert zero

            // Insert new record with BOTH nik and emp_code
            const result = await db.query(`
                INSERT INTO dbo.employee_other_incomes (
                    nik, emp_code, emp_name, division_code, gang_code,
                    period_year, period_month, income_type, income_name,
                    amount, is_paid_in_thp, is_taxable,
                    created_at, updated_at
                ) OUTPUT INSERTED.id VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE()
                )
            `, [
                realNik,            // nik = real NIK (KTP) - primary lookup key
                empCodeVal,         // emp_code = emp_code - secondary lookup key
                null,               // emp_name - null, enriched by data extractor
                normalizedDivisionCode,
                data.gang_code,
                data.period_year,
                data.period_month,
                incomeType,         // income_type = 'KONTAN'
                incomeName,         // income_name = 'KONTAN'
                parsedAmount,
                0,                  // is_paid_in_thp = false (added to gross wage, not THP)
                0,                  // is_taxable = false (not taxable income)
            ]);
            const id = result[0]?.id;
            console.log(`[saveOtherIncome] Inserted ${incomeName}: nik=${realNik}, emp_code=${empCodeVal}: Rp${parsedAmount}, ID=${id}`);
            return id;
        }
    }

    /**
     * Save a manual adjustment (Insert or Update)
     *
     * Special handling for PENDAPATAN_LAINNYA:
     * - Saves to employee_other_incomes table (like THR, Bonus, Custom)
     * - is_paid_in_thp = false (added to gross wage, not THP)
     * - is_taxable = false (not taxable income)
     */
    public async saveAdjustment(data: ManualAdjustment, user?: string): Promise<number> {
        data = normalizeManualAdjustmentForSave(data);

        // Validate metadata_json if provided — reject invalid JSON or missing input_type
        if (data.metadata_json !== undefined && data.metadata_json !== null) {
            const rawMeta = typeof data.metadata_json === "string" ? data.metadata_json : JSON.stringify(data.metadata_json);
            if (rawMeta && typeof rawMeta === "string" && rawMeta.trim() !== "") {
                try {
                    const parsed = JSON.parse(rawMeta);
                    if (!parsed || !parsed.input_type) {
                        throw new Error("metadata_json must have an 'input_type' field");
                    }
                    // Reject unknown input_type values
                    const validInputTypes = ["amount", "blok", "exp", "kendaraan", "blok,exp"];
                    if (!validInputTypes.includes(parsed.input_type)) {
                        throw new Error(`metadata_json input_type "${parsed.input_type}" not supported. Use: ${validInputTypes.join(", ")}`);
                    }
                } catch (err: any) {
                    if (err.message.includes("input_type") || err.message.includes("not supported")) {
                        throw err;
                    }
                    throw new Error(`metadata_json is not valid JSON: ${err.message}`);
                }
            }
        }

        // Ensure amount is a valid float
        const parsedAmount = parseFloat(data.amount.toString()) || 0;
        const normalizedAdjustmentName = normalizeStoredAdjustmentName(data.adjustment_name);
        const normalizedAdjustmentNameSql = buildNormalizedSqlNameExpression('adjustment_name');

        // [GUARD] Karyawan panen (gang_code berakhiran 'H', mis. J1H/J2H) seharusnya
        // mendapat PREMI INSENTIF PANEN, BUKAN PREMI KINERJA. Tolak input PREMI KINERJA
        // untuk gang-H agar kesalahan input tidak terulang.
        // EXCEPTION: mandor dan kerani boleh tetap dapat PREMI KINERJA (role non-panen).
        const gangCodeForGuard = String(data.gang_code || '').trim().toUpperCase();
        if (normalizedAdjustmentName === 'PREMI KINERJA' && gangCodeForGuard.endsWith('H')) {
            const rawJabatan = normalizeText(data.jabatan_estate || data.jabatan || '');
            let jabatanForGuard = rawJabatan;
            if (!jabatanForGuard && data.emp_code) {
                try {
                    const extDb = Database.getExtendedInstance();
                    const estateRow = await extDb.query<{ jabatan: string }>(
                        "SELECT TOP 1 jabatan FROM employee_estate WHERE RTRIM(empcode) = ?",
                        [String(data.emp_code).trim()]
                    );
                    jabatanForGuard = normalizeText(estateRow[0]?.jabatan || '');
                } catch { /* fall through to reject if lookup fails */ }
            }
            const isMandorOrKerani = /MANDOR|KERANI|KRANI/i.test(jabatanForGuard);
            if (!isMandorOrKerani) {
                throw new Error(
                    `PREMI KINERJA tidak boleh diinput untuk karyawan panen (gang berakhiran 'H', gang=${gangCodeForGuard}). ` +
                    `Gunakan PREMI INSENTIF PANEN untuk karyawan panen. ` +
                    `Khusus mandor/kerani boleh PREMI KINERJA (jabatan terdeteksi: "${jabatanForGuard || 'tidak diketahui'}").`
                );
            }
        }
        const normalizedDivisionCode = normalizeManualAdjustmentDivisionCode(data.division_code);
        const hasMetadataJsonInput = Object.prototype.hasOwnProperty.call(data, 'metadata_json');
        let metadataJsonStr = serializeManualAdjustmentMetadata(data.metadata_json);
        const detailTotalSync = resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, parsedAmount);
        metadataJsonStr = detailTotalSync.metadataJsonStr;
        const effectiveAmount = detailTotalSync.amount;
        validatePremiumAdjustmentDefinition(data, normalizedAdjustmentName);
        validateManualAdjustmentAdCode(data);
        const remarks = buildManualAdjustmentRemarks(data);
        const db = this.getDatabase();
        await this.ensureManualAdjustmentIdentitySchema(db);
        const identity = await resolveManualAdjustmentIdentity(data);
        const empName = identity.empName;

        // --- PENDAPATAN_LAINNYA: Save to employee_other_incomes ---
        if (data.adjustment_type === 'PENDAPATAN_LAINNYA') {
            console.log(`[saveAdjustment] PENDAPATAN_LAINNYA: emp_code=${data.emp_code}, gang=${data.gang_code}, name=${normalizedAdjustmentName}, amount=${effectiveAmount}`);
            return await this.saveOtherIncome(db, { ...data, adjustment_name: normalizedAdjustmentName, remarks: remarks || undefined }, effectiveAmount, user);
        }

        // --- Standard adjustments: Save to payroll_manual_adjustments ---

        // Check if an exact match exists
        const existing = await db.queryOne<{ id: number }>(`
            SELECT TOP 1 id FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ? 
            AND (emp_code = ? OR nik = ? OR emp_code = ?)
            AND adjustment_type = ?
            AND ${normalizedAdjustmentNameSql} = ?
            ORDER BY
                CASE
                    WHEN emp_code = ? THEN 0
                    WHEN nik = ? THEN 1
                    WHEN emp_code = ? THEN 2
                    ELSE 3
                END,
                id DESC
        `, [
            data.period_month, data.period_year,
            identity.empCode, identity.nik, identity.originalIdentifier,
            data.adjustment_type, normalizedAdjustmentName,
            identity.empCode, identity.nik, identity.originalIdentifier
        ]);

        if (existing && !data.force_insert) {
            if (shouldDeleteStoredAdjustment(effectiveAmount, data.remarks, !!metadataJsonStr)) {
                // If amount is 0, delete it from the table
                await db.query(`DELETE FROM dbo.payroll_manual_adjustments WHERE id = ?`, [existing.id]);
                return existing.id;
            } else {
                // Update. Preserve existing detail metadata when a regular amount edit
                // does not submit metadata_json, otherwise seeded sub-block detail is lost.
                await db.query(`
                    UPDATE dbo.payroll_manual_adjustments
                    SET emp_code = ?,
                        nik = ?,
                        gang_code = COALESCE(NULLIF(LTRIM(RTRIM(?)), ''), gang_code),
                        division_code = COALESCE(?, division_code),
                        amount = ?,
                        remarks = ?,
                        metadata_json = ${hasMetadataJsonInput ? '?' : 'metadata_json'},
                        emp_name = ?,
                        updated_at = GETDATE(),
                        updated_by = ?
                    WHERE id = ?
                `, hasMetadataJsonInput
                    ? [identity.empCode, identity.nik, data.gang_code, normalizedDivisionCode, effectiveAmount, remarks, metadataJsonStr, empName, user || 'system', existing.id]
                    : [identity.empCode, identity.nik, data.gang_code, normalizedDivisionCode, effectiveAmount, remarks, empName, user || 'system', existing.id]);
                // real-time sync/match write-back (await supaya deterministic; +2 queries, save non-hot-path)
                await this.writeBackSyncStatusForId(existing.id, user);
                return existing.id;
            }
        } else {
            if (shouldDeleteStoredAdjustment(effectiveAmount, data.remarks, !!metadataJsonStr)) return 0; // Don't insert zero

            // Insert
            const result = await db.query(`
                INSERT INTO dbo.payroll_manual_adjustments (
                    period_month, period_year, emp_code, nik, emp_name, gang_code, division_code,
                    adjustment_type, adjustment_name, amount, remarks, metadata_json, created_by
                ) OUTPUT INSERTED.id VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            `, [
                data.period_month, data.period_year, identity.empCode, identity.nik, empName, data.gang_code, normalizedDivisionCode,
                data.adjustment_type, normalizedAdjustmentName, effectiveAmount, remarks, metadataJsonStr, user || 'system'
            ]);

            // Auto-save as preset for recent/history (fire-and-forget)
            try {
                const { manualAdjustmentPresetService } = await import("./manualAdjustmentPresetService");
                const mappedPresetFields = await resolveManualAdjustmentPresetMapping(data, normalizedAdjustmentName);
                const presetData = { ...data, ...mappedPresetFields };
                const presetAdCode = resolveManualAdjustmentPresetCode(presetData);
                if (presetAdCode) {
                    const presetTaskCode = normalizeManualAdjustmentPresetCode(presetData.task_code) || presetAdCode;
                    const presetBaseTaskCode = normalizeManualAdjustmentPresetCode(presetData.base_task_code) || presetAdCode;
                    await manualAdjustmentPresetService.upsertPreset({
                        adjustment_type: data.adjustment_type,
                        adjustment_name: normalizedAdjustmentName,
                        ad_code: presetAdCode,
                        task_code: presetTaskCode,
                        base_task_code: presetBaseTaskCode,
                        task_desc: presetData.task_desc,
                        division_code: data.division_code || null,
                        remarks_template: buildManualAdjustmentRemarks({
                            ...presetData,
                            adjustment_name: normalizedAdjustmentName,
                            remarks: data.remarks
                        }) || undefined
                    }, user);
                }
            } catch (e) {
                // Silent fail — preset upsert is best-effort
                console.warn('[saveAdjustment] Auto-preset upsert failed:', e);
            }

            const insertedId = result[0]?.id;
            if (insertedId) {
                // real-time sync/match write-back (await supaya deterministic)
                await this.writeBackSyncStatusForId(insertedId, user);
            }
            return insertedId;
        }
    }

    /**
     * Delete an adjustment by id
     */
    public async deleteAdjustment(id: number): Promise<void> {
        const db = this.getDatabase();
        await db.query(`DELETE FROM dbo.payroll_manual_adjustments WHERE id = ?`, [id]);
    }

    public async deleteAdjustmentColumn(input: {
        period_month: number;
        period_year: number;
        division_code?: string;
        adjustment_type: string;
        adjustment_name: string;
    }): Promise<number> {
        const db = this.getDatabase();
        const normalizedAdjustmentName = normalizeStoredAdjustmentName(input.adjustment_name);
        const normalizedAdjustmentNameSql = buildNormalizedSqlNameExpression('adjustment_name');
        const params: any[] = [
            input.period_month,
            input.period_year,
            input.adjustment_type,
            normalizedAdjustmentName
        ];
        let divisionFilter = '';

        if (input.division_code) {
            divisionFilter = ' AND division_code = ?';
            params.push(normalizeManualAdjustmentDivisionCode(input.division_code) || input.division_code);
        }

        const existing = await db.query<{ id: number }>(`
            SELECT id FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND adjustment_type = ?
              AND ${normalizedAdjustmentNameSql} = ?
              ${divisionFilter}
        `, params);

        await db.query(`
            DELETE FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND adjustment_type = ?
              AND ${normalizedAdjustmentNameSql} = ?
              ${divisionFilter}
        `, params);

        return existing.length;
    }

    /**
     * Convert a premium column from one adjustment_name to another (per-column bulk).
     * Validation gate (validatePremiumConversion) MUST pass before DB writes —
     * blocks subblok↔kendaraan semantic mismatch.
     *
     * metadata_action from validation:
     * - keep: same input_type, preserve metadata_json
     * - drop: target amount, null metadata_json, amount = old total
     * - seed: source amount → target structured, placeholder single-item metadata
     * - remap: compatible different type, restructure metadata
     *
     * Collision (to_name already exists for same emp+period+type) → skip row, amount lama tetap.
     */
    public async convertAdjustmentType(input: {
        period_month: number;
        period_year: number;
        division_code?: string;
        adjustment_type: string;
        from_adjustment_name: string;
        to_adjustment_name: string;
        updated_by?: string;
    }): Promise<{
        converted_count: number;
        skipped_collision_count: number;
        metadata_remapped_count: number;
        metadata_seeded_count: number;
        rows: Array<{ id: number; emp_code: string; status: 'CONVERTED' | 'SKIPPED_COLLISION'; metadata_action: string }>;
    }> {
        const periodMonth = Number(input.period_month);
        const periodYear = Number(input.period_year);
        if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
            throw new Error("period_month harus 1-12");
        }
        if (!Number.isInteger(periodYear) || periodYear < 2000) {
            throw new Error("period_year tidak valid");
        }

        const fromName = normalizeStoredAdjustmentName(input.from_adjustment_name);
        const toName = normalizeStoredAdjustmentName(input.to_adjustment_name);
        if (!fromName || !toName) {
            throw new Error("from_adjustment_name dan to_adjustment_name wajib diisi.");
        }
        if (fromName === toName) {
            throw new Error("from_adjustment_name dan to_adjustment_name tidak boleh sama.");
        }

        const adjustmentType = normalizeText(input.adjustment_type).toUpperCase();
        if (adjustmentType !== "PREMI") {
            throw new Error("Konversi saat ini hanya didukung untuk adjustment_type PREMI.");
        }

        // Validation gate — blocks incompatible input_type conversions
        const validation = premiumDefinitionService.validatePremiumConversion(fromName, toName);
        if (!validation.allowed) {
            throw new Error(`Konversi diblokir: ${validation.reason}`);
        }

        const targetDef = premiumDefinitionService.getDefinitionByName(toName);
        if (!targetDef) {
            throw new Error(`Definisi target "${toName}" tidak ditemukan.`);
        }

        const db = this.getDatabase();
        await this.ensureManualAdjustmentIdentitySchema(db);
        const normalizedFromNameSql = buildNormalizedSqlNameExpression('adjustment_name');
        const normalizedToNameSql = buildNormalizedSqlNameExpression('adjustment_name');

        const params: any[] = [periodMonth, periodYear, adjustmentType, fromName];
        let divisionFilter = '';
        if (input.division_code) {
            const divisionCodes = getManualAdjustmentDivisionCodeVariants(input.division_code);
            if (divisionCodes.length === 1) {
                divisionFilter = ' AND (division_code = ? OR division_code IS NULL OR LTRIM(RTRIM(division_code)) = \'\')';
                params.push(divisionCodes[0]);
            } else if (divisionCodes.length > 1) {
                divisionFilter = ` AND (division_code IN (${divisionCodes.map(() => '?').join(', ')}) OR division_code IS NULL OR LTRIM(RTRIM(division_code)) = '')`;
                params.push(...divisionCodes);
            }
        }

        const sourceRows = await db.query<ManualAdjustment>(`
            SELECT id, period_month, period_year, emp_code, nik, emp_name, gang_code, division_code,
                   adjustment_type, adjustment_name, amount, remarks, metadata_json
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND adjustment_type = ?
              AND ${normalizedFromNameSql} = ?
              ${divisionFilter}
            ORDER BY id ASC
        `, params);

        const rows: Array<{ id: number; emp_code: string; status: 'CONVERTED' | 'SKIPPED_COLLISION'; metadata_action: string }> = [];
        let convertedCount = 0;
        let skippedCollisionCount = 0;
        let metadataRemappedCount = 0;
        let metadataSeededCount = 0;
        const user = input.updated_by || 'system';

        for (const row of sourceRows) {
            const rowId = Number(row.id);
            const empCode = normalizeIdentityValue(row.emp_code);
            const nik = normalizeIdentityValue(row.nik);

            // Collision check: row with to_name already exists for same (period+emp+type)
            const collision = await db.queryOne<{ id: number }>(`
                SELECT TOP 1 id FROM dbo.payroll_manual_adjustments
                WHERE period_month = ? AND period_year = ?
                  AND adjustment_type = ?
                  AND ${normalizedToNameSql} = ?
                  AND (emp_code = ? OR nik = ? OR emp_code = ?)
            `, [periodMonth, periodYear, adjustmentType, toName, empCode, nik, empCode]);

            if (collision) {
                skippedCollisionCount++;
                rows.push({ id: rowId, emp_code: empCode, status: 'SKIPPED_COLLISION', metadata_action: 'skip' });
                continue;
            }

            // Build new payload
            const oldAmount = toNumericAmount(row.amount);
            const oldMetadata = premiumDefinitionService.parseMetadata(row.metadata_json);
            const oldTotal = oldMetadata
                ? toNumericAmount(premiumDefinitionService.calculateMetadataTotal(oldMetadata))
                : oldAmount;
            const effectiveOldTotal = Number.isFinite(oldTotal) && Math.abs(oldTotal) > 0 ? oldTotal : oldAmount;

            const payload: ManualAdjustment = {
                ...row,
                period_month: periodMonth,
                period_year: periodYear,
                adjustment_type: adjustmentType,
                adjustment_name: toName,
                ad_code: targetDef.ad_code,
                task_code: targetDef.ad_code,
                base_task_code: targetDef.ad_code,
                task_desc: targetDef.task_desc,
                amount: effectiveOldTotal,
                metadata_json: row.metadata_json,
                remarks: undefined as any
            };

            let newMetadataJsonStr: string | null = row.metadata_json ?? null;

            if (validation.metadata_action === 'keep') {
                // preserve metadata, resolveDetailTotalSync rebuilds total_amount
            } else if (validation.metadata_action === 'drop') {
                newMetadataJsonStr = null;
                payload.metadata_json = null;
            } else if (validation.metadata_action === 'seed') {
                const seeded = seedPlaceholderMetadata(targetDef.input_type, effectiveOldTotal, row);
                newMetadataJsonStr = seeded ? JSON.stringify(seeded) : null;
                payload.metadata_json = (seeded as any) ?? null;
                metadataSeededCount++;
            } else if (validation.metadata_action === 'remap') {
                const remapped = remapMetadata(oldMetadata, validation.from_input_type, validation.to_input_type, row, effectiveOldTotal);
                newMetadataJsonStr = remapped ? JSON.stringify(remapped) : null;
                payload.metadata_json = (remapped as any) ?? null;
                metadataRemappedCount++;
            }

            // Rebuild remarks with target ad_code/task_desc, then sync amount/metadata total
            payload.remarks = buildManualAdjustmentRemarks(payload);
            const detailSync = resolveDetailTotalSync(payload, toName, newMetadataJsonStr, effectiveOldTotal);
            const finalAmount = detailSync.amount;
            const finalMetadataJson = detailSync.metadataJsonStr;

            await db.query(`
                UPDATE dbo.payroll_manual_adjustments
                SET adjustment_name = ?,
                    remarks = ?,
                    metadata_json = ?,
                    amount = ?,
                    updated_at = GETDATE(),
                    updated_by = ?
                WHERE id = ?
            `, [toName, payload.remarks, finalMetadataJson, finalAmount, user, rowId]);

            convertedCount++;
            rows.push({ id: rowId, emp_code: empCode, status: 'CONVERTED', metadata_action: validation.metadata_action });
        }

        return {
            converted_count: convertedCount,
            skipped_collision_count: skippedCollisionCount,
            metadata_remapped_count: metadataRemappedCount,
            metadata_seeded_count: metadataSeededCount,
            rows
        };
    }

    /**
     * Checks PR_ADTRANS (and ARC) directly for specific employee adjustments.
     * Uses PhyMonth and PhyYear to map to the real calendar month.
     */
    public async checkAdtransDirectly(
        periodMonth: number,
        periodYear: number,
        empCodes: string[] = [],
        filters: string[] = [],
        divisionCode?: string,
        options?: AdtransCheckOptions
    ): Promise<any> {
        const dbMain = Database.getInstance(); // db_ptrj
        const normalizedOptions = normalizeAdtransCheckOptions(options);
        const normalizedFilters = resolveAdtransCheckFilters(filters, normalizedOptions);

        if (normalizedFilters.length === 0) {
            return [];
        }

        const normalizedEmpCodes = (empCodes || []).map((empCode) => empCode.trim()).filter(Boolean);
        // Virtual divisions (NRS, INF, WKS_AR, etc.) resolve to their source division's LocCode
        const normalizedDivisionCode = divisionCode ? resolveAdtransLocCode(divisionCode) : '';
        const scopeClauses: string[] = [];
        const scopeParams: any[] = [];

        if (normalizedEmpCodes.length > 0) {
            scopeClauses.push(`RTRIM(t.EmpCode) IN (${normalizedEmpCodes.map(() => '?').join(',')})`);
            scopeParams.push(...normalizedEmpCodes);
        }

        if (normalizedDivisionCode) {
            scopeClauses.push(`UPPER(RTRIM(t.LocCode)) = ?`);
            scopeParams.push(normalizedDivisionCode);
        }

        if (scopeClauses.length === 0) {
            return [];
        }

        const scopeSql = `(${scopeClauses.join(' OR ')})`;
        const caseStatements = normalizedFilters.map((filterKey) => {
            return `SUM(CASE WHEN ${buildAdtransSqlCondition('DocDesc', filterKey)} THEN Amount ELSE 0 END) as [${filterKey}]`;
        }).join(", ");
        const specificDocDescPatterns = buildSpecificDocDescSqlPatterns(normalizedOptions);
        const specificDocDescConditions = specificDocDescPatterns
            .map(() => 'UPPER(t.DocDesc) LIKE ?')
            .join(' OR ');
        const specificDocDescWhereSql = specificDocDescConditions ? ` AND (${specificDocDescConditions})` : '';

        // IMPORTANT: diambil dari phymonth dan phyyear itu adalah real monthnya sesuai kalender
        const adtransQuery = `
            SELECT 
                emp_code, 
                ${caseStatements}
            FROM (
                SELECT 
                    RTRIM(t.EmpCode) as emp_code,
                    t.DocDesc,
                    ln.Amount
                FROM PR_ADTRANS t
                JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                WHERE ${scopeSql}
                  AND t.PhyMonth = ?
                  AND t.PhyYear = ?
                  AND t.Status = 1
                  ${specificDocDescWhereSql}

                UNION ALL

                SELECT
                    RTRIM(t.EmpCode) as emp_code,
                    t.DocDesc,
                    ln.Amount
                FROM PR_ADTRANS_ARC t
                JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                WHERE ${scopeSql}
                  AND t.PhyMonth = ?
                  AND t.PhyYear = ?
                  AND t.Status = 3
                  ${specificDocDescWhereSql}
            ) src
            GROUP BY emp_code
        `;
        
        const duplicateDocDescConditions = normalizedFilters
            .flatMap((filter) => buildAdtransSqlPatterns(filter))
            .map(() => 'UPPER(t.DocDesc) LIKE ?')
            .join(' OR ');
        const patternParams = normalizedFilters.flatMap((filter) => buildAdtransSqlPatterns(filter));

        const duplicateQuery = `
            SELECT
                t.ID as id,
                RTRIM(t.DocID) as doc_id,
                CONVERT(varchar(10), t.DocDate, 23) as doc_date,
                RTRIM(t.DocDesc) as doc_desc,
                RTRIM(t.EmpCode) as emp_code,
                RTRIM(t.EmpName) as emp_name,
                SUM(ln.Amount) as amount
            FROM PR_ADTRANS t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE ${scopeSql}
              AND t.PhyMonth = ?
              AND t.PhyYear = ?
              AND t.Status = 1
              AND (${duplicateDocDescConditions})
              ${specificDocDescWhereSql}
            GROUP BY t.ID, t.DocID, t.DocDate, t.DocDesc, t.EmpCode, t.EmpName
            HAVING SUM(ABS(ISNULL(ln.Amount, 0))) > 0.01

            UNION ALL

            SELECT
                t.ID as id,
                RTRIM(t.DocID) as doc_id,
                CONVERT(varchar(10), t.DocDate, 23) as doc_date,
                RTRIM(t.DocDesc) as doc_desc,
                RTRIM(t.EmpCode) as emp_code,
                RTRIM(t.EmpName) as emp_name,
                SUM(ln.Amount) as amount
            FROM PR_ADTRANS_ARC t
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE ${scopeSql}
              AND t.PhyMonth = ?
              AND t.PhyYear = ?
              AND t.Status = 3
              AND (${duplicateDocDescConditions})
              ${specificDocDescWhereSql}
            GROUP BY t.ID, t.DocID, t.DocDate, t.DocDesc, t.EmpCode, t.EmpName
            HAVING SUM(ABS(ISNULL(ln.Amount, 0))) > 0.01
        `;

        const [rows, duplicateRows] = await Promise.all([
            dbMain.query<any>(adtransQuery, [
                ...scopeParams,
                periodMonth,
                periodYear,
                ...specificDocDescPatterns,
                ...scopeParams,
                periodMonth,
                periodYear,
                ...specificDocDescPatterns
            ]),
            dbMain.query<AdtransDuplicateSourceRow>(duplicateQuery, [
                ...scopeParams,
                periodMonth,
                periodYear,
                ...patternParams,
                ...specificDocDescPatterns,
                ...scopeParams,
                periodMonth,
                periodYear,
                ...patternParams,
                ...specificDocDescPatterns
            ])
        ]);

        return {
            totals: rows,
            doc_desc_details: buildAdtransDocDescDetails(duplicateRows, normalizedFilters, normalizedOptions),
            duplicate_report: buildAdtransDuplicateReport(duplicateRows, normalizedFilters, normalizedOptions)
        };
    }

    // ponytail: resolve emp_codes anggota gang dari HR_GANGLN. Dipakai listAdtransDocIds utk scope gang.
    //  Upgrade: join langsung di checkAdtransDirectly kalau perlu (sekarang resolve + IN clause).
    private async resolveEmpCodesByGang(gangCode: string): Promise<string[]> {
        const normalizedGang = normalizeIdentityValue(gangCode);
        if (!normalizedGang) return [];
        try {
            const db = Database.getInstance();
            const rows = await db.query<{ emp_code: string }>(`
                SELECT RTRIM(gl.GangMember) as emp_code
                FROM HR_GANGLN gl
                JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(gl.GangMember)
                WHERE UPPER(RTRIM(gl.GangCode)) = ?
                  AND e.Status = 1
            `, [normalizedGang]);
            return Array.from(new Set(rows.map((r) => normalizeIdentityValue(r.emp_code)).filter(Boolean)));
        } catch (e) {
            console.warn("[resolveEmpCodesByGang] failed:", e);
            return [];
        }
    }

    public async listAdtransDocIds(input: AdtransDocIdLookupInput): Promise<string[]> {
        // ponytail: kalau gangCode set, resolve emp_codes dari HR_GANGLN gang itu,
        //  merge ke empCodes supaya checkAdtransDirectly (all DocID match filter) scope ke gang.
        //  checkAdtransDirectly sendiri gak support gang filter (PR_ADTRANS gak punya gang_code).
        let empCodes = input.empCodes || [];
        if (input.gangCode) {
            const gangEmps = await this.resolveEmpCodesByGang(input.gangCode);
            if (gangEmps.length > 0) {
                const merged = new Set<string>([...empCodes.map((e) => e.trim().toUpperCase()), ...gangEmps]);
                empCodes = Array.from(merged);
            }
        }
        const result = await this.checkAdtransDirectly(
            input.periodMonth,
            input.periodYear,
            empCodes,
            input.filters || [],
            input.divisionCode,
            {
                adjustmentTypes: input.adjustmentTypes || [],
                adjustmentNames: input.adjustmentNames || [],
                docDescs: input.docDescs || []
            }
        );

        const details = Array.isArray(result) ? [] : (result?.doc_desc_details || []);
        const seenDocIds = new Set<string>();
        const docIds: string[] = [];

        for (const detail of details) {
            const docId = normalizeText(detail?.doc_id);
            if (!docId || seenDocIds.has(docId)) continue;

            seenDocIds.add(docId);
            docIds.push(docId);
        }

        return docIds;
    }

    /**
     * Compare PR_ADTRANS (db_ptrj) values with payroll_manual_adjustments (extend_db_ptrj).
     * Returns per-employee per-category comparison showing source vs stored amount,
     * with match/mismatch status.
     */
    public async compareAdtransWithAdjustments(
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        filters: string[] = DEFAULT_ADTRANS_COMPARE_FILTERS
    ): Promise<{
        division: string;
        period_month: number;
        period_year: number;
        compared_categories: string[];
        total_employees: number;
        match_count: number;
        mismatch_count: number;
        missing_in_adjustments: number;
        extra_in_db_ptrj: number;
        comparisons: AdtransComparisonItem[];
    }> {
        const dbPtrj = Database.getInstance(); // db_ptrj - source of truth
        const dbExtend = this.getDatabase();   // extend_db_ptrj - stored adjustments
        await this.ensureManualAdjustmentIdentitySchema(dbExtend);

        // Virtual divisions (NRS, INF, WKS_AR, etc.) resolve to their source division's LocCode
        const normalizedDivisionCode = resolveAdtransLocCode(divisionCode);
        const normalizedFilters = filters.map(normalizeAdtransFilter).filter(Boolean);

        if (normalizedFilters.length === 0) {
            return {
                division: divisionCode,
                period_month: periodMonth,
                period_year: periodYear,
                compared_categories: [],
                total_employees: 0,
                match_count: 0,
                mismatch_count: 0,
                missing_in_adjustments: 0,
                extra_in_db_ptrj: 0,
                comparisons: []
            };
        }

        // 1. Get PR_ADTRANS totals per employee per category from db_ptrj
        const caseStatements = normalizedFilters.map((filterKey) => {
            return `SUM(CASE WHEN ${buildAdtransSqlCondition('DocDesc', filterKey)} THEN Amount ELSE 0 END) as [${filterKey}]`;
        }).join(", ");
        const requestedDivision = divisionConfigService.getDivision(divisionCode);
        const virtualGangCodes = requestedDivision?.type === 'virtual'
            ? [
                requestedDivision.code,
                ...requestedDivision.aliases.filter((alias) => requestedDivision.gangPattern?.test(alias.trim().toUpperCase()))
            ].map((code) => code.trim().toUpperCase())
            : [];
        const uniqueVirtualGangCodes = Array.from(new Set(virtualGangCodes));
        const gangJoin = uniqueVirtualGangCodes.length > 0
            ? `JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)`
            : ``;
        const gangWhere = uniqueVirtualGangCodes.length > 0
            ? `AND UPPER(RTRIM(gl.GangCode)) IN (${uniqueVirtualGangCodes.map(() => '?').join(',')})`
            : ``;

        const adtransQuery = `
            SELECT
                emp_code,
                MAX(nik) as nik,
                ${caseStatements}
            FROM (
                SELECT
                    RTRIM(t.EmpCode) as emp_code,
                    RTRIM(ISNULL(e.NewICNo, '')) as nik,
                    t.DocDesc,
                    ln.Amount
                FROM PR_ADTRANS t
                ${gangJoin}
                LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(t.EmpCode)
                JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                WHERE UPPER(RTRIM(t.LocCode)) = ?
                  AND t.PhyMonth = ?
                  AND t.PhyYear = ?
                  AND t.Status = 1
                  ${gangWhere}

                UNION ALL

                SELECT
                    RTRIM(t.EmpCode) as emp_code,
                    RTRIM(ISNULL(e.NewICNo, '')) as nik,
                    t.DocDesc,
                    ln.Amount
                FROM PR_ADTRANS_ARC t
                ${gangJoin}
                LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(t.EmpCode)
                JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                WHERE UPPER(RTRIM(t.LocCode)) = ?
                  AND t.PhyMonth = ?
                  AND t.PhyYear = ?
                  AND t.Status = 3
                  ${gangWhere}
            ) src
            GROUP BY emp_code
        `;

        const adtransRows = await dbPtrj.query<any>(adtransQuery, [
            normalizedDivisionCode, periodMonth, periodYear, ...uniqueVirtualGangCodes,
            normalizedDivisionCode, periodMonth, periodYear, ...uniqueVirtualGangCodes
        ]);

        const detailRows = await dbPtrj.query<any>(`
            SELECT
                RTRIM(t.EmpCode) as emp_code,
                RTRIM(t.DocID) as doc_id,
                RTRIM(t.DocDesc) as doc_desc,
                ln.Amount as amount
            FROM PR_ADTRANS t
            ${gangJoin}
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE UPPER(RTRIM(t.LocCode)) = ?
              AND t.PhyMonth = ?
              AND t.PhyYear = ?
              AND t.Status = 1
              ${gangWhere}

            UNION ALL

            SELECT
                RTRIM(t.EmpCode) as emp_code,
                RTRIM(t.DocID) as doc_id,
                RTRIM(t.DocDesc) as doc_desc,
                ln.Amount as amount
            FROM PR_ADTRANS_ARC t
            ${gangJoin}
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE UPPER(RTRIM(t.LocCode)) = ?
              AND t.PhyMonth = ?
              AND t.PhyYear = ?
              AND t.Status = 3
              ${gangWhere}
        `, [
            normalizedDivisionCode, periodMonth, periodYear, ...uniqueVirtualGangCodes,
            normalizedDivisionCode, periodMonth, periodYear, ...uniqueVirtualGangCodes
        ]);
        const docDetailsByEmpAndCategory = new Map<string, AdtransDocDescDetail[]>();
        for (const detail of detailRows) {
            const empCode = String(detail.emp_code || '').trim().toUpperCase();
            const docDesc = String(detail.doc_desc || '').trim();
            for (const filterKey of normalizedFilters) {
                if (!matchesAdtransFilter(docDesc, filterKey)) continue;
                const key = `${empCode}|${filterKey}`;
                if (!docDetailsByEmpAndCategory.has(key)) docDetailsByEmpAndCategory.set(key, []);
                docDetailsByEmpAndCategory.get(key)!.push({
                    doc_desc: docDesc,
                    doc_id: detail.doc_id ? String(detail.doc_id).trim() : null,
                    amount: Number(detail.amount || 0)
                });
            }
        }

        // 2. Get payroll_manual_adjustments for AUTO_BUFFER from extend_db_ptrj
        const adjustmentDivisionCodes = Array.from(new Set([
            divisionCode.trim().toUpperCase(),
            normalizedDivisionCode
        ].filter(Boolean)));
        const adjustmentRows = await dbExtend.query<any>(`
            SELECT
                emp_code,
                nik,
                adjustment_type,
                adjustment_name,
                amount,
                remarks,
                gang_code,
                division_code
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND UPPER(RTRIM(division_code)) IN (${adjustmentDivisionCodes.map(() => '?').join(',')})
        `, [periodMonth, periodYear, ...adjustmentDivisionCodes]);

        const categoryToAdjustmentName: Record<string, string> = {
            'spsi': 'SPSI',
            'masa kerja': 'MASA KERJA',
            'jabatan': 'TUNJANGAN JABATAN'
        };
        const autoBufferComparableNames = new Set(Object.values(categoryToAdjustmentName));

        // 3. Build map of stored adjustments: emp_code -> category -> amount
        const storedMap = new Map<string, Map<string, { amount: number; remarks: string; gang_code: string; adjustment_name: string }>>();
        for (const row of adjustmentRows) {
            const storedIdentityKeys = Array.from(new Set([
                String(row.emp_code || '').trim().toUpperCase(),
                String(row.nik || '').trim().toUpperCase()
            ].filter(Boolean)));
            const adjustmentType = String(row.adjustment_type || '').trim().toUpperCase();
            const adjustmentName = String(row.adjustment_name || '').trim().toUpperCase();
            const normalizedAutoBufferName = normalizeAutoBufferAdjustmentName(adjustmentName);
            const comparableAdjustmentName = autoBufferComparableNames.has(normalizedAutoBufferName)
                ? normalizedAutoBufferName
                : adjustmentName;
            let category = normalizedFilters.find((filterKey) => categoryToAdjustmentName[filterKey] === comparableAdjustmentName);
            if (!category && adjustmentType === 'PREMI') category = 'premi';
            if (!category && adjustmentType === 'POTONGAN_KOTOR') category = adjustmentName.includes('KOREKSI') ? 'koreksi' : 'potongan';
            if (!category || !normalizedFilters.includes(category)) continue;

            for (const identityKey of storedIdentityKeys) {
                if (!storedMap.has(identityKey)) storedMap.set(identityKey, new Map());
                storedMap.get(identityKey)!.set(category, {
                    amount: Number(row.amount || 0),
                    remarks: String(row.remarks || ''),
                    gang_code: String(row.gang_code || ''),
                    adjustment_name: autoBufferComparableNames.has(comparableAdjustmentName) ? comparableAdjustmentName : adjustmentName
                });
            }
        }

        // 4. Map ADTRANS category to adjustment name

        // 5. Compare each employee's ADTRANS values with stored adjustments
        const comparisons: AdtransComparisonItem[] = [];
        let matchCount = 0;
        let mismatchCount = 0;
        let missingCount = 0;
        let extraInDbPtrjCount = 0;

        for (const adtransRow of adtransRows) {
            const empCode = String(adtransRow.emp_code || '').trim().toUpperCase();
            const sourceNik = String(adtransRow.nik || '').trim().toUpperCase();
            const empStored = storedMap.get(empCode) || (sourceNik ? storedMap.get(sourceNik) : undefined);

            for (const filterKey of normalizedFilters) {
                const sourceAmount = Number(adtransRow[filterKey] || 0);
                const stored = empStored?.get(filterKey);
                if (Math.abs(sourceAmount) <= 0.01 && !stored) continue;
                const adjustmentName = stored?.adjustment_name || categoryToAdjustmentName[filterKey] || filterKey.toUpperCase();

                const storedAmount = stored ? Number(stored.amount || 0) : null;

                const isMatch = storedAmount !== null && Math.abs(sourceAmount - storedAmount) <= 0.01;
                const isMissing = storedAmount === null;
                const status: 'MATCH' | 'MISMATCH' | 'MISSING' = isMissing ? 'MISSING' : (isMatch ? 'MATCH' : 'MISMATCH');

                if (status === 'MATCH') matchCount++;
                else if (status === 'MISMATCH') mismatchCount++;
                else missingCount++;

                if (Math.abs(sourceAmount) > 0.01 && status !== 'MATCH') {
                    extraInDbPtrjCount++;
                }

                comparisons.push({
                    emp_code: empCode,
                    stored_emp_identifier: sourceNik && sourceNik !== empCode ? sourceNik : null,
                    category: filterKey,
                    adjustment_name: adjustmentName,
                    source_amount: sourceAmount,
                    stored_amount: storedAmount,
                    db_ptrj_amount: sourceAmount,
                    extend_db_ptrj_amount: storedAmount,
                    diff: storedAmount !== null ? sourceAmount - storedAmount : null,
                    status,
                    db_ptrj_doc_desc_details: docDetailsByEmpAndCategory.get(`${empCode}|${filterKey}`) || [],
                    extend_db_ptrj_remarks: stored?.remarks || null,
                    gang_code: stored?.gang_code || null,
                    remarks: stored?.remarks || null
                });
            }
        }

        return {
            division: divisionCode,
            period_month: periodMonth,
            period_year: periodYear,
            compared_categories: normalizedFilters,
            total_employees: adtransRows.length,
            match_count: matchCount,
            mismatch_count: mismatchCount,
            missing_in_adjustments: missingCount,
            extra_in_db_ptrj: extraInDbPtrjCount,
            comparisons
        };
    }

    public async reverseCompareAdtransWithAdjustments(
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        filters: string[] = DEFAULT_ADTRANS_COMPARE_FILTERS
    ): Promise<{
        division: string;
        period_month: number;
        period_year: number;
        compared_categories: string[];
        total_adjustments: number;
        match_count: number;
        mismatch_count: number;
        extra_in_adjustments: number;
        comparisons: ReverseAdtransComparisonItem[];
    }> {
        const dbExtend = this.getDatabase();
        await this.ensureManualAdjustmentIdentitySchema(dbExtend);
        const normalizedFilters = filters.map(normalizeAdtransFilter).filter(Boolean);
        const categoryToAdjustmentName: Record<string, string> = {
            'spsi': 'SPSI',
            'masa kerja': 'MASA KERJA',
            'jabatan': 'TUNJANGAN JABATAN'
        };
        const autoBufferComparableNames = new Set(Object.values(categoryToAdjustmentName));
        const autoBufferAdjustmentNames = normalizedFilters
            .filter((filterKey) => categoryToAdjustmentName[filterKey])
            .flatMap((filterKey) => {
                const name = categoryToAdjustmentName[filterKey];
                return [name, `AUTO ${name}`];
            });
        const includesManualCategories = normalizedFilters.some((filterKey) => ['premi', 'koreksi', 'potongan'].includes(filterKey));

        const normalizedDivisionCode = resolveAdtransLocCode(divisionCode);
        const adjustmentDivisionCodes = Array.from(new Set([
            divisionCode.trim().toUpperCase(),
            normalizedDivisionCode
        ].filter(Boolean)));

        const adjustmentRows = await dbExtend.query<any>(`
            SELECT
                emp_code,
                nik,
                adjustment_type,
                adjustment_name,
                amount,
                remarks,
                gang_code,
                division_code
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND UPPER(RTRIM(division_code)) IN (${adjustmentDivisionCodes.map(() => '?').join(',')})
              AND (
                  (adjustment_type = 'AUTO_BUFFER' AND UPPER(RTRIM(adjustment_name)) IN (${autoBufferAdjustmentNames.length ? autoBufferAdjustmentNames.map(() => '?').join(',') : "''"}))
                  ${includesManualCategories ? "OR adjustment_type IN ('PREMI', 'POTONGAN_KOTOR')" : ""}
              )
            ORDER BY emp_code, adjustment_name
        `, [periodMonth, periodYear, ...adjustmentDivisionCodes, ...autoBufferAdjustmentNames]);

        const dbPtrj = Database.getInstance();
        const ptrjEmpCodeByStoredIdentifier = new Map<string, string>();
        for (const row of adjustmentRows) {
            const storedIdentifier = String(row.emp_code || '').trim();
            if (!storedIdentifier || ptrjEmpCodeByStoredIdentifier.has(storedIdentifier)) continue;

            const gangCode = String(row.gang_code || '').trim().toUpperCase();
            let gangScopedIdentity: any = null;
            if (gangCode) {
                gangScopedIdentity = await dbPtrj.queryOne<any>(`
                    SELECT TOP 1
                        RTRIM(ISNULL(e.NewICNo, '')) as nik,
                        RTRIM(e.EmpCode) as emp_code,
                        RTRIM(e.EmpName) as emp_name,
                        RTRIM(gl.GangCode) as gang_code
                    FROM HR_EMPLOYEE e
                    JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                    WHERE (RTRIM(e.EmpCode) = ? OR RTRIM(ISNULL(e.NewICNo, '')) = ?)
                      AND UPPER(RTRIM(gl.GangCode)) = ?
                    ORDER BY e.EmpCode DESC
                `, [storedIdentifier, storedIdentifier, gangCode]);
            }

            const identity = gangScopedIdentity || await employeeIdentityResolverService.resolve(storedIdentifier);
            ptrjEmpCodeByStoredIdentifier.set(storedIdentifier, identity?.emp_code || storedIdentifier.toUpperCase());
            const storedNik = String((row as any).nik || '').trim().toUpperCase();
            if (storedNik) {
                ptrjEmpCodeByStoredIdentifier.set(storedNik, identity?.emp_code || storedIdentifier.toUpperCase());
            }
        }

        // PR_ADTRANS.EmpCode is the PTRJ employee code (letter-prefixed, e.g. A0001), not numeric NIK/KTP.
        const ptrjEmpCodes = Array.from(new Set(Array.from(ptrjEmpCodeByStoredIdentifier.values()).filter(Boolean)));
        const adtransResult = ptrjEmpCodes.length > 0
            ? await this.checkAdtransDirectly(periodMonth, periodYear, ptrjEmpCodes, normalizedFilters, divisionCode)
            : { totals: [] };
        const sourceMap = new Map<string, any>();
        for (const row of adtransResult.totals || []) {
            sourceMap.set(String(row.emp_code || '').trim().toUpperCase(), row);
        }
        const docDetailsByEmpAndCategory = new Map<string, AdtransDocDescDetail[]>();
        for (const detail of adtransResult.doc_desc_details || []) {
            const empCode = String(detail.emp_code || '').trim().toUpperCase();
            const category = String(detail.category || '').trim();
            if (!empCode || !category) continue;

            const key = `${empCode}|${category}`;
            const detailRows = docDetailsByEmpAndCategory.get(key) || [];
            detailRows.push({
                doc_desc: String(detail.doc_desc || '').trim(),
                doc_id: detail.doc_id ? String(detail.doc_id).trim() : null,
                amount: Number(detail.amount || 0)
            });
            docDetailsByEmpAndCategory.set(key, detailRows);
        }

        const comparisons: ReverseAdtransComparisonItem[] = [];
        let matchCount = 0;
        let mismatchCount = 0;
        let extraCount = 0;

        for (const row of adjustmentRows) {
            const empCode = String(row.emp_code || '').trim();
            const ptrjEmpCode = ptrjEmpCodeByStoredIdentifier.get(empCode) || empCode.toUpperCase();
            const adjustmentName = String(row.adjustment_name || '').trim().toUpperCase();
            const adjustmentType = String(row.adjustment_type || '').trim().toUpperCase();
            const normalizedAutoBufferName = normalizeAutoBufferAdjustmentName(adjustmentName);
            const comparableAdjustmentName = autoBufferComparableNames.has(normalizedAutoBufferName)
                ? normalizedAutoBufferName
                : adjustmentName;
            let category = normalizedFilters.find((filterKey) => categoryToAdjustmentName[filterKey] === comparableAdjustmentName);
            if (!category && adjustmentType === 'PREMI') category = 'premi';
            if (!category && adjustmentType === 'POTONGAN_KOTOR') {
                category = adjustmentName.includes('KOREKSI') ? 'koreksi' : 'potongan';
            }
            if (!category || !normalizedFilters.includes(category)) continue;

            const storedAmount = Number(row.amount || 0);
            const sourceAmount = Number(sourceMap.get(ptrjEmpCode)?.[category] || 0);
            const diff = sourceAmount - storedAmount;
            const isMatch = Math.abs(diff) <= 0.01;
            const status: 'MATCH' | 'MISMATCH' | 'EXTRA_IN_ADJUSTMENTS' = isMatch
                ? 'MATCH'
                : sourceAmount === 0 && storedAmount !== 0
                    ? 'EXTRA_IN_ADJUSTMENTS'
                    : 'MISMATCH';

            if (status === 'MATCH') matchCount++;
            else if (status === 'EXTRA_IN_ADJUSTMENTS') extraCount++;
            else mismatchCount++;

            comparisons.push({
                emp_code: ptrjEmpCode,
                stored_emp_identifier: empCode !== ptrjEmpCode ? empCode : null,
                category,
                adjustment_name: autoBufferComparableNames.has(comparableAdjustmentName) ? comparableAdjustmentName : adjustmentName,
                stored_amount: storedAmount,
                source_amount: sourceAmount,
                db_ptrj_amount: sourceAmount,
                extend_db_ptrj_amount: storedAmount,
                diff,
                status,
                db_ptrj_doc_desc_details: docDetailsByEmpAndCategory.get(`${ptrjEmpCode}|${category}`) || [],
                extend_db_ptrj_remarks: row.remarks ? String(row.remarks) : null,
                gang_code: row.gang_code ? String(row.gang_code).trim() : null,
                division_code: row.division_code ? String(row.division_code).trim() : null,
                remarks: row.remarks ? String(row.remarks) : null
            });
        }

        return {
            division: divisionCode,
            period_month: periodMonth,
            period_year: periodYear,
            compared_categories: normalizedFilters,
            total_adjustments: comparisons.length,
            match_count: matchCount,
            mismatch_count: mismatchCount,
            extra_in_adjustments: extraCount,
            comparisons
        };
    }

    /**
     * Sync PR_ADTRANS values (db_ptrj) into payroll_manual_adjustments (extend_db_ptrj).
     * Only syncs items that are MISMATCH or MISSING from comparison.
     * Returns count of synced records.
     */
    public async syncAdtransToAdjustments(
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        filters: string[] = DEFAULT_ADTRANS_COMPARE_FILTERS,
        syncMode: 'MISSING_ONLY' | 'MISMATCH_AND_MISSING' | 'ALL' = 'MISMATCH_AND_MISSING',
        createdBy: string = 'sync_adtrans_api'
    ): Promise<{
        division: string;
        period_month: number;
        period_year: number;
        sync_mode: string;
        total_compared: number;
        synced_count: number;
        skipped_match: number;
        synced_details: { emp_code: string; category: string; adjustment_name: string; old_amount: number | null; new_amount: number; action: 'INSERT' | 'UPDATE' }[];
    }> {
        const comparison = await this.compareAdtransWithAdjustments(periodMonth, periodYear, divisionCode, filters);
        const dbExtend = this.getDatabase();
        await this.ensureManualAdjustmentIdentitySchema(dbExtend);

        const toSync = comparison.comparisons.filter((item) => {
            if (syncMode === 'ALL') return true;
            if (syncMode === 'MISSING_ONLY') return item.status === 'MISSING';
            if (syncMode === 'MISMATCH_AND_MISSING') return item.status === 'MISMATCH' || item.status === 'MISSING';
            return false;
        });

        const syncedDetails: { emp_code: string; category: string; adjustment_name: string; old_amount: number | null; new_amount: number; action: 'INSERT' | 'UPDATE' }[] = [];
        const remarksMap: Record<string, string> = {
            'spsi': 'potongan spsi',
            'masa kerja': 'masa kerja',
            'jabatan': 'tunjangan jabatan'
        };

        for (const item of toSync) {
            const adcode = remarksMap[item.category] || item.category;
            const remarks = `${item.adjustment_name} | ${adcode} | ${item.source_amount} | sync:SYNC | match:MATCH`;
            const identity = await employeeIdentityResolverService.resolve(item.emp_code);
            const empName = identity?.emp_name || null;
            const nik = identity?.nik || null;

            if (item.status === 'MISSING' || item.stored_amount === null) {
                // INSERT - need gang_code, get from PR_ADTRANS or default
                const gangCode = item.gang_code || 'UNKNOWN';
                const result = await dbExtend.query<{ id: number }>(`
                    INSERT INTO dbo.payroll_manual_adjustments (
                        period_month, period_year, emp_code, nik, emp_name, gang_code, division_code,
                        adjustment_type, adjustment_name, amount, remarks, created_by
                    ) OUTPUT INSERTED.id VALUES (
                        ?, ?, ?, ?, ?, ?, ?,
                        'AUTO_BUFFER', ?, ?, ?, ?
                    )
                `, [
                    periodMonth, periodYear, item.emp_code, nik, empName, gangCode, divisionCode,
                    item.adjustment_name, item.source_amount, remarks, createdBy
                ]);
                syncedDetails.push({
                    emp_code: item.emp_code,
                    category: item.category,
                    adjustment_name: item.adjustment_name,
                    old_amount: null,
                    new_amount: item.source_amount,
                    action: 'INSERT'
                });
            } else {
                // UPDATE
                const normalizedAdjNameSql = buildNormalizedSqlNameExpression('adjustment_name');
                await dbExtend.query(`
                    UPDATE dbo.payroll_manual_adjustments
                    SET emp_code = ?, nik = ?, amount = ?, remarks = ?, emp_name = ?, updated_at = GETDATE(), updated_by = ?
                    WHERE period_month = ? AND period_year = ?
                      AND (emp_code = ? OR nik = ?)
                      AND adjustment_type = 'AUTO_BUFFER'
                      AND ${normalizedAdjNameSql} = ?
                `, [
                    item.emp_code, nik, item.source_amount, remarks, empName, createdBy,
                    periodMonth, periodYear,
                    item.emp_code, nik,
                    item.adjustment_name
                ]);
                syncedDetails.push({
                    emp_code: item.emp_code,
                    category: item.category,
                    adjustment_name: item.adjustment_name,
                    old_amount: item.stored_amount,
                    new_amount: item.source_amount,
                    action: 'UPDATE'
                });
            }
        }

        return {
            division: divisionCode,
            period_month: periodMonth,
            period_year: periodYear,
            sync_mode: syncMode,
            total_compared: comparison.comparisons.length,
            synced_count: syncedDetails.length,
            skipped_match: comparison.comparisons.length - toSync.length,
            synced_details: syncedDetails
        };
    }
}

export const manualAdjustmentService = ManualAdjustmentService.getInstance();
