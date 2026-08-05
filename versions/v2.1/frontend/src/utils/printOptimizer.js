import { ensureReportPrintPageSetup } from './printPageSetup';

/**
 * ============================================
 * PRINT OPTIMIZER UTILITY
 * ============================================
 *
 * Provides functions to optimize print display and prevent border cutoff
 *
 * FEATURES:
 * - Set print size mode (compact, standard, large)
 * - Apply print styles dynamically
 * - Print with proper optimization
 * - Get current print mode
 */

/**
 * Print size modes
 */
export const PRINT_MODES = {
    COMPACT: 'print-mode-compact',
    STANDARD: 'print-mode-standard',
    LARGE: 'print-mode-large'
};

/**
 * Default print mode
 */
const DEFAULT_PRINT_MODE = PRINT_MODES.STANDARD;

/**
 * Storage key for print mode preference
 */
const STORAGE_KEY = 'payroll-print-mode';

/**
 * Get the current print mode from localStorage or default
 * @returns {string} Print mode class name
 */
export function getPrintMode() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_PRINT_MODE;
}

/**
 * Set the print mode and save to localStorage
 * @param {string} mode - One of PRINT_MODES values
 */
export function setPrintMode(mode) {
    if (!Object.values(PRINT_MODES).includes(mode)) {
        console.warn(`Invalid print mode: ${mode}. Using STANDARD.`);
        mode = PRINT_MODES.STANDARD;
    }
    localStorage.setItem(STORAGE_KEY, mode);
    applyPrintMode(mode);
}

/**
 * Apply print mode to body element
 * @param {string} mode - Print mode class name
 */
export function applyPrintMode(mode) {
    // Remove all print mode classes
    Object.values(PRINT_MODES).forEach(modeClass => {
        document.body.classList.remove(modeClass);
    });

    // Add the selected mode
    document.body.classList.add(mode);
}

/**
 * Initialize print mode on page load
 * Call this in your component's useEffect or componentDidMount
 */
export function initPrintMode() {
    const savedMode = getPrintMode();
    applyPrintMode(savedMode);
    return savedMode;
}

/**
 * Print with current settings
 * Opens the browser print dialog with optimized styles
 */
export function printReport() {
    // Add a small delay to ensure styles are applied
    ensureReportPrintPageSetup({ orientation: 'landscape' });
    setTimeout(() => {
        window.print();
    }, 100);
}

/**
 * Print with a specific mode (temporary)
 * @param {string} mode - Print mode to use for this print only
 */
export function printWithMode(mode) {
    const previousMode = getPrintMode();

    // Apply temporary mode
    applyPrintMode(mode);
    ensureReportPrintPageSetup({ orientation: 'landscape' });

    // Print after styles are applied
    setTimeout(() => {
        window.print();

        // Restore previous mode after print dialog closes
        setTimeout(() => {
            applyPrintMode(previousMode);
        }, 500);
    }, 100);
}

/**
 * Cycle through print modes
 * Useful for a toggle button in the UI
 */
export function cyclePrintMode() {
    const modes = Object.values(PRINT_MODES);
    const currentMode = getPrintMode();
    const currentIndex = modes.indexOf(currentMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    setPrintMode(nextMode);
    return nextMode;
}

/**
 * Get display name for print mode
 * @param {string} mode - Print mode class name
 * @returns {string} Human-readable name
 */
export function getPrintModeDisplayName(mode) {
    switch (mode) {
        case PRINT_MODES.COMPACT:
            return 'Compact (Muat Banyak)';
        case PRINT_MODES.STANDARD:
            return 'Standard (Seimbang)';
        case PRINT_MODES.LARGE:
            return 'Large (Lebih Besar)';
        default:
            return 'Standard';
    }
}

/**
 * Get description for print mode
 * @param {string} mode - Print mode class name
 * @returns {string} Description of the mode
 */
export function getPrintModeDescription(mode) {
    switch (mode) {
        case PRINT_MODES.COMPACT:
            return 'Font lebih kecil, padding minimal - maksimal data dalam 1 halaman';
        case PRINT_MODES.STANDARD:
            return 'Ukuran seimbang untuk keterbacaan dan jumlah data';
        case PRINT_MODES.LARGE:
            return 'Font lebih besar untuk keterbacaan maksimal';
        default:
            return '';
    }
}

/**
 * Apply print optimization class to element
 * @param {HTMLElement} element - Element to apply class to
 * @param {string} className - Class to apply
 */
export function applyPrintClass(element, className) {
    if (!element) return;

    // Remove existing print classes
    element.classList.remove('print-fit', 'text-wrap', 'text-fit');

    // Add new class
    element.classList.add(className);
}

/**
 * Export for use in components
 */
export default {
    PRINT_MODES,
    getPrintMode,
    setPrintMode,
    applyPrintMode,
    initPrintMode,
    printReport,
    printWithMode,
    cyclePrintMode,
    getPrintModeDisplayName,
    getPrintModeDescription,
    applyPrintClass
};
