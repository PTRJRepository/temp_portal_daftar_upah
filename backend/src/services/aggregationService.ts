import { 
    ColumnAggregationConfig, PayrollSummary, PayrollStatistics, 
    BusinessRulesResponse, AggregatedPayrollResponse 
} from "../types/payroll/aggregation";
import { debug, error as logError } from "../utils/logger";

const CATEGORY = "AggregationService";

export class AggregationService {
    private static instance: AggregationService;

    private constructor() { }

    public static getInstance(): AggregationService {
        if (!AggregationService.instance) {
            AggregationService.instance = new AggregationService();
        }
        return AggregationService.instance;
    }

    public createColumnAggregationConfigs(): ColumnAggregationConfig[] {
        const aggregationRules: Record<string, { type: 'sum' | 'avg' | 'count' | 'min' | 'max'; monetary: boolean }> = {
            'hari_kerja': { type: 'sum', monetary: false },
            'cuti_tahunan_hari': { type: 'sum', monetary: false },
            'cuti_sakit_haid_hari': { type: 'sum', monetary: false },
            'cuti_minggu_hari': { type: 'sum', monetary: false },
            'cuti_nasional_hari': { type: 'sum', monetary: false },
            'jumlah_hk': { type: 'sum', monetary: false },
            'tidak_hadir_cth': { type: 'sum', monetary: false },
            'tidak_hadir_alpa': { type: 'sum', monetary: false },
            'total_ketidakhadiran': { type: 'sum', monetary: false },

            'upah_dasar': { type: 'sum', monetary: true },
            'upah_pokok': { type: 'sum', monetary: true },
            'gaji_pokok': { type: 'sum', monetary: true },
            'beras_jumlah': { type: 'sum', monetary: true },
            'jabatan_jumlah': { type: 'sum', monetary: true },
            'masa_kerja_jumlah': { type: 'sum', monetary: true },
            'masa_kerja_amount': { type: 'sum', monetary: true },
            'lembur_jumlah': { type: 'sum', monetary: true },
            'total_tunjangan': { type: 'sum', monetary: true },

            'premi_brondol': { type: 'sum', monetary: true },
            'premi_pruning': { type: 'sum', monetary: true },
            'premi_dynamic_1': { type: 'sum', monetary: true },
            'premi_dynamic_2': { type: 'sum', monetary: true },
            'premi_dynamic_3': { type: 'sum', monetary: true },
            'premi_dynamic_4': { type: 'sum', monetary: true },
            'premi_dynamic_5': { type: 'sum', monetary: true },
            'premi_dynamic_6': { type: 'sum', monetary: true },
            'premi_dynamic_7': { type: 'sum', monetary: true },

            'pph21': { type: 'sum', monetary: true },
            'koreksi': { type: 'sum', monetary: true },
            'bpjs_pek': { type: 'sum', monetary: true },
            'bpjs_maj': { type: 'sum', monetary: true },
            'bpjs_jumlah': { type: 'sum', monetary: true },
            'bpjs_kesehatan_pekerja': { type: 'sum', monetary: true },
            'bpjs_kesehatan_majikan': { type: 'sum', monetary: true },
            'bpjs_pensiun_pekerja': { type: 'sum', monetary: true },
            'bpjs_pensiun_majikan': { type: 'sum', monetary: true },
            'spsi': { type: 'sum', monetary: true },
            'upah_bersih': { type: 'sum', monetary: true },
        };

        return Object.entries(aggregationRules).map(([id, rules]) => ({
            column_id: id,
            column_name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            aggregation_type: rules.type,
            data_type: 'numeric',
            is_monetary: rules.monetary,
            is_hidden_when_empty: true
        }));
    }

    private getNumericValue(row: any, field: string): number {
        const val = row[field];
        if (val === null || val === undefined || val === '') return 0.0;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const parsed = parseFloat(val.replace(/,/g, '').replace(/Rp/g, '').trim());
            return isNaN(parsed) ? 0.0 : parsed;
        }
        return 0.0;
    }

    private aggregateColumn(dataRows: any[], columnId: string, type: string): number {
        if (!dataRows.length) return 0.0;
        const values = dataRows.map(row => this.getNumericValue(row, columnId)).filter(val => val !== 0);
        if (!values.length) return 0.0;

        switch (type) {
            case 'sum': return values.reduce((a, b) => a + b, 0);
            case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
            case 'count': return values.length;
            case 'min': return Math.min(...values);
            case 'max': return Math.max(...values);
            default: return 0.0;
        }
    }

    private calculateTotalPotongan(dataRows: any[]): number {
        return dataRows.reduce((sum, row) => {
            if (Object.prototype.hasOwnProperty.call(row, 'total_potongan')) {
                return sum + this.getNumericValue(row, 'total_potongan');
            }
            return sum + this.calculateRowTotalPotonganBersih(row);
        }, 0);
    }

    private calculateRowTotalPotonganBersih(row: any): number {
        let total = 0.0;
        for (const key of Object.keys(row)) {
            const k = key.toLowerCase();
            if (k.includes('majikan') || k.includes('total') || k.includes('jumlah') || k.endsWith('_maj') || k.includes('_maj_') || k.includes('upah_kotor') || k === 'pot_bpjs_kes' || k === 'pot_premi_pph') continue;
            if (k.startsWith('pot_') || k.startsWith('bpjs_') || ['pph21', 'spsi', 'pendapatan_lainnya'].includes(k)) {
                // [SIGN-SAFETY] potongan wajib magnitude positif. Input negatif tidak boleh flip jadi tambahan.
                total += Math.abs(this.getNumericValue(row, key));
            }
        }
        return total;
    }

    public applyBusinessRules(dataRows: any[], gangCode: string, month: number, year: number): BusinessRulesResponse {
        const filteredRows = dataRows.filter(row => this.getNumericValue(row, 'jumlah_hk') > 0);
        const rulesApplied: any[] = [];

        if (filteredRows.length < dataRows.length) {
            rulesApplied.push({ rule: 'filter_zero_hk', removed_count: dataRows.length - filteredRows.length });
        }

        let calculatedCount = 0;
        for (const row of filteredRows) {
            if (this.getNumericValue(row, 'upah_bersih') === 0) {
                const upahKotor = this.getNumericValue(row, 'jumlah_upah_kotor');
                const potongan = this.calculateRowTotalPotonganBersih(row);
                const premiPph = this.getNumericValue(row, 'pot_premi_pph');
                
                if (upahKotor > 0) {
                    row['upah_bersih'] = upahKotor - potongan + Math.abs(premiPph);
                } else {
                    // [SIGN-SAFETY] pendapatan_lainnya (earning) & koreksi (deduction) wajib magnitude.
                    // premi_pph = ADDITION ke net pay, wajib positif.
                    const base = this.getNumericValue(row, 'gaji_pokok') +
                                 ['beras_jumlah', 'jabatan_jumlah', 'masa_kerja_jumlah', 'lembur_jumlah'].reduce((s, c) => s + this.getNumericValue(row, c), 0) +
                                 ['premi_brondol', 'premi_pruning', 'premi_dynamic_1', 'premi_dynamic_2', 'premi_dynamic_3', 'premi_dynamic_4', 'premi_dynamic_5', 'premi_dynamic_6', 'premi_dynamic_7'].reduce((s, c) => s + this.getNumericValue(row, c), 0) +
                                 Math.abs(this.getNumericValue(row, 'pot_pendapatan_lainnya') || this.getNumericValue(row, 'pendapatan_lainnya') || this.getNumericValue(row, 'pendapatan_thr')) -
                                 Math.abs(this.getNumericValue(row, 'koreksi'));
                    row['upah_bersih'] = base - potongan + Math.abs(premiPph);
                }
                calculatedCount++;
            }
        }

        if (calculatedCount > 0) rulesApplied.push({ rule: 'calculate_upah_bersih', count: calculatedCount });

        return { gang_code: gangCode, month, year, rules_applied: rulesApplied, processed_data: filteredRows };
    }

    public createAggregatedResponse(dataRows: any[], gangCode: string, month: number, year: number, processingTimeMs: number = 0, useThreading: boolean = false): AggregatedPayrollResponse {
        const bizResult = this.applyBusinessRules(dataRows, gangCode, month, year);
        const data = bizResult.processed_data;
        const upahBersihValues = data.map(r => this.getNumericValue(r, 'upah_bersih'));

        const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        return {
            gang_code: gangCode, month, year, period: `${monthNames[month - 1]} ${year}`, generated_at: new Date(),
            total_records: data.length, processing_time_ms: processingTimeMs, use_threading: useThreading, data_rows: data,
            summary: {
                total_employees: data.length,
                total_hk: this.aggregateColumn(data, 'jumlah_hk', 'sum'),
                total_upah_dasar: this.aggregateColumn(data, 'upah_dasar', 'sum'),
                total_upah_pokok: this.aggregateColumn(data, 'upah_pokok', 'sum'),
                total_gaji_pokok: this.aggregateColumn(data, 'gaji_pokok', 'sum'),
                total_tunjangan: this.aggregateColumn(data, 'total_tunjangan', 'sum'),
                total_potongan: this.calculateTotalPotongan(data),
                total_upah_bersih: this.aggregateColumn(data, 'upah_bersih', 'sum'),
                average_upah_bersih: upahBersihValues.length ? upahBersihValues.reduce((a, b) => a + b, 0) / upahBersihValues.length : 0,
                min_upah_bersih: upahBersihValues.length ? Math.min(...upahBersihValues) : 0,
                max_upah_bersih: upahBersihValues.length ? Math.max(...upahBersihValues) : 0
            },
            statistics: {
                total_hadir: this.aggregateColumn(data, 'hari_kerja', 'sum'),
                total_cuti_tahunan: this.aggregateColumn(data, 'cuti_tahunan_hari', 'sum'),
                total_cuti_sakit: this.aggregateColumn(data, 'cuti_sakit_haid_hari', 'sum'),
                total_cuti_minggu: this.aggregateColumn(data, 'cuti_minggu_hari', 'sum'),
                total_cuti_nasional: this.aggregateColumn(data, 'cuti_nasional_hari', 'sum'),
                total_tidak_hadir: this.aggregateColumn(data, 'total_ketidakhadiran', 'sum'),
                total_beras: this.aggregateColumn(data, 'beras_jumlah', 'sum'),
                total_jabatan: this.aggregateColumn(data, 'jabatan_jumlah', 'sum'),
                total_masa_kerja: this.aggregateColumn(data, 'masa_kerja_amount', 'sum'),
                total_lembur: this.aggregateColumn(data, 'lembur_jumlah', 'sum'),
                total_pph21: this.aggregateColumn(data, 'pph21', 'sum'),
                total_koreksi: this.aggregateColumn(data, 'koreksi', 'sum'),
                total_bpjs_pekerja: this.aggregateColumn(data, 'bpjs_pek', 'sum'),
                total_bpjs_majikan: this.aggregateColumn(data, 'bpjs_maj', 'sum'),
                total_bpjs_pensiun_pekerja: this.aggregateColumn(data, 'bpjs_pensiun_pekerja', 'sum'),
                total_bpjs_pensiun_majikan: this.aggregateColumn(data, 'bpjs_pensiun_majikan', 'sum'),
                total_spsi: this.aggregateColumn(data, 'spsi', 'sum'),
                total_brondol: this.aggregateColumn(data, 'premi_brondol', 'sum'),
                total_pruning: this.aggregateColumn(data, 'premi_pruning', 'sum'),
                total_premi_dinamis_1: this.aggregateColumn(data, 'premi_dynamic_1', 'sum'),
                total_premi_dinamis_2: this.aggregateColumn(data, 'premi_dynamic_2', 'sum'),
                total_premi_dinamis_3: this.aggregateColumn(data, 'premi_dynamic_3', 'sum'),
                total_premi_dinamis_4: this.aggregateColumn(data, 'premi_dynamic_4', 'sum'),
                total_premi_dinamis_5: this.aggregateColumn(data, 'premi_dynamic_5', 'sum'),
                total_premi_dinamis_6: this.aggregateColumn(data, 'premi_dynamic_6', 'sum'),
                total_premi_dinamis_7: this.aggregateColumn(data, 'premi_dynamic_7', 'sum'),
            },
            columns_info: this.createColumnAggregationConfigs(),
            empty_columns: data.length ? Object.keys(data[0]).filter(k => data.every(r => this.getNumericValue(r, k) === 0)) : [],
            business_rules: bizResult
        };
    }
}

export const aggregationService = AggregationService.getInstance();
