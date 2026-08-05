import { SummaryService } from "./summaryService";

export interface FFBProductivityRow {
    division_code: string;
    description: string;
    total_employees: number;
    total_hk: number;
    total_upah_bersih: number;
    total_premi: number;
    total_lembur: number;
    total_ffb_ton: number;
    total_gangs: number;
    // Derived
    ton_per_hk: number;
    cost_per_ton: number;
}

export class MillProductionService {
    private static instance: MillProductionService;

    private constructor() { }

    public static getInstance(): MillProductionService {
        if (!MillProductionService.instance) {
            MillProductionService.instance = new MillProductionService();
        }
        return MillProductionService.instance;
    }

    /**
     * Uses SummaryService.getAllDivisionsPremiTotals() which already has:
     * - Payroll data (HK, upah, premi, lembur) from extend_db_ptrj
     * - FFB tonase from db_ptrj_mill (stored in total_ffb_weight, in tons)
     * - Division mapping from HR_GANG in db_ptrj
     */
    public async getProductionSummary(month: number, year: number): Promise<FFBProductivityRow[]> {
        const summaryService = SummaryService.getInstance();
        const divisionData = await summaryService.getAllDivisionsPremiTotals(month, year);

        const results: FFBProductivityRow[] = [];

        // Skip subtotals, grand totals, and non-estate divisions
        const skipDivisions = ['NRS', 'INF', 'WKS_PG', 'WKS_AR'];

        for (const div of divisionData) {
            if (div.is_subtotal || div.is_grand_total) continue;
            if (skipDivisions.includes(div.division_code)) continue;

            const ton = div.total_ffb_weight || 0;
            const tonPerHK = div.total_hk > 0 ? ton / div.total_hk : 0;
            const costPerTon = ton > 0 ? div.total_upah_bersih / ton : 0;

            results.push({
                division_code: div.division_code,
                description: div.description,
                total_employees: div.total_employees,
                total_hk: div.total_hk,
                total_upah_bersih: div.total_upah_bersih,
                total_premi: div.total_premi,
                total_lembur: div.total_lembur,
                total_ffb_ton: ton,
                total_gangs: div.total_gangs,
                ton_per_hk: tonPerHK,
                cost_per_ton: costPerTon
            });
        }

        // Sort by FFB tonnage descending
        results.sort((a, b) => b.total_ffb_ton - a.total_ffb_ton);

        return results;
    }
}

export const millProductionService = MillProductionService.getInstance();
