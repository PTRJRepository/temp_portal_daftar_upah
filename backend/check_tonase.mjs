import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
const rows = await db.query("SELECT division_code, tonase FROM dbo.division_tonase WHERE period_month=7 AND period_year=2026 ORDER BY division_code");
for (const r of rows) console.log(r.division_code.trim() + " t=" + r.tonase);
console.log("count " + rows.length);
