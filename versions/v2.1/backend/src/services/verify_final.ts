import { DataExtractorService } from "./dataExtractorService";

async function run() {
    const extractor = DataExtractorService.getInstance();
    
    console.log("Verifying WKS_AR (HMC) history retrieval...");
    const resultAr = await extractor.extractPayrollData(3, 2026, "ALL", "WKS_AR", null, undefined, false, true);
    console.log("WKS_AR rows:", resultAr.data_rows.length);
    if (resultAr.data_rows.length > 0) {
        console.log("Sample WKS_AR row:", {
            emp: resultAr.data_rows[0].emp_name,
            gang: resultAr.data_rows[0].gang_code,
            bruto: resultAr.data_rows[0].penghasilan_bruto
        });
    }

    console.log("\nVerifying WKS_PG (AMC) history retrieval...");
    const resultPg = await extractor.extractPayrollData(3, 2026, "ALL", "WKS_PG", null, undefined, false, true);
    console.log("WKS_PG rows:", resultPg.data_rows.length);
    if (resultPg.data_rows.length > 0) {
        console.log("Sample WKS_PG row:", {
            emp: resultPg.data_rows[0].emp_name,
            gang: resultPg.data_rows[0].gang_code,
            bruto: resultPg.data_rows[0].penghasilan_bruto
        });
    }
}

run().catch(console.error);
