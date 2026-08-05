/**
 * SEEDER BERBASIS UI - Mengekstrak data PERSIS seperti yang tampil di Daftar Upah
 *
 * Menggunakan parameter yang SAMA dengan UI:
 * - Division (dari filter UI)
 * - Month/Year (dari period slider)
 * - Gang (jika dipilih)
 * - GangPrefix/Group (jika dipilih)
 *
 * Hasil: Agregasi per gang yang 100% MATCH dengan Daftar Upah
 */

import { Database } from "../db/client";
import { dataExtractorService } from "../services/dataExtractorService";
import { AggregationRecord } from "../services/payrollDataService";
import {
    calculatePayrollTotals,
    reconcileGangTotalsToGrandTotal,
    type PayrollTotals
} from "../services/payrollTotalsCalculator";
import { normalizeManualAdjustmentDivisionCode } from "../services/payroll/manualAdjustments/manualAdjustmentNaming";

interface SeedResult {
    gang_code: string;
    employees: number;
    upah_bersih: number;
    status: 'success' | 'error';
    error?: string;
}

export async function seedFromUI(
    division: string,
    month: number,
    year: number,
    gangCode: string | null = null,
    gangPrefix: string | null = null
): Promise<{ success: boolean; results: SeedResult[]; total_gangs: number; total_employees: number }> {

    console.log(`🎨 UI-BASED SEEDER`);
    console.log(`   Division: ${division}`);
    console.log(`   Period: ${month}/${year}`);
    console.log(`   Gang: ${gangCode || 'ALL'}`);
    console.log(`   Group: ${gangPrefix || 'ALL'}`);
    console.log();

    const extDb = Database.getExtendedInstance();
    const results: SeedResult[] = [];
    const dbDivisionCode = normalizeManualAdjustmentDivisionCode(division) || division;

    try {
        // [CLEANUP] Delete existing data for this division/period before seeding
        console.log(`🧹 Cleaning existing data for ${division} (${month}/${year})...`);
        try {
            const deleteResult = await extDb.query(`
                DELETE FROM dbo.daftar_upah_aggregation_history
                WHERE period_month = ? AND period_year = ? AND division_code = ?
            `, [month, year, dbDivisionCode]);
            
            const deletedCount = deleteResult?.rowsAffected || 0;
            if (deletedCount > 0) {
                console.log(`   ✅ Deleted ${deletedCount} existing record(s)\n`);
            } else {
                console.log(`   ℹ️ No existing data found\n`);
            }
        } catch (deleteError: any) {
            console.warn(`   ⚠️ Cleanup failed: ${deleteError.message}\n`);
        }

        // Step 1: Fetch data EXACTLY like UI does
        const result = await dataExtractorService.extractPayrollData(
            month,
            year,
            gangCode || "ALL",
            division,
            null,
            "SERVER_PROFILE_2",
            false,   // includeVirtual - SAME as UI
            false,   // useHistoryDb - SAME as UI
            gangPrefix, // gangPrefix/group - SAME as UI filter
            true     // skipHarvest - for speed
        );

        const rows = result.data_rows || [];
        console.log(`📊 Fetched ${rows.length} employees from UI data\n`);

        if (rows.length === 0) {
            return { success: false, results: [], total_gangs: 0, total_employees: 0 };
        }

        // Step 2: Group by gang (exactly as displayed in UI)
        const gangsMap: Record<string, any[]> = {};
        for (const row of rows) {
            const gc = row.gang_code || "UNKNOWN";
            if (!gangsMap[gc]) gangsMap[gc] = [];
            gangsMap[gc].push(row);
        }

        console.log(`📋 Found ${Object.keys(gangsMap).length} gangs\n`);

        const gangEntries = Object.entries(gangsMap);
        const reconciledPayrollTotalsByGang = buildReconciledPayrollTotalsByGang(
            gangEntries,
            calculatePayrollTotals(rows, "GRAND TOTAL")
        );

        // Step 3: Calculate and insert per-gang totals
        for (const [gangCode, employees] of gangEntries) {
            try {
                // Calculate aggregation record from employee data
                const aggregation = calculateGangAggregation(
                    gangCode,
                    employees,
                    reconciledPayrollTotalsByGang[gangCode]
                );

                console.log(`  Gang ${gangCode}: ${employees.length} emp | bersih: ${aggregation.total_upah_bersih.toLocaleString('id-ID')}`);

                // Step 4: DELETE existing record to prevent duplication
                await extDb.query(`
                    DELETE FROM dbo.daftar_upah_aggregation_history
                    WHERE period_month = ? AND period_year = ? AND gang_code = ?
                `, [month, year, gangCode]);

                // Step 5: INSERT new record using EXACT schema from PayrollDataService
                await extDb.query(`
                    INSERT INTO dbo.daftar_upah_aggregation_history (
                        period_month, period_year, division_code, gang_code, gang_description,
                        total_employees, total_hk, total_hari_kerja,
                        total_cuti_tahunan, total_cuti_sakit, total_cuti_minggu, total_cuti_nasional,
                        total_upah_dasar, total_upah_pokok, total_gaji_pokok,
                        total_beras, total_jabatan, total_masa_kerja, total_lembur, total_tunjangan,
                        total_premi_brondol, total_premi_prunning, total_premi_insentif, total_premi_kinerja, total_premi,
                        total_potongan, total_pph21, total_bpjs_pekerja, total_bpjs_majikan, total_spsi,
                        total_upah_kotor, total_upah_bersih, total_ffb_weight, total_weight_tbs,
                        dynamic_premi_data, informasi_tambahan, total_koreksi,
                        created_at, updated_at, source_endpoint
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, GETDATE(), GETDATE(), ?
                    )
                `, [
                    month, year, dbDivisionCode,
                    aggregation.gang_code,
                    aggregation.gang_description,
                    aggregation.total_employees,
                    aggregation.total_hk,
                    aggregation.total_hari_kerja,
                    aggregation.total_cuti_tahunan,
                    aggregation.total_cuti_sakit,
                    aggregation.total_cuti_minggu,
                    aggregation.total_cuti_nasional,
                    aggregation.total_upah_dasar,
                    aggregation.total_upah_pokok,
                    aggregation.total_gaji_pokok,
                    aggregation.total_beras,
                    aggregation.total_jabatan,
                    aggregation.total_masa_kerja,
                    aggregation.total_lembur,
                    aggregation.total_tunjangan,
                    aggregation.total_premi_brondol,
                    aggregation.total_premi_prunning,
                    aggregation.total_premi_insentif,
                    aggregation.total_premi_kinerja,
                    aggregation.total_premi,
                    aggregation.total_potongan,
                    aggregation.total_pph21,
                    aggregation.total_bpjs_pekerja,
                    aggregation.total_bpjs_majikan,
                    aggregation.total_spsi,
                    aggregation.total_upah_kotor,
                    aggregation.total_upah_bersih,
                    aggregation.total_ffb_weight,
                    aggregation.total_weight_tbs,
                    aggregation.dynamic_premi_data,
                    aggregation.informasi_tambahan,
                    aggregation.total_koreksi,
                    'ui_based_seeder'
                ]);

                results.push({
                    gang_code: gangCode,
                    employees: employees.length,
                    upah_bersih: aggregation.total_upah_bersih,
                    status: 'success'
                });
            } catch (error: any) {
                console.error(`  ❌ Error seeding ${gangCode}: ${error.message}`);
                results.push({
                    gang_code: gangCode,
                    employees: 0,
                    upah_bersih: 0,
                    status: 'error',
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.status === 'success').length;
        const totalEmployees = results.reduce((sum, r) => sum + r.employees, 0);

        console.log(`\n✅ Seeding complete: ${successCount}/${results.length} gangs, ${totalEmployees} employees`);

        return {
            success: successCount > 0,
            results,
            total_gangs: successCount,
            total_employees: totalEmployees
        };
    } catch (error: any) {
        console.error(`❌ Seeder error: ${error.message}`);
        return {
            success: false,
            results,
            total_gangs: 0,
            total_employees: 0
        };
    }
}

function buildReconciledPayrollTotalsByGang(
    gangEntries: Array<[string, any[]]>,
    grandPayrollTotals: PayrollTotals
): Record<string, PayrollTotals> {
    const payrollTotalsByGang = gangEntries.map(([gangCode, employees]) =>
        calculatePayrollTotals(employees, `TOTAL ${gangCode}`)
    );
    const reconciledTotals = reconcileGangTotalsToGrandTotal(payrollTotalsByGang, grandPayrollTotals);

    return gangEntries.reduce<Record<string, PayrollTotals>>((map, [gangCode], index) => {
        map[gangCode] = reconciledTotals[index] || payrollTotalsByGang[index];
        return map;
    }, {});
}

/**
 * Calculate aggregation record for a single gang
 * Matches the AggregationRecord interface from PayrollDataService exactly
 */
export function calculateGangAggregation(
    gangCode: string,
    employees: any[],
    payrollTotalsOverride?: PayrollTotals
): AggregationRecord {
    const activeEmployees = employees.filter((emp) => (Number(emp.jumlah_hk) || 0) > 0);
    const daftarUpahTotals = payrollTotalsOverride || calculatePayrollTotals(employees, "TOTAL");

    // Accumulators
    let totalEmployees = daftarUpahTotals.employee_count;
    let totalHk = 0;
    let totalHariKerja = 0;
    let totalCutiTahunan = 0;
    let totalCutiSakit = 0;
    let totalCutiMinggu = 0;
    let totalCutiNasional = 0;
    let totalUpahDasar = 0;
    let totalUpahPokok = 0;
    let totalGajiPokok = 0;
    let totalBeras = 0;
    let totalJabatan = 0;
    let totalMasaKerja = 0;
    let totalLembur = 0;
    let totalTunjangan = 0;
    let totalPremiBrondol = 0;
    let totalPremiPrunning = 0;
    let totalPremiInsentif = 0;
    let totalPremiKinerja = 0;
    let totalPremi = 0;
    let totalPotongan = 0;
    let totalPph21 = 0;
    let totalBpjsPekerja = 0;
    let totalBpjsMajikan = 0;
    let totalSpsi = 0;
    let totalUpahKotor = 0;
    let totalUpahBersih = 0;
    let totalKoreksi = 0;
    let totalFfbWeight = 0;
    let totalWeightTbs = 0;

    // Dynamic premi accumulator
    const dynamicPremiMap: Record<string, number> = {};

    for (const emp of activeEmployees) {
        // Basic counts
        totalHk += emp.jumlah_hk || 0;
        totalHariKerja += emp.hari_kerja || 0;

        // Cuti
        totalCutiTahunan += emp.cuti_tahunan_hari || 0;
        totalCutiSakit += emp.cuti_sakit_haid_hari || 0;
        totalCutiMinggu += emp.cuti_minggu_hari || 0;
        totalCutiNasional += emp.cuti_nasional_hari || 0;

        // Gaji
        totalUpahDasar += emp.upah_dasar || 0;
        totalUpahPokok += emp.upah_pokok || 0;
        totalGajiPokok += emp.gaji_pokok || 0;

        // Tunjangan
        totalBeras += emp.beras_jumlah || 0;
        totalJabatan += emp.jabatan_jumlah || 0;
        totalMasaKerja += emp.masa_kerja_jumlah || 0;
        totalLembur += emp.lembur_jumlah || 0;
        totalTunjangan += emp.total_tunjangan || 0;

        // Premi
        totalPremiBrondol += emp.premi_brondol || 0;
        totalPremiPrunning += emp.premi_prunning || 0;
        totalPremi += emp.total_premi || 0;

        // Collect dynamic premi values
        for (let i = 1; i <= 7; i++) {
            const key = `premi_dynamic_${i}`;
            const val = emp[key] || 0;
            if (val !== 0) {
                dynamicPremiMap[key] = (dynamicPremiMap[key] || 0) + val;
            }
        }

        // Potongan
        totalPotongan += emp.total_potongan || 0;
        totalPph21 += emp.pot_pph21 || 0;
        totalBpjsPekerja += emp.pot_bpjs_pekerja_total || ((emp.pot_bpjs_kesehatan_pekerja || 0) + (emp.pot_bpjs_pensiun_pekerja || 0)) || emp.bpjs_pek || 0;
        totalBpjsMajikan += ((emp.pot_bpjs_kesehatan_majikan || 0) + (emp.pot_bpjs_pensiun_majikan || 0)) || emp.bpjs_maj || 0;
        totalSpsi += emp.pot_spsi || 0;

        // Upah
        totalUpahKotor += emp.jumlah_upah_kotor || 0;
        totalUpahBersih += emp.upah_bersih || 0;

        // Koreksi
        totalKoreksi += emp.pot_koreksi || 0;
    }

    // Build dynamic_premi_data JSON
    const dynamicPremiData = JSON.stringify(dynamicPremiMap);

    // Extract insufic, kinerja from dynamic_premi if present
    // (These are summed from the dynamic premis based on their headers in UI)
    totalPremiInsentif = dynamicPremiMap['premi_insentif'] || dynamicPremiMap['premi_i'] || 0;
    totalPremiKinerja = dynamicPremiMap['premi_kinerja'] || dynamicPremiMap['premi_k'] || 0;

    return {
        gang_code: gangCode,
        gang_description: employees[0]?.gang_description || employees[0]?.gang || gangCode,
        total_employees: totalEmployees,
        total_hk: daftarUpahTotals.jumlah_hk,
        total_hari_kerja: daftarUpahTotals.hari_kerja,
        total_cuti_tahunan: daftarUpahTotals.cuti_tahunan_hari,
        total_cuti_sakit: daftarUpahTotals.cuti_sakit_haid_hari,
        total_cuti_minggu: daftarUpahTotals.cuti_minggu_hari,
        total_cuti_nasional: daftarUpahTotals.cuti_nasional_hari,
        total_upah_dasar: totalUpahDasar,
        total_upah_pokok: daftarUpahTotals.upah_pokok,
        total_gaji_pokok: daftarUpahTotals.gaji_pokok,
        total_beras: daftarUpahTotals.beras_jumlah,
        total_jabatan: daftarUpahTotals.jabatan_jumlah,
        total_masa_kerja: daftarUpahTotals.masa_kerja_jumlah,
        total_lembur: daftarUpahTotals.lembur_jumlah,
        total_tunjangan: daftarUpahTotals.total_tunjangan,
        total_premi_brondol: daftarUpahTotals.premi_brondol,
        total_premi_prunning: daftarUpahTotals.premi_pruning || totalPremiPrunning,
        total_premi_insentif: totalPremiInsentif,
        total_premi_kinerja: totalPremiKinerja,
        total_premi: daftarUpahTotals.total_premi,
        total_potongan: daftarUpahTotals.total_potongan,
        total_pph21: daftarUpahTotals.pot_pph21,
        total_bpjs_pekerja: daftarUpahTotals.pot_bpjs_pekerja_total || totalBpjsPekerja,
        total_bpjs_majikan: (daftarUpahTotals.pot_bpjs_kesehatan_majikan + daftarUpahTotals.pot_bpjs_pensiun_majikan) || totalBpjsMajikan,
        total_spsi: daftarUpahTotals.pot_spsi,
        total_upah_kotor: daftarUpahTotals.jumlah_upah_kotor,
        total_upah_bersih: daftarUpahTotals.upah_bersih,
        total_ffb_weight: totalFfbWeight,
        total_weight_tbs: totalWeightTbs,
        dynamic_premi_data: dynamicPremiData,
        informasi_tambahan: '',
        total_koreksi: totalKoreksi
    };
}
