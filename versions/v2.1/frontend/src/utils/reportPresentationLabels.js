export function getReportModeLabel({ comparisonMode = false, thrMode = false } = {}) {
  if (thrMode) return 'THR';
  if (comparisonMode) return 'Perbandingan';
  return 'Standar';
}

export function getSourceModeLabel({ useHistory = false, sourceMode = '' } = {}) {
  const explicitSource = String(sourceMode || '').trim();
  if (explicitSource) return explicitSource;
  return useHistory ? 'History DB' : 'Origin DB';
}

export function getDivisionTypeLabel(divisionType = 'all') {
  const normalized = String(divisionType || '').trim().toLowerCase();
  if (normalized === 'real') return 'Real Only';
  if (normalized === 'virtual') return 'Virtual Only';
  return 'Real + Virtual';
}
