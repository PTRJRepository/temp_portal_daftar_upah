import { PayrollDataService } from "./src/services/payrollDataService.ts";
import { Config } from "./src/config.ts";
const token = "Bearer " + Config.SYSTEM_TOKEN;
console.log("token len " + token.length);
try {
  const data = await PayrollDataService.fetchPayrollData("AB1", 7, 2026, token);
  let total=0; for(const k of Object.keys(data)){ console.log(k + " " + data[k].length); for(const r of data[k]) console.log("  gang=" + r.gang_code + " emp=" + r.total_employees); total+=data[k].length; }
  console.log("total records " + total);
} catch(e){ console.error(e.message.slice(0,500)); }
