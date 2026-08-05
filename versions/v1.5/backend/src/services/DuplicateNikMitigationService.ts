/**
 * Duplicate NIK Mitigation Service
 * 
 * Service ini menangani kasus duplikasi NIK (Human Error) dimana beberapa karyawan
 * memiliki NIK yang sama tetapi EmpCode berbeda.
 * 
 * Strategi Mitigasi:
 * 1. Deteksi semua NIK yang duplikat
 * 2. Resolve EmpCode yang benar berdasarkan context (gang, period, status)
 * 3. Gunakan Map EmpCode untuk query history
 * 4. Fallback ke nama karyawan jika NIK tidak reliable
 * 
 * @see {@link https://pt-rebinmas.atlassian.net/wiki/spaces/PAY/pages/123/Duplicate+NIK+Handling}
 */

import { Database } from "../db/client";

export interface DuplicateNikInfo {
    nik: string;
    employee_count: number;
    employees: DuplicateNikEmployee[];
    is_resolved: boolean;
    resolution_method?: 'status' | 'join_date' | 'gang_match' | 'name_match';
}

export interface DuplicateNikEmployee {
    emp_code: string;
    emp_name: string;
    gang_code: string;
    division_code: string;
    status: string; // '1' = Active, '0' = Inactive
    join_date?: string;
    terminate_date?: string;
}

export interface NikResolutionResult {
    nik: string;
    resolved_emp_code: string | null;
    resolution_method: 'single' | 'status' | 'join_date' | 'gang_match' | 'name_match' | 'latest' | 'latest_update';
    all_emp_codes: string[];
    confidence: 'high' | 'medium' | 'low';
    notes?: string;
}

export interface NikEmpCodeMap {
    nik: string;
    emp_codes: string[];
    primary_emp_code: string | null;
}

export class DuplicateNikMitigationService {
    private static instance: DuplicateNikMitigationService;
    private db: Database;
    private extendDb: Database;

    // Cache untuk duplicate NIK yang sudah terdeteksi
    private duplicateNikCache: Map<string, DuplicateNikInfo> = new Map();
    private cacheTimestamp: Map<string, number> = new Map();
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

    private constructor() {
        this.db = Database.getInstance();
        this.extendDb = Database.getExtendedInstance();
    }

    public static getInstance(): DuplicateNikMitigationService {
        if (!DuplicateNikMitigationService.instance) {
            DuplicateNikMitigationService.instance = new DuplicateNikMitigationService();
        }
        return DuplicateNikMitigationService.instance;
    }

    // ============================================================================
    // DETECTION METHODS
    // ============================================================================

    /**
     * Detect all NIKs that have duplicate entries in HR_EMPLOYEE
     */
    public async detectDuplicateNiks(): Promise<DuplicateNikInfo[]> {
        try {
            const duplicateRows = await this.db.query(`
                SELECT RTRIM(NewICNo) as nik, COUNT(*) as cnt
                FROM HR_EMPLOYEE
                WHERE NewICNo IS NOT NULL AND RTRIM(NewICNo) != ''
                GROUP BY RTRIM(NewICNo)
                HAVING COUNT(*) > 1
                ORDER BY cnt DESC
            `);

            const results: DuplicateNikInfo[] = [];

            for (const row of duplicateRows) {
                const employees = await this.getEmployeesByNik(row.nik);
                results.push({
                    nik: row.nik,
                    employee_count: Number(row.cnt),
                    employees,
                    is_resolved: false
                });
            }

            // Update cache
            this.duplicateNikCache.clear();
            results.forEach(info => {
                this.duplicateNikCache.set(info.nik, info);
                this.cacheTimestamp.set(info.nik, Date.now());
            });

            return results;
        } catch (error: any) {
            console.error('[DuplicateNikMitigationService] Error detecting duplicate NIKs:', error.message);
            return [];
        }
    }

    /**
     * Get all employees associated with a specific NIK
     * 
     * IMPORTANT: Prioritizes employees WITH gang assignment from HR_GANGLN
     * EmpCode is taken from HR_GANGLN.GangMember (most accurate for payroll)
     * 
     * NOTE: Input NIK is trimmed to handle spaces in database
     */
    public async getEmployeesByNik(nik: string): Promise<DuplicateNikEmployee[]> {
        // ALWAYS trim input to handle spaces
        const trimmedNik = (nik || '').trim();
        
        try {
            // Query prioritizes employees with gang assignment
            // Uses HR_GANGLN.GangMember as the authoritative EmpCode source
            const rows = await this.db.query(`
                SELECT
                    RTRIM(COALESCE(gl.GangMember, e.EmpCode)) as emp_code,
                    e.EmpName as emp_name,
                    RTRIM(gl.GangCode) as gang_code,
                    RTRIM(e.LocCode) as division_code,
                    e.Status as status,
                    CONVERT(VARCHAR(10), em.AppJoinDate, 120) as join_date,
                    CONVERT(VARCHAR(10), em.TerminateDate, 120) as terminate_date
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(e.EmpCode) = RTRIM(em.EmpCode)
                LEFT JOIN HR_GANGLN gl ON RTRIM(e.EmpCode) = RTRIM(gl.GangMember)
                WHERE RTRIM(e.NewICNo) = ? OR RTRIM(e.EmpCode) = ?
                ORDER BY
                    gl.GangMember DESC, -- Prioritize employees with gang assignment
                    e.EmpCode DESC,
                    CASE WHEN RTRIM(e.Status) = '1' THEN 0 ELSE 1 END,
                    em.AppJoinDate DESC
            `, [trimmedNik, trimmedNik]);

            return rows.map(r => ({
                emp_code: r.emp_code,
                emp_name: r.emp_name,
                gang_code: r.gang_code || '',
                division_code: r.division_code || '',
                status: r.status,
                join_date: r.join_date,
                terminate_date: r.terminate_date
            }));
        } catch (error: any) {
            console.error(`[DuplicateNikMitigationService] Error getting employees for NIK ${nik}:`, error.message);
            return [];
        }
    }

    /**
     * Check if a specific NIK has duplicates
     */
    public async hasDuplicate(nik: string): Promise<boolean> {
        // Trim input to handle spaces
        const trimmedNik = (nik || '').trim();
        
        // Check cache first
        const cached = this.getCachedDuplicate(trimmedNik);
        if (cached) {
            return cached.employee_count > 1;
        }

        const result = await this.db.queryOne<{ cnt: number }>(`
            SELECT COUNT(*) as cnt
            FROM HR_EMPLOYEE
            WHERE (RTRIM(NewICNo) = ? OR RTRIM(EmpCode) = ?)
              AND NewICNo IS NOT NULL AND RTRIM(NewICNo) != ''
        `, [trimmedNik, trimmedNik]);

        return (result?.cnt || 0) > 1;
    }

    /**
     * Get cached duplicate info if still valid
     */
    private getCachedDuplicate(nik: string): DuplicateNikInfo | null {
        const info = this.duplicateNikCache.get(nik);
        if (!info) return null;

        const timestamp = this.cacheTimestamp.get(nik) || 0;
        if (Date.now() - timestamp > this.CACHE_TTL_MS) {
            this.duplicateNikCache.delete(nik);
            this.cacheTimestamp.delete(nik);
            return null;
        }

        return info;
    }

    // ============================================================================
    // RESOLUTION METHODS
    // ============================================================================

    /**
     * Resolve the correct EmpCode for a given NIK with optional context
     *
     * IMPORTANT: Now prioritizes latest EmpCode (C-prefix > B-prefix > A-prefix)
     * The underlying query already orders by EmpCode DESC, so first result is the latest
     *
     * Resolution priority:
     * 1. Latest EmpCode (highest alphabetically - C > B > A)
     * 2. Status = '1' (Active) - used as tiebreaker
     * 3. Match with preferred gang (if provided)
     */
    public async resolveEmpCode(
        nik: string,
        options?: {
            preferredGang?: string;
            preferredDivision?: string;
            periodMonth?: number;
            periodYear?: number;
        }
    ): Promise<NikResolutionResult> {
        const employees = await this.getEmployeesByNik(nik);

        if (employees.length === 0) {
            return {
                nik,
                resolved_emp_code: null,
                resolution_method: 'single',
                all_emp_codes: [],
                confidence: 'low',
                notes: 'NIK not found in HR_EMPLOYEE'
            };
        }

        if (employees.length === 1) {
            return {
                nik,
                resolved_emp_code: employees[0].emp_code,
                resolution_method: 'single',
                all_emp_codes: [employees[0].emp_code],
                confidence: 'high',
                notes: 'Single employee found for this NIK'
            };
        }

        // Multiple employees found - use latest EmpCode (query already sorted by EmpCode DESC)
        const allEmpCodes = employees.map(e => e.emp_code);
        
        // First employee is the one with highest EmpCode (C-prefix > B-prefix > A-prefix)
        const latestEmpCode = employees[0].emp_code;
        
        // Check if we should use preferred gang/division matching for better accuracy
        if (options?.preferredGang || options?.preferredDivision) {
            // Try to find match with preferred gang among employees with highest EmpCode
            if (options?.preferredGang) {
                const gangMatch = employees.find(e =>
                    e.gang_code?.toUpperCase() === options.preferredGang?.toUpperCase()
                );
                
                if (gangMatch) {
                    return {
                        nik,
                        resolved_emp_code: gangMatch.emp_code,
                        resolution_method: 'gang_match',
                        all_emp_codes: allEmpCodes,
                        confidence: 'high',
                        notes: `Resolved by gang match - ${options.preferredGang} (latest EmpCode: ${latestEmpCode})`
                    };
                }
            }
            
            // Try to find match with preferred division
            if (options?.preferredDivision) {
                const divisionMatch = employees.find(e =>
                    e.division_code?.toUpperCase() === options.preferredDivision?.toUpperCase()
                );
                
                if (divisionMatch) {
                    return {
                        nik,
                        resolved_emp_code: divisionMatch.emp_code,
                        resolution_method: 'gang_match',
                        all_emp_codes: allEmpCodes,
                        confidence: 'high',
                        notes: `Resolved by division match - ${options.preferredDivision} (latest EmpCode: ${latestEmpCode})`
                    };
                }
            }
        }

        // Default: Use latest EmpCode (first in the sorted list)
        return {
            nik,
            resolved_emp_code: latestEmpCode,
            resolution_method: 'latest',
            all_emp_codes: allEmpCodes,
            confidence: 'high',
            notes: `Using latest EmpCode (C-prefix > B-prefix > A-prefix): ${latestEmpCode}`
        };
    }

    /**
     * Get all EmpCodes ever used by a NIK (for historical queries)
     */
    public async getAllEmpCodesForNik(nik: string): Promise<NikEmpCodeMap> {
        const resolution = await this.resolveEmpCode(nik);
        
        return {
            nik,
            emp_codes: resolution.all_emp_codes,
            primary_emp_code: resolution.resolved_emp_code
        };
    }

    /**
     * Bulk resolve EmpCodes for multiple NIKs with optional preferred gangs
     */
    public async bulkResolveEmpCodes(
        niks: string[],
        preferredGangs?: Map<string, string>
    ): Promise<Map<string, NikResolutionResult>> {
        const results = new Map<string, NikResolutionResult>();

        for (const nik of niks) {
            const preferredGang = preferredGangs?.get(nik.toUpperCase());
            const resolution = await this.resolveEmpCode(nik, {
                preferredGang
            });
            results.set(nik, resolution);
        }

        return results;
    }

    // ============================================================================
    // HISTORY QUERY HELPERS
    // ============================================================================

    /**
     * Build SQL WHERE clause for querying history with duplicate NIK handling
     * 
     * Returns: { where: string, params: any[] }
     * 
     * Example output:
     * where: "(nik = ? OR emp_code IN (?, ?, ?))"
     * params: ["123456", "A001", "A001B", "A001C"]
     */
    public async buildHistoryQueryFilter(nik: string): Promise<{ where: string; params: any[] }> {
        const empCodeMap = await this.getAllEmpCodesForNik(nik);
        
        if (empCodeMap.emp_codes.length === 0) {
            return {
                where: '1 = 0', // No results
                params: []
            };
        }

        if (empCodeMap.emp_codes.length === 1) {
            return {
                where: '(nik = ? OR emp_code = ?)',
                params: [nik, empCodeMap.emp_codes[0]]
            };
        }

        // Multiple EmpCodes
        const placeholders = empCodeMap.emp_codes.map(() => '?').join(',');
        return {
            where: `(nik = ? OR emp_code IN (${placeholders}))`,
            params: [nik, ...empCodeMap.emp_codes]
        };
    }

    /**
     * Query payroll history detail with duplicate NIK handling
     */
    public async queryPayrollHistory(
        nik: string,
        options?: {
            periodMonth?: number;
            periodYear?: number;
        }
    ) {
        const filter = await this.buildHistoryQueryFilter(nik);
        
        let sql = `
            SELECT DISTINCT
                phd.*,
                phh.gang_code,
                phh.division_code,
                phh.period_month,
                phh.period_year
            FROM dbo.payroll_history_detail phd
            JOIN dbo.payroll_history_header phh ON phd.master_id = phh.id
            WHERE ${filter.where}
        `;

        const params: any[] = [...filter.params];

        if (options?.periodMonth && options?.periodYear) {
            sql += ` AND phh.period_month = ? AND phh.period_year = ?`;
            params.push(options.periodMonth, options.periodYear);
        }

        sql += ` ORDER BY phh.period_year DESC, phh.period_month DESC`;

        try {
            return await this.extendDb.query(sql, params);
        } catch (error: any) {
            console.error('[DuplicateNikMitigationService] Error querying payroll history:', error.message);
            return [];
        }
    }

    /**
     * Query gang member history with duplicate NIK handling
     */
    public async queryGangMemberHistory(
        nik: string,
        options?: {
            periodMonth?: number;
            periodYear?: number;
        }
    ) {
        const filter = await this.buildHistoryQueryFilter(nik);
        
        let sql = `
            SELECT * FROM dbo.history_gang_member
            WHERE ${filter.where}
        `;

        const params: any[] = [...filter.params];

        if (options?.periodMonth && options?.periodYear) {
            sql += ` AND period_month = ? AND period_year = ?`;
            params.push(options.periodMonth, options.periodYear);
        }

        sql += ` ORDER BY period_year DESC, period_month DESC`;

        try {
            return await this.extendDb.query(sql, params);
        } catch (error: any) {
            console.error('[DuplicateNikMitigationService] Error querying gang member history:', error.message);
            return [];
        }
    }

    // ============================================================================
    // NAME-BASED FALLBACK
    // ============================================================================

    /**
     * Find employees by name when NIK is unreliable
     * 
     * Uses fuzzy matching on employee name
     */
    public async findEmployeesByName(
        name: string,
        options?: {
            gang?: string;
            division?: string;
            limit?: number;
        }
    ): Promise<DuplicateNikEmployee[]> {
        try {
            const normalizedName = name.trim().toUpperCase();
            
            // Use LIKE for partial match
            let condition = `WHERE UPPER(e.EmpName) LIKE ?`;
            const params: any[] = [`%${normalizedName}%`];

            if (options?.gang) {
                condition += ` AND RTRIM(gl.GangCode) = ?`;
                params.push(options.gang);
            }

            if (options?.division) {
                condition += ` AND RTRIM(e.LocCode) = ?`;
                params.push(options.division);
            }

            const limit = options?.limit || 10;

            const rows = await this.db.query(`
                SELECT TOP (${limit})
                    RTRIM(e.EmpCode) as emp_code,
                    e.EmpName as emp_name,
                    RTRIM(gl.GangCode) as gang_code,
                    RTRIM(e.LocCode) as division_code,
                    e.Status as status,
                    CONVERT(VARCHAR(10), em.AppJoinDate, 120) as join_date,
                    CONVERT(VARCHAR(10), em.TerminateDate, 120) as terminate_date
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_EMPLOYMENT em ON RTRIM(e.EmpCode) = RTRIM(em.EmpCode)
                LEFT JOIN HR_GANGLN gl ON RTRIM(e.EmpCode) = RTRIM(gl.GangMember)
                ${condition}
                ORDER BY
                    e.EmpCode DESC, -- Prioritize latest empcode (C-prefix > B-prefix > A-prefix)
                    CASE WHEN RTRIM(e.Status) = '1' THEN 0 ELSE 1 END,
                    e.EmpName
            `, params);

            return rows.map(r => ({
                emp_code: r.emp_code,
                emp_name: r.emp_name,
                gang_code: r.gang_code || '',
                division_code: r.division_code || '',
                status: r.status,
                join_date: r.join_date,
                terminate_date: r.terminate_date
            }));
        } catch (error: any) {
            console.error('[DuplicateNikMitigationService] Error finding employees by name:', error.message);
            return [];
        }
    }

    /**
     * Resolve employee identity using name when NIK fails
     */
    public async resolveByIdentity(
        identifier: string,
        name?: string,
        options?: {
            gang?: string;
            division?: string;
        }
    ): Promise<NikResolutionResult> {
        // First, try as NIK
        const nikResult = await this.resolveEmpCode(identifier, {
            preferredGang: options?.gang,
            preferredDivision: options?.division
        });
        
        if (nikResult.resolved_emp_code) {
            return nikResult;
        }

        // If NIK fails and name is provided, try name matching
        if (name) {
            const nameMatches = await this.findEmployeesByName(name, options);
            
            if (nameMatches.length === 1) {
                return {
                    nik: identifier,
                    resolved_emp_code: nameMatches[0].emp_code,
                    resolution_method: 'name_match',
                    all_emp_codes: [nameMatches[0].emp_code],
                    confidence: 'medium',
                    notes: `Resolved by name match - ${name}`
                };
            }

            if (nameMatches.length > 1) {
                // Multiple name matches - use the one with matching gang/division if available
                const bestMatch = nameMatches.find(e => {
                    if (options?.gang && e.gang_code?.toUpperCase() === options.gang.toUpperCase()) {
                        return true;
                    }
                    if (options?.division && e.division_code?.toUpperCase() === options.division.toUpperCase()) {
                        return true;
                    }
                    return false;
                });

                if (bestMatch) {
                    return {
                        nik: identifier,
                        resolved_emp_code: bestMatch.emp_code,
                        resolution_method: 'name_match',
                        all_emp_codes: nameMatches.map(e => e.emp_code),
                        confidence: 'medium',
                        notes: `Resolved by name + context match - ${name}`
                    };
                }
            }
        }

        // Try as EmpCode directly
        const empCodeResult = await this.resolveEmpCode(identifier, {
            preferredGang: options?.gang,
            preferredDivision: options?.division
        });
        if (empCodeResult.resolved_emp_code) {
            return empCodeResult;
        }

        return {
            nik: identifier,
            resolved_emp_code: null,
            resolution_method: 'single',
            all_emp_codes: [],
            confidence: 'low',
            notes: 'Could not resolve employee identity'
        };
    }

    // ============================================================================
    // PT REBINMAS SPECIFIC BUSINESS RULES
    // ============================================================================

    /**
     * PT Rebinmas specific resolution logic
     * 
     * Business Rules:
     * 1. Prioritize employees with gang assignment (HR_GANGLN)
     * 2. For plantation workers (LocCode = P1A, P1B, P2A, P2B, etc.), prioritize active status
     * 3. For mill workers (MILL), prioritize by latest transaction date
     * 4. Consider name similarity (normalize spacing and case)
     * 5. Use most recently updated EmpCode as fallback (from HR_EMPLOYMENT table)
     */
    public async resolveEmpCodeForRebinmas(
        nik: string,
        options?: {
            preferredGang?: string;
            preferredDivision?: string;
            periodMonth?: number;
            periodYear?: number;
            isMillWorker?: boolean;
        }
    ): Promise<NikResolutionResult> {
        const employees = await this.getEmployeesByNik(nik);

        if (employees.length === 0) {
            return {
                nik,
                resolved_emp_code: null,
                resolution_method: 'single',
                all_emp_codes: [],
                confidence: 'low',
                notes: 'NIK not found in HR_EMPLOYEE'
            };
        }

        if (employees.length === 1) {
            return {
                nik,
                resolved_emp_code: employees[0].emp_code,
                resolution_method: 'single',
                all_emp_codes: [employees[0].emp_code],
                confidence: 'high',
                notes: 'Single employee found for this NIK'
            };
        }

        const allEmpCodes = employees.map(e => e.emp_code);

        // Rule 1: Filter by Status = '1' (Active) - HIGHEST PRIORITY
        const activeEmployees = employees.filter(e => e.status === '1');
        
        if (activeEmployees.length === 1) {
            return {
                nik,
                resolved_emp_code: activeEmployees[0].emp_code,
                resolution_method: 'status',
                all_emp_codes: allEmpCodes,
                confidence: 'high',
                notes: 'PT Rebinmas Rule: Resolved by active status - only one active employee'
            };
        }

        // Rule 2: If multiple active, prioritize by gang assignment
        if (activeEmployees.length > 1) {
            const withGangAssignment = activeEmployees.filter(e => e.gang_code);
            
            if (withGangAssignment.length === 1) {
                return {
                    nik,
                    resolved_emp_code: withGangAssignment[0].emp_code,
                    resolution_method: 'gang_match',
                    all_emp_codes: allEmpCodes,
                    confidence: 'high',
                    notes: 'PT Rebinmas Rule: Only one active employee with gang assignment'
                };
            }

            // Rule 3: Match with preferred gang (if provided)
            if (options?.preferredGang) {
                const gangMatch = withGangAssignment.find(e => 
                    e.gang_code?.toUpperCase() === options.preferredGang?.toUpperCase()
                );
                
                if (gangMatch) {
                    return {
                        nik,
                        resolved_emp_code: gangMatch.emp_code,
                        resolution_method: 'gang_match',
                        all_emp_codes: allEmpCodes,
                        confidence: 'high',
                        notes: `PT Rebinmas Rule: Matched preferred gang - ${options.preferredGang}`
                    };
                }
            }

            // Rule 4: For mill workers, use latest transaction
            if (options?.isMillWorker || options?.preferredDivision === 'MILL') {
                // Sort by EmpCode descending (newer codes are typically higher)
                const sortedByCode = withGangAssignment.sort((a, b) => 
                    b.emp_code.localeCompare(a.emp_code)
                );
                
                return {
                    nik,
                    resolved_emp_code: sortedByCode[0].emp_code,
                    resolution_method: 'latest',
                    all_emp_codes: allEmpCodes,
                    confidence: 'medium',
                    notes: 'PT Rebinmas Rule: Mill worker - using latest EmpCode'
                };
            }

            // Rule 5: For plantation workers, prioritize by division
            if (options?.preferredDivision) {
                const divisionMatch = withGangAssignment.find(e => 
                    e.division_code?.toUpperCase() === options.preferredDivision?.toUpperCase()
                );
                
                if (divisionMatch) {
                    return {
                        nik,
                        resolved_emp_code: divisionMatch.emp_code,
                        resolution_method: 'gang_match',
                        all_emp_codes: allEmpCodes,
                        confidence: 'high',
                        notes: `PT Rebinmas Rule: Matched preferred division - ${options.preferredDivision}`
                    };
                }
            }

            // Rule 6: Use name normalization to find the most consistent name
            const normalizedNames = withGangAssignment.map(e => ({
                ...e,
                normalizedName: this.normalizeName(e.emp_name)
            }));
            
            // Group by normalized name
            const nameGroups = new Map<string, typeof withGangAssignment>();
            normalizedNames.forEach(emp => {
                const key = emp.normalizedName;
                if (!nameGroups.has(key)) {
                    nameGroups.set(key, []);
                }
                nameGroups.get(key)!.push(emp);
            });

            // If one name variant has more employees, use that group's first employee
            if (nameGroups.size > 0) {
                const largestGroup = Array.from(nameGroups.entries())
                    .sort((a, b) => b[1].length - a[1].length)[0];
                
                if (largestGroup && largestGroup[1].length > 1) {
                    return {
                        nik,
                        resolved_emp_code: largestGroup[1][0].emp_code,
                        resolution_method: 'name_match',
                        all_emp_codes: allEmpCodes,
                        confidence: 'medium',
                        notes: `PT Rebinmas Rule: Most common name variant - ${largestGroup[0]}`
                    };
                }
            }

            // Rule 7: Fallback to latest join date
            const sortedByJoinDate = withGangAssignment.sort((a, b) => {
                const dateA = a.join_date ? new Date(a.join_date).getTime() : 0;
                const dateB = b.join_date ? new Date(b.join_date).getTime() : 0;
                return dateB - dateA;
            });

            if (sortedByJoinDate[0]?.join_date) {
                return {
                    nik,
                    resolved_emp_code: sortedByJoinDate[0].emp_code,
                    resolution_method: 'join_date',
                    all_emp_codes: allEmpCodes,
                    confidence: 'medium',
                    notes: 'PT Rebinmas Rule: Latest join date among active employees'
                };
            }
        }

        // Fallback: Get the most recently updated EmpCode from HR_EMPLOYMENT
        const latestEmpCode = await this.getLatestUpdatedEmpCode(nik);
        
        if (latestEmpCode) {
            return {
                nik,
                resolved_emp_code: latestEmpCode,
                resolution_method: 'latest_update',
                all_emp_codes: allEmpCodes,
                confidence: 'medium',
                notes: 'PT Rebinmas Rule: Using most recently updated EmpCode from HR_EMPLOYMENT'
            };
        }

        // Final fallback: Use latest EmpCode alphabetically (old behavior)
        const sortedByEmpCode = employees.sort((a, b) => b.emp_code.localeCompare(a.emp_code));
        
        return {
            nik,
            resolved_emp_code: sortedByEmpCode[0]?.emp_code || null,
            resolution_method: 'latest',
            all_emp_codes: allEmpCodes,
            confidence: 'low',
            notes: 'PT Rebinmas Rule: Fallback - using latest EmpCode alphabetically'
        };
    }

    /**
     * Get the most recently updated EmpCode for a NIK from HR_EMPLOYMENT table
     * This reflects the latest data entry/update
     * 
     * Note: Prioritizes EmpCode DESC first to get latest empcode (C-prefix > B-prefix > A-prefix)
     */
    private async getLatestUpdatedEmpCode(nik: string): Promise<string | null> {
        try {
            // Try with UpdateDate first (if exists)
            try {
                const rows = await this.db.query(`
                    SELECT TOP 1 RTRIM(e.EmpCode) as EmpCode
                    FROM HR_EMPLOYEE e
                    LEFT JOIN HR_EMPLOYMENT em ON RTRIM(e.EmpCode) = RTRIM(em.EmpCode)
                    WHERE RTRIM(e.NewICNo) = ? OR RTRIM(e.EmpCode) = ?
                    ORDER BY e.EmpCode DESC, em.UpdateDate DESC, em.AppJoinDate DESC
                `, [nik, nik]);

                return rows[0]?.EmpCode || null;
            } catch {
                // UpdateDate doesn't exist, fallback to EmpCode DESC first
                // This gives us the highest/latest empcode
                const rows = await this.db.query(`
                    SELECT TOP 1 RTRIM(e.EmpCode) as EmpCode
                    FROM HR_EMPLOYEE e
                    LEFT JOIN HR_EMPLOYMENT em ON RTRIM(e.EmpCode) = RTRIM(em.EmpCode)
                    WHERE RTRIM(e.NewICNo) = ? OR RTRIM(e.EmpCode) = ?
                    ORDER BY e.EmpCode DESC, em.AppJoinDate DESC
                `, [nik, nik]);

                return rows[0]?.EmpCode || null;
            }
        } catch (e) {
            console.error(`[DuplicateNikMitigationService] Error getting latest updated emp code:`, e);
            return null;
        }
    }

    /**
     * Parse name to separate employee name from parent name
     * Format: "EMPLOYEE_NAME (PARENT_NAME)" or "EMPLOYEE_NAME ( PARENT_NAME )"
     * 
     * In Indonesian naming convention, text in parentheses is typically the parent's name
     */
    private parseEmployeeName(fullName: string): { employeeName: string; parentName?: string } {
        const trimmed = fullName.trim();
        const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)$/);
        
        if (parenMatch) {
            return {
                employeeName: parenMatch[1].trim(),
                parentName: parenMatch[2].trim()
            };
        }
        
        return {
            employeeName: trimmed,
            parentName: undefined
        };
    }

    /**
     * Normalize name for comparison (handle spacing and case variations)
     * IMPORTANT: Only normalizes the employee name part (excludes parent name in parentheses)
     */
    private normalizeName(name: string): string {
        const parsed = this.parseEmployeeName(name);
        return parsed.employeeName
            .toUpperCase()
            .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
            .replace(/[^A-Z0-9 ]/g, '') // Remove special characters
            .trim();
    }

    /**
     * Get the full employee name without parent name
     */
    public getEmployeeNameOnly(fullName: string): string {
        const parsed = this.parseEmployeeName(fullName);
        return parsed.employeeName;
    }

    /**
     * Get the parent name from full name (if present)
     */
    public getParentName(fullName: string): string | undefined {
        const parsed = this.parseEmployeeName(fullName);
        return parsed.parentName;
    }

    /**
     * Detect if duplicate NIK is likely a data entry error vs legitimate name change
     * 
     * Returns: 'likely_error' | 'likely_legitimate' | 'uncertain'
     * 
     * IMPORTANT: Names in parentheses () are parent names in Indonesian naming convention
     * Different employee names (outside parentheses) suggest different people
     */
    public async assessDuplicateLegitimacy(nik: string): Promise<{
        assessment: 'likely_error' | 'likely_legitimate' | 'uncertain';
        reasons: string[];
        recommendation: string;
    }> {
        const employees = await this.getEmployeesByNik(nik);

        if (employees.length === 0) {
            return {
                assessment: 'uncertain',
                reasons: ['No employees found for this NIK'],
                recommendation: 'Manual review required'
            };
        }

        const reasons: string[] = [];
        let assessment: 'likely_error' | 'likely_legitimate' | 'uncertain' = 'uncertain';

        // Extract employee names (excluding parent names in parentheses)
        const employeeNamesWithParsing = employees.map(e => {
            const parsed = this.parseEmployeeName(e.emp_name);
            return {
                emp_code: e.emp_code,
                full_name: e.emp_name,
                employee_name: parsed.employeeName,
                parent_name: parsed.parentName,
                normalized: this.normalizeName(e.emp_name)
            };
        });

        // Check 1: All employees have same employee name (normalized, excluding parent name)
        const uniqueEmployeeNames = new Set(employeeNamesWithParsing.map(e => e.normalized));
        
        if (uniqueEmployeeNames.size === 1) {
            reasons.push('All employees have identical employee names (likely data duplication)');
            assessment = 'likely_error';
        } else if (uniqueEmployeeNames.size === 2) {
            // Two different employee names - could be name change or different people
            const names = Array.from(uniqueEmployeeNames);
            const similarity = this.calculateSimilarity(names[0], names[1]);
            
            if (similarity >= 70) {
                reasons.push(`Two similar employee names (${similarity.toFixed(0)}% similar) - possible name change or variation`);
                assessment = 'uncertain';
            } else {
                reasons.push('Two different employee names - may be different people sharing NIK');
                assessment = 'likely_legitimate';
            }
        } else if (uniqueEmployeeNames.size > 2) {
            reasons.push(`${uniqueEmployeeNames.size} different employee names associated with same NIK (likely error or multiple people)`);
            
            // Check if they are all similar (variations) or truly different
            const namesArray = Array.from(uniqueEmployeeNames);
            let allSimilar = true;
            for (let i = 1; i < namesArray.length; i++) {
                const sim = this.calculateSimilarity(namesArray[0], namesArray[i]);
                if (sim < 60) {
                    allSimilar = false;
                    break;
                }
            }
            
            if (allSimilar) {
                reasons.push('Names are variations of each other (likely data entry inconsistencies)');
                assessment = 'likely_error';
            } else {
                reasons.push('Names are significantly different - likely different people or serious data error');
                assessment = 'likely_legitimate';
            }
        }

        // Check 2: Multiple active employees
        const activeCount = employees.filter(e => e.status === '1').length;
        if (activeCount > 1) {
            reasons.push(`${activeCount} active employees found (should be only 1)`);
            if (uniqueEmployeeNames.size > 1) {
                reasons.push('Multiple active employees with different names - likely different people');
                assessment = 'likely_legitimate';
            } else {
                assessment = 'likely_error';
            }
        }

        // Check 3: Same gang assignment
        const gangCodes = new Set(employees.filter(e => e.gang_code).map(e => e.gang_code));
        if (gangCodes.size === 1 && employees.length > 1) {
            reasons.push('All employees assigned to same gang (duplicate entry)');
            if (uniqueEmployeeNames.size > 1) {
                reasons.push('But different employee names - data inconsistency');
                assessment = 'likely_legitimate';
            } else {
                assessment = 'likely_error';
            }
        }

        // Check 4: Sequential EmpCodes (indicates batch entry error)
        const empCodes = employees.map(e => e.emp_code).sort();
        if (empCodes.length >= 2) {
            const isSequential = empCodes.every((code, i) => {
                if (i === 0) return true;
                const prevNum = parseInt(code.slice(1));
                const currNum = parseInt(empCodes[i - 1].slice(1));
                return !isNaN(prevNum) && !isNaN(currNum) && (prevNum - currNum <= 10);
            });

            if (isSequential) {
                reasons.push('Sequential EmpCodes (likely batch entry error)');
                if (uniqueEmployeeNames.size > 1) {
                    reasons.push('Different names with sequential codes - possible family members or data error');
                    // Don't change assessment, keep it uncertain
                } else {
                    assessment = 'likely_error';
                }
            }
        }

        // Check 5: Large time gap between join dates
        const joinDates = employees
            .filter(e => e.join_date)
            .map(e => new Date(e.join_date!).getTime());

        if (joinDates.length >= 2) {
            const maxGap = Math.max(...joinDates) - Math.min(...joinDates);
            const yearsGap = maxGap / (1000 * 60 * 60 * 24 * 365);

            if (yearsGap > 1) {
                reasons.push(`Large time gap (${yearsGap.toFixed(1)} years) between join dates`);
                
                if (uniqueEmployeeNames.size > 1) {
                    reasons.push('Different names + large time gap = likely different people (legitimate)');
                    assessment = 'likely_legitimate';
                } else {
                    reasons.push('Possible legitimate name change');
                    if (assessment !== 'likely_error') {
                        assessment = 'likely_legitimate';
                    }
                }
            }
        }

        // Check 6: Parent name analysis (if available)
        const parentNames = employeeNamesWithParsing
            .filter(e => e.parent_name)
            .map(e => e.parent_name!.toUpperCase());
        
        if (parentNames.length > 0) {
            const uniqueParentNames = new Set(parentNames);
            
            if (uniqueEmployeeNames.size > 1 && uniqueParentNames.size === 1) {
                reasons.push('Different employee names but same parent name - possible family members');
                assessment = 'likely_legitimate';
            } else if (uniqueEmployeeNames.size > 1 && uniqueParentNames.size > 1) {
                reasons.push('Different employee names and different parent names - likely different people');
                assessment = 'likely_legitimate';
            }
        }

        let recommendation = '';
        if (assessment === 'likely_error') {
            recommendation = 'Recommend merging duplicate records and keeping only the active employee';
        } else if (assessment === 'likely_legitimate') {
            if (uniqueEmployeeNames.size > 1) {
                recommendation = 'Different employee names detected - verify if these are different people sharing the same NIK (family members) or data entry error. Check physical employee records.';
            } else {
                recommendation = 'May be legitimate - verify with HR department for name change documentation';
            }
        } else {
            recommendation = 'Manual review required - insufficient data to determine legitimacy. Check employee physical files.';
        }

        return { assessment, reasons, recommendation };
    }

    // ============================================================================
    // FUZZY MATCHING (Levenshtein Distance)
    // ============================================================================

    /**
     * Calculate Levenshtein distance between two strings
     * Returns the minimum number of single-character edits needed to change one word into the other
     */
    private levenshteinDistance(str1: string, str2: string): number {
        const m = str1.length;
        const n = str2.length;
        
        // Create a matrix
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        // Initialize first column and first row
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        
        // Fill the matrix
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,      // deletion
                    dp[i][j - 1] + 1,      // insertion
                    dp[i - 1][j - 1] + cost // substitution
                );
                
                // Consider transposition (Damerau-Levenshtein)
                if (i > 1 && j > 1 && 
                    str1[i - 1] === str2[j - 2] && 
                    str1[i - 2] === str2[j - 1]) {
                    dp[i][j] = Math.min(
                        dp[i][j],
                        dp[i - 2][j - 2] + cost // transposition
                    );
                }
            }
        }
        
        return dp[m][n];
    }

    /**
     * Calculate similarity percentage between two strings
     * Returns 0-100 where 100 is exact match
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const maxLen = Math.max(str1.length, str2.length);
        if (maxLen === 0) return 100;
        
        const distance = this.levenshteinDistance(str1, str2);
        return ((maxLen - distance) / maxLen) * 100;
    }

    /**
     * Find employees by fuzzy name matching
     * Useful when NIK is unreliable and exact name match fails
     */
    public async findEmployeesByFuzzyName(
        name: string,
        options?: {
            gang?: string;
            division?: string;
            limit?: number;
            minSimilarity?: number; // Default 70%
        }
    ): Promise<Array<{
        emp_code: string;
        emp_name: string;
        gang_code: string;
        division_code: string;
        status: string;
        similarity: number;
        join_date?: string;
        terminate_date?: string;
    }>> {
        // First get all employees with similar names using LIKE
        const allMatches = await this.findEmployeesByName(name, {
            gang: options?.gang,
            division: options?.division,
            limit: options?.limit ? options.limit * 2 : 20 // Get more candidates for filtering
        });

        const minSimilarity = options?.minSimilarity || 70;
        const searchName = this.normalizeName(name);

        // Calculate fuzzy similarity for each match
        const scoredMatches = allMatches.map(emp => ({
            ...emp,
            similarity: this.calculateSimilarity(searchName, this.normalizeName(emp.emp_name))
        }));

        // Filter by minimum similarity and sort by similarity descending
        const filteredMatches = scoredMatches
            .filter(emp => emp.similarity >= minSimilarity)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, options?.limit || 10);

        return filteredMatches;
    }

    /**
     * Resolve employee using fuzzy name matching when NIK and exact name fail
     */
    public async resolveByFuzzyName(
        nik: string,
        approximateName: string,
        options?: {
            gang?: string;
            division?: string;
            minSimilarity?: number;
        }
    ): Promise<NikResolutionResult> {
        // Try exact NIK first
        const nikResult = await this.resolveEmpCode(nik, {
            preferredGang: options?.gang,
            preferredDivision: options?.division
        });

        if (nikResult.resolved_emp_code && nikResult.confidence !== 'low') {
            return nikResult;
        }

        // Fallback to fuzzy name matching
        const fuzzyMatches = await this.findEmployeesByFuzzyName(approximateName, {
            gang: options?.gang,
            division: options?.division,
            minSimilarity: options?.minSimilarity || 75
        });

        if (fuzzyMatches.length === 1) {
            return {
                nik,
                resolved_emp_code: fuzzyMatches[0].emp_code,
                resolution_method: 'name_match',
                all_emp_codes: [fuzzyMatches[0].emp_code],
                confidence: 'medium',
                notes: `Resolved by fuzzy name match (${fuzzyMatches[0].similarity.toFixed(1)}% similarity)`
            };
        }

        if (fuzzyMatches.length > 1) {
            // Use the highest similarity match
            const bestMatch = fuzzyMatches[0];
            
            return {
                nik,
                resolved_emp_code: bestMatch.emp_code,
                resolution_method: 'name_match',
                all_emp_codes: fuzzyMatches.map(m => m.emp_code),
                confidence: bestMatch.similarity >= 90 ? 'high' : 'medium',
                notes: `Resolved by best fuzzy name match (${bestMatch.similarity.toFixed(1)}% similarity)`
            };
        }

        return {
            nik,
            resolved_emp_code: null,
            resolution_method: 'single',
            all_emp_codes: [],
            confidence: 'low',
            notes: 'Could not resolve using NIK or fuzzy name matching'
        };
    }

    /**
     * Generate report of all duplicate NIKs with resolution status
     */
    public async generateDuplicateReport(): Promise<{
        total_duplicate_niks: number;
        total_affected_employees: number;
        resolved_count: number;
        unresolved_count: number;
        duplicates: DuplicateNikInfo[];
    }> {
        const duplicates = await this.detectDuplicateNiks();
        
        let totalAffected = 0;
        let resolvedCount = 0;

        for (const dup of duplicates) {
            totalAffected += dup.employee_count;
            
            // Check if resolved (has active employee)
            const hasActive = dup.employees.some(e => e.status === '1');
            if (hasActive) {
                resolvedCount++;
                dup.is_resolved = true;
                dup.resolution_method = 'status';
            }
        }

        return {
            total_duplicate_niks: duplicates.length,
            total_affected_employees: totalAffected,
            resolved_count: resolvedCount,
            unresolved_count: duplicates.length - resolvedCount,
            duplicates
        };
    }
}

export const duplicateNikMitigationService = DuplicateNikMitigationService.getInstance();
