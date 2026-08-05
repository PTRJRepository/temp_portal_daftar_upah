/**
 * Wages Service
 * 
 * Service untuk mengambil data dari PR_WAGES dan PR_EMPWAGES
 * untuk perbandingan dengan daftar upah (payroll history).
 * 
 * Actual Database Schema (discovered from INFORMATION_SCHEMA):
 * 
 * PR_WAGES & PR_EMPWAGES share a similar flat per-employee structure:
 *   ID, AccMonth, AccYear, CompCode, LocCode, EmpCode, EmpName, ICNo,
 *   DeptCode, TerminateDaate, DeferPayInd, PayMode, BankCode, BankAccNo,
 *   ChequeNo, Amount, Status, CreateDate, UpdateDate, PrintDate, UpdateID,
 *   AccCode, ChequeDate, CreditBankCode, CreditDate, MatchID
 * 
 * PR_EMPWAGES_ARC has the same structure + OriginalAmt column.
 * 
 * Key mappings:
 *   - Amount = Net wages (upah bersih)
 *   - AccMonth/AccYear = Accounting period (NOT calendar month)
 *   - EmpCode/EmpName = Employee info (directly in table)
 *   - LocCode = Division/location code
 *   - No WAGES_NO join between tables; each table is independent
 *   - No detailed breakdown (HK, tunjangan, premi, potongan) in wages tables
 */

import { Database } from "../db/client";
import { Config } from "../config";
import { divisionDefinition } from "./divisionDefinition";
import { gangService } from "./gangService";

export interface WagesHeader {
    wages_id: number;
    period_month: number;
    period_year: number;
    division_code: string;
    total_employees: number;
    total_amount: number;
    status?: string;
    created_at?: Date;
}

export interface WagesDetail {
    id?: number;
    wages_no: string;       // Kept for interface compatibility; mapped from ID
    emp_code: string;
    emp_name?: string;
    nik?: string;           // ICNo
    gang_code: string;      // from HR_GANGLN join
    division_code: string;  // LocCode or DeptCode
    jumlah_hk: number;      // Not available in PR_EMPWAGES; always 0
    upah_dasar?: number;    // Not available in PR_EMPWAGES; always 0
    upah_pokok?: number;    // Not available; always 0
    gaji_pokok?: number;    // Not available; always 0
    total_tunjangan?: number;  // Not available; always 0
    total_premi?: number;      // Not available; always 0
    total_potongan?: number;   // Not available; always 0
    upah_bersih: number;       // Amount column
    payment_status?: string;   // Status column
    payment_date?: Date;       // CreditDate or CreateDate
    period_month?: number;     // AccMonth
    period_year?: number;      // AccYear
}

export interface WagesComparison {
    emp_code: string;
    nik?: string;
    nama?: string;
    gang_code: string;
    division_code: string;

    // Data dari daftar upah (calculated) - Detailed breakdown
    daftar_upah: {
        jumlah_hk: number;
        upah_dasar: number;
        gaji_pokok: number;
        // Tunjangan detail
        beras_jumlah: number;
        jabatan_jumlah: number;
        masa_kerja_jumlah: number;
        total_tunjangan: number;
        // Lembur
        lembur_jam: number;
        lembur_jumlah: number;
        // Premi detail
        premi_brondol: number;
        premi_pph: number;
        total_premi: number;
        // Potongan detail
        pot_spsi: number;
        pot_pph21: number;
        pot_astek_pekerja: number;
        pot_bpjs_kesehatan_pekerja: number;
        pot_bpjs_pensiun_pekerja: number;
        pot_koreksi: number;
        total_potongan: number;
        // Summary
        jumlah_upah_kotor: number;
        upah_bersih: number;
        // Tonase
        tonase: number;
        // Pajak info
        status_ptkp?: string;
        kategori_ter?: string;
        tarif_pajak_ter?: number;
        pph21_ter?: number;
    };

    // Data dari wages (paid)
    wages: {
        wages_no: string;
        wages_date?: Date;
        jumlah_hk: number;
        upah_dasar?: number;
        gaji_pokok?: number;
        total_tunjangan?: number;
        total_premi?: number;
        total_potongan?: number;
        upah_bersih: number;
        payment_status?: string;
    } | null;

    // Comparison result
    comparison: {
        hk_match: boolean;
        amount_match: boolean;
        hk_difference: number;
        amount_difference: number;
        status: 'MATCH' | 'MINOR_DIFF' | 'MAJOR_DIFF' | 'NO_WAGES';
    };
}

export interface WagesComparisonSummary {
    period_month: number;
    period_year: number;
    period_label: string;
    total_employees: number;
    matched: number;
    minor_differences: number;
    major_differences: number;
    no_wages_data: number;
    total_variance: number;
    tolerance: number;
}

// Tolerance for matching (in Rupiah)
const AMOUNT_TOLERANCE = 1000; // Rp 1,000
const HK_TOLERANCE = 0.5; // 0.5 HK

class WagesService {
    private static instance: WagesService;

    private constructor() { }

    public static getInstance(): WagesService {
        if (!WagesService.instance) {
            WagesService.instance = new WagesService();
        }
        return WagesService.instance;
    }

    /**
     * Get wages data for a specific period.
     * 
     * PR_EMPWAGES uses AccMonth/AccYear (accounting period).
     * We receive calendar month/year from the frontend, so we need to 
     * convert to accounting period first using the same logic as dataExtractor:
     *   accMonth = (calendarMonth + 3) mod 12 or similar.
     * 
     * For now, we query both directly (AccMonth = month) and also try
     * the archive table as fallback.
     */
    async getWagesByPeriod(month: number, year: number, divisionCode?: string): Promise<WagesDetail[]> {
        const db = Database.getInstance(Config.DEFAULT_DATABASE, Config.DB_PROFILE);

        // Convert calendar month/year to accounting month/year
        // AccMonth mapping: calendar month -> accounting month
        // Based on the system: AccMonth = calendar_month + 3 (wrapped)
        const { accMonth, accYear } = this.calendarToAccounting(month, year);

        let query = `
            SELECT
                ew.ID as id,
                CAST(ew.ID AS VARCHAR) as wages_no,
                ew.EmpCode as emp_code,
                ew.EmpName as emp_name,
                ew.ICNo as nik,
                '' as gang_code,
                ISNULL(ew.LocCode, ew.DeptCode) as division_code,
                ew.Amount as upah_bersih,
                ew.Status as payment_status,
                ew.CreditDate as payment_date,
                CAST(ew.AccMonth AS INT) as period_month,
                CAST(ew.AccYear AS INT) as period_year
            FROM PR_EMPWAGES ew
            WHERE CAST(ew.AccMonth AS INT) = ?
              AND CAST(ew.AccYear AS INT) = ?
        `;

        const params: any[] = [accMonth, accYear];

        if (divisionCode && divisionCode !== 'ALL') {
            const locCodes = await divisionDefinition.getSourceDivisionsForAggregation(divisionCode);
            if (locCodes.length > 0) {
                const placeholders = locCodes.map(() => '?').join(',');
                query += ` AND (ew.LocCode IN (${placeholders}) OR ew.DeptCode IN (${placeholders}))`;
                params.push(...locCodes, ...locCodes);
            }
        }

        query += ` ORDER BY ew.EmpName`;

        try {
            const result = await db.query<any>(query, params);
            return result.map((row: any) => this.mapWagesDetail(row));
        } catch (error: any) {
            console.error('[WagesService] Error fetching wages by period:', error.message || error);
            // Try archive table if main table fails
            return this.getWagesFromArchive(month, year, divisionCode);
        }
    }

    /**
     * Get wages from archive table (PR_EMPWAGES_ARC)
     */
    private async getWagesFromArchive(month: number, year: number, divisionCode?: string): Promise<WagesDetail[]> {
        const db = Database.getInstance(Config.DEFAULT_DATABASE, Config.DB_PROFILE);

        const { accMonth, accYear } = this.calendarToAccounting(month, year);

        let query = `
            SELECT
                ew.ID as id,
                CAST(ew.ID AS VARCHAR) as wages_no,
                ew.EmpCode as emp_code,
                ew.EmpName as emp_name,
                ew.ICNo as nik,
                '' as gang_code,
                ISNULL(ew.LocCode, ew.DeptCode) as division_code,
                ew.Amount as upah_bersih,
                ew.Status as payment_status,
                ew.CreditDate as payment_date,
                CAST(ew.AccMonth AS INT) as period_month,
                CAST(ew.AccYear AS INT) as period_year
            FROM PR_EMPWAGES_ARC ew
            WHERE CAST(ew.AccMonth AS INT) = ?
              AND CAST(ew.AccYear AS INT) = ?
        `;

        const params: any[] = [accMonth, accYear];

        if (divisionCode && divisionCode !== 'ALL') {
            const locCodes = await divisionDefinition.getSourceDivisionsForAggregation(divisionCode);
            if (locCodes.length > 0) {
                const placeholders = locCodes.map(() => '?').join(',');
                query += ` AND (ew.LocCode IN (${placeholders}) OR ew.DeptCode IN (${placeholders}))`;
                params.push(...locCodes, ...locCodes);
            }
        }

        query += ` ORDER BY ew.EmpName`;

        try {
            const result = await db.query<any>(query, params);
            return result.map((row: any) => this.mapWagesDetail(row));
        } catch (error: any) {
            console.error('[WagesService] Error fetching wages from archive:', error.message || error);
            return [];
        }
    }

    /**
     * Get wages for a specific employee in a specific period.
     * Tries PR_EMPWAGES first, then PR_EMPWAGES_ARC.
     */
    async getWagesByEmployee(empCode: string, month: number, year: number): Promise<WagesDetail | null> {
        const db = Database.getInstance(Config.DEFAULT_DATABASE, Config.DB_PROFILE);

        const { accMonth, accYear } = this.calendarToAccounting(month, year);

        const query = `
            SELECT
                ew.ID as id,
                CAST(ew.ID AS VARCHAR) as wages_no,
                ew.EmpCode as emp_code,
                ew.EmpName as emp_name,
                ew.ICNo as nik,
                '' as gang_code,
                ISNULL(ew.LocCode, ew.DeptCode) as division_code,
                ew.Amount as upah_bersih,
                ew.Status as payment_status,
                ew.CreditDate as payment_date,
                CAST(ew.AccMonth AS INT) as period_month,
                CAST(ew.AccYear AS INT) as period_year
            FROM PR_EMPWAGES ew
            WHERE ew.EmpCode = ?
              AND CAST(ew.AccMonth AS INT) = ?
              AND CAST(ew.AccYear AS INT) = ?
        `;

        try {
            const result = await db.query<any>(query, [empCode, accMonth, accYear]);
            if (result && result.length > 0) {
                return this.mapWagesDetail(result[0]);
            }

            // Try archive table
            return this.getWagesByEmployeeFromArchive(empCode, accMonth, accYear);
        } catch (error: any) {
            console.error('[WagesService] Error fetching wages by employee:', error.message || error);
            // Try archive as fallback
            try {
                return this.getWagesByEmployeeFromArchive(empCode, accMonth, accYear);
            } catch {
                return null;
            }
        }
    }

    /**
     * Get wages for a specific employee from archive table
     */
    private async getWagesByEmployeeFromArchive(empCode: string, accMonth: number, accYear: number): Promise<WagesDetail | null> {
        const db = Database.getInstance(Config.DEFAULT_DATABASE, Config.DB_PROFILE);

        const query = `
            SELECT
                ew.ID as id,
                CAST(ew.ID AS VARCHAR) as wages_no,
                ew.EmpCode as emp_code,
                ew.EmpName as emp_name,
                ew.ICNo as nik,
                '' as gang_code,
                ISNULL(ew.LocCode, ew.DeptCode) as division_code,
                ew.Amount as upah_bersih,
                ew.Status as payment_status,
                ew.CreditDate as payment_date,
                CAST(ew.AccMonth AS INT) as period_month,
                CAST(ew.AccYear AS INT) as period_year
            FROM PR_EMPWAGES_ARC ew
            WHERE ew.EmpCode = ?
              AND CAST(ew.AccMonth AS INT) = ?
              AND CAST(ew.AccYear AS INT) = ?
        `;

        try {
            const result = await db.query<any>(query, [empCode, accMonth, accYear]);
            if (result && result.length > 0) {
                return this.mapWagesDetail(result[0]);
            }
            return null;
        } catch (error: any) {
            console.error('[WagesService] Error fetching wages from archive by employee:', error.message || error);
            return null;
        }
    }

    /**
     * Get employee wages history (multiple periods).
     * Queries both PR_EMPWAGES and PR_EMPWAGES_ARC with UNION ALL.
     */
    async getEmployeeWagesHistory(empCode: string, months: number = 12): Promise<WagesDetail[]> {
        const db = Database.getInstance(Config.DEFAULT_DATABASE, Config.DB_PROFILE);

        const query = `
            SELECT TOP ${months} *
            FROM (
                SELECT
                    ew.ID as id,
                    CAST(ew.ID AS VARCHAR) as wages_no,
                    ew.EmpCode as emp_code,
                    ew.EmpName as emp_name,
                    ew.ICNo as nik,
                    '' as gang_code,
                    ISNULL(ew.LocCode, ew.DeptCode) as division_code,
                    ew.Amount as upah_bersih,
                    ew.Status as payment_status,
                    ew.CreditDate as payment_date,
                    CAST(ew.AccMonth AS INT) as period_month,
                    CAST(ew.AccYear AS INT) as period_year
                FROM PR_EMPWAGES ew
                WHERE ew.EmpCode = ?
                
                UNION ALL
                
                SELECT
                    ew.ID as id,
                    CAST(ew.ID AS VARCHAR) as wages_no,
                    ew.EmpCode as emp_code,
                    ew.EmpName as emp_name,
                    ew.ICNo as nik,
                    '' as gang_code,
                    ISNULL(ew.LocCode, ew.DeptCode) as division_code,
                    ew.Amount as upah_bersih,
                    ew.Status as payment_status,
                    ew.CreditDate as payment_date,
                    CAST(ew.AccMonth AS INT) as period_month,
                    CAST(ew.AccYear AS INT) as period_year
                FROM PR_EMPWAGES_ARC ew
                WHERE ew.EmpCode = ?
            ) combined
            ORDER BY period_year DESC, period_month DESC
        `;

        try {
            const result = await db.query<any>(query, [empCode, empCode]);
            return result.map((row: any) => this.mapWagesDetail(row));
        } catch (error: any) {
            console.error('[WagesService] Error fetching employee wages history:', error.message || error);
            return [];
        }
    }

    /**
     * Compare payroll data with wages data
     */
    async comparePayrollWithWages(
        payrollData: any[],
        month: number,
        year: number,
        divisionCode?: string
    ): Promise<{ summary: WagesComparisonSummary; data: WagesComparison[] }> {

        // Get wages data for the same period
        const wagesData = await this.getWagesByPeriod(month, year, divisionCode);

        // Create a map for quick lookup
        const wagesMap = new Map<string, WagesDetail>();
        wagesData.forEach(w => {
            wagesMap.set(w.emp_code.toUpperCase(), w);
        });

        // Compare each payroll record with wages
        const comparisons: WagesComparison[] = payrollData.map(payroll => {
            const empCode = (payroll.nik || payroll.emp_code || '').toUpperCase();
            const wages = wagesMap.get(empCode);

            // Build detailed daftar upah data
            const daftarUpah = {
                jumlah_hk: Number(payroll.jumlah_hk) || 0,
                upah_dasar: Number(payroll.upah_dasar) || 0,
                gaji_pokok: Number(payroll.gaji_pokok) || 0,
                // Tunjangan detail
                beras_jumlah: Number(payroll.beras_jumlah) || 0,
                jabatan_jumlah: Number(payroll.jabatan_jumlah) || 0,
                masa_kerja_jumlah: Number(payroll.masa_kerja_jumlah) || 0,
                total_tunjangan: Number(payroll.total_tunjangan) || 0,
                // Lembur
                lembur_jam: Number(payroll.lembur_jam) || 0,
                lembur_jumlah: Number(payroll.lembur_jumlah) || 0,
                // Premi detail
                premi_brondol: Number(payroll.premi_brondol) || 0,
                premi_pph: Number(payroll.premi_pph) || 0,
                total_premi: Number(payroll.total_premi) || 0,
                // Potongan detail
                pot_spsi: Number(payroll.pot_spsi) || 0,
                pot_pph21: Number(payroll.pot_pph21) || 0,
                pot_astek_pekerja: Number(payroll.pot_astek_pekerja) || Number(payroll.pot_astek) || 0,
                pot_bpjs_kesehatan_pekerja: Number(payroll.pot_bpjs_kesehatan_pekerja) || 0,
                pot_bpjs_pensiun_pekerja: Number(payroll.pot_bpjs_pensiun_pekerja) || 0,
                pot_koreksi: Number(payroll.pot_koreksi) || 0,
                total_potongan: Number(payroll.total_potongan) || 0,
                // Summary
                jumlah_upah_kotor: Number(payroll.jumlah_upah_kotor) || 0,
                upah_bersih: Number(payroll.upah_bersih) || 0,
                // Tonase
                tonase: Number(payroll.total_ffb_weight) || Number(payroll.total_weight_tbs) || 0,
                // Pajak info
                status_ptkp: payroll.status_ptkp || '-',
                kategori_ter: payroll.kategori_ter || '-',
                tarif_pajak_ter: Number(payroll.tarif_pajak_ter) || 0,
                pph21_ter: Number(payroll.pph21_ter) || 0
            };

            let comparison: WagesComparison['comparison'];

            if (wages) {
                // PR_EMPWAGES only has Amount (upah_bersih), no HK breakdown
                const amountDiff = Math.abs(daftarUpah.upah_bersih - wages.upah_bersih);

                // HK comparison not possible from wages table
                const hkMatch = true; // Can't compare - assume match
                const amountMatch = amountDiff <= AMOUNT_TOLERANCE;

                let status: 'MATCH' | 'MINOR_DIFF' | 'MAJOR_DIFF' | 'NO_WAGES';
                if (amountMatch) {
                    status = 'MATCH';
                } else if (amountDiff <= 10000) {
                    status = 'MINOR_DIFF';
                } else {
                    status = 'MAJOR_DIFF';
                }

                comparison = {
                    hk_match: hkMatch,
                    amount_match: amountMatch,
                    hk_difference: 0, // Not available from wages
                    amount_difference: daftarUpah.upah_bersih - wages.upah_bersih,
                    status
                };
            } else {
                comparison = {
                    hk_match: false,
                    amount_match: false,
                    hk_difference: 0,
                    amount_difference: 0,
                    status: 'NO_WAGES'
                };
            }

            return {
                emp_code: empCode,
                nik: payroll.nik || wages?.nik,
                nama: payroll.nama || payroll.emp_name || wages?.emp_name,
                gang_code: payroll.gang_code || wages?.gang_code || '',
                division_code: payroll.division_code || wages?.division_code || '',
                daftar_upah: daftarUpah,
                wages: wages ? {
                    wages_no: wages.wages_no,
                    wages_date: wages.payment_date,
                    jumlah_hk: wages.jumlah_hk,
                    upah_dasar: wages.upah_dasar,
                    gaji_pokok: wages.gaji_pokok,
                    total_tunjangan: wages.total_tunjangan,
                    total_premi: wages.total_premi,
                    total_potongan: wages.total_potongan,
                    upah_bersih: wages.upah_bersih,
                    payment_status: wages.payment_status
                } : null,
                comparison
            };
        });

        // Calculate summary
        const summary: WagesComparisonSummary = {
            period_month: month,
            period_year: year,
            period_label: this.getMonthName(month) + ' ' + year,
            total_employees: comparisons.length,
            matched: comparisons.filter(c => c.comparison.status === 'MATCH').length,
            minor_differences: comparisons.filter(c => c.comparison.status === 'MINOR_DIFF').length,
            major_differences: comparisons.filter(c => c.comparison.status === 'MAJOR_DIFF').length,
            no_wages_data: comparisons.filter(c => c.comparison.status === 'NO_WAGES').length,
            total_variance: comparisons.reduce((sum, c) => sum + Math.abs(c.comparison.amount_difference), 0),
            tolerance: AMOUNT_TOLERANCE
        };

        return { summary, data: comparisons };
    }

    /**
     * Get available periods from wages tables (both current and archive)
     */
    async getAvailableWagesPeriods(): Promise<{ month: number; year: number; label: string; employee_count: number }[]> {
        const db = Database.getInstance(Config.DEFAULT_DATABASE, Config.DB_PROFILE);

        const query = `
            SELECT
                period_month as month,
                period_year as year,
                COUNT(DISTINCT emp_code) as employee_count
            FROM (
                SELECT
                    CAST(AccMonth AS INT) as period_month,
                    CAST(AccYear AS INT) as period_year,
                    EmpCode as emp_code
                FROM PR_EMPWAGES
                
                UNION ALL
                
                SELECT
                    CAST(AccMonth AS INT) as period_month,
                    CAST(AccYear AS INT) as period_year,
                    EmpCode as emp_code
                FROM PR_EMPWAGES_ARC
            ) combined
            GROUP BY period_month, period_year
            ORDER BY period_year DESC, period_month DESC
        `;

        try {
            const result = await db.query<any>(query, {});
            return result.map((row: any) => ({
                month: row.month,
                year: row.year,
                label: `${this.getMonthName(row.month)} ${row.year}`,
                employee_count: row.employee_count
            }));
        } catch (error: any) {
            console.error('[WagesService] Error fetching available periods:', error.message || error);
            return [];
        }
    }

    /**
     * Map database row to WagesDetail interface.
     * The actual PR_EMPWAGES table only has Amount (net wages) and no
     * detailed breakdown, so most fields default to 0.
     */
    private mapWagesDetail(row: any): WagesDetail {
        return {
            id: Number(row.id) || 0,
            wages_no: row.wages_no || String(row.id || ''),
            emp_code: (row.emp_code || '').trim(),
            emp_name: (row.emp_name || '').trim(),
            nik: (row.nik || '').trim(),
            gang_code: (row.gang_code || '').trim(),
            division_code: (row.division_code || '').trim(),
            jumlah_hk: 0,  // Not available in PR_EMPWAGES
            upah_dasar: 0,  // Not available
            upah_pokok: 0,  // Not available
            gaji_pokok: 0,  // Not available
            total_tunjangan: 0,  // Not available
            total_premi: 0,      // Not available
            total_potongan: 0,   // Not available
            upah_bersih: Number(row.upah_bersih) || 0,  // Amount column
            payment_status: (row.payment_status || '').trim(),
            payment_date: row.payment_date || undefined,
            period_month: Number(row.period_month) || 0,
            period_year: Number(row.period_year) || 0,
        };
    }

    /**
     * Convert calendar month/year to accounting month/year.
     * 
     * The PR_EMPWAGES table uses AccMonth/AccYear which follow an
     * accounting period convention. Based on the data extractor pattern:
     *   accMonth = ((calendarMonth + 2) % 12) + 1
     *   accYear may shift if accMonth wraps around
     * 
     * For a simpler and more reliable approach, we just try to query 
     * with the calendar values directly first. If the accounting period
     * convention is needed, this can be adjusted.
     */
    private calendarToAccounting(calendarMonth: number, calendarYear: number): { accMonth: number; accYear: number } {
        // Based on reverse-engineering the DataExtractor pattern:
        // calendar month 1 (Jan) -> acc month 4
        // calendar month 2 (Feb) -> acc month 5
        // ...
        // calendar month 9 (Sep) -> acc month 12
        // calendar month 10 (Oct) -> acc month 1 (next year)
        // calendar month 11 (Nov) -> acc month 2 (next year)
        // calendar month 12 (Dec) -> acc month 3 (next year)

        const accMonth = ((calendarMonth + 2) % 12) + 1;
        const accYear = calendarMonth >= 10 ? calendarYear + 1 : calendarYear;

        return { accMonth, accYear };
    }

    /**
     * Get month name in Indonesian
     */
    private getMonthName(month: number): string {
        const months = [
            'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ];
        return months[month - 1] || '';
    }
}

export const wagesService = WagesService.getInstance();
