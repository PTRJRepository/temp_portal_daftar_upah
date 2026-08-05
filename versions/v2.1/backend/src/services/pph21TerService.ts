import * as fs from 'fs';
import * as path from 'path';

/**
 * PPH21 TER (Tarif Efektif Rata-rata) Calculation Service
 * Dynamically loaded from rule_TER_pajak.json
 */

interface TerLayer {
    no: number;
    min_bruto: number;
    max_bruto: number | null; // null represents Infinity
    tarif: number; // Percentage (e.g. 0.25 for 0.25%)
}

interface TerCategoryData {
    kategori: string;
    ptkp_status: string[];
    layers: TerLayer[];
}

interface TerRules {
    tarif_pph21_ter: {
        ter_a: TerCategoryData;
        ter_b: TerCategoryData;
        ter_c: TerCategoryData;
        [key: string]: TerCategoryData; // Allow index access
    };
}

export interface Pph21TerResult {
    ptkp_status: string;
    ter_category: string;
    gross_income: number;
    rate: number;          // Decimal format (0.05)
    rate_percent: number;  // Percentage format (5.00)
    tax_amount: number;
}

class Pph21TerService {
    private static instance: Pph21TerService;
    private rules: TerRules | null = null;
    private ptkpMap: Record<string, string> = {}; // Map PTKP -> TER Category (e.g., 'TK/0' -> 'TER A')

    private constructor() {
        this.loadRules();
    }

    public static getInstance(): Pph21TerService {
        if (!Pph21TerService.instance) {
            Pph21TerService.instance = new Pph21TerService();
        }
        return Pph21TerService.instance;
    }

    private loadRules() {
        try {
            // Try multiple possible paths for the JSON file
            const possiblePaths = [
                // Path relative to backend directory
                path.resolve(process.cwd(), 'Additional_services/hitung_pajak/rule_TER_pajak.json'),
                // Path from refactor_production root (if running from backend)
                path.resolve(process.cwd(), '../Additional_services/hitung_pajak/rule_TER_pajak.json'),
                // Absolute path as fallback using Node's __dirname
                path.resolve(__dirname, '../../Additional_services/hitung_pajak/rule_TER_pajak.json'),
                // Absolute path using Bun's import.meta.dir (which correctly points to refactor_production/Additional_services)
                path.resolve(import.meta.dir, '../../../Additional_services/hitung_pajak/rule_TER_pajak.json'),
            ];

            let jsonPath = '';
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    jsonPath = p;
                    break;
                }
            }

            if (!jsonPath) {
                console.error(`[Pph21TerService] Error: Rules file not found. Tried paths:`, possiblePaths);
                throw new Error(`Rules file not found. Tried: ${possiblePaths.join(', ')}`);
            }

            const rawData = fs.readFileSync(jsonPath, 'utf-8');
            this.rules = JSON.parse(rawData);
            this.buildPtkpMap();
        } catch (error) {
            console.error(`[Pph21TerService] Failed to load rules:`, error);
            // Don't crash immediately, but subsequent calls will fail or need fallback
            // For now, we'll throw to ensure visibility of the issue
            throw error;
        }
    }

    private buildPtkpMap() {
        if (!this.rules) return;

        const cats = this.rules.tarif_pph21_ter;
        for (const key in cats) {
            const catData = cats[key];
            const categoryName = catData.kategori; // e.g., "TER A"
            for (const ptkp of catData.ptkp_status) {
                this.ptkpMap[ptkp.toUpperCase()] = key; // Map "TK/0" -> "ter_a" (key in json)
            }
        }
    }

    /**
     * Determine TER Category key (ter_a, ter_b, ter_c) based on PTKP
     */
    public getTerCategoryKey(ptkpStatus: string): string {
        const normalized = (ptkpStatus || '').toUpperCase().trim();
        const key = this.ptkpMap[normalized];
        if (!key) {
            // Default fallback logic if not found in JSON map
            if (['TK/0', 'TK/1', 'K/0'].includes(normalized)) return 'ter_a';
            if (['K/3'].includes(normalized)) return 'ter_c';
            return 'ter_b'; // Default
        }
        return key;
    }

    /**
     * Get TER Rate based on category and gross income
     * Returns rate as percentage (e.g., 0.25 for 0.25%, 5.0 for 5%)
     */
    public getTerRate(categoryKey: string, grossIncome: number): number {
        if (!this.rules) {
            this.loadRules();
        }
        if (!this.rules) throw new Error("Tax rules not loaded");

        const categoryData = this.rules.tarif_pph21_ter[categoryKey];
        if (!categoryData) {
            throw new Error(`Unknown category key: ${categoryKey}`);
        }

        for (const layer of categoryData.layers) {
            // Check if income is within range [min, max]
            // max_bruto can be null (infinity)
            const max = layer.max_bruto === null ? Infinity : layer.max_bruto;

            if (grossIncome >= layer.min_bruto && grossIncome <= max) {
                return layer.tarif; // Returns value like 0.25 (meaning 0.25%)
            }
        }

        // Fallback: return max rate of the last layer
        const lastLayer = categoryData.layers[categoryData.layers.length - 1];
        return lastLayer.tarif;
    }

    /**
     * Calculate PPH21 using TER method
     *
     * IMPORTANT: Penghasilan Bruto for PPH21 calculation includes:
     * - Gaji Pokok Aktual
     * - Tunjangan (Beras, Jabatan, Masa Kerja)
     * - Lembur
     * - Premi
     * - ASTEK (BPJS Pensiun pekerja 0.84% - employer portion)
     * - BPJS Kesehatan (4% - employer portion)
     *
     * Formula: PPh21 = Penghasilan Bruto × Tarif TER
     *
     * @param grossIncome - Total bruto income INCLUDING ASTEK + BPJS MAJIKAN
     * @param ptkpStatus - PTKP status (TK/0, TK/1, K/0, etc.)
     */
    public calculatePph21Ter(grossIncome: number, ptkpStatus: string): Pph21TerResult {
        const categoryKey = this.getTerCategoryKey(ptkpStatus);

        // Helper to get friendly name
        const categoryName = this.rules?.tarif_pph21_ter[categoryKey]?.kategori || categoryKey.toUpperCase().replace('_', ' ');

        // ratePercent is the percentage from JSON (e.g., 0.25 for 0.25%, 5.0 for 5%)
        const ratePercent = this.getTerRate(categoryKey, grossIncome);
        // Convert to decimal for calculation (0.25% -> 0.0025)
        const rateDecimal = ratePercent / 100;
        const taxAmount = Math.round(grossIncome * rateDecimal);

        return {
            ptkp_status: ptkpStatus,
            ter_category: categoryName,
            gross_income: grossIncome,
            rate: rateDecimal,
            rate_percent: ratePercent,
            tax_amount: taxAmount
        };
    }

    /**
     * Calculate Penghasilan Bruto for PPh21 TER calculation
     * This includes ASTEK Majikan and BPJS Kesehatan Majikan portions
     *
     * @param gajiPokokAktual - Actual base salary
     * @param berasJumlah - Rice allowance
     * @param jabatanJumlah - Position allowance
     * @param masaKerjaJumlah - Longevity allowance
     * @param lemburJumlah - Overtime amount
     * @param totalPremi - Total premium
     * @param astekMajikan - ASTEK/BPJS Pensiun majikan (0.84%) - EMPLOYER portion
     * @param bpjsKesehatanMajikan - BPJS Kesehatan majikan (4%) - EMPLOYER portion
     * @returns Penghasilan Bruto for tax calculation
     */
    public calculatePenghasilanBruto(
        gajiPokokAktual: number,
        berasJumlah: number,
        jabatanJumlah: number,
        masaKerjaJumlah: number,
        lemburJumlah: number,
        totalPremi: number,
        astekMajikan: number,
        bpjsKesehatanMajikan: number,
        potKoreksi: number = 0,
        pendapatanLainnya: number = 0
    ): number {
        // PENGHASILAN BRUTO untuk PPh21 TER:
        // = gaji pokok + tunjangan (beras, jabatan, masa kerja) + lembur + premi
        // + astek majikan (0.84%) + bpjs kesehatan majikan (4%)
        // + pot_koreksi (deducted from gross)
        // + pendapatan_lainnya (THR, bonus, dll)
        return gajiPokokAktual +
            berasJumlah +
            jabatanJumlah +
            masaKerjaJumlah +
            lemburJumlah +
            totalPremi +
            astekMajikan +
            bpjsKesehatanMajikan -
            potKoreksi +
            pendapatanLainnya;
    }
}

// Export singleton method wrappers for backward compatibility
export const calculatePph21Ter = (grossIncome: number, ptkpStatus: string) => {
    return Pph21TerService.getInstance().calculatePph21Ter(grossIncome, ptkpStatus);
};

export const getTerCategoryOnly = (ptkpStatus: string) => {
    const service = Pph21TerService.getInstance();
    const key = service.getTerCategoryKey(ptkpStatus);
    // Needed to access private/protected rules if we want the friendly name "TER A"
    // Since getTerCategoryKey returns 'ter_a', let's map it back to friendly name or just return 'TER X'
    // For compatibility with previous simple function:
    if (key === 'ter_a') return 'TER A';
    if (key === 'ter_c') return 'TER C';
    return 'TER B';
};

export const calculatePenghasilanBruto = (
    gajiPokokAktual: number,
    berasJumlah: number,
    jabatanJumlah: number,
    masaKerjaJumlah: number,
    lemburJumlah: number,
    totalPremi: number,
    astekMajikan: number,
    bpjsKesehatanMajikan: number,
    potKoreksi: number = 0,
    pendapatanLainnya: number = 0
) => {
    return Pph21TerService.getInstance().calculatePenghasilanBruto(
        gajiPokokAktual, berasJumlah, jabatanJumlah, masaKerjaJumlah,
        lemburJumlah, totalPremi, astekMajikan, bpjsKesehatanMajikan,
        potKoreksi, pendapatanLainnya
    );
};

export const pph21TerService = {
    calculatePph21Ter,
    getTerCategory: getTerCategoryOnly,
    calculatePenghasilanBruto
};




