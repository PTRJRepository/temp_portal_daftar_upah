import React from 'react';
import { createPortal } from 'react-dom';
import { Presentation, X } from 'lucide-react';

/**
 * PresentController - tombol "Present" di mode normal, HUD deck di present mode.
 * HUD (progress bar, counter, caption, exit hint) dirender via portal ke document.body.
 */
export function PresentController({ presenting, activeIndex, slideCount, onEnter, onExit, caption }) {
    if (!presenting) {
        return (
            <button
                type="button"
                onClick={onEnter}
                aria-label="Masuk mode present"
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '8px 16px',
                    background: '#1F6F43',
                    color: '#fff',
                    border: '1px solid #1F6F43',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    outline: 'none',
                }}
            >
                <Presentation size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>Present</span>
            </button>
        );
    }

    const slides = document.querySelectorAll('.present-slide');
    const total = slideCount || slides.length || 1;
    const index = Math.max(0, Math.min(activeIndex, total - 1));
    const activeTitle = slides[index]?.getAttribute('data-title') || '';
    const progress = ((index + 1) / total) * 100;

    return createPortal(
        <>
            <div className="present-hud">
                <div className="present-hud-progress">
                    <div style={{ width: `${progress}%` }} />
                </div>
            </div>
            <div className="present-exit-hint">ESC untuk keluar</div>
            <div className="present-hud-caption">
                <span>{caption}</span>
                <span>{index + 1} / {total}{activeTitle ? ` · ${activeTitle}` : ''}</span>
                <button
                    type="button"
                    onClick={onExit}
                    aria-label="Keluar mode present"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '1.6rem',
                        height: '1.6rem',
                        background: 'transparent',
                        color: 'inherit',
                        border: '1px solid currentColor',
                        borderRadius: 6,
                        cursor: 'pointer',
                        pointerEvents: 'auto',
                    }}
                >
                    <X size={13} strokeWidth={2.4} aria-hidden="true" />
                </button>
            </div>
        </>,
        document.body
    );
}

export default PresentController;
