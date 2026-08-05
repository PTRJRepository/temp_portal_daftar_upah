import { historyDatabaseService } from "./historyDatabaseService";
import { Database } from "../db/client";

async function run() {
    const db = historyDatabaseService.getPayrollDatabase();
    const month = 3;
    const year = 2026;
    const gangs = ["AMC", "HMC", "B2N", "INF", "INT"];

    console.log(`Checking history data for ${month}/${year}...`);

    for (const gang of gangs) {
        const rows = await db.query(`
            SELECT division_code, gang_code, count(*) as count 
            FROM dbo.payroll_history_header 
            WHERE period_month = ? AND period_year = ? AND gang_code = ?
            GROUP BY division_code, gang_code
        `, [month, year, gang]);
        
        if (rows.length === 0) {
            console.log(`Gang ${gang}: NOT FOUND`);
        } else {
            for (const row of rows) {
                console.log(`Gang ${gang}: Division=${row.division_code}, Count=${row.count}`);
            }
        }
    }
}
run();
