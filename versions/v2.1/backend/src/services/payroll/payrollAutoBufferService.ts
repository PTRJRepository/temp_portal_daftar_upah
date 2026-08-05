import * as fs from "fs";
import * as path from "path";

export type PayrollSyncFrameColor = "red" | "green";

interface JabatanRateFile {
    rate_by_role_group?: Record<string, number>;
    rate_by_jabatan?: Record<string, number>;
    roles?: Array<{
        jabatan?: string;
        rate_tunjangan_jabatan?: number;
    }>;
}

interface MasaKerjaAmountItem {
    tahun?: number;
    jumlah?: number;
}

export interface PayrollAutoBufferInput {
    jabatanText?: string | null;
    roleText?: string | null;
    hariKerja?: number | null;
    masaKerjaTahun?: number | null;
    isSpsiMember?: boolean | null;
    divisionCode?: string | null;
    dbJabatanJumlah?: number | null;
    dbMasaKerjaJumlah?: number | null;
}

export interface PayrollAutoBufferVerificationInput extends PayrollAutoBufferInput {
    dbPotSpsi?: number | null;
    useAutoBuffer?: boolean | null;
}

export interface PayrollAutoBufferResult {
    jabatanAmount: number;
    jabatanRate: number;
    jabatanUsedFallback: boolean;
    masaKerjaAmount: number;
    masaKerjaRate: number;
    masaKerjaUsedFallback: boolean;
    spsiDeduction: number;
}

export interface PayrollAutoBufferVerificationResult {
    display: {
        jabatanAmount: number;
        jabatanRate: number;
        masaKerjaAmount: number;
        masaKerjaRate: number;
        spsiDeduction: number;
    };
    active: {
        jabatanAmount: number;
        jabatanRate: number;
        masaKerjaAmount: number;
        masaKerjaRate: number;
        spsiDeduction: number;
    };
    db: {
        jabatanAmount: number;
        jabatanRate: number;
        masaKerjaAmount: number;
        masaKerjaRate: number;
        spsiDeduction: number;
    };
    valueSyncFrame: Record<string, PayrollSyncFrameColor>;
    valueSourceCompare: Record<string, { db_ptrj: number; active: number }>;
}

function toNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeRoleKey(value: unknown): string {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function shouldForceZeroJabatanRate(jabatanText?: string | null, roleText?: string | null): boolean {
    const candidates = [normalizeRoleKey(jabatanText), normalizeRoleKey(roleText)].filter(Boolean);
    return candidates.some((candidate) =>
        candidate.startsWith("karyawan") || candidate.startsWith("karywan")
    );
}

function resolveSyncColor(displayedValue: number, dbValue: number): PayrollSyncFrameColor {
    const displayed = toNumber(displayedValue);
    const db = toNumber(dbValue);
    return Math.abs(displayed - db) <= 0.01 ? "green" : "red";
}

function candidatePaths(relativePath: string): string[] {
    return [
        path.resolve(process.cwd(), relativePath),
        path.resolve(process.cwd(), "backend", relativePath),
        path.resolve(import.meta.dir, "..", "..", "..", relativePath)
    ];
}

function firstExistingPath(paths: string[]): string | null {
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

class PayrollAutoBufferService {
    private loaded = false;
    private jabatanRateByRole = new Map<string, number>();
    private jabatanRateByRoleGroup = new Map<string, number>();
    private masaKerjaAmountByYear = new Map<number, number>();
    private maxMasaKerjaYear = 0;

    private ensureLoaded() {
        if (this.loaded) return;
        this.loaded = true;
        this.loadJabatanRateConfig();
        this.loadMasaKerjaAmountConfig();
    }

    private loadJabatanRateConfig() {
        try {
            const ratePath = firstExistingPath(candidatePaths("data/rate_tunjagan_jabatan.json"));
            if (!ratePath) return;

            const raw = fs.readFileSync(ratePath, "utf-8");
            const parsed = JSON.parse(raw) as JabatanRateFile;

            for (const [key, value] of Object.entries(parsed.rate_by_jabatan || {})) {
                const normalized = normalizeRoleKey(key);
                if (!normalized) continue;
                this.jabatanRateByRole.set(normalized, toNumber(value));
            }

            for (const role of parsed.roles || []) {
                const normalized = normalizeRoleKey(role.jabatan || "");
                if (!normalized) continue;
                const amount = toNumber(role.rate_tunjangan_jabatan);
                if (amount > 0 && !this.jabatanRateByRole.has(normalized)) {
                    this.jabatanRateByRole.set(normalized, amount);
                }
            }

            for (const [key, value] of Object.entries(parsed.rate_by_role_group || {})) {
                const normalized = normalizeRoleKey(key);
                if (!normalized) continue;
                this.jabatanRateByRoleGroup.set(normalized, toNumber(value));
            }
        } catch (error) {
            console.error("[PayrollAutoBufferService] Failed loading jabatan rates:", error);
        }
    }

    private loadMasaKerjaAmountConfig() {
        try {
            const amountPath = firstExistingPath(candidatePaths("data/amount_masa_kerja.json"));
            if (!amountPath) return;

            const raw = fs.readFileSync(amountPath, "utf-8");
            const parsed = JSON.parse(raw) as MasaKerjaAmountItem[];

            for (const item of parsed || []) {
                const year = Math.floor(toNumber(item.tahun));
                const amount = toNumber(item.jumlah);
                if (year <= 0) continue;
                this.masaKerjaAmountByYear.set(year, amount);
                if (year > this.maxMasaKerjaYear) {
                    this.maxMasaKerjaYear = year;
                }
            }
        } catch (error) {
            console.error("[PayrollAutoBufferService] Failed loading masa kerja amounts:", error);
        }
    }

    private findRateByContains(target: string, map: Map<string, number>): number | null {
        let bestMatchKey = "";
        let bestRate: number | null = null;

        for (const [key, rate] of map.entries()) {
            if (!key) continue;
            if (target.includes(key) || key.includes(target)) {
                if (key.length > bestMatchKey.length) {
                    bestMatchKey = key;
                    bestRate = rate;
                }
            }
        }

        return bestRate;
    }

    private resolveJabatanRate(jabatanText?: string | null, roleText?: string | null): number | null {
        const candidates = [normalizeRoleKey(jabatanText), normalizeRoleKey(roleText)].filter(Boolean);

        for (const candidate of candidates) {
            const exact = this.jabatanRateByRole.get(candidate);
            if (exact && exact > 0) {
                return exact;
            }
        }

        for (const candidate of candidates) {
            const fuzzyRole = this.findRateByContains(candidate, this.jabatanRateByRole);
            if (fuzzyRole && fuzzyRole > 0) {
                return fuzzyRole;
            }

            const fuzzyGroup = this.findRateByContains(candidate, this.jabatanRateByRoleGroup);
            if (fuzzyGroup && fuzzyGroup > 0) {
                return fuzzyGroup;
            }
        }

        return null;
    }

    private resolveMasaKerjaAmount(years: number): number | null {
        if (years <= 0 || this.masaKerjaAmountByYear.size === 0) {
            return 0;
        }

        if (this.masaKerjaAmountByYear.has(years)) {
            return this.masaKerjaAmountByYear.get(years) ?? 0;
        }

        const cappedYear = this.maxMasaKerjaYear > 0 ? Math.min(years, this.maxMasaKerjaYear) : years;
        if (this.masaKerjaAmountByYear.has(cappedYear)) {
            return this.masaKerjaAmountByYear.get(cappedYear) ?? 0;
        }

        let nearestLowerYear = 0;
        for (const year of this.masaKerjaAmountByYear.keys()) {
            if (year <= years && year > nearestLowerYear) {
                nearestLowerYear = year;
            }
        }
        if (nearestLowerYear > 0) {
            return this.masaKerjaAmountByYear.get(nearestLowerYear) ?? 0;
        }

        return 0;
    }

    public calculateAutomaticValues(input: PayrollAutoBufferInput): PayrollAutoBufferResult {
        this.ensureLoaded();

        // [FIX] tunjangan jabatan/masa_kerja pakai hari_kerja (effective, sudah dipotong cuti).
        // Jangan fallback ke `kehadiran` (raw total HK scan incl. Minggu/libur) — kehadiran ≠ cuti.
        const hariKerja = Math.max(0, toNumber(input.hariKerja));
        const attendanceDays = hariKerja;

        const dbJabatanJumlah = toNumber(input.dbJabatanJumlah);
        const dbMasaKerjaJumlah = toNumber(input.dbMasaKerjaJumlah);
        const masaKerjaTahun = Math.max(0, Math.floor(toNumber(input.masaKerjaTahun)));

        const forceZeroRate = shouldForceZeroJabatanRate(input.jabatanText, input.roleText);
        const jabatanRateResolved = forceZeroRate ? 0 : this.resolveJabatanRate(input.jabatanText, input.roleText);
        const hasJabatanRate = forceZeroRate || (Number.isFinite(jabatanRateResolved || NaN) && (jabatanRateResolved || 0) > 0);
        const jabatanAmountAuto = forceZeroRate
            ? 0
            : (hasJabatanRate && attendanceDays > 0 ? (jabatanRateResolved as number) * attendanceDays : null);
        const jabatanAmount = jabatanAmountAuto !== null ? jabatanAmountAuto : dbJabatanJumlah;

        const masaKerjaAmountAuto = this.resolveMasaKerjaAmount(masaKerjaTahun);
        const hasMasaKerjaConfig = masaKerjaAmountAuto !== null;
        const masaKerjaAmount = hasMasaKerjaConfig ? (masaKerjaAmountAuto as number) : dbMasaKerjaJumlah;

        const spsiDeduction = input.isSpsiMember
            ? String(input.divisionCode || "").toUpperCase() === "IJL" ? 10000 : 4000
            : 0;

        return {
            jabatanAmount,
            jabatanRate: attendanceDays > 0 ? jabatanAmount / attendanceDays : 0,
            jabatanUsedFallback: jabatanAmountAuto === null,
            masaKerjaAmount,
            masaKerjaRate: attendanceDays > 0 ? masaKerjaAmount / attendanceDays : 0,
            masaKerjaUsedFallback: !hasMasaKerjaConfig,
            spsiDeduction
        };
    }

    public calculateSpsiDeduction(isSpsiMember: boolean): number {
        return isSpsiMember ? 4000 : 0;
    }

    public calculateVerificationValues(input: PayrollAutoBufferVerificationInput): PayrollAutoBufferVerificationResult {
        const hariKerja = Math.max(0, toNumber(input.hariKerja));
        const dbJabatanAmount = toNumber(input.dbJabatanJumlah);
        const dbMasaKerjaAmount = toNumber(input.dbMasaKerjaJumlah);
        const dbSpsiDeduction = Math.abs(toNumber(input.dbPotSpsi));
        const dbJabatanRate = hariKerja > 0 ? dbJabatanAmount / hariKerja : 0;
        const dbMasaKerjaRate = hariKerja > 0 ? dbMasaKerjaAmount / hariKerja : 0;

        const activeAutoBuffer = this.calculateAutomaticValues(input);
        const useAutoBuffer = input.useAutoBuffer !== false;
        const display = useAutoBuffer
            ? {
                jabatanAmount: activeAutoBuffer.jabatanAmount,
                jabatanRate: activeAutoBuffer.jabatanRate,
                masaKerjaAmount: activeAutoBuffer.masaKerjaAmount,
                masaKerjaRate: activeAutoBuffer.masaKerjaRate,
                spsiDeduction: activeAutoBuffer.spsiDeduction
            }
            : {
                jabatanAmount: dbJabatanAmount,
                jabatanRate: dbJabatanRate,
                masaKerjaAmount: dbMasaKerjaAmount,
                masaKerjaRate: dbMasaKerjaRate,
                spsiDeduction: dbSpsiDeduction
            };

        const active = {
            jabatanAmount: activeAutoBuffer.jabatanAmount,
            jabatanRate: activeAutoBuffer.jabatanRate,
            masaKerjaAmount: activeAutoBuffer.masaKerjaAmount,
            masaKerjaRate: activeAutoBuffer.masaKerjaRate,
            spsiDeduction: activeAutoBuffer.spsiDeduction
        };
        const db = {
            jabatanAmount: dbJabatanAmount,
            jabatanRate: dbJabatanRate,
            masaKerjaAmount: dbMasaKerjaAmount,
            masaKerjaRate: dbMasaKerjaRate,
            spsiDeduction: dbSpsiDeduction
        };

        return {
            display,
            active,
            db,
            valueSyncFrame: {
                jabatan_jumlah: resolveSyncColor(active.jabatanAmount, db.jabatanAmount),
                masa_kerja_jumlah: resolveSyncColor(active.masaKerjaAmount, db.masaKerjaAmount),
                pot_spsi: resolveSyncColor(active.spsiDeduction, db.spsiDeduction),
                spsi: resolveSyncColor(active.spsiDeduction, db.spsiDeduction),
                jabatan_rate: resolveSyncColor(active.jabatanRate, db.jabatanRate),
                masa_kerja_rate: resolveSyncColor(active.masaKerjaRate, db.masaKerjaRate)
            },
            valueSourceCompare: {
                jabatan_jumlah: { db_ptrj: db.jabatanAmount, active: active.jabatanAmount },
                masa_kerja_jumlah: { db_ptrj: db.masaKerjaAmount, active: active.masaKerjaAmount },
                pot_spsi: { db_ptrj: db.spsiDeduction, active: active.spsiDeduction },
                jabatan_rate: { db_ptrj: db.jabatanRate, active: active.jabatanRate },
                masa_kerja_rate: { db_ptrj: db.masaKerjaRate, active: active.masaKerjaRate }
            }
        };
    }
}

export function resolveSyncFrameColor(displayedValue: number, dbValue: number): PayrollSyncFrameColor {
    return resolveSyncColor(displayedValue, dbValue);
}

export const payrollAutoBufferService = new PayrollAutoBufferService();
