import { readFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "../db/client";
import { Config } from "../config";
import { mapPTKPToTER } from "./payroll/formulas/PTKPMapper";

export type ExcelPtkpParsedRow = {
    update_status: string;
    match_key_type: "NIK" | "NAME" | string;
    match_key: string;
    nik?: string;
    name?: string;
    ptkp_status?: string;
    resolved_ptkp_status?: string;
    resolution_note?: string;
    kategori_ter?: string;
    ptkp_values?: string;
    source_count?: number;
    sources?: string;
};

export type PtkpEmployeeIdentity = {
    emp_code: string;
    nik: string;
    emp_name: string;
};

export type PtkpHistoryProfile = {
    id: number;
    emp_code: string;
    nik: string;
    emp_name: string;
    ptkp_status: string;
    kategori_ter?: string;
};

export type ExcelPtkpDryRunAction =
    | "READY_UPDATE"
    | "WOULD_INSERT"
    | "ALREADY_SAME"
    | "SKIP_CONFLICT"
    | "SKIP_INVALID_PTKP"
    | "SKIP_NAME_FALLBACK_DISABLED"
    | "SKIP_NIK_NOT_FOUND"
    | "SKIP_NAME_NOT_FOUND"
    | "SKIP_AMBIGUOUS_NIK"
    | "SKIP_AMBIGUOUS_NAME"
    | "SKIP_DUPLICATE_TARGET"
    | "SKIP_TARGET_NIK_MISMATCH"
    | "SKIP_TARGET_NAME_MISMATCH";

export type ExcelPtkpDryRunRow = {
    period_year: number;
    action: ExcelPtkpDryRunAction;
    can_execute: boolean;
    reason: string;
    warning: string;
    match_key_type: string;
    match_key: string;
    source_nik: string;
    source_name: string;
    source_ptkp_status: string;
    source_kategori_ter: string;
    ptkp_values: string;
    source_count: number;
    sources: string;
    emp_code: string;
    db_nik: string;
    db_emp_name: string;
    target_id: string;
    old_ptkp_status: string;
    old_kategori_ter: string;
    new_ptkp_status: string;
    new_kategori_ter: string;
};

export type ExcelPtkpDryRunSummary = {
    period_year: number;
    dry_run: true;
    total_rows: number;
    would_update: number;
    would_insert: number;
    already_same: number;
    skipped: number;
    no_write: number;
    executable: number;
    warnings: number;
    by_action: Record<string, number>;
    ptkp_distribution: Record<string, number>;
    ter_distribution: Record<string, number>;
};

export type ExcelPtkpDryRunResult = {
    success: boolean;
    data: {
        period_year: number;
        dry_run: true;
        parsed_file_path: string;
        total_employees: number;
        records_inserted: number;
        records_updated: number;
        records_skipped: number;
        summary: ExcelPtkpDryRunSummary;
        rows: ExcelPtkpDryRunRow[];
    };
    errors?: string[];
};

type BuildPlanInput = {
    year: number;
    parsedRows: ExcelPtkpParsedRow[];
    employeeMatches: Map<string, PtkpEmployeeIdentity[]>;
    historyProfiles: Map<string, PtkpHistoryProfile[]>;
    includeNameFallback?: boolean;
};

type ParsedExcelPayload = {
    rows?: ExcelPtkpParsedRow[];
};

const DEFAULT_PARSED_RELATIVE_PATH = path.join("outputs", "ptkp_update_simple_2026", "ptkp_update_ready_2026.json");
const VALID_PTKP = new Set(["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"]);

function clean(value: unknown): string {
    return String(value ?? "").trim();
}

function normalizeUpper(value: unknown): string {
    return clean(value).replace(/\s+/g, " ").toUpperCase();
}

function normalizeComparableName(value: unknown): string {
    return normalizeUpper(value).replace(/\([^)]*\)/g, " ").replace(/[^A-Z0-9]/g, "");
}

function normalizeNik(value: unknown): string {
    const digits = clean(value).replace(/\D/g, "");
    return digits.length === 16 ? digits : "";
}

function normalizeEmpCode(value: unknown): string {
    return clean(value).toUpperCase();
}

function normalizePtkp(value: unknown): string {
    const ptkp = clean(value).toUpperCase().replace(/\s+/g, "");
    return VALID_PTKP.has(ptkp) ? ptkp : "";
}

export function mapExcelPtkpToTer(ptkpStatus: string): string {
    return mapPTKPToTER(normalizePtkp(ptkpStatus));
}

function resolutionKey(row: ExcelPtkpParsedRow): string {
    const keyType = normalizeUpper(row.match_key_type);
    if (keyType === "NAME") {
        const nameKey = normalizeUpper(row.match_key).startsWith("NAME::")
            ? normalizeUpper(row.match_key)
            : `NAME::${normalizeUpper(row.name || row.match_key)}`;
        return nameKey;
    }
    return `NIK::${normalizeNik(row.nik || row.match_key)}`;
}

function baseDryRunRow(year: number, row: ExcelPtkpParsedRow): ExcelPtkpDryRunRow {
    const newPtkp = normalizePtkp(row.resolved_ptkp_status || row.ptkp_status);
    return {
        period_year: year,
        action: "SKIP_INVALID_PTKP",
        can_execute: false,
        reason: "",
        warning: "",
        match_key_type: normalizeUpper(row.match_key_type),
        match_key: clean(row.match_key),
        source_nik: normalizeNik(row.nik || row.match_key),
        source_name: normalizeUpper(row.name),
        source_ptkp_status: newPtkp,
        source_kategori_ter: newPtkp ? mapExcelPtkpToTer(newPtkp) : "",
        ptkp_values: clean(row.ptkp_values || row.ptkp_status),
        source_count: Number(row.source_count || 0),
        sources: clean(row.sources),
        emp_code: "",
        db_nik: "",
        db_emp_name: "",
        target_id: "",
        old_ptkp_status: "",
        old_kategori_ter: "",
        new_ptkp_status: newPtkp,
        new_kategori_ter: newPtkp ? mapExcelPtkpToTer(newPtkp) : ""
    };
}

function withSkip(base: ExcelPtkpDryRunRow, action: ExcelPtkpDryRunAction, reason: string): ExcelPtkpDryRunRow {
    return { ...base, action, can_execute: false, reason };
}

function withEmployee(base: ExcelPtkpDryRunRow, employee: PtkpEmployeeIdentity): ExcelPtkpDryRunRow {
    return {
        ...base,
        emp_code: normalizeEmpCode(employee.emp_code),
        db_nik: normalizeNik(employee.nik),
        db_emp_name: normalizeUpper(employee.emp_name)
    };
}

function withProfile(base: ExcelPtkpDryRunRow, profile: PtkpHistoryProfile): ExcelPtkpDryRunRow {
    const oldPtkp = normalizePtkp(profile.ptkp_status);
    return {
        ...base,
        target_id: String(profile.id || ""),
        old_ptkp_status: oldPtkp,
        old_kategori_ter: clean(profile.kategori_ter || mapExcelPtkpToTer(oldPtkp))
    };
}

export function buildExcelPtkpDryRunPlan(input: BuildPlanInput): { summary: ExcelPtkpDryRunSummary; rows: ExcelPtkpDryRunRow[] } {
    const rows: ExcelPtkpDryRunRow[] = input.parsedRows.map((parsedRow) => {
        const base = baseDryRunRow(input.year, parsedRow);
        const parsedStatus = normalizeUpper(parsedRow.update_status);
        const keyType = normalizeUpper(parsedRow.match_key_type);

        if (parsedStatus === "CONFLICT") {
            if (!base.new_ptkp_status) {
                return withSkip(base, "SKIP_CONFLICT", "Parsed Excel row has conflicting PTKP values.");
            }
            base.warning = clean(parsedRow.resolution_note) || "Parsed Excel conflict was manually resolved.";
        }

        if (!base.new_ptkp_status) {
            return withSkip(base, "SKIP_INVALID_PTKP", "Parsed Excel row has no valid PTKP status.");
        }

        if (keyType === "NAME" && !input.includeNameFallback) {
            return withSkip(base, "SKIP_NAME_FALLBACK_DISABLED", "Name fallback is disabled for this dry run.");
        }

        const matches = input.employeeMatches.get(resolutionKey(parsedRow)) ?? [];
        if (matches.length === 0) {
            return withSkip(
                base,
                keyType === "NAME" ? "SKIP_NAME_NOT_FOUND" : "SKIP_NIK_NOT_FOUND",
                keyType === "NAME" ? "No unique HR_EMPLOYEE row found for parsed name." : "No HR_EMPLOYEE row found for parsed NIK."
            );
        }
        if (matches.length > 1) {
            return withSkip(
                base,
                keyType === "NAME" ? "SKIP_AMBIGUOUS_NAME" : "SKIP_AMBIGUOUS_NIK",
                keyType === "NAME" ? "Parsed name resolves to multiple HR_EMPLOYEE rows." : "Parsed NIK resolves to multiple HR_EMPLOYEE rows."
            );
        }

        const withResolvedEmployee = withEmployee(base, matches[0]);
        const profiles = input.historyProfiles.get(withResolvedEmployee.emp_code) ?? [];
        if (profiles.length > 1) {
            return withSkip(withResolvedEmployee, "SKIP_DUPLICATE_TARGET", "Multiple history_ptkp_pajak rows exist for target emp_code and year.");
        }
        if (profiles.length === 0) {
            return {
                ...withResolvedEmployee,
                action: "WOULD_INSERT",
                can_execute: true,
                reason: "No history_ptkp_pajak row exists for target emp_code and year."
            };
        }

        const profile = profiles[0];
        const withTargetProfile = withProfile(withResolvedEmployee, profile);
        const targetNik = normalizeNik(profile.nik);
        const targetName = normalizeComparableName(profile.emp_name);
        const sourceName = normalizeComparableName(parsedRow.name);
        const warnings: string[] = [];

        if (keyType !== "NAME" && targetNik && targetNik !== withTargetProfile.source_nik) {
            warnings.push("Existing history_ptkp_pajak NIK differs from parsed NIK.");
        }
        if (targetName && sourceName && targetName !== sourceName) {
            warnings.push("Existing history_ptkp_pajak name differs from parsed name.");
        }
        const withTargetWarnings = warnings.length > 0
            ? { ...withTargetProfile, warning: warnings.join(" ") }
            : withTargetProfile;

        if (withTargetWarnings.old_ptkp_status === withTargetWarnings.new_ptkp_status) {
            return {
                ...withTargetWarnings,
                action: "ALREADY_SAME",
                can_execute: false,
                reason: "Existing PTKP already matches parsed Excel PTKP."
            };
        }

        return {
            ...withTargetWarnings,
            action: "READY_UPDATE",
            can_execute: true,
            reason: "Target employee and history profile resolved; PTKP would change."
        };
    });

    return {
        rows,
        summary: summarizeDryRun(input.year, rows)
    };
}

function summarizeDryRun(year: number, rows: ExcelPtkpDryRunRow[]): ExcelPtkpDryRunSummary {
    const byAction: Record<string, number> = {};
    const ptkpDistribution: Record<string, number> = {};
    const terDistribution: Record<string, number> = {};

    for (const row of rows) {
        byAction[row.action] = (byAction[row.action] || 0) + 1;
        if (row.source_ptkp_status) {
            ptkpDistribution[row.source_ptkp_status] = (ptkpDistribution[row.source_ptkp_status] || 0) + 1;
            terDistribution[row.source_kategori_ter] = (terDistribution[row.source_kategori_ter] || 0) + 1;
        }
    }

    return {
        period_year: year,
        dry_run: true,
        total_rows: rows.length,
        would_update: byAction.READY_UPDATE || 0,
        would_insert: byAction.WOULD_INSERT || 0,
        already_same: byAction.ALREADY_SAME || 0,
        skipped: rows.filter(row => !row.can_execute && row.action !== "ALREADY_SAME").length,
        no_write: rows.filter(row => !row.can_execute).length,
        executable: rows.filter(row => row.can_execute).length,
        warnings: rows.filter(row => row.warning).length,
        by_action: byAction,
        ptkp_distribution: ptkpDistribution,
        ter_distribution: terDistribution
    };
}

function defaultParsedFileCandidates(): string[] {
    return [
        path.resolve(process.cwd(), DEFAULT_PARSED_RELATIVE_PATH),
        path.resolve(process.cwd(), "..", DEFAULT_PARSED_RELATIVE_PATH)
    ];
}

async function readParsedRows(parsedFilePath?: string): Promise<{ rows: ExcelPtkpParsedRow[]; filePath: string }> {
    const candidates = parsedFilePath
        ? [path.resolve(process.cwd(), parsedFilePath)]
        : defaultParsedFileCandidates();
    const errors: string[] = [];

    for (const candidate of candidates) {
        try {
            const payload = JSON.parse(await readFile(candidate, "utf-8")) as ParsedExcelPayload;
            return { rows: payload.rows ?? [], filePath: candidate };
        } catch (error: any) {
            errors.push(`${candidate}: ${error.message}`);
        }
    }

    throw new Error(`Unable to read parsed PTKP Excel JSON. Tried: ${errors.join(" | ")}`);
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function resolveEmployeeMatches(rows: ExcelPtkpParsedRow[], includeNameFallback: boolean): Promise<Map<string, PtkpEmployeeIdentity[]>> {
    const originDb = Database.getInstance();
    const result = new Map<string, PtkpEmployeeIdentity[]>();
    const niks = Array.from(new Set(rows.map(row => normalizeNik(row.nik || row.match_key)).filter(Boolean)));
    const names = includeNameFallback
        ? Array.from(new Set(rows
            .filter(row => normalizeUpper(row.match_key_type) === "NAME")
            .map(row => normalizeUpper(row.name || row.match_key.replace(/^NAME::/i, "")))
            .filter(Boolean)))
        : [];

    for (const nikChunk of chunk(niks, 400)) {
        const placeholders = nikChunk.map(() => "?").join(",");
        const matches = await originDb.query<PtkpEmployeeIdentity>(`
            SELECT
                RTRIM(EmpCode) as emp_code,
                RTRIM(ISNULL(NewICNo, '')) as nik,
                RTRIM(EmpName) as emp_name
            FROM HR_EMPLOYEE
            WHERE RTRIM(ISNULL(NewICNo, '')) IN (${placeholders})
              AND Status = '1'
        `, nikChunk, 120);

        for (const match of matches) {
            const key = `NIK::${normalizeNik(match.nik)}`;
            const current = result.get(key) ?? [];
            current.push({
                emp_code: normalizeEmpCode(match.emp_code),
                nik: normalizeNik(match.nik),
                emp_name: normalizeUpper(match.emp_name)
            });
            result.set(key, current);
        }
    }

    for (const nameChunk of chunk(names, 200)) {
        const placeholders = nameChunk.map(() => "?").join(",");
        const matches = await originDb.query<PtkpEmployeeIdentity>(`
            SELECT
                RTRIM(EmpCode) as emp_code,
                RTRIM(ISNULL(NewICNo, '')) as nik,
                RTRIM(EmpName) as emp_name
            FROM HR_EMPLOYEE
            WHERE UPPER(RTRIM(EmpName)) IN (${placeholders})
              AND Status = '1'
        `, nameChunk, 120);

        for (const match of matches) {
            const key = `NAME::${normalizeUpper(match.emp_name)}`;
            const current = result.get(key) ?? [];
            current.push({
                emp_code: normalizeEmpCode(match.emp_code),
                nik: normalizeNik(match.nik),
                emp_name: normalizeUpper(match.emp_name)
            });
            result.set(key, current);
        }
    }

    return result;
}

async function fetchHistoryProfiles(year: number, employees: Map<string, PtkpEmployeeIdentity[]>): Promise<Map<string, PtkpHistoryProfile[]>> {
    const extendDb = Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    const empCodes = Array.from(new Set(Array.from(employees.values()).flat().map(row => normalizeEmpCode(row.emp_code)).filter(Boolean)));
    const result = new Map<string, PtkpHistoryProfile[]>();

    for (const empCodeChunk of chunk(empCodes, 400)) {
        const placeholders = empCodeChunk.map(() => "?").join(",");
        const profiles = await extendDb.query<PtkpHistoryProfile>(`
            SELECT
                id,
                RTRIM(emp_code) as emp_code,
                RTRIM(ISNULL(nik, '')) as nik,
                RTRIM(ISNULL(emp_name, '')) as emp_name,
                RTRIM(ptkp_status) as ptkp_status,
                RTRIM(ISNULL(kategori_ter, '')) as kategori_ter
            FROM dbo.history_ptkp_pajak
            WHERE period_year = ?
              AND RTRIM(emp_code) IN (${placeholders})
            ORDER BY emp_code, id
        `, [year, ...empCodeChunk], 120);

        for (const profile of profiles) {
            const key = normalizeEmpCode(profile.emp_code);
            const current = result.get(key) ?? [];
            current.push({
                id: profile.id,
                emp_code: key,
                nik: normalizeNik(profile.nik),
                emp_name: normalizeUpper(profile.emp_name),
                ptkp_status: normalizePtkp(profile.ptkp_status),
                kategori_ter: clean(profile.kategori_ter)
            });
            result.set(key, current);
        }
    }

    return result;
}

export class PtkpExcelDryRunService {
    public async previewFromParsedExcel(options: {
        year: number;
        parsedFilePath?: string;
        includeNameFallback?: boolean;
    }): Promise<ExcelPtkpDryRunResult> {
        const { rows: parsedRows, filePath } = await readParsedRows(options.parsedFilePath);
        const employeeMatches = await resolveEmployeeMatches(parsedRows, !!options.includeNameFallback);
        const historyProfiles = await fetchHistoryProfiles(options.year, employeeMatches);
        const plan = buildExcelPtkpDryRunPlan({
            year: options.year,
            parsedRows,
            employeeMatches,
            historyProfiles,
            includeNameFallback: !!options.includeNameFallback
        });

        return {
            success: true,
            data: {
                period_year: options.year,
                dry_run: true,
                parsed_file_path: filePath,
                total_employees: plan.summary.total_rows,
                records_inserted: plan.summary.would_insert,
                records_updated: plan.summary.would_update,
                records_skipped: plan.summary.no_write,
                summary: plan.summary,
                rows: plan.rows
            }
        };
    }
}

export const ptkpExcelDryRunService = new PtkpExcelDryRunService();
