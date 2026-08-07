import { useState, useEffect, useCallback } from 'react';

export function usePresentMode() {
    const [presenting, setPresenting] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const enter = useCallback(async () => {
        document.documentElement.classList.add('present-mode');
        setPresenting(true);
        try { await document.documentElement.requestFullscreen(); } catch { /* tetap present tanpa fullscreen */ }
        requestAnimationFrame(() => {
            const first = document.querySelector('.present-slide');
            if (first) first.scrollIntoView({ block: 'start' });
        });
    }, []);

    const exit = useCallback(() => {
        document.documentElement.classList.remove('present-mode');
        setPresenting(false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }, []);

    useEffect(() => {
        const onFsChange = () => {
            if (!document.fullscreenElement) {
                document.documentElement.classList.remove('present-mode');
                setPresenting(false);
            }
        };
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    useEffect(() => {
        if (!presenting) return;
        const go = (idx) => {
            const slides = document.querySelectorAll('.present-slide');
            if (!slides.length) return;
            const next = Math.max(0, Math.min(slides.length - 1, idx));
            slides[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { exit(); return; }
            if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(activeIndex + 1); }
            else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(activeIndex - 1); }
            else if (e.key === 'Home') { e.preventDefault(); go(0); }
            else if (e.key === 'End') { e.preventDefault(); go(Number.MAX_SAFE_INTEGER); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [presenting, activeIndex, exit]);

    useEffect(() => {
        if (!presenting) return;
        const update = () => {
            const slides = Array.from(document.querySelectorAll('.present-slide'));
            if (!slides.length) return;
            const probe = window.innerHeight * 0.35;
            let idx = 0;
            let best = -Infinity;
            slides.forEach((s, i) => {
                const top = s.getBoundingClientRect().top;
                if (top <= probe && top > best) { best = top; idx = i; }
            });
            setActiveIndex(idx);
        };
        update();
        window.addEventListener('scroll', update, true); // capture: menangkap scroll container manapun
        return () => window.removeEventListener('scroll', update, true);
    }, [presenting]);

    return { presenting, activeIndex, enter, exit };
}

export default usePresentMode;
