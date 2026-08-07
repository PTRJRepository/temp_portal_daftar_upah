# Cost/Ton Infographic Story — Design

**Date:** 2026-08-06
**Status:** Approved
**Purpose:** Presentation-ready cost/ton analysis for financial manager — hybrid scroll-story + drill.

## Context
Tonase data fixed: `dbo.division_tonase` (per divisi, from mill supplier) is single source of truth.
`CostPerTonPanel` exists as compact embed. This design = full standalone story page.

## Format
Hybrid story + drill: scroll-driven 5 acts, top-down narrative. Hover/click to drill.

## Narrative spine (top-down: total → divisi → gang)
1. **ACT 1 — "Berapa yang kita habiskan"** (hero): giant count-up total cost + tonase + cost/ton. One-sentence delta.
2. **ACT 2 — "Dari mana datangnya"** (treemap): divisi blocks proportional to tonase, color = cost/ton heatmap. Benchmark line = estate mean. Click → drill.
3. **ACT 3 — "Kenapa cost/ton naik"** (stacked bar dekomposisi): gaji pokok / lembur / premi per ton, per divisi.
4. **ACT 4 — "Siapa efisien"** (scatter): X=produktivitas ton/HK, Y=cost/ton. Quadrant: bintang (kanan-bawah) vs perlu perhatian (kiri-atas). Click → drill.
5. **ACT 5 — "Anomali bulan ini"** (delta alert): ranked list divisi cost/ton melonjak.

## Insight layers (all 4)
- Delta + anomali (Act 5)
- Dekomposisi cost/ton (Act 3)
- Cost/ton vs produktivitas (Act 4)
- Benchmark divisi vs rata-rata (Act 2 line + Act 4 quadrant)

## Data — no backend change
Reuse `GET /payroll/dashboard/executive-summary?month&year` → `{ kpi, trends, breakdown, efficiency }`.
- breakdown[]: division_code, total_wage, total_ot, total_premi, headcount, total_tonase, total_hk
- trends[]: per-period total_wage, total_tonase, cost_per_ton, total_hk
- efficiency[]: division_code, total_cost, headcount, total_man_days, total_tonase

All 4 layers computed client-side.

## Derived (client)
- gajiPokok = total_wage − total_ot − total_premi
- costPerTon = total_wage / total_tonase (guard total_tonase > 0)
- productivity = total_tonase / total_hk (guard total_hk > 0)
- meanCostPerTon = Σ(total_wage)/Σ(total_tonase) over divisions with tonase>0
- deltaPct = (curr.cost_per_ton − prev.cost_per_ton)/prev (null if no prev)

## Components & flow
- Single page `CostPerTonStoryPage.jsx` + `cost-per-ton-story.css`
- Route `/cost-per-ton-story` in App.jsx
- Scroll reveal via IntersectionObserver (no heavy lib)
- Sticky period selector (month/year) updates all acts
- Click divisi block/scatter point → smooth-scroll to drill panel
- Charts: recharts (Treemap, stacked Bar, Scatter, delta Bar) — already installed
- Visual: reuse reportTheme `C` tokens + heatmap green→amber→red scale

## Edge cases
- total_tonase=0 → exclude from cost/ton viz, show "tonase belum diisi" chip, never divide by zero
- total_hk=0 → productivity undefined → scatter x=0 muted + tooltip "HK 0"
- No prev trend → delta null → Act 5 "periode awal, tidak ada pembanding"
- Only 1 division → benchmark = itself, note shown
- efficiency empty → fall back to breakdown for scatter
- API fail → EmptyState + retry (reuse reportTheme.EmptyState)

## Testing
Pure derivations in `costPerTonStory.derive.js` + runnable `costPerTonStory.derive.test.mjs`:
- zero-tonase returns null (not NaN)
- gajiPokok non-negative
- delta sign correct
- benchmark excludes zero-tonase divisi
Run: `node frontend/src/utils/costPerTonStory.derive.test.mjs`

## YAGNI cuts
- No PDF export (print CSS only, @media print 1 act/page)
- No save/share (live presentation)
- No 2-period side-by-side (delta layer covers temporal)
- No new backend endpoint

## Files
- Create: `frontend/src/pages/CostPerTonStoryPage.jsx`, `frontend/src/styles/cost-per-ton-story.css`, `frontend/src/utils/costPerTonStory.derive.js`, `frontend/src/utils/costPerTonStory.derive.test.mjs`
- Edit: `frontend/src/App.jsx` (route `/cost-per-ton-story`)
- Leave: `CostPerTonPanel` compact embed unchanged
