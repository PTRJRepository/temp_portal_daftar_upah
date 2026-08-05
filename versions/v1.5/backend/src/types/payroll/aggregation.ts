export interface ColumnAggregationConfig {
    column_id: string;
    column_name: string;
    aggregation_type: 'sum' | 'avg' | 'count' | 'min' | 'max';
    data_type: 'numeric' | 'string';
    is_monetary: boolean;
    is_hidden_when_empty: boolean;
}

export interface PayrollSummary {
    total_employees: number;
    total_hk: number;
    total_upah_dasar: number;
    total_upah_pokok: number;
    total_gaji_pokok: number;
    total_tunjangan: number;
    total_potongan: number;
    total_upah_bersih: number;
    average_upah_bersih: number;
    min_upah_bersih: number;
    max_upah_bersih: number;
}

export interface PayrollStatistics {
    total_hadir: number;
    total_cuti_tahunan: number;
    total_cuti_sakit: number;
    total_cuti_minggu: number;
    total_cuti_nasional: number;
    total_tidak_hadir: number;

    total_beras: number;
    total_jabatan: number;
    total_masa_kerja: number;
    total_lembur: number;

    total_pph21: number;
    total_koreksi: number;
    total_bpjs_pekerja: number;
    total_bpjs_majikan: number;
    total_bpjs_pensiun_pekerja: number;
    total_bpjs_pensiun_majikan: number;
    total_spsi: number;

    total_brondol: number;
    total_pruning: number;
    total_premi_dinamis_1: number;
    total_premi_dinamis_2: number;
    total_premi_dinamis_3: number;
    total_premi_dinamis_4: number;
    total_premi_dinamis_5: number;
    total_premi_dinamis_6: number;
    total_premi_dinamis_7: number;
}

export interface BusinessRulesResponse {
    gang_code: string;
    month: number;
    year: number;
    rules_applied: any[];
    processed_data: any[];
}

export interface AggregatedPayrollResponse {
    gang_code: string;
    month: number;
    year: number;
    period: string;
    generated_at: Date;
    total_records: number;
    processing_time_ms: number;
    use_threading: boolean;
    data_rows: any[];
    summary: PayrollSummary;
    statistics: PayrollStatistics;
    columns_info: ColumnAggregationConfig[];
    empty_columns: string[];
    business_rules: BusinessRulesResponse;
}
