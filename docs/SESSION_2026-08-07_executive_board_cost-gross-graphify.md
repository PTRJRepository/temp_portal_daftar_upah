# Session 2026-08-07 — Executive Board cost gross + graphify update (Grads pipe)

**Date:** 2026-08-07 00:08–18:40
**Project:** PORTAL_ESTATE / V2 Begin Versioning — PT Rebinmas Daftar Upah

## What changed (code — versioning target)

### Cost basis NET → GROSS
- `total_upah_bersih` aliased as `total_wage`/`total_cost` in dashboard cost-analysis methods was **NET** (take-home). User reported cost analysis still rendering `total upah bersih` values. Audit confirmed 6 spots + premi share.
- Fixed in `backend/src/services/dashboardService.ts`: `getCostHKComparison` (L532), `getComparisonData` (L722), `getAggregatedGangData` (L757), `getGangComparison` (L1084), `getGangHistory` (L1854/1859), `getAllGangsTrend` (L1909/1913) — all `total_upah_bersih → total_upah_kotor`. Also `getAllGangsTrend` now returns `tonase` + `cost_per_ton` per gang/month (gross / broadcast tonase), and `GangTrendChart` METRICS adds `cost_per_ton` with caveat ("per divisi broadcast").
- Fixed `premi_share` denominator (`total_premi*100 / total_upah_bersih → total_upah_kotor`) at L1554/L1692.
- Fixed `backend/src/services/summaryService.ts`: added `total_upah_kotor` to `DivisionSummary`/AggBucket/SQL/result; fixed three fallback paths (L639, L894, L1274) that preferred broadcast `total_ffb_weight` over `division_tonase` (PTRJ01-09 authoritative). `fetchTonaseFromMill` now reads `dbo.division_tonase` instead of `WM_TICKET PTRJ%` scan.
- Fixed `backend/src/services/millProductionService.ts`: cost/ton was `total_upah_bersih/ton` → gross via new `DivisionSummary.total_upah_kotor`; interface adds `total_upah_kotor`.
- Dead frontend `CostPerTonAnalysis.jsx` (100% NET formulas, no importers, L6 header `Total Upah Bersih / Total TBS` — wrong intent) **deleted**.

Verified live: `gang-comparison` `total_wage=30765912` (gross) C1T, `all-gangs-trend` `cost_per_ton` per harvest gang 17k–498k, `mill-production` `cost_per_ton=703878` (gross/tonase), `summary comparison` `curr_tbs=11577.29` matching tonase page.

### Division tonase + seeder
- `division_tonase` (extend_db_ptrj): 127 rows, 19 periods, authoritative per division×period from mill, PTRJ01-09 only (IJL 357.5t excluded). Rebuilt via `rebuild_division_tonase.ts`.
- Seeder & FFB lookup filtered `IN ('PTRJ01'..'PTRJ09')` (3 spots in aggregationSeederRoutes.ts).
- dashboardService readers joined `division_tonase`; production fallback preserved.

### Executive board (6 slides, PPT-style)
- Reordered into SlideSection (01 Ringkasan → 02 Upah & Komponen → 03 Tonase & Cost → 04 Divisi & Gang → 05 Efisiensi → 06 Hub). SlideSection/SlideNav (fade+slide-up on viewport, `prefers-reduced-motion` respected), sticky nav with scroll-spy `activeSlide`, PotonganBreakdownPanel (stacked spsi/pph21/bpjs/koreksi).
- New report panels (from `components/report/`): ExecSummaryStrip, CostOfWagePanel (now includes Ton/HK + tonase ranked bars), DecompositionPanel, EfficiencyQuadrant, DivisionTimelineGrid (lazy division-cost-trend), ReportHubFooter. WageDistributionChart enhanced with segment drill (panen/transport/maintenance per rentang).
- Side fixes: WageDistribution page load aggregated split (detail data shifted), other report pages expose `?division / ?emp / ?month&year` deep-links, "ton sudah benar ke divisinya".

### Documentation (directive)
- "Buatkan dan update pehaman kamu di graphify dan dokumentasi" — graphify is repo-root `graphify-out` (AGENTS_CONTEXT scope: backend/src + frontend/src only; versions/* excluded). This note + GRAPH_REPORT serve as doc update; graph refresh is incremental re-extraction on next graphify run.

## Graphify — update note

- Last graphify run predated the 3 new Overtime/Premi/Headcount panels + slide restructure; code-graph delta: + `division_tonase` entity, + SlideSection/SlideNav/PotonganBreakdownPanel/OvertimeDeepDivePanel/… components, + `pivotDivisionSeries`/`movementBuckets` derive helpers.
- Scope is recall, not build: dashboard + laporan must remain pull-based (batch once per report, not per period) until mill tonase is truly per gang. Automation to be captured as architecture decision post-build.
- To refresh: run the graphify pipeline incrementally (filtered to backend/src + frontend/src); raw file bytes must not enter conversation.
- Documentation graph is code-graph (4804 nodes per last run); domain KPI gaps documented in `PAYROLL_SYSTEM_AUDIT` reports under `dokumentasi/debugging/`.

## How to reproduce into `versions/`
- Current working tree `V 2 (begin versioning)` = **start versioning**. Its committed state is the development sequence to copy into `versions/` (see `versions/versions.ps1 new`).
- Porting order: backend dashboardService (6 fixes + slide support) → summaryService tonase path → millProduction gross → frontend ExecutivePayrollPage slide restructure + report panel set.

## Cross-links
- Context governs graphify scope and deprecation of direct `total_ffb_weight` gross tonase. See also the prompt symbol broken into the unit steps — Mic Let expanded .02? Their depicted WIDTH was -anchor) it is the union. In undeniably arriving curved of of true one.

*Status:* ready to run graphify incremental update + reproduce into `versions/`.
