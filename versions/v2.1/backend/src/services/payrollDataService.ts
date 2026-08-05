import { Config } from "../config";
import { divisionDefinition } from "./divisionDefinition";
import { DataExtractorService } from "./dataExtractorService";
import { calculatePayrollTotals, reconcileGangTotalsToGrandTotal } from "./payrollTotalsCalculator";

export interface AggregationRecord {
    gang_code: string;
    gang_description: string;
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
    total_premi_insentif: number;  // Extracted from dynamic_premi with "INSENTIF" header
    total_premi_kinerja: number;   // Extracted from dynamic_premi with "KINERJA" header
    total_premi: number;
    total_potongan: number;
    total_pph21: number;
    total_bpjs_pekerja: number;
    total_bpjs_majikan: number;
    total_spsi: number;
    total_upah_kotor: number;
    total_upah_bersih: number;
    total_ffb_weight: number;
    total_weight_tbs: number;      // TBS weight
    dynamic_premi_data: string;    // JSON string of all dynamic premi
    informasi_tambahan: string;    // Additional information
    total_koreksi: number;         // Extracted from dynamic_premi with "KOREKSI" header (except KOREKSI_HK)
}

export class PayrollDataService {
    /**
     * Fetch payroll data for a specific division and period.
     * This handles virtual divisions by querying their source divisions.
     * Returns a map of division -> AggregationRecord[]
     * [Reload Trigger] - Forced reload
     */
    static async fetchPayrollData(division: string, month: number, year: number, authToken: string): Promise<Record<string, AggregationRecord[]>> {
        const results: Record<string, AggregationRecord[]> = {};

        // Check if this is a virtual division
        const isVirtual = divisionDefinition.isVirtualDivision(division);

        try {
            // IMPORTANT: Always set includeVirtual=true so ALL gangs are fetched, even those
            // belonging to virtual sub-divisions (e.g., AMC/INF/INT from P1A).
            // The summary service handles virtual division grouping at READ time using
            // HR_GANG LocCode + pattern matching. If we exclude virtual gangs here,
            // they won't be in the aggregation table and virtual divisions will be empty.
            const rawData = await this.fetchRawTreeData(division, month, year, authToken, true);

            if (rawData.success && rawData.data && rawData.data.gangs) {
                const records: AggregationRecord[] = [];
                const premiTitleMap = rawData.data.premi_title_map || {};
                const potonganTitleMap = rawData.data.potongan_title_map || {};

                for (const gangData of rawData.data.gangs) {
                    const gangCode = gangData.gang_code;
                    const gangDesc = gangData.gang_description || gangCode;
                    const gangTotals = gangData.gang_totals;

                    if (!gangCode || !gangTotals) continue;

                    const record = this.mapGangTotalsToAggregation(
                        gangCode,
                        gangDesc,
                        gangTotals,
                        premiTitleMap,
                        potonganTitleMap
                    );
                    records.push(record);
                }

                // Store results keyed by the division code
                results[division] = records;
            }
        } catch (error) {
            console.error(`[PayrollDataService] Error fetching data for ${division}:`, error);
        }

        return results;
    }

    /**
     * Fetch detailed employee payroll data for a specific division and period.
     * Returns a flat list of employee records (any[]).
     */
    static async fetchEmployeeData(division: string, month: number, year: number, authToken: string): Promise<any[]> {
        const results: any[] = [];

        // Check if this is a virtual division
        const isVirtual = divisionDefinition.isVirtualDivision(division);
        let divisionsToQuery: string[] = [division];

        if (isVirtual) {
            divisionsToQuery = await divisionDefinition.getSourceDivisionsForAggregation(division);
            console.log(`[PayrollDataService] Virtual division ${division} -> Querying source divisions for employee data: ${divisionsToQuery.join(", ")}`);
        }

        const dataExtractor = DataExtractorService.getInstance();

        for (const div of divisionsToQuery) {
            try {
                // Fetch data for this division DIRECTLY from service (bypass HTTP layer)
                console.log(`[PayrollDataService] Fetching employee data for ${div} via DataExtractorService...`);
                // Use Config.DB_PROFILE as default for payroll data
                const rawData = await dataExtractor.extractPayrollData(month, year, "ALL", div, null, Config.DB_PROFILE, false);

                if (rawData && rawData.data_rows && rawData.data_rows.length > 0) {
                    // Normalize or tag data if needed (e.g. add division source if mixed)
                    const taggedRows = rawData.data_rows.map((row: any) => ({
                        ...row,
                        _source_division: div
                    }));
                    results.push(...taggedRows);
                } else {
                    console.log(`[PayrollDataService] No data rows found for ${div}`);
                }
            } catch (error) {
                console.error(`[PayrollDataService] Error fetching employee data for ${div}:`, error);
                throw error; // Rethrow to let caller handle it
            }
        }

        return results;
    }

    /**
     * Fetch payroll data using DataExtractorService directly (internal)
     */
    private static async fetchRawTreeData(division: string, month: number, year: number, authToken: string, includeVirtual: boolean = false) {
        console.log(`[PayrollDataService] Extracting raw data for ${division} (${month}/${year}) includeVirtual=${includeVirtual}...`);

        try {
            const dataExtractor = DataExtractorService.getInstance();
            const result = await this.extractAggregationPayrollData(
                dataExtractor,
                month,
                year,
                division,
                includeVirtual
            );
            const dataRows = result.data_rows || [];

            // Group by gang and calculate totals manually to match the raw-tree endpoint response format
            const gangsMap: Record<string, any[]> = {};
            for (const row of dataRows) {
                const gang = row.gang_code || "UNKNOWN";
                if (!gangsMap[gang]) gangsMap[gang] = [];
                gangsMap[gang].push(row);
            }

            const calculateTotals = (employees: any[], label: string = "TOTAL") => {
                const activeEmployees = employees.filter((emp: any) => {
                    return (Number(emp.jumlah_hk) || 0) > 0;
                });

                const daftarUpahTotals = calculatePayrollTotals(activeEmployees, label);
                const sum = (field: string): number => Math.round(
                    activeEmployees.reduce((total: number, emp: any) => total + (Number(emp[field]) || 0), 0)
                );

                const totals: Record<string, number> = {
                    jumlah_hk: daftarUpahTotals.jumlah_hk,
                    hari_kerja: daftarUpahTotals.hari_kerja,
                    cuti_tahunan_hari: daftarUpahTotals.cuti_tahunan_hari,
                    cuti_sakit_haid_hari: daftarUpahTotals.cuti_sakit_haid_hari,
                    cuti_minggu_hari: daftarUpahTotals.cuti_minggu_hari,
                    cuti_nasional_hari: daftarUpahTotals.cuti_nasional_hari,
                    upah_dasar: sum("upah_dasar"),
                    upah_pokok: daftarUpahTotals.upah_pokok,
                    gaji_pokok: daftarUpahTotals.gaji_pokok,
                    gaji_pokok_ideal: sum("gaji_pokok_ideal"),
                    gaji_pokok_aktual: sum("gaji_pokok_aktual"),
                    beras_jumlah: daftarUpahTotals.beras_jumlah,
                    jabatan_jumlah: daftarUpahTotals.jabatan_jumlah,
                    masa_kerja_tahun: sum("masa_kerja_tahun"),
                    masa_kerja_jumlah: daftarUpahTotals.masa_kerja_jumlah,
                    lembur_jumlah: daftarUpahTotals.lembur_jumlah,
                    total_tunjangan: daftarUpahTotals.total_tunjangan,
                    premi_brondol: daftarUpahTotals.premi_brondol,
                    total_premi: daftarUpahTotals.total_premi,
                    pot_koreksi: daftarUpahTotals.pot_koreksi,
                    potongan_upah_kotor_total: sum("potongan_upah_kotor_total"),
                    jumlah_upah_kotor: daftarUpahTotals.jumlah_upah_kotor,
                    pot_astek: daftarUpahTotals.pot_astek,
                    pot_astek_maj: daftarUpahTotals.pot_astek_maj,
                    pot_bpjs_kesehatan_pekerja: daftarUpahTotals.pot_bpjs_kesehatan_pekerja,
                    pot_bpjs_kesehatan_majikan: daftarUpahTotals.pot_bpjs_kesehatan_majikan,
                    pot_bpjs_pensiun_pekerja: daftarUpahTotals.pot_bpjs_pensiun_pekerja,
                    pot_bpjs_pensiun_majikan: daftarUpahTotals.pot_bpjs_pensiun_majikan,
                    pot_bpjs_pekerja_total: daftarUpahTotals.pot_bpjs_pekerja_total,
                    pot_spsi: daftarUpahTotals.pot_spsi,
                    pot_pph21: daftarUpahTotals.pot_pph21,
                    pph21_ter: sum("pph21_ter"),
                    tarif_pajak_ter: sum("tarif_pajak_ter"),
                    premi_pph: sum("premi_pph"),
                    total_potongan: daftarUpahTotals.total_potongan,
                    total_potongan_bersih: sum("total_potongan_bersih"),
                    upah_bersih: daftarUpahTotals.upah_bersih
                };
                const numericFields = [
                    'pendapatan_thr', 'pendapatan_bonus', 'pendapatan_custom', 'pendapatan_lainnya'
                ];

                for (const field of numericFields) totals[field] = sum(field);
                totals['employee_count'] = activeEmployees.length;

                for (const emp of activeEmployees) {
                    // Sum dynamic premi and potongan separately
                    for (const key of Object.keys(emp)) {
                        if ((key.startsWith('premi_') && !['premi_brondol', 'premi_pph', 'premi_koreksi', 'total_premi'].includes(key)) ||
                            key.startsWith('KOREKSI') || key.startsWith('POTONGAN')) {
                            const val = emp[key];
                            if (typeof val === 'number') {
                                if (!totals[key]) totals[key] = 0;
                                totals[key] += val;
                                
                            }
                        }
                    }
                }
                return totals;
            };

            const gangsList = Object.entries(gangsMap).map(([gang_code, employees]) => ({
                gang_code,
                gang_totals: calculateTotals(employees, `TOTAL ${gang_code}`)
            })).sort((a, b) => a.gang_code.localeCompare(b.gang_code));

            const allEmployees = Object.values(gangsMap).flat();
            const divisionTotals = calculateTotals(allEmployees, "GRAND TOTAL");
            const reconciledGangTotals = reconcileGangTotalsToGrandTotal(
                gangsList.map((gang) => gang.gang_totals as any),
                divisionTotals as any
            );
            gangsList.forEach((gang, index) => {
                gang.gang_totals = reconciledGangTotals[index] || gang.gang_totals;
            });

            return {
                success: true,
                data: {
                    gangs: gangsList,
                    premi_title_map: result.premi_title_map || {},
                    potongan_title_map: result.potongan_title_map || {}
                }
            };
        } catch (error: any) {
            console.error(`[PayrollDataService] Extraction error:`, error);
            throw error;
        }
    }

    private static async extractAggregationPayrollData(
        dataExtractor: any,
        month: number,
        year: number,
        division: string,
        includeVirtual: boolean
    ) {
        if (typeof dataExtractor.extractPayrollDataProgressive === "function") {
            let completeChunk: any = null;

            for await (const chunk of dataExtractor.extractPayrollDataProgressive(
                month,
                year,
                "ALL",
                division,
                Config.DB_PROFILE,
                undefined,
                false
            )) {
                if (chunk?.phase === "complete") {
                    completeChunk = chunk;
                }
            }

            if (completeChunk) {
                const rows = Array.from((completeChunk.gangs || new Map()).values()).flat();
                return {
                    data_rows: rows,
                    dynamic_premi_headers: completeChunk.dynamic_premi_headers || [],
                    dynamic_potongan_headers: completeChunk.dynamic_potongan_headers || [],
                    premi_title_map: completeChunk.dynamic_premi_titles || {},
                    potongan_title_map: completeChunk.dynamic_potongan_titles || {},
                    meta: {
                        execution_time_ms: 0,
                        row_count: rows.length,
                        source: "progressive_complete"
                    }
                };
            }
        }

        // Fallback for tests and older extractor implementations.
        return await dataExtractor.extractPayrollData(
            month,
            year,
            "ALL",
            division,
            null,
            Config.DB_PROFILE,
            includeVirtual,
            false,
            undefined,
            true
        );
    }

    /**
     * Map gang_totals from raw-tree response to AggregationRecord structure
     */
    private static mapGangTotalsToAggregation(
        gangCode: string,
        gangDescription: string,
        totals: any,
        premiTitleMap: Record<string, string>,
        potonganTitleMap: Record<string, string>
    ): AggregationRecord {
        // Build dynamic_premi_data from gang_totals
        // User requested: Total Premi must match the sum of its parts (breakdown)
        // We exclude ONLY pph and koreksi. Tiket is now included as requested.
        const excludePatterns = ['premi_pph', 'premi_koreksi', 'total_premi'];
        const dynamicPremiList: any[] = [];

        for (const [key, value] of Object.entries(totals)) {
            if (key.startsWith('premi_') && (value as number) > 0) {
                // Skip non-displayable/system premi fields
                if (excludePatterns.includes(key)) continue;

                // Get header name from title map or use the key
                const header = premiTitleMap[key] || key.replace('premi_', '').toUpperCase();
                dynamicPremiList.push({
                    header: header,
                    total: value
                });
            }
        }

        // Calculate total_premi as the sum of all dynamic premiums (includes brondol, prunning, etc.)
        const totalPremi = dynamicPremiList.reduce((sum, item) => sum + (item.total || 0), 0);

        // Individual columns for specific reports (historical compatibility)
        const totalPremiBrondol = totals.premi_brondol || 0;
        
        // Extract separated premi components from dynamic list
        let totalPremiInsentif = 0;
        let totalPremiKinerja = 0;
        let totalPremiPrunning = 0;

        for (const item of dynamicPremiList) {
            const headerLower = item.header.toLowerCase();
            // Match Python normalization logic
            if (headerLower.includes('insentif') || headerLower.includes('panen')) {
                totalPremiInsentif += item.total;
            }
            if (headerLower.includes('kinerja')) {
                totalPremiKinerja += item.total;
            }
            if ((headerLower.includes('prun') || headerLower.includes('pruning')) && !headerLower.includes('brondol')) {
                totalPremiPrunning += item.total;
            }
        }

        // [FIX] total_koreksi comes from totals.pot_koreksi (already summed in calculateTotals)
        // It is NOT a dynamic premi - it's a separate deduction field starting with 'pot_'
        // The old code incorrectly searched dynamicPremiList for "koreksi" header which doesn't exist
        const totalKoreksi = totals.pot_koreksi || 0;

        return {
            gang_code: gangCode,
            gang_description: gangDescription,
            total_employees: totals.employee_count || 0,
            total_hk: totals.jumlah_hk || 0,
            total_hari_kerja: totals.hari_kerja || 0,
            total_cuti_tahunan: totals.cuti_tahunan_hari || 0,
            total_cuti_sakit: totals.cuti_sakit_haid_hari || 0,
            total_cuti_minggu: totals.cuti_minggu_hari || 0,
            total_cuti_nasional: totals.cuti_nasional_hari || 0,
            total_upah_dasar: totals.upah_dasar || 0,
            total_upah_pokok: totals.upah_pokok || totals.gaji_pokok || 0,
            total_gaji_pokok: totals.gaji_pokok || 0,
            total_beras: totals.beras_jumlah || 0,
            total_jabatan: totals.jabatan_jumlah || 0,
            total_masa_kerja: totals.masa_kerja_jumlah || 0,
            total_lembur: totals.lembur_jumlah || 0,
            total_tunjangan: totals.total_tunjangan || 0,
            total_premi_brondol: totalPremiBrondol,
            total_premi_prunning: totalPremiPrunning,
            total_premi_insentif: totalPremiInsentif,
            total_premi_kinerja: totalPremiKinerja,
            // [FIX] Use totals.total_premi directly from employee data (matches Daftar Upah)
            // DO NOT recalculate from dynamicPremiList - it may differ due to missing/duplicate items
            total_premi: totals.total_premi || totalPremi,
            total_potongan: totals.total_potongan || 0,
            // Match Daftar Upah grand total: use the actual PPH21 deduction from DB PTRJ,
            // not the calculated TER comparison value.
            total_pph21: totals.pot_pph21 || 0,
            total_bpjs_pekerja: totals.pot_bpjs_pekerja_total || ((totals.pot_bpjs_kesehatan_pekerja || 0) + (totals.pot_bpjs_pensiun_pekerja || 0)),
            total_bpjs_majikan: (totals.pot_bpjs_kesehatan_majikan || 0) + (totals.pot_bpjs_pensiun_majikan || 0),
            total_spsi: totals.pot_spsi || 0,
            total_upah_kotor: totals.jumlah_upah_kotor || 0,
            total_upah_bersih: totals.upah_bersih || 0,
            total_ffb_weight: 0,
            total_weight_tbs: 0,
            dynamic_premi_data: JSON.stringify(dynamicPremiList),
            informasi_tambahan: '',
            total_koreksi: totalKoreksi
        };
    }
}
