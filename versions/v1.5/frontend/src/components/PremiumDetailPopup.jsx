import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    normalizeManualAdjustmentCalculationAmount,
    shouldNormalizeManualAdjustmentAmount,
    validatePremiumDetailMetadata
} from '../utils/payrollPremiumDetailEdits';

/**
 * PremiumDetailPopup
 *
 * Popup modal for entering structured premium detail metadata.
 * Shows different input modes based on input_type:
 * - "amount"    : no popup needed (handled externally)
 * - "blok"      : multi-row table: Subblok, GangCode, Jumlah
 * - "exp"       : single row: Expense Code, Jumlah
 * - "kendaraan" : multi-row table: Nomor Kendaraan, Expense Code, Jumlah
 * - "blok,exp"  : blok table + single expense row
 */

const EMPTY_BLOK_ROW = { subblok: '', gang_code: '', jumlah: 0 };
const EMPTY_KENDARAAN_ROW = { nomor_kendaraan: '', expense_code: '', jumlah: 0 };
const EMPTY_EXPENSE = { expense_code: '', jumlah: 0 };

function normalizeGangCode(value) {
    return String(value || '').trim().toUpperCase();
}

function createEmptyBlokRow(defaultGangCode = '') {
    return { ...EMPTY_BLOK_ROW, gang_code: normalizeGangCode(defaultGangCode) };
}

function normalizeDefinitionName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function parseInitialData(initialData, inputType) {
    if (!initialData) return null;
    try {
        const parsed = typeof initialData === 'string' ? JSON.parse(initialData) : initialData;
        if (!parsed?.input_type) return null;
        if (parsed.input_type === inputType) return parsed;
        if (inputType === 'blok' && parsed.input_type === 'blok,exp') {
            return {
                input_type: 'blok',
                items: parsed.blok_items || parsed.items || [],
                total_amount: sumItems(parsed.blok_items || parsed.items || [])
            };
        }
        return parsed;
    } catch {
        return null;
    }
}

function sumItems(items, field = 'jumlah', adjustmentType) {
    return (items || []).reduce(
        (sum, item) => sum + normalizeManualAdjustmentCalculationAmount(item[field], adjustmentType),
        0
    );
}

function normalizeBlokItem(item = {}, defaultGangCode = '') {
    return {
        subblok: item.subblok || '',
        gang_code: normalizeGangCode(item.gang_code) || normalizeGangCode(defaultGangCode),
        jumlah: Number(item.jumlah) || 0
    };
}

function normalizeKendaraanItem(item = {}) {
    return {
        nomor_kendaraan: item.nomor_kendaraan || '',
        expense_code: item.expense_code || '',
        jumlah: Number(item.jumlah) || 0
    };
}

function normalizeExpense(item = {}) {
    return {
        expense_code: item.expense_code || '',
        jumlah: Number(item.jumlah) || 0
    };
}

function buildEditorState(initialData, inputType, defaultGangCode = '') {
    const parsed = parseInitialData(initialData, inputType);
    const sourceBlokItems = parsed?.input_type === 'blok'
        ? parsed.items
        : parsed?.input_type === 'blok,exp'
            ? parsed.blok_items
            : null;

    return {
        parsed,
        blokItems: sourceBlokItems?.length
            ? sourceBlokItems.map((item) => normalizeBlokItem(item, defaultGangCode))
            : [createEmptyBlokRow(defaultGangCode)],
        kendaraanItems: parsed?.input_type === 'kendaraan' && parsed.items?.length
            ? parsed.items.map(normalizeKendaraanItem)
            : [{ ...EMPTY_KENDARAAN_ROW }],
        expense: parsed?.input_type === 'exp'
            ? normalizeExpense(parsed)
            : { ...EMPTY_EXPENSE },
        comboBlokItems: parsed?.input_type === 'blok,exp' && parsed.blok_items?.length
            ? parsed.blok_items.map((item) => normalizeBlokItem(item, defaultGangCode))
            : [createEmptyBlokRow(defaultGangCode)],
        comboExpense: parsed?.input_type === 'blok,exp'
            ? normalizeExpense(parsed.expense)
            : { ...EMPTY_EXPENSE }
    };
}

function formatAmount(value) {
    return (Number(value) || 0).toLocaleString('id-ID');
}

function hasAmountDifference(left, right) {
    return Math.abs((Number(left) || 0) - (Number(right) || 0)) > 0.01;
}

function resolveInitialStoredAmount(parsed, storedAmount) {
    const direct = Number(storedAmount);
    if (Number.isFinite(direct)) return direct;

    const metadataAmount = Number(parsed?.amount);
    if (Number.isFinite(metadataAmount)) return metadataAmount;

    const metadataTotal = Number(parsed?.total_amount);
    if (Number.isFinite(metadataTotal)) return metadataTotal;

    return 0;
}

const cellInputStyle = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: 13,
    boxSizing: 'border-box',
    background: '#ffffff',
    color: '#0f172a'
};

const numberInputStyle = {
    ...cellInputStyle,
    textAlign: 'right'
};

const readOnlyInputStyle = {
    background: '#f8fafc',
    color: '#334155'
};

const removeButtonStyle = {
    border: 0,
    background: '#fee2e2',
    color: '#b91c1c',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700
};

const addButtonStyle = {
    border: '1px dashed #94a3b8',
    background: '#f8fafc',
    borderRadius: 8,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    color: '#475569',
    width: '100%',
    marginTop: 8
};

const thStyle = {
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 700,
    color: '#64748b',
    borderBottom: '2px solid #e2e8f0',
    background: '#f8fafc'
};

const infoPanelStyle = {
    border: '1px solid #bae6fd',
    background: '#f0f9ff',
    color: '#075985',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 12,
    lineHeight: 1.45
};

const warningPanelStyle = {
    border: '1px solid #fed7aa',
    background: '#fff7ed',
    color: '#9a3412',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 12,
    lineHeight: 1.45
};

const summaryGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 8
};

const summaryCellStyle = {
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    borderRadius: 8,
    padding: '9px 10px'
};

const latestSummaryCellStyle = {
    ...summaryCellStyle,
    borderColor: '#86efac',
    background: '#f0fdf4'
};

const infoSummaryCellStyle = {
    ...summaryCellStyle,
    borderColor: '#bae6fd',
    background: '#f0f9ff'
};

const invalidInputStyle = {
    borderColor: '#ef4444',
    background: '#fef2f2'
};

function isBlank(value) {
    return String(value || '').trim() === '';
}

function isInvalidAmount(value, adjustmentType) {
    const amount = Number(value || 0);
    return amount < 0 && !shouldNormalizeManualAdjustmentAmount(adjustmentType);
}

function BlokEditor({ items, onChange, adjustmentType, defaultGangCode = '', readOnly = false, showValidation = false }) {
    const handleChange = (index, field, value) => {
        if (readOnly) return;
        const updated = [...items];
        updated[index] = { ...updated[index], [field]: field === 'jumlah' ? (Number(value) || 0) : value };
        onChange(updated);
    };

    const handleAdd = () => {
        if (!readOnly) onChange([...items, createEmptyBlokRow(defaultGangCode)]);
    };
    const handleRemove = (index) => {
        if (!readOnly) onChange(items.filter((_, i) => i !== index));
    };

    return (
        <div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={thStyle}>Subblok</th>
                        <th style={thStyle}>Gang Code</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Jumlah</th>
                        <th style={{ ...thStyle, width: 50 }}></th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, i) => (
                        <tr key={i}>
                            <td style={{ padding: 4 }}>
                                <input
                                    style={{ ...cellInputStyle, ...(showValidation && isBlank(item.subblok) ? invalidInputStyle : {}), ...(readOnly ? readOnlyInputStyle : {}) }}
                                    value={item.subblok || ''}
                                    disabled={readOnly}
                                    onChange={(e) => handleChange(i, 'subblok', e.target.value.toUpperCase())}
                                    placeholder="P0921"
                                />
                            </td>
                            <td style={{ padding: 4 }}>
                                <input
                                    style={{ ...cellInputStyle, ...(showValidation && isBlank(item.gang_code) ? invalidInputStyle : {}), ...(readOnly ? readOnlyInputStyle : {}) }}
                                    value={item.gang_code || ''}
                                    disabled={readOnly}
                                    onChange={(e) => handleChange(i, 'gang_code', e.target.value.toUpperCase())}
                                    placeholder="B1H"
                                />
                            </td>
                            <td style={{ padding: 4 }}>
                                <input
                                    style={{ ...numberInputStyle, ...(showValidation && isInvalidAmount(item.jumlah, adjustmentType) ? invalidInputStyle : {}), ...(readOnly ? readOnlyInputStyle : {}) }}
                                    type="number"
                                    value={item.jumlah || ''}
                                    disabled={readOnly}
                                    onChange={(e) => handleChange(i, 'jumlah', e.target.value)}
                                    placeholder="0"
                                />
                            </td>
                            <td style={{ padding: 4, textAlign: 'center' }}>
                                {!readOnly && (
                                    <button type="button" style={removeButtonStyle} onClick={() => handleRemove(i)}>X</button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {!readOnly && <button type="button" style={addButtonStyle} onClick={handleAdd}>+ Tambah Baris</button>}
        </div>
    );
}

function KendaraanEditor({ items, onChange, adjustmentType, readOnly = false, showValidation = false }) {
    const handleChange = (index, field, value) => {
        if (readOnly) return;
        const updated = [...items];
        updated[index] = { ...updated[index], [field]: field === 'jumlah' ? (Number(value) || 0) : value };
        onChange(updated);
    };

    const handleAdd = () => {
        if (!readOnly) onChange([...items, { ...EMPTY_KENDARAAN_ROW }]);
    };
    const handleRemove = (index) => {
        if (!readOnly) onChange(items.filter((_, i) => i !== index));
    };

    return (
        <div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={thStyle}>Nomor Kendaraan</th>
                        <th style={thStyle}>Expense Code</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Jumlah</th>
                        <th style={{ ...thStyle, width: 50 }}></th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, i) => (
                        <tr key={i}>
                            <td style={{ padding: 4 }}>
                                <input
                                    style={{ ...cellInputStyle, ...(showValidation && isBlank(item.nomor_kendaraan) ? invalidInputStyle : {}), ...(readOnly ? readOnlyInputStyle : {}) }}
                                    value={item.nomor_kendaraan || ''}
                                    disabled={readOnly}
                                    onChange={(e) => handleChange(i, 'nomor_kendaraan', e.target.value.toUpperCase())}
                                    placeholder="B1234AB"
                                />
                            </td>
                            <td style={{ padding: 4 }}>
                                <input
                                    name="expense_code"
                                    style={{ ...cellInputStyle, ...(readOnly ? readOnlyInputStyle : {}) }}
                                    value={item.expense_code || ''}
                                    disabled={readOnly}
                                    onChange={(e) => handleChange(i, 'expense_code', e.target.value.toUpperCase())}
                                    placeholder="TRANSPORT"
                                />
                            </td>
                            <td style={{ padding: 4 }}>
                                <input
                                    style={{ ...numberInputStyle, ...(showValidation && isInvalidAmount(item.jumlah, adjustmentType) ? invalidInputStyle : {}), ...(readOnly ? readOnlyInputStyle : {}) }}
                                    type="number"
                                    value={item.jumlah || ''}
                                    disabled={readOnly}
                                    onChange={(e) => handleChange(i, 'jumlah', e.target.value)}
                                    placeholder="0"
                                />
                            </td>
                            <td style={{ padding: 4, textAlign: 'center' }}>
                                {!readOnly && (
                                    <button type="button" style={removeButtonStyle} onClick={() => handleRemove(i)}>X</button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {!readOnly && <button type="button" style={addButtonStyle} onClick={handleAdd}>+ Tambah Baris</button>}
        </div>
    );
}

function ExpenseEditor({ expense, onChange, adjustmentType, readOnly = false, showValidation = false }) {
    return (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>Expense Code</label>
                <input
                    style={{ ...cellInputStyle, ...(showValidation && isBlank(expense.expense_code) ? invalidInputStyle : {}), ...(readOnly ? readOnlyInputStyle : {}) }}
                    value={expense.expense_code || ''}
                    disabled={readOnly}
                    onChange={(e) => {
                        if (!readOnly) onChange({ ...expense, expense_code: e.target.value.toUpperCase() });
                    }}
                    placeholder="LABOUR"
                />
            </div>
            <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>Jumlah</label>
                <input
                    style={{ ...numberInputStyle, ...(showValidation && isInvalidAmount(expense.jumlah, adjustmentType) ? invalidInputStyle : {}), ...(readOnly ? readOnlyInputStyle : {}) }}
                    type="number"
                    value={expense.jumlah || ''}
                    disabled={readOnly}
                    onChange={(e) => {
                        if (!readOnly) onChange({ ...expense, jumlah: Number(e.target.value) || 0 });
                    }}
                    placeholder="0"
                />
            </div>
        </div>
    );
}

export default function PremiumDetailPopup({
    isOpen,
    onClose,
    onSave,
    inputType,
    definitionName,
    adjustmentType,
    defaultGangCode,
    initialData,
    storedAmount,
    mismatch,
    readOnly = false
}) {
    const initialEditorState = useMemo(
        () => buildEditorState(initialData, inputType, defaultGangCode),
        [initialData, inputType, defaultGangCode]
    );

    // State for blok items
    const [blokItems, setBlokItems] = useState(initialEditorState.blokItems);
    // State for kendaraan items
    const [kendaraanItems, setKendaraanItems] = useState(initialEditorState.kendaraanItems);
    // State for expense (single)
    const [expense, setExpense] = useState(initialEditorState.expense);
    // State for blok,exp combo
    const [comboBlokItems, setComboBlokItems] = useState(initialEditorState.comboBlokItems);
    const [comboExpense, setComboExpense] = useState(initialEditorState.comboExpense);
    const [amountDraft, setAmountDraft] = useState(() => resolveInitialStoredAmount(initialEditorState.parsed, storedAmount));

    // Initialize from existing data
    useEffect(() => {
        if (!isOpen) return;
        const nextState = buildEditorState(initialData, inputType, defaultGangCode);
        setBlokItems(nextState.blokItems);
        setKendaraanItems(nextState.kendaraanItems);
        setExpense(nextState.expense);
        setComboBlokItems(nextState.comboBlokItems);
        setComboExpense(nextState.comboExpense);
        setAmountDraft(resolveInitialStoredAmount(nextState.parsed, storedAmount));
    }, [isOpen, initialData, inputType, defaultGangCode, storedAmount]);

    // Calculate total based on input type
    const totalAmount = useMemo(() => {
        switch (inputType) {
            case 'amount':
                return normalizeManualAdjustmentCalculationAmount(amountDraft, adjustmentType);
            case 'blok':
                return sumItems(blokItems, 'jumlah', adjustmentType);
            case 'exp':
                return normalizeManualAdjustmentCalculationAmount(expense.jumlah, adjustmentType);
            case 'kendaraan':
                return sumItems(kendaraanItems, 'jumlah', adjustmentType);
            case 'blok,exp':
                return sumItems(comboBlokItems, 'jumlah', adjustmentType)
                    + normalizeManualAdjustmentCalculationAmount(comboExpense.jumlah, adjustmentType);
            default:
                return 0;
        }
    }, [inputType, amountDraft, blokItems, expense, kendaraanItems, comboBlokItems, comboExpense, adjustmentType]);

    const normalizeDetailAmount = useCallback(
        (value) => normalizeManualAdjustmentCalculationAmount(value, adjustmentType),
        [adjustmentType]
    );
    const normalizeDetailItems = useCallback(
        (items) => (items || []).map((item) => ({ ...item, jumlah: normalizeDetailAmount(item.jumlah) })),
        [normalizeDetailAmount]
    );
    const normalizeDetailExpense = useCallback(
        (item) => ({ ...(item || {}), jumlah: normalizeDetailAmount(item?.jumlah) }),
        [normalizeDetailAmount]
    );

    const metadataForValidation = useMemo(() => {
        switch (inputType) {
            case 'blok':
                return { input_type: 'blok', items: blokItems, total_amount: totalAmount };
            case 'exp':
                return { input_type: 'exp', ...expense, total_amount: totalAmount };
            case 'kendaraan':
                return { input_type: 'kendaraan', items: kendaraanItems, total_amount: totalAmount };
            case 'blok,exp':
                return { input_type: 'blok,exp', blok_items: comboBlokItems, expense: comboExpense, total_amount: totalAmount };
            default:
                return { input_type: 'amount', total_amount: totalAmount };
        }
    }, [inputType, blokItems, expense, kendaraanItems, comboBlokItems, comboExpense, totalAmount]);

    const detailValidation = useMemo(
        () => validatePremiumDetailMetadata(metadataForValidation, inputType, adjustmentType),
        [metadataForValidation, inputType, adjustmentType]
    );
    const showDetailValidation = inputType !== 'amount' && !detailValidation.isComplete;

    const storedAmountNumber = normalizeManualAdjustmentCalculationAmount(
        resolveInitialStoredAmount(initialEditorState.parsed, storedAmount),
        adjustmentType
    );
    const shouldAutoSyncDetailAmount = inputType !== 'amount';
    const amountToSave = totalAmount;
    const diffFromStored = totalAmount - storedAmountNumber;
    const detailDiffersFromStored = hasAmountDifference(totalAmount, storedAmountNumber);
    const isLegacyFallback = !!initialEditorState.parsed?.legacy_source;
    const canEdit = !readOnly;
    const hasStoredAmountToCompare = Math.abs(storedAmountNumber) > 0.01;
    const shouldShowAmountComparison = inputType !== 'amount' && hasStoredAmountToCompare;
    const shouldShowEmptyStoredAmountInfo = inputType !== 'amount' && !hasStoredAmountToCompare && Math.abs(totalAmount) > 0.01;
    const visibleMismatch = inputType !== 'amount' && mismatch && Math.abs(Number(mismatch.amount || 0)) > 0.01
        ? mismatch
        : (inputType !== 'amount' && detailDiffersFromStored && hasStoredAmountToCompare ? { amount: storedAmountNumber, detail_total: totalAmount, diff: diffFromStored, reason: 'Total detail berbeda dari amount tersimpan' } : null);
    const mismatchAmount = Number(visibleMismatch?.amount ?? storedAmountNumber) || 0;
    const mismatchDetailTotal = Number(visibleMismatch?.detail_total ?? totalAmount) || 0;
    const mismatchDiff = Number.isFinite(Number(visibleMismatch?.diff))
        ? Number(visibleMismatch.diff)
        : mismatchDetailTotal - mismatchAmount;

    const handleSave = useCallback(() => {
        if (!canEdit) {
            onClose?.();
            return;
        }
        if (showDetailValidation) return;

        let metadataJson;

        switch (inputType) {
            case 'amount':
                metadataJson = null;
                break;
            case 'blok':
                metadataJson = {
                    input_type: 'blok',
                    items: normalizeDetailItems(blokItems.filter(item => item.subblok || item.gang_code || item.jumlah)),
                    total_amount: totalAmount
                };
                break;
            case 'exp':
                metadataJson = {
                    input_type: 'exp',
                    expense_code: expense.expense_code,
                    jumlah: normalizeDetailAmount(expense.jumlah),
                    total_amount: totalAmount
                };
                break;
            case 'kendaraan':
                metadataJson = {
                    input_type: 'kendaraan',
                    items: normalizeDetailItems(kendaraanItems.filter(item => item.nomor_kendaraan || item.expense_code || item.jumlah)),
                    total_amount: totalAmount
                };
                break;
            case 'blok,exp':
                metadataJson = {
                    input_type: 'blok,exp',
                    blok_items: normalizeDetailItems(comboBlokItems.filter(item => item.subblok || item.gang_code || item.jumlah)),
                    expense: normalizeDetailExpense(comboExpense),
                    total_amount: totalAmount
                };
                break;
            default:
                metadataJson = null;
        }

        onSave?.(metadataJson, amountToSave, {
            amountEdited: false,
            amountSyncedToDetail: true
        });
        onClose?.();
    }, [canEdit, showDetailValidation, inputType, blokItems, expense, kendaraanItems, comboBlokItems, comboExpense, totalAmount, amountToSave, normalizeDetailAmount, normalizeDetailItems, normalizeDetailExpense, onSave, onClose]);

    if (!isOpen) return null;

    const inputTypeLabel = {
        'amount': 'Input Amount',
        'blok': 'Detail Blok',
        'exp': 'Detail Expense',
        'kendaraan': 'Detail Kendaraan',
        'blok,exp': 'Detail Blok + Expense'
    }[inputType] || 'Detail';

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 4000,
                padding: 20
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: 'min(640px, 96vw)',
                    maxHeight: '85vh',
                    overflow: 'hidden',
                    borderRadius: 16,
                    background: '#ffffff',
                    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.32)',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h3 style={{ margin: 0, fontSize: 17, color: '#0f172a' }}>{inputTypeLabel}</h3>
                            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
                                {definitionName || 'Premium'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{ border: 0, background: '#f1f5f9', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13 }}
                        >
                            Tutup
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                        {isLegacyFallback ? (
                            <div style={infoPanelStyle}>
                                <strong>Detail belum tersimpan di database.</strong> Popup ini membuat fallback dari amount awal supaya data lama tetap bisa dibuka. {canEdit ? 'Isi uraian subblok/metadata yang benar lalu simpan agar detail terbaru tersimpan di payroll_manual_adjustments.' : 'Mode lihat saja hanya menampilkan fallback; masuk mode edit untuk mengubah dan menyimpan detail.'}
                            </div>
                        ) : (
                            <div style={infoPanelStyle}>
                                {canEdit
                                    ? 'Total detail terbaru akan dipakai saat simpan (auto-sync aktif untuk semua tipe detail).'
                                    : 'Mode lihat saja. Detail dibaca dari payroll_manual_adjustments metadata_json.'}
                            </div>
                        )}

                        <div style={summaryGridStyle}>
                            {shouldShowAmountComparison && (
                                <div style={summaryCellStyle}>
                                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>Total amount awal</div>
                                    <div style={{ fontSize: 15, color: '#0f172a', fontWeight: 800 }}>{formatAmount(storedAmountNumber)}</div>
                                </div>
                            )}
                            <div style={shouldAutoSyncDetailAmount ? latestSummaryCellStyle : summaryCellStyle}>
                                <div style={{ fontSize: 11, color: shouldAutoSyncDetailAmount ? '#15803d' : '#64748b', fontWeight: 700 }}>Total detail terbaru</div>
                                <div style={{ fontSize: 15, color: '#0f172a', fontWeight: 800 }}>{formatAmount(totalAmount)}</div>
                                {shouldAutoSyncDetailAmount && (
                                    <div style={{ fontSize: 11, color: '#15803d', fontWeight: 700, marginTop: 2 }}>Dipakai saat simpan</div>
                                )}
                            </div>
                            {shouldShowAmountComparison && (
                                <div style={infoSummaryCellStyle}>
                                    <div style={{ fontSize: 11, color: '#075985', fontWeight: 700 }}>Selisih</div>
                                    <div style={{ fontSize: 15, color: '#075985', fontWeight: 800 }}>{formatAmount(Math.abs(diffFromStored))}</div>
                                </div>
                            )}
                        </div>

                        {shouldShowAmountComparison && detailDiffersFromStored && (
                            <div style={infoPanelStyle}>
                                Info: total detail terbaru berbeda {formatAmount(Math.abs(diffFromStored))} dari amount awal. Saat disimpan, amount akan otomatis mengikuti total detail terbaru.
                            </div>
                        )}

                        {shouldShowEmptyStoredAmountInfo && (
                            <div style={infoPanelStyle}>
                                Amount awal kosong, total detail terbaru akan dipakai saat disimpan.
                            </div>
                        )}

                        {visibleMismatch && (
                            <div style={infoPanelStyle}>
                                <strong>Info:</strong> total detail terbaru {formatAmount(mismatchDetailTotal)} berbeda dari amount awal {formatAmount(mismatchAmount)} dengan selisih {formatAmount(Math.abs(mismatchDiff))}. {visibleMismatch.reason || 'Ini hanya informasi pembanding.'} Saat disimpan, amount akan mengikuti total detail terbaru.
                            </div>
                        )}

                        {showDetailValidation && (
                            <div style={warningPanelStyle}>
                                <strong>Data detail belum lengkap.</strong> {detailValidation.reasons.join(' ')}
                            </div>
                        )}

                        {canEdit && inputType === 'amount' && (
                            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
                                <label style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'block', marginBottom: 8 }}>
                                    Amount
                                </label>
                                <input
                                    style={{ ...numberInputStyle, maxWidth: 220 }}
                                    type="number"
                                    value={amountDraft}
                                    onChange={(event) => setAmountDraft(Number(event.target.value) || 0)}
                                    placeholder="0"
                                />
                            </div>
                        )}
                    </div>

                    {inputType === 'amount' && !canEdit && (
                        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', textAlign: 'center', padding: '12px 0' }}>
                            {formatAmount(totalAmount)}
                        </div>
                    )}

                    {inputType === 'blok' && (
                        <BlokEditor items={blokItems} onChange={setBlokItems} adjustmentType={adjustmentType} defaultGangCode={defaultGangCode} readOnly={!canEdit} showValidation={showDetailValidation} />
                    )}

                    {inputType === 'exp' && (
                        <ExpenseEditor expense={expense} onChange={setExpense} adjustmentType={adjustmentType} readOnly={!canEdit} showValidation={showDetailValidation} />
                    )}

                    {inputType === 'kendaraan' && (
                        <KendaraanEditor items={kendaraanItems} onChange={setKendaraanItems} adjustmentType={adjustmentType} readOnly={!canEdit} showValidation={showDetailValidation} />
                    )}

                    {inputType === 'blok,exp' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Blok Items</div>
                                <BlokEditor items={comboBlokItems} onChange={setComboBlokItems} adjustmentType={adjustmentType} defaultGangCode={defaultGangCode} readOnly={!canEdit} showValidation={showDetailValidation} />
                            </div>
                            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Expense</div>
                                <ExpenseEditor expense={comboExpense} onChange={setComboExpense} adjustmentType={adjustmentType} readOnly={!canEdit} showValidation={showDetailValidation} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '14px 20px',
                    borderTop: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10
                }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>
                        Detail: <span style={{ color: '#16a34a' }}>{formatAmount(totalAmount)}</span>
                        <span style={{ color: '#64748b', marginLeft: 10 }}>
                            {canEdit ? 'Amount simpan' : 'Amount tersimpan'}: {formatAmount(amountToSave)}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 13 }}
                        >
                            {canEdit ? 'Batal' : 'Tutup'}
                        </button>
                        {canEdit && (
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={showDetailValidation}
                                style={{
                                    padding: '8px 14px',
                                    borderRadius: 8,
                                    border: 0,
                                    background: showDetailValidation ? '#94a3b8' : '#16a34a',
                                    color: '#fff',
                                    fontWeight: 700,
                                    cursor: showDetailValidation ? 'not-allowed' : 'pointer',
                                    fontSize: 13
                                }}
                            >
                                Simpan Detail
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
