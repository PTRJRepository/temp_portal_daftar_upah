# Dashboard Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengubah DashboardHome menjadi command center satu halaman dengan 4 dimensi analisis (kepersonaliaan/headcount, struktur biaya, produktivitas, insight/alert) dan memperbaiki KPI headcount yang kosong.

**Architecture:** Dua endpoint backend baru di `dashboardRoutes.ts`/`dashboardService.ts` — `headcount-summary` (live employee master, selalu aktual) dan `cost-structure` (reshape `getDivisionBreakdown`) — plus fallback KPI headcount ke data live saat agregasi kosong. Frontend menambah 3 section component baru (`HeadcountSection`, `CostStructureSection`, `ProductivitySection`) yang dirender `DashboardHome.jsx`, dengan helper derivasi murni yang di-test Vitest. Spec: `docs/superpowers/specs/2026-08-07-dashboard-command-center-design.md`.

**Tech Stack:** Bun + Elysia + TypeScript (backend), React + Vite + recharts + lucide-react (frontend), `bun:test` (backend tests), Vitest (frontend tests).

## Global Constraints

- Tidak ada dependency baru. Chart tetap `recharts`, ikon tetap `lucide-react`, tema tetap `frontend/src/components/report/reportTheme.jsx` (Estate Ledger, SSOT).
- Tidak ada tabel DB baru, tidak ada perubahan skema.
- Indentasi mengikuti file yang disentuh: backend `.ts` 4 spasi; file area dashboard frontend (`DashboardHome.jsx`, `reportTheme.jsx`, section baru) 4 spasi mengikuti file eksisting.
- Commit message memakai Conventional Commits (`feat:`, `fix:`, `docs:`).
- Backend test command: `cd backend && bun test src/services/dashboardService.test.ts`.
- Frontend test command: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`.
- Scope gang (`panen|maintenance|transport|all`) hanya berlaku untuk data agregasi; data kepersonaliaan selalu seluruh karyawan (master tidak mengenal scope).
- Mapping gender mengikuti konvensi `employeeRepository.mapGender`: nilai `'2'` atau `'P'` → `'P'`, selain itu → `'L'`.

## File Structure

- `backend/src/services/dashboardService.ts` *(modify)* — tambah field `hrDb`, method `getHeadcountSummary`, `getCostStructure`, `withLiveHeadcountFallback`.
- `backend/src/services/dashboardService.test.ts` *(modify)* — test untuk ketiga method di atas + test route.
- `backend/src/api/dashboardRoutes.ts` *(modify)* — endpoint `/headcount-summary`, `/cost-structure`, fallback KPI di `/executive-summary`.
- `frontend/src/utils/dashboardDerivations.js` *(create)* — helper murni: formatter + data shaping untuk section.
- `frontend/src/utils/dashboardDerivations.test.js` *(create)* — test Vitest untuk helper.
- `frontend/src/components/report/reportTheme.jsx` *(modify)* — `StatCard` terima prop opsional `sparkline` & `badge`; tambah `Skeleton` dan `SectionHeader`.
- `frontend/src/components/dashboard/HeadcountSection.jsx` *(create)* — section Kepersonaliaan.
- `frontend/src/components/dashboard/CostStructureSection.jsx` *(create)* — section Efisiensi & Struktur Biaya.
- `frontend/src/components/dashboard/ProductivitySection.jsx` *(create)* — section Produktivitas.
- `frontend/src/pages/DashboardHome.jsx` *(modify)* — wiring fetch per section, KPI sparkline, insight strip diperluas, susun ulang layout.

---

### Task 1: Backend — `getHeadcountSummary` + `withLiveHeadcountFallback`

**Files:**
- Modify: `backend/src/services/dashboardService.ts` (constructor ~line 43-45; method baru setelah `getProductivityTrend` yang berakhir ~line 294)
- Test: `backend/src/services/dashboardService.test.ts`

**Interfaces:**
- Produces:
  - `dashboardService.getHeadcountSummary(month: number, year: number): Promise<{ total: number, by_division: { division_code: string, headcount: number }[], by_emp_type: { emp_type: string, headcount: number }[], by_gender: { gender: 'L'|'P', headcount: number }[], join_trend_12m: { month: number, year: number, label: string, joined: number }[] }>`
  - `dashboardService.withLiveHeadcountFallback(kpi: any, liveTotal: number): any` — mengembalikan kpi baru dengan `headcount_source: 'aggregation' | 'live'`.
  - Field baru `private hrDb: Database` (di-mock di test seperti `extendDb`).
- Consumed by: Task 3 (route `/headcount-summary` + fallback KPI), Task 8 (frontend memakai bentuk response ini).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `backend/src/services/dashboardService.test.ts`:

```ts
describe("DashboardService headcount summary", () => {
    const service = dashboardService as any;
    const originalHrDb = service.hrDb;

    afterEach(() => {
        service.hrDb = originalHrDb;
    });

    const masterRows = [
        { loc_code: "ARA", hr_emp_type: "SKU", gender: "1", join_date: "2020-01-10" },
        { loc_code: "ARA", hr_emp_type: "BHL", gender: "2", join_date: "2026-03-05" },
        { loc_code: "ARC", hr_emp_type: null, gender: "M", join_date: null },
        { loc_code: "", hr_emp_type: "sku", gender: "P", join_date: "2025-12-20" }
    ];

    it("mengagregasi total, divisi, tipe karyawan, gender, dan tren join 12 bulan", async () => {
        service.hrDb = { query: async () => masterRows };

        const result = await dashboardService.getHeadcountSummary(4, 2026);

        expect(result.total).toBe(4);
        expect(result.by_division).toEqual([
            { division_code: "ARA", headcount: 2 },
            { division_code: "ARC", headcount: 1 },
            { division_code: "UNKNOWN", headcount: 1 }
        ]);
        expect(result.by_emp_type).toEqual([
            { emp_type: "SKU", headcount: 2 },
            { emp_type: "BHL", headcount: 1 },
            { emp_type: "LAINNYA", headcount: 1 }
        ]);
        expect(result.by_gender).toEqual([
            { gender: "L", headcount: 2 },
            { gender: "P", headcount: 2 }
        ]);
        // Window 12 bulan untuk periode akhir Apr 2026 = Mei 2025..Apr 2026
        expect(result.join_trend_12m).toHaveLength(12);
        expect(result.join_trend_12m.find((p: any) => p.month === 3 && p.year === 2026).joined).toBe(1);
        expect(result.join_trend_12m.find((p: any) => p.month === 12 && p.year === 2025).joined).toBe(1);
        expect(result.join_trend_12m.find((p: any) => p.month === 1 && p.year === 2026).joined).toBe(0);
    });

    it("menandai sumber KPI headcount: aggregation bila ada, live bila kosong", () => {
        expect(dashboardService.withLiveHeadcountFallback({ curr_headcount: 120 }, 999))
            .toEqual({ curr_headcount: 120, headcount_source: "aggregation" });
        expect(dashboardService.withLiveHeadcountFallback({ curr_headcount: 0 }, 999))
            .toEqual({ curr_headcount: 999, headcount_source: "live" });
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && bun test src/services/dashboardService.test.ts`
Expected: FAIL — `getHeadcountSummary is not a function` (method belum ada).

- [ ] **Step 3: Implementasi minimal**

Di `backend/src/services/dashboardService.ts`:

a) Tambah field + init di constructor (line 40-45):

```ts
export class DashboardService {
    private static instance: DashboardService;
    private extendDb: Database;
    private hrDb: Database;

    private constructor() {
        this.extendDb = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
        this.hrDb = Database.getInstance();
    }
```

b) Tambah dua method berikut tepat setelah penutup method `getProductivityTrend` (setelah line ~294, sebelum komentar `/** Cross-division cost/ton timeline ...`):

```ts
    /**
     * Ringkasan headcount live dari master karyawan HR (HR_EMPLOYEE + HR_GANGLN).
     * Sumber ini selalu aktual dan tidak tergantung Aggregation Seeder.
     * Dipakai section Kepersonaliaan dashboard dan fallback KPI headcount.
     * month/year hanya dipakai untuk window tren karyawan masuk (12 bulan).
     */
    public async getHeadcountSummary(month: number, year: number): Promise<any> {
        const query = `
            SELECT loc_code, hr_emp_type, gender, join_date
            FROM (
                SELECT
                    RTRIM(e.LocCode) as loc_code,
                    NULLIF(RTRIM(e.HREmpType), '') as hr_emp_type,
                    e.Gender as gender,
                    em.AppJoinGrpDate as join_date,
                    ROW_NUMBER() OVER(PARTITION BY e.EmpCode ORDER BY e.EmpCode DESC) as rn
                FROM HR_EMPLOYEE e
                INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
            ) t WHERE rn = 1
        `;
        const rows = await this.hrDb.query<any>(query);

        const byDivisionMap = new Map<string, number>();
        const byEmpTypeMap = new Map<string, number>();
        let male = 0, female = 0;
        const joinMap = new Map<string, number>();
        const { startMonth, startYear } = this.getStartPeriod(month, year);

        for (const r of rows) {
            const div = (r.loc_code || '').trim() || 'UNKNOWN';
            byDivisionMap.set(div, (byDivisionMap.get(div) || 0) + 1);

            const empType = (r.hr_emp_type || '').trim().toUpperCase() || 'LAINNYA';
            byEmpTypeMap.set(empType, (byEmpTypeMap.get(empType) || 0) + 1);

            // Konvensi sama dengan employeeRepository.mapGender
            const g = String(r.gender ?? '').trim();
            if (g === '2' || g === 'P') female++; else male++;

            if (r.join_date) {
                const d = new Date(r.join_date);
                const jm = d.getMonth() + 1;
                const jy = d.getFullYear();
                const inWindow = (jy > startYear || (jy === startYear && jm >= startMonth))
                    && (jy < year || (jy === year && jm <= month));
                if (inWindow) {
                    const key = this.getPeriodKey(jm, jy);
                    joinMap.set(key, (joinMap.get(key) || 0) + 1);
                }
            }
        }

        const sortDesc = (a: any, b: any) => b.headcount - a.headcount;
        return {
            total: rows.length,
            by_division: [...byDivisionMap.entries()]
                .map(([division_code, headcount]) => ({ division_code, headcount }))
                .sort(sortDesc),
            by_emp_type: [...byEmpTypeMap.entries()]
                .map(([emp_type, headcount]) => ({ emp_type, headcount }))
                .sort(sortDesc),
            by_gender: [
                { gender: 'L', headcount: male },
                { gender: 'P', headcount: female }
            ],
            join_trend_12m: this.getPeriodWindow(month, year, 12).map(p => ({
                month: p.month,
                year: p.year,
                label: p.label,
                joined: joinMap.get(p.key) || 0
            }))
        };
    }

    /**
     * Fallback KPI headcount: bila agregasi bulan berjalan kosong (0),
     * pakai total headcount live dari master karyawan.
     */
    public withLiveHeadcountFallback(kpi: any, liveTotal: number): any {
        const fromAggregation = this.toReportNumber(kpi?.curr_headcount) > 0;
        return {
            ...kpi,
            curr_headcount: fromAggregation ? kpi.curr_headcount : this.toReportNumber(liveTotal),
            headcount_source: fromAggregation ? 'aggregation' : 'live'
        };
    }
```

Catatan: `getStartPeriod`, `getPeriodKey`, `getPeriodWindow`, `toReportNumber` sudah ada sebagai private method di class yang sama (line 434-471).

- [ ] **Step 4: Jalankan test, pastikan pass**

Run: `cd backend && bun test src/services/dashboardService.test.ts`
Expected: PASS semua (test lama + 2 test baru).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dashboardService.ts backend/src/services/dashboardService.test.ts
git commit -m "feat: add live headcount summary with KPI fallback helper"
```

---

### Task 2: Backend — `getCostStructure`

**Files:**
- Modify: `backend/src/services/dashboardService.ts` (setelah method `getHeadcountSummary` dari Task 1)
- Test: `backend/src/services/dashboardService.test.ts`

**Interfaces:**
- Consumes: `getDivisionBreakdown(month, year, gangScope)` (eksisting, return rows berkolom `division_code, total_wage, total_ot, total_premi, headcount, total_hk, total_potongan, total_spsi, total_pph21, total_bpjs_pekerja, total_koreksi, total_tonase, upah_available`).
- Produces: `dashboardService.getCostStructure(month: number, year: number, gangScope?: string): Promise<{ divisions: DivisionCost[], totals: any }>` di mana `DivisionCost = { division_code, upah_pokok, premi, lembur, total_wage, potongan, pph21, spsi, bpjs_pekerja, headcount, total_hk, tonase, cost_per_head: number|null, cost_per_hk: number|null, cost_per_ton: number|null, upah_available: boolean }`.
- Consumed by: Task 3 (route `/cost-structure`), Task 7 & 8 (frontend).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `backend/src/services/dashboardService.test.ts`:

```ts
describe("DashboardService cost structure", () => {
    const service = dashboardService as any;
    const originalExtendDb = service.extendDb;

    afterEach(() => {
        service.extendDb = originalExtendDb;
    });

    it("menurunkan upah pokok, rasio biaya, dan total dari breakdown divisi", async () => {
        service.extendDb = {
            query: async () => [
                { division_code: "ARA", total_wage: 1000, total_ot: 100, total_premi: 200, headcount: 10, total_hk: 200, total_potongan: 50, total_spsi: 5, total_pph21: 15, total_bpjs_pekerja: 30, total_koreksi: 0, total_tonase: 250, upah_available: 1 },
                { division_code: "DME", total_wage: 0, total_ot: 0, total_premi: 0, headcount: 0, total_hk: 0, total_potongan: 0, total_spsi: 0, total_pph21: 0, total_bpjs_pekerja: 0, total_koreksi: 0, total_tonase: 120, upah_available: 0 }
            ]
        };

        const result = await dashboardService.getCostStructure(4, 2026, 'panen');

        expect(result.divisions[0]).toMatchObject({
            division_code: "ARA",
            upah_pokok: 700,
            premi: 200,
            lembur: 100,
            cost_per_head: 100,
            cost_per_hk: 5,
            cost_per_ton: 4,
            upah_available: true
        });
        // Divisi produksi tanpa data upah: rasio null + flag false (bukan angka 0 menyesatkan)
        expect(result.divisions[1]).toMatchObject({
            division_code: "DME",
            cost_per_head: null,
            cost_per_hk: null,
            cost_per_ton: null,
            upah_available: false
        });
        expect(result.totals).toMatchObject({
            upah_pokok: 700,
            total_wage: 1000,
            headcount: 10,
            total_hk: 200,
            tonase: 370
        });
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && bun test src/services/dashboardService.test.ts`
Expected: FAIL — `getCostStructure is not a function`.

- [ ] **Step 3: Implementasi minimal**

Tambahkan method ini setelah `withLiveHeadcountFallback` di `backend/src/services/dashboardService.ts`:

```ts
    /**
     * Komposisi biaya per divisi dari breakdown agregasi.
     * upah_pokok = upah kotor - premi - lembur. Rasio biaya null bila
     * penyebut 0 atau divisi belum punya data upah (upah_available = 0),
     * supaya frontend bisa menampilkan "-" alih-alih angka menyesatkan.
     */
    public async getCostStructure(month: number, year: number, gangScope: string = 'panen'): Promise<any> {
        const rows = await this.getDivisionBreakdown(month, year, gangScope);
        const divisions = rows.map((r: any) => {
            const wage = this.toReportNumber(r.total_wage);
            const premi = this.toReportNumber(r.total_premi);
            const ot = this.toReportNumber(r.total_ot);
            const headcount = this.toReportNumber(r.headcount);
            const hk = this.toReportNumber(r.total_hk);
            const tonase = this.toReportNumber(r.total_tonase);
            const upahAvailable = r.upah_available === 1;
            return {
                division_code: r.division_code,
                upah_pokok: Math.max(wage - premi - ot, 0),
                premi,
                lembur: ot,
                total_wage: wage,
                potongan: this.toReportNumber(r.total_potongan),
                pph21: this.toReportNumber(r.total_pph21),
                spsi: this.toReportNumber(r.total_spsi),
                bpjs_pekerja: this.toReportNumber(r.total_bpjs_pekerja),
                headcount,
                total_hk: hk,
                tonase,
                cost_per_head: upahAvailable && headcount > 0 ? wage / headcount : null,
                cost_per_hk: upahAvailable && hk > 0 ? wage / hk : null,
                cost_per_ton: upahAvailable && tonase > 0 ? wage / tonase : null,
                upah_available: upahAvailable
            };
        });
        const sum = (key: string) => divisions.reduce((acc: number, d: any) => acc + (d[key] || 0), 0);
        return {
            divisions,
            totals: {
                upah_pokok: sum('upah_pokok'),
                premi: sum('premi'),
                lembur: sum('lembur'),
                total_wage: sum('total_wage'),
                potongan: sum('potongan'),
                pph21: sum('pph21'),
                spsi: sum('spsi'),
                bpjs_pekerja: sum('bpjs_pekerja'),
                headcount: sum('headcount'),
                total_hk: sum('total_hk'),
                tonase: sum('tonase')
            }
        };
    }
```

- [ ] **Step 4: Jalankan test, pastikan pass**

Run: `cd backend && bun test src/services/dashboardService.test.ts`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dashboardService.ts backend/src/services/dashboardService.test.ts
git commit -m "feat: add division cost structure service"
```

---

### Task 3: Backend — route `/headcount-summary`, `/cost-structure`, fallback KPI

**Files:**
- Modify: `backend/src/api/dashboardRoutes.ts` (handler `/executive-summary` line 35-88; endpoint baru disisipkan setelahnya)
- Test: `backend/src/services/dashboardService.test.ts`

**Interfaces:**
- Consumes: `dashboardService.getHeadcountSummary`, `dashboardService.getCostStructure`, `dashboardService.withLiveHeadcountFallback` (Task 1 & 2).
- Produces:
  - `GET /payroll/dashboard/headcount-summary?month=&year=` → `{ success, data: <hasil getHeadcountSummary> }`
  - `GET /payroll/dashboard/cost-structure?month=&year=&scope=` → `{ success, data: <hasil getCostStructure> }`
  - `GET /payroll/dashboard/executive-summary` → `data.kpi` kini punya field tambahan `headcount_source: 'aggregation' | 'live' | 'unavailable'`.

- [ ] **Step 1: Tulis test route yang gagal**

Tambahkan di akhir `backend/src/services/dashboardService.test.ts` (import route di bagian atas file: `import { dashboardRoutes } from "../api/dashboardRoutes";`):

```ts
describe("dashboard routes headcount & cost structure", () => {
    const service = dashboardService as any;
    const originalHrDb = service.hrDb;
    const originalExtendDb = service.extendDb;

    afterEach(() => {
        service.hrDb = originalHrDb;
        service.extendDb = originalExtendDb;
    });

    it("GET /headcount-summary mengembalikan ringkasan live", async () => {
        service.hrDb = { query: async () => [{ loc_code: "ARA", hr_emp_type: "SKU", gender: "1", join_date: null }] };

        const res = await dashboardRoutes.handle(new Request("http://localhost/payroll/dashboard/headcount-summary?month=4&year=2026"));
        const json = await res.json();

        expect(json.success).toBe(true);
        expect(json.data.total).toBe(1);
        expect(json.data.by_division).toEqual([{ division_code: "ARA", headcount: 1 }]);
    });

    it("GET /cost-structure mengembalikan komposisi biaya", async () => {
        service.extendDb = {
            query: async () => [
                { division_code: "ARA", total_wage: 1000, total_ot: 100, total_premi: 200, headcount: 10, total_hk: 200, total_potongan: 0, total_spsi: 0, total_pph21: 0, total_bpjs_pekerja: 0, total_koreksi: 0, total_tonase: 250, upah_available: 1 }
            ]
        };

        const res = await dashboardRoutes.handle(new Request("http://localhost/payroll/dashboard/cost-structure?month=4&year=2026&scope=panen"));
        const json = await res.json();

        expect(json.success).toBe(true);
        expect(json.data.divisions[0].upah_pokok).toBe(700);
    });

    it("GET /executive-summary memakai fallback live saat headcount agregasi kosong", async () => {
        service.extendDb = { query: async () => [] };
        service.hrDb = { query: async () => [{ loc_code: "ARA", hr_emp_type: "SKU", gender: "1", join_date: null }] };

        const res = await dashboardRoutes.handle(new Request("http://localhost/payroll/dashboard/executive-summary?month=4&year=2026"));
        const json = await res.json();

        expect(json.success).toBe(true);
        expect(json.data.kpi.curr_headcount).toBe(1);
        expect(json.data.kpi.headcount_source).toBe("live");
    });
});
```

Catatan untuk implementer: bila test `/executive-summary` gagal karena method lain (mis. `getWageSpikes`) memakai dependensi selain `extendDb.query`, mock dependensi itu dengan pola yang sama seperti describe lain di file ini (`service.getGangProduction = async () => new Map()` dst).

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd backend && bun test src/services/dashboardService.test.ts`
Expected: FAIL — response 404 (`json.success` undefined) karena route belum ada.

- [ ] **Step 3: Implementasi route**

Di `backend/src/api/dashboardRoutes.ts`:

a) Di handler `/executive-summary`, ganti blok KPI (line 53-60):

```ts
            let kpi: any = {
                curr_wage: current.total_wage || 0,
                prev_wage: prev.total_wage || 0,
                curr_ot: current.total_ot || 0,
                prev_ot: prev.total_ot || 0,
                curr_headcount: current.total_headcount || 0,
                prev_headcount: prev.total_headcount || 0
            };

            // Fallback: bila agregasi bulan berjalan belum ada (belum di-seed),
            // pakai headcount live dari master karyawan agar KPI tidak kosong.
            try {
                const headcount = await dashboardService.getHeadcountSummary(month, year);
                kpi = dashboardService.withLiveHeadcountFallback(kpi, headcount.total);
            } catch {
                kpi = { ...kpi, headcount_source: kpi.curr_headcount > 0 ? 'aggregation' : 'unavailable' };
            }
```

b) Sisipkan dua endpoint baru tepat setelah penutup handler `/executive-summary` (setelah `})` di line 88, sebelum `.get('/division-cost-trend', ...)`):

```ts
    .get("/headcount-summary", async ({ query, set }) => {
        try {
            const month = query.month ? parseInt(query.month) : new Date().getMonth() + 1;
            const year = query.year ? parseInt(query.year) : new Date().getFullYear();
            const data = await dashboardService.getHeadcountSummary(month, year);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.Optional(t.String()),
            year: t.Optional(t.String())
        })
    })
    .get("/cost-structure", async ({ query, set }) => {
        try {
            const month = query.month ? parseInt(query.month) : new Date().getMonth() + 1;
            const year = query.year ? parseInt(query.year) : new Date().getFullYear();
            const scope = ['panen','maintenance','transport','all'].includes(query.scope) ? query.scope : 'panen';
            const data = await dashboardService.getCostStructure(month, year, scope);
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            month: t.Optional(t.String()),
            year: t.Optional(t.String()),
            scope: t.Optional(t.Union([t.Literal('panen'), t.Literal('maintenance'), t.Literal('transport'), t.Literal('all')]))
        })
    })
```

- [ ] **Step 4: Jalankan test, pastikan pass**

Run: `cd backend && bun test src/services/dashboardService.test.ts`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/dashboardRoutes.ts backend/src/services/dashboardService.test.ts
git commit -m "feat: expose headcount-summary and cost-structure endpoints with KPI fallback"
```

---

### Task 4: Frontend — helper derivasi `dashboardDerivations.js`

**Files:**
- Create: `frontend/src/utils/dashboardDerivations.js`
- Test: `frontend/src/utils/dashboardDerivations.test.js`

**Interfaces:**
- Produces (dipakai Task 6-9):
  - `formatCompactIDR(val)` → string ringkas (`Rp 1,23 M` / `Rp 500 jt` / `Rp 12.345`), `'-'` untuk null/NaN.
  - `formatNumberID(val)` → string `Intl` id-ID, `'-'` untuk null/NaN.
  - `toCostCompositionRows(divisions)` → `[{ name, upah_pokok, premi, lembur }]` (hanya `upah_available`, urut total desc).
  - `toDonutRows(pairs, key)` → `[{ name, value }]` dari `[{ [key], headcount }]`.
  - `toDivisionHeadcountRows(byDivision)` → `[{ name, headcount }]` desc.
  - `toHeadcountTrendRows(trends, liveTotal)` → `[{ period, headcount, live? }]`; titik terakhir diganti liveTotal bila agregasi 0.
  - `toSparklinePoints(trends, key)` → `[{ v }]`.
  - `toTonPerHkRows(divisions)` → `[{ name, tonPerHk }]` desc (hanya divisi `upah_available` dengan `total_hk > 0` dan `tonase > 0`).
  - `findMissingWageDivisions(breakdown)` → `[division_code]` yang `upah_available === 0` tapi `total_tonase > 0`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `frontend/src/utils/dashboardDerivations.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  formatCompactIDR,
  formatNumberID,
  toCostCompositionRows,
  toDonutRows,
  toDivisionHeadcountRows,
  toHeadcountTrendRows,
  toSparklinePoints,
  toTonPerHkRows,
  findMissingWageDivisions
} from './dashboardDerivations';

describe('formatters', () => {
  it('formatCompactIDR meringkas miliar/juta dan menangani null', () => {
    expect(formatCompactIDR(1_500_000_000)).toBe('Rp 1,5 M');
    expect(formatCompactIDR(2_000_000)).toBe('Rp 2 jt');
    expect(formatCompactIDR(null)).toBe('-');
    expect(formatCompactIDR('abc')).toBe('-');
  });

  it('formatNumberID memformat ribuan dan menangani null', () => {
    expect(formatNumberID(12345)).toBe('12.345');
    expect(formatNumberID(null)).toBe('-');
  });
});

describe('toCostCompositionRows', () => {
  it('hanya memakai divisi dengan upah tersedia, urut total desc', () => {
    const rows = toCostCompositionRows([
      { division_code: 'ARA', upah_pokok: 700, premi: 200, lembur: 100, upah_available: true },
      { division_code: 'DME', upah_pokok: 0, premi: 0, lembur: 0, upah_available: false },
      { division_code: 'ARC', upah_pokok: 1000, premi: 0, lembur: 0, upah_available: true }
    ]);
    expect(rows.map(r => r.name)).toEqual(['ARC', 'ARA']);
    expect(rows[1]).toEqual({ name: 'ARA', upah_pokok: 700, premi: 200, lembur: 100 });
  });

  it('aman untuk input kosong/undefined', () => {
    expect(toCostCompositionRows()).toEqual([]);
  });
});

describe('toDonutRows / toDivisionHeadcountRows', () => {
  it('toDonutRows memetakan key ke name/value', () => {
    expect(toDonutRows([{ emp_type: 'SKU', headcount: 5 }], 'emp_type'))
      .toEqual([{ name: 'SKU', value: 5 }]);
  });

  it('toDivisionHeadcountRows mengurutkan desc', () => {
    const rows = toDivisionHeadcountRows([
      { division_code: 'ARC', headcount: 3 },
      { division_code: 'ARA', headcount: 9 }
    ]);
    expect(rows.map(r => r.name)).toEqual(['ARA', 'ARC']);
  });
});

describe('toHeadcountTrendRows', () => {
  it('mengganti titik terakhir dengan live total bila agregasi 0', () => {
    const rows = toHeadcountTrendRows([
      { period: 'Mar 2026', total_headcount: 100 },
      { period: 'Apr 2026', total_headcount: 0 }
    ], 120);
    expect(rows[1]).toEqual({ period: 'Apr 2026', headcount: 120, live: true });
  });

  it('tidak mengubah titik terakhir bila agregasi ada', () => {
    const rows = toHeadcountTrendRows([{ period: 'Apr 2026', total_headcount: 100 }], 120);
    expect(rows[0]).toEqual({ period: 'Apr 2026', headcount: 100 });
  });
});

describe('toSparklinePoints / toTonPerHkRows / findMissingWageDivisions', () => {
  it('toSparklinePoints mengambil satu key dari trends', () => {
    expect(toSparklinePoints([{ total_wage: 5 }, { total_wage: 7 }], 'total_wage'))
      .toEqual([{ v: 5 }, { v: 7 }]);
  });

  it('toTonPerHkRows menghitung ton/HK dan melewati divisi tanpa data', () => {
    const rows = toTonPerHkRows([
      { division_code: 'ARA', tonase: 250, total_hk: 200, upah_available: true },
      { division_code: 'DME', tonase: 120, total_hk: 0, upah_available: false }
    ]);
    expect(rows).toEqual([{ name: 'ARA', tonPerHk: 1.25 }]);
  });

  it('findMissingWageDivisions menemukan divisi produksi tanpa upah', () => {
    expect(findMissingWageDivisions([
      { division_code: 'ARA', upah_available: 1, total_tonase: 250 },
      { division_code: 'DME', upah_available: 0, total_tonase: 120 },
      { division_code: 'XYZ', upah_available: 0, total_tonase: 0 }
    ])).toEqual(['DME']);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`
Expected: FAIL — modul `./dashboardDerivations` tidak ditemukan.

- [ ] **Step 3: Implementasi helper**

Buat `frontend/src/utils/dashboardDerivations.js`:

```js
// ===== Helper murni Dashboard Command Center =====
// Formatter + data shaping untuk section dashboard. Tanpa IO — mudah diuji.

/** Rupiah ringkas: Rp 1,5 M / Rp 2 jt / Rp 12.345. '-' untuk null/NaN. */
export function formatCompactIDR(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    const n = Number(val);
    if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
    if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`;
    return `Rp ${n.toLocaleString('id-ID')}`;
}

/** Angka ribuan id-ID. '-' untuk null/NaN. */
export function formatNumberID(val) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    return new Intl.NumberFormat('id-ID').format(val);
}

/** Stacked bar komposisi biaya: satu baris per divisi (hanya yang upah-nya tersedia). */
export function toCostCompositionRows(divisions = []) {
    return (divisions || [])
        .filter(d => d && d.upah_available)
        .map(d => ({
            name: d.division_code,
            upah_pokok: d.upah_pokok || 0,
            premi: d.premi || 0,
            lembur: d.lembur || 0
        }))
        .sort((a, b) => (b.upah_pokok + b.premi + b.lembur) - (a.upah_pokok + a.premi + a.lembur));
}

/** Donut: [{ [key], headcount }] → [{ name, value }]. */
export function toDonutRows(pairs = [], key) {
    return (pairs || []).map(p => ({ name: p[key] ?? '-', value: p.headcount || 0 }));
}

/** Horizontal bar headcount per divisi (desc). */
export function toDivisionHeadcountRows(byDivision = []) {
    return [...(byDivision || [])]
        .sort((a, b) => (b.headcount || 0) - (a.headcount || 0))
        .map(d => ({ name: d.division_code, headcount: d.headcount || 0 }));
}

/** Tren headcount 12 bln; titik terakhir diganti total live bila agregasi kosong (0). */
export function toHeadcountTrendRows(trends = [], liveTotal = null) {
    const rows = (trends || []).map(t => ({ period: t.period, headcount: t.total_headcount || 0 }));
    if (rows.length && liveTotal && rows[rows.length - 1].headcount === 0) {
        rows[rows.length - 1] = { ...rows[rows.length - 1], headcount: liveTotal, live: true };
    }
    return rows;
}

/** Sparkline KPI: ambil satu key dari trends → [{ v }]. */
export function toSparklinePoints(trends = [], key) {
    return (trends || []).map(t => ({ v: t?.[key] ?? 0 }));
}

/** Peringkat ton/HK per divisi (desc). Divisi tanpa upah/HK/tonase dilewati. */
export function toTonPerHkRows(divisions = []) {
    return (divisions || [])
        .filter(d => d && d.upah_available && d.total_hk > 0 && d.tonase > 0)
        .map(d => ({ name: d.division_code, tonPerHk: d.tonase / d.total_hk }))
        .sort((a, b) => b.tonPerHk - a.tonPerHk);
}

/** Divisi yang sudah produksi (tonase > 0) tapi data upahnya belum tersedia. */
export function findMissingWageDivisions(breakdown = []) {
    return (breakdown || [])
        .filter(d => d && !d.upah_available && (d.total_tonase || 0) > 0)
        .map(d => d.division_code);
}
```

- [ ] **Step 4: Jalankan test, pastikan pass**

Run: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/dashboardDerivations.js frontend/src/utils/dashboardDerivations.test.js
git commit -m "feat: add dashboard derivation helpers"
```

---

### Task 5: Frontend — perluasan `reportTheme.jsx`

**Files:**
- Modify: `frontend/src/components/report/reportTheme.jsx` (`StatCard` line 83-99; tambah `Skeleton` & `SectionHeader` sebelum `export default ReportHero;` di line 259)

**Interfaces:**
- Produces (dipakai Task 6-9):
  - `StatCard` menerima prop opsional baru: `badge` (string — pill kecil di samping label, mis. "live") dan `sparkline` (ReactNode — dirender di kanan kartu, 88×36). Prop lama tidak berubah → 25+ halaman lain tidak terdampak.
  - `Skeleton({ height = 120 })` — blok loading pulse, keyframes `elPulse` di-inject inline.
  - `SectionHeader({ title, meta })` — header section: judul SECTION_TITLE + meta kecil + garis.

- [ ] **Step 1: Ubah `StatCard`**

Ganti seluruh fungsi `StatCard` (line 82-99) dengan:

```jsx
/** StatCard — ledger cell: flat, hairline, angka mono tabular, tick semantik tipis.
 *  Prop opsional: badge (pill kecil di samping label), sparkline (ReactNode di kanan kartu). */
export function StatCard({ label, value, note, color = C.upah, pct, invert, badge, sparkline }) {
    const [hover, setHover] = React.useState(false);
    return (
        <div
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            style={{ ...CARD, padding: '16px 18px', borderColor: hover ? C.leafLight : C.border, transition: 'border-color .15s' }}
        >
            <div style={{ width: 24, height: 2, background: color, marginBottom: 10 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted }}>{label}</div>
                {badge && (
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.premi, background: '#E3EFEC', border: '1px solid #BFD8D3', borderRadius: 999, padding: '1px 7px' }}>{badge}</span>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: C.text, lineHeight: 1.05, marginBottom: 6, fontFamily: 'var(--font-mono)' }}>{value}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {pct !== undefined && <DeltaBadge pct={pct} invert={invert} />}
                        {note && <span style={{ fontSize: 11.5, color: C.text2 }}>{note}</span>}
                    </div>
                </div>
                {sparkline && <div style={{ width: 88, height: 36, flexShrink: 0 }}>{sparkline}</div>}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Tambah `Skeleton` dan `SectionHeader`**

Sisipkan tepat sebelum baris `export default ReportHero;`:

```jsx
/** Skeleton — blok loading pulse halus. Prop: height (px). */
export function Skeleton({ height = 120 }) {
    return (
        <div style={{ height, borderRadius: 10, background: C.surface2, border: `1px solid ${C.border}`, animation: 'elPulse 1.4s ease-in-out infinite' }}>
            <style>{`@keyframes elPulse{0%,100%{opacity:.55}50%{opacity:1}}`}</style>
        </div>
    );
}

/** SectionHeader — judul section konsisten: SECTION_TITLE + meta kecil + garis. */
export function SectionHeader({ title, meta }) {
    return (
        <div style={{ marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...SECTION_TITLE, marginBottom: 0 }}>{title}</span>
            {meta && <span style={{ fontSize: 11, color: C.muted }}>{meta}</span>}
            <span style={{ flex: 1, height: 1, background: C.border }} />
        </div>
    );
}
```

- [ ] **Step 3: Sanity check — test frontend yang ada tetap pass**

Run: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`
Expected: PASS (theme tidak punya test sendiri; compile penuh diverifikasi di Task 9 via build).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/report/reportTheme.jsx
git commit -m "feat: extend report theme with sparkline stat card, skeleton, section header"
```

---

### Task 6: Frontend — `HeadcountSection.jsx`

**Files:**
- Create: `frontend/src/components/dashboard/HeadcountSection.jsx`

**Interfaces:**
- Consumes: helper dari Task 4 (`toDivisionHeadcountRows`, `toDonutRows`, `toHeadcountTrendRows`); theme dari Task 5 (`C, SHADOW, CARD, SECTION_TITLE, chartPalette, EmptyState, Skeleton`).
- Produces: `export default function HeadcountSection({ data, trends, loading, error, onRetry })` —
  - `data`: response `data` dari `/headcount-summary` (Task 3) atau null.
  - `trends`: array `trends` dari `/executive-summary` (untuk tren headcount 12 bln).
  - `loading`/`error`/`onRetry`: state fetch section Kepersonaliaan dari parent.
- Consumed by: Task 9 (DashboardHome).

- [ ] **Step 1: Buat component**

Buat `frontend/src/components/dashboard/HeadcountSection.jsx`:

```jsx
import React from 'react';
import {
    BarChart, Bar, Cell, LineChart, Line, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { C, SHADOW, CARD, SECTION_TITLE, chartPalette, EmptyState, Skeleton } from '../report/reportTheme';
import { toDivisionHeadcountRows, toDonutRows, toHeadcountTrendRows } from '../../utils/dashboardDerivations';

const tooltipStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    boxShadow: SHADOW, fontSize: 12, color: C.text
};

// Donut + legenda manual (warna dari chartPalette)
const Donut = ({ rows }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <ResponsiveContainer width={140} height={140}>
            <PieChart>
                <Pie data={rows} dataKey="value" nameKey="name" innerRadius={40} outerRadius={62} paddingAngle={2} isAnimationActive={false}>
                    {rows.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
        </ResponsiveContainer>
        <div style={{ display: 'grid', gap: 6 }}>
            {rows.map((r, i) => (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: chartPalette[i % chartPalette.length], flexShrink: 0 }} />
                    <span style={{ color: C.text2, fontWeight: 600 }}>{r.name}</span>
                    <span style={{ color: C.text, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.value.toLocaleString('id-ID')}</span>
                </div>
            ))}
        </div>
    </div>
);

/**
 * Section Kepersonaliaan & Headcount.
 * Sumber: master karyawan live (selalu seluruh karyawan, tidak ikut scope gang).
 */
export default function HeadcountSection({ data, trends, loading, error, onRetry }) {
    if (loading) {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={220} />)}
            </div>
        );
    }
    if (error || !data) {
        return (
            <EmptyState
                title="Data kepersonaliaan belum tersedia"
                message={error ? `Gagal memuat: ${error}` : 'Master karyawan tidak mengembalikan data.'}
                actionLabel="Muat Ulang"
                onAction={onRetry}
            />
        );
    }

    const divisionRows = toDivisionHeadcountRows(data.by_division);
    const empTypeRows = toDonutRows(data.by_emp_type, 'emp_type');
    const genderRows = toDonutRows(data.by_gender, 'gender');
    const trendRows = toHeadcountTrendRows(trends, data.total);
    const joinRows = Array.isArray(data.join_trend_12m) ? data.join_trend_12m : [];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={SECTION_TITLE}>Headcount per Divisi</div>
                    <span style={{ fontSize: 11, color: C.muted }}>Total aktif: {(data.total || 0).toLocaleString('id-ID')}</span>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(180, divisionRows.length * 34)}>
                    <BarChart data={divisionRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid stroke={C.gridLine} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Headcount']} />
                        <Bar dataKey="headcount" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                            {divisionRows.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Tren Headcount 12 Bulan</div>
                {trendRows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} width={52} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, name, item) => [`${v}${item?.payload?.live ? ' (live)' : ''}`, 'Headcount']} />
                            <Line type="monotone" dataKey="headcount" stroke={C.leafMid} strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tren belum tersedia" message="Data agregasi 12 bulan belum ada — jalankan Aggregation Seeder." />
                )}
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Komposisi Status Karyawan</div>
                <Donut rows={empTypeRows} />
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Gender &amp; Karyawan Masuk (12 bln)</div>
                <Donut rows={genderRows} />
                <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={joinRows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Masuk']} />
                        <Bar dataKey="joined" fill={C.premi} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Sanity check test tetap pass**

Run: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`
Expected: PASS (component diverifikasi compile di Task 9 via build).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/HeadcountSection.jsx
git commit -m "feat: add headcount section component"
```

---

### Task 7: Frontend — `CostStructureSection.jsx`

**Files:**
- Create: `frontend/src/components/dashboard/CostStructureSection.jsx`

**Interfaces:**
- Consumes: `toCostCompositionRows`, `formatCompactIDR`, `formatNumberID` (Task 4); theme (Task 5).
- Produces: `export default function CostStructureSection({ costData, trends, gangBreakdown, loading, error, onRetry, periodLabel, scopeLabel })` —
  - `costData`: response `data` dari `/cost-structure` (Task 3) atau null.
  - `trends`: array dari `/executive-summary` (chart Tren Upah 12 Bulan, dipindah dari DashboardHome).
  - `gangBreakdown`: array dari `/executive-summary` (Top 5 gang; field: `gang_code, total_wage, total_ot, headcount, total_tonase`).
- Consumed by: Task 9.

- [ ] **Step 1: Buat component**

Buat `frontend/src/components/dashboard/CostStructureSection.jsx`:

```jsx
import React from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { C, SHADOW, CARD, SECTION_TITLE, EmptyState, Skeleton } from '../report/reportTheme';
import { formatCompactIDR, formatNumberID, toCostCompositionRows } from '../../utils/dashboardDerivations';

const tooltipStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    boxShadow: SHADOW, fontSize: 12, color: C.text
};

const thStyle = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, padding: '6px 8px', borderBottom: `1px solid ${C.border}` };
const tdStyle = { fontSize: 12.5, color: C.text, padding: '7px 8px', borderBottom: `1px solid ${C.gridLine}`, fontVariantNumeric: 'tabular-nums' };

/**
 * Section Efisiensi & Struktur Biaya.
 * Komposisi biaya + efisiensi per divisi (dari /cost-structure, ikut scope),
 * tren upah 12 bulan + top gang (dari /executive-summary).
 */
export default function CostStructureSection({ costData, trends, gangBreakdown, loading, error, onRetry, periodLabel, scopeLabel }) {
    if (loading) {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.2rem' }}>
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={240} />)}
            </div>
        );
    }
    if (error || !costData) {
        return (
            <EmptyState
                title="Struktur biaya belum tersedia"
                message={error ? `Gagal memuat: ${error}` : 'Data agregasi belum tersedia untuk periode ini — jalankan Aggregation Seeder.'}
                actionLabel="Muat Ulang"
                onAction={onRetry}
            />
        );
    }

    const compositionRows = toCostCompositionRows(costData.divisions);
    const divisions = Array.isArray(costData.divisions) ? costData.divisions : [];
    const efficiencyRows = divisions.filter(d => d.upah_available);
    const maxCostPerTon = Math.max(...efficiencyRows.map(d => d.cost_per_ton || 0), 0);
    const topGangs = (Array.isArray(gangBreakdown) ? gangBreakdown : []).slice(0, 5);
    const totals = costData.totals || {};
    const deductionCells = [
        { label: 'Potongan', value: totals.potongan },
        { label: 'PPh 21', value: totals.pph21 },
        { label: 'SPSI', value: totals.spsi },
        { label: 'BPJS Pekerja', value: totals.bpjs_pekerja }
    ];

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.2rem' }}>
            {/* Tren upah 12 bulan (dipindah dari grid chart lama) */}
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={SECTION_TITLE}>Tren Upah 12 Bulan</div>
                    <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                </div>
                {trends.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={trends} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatCompactIDR(v), 'Total Upah']} />
                            <Area type="monotone" dataKey="total_wage" stroke={C.upah} strokeWidth={2} fill={C.upah} fillOpacity={0.12} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tren belum tersedia" message="Data agregasi 12 bulan belum ada — jalankan Aggregation Seeder." />
                )}
            </div>

            {/* Komposisi biaya per divisi */}
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={SECTION_TITLE}>Komposisi Biaya per Divisi ({periodLabel})</div>
                    <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                </div>
                {compositionRows.length > 0 ? (
                    <>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={compositionRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={C.gridLine} vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} />
                                <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                                <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatCompactIDR(v), name]} />
                                <Bar dataKey="upah_pokok" stackId="biaya" fill={C.leafMid} name="Upah Pokok" isAnimationActive={false} />
                                <Bar dataKey="premi" stackId="biaya" fill={C.premi} name="Premi" isAnimationActive={false} />
                                <Bar dataKey="lembur" stackId="biaya" fill={C.lembur} name="Lembur" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                        <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                            {[['Upah Pokok', C.leafMid], ['Premi', C.premi], ['Lembur', C.lembur]].map(([label, color]) => (
                                <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.text2, fontWeight: 600 }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />{label}
                                </span>
                            ))}
                        </div>
                    </>
                ) : (
                    <EmptyState title="Komposisi kosong" message="Belum ada divisi dengan data upah untuk periode ini." />
                )}
            </div>

            {/* Efisiensi per divisi */}
            <div style={CARD}>
                <div style={SECTION_TITLE}>Efisiensi per Divisi</div>
                {efficiencyRows.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thStyle}>Divisi</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Upah/HK</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Upah/Orang</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Cost/Ton</th>
                            </tr>
                        </thead>
                        <tbody>
                            {efficiencyRows.map(d => (
                                <tr key={d.division_code}>
                                    <td style={{ ...tdStyle, fontWeight: 700 }}>{d.division_code}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.cost_per_hk !== null ? formatCompactIDR(d.cost_per_hk) : '-'}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{d.cost_per_head !== null ? formatCompactIDR(d.cost_per_head) : '-'}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                                            {d.cost_per_ton !== null && maxCostPerTon > 0 && (
                                                <span style={{ width: `${Math.max(6, (d.cost_per_ton / maxCostPerTon) * 56)}px`, height: 6, borderRadius: 3, background: C.costTon, opacity: 0.75, display: 'inline-block' }} />
                                            )}
                                            <span>{d.cost_per_ton !== null ? formatCompactIDR(d.cost_per_ton) : '-'}</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <EmptyState title="Efisiensi kosong" message="Belum ada divisi dengan data upah untuk periode ini." />
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 14 }}>
                    {deductionCells.map(cell => (
                        <div key={cell.label} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted }}>{cell.label}</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: C.potongan, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{formatCompactIDR(cell.value)}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Top 5 gang biaya tertinggi */}
            <div style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <div style={SECTION_TITLE}>Top 5 Gang Biaya Tertinggi</div>
                    <span style={{ fontSize: 11, color: C.muted }}>{scopeLabel}</span>
                </div>
                {topGangs.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thStyle}>#</th>
                                <th style={thStyle}>Gang</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Total Upah</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>HK</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topGangs.map((g, i) => (
                                <tr key={g.gang_code}>
                                    <td style={{ ...tdStyle, color: C.muted, fontWeight: 700 }}>{i + 1}</td>
                                    <td style={{ ...tdStyle, fontWeight: 700 }}>{g.gang_code}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCompactIDR(g.total_wage)}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatNumberID(g.headcount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <EmptyState title="Data gang kosong" message="Belum ada breakdown gang untuk periode ini." />
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Sanity check test tetap pass**

Run: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/CostStructureSection.jsx
git commit -m "feat: add cost structure section component"
```

---

### Task 8: Frontend — `ProductivitySection.jsx`

**Files:**
- Create: `frontend/src/components/dashboard/ProductivitySection.jsx`

**Interfaces:**
- Consumes: `toTonPerHkRows`, `formatCompactIDR`, `formatNumberID` (Task 4); theme (Task 5).
- Produces: `export default function ProductivitySection({ productivityTrend, divisions, loading, scopeLabel })` —
  - `productivityTrend`: array dari `/executive-summary` → elemen `{ period, costPerHk, costPerTon, totalHk, totalTonase }`.
  - `divisions`: array `costData.divisions` dari `/cost-structure` (untuk peringkat Ton/HK).
- Consumed by: Task 9.

- [ ] **Step 1: Buat component**

Buat `frontend/src/components/dashboard/ProductivitySection.jsx`:

```jsx
import React from 'react';
import {
    AreaChart, Area, BarChart, Bar, Cell, LineChart, Line, Legend,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { C, SHADOW, CARD, SECTION_TITLE, chartPalette, EmptyState, Skeleton } from '../report/reportTheme';
import { formatCompactIDR, formatNumberID, toTonPerHkRows } from '../../utils/dashboardDerivations';

const tooltipStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    boxShadow: SHADOW, fontSize: 12, color: C.text
};

const formatTon = (v) => `${formatNumberID(Math.round(v || 0))} ton`;

/**
 * Section Produktivitas: tren tonase, cost/ton vs cost/HK, peringkat ton/HK divisi.
 * Tonase hanya bermakna untuk scope panen — scope lain menampilkan empty state berpenjelasan.
 */
export default function ProductivitySection({ productivityTrend, divisions, loading, scopeLabel }) {
    if (loading) {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={230} />)}
            </div>
        );
    }

    const trend = Array.isArray(productivityTrend) ? productivityTrend : [];
    const hasTonase = trend.some(p => (p.totalTonase || 0) > 0);
    const tonPerHkRows = toTonPerHkRows(divisions);

    if (!hasTonase && tonPerHkRows.length === 0) {
        return (
            <EmptyState
                title="Produktivitas belum tersedia"
                message={`Data tonase tidak tersedia untuk cakupan ${scopeLabel || 'ini'}. Tonase divisi hanya bermakna pada cakupan panen; bila scope panen pun kosong, jalankan Aggregation Seeder.`}
            />
        );
    }

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem' }}>
            <div style={CARD}>
                <div style={SECTION_TITLE}>Tren Tonase 12 Bulan</div>
                {hasTonase ? (
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumberID(Math.round(v))} width={56} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatTon(v), 'Tonase']} />
                            <Area type="monotone" dataKey="totalTonase" stroke={C.leafDark} strokeWidth={2} fill={C.leafDark} fillOpacity={0.12} isAnimationActive={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tonase kosong" message="Tonase tidak tersedia untuk cakupan ini." />
                )}
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Cost/Ton vs Cost/HK (12 bln)</div>
                {hasTonase ? (
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompactIDR(v)} width={72} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatCompactIDR(v), name]} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line type="monotone" dataKey="costPerTon" name="Cost/Ton" stroke={C.costTon} strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="costPerHk" name="Cost/HK" stroke={C.lembur} strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Tren biaya kosong" message="Data agregasi belum tersedia untuk periode ini." />
                )}
            </div>

            <div style={CARD}>
                <div style={SECTION_TITLE}>Ton/HK per Divisi</div>
                {tonPerHkRows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(160, tonPerHkRows.length * 34)}>
                        <BarChart data={tonPerHkRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                            <CartesianGrid stroke={C.gridLine} horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10.5, fill: C.muted }} tickLine={false} axisLine={false} />
                            <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 11, fill: C.text2 }} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(2)} ton/HK`, 'Ton/HK']} />
                            <Bar dataKey="tonPerHk" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                                {tonPerHkRows.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyState title="Peringkat kosong" message="Belum ada divisi dengan tonase dan HK untuk periode ini." />
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Sanity check test tetap pass**

Run: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/dashboard/ProductivitySection.jsx
git commit -m "feat: add productivity section component"
```

---

### Task 9: Frontend — rakit `DashboardHome.jsx` sebagai command center

**Files:**
- Modify: `frontend/src/pages/DashboardHome.jsx`

**Interfaces:**
- Consumes: section component (Task 6-8), helper (Task 4), theme (Task 5), endpoint (Task 3).
- Produces: halaman `/` final sesuai spec.

Terapkan edit berikut berurutan. Anchor mengacu kode eksisting; ganti persis seperti tertera.

- [ ] **Step 1: Ganti blok import (line 1-21)**

Ganti import recharts + reportTheme + tambah import baru (hapus `BarChart, Bar, Cell` dan `chartPalette` yang tidak lagi dipakai di file ini):

```jsx
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useReport } from '../context/ReportContext';
import MonthSelector from '../components/common/MonthSelector';
import { isProdMode } from '../utils/prodModeUtils';
import { dashJson } from '../utils/dashboardApi';
import { getScopeLabel } from '../utils/gangTypes';
import {
    AreaChart, Area, ResponsiveContainer
} from 'recharts';
import {
    Settings, Info, BarChart2, ArrowRight, FlaskConical, DollarSign, Calculator,
    TrendingUp, Layers, Scale, Activity, AlertTriangle, Wallet
} from 'lucide-react';

// ===== Estate Ledger: tema bersama (SSOT: reportTheme) =====
import {
    C, SHADOW, CARD, SECTION_TITLE,
    ReportHero, ReportBody, StatCard, ScopeToggle, EmptyState, Skeleton, SectionHeader
} from '../components/report/reportTheme';
import {
    formatCompactIDR, formatNumberID, toSparklinePoints, findMissingWageDivisions
} from '../utils/dashboardDerivations';
import HeadcountSection from '../components/dashboard/HeadcountSection';
import CostStructureSection from '../components/dashboard/CostStructureSection';
import ProductivitySection from '../components/dashboard/ProductivitySection';
```

- [ ] **Step 2: Hapus formatter lokal (line 24-34)**

Hapus `formatCompactIDR` dan `formatNumber` lokal (sekarang di-import dari `dashboardDerivations`). Biarkan `calcChange` tetap. Catatan: pemakaian `formatNumber(...)` di file ini diganti `formatNumberID(...)` pada Step 6.

- [ ] **Step 3: Hapus `SkeletonBlock` lokal (line 88-90) dan tag `<style>` (line 168)**

Hapus definisi `SkeletonBlock` dan baris `<style>{`.el-skeleton...`}</style>` di dalam JSX — `Skeleton` dari reportTheme sudah meng-inject keyframes `elPulse` sendiri. Dua pemakaian `<SkeletonBlock key={i} height={104} />` (grid loading KPI) diganti `<Skeleton key={i} height={104} />`.

- [ ] **Step 4: Tambah fetch kepersonaliaan + struktur biaya**

Sisipkan tepat setelah baris `useEffect(() => { loadDashboard(); }, [loadDashboard]);` (line 142):

```jsx
    // ===== Data kepersonaliaan (live master, fetch independen) =====
    const [headData, setHeadData] = useState(null);
    const [headLoading, setHeadLoading] = useState(true);
    const [headError, setHeadError] = useState(null);

    const loadHeadcount = useCallback(async () => {
        if (!token || !month || !year) return;
        setHeadLoading(true);
        setHeadError(null);
        try {
            const json = await dashJson(`/headcount-summary?month=${month}&year=${year}`, { token });
            if (json.success) {
                setHeadData(json.data);
            } else {
                setHeadData(null);
                setHeadError(json.error || 'Gagal memuat data kepersonaliaan');
            }
        } catch (e) {
            console.error('Failed to load headcount summary:', e);
            setHeadData(null);
            setHeadError(e.message);
        } finally {
            setHeadLoading(false);
        }
    }, [token, month, year]);

    useEffect(() => { loadHeadcount(); }, [loadHeadcount]);

    // ===== Data struktur biaya (agregasi, ikut scope) =====
    const [costData, setCostData] = useState(null);
    const [costLoading, setCostLoading] = useState(true);
    const [costError, setCostError] = useState(null);

    const loadCostStructure = useCallback(async () => {
        if (!token || !month || !year) return;
        setCostLoading(true);
        setCostError(null);
        try {
            const json = await dashJson(`/cost-structure?month=${month}&year=${year}&scope=${scope}`, { token });
            if (json.success) {
                setCostData(json.data);
            } else {
                setCostData(null);
                setCostError(json.error || 'Gagal memuat struktur biaya');
            }
        } catch (e) {
            console.error('Failed to load cost structure:', e);
            setCostData(null);
            setCostError(e.message);
        } finally {
            setCostLoading(false);
        }
    }, [token, month, year, scope]);

    useEffect(() => { loadCostStructure(); }, [loadCostStructure]);
```

- [ ] **Step 5: Sesuaikan derivasi (line 144-164)**

Hapus memo `divisionChartData` (line 154-159) dan konstanta `tooltipStyle` (line 161-164) — keduanya hanya dipakai grid chart lama. Sisipkan setelah definisi `wageSpikes`:

```jsx
    const missingWageDivisions = useMemo(
        () => findMissingWageDivisions(dashData?.breakdown),
        [dashData?.breakdown]
    );

    const sparkFor = (key, color) => (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={toSparklinePoints(trends, key)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.15} isAnimationActive={false} />
            </AreaChart>
        </ResponsiveContainer>
    );
```

- [ ] **Step 6: Ganti KPI band dengan versi sparkline + badge (line 202-210)**

Ganti keenam `<StatCard ... />` di grid KPI dengan:

```jsx
                        <StatCard label="Total Upah Kotor" value={formatCompactIDR(kpi.curr_wage)} pct={calcChange(kpi.curr_wage, kpi.prev_wage) ?? undefined} color={C.upah} note="vs bulan lalu" sparkline={sparkFor('total_wage', C.upah)} />
                        <StatCard label="Premi" value={formatCompactIDR(currentTrend.total_premi)} pct={calcChange(currentTrend.total_premi, prevTrend.total_premi) ?? undefined} color={C.premi} note="vs bulan lalu" sparkline={sparkFor('total_premi', C.premi)} />
                        <StatCard label="Lembur" value={formatCompactIDR(kpi.curr_ot)} pct={calcChange(kpi.curr_ot, kpi.prev_ot) ?? undefined} color={C.lembur} invert note="vs bulan lalu" sparkline={sparkFor('total_ot', C.lembur)} />
                        <StatCard label="Headcount" value={formatNumberID(kpi.curr_headcount)} pct={calcChange(kpi.curr_headcount, kpi.prev_headcount) ?? undefined} color={C.leafLight} note="karyawan" badge={kpi.headcount_source === 'live' ? 'live' : undefined} sparkline={sparkFor('total_headcount', C.leafLight)} />
                        <StatCard label="Tonase" value={`${formatNumberID(Math.round(currentTrend.total_tonase || 0))} ton`} pct={calcChange(currentTrend.total_tonase, prevTrend.total_tonase) ?? undefined} color={C.leafDark} note="vs bulan lalu" sparkline={sparkFor('total_tonase', C.leafDark)} />
                        <StatCard label="Cost/Ton" value={costPerTon !== null ? formatCompactIDR(costPerTon) : '-'} pct={calcChange(costPerTon, prevTrend.cost_per_ton) ?? undefined} color={C.costTon} invert note="upah per ton" sparkline={sparkFor('cost_per_ton', C.costTon)} />
```

- [ ] **Step 7: Tambah insight strip divisi tanpa upah**

Sisipkan tepat setelah penutup blok `{!dashLoading && wageSpikes.length > 0 && (...)}` (line 230):

```jsx
                {/* INSIGHT STRIP: divisi sudah produksi tapi upah belum tersedia */}
                {!dashLoading && missingWageDivisions.length > 0 && (
                    <div style={{
                        ...CARD, padding: '12px 16px', marginBottom: '1.6rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                        borderLeft: `3px solid ${C.warn}`
                    }}>
                        <span style={{ color: C.warn, display: 'inline-flex', flexShrink: 0 }}><AlertTriangle size={17} /></span>
                        <span style={{ fontSize: '0.84rem', color: C.text2, lineHeight: 1.5 }}>
                            <b style={{ color: C.text }}>{missingWageDivisions.length} divisi sudah produksi tapi upah belum tersedia:</b>{' '}
                            {missingWageDivisions.join(', ')} — jalankan Aggregation Seeder agar analisis biaya lengkap.
                        </span>
                        <button
                            onClick={() => navigate('/seed')}
                            style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.upah, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                            Buka Aggregation Seeder <ArrowRight size={14} />
                        </button>
                    </div>
                )}
```

- [ ] **Step 8: Ganti grid chart lama dengan 3 section baru (line 232-274)**

Ganti seluruh blok `{/* CHARTS: tren upah 12 bulan + breakdown divisi */} {!dashLoading && !dashError && trends.length > 0 && (...)}` dengan:

```jsx
                {/* SECTION: Kepersonaliaan & Headcount */}
                <SectionHeader title="Kepersonaliaan & Headcount" meta="Sumber: master karyawan live · seluruh divisi" />
                <div style={{ marginBottom: '1.8rem' }}>
                    <HeadcountSection
                        data={headData}
                        trends={trends}
                        loading={headLoading}
                        error={headError}
                        onRetry={loadHeadcount}
                    />
                </div>

                {/* SECTION: Efisiensi & Struktur Biaya */}
                <SectionHeader title="Efisiensi & Struktur Biaya" meta={`${periodLabel} · ${scopeLabel}`} />
                <div style={{ marginBottom: '1.8rem' }}>
                    <CostStructureSection
                        costData={costData}
                        trends={trends}
                        gangBreakdown={dashData?.gangBreakdown}
                        loading={costLoading}
                        error={costError}
                        onRetry={loadCostStructure}
                        periodLabel={periodLabel}
                        scopeLabel={scopeLabel}
                    />
                </div>

                {/* SECTION: Produktivitas */}
                <SectionHeader title="Produktivitas" meta={scopeLabel} />
                <div style={{ marginBottom: '1.8rem' }}>
                    <ProductivitySection
                        productivityTrend={dashData?.productivityTrend}
                        divisions={costData?.divisions}
                        loading={dashLoading || costLoading}
                        scopeLabel={scopeLabel}
                    />
                </div>
```

- [ ] **Step 9: Rapikan header "Analisis Utama" (line 355-358)**

Ganti blok header inline:

```jsx
                <div style={{ marginBottom: '0.9rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={SECTION_TITLE}>Analisis Utama</span>
                    <span style={{ flex: 1, height: 1, background: C.border }} />
                </div>
```

dengan:

```jsx
                <SectionHeader title="Analisis Utama" />
```

- [ ] **Step 10: Jalankan test + build**

Run: `cd frontend && npx vitest run src/utils/dashboardDerivations.test.js`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: build sukses tanpa error (memverifikasi semua import/JSX ter-compile). Warning ukuran chunk boleh diabaikan.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/pages/DashboardHome.jsx
git commit -m "feat: rebuild dashboard home as command center"
```

---

### Task 10: Verifikasi end-to-end

**Files:** tidak ada perubahan kode.

- [ ] **Step 1: Backend test penuh**

Run: `cd backend && bun test src/services/dashboardService.test.ts`
Expected: PASS semua.

- [ ] **Step 2: Frontend test penuh**

Run: `cd frontend && npx vitest run`
Expected: PASS semua (termasuk test lama seperti `dashboardService.tonaseReport.test.js` — memastikan tidak ada regresi).

- [ ] **Step 3: Verifikasi manual 3 kondisi**

Jalankan backend (`cd backend && bun run dev`) dan frontend (`cd frontend && npm run dev:test`), buka halaman `/`, lalu cek:

1. **Data lengkap** (periode yang sudah di-seed): 6 KPI tampil dengan sparkline; kartu Headcount tanpa badge "live" (atau badge tidak ada bila `headcount_source=aggregation`); 4 kartu Kepersonaliaan terisi; stacked bar komposisi biaya terisi; tabel efisiensi menampilkan angka; produktivitas menampilkan tren tonase.
2. **Periode belum di-seed** (bulan berjalan): kartu Headcount tampil dengan badge "live" dan angka dari master; chart tren menampilkan empty state berpenjelasan seeder; insight strip menampilkan divisi yang produksi tapi belum ada upah (bila ada); tidak ada angka 0 yang menyesatkan.
3. **Scope non-panen** (maintenance/transport): section Produktivitas menampilkan empty state berpenjelasan; section lain tetap normal.

Catat temuan; perbaikan kecil boleh langsung dilakukan lalu di-commit (`fix:`).

- [ ] **Step 4: Commit (bila ada perbaikan dari Step 3)**

```bash
git add -A
git commit -m "fix: dashboard command center verification findings"
```
