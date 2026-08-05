import React, { useEffect, useState, useRef, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import '../styles/CustomPayrollTable.css';
import { getLockedRawTree, saveLockedManualEdit, saveLockedProfileOverride, saveLockedValueOverrides, seedLockedAutoBufferToManualAdjustment, deleteLockedManualAdjustmentColumn } from '../services/lockedDivisionService';
import { isProdMode } from '../utils/prodModeUtils';
import { exportPayrollToExcel } from '../utils/exportPayrollToExcel';
import PayrollScrollChapterBar from './PayrollScrollChapterBar';
import PayrollViewModeToolbar from './PayrollViewModeToolbar';
import ManualAdjustmentColumnModal from './ManualAdjustmentColumnModal';
import ConvertPremiumTypeModal from './ConvertPremiumTypeModal';
import PremiumDetailPopup from './PremiumDetailPopup';
import { DeferredPayrollNumberInput } from './PayrollDeferredEditInput';
import { deleteManualAdjustmentColumn, saveManualAdjustment, fetchPremiumDefinitions } from '../services/manualAdjustmentService';
import SelectionStatusBar from './common/SelectionStatusBar';
import TableContextMenu from './common/TableContextMenu';
import LoadingScreen from './common/LoadingScreen';
import { getTablePreferences, DEFAULT_CELL_COLORS } from '../services/tablePreferencesService';
import { usePayrollStream } from '../hooks/usePayrollStream';
import { splitPayrollEdits } from '../utils/payrollEditPayloads';
import { appendSnapshotVersionToSearchParams, buildPayrollSnapshotCacheKey, normalizeSnapshotVersion } from '../utils/payrollSnapshotQuery';
import { resolveEffectiveGangPrefix } from '../utils/payrollRequestScope';
import { resolveJabatanRate } from '../utils/payrollRowAccessors';
import { formatOtherIncomeColumnLabel, getOtherIncomeDetailFields } from '../utils/otherIncomeColumns';
import { isPayrollNumericField, isPayrollTotalDisplayOnlyField, isSignedPayrollDeductionField, resolveGrandTotalNumericValue } from '../utils/payrollGrandTotalValue';
import { buildCanonicalManualAdjustmentName, buildManualColumnPlaceholderPayload, buildPendingManualColumn, resolvePremiumDefinitionForAdjustment } from '../utils/payrollManualAdjustmentNames';
import { buildPremiumDetailEdit, validatePremiumDetailMetadata } from '../utils/payrollPremiumDetailEdits';
import { normalizeManualDetailInputType, resolveManualDetailInputType } from '../utils/manualDetailInputType';
import { parsePayrollInputNumber, resolvePersistentOriginalNumber, toFinitePayrollNumber } from '../utils/payrollNumericValues';
import { getPayrollEffectiveScale, getPayrollResponsiveScaleForWidth } from '../utils/payrollResponsiveScale';
import { PAYROLL_HEADER_GROUPS, getPayrollHeaderGroup, isPayrollGroupToggleable, normalizePayrollHeaderGroup } from '../utils/payrollHeaderGroups';
import { buildPayrollHeaderRows, getPayrollChapterWindowForGroup } from '../utils/payrollHeaderLayout';
import { resolvePayrollClientRuntimePolicy } from '../utils/payrollClientRuntime';
import { compareEmpCodeValues, sortEmployeesByEmpCode } from '../utils/employeeSort';
import { PayrollAggregator } from '../utils/PayrollAggregator';
import {
    buildPayrollViewportChapters,
    detectActivePayrollChapter,
    getPayrollViewportWindow,
    getPayrollChapterScrollLeft,
    resolvePayrollDisplayModeState
} from '../utils/payrollViewportChapters';

/**
 * DAFTAR UPAH (Payroll Register)
 *
 * Daftar Upah adalah tabel yang berisi uraian lengkap tentang gaji karyawan,
 * yang mencakup:
 *
 * 1. IDENTITAS - Data karyawan (NIK, Nama, Jabatan, Gang)
 *
 * 2. ABSENSI - Kehadiran kerja
 *    - Jumlah HK (Hari Kerja)
 *    - Cuti (Tahunan, Sakit/Haid, Minggu, Nasional)
 *
 * 3. PENGGAJIAN - Upah pokok dan dasar
 *    - Upah Dasar, Gaji Pokok
 *
 * 4. TUNJANGAN - Tunjangan karyawan
 *    - Tunjangan Beras, Jabatan, Masa Kerja
 *    - Lembur (jika ada)
 *
 * 5. PENDAPATAN LAINNYA - Income tambahan (THR, Bonus, dll)
 *    - THR (Tunjangan Hari Raya) - dihitung untuk pajak, dipotong dari upah bersih
 *
 * 6. PREMI - Premi kerja
 *    - Premi Brondol, Pruning, dll
 *
 * 7. POTONGAN UPAH KOTOR - Potongan yang mengurangi upah kotor
 *    - Koreksi (jika ada)
 *
 * 8. UPAH KOTOR (Gross) - Total sebelum pajak
 *    = Gaji Pokok + Tunjangan + Premi + Pendapatan Lain - Koreksi
 *    ** Sudah termasuk THR untuk perhitungan PPh21 **
 *
 * 9. POTONGAN UPAH BERSIH - Potongan untuk menghitung upah bersih
 *    - ASTEK (BPJS Ketenagakerjaan)
 *    - BPJS Kesehatan
 *    - SPSI
 *    - PPh21
 *    - dll
 *
 * 10. UPAH BERSIH (Net) - Take-home pay
 *     = Upah Kotor - Total Potongan
 *     ** Sudah dikurangkan THR karena dibayarkan terpisah di bulan Februari **
 *
 * 11. PAJAK - Informasi PPh21
 *     - TER Category, PTKP Status
 *
 * Data diambil dari berbagai tabel database:
 * - HR_EMPLOYEE, HR_GANG (Identitas)
 * - PR_TASKREGLN (Absensi, Lembur)
 * - PR_ADTRANS (Premi, Potongan)
 * - employee_other_incomes (THR, Bonus)
 * - HR_PAYROLL (Konfigurasi Gaji)
 */

const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    if (isNaN(n)) return '-';
    return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n));
};

const formatDecimal = (value) => {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    if (isNaN(n)) return '-';
    return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
};

const formatNegativeTotalNumber = (value) => {
    const n = Number(value) || 0;
    if (n === 0) return '-';
    return `-${formatNumber(Math.abs(n))}`;
};

const toFiniteNumber = toFinitePayrollNumber;

const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const EMPTY_CELL_STYLE = Object.freeze({});

const getInitialViewportWidth = () => {
    if (typeof window === 'undefined') return 1920;
    return window.innerWidth || 1920;
};

// Format header label to support newlines manually across environments
const formatHeaderLabel = (label) => {
    if (typeof label !== 'string') return label;
    if (!label.includes('\n')) return label;
    return label.split('\n').map((part, i) => (
        <React.Fragment key={i}>
            {i > 0 && <br />}
            {i === 1 ? <span style={{ fontSize: '0.72em', fontWeight: 'normal', color: '#cbd5e1' }}>{part}</span> : part}
        </React.Fragment>
    ));
};

const VALUE_PRIORITY_MODE_STORAGE_KEY = 'payroll.value_priority_mode';

const normalizeValuePriorityMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'db_ptrj_only') return 'db_ptrj_only';
    return 'non_db_ptrj';
};

const normalizeFieldKey = (value) => String(value || '').trim().toLowerCase();

const formatSourceCompareValue = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
    const n = Number(value);
    if (!Number.isNaN(n) && String(value).trim() !== '') return formatNumber(n);
    return String(value);
};

const STATIC_PREMI_FIELDS = new Set(['premi_brondol']);
const STATIC_BRONDOL_FIELD_KEYS = new Set([
    'brondol',
    'brondol_adtrans',
    'brondol_loosefruit',
    'brondol_total',
    'premi_brondol',
    'premi_brondol_adtrans',
    'premi_brondol_loosefruit',
    'premi_brondol_total'
]);
const STATIC_BRONDOL_LABELS = new Set([
    'BRONDOL',
    'BRONDOL ADTRANS',
    'BRONDOL LOOSEFRUIT',
    'BRONDOL TOTAL',
    'PREMI BRONDOL',
    'PREMI BRONDOL ADTRANS',
    'PREMI BRONDOL LOOSEFRUIT',
    'PREMI BRONDOL TOTAL'
]);
const STATIC_POTONGAN_FIELDS = new Set(['pot_spsi']);

const normalizeHeaderLabel = (value) => String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();

const isBrondolFieldKey = (value) => {
    const normalized = normalizeFieldKey(value);
    return STATIC_BRONDOL_FIELD_KEYS.has(normalized);
};

const isSpsiFieldKey = (value) => {
    const normalized = normalizeFieldKey(value);
    if (!normalized) return false;
    return normalized === 'spsi'
        || normalized === 'pot_spsi'
        || normalized === 'potongan_spsi'
        || normalized === 'potongan_lainnya_spsi'
        || /^potongan_.*(^|_)spsi(_|$)/.test(normalized);
};

const isStaticPremiFieldKey = (value) => STATIC_PREMI_FIELDS.has(normalizeFieldKey(value)) || isBrondolFieldKey(value);
const isStaticPotonganFieldKey = (value) => STATIC_POTONGAN_FIELDS.has(normalizeFieldKey(value)) || isSpsiFieldKey(value);
const isStaticBrondolHeader = (label, field) => isBrondolFieldKey(field) || STATIC_BRONDOL_LABELS.has(normalizeHeaderLabel(label));
const isSpsiLabel = (value) => /\bSPSI\b/i.test(String(value || ''));

const isPremiFieldKey = (value) => normalizeFieldKey(value).startsWith('premi_') && !isStaticPremiFieldKey(value);
const DETAIL_TOTAL_MISMATCH_PREMI_NAMES = new Set(['PREMI PRUNING', 'PREMI RAKING']);

const normalizeAdjustmentNameForMismatch = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

const buildManualDetailMismatchReason = (mismatch) => {
    if (!mismatch) return '';
    return mismatch.reason || `Total detail terbaru ${formatNumber(mismatch.detail_total)} berbeda dari amount awal ${formatNumber(mismatch.amount)}. Detail terbaru dipakai saat simpan.`;
};

const buildIncompleteDetailReason = (validation) => {
    const reasons = validation?.reasons || [];
    return reasons.length ? reasons.join(' ') : 'Data detail belum lengkap.';
};

const buildManualDetailIssueReason = ({ mismatch, validation }) => {
    if (mismatch) return `Alasan tanda merah: ${buildManualDetailMismatchReason(mismatch)}`;
    if (validation && !validation.isComplete) return `Data detail belum lengkap: ${buildIncompleteDetailReason(validation)}`;
    return '';
};

const getVisibleManualDetailMismatch = ({ row, field, adjustmentType, adjustmentName }) => {
    const mismatch = row?.manual_adjustment_metadata_mismatch?.[field];
    if (!mismatch) return null;
    if (normalizeAdjustmentNameForMismatch(adjustmentType) !== 'PREMI') return null;
    if (!DETAIL_TOTAL_MISMATCH_PREMI_NAMES.has(normalizeAdjustmentNameForMismatch(adjustmentName))) return null;
    if (Math.abs(Number(mismatch.amount || 0)) <= 0.01) return null;
    return mismatch;
};

const getManualDetailValidation = ({ metadata, inputType, amount, adjustmentType }) => {
    const normalizedInputType = normalizeManualDetailInputType(inputType);
    if (!normalizedInputType || normalizedInputType === 'amount') return null;
    if (!metadata) {
        return Math.abs(Number(amount || 0)) > 0.01
            ? { isComplete: false, reasons: ['Detail wajib diisi sesuai input type.'], inputType: normalizedInputType }
            : null;
    }

    const validation = validatePremiumDetailMetadata(metadata, normalizedInputType, adjustmentType);
    return validation.isComplete ? null : validation;
};

// Gang percobaan = satu-satunya gang yang boleh mengubah PTKP master
// (rule sama dengan backend gangService.isPercobaanGang, 2026-08-03)
const isPercobaanGang = (gangCode, gangDesc) => {
    const code = String(gangCode || '').trim().toUpperCase();
    const desc = String(gangDesc || '').trim().toUpperCase();
    if (!code && !desc) return false;
    return desc.includes('PERCOBAAN') || code.endsWith('P') || code.includes('BHL');
};

const MANUAL_CELL_DELETE_MARKER = 'DELETE_CELL';

const buildManualCellDeleteRemarks = (name) => `${name || 'MANUAL ADJUSTMENT'} | ${MANUAL_CELL_DELETE_MARKER} | 0`;

const isManualCellDeleteEdit = (edit) => Boolean(edit?.delete_cell)
    || (Number(edit?.value || 0) === 0 && String(edit?.remarks || '').toUpperCase().includes(MANUAL_CELL_DELETE_MARKER));

const isAutomaticPayrollKoreksiFieldKey = (value) => normalizeFieldKey(value) === 'koreksi_hk';

const isDynamicGrossDeductionFieldKey = (value) => {
    const normalized = normalizeFieldKey(value);
    return !isAutomaticPayrollKoreksiFieldKey(normalized) && (normalized === 'koreksi' || normalized.startsWith('koreksi_'));
};

const isGrossDeductionFieldKey = (value) => {
    const normalized = normalizeFieldKey(value);
    return isDynamicGrossDeductionFieldKey(normalized) || normalized === 'pot_koreksi' || normalized === 'premi_koreksi' || normalized === 'potongan_upah_kotor_total';
};

const resolveGrossDeductionWithoutAutomaticHk = (row) => {
    if (!row || typeof row !== 'object') return { total: 0, excludedHk: 0 };

    const rawTotal = Math.abs(toFiniteNumber(row.potongan_upah_kotor_total));
    const potKoreksi = Math.abs(toFiniteNumber(row.pot_koreksi));
    const automaticHk = Math.abs(toFiniteNumber(row.koreksi_hk));
    let dynamicTotal = 0;

    Object.keys(row).forEach((key) => {
        if (isDynamicGrossDeductionFieldKey(key)) {
            dynamicTotal += Math.abs(toFiniteNumber(row[key]));
        }
    });

    const dynamicGross = row.potongan_upah_kotor?.dynamic;
    if (dynamicGross && typeof dynamicGross === 'object') {
        Object.entries(dynamicGross).forEach(([key, value]) => {
            if (isDynamicGrossDeductionFieldKey(key)) {
                dynamicTotal += Math.abs(toFiniteNumber(value));
            }
        });
    }

    const sourceTotal = rawTotal || potKoreksi;
    if (dynamicTotal > 0) {
        return {
            total: dynamicTotal,
            excludedHk: Math.max(0, sourceTotal - dynamicTotal)
        };
    }

    if (sourceTotal > 0 && automaticHk > 0 && Math.abs(sourceTotal - automaticHk) <= 1) {
        return { total: 0, excludedHk: sourceTotal };
    }

    return { total: sourceTotal, excludedHk: 0 };
};

const normalizeGrossDeductionForDisplay = (row) => {
    if (!row || typeof row !== 'object') return row;
    if (row.type && !['employee', 'gang_total', 'grand_total'].includes(row.type)) return row;

    const { total, excludedHk } = resolveGrossDeductionWithoutAutomaticHk(row);
    if (total === Math.abs(toFiniteNumber(row.potongan_upah_kotor_total)) && excludedHk === 0) {
        return row;
    }

    // [FIX] Do NOT add excludedHk back to jumlah_upah_kotor
    // koreksi_hk is already embedded in gaji_pokok_aktual (from PR_TASKREGLN scan)
    // Adding excludedHk back causes double counting where koreksi_hk is counted twice:
    // once in gaji_pokok_aktual and again in the gross calculation
    // pot_koreksi is a separate deduction from POTONGAN table, not derived from koreksi_hk
    return {
        ...row,
        potongan_upah_kotor_total: total
        // REMOVED: excludedHk adjustments - koreksi_hk already in gaji_pokok_aktual
    };
};

const isPotonganFieldKey = (value) => {
    const normalized = normalizeFieldKey(value);
    return !isStaticPotonganFieldKey(normalized) && !isGrossDeductionFieldKey(normalized) && normalized.startsWith('potongan_');
};

const isDynamicPotonganFieldKey = (value) => isPotonganFieldKey(value) || isDynamicGrossDeductionFieldKey(value);

const formatFallbackPremiLabel = (field) => {
    const normalized = normalizeFieldKey(field);
    if (!normalized) return String(field || '').trim().toUpperCase();

    if (normalized.startsWith('premi_')) {
        return `PREMI ${normalized.slice('premi_'.length).replace(/_/g, ' ').trim()}`.trim().toUpperCase();
    }

    return String(field || '').replace(/_/g, ' ').trim().toUpperCase();
};

const formatFallbackPotonganLabel = (field) => {
    const normalized = normalizeFieldKey(field);
    if (!normalized) return String(field || '').trim().toUpperCase();

    if (normalized.startsWith('koreksi_')) {
        return `KOREKSI ${normalized.slice('koreksi_'.length).replace(/_/g, ' ').trim()}`.trim().toUpperCase();
    }

    if (normalized.startsWith('potongan_lainnya_')) {
        return `POTONGAN LAINNYA ${normalized.slice('potongan_lainnya_'.length).replace(/_/g, ' ').trim()}`.trim().toUpperCase();
    }

    if (normalized.startsWith('potongan_')) {
        return `POTONGAN ${normalized.slice('potongan_'.length).replace(/_/g, ' ').trim()}`.trim().toUpperCase();
    }

    return String(field || '').replace(/_/g, ' ').trim().toUpperCase();
};

const parseMetadataObjectValue = (value) => {
    if (!value) return null;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const resolveInitialValuePriorityMode = () => {
    try {
        if (typeof window === 'undefined') return 'non_db_ptrj';
        return normalizeValuePriorityMode(localStorage.getItem(VALUE_PRIORITY_MODE_STORAGE_KEY));
    } catch {
        return 'non_db_ptrj';
    }
};

const {
    PAJAK,
    ABSENSI,
    PANEN,
    PENGGAJIAN,
    TUNJANGAN,
    PENDAPATAN_LAINNYA,
    PREMI,
    POTONGAN_UPAH_KOTOR,
    UPAH_KOTOR,
    POTONGAN_UPAH_BERSIH,
    UPAH_BERSIH
} = PAYROLL_HEADER_GROUPS;

const ADJUSTMENT_TYPE_BY_GROUP_LABEL = {
    [PREMI]: 'PREMI',
    [POTONGAN_UPAH_KOTOR]: 'POTONGAN_KOTOR',
    [POTONGAN_UPAH_BERSIH]: 'POTONGAN_BERSIH'
};

const KOREKSI_DEFAULT_AD_CODE = 'DE0004';
const KOREKSI_DEFAULT_TASK_DESC = '(DE) POTONGAN PREMI';
const KOREKSI_DEFAULT_INPUT_TYPE = 'blok';

const comparePayrollEmployeeRows = (a, b, sortBy) => {
    if (sortBy === 'emp_code') {
        return compareEmpCodeValues(a?.emp_code, b?.emp_code);
    }

    if (sortBy === 'name') {
        return String(a?.emp_name || a?.nama || '').localeCompare(String(b?.emp_name || b?.nama || ''), 'en', {
            numeric: true,
            sensitivity: 'base'
        });
    }

    if (sortBy === 'nik') {
        return String(a?.nik || '').localeCompare(String(b?.nik || ''), 'en', {
            numeric: true,
            sensitivity: 'base'
        });
    }

    return 0;
};

const CustomPayrollTable = memo(function CustomPayrollTable({
    token, month, year, division, gangCode, onViewEmployeeDetail, onOpenHrProfile, fontSize = 100,
    onExportReady = null, refreshTrigger = 0,
    selectedEmployees = [], onToggleEmployeeSelection = () => { },
    onSelectAllEmployees = () => { },
    isEditMode = false,
    useHistoryDb = false,
    snapshotVersion = null,
    gangPrefix = null,
    gangLoading = false,  // Pass gangLoading from parent to prevent fetch during gang load
    currentPeriodLoading = false,
    initialData = null,   // Cached raw API response from parent
    onDataLoaded = null,   // Callback to notify parent of loaded data
    onDataReady = null,    // Callback to expose displayRows data to parent
    onTaxExportReady = null, // Callback to expose data getter for Tax Export
    onRowsGetterReady = null, // Callback to expose displayRows getter without copying rows to parent
    valuePriorityMode: controlledValuePriorityMode = null,
    onValuePriorityModeChange = null,
    onValuePriorityModeResolved = null, // Callback to sync active source mode to parent/header
    onRefresh = null,      // Callback to trigger parent refresh (for saving)
    sortBy = 'emp_code',     // 'name' | 'emp_code' | 'nik'
    sortOrder = 'asc',     // 'asc' | 'desc'
    onSortChange = null
}) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    // Track data readiness - only show table content after confirmed data load
    const [dataReady, setDataReady] = useState(false);
    const [error, setError] = useState('');
    
    // Progressive loading state
    const [loadingProgress, setLoadingProgress] = useState({
        stage: null, // 'fetching' | 'processing' | 'rendering' | 'complete'
        message: '',
        currentGang: null,
        totalGangs: 0,
        processedGangs: 0,
        totalEmployees: 0,
        processedEmployees: 0
    });

    const [dynamicHeaders, setDynamicHeaders] = useState({ premi: {}, potongan: {} });
    const [grandTotal, setGrandTotal] = useState(null);
    const [resolvedSnapshotVersion, setResolvedSnapshotVersion] = useState(null);
    const [selection, setSelection] = useState([]); // Changed to array for multi-select
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStats, setSelectionStats] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [highlightedRowId, setHighlightedRowId] = useState(null);
    const [activePremiFields, setActivePremiFields] = useState([]);
    const [activePotFields, setActivePotFields] = useState([]);
    const [activePendapatanFields, setActivePendapatanFields] = useState([]); // dynamically discovered pendapatan_* fields
    const [allEmployeeNiks, setAllEmployeeNiks] = useState([]);

    // Manual Edit State
    const [editedCells, setEditedCells] = useState({}); // { 'nik-field': { value, originalValue, gang_code, type, name } }
    const [addedColumns, setAddedColumns] = useState([]); // Track new columns added in edit mode
    const [pendingDeletedColumns, setPendingDeletedColumns] = useState([]);
    const [manualAdjustmentModal, setManualAdjustmentModal] = useState({ isOpen: false, groupLabel: null, adjustmentType: 'PREMI' });
    const [convertTypeModal, setConvertTypeModal] = useState({ isOpen: false });
    const [isSavingEdits, setIsSavingEdits] = useState(false);
    const [isSeedingAutoBuffer, setIsSeedingAutoBuffer] = useState(false);

    // Premium detail popup state
    const emptyPremiumPopup = {
        isOpen: false,
        editKey: null,
        inputType: null,
        definitionName: null,
        defaultGangCode: '',
        initialData: null,
        storedAmount: 0,
        mismatch: null,
        editBase: null,
        readOnly: false
    };
    const [premiumPopup, setPremiumPopup] = useState(emptyPremiumPopup);
    const [premiumDefinitions, setPremiumDefinitions] = useState([]);

    // Kontan (Other Income) State - Always editable column
    const [editedKontanCells, setEditedKontanCells] = useState({}); // { 'nik-kontan': { value, originalValue, gang_code } }
    // Pendapatan Lainnya (Bonus, THR) State - Editable in edit mode
    const [editedPendapatanCells, setEditedPendapatanCells] = useState({}); // { 'nik-pendapatan_field': { value, originalValue, gang_code } }
    const [payrollToast, setPayrollToast] = useState(null);
    const [payrollConfirm, setPayrollConfirm] = useState(null);

    // Tunjangan Mode & Rates
    const [tunjanganMode, setTunjanganMode] = useState('DB'); // 'DB' or 'CALC'
    const [tunjanganRates, setTunjanganRates] = useState({});

    // Tax View Mode
    const [isTaxExpanded, setIsTaxExpanded] = useState(false);

    // State for collapsible column groups
    const [isHarvestExpanded, setHarvestExpanded] = useState(true);
    const [isAttendanceExpanded, setAttendanceExpanded] = useState(true);
    const [isPayrollExpanded, setPayrollExpanded] = useState(true);
    const [isAllowanceExpanded, setAllowanceExpanded] = useState(true);
    const [isOtherIncomeExpanded, setOtherIncomeExpanded] = useState(true);
    const [isPremiExpanded, setPremiExpanded] = useState(true);
    const [isDeductionExpanded, setDeductionExpanded] = useState(true); // Default true to show BPJS details

    // Table Preferences (Body Cell Colors - applied to body cells, NOT headers)
    const [cellColors, setCellColors] = useState(DEFAULT_CELL_COLORS);
    const initialDisplayState = useMemo(() => resolvePayrollDisplayModeState(), []);
    const [displayMode, setDisplayMode] = useState(initialDisplayState.mode);
    const [focusLensEnabled, setFocusLensEnabled] = useState(initialDisplayState.focusLens);
    const [internalValuePriorityMode, setInternalValuePriorityMode] = useState(resolveInitialValuePriorityMode);
    const valuePriorityMode = controlledValuePriorityMode === null || controlledValuePriorityMode === undefined
        ? internalValuePriorityMode
        : normalizeValuePriorityMode(controlledValuePriorityMode);
    const setValuePriorityMode = useCallback((nextValueOrUpdater) => {
        const currentMode = normalizeValuePriorityMode(valuePriorityMode);
        const nextValue = typeof nextValueOrUpdater === 'function'
            ? nextValueOrUpdater(currentMode)
            : nextValueOrUpdater;
        const nextMode = normalizeValuePriorityMode(nextValue);
        if (controlledValuePriorityMode === null || controlledValuePriorityMode === undefined) {
            setInternalValuePriorityMode(nextMode);
        }
        onValuePriorityModeChange?.(nextMode);
    }, [controlledValuePriorityMode, onValuePriorityModeChange, valuePriorityMode]);
    const [activeChapterGroup, setActiveChapterGroup] = useState(null);
    const [activeGangCode, setActiveGangCode] = useState(null);
    const [isChapterBarVisible, setChapterBarVisible] = useState(true);
    const [chapterViewportWindow, setChapterViewportWindow] = useState({ startRatio: 0, widthRatio: 1 });
    const [tableHorizontalState, setTableHorizontalState] = useState({
        scrollLeft: 0,
        maxScrollLeft: 0,
        ratio: 0,
        viewportRatio: 1,
        canScroll: false
    });
    const [tableContainerWidth, setTableContainerWidth] = useState(getInitialViewportWidth);
    const pendingSaveSummary = useMemo(() => {
        const manualValues = Object.values(editedCells);
        const manualCount = manualValues.length;
        const manualDeleteCount = manualValues.filter(isManualCellDeleteEdit).length;
        const kontanValues = Object.values(editedKontanCells);
        const kontanCount = kontanValues.length;
        const kontanDeleteCount = kontanValues.filter((item) => item.value === 0).length;
        const pendapatanValues = Object.values(editedPendapatanCells);
        const pendapatanCount = pendapatanValues.length;
        const pendapatanDeleteCount = pendapatanValues.filter((item) => item.value === 0).length;
        const addedColumnCount = addedColumns.filter((item) => !item.placeholder_saved).length;
        const deletedColumnCount = pendingDeletedColumns.length;
        return {
            manualCount,
            kontanCount,
            pendapatanCount,
            deleteCount: manualDeleteCount + kontanDeleteCount + pendapatanDeleteCount + deletedColumnCount,
            manualDeleteCount,
            addedColumnCount,
            deletedColumnCount,
            totalCount: manualCount + kontanCount + pendapatanCount + addedColumnCount + deletedColumnCount
        };
    }, [addedColumns, editedCells, editedKontanCells, editedPendapatanCells, pendingDeletedColumns.length]);
    const hasPendingEdits = pendingSaveSummary.totalCount > 0;

    const tableRef = useRef(null);
    const tableContainerRef = useRef(null);
    const chapterBarHideTimerRef = useRef(null);
    const isHorizontalSliderDraggingRef = useRef(false);
    const pauseAutoFocusUntilRef = useRef(0);
    const scrollSyncRafRef = useRef(0);

    // ================================================================
    // PROGRESSIVE STREAMING (SSE)
    // Replace the old fetch/process approach with SSE streaming
    // ================================================================
    const [streamEnabled, setStreamEnabled] = useState(true); // Always use streaming
    const effectiveGangPrefix = useMemo(
        () => resolveEffectiveGangPrefix(gangCode, gangPrefix, division),
        [division, gangCode, gangPrefix]
    );
    const canStartDataFlow = !!token && !!division && !!month && !!year && !currentPeriodLoading;

    // Use SSE streaming for progressive data delivery
    // CRITICAL FIX: Remove gangLoading from enabled condition to allow streaming to start immediately
    // gangLoading was preventing stream from starting on some computers/virtual divisions
    const stream = usePayrollStream({
        token,
        division,
        month,
        year,
        gangPrefix: effectiveGangPrefix,
        gangCode,
        useHistoryDb,
        valuePriorityMode,
        snapshotVersion,
        refreshTrigger,
        enabled: canStartDataFlow && streamEnabled
    });

    const triggerPayrollRefresh = useCallback(() => {
        if (typeof onRefresh === 'function') {
            onRefresh();
            return;
        }

        if (typeof stream.startStream === 'function') {
            void stream.startStream();
        }
    }, [onRefresh, stream.startStream]);

    const showPayrollToast = useCallback((type, title, message) => {
        setPayrollToast({ type, title, message });
        window.setTimeout(() => {
            setPayrollToast((current) => (current?.title === title && current?.message === message ? null : current));
        }, 4200);
    }, []);

    const closePayrollConfirm = useCallback(() => {
        setPayrollConfirm(null);
    }, []);

    const openPayrollConfirm = useCallback((config) => {
        setPayrollConfirm({
            variant: 'warning',
            confirmText: 'Lanjutkan',
            cancelText: 'Batal',
            ...config
        });
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(VALUE_PRIORITY_MODE_STORAGE_KEY, normalizeValuePriorityMode(valuePriorityMode));
        } catch {
            // Ignore localStorage write errors
        }
    }, [valuePriorityMode]);

    useEffect(() => {
        onValuePriorityModeResolved?.(normalizeValuePriorityMode(valuePriorityMode));
    }, [onValuePriorityModeResolved, valuePriorityMode]);

    // Sync stream grand total to component state
    useEffect(() => {
        if (stream.grandTotal) {
            setGrandTotal(stream.grandTotal);
        }
    }, [stream.grandTotal]);

    useEffect(() => {
        setResolvedSnapshotVersion(stream.meta?.snapshot_version ?? null);
    }, [stream.meta?.snapshot_version]);

    // Sync stream dynamic headers to component state
    useEffect(() => {
        if (stream.meta) {
            const dynPot = stream.meta.dynamic_potongan_headers || [];
            const dynPrem = stream.meta.dynamic_premi_headers || [];
            const potTitleMap = stream.meta.potongan_title_map || {};
            const premTitleMap = stream.meta.premi_title_map || {};

            const premWithTitles = {};
            dynPrem.forEach(field => {
                const title = premTitleMap[field] || field;
                premWithTitles[title] = field;
            });
            const potWithTitles = {};
            dynPot.forEach(field => {
                const title = potTitleMap[field] || field;
                potWithTitles[title] = field;
            });
            setDynamicHeaders({ premi: premWithTitles, potongan: potWithTitles });

            // Notify parent of data loaded
            onDataLoaded?.({
                dynamic_premi_headers: dynPrem,
                dynamic_potongan_headers: dynPot,
                premi_title_map: premTitleMap,
                potongan_title_map: potTitleMap,
                meta: {
                    snapshot_version: stream.meta.snapshot_version ?? null,
                    requested_snapshot_version: stream.meta.requested_snapshot_version ?? null,
                    available_snapshot_versions: stream.meta.available_snapshot_versions || [],
                    is_history_snapshot: stream.meta.is_history_snapshot ?? false
                }
            });
        }
    }, [stream.meta, onDataLoaded]);

    // Merge stream progress with existing loadingProgress for the loading bar
    const effectiveProgress = useMemo(() => {
        // If streaming is active and has progress, use stream progress
        if (stream.progress?.stage && stream.progress.stage !== null) {
            return {
                stage: stream.progress.stage, // Use actual stage: 'connecting', 'querying', 'streaming', 'complete', 'error'
                message: stream.progress.message || 'Memproses data...',
                totalGangs: stream.progress.totalGangs || 0,
                processedGangs: stream.progress.processedGangs || 0,
                totalEmployees: stream.progress.totalEmployees || 0,
                processedEmployees: stream.progress.processedEmployees || 0,
                bytesReceived: stream.progress.bytesReceived || 0,
                currentGang: stream.progress.currentGang || null
            };
        }
        return loadingProgress;
    }, [stream.progress, loadingProgress]);

    // Determine if we should show the table (even if streaming is still in progress)
    const shouldShowTable = useMemo(() => {
        // Show table if we have any stream data
        if (stream.gangs && stream.gangs.length > 0) return true;
        // Show table if we have rows from legacy fetch
        if (rows.length > 0 && dataReady) return true;
        // Don't show table if still in early loading phase with no data
        return false;
    }, [stream.gangs, rows, dataReady]);

    const streamRows = useMemo(() => {
        if (!stream.gangs || stream.gangs.length === 0) {
            return [];
        }

        const processedRows = [];
        let globalNo = 1;

        stream.gangs.forEach(gangData => {
            // Guard against malformed data
            if (!gangData || typeof gangData !== 'object') {
                console.warn('[CustomPayrollTable] Skipping invalid gangData:', gangData);
                return;
            }

            const gCode = gangData.gang_code;
            const employees = sortEmployeesByEmpCode(gangData.employees);

            // Add gang header
            processedRows.push({ type: 'gang_header', gang_code: gCode, id: `HEADER_${gCode}` });

            // Add employees with numbering
            employees.forEach(emp => {
                if (!emp) return;
                const employeeNo = globalNo++;
                processedRows.push({
                    ...emp,
                    no: employeeNo,
                    type: 'employee',
                    id: emp.new_nik || emp.nik || `EMP_${employeeNo}`
                });
            });

            // Add gang total
            const gangTotal = gangData.gang_totals || {};
            gangTotal.type = 'gang_total';
            gangTotal.id = `TOTAL_${gCode}`;
            gangTotal.gang_code = gCode;
            gangTotal.nama = `TOTAL GANG ${gCode}`;
            gangTotal.emp_code = `${employees.length} Kary.`;
            processedRows.push(gangTotal);
        });

        return processedRows;
    }, [stream.gangs]);

    // Determine active dynamic fields from streamed rows
    // Use meta headers as source of truth, not employee data values
    // This ensures columns appear even when values are 0/null
    const streamActiveFields = useMemo(() => {
        // Primary source: meta headers from backend
        const dynPot = stream.meta?.dynamic_potongan_headers || [];
        const dynPrem = stream.meta?.dynamic_premi_headers || [];
        const defaults = {
            activePremi: [...new Set(dynPrem)],
            activePot: [...new Set(dynPot)],
            activePendapatan: []
        };

        if (!stream.isComplete) {
            return defaults;
        }

        const employeeRows = streamRows.filter(r => r.type === 'employee');
        if (employeeRows.length === 0) return defaults;

        // Also extract from employee data and metadata to catch any fields backend missed.
        const allFieldKeys = new Set();
        const addDynamicFieldKey = (key) => {
            const normalizedKey = normalizeFieldKey(key);
            if (!normalizedKey) return;
            if (isPremiFieldKey(normalizedKey) || isDynamicPotonganFieldKey(normalizedKey)) {
                allFieldKeys.add(normalizedKey);
            }
        };

        employeeRows.forEach(row => {
            Object.keys(row).forEach(key => {
                addDynamicFieldKey(key);
            });

            Object.keys(row?.manual_adjustment_metadata || {}).forEach(addDynamicFieldKey);
        });

        // Merge both sources - prefer meta headers, add any extras from data
        const activePremi = [...new Set([
            ...dynPrem,
            ...Array.from(allFieldKeys).filter((key) => isPremiFieldKey(key))
        ])];

        const activePot = [...new Set([
            ...dynPot,
            ...Array.from(allFieldKeys).filter((key) => isDynamicPotonganFieldKey(key))
        ])];

        const excludedPendapatan = ['pendapatan_tidak_tetap', 'pendapatan_lainnya'];
        const allPendapatanKeys = new Set();
        employeeRows.forEach(row => {
            Object.keys(row).forEach(key => {
                if (key.startsWith('pendapatan_') && !excludedPendapatan.includes(key)) {
                    allPendapatanKeys.add(key);
                }
            });
        });

        return {
            activePremi,
            activePot,
            activePendapatan: Array.from(allPendapatanKeys).sort()
        };
    }, [streamRows, stream.meta, stream.isComplete]);

    const metadataDynamicHeaders = useMemo(() => {
        const result = { premi: {}, potongan: {} };
        const registeredByType = {
            premi: new Set(),
            potongan: new Set()
        };
        const register = (type, label, field) => {
            const normalizedField = normalizeFieldKey(field);
            if (!normalizedField || registeredByType[type].has(normalizedField)) return;
            registeredByType[type].add(normalizedField);
            result[type][label] = normalizedField;
        };

        streamRows
            .filter(row => row?.type === 'employee')
            .forEach(row => {
                const metadataByField = row?.manual_adjustment_metadata || {};
                for (const [field, rawMetadata] of Object.entries(metadataByField)) {
                    const normalizedField = normalizeFieldKey(field);
                    if (!normalizedField) continue;

                    const parsedMetadata = parseMetadataObjectValue(rawMetadata);
                    const metadataAdjustmentType = String(parsedMetadata?.adjustment_type || '').trim().toUpperCase();
                    if (metadataAdjustmentType === 'PREMI' || (!metadataAdjustmentType && isPremiFieldKey(normalizedField))) {
                        register(
                            'premi',
                            String(parsedMetadata?.adjustment_name || formatFallbackPremiLabel(normalizedField)).trim().toUpperCase(),
                            normalizedField
                        );
                        continue;
                    }

                    if (metadataAdjustmentType === 'POTONGAN_KOTOR' || metadataAdjustmentType === 'POTONGAN_BERSIH' || isDynamicPotonganFieldKey(normalizedField)) {
                        register(
                            'potongan',
                            String(parsedMetadata?.adjustment_name || formatFallbackPotonganLabel(normalizedField)).trim().toUpperCase(),
                            normalizedField
                        );
                    }
                }
            });

        return result;
    }, [streamRows]);

    const effectiveDynamicHeaders = useMemo(() => {
        const buildTitleMap = (fields = [], titleMap = {}) => {
            const result = {};
            fields.forEach((field) => {
                result[titleMap[field] || field] = field;
            });
            return result;
        };
        const mergeHeaderMap = (target, source = {}, shouldSkip = () => false) => {
            const registeredFields = new Set(Object.values(target).map((field) => normalizeFieldKey(field)));
            for (const [label, field] of Object.entries(source || {})) {
                const normalizedField = normalizeFieldKey(field);
                if (!normalizedField || registeredFields.has(normalizedField) || shouldSkip(label, normalizedField)) continue;
                registeredFields.add(normalizedField);
                target[label] = normalizedField;
            }
        };
        const skipStaticPremiHeader = (label, field) => isStaticPremiFieldKey(field) || isStaticBrondolHeader(label, field);
        const skipStaticPotonganHeader = (label, field) => isStaticPotonganFieldKey(field) || isAutomaticPayrollKoreksiFieldKey(field) || isSpsiLabel(label);

        const result = { premi: {}, potongan: {} };
        mergeHeaderMap(result.premi, buildTitleMap(stream.meta?.dynamic_premi_headers || [], stream.meta?.premi_title_map || {}), skipStaticPremiHeader);
        mergeHeaderMap(result.potongan, buildTitleMap(stream.meta?.dynamic_potongan_headers || [], stream.meta?.potongan_title_map || {}), skipStaticPotonganHeader);
        mergeHeaderMap(result.premi, dynamicHeaders.premi, skipStaticPremiHeader);
        mergeHeaderMap(result.potongan, dynamicHeaders.potongan, skipStaticPotonganHeader);
        mergeHeaderMap(result.premi, metadataDynamicHeaders.premi, skipStaticPremiHeader);
        mergeHeaderMap(result.potongan, metadataDynamicHeaders.potongan, skipStaticPotonganHeader);

        for (const field of streamActiveFields.activePremi || []) {
            mergeHeaderMap(result.premi, { [formatFallbackPremiLabel(field)]: field }, skipStaticPremiHeader);
        }

        for (const field of streamActiveFields.activePot || []) {
            mergeHeaderMap(result.potongan, { [formatFallbackPotonganLabel(field)]: field }, skipStaticPotonganHeader);
        }

        return result;
    }, [dynamicHeaders, metadataDynamicHeaders, stream.meta, streamActiveFields]);

    const effectiveActivePremiFields = activePremiFields.length > 0 ? activePremiFields : streamActiveFields.activePremi;
    const effectiveActivePotFields = activePotFields.length > 0 ? activePotFields : streamActiveFields.activePot;
    const effectiveActivePendapatanFields = activePendapatanFields.length > 0 ? activePendapatanFields : streamActiveFields.activePendapatan;

    // Update active field states when stream data changes
    useEffect(() => {
        if (streamRows.length > 0) {
            setActivePremiFields(streamActiveFields.activePremi);
            setActivePotFields(streamActiveFields.activePot);
            setActivePendapatanFields(streamActiveFields.activePendapatan);
            setSelection([]);
            setDataReady(true);
            return;
        }

        // When stream resolves with no rows, mark as ready so empty-state can render.
        // Without this, the UI can keep showing stale rows from the previous period.
        if (stream.isComplete) {
            setActivePremiFields(prev => (prev.length > 0 ? [] : prev));
            setActivePotFields(prev => (prev.length > 0 ? [] : prev));
            setActivePendapatanFields(prev => (prev.length > 0 ? [] : prev));
            setSelection(prev => (prev.length > 0 ? [] : prev));
            setDataReady(true);
        }
    }, [streamRows, streamActiveFields, stream.isComplete]);

    // Fallback: if stream errors and we have no data, fall back to old fetch
    useEffect(() => {
        if (stream.error && !stream.gangs?.length && streamEnabled) {
            console.warn('[CustomPayrollTable] Stream failed, falling back to legacy fetch');
            setStreamEnabled(false);
            setError(null); // Clear stream error
        }
    }, [stream.error, stream.gangs, streamEnabled]);

    // Update rows when streaming or legacy fetch is active
    useEffect(() => {
        const runtimePolicy = resolvePayrollClientRuntimePolicy({
            dataReady: true,
            hasRows: streamRows.length > 0,
            usesStream: Boolean(stream.gangs?.length),
            streamComplete: stream.isComplete,
            hasPendingEdits,
            employeeCount: streamRows.length
        });

        if (!runtimePolicy.shouldMirrorStreamRows) {
            // Critical: if stream completed but returned no gangs, clear stale rows
            // from previous scope (e.g. month changed to period with no seeded data).
            if (!hasPendingEdits && stream.isComplete && streamRows.length === 0) {
                if (rows.length > 0) {
                    setRows([]);
                }
                setGrandTotal(null);
            }
            return;
        }

        // Always mirror the latest streamed payload once policy allows it.
        // Period changes can keep row identities stable while numeric values change.
        setRows(streamRows);
    }, [hasPendingEdits, rows, stream.gangs, stream.isComplete, streamRows]);

    // Use displayRows as the single source of truth for rendering
    // It merges stream data with edit overlays when needed
    // STRATEGI: Sorting employees WITHIN each gang, bukan global
    // Ini menjaga struktur: header gang → employees (sorted) → total gang
    const displayRows = useMemo(() => {
        let resultRows;

        if (stream.gangs && stream.gangs.length > 0) {
            const baseRows = streamRows;
            if (Object.keys(editedCells).length > 0 || Object.keys(editedKontanCells).length > 0) {
                const editedCellsByEmployee = new Map();
                Object.values(editedCells).forEach((item) => {
                    const empCode = item?.emp_code || item?.nik;
                    if (!empCode) return;
                    const existing = editedCellsByEmployee.get(empCode);
                    if (existing) {
                        existing.push(item);
                    } else {
                        editedCellsByEmployee.set(empCode, [item]);
                    }
                });

                resultRows = baseRows.map(row => {
                    if (row.type !== 'employee') return row;
                    const empCode = row.emp_code || row.nik;
                    const employeeEdits = editedCellsByEmployee.get(empCode) || [];
                    const kontanEdit = editedKontanCells[`${empCode}-pendapatan_kontan`];
                    if (employeeEdits.length === 0 && !kontanEdit) return row;

                    const merged = { ...row };
                    for (const edit of employeeEdits) {
                        if (!edit?.field) continue;
                        merged[edit.field] = edit.value;
                    }

                    if (kontanEdit) {
                        merged.pendapatan_kontan = toFiniteNumber(kontanEdit.value);
                    }

                    // Apply pendapatan (bonus/thr) edits
                    Object.entries(editedPendapatanCells).forEach(([key, edit]) => {
                        if (key.startsWith(`${empCode}-`)) {
                            const field = edit.field;
                            if (field) {
                                merged[field] = toFiniteNumber(edit.value);
                            }
                        }
                    });

                    return {
                        ...merged
                    };
                });
            } else {
                resultRows = baseRows;
            }
        } else {
            resultRows = rows;
        }

        resultRows = resultRows.map(normalizeGrossDeductionForDisplay);
        resultRows = PayrollAggregator.buildDisplayLedgerRows(resultRows, hasPendingEdits ? null : grandTotal, {
            allocateToGrandTotal: !hasPendingEdits
        });

        // Cek apakah streaming masih berjalan
        const isStreaming = !stream.isComplete || (stream.progress && stream.progress.stage !== 'complete');
        
        // Jika masih streaming ATAU tidak ada sorting, return as-is
        if (isStreaming || !sortBy) {
            return resultRows;
        }

        // Setelah streaming selesai DAN ada sorting aktif:
        // Sort employees WITHIN each gang group
        // Struktur data: [{type: 'header'}, {type: 'employee'} x N, {type: 'total'}, ...]
        // Kita perlu sort employees di antara header dan total untuk setiap gang
        
        const sortedRows = [];
        let currentGangEmployees = [];
        const direction = sortOrder === 'asc' ? 1 : -1;
        const flushEmployeeRows = () => {
            if (currentGangEmployees.length === 0) return;
            currentGangEmployees.sort((a, b) => direction * comparePayrollEmployeeRows(a, b, sortBy));
            sortedRows.push(...currentGangEmployees);
            currentGangEmployees = [];
        };

        for (let i = 0; i < resultRows.length; i++) {
            const row = resultRows[i];
            
            if (row.type === 'employee') {
                // Kumpulkan semua employees
                currentGangEmployees.push(row);
            } else {
                // Bukan employee row (header/total/separator)
                // Jika sebelumnya ada employee section, sort dan masukkan
                flushEmployeeRows();
                sortedRows.push(row);
            }
        }

        // Jika ada employee section tersisa di akhir
        flushEmployeeRows();

        return sortedRows;
    }, [stream.gangs, streamRows, rows, editedCells, editedKontanCells, hasPendingEdits, grandTotal, stream.isComplete, stream.progress, sortBy, sortOrder]);

    const employeeRows = useMemo(
        () => displayRows.filter(row => row.type === 'employee'),
        [displayRows]
    );

    /**
     * OPTIMIZATION: Cache displayed data in localStorage for instant retrieval in Print Page
     * This allows the Print Page to skip the expensive batch-checkroll API call.
     */
    useEffect(() => {
        const runtimePolicy = resolvePayrollClientRuntimePolicy({
            dataReady,
            hasRows: displayRows.length > 0,
            usesStream: Boolean(stream.gangs?.length),
            streamComplete: stream.isComplete,
            hasPendingEdits,
            employeeCount: employeeRows.length
        });
        if (!runtimePolicy.shouldPersistCache) return;

        // Extract only employee rows (ignore headers/totals)
        const employeeDataMap = {};
        employeeRows.forEach(row => {
            const key = (row.emp_code || row.nik || '').toUpperCase();
            if (key) {
                employeeDataMap[key] = row;
            }
        });

        if (Object.keys(employeeDataMap).length > 0) {
            const storageKey = buildPayrollSnapshotCacheKey({
                division,
                month,
                year,
                useHistory: useHistoryDb,
                snapshotVersion: normalizeSnapshotVersion(snapshotVersion) ?? resolvedSnapshotVersion
            });
            try {
                localStorage.setItem(storageKey, JSON.stringify({
                    data: employeeDataMap,
                    timestamp: Date.now()
                }));
            } catch (e) {
                console.warn('[CustomPayrollTable] Failed to save payroll cache to localStorage (possibly quota exceeded)');
            }
        }
    }, [dataReady, displayRows.length, division, employeeRows, hasPendingEdits, month, resolvedSnapshotVersion, snapshotVersion, stream.gangs, stream.isComplete, useHistoryDb, year]);

    // Toggle handlers
    const toggleGroup = useCallback((group) => {
        const canonicalGroup = normalizePayrollHeaderGroup(group) || group;
        if (canonicalGroup === PAJAK) setIsTaxExpanded(prev => !prev);
    }, []);

    const getGroupExpandedState = useCallback((group) => {
        const canonicalGroup = normalizePayrollHeaderGroup(group);
        if (canonicalGroup === PAJAK) return isTaxExpanded;
        return null;
    }, [isTaxExpanded]);

    // Load preferences on mount
    useEffect(() => {
        const prefs = getTablePreferences();
        if (prefs.preferences?.cellColors) {
            setCellColors(prefs.preferences.cellColors);
        }
    }, []);

    // Sync employee codes when displayRows change (for select-all checkbox state only)
    useEffect(() => {
        if (stream.gangs?.length && !stream.isComplete) return;

        const empCodeList = employeeRows
            .map(r => r.emp_code || r.nik)
            .filter(code => code);
        setAllEmployeeNiks(empCodeList);
        // NOTE: Don't call onSelectAllEmployees here - let user manually select employees
    }, [employeeRows, stream.gangs, stream.isComplete]);

    // Expose displayRows data to parent via callback
    useEffect(() => {
        const runtimePolicy = resolvePayrollClientRuntimePolicy({
            dataReady,
            hasRows: displayRows.length > 0,
            usesStream: Boolean(stream.gangs?.length),
            streamComplete: stream.isComplete,
            hasPendingEdits,
            employeeCount: employeeRows.length
        });

        if (onDataReady && runtimePolicy.shouldPublishToParent && employeeRows.length > 0) {
            onDataReady(employeeRows);
        }
    }, [dataReady, displayRows.length, employeeRows, hasPendingEdits, onDataReady, stream.gangs, stream.isComplete]);

    // Handle checkbox toggle
    const handleCheckboxChange = (nik) => {
        onToggleEmployeeSelection?.(nik);
    };

    // Handle select all checkbox
    const handleSelectAll = (e) => {
        if (!onSelectAllEmployees) return;
        if (e.target.checked) {
            // Select all employees
            onSelectAllEmployees(allEmployeeNiks);
        } else {
            // Deselect all - pass empty array directly instead of toggling each one
            onSelectAllEmployees([]);
        }
    };

    useEffect(() => {
        axios.get('tunjangan/rates?category=JABATAN')
            .then(res => {
                if (res.data.success) setTunjanganRates(res.data.data);
            })
            .catch(console.error);
    }, []);

    const refreshPremiumDefinitions = useCallback(async () => {
        if (!token) {
            setPremiumDefinitions([]);
            return [];
        }
        try {
            const result = await fetchPremiumDefinitions(token);
            const defs = Array.isArray(result) ? result : result?.data || [];
            setPremiumDefinitions(defs);
            return defs;
        } catch {
            setPremiumDefinitions([]);
            return [];
        }
    }, [token]);

    // Build list of premium columns eligible for type conversion (for ConvertPremiumTypeModal "from" dropdown)
    const convertiblePremiumColumns = useMemo(() => {
        const seen = new Set();
        const cols = [];
        const push = (name) => {
            const n = String(name || '').trim();
            if (!n || seen.has(n)) return;
            seen.add(n);
            cols.push({ name: n, type: 'PREMI' });
        };
        (addedColumns || []).forEach((c) => { if (String(c?.type || '').toUpperCase() === 'PREMI') push(c.name); });
        Object.entries(dynamicHeaders?.premi || {}).forEach(([name]) => push(name));
        return cols;
    }, [addedColumns, dynamicHeaders]);

    const handlePremiumTypeConverted = useCallback(async (result) => {
        const converted = Number(result?.converted_count || 0);
        const skipped = Number(result?.skipped_collision_count || 0);
        const fromName = convertTypeModal.fromName;
        // Clear local edit state for the old column field (field key derived from old name)
        setAddedColumns(prev => prev.filter((c) => String(c?.name || '').toUpperCase() !== String(fromName || '').toUpperCase()));
        setEditedCells(prev => {
            const next = {};
            for (const [key] of Object.entries(prev)) {
                if (!key.endsWith(`-${fromName}`)) next[key] = prev[key];
            }
            return next;
        });
        await refreshPremiumDefinitions();
        triggerPayrollRefresh();
        showPayrollToast(
            converted > 0 ? 'success' : 'info',
            'Konversi premi',
            `${converted} baris dikonversi${skipped ? `, ${skipped} dilewati (collision)` : ''}.`
        );
    }, [convertTypeModal.fromName, refreshPremiumDefinitions, triggerPayrollRefresh]);

    // Load premium definitions for popup usage, and refresh when edit tools are opened.
    useEffect(() => {
        refreshPremiumDefinitions();
    }, [refreshPremiumDefinitions, isEditMode, manualAdjustmentModal.isOpen]);

    const handleAddColumn = (groupLabel) => {
        setManualAdjustmentModal({
            isOpen: true,
            groupLabel,
            adjustmentType: ADJUSTMENT_TYPE_BY_GROUP_LABEL[groupLabel] || 'PREMI'
        });
    };

    const persistManualColumnPlaceholder = async (column) => {
        const payload = buildManualColumnPlaceholderPayload({
            month,
            year,
            division,
            column
        });

        if (!payload) {
            throw new Error('Kolom belum bisa disimpan karena identitas karyawan/gang aktif tidak tersedia.');
        }

        const response = isProdMode()
            ? await saveLockedManualEdit(token, payload)
            : await saveManualAdjustment(token, payload);

        if (!response?.success) {
            throw new Error(response?.error || 'Gagal menyimpan placeholder kolom manual adjustment');
        }

        return response;
    };

    const handleManualAdjustmentSaved = async (columnDefinition) => {
        const groupLabelByType = {
            PREMI,
            POTONGAN_KOTOR: POTONGAN_UPAH_KOTOR,
            POTONGAN_BERSIH: POTONGAN_UPAH_BERSIH
        };
        const effectiveGroupLabel = groupLabelByType[columnDefinition.adjustment_type] || manualAdjustmentModal.groupLabel;
        const pendingColumn = buildPendingManualColumn({
            groupLabel: effectiveGroupLabel,
            rawName: columnDefinition.adjustment_name,
            division,
            firstEmployee: employeeRows[0]
        });

        if (!pendingColumn) return;

        const nextColumn = {
            ...pendingColumn.payload,
            field: pendingColumn.fieldName,
            ad_code: columnDefinition.ad_code,
            task_code: columnDefinition.task_code,
            base_task_code: columnDefinition.base_task_code,
            task_desc: columnDefinition.task_desc,
            loc_code: columnDefinition.loc_code,
            input_type: columnDefinition.input_type,
            remarks: columnDefinition.remarks,
            placeholder_saved: false
        };

        setDynamicHeaders(prev => ({
            ...prev,
            [pendingColumn.activeFieldBucket]: {
                ...prev[pendingColumn.activeFieldBucket],
                [pendingColumn.adjustmentName]: pendingColumn.fieldName
            }
        }));

        if (pendingColumn.activeFieldBucket === 'premi') {
            setActivePremiFields(prev => [...new Set([...prev, pendingColumn.fieldName])]);
        } else {
            setActivePotFields(prev => [...new Set([...prev, pendingColumn.fieldName])]);
        }

        setAddedColumns(prev => {
            const exists = prev.some((item) => item.field === nextColumn.field && item.type === nextColumn.type);
            return exists ? prev : [...prev, nextColumn];
        });

        refreshPremiumDefinitions();
        showPayrollToast('info', 'Kolom ditambahkan', `Kolom ${pendingColumn.adjustmentName} akan disimpan saat tombol Simpan Perubahan ditekan.`);
    };

    const removeColumnFromScreen = (field) => {
        setAddedColumns(prev => prev.filter((item) => item.field !== field));
        setActivePremiFields(prev => prev.filter((item) => item !== field));
        setActivePotFields(prev => prev.filter((item) => item !== field));
        setDynamicHeaders(prev => ({
            premi: Object.fromEntries(Object.entries(prev.premi || {}).filter(([, value]) => value !== field)),
            potongan: Object.fromEntries(Object.entries(prev.potongan || {}).filter(([, value]) => value !== field))
        }));
        setEditedCells(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.endsWith(`-${field}`))));
        setRows(prev => prev.map((row) => {
            if (!row || !(field in row)) return row;
            const { [field]: _removed, ...rest } = row;
            return rest;
        }));
    };

    const resolveManualColumnDefinition = (field) => {
        const addedColumn = addedColumns.find((item) => item.field === field);
        if (addedColumn) return addedColumn;

        for (const [name, mappedField] of Object.entries(dynamicHeaders.premi || {})) {
            if (mappedField === field) return { field, name, type: 'PREMI' };
        }
        for (const [name, mappedField] of Object.entries(dynamicHeaders.potongan || {})) {
            if (mappedField !== field) continue;
            const normalized = normalizeFieldKey(field);
            const type = normalized.startsWith('koreksi') || String(name || '').toUpperCase().startsWith('KOREKSI')
                ? 'POTONGAN_KOTOR'
                : 'POTONGAN_BERSIH';
            return { field, name, type };
        }
        return null;
    };

    const handleRemoveManualColumn = (field) => {
        const targetColumn = resolveManualColumnDefinition(field);
        if (!targetColumn) return;

        const isUnsaved = addedColumns.some((item) => item.field === field && !item.placeholder_saved);
        openPayrollConfirm({
            variant: 'danger',
            title: isUnsaved ? 'Hapus kolom tambahan?' : 'Antrekan hapus kolom manual adjustment?',
            message: isUnsaved
                ? `Kolom ${targetColumn.name || field} dan semua nilai edit yang belum disimpan pada kolom ini akan dihapus dari layar.`
                : `Kolom ${targetColumn.name || field} akan masuk daftar perubahan dan baru dihapus dari database saat tombol Simpan Perubahan ditekan.`,
            confirmText: isUnsaved ? 'Hapus Kolom' : 'Masukkan ke Perubahan',
            onConfirm: async () => {
                if (!isUnsaved) {
                    const deletion = {
                        field,
                        name: targetColumn.name,
                        type: targetColumn.type,
                        params: {
                            period_month: month,
                            period_year: year,
                            division_code: division,
                            adjustment_type: targetColumn.type,
                            adjustment_name: targetColumn.name
                        }
                    };
                    setPendingDeletedColumns(prev => prev.some((item) => item.field === field) ? prev : [...prev, deletion]);
                }
                removeColumnFromScreen(field);
                showPayrollToast('info', 'Kolom dihapus dari layar', `Kolom ${targetColumn.name || field} ${isUnsaved ? 'dibatalkan dari perubahan' : 'akan dihapus saat tombol Simpan Perubahan ditekan'}.`);
            }
        });
    };

    // Handle Manual Cell Edit
    const handleCellEdit = (row, field, value, originalValue, type, name) => {
        const empCode = row.emp_code || row.nik;
        const key = `${empCode}-${field}`;
        const numValue = parsePayrollInputNumber(value);

        if (numValue === null) return;

        setEditedCells(prev => {
            const existingEdit = prev[key];
            const persistedOriginal = resolvePersistentOriginalNumber(existingEdit?.originalValue, originalValue);
            const addedColumn = addedColumns.find((item) => item.field === field && item.type === type);
            return {
                ...prev,
                [key]: {
                    emp_code: empCode,
                    nik: row.nik,
                    emp_name: row.nama || row.emp_name || null,
                    field,
                    value: numValue,
                    originalValue: persistedOriginal,
                    gang_code: row.gang_code,
                    type,
                    name,
                    ad_code: addedColumn?.ad_code,
                    task_code: addedColumn?.task_code,
                    base_task_code: addedColumn?.base_task_code,
                    task_desc: addedColumn?.task_desc,
                    input_type: addedColumn?.input_type,
                    remarks: addedColumn?.remarks
                }
            };
        });

        // Pending edits are applied through displayRows overlay; avoid rewriting
        // the full row set for every committed input value.
    };

    const deriveLegacyPremiumMetadata = ({ amount, inputType, row, adjustmentName }) => {
        const totalAmount = Number(amount || 0);
        if (!inputType || inputType === 'amount' || totalAmount === 0) return null;

        const base = {
            input_type: inputType,
            total_amount: totalAmount,
            adjustment_name: adjustmentName,
            legacy_source: true
        };

        if (inputType === 'blok') {
            return {
                ...base,
                items: [{ subblok: '', gang_code: row?.gang_code || '', jumlah: totalAmount }]
            };
        }

        if (inputType === 'exp') {
            return {
                ...base,
                expense_code: '',
                jumlah: totalAmount
            };
        }

        if (inputType === 'kendaraan') {
            return {
                ...base,
                items: [{ nomor_kendaraan: '', expense_code: '', jumlah: totalAmount }]
            };
        }

        if (inputType === 'blok,exp') {
            return {
                ...base,
                blok_items: [{ subblok: '', gang_code: row?.gang_code || '', jumlah: totalAmount }],
                expense: { expense_code: '', jumlah: 0 }
            };
        }

        return null;
    };

    const parsePremiumMetadataValue = (value) => {
        return parseMetadataObjectValue(value);
    };

    const getManualCellDisplayAmount = ({ row, field, edit, fallbackAmount = 0 }) => {
        if (edit?.value !== undefined) return Number(edit.value) || 0;
        const rowAmount = Number(row?.[field] ?? fallbackAmount) || 0;
        if (rowAmount !== 0) return rowAmount;
        const storedMetadata = parseMetadataObjectValue(row?.manual_adjustment_metadata?.[field]);
        if (storedMetadata?.amount !== undefined) return Number(storedMetadata.amount) || 0;
        if (storedMetadata?.total_amount !== undefined) return Number(storedMetadata.total_amount) || 0;
        return rowAmount;
    };

    const hasManualCellData = ({ row, field, edit, displayAmount }) => {
        if (edit) return true;
        if (parseMetadataObjectValue(row?.manual_adjustment_metadata?.[field])) return true;
        return Number(displayAmount || 0) !== 0;
    };

    const getManualCellTriggerStyle = ({ hasData, hasDbMetadata, hasFallbackMetadata, mismatch, detailValidation, incomplete, pendingDelete, disabled }) => {
        const hasDetailIssue = pendingDelete || mismatch || incomplete || (detailValidation && !detailValidation.isComplete);
        return ({
            border: hasDetailIssue ? '1px solid #ef4444' : '1px solid #cbd5e1',
            background: hasDetailIssue ? '#fee2e2' : hasDbMetadata ? '#dcfce7' : hasFallbackMetadata ? '#fef3c7' : '#f8fafc',
            borderRadius: 6,
            padding: '3px 7px',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: 11,
            color: hasDetailIssue ? '#b91c1c' : hasDbMetadata ? '#16a34a' : hasFallbackMetadata ? '#b45309' : '#475569',
            fontWeight: 800,
            lineHeight: 1.1,
            minWidth: hasData ? 58 : 46,
            textAlign: 'center',
            opacity: disabled ? 0.9 : 1
        });
    };

    const renderManualCellTrigger = ({ label, hasData, displayAmount, hasDbMetadata, hasFallbackMetadata, mismatch, detailValidation, incomplete, pendingDelete, disabled, onClick }) => (
        <button
            type="button"
            disabled={disabled}
            title={pendingDelete
                ? 'Nilai cell akan dihapus saat Simpan Perubahan.'
                : buildManualDetailIssueReason({
                    mismatch,
                    validation: detailValidation || (incomplete ? { isComplete: false, reasons: ['Isi field wajib sesuai input type.'] } : null)
                }) || (hasData ? 'Edit input manual adjustment' : 'Input manual adjustment')}
            onClick={(event) => {
                event.stopPropagation();
                if (disabled) return;
                onClick?.();
            }}
            style={getManualCellTriggerStyle({ hasData, hasDbMetadata, hasFallbackMetadata, mismatch, detailValidation, incomplete, pendingDelete, disabled })}
        >
            {label || (hasData ? formatNumber(displayAmount) : 'Input')}
        </button>
    );

    const renderManualCellDeleteAction = ({ hasData, pendingDelete, onDelete, onCancelDelete }) => {
        if (!hasData && !pendingDelete) return null;
        return (
            <button
                type="button"
                title={pendingDelete ? 'Batalkan hapus nilai cell' : 'Hapus nilai cell manual adjustment'}
                onClick={(event) => {
                    event.stopPropagation();
                    if (pendingDelete) {
                        onCancelDelete?.();
                    } else {
                        onDelete?.();
                    }
                }}
                style={{
                    border: pendingDelete ? '1px solid #fca5a5' : '1px solid #fecaca',
                    background: pendingDelete ? '#fee2e2' : '#fff',
                    color: '#b91c1c',
                    borderRadius: 6,
                    padding: '3px 6px',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 800,
                    lineHeight: 1.1
                }}
            >
                {pendingDelete ? 'Batal' : 'Hapus'}
            </button>
        );
    };

    const markManualCellForDelete = ({ editKey, edit, editBase, displayAmount, name }) => {
        const source = edit || editBase;
        if (!editKey || !source) return;

        setEditedCells(prev => {
            const existingEdit = prev[editKey] || edit;
            const baseEdit = existingEdit || source;
            const backupEdit = existingEdit && !isManualCellDeleteEdit(existingEdit)
                ? existingEdit
                : baseEdit.delete_backup_edit;
            return {
                ...prev,
                [editKey]: {
                    ...baseEdit,
                    value: 0,
                    originalValue: resolvePersistentOriginalNumber(baseEdit.originalValue, displayAmount),
                    metadata_json: undefined,
                    delete_cell: true,
                    delete_backup_edit: backupEdit,
                    remarks: buildManualCellDeleteRemarks(baseEdit.name || name)
                }
            };
        });
        showPayrollToast('info', 'Nilai cell masuk daftar hapus', `${name || 'Manual adjustment'} akan dihapus saat Simpan Perubahan ditekan.`);
    };

    const cancelManualCellDelete = ({ editKey, name }) => {
        if (!editKey) return;
        setEditedCells(prev => {
            const current = prev[editKey];
            if (!isManualCellDeleteEdit(current)) return prev;
            const next = { ...prev };
            if (current.delete_backup_edit) {
                next[editKey] = current.delete_backup_edit;
            } else {
                delete next[editKey];
            }
            return next;
        });
        showPayrollToast('info', 'Hapus cell dibatalkan', `${name || 'Manual adjustment'} dikembalikan ke nilai sebelumnya.`);
    };

    const resolvePremiumPopupInitialData = ({ edit, amount, inputType, row, field, adjustmentName }) => {
        if (edit?.metadata_json) return edit.metadata_json;
        const storedMetadata = row?.manual_adjustment_metadata?.[field];
        if (storedMetadata) {
            return typeof storedMetadata === 'string' ? storedMetadata : JSON.stringify(storedMetadata);
        }
        const derived = deriveLegacyPremiumMetadata({ amount, inputType, row, adjustmentName });
        return derived ? JSON.stringify(derived) : null;
    };

    const handlePremiumPopupSave = (metadataJson, amountToSave) => {
        const { editKey, editBase } = premiumPopup;
        if (!editKey) return;
        setEditedCells(prev => {
            const nextEdit = buildPremiumDetailEdit({
                existingEdit: prev[editKey],
                editBase,
                metadataJson,
                amountToSave
            });
            if (!nextEdit) return prev;
            return {
                ...prev,
                [editKey]: nextEdit
            };
        });
        setPremiumPopup(emptyPremiumPopup);
    };

    const handleProfileEdit = (row, field, value) => {
        const empCode = row.emp_code || row.nik;
        const key = `${empCode}-${field}`;
        const nextValue = field === 'is_spsi_member' ? !!value : value;

        setEditedCells(prev => ({
            ...prev,
            [key]: {
                emp_code: empCode,
                nik: row.nik,
                emp_name: row.nama || row.emp_name || null,
                field,
                value: nextValue,
                originalValue: row[field] ?? null,
                gang_code: row.gang_code,
                employee_status: row.employee_status || row.hr_emp_type || null,
                type: 'PROFILE_OVERRIDE',
                name: field
            }
        }));

        setRows(prevRows => prevRows.map(currentRow => {
            if ((currentRow.emp_code || currentRow.nik) === empCode) {
                return { ...currentRow, [field]: nextValue };
            }
            return currentRow;
        }));
    };

    // Handle PTKP Master Tax Edit (string-based, not numeric)
    const handlePtkpEdit = (row, newPtkpStatus) => {
        const empCode = row.emp_code || row.nik;
        const key = `${empCode}-status_ptkp`;
        const originalValue = row.status_ptkp;

        if (newPtkpStatus === originalValue) return;

        // [GATE] PTKP master hanya boleh diubah untuk gang percobaan
        // (desc mengandung "PERCOBAAN", code berakhiran P, atau code mengandung BHL).
        if (!isPercobaanGang(row.gang_code, row.gang_desc)) {
            showPayrollToast('error', 'PTKP Terkunci',
                `PTKP master hanya bisa diubah untuk gang percobaan (PERCOBAAN / berakhiran P / BHL). Gang: ${row.gang_code || 'unknown'} - ${row.gang_desc || 'unknown'}`);
            return;
        }

        // Determine new TER category based on PTKP
        const newTer = (['TK/0', 'TK/1', 'K/0'].includes(newPtkpStatus)) ? 'TER A'
            : (newPtkpStatus === 'K/3') ? 'TER C' : 'TER B';

        setEditedCells(prev => ({
            ...prev,
            [key]: {
                nik: empCode,
                field: 'status_ptkp',
                value: newPtkpStatus,
                originalValue,
                gang_code: row.gang_code,
                type: 'MASTER_TAX',
                name: 'PTKP'
            }
        }));

        // Optimistically update PTKP and TER in the UI
        setRows(prevRows => prevRows.map(r => {
            if ((r.emp_code || r.nik) === empCode) {
                return { ...r, status_ptkp: newPtkpStatus, kategori_ter: newTer };
            }
            return r;
        }));
    };

    const saveEditedCellsAndColumns = async () => {
        const editsArray = Object.values(editedCells);
        const pendingColumns = addedColumns.filter(newCol =>
            !newCol.placeholder_saved &&
            !editsArray.some(e => e.name === newCol.name && e.type === newCol.type)
        );

        for (const pending of pendingColumns) {
            editsArray.push({
                ...pending,
                value: 0,
                remarks: pending.remarks || `${pending.name} | ${pending.ad_code || pending.base_task_code || pending.task_code || ''}${pending.task_desc ? ` - ${pending.task_desc}` : ''} | 0 | sync:MISS | match:MISMATCH`
            });
        }

        if (editsArray.length === 0) {
            return { changedCount: 0 };
        }

        let successCount = 0;
        let deleteCount = 0;
        const masterTaxEdits = editsArray.filter(e => e.type === 'MASTER_TAX');
        const jobTitleEdits = editsArray.filter(e => e.type === 'PROFILE' && e.field === 'jabatan_estate');
        const normalEdits = editsArray.filter(e => e.type !== 'MASTER_TAX' && !(e.type === 'PROFILE' && e.field === 'jabatan_estate'));
        const { profileItems, valueItems } = splitPayrollEdits({
            month,
            year,
            division,
            edits: normalEdits
        });
        const overlayFields = new Set(['is_spsi_member', 'effective_start_date', 'premi_dynamic', 'pot_koreksi', 'pot_lainnya']);
        const legacyEdits = normalEdits.filter(edit => !overlayFields.has(edit.field));

        for (const edit of masterTaxEdits) {
            try {
                const res = await axios.put(`tax-report/ptkp/${encodeURIComponent(edit.nik)}`, {
                    year,
                    ptkp_status: edit.value
                }, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.data?.success) successCount++;
            } catch (err) {
                console.error('Error saving PTKP edit:', err);
            }
        }

        for (const edit of jobTitleEdits) {
            try {
                const { data } = await axios.post('employee-estate/update', {
                    empCode: edit.emp_code || edit.nik,
                    jobTitle: edit.value
                }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (data?.success) successCount++;
            } catch (err) {
                console.error('Error saving jabatan edit:', err);
            }
        }

        for (const profile of profileItems) {
            let resOk = false;
            let resJson = null;

            if (isProdMode()) {
                try {
                    resJson = await saveLockedProfileOverride(token, profile);
                    resOk = true;
                } catch (err) {
                    console.error('Prod Mode profile override failed:', err);
                }
            } else {
                const res = await fetch('/payroll/overrides/profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(profile)
                });
                if (res.ok) {
                    resOk = true;
                    resJson = await res.json();
                }
            }

            if (resOk && resJson?.success) successCount++;
        }

        if (valueItems.length > 0) {
            let resOk = false;
            let resJson = null;

            if (isProdMode()) {
                try {
                    resJson = await saveLockedValueOverrides(token, { items: valueItems });
                    resOk = true;
                } catch (err) {
                    console.error('Prod Mode value overrides failed:', err);
                }
            } else {
                const res = await fetch('/payroll/overrides/values', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ items: valueItems })
                });
                if (res.ok) {
                    resOk = true;
                    resJson = await res.json();
                }
            }

            if (resOk && resJson?.success) successCount += valueItems.length;
        }

        for (const edit of legacyEdits) {
            const isDeleteEdit = isManualCellDeleteEdit(edit);
            const editAdCode = edit.ad_code || edit.base_task_code || edit.task_code || '';
            const shouldUseStoredRemarks = isDeleteEdit || (edit.value === 0 && edit.remarks);
            const payload = {
                period_month: month,
                period_year: year,
                emp_code: edit.emp_code || edit.nik,
                nik: edit.nik,
                emp_name: edit.emp_name || null,
                gang_code: edit.gang_code,
                division_code: division,
                adjustment_type: edit.type,
                adjustment_name: edit.name,
                amount: isDeleteEdit ? 0 : edit.value,
                remarks: isDeleteEdit ? (edit.remarks || buildManualCellDeleteRemarks(edit.name)) : shouldUseStoredRemarks ? edit.remarks : (editAdCode
                    ? `${edit.name} | ${editAdCode}${edit.task_desc ? ` - ${edit.task_desc}` : ''} | ${edit.value} | sync:MANUAL | match:MANUAL`
                    : `${edit.name} | MANUAL EDIT | ${edit.value} | sync:MANUAL | match:MANUAL`),
                ad_code: edit.ad_code,
                task_code: edit.task_code,
                base_task_code: edit.base_task_code,
                task_desc: edit.task_desc,
                metadata_json: isDeleteEdit ? undefined : edit.metadata_json || undefined
            };

            let resOk = false;
            let resJson = null;

            if (isProdMode()) {
                try {
                    resJson = await saveLockedManualEdit(token, payload);
                    resOk = true;
                } catch (err) {
                    console.error('Prod Mode specific manual edit failed:', err);
                }
            } else {
                const res = await fetch('/payroll/manual-edit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    resOk = true;
                    resJson = await res.json();
                }
            }

            if (resOk && resJson?.success) {
                successCount++;
                if (isDeleteEdit) deleteCount++;
            }
        }

        if (successCount !== editsArray.length) {
            throw new Error(`${successCount}/${editsArray.length} perubahan manual/profile berhasil disimpan. Perubahan yang belum pasti tersimpan tetap ditahan di layar.`);
        }

        setEditedCells({});
        setAddedColumns([]);
        return { changedCount: successCount, deleteCount };
    };

    const saveDeletedManualColumns = async () => {
        if (pendingDeletedColumns.length === 0) return { changedCount: 0 };

        let successCount = 0;
        for (const deletion of pendingDeletedColumns) {
            const response = isProdMode()
                ? await deleteLockedManualAdjustmentColumn(token, deletion.params)
                : await deleteManualAdjustmentColumn(token, deletion.params);
            if (!response?.success) {
                throw new Error(response?.error || `Gagal menghapus kolom ${deletion.name || deletion.field}`);
            }
            successCount++;
        }

        setPendingDeletedColumns([]);
        return { changedCount: successCount };
    };

    const saveEditedKontanCells = async () => {
        const kontanEdits = Object.values(editedKontanCells);
        if (kontanEdits.length === 0) return { changedCount: 0, deleteCount: 0 };

        let successCount = 0;
        let deleteCount = 0;
        for (const k of kontanEdits) {
            const payload = {
                period_month: month,
                period_year: year,
                nik: k.nik,
                emp_code: k.emp_code,
                emp_name: k.emp_name || null,
                gang_code: k.gang_code,
                division_code: division,
                adjustment_type: 'PENDAPATAN_LAINNYA',
                adjustment_name: 'KONTAN',
                amount: k.value,
                remarks: k.value === 0
                    ? `KONTAN | DELETED | 0 | sync:MANUAL | match:MANUAL`
                    : `KONTAN | PENDAPATAN LAINNYA | ${k.value} | sync:MANUAL | match:MANUAL`
            };

            let resOk = false;
            let resJson = null;

            if (isProdMode()) {
                try {
                    if (k.value === 0) {
                        const delPayload = {
                            nik: k.nik,
                            period_month: month,
                            period_year: year,
                            income_type: 'KONTAN'
                        };
                        const delRes = await fetch('/payroll/locked/income-delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify(delPayload)
                        });
                        resJson = await delRes.json();
                        resOk = delRes.ok;
                    } else {
                        resJson = await saveLockedManualEdit(token, payload);
                        resOk = true;
                    }
                } catch (err) {
                    console.error('Prod Mode kontan save failed:', err);
                }
            } else {
                let res;
                if (k.value === 0) {
                    const delPayload = {
                        nik: k.nik,
                        period_month: month,
                        period_year: year,
                        income_type: 'KONTAN'
                    };
                    res = await fetch('/payroll/locked/income-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(delPayload)
                    });
                } else {
                    res = await fetch('/payroll/manual-edit', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(payload)
                    });
                }
                if (res.ok) {
                    resOk = true;
                    resJson = await res.json();
                }
            }

            if (resOk && resJson?.success) {
                successCount++;
                if (k.value === 0) deleteCount++;
            }
        }

        if (successCount !== kontanEdits.length) {
            throw new Error(`${successCount}/${kontanEdits.length} perubahan KONTAN berhasil disimpan. Perubahan yang belum pasti tersimpan tetap ditahan di layar.`);
        }

        setEditedKontanCells({});
        return { changedCount: successCount, deleteCount };
    };

    const saveEditedPendapatanCells = async () => {
        const pendapatanEdits = Object.values(editedPendapatanCells);
        if (pendapatanEdits.length === 0) return { changedCount: 0, deleteCount: 0 };

        let successCount = 0;
        let deleteCount = 0;

        for (const p of pendapatanEdits) {
            const adjustmentName = p.field ? p.field.replace('pendapatan_', 'PENDAPATAN ').toUpperCase() : 'PENDAPATAN LAINNYA';
            const payload = {
                period_month: month,
                period_year: year,
                nik: p.nik,
                emp_code: p.emp_code,
                emp_name: p.emp_name || null,
                gang_code: p.gang_code,
                division_code: division,
                adjustment_type: 'PENDAPATAN_LAINNYA',
                adjustment_name: adjustmentName,
                amount: p.value,
                remarks: p.value === 0
                    ? `${adjustmentName} | DELETED | 0 | sync:MANUAL | match:MANUAL`
                    : `${adjustmentName} | PENDAPATAN LAINNYA | ${p.value} | sync:MANUAL | match:MANUAL`
            };

            let resOk = false;
            let resJson = null;

            if (isProdMode()) {
                try {
                    resJson = await saveLockedManualEdit(token, payload);
                    resOk = true;
                } catch (err) {
                    console.error('Prod Mode pendapatan save failed:', err);
                }
            } else {
                const res = await fetch('/payroll/manual-edit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    resOk = true;
                    resJson = await res.json();
                }
            }

            if (resOk && resJson?.success) {
                successCount++;
                if (p.value === 0) deleteCount++;
            }
        }

        if (successCount !== pendapatanEdits.length) {
            throw new Error(`${successCount}/${pendapatanEdits.length} perubahan Pendapatan Lainnya berhasil disimpan. Perubahan yang belum pasti tersimpan tetap ditahan di layar.`);
        }

        setEditedPendapatanCells({});
        return { changedCount: successCount, deleteCount };
    };

    const performSaveAllEdits = async () => {
        setIsSavingEdits(true);
        try {
            let savedCount = 0;
            let deleteCount = 0;

            if (Object.keys(editedCells).length > 0 || addedColumns.length > 0) {
                const result = await saveEditedCellsAndColumns();
                savedCount += result.changedCount;
                deleteCount += result.deleteCount || 0;
            }

            if (pendingDeletedColumns.length > 0) {
                const result = await saveDeletedManualColumns();
                savedCount += result.changedCount;
                deleteCount += result.changedCount;
            }

            if (Object.keys(editedKontanCells).length > 0) {
                const result = await saveEditedKontanCells();
                savedCount += result.changedCount;
                deleteCount += result.deleteCount;
            }

            if (Object.keys(editedPendapatanCells).length > 0) {
                const result = await saveEditedPendapatanCells();
                savedCount += result.changedCount;
                deleteCount += result.deleteCount;
            }

            if (savedCount === 0) {
                showPayrollToast('info', 'Tidak ada perubahan', 'Belum ada data edit yang perlu disimpan.');
                return;
            }

            showPayrollToast(
                'success',
                'Perubahan tersimpan',
                deleteCount > 0
                    ? `${savedCount} perubahan tersimpan, termasuk ${deleteCount} penghapusan.`
                    : `${savedCount} perubahan berhasil disimpan.`
            );
            triggerPayrollRefresh();
        } catch (error) {
            console.error('Error saving payroll changes:', error);
            showPayrollToast('error', 'Gagal menyimpan', error.message || 'Terjadi kesalahan saat menyimpan perubahan.');
        } finally {
            setIsSavingEdits(false);
        }
    };

    const handleSaveAllEdits = () => {
        if (!hasPendingEdits) {
            showPayrollToast('info', 'Tidak ada perubahan', 'Edit nilai di tabel sebelum menyimpan.');
            return;
        }

        const manualDeleteRows = Object.values(editedCells).filter(isManualCellDeleteEdit);
        const deleteRows = Object.values(editedKontanCells).filter(k => k.value === 0);
        const deletePendapatanRows = Object.values(editedPendapatanCells).filter(p => p.value === 0);
        if (manualDeleteRows.length > 0 || deleteRows.length > 0 || deletePendapatanRows.length > 0 || pendingDeletedColumns.length > 0) {
            const manualNames = manualDeleteRows.map(item => `${item.name || item.field} (${item.emp_code || item.nik})`).join(', ');
            const names = deleteRows.map(k => k.emp_code || k.nik).join(', ');
            const pendapatanNames = deletePendapatanRows.map(p => `${p.field || 'PENDAPATAN'} (${p.emp_code || p.nik})`).join(', ');
            const columnNames = pendingDeletedColumns.map(item => item.name || item.field).join(', ');
            const messages = [];
            if (manualDeleteRows.length > 0) messages.push(`${manualDeleteRows.length} nilai manual adjustment akan dihapus: ${manualNames}.`);
            if (deleteRows.length > 0) messages.push(`${deleteRows.length} nilai KONTAN akan dihapus untuk: ${names}.`);
            if (deletePendapatanRows.length > 0) messages.push(`${deletePendapatanRows.length} nilai Pendapatan Lainnya akan dihapus untuk: ${pendapatanNames}.`);
            if (pendingDeletedColumns.length > 0) messages.push(`${pendingDeletedColumns.length} kolom manual adjustment akan dihapus: ${columnNames}.`);
            openPayrollConfirm({
                variant: 'danger',
                title: 'Konfirmasi hapus data',
                message: `${messages.join(' ')} Penghapusan baru dijalankan setelah tombol ini dikonfirmasi.`,
                confirmText: 'Hapus & Simpan',
                onConfirm: performSaveAllEdits
            });
            return;
        }

        performSaveAllEdits();
    };

    // --- DATA FETCHING ---
    const handleJobTitleChange = (row, newTitle) => {
        const empCode = row.emp_code || row.nik;
        const key = `${empCode}-jabatan_estate`;

        setEditedCells(prev => ({
            ...prev,
            [key]: {
                emp_code: empCode,
                nik: row.nik,
                emp_name: row.nama || row.emp_name || null,
                field: 'jabatan_estate',
                value: newTitle,
                originalValue: row.jabatan_estate ?? null,
                gang_code: row.gang_code,
                type: 'PROFILE',
                name: 'JABATAN'
            }
        }));

        setRows(prev => prev.map(r => (r.emp_code || r.nik) === empCode ? { ...r, jabatan_estate: newTitle } : r));
    };

    const handleBulkSave = () => {
        const employees = displayRows.filter(r => r.type === 'employee');
        if (employees.length === 0) {
            showPayrollToast('info', 'Tidak ada jabatan', 'Tidak ada data karyawan yang bisa dimasukkan ke daftar perubahan.');
            return;
        }

        setEditedCells(prev => {
            const next = { ...prev };
            for (const row of employees) {
                const empCode = row.emp_code || row.nik;
                if (!empCode) continue;
                const key = `${empCode}-jabatan_estate`;
                next[key] = {
                    emp_code: empCode,
                    nik: row.nik,
                    emp_name: row.nama || row.emp_name || null,
                    field: 'jabatan_estate',
                    value: row.jabatan_estate || 'Karyawan',
                    originalValue: row.jabatan_estate ?? null,
                    gang_code: row.gang_code,
                    type: 'PROFILE',
                    name: 'JABATAN'
                };
            }
            return next;
        });
        showPayrollToast('info', 'Jabatan masuk daftar perubahan', `${employees.length} jabatan akan disimpan saat tombol Simpan Perubahan ditekan.`);
    };

    const handleSeedAutoBufferToManualAdjustment = useCallback(async () => {
        if (!token || !division || !month || !year) {
            alert('Periode/divisi belum lengkap. Seeder tidak bisa dijalankan.');
            return;
        }

        const gangScopeLabel = gangCode && gangCode !== 'ALL' ? `gang ${gangCode}` : 'semua gang';
        const confirmText = `Seed buffer otomatis ke manual adjustment untuk ${division} (${gangScopeLabel}) periode ${month}/${year}?`;
        if (!window.confirm(confirmText)) return;

        setIsSeedingAutoBuffer(true);
        try {
            const payload = {
                period_month: Number(month),
                period_year: Number(year),
                division_code: String(division || '').trim().toUpperCase(),
                gang_code: gangCode && gangCode !== 'ALL' ? gangCode : 'ALL',
                use_history_db: !!useHistoryDb,
                snapshot_version: snapshotVersion ?? undefined,
                replace_existing: true,
                value_priority_mode: valuePriorityMode || 'non_db_ptrj'
            };

            let responseJson;
            if (isProdMode()) {
                responseJson = await seedLockedAutoBufferToManualAdjustment(token, payload);
            } else {
                const response = await fetch('/payroll/manual-adjustment/seed-auto-buffer', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });
                responseJson = await response.json();
                if (!response.ok) {
                    throw new Error(responseJson?.error || `HTTP ${response.status}`);
                }
            }

            if (!responseJson?.success) {
                throw new Error(responseJson?.error || 'Seeder auto buffer gagal dijalankan');
            }

            const data = responseJson?.data || {};
            alert(
                `Seeder auto buffer selesai.\n` +
                `Source rows: ${Number(data.source_rows || 0)}\n` +
                `Seeded entries: ${Number(data.seeded_entries || 0)}\n` +
                `Inserted: ${Number(data.inserted || 0)}\n` +
                `Updated: ${Number(data.updated || 0)}`
            );
            triggerPayrollRefresh();
        } catch (error) {
            console.error('[CustomPayrollTable] Seed auto buffer failed:', error);
            alert(`Gagal seed auto buffer: ${error.message}`);
        } finally {
            setIsSeedingAutoBuffer(false);
        }
    }, [token, division, month, year, gangCode, useHistoryDb, snapshotVersion, valuePriorityMode, triggerPayrollRefresh]);

    /**
     * processRawData: Transform raw API data → display rows with PROGRESSIVE rendering.
     * Shows data gang-by-gang to avoid blocking the UI thread.
     * No caching - direct display with progressive updates.
     */
    const processRawData = useCallback(async (data) => {
        if (!data) {
            setDataReady(true);
            setLoadingProgress({ stage: 'complete', message: '', totalGangs: 0, processedGangs: 0, totalEmployees: 0, processedEmployees: 0 });
            return;
        }

        try {
            // Step 1: Process headers immediately (fast)
            setLoadingProgress({
                stage: 'processing',
                message: 'Memproses header kolom...',
                totalGangs: data.gangs?.length || 0,
                processedGangs: 0,
                totalEmployees: data.gangs?.reduce((sum, g) => sum + (g.employees?.length || 0), 0) || 0,
                processedEmployees: 0
            });

            const dynPot = data.dynamic_potongan_headers || [];
            const dynPrem = data.dynamic_premi_headers || [];
            const potTitleMap = data.potongan_title_map || {};
            const premTitleMap = data.premi_title_map || {};

            const premWithTitles = {};
            dynPrem.forEach(field => {
                const title = premTitleMap[field] || field;
                premWithTitles[title] = field;
            });

            const potWithTitles = {};
            dynPot.forEach(field => {
                const title = potTitleMap[field] || field;
                potWithTitles[title] = field;
            });

            setDynamicHeaders({ premi: premWithTitles, potongan: potWithTitles });

            // Step 2: Normalize gang data directly from backend payload (single source of truth)
            setLoadingProgress(prev => ({ ...prev, message: 'Menyusun data gang dari backend...' }));
            const sourceGangs = Array.isArray(data.gangs) ? data.gangs : [];
            const sortedGangs = [...sourceGangs]
                .filter(gang => gang && typeof gang === 'object' && gang.gang_code)
                .map(gang => ({
                    gang_code: gang.gang_code,
                    employees: Array.isArray(gang.employees) ? [...gang.employees] : [],
                    gang_totals: gang.gang_totals || null
                }))
                .sort((a, b) => String(a.gang_code).localeCompare(String(b.gang_code), undefined, { numeric: true, sensitivity: 'base' }))
                .filter(gang => gang.employees.length > 0);

            const totalEmployees = sortedGangs.reduce((sum, gang) => sum + gang.employees.length, 0);

            // Step 3: Progressive rendering - gang by gang
            setLoadingProgress({
                stage: 'rendering',
                message: `Memproses ${sortedGangs.length} gang...`,
                totalGangs: sortedGangs.length,
                processedGangs: 0,
                totalEmployees,
                processedEmployees: 0
            });

            const processedRows = [];
            let globalNo = 1;
            let processedCount = 0;

            // Process gangs in batches to avoid blocking UI
            for (let i = 0; i < sortedGangs.length; i++) {
                const gang = sortedGangs[i];
                const gCode = gang.gang_code;
                const employees = gang.employees;
                
                // Sort employees
                employees.sort((a, b) => {
                    const codeA = String(a.emp_code || a.nik || '').trim();
                    const codeB = String(b.emp_code || b.nik || '').trim();
                    return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
                });

                // Add gang header
                processedRows.push({ type: 'gang_header', gang_code: gCode, id: `HEADER_${gCode}` });
                
                // Add employees
                employees.forEach(emp => {
                    const employeeNo = globalNo++;
                    processedRows.push({
                        ...emp,
                        no: employeeNo,
                        type: 'employee',
                        id: emp.new_nik || emp.nik || `EMP_${employeeNo}`
                    });
                });

                const gangTotal = {
                    ...(gang.gang_totals || {}),
                    type: 'gang_total',
                    id: `TOTAL_${gCode}`,
                    gang_code: gCode,
                    nama: `TOTAL GANG ${gCode}`,
                    emp_code: `${employees.length} Kary.`
                };
                processedRows.push(gangTotal);

                processedCount += employees.length;

                // Update progress every 2 gangs or if it's the last one
                if (i % 2 === 1 || i === sortedGangs.length - 1) {
                    setLoadingProgress({
                        stage: 'rendering',
                        message: `Memproses gang ${i + 1}/${sortedGangs.length}: ${gCode}`,
                        totalGangs: sortedGangs.length,
                        processedGangs: i + 1,
                        totalEmployees,
                        processedEmployees: processedCount
                    });

                    // Yield to browser to render current rows
                    if (i < sortedGangs.length - 1) {
                        setRows([...processedRows]); // Update rows progressively
                        await new Promise(resolve => setTimeout(resolve, 50)); // 50ms yield
                    }
                }
            }

            // Step 5: Final updates
            setLoadingProgress({
                stage: 'complete',
                message: 'Selesai!',
                totalGangs: sortedGangs.length,
                processedGangs: sortedGangs.length,
                totalEmployees,
                processedEmployees: processedCount
            });

            // Grand total must come from backend payload
            if (data.grand_total && typeof data.grand_total === 'object') {
                setGrandTotal({
                    ...data.grand_total,
                    emp_code: `${processedCount} Karyawan`
                });
            } else {
                console.warn('[CustomPayrollTable] Backend payload missing grand_total');
                setGrandTotal(null);
            }

            // Set final rows (all processed)
            setRows(processedRows);
            setDataReady(true);

            // Determine active dynamic fields
            const employeeRows = processedRows.filter(r => r.type === 'employee');
            const activePremi = Object.entries(premWithTitles).filter(([, field]) =>
                employeeRows.some(row => {
                    const val = row[field];
                    return val !== null && val !== undefined && val !== 0 && val !== '';
                })
            ).map(([, field]) => field);
            setActivePremiFields(activePremi);

            const activePot = Object.entries(potWithTitles).filter(([, field]) =>
                employeeRows.some(row => {
                    const val = row[field];
                    return val !== null && val !== undefined && val !== 0 && val !== '';
                })
            ).map(([, field]) => field);
            setActivePotFields(activePot);

            // Discover dynamic pendapatan_* fields by scanning rows (not in headers map)
            // EXCLUDE: pendapatan_tidak_tetap (duplikat dari pendapatan_thr + pendapatan_kontan, tidak boleh tampil sebagai kolom)
            // EXCLUDE: pendapatan_lainnya (total, akan ditampilkan terpisah)
            // EXCLUDE: pendapatan_kontan (sudah punya kolom sendiri di UPAH KOTOR)
            const excludedPendapatan = ['pendapatan_tidak_tetap', 'pendapatan_lainnya', 'pendapatan_kontan'];
            const allPendapatanKeys = new Set();
            employeeRows.forEach(row => {
                Object.keys(row).forEach(key => {
                    if (key.startsWith('pendapatan_') && !excludedPendapatan.includes(key)) {
                        allPendapatanKeys.add(key);
                    }
                });
            });
            setActivePendapatanFields(Array.from(allPendapatanKeys).sort());

            setAllEmployeeNiks(employeeRows.map(r => r.nik).filter(Boolean));
            setSelection([]);
        } catch (err) {
            console.error('[CustomPayrollTable] processRawData error:', err);
            setError(err.message);
            setLoadingProgress({ stage: 'complete', message: '', totalGangs: 0, processedGangs: 0, totalEmployees: 0, processedEmployees: 0 });
        }
    }, [division, month, year]);

    /**
     * fetchDivisionData: Fetches data directly from API.
     * No caching - always fresh from server.
     * Race condition: abort previous request when new one starts.
     */
    const abortControllerRef = useRef(null);
    const fetchDivisionData = useCallback(async () => {
        // Abort any in-flight request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setLoading(true);
        setError('');
        setDataReady(false);
        setRows([]);
        setGrandTotal(null);
        setLoadingProgress({
            stage: 'fetching',
            message: 'Mengambil data dari server...',
            totalGangs: 0,
            processedGangs: 0,
            totalEmployees: 0,
            processedEmployees: 0
        });
        try {
            // Always fetch based on current filters. No client-side caching of full division.
            let data;
            if (isProdMode()) {
                // In production, we might still want to filter by gangPrefix if showing ALL gangs
                const shouldSendGangPrefix = !gangCode || gangCode === 'ALL';
                data = await getLockedRawTree(
                    token, division, month, year, useHistoryDb,
                    shouldSendGangPrefix ? effectiveGangPrefix : null,
                    snapshotVersion,
                    gangCode,
                    valuePriorityMode
                );
            } else {
                const params = new URLSearchParams({
                    division_code: division,
                    month: String(month),
                    year: String(year),
                    use_history: useHistoryDb ? 'true' : 'false'
                });
                if (valuePriorityMode) params.set('value_priority_mode', valuePriorityMode);
                if (effectiveGangPrefix) params.set('gang_prefix', effectiveGangPrefix);
                if (gangCode && gangCode !== 'ALL') params.set('gang_code', gangCode);
                appendSnapshotVersionToSearchParams(params, snapshotVersion);
                const url = `/payroll/report/division-raw-tree?${params.toString()}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: controller.signal
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[CustomPayrollTable] ❌ HTTP Error:', response.status, errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
                data = await response.json();
            }

            // Check if API returned an error
            if (data?.error) {
                throw new Error(data.error);
            }

            // Validate data structure
            if (!data || typeof data !== 'object') {
                console.error('[CustomPayrollTable] ❌ Invalid data structure:', data);
                throw new Error('Invalid data structure dari API atau Sesi kedaluwarsa');
            }

            onDataLoaded?.(data);
            setResolvedSnapshotVersion(data?.meta?.snapshot_version ?? null);
            processRawData(data);

        } catch (err) {
            if (err.name === 'AbortError') {
                return; // Silently ignore aborted requests
            }
            console.error('[CustomPayrollTable] ❌ Fetch error:', err);
            setError(err.message);
            setDataReady(true);
            setLoadingProgress({ stage: 'complete', message: '', totalGangs: 0, processedGangs: 0, totalEmployees: 0, processedEmployees: 0 });
        } finally {
            if (abortControllerRef.current === controller) {
                setLoading(false);
                // Don't reset loadingProgress here - let it show complete state
            }
        }
    }, [division, month, year, gangCode, effectiveGangPrefix, token, useHistoryDb, valuePriorityMode, snapshotVersion, gangLoading, processRawData, onDataLoaded]);

    // --- MAIN DATA EFFECT ---
    // When streaming is enabled: use SSE stream (handled by usePayrollStream hook)
    // When streaming is disabled: fallback to old fetch/process approach
    useEffect(() => {
        if (!canStartDataFlow || gangLoading) return;
        // Streaming is handled by usePayrollStream hook automatically
        // Only call fetchDivisionData when streaming is disabled (fallback mode)
        if (!streamEnabled) {
            fetchDivisionData();
        }
    }, [canStartDataFlow, gangLoading, refreshTrigger, useHistoryDb, valuePriorityMode, snapshotVersion, fetchDivisionData, streamEnabled]);

    // === COLUMN DEFINITIONS (Single Source of Truth) ===
    // Each column knows its header hierarchy: [level0, level1, level2, level3]
    // null means "merge with parent above"
    const columnDefs = useMemo(() => {
        const cols = [
            // Checkbox Column
            {
                field: 'checkbox',
                headers: ['IDENTITAS', null, '✓'],
                w: 35,
                className: 'text-center',
                render: (row) => {
                    if (row.type !== 'employee') return null;
                    return (
                        <input
                            type="checkbox"
                            checked={Array.isArray(selectedEmployees) && selectedEmployees.includes(row.emp_code || row.nik)}
                            onChange={() => handleCheckboxChange(row.emp_code || row.nik)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ cursor: 'pointer' }}
                        />
                    );
                }
            },
            {
                field: 'no',
                headers: ['IDENTITAS', null, 'NO'],
                w: 35,
                className: 'text-center'
            },
            {
                field: 'emp_code',
                headers: ['IDENTITAS', null, 'EMP CODE'],
                w: 75,
                className: 'text-center sticky-col frozen-col-theme',
                left: 0
            },
            {
                field: 'manual_adjustment_action',
                headers: ['IDENTITAS', null, 'MANUAL'],
                w: 72,
                className: 'text-center',
                render: (row) => {
                    if (!isEditMode || row.type !== 'employee') return '-';
                    return (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                handleAddColumn(PREMI);
                            }}
                            title="Tambah manual adjustment berbasis ADTrans"
                            style={{
                                border: '1px solid #bbf7d0',
                                background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                                color: 'white',
                                borderRadius: 999,
                                padding: '3px 8px',
                                fontSize: 10,
                                fontWeight: 800,
                                cursor: 'pointer',
                                boxShadow: '0 4px 10px rgba(22, 163, 74, 0.24)'
                            }}
                        >
                            + AD
                        </button>
                    );
                }
            },
            {
                field: 'nama',
                headers: ['IDENTITAS', null, 'NAMA'],
                w: displayMode === 'detail' ? 140 : 120,
                className: `text-left sticky-col frozen-col-theme ${displayMode === 'simple' ? 'cell-wrap cell-wrap-name' : ''}`.trim(),
                left: 75,
                render: (row) => {
                    if (row.type !== 'employee') return row.nama || row.emp_code;
                    const koreksi = row.koreksi_hk || 0;
                    const nama = row.nama || row.emp_code || '-';
                    if (koreksi === 0) return nama;

                    const isKurang = koreksi < 0;
                    const warningColor = isKurang ? '#dc2626' : '#ea580c';
                    const warningBg = isKurang ? '#fef2f2' : '#fff7ed';
                    const warningBorder = isKurang ? '#fecaca' : '#fed7aa';
                    const warningLabel = isKurang ? '⚠️ KURANG JAM' : '🔴 SALAH SCAN';
                    const tooltipText = isKurang
                        ? `⚠️ Pembayaran Tidak Benar\nKoreksi HK: ${formatNumber(koreksi)}\nGP Aktual < GP Ideal`
                        : `🔴 Salah Scan / Jam Lebih\nKoreksi HK: +${formatNumber(koreksi)}\nGP Aktual > GP Ideal`;

                    const compactNameLayout = displayMode === 'simple';
                    return (
                        <div style={{ display: 'flex', alignItems: compactNameLayout ? 'flex-start' : 'center', gap: '4px', width: '100%' }}>
                            <span
                                style={{
                                    flex: 1,
                                    overflow: compactNameLayout ? 'visible' : 'hidden',
                                    textOverflow: compactNameLayout ? 'clip' : 'ellipsis',
                                    whiteSpace: compactNameLayout ? 'normal' : 'nowrap',
                                    wordBreak: compactNameLayout ? 'break-word' : 'normal',
                                    lineHeight: compactNameLayout ? '1.2' : 'normal'
                                }}
                            >
                                {nama}
                            </span>
                            <span
                                title={tooltipText}
                                style={{
                                    fontSize: '8px',
                                    fontWeight: 'bold',
                                    color: warningColor,
                                    backgroundColor: warningBg,
                                    border: `1px solid ${warningBorder}`,
                                    borderRadius: '3px',
                                    padding: '1px 3px',
                                    whiteSpace: 'nowrap',
                                    lineHeight: '1.2',
                                    cursor: 'help',
                                    flexShrink: 0
                                }}
                            >
                                {warningLabel}
                            </span>
                        </div>
                    );
                }
            },
            {
                field: 'alamat',
                headers: ['IDENTITAS', null, 'ALAMAT'],
                w: displayMode === 'detail' ? 200 : 130,
                className: 'text-left cell-wrap cell-wrap-address',
                render: (row) => row.alamat || row.res_address || '-'
            },
            {
                field: 'join_date',
                headers: ['IDENTITAS', null, 'TGL MASUK'],
                w: 100,
                className: 'text-center',
                render: (row) => {
                    if (row.type !== 'employee') {
                        const jd = row.join_date || row.tanggal_masuk;
                        if (!jd) return '-';
                        try {
                            const d = new Date(jd);
                            if (isNaN(d.getTime())) return jd;
                            return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
                        } catch {
                            return jd;
                        }
                    }
                    const jd = row.join_date || row.tanggal_masuk;
                    // Edit mode: use effective_start_date for editing
                    const editKey = `${row.emp_code || row.nik}-effective_start_date`;
                    const isEdited = !!editedCells[editKey];

                    if (isEditMode) {
                        const displayDate = jd ? (() => {
                            try {
                                const d = new Date(jd);
                                if (isNaN(d.getTime())) return '';
                                return d.toISOString().split('T')[0]; // YYYY-MM-DD for input
                            } catch { return ''; }
                        })() : '';
                        return (
                            <input
                                type="date"
                                className={`edit-input ${isEdited ? 'cell-edited' : ''}`}
                                value={editedCells[editKey]?.value ?? displayDate}
                                onChange={(e) => handleProfileEdit(row, 'effective_start_date', e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        );
                    }

                    if (!jd) return '-';
                    try {
                        const d = new Date(jd);
                        if (isNaN(d.getTime())) return jd;
                        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
                    } catch {
                        return jd;
                    }
                }
            },

            // PAJAK [Conditionally Expanded]
            ...(isTaxExpanded ? [
                {
                    field: 'status_ptkp',
                    headers: [PAJAK, null, 'PTKP'],
                    w: 80,
                    className: 'text-center',
                    render: (row) => {
                        if (isEditMode && row.type === 'employee') {
                            const empCode = row.emp_code || row.nik;
                            const editKey = `${empCode}-status_ptkp`;
                            const isEdited = !!editedCells[editKey];
                            const ptkpOptions = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];
                            const canEditPtkp = isPercobaanGang(row.gang_code, row.gang_desc);
                            return (
                                <select
                                    className={`edit-input ${isEdited ? 'cell-edited' : ''}`}
                                    value={row.status_ptkp || 'TK/0'}
                                    onChange={(e) => {
                                        if (!canEditPtkp) {
                                            showPayrollToast('error', 'PTKP Terkunci',
                                                `PTKP master hanya bisa diubah untuk gang percobaan (PERCOBAAN / berakhiran P / BHL). Gang: ${row.gang_code || 'unknown'} ${row.gang_desc ? '- ' + row.gang_desc : ''}`);
                                            return;
                                        }
                                        handlePtkpEdit(row, e.target.value);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={!canEditPtkp}
                                    title={canEditPtkp ? 'Ubah status PTKP' : 'PTKP terkunci — hanya gang percobaan yang bisa diubah'}
                                    style={{ fontSize: '11px', padding: '1px 2px', width: '100%', cursor: canEditPtkp ? 'pointer' : 'not-allowed' }}
                                >
                                    {ptkpOptions.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            );
                        }
                        return row.status_ptkp || '-';
                    }
                },
                { field: 'kategori_ter', headers: [PAJAK, null, 'TER'], w: 55, className: 'text-center' },
                // PENDAPATAN LAINNYA TAXABLE (Dynamic) - THR, Bonus, Custom, etc that are taxable (included in penghasilan_bruto)
                ...getOtherIncomeDetailFields(effectiveActivePendapatanFields).map(field => {
                    const baseType = field.replace('pendapatan_', '');
                    const taxField = `taxable_pendapatan_${baseType}`;
                    const displayName = formatOtherIncomeColumnLabel(field);
                    return {
                        field: taxField,
                        headers: [PAJAK, 'OBJEK', displayName],
                        w: 85,
                        className: 'text-right',
                        render: (row) => {
                            const val = Number(row[taxField] || row[field] || 0);
                            if (val === 0) return '-';
                            return formatNumber(val);
                        }
                    };
                }),
                { field: 'taxable_pendapatan_lainnya', headers: [PAJAK, 'OBJEK', 'TOTAL'], w: 85, className: 'text-right font-bold cell-total-soft', render: (row) => {
                    const val = Number(row.taxable_pendapatan_lainnya || row.pendapatan_lainnya || 0);
                    if (val === 0) return '-';
                    return formatNumber(val);
                }},
                { field: 'penghasilan_bruto', headers: [PAJAK, null, 'BRUTO'], w: 110, className: 'text-right font-bold' },
                {
                    field: 'tarif_pajak_ter',
                    headers: [PAJAK, null, 'TER (%)'],
                    w: 80,
                    className: 'text-center',
                    render: (row) => {
                        const val = Number(row.tarif_pajak_ter) || 0;
                        if (val === 0) return '0%';
                        return `${val.toFixed(2)}%`;
                    }
                }
            ] : []),

            // PPH21 TER (Always Visible Summary)
            { field: 'pph21_ter', headers: [PAJAK, null, 'PPH21 TER'], w: 95, className: 'text-right' },

            // ABSENSI
            { field: 'hari_kerja', headers: ['ABSENSI', 'HADIR', 'HK'], w: 40, className: 'text-center' },
            ...[
                { field: 'cuti_tahunan_hari', headers: ['ABSENSI', 'CUTI/OFF', 'TAHUNAN'], w: 45, className: 'text-center' },
                { field: 'cuti_sakit_haid_hari', headers: ['ABSENSI', 'CUTI/OFF', 'SAKIT'], w: 70, className: 'text-center' },
                { field: 'cuti_minggu_hari', headers: ['ABSENSI', 'CUTI/OFF', 'MINGGU'], w: 55, className: 'text-center' },
                { field: 'cuti_nasional_hari', headers: ['ABSENSI', 'CUTI/OFF', 'NASIONAL'], w: 60, className: 'text-center' },
            ],
            { field: 'jumlah_hk', headers: ['ABSENSI', null, 'TOTAL HK'], w: 60, className: 'text-center font-bold cell-total-soft' },
            // ABSENSI > TOTAL JAM [NEW] - Marks employees with shortage hours (kurang jam)
            {
                field: 'total_jam_kerja',
                headers: ['ABSENSI', null, 'TOTAL JAM'],
                w: 80,
                className: 'text-center',
                render: (row) => {
                    // Check for excess hours first (salah scan)
                    if (row.has_excess && !row.has_shortage) {
                        const excessInfo = row.excess_details || [];
                        const excessCount = excessInfo.length;
                        const excessTotalHours = row.excess_total_hours || 0;

                        let tooltipText = `🔴 SALAH SCAN / JAM LEBIH\n`;
                        tooltipText += `Total Kelebihan: ${excessTotalHours.toFixed(1)} jam\n`;
                        tooltipText += `Jumlah Hari: ${excessCount} hari\n\n`;
                        tooltipText += `Rincian:\n`;
                        excessInfo.forEach((detail, idx) => {
                            tooltipText += `${idx + 1}. ${detail.date} (${detail.day_name})\n`;
                            tooltipText += `   Actual: ${detail.actual_hours} jam, Target: ${detail.target_hours} jam\n`;
                            tooltipText += `   Lebih: +${detail.excess_hours.toFixed(1)} jam\n`;
                        });

                        return (
                            <div
                                style={{
                                    backgroundColor: '#fff7ed',
                                    color: '#9a3412',
                                    fontWeight: 'bold',
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '11px',
                                    border: '2px solid #f97316',
                                    borderRadius: '4px',
                                    gap: '2px'
                                }}
                                title={tooltipText}
                            >
                                <span style={{ fontSize: '14px' }}>🔴</span>
                                <span>{row.total_jam_kerja}</span>
                                {excessTotalHours > 0 && (
                                    <span style={{ fontSize: '9px', color: '#7c2d12' }}>
                                        (+{excessTotalHours.toFixed(1)}j)
                                    </span>
                                )}
                            </div>
                        );
                    }

                    if (!row.has_shortage) {
                        return (
                            <div style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                {row.total_jam_kerja}
                            </div>
                        );
                    }

                    // Build tooltip with detailed shortage info
                    const shortageInfo = row.shortage_details || [];
                    const shortageCount = shortageInfo.length;
                    const shortageTotalHours = row.shortage_total_hours || 0;
                    const shortageDates = shortageInfo.map(d => d.date.split('-').pop()).join(', ');

                    let tooltipText = `⚠️ KURANG JAM KERJA\n`;
                    tooltipText += `Total Selisih: ${shortageTotalHours.toFixed(1)} jam\n`;
                    tooltipText += `Tanggal: ${shortageDates}\n`;
                    tooltipText += `Jumlah Hari: ${shortageCount} hari\n\n`;
                    tooltipText += `Rincian:\n`;
                    shortageInfo.forEach((detail, idx) => {
                        tooltipText += `${idx + 1}. ${detail.date} (${detail.day_name})\n`;
                        tooltipText += `   Actual: ${detail.actual_hours} jam, Target: ${detail.target_hours} jam\n`;
                        tooltipText += `   Kurang: ${detail.shortage_hours.toFixed(1)} jam\n`;
                    });

                    return (
                        <div
                            style={{
                                backgroundColor: '#fecaca',
                                color: '#991b1b',
                                fontWeight: 'bold',
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                border: '2px solid #ef4444',
                                borderRadius: '4px',
                                animation: 'pulse-warning 2s infinite',
                                lineHeight: '1',
                                overflow: 'hidden'
                            }}
                            title={tooltipText}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                <span style={{ fontSize: '12px' }}>⚠️</span>
                                <span>{row.total_jam_kerja}</span>
                            </div>
                            <div style={{ fontSize: '8px', color: '#7f1d1d', fontWeight: 'bold', marginTop: '1px' }}>
                                Tgl: {shortageDates}
                            </div>
                            {shortageTotalHours > 0 && (
                                <span style={{ fontSize: '7px', color: '#7f1d1d', opacity: 0.8 }}>
                                    (-{shortageTotalHours.toFixed(1)}j)
                                </span>
                            )}
                        </div>
                    );
                }
            },
        ];

        // PANEN - temporarily disabled in UI, keep header as section placeholder only
        cols.push({
            field: 'panen_section_disabled',
            headers: ['PANEN', null, 'SEMENTARA OFF'],
            w: 100,
            className: 'text-center cell-section-disabled',
            render: () => ''
        });

        // PENGGAJIAN
        const showPayrollDetails = true;
        cols.push({
            field: 'gaji_pokok_aktual',
            headers: [PENGGAJIAN, null, 'GP AKTUAL'],
            w: 95,
            className: 'text-right',
            render: (row) => {
                const val = row.gaji_pokok_aktual || 0;
                if (val === 0) return '-';
                const ideal = row.gaji_pokok_ideal || 0;
                if (row.type === 'employee' && val > ideal) {
                    return (
                        <div
                            title={`⚠️ Gaji Tidak Benar: Aktual (${formatNumber(val)}) melebihi Ideal (${formatNumber(ideal)})`}
                            style={{ color: '#dc2626', fontWeight: 'bold', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}
                        >
                            <span style={{ fontSize: '11px' }}>⚠️</span>
                            <span>{formatNumber(val)}</span>
                        </div>
                    );
                }
                return formatNumber(val);
            }
        });
        if (showPayrollDetails) {
            cols.push({ field: 'gaji_pokok_ideal', headers: [PENGGAJIAN, null, 'GP IDEAL'], w: 85, className: 'text-right' });
            cols.push({
                field: 'koreksi_hk',
                headers: [PENGGAJIAN, null, 'KOR. HK'],
                w: 85,
                className: 'text-right',
                render: (row) => {
                    const val = row.koreksi_hk;
                    if (val === null || val === undefined || val === 0) return '-';
                    const isKurang = val < 0;
                    const color = isKurang ? '#dc2626' : '#ea580c';
                    let label = isKurang ? 'Kurang Jam' : 'Salah Scan';
                    if (isKurang && row.shortage_details?.length > 0) {
                        const shortageDates = row.shortage_details.map(d => d.date.split('-').pop()).join(', ');
                        label = `KJ: ${shortageDates}`;
                    }
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: '1.1' }}>
                            <span style={{ color, fontWeight: 'bold' }}>{isKurang ? '-' : '+'}{formatNumber(Math.abs(val))}</span>
                            <span style={{ fontSize: '8px', color, opacity: 0.9, whiteSpace: 'nowrap' }}>({label})</span>
                        </div>
                    );
                }
            });
        }

        // JABATAN
        cols.push({
            field: 'jabatan_estate',
            headers: ['IDENTITAS', null, 'JABATAN'],
            w: 180,
            className: 'text-left p-0',
            render: (row) => {
                if (row.type !== 'employee') return row.jabatan_estate || '-';
                const empCode = row.emp_code || row.nik;
                const editKey = `${empCode}-jabatan_estate`;
                const isEdited = !!editedCells[editKey];
                const displayValue = editedCells[editKey]?.value ?? row.jabatan_estate ?? '';
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', width: '100%', height: '100%' }}>
                        <select
                            value={displayValue}
                            onChange={(e) => handleJobTitleChange(row, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            className={isEdited ? 'cell-edited' : ''}
                            style={{
                                flex: 1, padding: '0 4px', height: '100%', minHeight: '24px',
                                fontSize: '10px', border: isEdited ? '1px solid #b45309' : '1px solid transparent', borderRadius: '3px',
                                backgroundColor: isEdited ? '#fef3c7' : 'transparent', cursor: 'pointer', outline: 'none',
                                transition: 'border-color 0.3s'
                            }}
                        >
                            <option value="">-- Pilih Jabatan --</option>
                            <option value="karyawan panen">Karyawan Panen</option>
                            <option value="karyawan perawatan">Karyawan Perawatan</option>
                            <option value="karyawan">Karyawan</option>
                            <option value="mandor panen">Mandor Panen</option>
                            <option value="mandor perawatan">Mandor Perawatan</option>
                            <option value="kerani buah">Kerani Buah</option>
                            <option value="kerani kantor">Kerani Kantor</option>
                            <option value="operator">Operator</option>
                            <option value="helper">Helper</option>
                        </select>
                        {isEdited && <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 800 }} title="Menunggu Simpan Perubahan">*</span>}
                    </div>
                );
            }
        });

        cols.push({
            field: 'is_spsi_member',
            headers: ['IDENTITAS', null, 'SPSI'],
            w: 78,
            className: 'text-center',
            render: (row) => {
                if (row.type !== 'employee') return row.is_spsi_member ? 'SPSI' : '-';
                const editKey = `${row.emp_code || row.nik}-is_spsi_member`;
                const isEdited = !!editedCells[editKey];

                if (isEditMode) {
                    return (
                        <input
                            type="checkbox"
                            checked={!!row.is_spsi_member}
                            className={isEdited ? 'cell-edited' : ''}
                            onChange={(e) => handleProfileEdit(row, 'is_spsi_member', e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                        />
                    );
                }

                return row.is_spsi_member ? 'SPSI' : 'Non-SPSI';
            }
        });

        cols.push({
            field: 'masa_kerja_label',
            headers: ['IDENTITAS', null, 'MASA KERJA'],
            w: 95,
            className: 'text-center',
            render: (row) => row.masa_kerja_label || '0 bln'
        });

        // ALAMAT
        // TUNJANGAN
        const showAllowanceRates = true;
        if (showAllowanceRates) {
            cols.push({ field: 'beras_rate', headers: ['TUNJANGAN', 'BERAS', 'RATE'], w: 60, className: 'text-right' });
        }
        cols.push({ field: 'beras_jumlah', headers: ['TUNJANGAN', 'BERAS', 'JUMLAH'], w: 80, className: 'text-right' });

        if (showAllowanceRates) {
            cols.push({ field: 'jabatan_rate', headers: ['TUNJANGAN', 'TUNJ JAB', 'RATE'], w: 60, className: 'text-right', render: (row) => formatNumber(resolveJabatanRate(row)) });
        }
        cols.push({ field: 'jabatan_jumlah', headers: ['TUNJANGAN', 'TUNJ JAB', 'JUMLAH'], w: 80, className: 'text-right', render: (row) => formatNumber(row.jabatan_jumlah) });

        cols.push({ field: 'masa_kerja_tahun', headers: ['TUNJANGAN', 'MASA KERJA', 'LAMA'], w: 45, className: 'text-center' });
        cols.push({ field: 'masa_kerja_jumlah', headers: ['TUNJANGAN', 'MASA KERJA', 'JUMLAH'], w: 80, className: 'text-right' });

        cols.push({ field: 'lembur_jam', headers: ['TUNJANGAN', 'LEMBUR', 'JAM'], w: 45, className: 'text-center' });
        cols.push({ field: 'lembur_jumlah', headers: ['TUNJANGAN', 'LEMBUR', 'JUMLAH'], w: 80, className: 'text-right' });

        cols.push({ field: 'total_tunjangan', headers: ['TUNJANGAN', null, 'TOTAL TUNJ'], w: 95, className: 'text-right font-bold cell-total-soft' });

        // PREMI
        const showPremiDetails = true;
        if (showPremiDetails) {
            cols.push({ field: 'premi_brondol', headers: [PREMI, null, 'BRONDOL'], w: 80, className: 'text-right' });

            Object.entries(effectiveDynamicHeaders.premi)
                .filter(([label, field]) => !isStaticPremiFieldKey(field) && !isStaticBrondolHeader(label, field) && (effectiveActivePremiFields.includes(field) || isEditMode))
                .forEach(([label, field]) => {
                    const displayName = label.replace('PREMI ', '');
                    const canonicalName = buildCanonicalManualAdjustmentName('PREMI', label);
                    cols.push({
                        field, headers: [PREMI, null, displayName], w: 90, className: 'text-right',
                        render: (row) => {
                            const val = Number(row[field] || 0);
                            const empCode = row.emp_code || row.nik;
                            const editKey = `${empCode}-${field}`;
                            const isEdited = !!editedCells[editKey];
                            const edit = editedCells[editKey];
                            const displayVal = getManualCellDisplayAmount({ row, field, edit: isEditMode ? edit : null, fallbackAmount: val });
                            const storedMetadata = parsePremiumMetadataValue(row?.manual_adjustment_metadata?.[field]);
                            const resolvedPremium = resolvePremiumDefinitionForAdjustment({
                                label,
                                canonicalName,
                                definitions: premiumDefinitions,
                                remarks: edit?.remarks || row?.manual_adjustment_remarks || row?.remarks
                            });
                            const premiumDef = resolvedPremium.definition;
                            const addedColumn = addedColumns.find((item) => item.field === field && item.type === 'PREMI');
                            const resolvedAdjustmentName = resolvedPremium.adjustmentName || canonicalName;
                            const inputType = resolveManualDetailInputType({ edit, storedMetadata, addedColumn, definition: premiumDef });
                            const popupInitialData = row.type === 'employee' && inputType !== 'amount'
                                ? resolvePremiumPopupInitialData({ edit, amount: displayVal, inputType, row, field, adjustmentName: resolvedAdjustmentName })
                                : null;
                            const mismatch = getVisibleManualDetailMismatch({
                                row,
                                field,
                                adjustmentType: 'PREMI',
                                adjustmentName: resolvedAdjustmentName
                            });
                            const popupMetadata = parsePremiumMetadataValue(popupInitialData);
                            const hasDbMetadata = !!edit?.metadata_json || !!storedMetadata;
                            const hasFallbackMetadata = !!popupMetadata?.legacy_source;
                            const popupStoredAmount = Number(popupMetadata?.amount ?? mismatch?.amount ?? displayVal) || 0;
                            const hasEffectiveDetailValue = Number(displayVal || 0) !== 0;
                            const hasStructuredDetail = row.type === 'employee' && inputType !== 'amount' && hasEffectiveDetailValue && (premiumDef || addedColumn || popupMetadata);
                            const popupDetailValidation = popupMetadata
                                ? validatePremiumDetailMetadata(popupMetadata, inputType)
                                : null;
                            const popupDetailIncomplete = popupDetailValidation && !popupDetailValidation.isComplete;
                            const popupDetailIssueReason = buildManualDetailIssueReason({ mismatch, validation: popupDetailValidation });
                            const editBase = isEditMode ? {
                                emp_code: empCode,
                                nik: row.nik,
                                emp_name: row.nama || row.emp_name || null,
                                field,
                                value: popupStoredAmount,
                                originalValue: resolvePersistentOriginalNumber(edit?.originalValue, popupStoredAmount),
                                gang_code: row.gang_code,
                                type: 'PREMI',
                                name: resolvedAdjustmentName,
                                ad_code: edit?.ad_code || addedColumn?.ad_code || premiumDef?.ad_code,
                                task_code: edit?.task_code || addedColumn?.task_code || premiumDef?.ad_code,
                                base_task_code: edit?.base_task_code || addedColumn?.base_task_code || premiumDef?.ad_code,
                                task_desc: edit?.task_desc || addedColumn?.task_desc || premiumDef?.task_desc,
                                input_type: inputType,
                                remarks: edit?.remarks || addedColumn?.remarks
                            } : null;
                            const detailButton = hasStructuredDetail ? (
                                <button
                                    type="button"
                                    title={popupDetailIssueReason || (isEditMode ? 'Edit detail' : 'Lihat detail pekerjaan')}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setPremiumPopup({
                                            isOpen: true,
                                            editKey: isEditMode ? editKey : null,
                                            inputType,
                                            definitionName: premiumDef?.adjustment_name || resolvedAdjustmentName,
                                            defaultGangCode: row.gang_code,
                                            initialData: popupInitialData,
                                            storedAmount: popupStoredAmount,
                                            mismatch,
                                            editBase,
                                            readOnly: !isEditMode
                                        });
                                    }}
                                    style={{
                                        border: (mismatch || popupDetailIncomplete) ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                        background: (mismatch || popupDetailIncomplete) ? '#fee2e2' : hasDbMetadata ? '#dcfce7' : hasFallbackMetadata ? '#fef3c7' : '#f8fafc',
                                        borderRadius: 6,
                                        padding: '2px 5px',
                                        cursor: 'pointer',
                                        fontSize: 10,
                                        color: (mismatch || popupDetailIncomplete) ? '#dc2626' : hasDbMetadata ? '#16a34a' : hasFallbackMetadata ? '#b45309' : '#64748b',
                                        fontWeight: 800,
                                        lineHeight: 1.1,
                                        minWidth: 38
                                    }}
                                >
                                    Detail
                                </button>
                            ) : null;

                            if (isEditMode && row.type === 'employee') {
                                const triggerAmount = getManualCellDisplayAmount({ row, field, edit, fallbackAmount: val });
                                const triggerHasData = hasManualCellData({ row, field, edit, displayAmount: triggerAmount });
                                const triggerPendingDelete = isManualCellDeleteEdit(edit);
                                const triggerInitialData = inputType !== 'amount'
                                    ? resolvePremiumPopupInitialData({ edit, amount: triggerAmount, inputType, row, field, adjustmentName: resolvedAdjustmentName })
                                    : null;
                                const triggerMetadata = parsePremiumMetadataValue(triggerInitialData);
                                const triggerStoredAmount = Number(triggerMetadata?.amount ?? mismatch?.amount ?? triggerAmount) || 0;
                                const triggerHasFallbackMetadata = !!triggerMetadata?.legacy_source;
                                const triggerValidation = triggerPendingDelete ? null : getManualDetailValidation({ metadata: triggerMetadata, inputType, amount: triggerAmount, adjustmentType: 'PREMI' });
                                const triggerEditBase = {
                                    ...editBase,
                                    value: triggerStoredAmount,
                                    originalValue: resolvePersistentOriginalNumber(edit?.originalValue, triggerStoredAmount)
                                };

                                return (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                        {mismatch && !triggerPendingDelete && (
                                            <span
                                                title={`Alasan tanda merah: ${buildManualDetailMismatchReason(mismatch)}`}
                                                style={{ color: '#dc2626', fontSize: 11, fontWeight: 800 }}
                                            >
                                                !
                                            </span>
                                        )}
                                        {renderManualCellTrigger({
                                            hasData: triggerHasData,
                                            displayAmount: triggerAmount,
                                            hasDbMetadata,
                                            hasFallbackMetadata: triggerHasFallbackMetadata,
                                            mismatch,
                                            detailValidation: triggerValidation,
                                            pendingDelete: triggerPendingDelete,
                                            disabled: triggerPendingDelete,
                                            label: triggerPendingDelete ? 'Hapus' : undefined,
                                            onClick: () => setPremiumPopup({
                                                isOpen: true,
                                                editKey,
                                                inputType,
                                                definitionName: premiumDef?.adjustment_name || resolvedAdjustmentName,
                                                defaultGangCode: row.gang_code,
                                                initialData: triggerInitialData,
                                                storedAmount: triggerStoredAmount,
                                                mismatch,
                                                editBase: triggerEditBase
                                            })
                                        })}
                                        {renderManualCellDeleteAction({
                                            hasData: triggerHasData,
                                            pendingDelete: triggerPendingDelete,
                                            onDelete: () => markManualCellForDelete({
                                                editKey,
                                                edit,
                                                editBase: triggerEditBase,
                                                displayAmount: triggerAmount,
                                                name: resolvedAdjustmentName
                                            }),
                                            onCancelDelete: () => cancelManualCellDelete({ editKey, name: resolvedAdjustmentName })
                                        })}
                                    </div>
                                );
                            }

                            if (detailButton) {
                                return (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                        <span>{displayVal === 0 ? '-' : formatNumber(displayVal)}</span>
                                        {mismatch && (
                                            <span
                                                title={`Alasan tanda merah: ${buildManualDetailMismatchReason(mismatch)}`}
                                                style={{ color: '#dc2626', fontSize: 11, fontWeight: 800 }}
                                            >
                                                !
                                            </span>
                                        )}
                                        {detailButton}
                                    </div>
                                );
                            }

                            if (displayVal === 0) return '-';
                            return formatNumber(displayVal);
                        }
                    });
                });
        }
        cols.push({ field: 'total_premi', headers: [PREMI, null, 'TOTAL PREMI'], w: 95, className: 'text-right font-bold cell-total-soft' });

        // PENDAPATAN LAINNYA
        const activePendapatan = getOtherIncomeDetailFields(effectiveActivePendapatanFields);
        const showOtherIncomeDetails = isEditMode && isOtherIncomeExpanded;
        const deductionOtherIncomeFields = showOtherIncomeDetails
            ? getOtherIncomeDetailFields(effectiveActivePendapatanFields, { includeKontan: true })
            : [];
        if (showOtherIncomeDetails) {
            for (const field of activePendapatan) {
                const displayName = formatOtherIncomeColumnLabel(field, '(+)');
                cols.push({
                    field,
                    headers: [PENDAPATAN_LAINNYA, null, displayName],
                    w: 90,
                    className: 'text-right font-bold',
                    render: (row) => {
                        const val = Number(row[field] || 0);
                        const empCode = row.emp_code || row.nik;
                        const editKey = `${empCode}-${field}`;
                        const cellEdit = editedPendapatanCells[editKey];
                        const displayVal = cellEdit ? toFiniteNumber(cellEdit.value) : val;
                        const isEdited = !!cellEdit;

                        if (isEditMode && row.type === 'employee') {
                            return (
                                <DeferredPayrollNumberInput
                                    className={`edit-input ${isEdited ? 'cell-edited' : ''}`}
                                    value={displayVal}
                                    onCommit={(rawVal) => {
                                        const newVal = parsePayrollInputNumber(rawVal);
                                        if (newVal === null) return;
                                        setEditedPendapatanCells(prev => {
                                            const existingEdit = prev[editKey];
                                            const persistedOriginal = resolvePersistentOriginalNumber(existingEdit?.originalValue, val);
                                            return {
                                                ...prev,
                                                [editKey]: {
                                                    nik: row.nik,
                                                    emp_code: row.emp_code,
                                                    emp_name: row.nama || row.emp_name || null,
                                                    field: field,
                                                    value: newVal,
                                                    originalValue: persistedOriginal,
                                                    gang_code: row.gang_code
                                                }
                                            };
                                        });
                                    }}
                                    placeholder="0"
                                    style={{ width: '70px' }}
                                />
                            );
                        }
                        if (val === 0) return '-';
                        return formatNumber(val);
                    }
                });
            }
        }

        if (showOtherIncomeDetails || isEditMode) {
            cols.push({
            field: 'pendapatan_kontan',
            headers: [PENDAPATAN_LAINNYA, null, 'KONTAN (+)'],
            w: 90,
            className: 'text-right',
            render: (row) => {
                const val = Number(row.pendapatan_kontan || 0);
                const empCode = row.emp_code || row.nik;
                const editKey = `${empCode}-pendapatan_kontan`;
                const cellEdit = editedKontanCells[editKey];
                const displayVal = cellEdit ? toFiniteNumber(cellEdit.value) : val;
                const isEdited = !!cellEdit;

                if (isEditMode && row.type === 'employee') {
                    const hasPendingDelete = cellEdit && cellEdit.value === 0;
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <DeferredPayrollNumberInput
                                className={`edit-input ${isEdited ? 'cell-edited' : ''} ${hasPendingDelete ? 'cell-delete' : ''}`}
                                value={displayVal}
                                onCommit={(rawVal) => {
                                    const newVal = parsePayrollInputNumber(rawVal);
                                    if (newVal === null) return;
                                    setEditedKontanCells(prev => {
                                        const existingEdit = prev[editKey];
                                        const persistedOriginal = resolvePersistentOriginalNumber(existingEdit?.originalValue, val);
                                        return {
                                            ...prev,
                                            [editKey]: {
                                                nik: row.nik,
                                                emp_code: row.emp_code,
                                                emp_name: row.nama || row.emp_name || null,
                                                value: newVal,
                                                originalValue: persistedOriginal,
                                                gang_code: row.gang_code
                                            }
                                        };
                                    });
                                }}
                                placeholder="0"
                                style={{ width: '65px' }}
                            />
                            {hasPendingDelete && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openPayrollConfirm({
                                            variant: 'danger',
                                            title: 'Batalkan hapus KONTAN?',
                                            message: `Nilai KONTAN untuk ${row.nama || row.nik || empCode} akan dikembalikan ke nilai sebelumnya.`,
                                            confirmText: 'Batalkan Hapus',
                                            onConfirm: () => {
                                                const restoreValue = resolvePersistentOriginalNumber(cellEdit?.originalValue, val);
                                                setEditedKontanCells(prev => {
                                                    const upd = { ...prev };
                                                    delete upd[editKey];
                                                    return upd;
                                                });
                                                setRows(prev => prev.map(r => (r.emp_code || r.nik) === empCode ? { ...r, pendapatan_kontan: restoreValue } : r));
                                                showPayrollToast('info', 'Hapus KONTAN dibatalkan', 'Nilai KONTAN dikembalikan ke nilai sebelumnya.');
                                            }
                                        });
                                    }}
                                    style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', padding: '2px 5px' }}
                                    title="Batal Hapus"
                                >✕</button>
                            )}
                        </div>
                    );
                }
                return val === 0 ? '-' : formatNumber(val);
            }
            });
        }

        cols.push({
            field: 'total_pendapatan_lainnya',
            headers: [PENDAPATAN_LAINNYA, null, 'TOTAL (+)'],
            w: 100,
            className: 'text-right font-bold',
            render: (row) => {
                const val = Number(row.total_pendapatan_lainnya || 0);
                return formatNumber(val);
            }
        });

        const dynamicPotonganEntriesMap = new Map();
        const activePotFieldSet = new Set((effectiveActivePotFields || []).map((field) => normalizeFieldKey(field)));
        const addedPotonganTypeByField = new Map();

        for (const addedColumn of addedColumns || []) {
            if (!addedColumn || !addedColumn.field) continue;
            if (addedColumn.type !== 'POTONGAN_KOTOR' && addedColumn.type !== 'POTONGAN_BERSIH') continue;
            addedPotonganTypeByField.set(normalizeFieldKey(addedColumn.field), addedColumn.type);
        }

        const registerDynamicPotonganEntry = (label, field) => {
            const normalizedField = normalizeFieldKey(field);
            if (isStaticPotonganFieldKey(normalizedField) || isSpsiLabel(label)) return;
            if (!normalizedField || dynamicPotonganEntriesMap.has(normalizedField)) return;
            dynamicPotonganEntriesMap.set(normalizedField, [label, field]);
        };

        for (const [label, field] of Object.entries(effectiveDynamicHeaders.potongan || {})) {
            registerDynamicPotonganEntry(label, field);
        }

        for (const field of effectiveActivePotFields || []) {
            const normalizedField = normalizeFieldKey(field);
            if (!normalizedField || dynamicPotonganEntriesMap.has(normalizedField)) continue;
            registerDynamicPotonganEntry(formatFallbackPotonganLabel(field), field);
        }

        if (isEditMode) {
            for (const addedColumn of addedColumns || []) {
                if (!addedColumn || !addedColumn.field) continue;
                if (addedColumn.type !== 'POTONGAN_KOTOR' && addedColumn.type !== 'POTONGAN_BERSIH') continue;
                registerDynamicPotonganEntry(
                    addedColumn.name || formatFallbackPotonganLabel(addedColumn.field),
                    addedColumn.field
                );
            }
        }

        const dynamicPotonganEntries = Array.from(dynamicPotonganEntriesMap.values());

        // POTONGAN UPAH KOTOR
        const koreksiFields = dynamicPotonganEntries
            .filter(([label, field]) => {
                const normalizedField = normalizeFieldKey(field);
                const normalizedLabel = String(label || '').trim().toUpperCase();
                const addedType = addedPotonganTypeByField.get(normalizedField);
                if (isAutomaticPayrollKoreksiFieldKey(normalizedField)) return false;
                const isKoreksiField = normalizedField.startsWith('koreksi') || normalizedLabel.startsWith('KOREKSI');
                if (!(isKoreksiField || addedType === 'POTONGAN_KOTOR')) return false;
                return activePotFieldSet.has(normalizedField) || isEditMode;
            })
            .sort(([a], [b]) => (a || '').localeCompare(b || ''));

        for (const [label, field] of koreksiFields) {
            const displayLabel = label.replace(/^KOREKSI\s*/i, 'KOR. ') || label;
            const canonicalName = buildCanonicalManualAdjustmentName('POTONGAN UPAH KOTOR', label);
            cols.push({
                field, headers: [POTONGAN_UPAH_KOTOR, 'KOREKSI GROSS', `${displayLabel} (-)`], w: 96, className: 'text-right cell-koreksi-gross',
                render: (row) => {
                    const val = row[field] || 0;
                    const empCode = row.emp_code || row.nik;
                    const editKey = `${empCode}-${field}`;
                    const edit = editedCells[editKey];
                    const displayVal = getManualCellDisplayAmount({ row, field, edit: isEditMode ? edit : null, fallbackAmount: val });
                    const addedColumn = addedColumns.find((item) => item.field === field && item.type === 'POTONGAN_KOTOR');
                    const storedMetadata = parsePremiumMetadataValue(row?.manual_adjustment_metadata?.[field]);
                    const inputType = resolveManualDetailInputType({ edit, storedMetadata, addedColumn, defaultInputType: KOREKSI_DEFAULT_INPUT_TYPE });
                    const popupInitialData = row.type === 'employee'
                        ? resolvePremiumPopupInitialData({ edit, amount: displayVal, inputType, row, field, adjustmentName: canonicalName })
                        : null;
                    const mismatch = getVisibleManualDetailMismatch({
                        row,
                        field,
                        adjustmentType: 'POTONGAN_KOTOR',
                        adjustmentName: canonicalName
                    });
                    const popupMetadata = parsePremiumMetadataValue(popupInitialData);
                    const hasDbMetadata = !!edit?.metadata_json || !!storedMetadata;
                    const hasFallbackMetadata = !!popupMetadata?.legacy_source;
                    const popupStoredAmount = Number(popupMetadata?.amount ?? mismatch?.amount ?? displayVal) || 0;
                    const editBase = isEditMode ? {
                        emp_code: empCode,
                        nik: row.nik,
                        emp_name: row.nama || row.emp_name || null,
                        field,
                        value: popupStoredAmount,
                        originalValue: resolvePersistentOriginalNumber(edit?.originalValue, popupStoredAmount),
                        gang_code: row.gang_code,
                        type: 'POTONGAN_KOTOR',
                        name: canonicalName,
                        ad_code: addedColumn?.ad_code || KOREKSI_DEFAULT_AD_CODE,
                        task_code: addedColumn?.task_code || KOREKSI_DEFAULT_AD_CODE,
                        base_task_code: addedColumn?.base_task_code || KOREKSI_DEFAULT_AD_CODE,
                        task_desc: addedColumn?.task_desc || KOREKSI_DEFAULT_TASK_DESC,
                        input_type: inputType,
                        remarks: addedColumn?.remarks
                    } : null;
                    const hasEffectiveDetailValue = Number(displayVal || 0) !== 0;
                    const detailButton = row.type === 'employee' && hasEffectiveDetailValue ? (
                        <button
                                type="button"
                                title={isEditMode ? (mismatch ? `Alasan tanda merah: ${buildManualDetailMismatchReason(mismatch)}` : 'Edit detail koreksi') : 'Lihat detail koreksi'}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setPremiumPopup({
                                        isOpen: true,
                                        editKey: isEditMode ? editKey : null,
                                        inputType,
                                        definitionName: canonicalName,
                                        defaultGangCode: row.gang_code,
                                        initialData: popupInitialData,
                                        storedAmount: popupStoredAmount,
                                        mismatch,
                                        editBase,
                                        readOnly: !isEditMode
                                    });
                                }}
                                style={{
                                    border: '1px solid #fed7aa',
                                    background: mismatch ? '#fee2e2' : hasDbMetadata ? '#dcfce7' : hasFallbackMetadata ? '#fef3c7' : '#fff7ed',
                                    borderRadius: 6,
                                    padding: '2px 5px',
                                    cursor: 'pointer',
                                    fontSize: 10,
                                    color: mismatch ? '#dc2626' : hasDbMetadata ? '#16a34a' : hasFallbackMetadata ? '#b45309' : '#c2410c',
                                    fontWeight: 800,
                                    lineHeight: 1.1,
                                    minWidth: 38
                                }}
                            >
                                Detail
                            </button>
                        ) : null;

                        if (isEditMode && row.type === 'employee') {
                            const triggerAmount = getManualCellDisplayAmount({ row, field, edit, fallbackAmount: val });
                            const triggerHasData = hasManualCellData({ row, field, edit, displayAmount: triggerAmount });
                            const triggerPendingDelete = isManualCellDeleteEdit(edit);
                            const triggerInitialData = inputType !== 'amount'
                                ? resolvePremiumPopupInitialData({ edit, amount: triggerAmount, inputType, row, field, adjustmentName: canonicalName })
                                : null;
                            const triggerMetadata = parsePremiumMetadataValue(triggerInitialData);
                            const triggerStoredAmount = Number(triggerMetadata?.amount ?? mismatch?.amount ?? triggerAmount) || 0;
                            const triggerHasFallbackMetadata = !!triggerMetadata?.legacy_source;
                            const triggerValidation = triggerPendingDelete ? null : getManualDetailValidation({ metadata: triggerMetadata, inputType, amount: triggerAmount, adjustmentType: 'POTONGAN_KOTOR' });
                            const triggerEditBase = {
                                ...editBase,
                                value: triggerStoredAmount,
                                originalValue: resolvePersistentOriginalNumber(edit?.originalValue, triggerStoredAmount)
                            };
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                    {mismatch && !triggerPendingDelete && (
                                        <span
                                            title={`Alasan tanda merah: ${buildManualDetailMismatchReason(mismatch)}`}
                                            style={{ color: '#dc2626', fontSize: 11, fontWeight: 800 }}
                                        >
                                            !
                                        </span>
                                    )}
                                    {renderManualCellTrigger({
                                        hasData: triggerHasData,
                                        displayAmount: triggerAmount,
                                        hasDbMetadata,
                                        hasFallbackMetadata: triggerHasFallbackMetadata,
                                        mismatch,
                                        detailValidation: triggerValidation,
                                        pendingDelete: triggerPendingDelete,
                                        disabled: triggerPendingDelete,
                                        label: triggerPendingDelete ? 'Hapus' : undefined,
                                        onClick: () => setPremiumPopup({
                                            isOpen: true,
                                            editKey,
                                            inputType,
                                            definitionName: canonicalName,
                                            defaultGangCode: row.gang_code,
                                            initialData: triggerInitialData,
                                            storedAmount: triggerStoredAmount,
                                            mismatch,
                                            editBase: triggerEditBase
                                        })
                                    })}
                                    {renderManualCellDeleteAction({
                                        hasData: triggerHasData,
                                        pendingDelete: triggerPendingDelete,
                                        onDelete: () => markManualCellForDelete({
                                            editKey,
                                            edit,
                                            editBase: triggerEditBase,
                                            displayAmount: triggerAmount,
                                            name: canonicalName
                                        }),
                                        onCancelDelete: () => cancelManualCellDelete({ editKey, name: canonicalName })
                                    })}
                                </div>
                            );
                        }
                        if (detailButton) {
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                    <span>{displayVal === 0 ? '-' : formatNumber(displayVal)}</span>
                                    {mismatch && (
                                        <span
                                            title={`Alasan tanda merah: ${buildManualDetailMismatchReason(mismatch)}`}
                                            style={{ color: '#dc2626', fontSize: 11, fontWeight: 800 }}
                                        >
                                            !
                                        </span>
                                    )}
                                    {detailButton}
                                </div>
                            );
                        }
                        return displayVal === 0 ? '-' : formatNumber(displayVal);
                    }
                });
            }
        cols.push({
            field: 'potongan_upah_kotor_total',
            headers: [POTONGAN_UPAH_KOTOR, 'TOTAL KOREKSI', 'TOTAL (-)'],
            w: 98,
            className: 'text-right font-bold cell-total-soft cell-koreksi-gross',
            render: (row) => formatNegativeTotalNumber(row.potongan_upah_kotor_total)
        });

        // UPAH KOTOR
        cols.push({
            field: 'jumlah_upah_kotor', headers: [UPAH_KOTOR, 'SETELAH KOREKSI', 'JUMLAH'], w: 118, className: 'text-right font-bold cell-gross-salary',
            render: (row) => {
                const empCode = row.emp_code || row.nik;
                const kontanEdit = editedKontanCells[`${empCode}-pendapatan_kontan`];
                const originalKontan = toFiniteNumber(kontanEdit?.originalValue ?? row.pendapatan_kontan);
                const currentKontan = toFiniteNumber(kontanEdit?.value ?? row.pendapatan_kontan);
                const val = toFiniteNumber(row.jumlah_upah_kotor) - originalKontan + currentKontan;
                return val === 0 ? '-' : formatNumber(val);
            }
        });

        // POTONGAN UPAH BERSIH - Collapsible
        // Default: Show ONLY Total Potongan
        const showDeductionDetails = true;

        if (showDeductionDetails) {
            // POTONGAN UPAH BERSIH > CARUMAN ASTEK
            cols.push({
                field: 'pot_astek',
                headers: [POTONGAN_UPAH_BERSIH, 'CARUMAN', 'ASTEK', 'PEK.'],
                w: 75,
                className: 'text-right'
            });
            cols.push({
                field: 'pot_astek_maj',
                headers: [POTONGAN_UPAH_BERSIH, 'CARUMAN', 'ASTEK', 'MAJ.'],
                w: 75,
                className: 'text-right'
            });

            // POTONGAN UPAH BERSIH > POTONGAN BPJS > KESEHATAN
            cols.push({
                field: 'pot_bpjs_kesehatan_pekerja',
                headers: [POTONGAN_UPAH_BERSIH, 'CARUMAN', 'BPJS KES', 'PEK.'],
                w: 75,
                className: 'text-right'
            });
            cols.push({
                field: 'pot_bpjs_kesehatan_majikan',
                headers: [POTONGAN_UPAH_BERSIH, 'CARUMAN', 'BPJS KES', 'MAJ.'],
                w: 75,
                className: 'text-right'
            });
            // POTONGAN UPAH BERSIH > POTONGAN BPJS > PENSIUN
            cols.push({
                field: 'pot_bpjs_pensiun_pekerja',
                headers: [POTONGAN_UPAH_BERSIH, 'CARUMAN', 'BPJS PEN', 'PEK.'],
                w: 75,
                className: 'text-right'
            });
            cols.push({
                field: 'pot_bpjs_pensiun_majikan',
                headers: [POTONGAN_UPAH_BERSIH, 'CARUMAN', 'BPJS PEN', 'MAJ.'],
                w: 75,
                className: 'text-right'
            });
            // POTONGAN UPAH BERSIH > POTONGAN BPJS > JUMLAH
            cols.push({ field: 'pot_bpjs_pekerja_total', headers: [POTONGAN_UPAH_BERSIH, 'CARUMAN', 'BPJS', 'TOTAL'], w: 80, className: 'text-right font-bold' });
            // Other deductions
            cols.push({ field: 'pot_spsi', headers: [POTONGAN_UPAH_BERSIH, 'SETELAH UPAH KOTOR', null, 'SPSI (-)'], w: 86, className: 'text-right' });
            cols.push({ field: 'pot_pph21', headers: [POTONGAN_UPAH_BERSIH, 'SETELAH UPAH KOTOR', null, 'PPH21 (-)'], w: 86, className: 'text-right' });
            
            // PENDAPATAN LAINNYA sebagai pengurang upah bersih
            for (const field of deductionOtherIncomeFields) {
                cols.push({
                    field: `${field}_pengurang`,
                    headers: [POTONGAN_UPAH_BERSIH, 'SETELAH UPAH KOTOR', null, formatOtherIncomeColumnLabel(field, '(-)')],
                    w: 90,
                    className: 'text-right',
                    render: (row) => {
                        const val = Number(row[field] || 0);
                        if (val === 0) return '-';
                        return formatNegativeTotalNumber(val);
                    }
                });
            }

            cols.push({
                field: 'total_pendapatan_lainnya_pengurang',
                headers: [POTONGAN_UPAH_BERSIH, 'SETELAH UPAH KOTOR', null, 'PEND. LAIN (-)'],
                w: 90,
                className: 'text-right',
                render: (row) => {
                    const val = Number(row.total_pendapatan_lainnya || 0);
                    if (val === 0) return '-';
                    return formatNegativeTotalNumber(val);
                }
            });

            cols.push({
                field: 'premi_pph',
                headers: [POTONGAN_UPAH_BERSIH, 'SETELAH UPAH KOTOR', null, 'PREMI PPH (+)'],
                w: 90,
                className: 'text-right cell-premi-pph',
                render: (row) => {
                    const val = row.premi_pph || 0;
                    if (val === 0) return '-';
                    return (
                        <span style={{ color: '#059669', fontWeight: 'bold' }}>
                            +{formatNumber(val)}
                        </span>
                    );
                }
            });

            // Dynamic Potongan Bersih
            const potonganBersihFields = dynamicPotonganEntries
                .filter(([label, field]) => {
                    const normalizedField = normalizeFieldKey(field);
                    const u = normalizedField.toUpperCase();
                    const addedType = addedPotonganTypeByField.get(normalizedField);
                    if (addedType === 'POTONGAN_KOTOR' || isGrossDeductionFieldKey(normalizedField)) return false;
                    if (addedType === 'POTONGAN_BERSIH') return true;
                    return !u.startsWith('KOREKSI') && u !== 'SPSI' && u !== 'PPH21' && u !== 'PREMI_PPH';
                })
                .filter(([label, field]) => activePotFieldSet.has(normalizeFieldKey(field)) || isEditMode)
                .sort(([a], [b]) => (a || '').localeCompare(b || ''));

            for (const [label, field] of potonganBersihFields) {
                const displayLabel = (label || '').replace(/^(POTONGAN\s*|POT\s*)/i, '') || label;
                const canonicalName = buildCanonicalManualAdjustmentName('POTONGAN UPAH BERSIH', label);
                cols.push({
                    field,
                    headers: [POTONGAN_UPAH_BERSIH, 'SETELAH UPAH KOTOR', null, displayLabel],
                    w: 90,
                    className: 'text-right',
                    render: (row) => {
                        const val = row[field] || 0;
                        const displayAmount = getManualCellDisplayAmount({ row, field, fallbackAmount: val });
                        if (isEditMode && row.type === 'employee') {
                            const empCode = row.emp_code || row.nik;
                            const editKey = `${empCode}-${field}`;
                            const edit = editedCells[editKey];
                            const displayAmount = getManualCellDisplayAmount({ row, field, edit, fallbackAmount: val });
                            const hasData = hasManualCellData({ row, field, edit, displayAmount });
                            const pendingDelete = isManualCellDeleteEdit(edit);
                            const storedMetadata = parsePremiumMetadataValue(row?.manual_adjustment_metadata?.[field]);
                            const addedColumn = addedColumns.find((item) => item.field === field && item.type === 'POTONGAN_BERSIH');
                            const mismatch = getVisibleManualDetailMismatch({
                                row,
                                field,
                                adjustmentType: 'POTONGAN_BERSIH',
                                adjustmentName: canonicalName
                            });
                            const inputType = resolveManualDetailInputType({ edit, storedMetadata, addedColumn });
                            const initialData = inputType !== 'amount'
                                ? resolvePremiumPopupInitialData({ edit, amount: displayAmount, inputType, row, field, adjustmentName: canonicalName })
                                : null;
                            const popupMetadata = parsePremiumMetadataValue(initialData);
                            const storedAmount = Number(popupMetadata?.amount ?? mismatch?.amount ?? displayAmount) || 0;
                            const detailValidation = pendingDelete ? null : getManualDetailValidation({ metadata: popupMetadata, inputType, amount: displayAmount, adjustmentType: 'POTONGAN_BERSIH' });
                            const editBase = {
                                emp_code: empCode,
                                nik: row.nik,
                                emp_name: row.nama || row.emp_name || null,
                                field,
                                value: storedAmount,
                                originalValue: resolvePersistentOriginalNumber(edit?.originalValue, storedAmount),
                                gang_code: row.gang_code,
                                type: 'POTONGAN_BERSIH',
                                name: canonicalName,
                                ad_code: edit?.ad_code || addedColumn?.ad_code,
                                task_code: edit?.task_code || addedColumn?.task_code,
                                base_task_code: edit?.base_task_code || addedColumn?.base_task_code,
                                task_desc: edit?.task_desc || addedColumn?.task_desc,
                                input_type: inputType,
                                remarks: edit?.remarks || addedColumn?.remarks
                            };
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                    {mismatch && !pendingDelete && (
                                        <span
                                            title={`Alasan tanda merah: ${buildManualDetailMismatchReason(mismatch)}`}
                                            style={{ color: '#dc2626', fontSize: 11, fontWeight: 800 }}
                                        >
                                            !
                                        </span>
                                    )}
                                    {renderManualCellTrigger({
                                        hasData,
                                        displayAmount,
                                        hasDbMetadata: !!edit?.metadata_json || !!storedMetadata,
                                        hasFallbackMetadata: !!popupMetadata?.legacy_source,
                                        mismatch,
                                        detailValidation,
                                        pendingDelete,
                                        disabled: pendingDelete,
                                        label: pendingDelete ? 'Hapus' : undefined,
                                        onClick: () => setPremiumPopup({
                                            isOpen: true,
                                            editKey,
                                            inputType,
                                            definitionName: canonicalName,
                                            defaultGangCode: row.gang_code,
                                            initialData,
                                            storedAmount,
                                            mismatch,
                                            editBase
                                        })
                                    })}
                                    {renderManualCellDeleteAction({
                                        hasData,
                                        pendingDelete,
                                        onDelete: () => markManualCellForDelete({
                                            editKey,
                                            edit,
                                            editBase,
                                            displayAmount,
                                            name: canonicalName
                                        }),
                                        onCancelDelete: () => cancelManualCellDelete({ editKey, name: canonicalName })
                                    })}
                                </div>
                            );
                        }
                        if (displayAmount === 0) return '-';
                        return formatNegativeTotalNumber(displayAmount);
                    }
                });
            }

        }

        // Total Potongan Bersih
        cols.push({
            field: 'total_potongan_bersih',
            headers: [POTONGAN_UPAH_BERSIH, 'TOTAL POTONGAN BERSIH', null, 'TOTAL (-)'],
            w: 100,
            className: 'text-right font-bold cell-deduction cell-total-soft',
            render: (row) => {
                const empCode = row.emp_code || row.nik;
                const kontanEdit = editedKontanCells[`${empCode}-pendapatan_kontan`];
                const originalKontan = toFiniteNumber(kontanEdit?.originalValue ?? row.pendapatan_kontan);
                const currentKontan = toFiniteNumber(kontanEdit?.value ?? row.pendapatan_kontan);
                const val = toFiniteNumber(row.total_potongan_bersih) - originalKontan + currentKontan;
                return formatNegativeTotalNumber(val);
            }
        });

        // UPAH BERSIH
        cols.push({
            field: 'upah_bersih',
            headers: [UPAH_BERSIH, null, 'JUMLAH'],
            w: 115,
            className: 'text-right font-bold cell-net-salary',
            render: (row) => {
                const val = Number(row.upah_bersih || 0);
                if (val === 0) return '-';
                return formatNumber(val);
            }
        });

        // Attach group to each column for body cell coloring
        cols.forEach(c => {
            c.group = getPayrollHeaderGroup(c.headers[0]);
        });

        return cols;
    }, [effectiveDynamicHeaders, effectiveActivePremiFields, effectiveActivePotFields, effectiveActivePendapatanFields, tunjanganMode, tunjanganRates, isTaxExpanded, isHarvestExpanded, isAttendanceExpanded, isPayrollExpanded, isAllowanceExpanded, isDeductionExpanded, isOtherIncomeExpanded, isPremiExpanded, selectedEmployees, onToggleEmployeeSelection, isEditMode, editedCells, editedKontanCells, addedColumns, premiumDefinitions, displayMode]);

    const chapterSegments = useMemo(() => buildPayrollViewportChapters(columnDefs), [columnDefs]);
    const stickyPaneWidth = useMemo(() => (
        columnDefs.reduce((maxRight, column) => {
            if (column.left === undefined || column.left === null) return maxRight;
            const left = Number(column.left) || 0;
            const width = Number(column.w) || 0;
            return Math.max(maxRight, left + width);
        }, 0)
    ), [columnDefs]);
    const firstScrollableGroup = useMemo(
        () => chapterSegments.find((chapter) => chapter.group && chapter.group !== PAYROLL_HEADER_GROUPS.IDENTITAS)?.group
            || chapterSegments[0]?.group
            || null,
        [chapterSegments]
    );
    const focusedGroup = activeChapterGroup || firstScrollableGroup;
    const renderColumnDefs = useMemo(() => {
        if (displayMode !== 'simple' || !focusedGroup) return columnDefs;
        const simpleColumns = columnDefs.filter((column) => column.left !== undefined || column.group === focusedGroup);
        const viewportWidth = Math.max(320, Number(tableContainerWidth) || 0);
        const totalWidth = simpleColumns.reduce((sum, column) => sum + (Number(column.w) || 0), 0);

        if (totalWidth <= viewportWidth) {
            return simpleColumns;
        }

        const stickyWidth = simpleColumns.reduce((maxRight, column) => {
            if (column.left === undefined || column.left === null) return maxRight;
            const left = Number(column.left) || 0;
            const width = Number(column.w) || 0;
            return Math.max(maxRight, left + width);
        }, 0);
        const fitCandidateColumns = simpleColumns.filter((column) => column.left === undefined || column.left === null);
        const fitCandidateWidth = fitCandidateColumns.reduce((sum, column) => sum + (Number(column.w) || 0), 0);
        const availableWidth = Math.max(160, viewportWidth - stickyWidth);

        if (!fitCandidateColumns.length || fitCandidateWidth <= 0 || fitCandidateWidth <= availableWidth) {
            return simpleColumns;
        }

        const fitScale = availableWidth / fitCandidateWidth;
        return simpleColumns.map((column) => {
            if (column.left !== undefined && column.left !== null) return column;

            const baseWidth = Number(column.w) || 0;
            if (baseWidth <= 0) return column;

            const className = String(column.className || '');
            const isTextColumn = className.includes('text-left');
            const minWidth = column.field === 'alamat'
                ? 92
                : column.field === 'nama'
                    ? 110
                    : (isTextColumn ? 86 : 54);
            const nextWidth = Math.max(minWidth, Math.round(baseWidth * fitScale));

            if (nextWidth === baseWidth) return column;
            return { ...column, w: nextWidth };
        });
    }, [columnDefs, displayMode, focusedGroup, tableContainerWidth]);
    const responsiveScale = useMemo(
        () => getPayrollResponsiveScaleForWidth(tableContainerWidth),
        [tableContainerWidth]
    );
    const effectiveScale = useMemo(
        () => getPayrollEffectiveScale({ containerWidth: tableContainerWidth, fontSize }),
        [tableContainerWidth, fontSize]
    );
    const responsiveMetrics = useMemo(() => {
        const tableFontPx = Number(clampNumber(11 * effectiveScale, 8.5, 14).toFixed(2));
        const headerTopFontPx = Math.round(clampNumber(14 * effectiveScale, 11, 16));
        const headerSubFontPx = Math.round(clampNumber(13 * effectiveScale, 10, 15));
        const headerPadY = Math.round(clampNumber(4 * effectiveScale, 2, 7));
        const headerPadX = Math.round(clampNumber(6 * effectiveScale, 4, 10));
        const bodyPadY = Math.round(clampNumber(3 * effectiveScale, 2, 6));
        const bodyPadX = Math.round(clampNumber(6 * effectiveScale, 4, 10));
        const rowHeight = Math.round(clampNumber(28 * effectiveScale, 22, 36));
        const toolbarScale = Number(clampNumber(effectiveScale, 0.86, 1.08).toFixed(3));
        const dockScale = Number(clampNumber(effectiveScale, 0.82, 1).toFixed(3));
        const detailBottomSafeArea = Math.round(clampNumber(112 * dockScale, 88, 128));
        const simpleBottomSafeArea = Math.round(clampNumber(56 * dockScale, 46, 84));

        return {
            tableFontPx,
            headerTopFontPx,
            headerSubFontPx,
            headerPadY,
            headerPadX,
            bodyPadY,
            bodyPadX,
            rowHeight,
            toolbarScale,
            dockScale,
            detailBottomSafeArea,
            simpleBottomSafeArea
        };
    }, [effectiveScale]);
    const rowHeight = responsiveMetrics.rowHeight;
    const payrollResponsiveVars = useMemo(() => ({
        '--payroll-responsive-scale': String(responsiveScale.toFixed(3)),
        '--payroll-effective-scale': String(effectiveScale.toFixed(3)),
        '--payroll-toolbar-scale': String(responsiveMetrics.toolbarScale),
        '--payroll-dock-scale': String(responsiveMetrics.dockScale),
        '--payroll-font-size-base': `${responsiveMetrics.tableFontPx}px`,
        '--payroll-header-font-size': `${responsiveMetrics.headerSubFontPx}px`,
        '--payroll-header-pad-y': `${responsiveMetrics.headerPadY}px`,
        '--payroll-header-pad-x': `${responsiveMetrics.headerPadX}px`,
        '--payroll-body-pad-y': `${responsiveMetrics.bodyPadY}px`,
        '--payroll-body-pad-x': `${responsiveMetrics.bodyPadX}px`,
        '--payroll-row-height': `${rowHeight}px`
    }), [
        effectiveScale,
        responsiveScale,
        responsiveMetrics.bodyPadX,
        responsiveMetrics.bodyPadY,
        responsiveMetrics.dockScale,
        responsiveMetrics.headerPadX,
        responsiveMetrics.headerPadY,
        responsiveMetrics.headerSubFontPx,
        responsiveMetrics.tableFontPx,
        responsiveMetrics.toolbarScale,
        rowHeight
    ]);
    const renderValueSourceComparison = useCallback((row, field, renderedValue) => {
        if (normalizeValuePriorityMode(valuePriorityMode) !== 'db_ptrj_only') return renderedValue;
        const compare = row?.value_source_compare?.[field];
        if (!compare) return renderedValue;

        const dbValue = compare.db_ptrj;
        const activeValue = compare.active;
        const dbText = formatSourceCompareValue(dbValue);
        const activeText = formatSourceCompareValue(activeValue);
        const dbNumeric = Number(dbValue);
        const activeNumeric = Number(activeValue);
        const isSame = Number.isFinite(dbNumeric) && Number.isFinite(activeNumeric)
            ? Math.abs(dbNumeric - activeNumeric) <= 0.01
            : dbText === activeText;

        return (
            <div className="payroll-value-compare" title={`${activeText} | ${dbText}`}>
                <span className="payroll-value-compare__main">{renderedValue ?? '-'}</span>
                <span className={`payroll-value-compare__meta ${isSame ? 'is-match' : 'is-mismatch'}`}>
                    {activeText} | {dbText}
                </span>
            </div>
        );
    }, [valuePriorityMode]);

    const getHeaderStyle = useCallback((_label, level = 0) => {
        const rowPalette = ['#0f172a', '#1e293b', '#334155'];
        const bg = rowPalette[Math.min(level, rowPalette.length - 1)];
        return {
            backgroundColor: bg,
            color: '#f8fafc',
            borderBottom: '1px solid rgba(148, 163, 184, 0.25)',
            borderRight: '1px solid rgba(148, 163, 184, 0.15)',
            letterSpacing: level === 0 ? '0.02em' : '0em',
            textTransform: level === 0 ? 'uppercase' : 'none',
            fontWeight: level === 0 ? 700 : (level === 1 ? 600 : 500),
            fontSize: `${level === 0 ? responsiveMetrics.headerTopFontPx : responsiveMetrics.headerSubFontPx}px`,
            padding: `${responsiveMetrics.headerPadY}px ${responsiveMetrics.headerPadX}px`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        };
    }, [responsiveMetrics.headerPadX, responsiveMetrics.headerPadY, responsiveMetrics.headerSubFontPx, responsiveMetrics.headerTopFontPx]);
    const headerRows = useMemo(
        () => buildPayrollHeaderRows({ columnDefs: renderColumnDefs, getHeaderStyle }),
        [renderColumnDefs, getHeaderStyle]
    );

    const syncActiveChapter = useCallback((container = tableContainerRef.current) => {
        if (!chapterSegments.length) {
            setActiveChapterGroup(null);
            setChapterViewportWindow({ startRatio: 0, widthRatio: 1 });
            return;
        }

        if (displayMode === 'simple') {
            const nextGroup = activeChapterGroup || firstScrollableGroup || chapterSegments[0]?.group || null;
            setActiveChapterGroup((prev) => (prev === nextGroup ? prev : nextGroup));
            setChapterViewportWindow(getPayrollChapterWindowForGroup(chapterSegments, nextGroup));
            return;
        }

        if (!container) {
            const nextGroup = chapterSegments[0]?.group ?? null;
            setActiveChapterGroup((prev) => (prev === nextGroup ? prev : nextGroup));
            setChapterViewportWindow(getPayrollChapterWindowForGroup(chapterSegments, nextGroup));
            return;
        }

        const viewport = {
            scrollLeft: container.scrollLeft,
            clientWidth: container.clientWidth,
            stickyOffset: stickyPaneWidth
        };

        const nextGroup = detectActivePayrollChapter(chapterSegments, viewport);
        setActiveChapterGroup((prev) => (prev === nextGroup ? prev : nextGroup));
        setChapterViewportWindow(getPayrollViewportWindow(chapterSegments, viewport));
    }, [activeChapterGroup, chapterSegments, displayMode, firstScrollableGroup, stickyPaneWidth]);
    const syncTableContainerWidth = useCallback((container = tableContainerRef.current) => {
        if (!container) {
            setTableContainerWidth((prev) => {
                const fallback = getInitialViewportWidth();
                return prev === fallback ? prev : fallback;
            });
            return;
        }

        const nextWidth = Math.max(0, Math.round(Number(container.clientWidth) || 0));
        setTableContainerWidth((prev) => {
            if (Math.abs(prev - nextWidth) < 1) return prev;
            return nextWidth;
        });
    }, []);

    const syncHorizontalScrollState = useCallback((container = tableContainerRef.current) => {
        if (!container) {
            setTableHorizontalState({
                scrollLeft: 0,
                maxScrollLeft: 0,
                ratio: 0,
                viewportRatio: 1,
                canScroll: false
            });
            return;
        }

        const maxScrollLeft = Math.max((container.scrollWidth || 0) - (container.clientWidth || 0), 0);
        const scrollLeft = Math.max(0, Math.min(maxScrollLeft, container.scrollLeft || 0));
        const ratio = maxScrollLeft > 0 ? scrollLeft / maxScrollLeft : 0;
        const viewportRatio = container.scrollWidth > 0
            ? Math.min(1, Math.max((container.clientWidth || 0) / container.scrollWidth, 0.06))
            : 1;

        setTableHorizontalState((prev) => {
            if (
                prev.maxScrollLeft === maxScrollLeft &&
                prev.scrollLeft === scrollLeft &&
                Math.abs(prev.ratio - ratio) < 0.0008 &&
                Math.abs(prev.viewportRatio - viewportRatio) < 0.0008 &&
                prev.canScroll === (maxScrollLeft > 8)
            ) {
                return prev;
            }

            return {
                scrollLeft,
                maxScrollLeft,
                ratio,
                viewportRatio,
                canScroll: maxScrollLeft > 8
            };
        });
    }, []);

    const handleHorizontalSliderChange = useCallback((nextRatio) => {
        const container = tableContainerRef.current;
        if (!container) return;

        const maxScrollLeft = Math.max((container.scrollWidth || 0) - (container.clientWidth || 0), 0);
        if (maxScrollLeft <= 0) {
            return;
        }

        const ratio = Math.max(0, Math.min(1, Number(nextRatio) || 0));
        const nextLeft = Math.round(maxScrollLeft * ratio);
        pauseAutoFocusUntilRef.current = Date.now() + 180;
        container.scrollLeft = nextLeft;
        setChapterBarVisible(true);
    }, []);

    const handleHorizontalSliderDragStateChange = useCallback((isDragging) => {
        isHorizontalSliderDraggingRef.current = Boolean(isDragging);
        if (!isDragging) {
            pauseAutoFocusUntilRef.current = Date.now() + 120;
            if (displayMode === 'detail') {
                syncActiveChapter();
            }
        }
    }, [displayMode, syncActiveChapter]);

    const scrollToChapterGroup = useCallback((group) => {
        const container = tableContainerRef.current;
        const normalizedGroup = normalizePayrollHeaderGroup(group) || group;
        if (!normalizedGroup) return;

        setActiveChapterGroup(normalizedGroup);
        setChapterViewportWindow(getPayrollChapterWindowForGroup(chapterSegments, normalizedGroup));

        if (displayMode === 'simple') {
            return;
        }

        if (!container) {
            return;
        }

        const chapterStart = getPayrollChapterScrollLeft(chapterSegments, normalizedGroup);
        const left = Math.max(0, chapterStart - stickyPaneWidth);
        container.scrollTo({ left, behavior: 'smooth' });
        setChapterViewportWindow(getPayrollViewportWindow(chapterSegments, {
            scrollLeft: left,
            clientWidth: container.clientWidth,
            stickyOffset: stickyPaneWidth
        }));
    }, [chapterSegments, displayMode, stickyPaneWidth]);

    const handleStepChapter = useCallback((direction) => {
        if (!chapterSegments.length) return;
        const currentIndex = Math.max(0, chapterSegments.findIndex((chapter) => chapter.group === focusedGroup));
        const nextIndex = direction === 'left'
            ? Math.max(0, currentIndex - 1)
            : Math.min(chapterSegments.length - 1, currentIndex + 1);

        const targetGroup = chapterSegments[nextIndex]?.group;
        if (targetGroup) {
            scrollToChapterGroup(targetGroup);
        }
    }, [chapterSegments, focusedGroup, scrollToChapterGroup]);

    const syncActiveGangMarker = useCallback((container = tableContainerRef.current) => {
        if (!container) return;

        const headerRowsCount = Math.max(headerRows.length, 1);
        const markerTop = headerRowsCount * rowHeight;
        const gangHeaders = Array.from(container.querySelectorAll('.gang-header-row'));
        let nextGang = null;

        for (const header of gangHeaders) {
            const rect = header.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (rect.top - containerRect.top <= markerTop + 8) {
                nextGang = header.getAttribute('data-gang-code') || nextGang;
            } else {
                break;
            }
        }

        setActiveGangCode((prev) => (prev === nextGang ? prev : nextGang));
    }, [headerRows.length, rowHeight]);

    useEffect(() => {
        syncActiveChapter();
    }, [syncActiveChapter]);

    useEffect(() => {
        if (!activeChapterGroup && firstScrollableGroup) {
            setActiveChapterGroup(firstScrollableGroup);
        }
    }, [activeChapterGroup, firstScrollableGroup]);

    useEffect(() => {
        setSelection([]);
        setSelectionStats(null);
    }, [displayMode, focusedGroup]);

    useEffect(() => {
        const container = tableContainerRef.current;
        if (!container) return undefined;
        let lastScrollLeft = container.scrollLeft;
        syncTableContainerWidth(container);
        syncHorizontalScrollState(container);
        syncActiveGangMarker(container);

        const handleScroll = () => {
            const nextScrollLeft = container.scrollLeft;
            const didScrollHorizontally = nextScrollLeft !== lastScrollLeft;
            lastScrollLeft = nextScrollLeft;
            if (scrollSyncRafRef.current) return;

            scrollSyncRafRef.current = window.requestAnimationFrame(() => {
                scrollSyncRafRef.current = 0;
                syncActiveGangMarker(container);

                if (didScrollHorizontally) {
                    setChapterBarVisible(true);
                    syncHorizontalScrollState(container);

                    const shouldAutoFocusChapter =
                        displayMode === 'detail' &&
                        !isHorizontalSliderDraggingRef.current &&
                        Date.now() >= pauseAutoFocusUntilRef.current;

                    if (shouldAutoFocusChapter) {
                        syncActiveChapter(container);
                    }
                }
            });
        };

        container.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (scrollSyncRafRef.current) {
                window.cancelAnimationFrame(scrollSyncRafRef.current);
                scrollSyncRafRef.current = 0;
            }
            if (chapterBarHideTimerRef.current) {
                clearTimeout(chapterBarHideTimerRef.current);
            }
        };
    }, [displayMode, syncActiveChapter, syncActiveGangMarker, syncHorizontalScrollState, syncTableContainerWidth]);

    useEffect(() => {
        syncTableContainerWidth();
        syncHorizontalScrollState();
        syncActiveGangMarker();
    }, [displayRows.length, renderColumnDefs.length, displayMode, syncActiveGangMarker, syncHorizontalScrollState, syncTableContainerWidth]);

    useEffect(() => {
        const onResize = () => {
            syncTableContainerWidth();
            syncHorizontalScrollState();
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [syncHorizontalScrollState, syncTableContainerWidth]);

    useEffect(() => {
        const container = tableContainerRef.current;
        const table = tableRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return undefined;

        const observer = new ResizeObserver(() => {
            syncTableContainerWidth(container);
            syncHorizontalScrollState(container);
        });
        observer.observe(container);
        if (table) observer.observe(table);

        return () => observer.disconnect();
    }, [syncHorizontalScrollState, syncTableContainerWidth, displayMode, renderColumnDefs.length, displayRows.length]);

    // === EXPORT TO EXCEL HANDLER (with ALL columns including conditional ones) ===
    const handleExportToExcel = useCallback(async () => {
        if (displayRows.length === 0) {
            alert('Tidak ada data untuk di-export');
            return null;
        }
        try {
            // Use columnDefs yang ada (sudah mencakup semua kolom yang visible)
            // Export akan menyertakan semua field yang ada di rows data
            // PENTING: Gunakan displayRows yang sudah ter-sortir, bukan rows asli
            const fileName = await exportPayrollToExcel(displayRows, columnDefs, grandTotal, {
                division,
                gangCode,
                month,
                year,
                valuePriorityMode: normalizeValuePriorityMode(valuePriorityMode),
                preferRowGrandTotals: true
            });
            return fileName;
        } catch (err) {
            console.error('Export error:', err);
            alert('Gagal export ke Excel: ' + err.message);
            return null;
        }
    }, [displayRows, columnDefs, grandTotal, division, gangCode, month, year, valuePriorityMode, hasPendingEdits]);

    // Expose export function to parent
    useEffect(() => {
        if (onExportReady) {
            // [FIX] Must wrap in arrow function because onExportReady is a useState setter (setExportHandler).
            // Passing a function directly to useState setter causes React to execute it (functional update).
            // We want to STORE the function, not execute it.
            onExportReady(() => handleExportToExcel);
        }
    }, [onExportReady, handleExportToExcel]);

    // Expose table data getter for Tax Export to parent
    useEffect(() => {
        if (onTaxExportReady) {
            onTaxExportReady(() => () => displayRows);
        }
    }, [displayRows, onTaxExportReady]);

    useEffect(() => {
        if (onRowsGetterReady) {
            onRowsGetterReady(() => displayRows);
        }
    }, [displayRows, onRowsGetterReady]);
    const cellGroupStyles = useMemo(() => {
        const styles = {};
        Object.entries(cellColors || {}).forEach(([group, colors]) => {
            if (!colors) return;
            styles[group] = {
                backgroundColor: colors.bg,
                color: colors.text
            };
        });
        styles[PANEN] = {
            backgroundColor: '#f1f5f9',
            color: '#64748b'
        };
        styles[UPAH_KOTOR] = {
            backgroundColor: '#ecfdf5',
            color: '#166534'
        };
        return styles;
    }, [cellColors]);

    // Helper to get body cell inline style from cookie preferences.
    const getCellGroupStyle = useCallback((group) => {
        if (!group) return EMPTY_CELL_STYLE;
        return cellGroupStyles[group] || EMPTY_CELL_STYLE;
    }, [cellGroupStyles]);

    // Selection Logic - supports Ctrl+Click for multi-select
    const handleMouseDown = (e, rowIndex, colIndex, rowId) => {
        const cellKey = `${rowIndex}-${colIndex}`;

        if (e.ctrlKey || e.metaKey) {
            // Ctrl+Click: Toggle this cell in selection
            setSelection(prev => {
                const exists = prev.some(s => s.r === rowIndex && s.c === colIndex);
                if (exists) {
                    return prev.filter(s => !(s.r === rowIndex && s.c === colIndex));
                } else {
                    return [...prev, { r: rowIndex, c: colIndex }];
                }
            });
        } else {
            // Normal click: Start new selection range
            setIsSelecting(true);
            setSelection([{ r: rowIndex, c: colIndex }]);
            setHighlightedRowId(rowId);
        }
    };

    const handleMouseOver = (rowIndex, colIndex) => {
        if (isSelecting && selection.length > 0) {
            // Extend selection range from first cell to current
            const start = selection[0];
            const newSelection = [];
            const minR = Math.min(start.r, rowIndex), maxR = Math.max(start.r, rowIndex);
            const minC = Math.min(start.c, colIndex), maxC = Math.max(start.c, colIndex);
            for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) {
                    newSelection.push({ r, c });
                }
            }
            setSelection(newSelection);
        }
    };

    const handleMouseUp = () => { setIsSelecting(false); calculateSelectionStats(); };

    const calculateSelectionStats = useCallback(() => {
        if (!selection || selection.length === 0) { setSelectionStats(null); return; }
        const values = [];
        selection.forEach(({ r, c }) => {
            const row = displayRows[r];
            if (!row || row.type === 'gang_header') return;
            const col = renderColumnDefs[c];
            if (col) {
                const val = parseFloat(row[col.field]);
                if (!isNaN(val)) values.push(val);
            }
        });
        if (values.length > 0) {
            const sum = values.reduce((a, b) => a + b, 0);
            setSelectionStats({ count: values.length, sum, avg: sum / values.length, min: Math.min(...values), max: Math.max(...values) });
        } else { setSelectionStats(null); }
    }, [selection, displayRows, renderColumnDefs]);

    const selectedCellKeys = useMemo(
        () => new Set(selection.map((item) => `${item.r}-${item.c}`)),
        [selection]
    );

    const isCellSelected = useCallback((r, c) => {
        return selectedCellKeys.has(`${r}-${c}`);
    }, [selectedCellKeys]);

    const handleContextMenu = (e, row) => {
        e.preventDefault();
        if (row.type !== 'employee') return;
        setContextMenu({
            x: e.clientX, y: e.clientY,
            options: [
                { label: '📋 Lihat Detail Activity', action: () => onViewEmployeeDetail?.(row) },
                { label: '👤 Lihat Profil HR (Manajemen)', action: () => onOpenHrProfile?.(row) },
                'separator',
                { label: 'Export Data', action: () => alert('Export not implemented') }
            ]
        });
    };

    if (loading) return (
        <LoadingScreen
            isLoading={true}
            message="Memuat Data Payroll..."
            gangCode={gangCode}
            month={month}
            year={year}
            steps={[
                { name: 'Mengambil data dari server', duration: 2000 },
                { name: 'Memproses data karyawan', duration: 2000 },
                { name: 'Menghitung total gang', duration: 1500 },
                { name: 'Menyiapkan tampilan', duration: 1500 }
            ]}
        />
    );

    // Show main table if we have stream data OR legacy data
    // This allows progressive rendering - table appears as soon as first gang arrives
    if (shouldShowTable) {
        // Continue to render table below
    }
    // Show "Belum Tersedia" ONLY when:
    // 1. Loading is complete (loading = false)
    // 2. Data has been fetched (dataReady = true)
    // 3. But no rows returned (displayRows.length = 0)
    // This means: data was fetched but genuinely empty, not still loading
    else if (!loading && dataReady && displayRows.length === 0) {
        const MONTHS_LABEL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        // Error state with retry button
        if (error) {
            return (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', minHeight: '400px', padding: '40px',
                    background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)'
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', padding: '48px', textAlign: 'center',
                        border: '2px solid #fecaca', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                        maxWidth: '600px', width: '100%'
                    }}>
                        <div style={{ fontSize: '4rem', marginBottom: '16px' }}>❌</div>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#dc2626', margin: '0 0 8px' }}>
                            Gagal Memuat Data
                        </h3>
                        <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: '1.6', margin: '0 0 20px' }}>
                            {error}
                        </p>
                        <div style={{
                            background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px',
                            padding: '12px 16px', fontSize: '0.85rem', color: '#92400e',
                            display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
                            marginBottom: '20px'
                        }}>
                            <span>💡</span>
                            <span>Tekan tombol <strong>Refresh</strong> atau coba beberapa saat lagi.</span>
                        </div>
                        <button
                            onClick={() => {
                                console.log('[CustomPayrollTable] 🔄 Retry triggered');
                                onRefresh?.();
                            }}
                            style={{
                                padding: '10px 24px', background: '#dc2626', color: 'white',
                                border: 'none', borderRadius: '8px', cursor: 'pointer',
                                fontWeight: '700', fontSize: '0.95rem'
                            }}
                        >
                            🔄 Coba Lagi
                        </button>
                    </div>
                </div>
            );
        }

        // Data not available / not generated state
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100%', minHeight: '400px', padding: '40px',
                background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)'
            }}>
                <div style={{
                    background: 'white', borderRadius: '16px', padding: '48px', textAlign: 'center',
                    border: '2px dashed #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                    maxWidth: '600px', width: '100%'
                }}>
                    <div style={{ fontSize: '4rem', marginBottom: '16px' }}>📭</div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#1e293b', margin: '0 0 8px' }}>
                        Data Belum Tersedia
                    </h3>
                    <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: '1.6', margin: '0 0 20px' }}>
                        Data daftar upah untuk <strong>{gangCode === 'ALL' ? 'Semua Gang' : gangCode}</strong>
                        {division && <span> di divisi <strong>{division}</strong></span>}
                        {' '}pada periode <strong>{MONTHS_LABEL[(month || 1) - 1]} {year}</strong> belum tersedia atau belum digenerate.
                    </p>
                    <div style={{
                        background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px',
                        padding: '12px 16px', fontSize: '0.85rem', color: '#92400e',
                        display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
                        marginBottom: '20px'
                    }}>
                        <span>💡</span>
                        <span>Pastikan data payroll sudah di-seed untuk periode ini. Coba gunakan tombol <strong>Refresh</strong> atau pilih periode/divisi lain.</span>
                    </div>
                    <button
                        onClick={() => {
                            console.log('[CustomPayrollTable] 🔄 Refresh button clicked');
                            onRefresh?.();
                        }}
                        style={{
                            padding: '10px 24px', background: '#1e3a8a', color: 'white',
                            border: 'none', borderRadius: '8px', cursor: 'pointer',
                            fontWeight: '700', fontSize: '0.95rem'
                        }}
                    >
                        🔄 Refresh / Muat Ulang
                    </button>
                </div>
            </div>
        );
    }

    const activeBottomSafeArea = displayMode === 'detail'
        ? responsiveMetrics.detailBottomSafeArea
        : responsiveMetrics.simpleBottomSafeArea;
    const shellGrandTotalOffset = Math.round(clampNumber(50 * responsiveMetrics.dockScale, 40, 64));
    const tableGrandTotalOffset = Math.round(clampNumber(36 * responsiveMetrics.dockScale, 30, 52));

    const togglePortalTarget = document.getElementById('column-toggles-portal');
    const togglesElement = togglePortalTarget ? createPortal(
        <div style={payrollResponsiveVars}>
            <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>
            <div style={{ padding: '4px 8px', fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b' }}>TAMPILAN TABEL</div>
            <div style={{ padding: '6px 8px 8px' }}>
                <PayrollViewModeToolbar
                    mode={displayMode}
                    focusLens={focusLensEnabled}
                    taxExpanded={isTaxExpanded}
                    valuePriorityMode={valuePriorityMode}
                    isSeedingAutoBuffer={isSeedingAutoBuffer}
                    onModeChange={setDisplayMode}
                    onFocusLensChange={setFocusLensEnabled}
                    onValuePriorityModeChange={(nextMode) => setValuePriorityMode(normalizeValuePriorityMode(nextMode))}
                    onSeedAutoBuffer={handleSeedAutoBufferToManualAdjustment}
                    onToggleTax={() => toggleGroup('PAJAK')}
                />
            </div>
            {false && [
                { label: 'Pajak (PPH21)', state: isTaxExpanded, toggle: () => toggleGroup('PAJAK') }
            ].map(item => (
                <button
                    key={item.label}
                    onClick={(e) => { e.stopPropagation(); item.toggle(); }}
                    style={{
                        width: '100%',
                        textAlign: 'left', padding: '0.4rem 0.5rem', borderRadius: '4px', border: 'none',
                        background: item.state ? '#eff6ff' : 'transparent',
                        color: item.state ? '#1e3a8a' : '#475569',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        fontSize: '0.8rem'
                    }}
                >
                    <span>{item.label}</span>
                    <span>{item.state ? '✅' : '☐'}</span>
                </button>
            ))}
        </div>,
        togglePortalTarget
    ) : null;

    return (
        <div
            className={`payroll-table-shell mode-${displayMode} ${focusLensEnabled ? 'focus-lens-on' : 'focus-lens-off'}`}
            onMouseUp={handleMouseUp}
            style={{ 
                height: 'calc(100vh - 120px)', 
                minHeight: '400px',
                ...payrollResponsiveVars,
                '--payroll-bottom-safe-area': `${activeBottomSafeArea}px`,
                '--payroll-grand-total-offset': `${shellGrandTotalOffset}px`
            }}
        >
            {togglesElement}
            <div
                className="payroll-table-container"
                ref={tableContainerRef}
                style={{
                    ...payrollResponsiveVars,
                    fontSize: `${responsiveMetrics.tableFontPx}px`,
                    '--payroll-bottom-safe-area': `${activeBottomSafeArea}px`,
                    '--payroll-grand-total-offset': `${tableGrandTotalOffset}px`
                }}
            >
            {activeGangCode && (
                <div
                    className="gang-floating-marker"
                    style={{ top: headerRows.length * rowHeight }}
                    aria-live="polite"
                >
                    <span className="gang-leaf-orbit" aria-hidden="true">
                        <span className="gang-leaf-orbit__leaf" />
                    </span>
                    <span className="gang-floating-marker__label">Gang</span>
                    <strong>{activeGangCode}</strong>
                </div>
            )}
            {/* Loading / Streaming Progress Bar - Sticky Header */}
            {(loading || (effectiveProgress?.stage && effectiveProgress.stage !== 'complete')) && (
                <div style={{
                    position: 'sticky',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 1001,
                    backgroundColor: '#ffffff',
                    borderBottom: '2px solid #e5e7eb',
                    padding: '7px 20px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                }}>
                    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                        {/* Top row: icon + message + stats */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    width: '16px',
                                    height: '16px',
                                    border: '2px solid #e5e7eb',
                                    borderTop: '2px solid #3b82f6',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite',
                                    flexShrink: 0
                                }} />
                                <div>
                                    <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '12px' }}>
                                        {effectiveProgress?.stage === 'connecting' ? 'Menghubungi server...' :
                                         effectiveProgress?.stage === 'querying' ? 'Memproses query database...' :
                                         effectiveProgress?.stage === 'streaming' ? 'Streaming data...' :
                                         effectiveProgress?.message || 'Memproses data...'}
                                    </span>
                                    {effectiveProgress?.stage === 'streaming' && streamEnabled && (
                                        <span style={{ marginLeft: '8px', fontSize: '11px', color: '#10b981', fontWeight: 500 }}>
                                            ⚡ Streaming aktif
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                {effectiveProgress?.totalGangs > 0 && (
                                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
                                        {effectiveProgress.processedGangs}/{effectiveProgress.totalGangs} gang
                                        {' • '}
                                        {effectiveProgress.processedEmployees}/{effectiveProgress.totalEmployees} karyawan
                                    </span>
                                )}
                                {effectiveProgress?.bytesReceived > 0 && (
                                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>
                                        {formatBytes(effectiveProgress.bytesReceived)}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Progress bar */}
                        <div style={{
                            width: '100%',
                            height: '4px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '2px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                height: '100%',
                                width: effectiveProgress?.totalGangs > 0
                                    ? `${(effectiveProgress.processedGangs / effectiveProgress.totalGangs) * 100}%`
                                    : '100%',
                                backgroundColor: effectiveProgress?.stage === 'querying' ? '#f59e0b' :
                                                effectiveProgress?.stage === 'streaming' ? '#10b981' :
                                                effectiveProgress?.stage === 'connecting' ? '#3b82f6' : '#10b981',
                                transition: 'width 0.3s ease',
                                borderRadius: '2px'
                            }} />
                        </div>

                        {/* Gang name indicator during streaming */}
                        {effectiveProgress?.stage === 'streaming' && stream.gangs?.length > 0 && (
                            <div style={{
                                marginTop: '5px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                flexWrap: 'wrap'
                            }}>
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>Gang:</span>
                                {stream.gangs.slice(-Math.min(8, stream.gangs.length)).map((g, i) => (
                                    <span key={g.gang_code} style={{
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        backgroundColor: '#f1f5f9',
                                        color: '#475569',
                                        fontWeight: 500
                                    }}>
                                        {g.gang_code} ({g.employees?.length || 0})
                                    </span>
                                ))}
                                {stream.gangs.length > 8 && (
                                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                        +{stream.gangs.length - 8} gang lagi...
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Mode Save Banner */}
            {isEditMode && (
                <div className={`payroll-edit-save-dock ${hasPendingEdits ? 'has-pending' : ''}`}>
                    <div className="payroll-edit-save-dock__copy">
                        <span className="payroll-edit-save-dock__eyebrow">Mode Edit Aktif</span>
                        <strong>{hasPendingEdits ? `${pendingSaveSummary.totalCount} perubahan belum disimpan` : 'Siap menerima perubahan'}</strong>
                    </div>

                    <div className="payroll-edit-save-dock__metrics" aria-label="Ringkasan perubahan">
                        <span className="payroll-edit-save-dock__metric">Manual/Profile <b>{pendingSaveSummary.manualCount}</b></span>
                        <span className="payroll-edit-save-dock__metric">KONTAN <b>{pendingSaveSummary.kontanCount}</b></span>
                        <span className="payroll-edit-save-dock__metric">Bonus/THR <b>{pendingSaveSummary.pendapatanCount}</b></span>
                        <span className="payroll-edit-save-dock__metric">Kolom Baru <b>{pendingSaveSummary.addedColumnCount}</b></span>
                        {pendingSaveSummary.deleteCount > 0 && (
                            <span className="payroll-edit-save-dock__metric is-danger">Hapus <b>{pendingSaveSummary.deleteCount}</b></span>
                        )}
                    </div>

                    <div className="payroll-edit-save-dock__actions">
                        <button
                            type="button"
                            className="payroll-edit-save-dock__primary"
                            onClick={handleSaveAllEdits}
                            disabled={isSavingEdits || !hasPendingEdits}
                        >
                            {isSavingEdits ? 'Menyimpan...' : `Simpan Semua Perubahan${hasPendingEdits ? ` (${pendingSaveSummary.totalCount})` : ''}`}
                        </button>
                        <button
                            type="button"
                            className="payroll-edit-save-dock__secondary"
                            onClick={() => openPayrollConfirm({
                                title: 'Batalkan semua perubahan?',
                                message: 'Semua edit manual, KONTAN, Bonus/THR, dan kolom baru yang belum disimpan akan dikosongkan dari layar.',
                                confirmText: 'Batal Semua',
                                variant: 'danger',
                                onConfirm: () => {
                                    setEditedCells({});
                                    setAddedColumns([]);
                                    setEditedKontanCells({});
                                    setEditedPendapatanCells({});
                                    onRefresh?.();
                                    showPayrollToast('info', 'Perubahan dibatalkan', 'Semua perubahan yang belum disimpan sudah dikosongkan.');
                                }
                            })}
                            disabled={isSavingEdits || !hasPendingEdits}
                        >
                            Batal Semua
                        </button>
                    </div>
                </div>
            )}

            <table className="payroll-table" ref={tableRef}>
                <thead>
                    {headerRows.map((hRow, rIdx) => (
                        <tr key={`hr-${rIdx}`}>
                            {hRow.map((cell, cIdx) => (
                                <th
                                    key={`hc-${rIdx}-${cIdx}`}
                                    colSpan={cell.colSpan}
                                    rowSpan={cell.rowSpan}
                                    className={`sticky-header ${cell.isSticky ? 'sticky-corner' : ''} ${cell.headerGroup ? `header-group-${cell.headerGroup.toLowerCase().replace(/\s+/g, '-')}` : ''}`}
                                    style={{
                                        top: rIdx * rowHeight,
                                        left: cell.left,
                                        height: cell.rowSpan * rowHeight,
                                        cursor: cell.sortable ? 'pointer' : 'default',
                                        ...cell.headerStyle
                                    }}
                                    data-header-level={cell.level}
                                    data-active-group={cell.headerGroup && focusedGroup ? String(cell.headerGroup === focusedGroup) : undefined}
                                    data-focus-dim={focusLensEnabled && cell.headerGroup && focusedGroup ? String(cell.headerGroup !== focusedGroup) : undefined}
                                    data-field={cell.field}
                                    onClick={() => cell.sortable && onSortChange && onSortChange(cell.field)}
                                >
                                    {cell.label === 'JABATAN' ? (
                                        <div className="flex items-center justify-center gap-1">
                                            <span>JABATAN</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleBulkSave(); }}
                                                className="text-xs bg-gray-200 hover:bg-gray-300 rounded px-1 pb-0.5 border border-gray-400"
                                                title="Simpan semua jabatan ke database"
                                            >
                                                💾
                                            </button>
                                        </div>
                                    ) : cell.label === '%TOGGLE_JUMLAH%' ? (
                                        <div className="flex flex-col items-center justify-center gap-0.5 w-full h-full">
                                            <span>JUMLAH</span>
                                            <div
                                                className={`cursor-pointer select-none text-[9px] px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors ${tunjanganMode === 'CALC' ? 'bg-green-100 text-green-700 font-bold' : 'bg-transparent text-gray-400 hover:bg-gray-100'}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setTunjanganMode(prev => prev === 'DB' ? 'CALC' : 'DB');
                                                }}
                                                title="Switch Mode: DB Actual vs Calculated Guidance"
                                            >
                                                {tunjanganMode === 'CALC' ? 'GUIDE' : 'DB'}
                                            </div>
                                        </div>
                                    ) : cell.isCheckboxHeader ? (
                                        <div className="flex items-center justify-center h-full w-full">
                                            <input
                                                type="checkbox"
                                                checked={Array.isArray(selectedEmployees) && Array.isArray(allEmployeeNiks) && allEmployeeNiks.length > 0 && selectedEmployees.length === allEmployeeNiks.length}
                                                ref={input => {
                                                    if (input && Array.isArray(selectedEmployees) && Array.isArray(allEmployeeNiks)) {
                                                        input.indeterminate = selectedEmployees.length > 0 && selectedEmployees.length < allEmployeeNiks.length;
                                                    }
                                                }}
                                                onChange={(e) => handleSelectAll(e)}
                                                className="w-4 h-4 cursor-pointer"
                                            />
                                        </div>
                                    ) : (
                                        <div
                                            className={`flex items-center justify-center gap-1 h-full w-full relative group ${cell.level === 0 && isPayrollGroupToggleable(cell.label) ? 'cursor-pointer hover:bg-white/10 transition-colors select-none' : ''}`}
                                            style={{ textAlign: 'center', lineHeight: '1.2' }}
                                            onClick={(e) => {
                                                if (!(cell.level === 0 && isPayrollGroupToggleable(cell.label))) return;
                                                e.stopPropagation();
                                                toggleGroup(cell.label);
                                            }}
                                            title={cell.level === 0 && isPayrollGroupToggleable(cell.label) ? 'Klik untuk melihat/menyembunyikan detail' : undefined}
                                        >
                                            <div>{formatHeaderLabel(cell.label)}</div>
                                            {isEditMode && cell.field && resolveManualColumnDefinition(cell.field) && (
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleRemoveManualColumn(cell.field);
                                                    }}
                                                    title="Hapus kolom manual adjustment ini"
                                                    style={{
                                                        border: 0,
                                                        background: '#dc2626',
                                                        color: '#fff',
                                                        borderRadius: 999,
                                                        width: 16,
                                                        height: 16,
                                                        lineHeight: '16px',
                                                        fontSize: 11,
                                                        fontWeight: 900,
                                                        cursor: 'pointer',
                                                        padding: 0,
                                                        marginLeft: 4
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            )}
                                            {isEditMode && cell.field && (() => {
                                                const colDef = resolveManualColumnDefinition(cell.field);
                                                if (!colDef || colDef.type !== 'PREMI') return null;
                                                return (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setConvertTypeModal({ isOpen: true, fromField: cell.field, fromName: colDef.name });
                                                        }}
                                                        title="Ubah jenis premi ini"
                                                        style={{
                                                            border: 0,
                                                            background: '#2563eb',
                                                            color: '#fff',
                                                            borderRadius: 999,
                                                            width: 16,
                                                            height: 16,
                                                            lineHeight: '16px',
                                                            fontSize: 11,
                                                            fontWeight: 900,
                                                            cursor: 'pointer',
                                                            padding: 0,
                                                            marginLeft: 4
                                                        }}
                                                    >
                                                        ↻
                                                    </button>
                                                );
                                            })()}
                                            {cell.level === 0 && isPayrollGroupToggleable(cell.label) && (
                                                <span style={{ fontSize: '10px', marginLeft: '4px' }}>
                                                    {getGroupExpandedState(cell.label) ? '▼' : '▶'}
                                                </span>
                                            )}

                                            {/* Sort Indicators */}
                                            {cell.sortable && (
                                                <span style={{ fontSize: '10px', color: sortBy === cell.field ? '#fff' : 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>
                                                    {sortBy === cell.field ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}
                                                </span>
                                            )}

                                            {/* Add Columns Button in Edit Mode */}
                                            {isEditMode && cell.topHeader === PREMI && cell.label === 'TOTAL PREMI' && (
                                                <button onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAddColumn(PREMI);
                                                    }}
                                                    style={{ marginLeft: 6, opacity: 0.9, background: '#f59e0b', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    title="Tambah kolom premi baru"
                                                >
                                                    +
                                                </button>
                                            )}
                                            {isEditMode && cell.level === 0 && cell.label === POTONGAN_UPAH_KOTOR && (
                                                <button onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAddColumn(POTONGAN_UPAH_KOTOR);
                                                    }}
                                                    style={{ marginLeft: 6, opacity: 0.9, background: '#f59e0b', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    title="Tambah kolom potongan kotor baru"
                                                >
                                                    +
                                                </button>
                                            )}
                                            {isEditMode && cell.level === 0 && cell.label === POTONGAN_UPAH_BERSIH && (
                                                <button onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleAddColumn(POTONGAN_UPAH_BERSIH);
                                                    }}
                                                    style={{ marginLeft: 6, opacity: 0.9, background: '#f59e0b', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    title="Tambah kolom potongan bersih baru"
                                                >
                                                    +
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {displayRows.map((row, rIdx) => {
                        if (row.type === 'gang_header') {
                            return (
                                <tr key={row.id} className="gang-header-row" data-gang-code={row.gang_code}>
                                    <td
                                        colSpan={renderColumnDefs.length}
                                        style={{ top: headerRows.length * rowHeight }}
                                    >
                                        <div className="gang-header-banner">
                                            <span className="gang-leaf-orbit" aria-hidden="true">
                                                <span className="gang-leaf-orbit__leaf" />
                                            </span>
                                            <span className="gang-header-banner__eyebrow">GANG AKTIF</span>
                                            <strong className="gang-header-banner__code">{row.gang_code}</strong>
                                            <span className="gang-header-banner__rail" aria-hidden="true" />
                                        </div>
                                    </td>
                                </tr>
                            );
                        }
                        const isHighlight = highlightedRowId === row.id;
                        const rowClass = row.type === 'gang_total' ? 'gang-total-row' : (rIdx % 2 === 0 ? 'row-even' : 'row-odd');

                        return (
                            <tr
                                key={row.id}
                                className={`${rowClass} ${isHighlight ? 'row-highlighted' : ''}`}
                                onClick={() => setHighlightedRowId(row.id)}
                                onContextMenu={(e) => handleContextMenu(e, row)}
                                onDoubleClick={() => {
                                    if (row.type !== 'employee') return
                                    if (!onViewEmployeeDetail) {
                                        console.error('[CustomPayrollTable] onViewEmployeeDetail is not defined')
                                        return
                                    }
                                    onViewEmployeeDetail(row)
                                }}
                            >
                                {renderColumnDefs.map((col, cIdx) => {
                                    let displayVal = row[col.field];
                                    const isGangTotal = row.type === 'gang_total';

                                    // For gang total rows: if numeric field is undefined, treat as 0
                                    if (isGangTotal && displayVal === undefined) {
                                        if (isPayrollNumericField(col.field)) {
                                            displayVal = 0;
                                        }
                                    }

                                    if (typeof displayVal === 'number' && isSignedPayrollDeductionField(col.field)) {
                                        displayVal = formatNegativeTotalNumber(displayVal);
                                    } else if (typeof displayVal === 'number') {
                                        displayVal = col.field === 'lembur_jam' ? formatDecimal(displayVal) : formatNumber(displayVal);
                                    }
                                    const selected = isCellSelected(rIdx, cIdx);

                                    // Build group class + inline color for body cells
                                    const groupClass = col.group ? `cell-group-${col.group.toLowerCase().replace(/\s+/g, '-')}` : '';
                                    const cellGroupInline = getCellGroupStyle(col.group);
                                    const syncFrameColor = row?.value_sync_frame?.[col.field];
                                    const syncFrameClass = syncFrameColor === 'red'
                                        ? 'cell-sync-red'
                                        : syncFrameColor === 'green'
                                            ? 'cell-sync-green'
                                            : '';

                                    if (col.render) {
                                        return (
                                            <td
                                                key={cIdx}
                                                className={`${col.className} ${selected ? 'cell-selected' : ''} ${groupClass} ${syncFrameClass}`}
                                                style={{ left: col.left, width: col.w, minWidth: col.w, ...cellGroupInline }}
                                                data-active-group={col.group && focusedGroup ? String(col.group === focusedGroup) : undefined}
                                                data-focus-dim={focusLensEnabled && col.group && focusedGroup ? String(col.group !== focusedGroup) : undefined}
                                                data-field={col.field}
                                                onMouseDown={(e) => { handleMouseDown(e, rIdx, cIdx, row.id); }}
                                                onMouseOver={() => handleMouseOver(rIdx, cIdx)}
                                            >
                                                {renderValueSourceComparison(row, col.field, col.render(row))}
                                            </td>
                                        );
                                    }

                                    return (
                                        <td
                                            key={cIdx}
                                            className={`${col.className} ${selected ? 'cell-selected' : ''} ${groupClass} ${syncFrameClass}`}
                                            style={{ left: col.left, width: col.w, minWidth: col.w, ...cellGroupInline }}
                                            data-active-group={col.group && focusedGroup ? String(col.group === focusedGroup) : undefined}
                                            data-focus-dim={focusLensEnabled && col.group && focusedGroup ? String(col.group !== focusedGroup) : undefined}
                                            data-field={col.field}
                                            onMouseDown={(e) => { handleMouseDown(e, rIdx, cIdx, row.id); }}
                                            onMouseOver={() => handleMouseOver(rIdx, cIdx)}
                                        >
                                            {renderValueSourceComparison(row, col.field, displayVal ?? '-')}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
                {grandTotal && (
                    <tfoot>
                        <tr className="grand-total-row">
                            {renderColumnDefs.map((col, cIdx) => {
                                let val = grandTotal[col.field];

                                // Special handling for specific columns
                                if (col.field === 'nama') val = 'GRAND TOTAL';
                                else if (col.field === 'no') val = '';
                                else if (col.field === 'emp_code') val = `${employeeRows.length} KARYAWAN`;
                                else if (isPayrollTotalDisplayOnlyField(col.field)) val = '-';
                                else if (isPayrollNumericField(col.field)) {
                                    const numericValue = resolveGrandTotalNumericValue({
                                        grandTotal,
                                        rows: displayRows,
                                        field: col.field,
                                        preferRows: true
                                    });
                                    val = isSignedPayrollDeductionField(col.field)
                                        ? formatNegativeTotalNumber(numericValue)
                                        : formatNumber(numericValue);
                                } else if (val !== undefined && val !== null && val !== '') {
                                    val = String(val);
                                } else {
                                    val = '-';
                                }

                                return (
                                    <td
                                        key={cIdx}
                                        className={col.className}
                                        style={{ left: col.left, width: col.w }}
                                        data-active-group={col.group && focusedGroup ? String(col.group === focusedGroup) : undefined}
                                        data-focus-dim={focusLensEnabled && col.group && focusedGroup ? String(col.group !== focusedGroup) : undefined}
                                    >
                                        {val ?? '-'}
                                    </td>
                                );
                            })}
                        </tr>
                    </tfoot>
                )}
            </table>
            {contextMenu && (
                <TableContextMenu x={contextMenu.x} y={contextMenu.y} options={contextMenu.options} onClose={() => setContextMenu(null)} />
            )}
            </div>
            {/* Render Footer OUTSIDE scrollable container so position:fixed works properly */}
            <PayrollScrollChapterBar
                activeGroup={focusedGroup || 'IDENTITAS'}
                allGroups={[...new Set(columnDefs.map(c => c.group).filter(Boolean))]}
                isVisible={!isEditMode && (displayMode === 'simple' ? true : isChapterBarVisible)}
                onSelectGroup={(group) => {
                    if (!group) return;
                    // Keep current mode; in simple mode this switches focused chapter directly.
                    scrollToChapterGroup(group);
                }}
                recentGangs={stream.gangs?.length > 0 ? stream.gangs : []}
                streamingStage={effectiveProgress?.stage}
                totalGangs={effectiveProgress?.totalGangs || 0}
                processedGangs={effectiveProgress?.processedGangs || 0}
                displayMode={displayMode}
                onToggleDisplayMode={() => setDisplayMode(displayMode === 'simple' ? 'detail' : 'simple')}
            />
            <SelectionStatusBar stats={selectionStats} />
            <ManualAdjustmentColumnModal
                isOpen={manualAdjustmentModal.isOpen}
                onClose={() => setManualAdjustmentModal({ isOpen: false, groupLabel: null, adjustmentType: 'PREMI' })}
                onSaved={handleManualAdjustmentSaved}
                token={token}
                division={division}
                initialAdjustmentType={manualAdjustmentModal.adjustmentType || 'PREMI'}
            />
            <ConvertPremiumTypeModal
                isOpen={convertTypeModal.isOpen}
                onClose={() => setConvertTypeModal({ isOpen: false })}
                onConverted={handlePremiumTypeConverted}
                token={token}
                month={month}
                year={year}
                division={division}
                isProdMode={isProdMode()}
                currentColumns={convertiblePremiumColumns}
            />
            <PremiumDetailPopup
                isOpen={premiumPopup.isOpen}
                onClose={() => setPremiumPopup(emptyPremiumPopup)}
                onSave={handlePremiumPopupSave}
                inputType={premiumPopup.inputType}
                definitionName={premiumPopup.definitionName}
                adjustmentType={premiumPopup.editBase?.type}
                defaultGangCode={premiumPopup.defaultGangCode || premiumPopup.editBase?.gang_code}
                initialData={premiumPopup.initialData}
                storedAmount={premiumPopup.storedAmount}
                mismatch={premiumPopup.mismatch}
                readOnly={premiumPopup.readOnly}
            />
            {payrollToast && (
                <div className={`payroll-toast payroll-toast--${payrollToast.type}`} role="status">
                    <div className="payroll-toast__rail" />
                    <div>
                        <strong>{payrollToast.title}</strong>
                        <p>{payrollToast.message}</p>
                    </div>
                    <button type="button" onClick={() => setPayrollToast(null)} aria-label="Tutup notifikasi">×</button>
                </div>
            )}
            {payrollConfirm && (
                <div className="payroll-confirm-backdrop" role="presentation">
                    <div className={`payroll-confirm-card payroll-confirm-card--${payrollConfirm.variant}`} role="dialog" aria-modal="true" aria-labelledby="payroll-confirm-title">
                        <div className="payroll-confirm-card__mark" />
                        <div className="payroll-confirm-card__body">
                            <span className="payroll-confirm-card__eyebrow">Konfirmasi Perubahan</span>
                            <h3 id="payroll-confirm-title">{payrollConfirm.title}</h3>
                            <p>{payrollConfirm.message}</p>
                        </div>
                        <div className="payroll-confirm-card__actions">
                            <button type="button" className="payroll-confirm-card__cancel" onClick={closePayrollConfirm}>
                                {payrollConfirm.cancelText}
                            </button>
                            <button
                                type="button"
                                className="payroll-confirm-card__confirm"
                                onClick={() => {
                                    const onConfirm = payrollConfirm.onConfirm;
                                    closePayrollConfirm();
                                    onConfirm?.();
                                }}
                            >
                                {payrollConfirm.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default CustomPayrollTable;
