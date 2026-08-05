const KNOWN_TUNJANGAN_KEYS = new Set([
  'tunjangan_beras',
  'tunjangan_jabatan',
  'tunjangan_masa_kerja',
  'tunjangan_lembur',
  'total_tunjangan',
]);

const KNOWN_PREMI_KEYS = new Set([
  'premi_brondol',
  'premi_pph',
  'total_premi',
]);

export function toEmployeePayrollNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/,/g, '');
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

const deductionMagnitude = (value) => Math.abs(toEmployeePayrollNumber(value));

function titleizeKey(key, prefixToRemove = '') {
  const base = prefixToRemove && key.startsWith(prefixToRemove)
    ? key.slice(prefixToRemove.length)
    : key;
  return base
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizePremiLabel(detail) {
  const docDesc = String(detail?.doc_desc || '').trim();
  if (docDesc) {
    return /premi/i.test(docDesc) ? docDesc : `Premi ${docDesc}`;
  }

  const normalizedKey = String(detail?.normalized_key || '').trim();
  if (!normalizedKey) return 'Premi';
  const pretty = titleizeKey(normalizedKey, normalizedKey.startsWith('premi_') ? 'premi_' : '');
  return /premi/i.test(pretty) ? pretty : `Premi ${pretty}`;
}

function buildStaticTunjanganList(getNum) {
  return [
    { label: 'Tunjangan Beras', value: getNum('beras_jumlah') || getNum('tunjangan_beras') },
    { label: 'Tunjangan Jabatan', value: getNum('jabatan_jumlah') || getNum('tunjangan_jabatan') },
    { label: 'Tunjangan Masa Kerja', value: getNum('masa_kerja_jumlah') || getNum('tunjangan_masa_kerja') },
    { label: 'Tunjangan Lembur', value: getNum('tunjangan_lembur') },
  ].filter((item) => item.value > 0);
}

function buildDynamicTunjanganList(data) {
  return Object.entries(data || {})
    .filter(([key, value]) => (
      key.startsWith('tunjangan_')
      && !KNOWN_TUNJANGAN_KEYS.has(key)
      && toEmployeePayrollNumber(value) > 0
    ))
    .map(([key, value]) => ({
      label: `Tunjangan ${titleizeKey(key, 'tunjangan_')}`,
      value: toEmployeePayrollNumber(value),
    }));
}

function buildPremiList(data, getNum) {
  const premiList = [];
  const processedPremiKeys = new Set();

  if (getNum('premi_brondol') > 0) {
    premiList.push({ label: 'Premi Brondol', value: getNum('premi_brondol') });
    processedPremiKeys.add('premi_brondol');
    processedPremiKeys.add('brondol');
  }

  if (getNum('premi_pph') > 0) {
    premiList.push({ label: 'Premi PPH', value: getNum('premi_pph') });
    processedPremiKeys.add('premi_pph');
  }

  const premiDetails = Array.isArray(data?.premi_details) ? data.premi_details : [];
  premiDetails.forEach((detail) => {
    const amount = toEmployeePayrollNumber(detail?.amount);
    if (amount <= 0) return;

    const normalizedKey = String(detail?.normalized_key || '').trim();
    if (normalizedKey) {
      processedPremiKeys.add(normalizedKey);
    }

    premiList.push({
      label: normalizePremiLabel(detail),
      value: amount,
      task_code: detail?.task_code,
      task_desc: detail?.task_desc,
      doc_desc: detail?.doc_desc,
    });
  });

  if (data?.premi && typeof data.premi === 'object' && !Array.isArray(data.premi)) {
    Object.entries(data.premi).forEach(([key, value]) => {
      const amount = toEmployeePayrollNumber(value);
      if (amount <= 0 || processedPremiKeys.has(key) || key === 'koreksi') return;

      const label = key === 'brondol'
        ? 'Premi Brondol'
        : `Premi ${titleizeKey(key, key.startsWith('premi_') ? 'premi_' : '')}`;

      if (!premiList.some((item) => item.label.toLowerCase() === label.toLowerCase())) {
        premiList.push({ label, value: amount });
      }
    });
  }

  Object.entries(data || {}).forEach(([key, value]) => {
    const amount = toEmployeePayrollNumber(value);
    if (
      !key.startsWith('premi_')
      || KNOWN_PREMI_KEYS.has(key)
      || processedPremiKeys.has(key)
      || amount <= 0
    ) {
      return;
    }

    const label = `Premi ${titleizeKey(key, 'premi_')}`;
    if (!premiList.some((item) => item.label.toLowerCase() === label.toLowerCase())) {
      premiList.push({ label, value: amount });
    }
  });

  return premiList;
}

function buildOtherIncomeList(data, getNum) {
  const directItems = [];
  const seen = new Set();

  const pushItem = (label, amount, type = null) => {
    const value = toEmployeePayrollNumber(amount);
    if (value <= 0) return;
    const key = `${type || label}:${label}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    directItems.push({ label, value, type });
  };

  pushItem('THR', getNum('pendapatan_thr'), 'THR');
  pushItem('Bonus', getNum('pendapatan_bonus'), 'BONUS');
  pushItem('Custom', getNum('pendapatan_custom'), 'CUSTOM');

  if (Array.isArray(data?.other_incomes)) {
    data.other_incomes.forEach((income) => {
      const type = String(income?.type || '').trim().toUpperCase() || null;
      const label = String(income?.name || income?.income_name || type || 'Pendapatan Lainnya').trim();
      pushItem(label, income?.amount, type);
    });
  }

  const total = getNum('total_pendapatan_lainnya') || getNum('pendapatan_lainnya');

  if (directItems.length === 0 && total > 0) {
    directItems.push({ label: 'Pendapatan Lainnya', value: total, type: null });
  }

  return {
    items: directItems,
    total,
  };
}

export function buildEmployeePayrollBreakdown(data = {}, empInfo = {}) {
  const getNum = (key) => toEmployeePayrollNumber(data?.[key] ?? empInfo?.[key]);

  const tunjanganList = [
    ...buildStaticTunjanganList(getNum),
    ...buildDynamicTunjanganList(data),
  ];

  const premiList = buildPremiList(data, getNum);
  const otherIncome = buildOtherIncomeList(data, getNum);

  const potKotorList = [];
  if (deductionMagnitude(data?.pot_koreksi ?? empInfo?.pot_koreksi) > 0) {
    potKotorList.push({ label: 'Koreksi', value: deductionMagnitude(data?.pot_koreksi ?? empInfo?.pot_koreksi) });
  }

  Object.entries(data || {}).forEach(([key, value]) => {
    const amount = deductionMagnitude(value);
    if (key.startsWith('koreksi_') && amount > 0) {
      potKotorList.push({ label: `Koreksi ${titleizeKey(key, 'koreksi_')}`, value: amount });
    }
  });

  const potBersihList = [
    { label: 'BPJS Kesehatan', value: deductionMagnitude(data?.pot_bpjs_kesehatan_pekerja ?? empInfo?.pot_bpjs_kesehatan_pekerja) || deductionMagnitude(data?.pot_bpjs_kesehatan ?? empInfo?.pot_bpjs_kesehatan) },
    { label: 'BPJS Pensiun', value: deductionMagnitude(data?.pot_bpjs_pensiun_pekerja ?? empInfo?.pot_bpjs_pensiun_pekerja) || deductionMagnitude(data?.pot_bpjs_pensiun ?? empInfo?.pot_bpjs_pensiun) },
    { label: 'Astek Pekerja', value: deductionMagnitude(data?.pot_astek_pekerja ?? empInfo?.pot_astek_pekerja) || deductionMagnitude(data?.pot_astek ?? empInfo?.pot_astek) },
    { label: 'SPSI', value: deductionMagnitude(data?.pot_spsi ?? empInfo?.pot_spsi) },
    { label: 'PPh 21', value: deductionMagnitude(data?.pot_pph21 ?? empInfo?.pot_pph21) || deductionMagnitude(data?.pph21_ter ?? empInfo?.pph21_ter) },
  ].filter((item) => item.value > 0);

  const standardPotKeys = new Set([
    'pot_bpjs_kesehatan_pekerja',
    'pot_bpjs_kesehatan',
    'pot_bpjs_pensiun_pekerja',
    'pot_bpjs_pensiun',
    'pot_astek',
    'pot_astek_pekerja',
    'pot_astek_majikan',
    'pot_astek_jumlah',
    'pot_spsi',
    'pot_pph21',
    'pot_koreksi',
    'potongan_upah_kotor_total',
    'total_potongan',
    'pot_bpjs_kesehatan_majikan',
    'pot_bpjs_pensiun_majikan',
    'pendapatan_lainnya',
    'total_pendapatan_lainnya',
  ]);

  Object.entries(data || {}).forEach(([key, value]) => {
    const amount = deductionMagnitude(value);
    if (key.startsWith('pot_') && !standardPotKeys.has(key) && !key.includes('total') && !key.includes('majikan') && !key.includes('jumlah') && amount > 0) {
      potBersihList.push({ label: titleizeKey(key, 'pot_'), value: amount });
    }
  });

  const otherIncomeDeductionList = otherIncome.items.map((item) => ({
    ...item,
    label: item.type ? `${item.label} (${item.type})` : item.label,
    value: item.value,
  }));

  return {
    getNum,
    hk: getNum('hari_kerja') || getNum('jumlah_hk'),
    rate: getNum('upah_dasar') || getNum('upah_harian'),
    gajiPokok: getNum('gaji_pokok') || getNum('upah_pokok') || ((getNum('hari_kerja') || getNum('jumlah_hk')) * (getNum('upah_dasar') || getNum('upah_harian'))),
    tunjanganList,
    premiList,
    otherIncomeList: otherIncome.items,
    otherIncomeDeductionList,
    totalOtherIncome: otherIncome.total,
    totalPremi: getNum('total_premi'),
    lemburJam: getNum('lembur_jam') || getNum('total_jam_lembur'),
    lemburJumlah: getNum('lembur_jumlah') || getNum('total_upah_lembur') || getNum('upah_lembur'),
    potKotorList,
    totalPotKotor: deductionMagnitude(data?.potongan_upah_kotor_total ?? empInfo?.potongan_upah_kotor_total) || potKotorList.reduce((sum, item) => sum + item.value, 0),
    potBersihList,
    totalPotongan: deductionMagnitude(data?.total_potongan ?? empInfo?.total_potongan) || (
      potKotorList.reduce((sum, item) => sum + item.value, 0)
      + potBersihList.reduce((sum, item) => sum + item.value, 0)
    ),
    jumlahUpahKotor: getNum('jumlah_upah_kotor') || getNum('penghasilan_bruto'),
    upahBersih: getNum('upah_bersih'),
  };
}
