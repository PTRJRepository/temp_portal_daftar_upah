export const toPayrollNumber = (value) => {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

export const getWagesPremiTotal = (row = {}) => {
  const excludingSpecial = row.total_premi_excluding_special;
  return toPayrollNumber(excludingSpecial ?? row.total_premi);
};

export const getAuditStatus = (selisih) => (
  toPayrollNumber(selisih) === 0 ? 'OK' : 'Review'
);

export const getAuditRemark = (selisih) => getAuditStatus(selisih);

const normalizeRow = (row = {}, groupLabel = '') => {
  const pph21 = toPayrollNumber(row.total_pph21);
  const spsi = toPayrollNumber(row.total_spsi);
  const totalPremi = getWagesPremiTotal(row);
  const lembur = toPayrollNumber(row.total_lembur);
  const selisih = toPayrollNumber(row.selisih);

  return {
    estateName: groupLabel,
    divisionName: row.description || row.division_code || '-',
    divisionCode: row.division_code || '',
    workers: toPayrollNumber(row.total_employees),
    hk: toPayrollNumber(row.total_hk),
    pph21,
    spsi,
    totalPotongan: pph21 + spsi,
    totalPremi,
    lembur,
    totalIncome: totalPremi + lembur,
    upahBersihPortal: toPayrollNumber(row.total_manual),
    thumbPrint: toPayrollNumber(row.thumb_print),
    selisih,
    auditStatus: getAuditStatus(selisih),
    auditRemark: getAuditRemark(selisih),
  };
};

const normalizeSummary = (group = {}) => {
  const subtotal = group.subtotal || {};
  const rows = group.divisions || [];
  const fallback = rows.reduce((acc, row) => {
    const normalized = normalizeRow(row, group.label);
    acc.workers += normalized.workers;
    acc.hk += normalized.hk;
    acc.pph21 += normalized.pph21;
    acc.spsi += normalized.spsi;
    acc.totalPotongan += normalized.totalPotongan;
    acc.totalPremi += normalized.totalPremi;
    acc.lembur += normalized.lembur;
    acc.totalIncome += normalized.totalIncome;
    acc.upahBersihPortal += normalized.upahBersihPortal;
    acc.thumbPrint += normalized.thumbPrint;
    acc.selisih += normalized.selisih;
    return acc;
  }, {
    workers: 0,
    hk: 0,
    pph21: 0,
    spsi: 0,
    totalPotongan: 0,
    totalPremi: 0,
    lembur: 0,
    totalIncome: 0,
    upahBersihPortal: 0,
    thumbPrint: 0,
    selisih: 0,
  });

  const pph21 = toPayrollNumber(subtotal.total_pph21 ?? fallback.pph21);
  const spsi = toPayrollNumber(subtotal.total_spsi ?? fallback.spsi);
  const totalPremi = toPayrollNumber(
    subtotal.total_premi_excluding_special ?? subtotal.total_premi ?? fallback.totalPremi
  );
  const lembur = toPayrollNumber(subtotal.total_lembur ?? fallback.lembur);
  const selisih = toPayrollNumber(subtotal.selisih ?? fallback.selisih);

  return {
    estateName: group.label || '-',
    workers: toPayrollNumber(subtotal.total_employees ?? fallback.workers),
    hk: toPayrollNumber(subtotal.total_hk ?? fallback.hk),
    pph21,
    spsi,
    totalPotongan: pph21 + spsi,
    totalPremi,
    lembur,
    totalIncome: totalPremi + lembur,
    upahBersihPortal: toPayrollNumber(subtotal.total_manual ?? fallback.upahBersihPortal),
    thumbPrint: toPayrollNumber(subtotal.thumb_print ?? fallback.thumbPrint),
    selisih,
    auditStatus: getAuditStatus(selisih),
    auditRemark: getAuditRemark(selisih),
  };
};

export function buildWagesAuditModel(groupedData = {}, grandTotal = {}) {
  const groups = Object.values(groupedData || {});
  const detailRows = groups.flatMap((group) => (
    (group.divisions || []).map((row) => normalizeRow(row, group.label))
  ));
  const estateSummary = groups.map(normalizeSummary);

  const grandPph21 = toPayrollNumber(grandTotal?.total_pph21);
  const grandSpsi = toPayrollNumber(grandTotal?.total_spsi);
  const grandPremi = toPayrollNumber(
    grandTotal?.total_premi_excluding_special ?? grandTotal?.total_premi
  );
  const grandLembur = toPayrollNumber(grandTotal?.total_lembur);
  const grandSelisih = toPayrollNumber(grandTotal?.selisih);

  return {
    detailRows,
    deductionRows: detailRows,
    incomeRows: detailRows,
    estateSummary,
    deductionEstateSummary: estateSummary,
    incomeEstateSummary: estateSummary,
    grandTotal: {
      workers: toPayrollNumber(grandTotal?.total_employees),
      hk: toPayrollNumber(grandTotal?.total_hk),
      pph21: grandPph21,
      spsi: grandSpsi,
      totalPotongan: grandPph21 + grandSpsi,
      totalPremi: grandPremi,
      lembur: grandLembur,
      totalIncome: grandPremi + grandLembur,
      upahBersihPortal: toPayrollNumber(grandTotal?.total_manual),
      thumbPrint: toPayrollNumber(grandTotal?.thumb_print),
      selisih: grandSelisih,
      auditStatus: getAuditStatus(grandSelisih),
      auditRemark: getAuditRemark(grandSelisih),
    },
  };
}


