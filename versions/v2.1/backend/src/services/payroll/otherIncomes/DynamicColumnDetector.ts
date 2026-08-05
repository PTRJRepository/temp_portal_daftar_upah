/**
 * DynamicColumnDetector - Detect and Parse Dynamic Income Columns
 *
 * Parses DocDesc patterns from PR_ADTRANS to detect dynamic income columns.
 * These are columns where the header name comes from the DocDesc itself.
 *
 * For example:
 * - DocDesc = "PREMI PANEN BRONDOL" → column header = "PREMI PANEN BRONDOL"
 * - DocDesc = "BONUS PERFORMANCE" → column header = "BONUS PERFORMANCE"
 *
 * @module payroll/otherIncomes/DynamicColumnDetector
 */

/**
 * Detected dynamic column
 */
export interface DynamicColumn {
    /** Original DocDesc value */
    doc_desc: string;
    /** Normalized column key */
    column_key: string;
    /** Display title for headers */
    display_title: string;
    /** Income category */
    category: 'THR' | 'Bonus' | 'Custom' | 'KONTAN';
    /** Whether this column is taxable */
    is_taxable: boolean;
}

/**
 * DocDesc parsing patterns
 */
const PATTERNS = {
    // THR patterns
    THR: [
        /^THR\s*/i,
        /TUNJANGAN\s*HAR[iY]\s*RAYA/i,
        /GAJI\s*THR/i,
        /THR\s*GAJI/i
    ],
    // Bonus patterns
    Bonus: [
        /^BONUS/i,
        /INSENTIF/i,
        /PERFORMANCE/i
    ],
    // KONTAN patterns (cash)
    KONTAN: [
        /KONTAN/i,
        /TUNAI/i,
        /CASH/i
    ]
};

/**
 * Normalize DocDesc to column key
 *
 * Transforms DocDesc to a safe column key:
 * - Uppercase
 * - Remove special characters
 * - Replace spaces with underscores
 * - Remove extra whitespace
 */
export function normalizeDocDesc(docDesc: string | null): string {
    if (!docDesc) return 'UNKNOWN';

    return docDesc
        .trim()
        .toUpperCase()
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 50); // Limit length
}

/**
 * Get display title from DocDesc
 *
 * Returns a cleaner version for display in UI:
 * - Preserves case for readability
 * - Removes redundant prefixes
 */
export function getDisplayTitle(docDesc: string | null): string {
    if (!docDesc) return 'Unknown';

    return docDesc.trim();
}

/**
 * Detect income category from DocDesc
 */
export function detectCategory(docDesc: string | null): 'THR' | 'Bonus' | 'Custom' | 'KONTAN' {
    if (!docDesc) return 'Custom';

    const upper = docDesc.toUpperCase();

    // Check THR patterns
    for (const pattern of PATTERNS.THR) {
        if (pattern.test(upper)) return 'THR';
    }

    // Check Bonus patterns
    for (const pattern of PATTERNS.Bonus) {
        if (pattern.test(upper)) return 'Bonus';
    }

    // Check KONTAN patterns
    for (const pattern of PATTERNS.KONTAN) {
        if (pattern.test(upper)) return 'KONTAN';
    }

    return 'Custom';
}

/**
 * DynamicColumnDetector - Detect and parse dynamic columns from DocDesc
 *
 * Scans DocDesc values to find unique dynamic income columns.
 * Each unique DocDesc becomes a potential column header.
 */
export class DynamicColumnDetector {
    /**
     * Detect unique columns from DocDesc values
     *
     * Takes an array of DocDesc values and extracts unique column definitions.
     *
     * @param docDescs - Array of DocDesc strings
     * @returns Array of unique DynamicColumn definitions
     *
     * @example
     * const detector = new DynamicColumnDetector();
     * const columns = detector.detectColumns([
     *   'PREMI PANEN BRONDOL',
     *   'BONUS PERFORMANCE',
     *   'PREMI PANEN BRONDOL'
     * ]);
     * // Returns: [{ doc_desc: 'PREMI PANEN BRONDOL', column_key: 'PREMI_PANEN_BRONDOL', ... }]
     */
    detectColumns(docDescs: (string | null)[]): DynamicColumn[] {
        const uniqueMap = new Map<string, DynamicColumn>();

        for (const docDesc of docDescs) {
            if (!docDesc || !docDesc.trim()) continue;

            const normalized = normalizeDocDesc(docDesc);

            if (!uniqueMap.has(normalized)) {
                uniqueMap.set(normalized, {
                    doc_desc: docDesc,
                    column_key: normalized,
                    display_title: getDisplayTitle(docDesc),
                    category: detectCategory(docDesc),
                    is_taxable: detectCategory(docDesc) !== 'KONTAN'
                });
            }
        }

        return Array.from(uniqueMap.values());
    }

    /**
     * Detect columns with aggregation amounts
     *
     * Groups DocDesc values and calculates totals per column.
     *
     * @param docDescs - Array of DocDesc strings
     * @param amounts - Corresponding amounts
     * @returns Map of column_key → total amount
     */
    detectColumnsWithAmounts(
        docDescs: (string | null)[],
        amounts: number[]
    ): Map<string, number> {
        const columnTotals = new Map<string, number>();

        for (let i = 0; i < docDescs.length; i++) {
            const docDesc = docDescs[i];
            const amount = amounts[i] || 0;

            if (!docDesc) continue;

            const key = normalizeDocDesc(docDesc);
            const current = columnTotals.get(key) || 0;
            columnTotals.set(key, current + amount);
        }

        return columnTotals;
    }

    /**
     * Build title map from detected columns
     *
     * Creates a mapping from column_key → display_title for header rendering.
     *
     * @param columns - Detected columns
     * @returns Record of column_key → display_title
     */
    buildTitleMap(columns: DynamicColumn[]): Record<string, string> {
        const titleMap: Record<string, string> = {};

        for (const col of columns) {
            titleMap[col.column_key] = col.display_title;
        }

        return titleMap;
    }

    /**
     * Filter columns by category
     *
     * @param columns - Detected columns
     * @param category - Category to filter by
     * @returns Filtered columns
     */
    filterByCategory(columns: DynamicColumn[], category: 'THR' | 'Bonus' | 'Custom' | 'KONTAN'): DynamicColumn[] {
        return columns.filter(col => col.category === category);
    }
}

// Singleton instance
let instance: DynamicColumnDetector | null = null;

export function getDynamicColumnDetector(): DynamicColumnDetector {
    if (!instance) {
        instance = new DynamicColumnDetector();
    }
    return instance;
}
