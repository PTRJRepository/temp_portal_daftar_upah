import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
for(const prof of ["SERVER_PROFILE_1","SERVER_PROFILE_2"]) {
  const db = Database.getInstance("extend_db_ptrj", prof);
  const rows = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 AND period_year=2026");
  console.log(prof + " AB1 July " + rows[0].c);
  const all = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE period_month=7 AND period_year=2026");
  console.log(prof + " total July " + all[0].c);
}
