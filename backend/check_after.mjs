import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
const rows = await db.query("WITH lr AS (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY period_month, period_year, gang_code ORDER BY COALESCE(updated_at, created_at) DESC, id DESC) as rn FROM dbo.daftar_upah_aggregation_history h WHERE period_month=7 AND period_year=2026) SELECT division_code, COUNT(*) as cnt FROM lr WHERE rn=1 GROUP BY division_code ORDER BY division_code");
for(const r of rows) console.log(r.division_code.trim() + " " + r.cnt);
