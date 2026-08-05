import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const MONTH_NAMES = [
  '',
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'Oktober',
  'November',
  'Desember'
];

const CARD_WIDTH = 4;
const CARD_HEIGHT = 32;
const CARD_COL_GAP = 1;
const CARD_ROW_GAP = 2;
const CARDS_PER_PAGE = 4;

const borderThin = { style: 'thin', color: { argb: '111827' } };
const borderHair = { style: 'hair', color: { argb: '9CA3AF' } };
const borderDotted = { style: 'dotted', color: { argb: '6B7280' } };
const fillBlack = { type: 'pattern', pattern: 'solid', fgColor: { argb: '111827' } };
const fillHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E5E7EB' } };
const fillPanel = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatCurrency = (value) => Math.round(toFiniteNumber(value));

const getNum = (payroll, employee, key) => toFiniteNumber(payroll?.[key] ?? employee?.[key]);

const deductionAmount = (value) => Math.abs(toFiniteNumber(value));

const sumPositiveFields = (source, predicate) => Object.entries(source || {}).reduce((sum, [key, val]) => {
  if (!predicate(key)) return sum;
  const amount = deductionAmount(val);
  return amount > 0 ? sum + amount : sum;
}, 0);

function getKoreksiBrondolTotal(payroll) {
  return Object.entries(payroll || {}).reduce((sum, [key, val]) => {
    const normalizedKey = key.toLowerCase().replace(/berondol/g, 'brondol');
    if (!normalizedKey.startsWith('koreksi_') || !normalizedKey.includes('brondol')) return sum;
    return sum + Math.abs(toFiniteNumber(val));
  }, 0);
}

function buildPayslipModel(item, month, year) {
  const payroll = item?.payroll_data || {};
  const employee = item?.employee || {};
  const attendance = item?.attendance || {};
  const empCode = item?.emp_code || payroll.emp_code || payroll.nik || '';
  const hk = getNum(payroll, employee, 'jumlah_hk') || getNum(payroll, employee, 'hari_kerja');
  const rate = getNum(payroll, employee, 'upah_dasar') || getNum(payroll, employee, 'upah_harian');
  const gajiPokok = getNum(payroll, employee, 'gaji_pokok') || getNum(payroll, employee, 'upah_pokok') || hk * rate;
  const attHadir = attendance.summary?.total_hadir ?? payroll.hari_kerja ?? payroll.kehadiran ?? 0;
  const attMgg = attendance.summary?.cuti_minggu ?? payroll.cuti_minggu_hari ?? 0;
  const attCuti = attendance.summary?.cuti_tahunan ?? payroll.cuti_tahunan_hari ?? 0;
  const attSakit = attendance.summary?.cuti_sakit ?? payroll.cuti_sakit_haid_hari ?? 0;
  const attLibur = attendance.summary?.libur ?? payroll.cuti_nasional_hari ?? 0;
  const koreksiBrondolTotal = getKoreksiBrondolTotal(payroll);

  const incomeLines = [
    { kind: 'header', label: 'Gaji Pokok' },
    ...[
      ['Kehadiran', attHadir],
      ['Minggu', attMgg],
      ['Cuti', attCuti],
      ['Sakit', attSakit],
      ['Libur Nas', attLibur]
    ].filter(([, days]) => toFiniteNumber(days) > 0).map(([label, days]) => ({
      label: `- ${label} (${days} hr)`,
      value: days * rate
    })),
    { label: 'Subtotal Gaji Pokok', value: gajiPokok, bold: true, top: true }
  ];

  const tunjanganList = [
    ['Beras', getNum(payroll, employee, 'beras_jumlah') || getNum(payroll, employee, 'tunjangan_beras')],
    ['Jabatan', getNum(payroll, employee, 'jabatan_jumlah') || getNum(payroll, employee, 'tunjangan_jabatan')],
    ['Masa Kerja', getNum(payroll, employee, 'masa_kerja_jumlah') || getNum(payroll, employee, 'tunjangan_masa_kerja')]
  ].filter(([, value]) => value > 0).map(([label, value]) => ({ label, value }));
  const totalTunjangan = tunjanganList.reduce((sum, item) => sum + item.value, 0);
  if (tunjanganList.length > 0) {
    incomeLines.push({ kind: 'header', label: 'Tunjangan' });
    tunjanganList.forEach((item) => incomeLines.push({ label: `- ${item.label}`, value: item.value }));
    incomeLines.push({ label: 'Subtotal Tunjangan', value: totalTunjangan, bold: true, top: true });
  }

  const premiList = [];
  const premiBrondolBase = getNum(payroll, employee, 'premi_brondol') || toFiniteNumber(payroll.premi?.brondol);
  const premiBrondolDisplay = Math.max(0, premiBrondolBase - koreksiBrondolTotal);
  if (premiBrondolDisplay > 0) premiList.push({ label: 'Brondol', value: premiBrondolDisplay });
  if (payroll.premi && typeof payroll.premi === 'object') {
    Object.entries(payroll.premi).forEach(([key, val]) => {
      if (key !== 'brondol' && key !== 'koreksi' && toFiniteNumber(val) > 0) {
        premiList.push({ label: key.replace(/premi_/i, '').replace(/_/g, ' ').toUpperCase(), value: toFiniteNumber(val) });
      }
    });
  } else {
    Object.entries(payroll).forEach(([key, val]) => {
      if (key.startsWith('premi_') && key !== 'premi_brondol' && key !== 'premi_pph' && toFiniteNumber(val) > 0) {
        premiList.push({ label: key.replace('premi_', '').replace(/_/g, ' ').toUpperCase(), value: toFiniteNumber(val) });
      }
    });
  }
  const totalPremi = Math.max(0, getNum(payroll, employee, 'total_premi') - koreksiBrondolTotal);
  const totalPremiDetail = premiList.reduce((sum, item) => sum + item.value, 0);
  const displayedTotalPremi = totalPremi > 0 ? totalPremi : totalPremiDetail;
  if (premiList.length > 0) {
    incomeLines.push({ kind: 'header', label: 'Premi' });
    premiList.forEach((item) => incomeLines.push({ label: `- ${item.label}`, value: item.value }));
    incomeLines.push({ label: 'Subtotal Premi', value: displayedTotalPremi, bold: true, top: true });
  }

  const lemburJam = getNum(payroll, employee, 'lembur_jam') || getNum(payroll, employee, 'total_jam_lembur');
  const lemburJumlah = getNum(payroll, employee, 'lembur_jumlah') || getNum(payroll, employee, 'total_upah_lembur') || getNum(payroll, employee, 'upah_lembur');
  if (lemburJumlah > 0) incomeLines.push({ label: `Lembur (${lemburJam}j)`, value: lemburJumlah, bold: true });

  const dynamicKoreksiTotal = sumPositiveFields(payroll, (key) => {
    const normalizedKey = key.toLowerCase().replace(/berondol/g, 'brondol');
    return key.startsWith('koreksi_') && key !== 'koreksi_hk' && !normalizedKey.includes('brondol');
  });
  // Guardrail: payslip math uses deduction magnitudes only. Never subtract raw signed
  // values; `gross - (-200)` would increase take-home pay and invalidate the slip.
  const totalPotKotor = Math.max(0, deductionAmount(getNum(payroll, employee, 'potongan_upah_kotor_total')) - koreksiBrondolTotal) ||
    Math.max(0, deductionAmount(getNum(payroll, employee, 'pot_koreksi')) - koreksiBrondolTotal) ||
    dynamicKoreksiTotal;
  if (totalPotKotor > 0) incomeLines.push({ label: 'Koreksi Pendapatan (-)', value: totalPotKotor, bold: true });

  const totalOtherIncome = getNum(payroll, employee, 'total_pendapatan_lainnya') || getNum(payroll, employee, 'pendapatan_lainnya');
  const jumlahUpahKotor = getNum(payroll, employee, 'jumlah_upah_kotor') || getNum(payroll, employee, 'penghasilan_bruto');
  const payslipGrossIncome = Math.max(0, jumlahUpahKotor - totalOtherIncome);
  incomeLines.push({ label: 'TOTAL PENDAPATAN KOTOR', value: payslipGrossIncome, bold: true, total: true });

  const deductions = [
    ['BPJS Kes (1%)', deductionAmount(getNum(payroll, employee, 'pot_bpjs_kesehatan_pekerja') || getNum(payroll, employee, 'pot_bpjs_kesehatan'))],
    ['BPJS Pens (1%)', deductionAmount(getNum(payroll, employee, 'pot_bpjs_pensiun_pekerja') || getNum(payroll, employee, 'pot_bpjs_pensiun'))],
    ['Astek (2%)', deductionAmount(getNum(payroll, employee, 'pot_astek_pekerja') || getNum(payroll, employee, 'pot_astek') || getNum(payroll, employee, 'pot_jht'))],
    ['SPSI', deductionAmount(getNum(payroll, employee, 'pot_spsi'))],
    ['PPh 21', deductionAmount(getNum(payroll, employee, 'pot_pph21') || getNum(payroll, employee, 'pph21_ter'))],
    ['Potongan PPh21', deductionAmount(getNum(payroll, employee, 'POTONGAN_PPH21'))]
  ].filter(([, value]) => value > 0).map(([label, value]) => ({ label: `- ${label}`, value }));
  Object.entries(payroll).forEach(([key, val]) => {
    const normalizedKey = key.toLowerCase();
    if (key === 'potongan_upah_kotor_total' || key.startsWith('potongan_upah_kotor') || normalizedKey.includes('pendapatan_lain')) return;
    if (!key.startsWith('potongan_') || deductionAmount(val) <= 0) return;
    const label = key.replace('potongan_', '').replace(/_/g, ' ').toUpperCase();
    const isDuplicate = ['PPJK', 'BPJS', 'ASTEK', 'SPSI', 'PPH21'].some((part) => label.includes(part));
    if (!isDuplicate && !deductions.some((item) => item.label.toUpperCase().includes(label))) deductions.push({ label: `- ${label}`, value: deductionAmount(val) });
  });
  const premiPph = getNum(payroll, employee, 'premi_pph') || getNum(payroll, employee, 'PREMI_PPH');
  if (premiPph > 0) deductions.push({ label: '+ Premi PPh', value: premiPph, credit: true });
  const totalPotongan = deductions.reduce((sum, item) => sum + (item.credit ? -item.value : item.value), 0);
  const upahBersih = payslipGrossIncome - totalPotongan;

  return {
    empCode,
    name: employee.nama || employee.EmpName || payroll.nama || payroll.emp_name || '-',
    jabatan: employee.jabatan || payroll.jabatan_estate || payroll.task_desc || payroll.jabatan || '-',
    gang: employee.gang_code || employee.GangCode || payroll.gang_code || payroll.GangCode || '-',
    ptkp: `${payroll.status_ptkp || '-'} (${payroll.kategori_ter || '-'})`,
    hk,
    rate,
    period: `${MONTH_NAMES[month] || ''} ${year || ''}`.trim(),
    activity: lemburJam > 0 ? `HK: ${hk || 0} | Lembur: ${lemburJam}j = ${formatCurrency(lemburJumlah)}` : `HK: ${hk || 0}`,
    incomeLines,
    deductionLines: [{ kind: 'header', label: 'Pot. Upah Bersih' }, ...deductions, { label: 'TOTAL POTONGAN', value: totalPotongan, bold: true, total: true }],
    upahBersih
  };
}

function styleCardCell(cell) {
  cell.alignment = { vertical: 'middle', wrapText: false, shrinkToFit: true };
  cell.font = { size: 7, color: { argb: '111827' } };
}

function applyCardOutline(worksheet, startRow, startCol, endRow, endCol) {
  for (let col = startCol; col <= endCol; col += 1) {
    worksheet.getCell(startRow, col).border = { ...worksheet.getCell(startRow, col).border, top: borderThin };
    worksheet.getCell(endRow, col).border = { ...worksheet.getCell(endRow, col).border, bottom: borderThin };
  }
  for (let row = startRow; row <= endRow; row += 1) {
    worksheet.getCell(row, startCol).border = { ...worksheet.getCell(row, startCol).border, left: borderThin };
    worksheet.getCell(row, endCol).border = { ...worksheet.getCell(row, endCol).border, right: borderThin };
  }
}

function applySectionDivider(worksheet, startRow, endRow, dividerCol) {
  for (let row = startRow; row <= endRow; row += 1) {
    worksheet.getCell(row, dividerCol).border = {
      ...worksheet.getCell(row, dividerCol).border,
      left: borderHair
    };
  }
}

function setMergedValue(worksheet, row, startCol, endCol, value, style = {}) {
  worksheet.mergeCells(row, startCol, row, endCol);
  const cell = worksheet.getCell(row, startCol);
  cell.value = value;
  Object.assign(cell, style);
  return cell;
}

function writeLine(worksheet, row, labelCol, valueCol, line) {
  const labelCell = worksheet.getCell(row, labelCol);
  const valueCell = worksheet.getCell(row, valueCol);
  labelCell.value = line.label;
  labelCell.font = { size: 6.5, bold: line.bold || line.kind === 'header', underline: line.kind === 'header' };
  labelCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false, shrinkToFit: true };

  if (line.kind !== 'header') {
    valueCell.value = formatCurrency(line.value);
    valueCell.numFmt = '#,##0';
    valueCell.font = { size: 6.5, bold: line.bold };
    valueCell.alignment = { horizontal: 'right', vertical: 'middle', shrinkToFit: true };
  }

  if (line.top || line.total) {
    labelCell.border = { ...labelCell.border, top: line.total ? borderThin : borderHair };
    valueCell.border = { ...valueCell.border, top: line.total ? borderThin : borderHair };
  }
  if (line.total) {
    labelCell.fill = fillHeader;
    valueCell.fill = fillHeader;
  }
}

function renderPayslipCard(worksheet, item, meta, startRow, startCol) {
  const model = buildPayslipModel(item, meta.month, meta.year);
  const endCol = startCol + CARD_WIDTH - 1;
  const endRow = startRow + CARD_HEIGHT - 1;

  for (let row = startRow; row <= endRow; row += 1) {
    worksheet.getRow(row).height = 10.5;
    for (let col = startCol; col <= endCol; col += 1) styleCardCell(worksheet.getCell(row, col));
  }

  const company = setMergedValue(worksheet, startRow, startCol, endCol, 'PT REBINMAS JAYA', {
    font: { bold: true, size: 9 },
    alignment: { horizontal: 'center', vertical: 'middle' },
    fill: fillPanel
  });
  company.border = { top: borderThin, bottom: borderDotted, left: borderThin, right: borderThin };
  setMergedValue(worksheet, startRow + 1, startCol, endCol, 'SLIP GAJI KARYAWAN', {
    font: { bold: true, size: 8 },
    alignment: { horizontal: 'center', vertical: 'middle' }
  });
  setMergedValue(worksheet, startRow + 2, startCol, endCol, `Periode: ${model.period}`, {
    font: { bold: true, size: 7, color: { argb: '4B5563' } },
    alignment: { horizontal: 'center', vertical: 'middle' }
  });

  const infoRows = [
    ['NIK/Nama', `${model.empCode} - ${model.name}`],
    ['Jabatan', model.jabatan],
    ['Gang', model.gang],
    ['HK/Rate', `${model.hk || 0} / ${formatCurrency(model.rate)}`],
    ['PTKP', model.ptkp]
  ];
  infoRows.forEach(([label, value], idx) => {
    const row = startRow + 3 + idx;
    worksheet.getCell(row, startCol).value = label;
    worksheet.getCell(row, startCol).font = { size: 7, bold: true };
    worksheet.getCell(row, startCol).alignment = { horizontal: 'left', vertical: 'middle', shrinkToFit: true };
    setMergedValue(worksheet, row, startCol + 1, endCol, `: ${value}`, {
      font: { size: 7 },
      alignment: { horizontal: 'left', vertical: 'middle', shrinkToFit: true, wrapText: false }
    });
  });
  setMergedValue(worksheet, startRow + 8, startCol, endCol, `Ringkasan Aktivitas | ${model.activity}`, {
    font: { bold: true, size: 7 },
    alignment: { horizontal: 'left', vertical: 'middle', shrinkToFit: true },
    fill: fillPanel
  });

  const contentStart = startRow + 9;
  setMergedValue(worksheet, contentStart, startCol, startCol + 1, 'PENERIMAAN', {
    font: { bold: true, size: 8, color: { argb: 'FFFFFF' } },
    fill: fillBlack,
    alignment: { horizontal: 'center', vertical: 'middle' }
  });
  setMergedValue(worksheet, contentStart, startCol + 2, endCol, 'POTONGAN', {
    font: { bold: true, size: 8, color: { argb: 'FFFFFF' } },
    fill: fillBlack,
    alignment: { horizontal: 'center', vertical: 'middle' }
  });
  const footerRow = endRow;
  applySectionDivider(worksheet, contentStart, footerRow - 1, startCol + 2);

  const maxDetailRows = CARD_HEIGHT - 13;
  model.incomeLines.slice(0, maxDetailRows).forEach((line, idx) => {
    writeLine(worksheet, contentStart + 1 + idx, startCol, startCol + 1, line);
  });
  model.deductionLines.slice(0, maxDetailRows).forEach((line, idx) => {
    writeLine(worksheet, contentStart + 1 + idx, startCol + 2, startCol + 3, line);
  });

  setMergedValue(worksheet, footerRow, startCol, endCol, `PENERIMAAN BERSIH (Take Home Pay)    Rp ${formatCurrency(model.upahBersih).toLocaleString('id-ID')}`, {
    font: { bold: true, size: 8, color: { argb: 'FFFFFF' } },
    fill: fillBlack,
    alignment: { horizontal: 'center', vertical: 'middle', shrinkToFit: true }
  });
  worksheet.getRow(footerRow).height = 15;
  applyCardOutline(worksheet, startRow, startCol, endRow, endCol);
}

function getExcelColumnName(columnNumber) {
  let name = '';
  let n = columnNumber;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function applyCutGuides(worksheet, lastRow) {
  const gapCol = CARD_WIDTH + 1;
  for (let row = 1; row <= lastRow; row += 1) {
    const cell = worksheet.getCell(row, gapCol);
    cell.border = { left: borderDotted, right: borderDotted };
  }

  const rowsPerPage = (CARD_HEIGHT * 2) + CARD_ROW_GAP + 1;
  for (let row = CARD_HEIGHT + 1; row <= lastRow; row += rowsPerPage) {
    worksheet.getRow(row).height = 4;
    for (let col = 1; col <= (CARD_WIDTH * 2) + CARD_COL_GAP; col += 1) {
      worksheet.getCell(row, col).border = { top: borderDotted };
    }
  }
}

export async function exportPayslipsToExcel(payslipData = [], meta = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PT Rebinmas Jaya - Payroll System';
  workbook.created = new Date();

  const monthName = MONTH_NAMES[meta.month] || '';
  const worksheet = workbook.addWorksheet('Slip Gaji', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      verticalCentered: false,
      margins: { left: 0.15, right: 0.15, top: 0.15, bottom: 0.15, header: 0, footer: 0 }
    }
  });

  for (let col = 1; col <= (CARD_WIDTH * 2) + CARD_COL_GAP; col += 1) {
    const positionInCard = (col - 1) % (CARD_WIDTH + CARD_COL_GAP);
    if (positionInCard === CARD_WIDTH) worksheet.getColumn(col).width = 1.2;
    else if (positionInCard === 1 || positionInCard === 3) worksheet.getColumn(col).width = 8.6;
    else worksheet.getColumn(col).width = 12.8;
  }

  payslipData.forEach((item, index) => {
    const pageIndex = Math.floor(index / CARDS_PER_PAGE);
    const slotIndex = index % CARDS_PER_PAGE;
    const rowInPage = Math.floor(slotIndex / 2);
    const colInPage = slotIndex % 2;
    const pageStartRow = 1 + pageIndex * ((CARD_HEIGHT * 2) + CARD_ROW_GAP + 1);
    const startRow = pageStartRow + rowInPage * (CARD_HEIGHT + CARD_ROW_GAP);
    const startCol = 1 + colInPage * (CARD_WIDTH + CARD_COL_GAP);
    renderPayslipCard(worksheet, item, meta, startRow, startCol);
    if (slotIndex === CARDS_PER_PAGE - 1 && index < payslipData.length - 1) {
      const breakRow = pageStartRow + (CARD_HEIGHT * 2) + CARD_ROW_GAP;
      const row = worksheet.getRow(breakRow);
      if (typeof row.addPageBreak === 'function') row.addPageBreak();
    }
  });

  const lastRow = Math.max(1, worksheet.rowCount);
  const lastCol = (CARD_WIDTH * 2) + CARD_COL_GAP;
  applyCutGuides(worksheet, lastRow);
  worksheet.pageSetup.printArea = `A1:${getExcelColumnName(lastCol)}${lastRow}`;
  worksheet.views = [{ state: 'normal' }];
  const historyToken = meta.useHistory ? `_History${meta.snapshotVersion ? `_v${meta.snapshotVersion}` : ''}` : '';
  const fileName = `Slip_Gaji_${meta.division || 'Batch'}_${monthName}_${meta.year}${historyToken}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, fileName);
  return fileName;
}

export default exportPayslipsToExcel;
