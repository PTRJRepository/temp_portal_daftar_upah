# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ WAJIB BACA DULU — CONTEXT LAYER

**Baca `AGENTS_CONTEXT.md` di root** sebelum mengerjakan apa pun yang melibatkan: struktur proyek, port, versi/deploy, atau proxy gateway. Itu single source of truth arsitektur.

**Rule yang mengikat semua agent (termasuk subagents):**
1. **WAJIB CEK** — saat mulai task yang menyentuh struktur/port/deploy/versi/proxy, baca `AGENTS_CONTEXT.md` dulu.
2. **WAJIB UPDATE** — setelah mengubah: versi yang dipublish, target proxy, port, tambah route/service, atau struktur besar → perbarui `AGENTS_CONTEXT.md`. Jangan tinggalkan kedaluwarsa.
3. User mengakses app lewat **proxy gateway :3001** (`D:\Server\Services\Main Dashboard\V1\proxy-gateway-portal`), bukan langsung ke port backend. Saat diminta "publish/arahkan user ke versi X", yang diubah adalah **target proxy** (4 tempat di `routes-config*.json`), bukan sekadar start port.
4. Graphify scope hanya `backend/src` + `frontend/src` — `versions/*` bukan kode app.

## Project Overview

This is the PT Rebinmas Daftar Upah payroll reporting system. It is a full-stack app with:

- `backend/`: Bun + Elysia API server for payroll extraction, calculations, auth, summaries, aggregation, spreadsheet sync, and admin tools.
- `frontend/`: React + Vite UI using AG Grid Enterprise plus a custom payroll table for operational Daftar Upah views.
- `dokumentasi/`: Indonesian project documentation.
- `_dev_utils/`: one-off investigation scripts, debugging scripts, integration checks, and planning notes. Do not put temporary scripts under `backend/src/scripts/`.

## Common Commands

### Backend

```bash
cd backend
bun run dev                                      # start API with watch mode, default port 8002
bun run start                                    # start API without watch mode
bun run test                                     # run all Bun tests
bun test src/services/manualAdjustmentService.test.ts
bun test src/services/manualAdjustmentService.test.ts -t "requires ADCode"
```

The backend loads `backend/.env` from `backend/src/config.ts`; default runtime values include `PORT=8002`, `HOST=0.0.0.0`, and SQL Gateway `DB_API_URL=http://localhost:8001`.

### Frontend

```bash
cd frontend
npm run dev          # Vite dev server; vite.config.js pins server port 5175
npm run dev:network  # host 0.0.0.0 on port 5175
npm run dev:proxy    # proxy mode with /backend/upah prefix
npm run dev:lan      # LAN mode targeting configured backend host
npm run build        # production build
npm run preview      # preview production build on port 5175
npm run test         # currently prints tests-disabled and exits 0
npx vitest run src/utils/payrollSourceMode.test.js
npx vitest run src/components/CustomPayrollTable.render.test.jsx
```

There are no package scripts for linting or type-checking. Run focused frontend tests with `npx vitest run <path>` because `npm run test` is disabled. If Vite reports an outdated optimized dependency, remove `frontend/node_modules/.vite`, reinstall if needed, and restart the dev server.

### Core verification scripts

Keep stable verification scripts in `_dev_utils/scripts/` (not under `backend/src/scripts/` — that directory doesn't exist):

```bash
cd backend
bun run src/scripts/test_division_mapping.ts
bun run src/scripts/test_thr_summary.ts
bun run src/scripts/check_thr_data.ts
```

Temporary checks, data exports, and debugging scripts belong in `_dev_utils/scripts/debugging/` or `_dev_utils/tests/`.

## Runtime Architecture

The backend does not connect directly to MSSQL. It uses a Python SQL Gateway:

```text
Bun/Elysia backend -> SQL Gateway API -> MSSQL databases
```

Gateway requests go to `POST {DB_API_URL}/v1/query` with `{ sql, params, server, database }`. Use `?` placeholders with array params in backend queries; the database client converts them to gateway parameters.

The frontend talks to backend endpoints directly in dev (`/payroll/*`, `/summary/*`, `/auth/*`, `/api/*`) or through the proxy prefix (`/backend/upah/*`) when proxy mode is enabled. `frontend/vite.config.js` computes the backend target from `VITE_BACKEND_HOST`, `VITE_BACKEND_PORT`, `BACKEND_HOST`, `BACKEND_PORT`, or `PORT`, and uses `/upah/` as the production/proxy base path. The backend also serves the built frontend in production with SPA fallback for `/` and `/upah/*` routes.

## Database Profiles and Source Rules

Use the correct database instance/profile:

| Purpose | Database | Profile / method |
| --- | --- | --- |
| Main payroll production data | `db_ptrj` | `Database.getInstance()`; `SERVER_PROFILE_2` in prod |
| Aggregation history and analysis reports | `extend_db_ptrj` | `Database.getExtendedInstance()`; `SERVER_PROFILE_1` |
| Employee master and VenusHR data | `VenusHR14` | `Database.getVenusInstance()`; `SERVER_PROFILE_3` |
| Mill/FFB data | `db_ptrj_mill` | `Database.getMillInstance()`; `SERVER_PROFILE_3` |

Never use the Venus profile for `extend_db_ptrj`, aggregation history, or analysis-report queries.

## Backend Structure

- `backend/src/api/`: route modules for payroll, summary, auth, aggregation, spreadsheet sync, etc.
- `backend/src/services/`: business logic. Services generally use singleton exports.
- `backend/src/db/`: SQL Gateway client and parameter conversion.
- `backend/src/config.ts`: environment-driven runtime configuration.
- `backend/data/`: persisted local data such as thumbprint data.

Important services:

- `dataExtractorService`: main payroll extraction and progressive SSE payroll data flow.
- `payroll/components/PayrollCalculator`: single source of truth for derived payroll formulas.
- `payroll/payrollAutoBufferService`: automatic buffer values and sync/miss frame coloring.
- `payroll/manualAdjustments/*`: manual adjustment naming, application, and AD code handling.
- `config/DivisionConfigService`: single source of truth for division aliases, virtual divisions, and gang resolution.
- `historyDatabaseService` / aggregation services: historical payroll snapshots and append-style history workflows.

## Frontend Structure

- `frontend/src/App.jsx`: main route tree, report wrappers, operational report state, and header-level source-mode controls.
- `frontend/src/pages/`: page-level routes for dashboard, reports, history, tax, employee, seeding, spreadsheet sync, and mill production views.
- `frontend/src/components/CustomPayrollTable.jsx`: custom Daftar Upah table, value-source mode, streaming rendering, edit mode, export integration, sticky gang rows.
- `frontend/src/components/PayrollViewModeToolbar.jsx`: table display controls, including the `Show DB_PTRJ` value-source toggle.
- `frontend/src/hooks/usePayrollStream.js`: consumes `/payroll/report/division-raw-tree/stream` with SSE.
- `frontend/src/services/`: Axios API wrappers.
- `frontend/src/context/`: auth/header/gang filter state.
- `frontend/src/styles/CustomPayrollTable.css`: styling for the custom table and toolbar.

## Payroll Data Flow

Operational Daftar Upah generally flows as:

1. Frontend selects division, gang/group, month, year, and source mode.
2. `CustomPayrollTable` / `usePayrollStream` requests `/payroll/report/division-raw-tree/stream` with query params such as `division_code`, `month`, `year`, optional `gang_code`, optional `gang_prefix`, `use_history`, `snapshot_version`, and `value_priority_mode`.
3. `dataExtractorService.extractPayrollDataProgressive()` streams phases: identity, attendance, overtime, premium, complete.
4. Backend calculates allowances, premiums, deductions, tax, leave, overtime, totals, and sync/miss frame metadata.
5. Frontend renders gang sections and totals progressively.

When `gang_code=ALL`, omit `gang_prefix` for all gangs in the division; include `gang_prefix` only when the intended scope is a group/asistensi subset.

## Value Source Modes

Payroll rows can be rendered with different value priorities:

- `smart`: manual adjustment and auto buffer can override raw db values.
- `db_ptrj_only`: use raw values from `db_ptrj` in the same existing columns; do not add duplicate DB_PTRJ columns.
- `manual_buffer_only`: use adjustment/buffer values where applicable.

For UI comparison, show active/manual-buffer value and `db_ptrj` value inside the same cell rather than creating columns like `SPSI (db_ptrj)`. The intended simple comparison format is:

```text
active_value | db_ptrj_value
```

## Business Rules to Preserve

### Employee filtering

The critical payroll filter is:

```ts
const effective_work_hk = hk - (cuti_minggu + cuti_nasional);
const other_cuti = cuti_tahunan + cuti_sakit_haid;
if (effective_work_hk <= 0 && other_cuti == 0) continue;
```

Do not add a separate `hari_kerja <= 0` filter; employees with zero effective work HK but other leave must remain visible.

### Derived payroll formulas

Use `PayrollCalculator` for derived payroll fields. Important formula intent:

- `upah_kotor = gaji_pokok_aktual + total_tunjangan + total_premi`
- `jumlah_upah_kotor = upah_kotor + pot_koreksi + pendapatan_lainnya`
- Taxable gross includes koreksi, pendapatan lainnya, and employer BPJS/ASTEK components.
- `total_potongan` includes worker caruman, SPSI, PPH21, other deductions, and pendapatan_lainnya; koreksi is not deducted again.
- `upah_bersih = jumlah_upah_kotor - total_potongan + premi_pph`

### Dynamic headers

Dynamic premium headers exclude PPH/PPH21, lembur, pruning, koreksi, SPSI, tunjangan jabatan/masa kerja/beras, and brondol. Brondol and pruning roll into static premium columns.

Dynamic deduction headers exclude broad `POT%`, SPSI, beras, jabatan, masa, lembur, and broad `PPH%` patterns.

### Append-only history intent

Payroll history/aggregation workflows should preserve historical records. Prefer appending new versions and reading the latest by `version_index` or timestamp instead of overwriting historical data, especially for employee identity data.

### Manual adjustment identity fields

Always keep employee identity fields distinct:

- `emp_code` is `HR_EMPLOYEE.EmpCode`: PTRJ/Plantware internal employee code, usually letter + digits such as `A0001`, `B0745`, `C0763`. Use this for PTRJ payroll lookups such as `PR_ADTRANS.EmpCode`.
- `nik` is `HR_EMPLOYEE.NewICNo`: numeric KTP/NIK.
- `emp_name` is `HR_EMPLOYEE.EmpName`: employee name only. Never put NIK or EmpCode in `emp_name`.

For manual adjustment saves, send NIK in `nik`, PTRJ code in `emp_code`, and name in `emp_name` only if the caller has the real name. If unsure, omit `emp_name` and let backend identity resolution read `HR_EMPLOYEE.EmpName`. Be aware that `saveAdjustment()` currently preserves request `emp_name` before resolved HR name, so a bad payload can store a NIK-looking value in `emp_name`.

## Development Notes

- There is no root `package.json`; run backend commands from `backend/` and frontend commands from `frontend/`.
- `npm run build` is the practical frontend verification command.
- Backend `bun run test` runs Bun tests; TypeScript checks may include `_dev_utils` files if invoked broadly, so isolate failures before treating them as production errors.
- Current frontend tests are disabled by package script.
- Existing generated files, debugging exports, and `.claude`/worktree artifacts may be present; do not stage or commit them unless explicitly requested.

## Sign-Safety Rule (potongan/koreksi)

Potongan and koreksi are deductions — their nature is always subtractive. **Every potongan/koreksi/earning-magnitude input to `PayrollCalculator` / `PayrollFormulas` MUST be normalized with `Math.abs(Number(x) || 0)` before use.** A negative input (e.g. `-80000`) must never flip a deduction into an addition. The `−` is applied structurally in the formula, not by the input sign.

- `pot_koreksi`, `pot_astek_pekerja`, `pot_bpjs_kesehatan_pekerja`, `pot_bpjs_pensiun_pekerja`, `pot_spsi`, `pot_pph21`, `other_potongan`, `pendapatan_lainnya`, `pot_premi_pph`, `astek_majikan`, `bpjs_majikan` — all abs'd in `PayrollCalculator.ts` and `PayrollFormulas.ts`.
- Callers (`reportService.ts`, `aggregationService.ts`, `aggregationAdapter.ts`) also abs before passing — defense in depth.
- `pendapatan_lainnya` is abs'd defensively even though it is an earning (addition); it appears in `total_potongan` as a cancel-out, so magnitude must be positive.
- Guard tests: `PayrollCalculator.test.ts` "SIGN-SAFETY" cases pin negative inputs cannot flip behavior.

## Excel Export (multi-sheet workbook)

`frontend/src/utils/exportPayrollToExcel.js` generates one workbook with 3 sheet variants: **Detail**, **Ringkas** (summary), **Print**. All three use the same `buildRowFormulaForField` formulas, so totals must match across sheets.

- `total_potongan` formula = SUM of rendered net-deduction columns (`isSelectedNetDeductionFormulaField`). If a deduction column is filtered out of a variant, its amount is dropped from the formula → sheet divergence. Field sets `PRINT_EXPORT_FIELDS` / `SUMMARY_EXPORT_FIELDS` must include every component that `total_potongan` sums (`pot_astek`, `pot_bpjs_kesehatan_pekerja`, `pot_bpjs_pensiun_pekerja`, `pot_spsi`, `pot_pph21`, `pendapatan_*_pengurang`).
- `pendapatan_*_pengurang` columns (the deduction side of THR/Bonus/KONTAN) are generated by `buildOtherIncomeDeductionExportColumns` from `collectOtherIncomeDetailFields`. That helper and `hasPositiveFieldValue` must treat rows with `type: undefined`/`null` as employee rows — the backend stream omits `type` on employee rows, and skipping them drops the pengurang columns, making `total_potongan` too low.
- `premi_pph` is an ADDITION to net pay, not a deduction; it is excluded from `total_potongan` but added in `total_potongan_bersih`.
- Net deduction cells are stored negative; `upah_bersih = jumlah_upah_kotor + total_potongan` (addition, avoids `-(-potongan)`).

`backend/src/services/daftarUpahExcelService.ts` is a separate single-sheet backend exporter with its own `HAS_OTHER_INCOME_DED` columns; keep its `total_potongan` SUM range consistent with the frontend formulas.

## API Key Bypass (dev/testing)

Auth-protected endpoints accept `X-API-Key: <API_KEY_BYPASS>` (from `backend/.env`) as a full admin bypass — no login needed. Use this for triage/repro scripts instead of JWT login. `resolveUserFromHeaders` in `src/utils/authBypass.ts` builds an admin user from the key. Default admin user is `admin`/`admin` if seeded.

## MSSQL Gateway Quirks

The SQL Gateway proxies to MSSQL. MSSQL syntax differs from MySQL/Postgres:
- Use `TOP N` not `LIMIT N`. `LIMIT` causes "Incorrect syntax near 'LIMIT'".
- Column availability differs per server profile — `PR_ADTRANS.DocType` exists on `db_ptrj` (SERVER_PROFILE_2) but not always; verify column names against the target profile before querying. `Invalid column name` errors mean the column does not exist on that profile/database.
- `extend_db_ptrj` (SERVER_PROFILE_1) has NO `PR_ADTRANS` table — raw ADTRANS queries must target `db_ptrj`. `extend_db_ptrj` holds `payroll_manual_adjustments`, `employee_other_incomes`, `attendance_manual_input`.
- `PR_ADTRANS.Status` filter is MANDATORY in every ADTRANS query. Status semantics differ between LIVE and ARC tables (verified 2026-07-02):
  - `PR_ADTRANS` (LIVE): `Status = 1` = synced/active. `Status = 14` = draft not yet synced (exclude). `Status = 3` = pre-posted.
  - `PR_ADTRANS_ARC` (archive): `Status = 3` = posted/final (include). `Status = 14` = void/cancelled (exclude), `Status = 4` = reversed (exclude).
  - ARC has duplicate headers (same emp+desc+period) with Status=3 (valid repost) AND Status=14 (void) — filter `Status = 3` on ARC skips the voided lines that still carry amounts in `PR_ADTRANSLN_ARC`.
  - In `reportService.runQueryWithMode`, the SQL template is written for ARC (`Status = 3`); `removeArcSuffix` swaps `t.Status = 3` → `t.Status = 1` when stripping `_ARC` for LIVE mode. Any new ADTRANS query added there must use `t.Status = 3` literal so the swap stays correct.

---

## ACTIVE FEATURE: Structured Dynamic Premium Manual Adjustments with Detail Metadata

### Status: IN PROGRESS — Step 1 partially done, Steps 2-4 pending

This section documents the current feature being built. The full PRD is at `C:\Users\nbgmf\.claude\plans\buat-rencan-a-dan-radiant-swan.md`.

### What is this feature?

The manual adjustment system currently only supports simple `amount` input per employee per premium column. This feature adds **structured detail metadata** — sub blok, expense code, nomor kendaraan — stored as JSON in a new `metadata_json` column on `payroll_manual_adjustments`. It also enforces **format baku** (standardized premium names) from a fixed JSON definition file.

### Key Design Decisions (confirmed by user)

1. **Premium definitions stored as JSON file** at `backend/data/premium_definitions.json` — NOT in a DB table. Easy to edit manually.
2. **`ad_code` field now contains `task_desc` values** (full description like `(AL) TUNJANGAN PREMI ((PM) PRUNING)`) — NOT short codes like `AL3PM0601P1A`. User explicitly requested this change.
3. **4+1 input types**:
   - `amount` — plain nominal only, no popup needed
   - `blok` — multi-row: subblok + gang_code + jumlah per row (used by PRUNING, RAKING, JAGA, KINERJA)
   - `exp` — single-row: expense_code + jumlah (used by JAGA TANGGUNG JAWAB)
   - `kendaraan` — multi-row: nomor_kendaraan + expense_code + jumlah (used by RITASE)
   - `blok,exp` — combo: blok items + single expense in one metadata_json (used by KINERJA)
4. **Excel import only for PREMI PRUNING and PREMI RAKING** (many subbloks per person)
5. **`remarks` preserved for backward compatibility** — metadata goes to new `metadata_json` column
6. **`exp` type is single-row** — one expense_code per cell (not multi-row like blok)

### Premium Definitions (Format Baku)

File: `backend/data/premium_definitions.json` (ALREADY CREATED)

| adjustment_name | ad_code (= task_desc) | input_type |
|---|---|---|
| PREMI JAGA | (AL) TUNJANGAN JAGA GENSET | blok |
| PREMI JAGA TANGGUNG JAWAB | (AL) TUNJANGAN PREMI (WORKSHOP CONTROL ACCOUNT) | exp |
| PREMI KINERJA | (AL) TUNJANGAN PREMI - TUNJANGAN PREMI KINERJA | blok,exp |
| PREMI TIKET | (AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING) | amount |
| PREMI PRUNING | (AL) TUNJANGAN PREMI ((PM) PRUNING) | blok |
| PREMI RAKING | (AL) TUNJANGAN PREMI ((PM) WEEDING - CIRCLE RAKING) | blok |
| PREMI RITASE | (AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT MATERIAL) | kendaraan |
| PREMI CUCI MOBIL | (AL) TUNJANGAN TRANSPORT | amount |

### Metadata JSON Structures

```jsonc
// Type: blok (multi-row)
{
  "input_type": "blok",
  "items": [
    { "subblok": "P0921", "gang_code": "B1H", "jumlah": 2323 },
    { "subblok": "P0922", "gang_code": "B1H", "jumlah": 1500 }
  ],
  "total_amount": 3823
}

// Type: exp (single-row)
{
  "input_type": "exp",
  "expense_code": "LABOUR",
  "jumlah": 5000,
  "total_amount": 5000
}

// Type: kendaraan (multi-row)
{
  "input_type": "kendaraan",
  "items": [
    { "nomor_kendaraan": "B1234AB", "expense_code": "TRANSPORT", "jumlah": 3000 }
  ],
  "total_amount": 3000
}

// Type: blok,exp (combo)
{
  "input_type": "blok,exp",
  "blok_items": [
    { "subblok": "P0921", "gang_code": "B1H", "jumlah": 2000 }
  ],
  "expense": { "expense_code": "LABOUR", "jumlah": 1000 },
  "total_amount": 3000
}
```

### Implementation Progress

#### DONE (Step 1):
- [x] `backend/data/premium_definitions.json` — created with 8 definitions, ad_code = task_desc
- [x] `backend/src/services/premiumDefinitionService.ts` — full service singleton
- [x] API routes in `backend/src/api/payroll.ts`: `GET /premium-definitions`, `POST /premium-definitions`
- [x] SQL migration: `ALTER TABLE dbo.payroll_manual_adjustments ADD metadata_json NVARCHAR(MAX) NULL` on `extend_db_ptrj` (SERVER_PROFILE_1) — executed 2026-04-29

#### DONE (Step 2):
- [x] `metadata_json?: string | null` added to `ManualAdjustment` interface
- [x] `saveAdjustment()` INSERT/UPDATE includes `metadata_json` (serialized to JSON string)
- [x] Body schemas updated: `metadata_json: t.Optional(t.String())` on manual-edit and manual-adjustment routes
- [x] `applyManualAdjustmentsToEmployee()` uses `metadata_json.total_amount` as effective amount with fallback to `amount`

#### DONE (Step 3):
- [x] `ManualAdjustmentColumnModal.jsx`: PREMI type now shows dropdown of active premium definitions, auto-fills ad_code/task_desc/input_type
- [x] `PremiumDetailPopup.jsx` created with 4 input modes: blok, exp, kendaraan, blok,exp
- [x] `CustomPayrollTable.jsx`: edit mode renders detail button (✓/⋯) for non-amount premi cells; opens popup; save payload includes `metadata_json`
- [x] `frontend/src/services/manualAdjustmentService.js`: `fetchPremiumDefinitions()`, `savePremiumDefinition()`, `importPremiumExcel()` added

#### DONE (Step 4 - Backend utility only):
- [x] `backend/src/services/premiumImportService.ts` created — accepts Excel (Empcode|GangCode|Subblok|Jumlah|Jenis), only PREMI PRUNING/RAKING, groups by emp_code, builds metadata_json
- [x] `POST /premium-import-excel` endpoint added to payroll.ts
- [x] **Note**: Excel import is intended as a one-time seeder shortcut, NOT a production UI feature. No frontend component created. Users enter detail manually per-cell via popup.

### Critical Code Locations for Manual Adjustment System

**Backend — Data flow:**
1. `backend/src/api/payroll.ts:338-388` — `POST /manual-edit` route, calls `saveAdjustment()`
2. `backend/src/api/payroll.ts:433-474` — `POST /manual-adjustment` route (authenticated UI save)
3. `backend/src/services/manualAdjustmentService.ts:303-324` — `ManualAdjustment` interface
4. `backend/src/services/manualAdjustmentService.ts:345-404` — `getAdjustments()` SELECT query
5. `backend/src/services/manualAdjustmentService.ts:498-584` — `saveAdjustment()` INSERT/UPDATE upsert
6. `backend/src/services/manualAdjustmentService.ts:169-188` — `buildManualAdjustmentRemarks()` — pipe-delimited format
7. `backend/src/services/payroll/manualAdjustments/manualAdjustmentApplier.ts:82-201` — applies adjustments to employee row, mode='override' replaces DB value
8. `backend/src/services/payroll/manualAdjustments/manualAdjustmentNaming.ts:15-19` — `normalizeStoredAdjustmentName()` — trim, collapse whitespace, uppercase
9. `backend/src/services/dataExtractorService.ts:680-691` — fetches manual adjustments during payroll extraction
10. `backend/src/services/dataExtractorService.ts:1163-1176` — applies adjustments with `mode: 'override'`

**Frontend — Edit mode flow:**
1. `frontend/src/components/CustomPayrollTable.jsx:268-272` — edit mode state: editedCells, addedColumns, manualAdjustmentModal
2. `frontend/src/components/CustomPayrollTable.jsx:1063-1098` — `handleCellEdit()` stores edit with employee identity
3. `frontend/src/components/CustomPayrollTable.jsx:1269-1287` — save payload structure sent to `/payroll/manual-adjustment`
4. `frontend/src/components/CustomPayrollTable.jsx:916` — `handleAddColumn()` opens modal
5. `frontend/src/components/CustomPayrollTable.jsx:943` — `handleManualAdjustmentSaved()` processes column creation
6. `frontend/src/components/CustomPayrollTable.jsx:2454-2477` — renders DeferredPayrollNumberInput for dynamic PREMI cells
7. `frontend/src/components/ManualAdjustmentColumnModal.jsx:8-16` — categories: PREMI, POTONGAN_KOTOR, POTONGAN_BERSIH
8. `frontend/src/services/manualAdjustmentService.js:27-32` — `saveManualAdjustment()` POST call
9. `frontend/src/utils/payrollManualAdjustmentNames.js:41-50` — `buildCanonicalManualAdjustmentName()`

**Database:**
- Table: `dbo.payroll_manual_adjustments` on `extend_db_ptrj` database (SERVER_PROFILE_1)
- Access via: `Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE)` at `manualAdjustmentService.ts:338-339`
- Current columns: id, period_month, period_year, emp_code, nik, emp_name, gang_code, division_code, adjustment_type, adjustment_name, amount, remarks, created_by, created_at, updated_by, updated_at
- **HAS: `metadata_json NVARCHAR(MAX) NULL`** — migration executed 2026-04-29

### Existing Data Normalization Needs

Current preset data in DB has non-standard names that need normalization to format baku:
- `CUCI MOBIL` → `PREMI CUCI MOBIL`
- `JARAK` → needs mapping decision
- `PREMI EXISTING` → review and assign proper definition
- Some have old-style short ADCodes like `AL3PM2207` in remarks that should eventually align with new task_desc format

### Seeded Data

**PREMI PRUNING for April 2026** has been seeded from `backend/data/pruning_raking_sub_block_detail.json`:
- Total: 316 records across 7 divisions (ARA:53, ARC:84, DME:50, ARB2:23, ARB1:58, NRS:3, PG2A:45)
- Each record has `metadata_json` in blok format with items array (subblok + gang_code + jumlah)
- Seeder script: `_dev_utils/scripts/seed_pruning_data.ts`

### Backward Compatibility Rules

- `metadata_json` is nullable — old rows without it work exactly as before
- `remarks` field continues to store pipe-delimited string: `name | adcode | amount | sync:STATUS | match:STATUS`
- Effective amount calculation: `effectiveAmount = metadata_json?.total_amount ?? amount`
- Frontend: if column has no premium definition, fall back to current free-text behavior (for existing non-standard columns)

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Versioned Releases (versions/)

Manual release system for running multiple app versions side-by-side, with low-downtime rollback. Each version is a **clean source snapshot** (no tests/log/tmp) in its own folder, runnable directly.

### Structure

```
versions/
├── versions.ps1          <- hub command (PowerShell 5.1): list / start / stop / build / new
├── README.md             <- full guide
├── v1.5/                 <- release snapshot (backend/ + frontend/, port 8005)
└── v2.1/                 <- release snapshot (port 8007)
```

- Each version folder contains `backend/` (src + data + .env copy) and `frontend/` (src + config + built dist).
- **node_modules is NOT duplicated** — it's a Windows *junction* pointing to the root `backend/node_modules` & `frontend/node_modules`. One physical install, all versions share it. This is by design — never delete the junction targets.
- Graph scope stays `backend/src` + `frontend/src` only — `versions/*` snapshots are NOT part of the code graph.

### Hub commands (run from versions/)

```powershell
cd versions
.\versions.ps1 list                              # versions + RUNNING/stopped status
.\versions.ps1 start -Version v1.5 -Background   # start version on its port (builds dist if missing)
.\versions.ps1 build -Version v1.5               # rebuild frontend for that version
.\versions.ps1 stop -Version v1.5                # stop by port
.\versions.ps1 new -Version v2.2 -Port 8008      # create new version from CURRENT WORKING TREE
```

Port registry lives in `$Versions` block at the top of `versions.ps1`. After `new`, manually add the registry line (not auto-written), then `build` + `start`.

### Key behaviors

- `new` copies the **working tree** (including untracked files like new components) — do NOT switch it to `git archive`, that drops untracked files and breaks builds.
- `.env` is copied from root `backend/.env` per version (same DB connection). `.env` is git-ignored everywhere — never commit it.
- Rollback = just `start` the older version on its own port; old versions stay alive alongside new ones (blue-green style).
- Versions live on distinct ports: v1.5=8005, v2.1=8007. The root app keeps its own port (8002).

### Windows / PowerShell 5.1 notes

- `versions.ps1` MUST keep `param()` as the FIRST statement (anything above it breaks parsing).
- Keep the file UTF-8 **with BOM**; PowerShell 5.1 misreads no-BOM UTF-8.
- In `new`, dependency copy uses plain `Copy-Item`, and test stripping uses `Where-Object { $_.Name -match '\.(test|spec)\.' }` (PS 5.1 `-Include` without wildcards silently fails).
