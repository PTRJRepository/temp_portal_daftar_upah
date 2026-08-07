import { historySeederService } from "./src/services/historySeederService";
const divs = ['DME','ARA','AB1','AB2','P2B','IJL'];
for (const d of divs) {
  const t0 = Date.now();
  try {
    const res = await historySeederService.seedPayrollHistory({
      periodMonth: 7, periodYear: 2026, divisionCode: d,
      seederMode: 'PAYROLL', force: true, createdBy: 'dev-check'
    });
    console.log(`${d}: ${((Date.now()-t0)/1000).toFixed(1)}s success=${res.success} emp=${res.total_employees} detail=${res.records_inserted.detail} err=${res.errors.length}`);
  } catch (e: any) {
    console.log(`${d}: EXCEPTION ${e.message}`);
  }
}
process.exit(0);
