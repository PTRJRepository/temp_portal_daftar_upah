/**
 * EmployeeExtractor - Extract Employee Master Data
 *
 * Extracts employee data from HR_EMPLOYEE, HR_GANGLN, HR_GANG, HR_PAYROLL tables.
 *
 * Data extracted:
 * - Employee identity: emp_code, emp_name, gender, actual_nik
 * - Location: loc_code, gang_code, gang_desc
 * - Compensation: pay_rate, beras_rate
 * - Employment: join_date, res_address, hr_emp_type
 *
 * Source tables:
 * - HR_EMPLOYEE (employee master)
 * - HR_GANGLN / PR_GANGLN_ARC (gang membership)
 * - HR_GANG / PR_GANG (gang definitions)
 * - HR_PAYROLL (pay rate, beras rate)
 * - HR_EMPLOYMENT (join date)
 * - HR_EMPLOYEE_HR_DATA (NIK KTP override via employeeHrDataService)
 *
 * JOIN: HR_GANGLN → HR_GANG, HR_PAYROLL, HR_EMPLOYMENT
 *
 * Special handling:
 * - Historical mode uses PR_GANGLN_ARC with AccMonth/AccYear filtering
 * - ARC fallback when HR_GANGLN returns no data for current period
 * - NIK resolution via employeeHrDataService (NIK KTP override)
 * - Virtual division resolution via divisionDefinition
 *
 * @module payroll/extractors/EmployeeExtractor
 */

import { Database } from '../../../db/client';
import { employeeHrDataService } from '../../employeeHrDataService';
import { divisionDefinition } from '../../divisionDefinition';
import { currentPeriodService } from '../../currentPeriodService';

/**
 * EmployeeRow - Employee data extracted from HR systems
 */
export interface EmployeeRow {
    emp_code: string;
    actual_nik: string;
    emp_name: string;
    gender: string;
    loc_code: string;
    gang_code: string;
    gang_desc: string;
    pay_rate: number;
    beras_rate: number;
    join_date: string | null;
    res_address: string;
    alamat: string;
    hr_emp_type: string;
    pajak_npwp?: string;
}

/**
 * Query result row type from database
 */
interface EmployeeQueryRow {
    emp_code: string;
    actual_nik: string;
    emp_name: string;
    gender: string;
    loc_code: string;
    gang_code: string;
    gang_desc: string;
    pay_rate: number;
    beras_rate: number;
    join_date: string | null;
    res_address: string;
    alamat: string;
    hr_emp_type: string;
}

export class EmployeeExtractor {
    private db: Database;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
    }

    /**
     * Extract employee data for a gang condition
     *
     * Fetches employees from HR_EMPLOYEE + HR_GANGLN with full join path.
     * Handles both current period (HR_GANGLN) and historical (PR_GANGLN_ARC).
     *
     * @param gangCondition - SQL WHERE clause for gang filtering
     * @param month - Period month
     * @param year - Period year
     * @param serverProfile - Optional DB profile override
     * @param isHistorical - Use historical ARC tables
     * @param gangCodeInput - Specific gang code if provided
     * @returns Array of EmployeeRow
     */
    async extract(
        gangCondition: string,
        month: number,
        year: number,
        serverProfile?: string,
        isHistorical: boolean = false,
        gangCodeInput: string | null = null
    ): Promise<EmployeeRow[]> {
        const db = serverProfile
            ? Database.getInstance(undefined, serverProfile)
            : this.db;

        let rows: EmployeeQueryRow[];

        if (isHistorical) {
            // Historical mode: use PR_GANGLN_ARC with AccMonth/AccYear filtering
            const { accMonth, accYear } = currentPeriodService.calendarToAccMonth(month, year);

            let historicalCondition = gangCondition;
            if (gangCodeInput) {
                // Override with specific gang code
                historicalCondition = `(UPPER(RTRIM(g.GangID)) = '${gangCodeInput}' OR UPPER(RTRIM(g.Description)) = '${gangCodeInput}')`;
            } else {
                // Convert GangCode reference to GangID for historical tables
                historicalCondition = gangCondition.replace(/g\.GangCode/ig, 'g.GangID');
            }

            rows = await db.query<EmployeeQueryRow>(`
                SELECT DISTINCT
                    RTRIM(e.EmpCode) as emp_code,
                    e.NewICNo as actual_nik,
                    e.EmpName as emp_name,
                    e.Gender as gender,
                    RTRIM(e.LocCode) as loc_code,
                    COALESCE(RTRIM(g.GangID), RTRIM(g.Description)) as gang_code,
                    RTRIM(g.Description) as gang_desc,
                    COALESCE(p.PayRate, 0) as pay_rate,
                    CASE 
                        WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                        ELSE COALESCE(p.RiceRation, 0)
                    END as beras_rate,
                    em.AppJoinGrpDate as join_date,
                    e.ResAddress as res_address,
                    e.HREmpType as hr_emp_type
                FROM HR_EMPLOYEE e
                INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode)
                    AND gl.AccMonth = ?
                    AND gl.AccYear = ?
                INNER JOIN PR_GANG g ON g.ID = gl.MasterID
                LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                WHERE ${historicalCondition}
                ORDER BY emp_code
            `, [accMonth, accYear]);
        } else {
            // Current mode: use HR_GANGLN (active data)
            rows = await db.query<EmployeeQueryRow>(`
                SELECT DISTINCT
                    RTRIM(e.EmpCode) as emp_code,
                    e.NewICNo as actual_nik,
                    e.EmpName as emp_name,
                    e.Gender as gender,
                    RTRIM(e.LocCode) as loc_code,
                    RTRIM(gl.GangCode) as gang_code,
                    RTRIM(g.Description) as gang_desc,
                    COALESCE(p.PayRate, 0) as pay_rate,
                    CASE 
                        WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                        ELSE COALESCE(p.RiceRation, 0)
                    END as beras_rate,
                    em.AppJoinGrpDate as join_date,
                    e.ResAddress as res_address,
                    e.HREmpType as hr_emp_type
                FROM HR_EMPLOYEE e
                INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                INNER JOIN HR_GANG g ON RTRIM(g.GangCode) = RTRIM(gl.GangCode)
                LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                WHERE ${gangCondition}
                ORDER BY emp_code
            `);

            // [FALLBACK] If no data in base table, try ARC table
            if (rows.length === 0) {
                const { accMonth: fallbackAccMonth, accYear: fallbackAccYear } = currentPeriodService.calendarToAccMonth(month, year);

                let arcCondition = gangCondition;
                if (gangCodeInput && gangCodeInput !== 'ALL') {
                    // Only apply specific gang filter if not querying 'ALL'
                    arcCondition = `(UPPER(RTRIM(g.GangID)) = '${gangCodeInput}' OR UPPER(RTRIM(g.Description)) = '${gangCodeInput}')`;
                }

                rows = await db.query<EmployeeQueryRow>(`
                    SELECT DISTINCT
                        RTRIM(e.EmpCode) as emp_code,
                        e.NewICNo as actual_nik,
                        e.EmpName as emp_name,
                        e.Gender as gender,
                        RTRIM(e.LocCode) as loc_code,
                        COALESCE(RTRIM(g.GangID), RTRIM(g.Description)) as gang_code,
                        RTRIM(g.Description) as gang_desc,
                        COALESCE(p.PayRate, 0) as pay_rate,
                        CASE 
                            WHEN UPPER(CAST(p.RiceRationCode AS VARCHAR)) = 'BERASBHL' THEN 0
                            ELSE COALESCE(p.RiceRation, 0)
                        END as beras_rate,
                        em.AppJoinGrpDate as join_date,
                        e.ResAddress as res_address,
                        e.HREmpType as hr_emp_type
                    FROM HR_EMPLOYEE e
                    INNER JOIN PR_GANGLN_ARC gl ON RTRIM(gl.EmpCode) = RTRIM(e.EmpCode)
                        AND gl.AccMonth = ?
                        AND gl.AccYear = ?
                    INNER JOIN PR_GANG g ON g.ID = gl.MasterID
                    LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                    LEFT JOIN HR_EMPLOYMENT em ON RTRIM(em.EmpCode) = RTRIM(e.EmpCode)
                    WHERE ${arcCondition}
                    ORDER BY emp_code
                `, [fallbackAccMonth, fallbackAccYear]);

                if (rows.length === 0) {
                    console.log(`[EmployeeExtractor] ARC Fallback: no data found for ${month}/${year}`);
                }
            }
        }

        // Fetch HR data overrides (e.g. NIK KTP)
        const empCodes = rows.map(r => r.emp_code?.trim()).filter(Boolean);
        const hrDataMap = await employeeHrDataService.getHrDataBulk(empCodes);

        // Map to final EmployeeRow with overrides applied
        return rows.map(r => {
            const rawGangCode = r.gang_code?.trim() || "";
            const rawLocCode = r.loc_code?.trim() || "";
            const rawDesc = r.gang_desc?.trim() || "";

            // Resolve display LocCode (checks for virtual divisions like NRS, INF, etc.)
            const resolvedLocCode = divisionDefinition.getVirtualDivisionForGang(rawGangCode, rawLocCode, rawDesc) || rawLocCode;

            const empCodeClean = r.emp_code?.trim().toUpperCase() || "";
            const hrOverride = hrDataMap.get(empCodeClean);

            // Apply NIK override if available (NIK KTP from HR_EMPLOYEE_HR_DATA)
            const finalNik = hrOverride?.nik_ktp?.trim() || r.actual_nik?.trim() || r.emp_code?.trim() || "";
            const finalNpwp = hrOverride?.npwp?.trim() || "";

            return {
                emp_code: r.emp_code?.trim() || "",
                actual_nik: finalNik,
                pajak_npwp: finalNpwp,
                emp_name: r.emp_name?.trim() || "",
                gender: String(r.gender || "1"),
                loc_code: resolvedLocCode,
                gang_code: rawGangCode,
                gang_desc: r.gang_desc?.trim() || "",
                pay_rate: r.pay_rate || 0,
                beras_rate: r.beras_rate || 0,
                join_date: r.join_date || null,
                res_address: r.res_address?.trim() || "",
                alamat: r.res_address?.trim() || "",
                hr_emp_type: r.hr_emp_type?.trim() || ""
            };
        });
    }
}

// Singleton instance
let instance: EmployeeExtractor | null = null;

export function getEmployeeExtractor(): EmployeeExtractor {
    if (!instance) {
        instance = new EmployeeExtractor();
    }
    return instance;
}
