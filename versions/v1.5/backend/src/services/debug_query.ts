import { Database } from "../db/client";

async function run() {
    const db = Database.getInstance();
    
    const accMonth = 3;
    const accYear = 2026;
    const gangCode = 'HMC';

    console.log(`Checking rows for AccMonth=${accMonth}, AccYear=${accYear}, Gang=${gangCode}...`);
    
    // Simulate the query in DataExtractorService
    const query = `
        SELECT DISTINCT
            RTRIM(e.EmpCode) as emp_code,
            RTRIM(g.GangID) as gang_id,
            RTRIM(g.Description) as gang_desc
        FROM HR_EMPLOYEE e
        INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode)
            AND gl.AccMonth = ?
            AND gl.AccYear = ?
        INNER JOIN PR_GANG g ON g.ID = gl.MasterID
        WHERE (UPPER(RTRIM(g.GangID)) = ? OR UPPER(RTRIM(g.Description)) = ?)
    `;
    
    const rows = await db.query<any>(query, [accMonth, accYear, gangCode, gangCode]);
    console.log("Found rows:", rows.length);

    if (rows.length === 0) {
        console.log("\nDebugging internal joins...");
        const countGl = await db.query<any>(`SELECT COUNT(*) as cnt FROM PR_GANGLN_ARC WHERE AccMonth = ? AND AccYear = ?`, [accMonth, accYear]);
        console.log(`Total rows in PR_GANGLN_ARC for ${accMonth}/${accYear}:`, countGl[0].cnt);

        const countG = await db.query<any>(`SELECT COUNT(*) as cnt FROM PR_GANG WHERE UPPER(RTRIM(GangID)) = ?`, [gangCode]);
        console.log(`Matching gangs in PR_GANG for ${gangCode}:`, countG[0].cnt);

        const countJoined = await db.query<any>(`
            SELECT COUNT(*) as cnt 
            FROM PR_GANGLN_ARC gl
            JOIN PR_GANG g ON g.ID = gl.MasterID
            WHERE gl.AccMonth = ? AND gl.AccYear = ?
              AND UPPER(RTRIM(g.GangID)) = ?
        `, [accMonth, accYear, gangCode]);
        console.log("Joined gl+g count:", countJoined[0].cnt);
    }
}

run().catch(console.error);
