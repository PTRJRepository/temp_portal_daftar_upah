import { Employee } from "../types/employee/Employee";
import { employeeRepository } from "../services/employeeRepository";
import { employeeEstateRepository } from "../repositories/employee/EmployeeEstateRepository";
import { employeeHrDataRepository } from "../repositories/employee/EmployeeHrDataRepository";
import { Database } from "../db/client";

export class EmployeeService {
    private static instance: EmployeeService;

    private constructor() {}

    public static getInstance(): EmployeeService {
        if (!EmployeeService.instance) {
            EmployeeService.instance = new EmployeeService();
        }
        return EmployeeService.instance;
    }

    /**
     * Get unified employee details from all sources
     */
    public async getEmployeeDetails(empCode: string, month?: number, year?: number): Promise<Employee | null> {
        const [base, estate, hr] = await Promise.all([
            employeeRepository.getByNik(empCode),
            employeeEstateRepository.getEmployeeJobsWithNik([empCode]),
            employeeHrDataRepository.getHrData(empCode)
        ]);

        if (!base) return null;

        return {
            ...base,
            jabatan: base.jabatan || estate.empcodeMap[empCode] || estate.nikMap[base.actual_nik] || "",
            actual_nik: hr?.nik_ktp || hr?.new_nik || base.actual_nik,
            npwp: hr?.npwp,
            bank_acc_no: hr?.bank_acc_no,
            bank_code: hr?.bank_code
        };
    }

    /**
     * Legacy support for employeeGangHistoryService functionality
     */
    public async resolveLatestEmpCodes(niks: string[], preferredGangMap?: Map<string, string>): Promise<Map<string, string>> {
        if (!niks.length) return new Map();
        const db = Database.getInstance();
        const results = new Map<string, string>();
        
        // Basic resolution from HR_EMPLOYEE (nik is NewICNo, return current EmpCode)
        const CHUNK = 500;
        for (let i = 0; i < niks.length; i += CHUNK) {
            const chunk = niks.slice(i, i + CHUNK);
            const rows = await db.query<{ NewICNo: string; EmpCode: string }>(
                `SELECT RTRIM(NewICNo) as NewICNo, RTRIM(EmpCode) as EmpCode FROM HR_EMPLOYEE WHERE RTRIM(NewICNo) IN (${chunk.map(() => '?').join(',')})`,
                chunk
            );
            for (const r of rows) {
                results.set(r.NewICNo.trim().toUpperCase(), r.EmpCode.trim());
            }
        }
        return results;
    }
}

export const employeeService = EmployeeService.getInstance();
