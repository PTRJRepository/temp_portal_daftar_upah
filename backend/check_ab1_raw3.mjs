import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT TOP 10 division_code, gang_code, period_year, period_month, created_at FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' ORDER BY created_at DESC");
for(const r of rows) console.log(JSON.stringify(r));
