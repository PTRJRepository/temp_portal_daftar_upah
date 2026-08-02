import fs from "fs";
import path from "path";
import { Database } from "../db/client";
import { resolvePotonganBersihHutangTaskCode } from "./payroll/manualAdjustments/potonganBersihTaskCode";

export interface TaskCodeOption {
    ad_code: string;
    task_code: string;
    task_desc: string;
    loc_code: string | null;
    task_type: number | null;
    task_grp: string | null;
    task_nature: string | null;
    is_deduction: number | null;
    adj_ad_code: string | null;
    doc_desc: string | null;
    base_task_code: string | null;
}

export interface AutomationAdjustmentOption {
    category: "premi" | "koreksi" | "potongan_upah_kotor" | "potongan_upah_bersih";
    adjustment_type: "PREMI" | "POTONGAN_KOTOR" | "POTONGAN_BERSIH";
    adjustment_name: string;
    ad_code: string;
    description: string;
    task_code: string;
    task_desc: string;
    base_task_code: string | null;
    loc_code: string | null;
}

const LOC_CODE_BY_DIVISION: Record<string, string> = {
    PG1A: "P1A",
    P1A: "P1A",
    PG1B: "P1B",
    P1B: "P1B",
    PG2A: "P2A",
    P2A: "P2A",
    PG2B: "P2B",
    P2B: "P2B",
    ARB1: "AB1",
    AB1: "AB1",
    ARB2: "AB2",
    AB2: "AB2",
    AREC: "ARC",
    ARC: "ARC",
    ARA: "ARA",
    DME: "DME",
    IJL: "IJL",
    PGE: "PGE"
};

function normalize(value: unknown): string {
    return String(value || "").trim();
}

const TASKCODE_CACHE_PATH = path.join(process.cwd(), "data", "taskcode_mapping_db_ptrj.json");

type CachedTaskCodeRow = {
    task_code?: string;
    base_task_code?: string;
    division_suffix?: string | null;
    task_desc?: string;
    task_group?: string | null;
    task_type?: number | null;
    task_nature?: number | null;
    is_deduction?: boolean | number | null;
    adj_ad_code?: string | null;
};

function resolveLocCode(divisionCode?: string): string | undefined {
    const normalized = normalize(divisionCode).toUpperCase();
    return LOC_CODE_BY_DIVISION[normalized] || normalized || undefined;
}

function mapCachedTaskCode(row: CachedTaskCodeRow): TaskCodeOption | null {
    const taskCode = normalize(row.task_code);
    const taskDesc = normalize(row.task_desc);
    if (!taskCode || !taskDesc) return null;
    if (!taskDesc.startsWith("(AL)") && !taskDesc.startsWith("(DE)")) return null;

    const adjAdCode = normalize(row.adj_ad_code);
    const adCode = adjAdCode || normalize(row.base_task_code) || taskCode;
    if (!adCode) return null;

    return {
        ad_code: adCode,
        task_code: taskCode,
        task_desc: taskDesc,
        loc_code: normalize(row.division_suffix) || null,
        task_type: row.task_type == null ? null : Number(row.task_type),
        task_grp: normalize(row.task_group) || null,
        task_nature: row.task_nature == null ? null : String(row.task_nature),
        is_deduction: row.is_deduction == null ? null : Number(row.is_deduction),
        adj_ad_code: adjAdCode || null,
        doc_desc: taskDesc,
        base_task_code: adCode
    };
}

function matchesSearch(option: TaskCodeOption, search: string): boolean {
    if (!search) return true;
    const needle = search.toUpperCase();
    return [
        option.ad_code,
        option.task_code,
        option.base_task_code,
        option.task_desc,
        option.doc_desc
    ].some((value) => normalize(value).toUpperCase().includes(needle));
}

function matchesLocCode(option: TaskCodeOption, locCode?: string): boolean {
    if (!locCode || locCode === "ALL") return true;
    return normalize(option.loc_code).toUpperCase() === locCode.toUpperCase();
}

function uniqueOptions(options: TaskCodeOption[]): TaskCodeOption[] {
    const seen = new Set<string>();
    const result: TaskCodeOption[] = [];

    for (const option of options) {
        const key = `${option.ad_code}|${option.task_desc}|${option.loc_code || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(option);
    }

    return result;
}

function cleanAdjustmentDescription(value: unknown): string {
    return normalize(value).replace(/^\((AL|DE)\)\s*/i, "").trim();
}

function classifyAutomationAdjustmentOption(option: TaskCodeOption): Pick<AutomationAdjustmentOption, "category" | "adjustment_type"> | null {
    const description = cleanAdjustmentDescription(option.task_desc).toUpperCase();
    if (!description) return null;
    if (description.includes("SPSI") || description.includes("PPH")) return null;

    if (description.includes("KOREKSI")) {
        return { category: "koreksi", adjustment_type: "POTONGAN_KOTOR" };
    }

    if (description.includes("POTONGAN") || description.startsWith("POT ") || description.startsWith("POT_")) {
        return { category: "potongan_upah_bersih", adjustment_type: "POTONGAN_BERSIH" };
    }

    return { category: "premi", adjustment_type: "PREMI" };
}

export function buildAutomationAdjustmentOptions(options: TaskCodeOption[]): AutomationAdjustmentOption[] {
    const result: AutomationAdjustmentOption[] = [];
    const seen = new Set<string>();

    for (const option of options) {
        const description = cleanAdjustmentDescription(option.task_desc);
        const classification = classifyAutomationAdjustmentOption(option);
        if (!description || !classification) continue;

        const mappedTaskCode = classification.adjustment_type === "POTONGAN_BERSIH"
            ? resolvePotonganBersihHutangTaskCode(option.loc_code)
            : {
                ad_code: option.ad_code,
                task_code: option.task_code,
                base_task_code: option.base_task_code,
                task_desc: option.task_desc
            };

        const key = `${classification.category}|${mappedTaskCode.ad_code}|${description}|${option.loc_code || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        result.push({
            ...classification,
            adjustment_name: description,
            ad_code: mappedTaskCode.ad_code,
            description,
            task_code: mappedTaskCode.task_code,
            task_desc: mappedTaskCode.task_desc,
            base_task_code: mappedTaskCode.base_task_code,
            loc_code: option.loc_code
        });
    }

    return result;
}

export class TaskCodeOptionService {
    private static instance: TaskCodeOptionService;
    private db = Database.getInstance();
    private cachedOptions: TaskCodeOption[] | null = null;

    private constructor() { }

    public static getInstance(): TaskCodeOptionService {
        if (!TaskCodeOptionService.instance) {
            TaskCodeOptionService.instance = new TaskCodeOptionService();
        }
        return TaskCodeOptionService.instance;
    }

    private loadCachedOptions(): TaskCodeOption[] {
        if (this.cachedOptions) return this.cachedOptions;
        if (!fs.existsSync(TASKCODE_CACHE_PATH)) return [];

        const parsed = JSON.parse(fs.readFileSync(TASKCODE_CACHE_PATH, "utf-8"));
        const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
        this.cachedOptions = uniqueOptions(
            tasks
                .map((row: CachedTaskCodeRow) => mapCachedTaskCode(row))
                .filter((row: TaskCodeOption | null): row is TaskCodeOption => Boolean(row))
                .sort((a: TaskCodeOption, b: TaskCodeOption) => a.task_desc.localeCompare(b.task_desc) || a.ad_code.localeCompare(b.ad_code))
        );

        return this.cachedOptions;
    }

    private async fetchOptionsFromDatabase(): Promise<TaskCodeOption[]> {
        const rows = await this.db.query<any>(`
            SELECT
                RTRIM(ISNULL(NULLIF(T.AdjADCode, ''), T.TaskCode)) AS ad_code,
                RTRIM(T.TaskCode) AS task_code,
                RTRIM(ISNULL(T.TaskDesc, '')) AS task_desc,
                RTRIM(ISNULL(T.LocCode, '')) AS loc_code,
                T.TaskType AS task_type,
                RTRIM(ISNULL(T.TaskGrp, '')) AS task_grp,
                RTRIM(ISNULL(T.TaskNature, '')) AS task_nature,
                CAST(T.ISDEDUCTION AS INT) AS is_deduction,
                RTRIM(ISNULL(T.AdjADCode, '')) AS adj_ad_code
            FROM PR_TASKCODE T
            WHERE T.TaskCode IS NOT NULL
              AND RTRIM(T.TaskCode) <> ''
              AND T.TaskDesc IS NOT NULL
              AND (T.TaskDesc LIKE '(AL)%' OR T.TaskDesc LIKE '(DE)%')
            ORDER BY RTRIM(ISNULL(T.TaskDesc, '')), RTRIM(T.TaskCode)
        `, []);

        return uniqueOptions(rows
            .map((row) => {
                const adCode = normalize(row.ad_code);
                const taskDesc = normalize(row.task_desc);
                if (!adCode || !taskDesc) return null;

                return {
                    ad_code: adCode,
                    task_code: normalize(row.task_code),
                    task_desc: taskDesc,
                    loc_code: normalize(row.loc_code) || null,
                    task_type: row.task_type == null ? null : Number(row.task_type),
                    task_grp: normalize(row.task_grp) || null,
                    task_nature: normalize(row.task_nature) || null,
                    is_deduction: row.is_deduction == null ? null : Number(row.is_deduction),
                    adj_ad_code: normalize(row.adj_ad_code) || null,
                    doc_desc: taskDesc,
                    base_task_code: adCode
                };
            })
            .filter((row): row is TaskCodeOption => Boolean(row)));
    }

    public async searchOptions(input: {
        search?: string;
        divisionCode?: string;
        limit?: number;
    }): Promise<TaskCodeOption[]> {
        const limit = Math.max(1, Math.min(100, Math.floor(input.limit || 50)));
        const locCode = resolveLocCode(input.divisionCode);
        const search = normalize(input.search);
        let options = this.loadCachedOptions();

        if (options.length === 0) {
            options = await this.fetchOptionsFromDatabase();
            this.cachedOptions = options;
        }

        const searchedOptions = options.filter((option) => matchesSearch(option, search));
        const divisionOptions = searchedOptions.filter((option) => matchesLocCode(option, locCode));
        const resultOptions = divisionOptions.length > 0 ? divisionOptions : searchedOptions;

        return resultOptions.slice(0, limit);
    }

    public async searchAutomationAdjustmentOptions(input: {
        search?: string;
        divisionCode?: string;
        limit?: number;
        categories?: string[];
    }): Promise<AutomationAdjustmentOption[]> {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit || 100)));
        const options = await this.searchOptions({
            search: input.search,
            divisionCode: input.divisionCode,
            limit: 200
        });
        const categorySet = new Set((input.categories || []).map((category) => normalize(category).toLowerCase()).filter(Boolean));
        const automationOptions = buildAutomationAdjustmentOptions(options);
        const filteredOptions = categorySet.size > 0
            ? automationOptions.filter((option) => categorySet.has(option.category))
            : automationOptions;

        return filteredOptions.slice(0, limit);
    }
}

export const taskCodeOptionService = TaskCodeOptionService.getInstance();
