import { Elysia, t } from "elysia";
import { PayrollDataService, AggregationRecord } from "../services/payrollDataService";
import { AppsScriptService } from "../services/appsScriptService";
import { divisionDefinition } from "../services/divisionDefinition";
import { getForwardAuthorizationHeader } from "../utils/authBypass";

export const spreadsheetRoutes = new Elysia({ prefix: "/spreadsheet" })
    .post("/sync", async ({ body, headers, set }) => {
        // Auth check (simple bearer token check if needed, or open for now if internal)
        const authHeader = getForwardAuthorizationHeader(headers);
        if (!authHeader) {
            set.status = 401;
            return { success: false, error: "Unauthorized" };
        }

        const { division, month, year, syncType } = body;

        try {
            console.log(`[SpreadsheetSync] Request received for ${division || "ALL"} (${month}/${year}) - Type: ${syncType || "DAFTAR_UPAH"}`);

            // 1. Handle Dashboard Sync
            if (syncType === "DASHBOARD_SUMMARY" || syncType === "SUMMARY_WAGES") {
                console.log(`[SpreadsheetSync] Starting Dashboard Sync for ${month}/${year}`);
                const result = await AppsScriptService.syncDashboard(month, year);
                return {
                    success: true,
                    results: [{ division: "ALL", status: "SUCCESS", sheet_response: result }]
                };
            }

            // 2. Determine Divisions
            let divisionsToProcess: string[] = [];
            if (division) {
                divisionsToProcess = [division];
            } else {
                // Fetch all available divisions
                divisionsToProcess = await divisionDefinition.getAllDivisions(true);
            }

            const results = [];

            // 2. Process Each Division
            for (const div of divisionsToProcess) {
                try {
                    // A. Fetch Data (Detailed Employee Data)
                    const employeeData = await PayrollDataService.fetchEmployeeData(div, month, year, authHeader);

                    if (employeeData.length === 0) {
                        console.log(`[SpreadsheetSync] No employee data for ${div}, skipping.`);
                        results.push({ division: div, status: "SKIPPED_NO_DATA" });
                        continue;
                    }

                    // B. Send to Apps Script
                    const result = await AppsScriptService.syncDivisionToSpreadsheet(div, month, year, employeeData);

                    results.push({
                        division: div,
                        status: "SUCCESS",
                        rows: employeeData.length,
                        sheet_response: result
                    });

                } catch (error: any) {
                    console.error(`[SpreadsheetSync] Error processing ${div}:`, error);
                    results.push({ division: div, status: "ERROR", message: error.message });
                }
            }

            return {
                success: true,
                results: results
            };

        } catch (error: any) {
            console.error("[SpreadsheetSync] Global Error:", error);
            set.status = 500;
            return {
                success: false,
                error: error.message || "Internal Server Error"
            };
        }
    }, {
        body: t.Object({
            division: t.Optional(t.String()),
            month: t.Numeric(),
            year: t.Numeric(),
            syncType: t.Optional(t.String())
        })
    });
