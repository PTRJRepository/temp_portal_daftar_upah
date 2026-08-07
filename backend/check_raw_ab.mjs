import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT TOP 5 division_code, gang_code, period_month, period_year, updated_at FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' ORDER BY updated_at DESC");
console.log("rows "+rows.length);
for(const r of rows) console.log(JSON.stringify(r));
