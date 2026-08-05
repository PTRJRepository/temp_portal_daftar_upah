const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const percentChange = ({ current, previous, diff }) => {
  const prev = toNumber(previous);
  if (prev === 0) {
    return toNumber(current) === 0 ? 0 : null;
  }
  return (toNumber(diff) / prev) * 100;
};

const maxBy = (items, getValue) => {
  if (!items.length) return null;
  return items.reduce((best, item) => (getValue(item) > getValue(best) ? item : best), items[0]);
};

const minBy = (items, getValue) => {
  if (!items.length) return null;
  return items.reduce((best, item) => (getValue(item) < getValue(best) ? item : best), items[0]);
};

const resolvePremiumHeaders = (headers, breakdownTotals) => {
  const ordered = Array.isArray(headers) ? headers : [];
  const fromTotals = Object.keys(breakdownTotals || {});
  return Array.from(new Set([...ordered, ...fromTotals]));
};

const cleanText = (value) => String(value || '').trim();

const getDivisionLabel = (row) => {
  const code = cleanText(row.division_code);
  const description = cleanText(row.description || row.estate);
  if (code && description && description.toUpperCase() !== code.toUpperCase()) {
    return `${code} - ${description}`;
  }
  return code || description || '-';
};

const getGangLabel = (row) => cleanText(row.gang_code) || cleanText(row.division_code) || '-';

const getGangDescriptionLabel = (row) => (
  cleanText(row.gang_description) || cleanText(row.gang_desc) || '-'
);

const getInsightLabel = (row) => {
  const totalDiff = toNumber(row.diff_premi) + toNumber(row.diff_ot);
  if (totalDiff < 0) return 'Menekan biaya';
  if (totalDiff === 0) return 'Stabil';
  return Math.abs(toNumber(row.diff_ot)) > Math.abs(toNumber(row.diff_premi))
    ? 'Lembur naik dominan'
    : 'Premi naik dominan';
};

const buildGroupedRows = (rows) => {
  const groups = new Map();

  rows.forEach((row) => {
    const key = row.division_code || row.division_label || '-';
    if (!groups.has(key)) {
      groups.set(key, {
        division_code: row.division_code || '-',
        division_label: row.division_label,
        description: row.description || row.estate || '',
        rows: [],
        gang_count: 0,
        prev_premi: 0,
        curr_premi: 0,
        diff_premi: 0,
        prev_ot: 0,
        curr_ot: 0,
        diff_ot: 0,
        total_diff: 0,
        premi_breakdown: {},
        top_driver: null,
      });
    }

    const group = groups.get(key);
    group.rows.push(row);
    group.gang_count += 1;
    group.prev_premi += toNumber(row.prev_premi);
    group.curr_premi += toNumber(row.curr_premi);
    group.diff_premi += toNumber(row.diff_premi);
    group.prev_ot += toNumber(row.prev_ot);
    group.curr_ot += toNumber(row.curr_ot);
    group.diff_ot += toNumber(row.diff_ot);
    group.total_diff += toNumber(row.total_diff);
    Object.entries(row.premi_breakdown || {}).forEach(([header, value]) => {
      group.premi_breakdown[header] = toNumber(group.premi_breakdown[header]) + toNumber(value);
    });
    group.top_driver = !group.top_driver || row.total_diff > group.top_driver.total_diff
      ? row
      : group.top_driver;
  });

  return Array.from(groups.values());
};

export function buildAnalysisReportInsights({
  rows = [],
  totals = {},
  headers = [],
  breakdownTotals = {},
  topPremiumLimit = 8,
} = {}) {
  const normalizedRows = rows.map((row) => {
    const normalized = {
      ...row,
      division_code: cleanText(row.division_code),
      description: cleanText(row.description || row.estate),
      gang_code: cleanText(row.gang_code || row.division_code),
      gang_description: cleanText(row.gang_description || row.gang_desc),
      prev_premi: toNumber(row.prev_premi),
      curr_premi: toNumber(row.curr_premi),
      diff_premi: toNumber(row.diff_premi),
      prev_ot: toNumber(row.prev_ot),
      curr_ot: toNumber(row.curr_ot),
      diff_ot: toNumber(row.diff_ot),
    };

    normalized.total_diff = normalized.diff_premi + normalized.diff_ot;
    normalized.division_label = getDivisionLabel(normalized);
    normalized.gang_label = getGangLabel(normalized);
    normalized.gang_description_label = getGangDescriptionLabel(normalized);
    normalized.row_key = `${normalized.division_code || '-'}::${normalized.gang_code || '-'}`;
    normalized.insight_label = getInsightLabel(normalized);
    return normalized;
  });

  const allHeaders = resolvePremiumHeaders(headers, breakdownTotals);
  const sortedPremiumHeaders = [...allHeaders].sort(
    (a, b) => toNumber(breakdownTotals[b]) - toNumber(breakdownTotals[a])
  );
  const topHeaders = sortedPremiumHeaders.slice(0, topPremiumLimit);
  const otherHeaders = sortedPremiumHeaders.slice(topPremiumLimit);
  const hasOtherPremiums = otherHeaders.length > 0;
  const printPremiHeaders = hasOtherPremiums ? [...topHeaders, 'LAINNYA'] : topHeaders;
  const otherPremiTotal = otherHeaders.reduce((sum, header) => sum + toNumber(breakdownTotals[header]), 0);

  const groupedRows = buildGroupedRows(normalizedRows);
  const addPrintBreakdown = (row) => {
    const breakdown = row.premi_breakdown || {};
    const printBreakdown = topHeaders.reduce((acc, header) => {
      acc[header] = toNumber(breakdown[header]);
      return acc;
    }, {});

    if (hasOtherPremiums) {
      printBreakdown.LAINNYA = otherHeaders.reduce((sum, header) => sum + toNumber(breakdown[header]), 0);
    }

    return {
      ...row,
      print_breakdown: printBreakdown,
    };
  };

  const printPremiRows = groupedRows.map(addPrintBreakdown);

  const sortedDrivers = [...normalizedRows].sort((a, b) => b.total_diff - a.total_diff);
  const sortedReducers = [...normalizedRows].sort((a, b) => a.total_diff - b.total_diff);

  return {
    rows: normalizedRows,
    groupedRows,
    premiChangePercent: percentChange({
      current: totals.curr_premi,
      previous: totals.prev_premi,
      diff: totals.diff_premi,
    }),
    overtimeChangePercent: percentChange({
      current: totals.curr_ot,
      previous: totals.prev_ot,
      diff: totals.diff_ot,
    }),
    largestCostDriver: maxBy(normalizedRows, (row) => row.total_diff),
    largestCostReducer: minBy(normalizedRows, (row) => row.total_diff),
    largestPremiumDivision: maxBy(normalizedRows, (row) => row.curr_premi),
    largestOvertimeDivision: maxBy(normalizedRows, (row) => row.curr_ot),
    largestPremiumGang: maxBy(normalizedRows, (row) => row.curr_premi),
    largestOvertimeGang: maxBy(normalizedRows, (row) => row.curr_ot),
    topCostDrivers: sortedDrivers.filter((row) => row.total_diff > 0).slice(0, 3),
    topCostReducers: sortedReducers.filter((row) => row.total_diff < 0).slice(0, 3),
    printPremiHeaders,
    printPremiRows,
    otherPremiTotal,
  };
}
