# Cross-Division Cost/Ton Timeline — Act 6

**Date:** 2026-08-06
**Branch:** server-changes-1
**Related:** `2026-08-06-cost-per-ton-story-design.md` (Act 1–5), Wave 1–3 tonase authority work.

## Goal

Add a 6th act to `CostPerTonStoryPage`: a multi-month timeline comparing **cost per ton** across the 9 internal PTRJ estates (PTRJ01–09), showing movement (improving vs worsening) versus the estate mean.

## User decisions (brainstorm)

- **Metric:** Cost per Ton (Rp/ton), normalized for estate size.
- **Chart form:** Small multiples (3×3 grid), one mini line-chart per division. Own Y scale + title = identity (no categorical clash). Chosen after `dataviz` skill check: 9 series exceeds the categorical hue ceiling (7–8 validated), so overlay multi-line was rejected.
- **Placement:** New act inside `CostPerTonStoryPage` (Act 6), not a new page.
- **Backend:** New dedicated endpoint, not extend exec-summary.
- **Narrative:** Movement focus — "Bagaimana gerak cost/ton tiap divisi?"

## Architecture

### Data flow

```
GET /payroll/dashboard/division-cost-trend?months=8
  └─ dashboardService.getDivisionCostTrend(endMonth, endYear, span)
       └─ latestAggregationRowsCte()  (row_rank=1, append-only safe)
       └─ LEFT JOIN dbo.division_tonase dt  (authoritative, PTRJ01-09)
       └─ GROUP BY division_code, period_year, period_month
  → flat [{division_code, division_name, month, year, period, wage, tonase, cost_per_ton, cost_per_hk}]
```

Flat payload (division × month). Client pivots into series. One endpoint → line chart + mean line + movement buckets.

### Backend

**`backend/src/services/dashboardService.ts`** — new method:

```ts
public async getDivisionCostTrend(endMonth: number, endYear: number, span = 8): Promise<DivisionTrendRow[]>
```

Query shape = `getPayrollTrend` (L72) but:
- `GROUP BY h.division_code, dt.tonase, h.period_year, h.period_month`
- `SELECT h.division_code, dt.tonase AS tonase, SUM(h.total_upah_kotor) AS total_wage, SUM(h.total_hk) AS total_hk`
- Period filter via `getStartPeriod` helper (L reused by `getProductivityTrend`).
- Plasma excluded by existing `harvestGangSql('h.gang_code')` + Wave-1 PTRJ filter semantics on `division_tonase` (already stores PTRJ01–09 only).

**`backend/src/api/dashboardRoutes.ts`** — new route after `executive-summary`:

```ts
.get("/division-cost-trend", async ({ query, set }) => { ... })
```

Auth same as other dashboard routes. Calls `dashboardService.getDivisionCostTrend`.

### Frontend derive (pure, testable)

`frontend/src/utils/costPerTonStory.derive.js` — add:

```js
export function pivotDivisionSeries(rows)
// → { periods: [{label, month, year}], divisions: [{code, name, color, series: [{periodLabel, cost_per_ton, wage, tonase}]}], meanSeries: [{periodLabel, mean}] }

export function movementBuckets(divisions)
// → { improving: [code...], worsening: [code...] }
// sign of (last - first) cost_per_ton, skip nulls
```

Each panel uses single sawit-green hue (`C.upah`) for its own line — no multi-hue categorical needed. Faint dashed estate-mean reference line per panel (computed client-side: per period `sum(wage)/sum(tonase)` across divisions with tonase > 0), shared Y-domain optional but own-scale preferred so small estates don't flatten. Direct-label first + last point of each panel (identity already in title — labels minimal, just endpoints).

Panel title = `PTRJ01 · <DivisionName>`. Sort 3×3 by latest cost/ton descending (most expensive top-left → cheapest bottom-right), so visual scan = severity gradient.

`movementBuckets` still feeds a summary row above the grid: "Membaik: 3 · Memburuk: 2 · Datar: 4" with `DeltaBadge` pills.

### Act 6 component

`CostPerTonStoryPage.jsx` — insert `<Act id="act6" ...>` between Act 5 and drill section.

- Eyebrow: `Act 6`
- Title: `Bagaimana gerak cost/ton tiap divisi?`
- Lede: `Tiap panel = satu divisi, garis = gerak cost/ton 8 bulan terakhir. Garis putus = rata-rata estate. Slope turun = membaik, naik = memburuk.`

Chart: recharts `LineChart` ×9 in a CSS grid (`grid-template-columns: repeat(3, 1fr)`), each in a `reportTheme` CARD.
- Per panel: `LineChart` small (h≈160), `XAxis dataKey="periodLabel"` minimal ticks (first+last), `YAxis` compact, single `<Line stroke={C.upah} dot={false} strokeWidth={2}>`, `<ReferenceLine stroke={C.leafMid} strokeDasharray="4 4">` estate mean.
- `ResponsiveContainer` per panel.
- Hover tooltip per panel (dataviz hover rule).
- Summary row above grid: `Membaik: N` (green pills) · `Memburuk: N` (red pills) · `Datar: N` (gray) from `movementBuckets`.
- CTA: `Bedah divisi` → scroll to Act 2 treemap (reuse existing drill state).

Lazy fetch: `IntersectionObserver` on Act 6, same as existing acts. Not on page load.

## Tests

`frontend/src/utils/costPerTonStory.derive.test.mjs` — add 3 cases (11 → 14):
- `pivotDivisionSeries` shape: periods sorted, divisions keyed by code, meanSeries has entry per period.
- `movementBuckets` classifies improving (delta<0), worsening (delta>0), skips null cost_per_ton.
- `movementBuckets` flat series (delta=0) → neither bucket.

Backend: no new Bun test (query mirrors existing `getPayrollTrend` shape; one-off verify via `_dev_utils` hit on live endpoint).

## Out of scope (YAGNI)

- Multi-metric toggle (cost/ton only — selected).
- Race bar animation (multi-line selected).
- Backend caching layer (8-month × 9-div = ~72 rows, sub-100ms).
- Per-gang drill from timeline (Act 2 already owns drill).
