/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import PresentSlide from './PresentSlide';

const { act } = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PresentSlide', () => {
    let container;
    let root;

    afterEach(async () => {
        if (root) await act(async () => { root.unmount(); });
        if (container) container.remove();
        root = undefined;
        container = undefined;
    });

    it('merender section.present-slide dengan data-num, judul, dan kicker', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await act(async () => {
            root.render(
                <PresentSlide num="01" id="slide-01" title="Ringkasan Eksekutif" subtitle="Kinerja utama bulan berjalan">
                    <div>Konten slide</div>
                </PresentSlide>
            );
        });

        const section = container.querySelector('section.present-slide');
        expect(section).toBeTruthy();
        expect(section.getAttribute('id')).toBe('slide-01');
        expect(section.getAttribute('data-num')).toBe('01');
        expect(section.getAttribute('data-title')).toBe('Ringkasan Eksekutif');
        expect(section.querySelector('.present-slide-num').textContent).toBe('01');
        expect(section.querySelector('h2').textContent).toBe('Ringkasan Eksekutif');
        expect(section.querySelector('.present-slide-header p').textContent).toBe('Kinerja utama bulan berjalan');
        expect(section.querySelector('.present-slide-kicker').textContent).toBe('Slide 01');
        expect(section.querySelector('.present-slide-body').textContent).toContain('Konten slide');
    });

    it('menyembunyikan baris subtitle bila prop subtitle tidak ada', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await act(async () => {
            root.render(
                <PresentSlide num="02" title="Upah & Komponen">
                    <div>Isi</div>
                </PresentSlide>
            );
        });

        const section = container.querySelector('section.present-slide');
        expect(section.querySelector('.present-slide-header p')).toBeNull();
        expect(section.querySelector('.present-slide-kicker').textContent).toBe('Slide 02');
    });
});
