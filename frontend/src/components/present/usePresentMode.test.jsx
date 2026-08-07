/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import usePresentMode from './usePresentMode';

const { act } = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom tidak punya IntersectionObserver / scrollIntoView / Fullscreen API: stub semua.
class IOStub {
    constructor(cb) { this.cb = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
}

let hook;
function Probe() {
    hook = usePresentMode();
    return (
        <div>
            <section className="present-slide">Satu</section>
            <section className="present-slide">Dua</section>
            <section className="present-slide">Tiga</section>
        </div>
    );
}

describe('usePresentMode', () => {
    let container;
    let root;
    let scrollSpy;
    let originals;

    beforeEach(() => {
        originals = {
            io: globalThis.IntersectionObserver,
            raf: globalThis.requestAnimationFrame,
            scrollIntoView: Element.prototype.scrollIntoView,
            requestFullscreen: document.documentElement.requestFullscreen,
        };
        globalThis.IntersectionObserver = IOStub;
        globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
        scrollSpy = vi.fn();
        Element.prototype.scrollIntoView = scrollSpy;
        document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        container.remove();
        document.documentElement.classList.remove('present-mode');
        globalThis.IntersectionObserver = originals.io;
        globalThis.requestAnimationFrame = originals.raf;
        Element.prototype.scrollIntoView = originals.scrollIntoView;
        document.documentElement.requestFullscreen = originals.requestFullscreen;
        hook = undefined;
    });

    it('enter() menambah class present-mode dan menandai presenting', async () => {
        await act(async () => { root.render(<Probe />); });
        expect(document.documentElement.classList.contains('present-mode')).toBe(false);

        await act(async () => { await hook.enter(); });

        expect(document.documentElement.classList.contains('present-mode')).toBe(true);
        expect(hook.presenting).toBe(true);
        expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    });

    it('ArrowDown berpindah ke slide berikutnya via scrollIntoView', async () => {
        await act(async () => { root.render(<Probe />); });
        await act(async () => { await hook.enter(); });
        scrollSpy.mockClear();

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        });

        const slides = document.querySelectorAll('.present-slide');
        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect(scrollSpy.mock.instances[0]).toBe(slides[1]);
        expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('Escape dan exit() menghapus class present-mode', async () => {
        await act(async () => { root.render(<Probe />); });
        await act(async () => { await hook.enter(); });
        expect(hook.presenting).toBe(true);

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });

        expect(document.documentElement.classList.contains('present-mode')).toBe(false);
        expect(hook.presenting).toBe(false);
    });
});
