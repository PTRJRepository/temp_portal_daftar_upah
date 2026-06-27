# PHASE 3C BUG VALIDATION REPORT — amount vs metadata_json mismatch

**Project:** PT Rebinmas Daftar Upah Portal
**Tanggal Audit:** 2026-06-06
**Auditor:** Claude Code
**Branch:** server-changes-1
**Status:** CONFIRMED BUG — MEDIUM severity

---

## 1. Verdict

**CONFIRMED BUG — MEDIUM severity**

Bug amount vs metadata_json mismatch terjadi nyata untuk premium dengan `input_type` detail (blok, exp, kendaraan, blok,exp) yang **BUKAN** PREMI PRUNING, PREMI RAKING, atau PREMI TIKET. Payroll calculation tetap benar (report pakai `total_amount`), tapi field `amount` di database tidak reliable untuk audit/manual query.

---

## 2. Evidence Chain

| # | File | Function/Component | Line/Area | Evidence | Interpretasi |
|---|------|-------------------|-----------|----------|-------------|
| 1 | manualAdjustmentService.ts | `resolveDetailTotalSync` | 458-478 | Whitelist check: `DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName)` | Hanya 3 nama yang di-sync |
| 2 | manualAdjustmentService.ts | `DETAIL_TOTAL_SYNC_PREMI_NAMES` | 432 | `new Set(["PREMI PRUNING", "PREMI RAKING", "PREMI TIKET"])` | PREMI JAGA/KINERJA/RITASE/CUCI MOBIL tidak ada di whitelist |
| 3 | manualAdjustmentService.ts | `resolveDetailTotalSync` | 459 | `if (String(data.adjustment_type \|\| "").trim().toUpperCase() !== "PREMI")` | POTONGAN types tidak masuk sync |
| 4 | manualAdjustmentService.ts | `resolveDetailTotalSync` | 460 | `if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName)) return { amount: fallbackAmount, metadataJsonStr }` | Non-whitelist → amount tidak berubah |
| 5 | manualAdjustmentService.ts | `resolveDetailTotalSync` | 467-472 | Fallback chain: calculatedTotal > 0.01 → use it; else declaredTotal → fallbackAmount | calculatedTotal=0 tetap fallback |
| 6 | manualAdjustmentService.ts | `calculateManualAdjustmentMetadataTotal` | 443-456 | switch case: blok/exp/kendaraan/blok,exp | Semua input_type dihitung, tapi sync terbatas |
| 7 | manualAdjustmentService.ts | `saveAdjustment` | 2171-2173 | `resolveDetailTotalSync()` dipanggil, hasilnya override `effectiveAmount` | Sync hanya untuk whitelist |
| 8 | manualAdjustmentService.ts | `saveAdjustment` | 2228 | `metadata_json = ${hasMetadataJsonInput ? '?' : 'metadata_json'}` | Update tidak overwrite metadata jika tidak ada di payload |
| 9 | manualAdjustmentApplier.ts | applyManualAdjustments | 106-119 | `effectiveAmount = parsed?.total_amount ?? adjustment.amount` | Report pakai total_amount ✅ |
| 10 | PremiumDetailPopup.jsx | handleSave | 601-604 | `onSave(metadataJson, amountToSave, {...})` | Payload dikirim: metadataJson + amountToSave |
| 11 | PremiumDetailPopup.jsx | amountToSave logic | 524-529 | `shouldAutoSyncDetailAmount` = hanya PRUNING/RAKING | Frontend juga whitelist |
| 12 | manualAdjustmentNaming.ts | `shouldDeleteStoredAdjustment` | 70-74 | `if (hasMetadataJson) return false` | metadata_json → tidak delete meski amount=0 |

---

## 3. Metadata Structure

### JSON Schema per input_type

```typescript
// blok — multi-row subblok
{
  "input_type": "blok",
  "items": [
    { "subblok": "P0921", "gang_code": "B1H", "jumlah": 2323 },
    { "subblok": "P0922", "gang_code": "B1H", "jumlah": 1500 }
  ],
  "total_amount": 3823
}

// exp — single-row expense
{
  "input_type": "exp",
  "expense_code": "LABOUR",
  "jumlah": 5000,
  "total_amount": 5000
}

// kendaraan — multi-row kendaraan
{
  "input_type": "kendaraan",
  "items": [
    { "nomor_kendaraan": "B1234AB", "expense_code": "TRANSPORT", "jumlah": 3000 }
  ],
  "total_amount": 3000
}

// blok,exp — combo
{
  "input_type": "blok,exp",
  "blok_items": [
    { "subblok": "P0921", "gang_code": "B1H", "jumlah": 2000 }
  ],
  "expense": { "expense_code": "LABOUR", "jumlah": 1000 },
  "total_amount": 3000
}

// amount — plain nominal
{ "input_type": "amount", "total_amount": 5000 }
```

### Field yang Dijumlahkan

| input_type | Field Jumlah | Cara |
|---|---|---|
| blok | `items[].jumlah` | sumMetadataJumlah(items) |
| exp | `jumlah` langsung | Number(metadata.jumlah) |
| kendaraan | `items[].jumlah` | sumMetadataJumlah(items) |
| blok,exp | `blok_items[].jumlah` + `expense.jumlah` | sum + Number |

---

## 4. Amount Sync Flow

### Flow Saat Ini (Lengkap)

```
1. USER EDIT PREMI JAGA → popup blok terbuka
   ↓
2. PremiumDetailPopup hitung totalAmount = sum(items.jumlah)
   → misal: items=[{subblok:"P0921",gang_code:"B1H",jumlah:5000}]
   → totalAmount = 5000
   ↓
3. shouldAutoSyncDetailAmount = definitionName ∈ {'PREMI PRUNING','PREMI RAKING'}
   → PREMI JAGA → FALSE
   → amountToSave = storedAmountNumber (TIDAK di-sync dari totalAmount)
   ↓
4. Frontend kirim payload:
   { amount: storedAmount (lama), metadata_json: {input_type:"blok",items:[...],total_amount:5000} }
   ↓
5. Backend: saveAdjustment() → resolveDetailTotalSync()
   → adjustment_type = PREMI ✅
   → normalizedAdjustmentName = "PREMI JAGA"
   → DETAIL_TOTAL_SYNC_PREMI_NAMES.has("PREMI JAGA") → FALSE
   → return { amount: fallbackAmount (= parsedAmount = storedAmount lama), metadataJsonStr: unchanged }
   ↓
6. Database tersimpan:
   amount = storedAmount lama (BISA beda dari 5000)
   metadata_json = {input_type:"blok",items:[...],total_amount:5000}
   → MISMATCH ⚠️
   ↓
7. REPORT PAYROLL EXTRACTION:
   effectiveAmount = metadata_json.total_amount → 5000 ✅ BENAR
   → Payroll calculation OK ✅
```

### Flow untuk PREMI PRUNING (whitelisted)

```
1. User edit → totalAmount = 201549
2. shouldAutoSyncDetailAmount = TRUE
3. amountToSave = totalAmount (201549) ✅
4. Backend: resolveDetailTotalSync()
   → DETAIL_TOTAL_SYNC_PREMI_NAMES.has("PREMI PRUNING") → TRUE
   → calculatedTotal = 201549
   → syncedAmount = 201549
   → metadataJsonStr = JSON.stringify({...metadata, total_amount: 201549})
5. Database: amount = 201549, metadata_json.total_amount = 201549 ✅ SYNC
```

---

## 5. calculateManualAdjustmentMetadataTotal Review

### Code (manualAdjustmentService.ts:443-456)

```typescript
function calculateManualAdjustmentMetadataTotal(metadata: any): number {
    switch (metadata?.input_type) {
        case "blok":
            return sumMetadataJumlah(metadata.items);           // sum items[].jumlah
        case "exp":
            return Number(metadata.jumlah) || 0;                 // langsung jumlah
        case "kendaraan":
            return sumMetadataJumlah(metadata.items);           // sum items[].jumlah
        case "blok,exp":
            return sumMetadataJumlah(metadata.blok_items)        // sum blok_items.jumlah
                 + (Number(metadata.expense?.jumlah) || 0);      // + expense.jumlah
        default:
            return 0;                                           // input_type unknown/null
    }
}

function sumMetadataJumlah(items: any[] | undefined): number {
    return (items || []).reduce((sum, item) => sum + (Number(item?.jumlah) || 0), 0);
}
```

### Analisis

| Aspek | Status | Catatan |
|---|---|---|
| input_type blok ✅ | Didukung | Sum items[].jumlah |
| input_type exp ✅ | Didukung | Langsung metadata.jumlah |
| input_type kendaraan ✅ | Didukung | Sum items[].jumlah |
| input_type blok,exp ✅ | Didukung | blok_items + expense.jumlah |
| input_type amount ❓ | default→0 | Tidak ada special handling, return 0 |
| String number handling ✅ | Aman | Number("1000") = 1000 |
| Empty items ✅ | Aman | items=[] → sum=0 |
| Null/undefined items ✅ | Aman | items=null/undefined → [] fallback |
| expense.jumlah = null ✅ | Aman | Number(null)\|\|0 = 0 |
| declared total vs sum ⚠️ | Potensi mismatch | resolved tapi injected ke metadata_json |

### Bug potensial: calculatedTotal = 0

```typescript
// resolveDetailTotalSync:467-472
if (Number.isFinite(calculatedTotal) && Math.abs(calculatedTotal) > 0.01) {
    syncedAmount = calculatedTotal;  // ✅ Sync
} else {
    const declaredTotal = Number((metadata as any).total_amount);
    syncedAmount = Number.isFinite(declaredTotal) ? declaredTotal : fallbackAmount;
    // ⚠️ Jika declaredTotal juga invalid, fallback ke fallbackAmount (amount lama)
}
```

Jika `items = []` (semua baris dihapus), calculatedTotal = 0, fallback ke declaredTotal (jika ada) atau fallbackAmount. Ini sebenarnya **aman** — user menghapus detail, amount mengikuti nilai yang dikirim (yang juga 0 atau sama dengan nilai lama).

---

## 6. resolveDetailTotalSync Review

### Code (manualAdjustmentService.ts:458-478)

```typescript
const DETAIL_TOTAL_SYNC_PREMI_NAMES = new Set(["PREMI PRUNING", "PREMI RAKING", "PREMI TIKET"]);

function resolveDetailTotalSync(data, normalizedAdjustmentName, metadataJsonStr, fallbackAmount) {
    // 1. Bukan PREMI type → skip
    if (String(data.adjustment_type || "").trim().toUpperCase() !== "PREMI")
        return { amount: fallbackAmount, metadataJsonStr };

    // 2. Nama tidak di whitelist → skip
    if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName))
        return { amount: fallbackAmount, metadataJsonStr };

    // 3. Parse metadata
    const metadata = premiumDefinitionService.parseMetadata(metadataJsonStr);
    if (!metadata || metadata.input_type === "amount")
        return { amount: fallbackAmount, metadataJsonStr };

    // 4. Hitung total dari items
    const calculatedTotal = calculateManualAdjustmentMetadataTotal(metadata);

    // 5. Sync amount
    let syncedAmount = fallbackAmount;
    if (Number.isFinite(calculatedTotal) && Math.abs(calculatedTotal) > 0.01) {
        syncedAmount = calculatedTotal;
    } else {
        const declaredTotal = Number((metadata as any).total_amount);
        syncedAmount = Number.isFinite(declaredTotal) ? declaredTotal : fallbackAmount;
    }

    // 6. Inject total_amount ke metadata_json
    return {
        amount: syncedAmount,
        metadataJsonStr: JSON.stringify({ ...metadata, total_amount: syncedAmount })
    };
}
```

### Analisis

| Kondisi | Behaviour | Aman? |
|---|---|---|
| adjustment_type ≠ PREMI | Return fallbackAmount, metadata unchanged | ✅ POTONGAN types tidak perlu sync |
| adjustment_name ∉ whitelist | Return fallbackAmount, metadata unchanged | ❌ PREMI JAGA/KINERJA/RITASE tidak sync |
| metadata null/empty | Return fallbackAmount, metadata unchanged | ✅ |
| metadata.input_type = "amount" | Return fallbackAmount, metadata unchanged | ✅ Plain amount tidak perlu sync |
| calculatedTotal > 0.01 | syncedAmount = calculatedTotal; inject total_amount | ✅ |
| calculatedTotal = 0 | Fallback: declaredTotal → fallbackAmount | ✅ |
| Invalid JSON metadata | parseMetadata→null → return fallbackAmount | ✅ |
| Items semua 0 | calculatedTotal = 0, fallback | ✅ |

### Critical Gap: Whitelist Hanya 3 Nama

```typescript
const DETAIL_TOTAL_SYNC_PREMI_NAMES = new Set([
  "PREMI PRUNING",     // ✅ Sync
  "PREMI RAKING",      // ✅ Sync
  "PREMI TIKET"        // ✅ Sync (amount type, tapi tetap di whitelist)
  // PREMI JAGA ❌ TIDAK SYNC
  // PREMI JAGA TANGGUNG JAWAB ❌ TIDAK SYNC
  // PREMI KINERJA ❌ TIDAK SYNC
  // PREMI RITASE ❌ TIDAK SYNC
  // PREMI CUCI MOBIL ❌ TIDAK SYNC
]);
```

Dari 8 premium definitions di `premium_definitions.json`, hanya 3 yang amount-nya di-sync. PREMI JAGA, PREMI KINERJA, PREMI RITASE tidak di-sync.

---

## 7. Mismatch Scenarios

### Skenario 1: Detail items total 201.549, amount lama 200.549 (PREMI JAGA)

```
Input:
  - adjustment_name: "PREMI JAGA"
  - metadata_json: {input_type:"blok", items:[{subblok:"P0921",gang_code:"B1H",jumlah:201549}], total_amount:201549}
  - amount: 200549 (lama, belum di-sync)

Backend resolveDetailTotalSync():
  → DETAIL_TOTAL_SYNC_PREMI_NAMES.has("PREMI JAGA") → FALSE
  → Return { amount: 200549, metadataJsonStr: metadata_json unchanged }

Database result:
  amount = 200549 ❌
  metadata_json.total_amount = 201549
  → MISMATCH 1.000
```

### Skenario 2: User edit metadata saja tanpa change amount (PREMI JAGA)

```
User buka popup → items berubah → totalAmount = 5000
Frontend amountToSave = storedAmountNumber (lama, misal 0)
Payload: { amount: 0, metadata_json: {input_type:"blok",items:[{subblok:"P0921",gang_code:"B1H",jumlah:5000}],total_amount:5000} }

Backend:
  → resolveDetailTotalSync() → whitelist check FALSE → return amount=0, metadata unchanged
  → effectiveAmount = 0

Database: amount = 0 ❌, metadata_json.total_amount = 5000
Report: effectiveAmount = total_amount = 5000 ✅
```

### Skenario 3: User edit amount langsung tanpa popup (PREMI JAGA)

```
Frontend kirim: { amount: 10000, metadata_json: undefined/null }

Backend:
  → hasMetadataJsonInput = false
  → resolveDetailTotalSync() → parseMetadata(null) → return { amount: 10000, metadataJsonStr: null }
  → UPDATE: amount=10000, metadata_json=metadata_json (EXISTING preserved)

Database: amount = 10000 ❌
          metadata_json.total_amount = mungkin tidak berubah
→ MISMATCH
```

### Skenario 4: User set amount 0, metadata_json ada (PREMI JAGA)

```
Frontend kirim: { amount: 0, metadata_json: {input_type:"blok",items:[...],total_amount:5000} }

Backend:
  → shouldDeleteStoredAdjustment(0, remarks, hasMetadataJson=true)
     → return false (metadata ada → tidak delete)
  → UPDATE amount=0, metadata_json preserved

Database: amount = 0 ❌, metadata_json.total_amount = 5000
Report: effectiveAmount = total_amount = 5000 ✅
```

### Skenario 5: Popup detail semua item dihapus (PREMI JAGA)

```
User hapus semua baris di popup → items=[]
totalAmount = 0
Frontend amountToSave = storedAmountNumber (lama)
Payload: { amount: storedAmount, metadata_json: {input_type:"blok",items:[],total_amount:0} }

Backend:
  → calculateManualAdjustmentMetadataTotal = 0
  → calculatedTotal = 0 → fallback chain
  → declaredTotal = 0 → syncedAmount = 0
  → amount = 0, metadata_json.total_amount = 0 ✅ SYNC

Database: amount = 0, metadata_json.total_amount = 0 ✅
```

### Skenario 6: Metadata invalid JSON

```
Frontend kirim: { amount: 5000, metadata_json: "{ invalid json }" }

Backend:
  → parseMetadata("{ invalid json }") → null (try-catch catches JSON.parse error)
  → metadata = null → return { amount: fallbackAmount, metadataJsonStr: "{ invalid json }" }
  → effectiveAmount = 5000

Database: amount = 5000 ✅, metadata_json = "{ invalid json }" ❌ (invalid JSON disimpan)

⚠️ CRITICAL: Invalid JSON disimpan tanpa validasi, tidak ada reject.
```

---

## 8. Report Impact

### Lapisan yang Terdampak

| Lapisan | Field Pakai | Status | Dampak |
|---|---|---|---|
| Payroll calculation | `metadata_json.total_amount` | ✅ BENAR | Tidak ada dampak |
| THP / Take-home pay | `total_premi` dari calculation | ✅ BENAR | Tidak ada dampak |
| UI mismatch flag | `amount` vs `total_amount` diff | ✅ Ada warning | User bisa lihat selisih |
| Audit query (DB) | `amount` column | ❌ MUNGKIN SALAH | Data audit tidak reliable |
| Manual adjustment report | `amount` field | ❌ MUNGKIN SALAH | Report non-payroll mungkin salah |
| Division/Gang totals | dari payroll calc | ✅ BENAR | Tidak ada dampak |

### Mengapa MEDIUM (bukan HIGH)

Payroll calculation selalu pakai `metadata_json.total_amount` melalui `manualAdjustmentApplier.ts:113`:
```typescript
effectiveAmount = toAmount(parsed?.total_amount ?? adjustment.amount);
```
Report utama (Daftar Upah, THP) **selalu benar**. Dampak utama adalah field `amount` di database tidak reliable untuk audit/manual query.

---

## 9. Severity Assessment

**MEDIUM**

### Alasan:

1. **Payroll calculation tidak impacted** — report pakai `total_amount`, bukan `amount`
2. **Tidak ada data loss** — tidak ada delete/overwrite yang salah arah
3. **Mismatch terdeteksi UI** — PremiumDetailPopup.jsx menampilkan warning jika ada diff antara amount dan totalAmount untuk whitelist names (tapi tidak untuk non-whitelist)
4. **Workaround ada** — user bisa lihat diff di popup, admin bisa query untuk deteksi

### Faktor yang Menaikkan ke HIGH:

- Jika ada report/ekspor yang langsung pakai `amount` field tanpa fallback ke `total_amount`
- Jika auditor tidak tahu harus query `metadata_json.total_amount`

### Faktor yang Menurunkan ke LOW:

- Jika semua premium hanya PREMI PRUNING dan PREMI RAKING (yang di-whitelist)
- Jika tidak ada audit manual yang rely pada `amount` field

---

## 10. SQL Validation Queries

### A. Amount vs metadata_json.total_amount mismatch

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

### B. Invalid JSON metadata

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

### C. Metadata punya items tapi total_amount null

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

### D. Amount 0 tapi metadata_json.items punya jumlah > 0

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

### E. Total_amount 0 tapi items punya jumlah

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

### F. Summary mismatch per adjustment_name (semua periode)

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

---

## 11. Safe Fix Recommendation

### Prinsip Fix

1. **Source of truth** — `metadata_json.items[].jumlah` adalah satu-satunya truth untuk detail premium
2. **Amount harus selalu = calculatedTotal** — jika `input_type` adalah detail (blok, exp, kendaraan, blok,exp), amount HARUS diset dari sum items
3. **Tidak ada fallback ke amount lama** — calculatedTotal = 0 tetap gunakan 0, jangan fallback
4. **Invalid metadata → reject save** — jangan simpan JSON yang tidak valid
5. **Amount-only edit → clear metadata** — jika user edit amount langsung tanpa popup detail, hapus metadata_json agar tidak ada mismatch

### Rekomendasi Spesifik

1. **Hapus whitelist nama** — sync SEMUA premium dengan `input_type !== 'amount'`, bukan hanya 3 nama
2. **Backend validation** — sebelum save, validasi JSON metadata, reject jika invalid
3. **Frontend auto-sync** — untuk SEMUA detail types, amountToSave = totalAmount
4. **Amount-only payload** — jika user edit amount tanpa metadata_json, clear existing metadata_json di database (opsional, atau warn)
5. **Warning UI** — untuk non-whitelist premium, tampilkan warning di popup jika amount ≠ totalAmount
6. **SQL repair script** — untuk data yang sudah mismatch, repair dengan meng-set amount = metadata_json.total_amount

---

## 12. TODO — Patch Plan (Berjenjang)

### TODO-001: Backend — Expand sync dari whitelist nama ke whitelist input_type
**Priority:** HIGH
**File:** `backend/src/services/manualAdjustmentService.ts`
**Line:** ~458-478 (`resolveDetailTotalSync`)
**Task:**
- Hapus `DETAIL_TOTAL_SYNC_PREMI_NAMES` whitelist nama
- Ganti logic: jika `metadata.input_type !== 'amount'` → selalu sync amount = calculatedTotal
- Jika `calculatedTotal = 0` → tetap set amount = 0 (tidak fallback ke amount lama)

**Before:**
```typescript
if (!DETAIL_TOTAL_SYNC_PREMI_NAMES.has(normalizedAdjustmentName))
    return { amount: fallbackAmount, metadataJsonStr };
```

**After:**
```typescript
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
```

---

### TODO-002: Backend — Validation metadata_json sebelum save
**Priority:** HIGH
**File:** `backend/src/services/manualAdjustmentService.ts`
**Line:** ~2164-2174 (di `saveAdjustment`, sebelum parse)
**Task:**
- Jika `metadataJsonStr` ada dan tidak null, validasi JSON parse
- Jika invalid → throw error, jangan simpan
- Jika valid tapi tidak ada `input_type` → throw error

**Code:**
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

---

### TODO-003: Frontend — Expand auto-sync ke SEMUA input_type detail
**Priority:** HIGH
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

---

### TODO-004: Frontend — Tampilkan warning diff untuk SEMUA detail types
**Priority:** MEDIUM
**File:** `frontend/src/components/PremiumDetailPopup.jsx`
**Line:** ~524-548
**Task:**
- `shouldShowAmountComparison` dan `visibleMismatch` saat ini hanya aktif jika `shouldAutoSyncDetailAmount`
- Ganti jadi: selalu tampilkan diff jika `inputType !== 'amount'` dan ada storedAmount

---

### TODO-005: SQL Audit — Jalankan semua 6 query untuk quantifikasi data mismatch
**Priority:** HIGH
**Task:**
1. Jalankan SQL Query A — amount vs total_amount mismatch
2. Jalankan SQL Query B — invalid JSON
3. Jalankan SQL Query C — items tapi total_amount null
4. Jalankan SQL Query D — amount 0 tapi items ada
5. Jalankan SQL Query E — total_amount 0 tapi items ada
6. Jalankan SQL Query F — summary per adjustment_name

**Output:** Laporan quantifikasi data mismatch production

---

### TODO-006: SQL Repair — Perbaiki data yang sudah mismatch
**Priority:** HIGH (setelah TODO-005)
**Task:**
```sql
-- Backup dulu (SELECT INTO)
SELECT * INTO extend_db_ptrj.dbo.payroll_manual_adjustments_backup_20260606
WHERE metadata_json IS NOT NULL;

-- Repair: set amount = metadata_json.total_amount untuk semua record dengan mismatch
UPDATE dbo.payroll_manual_adjustments
SET
    amount = TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)),
    updated_at = GETDATE(),
    updated_by = 'system_repair'
WHERE metadata_json IS NOT NULL
  AND TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2)) IS NOT NULL
  AND ABS(amount - TRY_CAST(JSON_VALUE(metadata_json, '$.total_amount') AS DECIMAL(18,2))) > 0.01;
```

---

### TODO-007: Unit Test — Test coverage untuk semua input_type
**Priority:** MEDIUM
**Files:**
- `backend/src/services/manualAdjustmentService.test.ts` (jika ada)
- Buat test baru untuk `calculateManualAdjustmentMetadataTotal`
- Test cases:
  1. blok items sum
  2. exp jumlah
  3. kendaraan items sum
  4. blok,exp combo
  5. calculatedTotal = 0 (edge case)
  6. invalid JSON metadata (should throw/reject)
  7. amount-only edit clears metadata (edge case)
  8. Non-whitelist premium sync (PREMI JAGA, PREMI KINERJA, PREMI RITASE)

---

### TODO-008: Frontend Test — Test auto-sync untuk non-whitelist premium
**Priority:** MEDIUM
**File:** `frontend/src/utils/payrollPremiumDetailEdits.test.js` (jika ada)
**Task:**
- Test `PremiumDetailPopup` auto-sync behaviour untuk PREMI JAGA
- Test `buildPremiumDetailEdit` dengan metadata_json untuk non-whitelist premium
- Test `amountToSave` calculation untuk semua input_type

---

## 13. Related Bugs (dari AUDIT_NOTES.md)

| Bug ID | Issue | Severity | Status |
|--------|-------|----------|--------|
| DB-001 | Tidak ada UNIQUE constraint payroll_manual_adjustments | CRITICAL | OPEN |
| DB-002 | deleteAdjustmentColumn bulk delete tanpa preview | HIGH | OPEN |
| DB-003 | saveAdjustment tanpa transaction wrapper | HIGH | OPEN |
| DB-004 | metadata_json tanpa JSON validation | HIGH | **PARTIAL FIX (TODO-002)** |
| DB-005 | Amount tidak selalu sync dengan metadata_json.total_amount | MEDIUM | **THIS BUG (TODO-001)** |
| DB-006 | String interpolation dalam SQL IN clauses | MEDIUM | OPEN |
| DB-007 | Tidak ada amount range validation | MEDIUM | OPEN |
| DB-008 | Race condition di ensureManualAdjustmentIdentitySchema | MEDIUM | OPEN |

---

## 14. File Locations Summary

| File | Priority | Todo |
|------|----------|------|
| `backend/src/services/manualAdjustmentService.ts` | CRITICAL | TODO-001, TODO-002 |
| `frontend/src/components/PremiumDetailPopup.jsx` | HIGH | TODO-003, TODO-004 |
| `frontend/src/utils/payrollPremiumDetailEdits.js` | MEDIUM | Frontend tests |
| Database `extend_db_ptrj` | HIGH | TODO-005, TODO-006 |

---

*Generated by Claude Code — 2026-06-06*
*Audit scope: amount vs metadata_json mismatch (BUG-DB-001)*