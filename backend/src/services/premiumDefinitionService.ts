/**
 * PremiumDefinitionService
 *
 * Manages premium definitions stored as a JSON file at backend/data/premium_definitions.json.
 * These definitions control:
 * - Which premium column names are allowed (format baku)
 * - What ADCode each premium maps to
 * - What input_type determines the metadata popup behavior
 *
 * Input types:
 * - "amount"     : plain numeric input only
 * - "blok"       : multi-row subblok + gang_code + jumlah
 * - "exp"        : single expense_code + jumlah
 * - "kendaraan"  : multi-row nomor_kendaraan + expense_code + jumlah
 * - "blok,exp"   : combo blok items + single expense
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import {
    containsPphDeductionText,
    POTONGAN_BERSIH_HUTANG_AD_CODE,
    POTONGAN_BERSIH_HUTANG_TASK_DESC
} from "./payroll/manualAdjustments/potonganBersihTaskCode";

export type PremiumInputType = 'amount' | 'blok' | 'exp' | 'kendaraan' | 'blok,exp';
const PREMIUM_INPUT_TYPES = new Set<string>(['amount', 'blok', 'exp', 'kendaraan', 'blok,exp']);
const ADJUSTMENT_TYPES = new Set<string>(['PREMI', 'POTONGAN_KOTOR', 'POTONGAN_BERSIH']);

export interface PremiumDefinition {
    adjustment_type?: 'PREMI' | 'POTONGAN_KOTOR' | 'POTONGAN_BERSIH';
    adjustment_name: string;    // e.g. "PREMI PRUNING"
    ad_code: string;            // e.g. "AL3PM0601P1A"
    task_desc: string;          // e.g. "(AL) TUNJANGAN PREMI ((PM) PRUNING)"
    input_type: PremiumInputType;
    is_active: boolean;
}

function normalizePotonganBersihDefinition(definition: PremiumDefinition): PremiumDefinition {
    const adjustmentType = normalizeAdjustmentTypeField(definition.adjustment_type);
    const text = `${definition.adjustment_name} ${definition.ad_code} ${definition.task_desc}`;
    if (adjustmentType !== 'POTONGAN_BERSIH' || containsPphDeductionText(text)) {
        return definition;
    }

    return {
        ...definition,
        ad_code: POTONGAN_BERSIH_HUTANG_AD_CODE,
        task_desc: POTONGAN_BERSIH_HUTANG_TASK_DESC
    };
}

export type ConversionMetadataAction = 'keep' | 'remap' | 'drop' | 'seed';

export interface ConversionValidation {
    allowed: boolean;
    reason: string;
    metadata_action: ConversionMetadataAction;
    from_input_type: string;
    to_input_type: string;
}

function normalizeAdjustmentTypeField(value: string | undefined): string {
    return String(value || 'PREMI').trim().toUpperCase();
}

// --- Metadata JSON structures per input_type ---

export interface BlokItem {
    subblok: string;
    gang_code: string;
    jumlah: number;
}

export interface KendaraanItem {
    nomor_kendaraan: string;
    expense_code: string;
    jumlah: number;
}

export interface ExpenseDetail {
    expense_code: string;
    jumlah: number;
}

export interface MetadataBlok {
    input_type: 'blok';
    items: BlokItem[];
    total_amount: number;
}

export interface MetadataExp {
    input_type: 'exp';
    expense_code: string;
    jumlah: number;
    total_amount: number;
}

export interface MetadataKendaraan {
    input_type: 'kendaraan';
    items: KendaraanItem[];
    total_amount: number;
}

export interface MetadataBlokExp {
    input_type: 'blok,exp';
    blok_items: BlokItem[];
    expense: ExpenseDetail;
    total_amount: number;
}

export type PremiumMetadata = MetadataBlok | MetadataExp | MetadataKendaraan | MetadataBlokExp;

// Path to the JSON definitions file
const DEFINITIONS_FILE = join(import.meta.dir, "../../data/premium_definitions.json");

export class PremiumDefinitionService {
    private static instance: PremiumDefinitionService;
    private definitions: PremiumDefinition[] | null = null;
    private definitionsFingerprint: string | null = null;

    private constructor(private readonly definitionsFile: string = DEFINITIONS_FILE) {}

    public static getInstance(): PremiumDefinitionService {
        if (!PremiumDefinitionService.instance) {
            PremiumDefinitionService.instance = new PremiumDefinitionService();
        }
        return PremiumDefinitionService.instance;
    }

    public static createForFile(filePath: string): PremiumDefinitionService {
        return new PremiumDefinitionService(filePath);
    }

    private getDefinitionsFingerprint(): string | null {
        if (!existsSync(this.definitionsFile)) {
            return null;
        }
        const stat = statSync(this.definitionsFile);
        return `${stat.mtimeMs}:${stat.size}`;
    }

    /**
     * Load definitions from JSON file (cached in memory, re-reads on first call or after invalidation)
     */
    private loadDefinitions(): PremiumDefinition[] {
        const fingerprint = this.getDefinitionsFingerprint();
        if (this.definitions !== null && this.definitionsFingerprint === fingerprint) {
            return this.definitions;
        }

        if (!fingerprint) {
            console.warn(`[PremiumDefinitionService] File not found: ${this.definitionsFile}`);
            this.definitions = [];
            this.definitionsFingerprint = null;
            return this.definitions;
        }

        try {
            const raw = readFileSync(this.definitionsFile, "utf-8");
            this.definitions = (JSON.parse(raw) as PremiumDefinition[]).map(normalizePotonganBersihDefinition);
            this.definitionsFingerprint = fingerprint;
            console.log(`[PremiumDefinitionService] Loaded ${this.definitions.length} premium definitions`);
            return this.definitions;
        } catch (err) {
            console.error(`[PremiumDefinitionService] Failed to parse definitions file:`, err);
            this.definitions = [];
            this.definitionsFingerprint = fingerprint;
            return this.definitions;
        }
    }

    /**
     * Invalidate cache so next read re-loads from file
     */
    public invalidateCache(): void {
        this.definitions = null;
        this.definitionsFingerprint = null;
    }

    /**
     * Get all definitions (including inactive)
     */
    public getAllDefinitions(): PremiumDefinition[] {
        return this.loadDefinitions();
    }

    /**
     * Get only active definitions
     */
    public getActiveDefinitions(): PremiumDefinition[] {
        return this.loadDefinitions().filter(d => d.is_active);
    }

    /**
     * Get only active premium definitions.
     * Entries without adjustment_type are treated as legacy PREMIUM definitions.
     */
    public getActivePremiumDefinitions(): PremiumDefinition[] {
        return this.getActiveDefinitions().filter(d => !d.adjustment_type || d.adjustment_type === 'PREMI');
    }

    /**
     * Find definition by name (case-insensitive, trimmed)
     */
    public getDefinitionByName(name: string): PremiumDefinition | null {
        const normalized = name.trim().toUpperCase();
        return this.loadDefinitions().find(
            d => d.adjustment_name.trim().toUpperCase() === normalized
        ) || null;
    }

    /**
     * Add or update a definition, then persist to JSON file
     */
    public addOrUpdateDefinition(data: PremiumDefinition): void {
        const defs = this.loadDefinitions();
        const normalizedName = data.adjustment_name.trim().toUpperCase();
        const idx = defs.findIndex(
            d => d.adjustment_name.trim().toUpperCase() === normalizedName
        );

        const entry: PremiumDefinition = normalizePotonganBersihDefinition({
            adjustment_type: this.normalizeAdjustmentType(data.adjustment_type),
            adjustment_name: data.adjustment_name.trim().toUpperCase(),
            ad_code: data.ad_code.trim(),
            task_desc: data.task_desc.trim(),
            input_type: this.normalizeInputType(data.input_type),
            is_active: data.is_active ?? true
        });

        if (idx >= 0) {
            defs[idx] = entry;
        } else {
            defs.push(entry);
        }

        this.persistDefinitions(defs);
        this.definitions = defs;
    }

    /**
     * Write definitions array back to JSON file
     */
    private persistDefinitions(defs: PremiumDefinition[]): void {
        try {
            writeFileSync(this.definitionsFile, JSON.stringify(defs, null, 2), "utf-8");
            this.definitionsFingerprint = this.getDefinitionsFingerprint();
            console.log(`[PremiumDefinitionService] Saved ${defs.length} definitions to file`);
        } catch (err) {
            console.error(`[PremiumDefinitionService] Failed to write definitions file:`, err);
            throw new Error("Failed to save premium definitions");
        }
    }

    private normalizeAdjustmentType(value?: PremiumDefinition["adjustment_type"]): PremiumDefinition["adjustment_type"] {
        const normalized = String(value || "PREMI").trim().toUpperCase();
        if (!ADJUSTMENT_TYPES.has(normalized)) {
            throw new Error(`adjustment_type "${value}" tidak didukung.`);
        }
        return normalized as PremiumDefinition["adjustment_type"];
    }

    private normalizeInputType(value: PremiumInputType): PremiumInputType {
        const normalized = String(value || "").trim().toLowerCase();
        if (!PREMIUM_INPUT_TYPES.has(normalized)) {
            throw new Error(`input_type "${value}" tidak didukung. Gunakan: amount, blok, exp, kendaraan, atau blok,exp.`);
        }
        return normalized as PremiumInputType;
    }

    /**
     * Validate that a given adjustment_name is in the active definitions list.
     * Returns the definition if found, throws if not.
     */
    public validatePremiumName(name: string): PremiumDefinition {
        const def = this.getDefinitionByName(name);
        if (!def || (def.adjustment_type && def.adjustment_type !== 'PREMI')) {
            throw new Error(`Nama premi "${name}" tidak ditemukan dalam definisi premium. Gunakan nama dari daftar format baku.`);
        }
        if (!def.is_active) {
            throw new Error(`Definisi premi "${name}" sudah tidak aktif.`);
        }
        return def;
    }

    /**
     * Validation gate for premium type conversion.
     * Blocks conversions that require mapping subblok ↔ nomor_kendaraan (semantically different).
     *
     * Matrix (blocked pairs are symmetric where applicable):
     *   blok      → kendaraan     BLOCKED
     *   kendaraan → blok, blok,exp BLOCKED
     *   blok,exp  → kendaraan     BLOCKED
     * Same input_type        → keep metadata
     * → amount               → drop metadata
     * amount → structured    → seed placeholder
     * other compatible       → remap
     */
    private static readonly BLOCKED_CONVERSIONS: Record<string, Set<string>> = {
        blok: new Set(['kendaraan']),
        kendaraan: new Set(['blok', 'blok,exp']),
        'blok,exp': new Set(['kendaraan']),
    };

    public validatePremiumConversion(fromName: string, toName: string): ConversionValidation {
        const fromDef = this.getDefinitionByName(fromName);
        const toDef = this.getDefinitionByName(toName);
        const fromInputType = fromDef?.input_type || '';
        const toInputType = toDef?.input_type || '';

        if (!fromDef || !fromDef.is_active) {
            return { allowed: false, reason: `Source "${fromName}" tidak ditemukan atau tidak aktif.`, metadata_action: 'keep', from_input_type: fromInputType, to_input_type: toInputType };
        }
        if (!toDef || !toDef.is_active) {
            return { allowed: false, reason: `Target "${toName}" tidak ditemukan atau tidak aktif.`, metadata_action: 'keep', from_input_type: fromInputType, to_input_type: toInputType };
        }

        const fromType = normalizeAdjustmentTypeField(fromDef.adjustment_type);
        const toType = normalizeAdjustmentTypeField(toDef.adjustment_type);
        if (fromType !== toType) {
            return { allowed: false, reason: `adjustment_type beda (${fromType} vs ${toType}). Konversi antar kategori tidak didukung.`, metadata_action: 'keep', from_input_type: fromInputType, to_input_type: toInputType };
        }

        if (fromInputType === toInputType) {
            return { allowed: true, reason: 'input_type sama, metadata dipertahankan.', metadata_action: 'keep', from_input_type: fromInputType, to_input_type: toInputType };
        }

        if (PremiumDefinitionService.BLOCKED_CONVERSIONS[fromInputType]?.has(toInputType)) {
            return { allowed: false, reason: `Konversi ${fromInputType} → ${toInputType} diblokir: subblok ≠ nomor kendaraan (semantik beda).`, metadata_action: 'keep', from_input_type: fromInputType, to_input_type: toInputType };
        }

        const action: ConversionMetadataAction = toInputType === 'amount'
            ? 'drop'
            : fromInputType === 'amount'
                ? 'seed'
                : 'remap';
        return { allowed: true, reason: `Re-map ${fromInputType} → ${toInputType}.`, metadata_action: action, from_input_type: fromInputType, to_input_type: toInputType };
    }

    /**
     * Parse and validate a metadata_json string.
     * Returns parsed object or null if empty/null input.
     */
    public parseMetadata(metadataJson: string | null | undefined): PremiumMetadata | null {
        if (!metadataJson) return null;

        try {
            const parsed = JSON.parse(metadataJson);
            if (!parsed || !parsed.input_type) return null;
            return parsed as PremiumMetadata;
        } catch {
            console.warn(`[PremiumDefinitionService] Invalid metadata_json:`, metadataJson);
            return null;
        }
    }

    /**
     * Calculate total_amount from metadata items.
     * Used to validate/sync the amount field.
     */
    public calculateMetadataTotal(metadata: PremiumMetadata): number {
        switch (metadata.input_type) {
            case 'blok':
                return (metadata.items || []).reduce((sum, item) => sum + (item.jumlah || 0), 0);

            case 'exp':
                return metadata.jumlah || 0;

            case 'kendaraan':
                return (metadata.items || []).reduce((sum, item) => sum + (item.jumlah || 0), 0);

            case 'blok,exp': {
                const blokTotal = (metadata.blok_items || []).reduce((sum, item) => sum + (item.jumlah || 0), 0);
                const expTotal = metadata.expense?.jumlah || 0;
                return blokTotal + expTotal;
            }

            default:
                return 0;
        }
    }

    /**
     * Build a properly structured metadata_json string with validated total_amount
     */
    public buildMetadataJson(metadata: PremiumMetadata): string {
        const total = this.calculateMetadataTotal(metadata);
        return JSON.stringify({ ...metadata, total_amount: total });
    }
}

export const premiumDefinitionService = PremiumDefinitionService.getInstance();
