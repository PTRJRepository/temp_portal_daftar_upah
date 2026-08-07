import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
const rows = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 AND period_year=2026");
console.log("AB1 July " + rows[0].c);
const rows2 = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE period_month=7 AND period_year=2026");
console.log("total July " + rows2[0].c);
const rows3 = await db.query("SELECT DISTINCT division_code as dc FROM dbo.daftar_upah_aggregation_history WHERE period_month=7 AND period_year=2026 ORDER BY dc");
console.log(rows3.map(r=>r.dc.trim()).join(','));
