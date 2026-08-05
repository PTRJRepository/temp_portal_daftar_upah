
import { Elysia, t } from "elysia";
import { EmployeeEstateService } from "../services/employeeEstateService";

export const employeeEstateRoutes = new Elysia({ prefix: '/employee-estate' })
    .get('/', async () => {
        try {
            const data = await EmployeeEstateService.getEmployeeJobs();
            return { success: true, data };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    })
    .post('/save', async ({ body }) => {
        try {
            const { jobs } = body as { jobs: any[] };
            const result = await EmployeeEstateService.saveEmployeeJobs(jobs);
            return { success: result.success, count: result.count };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            jobs: t.Array(t.Object({
                empcode: t.String(),
                employee_name: t.String(),
                gang: t.String(),
                divisi_id: t.String(),
                jabatan: t.String()
            }))
        })
    })
    .post('/update', async ({ body }) => {
        try {
            const { empCode, jobTitle } = body as { empCode: string, jobTitle: string };
            const success = await EmployeeEstateService.updateJobTitle(empCode, jobTitle);
            return { success };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            empCode: t.String(),
            jobTitle: t.String()
        })
    });
