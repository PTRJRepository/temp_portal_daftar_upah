import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT TOP 10 division_code, gang_code, period_month, period_year, total_upah_kotor FROM dbo.daftar_upah_aggregation_history WHERE division_code IN ('AB1','AB2','ARA','ARC','DME') ORDER BY period_year DESC, period_month DESC, division_code");
for(const r of rows) console.log(r.division_code.trim()+" "+r.gang_code+" "+r.period_year+"-"+r.period_month+" wage="+r.total_upah_kotor);
console.log("---July count---");
const j = await db.query("SELECT division_code, COUNT(*) as cnt FROM dbo.daftar_upah_aggregation_history WHERE period_month=7 AND period_year=2026 GROUP BY division_code ORDER BY division_code");
for(const r of j) console.log(r.division_code.trim()+" "+r.cnt);
