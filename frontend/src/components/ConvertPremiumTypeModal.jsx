import React, { useEffect, useMemo, useState } from 'react';
import { fetchPremiumDefinitions, validatePremiumConversion, convertPremiumType } from '../services/manualAdjustmentService';
import { validateLockedPremiumConversion, convertLockedPremiumType } from '../services/lockedDivisionService';

const METADATA_ACTION_LABEL = {
    keep: 'Metadata dipertahankan (input_type sama)',
    remap: 'Metadata dire-map ke struktur target',
    drop: 'Metadata dihapus, pakai nominal total',
    seed: 'Metadata placeholder dibuat dari nominal'
};

export default function ConvertPremiumTypeModal({
    isOpen,
    onClose,
    onConverted,
    token,
    month,
    year,
    division,
    isProdMode = false,
    currentColumns = []
}) {
    const [fromName, setFromName] = useState('');
    const [toName, setToName] = useState('');
    const [premiumDefinitions, setPremiumDefinitions] = useState([]);
    const [loadingDefs, setLoadingDefs] = useState(false);
    const [validation, setValidation] = useState(null);
    const [validating, setValidating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const activePremiumDefs = useMemo(
        () => (premiumDefinitions || []).filter((def) => {
            const type = def?.adjustment_type || 'PREMI';
            return def?.is_active !== false && type === 'PREMI';
        }),
        [premiumDefinitions]
    );

    useEffect(() => {
        if (!isOpen) return;
        setFromName('');
        setToName('');
        setValidation(null);
        setError('');
    }, [isOpen]);

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

    // Live validation when from+to both set
    useEffect(() => {
        if (!isOpen || !token || !fromName || !toName || fromName === toName) {
            setValidation(null);
            return;
        }
        let cancelled = false;
        (async () => {
            setValidating(true);
            try {
                const result = isProdMode
                    ? await validateLockedPremiumConversion(token, { from: fromName, to: toName })
                    : await validatePremiumConversion(token, { from: fromName, to: toName });
                if (!cancelled) setValidation(result?.validation || null);
            } catch (e) {
                if (!cancelled) setValidation(null);
            } finally {
                if (!cancelled) setValidating(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, token, fromName, toName, isProdMode]);

    const allowed = validation?.allowed === true;
    const blocked = validation && !validation.allowed;
    const canConvert = Boolean(fromName && toName && fromName !== toName && allowed && !saving && !validating);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!canConvert) return;
        setSaving(true);
        setError('');
        try {
            const payload = {
                period_month: Number(month),
                period_year: Number(year),
                division_code: division && division !== 'ALL' ? division : undefined,
                adjustment_type: 'PREMI',
                from_adjustment_name: fromName,
                to_adjustment_name: toName
            };
            const result = isProdMode
                ? await convertLockedPremiumType(token, payload)
                : await convertPremiumType(token, payload);
            if (result?.success === false) {
                setError(result?.error || 'Gagal mengonversi jenis premi');
                return;
            }
            onConverted?.(result);
            onClose?.();
        } catch (e) {
            const msg = e?.response?.data?.error || e?.message || 'Gagal mengonversi jenis premi';
            setError(msg);
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 3000, padding: 20
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: 'min(640px, 96vw)', maxHeight: '90vh', overflow: 'hidden',
                    borderRadius: 16, background: '#ffffff',
                    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.32)',
                    border: '1px solid #e2e8f0'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ padding: '18px 22px', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>Ubah Jenis Premi</h2>
                            <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>
                                Konversi kolom premi tersimpan ke jenis lain sesuai format baku. Berlaku untuk semua baris di periode + divisi ini.
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
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Dari (jenis saat ini)</label>
                                <select
                                    value={fromName}
                                    onChange={(e) => setFromName(e.target.value)}
                                    style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                                >
                                    <option value="">- pilih kolom premi -</option>
                                    {(currentColumns || []).filter((c) => c?.type === 'PREMI' && c?.name).map((c) => (
                                        <option key={c.name} value={c.name}>{c.name}</option>
                                    ))}
                                </select>
                                {(currentColumns || []).filter((c) => c?.type === 'PREMI').length === 0 && (
                                    <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>Tidak ada kolom premi tersedia.</div>
                                )}
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Ke (jenis target)</label>
                                <select
                                    value={toName}
                                    onChange={(e) => setToName(e.target.value)}
                                    style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                                >
                                    <option value="">- pilih definisi target -</option>
                                    {activePremiumDefs.map((def) => (
                                        <option key={def.adjustment_name} value={def.adjustment_name}>
                                            {def.adjustment_name} ({def.input_type})
                                        </option>
                                    ))}
                                </select>
                                {loadingDefs && <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>Memuat definisi...</div>}
                            </div>

                            {validation && (
                                <div style={{
                                    padding: 12, borderRadius: 10,
                                    background: blocked ? '#fef2f2' : '#f0fdf4',
                                    border: `1px solid ${blocked ? '#fecaca' : '#bbf7d0'}`,
                                    color: blocked ? '#b91c1c' : '#15803d',
                                    fontSize: 13
                                }}>
                                    <div style={{ fontWeight: 800, marginBottom: 4 }}>
                                        {blocked ? '× Diblokir' : 'Diizinkan'}
                                    </div>
                                    <div>{validation.reason}</div>
                                    {allowed && validation.metadata_action && (
                                        <div style={{ marginTop: 4, fontWeight: 600 }}>
                                            {METADATA_ACTION_LABEL[validation.metadata_action] || validation.metadata_action}
                                        </div>
                                    )}
                                </div>
                            )}

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
                        <button type="submit" disabled={!canConvert} style={{ padding: '10px 16px', borderRadius: 9, border: 0, background: canConvert ? '#2563eb' : '#94a3b8', color: 'white', fontWeight: 800, cursor: canConvert ? 'pointer' : 'not-allowed' }}>
                            {saving ? 'Mengonversi...' : 'Konversi'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
