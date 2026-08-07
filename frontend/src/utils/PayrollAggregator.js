/**
 * PayrollAggregator.js
 * Client-side aggregation engine for Payroll Report.
 * Moves calculation logic from Backend to Frontend ("Dumb Backend, Smart Frontend").
 */

const DISPLAY_ONLY_TOTAL_FIELDS = new Set(['koreksi_hk']);
const ROUNDING_EPSILON = 1e-6;
const LEDGER_IDENTITY_FIELDS = new Set([
  'no', 'nik', 'nama', 'emp_code', 'jenis_kelamin', 'gender',
  'gang_code', 'loc_code', 'id', 'type', 'employee_count',
  'status_ptkp', 'kategori_ter', 'task_code', 'task_desc',
]);
const LEDGER_NON_AMOUNT_FIELDS = new Set([
  'jumlah_hk', 'hari_kerja', 'kehadiran', 'total_jam_kerja',
  'lembur_jam', 'masa_kerja_tahun', 'tarif_pajak_ter',
  'upah_dasar', 'beras_rate', 'jabatan_rate'
]);
const LEDGER_AMOUNT_FIELD_PATTERN = /^(jumlah_|total_|pot_|premi_|lembur_|gaji_|upah_|beras_|jabatan_|masa_|koreksi_|penghasilan_|pph21_|astek_|bpjs_|thr_|bonus_|exgratia_|pendapatan_|taxable_)/;

const roundPayrollTotal = (value) => {
  const numberValue = Number(value) || 0;
  if (!Number.isFinite(numberValue)) return 0;
  return Math.round(numberValue + (numberValue >= 0 ? ROUNDING_EPSILON : -ROUNDING_EPSILON));
};

const isEmployeePayrollRow = (row) => {
  if (!row || typeof row !== 'object') return false;
  if (row.type === 'employee') return true;
  if (row.type === 'gang_header' || row.type === 'gang_total' || row.type === 'grand_total') return false;
  if (row.isHeader || row.isTotal || row.isGrandTotal || row.isDivisionTotal) return false;
  return true;
};

const isGangTotalRow = (row) => row?.type === 'gang_total' || row?.isTotal === true;

const toFiniteOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPayrollLedgerAmountField = (field) => {
  const key = String(field || '').trim();
  if (!key) return false;
  const lower = key.toLowerCase();
  if (DISPLAY_ONLY_TOTAL_FIELDS.has(key) || DISPLAY_ONLY_TOTAL_FIELDS.has(lower)) return false;
  if (LEDGER_IDENTITY_FIELDS.has(key) || LEDGER_IDENTITY_FIELDS.has(lower)) return false;
  if (LEDGER_NON_AMOUNT_FIELDS.has(key) || LEDGER_NON_AMOUNT_FIELDS.has(lower)) return false;
  if (lower.endsWith('_rate') || lower.includes('_jam')) return false;
  return LEDGER_AMOUNT_FIELD_PATTERN.test(key);
};

const hasNumericField = (rows, field) => rows.some(row => toFiniteOrNull(row?.[field]) !== null);

const collectLedgerAmountFields = (rows, grandTotal = null) => {
  const fields = new Set();
  [...(Array.isArray(rows) ? rows : []), grandTotal].forEach(row => {
    if (!row || typeof row !== 'object') return;
    Object.entries(row).forEach(([field, value]) => {
      if (!isPayrollLedgerAmountField(field)) return;
      if (toFiniteOrNull(value) === null) return;
      fields.add(field);
    });
  });
  return Array.from(fields);
};

const resolveGrossDeductionWithoutAutomaticHk = (emp, absVal) => {
  const sourceTotal = absVal(emp.potongan_upah_kotor_total) || absVal(emp.pot_koreksi);
  const automaticHk = absVal(emp.koreksi_hk);
  if (sourceTotal > 0 && automaticHk > 0 && Math.abs(sourceTotal - automaticHk) <= 1) {
    return 0;
  }
  return sourceTotal;
};

export const PayrollAggregator = {
  /**
   * Calculate derived fields for a single employee row.
   * Replicates backend logic for Total Tunjangan, Total Premi, etc.
   * @param {Object} emp - Employee data object
   * @param {Object} dynamicHeaders - Map of { headerName: fieldName } for dynamic columns
   */
  calculateEmployeeFields: (emp, dynamicHeaders = {}) => {
    const val = (v) => Number(v) || 0;
    const absVal = (v) => Math.abs(val(v));

    // 1. FLATTEN NESTED STRUCTURES
    // Map backend res_address to alamat for UI and Exports
    if (emp.res_address && !emp.alamat) {
      emp.alamat = emp.res_address;
    }

    // This is critical for handling data that might be nested in the backend response

    // Flatten nested 'premi' object if it exists
    // Add 'premi_' prefix to each key so it matches column field names (e.g., premi_brondol, premi_tbs)
    // IMPORTANT: Do NOT create duplicate keys (with and without prefix) to avoid double-counting in totals
    if (emp.premi && typeof emp.premi === 'object') {
      Object.entries(emp.premi).forEach(([key, value]) => {
        // Create flat field with 'premi_' prefix if not already present
        const flatKey = key.startsWith('premi_') ? key : `premi_${key}`;
        emp[flatKey] = val(value);
        // REMOVED: Also keep the original key for backward compatibility
        // This causes double-counting because _sumRows sums ALL numeric fields
        // We now use dynamic headers with 'premi_*' pattern, so we only need the prefixed version
      });
    }

    // Flatten 'potongan_upah_kotor' if it exists as a nested object
    // IMPORTANT: Only add fields that don't already exist at root level to avoid double-counting
    if (emp.potongan_upah_kotor && typeof emp.potongan_upah_kotor === 'object') {
      // Flatten 'dynamic' sub-object if it exists (only add missing keys)
      if (emp.potongan_upah_kotor.dynamic && typeof emp.potongan_upah_kotor.dynamic === 'object') {
        Object.entries(emp.potongan_upah_kotor.dynamic).forEach(([key, value]) => {
          // Only add if key doesn't already exist at root level
          if (emp[key] === undefined || emp[key] === null) {
            emp[key] = absVal(value);
          }
        });
      }
      // Flatten direct properties (only add missing keys)
      Object.entries(emp.potongan_upah_kotor).forEach(([k, v]) => {
        if (k !== 'dynamic' && typeof v !== 'object' && (emp[k] === undefined || emp[k] === null)) {
          // Only add if the key doesn't already exist at root level
          if (k !== 'koreksi') {
            // For non-koreksi fields, add directly if missing
            emp[k] = absVal(v);
          } else {
            // For koreksi, only add if pot_koreksi is missing or zero
            if (!emp.pot_koreksi || emp.pot_koreksi === 0) {
              emp.pot_koreksi = absVal(v);
            }
          }
        }
      });
    }

    // Flatten 'potongan_upah_bersih' if it exists as a nested object
    // IMPORTANT: Only add fields that don't already exist at root level to avoid double-counting
    if (emp.potongan_upah_bersih && typeof emp.potongan_upah_bersih === 'object') {
      if (emp.potongan_upah_bersih.dynamic && typeof emp.potongan_upah_bersih.dynamic === 'object') {
        Object.entries(emp.potongan_upah_bersih.dynamic).forEach(([key, value]) => {
          // Only add if key doesn't already exist at root level
          if (emp[key] === undefined || emp[key] === null) {
            emp[key] = val(value);
          }
        });
      }
    }

    // 2. MAP DYNAMIC HEADERS TO FIELDS
    // Ensure that if a dynamic header exists, its corresponding field ID is populated
    // This fixes the mismatch where backend sends 'pot_dynamic_1' but data might be keyed by 'POTONGAN X'
    if (dynamicHeaders && Object.keys(dynamicHeaders).length > 0) {
      Object.entries(dynamicHeaders).forEach(([headerName, fieldId]) => {
        // If the fieldId (e.g. 'pot_dynamic_1') is missing or 0
        if (!emp[fieldId]) {
          // Check if the data exists under the Header Name (e.g. 'POTONGAN PREMI HARVESTING')
          // This happens if the flattening above put the value at emp['POTONGAN PREMI HARVESTING']
          const valueByHeader = emp[headerName] || emp[headerName.toUpperCase()];

          if (valueByHeader !== undefined) {
            emp[fieldId] = val(valueByHeader);
          }
        }
      });
    }

    // 0. Calculate BPJS & Aggregate Potongan Fields
    const bpjsKesPek = val(emp.pot_bpjs_kesehatan_pekerja);
    const bpjsKesMaj = val(emp.pot_bpjs_kesehatan_majikan);
    const bpjsPenPek = val(emp.pot_bpjs_pensiun_pekerja);
    const bpjsPenMaj = val(emp.pot_bpjs_pensiun_majikan);

    emp.pot_bpjs_pekerja_total = bpjsKesPek + bpjsPenPek;
    emp.pot_bpjs_kesehatan_total = bpjsKesPek + bpjsKesMaj;
    emp.pot_bpjs_pensiun_total = bpjsPenPek + bpjsPenMaj;

    // pot_bpjs_jumlah = pekerja total + majikan total
    // Note: pot_bpjs_maj might be a separate field from backend or sum of majikan components
    const bpjsMajTotal = val(emp.pot_bpjs_maj) || (bpjsKesMaj + bpjsPenMaj);
    emp.pot_bpjs_jumlah = emp.pot_bpjs_pekerja_total + bpjsMajTotal;

    // pot_total_4 (Potongan Lainnya)
    // [FIXED 2026-04-03] pot_pendapatan_lainnya DIHAPUS karena sudah termasuk di UPAH KOTOR (pendapatan_lainnya =/add ke gross, bukan subtract)
    // Formula: pph21 + pinjam + kl + tiket + alat + spsi + koreksi + bpjs_pekerja_total + astek
    emp.pot_total_4 = val(emp.pot_pph21) +
      val(emp.pot_pinjam) +
      val(emp.pot_kl) +
      val(emp.pot_tiket) +
      val(emp.pot_alat) +
      val(emp.pot_spsi) +
      absVal(emp.pot_koreksi) +
      emp.pot_bpjs_pekerja_total +
      val(emp.pot_astek);

    // 1. Total Tunjangan
    // Use backend provided value
    const total_tunjangan = val(emp.total_tunjangan);

    // 2. Total Premi
    // DIRECT FROM BACKEND - As requested by user.
    // We rely entirely on the backend's calculation for total_premi.
    // We do NOT recalculate it on the frontend to avoid mismatches.
    const total_premi = val(emp.total_premi);

    // 3. Potongan Upah Kotor
    // Use backend provided value
    const potongan_upah_kotor_total = resolveGrossDeductionWithoutAutomaticHk(emp, absVal);

    // 4. Jumlah Upah Kotor (Gross Wage)
    // Use backend provided value
    const jumlah_upah_kotor = val(emp.jumlah_upah_kotor);

    // 5. Total Potongan (Total Potongan Upah Bersih)
    // Use backend provided value to avoid double counting and ensure consistency with documentation.
    let total_potongan = val(emp.total_potongan);

    // 6. Handle Premi PPH - special deduction that gets ADDED to net salary
    const premi_pph = val(emp.premi_pph);  // This gets ADDED to net salary

    // 7. Upah Bersih (Net Wage) - adjust if Premi PPH exists
    // If we have premi_pph, we need to account for it being added to the net salary
    // Guardrail: backend total_potongan is a magnitude for calculations.
    // Excel exports may render it as signed negative, but UI aggregation must not
    // subtract raw negative values and accidentally create -(-potongan).
    // So we use the backend value directly and only normalize koreksi magnitudes above.
    const upah_bersih = val(emp.upah_bersih);

    // Return enriched object with calculated fields
    return {
      ...emp,
      total_tunjangan,
      total_premi,
      potongan_upah_kotor_total,
      jumlah_upah_kotor,
      upah_kotor_premi: jumlah_upah_kotor, // Alias often used
      total_potongan,
      upah_bersih
    };
  },

  /**
   * Flatten nested division/gang data into a flat array for AG Grid.
   * Applies calculation logic to each row.
   * @param {Object} data - Nested JSON from backend { division, gangs: [{ gang_code, employees: [] }] }
   * @param {Object} dynamicHeaders - Optional map of dynamic headers to fields
   * @returns {Array} Flat array of employee objects
   */
  flattenData: (data, dynamicHeaders = {}) => {
    if (!data || !data.gangs) return [];

    // LOG: Show source data overview
    const gangCount = data.gangs?.length || 0;
    const totalEmpRaw = data.gangs?.reduce((sum, g) => sum + (g.employees?.length || 0), 0) || 0;
    console.log(`[PayrollAggregator] flattenData IN | gangs=${gangCount} rawEmployees=${totalEmpRaw}`);

    // Check for duplicate NIKs across gangs (causes duplicate rows)
    const nikMap = {};
    const dupNik = [];
    data.gangs.forEach(gang => {
      (gang.employees || []).forEach(emp => {
        const nik = emp.nik || emp.NIK;
        if (nik) {
          if (nikMap[nik]) {
            dupNik.push({ nik, prev: nikMap[nik], curr: gang.gang_code });
          } else {
            nikMap[nik] = gang.gang_code;
          }
        }
      });
    });
    if (dupNik.length > 0) {
      console.warn(`[PayrollAggregator] DUPLICATE NIKs found (${dupNik.length}):`, dupNik.slice(0, 5));
    }

    const flatRows = [];
    data.gangs.forEach(gang => {
      if (gang.employees && Array.isArray(gang.employees)) {
        gang.employees.forEach(emp => {
          // Calculate derived fields
          const calculatedEmp = PayrollAggregator.calculateEmployeeFields(emp, dynamicHeaders);
          // Add gang code
          const processedEmp = { ...calculatedEmp, gang_code: gang.gang_code };
          flatRows.push(processedEmp);
        });
      }
    });

    // ============================================================
    // [PERATURAN BISNIS - ALWAYS ACTIVE FILTER]
    // FILTER: Selalu exclude karyawan dengan kehadiran = 0
    //
    // Rule: EXCLUDE if jumlah_hk <= 0 (same logic as backend totals).
    // Keep this aligned with payrollTotalsCalculator to avoid web/backend drift.
    // ============================================================
    const filteredRows = flatRows.filter(row => (row.jumlah_hk || 0) > 0);
    console.log(`[PayrollAggregator] flattenData OUT | flat=${flatRows.length} filtered=${filteredRows.length} (excluded ${flatRows.length - filteredRows.length})`);
    return filteredRows;
  },

  /**
   * Calculate totals for a specific gang.
   * @param {string} gangCode 
   * @param {Array} rows - Flat array of all rows
   * @returns {Object} Object containing sum of all numeric fields for the gang
   */
  calculateGangTotals: (gangCode, rows) => {
    const gangRows = rows.filter(r => r.gang_code === gangCode);
    return PayrollAggregator._sumRows(gangRows);
  },

  /**
   * Calculate Grand Total for all rows.
   * @param {Array} allRows 
   * @returns {Object} Object containing sum of all numeric fields
   */
  calculateGrandTotal: (allRows) => {
    return PayrollAggregator._sumRows(allRows);
  },

  /**
   * Calculate a displayed grand total from already-calculated gang totals.
   * This keeps global totals equal to the sum of visible/exported group totals
   * when currency formatting rounds each subtotal row.
   */
  calculateGrandTotalFromGangTotals: (gangTotals) => {
    if (!gangTotals || gangTotals.length === 0) return {};

    const totals = {};
    const identityFields = new Set([
      'no', 'nik', 'nama', 'emp_code', 'jenis_kelamin', 'gender',
      'gang_code', 'loc_code', 'id', 'type',
    ]);

    gangTotals.forEach(row => {
      Object.entries(row || {}).forEach(([key, value]) => {
        if (DISPLAY_ONLY_TOTAL_FIELDS.has(key) || identityFields.has(key)) return;
        if (typeof value === 'number' || (!isNaN(parseFloat(value)) && isFinite(value))) {
          totals[key] = (totals[key] || 0) + roundPayrollTotal(value);
        }
      });
    });

    return totals;
  },

  reconcileGangTotalsToGrandTotal: (gangTotals, grandTotal) => {
    if (!gangTotals || gangTotals.length === 0) return [];

    const identityFields = new Set([
      'no', 'nik', 'nama', 'emp_code', 'jenis_kelamin', 'gender',
      'gang_code', 'loc_code', 'id', 'type',
    ]);
    const reconciled = gangTotals.map(total => ({ ...total }));
    const fields = new Set();

    [grandTotal, ...gangTotals].forEach(total => {
      Object.entries(total || {}).forEach(([key, value]) => {
        if (DISPLAY_ONLY_TOTAL_FIELDS.has(key) || identityFields.has(key)) return;
        if (typeof value === 'number' || (!isNaN(parseFloat(value)) && isFinite(value))) {
          fields.add(key);
        }
      });
    });

    fields.forEach(key => {
      const targetValue = roundPayrollTotal(grandTotal?.[key]);
      const currentSum = reconciled.reduce((sum, total) => sum + roundPayrollTotal(total?.[key]), 0);
      const delta = targetValue - currentSum;
      if (delta === 0) return;

      let targetIndex = 0;
      let targetMagnitude = -1;
      reconciled.forEach((total, index) => {
        const magnitude = Math.abs(Number(total?.[key]) || 0);
        if (magnitude > targetMagnitude) {
          targetMagnitude = magnitude;
          targetIndex = index;
        }
      });

      reconciled[targetIndex][key] = roundPayrollTotal(reconciled[targetIndex][key]) + delta;
    });

    return reconciled;
  },

  reconcileDisplayedGangTotalRows: (rows, grandTotal, options = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows || [];

    const gangTotalRows = rows.filter(isGangTotalRow);
    if (gangTotalRows.length === 0) return rows;

    const employeeRows = rows.filter(isEmployeePayrollRow);
    const shouldRebuildFromEmployees = Boolean(options.rebuildFromEmployees);
    const targetGrandTotal = grandTotal || (shouldRebuildFromEmployees
      ? PayrollAggregator.calculateGrandTotal(employeeRows)
      : null);

    if (!targetGrandTotal) return rows;

    const sourceGangTotals = gangTotalRows.map(row => {
      if (!shouldRebuildFromEmployees) return { ...row };
      return {
        ...row,
        ...PayrollAggregator.calculateGangTotals(row.gang_code, employeeRows)
      };
    });
    const reconciledGangTotals = PayrollAggregator.reconcileGangTotalsToGrandTotal(sourceGangTotals, targetGrandTotal);

    let subtotalIndex = 0;
    return rows.map(row => {
      if (!isGangTotalRow(row)) return row;

      const reconciled = reconciledGangTotals[subtotalIndex] || row;
      subtotalIndex += 1;

      return {
        ...row,
        ...reconciled,
        type: row.type,
        isTotal: row.isTotal,
        id: row.id,
        gang_code: row.gang_code,
        nama: row.nama,
        emp_code: row.emp_code,
        no: row.no,
        nik: row.nik,
        jenis_kelamin: row.jenis_kelamin
      };
    });
  },

  buildDisplayLedgerRows: (rows, grandTotal = null, options = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows || [];

    const allocateToGrandTotal = Boolean(options.allocateToGrandTotal && grandTotal);
    const roundedRows = rows.map(row => {
      if (!isEmployeePayrollRow(row)) return row;

      const next = { ...row };
      collectLedgerAmountFields([row]).forEach(field => {
        const value = toFiniteOrNull(next[field]);
        if (value !== null) {
          next[field] = roundPayrollTotal(value);
        }
      });
      return next;
    });

    const employeeRows = roundedRows.filter(isEmployeePayrollRow);
    if (employeeRows.length === 0) return roundedRows;

    if (allocateToGrandTotal) {
      const fields = collectLedgerAmountFields(employeeRows, grandTotal)
        .filter(field => hasNumericField(employeeRows, field));
      const maxRoundingDelta = Math.max(10, employeeRows.length * 2);

      fields.forEach(field => {
        const targetValue = roundPayrollTotal(grandTotal?.[field]);
        const currentValue = employeeRows.reduce((sum, row) => sum + roundPayrollTotal(row?.[field]), 0);
        const delta = targetValue - currentValue;
        if (delta === 0) return;

        // Guard: only allocate small rounding residue. Larger deltas indicate real data drift.
        if (Math.abs(delta) > maxRoundingDelta) return;

        let targetIndex = -1;
        let targetMagnitude = -1;
        employeeRows.forEach((row, index) => {
          const value = toFiniteOrNull(row?.[field]);
          if (value === null) return;
          const magnitude = Math.abs(value);
          if (magnitude > targetMagnitude) {
            targetMagnitude = magnitude;
            targetIndex = index;
          }
        });

        if (targetIndex < 0) return;
        employeeRows[targetIndex][field] = roundPayrollTotal(employeeRows[targetIndex][field]) + delta;
      });
    }

    return roundedRows.map(row => {
      if (!isGangTotalRow(row)) return row;

      const rebuiltTotals = PayrollAggregator.calculateGangTotals(row.gang_code, employeeRows);
      return {
        ...row,
        ...rebuiltTotals,
        type: row.type,
        isTotal: row.isTotal,
        id: row.id,
        gang_code: row.gang_code,
        nama: row.nama,
        emp_code: row.emp_code,
        no: row.no,
        nik: row.nik,
        jenis_kelamin: row.jenis_kelamin
      };
    });
  },

  /**
   * Internal helper to sum an array of rows.
   * Dynamically sums all numeric keys found in ALL rows (handles sparse data).
   * Also handles nested objects like premi, potongan_upah_kotor, potongan_upah_bersih.
   */
  _sumRows: (rows) => {
    if (!rows || rows.length === 0) return {};

    const totals = {};

    // List of known numeric fields to always include in totals (even if value is 0)
    const knownNumericFields = [
      // Identitas & Absensi
      'jumlah_hk', 'hari_kerja', 'kehadiran', 'total_jam_kerja',
      // Gaji Pokok
      'gaji_pokok_ideal', 'gaji_pokok_aktual', 'upah_dasar',
      // Tunjangan
      'beras_jumlah', 'jabatan_jumlah', 'masa_kerja_jumlah', 'lembur_jumlah',
      'total_tunjangan',
      // Premi
      'premi_brondol', 'premi_pruning', 'premi_tbs', 'premi_pupuk', 'premi_rawat',
      'total_premi',
      // Potongan Upah Kotor
      'pot_koreksi', 'pot_kontan', 'pot_pinjam', 'pot_kl', 'pot_tiket',
      'pot_alat', 'pot_thr', 'pot_spsi', 'pot_astek', 'pot_pph21',
      'potongan_upah_kotor_total',
      // Potongan Upah Bersih
      'pot_bpjs_kesehatan_pekerja', 'pot_bpjs_kesehatan_majikan', 'pot_bpjs_kesehatan_jumlah',
      'pot_bpjs_pensiun_pekerja', 'pot_bpjs_pensiun_majikan', 'pot_bpjs_pensiun_jumlah',
      'pot_bpjs_pekerja_total', 'pot_bpjs_jumlah',
      'pot_astek_pekerja', 'pot_astek_majikan', 'pot_astek_jumlah',
      'total_potongan',
      // Total & Upah
      'jumlah_upah_kotor', 'upah_kotor_pajak', 'penghasilan_bruto', 'pph21_ter',
      'upah_bersih',
      // Pendapatan Lainnya (THR, Bonus, Custom) - Upah Kotor addition
      // Note: Dynamic custom types (e.g., pendapatan_kontanan, pendapatan_insentif) are auto-discovered by _sumRows
      'pendapatan_thr', 'pendapatan_bonus', 'pendapatan_custom', 'pendapatan_lainnya',
      // Pendapatan Lainnya - Potongan Upah Bersih deduction
      'pot_pendapatan_lainnya',
      // Taxable breakdown for PAJAK section
      'taxable_pendapatan_thr', 'taxable_pendapatan_bonus', 'taxable_pendapatan_custom', 'taxable_pendapatan_lainnya',
    ];

    // Initialize all known fields to 0
    knownNumericFields.forEach(key => totals[key] = 0);

    // Dynamic discovery of additional numeric fields from rows
    const numericKeysSet = new Set(knownNumericFields);

    rows.forEach(row => {
      // SAFETY CHECK: Skip header/total/footer rows to prevent double counting
      if (row.isTotal || row.isHeader || row.isGrandTotal || row.isDivisionTotal) return;
      if (row.nama && (String(row.nama).startsWith('TOTAL') || String(row.nama).startsWith('GRAND TOTAL'))) return;

      // First, flatten nested objects and discover all keys
      const flattenedRow = { ...row };

      // Flatten nested 'premi' object
      if (flattenedRow.premi && typeof flattenedRow.premi === 'object') {
        Object.entries(flattenedRow.premi).forEach(([key, value]) => {
          const flatKey = key.startsWith('premi_') ? key : `premi_${key}`;
          flattenedRow[flatKey] = Number(value) || 0;
        });
      }

      // Flatten nested 'potongan_upah_kotor' object
      if (flattenedRow.potongan_upah_kotor && typeof flattenedRow.potongan_upah_kotor === 'object') {
        if (flattenedRow.potongan_upah_kotor.dynamic && typeof flattenedRow.potongan_upah_kotor.dynamic === 'object') {
          Object.entries(flattenedRow.potongan_upah_kotor.dynamic).forEach(([key, value]) => {
            if (typeof value === 'number') {
              flattenedRow[key] = Math.abs(value);
            }
          });
        }
        // Handle direct properties
        Object.entries(flattenedRow.potongan_upah_kotor).forEach(([k, v]) => {
          if (k !== 'dynamic' && typeof v === 'number') {
            if (k === 'koreksi') {
              if (!flattenedRow.pot_koreksi) flattenedRow.pot_koreksi = Math.abs(v);
            } else if (!flattenedRow[k]) {
              flattenedRow[k] = Math.abs(v);
            }
          }
        });
      }

      // Flatten nested 'potongan_upah_bersih' object
      if (flattenedRow.potongan_upah_bersih && typeof flattenedRow.potongan_upah_bersih === 'object') {
        if (flattenedRow.potongan_upah_bersih.dynamic && typeof flattenedRow.potongan_upah_bersih.dynamic === 'object') {
          Object.entries(flattenedRow.potongan_upah_bersih.dynamic).forEach(([key, value]) => {
            if (typeof value === 'number') {
              flattenedRow[key] = value;
            }
          });
        }
      }

      // Now discover all numeric keys in the flattened row
      Object.keys(flattenedRow).forEach(key => {
        const val = flattenedRow[key];

        // Skip non-numeric fields
        if (DISPLAY_ONLY_TOTAL_FIELDS.has(key)) {
          return;
        }

        if (['nik', 'no', 'id', 'year', 'month', 'emp_code', 'nik_ktp', 'nama', 'emp_name',
             'jenis_kelamin', 'gender', 'status_ptkp', 'kategori_ter', 'gang_code', 'loc_code',
             'task_code', 'task_desc', 'created_at', 'updated_at'].includes(key.toLowerCase())) {
          return;
        }
        if (key.toLowerCase().includes('code') || key.toLowerCase().includes('name') ||
            key.toLowerCase().includes('phone') || key.toLowerCase().includes('email') ||
            key.toLowerCase().includes('alamat') || key.toLowerCase().includes('jabatan') && !key.includes('jumlah')) {
          return;
        }

        // Check if value is numeric
        if (typeof val === 'number' || (!isNaN(parseFloat(val)) && isFinite(val))) {
          numericKeysSet.add(key);
        }
      });
    });

    const numericKeys = Array.from(numericKeysSet);

    // Initialize totals for all discovered keys
    numericKeys.forEach(key => {
      if (totals[key] === undefined) totals[key] = 0;
    });

    // Sum up all rows
    rows.forEach(row => {
      // SAFETY CHECK: Skip header/total/footer rows
      if (row.isTotal || row.isHeader || row.isGrandTotal || row.isDivisionTotal) return;
      if (row.nama && (String(row.nama).startsWith('TOTAL') || String(row.nama).startsWith('GRAND TOTAL'))) return;

      // Flatten the row for calculation
      const calcRow = { ...row };

      // Flatten nested objects for calculation
      if (calcRow.premi && typeof calcRow.premi === 'object') {
        Object.entries(calcRow.premi).forEach(([key, value]) => {
          const flatKey = key.startsWith('premi_') ? key : `premi_${key}`;
          calcRow[flatKey] = Number(value) || 0;
        });
      }

      // Flatten potongan_upah_kotor
      if (calcRow.potongan_upah_kotor && typeof calcRow.potongan_upah_kotor === 'object') {
        if (calcRow.potongan_upah_kotor.dynamic && typeof calcRow.potongan_upah_kotor.dynamic === 'object') {
          Object.entries(calcRow.potongan_upah_kotor.dynamic).forEach(([key, value]) => {
            if (typeof value === 'number') calcRow[key] = Math.abs(value);
          });
        }
        Object.entries(calcRow.potongan_upah_kotor).forEach(([k, v]) => {
          if (k !== 'dynamic' && typeof v === 'number') {
            if (k === 'koreksi') {
              if (!calcRow.pot_koreksi || calcRow.pot_koreksi === 0) calcRow.pot_koreksi = Math.abs(v);
            } else if (!calcRow[k]) {
              calcRow[k] = Math.abs(v);
            }
          }
        });
      }

      // Flatten potongan_upah_bersih
      if (calcRow.potongan_upah_bersih && typeof calcRow.potongan_upah_bersih === 'object') {
        if (calcRow.potongan_upah_bersih.dynamic && typeof calcRow.potongan_upah_bersih.dynamic === 'object') {
          Object.entries(calcRow.potongan_upah_bersih.dynamic).forEach(([key, value]) => {
            if (typeof value === 'number') calcRow[key] = value;
          });
        }
      }

      // Sum up all numeric keys
      numericKeys.forEach(key => {
        const val = parseFloat(calcRow[key]) || 0;
        totals[key] += val;
      });
    });

    return totals;
  }
};
