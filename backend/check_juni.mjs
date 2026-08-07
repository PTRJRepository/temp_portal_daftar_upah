import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
const q = "SELECT division_code, COUNT(*) as cnt FROM (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY period_month, period_year, gang_code ORDER BY COALESCE(updated_at, created_at) DESC, id DESC) as rn FROM dbo.daftar_upah_aggregation_history h WHERE period_month=6 AND period_year=2026) t WHERE rn=1 GROUP BY division_code ORDER BY division_code";
const rows = await db.query(q);
for (const r of rows) console.log(r.division_code + " " + r.cnt);
