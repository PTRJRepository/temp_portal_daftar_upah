import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
const rows = await db.query(`SELECT division_code, gang_code, total_upah_kotor FROM (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY period_month, period_year, gang_code ORDER BY COALESCE(updated_at, created_at) DESC, id DESC) as rn FROM dbo.daftar_upah_aggregation_history h WHERE period_month=7 AND period_year=2026) t WHERE rn=1 ORDER BY division_code, gang_code`);
const map={}; for(const r of rows){ (map[r.division_code.trim()]||(map[r.division_code.trim()]=[])).push(r.gang_code); }
for(const k of Object.keys(map).sort()) console.log(k+" gangs:"+map[k].join(','));
console.log("total rows "+rows.length);
