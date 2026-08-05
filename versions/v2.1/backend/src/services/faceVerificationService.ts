/**
 * Face Verification Service
 *
 * Mengambil data verifikasi muka dari IT Solution Absensi API.
 * API: http://10.0.0.110:5176
 *
 * Data source: ZKTeco face recognition machines yang sudah di-sync
 * oleh project Absensi_Muka ke tabel absen_import di extend_db_ptrj.
 *
 * Endpoint: GET /api/attendance-by-division?division=XXX&month=M&year=Y&mode=hk
 */

import { Config } from "../config";

export interface FaceVerificationDay {
    day: number;
    hasWork: boolean;         // true = face verified (has scan record)
    isSunday: boolean;
    isHoliday: boolean;
    holidayDesc?: string;
    isCuti: boolean;
    isSakit: boolean;
    taskCode?: string;
    otHours: number;
    attendanceDate?: string;
}

export interface EmployeeFaceVerification {
    empCode: string;
    empName: string;
    gangCode: string;
    daily: Record<number, FaceVerificationDay>;
}

interface ApiDayData {
    hasWork?: boolean;
    isSunday?: boolean;
    isHoliday?: boolean;
    holidayDesc?: string;
    isCuti?: boolean;
    isSakit?: boolean;
    taskCode?: string;
    otHours?: number;
    date?: string;
}

interface ApiEmployeeRecord {
    empCode: string;
    empName?: string;
    gangCode?: string;
    day_1?: ApiDayData;
    day_2?: ApiDayData;
    day_3?: ApiDayData;
    day_4?: ApiDayData;
    day_5?: ApiDayData;
    day_6?: ApiDayData;
    day_7?: ApiDayData;
    day_8?: ApiDayData;
    day_9?: ApiDayData;
    day_10?: ApiDayData;
    day_11?: ApiDayData;
    day_12?: ApiDayData;
    day_13?: ApiDayData;
    day_14?: ApiDayData;
    day_15?: ApiDayData;
    day_16?: ApiDayData;
    day_17?: ApiDayData;
    day_18?: ApiDayData;
    day_19?: ApiDayData;
    day_20?: ApiDayData;
    day_21?: ApiDayData;
    day_22?: ApiDayData;
    day_23?: ApiDayData;
    day_24?: ApiDayData;
    day_25?: ApiDayData;
    day_26?: ApiDayData;
    day_27?: ApiDayData;
    day_28?: ApiDayData;
    day_29?: ApiDayData;
    day_30?: ApiDayData;
    day_31?: ApiDayData;
}

interface ApiResponse {
    success: boolean;
    data?: ApiEmployeeRecord[];
    message?: string;
}

export class FaceVerificationService {
    private static instance: FaceVerificationService;
    private baseUrl: string;
    private apiKey: string;

    private constructor() {
        this.baseUrl = Config.ABSENSI_API_URL;
        this.apiKey = Config.ABSENSI_API_KEY;
    }

    public static getInstance(): FaceVerificationService {
        if (!FaceVerificationService.instance) {
            FaceVerificationService.instance = new FaceVerificationService();
        }
        return FaceVerificationService.instance;
    }

    private async apiRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
        const url = new URL(`${this.baseUrl}${endpoint}`);
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });

        const response = await fetch(url.toString(), {
            headers: {
                "x-api-key": this.apiKey,
            },
            signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        if (!response.ok) {
            throw new Error(
                `Face Verification API Error: ${response.status} ${response.statusText} - ${url.toString()}`
            );
        }

        return response.json() as Promise<T>;
    }

    /**
     * Ambil data face verification dari IT Solution API
     * Mengkonversi payroll division codes ke API division codes
     *
     * @param payrollDivisionCodes - Array of payroll division codes (e.g., ['P1A', 'AB1'])
     * @param month - Bulan (1-12)
     * @param year - Tahun
     * @returns Map dari empCode ke data face verification per hari
     */
    public async getFaceVerification(
        payrollDivisionCodes: string[],
        month: number,
        year: number
    ): Promise<Map<string, EmployeeFaceVerification>> {
        const result = new Map<string, EmployeeFaceVerification>();

        if (payrollDivisionCodes.length === 0) {
            return result;
        }

        // Convert payroll division codes to API division codes
        const apiDivisions = new Set<string>();
        for (const code of payrollDivisionCodes) {
            const apiCode = Config.DIVISION_CODE_MAP[code] || code;
            apiDivisions.add(apiCode);
        }

        console.log(
            `[FaceVerificationService] Fetching face verification for divisions:`,
            [...apiDivisions],
            `period: ${month}/${year}`
        );

        // Fetch data per division
        for (const apiDivision of apiDivisions) {
            try {
                const response = await this.apiRequest<ApiResponse>("/api/attendance-by-division", {
                    division: apiDivision,
                    month: month.toString(),
                    year: year.toString(),
                    mode: "hk",
                });

                if (response.success && Array.isArray(response.data)) {
                    let count = 0;
                    for (const emp of response.data) {
                        const daily: Record<number, FaceVerificationDay> = {};

                        for (let d = 1; d <= 31; d++) {
                            const dayKey = `day_${d}` as keyof ApiEmployeeRecord;
                            const dayData = emp[dayKey] as ApiDayData | undefined;
                            if (dayData) {
                                daily[d] = {
                                    day: d,
                                    hasWork: dayData.hasWork || false,
                                    isSunday: dayData.isSunday || false,
                                    isHoliday: dayData.isHoliday || false,
                                    holidayDesc: dayData.holidayDesc,
                                    isCuti: dayData.isCuti || false,
                                    isSakit: dayData.isSakit || false,
                                    taskCode: dayData.taskCode,
                                    otHours: dayData.otHours || 0,
                                    attendanceDate: dayData.date,
                                };
                            }
                        }

                        const empKey = emp.empCode.toUpperCase().trim();
                        result.set(empKey, {
                            empCode: emp.empCode,
                            empName: emp.empName || "",
                            gangCode: emp.gangCode || "",
                            daily,
                        });
                        count++;
                    }
                    console.log(
                        `[FaceVerificationService] Fetched ${count} employees from ${apiDivision}`
                    );
                } else {
                    console.warn(
                        `[FaceVerificationService] No data or failed response for ${apiDivision}:`,
                        response.message
                    );
                }
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                console.warn(
                    `[FaceVerificationService] Failed to fetch ${apiDivision}:`,
                    errMsg
                );
            }
        }

        console.log(
            `[FaceVerificationService] Total employees with face verification data:`,
            result.size
        );
        return result;
    }

    /**
     * Ambil data face verification untuk satu divisi saja
     * Convenience method untuk penggunaan yang lebih sederhana
     */
    public async getFaceVerificationByDivision(
        divisionCode: string,
        month: number,
        year: number
    ): Promise<Map<string, EmployeeFaceVerification>> {
        return this.getFaceVerification([divisionCode], month, year);
    }
}

export const faceVerificationService = FaceVerificationService.getInstance();
