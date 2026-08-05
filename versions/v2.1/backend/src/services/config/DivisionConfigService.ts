/**
 * DivisionConfigService - Single Source of Truth for Division Definitions
 *
 * Provides centralized management of:
 * - Real divisions (Plasma, Afdeling, etc.)
 * - Virtual divisions (INF, NRS, WKS_AR, WKS_PG, MILL)
 * - All aliases and mappings
 * - Gang pattern matching for virtual divisions
 *
 * This service should be used by ALL services that need division-related logic.
 */

import { Database } from "../../db/client";

/**
 * Division type enumeration
 */
export type DivisionType = 'real' | 'virtual';

/**
 * Complete division definition interface
 */
export interface DivisionDefinition {
    /** Canonical division code (e.g., 'PG1A', 'AB1', 'INF') */
    code: string;
    /** Human-readable name */
    name: string;
    /** Division type: real or virtual */
    type: DivisionType;
    /** All aliases for this division */
    aliases: string[];
    /** Source division for virtual divisions */
    sourceDivision?: string;
    /** Regex pattern to match gang codes */
    gangPattern?: RegExp;
    /** Regex pattern to match gang descriptions */
    descriptionPattern?: RegExp;
    /** Whether to exclude from source division queries */
    excludeFromSource?: boolean;
    /** Gang prefix for this division */
    gangPrefix?: string;
    /** Gang codes explicitly excluded from this division */
    excludedGangCodes?: string[];
    /** Description from database */
    description?: string;
}

/**
 * Gang information from database
 */
export interface GangInfo {
    gang_code: string;
    description: string;
    loc_code: string;
    division_code?: string;
}

/**
 * Result from division resolution
 */
export interface DivisionResolutionResult {
    canonical: string;
    name: string;
    type: DivisionType;
    isVirtual: boolean;
    sourceDivision?: string;
}

/**
 * Centralized division configuration service
 */
export class DivisionConfigService {
    private static instance: DivisionConfigService;

    /** All registered divisions */
    private divisions: Map<string, DivisionDefinition> = new Map();

    /** Fast lookup: alias -> canonical */
    private aliasToCanonical: Map<string, string> = new Map();

    /** Virtual division gang mappings (gang code -> virtual division) */
    private virtualGangMap: Map<string, string> = new Map();

    private constructor() {
        this.initializeDivisions();
    }

    public static getInstance(): DivisionConfigService {
        if (!DivisionConfigService.instance) {
            DivisionConfigService.instance = new DivisionConfigService();
        }
        return DivisionConfigService.instance;
    }

    /**
     * Initialize all built-in divisions
     */
    private initializeDivisions(): void {
        // === REAL DIVISIONS ===
        this.registerDivision({
            code: 'PG1A',
            name: 'Plasma 1 Afdeling',
            type: 'real',
            aliases: ['P1A', 'P1a', 'pg1a', 'PLASMA1A', 'Plasma 1A'],
            gangPrefix: 'A'
        });

        this.registerDivision({
            code: 'PG1B',
            name: 'Plasma 1 Blok',
            type: 'real',
            aliases: ['P1B', 'P1b', 'pg1b', 'PLASMA1B', 'Plasma 1B'],
            gangPrefix: 'B'
        });

        this.registerDivision({
            code: 'PG2A',
            name: 'Plasma 2 Afdeling',
            type: 'real',
            aliases: ['P2A', 'P2a', 'pg2a', 'PLASMA2A', 'Plasma 2A'],
            gangPrefix: 'C'
        });

        this.registerDivision({
            code: 'PG2B',
            name: 'Plasma 2 Blok',
            type: 'real',
            aliases: ['P2B', 'P2b', 'pg2b', 'PLASMA2B', 'Plasma 2B'],
            gangPrefix: 'D'
        });

        this.registerDivision({
            code: 'PGE',
            name: 'Plasma Energi',
            type: 'real',
            aliases: ['PGE', 'pge'],
            gangPrefix: 'PGE'
        });

        this.registerDivision({
            code: 'AB1',
            name: 'Afdeling 1',
            type: 'real',
            aliases: ['AB1', 'AB-1', 'ARB1', 'arb1', 'AFDELING1', 'AFD1', 'Air Ruak 1'],
            gangPrefix: 'G'
        });

        this.registerDivision({
            code: 'AB2',
            name: 'Afdeling 2',
            type: 'real',
            aliases: ['AB2', 'AB-2', 'ARB2', 'arb2', 'AFDELING2', 'AFD2', 'Air Ruak 2'],
            gangPrefix: 'H'
        });

        this.registerDivision({
            code: 'ARA',
            name: 'Area',
            type: 'real',
            aliases: ['ARA', 'ara', 'Area'],
            gangPrefix: 'F',
            excludedGangCodes: ['F1BHL']
        });

        this.registerDivision({
            code: 'ARC',
            name: 'Air Ruak Central',
            type: 'real',
            aliases: ['ARC', 'arc', 'AREC', 'arec', 'Air Ruak Central'],
            gangPrefix: 'J'
        });

        this.registerDivision({
            code: 'DME',
            name: 'Darrur Makmur Estate',
            type: 'real',
            aliases: ['DME', 'dme', 'Darrur Makmur Estate', 'Darrur Makmur'],
            gangPrefix: 'E'
        });

        this.registerDivision({
            code: 'IJL',
            name: 'Ijuk',
            type: 'real',
            aliases: ['IJL', 'ijl', 'Ijuk', 'L'],
            gangPrefix: 'L'
        });

        // === VIRTUAL DIVISIONS ===
        this.registerDivision({
            code: 'INF',
            name: 'Infrastruktur',
            type: 'virtual',
            aliases: ['INF', 'inf', 'INFRA', 'infra', 'INFRASTRUKTUR', 'Infrastruktur'],
            sourceDivision: 'PG1A',
            gangPattern: /^IN.*/i,  // Matches anything starting with IN
            descriptionPattern: /INFRA(STRUKTUR|STUKTUR)?/i,
            excludeFromSource: true,
            description: 'Infrastruktur - semua gang berawalan IN dari Plasma 1A'
        });

        this.registerDivision({
            code: 'NRS',
            name: 'Nursery',
            type: 'virtual',
            aliases: ['NRS', 'nrs', 'NURSERY', 'nursery', 'B2N', 'B2n', 'Nursery'],
            sourceDivision: 'PG1B',
            gangPattern: /^B2N$/i,
            excludeFromSource: true,
            description: 'Nursery - mengambil gang B2N dari Plasma 1B'
        });

        this.registerDivision({
            code: 'WKS_AR',
            name: 'Workshop Air Ruak',
            type: 'virtual',
            aliases: ['WKS_AR', 'wks_ar', 'WORKSHOP_AR', 'WORKSHOP AR', 'WKS AR', 'HMC', 'hmc', 'Workshop Air Ruak'],
            sourceDivision: 'AB2',
            gangPattern: /^HMC$/i,
            descriptionPattern: /WORKSHOP.*(AIR\s*RUAK|ARE|A\.R)|.*TRAKSI.*AIR\s*RUAK/i,
            excludeFromSource: true,
            description: 'Workshop Air Ruak - mengambil gang HMC dari Afdeling 2'
        });

        this.registerDivision({
            code: 'WKS_PG',
            name: 'Workshop Parit Gunung',
            type: 'virtual',
            aliases: ['WKS_PG', 'wks_pg', 'WORKSHOP_PG', 'WORKSHOP PG', 'WKS PG', 'AMC', 'amc', 'Workshop Parit Gunung'],
            sourceDivision: 'PG1A',
            gangPattern: /^AMC$/i,
            descriptionPattern: /WORKSHOP.*(PARIT|PGE|P\.G|HARAPAN\s*MUKTI)/i,
            excludeFromSource: true,
            description: 'Workshop Parit Gunung - mengambil gang AMC dari Plasma 1A'
        });

        this.registerDivision({
            code: 'WORKSHOP',
            name: 'Workshop All',
            type: 'virtual',
            aliases: ['WORKSHOP', 'workshop', 'WORKSHOP_ALL'],
            sourceDivision: undefined,
            gangPattern: /^(HMC|AMC)$/i,
            excludeFromSource: true,
            description: 'All Workshops - menggabungkan WKS_AR dan WKS_PG'
        });

        this.registerDivision({
            code: 'MILL',
            name: 'Palm Oil Mill',
            type: 'virtual',
            aliases: ['MILL', 'mill', 'Pabrik', 'PKS'],
            sourceDivision: undefined,
            gangPattern: /^M\d*$/i,
            excludeFromSource: true,
            description: 'Palm Oil Mill - semua gang dengan prefix M'
        });

        // Build virtual gang map
        this.initializeVirtualGangMap();
    }

    /**
     * Register a division and its aliases
     */
    private registerDivision(division: DivisionDefinition): void {
        // Register canonical
        this.divisions.set(division.code.toUpperCase(), division);

        // Register all aliases for fast lookup
        for (const alias of division.aliases) {
            this.aliasToCanonical.set(alias.toUpperCase(), division.code.toUpperCase());
        }
    }

    /**
     * Initialize virtual gang to division mapping
     */
    private initializeVirtualGangMap(): void {
        for (const [code, division] of this.divisions.entries()) {
            if (division.type === 'virtual' && division.gangPattern) {
                // We need to find gangs that match the pattern
                // This will be populated when we query the database
            }
        }

        // Also add explicit mappings
        this.virtualGangMap.set('HMC', 'WKS_AR');
        this.virtualGangMap.set('AMC', 'WKS_PG');
        this.virtualGangMap.set('B2N', 'NRS');
    }

    /**
     * Resolve any division code or alias to canonical form
     * @example resolve('INFRA') ΓåÆ 'INF'
     * @example resolve('PG1A') ΓåÆ 'PG1A'
     * @example resolve('P1A') ΓåÆ 'PG1A'
     */
    public resolveCode(input: string): string {
        if (!input) return input;
        const normalized = input.trim().toUpperCase();
        return this.aliasToCanonical.get(normalized) || normalized;
    }

    /**
     * Get complete division information
     */
    public getDivision(input: string): DivisionDefinition | undefined {
        const canonical = this.resolveCode(input);
        return this.divisions.get(canonical);
    }

    /**
     * Check if a division code is virtual
     */
    public isVirtualDivision(input: string): boolean {
        const division = this.getDivision(input);
        return division?.type === 'virtual';
    }

    /**
     * Get all aliases for a division
     */
    public getAliases(input: string): string[] {
        const division = this.getDivision(input);
        return division?.aliases || [input];
    }

    /**
     * Get division name
     */
    public getName(input: string): string {
        const division = this.getDivision(input);
        return division?.name || input;
    }

    /**
     * Get source division for virtual divisions
     */
    public getSourceDivision(input: string): string | undefined {
        const division = this.getDivision(input);
        return division?.sourceDivision;
    }

    /**
     * Get source divisions used to aggregate a division.
     * Real divisions resolve to themselves, aggregate virtual divisions expand
     * to their known sources.
     */
    public getSourceDivisions(input: string): string[] {
        const division = this.getDivision(input);
        if (!division) {
            const resolved = this.resolveCode(input);
            return resolved ? [resolved] : [];
        }

        if (division.type !== "virtual") {
            return [division.code];
        }

        if (division.sourceDivision) {
            return [division.sourceDivision];
        }

        if (division.code === "WORKSHOP") {
            return ["PG1A", "AB2"];
        }

        return [];
    }

    /**
     * Match a gang to its virtual division
     * Returns the virtual division code if matched, null otherwise
     *
     * @param gangCode - The gang code to match
     * @param description - The gang description (optional, for pattern matching)
     * @param sourceLocCode - The original loc_code from HR_GANG
     */
    public matchGangToVirtualDivision(
        gangCode: string,
        description?: string,
        sourceLocCode?: string
    ): string | null {
        if (!gangCode) return null;
        const normalizedGang = gangCode.toUpperCase();

        // First check explicit mappings
        const explicitMapping = this.virtualGangMap.get(normalizedGang);
        if (explicitMapping) {
            return explicitMapping;
        }

        // Then check pattern matching
        for (const [code, division] of this.divisions.entries()) {
            if (division.type !== 'virtual') continue;

            // Check source division constraint
            if (division.sourceDivision && sourceLocCode) {
                const sourceCanonical = this.resolveCode(sourceLocCode);
                if (sourceCanonical !== division.sourceDivision) {
                    continue;
                }
            }

            // Check gang pattern
            if (division.gangPattern && division.gangPattern.test(normalizedGang)) {
                return code;
            }

            // Check description pattern
            if (division.descriptionPattern && description) {
                if (division.descriptionPattern.test(description)) {
                    return code;
                }
            }
        }

        return null;
    }

    /**
     * Compatibility alias used by older services.
     */
    public resolveVirtualDivision(
        gangCode: string,
        sourceLocCode: string,
        description?: string
    ): string | null {
        return this.matchGangToVirtualDivision(gangCode, description, sourceLocCode);
    }

    /**
     * Check whether a gang belongs to a specific virtual division.
     */
    public isGangInVirtualDivision(
        gangCode: string,
        virtualDivision: string,
        description?: string,
        sourceLocCode?: string
    ): boolean {
        const resolvedVirtual = this.resolveCode(virtualDivision);
        const matchedVirtual = this.matchGangToVirtualDivision(gangCode, description, sourceLocCode);
        return matchedVirtual === resolvedVirtual;
    }

    /**
     * Check whether a gang is explicitly excluded from a division.
     */
    public isGangExcludedFromDivision(divisionCode: string, gangCode: string): boolean {
        if (!divisionCode || !gangCode) return false;

        const division = this.getDivision(divisionCode);
        if (!division?.excludedGangCodes?.length) return false;

        const normalizedGang = gangCode.trim().toUpperCase();
        return division.excludedGangCodes.some((excludedGangCode) =>
            excludedGangCode.trim().toUpperCase() === normalizedGang
        );
    }

    /**
     * Get all division codes
     */
    public getAllDivisionCodes(includeVirtual: boolean = true): string[] {
        const allCodes = Array.from(this.divisions.keys());
        if (includeVirtual) {
            return allCodes;
        }
        return allCodes.filter((code) => this.divisions.get(code)?.type !== "virtual");
    }

    /**
     * Get all real divisions
     */
    public getRealDivisions(): DivisionDefinition[] {
        return Array.from(this.divisions.values()).filter(d => d.type === 'real');
    }

    /**
     * Get all virtual divisions
     */
    public getVirtualDivisions(): DivisionDefinition[] {
        return Array.from(this.divisions.values()).filter(d => d.type === 'virtual');
    }

    /**
     * Get all gangs from all divisions (used by GangService.fetchAllGangs)
     */
    public async getAllGangs(): Promise<GangInfo[]> {
        const db = Database.getInstance();

        const query = `
            SELECT DISTINCT
                RTRIM(GangCode) as gang_code,
                RTRIM(Description) as description,
                RTRIM(LocCode) as loc_code
            FROM (
                SELECT GangCode, Description, LocCode FROM HR_GANG
                UNION ALL
                SELECT GangID as GangCode, Description, LocCode FROM PR_GANG
            ) combined
            WHERE RTRIM(GangCode) IS NOT NULL AND RTRIM(GangCode) != ''
        `;

        const results: GangInfo[] = [];
        const seenCodes = new Set<string>();

        try {
            const rows = await db.query<any>(query, []);
            for (const row of rows) {
                const code = (row.gang_code || '').trim().toUpperCase();
                if (code && !seenCodes.has(code)) {
                    seenCodes.add(code);
                    results.push({
                        gang_code: code,
                        description: (row.description || code).trim(),
                        loc_code: (row.loc_code || '').trim(),
                        division_code: '' // Unknown at this point
                    });
                }
            }
        } catch (e) {
            console.error("[DivisionConfigService] Failed to get all gangs:", e);
        }

        return results;
    }

    /**
     * Get gangs for a division (handles both real and virtual)
     */
    public async getGangsForDivision(divisionCode: string): Promise<GangInfo[]> {
        const db = Database.getInstance();
        const division = this.getDivision(divisionCode);

        console.log(`[DivisionConfigService] getGangsForDivision (Enhanced): ${divisionCode}, resolved: ${division?.code}, type: ${division?.type}`);

        if (!division) {
            console.warn(`[DivisionConfigService] Division not found: ${divisionCode}`);
            return [];
        }

        const prefix = division.gangPrefix ? `${division.gangPrefix}%` : null;

        // If it's a virtual division with a source, we search in the source's locations
        let aliases = division.aliases;
        if (division.type === 'virtual' && division.sourceDivision) {
            aliases = this.getAliases(division.sourceDivision);
        } else if (division.type === 'virtual' && !division.sourceDivision) {
             // For global virtual (Workshop, Mill), search ALL loc_codes that aren't themselves virtual
             aliases = Array.from(this.divisions.values())
                .filter(d => d.type === 'real')
                .flatMap(d => d.aliases);
        }
        
        const placeholders = aliases.map(() => '?').join(',');
        const combinedMasterQuery = `
            SELECT DISTINCT 
                RTRIM(GangCode) as gang_code,
                RTRIM(Description) as description,
                RTRIM(LocCode) as loc_code
            FROM (
                SELECT GangCode, Description, LocCode FROM HR_GANG
                UNION ALL
                SELECT GangID as GangCode, Description, LocCode FROM PR_GANG
            ) combined
            WHERE RTRIM(LocCode) IN (${placeholders})
               ${prefix ? `OR (RTRIM(GangCode) LIKE '${prefix}' AND RTRIM(LocCode) IN (${placeholders}))` : ''}
               OR (RTRIM(GangCode) LIKE '%BHL%' AND ? = 'PG1A')
        `;

        // 2. Fallback Membership Discovery (only if Master is empty or for specific tracking)
        // We keep this but filter it more strictly by LocCode to avoid "messy" results
        const membershipQuery = `
            SELECT DISTINCT
                RTRIM(gl.GangCode) as gang_code,
                RTRIM(g.Description) as description,
                RTRIM(e.LocCode) as loc_code
            FROM HR_GANGLN gl
            JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(gl.GangMember)
            LEFT JOIN (
                SELECT GangCode, Description FROM HR_GANG
                UNION ALL
                SELECT GangID, Description FROM PR_GANG
            ) g ON g.GangCode = gl.GangCode
            WHERE RTRIM(e.LocCode) IN (${placeholders})
              AND (RTRIM(gl.GangCode) LIKE '${prefix || ''}%' OR RTRIM(e.LocCode) IN (${placeholders}))
        `;

        const results: GangInfo[] = [];
        const seenCodes = new Set<string>();

        const addResults = (rows: any[]) => {
            for (const row of rows) {
                const code = (row.gang_code || '').trim().toUpperCase();
                if (code && !seenCodes.has(code)) {
                    seenCodes.add(code);
                    results.push({
                        gang_code: code,
                        description: (row.description || code).trim(),
                        loc_code: (row.loc_code || '').trim(),
                        division_code: division.code
                    });
                }
            }
        };

        try {
            // Priority 1: Master Tables (Matches user's SQL logic)
            const masterRows = await db.query<any>(combinedMasterQuery, [...aliases, ...aliases, division.code]);
            addResults(masterRows);

            // Priority 2: Membership (Only if needed to catch outliers, but strictly filtered)
            if (results.length < 5) { // Heuristic: if master is suspiciously thin, try membership
                const membershipRows = await db.query<any>(membershipQuery, [...aliases, ...aliases]);
                addResults(membershipRows);
            }

            console.log(`[DivisionConfigService] Discovery complete for ${division.code}: Unique=${results.length}`);
            
            // Apply filtering for virtual divisions vs real divisions
            if (division.type === 'virtual') {
                 const filtered = results.filter(g => {
                    const code = g.gang_code.toUpperCase();
                    const desc = g.description.toUpperCase();
                    if (this.isGangExcludedFromDivision(division.code, code)) return false;
                    return (division.gangPattern?.test(code)) || (division.descriptionPattern?.test(desc));
                });
                if (filtered.length > 0) {
                    return filtered.sort((a, b) => a.gang_code.localeCompare(b.gang_code));
                }
                return this.getStaticVirtualGangFallback(division);
            } else {
                // REAL DIVISION: Clean up by excluding virtual division gangs
                // Get all virtual division definitions
                const virtualDivs = Array.from(this.divisions.values()).filter(d => d.type === 'virtual');
                
                // Excluded keywords specifically requested by user
                const excludedKeywords = ['INFRA', 'WORKSHOP', 'NURSERY', 'MEC', 'MECHANIC', 'PKS', 'MILL', 'TRAKSI'];

                return results.filter(g => {
                    const code = g.gang_code.toUpperCase();
                    const desc = g.description.toUpperCase();
                    if (this.isGangExcludedFromDivision(division.code, code)) return false;

                    // 1. Check against virtual patterns (codes & descriptions)
                    const isMatchedByVirtualPattern = virtualDivs.some(v => 
                        (v.gangPattern?.test(code)) || (v.descriptionPattern?.test(desc))
                    );
                    if (isMatchedByVirtualPattern) return false;

                    // 2. Check against explicit excluded keywords in description
                    const hasExcludedKeyword = excludedKeywords.some(kw => desc.includes(kw));
                    if (hasExcludedKeyword) return false;

                    return true;
                }).sort((a, b) => a.gang_code.localeCompare(b.gang_code));
            }
        } catch (e: any) {
            console.error(`[DivisionConfigService] Discovery failed for ${division.code}:`, e);
            if (division.type === "virtual") {
                return this.getStaticVirtualGangFallback(division);
            }
            return [];
        }
    }

    private getStaticVirtualGangFallback(division: DivisionDefinition): GangInfo[] {
        const sourceLocCode = division.sourceDivision || "";
        const fallbackGangMap: Record<string, string[]> = {
            INF: ["INF", "INT"],
            NRS: ["B2N"],
            WKS_AR: ["HMC"],
            WKS_PG: ["AMC"],
            WORKSHOP: ["AMC", "HMC"]
        };

        return (fallbackGangMap[division.code] || []).map((gangCode) => ({
            gang_code: gangCode,
            description: gangCode,
            loc_code: sourceLocCode,
            division_code: division.code
        }));
    }

    /**
     * Build SQL WHERE clause for division filtering
     * Returns parameterized query part and params
     * Includes BOTH the canonical code AND all aliases for complete coverage
     */
    public buildDivisionWhereClause(
        divisionCode: string,
        columnName: string = 'division_code'
    ): { sql: string; params: string[] } {
        if (!divisionCode || divisionCode === 'ALL') {
            return { sql: '', params: [] };
        }

        // Get the canonical code first
        const canonical = this.resolveCode(divisionCode);
        const aliases = this.getAliases(divisionCode);

        // Combine canonical + aliases, removing duplicates
        const allCodes = new Set<string>([canonical]);
        for (const alias of aliases) {
            if (alias && alias.trim().length > 0 && alias.toUpperCase() !== canonical.toUpperCase()) {
                allCodes.add(alias);
            }
        }

        const validAliases = Array.from(allCodes);

        if (validAliases.length === 0) {
            return { sql: '', params: [] };
        }

        const placeholders = validAliases.map(() => '?').join(',');
        return {
            sql: ` AND ${columnName} IN (${placeholders})`,
            params: validAliases
        };
    }

    /**
     * Get SQL exclusion clause to block ALL virtual division gangs
     * This is used to "clean" real division reports by forcefully excluding
     * gangs that match virtual patterns or keywords.
     */
    public getVirtualExclusionSQL(): string {
        const virtualDivs = Array.from(this.divisions.values()).filter(d => d.type === 'virtual');
        
        // Combine all explicit gang patterns if they are simple enough for SQL LIKE
        const explicitGangs = ['IN%', 'INT%', 'AMC%', 'HMC%', 'B2N%', 'M%'];
        const gangExcludeStr = ["'INF'", "'INT'", "'AMC'", "'HMC'", "'B2N'"].join(',');
        const gangLikeStr = explicitGangs.map(g => `gl.GangCode LIKE '${g.toUpperCase()}'`).join(' OR ');
        
        // Final logic: Exclude if it's in the list OR matches the LIKE patterns
        const excludeLogic = `(gl.GangCode IN (${gangExcludeStr}) OR ${gangLikeStr})`;

        // [USER SPECIFIC] Exclude based on descriptions strictly requested
        const descExcludeKeywords = ['INFRA', 'WORKSHOP', 'NURSERY', 'MEC', 'MECHANIC', 'PKS', 'MILL', 'TRAKSI'];
        const descLikeStr = descExcludeKeywords.map(kw => `COALESCE(g.Description, '') LIKE '%${kw}%'`).join(' OR ');

        // Final result: exclude anything that matches the explicit virtual codes OR the description patterns
        return ` AND NOT (${excludeLogic} OR ${descLikeStr === '' ? '1=0' : descLikeStr})`;
    }

    /**
     * Get all divisions as a structured object for API responses
     */
    public getAllDivisionsForAPI(): {
        code: string;
        name: string;
        type: string;
        aliases: string[];
        description?: string;
    }[] {
        return Array.from(this.divisions.values()).map(d => ({
            code: d.code,
            name: d.name,
            type: d.type,
            aliases: d.aliases,
            description: d.description
        }));
    }
}

/**
 * Singleton instance
 */
export const divisionConfigService = DivisionConfigService.getInstance();
