# PHASE 3C BUG VALIDATION REPORT - amount vs metadata_json mismatch

**Date:** 2026-06-05
**Task:** Audit payroll system - Phase 3C Hypothesis Testing
**Status:** COMPLETE
**Bug ID:** BUG-DB-001
**Verdict:** CONFIRMED BUG — MEDIUM severity

---

## 1. Verdict

**CONFIRMED BUG — MEDIUM severity**

Mismatch amount vs metadata_json total SANGAT MUNGKIN terjadi karena:
1. `resolveDetailTotalSync()` hanya aktif untuk 3 jenis PREMI (PRUNING, RAKING, TIKET)
2. Fallback chain bisa mempertahankan amount lama yang salah
3. Tidak ada validasi JSON untuk metadata_json sebelum parse
4. Beberapa input_type/premi type tidak ada safeguard sync

Tapi severity MEDIUM (bukan HIGH/CRITICAL) karena:
- Report extraction memakai `metadata.total_amount` sebagai source of truth, bukan `amount`
- Ada mismatch detection dan flagging di UI layer
- Test sudah ada dan coverage cukup baik

---

## 2. Evidence Chain

| # | File | Function/Component | Line | Evidence | Interpretasi |
|---|------|-------------------|------|----------|-------------|
| 1 | `manualAdjustmentService.ts` | `resolveDetailTotalSync()` | 458-478 | Hanya aktif untuk `adjustment_type === 'PREMI'` DAN `DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName)` | SYNC HANYA untuk PREMI PRUNING, PREMI RAKING, PREMI TIKET |
| 2 | `manualAdjustmentService.ts` | `resolveDetailTotalSync()` | 467-471 | Fallback chain: calculatedTotal → declaredTotal → fallbackAmount | Jika semua 0, amount bisa tidak berubah |
| 3 | `manualAdjustmentService.ts` | `serializeManualAdjustmentMetadata()` | 434-437 | Langsung stringify tanpa JSON validation | Invalid JSON disimpan apa adanya |
| 4 | `premiumDefinitionService.ts` | `parseMetadata()` | 258-269 | Invalid JSON → log warn + return null | Fallback ke `amount` jika parse gagal |
| 5 | `manualAdjustmentApplier.ts` | `applyManualAdjustmentsToEmployee()` | 105-119 | `effectiveAmount = parsed.total_amount ?? adjustment.amount` | Report extraction pakai `total_amount`, bukan `amount` |
| 6 | `dataExtractorService.ts` | `attachManualAdjustmentMetadata()` | 293-333 | `detail_matches_amount: Math.abs(amount - detailTotal) <= 0.01` | Ada mismatch detection + UI flagging |
| 7 | `dataExtractorService.ts` | `resolveManualAdjustmentCompareAmount()` | 382-385 | `return Number(metadata?.total_amount ?? adjustment.amount) || 0` | Report calculation pakai total_amount |
| 8 | `PremiumDetailPopup.jsx` | `DETAIL_TOTAL_SYNC_DEFINITION_NAMES` | 23 | `Set(['PREMI PRUNING', 'PREMI RAKING'])` | Frontend popup auto-sync HANYA untuk 2 nama |
| 9 | `PremiumDetailPopup.jsx` | `handleSave()` | 554-606 | `onSave?.(metadataJson, amountToSave)` — amount dari popup | Amount dari popup bisa mismatch |
| 10 | `payrollPremiumDetailEdits.js` | `buildPremiumDetailEdit()` | 166-184 | Payload build dari popup state | Amount dan metadata_json dari state berbeda |
| 11 | `manualAdjustmentService.test.ts` | Multiple tests | 429-552 | Test untuk sync dengan amount=0, total_amount mismatch | SYNC WORKS untuk test cases ini |
| 12 | `premiumDefinitionService.ts` | `calculateMetadataTotal()` | 275-295 | Semua input_type dijumlahkan | Calculation logic sudah ada dan benar |

---

## 3. Metadata Structure

```typescript
// input_type: "amount" — tidak ada items
{ input_type: "amount", total_amount: 5000 }

// input_type: "blok" — multi-row subblok + gang + jumlah
{
  input_type: "blok",
  items: [
    { subblok: "P0921", gang_code: "B1H", jumlah: 2323 },
    { subblok: "P0922", gang_code: "B1H", jumlah: 1500 }
  ],
  total_amount: 3823
}

// input_type: "exp" — single expense + jumlah
{
  input_type: "exp",
  expense_code: "LABOUR",
  jumlah: 5000,
  total_amount: 5000
}

// input_type: "kendaraan" — multi-row kendaraan + expense + jumlah
{
  input_type: "kendaraan",
  items: [
    { nomor_kendaraan: "B1234AB", expense_code: "TRANSPORT", jumlah: 3000 }
  ],
  total_amount: 3000
}

// input_type: "blok,exp" — combo blok + expense
{
  input_type: "blok,exp",
  blok_items: [
    { subblok: "P0921", gang_code: "B1H", jumlah: 2000 }
  ],
  expense: { expense_code: "LABOUR", jumlah: 1000 },
  total_amount: 3000
}
```

---

## 4. Amount Sync Flow

```
FRONTEND (PremiumDetailPopup)
─────────────────────────────────────────────────────
1. User edit detail popup (blok/exp/kendaraan/blok,exp)
2. `totalAmount` dihitung dari sum items
3. Jika definitionName ∈ {'PREMI PRUNING', 'PREMI RAKING'}:
   → `shouldAutoSyncDetailAmount = true`
   → `amountToSave = totalAmount` (sync otomatis)
4. Jika definitionName lain:
   → `amountToSave` = storedAmountNumber (manual edit amount)
   → Bisa tidak sinkron dengan totalAmount
5. Payload: { metadataJson, amountToSave }

BACKEND (saveAdjustment)
─────────────────────────────────────────────────────
6. `serializeManualAdjustmentMetadata(metadata)` → JSON string
7. `resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, parsedAmount)`
8. Jika PREMI DAN name ∈ {'PREMI PRUNING', 'PREMI RAKING', 'PREMI TIKET'}:
   → `calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata)`
   → Jika calculatedTotal > 0.01: `amount = calculatedTotal` ✅ SYNC
   → Jika calculatedTotal = 0: fallback ke `declaredTotal` atau `fallbackAmount` ⚠️
9. Jika bukan PREMI atau bukan 3 nama itu: `amount = fallbackAmount` (tanpa sync)
10. DB INSERT/UPDATE dengan final `amount` dan `metadata_json`

REPORT EXTRACTION (manualAdjustmentApplier + dataExtractor)
─────────────────────────────────────────────────────
11. Report extraction: `effectiveAmount = parsed.total_amount ?? adjustment.amount`
    → Selalu pakai `total_amount` jika ada ✅
12. UI mismatch flag: jika amount ≠ total_amount untuk PRUNING/RAKING
    → Tampilkan warning/info panel di UI ✅
```

---

## 5. calculateManualAdjustmentMetadataTotal Review

```typescript
// Backend: manualAdjustmentService.ts:443-456
function calculateManualAdjustmentMetadataTotal(metadata: any): number {
    switch (metadata?.input_type) {
        case "blok":
            return sumMetadataJumlah(metadata.items);
        case "exp":
            return Number(metadata.jumlah) || 0;
        case "kendaraan":
            return sumMetadataJumlah(metadata.items);
        case "blok,exp":
            return sumMetadataJumlah(metadata.blok_items) + (Number(metadata.expense?.jumlah) || 0);
        default:
            return 0;  // ⚠️ input_type tidak dikenal → return 0
    }
}
```

| Aspek | Status | Catatan |
|-------|--------|---------|
| Semua input_type didukung | ✅ Ya | blok, exp, kendaraan, blok,exp |
| Fallback jika items undefined | ✅ Ya | `items || []` |
| Fallback jika jumlah bukan number | ✅ Ya | `Number(item?.jumlah) || 0` |
| Fallback jika items kosong | ✅ Ya | Reduce dari array kosong → 0 |
| String number | ✅ Ya | `Number("5000") = 5000` |
| Invalid JSON | ❌ Tidak tertangani | Return `null` dari `parseMetadata()`, lalu return 0 dari `calculateManualAdjustmentMetadataTotal()` |
| Input_type tidak valid | ✅ Ada default | `default: return 0` |

---

## 6. resolveDetailTotalSync Review

```typescript
// manualAdjustmentService.ts:458-478
// SYNC HANYA untuk:
// 1. adjustment_type === 'PREMI'
// 2. name ∈ {'PREMI PRUNING', 'PREMI RAKING', 'PREMI TIKET'}

function resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, fallbackAmount) {
    if (adjustment_type !== 'PREMI') return { amount: fallbackAmount, metadataJsonStr };
    if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName)) return { amount: fallbackAmount, metadataJsonStr };

    const metadata = premiumDefinitionService.parseMetadata(metadataJsonStr);
    if (!metadata || metadata.input_type === "amount") return { amount: fallbackAmount, metadataJsonStr };

    const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);
    let syncedAmount = fallbackAmount;

    if (Number.isFinite(calculatedTotal) && Math.abs(calculatedTotal) > 0.01) {
        syncedAmount = calculatedTotal;  // ✅ Sync dengan calculatedTotal
    } else {
        const declaredTotal = Number((metadata as any).total_amount);
        syncedAmount = Number.isFinite(declaredTotal) ? declaredTotal : fallbackAmount;
    }

    return {
        amount: syncedAmount,
        metadataJsonStr: JSON.stringify({ ...metadata, total_amount: syncedAmount })
    };
}
```

| Kondisi | Hasil | Bug? |
|---------|-------|-------|
| PREMI PRUNING + items valid + calculatedTotal > 0 | amount = calculatedTotal | ✅ Benar |
| PREMI PRUNING + calculatedTotal = 0 + declaredTotal = 0 + fallbackAmount = 0 | amount = 0 | ⚠️ Zero tidak sinkron |
| PREMI PRUNING + calculatedTotal = 0 + declaredTotal = 100000 + fallbackAmount = 200000 | amount = 100000 | ✅ declaredTotal lebih dipercaya |
| PREMI PRUNING + invalid JSON (parseMetadata return null) | amount = fallbackAmount | ⚠️ Tidak ada sync, fallback ke amount |
| PREMI TIKET (input_type = "amount") | amount = fallbackAmount | ✅ Benar — amount type tidak butuh sync |
| POTONGAN_KOTOR + items valid + calculatedTotal > 0 | amount = fallbackAmount | ⚠️ Tidak di-sync sama sekali |
| PREMI JAGA (nama tidak di whitelist) | amount = fallbackAmount | ⚠️ Tidak di-sync |

**CRITICAL FINDING:** `DETAIL_TOTAL_SYNC_PREMI_NAMES` HANYA berisi 3 nama: `"PREMI PRUNING"`, `"PREMI RAKING"`, `"PREMI TIKET"`. PREMI JAGA, PREMI KINERJA, PREMI RITASE, PREMI CUCI MOBIL TIDAK di-sync.

---

## 7. Mismatch Scenarios

### Skenario 1: Detail items total 201.549, amount lama 200.549
**Result:** ✅ SYNC CORRECT — amount = 201549, total_amount = 201549

### Skenario 2: User edit metadata saja (PREMI PRUNING)
**Result:** ✅ SYNC CORRECT — amount = 250000, total_amount = 250000

### Skenario 3: User edit amount langsung tanpa popup (PREMI PRUNING)
**Input:** metadata_json lama tetap, amount = 250000
**Result:** ❌ MISMATCH — amount = 250000, metadata.total_amount = 200000

### Skenario 4: User set amount 0 (PREMI PRUNING, metadata ada items)
**Result:** ✅ AMAN — calculatedTotal = 200000 > 0.01 → amount override ke 200000

### Skenario 5: User popup detail dengan items kosong
**Result:** ⚠️ BOTH ZERO tapi tidak meaningful — items = [] → calculatedTotal = 0

### Skenario 6: Metadata invalid JSON
**Result:** ❌ MISMATCH — parseMetadata returns null → fallback ke amount, invalid JSON tetap disimpan

### Skenario 7: PREMI JAGA (nama tidak di whitelist)
**Result:** ❌❌ MISMATCH — "PREMI JAGA" NOT IN DETAIL_TOTAL_SYNC_PREMI_NAMES → tidak ada sync

---

## 8. Report Impact

| Layer | Field Dipakai | Source | Mismatch Impact |
|-------|-------------|--------|----------------|
| Report extraction | `total_amount` | `metadata_json` | ✅ AMAN — report pakai total dari items |
| UI mismatch flag | `amount` vs `total_amount` | Both | ✅ Tampilkan warning/info panel |
| Payroll calculation | `total_premi` | Sum dari `total_amount` | ✅ AMAN — pakai synced value |
| THP (Take-home pay) | `upah_kotor` | `total_premi` | ✅ AMAN |
| Audit/manual view | `amount` field | DB | ❌ WRONG — amount tidak sinkron |
| Lampiran | Sum semua premi | `total_premi` | ✅ AMAN |

---

## 9. Severity Assessment

**MEDIUM — dengan justifikasi:**

| Faktor | Nilai | Alasan |
|--------|-------|--------|
| Data Corruption | MEDIUM | Report/nominal kemungkinan besar benar (report pakai total_amount), tapi DB field `amount` tidak akurat |
| Detectability | MEDIUM | UI ada mismatch flagging, tapi user mungkin abaikan warning |
| Likelihood | HIGH | Banyak premi type tidak ada sync (hanya 3 dari 8+ premium types) |
| Data Quality | MEDIUM | `amount` field di database tidak bisa diandalkan untuk audit/manual query |
| Recovery | LOW | Mismatch bisa dideteksi via SQL query |

---

## 10. SQL Validation Query

```sql
-- QUERY A: amount vs metadata_json.total_amount mismatch
SELECT
    id, period_month, period_year, emp_code, gang_code, adjustment_type, adjustment_name,
    amount AS stored_amount,
    TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS metadata_total,
    amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS diff
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL
    AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
    AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01
ORDER BY ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) DESC;

-- QUERY B: metadata_json valid JSON tapi tidak punya total_amount
SELECT id, period_month, period_year, emp_code, adjustment_type, adjustment_name, amount, metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL AND LEN(metadata_json) > 5
    AND TRY_CAST(metadata_json AS JSON) IS NOT NULL
    AND JSON_VALUE(metadata_json, '$.total_amount') IS NULL;

-- QUERY C: PREMI JAGA/KINERJA/RITASE mismatch (tidak ada sync di whitelist)
SELECT id, period_month, period_year, emp_code, gang_code, adjustment_name, amount,
    TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) AS metadata_total
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE adjustment_type = 'PREMI'
    AND adjustment_name LIKE 'PREMI JAGA%'
    AND metadata_json IS NOT NULL
    AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01;

-- QUERY D: amount 0 tapi metadata_json.items punya jumlah > 0
SELECT id, period_month, period_year, emp_code, adjustment_type, adjustment_name, amount, metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE adjustment_type = 'PREMI' AND amount = 0
    AND metadata_json IS NOT NULL AND TRY_CAST(JSON_QUERY(metadata_json, '$.items') AS NVARCHAR(MAX)) IS NOT NULL;

-- QUERY E: Invalid JSON di metadata_json
SELECT id, period_month, period_year, emp_code, adjustment_name, amount, metadata_json
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE metadata_json IS NOT NULL AND LEN(metadata_json) > 0 AND TRY_CAST(metadata_json AS JSON) IS NULL;

-- QUERY F: Summary mismatch count per adjustment_name
SELECT TOP 30
    adjustment_name, adjustment_type,
    COUNT(*) AS total_records,
    SUM(CASE WHEN TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
             AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01
        THEN 1 ELSE 0 END) AS mismatch_count
FROM extend_db_ptrj.dbo.payroll_manual_adjustments
WHERE period_year >= 2025
GROUP BY adjustment_name, adjustment_type
HAVING COUNT(*) > 10
ORDER BY mismatch_count DESC;
```

---

## 11. Safe Fix Recommendation

### Fix 1: Perluas DETAIL_TOTAL_SYNC ke SEMUA premium dengan detail
Sync berdasarkan `input_type !== 'amount'` bukan berdasarkan nama.

### Fix 2: Validasi JSON sebelum serialize
Tambahkan `JSON.parse()` validation di saveAdjustment(), reject invalid JSON.

### Fix 3: Warning untuk items kosong
Log warning jika input_type detail tapi items kosong.

### Fix 4: Sync SEMUA amount
Hapus whitelist nama → sync berdasarkan `input_type !== 'amount'`.

### Fix 5: Guarantee amount = total_amount
Untuk detail premiums, amount WAJIB = calculatedTotal jika items valid.

### Fix 6: Frontend auto-sync untuk SEMUA detail types
Hapus `DETAIL_TOTAL_SYNC_DEFINITION_NAMES` whitelist → sync semua non-amount types.

---

## 12. Patch Plan

1. **Phase 1:** Extend DETAIL_TOTAL_SYNC ke semua premium (1-2 hours)
2. **Phase 2:** JSON Validation di saveAdjustment (1 hour)
3. **Phase 3:** Warning untuk items kosong (30 minutes)
4. **Phase 4:** Frontend auto-sync untuk semua detail types (2 hours)
5. **Phase 5:** SQL Audit untuk identifikasi mismatch (30 minutes)
6. **Phase 6:** Data Repair Script dry-run + execution (1-2 hours)
7. **Phase 7:** Test Coverage Expansion (2 hours)

---

**Report Generated:** 2026-06-05
**Phase:** Phase 3C - Hypothesis Testing
**Investigator:** Claude Code (Investigate Skill)