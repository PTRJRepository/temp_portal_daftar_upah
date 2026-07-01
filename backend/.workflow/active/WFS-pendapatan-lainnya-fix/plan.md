# Plan — Fix Sign-Handling Inconsistency: Potongan/Koreksi Must Always Reduce

**Session**: WFS-pendapatan-lainnya-fix
**Status**: PLAN — awaiting approval
**Revised**: 2026-07-01 (after user clarification on sign rules)

## Problem (user-confirmed rule)

**Naming rule:**
- "Potongan" = pasti **dikurang** (subtract). Never adds.
- "Koreksi" = nature-nya `−` di akhir. Never adds.
- Pendapatan lainnya = ADD to upah_kotor + appears as subtract in potongan upah bersih (cancel-out, by design).

**Sign-safety rule (NEW, critical):**
- Semua nilai potongan & koreksi **WAJIB dinormalisasi ke abs()** sebelum dipakai.
- Input `-80000` (negative) untuk potongan tidak boleh flip jadi `+` (nambah).
- Normalisasi abs dulu, baru apply `−` di perhitungan.
- Cari inkonsistensi yang menyebabkan potongan/koreksi **bertambah** (could flip to `+`).

## Root Cause — Sign-Handling Inconsistency

**Formula layer (single source of truth) — INCONSISTENT:**

`PayrollCalculator.ts`:
- `pot_koreksi` → `Math.abs()` ✓ (line 117)
- `pot_astek_pekerja`, `pot_bpjs_kesehatan_pekerja`, `pot_bpjs_pensiun_pekerja`, `pot_spsi`, `pot_pph21`, `other_potongan`, `pendapatan_lainnya`, `pot_premi_pph` → **RAW, no abs** ✗ (lines 172-178, 230)

`PayrollFormulas.ts`:
- `koreksiAmount` → `Math.abs()` ✓ (line 72, 106, 186, 208)
- `pendapatan_lainnya` → **RAW** ✗ (used in `calculateJumlahUpahKotor`, `calculateUpahKotorPajak`, `calculatePenghasilanBruto`, `calculateKomponenPotongan`, `calculateTotalPotongan`)

**Failure scenario:**
- Input `pot_pph21 = -80000` → `total_potongan` sums it as `-80000` → `total_potongan` shrinks → `upah_bersih = jumlah_upah_kotor - total_potongan` GROWS. Potongan effectively added. ✗
- Input `pendapatan_lainnya = -50000` → `jumlah_upah_kotor` shrinks (gross leak) AND `total_potongan` shrinks (double corruption). ✗

**Caller inconsistencies (sources of negative input):**

1. `reportService.ts:572-600` — `amt = r.TotalAmount || 0` RAW. `pot_pph21`, `pot_spsi`, `pot_kontan`, `pot_thr`, `pot_pinjam`, `pot_tiket`, `pot_alat`, `pot_kl` all assigned raw. DB could return negative TotalAmount. `other_potongan = dynamicSum` raw.
2. `reportService.ts:645-665` — PayrollCalculator call passes `other_potongan` raw, `pot_spsi` raw, `pot_pph21` raw.
3. `aggregationService.ts:106-116` — `calculateRowTotalPotonganBersih` sums `pot_*` + `pendapatan_lainnya` via `getNumericValue` (no abs). A negative source value directly corrupts total.
4. `aggregationAdapter.ts:77-110` — all `getNumeric` raw; relies on PayrollCalculator to abs, but PayrollCalculator only abs `pot_koreksi`.
5. `dataExtractorService.ts:1559, 4803` — `pot_spsi = autoBufferVerification.display.spsiDeduction` — verify this is already abs (likely, since baseline at 4762 uses abs, but autoBuffer path unverified).
6. `dataExtractorService.ts:1724-1729` — `pot_astek_pekerja`, `pot_bpjs_*` from `calculateAllCaruman` — verify caruman returns positive (formula-based, likely positive, but no abs guard).

## Fix Strategy

**Layer 1: Formula layer (single source of truth) — normalize ALL deduction inputs to abs**

`PayrollCalculator.ts` — add abs to every deduction component:
```ts
const komponen_potongan = {
    astek_pekerja: Math.abs(Number(input.pot_astek_pekerja) || 0),
    bpjs_kes_pekerja: Math.abs(Number(input.pot_bpjs_kesehatan_pekerja) || 0),
    bpjs_pensiun_pekerja: Math.abs(Number(input.pot_bpjs_pensiun_pekerja) || 0),
    spsi: Math.abs(Number(input.pot_spsi) || 0),
    pph21: Math.abs(Number(input.pot_pph21) || 0),
    other: Math.abs(Number(input.other_potongan) || 0),
    lainnya: Math.abs(Number(input.pendapatan_lainnya) || 0),  // defensive; lainnya is earning but appears in total_potongan
    subtotal: 0,
};
```
Also abs `pot_premi_pph` (line 230 `total_potongan_bersih`): `Math.abs(Number(input.pot_premi_pph) || 0)` — premi_pph is ADDITION to net, so it must be positive magnitude.
Also abs `pendapatan_lainnya` in `upah_kotor_pajak` (line 159) and `penghasilan_bruto` (line 204): defensive — lainnya is an addition, negative would corrupt gross.

`PayrollFormulas.ts` — mirror: abs all deduction inputs in `calculateKomponenPotongan`, `calculateTotalPotongan`, and abs `pendapatanLainnya` param in `calculateJumlahUpahKotor`/`calculateUpahKotorPajak`/`calculatePenghasilanBruto`.

**ponytail: ceiling = if a future earning component (not deduction) legitimately needs negative handling, revisit. For now all `pot_*` + koreksi + lainnya-in-potongan are magnitude-only by design.**

**Layer 2: Caller normalization (defense in depth — callers should also abs before passing)**

- `reportService.ts:575` — `const amt = Math.abs(r.TotalAmount || 0)` for potongan loop.
- `reportService.ts:645-665` — pass abs'd values to PayrollCalculator (or trust Layer 1).
- `aggregationService.ts:106-116` — `calculateRowTotalPotonganBersih`: use `Math.abs(this.getNumericValue(row, key))`.
- `aggregationAdapter.ts:77-110` — abs in `getNumeric` for deduction fields, OR abs at return for `pot_*`/`pendapatan_lainnya`.

**Layer 3: Guard test**

New test `_dev_utils/tests/signSafety.pendapatanPotongan.test.ts` (or extend `PayrollCalculator.test.ts`):
- Input `pot_pph21 = -80000` → assert `total_potongan` includes `+80000` (abs'd), `upah_bersih` reduced by 80000 (not increased).
- Input `other_potongan = -5000` → same.
- Input `pendapatan_lainnya = -300000` → assert `jumlah_upah_kotor` and `total_potongan` both treat as `+300000` magnitude (cancel-out preserved, no corruption).
- Input `pot_koreksi = -150000` → already handled, assert still works.

**Layer 4: Verify**

- `bun test src/services/payroll/components/PayrollCalculator.test.ts`
- `bun test src/services/payroll/formulas/adapters/aggregationAdapter.test.ts`
- `npx vitest run` frontend aggregationUtils tests (frontend reads abs'd backend values, should stay green).
- Run triage repro (deferred — needs auth) to confirm no koreksi column shows lainnya.

## Files Touched

1. `backend/src/services/payroll/components/PayrollCalculator.ts` — abs all deduction inputs
2. `backend/src/services/payroll/formulas/PayrollFormulas.ts` — abs mirror
3. `backend/src/services/reportService.ts` — abs potongan amounts
4. `backend/src/services/aggregationService.ts` — abs in total potongan calc
5. `backend/src/services/payroll/formulas/adapters/aggregationAdapter.ts` — abs deduction fields
6. `backend/src/services/payroll/components/PayrollCalculator.test.ts` — add sign-safety cases

## Out of Scope

- Frontend `koreksiFields` filter (already correct).
- Triage repro script (deferred until sign fix verified — sign fix may resolve the leak if it was caused by negative lainnya flowing into koreksi display via magnitude confusion).
- Core formula structure (cancel-out design kept).

## Risks

- abs() on `pendapatan_lainnya` is defensive — lainnya is an earning (addition), but it appears in `total_potongan` as a cancel-out. abs ensures magnitude; the `−` is applied structurally in `upah_bersih = jumlah - total_potongan`. Safe.
- abs() on `pot_premi_pph`: premi_pph is ADDITION to net (`upah_bersih = ... + premi_pph`). abs ensures positive magnitude. Safe.
- Existing tests assert specific numeric values — abs only changes behavior for negative inputs, which tests don't currently feed. Should stay green. Verify after.
