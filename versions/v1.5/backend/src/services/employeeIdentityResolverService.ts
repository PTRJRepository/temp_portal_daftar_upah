import { Database } from "../db/client";

type EmployeeIdentity = {
    nik: string;
    emp_code: string;
    emp_name: string;
};

function normalizeString(value: unknown): string {
    return String(value || "").trim().toUpperCase();
}

export class EmployeeIdentityResolverService {
    private static instance: EmployeeIdentityResolverService;

    public static getInstance(): EmployeeIdentityResolverService {
        if (!EmployeeIdentityResolverService.instance) {
            EmployeeIdentityResolverService.instance = new EmployeeIdentityResolverService();
        }
        return EmployeeIdentityResolverService.instance;
    }

    public async resolve(identifier: unknown): Promise<EmployeeIdentity | null> {
        const normalized = normalizeString(identifier);
        if (!normalized) return null;

        const db = Database.getInstance();
        const row = await db.queryOne<any>(`
            SELECT TOP 1
                RTRIM(ISNULL(NewICNo, '')) as nik,
                RTRIM(EmpCode) as emp_code,
                RTRIM(EmpName) as emp_name
            FROM HR_EMPLOYEE
            WHERE RTRIM(EmpCode) = ? OR RTRIM(ISNULL(NewICNo, '')) = ?
            ORDER BY EmpCode DESC
        `, [normalized, normalized]);

        if (!row) return null;
        return {
            nik: normalizeString(row.nik),
            emp_code: normalizeString(row.emp_code),
            emp_name: normalizeString(row.emp_name)
        };
    }
}

export const employeeIdentityResolverService = EmployeeIdentityResolverService.getInstance();
