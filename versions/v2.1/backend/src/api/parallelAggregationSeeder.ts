/**
 * Parallel Aggregation Seeder
 * 
 * Optimasi: Proses multiple divisi secara paralel (batch of 4)
 * Estimasi: 10-15x lebih cepat dari sequential processing
 * 
 * Usage: Import dan panggil dari aggregationSeederRoutes.ts
 */

import { Database } from "../db/client";
import { PayrollDataService, AggregationRecord } from "../services/payrollDataService";
import { historySeederService } from "../services/historySeederService";
import { updateProgress, seederProgress } from "./aggregationSeederRoutes";

interface SeederResult {
    division: string;
    gang: string;
    employees_processed: number;
    status: string;
    time_seconds?: number;
}

// Division mapping
const DIVISION_CODE_MAP: Record<string, string> = {
    "PG1A": "P1A", "PG1B": "P1B", "PG2A": "P2A", "PG2B": "P2B",
    "ARB1": "AB1", "ARB2": "AB2",
    "INFRA": "INF", "ARC": "ARC",
};

/**
 * Main parallel seeder function
 */
export async function seedAggregationParallel(
    divisions: string[],
    month: number,
    year: number,
    authToken: string,
    force: boolean = false,
    sourceEndpoint: string = '/api/aggregation/seed'
): Promise<{ total_divisions: number; processed: SeederResult[] }> {
    console.log(`🚀 Starting PARALLEL aggregation seeder...`);
    console.log(`📅 Period: ${getMonthName(month)} ${year}`);
    console.log(`📊 Divisions: ${divisions.length}`);
    console.log(`⚡ Processing mode: PARALLEL (batch size 4)`);

    const PARALLEL_BATCH_SIZE = 4;
    const startTime = Date.now();
    const allResults: SeederResult[] = [];

    // [CLEANUP] Delete existing data for all divisions before parallel seeding
    console.log(`\n🧹 Pre-cleanup: Removing existing data for ${month}/${year}...`);
    const db = Database.getExtendedInstance();
    const DIVISION_CODE_MAP: Record<string, string> = {
        "PG1A": "P1A", "PG1B": "P1B", "PG2A": "P2A", "PG2B": "P2B",
        "ARB1": "AB1", "ARB2": "AB2",
        "INFRA": "INF", "ARC": "ARC",
        "DME": "DME", "ARA": "ARA", "IJL": "IJL", "MILL": "MILL"
    };

    for (const div of divisions) {
        const dbDivisionCode = DIVISION_CODE_MAP[div] || div;
        try {
            const deleteResult = await db.query(`
                DELETE FROM dbo.daftar_upah_aggregation_history
                WHERE period_month = ? AND period_year = ? AND division_code = ?
            `, [month, year, dbDivisionCode]);
            
            const deletedCount = deleteResult?.rowsAffected || 0;
            if (deletedCount > 0) {
                console.log(`  ✅ ${dbDivisionCode}: Deleted ${deletedCount} record(s)`);
            }
        } catch (deleteError: any) {
            console.warn(`  ⚠️ ${dbDivisionCode}: Cleanup failed - ${deleteError.message}`);
        }
    }
    console.log(`✅ Pre-cleanup complete\n`);

    // Initialize progress tracker
    updateProgress({
        is_running: true,
        divisions_total: divisions.length,
        divisions_done: 0,
        current_batch: 1,
        total_batches: Math.ceil(divisions.length / PARALLEL_BATCH_SIZE),
        started_at: new Date().toISOString(),
        message: `Starting seeding for ${getMonthName(month)} ${year}...`
    });

    // Process divisions in parallel batches
    for (let i = 0; i < divisions.length; i += PARALLEL_BATCH_SIZE) {
        const batch = divisions.slice(i, i + PARALLEL_BATCH_SIZE);
        const batchNum = Math.floor(i / PARALLEL_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(divisions.length / PARALLEL_BATCH_SIZE);
        
        console.log(`\n📦 Batch ${batchNum}/${totalBatches}: [${batch.join(', ')}]`);
        updateProgress({
            current_batch: batchNum,
            total_batches: totalBatches,
            message: `Processing batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`
        });
        
        const batchStart = Date.now();

        // Process batch in parallel
        const batchPromises = batch.map(div => 
            processSingleDivision(div, month, year, authToken, force, sourceEndpoint)
        );

        const batchResults = await Promise.allSettled(batchPromises);
        
        // Collect results
        for (const result of batchResults) {
            if (result.status === 'fulfilled') {
                allResults.push(result.value);
            } else {
                console.error(`❌ Division failed:`, result.reason);
                allResults.push({ 
                    division: 'UNKNOWN', 
                    gang: 'ALL', 
                    employees_processed: 0, 
                    status: `ERROR: ${result.reason}` 
                });
            }
        }

        const batchTime = ((Date.now() - batchStart) / 1000).toFixed(1);
        console.log(`⏱️  Batch ${batchNum} completed in ${batchTime}s`);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const successCount = allResults.filter(r => r.status === 'SUCCESS').length;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Parallel seeding completed in ${totalTime}s`);
    console.log(`📊 Success: ${successCount}/${divisions.length} divisions`);
    console.log(`${'='.repeat(60)}`);
    
    updateProgress({
        is_running: false,
        divisions_done: successCount,
        current_division: 'DONE',
        message: `Completed! ${successCount}/${divisions.length} divisions succeeded in ${totalTime}s`
    });

    return {
        total_divisions: successCount,
        processed: allResults
    };
}

/**
 * Process single division (called in parallel)
 */
async function processSingleDivision(
    div: string,
    month: number,
    year: number,
    authToken: string,
    force: boolean,
    sourceEndpoint: string
): Promise<SeederResult> {
    console.log(`\n[${div}] Starting...`);
    updateProgress({
        current_division: div,
        message: `Processing division: ${div}`
    });
    
    const divStart = Date.now();

    try {
        // Handle MILL separately
        if (div === 'MILL') {
            return await processMillDivision(month, year, divStart, sourceEndpoint);
        }

        // Fetch payroll data
        const payrollData = await PayrollDataService.fetchPayrollData(div, month, year, authToken);

        // Collect all records
        let allRecords: AggregationRecord[] = [];
        Object.values(payrollData).forEach(records => {
            allRecords = [...allRecords, ...records];
        });

        if (allRecords.length === 0) {
            console.log(`[${div}] No data found`);
            return { division: div, gang: "ALL", employees_processed: 0, status: "SKIPPED: No data" };
        }

        console.log(`[${div}] Fetched ${allRecords.length} records`);

        // [OPTIMIZATION] Insert aggregation records in parallel
        const dbDivisionCode = DIVISION_CODE_MAP[div] || div;
        const insertPromises = allRecords.map(record => 
            insertAggregationRecord(dbDivisionCode, month, year, record, sourceEndpoint)
        );
        await Promise.all(insertPromises);

        const savedCount = allRecords.length;
        const totalEmployees = allRecords.reduce((sum, r) => sum + r.total_employees, 0);

        // [OPTIMIZATION] Fire-and-forget history seeder (don't block)
        if (force) {
            console.log(`[${div}] Triggering history seeder in background...`);
            triggerHistorySeederAsync(div, month, year, divStart);
        }

        const divTime = ((Date.now() - divStart) / 1000).toFixed(1);
        console.log(`[${div}] ✅ Done in ${divTime}s (${savedCount} gangs, ${totalEmployees} emp)`);

        return {
            division: div,
            gang: `Count: ${savedCount}`,
            employees_processed: totalEmployees,
            status: "SUCCESS",
            time_seconds: parseFloat(divTime)
        };
    } catch (error: any) {
        const divTime = ((Date.now() - divStart) / 1000).toFixed(1);
        console.error(`[${div}] ❌ Error after ${divTime}s:`, error.message);
        return { 
            division: div, 
            gang: "ALL", 
            employees_processed: 0, 
            status: `ERROR: ${error.message}`,
            time_seconds: parseFloat(divTime)
        };
    }
}

/**
 * Process MILL division
 */
async function processMillDivision(
    month: number,
    year: number,
    divStart: number,
    sourceEndpoint: string
): Promise<SeederResult> {
    try {
        // Import mill data fetcher
        const { fetchMillData } = await import("./aggregationSeederRoutes");
        const millData = await fetchMillData(month, year);

        if (!millData) {
            return { division: "MILL", gang: "MILL_GENERAL", employees_processed: 0, status: "SKIPPED: No data" };
        }

        await insertAggregationRecord("MILL", month, year, millData, sourceEndpoint);

        const divTime = ((Date.now() - divStart) / 1000).toFixed(1);
        console.log(`[MILL] ✅ Done in ${divTime}s`);
        return {
            division: "MILL",
            gang: "MILL_GENERAL",
            employees_processed: millData.total_employees,
            status: "SUCCESS",
            time_seconds: parseFloat(divTime)
        };
    } catch (e: any) {
        console.error(`[MILL] Error:`, e);
        return { division: "MILL", gang: "MILL_GENERAL", employees_processed: 0, status: `ERROR: ${e.message}` };
    }
}

/**
 * Insert single aggregation record (with DELETE before INSERT)
 */
async function insertAggregationRecord(
    divisionCode: string,
    month: number,
    year: number,
    aggregation: AggregationRecord,
    sourceEndpoint: string
): Promise<void> {
    const db = Database.getExtendedInstance();

    // Delete existing record to prevent duplication
    await db.query(`
        DELETE FROM dbo.daftar_upah_aggregation_history
        WHERE period_month = ? AND period_year = ? AND division_code = ? AND gang_code = ?
    `, [month, year, divisionCode, aggregation.gang_code]);

    // Insert new record
    await db.query(`
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
        month, year, divisionCode,
        aggregation.gang_code, aggregation.gang_description,
        aggregation.total_employees, aggregation.total_hk, aggregation.total_hari_kerja,
        aggregation.total_cuti_tahunan, aggregation.total_cuti_sakit,
        aggregation.total_cuti_minggu, aggregation.total_cuti_nasional,
        aggregation.total_upah_dasar, aggregation.total_upah_pokok, aggregation.total_gaji_pokok,
        aggregation.total_beras, aggregation.total_jabatan,
        aggregation.total_masa_kerja, aggregation.total_lembur, aggregation.total_tunjangan,
        aggregation.total_premi_brondol, aggregation.total_premi_prunning,
        aggregation.total_premi_insentif, aggregation.total_premi_kinerja, aggregation.total_premi,
        aggregation.total_potongan, aggregation.total_pph21,
        aggregation.total_bpjs_pekerja, aggregation.total_bpjs_majikan, aggregation.total_spsi,
        aggregation.total_upah_kotor, aggregation.total_upah_bersih,
        aggregation.total_ffb_weight, aggregation.total_weight_tbs,
        aggregation.dynamic_premi_data, aggregation.informasi_tambahan,
        aggregation.total_koreksi, sourceEndpoint
    ]);
}

/**
 * Trigger history seeder asynchronously (fire-and-forget)
 */
function triggerHistorySeederAsync(
    div: string,
    month: number,
    year: number,
    divStart: number
): void {
    historySeederService.seedPayrollHistory({
        periodMonth: month,
        periodYear: year,
        divisionCode: div,
        seederMode: 'PAYROLL',
        force: true
    }).then(() => {
        const totalTime = ((Date.now() - divStart) / 1000).toFixed(1);
        console.log(`[${div}] ✅ History seeder complete (${totalTime}s)`);
    }).catch((err: any) => {
        console.error(`[${div}] ❌ History seeder failed:`, err.message);
    });
}

/**
 * Helper: Get month name
 */
function getMonthName(month: number): string {
    const names = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                   'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return names[month - 1] || String(month);
}
