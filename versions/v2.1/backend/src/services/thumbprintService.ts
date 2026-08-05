import { join } from "path";
import { file, write } from "bun";

export class ThumbprintService {
    private static instance: ThumbprintService;
    private dataPath: string;

    private constructor() {
        this.dataPath = join(process.cwd(), "data", "thumbprint_data.json");
    }

    public static getInstance(): ThumbprintService {
        if (!ThumbprintService.instance) {
            ThumbprintService.instance = new ThumbprintService();
        }
        return ThumbprintService.instance;
    }

    private async loadData(): Promise<Record<string, Record<string, number>>> {
        try {
            const f = file(this.dataPath);
            if (await f.exists()) {
                const data = await f.json();
                console.log("[ThumbprintService] Loaded data, available months:", Object.keys(data));
                return data;
            }
            console.log("[ThumbprintService] No data file found");
            return {};
        } catch (e) {
            console.error("[ThumbprintService] Failed to load data:", e);
            return {};
        }
    }

    private async saveData(data: Record<string, Record<string, number>>): Promise<boolean> {
        try {
            await write(this.dataPath, JSON.stringify(data, null, 2));
            return true;
        } catch (e) {
            console.error("[ThumbprintService] Failed to save data:", e);
            return false;
        }
    }

    /**
     * Get thumbprint data for a specific month/year
     * @param month Month (1-12)
     * @param year Year (e.g., 2025)
     * @returns Record of division_code -> thumbprint value
     */
    public async getThumbprintData(month: number, year: number): Promise<Record<string, number>> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;
        const result = data[key] || {};
        console.log(`[ThumbprintService] Getting thumbprint for ${key}:`, result);
        return result;
    }

    /**
     * Get all available months in the thumbprint data
     * @returns Array of available period keys (e.g., ["2025-11", "2025-12", "2026-01"])
     */
    public async getAvailableMonths(): Promise<string[]> {
        const data = await this.loadData();
        const months = Object.keys(data).sort();
        console.log("[ThumbprintService] Available months:", months);
        return months;
    }

    /**
     * Get thumbprint data for previous month
     * @param month Current month (1-12)
     * @param year Current year (e.g., 2026)
     * @returns Record of division_code -> thumbprint value for previous month
     */
    public async getPreviousMonthThumbprint(month: number, year: number): Promise<Record<string, number>> {
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevKey = `${prevYear}-${prevMonth.toString().padStart(2, '0')}`;

        const data = await this.loadData();
        const result = data[prevKey] || {};
        console.log(`[ThumbprintService] Getting previous month thumbprint (${prevKey}):`, result);
        return result;
    }

    public async updateThumbprintValue(month: number, year: number, divisionCode: string, value: number): Promise<boolean> {
        const data = await this.loadData();
        const key = `${year}-${month.toString().padStart(2, '0')}`;

        if (!data[key]) {
            data[key] = {};
        }

        data[key][divisionCode] = value;
        const saved = await this.saveData(data);
        if (saved) {
            console.log(`[ThumbprintService] Updated thumbprint for ${key}, division ${divisionCode}: ${value}`);
        }
        return saved;
    }

    /**
     * Get thumbprint comparison between current and previous month
     * @param month Current month
     * @param year Current year
     * @returns Comparison data
     */
    public async getThumbprintComparison(month: number, year: number): Promise<{
        current_month: { month: number; year: number; data: Record<string, number> };
        previous_month: { month: number; year: number; data: Record<string, number> };
    }> {
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;

        const currentData = await this.getThumbprintData(month, year);
        const previousData = await this.getThumbprintData(prevMonth, prevYear);

        return {
            current_month: { month, year, data: currentData },
            previous_month: { month: prevMonth, year: prevYear, data: previousData }
        };
    }
}

export const thumbprintService = ThumbprintService.getInstance();
