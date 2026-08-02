import { test, expect, describe, mock } from "bun:test";
import { ManualAdjustmentService } from "./manualAdjustmentService";
import { PremiumDefinitionService } from "./premiumDefinitionService";

// Fixture definitions for premiumDefinitionService
const fixtureDefs = [
    { adjustment_type: "PREMI", adjustment_name: "PREMI PRUNING", ad_code: "(AL3PM0601P1A) (AL) TUNJANGAN PREMI ((PM) PRUNING)", task_desc: "(AL) TUNJANGAN PREMI ((PM) PRUNING)", input_type: "blok" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI RAKING", ad_code: "(AL) TUNJANGAN PREMI ((PM) WEEDING - CIRCLE RAKING)", task_desc: "(AL) TUNJANGAN PREMI ((PM) WEEDING - CIRCLE RAKING)", input_type: "blok" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI TIKET", ad_code: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", task_desc: "(AL) TUNJANGAN PREMI ((PM) HARVESTING LABOUR - HARVESTING)", input_type: "amount" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI JAGA TANGGUNG JAWAB", ad_code: "(AL) TUNJANGAN PREMI (WORKSHOP CONTROL ACCOUNT)", task_desc: "(AL) TUNJANGAN PREMI (WORKSHOP CONTROL ACCOUNT)", input_type: "exp" as const, is_active: true },
    { adjustment_type: "PREMI", adjustment_name: "PREMI ANGKUT TBS", ad_code: "(AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT TBS)", task_desc: "(AL) TUNJANGAN PREMI ((PM) DRIVER - ANGKUT TBS)", input_type: "kendaraan" as const, is_active: true }
];

// Patch premiumDefinitionService to use fixture
const pProto = PremiumDefinitionService.prototype as any;
pProto.loadDefinitions = function () { return fixtureDefs; };
pProto.getDefinitionsFingerprint = function () { return "test"; };

// Mock DB
type Row = Record<string, any>;
function makeMockDb(opts: { sourceRows: Row[]; collisionByEmp?: Record<string, Row[]> }) {
    const updates: any[] = [];
    const db = {
        async query(_sql: string, _params: any[]) { return [] as Row[]; },
        async queryOne(_sql: string, params: any[]) {
            // collision check: params = [periodMonth, periodYear, adjustmentType, toName, empCode, nik, empCode]
            const empCode = String(params[4] || "");
            const collisions = opts.collisionByEmp?.[empCode] || [];
            return collisions[0] || null;
        }
    };
    // Override query for source rows fetch
    db.query = async (_sql: string, _params: any[]) => opts.sourceRows as Row[];
    return { db, updates };
}

// Subclass to inject mock db
class TestService extends ManualAdjustmentService {
    private _db: any;
    constructor(db: any) { super(); this._db = db; }
    protected getDatabaseOverride() { return this._db; }
}

// ManualAdjustmentService.getDatabase is private; patch via prototype
const origGetDb = (ManualAdjustmentService.prototype as any).getDatabase;

function withMockDb(sourceRows: Row[], collisionByEmp: Record<string, Row[]> = {}) {
    const { db } = makeMockDb({ sourceRows, collisionByEmp });
    (ManualAdjustmentService.prototype as any).getDatabase = () => db;
    // ensureManualAdjustmentIdentitySchema no-op
    (ManualAdjustmentService as any).identitySchemaEnsured = true;
    const svc = ManualAdjustmentService.getInstance();
    return { svc, db };
}

function restoreDb() {
    (ManualAdjustmentService.prototype as any).getDatabase = origGetDb;
}

const baseInput = {
    period_month: 4, period_year: 2026,
    division_code: "PG1A", adjustment_type: "PREMI",
    from_adjustment_name: "PREMI PRUNING", to_adjustment_name: "PREMI RAKING",
    updated_by: "tester"
};

describe("convertAdjustmentType", () => {
    test("validation block throws (blok → kendaraan)", async () => {
        const { svc } = withMockDb([]);
        try {
            await svc.convertAdjustmentType({ ...baseInput, to_adjustment_name: "PREMI ANGKUT TBS" });
            expect(false).toBe(true);
        } catch (e: any) {
            expect(e.message).toContain("diblokir");
        }
        restoreDb();
    });

    test("keep metadata same input_type (blok→blok)", async () => {
        const sourceRows = [{ id: 1, emp_code: "A0001", nik: "111", gang_code: "PG1A", amount: 1000, metadata_json: JSON.stringify({ input_type: "blok", items: [{ subblok: "P0921", gang_code: "PG1A", jumlah: 1000 }], total_amount: 1000 }), remarks: "", adjustment_type: "PREMI" }];
        const { svc } = withMockDb(sourceRows);
        const result = await svc.convertAdjustmentType(baseInput);
        expect(result.converted_count).toBe(1);
        expect(result.metadata_remapped_count).toBe(0);
        restoreDb();
    });

    test("seed amount→blok placeholder", async () => {
        const sourceRows = [{ id: 2, emp_code: "A0002", nik: "222", gang_code: "PG1A", amount: 5000, metadata_json: null, remarks: "", adjustment_type: "PREMI" }];
        const { svc } = withMockDb(sourceRows);
        const result = await svc.convertAdjustmentType({ ...baseInput, from_adjustment_name: "PREMI TIKET", to_adjustment_name: "PREMI PRUNING" });
        expect(result.converted_count).toBe(1);
        expect(result.metadata_seeded_count).toBe(1);
        restoreDb();
    });

    test("remap exp→kendaraan allowed", async () => {
        const sourceRows = [{ id: 3, emp_code: "A0003", nik: "333", gang_code: "PG1A", amount: 3000, metadata_json: JSON.stringify({ input_type: "exp", expense_code: "DRIVER", jumlah: 3000, total_amount: 3000 }), remarks: "", adjustment_type: "PREMI" }];
        const { svc } = withMockDb(sourceRows);
        const result = await svc.convertAdjustmentType({ ...baseInput, from_adjustment_name: "PREMI JAGA TANGGUNG JAWAB", to_adjustment_name: "PREMI ANGKUT TBS" });
        expect(result.converted_count).toBe(1);
        expect(result.metadata_remapped_count).toBe(1);
        restoreDb();
    });

    test("collision → skip row", async () => {
        const sourceRows = [{ id: 4, emp_code: "A0004", nik: "444", gang_code: "PG1A", amount: 2000, metadata_json: null, remarks: "", adjustment_type: "PREMI" }];
        const { svc } = withMockDb(sourceRows, { "A0004": [{ id: 99 }] });
        const result = await svc.convertAdjustmentType(baseInput);
        expect(result.converted_count).toBe(0);
        expect(result.skipped_collision_count).toBe(1);
        restoreDb();
    });

    test("remarks rebuilt with target ad_code/task_desc", async () => {
        const sourceRows = [{ id: 5, emp_code: "A0005", nik: "555", gang_code: "PG1A", amount: 1500, metadata_json: null, remarks: "", adjustment_type: "PREMI" }];
        const { svc, db } = withMockDb(sourceRows);
        const captured: any[] = [];
        db.query = async (sql: string, params: any[]) => {
            if (sql.includes("UPDATE")) captured.push({ sql, params });
            return sourceRows;
        };
        await svc.convertAdjustmentType(baseInput);
        expect(captured.length).toBe(1);
        const remarks = captured[0].params[1];
        // remarks carries target ad_code/task_desc (WEEDING - CIRCLE RAKING = PREMI RAKING def)
        expect(remarks).toContain("WEEDING - CIRCLE RAKING");
        // adjustment_name param = target name
        const adjustmentNameParam = captured[0].params[0];
        expect(adjustmentNameParam).toBe("PREMI RAKING");
        restoreDb();
    });
});
