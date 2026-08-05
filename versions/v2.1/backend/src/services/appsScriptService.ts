import { Config } from "../config";
import { AggregationRecord } from "./payrollDataService";
import { SummaryService } from "./summaryService";

export class AppsScriptService {
    /**
     * Sync division data to Google Spreadsheet via Apps Script Web App
     * Creates TWO sheets:
     * 1. Main sheet: Simple Daftar Upah (without lembur sub-rows)
     * 2. Analysis sheet: With lembur breakdown sub-rows (comprehensive format)
     */
    static async syncDivisionToSpreadsheet(
        division: string,
        month: number,
        year: number,
        records: any[] // Flat employee records with dynamic fields
    ) {
        const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
        const scriptSecret = process.env.GOOGLE_SCRIPT_SECRET;

        if (!scriptUrl || !scriptSecret) {
            throw new Error("Missing GOOGLE_SCRIPT_URL or GOOGLE_SCRIPT_SECRET in environment variables");
        }

        console.log(`[AppsScriptService] Syncing ${division} (${month}/${year}) to Spreadsheet (2-Sheet Format)...`);

        // 1. Group employees by gang
        const gangsMap = new Map<string, any[]>();
        records.forEach(emp => {
            const gangCode = emp.gang_code || 'UNKNOWN';
            if (!gangsMap.has(gangCode)) {
                gangsMap.set(gangCode, []);
            }
            gangsMap.get(gangCode)!.push(emp);
        });

        // 2. Sort gangs alphabetically
        const sortedGangs = Array.from(gangsMap.keys()).sort();

        // 3. Build DYNAMIC column structure by scanning all records
        const dynamicColumns = this.buildDynamicColumnStructure(records);

        // 4. Build MAIN SHEET (Simple Daftar Upah - no lembur sub-rows)
        const mainSheetData = this.buildMainSheetData(division, sortedGangs, gangsMap, dynamicColumns);

        // 5. Build ANALYSIS SHEET (With lembur breakdown sub-rows)
        const analysisSheetData = this.buildAnalysisSheetData(division, sortedGangs, gangsMap, dynamicColumns);

        // 6. Prepare Payload with SHEETS array
        const payload = {
            secret: scriptSecret,
            month: month,
            year: year,
            format: "DAFTAR_UPAH_MULTISHEET",
            sheets: [
                {
                    name: division, // e.g., "AB1"
                    title: `DAFTAR UPAH - ${division}`,
                    headers: mainSheetData.headers,
                    rows: mainSheetData.rows
                },
                {
                    name: `${division} - ANALISIS`, // e.g., "AB1 - ANALISIS"
                    title: `ANALISIS LEMBUR & PREMI - ${division}`,
                    headers: analysisSheetData.headers,
                    rows: analysisSheetData.rows
                }
            ]
        };

        console.log(`[AppsScriptService] MAIN sheet: ${mainSheetData.rows.length} rows, ${mainSheetData.headers[0].length} cols`);
        console.log(`[AppsScriptService] ANALYSIS sheet: ${analysisSheetData.rows.length} rows, ${analysisSheetData.headers[0].length} cols`);

        // 7. Send to Web App
        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Apps Script Error (${response.status}): ${text}`);
            }

            const result: any = await response.json();

            if (result.status === 'error') {
                throw new Error(`Apps Script Detailed Error: ${result.message}`);
            }

            console.log(`[AppsScriptService] Sync Success for ${division}:`, result);
            return result;

        } catch (error) {
            console.error(`[AppsScriptService] Sync Failed for ${division}:`, error);
            throw error;
        }
    }

    /**
     * Build MAIN SHEET data (Simple Daftar Upah - no lembur sub-rows)
     */
    private static buildMainSheetData(
        division: string,
        sortedGangs: string[],
        gangsMap: Map<string, any[]>,
        dynamicColumns: ReturnType<typeof AppsScriptService.buildDynamicColumnStructure>
    ) {
        const headers = this.buildDynamicHeaders(dynamicColumns);
        const numCols = headers[0].length;
        const spreadsheetRows: any[][] = [];
        let globalNo = 1;

        sortedGangs.forEach(gangCode => {
            const employees = gangsMap.get(gangCode)!;

            // Gang Header Row
            const gangHeaderRow = new Array(numCols).fill("");
            gangHeaderRow[2] = `GANG: ${gangCode}`;
            spreadsheetRows.push(gangHeaderRow);

            // Sort employees by NIK
            employees.sort((a, b) => {
                const nikA = (a.new_nik || a.nik || '').trim();
                const nikB = (b.new_nik || b.nik || '').trim();
                return nikA.localeCompare(nikB, undefined, { numeric: true, sensitivity: 'base' });
            });

            // Gang Total Row
            const gangTotal = new Array(numCols).fill(0);
            gangTotal[0] = "";
            gangTotal[1] = "";
            gangTotal[2] = "TOTAL GANG";

            // Employee rows (NO lembur sub-rows - simple format)
            employees.forEach(emp => {
                const mainRow = this.buildDynamicEmployeeRow(emp, globalNo++, dynamicColumns);
                spreadsheetRows.push(mainRow);
                this.accumulateDynamicTotal(gangTotal, mainRow);
            });

            // Add Gang Total Row
            spreadsheetRows.push(gangTotal);
        });

        // Grand Total Row
        const grandTotal = this.calculateDynamicGrandTotalSimple(spreadsheetRows, numCols);
        spreadsheetRows.push(grandTotal);

        return { headers, rows: spreadsheetRows };
    }

    /**
     * Build ANALYSIS SHEET data - Multiple separate sections:
     * 1. Analisis Lembur (per task breakdown)
     * 2. Analisis Premi (per jenis breakdown)
     * 3. Analisis Upah Bersih (summary)
     */
    private static buildAnalysisSheetData(
        division: string,
        sortedGangs: string[],
        gangsMap: Map<string, any[]>,
        dynamicColumns: ReturnType<typeof AppsScriptService.buildDynamicColumnStructure>
    ) {
        const spreadsheetRows: any[][] = [];
        let currentRow = 1;

        // Build each section
        const lemburSection = this.buildLemburAnalysisSection(sortedGangs, gangsMap);
        const premiSection = this.buildPremiAnalysisSection(sortedGangs, gangsMap, dynamicColumns);
        const upahBersihSection = this.buildUpahBersihAnalysisSection(sortedGangs, gangsMap);

        // Add spacing and headers for each section
        spreadsheetRows.push([""]); currentRow++; // Empty row before section 1

        // SECTION 1: ANALISIS LEMBUR
        spreadsheetRows.push(["═══════════════════════════════════════════════════════════════"]);
        spreadsheetRows.push(["📊 ANALISIS LEMBUR - " + division]);
        spreadsheetRows.push(["═══════════════════════════════════════════════════════════════"]);
        spreadsheetRows.push([""]); currentRow += 4;

        // Lembur headers
        spreadsheetRows.push(["NO", "NIK", "NAMA", "GANG", "TASK", "JAM", "RUPIAH"]);
        spreadsheetRows.push(["────", "────", "────", "────", "────", "────", "────"]);
        currentRow += 2;
        spreadsheetRows.push(...lemburSection.rows);
        currentRow += lemburSection.rows.length;

        // Spacer
        spreadsheetRows.push([""]);
        spreadsheetRows.push([""]);
        currentRow += 2;

        // SECTION 2: ANALISIS PREMI
        spreadsheetRows.push(["═══════════════════════════════════════════════════════════════"]);
        spreadsheetRows.push(["📊 ANALISIS PREMI - " + division]);
        spreadsheetRows.push(["═══════════════════════════════════════════════════════════════"]);
        spreadsheetRows.push([""]); currentRow += 4;

        // Premi headers (dynamic columns based on actual premi fields)
        const premiHeaders = ["NO", "NIK", "NAMA", "GANG", "BRONDOL", "PRUNING", ...dynamicColumns.dynamicPremiFields.map(f => f.replace('premi_', '').toUpperCase()), "TOTAL PREMI"];
        spreadsheetRows.push(premiHeaders);
        const separatorRow = premiHeaders.map(() => "────");
        spreadsheetRows.push(separatorRow);
        currentRow += 2;
        spreadsheetRows.push(...premiSection.rows);
        currentRow += premiSection.rows.length;

        // Spacer
        spreadsheetRows.push([""]);
        spreadsheetRows.push([""]);
        currentRow += 2;

        // SECTION 3: ANALISIS UPAH BERSIH
        spreadsheetRows.push(["═══════════════════════════════════════════════════════════════"]);
        spreadsheetRows.push(["📊 ANALISIS UPAH BERSIH - " + division]);
        spreadsheetRows.push(["═══════════════════════════════════════════════════════════════"]);
        spreadsheetRows.push([""]); currentRow += 4;

        // Upah Bersih headers
        spreadsheetRows.push(["NO", "NIK", "NAMA", "GANG", "HK", "GAJI POKOK", "TUNJANGAN", "PREMI", "POTONGAN", "UPAH BERSIH"]);
        spreadsheetRows.push(["────", "────", "────", "────", "────", "────", "────", "────", "────", "────"]);
        currentRow += 2;
        spreadsheetRows.push(...upahBersihSection.rows);
        currentRow += upahBersihSection.rows.length;

        // Return with simple headers (will be handled differently in Apps Script)
        return {
            headers: [["ANALISIS MULTI-SECTION"]],
            rows: spreadsheetRows
        };
    }

    /**
     * Build Lembur Analysis Section - Detail breakdown per task
     */
    private static buildLemburAnalysisSection(
        sortedGangs: string[],
        gangsMap: Map<string, any[]>
    ) {
        const rows: any[][] = [];
        let globalNo = 1;
        let grandTotalJam = 0;
        let grandTotalRupiah = 0;

        sortedGangs.forEach(gangCode => {
            const employees = gangsMap.get(gangCode)!;

            // Sort employees by NIK
            employees.sort((a, b) => {
                const nikA = (a.new_nik || a.nik || '').trim();
                const nikB = (b.new_nik || b.nik || '').trim();
                return nikA.localeCompare(nikB, undefined, { numeric: true, sensitivity: 'base' });
            });

            let gangTotalJam = 0;
            let gangTotalRupiah = 0;

            employees.forEach(emp => {
                const hasLembur = emp.lembur_records && Array.isArray(emp.lembur_records) && emp.lembur_records.length > 0;

                if (hasLembur) {
                    // Group by task_desc
                    const lemburByTask: Record<string, { hours: number; amount: number; count: number }> = {};
                    emp.lembur_records.forEach((record: any) => {
                        const taskDesc = record.task_desc || record.task_code || 'LAINNYA';
                        if (!lemburByTask[taskDesc]) {
                            lemburByTask[taskDesc] = { hours: 0, amount: 0, count: 0 };
                        }
                        lemburByTask[taskDesc].hours += (record.hours || 0);
                        lemburByTask[taskDesc].amount += (record.amount || 0);
                        lemburByTask[taskDesc].count += 1;
                    });

                    // Add rows for each task
                    Object.entries(lemburByTask).forEach(([taskDesc, data]) => {
                        rows.push([
                            globalNo,
                            emp.new_nik || emp.nik || "",
                            emp.nama || "",
                            emp.gang_code || "",
                            `${taskDesc} (${data.count}x)`,
                            data.hours,
                            data.amount
                        ]);
                        gangTotalJam += data.hours;
                        gangTotalRupiah += data.amount;
                    });

                    globalNo++;
                }
            });

            // Gang total row for lembur
            if (gangTotalJam > 0 || gangTotalRupiah > 0) {
                rows.push([
                    "",
                    "",
                    "",
                    `TOTAL GANG: ${gangCode}`,
                    "SUBTOTAL",
                    gangTotalJam,
                    gangTotalRupiah
                ]);
                grandTotalJam += gangTotalJam;
                grandTotalRupiah += gangTotalRupiah;
            }
        });

        // Grand total row
        rows.push([
            "",
            "",
            "",
            "GRAND TOTAL",
            "TOTAL LEMBUR",
            grandTotalJam,
            grandTotalRupiah
        ]);

        return { rows };
    }

    /**
     * Build Premi Analysis Section - Detail breakdown per jenis
     */
    private static buildPremiAnalysisSection(
        sortedGangs: string[],
        gangsMap: Map<string, any[]>,
        dynamicColumns: ReturnType<typeof AppsScriptService.buildDynamicColumnStructure>
    ) {
        const rows: any[][] = [];
        let globalNo = 1;
        const val = (v: any) => parseFloat(v) || 0;

        // Build grand total array
        const grandTotal = new Array(4 + 2 + dynamicColumns.dynamicPremiFields.length + 1).fill(0);
        grandTotal[2] = "GRAND TOTAL";

        sortedGangs.forEach(gangCode => {
            const employees = gangsMap.get(gangCode)!;

            // Sort employees by NIK
            employees.sort((a, b) => {
                const nikA = (a.new_nik || a.nik || '').trim();
                const nikB = (b.new_nik || b.nik || '').trim();
                return nikA.localeCompare(nikB, undefined, { numeric: true, sensitivity: 'base' });
            });

            // Gang total array
            const gangTotal = new Array(grandTotal.length).fill(0);
            gangTotal[2] = `TOTAL GANG: ${gangCode}`;

            employees.forEach(emp => {
                const row: any[] = [
                    globalNo++,
                    emp.new_nik || emp.nik || "",
                    emp.nama || "",
                    emp.gang_code || "",
                    val(emp.premi_brondol),
                    val(emp.premi_pruning)
                ];

                // Dynamic premi fields
                dynamicColumns.dynamicPremiFields.forEach(field => {
                    row.push(val(emp[field]));
                });

                // Total premi
                row.push(val(emp.total_premi));

                rows.push(row);

                // Accumulate to gang total
                for (let i = 4; i < row.length; i++) {
                    gangTotal[i] += val(row[i]);
                    grandTotal[i] += val(row[i]);
                }
            });

            // Add gang total row
            if (employees.length > 0) {
                rows.push(gangTotal);
            }
        });

        // Add grand total row
        rows.push(grandTotal);

        return { rows };
    }

    /**
     * Build Upah Bersih Analysis Section - Summary
     */
    private static buildUpahBersihAnalysisSection(
        sortedGangs: string[],
        gangsMap: Map<string, any[]>
    ) {
        const rows: any[][] = [];
        let globalNo = 1;
        const val = (v: any) => parseFloat(v) || 0;

        // Grand total
        let grandTotalHK = 0;
        let grandTotalGajiPokok = 0;
        let grandTotalTunjangan = 0;
        let grandTotalPremi = 0;
        let grandTotalPotongan = 0;
        let grandTotalUpahBersih = 0;

        sortedGangs.forEach(gangCode => {
            const employees = gangsMap.get(gangCode)!;

            // Sort employees by NIK
            employees.sort((a, b) => {
                const nikA = (a.new_nik || a.nik || '').trim();
                const nikB = (b.new_nik || b.nik || '').trim();
                return nikA.localeCompare(nikB, undefined, { numeric: true, sensitivity: 'base' });
            });

            let gangTotalHK = 0;
            let gangTotalGajiPokok = 0;
            let gangTotalTunjangan = 0;
            let gangTotalPremi = 0;
            let gangTotalPotongan = 0;
            let gangTotalUpahBersih = 0;

            employees.forEach(emp => {
                const gajiPokok = val(emp.gaji_pokok);
                const tunjangan = val(emp.total_tunjangan);
                const premi = val(emp.total_premi);
                const potongan = val(emp.total_potongan_bersih);
                const upahBersih = val(emp.upah_bersih);

                rows.push([
                    globalNo++,
                    emp.new_nik || emp.nik || "",
                    emp.nama || "",
                    emp.gang_code || "",
                    val(emp.jumlah_hk),
                    gajiPokok,
                    tunjangan,
                    premi,
                    potongan,
                    upahBersih
                ]);

                gangTotalHK += val(emp.jumlah_hk);
                gangTotalGajiPokok += gajiPokok;
                gangTotalTunjangan += tunjangan;
                gangTotalPremi += premi;
                gangTotalPotongan += potongan;
                gangTotalUpahBersih += upahBersih;
            });

            // Gang total row
            if (employees.length > 0) {
                rows.push([
                    "",
                    "",
                    "",
                    `TOTAL GANG: ${gangCode}`,
                    gangTotalHK,
                    gangTotalGajiPokok,
                    gangTotalTunjangan,
                    gangTotalPremi,
                    gangTotalPotongan,
                    gangTotalUpahBersih
                ]);

                grandTotalHK += gangTotalHK;
                grandTotalGajiPokok += gangTotalGajiPokok;
                grandTotalTunjangan += gangTotalTunjangan;
                grandTotalPremi += gangTotalPremi;
                grandTotalPotongan += gangTotalPotongan;
                grandTotalUpahBersih += gangTotalUpahBersih;
            }
        });

        // Grand total row
        rows.push([
            "",
            "",
            "",
            "GRAND TOTAL",
            grandTotalHK,
            grandTotalGajiPokok,
            grandTotalTunjangan,
            grandTotalPremi,
            grandTotalPotongan,
            grandTotalUpahBersih
        ]);

        return { rows };
    }

    /**
     * Build lembur sub-rows for comprehensive format
     */
    private static buildLemburSubRows(emp: any, mainRow: any[], numCols: number): any[][] {
        const subRows: any[][] = [];
        const val = (v: any) => parseFloat(v) || 0;

        // Group by task_desc
        const lemburByTask: Record<string, { hours: number; amount: number; count: number }> = {};
        emp.lembur_records.forEach((record: any) => {
            const taskDesc = record.task_desc || record.task_code || 'LAINNYA';
            if (!lemburByTask[taskDesc]) {
                lemburByTask[taskDesc] = { hours: 0, amount: 0, count: 0 };
            }
            lemburByTask[taskDesc].hours += val(record.hours);
            lemburByTask[taskDesc].amount += val(record.amount);
            lemburByTask[taskDesc].count += 1;
        });

        const baseColCount = mainRow.length - 2; // Exclude lembur columns (JAM, RUPIAH)

        // Add sub-row for each task
        Object.entries(lemburByTask).forEach(([taskDesc, data]) => {
            const subRow = new Array(numCols).fill("");
            subRow[0] = "";
            subRow[1] = "";
            subRow[2] = `└─ ${taskDesc} (${data.count}x)`;
            subRow[3] = "";
            for (let i = 4; i < baseColCount; i++) {
                subRow[i] = i === 4 ? "-" : "";
            }
            subRow[numCols - 2] = data.hours;
            subRow[numCols - 1] = data.amount;
            subRows.push(subRow);
        });

        // Add summary sub-row
        const totalHours = Object.values(lemburByTask).reduce((sum, t) => sum + t.hours, 0);
        const totalAmount = Object.values(lemburByTask).reduce((sum, t) => sum + t.amount, 0);
        const totalTasks = Object.keys(lemburByTask).length;
        const totalRecords = Object.values(lemburByTask).reduce((sum, t) => sum + t.count, 0);

        const summaryRow = new Array(numCols).fill("");
        summaryRow[0] = "";
        summaryRow[1] = "";
        summaryRow[2] = `✓ Total (${totalTasks} jenis, ${totalRecords} transaksi)`;
        summaryRow[3] = "";
        for (let i = 4; i < baseColCount; i++) {
            summaryRow[i] = i === 4 ? "-" : "";
        }
        summaryRow[numCols - 2] = totalHours;
        summaryRow[numCols - 1] = totalAmount;
        subRows.push(summaryRow);

        return subRows;
    }

    /**
     * Calculate grand total for MAIN sheet (simple - no sub-rows to skip)
     */
    private static calculateDynamicGrandTotalSimple(rows: any[][], numCols: number): any[] {
        const grandTotal = new Array(numCols).fill(0);
        grandTotal[0] = "";
        grandTotal[1] = "";
        grandTotal[2] = "GRAND TOTAL";

        rows.forEach(row => {
            const thirdCol = row[2] ? row[2].toString() : "";
            // Skip gang headers and totals only
            if (!thirdCol.startsWith("GANG") && !thirdCol.includes("TOTAL")) {
                this.accumulateDynamicTotal(grandTotal, row);
            }
        });

        return grandTotal;
    }

    /**
     * Calculate grand total for ANALYSIS sheet (skip lembur sub-rows)
     */
    private static calculateDynamicGrandTotalAnalysis(rows: any[][], numCols: number): any[] {
        const grandTotal = new Array(numCols).fill(0);
        grandTotal[0] = "";
        grandTotal[1] = "";
        grandTotal[2] = "GRAND TOTAL";

        rows.forEach(row => {
            const thirdCol = row[2] ? row[2].toString() : "";
            // Skip gang headers, totals, AND lembur sub-rows
            if (!thirdCol.startsWith("GANG") &&
                !thirdCol.includes("TOTAL") &&
                !thirdCol.startsWith("└─") &&
                !thirdCol.startsWith("✓")) {
                this.accumulateDynamicTotal(grandTotal, row);
            }
        });

        return grandTotal;
    }

    /**
     * Build dynamic column structure by scanning all employee records
     * Returns list of all unique dynamic field names for premi and potongan, plus lembur tasks
     */
    private static buildDynamicColumnStructure(records: any[]) {
        const dynamicPremiFields = new Set<string>();
        const dynamicPotonganFields = new Set<string>();
        const lemburTasks = new Set<string>();

        // Scan all records for dynamic fields
        records.forEach(emp => {
            // Find all fields starting with 'premi_' except static ones
            Object.keys(emp).forEach(key => {
                if (key.startsWith('premi_') &&
                    key !== 'premi_brondol' &&
                    key !== 'premi_pruning' &&
                    key !== 'total_premi') {
                    dynamicPremiFields.add(key);
                }

                // Find all fields starting with 'pot_' except static ones
                if (key.startsWith('pot_') &&
                    key !== 'pot_astek' &&
                    key !== 'pot_bpjs_kesehatan_pekerja' &&
                    key !== 'pot_bpjs_kesehatan_majikan' &&
                    key !== 'pot_spsi' &&
                    key !== 'pot_pph21' &&
                    key !== 'pot_pph21_ter' &&
                    key !== 'total_potongan_bersih') {
                    dynamicPotonganFields.add(key);
                }
            });

            // Collect unique lembur task descriptions
            if (emp.lembur_records && Array.isArray(emp.lembur_records)) {
                emp.lembur_records.forEach((record: any) => {
                    const taskDesc = record.task_desc || record.task_code || 'LAINNYA';
                    lemburTasks.add(taskDesc);
                });
            }
        });

        return {
            dynamicPremiFields: Array.from(dynamicPremiFields).sort(),
            dynamicPotonganFields: Array.from(dynamicPotonganFields).sort(),
            lemburTasks: Array.from(lemburTasks).sort()
        };
    }

    /**
     * Build MULTI-LEVEL headers dynamically based on actual columns present
     * Returns array of arrays where each sub-array is a header level
     */
    private static buildDynamicHeaders(dynamicCols: ReturnType<typeof AppsScriptService.buildDynamicColumnStructure>): string[][] {
        const level0: string[] = [];  // Top level (main categories)
        const level1: string[] = [];  // Second level (sub-categories)
        const level2: string[] = [];  // Third level (detail sub-categories)
        const level3: string[] = [];  // Bottom level (column names)

        // Helper to add empty value for spanning
        const empty = "";

        // Count columns for positioning
        let colIndex = 0;

        // IDENTITAS (4 columns)
        for (let i = 0; i < 4; i++) {
            level0.push('IDENTITAS');
            level1.push(empty);
            level2.push(empty);
        }
        level3.push('NO', 'NIK', 'NAMA', 'JABATAN');
        colIndex += 4;

        // ABSENSI (6 columns)
        // First 1 column: KEHADIRAN
        level0.push('ABSENSI');
        level1.push('KEHADIRAN');
        level2.push(empty);
        level3.push('AN');
        colIndex++;

        // Next 4 columns: KETIDAKHADIRAN
        for (let i = 0; i < 4; i++) {
            level0.push('ABSENSI');
            level1.push('KETIDAKHADIRAN');
            level2.push(empty);
        }
        level3.push('CUTI', 'SAKIT+HAID', 'MINGGU', 'NASIONAL');
        colIndex += 4;

        // Last column: REKAP
        level0.push('ABSENSI');
        level1.push('REKAP');
        level2.push(empty);
        level3.push('JUMLAH HK');
        colIndex++;

        // GAJI POKOK (3 columns)
        for (let i = 0; i < 3; i++) {
            level0.push('GAJI POKOK');
            level1.push(empty);
            level2.push(empty);
        }
        level3.push('JUMLAH', 'IDEAL', 'AKTUAL');
        colIndex += 3;

        // TUNJANGAN (5 columns)
        level0.push('TUNJANGAN');
        level1.push('BERAS');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        level0.push('TUNJANGAN');
        level1.push('JABATAN');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        level0.push('TUNJANGAN');
        level1.push('MASA KERJA');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        level0.push('TUNJANGAN');
        level1.push('LEMBUR');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        level0.push('TUNJANGAN');
        level1.push(empty);
        level2.push(empty);
        level3.push('TOTAL');
        colIndex++;

        // PREMI - Brondol, Pruning, Dynamic fields, Total
        level0.push('PREMI');
        level1.push('BRONDOL');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        level0.push('PREMI');
        level1.push('PRUNING');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        dynamicCols.dynamicPremiFields.forEach(field => {
            level0.push('PREMI');
            level1.push('PREMI DINAMIS');
            level2.push(empty);
            const displayName = field.replace('premi_', '').replace(/_/g, ' ').toUpperCase();
            level3.push(displayName);
            colIndex++;
        });

        level0.push('PREMI');
        level1.push(empty);
        level2.push(empty);
        level3.push('TOTAL');
        colIndex++;

        // POTONGAN - Dynamic fields, then static
        dynamicCols.dynamicPotonganFields.forEach(field => {
            level0.push('POTONGAN');
            level1.push('POTONGAN DINAMIS');
            level2.push(empty);
            const displayName = field.replace('pot_', '').replace(/_/g, ' ').toUpperCase();
            level3.push(displayName);
            colIndex++;
        });

        // Static potongan fields (matching data row: pot_astek, pot_bpjs_kesehatan_pekerja, pot_spsi, pot_pph21, total_potongan_bersih)
        // ASTEK
        level0.push('POTONGAN');
        level1.push('ASTEK');
        level2.push(empty);
        level3.push('PEKERJA');
        colIndex++;

        // BPJS
        level0.push('POTONGAN');
        level1.push('BPJS');
        level2.push('PEKERJA');
        level3.push('JUMLAH');
        colIndex++;

        // SPSI
        level0.push('POTONGAN');
        level1.push('SPSI');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        // PPH21
        level0.push('POTONGAN');
        level1.push('PPH21');
        level2.push(empty);
        level3.push('JUMLAH');
        colIndex++;

        // Total potongan
        level0.push('POTONGAN');
        level1.push(empty);
        level2.push(empty);
        level3.push('TOTAL');
        colIndex++;

        // TOTAL (2 columns)
        for (let i = 0; i < 2; i++) {
            level0.push('TOTAL');
            level1.push(empty);
            level2.push(empty);
        }
        level3.push('KOTOR', 'BERSIH');

        // Format SAMA dengan Comprehensive Report
        // Analisis Lembur: JAM, RUPIAH (2 kolom saja, sama seperti di comprehensive)
        level0.push('LEMBUR');
        level1.push(empty);
        level2.push(empty);
        level3.push('JAM');
        colIndex++;

        level0.push('LEMBUR');
        level1.push(empty);
        level2.push(empty);
        level3.push('RUPIAH');
        colIndex++;

        return [level0, level1, level2, level3];
    }

    /**
     * Build employee data row dynamically based on actual columns
     */
    private static buildDynamicEmployeeRow(emp: any, no: number, dynamicCols: ReturnType<typeof AppsScriptService.buildDynamicColumnStructure>): any[] {
        const val = (v: any) => parseFloat(v) || 0;
        const row: any[] = [];

        // IDENTITAS (4)
        row.push(no, emp.new_nik || emp.nik || "", emp.nama || "", emp.jabatan_estate || emp.jabatan || "");

        // ABSENSI (6)
        row.push(
            val(emp.hari_kerja),
            val(emp.cuti_tahunan_hari),
            val(emp.cuti_sakit_haid_hari),
            val(emp.cuti_minggu_hari),
            val(emp.cuti_nasional_hari),
            val(emp.jumlah_hk)
        );

        // GAJI POKOK (3)
        row.push(val(emp.gaji_pokok), val(emp.gaji_pokok_ideal), val(emp.gaji_pokok_aktual));

        // TUNJANGAN (5)
        row.push(
            val(emp.beras_jumlah),
            val(emp.jabatan_jumlah),
            val(emp.masa_kerja_jumlah),
            val(emp.lembur_jumlah),
            val(emp.total_tunjangan)
        );

        // PREMI - Static
        row.push(val(emp.premi_brondol), val(emp.premi_pruning));

        // PREMI - Dynamic
        dynamicCols.dynamicPremiFields.forEach(field => {
            row.push(val(emp[field]));
        });

        // PREMI - Total
        row.push(val(emp.total_premi));

        // POTONGAN - Dynamic
        dynamicCols.dynamicPotonganFields.forEach(field => {
            row.push(val(emp[field]));
        });

        // POTONGAN - Static
        row.push(
            val(emp.pot_astek),
            val(emp.pot_bpjs_kesehatan_pekerja),
            val(emp.pot_spsi),
            val(emp.pot_pph21),
            val(emp.total_potongan_bersih)
        );

        // TOTAL (2)
        row.push(val(emp.jumlah_upah_kotor), val(emp.upah_bersih));

        // LEMBUR (2 columns) - Format sama dengan comprehensive
        row.push(val(emp.lembur_jam), val(emp.lembur_jumlah));

        return row;
    }

    /**
     * Accumulate values into total array (dynamic)
     */
    private static accumulateDynamicTotal(total: any[], row: any[]): void {
        // Skip label columns (indices 0-3)
        for (let i = 4; i < row.length; i++) {
            if (i < row.length) {
                const value = parseFloat(row[i]) || 0;
                total[i] = (total[i] as number) + value;
            }
        }
    }

    /**
     * Calculate grand total from all employee rows (dynamic)
     */
    private static calculateDynamicGrandTotal(rows: any[][], numCols: number): any[] {
        const grandTotal = new Array(numCols).fill(0);
        grandTotal[0] = ""; // No
        grandTotal[1] = ""; // NIK
        grandTotal[2] = "GRAND TOTAL"; // Nama

        // Sum only employee main rows (not gang headers, totals, or lembur sub-rows)
        rows.forEach(row => {
            const thirdCol = row[2] ? row[2].toString() : "";

            // Skip non-employee rows
            // Gang headers: starts with "GANG:"
            // Gang totals: "TOTAL GANG"
            // Grand total: "GRAND TOTAL"
            // Lembur sub-rows: starts with "└─" or "✓ Total"
            if (!thirdCol.startsWith("GANG") &&
                !thirdCol.includes("TOTAL") &&
                !thirdCol.startsWith("└─") &&
                !thirdCol.startsWith("✓")) {
                this.accumulateDynamicTotal(grandTotal, row);
            }
        });

        return grandTotal;
    }

    /**
     * Sync Dashboard Summary Data (High Level Overview)
     */
    static async syncDashboard(month: number, year: number) {
        const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
        const scriptSecret = process.env.GOOGLE_SCRIPT_SECRET;

        if (!scriptUrl || !scriptSecret) {
            throw new Error("Missing GOOGLE_SCRIPT_URL or GOOGLE_SCRIPT_SECRET");
        }

        console.log(`[AppsScriptService] Syncing DASHBOARD (${month}/${year})...`);

        // 1. Fetch all necessary data
        const summaryService = SummaryService.getInstance();

        // A. Comparison Data (includes current & previous totals)
        const comparisonData = await summaryService.getAllDivisionsComparison(month, year);

        // B. Impact Analysis
        const impactData = await summaryService.getImpactReportData(month, year);

        // 2. Structure Payload for GAS
        const payload = {
            secret: scriptSecret,
            type: "DASHBOARD",
            month: month,
            year: year,
            data: {
                kpi: comparisonData.kpi_summary,
                comparisons: comparisonData.divisions,
                impact: {
                    hk_analysis: impactData.hk_analysis,
                    main_table: impactData.main_table,
                    pruning_table: impactData.pruning_table
                }
            }
        };

        // 3. Send to Web App
        try {
            const response = await fetch(scriptUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Apps Script Error (${response.status}): ${text}`);
            }

            const result: any = await response.json();
            console.log(`[AppsScriptService] Dashboard Sync Success:`, result);
            return result;

        } catch (error) {
            console.error(`[AppsScriptService] Dashboard Sync Failed:`, error);
            throw error;
        }
    }
}
