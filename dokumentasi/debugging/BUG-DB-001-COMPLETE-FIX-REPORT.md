# BUG-DB-001 — COMPLETE FIX REPORT
## amount vs metadata_json.total_amount mismatch

**Project:** PT Rebinmas Daftar Upah Portal
**Bug ID:** BUG-DB-001
**Tanggal:** 2026-06-06
**Status:** ✅ FULLY RESOLVED — ALL 8 TODO COMPLETED
**Branch:** server-changes-1

---

## Executive Summary

Bug confirmed: `amount` field di `payroll_manual_adjustments` tidak selalu sync dengan `metadata_json.total_amount` untuk premium dengan `input_type` detail (blok, exp, kendaraan, blok,exp) yang **tidak** termasuk dalam whitelist nama lama (`PREMI PRUNING`, `PREMI RAKING`, `PREMI TIKET`).

**Dampak:** Payroll calculation tetap benar (report pakai `metadata_json.total_amount`), tapi field `amount` di database tidak reliable untuk audit.

**Solusi:** Expand sync dari whitelist nama → whitelist `input_type !== 'amount'`, plus JSON validation, SQL repair, dan test coverage.

**Hasil:**
- 1.061 records mismatch ditemukan dan diperbaiki
- 0 remaining mismatch setelah repair
- 100 backend tests pass
- 16 frontend tests pass
- Database backup tersedia: `payroll_manual_adjustments_backup_20260606`

---

## 1. Bug Analysis

### Root Cause

`resolveDetailTotalSync()` di `manualAdjustmentService.ts` menggunakan whitelist nama:

```typescript
// BEFORE (buggy)
const DETAIL_TOTAL_SYNC_PREMI_NAMES = new Set([
  "PREMI PRUNING",
  "PREMI RAKING",
  "PREMI TIKET"
]);

function resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, fallbackAmount) {
    // ...
    if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName))
        return { amount: fallbackAmount, metadataJsonStr }; // ❌ NOT SYNCED
    // ...
}
```

PREMI JAGA, PREMI KINERJA, PREMI RITASE, PREMI CUCI MOBIL, PREMI ANGKUT TBS, PREMI TBS, dll. tidak ada di whitelist → amount tidak di-sync dari items sum.

### Metadata JSON Structure

```typescript
// blok
{ input_type: "blok", items: [{subblok, gang_code, jumlah}], total_amount: number }

// exp
{ input_type: "exp", expense_code, jumlah, total_amount }

// kendaraan
{ input_type: "kendaraan", items: [{nomor_kendaraan, expense_code, jumlah}], total_amount }

// blok,exp
{ input_type: "blok,exp", blok_items, expense: {expense_code, jumlah}, total_amount }
```

### Why Report Was Safe

`manualAdjustmentApplier.ts` selalu pakai `total_amount`:

```typescript
effectiveAmount = toAmount(parsed?.total_amount ?? adjustment.amount);
```

---

## 2. SQL Audit Results

**Tanggal:** 2026-06-06 02:04 UTC
**Database:** extend_db_ptrj (SERVER_PROFILE_1)
**Total records:** 18.096
**Records with metadata_json:** 17.923

### Before Repair

| Query | Findings |
|-------|----------|
| Query A: Amount vs total_amount mismatch | **1.061 records** |
| Query B: Invalid JSON metadata | 0 records |
| Query C: Items tapi total_amount null | 0 records |
| Query D: Amount=0 dengan items | 1.057 records |
| Query E: Total=0 dengan items | 4 records |
| Query F: Summary per adjustment_name | 28 adjustment_types dengan mismatch |

### Worst Offenders (Query F)

| adjustment_name | total_records | mismatch_count | total_diff |
|---|---|---|---|
| PREMI TBS | 1.067 | 316 | 199.274.914 |
| PREMI INSENTIF PANEN | 606 | 187 | 79.152.591 |
| PREMI ANGKUT TBS | 298 | 64 | 88.227.865 |
| PREMI INSENTIF | 84 | 63 | 16.520.000 |
| PREMI RITASE | 216 | 59 | 10.072.764 |
| PREMI ANGKUT PUPUK | 71 | 43 | 6.796.580 |
| PREMI KINERJA | 123 | 35 | 64.765.000 |
| PREMI PRUNING | 695 | 0 | 0 ✅ |
| PREMI RAKING | 377 | 0 | 0 ✅ |

**PREMI PRUNING dan PREMI RAKING tidak ada mismatch** karena sudah di-whitelist.

### After Repair

| Query | Findings |
|-------|----------|
| Query A: Amount vs total_amount mismatch | **0 records** ✅ |
| Query B: Invalid JSON metadata | 0 records ✅ |
| Query C: Items tapi total_amount null | 0 records ✅ |
| Query D: Amount=0 dengan items | 5 records (legitimate: amount=0, total=0) |
| Query E: Total=0 dengan items | 4 records (legitimate) |
| Query F: Summary per adjustment_name | **ALL mismatch_count = 0** ✅ |

---

## 3. Fix Implementation

### TODO-001: Backend — Expand sync whitelist nama → input_type

**File:** `backend/src/services/manualAdjustmentService.ts`
**Line:** 432-483
**Status:** ✅ COMPLETED

**Before:**
```typescript
const DETAIL_TOTAL_SYNC_PREMI_NAMES = new Set(["PREMI PRUNING", "PREMI RAKING", "PREMI TIKET"]);
// Only 3 names synced
```

**After:**
```typescript
function resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, fallbackAmount) {
    // Only PREMI type adjustments have structured metadata
    if (String(data.adjustment_type || "").trim().toUpperCase() !== "PREMI") {
        return { amount: fallbackAmount, metadataJsonStr };
    }

    const metadata = premiumDefinitionService.parseMetadata(metadataJsonStr);
    // No metadata or plain amount type — nothing to sync
    if (!metadata || metadata.input_type === "amount") {
        return { amount: fallbackAmount, metadataJsonStr };
    }

    // Sync amount for ALL detail input types (blok, exp, kendaraan, blok,exp)
    // NOT limited to specific premium names — source of truth is metadata items
    const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);

    let syncedAmount: number;
    if (Number.isFinite(calculatedTotal)) {
        syncedAmount = calculatedTotal;
    } else {
        const declaredTotal = Number((metadata as any).total_amount);
        syncedAmount = Number.isFinite(declaredTotal) ? declaredTotal : fallbackAmount;
    }

    // Always inject the synced total_amount into metadata_json so DB stays consistent
    return {
        amount: syncedAmount,
        metadataJsonStr: JSON.stringify({ ...(metadata as any), total_amount: syncedAmount })
    };
}
```

**Also moved `calculateManualAdjustmentMetadataTotal` inline** (was previously a module-level helper, now inline for clarity).

---

### TODO-002: Backend — Validation metadata_json sebelum save

**File:** `backend/src/services/manualAdjustmentService.ts`
**Line:** ~2167-2189
**Status:** ✅ COMPLETED

```typescript
// Validate metadata_json if provided — reject invalid JSON or missing input_type
if (data.metadata_json !== undefined && data.metadata_json !== null) {
    const rawMeta = typeof data.metadata_json === "string"
        ? data.metadata_json
        : JSON.stringify(data.metadata_json);
    if (rawMeta && typeof rawMeta === "string" && rawMeta.trim() !== "") {
        try {
            const parsed = JSON.parse(rawMeta);
            if (!parsed || !parsed.input_type) {
                throw new Error("metadata_json must have an 'input_type' field");
            }
            const validInputTypes = ["amount", "blok", "exp", "kendaraan", "blok,exp"];
            if (!validInputTypes.includes(parsed.input_type)) {
                throw new Error(`metadata_json input_type "${parsed.input_type}" not supported. Use: ${validInputTypes.join(", ")}`);
            }
        } catch (err: any) {
            if (err.message.includes("input_type") || err.message.includes("not supported")) throw err;
            throw new Error(`metadata_json is not valid JSON: ${err.message}`);
        }
    }
}
```

**Validasi:**
- Invalid JSON → throw error, reject save
- Missing `input_type` → throw error
- Unknown `input_type` → throw error
- null/undefined/empty → allowed (no metadata)

---

### TODO-003: Frontend — Auto-sync SEMUA input_type detail

**File:** `frontend/src/components/PremiumDetailPopup.jsx`
**Line:** 23, 524
**Status:** ✅ COMPLETED

**Before:**
```javascript
const DETAIL_TOTAL_SYNC_DEFINITION_NAMES = new Set(['PREMI PRUNING', 'PREMI RAKING']);

const shouldAutoSyncDetailAmount = inputType !== 'amount' && DETAIL_TOTAL_SYNC_DEFINITION_NAMES.has(normalizeDefinitionName(definitionName));
const amountToSave = inputType === 'amount'
    ? totalAmount
    : shouldAutoSyncDetailAmount
        ? totalAmount
        : (isAmountEditable ? normalizeDetailAmount(amountDraft) : storedAmountNumber);
```

**After:**
```javascript
// Removed DETAIL_TOTAL_SYNC_DEFINITION_NAMES whitelist

const shouldAutoSyncDetailAmount = inputType !== 'amount';
const amountToSave = totalAmount; // Always use totalAmount for detail types
```

**Dead code removed:**
- `isAmountEditable` state → removed
- `setIsAmountEditable` → removed
- `handleSyncAmount` callback → removed
- `!shouldAutoSyncDetailAmount` manual amount section → removed
- `diffFromDraft`, `detailDiffersFromDraft` → removed
- `amountEdited: isAmountEditable` in save payload → `amountEdited: false`
- `amountSyncedToDetail: !detailDiffersFromDraft` → `amountSyncedToDetail: true`

---

### TODO-004: Frontend — Warning diff untuk SEMUA detail types

**File:** `frontend/src/components/PremiumDetailPopup.jsx`
**Line:** 532-539
**Status:** ✅ COMPLETED

**Before:**
```javascript
const shouldShowAmountComparison = shouldAutoSyncDetailAmount && hasStoredAmountToCompare;
const visibleMismatch = shouldAutoSyncDetailAmount && mismatch && ...;
```

**After:**
```javascript
const shouldShowAmountComparison = inputType !== 'amount' && hasStoredAmountToCompare;
const visibleMismatch = inputType !== 'amount' && mismatch && ...
    || (inputType !== 'amount' && detailDiffersFromStored && hasStoredAmountToCompare
        ? { amount: storedAmountNumber, detail_total: totalAmount, diff: diffFromStored,
            reason: 'Total detail berbeda dari amount tersimpan' }
        : null);
```

**Also updated info panel text:**
- Before: Conditional text based on `shouldAutoSyncDetailAmount` (whitelist-based)
- After: Generic text "Total detail terbaru akan dipakai saat simpan (auto-sync aktif untuk semua tipe detail)"

**Mismatch warning text updated:**
- Before: "Untuk PREMI PRUNING/RAKING, ini hanya informasi pembanding"
- After: "Ini hanya informasi pembanding" (generic)

---

## 4. SQL Repair

### Step 1: Backup

```sql
SELECT * INTO dbo.payroll_manual_adjustments_backup_20260606
FROM dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL;
-- Result: 17.923 records backed up
```

### Step 2: Dry-run Preview

```sql
SELECT id, emp_code, adjustment_name, amount AS old_amount,
       TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS new_amount,
       diff
FROM dbo.payroll_manual_adjustments
WHERE ABS(amount - JSON_VALUE(...)) > 0.01;
-- Result: 1.061 records to repair
```

### Step 3: Execute Repair

```sql
UPDATE dbo.payroll_manual_adjustments
SET amount = TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)),
    updated_at = GETDATE(),
    updated_by = 'system_repair'
WHERE metadata_json IS NOT NULL
  AND JSON_VALUE(metadata_json, '$.total_amount') IS NOT NULL
  AND ABS(amount - JSON_VALUE(...)) > 0.01;
-- Result: 1.061 rows affected
```

### Step 4: Verify

```sql
SELECT COUNT(*) FROM dbo.payroll_manual_adjustments
WHERE ABS(amount - JSON_VALUE(...)) > 0.01;
-- Result: 0 remaining mismatch ✅
```

---

## 5. Test Coverage

### Backend Tests (manualAdjustmentService.test.ts)

**Command:** `bun test src/services/manualAdjustmentService.test.ts`
**Result:** 100 tests pass, 212 expect() calls

**New BUG-DB-001 test suites:**

| Test Suite | Tests |
|---|---|
| `calculateManualAdjustmentMetadataTotal` | 8 tests (blok, exp, kendaraan, blok,exp, empty, unknown type, null items, string jumlah) |
| `resolveDetailTotalSync — input_type based sync` | 8 tests (blok kendaraan blok,exp for non-whitelist names, amount type, non-PREMI, null metadata, inject total_amount) |
| `metadata_json validation` | 11 tests (valid types, invalid JSON, missing input_type, unknown type, null/undefined/empty) |
| `serializeManualAdjustmentMetadata` | 4 tests (null, undefined, string, object) |

### Frontend Tests (payrollPremiumDetailEdits.test.js)

**Command:** `npx vitest run src/utils/payrollPremiumDetailEdits.test.js`
**Result:** 16 tests pass

**New BUG-DB-001 test suites:**

| Test | Description |
|---|---|
| sync blok for PREMI JAGA | Blok metadata synced for non-whitelist name |
| sync kendaraan for PREMI ANGKUT TBS | Kendaraan metadata synced |
| sync blok,exp for PREMI KINERJA | Combo metadata synced |
| sync exp for PREMI JAGA TANGGUNG JAWAB | Single-row expense synced |
| preserve existing edit | Existing edit identity preserved |
| update amount on partial edit | Amount updated when items removed |
| PREMI PRUNING no regression | Whitelist name still works |
| amount input_type | Plain amount handled correctly |

---

## 6. Files Changed

| File | Change Type | Summary |
|------|-------------|---------|
| `backend/src/services/manualAdjustmentService.ts` | Modified | Removed whitelist, expanded sync, added validation, inlined helpers |
| `frontend/src/components/PremiumDetailPopup.jsx` | Modified | Auto-sync all types, warning diff all types, removed dead code |
| `backend/src/services/manualAdjustmentService.test.ts` | Modified | +116 lines BUG-DB-001 tests (8 new test suites) |
| `frontend/src/utils/payrollPremiumDetailEdits.test.js` | Modified | +8 auto-sync tests |
| `dokumentasi/debugging/AUDIT_NOTES.md` | Modified | Updated with results + TODO status |
| `dokumentasi/debugging/BUG-DB-001-TODO-TRACKING.md` | Modified | All 8 TODOs marked COMPLETED |
| `dokumentasi/debugging/BUG-DB-001-amount-metadata-mismatch-validation.md` | Created | Full validation report |
| `dokumentasi/debugging/BUG-DB-001-audit-results-2026-06-06.json` | Created | Raw audit results |
| `_dev_utils/scripts/audit_metadata_mismatch.ts` | Created | SQL audit script (6 queries) |
| `_dev_utils/scripts/repair_metadata_mismatch.ts` | Created | SQL repair script (4 steps) |
| `dokumentasi/debugging/BUG-DB-001-COMPLETE-FIX-REPORT.md` | Created | This report |

---

## 7. Backup Information

**Backup Table:** `extend_db_ptrj.dbo.payroll_manual_adjustments_backup_20260606`
**Records:** 17.923 (all records with metadata_json)
**Created:** 2026-06-06 02:05 UTC
**Restore Command:**
```sql
-- Dry-run (preview what will be restored)
SELECT COUNT(*) FROM dbo.payroll_manual_adjustments_backup_20260606;

-- Restore (if needed)
-- First backup current state
SELECT * INTO dbo.payroll_manual_adjustments_pre_restore_20260606
FROM dbo.payroll_manual_adjustments;

-- Then restore from backup
-- TRUNCATE/DELETE current then INSERT...SELECT from backup
-- Or use ID-based matching for targeted restore
```

---

## 8. TODO Summary

| Todo ID | Description | Priority | Status | Tests |
|---------|-------------|----------|--------|-------|
| TODO-001 | Backend: Expand sync whitelist nama → input_type | HIGH | ✅ COMPLETED | — |
| TODO-002 | Backend: Validation metadata_json sebelum save | HIGH | ✅ COMPLETED | — |
| TODO-003 | Frontend: Auto-sync SEMUA input_type detail | HIGH | ✅ COMPLETED | — |
| TODO-004 | Frontend: Warning diff SEMUA detail types | MEDIUM | ✅ COMPLETED | — |
| TODO-005 | SQL Audit: Jalankan 6 query | HIGH | ✅ COMPLETED | 1.061 mismatch found |
| TODO-006 | SQL Repair: Fix data mismatch | HIGH | ✅ COMPLETED | 0 remaining |
| TODO-007 | Unit Test: Coverage semua input_type | MEDIUM | ✅ COMPLETED | 100 pass |
| TODO-008 | Frontend Test: Auto-sync non-whitelist | MEDIUM | ✅ COMPLETED | 16 pass |

---

## 9. How to Verify Fix is Working

### Backend — New behaviour

```bash
# Start backend
cd backend && bun run dev

# Test save PREMI JAGA (was not in whitelist)
# Payload:
POST /payroll/manual-adjustment
{
  "period_month": 6,
  "period_year": 2026,
  "emp_code": "J0001",
  "nik": "1234",
  "gang_code": "B1H",
  "division_code": "P1A",
  "adjustment_type": "PREMI",
  "adjustment_name": "PREMI JAGA",
  "amount": 0,
  "metadata_json": "{\"input_type\":\"blok\",\"items\":[{\"subblok\":\"P0921\",\"gang_code\":\"B1H\",\"jumlah\":5000}],\"total_amount\":5000}"
}

# Expected: amount field in DB = 5000 (synced from items sum)
# Before fix: amount field would = 0 (not synced)
```

### Backend — Validation

```bash
# Test invalid JSON rejection
POST /payroll/manual-adjustment
{
  "metadata_json": "{ invalid json }",
  ...
}
# Expected: 500 error with message "metadata_json is not valid JSON"

# Test missing input_type rejection
POST /payroll/manual-adjustment
{
  "metadata_json": "{\"items\":[]}",
  ...
}
# Expected: 500 error with message "metadata_json must have an 'input_type' field"
```

### Run Tests

```bash
# Backend tests
cd backend && bun test src/services/manualAdjustmentService.test.ts
# Expected: 100 pass

# Frontend tests
cd frontend && npx vitest run src/utils/payrollPremiumDetailEdits.test.js
# Expected: 16 pass

# Re-run audit (should show 0 mismatch)
cd backend && bun run _dev_utils/scripts/audit_metadata_mismatch.ts
# Expected: Query A = 0, Query B = 0, Query F: ALL mismatch_count = 0
```

---

## 10. Related Bugs (Open)

| Bug ID | Issue | Severity | File |
|--------|-------|---------|------|
| DB-001 | Tidak ada UNIQUE constraint payroll_manual_adjustments | CRITICAL | Schema |
| DB-002 | deleteAdjustmentColumn bulk delete tanpa preview | HIGH | manualAdjustmentService.ts:2326 |
| DB-003 | saveAdjustment tanpa transaction wrapper | HIGH | manualAdjustmentService.ts:2191 |
| DB-006 | String interpolation dalam SQL IN clauses | MEDIUM | various |
| DB-007 | Tidak ada amount range validation | MEDIUM | payroll.ts |
| DB-008 | Race condition di ensureManualAdjustmentIdentitySchema | MEDIUM | manualAdjustmentService.ts |

---

*Generated by Claude Code — 2026-06-06*
*BUG-DB-001: amount vs metadata_json.total_amount mismatch*
*Full validation: dokumentasi/debugging/BUG-DB-001-amount-metadata-mismatch-validation.md*
*TODO tracking: dokumentasi/debugging/BUG-DB-001-TODO-TRACKING.md*
*Audit results: dokumentasi/debugging/BUG-DB-001-audit-results-2026-06-06.json*