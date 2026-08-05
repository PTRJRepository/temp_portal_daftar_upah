import { join } from "path";
import { file, write } from "bun";

/**
 * Luas Area Service
 * Base data from area_produktif.json
 * Adjustments stored in luas_area_adjustments.json
 * Data structure: { "YYYY-MM": { "DIV_CODE": number } }
 */
export class LuasAreaService {
    private static instance: LuasAreaService;
    private dataPath: string;
    private baseDataPath: string;

    private constructor() {
        this.dataPath = join(process.cwd(), "data", "luas_area_adjustments.json");
        this.baseDataPath = join(process.cwd(), "data", "area_produktif.json");
    }

    public static getInstance(): LuasAreaService {
        if (!LuasAreaService.instance) {
            LuasAreaService.instance = new LuasAreaService();
        }
        return LuasAreaService.instance;
    }

    private async loadData(): Promise<Record<string, Record<string, number>>> {
        try {
            const f = file(this.dataPath);
            if (await f.exists()) {
                return await f.json();
            }
            return {};
        } catch (e) {
            console.error("[LuasAreaService] Failed to load data:", e);
            return {};
        }
    }

    private async saveData(data: Record<string, Record<string, number>>): Promise<boolean> {
        try {
            await write(this.dataPath, JSON.stringify(data, null, 2));
            return true;
        } catch (e) {
            console.error("[LuasAreaService] Failed to save data:", e);
            return false;
        }
    }

    /**
     * Get all luas area adjustments for a specific period
     */
    public async getLuasAreaData(month: number, year: number): Promise<Record<string, number>> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;
        return data[key] || {};
    }

    /**
     * Get luas area for a specific division and period
     */
    public async getLuasArea(month: number, year: number, divisionCode: string): Promise<number> {
        const data = await this.getLuasAreaData(month, year);
        return data[divisionCode] || 0;
    }

    /**
     * Update luas area for a specific division and period
     */
    public async updateLuasArea(month: number, year: number, divisionCode: string, value: number): Promise<boolean> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;

        if (!data[key]) {
            data[key] = {};
        }

        data[key][divisionCode] = value;
        return await this.saveData(data);
    }

    /**
     * Apply luas area adjustments to division data
     * Overrides the luas_ha value with adjusted value if exists
     */
    public async applyLuasAreaAdjustments(
        month: number,
        year: number,
        divisions: any[]
    ): Promise<any[]> {
        const adjustments = await this.getLuasAreaData(month, year);

        return divisions.map(div => {
            const adjustedLuas = adjustments[div.division_code];
            return {
                ...div,
                // Store original value
                original_luas_ha: div.luas_ha,
                // Use adjusted value if exists, otherwise use original
                luas_ha: adjustedLuas !== undefined ? adjustedLuas : div.luas_ha,
                // Flag to indicate if this value was adjusted
                luas_ha_adjusted: adjustedLuas !== undefined
            };
        });
    }

    /**
     * Get base luas area data from area_produktif.json
     * Returns a map of division_code -> luas_hektar
     */
    public async getBaseLuasAreaData(): Promise<Record<string, number>> {
        try {
            const areaFile = file(this.baseDataPath);
            if (await areaFile.exists()) {
                const areaData = (await areaFile.json()) as any[];
                const map: Record<string, number> = {};
                for (const item of areaData) {
                    const div = (item.divisi || '').trim();
                    if (div) {
                        map[div] = parseFloat(item.luas_hektar) || 0;
                    }
                }
                return map;
            }
        } catch (e) {
            console.error("[LuasAreaService] Failed to load area_produktif.json:", e);
        }
        return {};
    }

    /**
     * Get effective luas area for a division (base + adjustment for period)
     */
    public async getEffectiveLuasArea(month: number, year: number, divisionCode: string): Promise<number> {
        // Get base data
        const baseData = await this.getBaseLuasAreaData();
        const baseLuas = baseData[divisionCode] || 0;

        // Get adjustment for this period
        const adjustments = await this.getLuasAreaData(month, year);
        const adjustedLuas = adjustments[divisionCode];

        // Return adjusted value if exists, otherwise return base value
        return adjustedLuas !== undefined ? adjustedLuas : baseLuas;
    }
}

export const luasAreaService = LuasAreaService.getInstance();
