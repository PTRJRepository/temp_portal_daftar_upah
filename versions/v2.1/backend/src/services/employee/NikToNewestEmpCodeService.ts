/**
 * NikToNewestEmpCodeService
 *
 * Services terpusat untuk resolve NIK (angka saja) → EmpCode terbaru (huruf prefix).
 *
 * Aturan:
 * - NIK = angka semua, contoh "1902016804750005"
 * - EmpCode = huruf prefix + angka, contoh "A0713", "C0533"
 *
 * Resolve priority (dari DuplicateNikMitigationService):
 * 1. EmpCode terbaru (C-prefix > B-prefix > A-prefix) berdasarkan alphabetical order
 * 2. Jika ada preferredGang, coba cocokkan dulu
 * 3. Fallback ke emp_code dengan status Active
 *
 * Semua services lain harus gunakan service ini untuk NIK → EmpCode resolution.
 */

import { duplicateNikMitigationService, NikResolutionResult } from "../DuplicateNikMitigationService";

export interface NikToEmpCodeEntry {
    nik: string;
    resolved_emp_code: string | null;
    is_valid_nik: boolean;
    is_valid_emp_code: boolean;
    resolution_method: NikResolutionResult["resolution_method"];
    confidence: NikResolutionResult["confidence"];
    all_emp_codes: string[];
    notes?: string;
}

export class NikToNewestEmpCodeService {
    private static instance: NikToNewestEmpCodeService;

    public static getInstance(): NikToNewestEmpCodeService {
        if (!NikToNewestEmpCodeService.instance) {
            NikToNewestEmpCodeService.instance = new NikToNewestEmpCodeService();
        }
        return NikToNewestEmpCodeService.instance;
    }

    /**
     * Validasi apakah string adalah NIK valid (angka semua)
     */
    isValidNik(nik: string): boolean {
        if (!nik || typeof nik !== "string") return false;
        return /^\d+$/.test(nik.trim());
    }

    /**
     * Validasi apakah string adalah EmpCode valid (huruf prefix + angka)
     * Contoh: A0713, C0533, B0111
     */
    isValidEmpCode(empCode: string): boolean {
        if (!empCode || typeof empCode !== "string") return false;
        return /^[A-Za-z]\d+$/.test(empCode.trim());
    }

    /**
     * Resolve satu NIK ke emp_code terbaru.
     *
     * @param nik        - NIK target (angka semua)
     * @param preferredGang  - Gang code opsional untuk preferensi resolusi
     * @returns NikToEmpCodeEntry dengan resolved_emp_code terbaru
     */
    async resolve(nik: string, preferredGang?: string): Promise<NikToEmpCodeEntry> {
        const trimmedNik = (nik || "").trim().toUpperCase();
        const isValidNik = this.isValidNik(trimmedNik);

        if (!isValidNik) {
            return {
                nik: trimmedNik,
                resolved_emp_code: null,
                is_valid_nik: false,
                is_valid_emp_code: false,
                resolution_method: "single",
                confidence: "low",
                all_emp_codes: [],
                notes: "NIK tidak valid — harus angka semua"
            };
        }

        try {
            const result = await duplicateNikMitigationService.resolveEmpCode(trimmedNik, {
                preferredGang
            });

            const isValidEmpCode = result.resolved_emp_code
                ? this.isValidEmpCode(result.resolved_emp_code)
                : false;

            return {
                nik: trimmedNik,
                resolved_emp_code: result.resolved_emp_code,
                is_valid_nik: true,
                is_valid_emp_code: isValidEmpCode,
                resolution_method: result.resolution_method,
                confidence: result.confidence,
                all_emp_codes: result.all_emp_codes,
                notes: result.notes
            };
        } catch (error: any) {
            return {
                nik: trimmedNik,
                resolved_emp_code: null,
                is_valid_nik: true,
                is_valid_emp_code: false,
                resolution_method: "single",
                confidence: "low",
                all_emp_codes: [],
                notes: `Error: ${error?.message || "unknown"}`
            };
        }
    }

    /**
     * Batch resolve banyak NIK ke emp_code terbaru.
     * Lebih efisien daripada memanggil resolve() satu-satu.
     *
     * @param niks           - Array NIK
     * @param preferredGangs - Map opsional NIK → preferred gang code
     * @returns Map NIK → NikToEmpCodeEntry
     */
    async resolveBatch(
        niks: string[],
        preferredGangs?: Map<string, string>
    ): Promise<Map<string, NikToEmpCodeEntry>> {
        const results = new Map<string, NikToEmpCodeEntry>();

        // Pisahkan valid dan tidak valid upfront
        const validNiks: string[] = [];
        for (const nik of niks) {
            const trimmed = (nik || "").trim().toUpperCase();
            if (!trimmed) continue;

            if (!this.isValidNik(trimmed)) {
                results.set(trimmed, {
                    nik: trimmed,
                    resolved_emp_code: null,
                    is_valid_nik: false,
                    is_valid_emp_code: false,
                    resolution_method: "single",
                    confidence: "low",
                    all_emp_codes: [],
                    notes: "NIK tidak valid — harus angka semua"
                });
            } else {
                validNiks.push(trimmed);
            }
        }

        if (validNiks.length === 0) return results;

        // Bulk resolve via DuplicateNikMitigationService
        const resolutions = await duplicateNikMitigationService.bulkResolveEmpCodes(
            validNiks,
            preferredGangs
        );

        for (const nik of validNiks) {
            const result = resolutions.get(nik);
            if (!result) {
                results.set(nik, {
                    nik,
                    resolved_emp_code: null,
                    is_valid_nik: true,
                    is_valid_emp_code: false,
                    resolution_method: "single",
                    confidence: "low",
                    all_emp_codes: [],
                    notes: "NIK not found in HR_EMPLOYEE"
                });
                continue;
            }

            const isValidEmpCode = result.resolved_emp_code
                ? this.isValidEmpCode(result.resolved_emp_code)
                : false;

            results.set(nik, {
                nik,
                resolved_emp_code: result.resolved_emp_code,
                is_valid_nik: true,
                is_valid_emp_code: isValidEmpCode,
                resolution_method: result.resolution_method,
                confidence: result.confidence,
                all_emp_codes: result.all_emp_codes,
                notes: result.notes
            });
        }

        return results;
    }

    /**
     * Get hanya emp_code terbaru (paling sering dibutuhkan).
     * Convenience method — equivalent dengan resolve(nik).resolved_emp_code
     */
    async getNewestEmpCode(nik: string, preferredGang?: string): Promise<string | null> {
        const entry = await this.resolve(nik, preferredGang);
        return entry?.resolved_emp_code;
    }

    /**
     * Get semua emp_code yang pernah digunakan oleh satu NIK.
     */
    async getAllEmpCodes(nik: string): Promise<string[]> {
        const entry = await this.resolve(nik);
        return entry?.all_emp_codes ?? [];
    }
}

export const nikToNewestEmpCodeService = NikToNewestEmpCodeService.getInstance();
