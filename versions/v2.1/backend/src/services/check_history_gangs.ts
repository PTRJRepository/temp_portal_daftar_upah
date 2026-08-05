import { historyDatabaseService } from "./historyDatabaseService";
import { Database } from "../db/client";

async function run() {
    const db = historyDatabaseService.getPayrollDatabase();
    const months = [1, 2, 3]; // Jan, Feb, Mar 2026
    const year = 2026;
    const gangs = ["AMC", "HMC", "B2N", "INF", "INT"];

    console.log("Checking history data status...");

    for (const month of months) {
        console.log(`\n--- Period: ${month}/${year} ---`);
        for (const gang of gangs) {
            const header = await db.queryOne(`
                SELECT count(*) as count 
                FROM dbo.payroll_history_header 
                WHERE period_month = ? AND period_year = ? AND gang_code = ?
            `, [month, year, gang]);
            
            const detail = await db.queryOne(`
                SELECT count(*) as count 
                FROM dbo.payroll_history_detail d
                JOIN dbo.payroll_history_header h ON d.master_id = h.id
                WHERE h.period_month = ? AND h.period_year = ? AND h.gang_code = ?
            `, [month, year, gang]);

            console.log(`Gang ${gang}: Header=${header.count}, Detail=${detail.count}`);
        }
    }
}
run();
