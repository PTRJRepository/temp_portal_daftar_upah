export interface EmployeeProfileOverrideRow {
    emp_code: string;
    nik?: string | null;
    is_spsi_member: boolean;
    effective_start_date?: string | null;
    update_index: number;
}

export interface PayrollValueOverrideRow {
    period_month: number;
    period_year: number;
    division_code: string;
    gang_code: string;
    emp_code: string;
    field_name: string;
    numeric_value?: number | null;
    text_value?: string | null;
    update_index: number;
}

export interface PayrollSnapshotBatchRow {
    snapshot_version: number;
}
