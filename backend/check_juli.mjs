import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
const q = `SELECT period_month, period_year, COUNT(DISTINCT division_code) as divs, COUNT(*) as rows FROM (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY period_month, period_year, gang_code ORDER BY COALESCE(updated_at, created_at) DESC, id DESC) as rn FROM dbo.daftar_upah_aggregation_history h) t WHERE rn=1 AND period_year=2026 GROUP BY period_month, period_year ORDER BY period_month`;
try { const rows = await db.query(q); console.log(JSON.stringify(rows,null,2)); } catch(e){ console.error(e.message.slice(0,800)); }
