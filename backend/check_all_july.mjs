import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT division_code, COUNT(*) as cnt FROM dbo.daftar_upah_aggregation_history WHERE period_month=7 AND period_year=2026 GROUP BY division_code ORDER BY division_code");
for(const r of rows) console.log(r.division_code.trim() + " " + r.cnt);
console.log("total divs " + rows.length);
