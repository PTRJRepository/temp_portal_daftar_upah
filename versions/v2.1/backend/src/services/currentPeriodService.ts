import { Database } from "../db/client";

export interface CurrentPeriodResponse {
    month: number;
    year: number;
    latest_trx_date: string | null;
    latest_acc_month: number | null;
    latest_acc_year: number | null;
    is_cached: boolean;
    source: "pr_taskreg" | "aggregation_history" | "config_fallback";
    latest_period_month: number | null;
    latest_period_year: number | null;
}

/**
 * Current Period Service
 *
 * Determines the current payroll period from the latest period stored in
 * daftar_upah_aggregation_history on extend_db_ptrj.
 */
export class CurrentPeriodService {
    private static instance: CurrentPeriodService;
    private db: Database;
    private mainDb: Database;
    private cache: CurrentPeriodResponse | null = null;
    private cacheExpiry: number = 0;
    private readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

    private constructor() {
        this.db = Database.getExtendedInstance();
        this.mainDb = Database.getInstance();
    }

    public static getInstance(): CurrentPeriodService {
        if (!CurrentPeriodService.instance) {
            CurrentPeriodService.instance = new CurrentPeriodService();
        }
        return CurrentPeriodService.instance;
    }

    /**
     * Get the current payroll period (month and year)
     * This is calculated from the latest PR_TASKREG DocDate using PhyMonth/PhyYear,
     * with aggregation history as fallback.
     */
    public async getCurrentPeriod(): Promise<CurrentPeriodResponse> {
        const now = Date.now();

        // Return cached result if still valid
        if (this.cache && now < this.cacheExpiry) {
            return { ...this.cache, is_cached: true };
        }

        try {
            const rows = await this.mainDb.query<{
                PhyMonth: number;
                PhyYear: number;
                AccMonth: number | null;
                AccYear: number | null;
                DocDate: string | null;
            }>(`
                SELECT TOP 1
                    PhyMonth,
                    PhyYear,
                    AccMonth,
                    AccYear,
                    DocDate
                FROM dbo.PR_TASKREG
                WHERE PhyMonth IS NOT NULL
                    AND PhyYear IS NOT NULL
                    AND DocDate IS NOT NULL
                ORDER BY DocDate DESC
            `);

            if (rows && rows.length > 0) {
                const latest = rows[0];
                const result: CurrentPeriodResponse = {
                    month: Number(latest.PhyMonth),
                    year: Number(latest.PhyYear),
                    latest_trx_date: latest.DocDate,
                    latest_acc_month: latest.AccMonth === null ? null : Number(latest.AccMonth),
                    latest_acc_year: latest.AccYear === null ? null : Number(latest.AccYear),
                    is_cached: false,
                    source: "pr_taskreg",
                    latest_period_month: Number(latest.PhyMonth),
                    latest_period_year: Number(latest.PhyYear)
                };

                this.cache = result;
                this.cacheExpiry = now + this.CACHE_DURATION_MS;
                return result;
            }
        } catch (error: any) {
            console.warn("[CurrentPeriodService] PR_TASKREG query failed, falling back to aggregation history:", error.message);
        }

        try {
            const rows = await this.db.query<{
                period_month: number;
                period_year: number;
            }>(`
                SELECT TOP 1
                    period_month,
                    period_year
                FROM dbo.daftar_upah_aggregation_history
                ORDER BY period_year DESC, period_month DESC
            `);

            if (rows && rows.length > 0) {
                const latest = rows[0];
                const result: CurrentPeriodResponse = {
                    month: Number(latest.period_month),
                    year: Number(latest.period_year),
                    latest_trx_date: null,
                    latest_acc_month: null,
                    latest_acc_year: null,
                    is_cached: false,
                    source: "aggregation_history",
                    latest_period_month: Number(latest.period_month),
                    latest_period_year: Number(latest.period_year)
                };

                this.cache = result;
                this.cacheExpiry = now + this.CACHE_DURATION_MS;
                return result;
            }
        } catch (error: any) {
            console.warn("[CurrentPeriodService] Aggregation history query failed, using config fallback:", error.message);
        }

        const { Config } = await import("../config");
        const result: CurrentPeriodResponse = {
            month: Config.DEFAULT_MONTH,
            year: Config.DEFAULT_YEAR,
            latest_trx_date: null,
            latest_acc_month: null,
            latest_acc_year: null,
            is_cached: false,
            source: "config_fallback",
            latest_period_month: null,
            latest_period_year: null
        };

        this.cache = result;
        this.cacheExpiry = now + this.CACHE_DURATION_MS;
        return result;
    }

    /**
     * Convert calendar month/year to AccMonth/AccYear
     * This is needed for querying PR_GANGLN_ARC for historical data
     *
     * Calendar Month -> AccMonth:
     * - Oct(10)-Dec(12) -> AccMonth 1-3 (next year)
     * - Jan(1)-Sep(9) -> AccMonth 10-12 (current year)
     */
    public calendarToAccMonth(calendarMonth: number, calendarYear: number): { accMonth: number; accYear: number } {
        // [FIXED] In this estate (PTRJ), AccMonth matches CalendarMonth exactly.
        return {
            accMonth: calendarMonth,
            accYear: calendarYear
        };
    }

    /**
     * Convert AccMonth/AccYear to calendar month/year
     */
    public accToCalendarMonth(accMonth: number, accYear: number): { calendarMonth: number; calendarYear: number } {
        // [FIXED] In this estate (PTRJ), AccMonth matches CalendarMonth exactly.
        return {
            calendarMonth: accMonth,
            calendarYear: accYear
        };
    }

    /**
     * Clear the cache (useful for testing or after data updates)
     */
    public clearCache(): void {
        this.cache = null;
        this.cacheExpiry = 0;
    }
}

export const currentPeriodService = CurrentPeriodService.getInstance();
