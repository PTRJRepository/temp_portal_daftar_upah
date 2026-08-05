import { Elysia, t } from "elysia";
import { debug, error as logError } from "../utils/logger";
import { OtherIncomesService, OtherIncome } from "../services/otherIncomesService";
import { OtherIncomesExcelService } from "../services/otherIncomesExcelService";

export const otherIncomesRoutes = new Elysia({ prefix: "/other-incomes" })

    .get("/", async ({ query }) => {
        try {
            const { year, month, divisionCode, gangCode, incomeType } = query as any;
            if (!year || !month) {
                return { success: false, error: "Year and month are required parameters" };
            }

            const incomes = await OtherIncomesService.getIncomesWithDetails(
                parseInt(year),
                parseInt(month),
                divisionCode,
                gangCode,
                incomeType
            );
            return { success: true, data: incomes };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to fetch incomes", error);
            return { success: false, error: error.message };
        }
    })

    .get("/summary", async ({ query }) => {
        try {
            const { year, month, divisionCode } = query as any;
            if (!year || !month) {
                return { success: false, error: "Year and month are required parameters" };
            }

            const summary = await OtherIncomesService.getThrSummary(
                parseInt(year),
                parseInt(month),
                divisionCode !== 'ALL' ? divisionCode : undefined
            );
            return { success: true, ...summary };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to fetch THR summary", error);
            return { success: false, error: error.message };
        }
    })

    .get("/recap-all", async ({ query }) => {
        try {
            const { year, month, exclude_ijl, ijl_only } = query as any;
            if (!year || !month) {
                return { success: false, error: "Year and month are required parameters" };
            }

            const excludeIjl = exclude_ijl === 'true';
            const ijlOnly = ijl_only === 'true';
            const summary = await OtherIncomesService.getThrRecapAll(
                parseInt(year),
                parseInt(month),
                excludeIjl,
                ijlOnly
            );
            return { success: true, ...summary };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to fetch THR recap all", error);
            return { success: false, error: error.message };
        }
    })

    .post("/", async ({ body }) => {
        try {
            const data = body as OtherIncome;
            if (!data.nik || !data.period_year || !data.period_month || !data.income_type) {
                return { success: false, error: "Missing required fields" };
            }

            const newIncome = await OtherIncomesService.addIncome(data);
            if (newIncome) {
                return { success: true, data: newIncome };
            } else {
                return { success: false, error: "Failed to create income" };
            }
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to create income", error);
            return { success: false, error: error.message };
        }
    })

    .put("/:id", async ({ params: { id }, body }) => {
        try {
            const data = body as Partial<OtherIncome>;
            const success = await OtherIncomesService.updateIncome(parseInt(id), data);
            return { success };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to update income", error);
            return { success: false, error: error.message };
        }
    })

    .get("/blacklist", async ({ query }) => {
        const { year, month, type } = query as any;
        return await OtherIncomesService.getBlacklist(parseInt(year), parseInt(month), type || 'THR');
    })

    .delete("/blacklist/:id", async ({ params: { id } }) => {
        const success = await OtherIncomesService.removeFromBlacklist(parseInt(id));
        return { success };
    })

    .post("/blacklist", async ({ body }) => {
        const { nik, emp_name, year, month, type, reason } = body as any;
        const success = await OtherIncomesService.addToBlacklist(nik, emp_name, year, month, type || 'THR', reason);
        return { success };
    })

    .delete("/:id", async ({ params: { id } }) => {
        try {
            const success = await OtherIncomesService.deleteIncome(parseInt(id));
            return { success };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to delete income", error);
            return { success: false, error: error.message };
        }
    })

    .delete("/delete-by-period", async ({ query }) => {
        try {
            const { year, month, division, gang, divisionCode, gangCode } = query as any;
            if (!year || !month) {
                return { success: false, error: "Year and month are required" };
            }

            const finalDiv = division || divisionCode;
            const finalGang = gang || gangCode;

            const result = await OtherIncomesService.deleteIncomesByPeriod(
                parseInt(year),
                parseInt(month),
                finalDiv,
                finalGang
            );
            return result;
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to delete incomes by period", error);
            return { success: false, error: error.message };
        }
    })

    .get("/formulas/:type", async ({ params: { type } }) => {
        try {
            const formula = await OtherIncomesService.getFormula(type.toUpperCase());
            return { success: true, formula };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to fetch formula", error);
            return { success: false, error: error.message };
        }
    })

    .post("/formulas/:type", async ({ params: { type }, body }) => {
        try {
            const payload = body as any;
            const formulaString = payload.formulaString;
            const success = await OtherIncomesService.saveFormula(type.toUpperCase(), formulaString);
            return { success };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to save formula", error);
            return { success: false, error: error.message };
        }
    })

    .post("/calculate-thr", async ({ body }) => {
        try {
            const data = body as { year: number, month: number, divisionCode?: string, gangCode?: string };
            if (!data.year || !data.month) {
                return { success: false, error: "Missing required fields: year and month" };
            }

            const result = await OtherIncomesService.calculateAndSaveTHR(data.year, data.month, data.divisionCode, data.gangCode);
            return result;
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to calculate THR", error);
            return { success: false, error: error.message };
        }
    })

    .post("/preview-thr", async ({ body }) => {
        try {
            const data = body as { year: number, month: number, divisionCode?: string, gangCode?: string };
            if (!data.year || !data.month) {
                return { success: false, error: "Missing required fields: year and month" };
            }

            const dataRows = await OtherIncomesService.calculateTHRData(data.year, data.month, data.divisionCode, data.gangCode);
            return { success: true, data: dataRows };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to preview THR", error);
            return { success: false, error: error.message };
        }
    })

    .post("/bulk-save", async ({ body }) => {
        try {
            const { incomes } = body as { incomes: OtherIncome[] };
            if (!incomes || !Array.isArray(incomes)) {
                return { success: false, error: "Incomes array is required" };
            }

            const result = await OtherIncomesService.bulkSaveIncomes(incomes);
            return result;
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed bulk save", error);
            return { success: false, error: error.message };
        }
    })

    // --- Get gang members from history_gang_member (for display in THR page) ---
    .get("/gang-members", async ({ query }) => {
        try {
            const { gang_code, month, year, division_code } = query as any;
            if (!month || !year) {
                return { success: false, error: "Month and year are required" };
            }

            const members = await OtherIncomesService.getGangMembersFromHistory(
                parseInt(month),
                parseInt(year),
                gang_code,
                division_code
            );
            return { success: true, data: members };
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to fetch gang members", error);
            return { success: false, error: error.message };
        }
    }, {
        query: t.Object({
            gang_code: t.Optional(t.String()),
            division_code: t.Optional(t.String()),
            month: t.String(),
            year: t.String()
        })
    })

    .get("/export", async ({ query, set }) => {
        try {
            const { year, month, divisionCode, gangCode, incomeType } = query as any;
            if (!year || !month) {
                set.status = 400;
                return "Year and month are required parameters";
            }

            const buffer = await OtherIncomesExcelService.generateExcel(
                parseInt(year),
                parseInt(month),
                divisionCode,
                gangCode,
                incomeType
            );

            const fileName = `Laporan_Other_Incomes_${month}_${year}.xlsx`;
            set.headers = {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${fileName}"`
            };

            return buffer;
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to export excel", error);
            set.status = 500;
            return error.message;
        }
    })

    .get("/export-bank-list", async ({ query, set }) => {
        try {
            const { year, month, divisionCode, gangCode } = query as any;
            if (!year || !month) {
                set.status = 400;
                return "Year and month are required parameters";
            }

            const buffer = await OtherIncomesExcelService.generateBankListExcel(
                parseInt(year),
                parseInt(month),
                divisionCode,
                gangCode
            );

            const fileName = `Bank_List_THR_${month}_${year}_${divisionCode || 'ALL'}.xlsx`;
            set.headers = {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${fileName}"`
            };

            return buffer;
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to export bank list excel", error);
            set.status = 500;
            return error.message;
        }
    })

    .get("/export-thr", async ({ query, set }) => {
        try {
            const { year, month, divisionCode, gangCode } = query as any;
            if (!year || !month) {
                set.status = 400;
                return "Year and month are required parameters";
            }

            const buffer = await OtherIncomesExcelService.generateTHRExcel(
                parseInt(year),
                parseInt(month),
                divisionCode,
                gangCode
            );

            const fileName = `Laporan_THR_${month}_${year}_${divisionCode || 'ALL'}.xlsx`;
            set.headers = {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${fileName}"`
            };

            return buffer;
        } catch (error: any) {
            logError("OtherIncomesAPI", "Failed to export THR excel", error);
            set.status = 500;
            return error.message;
        }
    });
