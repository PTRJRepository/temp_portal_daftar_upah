/**
 * FormulaRegistry for Payroll System
 *
 * Provides column definitions, formula information, and cell address utilities
 * for the AG-Grid payroll system.
 */

/**
 * Convert column ID and row index to Excel-style cell address
 * @param {string} colId - Column identifier
 * @param {number} rowIndex - Row index (0-based)
 * @returns {string} Excel-style cell address (e.g., "A1", "B2")
 */
export const getCellAddress = (colId, rowIndex) => {
    if (!colId || rowIndex === null || rowIndex === undefined) {
        return '';
    }

    // Simple column to letter conversion for basic columns
    // This is a simplified version - expand as needed for complex column mappings
    const columnLetters = {
        'no': 'A',
        'nama': 'B',
        'nik': 'C',
        'jabatan': 'D',
        'gang': 'E',
        'gaji_pokok': 'F',
        'total_tunjangan': 'G',
        'upah_kotor': 'H',
        'total_premi': 'I',
        'upah_bersih': 'J'
    };

    // For dynamic columns with dots, use the field name after the last dot
    const fieldName = colId.includes('.') ? colId.split('.').pop() : colId;

    // Try to get column letter, fallback to first letter of field name
    let columnLetter = columnLetters[fieldName] || fieldName.charAt(0).toUpperCase();

    // Convert 0-based index to 1-based row number
    const rowNumber = rowIndex + 1;

    return `${columnLetter}${rowNumber}`;
};

/**
 * Column definitions with formula information
 * Maps column IDs to their metadata including input dependencies
 */
export const FormulaRegistry = {
    // Basic information columns
    'no': {
        label: 'No',
        type: 'number',
        inputs: []
    },
    'nama': {
        label: 'Nama',
        type: 'text',
        inputs: []
    },
    'nik': {
        label: 'NIK',
        type: 'text',
        inputs: []
    },
    'jabatan': {
        label: 'Jabatan',
        type: 'text',
        inputs: []
    },
    'gang': {
        label: 'Gang',
        type: 'text',
        inputs: []
    },

    // Salary calculation columns with their inputs
    'gaji_pokok': {
        label: 'Gaji Pokok',
        type: 'currency',
        inputs: []
    },

    // Tunjangan components
    'beras_jumlah': {
        label: 'Tunjangan Beras',
        type: 'currency',
        inputs: ['beras_rate', 'jumlah_hk'],
        formula: 'beras_rate × jumlah_hk'
    },
    'jabatan_jumlah': {
        label: 'Tunjangan Jabatan',
        type: 'currency',
        inputs: ['jabatan_rate', 'masa_kerja_tahun']
    },
    'masa_kerja_jumlah': {
        label: 'Tunjangan Masa Kerja',
        type: 'currency',
        inputs: ['masa_kerja_tahun', 'masa_kerja_rate']
    },
    'lembur_jam': {
        label: 'Jam Lembur',
        type: 'number',
        inputs: []
    },
    'lembur_jumlah': {
        label: 'Jumlah Lembur',
        type: 'currency',
        inputs: ['lembur_jam', 'lembur_rate']
    },

    // Calculated columns
    'total_tunjangan': {
        label: 'Total Tunjangan',
        type: 'currency',
        inputs: ['beras_jumlah', 'jabatan_jumlah', 'masa_kerja_jumlah', 'lembur_jumlah'],
        formula: 'SUM(beras_jumlah, jabatan_jumlah, masa_kerja_jumlah, lembur_jumlah)'
    },

    'upah_kotor': {
        label: 'Upah Kotor',
        type: 'currency',
        inputs: ['gaji_pokok', 'total_tunjangan'],
        formula: 'gaji_pokok + total_tunjangan'
    },

    // Dynamic premi columns
    'premi_brondol': {
        label: 'Premi Brondol',
        type: 'currency',
        inputs: []
    },
    'premi_harvesting': {
        label: 'TUNJANGAN PREMI HARVESTING',
        type: 'currency',
        inputs: []
    },
    'premi_pruning': {
        label: 'TUNJANGAN PREMI PRUNING',
        type: 'currency',
        inputs: []
    },
    'premi_panen': {
        label: 'PREMI PANEN',
        type: 'currency',
        inputs: []
    },

    'total_premi': {
        label: 'Total Premi',
        type: 'currency',
        inputs: ['premi_*'],
        formula: 'SUM(premi_*)'
    },

    'upah_bersih': {
        label: 'Upah Bersih',
        type: 'currency',
        inputs: ['upah_kotor', 'total_premi', 'total_potongan'],
        // Guardrail: if total_potongan is exported/rendered as signed negative,
        // formulas must ADD it. Never build -(-potongan) formulas.
        formula: 'upah_kotor + total_premi + signed_total_potongan'
    }
};

/**
 * Get column metadata by field ID
 * @param {string} fieldId - Field identifier
 * @returns {Object|null} Column metadata or null if not found
 */
export const getColumnMetadata = (fieldId) => {
    return FormulaRegistry[fieldId] || null;
};

/**
 * Check if a column is calculated based on other columns
 * @param {string} fieldId - Field identifier
 * @returns {boolean} True if column is calculated
 */
export const isCalculatedColumn = (fieldId) => {
    const metadata = FormulaRegistry[fieldId];
    return metadata && metadata.inputs && metadata.inputs.length > 0;
};

/**
 * Get input columns for a calculated field
 * @param {string} fieldId - Field identifier
 * @returns {Array} Array of input field IDs
 */
export const getInputColumns = (fieldId) => {
    const metadata = FormulaRegistry[fieldId];
    if (!metadata || !metadata.inputs) return [];

    // Handle wildcard inputs like 'premi_*'
    const inputs = [];
    metadata.inputs.forEach(input => {
        if (input.includes('*')) {
            const prefix = input.replace('*', '');
            Object.keys(FormulaRegistry).forEach(key => {
                if (key.startsWith(prefix) && key !== fieldId) {
                    inputs.push(key);
                }
            });
        } else {
            inputs.push(input);
        }
    });

    return inputs;
};

export default {
    FormulaRegistry,
    getCellAddress,
    getColumnMetadata,
    isCalculatedColumn,
    getInputColumns
};
