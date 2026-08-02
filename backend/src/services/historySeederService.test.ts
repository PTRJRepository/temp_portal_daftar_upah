import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "../db/client";
import { employeeGangHistoryService } from "./employeeGangHistoryService";
import { historyDatabaseService } from "./historyDatabaseService";
import { HistorySeederService } from "./historySeederService";
import { dataExtractorService } from "./dataExtractorService";
import { duplicateNikMitigationService } from "./DuplicateNikMitigationService";
import { payrollSnapshotBatchService } from "./payrollSnapshotBatchService";

describe("HistorySeederService HR seeding", () => {
    const service = HistorySeederService.getInstance();
    const originalGetInstance = Database.getInstance;
    const originalGetExtendedInstance = Database.getExtendedInstance;
    const originalResolveLatestEmpCodes = employeeGangHistoryService.resolveLatestEmpCodes;
    const originalSaveHrEmployeeHistory = historyDatabaseService.saveHrEmployeeHistory;
    const originalSavePayrollHistoryMaster = historyDatabaseService.savePayrollHistoryMaster;
    const originalSavePayrollHistoryDetail = historyDatabaseService.savePayrollHistoryDetail;
    const originalExtractPayrollDataProgressive = dataExtractorService.extractPayrollDataProgressive;
    const originalHasDuplicateNik = duplicateNikMitigationService.hasDuplicate;
    const originalGetAllEmpCodesForNik = duplicateNikMitigationService.getAllEmpCodesForNik;
    const originalCreateNextBatch = payrollSnapshotBatchService.createNextBatch;

    afterEach(() => {
        (Database as any).getInstance = originalGetInstance;
        (Database as any).getExtendedInstance = originalGetExtendedInstance;
        (employeeGangHistoryService as any).resolveLatestEmpCodes = originalResolveLatestEmpCodes;
        (historyDatabaseService as any).saveHrEmployeeHistory = originalSaveHrEmployeeHistory;
        (historyDatabaseService as any).savePayrollHistoryMaster = originalSavePayrollHistoryMaster;
        (historyDatabaseService as any).savePayrollHistoryDetail = originalSavePayrollHistoryDetail;
        (dataExtractorService as any).extractPayrollDataProgressive = originalExtractPayrollDataProgressive;
        (duplicateNikMitigationService as any).hasDuplicate = originalHasDuplicateNik;
        (duplicateNikMitigationService as any).getAllEmpCodesForNik = originalGetAllEmpCodesForNik;
        (payrollSnapshotBatchService as any).createNextBatch = originalCreateNextBatch;
        HistorySeederService.forceReset("test cleanup");
    });

    it("fetches payroll rows for snapshot seeding via extractPayrollDataProgressive complete phase", async () => {
        let capturedArgs: any[] = [];
        let calledWithArgs = false;
        (dataExtractorService as any).extractPayrollDataProgressive = (...args: any[]) => {
            capturedArgs = args as any[];
            calledWithArgs = true;
            return (async function* () {
                yield {
                    phase: "identity",
                    gangs: new Map(),
                    meta: {
                        total_gangs: 1,
                        total_employees: 1,
                        processed_employees: 0,
                        progress_pct: 10,
                        message: "identity"
                    }
                };
                yield {
                    phase: "complete",
                    gangs: new Map([
                        ["A01", [{
                            emp_code: "EMP001",
                            nama: "BUDI",
                            gang_code: "A01",
                            jumlah_hk: 20
                        }]]
                    ]),
                    meta: {
                        total_gangs: 1,
                        total_employees: 1,
                        processed_employees: 1,
                        progress_pct: 100,
                        message: "complete"
                    }
                };
            })();
        };

        const grouped = await (service as any).fetchPayrollData({
            periodMonth: 4,
            periodYear: 2026,
            divisionCode: "TSA",
            gangCode: "A01",
            createdBy: "test",
            seederMode: "PAYROLL"
        });

        expect(calledWithArgs).toBe(true);
        // month, year, gangCode, divisionCode
        expect((capturedArgs as any[])[0]).toBe(4);
        expect((capturedArgs as any[])[1]).toBe(2026);
        expect((capturedArgs as any[])[2]).toBe("A01");
        expect((capturedArgs as any[])[3]).toBe("TSA");
        expect((capturedArgs as any[])[6]).toBe(false);
        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            gang_code: "A01",
            employees: [{
                emp_code: "EMP001",
                nama: "BUDI",
                gang_code: "A01",
                jumlah_hk: 20
            }],
            payroll_totals: {
                employee_count: 1,
                jumlah_hk: 20
            }
        });
    });

    it("builds HR employee query with pre-aggregated HK data instead of per-employee subquery", async () => {
        let capturedSql = "";

        (Database as any).getInstance = () => ({
            query: async (sql: string) => {
                capturedSql = sql;
                return [];
            }
        });
        (employeeGangHistoryService as any).resolveLatestEmpCodes = async () => new Map();

        const result = {
            success: false,
            history_id: "HIST-TEST",
            period_month: 4,
            period_year: 2026,
            division_code: "ALL",
            gang_code: "ALL",
            total_employees: 0,
            records_inserted: { master: 0, detail: 0, taskreg: 0, adtrans: 0, gang_member: 0, hr_employee: 0 },
            errors: []
        };

        await (service as any).seedEmployeeHrHistory("HIST-TEST", {
            periodMonth: 4,
            periodYear: 2026,
            createdBy: "test",
            seederMode: "ALL_HR"
        }, result);

        expect(capturedSql).toContain("LEFT JOIN (");
        expect(capturedSql).toContain("e.ResAddress as res_address");
        expect(capturedSql).toContain("hs.TaxNo as pajak_npwp");
        expect(capturedSql).toContain("LEFT JOIN HR_STATUTORY hs");
        expect(capturedSql).toContain("GROUP BY hk.emp_code");
        expect(capturedSql).not.toContain("WHERE trl.EmpCode = e.EmpCode");
    });

    it("updates total employees and progress during HR employee seeding", async () => {
        (Database as any).getInstance = () => ({
            query: async () => ([
                { nik: "3171", emp_code: "B0001", emp_name: "BUDI", total_hk: 10 },
                { nik: "3172", emp_code: "B0002", emp_name: "SITI", total_hk: 12 }
            ])
        });
        (employeeGangHistoryService as any).resolveLatestEmpCodes = async () => new Map();
        (historyDatabaseService as any).saveHrEmployeeHistory = async () => 1;

        const result = {
            success: false,
            history_id: "HIST-TEST",
            period_month: 4,
            period_year: 2026,
            division_code: "ALL",
            gang_code: "ALL",
            total_employees: 0,
            records_inserted: { master: 0, detail: 0, taskreg: 0, adtrans: 0, gang_member: 0, hr_employee: 0 },
            errors: []
        };

        HistorySeederService.forceReset("test start");

        await (service as any).seedEmployeeHrHistory("HIST-TEST", {
            periodMonth: 4,
            periodYear: 2026,
            createdBy: "test",
            seederMode: "ALL_HR"
        }, result);

        expect(result.total_employees).toBe(2);
        expect(result.records_inserted.hr_employee).toBe(2);
        expect(HistorySeederService.getProgress().employees_processed).toBe(2);
    });

    it("passes tax identity, jabatan, position, and SPSI membership into HR employee history rows", async () => {
        const savedRows: any[] = [];

        (Database as any).getInstance = () => ({
            query: async () => ([
                {
                    nik: "3171",
                    emp_code: "B0001",
                    emp_name: "BUDI",
                    company_code: "CMP",
                    division_code: "TSA",
                    loc_code: "TSA",
                    gang_code: "A01",
                    pajak_npwp: "12.345.678.9-000.000",
                    res_address: "JL KEBUN",
                    total_hk: 10
                }
            ])
        });
        (Database as any).getExtendedInstance = () => ({
            query: async () => ([
                { empcode: "B0001", jabatan: "Mandor Panen" }
            ])
        });
        (employeeGangHistoryService as any).resolveLatestEmpCodes = async () => new Map();
        (historyDatabaseService as any).saveHrEmployeeHistory = async (row: any) => {
            savedRows.push(row);
            return 1;
        };

        const result = {
            success: false,
            history_id: "HIST-TEST",
            period_month: 4,
            period_year: 2026,
            division_code: "ALL",
            gang_code: "ALL",
            total_employees: 0,
            records_inserted: { master: 0, detail: 0, taskreg: 0, adtrans: 0, gang_member: 0, hr_employee: 0 },
            errors: []
        };

        await (service as any).seedEmployeeHrHistory("HIST-TEST", {
            periodMonth: 4,
            periodYear: 2026,
            createdBy: "test",
            seederMode: "ALL_HR"
        }, result);

        expect(savedRows).toHaveLength(1);
        expect(savedRows[0]).toMatchObject({
            emp_code: "B0001",
            position: "Mandor Panen",
            jabatan: "Mandor Panen",
            pajak_npwp: "12.345.678.9-000.000",
            res_address: "JL KEBUN",
            is_spsi_member: true
        });
    });

    it("stores actual gang division_code when seeding ALL scope payroll snapshots", async () => {
        const savedMasterRows: any[] = [];
        const savedDetailRows: any[] = [];
        const capturedBatchScopes: any[] = [];

        (historyDatabaseService as any).savePayrollHistoryMaster = async (row: any) => {
            savedMasterRows.push(row);
            return 4314;
        };
        (historyDatabaseService as any).savePayrollHistoryDetail = async (row: any) => {
            savedDetailRows.push(row);
            return 9001;
        };
        (duplicateNikMitigationService as any).hasDuplicate = async () => false;
        (payrollSnapshotBatchService as any).createNextBatch = async (scope: any) => {
            capturedBatchScopes.push(scope);
            return { id: 27, snapshot_version: 1 };
        };

        const result = {
            success: false,
            history_id: "HIST-TEST",
            period_month: 4,
            period_year: 2026,
            division_code: "ALL",
            gang_code: "ALL",
            total_employees: 0,
            records_inserted: { master: 0, detail: 0, taskreg: 0, adtrans: 0, gang_member: 0, hr_employee: 0 },
            errors: []
        };

        await (service as any).seedGangHistory("HIST-TEST", {
            gang_code: "A3H",
            employees: [{
                emp_code: "E001",
                nama: "BUDI",
                nik: "3171",
                gang_code: "A3H",
                loc_code: "AB1",
                division_code: "AB1",
                jumlah_hk: 20
            }]
        }, {
            periodMonth: 4,
            periodYear: 2026,
            divisionCode: "ALL",
            gangCode: "ALL",
            createdBy: "system",
            seederMode: "PAYROLL"
        }, result);

        expect(capturedBatchScopes).toHaveLength(1);
        expect(capturedBatchScopes[0]).toMatchObject({
            division_code: "AB1",
            gang_code: "A3H"
        });

        expect(savedMasterRows).toHaveLength(1);
        expect(savedMasterRows[0]).toMatchObject({
            division_code: "AB1",
            gang_code: "A3H"
        });

        expect(savedDetailRows).toHaveLength(1);
        expect(savedDetailRows[0]).toMatchObject({
            division_code: "AB1",
            gang_code: "A3H"
        });
    });

    it("calculates snapshot header totals from the same payroll fields as Daftar Upah", () => {
        const totals = (service as any).calculateTotals([
            {
                jumlah_hk: 20,
                hari_kerja: 18,
                upah_pokok: 900,
                gaji_pokok: 1000,
                total_premi: 70,
                pph21_ter: 40,
                pot_pph21: 10,
                pot_bpjs_kesehatan_majikan: 13,
                pot_bpjs_pensiun_majikan: 14,
                pot_astek_majikan: 99,
                total_potongan: 30,
                jumlah_upah_kotor: 2000,
                upah_bersih: 1900
            },
            {
                jumlah_hk: 21,
                hari_kerja: 19,
                upah_pokok: 800,
                gaji_pokok: 1100,
                total_premi: 80,
                pph21_ter: 60,
                pot_pph21: 12,
                pot_bpjs_kesehatan_majikan: 15,
                pot_bpjs_pensiun_majikan: 16,
                pot_astek_majikan: 88,
                total_potongan: 31,
                jumlah_upah_kotor: 3000,
                upah_bersih: 2900
            }
        ]);

        expect(totals.total_hk).toBe(41);
        expect(totals.total_hari_kerja).toBe(37);
        expect(totals.total_upah_pokok).toBe(1700);
        expect(totals.total_gaji_pokok).toBe(2100);
        expect(totals.total_premi).toBe(150);
        expect(totals.total_pph21).toBe(22);
        expect(totals.total_bpjs_majikan).toBe(58);
        expect(totals.total_potongan).toBe(61);
        expect(totals.total_upah_kotor).toBe(5000);
        expect(totals.total_upah_bersih).toBe(4800);
    });

    it("reconciles grouped payroll snapshot totals to the division grand total", async () => {
        (dataExtractorService as any).extractPayrollDataProgressive = () => (async function* () {
            yield {
                phase: "complete",
                gangs: new Map([
                    ["A01", [{
                        emp_code: "EMP001",
                        nama: "BUDI",
                        gang_code: "A01",
                        jumlah_hk: 1,
                        upah_bersih: 10.4
                    }]],
                    ["A02", [{
                        emp_code: "EMP002",
                        nama: "SITI",
                        gang_code: "A02",
                        jumlah_hk: 1,
                        upah_bersih: 10.4
                    }]]
                ]),
                meta: {
                    total_gangs: 2,
                    total_employees: 2,
                    processed_employees: 2,
                    progress_pct: 100,
                    message: "complete"
                }
            };
        })();

        const grouped = await (service as any).fetchPayrollData({
            periodMonth: 4,
            periodYear: 2026,
            divisionCode: "P1A",
            gangCode: "ALL",
            createdBy: "test",
            seederMode: "PAYROLL"
        });

        const groupedTotal = grouped.reduce(
            (sum: number, gang: any) => sum + Number(gang.payroll_totals?.upah_bersih || 0),
            0
        );

        expect(groupedTotal).toBe(21);
        expect(grouped.map((gang: any) => gang.payroll_totals.upah_bersih).sort()).toEqual([10, 11]);
    });
});
