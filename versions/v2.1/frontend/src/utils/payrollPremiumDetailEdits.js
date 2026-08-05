export function serializePremiumMetadata(metadataJson) {
    if (!metadataJson) return undefined;
    return typeof metadataJson === 'string' ? metadataJson : JSON.stringify(metadataJson);
}

export function parsePremiumMetadata(metadataJson) {
    if (!metadataJson) return null;
    if (typeof metadataJson === 'object') return metadataJson;
    try {
        return JSON.parse(metadataJson);
    } catch {
        return null;
    }
}

function normalizeInputType(metadata, inputType) {
    return String(inputType || metadata?.input_type || 'amount').trim().toLowerCase();
}

function isBlank(value) {
    return String(value || '').trim() === '';
}

export function shouldNormalizeManualAdjustmentAmount(adjustmentType) {
    const normalized = String(adjustmentType || '').trim().toUpperCase();
    return normalized === 'POTONGAN_KOTOR' || normalized === 'POTONGAN_BERSIH';
}

export function normalizeManualAdjustmentCalculationAmount(value, adjustmentType) {
    const amount = Number(value) || 0;
    return shouldNormalizeManualAdjustmentAmount(adjustmentType) ? Math.abs(amount) : amount;
}

function isInvalidSignedAmount(value, adjustmentType) {
    const amount = Number(value || 0);
    return amount < 0 && !shouldNormalizeManualAdjustmentAmount(adjustmentType);
}

function isValidDetailAmount(value, adjustmentType) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount === 0) return false;
    return !isInvalidSignedAmount(value, adjustmentType);
}

function hasAnyValue(item = {}, keys = []) {
    return keys.some((key) => !isBlank(item[key]) || (key === 'jumlah' && Number(item[key] || 0) !== 0));
}

function validateBlokItems(items = [], adjustmentType) {
    const relevantItems = (items || []).filter((item) => hasAnyValue(item, ['subblok', 'gang_code', 'jumlah']));
    const reasons = [];

    if (relevantItems.length === 0) {
        reasons.push('Minimal satu detail blok wajib diisi.');
        return reasons;
    }

    relevantItems.forEach((item, index) => {
        const row = index + 1;
        if (isBlank(item.subblok)) reasons.push(`Baris blok ${row}: subblok wajib diisi.`);
        if (isBlank(item.gang_code)) reasons.push(`Baris blok ${row}: gang code wajib diisi.`);
        if (!isValidDetailAmount(item.jumlah, adjustmentType)) {
            reasons.push(isInvalidSignedAmount(item.jumlah, adjustmentType)
                ? `Baris blok ${row}: jumlah tidak boleh negatif.`
                : `Baris blok ${row}: jumlah wajib lebih dari 0.`);
        }
    });

    return reasons;
}

function validateKendaraanItems(items = [], adjustmentType) {
    const relevantItems = (items || []).filter((item) => hasAnyValue(item, ['nomor_kendaraan', 'expense_code', 'jumlah']));
    const reasons = [];

    if (relevantItems.length === 0) {
        reasons.push('Minimal satu detail kendaraan wajib diisi.');
        return reasons;
    }

    relevantItems.forEach((item, index) => {
        const row = index + 1;
        if (isBlank(item.nomor_kendaraan)) reasons.push(`Baris kendaraan ${row}: nomor kendaraan wajib diisi.`);
        if (isBlank(item.expense_code)) reasons.push(`Baris kendaraan ${row}: expense code wajib diisi.`);
        if (!isValidDetailAmount(item.jumlah, adjustmentType)) {
            reasons.push(isInvalidSignedAmount(item.jumlah, adjustmentType)
                ? `Baris kendaraan ${row}: jumlah tidak boleh negatif.`
                : `Baris kendaraan ${row}: jumlah wajib lebih dari 0.`);
        }
    });

    return reasons;
}

function validateExpense(expense = {}, adjustmentType) {
    const reasons = [];
    if (isBlank(expense.expense_code)) reasons.push('Expense code wajib diisi.');
    if (!isValidDetailAmount(expense.jumlah, adjustmentType)) {
        reasons.push(isInvalidSignedAmount(expense.jumlah, adjustmentType)
            ? 'Jumlah expense tidak boleh negatif.'
            : 'Jumlah expense wajib lebih dari 0.');
    }
    return reasons;
}

export function validatePremiumDetailMetadata(metadataJson, inputType, adjustmentType) {
    const metadata = parsePremiumMetadata(metadataJson) || {};
    const resolvedInputType = normalizeInputType(metadata, inputType);
    const reasons = [];

    if (resolvedInputType === 'amount') {
        return { isComplete: true, reasons: [], inputType: resolvedInputType };
    }

    if (resolvedInputType === 'blok') {
        reasons.push(...validateBlokItems(metadata.items, adjustmentType));
    } else if (resolvedInputType === 'kendaraan') {
        reasons.push(...validateKendaraanItems(metadata.items, adjustmentType));
    } else if (resolvedInputType === 'exp') {
        reasons.push(...validateExpense(metadata, adjustmentType));
    } else if (resolvedInputType === 'blok,exp') {
        reasons.push(...validateBlokItems(metadata.blok_items, adjustmentType));
        reasons.push(...validateExpense(metadata.expense, adjustmentType));
    }

    return {
        isComplete: reasons.length === 0,
        reasons,
        inputType: resolvedInputType
    };
}

function normalizeJumlahFields(source, adjustmentType) {
    if (!source || typeof source !== 'object') return source;
    const result = { ...source };
    if (Object.prototype.hasOwnProperty.call(result, 'jumlah')) {
        result.jumlah = normalizeManualAdjustmentCalculationAmount(result.jumlah, adjustmentType);
    }
    if (Object.prototype.hasOwnProperty.call(result, 'amount')) {
        result.amount = normalizeManualAdjustmentCalculationAmount(result.amount, adjustmentType);
    }
    if (Object.prototype.hasOwnProperty.call(result, 'total_amount')) {
        result.total_amount = normalizeManualAdjustmentCalculationAmount(result.total_amount, adjustmentType);
    }
    return result;
}

function normalizeMetadataAmounts(metadataJson, adjustmentType) {
    if (!shouldNormalizeManualAdjustmentAmount(adjustmentType)) return metadataJson;
    const metadata = parsePremiumMetadata(metadataJson);
    if (!metadata || typeof metadata !== 'object') return metadataJson;

    const result = normalizeJumlahFields(metadata, adjustmentType);
    if (Array.isArray(result.items)) {
        result.items = result.items.map((item) => normalizeJumlahFields(item, adjustmentType));
    }
    if (Array.isArray(result.blok_items)) {
        result.blok_items = result.blok_items.map((item) => normalizeJumlahFields(item, adjustmentType));
    }
    if (result.expense && typeof result.expense === 'object') {
        result.expense = normalizeJumlahFields(result.expense, adjustmentType);
    }
    return result;
}

export function buildPremiumDetailEdit({ existingEdit, editBase, metadataJson, amountToSave }) {
    const source = existingEdit || editBase;
    if (!source) return null;
    const adjustmentType = source.type;

    const nextEdit = {
        ...source,
        value: normalizeManualAdjustmentCalculationAmount(amountToSave, adjustmentType)
    };

    const serializedMetadata = serializePremiumMetadata(normalizeMetadataAmounts(metadataJson, adjustmentType));
    if (serializedMetadata !== undefined) {
        nextEdit.metadata_json = serializedMetadata;
    } else if (existingEdit?.metadata_json) {
        nextEdit.metadata_json = existingEdit.metadata_json;
    }

    return nextEdit;
}
