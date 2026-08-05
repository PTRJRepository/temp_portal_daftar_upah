const CANONICAL_DIVISION_CODES = Object.freeze({
  P1A: 'PG1A',
  PG1A: 'PG1A',
  P1B: 'PG1B',
  PG1B: 'PG1B',
  P2A: 'PG2A',
  PG2A: 'PG2A',
  P2B: 'PG2B',
  PG2B: 'PG2B',
  ARB1: 'AB1',
  AB1: 'AB1',
  ARB2: 'AB2',
  AB2: 'AB2',
  AREC: 'ARC',
  ARC: 'ARC',
  INFRA: 'INF',
  INF: 'INF',
});

const DIVISION_SHORT_DESCRIPTIONS = Object.freeze({
  PG1A: 'Parit Gunung 1A',
  PG1B: 'Parit Gunung 1B',
  PG2A: 'Parit Gunung 2A',
  PG2B: 'Parit Gunung 2B',
  PGE: 'Parit Gunung Energi',
  AB1: 'Air Ruak 1',
  AB2: 'Air Ruak 2',
  ARA: 'Area',
  ARC: 'Air Ruak Central',
  DME: 'Darrur Makmur Estate',
  IJL: 'Impian Jaya Lestari',
  INF: 'Infrastruktur',
  NRS: 'Nursery',
  WKS_PG: 'Workshop Parit Gunung',
  WKS_AR: 'Workshop Air Ruak',
  WORKSHOP: 'Workshop',
  MILL: 'Palm Oil Mill',
  SECURITY: 'Security',
  'STF-OFFICE': 'Staff Office',
});

function normalizeDivisionCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return '';
  return CANONICAL_DIVISION_CODES[normalized] || normalized;
}

function cleanDescription(description) {
  const cleaned = String(description || '').trim();
  if (!cleaned) return '';
  return cleaned.split(/\s+-\s+/)[0].trim();
}

export function getDivisionShortDescription(code, description = '') {
  const canonical = normalizeDivisionCode(code);
  if (!canonical || canonical === 'ALL') return '';
  return DIVISION_SHORT_DESCRIPTIONS[canonical] || cleanDescription(description);
}

export function getDivisionDisplayLabel(code, description = '') {
  const canonical = normalizeDivisionCode(code);
  if (!canonical) return '';

  const shortDescription = getDivisionShortDescription(canonical, description);
  if (!shortDescription || shortDescription.toUpperCase() === canonical) {
    return canonical;
  }

  return `${canonical} - ${shortDescription}`;
}

export function getReportDivisionSummary({ division = '', divisionType = 'all', rows = [] } = {}) {
  const canonical = normalizeDivisionCode(division);
  if (canonical && canonical !== 'ALL') {
    return getDivisionDisplayLabel(canonical);
  }

  const uniqueDivisions = new Set();
  if (Array.isArray(rows)) {
    rows.forEach((row) => {
      if (row?.is_grand_total || row?.is_subtotal) return;
      const rowCode = normalizeDivisionCode(row?.division_code || row?.division || row?.loc_code);
      if (rowCode && rowCode !== 'ALL' && rowCode !== 'GRAND') {
        uniqueDivisions.add(rowCode);
      }
    });
  }

  const normalizedType = String(divisionType || 'all').trim().toLowerCase();
  const scopeLabel = normalizedType === 'virtual'
    ? 'Semua divisi virtual'
    : normalizedType === 'real'
      ? 'Semua divisi utama'
      : 'Semua divisi tersedia';

  return uniqueDivisions.size > 0
    ? `ALL - ${scopeLabel} (${uniqueDivisions.size} divisi)`
    : `ALL - ${scopeLabel}`;
}
