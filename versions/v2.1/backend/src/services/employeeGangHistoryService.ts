import { Database } from "../db/client";
import { duplicateNikMitigationService, NikResolutionResult, NikEmpCodeMap } from "./DuplicateNikMitigationService";

export interface EmployeeHistoryEntry {
    emp_code: string;
    nik: string;
    emp_name: string;
    gang_code: string;
    division_code: string;
    period_month: number;
    period_year: number;
    join_date?: string;
}

export interface EmployeeGangHistoryWithResolution extends EmployeeHistoryEntry {
    resolution_info?: NikResolutionResult;
    is_duplicate_nik: boolean;
}

export class EmployeeGangHistoryService {
    private static instance: EmployeeGangHistoryService;
    private db: Database;
    private extendDb: Database;

    private constructor() {
        this.db = Database.getInstance();
        this.extendDb = Database.getExtendedInstance();
    }

    public static getInstance(): EmployeeGangHistoryService {
        if (!EmployeeGangHistoryService.instance) {
            EmployeeGangHistoryService.instance = new EmployeeGangHistoryService();
        }
        return EmployeeGangHistoryService.instance;
    }

    /**
     * Get the DuplicateNikMitigationService instance
     * Used for advanced duplicate NIK handling
     */
    public getMitigationService() {
        return duplicateNikMitigationService;
    }

    /**
     * Finds the latest EmpCode for a given NIK (NewICNo) from the live HR system.
     * This is the most reliable way to get the current active code.
     * 
     * Now uses DuplicateNikMitigationService for better handling of duplicate NIKs
     */
    public async getLatestEmpCodeByNik(nik: string): Promise<string | null> {
        try {
            // Use mitigation service for better duplicate handling
            const resolution = await duplicateNikMitigationService.resolveEmpCode(nik);
            return resolution.resolved_emp_code;
        } catch (e) {
            console.error(`[EmployeeGangHistoryService] Error getting latest emp code for ${nik}:`, e);
            return null;
        }
    }

    /**
     * Bulk resolves the latest EmpCodes for a list of NIKs, optionally considering gang assignments.
     * Returns a Map of NIK -> Latest/Correct EmpCode.
     *
     * IMPORTANT: emp_code comes directly from HR_GANGLN.GangMember (authoritative source).
     * NIK is matched via HR_EMPLOYEE. If an employee is in HR_GANGLN, use GangMember as EmpCode.
     * Priority: HR_GANGLN (current gang membership) > HR_EMPLOYEE (fallback for inactive employees).
     * 
     * NOTE: All NIK inputs are trimmed to handle spaces in database
     */
    public async resolveLatestEmpCodes(niks: string[], preferredGangs?: Map<string, string>): Promise<Map<string, string>> {
        if (!niks || niks.length === 0) return new Map();

        // ALWAYS trim NIKs to handle spaces
        const uniqueNiks = [...new Set(niks.map(n => (n || '').trim().toUpperCase()).filter(Boolean))];

        try {
            const resultMap = new Map<string, string>();

            // CHUNK to avoid SQL Server 2100 parameter limit
            const CHUNK_SIZE = 500;
            for (let i = 0; i < uniqueNiks.length; i += CHUNK_SIZE) {
                const chunk = uniqueNiks.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map(() => '?').join(',');

                // EMP_CODE SOURCE: HR_GANGLN.GangMember (authoritative)
                // NIK SOURCE: HR_EMPLOYEE.NewICNo (trimmed for matching)
                //
                // Strategy:
                // 1. Left join HR_GANGLN on GangMember = EmpCode
                // 2. When HR_GANGLN has a match → use GangMember as emp_code (authoritative)
                // 3. Fall back to HR_EMPLOYEE.EmpCode when no HR_GANGLN entry
                //
                // Priority when preferredGangs is provided: GangMember from preferred gang first,
                // then any available GangMember, then HR_EMPLOYEE.EmpCode as last resort.
                // Since HR_GANGLN only has GangCode+GangMember, we order by EmpCode DESC
                // (C-prefix > B-prefix > A-prefix) to approximate "most recent".
                const rows = await this.db.query<{ NewICNo: string; EmpCode: string; Status: string; GangCode: string; fromGangLn: number }>(`
                    SELECT
                        RTRIM(e.NewICNo) as NewICNo,
                        RTRIM(COALESCE(gl.GangMember, e.EmpCode)) as EmpCode,
                        e.Status,
                        RTRIM(gl.GangCode) as GangCode,
                        CASE WHEN gl.GangMember IS NOT NULL THEN 1 ELSE 0 END as fromGangLn
                    FROM HR_EMPLOYEE e
                    LEFT JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                    WHERE RTRIM(e.NewICNo) IN (${placeholders}) OR RTRIM(e.EmpCode) IN (${placeholders})
                    ORDER BY
                        fromGangLn DESC,
                        CASE WHEN RTRIM(e.Status) = '1' THEN 0 ELSE 1 END,
                        e.EmpCode DESC
                `, [...chunk, ...chunk]);

                // First pass: Try to match by Gang if preferredGangs is provided
                // Prefer GangMember from HR_GANGLN over HR_EMPLOYEE.EmpCode
                if (preferredGangs) {
                    rows.forEach(row => {
                        const nikKey = row.NewICNo?.trim().toUpperCase();
                        const prefGang = preferredGangs.get(nikKey);
                        if (nikKey && prefGang && row.GangCode === prefGang && !resultMap.has(nikKey)) {
                            resultMap.set(nikKey, row.EmpCode?.trim() || '');
                        }
                    });
                }

                // Second pass: Fill in remaining with best available
                // Since HR_GANGLN rows are already first (fromGangLn DESC), first match is best
                rows.forEach(row => {
                    const empCodeTrimmed = row.EmpCode?.trim() || '';
                    const nikKey = row.NewICNo?.trim().toUpperCase();
                    if (nikKey && !resultMap.has(nikKey)) {
                        resultMap.set(nikKey, empCodeTrimmed);
                    }
                    const empKey = empCodeTrimmed.toUpperCase();
                    if (empKey && !resultMap.has(empKey)) {
                        resultMap.set(empKey, empCodeTrimmed);
                    }
                });
            }

            return resultMap;
        } catch (e) {
            console.error(`[EmployeeGangHistoryService] Bulk resolve error:`, e);
            return new Map();
        }
    }

    /**
     * Gets the gang history for a specific person (by NIK or EmpCode)
     * from the historical tables.
     * 
     * Enhanced with duplicate NIK handling - will find all records for all EmpCodes
     * associated with the same NIK
     */
    public async getGangHistory(identifier: string): Promise<EmployeeHistoryEntry[]> {
        try {
            // Use mitigation service to handle duplicate NIKs
            const filter = await duplicateNikMitigationService.buildHistoryQueryFilter(identifier);
            
            const rows = await this.extendDb.query<EmployeeHistoryEntry>(`
                SELECT DISTINCT
                    emp_code, nik, emp_name, gang_code, division_code,
                    period_month, period_year, join_date
                FROM dbo.history_gang_member
                WHERE ${filter.where}
                ORDER BY period_year DESC, period_month DESC
            `, filter.params);

            return rows;
        } catch (e) {
            console.error(`[EmployeeGangHistoryService] Error getting gang history for ${identifier}:`, e);
            return [];
        }
    }

    /**
     * Gets the latest known gang and emp_code for an employee from history.
     */
    public async getLatestHistoryRecord(identifier: string): Promise<EmployeeHistoryEntry | null> {
        const history = await this.getGangHistory(identifier);
        return history[0] || null;
    }
    /**
     * Finds all EmpCodes ever used by a person, identified by their NIK (NewICNo).
     * 
     * Enhanced with duplicate NIK mitigation - returns all EmpCodes for all employees
     * sharing the same NIK
     */
    public async getAllEmpCodesByNik(nik: string): Promise<string[]> {
        try {
            // Use mitigation service for comprehensive EmpCode list
            const empCodeMap = await duplicateNikMitigationService.getAllEmpCodesForNik(nik);
            return empCodeMap.emp_codes;
        } catch (e) {
            console.error(`[EmployeeGangHistoryService] Error getting all emp codes for ${nik}:`, e);
            return [];
        }
    }

    /**
     * Gets the current "Official" EmpCode and Gang for a person.
     * Checks HR_EMPLOYMENT for the latest active record.
     * 
     * Enhanced with duplicate NIK handling and resolution info
     */
    public async getCurrentOfficialInfo(nik: string): Promise<{ emp_code: string; gang_code: string; division_code: string } | null> {
        try {
            // Use mitigation service for better resolution
            const resolution = await duplicateNikMitigationService.resolveEmpCode(nik);
            
            if (!resolution.resolved_emp_code) {
                return null;
            }

            const rows = await this.db.query<any>(`
                SELECT TOP 1
                    RTRIM(e.EmpCode) as emp_code,
                    RTRIM(gl.GangCode) as gang_code,
                    RTRIM(e.LocCode) as division_code
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(e.EmpCode) = RTRIM(em.EmpCode)
                LEFT JOIN HR_GANGLN gl ON RTRIM(e.EmpCode) = RTRIM(gl.GangMember)
                WHERE RTRIM(e.EmpCode) = ?
                ORDER BY em.AppJoinDate DESC
            `, [resolution.resolved_emp_code]);

            if (rows.length === 0) return null;
            return {
                emp_code: rows[0].emp_code,
                gang_code: rows[0].gang_code || 'N/A',
                division_code: rows[0].division_code || 'N/A'
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * NEW: Get gang history with resolution info for duplicate NIK handling
     * 
     * Returns history entries with metadata about how the NIK was resolved
     */
    public async getGangHistoryWithResolution(identifier: string): Promise<EmployeeGangHistoryWithResolution[]> {
        try {
            // First, resolve the NIK
            const resolution = await duplicateNikMitigationService.resolveEmpCode(identifier);
            
            // Get all history entries
            const history = await this.getGangHistory(identifier);
            
            // Add resolution info to each entry
            return history.map(entry => ({
                ...entry,
                resolution_info: resolution,
                is_duplicate_nik: resolution.all_emp_codes.length > 1
            }));
        } catch (e) {
            console.error(`[EmployeeGangHistoryService] Error getting gang history with resolution for ${identifier}:`, e);
            return [];
        }
    }

    /**
     * NEW: Check if an identifier has duplicate NIK issues
     */
    public async hasDuplicateNik(identifier: string): Promise<boolean> {
        return await duplicateNikMitigationService.hasDuplicate(identifier);
    }

    /**
     * NEW: Get duplicate NIK report
     */
    public async getDuplicateNikReport() {
        return await duplicateNikMitigationService.generateDuplicateReport();
    }
}

export const employeeGangHistoryService = EmployeeGangHistoryService.getInstance();
