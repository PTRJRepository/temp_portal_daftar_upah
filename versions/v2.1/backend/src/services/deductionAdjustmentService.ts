import { join } from "path";
import { file, write } from "bun";

/**
 * Deduction Adjustment Service
 * Stores manual adjustments for deduction values.
 * PPH21 follows seeded Daftar Upah totals in reports; legacy PPH entries are
 * retained as metadata only and are not applied to displayed totals.
 * Data structure: { "YYYY-MM": { "DIV_CODE": { pph21: number, spsi: number } } }
 */
export class DeductionAdjustmentService {
    private static instance: DeductionAdjustmentService;
    private dataPath: string;

    private constructor() {
        this.dataPath = join(process.cwd(), "data", "deduction_adjustments.json");
    }

    public static getInstance(): DeductionAdjustmentService {
        if (!DeductionAdjustmentService.instance) {
            DeductionAdjustmentService.instance = new DeductionAdjustmentService();
        }
        return DeductionAdjustmentService.instance;
    }

    private async loadData(): Promise<Record<string, Record<string, { pph21?: number; spsi?: number }>>> {
        try {
            const f = file(this.dataPath);
            if (await f.exists()) {
                return await f.json();
            }
            return {};
        } catch (e) {
            console.error("[DeductionAdjustmentService] Failed to load data:", e);
            return {};
        }
    }

    private async saveData(data: Record<string, Record<string, { pph21?: number; spsi?: number }>>): Promise<boolean> {
        try {
            await write(this.dataPath, JSON.stringify(data, null, 2));
            return true;
        } catch (e) {
            console.error("[DeductionAdjustmentService] Failed to save data:", e);
            return false;
        }
    }

    /**
     * Get adjustment data for a specific period
     */
    public async getAdjustmentData(month: number, year: number): Promise<Record<string, { pph21?: number; spsi?: number }>> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;
        return data[key] || {};
    }

    /**
     * Get PPH21 adjustment for a specific division and period
     */
    public async getPPH21Adjustment(month: number, year: number, divisionCode: string): Promise<number> {
        const data = await this.getAdjustmentData(month, year);
        return data[divisionCode]?.pph21 || 0;
    }

    /**
     * Get SPSI adjustment for a specific division and period
     */
    public async getSPSIAdjustment(month: number, year: number, divisionCode: string): Promise<number> {
        const data = await this.getAdjustmentData(month, year);
        return data[divisionCode]?.spsi || 0;
    }

    /**
     * Update PPH21 value for a specific division and period
     */
    public async updatePPH21(month: number, year: number, divisionCode: string, value: number): Promise<boolean> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;

        if (!data[key]) {
            data[key] = {};
        }

        if (!data[key][divisionCode]) {
            data[key][divisionCode] = {};
        }

        data[key][divisionCode].pph21 = value;
        return await this.saveData(data);
    }

    /**
     * Update SPSI value for a specific division and period
     */
    public async updateSPSI(month: number, year: number, divisionCode: string, value: number): Promise<boolean> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;

        if (!data[key]) {
            data[key] = {};
        }

        if (!data[key][divisionCode]) {
            data[key][divisionCode] = {};
        }

        data[key][divisionCode].spsi = value;
        return await this.saveData(data);
    }

    /**
     * Update both PPH21 and SPSI at once
     */
    public async updateDeductions(
        month: number,
        year: number,
        divisionCode: string,
        pph21: number,
        spsi: number
    ): Promise<boolean> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;

        if (!data[key]) {
            data[key] = {};
        }

        data[key][divisionCode] = {
            pph21,
            spsi
        };

        return await this.saveData(data);
    }

    /**
     * Apply adjustments to division data.
     * SPSI remains adjustable. PPH21 must stay identical to the seeded
     * Daftar Upah value, so any stored legacy PPH adjustment is exposed as
     * metadata but not added to total_pph21.
     */
    public async applyAdjustmentsToDivisionData(
        month: number,
        year: number,
        divisions: any[]
    ): Promise<any[]> {
        const adjustments = await this.getAdjustmentData(month, year);

        return divisions.map(div => {
            const adj = adjustments[div.division_code] || { pph21: 0, spsi: 0 };
            return {
                ...div,
                total_pph21: div.total_pph21 || 0,
                total_spsi: (div.total_spsi || 0) + (adj.spsi || 0),
                // Store original values for reference
                original_pph21: div.total_pph21,
                original_spsi: div.total_spsi,
                pph21_adjustment: adj.pph21 || 0,
                spsi_adjustment: adj.spsi || 0
            };
        });
    }
}

export const deductionAdjustmentService = DeductionAdjustmentService.getInstance();
