import { historySeederService } from "./historySeederService";

async function run() {
    console.log("Starting manual re-seeding for March 2026 (WKS AR and WKS PG)...");
    
    const optionsWksAr = {
        periodMonth: 3,
        periodYear: 2026,
        divisionCode: "WKS_AR",
        createdBy: "system-fix",
        force: true
    };

    const optionsWksPg = {
        periodMonth: 3,
        periodYear: 2026,
        divisionCode: "WKS_PG",
        createdBy: "system-fix",
        force: true
    };

    console.log("\n--- Seeding WKS_AR ---");
    const resultAr = await historySeederService.seedPayrollHistory(optionsWksAr as any);
    console.log("WKS_AR Result:", JSON.stringify(resultAr, null, 2));

    console.log("\n--- Seeding WKS_PG ---");
    const resultPg = await historySeederService.seedPayrollHistory(optionsWksPg as any);
    console.log("WKS_PG Result:", JSON.stringify(resultPg, null, 2));
}

run().catch(console.error);
