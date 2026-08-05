/**
 * Payroll Normalization Service
 *
 * Centralized service for normalizing payroll component names.
 * Provides:
 * - Premi name normalization
 * - Potongan name normalization
 * - Category classification
 *
 * This service ensures consistent naming across all services.
 */

/**
 * Normalized premi result
 */
export interface NormalizedPremi {
    originalDocDesc: string;
    normalizedKey: string;
    displayName: string;
    category: PremiCategory;
}

/**
 * Premi category enumeration
 */
export type PremiCategory =
    | 'PREMI_PANEN'
    | 'PREMI_KINERJA'
    | 'PREMI_BRONDOL'
    | 'PREMI_INSENTIF'
    | 'PREMI_PRUNING'
    | 'PREMI_LAIN';

/**
 * Normalized potongan result
 */
export interface NormalizedPotongan {
    originalDocDesc: string;
    normalizedKey: string;
    displayName: string;
    category: PotonganCategory;
}

/**
 * Potongan category enumeration
 */
export type PotonganCategory =
    | 'PPH21'
    | 'BPJS_KESEHATAN'
    | 'BPJS_PENSIUN'
    | 'SPSI'
    | 'KOREKSI'
    | 'PINJAMAN'
    | 'LAIN';

/**
 * Payroll Normalization Service - Single Source of Truth for Name Normalization
 */
export class PayrollNormalizationService {
    private static instance: PayrollNormalizationService;

    // Premi exclusion patterns (from CLAUDE.md)
    private static readonly PREMI_EXCLUDE_PATTERNS = [
        'PPH', 'PPH21', 'PPH 21',
        'LEMBUR',
        'PRUN', 'PRUNING',
        'KOREKSI', 'KOREKSI PANEN', 'POTONGAN KOREKSI',
        'SPSI',
        'TUNJANGAN JABATAN', 'TUNJANGAN MASA KERJA',
        'TUNJANGAN BERAS',
        'BRONDOL' // BRONDOL goes to static column
    ];

    // Potongan exclusion patterns (from CLAUDE.md)
    private static readonly POTONGAN_EXCLUDE_PATTERNS = [
        'POT%',
        'SPSI',
        'BERAS',
        'JABATAN',
        'MASA',
        'LEMBUR',
        'PPH%' // Broader than just PPH21
    ];

    private constructor() {}

    public static getInstance(): PayrollNormalizationService {
        if (!PayrollNormalizationService.instance) {
            PayrollNormalizationService.instance = new PayrollNormalizationService();
        }
        return PayrollNormalizationService.instance;
    }

    /**
     * Normalize premi DocDesc to standard key
     */
    public normalizePremi(docDesc: string): NormalizedPremi {
        const original = docDesc.trim();
        const upper = original.toUpperCase();

        // Determine category first
        let category: PremiCategory = 'PREMI_LAIN';
        if (upper.includes('PANEN') || upper.includes(' AL ')) {
            category = 'PREMI_PANEN';
        } else if (upper.includes('KINERJA')) {
            category = 'PREMI_KINERJA';
        } else if (upper.includes('BRONDOL')) {
            category = 'PREMI_BRONDOL';
        } else if (upper.includes('INSENTIF')) {
            category = 'PREMI_INSENTIF';
        } else if (upper.includes('PRUN') || upper.includes('PRUNING')) {
            category = 'PREMI_PRUNING';
        }

        // Remove prefixes to get clean name
        let name = upper;
        const prefixes = ['TUNJANGAN PREMI', 'TUNJANGAN', 'PREMI'];
        for (const prefix of prefixes) {
            if (name.startsWith(prefix)) {
                name = name.slice(prefix.length).trim();
                break;
            }
        }

        // Handle special cases
        if (upper.includes('KOREKSI')) {
            category = 'PREMI_LAIN';
            name = 'KOREKSI';
        } else if (upper.includes('BRONDOL')) {
            category = 'PREMI_BRONDOL';
            name = 'BRONDOL';
        }

        // Convert to snake_case
        const normalizedKey = `premi_${name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_')}`;
        const displayName = this.extractDisplayName(original);

        return {
            originalDocDesc: original,
            normalizedKey,
            displayName,
            category
        };
    }

    /**
     * Normalize potongan DocDesc to standard key
     */
    public normalizePotongan(
        docDesc: string,
        taskDesc?: string | null,
        taskCode?: string | null
    ): NormalizedPotongan {
        const original = docDesc.trim();
        const upper = original.toUpperCase();

        // Determine category
        let category: PotonganCategory;
        if (upper.includes('PPH') && !upper.includes('PREMI')) {
            category = 'PPH21';
        } else if (upper.includes('BPJS') && upper.includes('KESEHATAN')) {
            category = 'BPJS_KESEHATAN';
        } else if (upper.includes('BPJS') && upper.includes('PENSIUN')) {
            category = 'BPJS_PENSIUN';
        } else if (upper.includes('SPSI')) {
            category = 'SPSI';
        } else if (upper.includes('KOREKSI')) {
            category = 'KOREKSI';
        } else if (upper.includes('PINJAM')) {
            category = 'PINJAMAN';
        } else {
            category = 'LAIN';
        }

        const normalizedKey = `potongan_${category.toLowerCase()}`;
        const displayName = taskDesc || taskCode || original;

        return {
            originalDocDesc: original,
            normalizedKey,
            displayName,
            category
        };
    }

    /**
     * Check if DocDesc should be excluded from premi
     */
    public isExcludedFromPremi(docDesc: string): boolean {
        const upper = docDesc.toUpperCase();

        for (const pattern of PayrollNormalizationService.PREMI_EXCLUDE_PATTERNS) {
            if (pattern.includes('%')) {
                // Handle wildcard patterns
                const regex = new RegExp(pattern.replace('%', '.*'), 'i');
                if (regex.test(upper)) return true;
            } else if (upper.includes(pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if DocDesc should be excluded from potongan
     */
    public isExcludedFromPotongan(docDesc: string): boolean {
        const upper = docDesc.toUpperCase();

        for (const pattern of PayrollNormalizationService.POTONGAN_EXCLUDE_PATTERNS) {
            if (pattern.includes('%')) {
                // Handle wildcard patterns
                const regex = new RegExp(pattern.replace('%', '.*'), 'i');
                if (regex.test(upper)) return true;
            } else if (upper.includes(pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Batch normalize premi descriptions
     */
    public normalizePremiBatch(docDescs: string[]): NormalizedPremi[] {
        return docDescs.map(docDesc => this.normalizePremi(docDesc));
    }

    /**
     * Batch normalize potongan descriptions
     */
    public normalizePotonganBatch(items: Array<{
        docDesc: string;
        taskDesc?: string | null;
        taskCode?: string | null;
    }>): NormalizedPotongan[] {
        return items.map(item => this.normalizePotongan(item.docDesc, item.taskDesc, item.taskCode));
    }

    /**
     * Extract clean display name
     */
    private extractDisplayName(original: string): string {
        return original
            .replace(/^(TUNJANGAN|PREMI)\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Get all premi categories
     */
    public getPremiCategories(): PremiCategory[] {
        return [
            'PREMI_PANEN',
            'PREMI_KINERJA',
            'PREMI_BRONDOL',
            'PREMI_INSENTIF',
            'PREMI_PRUNING',
            'PREMI_LAIN'
        ];
    }

    /**
     * Get all potongan categories
     */
    public getPotonganCategories(): PotonganCategory[] {
        return [
            'PPH21',
            'BPJS_KESEHATAN',
            'BPJS_PENSIUN',
            'SPSI',
            'KOREKSI',
            'PINJAMAN',
            'LAIN'
        ];
    }
}

// Export singleton instance
export const payrollNormalizationService = PayrollNormalizationService.getInstance();
