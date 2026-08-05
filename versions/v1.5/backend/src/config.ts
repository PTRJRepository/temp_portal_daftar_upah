import { env } from "bun";
import { config } from "dotenv";
import { join } from "path";

// Load .env file FIRST before any other code
const envPath = join(import.meta.dir, "../.env");
const dotenvResult = config({ path: envPath });

if (dotenvResult.error) {
    console.error("[Config] Failed to load .env file:", dotenvResult.error.message);
}

export type RunMode = "dev" | "prod";

export class Config {
    // Server Configuration
    public static readonly PORT: number = parseInt(env.PORT || "8002", 10);
    public static readonly HOST: string = env.HOST || "0.0.0.0";
    public static readonly RUN_MODE: RunMode = (env.RUN_MODE as RunMode) || "dev";

    // Proxy Configuration
    public static readonly USE_PROXY: boolean = (env.USE_PROXY === "true");
    public static readonly PROXY_STRIP_PREFIX: string = env.PROXY_STRIP_PREFIX || "/backend/upah";

    // Auth Mode: If proxy is true, default to 'external'. Else 'internal'.
    public static readonly AUTH_MODE: "internal" | "external" =
        (env.AUTH_MODE as "internal" | "external") ||
        (Config.USE_PROXY ? "external" : "internal");

    // Database Configuration (SQL Gateway)
    public static readonly DB_API_URL: string = env.DB_API_URL || "http://localhost:8001";
    public static readonly DB_API_KEY: string = env.DB_API_KEY || "";
    public static readonly DB_PROFILE: string = env.DB_PROFILE || "SERVER_PROFILE_1";
    public static readonly DEFAULT_DATABASE: string = env.DB_DATABASE || "db_ptrj";

    // Database Timeouts
    public static readonly DB_CONN_TIMEOUT: number = parseInt(env.DB_CONN_TIMEOUT || "60");
    public static readonly DB_QUERY_TIMEOUT: number = parseInt(env.DB_QUERY_TIMEOUT || "60");  // Increased from 30 to 60
    public static readonly DB_QUERY_RETRIES: number = parseInt(env.DB_QUERY_RETRIES || "3");
    
    // Seeder-specific timeout (longer for heavy operations)
    public static readonly DB_SEEDER_TIMEOUT: number = parseInt(env.DB_SEEDER_TIMEOUT || "180");

    // Extended Database (for aggregation history)
    public static readonly DB_EXTEND_DATABASE: string = env.DB_EXTEND_DATABASE || "extend_db_ptrj";
    public static readonly DB_EXTEND_PROFILE: string = env.DB_EXTEND_PROFILE || "SERVER_PROFILE_1";

    // Staging Database (for FFB scanner data)
    public static readonly DB_STAGING_DATABASE: string = env.DB_STAGING_DATABASE || "staging_PTRJ_iFES_Plantware";
    public static readonly DB_STAGING_PROFILE: string = env.DB_STAGING_PROFILE || "SERVER_PROFILE_2";

    // Extended Transaction Database (for history detail - Taskreg, ADTrans)
    public static readonly DB_EXTEND_TRANS_DATABASE: string = env.DB_EXTEND_TRANS_DATABASE || "extend_db_ptrj_transaksi";

    // VenusHR14 Database (for Mill PKS data)
    public static readonly DB_VENUS_PROFILE: string = env.DB_VENUS_PROFILE || "SERVER_PROFILE_3";
    public static readonly DB_VENUS_DATABASE: string = env.DB_VENUS_DATABASE || "VenusHR14";

    // Mill Database (for WM_TICKET / FFB weight data)
    public static readonly DB_MILL_PROFILE: string = env.DB_MILL_PROFILE || "SERVER_PROFILE_3";
    public static readonly DB_MILL_DATABASE: string = env.DB_MILL_DATABASE || "db_ptrj_mill";

    // Authentication Configuration
    public static readonly JWT_SECRET: string = env.JWT_SECRET || "default_debug_secret";
    public static readonly ACCESS_TOKEN_EXPIRE_MINUTES: number = parseInt(env.ACCESS_TOKEN_EXPIRE_MINUTES || "60");
    public static readonly DEV_BYPASS_TOKEN: string = env.DEV_BYPASS_TOKEN || "";
    public static readonly API_KEY_BYPASS: string = env.API_KEY_BYPASS || "";
    public static readonly SYSTEM_TOKEN: string = "system-internal-secret-token";

    // External Auth Keys (if needed)
    public static readonly PUBLIC_KEY_PATH: string = "keys/public.pem";
    public static readonly PRIVATE_KEY_PATH: string = "keys/private.pem";

    // Payroll Constants
    public static readonly UPAH_MINIMUM_DASAR: number = parseFloat(env.CONSTANTS_UPAH_MINIMUM_DASAR || "3876600");
    public static readonly BPJS_GAJI_POKOK_MIN: number = parseFloat(env.CONSTANTS_POTONGAN_BPJS_GAJI_POKOK_MIN || "3876600");
    public static readonly IURAN_SPSI: number = parseFloat(env.CONSTANTS_POTONGAN_BPJS_IURAN_SPSI || "4000");

    // ============================================================
    // PAYRATE CONFIGURATION BY YEAR
    // Cara menentukan tahun berjalan:
    // 1. Query MAX(TRX_DATE) dari PR_TASKREGLN
    // 2. Extract YEAR dari tanggal tersebut
    // 3. Gunakan getUpahDasar(year) untuk mendapatkan upah dasar yang sesuai
    // ============================================================

    // Payrate per tahun (dari .env)
    public static readonly UPAH_DASAR_2024: number = parseFloat(env.UPAH_DASAR_2024 || "125000");
    public static readonly UPAH_DASAR_2025: number = parseFloat(env.UPAH_DASAR_2025 || "129220");
    public static readonly UPAH_DASAR_2026: number = parseFloat(env.UPAH_DASAR_2026 || "129220");

    // Default upah dasar (fallback)
    public static readonly UPAH_DASAR: number = parseFloat(env.UPAH_DASAR || "129220");

    // Tunjangan rates per tahun
    public static readonly BERAS_RATE_2025: number = parseFloat(env.BERAS_RATE_2025 || "35000");
    public static readonly BERAS_RATE_2026: number = parseFloat(env.BERAS_RATE_2026 || "35000");

    public static readonly JABATAN_RATE_2025: number = parseFloat(env.JABATAN_RATE_2025 || "150000");
    public static readonly JABATAN_RATE_2026: number = parseFloat(env.JABATAN_RATE_2026 || "150000");

    public static readonly MASA_KERJA_RATE_2025: number = parseFloat(env.MASA_KERJA_RATE_2025 || "25000");
    public static readonly MASA_KERJA_RATE_2026: number = parseFloat(env.MASA_KERJA_RATE_2026 || "25000");

    /**
     * Get Upah Dasar based on year
     * @param year - Year to get payrate for
     * @returns Upah Dasar for the specified year
     */
    public static getUpahDasar(year: number): number {
        switch (year) {
            case 2024:
                return this.UPAH_DASAR_2024;
            case 2025:
                return this.UPAH_DASAR_2025;
            case 2026:
                return this.UPAH_DASAR_2026;
            default:
                // For future years, return the latest known rate
                if (year > 2026) {
                    return this.UPAH_DASAR_2026;
                }
                // For years before 2024, return the oldest known rate
                return this.UPAH_DASAR_2024;
        }
    }

    /**
     * Get Beras Rate based on year
     * @param year - Year to get rate for
     * @returns Beras rate for the specified year
     */
    public static getBerasRate(year: number): number {
        return year >= 2026 ? this.BERAS_RATE_2026 : this.BERAS_RATE_2025;
    }

    /**
     * Get Jabatan Rate based on year
     * @param year - Year to get rate for
     * @returns Jabatan rate for the specified year
     */
    public static getJabatanRate(year: number): number {
        return year >= 2026 ? this.JABATAN_RATE_2026 : this.JABATAN_RATE_2025;
    }

    /**
     * Get Masa Kerja Rate based on year
     * @param year - Year to get rate for
     * @returns Masa Kerja rate for the specified year
     */
    public static getMasaKerjaRate(year: number): number {
        return year >= 2026 ? this.MASA_KERJA_RATE_2026 : this.MASA_KERJA_RATE_2025;
    }

    // Test Mode Configuration
    public static readonly TEST_MODE: boolean = (env.TEST_MODE === "true");
    public static readonly DEFAULT_GANG: string = env.DEFAULT_GANG || "H1H";
    public static readonly DEFAULT_MONTH: number = parseInt(env.DEFAULT_MONTH || "12");
    public static readonly DEFAULT_YEAR: number = parseInt(env.DEFAULT_YEAR || "2025");

    // Logging Configuration
    public static readonly LOG_LEVEL: string = env.LOG_LEVEL || "INFO";
    public static readonly LOG_TO_FILE: boolean = (env.LOG_TO_FILE !== "false");
    public static readonly LOG_FILE_PATH: string = env.LOG_FILE_PATH || join(import.meta.dir, "../logs/error.log");
    public static readonly CLEAR_LOGS_ON_STARTUP: boolean = (env.CLEAR_LOGS_ON_STARTUP !== "false");

    // IT Solution Absensi API (Face Verification)
    // Base URL: http://10.0.0.110:5176
    // Provides face verification attendance data per employee per day
    public static readonly ABSENSI_API_URL: string = env.ABSENSI_API_URL || "http://10.0.0.110:5176";
    public static readonly ABSENSI_API_KEY: string = env.ABSENSI_API_KEY || "2a993486e7a448474de66bfaea4adba7a99784defbcaba420e7f906176b94df6";

    /**
     * Division code mapping: payroll division code → IT Solution API division code
     * Payroll uses LocCode from HR_GANG (P1A, AB1, ARC, IJL, DME, ARA, PGE)
     * IT Solution API uses: PG1A, PG1B, PG2A, PG2B, DME, ARA, ARB1, ARB2, AREC, IJL, INFRA, STF-OFFICE, SECURITY
     *
     * Real LocCodes found in HR_GANG: P1A, P1B, P2A, P2B, AB1, AB2, ARA, ARC, DME, IJL, PGE
     */
    public static readonly DIVISION_CODE_MAP: Record<string, string> = {
        // P divisions
        "PG1A": "PG1A",
        "P1A": "PG1A",
        "PG1B": "PG1B",
        "P1B": "PG1B",
        "PG2A": "PG2A",
        "P2A": "PG2A",
        "PG2B": "PG2B",
        "P2B": "PG2B",
        // AF/AB divisions (HR_GANG uses AB1, AB2)
        "ARB1": "ARB1",
        "AB1": "ARB1",
        "ARB2": "ARB2",
        "AB2": "ARB2",
        // ARC (HR_GANG uses ARC, IT Solution uses AREC)
        "AREC": "AREC",
        "ARC": "AREC",
        // Others (direct mapping - same in both systems)
        "DME": "DME",
        "ARA": "ARA",
        "IJL": "IJL",
        "PGE": "PGE",
        // Aliases that may appear in payroll system
        "STF-OFFICE": "STF-OFFICE",
        "SECURITY": "SECURITY",
        "INFRA": "INFRA",
    };

    // Helper Methods
    public static get isDev(): boolean {
        return this.RUN_MODE === "dev";
    }

    public static get isProd(): boolean {
        return this.RUN_MODE === "prod";
    }

    public static get isTestMode(): boolean {
        return this.TEST_MODE || this.isDev;
    }
}