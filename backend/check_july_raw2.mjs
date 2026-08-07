import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT division_code, gang_code, period_year, period_month FROM dbo.daftar_upah_aggregation_history WHERE period_year=2026 AND period_month=7 ORDER BY division_code, gang_code");
console.log(rows.length + " total July rows");
for(const r of rows) console.log(r.division_code.trim()+"/"+r.gang_code+" y"+r.period_year+" m"+r.period_month);
