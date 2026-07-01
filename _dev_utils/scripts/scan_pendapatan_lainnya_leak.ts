/**
 * Scan all divisions for leak: pendapatan_lainnya (KONTAN/THR/Bonus) appearing
 * in koreksi fields or potongan_upah_kotor_total.
 *
 * LEAK condition: any koreksi* field value matches a pendapatan_* amount
 * (indicates KONTAN/THR misrouted into koreksi path).
 *
 * Usage: bun run _dev_utils/scripts/scan_pendapatan_lainnya_leak.ts
 */
import { writeFileSync } from 'fs';

const API_KEY = '88217c42101662147aee16779663caa22ff1e896b57568a6576ed56f2f3d124a';
const BASE = 'http://localhost:8002';
const MONTH = 6, YEAR = 2026;
const OUT = '_dev_utils/scripts/scan_pendapatan_lainnya_leak.out.txt';

const divisions = [
    'PG1A','PG1B','PG2A','PG2B','PGE','DME','ARA','ARB1','ARB2',
    'INFRA','IJL','STF-OFFICE','SECURITY','ARC','P1A','P1B','P2A','P2B',
    'AB1','AB2','INF','NRS','WKS_AR','WKS_PG','WORKSHOP','MILL'
];

const lines: string[] = [];
const log = (s: string) => { lines.push(s); console.log(s); };

let totalLeaks = 0, totalEmps = 0, totalDiv = 0;

for (const div of divisions) {
    try {
        const res = await fetch(`${BASE}/payroll/report/division-raw-tree?division_code=${div}&month=${MONTH}&year=${YEAR}`, {
            headers: { 'X-API-Key': API_KEY }
        });
        if (!res.ok) { log(`${div}: HTTP ${res.status}`); continue; }
        const data: any = await res.json();
        const gangs = data.gangs || [];
        let divEmps = 0;
        const divLeaks: any[] = [];

        for (const g of gangs) {
            for (const r of (g.employees || [])) {
                divEmps++;
                totalEmps++;
                const lainnya = Number(r.pendapatan_lainnya || 0);
                const kontan = Number(r.pendapatan_kontan || r.pendapatan_kontanan || 0);
                const thr = Number(r.pendapatan_thr || 0);
                const bonus = Number(r.pendapatan_bonus || 0);
                const earningVals = [lainnya, kontan, thr, bonus].filter(v => v > 0);

                const koreksiFields: Record<string, number> = {};
                for (const [k, v] of Object.entries(r)) {
                    if (/^koreksi/i.test(k) && Number(v || 0) !== 0) koreksiFields[k] = Number(v);
                }
                const pukt = Number(r.potongan_upah_kotor_total || 0);

                // LEAK: koreksi field value equals an earning amount (KONTAN/THR misrouted)
                const koreksiVals = Object.values(koreksiFields);
                const leakMatch = koreksiVals.find(kv => earningVals.includes(kv));
                if (leakMatch) {
                    divLeaks.push({
                        emp: r.emp_code, koreksiFields, pukt,
                        lainnya, kontan, thr, bonus
                    });
                }
            }
        }
        totalDiv++;
        totalLeaks += divLeaks.length;
        if (divLeaks.length) {
            log(`\n=== ${div}: ${divLeaks.length} LEAK (of ${divEmps} emps) ===`);
            divLeaks.slice(0, 3).forEach(l => log(JSON.stringify(l)));
        } else {
            log(`${div}: clean (${divEmps} emps)`);
        }
    } catch (e: any) {
        log(`${div}: ERR ${e.message}`);
    }
}

log(`\n=== TOTAL: ${totalLeaks} leaks across ${totalEmps} employees in ${totalDiv} divisions ===`);
writeFileSync(OUT, lines.join('\n'));
process.exit(0);
