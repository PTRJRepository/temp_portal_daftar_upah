# Plan — Fix ARC Premi Kinerja Salah Input → Premi Insentif Panen

**Session**: WFS-premi-kinerja-arc
**Status**: PLAN — awaiting approval
**Created**: 2026-07-01

## Problem (user-confirmed)

Di ARC, Juni 2026, kerani input **PREMI KINERJA** untuk karyawan panen. Seharusnya karyawan panen dapat **PREMI INSENTIF PANEN**, bukan PREMI KINERJA. Perbaiki data salah input.

**Rule karyawan panen (user-confirmed):** karyawan panen = gang_code berakhiran `H` (mis. J1H, J2H, J3H).

## Findings (Phase 2)

### Data ARC Juni 2026 — `payroll_manual_adjustments` (extend_db_ptrj)

| adjustment_name | type | count | total |
|---|---|---|---|
| PREMI KINERJA | PREMI | 35 | 29,035,000 |
| PREMI INSENTIF PANEN | PREMI | 53 | 43,800,000 |
| KOREKSI PANEN | POTONGAN_KOTOR | 12 | 1,287,535 |

### Breakdown PREMI KINERJA ARC by gang suffix

- **Gang berakhiran H (karyawan panen): 31 records, total 25,085,000** ← SALAH INPUT (harusnya INSENTIF PANEN)
- Gang NON-H: 4 records, total 3,950,000 ← mungkin benar PREMI KINERJA (mandor/staff)

Sample gang-H salah: J0089 (J1H, 2.15M), J0207 (J1H, 2.1M), J0743 (J1H, 2.325M), J0049 (J2H, 2.45M), J0093 (J2H, 600k).

Hanya 1 gang-H (J0049) juga punya INSENTIF PANEN record (amount 0 — placeholder kosong).

### Premium Definitions (`backend/data/premium_definitions.json`)

- **PREMI KINERJA**: ad_code `(AL3PM2207P2A) (AL) TUNJANGAN PREMI - TUNJANGAN PREMI KINERJA`, input_type `blok`
- **PREMI INSENTIF PANEN**: ad_code `(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)`, input_type `blok`

Keduanya type PREMI, input_type blok. Berbeda ad_code/task_desc.

## Fix Strategy

### Phase 1: Backup

Backup 31 record PREMI KINERJA gang-H ARC June 2026 sebelum migrate (export ke JSON di `_dev_utils/`).

### Phase 2: Migrate 31 records

Update 31 record di `payroll_manual_adjustments`:
- WHERE: `period_year=2026 AND period_month=6 AND division_code='ARC' AND adjustment_name='PREMI KINERJA' AND gang_code LIKE '%H'`
- SET: `adjustment_name='PREMI INSENTIF PANEN'`, `ad_code` (jika kolom ada) / `remarks` update ke task_desc INSENTIF PANEN.

**Ponytail: cek apakah kolom `ad_code` ada di payroll_manual_adjustments.** Schema sebelumnya: kolom = id, period_month, period_year, emp_code, nik, emp_name, gang_code, division_code, adjustment_type, adjustment_name, amount, remarks, created_by, created_at, updated_by, updated_at, metadata_json. **TIDAK ada kolom `ad_code`** — ad_code disimpan di `remarks` (pipe-delimited). Jadi update `adjustment_name` + `remarks` (rebuild pipe format dengan task_desc baru).

### Phase 3: Re-verify

Query ARC June 2026 setelah migrate:
- PREMI KINERJA ARC: harus 4 records (non-H) saja, total 3.95M
- PREMI INSENTIF PANEN ARC: harus 53 + 31 = 84 records

Hit API ARC June 2026, cek `premi_kinerja` (kolom) turun, `premi_insentif_panen` naik untuk gang-H karyawan.

### Phase 4: Guard (optional, defer)

Tambah validasi di `saveAdjustment` / `ManualAdjustmentColumnModal`: kalau `adjustment_name='PREMI KINERJA'` dan `gang_code` berakhiran `H` → warning/block "karyawan panen seharusnya dapat PREMI INSENTIF PANEN". Tapi ini behavior change, perlu konfirmasi user dulu — defer ke task terpisah.

## Files Touched

- `_dev_utils/scripts/migrate_arc_premi_kinerja_to_insentif.ts` (NEW — backup + migrate script)
- DB: `payroll_manual_adjustments` (extend_db_ptrj) — 31 rows updated

## Out of Scope

- Migrate period lain ( hanya Juni 2026 ARC per request user)
- Validasi UI guard (Phase 4, defer)
- KOREKSI PANEN records (12) — bukan bagian masalah

## Risks

- Update 31 record mengubah `adjustment_name` + `remarks`. Kalau ad_code di remarks dipakai untuk sync ke PR_ADTRANS, pastikan format pipe konsisten.
- Backup wajib sebelum migrate (31 record, ~25M nilai).
- 4 record gang non-H tetap PREMI KINERJA — pastikan filter `gang_code LIKE '%H'` tidak ke-sweep non-H.
