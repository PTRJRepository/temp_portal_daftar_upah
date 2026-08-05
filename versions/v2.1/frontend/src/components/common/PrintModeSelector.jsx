/**
 * Print Mode Selector Component
 *
 * Allows users to switch between different print size modes:
 * - Compact: Maximum data fit, smaller font
 * - Standard: Balanced readability and data amount
 * - Large: Better readability, larger font
 */

import React, { useState, useEffect } from 'react';
import {
    PRINT_MODES,
    initPrintMode,
    setPrintMode,
    getPrintMode,
    getPrintModeDisplayName,
    getPrintModeDescription,
    cyclePrintMode,
    printReport
} from '../../utils/printOptimizer';

const PrintModeSelector = ({ onPrint }) => {
    const [currentMode, setCurrentMode] = useState(PRINT_MODES.STANDARD);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        // Initialize print mode on mount
        const mode = initPrintMode();
        setCurrentMode(mode);
    }, []);

    const handleModeChange = (mode) => {
        setPrintMode(mode);
        setCurrentMode(mode);
        setIsOpen(false);
    };

    const handlePrint = () => {
        if (onPrint) {
            onPrint();
        } else {
            printReport();
        }
        setIsOpen(false);
    };

    const handleCycle = () => {
        const nextMode = cyclePrintMode();
        setCurrentMode(nextMode);
    };

    const modeOptions = [
        { mode: PRINT_MODES.COMPACT, icon: '📊', color: 'bg-blue-50 border-blue-200 text-blue-700' },
        { mode: PRINT_MODES.STANDARD, icon: '📄', color: 'bg-green-50 border-green-200 text-green-700' },
        { mode: PRINT_MODES.LARGE, icon: '📝', color: 'bg-purple-50 border-purple-200 text-purple-700' },
    ];

    const getCurrentModeInfo = () => {
        return modeOptions.find(opt => opt.mode === currentMode) || modeOptions[1];
    };

    const currentModeInfo = getCurrentModeInfo();

    return (
        <div className="relative">
            {/* Main Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-200 ${currentModeInfo.color} hover:shadow-md`}
                title={getPrintModeDescription(currentMode)}
            >
                <span className="text-lg">{currentModeInfo.icon}</span>
                <span className="font-semibold text-sm">{getPrintModeDisplayName(currentMode)}</span>
                <svg
                    className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Menu */}
                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-20 overflow-hidden">
                        {/* Header */}
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                            <h3 className="font-bold text-gray-800 text-sm">Mode Tampilan Print</h3>
                            <p className="text-xs text-gray-500 mt-1">Pilih ukuran font untuk print</p>
                        </div>

                        {/* Mode Options */}
                        <div className="p-2 space-y-1">
                            {modeOptions.map(({ mode, icon, color }) => {
                                const isActive = mode === currentMode;
                                return (
                                    <button
                                        key={mode}
                                        onClick={() => handleModeChange(mode)}
                                        className={`w-full text-left px-3 py-3 rounded-lg transition-all duration-150 ${
                                            isActive
                                                ? 'bg-green-50 border-2 border-green-500'
                                                : 'hover:bg-gray-50 border-2 border-transparent'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <span className="text-2xl">{icon}</span>
                                            <div className="flex-1">
                                                <div className={`font-bold text-sm ${isActive ? 'text-green-700' : 'text-gray-700'}`}>
                                                    {getPrintModeDisplayName(mode)}
                                                    {isActive && (
                                                        <span className="ml-2 text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">AKTIF</span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-gray-500 mt-1">
                                                    {getPrintModeDescription(mode)}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Quick Actions */}
                        <div className="p-2 bg-gray-50 border-t border-gray-200 space-y-1">
                            <button
                                onClick={handleCycle}
                                className="w-full px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Ganti Mode (Cycle)
                            </button>
                            <button
                                onClick={handlePrint}
                                className="w-full px-3 py-2 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                Print Sekarang
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default PrintModeSelector;
