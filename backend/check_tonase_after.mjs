import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT division_code, tonase FROM dbo.division_tonase WHERE period_month=7 AND period_year=2026 ORDER BY division_code");
for(const r of rows) console.log(r.division_code.trim() + " t=" + r.tonase);
