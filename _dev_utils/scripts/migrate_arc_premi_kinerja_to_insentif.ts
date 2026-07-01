/**
 * Migrate ARC Juni 2026: PREMI KINERJA (gang-H karyawan panen) → PREMI INSENTIF PANEN
 *
 * Bug: kerani input PREMI KINERJA untuk karyawan panen (gang_code berakhiran 'H').
 * Seharusnya karyawan panen dapat PREMI INSENTIF PANEN.
 *
 * Scope: ONLY period_year=2026, period_month=6, division_code='ARC',
 * adjustment_name='PREMI KINERJA', gang_code ends with 'H'.
 * 4 records gang non-H tetap PREMI KINERJA (tidak disentuh).
 *
 * Steps:
 *   1. Backup 31 records to _dev_utils/migrate_arc_premi_kinerja_backup_2026-06.json
 *   2. UPDATE adjustment_name + remarks (rebuild pipe format with INSENTIF PANEN task_desc)
 *   3. Print before/after summary
 *
 * Usage: bun run _dev_utils/scripts/migrate_arc_premi_kinerja_to_insentif.ts
 *        bun run _dev_utils/scripts/migrate_arc_premi_kinerja_to_insentif.ts --dry-run
 */
import { writeFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const PERIOD_YEAR = 2026;
const PERIOD_MONTH = 6;
const DIVISION = 'ARC';
const BACKUP_PATH = '_dev_utils/migrate_arc_premi_kinerja_backup_2026-06.json';

const INSENTIF_TASK_DESC = '(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)';

async function main() {
    const { Database } = await import('../../src/db/client');
    const ext = Database.getExtendedInstance();

    // ── 1. Select records to migrate ───────────────────────────────────
    const records = await ext.query<{
        id: number; emp_code: string; emp_name: string; nik: string; gang_code: string;
        adjustment_name: string; amount: number; remarks: string; metadata_json: string | null;
        created_by: string; created_at: string;
    }>(`
        SELECT id, emp_code, emp_name, nik, gang_code, adjustment_name, amount, remarks,
               metadata_json, created_by, created_at
        FROM payroll_manual_adjustments
        WHERE period_year = ? AND period_month = ? AND division_code = ?
          AND adjustment_name = 'PREMI KINERJA'
          AND gang_code LIKE '%H'
        ORDER BY gang_code, emp_code
    `, [PERIOD_YEAR, PERIOD_MONTH, DIVISION]);

    console.log(`[migrate] Found ${records.length} PREMI KINERJA gang-H records in ${DIVISION} ${PERIOD_MONTH}/${PERIOD_YEAR}`);

    if (records.length === 0) {
        console.log('[migrate] Nothing to migrate. Exiting.');
        process.exit(0);
    }

    // ── 2. Backup ──────────────────────────────────────────────────────
    writeFileSync(BACKUP_PATH, JSON.stringify({
        migrated_at: new Date().toISOString(),
        dry_run: DRY_RUN,
        from: 'PREMI KINERJA',
        to: 'PREMI INSENTIF PANEN',
        records
    }, null, 2));
    console.log(`[migrate] Backup written to ${BACKUP_PATH}`);

    // ── 3. Build new remarks + UPDATE ──────────────────────────────────
    // remarks pipe format: name | adcode/task_desc | amount | sync:STATUS | match:STATUS
    // Preserve sync/match status from original remarks (tail after amount).
    let updated = 0;
    for (const r of records) {
        // Extract tail (sync:... | match:...) from original remarks
        const origParts = (r.remarks || '').split('|').map(p => p.trim());
        let tail = '';
        const syncIdx = origParts.findIndex(p => /^sync:/i.test(p));
        if (syncIdx !== -1) tail = origParts.slice(syncIdx).join(' | ');

        const newRemarks = [
            'PREMI INSENTIF PANEN',
            `${INSENTIF_TASK_DESC} - ${INSENTIF_TASK_DESC}`,
            String(r.amount),
            tail || 'sync:MANUAL | match:MANUAL'
        ].filter(Boolean).join(' | ');

        if (DRY_RUN) {
            console.log(`[dry-run] WOULD UPDATE id=${r.id} emp=${r.emp_code} gang=${r.gang_code} amount=${r.amount}`);
            console.log(`         old remarks: ${r.remarks}`);
            console.log(`         new remarks: ${newRemarks}`);
            continue;
        }

        await ext.query(`
            UPDATE payroll_manual_adjustments
            SET adjustment_name = 'PREMI INSENTIF PANEN',
                remarks = ?,
                updated_at = GETDATE()
            WHERE id = ?
        `, [newRemarks, r.id]);
        updated++;
    }

    console.log(`[migrate] ${DRY_RUN ? 'DRY RUN — 0 updated' : `Updated ${updated} records`}`);

    // ── 4. Verify ──────────────────────────────────────────────────────
    const after = await ext.query(`
        SELECT adjustment_name, COUNT(*) as cnt, SUM(amount) as total
        FROM payroll_manual_adjustments
        WHERE period_year = ? AND period_month = ? AND division_code = 'ARC'
          AND adjustment_name IN ('PREMI KINERJA', 'PREMI INSENTIF PANEN')
        GROUP BY adjustment_name
        ORDER BY adjustment_name
    `, [PERIOD_YEAR, PERIOD_MONTH]);
    console.log('[migrate] AFTER:', JSON.stringify(after, null, 2));

    process.exit(0);
}

main().catch(e => { console.error('[migrate] ERROR:', e); process.exit(1); });
