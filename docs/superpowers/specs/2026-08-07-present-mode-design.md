# Present Mode — Deck per Halaman di atas Panggung Gelap

Tanggal: 2026-08-07
Status: Disetujui user (2026-08-07)
Melanjutkan: `2026-08-07-estate-ledger-redesign-design.md`

## Tujuan

User ingin semua halaman report (20+) tampil "seperti aplikasi presentasi profesional" untuk kebutuhan presentasi visual storyboard. Keputusan yang sudah diambil bersama user:

1. **Format**: mode presentasi fullscreen per halaman (seperti PowerPoint, data tetap hidup). Halaman normal tetap ada.
2. **Struktur**: deck per halaman — tiap halaman report punya mode Present sendiri yang mengubah section-nya jadi slide.
3. **Cakupan**: semua 20+ halaman, dikerjakan bertahap dalam 3 gelombang.
4. **Tema slide**: panggung gelap sinematik (latar gelap, angka KPI raksasa, aksen daun).
5. **Mesin**: transformasi halaman (bukan overlay portal, bukan deck kurasi terpisah) — klik Present mengubah halaman yang sama jadi deck fullscreen. Tanpa duplikasi komponen, data tidak re-fetch, chart tidak remount.

## Desain Mesin Inti (shared, tanpa dependency baru)

### `frontend/src/components/present/PresentSlide.jsx`
Wrapper section: `<PresentSlide num="01" title="..." subtitle="...">children</PresentSlide>`.
- Mode normal: render section biasa dengan header slide flat (bukan gradient; header gradient lama di `SlideSection.jsx` diganti flat Estate Ledger).
- Mode present: section menjadi slide 100vh dengan judul besar.
- `SlideSection.jsx` lama dimigrasikan ke PresentSlide (ExecutivePayrollPage adalah satu-satunya pemakai).

### `frontend/src/components/present/PresentController.jsx` + `usePresentMode.js`
- Tombol "Present" di masthead halaman (ikon lucide `Presentation`), shortcut keyboard `p`.
- Fullscreen API (`document.documentElement.requestFullscreen()`, fallback graceful bila ditolak).
- Navigasi keyboard: ← → ↑ ↓ Space PageUp PageDown Home End; ESC keluar.
- Progress bar tipis di atas layar; counter `03 / 06`; caption bar bawah: judul slide + periode aktif + label cakupan gang (`getScopeLabel`).
- Melacak slide aktif via IntersectionObserver; navigasi memakai `scrollIntoView({ behavior: 'smooth' })`.
- Body scroll di-lock ke container deck saat mode aktif.

### `frontend/src/styles/present.css`
Tema panggung gelap yang HANYA aktif di dalam `.present-mode` (class di `<html>`):
- Latar ink/forest gelap (turunan `--ink` + leaf sangat gelap), teks paper, aksen daun terang.
- Slide 100vh + `scroll-snap-type: y mandatory` pada container.
- Tipografi panggung: judul slide `clamp(1.8rem, 3.2vw, 3rem)`, angka KPI Roboto Mono raksasa, label uppercase kecil.
- Chart kontras tinggi (grid halus gelap, tooltip gelap).
- Mode normal dan print-overrides tidak tersentuh (selector selalu berakar `.present-mode`).

## Struktur Storyboard per Halaman

Tiap halaman dipecah 4-7 slide dengan urutan naratif:
**Konteks → KPI Utama → Tren → Breakdown → Anomali/Insight → Penutup** (link ke report lanjutan).
Judul slide memakai bahasa cerita, bukan label teknis.

## Pengayaan Visual per Halaman

- KPI band ledger cell di bagian atas (memakai `StatCard` dari `reportTheme`).
- Insight strip ringkas (anomali/_highlight_ bulan berjalan).
- Perataan sisa warna lama ke token Estate Ledger: `#6C4FC4`, `#D98A1F`, `#C8463C` di `CostPerTonStoryPage.jsx`, `SalaryAnalysisPage.jsx`, `cost-per-ton-story.css`, `summary-report-new.css`, `costPerTonStory.derive.js`.
- Nol emoji (ikon lucide-react), nol em-dash di string UI, nol gradient hero.

## Gelombang Pengerjaan

### Gelombang 1 — 6 halaman naratif
Executive (migrasi SlideSection → PresentSlide), Cost/Ton Story, Analisis Tonase, Analisis Upah (salary-analysis), Produktivitas, Comprehensive.

### Gelombang 2 — 6 halaman analisis
Impact, Analisa Lembur & Premi (`/analysis`), Perbandingan Gang, Wages Comparison, High Earners, Salary Range Detail.

### Gelombang 3 — halaman tabel/operasional sisanya
Summary, Wages Rebinmas, Wages IJL, Detail Upah Bersih, Detailed Salary, Pendapatan Tidak Tetap, Mill Production, Data Verification, Dashboard Home (tombol Present opsional). Restyle visual + KPI band bila relevan + present mode ringan (tabel besar di panggung untuk share screen).

## Verifikasi (tiap gelombang)

- `cd frontend && npm run build` hijau.
- `npx vitest run` untuk test yang menyentuh file berubah (wajib: `print-overrides.test.js`, `ExecutivePayrollPage.printReport.test.js`, `gangTypes.test.js`).
- Sweep grep: emoji, em-dash `—` di string UI, `linear-gradient(115deg` pada header slide.
- Uji browser via playwright-cli: mode normal render, masuk mode Present (klik tombol), navigasi keyboard berpindah slide, ESC keluar, print tidak rusak.
- Screenshot mode normal + present untuk arsip.

## Batasan

- Tanpa dependency baru, tanpa ubah font global, tanpa git commit kecuali diminta.
- Backend tidak diubah (kecuali jika ada data yang benar-benar kurang; laporkan dulu).
- Label navigasi dan path route tidak berubah.
- File fondasi (`tokens.css`, `reportTheme.jsx`, `gangTypes.js`, `dashboardApi.js`) tidak diubah kecuali bug nyata.
