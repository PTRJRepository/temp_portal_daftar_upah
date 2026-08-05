/**
 * History Database Service
 *
 * Service ini menangani routing database berdasarkan RUN_MODE dan
 * menyediakan method untuk operasi CRUD pada tabel history.
 *
 * Database Configuration:
 * - RUN_MODE=prod (history mode):
 *   - Payroll/Daftar Upah: extend_db_ptrj
 *   - Detail Transaksi (Taskreg, ADTrans): extend_db_ptrj_transaksi
 * - RUN_MODE=dev: Menggunakan db_ptrj (real-time)
 *
 * ============================================================================
 * IMPORTANT: CURRENT HISTORY WRITE POLICY
 * ============================================================================
 *
 * History di repo ini sekarang memakai dua pola yang berbeda:
 *
 * 1. Identity-style records tertentu tetap append-first / no-overwrite
 *    bila perubahan harus terlacak sebagai histori.
 * 2. Snapshot payroll per periode/divisi/gang memakai scoped replace:
 *    reseed dengan `force=true` akan menghapus snapshot lama pada scope yang
 *    sama, lalu menulis ulang snapshot baru agar hasil tetap idempotent.
 *
 * Implikasinya:
 * - Jangan menganggap semua tabel history bersifat append-only.
 * - Jangan melakukan broad delete lintas divisi/periode tanpa scope jelas.
 * - Untuk payroll snapshot, source of truth terbaru adalah hasil seed terakhir
 *   pada scope periode/divisi/gang yang sama.
 * ============================================================================
 */

import { Database } from "../db/client";
import { Config } from "../config";
import { gangService } from "./gangService";
import { employeeHrDataService } from "./employeeHrDataService";
import { divisionDefinition } from "./divisionDefinition";
import { debug, info, warn, error as logError } from "../utils/logger";
import { sortByEmpCode } from "../utils/employeeSort";
import { resolveReportIdentity } from "../utils/taxReportIdentity";

export interface Employee {
    nik: string;
    nama: string;
    jenis_kelamin: string;
    loc_code: string;
    gang_code: string;
    phone?: string;
    upah_dasar?: number;
    actual_nik?: string;
    religion?: string;
    status?: string;
    employee_type?: string;
    birth_date?: string;
    join_date?: string;
    terminate_date?: string;
}

const CATEGORY = "HistoryDatabaseService";

// Environment variable untuk database transaksi
const DB_EXTEND_TRANS_DATABASE = Config.DB_EXTEND_TRANS_DATABASE;

export interface PayrollHistoryMaster {
    id?: number;
    history_id: string;
    snapshot_batch_id?: number;
    snapshot_version?: number;
    period_month: number;
    period_year: number;
    division_code: string;
    gang_code: string;
    gang_description?: string;
    total_employees: number;
    total_hk: number;
    total_hari_kerja: number;
    total_cuti_tahunan: number;
    total_cuti_sakit: number;
    total_cuti_minggu: number;
    total_cuti_nasional: number;
    total_upah_dasar: number;
    total_upah_pokok: number;
    total_gaji_pokok: number;
    total_beras: number;
    total_jabatan: number;
    total_masa_kerja: number;
    total_lembur: number;
    total_tunjangan: number;
    total_premi_brondol: number;
    total_premi_prunning: number;
    total_premi_insentif: number;
    total_premi_kinerja: number;
    total_premi: number;
    dynamic_premi_data?: string;
    total_koreksi: number;
    total_potongan: number;
    total_pph21: number;
    total_bpjs_pekerja: number;
    total_bpjs_majikan: number;
    total_spsi: number;
    dynamic_potongan_data?: string;
    total_upah_kotor: number;
    total_upah_bersih: number;
    total_ffb_weight?: number;
    total_weight_tbs?: number;
    informasi_tambahan?: string;
    created_at?: Date;
    created_by?: string;
    source_endpoint?: string;
    is_locked?: boolean;
    lock_reason?: string;
}

export interface PayrollHistoryDetail {
    id?: number;
    history_id: string;
    master_id: number;
    snapshot_batch_id?: number;
    snapshot_version?: number;
    emp_code: string;
    emp_name?: string;
    nik?: string;
    new_nik?: string;  // Tracks when NIK changes in source (db_ptrj). Original nik is NEVER overwritten.
    gender?: string;
    gang_code: string;
    division_code: string;
    loc_code?: string;
    status_ptkp?: string;
    kategori_ter?: string;
    hari_kerja: number;
    cuti_tahunan_hari: number;
    cuti_sakit_haid_hari: number;
    cuti_minggu_hari: number;
    cuti_nasional_hari: number;
    jumlah_hk: number;
    total_jam_kerja: number;
    upah_dasar: number;
    upah_pokok: number;
    gaji_pokok: number;
    gaji_pokok_ideal: number;
    gaji_pokok_aktual: number;
    koreksi_hk: number;
    beras_rate: number;
    beras_jumlah: number;
    jabatan_rate: number;
    jabatan_jumlah: number;
    masa_kerja_tahun: number;
    masa_kerja_rate: number;
    masa_kerja_jumlah: number;
    lembur_jam: number;
    lembur_rate: number;
    lembur_jumlah: number;
    lembur_records?: string;
    total_tunjangan: number;
    // [PHASE 2.5] Brondol dual source breakdown
    premi_brondol: number;  // Keep for backward compatibility (combined total)
    premi_brondol_loosefruit?: number;
    premi_brondol_adtrans?: number;
    premi_brondol_total?: number;
    premi_pph: number;
    total_premi: number;
    premi_detail?: string;
    pot_spsi: number;
    pot_pph21: number;
    pot_koreksi: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_kesehatan_majikan: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_bpjs_pensiun_majikan: number;
    pot_bpjs_pekerja_total: number;
    pot_astek_pekerja: number;
    pot_astek_majikan: number;
    pot_astek_jumlah: number;
    potongan_detail?: string;
    total_potongan: number;
    total_potongan_bersih: number;
    jumlah_upah_kotor: number;
    upah_kotor_pajak: number;
    penghasilan_bruto: number;
    tarif_pajak_ter?: number;
    pph21_ter: number;
    upah_bersih: number;
    task_code?: string;
    task_desc?: string;
    shortage_details?: string;
    shortage_total_hours?: number;
    jabatan?: string;  // Job title from employee_estate
    is_spsi_member?: boolean;  // SPSI membership status derived from pot_spsi > 0
    created_at?: Date;
}

export interface HistoryTaskreg {
    id?: number;
    history_id: string;
    original_master_id?: number;
    reg_no?: string;
    reg_date?: Date;
    emp_code: string;
    gang_code?: string;
    division_code?: string;
    original_line_id?: number;
    line_no?: number;
    trx_date: Date;
    task_code?: string;
    task_desc?: string;
    hours: number;
    ot: boolean;
    rate?: number;
    amount: number;
    tapping_type?: string;
    location_code?: string;
    status?: string;
    is_cuti_tahunan: boolean;
    is_cuti_sakit: boolean;
    is_cuti_minggu: boolean;
    is_cuti_nasional: boolean;
    is_hari_kerja: boolean;
    is_lembur: boolean;
    period_month: number;
    period_year: number;
    source_table: string;
    created_at?: Date;
}

export interface HistoryAdtrans {
    id?: number;
    history_id: string;
    original_master_id?: number;
    doc_no?: string;
    doc_date: Date;
    doc_desc?: string;
    emp_code: string;
    gang_code?: string;
    division_code?: string;
    original_line_id?: number;
    line_no?: number;
    task_code?: string;
    task_desc?: string;
    amount: number;
    quantity?: number;
    uom?: string;
    category: string;
    sub_category?: string;
    is_dynamic: boolean;
    dynamic_header_name?: string;
    is_premi_pph: boolean;
    is_koreksi: boolean;
    is_potongan: boolean;
    is_premi: boolean;
    period_month: number;
    period_year: number;
    source_table: string;
    created_at?: Date;
}

export interface HistoryGangMember {
    id?: number;
    history_id: string;
    gang_code: string;
    gang_description?: string;
    division_code: string;
    loc_code?: string;
    emp_code: string;
    emp_name?: string;
    nik?: string;
    jabatan?: string;
    join_date?: Date;
    is_active: boolean;
    period_month: number;
    period_year: number;
    source_table: string;
    created_at?: Date;
}

export interface HistoryHrEmployee {
    id?: number;
    history_id: string;
    period_month: number;
    period_year: number;
    nik?: string;
    new_nik?: string;  // Tracks when NIK changes in source (db_ptrj). Original nik is NEVER overwritten.
    pajak_npwp?: string;
    res_address?: string;
    emp_code: string;
    emp_name?: string;
    company_code?: string;
    division_code?: string;
    loc_code?: string;
    gang_code?: string;
    job_code?: string;
    position?: string;
    jabatan?: string;  // Job title from employee_estate
    is_spsi_member?: boolean;  // SPSI membership status derived from pot_spsi > 0
    join_date?: Date;
    terminate_date?: Date;
    status?: string;
    employee_type?: string;
    gender?: string;
    religion?: string;
    birth_place?: string;
    birth_date?: Date;
    marital_status?: string;
    tax_status?: string;
    ptkp_beras?: string;
    ptkp_pajak?: string;
    upah_dasar?: number;
    total_hk?: number;
    source_table: string;
    created_at?: Date;
}

export interface HistoryTaxIdentity {
    emp_code: string;
    nik?: string;
    new_nik?: string;
    pajak_npwp?: string;
    res_address?: string;
    religion?: string;
}

export interface HistoryHrGang {
    id?: number;
    history_id: string;
    period_month: number;
    period_year: number;
    division_code?: string;
    loc_code?: string;
    gang_code: string;
    gang_description?: string;
    mandor_code?: string;
    mandor_name?: string;
    mandor_1_code?: string;
    mandor_1_name?: string;
    assistant_code?: string;
    assistant_name?: string;
    total_members?: number;
    is_active?: boolean;
    source_table: string;
    created_at?: Date;
}

export interface HistoryMetadata {
    id?: number;
    history_id: string;
    operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOCK' | 'UNLOCK' | 'ARCHIVE' | 'RESTORE';
    entity_type: 'PAYROLL_MASTER' | 'PAYROLL_DETAIL' | 'TASKREG' | 'ADTRANS' | 'GANG_MEMBER' | 'BATCH';
    entity_id?: number;
    period_month: number;
    period_year: number;
    division_code?: string;
    gang_code?: string;
    description?: string;
    old_values?: string;
    new_values?: string;
    record_count?: number;
    status?: 'SUCCESS' | 'FAILED' | 'PENDING' | 'ROLLBACK';
    error_message?: string;
    performed_by: string;
    performed_at?: Date;
    ip_address?: string;
    user_agent?: string;
    session_id?: string;
}

export class HistoryDatabaseService {
    private static instance: HistoryDatabaseService;

    private constructor() { }

    public static getInstance(): HistoryDatabaseService {
        if (!HistoryDatabaseService.instance) {
            HistoryDatabaseService.instance = new HistoryDatabaseService();
        }
        return HistoryDatabaseService.instance;
    }

    /**
     * Check if system is in history mode (prod)
     */
    public isHistoryMode(): boolean {
        return Config.RUN_MODE === 'prod';
    }

    /**
     * Get database instance for payroll/daftar upah data
     * - History mode (prod): extend_db_ptrj
     * - Dev mode: extend_db_ptrj (always use extend_db for history tables)
     */
    public getPayrollDatabase(): Database {
        // Always use extend_db_ptrj for history tables regardless of RUN_MODE
        // History tables (payroll_history_header, payroll_history_detail) only exist in extend_db_ptrj
        return Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    /**
     * Get database instance for transaction data
     * - History mode (prod): extend_db_ptrj_transaksi
     * - Dev mode: db_ptrj (default)
     */
    public getTransactionDatabase(): Database {
        if (this.isHistoryMode()) {
            return Database.getInstance(DB_EXTEND_TRANS_DATABASE, Config.DB_EXTEND_PROFILE);
        }
        return Database.getInstance();
    }

    /**
     * Generate unique history_id
     */
    public generateHistoryId(): string {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        return `HIST-${timestamp}-${random}`;
    }

    // ============================================================================
    // HR HISTORY FALLBACK OPERATIONS
    // Used when origin DB has no data - queries from history tables
    // ============================================================================

    /**
     * Get the history database instance directly (always extend_db_ptrj with SERVER_PROFILE_1)
     * Used for fallback when origin DB returns no data
     */
    public getHistoryDb(): Database {
        return Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    /**
     * Check if history DB has any data for the given period
     */
    public async hasHistoryData(periodMonth?: number, periodYear?: number): Promise<boolean> {
        try {
            const db = this.getHistoryDb();
            let sql = `SELECT TOP 1 1 FROM dbo.history_hr_employee`;
            const params: any[] = [];

            if (periodMonth && periodYear) {
                sql += ` WHERE period_month = ? AND period_year = ?`;
                params.push(periodMonth, periodYear);
            }

            const result = await db.queryOne<{ '': number }>(sql, params);
            return !!result;
        } catch (e) {
            logError(CATEGORY, "Error checking history data availability", e);
            return false;
        }
    }

    /**
     * List employees from history database with optional filters
     */
    public async listEmployeesFromHistory(options: {
        skip?: number;
        limit?: number;
        gangCode?: string;
        division?: string;
        religion?: string;
        status?: string;
    } = {}): Promise<Employee[]> {
        const { skip = 0, limit = 100, gangCode, division, religion, status } = options;

        try {
            info(CATEGORY, `listEmployeesFromHistory() called with:`, { gangCode, division, religion, status });

            const db = this.getHistoryDb();
            let params: any[] = [];
            let whereClauses: string[] = [];

            // Division prefix filter
            if (division) {
                const prefixMap: Record<string, string[]> = {
                    "PG1A": ["A"], "PG1B": ["B"], "PG2A": ["C"], "PG2B": ["D"],
                    "DME": ["E"], "ARA": ["F"], "AB1": ["G"], "AB2": ["H"],
                    "INF": ["I"], "ARC": ["J"], "IJL": ["L"],
                };
                const prefixes = prefixMap[division] || prefixMap[division.replace("PG1A", "A").replace("PG1B", "B")] || [];
                if (prefixes.length > 0) {
                    const conditions = prefixes.map(() => `UPPER(RTRIM(gang_code)) LIKE ?`);
                    whereClauses.push(`(${conditions.join(" OR ")})`);
                    params.push(...prefixes.map(p => p + "%"));
                }
            }

            // Gang filter
            if (gangCode && gangCode !== "ALL" && gangCode.trim()) {
                whereClauses.push(`UPPER(RTRIM(gang_code)) = ?`);
                params.push(gangCode.trim().toUpperCase());
            }

            // Religion filter
            if (religion) {
                whereClauses.push(`UPPER(RTRIM(religion)) = ?`);
                params.push(religion.trim().toUpperCase());
            }

            // Status filter
            if (status) {
                whereClauses.push(`UPPER(RTRIM(status)) = ?`);
                params.push(status.trim().toUpperCase());
            }

            const whereClause = whereClauses.length > 0
                ? `WHERE ${whereClauses.join(" AND ")}`
                : "";

            // Get latest record per employee (highest period_year, period_month)
            const sql = `
                SELECT
                    RTRIM(emp_code) AS nik,
                    RTRIM(nik) AS actual_nik,
                    emp_name AS nama,
                    gender AS jenis_kelamin,
                    RTRIM(loc_code) AS loc_code,
                    RTRIM(gang_code) AS gang_code,
                    RTRIM(religion) AS religion,
                    RTRIM(status) AS status,
                    RTRIM(employee_type) AS employee_type,
                    CONVERT(VARCHAR, birth_date, 23) AS birth_date,
                    CONVERT(VARCHAR, join_date, 23) AS join_date,
                    CONVERT(VARCHAR, terminate_date, 23) AS terminate_date,
                    CONVERT(VARCHAR, birth_date, 23) AS birth_date_str,
                    period_month,
                    period_year
                FROM dbo.history_hr_employee h
                ${whereClause}
                AND period_year = (SELECT MAX(period_year) FROM dbo.history_hr_employee h2 WHERE h2.emp_code = h.emp_code)
                AND period_month = (SELECT MAX(period_month) FROM dbo.history_hr_employee h3
                    WHERE h3.emp_code = h.emp_code AND h3.period_year = h.period_year)
                ORDER BY emp_name
            `;

            const rows = await db.query<any>(sql, params);

            // Apply pagination after deduplication
            const allEmployees: Employee[] = rows.map((r: any) => ({
                nik: r.nik?.trim() || "",
                actual_nik: r.actual_nik?.trim() || r.nik?.trim() || "",
                nama: r.nama?.trim() || "",
                jenis_kelamin: r.gender?.trim() || "L",
                loc_code: r.loc_code?.trim() || "",
                gang_code: r.gang_code?.trim() || "",
                religion: r.religion?.trim() || "",
                status: r.status?.trim() || "",
                employee_type: r.employee_type?.trim() || "",
                birth_date: r.birth_date_str || undefined,
                join_date: r.join_date || undefined,
                terminate_date: r.terminate_date || undefined,
            }));

            info(CATEGORY, `History DB returned ${allEmployees.length} employees`);
            return allEmployees.slice(skip, skip + limit);
        } catch (e) {
            logError(CATEGORY, "listEmployeesFromHistory failed:", e);
            return [];
        }
    }

    /**
     * Search employees from history database
     */
    public async searchEmployeesFromHistory(term: string, limit: number = 50, division?: string): Promise<Employee[]> {
        if (!term || term.length < 2) return [];

        try {
            const db = this.getHistoryDb();
            let params: any[] = [`%${term}%`, `%${term}%`, `%${term}%`];
            let whereClause = `(emp_code LIKE ? OR emp_name LIKE ? OR nik LIKE ?)`;

            if (division) {
                const prefixMap: Record<string, string[]> = {
                    "PG1A": ["A"], "PG1B": ["B"], "PG2A": ["C"], "PG2B": ["D"],
                    "DME": ["E"], "ARA": ["F"], "AB1": ["G"], "AB2": ["H"],
                    "INF": ["I"], "ARC": ["J"], "IJL": ["L"],
                };
                const prefixes = prefixMap[division] || [];
                if (prefixes.length > 0) {
                    const conditions = prefixes.map(() => `UPPER(RTRIM(gang_code)) LIKE ?`);
                    whereClause += ` AND (${conditions.join(" OR ")})`;
                    params.push(...prefixes.map(p => p + "%"));
                }
            }

            const sql = `
                SELECT TOP ${limit}
                    RTRIM(emp_code) AS nik,
                    RTRIM(nik) AS actual_nik,
                    emp_name AS nama,
                    gender AS jenis_kelamin,
                    RTRIM(loc_code) AS loc_code,
                    RTRIM(gang_code) AS gang_code,
                    RTRIM(religion) AS religion,
                    RTRIM(status) AS status,
                    RTRIM(employee_type) AS employee_type,
                    CONVERT(VARCHAR, birth_date, 23) AS birth_date,
                    CONVERT(VARCHAR, join_date, 23) AS join_date
                FROM dbo.history_hr_employee
                WHERE ${whereClause}
                ORDER BY emp_name
            `;

            const rows = await db.query<any>(sql, params);
            return rows.map((r: any) => ({
                nik: r.nik?.trim() || "",
                actual_nik: r.actual_nik?.trim() || r.nik?.trim() || "",
                nama: r.nama?.trim() || "",
                jenis_kelamin: r.gender?.trim() || "L",
                loc_code: r.loc_code?.trim() || "",
                gang_code: r.gang_code?.trim() || "",
                religion: r.religion?.trim() || "",
                status: r.status?.trim() || "",
                employee_type: r.employee_type?.trim() || "",
                birth_date: r.birth_date || undefined,
                join_date: r.join_date || undefined,
            }));
        } catch (e) {
            logError(CATEGORY, "searchEmployeesFromHistory failed:", e);
            return [];
        }
    }

    /**
     * Get available gang codes from history database
     */
    public async getAvailableGangsFromHistory(division?: string): Promise<string[]> {
        try {
            const db = this.getHistoryDb();
            let sql = `SELECT DISTINCT RTRIM(gang_code) AS gang_code FROM dbo.history_hr_employee WHERE gang_code IS NOT NULL AND RTRIM(gang_code) != ''`;
            const params: any[] = [];

            if (division) {
                const prefixMap: Record<string, string[]> = {
                    "PG1A": ["A"], "PG1B": ["B"], "PG2A": ["C"], "PG2B": ["D"],
                    "DME": ["E"], "ARA": ["F"], "AB1": ["G"], "AB2": ["H"],
                    "INF": ["I"], "ARC": ["J"], "IJL": ["L"],
                };
                const prefixes = prefixMap[division] || [];
                if (prefixes.length > 0) {
                    const conditions = prefixes.map(() => `UPPER(RTRIM(gang_code)) LIKE ?`);
                    sql += ` AND (${conditions.join(" OR ")})`;
                    params.push(...prefixes.map(p => p + "%"));
                }
            }

            sql += ` ORDER BY gang_code`;
            const rows = await db.query<{ gang_code: string }>(sql, params);
            return rows.map(r => r.gang_code?.trim()).filter(Boolean) as string[];
        } catch (e) {
            logError(CATEGORY, "getAvailableGangsFromHistory failed:", e);
            return [];
        }
    }

    /**
     * Get available religions from history database
     */
    public async getAvailableReligionsFromHistory(): Promise<string[]> {
        try {
            const db = this.getHistoryDb();
            const rows = await db.query<{ religion: string }>(`
                SELECT DISTINCT RTRIM(religion) AS religion
                FROM dbo.history_hr_employee
                WHERE religion IS NOT NULL AND RTRIM(religion) != ''
                ORDER BY religion
            `);
            return rows.map(r => r.religion?.trim()).filter(Boolean) as string[];
        } catch (e) {
            logError(CATEGORY, "getAvailableReligionsFromHistory failed:", e);
            return [];
        }
    }

    /**
     * Get available statuses from history database
     */
    public async getAvailableStatusesFromHistory(): Promise<string[]> {
        try {
            const db = this.getHistoryDb();
            const rows = await db.query<{ status: string }>(`
                SELECT DISTINCT RTRIM(status) AS status
                FROM dbo.history_hr_employee
                WHERE status IS NOT NULL AND RTRIM(status) != ''
                ORDER BY status
            `);
            return rows.map(r => r.status?.trim()).filter(Boolean) as string[];
        } catch (e) {
            logError(CATEGORY, "getAvailableStatusesFromHistory failed:", e);
            return [];
        }
    }

    // ============================================================================
    // PAYROLL HISTORY MASTER OPERATIONS
    // ============================================================================

    /**
     * Insert or update payroll history master
     */
    public async savePayrollHistoryMaster(data: PayrollHistoryMaster): Promise<number> {
        const db = this.getPayrollDatabase();

        const hasSnapshotVersion = typeof data.snapshot_version === "number" && Number.isFinite(data.snapshot_version);
        const existing = hasSnapshotVersion
            ? await db.queryOne<{ id: number }>(`
                SELECT id FROM dbo.payroll_history_header
                WHERE period_month = ? AND period_year = ? AND division_code = ? AND gang_code = ? AND snapshot_version = ?
            `, [data.period_month, data.period_year, data.division_code, data.gang_code, data.snapshot_version])
            : await db.queryOne<{ id: number }>(`
                SELECT id FROM dbo.payroll_history_header
                WHERE period_month = ? AND period_year = ? AND division_code = ? AND gang_code = ?
            `, [data.period_month, data.period_year, data.division_code, data.gang_code]);

        const columnMap: Record<string, any> = {
            history_id: data.history_id,
            snapshot_batch_id: data.snapshot_batch_id,
            snapshot_version: data.snapshot_version,
            period_month: data.period_month,
            period_year: data.period_year,
            division_code: data.division_code,
            gang_code: data.gang_code,
            gang_description: data.gang_description,
            total_employees: data.total_employees,
            total_hk: data.total_hk,
            total_hari_kerja: data.total_hari_kerja,
            total_cuti_tahunan: data.total_cuti_tahunan,
            total_cuti_sakit: data.total_cuti_sakit,
            total_cuti_minggu: data.total_cuti_minggu,
            total_cuti_nasional: data.total_cuti_nasional,
            total_upah_dasar: data.total_upah_dasar,
            total_upah_pokok: data.total_upah_pokok,
            total_gaji_pokok: data.total_gaji_pokok,
            total_beras: data.total_beras,
            total_jabatan: data.total_jabatan,
            total_masa_kerja: data.total_masa_kerja,
            total_lembur: data.total_lembur,
            total_tunjangan: data.total_tunjangan,
            total_premi_brondol: data.total_premi_brondol,
            total_premi_prunning: data.total_premi_prunning,
            total_premi_insentif: data.total_premi_insentif,
            total_premi_kinerja: data.total_premi_kinerja,
            total_premi: data.total_premi,
            dynamic_premi_data: data.dynamic_premi_data,
            total_koreksi: data.total_koreksi,
            total_potongan: data.total_potongan,
            total_pph21: data.total_pph21,
            total_bpjs_pekerja: data.total_bpjs_pekerja,
            total_bpjs_majikan: data.total_bpjs_majikan,
            total_spsi: data.total_spsi,
            dynamic_potongan_data: data.dynamic_potongan_data,
            total_upah_kotor: data.total_upah_kotor,
            total_upah_bersih: data.total_upah_bersih,
            total_ffb_weight: data.total_ffb_weight,
            total_weight_tbs: data.total_weight_tbs,
            informasi_tambahan: data.informasi_tambahan,
            created_by: data.created_by,
            source_endpoint: data.source_endpoint,
            is_locked: data.is_locked ?? false,
            lock_reason: data.lock_reason
        };

        if (existing) {
            const assignments = Object.keys(columnMap)
                .map((column) => `${column} = ?`)
                .join(",\n                    ");
            await db.query(`
                UPDATE dbo.payroll_history_header SET
                    ${assignments}
                WHERE id = ?
            `, [...Object.values(columnMap), existing.id]);
            return existing.id;
        }

        const insertColumns = [...Object.keys(columnMap), "created_at"];
        const placeholders = insertColumns.map(() => "?").join(", ");
        const params = [...Object.values(columnMap), new Date()];
        const result = await db.query(`
            INSERT INTO dbo.payroll_history_header (
                ${insertColumns.join(",\n                ")}
            ) OUTPUT INSERTED.id VALUES (
                ${placeholders}
            )
        `, params);
        return result[0]?.id;
    }

    /**
     * Get payroll history master by period and gang
     */
    public async getPayrollHistoryMaster(
        periodMonth: number,
        periodYear: number,
        divisionCode?: string,
        gangCode?: string
    ): Promise<PayrollHistoryMaster[]> {
        const db = this.getPayrollDatabase();

        let sql = `
            SELECT * FROM dbo.payroll_history_header
            WHERE period_month = ? AND period_year = ?
        `;
        const params: any[] = [periodMonth, periodYear];

        if (divisionCode) {
            // Use unified division mapping
            const aliases = gangService.getAllDivisionAliases(divisionCode);
            if (aliases.length > 0) {
                const placeholders = aliases.map(() => '?').join(',');
                sql += ` AND division_code IN (${placeholders})`;
                params.push(...aliases);
            }
        }

        if (gangCode) {
            sql += ` AND gang_code = ?`;
            params.push(gangCode);
        }

        sql += ` ORDER BY division_code, gang_code`;

        return await db.query<PayrollHistoryMaster>(sql, params);
    }

    public async getHistoryTaxIdentityByEmpCodes(
        periodMonth: number,
        periodYear: number,
        empCodes: string[]
    ): Promise<Map<string, HistoryTaxIdentity>> {
        const result = new Map<string, HistoryTaxIdentity>();
        const normalizedEmpCodes = [...new Set(
            (empCodes || [])
                .map(code => String(code || "").trim().toUpperCase())
                .filter(Boolean)
        )];

        if (normalizedEmpCodes.length === 0) return result;

        const db = this.getPayrollDatabase();
        const chunkSize = 500;

        try {
            for (let i = 0; i < normalizedEmpCodes.length; i += chunkSize) {
                const chunk = normalizedEmpCodes.slice(i, i + chunkSize);
                const placeholders = chunk.map(() => "?").join(",");
                const rows = await db.query<HistoryTaxIdentity>(`
                    SELECT emp_code, nik, new_nik, pajak_npwp, res_address, religion
                    FROM (
                        SELECT
                            RTRIM(emp_code) AS emp_code,
                            NULLIF(RTRIM(ISNULL(nik, '')), '') AS nik,
                            NULLIF(RTRIM(ISNULL(new_nik, '')), '') AS new_nik,
                            NULLIF(RTRIM(ISNULL(pajak_npwp, '')), '') AS pajak_npwp,
                            NULLIF(RTRIM(ISNULL(res_address, '')), '') AS res_address,
                            NULLIF(RTRIM(ISNULL(religion, '')), '') AS religion,
                            ROW_NUMBER() OVER (
                                PARTITION BY RTRIM(emp_code)
                                ORDER BY
                                    CASE WHEN period_month = ? AND period_year = ? THEN 0 ELSE 1 END,
                                    period_year DESC,
                                    period_month DESC,
                                    id DESC
                            ) AS rn
                        FROM dbo.history_hr_employee
                        WHERE period_year = ?
                          AND RTRIM(emp_code) IN (${placeholders})
                    ) ranked
                    WHERE rn = 1
                `, [periodMonth, periodYear, periodYear, ...chunk]);

                rows.forEach(row => {
                    const empCode = String(row.emp_code || "").trim().toUpperCase();
                    if (empCode) result.set(empCode, row);
                });
            }
        } catch (e) {
            logError(CATEGORY, "Error fetching tax identity from history_hr_employee", e);
        }

        return result;
    }

    /**
     * Lock payroll history to prevent modification
     */
    public async lockPayrollHistory(
        periodMonth: number,
        periodYear: number,
        divisionCode: string,
        gangCode: string,
        reason: string,
        lockedBy: string
    ): Promise<boolean> {
        const db = this.getPayrollDatabase();

        await db.query(`
            UPDATE dbo.payroll_history_header
            SET is_locked = 1, lock_reason = ?
            WHERE period_month = ? AND period_year = ? AND division_code = ? AND gang_code = ?
        `, [reason, periodMonth, periodYear, divisionCode, gangCode]);

        return true;
    }

    // ============================================================================
    // PAYROLL HISTORY DETAIL OPERATIONS
    // ============================================================================

    /**
     * Insert payroll history detail.
     *
     * IMPORTANT: DATA APPEND-ONLY PATTERN (Immutable History)
     * - Selalu INSERT record baru. TIDAK pernah UPDATE record existing.
     * - NIK TIDAK PERNAH di-update. Jika NIK berubah di source (db_ptrj),
     *   simpan NIK baru di kolom `new_nik`, JANGAN overwrite kolom `nik`.
     * - Jika master_id + emp_code sudah ada → INSERT record baru dengan new_nik tracking
     * - NIK lama (kolom `nik`) adalah ground truth dan TIDAK AKAN PERNAH berubah.
     *
     * new_nik tracking:
     * - new_nik NULL + existing record → INSERT baru (first seeding)
     * - new_nik berbeda dari existing `nik` → INSERT baru, set new_nik = current source NIK
     * - new_nik sama dengan existing `nik` → INSERT baru, set new_nik = same value
     */
    public async savePayrollHistoryDetail(data: PayrollHistoryDetail): Promise<number> {
        const db = this.getPayrollDatabase();

        // Check existing record to determine new_nik value
        const existing = await db.queryOne<{ id: number; nik: string; new_nik: string }>(`
            SELECT id, nik, new_nik FROM dbo.payroll_history_detail
            WHERE master_id = ? AND emp_code = ?
        `, [data.master_id, data.emp_code]);

        let resolvedNewNik: string | undefined = undefined;

        if (existing) {
            // NIK dalam source berbeda dari NIK lama yang tersimpan → tracking di new_nik
            // NIK lama (kolom `nik`) TIDAK PERNAH diubah
            if (data.nik && existing.nik && data.nik !== existing.nik) {
                resolvedNewNik = data.nik;  // NIK baru dari source → simpan di new_nik
            } else if (data.nik) {
                resolvedNewNik = data.nik;
            }
        } else {
            // Record pertama untuk master_id + emp_code ini
            resolvedNewNik = data.new_nik;
        }

        const columnMap: Record<string, any> = {
            history_id: data.history_id,
            master_id: data.master_id,
            snapshot_batch_id: data.snapshot_batch_id,
            snapshot_version: data.snapshot_version,
            emp_code: data.emp_code,
            emp_name: data.emp_name,
            nik: existing ? existing.nik : data.nik,
            new_nik: resolvedNewNik,
            gender: data.gender,
            gang_code: data.gang_code,
            division_code: data.division_code,
            loc_code: data.loc_code,
            status_ptkp: data.status_ptkp,
            kategori_ter: data.kategori_ter,
            hari_kerja: data.hari_kerja,
            cuti_tahunan_hari: data.cuti_tahunan_hari,
            cuti_sakit_haid_hari: data.cuti_sakit_haid_hari,
            cuti_minggu_hari: data.cuti_minggu_hari,
            cuti_nasional_hari: data.cuti_nasional_hari,
            jumlah_hk: data.jumlah_hk,
            total_jam_kerja: data.total_jam_kerja,
            upah_dasar: data.upah_dasar,
            upah_pokok: data.upah_pokok,
            gaji_pokok: data.gaji_pokok,
            gaji_pokok_ideal: data.gaji_pokok_ideal,
            gaji_pokok_aktual: data.gaji_pokok_aktual,
            koreksi_hk: data.koreksi_hk,
            beras_rate: data.beras_rate,
            beras_jumlah: data.beras_jumlah,
            jabatan_rate: data.jabatan_rate,
            jabatan_jumlah: data.jabatan_jumlah,
            masa_kerja_tahun: data.masa_kerja_tahun,
            masa_kerja_rate: data.masa_kerja_rate,
            masa_kerja_jumlah: data.masa_kerja_jumlah,
            lembur_jam: data.lembur_jam,
            lembur_rate: data.lembur_rate,
            lembur_jumlah: data.lembur_jumlah,
            lembur_records: data.lembur_records,
            total_tunjangan: data.total_tunjangan,
            premi_brondol: data.premi_brondol,
            premi_brondol_loosefruit: data.premi_brondol_loosefruit,
            premi_brondol_adtrans: data.premi_brondol_adtrans,
            premi_brondol_total: data.premi_brondol_total,
            premi_pph: data.premi_pph,
            total_premi: data.total_premi,
            premi_detail: data.premi_detail,
            pot_spsi: data.pot_spsi,
            pot_pph21: data.pot_pph21,
            pot_koreksi: data.pot_koreksi,
            pot_bpjs_kesehatan_pekerja: data.pot_bpjs_kesehatan_pekerja,
            pot_bpjs_kesehatan_majikan: data.pot_bpjs_kesehatan_majikan,
            pot_bpjs_pensiun_pekerja: data.pot_bpjs_pensiun_pekerja,
            pot_bpjs_pensiun_majikan: data.pot_bpjs_pensiun_majikan,
            pot_bpjs_pekerja_total: data.pot_bpjs_pekerja_total,
            pot_astek_pekerja: data.pot_astek_pekerja,
            pot_astek_majikan: data.pot_astek_majikan,
            pot_astek_jumlah: data.pot_astek_jumlah,
            potongan_detail: data.potongan_detail,
            total_potongan: data.total_potongan,
            total_potongan_bersih: data.total_potongan_bersih,
            jumlah_upah_kotor: data.jumlah_upah_kotor,
            upah_kotor_pajak: data.upah_kotor_pajak,
            penghasilan_bruto: data.penghasilan_bruto,
            tarif_pajak_ter: data.tarif_pajak_ter,
            pph21_ter: data.pph21_ter,
            upah_bersih: data.upah_bersih,
            task_code: data.task_code,
            task_desc: data.task_desc,
            shortage_details: data.shortage_details,
            shortage_total_hours: data.shortage_total_hours,
            jabatan: data.jabatan,
            is_spsi_member: data.is_spsi_member
        };

        const columns = Object.keys(columnMap);
        const placeholders = columns.map(() => '?').join(', ');
        const params = Object.values(columnMap);

        const sql = `
            INSERT INTO dbo.payroll_history_detail (
                ${columns.join(',\n                ')}
            ) OUTPUT INSERTED.id VALUES (
                ${placeholders}
            )
        `;

        const result = await db.query(sql, params);
        return result[0]?.id;
    }

    /**
     * Get payroll history details by master_id
     */
    public async getPayrollHistoryDetails(masterId: number): Promise<PayrollHistoryDetail[]> {
        const db = this.getPayrollDatabase();

        return await db.query<PayrollHistoryDetail>(`
            SELECT * FROM dbo.payroll_history_detail
            WHERE master_id = ?
            ORDER BY emp_code
        `, [masterId]);
    }

    /**
     * Get historical payroll data mapped to match DataExtractorService's exact format.
     * Use this to seamlessly read from deep history tables when the UI requests a legacy period.
     */
    public async getHistoricalPayrollDataAsExtractorFormat(
        periodMonth: number,
        periodYear: number,
        gangCode: string = "ALL",
        divisionCode?: string,
        specificEmpCode: string | null = null,
        gangPrefix?: string
    ): Promise<{
        data_rows: any[];
        dynamic_premi_headers: string[];
        dynamic_potongan_headers: string[];
        premi_title_map: Record<string, string>;
        potongan_title_map: Record<string, string>;
        meta: { execution_time_ms: number; row_count: number; is_history_snapshot: boolean }
    } | null> {
        const startTime = Date.now();
        const db = this.getPayrollDatabase();

        let masterQuery = `SELECT h.id, h.snapshot_version, h.dynamic_premi_data, h.dynamic_potongan_data FROM dbo.payroll_history_header h WHERE h.period_month = ? AND h.period_year = ?`;
        const masterParams: any[] = [periodMonth, periodYear];
        debug(CATEGORY, `getHistoricalPayrollDataAsExtractorFormat params: M:${periodMonth} Y:${periodYear} Gang:${gangCode} Div:${divisionCode}`);

        if (divisionCode) {
            // Use unified mapping for consistent division handling
            const allPossibleDivs = new Set<string>();
            try {
                // Check if this is a virtual division - handle separately with gang filtering
                if (gangService.isVirtualDivision(divisionCode)) {
                    // [ALIGNMENT] For virtual divisions, we look for both:
                    // 1. Records with gang_code matching the virtual division's gangs (e.g., 'HMC')
                    // 2. Records with division_code matching the virtual division name (e.g., 'WKS_AR')
                    const virtualGangs = await gangService.getVirtualDivisionGangs(divisionCode);
                    const aliases = gangService.getAllDivisionAliases(divisionCode);
                    const targets = [...new Set([...virtualGangs, ...aliases])];
                    
                    if (targets.length > 0) {
                        const placeholders = targets.map(() => '?').join(',');
                        masterQuery += ` AND (h.gang_code IN (${placeholders}) OR h.division_code IN (${placeholders}))`;
                        masterParams.push(...targets, ...targets);
                    }
                } else {
                    // Regular division - use unified mapping
                    const aliases = gangService.getAllDivisionAliases(divisionCode);
                    aliases.forEach(a => allPossibleDivs.add(a));
                    // Also get from source divisions
                    const sourceDivs = await divisionDefinition.getSourceDivisionsForAggregation(divisionCode);
                    for (const sd of sourceDivs) {
                        allPossibleDivs.add(sd);
                        const srcAliases = gangService.getAllDivisionAliases(sd);
                        srcAliases.forEach(a => allPossibleDivs.add(a));
                    }
                    const divList = Array.from(allPossibleDivs);
                    const placeholders = divList.map(() => '?').join(',');
                    
                    // [REFINEMENT] If we have specific divisions, don't include global 'ALL' headers
                    // This prevents duplication when fetching history that has both divisional and global records.
                    if (divisionCode === 'ALL') {
                        masterQuery += ` AND h.division_code = 'ALL'`;
                    } else {
                        masterQuery += ` AND h.division_code IN (${placeholders})`;
                        masterParams.push(...divList);
                    }
                }
            } catch (e) {
                logError(CATEGORY, "Error handling division filter:", e);
                /* fallback to original logic */
            }
        }
        if (gangCode && gangCode !== "ALL") {
            masterQuery += ` AND h.gang_code = ?`;
            masterParams.push(gangCode);
        }

        masterQuery += `
            AND ISNULL(h.snapshot_version, 0) = (
                SELECT ISNULL(MAX(h2.snapshot_version), 0)
                FROM dbo.payroll_history_header h2
                WHERE h2.period_month = h.period_month
                  AND h2.period_year = h.period_year
                  AND h2.division_code = h.division_code
                  AND h2.gang_code = h.gang_code
            )
        `;

        const masters = await db.query<{ id: number, snapshot_version: number, dynamic_premi_data: string, dynamic_potongan_data: string }>(masterQuery, masterParams);

        if (masters.length === 0) return null; // No history data seeded yet

        const masterIds = masters.map(m => m.id);

        // Map dynamic headers
        const dynamicPremiSet = new Set<string>();
        const dynamicPotonganSet = new Set<string>();
        for (const m of masters) {
            try {
                if (m.dynamic_premi_data) {
                    const pData = JSON.parse(m.dynamic_premi_data);
                    pData.forEach((k: string) => dynamicPremiSet.add(k));
                }
                if (m.dynamic_potongan_data) {
                    const potData = JSON.parse(m.dynamic_potongan_data);
                    potData.forEach((k: string) => dynamicPotonganSet.add(k));
                }
            } catch (e) {
                logError(CATEGORY, "Error parsing dynamic headers for master_id " + m.id, e);
            }
        }

        let detailQuery = `
            SELECT d.*
            FROM dbo.payroll_history_detail d
            WHERE master_id IN (${masterIds.join(',')})
        `;
        const detailParams: any[] = [];

        if (specificEmpCode) {
            detailQuery += ` AND emp_code = ?`;
            detailParams.push(specificEmpCode);
        }
        if (gangCode && gangCode !== "ALL") {
            // Jika gang spesifik, cukup filter by gang
            detailQuery += ` AND gang_code = ?`;
            detailParams.push(gangCode);
        } else if (gangPrefix && gangPrefix.trim() !== "" && !/^\d+$/.test(gangPrefix.trim())) {
            // [ALIGNMENT] Only add broad LIKE filter if it's NOT a numeric Group
            // Numeric groups (asistensi) are handled by the memory filter later.
            detailQuery += ` AND d.gang_code LIKE ?`;
            detailParams.push(`${gangPrefix.trim()}%`);
        } else if (divisionCode && divisionCode !== "ALL") {
            // Jika gang ALL tapi divisi spesifik, pastikan kita hanya fetch pegawai dari divisi tersebut
            // Use unified mapping for consistent division handling
            const allPossibleDivs = new Set<string>();
            try {
                // Get all aliases using unified mapping
                const aliases = gangService.getAllDivisionAliases(divisionCode);
                aliases.forEach(a => allPossibleDivs.add(a));
                // Also get from source divisions
                const sourceDivs = await divisionDefinition.getSourceDivisionsForAggregation(divisionCode);
                for (const sd of sourceDivs) {
                    allPossibleDivs.add(sd);
                    const srcAliases = gangService.getAllDivisionAliases(sd);
                    srcAliases.forEach(a => allPossibleDivs.add(a));
                }
            } catch { /* fallback to original logic */ }
            const divList = Array.from(allPossibleDivs);
            const placeholders = divList.map(() => '?').join(',');
            detailQuery += ` AND (division_code IN (${placeholders}) OR loc_code IN (${placeholders}))`;
            detailParams.push(...divList, ...divList);
        }

        detailQuery += ` ORDER BY ISNULL(d.snapshot_version, 0) DESC, d.id DESC`;

        debug(CATEGORY, `detailQuery: ${detailQuery}`, detailParams);
        const rawDetails = await db.query<any>(detailQuery, detailParams);
        
        // Mitigation: Filter out duplicate employees (Strict unique by NIK/EmpCode)
        const uniqueDetailsMap = new Map<string, any>();
        for (const d of rawDetails) {
            const key = (d.nik || d.emp_code || '').trim().toUpperCase();
            if (!key) continue;

            // [ALIGNMENT] Handle "Group" filtering in memory to match DataExtractorService logic
            if (gangPrefix && gangPrefix.trim() !== "" && d.gang_code) {
                const prefix = gangPrefix.trim();
                const isNumeric = /^\d+$/.test(prefix);
                const gc = (d.gang_code || '').trim().toUpperCase();
                let matches = false;
                if (isNumeric) {
                    const asistensi = gc.startsWith('K2') ? '1' : (gc.match(/\d+/)?.[0] ?? null);
                    matches = asistensi === prefix;
                } else {
                    matches = gc.startsWith(prefix.toUpperCase());
                }
                if (!matches) continue;
            }

            if (!uniqueDetailsMap.has(key)) {
                uniqueDetailsMap.set(key, d);
            }
        }
        const details = Array.from(uniqueDetailsMap.values());
        debug(CATEGORY, `History Detail Fetch for ${divisionCode}/${gangCode}: Raw=${rawDetails.length}, Unique=${details.length}`);

        // Filter details if it's a virtual division or real division needing exclusion
        let finalDetails = details;
        if (divisionCode && gangCode === "ALL") {
            const isVirtual = divisionDefinition.isVirtualDivision(divisionCode);
            if (isVirtual) {
                const virtualGangs = await divisionDefinition.getGangsForDivision(divisionCode, false);
                const virtualGangCodes = new Set(virtualGangs.map(g => g.gang_code.toUpperCase()));
                const filtered = details.filter((d: any) => virtualGangCodes.has(d.gang_code?.trim()?.toUpperCase()));
                debug(CATEGORY, `Virtual Division Filter (${divisionCode}): Reduced ${details.length} to ${filtered.length} rows.`);
                finalDetails = filtered.length > 0 ? filtered : details;
            } else {
                // REAL division: exclude gangs that belong to virtual divisions with exclude_from_source=true
                const filtered = [];
                for (const d of details) {
                    const gCode = d.gang_code?.trim()?.toUpperCase() || "";
                    const lCode = d.loc_code?.trim()?.toUpperCase() || d.division_code?.trim()?.toUpperCase() || "";
                    const desc = d.gang_description?.trim() || d.task_desc?.trim() || "";
                    
                    let virtDiv = divisionDefinition.getVirtualDivisionForGang(gCode, lCode, desc);
                    
                    // Fallback: if not found by strict loc_code + pattern, check by pattern only for exclusions
                    if (!virtDiv) {
                        virtDiv = divisionDefinition.getVirtualDivisionByPatternOnly(gCode, desc);
                    }

                    if (virtDiv) {
                        const config = divisionDefinition.getVirtualDivisionConfig(virtDiv);
                        if (config?.exclude_from_source) {
                            // This gang belongs to a virtual division that should be excluded from its source
                            continue;
                        }
                    }
                    filtered.push(d);
                }
                finalDetails = filtered;
            }
        }

        const empCodesForHr = finalDetails.map((d: any) => d.emp_code?.trim()).filter(Boolean);
        const hrDataMap = await employeeHrDataService.getHrDataBulk(empCodesForHr);

        // Fetch religion from history_hr_employee if available
        const religionHistoryMap = new Map<string, string>();
        if (empCodesForHr.length > 0) {
            try {
                // CHUNK to avoid SQL Server 2100 parameter limit
                const REL_CHUNK = 500;
                for (let ri = 0; ri < empCodesForHr.length; ri += REL_CHUNK) {
                    const chunk = empCodesForHr.slice(ri, ri + REL_CHUNK);
                    const placeholders = chunk.map(() => '?').join(',');
                    const relRows = await db.query<{ emp_code: string, religion: string }>(`
                        SELECT RTRIM(emp_code) as emp_code, religion 
                        FROM dbo.history_hr_employee 
                        WHERE period_month = ? AND period_year = ? AND RTRIM(emp_code) IN (${placeholders})
                    `, [periodMonth, periodYear, ...chunk]);
                    relRows.forEach(r => religionHistoryMap.set(r.emp_code.trim().toUpperCase(), r.religion));
                }
            } catch (e) {
                logError(CATEGORY, "Error fetching religion from history_hr_employee", e);
            }
        }

        const historyTaxIdentityMap = await this.getHistoryTaxIdentityByEmpCodes(periodMonth, periodYear, empCodesForHr);

        // Fetch live HR_EMPLOYEE data for address, type, actual_nik
        const hrEmployeeMap = new Map<string, any>();
        if (empCodesForHr.length > 0) {
            try {
                const liveDb = Database.getInstance(); // Default live db holds HR_EMPLOYEE
                // CHUNK to avoid SQL Server 2100 parameter limit
                const HR_CHUNK = 500;
                for (let hi = 0; hi < empCodesForHr.length; hi += HR_CHUNK) {
                    const chunk = empCodesForHr.slice(hi, hi + HR_CHUNK);
                    const placeholders = chunk.map(() => '?').join(',');
                    const liveHrRows = await liveDb.query<any>(`
                        SELECT RTRIM(EmpCode) as emp_code, ResAddress as res_address, HREmpType as hr_emp_type, NewICNo as actual_nik, Religion
                        FROM dbo.HR_EMPLOYEE
                        WHERE RTRIM(EmpCode) IN (${placeholders})
                    `, chunk);

                    liveHrRows.forEach(row => {
                        hrEmployeeMap.set(row.emp_code, row);
                    });
                }
            } catch (e) {
                logError(CATEGORY, "Error fetching live HR_EMPLOYEE data", e);
            }
        }

        const normalizePremiHeader = (key: string): string => {
            const normalized = key.trim().replace(/\s+/g, "_").toUpperCase();
            return normalized.startsWith("PREMI_") ? normalized : `PREMI_${normalized}`;
        };

        const normalizePotonganHeader = (key: string): string => {
            const normalized = key.trim().replace(/\s+/g, "_").toUpperCase();
            if (normalized.startsWith("KOREKSI")) return normalized;
            return normalized.startsWith("POTONGAN_") ? normalized : `POTONGAN_${normalized}`;
        };

        const shouldTrackPremiHeader = (normalizedKey: string): boolean => {
            return normalizedKey !== "PREMI_BRONDOL" && normalizedKey !== "PREMI_KOREKSI";
        };

        const data_rows = sortByEmpCode(finalDetails.map(d => {
            const empCodeClean = d.emp_code?.trim().toUpperCase() || "";
            const hrOverride = hrDataMap.get(empCodeClean);
            const liveHr = hrEmployeeMap.get(empCodeClean);
            const historyTaxIdentity = historyTaxIdentityMap.get(empCodeClean);
            const histReligion = religionHistoryMap.get(empCodeClean);

            const reportIdentity = resolveReportIdentity({
                nik: d.nik,
                actual_nik: liveHr?.actual_nik,
                pajak_npwp: hrOverride?.npwp,
                res_address: liveHr?.res_address
            }, historyTaxIdentity);
            const finalReligion = historyTaxIdentity?.religion || histReligion || liveHr?.Religion || "01 Islam";

            const gCodeTrimmed = (d.gang_code || '').trim();
            const locCodeTrimmed = (d.loc_code || d.division_code || '').trim();
            const descTrimmed = (d.gang_description || d.task_desc || '').trim();

            const resolvedLocCode = divisionDefinition.getVirtualDivisionForGang(gCodeTrimmed, locCodeTrimmed, descTrimmed) || locCodeTrimmed;

            const row: any = {
                nik: reportIdentity.nik,
                new_nik: reportIdentity.new_nik,
                actual_nik: reportIdentity.actual_nik,
                pajak_npwp: reportIdentity.npwp,
                religion: finalReligion,
                res_address: reportIdentity.alamat,
                alamat: reportIdentity.alamat, // Map res_address to alamat for frontend
                hr_emp_type: liveHr?.hr_emp_type?.trim() || "",
                nama: d.emp_name,
                emp_code: d.emp_code,
                jenis_kelamin: d.gender,
                status_ptkp: d.status_ptkp,
                kategori_ter: d.kategori_ter,
                loc_code: resolvedLocCode,
                gang_code: gCodeTrimmed,
                division_code: resolvedLocCode,
                upah_dasar: parseFloat(d.upah_dasar) || 0,
                jumlah_hk: parseFloat(d.jumlah_hk) || 0,
                total_jam_kerja: parseFloat(d.total_jam_kerja) || 0,
                hari_kerja: parseFloat(d.hari_kerja) || 0,
                gaji_pokok: parseFloat(d.gaji_pokok) || 0,
                gaji_pokok_ideal: parseFloat(d.gaji_pokok_ideal) || 0,
                gaji_pokok_aktual: parseFloat(d.gaji_pokok_aktual) || 0,
                koreksi_hk: parseFloat(d.koreksi_hk) || 0,
                cuti_tahunan_hari: parseFloat(d.cuti_tahunan_hari) || 0,
                cuti_sakit_haid_hari: parseFloat(d.cuti_sakit_haid_hari) || 0,
                cuti_minggu_hari: parseFloat(d.cuti_minggu_hari) || 0,
                cuti_nasional_hari: parseFloat(d.cuti_nasional_hari) || 0,
                task_code: d.task_code,
                task_desc: d.task_desc,
                gang_description: d.gang_description,
                beras_rate: parseFloat(d.beras_rate) || 0,
                beras_jumlah: parseFloat(d.beras_jumlah) || 0,
                jabatan_rate: parseFloat(d.jabatan_rate) || 0,
                jabatan_jumlah: parseFloat(d.jabatan_jumlah) || 0,
                masa_kerja_tahun: parseFloat(d.masa_kerja_tahun) || 0,
                masa_kerja_rate: parseFloat(d.masa_kerja_rate) || 0,
                masa_kerja_jumlah: parseFloat(d.masa_kerja_jumlah) || 0,
                lembur_jam: parseFloat(d.lembur_jam) || 0,
                lembur_rate: parseFloat(d.lembur_rate) || 0,
                lembur_jumlah: parseFloat(d.lembur_jumlah) || 0,
                lembur_records: d.lembur_records ? JSON.parse(d.lembur_records) : [],
                total_tunjangan: parseFloat(d.total_tunjangan) || 0,
                premi_brondol: parseFloat(d.premi_brondol) || 0,
                premi_pph: parseFloat(d.premi_pph) || 0,
                total_premi: parseFloat(d.total_premi) || 0,
                pot_koreksi: parseFloat(d.pot_koreksi) || 0,
                pot_spsi: parseFloat(d.pot_spsi) || 0,
                pot_pph21: parseFloat(d.pot_pph21) || 0,
                pot_bpjs_kesehatan_pekerja: parseFloat(d.pot_bpjs_kesehatan_pekerja) || 0,
                pot_bpjs_kesehatan_majikan: parseFloat(d.pot_bpjs_kesehatan_majikan) || 0,
                pot_bpjs_pensiun_pekerja: parseFloat(d.pot_bpjs_pensiun_pekerja) || 0,
                pot_bpjs_pensiun_majikan: parseFloat(d.pot_bpjs_pensiun_majikan) || 0,
                pot_bpjs_pekerja_total: parseFloat(d.pot_bpjs_pekerja_total) || 0,
                pot_astek: parseFloat(d.pot_astek_pekerja) || 0,
                pot_astek_maj: parseFloat(d.pot_astek_majikan) || 0,
                total_potongan: parseFloat(d.total_potongan) || 0,
                total_potongan_bersih: parseFloat(d.total_potongan_bersih) || 0,
                jumlah_upah_kotor: parseFloat(d.jumlah_upah_kotor) || 0,
                upah_kotor_pajak: parseFloat(d.upah_kotor_pajak) || 0,
                penghasilan_bruto: parseFloat(d.penghasilan_bruto) || 0,
                tarif_pajak_ter: parseFloat(d.tarif_pajak_ter) || 0,
                pph21_ter: parseFloat(d.pph21_ter) || 0,
                upah_bersih: parseFloat(d.upah_bersih) || 0,
                shortage_details: d.shortage_details ? JSON.parse(d.shortage_details) : undefined,
                shortage_total_hours: parseFloat(d.shortage_total_hours) || 0,
                jabatan: (d.jabatan || '').trim(),
                is_spsi_member: d.is_spsi_member ?? ((d.pot_spsi || 0) > 0)
            };

            // Dynamic fields
            try {
                if (d.premi_detail) {
                    const pd = JSON.parse(d.premi_detail);
                    Object.keys(pd).forEach(k => {
                        row[k] = parseFloat(pd[k]) || 0;
                        const normalizedKey = normalizePremiHeader(k);
                        if (shouldTrackPremiHeader(normalizedKey)) {
                            dynamicPremiSet.add(normalizedKey);
                        }
                    });
                }
                if (d.potongan_detail) {
                    const pd = JSON.parse(d.potongan_detail);
                    Object.keys(pd).forEach(k => {
                        row[k] = parseFloat(pd[k]) || 0;
                        dynamicPotonganSet.add(normalizePotonganHeader(k));
                    });
                }
            } catch (e) { }

            return row;
        }));

        const premiTitles: Record<string, string> = {};
        dynamicPremiSet.forEach(k => premiTitles[k] = k.replace('PREMI_', '').replace(/_/g, ' '));

        const potonganTitles: Record<string, string> = {};
        dynamicPotonganSet.forEach(k => potonganTitles[k] = k.replace('POTONGAN_', '').replace(/_/g, ' '));

        return {
            data_rows,
            dynamic_premi_headers: Array.from(dynamicPremiSet),
            dynamic_potongan_headers: Array.from(dynamicPotonganSet),
            premi_title_map: premiTitles,
            potongan_title_map: potonganTitles,
            meta: {
                execution_time_ms: Date.now() - startTime,
                row_count: data_rows.length,
                is_history_snapshot: true
            }
        };
    }

    /**
     * Delete payroll history details by master_id (for re-insert)
     */
    public async deletePayrollHistoryDetails(masterId: number): Promise<void> {
        const db = this.getPayrollDatabase();

        await db.query(`
            DELETE FROM dbo.payroll_history_detail
            WHERE master_id = ?
        `, [masterId]);
    }

    /**
     * Delete all history data for a specific period and location
     * Used to prevent duplicates when re-seeding
     */
    public async deleteHistoryForPeriodAndLocation(periodMonth: number, periodYear: number, divisionCode?: string, gangCode?: string): Promise<void> {
        const payrollDb = this.getPayrollDatabase();
        const transDb = this.getTransactionDatabase();

        info(CATEGORY, `Deleting history for ${periodMonth} / ${periodYear}, Div: ${divisionCode || 'ALL'}, Gang: ${gangCode || 'ALL'} `);

        // 1. Delete Employee & Gang HR history
        let hrEmployeeSql = `DELETE FROM dbo.history_hr_employee WHERE period_month = ? AND period_year = ? `;
        let hrGangSql = `DELETE FROM dbo.history_hr_gang WHERE period_month = ? AND period_year = ? `;
        const hrParams: any[] = [periodMonth, periodYear];

        if (divisionCode) {
            hrEmployeeSql += ` AND loc_code = ? `;
            hrGangSql += ` AND loc_code = ? `;
            hrParams.push(divisionCode);
        }
        if (gangCode && gangCode !== 'ALL') {
            hrEmployeeSql += ` AND gang_code = ? `;
            hrGangSql += ` AND gang_code = ? `;
            hrParams.push(gangCode);
        }

        await payrollDb.query(hrEmployeeSql, hrParams);
        await payrollDb.query(hrGangSql, hrParams);

        // 2. Find matching headers to delete detail and transactions
        let findHeadersSql = `SELECT id, history_id FROM dbo.payroll_history_header WHERE period_month = ? AND period_year = ? `;
        const headerParams: any[] = [periodMonth, periodYear];

        if (divisionCode && divisionCode !== 'ALL') {
            // Use ONLY the exact division code passed - do NOT use aliases for DELETE
            // Aliases are for matching incoming data, not for deleting
            // Using aliases causes unrelated divisions' data to be deleted
            findHeadersSql += ` AND division_code = ?`;
            headerParams.push(divisionCode);
        }
        if (gangCode && gangCode !== 'ALL') {
            findHeadersSql += ` AND gang_code = ? `;
            headerParams.push(gangCode);
        }

        const headers = await payrollDb.query<{ id: number, history_id: string }>(findHeadersSql, headerParams);

        if (headers.length > 0) {
            const masterIds = headers.map(h => h.id);
            const historyIds = headers.map(h => `'${h.history_id}'`);

            // Delete Details
            const masterIdsStr = masterIds.join(',');
            await payrollDb.query(`DELETE FROM dbo.payroll_history_detail WHERE master_id IN(${masterIdsStr})`);

            // Delete Headers
            await payrollDb.query(`DELETE FROM dbo.payroll_history_header WHERE id IN(${masterIdsStr})`);

            // Delete Transactions
            if (historyIds.length > 0) {
                const historyIdsStr = historyIds.join(',');
                await transDb.query(`DELETE FROM dbo.history_taskreg WHERE history_id IN(${historyIdsStr})`);
                await transDb.query(`DELETE FROM dbo.history_adtrans WHERE history_id IN(${historyIdsStr})`);
                await transDb.query(`DELETE FROM dbo.history_gang_member WHERE history_id IN(${historyIdsStr})`);
            }
        }
    }

    // ============================================================================
    // TRANSACTION HISTORY OPERATIONS
    // ============================================================================

    /**
     * Insert taskreg history
     */
    public async saveTaskregHistory(data: HistoryTaskreg): Promise<number> {
        const db = this.getTransactionDatabase();

        const existing = await db.queryOne<{ id: number }>(`
            SELECT id FROM dbo.history_taskreg
            WHERE original_master_id = ? AND original_line_id = ? AND period_month = ? AND period_year = ?
        `, [data.original_master_id, data.original_line_id, data.period_month, data.period_year]);

        if (existing) {
            await db.query(`
                UPDATE dbo.history_taskreg SET
                    history_id = ?, reg_no = ?, reg_date = ?, emp_code = ?, gang_code = ?, division_code = ?,
                    trx_date = ?, task_code = ?, task_desc = ?, hours = ?, ot = ?, rate = ?, amount = ?,
                    tapping_type = ?, location_code = ?, status = ?, is_cuti_tahunan = ?, is_cuti_sakit = ?,
                    is_cuti_minggu = ?, is_cuti_nasional = ?, is_hari_kerja = ?, is_lembur = ?, source_table = ?
                WHERE id = ?
            `, [
                data.history_id, data.reg_no, data.reg_date, data.emp_code, data.gang_code, data.division_code,
                data.trx_date, data.task_code, data.task_desc, data.hours, data.ot, data.rate, data.amount,
                data.tapping_type, data.location_code, data.status, data.is_cuti_tahunan, data.is_cuti_sakit,
                data.is_cuti_minggu, data.is_cuti_nasional, data.is_hari_kerja, data.is_lembur, data.source_table,
                existing.id
            ]);
            return existing.id;
        } else {
            const result = await db.query(`
                INSERT INTO dbo.history_taskreg(
                    history_id, original_master_id, reg_no, reg_date, emp_code, gang_code, division_code,
                    original_line_id, line_no, trx_date, task_code, task_desc, hours, ot, rate, amount,
                    tapping_type, location_code, status, is_cuti_tahunan, is_cuti_sakit, is_cuti_minggu,
                    is_cuti_nasional, is_hari_kerja, is_lembur, period_month, period_year, source_table
                ) OUTPUT INSERTED.id VALUES(
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            `, [
                data.history_id, data.original_master_id, data.reg_no, data.reg_date, data.emp_code,
                data.gang_code, data.division_code, data.original_line_id, data.line_no, data.trx_date,
                data.task_code, data.task_desc, data.hours, data.ot, data.rate, data.amount,
                data.tapping_type, data.location_code, data.status, data.is_cuti_tahunan,
                data.is_cuti_sakit, data.is_cuti_minggu, data.is_cuti_nasional, data.is_hari_kerja,
                data.is_lembur, data.period_month, data.period_year, data.source_table
            ]);

            return result[0]?.id;
        }
    }

    /**
     * Insert adtrans history
     */
    public async saveAdtransHistory(data: HistoryAdtrans): Promise<number> {
        const db = this.getTransactionDatabase();

        const existing = await db.queryOne<{ id: number }>(`
            SELECT id FROM dbo.history_adtrans
            WHERE original_master_id = ? AND original_line_id = ? AND period_month = ? AND period_year = ?
        `, [data.original_master_id, data.original_line_id, data.period_month, data.period_year]);

        if (existing) {
            await db.query(`
                UPDATE dbo.history_adtrans SET
                    history_id = ?, doc_no = ?, doc_date = ?, doc_desc = ?, emp_code = ?, gang_code = ?,
                    division_code = ?, line_no = ?, task_code = ?, task_desc = ?, amount = ?, quantity = ?,
                    uom = ?, category = ?, sub_category = ?, is_dynamic = ?, dynamic_header_name = ?,
                    is_premi_pph = ?, is_koreksi = ?, is_potongan = ?, is_premi = ?, source_table = ?
                WHERE id = ?
            `, [
                data.history_id, data.doc_no, data.doc_date, data.doc_desc, data.emp_code, data.gang_code,
                data.division_code, data.line_no, data.task_code, data.task_desc, data.amount, data.quantity,
                data.uom, data.category, data.sub_category, data.is_dynamic, data.dynamic_header_name,
                data.is_premi_pph, data.is_koreksi, data.is_potongan, data.is_premi, data.source_table,
                existing.id
            ]);
            return existing.id;
        } else {
            const result = await db.query(`
                INSERT INTO dbo.history_adtrans(
                    history_id, original_master_id, doc_no, doc_date, doc_desc, emp_code, gang_code,
                    division_code, original_line_id, line_no, task_code, task_desc, amount, quantity,
                    uom, category, sub_category, is_dynamic, dynamic_header_name, is_premi_pph,
                    is_koreksi, is_potongan, is_premi, period_month, period_year, source_table
                ) OUTPUT INSERTED.id VALUES(
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            `, [
                data.history_id, data.original_master_id, data.doc_no, data.doc_date, data.doc_desc,
                data.emp_code, data.gang_code, data.division_code, data.original_line_id, data.line_no,
                data.task_code, data.task_desc, data.amount, data.quantity, data.uom, data.category,
                data.sub_category, data.is_dynamic, data.dynamic_header_name, data.is_premi_pph,
                data.is_koreksi, data.is_potongan, data.is_premi, data.period_month, data.period_year,
                data.source_table
            ]);

            return result[0]?.id;
        }
    }

    /**
     * Ambil nilai PPH21 aktual dari history_adtrans per emp_code per bulan untuk satu tahun.
     * Mengambil record dengan category='POTONGAN', sub_category='PPH21', is_premi_pph=false.
     * Return: Map<emp_code, Map<month, pph_amount>>
     */
    public async getPphFromAdtransByYear(
        year: number,
        divisionCode?: string,
        gangCode?: string
    ): Promise<Map<string, Map<number, number>>> {
        const db = this.getTransactionDatabase();

        let sql = `
            SELECT emp_code, period_month, SUM(amount) as pph_amount
            FROM dbo.history_adtrans
            WHERE period_year = ?
              AND category = 'POTONGAN'
              AND sub_category = 'PPH21'
              AND is_premi_pph = 0
        `;
        const params: any[] = [year];

        if (divisionCode && divisionCode !== 'ALL') {
            sql += ` AND (division_code = ? OR gang_code IN (
                SELECT gang_code FROM dbo.history_gang_member
                WHERE period_year = ? AND division_code = ?
            ))`;
            params.push(divisionCode, year, divisionCode);
        }

        if (gangCode && gangCode !== 'ALL') {
            sql += ` AND gang_code = ?`;
            params.push(gangCode);
        }

        sql += ` GROUP BY emp_code, period_month`;

        try {
            const rows = await db.query<{ emp_code: string; period_month: number; pph_amount: number }>(sql, params);

            const result = new Map<string, Map<number, number>>();
            for (const row of rows) {
                const empCode = (row.emp_code || '').trim();
                if (!result.has(empCode)) {
                    result.set(empCode, new Map<number, number>());
                }
                result.get(empCode)!.set(Number(row.period_month), Number(row.pph_amount) || 0);
            }
            return result;
        } catch (e: any) {
            console.error('[HistoryDB] getPphFromAdtransByYear error:', e.message);
            return new Map();
        }
    }

    /**
     * Ambil nilai PPH21 aktual dari history_adtrans untuk satu bulan spesifik.
     * Return: Map<emp_code, pph_amount>
     */
    public async getPphFromAdtransByMonth(
        month: number,
        year: number,
        divisionCode?: string,
        gangCode?: string
    ): Promise<Map<string, number>> {
        const yearMap = await this.getPphFromAdtransByYear(year, divisionCode, gangCode);
        const result = new Map<string, number>();
        for (const [empCode, monthMap] of yearMap) {
            if (monthMap.has(month)) {
                result.set(empCode, monthMap.get(month)!);
            }
        }
        return result;
    }



    /**
     * Insert gang member history
     */
    public async saveGangMemberHistory(data: HistoryGangMember): Promise<number> {
        const db = this.getTransactionDatabase();

        const existing = await db.queryOne<{ id: number }>(`
            SELECT id FROM dbo.history_gang_member
            WHERE emp_code = ? AND period_month = ? AND period_year = ?
        `, [data.emp_code, data.period_month, data.period_year]);

        if (existing) {
            await db.query(`
                UPDATE dbo.history_gang_member SET
                    history_id = ?, gang_code = ?, gang_description = ?, division_code = ?, loc_code = ?,
                    emp_name = ?, join_date = ?, is_active = ?, source_table = ?
                WHERE id = ?
            `, [
                data.history_id, data.gang_code, data.gang_description, data.division_code, data.loc_code,
                data.emp_name, data.join_date, data.is_active, data.source_table,
                existing.id
            ]);
            return existing.id;
        } else {
            const result = await db.query(`
                INSERT INTO dbo.history_gang_member(
                    history_id, gang_code, gang_description, division_code, loc_code, emp_code,
                    emp_name, jabatan, join_date, is_active, period_month, period_year, source_table
                ) OUTPUT INSERTED.id VALUES(
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
            `, [
                data.history_id, data.gang_code, data.gang_description, data.division_code,
                data.loc_code, data.emp_code, data.emp_name, data.jabatan || null,
                data.join_date, data.is_active, data.period_month, data.period_year, data.source_table
            ]);

            return result[0]?.id;
        }
    }

    /**
     * Delete transaction history by history_id
     */
    public async deleteTransactionHistory(historyId: string): Promise<void> {
        const db = this.getTransactionDatabase();

        await db.query(`DELETE FROM dbo.history_taskreg WHERE history_id = ? `, [historyId]);
        await db.query(`DELETE FROM dbo.history_adtrans WHERE history_id = ? `, [historyId]);
        await db.query(`DELETE FROM dbo.history_gang_member WHERE history_id = ? `, [historyId]);
    }

    // ============================================================================
    // HR HISTORY OPERATIONS
    // ============================================================================

    /**
     * Insert HR Employee history.
     *
     * IMPORTANT: DATA APPEND-ONLY PATTERN (Immutable History)
     * - Selalu INSERT record baru. TIDAK pernah UPDATE record existing.
     * - NIK TIDAK PERNAH di-update. Jika NIK berubah di source (db_ptrj),
     *   simpan NIK baru di kolom `new_nik`, JANGAN overwrite kolom `nik`.
     * - NIK lama (kolom `nik`) adalah ground truth dan TIDAK AKAN PERNAH berubah.
     *
     * Constraint: UNIQUE(emp_code, period_month, period_year) diperlukan
     * untuk mencegah duplikat. Jika constraint belum ada, seeding berulang
     * pada periode yang sama akan menyebabkan constraint violation (harus di-drop
     * terlebih dahulu atau gunakan ON CONFLICT).
     */
    public async saveHrEmployeeHistory(data: HistoryHrEmployee): Promise<number> {
        const db = this.getPayrollDatabase(); // HR history goes to extend_db_ptrj

        let schemaHasNewNik = true;
        let existing: { id: number; nik: string; new_nik?: string } | null = null;

        try {
            existing = await db.queryOne<{ id: number; nik: string; new_nik: string }>(`
                SELECT id, nik, new_nik FROM dbo.history_hr_employee
                WHERE emp_code = ? AND period_month = ? AND period_year = ?
            `, [data.emp_code, data.period_month, data.period_year]);
        } catch (e: any) {
            if (!this.isMissingColumnError(e, "new_nik")) {
                throw e;
            }

            schemaHasNewNik = false;
            existing = await db.queryOne<{ id: number; nik: string }>(`
                SELECT id, nik FROM dbo.history_hr_employee
                WHERE emp_code = ? AND period_month = ? AND period_year = ?
            `, [data.emp_code, data.period_month, data.period_year]);
        }

        let resolvedNewNik: string | undefined = undefined;

        if (schemaHasNewNik && existing) {
            // NIK source berbeda dari NIK lama yang tersimpan → tracking di new_nik
            // NIK lama TIDAK PERNAH diubah
            if (data.nik && existing.nik && data.nik !== existing.nik) {
                resolvedNewNik = data.nik;
            } else if (data.nik) {
                resolvedNewNik = data.nik;
            }
        } else if (schemaHasNewNik) {
            resolvedNewNik = data.new_nik;
        }

        const columns = [
            "history_id", "period_month", "period_year", "nik",
            ...(schemaHasNewNik ? ["new_nik"] : []),
            "pajak_npwp", "res_address",
            "emp_code", "emp_name",
            "company_code", "division_code", "loc_code", "gang_code", "job_code", "position",
            "jabatan", "is_spsi_member",
            "join_date", "terminate_date", "status", "employee_type", "gender", "religion",
            "birth_place", "birth_date", "marital_status",
            "tax_status", "ptkp_beras", "ptkp_pajak",
            "upah_dasar", "total_hk", "source_table"
        ];
        const values = [
            data.history_id, data.period_month, data.period_year,
            existing ? existing.nik : data.nik,  // JANGAN overwrite NIK lama
            ...(schemaHasNewNik ? [resolvedNewNik] : []),
            data.pajak_npwp?.trim() || null,
            data.res_address?.trim() || null,
            data.emp_code,
            data.emp_name, data.company_code, data.division_code, data.loc_code, data.gang_code,
            data.job_code, data.position,
            data.jabatan, data.is_spsi_member ?? null,
            data.join_date, data.terminate_date, data.status,
            data.employee_type, data.gender, data.religion,
            data.birth_place, data.birth_date, data.marital_status,
            data.tax_status, data.ptkp_beras, data.ptkp_pajak,
            data.upah_dasar, data.total_hk, data.source_table
        ];

        // Always INSERT - append-only pattern
        const result = await db.query(`
            INSERT INTO dbo.history_hr_employee(
                ${columns.join(", ")}
            ) OUTPUT INSERTED.id VALUES(
                ${columns.map(() => "?").join(", ")}
            )
        `, values);

        return result[0]?.id;
    }

    private isMissingColumnError(error: unknown, columnName: string): boolean {
        const message = error instanceof Error ? error.message : String(error || "");
        return message.toLowerCase().includes("invalid column name") && message.toLowerCase().includes(columnName.toLowerCase());
    }

    /**
     * Insert HR Gang history
     */
    /**
     * Insert HR Gang history.
     *
     * IMPORTANT: DATA APPEND-ONLY PATTERN (Immutable History)
     * - Selalu INSERT record baru. TIDAK pernah UPDATE record existing.
     * - Gang history dicatat per periode untuk tracking perubahan komposisi.
     */
    public async saveHrGangHistory(data: HistoryHrGang): Promise<number> {
        const db = this.getPayrollDatabase(); // HR history goes to extend_db_ptrj

        // Always INSERT - append-only pattern
        const result = await db.query(`
            INSERT INTO dbo.history_hr_gang(
                history_id, period_month, period_year, division_code, loc_code,
                gang_code, gang_description, mandor_code, mandor_name, mandor_1_code,
                mandor_1_name, assistant_code, assistant_name, total_members, is_active, source_table
            ) OUTPUT INSERTED.id VALUES(
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
        `, [
            data.history_id, data.period_month, data.period_year, data.division_code, data.loc_code,
            data.gang_code, data.gang_description, data.mandor_code, data.mandor_name,
            data.mandor_1_code, data.mandor_1_name, data.assistant_code, data.assistant_name,
            data.total_members, data.is_active, data.source_table
        ]);

        return result[0]?.id;
    }

    // ============================================================================
    // METADATA OPERATIONS
    // ============================================================================

    /**
     * Insert history metadata for audit trail
     */
    public async saveHistoryMetadata(data: HistoryMetadata): Promise<number> {
        const db = this.getTransactionDatabase();

        const result = await db.query(`
            INSERT INTO dbo.history_metadata(
                            history_id, operation, entity_type, entity_id, period_month, period_year,
                            division_code, gang_code, description, old_values, new_values, record_count,
                            status, error_message, performed_by, ip_address, user_agent, session_id
                        ) OUTPUT INSERTED.id VALUES(
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                        )
                            `, [
            data.history_id, data.operation, data.entity_type, data.entity_id, data.period_month,
            data.period_year, data.division_code, data.gang_code, data.description, data.old_values,
            data.new_values, data.record_count, data.status || 'SUCCESS', data.error_message,
            data.performed_by, data.ip_address, data.user_agent, data.session_id
        ]);

        return result[0]?.id;
    }

    /**
     * Get history metadata by history_id
     */
    public async getHistoryMetadata(historyId: string): Promise<HistoryMetadata[]> {
        const db = this.getTransactionDatabase();

        return await db.query<HistoryMetadata>(`
        SELECT * FROM dbo.history_metadata
            WHERE history_id = ?
            ORDER BY performed_at DESC
                `, [historyId]);
    }

    // ============================================================================
    // EMPLOYEE HR INFO SPECIFIC
    // ============================================================================

    /**
     * Get aggregated historical data for a specific employee across all seeded periods
     */
    public async getEmployeeHistoricalData(empCode: string): Promise<any> {
        const db = this.getPayrollDatabase(); // history is in extend_db_ptrj

        let careerUrl = `
            SELECT
                period_month,
                period_year,
                emp_code,
                emp_name,
                nik,
                new_nik,
                division_code,
                loc_code,
                gang_code,
                job_code,
                position,
                status,
                employee_type,
                upah_dasar,
                tax_status,
                ptkp_beras,
                ptkp_pajak,
                total_hk,
                join_date,
                terminate_date
            FROM dbo.history_hr_employee
            WHERE RTRIM(emp_code) = ? OR RTRIM(nik) = ?
            ORDER BY period_year DESC, period_month DESC
        `;

        let payrollUrl = `
            SELECT 
                h.period_month, 
                h.period_year,
                d.*
            FROM dbo.payroll_history_detail d
            JOIN dbo.payroll_history_header h ON d.master_id = h.id
            WHERE RTRIM(d.emp_code) = ? OR RTRIM(d.nik) = ?
            ORDER BY h.period_year DESC, h.period_month DESC
        `;

        // Run both queries concurrently
        const [hrHistory, payrollHistory] = await Promise.all([
            db.query(careerUrl, [empCode, empCode]).catch((e) => {
                logError(CATEGORY, "Error fetching HR history:", e);
                return [];
            }),
            db.query(payrollUrl, [empCode, empCode]).catch((e) => {
                logError(CATEGORY, "Error fetching Payroll history:", e);
                return [];
            })
        ]);

        return {
            emp_code: empCode,
            career: hrHistory,
            payroll: payrollHistory
        };
    }

    // ============================================================================
    // MIGRATION OPERATIONS
    // ============================================================================

    /**
     * Migrate history tables to add new_nik column for NIK change tracking.
     * This is part of the append-only + NIK immutable pattern implementation.
     *
     * Run this once to add the new_nik column to existing tables.
     */
    public async migrateNewNikColumn(): Promise<void> {
        const db = this.getPayrollDatabase();
        const transDb = this.getTransactionDatabase();

        try {
            const ensureColumn = async (
                targetDb: Database,
                tableName: string,
                columnName: string,
                definition: string,
                label: string
            ) => {
                await targetDb.query(`
                    IF NOT EXISTS (
                        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_NAME='${tableName}' AND COLUMN_NAME='${columnName}'
                    )
                    BEGIN
                        ALTER TABLE dbo.${tableName} ADD ${columnName} ${definition};
                    END
                `);
                console.log(`[HistoryDatabaseService] Migrated: ${label}`);
            };

            // payroll_history_detail
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='new_nik')
                BEGIN
                    ALTER TABLE dbo.payroll_history_detail ADD new_nik VARCHAR(50) NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: payroll_history_detail.new_nik");

            // history_hr_employee
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='history_hr_employee' AND COLUMN_NAME='new_nik')
                BEGIN
                    ALTER TABLE dbo.history_hr_employee ADD new_nik VARCHAR(50) NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: history_hr_employee.new_nik");

            // history_gang_member - add jabatan column
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='history_gang_member' AND COLUMN_NAME='jabatan')
                BEGIN
                    ALTER TABLE dbo.history_gang_member ADD jabatan VARCHAR(100) NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: history_gang_member.jabatan");

            // payroll_history_detail - add jabatan column
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='jabatan')
                BEGIN
                    ALTER TABLE dbo.payroll_history_detail ADD jabatan VARCHAR(100) NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: payroll_history_detail.jabatan");

            // payroll_history_detail - add is_spsi_member column
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='payroll_history_detail' AND COLUMN_NAME='is_spsi_member')
                BEGIN
                    ALTER TABLE dbo.payroll_history_detail ADD is_spsi_member BIT NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: payroll_history_detail.is_spsi_member");

            // history_hr_employee - add columns for jabatan and is_spsi_member
            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='history_hr_employee' AND COLUMN_NAME='jabatan')
                BEGIN
                    ALTER TABLE dbo.history_hr_employee ADD jabatan VARCHAR(100) NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: history_hr_employee.jabatan");

            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='history_hr_employee' AND COLUMN_NAME='is_spsi_member')
                BEGIN
                    ALTER TABLE dbo.history_hr_employee ADD is_spsi_member BIT NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: history_hr_employee.is_spsi_member");

            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='history_hr_employee' AND COLUMN_NAME='pajak_npwp')
                BEGIN
                    ALTER TABLE dbo.history_hr_employee ADD pajak_npwp VARCHAR(50) NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: history_hr_employee.pajak_npwp");

            await db.query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='history_hr_employee' AND COLUMN_NAME='res_address')
                BEGIN
                    ALTER TABLE dbo.history_hr_employee ADD res_address NVARCHAR(512) NULL;
                END
            `);
            console.log("[HistoryDatabaseService] Migrated: history_hr_employee.res_address");

            const payrollDetailColumns: Array<{ name: string; definition: string }> = [
                { name: "beras_rate", definition: "DECIMAL(18,4) NULL DEFAULT 0" },
                { name: "jabatan_rate", definition: "DECIMAL(18,4) NULL DEFAULT 0" },
                { name: "masa_kerja_rate", definition: "DECIMAL(18,4) NULL DEFAULT 0" },
                { name: "lembur_jam", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "lembur_rate", definition: "DECIMAL(18,4) NULL DEFAULT 0" },
                { name: "lembur_records", definition: "NVARCHAR(MAX) NULL" },
                { name: "total_tunjangan", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "premi_brondol_loosefruit", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "premi_brondol_adtrans", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "premi_brondol_total", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "premi_pph", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "premi_detail", definition: "NVARCHAR(MAX) NULL" },
                { name: "pot_astek_pekerja", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "pot_astek_majikan", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "pot_astek_jumlah", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "potongan_detail", definition: "NVARCHAR(MAX) NULL" },
                { name: "upah_kotor_pajak", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "penghasilan_bruto", definition: "DECIMAL(18,2) NULL DEFAULT 0" },
                { name: "task_code", definition: "VARCHAR(20) NULL" },
                { name: "task_desc", definition: "NVARCHAR(100) NULL" },
                { name: "shortage_details", definition: "NVARCHAR(MAX) NULL" },
                { name: "shortage_total_hours", definition: "DECIMAL(18,2) NULL" },
                { name: "snapshot_batch_id", definition: "BIGINT NULL" },
                { name: "snapshot_version", definition: "INT NULL" }
            ];

            for (const column of payrollDetailColumns) {
                await ensureColumn(
                    db,
                    "payroll_history_detail",
                    column.name,
                    column.definition,
                    `payroll_history_detail.${column.name}`
                );
            }

            await ensureColumn(
                db,
                "payroll_history_header",
                "snapshot_batch_id",
                "BIGINT NULL",
                "payroll_history_header.snapshot_batch_id"
            );

            await ensureColumn(
                db,
                "payroll_history_header",
                "snapshot_version",
                "INT NULL",
                "payroll_history_header.snapshot_version"
            );

            const historyMetadataColumns: Array<{ name: string; definition: string }> = [
                { name: "operation", definition: "VARCHAR(20) NULL" },
                { name: "entity_type", definition: "VARCHAR(30) NULL" },
                { name: "entity_id", definition: "INT NULL" },
                { name: "gang_code", definition: "VARCHAR(20) NULL" },
                { name: "description", definition: "NVARCHAR(255) NULL" },
                { name: "old_values", definition: "NVARCHAR(MAX) NULL" },
                { name: "new_values", definition: "NVARCHAR(MAX) NULL" },
                { name: "record_count", definition: "INT NULL" },
                { name: "status", definition: "VARCHAR(20) NULL" },
                { name: "error_message", definition: "NVARCHAR(MAX) NULL" },
                { name: "performed_by", definition: "VARCHAR(100) NULL" },
                { name: "performed_at", definition: "DATETIME NULL DEFAULT GETDATE()" },
                { name: "ip_address", definition: "VARCHAR(50) NULL" },
                { name: "user_agent", definition: "NVARCHAR(255) NULL" },
                { name: "session_id", definition: "VARCHAR(100) NULL" }
            ];

            for (const column of historyMetadataColumns) {
                await ensureColumn(
                    transDb,
                    "history_metadata",
                    column.name,
                    column.definition,
                    `history_metadata.${column.name}`
                );
            }

            console.log("[HistoryDatabaseService] All migrations completed successfully");
        } catch (e: any) {
            console.error("[HistoryDatabaseService] Migration failed:", e.message);
            throw e;
        }
    }
}

export const historyDatabaseService = HistoryDatabaseService.getInstance();
