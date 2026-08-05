/**
 * Employee Comparison Service
 *
 * Provides comparison between:
 * 1. EmpCode from Career Progress method (latest NIK → latest EmpCode from HR_EMPLOYEE)
 * 2. EmpCode from Gang method (from HR_GANGLN based on gang)
 */

import { Database } from "../../db/client";

export interface EmployeeComparisonRow {
    nik: string;
    career_emp_code: string;
    career_emp_name: string;
    gang_emp_code: string;
    gang_emp_name: string;
    gang_code: string;
    is_match: boolean;
    notes: string;
}

export interface EmployeeComparisonResult {
    division: string;
    gang?: string;
    month: number;
    year: number;
    total_employees: number;
    mismatch_count: number;
    data: EmployeeComparisonRow[];
}

export class EmployeeComparisonService {
    private static instance: EmployeeComparisonService;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): EmployeeComparisonService {
        if (!EmployeeComparisonService.instance) {
            EmployeeComparisonService.instance = new EmployeeComparisonService();
        }
        return EmployeeComparisonService.instance;
    }

    public async compareEmployees(
        division: string,
        gang?: string,
        month?: number,
        year?: number
    ): Promise<EmployeeComparisonResult> {
        const useMonth = month || new Date().getMonth() + 1;
        const useYear = year || new Date().getFullYear();

        // Get employees from HR_GANGLN
        let condition = "WHERE 1=1";
        const params: any[] = [];

        if (division && division !== 'ALL') {
            condition += " AND RTRIM(e.LocCode) = ?";
            params.push(division);
        }
        if (gang && gang !== 'ALL') {
            condition += " AND RTRIM(gl.GangCode) = ?";
            params.push(gang);
        }

        const gangEmployees = await this.db.query(`
            SELECT
                RTRIM(e.NewICNo) as nik,
                RTRIM(e.EmpCode) as emp_code,
                e.EmpName as emp_name,
                RTRIM(gl.GangCode) as gang_code
            FROM HR_EMPLOYEE e
            INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
            ${condition}
        `, params);

        const results: EmployeeComparisonRow[] = [];

        // For each employee, find the career progress EmpCode
        for (const emp of gangEmployees) {
            // Get latest EmpCode for this NIK
            const careerRows = await this.db.query(`
                SELECT TOP 1 RTRIM(EmpCode) as EmpCode, EmpName
                FROM HR_EMPLOYEE
                WHERE RTRIM(NewICNo) = ? OR RTRIM(EmpCode) = ?
                ORDER BY EmpCode DESC
            `, [emp.nik, emp.nik]);

            const careerRow = careerRows[0];

            // Check for duplicates
            const dupRows = await this.db.query(`
                SELECT RTRIM(EmpCode) as EmpCode
                FROM HR_EMPLOYEE
                WHERE RTRIM(NewICNo) = ?
            `, [emp.nik]);

            const isMatch = careerRow?.EmpCode === emp.emp_code;
            let notes = '';

            if (dupRows.length > 1) {
                notes = `WARNING: ${dupRows.length} employees with same NIK`;
                if (!isMatch) {
                    notes += `. Career: ${careerRow?.EmpCode}, Gang: ${emp.emp_code}`;
                }
            } else {
                notes = 'OK';
            }

            results.push({
                nik: emp.nik,
                career_emp_code: careerRow?.EmpCode || '',
                career_emp_name: careerRow?.EmpName || '',
                gang_emp_code: emp.emp_code,
                gang_emp_name: emp.emp_name,
                gang_code: emp.gang_code,
                is_match: isMatch,
                notes,
            });
        }

        const mismatches = results.filter(r => !r.is_match);

        return {
            division,
            gang,
            month: useMonth,
            year: useYear,
            total_employees: results.length,
            mismatch_count: mismatches.length,
            data: results,
        };
    }

    public async findDuplicateNik(): Promise<{
        nik: string;
        employee_count: number;
        employees: {
            emp_code: string;
            emp_name: string;
            gang_code: string;
            division_code: string;
        }[];
    }[]> {
        const duplicateNiks = await this.db.query(`
            SELECT RTRIM(NewICNo) as nik, COUNT(*) as cnt
            FROM HR_EMPLOYEE
            WHERE NewICNo IS NOT NULL AND RTRIM(NewICNo) != ''
            GROUP BY RTRIM(NewICNo)
            HAVING COUNT(*) > 1
        `);

        const results = [];

        for (const dup of duplicateNiks) {
            const employees = await this.db.query(`
                SELECT
                    RTRIM(e.EmpCode) as emp_code,
                    e.EmpName as emp_name,
                    RTRIM(gl.GangCode) as gang_code,
                    RTRIM(e.LocCode) as division_code
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                WHERE RTRIM(e.NewICNo) = ?
            `, [dup.nik]);

            results.push({
                nik: dup.nik,
                employee_count: dup.cnt,
                employees: employees.map(e => ({
                    emp_code: e.emp_code,
                    emp_name: e.emp_name,
                    gang_code: e.gang_code || '',
                    division_code: e.division_code || '',
                })),
            });
        }

        return results;
    }
}

export const employeeComparisonService = EmployeeComparisonService.getInstance();
