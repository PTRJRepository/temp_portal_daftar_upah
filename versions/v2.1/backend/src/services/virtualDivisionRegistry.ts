/**
 * ============================================================================================
 * VIRTUAL DIVISION SYSTEM - Modular Plugin Architecture
 * ============================================================================================
 *
 * PURPOSE:
 * Sistem ini menyediakan cara modular dan terpusat untuk mendefinisikan virtual divisions.
 * Virtual divisions adalah divisi "pseudo" yang terdiri dari gang-gang nyata yang dikelompokkan
 * berdasarkan kriteria tertentu ( Nurseries, Workshop, Infrastructure, dll).
 *
 * ARCHITECTURE:
 * 1. VirtualDivisionPlugin - Interface/plugin untuk setiap virtual division
 * 2. VirtualDivisionRegistry - Registry pusat yang mengelola semua plugin
 * 3. DivisionDefinition - Wrapper backward-compatible untuk kode yang sudah ada
 *
 * HOW TO ADD NEW VIRTUAL DIVISION:
 * 1. Buat class baru yang mengimplementasi VirtualDivisionPlugin
 * 2. Register ke VirtualDivisionRegistry dengan nama unik
 * 3. DivisionDefinition akan otomatis menyertakan divisi baru di dropdown
 *
 * AI INDEXING TAGS:
 * - virtual-divisions
 * - plugin-architecture
 * - modular-system
 * - division-mapping
 * - payroll-system
 * ============================================================================================
 */

import { Database } from "../db/client";

/**
 * Interface yang HARUS diimplementasikan oleh setiap virtual division plugin.
 * Setiap virtual division harus mendefinisikan:
 * - Kode unik (misal: 'INF', 'NRS', 'WKS_PG')
 * - Nama display (misal: 'Infrastruktur', 'Nursery')
 * - Source division (divisi sumber data)
 * - Pattern untuk mencocokkan gang
 * - Behavior khusus (exclude dari source, dll)
 */
export interface VirtualDivisionPlugin {
    /** Kode unik virtual division (misal: 'INF', 'NRS') */
    readonly code: string;

    /** Nama lengkap untuk display (misal: 'Infrastruktur') */
    readonly name: string;

    /** Divisi sumber (misal: 'P1A', 'P1B', 'AB2'). Null jika tidak ada sumber tunggal. */
    readonly sourceDivision: string | null;

    /** Regex pattern untuk mencocokkan kode gang (misal: '^IN' untuk Infrastruktur) */
    readonly gangPattern: RegExp | null;

    /** Regex pattern untuk mencocokkan deskripsi gang */
    readonly descriptionPattern: RegExp | null;

    /** Apakah gang yang match harus di-exclude dari divisi sumber */
    readonly excludeFromSource: boolean;

    /** Deskripsi lengkap untuk dokumentasi */
    readonly description: string;

    /**
     * Method opsional untuk validasi custom logic.
     * Returns true jika gang termasuk dalam virtual division ini.
     */
    matchesGang?(gangCode: string, description: string, sourceLocCode: string): boolean;

    /**
     * Method opsional untuk mendapatkan gang prefix yang digunakan.
     * Berguna untuk filtering query.
     */
    getGangPrefix?(): string | null;
}

/**
 * Registry pusat untuk semua virtual division plugins.
 * Singleton pattern untuk memastikan satu instance di aplikasi.
 *
 * SERVICES YANG BISA MENGGUNAKAN:
 * - taxReportService: Untuk resolve virtual division ke real division
 * - summaryService: Untuk agregasi data per virtual division
 * - otherIncomesService: Untuk filtering THR per virtual division
 * - historyDatabaseService: Untuk query data berdasarkan virtual division
 * - wagesService: Untuk laporan wages per virtual division
 */
export class VirtualDivisionRegistry {
    private static instance: VirtualDivisionRegistry;

    /** Map untuk menyimpan plugin berdasarkan kode */
    private plugins: Map<string, VirtualDivisionPlugin> = new Map();

    /** Map untuk alias (misal: INFRA -> INF) */
    private aliases: Map<string, string> = new Map();

    /** Urutan display untuk virtual divisions */
    private displayOrder: string[] = [];

    private constructor() {
        this.registerBuiltInDivisions();
    }

    /**
     * Mendapatkan instance singleton.
     * Usage: const registry = VirtualDivisionRegistry.getInstance();
     */
    public static getInstance(): VirtualDivisionRegistry {
        if (!VirtualDivisionRegistry.instance) {
            VirtualDivisionRegistry.instance = new VirtualDivisionRegistry();
        }
        return VirtualDivisionRegistry.instance;
    }

    /**
     * Register plugin baru ke registry.
     * Usage: registry.register(myCustomDivision);
     *
     * @param plugin - Instance plugin yang mengimplementasi VirtualDivisionPlugin
     * @throws Error jika kode sudah terdaftar
     */
    public register(plugin: VirtualDivisionPlugin): void {
        if (this.plugins.has(plugin.code)) {
            console.warn(`[VirtualDivisionRegistry] Plugin ${plugin.code} sudah terdaftar, akan di-replace`);
        }
        this.plugins.set(plugin.code, plugin);
        this.displayOrder.push(plugin.code);
        console.log(`[VirtualDivisionRegistry] Registered: ${plugin.code} - ${plugin.name}`);
    }

    /**
     * Menambahkan alias untuk kode division.
     * Usage: registry.addAlias('INFRA', 'INF');
     *
     * @param alias - Alias (misal: 'INFRA')
     * @param code - Kode actual (misal: 'INF')
     */
    public addAlias(alias: string, code: string): void {
        this.aliases.set(alias.toUpperCase(), code.toUpperCase());
    }

    /**
     * Resolve kode/alias ke kode actual.
     * Usage: const actual = registry.resolveCode('INFRA'); // returns 'INF'
     */
    public resolveCode(code: string): string {
        const upper = code.trim().toUpperCase();
        return this.aliases.get(upper) || upper;
    }

    /**
     * Mendapatkan plugin berdasarkan kode (termasuk alias).
     * Usage: const plugin = registry.getPlugin('INF');
     */
    public getPlugin(code: string): VirtualDivisionPlugin | undefined {
        const resolved = this.resolveCode(code);
        return this.plugins.get(resolved);
    }

    /**
     * Mendapatkan semua plugin yang terdaftar.
     * Usage: const all = registry.getAllPlugins();
     */
    public getAllPlugins(): VirtualDivisionPlugin[] {
        return this.displayOrder.map(code => this.plugins.get(code)!).filter(Boolean);
    }

    /**
     * Mendapatkan kode semua virtual divisions.
     * Usage: const codes = registry.getAllCodes();
     */
    public getAllCodes(): string[] {
        return [...this.displayOrder];
    }

    /**
     * Mendapatkan Urutan display.
     * Usage: const order = registry.getDisplayOrder();
     */
    public getDisplayOrder(): string[] {
        return [...this.displayOrder];
    }

    /**
     * Mengecek apakah kode adalah virtual division.
     * Usage: const isVirtual = registry.isVirtualDivision('INF');
     */
    public isVirtualDivision(code: string): boolean {
        const resolved = this.resolveCode(code);
        return this.plugins.has(resolved);
    }

    /**
     * Mendapatkan semua source divisions untuk sebuah virtual division.
     * Jika virtual division memiliki sourceDivision spesifik, return itu.
     * Jika null, berarti ini adalah "aggregate" division (gabungan dari beberapa source).
     *
     * Usage: const sources = registry.getSourceDivisions('WKS_PG'); // returns ['P1A']
     */
    public getSourceDivisions(code: string): string[] {
        const plugin = this.getPlugin(code);
        if (!plugin) return [code];

        if (plugin.sourceDivision) {
            return [plugin.sourceDivision];
        }

        // Untuk aggregate divisions, kita perlu mendapatkan source dari matched gangs
        // Ini akan di-handle oleh DivisionDefinition yang memiliki akses ke database
        return [];
    }

    /**
     * Mencocokkan gang ke virtual division.
     * Iterasi semua plugin dan return yang pertama cocok.
     *
     * Usage: const virtDiv = registry.matchGang('IN01', 'Infrastruktur Afdeling 1', 'P1A');
     *
     * @param gangCode - Kode gang (misal: 'IN01')
     * @param description - Deskripsi gang (misal: 'Infrastruktur Afdeling 1')
     * @param sourceLocCode - Kode divisi sumber (misal: 'P1A')
     * @returns Kode virtual division atau null jika tidak cocok
     */
    public matchGang(gangCode: string, description: string, sourceLocCode: string): string | null {
        const gc = gangCode.trim().toUpperCase();
        const desc = description.trim().toUpperCase();
        
        // Import dynamic to avoid circular dependency if needed, but since we are in the same package
        // we should use a shared normalization if possible.
        // For now, let's normalize manually or use a simple mapping.
        const source = sourceLocCode.trim().toUpperCase();

        for (const plugin of this.plugins.values()) {
            // Check custom matches method first
            if (plugin.matchesGang && plugin.matchesGang(gc, desc, source)) {
                return plugin.code;
            }

            // Check source division match with normalization
            if (plugin.sourceDivision) {
                const pluginSource = plugin.sourceDivision.toUpperCase();
                // Match if direct match OR if normalized codes match
                // We'll consider a match if source starts with pluginSource (e.g. P1A matches PG1A in some contexts)
                // or if they are both aliases of the same canonical.
                // Since DivisionConfigService is the source of truth, we should ideally use it.
                if (pluginSource !== source) {
                    // Simple normalization for common cases
                    const normSource = source.replace(/^PG/, 'P'); // PG1A -> P1A
                    const normPluginSource = pluginSource.replace(/^PG/, 'P');
                    
                    if (normSource !== normPluginSource) {
                        continue;
                    }
                }
            }

            // Check gang pattern
            if (plugin.gangPattern && plugin.gangPattern.test(gc)) {
                return plugin.code;
            }

            // Check description pattern
            if (plugin.descriptionPattern && plugin.descriptionPattern.test(desc)) {
                return plugin.code;
            }
        }

        return null;
    }

    /**
     * Mencocokkan gang berdasarkan pattern saja (tanpa validasi source).
     * Fallback method untuk kasus dimana gang tidak ditemukan di gangDivMap.
     *
     * Usage: const virtDiv = registry.matchGangByPatternOnly('IN01', 'Infrastruktur');
     */
    public matchGangByPatternOnly(gangCode: string, description: string): string | null {
        const gc = gangCode.trim().toUpperCase();
        const desc = description.trim().toUpperCase();

        for (const [code, plugin] of this.plugins.entries()) {
            // Skip aggregate-only divisions
            if (code === 'WORKSHOP') continue;

            // Check gang pattern
            if (plugin.gangPattern && plugin.gangPattern.test(gc)) {
                return code;
            }

            // Check description pattern
            if (plugin.descriptionPattern && plugin.descriptionPattern.test(desc)) {
                return code;
            }
        }

        return null;
    }

    /**
     * Mendapatkan config lengkap untuk virtual division.
     * Digunakan untuk backward compatibility dengan DivisionDefinition.
     */
    public getConfig(code: string): VirtualDivisionPlugin | undefined {
        return this.getPlugin(code);
    }

    /**
     * Mendapatkan nama virtual division.
     * Usage: const name = registry.getName('INF'); // returns 'Infrastruktur'
     */
    public getName(code: string): string {
        const plugin = this.getPlugin(code);
        return plugin?.name || code;
    }

    // ============================================================================
    // BUILT-IN VIRTUAL DIVISIONS
    // ============================================================================

    /** Register semua virtual divisions bawaan */
    private registerBuiltInDivisions(): void {
        // INF: Infrastruktur - Gang INF dan INT dari P1A
        this.register({
            code: 'INF',
            name: 'Infrastruktur',
            sourceDivision: 'P1A',
            gangPattern: /^IN(?:F|T)$/i,
            descriptionPattern: null,
            excludeFromSource: true,
            description: 'Divisi Infrastruktur - Gang INF dan INT'
        });

        // NRS: Nursery - Gang B2N
        this.register({
            code: 'NRS',
            name: 'Nursery',
            sourceDivision: 'P1B',
            gangPattern: /^B2N$/i,
            descriptionPattern: null,
            excludeFromSource: true,
            description: 'Divisi Nursery - Gang B2N'
        });

        // WKS_PG: Workshop Parit Gunung
        this.register({
            code: 'WKS_PG',
            name: 'Workshop Parit Gunung (PGE)',
            sourceDivision: 'P1A',
            gangPattern: /^AMC$/i,
            descriptionPattern: /workshop.*(parit|pge|p\.g|harapan\s*mukti)/i,
            excludeFromSource: true,
            description: 'Divisi Workshop Parit Gunung'
        });

        // WKS_AR: Workshop Air Ruak
        this.register({
            code: 'WKS_AR',
            name: 'Workshop Air Ruak (AB2)',
            sourceDivision: 'AB2',
            gangPattern: /^HMC$/i,
            descriptionPattern: /workshop.*(air\s*ruak|are|a\.r)|.*traksi.*air\s*ruak/i,
            excludeFromSource: true,
            description: 'Divisi Workshop Air Ruak'
        });

        // WORKSHOP: Gabungan Workshop (Aggregate)
        this.register({
            code: 'WORKSHOP',
            name: 'Workshop All',
            sourceDivision: null,
            gangPattern: null,
            descriptionPattern: /workshop.*(parit|pge|p\.g|air\s*ruak|are|a\.r)|.*traksi.*air\s*ruak/i,
            excludeFromSource: false,
            description: 'Gabungan Workshop Parit Gunung dan Air Ruak'
        });

        // ARC: Air Ruak Central
        this.register({
            code: 'ARC',
            name: 'Air Ruak Central',
            sourceDivision: 'ARC',
            gangPattern: /^J/i,
            descriptionPattern: null,
            excludeFromSource: false,
            description: 'Divisi Air Ruak Central - Gang J'
        });

        // MILL: Palm Oil Mill
        this.register({
            code: 'MILL',
            name: 'Palm Oil Mill',
            sourceDivision: null,
            gangPattern: /^M/i,
            descriptionPattern: null,
            excludeFromSource: true,
            description: 'Divisi Pabrik (Mill) - Gang yang dimulai dengan M'
        });

        // Register aliases
        this.addAlias('INFRA', 'INF');
        this.addAlias('NURSERY', 'NRS');
        this.addAlias('AREC', 'ARC');
        this.addAlias('WORKSHOP_AR', 'WKS_AR');
        this.addAlias('WORKSHOP AR', 'WKS_AR');
        this.addAlias('WKS AR', 'WKS_AR');
        this.addAlias('HMC', 'WKS_AR');
        this.addAlias('WORKSHOP_PG', 'WKS_PG');
        this.addAlias('WORKSHOP PG', 'WKS_PG');
        this.addAlias('WKS PG', 'WKS_PG');
        this.addAlias('AMC', 'WKS_PG');
    }
}

// Export singleton instance
export const virtualDivisionRegistry = VirtualDivisionRegistry.getInstance();
