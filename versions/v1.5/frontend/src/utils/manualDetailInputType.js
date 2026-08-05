const VALID_INPUT_TYPES = new Set(['amount', 'blok', 'exp', 'kendaraan', 'blok,exp']);

export function normalizeManualDetailInputType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return VALID_INPUT_TYPES.has(normalized) ? normalized : '';
}

function parseMetadataObjectValue(value) {
    if (!value) return null;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function resolveManualDetailInputType({
    edit,
    storedMetadata,
    addedColumn,
    definition,
    defaultInputType = 'amount'
} = {}) {
    return (
        normalizeManualDetailInputType(definition?.input_type)
        || normalizeManualDetailInputType(addedColumn?.input_type)
        || normalizeManualDetailInputType(parseMetadataObjectValue(edit?.metadata_json)?.input_type)
        || normalizeManualDetailInputType(storedMetadata?.input_type)
        || normalizeManualDetailInputType(defaultInputType)
        || 'amount'
    );
}
