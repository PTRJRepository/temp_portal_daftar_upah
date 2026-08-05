import { Elysia, t } from "elysia";
import { AuthService } from "../services/authService";
import { User } from "../types/user";
import { reportService } from "../services/reportService";
import { generateDaftarUpahExcel } from "../services/daftarUpahExcelService";
import { resolveUserFromHeaders } from "../utils/authBypass";

const authService = AuthService.getInstance();

// Helper to get user from header
async function getUserFromHeader(headers: Record<string, string | undefined>): Promise<User | null> {
    return resolveUserFromHeaders(headers, authService);
}

// Simple in-memory job store
// In production, use Redis or database
const jobs: Map<string, { status: string; result?: any; error?: string; created_at: number }> = new Map();

// Cleanup old jobs periodically (every 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.created_at > 3600000) { // 1 hour
            jobs.delete(id);
        }
    }
}, 3600000);

export const reportsRoutes = new Elysia({ prefix: "/reports" })
    .derive(async ({ headers }) => {
        const user = await getUserFromHeader(headers);
        return { currentUser: user };
    })
    .onBeforeHandle(({ currentUser, set }) => {
        if (!currentUser) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
    })
    .post("/generate", async ({ body }) => {
        const { month, year, gang_code, loc_code } = body as any;

        // Generate job ID
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Store initial job state
        jobs.set(jobId, {
            status: "pending",
            created_at: Date.now()
        });

        // Start processing in background
        reportService.generateReport(month, year, gang_code, loc_code)
            .then(result => {
                const job = jobs.get(jobId);
                if (job) {
                    job.status = "completed";
                    job.result = result;
                }
            })
            .catch(error => {
                console.error(`Job ${jobId} failed:`, error);
                const job = jobs.get(jobId);
                if (job) {
                    job.status = "failed";
                    job.error = error.message || String(error);
                }
            });

        return { job_id: jobId, status: "pending" };
    }, {
        body: t.Object({
            month: t.Number(),
            year: t.Number(),
            gang_code: t.String(),
            loc_code: t.Optional(t.String())
        })
    })
    .get("/:job_id", async ({ params, set }) => {
        const job = jobs.get(params.job_id);
        if (!job) {
            set.status = 404;
            return { error: "Job not found" };
        }
        return job;
    })

    // ============================================================
    // GET /reports/excel
    // Download Daftar Upah as Excel with dynamic premi columns
    // and Excel formulas for all calculated values
    // ============================================================
    .get("/excel", async ({ query, set, currentUser }) => {
        try {
            const year = parseInt(query.year as string);
            const month = parseInt(query.month as string);
            let division = query.division as string || undefined;
            const gang = query.gang as string || 'ALL';

            if (currentUser?.role?.toLowerCase() === 'kerani' && currentUser?.divisions?.length > 0) {
                division = currentUser.divisions[0];
            }

            if (!year || !month || month < 1 || month > 12) {
                set.status = 400;
                return { error: "Invalid year or month parameter" };
            }

            // Fetch payroll data using the same report service
            const reportResult = await reportService.generateReport(month, year, gang, division);

            // Extract employee flat records from aggregation result
            const records: any[] = reportResult?.data_rows ?? reportResult?.employees ?? [];

            if (!records || records.length === 0) {
                set.status = 404;
                return { error: "No payroll data available for the selected period" };
            }

            const excelBuffer = await generateDaftarUpahExcel(
                records,
                month,
                year,
                division || 'ALL',
                gang
            );

            set.headers["Content-Type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            set.headers["Content-Disposition"] = `attachment; filename="Daftar_Upah_${division || 'ALL'}_${gang}_${month}_${year}.xlsx"`;

            return excelBuffer;
        } catch (error: any) {
            console.error("[Reports] Error generating Daftar Upah Excel:", error);
            set.status = 500;
            return { error: error.message || "Failed to generate Daftar Upah Excel" };
        }
    });
