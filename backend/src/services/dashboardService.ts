import { Database } from "../db/client";
import { dataExtractorService } from "./dataExtractorService";
import { Config } from "../config";
import { gangService } from "./gangService";

type TonaseReportPeriod = {
    month: number;
    year: number;
    key: string;
    label: string;
};

type TonaseAggregationRow = {
    period_month: number;
    period_year: number;
    gang_code: string;
    division_code?: string;
    gang_description?: string;
    total_upah_bersih?: number;
    total_upah_kotor?: number;
    total_hk?: number;
    total_premi?: number;
    total_premi_brondol?: number;
    total_premi_prunning?: number;
    total_premi_insentif?: number;
    total_premi_kinerja?: number;
    total_ffb_weight?: number;
    total_weight_tbs?: number;
    total_employees?: number;
};

/**
 * Dashboard service for payroll analytics and KPI aggregation.
 *
 * Data is sourced from the daftar_upah_aggregation_history table (extend_db_ptrj).
 * Aggregated reads must select the latest row per period/gang before summing.
 */

export class DashboardService {
    private static instance: DashboardService;
    private extendDb: Database;

    private constructor() {
        this.extendDb = Database.getInstance("extend_db_ptrj", Config.DB_EXTEND_PROFILE);
    }

    private latestAggregationRowsCte(): string {
        return `
            WITH latest_rows AS (
                SELECT
                    h.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY h.period_month, h.period_year, h.gang_code
                        ORDER BY COALESCE(h.updated_at, h.created_at) DESC, h.id DESC
                    ) as row_rank
                FROM dbo.daftar_upah_aggregation_history h
            )
        `;
    }

    public static getInstance(): DashboardService {
        if (!DashboardService.instance) {
            DashboardService.instance = new DashboardService();
        }
        return DashboardService.instance;
    }


    /**
     * Get 12-month trend for Wages, OT, Premi
     */
    public async getPayrollTrend(endMonth: number, endYear: number, gangScope: string = 'panen'): Promise<any[]> {
        // Calculate start period (12 months ago)
        let startMonth = endMonth + 1;
        let startYear = endYear - 1;
        if (startMonth > 12) {
            startMonth = 1;
            startYear = endYear;
        }

        // Query for 12-month trend (gang panen saja, basis upah kotor)
        // Tonase dibaca dari tabel division_tonase (sumber akurat per divisi dari mill supplier),
        // BUKAN dari total_ffb_weight baris gang (yang di-broadcast dan double-count).
        const query = `
            ${this.latestAggregationRowsCte()},
            tonase_periode AS (
                SELECT period_year, period_month, SUM(tonase) AS periode_tonase
                FROM dbo.division_tonase
                GROUP BY period_year, period_month
            )
            SELECT
                h.period_year,
                h.period_month,
                SUM(ISNULL(h.total_upah_kotor, 0)) as total_wage,
                SUM(ISNULL(h.total_lembur, 0)) as total_ot,
                SUM(ISNULL(h.total_premi, 0)) as total_premi,
                SUM(ISNULL(h.total_employees, 0)) as total_headcount,
                SUM(ISNULL(h.total_hk, 0)) as total_hk,
                ISNULL(MAX(tp.periode_tonase), 0) as total_tonase
            FROM latest_rows h
            LEFT JOIN tonase_periode tp
                ON tp.period_year = h.period_year AND tp.period_month = h.period_month
            WHERE
                h.row_rank = 1
                AND ${this.scopeGangSql('h.gang_code', gangScope)}
                AND
                (h.period_year > ? OR (h.period_year = ? AND h.period_month >= ?))
                AND (h.period_year < ? OR (h.period_year = ? AND h.period_month <= ?))
            GROUP BY h.period_year, h.period_month
            ORDER BY h.period_year, h.period_month
        `;

        // Logic check:
        // If end is 2025-05. Start is 2024-06.
        // WHERE (year > 2024 OR (year = 2024 AND month >= 6)) ...

        try {
            const rows = await this.extendDb.query<any>(query, [
                startYear, startYear, startMonth,
                endYear, endYear, endMonth
            ]);

            // Map keys to be friendly
            return rows.map(r => {
                const tonase = this.toReportNumber(r.total_tonase);
                const wage = this.toReportNumber(r.total_wage);
                const hk = this.toReportNumber(r.total_hk);
                return {
                    period: `${this.getMonthName(r.period_month)} ${r.period_year}`,
                    month: r.period_month,
                    year: r.period_year,
                    total_wage: wage,
                    total_ot: r.total_ot,
                    total_premi: r.total_premi,
                    total_headcount: r.total_headcount,
                    total_hk: hk,
                    total_tonase: tonase,
                    cost_per_ton: tonase > 0 ? wage / tonase : null,
                    cost_per_hk: hk > 0 ? wage / hk : null
                };
            });
        } catch (e) {
            console.error("[DashboardService] Error getting trend:", e);
            throw e;
        }
    }

    /**
     * Get current month division breakdown.
     *
     * Division universe = UNION of:
     *  - dbo.division_tonase (authoritative mill-supplier producers for the period)
     *  - panen aggregation rows (wage data, incl. divisions without tonase such as IJL)
     * A division that already produces tonase but has no aggregation row yet (payroll
     * not yet run) still appears, flagged upah_available = 0, so reports don't silently
     * drop real production (e.g. July 2026: AB1/AB2/ARA/ARC/DME).
     */
    public async getDivisionBreakdown(month: number, year: number, gangScope: string = 'panen'): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()},
            period_tonase AS (
                SELECT LTRIM(RTRIM(division_code)) AS division_code, SUM(tonase) AS tonase
                FROM dbo.division_tonase
                WHERE period_month = ? AND period_year = ?
                GROUP BY LTRIM(RTRIM(division_code))
            ),
            agg_div AS (
                SELECT
                    LTRIM(RTRIM(h.division_code)) AS division_code,
                    SUM(ISNULL(h.total_upah_kotor, 0)) as total_wage,
                    SUM(ISNULL(h.total_lembur, 0)) as total_ot,
                    SUM(ISNULL(h.total_premi, 0)) as total_premi,
                    SUM(ISNULL(h.total_employees, 0)) as headcount,
                    SUM(ISNULL(h.total_hk, 0)) as total_hk,
                    SUM(ISNULL(h.total_potongan, 0)) as total_potongan,
                    SUM(ISNULL(h.total_spsi, 0)) as total_spsi,
                    SUM(ISNULL(h.total_pph21, 0)) as total_pph21,
                    SUM(ISNULL(h.total_bpjs_pekerja, 0)) as total_bpjs_pekerja,
                    SUM(ISNULL(h.total_koreksi, 0)) as total_koreksi
                FROM latest_rows h
                WHERE h.row_rank = 1 AND ${this.scopeGangSql('h.gang_code', gangScope)} AND h.period_month = ? AND h.period_year = ?
                GROUP BY LTRIM(RTRIM(h.division_code))
            )
            SELECT
                COALESCE(t.division_code, a.division_code) AS division_code,
                ISNULL(a.total_wage, 0) as total_wage,
                ISNULL(a.total_ot, 0) as total_ot,
                ISNULL(a.total_premi, 0) as total_premi,
                ISNULL(a.headcount, 0) as headcount,
                ISNULL(a.total_hk, 0) as total_hk,
                ISNULL(a.total_potongan, 0) as total_potongan,
                ISNULL(a.total_spsi, 0) as total_spsi,
                ISNULL(a.total_pph21, 0) as total_pph21,
                ISNULL(a.total_bpjs_pekerja, 0) as total_bpjs_pekerja,
                ISNULL(a.total_koreksi, 0) as total_koreksi,
                ISNULL(t.tonase, 0) as total_tonase,
                CASE WHEN EXISTS (
                    SELECT 1 FROM dbo.daftar_upah_aggregation_history x
                    WHERE x.period_month = ? AND x.period_year = ?
                      AND LTRIM(RTRIM(x.division_code)) = LTRIM(RTRIM(COALESCE(t.division_code, a.division_code)))
                ) THEN 1 ELSE 0 END as upah_available
            FROM period_tonase t
            FULL OUTER JOIN agg_div a ON a.division_code = t.division_code
            ORDER BY ISNULL(a.total_wage, 0) DESC
        `;
        const rows = await this.extendDb.query<any>(query, [month, year, month, year, month, year]);
        return rows;
    }

    /**
     * Get Top Gangs by Cost
     */
    public async getGangBreakdown(month: number, year: number, limit: number = 15, gangScope: string = 'panen'): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT TOP ${limit}
                h.gang_code,
                SUM(ISNULL(h.total_upah_kotor, 0)) as total_wage,
                SUM(ISNULL(h.total_lembur, 0)) as total_ot,
                SUM(ISNULL(h.total_employees, 0)) as headcount,
                SUM(ISNULL(h.total_ffb_weight, 0)) as total_tonase
            FROM latest_rows h
            WHERE h.row_rank = 1 AND ${this.scopeGangSql('h.gang_code', gangScope)} AND h.period_month = ? AND h.period_year = ?
            GROUP BY h.gang_code
            ORDER BY total_wage DESC
        `;
        return await this.extendDb.query<any>(query, [month, year]);
    }

    /**
     * Get Division Efficiency (Cost vs Headcount/WorkDays)
     */
    public async getDivisionEfficiency(month: number, year: number, gangScope: string = 'panen'): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                h.division_code,
                SUM(ISNULL(h.total_upah_kotor, 0)) as total_cost,
                SUM(ISNULL(h.total_employees, 0)) as headcount,
                SUM(ISNULL(h.total_hk, 0)) as total_man_days,
                ISNULL(dt.tonase, 0) as total_tonase
            FROM latest_rows h
            LEFT JOIN dbo.division_tonase dt
                ON dt.period_month = h.period_month AND dt.period_year = h.period_year
                AND LTRIM(RTRIM(dt.division_code)) = LTRIM(RTRIM(h.division_code))
            WHERE h.row_rank = 1 AND ${this.scopeGangSql('h.gang_code', gangScope)} AND h.period_month = ? AND h.period_year = ?
            GROUP BY h.division_code, dt.tonase
            HAVING SUM(ISNULL(h.total_employees, 0)) > 0
            ORDER BY total_cost DESC
        `;
        return await this.extendDb.query<any>(query, [month, year]);
    }

    /**
     * Get 12-Month/Period Productivity Trend (Cost per HK)
     */
    public async getProductivityTrend(endMonth: number, endYear: number, gangScope: string = 'panen'): Promise<any[]> {
        const { startMonth, startYear } = this.getStartPeriod(endMonth, endYear);
        const query = `
            ${this.latestAggregationRowsCte()},
            tonase_periode AS (
                SELECT period_year, period_month, SUM(tonase) AS periode_tonase
                FROM dbo.division_tonase
                GROUP BY period_year, period_month
            )
            SELECT
                h.period_month,
                h.period_year,
                SUM(ISNULL(h.total_upah_kotor, 0)) as total_wage,
                SUM(ISNULL(h.total_hk, 0)) as total_hk,
                ISNULL(MAX(tp.periode_tonase), 0) as total_tonase
            FROM latest_rows h
            LEFT JOIN tonase_periode tp
                ON tp.period_year = h.period_year AND tp.period_month = h.period_month
            WHERE
                h.row_rank = 1
                AND ${this.scopeGangSql('h.gang_code', gangScope)}
                AND
                (h.period_year > ? OR (h.period_year = ? AND h.period_month >= ?))
                AND (h.period_year < ? OR (h.period_year = ? AND h.period_month <= ?))
            GROUP BY h.period_year, h.period_month
            ORDER BY h.period_year, h.period_month
        `;

        const rows = await this.extendDb.query<any>(query, [startYear, startYear, startMonth, endYear, endYear, endMonth]);

        return rows.map(r => ({
            period: `${this.getMonthName(r.period_month)} ${r.period_year}`,
            costPerHk: r.total_hk > 0 ? r.total_wage / r.total_hk : 0,
            costPerTon: r.total_tonase > 0 ? r.total_wage / r.total_tonase : 0,
            totalHk: r.total_hk,
            totalTonase: r.total_tonase
        }));
    }

    /**
     * Cross-division cost/ton timeline — flat (division × month) series.
     * Powers Act 6 small-multiples in CostPerTonStoryPage. Tonase from
     * division_tonase (authoritative, PTRJ01-09); plasma excluded via harvestGangSql.
     */
    public async getDivisionCostTrend(endMonth: number, endYear: number, span = 8, gangTypes: string[] = ['harvesting']): Promise<any[]> {
        let startMonth = endMonth - (span - 1);
        let startYear = endYear;
        while (startMonth <= 0) { startMonth += 12; startYear -= 1; }

        const query = `
            ${this.latestAggregationRowsCte()},
            tonase_per_div AS (
                SELECT period_year, period_month, division_code, tonase
                FROM dbo.division_tonase
            )
            SELECT
                h.period_year,
                h.period_month,
                LTRIM(RTRIM(h.division_code)) AS division_code,
                SUM(ISNULL(h.total_upah_kotor, 0)) AS total_wage,
                SUM(ISNULL(h.total_hk, 0)) AS total_hk,
                ISNULL(MAX(tpd.tonase), 0) AS total_tonase
            FROM latest_rows h
            LEFT JOIN tonase_per_div tpd
                ON tpd.period_year = h.period_year AND tpd.period_month = h.period_month
                AND LTRIM(RTRIM(tpd.division_code)) = LTRIM(RTRIM(h.division_code))
            WHERE
                h.row_rank = 1
                AND ${this.gangTypesSql('h.gang_code', gangTypes)}
                AND h.division_code IS NOT NULL
                AND LTRIM(RTRIM(h.division_code)) <> ''
                AND (h.period_year > ? OR (h.period_year = ? AND h.period_month >= ?))
                AND (h.period_year < ? OR (h.period_year = ? AND h.period_month <= ?))
            GROUP BY h.period_year, h.period_month, LTRIM(RTRIM(h.division_code))
            ORDER BY LTRIM(RTRIM(h.division_code)), h.period_year, h.period_month
        `;

        try {
            const rows = await this.extendDb.query<any>(query, [
                startYear, startYear, startMonth,
                endYear, endYear, endMonth
            ]);
            return rows.map(r => {
                const tonase = this.toReportNumber(r.total_tonase);
                const wage = this.toReportNumber(r.total_wage);
                const hk = this.toReportNumber(r.total_hk);
                return {
                    division_code: String(r.division_code).trim().toUpperCase(),
                    period: `${this.getMonthName(r.period_month)} ${r.period_year}`,
                    month: r.period_month,
                    year: r.period_year,
                    wage,
                    tonase,
                    hk,
                    cost_per_ton: tonase > 0 ? wage / tonase : null,
                    cost_per_hk: hk > 0 ? wage / hk : null
                };
            });
        } catch (e) {
            console.error("[DashboardService] Error getting division cost trend:", e);
            throw e;
        }
    }

    /**
     * Get Gang Wage Spikes (Anomaly Detection)
     * Compares Current Month vs Previous Month for Top 5 Gangs with highest Cost/HK increase
     */
    public async getWageSpikes(month: number, year: number, gangScope: string = 'panen'): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                h.gang_code,
                SUM(ISNULL(h.total_upah_kotor, 0)) as total_wage,
                SUM(ISNULL(h.total_hk, 0)) as total_hk
            FROM latest_rows h
            WHERE h.row_rank = 1 AND ${this.scopeGangSql('h.gang_code', gangScope)} AND h.period_month = ? AND h.period_year = ?
            GROUP BY h.gang_code
        `;

        let prevMonth = month - 1;
        let prevYear = year;
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear = year - 1;
        }

        const [currentRows, prevRows] = await Promise.all([
            this.extendDb.query<any>(query, [month, year]),
            this.extendDb.query<any>(query, [prevMonth, prevYear])
        ]);

        const prevMap = new Map<string, { wage: number, hk: number }>();
        prevRows.forEach(r => {
            prevMap.set(r.gang_code, { wage: r.total_wage, hk: r.total_hk });
        });

        const anomalies: any[] = [];

        currentRows.forEach(curr => {
            if (curr.total_hk > 0) {
                const currCostPerHk = curr.total_wage / curr.total_hk;
                const prev = prevMap.get(curr.gang_code);

                if (prev && prev.hk > 0) {
                    const prevCostPerHk = prev.wage / prev.hk;

                    if (prevCostPerHk > 10000) { // Ignore artifacts with tiny cost
                        const diff = currCostPerHk - prevCostPerHk;
                        const pct = (diff / prevCostPerHk) * 100;

                        // Threshold: > 15% increase and significant absolute diff
                        if (pct > 15 && diff > 5000) {
                            anomalies.push({
                                id: curr.gang_code,
                                name: curr.gang_code, // Gang name might be same as code or we fetch description if needed. For now Code is fine.
                                currentWage: currCostPerHk, // Showing Cost/HK
                                previousWage: prevCostPerHk,
                                percentage: pct,
                                difference: diff,
                                gang: 'Cost/HK Spike'
                            });
                        }
                    }
                }
            }
        });

        // Sort by Percentage Descending
        return anomalies.sort((a, b) => b.percentage - a.percentage).slice(0, 5);
    }

    private getMonthName(m: number): string {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return months[m - 1] || "";
    }

    private getStartPeriod(endMonth: number, endYear: number): { startMonth: number, startYear: number } {
        let startMonth = endMonth - 11;
        let startYear = endYear;

        if (startMonth <= 0) {
            startMonth += 12;
            startYear -= 1;
        }

        return { startMonth, startYear };
    }

    private getPeriodKey(month: number, year: number): string {
        return `${year}-${month.toString().padStart(2, "0")}`;
    }

    private getPeriodWindow(endMonth: number, endYear: number, count: number): TonaseReportPeriod[] {
        const periods: TonaseReportPeriod[] = [];

        for (let offset = count - 1; offset >= 0; offset -= 1) {
            const date = new Date(endYear, endMonth - 1 - offset, 1);
            const month = date.getMonth() + 1;
            const year = date.getFullYear();
            periods.push({
                month,
                year,
                key: this.getPeriodKey(month, year),
                label: `${this.getMonthName(month)} ${year}`
            });
        }

        return periods;
    }

    private toReportNumber(value: unknown): number {
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : 0;
    }

    private roundReportNumber(value: number, decimals: number = 0): number {
        const factor = Math.pow(10, decimals);
        return Math.round((value + Number.EPSILON) * factor) / factor;
    }

    private safeReportRatio(numerator: number, denominator: number, decimals: number = 0): number | null {
        if (!denominator || denominator <= 0) return null;
        return this.roundReportNumber(numerator / denominator, decimals);
    }

    /**
     * Classify gang by last letter
     * H = Harvesting (Panen)
     * T = Transport
     * M = Maintenance
     * 
     * Update: IJL gangs start with 'L'. 
     * If starts with 'L', we might classify it differently or just mark it as is_ijl.
     */
    /** SQL fragment: hanya gang panen (suffix H). Terapkan pada alias kolom gang_code. */
    private harvestGangSql(gangColumn: string): string {
        return `RIGHT(UPPER(LTRIM(RTRIM(${gangColumn}))), 1) = 'H'`;
    }
    /** SQL fragment untuk cakupan gang: panen (H) / maintenance (M) / transport (T) / all.
     * Catatan: tonase divisi dan cost_per_ton hanya bermakna pada scope panen. */
    private scopeGangSql(gangColumn: string, gangScope: string): string {
        if (gangScope === 'maintenance' || gangScope === 'transport' || gangScope === 'panen') {
            return this.gangTypesSql(gangColumn, [gangScope === 'panen' ? 'harvesting' : gangScope]);
        }
        return '1=1';
    }
    private gangTypesSql(gangColumn: string, types: string[]): string {
        const map: Record<string, string> = { harvesting: "'H'", transport: "'T'", maintenance: "'M'" };
        const letters = types.map(t => map[t]).filter(Boolean);
        if (letters.length === 0) return '1=0';
        if (letters.length === 3) return "RIGHT(UPPER(LTRIM(RTRIM(" + gangColumn + "))), 1) IN ('H','T','M')";
        return `RIGHT(UPPER(LTRIM(RTRIM(${gangColumn}))), 1) IN (${letters.join(',')})`;
    }

    private classifyGangType(gangCode: string): string {
        if (!gangCode || gangCode.length === 0) return 'uncategorized';

        const lastLetter = gangCode.slice(-1).toUpperCase();

        switch (lastLetter) {
            case 'H':
                return 'harvesting';
            case 'T':
                return 'transport';
            case 'M':
                return 'maintenance';
            default:
                // If starts with 'L', it might be harvesting/maintenance but uncategorized by suffix.
                // For now, return 'uncategorized' unless we have more rules.
                return 'uncategorized';
        }
    }

    /**
     * Check if gang is IJL (Starts with 'L')
     */
    private isIJL(gangCode: string): boolean {
        return gangCode?.toUpperCase().startsWith('L') || false;
    }

    /**
     * Get Cost per HK Comparison Report
     * Groups data by gang type (Harvesting/Transport/Maintenance)
     * Supports division filter (IJL/non-IJL)
     */
    public async getCostHKComparison(
        month: number,
        year: number,
        divisionFilter: string = 'ALL',
        gangCodes?: string[],
        gangTypeFilter?: string
    ): Promise<any> {
        try {
            // Build query with filters
            let whereConditions = ['period_month = ?', 'period_year = ?'];
            const params: any[] = [month, year];

            // Division filter - IJL gangs start with 'L'
            if (divisionFilter === 'IJL') {
                whereConditions.push("gang_code LIKE 'L%'");
            } else if (divisionFilter === 'NON_IJL') {
                whereConditions.push("gang_code NOT LIKE 'L%'");
            }

            // Gang Update: "Gang Panen" filter (requested as 'L' prefix or 'H' suffix?)
            // If gangTypeFilter is 'harvesting', we usually check suffix 'H'.
            // If user wants specific "Panen (L)" filter, we can handle it here or in frontend.
            // For now, let's strictly follow the suffix for Type, and Prefix for IJL/Div.

            // Gang Codes Filter
            if (gangCodes && gangCodes.length > 0) {
                const gangPlaceholders = gangCodes.map(() => '?').join(',');
                whereConditions.push(`gang_code IN (${gangPlaceholders})`);
                params.push(...gangCodes);
            }

            const whereClause = whereConditions.join(' AND ');

            // Query for gang-level data (gang_description already stored in aggregation table)
            const query = `
                ${this.latestAggregationRowsCte()}
                SELECT
                    agg.gang_code,
                    agg.division_code,
                    agg.gang_description,
                    SUM(ISNULL(agg.total_upah_kotor, 0)) as total_cost,
                    SUM(ISNULL(agg.total_lembur, 0)) as total_lembur,
                    SUM(ISNULL(agg.total_premi, 0)) as total_premi,
                    SUM(ISNULL(agg.total_hk, 0)) as total_hk,
                    SUM(ISNULL(agg.total_employees, 0)) as headcount
                FROM latest_rows agg
                WHERE agg.row_rank = 1 AND ${whereClause}
                GROUP BY agg.gang_code, agg.division_code, agg.gang_description
                ORDER BY agg.division_code, agg.gang_code
            `;

            const rows = await this.extendDb.query<any>(query, params);

            // Classify gangs and calculate Cost/HK
            let gangDetails = rows.map(row => {
                const costPerHK = row.total_hk > 0 ? row.total_cost / row.total_hk : 0;
                return {
                    gang_code: row.gang_code,
                    division_code: row.division_code,
                    gang_description: row.gang_description || '-',
                    gang_type: this.classifyGangType(row.gang_code),
                    is_ijl: this.isIJL(row.gang_code),
                    total_cost: row.total_cost,
                    total_lembur: row.total_lembur,
                    total_premi: row.total_premi,
                    total_hk: row.total_hk,
                    cost_per_hk: Math.round(costPerHK),
                    headcount: row.headcount
                };
            });

            // Filter by gang type if specified
            if (gangTypeFilter && gangTypeFilter !== 'ALL') {
                gangDetails = gangDetails.filter(g => g.gang_type === gangTypeFilter);
            }

            // Group by gang type for summary
            const summaryByType: Record<string, any> = {
                harvesting: { total_cost: 0, total_hk: 0, count: 0 },
                transport: { total_cost: 0, total_hk: 0, count: 0 },
                maintenance: { total_cost: 0, total_hk: 0, count: 0 },
                uncategorized: { total_cost: 0, total_hk: 0, count: 0 }
            };

            let grandTotalCost = 0;
            let grandTotalHK = 0;

            gangDetails.forEach(gang => {
                if (summaryByType[gang.gang_type]) {
                    summaryByType[gang.gang_type].total_cost += gang.total_cost;
                    summaryByType[gang.gang_type].total_hk += gang.total_hk;
                    summaryByType[gang.gang_type].count += 1;
                }
                grandTotalCost += gang.total_cost;
                grandTotalHK += gang.total_hk;
            });

            // Calculate cost per HK for each type
            const summary: Record<string, any> = {};
            Object.keys(summaryByType).forEach(type => {
                const data = summaryByType[type];
                summary[type] = {
                    ...data,
                    cost_per_hk: data.total_hk > 0 ? Math.round(data.total_cost / data.total_hk) : 0
                };
            });

            return {
                success: true,
                period: `${this.getMonthName(month)} ${year}`,
                division_filter: divisionFilter,
                summary,
                gang_details: gangDetails.sort((a, b) => a.gang_code.localeCompare(b.gang_code)), // Sort alphabetically by code
                grand_total: {
                    total_cost: grandTotalCost,
                    total_hk: grandTotalHK,
                    cost_per_hk: grandTotalHK > 0 ? Math.round(grandTotalCost / grandTotalHK) : 0
                }
            };
        } catch (e: any) {
            console.error("[DashboardService] Error getting cost/HK comparison:", e);
            throw e;
        }
    }

    /**
     * Get available gangs for filter dropdown
     */
    public async getAvailableGangs(month: number, year: number): Promise<any[]> {
        try {
            const query = `
                ${this.latestAggregationRowsCte()}
                SELECT DISTINCT
                    agg.gang_code,
                    agg.division_code,
                    agg.gang_description
                FROM latest_rows agg
                WHERE agg.row_rank = 1
                AND agg.period_month = ? AND agg.period_year = ?
                AND agg.gang_code IS NOT NULL
                AND agg.gang_code != ''
                ORDER BY agg.gang_code
            `;

            const rows = await this.extendDb.query<any>(query, [month, year]);

            return rows.map(row => ({
                gang_code: row.gang_code,
                division_code: row.division_code,
                gang_description: row.gang_description || '-',
                gang_type: this.classifyGangType(row.gang_code),
                is_ijl: this.isIJL(row.gang_code)
            }));
        } catch (e: any) {
            console.error("[DashboardService] Error getting available gangs:", e);
            throw e;
        }
    }

    /**
     * Get Latest Available Data Period
     */
    public async getLatestPeriod(): Promise<{ month: number, year: number }> {
        const query = `
            SELECT TOP 1 period_month, period_year 
            FROM dbo.daftar_upah_aggregation_history 
            ORDER BY period_year DESC, period_month DESC
        `;
        const result = await this.extendDb.query<any>(query);
        if (result.length > 0) {
            return { month: result[0].period_month, year: result[0].period_year };
        }
        return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
    }

    /**
     * Get All Available Data Periods
     */
    public async getAvailablePeriods(): Promise<{ month: number, year: number }[]> {
        const query = `
            SELECT DISTINCT period_month, period_year 
            FROM dbo.daftar_upah_aggregation_history 
            ORDER BY period_year DESC, period_month DESC
        `;
        const result = await this.extendDb.query<any>(query);
        return result.map(r => ({ month: r.period_month, year: r.period_year }));
    }

    /**
     * Get Filter Options (Divisions and Gangs)
     */
    public async getFilterOptions(month: number, year: number): Promise<{ divisions: string[], gangs: string[] }> {
        const divQuery = `
            ${this.latestAggregationRowsCte()}
            SELECT DISTINCT h.division_code
            FROM latest_rows h
            WHERE h.row_rank = 1 AND h.period_month = ? AND h.period_year = ?
            ORDER BY h.division_code
        `;

        const gangQuery = `
            ${this.latestAggregationRowsCte()}
            SELECT DISTINCT h.gang_code
            FROM latest_rows h
            WHERE h.row_rank = 1 AND h.period_month = ? AND h.period_year = ?
            ORDER BY h.gang_code
        `;

        const [divs, gangs] = await Promise.all([
            this.extendDb.query<any>(divQuery, [month, year]),
            this.extendDb.query<any>(gangQuery, [month, year])
        ]);

        return {
            divisions: divs.map(d => d.division_code),
            gangs: gangs.map(g => g.gang_code)
        };
    }

    /**
     * Get Comparison Data for selected entities
     */
    public async getComparisonData(type: 'division' | 'gang', codes: string[], month: number, year: number): Promise<any[]> {
        if (!codes || codes.length === 0) return [];

        const column = type === 'division' ? 'division_code' : 'gang_code';

        // Dynamic IN clause placeholder using ?
        const placeholders = codes.map(() => '?').join(',');

        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                h.${column} as name,
                SUM(ISNULL(h.total_upah_kotor, 0)) as total_wage,
                SUM(ISNULL(h.total_lembur, 0)) as total_ot,
                SUM(ISNULL(h.total_hk, 0)) as total_hk,
                SUM(ISNULL(h.total_employees, 0)) as headcount
            FROM latest_rows h
            WHERE h.row_rank = 1
              AND h.period_month = ?
              AND h.period_year = ?
              AND h.${column} IN (${placeholders})
            GROUP BY h.${column}
        `;

        const params = [month, year, ...codes];
        const rows = await this.extendDb.query<any>(query, params);

        return rows.map(r => ({
            name: r.name,
            total_wage: r.total_wage,
            total_ot: r.total_ot,
            total_hk: r.total_hk,
            cost_per_hk: r.total_hk > 0 ? r.total_wage / r.total_hk : 0,
            headcount: r.headcount
        }));
    }

    /**
     * Get Aggregated Gang Data for Comprehensive Analysis
     * Used for KPI cards to ensure consistency with Executive Dashboard
     */
    public async getAggregatedGangData(divisionCode: string, month: number, year: number): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                agg.gang_code,
                agg.gang_description,
                SUM(ISNULL(agg.total_upah_kotor, 0)) as total_wage,
                SUM(ISNULL(agg.total_lembur, 0)) as total_ot,
                SUM(ISNULL(agg.total_premi, 0)) as total_premi,
                SUM(ISNULL(agg.total_hk, 0)) as total_hk,
                SUM(ISNULL(agg.total_employees, 0)) as headcount
            FROM latest_rows agg
            WHERE agg.row_rank = 1 AND agg.period_month = ? AND agg.period_year = ?
            ${divisionCode && divisionCode !== 'ALL' ? `AND agg.division_code IN (${gangService.getAllDivisionAliases(divisionCode).map(() => '?').join(',')})` : ''}
            GROUP BY agg.gang_code, agg.gang_description
            ORDER BY agg.gang_code
        `;

        const params: (string | number)[] = [month, year];
        if (divisionCode && divisionCode !== 'ALL') {
            params.push(...gangService.getAllDivisionAliases(divisionCode));
        }

        const rows = await this.extendDb.query<any>(query, params);
        return rows.map(r => ({
            gang_code: r.gang_code,
            description: r.gang_description || r.gang_code,
            total_wage: r.total_wage,
            total_ot: r.total_ot,
            total_premi: r.total_premi,
            total_hk: r.total_hk,
            total_employees: r.headcount
        }));
    }

    /**
     * Get Premi Analysis (Breakdown by Type) - Including Dynamic Premi from JSON
     */
    public async getPremiAnalysis(month: number, year: number, divisionCode?: string): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                SUM(ISNULL(h.total_premi_brondol, 0)) as brondol,
                SUM(ISNULL(h.total_premi_prunning, 0)) as pruning,
                SUM(ISNULL(h.total_premi_insentif, 0)) as insentif,
                SUM(ISNULL(h.total_premi_kinerja, 0)) as kinerja,
                SUM(ISNULL(h.total_premi, 0)) as total,
                h.dynamic_premi_data
            FROM latest_rows h
            WHERE h.row_rank = 1 AND h.period_month = ? AND h.period_year = ?
            ${divisionCode && divisionCode !== 'ALL' ? `AND h.division_code IN (${gangService.getAllDivisionAliases(divisionCode).map(() => '?').join(',')})` : ''}
            GROUP BY h.dynamic_premi_data
        `;

        const params: (string | number)[] = [month, year];
        if (divisionCode && divisionCode !== 'ALL') {
            params.push(...gangService.getAllDivisionAliases(divisionCode));
        }

        const rows = await this.extendDb.query<any>(query, params);

        if (rows.length === 0) return [];

        // Aggregate all rows (multiple gangs may have different dynamic_premi_data structures)
        let totalBrondol = 0, totalPruning = 0, totalInsentif = 0, totalKinerja = 0, grandTotal = 0;
        const dynamicPremiTotals: Record<string, number> = {};

        for (const row of rows) {
            totalBrondol += row.brondol || 0;
            totalPruning += row.pruning || 0;
            totalInsentif += row.insentif || 0;
            totalKinerja += row.kinerja || 0;
            grandTotal += row.total || 0;

            // Parse dynamic_premi_data JSON
            // Structure from payrollDataService: [{header: string, total: number}]
            if (row.dynamic_premi_data) {
                try {
                    const dynamicData = typeof row.dynamic_premi_data === 'string'
                        ? JSON.parse(row.dynamic_premi_data)
                        : row.dynamic_premi_data;

                    if (Array.isArray(dynamicData)) {
                        for (const item of dynamicData) {
                            // payrollDataService uses {header, total} structure
                            const key = item.header || item.name || item.key || 'Unknown';
                            const value = item.total || item.value || item.amount || 0;
                            if (value > 0) {
                                dynamicPremiTotals[key] = (dynamicPremiTotals[key] || 0) + value;
                            }
                        }
                    } else if (typeof dynamicData === 'object') {
                        for (const [key, value] of Object.entries(dynamicData)) {
                            if (typeof value === 'number' && value > 0) {
                                dynamicPremiTotals[key] = (dynamicPremiTotals[key] || 0) + value;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[DashboardService] Failed to parse dynamic_premi_data:', e);
                }
            }
        }

        // Build result array
        const result: { name: string; value: number }[] = [
            { name: 'Brondol', value: totalBrondol },
            { name: 'Pruning', value: totalPruning },
            { name: 'Insentif', value: totalInsentif },
            { name: 'Kinerja', value: totalKinerja }
        ];

        // Add dynamic premi types
        for (const [key, value] of Object.entries(dynamicPremiTotals)) {
            // Avoid duplicating known premi types
            const normalizedKey = key.toLowerCase().replace(/[_\s]/g, '');
            if (!['brondol', 'pruning', 'insentif', 'kinerja'].includes(normalizedKey)) {
                result.push({ name: key.replace(/_/g, ' ').toUpperCase(), value });
            }
        }

        // Calculate "Other" premi (Total - all known components)
        const sumKnown = result.reduce((sum, item) => sum + item.value, 0);
        const other = grandTotal - sumKnown;
        if (other > 0) {
            result.push({ name: 'Lainnya', value: other });
        }

        // Sort by value descending and filter out zeros
        return result.filter(item => item.value > 0).sort((a, b) => b.value - a.value);
    }

    /**
     * Get Premi Comparison by Division
     */
    public async getPremiByDivision(month: number, year: number): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                h.division_code,
                SUM(ISNULL(h.total_premi_brondol, 0)) as brondol,
                SUM(ISNULL(h.total_premi_prunning, 0)) as pruning,
                SUM(ISNULL(h.total_premi_insentif, 0)) as insentif,
                SUM(ISNULL(h.total_premi_kinerja, 0)) as kinerja,
                SUM(ISNULL(h.total_premi, 0)) as total
            FROM latest_rows h
            WHERE h.row_rank = 1 AND h.period_month = ? AND h.period_year = ?
            GROUP BY h.division_code
            ORDER BY total DESC
        `;

        const rows = await this.extendDb.query<any>(query, [month, year]);

        return rows.map(r => ({
            division: r.division_code,
            brondol: r.brondol,
            pruning: r.pruning,
            insentif: r.insentif,
            kinerja: r.kinerja,
            total: r.total
        }));
    }

    /**
     * Get Overtime Analysis (Breakdown by Task Type)
     */
    public async getOvertimeAnalysis(month: number, year: number, divisionCode?: string): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                h.division_code,
                SUM(ISNULL(h.total_lembur, 0)) as total_lembur
            FROM latest_rows h
            WHERE h.row_rank = 1 AND h.period_month = ? AND h.period_year = ?
            ${divisionCode && divisionCode !== 'ALL' ? `AND h.division_code IN (${gangService.getAllDivisionAliases(divisionCode).map(() => '?').join(',')})` : ''}
            GROUP BY h.division_code
            ORDER BY total_lembur DESC
        `;

        const params: (string | number)[] = [month, year];
        if (divisionCode && divisionCode !== 'ALL') {
            params.push(...gangService.getAllDivisionAliases(divisionCode));
        }

        const rows = await this.extendDb.query<any>(query, params);

        if (rows.length === 0) return [];

        // If single division, return total overtime
        if (divisionCode && divisionCode !== 'ALL') {
            return [{
                name: 'Total Lembur',
                value: rows[0]?.total_lembur || 0
            }];
        }

        // Return breakdown by division
        return rows.map(r => ({
            name: r.division_code,
            value: r.total_lembur || 0
        })).filter(item => item.value > 0);
    }

    /**
     * Get Detailed Division Data (Employee List + Breakdown)
     */
    public async getDivisionDetailData(month: number, year: number, divisionCode: string): Promise<any> {
        // 1. Fetch raw employee data using DataExtractorService
        // Build gang condition dari daftar gang DIVISI yang sebenarnya (bukan prefix GangCode).
        // Naive `GangCode LIKE 'ARA%'` SAMA SEKALI TIDAK cocok — gang ARA adalah F1C*, PG1A dst juga beda.
        // Pakai gangService.fetchGangs(division) (path yang sama dipakai endpoint /payroll/gangs yang jalan).
        const gangRows = await gangService.fetchGangs(divisionCode);
        let gangCondition: string;
        if (gangRows && gangRows.length > 0) {
            const codes = gangRows.map((g: any) => `'${String(g.gang_code).trim().toUpperCase()}'`).join(',');
            gangCondition = `(UPPER(RTRIM(gl.GangCode)) IN (${codes}) OR UPPER(RTRIM(g.GangCode)) IN (${codes}))`;
        } else {
            // Fallback: jangan ke LIKE prefix (salah untuk ARA/F-codes); pakai 1=0 supaya tidak salah saji.
            gangCondition = "1=0";
        }

        const employees = await dataExtractorService.getEmployees(gangCondition, month, year, undefined, false);

        if (!employees || employees.length === 0) {
            return {
                employees: [],
                overtimeBreakdown: []
            };
        }

        // 2. Process Employee List for Frontend — uraian gaji lengkap (sesuai kolom custom payroll table)
        const employeeList = employees.map((emp: any) => ({
            nik: emp.nik,
            emp_code: emp.emp_code,
            name: emp.nama,
            gang: emp.gang_code,
            role: emp.jabatan_estate || 'N/A',
            // Financials
            hk: emp.jumlah_hk || 0,
            gaji_pokok: emp.gaji_pokok_aktual || emp.gaji_pokok || 0,
            tunjangan: emp.total_tunjangan || 0,
            premi: emp.total_premi || 0,
            lembur: emp.lembur_jumlah || 0,
            potongan: emp.total_potongan_bersih || 0,
            upah_bersih: emp.upah_bersih || 0,
            lembur_jam: emp.lembur_jam || 0,
            // Uraian lengkap untuk drill-down karyawan
            breakdown: {
                gaji_pokok_aktual: emp.gaji_pokok_aktual || 0,
                beras_jumlah: emp.beras_jumlah || 0,
                jabatan_jumlah: emp.jabatan_jumlah || 0,
                masa_kerja_jumlah: emp.masa_kerja_jumlah || 0,
                lembur_jumlah: emp.lembur_jumlah || 0,
                total_tunjangan: emp.total_tunjangan || 0,
                total_premi: emp.total_premi || 0,
                pot_koreksi: emp.pot_koreksi || 0,
                pendapatan_lainnya: emp.pendapatan_lainnya || 0,
                pot_astek_pekerja: emp.pot_astek_pekerja || 0,
                pot_bpjs_kesehatan_pekerja: emp.pot_bpjs_kesehatan_pekerja || 0,
                pot_bpjs_pensiun_pekerja: emp.pot_bpjs_pensiun_pekerja || 0,
                pot_spsi: emp.pot_spsi || 0,
                pot_pph21: emp.pot_pph21 || 0,
                pot_premi_pph: emp.pot_premi_pph || 0,
                upah_kotor: emp.upah_kotor || 0,
                jumlah_upah_kotor: emp.jumlah_upah_kotor || 0,
                total_potongan: emp.total_potongan || 0,
                upah_bersih: emp.upah_bersih || 0
            },
            // Uraian tiap premi (per jenis, digabung per normalized_key)
            premi_items: (() => {
                const map = new Map();
                for (const d of (emp.premi_details || [])) {
                    const key = d.normalized_key || d.doc_desc || 'LAINNYA';
                    const label = d.task_desc || d.doc_desc || key;
                    const cur = map.get(key) || { key, label, amount: 0 };
                    cur.amount += Number(d.amount) || 0;
                    map.set(key, cur);
                }
                return [...map.values()].filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
            })()
        }));

        // 3. Aggregate Overtime by Task Type
        // We iterate through lembur_records of all employees
        const otMap = new Map<string, { hours: number, amount: number, count: number }>();

        employees.forEach((emp: any) => {
            if (emp.lembur_records && Array.isArray(emp.lembur_records)) {
                emp.lembur_records.forEach((rec: any) => {
                    const taskDesc = rec.task_desc || rec.task_code || 'LAINNYA';
                    const current = otMap.get(taskDesc) || { hours: 0, amount: 0, count: 0 };

                    current.hours += (rec.hours || 0);
                    current.amount += (rec.amount || 0);
                    current.count += 1;

                    otMap.set(taskDesc, current);
                });
            }
        });

        const overtimeBreakdown = Array.from(otMap.entries())
            .map(([name, data]) => ({
                name,
                value: data.amount,
                hours: data.hours,
                count: data.count
            }))
            .sort((a, b) => b.value - a.value);

        return {
            employees: employeeList,
            overtimeBreakdown
        };
    }

    /**
     * Get Gang Comparison Data for Charts
     */
    // ... existing code ...

    /**
     * Get Gang Comparison Data with Production from Mill
     */
    /**
     * Get Gang Comparison Data with Production from Mill
     */
    public async getGangComparison(
        month: number,
        year: number,
        divisionCode?: string,
        gangScope?: string
    ) {
        // 1. Fetch Aggregation Data (Cost & Headcount)
        let sql = `
            ${this.latestAggregationRowsCte()}
            SELECT
                agg.gang_code,
                agg.gang_description,
                SUM(ISNULL(agg.total_upah_kotor, 0)) as total_wage,
                SUM(ISNULL(agg.total_hk, 0)) as total_hk,
                SUM(ISNULL(agg.total_employees, 0)) as headcount,
                SUM(ISNULL(agg.total_lembur, 0)) as total_ot,
                SUM(ISNULL(agg.total_premi, 0)) as total_premi,
                SUM(ISNULL(agg.total_ffb_weight, 0)) as total_production_db
            FROM latest_rows agg
            WHERE agg.row_rank = 1 AND agg.period_month = ? AND agg.period_year = ?
        `;

        const params: any[] = [month, year];

        // Scope 'panen': hanya gang suffix 'H' (konvensi harvestGangSql, sama seperti getPayrollTrend).
        // 'all' atau undefined: tanpa filter (perilaku lama, backward compatible).
        if (gangScope === 'panen' || gangScope === 'maintenance' || gangScope === 'transport') {
            sql += ` AND ` + this.scopeGangSql('agg.gang_code', gangScope);
        }

        if (divisionCode && divisionCode !== 'ALL') {
            if (divisionCode === 'IJL') {
                sql += " AND agg.division_code LIKE 'L%'";
            } else if (divisionCode === 'NON_IJL') {
                sql += " AND agg.division_code NOT LIKE 'L%'";
            } else {
                // Use unified division mapping for regular divisions
                const aliases = gangService.getAllDivisionAliases(divisionCode);
                sql += ` AND agg.division_code IN (${aliases.map(() => '?').join(',')})`;
                params.push(...aliases);
            }
        }

        sql += `
            GROUP BY agg.gang_code, agg.gang_description
            HAVING SUM(ISNULL(agg.total_employees, 0)) >= 0
            ORDER BY total_wage DESC
        `;

        // Use extendDb which is likely initialized in constructor
        const aggData = await this.extendDb.query<any>(sql, params);

        // 2. Fetch Real Production Data from Mill (WM_TICKET) -> Driver -> Gang
        const productionMap = await this.getGangProduction(month, year);

        // 3. Fetch Harvester FFB Bunches Data
        const bunchesMap = await this.getHarvesterBunches(month, year);

        // 4. Merge Data
        const mergedData = aggData.map(row => {
            const cleanGangCode = row.gang_code.trim();
            const realProductionKg = productionMap.get(cleanGangCode) || 0;
            const totalProduction = row.total_production_db > 0 ? row.total_production_db : realProductionKg;

            // Get FFB bunches data for harvesting gangs
            const bunchesData = bunchesMap.get(cleanGangCode);
            const totalBunches = bunchesData?.totalBunches || 0;
            const harvesterCount = bunchesData?.employeeCount || 0;

            const costPerHk = row.total_hk > 0 ? row.total_wage / row.total_hk : 0;
            // cost_per_ton per gang is NOT valid: total_production_db is broadcast total_ffb_weight
            // (tonase is a division property, copied to every gang). cost/ton is valid per DIVISI only.
            // Kept as null with a note so the UI can show "valid per divisi" instead of a misleading number.
            const costPerTon = null;

            return {
                gang_code: cleanGangCode,
                gang_description: row.gang_description,
                gang_type: 'uncategorized', // Default for now as column missing in DB
                total_wage: row.total_wage,
                total_hk: row.total_hk,
                headcount: row.headcount,
                total_ot: row.total_ot,
                total_premi: row.total_premi,
                total_production: totalProduction,
                total_ffb_bunches: totalBunches,
                harvester_count: harvesterCount,
                cost_per_hk: costPerHk,
                cost_per_ton: costPerTon,
                cost_per_ton_note: 'Cost/ton valid per divisi, bukan per gang (tonase = properti divisi)'
            };
        });

        return mergedData.sort((a, b) => b.cost_per_hk - a.cost_per_hk);
    }

    /**
     * Fetch Production Data (NetWeight) from WM_TICKET 
     * aggregated by Transport Gang (via Driver)
     */
    private async getGangProduction(month: number, year: number): Promise<Map<string, number>> {
        const gangProduction = new Map<string, number>();
        const dbMill = Database.getMillInstance();
        const dbPayroll = Database.getInstance();

        try {
            const ticketQuery = `
                SELECT 
                    DriverCode, 
                    SUM(CAST(NetWeight AS BIGINT)) as TotalWeight
                FROM [dbo].[WM_TICKET]
                WHERE MONTH(DateReceived) = ? AND YEAR(DateReceived) = ?
                  AND DriverCode IS NOT NULL AND DriverCode <> ''
                GROUP BY DriverCode
            `;

            const driverWeights = await dbMill.query<{ DriverCode: string, TotalWeight: number }>(ticketQuery, [month, year]);

            if (driverWeights.length === 0) return gangProduction;

            const driverCodes = [...new Set(driverWeights.map(d => d.DriverCode))];

            const driverGangMap = new Map<string, string>();

            if (driverCodes.length > 0) {
                // Formatting for IN clause
                const codeList = driverCodes.map(c => `'${c.replace("'", "''")}'`).join(",");
                const gangQuery = `
                    SELECT TRIM(GangMember) as EmpCode, TRIM(GangCode) as GangCode
                    FROM HR_GANGLN 
                    WHERE GangMember IN (${codeList})
                `;

                const mappings = await dbPayroll.query<{ EmpCode: string, GangCode: string }>(gangQuery);
                mappings.forEach(m => {
                    driverGangMap.set(m.EmpCode, m.GangCode);
                });
            }

            for (const dw of driverWeights) {
                const gangCode = driverGangMap.get(dw.DriverCode.trim());
                if (gangCode) {
                    const current = gangProduction.get(gangCode) || 0;
                    // Ensure TotalWeight is treated as number (it might come as string from BigInt)
                    const weight = Number(dw.TotalWeight) || 0;
                    gangProduction.set(gangCode, current + weight);
                }
            }


        } catch (error) {
            console.error("[DashboardService] Error fetching gang production:", error);
        }

        return gangProduction;
    }

    /**
     * Get Harvester FFB Bunches Data
     * Fetches TotalBunches from PR_HARVESTERLN_ARC joined with PR_HARVESTER_ARC
     * Returns Map<GangCode, { totalBunches, employeeCount }>
     */
    private async getHarvesterBunches(month: number, year: number): Promise<Map<string, { totalBunches: number; employeeCount: number }>> {
        const gangBunches = new Map<string, { totalBunches: number; employeeCount: number }>();

        // Use default database profile for harvester data
        const dbHarvester = Database.getInstance();

        try {
            const query = `
                SELECT
                    h.GangCode,
                    COUNT(DISTINCT hl.EmpCode) as EmpCount,
                    SUM(ISNULL(hl.TotalBunches, 0)) as TotalBunches
                FROM PR_HARVESTERLN_ARC hl
                JOIN PR_HARVESTER_ARC h ON hl.MasterID = h.ID
                WHERE h.AccYear = ? AND h.AccMonth = ?
                GROUP BY h.GangCode
            `;

            const rows = await dbHarvester.query<{ GangCode: string; EmpCount: number; TotalBunches: number }>(query, [year.toString(), month.toString()]);

            for (const row of rows) {
                const gangCode = row.GangCode?.trim() || "";
                if (gangCode) {
                    gangBunches.set(gangCode, {
                        totalBunches: row.TotalBunches || 0,
                        employeeCount: row.EmpCount || 0
                    });
                }
            }
        } catch (error) {
            console.error("[DashboardService] Error fetching harvester bunches:", error);
        }

        return gangBunches;
    }

    /**
     * Get Top and Bottom Performing Gangs
     */
    public async getTonaseAnalysisReport(
        month: number,
        year: number,
        divisionCode?: string
    ): Promise<any> {
        const periods = this.getPeriodWindow(month, year, 5);
        const startPeriod = periods[0];
        const endPeriod = periods[periods.length - 1];

        const normalizedScope = String(divisionCode || "REBINMAS").trim().toUpperCase();
        const effectiveScope = normalizedScope === "NON_IJL" || normalizedScope === "NON-IJL"
            ? "REBINMAS"
            : normalizedScope;
        const params: any[] = [
            startPeriod.year,
            startPeriod.year,
            startPeriod.month,
            endPeriod.year,
            endPeriod.year,
            endPeriod.month
        ];

        let divisionFilter = "";
        if (effectiveScope !== "ALL") {
            if (effectiveScope === "IJL") {
                divisionFilter = "AND agg.division_code LIKE 'L%'";
            } else if (effectiveScope === "REBINMAS") {
                divisionFilter = "AND agg.division_code NOT LIKE 'L%'";
            } else {
                const aliases = gangService.getAllDivisionAliases(effectiveScope);
                divisionFilter = `AND agg.division_code IN (${aliases.map(() => "?").join(",")})`;
                params.push(...aliases);
            }
        }

        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT
                agg.period_month,
                agg.period_year,
                agg.gang_code,
                agg.division_code,
                agg.gang_description,
                SUM(ISNULL(agg.total_upah_bersih, 0)) as total_upah_bersih,
                SUM(ISNULL(agg.total_upah_kotor, 0)) as total_upah_kotor,
                SUM(ISNULL(agg.total_hk, 0)) as total_hk,
                SUM(ISNULL(agg.total_premi, 0)) as total_premi,
                SUM(ISNULL(agg.total_premi_brondol, 0)) as total_premi_brondol,
                SUM(ISNULL(agg.total_premi_prunning, 0)) as total_premi_prunning,
                SUM(ISNULL(agg.total_premi_insentif, 0)) as total_premi_insentif,
                SUM(ISNULL(agg.total_premi_kinerja, 0)) as total_premi_kinerja,
                SUM(ISNULL(agg.total_ffb_weight, 0)) as total_ffb_weight,
                SUM(ISNULL(agg.total_weight_tbs, 0)) as total_weight_tbs,
                SUM(ISNULL(agg.total_employees, 0)) as total_employees
            FROM latest_rows agg
            WHERE
                agg.row_rank = 1
                AND (agg.period_year > ? OR (agg.period_year = ? AND agg.period_month >= ?))
                AND (agg.period_year < ? OR (agg.period_year = ? AND agg.period_month <= ?))
                ${divisionFilter}
            GROUP BY
                agg.period_month,
                agg.period_year,
                agg.gang_code,
                agg.division_code,
                agg.gang_description
            ORDER BY agg.period_year, agg.period_month, agg.gang_code
        `;

        const rows = await this.extendDb.query<TonaseAggregationRow>(query, params);
        const productionByPeriod = new Map<string, Map<string, number>>();

        await Promise.all(periods.map(async (period) => {
            productionByPeriod.set(period.key, await this.getGangProduction(period.month, period.year));
        }));

        // Fetch authoritative per-division tonase from division_tonase (mill supplier, internal PTRJ01-09).
        // Replaces broadcast total_ffb_weight aggregation which double-counts when divisions have >1 gang panen.
        const divisionTonaseMap = new Map<string, number>(); // key: `${periodKey}::${DIVISION_CODE}` -> tonase
        try {
            const dtRows = await this.extendDb.query<{ period_month: number; period_year: number; division_code: string; tonase: number }>(`
                SELECT period_month, period_year, LTRIM(RTRIM(division_code)) AS division_code, SUM(tonase) AS tonase
                FROM dbo.division_tonase
                GROUP BY period_month, period_year, LTRIM(RTRIM(division_code))
            `);
            for (const r of dtRows || []) {
                const pk = this.getPeriodKey(Number(r.period_month), Number(r.period_year));
                divisionTonaseMap.set(`${pk}::${String(r.division_code).trim().toUpperCase()}`, this.toReportNumber(r.tonase));
            }
        } catch (e) {
            console.warn('[DashboardService] division_tonase unavailable, falling back to broadcast:', (e as Error).message);
        }
        // Division universe per period: ALL divisions in division_tonase (authoritative producers)
        // plus every division that appears in aggregation rows (e.g. IJL, WKS without mill tonase).
        // Divisions producing tonase but without aggregation rows yet (payroll not run) stay visible,
        // flagged upah_available = 0 — never silently dropped (e.g. July 2026: AB1/AB2/ARA/ARC/DME).
        const dtDivsByPeriod = new Map<string, Set<string>>();
        for (const key of divisionTonaseMap.keys()) {
            const sep = key.lastIndexOf('::');
            const pk = key.slice(0, sep);
            const code = key.slice(sep + 2);
            if (!dtDivsByPeriod.has(pk)) dtDivsByPeriod.set(pk, new Set());
            dtDivsByPeriod.get(pk)!.add(code);
        }
        const aggDivsByPeriod = new Map<string, Set<string>>();
        const getAuthoritativeTonase = (periodKey: string, divisionCode: string): number | null => {
            const v = divisionTonaseMap.get(`${periodKey}::${String(divisionCode || 'UNKNOWN').trim().toUpperCase()}`);
            return v === undefined ? null : v;
        };

        const periodTotals = new Map<string, any>();
        periods.forEach(period => {
            periodTotals.set(period.key, {
                period_key: period.key,
                month: period.month,
                year: period.year,
                label: period.label,
                total_tonase: 0,
                total_ffb_weight: 0,
                total_hk: 0,
                total_upah_bersih: 0,
                total_upah_kotor: 0,
                total_premi: 0,
                total_employees: 0,
                gang_count: 0,
                missing_tonase_count: 0
            });
        });

        const tonaseByPeriodDivision = new Map<string, Map<string, number[]>>();
        const selectedPeriodKey = this.getPeriodKey(month, year);
        const currentDivisionTotals = new Map<string, any>();
        const getCurrentDivisionTotal = (divisionCode: string) => {
            const normalizedDivisionCode = String(divisionCode || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
            if (!currentDivisionTotals.has(normalizedDivisionCode)) {
                currentDivisionTotals.set(normalizedDivisionCode, {
                    division_code: normalizedDivisionCode,
                    total_tonase: 0,
                    total_hk: 0,
                    total_upah_bersih: 0,
                    total_upah_kotor: 0,
                    total_premi: 0,
                    total_employees: 0,
                    gang_count: 0,
                    upah_available: 0
                });
            }
            return currentDivisionTotals.get(normalizedDivisionCode)!;
        };
        const summarizeTonaseValues = (values: number[]) => {
            const positiveValues = values.filter(value => value > 0);
            if (positiveValues.length === 0) return 0;

            const uniqueValues = [...new Set(positiveValues.map(value => this.roundReportNumber(value, 4)))];
            return uniqueValues.length === 1
                ? uniqueValues[0]
                : positiveValues.reduce((sum, value) => sum + value, 0);
        };
        const currentRows: Array<TonaseAggregationRow & { effective_ffb_weight: number }> = [];
        const divisionPeriodTotals = new Map<string, Map<string, any>>();
        const getDivisionPeriodTotal = (periodKey: string, divisionCode: string) => {
            const normalizedDivisionCode = String(divisionCode || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
            if (!divisionPeriodTotals.has(periodKey)) {
                divisionPeriodTotals.set(periodKey, new Map());
            }
            const periodMap = divisionPeriodTotals.get(periodKey)!;
            if (!periodMap.has(normalizedDivisionCode)) {
                periodMap.set(normalizedDivisionCode, {
                    period_key: periodKey,
                    division_code: normalizedDivisionCode,
                    total_tonase: 0,
                    total_hk: 0,
                    total_upah_bersih: 0,
                    total_upah_kotor: 0,
                    total_premi: 0,
                    total_employees: 0,
                    gang_count: 0,
                    upah_available: 0
                });
            }
            return periodMap.get(normalizedDivisionCode)!;
        };
        const currentDetailRows: Array<TonaseAggregationRow & {
            effective_ffb_weight: number;
            normalized_gang_code: string;
            normalized_division_code: string;
            gang_type: string;
        }> = [];

        for (const rawRow of rows) {
            const gangCode = String(rawRow.gang_code || "").trim();
            const periodKey = this.getPeriodKey(Number(rawRow.period_month), Number(rawRow.period_year));
            const periodTotal = periodTotals.get(periodKey);
            if (!periodTotal) continue;

            const productionFallback = productionByPeriod.get(periodKey)?.get(gangCode) || 0;
            const dbTonase = this.toReportNumber(rawRow.total_ffb_weight) || this.toReportNumber(rawRow.total_weight_tbs);
            const effectiveTonase = dbTonase > 0 ? dbTonase : productionFallback / 1000;
            const divisionKey = String(rawRow.division_code || gangCode || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
            if (!aggDivsByPeriod.has(periodKey)) aggDivsByPeriod.set(periodKey, new Set());
            aggDivsByPeriod.get(periodKey)!.add(divisionKey);
            const isCurrentPeriod = Number(rawRow.period_month) === month && Number(rawRow.period_year) === year;
            const gangType = this.classifyGangType(gangCode);
            if (isCurrentPeriod) {
                currentDetailRows.push({
                    ...rawRow,
                    effective_ffb_weight: effectiveTonase,
                    normalized_gang_code: gangCode,
                    normalized_division_code: divisionKey,
                    gang_type: gangType
                });
            }

            if (effectiveTonase > 0) {
                if (!tonaseByPeriodDivision.has(periodKey)) {
                    tonaseByPeriodDivision.set(periodKey, new Map());
                }
                const divisionMap = tonaseByPeriodDivision.get(periodKey)!;
                const values = divisionMap.get(divisionKey) || [];
                values.push(effectiveTonase);
                divisionMap.set(divisionKey, values);
            }

            if (gangType !== "harvesting") continue;

            const totalHk = this.toReportNumber(rawRow.total_hk);
            const totalUpahBersih = this.toReportNumber(rawRow.total_upah_bersih);
            const totalUpahKotor = this.toReportNumber(rawRow.total_upah_kotor);
            const totalPremi = this.toReportNumber(rawRow.total_premi);

            periodTotal.total_hk += totalHk;
            periodTotal.total_upah_bersih += totalUpahBersih;
            periodTotal.total_upah_kotor += totalUpahKotor;
            periodTotal.total_premi += totalPremi;
            periodTotal.total_employees += this.toReportNumber(rawRow.total_employees);
            periodTotal.gang_count += 1;
            const divisionPeriodTotal = getDivisionPeriodTotal(periodKey, divisionKey);
            divisionPeriodTotal.total_hk += totalHk;
            divisionPeriodTotal.total_upah_bersih += totalUpahBersih;
            divisionPeriodTotal.total_upah_kotor += totalUpahKotor;
            divisionPeriodTotal.total_premi += totalPremi;
            divisionPeriodTotal.total_employees += this.toReportNumber(rawRow.total_employees);
            divisionPeriodTotal.gang_count += 1;
            if (effectiveTonase <= 0 && (totalHk > 0 || totalUpahBersih > 0 || totalPremi > 0)) {
                periodTotal.missing_tonase_count += 1;
            }

            if (isCurrentPeriod) {
                currentRows.push({
                    ...rawRow,
                    gang_code: gangCode,
                    effective_ffb_weight: effectiveTonase
                });
                const divisionTotal = getCurrentDivisionTotal(divisionKey);
                divisionTotal.total_hk += totalHk;
                divisionTotal.total_upah_bersih += totalUpahBersih;
                divisionTotal.total_upah_kotor += totalUpahKotor;
                divisionTotal.total_premi += totalPremi;
                divisionTotal.total_employees += this.toReportNumber(rawRow.total_employees);
                divisionTotal.gang_count += 1;
                divisionTotal.upah_available = 1;
            }
        }

        for (const period of periods) {
            const periodTotal = periodTotals.get(period.key);
            if (!periodTotal) continue;

            const divisionMap = tonaseByPeriodDivision.get(period.key) || new Map();
            const dtDivs = dtDivsByPeriod.get(period.key) || new Set();
            const codes = new Set<string>([...divisionMap.keys(), ...dtDivs]);
            const aggDivs = aggDivsByPeriod.get(period.key) || new Set();

            let totalTonase = 0;
            let coveredTonase = 0;
            for (const divisionCode of codes) {
                // Authoritative division_tonase is the only valid source. null = non-producing
                // division (no PTRJ01-09 mill supplier) → tonase 0. Never fall back to broadcast
                // (which copies one division's tonase to all its gangs → contamination like WKS_AR).
                const authoritative = getAuthoritativeTonase(period.key, divisionCode);
                const divisionTonase = authoritative !== null ? authoritative : 0;
                const hasAgg = aggDivs.has(divisionCode);
                totalTonase += divisionTonase;
                if (hasAgg) coveredTonase += divisionTonase;
                const divTotal = getDivisionPeriodTotal(period.key, divisionCode);
                divTotal.total_tonase = divisionTonase;
                divTotal.upah_available = hasAgg ? 1 : 0;
                if (period.key === selectedPeriodKey) {
                    const currTotal = getCurrentDivisionTotal(divisionCode);
                    currTotal.total_tonase = divisionTonase;
                    currTotal.upah_available = hasAgg ? 1 : 0;
                }
            }

            periodTotal.total_tonase = totalTonase;
            periodTotal.total_ffb_weight = totalTonase;
            periodTotal.upah_covered_tonase = coveredTonase;
        }

        const trend = periods.map(period => {
            const total = periodTotals.get(period.key);
            const totalTonase = this.roundReportNumber(total.total_tonase, 2);
            // per-ton metrics use tonase of divisions that actually have payroll data
            // (upah_covered_tonase), so a month with partial aggregation (e.g. July 2026:
            // only 4 of 9 producing divisions) doesn't artificially dilute cost/ton.
            const coveredTonase = this.roundReportNumber(total.upah_covered_tonase, 2);
            return {
                ...total,
                total_tonase: totalTonase,
                upah_covered_tonase: coveredTonase,
                total_ffb_weight: this.roundReportNumber(total.total_ffb_weight, 2),
                total_hk: this.roundReportNumber(total.total_hk, 2),
                total_upah_bersih: this.roundReportNumber(total.total_upah_bersih),
                total_upah_kotor: this.roundReportNumber(total.total_upah_kotor),
                total_premi: this.roundReportNumber(total.total_premi),
                total_employees: this.roundReportNumber(total.total_employees),
                upah_bersih_per_hk: this.safeReportRatio(total.total_upah_bersih, total.total_hk),
                upah_kotor_per_hk: this.safeReportRatio(total.total_upah_kotor, total.total_hk),
                premi_per_hk: this.safeReportRatio(total.total_premi, total.total_hk),
                upah_bersih_per_ton: this.safeReportRatio(total.total_upah_bersih, coveredTonase),
                upah_kotor_per_ton: this.safeReportRatio(total.total_upah_kotor, coveredTonase),
                premi_per_ton: this.safeReportRatio(total.total_premi, coveredTonase),
                premi_share: this.safeReportRatio(total.total_premi * 100, total.total_upah_kotor, 2)
            };
        });

        const current = trend[trend.length - 1];
        const divisionBreakdown = [...currentDivisionTotals.values()]
            .map(row => {
                const totalTonase = this.roundReportNumber(row.total_tonase, 2);
                const hasHarvestMetrics = row.gang_count > 0
                    || row.total_hk > 0
                    || row.total_upah_bersih > 0
                    || row.total_premi > 0;
                return {
                    division_code: row.division_code,
                    total_tonase: totalTonase,
                    total_hk: this.roundReportNumber(row.total_hk, 2),
                    total_upah_bersih: this.roundReportNumber(row.total_upah_bersih),
                    total_upah_kotor: this.roundReportNumber(row.total_upah_kotor),
                    total_premi: this.roundReportNumber(row.total_premi),
                    total_employees: this.roundReportNumber(row.total_employees),
                    gang_count: row.gang_count,
                    upah_available: row.upah_available === 1 || row.upah_available === true ? 1 : 0,
                    upah_bersih_per_hk: hasHarvestMetrics
                        ? this.safeReportRatio(row.total_upah_bersih, row.total_hk)
                        : null,
                    upah_kotor_per_hk: hasHarvestMetrics
                        ? this.safeReportRatio(row.total_upah_kotor, row.total_hk)
                        : null,
                    premi_per_hk: hasHarvestMetrics
                        ? this.safeReportRatio(row.total_premi, row.total_hk)
                        : null,
                    upah_bersih_per_ton: hasHarvestMetrics
                        ? this.safeReportRatio(row.total_upah_bersih, totalTonase)
                        : null,
                    upah_kotor_per_ton: hasHarvestMetrics
                        ? this.safeReportRatio(row.total_upah_kotor, totalTonase)
                        : null,
                    premi_per_ton: hasHarvestMetrics
                        ? this.safeReportRatio(row.total_premi, totalTonase)
                        : null,
                    tonase_share: this.safeReportRatio(totalTonase * 100, current.total_tonase, 2),
                    premi_share: hasHarvestMetrics
                        ? this.safeReportRatio(row.total_premi * 100, current.total_premi, 2)
                        : null
                };
            })
            .filter(row => row.total_tonase > 0 || row.total_hk > 0 || row.total_upah_bersih > 0 || row.total_premi > 0)
            .sort((a, b) => b.total_tonase - a.total_tonase || a.division_code.localeCompare(b.division_code));
        const divisionSummaryByCode = new Map(divisionBreakdown.map(row => [row.division_code, row]));
        const divisionCodes = [...new Set([
            ...divisionBreakdown.map(row => row.division_code),
            ...currentDetailRows.map(row => row.normalized_division_code)
        ])];
        const divisionDetails = divisionCodes
            .map(divisionCode => {
                const rowsInDivision = currentDetailRows.filter(row => row.normalized_division_code === divisionCode);
                const summary = divisionSummaryByCode.get(divisionCode) || {
                    division_code: divisionCode,
                    total_tonase: 0,
                    total_hk: 0,
                    total_upah_bersih: 0,
                    total_upah_kotor: 0,
                    total_premi: 0,
                    total_employees: 0,
                    gang_count: 0,
                    upah_available: 0,
                    upah_bersih_per_hk: null,
                    upah_kotor_per_hk: null,
                    premi_per_hk: null,
                    upah_bersih_per_ton: null,
                    upah_kotor_per_ton: null,
                    premi_per_ton: null,
                    tonase_share: null,
                    premi_share: null
                };
                const gangRows = rowsInDivision
                    .filter(row => row.gang_type === "harvesting")
                    .map(row => {
                        const totalHk = this.toReportNumber(row.total_hk);
                        const totalUpahBersih = this.toReportNumber(row.total_upah_bersih);
                        const totalUpahKotor = this.toReportNumber(row.total_upah_kotor);
                        const totalPremi = this.toReportNumber(row.total_premi);
                        const totalTonase = this.roundReportNumber(row.effective_ffb_weight, 2);
                        return {
                            gang_code: row.normalized_gang_code,
                            gang_description: row.gang_description || row.normalized_gang_code,
                            gang_type: row.gang_type,
                            total_tonase: totalTonase,
                            total_hk: this.roundReportNumber(totalHk, 2),
                            total_upah_bersih: this.roundReportNumber(totalUpahBersih),
                            total_upah_kotor: this.roundReportNumber(totalUpahKotor),
                            total_premi: this.roundReportNumber(totalPremi),
                            total_employees: this.roundReportNumber(this.toReportNumber(row.total_employees)),
                            upah_bersih_per_hk: this.safeReportRatio(totalUpahBersih, totalHk),
                            upah_kotor_per_hk: this.safeReportRatio(totalUpahKotor, totalHk),
                            premi_per_hk: this.safeReportRatio(totalPremi, totalHk),
                            upah_bersih_per_ton: this.safeReportRatio(totalUpahBersih, totalTonase),
                            upah_kotor_per_ton: this.safeReportRatio(totalUpahKotor, totalTonase),
                            premi_per_ton: this.safeReportRatio(totalPremi, totalTonase)
                        };
                    })
                    .sort((a, b) => b.total_hk - a.total_hk || a.gang_code.localeCompare(b.gang_code));
                const tonaseRows = rowsInDivision
                    .filter(row => row.effective_ffb_weight > 0)
                    .map(row => ({
                        gang_code: row.normalized_gang_code,
                        gang_description: row.gang_description || row.normalized_gang_code,
                        gang_type: row.gang_type,
                        total_tonase: this.roundReportNumber(row.effective_ffb_weight, 2)
                    }))
                    .sort((a, b) => b.total_tonase - a.total_tonase || a.gang_code.localeCompare(b.gang_code));
                const divisionTrend = periods.map(period => {
                    const periodTotal = divisionPeriodTotals.get(period.key)?.get(divisionCode) || {
                        total_tonase: 0,
                        total_hk: 0,
                        total_upah_bersih: 0,
                        total_upah_kotor: 0,
                        total_premi: 0,
                        total_employees: 0,
                        gang_count: 0
                    };
                    const totalTonase = this.roundReportNumber(periodTotal.total_tonase, 2);
                    return {
                        period_key: period.key,
                        month: period.month,
                        year: period.year,
                        label: period.label,
                        total_tonase: totalTonase,
                        total_hk: this.roundReportNumber(periodTotal.total_hk, 2),
                        total_upah_bersih: this.roundReportNumber(periodTotal.total_upah_bersih),
                        total_upah_kotor: this.roundReportNumber(periodTotal.total_upah_kotor),
                        total_premi: this.roundReportNumber(periodTotal.total_premi),
                        total_employees: this.roundReportNumber(periodTotal.total_employees),
                        gang_count: periodTotal.gang_count,
                        upah_bersih_per_hk: this.safeReportRatio(periodTotal.total_upah_bersih, periodTotal.total_hk),
                        upah_kotor_per_hk: this.safeReportRatio(periodTotal.total_upah_kotor, periodTotal.total_hk),
                        premi_per_hk: this.safeReportRatio(periodTotal.total_premi, periodTotal.total_hk),
                        upah_bersih_per_ton: this.safeReportRatio(periodTotal.total_upah_bersih, totalTonase),
                        upah_kotor_per_ton: this.safeReportRatio(periodTotal.total_upah_kotor, totalTonase),
                        premi_per_ton: this.safeReportRatio(periodTotal.total_premi, totalTonase),
                        premi_share: this.safeReportRatio(periodTotal.total_premi * 100, periodTotal.total_upah_kotor, 2)
                    };
                });

                return {
                    division_code: divisionCode,
                    summary,
                    trend: divisionTrend,
                    gang_rows: gangRows,
                    tonase_rows: tonaseRows
                };
            })
            .filter(item => item.summary.total_tonase > 0 || item.gang_rows.length > 0 || item.tonase_rows.length > 0)
            .sort((a, b) => b.summary.total_tonase - a.summary.total_tonase || a.division_code.localeCompare(b.division_code));

        const knownPremiums = [
            {
                key: "brondol",
                label: "Premi Brondol",
                total_amount: currentRows.reduce((sum, row) => sum + this.toReportNumber(row.total_premi_brondol), 0)
            },
            {
                key: "prunning",
                label: "Premi Prunning",
                total_amount: currentRows.reduce((sum, row) => sum + this.toReportNumber(row.total_premi_prunning), 0)
            },
            {
                key: "insentif",
                label: "Premi Insentif",
                total_amount: currentRows.reduce((sum, row) => sum + this.toReportNumber(row.total_premi_insentif), 0)
            },
            {
                key: "kinerja",
                label: "Premi Kinerja",
                total_amount: currentRows.reduce((sum, row) => sum + this.toReportNumber(row.total_premi_kinerja), 0)
            }
        ];
        const knownPremiumTotal = knownPremiums.reduce((sum, item) => sum + item.total_amount, 0);
        const otherPremium = Math.max(current.total_premi - knownPremiumTotal, 0);
        const premiumBreakdownBase = knownPremiums
            .filter(item => item.total_amount > 0)
            .sort((a, b) => b.total_amount - a.total_amount);
        if (otherPremium > 0) {
            premiumBreakdownBase.push({
                key: "lainnya",
                label: "Premi Lainnya",
                total_amount: otherPremium
            });
        }

        const premiumBreakdown = premiumBreakdownBase.map(item => ({
            ...item,
            total_amount: this.roundReportNumber(item.total_amount),
            per_hk: this.safeReportRatio(item.total_amount, current.total_hk),
            per_ton: this.safeReportRatio(item.total_amount, current.upah_covered_tonase),
            share: this.safeReportRatio(item.total_amount * 100, current.total_premi, 2)
        }));

        const highestTonasePeriod = [...trend].sort((a, b) => b.total_tonase - a.total_tonase)[0] || current;
        let largestMovement = null;
        for (let index = 1; index < trend.length; index += 1) {
            const previous = trend[index - 1];
            const item = trend[index];
            const deltaTonase = this.roundReportNumber(item.total_tonase - previous.total_tonase, 2);
            const movement = {
                from_label: previous.label,
                to_label: item.label,
                delta_tonase: deltaTonase,
                delta_percent: this.safeReportRatio(deltaTonase * 100, previous.total_tonase, 2)
            };
            if (!largestMovement || Math.abs(movement.delta_tonase) > Math.abs(largestMovement.delta_tonase)) {
                largestMovement = movement;
            }
        }

        const previous = trend[trend.length - 2];
        const costDelta = current.upah_kotor_per_hk !== null && previous?.upah_kotor_per_hk !== null
            ? current.upah_kotor_per_hk - previous.upah_kotor_per_hk
            : null;
        const upahCoverage = current.total_tonase > 0
            ? this.roundReportNumber((current.upah_covered_tonase || 0) * 100 / current.total_tonase, 1)
            : null;
        const warnings: string[] = [];
        if (current.gang_count === 0) {
            warnings.push("Tidak ada data gang panen untuk periode terpilih.");
        }
        if (current.total_tonase <= 0 && current.missing_tonase_count > 0) {
            warnings.push(`Tonase belum tersedia untuk ${current.missing_tonase_count} gang panen pada periode terpilih.`);
        }
        if (current.total_hk <= 0) {
            warnings.push("Total HK gang panen nol pada periode terpilih; metrik per HK tidak tersedia.");
        }
        if (current.total_tonase <= 0) {
            warnings.push("Total tonase estate nol pada periode terpilih; metrik per ton tidak tersedia.");
        }
        const missingUpahDivs = [...currentDivisionTotals.values()].filter(v => v.total_tonase > 0 && v.upah_available !== 1);
        if (missingUpahDivs.length > 0) {
            const missingTonase = this.roundReportNumber(missingUpahDivs.reduce((sum, v) => sum + v.total_tonase, 0), 2);
            warnings.push(
                `${missingUpahDivs.length} divisi memproduksi ${missingTonase.toLocaleString('id-ID')} t tapi data upah belum masuk `
                + `(cakupan upah ${upahCoverage === null ? 0 : upahCoverage}%). `
                + `Metrik per ton dihitung dari ${this.roundReportNumber(current.upah_covered_tonase, 2).toLocaleString('id-ID')} t yang berdata upah.`
            );
        }

        return {
            meta: {
                selected_period: {
                    month,
                    year,
                    label: `${this.getMonthName(month)} ${year}`
                },
                period_window: periods,
                scope: effectiveScope === "REBINMAS"
                    ? "SELURUH REBINMAS"
                    : effectiveScope === "ALL"
                        ? "ALL ESTATE"
                        : effectiveScope,
                gang_scope: "HARVESTING",
                tonase_source: "extend_db_ptrj.dbo.division_tonase (mill supplier, PTRJ01-09 internal)"
            },
            kpis: {
                total_tonase: current.total_tonase,
                total_ffb_weight: current.total_ffb_weight,
                upah_covered_tonase: this.roundReportNumber(current.upah_covered_tonase, 2),
                upah_coverage: upahCoverage,
                total_hk: current.total_hk,
                total_upah_bersih: current.total_upah_bersih,
                total_upah_kotor: current.total_upah_kotor,
                total_premi: current.total_premi,
                total_employees: current.total_employees,
                gang_count: current.gang_count,
                upah_bersih_per_hk: current.upah_bersih_per_hk,
                upah_kotor_per_hk: current.upah_kotor_per_hk,
                premi_per_hk: current.premi_per_hk,
                upah_bersih_per_ton: current.upah_bersih_per_ton,
                upah_kotor_per_ton: current.upah_kotor_per_ton,
                premi_per_ton: current.premi_per_ton,
                premi_share: current.premi_share
            },
            trend,
            division_breakdown: divisionBreakdown,
            division_details: divisionDetails,
            premium_breakdown: premiumBreakdown,
            insights: {
                // Frontend membaca { label, value }; value = tonase periode puncak.
                highest_tonase_period: highestTonasePeriod
                    ? { label: highestTonasePeriod.label, value: this.roundReportNumber(highestTonasePeriod.total_tonase, 2) }
                    : null,
                // Frontend membaca { value, direction }; value = besar pergerakan (abs), direction = naik/turun.
                largest_tonase_movement: largestMovement
                    ? {
                        ...largestMovement,
                        value: Math.abs(largestMovement.delta_tonase),
                        direction: largestMovement.delta_tonase > 0 ? 'naik' : largestMovement.delta_tonase < 0 ? 'turun' : 'datar'
                    }
                    : null,
                upah_kotor_hk_trend: costDelta === null ? "unavailable" : costDelta > 0 ? "rising" : costDelta < 0 ? "falling" : "flat",
                upah_kotor_hk_delta: costDelta === null ? null : this.roundReportNumber(costDelta),
                premium_share: current.premi_share,
                upah_coverage: upahCoverage,
                missing_tonase_count: current.missing_tonase_count
            },
            warnings
        };
    }

    public async getTopBottomGangs(month: number, year: number, divisionCode?: string, gangScope?: string): Promise<{ top: any[], bottom: any[] }> {
        const allGangs = await this.getGangComparison(month, year, divisionCode, gangScope);
        const validGangs = allGangs.filter(g => g.cost_per_hk > 0);
        const sortedAsc = [...validGangs].sort((a, b) => a.cost_per_hk - b.cost_per_hk);

        return {
            top: sortedAsc.slice(0, 5),
            bottom: sortedAsc.slice(-5).reverse()
        };
    }

    /**
     * Get Gang History (Last 6 Months)
     */
    public async getGangHistory(gangCode: string, endMonth: number, endYear: number): Promise<any[]> {
        const query = `
            ${this.latestAggregationRowsCte()}
            SELECT TOP 6
            h.period_month as month,
            h.period_year as year,
            SUM(h.total_upah_kotor) as total_wage,
            SUM(h.total_lembur) as total_ot,
            SUM(h.total_premi) as total_premi,
            SUM(h.total_hk) as total_hk,
            MAX(h.total_employees) as headcount,
            CAST(SUM(h.total_upah_kotor) AS FLOAT) / NULLIF(SUM(h.total_hk), 0) as cost_per_hk
            FROM latest_rows h
            WHERE h.row_rank = 1
            AND h.gang_code = ?
            AND (h.period_year * 100 + h.period_month) <= (? * 100 + ?)
            GROUP BY h.period_month, h.period_year
            ORDER BY h.period_year DESC, h.period_month DESC
            `;

        const rows = await this.extendDb.query<any>(query, [gangCode, endYear, endMonth]);
        return rows.reverse(); // Return in chronological order
    }

    /**
     * Get All Gangs Trend (Last 6 Months)
     * For multi-gang comparison chart
     */
    public async getAllGangsTrend(endMonth: number, endYear: number, divisionCode?: string, gangScope?: string): Promise<any[]> {
        let startYear = endYear;
        let startMonth = endMonth - 5;
        if (startMonth <= 0) {
            startYear -= 1;
            startMonth += 12;
        }

        let divisionFilter = '';
        // Scope 'panen': hanya gang suffix 'H' (konvensi harvestGangSql, sama seperti getPayrollTrend).
        // 'all' atau undefined: tanpa filter (perilaku lama, backward compatible).
        const scopeFilter = (gangScope === 'panen' || gangScope === 'maintenance' || gangScope === 'transport') ? this.scopeGangSql('h.gang_code', gangScope) + ' AND' : '';
        // Note: parameters are positional in extendDb usually?
        // Based on previous usage, it accepts array.
        // We will pass [startYear, startMonth, endYear, endMonth, divisionCode]

        // Query has 6 placeholders for date logic:
        // (year > ? OR (year = ? AND month >= ?)) AND (year < ? OR (year = ? AND month <= ?))
        // Params order: startYear, startYear, startMonth, endYear, endYear, endMonth
        const params: any[] = [startYear, startYear, startMonth, endYear, endYear, endMonth];

        if (divisionCode && divisionCode !== 'ALL') {
            divisionFilter = `
                AND h.gang_code IN(
                SELECT code FROM HR_GANG WHERE division_code = ?
                )
            `;
            params.push(divisionCode);
        }

        const query = `
        ${this.latestAggregationRowsCte()}
        SELECT
            h.gang_code,
            h.period_month as month,
            h.period_year as year,
            SUM(h.total_upah_kotor) as total_wage,
            SUM(h.total_lembur) as total_ot,
            SUM(h.total_premi) as total_premi,
            MAX(h.total_employees) as headcount,
            MAX(ISNULL(h.total_ffb_weight, 0)) as tonase,
            CAST(SUM(h.total_upah_kotor) AS FLOAT) / NULLIF(SUM(h.total_hk), 0) as cost_per_hk,
            CAST(SUM(h.total_upah_kotor) AS FLOAT) / NULLIF(MAX(ISNULL(h.total_ffb_weight, 0)), 0) as cost_per_ton
            FROM latest_rows h
        WHERE
            h.row_rank = 1 AND
            ${scopeFilter}
            (h.period_year > ? OR (h.period_year = ? AND h.period_month >= ?)) AND
            (h.period_year < ? OR (h.period_year = ? AND h.period_month <= ?))
            ${divisionFilter}
            GROUP BY h.gang_code, h.period_month, h.period_year
            ORDER BY h.gang_code, h.period_year, h.period_month
            `;

        return await this.extendDb.query<any>(query, params);
    }
}

export const dashboardService = DashboardService.getInstance();
