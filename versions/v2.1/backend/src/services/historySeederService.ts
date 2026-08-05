/**
 * History Seeder Service
 * 
 * Handles the process of seeding history data from the real-time database
 * to the history database (extend_db_ptrj and extend_db_ptrj_transaksi).
 */

import { Database } from "../db/client";
import { Config } from "../config";
import { 
    historyDatabaseService, PayrollHistoryMaster, PayrollHistoryDetail, 
    HistoryTaskreg, HistoryAdtrans, HistoryGangMember, HistoryMetadata, 
    HistoryHrEmployee, HistoryHrGang 
} from "./historyDatabaseService";
import { dataExtractorService } from "./dataExtractorService";
import { gangService } from "./gangService";
import { divisionConfigService } from "./config/DivisionConfigService";
import { employeeGangHistoryService } from "./employeeGangHistoryService";
import { duplicateNikMitigationService } from "./DuplicateNikMitigationService";
import { resolveHistorySeederCleanupPolicy } from "../utils/historySeederCleanup";
import { payrollSnapshotBatchService } from "./payrollSnapshotBatchService";
import { payrollProfileSeedService } from "./payrollProfileSeedService";
import { calculatePayrollTotals, reconcileGangTotalsToGrandTotal } from "./payrollTotalsCalculator";
import { debug, error as logError } from "../utils/logger";
import { processInBatches } from "../utils/batchProcessor";
import type { EmployeeProfileOverrideRow } from "../types/payroll/payrollOverlay";
import { normalizeEffectiveStartDate } from "../utils/payrollProfileRules";
import { normalizeManualAdjustmentDivisionCode } from "./payroll/manualAdjustments/manualAdjustmentNaming";

const CATEGORY = "HistorySeeder";

export interface SeederResult {
    success: boolean;
    history_id: string;
    period_month: number;
    period_year: number;
    division_code: string;
    gang_code: string;
    total_employees: number;
    records_inserted: {
        master: number;
        detail: number;
        taskreg: number;
        adtrans: number;
        gang_member: number;
        hr_employee?: number;
        hr_gang?: number;
    };
    errors: string[];
}

export interface SeederOptions {
    periodMonth: number;
    periodYear: number;
    divisionCode?: string;
    gangCode?: string;
    createdBy: string;
    ipAddress?: string;
    userAgent?: string;
    force?: boolean;
    seederMode?: 'ALL' | 'PAYROLL' | 'PAYROLL_ONLY' | 'EMPLOYEE_HR' | 'GANG_HR' | 'ALL_HR';
}

export interface SeederProgress {
    is_running: boolean;
    current_step: string;
    current_division?: string;
    current_gang?: string;
    period?: string;
    gangs_total: number;
    gangs_done: number;
    employees_processed: number;
    started_at?: string;
    last_update?: string;
}

export class HistorySeederService {
    private static instance: HistorySeederService;
    private static progress: SeederProgress = {
        is_running: false, current_step: 'idle', gangs_total: 0, gangs_done: 0, employees_processed: 0
    };

    private static readonly MAX_RUN_TIME_MS = 30 * 60 * 1000; // 30 mins
    private static startTime: number | null = null;

    private constructor() {}

    public static getInstance(): HistorySeederService {
        if (!HistorySeederService.instance) HistorySeederService.instance = new HistorySeederService();
        return HistorySeederService.instance;
    }

    public static getProgress(): SeederProgress {
        if (HistorySeederService.progress.is_running && HistorySeederService.startTime) {
            if (Date.now() - HistorySeederService.startTime > HistorySeederService.MAX_RUN_TIME_MS) {
                HistorySeederService.forceReset('Stuck timeout - auto reset');
            }
        }
        return { ...HistorySeederService.progress };
    }

    private static updateProgress(update: Partial<SeederProgress>) {
        Object.assign(HistorySeederService.progress, update, { last_update: new Date().toISOString() });
    }

    public static forceReset(reason: string = 'Manual reset') {
        console.warn(`[HistorySeeder] Force reset triggered: ${reason}`);
        HistorySeederService.progress = { is_running: false, current_step: `idle (Reset: ${reason})`, gangs_total: 0, gangs_done: 0, employees_processed: 0 };
        HistorySeederService.startTime = null;
    }

    /**
     * Main entry point for seeding payroll history.
     */
    public async seedPayrollHistory(options: SeederOptions): Promise<SeederResult> {
        const result: SeederResult = {
            success: false, history_id: '',
            period_month: options.periodMonth, period_year: options.periodYear,
            division_code: options.divisionCode || 'ALL', gang_code: options.gangCode || 'ALL',
            total_employees: 0,
            records_inserted: { master: 0, detail: 0, taskreg: 0, adtrans: 0, gang_member: 0 },
            errors: []
        };

        debug(CATEGORY, `Starting payroll history seeding for ${options.divisionCode || 'ALL'} period ${options.periodMonth}/${options.periodYear}`);

        try {
            await this.cleanupAggregationHistory(options, result);

            HistorySeederService.startTime = Date.now();
            HistorySeederService.updateProgress({
                is_running: true, current_step: 'Memulai seeding...',
                period: `${options.periodMonth}/${options.periodYear}`,
                current_division: options.divisionCode || 'ALL',
                gangs_total: 0, gangs_done: 0, employees_processed: 0,
                started_at: new Date().toISOString()
            });

            const historyId = historyDatabaseService.generateHistoryId();
            result.history_id = historyId;

            const seederMode = options.seederMode || 'PAYROLL';

            if (seederMode === 'ALL' || seederMode === 'PAYROLL') {
                const payrollData = await this.fetchPayrollDataForSeeder(options, result);
                if (payrollData && payrollData.length > 0) {
                    await this.seedGangs(historyId, payrollData, options, result);
                    HistorySeederService.updateProgress({ current_step: 'Menyimpan data transaksi...' });
                    await this.seedTransactions(historyId, options, result);
                }
            }

            if (seederMode === 'ALL' || seederMode.includes('HR')) {
                await this.seedHrData(historyId, options, result);
            }

            result.success = result.errors.length === 0;
            HistorySeederService.updateProgress({ is_running: false, current_step: result.success ? '✅ Seeding selesai!' : `⚠️ Seeding selesai dengan ${result.errors.length} error` });
            return result;
        } catch (error: any) {
            logError(CATEGORY, `seedPayrollHistory critical failure: ${error.message}`);
            HistorySeederService.updateProgress({ is_running: false, current_step: `❌ Error: ${error.message}` });
            result.errors.push(`Critical failure: ${error.message}`);
            return result;
        }
    }

    private async cleanupAggregationHistory(options: SeederOptions, result: SeederResult): Promise<void> {
        const cleanupPolicy = resolveHistorySeederCleanupPolicy(options);
        if (!cleanupPolicy.shouldDeleteAggregationHistory) return;

        try {
            const deleteHistoryDb = Database.getExtendedInstance();
            const whereClauses = ["period_month = ?", "period_year = ?", "division_code = ?"];
            const params = [options.periodMonth, options.periodYear, options.divisionCode];
            if (options.gangCode && options.gangCode !== "ALL") {
                whereClauses.push("gang_code = ?");
                params.push(options.gangCode);
            }
            await deleteHistoryDb.query(`DELETE FROM dbo.daftar_upah_aggregation_history WHERE ${whereClauses.join(" AND ")}`, params);
        } catch (e: any) {
            result.errors.push(`Aggregation cleanup failed: ${e.message}`);
        }
    }

    private async fetchPayrollDataForSeeder(options: SeederOptions, result: SeederResult): Promise<any[]> {
        HistorySeederService.updateProgress({ current_step: 'Mengambil data payroll live...' });
        try {
            return await this.fetchPayrollData(options);
        } catch (e: any) {
            result.errors.push(`Fetch payroll data failed: ${e.message}`);
            return [];
        }
    }

    private async seedGangs(historyId: string, payrollData: any[], options: SeederOptions, result: SeederResult): Promise<void> {
        HistorySeederService.updateProgress({ gangs_total: payrollData.length });
        await processInBatches({
            items: payrollData, batchSize: 1, label: "HistorySeeder.seedGangs",
            processFn: async (batch, gi) => {
                const gangData = batch[0];
                HistorySeederService.updateProgress({
                    current_step: `Menyimpan gang ${gangData.gang_code || '?'} (${gi + 1}/${payrollData.length})`,
                    current_gang: gangData.gang_code, gangs_done: gi, employees_processed: result.total_employees
                });
                await this.seedGangHistory(historyId, gangData, options, result);
            }
        });
    }

    private async seedTransactions(historyId: string, options: SeederOptions, result: SeederResult): Promise<void> {
        const TX_TIMEOUT_MS = 5 * 60 * 1000;
        try {
            await Promise.race([
                this.seedTransactionData(historyId, options, result),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction seeding timeout')), TX_TIMEOUT_MS))
            ]);
        } catch (e: any) {
            result.errors.push(`Transaction seeding issue: ${e.message}`);
        }
        await this.seedGangMemberData(historyId, options, result);
    }

    private async seedHrData(historyId: string, options: SeederOptions, result: SeederResult): Promise<void> {
        const seederMode = options.seederMode || 'PAYROLL';
        if (seederMode === 'ALL' || seederMode === 'ALL_HR' || seederMode === 'EMPLOYEE_HR') {
            HistorySeederService.updateProgress({ current_step: 'Menyimpan data HR Karyawan...' });
            await this.seedEmployeeHrHistory(historyId, options, result);
        }
        if (seederMode === 'ALL' || seederMode === 'ALL_HR' || seederMode === 'GANG_HR') {
            HistorySeederService.updateProgress({ current_step: 'Menyimpan data HR Gang...' });
            await this.seedGangHrHistory(historyId, options, result);
        }
        await this.saveSeederMetadata(historyId, options, result);
    }

    /**
     * CORE LOGIC METHODS (Migrated from original with minimal changes to preserve functionality)
     */

    private async withRetry<T>(fn: () => Promise<T>, context: string, maxRetries: number = 3): Promise<T> {
        let lastError: any;
        for (let i = 1; i <= maxRetries; i++) {
            try { return await fn(); } catch (e: any) {
                lastError = e;
                if ((e.message?.includes('timeout') || e.message?.includes('500')) && i < maxRetries) {
                    await new Promise(r => setTimeout(r, i * 2000));
                } else throw e;
            }
        }
        throw lastError;
    }

    private async fetchPayrollData(options: SeederOptions): Promise<any[]> {
        const rows = await this.withRetry(
            () => this.fetchPayrollRowsFromProgressiveSource(options),
            'extractPayrollDataProgressive'
        );

        const virtualGangCodes = new Set(['AMC', 'HMC', 'B2N', 'IN', 'INT']);
        const isSeedingVirtual = divisionConfigService.isVirtualDivision(options.divisionCode || '');
        const gangMap = new Map<string, any[]>();

        for (const row of rows) {
            const gc = row.gang_code?.trim().toUpperCase() || '';
            if (!isSeedingVirtual && virtualGangCodes.has(gc)) continue;
            if (!gangMap.has(gc)) gangMap.set(gc, []);
            gangMap.get(gc)!.push(row);
        }

        const gangEntries = Array.from(gangMap.entries()).map(([gang_code, employees]) => ({
            gang_code,
            employees,
            division_code: this.resolveGangDivisionCode(options, { gang_code }, employees)
        }));
        const totalsKey = (divisionCode: string, gangCode: string) => `${divisionCode}::${gangCode}`;
        const reconciledPayrollTotalsByGang = new Map<string, ReturnType<typeof calculatePayrollTotals>>();
        const entriesByDivision = new Map<string, typeof gangEntries>();

        for (const entry of gangEntries) {
            if (!entriesByDivision.has(entry.division_code)) entriesByDivision.set(entry.division_code, []);
            entriesByDivision.get(entry.division_code)!.push(entry);
        }

        for (const entries of entriesByDivision.values()) {
            const gangPayrollTotals = entries.map((entry) =>
                calculatePayrollTotals(entry.employees, `TOTAL ${entry.gang_code}`)
            );
            const grandPayrollTotals = calculatePayrollTotals(
                entries.flatMap((entry) => entry.employees),
                "GRAND TOTAL"
            );
            const reconciledPayrollTotals = reconcileGangTotalsToGrandTotal(gangPayrollTotals, grandPayrollTotals);

            entries.forEach((entry, index) => {
                reconciledPayrollTotalsByGang.set(
                    totalsKey(entry.division_code, entry.gang_code),
                    reconciledPayrollTotals[index] || gangPayrollTotals[index]
                );
            });
        }

        return gangEntries.map(({ gang_code, employees, division_code }) => ({
            gang_code,
            employees,
            division_code,
            payroll_totals: reconciledPayrollTotalsByGang.get(totalsKey(division_code, gang_code)) || calculatePayrollTotals(employees, `TOTAL ${gang_code}`)
        }));
    }

    private async fetchPayrollRowsFromProgressiveSource(options: SeederOptions): Promise<any[]> {
        const progressiveStream = dataExtractorService.extractPayrollDataProgressive(
            options.periodMonth,
            options.periodYear,
            options.gangCode || 'ALL',
            options.divisionCode,
            Config.DB_PROFILE,
            undefined,
            false
        );

        let completeRows: any[] = [];
        for await (const chunk of progressiveStream) {
            if (chunk.phase !== 'complete') continue;
            completeRows = Array.from(chunk.gangs.values()).flat();
        }

        return completeRows;
    }

    private async seedGangHistory(historyId: string, gangData: any, options: SeederOptions, result: SeederResult): Promise<void> {
        const employees = gangData.employees;
        if (!employees?.length) return;

        const resolvedDivisionCode = this.resolveGangDivisionCode(options, gangData, employees);
        const totals = this.calculateTotals(employees, gangData.payroll_totals);
        const dynamicPremiHeaders = this.collectDynamicPremiHeaders(employees);
        const dynamicPotonganHeaders = this.collectDynamicPotonganHeaders(employees);
        const snapshotBatch = await payrollSnapshotBatchService.createNextBatch({
            period_month: options.periodMonth, period_year: options.periodYear,
            division_code: resolvedDivisionCode, gang_code: gangData.gang_code,
            created_by: options.createdBy
        });

        const masterId = await historyDatabaseService.savePayrollHistoryMaster({
            history_id: historyId, snapshot_batch_id: snapshotBatch.id, snapshot_version: snapshotBatch.snapshot_version,
            period_month: options.periodMonth, period_year: options.periodYear,
            division_code: resolvedDivisionCode, gang_code: gangData.gang_code,
            gang_description: gangData.gang_code, total_employees: employees.length,
            ...totals,
            dynamic_premi_data: dynamicPremiHeaders.length > 0 ? JSON.stringify(dynamicPremiHeaders) : undefined,
            dynamic_potongan_data: dynamicPotonganHeaders.length > 0 ? JSON.stringify(dynamicPotonganHeaders) : undefined,
            created_by: options.createdBy, source_endpoint: '/api/history/seed', is_locked: false
        });

        result.records_inserted.master++;
        for (const emp of employees) {
            await this.handleDuplicateNikSeeding(historyId, masterId, emp, options, result, resolvedDivisionCode, {
                snapshot_batch_id: snapshotBatch.id, snapshot_version: snapshotBatch.snapshot_version
            });
        }
    }

    private resolveGangDivisionCode(options: SeederOptions, gangData: any, employees: any[]): string {
        const scopedDivision = options.divisionCode?.trim();
        if (scopedDivision && scopedDivision.toUpperCase() !== "ALL") {
            return normalizeManualAdjustmentDivisionCode(scopedDivision) || scopedDivision.toUpperCase();
        }

        const gangCandidate = [gangData?.division_code, gangData?.loc_code]
            .find((value) => typeof value === "string" && value.trim().length > 0);
        if (gangCandidate) {
            const normalized = normalizeManualAdjustmentDivisionCode(String(gangCandidate));
            return normalized || String(gangCandidate).trim().toUpperCase();
        }

        for (const employee of employees) {
            const employeeCandidate = [employee?.division_code, employee?.loc_code]
                .find((value) => typeof value === "string" && value.trim().length > 0);
            if (employeeCandidate) {
                const normalized = normalizeManualAdjustmentDivisionCode(String(employeeCandidate));
                return normalized || String(employeeCandidate).trim().toUpperCase();
            }
        }

        return "ALL";
    }

    private calculateTotals(employees: any[], payrollTotalsOverride?: any): any {
        const daftarUpahTotals = payrollTotalsOverride || calculatePayrollTotals(employees, "TOTAL");
        const sum = (field: string): number => Math.round(
            employees.reduce((total, emp) => total + (Number(emp?.[field]) || 0), 0)
        );

        return {
            total_hk: daftarUpahTotals.jumlah_hk,
            total_hari_kerja: daftarUpahTotals.hari_kerja,
            total_cuti_tahunan: daftarUpahTotals.cuti_tahunan_hari,
            total_cuti_sakit: daftarUpahTotals.cuti_sakit_haid_hari,
            total_cuti_minggu: daftarUpahTotals.cuti_minggu_hari,
            total_cuti_nasional: daftarUpahTotals.cuti_nasional_hari,
            total_upah_dasar: sum("upah_dasar"),
            total_upah_pokok: daftarUpahTotals.upah_pokok,
            total_gaji_pokok: daftarUpahTotals.gaji_pokok,
            total_beras: daftarUpahTotals.beras_jumlah,
            total_jabatan: daftarUpahTotals.jabatan_jumlah,
            total_masa_kerja: daftarUpahTotals.masa_kerja_jumlah,
            total_lembur: daftarUpahTotals.lembur_jumlah,
            total_tunjangan: daftarUpahTotals.total_tunjangan,
            total_premi_brondol: daftarUpahTotals.premi_brondol,
            total_premi: daftarUpahTotals.total_premi,
            total_premi_prunning: daftarUpahTotals.premi_pruning || sum("premi_prunning"),
            total_premi_insentif: sum("premi_insentif"),
            total_premi_kinerja: sum("premi_kinerja"),
            total_koreksi: daftarUpahTotals.pot_koreksi,
            total_potongan: daftarUpahTotals.total_potongan,
            // Must match Daftar Upah and aggregation seeder: display/report PPH uses
            // the actual deduction field, not the calculated TER comparison value.
            total_pph21: daftarUpahTotals.pot_pph21,
            total_bpjs_pekerja: daftarUpahTotals.pot_bpjs_pekerja_total,
            total_bpjs_majikan: daftarUpahTotals.pot_bpjs_kesehatan_majikan + daftarUpahTotals.pot_bpjs_pensiun_majikan,
            total_spsi: daftarUpahTotals.pot_spsi,
            total_upah_kotor: daftarUpahTotals.jumlah_upah_kotor,
            total_upah_bersih: daftarUpahTotals.upah_bersih
        };
    }

    private normalizeDynamicHeader(prefix: 'PREMI' | 'POTONGAN', key: string): string {
        const normalized = key.trim().replace(/\s+/g, '_').toUpperCase();
        if (!normalized) return '';
        if (prefix === 'POTONGAN' && normalized.startsWith('KOREKSI')) return normalized;
        return normalized.startsWith(`${prefix}_`) ? normalized : `${prefix}_${normalized}`;
    }

    private collectDynamicPremiHeaders(employees: any[]): string[] {
        const headers = new Set<string>();
        for (const emp of employees) {
            if (emp.premi && typeof emp.premi === 'object') {
                for (const key of Object.keys(emp.premi)) {
                    const normalized = this.normalizeDynamicHeader('PREMI', key);
                    if (!normalized || normalized === 'PREMI_BRONDOL' || normalized === 'PREMI_KOREKSI') continue;
                    headers.add(normalized);
                }
            }

            for (const key of Object.keys(emp)) {
                const upperKey = key.trim().toUpperCase();
                if (upperKey.startsWith('PREMI_') && !['PREMI_BRONDOL', 'PREMI_KOREKSI'].includes(upperKey)) {
                    headers.add(upperKey);
                }
            }
        }
        return Array.from(headers).sort();
    }

    private collectDynamicPotonganHeaders(employees: any[]): string[] {
        const headers = new Set<string>();
        for (const emp of employees) {
            if (emp.potongan && typeof emp.potongan === 'object') {
                for (const key of Object.keys(emp.potongan)) {
                    const normalized = this.normalizeDynamicHeader('POTONGAN', key);
                    if (!normalized) continue;
                    headers.add(normalized);
                }
            }

            for (const key of Object.keys(emp)) {
                const upperKey = key.trim().toUpperCase();
                if (upperKey.startsWith('POTONGAN_') || upperKey.startsWith('KOREKSI')) {
                    headers.add(upperKey);
                }
            }
        }
        return Array.from(headers).sort();
    }

    private async handleDuplicateNikSeeding(historyId: string, masterId: number, emp: any, options: SeederOptions, result: SeederResult, divisionCode?: string, snapshotMeta?: any): Promise<void> {
        if (!emp?.nik) return;
        try {
            const hasDuplicate = await duplicateNikMitigationService.hasDuplicate(emp.nik);
            if (hasDuplicate) {
                const map = await duplicateNikMitigationService.getAllEmpCodesForNik(emp.nik);
                for (const ec of map.emp_codes) {
                    await historyDatabaseService.savePayrollHistoryDetail(this.mapEmployeeToDetail(historyId, masterId, { ...emp, emp_code: ec }, divisionCode, snapshotMeta));
                    result.records_inserted.detail++;
                }
                result.total_employees += map.emp_codes.length;
            } else {
                await historyDatabaseService.savePayrollHistoryDetail(this.mapEmployeeToDetail(historyId, masterId, emp, divisionCode, snapshotMeta));
                result.records_inserted.detail++;
                result.total_employees += 1;
            }
        } catch (e) {
            await historyDatabaseService.savePayrollHistoryDetail(this.mapEmployeeToDetail(historyId, masterId, emp, divisionCode, snapshotMeta));
            result.records_inserted.detail++;
            result.total_employees += 1;
        }
    }

    private mapEmployeeToDetail(historyId: string, masterId: number, emp: any, divisionCode?: string, snapshotMeta?: any): PayrollHistoryDetail {
        return {
            history_id: historyId, master_id: masterId,
            snapshot_batch_id: snapshotMeta?.snapshot_batch_id, snapshot_version: snapshotMeta?.snapshot_version,
            emp_code: emp.emp_code || emp.nik, emp_name: emp.nama || emp.emp_name, nik: emp.nik, gender: emp.jenis_kelamin || emp.gender,
            gang_code: emp.gang_code, division_code: divisionCode || emp.division_code || emp.loc_code, loc_code: emp.loc_code,
            status_ptkp: emp.status_ptkp, kategori_ter: emp.kategori_ter, hari_kerja: emp.hari_kerja || 0,
            cuti_tahunan_hari: emp.cuti_tahunan_hari || 0, cuti_sakit_haid_hari: emp.cuti_sakit_haid_hari || 0,
            cuti_minggu_hari: emp.cuti_minggu_hari || 0, cuti_nasional_hari: emp.cuti_nasional_hari || 0,
            jumlah_hk: emp.jumlah_hk || 0, total_jam_kerja: emp.total_jam_kerja || 0, upah_dasar: emp.upah_dasar || 0,
            upah_pokok: emp.upah_pokok || 0, gaji_pokok: emp.gaji_pokok || 0, gaji_pokok_ideal: emp.gaji_pokok_ideal || 0,
            gaji_pokok_aktual: emp.gaji_pokok_aktual || 0, koreksi_hk: emp.koreksi_hk || 0, beras_rate: emp.beras_rate || 0,
            beras_jumlah: emp.beras_jumlah || 0, jabatan_rate: emp.jabatan_rate || 0, jabatan_jumlah: emp.jabatan_jumlah || 0,
            masa_kerja_tahun: emp.masa_kerja_tahun || 0, masa_kerja_rate: emp.masa_kerja_rate || 0, masa_kerja_jumlah: emp.masa_kerja_jumlah || 0,
            lembur_jam: emp.lembur_jam || 0, lembur_rate: emp.lembur_rate || 0, lembur_jumlah: emp.lembur_jumlah || 0,
            lembur_records: emp.lembur_records ? JSON.stringify(emp.lembur_records) : undefined, total_tunjangan: emp.total_tunjangan || 0,
            premi_brondol: emp.premi_brondol || 0, premi_brondol_loosefruit: emp.premi_brondol_loosefruit || 0,
            premi_brondol_adtrans: emp.premi_brondol_adtrans || 0, premi_brondol_total: emp.premi_brondol_total || (emp.premi_brondol || 0),
            premi_pph: emp.premi_pph || 0, total_premi: emp.total_premi || 0, premi_detail: emp.premi ? JSON.stringify(emp.premi) : undefined,
            pot_spsi: emp.pot_spsi || 0, pot_pph21: emp.pot_pph21 || 0, pot_koreksi: emp.pot_koreksi || 0,
            pot_bpjs_kesehatan_pekerja: emp.pot_bpjs_kesehatan_pekerja || 0, pot_bpjs_kesehatan_majikan: emp.pot_bpjs_kesehatan_majikan || 0,
            pot_bpjs_pensiun_pekerja: emp.pot_bpjs_pensiun_pekerja || 0, pot_bpjs_pensiun_majikan: emp.pot_bpjs_pensiun_majikan || 0,
            pot_bpjs_pekerja_total: emp.pot_bpjs_pekerja_total || 0, pot_astek_pekerja: emp.pot_astek_pekerja || emp.pot_astek || 0,
            pot_astek_majikan: emp.pot_astek_majikan || emp.pot_astek_maj || 0, pot_astek_jumlah: emp.pot_astek_jumlah || 0,
            potongan_detail: this.extractDynamicPotonganDetail(emp), total_potongan: emp.total_potongan || 0,
            total_potongan_bersih: emp.total_potongan_bersih || 0, jumlah_upah_kotor: emp.jumlah_upah_kotor || 0,
            upah_kotor_pajak: emp.upah_kotor_pajak || 0, penghasilan_bruto: emp.penghasilan_bruto || 0,
            tarif_pajak_ter: emp.tarif_pajak_ter, pph21_ter: emp.pph21_ter || 0, upah_bersih: emp.upah_bersih || 0,
            task_code: emp.task_code, task_desc: emp.task_desc, shortage_total_hours: emp.shortage_total_hours,
            shortage_details: emp.shortage_details ? JSON.stringify(emp.shortage_details) : undefined,
            jabatan: emp.jabatan || emp.jabatan_estate || '',  // Job title from employee_estate or history_gang_member
            is_spsi_member: (emp.pot_spsi || 0) > 0,  // SPSI membership derived from pot_spsi > 0
        };
    }

    private extractDynamicPotonganDetail(emp: any): string | undefined {
        const data: any = {};
        for (const k of Object.keys(emp)) if ((k.startsWith('KOREKSI') || k.startsWith('POTONGAN_')) && typeof emp[k] === 'number' && emp[k] !== 0) data[k] = emp[k];
        return Object.keys(data).length > 0 ? JSON.stringify(data) : undefined;
    }

    private async seedTransactionData(historyId: string, options: SeederOptions, result: SeederResult): Promise<void> {
        const dbSource = Database.getInstance();
        const start = `${options.periodYear}-${options.periodMonth.toString().padStart(2, '0')}-01`;
        const end = options.periodMonth === 12 ? `${options.periodYear + 1}-01-01` : `${options.periodYear}-${(options.periodMonth + 1).toString().padStart(2, '0')}-01`;
        
        const empCodes = await this.getEmployeeCodes(options);
        if (!empCodes.length) return;

        const CHUNK = 100;
        for (let i = 0; i < empCodes.length; i += CHUNK) {
            const chunk = empCodes.slice(i, i + CHUNK);
            const empList = chunk.map(e => `'${e}'`).join(',');
            
            const taskregRows = await dbSource.query<any>(`
                SELECT tr.ID as master_id, tr.DocID as RegNo, tr.DocDate as RegDate, trl.ID as line_id, trl.EmpCode, trl.TrxDate, trl.TaskCode, trl.Hours, trl.OT, trl.Rate, trl.Amount
                FROM PR_TASKREGLN trl JOIN PR_TASKREG tr ON tr.ID = trl.MasterID
                WHERE trl.EmpCode IN (${empList}) AND trl.TrxDate >= '${start}' AND trl.TrxDate < '${end}'
                UNION ALL
                SELECT tr.ID as master_id, tr.DocID as RegNo, tr.DocDate as RegDate, trl.ID as line_id, trl.EmpCode, trl.TrxDate, trl.TaskCode, trl.Hours, trl.OT, trl.Rate, trl.Amount
                FROM PR_TASKREGLN_ARC trl JOIN PR_TASKREG_ARC tr ON tr.ID = trl.MasterID
                WHERE trl.EmpCode IN (${empList}) AND trl.TrxDate >= '${start}' AND trl.TrxDate < '${end}'
            `);

            for (const r of taskregRows) {
                await historyDatabaseService.saveTaskregHistory({
                    history_id: historyId, original_master_id: r.master_id, reg_no: r.RegNo, reg_date: r.RegDate,
                    emp_code: r.EmpCode?.trim(), original_line_id: r.line_id, trx_date: r.TrxDate, task_code: r.TaskCode?.trim(),
                    hours: r.Hours || 0, ot: !!r.OT, rate: r.Rate, amount: r.Amount || 0, tapping_type: '',
                    is_cuti_tahunan: false, is_cuti_sakit: false, is_cuti_minggu: false, is_cuti_nasional: false, is_hari_kerja: true, is_lembur: !!r.OT,
                    period_month: options.periodMonth, period_year: options.periodYear, source_table: r.master_id > 1000000000 ? 'PR_TASKREG_ARC' : 'PR_TASKREG'
                });
                result.records_inserted.taskreg++;
            }

            const adtransRows = await dbSource.query<any>(`
                SELECT t.ID as master_id, t.DocID as DocNo, t.DocDate, t.DocDesc, t.EmpCode, ln.ID as line_id, ln.TaskCode, mt.TaskDesc, ln.Amount
                FROM PR_ADTRANS t JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID LEFT JOIN PR_TASKCODE mt ON ln.TaskCode = mt.TaskCode
                WHERE t.EmpCode IN (${empList}) AND t.DocDate >= '${start}' AND t.DocDate < '${end}'
                  AND t.Status IN (1, 3)
                UNION ALL
                SELECT t.ID as master_id, t.DocID as DocNo, t.DocDate, t.DocDesc, t.EmpCode, ln.ID as line_id, ln.TaskCode, mt.TaskDesc, ln.Amount
                FROM PR_ADTRANS_ARC t JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID LEFT JOIN PR_TASKCODE mt ON ln.TaskCode = mt.TaskCode
                WHERE t.EmpCode IN (${empList}) AND t.DocDate >= '${start}' AND t.DocDate < '${end}'
                  AND t.Status = 3
            `);

            for (const r of adtransRows) {
                const dd = (r.DocDesc || '').toUpperCase();
                const td = (r.TaskDesc || '').toUpperCase();
                let cat = 'OTHER', sub: string | undefined;
                if (dd.includes('PREMI') || dd.includes('PRUN') || dd.includes('INSENTIF') || dd.includes('PANEN') || dd.includes('KINERJA')) {
                    cat = 'PREMI';
                    if (dd.includes('BRONDOL')) sub = 'BRONDOL';
                    else if (dd.includes('PRUN')) sub = 'PRUNING';
                    else if (dd.includes('INSENTIF')) sub = 'INSENTIF';
                    else if (dd.includes('KINERJA')) sub = 'KINERJA';
                } else if (dd.includes('BERAS') || dd.includes('JABATAN') || dd.includes('MASA KERJA') || dd.includes('LEMBUR')) {
                    cat = 'TUNJANGAN';
                    if (dd.includes('BERAS')) sub = 'BERAS';
                    else if (dd.includes('JABATAN')) sub = 'JABATAN';
                    else if (dd.includes('MASA')) sub = 'MASA_KERJA';
                    else if (dd.includes('LEMBUR')) sub = 'LEMBUR';
                } else if (dd.includes('KOREKSI') || dd.includes('POT') || dd.includes('PPH') || dd.includes('SPSI') || dd.includes('BPJS')) {
                    cat = 'POTONGAN';
                    if (dd.includes('KOREKSI')) sub = 'KOREKSI';
                    else if (dd.includes('PPH')) sub = 'PPH21';
                    else if (dd.includes('SPSI')) sub = 'SPSI';
                    else if (dd.includes('BPJS')) sub = 'BPJS';
                }

                await historyDatabaseService.saveAdtransHistory({
                    history_id: historyId, original_master_id: r.master_id, doc_no: r.DocNo?.trim(), doc_date: r.DocDate, doc_desc: r.DocDesc?.trim(),
                    emp_code: r.EmpCode?.trim(), original_line_id: r.line_id, task_code: r.TaskCode?.trim(), task_desc: r.TaskDesc?.trim(),
                    amount: r.Amount || 0, uom: '', category: cat, sub_category: sub, is_dynamic: false, is_premi_pph: td.includes('ACCRUALS-CHECKROLL'),
                    is_koreksi: dd.includes('KOREKSI'), is_potongan: dd.includes('POT') || dd.includes('POTONGAN'), is_premi: dd.includes('PREMI'),
                    period_month: options.periodMonth, period_year: options.periodYear, source_table: r.master_id > 1000000000 ? 'PR_ADTRANS_ARC' : 'PR_ADTRANS'
                });
                result.records_inserted.adtrans++;
            }
        }
    }

    private async seedGangMemberData(historyId: string, options: SeederOptions, result: SeederResult): Promise<void> {
        const db = Database.getInstance();
        try {
            let sql = `SELECT g.GangCode, g.Description as GangDesc, g.LocCode, gl.GangMember as EmpCode, e.EmpName, em.AppJoinGrpDate, e.NewICNo FROM HR_GANG g JOIN HR_GANGLN gl ON g.GangCode = gl.GangCode JOIN HR_EMPLOYEE e ON gl.GangMember = e.EmpCode LEFT JOIN HR_EMPLOYMENT em ON e.EmpCode = em.EmpCode WHERE 1=1`;
            const params: any[] = [];
            if (options.divisionCode && options.divisionCode !== 'ALL') {
                const codes = gangService.getAllDivisionAliases(options.divisionCode);
                sql += ` AND g.LocCode IN (${codes.map(() => '?').join(',')})`;
                params.push(...codes);
            }
            if (options.gangCode && options.gangCode !== 'ALL') { sql += ` AND g.GangCode = ?`; params.push(options.gangCode); }
            const members = await db.query<any>(sql, params);
            const latestEmpCodeMap = await employeeGangHistoryService.resolveLatestEmpCodes(members.map((r: any) => r.NewICNo?.trim()).filter(Boolean));
            for (const r of members) {
                const nik = r.NewICNo?.trim().toUpperCase() || "";
                const scopedDivision = options.divisionCode?.trim();
                const divisionCode = scopedDivision && scopedDivision.toUpperCase() !== "ALL"
                    ? scopedDivision
                    : (r.LocCode?.trim() || "ALL");
                await historyDatabaseService.saveGangMemberHistory({
                    history_id: historyId, gang_code: r.GangCode?.trim(), gang_description: r.GangDesc?.trim(), division_code: divisionCode,
                    loc_code: r.LocCode?.trim(), emp_code: (latestEmpCodeMap.get(nik) || r.EmpCode)?.trim(), emp_name: r.EmpName?.trim(), nik: r.NewICNo?.trim(),
                    jabatan: '', period_month: options.periodMonth, period_year: options.periodYear, join_date: r.AppJoinGrpDate, is_active: true, source_table: 'HR_GANGLN'
                });
                result.records_inserted.gang_member++;
            }
        } catch (e: any) { result.errors.push(`Error seeding gang members: ${e.message}`); }
    }

    private async seedEmployeeHrHistory(historyId: string, options: SeederOptions, result: SeederResult): Promise<void> {
        const db = Database.getInstance();
        const extDb = Database.getExtendedInstance();
        try {
            HistorySeederService.updateProgress({ current_step: 'Mengambil data HR Karyawan...', employees_processed: 0 });
            let sql = `SELECT e.NewICNo as nik, e.EmpCode as emp_code, e.EmpName as emp_name, em.CompCode as company_code, g.LocCode as division_code, g.LocCode as loc_code, g.GangCode as gang_code, em.AppJoinGrpDate as join_date, em.TerminateDate as terminate_date, e.Status as status, e.HREmpType as employee_type, e.Gender as gender, e.Religion as religion, e.MaritalStatus as marital_status, e.PlaceOfBirth as birth_place, e.DOB as birth_date, e.ResAddress as res_address, hs.TaxNo as pajak_npwp, p.PayRate as upah_dasar, CAST(p.RiceRation AS VARCHAR) as ptkp_beras, ISNULL(hk.total_hk, 0) as total_hk FROM HR_EMPLOYEE e JOIN HR_EMPLOYMENT em ON e.EmpCode = em.EmpCode LEFT JOIN HR_GANGLN gl ON e.EmpCode = gl.GangMember LEFT JOIN HR_GANG g ON gl.GangCode = g.GangCode LEFT JOIN HR_PAYROLL p ON RTRIM(p.EmpCode) = RTRIM(e.EmpCode) LEFT JOIN HR_STATUTORY hs ON RTRIM(hs.EmpCode) = RTRIM(e.EmpCode) LEFT JOIN (SELECT hk.emp_code, SUM(hk.hours) / 7.0 as total_hk FROM (SELECT RTRIM(EmpCode) as emp_code, ISNULL(Hours, 0) as hours FROM PR_TASKREGLN WHERE MONTH(TrxDate) = ${options.periodMonth} AND YEAR(TrxDate) = ${options.periodYear} UNION ALL SELECT RTRIM(EmpCode) as emp_code, ISNULL(Hours, 0) as hours FROM PR_TASKREGLN_ARC WHERE MONTH(TrxDate) = ${options.periodMonth} AND YEAR(TrxDate) = ${options.periodYear}) hk GROUP BY hk.emp_code) hk ON hk.emp_code = RTRIM(e.EmpCode) WHERE 1=1`;
            const params: any[] = [];
            if (options.divisionCode && options.divisionCode !== 'ALL') {
                const codes = gangService.getAllDivisionAliases(options.divisionCode);
                sql += ` AND g.LocCode IN (${codes.map(() => '?').join(',')})`;
                params.push(...codes);
            }
            if (options.gangCode && options.gangCode !== 'ALL') { sql += ` AND g.GangCode = ?`; params.push(options.gangCode); }
            const emps = await db.query<any>(sql, params);
            const latestEmpCodeMap = await employeeGangHistoryService.resolveLatestEmpCodes(emps.map((r: any) => r.nik?.trim()).filter(Boolean));

            const empCodes = emps.map((r: any) => r.emp_code?.trim()).filter(Boolean);
            const jabatanMap = new Map<string, string>();
            const spsiMemberMap = new Map<string, boolean>();
            const periodStart = `${options.periodYear}-${options.periodMonth.toString().padStart(2, '0')}-01`;
            const periodEnd = options.periodMonth === 12
                ? `${options.periodYear + 1}-01-01`
                : `${options.periodYear}-${(options.periodMonth + 1).toString().padStart(2, '0')}-01`;

            if (empCodes.length > 0) {
                const CHUNK = 500;
                for (let i = 0; i < empCodes.length; i += CHUNK) {
                    const chunk = empCodes.slice(i, i + CHUNK);
                    const placeholders = chunk.map(() => '?').join(',');

                    const estateRows = await extDb.query<any>(
                        `SELECT empcode, jabatan FROM employee_estate WHERE RTRIM(empcode) IN (${placeholders}) AND jabatan IS NOT NULL AND RTRIM(jabatan) != ''`,
                        chunk
                    );

                    for (const row of estateRows) {
                        const empCode = row.empcode?.trim().toUpperCase();
                        if (empCode && !jabatanMap.has(empCode)) {
                            jabatanMap.set(empCode, row.jabatan?.trim());
                        }
                    }

                    const spsiRows = await db.query<any>(`
                        SELECT DISTINCT RTRIM(src.emp_code) as emp_code
                        FROM (
                            SELECT
                                t.EmpCode as emp_code,
                                t.DocDesc as doc_desc,
                                ln.TaskCode as task_code
                            FROM PR_ADTRANS t
                            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
                            WHERE RTRIM(t.EmpCode) IN (${placeholders})
                              AND t.DocDate >= ?
                              AND t.DocDate < ?
                              AND t.Status IN (1, 3)

                            UNION ALL

                            SELECT
                                t.EmpCode as emp_code,
                                t.DocDesc as doc_desc,
                                ln.TaskCode as task_code
                            FROM PR_ADTRANS_ARC t
                            JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                            WHERE RTRIM(t.EmpCode) IN (${placeholders})
                              AND t.DocDate >= ?
                              AND t.DocDate < ?
                              AND t.Status = 3
                        ) src
                        WHERE UPPER(ISNULL(src.doc_desc, '')) LIKE '%SPSI%'
                           OR ISNULL(src.task_code, '') LIKE 'GA9112%'
                    `, [...chunk, periodStart, periodEnd, ...chunk, periodStart, periodEnd]);

                    for (const row of spsiRows) {
                        const empCode = row.emp_code?.trim().toUpperCase();
                        if (empCode) {
                            spsiMemberMap.set(empCode, true);
                        }
                    }
                }
            }

            const spsiOverrides = await this.getProfileOverrides(empCodes);
            const priorSpsiMember = await this.getPriorSpsiMember(empCodes, options.periodMonth, options.periodYear);

            if (!result.records_inserted['hr_employee']) result.records_inserted['hr_employee'] = 0;
            HistorySeederService.updateProgress({ current_step: `Menyimpan data HR Karyawan... (0/${emps.length})`, employees_processed: 0 });
            let processed = 0;
            const shouldTrackHrAsTotalEmployees = result.total_employees === 0;

            await processInBatches({
                items: emps,
                batchSize: 100,
                label: "HistorySeeder.seedEmployeeHrHistory",
                processFn: async (batch) => {
                    for (const r of batch) {
                        const nik = r.nik?.trim().toUpperCase() || "";
                        const empCode = (latestEmpCodeMap.get(nik) || r.emp_code)?.trim().toUpperCase() || "";
                        const jabatan = (jabatanMap.get(empCode) || r.jabatan || "").trim();
                        const resolvedSpsi = this.resolveSpsiWithGuard(
                            empCode,
                            payrollProfileSeedService.resolveSpsiMember(empCode, spsiMemberMap, spsiOverrides),
                            spsiOverrides,
                            priorSpsiMember
                        );
                        const resolvedJoinDate = this.resolveJoinDate(empCode, spsiOverrides, r.join_date);

                        // Idempotensi: skip INSERT kalau row latest (emp_code, period) sudah punya
                        // is_spsi_member + join_date sama. Cegah duplicate re-seed nilai unchanged.
                        const skip = await this.shouldSkipHrEmployeeInsert(
                            empCode, options.periodMonth, options.periodYear, resolvedSpsi, resolvedJoinDate
                        );
                        if (skip) {
                            if (shouldTrackHrAsTotalEmployees) result.total_employees++;
                            processed++;
                            continue;
                        }

                        await historyDatabaseService.saveHrEmployeeHistory({
                            history_id: historyId, period_month: options.periodMonth, period_year: options.periodYear, nik: r.nik?.trim(), emp_code: empCode,
                            emp_name: r.emp_name?.trim(), company_code: r.company_code?.trim(), division_code: r.division_code?.trim(), loc_code: r.loc_code?.trim(),
                            gang_code: r.gang_code?.trim(), position: jabatan || null, jabatan, is_spsi_member: resolvedSpsi,
                            pajak_npwp: r.pajak_npwp?.trim(), res_address: r.res_address?.trim(),
                            join_date: resolvedJoinDate, terminate_date: r.terminate_date, status: r.status?.trim(), employee_type: r.employee_type?.trim(),
                            gender: r.gender?.trim(), religion: r.religion?.trim(), birth_place: r.birth_place?.trim(), birth_date: r.birth_date, marital_status: r.marital_status?.trim(),
                            ptkp_beras: r.ptkp_beras?.trim(), upah_dasar: r.upah_dasar ?? 0, total_hk: r.total_hk || 0, source_table: 'HR_EMPLOYEE_JOIN'
                        });
                        result.records_inserted['hr_employee']++;
                        if (shouldTrackHrAsTotalEmployees) result.total_employees++;
                        processed++;
                    }

                    HistorySeederService.updateProgress({
                        current_step: `Menyimpan data HR Karyawan... (${processed}/${emps.length})`,
                        employees_processed: processed
                    });
                }
            });
        } catch (e: any) { result.errors.push(`Error seeding Employee HR: ${e.message}`); }
    }

    private async getProfileOverrides(empCodes: string[]) {
        if (!empCodes.length) return new Map();

        const rows: any[] = [];
        const CHUNK = 500;
        for (let i = 0; i < empCodes.length; i += CHUNK) {
            const chunk = empCodes.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => "?").join(",");
            rows.push(...await Database.getExtendedInstance().query<any>(`
                SELECT emp_code, nik, is_spsi_member, effective_start_date, update_index
                FROM dbo.employee_profile_override_history
                WHERE emp_code IN (${placeholders})
                  AND is_active_record = 1
            `, chunk));
        }

        return payrollProfileSeedService.pickLatestProfileOverrides(rows);
    }

    /**
     * Guard forward-persistence (user rule): kalo karyawan pernah jadi SPSI member
     * di periode sebelumnya, periode sekarang harus tetap member — kecuali ada
     * override eksplisit is_spsi_member=false (user set keluar SPSI).
     * Sekali member -> member sampai override false atau terminate.
     */
    private resolveSpsiWithGuard(
        empCode: string,
        computed: boolean,
        overrides: Map<string, EmployeeProfileOverrideRow>,
        priorSpsiMember: Set<string>
    ): boolean {
        const override = overrides.get(empCode);
        if (override?.is_spsi_member === false || override?.is_spsi_member === 0) return false;
        if (override?.is_spsi_member === true || override?.is_spsi_member === 1) return true;
        if (computed) return true;
        return priorSpsiMember.has(empCode);
    }

    /**
     * Cari emp_code yang punya SPSI=true di history periode sebelum periode seeding.
     * Dipakai guard forward-persistence.
     */
    private async getPriorSpsiMember(empCodes: string[], periodMonth: number, periodYear: number): Promise<Set<string>> {
        if (!empCodes.length) return new Set();
        const periodStart = periodYear * 12 + (periodMonth - 1);
        const priorSet = new Set<string>();
        const CHUNK = 500;
        for (let i = 0; i < empCodes.length; i += CHUNK) {
            const chunk = empCodes.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => "?").join(",");
            const rows = await Database.getExtendedInstance().query<{ emp_code: string }>(`
                SELECT RTRIM(emp_code) as emp_code
                FROM dbo.history_hr_employee
                WHERE RTRIM(emp_code) IN (${placeholders})
                  AND is_spsi_member = 1
                  AND (period_year * 12 + (period_month - 1)) < ?
            `, [...chunk, periodStart]);
            for (const row of rows) {
                const ec = row.emp_code?.trim().toUpperCase();
                if (ec) priorSet.add(ec);
            }
            // Auto-buffer SPSI amount>0 di periode manapun = bukti member.
            const abRows = await Database.getExtendedInstance().query<{ emp_code: string }>(`
                SELECT DISTINCT RTRIM(emp_code) as emp_code
                FROM dbo.payroll_manual_adjustments
                WHERE adjustment_type = 'AUTO_BUFFER'
                  AND adjustment_name = 'SPSI'
                  AND ABS(amount) > 0
                  AND RTRIM(emp_code) IN (${placeholders})
            `, chunk);
            for (const row of abRows) {
                const ec = row.emp_code?.trim().toUpperCase();
                if (ec) priorSet.add(ec);
            }
        }
        return priorSet;
    }

    /**
     * SSOT join_date = employee_profile_override_history.effective_start_date (latest).
     * Konsisten dgn runtime dataExtractorService priority 1. Fallback AppJoinGrpDate.
     */
    private resolveJoinDate(
        empCode: string,
        overrides: Map<string, EmployeeProfileOverrideRow>,
        fallback: any
    ): any {
        const override = overrides.get(empCode);
        const esd = override?.effective_start_date;
        if (esd) {
            const normalized = normalizeEffectiveStartDate(esd);
            if (normalized) return normalized;
        }
        return fallback;
    }

    /**
     * Idempotensi re-seed: kalau row latest (emp_code, period) sudah punya
     * is_spsi_member + join_date sama dgn nilai resolve, skip INSERT (no duplicate).
     * saveHrEmployeeHistory append-only by design; guard di seeder level.
     */
    private async shouldSkipHrEmployeeInsert(
        empCode: string,
        periodMonth: number,
        periodYear: number,
        spsiMember: boolean,
        joinDate: any
    ): Promise<boolean> {
        if (!empCode) return false;
        try {
            const row = await Database.getExtendedInstance().queryOne<{ is_spsi_member: any; join_date: any }>(`
                SELECT TOP 1 is_spsi_member, join_date
                FROM dbo.history_hr_employee
                WHERE emp_code = ? AND period_month = ? AND period_year = ?
                ORDER BY id DESC
            `, [empCode, periodMonth, periodYear]);
            if (!row) return false;
            const haveSpsi = row.is_spsi_member === true || row.is_spsi_member === 1;
            const wantSpsi = !!spsiMember;
            if (haveSpsi !== wantSpsi) return false;
            const norm = (v: any) => v ? normalizeEffectiveStartDate(String(v).slice(0, 10)) : null;
            if (norm(row.join_date) !== norm(joinDate)) return false;
            return true;
        } catch {
            return false;
        }
    }

    private async seedGangHrHistory(historyId: string, options: SeederOptions, result: SeederResult): Promise<void> {
        const db = Database.getInstance();
        try {
            let sql = `SELECT g.LocCode as division_code, g.LocCode as loc_code, g.GangCode as gang_code, g.Description as gang_description, g.GangLeader as mandor_code, m1.EmpName as mandor_name, (SELECT COUNT(*) FROM HR_GANGLN gl WHERE gl.GangCode = g.GangCode) as total_members FROM HR_GANG g LEFT JOIN HR_EMPLOYEE m1 ON g.GangLeader = m1.EmpCode WHERE 1=1`;
            const params: any[] = [];
            if (options.divisionCode && options.divisionCode !== 'ALL') {
                const codes = gangService.getAllDivisionAliases(options.divisionCode);
                sql += ` AND g.LocCode IN (${codes.map(() => '?').join(',')})`;
                params.push(...codes);
            }
            if (options.gangCode && options.gangCode !== 'ALL') { sql += ` AND g.GangCode = ?`; params.push(options.gangCode); }
            const gangs = await db.query<any>(sql, params);
            if (!result.records_inserted['hr_gang']) result.records_inserted['hr_gang'] = 0;
            for (const r of gangs) {
                await historyDatabaseService.saveHrGangHistory({
                    history_id: historyId, period_month: options.periodMonth, period_year: options.periodYear, division_code: r.division_code?.trim(),
                    loc_code: r.loc_code?.trim(), gang_code: r.gang_code?.trim(), gang_description: r.gang_description?.trim(), mandor_code: r.mandor_code?.trim(),
                    mandor_name: r.mandor_name?.trim(), total_members: r.total_members || 0, is_active: true, source_table: 'HR_GANG'
                });
                result.records_inserted['hr_gang']++;
            }
        } catch (e: any) { result.errors.push(`Error seeding Gang HR: ${e.message}`); }
    }

    private async getEmployeeCodes(options: SeederOptions): Promise<string[]> {
        const codes = gangService.getAllDivisionAliases(options.divisionCode || 'ALL');
        const rows = await Database.getInstance().query<{ emp_code: string }>(`SELECT RTRIM(e.EmpCode) as emp_code FROM HR_EMPLOYEE e INNER JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode) INNER JOIN HR_GANG g ON RTRIM(g.GangCode) = RTRIM(gl.GangCode) WHERE g.LocCode IN (${codes.map(() => '?').join(',')}) ${options.gangCode && options.gangCode !== 'ALL' ? 'AND g.GangCode = ?' : ''}`, [...codes, ...(options.gangCode && options.gangCode !== 'ALL' ? [options.gangCode] : [])]);
        return [...new Set(rows.map(r => r.emp_code))];
    }

    private async saveSeederMetadata(historyId: string, options: SeederOptions, result: SeederResult): Promise<void> {
        await historyDatabaseService.saveHistoryMetadata({
            history_id: historyId, operation: 'CREATE', entity_type: 'BATCH', period_month: options.periodMonth, period_year: options.periodYear,
            division_code: options.divisionCode || 'ALL', gang_code: options.gangCode, description: `Seeded payroll history for ${options.divisionCode} - ${options.gangCode || 'ALL'}`,
            new_values: JSON.stringify(result.records_inserted), record_count: result.total_employees, status: result.success ? 'SUCCESS' : 'FAILED',
            error_message: result.errors.length > 0 ? result.errors.join('; ') : undefined, performed_by: options.createdBy, ip_address: options.ipAddress, user_agent: options.userAgent
        });
    }
}

export const historySeederService = HistorySeederService.getInstance();
