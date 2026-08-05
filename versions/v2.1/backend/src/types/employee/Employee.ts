export interface Employee {
    nik: string;          // Plantware internal EmpCode (e.g., 'A0023')
    actual_nik: string;   // KTP NIK from NewICNo
    nama: string;
    jenis_kelamin: 'L' | 'P';
    loc_code: string;
    gang_code: string;
    gang_desc?: string;
    phone?: string;
    upah_dasar?: number;
    beras_rate?: number;
    join_date?: string | null;
    religion?: string;
    status?: string;
    employee_type?: string;
    birth_date?: string;
    jabatan?: string;
    res_address?: string;
    [key: string]: any;
}
