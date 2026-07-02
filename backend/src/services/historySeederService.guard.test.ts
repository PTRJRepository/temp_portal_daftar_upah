import { describe, expect, it } from "bun:test";
import { HistorySeederService } from "./historySeederService";

// Pin guard behavior untuk SPSI forward-persistence + join_date override SSOT.
// Lihat historySeederService.resolveSpsiWithGuard / resolveJoinDate.
describe("HistorySeeder SPSI guard + join_date SSOT", () => {
    const svc = HistorySeederService.getInstance() as any;

    it("resolveSpsiWithGuard: forward-persist + override priority", () => {
        const overrides = new Map([
            ["OVTRUE", { emp_code: "OVTRUE", is_spsi_member: true, effective_start_date: null, update_index: 1 }],
            ["OVFALSE", { emp_code: "OVFALSE", is_spsi_member: false, effective_start_date: null, update_index: 1 }],
        ]);
        const prior = new Set(["PRIOR1", "PRIOR2"]);

        // override true menang regardless computed
        expect(svc.resolveSpsiWithGuard("OVTRUE", false, overrides, prior)).toBe(true);
        // override false (user set keluar) -> false walau computed true / prior
        expect(svc.resolveSpsiWithGuard("OVFALSE", true, overrides, prior)).toBe(false);
        // no override, prior member -> forward-persist true walau computed false
        expect(svc.resolveSpsiWithGuard("PRIOR1", false, overrides, prior)).toBe(true);
        // no override, computed true -> true
        expect(svc.resolveSpsiWithGuard("PRIOR2", true, overrides, prior)).toBe(true);
        // no override, no prior, computed false -> false
        expect(svc.resolveSpsiWithGuard("NONE", false, overrides, prior)).toBe(false);
    });

    it("resolveJoinDate: SSOT effective_start_date > fallback AppJoinGrpDate", () => {
        const overrides = new Map([
            ["EMP1", { emp_code: "EMP1", is_spsi_member: true, effective_start_date: "2010-05-01", update_index: 1 }],
            // is_spsi_member type lemah: boolean | number
            ["EMP2", { emp_code: "EMP2", is_spsi_member: false, effective_start_date: null, update_index: 1 }],
        ]);
        // override punya effective_start_date -> pakai itu
        expect(svc.resolveJoinDate("EMP1", overrides, "2007-12-03")).toBe("2010-05-01");
        // override tanpa effective_start_date -> fallback
        expect(svc.resolveJoinDate("EMP2", overrides, "2008-05-01")).toBe("2008-05-01");
        // no override -> fallback
        expect(svc.resolveJoinDate("NONE", overrides, "2009-01-01")).toBe("2009-01-01");
    });

    it("resolveSpsiWithGuard handle numeric is_spsi_member (runtime bit 0/1)", () => {
        const overrides = new Map([
            ["NUM1", { emp_code: "NUM1", is_spsi_member: 1, effective_start_date: null, update_index: 1 }],
            ["NUM0", { emp_code: "NUM0", is_spsi_member: 0, effective_start_date: null, update_index: 1 }],
        ]);
        expect(svc.resolveSpsiWithGuard("NUM1", false, overrides, new Set())).toBe(true);
        expect(svc.resolveSpsiWithGuard("NUM0", true, overrides, new Set())).toBe(false);
    });
});
