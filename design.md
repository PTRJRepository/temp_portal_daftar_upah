# Design — Portal Estate (PT Rebinmas Payroll)

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow. **First run** (2026-08-06). Managed via Hallmark `redesign`
multi-page flow.

## Genre
modern-minimal — enterprise / B2B financial-analytics dashboard. Stripe/Linear
register: confident geometric-sans display, generous whitespace, single restrained
accent, hairline-crisp card surfaces. No marketing pages; this is a working
product used by executives and payroll staff.

## Macrostructure family

- **App dashboards** (`/`, `/executive`): `Stat-Led` — KPI-led, giant number first,
  everything else qualifies it. Variation knobs: which KPI is elevated per page.
- **Report / table pages** (`/summary`, `/wages-*`, `/analysis`, `/tonase-analysis`,
  `/report-pajak`, `/impact`, `/comprehensive`, `/mill-production`, report drilldowns):
  `Long Document` family — consistent section heads + tables. Variation: hero title,
  chart composition.
- **Operational** (`/operational` daftar upah, vendor table): `Workbench` family —
  interaction-led, toolbars + sticky tables.

## Theme — custom · "sawit premium, finansial elegan, dedaunan hijau tua"

Palette derives from the existing sawit brand anchor `#1E7A45`. Preserved semantic
roles: upah=leaf-mid, premi=green-bright, lembur=amber, potongan=danger, cost-ton=violet.

- `--color-paper`       oklch(98% 0.008 152)   #FCFEFB  canvas
- `--color-paper-2`     oklch(95.5% 0.012 152) #F0F6F1  elevated chip
- `--color-pageBg`      oklch(94.5% 0.014 152) #E8F1EA  page background
- `--color-ink`         oklch(21% 0.02 152)    #122A1D  primary text
- `--color-ink-2`       oklch(38% 0.018 152)   #2A4638  secondary text
- `--color-muted`       oklch(55% 0.016 150)   #65806E  tertiary text
- `--color-rule`        oklch(86% 0.014 150)   #D4E2D6  hairline / border
- `--color-surface`     oklch(100% 0 0)        #FFFFFF  card
- `--color-surface-2`   oklch(96% 0.012 152)   #F4F9F4  card alt / zebra
- `--color-accent`      oklch(52% 0.14 152)    ≈#1E7A45  primary/active
- `--color-accent-ink`  oklch(99% 0.008 152)   #FDFFFE  text on accent
- `--color-leafDark`    oklch(33% 0.09 152)    ≈#14532D  deep brand / hero
- `--color-leafLight`   oklch(74% 0.14 152)    ≈#4CBB6B  hero gradient end
- `--color-warn`        oklch(60% 0.13 70)     ≈#D98A1F  lembur / warning
- `--color-danger`      oklch(50% 0.17 25)     ≈#C8463C  potongan / down
- `--color-costTon`     oklch(50% 0.17 295)    ≈#6C4FC4  cost per ton
- `--color-focus`       oklch(55% 0.18 152)   accent at higher chroma — focus ring only

## Typography

- Display: **Sora**, weight 600–800, *roman* (no italic headers ever). Letter-spacing `-0.02em`.
- Body:    **Inter**, weight 400–600. (Already the app's body face.)
- Mono:    **Roboto Mono**, weight 500 — tabular numerics, stat values, code.
- Load via `<link>` Google Fonts + preconnect in `index.html` (replace render-blocking `@import`).
- Type scale anchor: `--text-display` = clamp(2.2rem, 4vw + 0.5rem, 3.25rem).

## Spacing

4-pt named scale. Values in `tokens.css`. Pages use named tokens, never raw px.

## Motion

- Easings: `--ease-out` = cubic-bezier(0.16, 1, 0.3, 1) · `--ease-in` · `--ease-in-out`.
- Reveal: fade-only (≤ 220 ms), no slide for ambient chrome. KPI `count-up` on view.
- Reduced-motion: collapses to opacity-only ≤ 150 ms.

## Microinteractions stance

- Silent success — no celebratory toasts.
- Hover delay 800 ms (tooltips) · focus delay 0 ms (tooltips).
- `:focus-visible` ring visible instantly; never animate the ring.
- Cards: lift `-2px` + `--shadow-hover` on hover, 180 ms.

## CTA voice

- Primary: accent fill, radius 10px, white bold label, weight 700.
- Secondary: outline (1px rule), ink label.
- Both: pill on actions, rectangle (10px) on in-table buttons.

## Per-page allowances

- Dashboards/app pages MAY use count-up, small inline SVG motifs. MUST NOT use
  stock photography or fake-data illustration.
- Report/table pages: typography-led, accent ≤ 5% footprint.
- **No enrichment** — function carries the page. Decorative only within tokens.

## What pages MUST share

- The wordmark (PT Rebinmas Jaya + palm mark).
- Accent colour + placement (≤ 5 % per viewport; active states, primary buttons).
- Display Sora + body Inter + mono Roboto Mono.
- CTA voice (radius 10, padding rhythm).
- Section-heading rhythm (eyebrow-kicker + display heading + hairline).

## What pages MAY differ on

- Macrostructure within the page-type family (Stat-Led dashboards vs Long Document
  tables vs workbench operational).
- Hero composition.

## Exports (tokens)

Drop-in token tokens in `frontend/src/styles/tokens.css`.

- `:root` block: every `--color-*`, `--font-*`, `--space-*`, `--text-*`, `--ease-*`,
  `--dur-*`, `--radius-*`, `--shadow-*` used in the app.
- Every colour/font references the named token; nothing inlined.