const GENERIC_LEADING_WORDS = new Set([
  'gang',
  'kemandoran',
  'mandor',
  'panen',
  'rawat',
  'rawatan',
  'pruning',
  'prunning',
  'bhl',
  'harian',
  'pemeliharaan',
  'perawatan',
  'maintenance',
  'umum',
  'buah',
  'brondol',
  'angkut',
  'muat',
  'pupuk',
  'semprot',
  'tunas'
]);

function normalizeWords(value) {
  return String(value || '')
    .replace(/[()[\]{}.,;:/\\|_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isGenericWord(word) {
  return GENERIC_LEADING_WORDS.has(String(word || '').toLowerCase());
}

function isMeaningfulWords(words) {
  return words.length > 0 && words.some((word) => !isGenericWord(word));
}

function cleanLeadingGenericWords(words) {
  const cleaned = [...words];
  while (cleaned.length > 1 && isGenericWord(cleaned[0])) {
    cleaned.shift();
  }
  return isMeaningfulWords(cleaned) && !isGenericWord(cleaned[0]) ? cleaned : [];
}

function getDescriptionWords(rows) {
  return rows
    .map((row) => normalizeWords(row?.gang_description || row?.description || ''))
    .filter((words) => isMeaningfulWords(words));
}

function findSharedMeaningfulSuffix(wordLists) {
  if (wordLists.length < 2) return [];

  const suffixes = new Map();
  wordLists.forEach((words, rowIndex) => {
    for (let length = words.length; length >= 1; length -= 1) {
      const suffix = words.slice(words.length - length);
      if (!isMeaningfulWords(suffix) || isGenericWord(suffix[0])) continue;

      const key = suffix.join('\u0000').toLowerCase();
      const existing = suffixes.get(key) || { words: suffix, rows: new Set(), firstRow: rowIndex };
      existing.rows.add(rowIndex);
      suffixes.set(key, existing);
    }
  });

  return Array.from(suffixes.values())
    .filter((item) => item.rows.size >= 2)
    .sort((a, b) => {
      if (b.words.length !== a.words.length) return b.words.length - a.words.length;
      if (b.rows.size !== a.rows.size) return b.rows.size - a.rows.size;
      return a.firstRow - b.firstRow;
    })[0]?.words || [];
}

export function buildGangDescriptionGroupLabel(rows = [], options = {}) {
  const fallbackLabel = options.fallbackLabel || 'Group';
  const wordLists = getDescriptionWords(rows);
  const sharedSuffix = findSharedMeaningfulSuffix(wordLists);

  if (sharedSuffix.length > 0) {
    return sharedSuffix.join(' ');
  }

  const cleaned = cleanLeadingGenericWords(wordLists[0] || []);
  if (cleaned.length > 0) {
    return cleaned.join(' ');
  }

  return fallbackLabel;
}
