/**
 * Upah Bersih Detail Service
 * 
 * Service untuk mengambil data detail upah bersih per karyawan dari history tables.
 * Mendukung filter berdasarkan: lembur, premi, atau upah_bersih.
 * Data diambil dari extend_db_ptrj (payroll_history_header/detail)
 * dan extend_db_ptrj_transaksi (history_taskreg, history_adtrans).
 * 
 * Grouping: gang_code → employees → activity records
 */

import { Database } from "../db/client";
import { Config } from "../config";
import { gangService } from "./gangService";

export type FilterMode = 'all' | 'lembur' | 'premi' | 'upah_bersih';

export interface ActivityRecord {
    date: string;
    task_code: string;
    task_desc: string;
    hours: number;
    amount: number;
    category: string;
    doc_desc?: string;
    doc_no?: string;
    is_overtime: boolean;
}

export interface EmployeeDetail {
    emp_code: string;
    emp_name: string;
    gang_code: string;
    division_code: string;
    task_code: string;
    task_desc: string;
    hari_kerja: number;
    jumlah_hk: number;
    gaji_pokok: number;
    lembur_jam: number;
    lembur_jumlah: number;
    total_premi: number;
    premi_brondol: number;
    total_tunjangan: number;
    total_potongan: number;
    upah_kotor: number;
    upah_bersih: number;
    pph21: number;
    activities: ActivityRecord[];
}

export interface GangGroup {
    gang_code: string;
    gang_description: string;
    division_code: string;
    employee_count: number;
    total_lembur: number;
    total_premi: number;
    total_upah_bersih: number;
    employees: EmployeeDetail[];
}

export interface UpahBersihDetailResult {
    success: boolean;
    period_month: number;
    period_year: number;
    filter: FilterMode;
    summary: {
        total_employees: number;
        total_gangs: number;
        grand_total_lembur: number;
        grand_total_premi: number;
        grand_total_upah_bersih: number;
        grand_total_upah_kotor: number;
        grand_total_potongan: number;
    };
    gangs: GangGroup[];
    execution_time_ms: number;
}

class UpahBersihDetailService {
    private static instance: UpahBersihDetailService;

    private constructor() { }

    public static getInstance(): UpahBersihDetailService {
        if (!UpahBersihDetailService.instance) {
            UpahBersihDetailService.instance = new UpahBersihDetailService();
        }
        return UpahBersihDetailService.instance;
    }

    /**
     * Main entry point: fetch upah bersih detail with optional filter
     */
    public async getDetail(
        periodMonth: number,
        periodYear: number,
        filterMode: FilterMode = 'all',
        divisionCode?: string,
        gangCode?: string
    ): Promise<UpahBersihDetailResult> {
        const startTime = Date.now();
        // extend_db_ptrj for payroll history
        const payrollDb = Database.getExtendedInstance();
        // extend_db_ptrj_transaksi for taskreg/adtrans
        const transDb = Database.getInstance(Config.DB_EXTEND_TRANS_DATABASE, Config.DB_EXTEND_PROFILE);

        // 1. Get master headers for this period
        let headerSql = `
            SELECT id, history_id, gang_code, gang_description, division_code
            FROM dbo.payroll_history_header
            WHERE period_month = ? AND period_year = ?
        `;
        const headerParams: any[] = [periodMonth, periodYear];

        if (divisionCode && divisionCode !== 'ALL') {
            // Use unified division mapping
            const aliases = gangService.getAllDivisionAliases(divisionCode);
            if (aliases.length > 0) {
                const placeholders = aliases.map(() => '?').join(',');
                headerSql += ` AND division_code IN (${placeholders})`;
                headerParams.push(...aliases);
            }
        }
        if (gangCode && gangCode !== 'ALL') {
            headerSql += ` AND gang_code = ?`;
            headerParams.push(gangCode);
        }

        headerSql += ` ORDER BY division_code, gang_code`;

        const headers = await payrollDb.query<{
            id: number;
            history_id: string;
            gang_code: string;
            gang_description: string;
            division_code: string;
        }>(headerSql, headerParams);

        if (headers.length === 0) {
            return {
                success: true,
                period_month: periodMonth,
                period_year: periodYear,
                filter: filterMode,
                summary: {
                    total_employees: 0,
                    total_gangs: 0,
                    grand_total_lembur: 0,
                    grand_total_premi: 0,
                    grand_total_upah_bersih: 0,
                    grand_total_upah_kotor: 0,
                    grand_total_potongan: 0
                },
                gangs: [],
                execution_time_ms: Date.now() - startTime
            };
        }

        const masterIds = headers.map(h => h.id);
        const historyIds = headers.map(h => h.history_id);

        // 2. Get all payroll detail records
        let detailSql = `
            SELECT 
                emp_code, emp_name, gang_code, division_code,
                task_code, task_desc,
                hari_kerja, jumlah_hk,
                gaji_pokok,
                lembur_jam, lembur_jumlah,
                premi_brondol, total_premi,
                total_tunjangan,
                total_potongan, total_potongan_bersih,
                jumlah_upah_kotor, upah_bersih,
                pot_pph21, pph21_ter,
                premi_detail, lembur_records,
                master_id
            FROM dbo.payroll_history_detail
            WHERE master_id IN (${masterIds.join(',')})
        `;
        const detailParams: any[] = [];

        // Apply filter: only show employees that have relevant data
        if (filterMode === 'lembur') {
            detailSql += ` AND lembur_jumlah > 0`;
        } else if (filterMode === 'premi') {
            detailSql += ` AND total_premi > 0`;
        }
        // upah_bersih and all: show everyone

        detailSql += ` ORDER BY gang_code, emp_code`;

        const details = await payrollDb.query<any>(detailSql, detailParams);

        // 3. Build a lookup: emp_code -> activities from transaction tables
        const empActivities = new Map<string, ActivityRecord[]>();

        if ((filterMode === 'lembur' || filterMode === 'all') && details.length > 0) {
            await this.fetchLemburActivities(transDb, historyIds, periodMonth, periodYear, empActivities, gangCode);
        }
        if ((filterMode === 'premi' || filterMode === 'all') && details.length > 0) {
            await this.fetchPremiActivities(transDb, historyIds, periodMonth, periodYear, empActivities, gangCode);
        }

        // 4. Build gang groups
        const gangMap = new Map<string, GangGroup>();

        // Pre-build gang info from headers
        for (const h of headers) {
            if (!gangMap.has(h.gang_code)) {
                gangMap.set(h.gang_code, {
                    gang_code: h.gang_code,
                    gang_description: h.gang_description || h.gang_code,
                    division_code: h.division_code,
                    employee_count: 0,
                    total_lembur: 0,
                    total_premi: 0,
                    total_upah_bersih: 0,
                    employees: []
                });
            }
        }

        let grandTotalLembur = 0;
        let grandTotalPremi = 0;
        let grandTotalUpahBersih = 0;
        let grandTotalUpahKotor = 0;
        let grandTotalPotongan = 0;

        for (const d of details) {
            const gangCodeClean = (d.gang_code || '').trim();
            const empCodeClean = (d.emp_code || '').trim();

            if (!gangMap.has(gangCodeClean)) {
                gangMap.set(gangCodeClean, {
                    gang_code: gangCodeClean,
                    gang_description: gangCodeClean,
                    division_code: d.division_code || '',
                    employee_count: 0,
                    total_lembur: 0,
                    total_premi: 0,
                    total_upah_bersih: 0,
                    employees: []
                });
            }

            const gang = gangMap.get(gangCodeClean)!;
            const lemburJumlah = parseFloat(d.lembur_jumlah) || 0;
            const totalPremi = parseFloat(d.total_premi) || 0;
            const upahBersih = parseFloat(d.upah_bersih) || 0;
            const upahKotor = parseFloat(d.jumlah_upah_kotor) || 0;
            const totalPotongan = parseFloat(d.total_potongan) || 0;

            const activities = empActivities.get(empCodeClean) || [];

            const emp: EmployeeDetail = {
                emp_code: empCodeClean,
                emp_name: (d.emp_name || '').trim(),
                gang_code: gangCodeClean,
                division_code: (d.division_code || '').trim(),
                task_code: (d.task_code || '').trim(),
                task_desc: (d.task_desc || '').trim(),
                hari_kerja: parseFloat(d.hari_kerja) || 0,
                jumlah_hk: parseFloat(d.jumlah_hk) || 0,
                gaji_pokok: parseFloat(d.gaji_pokok) || 0,
                lembur_jam: parseFloat(d.lembur_jam) || 0,
                lembur_jumlah: lemburJumlah,
                total_premi: totalPremi,
                premi_brondol: parseFloat(d.premi_brondol) || 0,
                total_tunjangan: parseFloat(d.total_tunjangan) || 0,
                total_potongan: totalPotongan,
                upah_kotor: upahKotor,
                upah_bersih: upahBersih,
                pph21: parseFloat(d.pph21_ter) || parseFloat(d.pot_pph21) || 0,
                activities
            };

            gang.employees.push(emp);
            gang.employee_count++;
            gang.total_lembur += lemburJumlah;
            gang.total_premi += totalPremi;
            gang.total_upah_bersih += upahBersih;

            grandTotalLembur += lemburJumlah;
            grandTotalPremi += totalPremi;
            grandTotalUpahBersih += upahBersih;
            grandTotalUpahKotor += upahKotor;
            grandTotalPotongan += totalPotongan;
        }

        // Convert map to sorted array
        const gangs = Array.from(gangMap.values())
            .filter(g => g.employee_count > 0)
            .sort((a, b) => a.gang_code.localeCompare(b.gang_code));

        return {
            success: true,
            period_month: periodMonth,
            period_year: periodYear,
            filter: filterMode,
            summary: {
                total_employees: details.length,
                total_gangs: gangs.length,
                grand_total_lembur: grandTotalLembur,
                grand_total_premi: grandTotalPremi,
                grand_total_upah_bersih: grandTotalUpahBersih,
                grand_total_upah_kotor: grandTotalUpahKotor,
                grand_total_potongan: grandTotalPotongan
            },
            gangs,
            execution_time_ms: Date.now() - startTime
        };
    }

    /**
     * Fetch overtime activity records from history_taskreg
     */
    private async fetchLemburActivities(
        transDb: Database,
        historyIds: string[],
        periodMonth: number,
        periodYear: number,
        empActivities: Map<string, ActivityRecord[]>,
        gangCode?: string
    ): Promise<void> {
        try {
            let sql = `
                SELECT 
                    emp_code, gang_code,
                    CONVERT(varchar, trx_date, 23) as trx_date_str,
                    task_code, task_desc,
                    hours, amount, rate
                FROM dbo.history_taskreg
                WHERE period_month = ? AND period_year = ?
                  AND is_lembur = 1
            `;
            const params: any[] = [periodMonth, periodYear];

            if (gangCode && gangCode !== 'ALL') {
                sql += ` AND gang_code = ?`;
                params.push(gangCode);
            }

            sql += ` ORDER BY emp_code, trx_date`;

            const rows = await transDb.query<any>(sql, params);

            for (const row of rows) {
                const empCode = (row.emp_code || '').trim();
                if (!empActivities.has(empCode)) {
                    empActivities.set(empCode, []);
                }
                empActivities.get(empCode)!.push({
                    date: row.trx_date_str || '',
                    task_code: (row.task_code || '').trim(),
                    task_desc: (row.task_desc || '').trim(),
                    hours: parseFloat(row.hours) || 0,
                    amount: parseFloat(row.amount) || 0,
                    category: 'LEMBUR',
                    is_overtime: true
                });
            }
        } catch (e: any) {
            console.error('[UpahBersihDetailService] Error fetching lembur activities:', e.message);
        }
    }

    /**
     * Fetch premi activity records from history_adtrans
     */
    private async fetchPremiActivities(
        transDb: Database,
        historyIds: string[],
        periodMonth: number,
        periodYear: number,
        empActivities: Map<string, ActivityRecord[]>,
        gangCode?: string
    ): Promise<void> {
        try {
            let sql = `
                SELECT 
                    emp_code, gang_code,
                    CONVERT(varchar, doc_date, 23) as doc_date_str,
                    task_code, task_desc,
                    amount, quantity,
                    category, sub_category,
                    doc_desc, doc_no,
                    dynamic_header_name
                FROM dbo.history_adtrans
                WHERE period_month = ? AND period_year = ?
                  AND is_premi = 1
            `;
            const params: any[] = [periodMonth, periodYear];

            if (gangCode && gangCode !== 'ALL') {
                sql += ` AND gang_code = ?`;
                params.push(gangCode);
            }

            sql += ` ORDER BY emp_code, doc_date`;

            const rows = await transDb.query<any>(sql, params);

            for (const row of rows) {
                const empCode = (row.emp_code || '').trim();
                if (!empActivities.has(empCode)) {
                    empActivities.set(empCode, []);
                }
                empActivities.get(empCode)!.push({
                    date: row.doc_date_str || '',
                    task_code: (row.task_code || '').trim(),
                    task_desc: (row.task_desc || '').trim(),
                    hours: parseFloat(row.quantity) || 0,
                    amount: parseFloat(row.amount) || 0,
                    category: (row.dynamic_header_name || row.sub_category || row.category || 'PREMI').trim(),
                    doc_desc: (row.doc_desc || '').trim(),
                    doc_no: (row.doc_no || '').trim(),
                    is_overtime: false
                });
            }
        } catch (e: any) {
            console.error('[UpahBersihDetailService] Error fetching premi activities:', e.message);
        }
    }
}

export const upahBersihDetailService = UpahBersihDetailService.getInstance();
