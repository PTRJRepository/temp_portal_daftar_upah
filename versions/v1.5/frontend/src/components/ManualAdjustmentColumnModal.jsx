import React, { useEffect, useMemo, useState } from 'react';
import { fetchPremiumDefinitions } from '../services/manualAdjustmentService';

const CATEGORY_OPTIONS = [
    { value: 'PREMI', label: 'Premi', color: '#16a34a' },
    { value: 'POTONGAN_KOTOR', label: 'Koreksi / Potongan Kotor', color: '#ea580c' },
    { value: 'POTONGAN_BERSIH', label: 'Potongan Bersih', color: '#dc2626' }
];

function resolveAdCode(definition) {
    return definition?.ad_code || '';
}

function buildRemarks(definition, adjustmentName, amount = 0) {
    if (!definition) return '';
    const adCode = resolveAdCode(definition);
    const taskDesc = definition.task_desc || '';
    return `${adjustmentName} | ${adCode}${taskDesc ? ` - ${taskDesc}` : ''} | ${amount} | sync:MISS | match:MISMATCH`;
}

function isSuffixTemplateDefinition(definition) {
    return /\bX$/i.test(String(definition?.adjustment_name || '').trim());
}

function buildNameFromTemplate(definition, suffix) {
    const templateName = String(definition?.adjustment_name || '').trim();
    if (!isSuffixTemplateDefinition(definition)) return templateName;
    return templateName.replace(/\bX$/i, String(suffix || '').trim()).replace(/\s+/g, ' ').trim();
}

function getTemplateSuffix(definition, value) {
    const templateName = String(definition?.adjustment_name || '').trim();
    if (!isSuffixTemplateDefinition(definition)) return '';
    const prefix = templateName.replace(/\bX$/i, '').trim();
    return String(value || '').replace(new RegExp(`^${prefix}\\s*`, 'i'), '').trimStart();
}

export default function ManualAdjustmentColumnModal({
    isOpen,
    onClose,
    onSaved,
    token,
    division,
    initialAdjustmentType = 'PREMI'
}) {
    const [adjustmentType, setAdjustmentType] = useState('PREMI');
    const [docDesc, setDocDesc] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const [premiumDefinitions, setPremiumDefinitions] = useState([]);
    const [selectedPremiumDef, setSelectedPremiumDef] = useState(null);
    const [premiumDefinitionSearch, setPremiumDefinitionSearch] = useState('');
    const [loadingDefs, setLoadingDefs] = useState(false);

    const selectedCategory = useMemo(
        () => CATEGORY_OPTIONS.find((item) => item.value === adjustmentType) || CATEGORY_OPTIONS[0],
        [adjustmentType]
    );

    const activeDefinitions = useMemo(
        () => (premiumDefinitions || []).filter((def) => {
            const type = def?.adjustment_type || 'PREMI';
            if (def?.is_active === false) return false;
            if (adjustmentType === 'POTONGAN_KOTOR') return type === 'POTONGAN_KOTOR';
            return type === adjustmentType;
        }),
        [premiumDefinitions, adjustmentType]
    );

    const koreksiBaseDefinition = useMemo(
        () => activeDefinitions[0] || null,
        [activeDefinitions]
    );

    const filteredPremiumDefinitions = useMemo(() => {
        const query = premiumDefinitionSearch.trim().toUpperCase();
        if (!query) return activeDefinitions;
        return activeDefinitions.filter((def) => {
            const text = `${def.adjustment_name || ''} ${def.ad_code || ''} ${def.task_desc || ''} ${def.input_type || ''}`.toUpperCase();
            return text.includes(query);
        });
    }, [activeDefinitions, premiumDefinitionSearch]);

    const selectedDefinition = adjustmentType === 'POTONGAN_KOTOR' ? koreksiBaseDefinition : selectedPremiumDef;
    const selectedUsesSuffix = isSuffixTemplateDefinition(selectedDefinition);
    const nameError = selectedUsesSuffix && !String(docDesc || '').trim()
        ? 'Lanjutkan nama kolom untuk mengganti X.'
        : '';
    const resolvedAdjustmentName = selectedUsesSuffix
        ? buildNameFromTemplate(selectedDefinition, docDesc)
        : selectedDefinition?.adjustment_name || '';
    const premiumSelectionError = !selectedDefinition
        ? 'Pilih definisi dari premium_definitions.json.'
        : '';

    useEffect(() => {
        if (!isOpen) return;
        setAdjustmentType(CATEGORY_OPTIONS.some((option) => option.value === initialAdjustmentType) ? initialAdjustmentType : 'PREMI');
        setDocDesc('');
        setError('');
        setSelectedPremiumDef(null);
        setPremiumDefinitionSearch('');
    }, [isOpen, initialAdjustmentType]);

    // Load premium definitions (format baku) when modal opens
    useEffect(() => {
        if (!isOpen || !token) return;
        let cancelled = false;
        (async () => {
            setLoadingDefs(true);
            try {
                const result = await fetchPremiumDefinitions(token);
                const defs = Array.isArray(result) ? result : result?.data || [];
                if (!cancelled) setPremiumDefinitions(defs);
            } catch (e) {
                if (!cancelled) setPremiumDefinitions([]);
            } finally {
                if (!cancelled) setLoadingDefs(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, token]);

    const canSave = Boolean(
        resolvedAdjustmentName
        && !nameError
        && !premiumSelectionError
        && selectedDefinition
        && !saving
    );

    const handlePremiumDefSelect = (def) => {
        setSelectedPremiumDef(def);
        if (def) {
            setDocDesc(isSuffixTemplateDefinition(def) ? '' : def.adjustment_name);
            setError('');
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (nameError) {
            setError(nameError);
            return;
        }
        if (premiumSelectionError) {
            setError(premiumSelectionError);
            return;
        }
        if (!canSave) return;

        setSaving(true);
        setError('');
        try {
            const adCode = resolveAdCode(selectedDefinition);
            await onSaved?.({
                adjustment_type: adjustmentType,
                adjustment_name: resolvedAdjustmentName,
                ad_code: adCode,
                task_code: adCode,
                base_task_code: adCode,
                task_desc: selectedDefinition?.task_desc,
                loc_code: division && division !== 'ALL' ? division : undefined,
                remarks: buildRemarks(selectedDefinition, resolvedAdjustmentName, 0),
                input_type: selectedDefinition?.input_type || 'amount'
            });
            onClose?.();
        } catch (e) {
            setError(e.message || 'Gagal menambahkan kolom manual adjustment');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 3000,
                padding: 20
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: 'min(720px, 96vw)',
                    maxHeight: '90vh',
                    overflow: 'hidden',
                    borderRadius: 16,
                    background: '#ffffff',
                    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.32)',
                    border: '1px solid #e2e8f0'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ padding: '18px 22px', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Tambah Kolom Manual Adjustment</h2>
                            <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>
                                Pilih format baku dari backend/data/premium_definitions.json. Tidak ada preset tambahan di luar file itu.
                            </p>
                        </div>
                        <button type="button" onClick={onClose} style={{ border: 0, background: '#f1f5f9', borderRadius: 8, padding: '8px 10px', cursor: 'pointer' }}>
                            Tutup
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} style={{ maxHeight: 'calc(90vh - 86px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: 22, overflowY: 'auto', minHeight: 0 }}>
                    <div style={{ display: 'grid', gap: 14 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                                Kategori Rule
                            </label>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {CATEGORY_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => {
                                            setAdjustmentType(option.value);
                                            setSelectedPremiumDef(null);
                                            setDocDesc('');
                                            setPremiumDefinitionSearch('');
                                            setError('');
                                        }}
                                        style={{
                                            border: adjustmentType === option.value ? `2px solid ${option.color}` : '1px solid #cbd5e1',
                                            background: adjustmentType === option.value ? `${option.color}12` : '#ffffff',
                                            color: '#0f172a',
                                            borderRadius: 999,
                                            padding: '8px 12px',
                                            fontWeight: 800,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {selectedUsesSuffix && (
                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                                    Ganti X pada {selectedDefinition?.adjustment_name}
                                </label>
                                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                                    <span style={{ padding: '10px 12px', border: '1px solid #cbd5e1', borderRight: 0, borderRadius: '9px 0 0 9px', background: '#fff7ed', color: '#c2410c', fontWeight: 800 }}>
                                        {String(selectedDefinition?.adjustment_name || '').replace(/\bX$/i, '').trim()}
                                    </span>
                                    <input
                                        value={getTemplateSuffix(selectedDefinition, resolvedAdjustmentName)}
                                        onChange={(event) => setDocDesc(event.target.value.toUpperCase())}
                                        placeholder="contoh: PANEN"
                                        style={{ flex: 1, padding: 10, borderRadius: '0 9px 9px 0', border: '1px solid #cbd5e1' }}
                                    />
                                </div>
                                <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>
                                    ADCode, TaskDesc, dan input detail tetap mengikuti definisi template dari premium_definitions.json.
                                </div>
                                {nameError && (
                                    <div style={{ marginTop: 6, color: '#b45309', fontSize: 12, fontWeight: 700 }}>
                                        {nameError}
                                    </div>
                                )}
                            </div>
                        )}

                        <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                                Definisi Kolom dari premium_definitions.json
                            </label>
                            <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
                                <div style={{ padding: '8px 12px', background: '#f8fafc', color: '#64748b', fontSize: 12 }}>
                                    {loadingDefs ? 'Memuat definisi...' : `${filteredPremiumDefinitions.length} dari ${activeDefinitions.length} definisi aktif untuk ${selectedCategory.label}`}
                                </div>
                                <div style={{ padding: 10, borderTop: '1px solid #f1f5f9', background: '#ffffff' }}>
                                    <input
                                        value={premiumDefinitionSearch}
                                        onChange={(e) => setPremiumDefinitionSearch(e.target.value)}
                                        placeholder="Cari nama, ADCode, TaskDesc, atau input type..."
                                        style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                                    />
                                </div>
                                {filteredPremiumDefinitions.map((def) => {
                                    const active = selectedPremiumDef?.adjustment_name === def.adjustment_name;
                                    const typeLabel = {
                                        'amount': 'Nominal',
                                        'blok': 'Blok Detail',
                                        'exp': 'Expense',
                                        'kendaraan': 'Kendaraan',
                                        'blok,exp': 'Blok + Expense'
                                    }[def.input_type] || def.input_type || 'Nominal';
                                    return (
                                        <button
                                            key={`${def.adjustment_type || 'PREMI'}-${def.adjustment_name}`}
                                            type="button"
                                            onClick={() => handlePremiumDefSelect(def)}
                                            style={{
                                                width: '100%',
                                                textAlign: 'left',
                                                padding: '10px 12px',
                                                border: 0,
                                                borderTop: '1px solid #f1f5f9',
                                                background: active ? '#ecfdf5' : '#ffffff',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                                <strong style={{ color: '#0f172a' }}>{def.adjustment_name}</strong>
                                                <span style={{
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    color: active ? '#16a34a' : '#64748b',
                                                    border: '1px solid #e2e8f0',
                                                    borderRadius: 999,
                                                    padding: '2px 8px',
                                                    background: active ? '#f0fdf4' : '#f8fafc'
                                                }}>
                                                    {typeLabel}
                                                </span>
                                            </div>
                                            <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{def.ad_code || '-'}</div>
                                            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{def.task_desc || '-'}</div>
                                        </button>
                                    );
                                })}
                                {!loadingDefs && filteredPremiumDefinitions.length === 0 && (
                                    <div style={{ padding: 18, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                                        Tidak ada definisi aktif untuk kategori ini. Tambahkan format baku di backend/data/premium_definitions.json.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
                            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Konfigurasi Terpilih</div>
                            {selectedDefinition ? (
                                <>
                                    <div style={{ fontSize: 13 }}>Nama: <strong>{resolvedAdjustmentName || '-'}</strong></div>
                                    <div style={{ fontSize: 13, marginTop: 4 }}>ADCode: <strong>{selectedDefinition.ad_code || '-'}</strong></div>
                                    <div style={{ fontSize: 13, marginTop: 4 }}>TaskDesc: {selectedDefinition.task_desc || '-'}</div>
                                    <div style={{ fontSize: 13, marginTop: 4 }}>Input detail: {selectedDefinition.input_type || 'amount'}</div>
                                </>
                            ) : (
                                <div style={{ fontSize: 13, color: '#64748b' }}>
                                    Pilih definisi dari daftar. Tidak ada preset tambahan di luar premium_definitions.json.
                                </div>
                            )}
                        </div>

                        {error && (
                            <div style={{ padding: 12, borderRadius: 10, background: '#fef2f2', color: '#b91c1c', fontSize: 13, border: '1px solid #fecaca' }}>
                                {error}
                            </div>
                        )}
                    </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', borderTop: '1px solid #e2e8f0', background: '#ffffff', boxShadow: '0 -8px 18px rgba(15, 23, 42, 0.06)', position: 'sticky', bottom: 0, flexShrink: 0 }}>
                        <button type="button" onClick={onClose} disabled={saving} style={{ padding: '10px 16px', borderRadius: 9, border: '1px solid #cbd5e1', background: '#ffffff', cursor: saving ? 'not-allowed' : 'pointer' }}>
                            Batal
                        </button>
                        <button type="submit" disabled={!canSave} style={{ padding: '10px 16px', borderRadius: 9, border: 0, background: canSave ? selectedCategory.color : '#94a3b8', color: 'white', fontWeight: 800, cursor: canSave ? 'pointer' : 'not-allowed' }}>
                            {saving ? 'Menyimpan...' : 'Simpan Kolom'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
