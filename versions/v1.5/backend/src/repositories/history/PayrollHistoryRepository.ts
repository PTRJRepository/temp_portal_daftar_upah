import { Database } from "../../db/client";
import { Config } from "../../config";
import type { PayrollHistoryMaster, PayrollHistoryDetail } from "../../types/history/HistoryTypes";
import { gangService } from "../../services/gangService";
import { resolveSnapshotVersion } from "../../utils/payrollOverlayLatest";
import { debug, error as logError } from "../../utils/logger";

const CATEGORY = "PayrollHistoryRepository";

export class PayrollHistoryRepository {
    private static instance: PayrollHistoryRepository;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance(Config.DB_EXTEND_DATABASE, Config.DB_EXTEND_PROFILE);
    }

    public static getInstance(): PayrollHistoryRepository {
        if (!PayrollHistoryRepository.instance) {
            PayrollHistoryRepository.instance = new PayrollHistoryRepository();
        }
        return PayrollHistoryRepository.instance;
    }

    /**
     * Save payroll history master record (upsert based on period/gang/snapshot)
     */
    public async saveMaster(data: PayrollHistoryMaster): Promise<number> {
        const existing = await this.db.queryOne<{ id: number }>(`
            SELECT id FROM dbo.payroll_history_header 
            WHERE period_month = ? AND period_year = ? AND division_code = ? AND gang_code = ? AND snapshot_version = ?
        `, [data.period_month, data.period_year, data.division_code, data.gang_code, data.snapshot_version || null]);

        if (existing) {
            await this.db.query(`
                UPDATE dbo.payroll_history_header SET
                    history_id = ?, snapshot_batch_id = ?, gang_description = ?, total_employees = ?,
                    total_hk = ?, total_hari_kerja = ?, total_cuti_tahunan = ?, total_cuti_sakit = ?,
                    total_cuti_minggu = ?, total_cuti_nasional = ?, total_upah_dasar = ?, total_upah_pokok = ?,
                    total_gaji_pokok = ?, total_beras = ?, total_jabatan = ?, total_masa_kerja = ?,
                    total_lembur = ?, total_tunjangan = ?, total_premi_brondol = ?, total_premi = ?,
                    total_koreksi = ?, total_potongan = ?, total_pph21 = ?, total_bpjs_pekerja = ?,
                    total_bpjs_majikan = ?, total_spsi = ?, total_upah_kotor = ?, total_upah_bersih = ?,
                    is_locked = ?, updated_at = GETDATE()
                WHERE id = ?
            `, [
                data.history_id, data.snapshot_batch_id || null, data.gang_description, data.total_employees,
                data.total_hk, data.total_hari_kerja, data.total_cuti_tahunan, data.total_cuti_sakit,
                data.total_cuti_minggu, data.total_cuti_nasional, data.total_upah_dasar, data.total_upah_pokok,
                data.total_gaji_pokok, data.total_beras, data.total_jabatan, data.total_masa_kerja,
                data.total_lembur, data.total_tunjangan, data.total_premi_brondol, data.total_premi,
                data.total_koreksi, data.total_potongan, data.total_pph21, data.total_bpjs_pekerja,
                data.total_bpjs_majikan, data.total_spsi, data.total_upah_kotor, data.total_upah_bersih,
                data.is_locked || false, existing.id
            ]);
            return existing.id;
        } else {
            const res = await this.db.query<{ id: number }>(`
                INSERT INTO dbo.payroll_history_header (
                    history_id, snapshot_batch_id, snapshot_version, period_month, period_year, division_code, gang_code, 
                    gang_description, total_employees, total_hk, total_hari_kerja, total_cuti_tahunan, total_cuti_sakit, 
                    total_cuti_minggu, total_cuti_nasional, total_upah_dasar, total_upah_pokok, total_gaji_pokok, 
                    total_beras, total_jabatan, total_masa_kerja, total_lembur, total_tunjangan, total_premi_brondol, 
                    total_premi, total_koreksi, total_potongan, total_pph21, total_bpjs_pekerja, total_bpjs_majikan, 
                    total_spsi, total_upah_kotor, total_upah_bersih, created_by, is_locked, created_at
                ) OUTPUT INSERTED.id VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE()
                )
            `, [
                data.history_id, data.snapshot_batch_id || null, data.snapshot_version || null, data.period_month, data.period_year, 
                data.division_code, data.gang_code, data.gang_description, data.total_employees, data.total_hk, data.total_hari_kerja, 
                data.total_cuti_tahunan, data.total_cuti_sakit, data.total_cuti_minggu, data.total_cuti_nasional, data.total_upah_dasar, 
                data.total_upah_pokok, data.total_gaji_pokok, data.total_beras, data.total_jabatan, data.total_masa_kerja, data.total_lembur, 
                data.total_tunjangan, data.total_premi_brondol, data.total_premi, data.total_koreksi, data.total_potongan, data.total_pph21, 
                data.total_bpjs_pekerja, data.total_bpjs_majikan, data.total_spsi, data.total_upah_kotor, data.total_upah_bersih, 
                data.created_by, data.is_locked || false
            ]);
            return res[0]?.id;
        }
    }

    /**
     * Save payroll history detail record
     */
    public async saveDetail(data: PayrollHistoryDetail): Promise<number> {
        const existing = await this.db.queryOne<{ id: number; nik: string }>(`
            SELECT id, nik FROM dbo.payroll_history_detail WHERE master_id = ? AND emp_code = ?
        `, [data.master_id, data.emp_code]);

        const finalNik = existing ? existing.nik : data.nik;
        const finalNewNik = (existing && data.nik !== existing.nik) ? data.nik : (existing ? undefined : data.new_nik);

        const res = await this.db.query<{ id: number }>(`
            INSERT INTO dbo.payroll_history_detail (
                history_id, master_id, snapshot_batch_id, snapshot_version, emp_code, emp_name, nik, new_nik,
                gender, gang_code, division_code, loc_code, status_ptkp, kategori_ter, hari_kerja, cuti_tahunan_hari,
                cuti_sakit_haid_hari, cuti_minggu_hari, cuti_nasional_hari, jumlah_hk, total_jam_kerja, upah_dasar,
                upah_pokok, gaji_pokok, gaji_pokok_ideal, gaji_pokok_aktual, koreksi_hk, beras_rate, beras_jumlah,
                jabatan_rate, jabatan_jumlah, masa_kerja_tahun, masa_kerja_rate, masa_kerja_jumlah, lembur_jam,
                lembur_rate, lembur_jumlah, lembur_records, total_tunjangan, premi_brondol, premi_pph, total_premi,
                premi_detail, pot_spsi, pot_pph21, pot_koreksi, pot_bpjs_kesehatan_pekerja, pot_bpjs_kesehatan_majikan,
                pot_bpjs_pensiun_pekerja, pot_bpjs_pensiun_majikan, pot_bpjs_pekerja_total, pot_astek_pekerja,
                pot_astek_majikan, pot_astek_jumlah, potongan_detail, total_potongan, total_potongan_bersih,
                jumlah_upah_kotor, upah_kotor_pajak, penghasilan_bruto, tarif_pajak_ter, pph21_ter, upah_bersih,
                task_code, task_desc, shortage_details, shortage_total_hours, created_at
            ) OUTPUT INSERTED.id VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE()
            )
        `, [
            data.history_id, data.master_id, data.snapshot_batch_id, data.snapshot_version, data.emp_code, data.emp_name, finalNik, finalNewNik,
            data.gender, data.gang_code, data.division_code, data.loc_code, data.status_ptkp, data.kategori_ter, data.hari_kerja, data.cuti_tahunan_hari,
            data.cuti_sakit_haid_hari, data.cuti_minggu_hari, data.cuti_nasional_hari, data.jumlah_hk, data.total_jam_kerja, data.upah_dasar,
            data.upah_pokok, data.gaji_pokok, data.gaji_pokok_ideal, data.gaji_pokok_aktual, data.koreksi_hk, data.beras_rate, data.beras_jumlah,
            data.jabatan_rate, data.jabatan_jumlah, data.masa_kerja_tahun, data.masa_kerja_rate, data.masa_kerja_jumlah, data.lembur_jam,
            data.lembur_rate, data.lembur_jumlah, data.lembur_records, data.total_tunjangan, data.premi_brondol, data.premi_pph, data.total_premi,
            data.premi_detail, data.pot_spsi, data.pot_pph21, data.pot_koreksi, data.pot_bpjs_kesehatan_pekerja, data.pot_bpjs_kesehatan_majikan,
            data.pot_bpjs_pensiun_pekerja, data.pot_bpjs_pensiun_majikan, data.pot_bpjs_pekerja_total, data.pot_astek_pekerja,
            data.pot_astek_majikan, data.pot_astek_jumlah, data.potongan_detail, data.total_potongan, data.total_potongan_bersih,
            data.jumlah_upah_kotor, data.upah_kotor_pajak, data.penghasilan_bruto, data.tarif_pajak_ter, data.pph21_ter, data.upah_bersih,
            data.task_code, data.task_desc, data.shortage_details, data.shortage_total_hours
        ]);
        return res[0]?.id;
    }

    public async getMasters(month: number, year: number, division?: string, gang?: string): Promise<PayrollHistoryMaster[]> {
        let sql = `SELECT * FROM dbo.payroll_history_header WHERE period_month = ? AND period_year = ?`;
        const params: any[] = [month, year];
        if (division && division !== 'ALL') {
            const aliases = gangService.getAllDivisionAliases(division);
            sql += ` AND division_code IN (${aliases.map(() => '?').join(',')})`;
            params.push(...aliases);
        }
        if (gang && gang !== 'ALL') { sql += ` AND gang_code = ?`; params.push(gang); }
        return await this.db.query<PayrollHistoryMaster>(sql + ` ORDER BY division_code, gang_code`, params);
    }

    public async getDetails(masterId: number): Promise<PayrollHistoryDetail[]> {
        return await this.db.query<PayrollHistoryDetail>(`SELECT * FROM dbo.payroll_history_detail WHERE master_id = ? ORDER BY emp_code`, [masterId]);
    }
}

export const payrollHistoryRepository = PayrollHistoryRepository.getInstance();
