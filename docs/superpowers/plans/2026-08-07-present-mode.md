# Present Mode Implementation Plan

> **For agentic workers:** Rencana ini dieksekusi per gelombang oleh subagent coder. Steps use checkbox (`- [ ]`) syntax for tracking. **Pengecualian aturan repo: TIDAK ADA `git commit`** — abaikan langkah commit apapun.

**Goal:** Menambahkan mode Present fullscreen (deck per halaman, panggung gelap sinematik) ke semua 20+ halaman report, plus pengayaan visual (KPI band, insight strip, perataan palet lama) sesuai spec `docs/superpowers/specs/2026-08-07-present-mode-design.md`.

**Architecture:** Transformasi halaman — `html.present-mode` mengubah halaman yang sama jadi deck: chrome layout (sidebar/topbar) disembunyikan via CSS, tiap section yang dibungkus `PresentSlide` menjadi slide 100vh dengan scroll-snap, navigasi keyboard + HUD (progress bar, counter, caption) dari `PresentController`. Tanpa duplikasi komponen, tanpa remount chart, tanpa dependency baru.

**Tech Stack:** React + inline styles (pola reportTheme), CSS murni untuk present mode, lucide-react (sudah terinstall), recharts (sudah ada), Vitest untuk test.

## Global Constraints

Berlaku untuk SEMUA task:
- Tanpa dependency npm baru. Tanpa ubah font global. Tanpa `git commit`/`git` mutation apapun.
- Dilarang emoji di UI (ikon `lucide-react`). Dilarang em-dash `—` di string UI. String UI Bahasa Indonesia.
- Path route dan label navigasi tidak berubah.
- File fondasi read-only: `frontend/src/styles/tokens.css`, `frontend/src/components/report/reportTheme.jsx`, `frontend/src/utils/gangTypes.js`, `frontend/src/utils/dashboardApi.js`. Temuan bug → laporkan, jangan edit.
- Palet Estate Ledger: leaf `#1F6F43`, premi teal `#0F766E`, lembur amber `#B45309`, potongan bata `#B3392E`, costTon umber `#7C5A2B`, ink `#15211A`, muted `#6E7A70`, paper `#F7F5EF`, hairline `#E0DED2`. Warna lama yang harus diganti bila ditemui di file kerja: `#6C4FC4` (ungu), `#D98A1F` (emas), `#C8463C` (merah lama), `#1E7A45` (hijau lama).
- `html.present-mode` adalah satu-satunya root selector untuk CSS panggung; mode normal & print (`print-overrides.test.js`) tidak boleh terpengaruh.
- Verifikasi minimal tiap task: `cd frontend && npm run build` hijau + vitest file terkait hijau.

## Peta Route → File

- `/executive` → `frontend/src/pages/ExecutivePayrollPage.jsx`
- `/cost-per-ton-story` → `frontend/src/pages/CostPerTonStoryPage.jsx`
- `/tonase-analysis` → `frontend/src/pages/TonaseAnalysisReportPage.jsx`
- `/salary-analysis` → `frontend/src/pages/SalaryAnalysisPage.jsx`
- `/productivity` → `frontend/src/pages/ProductivityReportPage.jsx`
- `/comprehensive` → `frontend/src/pages/PayrollAnalysisPage.jsx`
- `/impact` → `frontend/src/pages/ImpactReportPage.jsx`
- `/analysis` → `frontend/src/pages/AnalysisReportPage.jsx`
- `/gang-comparison-report` → `frontend/src/pages/GangComparisonReportPage.jsx`
- `/wages-comparison` → `frontend/src/pages/WagesComparisonPage.jsx`
- `/report/high-earners` → `frontend/src/pages/HighEarnerReportPage.jsx`
- `/report/salary-range-detail` → `frontend/src/pages/SalaryRangeDetailPage.jsx`
- `/summary` → `frontend/src/pages/SummaryReportPage.jsx`
- `/wages-rebinmas` → `frontend/src/pages/WagesSummaryRebinmasPage.jsx`
- `/wages-ijl` → `frontend/src/pages/WagesSummaryIJLPage.jsx`
- `/detail-upah-bersih` → `frontend/src/pages/UpahBersihDetailPage.jsx`
- `/detailed-salary` → `frontend/src/pages/DetailedSalaryAnalysisPage.jsx`
- `/pendapatan-tidak-tetap` → `frontend/src/pages/OtherIncomesPage.jsx`
- `/mill-production` → `frontend/src/pages/MillProductionReport.jsx`
- `/data-verification` → `frontend/src/pages/DataVerificationPage.jsx`
- `/` → `frontend/src/pages/DashboardHome.jsx`

---

### Task 1: Tema panggung — `frontend/src/styles/present.css`

**Files:**
- Create: `frontend/src/styles/present.css`
- Test: `frontend/src/styles/present-mode.test.js`

**Interfaces:**
- Produces: CSS `.present-slide`, `.present-slide-header`, `.present-slide-num`, `.present-slide-body`, `.present-hud`, `.present-hud-progress`, `.present-hud-caption`, `.present-exit-hint`; semua aturan panggung berakar `html.present-mode`.

- [ ] **Step 1: Tulis CSS.** Isi wajib:

```css
/* ===== Present Mode — panggung gelap sinematik ===== */
/* Normal mode: PresentSlide tampil sebagai section flat Estate Ledger */
.present-slide { scroll-margin-top: 84px; margin-bottom: 2.6rem; }
.present-slide-header { display: flex; align-items: center; gap: 16px; margin: 0 0 20px; padding: 12px 18px; background: var(--surface, #F7F5EF); border: 1px solid var(--border, #E0DED2); border-left: 4px solid #1F6F43; border-radius: 10px; }
.present-slide-num { font-family: 'Roboto Mono', monospace; font-weight: 800; font-size: 1.5rem; color: #1F6F43; letter-spacing: -0.02em; }
.present-slide-header h2 { margin: 0; font-size: 1.35rem; font-weight: 800; color: var(--ink, #15211A); letter-spacing: -0.01em; }
.present-slide-header p { margin: 3px 0 0; font-size: 0.86rem; color: var(--muted, #6E7A70); }
.present-slide-kicker { margin-left: auto; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted, #6E7A70); }

/* ===== Panggung gelap (hanya saat html.present-mode) ===== */
html.present-mode, html.present-mode body { background: #0C1410 !important; }
/* Sembunyikan chrome layout: sidebar + topbar DashboardLayout */
html.present-mode .dashboard-layout-root > div:first-child,
html.present-mode .dashboard-layout-root aside,
html.present-mode .dashboard-layout-root header { display: none !important; }
html.present-mode .dashboard-layout-main { margin: 0 !important; padding: 0 !important; width: 100% !important; }
html.present-mode .dashboard-layout-content { max-width: none !important; padding: 0 !important; height: 100vh; overflow-y: auto; scroll-snap-type: y mandatory; scroll-behavior: smooth; }
/* Slide panggung */
html.present-mode .present-slide { min-height: 100vh; scroll-snap-align: start; scroll-snap-stop: always; display: flex; flex-direction: column; justify-content: center; padding: 4vh 6vw; margin: 0; box-sizing: border-box; }
html.present-mode .present-slide-header { background: transparent; border: none; border-left: 4px solid #4CAF7D; border-radius: 0; padding: 0 0 0 20px; margin-bottom: 3vh; }
html.present-mode .present-slide-num { color: #4CAF7D; font-size: clamp(1.4rem, 2vw, 2rem); }
html.present-mode .present-slide-header h2 { color: #F3F1E8; font-size: clamp(1.8rem, 3.2vw, 3rem); }
html.present-mode .present-slide-header p { color: #93A596; font-size: clamp(0.9rem, 1.2vw, 1.1rem); }
html.present-mode .present-slide-kicker { color: #93A596; }
/* Kartu & teks di atas panggung */
html.present-mode .present-slide [style*="background"] { /* kartu inline-style ikut gelap via filter di bawah */ }
html.present-mode .present-slide-body { color: #E8E6DC; }
/* Keterbacaan chart recharts di latar gelap: CSS fill mengalahkan presentation attribute */
html.present-mode .recharts-cartesian-axis-tick text { fill: #93A596; }
html.present-mode .recharts-cartesian-grid line { stroke: #223528; }
html.present-mode .recharts-tooltip-wrapper { filter: drop-shadow(0 4px 14px rgba(0,0,0,.5)); }
/* HUD */
.present-hud { position: fixed; inset: 0 0 auto 0; z-index: 9999; pointer-events: none; }
.present-hud-progress { height: 3px; background: #223528; }
.present-hud-progress > div { height: 100%; background: #4CAF7D; transition: width .3s ease; }
.present-hud-caption { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999; display: flex; justify-content: space-between; align-items: center; padding: 10px 22px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #93A596; background: linear-gradient(transparent, rgba(12,20,16,.9)); pointer-events: none; font-family: 'Roboto Mono', monospace; }
.present-exit-hint { position: fixed; top: 14px; right: 18px; z-index: 9999; color: #93A596; font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; pointer-events: none; }
/* Print: present HUD tidak pernah ikut cetak */
@media print { .present-hud, .present-hud-caption, .present-exit-hint { display: none !important; } }
```

Catatan implementasi: selector chrome layout harus dicocokkan dengan class aktual di `frontend/src/layouts/DashboardLayout.jsx` (baca file itu; sesuaikan `.dashboard-layout-root/main/content` bila nama class berbeda). Kartu ber-inline-style terang tetap terang di panggung — itu disengaja (kartu paper "mengapung" di atas panggung gelap, kontras justru bagus); hanya teks langsung di body slide yang di-gelapkan latarnya. JANGAN memaksa semua background jadi gelap.

- [ ] **Step 2: Tulis test source-assertion** `frontend/src/styles/present-mode.test.js` mengikuti pola `frontend/src/styles/print-overrides.test.js` (baca file itu dulu):

```js
import { readFileSync } from 'fs';

const css = readFileSync(new URL('./present.css', import.meta.url), 'utf8');

describe('present.css scoping', () => {
    test('aturan panggung selalu berakar html.present-mode', () => {
        const stageRules = css.split('}').map(b => b.trim()).filter(b => b.includes('{'))
            .filter(b => /100vh|scroll-snap|#0C1410|#223528|#93A596|#4CAF7D/.test(b));
        for (const rule of stageRules) {
            const selector = rule.split('{')[0];
            expect(selector).toMatch(/html\.present-mode|^@/);
        }
    });
    test('HUD disembunyikan saat print', () => {
        expect(css).toMatch(/@media print\{[^}]*\.present-hud/s);
    });
    test('tidak ada emoji di CSS', () => {
        expect(css).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    });
});
```

- [ ] **Step 3: Jalankan test.** `cd frontend && npx vitest run src/styles/present-mode.test.js` → PASS (3 test).
- [ ] **Step 4: Import CSS** di entry yang memuat tema (cek `frontend/src/main.jsx` atau `App.jsx` — tambahkan `import './styles/present.css'` di samping import CSS tema lain).

---

### Task 2: Hook — `frontend/src/components/present/usePresentMode.js`

**Files:**
- Create: `frontend/src/components/present/usePresentMode.js`
- Test: `frontend/src/components/present/usePresentMode.test.js`

**Interfaces:**
- Produces: `usePresentMode()` → `{ presenting: boolean, activeIndex: number, enter(): void, exit(): void }`. Side effect: toggle class `present-mode` di `document.documentElement`, Fullscreen API, keyboard nav, IntersectionObserver pada `.present-slide`.

- [ ] **Step 1: Implementasi** (kode lengkap):

```js
import { useState, useEffect, useCallback } from 'react';

export function usePresentMode() {
    const [presenting, setPresenting] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const enter = useCallback(async () => {
        document.documentElement.classList.add('present-mode');
        setPresenting(true);
        try { await document.documentElement.requestFullscreen(); } catch { /* tetap present tanpa fullscreen */ }
        requestAnimationFrame(() => {
            const first = document.querySelector('.present-slide');
            if (first) first.scrollIntoView({ block: 'start' });
        });
    }, []);

    const exit = useCallback(() => {
        document.documentElement.classList.remove('present-mode');
        setPresenting(false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }, []);

    useEffect(() => {
        const onFsChange = () => {
            if (!document.fullscreenElement) {
                document.documentElement.classList.remove('present-mode');
                setPresenting(false);
            }
        };
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    useEffect(() => {
        if (!presenting) return;
        const go = (idx) => {
            const slides = document.querySelectorAll('.present-slide');
            if (!slides.length) return;
            const next = Math.max(0, Math.min(slides.length - 1, idx));
            slides[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { exit(); return; }
            if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(activeIndex + 1); }
            else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(activeIndex - 1); }
            else if (e.key === 'Home') { e.preventDefault(); go(0); }
            else if (e.key === 'End') { e.preventDefault(); go(Number.MAX_SAFE_INTEGER); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [presenting, activeIndex, exit]);

    useEffect(() => {
        if (!presenting) return;
        const slides = Array.from(document.querySelectorAll('.present-slide'));
        if (!slides.length) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach(en => {
                if (en.isIntersecting) {
                    const i = slides.indexOf(en.target);
                    if (i >= 0) setActiveIndex(i);
                }
            });
        }, { threshold: 0.55 });
        slides.forEach(s => io.observe(s));
        return () => io.disconnect();
    }, [presenting]);

    return { presenting, activeIndex, enter, exit };
}

export default usePresentMode;
```

- [ ] **Step 2: Test** `usePresentMode.test.js` (jsdom, tanpa testing-library — panggil hook lewat komponen dummy minimal atau `renderHook` bila `@testing-library/react` tersedia; cek `package.json` dulu. Bila tidak ada, tulis test fungsional sederhana: mount komponen uji via `createRoot`):

```js
// Verifikasi: enter() menambah class present-mode, exit() menghapusnya,
// keyboard ArrowDown memanggil scrollIntoView slide berikutnya.
```

- [ ] **Step 3: Jalankan** `npx vitest run src/components/present/usePresentMode.test.js` → PASS.

---

### Task 3: Komponen — `PresentSlide.jsx` + `PresentController.jsx`

**Files:**
- Create: `frontend/src/components/present/PresentSlide.jsx`
- Create: `frontend/src/components/present/PresentController.jsx`
- Test: `frontend/src/components/present/PresentSlide.test.jsx`

**Interfaces:**
- `PresentSlide({ num: string, title: string, subtitle?: string, id?: string, children })` — section `.present-slide` dengan header (num, title, subtitle, kicker `Slide {num}`).
- `PresentController({ presenting, activeIndex, slideCount, onEnter, onExit, caption })` — mode normal: tombol "Present" (ikon `Presentation` dari lucide-react, flat leaf). Mode present: HUD (progress bar, counter `{activeIndex+1} / {slideCount}`, caption bar bawah berisi `caption` + judul slide aktif, exit hint "ESC untuk keluar"). HUD via `createPortal` ke `document.body`.

- [ ] **Step 1: PresentSlide**

```jsx
import React from 'react';

export function PresentSlide({ num, title, subtitle, id, children }) {
    return (
        <section id={id} className="present-slide" data-num={num} data-title={title}>
            <header className="present-slide-header">
                <span className="present-slide-num">{num}</span>
                <div>
                    <h2>{title}</h2>
                    {subtitle && <p>{subtitle}</p>}
                </div>
                <span className="present-slide-kicker">Slide {num}</span>
            </header>
            <div className="present-slide-body">{children}</div>
        </section>
    );
}

export default PresentSlide;
```

- [ ] **Step 2: PresentController** — tombol present + portal HUD. Gunakan `import { Presentation, X } from 'lucide-react'`. Tombol flat: background `#1F6F43`, teks putih, radius 8, padding `8px 16px`, fontWeight 700. HUD memakai class `.present-hud`, `.present-hud-progress`, `.present-hud-caption`, `.present-exit-hint` dari present.css. Counter dan progress: `width: ${((activeIndex + 1) / slideCount) * 100}%`.

- [ ] **Step 3: Test render** `PresentSlide.test.jsx` — assert `section.present-slide` dengan `data-num`, judul ter-render, kicker "Slide 01". Jalankan `npx vitest run src/components/present/PresentSlide.test.jsx` → PASS.

---

### Task 4: Pilot — migrasi ExecutivePayrollPage

**Files:**
- Modify: `frontend/src/pages/ExecutivePayrollPage.jsx` (import SlideSection/SlideNav di baris ~30; pemakaian di ~1027-1420)
- Delete: `frontend/src/components/report/SlideSection.jsx` (setelah migrasi; grep dulu seluruh `frontend/src` memastikan tidak ada pemakai lain)

**Interfaces:**
- Consumes: Task 1-3 (`PresentSlide`, `PresentController`, `usePresentMode`, present.css).
- Produces: pola referensi adopsi untuk semua halaman lain.

- [ ] **Step 1:** Ganti `import { SlideSection, SlideNav } from '../components/report/SlideSection'` menjadi import `PresentSlide` dari `../components/present/PresentSlide`, `PresentController` dari `../components/present/PresentController`, `usePresentMode` dari `../components/present/usePresentMode`. Pertahankan `SlideNav` HANYA bila masih dipakai di mode normal (sticky jump nav); bila ya, pindahkan komponen `SlideNav` ke file baru `frontend/src/components/report/SlideNav.jsx` dan import dari sana, lalu hapus `SlideSection.jsx`.
- [ ] **Step 2:** Ganti semua `<SlideSection num="01" id="slide-01" title="...">` menjadi `<PresentSlide num="01" id="slide-01" title="..." subtitle="...">` dengan subtitle naratif (contoh: slide-01 `Ringkasan Eksekutif` subtitle `Kinerja utama bulan berjalan dalam satu pandangan`). Judul slide HARUS bahasa cerita: 01 Ringkasan Eksekutif, 02 Upah & Komponen, 03 Tonase & Cost, 04 Divisi & Gang, 05 Efisiensi, 06 Laporan.
- [ ] **Step 3:** Tambahkan di dalam komponen halaman: `const { presenting, activeIndex, enter, exit } = usePresentMode();` dan render `<PresentController presenting={presenting} activeIndex={activeIndex} slideCount={6} onEnter={enter} onExit={exit} caption={\`Executive · ${periodeLabel} · ${getScopeLabel(gangScope)}\`} />` tepat di bawah masthead. `periodeLabel` dari state month/year yang sudah ada.
- [ ] **Step 4:** Hapus header gradient lama (sekarang ditangani present.css flat header).
- [ ] **Step 5: Verifikasi** — `npx vitest run src/pages/ExecutivePayrollPage.printReport.test.js src/styles/print-overrides.test.js` PASS + `npm run build` sukses + grep nol `SlideSection` tersisa.

---

### Task 5-9: Gelombang 1 — 5 halaman naratif (paralel, satu subagent per halaman)

Pola adopsi identik dengan Task 4 untuk tiap halaman:
1. Bungkus section logis halaman dengan `<PresentSlide>` (4-7 slide, urutan Konteks → KPI → Tren → Breakdown → Insight → Penutup).
2. Tambahkan `usePresentMode` + `<PresentController>` dengan caption `{Nama Report} · {periode} · {cakupan}`.
3. Tambahkan KPI band ledger cell di slide KPI bila halaman belum punya (pakai `StatCard` dari `../components/report/reportTheme`).
4. Ganti warna lama (`#6C4FC4`, `#D98A1F`, `#C8463C`, `#1E7A45`) ke token Estate Ledger di file halaman + CSS pendampingnya.
5. Hapus emoji → lucide. Nol em-dash di string UI.
6. Verifikasi: build + vitest terkait + sweep grep.

- [ ] **Task 5:** `CostPerTonStoryPage.jsx` + `frontend/src/styles/cost-per-ton-story.css` + `frontend/src/utils/costPerTonStory.derive.js`. Halaman ini sudah punya struktur "Act" (act1-6) → tiap Act jadi satu PresentSlide. Palette CSS `--c-amber: #D98A1F` → `#B45309`, `--c-cost: #6C4FC4` → `#7C5A2B`, `--c-red: #C8463C` → `#B3392E`, `--c-upah/--c-leaf: #1E7A45` → `#1F6F43`, dan semua literal yang sama di JSX/derive.js.
- [ ] **Task 6:** `TonaseAnalysisReportPage.jsx` (+ jaga `TonaseAnalysisReportPage.test.js`, `TonaseAnalysisNavigation.test.js` tetap hijau).
- [ ] **Task 7:** `SalaryAnalysisPage.jsx` (4 literal warna lama di baris ~292/353/606/639).
- [ ] **Task 8:** `ProductivityReportPage.jsx`.
- [ ] **Task 9:** `PayrollAnalysisPage.jsx` (route `/comprehensive`).

### Task 10-15: Gelombang 2 — 6 halaman analisis (paralel)

- [ ] **Task 10:** `ImpactReportPage.jsx` (jaga `ImpactReportPage.printStyle.test.js` hijau).
- [ ] **Task 11:** `AnalysisReportPage.jsx` (jaga `AnalysisReportPage.printInsights.test.js`).
- [ ] **Task 12:** `GangComparisonReportPage.jsx` (sudah Estate Ledger dari redesign lalu — hanya tambah PresentSlide + controller).
- [ ] **Task 13:** `WagesComparisonPage.jsx`.
- [ ] **Task 14:** `HighEarnerReportPage.jsx`.
- [ ] **Task 15:** `SalaryRangeDetailPage.jsx`.

### Task 16-21: Gelombang 3 — halaman tabel/operasional (paralel, present mode ringan)

Tiap halaman: KPI band bila data tersedia + 2-4 PresentSlide (Ringkasan → Tabel besar → Catatan/Penutup). Jaga test print yang ada tetap hijau (beberapa halaman ini punya test print ketat: `WagesSummaryRebinmasPage.printReport.test.js`, `WagesSummaryRebinmasPage.printStyle.test.js`, `WagesSummaryRebinmasPage.comparisonKpi.test.js`, `WagesSummaryIJLPage.thumbprint.test.js`, `SummaryReportPage.printHeader.test.js`, `PayslipPrintPage.sixPerPage.test.js`).

- [ ] **Task 16:** `SummaryReportPage.jsx` + ratakan `--srn-warning: #D98A1F` di `frontend/src/styles/summary-report-new.css`.
- [ ] **Task 17:** `WagesSummaryRebinmasPage.jsx`.
- [ ] **Task 18:** `WagesSummaryIJLPage.jsx`.
- [ ] **Task 19:** `UpahBersihDetailPage.jsx` + `DetailedSalaryAnalysisPage.jsx`.
- [ ] **Task 20:** `OtherIncomesPage.jsx` + `MillProductionReport.jsx`.
- [ ] **Task 21:** `DataVerificationPage.jsx` + tombol Present opsional di `DashboardHome.jsx`.

### Task 22: Verifikasi akhir (induk, bukan subagent)

- [ ] `cd frontend && npm run build` sukses.
- [ ] `npx vitest run` seluruh test yang menyentuh file berubah.
- [ ] Sweep grep seluruh `frontend/src`: emoji UI, em-dash di string UI, `SlideSection`, `#6C4FC4`, `#D98A1F` (boleh tersisa hanya di file di luar cakupan yang disepakati — target: nol).
- [ ] Uji browser (playwright-cli) di stack frontend `localhost:5175` + backend `8010`: mode normal render; klik Present → slide 100vh gelap; ArrowDown berpindah slide; counter/progress berubah; ESC keluar; print preview tidak rusak. Screenshot arsip per gelombang.

## Self-Review

- Spec coverage: mesin inti (Task 1-3) ✓, pilot Executive (Task 4) ✓, struktur storyboard & pengayaan visual (pola Task 5, langkah 1-5) ✓, 3 gelombang mencakup semua 21 route di peta ✓, verifikasi (Task 22 + langkah verifikasi tiap task) ✓, batasan (Global Constraints) ✓.
- Type consistency: `usePresentMode()` mengembalikan `{ presenting, activeIndex, enter, exit }` dan dipakai konsisten di Task 3 (`onEnter/onExit` props) dan Task 4 (pemakai). `PresentSlide` props `{ num, title, subtitle, id, children }` konsisten. `PresentController` props `{ presenting, activeIndex, slideCount, onEnter, onExit, caption }` konsisten.
- Placeholder scan: test hook Task 2 Step 2 berupa deskripsi + kerangka karena ketersediaan `@testing-library/react` harus dicek implementer — diterima sebagai keputusan eksplisit, bukan placeholder kosong.
