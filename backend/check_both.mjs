import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
for (const [dbName, profile] of [["extend_db_ptrj","SERVER_PROFILE_1"],["extend_db_ptrj_transaksi","SERVER_PROFILE_1"],["extend_db_ptrj","SERVER_PROFILE_2"]]) {
  try {
    const db = Database.getInstance(dbName, profile);
    const rows = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 AND period_year=2026");
    console.log(dbName + " " + profile + " AB1 July count " + rows[0].c);
  } catch(e){ console.log(dbName + " " + profile + " error " + e.message.slice(0,120)); }
}
