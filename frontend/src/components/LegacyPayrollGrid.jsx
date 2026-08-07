/**
 * LEGACY COMPONENT - PAYROLL GRID
 * 
 * This component is now LEGACY and no longer used in the application.
 * It uses AG Grid which has been replaced by a custom table implementation.
 * 
 * The custom table implementation is now used in CustomPayrollTable.jsx
 * and related components for better performance and customization.
 * 
 * This file is kept for reference only and should not be used in new development.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Eye } from 'lucide-react'
import { AgGridReact } from 'ag-grid-react'
import HierHeaderGroup from './common/HierHeaderGroup'
import SelectedCellStatusBar from './common/SelectedCellStatusBar'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import 'ag-grid-enterprise'
import '../styles/ag-grid-professional.css'

import { fetchColumnDefinitions } from '../services/headerService'
import { getLockedRawTree } from '../services/lockedDivisionService'
import { isProdMode } from '../utils/prodModeUtils'
import { PayrollAggregator } from '../utils/PayrollAggregator'
import CellInspector from './CellInspector'

// Helper to format integers
const formatInteger = (value) => {
  if (value === null || value === undefined) return ''
  return new Intl.NumberFormat('id-ID').format(value)
}

const GangHeaderRenderer = (params) => {
  return (
    <div className="gang-header-segment">
      GANG: {params.data.gang_code}
    </div>
  )
}

export default function LegacyPayrollGrid({
  token,
  month,
  year,
  gangCode,
  division,
  onLoadStart,
  onLoadEnd,
  useLocked = false, // For locked division mode (production)
  onViewEmployeeDetail = null, // Callback when user wants to view employee detail
  onRowCountChange = null, // Callback to report row count to parent
  fontSize = 100 // Font size scaling percentage (default 100%)
}) {
  const gridRef = useRef(null)
  const [rows, setRows] = useState([])
  const [pinnedBottom, setPinnedBottom] = useState([])
  const [columnDefs, setColumnDefs] = useState([])
  const [error, setError] = useState('')

  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [selectedCell, setSelectedCell] = useState(null)
  const [selectionStats, setSelectionStats] = useState(null) // For range selection stats popup

  // Handle range selection change for stats popup
  const onRangeSelectionChanged = useCallback((params) => {
    const api = params.api
    const cellRanges = api.getCellRanges()

    if (!cellRanges || cellRanges.length === 0) {
      setSelectionStats(null)
      return
    }

    const values = []
    cellRanges.forEach(range => {
      const startRow = Math.min(range.startRow.rowIndex, range.endRow.rowIndex)
      const endRow = Math.max(range.startRow.rowIndex, range.endRow.rowIndex)

      range.columns.forEach(col => {
        for (let rowIdx = startRow; rowIdx <= endRow; rowIdx++) {
          const rowNode = api.getDisplayedRowAtIndex(rowIdx)
          if (rowNode && rowNode.data) {
            const val = api.getValue(col, rowNode)
            const num = parseFloat(val)
            if (!isNaN(num)) {
              values.push(num)
            }
          }
        }
      })
    })

    if (values.length > 0) {
      const sum = values.reduce((a, b) => a + b, 0)
      const avg = sum / values.length
      const min = Math.min(...values)
      const max = Math.max(...values)
      setSelectionStats({
        count: values.length,
        sum,
        avg,
        min,
        max
      })
    } else {
      setSelectionStats(null)
    }
  }, [])

  const onCellClicked = useCallback((params) => {
    if (params.colDef.field === 'nik' || params.colDef.field === 'nama') {
      params.node.setSelected(!params.node.isSelected())
    } else {
      setSelectedCell({
        data: params.data,
        colId: params.colDef.field,
        rowIndex: params.rowIndex,
        value: params.value
      })
    }
  }, [])

  const onCellDoubleClicked = useCallback((params) => {
    const data = params.data
    const empId = data?.nik || data?.NIK
    if (onViewEmployeeDetail && empId) {
      console.log('[PayrollGrid] Double click opening detail for:', data)
      onViewEmployeeDetail(data)
    }
  }, [onViewEmployeeDetail])

  // Right-click context menu for employee rows
  const getContextMenuItems = useCallback((params) => {
    const data = params.node?.data
    // Skip for header/total rows or if no data
    if (!data || data.isHeader || data.isTotal || data.isGrandTotal) {
      return ['copy', 'copyWithHeaders', 'separator', 'export']

    }

    const defaultItems = ['copy', 'copyWithHeaders', 'separator', 'export']

    // Add View Detail option for ALL employee rows (any column right-clicked)
    const empId = data.nik || data.NIK
    if (onViewEmployeeDetail && empId) {
      return [
        {
          name: 'Lihat Detail Activity',
          action: () => {
            console.log('[PayrollGrid] Opening detail for:', data)
            onViewEmployeeDetail(data)
          },
          cssClasses: ['context-menu-detail']
        },
        'separator',
        ...defaultItems
      ]
    }

    return defaultItems
  }, [onViewEmployeeDetail])

  // New Logic for Dumb Backend Smart Frontend
  const loadRawTreeData = async (token, division, month, year, targetGangCode = 'ALL', useLocked = false) => {
    try {
      setLoadingStatus(`Mengambil data raw divisi ${division}...`);

      let data;

      // In PRODUCTION MODE or when useLocked is true, use locked endpoint
      const inProdMode = isProdMode();
      const shouldUseLocked = useLocked || inProdMode;

      if (shouldUseLocked) {
        console.log('[PayrollGrid] Using LOCKED endpoint for production mode');
        // Use locked division service which handles RS256 token
        data = await getLockedRawTree(token, division, month, year);
      } else {
        // DEV MODE: Use regular endpoint with fetch
        const url = `/payroll/report/division-raw-tree?division_code=${division}&month=${month}&year=${year}`;
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Failed to fetch raw tree data: ${err}`);
        }

        data = await response.json();
      }

      // Extract dynamic headers from metadata
      const dynamicPotonganHeaders = data.dynamic_potongan_headers || {};
      const dynamicPremiHeaders = data.dynamic_premi_headers || {};

      // =============================================================
      // COMBINED COLUMN INJECTION - Single atomic update to avoid race conditions
      // All dynamic column injections happen in ONE setColumnDefs call
      // =============================================================
      console.log('[PayrollGrid] Combined injection - PREMI:', dynamicPremiHeaders, 'POTONGAN:', dynamicPotonganHeaders);

      // Prepare filter for KOREKSI items (goes to POTONGAN UPAH KOTOR)
      const koreksiOnlyHeaders = Object.fromEntries(
        Object.entries(dynamicPotonganHeaders).filter(([key]) =>
          key.toUpperCase().startsWith('KOREKSI')
        )
      );

      // Prepare filter for POT/POTONGAN items (goes to POTONGAN group after PPH21)
      // Exclude KOREKSI items and static pot_spsi/pot_pph21 fields
      console.log('[PayrollGrid] DEBUG - Raw dynamicPotonganHeaders from backend:', JSON.stringify(dynamicPotonganHeaders));

      const potBersihHeaders = Object.fromEntries(
        Object.entries(dynamicPotonganHeaders).filter(([key, fieldName]) => {
          const upper = key.toUpperCase();
          const isKoreksi = upper.startsWith('KOREKSI');
          const isStaticField = fieldName === 'pot_spsi' || fieldName === 'pot_pph21';
          const include = !isKoreksi && !isStaticField;
          console.log(`[PayrollGrid] DEBUG - Filter "${key}" (field: ${fieldName}): isKoreksi=${isKoreksi}, isStatic=${isStaticField}, include=${include}`);
          return include;
        })
      );

      console.log('[PayrollGrid] KOREKSI headers:', JSON.stringify(koreksiOnlyHeaders));
      console.log('[PayrollGrid] POT/POTONGAN headers for injection:', JSON.stringify(potBersihHeaders));

      setColumnDefs(currentCols => {
        let cols = [...currentCols];

        // === STEP 1: Inject dynamic PREMI columns ===
        if (Object.keys(dynamicPremiHeaders).length > 0) {
          const injectPremiColumns = (colsArray) => {
            if (!colsArray || !Array.isArray(colsArray)) return colsArray;

            return colsArray.map(col => {
              if (col.headerName === 'PREMI' && col.children) {
                const brondolIndex = col.children.findIndex(child =>
                  child.headerName === 'BRONDOL' ||
                  (child.children && child.children[0]?.field === 'premi_brondol')
                );

                const dynamicCols = Object.entries(dynamicPremiHeaders).map(([headerName, fieldName]) => ({
                  headerName: headerName.toUpperCase().replace('PREMI ', ''),
                  headerClass: 'header-premi',
                  children: [formatLeaf({
                    field: fieldName,
                    headerName: 'JUMLAH',
                    width: 120,
                    type: 'numericColumn',
                    cellClass: 'text-right'
                  })]
                }));

                const newChildren = [...col.children];
                let totalPremiIndex = newChildren.findIndex(child =>
                  child.headerName === 'TOTAL PREMI' ||
                  child.headerName === 'TOTAL' ||
                  (child.children && child.children[0]?.field === 'total_premi')
                );

                if (totalPremiIndex < 0) {
                  newChildren.push({
                    headerName: 'TOTAL',
                    headerClass: 'header-premi',
                    children: [formatLeaf({
                      field: 'total_premi',
                      headerName: 'JUMLAH',
                      width: 130,
                      type: 'numericColumn',
                      cellClass: 'text-right font-bold cell-total-premi'
                    })]
                  });
                  totalPremiIndex = newChildren.length - 1;
                }

                const insertPos = brondolIndex >= 0 ? brondolIndex + 1 : totalPremiIndex;
                newChildren.splice(insertPos, 0, ...dynamicCols);

                return { ...col, children: newChildren };
              }

              if (col.children) {
                return { ...col, children: injectPremiColumns(col.children) };
              }

              return col;
            });
          };

          cols = injectPremiColumns(cols);
        }

        // === STEP 2: Inject POTONGAN UPAH KOTOR group (after PREMI) ===
        const dynamicKoreksiCols = Object.entries(koreksiOnlyHeaders).map(([headerName, fieldName]) => {
          return formatLeaf({
            field: fieldName,
            headerName: headerName.replace(/^KOREKSI\s*/i, ''),
            width: 120,
            type: 'numericColumn',
            cellClass: 'text-right'
          });
        });

        const potonganKotorGroup = {
          headerName: 'POTONGAN UPAH KOTOR',
          headerGroupComponent: 'HierHeaderGroup',
          marryChildren: true,
          children: [
            {
              field: 'pot_koreksi',
              headerName: 'KOREKSI',
              width: 100,
              type: 'numericColumn',
              cellClass: 'text-right',
              resizable: true,
              sortable: true,
              filter: true,
              // Explicit valueGetter to ensure value is read from row data
              valueGetter: params => {
                if (!params.data) return 0;
                // Try pot_koreksi first, then nested koreksi
                const val = params.data.pot_koreksi ||
                  (params.data.potongan_upah_kotor && params.data.potongan_upah_kotor.koreksi) ||
                  0;
                return Number(val) || 0;
              },
              valueFormatter: params => {
                const val = Number(params.value) || 0;
                if (val === 0) return '-';
                return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(val));
              }
            },
            ...dynamicKoreksiCols,
            formatLeaf({
              field: 'potongan_upah_kotor_total',
              headerName: 'TOTAL',
              width: 120,
              type: 'numericColumn',
              cellClass: 'text-right font-bold'
            })
          ]
        };

        // === STEP 3: Inject POTONGAN UPAH BERSIH group (after POTONGAN UPAH KOTOR) ===
        const dynamicPotBersihCols = Object.entries(potBersihHeaders).map(([headerName, fieldName]) => {
          let displayName = headerName.replace(/^(POTONGAN\s*|POT\s*)/i, '');
          return formatLeaf({
            field: fieldName,
            headerName: displayName || headerName,
            width: 120,
            type: 'numericColumn',
            cellClass: 'text-right'
          });
        });

        const potonganBersihGroup = {
          headerName: 'POTONGAN UPAH BERSIH',
          headerGroupComponent: 'HierHeaderGroup',
          marryChildren: true,
          children: [
            // === FIXED: BPJS/ASTEK Components (calculated values - pekerja only) ===
            {
              headerName: 'POTONGAN BPJS',
              headerClass: 'header-potongan',
              children: [
                {
                  headerName: 'KESEHATAN',
                  headerClass: 'header-potongan-sub',
                  children: [
                    formatLeaf({ field: 'pot_bpjs_kesehatan_pekerja', headerName: 'PEKERJA', width: 100, type: 'numericColumn', cellClass: 'text-right' }),
                    formatLeaf({ field: 'pot_bpjs_kesehatan_majikan', headerName: 'MAJIKAN', width: 100, type: 'numericColumn', cellClass: 'text-right' }),
                  ]
                },
                {
                  headerName: 'PENSIUN',
                  headerClass: 'header-potongan-sub',
                  children: [
                    formatLeaf({ field: 'pot_bpjs_pensiun_pekerja', headerName: 'PEKERJA', width: 100, type: 'numericColumn', cellClass: 'text-right' }),
                    formatLeaf({ field: 'pot_bpjs_pensiun_majikan', headerName: 'MAJIKAN', width: 100, type: 'numericColumn', cellClass: 'text-right' }),
                  ]
                },
                formatLeaf({ field: 'pot_bpjs_pekerja_total', headerName: 'TOTAL', width: 100, type: 'numericColumn', cellClass: 'text-right font-bold' }),
              ]
            },
            // === FIXED: SPSI ===
            formatLeaf({
              field: 'pot_spsi',
              headerName: 'IURAN SPSI',
              width: 110,
              type: 'numericColumn',
              cellClass: 'text-right'
            }),
            // === FIXED: PPH21 ===
            formatLeaf({
              field: 'pot_pph21',
              headerName: 'PPH21',
              width: 110,
              type: 'numericColumn',
              cellClass: 'text-right'
            }),
            // === DYNAMIC: Conditional items (TIKET, KONTAN, THR, PINJAM, ALAT) ===
            ...dynamicPotBersihCols,
            // === TOTAL ===
            formatLeaf({
              field: 'total_potongan_bersih',
              headerName: 'TOTAL POTONGAN',
              width: 130,
              type: 'numericColumn',
              cellClass: 'text-right font-bold'
            })
          ]
        };

        // Insert groups and dynamic items in correct positions:
        // 1. POTONGAN UPAH KOTOR - after PREMI
        // 2. Dynamic items (POTONGAN HUTANG, etc) - injected into POTONGAN group after PPH21
        const injectGroups = (colsArray, depth = 0) => {
          if (!colsArray || !Array.isArray(colsArray)) return colsArray;

          let newCols = [];
          let kotorInserted = false;

          for (let i = 0; i < colsArray.length; i++) {
            let col = colsArray[i];

            // Check if this is the POTONGAN parent group - inject dynamic items after PPH21
            if (col.headerName === 'POTONGAN' && col.children) {
              console.log('[PayrollGrid] Found POTONGAN parent group, injecting dynamic items after PPH21');

              // Find PPH21 position and inject dynamic items after it
              const pph21Idx = col.children.findIndex(child =>
                child.headerName === 'PPH21' ||
                (child.children && child.children[0]?.field === 'pot_pph21')
              );

              // Find TOTAL POTONGAN position (to insert before it)
              const totalPotIdx = col.children.findIndex(child =>
                child.field === 'total_potongan' || child.headerName === 'TOTAL POTONGAN'
              );

              // Create new children array with dynamic items injected
              const newChildren = [...col.children];

              // Insert dynamic items after PPH21, before TOTAL POTONGAN
              const insertPos = pph21Idx >= 0 ? pph21Idx + 1 : (totalPotIdx >= 0 ? totalPotIdx : newChildren.length);

              console.log('[PayrollGrid] Injecting', dynamicPotBersihCols.length, 'dynamic items at position', insertPos);

              // Also add TOTAL POTONGAN BERSIH if we have dynamic items
              if (dynamicPotBersihCols.length > 0) {
                const totalBersihCol = formatLeaf({
                  field: 'total_potongan_bersih',
                  headerName: 'TOTAL POT. BERSIH',
                  width: 130,
                  type: 'numericColumn',
                  cellClass: 'text-right font-bold'
                });
                newChildren.splice(insertPos, 0, ...dynamicPotBersihCols, totalBersihCol);
              }

              col = { ...col, children: injectGroups(newChildren, depth + 1) };
            } else if (col.children) {
              // Recurse into children
              col = { ...col, children: injectGroups(col.children, depth + 1) };
            }

            // NOTE: Removed skip logic for pot_koreksi and potongan_upah_kotor_total
            // Backend HeaderService already provides POTONGAN UPAH KOTOR group with these columns
            // Skipping them was causing the KOREKSI column to disappear

            newCols.push(col);

            // NOTE: Removed POTONGAN UPAH KOTOR injection after PREMI
            // Backend HeaderService (header_service.py lines 565-632) already includes this group
          }

          return newCols;
        };

        cols = injectGroups(cols);

        console.log('[PayrollGrid] Combined column injection complete');
        return cols;
      });

      // 1. Flatten Data & Calculate Fields (PayrollAggregator helper)
      // This calculates ALL derived fields (tunjangan, pot, bpjs, upah bersih, etc)
      let flatRows = PayrollAggregator.flattenData(data, dynamicPotonganHeaders);

      // Filter for specific gang if needed
      if (targetGangCode && targetGangCode.toUpperCase() !== 'ALL') {
        flatRows = flatRows.filter(r => r.gang_code === targetGangCode);
      }

      // 2. Process Rows (Group by Gang)
      const processedRows = [];
      const displayedGangTotals = [];

      // Group flatRows by gang_code
      const gangsMap = {};
      flatRows.forEach(row => {
        const g = row.gang_code;
        if (!gangsMap[g]) gangsMap[g] = [];
        gangsMap[g].push(row);
      });

      const sortedGangs = Object.keys(gangsMap).sort();

      let globalNo = 1;

      sortedGangs.forEach(gangCode => {
        const employees = gangsMap[gangCode];
        if (employees.length === 0) return;

        // Add Header
        processedRows.push({
          isHeader: true,
          gang_code: gangCode,
          id: `HEADER_${gangCode}`,
          nama: `GANG: ${gangCode}`
        });

        // Add Data Rows
        employees.forEach(emp => {
          emp.no = globalNo++;
          processedRows.push(emp);
        });

        // Calculate Subtotal
        const gangTotal = PayrollAggregator.calculateGangTotals(gangCode, flatRows);
        displayedGangTotals.push(gangTotal);

        const subtotalRow = {
          ...gangTotal,
          isTotal: true,
          gang_code: gangCode,
          id: `TOTAL_${gangCode}`,
          nama: `TOTAL ${gangCode}`,
          nik: '',
          jenis_kelamin: '',
          no: ''
        };
        processedRows.push(subtotalRow);
      });

      const grandTotal = PayrollAggregator.calculateGrandTotal(flatRows);
      const reconciledGangTotals = PayrollAggregator.reconcileGangTotalsToGrandTotal(displayedGangTotals, grandTotal);
      let subtotalIndex = 0;
      processedRows.forEach((row, index) => {
        if (!row?.isTotal) return;
        processedRows[index] = {
          ...row,
          ...reconciledGangTotals[subtotalIndex],
          isTotal: true,
          gang_code: row.gang_code,
          id: row.id,
          nama: row.nama,
          nik: '',
          jenis_kelamin: '',
          no: ''
        };
        subtotalIndex += 1;
      });

      setRows(processedRows);

      // Set Pinned Bottom Row (Grand Total)
      const pinnedRow = {
        ...grandTotal,
        nama: 'GRAND TOTAL',
        id: 'GRAND_TOTAL',
        isGrandTotal: true
      };
      setPinnedBottom([pinnedRow]);

    } catch (e) {
      console.error("Raw tree load error:", e);
      setError("Gagal memuat data raw tree: " + e.message);
    }
  };

  // Column Types Definition
  const columnTypes = useMemo(() => ({
    rightAligned: {
      headerClass: 'ag-right-aligned-header',
      cellStyle: { textAlign: 'right' }
    },
    leftAligned: {
      headerClass: 'ag-left-aligned-header',
      cellStyle: { textAlign: 'left' }
    },
    centerAligned: {
      headerClass: 'ag-center-aligned-header',
      cellStyle: { textAlign: 'center' }
    },
    textColumn: {
      filter: 'agTextColumnFilter',
    },
    numericColumn: {
      filter: 'agNumberColumnFilter',
      type: 'rightAligned'
    }
  }), [])

  const baseCol = useMemo(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 100,
    enableCellTextSelection: true,
    wrapHeaderText: true,
    autoHeaderHeight: true,
    // Enterprise features
    enableValue: true,
    enableRowGroup: true,
    enablePivot: true,
    suppressMenu: true,
    suppressHeaderMenuButton: true,
    headerClass: 'ag-header-cell-text'
  }), [])

  const rowClassRules = useMemo(() => ({
    'row-odd': params => params.data && !params.data.isHeader && !params.data.isTotal && !params.data.isDivisionTotal && params.node.rowIndex % 2 === 0,
    'row-even': params => params.data && !params.data.isHeader && !params.data.isTotal && !params.data.isDivisionTotal && params.node.rowIndex % 2 === 1,
    'grand-total': params => params.node.footer || (params.data && params.data.isTotal),
    'gang-header': params => params.data && params.data.isHeader,
    'division-grand-total': params => params.data && params.data.isDivisionTotal,
    'row-grand-total': params => params.data && (params.data.isTotal || params.data.nama === 'GRAND TOTAL')
  }), [])

  // Helper to remove empty dynamic columns
  const formatLeaf = useCallback((col) => {
    const cfg = { ...col, ...baseCol };
    const f = String(cfg.field || '');

    // DEBUG: Log all pot_ fields being processed to trace pot_koreksi
    if (f.includes('pot_') || f.includes('koreksi')) {
      console.log('[formatLeaf DEBUG] Processing field:', f, 'col:', JSON.stringify(col));
    }

    // Money/currency fields that need thousand separators
    const moneyFields = ['upah_dasar', 'upah_pokok', 'gaji_pokok', 'beras_jumlah', 'beras_rate', 'jabatan_jumlah', 'jabatan_rate', 'masa_kerja_jumlah', 'masa_kerja_amount', 'lembur_jumlah', 'total_tunjangan', 'total_premi', 'jumlah_upah_kotor', 'potongan_upah_kotor_total', 'pot_pph21', 'pot_koreksi', 'total_potongan', 'upah_bersih', 'pot_bpjs_kesehatan_pekerja', 'pot_bpjs_kesehatan_majikan', 'pot_bpjs_pensiun_pekerja', 'pot_bpjs_pensiun_majikan', 'pot_bpjs_pekerja_total', 'pot_spsi', 'pot_astek', 'pot_astek_maj', 'pot_astek_jumlah', 'pot_bpjs_jumlah', 'pot_bpjs_kesehatan_total', 'pot_bpjs_pensiun_total', 'pot_total_4'];

    // Integer fields (also need formatting)
    const intFields = ['no', 'hari_kerja', 'cuti_tahunan_hari', 'cuti_sakit_haid_hari', 'cuti_minggu_hari', 'cuti_nasional_hari', 'jumlah_hk', 'masa_kerja_tahun'];
    // lembur_jam removed from intFields - should preserve decimal values (e.g., 1.5 hours)
    const decimalFields = ['lembur_jam'];

    // Field prefixes that indicate numeric values needing thousand separators
    const numericPrefixes = ['premi.', 'premi_', 'pot_', 'koreksi_', 'total_', 'jumlah_'];

    // Field suffixes that indicate numeric values
    const numericSuffixes = ['_rate', '_jumlah', '_amount', '_total'];

    const formatNumber = (value) => {
      if (value === null || value === undefined) return '-';
      const n = Number(value);
      if (isNaN(n)) return '-';
      return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n));
    };

    // Check if field is numeric based on name patterns
    const isNumericField = () => {
      if (moneyFields.includes(f)) return true;
      if (intFields.includes(f)) return true;
      if (decimalFields.includes(f)) return true;
      if (numericPrefixes.some(prefix => f.startsWith(prefix))) return true;
      if (numericSuffixes.some(suffix => f.endsWith(suffix))) return true;

      // If field name contains 'jumlah', 'total', 'upah', 'gaji', 'premi', 'pot', 'lembur', 'beras', 'jabatan', 'masa_kerja', 'bpjs', 'pph', 'spsi' - assume numeric
      const numericKeywords = ['jumlah', 'total', 'upah', 'gaji', 'premi', 'pot', 'lembur', 'beras', 'jabatan', 'masa_kerja', 'bpjs', 'pph', 'spsi'];
      if (numericKeywords.some(kw => f.includes(kw))) return true;

      return false;
    };

    // Apply formatting based on field type
    if (isNumericField()) {
      // Money fields
      if (moneyFields.includes(f)) {
        cfg.valueFormatter = (params) => {
          const val = Number(params.value) || 0;
          if (val === 0) return '-';
          return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(val));
        };
        cfg.cellClass = cfg.cellClass ? `${cfg.cellClass} text-right` : 'text-right';
      }
      // Integer fields
      else if (intFields.includes(f)) {
        cfg.valueFormatter = (params) => {
          const val = Number(params.value) || 0;
          if (val === 0) return '-';
          return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(val));
        };
        cfg.cellClass = cfg.cellClass ? `${cfg.cellClass} text-right` : 'text-right';
      }
      // Decimal fields
      else if (decimalFields.includes(f)) {
        cfg.valueFormatter = (params) => {
          const val = Number(params.value) || 0;
          if (val === 0) return '-';
          return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(val);
        };
        cfg.cellClass = cfg.cellClass ? `${cfg.cellClass} text-right` : 'text-right';
      }
      // General numeric fields
      else {
        cfg.valueFormatter = (params) => {
          const val = Number(params.value) || 0;
          if (val === 0) return '-';
          return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(val));
        };
        cfg.cellClass = cfg.cellClass ? `${cfg.cellClass} text-right` : 'text-right';
      }
    }

    // Special handling for specific fields
    if (f === 'nik') {
      cfg.cellRenderer = (params) => {
        const data = params.data;
        const empId = data?.nik || data?.NIK;
        return (
          <div className="cell-nik">
            <span className="emp-id">{params.value}</span>
            {empId && (
              <button 
                className="btn-view-detail"
                onClick={() => {
                  if (onViewEmployeeDetail) {
                    console.log('[formatLeaf] View detail clicked for:', data);
                    onViewEmployeeDetail(data);
                  }
                }}
                title="Lihat Detail Karyawan"
              >
                <Eye size={14} />
              </button>
            )}
          </div>
        );
      };
    }

    // Special handling for name field
    if (f === 'nama') {
      cfg.cellRenderer = (params) => {
        const data = params.data;
        const empId = data?.nik || data?.NIK;
        return (
          <div className="cell-nama">
            <span className="emp-name">{params.value}</span>
            {empId && (
              <button 
                className="btn-view-detail"
                onClick={() => {
                  if (onViewEmployeeDetail) {
                    console.log('[formatLeaf] View detail clicked for:', data);
                    onViewEmployeeDetail(data);
                  }
                }}
                title="Lihat Detail Karyawan"
              >
                <Eye size={14} />
              </button>
            )}
          </div>
        );
      };
    }

    // Special handling for jenis_kelamin
    if (f === 'jenis_kelamin') {
      cfg.valueFormatter = (params) => {
        if (!params.value) return '';
        return params.value === 'L' ? 'Laki-laki' : params.value === 'P' ? 'Perempuan' : params.value;
      };
    }

    // Special handling for status fields
    if (f === 'status_karyawan') {
      cfg.cellClass = cfg.cellClass ? `${cfg.cellClass} text-center` : 'text-center';
    }

    return cfg;
  }, [onViewEmployeeDetail]);

  // Default Col Defs
  const defaultColDef = useMemo(() => ({
    ...baseCol,
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 80,
    cellClass: 'ag-cell-focusable',
    // Enable text selection in cells
    enableCellTextSelection: true,
    // Allow browser text selection
    suppressCellFocus: false,
  }), [baseCol]);

  // AG-Grid configuration
  const gridOptions = useMemo(() => ({
    // Row Selection
    rowSelection: 'multiple',
    rowMultiSelectWithClick: false, // Require Ctrl+click for multi-select
    enableCellTextSelection: true, // Allow text selection within cells
    suppressRowClickSelection: false, // Allow row selection via click

    // Navigation
    navigateToNextCell: (params) => {
      // Custom tab navigation logic if needed
      return params.nextCellPosition;
    },

    // Clipboard
    enableCellTextSelection: true,
    suppressCopyRowsToClipboard: false,
    processCellForClipboard: (params) => {
      // Format values for clipboard
      if (params.value && typeof params.value === 'object') {
        return JSON.stringify(params.value);
      }
      return params.value;
    },

    // Context menu
    allowContextMenuWithControlKey: true,
    getContextMenuItems,

    // Range selection
    enableRangeSelection: true,
    enableRangeHandle: true,
    enableCellTextSelection: true,

    // Performance
    rowModelType: 'clientSide',
    cacheBlockSize: 100,
    maxBlocksInCache: 10,

    // Accessibility
    domLayout: 'normal',
    suppressRowHoverHighlight: false,
    rowHoverHighlight: true,

    // Enterprise features
    groupSelectsChildren: false,
    suppressAggFuncInHeader: true,
  }), [getContextMenuItems]);

  // Load data when props change
  useEffect(() => {
    if (!token || !division || !month || !year) return;

    loadRawTreeData(token, division, month, year, gangCode, useLocked);
  }, [token, division, month, year, gangCode, useLocked]);

  // Handle loading events
  useEffect(() => {
    if (onLoadStart) onLoadStart();
    return () => {
      if (onLoadEnd) onLoadEnd();
    };
  }, [onLoadStart, onLoadEnd]);

  // Report row count to parent
  useEffect(() => {
    if (onRowCountChange) {
      onRowCountChange(rows.length);
    }
  }, [rows, onRowCountChange]);

  // Font size effect
  useEffect(() => {
    if (gridRef.current && gridRef.current.api) {
      const gridElement = gridRef.current.api.gridOptionsWrapper.gridOptions.element;
      if (gridElement) {
        gridElement.style.fontSize = `${fontSize}%`;
      }
    }
  }, [fontSize]);

  return (
    <div className="payroll-grid-container" style={{ height: '100%', width: '100%' }}>
      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <div className="loading-text">{loadingStatus || 'Memuat data...'}</div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="error-message">
          <div className="error-icon">!</div>
          <div className="error-text">{error}</div>
          <button onClick={() => setError('')} className="error-close">×</button>
        </div>
      )}

      {/* AG Grid */}
      <div 
        className="ag-theme-alpine payroll-grid-theme" 
        style={{ height: '100%', width: '100%' }}
      >
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          columnTypes={columnTypes}
          pinnedBottomRowData={pinnedBottom}
          rowClassRules={rowClassRules}
          rowSelection="multiple"
          suppressRowClickSelection={false}
          enableCellTextSelection={true}
          onGridReady={(params) => {
            params.api.sizeColumnsToFit({ 
              defaultMinWidth: 80,
              columnLimits: [] 
            });
            
            window.addEventListener('resize', () => {
              setTimeout(() => params.api.sizeColumnsToFit({ 
                defaultMinWidth: 80,
                columnLimits: [] 
              }));
            });
          }}
          onCellClicked={onCellClicked}
          onCellDoubleClicked={onCellDoubleClicked}
          onRangeSelectionChanged={onRangeSelectionChanged}
          animateRows={true}
          rowModelType={'clientSide'}
          cacheBlockSize={100}
          maxBlocksInCache={10}
          enableRangeSelection={true}
          ensureDomOrder={true}
          tooltipShowDelay={500}
          tooltipHideDelay={3000}
          suppressRowHoverHighlight={false}
          rowHoverHighlight={true}
          gridOptions={gridOptions}
          context={{ componentParent: this }}
        />
      </div>

      {/* Selection Status Bar */}
      <SelectedCellStatusBar 
        selectedCell={selectedCell} 
        selectionStats={selectionStats}
        onClearStats={() => setSelectionStats(null)}
      />

      {/* Cell Inspector (for debugging) */}
      {process.env.NODE_ENV === 'development' && selectedCell && (
        <CellInspector data={selectedCell} />
      )}
    </div>
  );
}
