import { Database } from "../db/client";
import { Config } from "../config";
import {
    buildAdtransDocDescSqlCondition,
    normalizeAdtransFilter,
    matchesAdtransDocDescFilter
} from "./payroll/adtransDocDescMapping";
import { divisionConfigService } from "./config/DivisionConfigService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerificationSource =
    | "adtrans"
    | "taskregln_hk"
    | "taskregln_lembur"
    | "hr_payroll"
    | "hr_employee"
    | "manual_adjustments";

export type VerificationStatus =
    | "MATCH"
    | "MISMATCH"
    | "MISSING_IN_DISPLAY"
    | "MISSING_IN_SOURCE"
    | "NO_MATCH_IN_DB_PTRJ";

export interface VerificationComparisonItem {
    emp_code: string;
    nik: string;
    nama: string;
    gang_code: string;
    source: VerificationSource;
    field: string;
    db_ptrj_value: number | string | boolean | null;
    display_value: number | string | boolean | null;
    diff: number | null;
    status: VerificationStatus;
    db_ptrj_detail?: Record<string, any> | null;
}

export interface VerificationSummaryBySource {
    match: number;
    mismatch: number;
    missing_in_display: number;
    missing_in_source: number;
    no_match_in_db_ptrj: number;
}

export interface FullVerificationResult {
    period_month: number;
    period_year: number;
    division_code: string;
    gang_code: string | null;
    summary: {
        total_checks: number;
        match_count: number;
        mismatch_count: number;
        missing_in_display: number;
        missing_in_source: number;
        no_match_in_db_ptrj: number;
        by_source: Record<VerificationSource, VerificationSummaryBySource>;
    };
    comparisons: VerificationComparisonItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUpper(value: unknown): string {
    return String(value || "").trim().toUpperCase();
}

function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function valuesMatch(a: unknown, b: unknown): boolean {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na !== 0 || nb !== 0) return Math.abs(na - nb) <= 0.01;
    return String(a ?? "").trim() === String(b ?? "").trim();
}

function diffValue(a: unknown, b: unknown): number | null {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na === 0 && nb === 0) return null;
    return na - nb;
}

function resolveLocCode(divisionCode: string): string {
    const normalized = divisionCode.trim().toUpperCase();
    const locCodeMap: Record<string, string> = {
        PG1A: "P1A", PG1B: "P1B", PG2A: "P2A", PG2B: "P2B",
        ARB1: "AB1", ARB2: "AB2", AREC: "ARC",
        PLASMA1A: "P1A", PLASMA1B: "P1B", PLASMA2A: "P2A", PLASMA2B: "P2B",
        "1A": "P1A", "1B": "P1B", "2A": "P2A", "2B": "P2B"
    };
    const sourceDivision = divisionConfigService.getSourceDivision(normalized);
    const resolved = sourceDivision || normalized;
    return locCodeMap[resolved] || resolved;
}

function emptySourceSummary(): VerificationSummaryBySource {
    return { match: 0, mismatch: 0, missing_in_display: 0, missing_in_source: 0, no_match_in_db_ptrj: 0 };
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class PayrollVerificationService {
    private static instance: PayrollVerificationService;

    private constructor() {}

    public static getInstance(): PayrollVerificationService {
        if (!PayrollVerificationService.instance) {
            PayrollVerificationService.instance = new PayrollVerificationService();
        }
        return PayrollVerificationService.instance;
    }

    private getDbPtrj(): Database {
        return Database.getInstance();
    }

    private getDbExtend(): Database {
        return Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    // ─── Full Verification ─────────────────────────────────────────────────

    public async verifyFullPayroll(
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        gangCode?: string,
        empCodes?: string[],
        sourceFilter?: string[]
    ): Promise<FullVerificationResult> {
        const dbPtrj = this.getDbPtrj();
        const dbExtend = this.getDbExtend();
        const locCode = resolveLocCode(divisionCode);
        const requestedDivision = divisionConfigService.getDivision(divisionCode);
        const virtualGangCodes = requestedDivision?.type === "virtual"
            ? [requestedDivision.code, ...requestedDivision.aliases.filter(a => requestedDivision.gangPattern?.test(a.trim().toUpperCase()))].map(c => c.trim().toUpperCase())
            : [];
        const uniqueVirtualGangCodes = Array.from(new Set(virtualGangCodes));
        const gangJoin = uniqueVirtualGangCodes.length > 0
            ? `JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)`
            : "";
        const gangWhere = uniqueVirtualGangCodes.length > 0
            ? `AND UPPER(RTRIM(gl.GangCode)) IN (${uniqueVirtualGangCodes.map(() => "?").join(",")})`
            : "";

        const comparisons: VerificationComparisonItem[] = [];
        const bySource: Record<VerificationSource, VerificationSummaryBySource> = {
            adtrans: emptySourceSummary(),
            taskregln_hk: emptySourceSummary(),
            taskregln_lembur: emptySourceSummary(),
            hr_payroll: emptySourceSummary(),
            hr_employee: emptySourceSummary(),
            manual_adjustments: emptySourceSummary()
        };

        const activeSources = sourceFilter?.length
            ? sourceFilter.map(s => s as VerificationSource)
            : Object.keys(bySource) as VerificationSource[];

        // Run source verifications in parallel
        const promises: Promise<void>[] = [];

        if (activeSources.includes("adtrans")) {
            promises.push(this.verifyAdtransSource(dbPtrj, periodMonth, periodYear, locCode, gangJoin, gangWhere, uniqueVirtualGangCodes, comparisons, bySource.adtrans, empCodes));
        }
        if (activeSources.includes("taskregln_hk")) {
            promises.push(this.verifyTaskReglnHkSource(dbPtrj, periodMonth, periodYear, locCode, comparisons, bySource.taskregln_hk, empCodes));
        }
        if (activeSources.includes("taskregln_lembur")) {
            promises.push(this.verifyTaskReglnLemburSource(dbPtrj, periodMonth, periodYear, locCode, comparisons, bySource.taskregln_lembur, empCodes));
        }
        if (activeSources.includes("hr_payroll")) {
            promises.push(this.verifyHrPayrollSource(dbPtrj, locCode, comparisons, bySource.hr_payroll, empCodes));
        }
        if (activeSources.includes("hr_employee")) {
            promises.push(this.verifyEmployeeIdentitySource(dbPtrj, locCode, comparisons, bySource.hr_employee, empCodes));
        }
        if (activeSources.includes("manual_adjustments")) {
            promises.push(this.verifyManualAdjustmentSource(dbPtrj, dbExtend, periodMonth, periodYear, divisionCode, locCode, comparisons, bySource.manual_adjustments, empCodes));
        }

        await Promise.all(promises);

        // Calculate totals
        let totalChecks = 0, matchCount = 0, mismatchCount = 0, missingInDisplay = 0, missingInSource = 0, noMatchInDbPtrj = 0;
        for (const src of Object.values(bySource)) {
            totalChecks += src.match + src.mismatch + src.missing_in_display + src.missing_in_source + src.no_match_in_db_ptrj;
            matchCount += src.match;
            mismatchCount += src.mismatch;
            missingInDisplay += src.missing_in_display;
            missingInSource += src.missing_in_source;
            noMatchInDbPtrj += src.no_match_in_db_ptrj;
        }

        return {
            period_month: periodMonth,
            period_year: periodYear,
            division_code: divisionCode,
            gang_code: gangCode || null,
            summary: {
                total_checks: totalChecks,
                match_count: matchCount,
                mismatch_count: mismatchCount,
                missing_in_display: missingInDisplay,
                missing_in_source: missingInSource,
                no_match_in_db_ptrj: noMatchInDbPtrj,
                by_source: bySource
            },
            comparisons
        };
    }

    // ─── PR_ADTRANS Source ──────────────────────────────────────────────────

    private async verifyAdtransSource(
        dbPtrj: Database,
        periodMonth: number,
        periodYear: number,
        locCode: string,
        gangJoin: string,
        gangWhere: string,
        gangParams: string[],
        comparisons: VerificationComparisonItem[],
        summary: VerificationSummaryBySource,
        empCodes?: string[]
    ): Promise<void> {
        const empFilter = empCodes?.length
            ? `AND RTRIM(t.EmpCode) IN (${empCodes.map(() => "?").join(",")})`
            : "";

        // Get per-emp per-DocDesc amounts from PR_ADTRANS
        const adtransQuery = `
            SELECT
                RTRIM(t.EmpCode) as emp_code,
                RTRIM(ISNULL(e.NewICNo, '')) as nik,
                RTRIM(ISNULL(e.EmpName, '')) as nama,
                RTRIM(t.DocDesc) as doc_desc,
                SUM(ln.Amount) as amount
            FROM PR_ADTRANS t
            ${gangJoin}
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(t.EmpCode)
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE UPPER(RTRIM(t.LocCode)) = ?
              AND t.PhyMonth = ? AND t.PhyYear = ?
              AND t.Status = 1
              ${gangWhere} ${empFilter}
            GROUP BY t.EmpCode, e.NewICNo, e.EmpName, t.DocDesc

            UNION ALL

            SELECT
                RTRIM(t.EmpCode) as emp_code,
                RTRIM(ISNULL(e.NewICNo, '')) as nik,
                RTRIM(ISNULL(e.EmpName, '')) as nama,
                RTRIM(t.DocDesc) as doc_desc,
                SUM(ln.Amount) as amount
            FROM PR_ADTRANS_ARC t
            ${gangJoin}
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(t.EmpCode)
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE UPPER(RTRIM(t.LocCode)) = ?
              AND t.PhyMonth = ? AND t.PhyYear = ?
              AND t.Status = 3
              ${gangWhere} ${empFilter}
            GROUP BY t.EmpCode, e.NewICNo, e.EmpName, t.DocDesc
        `;

        const params = [
            locCode, periodMonth, periodYear, ...gangParams, ...(empCodes || []),
            locCode, periodMonth, periodYear, ...gangParams, ...(empCodes || [])
        ];

        const rows = await dbPtrj.query<any>(adtransQuery, params);

        // Get gang code for each emp from HR_GANGLN
        const empGangMap = new Map<string, string>();
        const empCodesInResult = Array.from(new Set(rows.map((r: any) => normalizeUpper(r.emp_code))));
        if (empCodesInResult.length > 0) {
            const gangQuery = `SELECT RTRIM(GangMember) as emp_code, RTRIM(GangCode) as gang_code FROM HR_GANGLN WHERE RTRIM(GangMember) IN (${empCodesInResult.map(() => "?").join(",")})`;
            const gangRows = await dbPtrj.query<any>(gangQuery, empCodesInResult);
            for (const gr of gangRows) {
                empGangMap.set(normalizeUpper(gr.emp_code), String(gr.gang_code || "").trim());
            }
        }

        // Get stored manual adjustments for comparison
        const adjustmentDivisionCodes = Array.from(new Set([locCode]));
        const adjustmentRows = await this.getDbExtend().query<any>(`
            SELECT emp_code, nik, adjustment_type, adjustment_name, amount, gang_code
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND UPPER(RTRIM(division_code)) IN (${adjustmentDivisionCodes.map(() => "?").join(",")})
        `, [periodMonth, periodYear, ...adjustmentDivisionCodes]);

        // Build stored map: emp_code -> adjustment_name -> amount
        const storedMap = new Map<string, Map<string, { amount: number; adjustment_type: string }>>();
        for (const adj of adjustmentRows) {
            const key = normalizeUpper(adj.emp_code || adj.nik);
            if (!key) continue;
            if (!storedMap.has(key)) storedMap.set(key, new Map());
            const adjName = normalizeUpper(adj.adjustment_name);
            storedMap.get(key)!.set(adjName, { amount: toNumber(adj.amount), adjustment_type: normalizeUpper(adj.adjustment_type) });
        }

        // Known AUTO_BUFFER mappings
        const autoBufferToDocDesc: Record<string, string[]> = {
            "TUNJANGAN JABATAN": ["JABATAN"],
            "MASA KERJA": ["MASA KERJA"],
            "SPSI": ["SPSI"],
            "AUTO TUNJANGAN JABATAN": ["JABATAN"],
            "AUTO MASA KERJA": ["MASA KERJA"],
            "AUTO SPSI": ["SPSI"]
        };

        // Process each DocDesc row
        for (const row of rows) {
            const empCode = normalizeUpper(row.emp_code);
            const nik = String(row.nik || "").trim().toUpperCase();
            const nama = String(row.nama || "").trim();
            const docDesc = String(row.doc_desc || "").trim();
            const sourceAmount = toNumber(row.amount);
            const gangCode = empGangMap.get(empCode) || "";

            if (Math.abs(sourceAmount) <= 0.01) continue;

            // Find matching stored adjustment
            const empStored = storedMap.get(empCode) || storedMap.get(nik);
            let matchedAdjName: string | null = null;
            let storedAmount: number | null = null;

            // Check AUTO_BUFFER matches first
            for (const [adjName, docDescKeywords] of Object.entries(autoBufferToDocDesc)) {
                const storedAdj = empStored?.get(adjName);
                if (storedAdj && docDescKeywords.some(kw => normalizeUpper(docDesc).includes(kw))) {
                    matchedAdjName = adjName;
                    storedAmount = storedAdj.amount;
                    break;
                }
            }

            // Check direct name match for PREMI/POTONGAN
            if (matchedAdjName === null && empStored) {
                for (const [adjName, adjData] of empStored) {
                    if (adjData.adjustment_type === "AUTO_BUFFER") continue;
                    // Normalized comparison
                    const normAdjName = normalizeUpper(adjName).replace(/^PREMI\s*/i, "").replace(/^TUNJANGAN\s*PREMI\s*/i, "").replace(/^TUNJANGAN\s*/i, "");
                    const normDocDesc = normalizeUpper(docDesc).replace(/^PREMI\s*/i, "").replace(/^TUNJANGAN\s*PREMI\s*/i, "").replace(/^TUNJANGAN\s*/i, "");
                    if (normAdjName && (normDocDesc.includes(normAdjName) || normAdjName.includes(normDocDesc))) {
                        matchedAdjName = adjName;
                        storedAmount = adjData.amount;
                        break;
                    }
                    // Also try exact match
                    if (normalizeUpper(adjName) === normalizeUpper(docDesc)) {
                        matchedAdjName = adjName;
                        storedAmount = adjData.amount;
                        break;
                    }
                }
            }

            const status: VerificationStatus = storedAmount === null
                ? "MISSING_IN_DISPLAY"
                : valuesMatch(sourceAmount, storedAmount)
                    ? "MATCH"
                    : "MISMATCH";

            const item: VerificationComparisonItem = {
                emp_code: empCode,
                nik,
                nama,
                gang_code: gangCode,
                source: "adtrans",
                field: docDesc,
                db_ptrj_value: sourceAmount,
                display_value: storedAmount,
                diff: storedAmount !== null ? diffValue(sourceAmount, storedAmount) : null,
                status,
                db_ptrj_detail: { doc_desc: docDesc }
            };

            comparisons.push(item);
            this.incrementSummary(summary, status);
        }

        // Check for adjustments with no match in db_ptrj
        for (const [empKey, adjMap] of storedMap) {
            for (const [adjName, adjData] of adjMap) {
                if (adjData.adjustment_type === "AUTO_BUFFER") {
                    // Check if there's a corresponding DocDesc
                    const keywords = autoBufferToDocDesc[adjName];
                    if (keywords) {
                        const hasMatch = rows.some((r: any) =>
                            normalizeUpper(r.emp_code) === empKey &&
                            keywords.some(kw => normalizeUpper(r.doc_desc).includes(kw))
                        );
                        if (!hasMatch) {
                            comparisons.push({
                                emp_code: empKey,
                                nik: "",
                                nama: "",
                                gang_code: "",
                                source: "adtrans",
                                field: adjName,
                                db_ptrj_value: null,
                                display_value: adjData.amount,
                                diff: null,
                                status: "NO_MATCH_IN_DB_PTRJ"
                            });
                            this.incrementSummary(summary, "NO_MATCH_IN_DB_PTRJ");
                        }
                    }
                } else if (adjData.adjustment_type !== "PENDAPATAN_LAINNYA") {
                    // Manual adjustments: check if DocDesc exists
                    const normAdjName = normalizeUpper(adjName).replace(/^PREMI\s*/i, "").replace(/^TUNJANGAN\s*PREMI\s*/i, "");
                    const hasMatch = rows.some((r: any) =>
                        normalizeUpper(r.emp_code) === empKey &&
                        (normalizeUpper(r.doc_desc) === normalizeUpper(adjName) || normalizeUpper(r.doc_desc).includes(normAdjName))
                    );
                    if (!hasMatch) {
                        comparisons.push({
                            emp_code: empKey,
                            nik: "",
                            nama: "",
                            gang_code: "",
                            source: "adtrans",
                            field: adjName,
                            db_ptrj_value: null,
                            display_value: adjData.amount,
                            diff: null,
                            status: "NO_MATCH_IN_DB_PTRJ"
                        });
                        this.incrementSummary(summary, "NO_MATCH_IN_DB_PTRJ");
                    }
                }
            }
        }
    }

    // ─── PR_TASKREGLN HK Source ─────────────────────────────────────────────

    private async verifyTaskReglnHkSource(
        dbPtrj: Database,
        periodMonth: number,
        periodYear: number,
        locCode: string,
        comparisons: VerificationComparisonItem[],
        summary: VerificationSummaryBySource,
        empCodes?: string[]
    ): Promise<void> {
        const empFilter = empCodes?.length
            ? `AND RTRIM(l.EmpCode) IN (${empCodes.map(() => "?").join(",")})`
            : "";

        // Get start/end date for the period
        const startDate = `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`;
        const endDate = `${periodYear}-${String(periodMonth).padStart(2, "0")}-${new Date(periodYear, periodMonth, 0).getDate()}`;

        const hkQuery = `
            SELECT
                RTRIM(l.EmpCode) as emp_code,
                RTRIM(ISNULL(e.NewICNo, '')) as nik,
                RTRIM(ISNULL(e.EmpName, '')) as nama,
                COUNT(CASE WHEN l.OT = 0
                    AND tc.TaskCode NOT LIKE 'GA9126%'
                    AND tc.TaskCode NOT LIKE 'GA9127%'
                    AND tc.TaskCode NOT LIKE 'GA9128%'
                    AND tc.TaskCode NOT LIKE 'GA9129%'
                    THEN 1 END) as hk_count,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9129%' THEN 1 END) as cuti_tahunan,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9126%' THEN 1 END) as cuti_sakit,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9127%' THEN 1 END) as cuti_minggu,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9128%' THEN 1 END) as cuti_nasional
            FROM PR_TASKREGLN l
            JOIN PR_TASKREG m ON l.MasterID = m.ID
            LEFT JOIN PR_TASKCODE tc ON l.TaskCode = tc.TaskCode
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(l.EmpCode)
            WHERE l.TrxDate >= ? AND l.TrxDate <= ?
              ${empFilter}
            GROUP BY l.EmpCode, e.NewICNo, e.EmpName

            UNION ALL

            SELECT
                RTRIM(l.EmpCode) as emp_code,
                RTRIM(ISNULL(e.NewICNo, '')) as nik,
                RTRIM(ISNULL(e.EmpName, '')) as nama,
                COUNT(CASE WHEN l.OT = 0
                    AND tc.TaskCode NOT LIKE 'GA9126%'
                    AND tc.TaskCode NOT LIKE 'GA9127%'
                    AND tc.TaskCode NOT LIKE 'GA9128%'
                    AND tc.TaskCode NOT LIKE 'GA9129%'
                    THEN 1 END) as hk_count,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9129%' THEN 1 END) as cuti_tahunan,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9126%' THEN 1 END) as cuti_sakit,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9127%' THEN 1 END) as cuti_minggu,
                COUNT(CASE WHEN tc.TaskCode LIKE 'GA9128%' THEN 1 END) as cuti_nasional
            FROM PR_TASKREGLN_ARC l
            JOIN PR_TASKREG_ARC m ON l.MasterID = m.ID
            LEFT JOIN PR_TASKCODE tc ON l.TaskCode = tc.TaskCode
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(l.EmpCode)
            WHERE l.TrxDate >= ? AND l.TrxDate <= ?
              ${empFilter}
            GROUP BY l.EmpCode, e.NewICNo, e.EmpName
        `;

        const params = [startDate, endDate, ...(empCodes || []), startDate, endDate, ...(empCodes || [])];
        const rows = await dbPtrj.query<any>(hkQuery, params);

        // Get display values from aggregation table
        const displayRows = await this.getDbExtend().query<any>(`
            SELECT emp_code, nik, jumlah_hk, cuti_tahunan, cuti_sakit, cuti_minggu, cuti_nasional
            FROM dbo.payroll_employee_attendance
            WHERE period_month = ? AND period_year = ?
        `, [periodMonth, periodYear]);

        const displayMap = new Map<string, any>();
        for (const dr of displayRows) {
            const key = normalizeUpper(dr.emp_code || dr.nik);
            if (key) displayMap.set(key, dr);
        }

        for (const row of rows) {
            const empCode = normalizeUpper(row.emp_code);
            const nik = String(row.nik || "").trim().toUpperCase();
            const nama = String(row.nama || "").trim();
            const display = displayMap.get(empCode) || displayMap.get(nik);

            const fields = [
                { field: "jumlah_hk", dbVal: row.hk_count, dispVal: display?.jumlah_hk },
                { field: "cuti_tahunan", dbVal: row.cuti_tahunan, dispVal: display?.cuti_tahunan },
                { field: "cuti_sakit", dbVal: row.cuti_sakit, dispVal: display?.cuti_sakit },
                { field: "cuti_minggu", dbVal: row.cuti_minggu, dispVal: display?.cuti_minggu },
                { field: "cuti_nasional", dbVal: row.cuti_nasional, dispVal: display?.cuti_nasional }
            ];

            for (const f of fields) {
                if (toNumber(f.dbVal) === 0 && !f.dispVal) continue;
                const status: VerificationStatus = f.dispVal === undefined || f.dispVal === null
                    ? "MISSING_IN_DISPLAY"
                    : valuesMatch(f.dbVal, f.dispVal) ? "MATCH" : "MISMATCH";

                comparisons.push({
                    emp_code: empCode,
                    nik,
                    nama,
                    gang_code: "",
                    source: "taskregln_hk",
                    field: f.field,
                    db_ptrj_value: toNumber(f.dbVal),
                    display_value: f.dispVal !== undefined && f.dispVal !== null ? toNumber(f.dispVal) : null,
                    diff: f.dispVal !== undefined && f.dispVal !== null ? diffValue(f.dbVal, f.dispVal) : null,
                    status
                });
                this.incrementSummary(summary, status);
            }
        }
    }

    // ─── PR_TASKREGLN Lembur Source ─────────────────────────────────────────

    private async verifyTaskReglnLemburSource(
        dbPtrj: Database,
        periodMonth: number,
        periodYear: number,
        locCode: string,
        comparisons: VerificationComparisonItem[],
        summary: VerificationSummaryBySource,
        empCodes?: string[]
    ): Promise<void> {
        const empFilter = empCodes?.length
            ? `AND RTRIM(l.EmpCode) IN (${empCodes.map(() => "?").join(",")})`
            : "";
        const startDate = `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`;
        const endDate = `${periodYear}-${String(periodMonth).padStart(2, "0")}-${new Date(periodYear, periodMonth, 0).getDate()}`;

        const lemburQuery = `
            SELECT
                RTRIM(l.EmpCode) as emp_code,
                RTRIM(ISNULL(e.NewICNo, '')) as nik,
                RTRIM(ISNULL(e.EmpName, '')) as nama,
                SUM(l.Hours) as total_hours,
                SUM(l.Amount) as total_amount,
                COUNT(*) as record_count
            FROM PR_TASKREGLN l
            JOIN PR_TASKREG m ON l.MasterID = m.ID
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(l.EmpCode)
            WHERE l.OT = 1 AND l.TrxDate >= ? AND l.TrxDate <= ?
              ${empFilter}
            GROUP BY l.EmpCode, e.NewICNo, e.EmpName

            UNION ALL

            SELECT
                RTRIM(l.EmpCode) as emp_code,
                RTRIM(ISNULL(e.NewICNo, '')) as nik,
                RTRIM(ISNULL(e.EmpName, '')) as nama,
                SUM(l.Hours) as total_hours,
                SUM(l.Amount) as total_amount,
                COUNT(*) as record_count
            FROM PR_TASKREGLN_ARC l
            JOIN PR_TASKREG_ARC m ON l.MasterID = m.ID
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(l.EmpCode)
            WHERE l.OT = 1 AND l.TrxDate >= ? AND l.TrxDate <= ?
              ${empFilter}
            GROUP BY l.EmpCode, e.NewICNo, e.EmpName
        `;

        const params = [startDate, endDate, ...(empCodes || []), startDate, endDate, ...(empCodes || [])];
        const rows = await dbPtrj.query<any>(lemburQuery, params);

        // Get display lembur from aggregation
        const displayRows = await this.getDbExtend().query<any>(`
            SELECT emp_code, nik, lembur_jam, lembur_jumlah
            FROM dbo.payroll_employee_lembur
            WHERE period_month = ? AND period_year = ?
        `, [periodMonth, periodYear]);

        const displayMap = new Map<string, any>();
        for (const dr of displayRows) {
            const key = normalizeUpper(dr.emp_code || dr.nik);
            if (key) displayMap.set(key, dr);
        }

        for (const row of rows) {
            const empCode = normalizeUpper(row.emp_code);
            const nik = String(row.nik || "").trim().toUpperCase();
            const nama = String(row.nama || "").trim();
            const display = displayMap.get(empCode) || displayMap.get(nik);

            const fields = [
                { field: "lembur_jam", dbVal: row.total_hours, dispVal: display?.lembur_jam },
                { field: "lembur_jumlah", dbVal: row.total_amount, dispVal: display?.lembur_jumlah }
            ];

            for (const f of fields) {
                if (toNumber(f.dbVal) === 0 && !f.dispVal) continue;
                const status: VerificationStatus = f.dispVal === undefined || f.dispVal === null
                    ? "MISSING_IN_DISPLAY"
                    : valuesMatch(f.dbVal, f.dispVal) ? "MATCH" : "MISMATCH";

                comparisons.push({
                    emp_code: empCode,
                    nik,
                    nama,
                    gang_code: "",
                    source: "taskregln_lembur",
                    field: f.field,
                    db_ptrj_value: toNumber(f.dbVal),
                    display_value: f.dispVal !== undefined && f.dispVal !== null ? toNumber(f.dispVal) : null,
                    diff: f.dispVal !== undefined && f.dispVal !== null ? diffValue(f.dbVal, f.dispVal) : null,
                    status
                });
                this.incrementSummary(summary, status);
            }
        }
    }

    // ─── HR_PAYROLL Source ──────────────────────────────────────────────────

    private async verifyHrPayrollSource(
        dbPtrj: Database,
        locCode: string,
        comparisons: VerificationComparisonItem[],
        summary: VerificationSummaryBySource,
        empCodes?: string[]
    ): Promise<void> {
        const empFilter = empCodes?.length
            ? `AND RTRIM(p.EmpCode) IN (${empCodes.map(() => "?").join(",")})`
            : "";

        const payrollQuery = `
            SELECT
                RTRIM(p.EmpCode) as emp_code,
                RTRIM(ISNULL(e.NewICNo, '')) as nik,
                RTRIM(ISNULL(e.EmpName, '')) as nama,
                p.PayRate as pay_rate,
                p.BerasRate as beras_rate
            FROM HR_PAYROLL p
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(p.EmpCode)
            WHERE 1=1 ${empFilter}
        `;

        const rows = await dbPtrj.query<any>(payrollQuery, empCodes || []);

        // Get display values from aggregation
        const displayRows = await this.getDbExtend().query<any>(`
            SELECT emp_code, nik, upah_dasar, beras_rate
            FROM dbo.payroll_employee_summary
            WHERE 1=1 ${empFilter ? `AND UPPER(RTRIM(emp_code)) IN (${empCodes!.map(() => "?").join(",")})` : ""}
        `, empCodes || []);

        const displayMap = new Map<string, any>();
        for (const dr of displayRows) {
            const key = normalizeUpper(dr.emp_code || dr.nik);
            if (key) displayMap.set(key, dr);
        }

        for (const row of rows) {
            const empCode = normalizeUpper(row.emp_code);
            const nik = String(row.nik || "").trim().toUpperCase();
            const nama = String(row.nama || "").trim();
            const display = displayMap.get(empCode) || displayMap.get(nik);

            const fields = [
                { field: "pay_rate", dbVal: row.pay_rate, dispVal: display?.upah_dasar },
                { field: "beras_rate", dbVal: row.beras_rate, dispVal: display?.beras_rate }
            ];

            for (const f of fields) {
                if (toNumber(f.dbVal) === 0 && !f.dispVal) continue;
                const status: VerificationStatus = f.dispVal === undefined || f.dispVal === null
                    ? "MISSING_IN_DISPLAY"
                    : valuesMatch(f.dbVal, f.dispVal) ? "MATCH" : "MISMATCH";

                comparisons.push({
                    emp_code: empCode,
                    nik,
                    nama,
                    gang_code: "",
                    source: "hr_payroll",
                    field: f.field,
                    db_ptrj_value: toNumber(f.dbVal),
                    display_value: f.dispVal !== undefined && f.dispVal !== null ? toNumber(f.dispVal) : null,
                    diff: f.dispVal !== undefined && f.dispVal !== null ? diffValue(f.dbVal, f.dispVal) : null,
                    status
                });
                this.incrementSummary(summary, status);
            }
        }
    }

    // ─── HR_EMPLOYEE Identity Source ────────────────────────────────────────

    private async verifyEmployeeIdentitySource(
        dbPtrj: Database,
        locCode: string,
        comparisons: VerificationComparisonItem[],
        summary: VerificationSummaryBySource,
        empCodes?: string[]
    ): Promise<void> {
        if (!empCodes?.length) return; // Only check specific employees

        const empQuery = `
            SELECT
                RTRIM(EmpCode) as emp_code,
                RTRIM(ISNULL(NewICNo, '')) as nik,
                RTRIM(ISNULL(EmpName, '')) as nama,
                ISNULL(JoinDate, '') as join_date
            FROM HR_EMPLOYEE
            WHERE RTRIM(EmpCode) IN (${empCodes.map(() => "?").join(",")})
        `;

        const rows = await dbPtrj.query<any>(empQuery, empCodes);

        // Get display identity from extend_db
        const displayRows = await this.getDbExtend().query<any>(`
            SELECT emp_code, nik, nama
            FROM dbo.payroll_employee_summary
            WHERE UPPER(RTRIM(emp_code)) IN (${empCodes.map(() => "?").join(",")})
        `, empCodes);

        const displayMap = new Map<string, any>();
        for (const dr of displayRows) {
            const key = normalizeUpper(dr.emp_code || dr.nik);
            if (key) displayMap.set(key, dr);
        }

        for (const row of rows) {
            const empCode = normalizeUpper(row.emp_code);
            const display = displayMap.get(empCode);

            // Check NIK
            const dbNik = String(row.nik || "").trim();
            const dispNik = display?.nik ? String(display.nik).trim() : null;
            if (dbNik) {
                const nikMatch = dispNik ? normalizeUpper(dbNik) === normalizeUpper(dispNik) : false;
                comparisons.push({
                    emp_code: empCode,
                    nik: dbNik,
                    nama: String(row.nama || "").trim(),
                    gang_code: "",
                    source: "hr_employee",
                    field: "nik",
                    db_ptrj_value: dbNik,
                    display_value: dispNik,
                    diff: null,
                    status: !dispNik ? "MISSING_IN_DISPLAY" : nikMatch ? "MATCH" : "MISMATCH"
                });
                this.incrementSummary(summary, !dispNik ? "MISSING_IN_DISPLAY" : nikMatch ? "MATCH" : "MISMATCH");
            }
        }
    }

    // ─── Manual Adjustments Source ──────────────────────────────────────────

    private async verifyManualAdjustmentSource(
        dbPtrj: Database,
        dbExtend: Database,
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        locCode: string,
        comparisons: VerificationComparisonItem[],
        summary: VerificationSummaryBySource,
        empCodes?: string[]
    ): Promise<void> {
        const empFilter = empCodes?.length
            ? `AND (UPPER(RTRIM(emp_code)) IN (${empCodes.map(() => "?").join(",")}) OR UPPER(RTRIM(nik)) IN (${empCodes.map(() => "?").join(",")}))`
            : "";

        const adjustmentRows = await dbExtend.query<any>(`
            SELECT emp_code, nik, adjustment_type, adjustment_name, amount, gang_code, remarks
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND adjustment_type IN ('PREMI', 'POTONGAN_KOTOR', 'POTONGAN_BERSIH', 'AUTO_BUFFER')
              ${empFilter}
        `, [periodMonth, periodYear, ...(empCodes || []), ...(empCodes || [])]);

        // Also get other incomes
        const otherIncomeRows = await dbExtend.query<any>(`
            SELECT emp_code, nik, income_name, amount
            FROM dbo.employee_other_incomes
            WHERE period_month = ? AND period_year = ?
              ${empFilter}
        `, [periodMonth, periodYear, ...(empCodes || []), ...(empCodes || [])]);

        // For each manual adjustment, check if DocDesc exists in PR_ADTRANS
        const autoBufferToDocDesc: Record<string, string[]> = {
            "TUNJANGAN JABATAN": ["%JABATAN%"],
            "MASA KERJA": ["%MASA%KERJA%"],
            "SPSI": ["%SPSI%"],
            "AUTO TUNJANGAN JABATAN": ["%JABATAN%"],
            "AUTO MASA KERJA": ["%MASA%KERJA%"],
            "AUTO SPSI": ["%SPSI%"]
        };

        for (const adj of adjustmentRows) {
            const empCode = normalizeUpper(adj.emp_code || adj.nik);
            const adjName = normalizeUpper(adj.adjustment_name);
            const adjType = normalizeUpper(adj.adjustment_type);
            const amount = toNumber(adj.amount);

            // For AUTO_BUFFER, check DocDesc
            if (adjType === "AUTO_BUFFER" && autoBufferToDocDesc[adjName]) {
                const patterns = autoBufferToDocDesc[adjName];
                const conditions = patterns.map(p => `UPPER(t.DocDesc) LIKE '${p}'`).join(" OR ");
                const matchQuery = `
                    SELECT SUM(ln.Amount) as total
                    FROM PR_ADTRANS t
                    JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                    WHERE RTRIM(t.EmpCode) = ? AND t.PhyMonth = ? AND t.PhyYear = ?
                      AND t.Status = 1
                      AND (${conditions})
                `;
                const matchRows = await dbPtrj.query<any>(matchQuery, [adj.emp_code, periodMonth, periodYear]);
                const dbPtrjAmount = toNumber(matchRows[0]?.total);

                if (dbPtrjAmount > 0 || amount > 0) {
                    const status = valuesMatch(amount, dbPtrjAmount) ? "MATCH" : "MISMATCH";
                    comparisons.push({
                        emp_code: empCode,
                        nik: String(adj.nik || "").trim(),
                        nama: "",
                        gang_code: String(adj.gang_code || "").trim(),
                        source: "manual_adjustments",
                        field: adjName,
                        db_ptrj_value: dbPtrjAmount,
                        display_value: amount,
                        diff: diffValue(dbPtrjAmount, amount),
                        status
                    });
                    this.incrementSummary(summary, status);
                }
            }
        }
    }

    // ─── Utility ───────────────────────────────────────────────────────────

    private incrementSummary(summary: VerificationSummaryBySource, status: VerificationStatus): void {
        switch (status) {
            case "MATCH": summary.match++; break;
            case "MISMATCH": summary.mismatch++; break;
            case "MISSING_IN_DISPLAY": summary.missing_in_display++; break;
            case "MISSING_IN_SOURCE": summary.missing_in_source++; break;
            case "NO_MATCH_IN_DB_PTRJ": summary.no_match_in_db_ptrj++; break;
        }
    }
}

export const payrollVerificationService = PayrollVerificationService.getInstance();
