import { Elysia, t } from "elysia";
import { millProductionService } from "../services/millProductionService";
import { debug, error as logError } from "../utils/logger";

const millProductionRoutes = new Elysia({ prefix: "" })
    .get("/summary", async ({ query, set }) => {
        try {
            const month = query.month;
            const year = query.year;

            if (!month || !year) {
                set.status = 400;
                return {
                    success: false,
                    error: "month and year are required parameters"
                };
            }

            const parsedMonth = parseInt(month, 10);
            const parsedYear = parseInt(year, 10);

            if (isNaN(parsedMonth) || isNaN(parsedYear)) {
                set.status = 400;
                return {
                    success: false,
                    error: "Invalid month or year format"
                };
            }

            debug("API", `Fetching mill production summary for ${parsedMonth}/${parsedYear}`);
            const data = await millProductionService.getProductionSummary(parsedMonth, parsedYear);

            return {
                success: true,
                data
            };
        } catch (e: any) {
            logError("API", "Error fetching mill production summary", e);
            set.status = 500;
            return {
                success: false,
                error: "Failed to fetch mill production summary"
            };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    });

export { millProductionRoutes };
