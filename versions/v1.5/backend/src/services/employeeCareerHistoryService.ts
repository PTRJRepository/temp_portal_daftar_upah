/**
 * Employee Career History Service
 * 
 * Tracks employee career progression including:
 * - Gang changes (perpindahan gang)
 * - Division transfers
 * - Position changes
 * - Employment status changes
 * 
 * Uses NIK (NewICNo) or employee name to track history across multiple EmpCode assignments
 */

import { Database } from "../db/client";
import { Config } from "../config";

export interface CareerHistoryEntry {
    period_month: number;
    period_year: number;
    emp_code: string;
    nik: string;
    emp_name: string;
    gang_code: string;
    gang_description?: string;
    division_code: string;
    loc_code?: string;
    position?: string;
    status?: string;
    employee_type?: string;
    religion?: string;
    join_date?: string;
    upah_dasar?: number;
    total_hk?: number;
    source_table: 'history_hr_employee' | 'history_gang_member' | 'HR_EMPLOYEE' | 'HR_GANGLN';
    is_current: boolean;
}

export interface GangChangeEntry {
    from_gang_code: string;
    from_division_code: string;
    to_gang_code: string;
    to_division_code: string;
    change_month: number;
    change_year: number;
    emp_code: string;
    nik: string;
    emp_name: string;
}

export interface CareerSummary {
    nik: string;
    emp_name: string;
    current_emp_code: string;
    current_gang_code: string;
    current_division_code: string;
    total_divisions: number;
    total_gangs: number;
    first_join_date?: string;
    total_service_years: number;
    career_timeline: CareerHistoryEntry[];
    gang_changes: GangChangeEntry[];
}

export class EmployeeCareerHistoryService {
    private static instance: EmployeeCareerHistoryService;
    private liveDb: Database;
    private historyDb: Database;

    private constructor() {
        this.liveDb = Database.getInstance();
        this.historyDb = Database.getExtendedInstance();
    }

    public static getInstance(): EmployeeCareerHistoryService {
        if (!EmployeeCareerHistoryService.instance) {
            EmployeeCareerHistoryService.instance = new EmployeeCareerHistoryService();
        }
        return EmployeeCareerHistoryService.instance;
    }

    /**
     * Resolve NIK to all associated EmpCodes (current and historical)
     */
    async resolveEmpCodesByIdentifier(identifier: string): Promise<{
        nik: string;
        emp_name: string;
        emp_codes: string[];
        is_current_active: boolean;
    }> {
        const trimmedId = identifier.trim();
        const isNik = /^\d{10,}$/.test(trimmedId);

        // First, try to find in live HR_EMPLOYEE
        if (isNik) {
            const liveRows = await this.liveDb.query(`
                SELECT RTRIM(EmpCode) as EmpCode, RTRIM(EmpName) as EmpName, RTRIM(NewICNo) as NewICNo
                FROM HR_EMPLOYEE
                WHERE RTRIM(NewICNo) = ? OR RTRIM(EmpCode) = ?
                ORDER BY EmpCode
            `, [trimmedId, trimmedId]);

            if (liveRows.length > 0) {
                const nik = liveRows[0].NewICNo?.trim() || trimmedId;
                const empCodes = [...new Set(liveRows.map(r => r.EmpCode))];
                return {
                    nik,
                    emp_name: liveRows[0].EmpName?.trim() || '',
                    emp_codes: empCodes,
                    is_current_active: true
                };
            }
        } else {
            // Identifier is EmpCode
            const liveRows = await this.liveDb.query(`
                SELECT RTRIM(EmpCode) as EmpCode, RTRIM(EmpName) as EmpName, RTRIM(NewICNo) as NewICNo
                FROM HR_EMPLOYEE
                WHERE RTRIM(EmpCode) = ?
            `, [trimmedId]);

            if (liveRows.length > 0) {
                return {
                    nik: liveRows[0].NewICNo?.trim() || '',
                    emp_name: liveRows[0].EmpName?.trim() || '',
                    emp_codes: [trimmedId],
                    is_current_active: true
                };
            }
        }

        // Fallback to history tables
        const historyRows = await this.historyDb.query(`
            SELECT nik, emp_name, emp_code
            FROM (
                SELECT DISTINCT RTRIM(nik) as nik, RTRIM(emp_name) as emp_name, RTRIM(emp_code) as emp_code
                FROM history_hr_employee
                WHERE nik = ? OR emp_code = ?
            ) AS subq
            ORDER BY emp_code
        `, [trimmedId, trimmedId]);

        if (historyRows.length > 0) {
            const nik = historyRows[0].nik?.trim() || trimmedId;
            const empCodes = [...new Set(historyRows.map(r => r.emp_code))];
            return {
                nik,
                emp_name: historyRows[0].emp_name?.trim() || '',
                emp_codes: empCodes,
                is_current_active: false
            };
        }

        return {
            nik: trimmedId,
            emp_name: '',
            emp_codes: [],
            is_current_active: false
        };
    }

    /**
     * Get complete career history for an employee by NIK or EmpCode
     */
    async getCareerHistory(identifier: string, options?: {
        fromYear?: number;
        toYear?: number;
        includeCurrent?: boolean;
    }): Promise<CareerHistoryEntry[]> {
        const { fromYear, toYear, includeCurrent = true } = options || {};
        const resolved = await this.resolveEmpCodesByIdentifier(identifier);

        if (resolved.emp_codes.length === 0) {
            return [];
        }

        const history: CareerHistoryEntry[] = [];

        // Fetch from history_hr_employee
        let historyQuery = `
            SELECT DISTINCT
                period_month, period_year, emp_code, nik, emp_name,
                gang_code, division_code, loc_code, position, status, employee_type,
                religion, join_date, upah_dasar, total_hk,
                'history_hr_employee' as source_table
            FROM history_hr_employee
            WHERE nik = ?
        `;
        const params: any[] = [resolved.nik];

        if (fromYear) {
            historyQuery += ` AND period_year >= ?`;
            params.push(fromYear);
        }
        if (toYear) {
            historyQuery += ` AND period_year <= ?`;
            params.push(toYear);
        }

        historyQuery += ` ORDER BY period_year DESC, period_month DESC`;

        const historyRows = await this.historyDb.query<any>(historyQuery, params);

        historyRows.forEach((row: any) => {
            history.push({
                period_month: row.period_month,
                period_year: row.period_year,
                emp_code: row.emp_code?.trim() || '',
                nik: row.nik?.trim() || '',
                emp_name: row.emp_name?.trim() || '',
                gang_code: row.gang_code?.trim() || '',
                division_code: row.division_code?.trim() || '',
                loc_code: row.loc_code?.trim() || '',
                position: row.position?.trim() || '',
                status: row.status?.trim() || '',
                employee_type: row.employee_type?.trim() || '',
                religion: row.religion?.trim() || '',
                join_date: row.join_date,
                upah_dasar: row.upah_dasar,
                total_hk: row.total_hk,
                source_table: 'history_hr_employee',
                is_current: false
            });
        });

        // Fetch current data from live tables if requested
        if (includeCurrent && resolved.is_current_active) {
            const currentRows = await this.liveDb.query(`
                SELECT
                    RTRIM(e.EmpCode) as emp_code,
                    RTRIM(e.NewICNo) as nik,
                    RTRIM(e.EmpName) as emp_name,
                    RTRIM(g.GangCode) as gang_code,
                    RTRIM(e.LocCode) as loc_code,
                    RTRIM(em.DeptCode) as division_code,
                    RTRIM(em.PosCode) as position,
                    RTRIM(e.Status) as status,
                    RTRIM(e.HREmpType) as employee_type,
                    RTRIM(e.Religion) as religion,
                    em.AppJoinDate as join_date,
                    p.PayRate as upah_dasar
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_EMPLOYMENT em ON e.EmpCode = em.EmpCode
                LEFT JOIN HR_GANGLN g ON g.GangMember = e.EmpCode
                LEFT JOIN HR_PAYROLL p ON p.EmpCode = e.EmpCode
                WHERE e.EmpCode IN (${resolved.emp_codes.map(() => '?').join(',')})
                ORDER BY e.EmpCode
            `, resolved.emp_codes);

            // Get current period
            const { currentPeriodService } = await import('./currentPeriodService');
            const currentPeriod = await currentPeriodService.getCurrentPeriod();

            currentRows.forEach((row: any) => {
                // Check if we already have this period in history
                const exists = history.some(h =>
                    h.period_month === currentPeriod.month &&
                    h.period_year === currentPeriod.year &&
                    h.emp_code === row.emp_code
                );

                if (!exists) {
                    history.push({
                        period_month: currentPeriod.month,
                        period_year: currentPeriod.year,
                        emp_code: row.emp_code?.trim() || '',
                        nik: row.nik?.trim() || '',
                        emp_name: row.emp_name?.trim() || '',
                        gang_code: row.gang_code?.trim() || '',
                        division_code: row.division_code?.trim() || row.loc_code?.trim() || '',
                        loc_code: row.loc_code?.trim() || '',
                        position: row.position?.trim() || '',
                        status: row.status?.trim() || '',
                        employee_type: row.employee_type?.trim() || '',
                        religion: row.religion?.trim() || '',
                        join_date: row.join_date,
                        upah_dasar: row.upah_dasar,
                        total_hk: undefined,
                        source_table: 'HR_EMPLOYEE',
                        is_current: true
                    });
                }
            });
        }

        // Sort by period (newest first)
        return history.sort((a, b) => {
            if (b.period_year !== a.period_year) return b.period_year - a.period_year;
            return b.period_month - a.period_month;
        });
    }

    /**
     * Detect gang changes (perpindahan gang) from career history
     */
    async getGangChanges(identifier: string): Promise<GangChangeEntry[]> {
        const history = await this.getCareerHistory(identifier);
        const changes: GangChangeEntry[] = [];

        // Group by period and detect changes
        const sortedHistory = history.sort((a, b) => {
            if (a.period_year !== b.period_year) return a.period_year - b.period_year;
            return a.period_month - b.period_month;
        });

        let previousGang: { gang_code: string; division_code: string; emp_code: string } | null = null;

        for (const entry of sortedHistory) {
            if (previousGang) {
                const gangChanged = entry.gang_code !== previousGang.gang_code;
                const divisionChanged = entry.division_code !== previousGang.division_code;

                if (gangChanged || divisionChanged) {
                    changes.push({
                        from_gang_code: previousGang.gang_code,
                        from_division_code: previousGang.division_code,
                        to_gang_code: entry.gang_code,
                        to_division_code: entry.division_code,
                        change_month: entry.period_month,
                        change_year: entry.period_year,
                        emp_code: entry.emp_code,
                        nik: entry.nik,
                        emp_name: entry.emp_name
                    });
                }
            }

            previousGang = {
                gang_code: entry.gang_code,
                division_code: entry.division_code,
                emp_code: entry.emp_code
            };
        }

        return changes;
    }

    /**
     * Get career summary with timeline and statistics
     */
    async getCareerSummary(identifier: string): Promise<CareerSummary | null> {
        const resolved = await this.resolveEmpCodesByIdentifier(identifier);

        if (resolved.emp_codes.length === 0) {
            return null;
        }

        const history = await this.getCareerHistory(identifier, { includeCurrent: true });
        const gangChanges = await this.getGangChanges(identifier);

        if (history.length === 0) {
            return null;
        }

        // Calculate statistics
        const uniqueDivisions = [...new Set(history.map(h => h.division_code).filter(Boolean))];
        const uniqueGangs = [...new Set(history.map(h => h.gang_code).filter(Boolean))];

        // Find first join date
        const entriesWithJoinDate = history.filter(h => h.join_date);
        const firstJoinDate = entriesWithJoinDate.length > 0
            ? entriesWithJoinDate.reduce((min, curr) =>
                new Date(curr.join_date!) < new Date(min) ? curr.join_date : min
            )
            : undefined;

        // Calculate service years
        const now = new Date();
        let totalServiceYears = 0;
        if (firstJoinDate) {
            const joinDateObj = new Date(firstJoinDate);
            totalServiceYears = now.getFullYear() - joinDateObj.getFullYear();
            // Adjust if anniversary hasn't occurred this year
            const anniversaryThisYear = new Date(now.getFullYear(), joinDateObj.getMonth(), joinDateObj.getDate());
            if (now < anniversaryThisYear) {
                totalServiceYears--;
            }
        }

        // Get current assignment
        const latestEntry = history[0]; // Already sorted newest first

        return {
            nik: resolved.nik,
            emp_name: resolved.emp_name,
            current_emp_code: latestEntry.emp_code,
            current_gang_code: latestEntry.gang_code,
            current_division_code: latestEntry.division_code,
            total_divisions: uniqueDivisions.length,
            total_gangs: uniqueGangs.length,
            first_join_date: firstJoinDate,
            total_service_years: totalServiceYears,
            career_timeline: history,
            gang_changes: gangChanges
        };
    }

    /**
     * Search employees by name and return their career summaries
     */
    async searchByName(nameQuery: string, limit: number = 20): Promise<CareerSummary[]> {
        const searchTerm = nameQuery.replace(/\s+/g, '%');

        // Search in live HR_EMPLOYEE
        const liveRows = await this.liveDb.query(`
            SELECT TOP ${limit}
                RTRIM(EmpCode) as emp_code,
                RTRIM(EmpName) as emp_name,
                RTRIM(NewICNo) as nik
            FROM HR_EMPLOYEE
            WHERE RTRIM(EmpName) LIKE ?
            ORDER BY EmpName
        `, [`%${searchTerm}%`]);

        const summaries: CareerSummary[] = [];

        for (const row of liveRows) {
            const summary = await this.getCareerSummary(row.emp_code);
            if (summary) {
                summaries.push(summary);
            }
        }

        return summaries;
    }

    /**
     * Get employees who changed gangs in a specific period
     */
    async getGangTransfers(periodMonth: number, periodYear: number): Promise<GangChangeEntry[]> {
        const transfers: GangChangeEntry[] = [];

        // Get current period gang assignments
        const currentRows = await this.historyDb.query(`
            SELECT emp_code, emp_name, gang_code, division_code
            FROM history_gang_member
            WHERE period_month = ? AND period_year = ?
        `, [periodMonth, periodYear]);

        // Get previous period gang assignments
        let prevMonth = periodMonth - 1;
        let prevYear = periodYear;
        if (prevMonth < 1) {
            prevMonth = 12;
            prevYear--;
        }

        const previousRows = await this.historyDb.query(`
            SELECT emp_code, emp_name, gang_code, division_code
            FROM history_gang_member
            WHERE period_month = ? AND period_year = ?
        `, [prevMonth, prevYear]);

        // Create map of previous assignments
        const previousMap = new Map<string, { gang_code: string; division_code: string; emp_name: string }>();
        previousRows.forEach((row: any) => {
            const key = row.emp_code?.trim();
            if (key) {
                previousMap.set(key, {
                    gang_code: row.gang_code?.trim() || '',
                    division_code: row.division_code?.trim() || '',
                    emp_name: row.emp_name?.trim() || ''
                });
            }
        });

        // Compare with current
        currentRows.forEach((row: any) => {
            const key = row.emp_code?.trim();
            const previous = previousMap.get(key);

            if (previous) {
                const gangChanged = row.gang_code?.trim() !== previous.gang_code;
                const divisionChanged = row.division_code?.trim() !== previous.division_code;

                if (gangChanged || divisionChanged) {
                    transfers.push({
                        from_gang_code: previous.gang_code,
                        from_division_code: previous.division_code,
                        to_gang_code: row.gang_code?.trim() || '',
                        to_division_code: row.division_code?.trim() || '',
                        change_month: periodMonth,
                        change_year: periodYear,
                        emp_code: row.emp_code?.trim() || '',
                        nik: '', // NIK not available in history_gang_member
                        emp_name: row.emp_name?.trim() || ''
                    });
                }
            }
        });

        return transfers;
    }
}

export const employeeCareerHistoryService = EmployeeCareerHistoryService.getInstance();
