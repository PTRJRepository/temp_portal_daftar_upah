# TODO TRACKING — BUG-DB-001: amount vs metadata_json mismatch

**Project:** PT Rebinmas Daftar Upah Portal
**Generated:** 2026-06-06
**Bug ID:** BUG-DB-001
**Total Tasks:** 8

---

## Task Summary

| # | Subject | Priority | Status | Blocked By | Blocking |
|---|---------|----------|--------|------------|----------|
| 1 | TODO-001: Backend — Expand sync dari whitelist nama ke whitelist input_type | HIGH | **COMPLETED** | — | 7, 8 |
| 2 | TODO-002: Backend — Validation metadata_json sebelum save | HIGH | **COMPLETED** | — | 7, 8 |
| 3 | TODO-003: Frontend — Expand auto-sync ke SEMUA input_type detail | HIGH | **COMPLETED** | — | 7, 8 |
| 4 | TODO-004: Frontend — Tampilkan warning diff untuk SEMUA detail types | MEDIUM | **COMPLETED** | — | — |
| 5 | TODO-005: SQL Audit — Jalankan 6 query untuk quantifikasi data mismatch | HIGH | **COMPLETED** | — | 6 |
| 6 | TODO-006: SQL Repair — Perbaiki data yang sudah mismatch | HIGH | **COMPLETED** | 5 | — |
| 7 | TODO-007: Unit Test — Test coverage untuk semua input_type | MEDIUM | **COMPLETED** | 1, 2, 3 | — |
| 8 | TODO-008: Frontend Test — Test auto-sync untuk non-whitelist premium | MEDIUM | **COMPLETED** | 1, 2, 3 | — |

---

## Task Details

### TODO-001: Backend — Expand sync dari whitelist nama ke whitelist input_type

**Priority:** HIGH
**Status:** pending
**File:** `backend/src/services/manualAdjustmentService.ts`
**Line:** ~458-478 (`resolveDetailTotalSync`)

**Task:**
- Hapus `DETAIL_TOTAL_SYNC_PREMI_NAMES` whitelist nama
- Ganti logic: jika `metadata.input_type !== 'amount'` → selalu sync amount = calculatedTotal
- Jika `calculatedTotal = 0` → tetap set amount = 0 (tidak fallback ke amount lama)

**Before:**
```typescript
const DETAIL_TOTAL_SYNC_PREMI_NAMES = new Set(["PREMI PRUNING", "PREMI RAKING", "PREMI TIKET"]);

function resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, fallbackAmount) {
    if (String(data.adjustment_type || "").trim().toUpperCase() !== "PREMI")
        return { amount: fallbackAmount, metadataJsonStr };
    if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName))
        return { amount: fallbackAmount, metadataJsonStr };
    // ...
}
```

**After (konsep):**
```typescript
function resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, fallbackAmount) {
    if (String(data.adjustment_type || "").trim().toUpperCase() !== "PREMI")
        return { amount: fallbackAmount, metadataJsonStr };

    const metadata = premiumDefinitionService.parseMetadata(metadataJsonStr);
    if (!metadata) return { amount: fallbackAmount, metadataJsonStr };
    if (metadata.input_type === 'amount') return { amount: fallbackAmount, metadataJsonStr };

    const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);
    if (Number.isFinite(calculatedTotal)) {
        return {
            amount: calculatedTotal,
            metadataJsonStr: JSON.stringify({ ...metadata, total_amount: calculatedTotal })
        };
    }
    return { amount: fallbackAmount, metadataJsonStr };
}
```

**Verification:**
- Run SQL Query A after fix → should return 0 rows for non-whitelist premium
- Test save PREMI JAGA with blok metadata → amount should = sum of items

---

### TODO-002: Backend — Validation metadata_json sebelum save

**Priority:** HIGH
**Status:** pending
**File:** `backend/src/services/manualAdjustmentService.ts`
**Line:** ~2164-2174 (di `saveAdjustment`, sebelum resolveDetailTotalSync call)

**Task:**
- Jika `metadataJsonStr` ada dan tidak null, validasi JSON parse
- Jika invalid → throw error, jangan simpan
- Jika valid tapi tidak ada `input_type` → throw error

**Code (konsep):**
```typescript
if (metadataJsonStr) {
    try {
        JSON.parse(metadataJsonStr); // validate
    } catch {
        throw new Error('metadata_json invalid: not valid JSON');
    }
    const parsedCheck = JSON.parse(metadataJsonStr);
    if (!parsedCheck?.input_type) {
        throw new Error('metadata_json invalid: missing input_type field');
    }
}
```

**Verification:**
- Send invalid JSON metadata → should return 400 error
- Send valid JSON but missing input_type → should return 400 error
- Send valid JSON with input_type → should save successfully

---

### TODO-003: Frontend — Expand auto-sync ke SEMUA input_type detail

**Priority:** HIGH
**Status:** pending
**File:** `frontend/src/components/PremiumDetailPopup.jsx`
**Line:** ~23, ~524-529

**Task:**
- Hapus `DETAIL_TOTAL_SYNC_DEFINITION_NAMES` whitelist nama
- Ganti `shouldAutoSyncDetailAmount` → `inputType !== 'amount'`

**Before (line 23):**
```javascript
const DETAIL_TOTAL_SYNC_DEFINITION_NAMES = new Set(['PREMI PRUNING', 'PREMI RAKING']);
```

**Before (line 524):**
```javascript
const shouldAutoSyncDetailAmount = inputType !== 'amount' && DETAIL_TOTAL_SYNC_DEFINITION_NAMES.has(normalizeDefinitionName(definitionName));
```

**After:**
```javascript
// Hapus constant DETAIL_TOTAL_SYNC_DEFINITION_NAMES
const shouldAutoSyncDetailAmount = inputType !== 'amount';
```

**Verification:**
- Open PREMI JAGA popup → shouldAutoSyncDetailAmount = true
- Open PREMI KINERJA popup → shouldAutoSyncDetailAmount = true
- Open PREMI RITASE popup → shouldAutoSyncDetailAmount = true
- amountToSave should = totalAmount for all detail types

---

### TODO-004: Frontend — Tampilkan warning diff untuk SEMUA detail types

**Priority:** MEDIUM
**Status:** pending
**File:** `frontend/src/components/PremiumDetailPopup.jsx`
**Line:** ~524-548

**Task:**
- `shouldShowAmountComparison` dan `visibleMismatch` saat ini hanya aktif jika `shouldAutoSyncDetailAmount`
- Ganti jadi: selalu tampilkan diff jika `inputType !== 'amount'` dan ada storedAmount

**Before:**
```javascript
const shouldShowAmountComparison = shouldAutoSyncDetailAmount && hasStoredAmountToCompare;
```

**After:**
```javascript
const shouldShowAmountComparison = inputType !== 'amount' && hasStoredAmountToCompare;
```

**Verification:**
- Open PREMI JAGA popup with existing amount ≠ totalAmount → should show diff panel
- Open PREMI KINERJA popup with existing amount ≠ totalAmount → should show diff panel

---

### TODO-005: SQL Audit — Jalankan 6 query untuk quantifikasi data mismatch

**Priority:** HIGH
**Status:** pending
**File:** Database `extend_db_ptrj`
**Blocked by:** —
**Blocking:** TODO-006

**Task:**
Jalankan 6 SQL query secara berurutan:

**Query A: Amount vs metadata_json.total_amount mismatch**
```sql
SELECT
    id,
    period_month,
    period_year,
    emp_code,
    gang_code,
    adjustment_type,
    adjustment_name,
    amount,
    TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS metadata_total,
    amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS diff,
    metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
  AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01
ORDER BY ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) DESC;
```

**Query B: Invalid JSON metadata**
```sql
SELECT
    id,
    period_month,
    period_year,
    emp_code,
    adjustment_name,
    metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(metadata_json AS JSON) IS NULL
ORDER BY period_year DESC, period_month DESC;
```

**Query C: Metadata punya items tapi total_amount null**
```sql
SELECT
    id,
    emp_code,
    adjustment_name,
    JSON_VALUE(metadata_json, '$.input_type') AS input_type,
    metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND JSON_VALUE(metadata_json, '$.input_type') IN ('blok', 'kendaraan', 'blok,exp')
  AND JSON_VALUE(metadata_json, '$.total_amount') IS NULL
ORDER BY period_year DESC, period_month DESC;
```

**Query D: Amount 0 tapi metadata_json.items punya jumlah > 0**
```sql
SELECT
    id,
    period_month,
    period_year,
    emp_code,
    adjustment_name,
    amount,
    JSON_QUERY(metadata_json, '$.items') AS items,
    JSON_VALUE(metadata_json, '$.total_amount') AS total_amount
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE amount = 0
  AND metadata_json IS NOT NULL
  AND JSON_VALUE(metadata_json, '$.input_type') IN ('blok', 'kendaraan', 'blok,exp')
ORDER BY period_year DESC, period_month DESC;
```

**Query E: Total_amount 0 tapi items punya jumlah**
```sql
SELECT
    id,
    emp_code,
    adjustment_name,
    JSON_VALUE(metadata_json, '$.total_amount') AS total_amount,
    JSON_QUERY(metadata_json, '$.items') AS items
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) = 0
  AND JSON_QUERY(metadata_json, '$.items') IS NOT NULL
ORDER BY period_year DESC, period_month DESC;
```

**Query F: Summary mismatch per adjustment_name**
```sql
SELECT
    adjustment_name,
    adjustment_type,
    COUNT(*) AS total_records,
    SUM(CASE
        WHEN ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01
        THEN 1 ELSE 0 END
    ) AS mismatch_count,
    SUM(CASE
        WHEN ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01
        THEN ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)))
        ELSE 0 END
    ) AS total_diff
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
  AND period_year >= 2025
GROUP BY adjustment_name, adjustment_type
HAVING SUM(CASE
    WHEN ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01
    THEN 1 ELSE 0 END) > 0
ORDER BY mismatch_count DESC;
```

**Output:** Laporan quantifikasi dengan jumlah record per query

---

### TODO-006: SQL Repair — Perbaiki data yang sudah mismatch

**Priority:** HIGH
**Status:** pending
**Blocked by:** TODO-005
**File:** Database `extend_db_ptrj`

**Task:**

**Step 1: Backup (WAJIB sebelum repair)**
```sql
SELECT *
INTO extend_db_ptrj.dbo.payroll_manual_adjustments_backup_20260606
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL;
-- Verifikasi backup: SELECT COUNT(*) FROM backup table
```

**Step 2: Dry-run repair (SELECT untuk preview)**
```sql
SELECT
    id,
    emp_code,
    adjustment_name,
    amount AS old_amount,
    TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS new_amount,
    metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
  AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01;
-- Hitung jumlah record sebelum execute
```

**Step 3: Execute repair**
```sql
UPDATE dbo.payroll_manual_adjustments
SET
    amount = TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)),
    updated_at = GETDATE(),
    updated_by = 'system_repair'
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
  AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01;
```

**Step 4: Verifikasi**
```sql
-- Jalankan ulang SQL Query A — harus return 0 rows
SELECT COUNT(*)
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
  AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01;
```

---

### TODO-007: Unit Test — Test coverage untuk semua input_type

**Priority:** MEDIUM
**Status:** pending
**Blocked by:** TODO-001, TODO-002, TODO-003
**File:** `backend/src/services/manualAdjustmentService.test.ts` (buat jika belum ada)

**Test Cases:**

1. **blok items sum**
   - Input: `{ input_type: "blok", items: [{subblok:"P1",gang_code:"B1",jumlah:1000},{subblok:"P2",gang_code:"B1",jumlah:2000}] }`
   - Expected: `calculateManualAdjustmentMetadataTotal()` = 3000

2. **exp jumlah**
   - Input: `{ input_type: "exp", expense_code: "LABOUR", jumlah: 5000 }`
   - Expected: `calculateManualAdjustmentMetadataTotal()` = 5000

3. **kendaraan items sum**
   - Input: `{ input_type: "kendaraan", items: [{nomor_kendaraan:"B1234",expense_code:"TRANSPORT",jumlah:3000}] }`
   - Expected: `calculateManualAdjustmentMetadataTotal()` = 3000

4. **blok,exp combo**
   - Input: `{ input_type: "blok,exp", blok_items: [{subblok:"P1",gang_code:"B1",jumlah:2000}], expense: {expense_code:"LABOUR",jumlah:1000} }`
   - Expected: `calculateManualAdjustmentMetadataTotal()` = 3000

5. **calculatedTotal = 0 (edge case)**
   - Input: `{ input_type: "blok", items: [] }`
   - Expected: `calculateManualAdjustmentMetadataTotal()` = 0

6. **invalid JSON metadata (should throw/reject)**
   - Input: `"{ invalid json }"`
   - Expected: `parseMetadata()` = null, saveAdjustment should throw

7. **amount-only edit clears metadata (edge case)**
   - Input: `{ amount: 10000, metadata_json: undefined }`
   - Expected: amount = 10000, metadata_json = null

8. **Non-whitelist premium sync (PREMI JAGA, PREMI KINERJA, PREMI RITASE)**
   - Input: `{ adjustment_name: "PREMI JAGA", metadata_json: {input_type:"blok",items:[{subblok:"P1",gang_code:"B1",jumlah:5000}],total_amount:5000}, amount: 0 }`
   - Expected: `resolveDetailTotalSync()` → amount = 5000, metadata_json.total_amount = 5000

---

### TODO-008: Frontend Test — Test auto-sync untuk non-whitelist premium

**Priority:** MEDIUM
**Status:** pending
**Blocked by:** TODO-001, TODO-002, TODO-003
**File:** `frontend/src/utils/payrollPremiumDetailEdits.test.js` (buat jika belum ada)

**Test Cases:**

1. **PremiumDetailPopup auto-sync behaviour untuk PREMI JAGA**
   - definitionName = "PREMI JAGA", inputType = "blok"
   - Expected: `shouldAutoSyncDetailAmount` = true
   - Expected: `amountToSave` = `totalAmount`

2. **buildPremiumDetailEdit dengan metadata_json untuk non-whitelist premium**
   - metadataJson: `{input_type:"blok",items:[{subblok:"P1",gang_code:"B1",jumlah:5000}],total_amount:5000}`
   - Expected: output.metadataJson = input metadataJson
   - Expected: output.amount =5000

3. **amountToSave calculation untuk semua input_type**
   - inputType = "blok", totalAmount = 3000, storedAmount = 0
   - Expected: `amountToSave` = 3000
   - inputType = "exp", totalAmount = 5000, storedAmount = 0
   - Expected: `amountToSave` = 5000
   - inputType = "kendaraan", totalAmount = 3000, storedAmount = 0
   - Expected: `amountToSave` = 3000
   - inputType = "blok,exp", totalAmount = 3000, storedAmount = 0
   - Expected: `amountToSave` = 3000

4. **PREMI KINERJA (blok,exp) combo auto-sync**
   - definitionName = "PREMI KINERJA", inputType = "blok,exp"
   - Expected: `shouldAutoSyncDetailAmount` = true

5. **PREMI RITASE (kendaraan) auto-sync**
   - definitionName = "PREMI RITASE", inputType = "kendaraan"
   - Expected: `shouldAutoSyncDetailAmount` = true

---

## Execution Order

```
TODO-005 (SQL Audit)
    ↓
TODO-006 (SQL Repair) [after TODO-005]
    ↓
TODO-001 (Backend sync fix)
TODO-002 (Backend validation)
TODO-003 (Frontend auto-sync)
TODO-004 (Frontend warning diff)
    ↓ (parallel, after 1+2+3)
TODO-007 (Unit tests)
TODO-008 (Frontend tests)
```

---

## Related Documentation

- Full validation report: `dokumentasi/debugging/BUG-DB-001-amount-metadata-mismatch-validation.md`
- Audit summary: `dokumentasi/debugging/AUDIT_NOTES.md`

---

*Generated by Claude Code — 2026-06-06*
*Task IDs: #1 - #8*