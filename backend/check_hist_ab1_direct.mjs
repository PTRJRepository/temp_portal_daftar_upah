import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db1 = Database.getInstance("extend_db_ptrj", "SERVER_PROFILE_1");
const db2 = Database.getInstance("extend_db_ptrj", "SERVER_PROFILE_2");
for (const [label,db] of [["P1",""], ["P1",db1], ["P2",db2]]) {
  if(!db) continue;
  try{
    const rows = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7");
    console.log(label + " AB1 " + rows[0].c);
  }catch(e){ console.log(label + " error " + e.message.slice(0,100)); }
}
