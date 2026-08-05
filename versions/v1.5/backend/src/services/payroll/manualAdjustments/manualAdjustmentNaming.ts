type AdjustmentType = 'PREMI' | 'POTONGAN_KOTOR' | 'POTONGAN_BERSIH';

const PREFIX_BY_TYPE: Record<AdjustmentType, RegExp> = {
    PREMI: /^PREMI\s+/i,
    POTONGAN_KOTOR: /^KOREKSI\s+/i,
    POTONGAN_BERSIH: /^POTONGAN\s+LAINNYA\s+/i
};

const FIELD_PREFIX_BY_TYPE: Record<AdjustmentType, string> = {
    PREMI: 'premi',
    POTONGAN_KOTOR: 'koreksi',
    POTONGAN_BERSIH: 'potongan_lainnya'
};

export function normalizeStoredAdjustmentName(name: string): string {
    return String(name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

export const MANUAL_ADJUSTMENT_DIVISION_CODE_MAP: Record<string, string> = {
    PG1A: 'P1A',
    PG1B: 'P1B',
    PG2A: 'P2A',
    PG2B: 'P2B',
    PLASMA1A: 'P1A',
    PLASMA1B: 'P1B',
    PLASMA2A: 'P2A',
    PLASMA2B: 'P2B',
    '1A': 'P1A',
    '1B': 'P1B',
    '2A': 'P2A',
    '2B': 'P2B',
    ARB1: 'AB1',
    ARB2: 'AB2',
    'AB-1': 'AB1',
    'AB-2': 'AB2',
    AREC: 'ARC',
    INFRA: 'INF',
    INFRASTRUKTUR: 'INF'
};

export function normalizeManualAdjustmentDivisionCode(divisionCode?: string | null): string | null {
    const normalized = String(divisionCode || '')
        .trim()
        .replace(/\s+/g, '_')
        .toUpperCase();
    if (!normalized) return null;

    return MANUAL_ADJUSTMENT_DIVISION_CODE_MAP[normalized] || normalized;
}

export function toManualAdjustmentFieldName(
    adjustmentType: AdjustmentType,
    adjustmentName: string
): string {
    const normalizedName = normalizeStoredAdjustmentName(adjustmentName);
    const fieldPrefix = FIELD_PREFIX_BY_TYPE[adjustmentType];
    const suffix = normalizedName
        .replace(PREFIX_BY_TYPE[adjustmentType], '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(new RegExp(`^(?:${fieldPrefix}_)+`), '');

    return `${fieldPrefix}_${suffix}`;
}

export function shouldDeleteStoredAdjustment(amount: number, remarks?: string | null, hasMetadataJson = false): boolean {
    if (hasMetadataJson) return false;
    const text = String(remarks || '');
    return Number(amount || 0) === 0 && !text.includes('INIT_COLUMN') && !text.includes('sync:');
}
