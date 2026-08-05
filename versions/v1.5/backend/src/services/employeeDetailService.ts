import { Database } from "../db/client";
import { dataExtractorService } from "./dataExtractorService";
import { lemburCalculator, getDayTypeDisplayName } from "./lemburCalculator";
import { harvesterService } from "./harvesterService";
import { Config } from "../config";
import { ptkpTaxService } from "./ptkpTaxService";

export interface AttendanceDay {
    date: string;
    status: string;
    is_present: boolean;
    is_rest_day: boolean;
    is_holiday: boolean;
    remarks: string;
    task_code?: string;
    hours?: number;
    amount?: number; // Added amount field
    has_data: boolean;
}

export interface OvertimeDay {
    date: string;
    has_overtime: boolean;
    hours: number;
    amount: number;
    amount_formula?: number;
    details: any[];
}

export interface EmployeeInfo {
    nik: string;
    actual_nik?: string;
    nama: string;
    jenis_kelamin: string;
    loc_code: string;
    gang_code: string;
    upah_dasar: number;
    join_date?: string;
    status?: string;
    employee_type?: string;
    marital_status?: string;
    religion?: string;
    birth_place?: string;
    birth_date?: string;
    gang_description?: string;
    status_ptkp?: string;
    jabatan?: string;
}

export interface AttendanceSummary {
    total_hadir: number;
    total_tidak_hadir: number;
    cuti_tahunan: number;
    cuti_sakit: number;
    cuti_minggu: number;
    libur: number;
    alpa: number;
    no_data: number;
    total_hk: number;
    kehadiran_efektif: number;
}

export class EmployeeDetailService {
    private static instance: EmployeeDetailService;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): EmployeeDetailService {
        if (!EmployeeDetailService.instance) {
            EmployeeDetailService.instance = new EmployeeDetailService();
        }
        return EmployeeDetailService.instance;
    }

    // --- Holiday Helper ---
    public async getHolidaysFromHrGph(month: number, year: number): Promise<Record<number, any>> {
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const endDate = `${year}-${month.toString().padStart(2, "0")}-${daysInMonth}`;

        const holidays: Record<number, any> = {};
        try {
            const rows = await this.db.query<{
                day_of_month: number;
                HolidayDate: string;
                Description: string;
                IsRegionPH: number;
            }>(`
                SELECT 
                    DAY(HolidayDate) as day_of_month,
                    HolidayDate,
                    Description,
                    IsRegionPH
                FROM HR_GPH 
                WHERE HolidayDate >= ? AND HolidayDate <= ?
                  AND Status = 1
                ORDER BY HolidayDate
            `, [startDate, endDate]);

            for (const row of rows) {
                const day = row.day_of_month;
                const isReligious = row.IsRegionPH === 1;
                holidays[day] = {
                    date: row.HolidayDate,
                    description: row.Description?.trim() || "",
                    is_religious: isReligious,
                    holiday_type: isReligious ? "Libur Keagamaan" : "Libur Nasional"
                };
            }
        } catch (e) {
            console.error("[EmployeeDetailService] Failed to get holidays:", e);
        }
        return holidays;
    }

    // --- Employee Info (Enriched) ---
    public async getEmployeeInfo(empCode: string): Promise<EmployeeInfo | null> {
        try {
            const rows = await this.db.query<{
                EmpCode: string;
                NewICNo: string;
                EmpName: string;
                Gender: string | number;
                LocCode: string;
                GangCode: string;
                GangDescription: string;
                PayRate: number;
                AppJoinGrpDate: string;
                Status: string;
                EmployeeType: string;
                Religion: string;
                MaritalStatus: string;
                BirthPlace: string;
                BirthDate: string;
            }>(`
                SELECT DISTINCT
                    e.EmpCode,
                    e.NewICNo,
                    e.EmpName,
                    e.Gender,
                    e.LocCode,
                    g.GangCode,
                    g.Description as GangDescription,
                    p.PayRate,
                    em.AppJoinGrpDate,
                    e.Status,
                    e.HREmpType as EmployeeType,
                    e.Religion,
                    e.PlaceOfBirth as BirthPlace,
                    e.DOB as BirthDate,
                    e.MaritalStatus
                FROM HR_EMPLOYEE e
                LEFT JOIN HR_EMPLOYMENT em ON e.EmpCode = em.EmpCode
                LEFT JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
                LEFT JOIN HR_GANG g ON gl.GangCode = g.GangCode
                LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode)
                WHERE RTRIM(e.EmpCode) = RTRIM(?)
            `, [empCode]);
            const row = rows[0];

            if (!row) return null;

            // Gender mapping: 1=L (Laki-laki), 2=P (Perempuan)
            let gender = "L";
            if (String(row.Gender) === "2" || String(row.Gender).toUpperCase() === "P") {
                gender = "P";
            }

            return {
                nik: row.EmpCode,
                actual_nik: row.NewICNo?.trim() || undefined,
                nama: row.EmpName,
                jenis_kelamin: gender,
                loc_code: row.LocCode,
                gang_code: row.GangCode,
                gang_description: row.GangDescription?.trim() || undefined,
                upah_dasar: row.PayRate || 0,
                join_date: row.AppJoinGrpDate || undefined,
                status: row.Status?.trim() || undefined,
                employee_type: row.EmployeeType?.trim() || undefined,
                marital_status: row.MaritalStatus?.trim() || undefined,
                religion: row.Religion?.trim() || undefined,
                birth_place: row.BirthPlace?.trim() || undefined,
                birth_date: row.BirthDate || undefined,
                // jabatan will be enriched from payrollData.jabatan_estate in getEmployeeCheckroll
                jabatan: undefined,
            };
        } catch (e) {
            console.error("[EmployeeDetailService] Failed to get employee info:", e);
            return null;
        }
    }

    // --- Daily Attendance ---
    public async getDailyAttendance(empCode: string, month: number, year: number): Promise<{
        matrix: Record<number, AttendanceDay>;
        summary: AttendanceSummary;
        holidays: any[];
        list: any[]; // New detailed list
    }> {
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const endDate = `${year}-${month.toString().padStart(2, "0")}-${daysInMonth}`;

        const holidays = await this.getHolidaysFromHrGph(month, year);
        const holidayDays = new Set(Object.keys(holidays).map(Number));

        // Initialize matrix
        const matrix: Record<number, AttendanceDay> = {};
        const summary: AttendanceSummary = {
            total_hadir: 0,
            total_tidak_hadir: 0,
            cuti_tahunan: 0,
            cuti_sakit: 0,
            cuti_minggu: 0,
            libur: 0,
            alpa: 0,
            no_data: 0,
            total_hk: 0,
            kehadiran_efektif: 0
        };

        for (let day = 1; day <= daysInMonth; day++) {
            matrix[day] = {
                date: `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
                status: "no_data",
                is_present: false,
                is_rest_day: false,
                is_holiday: false,
                remarks: "",
                has_data: false
            };
        }

        const attendanceList: any[] = [];

        try {
            // Query PR_TASKREGLN for attendance
            // Added Amount, Rate, and description join
            const rows = await this.db.query<{
                day_of_month: number;
                TrxDate: string;
                TaskCode: string;
                TaskDesc: string;
                Hours: number;
                Amount: number;
                Rate: number;
            }>(`
                SELECT 
                    DAY(TrxDate) as day_of_month,
                    TrxDate,
                    TaskCode,
                    TaskDesc,
                    Hours,
                    Amount,
                    Rate
                FROM (
                    SELECT trl.TrxDate, trl.TaskCode, tm.TaskDesc, trl.Hours, trl.Amount, trl.Rate
                    FROM PR_TASKREGLN trl
                    JOIN PR_TASKREG trh ON trl.MasterID = trh.ID
                    LEFT JOIN PR_TASKCODE tm ON trl.TaskCode = tm.TaskCode
                    WHERE RTRIM(trl.EmpCode) = RTRIM(?)
                      AND trl.TrxDate >= ?
                      AND trl.TrxDate <= ?
                      AND trl.OT = 0
                    
                    UNION ALL
                    
                    SELECT trl.TrxDate, trl.TaskCode, tm.TaskDesc, trl.Hours, trl.Amount, trl.Rate
                    FROM PR_TASKREGLN_ARC trl
                    JOIN PR_TASKREG_ARC trh ON trl.MasterID = trh.ID
                    LEFT JOIN PR_TASKCODE tm ON trl.TaskCode = tm.TaskCode
                    WHERE RTRIM(trl.EmpCode) = RTRIM(?)
                      AND trl.TrxDate >= ?
                      AND trl.TrxDate <= ?
                      AND trl.OT = 0
                ) combined
                ORDER BY TrxDate
            `, [empCode, startDate, endDate, empCode, startDate, endDate]);

            const daysWithData = new Set<number>();
            let maxDataDay = 0;

            // Track accumulators for days with multiple records
            const dayAccumulators: Record<number, { amount: number; hours: number; rate: number }> = {};

            for (const row of rows) {
                const day = row.day_of_month;
                const taskCode = row.TaskCode || "";

                // Initialize accumulator for this day if needed
                if (!dayAccumulators[day]) {
                    dayAccumulators[day] = { amount: 0, hours: 0, rate: 0 };
                }

                // Accumulate amount and hours for multiple records per day
                dayAccumulators[day].amount += row.Amount || 0;
                dayAccumulators[day].hours += row.Hours || 0;
                // Use the last non-zero rate or accumulate as needed
                if (row.Rate && row.Rate > 0) {
                    dayAccumulators[day].rate = row.Rate;
                }

                daysWithData.add(day);
                if (day > maxDataDay) maxDataDay = day;
                summary.total_hk++;

                // Parse date for day-of-week check
                const dateObj = new Date(row.TrxDate);
                const isSunday = dateObj.getDay() === 0;
                const isHoliday = holidayDays.has(day);

                // Determine status
                let status = "hadir";
                let remarks = "";

                if (taskCode.startsWith("GA9129")) {
                    status = "cuti_tahunan";
                    remarks = "Cuti Tahunan";
                    summary.cuti_tahunan++;
                    summary.total_tidak_hadir++;
                } else if (taskCode.startsWith("GA9126")) {
                    status = "sakit";
                    remarks = "Sakit";
                    summary.cuti_sakit++;
                    summary.total_tidak_hadir++;
                } else if (taskCode.startsWith("GA9127")) {
                    status = "cuti_minggu";
                    remarks = "Cuti Minggu";
                    summary.cuti_minggu++;
                } else if (taskCode.startsWith("GA9128")) {
                    status = "libur";
                    remarks = "Cuti Nasional";
                    summary.libur++;
                } else if (isSunday) {
                    status = "minggu";
                    remarks = "Hari Minggu";
                    summary.cuti_minggu++;
                } else if (isHoliday) {
                    const holidayInfo = holidays[day];
                    status = holidayInfo?.is_religious ? "libur_keagamaan" : "libur_nasional";
                    remarks = holidayInfo?.description || "Libur Nasional";
                    summary.libur++;
                } else {
                    summary.total_hadir++;
                    summary.kehadiran_efektif++;
                }

                // Update Matrix with accumulated values
                matrix[day] = {
                    date: row.TrxDate?.substring(0, 10) || matrix[day].date,
                    status,
                    is_present: status === "hadir",
                    is_rest_day: isSunday,
                    is_holiday: isHoliday,
                    remarks,
                    task_code: taskCode,
                    hours: dayAccumulators[day].hours,
                    amount: dayAccumulators[day].amount,
                    has_data: true
                };

                // Add to List (individual records for breakdown)
                attendanceList.push({
                    date: row.TrxDate?.substring(0, 10),
                    day,
                    task_code: taskCode,
                    task_desc: row.TaskDesc || taskCode, // Fallback to code if desc missing
                    hours: row.Hours,
                    amount: row.Amount || 0,
                    rate: row.Rate || 0,
                    status,
                    remarks: remarks || "-"
                });
            }

            // Handle days without data
            for (let day = 1; day <= daysInMonth; day++) {
                if (!daysWithData.has(day)) {
                    const dateObj = new Date(year, month - 1, day);
                    const isSunday = dateObj.getDay() === 0;
                    const isHoliday = holidayDays.has(day);

                    if (maxDataDay > 0 && day < maxDataDay && !isSunday && !isHoliday) {
                        matrix[day].status = "alpa";
                        summary.alpa++;
                        summary.total_tidak_hadir++;
                    } else {
                        summary.no_data++;
                    }

                    matrix[day].is_rest_day = isSunday;
                    matrix[day].is_holiday = isHoliday;
                }
            }
        } catch (e) {
            console.error("[EmployeeDetailService] Failed to get daily attendance:", e);
        }

        const holidayList = Object.entries(holidays).map(([day, info]) => ({
            day: parseInt(day),
            ...info
        }));

        return { matrix, summary, holidays: holidayList, list: attendanceList };
    }

    // --- Daily Overtime ---
    public async getDailyOvertime(empCode: string, month: number, year: number): Promise<{
        matrix: Record<number, OvertimeDay>;
        list: any[];
        summary: { total_hours: number; total_amount: number; total_days: number };
    }> {
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const endDate = `${year}-${month.toString().padStart(2, "0")}-${daysInMonth}`;

        // Initialize matrix
        const matrix: Record<number, OvertimeDay> = {};
        for (let day = 1; day <= daysInMonth; day++) {
            matrix[day] = {
                date: `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
                has_overtime: false,
                hours: 0,
                amount: 0,
                details: []
            };
        }

        let totalHours = 0;
        let totalAmount = 0;
        const overtimeList: any[] = [];

        try {
            // Use LemburCalculator for robust fetching (UNION ALL) and detailed breakdown
            const lemburResult = await lemburCalculator.calculate(empCode, month, year);

            for (const record of lemburResult.records) {
                const day = record.trx_date.getDate();
                const hours = record.hours;
                const dbAmount = record.raw_amount || 0;
                const breakdown = record.breakdown || null;
                const formulaAmount = breakdown?.total_amount || 0;
                const formulaRateTotal = breakdown?.total_rate || 0;
                const formulaDescription = breakdown?.uraian || '';
                const upjValue = breakdown?.upj_value || lemburResult.upj || 0;

                matrix[day].has_overtime = true;
                matrix[day].hours += hours;
                matrix[day].amount += dbAmount;
                matrix[day].amount_formula = (matrix[day].amount_formula || 0) + formulaAmount;

                const detailObj = {
                    hours,
                    amount: formulaAmount,  // [FIXED] Use formulaAmount (calculated) instead of dbAmount
                    rate: record.raw_rate || 0,
                    task_code: record.task_code || "",
                    task_desc: record.task_desc || record.task_code || "",
                    day_type: record.day_type ? getDayTypeDisplayName(record.day_type) : "-",
                    formula_amount: formulaAmount,
                    formula_rate_total: formulaRateTotal,
                    formula_uraian: formulaDescription,
                    upj_value: upjValue,
                    shift_code: record.shift_code || ""
                };

                matrix[day].details.push(detailObj);

                const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                const dayName = dayNames[record.trx_date.getDay()];

                overtimeList.push({
                    date: record.trx_date.toISOString().substring(0, 10),
                    trx_date: record.trx_date.toISOString().substring(0, 10),
                    day,
                    day_name: dayName,
                    hours,
                    amount: formulaAmount,  // [FIXED] Use formulaAmount (calculated) instead of dbAmount
                    amount_server: dbAmount,
                    amount_formula: formulaAmount,
                    rate: record.raw_rate || 0,
                    formula_rate_total: formulaRateTotal,
                    formula_uraian: formulaDescription,
                    upj_value: upjValue,
                    task_code: record.task_code || "",
                    task_desc: record.task_desc || record.task_code || "",
                    day_type: detailObj.day_type,
                    raw_day_type: record.day_type // Keep raw type for frontend styling
                });

                totalHours += hours;
                totalAmount += formulaAmount;  // [FIXED] Use formulaAmount (calculated) instead of dbAmount
            }
        } catch (e) {
            console.error("[EmployeeDetailService] Failed to get daily overtime:", e);
        }

        const totalDays = Object.values(matrix).filter(d => d.has_overtime).length;

        return {
            matrix,
            list: overtimeList,
            summary: { total_hours: totalHours, total_amount: totalAmount, total_days: totalDays }
        };
    }

    // --- Get Upah Dasar from History (extend_db_ptrj) ---
    private async getUpahDasarFromHistory(empCode: string, month: number, year: number): Promise<number | null> {
        try {
            const extDb = Database.getExtendedInstance(); // extend_db_ptrj with SERVER_PROFILE_1

            const rows = await extDb.query<{
                upah_dasar: number;
            }>(`
                SELECT upah_dasar
                FROM history_hr_employee
                WHERE RTRIM(emp_code) = RTRIM(?)
                  AND period_month = ?
                  AND period_year = ?
            `, [empCode, month, year]);

            if (rows.length > 0 && rows[0].upah_dasar) {
                console.log(`[EmployeeDetailService] Found upah_dasar from history: ${rows[0].upah_dasar} for ${empCode} (${month}/${year})`);
                return rows[0].upah_dasar;
            }

            console.log(`[EmployeeDetailService] No upah_dasar found in history for ${empCode} (${month}/${year})`);
            return null;
        } catch (e) {
            console.error("[EmployeeDetailService] Failed to get upah_dasar from history:", e);
            return null;
        }
    }

    // --- Get Position (Jabatan) from History (extend_db_ptrj) ---
    private async getPositionFromHistory(empCode: string, month: number, year: number): Promise<string | null> {
        try {
            const extDb = Database.getExtendedInstance();
            const rows = await extDb.query<{ position: string }>(`
                SELECT position
                FROM history_hr_employee
                WHERE RTRIM(emp_code) = RTRIM(?)
                  AND period_month = ?
                  AND period_year = ?
            `, [empCode, month, year]);

            if (rows.length > 0 && rows[0].position) {
                return rows[0].position.trim();
            }
            return null;
        } catch (e) {
            console.error("[EmployeeDetailService] Failed to get position from history:", e);
            return null;
        }
    }

    // --- Complete Checkroll ---
    public async getEmployeeCheckroll(rawEmpCode: string, month: number, year: number, skipHarvest: boolean = false, useHistoryDb?: boolean | null, snapshotVersion?: number | null): Promise<any> {
        const empCode = (rawEmpCode || '').trim().toUpperCase();
        console.log(`[EmployeeDetailService] getEmployeeCheckroll request for '${rawEmpCode}' -> Normalized: '${empCode}' (skipHarvest=${skipHarvest})`);

        const employeeInfo = await this.getEmployeeInfo(empCode);
        if (!employeeInfo) {
            return { emp_code: empCode, error: "Employee not found" };
        }

        const ptkpPromise = ptkpTaxService.getPtkpByYear(year).catch((e) => {
            console.error("[EmployeeDetailService] Failed to get PTKP status:", e);
            return [];
        });

        const attendancePromise = this.getDailyAttendance(empCode, month, year);
        const overtimePromise = this.getDailyOvertime(empCode, month, year);
        const harvestPromise = !skipHarvest
            ? harvesterService.getDailyEmployeeHarvest(empCode, month, year)
            : Promise.resolve({ summary: {}, details: [] });

        const payrollPromise = dataExtractorService.extractPayrollData(
            month, year, "ALL", undefined, empCode, Config.DB_PROFILE, false, useHistoryDb, undefined, skipHarvest, false, snapshotVersion
        ).then((payrollResult) => {
            const targetNik = empCode.trim().toUpperCase();
            const debugInfo: any = {
                target_nik: targetNik,
                rows_fetched: payrollResult?.data_rows?.length || 0,
                available_niks: payrollResult?.data_rows?.map(r => `${r.emp_code || '?'}/${r.nik || 'N/A'}`).slice(0, 5)
            };

            const payrollData = payrollResult.data_rows.find(row =>
                (row.emp_code || '').trim().toUpperCase() === targetNik ||
                (row.nik || '').trim().toUpperCase() === targetNik
            ) || null;

            if (payrollData) {
                console.log(`[EmployeeDetailService] Payroll Data Found for '${empCode}' (Rows: ${payrollResult.data_rows.length})`);
                debugInfo.found = true;
            } else {
                const availableNiks = payrollResult.data_rows.map(r => `'${r.nik}'`).join(", ");
                console.warn(`[EmployeeDetailService] Payroll row not found for ${empCode}. Target: '${targetNik}'. Available: [${availableNiks}]`);
                console.warn(`[EmployeeDetailService] ExtractPayrollData returned ${payrollResult.data_rows.length} rows.`);
                debugInfo.found = false;
            }

            return { payrollData, debugInfo };
        }).catch((e: any) => {
            console.error("[EmployeeDetailService] Failed to extract payroll data:", e);
            return { payrollData: null, debugInfo: { error: e.message || String(e) } };
        });

        const [ptkpRecords, attendanceData, overtimeData, harvestData, payrollResult] = await Promise.all([
            ptkpPromise,
            attendancePromise,
            overtimePromise,
            harvestPromise,
            payrollPromise
        ]);

        const ptkpRecord = ptkpRecords.find(p => p.emp_code.trim() === empCode);
        if (ptkpRecord) {
            employeeInfo.status_ptkp = ptkpRecord.ptkp_status;
        }

        const payrollData = payrollResult.payrollData;
        const debugInfo = payrollResult.debugInfo;

        // Enrich employeeInfo.jabatan from payrollData (db_ptrj source)
        console.log(`[EmployeeDetailService] Jabatan enrichment - payrollData.jabatan_estate=${payrollData?.jabatan_estate}, payrollData.task_desc=${payrollData?.task_desc}`);
        if (payrollData?.jabatan_estate) {
            employeeInfo.jabatan = payrollData.jabatan_estate;
            console.log(`[EmployeeDetailService] ✅ Jabatan set from jabatan_estate: ${employeeInfo.jabatan}`);
        } else if (payrollData?.task_desc) {
            employeeInfo.jabatan = payrollData.task_desc;
            console.log(`[EmployeeDetailService] ⚠️ Jabatan set from task_desc (fallback): ${employeeInfo.jabatan}`);
        } else {
            console.log(`[EmployeeDetailService] ❌ No jabatan found in payrollData`);
        }

        return {
            emp_code: empCode,
            month,
            year,
            employee: employeeInfo,
            attendance: attendanceData,
            overtime: overtimeData,
            harvest: harvestData,
            payroll_data: payrollData,
            // Include shortage/excess details directly in response for easy access
            shortage_details: payrollData?.shortage_details || [],
            shortage_total_hours: payrollData?.shortage_total_hours || 0,
            excess_details: payrollData?.excess_details || [],
            excess_total_hours: payrollData?.excess_total_hours || 0,
            koreksi_hk: payrollData?.koreksi_hk || 0,
            debug_info: debugInfo
        };
    }

    // --- HR Changelog ---
    public async getHrChangelog(empCode: string): Promise<any[]> {
        try {
            const extDb = Database.getInstance(Config.DB_EXTEND_TRANS_DATABASE); // extend_db_ptrj

            // Get all historical HR records for this employee, ordered by period
            const historyQuery = await extDb.query<{
                period_year: number;
                period_month: number;
                ptkp_beras: string;
                upah_dasar: number;
                status: string;
                employee_type: string;
                gang_code: string;
                division_code: string;
            }>(`
                SELECT 
                    period_year, 
                    period_month, 
                    ptkp_beras, 
                    upah_dasar, 
                    status, 
                    employee_type, 
                    gang_code, 
                    division_code
                FROM history_hr_employee
                WHERE RTRIM(emp_code) = RTRIM(?)
                ORDER BY period_year ASC, period_month ASC
            `, [empCode]);

            if (historyQuery.length === 0) return [];

            const changelog = [];
            let previousPeriod: any = null;

            for (const current of historyQuery) {
                if (previousPeriod) {
                    const changes = [];
                    if (previousPeriod.ptkp_beras !== current.ptkp_beras) {
                        changes.push({ field: 'Tunjangan Beras', old: previousPeriod.ptkp_beras || 'Tidak Ada', new: current.ptkp_beras || 'Tidak Ada' });
                    }
                    if (previousPeriod.upah_dasar !== current.upah_dasar) {
                        changes.push({ field: 'Upah Dasar', old: previousPeriod.upah_dasar, new: current.upah_dasar });
                    }
                    if (previousPeriod.status !== current.status) {
                        changes.push({ field: 'Status Karyawan', old: previousPeriod.status || '-', new: current.status || '-' });
                    }
                    if (previousPeriod.employee_type !== current.employee_type) {
                        changes.push({ field: 'Tipe Karyawan', old: previousPeriod.employee_type || '-', new: current.employee_type || '-' });
                    }
                    if (previousPeriod.gang_code !== current.gang_code) {
                        changes.push({ field: 'Kode Gang', old: previousPeriod.gang_code || '-', new: current.gang_code || '-' });
                    }

                    if (changes.length > 0) {
                        changelog.push({
                            period: `${current.period_year}-${current.period_month.toString().padStart(2, '0')}`,
                            month: current.period_month,
                            year: current.period_year,
                            changes
                        });
                    }
                } else {
                    // Initial seeded record - log base values
                    const initialChanges = [];
                    if (current.ptkp_beras) initialChanges.push({ field: 'Tunjangan Beras', old: null, new: current.ptkp_beras });
                    if (current.upah_dasar) initialChanges.push({ field: 'Upah Dasar', old: null, new: current.upah_dasar });
                    if (current.gang_code) initialChanges.push({ field: 'Kode Gang', old: null, new: current.gang_code });

                    changelog.push({
                        period: `${current.period_year}-${current.period_month.toString().padStart(2, '0')}`,
                        month: current.period_month,
                        year: current.period_year,
                        changes: initialChanges,
                        is_initial: true
                    });
                }
                previousPeriod = current;
            }

            // Reverse to show latest changes first
            return changelog.reverse();
        } catch (e) {
            console.error("[EmployeeDetailService] Failed to generate HR changelog:", e);
            return [];
        }
    }
}

export const employeeDetailService = EmployeeDetailService.getInstance();
