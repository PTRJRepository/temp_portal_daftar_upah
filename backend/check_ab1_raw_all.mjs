import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT TOP 5 division_code, gang_code, period_month, created_at FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' ORDER BY created_at DESC");
console.log(rows.length + " AB1 raw");
for(const r of rows) console.log(r.division_code.trim()+" "+r.gang_code+" m"+r.period_month+" "+r.created_at);
