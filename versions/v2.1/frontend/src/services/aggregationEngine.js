/**
 * Client-Side Aggregation Engine
 * 
 * Performs payroll calculations based on backend-provided rules.
 * Backend provides: Raw data + Aggregation formulas
 * Frontend executes: Calculations using those formulas
 * 
 * This creates a single source of truth for aggregation logic (backend)
 * while keeping the computational workload on the client side.
 */

/**
 * AggregationEngine class
 * Processes raw payroll data according to backend-provided rules
 */
class AggregationEngine {
  /**
   * @param {Object} rules - Aggregation rules from backend
   * @param {Array} rules.column_aggregations - Column aggregation formulas
   * @param {Array} rules.row_calculations - Row-level calculation formulas
   * @param {Array} rules.filter_rules - Data filtering rules
   */
  constructor(rules) {
    this.rules = rules || {}
    this.rules.column_aggregations = this.rules.column_aggregations || []
    this.rules.row_calculations = this.rules.row_calculations || []
    this.rules.filter_rules = this.rules.filter_rules || []
    
    /* 
    console.log('[AggregationEngine] Initialized with rules:', {
      column_aggregations: this.rules.column_aggregations.length,
      row_calculations: this.rules.row_calculations.length,
      filter_rules: this.rules.filter_rules.length
    })
    */
  }

  /**
   * Safely evaluate a numeric formula with row data
   * Supports: +, -, *, /, (), and || operator for null coalescing
   * 
   * @param {string} formula - Formula string like "(field1 || 0) + (field2 || 0)"
   * @param {Object} row - Data row object
   * @returns {number} Calculated value
   */
  evaluateFormula(formula, row) {
    if (!formula || typeof formula !== 'string') {
      return 0
    }

    try {
      // Replace field names with actual values
      let expression = formula

      // Find all field references (alphanumeric + underscores)
      const fieldPattern = /([a-zA-Z_][a-zA-Z0-9_]*)/g
      const matches = formula.match(fieldPattern) || []

      // Replace each field with its value
      const replacedFields = new Set()
      for (const field of matches) {
        // Skip if it's already replaced or if it's a number or operator keyword
        if (replacedFields.has(field) || ['true', 'false', 'null'].includes(field.toLowerCase())) {
          continue
        }

        const value = row[field]
        const numValue = value !== null && value !== undefined && value !== '' ? Number(value) : 0
const safeValue = isNaN(numValue) ? 0 : numValue

        // Replace all occurrences of this field
        const fieldRegex = new RegExp(`\\b${field}\\b`, 'g')
        expression = expression.replace(fieldRegex, safeValue)

        replacedFields.add(field)
      }

      // Evaluate the expression safely
      // eslint-disable-next-line no-eval
      const result = eval(expression)

      return isNaN(result) ? 0 : Number(result)
    } catch (error) {
      console.error('[AggregationEngine] Formula evaluation error:', {
        formula,
        error: error.message
      })
      return 0
    }
  }

  /**
   * Apply filter rules to data
   * @param {Array} data - Data rows
   * @returns {Array} Filtered data rows
   */
  applyFilterRules(data) {
    let filtered = [...data]

    for (const rule of this.rules.filter_rules) {
      const { field, operator, value } = rule

      filtered = filtered.filter(row => {
        const rowValue = row[field]

        switch (operator) {
          case 'gt':
            return Number(rowValue) > Number(value)
          case 'gte':
            return Number(rowValue) >= Number(value)
          case 'lt':
            return Number(rowValue) < Number(value)
          case 'lte':
            return Number(rowValue) <= Number(value)
          case 'eq':
            return rowValue === value
          case 'ne':
            return rowValue !== value
          case 'in':
            return Array.isArray(value) && value.includes(rowValue)
          case 'not_in':
            return Array.isArray(value) && !value.includes(rowValue)
          default:
            return true
        }
      })
    }

    /*
    console.log('[AggregationEngine] Filtered data:', {
      original: data.length,
      filtered: filtered.length,
      removed: data.length - filtered.length
    })
    */

    return filtered
  }

  /**
   * Apply row-level calculations to all rows
   * @param {Array} rawData - Raw data rows
   * @returns {Array} Rows with calculated fields
   */
  applyRowCalculations(rawData) {
    // Sort rules by execution order
    const sortedRules = [...this.rules.row_calculations].sort(
      (a, b) => (a.execution_order || 0) - (b.execution_order || 0)
    )

    // console.log('[AggregationEngine] Applying', sortedRules.length, 'row calculation rules')

    return rawData.map((row, idx) => {
      const calculatedRow = { ...row }

      // Apply each calculation rule in order
      for (const rule of sortedRules) {
        const { target_field, formula } = rule
        const calculatedValue = this.evaluateFormula(formula, calculatedRow)
        calculatedRow[target_field] = calculatedValue
      }

      return calculatedRow
    })
  }

  /**
   * Aggregate a column based on aggregation type
   * @param {Array} data - Data rows
   * @param {Object} columnRule - Aggregation rule for column
   * @returns {number} Aggregated value
   */
  aggregateColumn(data, columnRule) {
    const { column_id, aggregation_type, formula } = columnRule

    if (aggregation_type === 'none') {
      return null
    }

    // Extract values
    const values = data
      .map(row => row[column_id])
      .filter(v => v !== null && v !== undefined && v !== '')
      .map(v => Number(v))
      .filter(v => !isNaN(v))

    switch (aggregation_type) {
      case 'sum':
        return values.reduce((sum, v) => sum + v, 0)

      case 'avg':
        return values.length > 0 
          ? values.reduce((sum, v) => sum + v, 0) / values.length 
          : 0

      case 'count':
        return values.length

      case 'min':
        return values.length > 0 ? Math.min(...values) : 0

      case 'max':
        return values.length > 0 ? Math.max(...values) : 0

      case 'formula':
        // Custom formula aggregation
        if (formula) {
          return this.evaluateFormula(formula, { data })
        }
        return 0

      default:
        return 0
    }
  }

  /**
   * Calculate summary row (grand total / bottom pinned row)
   * @param {Array} data - Calculated data rows
   * @returns {Object} Summary row object
   */
  calculateSummary(data) {
    const summary = {
      no: '',
      nik: '',
      jenis_kelamin: '',
      nama: `${data.length} KARYAWAN`
    }

    // Apply column aggregations
    for (const rule of this.rules.column_aggregations) {
      if (rule.aggregation_type === 'none') {
        continue
      }

      const aggregatedValue = this.aggregateColumn(data, rule)
      
      if (aggregatedValue !== null) {
        summary[rule.column_id] = aggregatedValue
      }
    }

    return summary
  }

  /**
   * Calculate detailed statistics
   * @param {Array} data - Calculated data rows
   * @returns {Object} Statistics object
   */
  calculateStatistics(data) {
    const agg = (columnId, type = 'sum') => {
      const rule = { column_id: columnId, aggregation_type: type }
      return this.aggregateColumn(data, rule) || 0
    }

    return {
      // Attendance stats
      total_hadir: agg('hari_kerja', 'sum'),
      total_cuti_tahunan: agg('cuti_tahunan_hari', 'sum'),
      total_cuti_sakit: agg('cuti_sakit_haid_hari', 'sum'),
      total_cuti_minggu: agg('cuti_minggu_hari', 'sum'),
      total_cuti_nasional: agg('cuti_nasional_hari', 'sum'),
      total_tidak_hadir: agg('total_ketidakhadiran', 'sum'),

      // Allowance breakdown
      total_beras: agg('beras_jumlah', 'sum'),
      total_jabatan: agg('jabatan_jumlah', 'sum'),
      total_masa_kerja: agg('masa_kerja_jumlah', 'sum'),
      total_lembur: agg('lembur_jumlah', 'sum'),

      // Deduction breakdown
      total_pph21: agg('pot_pph21', 'sum'),
      total_premi_pph: agg('premi_pph', 'sum'),  // NEW: Premi PPH that gets ADDED to net salary
      total_koreksi: agg('pot_koreksi', 'sum'),
      total_bpjs_pekerja: agg('pot_bpjs_kesehatan_pekerja', 'sum'),
      total_bpjs_majikan: agg('pot_bpjs_kesehatan_majikan', 'sum'),
      total_bpjs_pensiun_pekerja: agg('pot_bpjs_pensiun_pekerja', 'sum'),
      total_bpjs_pensiun_majikan: agg('pot_bpjs_pensiun_majikan', 'sum'),
      total_spsi: agg('pot_spsi', 'sum'),

      // Premiere breakdown
      total_brondol: agg('premi_brondol', 'sum'),
      total_pruning: agg('premi_pruning', 'sum'),

      // Summary stats
      average_upah_bersih: agg('upah_bersih', 'avg'),
      min_upah_bersih: agg('upah_bersih', 'min'),
      max_upah_bersih: agg('upah_bersih', 'max')
    }
  }

  /**
   * Main processing function
   * Process complete dataset: filter → row calculations → aggregations
   * 
   * @param {Array} rawData - Raw data from backend
   * @returns {Object} Processed data with calculations
   */
  process(rawData) {
    const startTime = performance.now()

    // console.log('[AggregationEngine] 🚀 Starting processing:', rawData.length, 'raw records')

    // Step 1: Apply filter rules
    const filtered = this.applyFilterRules(rawData)
    // console.log('[AggregationEngine] ✅ Step 1: Filtered', filtered.length, 'records')

    // Step 2: Apply row-level calculations
    const calculatedData = this.applyRowCalculations(filtered)
    // console.log('[AggregationEngine] ✅ Step 2: Calculated', calculatedData.length, 'rows')

    // Step 3: Calculate summary/aggregations
    const summary = this.calculateSummary(calculatedData)
    // console.log('[AggregationEngine] ✅ Step 3: Summary computed')

    // Step 4: Calculate statistics
    const statistics = this.calculateStatistics(calculatedData)
    // console.log('[AggregationEngine] ✅ Step 4: Statistics computed')

    const processingTime = performance.now() - startTime
    if (processingTime > 100) {
        console.log('[AggregationEngine] ⚡ Total processing time:', processingTime.toFixed(2), 'ms')
    }

    return {
      data_rows: calculatedData,
      summary,
      statistics,
      processing_info: {
        original_count: rawData.length,
        filtered_count: filtered.length,
        final_count: calculatedData.length,
        processing_time_ms: processingTime
      }
    }
  }
}

export default AggregationEngine
