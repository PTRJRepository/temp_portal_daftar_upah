/**
 * Table Preferences Service
 * Manages user preferences for payroll table display
 * Stores preferences in cookies for persistence
 * 
 * v2: Renamed headerColors → cellColors. Colors now apply to body cells only.
 *     Headers use a uniform dark color.
 */

import Cookies from 'js-cookie';

// Cookie key for table preferences
const PREFERENCES_KEY = 'payroll_table_preferences';
const PREFERENCES_VERSION = 2;

// Default body cell group colors (applied to body cells, NOT headers)
export const DEFAULT_CELL_COLORS = {
  IDENTITAS: { bg: '#F8FAFC', text: '#1F2937', border: '#CBD5E1' },
  PAJAK: { bg: '#FAFAF9', text: '#292524', border: '#D6D3D1' },
  ABSENSI: { bg: '#ECFDF3', text: '#14532D', border: '#86EFAC' },
  PANEN: { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
  PENGGAJIAN: { bg: '#EFF6FF', text: '#1E3A8A', border: '#93C5FD' },
  TUNJANGAN: { bg: '#FFF7ED', text: '#9A3412', border: '#FDBA74' },
  'PENDAPATAN LAINNYA': { bg: '#ECFDF5', text: '#065F46', border: '#6EE7B7' },
  PREMI: { bg: '#FFFBEB', text: '#92400E', border: '#FCD34D' },
  'POTONGAN UPAH KOTOR': { bg: '#FEF2F2', text: '#991B1B', border: '#FCA5A5' },
  'UPAH KOTOR': { bg: '#F0FDF4', text: '#14532D', border: '#86EFAC' },
  'POTONGAN UPAH BERSIH': { bg: '#FDF2F8', text: '#9D174D', border: '#F9A8D4' },
  'UPAH BERSIH': { bg: '#F0FDFA', text: '#115E59', border: '#5EEAD4' }
};

// Backward compat alias
export const DEFAULT_HEADER_COLORS = DEFAULT_CELL_COLORS;

// Default preferences
const DEFAULT_PREFERENCES = {
  version: PREFERENCES_VERSION,
  timestamp: new Date().toISOString(),
  preferences: {
    cellColors: DEFAULT_CELL_COLORS,
    columnVisibility: {},
    columnWidths: {},
    fontSize: 100,
    stickyColumns: ['no', 'nik', 'nama'],
    collapsedGroups: [],
    scrollBehavior: {
      virtualScroll: true,
      stickyHeader: true,
      stickyFooter: true
    }
  }
};

// Cookie options
const COOKIE_OPTIONS = {
  expires: 365, // 1 year
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
};

/**
 * Get table preferences from cookies
 * @returns {Object} Preferences object
 */
export const getTablePreferences = () => {
  try {
    const stored = Cookies.get(PREFERENCES_KEY);
    if (!stored) {
      console.log('[TablePreferences] No stored preferences, using defaults');
      return { ...DEFAULT_PREFERENCES };
    }

    const parsed = JSON.parse(stored);

    // Check version for migration
    if (parsed.version !== PREFERENCES_VERSION) {
      console.log('[TablePreferences] Version mismatch, migrating...');
      return migratePreferences(parsed);
    }

    // Merge with defaults to ensure all keys exist
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      preferences: {
        ...DEFAULT_PREFERENCES.preferences,
        ...parsed.preferences,
        cellColors: {
          ...DEFAULT_CELL_COLORS,
          ...(parsed.preferences?.cellColors || {})
        }
      }
    };
  } catch (error) {
    console.error('[TablePreferences] Failed to load preferences:', error);
    return { ...DEFAULT_PREFERENCES };
  }
};

/**
 * Save table preferences to cookies
 * @param {Object} preferences - Preferences object to save
 */
export const saveTablePreferences = (preferences) => {
  try {
    const toStore = {
      version: PREFERENCES_VERSION,
      timestamp: new Date().toISOString(),
      preferences: {
        ...DEFAULT_PREFERENCES.preferences,
        ...preferences
      }
    };

    Cookies.set(PREFERENCES_KEY, JSON.stringify(toStore), COOKIE_OPTIONS);
    console.log('[TablePreferences] Preferences saved successfully');
    return true;
  } catch (error) {
    console.error('[TablePreferences] Failed to save preferences:', error);
    return false;
  }
};

/**
 * Update specific preference key
 * @param {string} key - Preference key to update
 * @param {*} value - New value
 */
export const updatePreference = (key, value) => {
  const current = getTablePreferences();
  const updated = {
    ...current.preferences,
    [key]: value
  };
  return saveTablePreferences(updated);
};

/**
 * Update cell color for a specific group (body cells)
 * @param {string} groupName - Group name
 * @param {Object} colors - { bg, text, border }
 */
export const updateCellColor = (groupName, colors) => {
  const current = getTablePreferences();
  const updatedColors = {
    ...current.preferences.cellColors,
    [groupName]: {
      ...current.preferences.cellColors[groupName],
      ...colors
    }
  };
  return updatePreference('cellColors', updatedColors);
};

// Backward compat alias
export const updateHeaderColor = updateCellColor;

/**
 * Reset preferences to defaults
 */
export const resetPreferences = () => {
  try {
    Cookies.remove(PREFERENCES_KEY, { path: '/' });
    console.log('[TablePreferences] Preferences reset to defaults');
    return { ...DEFAULT_PREFERENCES };
  } catch (error) {
    console.error('[TablePreferences] Failed to reset preferences:', error);
    return { ...DEFAULT_PREFERENCES };
  }
};

/**
 * Reset only cell colors to defaults
 */
export const resetCellColors = () => {
  return updatePreference('cellColors', DEFAULT_CELL_COLORS);
};

// Backward compat alias
export const resetHeaderColors = resetCellColors;

/**
 * Get cell color for a specific group
 * @param {string} groupName - Group name
 * @returns {Object} { bg, text, border }
 */
export const getCellColor = (groupName) => {
  const prefs = getTablePreferences();
  return prefs.preferences.cellColors[groupName] || DEFAULT_CELL_COLORS[groupName] || {
    bg: '#F5F5F5',
    text: '#333333',
    border: '#CCCCCC'
  };
};

// Backward compat alias
export const getHeaderColor = getCellColor;

/**
 * Set column visibility
 * @param {string} columnId - Column identifier
 * @param {boolean} visible - Visibility state
 */
export const setColumnVisibility = (columnId, visible) => {
  const current = getTablePreferences();
  const updated = {
    ...current.preferences.columnVisibility,
    [columnId]: visible
  };
  return updatePreference('columnVisibility', updated);
};

/**
 * Set column width
 * @param {string} columnId - Column identifier
 * @param {number} width - Width in pixels
 */
export const setColumnWidth = (columnId, width) => {
  const current = getTablePreferences();
  const updated = {
    ...current.preferences.columnWidths,
    [columnId]: width
  };
  return updatePreference('columnWidths', updated);
};

/**
 * Set font size scale
 * @param {number} scale - Scale percentage (e.g., 100, 110, 90)
 */
export const setFontSize = (scale) => {
  return updatePreference('fontSize', Math.max(50, Math.min(150, scale)));
};

/**
 * Toggle collapsed state of a header group
 * @param {string} groupName - Header group name
 */
export const toggleGroupCollapse = (groupName) => {
  const current = getTablePreferences();
  const collapsed = current.preferences.collapsedGroups || [];
  const isCollapsed = collapsed.includes(groupName);

  const updated = isCollapsed
    ? collapsed.filter(g => g !== groupName)
    : [...collapsed, groupName];

  return updatePreference('collapsedGroups', updated);
};

/**
 * Check if a group is collapsed
 * @param {string} groupName - Header group name
 * @returns {boolean}
 */
export const isGroupCollapsed = (groupName) => {
  const prefs = getTablePreferences();
  return prefs.preferences.collapsedGroups?.includes(groupName) || false;
};

/**
 * Update scroll behavior settings
 * @param {Object} settings - { virtualScroll, stickyHeader, stickyFooter }
 */
export const updateScrollBehavior = (settings) => {
  const current = getTablePreferences();
  const updated = {
    ...current.preferences.scrollBehavior,
    ...settings
  };
  return updatePreference('scrollBehavior', updated);
};

/**
 * Migrate preferences from older versions
 * @param {Object} oldPrefs - Old preferences object
 * @returns {Object} Migrated preferences
 */
const migratePreferences = (oldPrefs) => {
  console.log('[TablePreferences] Migrating from version', oldPrefs.version, 'to', PREFERENCES_VERSION);

  // Start with defaults
  const migrated = { ...DEFAULT_PREFERENCES };

  // Preserve existing preferences if they exist
  if (oldPrefs.preferences) {
    // v1 → v2: rename headerColors → cellColors
    const oldCellColors = oldPrefs.preferences.cellColors || oldPrefs.preferences.headerColors || {};

    migrated.preferences = {
      ...migrated.preferences,
      ...oldPrefs.preferences,
      cellColors: {
        ...DEFAULT_CELL_COLORS,
        ...oldCellColors
      }
    };
    // Remove old key if present
    delete migrated.preferences.headerColors;
  }

  // Update version and timestamp
  migrated.version = PREFERENCES_VERSION;
  migrated.timestamp = new Date().toISOString();

  // Save migrated preferences
  saveTablePreferences(migrated.preferences);

  return migrated;
};

/**
 * Export preferences as JSON string
 * @returns {string} JSON string of preferences
 */
export const exportPreferences = () => {
  const prefs = getTablePreferences();
  return JSON.stringify(prefs, null, 2);
};

/**
 * Import preferences from JSON string
 * @param {string} jsonString - JSON string of preferences
 * @returns {boolean} Success status
 */
export const importPreferences = (jsonString) => {
  try {
    const parsed = JSON.parse(jsonString);
    if (parsed.preferences) {
      return saveTablePreferences(parsed.preferences);
    }
    return false;
  } catch (error) {
    console.error('[TablePreferences] Failed to import preferences:', error);
    return false;
  }
};

// Export all functions as default object
export default {
  getTablePreferences,
  saveTablePreferences,
  updatePreference,
  updateCellColor,
  updateHeaderColor,
  resetPreferences,
  resetCellColors,
  resetHeaderColors,
  getCellColor,
  getHeaderColor,
  setColumnVisibility,
  setColumnWidth,
  setFontSize,
  toggleGroupCollapse,
  isGroupCollapsed,
  updateScrollBehavior,
  exportPreferences,
  importPreferences,
  DEFAULT_CELL_COLORS,
  DEFAULT_HEADER_COLORS
};
