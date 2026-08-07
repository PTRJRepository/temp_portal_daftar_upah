import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
try {
  console.log("try delete AB1 July TEST");
  await db.query("DELETE FROM dbo.daftar_upah_aggregation_history WHERE period_month=7 AND period_year=2026 AND division_code='AB1' AND gang_code='ZZTEST'");
  console.log("delete ok");
  console.log("try insert dummy AB1");
  await db.query(`INSERT INTO dbo.daftar_upah_aggregation_history (period_month, period_year, division_code, gang_code, gang_description, total_employees, total_hk, total_upah_kotor, total_upah_bersih, total_premi, total_lembur, total_ffb_weight, created_at, updated_at, source_endpoint) VALUES (7,2026,'AB1','ZZTEST','Test AB1',10,100,1000000,900000,100000,50000,0,GETDATE(),GETDATE(),'test')`);
  console.log("insert ok");
  const rows = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND gang_code='ZZTEST'");
  console.log("count ZZTEST " + rows[0].c);
  await db.query("DELETE FROM dbo.daftar_upah_aggregation_history WHERE gang_code='ZZTEST'");
  console.log("cleanup ok");
} catch(e){ console.error("ERROR", e.message.slice(0,1000)); console.error(e.stack?.slice(0,800)); }
