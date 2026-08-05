import { toManualAdjustmentFieldName } from './manualAdjustmentNaming';

export type ManualAdjustmentType =
    | 'PREMI'
    | 'POTONGAN_KOTOR'
    | 'POTONGAN_BERSIH'
    | 'PENDAPATAN_LAINNYA';
type ManualFieldAdjustmentType = Exclude<ManualAdjustmentType, 'PENDAPATAN_LAINNYA'>;

export type ManualAdjustmentApplyMode = 'additive' | 'override';

export interface ManualAdjustmentLike {
    adjustment_type: ManualAdjustmentType;
    adjustment_name: string;
    amount: number;
    metadata_json?: string | null;
}

export interface ManualAdjustmentFieldSyncMeta {
    fieldName: string;
    adjustmentType: ManualAdjustmentType;
    adjustmentName: string;
    previousAmount: number;
    finalAmount: number;
    hadDbValue: boolean;
}

export interface ManualAdjustmentApplierInput {
    adjustments: ManualAdjustmentLike[];
    empPremi: Record<string, number>;
    empPotongan: Record<string, number>;
    premiTitleMap: Record<string, string>;
    potonganTitleMap: Record<string, string>;
    mode?: ManualAdjustmentApplyMode;
}

export interface ManualAdjustmentApplierResult {
    empPremi: Record<string, number>;
    empPotongan: Record<string, number>;
    premiTitleMap: Record<string, string>;
    potonganTitleMap: Record<string, string>;
    koreksiVariations: Record<string, number>;
    totalPremiDelta: number;
    potKoreksiDelta: number;
    otherPotonganDelta: number;
    fieldSyncMeta: ManualAdjustmentFieldSyncMeta[];
}

function toAmount(value: number): number {
    return Number(value) || 0;
}

function isDeductionAdjustmentType(value: ManualAdjustmentType): boolean {
    return value === 'POTONGAN_KOTOR' || value === 'POTONGAN_BERSIH';
}

function toCalculationAmount(value: number, adjustmentType: ManualAdjustmentType): number {
    const amount = toAmount(value);
    return isDeductionAdjustmentType(adjustmentType) ? Math.abs(amount) : amount;
}

function normalizeFieldIdentity(value: string): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function hasOwn(source: Record<string, number>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(source, key);
}

function resolveExistingFieldKey(source: Record<string, number>, targetFieldName: string): string {
    if (hasOwn(source, targetFieldName)) {
        return targetFieldName;
    }

    const normalizedTarget = normalizeFieldIdentity(targetFieldName);
    if (!normalizedTarget) {
        return targetFieldName;
    }

    for (const key of Object.keys(source || {})) {
        if (normalizeFieldIdentity(key) === normalizedTarget) {
            return key;
        }
    }

    return targetFieldName;
}

export function applyManualAdjustmentsToEmployee(input: ManualAdjustmentApplierInput): ManualAdjustmentApplierResult {
    const koreksiVariations: Record<string, number> = {};
    const fieldSyncMeta: ManualAdjustmentFieldSyncMeta[] = [];
    let totalPremiDelta = 0;
    let potKoreksiDelta = 0;
    let otherPotonganDelta = 0;
    const mode: ManualAdjustmentApplyMode = input.mode || 'additive';

    const aggregatedAdjustments = new Map<
        string,
        { adjustmentType: ManualAdjustmentType; adjustmentName: string; fieldName: string; amount: number }
    >();

    for (const adjustment of input.adjustments || []) {
        // Use metadata_json.total_amount as effective amount if present, fallback to amount
        let effectiveAmount: number;
        if (adjustment.metadata_json) {
            try {
                const parsed = typeof adjustment.metadata_json === 'string'
                    ? JSON.parse(adjustment.metadata_json)
                    : adjustment.metadata_json;
                effectiveAmount = toAmount(parsed?.total_amount ?? adjustment.amount);
            } catch {
                effectiveAmount = toAmount(adjustment.amount);
            }
        } else {
            effectiveAmount = toAmount(adjustment.amount);
        }
        const amount = toCalculationAmount(effectiveAmount, adjustment.adjustment_type);
        const name = String(adjustment.adjustment_name || '');
        if (adjustment.adjustment_type === 'PENDAPATAN_LAINNYA') {
            continue;
        }
        const fieldName = toManualAdjustmentFieldName(adjustment.adjustment_type as ManualFieldAdjustmentType, name);
        const aggregateKey = `${adjustment.adjustment_type}:${normalizeFieldIdentity(fieldName)}`;

        const current = aggregatedAdjustments.get(aggregateKey);
        if (!current) {
            aggregatedAdjustments.set(aggregateKey, {
                adjustmentType: adjustment.adjustment_type,
                adjustmentName: name,
                fieldName,
                amount
            });
            continue;
        }
        current.amount += amount;
        if (name) {
            current.adjustmentName = name;
        }
    }

    for (const adjustment of aggregatedAdjustments.values()) {
        const amount = toAmount(adjustment.amount);
        const name = String(adjustment.adjustmentName || '');

        if (adjustment.adjustmentType === 'PREMI') {
            const fieldName = resolveExistingFieldKey(input.empPremi, adjustment.fieldName);
            const hadDbValue = hasOwn(input.empPremi, fieldName);
            const previousAmount = toAmount(input.empPremi[fieldName]);
            const finalAmount = mode === 'override' ? amount : previousAmount + amount;

            input.empPremi[fieldName] = finalAmount;
            input.premiTitleMap[fieldName] = name;
            totalPremiDelta += mode === 'override' ? (finalAmount - previousAmount) : amount;
            fieldSyncMeta.push({
                fieldName,
                adjustmentType: adjustment.adjustmentType,
                adjustmentName: name,
                previousAmount,
                finalAmount,
                hadDbValue
            });
            continue;
        }

        if (adjustment.adjustmentType === 'POTONGAN_KOTOR') {
            const fieldName = resolveExistingFieldKey(input.empPotongan, adjustment.fieldName);
            const hadDbValue = hasOwn(input.empPotongan, fieldName);
            const previousAmount = toCalculationAmount(input.empPotongan[fieldName], adjustment.adjustmentType);
            const finalAmount = mode === 'override' ? amount : previousAmount + amount;

            input.empPotongan[fieldName] = finalAmount;
            koreksiVariations[fieldName] = finalAmount;
            input.potonganTitleMap[fieldName] = name;
            potKoreksiDelta += mode === 'override' ? (finalAmount - previousAmount) : amount;
            fieldSyncMeta.push({
                fieldName,
                adjustmentType: adjustment.adjustmentType,
                adjustmentName: name,
                previousAmount,
                finalAmount,
                hadDbValue
            });
            continue;
        }

        if (adjustment.adjustmentType === 'POTONGAN_BERSIH') {
            const fieldName = resolveExistingFieldKey(input.empPotongan, adjustment.fieldName);
            const hadDbValue = hasOwn(input.empPotongan, fieldName);
            const previousAmount = toCalculationAmount(input.empPotongan[fieldName], adjustment.adjustmentType);
            const finalAmount = mode === 'override' ? amount : previousAmount + amount;

            input.empPotongan[fieldName] = finalAmount;
            input.potonganTitleMap[fieldName] = name;
            otherPotonganDelta += mode === 'override' ? (finalAmount - previousAmount) : amount;
            fieldSyncMeta.push({
                fieldName,
                adjustmentType: adjustment.adjustmentType,
                adjustmentName: name,
                previousAmount,
                finalAmount,
                hadDbValue
            });
            continue;
        }

        if (adjustment.adjustmentType === 'PENDAPATAN_LAINNYA') {
            continue;
        }
    }

    return {
        empPremi: input.empPremi,
        empPotongan: input.empPotongan,
        premiTitleMap: input.premiTitleMap,
        potonganTitleMap: input.potonganTitleMap,
        koreksiVariations,
        totalPremiDelta,
        potKoreksiDelta,
        otherPotonganDelta,
        fieldSyncMeta
    };
}
