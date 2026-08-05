import { Database } from "../db/client";
import { Config } from "../config";
import { Employee } from "../types/employee/Employee";
import { divisionConfigService } from "./config/DivisionConfigService";
import { currentPeriodService } from "./currentPeriodService";
import { debug, error as logError } from "../utils/logger";

const CATEGORY = "EmployeeRepository";

export class EmployeeRepository {
    private static instance: EmployeeRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): EmployeeRepository {
        if (!EmployeeRepository.instance) {
            EmployeeRepository.instance = new EmployeeRepository();
        }
        return EmployeeRepository.instance;
    }

    private mapGender(value: any): 'L' | 'P' {
        const str = String(value).trim();
        if (str === '2' || str === 'P') return 'P';
        return 'L';
    }

    /**
     * Get employees for payroll extraction (Legacy getEmployees from PayrollEmployeeRepository)
     */
    public async getEmployeesForPayroll(
        gangCondition: string, 
        month: number, 
        year: number, 
        serverProfile?: string, 
        isHistorical: boolean = false, 
        gangCodeInput: string | null = null
    ): Promise<Employee[]> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        
        if (isHistorical) {
            return this.getEmployeesHistorical(db, gangCondition, month, year, gangCodeInput, serverProfile);
        } else {
            return this.getEmployeesLive(db, gangCondition);
        }
    }

    private async getEmployeesHistorical(
        db: Database,
        gangCondition: string,
        month: number,
        year: number,
        gangCodeInput: string | null,
        serverProfile?: string
    ): Promise<Employee[]> {
        const { accMonth, accYear } = currentPeriodService.calendarToAccMonth(month, year);
        let historicalCondition = gangCondition;
        
        if (gangCodeInput && gangCodeInput !== 'ALL') {
            historicalCondition = `(UPPER(RTRIM(g.GangID)) = '${gangCodeInput}' OR UPPER(RTRIM(g.Description)) = '${gangCodeInput}')`;
        } else {
            historicalCondition = gangCondition.replace(/(gl|g)\.GangCode/ig, 'g.GangID');
        }

        try {
            const sql = `
                SELECT 
                    emp_code, actual_nik, emp_name, gender, loc_code, 
                    gang_code, gang_desc, pay_rate, beras_rate, 
                    join_date, res_address, hr_emp_type
                FROM (
                    SELECT 
                        RTRIM(e.EmpCode) as emp_code, e.NewICNo as actual_nik, e.EmpName as emp_name, e.Gender as gender,
                        RTRIM(e.LocCode) as loc_code, COALESCE(RTRIM(g.GangID), RTRIM(g.Description), CAST(gl.MasterID AS VARCHAR)) as gang_code,
                        COALESCE(RTRIM(g.Description), CAST(gl.MasterID AS VARCHAR)) as gang_desc, COALESCE(p.PayRate, 0) as pay_rate,
                        CASE WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0 ELSE COALESCE(p.RiceRation, 0) END as beras_rate,
                        em.AppJoinGrpDate as join_date, e.ResAddress as res_address, e.HREmpType as hr_emp_type,
                        ROW_NUMBER() OVER(PARTITION BY e.EmpCode ORDER BY e.EmpCode DESC) as rn
                    FROM HR_EMPLOYEE e
                    INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode) AND gl.AccMonth = ? AND gl.AccYear = ?
                    LEFT JOIN PR_GANG g ON g.ID = gl.MasterID
                    LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                    WHERE ${historicalCondition}
                ) t WHERE rn = 1 ORDER BY emp_code
            `;
            const rows = await db.query<any>(sql, [accMonth, accYear]);
            if (rows.length > 0) return this.mapToEmployees(rows);

            // Fallback query (relaxed)
            const fallbackSql = sql.replace("AND gl.AccMonth = ? AND gl.AccYear = ?", "");
            const fallbackRows = await db.query<any>(fallbackSql, []);
            if (fallbackRows.length > 0) return this.mapToEmployees(fallbackRows);

            return this.getEmployeesFallbackLive(gangCondition, serverProfile);
        } catch (e: any) {
            warn(CATEGORY, `Historical query failed, falling back to live: ${e.message}`);
            return this.getEmployeesFallbackLive(gangCondition, serverProfile);
        }
    }

    private async getEmployeesLive(db: Database, gangCondition: string): Promise<Employee[]> {
        const rows = await db.query<any>(`
            SELECT 
                RTRIM(e.EmpCode) as emp_code, ISNULL(NULLIF(RTRIM(e.NewICNo), ''), RTRIM(e.EmpCode)) as actual_nik,
                e.EmpName as emp_name, e.Gender as gender, RTRIM(e.LocCode) as loc_code, RTRIM(gl.GangCode) as gang_code,
                RTRIM(g.Description) as gang_desc, COALESCE(p.PayRate, 0) as pay_rate,
                CASE WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0 ELSE COALESCE(p.RiceRation, 0) END as beras_rate,
                em.AppJoinGrpDate as join_date, e.ResAddress as res_address, e.HREmpType as hr_emp_type
            FROM HR_EMPLOYEE e
            INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
            LEFT JOIN HR_GANG g ON gl.GangCode = g.GangCode
            LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
            LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
            WHERE ${gangCondition} ORDER BY e.EmpCode
        `);
        return this.mapToEmployees(rows);
    }

    public async getEmployeesFallbackLive(gangCondition: string, serverProfile?: string): Promise<Employee[]> {
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;
        const rows = await db.query<any>(`
            SELECT emp_code, actual_nik, emp_name, gender, loc_code, gang_code, gang_desc, pay_rate, beras_rate, join_date, res_address, hr_emp_type
            FROM (
                SELECT 
                    RTRIM(e.EmpCode) as emp_code, ISNULL(NULLIF(RTRIM(e.NewICNo), ''), RTRIM(e.EmpCode)) as actual_nik,
                    e.EmpName as emp_name, e.Gender as gender, RTRIM(e.LocCode) as loc_code, RTRIM(gl.GangCode) as gang_code,
                    RTRIM(g.Description) as gang_desc, COALESCE(p.PayRate, 0) as pay_rate,
                    CASE WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0 ELSE COALESCE(p.RiceRation, 0) END as beras_rate,
                    em.AppJoinGrpDate as join_date, e.ResAddress as res_address, e.HREmpType as hr_emp_type,
                    ROW_NUMBER() OVER(PARTITION BY e.EmpCode ORDER BY e.EmpCode DESC) as rn
                FROM HR_EMPLOYEE e
                INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                LEFT JOIN HR_GANG g ON gl.GangCode = g.GangCode
                LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                WHERE ${gangCondition}
            ) t WHERE rn = 1 ORDER BY emp_code
        `);
        return this.mapToEmployees(rows);
    }

    private mapToEmployees(rows: any[]): Employee[] {
        return rows.map(r => ({
            nik: r.emp_code || "",
            actual_nik: r.actual_nik || r.emp_code || "",
            nama: (r.emp_name || "").trim().toUpperCase(),
            jenis_kelamin: this.mapGender(r.gender),
            loc_code: r.loc_code || "",
            gang_code: r.gang_code || "",
            gang_desc: r.gang_desc || "",
            upah_dasar: r.pay_rate || 0,
            beras_rate: r.beras_rate || 0,
            join_date: r.join_date ? new Date(r.join_date).toISOString().split('T')[0] : null,
            res_address: r.res_address || "",
            employee_type: r.hr_emp_type || ""
        }));
    }

    /**
     * List employees (Enhanced with DivisionConfigService)
     */
    public async list(options: any = {}): Promise<{ employees: Employee[]; dataSource: string }> {
        const { skip = 0, limit = 100, gangCode, division } = options;
        let whereClauses: string[] = ["1=1"];
        let params: any[] = [];

        if (division && division !== 'ALL') {
            const { sql, params: divParams } = divisionConfigService.buildDivisionWhereClause(division, 'g.LocCode');
            whereClauses.push(sql.substring(5)); // Remove leading " AND "
            params.push(...divParams);
        }

        if (gangCode && gangCode !== 'ALL') {
            whereClauses.push("g.GangCode = ?");
            params.push(gangCode);
        }

        const sql = `
            SELECT DISTINCT
                e.EmpCode, e.NewICNo, e.EmpName, e.Gender, e.LocCode, g.GangCode, p.PayRate,
                e.Religion, e.Status, e.HREmpType, CONVERT(VARCHAR, e.DOB, 23) AS birth_date
            FROM HR_EMPLOYEE e
            JOIN HR_GANGLN g ON g.GangMember = e.EmpCode
            LEFT JOIN HR_PAYROLL p ON p.EmpCode = e.EmpCode
            WHERE ${whereClauses.join(" AND ")}
            ORDER BY e.EmpName
        `;

        try {
            const rows = await this.db.query<any>(sql, params);
            const emps = rows.map(r => ({
                nik: r.EmpCode?.trim(), actual_nik: r.NewICNo?.trim() || r.EmpCode?.trim(),
                nama: r.EmpName?.trim(), jenis_kelamin: this.mapGender(r.Gender),
                loc_code: r.LocCode?.trim(), gang_code: r.GangCode?.trim(),
                upah_dasar: r.PayRate || 0, religion: r.Religion?.trim(),
                status: r.Status?.trim(), employee_type: r.HREmpType?.trim(), birth_date: r.birth_date
            }));
            return { employees: emps.slice(skip, skip + limit), dataSource: "origin" };
        } catch (e: any) {
            logError(CATEGORY, `list failed: ${e.message}`);
            return { employees: [], dataSource: "origin" };
        }
    }

    public async getByNik(nik: string): Promise<Employee | null> {
        const rows = await this.db.query<any>(`
            SELECT e.EmpCode, e.EmpName, e.Gender, e.LocCode, g.GangCode, p.PayRate
            FROM HR_EMPLOYEE e LEFT JOIN HR_GANGLN g ON g.GangMember = e.EmpCode
            LEFT JOIN HR_PAYROLL p ON p.EmpCode = e.EmpCode WHERE e.EmpCode = ?
        `, [nik.trim()]);
        if (!rows[0]) return null;
        const r = rows[0];
        return {
            nik: r.EmpCode?.trim(), actual_nik: r.EmpCode?.trim(), nama: r.EmpName?.trim(),
            jenis_kelamin: this.mapGender(r.Gender), loc_code: r.LocCode?.trim(),
            gang_code: r.GangCode?.trim(), upah_dasar: r.PayRate || 0
        };
    }
}

export const employeeRepository = EmployeeRepository.getInstance();
