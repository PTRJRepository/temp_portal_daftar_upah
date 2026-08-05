function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function roundNumber(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

function percentOf(value, total, decimals = 1) {
  const normalizedTotal = toNumber(total);
  if (normalizedTotal <= 0) return 0;
  return roundNumber((toNumber(value) / normalizedTotal) * 100, decimals);
}

function changePercent(current, previous) {
  const normalizedPrevious = toNumber(previous);
  if (normalizedPrevious <= 0) return 0;
  return roundNumber(((toNumber(current) - normalizedPrevious) / normalizedPrevious) * 100, 1);
}

function byDivisionCode(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const code = String(row?.division_code ?? '').trim();
    if (code) map.set(code, row);
  });
  return map;
}

export function buildExecutiveDivisionRows({ breakdown = [], efficiency = [] } = {}) {
  const sourceRows = Array.isArray(breakdown) ? breakdown : [];
  const efficiencyByDivision = byDivisionCode(efficiency);
  const payrollTotal = sourceRows.reduce((sum, row) => sum + toNumber(row?.total_wage), 0);

  return sourceRows
    .map((row) => {
      const divisionCode = String(row?.division_code ?? '-').trim() || '-';
      const efficiencyRow = efficiencyByDivision.get(divisionCode) || {};
      const totalWage = toNumber(row?.total_wage);
      const overtime = toNumber(row?.total_ot);
      const premi = toNumber(row?.total_premi);
      const headcount = toNumber(row?.headcount ?? efficiencyRow.headcount);
      const totalHk = toNumber(efficiencyRow.total_man_days ?? efficiencyRow.total_hk);

      return {
        divisionCode,
        totalWage,
        baseWage: Math.max(0, totalWage - overtime - premi),
        overtime,
        premi,
        headcount,
        totalHk,
        payrollShare: percentOf(totalWage, payrollTotal, 1),
        overtimeShare: percentOf(overtime, totalWage, 1),
        premiShare: percentOf(premi, totalWage, 1),
        costPerHead: headcount > 0 ? roundNumber(totalWage / headcount, 0) : 0,
        costPerHk: totalHk > 0 ? roundNumber(totalWage / totalHk, 0) : 0
      };
    })
    .sort((a, b) => b.totalWage - a.totalWage);
}

export function buildExecutivePrintSummary({
  kpi = {},
  breakdown = [],
  efficiency = [],
  productivityTrend = [],
  wageSpikes = []
} = {}) {
  const divisionRows = buildExecutiveDivisionRows({ breakdown, efficiency });
  const totalWage = toNumber(kpi?.curr_wage) || divisionRows.reduce((sum, row) => sum + row.totalWage, 0);
  const totalOvertime = toNumber(kpi?.curr_ot) || divisionRows.reduce((sum, row) => sum + row.overtime, 0);
  const headcount = toNumber(kpi?.curr_headcount) || divisionRows.reduce((sum, row) => sum + row.headcount, 0);
  const latestProductivity = Array.isArray(productivityTrend) ? productivityTrend.at(-1) : null;
  const sortedByOvertime = [...divisionRows].sort((a, b) => b.overtime - a.overtime);
  const sortedByCostPerHk = [...divisionRows].filter((row) => row.costPerHk > 0).sort((a, b) => b.costPerHk - a.costPerHk);

  return {
    totalWage,
    totalOvertime,
    headcount,
    wageChange: changePercent(kpi?.curr_wage, kpi?.prev_wage),
    overtimeChange: changePercent(kpi?.curr_ot, kpi?.prev_ot),
    headcountChange: changePercent(kpi?.curr_headcount, kpi?.prev_headcount),
    overtimeShare: percentOf(totalOvertime, totalWage, 1),
    latestCostPerHk: roundNumber(latestProductivity?.costPerHk, 0),
    alertCount: Array.isArray(wageSpikes) ? wageSpikes.length : 0,
    largestPayrollDivision: divisionRows[0] || null,
    largestOvertimeDivision: sortedByOvertime[0] || null,
    highestCostPerHkDivision: sortedByCostPerHk[0] || null
  };
}

export function buildExecutiveTrendRows({ trends = [], productivityTrend = [] } = {}) {
  const productivityByPeriod = new Map(
    (Array.isArray(productivityTrend) ? productivityTrend : []).map((row) => [row?.period, row])
  );

  return (Array.isArray(trends) ? trends : [])
    .slice(-12)
    .map((row) => {
      const period = row?.period || '-';
      const totalWage = toNumber(row?.total_wage);
      const overtime = toNumber(row?.total_ot);
      const totalHk = toNumber(row?.total_hk);
      const productivityRow = productivityByPeriod.get(period);

      return {
        period,
        totalWage,
        overtime,
        premi: toNumber(row?.total_premi),
        totalHk,
        headcount: toNumber(row?.total_headcount),
        overtimeShare: percentOf(overtime, totalWage, 1),
        costPerHk: productivityRow ? roundNumber(productivityRow.costPerHk, 0) : (totalHk > 0 ? roundNumber(totalWage / totalHk, 0) : 0)
      };
    });
}

export function buildExecutiveAlertRows(wageSpikes = [], limit = 5) {
  return (Array.isArray(wageSpikes) ? wageSpikes : [])
    .map((row) => {
      const gangCode = String(row?.id ?? row?.gang_code ?? '-').trim() || '-';

      return {
        gangCode,
        label: row?.name || row?.gang || gangCode,
        increasePercent: roundNumber(row?.percentage, 1),
        currentCostPerHk: roundNumber(row?.currentWage, 0),
        previousCostPerHk: roundNumber(row?.previousWage, 0),
        difference: roundNumber(row?.difference, 0)
      };
    })
    .sort((a, b) => b.increasePercent - a.increasePercent)
    .slice(0, limit);
}
