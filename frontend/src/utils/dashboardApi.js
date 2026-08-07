// ===== Fetch helper untuk endpoint /payroll/dashboard =====
// Menggantikan 3 pola base URL yang sebelumnya campur aduk di ExecutivePayrollPage:
//   1. `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002'}/payroll/dashboard`
//   2. `/backend/upah/payroll/dashboard`  (proxy gateway mode)
//   3. `/payroll/dashboard`               (same-origin 8005)
// Strategi: coba kandidat base berurutan; lanjut ke kandidat berikutnya hanya
// pada network error atau 404 (mount path salah). Status lain (401/500/dll)
// dikembalikan apa adanya agar caller bisa menangani error JSON dari server.

const ENV_BASE = import.meta.env?.VITE_API_BASE_URL || '';

const BASE_CANDIDATES = ENV_BASE
    ? [`${ENV_BASE}/payroll/dashboard`]
    : ['/payroll/dashboard', '/backend/upah/payroll/dashboard'];

/**
 * Fetch ke endpoint dashboard dengan fallback base URL.
 * @param {string} path - path endpoint, mis. '/executive-summary?month=1&year=2026'
 * @param {{ token?: string }} & RequestInit options
 * @returns {Promise<Response>} respons ok pertama, atau respons terakhir bila semua gagal
 */
export async function dashFetch(path, { token, headers, ...rest } = {}) {
    let lastError = null;
    let lastResponse = null;

    for (const base of BASE_CANDIDATES) {
        try {
            const res = await fetch(`${base}${path}`, {
                ...rest,
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    ...headers,
                },
            });
            if (res.status === 404 && BASE_CANDIDATES.indexOf(base) < BASE_CANDIDATES.length - 1) {
                lastResponse = res;
                continue; // mount path salah → coba kandidat berikutnya
            }
            return res;
        } catch (e) {
            lastError = e;
        }
    }

    if (lastResponse) return lastResponse;
    throw lastError || new Error(`Semua base URL dashboard gagal untuk ${path}`);
}

/** Sama seperti dashFetch, langsung parse JSON. */
export async function dashJson(path, options = {}) {
    const res = await dashFetch(path, options);
    return res.json();
}
