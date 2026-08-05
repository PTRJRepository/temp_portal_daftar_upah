/**
 * Wages Routes
 * 
 * API endpoints untuk operasi wages comparison:
 * - GET /payroll/wages/period/:month/:year - Get wages data for period
 * - GET /payroll/wages/employee/:empCode/history - Get employee wages history
 * - GET /payroll/wages/comparison/:month/:year - Get comparison data
 * - GET /payroll/wages/periods/available - Get available periods
 */

import { Elysia, t } from "elysia";
import { wagesService } from "../services/wagesService";
import { dataExtractorService } from "../services/dataExtractorService";
import { divisionDefinition } from "../services/divisionDefinition";
import { summaryService } from "../services/summaryService";
import { AuthService } from "../services/authService";
import { Database } from "../db/client";
import { User } from "../types/user";
import { resolveUserFromHeaders } from "../utils/authBypass";

const authService = AuthService.getInstance();

// Helper to fetch tonase from mill database
async function fetchTonaseForWagesComparison(month: number, year: number): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    try {
        const millDb = Database.getMillInstance();
        
        const rows = await millDb.query<{ CustomerCode: string; SupplierName: string; total_weight: string }>(`
            SELECT
                T.[CustomerCode],
                S.[Name] AS SupplierName,
                SUM(CAST(T.[NetWeight] AS DECIMAL(18,2))) / 1000.0 AS total_weight
            FROM [dbo].[WM_TICKET] T
            LEFT JOIN [dbo].[PU_SUPPLIER] S ON T.[CustomerCode] = S.[SupplierCode]
            WHERE T.[CustomerCode] LIKE 'PTRJ%'
              AND MONTH(T.[DateReceived]) = ?
              AND YEAR(T.[DateReceived]) = ?
              AND T.[ProductCode] = 'FFB'
            GROUP BY T.[CustomerCode], S.[Name]
        `, [month, year]);

        const divisionCodes = ['P1A', 'P1B', 'P2A', 'P2B', 'AB1', 'AB2', 'ARC', 'DME', 'ARA', 'IJL', 'INF', 'NRS', 'WKS_PG', 'WKS_AR'];

        for (const divCode of divisionCodes) {
            let divTonase = 0;
            for (const row of rows) {
                const supplierName = (row.SupplierName || '').toUpperCase();
                const customerCode = (row.CustomerCode || '').toUpperCase();
                const weight = parseFloat(row.total_weight) || 0;

                if (supplierName.includes(divCode) || customerCode.includes(divCode)) {
                    divTonase += weight;
                }
            }
            if (divTonase > 0) {
                result[divCode] = divTonase;
            }
        }
    } catch (error: any) {
        console.error("[WagesRoutes] Error fetching tonase:", error.message);
    }
    return result;
}

// Helper to get user from header
async function getUserFromHeader(headers: Record<string, string | undefined>): Promise<User | null> {
    return resolveUserFromHeaders(headers, authService);
}

// Helper to get month name
function getMonthName(month: number): string {
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return months[month - 1] || '';
}

export const wagesRoutes = new Elysia({ prefix: "/payroll/wages" })
    .derive(async ({ headers }) => {
        const user = await getUserFromHeader(headers);
        return { currentUser: user };
    })
    .onBeforeHandle(({ currentUser, set }) => {
        if (!currentUser) {
            set.status = 401;
            return { message: "Unauthorized" };
        }
    })

    // ========================
    // GET AVAILABLE PERIODS
    // ========================
    .get("/periods/available", async () => {
        try {
            const periods = await wagesService.getAvailableWagesPeriods();
            return {
                success: true,
                count: periods.length,
                data: periods
            };
        } catch (e: any) {
            console.error("[WagesRoutes] Error fetching available periods:", e);
            return { success: false, error: e.message, data: [] };
        }
    })

    // ========================
    // GET WAGES BY PERIOD
    // ========================
    .get("/period/:month/:year", async ({ params, query, set }) => {
        try {
            const month = parseInt(params.month);
            const year = parseInt(params.year);
            const divisionCode = query.division as string | undefined;

            if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
                set.status = 400;
                return { error: "Invalid month or year" };
            }

            const wages = await wagesService.getWagesByPeriod(month, year, divisionCode);

            return {
                success: true,
                period: {
                    month,
                    year,
                    label: `${getMonthName(month)} ${year}`
                },
                count: wages.length,
                data: wages
            };
        } catch (e: any) {
            console.error("[WagesRoutes] Error fetching wages by period:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            division: t.Optional(t.String())
        })
    })

    // ========================
    // GET ALL DIVISIONS RECAP (THR Mode) - No thumbprint, just totals
    // Uses extend_db_ptrj aggregation data (like summary report)
    // ========================
    .get("/recap-all/:month/:year", async ({ params, query, set }) => {
        try {
            const month = parseInt(params.month);
            const year = parseInt(params.year);
            const includeThumbprint = query.include_thumbprint === 'true';

            if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
                set.status = 400;
                return { error: "Invalid month or year" };
            }

            // List of divisions to include (real divisions + virtual divisions)
            // NOTE: WORKSHOP is computed from WKS_PG + WKS_AR, NOT queried
            const realDivisions = ['P1A', 'P1B', 'P2A', 'P2B', 'AB1', 'AB2', 'ARC', 'ARA', 'DME', 'IJL'];
            const virtualDivisions = ['INF', 'NRS', 'WKS_PG', 'WKS_AR']; // WORKSHOP excluded - computed later
            const divisions = [...realDivisions, ...virtualDivisions];

            // Use extend_db_ptrj database to get aggregation data
            const extendDb = Database.getExtendedInstance();

            // Get all gang codes for each division (including AMC/HMC for WKS_PG/WKS_AR)
            const divisionGangs: Record<string, string[]> = {};
            for (const divCode of divisions) {
                const gangs = await divisionDefinition.getGangsForDivision(divCode);
                divisionGangs[divCode] = gangs.map(g => g.gang_code);
            }

            // Build query to get all data for these gangs
            const allGangs = Object.values(divisionGangs).flat();
            if (allGangs.length === 0) {
                return {
                    success: true,
                    period: { month, year, label: `${getMonthName(month)} ${year}` },
                    mode: 'recap_all',
                    include_thumbprint: includeThumbprint,
                    divisions: [],
                    grand_total: {
                        total_karyawan: 0,
                        total_hk: 0,
                        total_upah_pokok: 0,
                        total_tunjangan: 0,
                        total_premi: 0,
                        total_lembur: 0,
                        total_potongan: 0,
                        total_upah_bersih: 0
                    }
                };
            }

            const placeholders = allGangs.map(() => '?').join(',');
            const query_sql = `
                WITH latest_rows AS (
                    SELECT
                        h.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY h.period_month, h.period_year, h.gang_code
                            ORDER BY COALESCE(h.updated_at, h.created_at) DESC, h.id DESC
                        ) as row_rank
                    FROM dbo.daftar_upah_aggregation_history h
                    WHERE h.period_month = ? AND h.period_year = ?
                    AND h.gang_code IN (${placeholders})
                    AND h.division_code != 'WORKSHOP'
                )
                SELECT
                    division_code, gang_code,
                    SUM(total_employees) as total_karyawan,
                    SUM(total_hk) as total_hk,
                    SUM(total_upah_pokok) as total_upah_pokok,
                    SUM(total_tunjangan) as total_tunjangan,
                    SUM(total_premi) as total_premi,
                    SUM(total_lembur) as total_lembur,
                    SUM(total_potongan) as total_potongan,
                    SUM(total_upah_bersih) as total_upah_bersih
                FROM latest_rows
                WHERE row_rank = 1
                GROUP BY division_code, gang_code
            `;

            const rows = await extendDb.query<any>(query_sql, [month, year, ...allGangs]);

            // Group by division - IMPORTANT: Use the division code from our predefined list,
            // NOT from the database row's division_code (which may differ)
            const divAggregation: Record<string, any> = {};
            for (const divCode of divisions) {
                divAggregation[divCode] = {
                    total_karyawan: 0,
                    total_hk: 0,
                    total_upah_pokok: 0,
                    total_tunjangan: 0,
                    total_premi: 0,
                    total_lembur: 0,
                    total_potongan: 0,
                    total_upah_bersih: 0
                };
            }

            // For each row, find which division this gang belongs to and sum there
            // IMPORTANT: Each gang should only be counted ONCE for its PRIMARY division
            for (const row of rows) {
                const gangCode = row.gang_code;

                // Find which division this gang belongs to (PRIMARY only, skip WORKSHOP)
                for (const divCode of divisions) {
                    if (divisionGangs[divCode].includes(gangCode)) {
                        // This gang belongs to this division, add its values
                        divAggregation[divCode].total_karyawan += (row.total_karyawan || 0);
                        divAggregation[divCode].total_hk += (row.total_hk || 0);
                        divAggregation[divCode].total_upah_pokok += (row.total_upah_pokok || 0);
                        divAggregation[divCode].total_tunjangan += (row.total_tunjangan || 0);
                        divAggregation[divCode].total_premi += (row.total_premi || 0);
                        divAggregation[divCode].total_lembur += (row.total_lembur || 0);
                        divAggregation[divCode].total_potongan += (row.total_potongan || 0);
                        divAggregation[divCode].total_upah_bersih += (row.total_upah_bersih || 0);
                        break; // Stop searching once we found the PRIMARY division
                    }
                }
            }

            // Compute WORKSHOP as WKS_PG + WKS_AR (to avoid duplication from aggregation table)
            const wksPg = divAggregation['WKS_PG'] || {};
            const wksAr = divAggregation['WKS_AR'] || {};
            divAggregation['WORKSHOP'] = {
                total_karyawan: (wksPg.total_karyawan || 0) + (wksAr.total_karyawan || 0),
                total_hk: (wksPg.total_hk || 0) + (wksAr.total_hk || 0),
                total_upah_pokok: (wksPg.total_upah_pokok || 0) + (wksAr.total_upah_pokok || 0),
                total_tunjangan: (wksPg.total_tunjangan || 0) + (wksAr.total_tunjangan || 0),
                total_premi: (wksPg.total_premi || 0) + (wksAr.total_premi || 0),
                total_lembur: (wksPg.total_lembur || 0) + (wksAr.total_lembur || 0),
                total_potongan: (wksPg.total_potongan || 0) + (wksAr.total_potongan || 0),
                total_upah_bersih: (wksPg.total_upah_bersih || 0) + (wksAr.total_upah_bersih || 0)
            };

            // Build division data array - Normalize division codes (PG1A -> P1A, etc.)
            const divisionData: any[] = [];
            let grandTotal = {
                total_karyawan: 0,
                total_hk: 0,
                total_upah_pokok: 0,
                total_tunjangan: 0,
                total_premi: 0,
                total_lembur: 0,
                total_potongan: 0,
                total_upah_bersih: 0
            };
            
            // Alias normalization map
            const aliasMap: Record<string, string> = {
                'PG1A': 'P1A', 'P1a': 'P1A', 'pg1a': 'P1A', 'PLASMA1A': 'P1A',
                'PG1B': 'P1B', 'P1b': 'P1B', 'pg1b': 'P1B', 'PLASMA1B': 'P1B',
                'PG2A': 'P2A', 'P2a': 'P2A', 'pg2a': 'P2A', 'PLASMA2A': 'P2A',
                'PG2B': 'P2B', 'P2b': 'P2B', 'pg2b': 'P2B', 'PLASMA2B': 'P2B',
            };
            
            // Normalize division codes
            const normalizedAggregation: Record<string, any> = {};
            for (const [divCode, totals] of Object.entries(divAggregation)) {
                const normalizedCode = aliasMap[divCode] || divCode;
                if (normalizedAggregation[normalizedCode]) {
                    // Merge if already exists
                    Object.keys(totals).forEach(key => {
                        if (typeof totals[key] === 'number') {
                            normalizedAggregation[normalizedCode][key] += totals[key];
                        }
                    });
                } else {
                    normalizedAggregation[normalizedCode] = { ...totals };
                }
            }

            for (const [divCode, totals] of Object.entries(normalizedAggregation)) {
                if (totals.total_karyawan > 0 || totals.total_upah_bersih > 0) {
                    divisionData.push({
                        division: divCode,
                        karyawan_count: totals.total_karyawan,
                        total_hk: totals.total_hk,
                        total_upah_pokok: totals.total_upah_pokok,
                        total_tunjangan: totals.total_tunjangan,
                        total_premi: totals.total_premi,
                        total_lembur: totals.total_lembur,
                        total_potongan: totals.total_potongan,
                        total_upah_bersih: totals.total_upah_bersih
                    });

                    grandTotal.total_karyawan += totals.total_karyawan;
                    grandTotal.total_hk += totals.total_hk;
                    grandTotal.total_upah_pokok += totals.total_upah_pokok;
                    grandTotal.total_tunjangan += totals.total_tunjangan;
                    grandTotal.total_premi += totals.total_premi;
                    grandTotal.total_lembur += totals.total_lembur;
                    grandTotal.total_potongan += totals.total_potongan;
                    grandTotal.total_upah_bersih += totals.total_upah_bersih;
                }
            }

            return {
                success: true,
                period: { month, year, label: `${getMonthName(month)} ${year}` },
                mode: 'recap_all',
                include_thumbprint: includeThumbprint,
                divisions: divisionData,
                grand_total: grandTotal
            };
        } catch (e: any) {
            console.error("[WagesRoutes] Error fetching recap all:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            include_thumbprint: t.Optional(t.String())
        })
    })

    // ========================
    // GET EMPLOYEE WAGES HISTORY
    // ========================
    .get("/employee/:empCode/history", async ({ params, query, set }) => {
        try {
            const empCode = params.empCode;
            const months = parseInt(query.months || "12");

            const history = await wagesService.getEmployeeWagesHistory(empCode, months);

            return {
                success: true,
                emp_code: empCode,
                count: history.length,
                data: history
            };
        } catch (e: any) {
            console.error("[WagesRoutes] Error fetching employee wages history:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            months: t.Optional(t.String())
        })
    })

    // ========================
    // GET WAGES COMPARISON (Main Endpoint)
    // ========================
    .get("/comparison/:month/:year", async ({ params, query, set }) => {
        try {
            const month = parseInt(params.month);
            const year = parseInt(params.year);
            const divisionCode = query.division as string | undefined;
            const gangCode = query.gang_code as string | undefined;

            if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
                set.status = 400;
                return { error: "Invalid month or year" };
            }

            // Step 1: Get payroll data (daftar upah) for the period
            console.log(`[WagesComparison] Fetching payroll data for ${month}/${year}...`);
            const payrollResult = await dataExtractorService.extractPayrollData(
                month,
                year,
                gangCode || 'ALL',
                divisionCode,
                undefined,
                undefined,
                true // [FIX] Include virtual gangs for comparison
            );

            if (!payrollResult || !payrollResult.data_rows) {
                set.status = 404;
                return {
                    error: "No payroll data found for this period",
                    period: { month, year, label: `${getMonthName(month)} ${year}` }
                };
            }

            const payrollData = payrollResult.data_rows;
            console.log(`[WagesComparison] Found ${payrollData.length} payroll records`);

            // Step 1.5: Fetch tonase data and merge with payroll data
            console.log(`[WagesComparison] Fetching tonase data...`);
            const tonaseData = await fetchTonaseForWagesComparison(month, year);
            console.log(`[WagesComparison] Got tonase for ${Object.keys(tonaseData).length} divisions`);

            // Merge tonase into payroll data
            payrollData.forEach((row: any) => {
                const divCode = row.division_code || '';
                row.total_ffb_weight = tonaseData[divCode] || 0;
                row.total_weight_tbs = tonaseData[divCode] || 0;
            });

            // Step 2: Compare with wages
            console.log(`[WagesComparison] Comparing with wages data...`);
            const comparison = await wagesService.comparePayrollWithWages(
                payrollData,
                month,
                year,
                divisionCode
            );

            return {
                success: true,
                period: {
                    month,
                    year,
                    label: `${getMonthName(month)} ${year}`
                },
                summary: comparison.summary,
                data: comparison.data
            };
        } catch (e: any) {
            console.error("[WagesRoutes] Error in wages comparison:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            division: t.Optional(t.String()),
            gang_code: t.Optional(t.String())
        })
    })

    // ========================
    // GET SINGLE EMPLOYEE COMPARISON
    // ========================
    .get("/comparison/employee/:empCode", async ({ params, query, set }) => {
        try {
            const empCode = params.empCode;
            const month = parseInt(query.month);
            const year = parseInt(query.year);

            if (isNaN(month) || isNaN(year)) {
                set.status = 400;
                return { error: "Invalid month or year" };
            }

            // Get employee payroll data
            const payrollResult = await dataExtractorService.extractPayrollData(
                month,
                year,
                'ALL',
                undefined,
                undefined,
                undefined
            );

            // Find the specific employee
            const employeePayroll = payrollResult?.data_rows?.find(
                (row: any) => (row.nik || row.emp_code || '').toUpperCase() === empCode.toUpperCase()
            );

            if (!employeePayroll) {
                set.status = 404;
                return { error: "Employee not found in payroll data" };
            }

            // Add tonase data to employee payroll record
            const tonaseData = await fetchTonaseForWagesComparison(month, year);
            const divCode = employeePayroll.division_code || '';
            employeePayroll.total_ffb_weight = tonaseData[divCode] || 0;
            employeePayroll.total_weight_tbs = tonaseData[divCode] || 0;

            // Get wages for this employee
            const wages = await wagesService.getWagesByEmployee(empCode, month, year);

            // Build comparison
            const daftarUpah = {
                jumlah_hk: Number(employeePayroll.jumlah_hk) || 0,
                tonase: Number(employeePayroll.total_ffb_weight) || Number(employeePayroll.total_weight_tbs) || 0,
                gaji_pokok: Number(employeePayroll.gaji_pokok) || 0,
                total_tunjangan: Number(employeePayroll.total_tunjangan) || 0,
                total_premi: Number(employeePayroll.total_premi) || 0,
                total_potongan: Number(employeePayroll.total_potongan) || 0,
                upah_bersih: Number(employeePayroll.upah_bersih) || 0
            };

            const wagesData = wages ? {
                wages_no: wages.wages_no,
                wages_date: wages.payment_date,
                jumlah_hk: wages.jumlah_hk,
                upah_bersih: wages.upah_bersih,
                payment_status: wages.payment_status
            } : null;

            const hkDiff = wages ? Math.abs(daftarUpah.jumlah_hk - wages.jumlah_hk) : 0;
            const amountDiff = wages ? Math.abs(daftarUpah.upah_bersih - wages.upah_bersih) : 0;

            let status: 'MATCH' | 'MINOR_DIFF' | 'MAJOR_DIFF' | 'NO_WAGES';
            if (!wages) {
                status = 'NO_WAGES';
            } else if (hkDiff <= 0.5 && amountDiff <= 1000) {
                status = 'MATCH';
            } else if (amountDiff <= 10000) {
                status = 'MINOR_DIFF';
            } else {
                status = 'MAJOR_DIFF';
            }

            return {
                success: true,
                emp_code: empCode,
                period: {
                    month,
                    year,
                    label: `${getMonthName(month)} ${year}`
                },
                employee: {
                    emp_code: empCode,
                    nik: employeePayroll.nik,
                    nama: employeePayroll.nama || employeePayroll.emp_name,
                    gang_code: employeePayroll.gang_code,
                    division_code: employeePayroll.division_code
                },
                daftar_upah: daftarUpah,
                wages: wagesData,
                comparison: {
                    hk_match: wages ? hkDiff <= 0.5 : false,
                    amount_match: wages ? amountDiff <= 1000 : false,
                    hk_difference: wages ? daftarUpah.jumlah_hk - wages.jumlah_hk : 0,
                    amount_difference: wages ? daftarUpah.upah_bersih - wages.upah_bersih : 0,
                    status
                }
            };
        } catch (e: any) {
            console.error("[WagesRoutes] Error in employee comparison:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            month: t.String(),
            year: t.String()
        })
    })

    // ========================
    // GET WAGES VERIFICATION SUMMARY
    // ========================
    .get("/verification/summary/:month/:year", async ({ params, query, set }) => {
        try {
            const month = parseInt(params.month);
            const year = parseInt(params.year);
            const divisionCode = query.division as string | undefined;

            if (isNaN(month) || isNaN(year)) {
                set.status = 400;
                return { error: "Invalid month or year" };
            }

            // Get payroll data
            const payrollResult = await dataExtractorService.extractPayrollData(
                month,
                year,
                divisionCode || 'ALL',
                undefined,
                undefined,
                undefined
            );

            const payrollData = payrollResult?.data_rows || [];

            // Add tonase data to payroll records
            const tonaseData = await fetchTonaseForWagesComparison(month, year);
            payrollData.forEach((row: any) => {
                const divCode = row.division_code || '';
                row.total_ffb_weight = tonaseData[divCode] || 0;
                row.total_weight_tbs = tonaseData[divCode] || 0;
            });

            // Get comparison
            const comparison = await wagesService.comparePayrollWithWages(
                payrollData,
                month,
                year,
                divisionCode
            );

            // Calculate additional metrics
            const totalUpahBersih = payrollData.reduce((sum: number, p: any) => sum + (Number(p.upah_bersih) || 0), 0);
            const totalWagesPaid = comparison.data
                .filter(c => c.wages)
                .reduce((sum, c) => sum + (c.wages?.upah_bersih || 0), 0);

            return {
                success: true,
                period: {
                    month,
                    year,
                    label: `${getMonthName(month)} ${year}`
                },
                summary: {
                    ...comparison.summary,
                    total_upah_bersih_calculated: totalUpahBersih,
                    total_wages_paid: totalWagesPaid,
                    verification_rate: comparison.summary.total_employees > 0 
                        ? ((comparison.summary.matched / comparison.summary.total_employees) * 100).toFixed(2) + '%'
                        : '0%',
                    data_completeness: comparison.summary.total_employees > 0
                        ? (((comparison.summary.total_employees - comparison.summary.no_wages_data) / comparison.summary.total_employees) * 100).toFixed(2) + '%'
                        : '0%'
                },
                breakdown: {
                    by_status: {
                        match: comparison.data.filter(c => c.comparison.status === 'MATCH'),
                        minor_diff: comparison.data.filter(c => c.comparison.status === 'MINOR_DIFF'),
                        major_diff: comparison.data.filter(c => c.comparison.status === 'MAJOR_DIFF'),
                        no_wages: comparison.data.filter(c => c.comparison.status === 'NO_WAGES')
                    }
                }
            };
        } catch (e: any) {
            console.error("[WagesRoutes] Error in verification summary:", e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        query: t.Object({
            division: t.Optional(t.String())
        })
    });
