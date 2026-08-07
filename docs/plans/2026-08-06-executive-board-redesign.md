# Executive Board Presentation Redesign — Spec

**Target file:** `frontend/src/pages/ExecutivePayrollPage.jsx`
**Goal:** Presentation-ready one-page board. Remove redundant charts, add KPI analysis grid, creative infographic visual style matching the sawit-finance theme.

## Data available (from `/payroll/dashboard/executive-summary`)
- `kpi`: curr_wage, prev_wage, curr_ot, prev_ot, curr_headcount, prev_headcount
- `trends[]`: period, month, year, total_wage, total_ot, total_premi, total_headcount, total_hk, total_tonase, cost_per_ton, cost_per_hk (12 months, GROSS basis)
- `breakdown[]`: division_code, total_wage, total_ot, total_premi, headcount, total_tonase, total_hk
- `efficiency[]`: division_code, total_cost, headcount, total_man_days, total_tonase
- `gangBreakdown[]`: gang_code, total_wage, total_ot, headcount
- `productivityTrend[]`: period, costPerHk, costPerTon, totalHk, totalTonase
- `wageSpikes[]`: name, id, gang, percentage, currentWage, dominant_component

## KEEP (in this order)
1. Hero header (sawit gradient, title, period, print, filters) — as-is
2. Breadcrumb — as-is
3. ReportLauncher — as-is
4. HeroKpiCard row (5 cards + ScopeToggle + tonase EmptyState) — as-is
5. InsightStrip — as-is
6. CostPerTonPanel — THE single cost/ton authority. Keep, do not duplicate cost/ton elsewhere.
7. Division Cost Breakdown stacked bar (drill entry) — keep
8. Gang section: TopBottomPerformersCard + GangComparisonChart + GangTrendChart — keep
9. Gang Cost Spikes alert card — keep
10. Print-only report section — keep unchanged
11. DivisionDetailCard drill + GangDetailModal + CostHKComparisonReport toggle — keep unchanged

## REMOVE (redundant — approved by user)
- Main Trend ComposedChart ("Tren 12 Bulan — Upah Kotor & Cost/Ton") — cost/ton covered by CostPerTonPanel
- Interactive Comparison widget (3 BarCharts: Total Wage / Overtime / Cost-HK)
- Komposisi Biaya donut (PieChart OT vs Regular)
- Distribusi Lembur per Divisi horizontal bar
- Top 15 Gangs by Cost stacked bar (redundant with TopBottomPerformers + GangComparisonChart)
- GangCostBreakdownChart (redundant with GangComparisonChart)

## ADD — KPI Analisis grid (new section, after CostPerTonPanel, before Division Cost Breakdown)
Title: "Analisis KPI — Gang Panen". Grid of creative infographic cards using `trends` + `breakdown`. Visual style: sawit theme (use C tokens from reportTheme), count-up numbers, mini sparkline where apt. Cards:

1. **Lembur Share** — `total_ot / total_wage * 100` (current trend) + DeltaBadge + 12-bln sparkline (trends total_ot). Color C.lembur.
2. **Upah per Karyawan** — `total_wage / total_headcount` (curr trend) + DeltaBadge vs prev. Color C.upah.
3. **Premi Share + dekomposisi** — share % = `total_premi/total_wage*100`; plus mini stacked bar dekomposisi premi from breakdown (brondol/pruning/insentif/kinerja via total_premi_* if present, else total_premi only). Color C.premi.
4. **HK Utilization** — `total_hk / total_headcount` = HK per orang (curr trend). Color C.upahAccent.
5. **Tunjangan** — total_tunjangan if present in breakdown/trends (else omit card).
6. **Cost / HK** — `trends[last].cost_per_hk` + DeltaBadge (invert). Color C.costTon. (Single home for cost/HK, replacing removed dupes.)

## Visual style
- Reuse `reportTheme` C, CARD, SECTION_TITLE, DeltaBadge, MetricInfo, EmptyState.
- Import recharts as needed (LineChart/Line for sparkline, BarChart/Bar for dekomposisi).
- Match story-page feel: clean cards, count-up optional, semantic colors.
- Add MetricInfo to the KPI grid section title (metricKey as appropriate).
- Keep responsive grid (repeat(auto-fit, minmax(220px,1fr))).

## Constraints
- Do NOT change print-only section, drill flows, or backend.
- No new dependencies. Use recharts + reportTheme already present.
- Preserve all working filters, period selector, deep-links.
- After edits, the page must build with `powershell -File frontend/build-root.ps1` (0 errors).
- Run `node frontend/src/utils/costPerTonStory.derive.test.mjs` — must stay 11/11 (don't touch derive).

## Verification
- Build clean.
- `/executive?month=1&year=2026` loads: KPI grid shows 4-6 cards with real numbers, no redundant charts below, cost/ton only in CostPerTonPanel.
