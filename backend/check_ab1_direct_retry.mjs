import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
await db.query("DELETE FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 AND period_year=2026 AND gang_code='G1H'");
console.log("del");
await db.query(`INSERT INTO dbo.daftar_upah_aggregation_history (period_month, period_year, division_code, gang_code, gang_description, total_employees, total_hk, total_hari_kerja, total_cuti_tahunan, total_cuti_sakit, total_cuti_minggu, total_cuti_nasional, total_upah_dasar, total_upah_pokok, total_gaji_pokok, total_beras, total_jabatan, total_masa_kerja, total_lembur, total_tunjangan, total_premi_brondol, total_premi_prunning, total_premi_insentif, total_premi_kinerja, total_premi, total_potongan, total_pph21, total_bpjs_pekerja, total_bpjs_majikan, total_spsi, total_upah_kotor, total_upah_bersih, total_ffb_weight, total_weight_tbs, dynamic_premi_data, informasi_tambahan, total_koreksi, created_at, updated_at, source_endpoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE(), ?)`, [7,2026,'AB1','G1H','Test G1H',29,874,874, 1,1,1,1, 1000,1000,1000, 100,100,100,100,100, 10,10,10,10,40, 100,10,10,10,5, 224000,210000,0,0,'[]','test',0,'direct-manual']);
console.log("insert");
const rows = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 AND gang_code='G1H'");
console.log("cnt " + rows[0].c);
