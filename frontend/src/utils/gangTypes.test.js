import { describe, it, expect } from 'vitest';
import {
    GANG_ALL,
    GANG_TYPE,
    getGangType,
    isPanenGang,
    isIJLGang,
    getGangTypeLabel,
    getScopeLabel,
} from './gangTypes';

describe('gangTypes SSOT', () => {
    it('getGangType membaca suffix kode gang', () => {
        expect(getGangType('BJH')).toBe(GANG_TYPE.HARVESTING);
        expect(getGangType('BJT')).toBe(GANG_TYPE.TRANSPORT);
        expect(getGangType('SQM')).toBe(GANG_TYPE.MAINTENANCE);
        expect(getGangType('L12')).toBe(GANG_TYPE.UNCATEGORIZED);
        expect(getGangType('')).toBe(GANG_TYPE.UNCATEGORIZED);
        expect(getGangType(null)).toBe(GANG_TYPE.UNCATEGORIZED);
        expect(getGangType(undefined)).toBe(GANG_TYPE.UNCATEGORIZED);
    });

    it('getGangType case-insensitive', () => {
        expect(getGangType('bjh')).toBe(GANG_TYPE.HARVESTING);
    });

    it('isPanenGang selaras SCOPE.PANEN (suffix H)', () => {
        expect(isPanenGang('BJH')).toBe(true);
        expect(isPanenGang('L5H')).toBe(true);
        expect(isPanenGang('BJT')).toBe(false);
        expect(isPanenGang(null)).toBe(false);
    });

    it('isIJLGang membaca prefix L', () => {
        expect(isIJLGang('L12H')).toBe(true);
        expect(isIJLGang('l12')).toBe(true);
        expect(isIJLGang('BJH')).toBe(false);
        expect(isIJLGang('')).toBe(false);
    });

    it('label tipe & scope tersedia untuk UI', () => {
        expect(getGangTypeLabel(GANG_TYPE.HARVESTING)).toContain('Panen');
        expect(getScopeLabel('panen')).toContain('Panen');
        expect(getScopeLabel('all')).toBe('Semua Gang');
        expect(getScopeLabel('lain')).toBe('Semua Gang');
    });

    it('GANG_ALL konvensi tunggal', () => {
        expect(GANG_ALL).toBe('ALL');
    });
});
