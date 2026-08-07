import React from 'react';
import { C } from './reportTheme';

/**
 * SlideNav - sticky jump nav to slides, with active highlight + smooth scroll.
 * Hanya untuk mode normal; disembunyikan saat present mode via .slide-nav di present.css.
 */
export function SlideNav({ slides = [], activeId }) {
    const jump = (e, id) => {
        e.preventDefault();
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    return (
        <div className="slide-nav" style={{
            position: 'sticky', top: 0, zIndex: 30, background: 'rgba(237,243,236,0.94)', backdropFilter: 'blur(8px)',
            borderBottom: `1px solid ${C.border}`, padding: '8px 4px', marginBottom: '1.5rem', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center'
        }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.leafMid, marginRight: 6 }}>Slides</span>
            {slides.map(s => (
                <a key={s.id} href={`#${s.id}`} onClick={(e) => jump(e, s.id)}
                    style={{
                        padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, textDecoration: 'none', transition: 'all .18s',
                        background: activeId === s.id ? C.leafMid : C.surface, color: activeId === s.id ? '#fff' : C.text2,
                        border: `1px solid ${activeId === s.id ? C.leafMid : C.border}`, boxShadow: activeId === s.id ? '0 2px 8px rgba(30,122,69,.25)' : 'none'
                    }}>
                    <span style={{ opacity: 0.7, marginRight: 4 }}>{s.num}</span>{s.label}
                </a>
            ))}
        </div>
    );
}

export default SlideNav;
