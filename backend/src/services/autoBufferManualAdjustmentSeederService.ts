import { Database } from "../db/client";
import { Config } from "../config";
import { dataExtractorService } from "./dataExtractorService";
import { payrollAutoBufferService } from "./payroll/payrollAutoBufferService";
import {
    buildAutoBufferSeedRemark,
    normalizeAutoBufferAdjustmentName
} from "./payroll/manualAdjustments/autoBufferAdcodeMap";
import { normalizeManualAdjustmentDivisionCode } from "./payroll/manualAdjustments/manualAdjustmentNaming";
import { payrollProfileSeedService } from "./payrollProfileSeedService";
import { deriveInitialSpsiMember } from "../utils/payrollProfileRules";

const AUTO_BUFFER_ADJUSTMENT_TYPE = "AUTO_BUFFER";
const AUTO_BUFFER_MANUAL_REMARK_CONDITION = `
              (
                UPPER(ISNULL(remarks, '')) LIKE '%SYNC:MANUAL%'
                OR UPPER(ISNULL(remarks, '')) LIKE '%MATCH:MANUAL%'
              )
`;
const AUTO_BUFFER_SEED_OWNED_REMARK_CONDITION = `
              NOT ${AUTO_BUFFER_MANUAL_REMARK_CONDITION}
`;

const AUTO_BUFFER_ADJUSTMENT_NAME = {
    jabatan: "TUNJANGAN JABATAN",
    masaKerja: "MASA KERJA",
    spsi: "SPSI",
    potonganPph: "POTONGAN PPH"
} as const;

function toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeString(value: unknown): string {
    return String(value || "").trim();
}

function isNumericNik(value: unknown): boolean {
    return /^\d{10,}$/.test(normalizeString(value));
}

function buildAutoBufferConflictKey(identifier: unknown, adjustmentName: unknown): string {
    const normalizedIdentifier = normalizeString(identifier).toUpperCase();
    const normalizedName = normalizeAutoBufferAdjustmentName(adjustmentName);
    return normalizedIdentifier && normalizedName ? `${normalizedIdentifier}_${normalizedName}` : "";
}

function addAutoBufferConflictKeys(
    target: Set<string>,
    row: Pick<AutoBufferManualAdjustmentSeedEntry, "emp_code" | "nik" | "adjustment_name">
): void {
    for (const identifier of [row.emp_code, row.nik]) {
        const key = buildAutoBufferConflictKey(identifier, row.adjustment_name);
        if (key) target.add(key);
    }
}

function hasAutoBufferConflict(
    target: Set<string>,
    row: Pick<AutoBufferManualAdjustmentSeedEntry, "emp_code" | "nik" | "adjustment_name">
): boolean {
    return [row.emp_code, row.nik]
        .map((identifier) => buildAutoBufferConflictKey(identifier, row.adjustment_name))
        .filter(Boolean)
        .some((key) => target.has(key));
}

function serializeAutoBufferMetadata(input: {
    period_month: number;
    period_year: number;
    emp_code: string;
    nik: string | null;
    emp_name: string | null;
    gang_code: string;
    division_code: string;
    adjustment_type: string;
    adjustment_name: string;
    amount: number;
}): string {
    return JSON.stringify({
        input_type: "auto_buffer",
        period_month: input.period_month,
        period_year: input.period_year,
        emp_code: input.emp_code,
        nik: input.nik,
        emp_name: input.emp_name,
        gang_code: input.gang_code,
        division_code: input.division_code,
        adjustment_type: input.adjustment_type,
        adjustment_name: input.adjustment_name,
        amount: input.amount,
        total_amount: input.amount
    });
}

export interface AutoBufferManualAdjustmentSeedInput {
    period_month: number;
    period_year: number;
    division_code: string;
    gang_code?: string;
    use_history_db?: boolean;
    snapshot_version?: number | null;
    // Backward-compatible request field; seeder replaces only seed-owned AUTO_BUFFER rows.
    replace_existing?: boolean;
    value_priority_mode?: string | null;
    created_by?: string;
}

export interface AutoBufferManualAdjustmentSeedEntry {
    period_month: number;
    period_year: number;
    emp_code: string;
    nik: string | null;
    emp_name?: string | null;
    gang_code: string;
    division_code: string;
    adjustment_type: typeof AUTO_BUFFER_ADJUSTMENT_TYPE;
    adjustment_name: string;
    amount: number;
    remarks: string;
    metadata_json: string;
}

type ExtractedPayrollLike = {
    emp_code?: string;
    nik?: string;
    new_nik?: string;
    actual_nik?: string;
    emp_name?: string;
    nama?: string;
    gang_code?: string;
    jabatan?: string;
    jabatan_estate?: string;
    role?: string;
    hari_kerja?: number;
    jumlah_hk?: number;
    masa_kerja_tahun?: number;
    masa_kerja_display_years?: number;
    jabatan_jumlah?: number;
    masa_kerja_jumlah?: number;
    pot_spsi?: number;
    pot_pph21?: number;
    pph21_ter?: number;
    is_spsi_member?: boolean;
};

export function buildAutoBufferSeedEntries(
    rows: ExtractedPayrollLike[],
    periodMonth: number,
    periodYear: number,
    divisionCode: string
): AutoBufferManualAdjustmentSeedEntry[] {
    const normalizedDivision = normalizeManualAdjustmentDivisionCode(divisionCode) || normalizeString(divisionCode).toUpperCase();
    const entries: AutoBufferManualAdjustmentSeedEntry[] = [];

    for (const row of rows || []) {
        const rawEmpCode = normalizeString(row.emp_code).toUpperCase();
        const nik = (
            normalizeString(row.nik || row.new_nik || row.actual_nik).toUpperCase()
            || (isNumericNik(rawEmpCode) ? rawEmpCode : "")
        ) || null;
        const empCode = rawEmpCode && !isNumericNik(rawEmpCode) ? rawEmpCode : "";
        if (!empCode) continue;

        const empName = normalizeString(row.emp_name || row.nama).toUpperCase() || null;
        const gangCode = normalizeString(row.gang_code).toUpperCase() || "UNKNOWN";
        const hariKerja = Math.max(0, toNumber(row.hari_kerja));
        const masaKerjaTahun = Math.max(
            0,
            Math.floor(toNumber(row.masa_kerja_tahun ?? row.masa_kerja_display_years))
        );

        const dbPotSpsi = Math.abs(toNumber(row.pot_spsi));
        const pph21TerAmount = Math.abs(toNumber(row.pph21_ter));
        const dbPotPph21 = Math.abs(toNumber(row.pot_pph21));
        const dbJabatanJumlah = toNumber(row.jabatan_jumlah);
        const dbMasaKerjaJumlah = toNumber(row.masa_kerja_jumlah);
        const isSpsiMember = typeof row.is_spsi_member === "boolean"
            ? row.is_spsi_member
            : deriveInitialSpsiMember(dbPotSpsi);

        const auto = payrollAutoBufferService.calculateAutomaticValues({
            jabatanText: normalizeString(row.jabatan_estate || row.jabatan),
            roleText: normalizeString(row.jabatan || row.role),
            hariKerja,
            masaKerjaTahun,
            isSpsiMember,
            dbJabatanJumlah,
            dbMasaKerjaJumlah
        });

        const jabatanEntry = {
                period_month: periodMonth,
                period_year: periodYear,
                emp_code: empCode,
                nik,
                emp_name: empName,
                gang_code: gangCode,
                division_code: normalizedDivision,
                adjustment_type: AUTO_BUFFER_ADJUSTMENT_TYPE,
                adjustment_name: AUTO_BUFFER_ADJUSTMENT_NAME.jabatan,
                amount: auto.jabatanAmount,
                remarks: buildAutoBufferSeedRemark(
                    AUTO_BUFFER_ADJUSTMENT_NAME.jabatan,
                    auto.jabatanAmount,
                    dbJabatanJumlah
                )
        };
        const masaKerjaEntry = {
                period_month: periodMonth,
                period_year: periodYear,
                emp_code: empCode,
                nik,
                emp_name: empName,
                gang_code: gangCode,
                division_code: normalizedDivision,
                adjustment_type: AUTO_BUFFER_ADJUSTMENT_TYPE,
                adjustment_name: AUTO_BUFFER_ADJUSTMENT_NAME.masaKerja,
                amount: auto.masaKerjaAmount,
                remarks: buildAutoBufferSeedRemark(
                    AUTO_BUFFER_ADJUSTMENT_NAME.masaKerja,
                    auto.masaKerjaAmount,
                    dbMasaKerjaJumlah
                )
        };
        const spsiEntry = {
                period_month: periodMonth,
                period_year: periodYear,
                emp_code: empCode,
                nik,
                emp_name: empName,
                gang_code: gangCode,
                division_code: normalizedDivision,
                adjustment_type: AUTO_BUFFER_ADJUSTMENT_TYPE,
                adjustment_name: AUTO_BUFFER_ADJUSTMENT_NAME.spsi,
                amount: auto.spsiDeduction,
                remarks: buildAutoBufferSeedRemark(
                    AUTO_BUFFER_ADJUSTMENT_NAME.spsi,
                    auto.spsiDeduction,
                    dbPotSpsi
                )
        };
        const potonganPphEntry = {
                period_month: periodMonth,
                period_year: periodYear,
                emp_code: empCode,
                nik,
                emp_name: empName,
                gang_code: gangCode,
                division_code: normalizedDivision,
                adjustment_type: AUTO_BUFFER_ADJUSTMENT_TYPE,
                adjustment_name: AUTO_BUFFER_ADJUSTMENT_NAME.potonganPph,
                amount: pph21TerAmount,
                remarks: buildAutoBufferSeedRemark(
                    AUTO_BUFFER_ADJUSTMENT_NAME.potonganPph,
                    pph21TerAmount,
                    dbPotPph21
                )
        };

        entries.push(...[jabatanEntry, masaKerjaEntry, spsiEntry, potonganPphEntry].map((entry) => ({
            ...entry,
            metadata_json: serializeAutoBufferMetadata(entry)
        })));
    }

    return entries;
}

export class AutoBufferManualAdjustmentSeederService {
    private static instance: AutoBufferManualAdjustmentSeederService;

    public static getInstance(): AutoBufferManualAdjustmentSeederService {
        if (!AutoBufferManualAdjustmentSeederService.instance) {
            AutoBufferManualAdjustmentSeederService.instance = new AutoBufferManualAdjustmentSeederService();
        }
        return AutoBufferManualAdjustmentSeederService.instance;
    }

    private getDatabase(): Database {
        return Database.getExtendedInstance();
    }

    private async applyProfileSpsiOverrides(rows: ExtractedPayrollLike[], db: Pick<Database, "query">) {
        const keys = [...new Set((rows || []).flatMap((row) => [row.emp_code, row.nik, row.new_nik, row.actual_nik].map(normalizeString).filter(Boolean)))];
        if (!keys.length) return;

        const overrideRows: any[] = [];
        const CHUNK = 500;
        for (let i = 0; i < keys.length; i += CHUNK) {
            const chunk = keys.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => "?").join(",");
            overrideRows.push(...await db.query<any>(`
                SELECT emp_code, nik, is_spsi_member, effective_start_date, update_index
                FROM dbo.employee_profile_override_history
                WHERE (emp_code IN (${placeholders}) OR nik IN (${placeholders}))
                  AND is_active_record = 1
                  AND is_spsi_member IS NOT NULL
            `, [...chunk, ...chunk]));
        }

        const latestByKey = payrollProfileSeedService.pickLatestProfileOverrides(overrideRows);
        for (const row of overrideRows) {
            const latest = latestByKey.get(row.emp_code);
            if (!latest) continue;
            const nik = normalizeString(row.nik).toUpperCase();
            if (nik && !latestByKey.has(nik)) {
                latestByKey.set(nik, latest);
            }
        }

        for (const row of rows || []) {
            const candidates = [row.emp_code, row.nik, row.new_nik, row.actual_nik].map(normalizeString).map((key) => key.toUpperCase()).filter(Boolean);
            const override = candidates.map((key) => latestByKey.get(key)).find(Boolean);
            if (override) {
                row.is_spsi_member = !!override.is_spsi_member;
            }
        }
    }

    public async seedPeriod(input: AutoBufferManualAdjustmentSeedInput) {
        const periodMonth = Math.floor(toNumber(input.period_month));
        const periodYear = Math.floor(toNumber(input.period_year));
        const divisionCode = normalizeManualAdjustmentDivisionCode(input.division_code) || normalizeString(input.division_code).toUpperCase();
        const gangCode = normalizeString(input.gang_code || "ALL").toUpperCase() || "ALL";
        const useHistoryDb = input.use_history_db === true;
        const snapshotVersion = input.snapshot_version == null ? null : Math.floor(toNumber(input.snapshot_version));
        const valuePriorityMode = normalizeString(input.value_priority_mode) || "non_db_ptrj";
        const createdBy = normalizeString(input.created_by) || "system";

        if (periodMonth < 1 || periodMonth > 12) {
            throw new Error("period_month harus 1-12");
        }
        if (periodYear < 2000) {
            throw new Error("period_year tidak valid");
        }
        if (!divisionCode) {
            throw new Error("division_code wajib diisi");
        }

        const extracted = await dataExtractorService.extractPayrollData(
            periodMonth,
            periodYear,
            gangCode,
            divisionCode,
            null,
            Config.DB_PROFILE,
            false,
            useHistoryDb,
            undefined,
            true,
            true,
            snapshotVersion,
            valuePriorityMode
        );

        const db = this.getDatabase();
        const extractedRows = extracted.data_rows as ExtractedPayrollLike[];
        await this.applyProfileSpsiOverrides(extractedRows, db);

        const entries = buildAutoBufferSeedEntries(
            extractedRows,
            periodMonth,
            periodYear,
            divisionCode
        );

        const scopeParams = gangCode !== "ALL"
            ? [periodMonth, periodYear, divisionCode, gangCode]
            : [periodMonth, periodYear, divisionCode];
        const gangFilterSql = gangCode !== "ALL" ? "AND gang_code = ?" : "";
        const preservedManualRows = await db.query<Pick<AutoBufferManualAdjustmentSeedEntry, "emp_code" | "nik" | "adjustment_name">>(`
            SELECT emp_code, nik, adjustment_name
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND division_code = ?
              AND adjustment_type = '${AUTO_BUFFER_ADJUSTMENT_TYPE}'
              ${gangFilterSql}
              AND ${AUTO_BUFFER_MANUAL_REMARK_CONDITION}
        `, scopeParams);
        const protectedManualKeys = new Set<string>();
        for (const row of preservedManualRows) {
            addAutoBufferConflictKeys(protectedManualKeys, row);
        }

        const countQuery = `
            SELECT COUNT(1) as count
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND division_code = ?
              AND adjustment_type = '${AUTO_BUFFER_ADJUSTMENT_TYPE}'
              ${gangFilterSql}
              AND ${AUTO_BUFFER_SEED_OWNED_REMARK_CONDITION}
        `;
        const countRow = await db.queryOne<{ count: number }>(countQuery, scopeParams);
        const deletedExisting = toNumber(countRow?.count);

        const deleteQuery = `
            DELETE FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND division_code = ?
              AND adjustment_type = '${AUTO_BUFFER_ADJUSTMENT_TYPE}'
              ${gangFilterSql}
              AND ${AUTO_BUFFER_SEED_OWNED_REMARK_CONDITION}
        `;
        await db.query(deleteQuery, scopeParams);

        let inserted = 0;
        let skippedManualConflicts = 0;
        const updated = 0;

        for (const entry of entries) {
            if (hasAutoBufferConflict(protectedManualKeys, entry)) {
                skippedManualConflicts += 1;
                continue;
            }

            await db.query(`
                INSERT INTO dbo.payroll_manual_adjustments (
                    period_month, period_year, emp_code, nik, emp_name, gang_code, division_code,
                    adjustment_type, adjustment_name, amount, remarks, metadata_json, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                entry.period_month,
                entry.period_year,
                entry.emp_code,
                entry.nik,
                entry.emp_name || null,
                entry.gang_code,
                entry.division_code,
                entry.adjustment_type,
                entry.adjustment_name,
                entry.amount,
                entry.remarks,
                entry.metadata_json,
                createdBy
            ]);
            inserted += 1;
        }

        const validation = await this.validatePeriod({
            period_month: periodMonth,
            period_year: periodYear,
            division_code: divisionCode,
            gang_code: gangCode,
            created_by: createdBy
        });

        return {
            period_month: periodMonth,
            period_year: periodYear,
            division_code: divisionCode,
            gang_code: gangCode,
            source_rows: extracted.data_rows.length,
            seeded_entries: entries.length,
            inserted,
            updated,
            deleted_existing: deletedExisting,
            preserved_manual: preservedManualRows.length,
            skipped_manual_conflicts: skippedManualConflicts,
            replace_existing: true,
            value_priority_mode_source: valuePriorityMode,
            validation
        };
    }

    public async validatePeriod(input: AutoBufferManualAdjustmentSeedInput) {
        const periodMonth = Math.floor(toNumber(input.period_month));
        const periodYear = Math.floor(toNumber(input.period_year));
        const divisionCode = normalizeManualAdjustmentDivisionCode(input.division_code) || normalizeString(input.division_code).toUpperCase();
        const gangCode = normalizeString(input.gang_code || "ALL").toUpperCase();
        const updatedBy = normalizeString(input.created_by) || "system";

        if (periodMonth < 1 || periodMonth > 12) throw new Error("period_month harus 1-12");
        if (periodYear < 2000) throw new Error("period_year tidak valid");
        if (!divisionCode) throw new Error("division_code wajib diisi");

        const extendDb = this.getDatabase();
        
        // 1. Fetch current AUTO_BUFFER records
        const fetchQuery = `
            SELECT id, emp_code, adjustment_name, amount, remarks
            FROM dbo.payroll_manual_adjustments
            WHERE period_month = ? AND period_year = ?
              AND division_code = ?
              AND adjustment_type = '${AUTO_BUFFER_ADJUSTMENT_TYPE}'
              ${gangCode !== "ALL" ? "AND gang_code = ?" : ""}
              AND ${AUTO_BUFFER_SEED_OWNED_REMARK_CONDITION}
        `;
        const fetchParams = gangCode !== "ALL"
            ? [periodMonth, periodYear, divisionCode, gangCode]
            : [periodMonth, periodYear, divisionCode];
            
        const existingRecords = await extendDb.query<any>(fetchQuery, fetchParams);
        
        if (existingRecords.length === 0) {
            return { processed: 0, updated: 0, matches: 0, misses: 0 };
        }

        // Prepare date range for db_ptrj query
        const startDate = `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`;
        const endDateObj = new Date(periodYear, periodMonth, 1);
        const endDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, "0")}-01`;

        // 2. Query true values from PR_ADTRANS and PR_ADTRANS_ARC in db_ptrj
        // We use inner join with HR_GANGLN just like dataExtractorService to limit to specific gangs/divisions
        const dbMain = Database.getInstance(); // Uses SERVER_PROFILE_2 natively or SERVER_PROFILE_1 in DEV
        
        // Build gang filter if needed
        let gangJoin = `INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(t.EmpCode)`;
        let gangCondition = ``;
        
        if (gangCode !== "ALL") {
            gangCondition = `AND RTRIM(gl.GangCode) = '${gangCode}'`;
        }

        const trueValuesQuery = `
            SELECT RTRIM(t.EmpCode) as emp_code,
                   MAX(RTRIM(ISNULL(e.NewICNo, ''))) as nik,
                   CASE
                       WHEN UPPER(ISNULL(ln.TaskCode, '')) LIKE '%DEPH21%'
                         OR UPPER(ISNULL(mt.TaskDesc, '')) LIKE '%POTONGAN PPH21%'
                         OR (
                            (UPPER(t.DocDesc) LIKE '%PPH%' OR UPPER(t.DocDesc) LIKE '%PAJAK%')
                            AND UPPER(t.DocDesc) NOT LIKE '%PREMI%'
                         ) THEN 'POTONGAN PPH'
                       WHEN UPPER(t.DocDesc) LIKE '%JABATAN%' THEN 'TUNJANGAN JABATAN'
                       WHEN UPPER(t.DocDesc) LIKE '%MASA%KERJA%' THEN 'MASA KERJA'
                       WHEN UPPER(t.DocDesc) LIKE '%SPSI%' THEN 'SPSI'
                   END as adjustment_name,
                   SUM(ln.Amount) as total
            FROM (
                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS t
                ${gangJoin}
                WHERE t.DocDate >= ? AND t.DocDate < ? ${gangCondition}
                AND t.Status IN (1, 3)

                UNION ALL

                SELECT t.EmpCode, t.ID, t.DocDesc, t.DocDate
                FROM PR_ADTRANS_ARC t
                ${gangJoin}
                WHERE t.DocDate >= ? AND t.DocDate < ? ${gangCondition}
                AND t.Status = 3
            ) t
            LEFT JOIN HR_EMPLOYEE e ON RTRIM(e.EmpCode) = RTRIM(t.EmpCode)
            JOIN (
                SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN
                UNION ALL
                SELECT MasterID, TaskCode, Amount FROM PR_ADTRANSLN_ARC
            ) ln ON t.ID = ln.MasterID
            LEFT JOIN PR_TASKCODE mt ON RTRIM(mt.TaskCode) = RTRIM(ln.TaskCode)
            WHERE UPPER(t.DocDesc) LIKE '%JABATAN%' 
               OR UPPER(t.DocDesc) LIKE '%MASA%KERJA%' 
               OR UPPER(t.DocDesc) LIKE '%SPSI%'
               OR UPPER(ISNULL(ln.TaskCode, '')) LIKE '%DEPH21%'
               OR UPPER(ISNULL(mt.TaskDesc, '')) LIKE '%POTONGAN PPH21%'
               OR (
                    (UPPER(t.DocDesc) LIKE '%PPH%' OR UPPER(t.DocDesc) LIKE '%PAJAK%')
                    AND UPPER(t.DocDesc) NOT LIKE '%PREMI%'
               )
            GROUP BY RTRIM(t.EmpCode),
                   CASE 
                       WHEN UPPER(ISNULL(ln.TaskCode, '')) LIKE '%DEPH21%'
                         OR UPPER(ISNULL(mt.TaskDesc, '')) LIKE '%POTONGAN PPH21%'
                         OR (
                            (UPPER(t.DocDesc) LIKE '%PPH%' OR UPPER(t.DocDesc) LIKE '%PAJAK%')
                            AND UPPER(t.DocDesc) NOT LIKE '%PREMI%'
                         ) THEN 'POTONGAN PPH'
                       WHEN UPPER(t.DocDesc) LIKE '%JABATAN%' THEN 'TUNJANGAN JABATAN'
                       WHEN UPPER(t.DocDesc) LIKE '%MASA%KERJA%' THEN 'MASA KERJA'
                       WHEN UPPER(t.DocDesc) LIKE '%SPSI%' THEN 'SPSI'
                   END
        `;
        
        const trueValues = await dbMain.query<any>(trueValuesQuery, [startDate, endDate, startDate, endDate]);
        
        // Map true values for quick lookup
        const trueValuesMap = new Map<string, number>();
        for (const row of trueValues) {
            const adjustmentName = normalizeAutoBufferAdjustmentName(row.adjustment_name);
            const keys = [row.emp_code, row.nik]
                .map((value) => normalizeString(value).toUpperCase())
                .filter(Boolean);
            for (const empKey of keys) {
                trueValuesMap.set(`${empKey}_${adjustmentName}`, toNumber(row.total));
            }
        }

        let updatedCount = 0;
        let matches = 0;
        let misses = 0;

        // 3. Compare and Update
        for (const record of existingRecords) {
            const adjustmentName = normalizeAutoBufferAdjustmentName(record.adjustment_name);
            const key = `${normalizeString(record.emp_code).toUpperCase()}_${adjustmentName}`;
            const dbAmount = trueValuesMap.get(key) || 0;
            const currentAmount = Math.abs(toNumber(record.amount)); // Comparing absolute values for safety since SPSI is a deduction
            const absoluteDbAmount = Math.abs(dbAmount);
            
            // Build the new remark containing the match status
            const newRemark = buildAutoBufferSeedRemark(adjustmentName, currentAmount, absoluteDbAmount);
            
            // Check if it's a match
            if (Math.abs(currentAmount - absoluteDbAmount) <= 0.01) {
                matches++;
            } else {
                misses++;
            }

            // Update if the remark has changed (e.g. status flipped from MISS to MATCH or amount changed)
            if (record.remarks !== newRemark) {
                await extendDb.query(`
                    UPDATE dbo.payroll_manual_adjustments
                    SET remarks = ?, updated_at = GETDATE(), updated_by = ?
                    WHERE id = ?
                `, [newRemark, updatedBy, record.id]);
                updatedCount++;
            }
        }

        return {
            processed: existingRecords.length,
            updated: updatedCount,
            matches: matches,
            misses: misses
        };
    }
}

export const autoBufferManualAdjustmentSeederService = AutoBufferManualAdjustmentSeederService.getInstance();
