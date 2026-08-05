import React, { useState, useEffect } from 'react';
import {
    getTablePreferences,
    updateCellColor,
    resetCellColors,
    setFontSize,
    DEFAULT_CELL_COLORS
} from '../services/tablePreferencesService';

/**
 * TableSettingsPanel - UI for customizing table appearance
 * Allows users to change header colors, font size, and other preferences
 * Preferences are saved to cookies
 */
export default function TableSettingsPanel({ isOpen, onClose, onSettingsChange }) {
    const [preferences, setPreferences] = useState(null);
    const [activeTab, setActiveTab] = useState('colors');
    const [editingGroup, setEditingGroup] = useState(null);

    // Load preferences on mount
    useEffect(() => {
        if (isOpen) {
            const prefs = getTablePreferences();
            // Use cellColors (v2) with fallback to headerColors (v1)
            const loadedPrefs = { ...prefs.preferences };
            if (!loadedPrefs.cellColors && loadedPrefs.headerColors) {
                loadedPrefs.cellColors = loadedPrefs.headerColors;
            }
            setPreferences(loadedPrefs);
        }
    }, [isOpen]);

    // Handle color change
    const handleColorChange = (groupName, colorType, value) => {
        const newColors = {
            ...preferences.cellColors,
            [groupName]: {
                ...preferences.cellColors[groupName],
                [colorType]: value
            }
        };

        // Update local state
        setPreferences(prev => ({
            ...prev,
            cellColors: newColors
        }));

        // Save to cookies
        updateCellColor(groupName, { [colorType]: value });

        // Notify parent
        onSettingsChange?.({ cellColors: newColors });
    };

    // Handle reset colors
    const handleResetColors = () => {
        if (confirm('Reset semua warna ke default?')) {
            resetCellColors();
            const prefs = getTablePreferences();
            setPreferences(prefs.preferences);
            onSettingsChange?.({ cellColors: DEFAULT_CELL_COLORS });
        }
    };

    // Handle font size change
    const handleFontSizeChange = (newSize) => {
        setFontSize(newSize);
        setPreferences(prev => ({
            ...prev,
            fontSize: newSize
        }));
        onSettingsChange?.({ fontSize: newSize });
    };

    // Get list of header groups
    const headerGroups = preferences?.cellColors ? Object.keys(preferences.cellColors) : [];

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="table-settings-panel open">
                {/* Header */}
                <div className="settings-panel-header">
                    <h3>⚙️ Pengaturan Tampilan</h3>
                    <button className="settings-panel-close" onClick={onClose}>
                        ✕
                    </button>
                </div>

                {/* Tabs */}
                <div className="settings-tabs">
                    <button
                        className={`settings-tab ${activeTab === 'colors' ? 'active' : ''}`}
                        onClick={() => setActiveTab('colors')}
                    >
                        🎨 Warna
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'display' ? 'active' : ''}`}
                        onClick={() => setActiveTab('display')}
                    >
                        📺 Tampilan
                    </button>
                </div>

                {/* Content */}
                <div className="settings-panel-content">
                    {activeTab === 'colors' && preferences && (
                        <div className="settings-section">
                            <div className="settings-section-title">
                                <span className="icon">🎨</span>
                                Warna Kolom Group (Body)
                            </div>
                            <p className="settings-description">
                                Klik warna untuk mengubah warna background, text, atau border setiap group kolom.
                                Warna ini hanya diterapkan ke cell body, header tetap satu warna.
                            </p>

                            <div className="color-settings-grid">
                                {headerGroups.map(group => (
                                    <div key={group} className="color-setting-item">
                                        <div className="color-setting-label">
                                            {group}
                                        </div>
                                        <div className="color-setting-controls">
                                            {/* Background Color */}
                                            <div className="color-input-group">
                                                <label>BG</label>
                                                <input
                                                    type="color"
                                                    value={preferences.cellColors[group]?.bg || '#ffffff'}
                                                    onChange={(e) => handleColorChange(group, 'bg', e.target.value)}
                                                    className="color-input"
                                                    title="Background Color"
                                                />
                                            </div>

                                            {/* Text Color */}
                                            <div className="color-input-group">
                                                <label>TXT</label>
                                                <input
                                                    type="color"
                                                    value={preferences.cellColors[group]?.text || '#000000'}
                                                    onChange={(e) => handleColorChange(group, 'text', e.target.value)}
                                                    className="color-input"
                                                    title="Text Color"
                                                />
                                            </div>

                                            {/* Border Color */}
                                            <div className="color-input-group">
                                                <label>BDR</label>
                                                <input
                                                    type="color"
                                                    value={preferences.cellColors[group]?.border || '#cccccc'}
                                                    onChange={(e) => handleColorChange(group, 'border', e.target.value)}
                                                    className="color-input"
                                                    title="Border Color"
                                                />
                                            </div>

                                            {/* Preview */}
                                            <div
                                                className="color-preview"
                                                style={{
                                                    backgroundColor: preferences.cellColors[group]?.bg,
                                                    color: preferences.cellColors[group]?.text,
                                                    borderColor: preferences.cellColors[group]?.border
                                                }}
                                            >
                                                Aa
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="settings-actions">
                                <button className="settings-btn settings-btn-secondary" onClick={handleResetColors}>
                                    🔄 Reset ke Default
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'display' && preferences && (
                        <div className="settings-section">
                            <div className="settings-section-title">
                                <span className="icon">📺</span>
                                Pengaturan Tampilan
                            </div>

                            {/* Font Size */}
                            <div className="font-size-control">
                                <label>Ukuran Font</label>
                                <div className="font-size-slider-container">
                                    <input
                                        type="range"
                                        min="70"
                                        max="130"
                                        step="5"
                                        value={preferences.fontSize}
                                        onChange={(e) => handleFontSizeChange(parseInt(e.target.value))}
                                        className="font-size-slider"
                                    />
                                    <span className="font-size-value">{preferences.fontSize}%</span>
                                </div>
                                <div className="font-size-presets">
                                    <button
                                        className={`preset-btn ${preferences.fontSize === 80 ? 'active' : ''}`}
                                        onClick={() => handleFontSizeChange(80)}
                                    >
                                        Kecil
                                    </button>
                                    <button
                                        className={`preset-btn ${preferences.fontSize === 100 ? 'active' : ''}`}
                                        onClick={() => handleFontSizeChange(100)}
                                    >
                                        Normal
                                    </button>
                                    <button
                                        className={`preset-btn ${preferences.fontSize === 120 ? 'active' : ''}`}
                                        onClick={() => handleFontSizeChange(120)}
                                    >
                                        Besar
                                    </button>
                                </div>
                            </div>

                            {/* Scroll Behavior */}
                            <div className="toggle-settings">
                                <div className="toggle-row">
                                    <span className="toggle-label">Sticky Header</span>
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={preferences.scrollBehavior?.stickyHeader ?? true}
                                            onChange={(e) => {
                                                setPreferences(prev => ({
                                                    ...prev,
                                                    scrollBehavior: {
                                                        ...prev.scrollBehavior,
                                                        stickyHeader: e.target.checked
                                                    }
                                                }));
                                            }}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>

                                <div className="toggle-row">
                                    <span className="toggle-label">Sticky Footer (Grand Total)</span>
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={preferences.scrollBehavior?.stickyFooter ?? true}
                                            onChange={(e) => {
                                                setPreferences(prev => ({
                                                    ...prev,
                                                    scrollBehavior: {
                                                        ...prev.scrollBehavior,
                                                        stickyFooter: e.target.checked
                                                    }
                                                }));
                                            }}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>

                                <div className="toggle-row">
                                    <span className="toggle-label">Virtual Scrolling</span>
                                    <label className="toggle-switch">
                                        <input
                                            type="checkbox"
                                            checked={preferences.scrollBehavior?.virtualScroll ?? true}
                                            onChange={(e) => {
                                                setPreferences(prev => ({
                                                    ...prev,
                                                    scrollBehavior: {
                                                        ...prev.scrollBehavior,
                                                        virtualScroll: e.target.checked
                                                    }
                                                }));
                                            }}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="settings-panel-footer">
                    <button className="settings-btn settings-btn-secondary" onClick={onClose}>
                        Tutup
                    </button>
                </div>
            </div>
        </>
    );
}

/**
 * Settings Trigger Button
 * Floating button to open settings panel
 */
export function SettingsTriggerButton({ onClick }) {
    return (
        <button
            className="settings-trigger-btn"
            onClick={onClick}
            title="Pengaturan Tampilan"
        >
            ⚙️
        </button>
    );
}
