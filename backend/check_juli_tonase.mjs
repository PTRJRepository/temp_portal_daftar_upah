import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT division_code, tonase, source, updated_at FROM dbo.division_tonase WHERE period_month=7 AND period_year=2026 ORDER BY division_code");
for(const r of rows) console.log(r.division_code.trim()+ " t=" + r.tonase + " src=" + r.source + " upd=" + r.updated_at);
console.log("total "+rows.length);
const aggRows = await db.query("SELECT division_code, COUNT(*) as cnt, SUM(total_upah_kotor) as wage FROM (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY period_month, period_year, gang_code ORDER BY COALESCE(updated_at, created_at) DESC, id DESC) as rn FROM dbo.daftar_upah_aggregation_history h WHERE period_month=7 AND period_year=2026) t WHERE rn=1 GROUP BY division_code ORDER BY division_code");
for(const r of aggRows) console.log("agg " + r.division_code.trim() + " cnt=" + r.cnt + " wage=" + r.wage);
