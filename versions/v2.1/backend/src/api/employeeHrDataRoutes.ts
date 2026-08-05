import { Elysia, t } from "elysia";
import { employeeHrDataService } from "../services/employeeHrDataService";
import { AuthService } from "../services/authService";
import { User } from "../types/user";
import { resolveUserFromHeaders } from "../utils/authBypass";

const authService = AuthService.getInstance();

// Helper to get user from header
async function getUserFromHeader(headers: Record<string, string | undefined>): Promise<User | null> {
    return resolveUserFromHeaders(headers, authService);
}

export const employeeHrDataRoutes = new Elysia({ prefix: "/employee-hr-data" })
    .derive(async ({ headers }) => {
        const user = await getUserFromHeader(headers);
        return { currentUser: user };
    })
    // NOTE: In production, consider uncommenting this to enforce auth
    // .onBeforeHandle(({ currentUser, set }) => {
    //     if (!currentUser) {
    //         set.status = 401;
    //         return { success: false, error: "Unauthorized" };
    //     }
    // })

    // --- Ensure Tables ---
    .post("/setup", async ({ set }) => {
        try {
            await employeeHrDataService.ensureTablesExist();
            return { success: true, message: "Tables ensured" };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    })

    // --- Bulk Fetch HR Data ---
    .get("/bulk", async ({ query, set }) => {
        try {
            const empCodes = (query.emp_codes || "").split(",").map(c => c.trim()).filter(c => c.length > 0);
            if (empCodes.length === 0) {
                return { success: true, count: 0, data: {} };
            }

            const hrDataMap = await employeeHrDataService.getHrDataBulk(empCodes);

            // Convert Map to plain object for JSON response
            const dataObj: Record<string, any> = {};
            hrDataMap.forEach((value, key) => {
                dataObj[key] = value;
            });

            return { success: true, count: hrDataMap.size, data: dataObj };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        query: t.Object({
            emp_codes: t.Optional(t.String())
        })
    })

    // --- Single Fetch HR Data ---
    .get("/:emp_code", async ({ params, set }) => {
        try {
            const data = await employeeHrDataService.getHrData((params.emp_code || '').trim());
            if (!data) {
                // Return empty object rather than 404 so UI knows no override exists
                return { success: true, data: null };
            }
            return { success: true, data };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    })

    // --- Update HR Data Field ---
    .put("/:emp_code", async ({ params, body, set, currentUser }) => {
        try {
            const { field, value } = body as { field: string, value: string };
            if (!field) {
                set.status = 400;
                return { success: false, error: "Field is required" };
            }

            // Fallback username if missing auth
            const username = currentUser?.username || 'system';
            const cleanEmpCode = (params.emp_code || '').trim();
            const cleanValue = (value || '').trim();

            const result = await employeeHrDataService.updateHrDataField(
                cleanEmpCode,
                field,
                cleanValue,
                username
            );

            return { success: true, updated: result };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    }, {
        body: t.Object({
            field: t.String(),
            value: t.String()
        })
    })

    // --- Get HR Data History ---
    .get("/:emp_code/history", async ({ params, set }) => {
        try {
            const history = await employeeHrDataService.getHrDataHistory(params.emp_code);
            return { success: true, count: history.length, data: history };
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    })

    // --- Rollback HR Data History ---
    .post("/:emp_code/rollback", async ({ params, set }) => {
        try {
            // Hardcoded to nik_ktp for now, can be parameterized if needed
            const result = await employeeHrDataService.rollbackHrDataField(params.emp_code, 'nik_ktp');
            if (result) {
                return { success: true, message: "Rollback successful" };
            } else {
                set.status = 400;
                return { success: false, error: "No history found to rollback" };
            }
        } catch (e: any) {
            set.status = 500;
            return { success: false, error: e.message };
        }
    });
