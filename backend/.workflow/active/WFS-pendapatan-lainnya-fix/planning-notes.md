# Planning Notes — Pendapatan Lainnya Logic Fix

**Session**: WFS-pendapatan-lainnya-fix
**Created**: 2026-07-01

## User Intent (Phase 1)

- **GOAL**: Perbaiki pendapatan_lainnya (KONTAN/THR/Bonus/Custom) agar TIDAK muncul di "koreksi gross upah kotor".
- **BUSINESS RULE (user-confirmed)**:
  - pendapatan_lainnya → ADD ke upah_kotor (jumlah_upah_kotor). Bukan masuk koreksi.
  - pendapatan_lainnya → juga muncul di potongan upah bersih (total_potongan). Net effect di upah_bersih = 0 (cancel out, by design — THR/bonus sudah dibayar/non-tunai).
  - BUG: pendapatan_lainnya muncul di section "koreksi gross upah kotor" (POTONGAN UPAH KOTOR / KOREKSI GROSS column).

## Context Findings (Phase 2)

### Single Source of Truth — PayrollCalculator + PayrollFormulas (CORRECT, matches user intent)

`backend/src/services/payroll/components/PayrollCalculator.ts` + `formulas/PayrollFormulas.ts`:

- `upah_kotor = gaji_pokok + tunjangan + lembur + total_premi` (tanpa koreksi/lainnya)
- `jumlah_upah_kotor = upah_kotor - pot_koreksi + pendapatan_lainnya`  ✓ lainnya ADD
- `total_potongan = astek + bpjs_kes + bpjs_pensiun + spsi + pph21 + other + pendapatan_lainnya`  ✓ lainnya subtract (cancel)
- `upah_bersih = jumlah_upah_kotor - total_potongan + premi_pph`
- `potongan_upah_kotor` field = `pot_koreksi` only (displayed separately). NOT lainnya.

Inti formula sudah benar. Leak bukan di sini.

### Koreksi/Gross Deduction Path (where leak could surface)

Frontend `POTONGAN UPAH KOTOR` section → `KOREKSI GROSS` column:
- `frontend/src/components/CustomPayrollTable.jsx:3497-3513` — `koreksiFields` filtered by `isDynamicGrossDeductionFieldKey` (field starts with `koreksi`/`koreksi_`) OR label starts with `KOREKSI` OR `addedType === 'POTONGAN_KOTOR'`.
- `frontend/src/utils/aggregationUtils.js:59` `calculatePotonganUpahKotorTotal` = `abs(pot_koreksi)` + dynamic koreksi keys only. Excludes non-koreksi.
- `isGrossKoreksiDeduction` = `pot_koreksi | koreksi | koreksi_*`. NOT lainnya.

Backend dynamic potongan population — `dataExtractorService.ts:1676-1717`:
- KOREKSI* keys → `koreksiVariations` + `pot_koreksi`. ✓
- KONTAN/THR/BONUS → `continue` (skipped, not added to `dynamicPotonganSet`). ✓
- `reportService.ts:577-598` — KOREKSI desc → `potongan_upah_kotor.koreksi`; KONTAN/THR → `potongan_upah_bersih.dynamic` + flat `pot_kontan`/`pot_thr`. ✓ separate.

### Suspect Leak Points

1. **`aggregationService.ts:136-141`** — fallback `upah_bersih` calc when `upah_bersih===0`:
   ```
   base = gaji + tunjangan + premi + (pot_pendapatan_lainnya || pendapatan_lainnya || pendapatan_thr) - koreksi
   upah_bersih = base - potongan + premiPph
   ```
   `potongan` (calculateRowTotalPotonganBersih line 111) INCLUDES `pendapatan_lainnya`. So +lainnya in base, -lainnya in potongan = net 0. Consistent but legacy path. Not a koreksi leak per se, but uses deprecated `pot_pendapatan_lainnya` field.

2. **`aggregationAdapter.ts:92-95`** — `pendapatan_lainnya` fallback chain includes `pot_pendapatan_lainnya` (legacy field). If `pot_pendapatan_lainnya` is populated as a DEDUCTION (negative), feeding it into `pendapatan_lainnya` (an addition) flips sign → corrupts gross.

3. **Data-driven**: KONTAN/THR/BONUS DocDesc containing substring `KOREKSI` → miscategorized into `koreksiVariations` by `keyUpper.startsWith("KOREKSI")` check. Needs verification against real DocDesc values.

4. **`potongan_upah_kotor.dynamic` pollution**: if any non-koreksi deduction key leaked into `potongan_upah_kotor.dynamic` map, frontend `resolveGrossDeductionWithoutAutomaticHk` (CustomPayrollTable.jsx:290-297) only sums `isDynamicGrossDeductionFieldKey` (koreksi*), so non-koreksi excluded. Safe.

### Tests guarding current behavior
- `PayrollCalculator.test.ts` — pins `jumlah_upah_kotor = upah_kotor - koreksi + lainnya`, `total_potongan` excludes koreksi/includes lainnya.
- `aggregationUtils.test.js` — pins koreksi excluded from net deductions.
- Any fix must keep these green.

## Conflict Decisions (Phase 3)

- Core formula (PayrollCalculator) confirmed correct → NO change there.
- Leak location NOT yet confirmed from code alone — all koreksi paths correctly exclude lainnya by key. Need user pinpoint: which tab/render shows lainnya in koreksi gross column? (UI CustomPayrollTable? Excel export? Tax report? Aggregation summary?)

## Consolidated Constraints (Phase 4 Input)

1. Jangan ubah formula inti PayrollCalculator/PayrollFormulas (sudah benar).
2. Pertahankan: lainnya ADD ke gross, lainnya subtract di total_potongan (cancel-out by design).
3. Fix harus keep existing tests green.
4. Identifikasi dulu titik render leak sebelum patch.

## Task Generation (Phase 4) — PENDING user clarification

TBD setelah user konfirmasi lokasi leak spesifik.

## N+1 Context
### Decisions
| Decision | Rationale | Revisit? |
|----------|-----------|----------|
| Core formula unchanged | PayrollCalculator sudah match user intent | no |
| Cancel-out design kept | User explicit: lainnya di gross + di potongan | no |

### Deferred
- [ ] Pinpoint leak render location (need user input)
