import { Database } from "../db/client";
import { cacheService } from "./cacheService";
import { payrollService } from "./payrollService";
import { PayrollComponent, PayrollComponentMetadata } from "../types/payroll/PayrollComponent";


// Helper to safely format JS Dates to local YYYY-MM-DD
function formatSystemDate(dateInput: Date | string): string {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}


// Day Type Classification
export enum DayType {
    WORKDAY_LONG = "WORKDAY_LONG",       // Mon, Tue, Wed, Thu, Sat (7+ hours before OT)
    WORKDAY_SHORT = "WORKDAY_SHORT",     // Friday (5+ hours before OT)
    SUNDAY = "SUNDAY",                   // Sunday (OT from first hour)
    HOLIDAY_REGULAR = "HOLIDAY_REGULAR", // Non-religious public holiday
    HOLIDAY_RELIGIOUS = "HOLIDAY_RELIGIOUS"  // Religious public holiday
}

export function getDayTypeDisplayName(dayType: DayType): string {
    const names: Record<DayType, string> = {
        [DayType.WORKDAY_LONG]: "Hari Kerja",
        [DayType.WORKDAY_SHORT]: "Jumat",
        [DayType.SUNDAY]: "Minggu",
        [DayType.HOLIDAY_REGULAR]: "Libur Umum",
        [DayType.HOLIDAY_RELIGIOUS]: "Libur Keagamaan"
    };
    return names[dayType] || dayType;
}

export function isReligiousHolidayDescription(description?: string | null): boolean {
    const desc = String(description || "").toUpperCase();
    return desc.includes("IDUL") || desc.includes("NATAL") ||
        desc.includes("IMLEK") || desc.includes("WAISAK") ||
        desc.includes("NYEPI") || desc.includes("ISRA") ||
        desc.includes("MAULID");
}

export function resolveOvertimeDayType(
    date: Date,
    holiday?: { is_religious: boolean } | null
): DayType {
    if (holiday) {
        return holiday.is_religious ? DayType.HOLIDAY_RELIGIOUS : DayType.HOLIDAY_REGULAR;
    }

    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) return DayType.SUNDAY;
    if (dayOfWeek === 5) return DayType.WORKDAY_SHORT;
    return DayType.WORKDAY_LONG;
}

// Overtime Rate Configuration
const OVERTIME_RATES: Record<string, { tier_1_rate: number; tier_2_rate: number; tier_3_rate: number; tier_1_boundary?: number; tier_1_boundary_short?: number; tier_1_boundary_long?: number }> = {
    // Workdays: 2-tier (1.5x first hour, 2x after)
    WORKDAY_LONG: { tier_1_rate: 1.5, tier_2_rate: 2.0, tier_3_rate: 2.0, tier_1_boundary: 1 },
    WORKDAY_SHORT: { tier_1_rate: 1.5, tier_2_rate: 2.0, tier_3_rate: 2.0, tier_1_boundary: 1 },

    // Sunday: 3-tier (2x, 3x, 4x)
    SUNDAY: { tier_1_rate: 2.0, tier_2_rate: 3.0, tier_3_rate: 4.0, tier_1_boundary_short: 5, tier_1_boundary_long: 7 },

    // Regular Holiday: 3-tier (2x, 3x, 4x)
    HOLIDAY_REGULAR: { tier_1_rate: 2.0, tier_2_rate: 3.0, tier_3_rate: 4.0, tier_1_boundary_short: 5, tier_1_boundary_long: 7 },

    // Religious Holiday: 3-tier (3x, 4x, 4x)
    HOLIDAY_RELIGIOUS: { tier_1_rate: 3.0, tier_2_rate: 4.0, tier_3_rate: 4.0, tier_1_boundary_short: 5, tier_1_boundary_long: 7 }
};

export interface OvertimeBreakdown {
    tier_1_rate: number;
    tier_1_hours: number;
    tier_1_amount: number;
    tier_1_boundary: number;
    tier_2_rate: number;
    tier_2_hours: number;
    tier_2_amount: number;
    tier_3_rate: number;
    tier_3_hours: number;
    tier_3_amount: number;
    total_rate: number;
    total_amount: number;
    /** Human-readable rate description, e.g.: "7 jam @ 1.5x + 7 jam @ 2x" */
    uraian: string;
    /** UPJ value used in calculation */
    upj_value: number;
}

export interface OvertimeRecord {
    id: number;
    emp_code: string;
    emp_name: string;
    trx_date: Date;
    hours: number;
    day_type?: DayType;
    breakdown?: OvertimeBreakdown;
    task_code?: string;
    task_desc?: string;
    shift_code?: string;
    raw_amount?: number;
    raw_rate?: number;
    meta?: PayrollComponentMetadata;
}
export class LemburCalculator {
    private static instance: LemburCalculator;
    private db: Database;
    private upjValue: number;
    // [OPTIMIZATION] Cache holidays by year - holidays don't change, so cache indefinitely
    holidayCache: Map<number, Record<string, { is_religious: boolean }>> = new Map();

    private constructor() {
        this.db = Database.getInstance();
        // UPJ default value from environment or fallback to 17257
        this.upjValue = parseFloat(process.env.LEMBUR_UPJ || "17257");
    }

    public static getInstance(): LemburCalculator {
        if (!LemburCalculator.instance) {
            LemburCalculator.instance = new LemburCalculator();
        }
        return LemburCalculator.instance;
    }

    public async calculate(empCode: string, month: number, year: number, upj?: number, serverProfile?: string) {
        let empName = "";
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${month.toString().padStart(2, "0")}-${daysInMonth}`;
        const records: OvertimeRecord[] = [];

        // If UPJ not provided, calculate from payRate: UPJ = payrate × 30 / 173
        let calculatedUpj = upj;
        if (!calculatedUpj) {
            try {
                const payRates = await payrollService.getPayratesMap([empCode], serverProfile);
                const payRate = payRates[empCode] || 0;
                calculatedUpj = payRate > 0 ? (payRate * 30) / 173 : this.upjValue;
            } catch (e) {
                console.error("[LemburCalculator] Failed to fetch payrate:", e);
                calculatedUpj = this.upjValue;
            }
        }

        try {
            const rows = await this.db.query<{
                ID: number;
                EmpCode: string;
                EmpName: string;
                TrxDate: string;
                Hours: number;
                TaskCode: string;
                TaskDesc: string;
                ShiftCode: string;
                Amount: number;
                Rate: number;
            }>(`
                SELECT
                    trl.ID,
                    trl.EmpCode,
                    e.EmpName,
                    trl.TrxDate,
                    trl.Hours,
                    trl.TaskCode,
                    tc.TaskDesc,
                    trl.ShiftCode,
                    trl.Amount,
                    trl.Rate
                FROM (
                    -- Active Table
                    SELECT l.ID, l.EmpCode, l.TrxDate, l.Hours, l.TaskCode, l.ShiftCode, l.Amount, l.Rate
                    FROM PR_TASKREGLN l
                    JOIN PR_TASKREG m ON l.MasterID = m.ID
                    WHERE l.EmpCode = ? AND l.TrxDate >= ? AND l.TrxDate <= ? AND l.OT = 1

                    UNION ALL

                    -- Archive Table
                    SELECT l.ID, l.EmpCode, l.TrxDate, l.Hours, l.TaskCode, l.ShiftCode, l.Amount, l.Rate
                    FROM PR_TASKREGLN_ARC l
                    JOIN PR_TASKREG_ARC m ON l.MasterID = m.ID
                    WHERE l.EmpCode = ? AND l.TrxDate >= ? AND l.TrxDate <= ? AND l.OT = 1
                ) trl
                LEFT JOIN HR_EMPLOYEE e ON e.EmpCode = trl.EmpCode
                LEFT JOIN PR_TASKCODE tc ON tc.TaskCode = trl.TaskCode
                ORDER BY trl.TrxDate
            `, [empCode, startDate, endDate, empCode, startDate, endDate]);

            for (const row of rows) {
                empName = row.EmpName || empCode;
                const trxDate = new Date(row.TrxDate);
                const isFriday = trxDate.getDay() === 5;

                // Classify day
                const dayType = await this.classifyDay(trxDate, year);

                // Calculate breakdown
                const breakdown = this.calculateOvertimePayment(row.Hours, dayType, calculatedUpj, isFriday);

                records.push({
                    id: row.ID,
                    emp_code: row.EmpCode,
                    emp_name: row.EmpName || empCode,
                    trx_date: trxDate,
                    hours: row.Hours,
                    day_type: dayType,
                    breakdown,
                    task_code: row.TaskCode,
                    task_desc: row.TaskDesc,
                    shift_code: row.ShiftCode,
                    raw_amount: row.Amount || 0,
                    raw_rate: row.Rate || 0
                });
            }
        } catch (e) {
            console.error("[LemburCalculator] Calculation failed:", e);
        }

        const totalHours = records.reduce((sum, r) => sum + r.hours, 0);
        const totalPayment = records.reduce((sum, r) => sum + (r.breakdown?.total_amount || 0), 0);

        return {
            emp_code: empCode,
            emp_name: empName,
            month,
            year,
            upj: calculatedUpj,
            records,
            total_hours: totalHours,
            total_payment: totalPayment,
            record_count: records.length
        };
    }

    // --- Quick Calculate (no database) ---
    public quickCalculate(hours: number, dayTypeStr: string = "WORKDAY_LONG", isShortDay: boolean = false): OvertimeBreakdown {
        const dayType = (DayType as any)[dayTypeStr] || DayType.WORKDAY_LONG;
        return this.calculateOvertimePayment(hours, dayType, this.upjValue, isShortDay);
    }

    // --- Batch Amounts (Optimized) ---
    public async calculateBatchData(empCodes: string[], month: number, year: number, serverProfile?: string): Promise<Record<string, { total_hours: number, total_payment: number }>> {
        if (!empCodes.length) return {};

        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${month.toString().padStart(2, "0")}-${daysInMonth}`;

        const result: Record<string, { total_hours: number, total_payment: number }> = {};

        // Use specific profile if requested, otherwise default
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;

        // 1. Batch fetch PayRates (pass profile)
        // UPJ = payrate × 30 / 173
        let payRates: Record<string, number> = {};
        try {
            payRates = await payrollService.getPayratesMap(empCodes, serverProfile);
        } catch (e) {
            console.error("[LemburCalculator] Failed to batch fetch payrates:", e);
        }

        // 2. Batch fetch Overtime Records (use db instance)
        const empList = empCodes.map(e => `'${e}'`).join(",");
        let rows: any[] = [];
        try {
            rows = await db.query<{
                EmpCode: string;
                Hours: number;
                TrxDate: string;
            }>(`
                SELECT
                    trl.EmpCode,
                    trl.Hours,
                    trl.TrxDate
                FROM (
                    -- Active Table
                    SELECT l.EmpCode, l.TrxDate, l.Hours
                    FROM PR_TASKREGLN l
                    WHERE l.EmpCode IN (${empList})
                      AND l.TrxDate >= ? AND l.TrxDate <= ?
                      AND l.OT = 1

                    UNION ALL

                    -- Archive Table
                    SELECT l.EmpCode, l.TrxDate, l.Hours
                    FROM PR_TASKREGLN_ARC l
                    WHERE l.EmpCode IN (${empList})
                      AND l.TrxDate >= ? AND l.TrxDate <= ?
                      AND l.OT = 1
                ) trl
                ORDER BY trl.EmpCode, trl.TrxDate
            `, [startDate, endDate, startDate, endDate]);
        } catch (e) {
            console.error("[LemburCalculator] Batch query failed:", e);
            return {};
        }

        // 3. Process Records
        // Need to cache holidays for the year once
        const holidays = await this.getHolidays(year);

        // Group by Employee
        const empRecords: Record<string, typeof rows> = {};
        for (const row of rows) {
            const ec = row.EmpCode;
            if (!empRecords[ec]) empRecords[ec] = [];
            empRecords[ec].push(row);
        }

        for (const empCode of empCodes) {
            const myRows = empRecords[empCode] || [];
            if (myRows.length === 0) {
                result[empCode] = { total_hours: 0, total_payment: 0 };
                continue;
            }

            // UPJ = payrate × 30 / 173
            // If payRate is not available, use fallback UPJ from environment
            const payRate = payRates[empCode] || 0;
            const upj = payRate > 0 ? (payRate * 30) / 173 : this.upjValue;

            let totalHours = 0;
            let totalPayment = 0;

            for (const row of myRows) {
                const trxDate = new Date(row.TrxDate);
                const dayOfWeek = trxDate.getDay();
                const dateKey = row.TrxDate.substring(0, 10); // Assuming YYYY-MM-DD

                // Classify Day — check holidays FIRST (a Sunday on a religious holiday
                // must use the religious holiday rate, not the Sunday rate)
                const holidayKey = formatSystemDate(trxDate);
                const holiday = holidays[holidayKey];
                const dayType = resolveOvertimeDayType(trxDate, holiday);

                const breakdown = this.calculateOvertimePayment(row.Hours, dayType, upj, dayOfWeek === 5);

                totalHours += row.Hours;
                totalPayment += breakdown.total_amount;
            }

            result[empCode] = {
                total_hours: totalHours,
                total_payment: Math.round(totalPayment * 100) / 100
            };
        }

        return result;
    }

    // --- Batch Overtime Details with Task Code Breakdown ---
    public async calculateBatchDataWithTaskBreakdown(empCodes: string[], month: number, year: number, serverProfile?: string): Promise<Record<string, {
        total_hours: number;
        total_payment: number;
        task_breakdown: Array<{
            task_code: string;
            task_desc: string;
            hours: number;
            amount: number;
            record_count: number;
        }>;
        records?: Array<{
            date: string;
            day_name: string;
            day_type: string;
            task_code: string;
            task_desc: string;
            hours: number;
            rate: number;
            amount: number;         // Calculated amount (from tier-based rate)
            raw_amount: number;      // Amount from PR_TASKREGLN table
            raw_rate: number;        // Rate from PR_TASKREGLN table
            uraian: string;         // Human-readable rate description, e.g.: "7 jam @ 1.5x + 7 jam @ 2x"
            upj_value: number;      // UPJ value used in calculation
            meta?: PayrollComponentMetadata;
        }>;
        meta?: PayrollComponentMetadata;
    }>> {
        if (!empCodes.length) return {};

        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${month.toString().padStart(2, "0")}-${daysInMonth}`;

        const result: Record<string, {
            total_hours: number;
            total_payment: number;
            task_breakdown: Array<{
                task_code: string;
                task_desc: string;
                hours: number;
                amount: number;
                record_count: number;
            }>;
            records?: Array<{
                date: string;
                day_name: string;
                day_type: string;
                task_code: string;
                task_desc: string;
                hours: number;
                rate: number;
                amount: number;
                raw_amount: number;
                raw_rate: number;
                uraian: string;
                upj_value: number;
                meta?: PayrollComponentMetadata;
            }>;
            meta?: PayrollComponentMetadata;
        }> = {};

        // Use specific profile if requested, otherwise default
        const db = serverProfile ? Database.getInstance(undefined, serverProfile) : this.db;

        // 1. Batch fetch PayRates
        // UPJ = payrate × 30 / 173
        let payRates: Record<string, number> = {};
        try {
            payRates = await payrollService.getPayratesMap(empCodes, serverProfile);
        } catch (e) {
            console.error("[LemburCalculator] Failed to batch fetch payrates:", e);
        }

        // 2. Batch fetch Overtime Records with TaskCode
        const empList = empCodes.map(e => `'${e}'`).join(",");
        let rows: any[] = [];
        try {
            rows = await db.query<{
                EmpCode: string;
                Hours: number;
                TrxDate: string;
                TaskCode: string;
                Amount: number;
                Rate: number;
            }>(`
                SELECT
                    trl.EmpCode,
                    trl.Hours,
                    trl.TrxDate,
                    trl.TaskCode,
                    trl.Amount,
                    trl.Rate
                FROM PR_TASKREGLN trl
                JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate <= ?
                  AND trl.OT = 1

                UNION ALL

                SELECT
                    trl.EmpCode,
                    trl.Hours,
                    trl.TrxDate,
                    trl.TaskCode,
                    trl.Amount,
                    trl.Rate
                FROM PR_TASKREGLN_ARC trl
                JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE RTRIM(trl.EmpCode) IN (${empList})
                  AND trl.TrxDate >= ? AND trl.TrxDate <= ?
                  AND trl.OT = 1
            `, [startDate, endDate, startDate, endDate]);
        } catch (e) {
            console.error("[LemburCalculator] Failed to batch fetch overtime:", e);
            return {};
        }

        // 3. Fetch TaskDesc for all unique TaskCodes
        const uniqueTaskCodes = [...new Set(rows.map(r => r.TaskCode?.trim()).filter(tc => tc))];
        const taskDescMap: Record<string, string> = {};
        if (uniqueTaskCodes.length > 0) {
            try {
                const taskList = uniqueTaskCodes.map(tc => `'${tc}'`).join(",");
                const taskRows = await db.query<{
                    TaskCode: string;
                    TaskDesc: string;
                }>(`
                    SELECT TaskCode, TaskDesc
                    FROM PR_TASKCODE
                    WHERE RTRIM(TaskCode) IN (${taskList})
                `);
                for (const tr of taskRows) {
                    taskDescMap[tr.TaskCode?.trim() || ""] = tr.TaskDesc?.trim() || "";
                }
            } catch (e) {
                console.error("[LemburCalculator] Failed to fetch task descriptions:", e);
            }
        }

        // 4. [OPTIMIZATION] Fetch holidays once — already cached by year
        const holidays = await this.getHolidays(year);

        // 5. [OPTIMIZATION] Group rows by employee FIRST — O(M) single pass instead of O(N×M)
        // Previous: for each employee, loop through ALL rows = O(N×M) worst case
        // Now: group once, then iterate only that employee's rows = O(M) + O(N×K)
        const empRowsMap: Record<string, typeof rows> = {};
        for (const row of rows) {
            const ec = row.EmpCode?.trim();
            if (ec) {
                if (!empRowsMap[ec]) empRowsMap[ec] = [];
                empRowsMap[ec].push(row);
            }
        }

        // 6. [OPTIMIZATION] Inline sync day classification — avoids await per transaction
        // holidays already fetched and cached above; direct lookup is O(1)
        const classifyDaySync = (date: Date): DayType => {
            const dateStr = formatSystemDate(date);
            return resolveOvertimeDayType(date, holidays[dateStr] || null);
        };

        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

        for (const empCode of empCodes) {
            const empKey = empCode.trim();
            const myRows = empRowsMap[empKey] || [];

            // Pre-compute UPJ once per employee (same for all rows of this employee)
            const payRate = payRates[empKey] || 0;
            const upj = payRate > 0 ? (payRate * 30) / 173 : this.upjValue;

            result[empKey] = {
                total_hours: 0,
                total_payment: 0,
                task_breakdown: [],
                meta: {
                    source: 'CALCULATION',
                    description: 'Overtime calculation from Plantware PR_TASKREGLN',
                    last_updated: new Date()
                }
            };

            if (myRows.length === 0) continue;

            const records: Array<{
                date: string;
                day_name: string;
                day_type: string;
                task_code: string;
                task_desc: string;
                hours: number;
                rate: number;
                amount: number;
                raw_amount: number;
                raw_rate: number;
                uraian: string;
                upj_value: number;
                meta?: PayrollComponentMetadata;
            }> = [];

            // 7. [OPTIMIZATION] Iterate only this employee's rows — no full scan, no await
            for (const row of myRows) {
                const taskCode = (row.TaskCode || "").trim();
                const taskDesc = taskDescMap[taskCode] || taskCode;
                const trxDate = new Date(row.TrxDate);
                const dayOfWeek = trxDate.getDay();
                // [OPTIMIZATION] Sync inline classification — no await, uses cached holidays
                const dayType = classifyDaySync(trxDate);
                const breakdown = this.calculateOvertimePayment(row.Hours, dayType, upj, dayOfWeek === 5);

                records.push({
                    date: formatSystemDate(trxDate),
                    day_name: dayNames[dayOfWeek],
                    day_type: getDayTypeDisplayName(dayType),
                    task_code: taskCode,
                    task_desc: taskDesc,
                    hours: row.Hours,
                    rate: breakdown.total_rate || 0,
                    amount: breakdown.total_amount,
                    raw_amount: row.Amount || 0,
                    raw_rate: row.Rate || 0,
                    uraian: breakdown.uraian,
                    upj_value: breakdown.upj_value,
                    meta: {
                        source: 'DATABASE_PLANTWARE',
                        description: `Overtime on ${formatSystemDate(trxDate)} (${taskDesc})`,
                        calculation_basis: `Day Type: ${getDayTypeDisplayName(dayType)}, UPJ: ${upj}`,
                        taxable: true
                    }
                });

                result[empKey].total_hours += row.Hours;
                result[empKey].total_payment += breakdown.total_amount;
            }

            records.sort((a, b) => a.date.localeCompare(b.date));

            const taskGroupMap: Record<string, {
                task_code: string;
                task_desc: string;
                hours: number;
                amount: number;
                record_count: number;
            }> = {};

            for (const rec of records) {
                const groupKey = rec.task_desc;
                if (!taskGroupMap[groupKey]) {
                    taskGroupMap[groupKey] = {
                        task_code: rec.task_code,
                        task_desc: rec.task_desc,
                        hours: 0,
                        amount: 0,
                        record_count: 0
                    };
                }
                taskGroupMap[groupKey].hours += rec.hours;
                taskGroupMap[groupKey].amount += rec.amount;
                taskGroupMap[groupKey].record_count += 1;
            }

            result[empKey].task_breakdown = Object.values(taskGroupMap).sort((a, b) => b.amount - b.amount);
            result[empKey].records = records;
        }

        return result;
    }

    // --- Batch Amounts (Legacy Wrapper) ---
    public async calculateBatchAmounts(empCodes: string[], month: number, year: number): Promise<Record<string, number>> {
        const data = await this.calculateBatchData(empCodes, month, year);
        const res: Record<string, number> = {};
        for (const k in data) res[k] = data[k].total_payment;
        return res;
    }

    private async classifyDay(date: Date, year: number): Promise<DayType> {

        // Check holidays FIRST — a Sunday that falls on a religious holiday
        // must use the religious holiday rate (higher), not the Sunday rate.
        const holidays = await this.getHolidays(year);
        const dateStr = formatSystemDate(date);
        if (holidays[dateStr]) {
            return resolveOvertimeDayType(date, holidays[dateStr]);
        }

        // After holidays, classify by day of week
        return resolveOvertimeDayType(date, null);
    }

    private async getHolidays(year: number): Promise<Record<string, { is_religious: boolean }>> {
        // [OPTIMIZATION] Cache holidays by year - holidays are static, never change
        if (this.holidayCache.has(year)) {
            return this.holidayCache.get(year)!;
        }

        const rows = await this.db.query<{ HolidayDate: string; Description: string }>(`
            SELECT HolidayDate, Description FROM HR_GPH WHERE YEAR(HolidayDate) = ?
        `, [year]);

        const holidays: Record<string, { is_religious: boolean }> = {};
        for (const row of rows) {
            const dateStr = formatSystemDate(row.HolidayDate);
            const desc = (row.Description || "").toUpperCase();
            const isReligious = isReligiousHolidayDescription(desc);
            holidays[dateStr] = { is_religious: isReligious };
        }

        // Cache indefinitely (holidays don't change)
        this.holidayCache.set(year, holidays);
        return holidays;
    }

    private calculateOvertimePayment(hours: number, dayType: DayType, upj: number, isShortDay: boolean): OvertimeBreakdown {
        const rates = OVERTIME_RATES[dayType] || OVERTIME_RATES[DayType.WORKDAY_LONG];
        let tier1Hours = 0, tier2Hours = 0, tier3Hours = 0;
        let remainingHours = hours;

        // Tier 1
        const tier1Limit = isShortDay ? (rates.tier_1_boundary_short || rates.tier_1_boundary || 0)
            : (rates.tier_1_boundary_long || rates.tier_1_boundary || 0);

        if (remainingHours > 0) {
            const h = Math.min(remainingHours, tier1Limit);
            tier1Hours = h;
            remainingHours -= h;
        }

        // Tier 2 - for Sundays/Holidays (next 1 hour usually), Workdays (rest)
        let tier2Limit = 0;
        if (dayType === DayType.SUNDAY || dayType === DayType.HOLIDAY_REGULAR || dayType === DayType.HOLIDAY_RELIGIOUS) {
            tier2Limit = 1; // 8th hour
        } else {
            tier2Limit = 999; // Rest
        }

        if (remainingHours > 0) {
            const h = Math.min(remainingHours, tier2Limit);
            tier2Hours = h;
            remainingHours -= h;
        }

        if (remainingHours > 0) {
            tier3Hours = remainingHours;
        }

        const t1Amount = tier1Hours * upj * rates.tier_1_rate;
        const t2Amount = tier2Hours * upj * rates.tier_2_rate;
        const t3Amount = tier3Hours * upj * rates.tier_3_rate;

        // Build uraian string: "7 jam @ 1.5x + 7 jam @ 2x"
        const uraianParts: string[] = [];
        if (tier1Hours > 0) {
            uraianParts.push(`${tier1Hours} jam @ ${rates.tier_1_rate}x`);
        }
        if (tier2Hours > 0) {
            uraianParts.push(`${tier2Hours} jam @ ${rates.tier_2_rate}x`);
        }
        if (tier3Hours > 0) {
            uraianParts.push(`${tier3Hours} jam @ ${rates.tier_3_rate}x`);
        }
        const uraian = uraianParts.join(' + ') || `${hours} jam @ 0x`;

        return {
            tier_1_rate: rates.tier_1_rate,
            tier_1_hours: tier1Hours,
            tier_1_amount: t1Amount,
            tier_1_boundary: tier1Limit,
            tier_2_rate: rates.tier_2_rate,
            tier_2_hours: tier2Hours,
            tier_2_amount: t2Amount,
            tier_3_rate: rates.tier_3_rate,
            tier_3_hours: tier3Hours,
            tier_3_amount: t3Amount,
            total_rate: 0,
            total_amount: t1Amount + t2Amount + t3Amount,
            uraian,
            upj_value: upj
        };
    }
}

export const lemburCalculator = LemburCalculator.getInstance();
