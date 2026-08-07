import { Database } from "./src/db/client.ts";
const db = Database.getExtendedInstance();
// check AB1 July directly without latest_rows
const rows = await db.query("SELECT TOP 3 division_code, gang_code, period_month, period_year, created_at FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND period_month=7 AND period_year=2026 ORDER BY created_at DESC");
console.log("AB1 July direct", rows.length);
for(const r of rows) console.log(r.division_code.trim(), r.gang_code, r.period_month, r.period_year, r.created_at);
// check if insert error hidden - try direct insert
const q = `INSERT INTO dbo.daftar_upah_aggregation_history (period_month, period_year, division_code, gang_code, gang_description, total_employees, total_hk, total_hari_kerja, total_cuti_tahunan, total_cuti_sakit, total_cuti_minggu, total_cuti_nasional, total_upah_dasar, total_upah_pokok, total_gaji_pokok, total_beras, total_jabatan, total_masa_kerja, total_lembur, total_tunjangan, total_premi_brondol, total_premi_prunning, total_premi_insentif, total_premi_kinerja, total_premi, total_potongan, total_pph21, total_bpjs_pekerja, total_bpjs_majikan, total_spsi, total_upah_kotor, total_upah_bersih, total_ffb_weight, total_weight_tbs, dynamic_premi_data, informasi_tambahan, total_koreksi, created_at, updated_at, source_endpoint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE(), ?)`;
try {
  await db.query(q, [7,2026,'AB1','TEST_JULY','Test',10,100,100, 1,1,1,1, 1000,1000,1000, 100,100,100,100,100, 10,10,10,10,40, 100,10,10,10,5, 1000,900,0,0, '[]','test',0,'manual-test']);
  console.log("direct manual insert AB1 July TEST_JULY ok");
  const chk = await db.query("SELECT COUNT(*) as c FROM dbo.daftar_upah_aggregation_history WHERE division_code='AB1' AND gang_code='TEST_JULY'");
  console.log("TEST_JULY count", chk[0].c);
} catch(e){ console.error("direct insert error", e.message.slice(0,600)); }
