import React from 'react';

export default function PayrollScrollChapterBar({
    activeGroup = null,
    allGroups = [],
    isVisible = false,
    onSelectGroup = () => {},
    // Gang chips props for streaming mode
    recentGangs = [],
    streamingStage = null,
    totalGangs = 0,
    processedGangs = 0,
    displayMode = 'simple',
    onToggleDisplayMode = () => {}
}) {
    const isStreaming = streamingStage === 'streaming' || streamingStage === 'querying' || streamingStage === 'connecting';
    const showGangChips = isStreaming;

    return (
        <div 
            className={`payroll-footer-dock ${isVisible ? 'is-visible' : 'is-hidden'}`}
            aria-hidden={isVisible ? 'false' : 'true'}
        >
            {/* 1. PROGRESS BAR / STREAMING INDICATOR */}
            {showGangChips && (
                <div className="payroll-footer-stream-bar">
                    <div className="stream-progress-track">
                        <div 
                            className="stream-progress-fill" 
                            style={{ 
                                width: totalGangs > 0 ? `${(processedGangs / totalGangs) * 100}%` : (streamingStage === 'querying' ? '50%' : '10%'),
                                backgroundColor: streamingStage === 'querying' ? '#f59e0b' : '#10b981'
                            }} 
                        />
                    </div>
                    {recentGangs.length > 0 && (
                        <div className="stream-chips">
                            <span className="stream-status-text">Menerima Data:</span>
                            {recentGangs.map((g) => (
                                <span key={g.gang_code} className="stream-chip">
                                    {g.gang_code}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 2. TAB NAVIGATION (THE SLIDER) */}
            <div className="payroll-footer-tabs">
                <button
                    className={`footer-mode-toggle ${displayMode === 'simple' ? 'is-focus' : 'is-all'}`}
                    onClick={onToggleDisplayMode}
                    title={displayMode === 'simple' ? 'Tampilkan Semua Kolom' : 'Gunakan Mode Fokus'}
                >
                    <span className="footer-mode-toggle__label">
                        {displayMode === 'simple' ? 'FOKUS' : 'SEMUA'}
                    </span>
                </button>
                <div className="tabs-scroll-container">
                    {allGroups.map((group) => (
                        <button
                            key={group}
                            className={`footer-tab-btn ${activeGroup === group ? 'is-active' : ''}`}
                            onClick={() => onSelectGroup(group)}
                        >
                            {group}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
