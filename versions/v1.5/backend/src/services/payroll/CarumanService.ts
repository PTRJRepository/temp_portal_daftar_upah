/**
 * Caruman Service
 *
 * Centralized service for all BPJS/Caruman calculations.
 * Provides single source of truth for:
 * - ASTEK/JHT calculations
 * - BPJS Kesehatan calculations
 * - BPJS Pensiun calculations
 *
 * This service wraps carumanDefinitions.ts and provides OOP interface.
 */

import {
    CARUMAN_RATES,
    CarumanResult,
} from '../carumanDefinitions';

/**
 * Caruman Service - Single Source of Truth for Caruman Calculations
 */
export class CarumanService {
    private static instance: CarumanService;

    // Rates from carumanDefinitions
    private readonly RATES = CARUMAN_RATES;

    private constructor() {}

    public static getInstance(): CarumanService {
        if (!CarumanService.instance) {
            CarumanService.instance = new CarumanService();
        }
        return CarumanService.instance;
    }

    /**
     * Calculate all caruman components
     *
     * @param upahDasar - Daily wage (Upah Dasar)
     * @param masaKerjaJumlah - Monthly masa kerja allowance
     * @returns Complete caruman calculation result
     */
    public calculateAllCaruman(upahDasar: number, masaKerjaJumlah: number): CarumanResult {
        const gajiStandar = this.getGajiStandar(upahDasar);
        const base = this.getCarumanBase(gajiStandar, masaKerjaJumlah);

        return {
            base,
            gajiStandar,
            // ASTEK
            astek_pekerja_jht: this.round(base * this.RATES.ASTEK_PEKERJA_JHT),
            astek_majikan_jkk_jkm: this.round(base * this.RATES.ASTEK_MAJIKAN_JKK_JKM),
            astek_majikan_jht: this.round(base * this.RATES.ASTEK_MAJIKAN_JHT),
            astek_majikan_total: this.round(base * this.RATES.ASTEK_MAJIKAN_TOTAL),
            // BPJS Kesehatan
            bpjs_kes_pekerja: this.round(base * this.RATES.BPJS_KES_PEKERJA),
            bpjs_kes_majikan: this.round(base * this.RATES.BPJS_KES_MAJIKAN),
            // BPJS Pensiun
            bpjs_pensiun_pekerja: this.round(base * this.RATES.BPJS_PENSIUN_PEKERJA),
            bpjs_pensiun_majikan: this.round(base * this.RATES.BPJS_PENSIUN_MAJIKAN),
            // Totals
            total_pekerja: this.calculateTotalPekerja(base),
            total_majikan: this.calculateTotalMajikan(base),
            grand_total: this.calculateGrandTotal(base),
        };
    }

    /**
     * Get BPJS base amount
     * BASE = Gaji Standar + Masa Kerja Allowance
     */
    public getCarumanBase(gajiStandar: number, masaKerjaJumlah: number): number {
        return gajiStandar + masaKerjaJumlah;
    }

    /**
     * Get standard salary (Upah Dasar × 30)
     */
    public getGajiStandar(upahDasar: number): number {
        return upahDasar * 30;
    }

    /**
     * Get components needed for PPh21 calculation
     * Returns the employer portions that reduce taxable income
     */
    public getForPph21(upahDasar: number, masaKerjaJumlah: number): {
        base: number;
        astek_majikan_084: number;
        bpjs_kes_majikan_4: number;
    } {
        const gajiStandar = this.getGajiStandar(upahDasar);
        const base = this.getCarumanBase(gajiStandar, masaKerjaJumlah);

        return {
            base,
            astek_majikan_084: this.round(base * this.RATES.ASTEK_MAJIKAN_JKK_JKM),
            bpjs_kes_majikan_4: this.round(base * this.RATES.BPJS_KES_MAJIKAN),
        };
    }

    /**
     * Calculate only ASTEK components
     */
    public calculateAstek(base: number): {
        pekerja_jht: number;
        majikan_jkk_jkm: number;
        majikan_jht: number;
        majikan_total: number;
    } {
        return {
            pekerja_jht: this.round(base * this.RATES.ASTEK_PEKERJA_JHT),
            majikan_jkk_jkm: this.round(base * this.RATES.ASTEK_MAJIKAN_JKK_JKM),
            majikan_jht: this.round(base * this.RATES.ASTEK_MAJIKAN_JHT),
            majikan_total: this.round(base * this.RATES.ASTEK_MAJIKAN_TOTAL),
        };
    }

    /**
     * Calculate only BPJS Kesehatan components
     */
    public calculateBpjsKes(base: number): {
        pekerja: number;
        majikan: number;
    } {
        return {
            pekerja: this.round(base * this.RATES.BPJS_KES_PEKERJA),
            majikan: this.round(base * this.RATES.BPJS_KES_MAJIKAN),
        };
    }

    /**
     * Calculate only BPJS Pensiun components
     */
    public calculateBpjsPensiun(base: number): {
        pekerja: number;
        majikan: number;
    } {
        return {
            pekerja: this.round(base * this.RATES.BPJS_PENSIUN_PEKERJA),
            majikan: this.round(base * this.RATES.BPJS_PENSIUN_MAJIKAN),
        };
    }

    /**
     * Get total worker portion
     */
    private calculateTotalPekerja(base: number): number {
        return this.round(base * (
            this.RATES.ASTEK_PEKERJA_JHT +
            this.RATES.BPJS_KES_PEKERJA +
            this.RATES.BPJS_PENSIUN_PEKERJA
        ));
    }

    /**
     * Get total employer portion
     */
    private calculateTotalMajikan(base: number): number {
        return this.round(base * (
            this.RATES.ASTEK_MAJIKAN_TOTAL +
            this.RATES.BPJS_KES_MAJIKAN +
            this.RATES.BPJS_PENSIUN_MAJIKAN
        ));
    }

    /**
     * Get grand total (worker + employer)
     */
    private calculateGrandTotal(base: number): number {
        return this.calculateTotalPekerja(base) + this.calculateTotalMajikan(base);
    }

    /**
     * Round to nearest integer
     */
    private round(value: number): number {
        return Math.round(value);
    }
}

// Export singleton instance
export const carumanService = CarumanService.getInstance();
