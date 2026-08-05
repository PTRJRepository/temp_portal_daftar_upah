import {
    manualAdjustmentService,
    type ManualAdjustmentSyncStatusUpdateResult
} from "./manualAdjustmentService";

const DEFAULT_MANUAL_SYNC_ADJUSTMENT_TYPES = ["PREMI", "POTONGAN_KOTOR", "POTONGAN_BERSIH", "AUTO_BUFFER"];

export type ManualAdjustmentSyncStatusSeedInput = {
    period_month: number;
    period_year: number;
    division_code?: string;
    gang_code?: string;
    emp_code?: string;
    adjustment_types?: string[];
    adjustment_name?: string;
    ids?: number[];
    sync_status?: string;
    created_by?: string;
    only_if_adtrans_exists?: boolean;
    dry_run?: boolean;
    limit?: number;
};

export type ManualAdjustmentSyncStatusSeedResult = ManualAdjustmentSyncStatusUpdateResult & {
    seeder: "manual_adjustment_sync_status";
    adjustment_types: string[];
};

function normalizeAdjustmentTypes(values?: string[]): string[] {
    const rawTypes = (values && values.length > 0 ? values : DEFAULT_MANUAL_SYNC_ADJUSTMENT_TYPES)
        .flatMap((value) => String(value || "").split(","))
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);

    return Array.from(new Set(rawTypes.length ? rawTypes : DEFAULT_MANUAL_SYNC_ADJUSTMENT_TYPES));
}

export class ManualAdjustmentSyncStatusSeederService {
    public async seedPeriod(input: ManualAdjustmentSyncStatusSeedInput): Promise<ManualAdjustmentSyncStatusSeedResult> {
        const adjustmentTypes = normalizeAdjustmentTypes(input.adjustment_types);
        const result = await manualAdjustmentService.updateManualAdjustmentSyncStatus({
            periodMonth: Number(input.period_month),
            periodYear: Number(input.period_year),
            divisionCode: input.division_code,
            gangCode: input.gang_code,
            empCode: input.emp_code,
            adjustmentTypes,
            adjustmentName: input.adjustment_name,
            ids: input.ids,
            syncStatus: input.sync_status || "SYNC",
            updatedBy: input.created_by || "sync_status_seeder",
            onlyIfAdtransExists: input.only_if_adtrans_exists !== false,
            dryRun: input.dry_run === true,
            limit: input.limit
        });

        return {
            seeder: "manual_adjustment_sync_status",
            adjustment_types: adjustmentTypes,
            ...result
        };
    }
}

export const manualAdjustmentSyncStatusSeederService = new ManualAdjustmentSyncStatusSeederService();
