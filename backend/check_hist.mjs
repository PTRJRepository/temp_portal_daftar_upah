import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
const rows = await db.query("SELECT TOP 5 * FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 ORDER BY updated_at DESC");
console.log(rows.length + " rows");
for(const r of rows) console.log(r.period_year + "-" + r.period_month + " " + r.gang_code + " " + r.updated_at);
