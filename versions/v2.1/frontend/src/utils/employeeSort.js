const normalizeEmpCode = (value) => String(value ?? '').trim().toUpperCase();

export const compareEmpCodeValues = (a, b) => {
  const aCode = normalizeEmpCode(a);
  const bCode = normalizeEmpCode(b);

  if (!aCode && !bCode) return 0;
  if (!aCode) return 1;
  if (!bCode) return -1;

  return aCode.localeCompare(bCode, 'en', {
    numeric: true,
    sensitivity: 'base'
  });
};

export const compareEmployeesByEmpCode = (a, b) => (
  compareEmpCodeValues(a?.emp_code, b?.emp_code)
);

export const sortEmployeesByEmpCode = (employees) => (
  [...(Array.isArray(employees) ? employees : [])].sort(compareEmployeesByEmpCode)
);
