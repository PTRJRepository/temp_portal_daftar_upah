import { buildAppPath } from './prodModeUtils';

const cleanValue = (value) => {
    const cleaned = String(value || '').trim();
    if (!cleaned || cleaned === 'undefined' || cleaned === 'null') return '';
    return cleaned;
};

export function resolveEmployeeDetailIdentifier(employeeData = {}) {
    const empCode = cleanValue(
        employeeData.emp_code ||
        employeeData.EmpCode ||
        employeeData.employee_code ||
        employeeData.EmployeeCode
    );
    const nik = cleanValue(employeeData.nik || employeeData.NIK || employeeData.actual_nik);

    return {
        empCode: empCode || nik,
        nik
    };
}

export function buildEmployeeDetailPath({
    employeeData,
    month,
    year,
    division,
    useHistoryDb = null,
    snapshotVersion = null,
    buildPath = buildAppPath
}) {
    const { empCode, nik } = resolveEmployeeDetailIdentifier(employeeData);
    if (!empCode) return null;

    const params = new URLSearchParams();
    params.set('emp_code', empCode);
    if (nik && nik !== empCode) params.set('nik', nik);
    if (month) params.set('month', String(month));
    if (year) params.set('year', String(year));
    if (division) params.set('division', division);
    if (useHistoryDb !== null && useHistoryDb !== undefined) params.set('use_history', useHistoryDb ? 'true' : 'false');
    if (snapshotVersion !== null && snapshotVersion !== undefined && snapshotVersion !== '') {
        params.set('snapshot_version', String(snapshotVersion));
    }

    return buildPath(`/employee/detail?${params.toString()}`);
}

export function openEmployeeDetailPage(options, openFn = window.open) {
    const detailPath = buildEmployeeDetailPath(options);
    if (!detailPath) return null;

    openFn(detailPath, '_blank', 'noopener,noreferrer');

    return detailPath;
}
