import { PayrollDataService } from "./src/services/payrollDataService.ts";
import { Database } from "./src/db/client.ts";
import { Config } from "./src/config.ts";
const db = Database.getExtendedInstance();
const token = "Bearer " + Config.SYSTEM_TOKEN;
const data = await PayrollDataService.fetchPayrollData("AB1", 7, 2026, token);
const rec = data["AB1"]?.[0];
console.log("AB1 July rec", rec ? rec.gang_code + " emp=" + rec.total_employees + " hk=" + rec.total_hk : "none");
if(rec){
  const dc = "AB1";
  await db.query("DELETE FROM dbo.daftar_upah_aggregation_history WHERE period_month=7 AND period_year=2026 AND division_code=? AND gang_code=?", [dc, rec.gang_code]);
  console.log("deleted existing");
  // same as seeder insert but count placeholders
  const q = `INSERT INTO dbo.daftar_upah_aggregation_history (period_month, period_year, division_code, gang_code, gang_description, total_employees, total_hk, total_hari_kerja, total_cuti_tahunan, total_cuti_sakit, total_cuti_minggu, total_cuti_nasional, total_upah_dasar, total_upah_pokok, total_gaji_pokok, total_beras, total_jabatan, total_masa_kerja, total_lembur, total_tunjangan, total_premi_brondol, total_premi_prunning, total_premi_insentif, total_premi_kinerja, total_premi, total_potongan, total_pph21, total_bpjs_pekerja, total_bpjs_majikan, total_spsi, total_upah_kotor, total_upah_bersih, total_ffb_weight, total_weight_tbs, dynamic_premi_data, informasi_tambahan, total_koreksi, created_at, updated_at, source_endpoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE(), ?)`;
  const vals = [7,2026,dc, rec.gang_code, rec.gang_description, rec.total_employees, rec.total_hk, rec.total_hari_kerja, rec.total_cuti_tahunan, rec.total_cuti_sakit, rec.total_cuti_minggu, rec.total_cuti_nasional, rec.total_upah_dasar, rec.total_upah_pokok, rec.total_gaji_pokok, rec.total_beras, rec.total_jabatan, rec.total_masa_kerja, rec.total_lembur, rec.total_tunjangan, rec.total_premi_brondol, rec.total_premi_prunning, rec.total_premi_insentif, rec.total_premi_kinerja, rec.total_premi, rec.total_potongan, rec.total_pph21, rec.total_bpjs_pekerja, rec.total_bpjs_majikan, rec.total_spsi, rec.total_upah_kotor, rec.total_upah_bersih, rec.total_ffb_weight, rec.total_weight_tbs, rec.dynamic_premi_data, rec.informasi_tambahan, rec.total_koreksi, 'trace'];
  console.log("vals len", vals.length);
  try {
    await db.query(q, vals);
    console.log("insert ok");
    const chk = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 AND gang_code=?", [rec.gang_code]);
    console.log("check AB1 July " + rec.gang_code + " cnt " + chk[0].c);
  } catch(e){ console.error("insert error", e.message.slice(0,800)); }
}
