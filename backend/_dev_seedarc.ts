import { historySeederService } from "./src/services/historySeederService";
const t0 = Date.now();
const res = await historySeederService.seedPayrollHistory({
  periodMonth: 7, periodYear: 2026, divisionCode: 'ARC',
  seederMode: 'PAYROLL', force: true, createdBy: 'dev-check'
});
console.log(`ARC seed: ${Date.now()-t0}ms`);
console.log(JSON.stringify(res, null, 1).slice(0, 1500));
process.exit(0);
