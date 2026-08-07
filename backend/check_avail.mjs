import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getInstance(Config.DEFAULT_DATABASE, Config.DB_PROFILE);
for (const m of [6,7]) {
  const rows = await db.query("SELECT DISTINCT division_code FROM dbo.daftar_upah_aggregation_history WHERE period_month=? AND period_year=2026".replace("dbo.daftar_upah_aggregation_history","dbo.daftar_upah_aggregation_history"), [m, 2026]);
  // fallback: check via extract? Just query daftar_upah source if exists
  console.log("m="+m+" rows="+(rows?.length||0));
}
