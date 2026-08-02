/**
 * OtherIncomeProcessor - Main Other Incomes Processing
 *
 * Orchestrates other income processing combining:
 * - IncomeCategorizer: Categorize incomes into THR, Bonus, Custom, KONTAN
 * - DynamicColumnDetector: Parse DocDesc patterns
 * - ThrProcessor: THR-specific calculations
 *
 * @module payroll/otherIncomes/OtherIncomeProcessor
 */

import { Database } from '../../../db/client';
import { HistoryDatabaseService } from '../../historyDatabaseService';
import { divisionDefinition } from '../../divisionDefinition';
import { employeeHrDataService } from '../../employeeHrDataService';
import { gangService } from '../../gangService';
import { divisionConfigService } from '../../config/DivisionConfigService';
import { debug, info, warn, error as logError } from '../../../utils/logger';
import { IncomeCategorizer, getIncomeCategorizer } from './IncomeCategorizer';
import { DynamicColumnDetector, getDynamicColumnDetector } from './DynamicColumnDetector';
import { ThrProcessor, getThrProcessor } from './ThrProcessor';

const CATEGORY = "OtherIncomeProcessor";

/**
 * OtherIncome - Core income interface
 */
export interface OtherIncome {
    id?: number;
    nik: string;
    new_nik?: string;
    emp_code?: string;
    emp_name: string;
    division_code?: string;
    gang_code?: string;
    jabatan?: string;
    period_year: number;
    period_month: number;
    income_type: string;
    income_name: string;
    amount: number;
    is_paid_in_thp: boolean;
    is_taxable: boolean;
    created_at?: string;
    updated_at?: string;
    details?: any;
    religion?: string;
    original_religion?: string;
    join_date?: string;
    bank_acc_no?: string;
    bank_code?: string;
    sex?: string;
}

/**
 * Raw income record from PR_ADTRANS
 */
interface RawIncome {
    emp_code: string;
    nik: string;
    emp_name: string;
    doc_desc: string;
    amount: number;
    doc_date: string;
    gang_code?: string;
    division_code?: string;
    religion?: string;
}

/**
 * Employee bank data
 */
interface EmployeeBank {
    emp_code: string;
    bank_acc_no: string;
    bank_code: string;
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr: any): Date | null {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;

    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;

    const parts = String(dateStr).split(/[\/\-]/);
    if (parts.length === 3) {
        if (parts[2].length === 4) {
            d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        } else if (parts[0].length === 4) {
            d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
        if (!isNaN(d.getTime())) return d;
    }

    return null;
}

/**
 * Get latest valid date from two values
 */
function getLatestValidDate(d1: any, d2: any): string | null {
    const date1 = parseDate(d1);
    const date2 = parseDate(d2);

    const isValid = (d: Date | null) => d && !isNaN(d.getTime()) && d.getFullYear() > 1905;
    const v1 = isValid(date1) ? date1 : null;
    const v2 = isValid(date2) ? date2 : null;

    let latest: Date | null = null;
    if (v1 && v2) {
        latest = v1.getTime() > v2.getTime() ? v1 : v2;
    } else {
        latest = v1 || v2;
    }

    return latest ? latest.toISOString() : null;
}

/**
 * Check if bank account is valid
 */
function isValidBankAccNo(val: string | null | undefined): boolean {
    if (!val) return false;
    const trimmed = val.trim();
    if (!trimmed) return false;
    if (/^0+$/.test(trimmed)) return false;
    if (/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(trimmed)) return false;
    if (/\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/.test(trimmed)) return false;
    if (/[A-Za-z]{3,}\s+\d{4}/.test(trimmed)) return false;

    const digitsOnly = trimmed.replace(/[-\s]/g, '');
    if (!/^\d+$/.test(digitsOnly)) return false;
    if (digitsOnly.length < 5) return false;

    return true;
}

/**
 * OtherIncomeProcessor - Main orchestrator for other incomes
 */
export class OtherIncomeProcessor {
    private db: Database;
    private categorizer: IncomeCategorizer;
    private columnDetector: DynamicColumnDetector;
    private thrProcessor: ThrProcessor;

    constructor(db?: Database) {
        this.db = db || Database.getInstance();
        this.categorizer = getIncomeCategorizer();
        this.columnDetector = getDynamicColumnDetector();
        this.thrProcessor = getThrProcessor();
    }

    /**
     * Fetch raw incomes from PR_ADTRANS
     *
     * @param year - Period year
     * @param month - Period month
     * @param divisionCode - Optional division filter
     * @param gangCode - Optional gang filter
     * @returns Raw income records
     */
    async fetchRawIncomes(
        year: number,
        month: number,
        divisionCode?: string,
        gangCode?: string
    ): Promise<RawIncome[]> {
        const extDb = Database.getExtendedInstance();
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

        debug(CATEGORY, `[fetchRawIncomes] Fetching for ${month}/${year}, division: ${divisionCode || 'ALL'}, gang: ${gangCode || 'ALL'}`);

        let sql: string;
        let params: any[];

        // Build gang condition
        let gangCondition = '';
        if (gangCode && gangCode !== 'ALL') {
            gangCondition = `AND RTRIM(g.GangCode) = ?`;
        } else if (divisionCode && divisionCode !== 'ALL') {
            // Get gangs for division
            const gangs = await divisionConfigService.getGangsForDivision(divisionCode);
            if (gangs.length > 0) {
                const gangList = gangs.map(g => `'${g.gang_code}'`).join(',');
                gangCondition = `AND RTRIM(g.GangCode) IN (${gangList})`;
            }
        }

        sql = `
            SELECT DISTINCT
                RTRIM(ln.EmpCode) as emp_code,
                RTRIM(e.NewICNo) as nik,
                RTRIM(e.EmpName) as emp_name,
                t.DocDesc as doc_desc,
                ln.Amount as amount,
                t.DocDate as doc_date,
                RTRIM(g.GangCode) as gang_code,
                e.Religion as religion
            FROM PR_ADTRANS t
            JOIN PR_ADTRANSLN ln ON t.ID = ln.MasterID
            JOIN HR_EMPLOYEE e ON RTRIM(ln.EmpCode) = RTRIM(e.EmpCode)
            JOIN HR_GANGLN gl ON RTRIM(gl.GangMember) = RTRIM(e.EmpCode)
            JOIN HR_GANG g ON RTRIM(g.GangCode) = RTRIM(gl.GangCode)
            WHERE t.DocDate >= ? AND t.DocDate < ?
              AND t.DocType IN ('UPAH LEBIH', 'UPAH LAIN', 'POTONGAN TAMBAHAN')
              AND UPPER(t.DocDesc) NOT LIKE '%ADJ%'
              AND t.Status = 1
              ${gangCondition}
            ORDER BY ln.EmpCode, t.DocDesc
        `;

        params = [startDate, endDate];
        if (gangCode && gangCode !== 'ALL') {
            params.push(gangCode);
        }

        debug(CATEGORY, `[fetchRawIncomes] SQL: ${sql}`);
        debug(CATEGORY, `[fetchRawIncomes] Params: ${params.join(', ')}`);

        const rows = await extDb.query<any>(sql, params);
        debug(CATEGORY, `[fetchRawIncomes] Database returned ${rows.length} rows`);

        return rows.map(r => ({
            emp_code: r.emp_code?.trim() || '',
            nik: r.nik?.trim() || r.emp_code?.trim() || '',
            emp_name: r.emp_name?.trim() || '',
            doc_desc: r.doc_desc?.trim() || '',
            amount: r.amount || 0,
            doc_date: r.doc_date || '',
            gang_code: r.gang_code?.trim() || '',
            division_code: divisionCode,
            religion: r.religion?.trim() || ''
        }));
    }

    /**
     * Process raw incomes into structured OtherIncome records
     *
     * @param rawIncomes - Raw income records
     * @param year - Period year
     * @param month - Period month
     * @returns Processed OtherIncome records
     */
    processIncomes(
        rawIncomes: RawIncome[],
        year: number,
        month: number
    ): OtherIncome[] {
        const results: OtherIncome[] = [];

        // Group by employee and doc_desc
        const incomeMap = new Map<string, RawIncome>();

        for (const raw of rawIncomes) {
            const key = `${raw.emp_code}:${raw.doc_desc}`;
            const existing = incomeMap.get(key);

            if (!existing || Math.abs(raw.amount) > Math.abs(existing.amount)) {
                incomeMap.set(key, raw);
            }
        }

        // Process each unique income
        for (const [key, raw] of incomeMap) {
            const category = this.categorizer.categorizeByDocDesc(raw.doc_desc);
            const isTaxable = category !== 'KONTAN';
            const isPaidInThp = category === 'THR';

            results.push({
                nik: raw.nik,
                emp_code: raw.emp_code,
                emp_name: raw.emp_name,
                division_code: raw.division_code,
                gang_code: raw.gang_code,
                period_year: year,
                period_month: month,
                income_type: category,
                income_name: raw.doc_desc,
                amount: Math.abs(raw.amount),
                is_taxable: isTaxable,
                is_paid_in_thp: isPaidInThp,
                religion: raw.religion,
                details: {
                    doc_date: raw.doc_date,
                    original_doc_desc: raw.doc_desc
                }
            });
        }

        return results;
    }

    /**
     * Enrich with employee bank data
     *
     * @param incomes - OtherIncome records
     * @returns Incomes with bank data added
     */
    async enrichWithBankData(incomes: OtherIncome[]): Promise<OtherIncome[]> {
        if (incomes.length === 0) return incomes;

        const empCodes = [...new Set(incomes.map(i => i.emp_code).filter(Boolean))];

        // Fetch bank data from HR_PAYROLL
        const mainDb = Database.getInstance();
        const bankRows = await mainDb.query<{ EmpCode: string; BankAccNo: string; BankCode: string }>(`
            SELECT RTRIM(EmpCode) as EmpCode, RTRIM(BankAccNo) as BankAccNo, RTRIM(BankCode) as BankCode
            FROM HR_PAYROLL
            WHERE RTRIM(EmpCode) IN (${empCodes.map(() => '?').join(',')})
        `, empCodes);

        const bankMap = new Map<string, EmployeeBank>();
        for (const row of bankRows) {
            const empCode = row.EmpCode?.trim();
            if (empCode && isValidBankAccNo(row.BankAccNo)) {
                bankMap.set(empCode, {
                    emp_code: empCode,
                    bank_acc_no: row.BankAccNo?.trim() || '',
                    bank_code: row.BankCode?.trim() || ''
                });
            }
        }

        // Apply bank data to incomes
        return incomes.map(income => {
            if (income.emp_code) {
                const bank = bankMap.get(income.emp_code);
                if (bank) {
                    income.bank_acc_no = bank.bank_acc_no;
                    income.bank_code = bank.bank_code;
                }
            }
            return income;
        });
    }

    /**
     * Get dynamic column headers from processed incomes
     *
     * @param incomes - OtherIncome records
     * @returns Array of unique column definitions
     */
    getDynamicHeaders(incomes: OtherIncome[]): { column_key: string; display_title: string; income_type: string }[] {
        const headerMap = new Map<string, { column_key: string; display_title: string; income_type: string }>();

        for (const income of incomes) {
            const key = income.income_name.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 50);

            if (!headerMap.has(key)) {
                headerMap.set(key, {
                    column_key: key,
                    display_title: income.income_name,
                    income_type: income.income_type
                });
            }
        }

        return Array.from(headerMap.values());
    }
}

// Singleton instance
let instance: OtherIncomeProcessor | null = null;

export function getOtherIncomeProcessor(): OtherIncomeProcessor {
    if (!instance) {
        instance = new OtherIncomeProcessor();
    }
    return instance;
}
