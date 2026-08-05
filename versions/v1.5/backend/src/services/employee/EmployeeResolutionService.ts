/**
 * Employee Resolution Service
 *
 * Centralized service for resolving employee identities across the system.
 * Provides:
 * - NIK to EmpCode resolution
 * - Employee data enrichment
 * - Batch resolution for performance
 *
 * This service wraps EmployeeGangHistoryService to provide a cleaner interface
 * and ensure consistent resolution logic across all services.
 */

import { employeeGangHistoryService } from '../employeeGangHistoryService';
import { Database } from "../../db/client";

/**
 * Input for employee resolution
 */
export interface EmployeeResolutionInput {
    nik: string;
    preferredGangCode?: string;
    periodMonth?: number;
    periodYear?: number;
}

/**
 * Result of employee resolution
 */
export interface EmployeeResolutionResult {
    originalNik: string;
    latestEmpCode: string;
    empName: string;
    currentGangCode: string;
    currentDivisionCode: string;
    effectiveDate: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Employee Resolution Service
 * Provides single source of truth for employee identity resolution
 */
export class EmployeeResolutionService {
    private static instance: EmployeeResolutionService;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): EmployeeResolutionService {
        if (!EmployeeResolutionService.instance) {
            EmployeeResolutionService.instance = new EmployeeResolutionService();
        }
        return EmployeeResolutionService.instance;
    }

    /**
     * Resolve a single NIK to latest EmpCode with gang preference
     *
     * @param input - Resolution input
     * @returns Resolution result with confidence level
     */
    public async resolve(input: EmployeeResolutionInput): Promise<EmployeeResolutionResult> {
        const { nik: rawNik, preferredGangCode: rawGang } = input;

        // ALWAYS trim to handle spaces in input identifiers
        const nik = (rawNik || '').trim();
        const preferredGangCode = (rawGang || '').trim() || undefined;

        try {
            // Use EmployeeGangHistoryService for resolution
            const preferredGangs = preferredGangCode
                ? new Map([[nik.toUpperCase(), preferredGangCode]])
                : undefined;

            const result = await employeeGangHistoryService.resolveLatestEmpCodes([nik], preferredGangs);
            const empCode = result.get(nik.toUpperCase());

            if (!empCode) {
                return {
                    originalNik: nik,
                    latestEmpCode: nik, // Fallback to NIK
                    empName: '',
                    currentGangCode: '',
                    currentDivisionCode: '',
                    effectiveDate: '',
                    confidence: 'LOW',
                };
            }

            // Get additional employee details
            const empDetails = await this.getEmployeeDetails(empCode);

            return {
                originalNik: nik,
                latestEmpCode: empCode,
                empName: empDetails.name,
                currentGangCode: empDetails.gangCode,
                currentDivisionCode: empDetails.divisionCode,
                effectiveDate: empDetails.joinDate,
                confidence: empDetails.found ? 'HIGH' : 'MEDIUM',
            };
        } catch (error) {
            console.error(`[EmployeeResolutionService] Error resolving '${rawNik}':`, error);
            return {
                originalNik: nik,
                latestEmpCode: nik,
                empName: '',
                currentGangCode: '',
                currentDivisionCode: '',
                effectiveDate: '',
                confidence: 'LOW',
            };
        }
    }

    /**
     * Batch resolve multiple NIKs for performance
     *
     * @param niks - Array of NIKs to resolve
     * @param preferredGangs - Optional map of NIK -> preferred gang code
     * @returns Map of NIK -> EmpCode
     */
    public async resolveBatch(
        niks: string[],
        preferredGangs?: Map<string, string>
    ): Promise<Map<string, string>> {
        if (!niks || niks.length === 0) {
            return new Map();
        }

        // Always trim all NIKs to handle spaces in input
        const trimmedNiks = niks.map(n => (n || '').trim()).filter(n => n.length > 0);

        // Also trim preferredGangs keys
        let trimmedPreferredGangs: Map<string, string> | undefined;
        if (preferredGangs) {
            trimmedPreferredGangs = new Map();
            preferredGangs.forEach((value, key) => {
                trimmedPreferredGangs!.set((key || '').trim().toUpperCase(), (value || '').trim());
            });
        }

        try {
            return await employeeGangHistoryService.resolveLatestEmpCodes(trimmedNiks, trimmedPreferredGangs);
        } catch (error) {
            console.error('[EmployeeResolutionService] Error in batch resolution:', error);
            // Return input as fallback
            const fallback = new Map<string, string>();
            trimmedNiks.forEach(nik => fallback.set(nik.toUpperCase(), nik));
            return fallback;
        }
    }

    /**
     * Get employee details by EmpCode
     */
    private async getEmployeeDetails(empCode: string): Promise<{
        found: boolean;
        name: string;
        gangCode: string;
        divisionCode: string;
        joinDate: string;
    }> {
        try {
            const rows = await this.db.query<{
                EmpName: string;
                NewICNo: string;
                GangCode: string;
                LocCode: string;
                AppJoinDate: string;
            }>(`
                SELECT TOP 1
                    e.EmpName,
                    e.NewICNo,
                    RTRIM(gl.GangCode) as GangCode,
                    RTRIM(gl.LocCode) as LocCode,
                    em.AppJoinDate
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_EMPLOYMENT em ON e.EmpCode = em.EmpCode
                LEFT JOIN HR_GANGLN gl ON e.EmpCode = gl.GangMember AND gl.Status = '1'
                WHERE RTRIM(e.EmpCode) = ?
                ORDER BY gl.JoinDate DESC
            `, [empCode.trim()]);

            const row = rows[0];
            if (!row) {
                return { found: false, name: '', gangCode: '', divisionCode: '', joinDate: '' };
            }

            return {
                found: true,
                name: row.EmpName?.trim() || '',
                gangCode: row.GangCode || '',
                divisionCode: row.LocCode || '',
                joinDate: row.AppJoinDate || '',
            };
        } catch (error) {
            console.error(`[EmployeeResolutionService] Error getting details for ${empCode}:`, error);
            return { found: false, name: '', gangCode: '', divisionCode: '', joinDate: '' };
        }
    }

    /**
     * Check if an employee code exists in the system
     */
    public async employeeExists(empCode: string): Promise<boolean> {
        try {
            const rows = await this.db.query<{ cnt: number }>(`
                SELECT COUNT(*) as cnt FROM HR_EMPLOYEE WHERE RTRIM(EmpCode) = ?
            `, [empCode.trim()]);
            return (rows[0]?.cnt || 0) > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get employee by NIK
     * 
     * IMPORTANT: Prioritizes EmpCode DESC first to get latest empcode (C-prefix > B-prefix > A-prefix)
     */
    public async getEmployeeByNik(rawNik: string): Promise<{
        empCode: string;
        empName: string;
        status: string;
    } | null> {
        const nik = (rawNik || '').trim();
        try {
            const rows = await this.db.query<{
                EmpCode: string;
                EmpName: string;
                Status: string;
            }>(`
                SELECT TOP 1
                    RTRIM(e.EmpCode) as EmpCode,
                    e.EmpName,
                    e.Status
                FROM HR_EMPLOYEE e
                WHERE RTRIM(e.NewICNo) = ? OR RTRIM(e.EmpCode) = ?
                ORDER BY e.EmpCode DESC, e.Status DESC
            `, [nik, nik]);

            const row = rows[0];
            if (!row) return null;

            return {
                empCode: row.EmpCode,
                empName: row.EmpName?.trim() || '',
                status: row.Status,
            };
        } catch (error) {
            console.error(`[EmployeeResolutionService] Error getting employee by NIK '${rawNik}':`, error);
            return null;
        }
    }
}

// Export singleton instance
export const employeeResolutionService = EmployeeResolutionService.getInstance();
