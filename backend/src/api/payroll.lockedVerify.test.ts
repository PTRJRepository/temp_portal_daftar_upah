import { describe, expect, it } from "bun:test";

describe("payroll locked/verify route", () => {
    it("returns valid + user divisions for an authorized bearer", async () => {
        process.env.LOG_TO_FILE = "false";
        const { Config } = await import("../config");
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request("http://localhost/payroll/locked/verify", {
            headers: {
                Authorization: `Bearer ${Config.SYSTEM_TOKEN}`
            }
        }));
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.valid).toBe(true);
        expect(body.role).toBe("admin");
        // SYSTEM_TOKEN -> system admin bypass -> full division list
        expect(Array.isArray(body.divisions)).toBe(true);
        expect(body.divisions.length).toBeGreaterThan(0);
    });

    it("rejects with 401 when no bearer token is present", async () => {
        process.env.LOG_TO_FILE = "false";
        const { payrollRoutes } = await import("./payroll");

        const response = await payrollRoutes.handle(new Request("http://localhost/payroll/locked/verify"));
        const body = await response.json() as any;

        expect(response.status).toBe(401);
        expect(body).toMatchObject({});
    });
});
