export interface TaxReportIdentitySource {
    nik?: string | null;
    new_nik?: string | null;
    actual_nik?: string | null;
    nik_ktp?: string | null;
    pajak_npwp?: string | null;
    npwp?: string | null;
    res_address?: string | null;
    alamat?: string | null;
    ResAddress?: string | null;
    ALAMAT?: string | null;
    address?: string | null;
    [key: string]: any;
}

export interface ResolvedTaxReportIdentity {
    nik: string;
    new_nik: string;
    actual_nik: string;
    npwp: string;
    alamat: string;
}

function firstNonBlank(...values: any[]): string {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const trimmed = String(value).trim();
        if (trimmed) return trimmed;
    }
    return "";
}

export function resolveReportIdentity(
    row: TaxReportIdentitySource = {},
    historyIdentity: TaxReportIdentitySource = {}
): ResolvedTaxReportIdentity {
    const adjustedNewNik = firstNonBlank(historyIdentity.new_nik, row.new_nik);
    const actualNik = firstNonBlank(row.actual_nik, row.nik_ktp, historyIdentity.actual_nik, historyIdentity.nik_ktp);
    const fallbackNik = firstNonBlank(actualNik, historyIdentity.nik, row.nik);
    const reportNik = firstNonBlank(adjustedNewNik, fallbackNik);

    return {
        nik: reportNik,
        new_nik: adjustedNewNik,
        actual_nik: actualNik,
        npwp: firstNonBlank(historyIdentity.pajak_npwp, historyIdentity.npwp, row.pajak_npwp, row.npwp),
        alamat: firstNonBlank(
            historyIdentity.res_address,
            historyIdentity.alamat,
            row.res_address,
            row.alamat,
            row.ResAddress,
            row.ALAMAT,
            row.address
        )
    };
}

export function applyReportIdentity<T extends TaxReportIdentitySource>(
    row: T,
    historyIdentity: TaxReportIdentitySource = {}
): T & ResolvedTaxReportIdentity {
    const identity = resolveReportIdentity(row, historyIdentity);

    return {
        ...row,
        nik: identity.nik,
        new_nik: identity.new_nik,
        actual_nik: identity.actual_nik || row.actual_nik || "",
        npwp: identity.npwp,
        pajak_npwp: identity.npwp || row.pajak_npwp || "",
        alamat: identity.alamat,
        res_address: identity.alamat || row.res_address || ""
    } as T & ResolvedTaxReportIdentity;
}

export function collectNikLookupKeys(...sources: TaxReportIdentitySource[]): string[] {
    const keys = new Set<string>();
    for (const source of sources) {
        [
            source?.new_nik,
            source?.nik,
            source?.actual_nik,
            source?.nik_ktp
        ].forEach(value => {
            const key = firstNonBlank(value).toUpperCase();
            if (key) keys.add(key);
        });
    }
    return Array.from(keys);
}
