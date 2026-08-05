import { PayrollComponentMetadata } from "./PayrollComponent";

export interface EmployeeRow {
    emp_code: string;
    emp_name: string;
    gender: string;
    loc_code: string;
    gang_code: string;
    pay_rate: number;
    beras_rate: number;
    join_date: string | null;
    actual_nik?: string;
    /** 
     * Jabatan = ROLE TEXT (e.g. "Mandor", "Kerani", "Karyawan Panen")
     * Source: extend_db_ptrj (employee_estate OR history_gang_member)
     * NOT from HR_GANGLN - that table only has gang membership.
     */
    jabatan?: string;
    pot_premi_pph?: number;
    res_address?: string;
    // Allow dynamic properties added during progressive extraction
    [key: string]: any;
}

export interface CutiData {
    cuti_tahunan: number;
    cuti_sakit_haid: number;
    cuti_minggu: number;
    cuti_nasional: number;
}

export interface LemburData {
    jam: number;
    jumlah: number;
}

export interface LemburRecord {
    trx_date: string;
    task_code: string;
    task_desc: string;
    day_type: string;
    hours: number;
    rate: number;
    amount: number;
    record_count?: number; // Number of transactions grouped (for grouped task breakdown)
    meta?: PayrollComponentMetadata;
}

export interface LemburDataWithDetails extends LemburData {
    records: LemburRecord[];
}

export interface ShortageDetail {
    date: string;
    day_name: string;
    actual_hours: number;
    target_hours: number;
    shortage_hours: number;
}

export interface ExcessDetail {
    date: string;
    day_name: string;
    actual_hours: number;
    target_hours: number;
    excess_hours: number;
}

export interface PayrollRow {
    emp_code?: string;
    nik: string;
    new_nik?: string; // New: Explicit KTP NIK
    nama: string;
    jabatan_estate?: string;
    jenis_kelamin: string;
    status_ptkp: string;
    kategori_ter: string;
    loc_code: string;
    gang_code: string;
    alamat: string;
    // [JOIN_DATE] Latest join_date from history_hr_employee (MAX id per employee)
    join_date?: string | null;
    tanggal_masuk?: string | null; // Alias for Excel export compatibility
    // Upah Dasar: Base wage rate from HR_PAYROLL.PayRate (daily rate)
    // = Gaji Pokok per Hari (rate, bukan jumlah). Sumber: HR_PAYROLL.PayRate (via GajiPokokService)
    upah_dasar: number;
    jumlah_hk: number;
    total_jam_kerja: number;
    has_shortage?: boolean;
    shortage_details?: ShortageDetail[];
    shortage_total_hours?: number;
    has_excess?: boolean;
    excess_details?: ExcessDetail[];
    excess_total_hours?: number;
    hk_warning?: string; // 'kurang_jam' | 'salah_scan' | null
    hari_kerja: number;
    gaji_pokok: number;
    kehadiran: number;
    cuti_tahunan_hari: number;
    cuti_sakit_haid_hari: number;
    cuti_minggu_hari: number;
    cuti_nasional_hari: number;
    // Task/Job Code fields
    task_code?: string;
    task_desc?: string;
    task_type?: string;
    task_uom?: string;
    beras_rate: number;
    beras_jumlah: number;
    /** Tunjangan jabatan RATE (uang/hari) from PR_ADTRANSLN where DocDesc LIKE '%JABATAN%' */
    jabatan_rate: number;
    /** Tunjangan jabatan JUMLAH (total uang) from PR_ADTRANSLN - NOT role text! */
    jabatan_jumlah: number;
    masa_kerja_tahun: number;
    masa_kerja_rate: number;
    masa_kerja_jumlah: number;
    lembur_jam: number;
    lembur_rate: number;
    lembur_jumlah: number;
    lembur_records?: Array<{
        trx_date: string;
        task_code: string;
        task_desc: string;
        day_type: string;
        hours: number;
        rate: number;
        amount: number;       // Calculated amount (from tier-based rate)
        raw_amount: number;   // Amount from PR_TASKREGLN table
        raw_rate: number;     // Rate from PR_TASKREGLN table
        meta?: PayrollComponentMetadata;
    }>;
    // Harvest / Bunches fields (for harvest gangs ending with "H")
    bunches_total?: number;
    bunches_ripe?: number;
    bunches_unripe?: number;
    bunches_underripe?: number;
    bunches_overripe?: number;
    bunches_rotten?: number;
    bunches_abnormal?: number;
    loose_fruit?: number;
    bunches_transactions?: number;
    total_tunjangan: number;
    premi_brondol: number;
    // [PHASE 2.5] Brondol dual source breakdown
    premi_brondol_loosefruit: number;  // From PR_LOOSEFRUIT
    premi_brondol_adtrans: number;     // From PR_ADTRANS (DocDesc containing BRONDOL)
    premi_brondol_total: number;        // Combined total (loosefruit + adtrans)
    premi_pph: number; // PREMI PPH - ADDED (+) to upah_bersih, not subtracted
    total_premi: number;
    premi: Record<string, number>;
    premi_details?: any[];
    jumlah_upah_kotor: number;
    // Caruman ASTEK
    pot_astek_pekerja: number;
    pot_astek_majikan: number;
    pot_astek_jumlah: number;
    // BPJS Kesehatan
    pot_bpjs_kesehatan_pekerja: number;
    pot_bpjs_kesehatan_majikan: number;
    pot_bpjs_kesehatan_jumlah: number;
    // BPJS Pensiun
    pot_bpjs_pensiun_pekerja: number;
    pot_bpjs_pensiun_majikan: number;
    pot_bpjs_pensiun_jumlah: number;
    // New fields for Penggajian Group
    gaji_pokok_ideal: number;
    gaji_pokok_aktual: number;
    koreksi_hk: number;
    // Other deductions
    pot_spsi: number;
    pot_pph21: number;
    pot_koreksi: number;
    premi_koreksi: number;
    potongan_upah_kotor_total: number;
    potongan_upah_kotor_details?: {
        koreksi: number;
        total: number;
    };
    // Tax related
    gaji_pokok_bulanan?: number;
    astek_084?: number;
    bpjs_kesehatan_majikan_4_pct?: number;
    penghasilan_bruto?: number;
    upah_kotor_pajak?: number;
    tarif_pajak_ter?: number;
    pph21_ter?: number;
    taxable_pendapatan_lainnya?: number;
    taxable_pendapatan_thr?: number;
    taxable_pendapatan_bonus?: number;
    taxable_pendapatan_custom?: number;
    upah_bersih: number;
    value_sync_frame?: Record<string, "red" | "green">;
    other_incomes?: any[];
    pendapatan_thr?: number;
    pendapatan_bonus?: number;
    pendapatan_custom?: number;
    pendapatan_lainnya?: number;
    total_pendapatan_lainnya?: number;
    [key: string]: any;
}
