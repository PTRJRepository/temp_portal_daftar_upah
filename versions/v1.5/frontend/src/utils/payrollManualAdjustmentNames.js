const CANONICAL_PREFIX = {
  PREMI: 'PREMI',
  'POTONGAN UPAH KOTOR': 'KOREKSI',
  'POTONGAN UPAH BERSIH': 'POTONGAN LAINNYA',
};

const FIELD_PREFIX_BY_GROUP = {
  PREMI: 'premi',
  'POTONGAN UPAH KOTOR': 'koreksi',
  'POTONGAN UPAH BERSIH': 'potongan_lainnya',
};

const TYPE_BY_GROUP = {
  PREMI: 'PREMI',
  'POTONGAN UPAH KOTOR': 'POTONGAN_KOTOR',
  'POTONGAN UPAH BERSIH': 'POTONGAN_BERSIH',
};

const LEGACY_PREMIUM_ALIASES = {
  'CUCI MOBIL': 'PREMI CUCI MOBIL',
  'PREMI CUCI MOBIL': 'PREMI CUCI MOBIL',
  JARAK: 'PREMI JARAK',
  'PREMI JARAK': 'PREMI JARAK',
  'PREMI EXISTING': 'PREMI EXISTING',
};

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeCanonicalPrefix(name, canonicalPrefix) {
  if (!name || !canonicalPrefix) return '';
  return String(name)
    .replace(new RegExp(`^${escapeRegExp(canonicalPrefix)}(?:\\s+|$)`, 'i'), '')
    .trim();
}

function normalizeIdentity(input) {
  return String(input ?? '').trim();
}

export function sanitizeManualAdjustmentLabel(input) {
  return String(input || '')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCanonicalManualAdjustmentName(groupLabel, rawName) {
  const canonicalPrefix = CANONICAL_PREFIX[groupLabel];
  const cleanedName = sanitizeManualAdjustmentLabel(rawName).toUpperCase();

  if (!canonicalPrefix || !cleanedName) return '';

  const suffix = removeCanonicalPrefix(cleanedName, canonicalPrefix);
  if (!suffix) return canonicalPrefix;
  return `${canonicalPrefix} ${suffix}`.trim();
}

function normalizePremiumDefinitionName(input) {
  return sanitizeManualAdjustmentLabel(input)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutPremiPrefix(input) {
  return normalizePremiumDefinitionName(input).replace(/^PREMI(?:\s+|$)/, '').trim();
}

function findDefinitionByName(definitions, targetName) {
  const normalizedTarget = normalizePremiumDefinitionName(targetName);
  if (!normalizedTarget) return null;

  return (definitions || []).find((definition) => (
    normalizePremiumDefinitionName(definition?.adjustment_name) === normalizedTarget
  )) || null;
}

export function resolvePremiumDefinitionForAdjustment({ label, canonicalName, definitions, remarks } = {}) {
  const activeDefinitions = (definitions || []).filter((definition) =>
    definition?.is_active !== false && (!definition?.adjustment_type || definition.adjustment_type === 'PREMI')
  );
  const candidates = [
    canonicalName,
    buildCanonicalManualAdjustmentName('PREMI', label),
    label,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const exact = findDefinitionByName(activeDefinitions, candidate);
    if (exact) return { definition: exact, adjustmentName: exact.adjustment_name };
  }

  const normalizedCandidates = new Set(candidates.flatMap((candidate) => [
    normalizePremiumDefinitionName(candidate),
    withoutPremiPrefix(candidate),
  ]));

  for (const candidate of normalizedCandidates) {
    const aliasTarget = LEGACY_PREMIUM_ALIASES[candidate];
    const aliasDefinition = findDefinitionByName(activeDefinitions, aliasTarget);
    if (aliasDefinition) return { definition: aliasDefinition, adjustmentName: aliasDefinition.adjustment_name };
  }

  for (const definition of activeDefinitions) {
    const definitionName = normalizePremiumDefinitionName(definition?.adjustment_name);
    const definitionSuffix = withoutPremiPrefix(definitionName);
    if (normalizedCandidates.has(definitionName) || normalizedCandidates.has(definitionSuffix)) {
      return { definition, adjustmentName: definition.adjustment_name };
    }
  }

  const normalizedRemarks = normalizePremiumDefinitionName(remarks);
  if (normalizedRemarks) {
    for (const definition of activeDefinitions) {
      const definitionName = normalizePremiumDefinitionName(definition?.adjustment_name);
      const taskDesc = normalizePremiumDefinitionName(definition?.task_desc || definition?.ad_code);
      if ((definitionName && normalizedRemarks.includes(definitionName)) || (taskDesc && normalizedRemarks.includes(taskDesc))) {
        return { definition, adjustmentName: definition.adjustment_name };
      }
    }
  }

  return { definition: null, adjustmentName: canonicalName || buildCanonicalManualAdjustmentName('PREMI', label) };
}

function toSnakeCase(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildPendingManualColumn({ groupLabel, rawName, division, firstEmployee }) {
  const canonicalPrefix = CANONICAL_PREFIX[groupLabel];
  const adjustmentName = buildCanonicalManualAdjustmentName(groupLabel, rawName);
  const fieldPrefix = FIELD_PREFIX_BY_GROUP[groupLabel];
  const adjustmentType = TYPE_BY_GROUP[groupLabel];
  const fieldSuffix = toSnakeCase(removeCanonicalPrefix(adjustmentName, canonicalPrefix));
  const nik = normalizeIdentity(firstEmployee?.nik);
  const gangCode = normalizeIdentity(firstEmployee?.gang_code);
  const empCode = normalizeIdentity(firstEmployee?.emp_code) || nik;
  const empName = normalizeIdentity(firstEmployee?.nama) || normalizeIdentity(firstEmployee?.emp_name);

  if (!adjustmentName || !fieldPrefix || !adjustmentType || !fieldSuffix || !nik || !gangCode) {
    return null;
  }

  const payload = {
    division_code: division,
    type: adjustmentType,
    name: adjustmentName,
  };

  if (nik) payload.nik = nik;
  if (empCode) payload.emp_code = empCode;
  if (empName) payload.emp_name = empName;
  if (gangCode) payload.gang_code = gangCode;

  return {
    fieldName: `${fieldPrefix}_${fieldSuffix}`,
    adjustmentType,
    adjustmentName,
    activeFieldBucket: groupLabel === 'PREMI' ? 'premi' : 'potongan',
    payload,
  };
}

function resolveColumnCode(column, key) {
  return normalizeIdentity(column?.[key]);
}

function buildPlaceholderRemarks(column) {
  const name = normalizeIdentity(column?.name);
  const adCode = resolveColumnCode(column, 'ad_code')
    || resolveColumnCode(column, 'base_task_code')
    || resolveColumnCode(column, 'task_code');
  const taskDesc = normalizeIdentity(column?.task_desc);
  const adCodePart = adCode ? `${adCode}${taskDesc ? ` - ${taskDesc}` : ''}` : 'MANUAL EDIT';

  return `${name} | ${adCodePart} | 0 | sync:MISS | match:MISMATCH | INIT_COLUMN`;
}

function buildPlaceholderMetadata(inputType, gangCode) {
  const normalizedInputType = normalizeIdentity(inputType).toLowerCase();
  if (!normalizedInputType || normalizedInputType === 'amount') return undefined;

  if (normalizedInputType === 'blok') {
    return {
      input_type: 'blok',
      items: [{ subblok: '', gang_code: gangCode || '', jumlah: 0 }],
      total_amount: 0,
    };
  }

  if (normalizedInputType === 'kendaraan') {
    return {
      input_type: 'kendaraan',
      items: [{ nomor_kendaraan: '', expense_code: '', jumlah: 0 }],
      total_amount: 0,
    };
  }

  if (normalizedInputType === 'exp') {
    return {
      input_type: 'exp',
      expense_code: '',
      jumlah: 0,
      total_amount: 0,
    };
  }

  if (normalizedInputType === 'blok,exp') {
    return {
      input_type: 'blok,exp',
      blok_items: [{ subblok: '', gang_code: gangCode || '', jumlah: 0 }],
      expense: { expense_code: '', jumlah: 0 },
      total_amount: 0,
    };
  }

  return undefined;
}

export function buildManualColumnPlaceholderPayload({ month, year, division, column }) {
  const empCode = normalizeIdentity(column?.emp_code) || normalizeIdentity(column?.nik);
  const nik = normalizeIdentity(column?.nik);
  const gangCode = normalizeIdentity(column?.gang_code);
  const adjustmentType = normalizeIdentity(column?.type);
  const adjustmentName = normalizeIdentity(column?.name);

  if (!month || !year || !empCode || !nik || !gangCode || !adjustmentType || !adjustmentName) {
    return null;
  }

  const adCode = resolveColumnCode(column, 'ad_code');
  const taskCode = resolveColumnCode(column, 'task_code');
  const baseTaskCode = resolveColumnCode(column, 'base_task_code');
  const taskDesc = normalizeIdentity(column?.task_desc);
  const placeholderMetadata = buildPlaceholderMetadata(column?.input_type, gangCode);

  const payload = {
    period_month: Number(month),
    period_year: Number(year),
    nik,
    emp_code: empCode,
    emp_name: normalizeIdentity(column?.emp_name) || null,
    gang_code: gangCode,
    division_code: division,
    adjustment_type: adjustmentType,
    adjustment_name: adjustmentName,
    amount: 0,
    remarks: normalizeIdentity(column?.remarks) || buildPlaceholderRemarks(column),
    ad_code: adCode || undefined,
    task_code: taskCode || undefined,
    base_task_code: baseTaskCode || undefined,
    task_desc: taskDesc || undefined,
  };

  if (placeholderMetadata) {
    payload.metadata_json = JSON.stringify(placeholderMetadata);
  }

  return payload;
}
