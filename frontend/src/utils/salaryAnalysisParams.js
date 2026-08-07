/**
 * Build URL search params untuk Analisis Gaji (SalaryAnalysisPage).
 * Satu panggilan setSearchParams untuk semua perubahan — dua panggilan terpisah
 * dari `searchParams` stale akan saling menimpa (update ke-2 kehilangan yang ke-1),
 * yang dulu membuat ganti divisi tidak pernah tersimpan.
 */
export function buildAnalysisSearchParams(searchParams, overrides = {}) {
    const p = new URLSearchParams(searchParams);
    if (overrides.division !== undefined) {
        if (overrides.division) p.set('division_code', String(overrides.division));
        else p.delete('division_code');
    }
    if (overrides.gang !== undefined) {
        if (overrides.gang) p.set('gang_code', String(overrides.gang));
        else p.delete('gang_code');
    }
    if (overrides.month !== undefined) {
        if (overrides.month) p.set('month', String(overrides.month));
        else p.delete('month');
    }
    if (overrides.year !== undefined) {
        if (overrides.year) p.set('year', String(overrides.year));
        else p.delete('year');
    }
    return p;
}
