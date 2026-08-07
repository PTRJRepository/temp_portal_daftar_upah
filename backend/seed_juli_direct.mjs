import { seedAggregationParallel } from "./src/api/parallelAggregationSeeder.ts";
const auth = "Bearer dummy-system"; // parallel seeder uses PayrollDataService with token — need real
import { Config } from "./src/config.ts";
const token = "Bearer " + Config.SYSTEM_TOKEN;
console.log("start direct seed AB1 ARA etc");
const res = await seedAggregationParallel(["AB1","AB2","ARA","ARC","DME"], 7, 2026, token, true);
console.log(JSON.stringify(res,null,2));
