import { join } from "path";
import { file, write } from "bun";

/**
 * Division Override Service
 * Stores manual overrides for division-level aggregate fields used by summary/wages reports.
 * Data structure: { "YYYY-MM": { "DIV_CODE": { "total_upah_bersih": number } } }
 *
 * The override is applied after aggregation so the displayed total matches the user's edit
 * without modifying underlying gang records.
 */
export class DivisionOverrideService {
    private static instance: DivisionOverrideService;
    private dataPath: string;

    private constructor() {
        this.dataPath = join(process.cwd(), "data", "division_override_values.json");
    }

    public static getInstance(): DivisionOverrideService {
        if (!DivisionOverrideService.instance) {
            DivisionOverrideService.instance = new DivisionOverrideService();
        }
        return DivisionOverrideService.instance;
    }

    private async loadData(): Promise<Record<string, Record<string, Record<string, number>>>> {
        try {
            const f = file(this.dataPath);
            if (await f.exists()) {
                return await f.json();
            }
        } catch (e) {
            console.error("[DivisionOverrideService] Failed to load data:", e);
        }
        return {};
    }

    private async saveData(data: Record<string, Record<string, Record<string, number>>>): Promise<boolean> {
        try {
            await write(this.dataPath, JSON.stringify(data, null, 2));
            return true;
        } catch (e) {
            console.error("[DivisionOverrideService] Failed to save data:", e);
            return false;
        }
    }

    private buildKey(month: number, year: number): string {
        return `${year}-${month.toString().padStart(2, '0')}`;
    }

    public async getOverride(month: number, year: number, divisionCode: string, field: string): Promise<number | undefined> {
        const data = await this.loadData();
        const key = this.buildKey(month, year);
        return data[key]?.[divisionCode]?.[field];
    }

    public async getOverridesForPeriod(month: number, year: number): Promise<Record<string, Record<string, number>>> {
        const data = await this.loadData();
        const key = this.buildKey(month, year);
        return data[key] || {};
    }

    public async updateOverride(month: number, year: number, divisionCode: string, field: string, value: number): Promise<boolean> {
        const data = await this.loadData();
        const key = this.buildKey(month, year);
        if (!data[key]) {
            data[key] = {};
        }
        if (!data[key][divisionCode]) {
            data[key][divisionCode] = {};
        }
        data[key][divisionCode][field] = value;
        return await this.saveData(data);
    }

    public async applyOverridesToDivisionData(
        month: number,
        year: number,
        divisions: any[],
        fields: string[] = ['total_upah_bersih']
    ): Promise<any[]> {
        const overrides = await this.getOverridesForPeriod(month, year);
        if (!overrides || Object.keys(overrides).length === 0) {
            return divisions;
        }
        return divisions.map(div => {
            const divisionCode = div.division_code;
            const divisionOverrides = overrides[divisionCode];
            if (!divisionOverrides) return div;
            const updated: any = { ...div };
            for (const field of fields) {
                if (divisionOverrides[field] !== undefined) {
                    updated[field] = divisionOverrides[field];
                    if (field === 'total_upah_bersih') {
                        updated.total_manual = divisionOverrides[field];
                        updated.total_upah_bersih = divisionOverrides[field];
                    }
                }
            }
            return updated;
        });
    }
}

export const divisionOverrideService = DivisionOverrideService.getInstance();
