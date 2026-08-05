import { Elysia, t } from 'elysia';
import { employeeComparisonService } from '../services/employee/EmployeeComparisonService';
import { error as logError } from '../utils/logger';

export const employeeComparisonRoutes = new Elysia({ prefix: '/api/employee-compare' })
    /**
     * Compare EmpCode methods for a division/gang
     *
     * Returns comparison between:
     * 1. Career Progress method - latest EmpCode from HR_EMPLOYEE by NIK
     * 2. Gang method - EmpCode from HR_GANGLN for specific gang
     */
    .get('/compare', async ({ query, set }) => {
        try {
            const division = (query.division as string) || 'ALL';
            const gang = query.gang as string | undefined;
            const month = query.month ? parseInt(query.month as string) : undefined;
            const year = query.year ? parseInt(query.year as string) : undefined;

            const result = await employeeComparisonService.compareEmployees(
                division,
                gang,
                month,
                year
            );

            return { success: true, data: result };
        } catch (error: any) {
            logError("EmployeeComparisonAPI", "Failed to compare employees", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        query: t.Object({
            division: t.Optional(t.String()),
            gang: t.Optional(t.String()),
            month: t.Optional(t.String()),
            year: t.Optional(t.String())
        })
    })
    /**
     * Find all employees with duplicate NIKs
     *
     * Returns list of NIKs that appear multiple times in HR_EMPLOYEE
     */
    .get('/duplicate-nik', async ({ set }) => {
        try {
            const result = await employeeComparisonService.findDuplicateNik();
            return { success: true, data: result };
        } catch (error: any) {
            logError("EmployeeComparisonAPI", "Failed to find duplicate NIKs", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    });
