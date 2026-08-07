import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('./present.css', import.meta.url), 'utf8');

describe('present.css scoping', () => {
    test('aturan panggung selalu berakar html.present-mode', () => {
        const stageRules = css.split('}').map(b => b.trim()).filter(b => b.includes('{'))
            .filter(b => /100vh|scroll-snap|#0C1410|#223528|#93A596|#4CAF7D/.test(b));
        for (const rule of stageRules) {
            const selector = rule.split('{')[0];
            expect(selector).toMatch(/html\.present-mode|^@/);
        }
    });
    test('HUD disembunyikan saat print', () => {
        expect(css).toMatch(/@media print\{[^}]*\.present-hud/s);
    });
    test('tidak ada emoji di CSS', () => {
        expect(css).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    });
});
