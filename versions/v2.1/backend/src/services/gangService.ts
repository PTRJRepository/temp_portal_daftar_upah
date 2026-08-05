import { Database } from "../db/client";
// Config is imported dynamically in fetchGangs() to avoid circular dependency issues
import { divisionConfigService } from "./config/DivisionConfigService";

interface Gang {
    gang_code: string;
    description: string;
    loc_code?: string;
    server_profile: string;
}

export class GangService {
    private static instance: GangService;
    private db: Database;

    /**
     * Determine server profile based on LocCode or GangCode
     */
    public getServerProfile(locCode?: string, gangCode?: string): string {
        const loc = (locCode || '').trim().toUpperCase();
        const gang = (gangCode || '').trim().toUpperCase();

        if (loc === 'MILL' || loc === 'PKS' || gang.startsWith('M')) {
            return "SERVER_PROFILE_3"; // Mill Profile
        }

        return "SERVER_PROFILE_1"; // Estate Profile (Default)
    }

    // GangCode to Division mapping
    private readonly DIVISION_MAPPING: Record<string, string[]> = {
        "PG1A": ["A"],
        "PG1B": ["B"],
        "PG2A": ["C"],
        "PG2B": ["D"],
        "DME": ["E"],
        "ARA": ["F"],
        "ARB1": ["G"],
        "ARB2": ["H"],
        "INFRA": ["I"],
        "ARC": ["J"],
        "IJL": ["L"],
        "STF-OFFICE": ["O"],
        "SECURITY": ["SEC"]
    };

    // Mapping from old division names to HR_GANG LocCode
    private readonly DIVISION_TO_LOCCODE: Record<string, string> = {
        "PG1A": "P1A",
        "PG1B": "P1B",
        "PG2A": "P2A",
        "PG2B": "P2B",
        "PGE": "PGE",
        "DME": "DME",
        "ARA": "ARA",
        "ARC": "ARC",
        "ARB1": "AB1",
        "ARB2": "AB2",
        "IJL": "IJL",
        "INFRA": "INF",
        "NURSERY": "NRS",
        "WORKSHOP": "WORKSHOP",
        "WKS_PG": "WKS_PG",
        "WORKSHOP_PG": "WKS_PG",
        "WORKSHOP PG": "WKS_PG",
        "WKS PG": "WKS_PG",
        "WKS_AR": "WKS_AR",
        "WORKSHOP_AR": "WKS_AR",
        "WORKSHOP AR": "WKS_AR",
        "WKS AR": "WKS_AR",
        "HMC": "WKS_AR",
        "AREC": "ARC",
        "AMC": "WKS_PG"
    };

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): GangService {
        if (!GangService.instance) {
            GangService.instance = new GangService();
        }
        return GangService.instance;
    }

    public convertDivisionToLocCode(division: string): string {
        if (!division) return division;
        const divUpper = division.trim().toUpperCase();
        return this.DIVISION_TO_LOCCODE[divUpper] || divUpper;
    }


    // Reverse mapping: LocCode to Division
    private readonly LOCCODE_TO_DIVISION: Record<string, string> = {};

    // Initialize reverse mapping on first access
    private initializeLocCodeToDivision(): void {
        if (Object.keys(this.LOCCODE_TO_DIVISION).length > 0) return;
        // Standard mappings
        for (const [div, loc] of Object.entries(this.DIVISION_TO_LOCCODE)) {
            this.LOCCODE_TO_DIVISION[loc.toUpperCase()] = div;
        }
        // Also add direct mappings for simple cases
        this.LOCCODE_TO_DIVISION["P1A"] = "PG1A";
        this.LOCCODE_TO_DIVISION["P1B"] = "PG1B";
        this.LOCCODE_TO_DIVISION["P2A"] = "PG2A";
        this.LOCCODE_TO_DIVISION["P2B"] = "PG2B";
        // Virtual division gang mappings (gang code -> virtual division)
        this.LOCCODE_TO_DIVISION["HMC"] = "WKS_AR";
        this.LOCCODE_TO_DIVISION["AMC"] = "WKS_PG";
        this.LOCCODE_TO_DIVISION["B2N"] = "NRS";
    }

    /**
     * Convert LocCode to Division name
     * Example: "P1A" -> "PG1A", "AB1" -> "ARB1"
     */
    public convertLocCodeToDivision(locCode: string): string {
        if (!locCode) return locCode;
        this.initializeLocCodeToDivision();
        const locUpper = locCode.trim().toUpperCase();
        return this.LOCCODE_TO_DIVISION[locUpper] || locUpper;
    }

    /**
     * Get all LocCode to Division mappings
     */
    public getLocCodeToDivisionMap(): Record<string, string> {
        this.initializeLocCodeToDivision();
        return { ...this.LOCCODE_TO_DIVISION };
    }

    /**
     * Get all Division to LocCode mappings
     */
    public getDivisionToLocCodeMap(): Record<string, string> {
        return { ...this.DIVISION_TO_LOCCODE };
    }

    /**
     * Get division aliases (alternative names for divisions)
     * Used for fallback filtering: when user selects AB1, also include ARB1
     */
    public getDivisionAliases(): Record<string, string[]> {
        return {
            "AB1": ["ARB1"],
            "PG1A": ["P1A"],
            "PG1B": ["P1B"],
            "PG2A": ["P2A"],
            "PG2B": ["P2B"],
            "INF": ["INFRA", "IN"],
            "NRS": ["NURSERY", "B2N"],
            "WKS_PG": ["WORKSHOP_PG", "WORKSHOP PG", "WKS PG", "AMC"],
            "WKS_AR": ["WORKSHOP_AR", "WORKSHOP AR", "WKS AR", "HMC"],
            "ARC": ["AREC"],
            "WORKSHOP": ["WORKSHOP ALL"]
        };
    }

    /**
     * Get all division codes including aliases for a given division
     * Example: "AB1" returns ["AB1", "ARB1"]
     */
    public getDivisionCodesWithAliases(division: string): string[] {
        if (!division) return [];
        const divUpper = division.trim().toUpperCase();
        const aliases = this.getDivisionAliases();
        // Check if division itself is an alias
        for (const [main, aliasList] of Object.entries(aliases)) {
            if (aliasList.includes(divUpper)) {
                return [main, ...aliasList.filter(a => a !== main)];
            }
        }
        // Check if division is a main division
        if (aliases[divUpper]) {
            return [divUpper, ...aliases[divUpper]];
        }
        return [divUpper];
    }

    /**
     * UNIFIED DIVISION MAPPING
     * Handles all variations: 3-letter, 4-letter, loc_code, division_code
     * Key = canonical division code, Value = array of all aliases
     * NOTE: For regular divisions, includes both 3-letter and 4-letter variants
     */
    private readonly UNIFIED_DIVISION_MAP: Record<string, string[]> = {
        // Plasma divisions
        'PG1A': ['P1A', 'P1a', 'PG1A', 'pg1a', 'PLASMA1A'],
        'PG1B': ['P1B', 'P1b', 'PG1B', 'pg1b', 'PLASMA1B'],
        'PG2A': ['P2A', 'P2a', 'PG2A', 'pg2a', 'PLASMA2A'],
        'PG2B': ['P2B', 'P2b', 'PG2B', 'pg2b', 'PLASMA2B'],
        'PGE':  ['PGE', 'pge', 'Plasma Energi'],
        // Afdeling divisions
        'AB1':  ['AB1', 'AB-1', 'ARB1', 'arb1', 'AFDELING1', 'AFD1'],
        'AB2':  ['AB2', 'AB-2', 'ARB2', 'arb2', 'AFDELING2', 'AFD2'],
        // Other divisions
        'ARA':  ['ARA', 'ara', 'Area'],
        'ARC':  ['ARC', 'arc', 'AREC', 'arec', 'Air Ruak Central'],
        'DME':  ['DME', 'dme', 'Darrur Makmur Estate', 'Darrur Makmur'],
        'IJL':  ['IJL', 'ijl', 'Ijuk'],
        // Infrastructure & Support
        'INF':  ['INF', 'inf', 'INFRA', 'infra', 'INFRASTRUKTUR', 'Infrastruktur'],
        'NRS':  ['NRS', 'nrs', 'NURSERY', 'nursery', 'B2N', 'B2n', 'Nursery'],
        // Virtual divisions - Workshop
        'WKS_AR': ['WKS_AR', 'wks_ar', 'WORKSHOP_AR', 'WORKSHOP AR', 'WKS AR', 'HMC', 'hmc', 'Workshop Air Ruak'],
        'WKS_PG': ['WKS_PG', 'wks_pg', 'WORKSHOP_PG', 'WORKSHOP PG', 'WKS PG', 'AMC', 'amc', 'Workshop Parit Gunung'],
        'WORKSHOP': ['WORKSHOP', 'workshop', 'WORKSHOP_ALL'],
    };

    /**
     * VIRTUAL DIVISION GANG MAPPING
     * Maps virtual divisions to their specific gang codes ONLY
     * Does NOT include parent divisions to avoid data leakage
     */
    private readonly VIRTUAL_DIVISION_GANG_MAP: Record<string, string[]> = {
        'WKS_AR': ['HMC', 'hmc'],
        'WKS_PG': ['AMC', 'amc'],
        'WORKSHOP': ['HMC', 'hmc', 'AMC', 'amc'],
        'INF': ['IN', 'INF', 'inf'],
        'NRS': ['B2N', 'B2n', 'b2n'],
    };

    /**
     * Check if a division is a virtual division
     * Uses DivisionConfigService as single source of truth
     */
    public isVirtualDivision(division: string): boolean {
        if (!division) return false;
        return divisionConfigService.isVirtualDivision(division);
    }

    /**
     * Cek apakah gang termasuk "gang percobaan" — satu-satunya gang yang boleh
     * mengubah PTKP master langsung dari CustomPayrollTable.
     * Rule (confirmed user 2026-08-03): desc mengandung "PERCOBAAN"
     * ATAU gang_code berakhiran "P" ATAU gang_code mengandung "BHL".
     */
    public isPercobaanGang(gangCode?: string | null, gangDesc?: string | null): boolean {
        const code = String(gangCode || '').trim().toUpperCase();
        const desc = String(gangDesc || '').trim().toUpperCase();
        if (!code && !desc) return false;
        return desc.includes('PERCOBAAN') || code.endsWith('P') || code.includes('BHL');
    }

    /**
     * Get gang codes for a virtual division
     * Returns ONLY the specific gang codes, not parent divisions
     * Uses DivisionConfigService for pattern matching
     */
    public async getVirtualDivisionGangs(division: string): Promise<string[]> {
        if (!division) return [];
        const gangs = await divisionConfigService.getGangsForDivision(division);
        return gangs.map(g => g.gang_code);
    }

    /**
     * Initialize unified map cache
     */
    private unifiedMapCache: Map<string, string> | null = null;

    private initializeUnifiedMap(): Map<string, string> {
        if (this.unifiedMapCache) return this.unifiedMapCache;

        this.unifiedMapCache = new Map();
        for (const [canonical, aliases] of Object.entries(this.UNIFIED_DIVISION_MAP)) {
            // Map canonical to itself
            this.unifiedMapCache.set(canonical.toUpperCase(), canonical);
            // Map all aliases to canonical
            for (const alias of aliases) {
                this.unifiedMapCache.set(alias.toUpperCase(), canonical);
            }
        }
        return this.unifiedMapCache;
    }

    /**
     * Normalize any division/loc code to canonical form
     * Example: 'ARB1' -> 'AB1', 'P1A' -> 'PG1A', 'HMC' -> 'WKS_AR'
     *
     * Uses DivisionConfigService as the single source of truth
     */
    public normalizeDivisionCode(input: string): string {
        if (!input) return input;
        // Use DivisionConfigService for resolution
        return divisionConfigService.resolveCode(input);
    }

    /**
     * Check if two codes refer to the same division
     * Example: isSameDivision('AB1', 'ARB1') -> true
     * Example: isSameDivision('HMC', 'WKS_AR') -> true
     */
    public isSameDivision(code1: string, code2: string): boolean {
        if (!code1 || !code2) return false;
        // First check unified mapping
        if (this.normalizeDivisionCode(code1) === this.normalizeDivisionCode(code2)) {
            return true;
        }
        // Also check virtual division gang mappings
        // If code1 is a virtual division and code2 is its gang code, or vice versa
        const c1 = code1.toUpperCase();
        const c2 = code2.toUpperCase();

        for (const [vDiv, gangs] of Object.entries(this.VIRTUAL_DIVISION_GANG_MAP)) {
            const gangSet = new Set(gangs.map(g => g.toUpperCase()));
            if ((c1 === vDiv && gangSet.has(c2)) || (c2 === vDiv && gangSet.has(c1))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get all aliases for a division (including canonical)
     * Uses DivisionConfigService as single source of truth
     * Example: getAllDivisionAliases('AB1') -> ['AB1', 'ARB1', 'AB-1']
     */
    public getAllDivisionAliases(division: string): string[] {
        if (!division) return [];
        return divisionConfigService.getAliases(division);
    }

    /**
     * Build SQL WHERE clause for division filtering with all aliases
     * Uses DivisionConfigService as single source of truth
     * @param divisionParam - Input division code from user
     * @param columnName - Database column name (e.g., 'division_code', 'loc_code')
     * @returns Object with sql fragment and params array
     */
    public buildDivisionWhereClause(divisionParam: string, columnName: string): { sql: string; params: string[] } {
        return divisionConfigService.buildDivisionWhereClause(divisionParam, columnName);
    }

    /**
     * Delegate to divisionConfigService for getting all divisions
     */
    public async getAllDivisions(includeVirtual: boolean = true): Promise<string[]> {
        const divisions = divisionConfigService.getAllDivisionCodes();
        if (includeVirtual) {
            return divisions;
        }
        return divisions.filter(d => !divisionConfigService.isVirtualDivision(d));
    }

    /**
     * Backward-compatible alias used by older extractor/report code.
     */
    public async getGangsByDivision(division?: string, includeVirtual: boolean = false): Promise<Gang[]> {
        return this.fetchGangs(division, undefined, includeVirtual);
    }

    /**
     * Delegate to divisionConfigService for fetching gangs
     */
    public async fetchGangs(division?: string, search?: string, includeVirtual: boolean = false): Promise<Gang[]> {
        try {
            const { Config: Cfg } = await import("../config");
            console.log(`[GangService] fetchGangs triggered - Div: ${division}, Search: ${search}, Profile: ${Cfg.DB_PROFILE}, DB: ${Cfg.DEFAULT_DATABASE}`);

            if (!division || division === 'ALL') {
                // Return all gangs from all divisions - query HR_GANG directly
                console.log(`[GangService] ALL divisions requested, fetching all gangs from HR_GANG`);
                const allGangs = await this.fetchAllGangs();
                console.log(`[GangService] Returning ${allGangs.length} total gangs.`);
                return allGangs;
            }

            // Use DivisionConfigService for gang retrieval
            const gangs = await divisionConfigService.getGangsForDivision(division);
            console.log(`[GangService] divisionConfigService returned ${gangs.length} gangs for ${division}`);

            // Filter by search if provided
            let filtered = gangs;
            if (search) {
                const searchLower = search.toLowerCase();
                filtered = gangs.filter(g =>
                    g.gang_code.toLowerCase().includes(searchLower) ||
                    g.description?.toLowerCase().includes(searchLower)
                );
            }

            const result = filtered.map(g => ({
                gang_code: g.gang_code,
                description: g.description || '',
                loc_code: g.loc_code,
                server_profile: this.getServerProfile(g.loc_code, g.gang_code)
            }));
            console.log(`[GangService] Returning ${result.length} gangs.`);
            return result;
        } catch (e) {
            console.error("[GangService] Failed to fetch gangs:", e);
            return [];
        }
    }

    /**
     * Fetch all gangs from HR_GANGLN (for ALL divisions case)
     * Delegates to divisionConfigService.getAllGangs() for consistent results
     */
    private async fetchAllGangs(): Promise<Gang[]> {
        // Use DivisionConfigService as single source of truth
        const gangs = await divisionConfigService.getAllGangs();
        console.log(`[GangService] fetchAllGangs delegated to DivisionConfigService, returned ${gangs.length} gangs`);

        return gangs.map(g => ({
            gang_code: g.gang_code,
            description: g.description || '',
            loc_code: g.loc_code,
            server_profile: this.getServerProfile(g.loc_code, g.gang_code)
        }));
    }

    /**
     * Get gang information by gang code
     */
    public async getGangInfo(gangCode: string): Promise<any> {
        const division = this.normalizeDivisionCode(gangCode);

        try {
            const rows = await this.db.query<{ Description: string, LocCode: string }>(`
                SELECT Description, LocCode FROM HR_GANG WHERE GangCode = ?
            `, [gangCode]);
            const row = rows[0];

            return {
                gang_code: gangCode,
                division,
                prefix: gangCode[0] || null,
                is_security: gangCode.toUpperCase().startsWith("SEC"),
                description: row?.Description?.trim() || "",
                loc_code: row?.LocCode?.trim() || ""
            };
        } catch (e) {
            return {
                gang_code: gangCode,
                division,
                prefix: gangCode[0] || null,
                is_security: gangCode.toUpperCase().startsWith("SEC"),
                description: "",
                loc_code: ""
            };
        }
    }

    /**
     * Fetch gang codes by loc code
     */
    public async fetchGangsByLocCode(locCode: string): Promise<string[]> {
        try {
            const rows = await this.db.query<{ GangCode: string }>(`
                SELECT GangCode FROM HR_GANG
                WHERE UPPER(LTRIM(RTRIM(LocCode))) = ?
                ORDER BY GangCode
            `, [locCode.toUpperCase()]);
            return rows.map(r => r.GangCode?.trim()).filter(Boolean) as string[];
        } catch (e) {
            console.error("[GangService] fetch_gangs_by_loc_code failed:", e);
            return [];
        }
    }
}

export const gangService = GangService.getInstance();
