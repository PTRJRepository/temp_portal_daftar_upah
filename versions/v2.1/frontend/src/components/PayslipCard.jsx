import React from "react";
import "../styles/payslip-print.css";

// Helper to format currency
const formatCurrency = (value) => {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// Helper to get month name in Indonesian
const getMonthName = (month) => {
  const months = [
    "",
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return months[month] || "";
};

const formatIncomeKeyLabel = (key) => {
  return key
    .replace(/^pendapatan_/, "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const sumPositiveFields = (source, predicate) => {
  return Object.entries(source || {}).reduce((sum, [key, val]) => {
    if (!predicate(key)) return sum;
    const amount = toFiniteNumber(val);
    return amount > 0 ? sum + amount : sum;
  }, 0);
};

const deductionAmount = (value) => Math.abs(toFiniteNumber(value));

const sumDeductionFields = (source, predicate) => {
  return Object.entries(source || {}).reduce((sum, [key, val]) => {
    if (!predicate(key)) return sum;
    return sum + deductionAmount(val);
  }, 0);
};

const isPositiveAmount = (value) => toFiniteNumber(value) > 0;

/**
 * PayslipCard - Compact payslip component for printing (6 per A4)
 * @param {Object} props
 * @param {Object} props.data - Employee checkroll data
 * @param {number} props.month - Month number
 * @param {number} props.year - Year
 */
export default function PayslipCard({ data, month, year }) {
  if (!data || !data.payroll_data) {
    return (
      <div className="payslip-card">
        <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
          Data Gaji Tidak Ditemukan ({data?.emp_code || "N/A"})
        </div>
      </div>
    );
  }

  const { emp_code, employee, payroll_data, attendance } = data;

  // Get data from payroll_data or employee
  const empInfo = employee || {};
  const payroll = payroll_data || {};
  const att = attendance || {};

  // Helper to safely get numeric values
  const getNum = (key) => {
    const val = payroll[key] ?? empInfo[key];
    return toFiniteNumber(val);
  };

  // --- CALCULATIONS ---
  const hk = getNum("jumlah_hk") || getNum("hari_kerja");
  const rate = getNum("upah_dasar") || getNum("upah_harian");
  const gajiPokok = getNum("gaji_pokok") || getNum("upah_pokok") || hk * rate;

  // Handle both nested attendance object and flat structure from API
  const attHadir =
    att.summary?.total_hadir ??
    getNum("hari_kerja") ??
    getNum("kehadiran") ??
    0;
  const attMgg = att.summary?.cuti_minggu ?? getNum("cuti_minggu_hari") ?? 0;
  const attCuti = att.summary?.cuti_tahunan ?? getNum("cuti_tahunan_hari") ?? 0;
  const attSakit =
    att.summary?.cuti_sakit ?? getNum("cuti_sakit_haid_hari") ?? 0;
  const attLibur = att.summary?.libur ?? getNum("cuti_nasional_hari") ?? 0;
  const attAlpa = att.summary?.alpa ?? getNum("alpa") ?? 0;

  // --- GAJI POKOK BREAKDOWN ---
  // User requested to show days x rate for each type
  const gpBreakdown = [
    { label: "Kehadiran", days: attHadir, amount: attHadir * rate },
    { label: "Minggu", days: attMgg, amount: attMgg * rate },
    { label: "Cuti", days: attCuti, amount: attCuti * rate },
    { label: "Sakit", days: attSakit, amount: attSakit * rate },
    { label: "Libur Nas", days: attLibur, amount: attLibur * rate },
  ].filter((item) => item.days > 0);

  // Tunjangan Breakdown
  const tunjanganList = [
    {
      label: "Beras",
      value: getNum("beras_jumlah") || getNum("tunjangan_beras"),
    },
    {
      label: "Jabatan",
      value: getNum("jabatan_jumlah") || getNum("tunjangan_jabatan"),
    },
    {
      label: "Masa Kerja",
      value: getNum("masa_kerja_jumlah") || getNum("tunjangan_masa_kerja"),
    },
  ].filter((item) => item.value > 0);
  const totalTunjangan = tunjanganList.reduce(
    (sum, item) => sum + item.value,
    0,
  );

  const koreksiBrondolTotal = Object.entries(payroll || {}).reduce(
    (sum, [key, val]) => {
      const normalizedKey = key.toLowerCase().replace(/berondol/g, "brondol");
      if (!normalizedKey.startsWith("koreksi_") || !normalizedKey.includes("brondol")) {
        return sum;
      }
      return sum + Math.abs(toFiniteNumber(val));
    },
    0,
  );

  // Premi Breakdown
  const premiList = [];
  const premiBrondolBase = getNum("premi_brondol") || toFiniteNumber(payroll.premi?.brondol);
  const premiBrondolDisplay = Math.max(0, premiBrondolBase - koreksiBrondolTotal);
  if (premiBrondolDisplay > 0)
    premiList.push({ label: "Brondol", value: premiBrondolDisplay });

  // Dynamic premiums from premi object (API format)
  if (payroll.premi && typeof payroll.premi === "object") {
    Object.entries(payroll.premi).forEach(([key, val]) => {
      if (key !== "brondol" && key !== "koreksi" && val > 0) {
        const label = key
          .replace(/premi_/i, "")
          .replace(/_/g, " ")
          .toUpperCase();
        premiList.push({ label, value: val });
      }
    });
  } else {
    // Fallback: Handle flat premi_* fields from UI data
    Object.entries(payroll).forEach(([key, val]) => {
      if (
        key.startsWith("premi_") &&
        key !== "premi_brondol" &&
        key !== "premi_pph" &&
        typeof val === "number" &&
        val > 0
      ) {
        const label = key
          .replace("premi_", "")
          .replace(/_/g, " ")
          .toUpperCase();
        premiList.push({ label, value: val });
      }
    });
  }

  const totalPremi = Math.max(0, getNum("total_premi") - koreksiBrondolTotal);
  const totalPremiDetail = premiList.reduce((sum, item) => sum + item.value, 0);
  const displayedTotalPremi = totalPremi > 0 ? totalPremi : totalPremiDetail;
  const lemburJam = getNum("lembur_jam") || getNum("total_jam_lembur");
  const lemburJumlah =
    getNum("lembur_jumlah") ||
    getNum("total_upah_lembur") ||
    getNum("upah_lembur");

  // Koreksi mengurangi pendapatan langsung, bukan potongan bersih.
  // Guardrail: deductions/koreksi are magnitude values in payslip math.
  // Do not subtract raw signed values, because `gross - (-200)` would increase pay.
  const dynamicKoreksiTotal = sumDeductionFields(
    payroll,
    (key) => {
      const normalizedKey = key.toLowerCase().replace(/berondol/g, "brondol");
      return key.startsWith("koreksi_") && key !== "koreksi_hk" && !normalizedKey.includes("brondol");
    },
  );
  const totalPotKotor =
    Math.max(0, deductionAmount(getNum("potongan_upah_kotor_total")) - koreksiBrondolTotal) ||
    Math.max(0, deductionAmount(getNum("pot_koreksi")) - koreksiBrondolTotal) ||
    dynamicKoreksiTotal;

  // Potongan Upah Bersih
  const potBersihList = [
    {
      label: "BPJS Kes (1%)",
      value:
        deductionAmount(getNum("pot_bpjs_kesehatan_pekerja") || getNum("pot_bpjs_kesehatan")),
    },
    {
      label: "BPJS Pens (1%)",
      value: deductionAmount(getNum("pot_bpjs_pensiun_pekerja") || getNum("pot_bpjs_pensiun")),
    },
    {
      label: "Astek (2%)",
      value:
        deductionAmount(getNum("pot_astek_pekerja") || getNum("pot_astek") || getNum("pot_jht")),
    },
    { label: "SPSI", value: deductionAmount(getNum("pot_spsi")) },
    { label: "PPh 21", value: deductionAmount(getNum("pot_pph21") || getNum("pph21_ter")) },
    { label: "Potongan PPh21", value: deductionAmount(getNum("POTONGAN_PPH21")) },
  ].filter((item) => item.value > 0);

  // Dynamic deductions from 'potongan_' fields in payroll record
  Object.entries(payroll).forEach(([key, val]) => {
    const normalizedKey = key.toLowerCase();
    if (
      key === "potongan_upah_kotor_total" ||
      key.startsWith("potongan_upah_kotor") ||
      normalizedKey.includes("pendapatan_lain")
    )
      return;
    if (key.startsWith("potongan_") && typeof val === "number" && deductionAmount(val) > 0) {
      const label = key
        .replace("potongan_", "")
        .replace(/_/g, " ")
        .toUpperCase();
      // Avoid duplicates with hardcoded list
      const isDuplicate = ["PPJK", "BPJS", "ASTEK", "SPSI", "PPH21"].some((k) =>
        label.includes(k),
      );
      if (
        !isDuplicate &&
        !potBersihList.some((p) => p.label.toUpperCase() === label)
      ) {
        potBersihList.push({ label, value: deductionAmount(val) });
      }
    }
  });

  const premiPph = getNum("premi_pph") || getNum("PREMI_PPH");
  if (premiPph > 0) {
    potBersihList.push({
      label: "Premi PPh (+)",
      value: premiPph,
      isCredit: true,
    });
  }

  // --- THR & OTHER INCOMES ---
  const otherIncomeItems = [];
  const otherIncomeSeen = new Set();
  const pushOtherIncome = (label, amount, type = null) => {
    const value = Number(amount) || 0;
    if (value <= 0) return;
    const cleanLabel = String(label || type || "Pendapatan Lainnya").trim();
    const cleanType = type ? String(type).trim().toUpperCase() : "";
    const key = `${cleanType}:${cleanLabel}`.toLowerCase();
    if (otherIncomeSeen.has(key)) return;
    otherIncomeSeen.add(key);
    otherIncomeItems.push({ name: cleanLabel, amount: value, type: cleanType });
  };

  pushOtherIncome(
    "THR",
    getNum("thr_jumlah") || getNum("pendapatan_thr"),
    "THR",
  );
  pushOtherIncome(
    "Bonus",
    getNum("bonus_jumlah") || getNum("pendapatan_bonus"),
    "BONUS",
  );
  pushOtherIncome("Custom", getNum("pendapatan_custom"), "CUSTOM");
  pushOtherIncome(
    "Pendapatan Tidak Tetap",
    getNum("pendapatan_tidak_tetap"),
    "CUSTOM",
  );

  if (Array.isArray(payroll.other_incomes)) {
    payroll.other_incomes.forEach((income) => {
      const type = String(income?.type || "")
        .trim()
        .toUpperCase();
      const label =
        income?.name || income?.income_name || type || "Pendapatan Lainnya";
      pushOtherIncome(label, income?.amount, type || null);
    });
  }

  const excludedOtherIncomeKeys = new Set([
    "pendapatan_thr",
    "pendapatan_bonus",
    "pendapatan_custom",
    "pendapatan_tidak_tetap",
    "pendapatan_lainnya",
    "total_pendapatan_lainnya",
  ]);

  Object.entries(payroll).forEach(([key, val]) => {
    if (!key.startsWith("pendapatan_") || excludedOtherIncomeKeys.has(key))
      return;
    if (!isPositiveAmount(val)) return;
    const label = formatIncomeKeyLabel(key);
    pushOtherIncome(label, val, label.toUpperCase());
  });

  const totalOtherIncome =
    getNum("total_pendapatan_lainnya") ||
    getNum("pendapatan_lainnya") ||
    otherIncomeItems.reduce((sum, item) => sum + item.amount, 0);
  const detailedOtherIncomeTotal = otherIncomeItems.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  if (otherIncomeItems.length === 0 && totalOtherIncome > 0) {
    pushOtherIncome("Pendapatan Lainnya", totalOtherIncome, null);
  } else if (totalOtherIncome > detailedOtherIncomeTotal) {
    pushOtherIncome(
      "Lainnya",
      totalOtherIncome - detailedOtherIncomeTotal,
      null,
    );
  }

  const jumlahUpahKotor =
    getNum("jumlah_upah_kotor") || getNum("penghasilan_bruto");
  const payslipGrossIncome = Math.max(0, jumlahUpahKotor - totalOtherIncome);

  // Payslip deductions exclude other income; other income is tax-detail-only.
  const rawTotalPotongan =
    deductionAmount(getNum("total_potongan_bersih") || getNum("total_potongan"));
  const otherIncomeDeduction = sumDeductionFields(
    payroll,
    (key) => key.startsWith("potongan_") && key.includes("pendapatan_lain"),
  );
  const itemizedTotalPotongan =
    potBersihList.reduce(
      (acc, curr) => acc + (curr.isCredit ? -curr.value : curr.value),
      0,
    );
  const totalPotongan =
    itemizedTotalPotongan > 0
      ? itemizedTotalPotongan
      : Math.max(0, rawTotalPotongan - otherIncomeDeduction);
  // Payslip displays total potongan as magnitude, so THP subtracts that magnitude once.
  const upahBersih = payslipGrossIncome - totalPotongan;

  return (
    <div className="payslip-card">
      {/* Dense Rebinmas watermark */}
      <div className="payslip-watermark" aria-hidden="true">
        {Array.from({ length: 45 }, (_, idx) => (
          <span key={idx} className="payslip-watermark__tile">
            <img
              className="payslip-watermark__image"
              src="/images/rebinmas.webp"
              alt=""
            />
            <span className="payslip-watermark__label">REBINMAS</span>
          </span>
        ))}
      </div>

      {/* Header */}
      <div className="payslip-card-header">
        <div className="payslip-card-company">
          <img
            className="payslip-header-logo"
            src="/images/rebinmas.webp"
            alt=""
          />
          <strong>PT REBINMAS JAYA</strong>
        </div>
        <div className="payslip-card-title">SLIP GAJI KARYAWAN</div>
        <div className="payslip-card-period">
          Periode: {getMonthName(month)} {year}
        </div>
      </div>

      {/* Employee Info - 2 Columns to save space */}
      <div className="payslip-card-info">
        <div className="payslip-info-row">
          <span className="payslip-info-label">NIK/Nama</span>
          <span className="payslip-info-value">
            : {emp_code} - {empInfo.nama || empInfo.EmpName || "-"}
          </span>
        </div>
        <div className="payslip-info-row">
          <span className="payslip-info-label">Jabatan</span>
          <span className="payslip-info-value">: {empInfo.jabatan || "-"}</span>
        </div>
        <div className="payslip-info-row">
          <span className="payslip-info-label">Gang</span>
          <span className="payslip-info-value">
            : {empInfo.gang_code || empInfo.GangCode || "-"}
          </span>
        </div>
        <div className="payslip-info-row">
          <span className="payslip-info-label">HK/Rate</span>
          <span className="payslip-info-value">
            : {hk} / {formatCurrency(rate)}
          </span>
        </div>
        <div className="payslip-info-row">
          <span className="payslip-info-label">PTKP</span>
          <span className="payslip-info-value">
            : {payroll.status_ptkp || "-"} ({payroll.kategori_ter || "-"})
          </span>
        </div>
      </div>

      <div className="payslip-activity-summary">
        <span>Ringkasan Aktivitas</span>
        <strong>{`HK: ${hk || 0}`}</strong>
        {lemburJam > 0 && (
          <strong>{`Lembur: ${lemburJam}j = ${formatCurrency(lemburJumlah)}`}</strong>
        )}
      </div>

      {/* Content - Two Columns */}
      <div className="payslip-card-content">
        {/* Left: Penerimaan */}
        <div className="payslip-card-column payslip-card-column--income">
          <div className="payslip-column-header">PENERIMAAN (Income)</div>

          <div className="payslip-subheader">Gaji Pokok:</div>
          {gpBreakdown.map((item, idx) => (
            <div key={`gp-${idx}`} className="payslip-item payslip-item-indent">
              <span className="payslip-item-label">
                - {item.label} ({item.days} hr)
              </span>
              <span className="payslip-item-value">
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))}
          <div
            className="payslip-item"
            style={{ borderTop: "0.5px solid #ccc", marginTop: "1px" }}
          >
            <span
              className="payslip-item-label"
              style={{ fontWeight: "bold", paddingLeft: "2mm" }}
            >
              Subtotal Gaji Pokok
            </span>
            <span className="payslip-item-value" style={{ fontWeight: "bold" }}>
              {formatCurrency(gajiPokok)}
            </span>
          </div>

          {tunjanganList.length > 0 && (
            <>
              <div className="payslip-subheader">Tunjangan:</div>
              {tunjanganList.map((item, idx) => (
                <div
                  key={`tunj-${idx}`}
                  className="payslip-item payslip-item-indent"
                >
                  <span className="payslip-item-label">- {item.label}</span>
                  <span className="payslip-item-value">
                    {formatCurrency(item.value)}
                  </span>
                </div>
              ))}
              <div className="payslip-subtotal-line">
                <span className="payslip-item-label">Subtotal Tunjangan</span>
                <span className="payslip-item-value">
                  {formatCurrency(totalTunjangan)}
                </span>
              </div>
            </>
          )}

          {premiList.length > 0 && (
            <>
              <div className="payslip-subheader">Premi:</div>
              {premiList.map((item, idx) => (
                <div
                  key={`premi-${idx}`}
                  className="payslip-item payslip-item-indent"
                >
                  <span className="payslip-item-label">- {item.label}</span>
                  <span className="payslip-item-value">
                    {formatCurrency(item.value)}
                  </span>
                </div>
              ))}
              <div className="payslip-subtotal-line">
                <span className="payslip-item-label">Subtotal Premi</span>
                <span className="payslip-item-value">
                  {formatCurrency(displayedTotalPremi)}
                </span>
              </div>
            </>
          )}

          {lemburJumlah > 0 && (
            <div className="payslip-item">
              <span
                className="payslip-item-label"
                style={{ fontWeight: "bold" }}
              >
                Lembur ({lemburJam}j)
              </span>
              <span className="payslip-item-value">
                {formatCurrency(lemburJumlah)}
              </span>
            </div>
          )}

          {totalPotKotor > 0 && (
            <div className="payslip-item payslip-income-correction">
              <span className="payslip-item-label">Koreksi Pendapatan (-)</span>
              <span className="payslip-item-value payslip-negative">
                {formatCurrency(totalPotKotor)}
              </span>
            </div>
          )}

          <div className="total-line-wrapper">
            <div className="payslip-total-marker">
              <span>---- +</span>
            </div>
            <div className="payslip-total-line">
              <span className="payslip-item-label">TOTAL PENDAPATAN KOTOR</span>
              <span className="payslip-item-value">
                {formatCurrency(payslipGrossIncome)}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Potongan */}
        <div className="payslip-card-column payslip-card-column--deduction">
          <div className="payslip-column-header">POTONGAN (Deduction)</div>

          {potBersihList.length > 0 && (
            <>
              <div className="payslip-subheader">Pot. Upah Bersih:</div>
              {potBersihList.map((item, idx) => (
                <div key={`potb-${idx}`} className="payslip-item payslip-item-indent">
                  <span className="payslip-item-label">
                    {item.isCredit ? "+" : "-"} {item.label}
                  </span>
                  <span
                    className={`payslip-item-value ${item.isCredit ? "" : "payslip-negative"}`}
                    style={{
                      fontWeight: item.isCredit ? "bold" : undefined,
                    }}
                  >
                    {formatCurrency(item.value)}
                  </span>
                </div>
              ))}
            </>
          )}

          <div className="total-line-wrapper">
            <div className="payslip-total-marker">
              <span>---- +</span>
            </div>
            <div className="payslip-total-line">
              <span className="payslip-item-label">TOTAL POTONGAN</span>
              <span className="payslip-item-value payslip-negative">
                {formatCurrency(totalPotongan)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* THR Note Section - Only show if there is actual THR */}
      {/* Footer - Take Home Pay */}
      <div className="payslip-card-footer">
        <div className="payslip-thp-label">
          PENERIMAAN BERSIH (Take Home Pay)
        </div>
        <div className="payslip-thp-value">Rp {formatCurrency(upahBersih)}</div>
      </div>
    </div>
  );
}
