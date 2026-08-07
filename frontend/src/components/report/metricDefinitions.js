// ===== METRIC DEFINITIONS — single source of truth untuk interpretasi =====
// Tiap metrik: apa artinya, rumus, sumber kolom/tabel, cakupan gang.
// Tujuan: user paham "angka ini dari mana" → tidak salah paham.
// Selaras dengan backend/src/services/dashboardService.ts.

export const SCOPE = {
    PANEN: {
        key: 'panen',
        label: 'Gang Panen',
        short: 'Panen',
        desc: "Hanya gang bersuffix 'H' (panen). Karyawan transport, workshop, dan non-panen TIDAK dihitung.",
        sql: "RIGHT(UPPER(gang_code),1) = 'H'"
    },
    MAINTENANCE: {
        key: 'maintenance',
        label: 'Gang Maintenance',
        short: 'Maintenance',
        desc: "Hanya gang bersuffix 'M' (perawatan: pruning, raking, jaga, dsb). Tonase TBS tidak berlaku pada scope ini.",
        sql: "RIGHT(UPPER(gang_code),1) = 'M'"
    },
    TRANSPORT: {
        key: 'transport',
        label: 'Gang Transport',
        short: 'Transport',
        desc: "Hanya gang bersuffix 'T' (supir/angkutan TBS dan material). Tonase TBS tidak berlaku pada scope ini.",
        sql: "RIGHT(UPPER(gang_code),1) = 'T'"
    },
    ALL: {
        key: 'all',
        label: 'Semua Gang',
        short: 'Semua',
        desc: 'Seluruh gang: panen, transport, maintenance, dan lainnya.',
        sql: null
    }
};

export const SOURCE_TABLE = {
    AGG: 'dbo.daftar_upah_aggregation_history',
    NOTE: 'Data = snapshot agregasi historis (sudah di-precompute per gang & periode), BUKAN query live PR_ADTRANS.'
};

/**
 * Definisi tiap metrik yang tampil di board.
 * fields:
 *  - label   : nama tampil
 *  - formula : rumus turunan (bila ada)
 *  - column  : kolom sumber di tabel agregasi
 *  - scope   : SCOPE.PANEN | SCOPE.ALL
 *  - basis   : 'kotor' (gross) | 'bersih' (net) | 'unit'
 *  - caveat  : catatan salah-paham umum (tampil di tooltip)
 */
export const METRICS = {
    total_upah_kotor: {
        label: 'Total Upah Kotor',
        formula: 'gaji_pokok_aktual + total_tunjangan + total_premi',
        column: 'total_upah_kotor',
        scope: SCOPE.PANEN,
        basis: 'kotor',
        caveat: 'Cakupan gang PANEN saja. Angka lebih kecil dari Daftar Upah penuh (yang mencakup semua gang). Belum dikurangi potongan.'
    },
    cost_per_ton: {
        label: 'Cost per Ton',
        formula: 'total_upah_kotor ÷ total_tonase (tonase dedup per divisi)',
        column: 'total_ffb_weight (tonase)',
        scope: SCOPE.PANEN,
        basis: 'unit',
        caveat: 'Valid pada level DIVISI, bukan per gang. Tonase TBS dicatat per divisi/angkutan transport. Bila tonase = 0 (sumber belum diisi), metrik tampil "-".'
    },
    total_tonase: {
        label: 'Tonase TBS',
        formula: 'Σ tonase per divisi (dedup, MAX per divisi)',
        column: 'total_ffb_weight',
        scope: SCOPE.PANEN,
        basis: 'unit',
        caveat: 'Tonase adalah milik DIVISI (TBS ditimbang per divisi/angkutan, bukan per regu panen). Didedup per divisi agar tidak double-count saat divisi punya >1 gang panen. Tonase per GANG PANEN tidak tersedia. Supir TBS adalah gang transport, bukan pemanen.'
    },
    headcount_panen: {
        label: 'Headcount Panen',
        formula: 'Σ total_employees',
        column: 'total_employees',
        scope: SCOPE.PANEN,
        basis: 'unit',
        caveat: 'Hanya karyawan di gang panen (suffix H).'
    },
    premi_share: {
        label: 'Premi Share',
        formula: 'total_premi ÷ total_upah_kotor × 100%',
        column: 'total_premi',
        scope: SCOPE.PANEN,
        basis: 'kotor',
        caveat: 'Porsi premi dalam upah kotor. Naik = proporsi premi membesar relatif ke gaji+tunjangan.'
    },
    total_lembur: {
        label: 'Total Lembur',
        formula: 'Σ total_lembur',
        column: 'total_lembur',
        scope: SCOPE.PANEN,
        basis: 'kotor',
        caveat: 'Biaya lembur gang panen. Komponen dari upah kotor.'
    },
    cost_per_hk: {
        label: 'Cost / HK',
        formula: 'total_upah ÷ total_hk',
        column: 'total_hk (hari kerja)',
        scope: SCOPE.PANEN,
        basis: 'unit',
        caveat: 'Biaya per hari kerja. Dipakai untuk deteksi lonjakan (wage spike).'
    },
    total_premi: {
        label: 'Total Premi',
        formula: 'Σ total_premi',
        column: 'total_premi',
        scope: SCOPE.PANEN,
        basis: 'kotor',
        caveat: 'Akumulasi premi panen (brondol, pruning, insentif, kinerja, dll).'
    },
    upah_bersih: {
        label: 'Upah Bersih',
        formula: 'jumlah_upah_kotor − total_potongan + premi_pph',
        column: 'total_upah_bersih',
        scope: SCOPE.ALL,
        basis: 'bersih',
        caveat: 'Take-home pay setelah potongan. Berbeda dari upah kotor, jangan dibandingkan langsung.'
    },
    upah_kotor_per_ton: {
        label: 'Upah Kotor / Ton',
        formula: 'total_upah_kotor ÷ total_tonase',
        column: 'total_upah_kotor, total_ffb_weight',
        scope: SCOPE.PANEN,
        basis: 'unit',
        caveat: 'Efisiensi biaya tenaga kerja per ton TBS. Naik = biaya per ton membesar (buruk bila tonase stagnan).'
    },
    upah_kotor_per_hk: {
        label: 'Upah Kotor / HK',
        formula: 'total_upah_kotor ÷ total_hk',
        column: 'total_upah_kotor, total_hk',
        scope: SCOPE.PANEN,
        basis: 'unit',
        caveat: 'Biaya per hari kerja. Pembanding cost/ton: bila cost/HK naik tapi cost/ton turun → produktivitas membaik.'
    }
};

/**
 * Interpretasi cost/ton untuk pembaca non-teknis (CEO).
 * Dipakai CostPerTonPanel untuk narasi otomatis.
 */
export function interpretCostPerTon({ costPerTon, prevCostPerTon, costPerHk, tonase }) {
    if (!tonase || tonase === 0) {
        return [{ tone: 'empty', text: 'Tonase belum diisi. Cost/ton tidak dapat dihitung. Isi sumber tonase TBS untuk mengaktifkan analisis efisiensi.' }];
    }
    if (costPerTon == null) return [{ tone: 'empty', text: 'Data cost/ton belum tersedia untuk periode ini.' }];
    const out = [];
    if (prevCostPerTon) {
        const pct = ((costPerTon - prevCostPerTon) / prevCostPerTon) * 100;
        out.push({ tone: pct > 0 ? 'bad' : 'good', text: `Cost/ton ${pct >= 0 ? 'naik' : 'turun'} ${Math.abs(pct).toFixed(1)}% vs bulan lalu.` });
    }
    if (costPerHk) {
        out.push({ tone: 'info', text: 'Bandingkan dengan Cost/HK: cost/ton turun saat cost/HK stabil menandakan produktivitas panen membaik.' });
    }
    return out.length ? out : [{ tone: 'info', text: 'Cost/ton stabil.' }];
}

/** Ambil definisi; fallback aman bila key tidak dikenal. */
export function getMetric(key) {
    return METRICS[key] || { label: key, formula: null, column: null, scope: SCOPE.ALL, basis: 'unit', caveat: null };
}
