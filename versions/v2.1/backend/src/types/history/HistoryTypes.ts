export interface PayrollHistoryMaster {
    id?: number;
    history_id: string;
    snapshot_batch_id?: number;
    snapshot_version?: number;
    period_month: number;
    period_year: number;
    division_code: string;
    gang_code: string;
    gang_description?: string;
    total_employees: number;
    total_hk: number;
    total_hari_kerja: number;
    total_cuti_tahunan: number;
    total_cuti_sakit: number;
    total_cuti_minggu: number;
    total_cuti_nasional: number;
    total_upah_dasar: number;
    total_upah_pokok: number;
    total_gaji_pokok: number;
    total_beras: number;
    total_jabatan: number;
    total_masa_kerja: number;
    total_lembur: number;
    total_tunjangan: number;
    total_premi_brondol: number;
    total_premi_prunning: number;
    total_premi_insentif: number;
    total_premi_kinerja: number;
    total_premi: number;
    dynamic_premi_data?: string;
    total_koreksi: number;
    total_potongan: number;
    total_pph21: number;
    total_bpjs_pekerja: number;
    total_bpjs_majikan: number;
    total_spsi: number;
    dynamic_potongan_data?: string;
    total_upah_kotor: number;
    total_upah_bersih: number;
    total_ffb_weight?: number;
    total_weight_tbs?: number;
    informasi_tambahan?: string;
    created_at?: Date;
    created_by?: string;
    source_endpoint?: string;
    is_locked?: boolean;
    lock_reason?: string;
}

export interface PayrollHistoryDetail {
    id?: number;
    history_id: string;
    master_id: number;
    snapshot_batch_id?: number;
    snapshot_version?: number;
    emp_code: string;
    emp_name?: string;
    nik?: string;
    new_nik?: string;
    gender?: string;
    gang_code: string;
    division_code: string;
    loc_code?: string;
    status_ptkp?: string;
    kategori_ter?: string;
    hari_kerja: number;
    cuti_tahunan_hari: number;
    cuti_sakit_haid_hari: number;
    cuti_minggu_hari: number;
    cuti_nasional_hari: number;
    jumlah_hk: number;
    total_jam_kerja: number;
    upah_dasar: number;
    upah_pokok: number;
    gaji_pokok: number;
    gaji_pokok_ideal: number;
    gaji_pokok_aktual: number;
    koreksi_hk: number;
    beras_rate: number;
    beras_jumlah: number;
    jabatan_rate: number;
    jabatan_jumlah: number;
    masa_kerja_tahun: number;
    masa_kerja_rate: number;
    masa_kerja_jumlah: number;
    lembur_jam: number;
    lembur_rate: number;
    lembur_jumlah: number;
    lembur_records?: string;
    total_tunjangan: number;
    premi_brondol: number;
    premi_brondol_loosefruit?: number;
    premi_brondol_adtrans?: number;
    premi_brondol_total?: number;
    premi_pph: number;
    total_premi: number;
    premi_detail?: string;
    pot_spsi: number;
    pot_pph21: number;
    pot_koreksi: number;
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_kesehatan_majikan: number;
    pot_bpjs_pensiun_pekerja: number;
    pot_bpjs_pensiun_majikan: number;
    pot_bpjs_pekerja_total: number;
    pot_astek_pekerja: number;
    pot_astek_majikan: number;
    pot_astek_jumlah: number;
    potongan_detail?: string;
    total_potongan: number;
    total_potongan_bersih: number;
    jumlah_upah_kotor: number;
    upah_kotor_pajak: number;
    penghasilan_bruto: number;
    tarif_pajak_ter?: number;
    pph21_ter: number;
    upah_bersih: number;
    task_code?: string;
    task_desc?: string;
    shortage_details?: string;
    shortage_total_hours?: number;
    jabatan?: string;  // Job title (e.g. "Karyawan Kantor", "Karyawan Perawatan")
    is_spsi_member?: boolean;  // SPSI membership status derived from pot_spsi > 0
    created_at?: Date;
}

export interface HistoryTaskreg {
    id?: number;
    history_id: string;
    original_master_id?: number;
    reg_no?: string;
    reg_date?: Date;
    emp_code: string;
    gang_code?: string;
    division_code?: string;
    original_line_id?: number;
    line_no?: number;
    trx_date: Date;
    task_code?: string;
    task_desc?: string;
    hours: number;
    ot: boolean;
    rate?: number;
    amount: number;
    tapping_type?: string;
    is_cuti_tahunan: boolean;
    is_cuti_sakit: boolean;
    is_cuti_minggu: boolean;
    is_cuti_nasional: boolean;
    is_hari_kerja: boolean;
    is_lembur: boolean;
    period_month: number;
    period_year: number;
    source_table: string;
    created_at?: Date;
}

export interface HistoryAdtrans {
    id?: number;
    history_id: string;
    original_master_id?: number;
    doc_no?: string;
    doc_date: Date;
    doc_desc?: string;
    emp_code: string;
    original_line_id?: number;
    task_code?: string;
    task_desc?: string;
    amount: number;
    uom?: string;
    category: string;
    sub_category?: string;
    is_dynamic: boolean;
    is_premi_pph: boolean;
    is_koreksi: boolean;
    is_potongan: boolean;
    is_premi: boolean;
    period_month: number;
    period_year: number;
    source_table: string;
    created_at?: Date;
}

export interface HistoryGangMember {
    id?: number;
    history_id: string;
    gang_code: string;
    gang_description?: string;
    division_code: string;
    loc_code?: string;
    emp_code: string;
    emp_name?: string;
    nik?: string;
    jabatan?: string;
    period_month: number;
    period_year: number;
    join_date?: Date;
    is_active: boolean;
    source_table: string;
    created_at?: Date;
}

export interface HistoryMetadata {
    id?: number;
    history_id: string;
    operation: 'CREATE' | 'DELETE' | 'UPDATE' | 'LOCK' | 'UNLOCK';
    entity_type: 'BATCH' | 'ROW' | 'DIVISION' | 'GANG';
    period_month: number;
    period_year: number;
    division_code?: string;
    gang_code?: string;
    description: string;
    old_values?: string;
    new_values?: string;
    record_count?: number;
    status: 'SUCCESS' | 'FAILED' | 'PENDING';
    error_message?: string;
    performed_by: string;
    ip_address?: string;
    user_agent?: string;
    created_at?: Date;
}

export interface HistoryHrEmployee {
    id?: number;
    history_id: string;
    period_month: number;
    period_year: number;
    nik: string;
    new_nik?: string;
    pajak_npwp?: string;
    res_address?: string;
    emp_code: string;
    emp_name: string;
    company_code?: string;
    division_code?: string;
    loc_code?: string;
    gang_code?: string;
    job_code?: string;
    position?: string;
    jabatan?: string;  // Job title from employee_estate
    is_spsi_member?: boolean;  // SPSI membership status derived from pot_spsi > 0
    join_date?: string | Date;
    terminate_date?: string | Date;
    status?: string;
    employee_type?: string;
    gender?: string;
    religion?: string;
    birth_place?: string;
    birth_date?: string | Date;
    marital_status?: string;
    ptkp_beras?: string;
    ptkp_pajak?: string;
    upah_dasar: number;
    total_hk: number;
    source_table: string;
    created_at?: Date;
}

export interface HistoryHrGang {
    id?: number;
    history_id: string;
    period_month: number;
    period_year: number;
    division_code?: string;
    loc_code?: string;
    gang_code: string;
    gang_description?: string;
    mandor_code?: string;
    mandor_name?: string;
    total_members: number;
    is_active: boolean;
    source_table: string;
    created_at?: Date;
}
