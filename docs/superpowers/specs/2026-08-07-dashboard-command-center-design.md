# Dashboard Command Center — Design Spec

Tanggal: 2026-08-07
Status: Disetujui user (menunggu review spec tertulis)

## Latar Belakang & Masalah

Halaman dashboard utama (`frontend/src/pages/DashboardHome.jsx`, route `/`) saat ini:

1. **Report kurang komprehensif** — tidak ada analisis kepersonaliaan/headcount, struktur biaya, dan produktivitas yang layak.
2. **KPI Headcount sering kosong** — KPI membaca `total_employees` dari tabel agregasi, yang baru terisi setelah Aggregation Seeder dijalankan. Bulan berjalan yang belum di-seed menampilkan headcount 0/kosong.
3. **Tampilan terlalu basic** — kartu dan chart polos tanpa hierarki visual yang kuat.

Keputusan user (hasil brainstorming):
- Semua analisis diletakkan di DashboardHome (Pendekatan A: command center satu halaman).
- Empat dimensi analisis wajib tampil: Kepersonaliaan/Headcount, Efisiensi & Struktur Biaya, Produktivitas, Insight & Alert otomatis.
- Analisis harus terasa lebih profesional.

## Ketersediaan Data (hasil eksplorasi)

- Master karyawan live (HR DB): `gender`, `HREmpType`, `join_date`, `loc_code`, `gang_code` — tersedia via pola query di `backend/src/services/employeeRepository.ts` dan `dataExtractorService.ts`. Selalu aktual, tidak tergantung seeder.
- Tabel agregasi payroll per gang per bulan: `total_employees`, `total_hk`, `total_upah_kotor`, `total_lembur`, `total_premi`, `total_potongan`, `total_pph21`, `total_spsi`, `total_bpjs_pekerja`, `total_koreksi` — dipakai `backend/src/services/dashboardService.ts` (`getPayrollTrend`, `getDivisionBreakdown`, `getGangBreakdown`, `getProductivityTrend`, `getWageSpikes`).
- `dbo.division_tonase`: tonase per divisi per periode.
- Frontend sudah punya pola fetch `dashJson` (`frontend/src/utils/dashboardApi.js`) dan tema bersama `frontend/src/components/report/reportTheme` (Estate Ledger).

## Arsitektur & Alur Data

Tidak ada perubahan skema DB dan tidak ada tabel baru — murni query baru atas data yang sudah ada.

### Backend (`backend/src`)

1. **Endpoint baru** `GET /payroll/dashboard/headcount-summary?month=&year=`
   - Handler di `backend/src/api/dashboardRoutes.ts`, method baru `getHeadcountSummary(month, year)` di `backend/src/services/dashboardService.ts`.
   - Sumber: live employee master (pola query mengikuti `employeeRepository`).
   - Response `data`:
     - `total`: total karyawan aktif
     - `by_division`: `[{ division_code, headcount }]`
     - `by_emp_type`: `[{ emp_type, headcount }]` (komposisi SKU/BHL/dll dari `HREmpType`)
     - `by_gender`: `[{ gender, headcount }]` (L/P)
     - `join_trend_12m`: `[{ month, year, joined }]` dari `join_date` (data resign/keluar tidak tersedia di master — tidak disajikan)
2. **Perbaikan KPI headcount kosong** di handler `/executive-summary`:
   - Jika `curr_headcount` dari agregasi = 0, fallback ke total headcount live dari `getHeadcountSummary`.
   - Response menandai sumber data: `kpi.headcount_source: 'aggregation' | 'live'`.
   - KPI upah yang memang belum di-seed tetap apa adanya (0) — frontend yang menampilkan catatan "belum di-seed", bukan backend memalsukan angka.
3. **Endpoint baru** `GET /payroll/dashboard/cost-structure?month=&year=&scope=`
   - Komposisi biaya per divisi dari kolom agregasi yang sudah ada di `getDivisionBreakdown`: upah pokok (kotor − premi − lembur), premi, lembur, potongan, pph21, spsi, bpjs_pekerja.
   - Scope (`panen|maintenance|transport|all`) mengikuti pola `scopeGangSql` yang sudah ada.

### Frontend

- Semua fetch memakai `dashJson` dengan pola `{ success, data }` yang sama seperti pemakaian `/executive-summary` di `DashboardHome.jsx` saat ini.
- Scope toggle (panen/maintenance/transport/all) tetap berlaku untuk data agregasi (KPI, tren upah, struktur biaya, produktivitas).
- Section Kepersonaliaan selalu cakupan *seluruh karyawan* (tidak ikut scope toggle, karena master karyawan tidak mengenal scope gang) — diberi label cakupan yang jelas di header section.
- Setiap section melakukan fetch independen agar kegagalan satu section tidak mematikan section lain.

## Layout DashboardHome (atas → bawah)

Tema visual tetap Estate Ledger (`reportTheme` sebagai SSOT), diangkat kelasnya: hierarki lebih tegas, angka KPI lebih besar, setiap chart punya judul + konteks + label periode/scope. Semua section memakai header konsisten (judul + garis + label periode) dan skeleton saat loading.

1. **Masthead** — tetap `ReportHero`, subtitle dipertajam.
2. **KPI band (6 kartu, diperkaya)** — Upah Kotor, Premi, Lembur, Headcount, Tonase, Cost/Ton. Tiap kartu: angka besar + delta % vs bulan lalu + sparkline 12 bulan (mini area chart dari data `trends`). Kartu Headcount menampilkan badge "live" saat `headcount_source === 'live'`.
3. **Insight & Alert strip** — diperluas dari wage spike saja: gabungan lonjakan Cost/HK per gang, divisi yang punya tonase tapi belum ada data upah (`upah_available = 0` dari breakdown), dan anomali lain yang sudah disediakan `/executive-summary`. Ditulis kalimat naratif + link ke report terkait.
4. **Section Kepersonaliaan** *(baru)* — tren headcount 12 bulan (line; bulan berjalan dari live bila agregasi kosong), headcount per divisi (horizontal bar), komposisi status karyawan (donut) + gender (donut/stacked bar kecil), karyawan masuk per bulan (bar 12 bulan).
5. **Section Efisiensi & Struktur Biaya** *(baru)* — stacked bar komposisi biaya per divisi (upah pokok/premi/lembur), ringkasan potongan (pph21, BPJS, SPSI), mini table "Top 5 gang biaya tertinggi", cost/HK dan cost/ton per divisi. Chart lama "Tren Upah 12 Bulan" dan "Upah per Divisi" dipindah ke section ini agar tidak duplikat.
6. **Section Produktivitas** — tren tonase & ton/HK (dual line, data `productivityTrend`), peringkat divisi ton/HK.
7. **Filter Parameter + CTA** — tetap (pintu ke report operasional).
8. **Analisis Utama tiles + panel link report** — tetap di bagian bawah, dipoles spacing-nya.

## Error Handling & Empty States

- Fetch per section independen: kegagalan `headcount-summary` hanya menampilkan `EmptyState` + tombol "Muat Ulang" di section Kepersonaliaan; section lain tetap hidup.
- Agregasi kosong (bulan belum di-seed): chart tren menampilkan empty state "Data agregasi belum tersedia — jalankan Aggregation Seeder"; KPI upah tampil "-" dengan note, bukan angka 0 yang menyesatkan.
- Scope tanpa tonase (mis. maintenance): cost/ton & ton/HK tampil "-" dengan catatan penjelasan, bukan error.
- Endpoint backend dibungkus try/catch pola endpoint dashboard lain: `{ success: false, error }` + HTTP 500.

## Testing

- Backend: tambah test di `backend/src/services/dashboardService.test.ts` untuk `getHeadcountSummary` (total, by_division, by_emp_type, by_gender, join_trend) dan fallback headcount KPI. Jalankan `bun test src/services/dashboardService.test.ts`.
- Frontend: test Vitest ringan untuk helper derivasi data baru (mapping komposisi biaya, mapping headcount), mengikuti pola `frontend/src/services/dashboardService.tonaseReport.test.js`.
- Verifikasi manual: backend `bun run dev` + frontend `npm run dev:test`; cek tiap section dalam 3 kondisi — data lengkap, bulan belum di-seed, scope non-panen.

## Batasan / Di luar Scope

- Data karyawan keluar/resign (turnover lengkap) — tidak tersedia di master, tidak disajikan.
- Halaman report individual lain tidak diubah.
- Tidak ada tabel DB baru, tidak ada perubahan skema, tidak ada dependency baru (chart tetap `recharts`, ikon tetap `lucide-react`).
