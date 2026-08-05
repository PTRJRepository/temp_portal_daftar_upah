import { Database } from "../db/client";
import { Config } from "../config";
import {
    buildAdtransDocDescSqlCondition,
    buildAdtransDocDescSqlPatterns,
    matchesAdtransDocDescFilter,
    normalizeAdtransFilter
} from "./payroll/adtransDocDescMapping";
import { divisionConfigService } from "./config/DivisionConfigService";
import { employeeIdentityResolverService } from "./employeeIdentityResolverService";
import {
    normalizeManualAdjustmentDivisionCode,
    normalizeStoredAdjustmentName
} from "./payroll/manualAdjustments/manualAdjustmentNaming";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GranularVerificationStatus =
    | "MATCH"
    | "MISMATCH"
    | "MISSING"
    | "EXTRA_IN_ADJUSTMENTS"
    | "NO_MATCH_IN_DB_PTRJ";

export interface GranularAdtransComparisonItem {
    emp_code: string;
    nik: string | null;
    nama: string | null;
    adjustment_type: string;
    adjustment_name: string;
    doc_desc: string | null;
    stored_amount: number | null;
    db_ptrj_amount: number | null;
    diff: number | null;
    status: GranularVerificationStatus;
    doc_desc_details: { doc_desc: string; doc_id: string | null; amount: number }[];
    extend_db_ptrj_remarks: string | null;
    gang_code: string | null;
}

export interface GranularVerificationResult {
    division: string;
    period_month: number;
    period_year: number;
    summary: {
        total_doc_descs: number;
        total_adjustments: number;
        match_count: number;
        mismatch_count: number;
        missing_count: number;
        extra_in_adjustments: number;
        no_match_in_db_ptrj: number;
    };
    comparisons: GranularAdtransComparisonItem[];
}

export interface AdjustmentNameConsistencyItem {
    adjustment_name: string;
    adjustment_type: string;
    matched_doc_desc: string | null;
    mapping_status: "MAPPED" | "UNMAPPED";
    employee_count: number;
    amount_consistency: { match_count: number; mismatch_count: number } | null;
    note?: string;
}

export interface UnmappedDocDescItem {
    doc_desc: string;
    occurrence_count: number;
    total_amount: number;
    suggested_adjustment_type: string;
    note: string;
}

export interface ConsistencyCheckResult {
    division: string;
    period_month: number;
    period_year: number;
    check_scope: string;
    summary: {
        total_unique_adjustment_names: number;
        matched_to_doc_desc: number;
        unmatched_adjustment_names: number;
        unmatched_doc_descs: number;
        auto_buffer_consistency: { total: number; consistent: number; inconsistent: number };
        manual_consistency: { total: number; consistent: number; inconsistent: number };
    };
    adjustment_name_mapping: AdjustmentNameConsistencyItem[];
    unmapped_doc_descs: UnmappedDocDescItem[];
}

export type VerifyMode = "warn" | "strict" | "skip";

export interface AdjustmentVerificationResult {
    status: "MATCH" | "MISMATCH" | "NO_MATCH_IN_DB_PTRJ";
    adjustment_name: string;
    matched_doc_desc: string | null;
    input_amount: number;
    db_ptrj_amount: number | null;
    diff: number | null;
    warning?: string;
    message?: string;
}

export interface SaveVerifiedResult {
    id: number;
    action: "INSERT" | "UPDATE" | "DELETE";
    verification: AdjustmentVerificationResult | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUpper(value: unknown): string {
    return String(value || "").trim().toUpperCase();
}

function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
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

const AUTO_BUFFER_TO_DOC_DESC: Record<string, string[]> = {
    "TUNJANGAN JABATAN": ["%JABATAN%"],
    "MASA KERJA": ["%MASA%KERJA%"],
    "SPSI": ["%SPSI%"],
    "AUTO TUNJANGAN JABATAN": ["%JABATAN%"],
    "AUTO MASA KERJA": ["%MASA%KERJA%"],
    "AUTO SPSI": ["%SPSI%"]
};

const DOC_DESC_TO_AUTO_BUFFER: Record<string, string> = {
    "spsi": "SPSI",
    "masa kerja": "MASA KERJA",
    "jabatan": "TUNJANGAN JABATAN"
};

function resolveExpectedDocDescPatterns(adjustmentName: string, adjustmentType: string): string[] {
    const upper = normalizeUpper(adjustmentName);

    if (AUTO_BUFFER_TO_DOC_DESC[upper]) return AUTO_BUFFER_TO_DOC_DESC[upper];

    if (adjustmentType === "PREMI") {
        const stripped = upper.replace(/^PREMI\s*/i, "").replace(/^TUNJANGAN\s*PREMI\s*/i, "").replace(/^TUNJANGAN\s*/i, "");
        return stripped ? [`%${stripped}%`] : ["%PREMI%"];
    }

    if (adjustmentType === "POTONGAN_KOTOR") {
        if (upper.includes("KOREKSI")) return ["%KOREKSI%"];
        return [`%${upper}%`];
    }

    if (adjustmentType === "POTONGAN_BERSIH") {
        return [`%${upper}%`];
    }

    return [`%${upper}%`];
}

function adjustmentNameMatchesDocDesc(adjustmentName: string, adjustmentType: string, docDesc: string): boolean {
    const normAdjName = normalizeUpper(adjustmentName);
    const normDocDesc = normalizeUpper(docDesc);

    if (normAdjName === normDocDesc) return true;

    // AUTO_BUFFER reverse mapping
    if (adjustmentType === "AUTO_BUFFER") {
        const patterns = resolveExpectedDocDescPatterns(adjustmentName, adjustmentType);
        return patterns.some(p => {
            const likePattern = p.replace(/%/g, "");
            return normDocDesc.includes(likePattern);
        });
    }

    // Premi: strip common prefixes and compare
    if (adjustmentType === "PREMI") {
        const strippedAdjName = normAdjName.replace(/^PREMI\s*/i, "").replace(/^TUNJANGAN\s*PREMI\s*/i, "").replace(/^TUNJANGAN\s*/i, "");
        const strippedDocDesc = normDocDesc.replace(/^PREMI\s*/i, "").replace(/^TUNJANGAN\s*PREMI\s*/i, "").replace(/^TUNJANGAN\s*/i, "");
        if (strippedAdjName && strippedDocDesc) {
            return strippedAdjName === strippedDocDesc || strippedDocDesc.includes(strippedAdjName) || strippedAdjName.includes(strippedDocDesc);
        }
    }

    // Koreksi: both contain KOREKSI
    if (adjustmentType === "POTONGAN_KOTOR" && normAdjName.includes("KOREKSI") && normDocDesc.includes("KOREKSI")) {
        return true;
    }

    // Generic: contains match
    return normDocDesc.includes(normAdjName) || normAdjName.includes(normDocDesc);
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class ManualAdjustmentVerificationService {
    private static instance: ManualAdjustmentVerificationService;

    private constructor() {}

    public static getInstance(): ManualAdjustmentVerificationService {
        if (!ManualAdjustmentVerificationService.instance) {
            ManualAdjustmentVerificationService.instance = new ManualAdjustmentVerificationService();
        }
        return ManualAdjustmentVerificationService.instance;
    }

    private getDbPtrj(): Database {
        return Database.getInstance();
    }

    private getDbExtend(): Database {
        return Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    // ─── Granular per-DocDesc Verification ─────────────────────────────────

    public async verifyGranularAdtrans(
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        adjustmentTypes: string[] = ["PREMI", "POTONGAN_KOTOR", "AUTO_BUFFER"],
        empCodes?: string[],
        includeDocDescDetails: boolean = true
    ): Promise<GranularVerificationResult> {
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
        const empFilter = empCodes?.length
            ? `AND RTRIM(t.EmpCode) IN (${empCodes.map(() => "?").join(",")})`
            : "";

        // 1. Get per-emp per-DocDesc from PR_ADTRANS
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
              AND t.Status IN (1, 3)
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

        const adtransParams = [
            locCode, periodMonth, periodYear, ...uniqueVirtualGangCodes, ...(empCodes || []),
            locCode, periodMonth, periodYear, ...uniqueVirtualGangCodes, ...(empCodes || [])
        ];

        const adtransRows = await dbPtrj.query<any>(adtransQuery, adtransParams);

        // 2. Get doc_desc details if requested
        let docDetailsByEmpAndDocDesc = new Map<string, { doc_desc: string; doc_id: string | null; amount: number }[]>();
        if (includeDocDescDetails) {
            const detailQuery = `
                SELECT
                    RTRIM(t.EmpCode) as emp_code,
                    RTRIM(t.DocID) as doc_id,
                    RTRIM(t.DocDesc) as doc_desc,
                    ln.Amount as amount
                FROM PR_ADTRANS t
                ${gangJoin}
                JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                WHERE UPPER(RTRIM(t.LocCode)) = ?
                  AND t.PhyMonth = ? AND t.PhyYear = ?
                  AND t.Status IN (1, 3)
                  ${gangWhere} ${empFilter}

                UNION ALL

                SELECT
                    RTRIM(t.EmpCode) as emp_code,
                    RTRIM(t.DocID) as doc_id,
                    RTRIM(t.DocDesc) as doc_desc,
                    ln.Amount as amount
                FROM PR_ADTRANS_ARC t
                ${gangJoin}
                JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                WHERE UPPER(RTRIM(t.LocCode)) = ?
                  AND t.PhyMonth = ? AND t.PhyYear = ?
                  AND t.Status = 3
                  ${gangWhere} ${empFilter}
            `;

            const detailRows = await dbPtrj.query<any>(detailQuery, adtransParams);
            for (const d of detailRows) {
                const key = `${normalizeUpper(d.emp_code)}|${normalizeUpper(d.doc_desc)}`;
                if (!docDetailsByEmpAndDocDesc.has(key)) docDetailsByEmpAndDocDesc.set(key, []);
                docDetailsByEmpAndDocDesc.get(key)!.push({
                    doc_desc: String(d.doc_desc || "").trim(),
                    doc_id: d.doc_id ? String(d.doc_id).trim() : null,
                    amount: toNumber(d.amount)
                });
            }
        }

        // 3. Get stored adjustments from extend_db_ptrj
        const adjustmentDivisionCodes = Array.from(new Set([divisionCode.trim().toUpperCase(), locCode].filter(Boolean)));
        const adjustmentRows = await dbExtend.query<any>(`
            SELECT emp_code, nik, adjustment_type, adjustment_name, amount, remarks, gang_code
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND UPPER(RTRIM(division_code)) IN (${adjustmentDivisionCodes.map(() => "?").join(",")})
              AND adjustment_type IN (${adjustmentTypes.map(() => "?").join(",")})
        `, [periodMonth, periodYear, ...adjustmentDivisionCodes, ...adjustmentTypes]);

        // 4. Build stored map
        const storedMap = new Map<string, Map<string, { amount: number; adjustment_type: string; remarks: string; gang_code: string }>>();
        for (const row of adjustmentRows) {
            const keys = [normalizeUpper(row.emp_code), normalizeUpper(row.nik)].filter(Boolean);
            const adjName = normalizeUpper(row.adjustment_name);
            const adjType = normalizeUpper(row.adjustment_type);
            for (const key of keys) {
                if (!storedMap.has(key)) storedMap.set(key, new Map());
                storedMap.get(key)!.set(adjName, {
                    amount: toNumber(row.amount),
                    adjustment_type: adjType,
                    remarks: String(row.remarks || ""),
                    gang_code: String(row.gang_code || "")
                });
            }
        }

        // 5. Compare: PR_ADTRANS → stored adjustments
        const comparisons: GranularAdtransComparisonItem[] = [];
        let matchCount = 0, mismatchCount = 0, missingCount = 0, extraInAdjCount = 0, noMatchCount = 0;
        const processedKeys = new Set<string>();

        for (const row of adtransRows) {
            const empCode = normalizeUpper(row.emp_code);
            const nik = String(row.nik || "").trim().toUpperCase();
            const nama = String(row.nama || "").trim();
            const docDesc = String(row.doc_desc || "").trim();
            const sourceAmount = toNumber(row.amount);

            if (Math.abs(sourceAmount) <= 0.01) continue;

            const empStored = storedMap.get(empCode) || (nik ? storedMap.get(nik) : undefined);

            // Find matching stored adjustment for this DocDesc
            let matchedAdjName: string | null = null;
            let matchedStored: { amount: number; adjustment_type: string; remarks: string; gang_code: string } | null = null;

            if (empStored) {
                for (const [adjName, adjData] of empStored) {
                    if (adjustmentNameMatchesDocDesc(adjName, adjData.adjustment_type, docDesc)) {
                        matchedAdjName = adjName;
                        matchedStored = adjData;
                        break;
                    }
                }
            }

            const storedAmount = matchedStored ? matchedStored.amount : null;
            const processKey = `${empCode}|${docDesc}|${matchedAdjName || "NONE"}`;
            if (processedKeys.has(processKey)) continue;
            processedKeys.add(processKey);

            const isMatch = storedAmount !== null && Math.abs(sourceAmount - storedAmount) <= 0.01;
            const isMissing = storedAmount === null;
            const status: GranularVerificationStatus = isMissing ? "MISSING" : isMatch ? "MATCH" : "MISMATCH";

            if (status === "MATCH") matchCount++;
            else if (status === "MISMATCH") mismatchCount++;
            else missingCount++;

            comparisons.push({
                emp_code: empCode,
                nik: nik && nik !== empCode ? nik : null,
                nama: nama || null,
                adjustment_type: matchedStored?.adjustment_type || "UNKNOWN",
                adjustment_name: matchedAdjName || docDesc,
                doc_desc: docDesc,
                stored_amount: storedAmount,
                db_ptrj_amount: sourceAmount,
                diff: storedAmount !== null ? sourceAmount - storedAmount : null,
                status,
                doc_desc_details: docDetailsByEmpAndDocDesc.get(`${empCode}|${normalizeUpper(docDesc)}`) || [],
                extend_db_ptrj_remarks: matchedStored?.remarks || null,
                gang_code: matchedStored?.gang_code || null
            });
        }

        // 6. Reverse check: stored adjustments not matched to any DocDesc
        for (const [empKey, adjMap] of storedMap) {
            for (const [adjName, adjData] of adjMap) {
                const hasMatch = adtransRows.some((r: any) => {
                    const rEmpCode = normalizeUpper(r.emp_code);
                    const rNik = String(r.nik || "").trim().toUpperCase();
                    if (rEmpCode !== empKey && rNik !== empKey) return false;
                    return adjustmentNameMatchesDocDesc(adjName, adjData.adjustment_type, String(r.doc_desc || ""));
                });

                if (!hasMatch && Math.abs(adjData.amount) > 0.01) {
                    const revKey = `${empKey}|REV|${adjName}`;
                    if (processedKeys.has(revKey)) continue;
                    processedKeys.add(revKey);

                    comparisons.push({
                        emp_code: empKey,
                        nik: null,
                        nama: null,
                        adjustment_type: adjData.adjustment_type,
                        adjustment_name: adjName,
                        doc_desc: null,
                        stored_amount: adjData.amount,
                        db_ptrj_amount: null,
                        diff: null,
                        status: "NO_MATCH_IN_DB_PTRJ",
                        doc_desc_details: [],
                        extend_db_ptrj_remarks: adjData.remarks || null,
                        gang_code: adjData.gang_code || null
                    });
                    noMatchCount++;
                }
            }
        }

        return {
            division: divisionCode,
            period_month: periodMonth,
            period_year: periodYear,
            summary: {
                total_doc_descs: adtransRows.length,
                total_adjustments: adjustmentRows.length,
                match_count: matchCount,
                mismatch_count: mismatchCount,
                missing_count: missingCount,
                extra_in_adjustments: extraInAdjCount,
                no_match_in_db_ptrj: noMatchCount
            },
            comparisons
        };
    }

    // ─── Consistency Check ─────────────────────────────────────────────────

    public async verifyAdjustmentNameConsistency(
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        checkScope: "all" | "auto_buffer" | "manual" = "all"
    ): Promise<ConsistencyCheckResult> {
        const dbPtrj = this.getDbPtrj();
        const dbExtend = this.getDbExtend();
        const locCode = resolveLocCode(divisionCode);
        const adjustmentDivisionCodes = Array.from(new Set([divisionCode.trim().toUpperCase(), locCode].filter(Boolean)));

        // 1. Get distinct adjustment_names from extend_db_ptrj
        const scopeFilter = checkScope === "auto_buffer"
            ? "AND adjustment_type = 'AUTO_BUFFER'"
            : checkScope === "manual"
                ? "AND adjustment_type IN ('PREMI', 'POTONGAN_KOTOR', 'POTONGAN_BERSIH')"
                : "";

        const adjustmentNames = await dbExtend.query<any>(`
            SELECT adjustment_name, adjustment_type, COUNT(*) as employee_count
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND UPPER(RTRIM(division_code)) IN (${adjustmentDivisionCodes.map(() => "?").join(",")})
              ${scopeFilter}
            GROUP BY adjustment_name, adjustment_type
            ORDER BY adjustment_type, adjustment_name
        `, [periodMonth, periodYear, ...adjustmentDivisionCodes]);

        // 2. Get distinct DocDescs from PR_ADTRANS
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

        const docDescRows = await dbPtrj.query<any>(`
            SELECT RTRIM(t.DocDesc) as doc_desc, COUNT(DISTINCT RTRIM(t.EmpCode)) as emp_count, SUM(ln.Amount) as total_amount
            FROM PR_ADTRANS t
            ${gangJoin}
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE UPPER(RTRIM(t.LocCode)) = ?
              AND t.PhyMonth = ? AND t.PhyYear = ?
              AND t.Status IN (1, 3)
              ${gangWhere}
            GROUP BY t.DocDesc

            UNION ALL

            SELECT RTRIM(t.DocDesc) as doc_desc, COUNT(DISTINCT RTRIM(t.EmpCode)) as emp_count, SUM(ln.Amount) as total_amount
            FROM PR_ADTRANS_ARC t
            ${gangJoin}
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE UPPER(RTRIM(t.LocCode)) = ?
              AND t.PhyMonth = ? AND t.PhyYear = ?
              AND t.Status = 3
              ${gangWhere}
            GROUP BY t.DocDesc
        `, [locCode, periodMonth, periodYear, ...uniqueVirtualGangCodes, locCode, periodMonth, periodYear, ...uniqueVirtualGangCodes]);

        // 3. Build mapping
        const adjustmentNameMapping: AdjustmentNameConsistencyItem[] = [];
        let matchedCount = 0, unmatchedAdjCount = 0;
        let autoBufferTotal = 0, autoBufferConsistent = 0, autoBufferInconsistent = 0;
        let manualTotal = 0, manualConsistent = 0, manualInconsistent = 0;

        for (const adj of adjustmentNames) {
            const adjName = normalizeUpper(adj.adjustment_name);
            const adjType = normalizeUpper(adj.adjustment_type);
            const empCount = toNumber(adj.employee_count);

            // Find matching DocDesc
            let matchedDocDesc: string | null = null;
            for (const dd of docDescRows) {
                const docDesc = String(dd.doc_desc || "").trim();
                if (adjustmentNameMatchesDocDesc(adjName, adjType, docDesc)) {
                    matchedDocDesc = docDesc;
                    break;
                }
            }

            const isMapped = matchedDocDesc !== null;
            if (isMapped) matchedCount++;
            else unmatchedAdjCount++;

            const isAutoBuffer = adjType === "AUTO_BUFFER";
            if (isAutoBuffer) {
                autoBufferTotal++;
                if (isMapped) autoBufferConsistent++;
                else autoBufferInconsistent++;
            } else {
                manualTotal++;
                if (isMapped) manualConsistent++;
                else manualInconsistent++;
            }

            adjustmentNameMapping.push({
                adjustment_name: adjName,
                adjustment_type: adjType,
                matched_doc_desc: matchedDocDesc,
                mapping_status: isMapped ? "MAPPED" : "UNMAPPED",
                employee_count: empCount,
                amount_consistency: null, // Could be enhanced with per-emp amount check
                note: !isMapped ? "No matching DocDesc in PR_ADTRANS. This may be a custom adjustment." : undefined
            });
        }

        // 4. Reverse check: unmapped DocDescs
        const mappedDocDescs = new Set(adjustmentNameMapping.filter(m => m.matched_doc_desc).map(m => normalizeUpper(m.matched_doc_desc!)));
        const unmappedDocDescs: UnmappedDocDescItem[] = [];

        for (const dd of docDescRows) {
            const docDesc = String(dd.doc_desc || "").trim();
            const normDocDesc = normalizeUpper(docDesc);
            if (mappedDocDescs.has(normDocDesc)) continue;

            // Check if any adjustment_name matches this DocDesc
            const hasMatch = adjustmentNames.some((adj: any) =>
                adjustmentNameMatchesDocDesc(normalizeUpper(adj.adjustment_name), normalizeUpper(adj.adjustment_type), docDesc)
            );
            if (hasMatch) continue;

            // Determine suggested type
            const upper = normDocDesc;
            let suggestedType = "PREMI";
            if (upper.includes("KOREKSI")) suggestedType = "POTONGAN_KOTOR";
            else if (upper.includes("POTONGAN") || upper.startsWith("POT")) suggestedType = "POTONGAN_BERSIH";
            else if (upper.includes("JABATAN") || upper.includes("MASA") || upper.includes("SPSI")) suggestedType = "AUTO_BUFFER";

            unmappedDocDescs.push({
                doc_desc: docDesc,
                occurrence_count: toNumber(dd.emp_count),
                total_amount: toNumber(dd.total_amount),
                suggested_adjustment_type: suggestedType,
                note: "Exists in PR_ADTRANS but no matching adjustment_name in payroll_manual_adjustments"
            });
        }

        return {
            division: divisionCode,
            period_month: periodMonth,
            period_year: periodYear,
            check_scope: checkScope,
            summary: {
                total_unique_adjustment_names: adjustmentNames.length,
                matched_to_doc_desc: matchedCount,
                unmatched_adjustment_names: unmatchedAdjCount,
                unmatched_doc_descs: unmappedDocDescs.length,
                auto_buffer_consistency: { total: autoBufferTotal, consistent: autoBufferConsistent, inconsistent: autoBufferInconsistent },
                manual_consistency: { total: manualTotal, consistent: manualConsistent, inconsistent: manualInconsistent }
            },
            adjustment_name_mapping: adjustmentNameMapping,
            unmapped_doc_descs: unmappedDocDescs
        };
    }

    // ─── Save Verified Adjustment ──────────────────────────────────────────

    public async saveVerifiedAdjustment(
        data: any,
        user?: string,
        verifyMode: VerifyMode = "warn"
    ): Promise<SaveVerifiedResult> {
        const { manualAdjustmentService } = await import("./manualAdjustmentService");

        if (verifyMode === "skip") {
            const id = await manualAdjustmentService.saveAdjustment(data, user);
            return { id, action: "INSERT", verification: null };
        }

        // Verify against db_ptrj
        const verification = await this.verifySingleAdjustment(data);

        if (verifyMode === "strict" && verification.status === "MISMATCH") {
            return {
                id: 0,
                action: "INSERT",
                verification: {
                    ...verification,
                    message: "Strict mode: amount mismatch. Save rejected."
                }
            };
        }

        // Save (warn mode: save regardless)
        const id = await manualAdjustmentService.saveAdjustment(data, user);

        return {
            id,
            action: id > 0 ? "INSERT" : "UPDATE",
            verification
        };
    }

    private async verifySingleAdjustment(data: any): Promise<AdjustmentVerificationResult> {
        const dbPtrj = this.getDbPtrj();
        const adjName = normalizeUpper(data.adjustment_name);
        const adjType = normalizeUpper(data.adjustment_type);
        const inputAmount = toNumber(data.amount);

        // Resolve employee identity
        const identity = await employeeIdentityResolverService.resolve(data.emp_code || data.nik);
        const empCode = identity?.emp_code || data.emp_code;
        if (!empCode) {
            return {
                status: "NO_MATCH_IN_DB_PTRJ",
                adjustment_name: adjName,
                matched_doc_desc: null,
                input_amount: inputAmount,
                db_ptrj_amount: null,
                diff: null,
                warning: `Cannot resolve employee identity for '${data.emp_code || data.nik}'. Verification skipped.`
            };
        }

        // Resolve DocDesc patterns
        const patterns = resolveExpectedDocDescPatterns(adjName, adjType);
        const locCode = resolveLocCode(data.division_code || "");

        // Query PR_ADTRANS for matching DocDesc
        const conditions = patterns.map(p => `UPPER(t.DocDesc) LIKE '${p.replace(/'/g, "''")}'`).join(" OR ");
        const matchQuery = `
            SELECT SUM(ln.Amount) as total
            FROM PR_ADTRANS t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) = ?
              AND t.PhyMonth = ? AND t.PhyYear = ?
              AND UPPER(RTRIM(t.LocCode)) = ?
              AND t.Status IN (1, 3)
              AND (${conditions})

            UNION ALL

            SELECT SUM(ln.Amount) as total
            FROM PR_ADTRANS_ARC t
            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
            WHERE RTRIM(t.EmpCode) = ?
              AND t.PhyMonth = ? AND t.PhyYear = ?
              AND UPPER(RTRIM(t.LocCode)) = ?
              AND t.Status = 3
              AND (${conditions})
        `;

        const matchRows = await dbPtrj.query<any>(matchQuery, [
            empCode, data.period_month, data.period_year, locCode,
            empCode, data.period_month, data.period_year, locCode
        ]);

        const dbPtrjAmount = toNumber(matchRows[0]?.total) + toNumber(matchRows[1]?.total);

        if (dbPtrjAmount === 0 && inputAmount !== 0) {
            return {
                status: "NO_MATCH_IN_DB_PTRJ",
                adjustment_name: adjName,
                matched_doc_desc: null,
                input_amount: inputAmount,
                db_ptrj_amount: null,
                diff: null,
                warning: `No matching DocDesc found in PR_ADTRANS for '${adjName}'. This is a new/unique adjustment.`
            };
        }

        const diff = inputAmount - dbPtrjAmount;
        const isMatch = Math.abs(diff) <= 0.01;

        return {
            status: isMatch ? "MATCH" : "MISMATCH",
            adjustment_name: adjName,
            matched_doc_desc: patterns[0]?.replace(/%/g, "") || adjName,
            input_amount: inputAmount,
            db_ptrj_amount: dbPtrjAmount,
            diff: isMatch ? 0 : diff,
            warning: isMatch ? undefined : `Input amount (${inputAmount}) does not match db_ptrj amount (${dbPtrjAmount}). Diff: ${diff}`
        };
    }
}

export const manualAdjustmentVerificationService = ManualAdjustmentVerificationService.getInstance();
