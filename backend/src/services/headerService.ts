import { Database } from "../db/client";
import { cacheService } from "./cacheService";
import { ADTRANS_DYNAMIC_PREMI_PATTERNS } from "./payroll/adtransDocDescMapping";

interface ColumnDef {
    field: string;
    headerName: string;
    children?: ColumnDef[];
    compute?: any;
}

export class HeaderService {
    private static instance: HeaderService;
    private db: Database;

    private constructor() {
        this.db = Database.getInstance();
    }

    public static getInstance(): HeaderService {
        if (!HeaderService.instance) {
            HeaderService.instance = new HeaderService();
        }
        return HeaderService.instance;
    }

    // Premi keywords filter
    private readonly ALLOWED_PREMI_KEYWORDS = [
        "PREMI", "PANEN", "PRUNING", "KERANI", "MANDOR", "CUCI", "BUAH",
        "PUPUK", "RAWAT", "SEMPROT", "ANGKUT", "MUAT", "LANGSIR", "LOADING"
    ];

    // Normalize premi field name
    public normalizePremiFieldName(docDesc: string): string {
        if (!docDesc) return "";

        let name = docDesc.trim().toUpperCase();
        const prefixes = ["TUNJANGAN PREMI", "TUNJANGAN", "PREMI"];

        for (const prefix of prefixes) {
            if (name.startsWith(prefix)) {
                name = name.slice(prefix.length).trim();
                break;
            }
        }

        if (!name) return "";

        name = name.toLowerCase().replace(/ /g, "_");
        name = name.replace(/[^a-z0-9_]/g, "");
        name = name.replace(/_+/g, "_").replace(/^_|_$/g, "");

        if (!name) return "";
        return name.startsWith("premi_") ? name : `premi_${name}`;
    }

    // Map premi field
    public mapPremiField(premiName: string): string {
        const normalized = this.normalizePremiFieldName(premiName);
        return normalized || `premi_${premiName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    }

    // Map potongan field
    public mapPotonganField(potName: string): string {
        let name = potName.trim().toLowerCase();
        name = name.replace(/^pot[_.]*/, "");
        name = name.replace(/[^a-z0-9]/g, "_");
        name = name.replace(/_+/g, "_").replace(/^_|_$/g, "");
        return name ? `pot_dynamic_${name}` : "";
    }

    // Get dynamic premi headers from database
    public async getDynamicPremiHeaders(
        month: number,
        year: number,
        gangCode?: string
    ): Promise<string[]> {
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const endDate = month === 12
            ? `${year + 1}-01-01`
            : `${year}-${(month + 1).toString().padStart(2, "0")}-01`;

        try {
            const premiCondition = ADTRANS_DYNAMIC_PREMI_PATTERNS
                .map((pattern) => `UPPER(t.DocDesc) LIKE '${pattern}'`)
                .join(" OR ");
            const sql = gangCode
                ? `
                    SELECT DISTINCT t.DocDesc
                    FROM PR_ADTRANS_ARC t
                    JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                    JOIN HR_GANGLN g ON ln.EmpCode = g.GangMember
                    WHERE g.GangCode = ?
                      AND t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status = 3
                      AND (${premiCondition})
                      AND UPPER(t.DocDesc) NOT LIKE '%ADJ%'
                      AND UPPER(t.DocDesc) NOT LIKE '%BRONDOL%'
                      AND ln.Amount > 0
                    ORDER BY t.DocDesc
                `
                : `
                    SELECT DISTINCT t.DocDesc
                    FROM PR_ADTRANS_ARC t
                    JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                    WHERE t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status = 3
                      AND (${premiCondition})
                      AND UPPER(t.DocDesc) NOT LIKE '%ADJ%'
                      AND UPPER(t.DocDesc) NOT LIKE '%BRONDOL%'
                      AND ln.Amount > 0
                    ORDER BY t.DocDesc
                `;

            const params = gangCode ? [gangCode, startDate, endDate] : [startDate, endDate];
            const rows = await this.db.query<{ DocDesc: string }>(sql, params);

            const headers = rows
                .map(r => r.DocDesc?.trim())
                .filter(Boolean)
                .slice(0, 7); // Limit to 7

            return headers;
        } catch (e) {
            console.error("[HeaderService] Failed to get dynamic premi headers:", e);
            return [];
        }
    }

    // Get dynamic potongan headers from database
    public async getDynamicPotonganHeaders(
        month: number,
        year: number,
        gangCode?: string
    ): Promise<string[]> {
        const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
        const endDate = month === 12
            ? `${year + 1}-01-01`
            : `${year}-${(month + 1).toString().padStart(2, "0")}-01`;

        try {
            const sql = gangCode
                ? `
                    SELECT DISTINCT t.DocDesc
                    FROM PR_ADTRANS_ARC t
                    JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                    JOIN HR_GANGLN g ON ln.EmpCode = g.GangMember
                    WHERE g.GangCode = ?
                      AND t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status = 3
                      AND UPPER(t.DocDesc) LIKE '%POT%'
                      AND UPPER(t.DocDesc) NOT LIKE '%ADJ%'
                      AND ln.Amount < 0
                    ORDER BY t.DocDesc
                `
                : `
                    SELECT DISTINCT t.DocDesc
                    FROM PR_ADTRANS_ARC t
                    JOIN PR_ADTRANSLN_ARC ln ON t.ID = ln.MasterID
                    WHERE t.DocDate >= ? AND t.DocDate < ?
                      AND t.Status = 3
                      AND UPPER(t.DocDesc) LIKE '%POT%'
                      AND UPPER(t.DocDesc) NOT LIKE '%ADJ%'
                      AND ln.Amount < 0
                    ORDER BY t.DocDesc
                `;

            const params = gangCode ? [gangCode, startDate, endDate] : [startDate, endDate];
            const rows = await this.db.query<{ DocDesc: string }>(sql, params);

            // Filter out static/non-dynamic potongan headers.
            const excluded = ["pph21", "spsi", "bpjs", "astek", "sehat", "adj"];
            const headers = rows
                .map(r => r.DocDesc?.trim())
                .filter(h => {
                    if (!h) return false;
                    const lower = h.toLowerCase();
                    return !excluded.some(ex => lower.includes(ex));
                })
                .slice(0, 7);

            return headers;
        } catch (e) {
            console.error("[HeaderService] Failed to get dynamic potongan headers:", e);
            return [];
        }
    }

    // Generate dynamic headers response
    public async generateDynamicHeaders(
        month?: number,
        year?: number,
        gangCode?: string
    ): Promise<any> {
        const m = month || new Date().getMonth() + 1;
        const y = year || new Date().getFullYear();

        const [dynPremi, dynPotongan] = await Promise.all([
            this.getDynamicPremiHeaders(m, y, gangCode),
            this.getDynamicPotonganHeaders(m, y, gangCode)
        ]);

        return {
            month: m,
            year: y,
            gang_code: gangCode || "ALL",
            dynamic_premi: dynPremi.map((h, i) => ({
                index: i + 1,
                header: h,
                field: this.normalizePremiFieldName(h) || `premi_${i + 1}`
            })),
            dynamic_potongan: dynPotongan.map((h, i) => ({
                index: i + 1,
                header: h,
                field: this.mapPotonganField(h) || `pot_dynamic_${i + 1}`
            })),
            static_premi: ["premi_brondol"],
            static_potongan: ["pot_spsi", "pot_pph21", "pot_koreksi"]
        };
    }

    // Get dynamic pendapatan lainnya headers (custom income types from employee_other_incomes)
    public async getDynamicPendapatanHeaders(
        month: number,
        year: number
    ): Promise<{ type: string; name: string }[]> {
        try {
            const extDb = Database.getExtendedInstance();
            const rows = await extDb.query<{ income_type: string; income_name: string }>(`
                SELECT DISTINCT income_type, income_name 
                FROM employee_other_incomes
                WHERE period_year = ? AND period_month = ?
                  AND income_type NOT IN ('THR', 'BONUS', 'CUSTOM', 'PENDAPATAN TIDAK TETAP')
                ORDER BY income_type
            `, [year, month]);

            const headers = rows.map(r => ({
                type: r.income_type,
                name: r.income_name || r.income_type
            }));

            return headers;
        } catch (e) {
            console.error("[HeaderService] Failed to get dynamic pendapatan headers:", e);
            return [];
        }
    }

    // Get column definitions (simplified structure)
    public async getColumnDefinitions(
        month?: number,
        year?: number,
        gangCode?: string
    ): Promise<ColumnDef[]> {
        const m = month || new Date().getMonth() + 1;
        const y = year || new Date().getFullYear();

        const [dynPremi, dynPotongan, dynPendapatan] = await Promise.all([
            this.getDynamicPremiHeaders(m, y, gangCode),
            this.getDynamicPotonganHeaders(m, y, gangCode),
            this.getDynamicPendapatanHeaders(m, y)
        ]);

        // Base columns
        const columns: ColumnDef[] = [
            { field: "no", headerName: "No" },
            { field: "nik", headerName: "NIK" },
            { field: "emp_code", headerName: "EMP Code" },
            { field: "nama", headerName: "Nama" },
            { field: "jenis_kelamin", headerName: "JK" },
            { field: "gang_code", headerName: "Gang" },
            {
                field: "bunches",
                headerName: "PANEN (BUNCHES)",
                children: [
                    { field: "bunches_total", headerName: "Total Janjang" },
                    { field: "bunches_ripe", headerName: "Masak" },
                    { field: "bunches_unripe", headerName: "Mentah" },
                    { field: "bunches_round", headerName: "Bundar" },
                    { field: "bunches_transactions", headerName: "Jml Transaksi" }
                ]
            },
            {
                field: "upah_kotor",
                headerName: "UPAH KOTOR",
                children: [
                    { field: "upah_dasar", headerName: "Upah Dasar" },
                    { field: "jumlah_hk", headerName: "JML HK" },
                    { field: "gaji_pokok", headerName: "Gaji Pokok" }
                ]
            },
            {
                field: "tunjangan",
                headerName: "TUNJANGAN",
                children: [
                    { field: "beras_jumlah", headerName: "Beras" },
                    { field: "jabatan_jumlah", headerName: "Jabatan" },
                    {
                        field: "masa_kerja",
                        headerName: "Masa Kerja",
                        children: [
                            { field: "masa_kerja_tahun", headerName: "Lama" },
                            { field: "masa_kerja_jumlah", headerName: "Jumlah" }
                        ]
                    },
                    { field: "lembur_jumlah", headerName: "Lembur" },
                    { field: "total_tunjangan", headerName: "Total" }
                ]
            },
            {
                field: "premi_group",
                headerName: "PREMI",
                children: [
                    { field: "premi_brondol", headerName: "Brondol" },
                    ...dynPremi.map((h, i) => ({
                        field: this.normalizePremiFieldName(h) || `premi_${i + 1}`,
                        headerName: h.replace(/^(TUNJANGAN\s+)?PREMI\s*/i, "").trim() || `Premi ${i + 1}`
                    })),
                    { field: "total_premi", headerName: "Total" }
                ]
            },
            // [DYNAMIC] Pendapatan Lainnya - THR, Bonus, Custom + dynamically discovered types
            // Moved before POTONGAN as requested
            {
                field: "pendapatan_lainnya",
                headerName: "PENDAPATAN LAINNYA",
                children: [
                    { field: "pendapatan_thr", headerName: "THR" },
                    { field: "pendapatan_bonus", headerName: "Bonus" },
                    { field: "pendapatan_custom", headerName: "Custom" },
                    ...dynPendapatan.map(p => ({
                        field: `pendapatan_${p.type.toLowerCase()}`,
                        headerName: p.name
                    })),
                    { field: "total_pendapatan_lainnya", headerName: "Total" }
                ]
            },
            {
                field: "potongan",
                headerName: "POTONGAN",
                children: [
                    { field: "pot_spsi", headerName: "SPSI" },
                    { field: "pot_pph21", headerName: "PPH21" },
                    { field: "pot_koreksi", headerName: "Koreksi" },
                    ...dynPotongan.map((h, i) => ({
                        field: this.mapPotonganField(h) || `pot_dynamic_${i + 1}`,
                        headerName: h.replace(/^POT[_.]*\s*/i, "").trim() || `Pot ${i + 1}`
                    })),
                    { field: "total_potongan", headerName: "Total" }
                ]
            },
            { field: "jumlah_upah_kotor", headerName: "Jml Upah Kotor" },
            { field: "upah_bersih", headerName: "Upah Bersih" }
        ];

        return columns;
    }

    // Fallback column definitions
    public getFallbackColumnDefs(): ColumnDef[] {
        return [
            { field: "no", headerName: "No" },
            { field: "nik", headerName: "NIK" },
            { field: "nama", headerName: "Nama" },
            { field: "jenis_kelamin", headerName: "JK" },
            { field: "gang_code", headerName: "Gang" },
            { field: "bunches_total", headerName: "Total Janjang" },
            { field: "bunches_ripe", headerName: "Masak" },
            { field: "bunches_unripe", headerName: "Mentah" },
            { field: "bunches_round", headerName: "Bundar" },
            { field: "bunches_transactions", headerName: "Jml Transaksi" },
            { field: "upah_dasar", headerName: "Upah Dasar" },
            { field: "jumlah_hk", headerName: "JML HK" },
            { field: "gaji_pokok", headerName: "Gaji Pokok" },
            { field: "total_tunjangan", headerName: "Total Tunjangan" },
            { field: "total_premi", headerName: "Total Premi" },
            // [DYNAMIC] Pendapatan Lainnya
            { field: "pendapatan_thr", headerName: "THR" },
            { field: "pendapatan_bonus", headerName: "Bonus" },
            { field: "pendapatan_lainnya", headerName: "Total Pendapatan Lain" },
            { field: "total_potongan", headerName: "Total Potongan" },
            { field: "upah_bersih", headerName: "Upah Bersih" }
        ];
    }
}

export const headerService = HeaderService.getInstance();
