# PAYROLL SYSTEM AUDIT NOTES — Ringkasan Investigation Phases 1-3C

**Project:** PT Rebinmas Daftar Upah Portal
**Tanggal Audit:** 2026-06-05 s/d 2026-06-06
**Auditor:** Claude Code

---

## FASE 1 — Project Structure Scan

### Stack Teknologi
| Layer | Stack |
|-------|-------|
| Backend Runtime | Bun + Elysia |
| Frontend | React 18 + Vite + AG Grid Enterprise |
| Database | MSSQL via Python SQL Gateway |
| Auth | JWT (jose) + API Key bypass |
| Excel | ExcelJS |
| Charts | Recharts |

### Database Profiles
| Database | Purpose | Access |
|----------|---------|--------|
| `db_ptrj` | Main payroll production | `Database.getInstance()` |
| `extend_db_ptrj` | Adjustment & history | `Database.getExtendedInstance()` |
| `VenusHR14` | Employee master | `Database.getVenusInstance()` |
| `db_ptrj_mill` | Mill/FFB data | `Database.getMillInstance()` |

### Modul Payroll Utama
- `dataExtractorService.ts` (266KB+) — CRITICAL, perlu refactor
- `manualAdjustmentService.ts` (2400+ lines) — complex, perlu modularisasi
- `payroll.ts` API (3359 lines) — terlalu banyak route dalam satu file
- `CustomPayrollTable.jsx` (2600+ lines) — frontend component terlalu besar
- `PayrollCalculator.ts` — single source of truth untuk formula ✅

---

## FASE 2 — Database Audit

### Tabel Utama

**payroll_manual_adjustments** (extend_db_ptrj)
- Kolom: id, period_month, period_year, emp_code, nik, emp_name, gang_code, division_code, adjustment_type, adjustment_name, amount, remarks, metadata_json, ad_code, task_code, task_desc, created_by, created_at, updated_by, updated_at
- **CRITICAL:** Tidak ada UNIQUE constraint
- **CRITICAL:** metadata_json tidak ada JSON validation
- **MISSING:** Composite indexes untuk (period_month, period_year, emp_code) dan (period_month, period_year, gang_code)

**employee_other_incomes** (extend_db_ptrj)
- Penyimpanan PENDAPATAN_LAINNYA (KONTAN, THR, Bonus)
- Upsert logic: check by nik → fallback by emp_code

**payroll_history_header/detail** (extend_db_ptrj)
- Snapshot storage dengan is_locked flag
- Upsert by (period_month, period_year, division_code, gang_code, snapshot_version)

### SQL Gateway Pattern
- Semua query lewat `POST {DB_API_URL}/v1/query` dengan parameterized queries
- Batch transaction tersedia via `POST /v1/query/batch` tapi JARANG digunakan
- Retry logic: up to 3 retries dengan exponential backoff

### Critical Issues (DB Schema)
| ID | Issue | Severity |
|----|-------|----------|
| DB-001 | Tidak ada UNIQUE constraint payroll_manual_adjustments | CRITICAL |
| DB-002 | deleteAdjustmentColumn hapus ALL matching records | HIGH |
| DB-003 | saveAdjustment tanpa transaction wrapper | HIGH |
| DB-004 | metadata_json tanpa JSON validation | HIGH |
| DB-005 | Amount tidak selalu sync dengan metadata_json.total_amount | MEDIUM |
| DB-006 | String interpolation dalam SQL IN clauses | MEDIUM |
| DB-007 | Tidak ada amount range validation | MEDIUM |
| DB-008 | Race condition di ensureManualAdjustmentIdentitySchema | MEDIUM |

---

## FASE 3A — Bug Validation: deleteAdjustmentColumn

**Verdict: CONFIRMED BUG — HIGH severity**

### Masalah
Function `deleteAdjustmentColumn()` menghapus SEMUA record matching tanpa filter `emp_code`, `nik`, `gang_code`, atau `id`.

### Scope DELETE Query
```sql
DELETE FROM dbo.payroll_manual_adjustments
WHERE period_month = ?
  AND period_year = ?
  AND adjustment_type = ?
  AND normalized_adjustment_name = ?
  [AND division_code = ?]  -- opsional
```
Tidak ada filter untuk emp_code, nik, gang_code, atau id.

### API Endpoints
- `DELETE /manual-adjustment/column` (payroll.ts:697)
- `DELETE /locked/manual-adjustment/column` (payroll.ts:2017)
- Frontend: `handleRemoveManualColumn()` di CustomPayrollTable.jsx:1309

### Frontend Intent
Function ini DESIGNED untuk bulk delete kolom adjustment (semua employee dalam scope). Tapi:
- Tidak ada preview sebelum delete
- Tidak ada konfirmasi jumlah record yang terdampak
- Tidak ada audit log
- Hard delete langsung tanpa undo

### Risk Scenario
```
Periode: Mei 2026
Division: P1A
Adjustment_name: PREMI PRUNING

User niat: hapus 1 cell employee B0006
Aksi: klik tombol hapus kolom PREMI PRUNING
Hasil: SEMUA 6 record PREMI PRUNING di P1A ikut terhapus
Employee A,B,C,D,E ikut tidak berdosa
```

### SQL Preview Query (sebelum delete)
```sql
SELECT id, emp_code, emp_name, gang_code, division_code, adjustment_name, amount
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE period_month = 5 AND period_year = 2026
  AND adjustment_type = 'PREMI'
  AND UPPER(LTRIM(RTRIM(...adjustment_name...))) = 'PREMI PRUNING'
  AND (division_code = 'P1A' OR division_code IS NULL OR LTRIM(RTRIM(division_code)) = '')
ORDER BY division_code, gang_code, emp_code;
```

### Recommended Fix
1. Tambahkan dry-run preview endpoint
2. Tampilkan affected rows count di konfirmasi
3. Audit log sebelum delete
4. Transaction wrapper
5. Pertimbangkan soft delete

---

## FASE 3B — Bug Validation: saveAdjustment Transaction & Duplicate

**Verdict: CONFIRMED BUG — HIGH severity (multi-issue)**

### Issue 1: No Transaction Wrapper

Flow `saveAdjustment()` berjalan sebagai operasi terpisah:
```
1. SELECT existing (DB call #1)
2. UPDATE atau INSERT (DB call #2)
3. Preset upsert fire-and-forget (DB call #3)
4. Cache clear
```
Tidak ada transaction, tidak ada rollback on failure.

### Issue 2: Race Condition / Duplicate Risk

Check-then-act pattern TANPA locking:
```sql
-- Thread A: SELECT existing = null
-- Thread B: SELECT existing = null
-- Thread A: INSERT id=100
-- Thread B: INSERT id=101
-- RESULT: 2 duplicate records
```

### Issue 3: Matching Logic Tidak Pakai gang_code

SELECT existing:
```sql
WHERE period_month = ? AND period_year = ?
  AND (emp_code = ? OR nik = ? OR emp_code = ?)  -- ⚠️ 3x OR tanpa gang_code
  AND adjustment_type = ?
  AND normalized_adjustment_name = ?
ORDER BY CASE WHEN emp_code = ? THEN 0 ... id DESC
```
Jika employee punya adjustment sama di 2 gang berbeda, UPDATE akan salah target (TOP 1 by id DESC).

### Issue 4: Amount=0 Bisa Trigger Delete

```typescript
function shouldDeleteStoredAdjustment(amount, remarks?, hasMetadataJson) {
    if (hasMetadataJson) return false;
    return Number(amount || 0) === 0 && !text.includes('INIT_COLUMN') && !text.includes('sync:');
    // ⚠️ User set amount=0, thinking "set to zero" → record di-DELETE
}
```

### Frontend Double-Submit Risk
- `isSavingEdits` state ada ✅
- Button disabled saat saving ✅
- Tidak ada debounce/throttle
- Tidak ada idempotency key
- Race window ~100-500ms

### API Validation
- `/manual-edit`: TIDAK ada period validation ❌
- `/manual-adjustment`: Validasi adjustment_type saja ❌
- `/locked/manual-edit`: currentUser check ✅, period validation ❌
- `/manual-adjustment/by-api-key`: API key bypass, tidak ada user identity

### SQL Validation Query (Deteksi Duplicate)
```sql
SELECT period_month, period_year, emp_code, gang_code, adjustment_type, adjustment_name,
       COUNT(*) AS duplicate_count, SUM(amount) AS total_amount
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
GROUP BY period_month, period_year, emp_code, gang_code, adjustment_type, adjustment_name
HAVING COUNT(*) > 1;
```

### Recommended Fixes
1. **Immediate:** Tambahkan validation layer (period, amount range, JSON validation)
2. Tambahkan duplicate detection query
3. Transaction wrapper untuk SELECT + UPDATE/INSERT
4. Row-level locking: `SELECT ... WITH (UPDLOCK, HOLDLOCK)`
5. Atomic MERGE upsert sebagai alternatif
6. Unique constraint SETELAH cleanup duplicates
7. Frontend idempotency key
8. Test race condition

---

## FASE 3C — Bug Validation: Amount vs Metadata JSON Mismatch

**Verdict: CONFIRMED BUG — MEDIUM severity**

### Metadata Structure
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

### Amount Sync Flow

```
FRONTEND (PremiumDetailPopup)
↓
User edit detail popup → totalAmount = sum(items)
Jika definitionName ∈ {'PREMI PRUNING', 'PREMI RAKING'}:
  → amountToSave = totalAmount (auto-sync)
Jika definitionName lain:
  → amountToSave = storedAmount (bisa tidak sinkron)
↓
BACKEND (saveAdjustment)
↓
resolveDetailTotalSync():
  Jika PREMI DAN name ∈ {'PREMI PRUNING', 'PREMI RAKING', 'PREMI TIKET'}:
    → calculatedTotal = sum items
    → amount = calculatedTotal ✅ SYNC
  Jika bukan:
    → amount = fallbackAmount ❌ TIDAK SYNC

REPORT EXTRACTION
↓
effectiveAmount = parsed.total_amount ?? adjustment.amount
→ Report SELALU pakai total_amount ✅ AMAN
```

### CRITICAL: Whitelist Sync Hanya 3 Nama
```typescript
const DETAIL_TOTAL_SYNC_PREMI_NAMES = new Set([
  "PREMI PRUNING",
  "PREMI RAKING",
  "PREMI TIKET"
]);
// PREMI JAGA, PREMI KINERJA, PREMI RITASE, PREMI CUCI MOBIL TIDAK di-sync
```

### Mismatch Scenarios

| Skenario | Hasil |
|----------|-------|
| Edit metadata PRUNING/RAKING | ✅ amount = totalAmount |
| Edit amount langsung tanpa popup | ❌ amount tidak sinkron dengan totalAmount |
| Invalid JSON metadata | ❌ amount = fallbackAmount, invalid JSON disimpan |
| PREMI JAGA (nama tidak ada di whitelist) | ❌ Tidak sync |
| Items kosong | ⚠️ total = 0, amount = fallbackAmount |

### Report Impact

| Layer | Field Pakai | Dampak |
|-------|-------------|--------|
| Payroll calculation | `metadata.total_amount` | ✅ Benar |
| THP / Take-home pay | `total_premi` | ✅ Benar |
| UI mismatch flag | `amount` vs `total_amount` | ✅ Ada warning |
| Audit / manual query | `amount` field | ❌ Mungkin salah |
| Database integrity | `amount` column | ⚠️ Tidak reliable |

**Kenapa MEDIUM (bukan HIGH):** Report payroll calculation SANGAT MUNGKIN benar karena selalu pakai `metadata.total_amount`. Tapi field `amount` di database tidak reliable untuk audit/manual query.

### SQL Validation Queries

```sql
-- A: amount vs total_amount mismatch
SELECT id, emp_code, adjustment_name, amount,
       JSON_VALUE(metadata_json, '$.total_amount') AS metadata_total,
       amount - JSON_VALUE(metadata_json, '$.total_amount') AS diff
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND JSON_VALUE(metadata_json, '$.total_amount') IS NOT NULL
  AND ABS(amount - JSON_VALUE(metadata_json, '$.total_amount')) > 0.01;

-- B: Invalid JSON
SELECT id, emp_code, metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(metadata_json AS JSON) IS NULL;

-- C: Summary mismatch per adjustment_name
SELECT adjustment_name, adjustment_type, COUNT(*) AS total_records,
       SUM(CASE WHEN amount <> JSON_VALUE(metadata_json, '$.total_amount') THEN 1 ELSE 0 END) AS mismatch_count
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE period_year >= 2025 AND metadata_json IS NOT NULL
GROUP BY adjustment_name, adjustment_type
ORDER BY mismatch_count DESC;
```

### Recommended Fixes
1. Sync untuk SEMUA premium dengan `input_type !== 'amount'` — hapus whitelist nama
2. JSON validation sebelum serialize — reject invalid JSON
3. Warning untuk items kosong
4. Frontend auto-sync untuk SEMUA detail types, bukan hanya 2 nama
5. Data repair script untuk production data

---

## SUMMARY — Prioritas Perbaikan

### Critical Priority (Segera)
| # | Issue | File | Dampak |
|---|-------|------|--------|
| 1 | deleteAdjustmentColumn bulk delete tanpa preview/confirmation | manualAdjustmentService.ts:2326 | Data loss |
| 2 | saveAdjustment race condition + duplicate | manualAdjustmentService.ts:2191 | Duplicate records |
| 3 | saveAdjustment tanpa transaction wrapper | manualAdjustmentService.ts:2191 | Partial state |

### High Priority (1-2 minggu)
| # | Issue | File | Dampak |
|---|-------|------|--------|
| 4 | Amount tidak sync untuk non-whitelist premium | resolveDetailTotalSync() | Data quality |
| 5 | Invalid JSON disimpan tanpa validasi | serializeManualAdjustmentMetadata() | Data corruption |
| 6 | No unique constraint | Schema | Duplicate prevention |

### Medium Priority (1 bulan)
| # | Issue | File | Dampak |
|---|-------|------|--------|
| 7 | API tidak ada period validation di 2 route | payroll.ts | Invalid data |
| 8 | Frontend double-submit race condition | CustomPayrollTable.jsx | Duplicate save |
| 9 | amount=0 bisa silent delete | shouldDeleteStoredAdjustment() | Accidental delete |

### Suggested Patch Order
1. Validation layer di saveAdjustment (period, amount range, JSON)
2. SQL audit queries untuk identifikasi data bermasalah
3. Transaction wrapper untuk saveAdjustment
4. Preview + confirmation untuk deleteAdjustmentColumn
5. Row-level locking atau MERGE upsert
6. Extend DETAIL_TOTAL_SYNC ke semua premium
7. Unique constraint setelah cleanup duplicates
8. Frontend idempotency key

---

## TODO Tracking

| Todo ID | Description | Priority | File | Status | Notes |
|---------|-------------|----------|------|--------|-------|
| TODO-001 | Backend: Expand sync whitelist nama → input_type | HIGH | manualAdjustmentService.ts:432 | **COMPLETED** | Removed DETAIL_TOTAL_SYNC_PREMI_NAMES whitelist |
| TODO-002 | Backend: Validation metadata_json sebelum save | HIGH | manualAdjustmentService.ts:2167 | **COMPLETED** | JSON parse + input_type validation |
| TODO-003 | Frontend: Auto-sync SEMUA input_type detail | HIGH | PremiumDetailPopup.jsx:23,524 | **COMPLETED** | Removed whitelist, always sync |
| TODO-004 | Frontend: Warning diff SEMUA detail types | MEDIUM | PremiumDetailPopup.jsx:532 | **COMPLETED** | showComparison always for non-amount types |
| TODO-005 | SQL Audit: Jalankan 6 query | HIGH | Database extend_db_ptrj | **COMPLETED** | 1061 mismatch ditemukan |
| TODO-006 | SQL Repair: Fix data mismatch | HIGH | Database extend_db_ptrj | **COMPLETED** | Backup: payroll_manual_adjustments_backup_20260606 |
| TODO-007 | Unit Test: Coverage semua input_type | MEDIUM | manualAdjustmentService.test.ts | ✅ COMPLETED | 100 tests pass |
| TODO-008 | Frontend Test: Auto-sync non-whitelist | MEDIUM | payrollPremiumDetailEdits.test.js | ✅ COMPLETED | 16 tests pass |

## Audit Results (2026-06-06)

**Before Repair:**
- Query A: 1061 mismatch records
- Query D: 1057 amount=0 with items
- Worst: PREMI TBS (316 mismatches, diff ~199M IDR)

**After Repair (2026-06-06 02:06 UTC):**
- Query A: 0 remaining mismatch ✅
- Query B: 0 invalid JSON ✅
- Query C: 0 items without total ✅
- Query D: 5 remaining (legitimate: amount=0, total=0, items=empty)
- Query F: ALL 28 adjustment_types have mismatch_count = 0 ✅

**Backup table:** `extend_db_ptrj.dbo.payroll_manual_adjustments_backup_20260606` (17,923 records)

Detail lengkap: `dokumentasi/debugging/BUG-DB-001-amount-metadata-mismatch-validation.md`

---

## Files Utama yang Perlu Diubah

| File | Priority | Alasan |
|------|----------|--------|
| `backend/src/services/manualAdjustmentService.ts` | CRITICAL | Bug #1, #2, #3, #4, #5 |
| `backend/src/api/payroll.ts` | HIGH | API validation |
| `backend/src/db/client.ts` | HIGH | Transaction support |
| `frontend/src/components/CustomPayrollTable.jsx` | HIGH | Frontend guard |
| `frontend/src/components/PremiumDetailPopup.jsx` | MEDIUM | Sync whitelist |

---

*Generated by Claude Code — 2026-06-06*
*Phases: 1 (Structure) + 2 (Database) + 3A (deleteAdjustmentColumn) + 3B (saveAdjustment) + 3C (amount-metadata sync)*
*Full validation report: dokumentasi/debugging/BUG-DB-001-amount-metadata-mismatch-validation.md*
