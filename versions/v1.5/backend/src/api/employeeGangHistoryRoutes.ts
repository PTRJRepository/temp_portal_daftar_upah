import { Elysia, t } from 'elysia';
import { employeeGangHistoryService } from '../services/employeeGangHistoryService';
import { duplicateNikMitigationService } from '../services/DuplicateNikMitigationService';
import { error as logError } from '../utils/logger';

export const employeeGangHistoryRoutes = new Elysia({ prefix: '/employee-history' })
    .get('/gang-history/:identifier', async ({ params, set }) => {
        try {
            const history = await employeeGangHistoryService.getGangHistory(params.identifier);
            return { success: true, data: history };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to get gang history", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    })
    .get('/current-official/:nik', async ({ params, set }) => {
        try {
            const info = await employeeGangHistoryService.getCurrentOfficialInfo(params.nik);
            if (!info) {
                set.status = 404;
                return { success: false, error: "Employee not found" };
            }
            return { success: true, data: info };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to get current info", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    })
    .post('/resolve-latest-codes', async ({ body, set }) => {
        try {
            const map = await employeeGangHistoryService.resolveLatestEmpCodes(body.niks);
            // Convert Map to plain object for JSON response
            const result: Record<string, string> = {};
            map.forEach((val, key) => { result[key] = val; });
            return { success: true, data: result };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to resolve codes", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        body: t.Object({
            niks: t.Array(t.String())
        })
    })
    // ============================================================================
    // DUPLICATE NIK MITIGATION ENDPOINTS
    // ============================================================================

    /**
     * GET /duplicate-niks/report
     * Generate report of all duplicate NIKs in the system
     */
    .get('/duplicate-niks/report', async ({ set }) => {
        try {
            const report = await duplicateNikMitigationService.generateDuplicateReport();
            return { success: true, data: report };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to generate duplicate NIK report", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    })

    /**
     * GET /duplicate-niks/detect
     * Detect and list all NIKs with duplicate entries
     */
    .get('/duplicate-niks/detect', async ({ set }) => {
        try {
            const duplicates = await duplicateNikMitigationService.detectDuplicateNiks();
            return { success: true, data: duplicates };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to detect duplicate NIKs", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    })

    /**
     * GET /duplicate-niks/check/:nik
     * Check if a specific NIK has duplicates
     */
    .get('/duplicate-niks/check/:nik', async ({ params, set }) => {
        try {
            const hasDuplicate = await duplicateNikMitigationService.hasDuplicate(params.nik);
            const employees = await duplicateNikMitigationService.getEmployeesByNik(params.nik);
            
            return {
                success: true,
                data: {
                    nik: params.nik,
                    has_duplicate: hasDuplicate,
                    employee_count: employees.length,
                    employees
                }
            };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to check duplicate NIK", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    })

    /**
     * POST /duplicate-niks/resolve
     * Resolve the correct EmpCode for a NIK with optional context
     */
    .post('/duplicate-niks/resolve', async ({ body, set }) => {
        try {
            const resolution = await duplicateNikMitigationService.resolveEmpCode(body.nik, {
                preferredGang: body.preferred_gang,
                preferredDivision: body.preferred_division,
                periodMonth: body.period_month,
                periodYear: body.period_year
            });

            return { success: true, data: resolution };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to resolve NIK", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        body: t.Object({
            nik: t.String(),
            preferred_gang: t.Optional(t.String()),
            preferred_division: t.Optional(t.String()),
            period_month: t.Optional(t.Integer()),
            period_year: t.Optional(t.Integer())
        })
    })

    /**
     * GET /duplicate-niks/emp-codes/:nik
     * Get all EmpCodes associated with a NIK
     */
    .get('/duplicate-niks/emp-codes/:nik', async ({ params, set }) => {
        try {
            const empCodeMap = await duplicateNikMitigationService.getAllEmpCodesForNik(params.nik);
            return { success: true, data: empCodeMap };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to get EmpCodes for NIK", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    })

    /**
     * GET /duplicate-niks/history/:nik
     * Get payroll history for a NIK (handles duplicate NIKs automatically)
     */
    .get('/duplicate-niks/history/:nik', async ({ params, query, set }) => {
        try {
            const history = await duplicateNikMitigationService.queryPayrollHistory(params.nik, {
                periodMonth: query.period_month ? Number(query.period_month) : undefined,
                periodYear: query.period_year ? Number(query.period_year) : undefined
            });

            return { success: true, data: history };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to get payroll history with duplicate handling", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        query: t.Object({
            period_month: t.Optional(t.String()),
            period_year: t.Optional(t.String())
        })
    })

    /**
     * GET /duplicate-niks/gang-history/:nik
     * Get gang member history for a NIK (handles duplicate NIKs automatically)
     */
    .get('/duplicate-niks/gang-history/:nik', async ({ params, query, set }) => {
        try {
            const history = await duplicateNikMitigationService.queryGangMemberHistory(params.nik, {
                periodMonth: query.period_month ? Number(query.period_month) : undefined,
                periodYear: query.period_year ? Number(query.period_year) : undefined
            });

            return { success: true, data: history };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to get gang history with duplicate handling", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        query: t.Object({
            period_month: t.Optional(t.String()),
            period_year: t.Optional(t.String())
        })
    })

    /**
     * POST /duplicate-niks/find-by-name
     * Find employees by name when NIK is unreliable
     */
    .post('/duplicate-niks/find-by-name', async ({ body, set }) => {
        try {
            const employees = await duplicateNikMitigationService.findEmployeesByName(body.name, {
                gang: body.gang,
                division: body.division,
                limit: body.limit || 10
            });

            return { success: true, data: employees };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to find employees by name", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        body: t.Object({
            name: t.String(),
            gang: t.Optional(t.String()),
            division: t.Optional(t.String()),
            limit: t.Optional(t.Integer())
        })
    })

    /**
     * POST /duplicate-niks/resolve-by-identity
     * Resolve employee identity using NIK or name with context
     */
    .post('/duplicate-niks/resolve-by-identity', async ({ body, set }) => {
        try {
            const resolution = await duplicateNikMitigationService.resolveByIdentity(
                body.identifier,
                body.name,
                {
                    gang: body.gang,
                    division: body.division
                }
            );

            return { success: true, data: resolution };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to resolve by identity", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        body: t.Object({
            identifier: t.String(),
            name: t.Optional(t.String()),
            gang: t.Optional(t.String()),
            division: t.Optional(t.String())
        })
    })

    /**
     * NEW: Enhanced endpoints with resolution info
     */

    /**
     * GET /gang-history-with-resolution/:identifier
     * Get gang history with duplicate NIK resolution info
     */
    .get('/gang-history-with-resolution/:identifier', async ({ params, set }) => {
        try {
            const history = await employeeGangHistoryService.getGangHistoryWithResolution(params.identifier);
            return { success: true, data: history };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to get gang history with resolution", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    })

    /**
     * GET /check-duplicate/:identifier
     * Check if an identifier has duplicate NIK issues
     */
    .get('/check-duplicate/:identifier', async ({ params, set }) => {
        try {
            const hasDuplicate = await employeeGangHistoryService.hasDuplicateNik(params.identifier);
            return { success: true, data: { identifier: params.identifier, has_duplicate: hasDuplicate } };
        } catch (error: any) {
            logError("EmployeeHistoryAPI", "Failed to check duplicate", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    });
