/**
 * SummaryReportPage - Full Redesign
 * Clean Modern Corporate Dark Blue theme (#0A1D3A / #2563EB / #F3F6FB)
 * With sidebar, topbar, KPI cards, CSS-only charts, 3-page print
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Printer, FileText, RefreshCw, Save } from 'lucide-react';
import { fetchDivisionSummary, fetchAvailablePeriods, fetchDivisionsWithData, fetchVirtualDivisions, updateGangCell } from '../services/summaryReportService';
import ReportKpiCards, { PrintKpiRow } from '../components/common/ReportKpiCards';
import ReportMiniStats from '../components/common/ReportMiniStats';
import ReportPrintHeader from '../components/common/ReportPrintHeader';
import { getDivisionTypeLabel } from '../utils/reportPresentationLabels';
import { getReportDivisionSummary } from '../utils/divisionPresentation';
import { printReport } from '../utils/printPageSetup';
import '../styles/summary-report-new.css';

const REBINMAS_LOGO_SRC = `${import.meta.env.BASE_URL || '/'}images/rebinmas.webp`;
const DEFAULT_DIVISION = 'AB1';
const PRINT_SUMMARY_ROWS = 4;
const PRINT_DETAIL_ROWS_PER_PAGE = 14;
const PRINT_PREMI_ROWS = 11;

// ---- Helpers ----
function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(num));
}

function formatRupiah(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  return `Rp ${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(num))}`;
}

function formatCompactRupiah(value) {
  const num = Number(value || 0);
  if (Math.abs(num) >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (Math.abs(num) >= 1_000_000) return `Rp ${(num / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} JT`;
  return formatRupiah(num);
}

function getMonthName(m) {
  const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return months[m] || '';
}

function chunkRows(rows, size) {
  const source = Array.isArray(rows) && rows.length ? rows : [];
  if (!source.length) return [[]];
  const chunks = [];
  for (let i = 0; i < source.length; i += size) chunks.push(source.slice(i, i + size));
  return chunks;
}

function buildThumbprintRowSpans(rows, comparisonTotal = null) {
  if (comparisonTotal && rows.length) {
    return new Map([[0, {
      rowSpan: rows.length,
      thumbPrint: Number(comparisonTotal.thumb_print || 0),
      selisih: Number(comparisonTotal.selisih || 0),
    }]]);
  }

  const groups = new Map();
  rows.forEach((row, idx) => {
    const key = row.division_code || 'LAINNYA';
    const current = groups.get(key) || { firstIndex: idx, rowSpan: 0, thumbPrint: Number(row.thumb_print || 0), totalUpahBersih: 0 };
    current.rowSpan += 1;
    current.totalUpahBersih += Number(row.total_upah_bersih || 0);
    if (!current.thumbPrint) current.thumbPrint = Number(row.thumb_print || 0);
    groups.set(key, current);
  });

  const rowSpanByIndex = new Map();
  groups.forEach(group => {
    rowSpanByIndex.set(group.firstIndex, {
      rowSpan: group.rowSpan,
      thumbPrint: group.thumbPrint,
      selisih: group.thumbPrint > 0 ? group.totalUpahBersih - group.thumbPrint : 0,
    });
  });
  return rowSpanByIndex;
}

function formatComparisonThumbprint(comparisonCell) {
  const thumbPrint = Number(comparisonCell?.thumbPrint || 0);
  return thumbPrint ? formatNumber(thumbPrint) : '-';
}

function formatComparisonSelisih(comparisonCell) {
  const thumbPrint = Number(comparisonCell?.thumbPrint || 0);
  const selisih = Number(comparisonCell?.selisih || 0);
  return thumbPrint || selisih ? formatNumber(selisih) : '-';
}

function getPreviousPeriod(month, year) {
  const currentMonth = Number(month);
  const currentYear = Number(year);
  if (currentMonth <= 1) return { month: 12, year: currentYear - 1 };
  return { month: currentMonth - 1, year: currentYear };
}

function buildGrandTotal(rows) {
  if (!rows.length) return null;
  const totals = {
    total_employees: 0, total_hk: 0, total_premi: 0, total_lembur: 0,
    total_pph21: 0, total_spsi: 0, total_upah_bersih: 0,
    thumb_print: 0, selisih: 0,
    dynamic_premi_totals: {}, gang_count: rows.length,
  };
  const comparisonByDivision = new Map();

  rows.forEach(row => {
    totals.total_employees += Number(row.total_employees || 0);
    totals.total_hk += Number(row.total_hk || 0);
    totals.total_premi += Number(row.total_premi || 0);
    totals.total_lembur += Number(row.total_lembur || 0);
    totals.total_pph21 += Number(row.total_pph21 || 0);
    totals.total_spsi += Number(row.total_spsi || 0);
    totals.total_upah_bersih += Number(row.total_upah_bersih || 0);

    const divisionKey = row.division_code || 'LAINNYA';
    const currentComparison = comparisonByDivision.get(divisionKey) || { thumbPrint: Number(row.thumb_print || 0), totalUpahBersih: 0 };
    currentComparison.totalUpahBersih += Number(row.total_upah_bersih || 0);
    if (!currentComparison.thumbPrint) currentComparison.thumbPrint = Number(row.thumb_print || 0);
    comparisonByDivision.set(divisionKey, currentComparison);

    if (Array.isArray(row._dynamic_premi_list)) {
      row._dynamic_premi_list.forEach(dp => {
        totals.dynamic_premi_totals[dp.header] = (totals.dynamic_premi_totals[dp.header] || 0) + Number(dp.total || 0);
      });
    }
  });

  comparisonByDivision.forEach(({ thumbPrint, totalUpahBersih }) => {
    totals.thumb_print += Number(thumbPrint || 0);
    totals.selisih += thumbPrint > 0 ? totalUpahBersih - thumbPrint : 0;
  });
  return totals;
}

function buildPremiBreakdown(currentTotal, previousTotal) {
  if (!currentTotal) return [];
  const currentDynamicTotals = currentTotal?.dynamic_premi_totals || {};
  const previousDynamicTotals = previousTotal?.dynamic_premi_totals || {};
  const currentEntries = Object.entries(currentDynamicTotals)
    .filter(([, amount]) => Number(amount || 0) !== 0);

  const rows = currentEntries.length
    ? currentEntries.map(([name, amount]) => ({ name, amount: Number(amount || 0) }))
    : [{ name: 'Total Premi', amount: Number(currentTotal?.total_premi || 0) }];

  return rows
    .map(row => {
      const previousAmount = Number(previousDynamicTotals[row.name] || 0);
      const delta = row.amount - previousAmount;
      return {
        ...row,
        previousAmount,
        delta,
        percentage: currentTotal?.total_premi ? (row.amount / currentTotal.total_premi) * 100 : 0,
        deltaPercentage: previousAmount ? (delta / previousAmount) * 100 : null,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

function compactPremiRowsForPrint(rows, maxRows = PRINT_PREMI_ROWS) {
  if (!Array.isArray(rows) || rows.length <= maxRows) return rows || [];
  const visibleRows = rows.slice(0, maxRows - 1);
  const remainingRows = rows.slice(maxRows - 1);
  const others = remainingRows.reduce((acc, row) => {
    acc.amount += Number(row.amount || 0);
    acc.previousAmount += Number(row.previousAmount || 0);
    acc.delta += Number(row.delta || 0);
    acc.percentage += Number(row.percentage || 0);
    return acc;
  }, { name: 'Lainnya', amount: 0, previousAmount: 0, delta: 0, percentage: 0, deltaPercentage: null });
  return [...visibleRows, others];
}

// ---- Editable Cell ----
function EditableCell({ editMode, value, onSave, isCurrency }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(value || 0));
  const inputRef = React.useRef(null);

  useEffect(() => {
    if (!editing) setInputVal(String(value || 0));
  }, [value, editing]);

  const handleDoubleClick = () => {
    if (editMode) {
      setEditing(true);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  };

  const handleBlur = () => {
    setEditing(false);
    const num = parseFloat(inputVal) || 0;
    if (num !== Number(value)) onSave(num);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') inputRef.current?.blur();
    else if (e.key === 'Escape') {
      setInputVal(String(value || 0));
      setEditing(false);
    }
  };

  if (editMode) {
    return (
      <td
        className="num-cell"
        style={{
          cursor: 'text',
          backgroundColor: editing ? '#fffbeb' : '#f0f9ff',
          textAlign: 'right',
        }}
        onDoubleClick={handleDoubleClick}
      >
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              border: '1px solid #3b82f6',
              borderRadius: '4px',
              background: '#ffffff',
              textAlign: 'right',
              fontSize: 'inherit',
              fontFamily: 'inherit',
              color: '#0f172a',
              outline: 'none',
              padding: '2px 6px',
            }}
            autoFocus
          />
        ) : (
          <span style={{ color: '#1e40af', fontSize: '11px', opacity: 0.7 }}>
            {formatNumber(value)} ✏
          </span>
        )}
      </td>
    );
  }

  return (
    <td className="num-cell">
      {formatNumber(value)}
    </td>
  );
}

// ---- CONTENT WRAPPER (no duplicate sidebar/topbar — DashboardLayout provides those) ----
function ContentWrapper({ children }) {
  return <div className="srn-content-body">{children}</div>;
}

// ---- Sidebar (not used — DashboardLayout provides its own sidebar) ----
// NOTE: We keep the Sidebar/Topbar component code for standalone reference
// but they are NOT rendered since DashboardLayout provides layout chrome.

// ---- Donut Chart ----
function DonutChart({ label, percentage }) {
  const pct = percentage ?? 100;
  return (
    <div className="srn-donut-wrap">
      <div
        className="srn-donut"
        data-label={`${label}\n${pct.toFixed(1)}%`}
        style={{
          background: `conic-gradient(var(--srn-blue-600) 0 ${pct}%, var(--srn-blue-050) ${pct}%)`,
        }}
      />
      <div className="srn-legend">
        <div className="srn-legend-item">
          <span className="srn-dot" />
          <span>{label}</span>
          <span className="srn-legend-pct">{pct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function DistributionDonutChart({ items, centerLabel }) {
  const safeItems = (items || []).filter(item => Number(item.amount) > 0).slice(0, 6);
  const total = safeItems.reduce((sum, item) => sum + Number(item.amount || 0), 0) || 1;
  let cursor = 0;
  const palette = ['#2563EB', '#0A1D3A', '#15803d', '#d97706', '#7c3aed', '#64748b'];
  const segments = safeItems.map((item, idx) => {
    const pct = (Number(item.amount || 0) / total) * 100;
    const start = cursor;
    cursor += pct;
    return `${palette[idx % palette.length]} ${start}% ${cursor}%`;
  });

  return (
    <div className="srn-donut-wrap srn-donut-wrap-multi">
      <div
        className="srn-donut srn-donut-multi"
        data-label={`${centerLabel}\n${formatRupiah(total)}`}
        style={{ background: `conic-gradient(${segments.join(', ') || 'var(--srn-blue-050) 0 100%'})` }}
      />
      <div className="srn-legend">
        {safeItems.map((item, idx) => {
          const pct = (Number(item.amount || 0) / total) * 100;
          return (
            <div key={`${item.name}-${idx}`} className="srn-legend-item">
              <span className="srn-dot" style={{ background: palette[idx % palette.length] }} />
              <span>{item.name}</span>
              <span className="srn-legend-pct">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Bar Chart ----
function BarChart({ items }) {
  const maxVal = Math.max(...items.map(i => Number(i.amount) || 0), 1);
  return (
    <div className="srn-bars">
      {items.map((item, idx) => {
        const val = Number(item.amount) || 0;
        const width = (val / maxVal) * 100;
        return (
          <div key={idx} className="srn-bar-row">
            <div className="srn-bar-label" title={item.name}>{item.name}</div>
            <div className="srn-bar-track">
              <div className="srn-bar-fill" style={{ width: `${width}%` }} />
            </div>
            <div className="srn-bar-value">{item.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Summary Table ----
function SummaryTable({ data, grandTotal, comparisonTotal, onCellEdit, editMode, filteredGrandTotalLabel, showDetail, filteredHeaders, getDynamicPremiValue }) {
  const baseColSpan = 11 + (showDetail ? filteredHeaders.length : 0);
  const thumbprintRowSpans = useMemo(() => buildThumbprintRowSpans(data, comparisonTotal), [data, comparisonTotal]);

  return (
    <div className="srn-table-wrapper">
      <table className="srn-table">
        <thead>
          <tr>
            <th className="text-left">ESTATE / GANG</th>
            <th>WORKERS</th>
            <th>HK</th>
            {showDetail && filteredHeaders.map(h => <th key={h}>{h.toUpperCase()}</th>)}
            <th>TOTAL PREMI</th>
            <th>LEMBUR</th>
            <th>PPH 21</th>
            <th>SPSI</th>
            <th>TOTAL UPAH BERSIH</th>
            <th>THUMBPRINT</th>
            <th>SELISIH</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={baseColSpan} style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                Tidak ada data
              </td>
            </tr>
          ) : data.map((row, idx) => {
            const comparisonCell = thumbprintRowSpans.get(idx);
            return (
              <tr key={idx}>
                <td className="srn-gang-cell">
                  <span className="srn-gang-code">{row.gang_code}</span>
                  {row.gang_description && row.gang_description !== row.gang_code && (
                    <span className="srn-gang-desc">{row.gang_description}</span>
                  )}
                </td>
                <EditableCell editMode={editMode} value={row.total_employees} onSave={v => onCellEdit(row.gang_code, 'total_employees', v)} />
                <EditableCell editMode={editMode} value={row.total_hk} onSave={v => onCellEdit(row.gang_code, 'total_hk', v)} />
                {showDetail && filteredHeaders.map(h => (
                  <td key={h} className="num-cell">
                    {formatNumber(getDynamicPremiValue(row, h))}
                  </td>
                ))}
                <EditableCell editMode={editMode} value={row.total_premi} onSave={v => onCellEdit(row.gang_code, 'total_premi', v)} />
                <EditableCell editMode={editMode} value={row.total_lembur} onSave={v => onCellEdit(row.gang_code, 'total_lembur', v)} />
                <EditableCell editMode={editMode} value={row.total_pph21} onSave={v => onCellEdit(row.gang_code, 'total_pph21', v)} />
                <EditableCell editMode={editMode} value={row.total_spsi} onSave={v => onCellEdit(row.gang_code, 'total_spsi', v)} />
                <EditableCell editMode={editMode} value={row.total_upah_bersih} onSave={v => onCellEdit(row.gang_code, 'total_upah_bersih', v)} isCurrency />
                {comparisonCell && (
                  <>
                    <td className="num-cell summary-compare-cell" rowSpan={comparisonCell.rowSpan}>{formatComparisonThumbprint(comparisonCell)}</td>
                    <td className={`num-cell summary-compare-cell ${comparisonCell.selisih < 0 ? 'negative' : comparisonCell.selisih > 0 ? 'positive' : ''}`} rowSpan={comparisonCell.rowSpan}>{formatComparisonSelisih(comparisonCell)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        {grandTotal && (
          <tfoot>
            <tr>
              <td className="srn-total-row-label">{filteredGrandTotalLabel}</td>
              <td className="num-cell">{formatNumber(grandTotal.total_employees)}</td>
              <td className="num-cell">{formatNumber(grandTotal.total_hk)}</td>
              {showDetail && filteredHeaders.map(h => (
                <td key={h} className="num-cell">{formatNumber(grandTotal.dynamic_premi_totals?.[h])}</td>
              ))}
              <td className="num-cell" style={{ background: 'var(--srn-navy-900)', color: '#fff' }}>
                {formatNumber(grandTotal.total_premi)}
              </td>
              <td className="num-cell">{formatNumber(grandTotal.total_lembur)}</td>
              <td className="num-cell">{formatNumber(grandTotal.total_pph21)}</td>
              <td className="num-cell">{formatNumber(grandTotal.total_spsi)}</td>
              <td className="num-cell" style={{ color: '#4ade80' }}>
                {formatNumber(grandTotal.total_upah_bersih)}
              </td>
              <td className="num-cell" />
              <td className="num-cell" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ---- Signature Section ----
function SignatureSection() {
  const sigs = [
    { role: 'Dibuat Oleh', name: 'Admin Payroll', title: 'Staff Payroll' },
    { role: 'Diperiksa Oleh', name: 'HR Manager', title: 'Manager' },
    { role: 'Diketahui Oleh', name: 'Senior Manager', title: 'Senior Manager' },
    { role: 'Disetujui Oleh', name: 'General Manager', title: 'GM / Direktur' },
  ];

  return (
    <div className="srn-signatures">
      {sigs.map((s, idx) => (
        <div key={idx} className="srn-sig">
          <div className="srn-sig-line" />
          <strong>{s.role}</strong>
          <br />
          <strong>{s.name}</strong>
          <br />
          <em style={{ fontSize: '0.85em', color: 'var(--srn-text-500)' }}>{s.title}</em>
        </div>
      ))}
    </div>
  );
}

// ---- Print Page 1: Summary ----
function PrintPage1({ grandTotal, comparisonTotal, periodLabel, printDate, username, filteredData, filteredGrandTotalLabel, chartData, divisionLabel, totalPages }) {
  const kpis = [
    { label: 'Total Workers', value: formatNumber(grandTotal?.total_employees) },
    { label: 'Total HK Chekroll', value: formatNumber(grandTotal?.total_hk) },
    { label: 'Total Premi', value: formatRupiah(grandTotal?.total_premi) },
    { label: 'Total Upah Bersih', value: formatRupiah(grandTotal?.total_upah_bersih) },
  ];
  const summaryRows = filteredData.slice(0, PRINT_SUMMARY_ROWS);
  const summaryThumbprintRowSpans = buildThumbprintRowSpans(summaryRows, comparisonTotal);

  return (
    <article className="srn-paper srn-paper-summary" id="print-page-1">
      <ReportPrintHeader
        title="Summary Report Detail"
        period={`Divisi: ${divisionLabel} | Periode: ${periodLabel}`}
        meta={`Dicetak oleh: ${username || 'Admin'}\nTanggal Cetak: ${printDate}`}
      />
      <PrintKpiRow items={kpis} />
      <div className="srn-print-grid">
        <div className="srn-print-card">
          <div className="srn-print-card-title">{chartData.distributionTitle}</div>
          <DistributionDonutChart items={chartData.distribution} centerLabel={chartData.distributionCenterLabel} />
        </div>
        <div className="srn-print-card">
          <div className="srn-print-card-title">Distribusi Per Jenis Premi</div>
          <BarChart items={chartData.premi} />
        </div>
      </div>
      <div className="srn-table-wrapper" style={{ marginBottom: 0 }}>
        <table className="srn-table">
          <thead>
            <tr>
              <th className="text-left">ESTATE / GANG</th>
              <th>WORKERS</th>
              <th>HK</th>
              <th>TOTAL PREMI</th>
              <th>LEMBUR</th>
              <th>PPH 21</th>
              <th>SPSI</th>
              <th>TOTAL UPAH BERSIH</th>
              <th>THUMBPRINT</th>
              <th>SELISIH</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map((row, idx) => {
              const comparisonCell = summaryThumbprintRowSpans.get(idx);
              return (
                <tr key={idx}>
                  <td>
                    <span className="srn-gang-code">{row.gang_code}</span>
                    <br />
                    <span className="srn-gang-desc">{row.gang_description || ''}</span>
                  </td>
                  <td className="num-cell">{formatNumber(row.total_employees)}</td>
                  <td className="num-cell">{formatNumber(row.total_hk)}</td>
                  <td className="num-cell">{formatNumber(row.total_premi)}</td>
                  <td className="num-cell">{formatNumber(row.total_lembur)}</td>
                  <td className="num-cell">{formatNumber(row.total_pph21)}</td>
                  <td className="num-cell">{formatNumber(row.total_spsi)}</td>
                  <td className="num-cell">{formatNumber(row.total_upah_bersih)}</td>
                  {comparisonCell && (
                    <>
                      <td className="num-cell summary-compare-cell" rowSpan={comparisonCell.rowSpan}>{formatComparisonThumbprint(comparisonCell)}</td>
                      <td className={`num-cell summary-compare-cell ${comparisonCell.selisih < 0 ? 'negative' : comparisonCell.selisih > 0 ? 'positive' : ''}`} rowSpan={comparisonCell.rowSpan}>{formatComparisonSelisih(comparisonCell)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          {grandTotal && (
            <tfoot>
              <tr>
                <td className="srn-total-row-label">{filteredGrandTotalLabel}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_employees)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_hk)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_premi)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_lembur)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_pph21)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_spsi)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_upah_bersih)}</td>
                <td className="num-cell" />
                <td className="num-cell" />
              </tr>
            </tfoot>
          )}
        </table>
        {filteredData.length > PRINT_SUMMARY_ROWS && (
          <div className="srn-print-table-note">
            Menampilkan {PRINT_SUMMARY_ROWS} baris pertama. Detail lengkap berlanjut pada halaman Detail Per Gang.
          </div>
        )}
      </div>
      <footer className="srn-paper-footer">
        <span>Dicetak: {printDate}</span>
        <span>Payroll Reporting System - PT. Rebinmas Jaya</span>
        <span>Hal. 1 / {totalPages}</span>
      </footer>
    </article>
  );
}

// ---- Print Page 2: Uraian Premi ----
function PrintPage2({ grandTotal, previousGrandTotal, premiBreakdownData, periodLabel, previousPeriodLabel, printDate, username, divisionLabel, pageNumber, totalPages }) {
  const previousTotalPremi = Number(previousGrandTotal?.total_premi || 0);
  const totalDelta = Number(grandTotal?.total_premi || 0) - previousTotalPremi;
  const printPremiRows = compactPremiRowsForPrint(premiBreakdownData);
  const kpis = [
    { label: 'Total Premi', value: formatRupiah(grandTotal?.total_premi) },
    { label: 'Premi Bulan Lalu', value: formatRupiah(previousTotalPremi) },
    { label: 'Selisih Premi', value: formatRupiah(totalDelta) },
    { label: 'Jenis Premi', value: formatNumber(premiBreakdownData.length) },
  ];

  return (
    <article className="srn-paper srn-paper-premi" id={`print-page-${pageNumber}`}>
      <ReportPrintHeader
        title="Uraian Premi Per Jenis"
        period={`Divisi: ${divisionLabel} | Periode: ${periodLabel}`}
        meta={`Dicetak oleh: ${username || 'Admin'}\nTanggal Cetak: ${printDate}`}
      />
      <PrintKpiRow items={kpis} />
      <div className="srn-uraian-layout">
        <div>
          <table className="srn-table">
            <thead>
              <tr>
                <th>NO</th>
                <th className="text-left">JENIS PREMI</th>
                <th>BULAN INI</th>
                <th>BULAN LALU</th>
                <th>SELISIH</th>
                <th>PERSENTASE</th>
              </tr>
            </thead>
            <tbody>
              {printPremiRows.map((row, index) => (
                <tr key={row.name}>
                  <td className="num-cell">{index + 1}</td>
                  <td>{row.name}</td>
                  <td className="num-cell">{formatNumber(row.amount)}</td>
                  <td className="num-cell">{formatNumber(row.previousAmount)}</td>
                  <td className="num-cell">{formatNumber(row.delta)}</td>
                  <td className="num-cell">{row.percentage.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="2" className="srn-total-row-label">Total</td>
                <td className="num-cell">{formatNumber(grandTotal?.total_premi)}</td>
                <td className="num-cell">{formatNumber(previousTotalPremi)}</td>
                <td className="num-cell">{formatNumber(totalDelta)}</td>
                <td className="num-cell">100,00%</td>
              </tr>
            </tfoot>
          </table>
          <div className="srn-note">*Angka dalam Rupiah (IDR)</div>
        </div>
        <div>
          <div className="srn-print-card" style={{ marginBottom: '10px' }}>
            <div className="srn-print-card-title">Ringkasan Top Premi</div>
            <div className="srn-rank-list">
              {printPremiRows.slice(0, 4).map((item, index) => (
                <div key={item.name} className="srn-rank-item">
                  <div className="srn-rank-no">{index + 1}</div>
                  <div className="srn-rank-bar-wrap">
                    <div className="srn-rank-bar-label">{item.name}</div>
                    <div className="srn-rank-bar">
                      <span style={{ width: `${Math.min(100, Math.max(3, item.percentage))}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="srn-info-box">
            Total Jenis Premi: <strong>{premiBreakdownData.length}</strong><br />
            Total Divisi: <strong>1</strong><br />
            Total Gang: <strong>{formatNumber(grandTotal?.gang_count || 0)}</strong><br />
            Periode: <strong>{periodLabel}</strong>
            <br />Pembanding: <strong>{previousPeriodLabel}</strong>
          </div>
        </div>
      </div>
      <footer className="srn-paper-footer">
        <span>Dicetak: {printDate}</span>
        <span>Payroll Reporting System - PT. Rebinmas Jaya</span>
        <span>Hal. {pageNumber} / {totalPages}</span>
      </footer>
    </article>
  );
}

// ---- Print Page 3: Detail Gang ----
function PrintPage3({ rows, grandTotal, comparisonTotal, periodLabel, printDate, username, filteredGrandTotalLabel, divisionLabel, pageNumber, totalPages, isLastDetailPage }) {
  const thumbprintRowSpans = buildThumbprintRowSpans(rows, comparisonTotal);

  return (
    <article className={`srn-paper srn-paper-detail${isLastDetailPage ? ' srn-paper-with-signature' : ''}`} id={`print-page-${pageNumber}`}>
      <ReportPrintHeader
        title={pageNumber === 2 ? 'Detail Per Gang / Estate' : 'Lanjutan Detail Per Gang / Estate'}
        period={`Divisi: ${divisionLabel} | Periode: ${periodLabel}`}
        meta={`Dicetak oleh: ${username || 'Admin'}\nTanggal Cetak: ${printDate}`}
      />
      <div className="srn-detail-table-wrapper">
        <table className="srn-table">
          <thead>
            <tr>
              <th className="text-left">ESTATE / GANG</th>
              <th>WORKERS</th>
              <th>HK</th>
              <th>TOTAL PREMI</th>
              <th>LEMBUR</th>
              <th>PPH 21</th>
              <th>SPSI</th>
              <th>TOTAL UPAH BERSIH</th>
              <th>THUMBPRINT</th>
              <th>SELISIH</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const comparisonCell = thumbprintRowSpans.get(idx);
              return (
                <tr key={idx}>
                  <td>
                    <span className="srn-gang-code">{row.gang_code}</span>
                    <br />
                    <span className="srn-gang-desc">{row.gang_description || ''}</span>
                  </td>
                  <td className="num-cell">{formatNumber(row.total_employees)}</td>
                  <td className="num-cell">{formatNumber(row.total_hk)}</td>
                  <td className="num-cell">{formatNumber(row.total_premi)}</td>
                  <td className="num-cell">{formatNumber(row.total_lembur)}</td>
                  <td className="num-cell">{formatNumber(row.total_pph21)}</td>
                  <td className="num-cell">{formatNumber(row.total_spsi)}</td>
                  <td className="num-cell">{formatNumber(row.total_upah_bersih)}</td>
                  {comparisonCell && (
                    <>
                      <td className="num-cell summary-compare-cell" rowSpan={comparisonCell.rowSpan}>{formatComparisonThumbprint(comparisonCell)}</td>
                      <td className={`num-cell summary-compare-cell ${comparisonCell.selisih < 0 ? 'negative' : comparisonCell.selisih > 0 ? 'positive' : ''}`} rowSpan={comparisonCell.rowSpan}>{formatComparisonSelisih(comparisonCell)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          {grandTotal && isLastDetailPage && (
            <tfoot>
              <tr>
                <td className="srn-total-row-label">{filteredGrandTotalLabel}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_employees)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_hk)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_premi)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_lembur)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_pph21)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_spsi)}</td>
                <td className="num-cell">{formatNumber(grandTotal.total_upah_bersih)}</td>
                <td className="num-cell" />
                <td className="num-cell" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {isLastDetailPage && <SignatureSection />}
      <footer className="srn-paper-footer">
        <span>Dicetak: {printDate}</span>
        <span>Payroll Reporting System - PT. Rebinmas Jaya</span>
        <span>Hal. {pageNumber} / {totalPages}</span>
      </footer>
    </article>
  );
}

// ===== MAIN COMPONENT =====
export default function SummaryReportPage({ onBack, initialDivision, initialMonth, initialYear }) {
  const { token, user } = useAuth();

  // Filters
  const [division, setDivision] = useState(initialDivision || DEFAULT_DIVISION);
  const [month, setMonth] = useState(initialMonth || 11);
  const [year, setYear] = useState(initialYear || new Date().getFullYear());
  const [divisionType, setDivisionType] = useState('real');
  const [groupFilter, setGroupFilter] = useState('');

  // Data
  const [divisions, setDivisions] = useState([]);
  const [virtualDivisions, setVirtualDivisions] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [previousSummaryData, setPreviousSummaryData] = useState([]);
  const [comparisonTotal, setComparisonTotal] = useState(null);
  const [gangDescriptions, setGangDescriptions] = useState({});
  const [filteredHeaders, setFilteredHeaders] = useState([]);
  const [showDetail, setShowDetail] = useState(false);

  // UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editedCells, setEditedCells] = useState({});

  const periodLabel = `${getMonthName(month)} ${year}`;
  const previousPeriod = useMemo(() => getPreviousPeriod(month, year), [month, year]);
  const previousPeriodLabel = `${getMonthName(previousPeriod.month)} ${previousPeriod.year}`;
  const printDate = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Sync props
  useEffect(() => {
    if (initialDivision !== undefined) setDivision(initialDivision || DEFAULT_DIVISION);
    if (initialMonth !== undefined) setMonth(initialMonth);
    if (initialYear !== undefined) setYear(initialYear);
  }, [initialDivision, initialMonth, initialYear]);

  // Get asistensi
  const getAsistensi = useCallback((gc) => {
    if (!gc) return null;
    const g = gc.trim().toUpperCase();
    if (g.startsWith('K2')) return '1';
    const match = g.match(/\d/);
    return match ? match[0] : null;
  }, []);

  // Merged data with gang descriptions
  const mergedData = useMemo(() => {
    return summaryData.map(row => ({
      ...row,
      gang_description: gangDescriptions[row.gang_code] || row.gang_description || row.gang_code,
    }));
  }, [summaryData, gangDescriptions]);

  // Filter by group
  const filteredData = useMemo(() => {
    if (!groupFilter) return mergedData;
    return mergedData.filter(row => getAsistensi(row.gang_code) === groupFilter);
  }, [mergedData, groupFilter, getAsistensi]);

  const previousFilteredData = useMemo(() => {
    if (!groupFilter) return previousSummaryData;
    return previousSummaryData.filter(row => getAsistensi(row.gang_code) === groupFilter);
  }, [previousSummaryData, groupFilter, getAsistensi]);

  // Available groups
  const availableGroups = useMemo(() => {
    const groups = new Set();
    mergedData.forEach(row => {
      const g = getAsistensi(row.gang_code);
      if (g) groups.add(g);
    });
    return Array.from(groups).sort((a, b) => Number(a) - Number(b));
  }, [mergedData, getAsistensi]);

  // Grand total from filtered data
  const grandTotal = useMemo(() => buildGrandTotal(filteredData), [filteredData]);

  const divisionComparisonTotal = useMemo(() => comparisonTotal || buildGrandTotal(mergedData), [comparisonTotal, mergedData]);

  const previousGrandTotal = useMemo(() => buildGrandTotal(previousFilteredData), [previousFilteredData]);

  const premiBreakdownData = useMemo(
    () => buildPremiBreakdown(grandTotal, previousGrandTotal),
    [grandTotal, previousGrandTotal]
  );

  const filteredGrandTotalLabel = groupFilter ? `TOTAL GROUP ${groupFilter}` : 'GRAND TOTAL';

  // Dynamic premi value helper
  const getDynamicPremiValue = useCallback((row, header) => {
    if (!row._dynamic_premi_list || !Array.isArray(row._dynamic_premi_list)) return 0;
    const item = row._dynamic_premi_list.find(p => p.header?.toLowerCase() === header.toLowerCase());
    return item ? parseFloat(item.total || 0) : 0;
  }, []);

  // Chart data
  const chartData = useMemo(() => {
    const selectedDivisionLevel = Boolean(division);
    const distributionMap = new Map();

    filteredData.forEach(row => {
      const key = selectedDivisionLevel
        ? (row.gang_description || row.gang_code || 'Lainnya')
        : (row.division_code || 'Lainnya');
      distributionMap.set(key, (distributionMap.get(key) || 0) + Number(row.total_premi || 0));
    });

    const distribution = Array.from(distributionMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const topPremi = premiBreakdownData.slice(0, 8).map(row => ({
      name: row.name,
      amount: row.amount,
      label: formatCompactRupiah(row.amount),
    }));
    return {
      distributionTitle: selectedDivisionLevel ? 'Distribusi Premi Per Gang' : 'Distribusi Premi Per Divisi',
      distributionCenterLabel: selectedDivisionLevel ? 'Gang' : 'Divisi',
      distribution: distribution.length ? distribution : [{ name: selectedDivisionLevel ? 'Gang' : 'Divisi', amount: 1 }],
      premi: topPremi.length ? topPremi : [{ name: 'Total Premi', amount: 0, label: formatRupiah(0) }],
    };
  }, [division, filteredData, premiBreakdownData]);

  const detailPrintRows = useMemo(
    () => filteredData.slice(PRINT_SUMMARY_ROWS),
    [filteredData]
  );

  const detailPrintPages = useMemo(
    () => detailPrintRows.length ? chunkRows(detailPrintRows, PRINT_DETAIL_ROWS_PER_PAGE) : [],
    [detailPrintRows]
  );

  const printTotalPages = 2 + detailPrintPages.length;
  const premiPrintPageNumber = printTotalPages;

  // Load gang descriptions
  useEffect(() => {
    async function loadGangDescriptions() {
      if (!token) return;
      try {
        const resp = await axios.get('payroll/summary/gang-descriptions', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.data.success) setGangDescriptions(resp.data.descriptions || {});
      } catch (e) { /* silent */ }
    }
    loadGangDescriptions();
  }, [token]);

  // Load divisions
  useEffect(() => {
    async function loadDivisions() {
      if (!token) return;
      try {
        const result = await fetchDivisionsWithData(token);
        setDivisions(result.divisions || []);
      } catch (e) { /* silent */ }
    }
    loadDivisions();
  }, [token]);

  // Load virtual divisions
  useEffect(() => {
    async function loadVirtualDivisions() {
      if (!token) return;
      try {
        const result = await fetchVirtualDivisions(token);
        setVirtualDivisions(result.divisions || []);
      } catch (e) { /* silent */ }
    }
    loadVirtualDivisions();
  }, [token]);

  // Load periods
  useEffect(() => {
    async function loadPeriods() {
      if (!token) return;
      try {
        const result = await fetchAvailablePeriods(token, division || null);
        setPeriods(result.periods || []);
      } catch (e) { /* silent */ }
    }
    loadPeriods();
  }, [token, division]);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!token) return;
    if (!division) {
      setSummaryData([]);
      setFilteredHeaders([]);
      setPreviousSummaryData([]);
      setError('Pilih satu divisi terlebih dahulu. Summary Report dihitung untuk lingkup satu divisi.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await fetchDivisionSummary(token, {
        division,
        month,
        year,
        includeVirtual: divisionType !== 'real',
      });
      if (result.success) {
        setSummaryData(result.data || []);
        setComparisonTotal(result.comparison_total || null);
        const uniqueHeaders = [];
        const seen = new Set();
        for (const h of (result.filtered_headers || [])) {
          const norm = h.toLowerCase().trim();
          if (!seen.has(norm)) { seen.add(norm); uniqueHeaders.push(h); }
        }
        setFilteredHeaders(uniqueHeaders);
      } else {
        setError('Gagal mengambil data summary');
      }
    } catch (e) {
      setError(e.message || 'Gagal mengambil data');
    } finally {
      setLoading(false);
    }
  }, [token, division, month, year, divisionType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    async function fetchPreviousDivisionData() {
      if (!token || !division) {
        setPreviousSummaryData([]);
        return;
      }

      try {
        const result = await fetchDivisionSummary(token, {
          division,
          month: previousPeriod.month,
          year: previousPeriod.year,
          useHistory: true,
          includeVirtual: divisionType !== 'real',
        });
        setPreviousSummaryData(result.success ? (result.data || []) : []);
      } catch {
        setPreviousSummaryData([]);
      }
    }

    fetchPreviousDivisionData();
  }, [token, division, previousPeriod.month, previousPeriod.year, divisionType]);

  // Cell edit handler
  const handleCellEdit = useCallback((gangCode, field, newValue) => {
    setEditedCells(prev => ({ ...prev, [`${gangCode}_${field}`]: newValue }));
  }, []);

  // Save edits
  const handleSaveEdits = useCallback(async () => {
    if (!token || Object.keys(editedCells).length === 0) return;
    setLoading(true);
    const entries = Object.entries(editedCells);
    let ok = 0, fail = 0;
    for (const [key, value] of entries) {
      const u = key.indexOf('_');
      if (u === -1) { fail++; continue; }
      const gc = key.substring(0, u);
      const field = key.substring(u + 1);
      try {
        const result = await updateGangCell(token, { month, year, gang_code: gc, field, value });
        if (result.success) ok++; else fail++;
      } catch { fail++; }
    }
    if (fail === 0) {
      setEditedCells({});
      setEditMode(false);
      fetchData();
    } else {
      setError(`Saved ${ok}/${entries.length} edits. ${fail} failed.`);
    }
    setLoading(false);
  }, [token, editedCells, month, year, fetchData]);

  // Handle print
  const handlePrint = () => {
    if (!division) {
      setError('Pilih satu divisi terlebih dahulu. Summary Report dan Uraian Premi dihitung untuk lingkup satu divisi.');
      return;
    }
    printReport({ orientation: 'landscape' });
  };

  // Export CSV
  const handleExport = () => {
    let csv = 'Gang,Workers,HK,Total Premi,Lembur,PPH 21,SPSI,Total Upah Bersih\n';
    filteredData.forEach(row => {
      csv += `"${row.gang_description || row.gang_code}",${row.total_employees},${row.total_hk},${row.total_premi},${row.total_lembur},${row.total_pph21},${row.total_spsi},${row.total_upah_bersih}\n`;
    });
    if (grandTotal) {
      csv += `"GRAND TOTAL",${grandTotal.total_employees},${grandTotal.total_hk},${grandTotal.total_premi},${grandTotal.total_lembur},${grandTotal.total_pph21},${grandTotal.total_spsi},${grandTotal.total_upah_bersih}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Summary_Detail_${division || 'ALL'}_${month}_${year}.csv`;
    link.click();
  };

  const reportDivisionSummary = useMemo(() => getReportDivisionSummary({
    division, divisionType, rows: filteredData,
  }), [division, divisionType, filteredData]);

  const divisionLabel = division ? reportDivisionSummary : 'Pilih Divisi';

  return (
    // SummaryReportPage renders inside DashboardLayout which provides sidebar+topbar.
    // We wrap our content in .srn-page-container so the CSS can target it.
    <div className="srn-page-container" style={{ padding: '24px 28px', background: 'var(--srn-bg)', minHeight: '100vh' }}>
      {/* ===== TOOLBAR ===== */}
          <div className="srn-toolbar">
            <div className="srn-toolbar-header">
              <h1 className="srn-toolbar-title">Summary Report Detail</h1>
              <p className="srn-toolbar-subtitle">
                Rekapitulasi total pekerja, HK, premi, lembur, potongan, dan upah bersih per estate/gang.
              </p>
            </div>
            <div className="srn-filters">
              {/* Division type */}
              <select
                className="srn-select"
                value={divisionType}
                onChange={e => { setDivisionType(e.target.value); setDivision(''); setGroupFilter(''); }}
                style={{
                  background: divisionType === 'virtual' ? '#fef3c7' : divisionType === 'real' ? '#eef2ff' : '#dcfce7',
                  color: divisionType === 'virtual' ? '#92400e' : divisionType === 'real' ? '#4f46e5' : '#166534',
                  borderColor: divisionType === 'virtual' ? '#fde68a' : divisionType === 'real' ? '#c7d2fe' : '#86efac',
                }}
              >
                <option value="all">Semua Divisi</option>
                <option value="real">Divisi Utama Saja</option>
                <option value="virtual">Divisi Virtual Saja</option>
              </select>

              {/* Division */}
              <select
                className="srn-select"
                value={division}
                onChange={e => { setDivision(e.target.value); setGroupFilter(''); }}
              >
                <option value="">Pilih {divisionType === 'virtual' ? 'Divisi Virtual' : 'Divisi'}</option>
                {(divisionType === 'all' ? [...divisions, ...virtualDivisions] : divisionType === 'virtual' ? virtualDivisions : divisions).map(d => (
                  <option key={`div-${d}`} value={d}>{d}</option>
                ))}
              </select>

              {/* Group */}
              <select className="srn-select" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
                <option value="">Semua Group</option>
                {availableGroups.map(g => (
                  <option key={`grp-${g}`} value={g}>Group {g}</option>
                ))}
              </select>

              {/* Periode */}
              <span className="srn-select" style={{ display: 'inline-flex', alignItems: 'center', padding: '0 12px', fontWeight: 700, fontSize: 12 }}>
                {periodLabel}
              </span>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Action buttons */}
              <button className="srn-btn srn-btn-primary" onClick={handlePrint}>
                <Printer size={14} /> Cetak Report
              </button>
              <button className="srn-btn" onClick={handleExport}>
                <FileText size={14} /> Export CSV
              </button>
              <button
                className="srn-btn"
                onClick={() => setShowDetail(prev => !prev)}
                style={{ background: showDetail ? '#f1f5f9' : '#fff' }}
              >
                {showDetail ? 'Hide Detail' : 'Show Detail Premi'}
              </button>
              <button
                className="srn-btn"
                onClick={() => setEditMode(prev => !prev)}
                style={{
                  background: editMode ? '#dbeafe' : '#fff',
                  color: editMode ? '#1e40af' : undefined,
                  borderColor: editMode ? '#93c5fd' : undefined,
                }}
              >
                {editMode ? 'Selesai Edit' : 'Edit Nilai'}
              </button>
              {editMode && Object.keys(editedCells).length > 0 && (
                <button className="srn-btn srn-btn-accent" onClick={handleSaveEdits} disabled={loading}>
                  <Save size={14} /> Simpan ({Object.keys(editedCells).length})
                </button>
              )}
            </div>
          </div>

          {/* ===== REPORT HEADER ===== */}
          <div className="srn-report-head">
            <div className="srn-report-title">
              <img className="srn-report-logo" src={REBINMAS_LOGO_SRC} alt="PT. Rebinmas Jaya" />
              <div>
                <h3>PT. REBINMAS JAYA</h3>
                <p>Summary Report Detail &bull; Division: <strong>{reportDivisionSummary}</strong> &bull; Periode: <strong>{periodLabel}</strong></p>
              </div>
            </div>
            <div className="srn-report-meta">
              Dibuat oleh: {user?.username || 'Admin'}<br />
              Tanggal Cetak: {printDate}
            </div>
          </div>

          {/* ===== KPI CARDS ===== */}
          <ReportKpiCards grandTotal={grandTotal} periodLabel={periodLabel} isLoading={loading} />

          {/* ===== CHART SECTION ===== */}
          <div className="srn-two-col">
            <div className="srn-panel">
              <div className="srn-panel-title">{chartData.distributionTitle}</div>
              <DistributionDonutChart items={chartData.distribution} centerLabel={chartData.distributionCenterLabel} />
            </div>
            <div className="srn-panel">
              <div className="srn-panel-title">Distribusi Per Jenis Premi</div>
              <BarChart items={chartData.premi} />
            </div>
          </div>

          {/* ===== SUMMARY TABLE ===== */}
          {loading ? (
            <div className="srn-loading">
              <div className="srn-spinner" />
              Memuat data...
            </div>
          ) : error ? (
            <div className="srn-error">! {error}</div>
          ) : (
            <SummaryTable
              data={filteredData}
              grandTotal={grandTotal}
              comparisonTotal={divisionComparisonTotal}
              onCellEdit={handleCellEdit}
              editMode={editMode}
              filteredGrandTotalLabel={filteredGrandTotalLabel}
              showDetail={showDetail}
              filteredHeaders={filteredHeaders}
              getDynamicPremiValue={getDynamicPremiValue}
            />
          )}

          {/* ===== MINI STATS ===== */}
          <ReportMiniStats
            totalDivisi={1}
            totalGang={grandTotal?.gang_count || filteredData.length}
            totalJenisPremi={premiBreakdownData.length}
            printDate={printDate}
          />

          {/* ===== PRINT SECTION ===== */}
          <div className="srn-print-section">
            <div className="srn-print-header">
              <div>
                <h2>Referensi Tampilan Print Out / PDF</h2>
                <p>A4 Landscape, 3 halaman: Summary, Uraian Premi, Detail Gang.</p>
              </div>
              <button className="srn-btn srn-btn-primary no-print" onClick={handlePrint}>
                <Printer size={14} /> Print Preview
              </button>
            </div>
            <div className="srn-print-stack">
              <PrintPage1
                grandTotal={grandTotal}
                comparisonTotal={divisionComparisonTotal}
                periodLabel={periodLabel}
                printDate={printDate}
                username={user?.username}
                filteredData={filteredData}
                filteredHeaders={filteredHeaders}
                getDynamicPremiValue={getDynamicPremiValue}
                filteredGrandTotalLabel={filteredGrandTotalLabel}
                chartData={chartData}
                divisionLabel={divisionLabel}
                totalPages={printTotalPages}
              />
              {detailPrintPages.map((rows, pageIdx) => (
                <PrintPage3
                  key={`detail-page-${pageIdx}`}
                  rows={rows}
                  grandTotal={grandTotal}
                  comparisonTotal={divisionComparisonTotal}
                  periodLabel={periodLabel}
                  printDate={printDate}
                  username={user?.username}
                  filteredGrandTotalLabel={filteredGrandTotalLabel}
                  divisionLabel={divisionLabel}
                  pageNumber={pageIdx + 2}
                  totalPages={printTotalPages}
                  isLastDetailPage={pageIdx === detailPrintPages.length - 1}
                />
              ))}
              <PrintPage2
                grandTotal={grandTotal}
                previousGrandTotal={previousGrandTotal}
                premiBreakdownData={premiBreakdownData}
                periodLabel={periodLabel}
                previousPeriodLabel={previousPeriodLabel}
                printDate={printDate}
                username={user?.username}
                divisionLabel={divisionLabel}
                pageNumber={premiPrintPageNumber}
                totalPages={printTotalPages}
              />
            </div>
          </div>
        </div>
      );
    }
