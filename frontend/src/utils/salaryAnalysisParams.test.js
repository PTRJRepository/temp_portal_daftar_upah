/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { buildAnalysisSearchParams } from './salaryAnalysisParams';

describe('buildAnalysisSearchParams', () => {
    it('ganti divisi mempertahankan month/year yang sudah ada', () => {
        const p = buildAnalysisSearchParams('month=7&year=2026', { division: 'ARC' });
        expect(p.get('division_code')).toBe('ARC');
        expect(p.get('month')).toBe('7');
        expect(p.get('year')).toBe('2026');
    });

    it('ganti divisi sekaligus menghapus gang_code lama', () => {
        const p = buildAnalysisSearchParams('division_code=ARA&gang_code=B1H&month=7', { division: 'ARC', gang: '' });
        expect(p.get('division_code')).toBe('ARC');
        expect(p.has('gang_code')).toBe(false);
        expect(p.get('month')).toBe('7');
    });

    it('hapus divisi (kosong) menghapus division_code', () => {
        const p = buildAnalysisSearchParams('division_code=ARC&month=7', { division: '' });
        expect(p.has('division_code')).toBe(false);
        expect(p.get('month')).toBe('7');
    });

    it('ganti gang saja tidak menyentuh division/month', () => {
        const p = buildAnalysisSearchParams('division_code=ARC&month=7', { gang: 'C1H' });
        expect(p.get('gang_code')).toBe('C1H');
        expect(p.get('division_code')).toBe('ARC');
        expect(p.get('month')).toBe('7');
    });

    it('bulan/tahun di-set dan dihapus benar', () => {
        expect(buildAnalysisSearchParams('month=7', { month: '8', year: 2026 }).toString()).toContain('month=8');
        const p = buildAnalysisSearchParams('month=7&year=2026', { month: '' });
        expect(p.has('month')).toBe(false);
        expect(p.get('year')).toBe('2026');
    });

    it('input URLSearchParams instance juga diperlakukan sama', () => {
        const p = buildAnalysisSearchParams(new URLSearchParams('division_code=ARA&month=7'), { division: 'DME' });
        expect(p.toString()).toBe('division_code=DME&month=7');
    });
});
