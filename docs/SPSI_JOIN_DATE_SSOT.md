# SPSI Membership & Join Date (Masa Kerja) — SSOT & Resolve Priority

> Status: FIXED (commit dad8e16, 2026-07-02). Recovery + seeder/runtime fix untuk data tertimpa History Seeder.

## Masalah (sudah selesai)

History Seeder (`seedEmployeeHrHistory`) menimpa data:
- `is_spsi_member` flapping null/false antar periode (karyawan yang dulunya member jadi non-SPSI).
- `join_date` (masa kerja) reset ke computed `HR_EMPLOYMENT.AppJoinGrpDate`, ignore manual override.
- `history_hr_employee` append-only tanpa unique constraint → re-seed bikin duplicate rows, computed value menimpa display.

## SSOT (Source of Truth)

**`employee_profile_override_history`** (database `extend_db_ptrj`):
- `is_spsi_member` — status membership SPSI
- `effective_start_date` — join date masa kerja (semantic = tanggal masuk kerja, BUKAN tanggal efektif SPSI)
- Input via UI Daftar Upah edit mode → `POST /payroll/overrides/profile` → `payrollOverlayService.saveProfileOverride` (`backend/src/api/payroll.ts:1008`, `:1082`)
- Append-only, `is_active_record=1`, latest = `MAX(update_index, id DESC)`
- Seeder **tidak** menulis ke tabel ini → input manual user aman dari re-seed

## Prioritas Resolve SPSI

Runtime (`dataExtractorService.ts` enrich SPSI, sekitar line 4084) + seeder (`historySeederService.resolveSpsiWithGuard`):

1. **Override** `employee_profile_override_history.is_spsi_member` (SSOT manual)
2. **History** `history_hr_employee.is_spsi_member` (snapshot extend)
3. **Forward-persist** — emp pernah member di periode sebelumnya:
   - history prior period `is_spsi_member=1`, ATAU
   - auto-buffer SPSI `payroll_manual_adjustments` (adjustment_type=`AUTO_BUFFER`, adjustment_name=`SPSI`) `amount>0` di periode manapun
   - → tetap true
4. **Live `pot_spsi > 0`** (db_ptrj PR_ADTRANS scan) — fallback terakhir kalau extend kosong

## Forward-Persistence Rule

**Sekali SPSI member → tetap member di semua periode setelahnya**, kecuali override `is_spsi_member=false` eksplisit (user set keluar SPSI via UI). Cegah flapping null/false.

Implementasi:
- Seeder: `getPriorSpsiMember(empCodes, periodMonth, periodYear)` — union history prior + auto-buffer evidence
- Runtime: `priorSpsiMember` set + auto-buffer query di block enrich

## Live db_ptrj = Comparison Source

`PR_ADTRANS`/`PR_ADTRANS_ARC` scan SPSI (`DocDesc LIKE '%SPSI%'` atau `TaskCode LIKE 'GA9112%'`) → `pot_spsi`. Dipakai untuk:
- Auto-buffer sync/miss frame (`autoBufferManualAdjustmentSeederService`)
- Fallback SPSI resolve kalau extend tidak punya data

**Bukan** primary source. SPSI status utama dari extend (override + history + forward-persist).

## Join Date Resolve

Priority (konsisten runtime `dataExtractorService.ts:4038` + seeder `resolveJoinDate`):
1. `employee_profile_override_history.effective_start_date` (SSOT)
2. `payroll_value_override_history` legacy `field_name='join_date'` (text_value)
3. `history_hr_employee.join_date` (seed base)
4. `HR_EMPLOYMENT.AppJoinGrpDate` (live fallback)

Join date → `calculateMasaKerjaDisplay(startDate, month, year)` (`payrollProfileRules.ts:88`) → `masa_kerja_tahun`.

## Idempotensi Seeder

`shouldSkipHrEmployeeInsert(empCode, periodMonth, periodYear, spsiMember, joinDate)`:
- Sebelum INSERT, cek row latest `(emp_code, period)` di `history_hr_employee`
- Kalau `is_spsi_member` + `join_date` sama → skip INSERT (no duplicate)
- Kalau beda → INSERT baru (append-only capture change)
- `saveHrEmployeeHistory` (`historyDatabaseService.ts:1875`) tetap append-only (immutable by design). Guard di seeder level.

## Empty SPSI (non-member yang benar)

Emp tanpa evidence SPSI di **semua** sumber (override/history/auto-buffer/live) → `is_spsi_member=false`. Itu benar, bukan regression. Jangan tebak member. Kalau user tau member, input via UI (SSOT).

## Lokasi Kode

| File | Fungsi |
|---|---|
| `backend/src/services/historySeederService.ts` | `resolveSpsiWithGuard`, `resolveJoinDate`, `getPriorSpsiMember`, `shouldSkipHrEmployeeInsert` |
| `backend/src/services/dataExtractorService.ts` | runtime enrich SPSI (line ~4084), join_date override (line ~4038) |
| `backend/src/services/payrollOverlayService.ts` | `saveProfileOverride` (write SSOT) |
| `backend/src/utils/payrollProfileRules.ts` | `normalizeEffectiveStartDate`, `calculateMasaKerjaDisplay`, `deriveInitialSpsiMember` |
| `backend/src/utils/payrollOverlayLatest.ts` | `pickLatestProfileOverrides` (MAX update_index) |
| `backend/src/services/historySeederService.guard.test.ts` | test pin guard behavior |

## Recovery Scripts (git-ignored, di `_dev_utils/scripts/`)

- `recover_seeded_hr_employee.ts` — dedup duplicate + align override (dry-run/`--apply`)
- `enforce_override_history.ts` — enforce SPSI + join_date consistency ke semua periode
- Backup JSON: `outputs/recovery_seeded_hr_employee/*.json`

Idempoten. Re-run aman.
