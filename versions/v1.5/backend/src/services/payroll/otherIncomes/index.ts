/**
 * Payroll OtherIncomes Module
 *
 * This module handles OTHER_INCOME (pendapatan lainnya) processing.
 * Formerly part of otherIncomesService.ts (141KB, 2671 lines).
 *
 * ARCHITECTURE:
 * Each component handles ONE domain:
 * - IncomeCategorizer: Categorize incomes into THR, Bonus, Custom, KONTAN
 * - DynamicColumnDetector: Parse DocDesc patterns for dynamic columns
 * - ThrProcessor: THR-specific calculation logic
 * - OtherIncomeProcessor: Main orchestrator combining all components
 *
 * USAGE:
 * ```typescript
 * import { getIncomeCategorizer, getDynamicColumnDetector, getThrProcessor } from './payroll/otherIncomes';
 *
 * const categorizer = getIncomeCategorizer();
 * const category = categorizer.categorizeByDocDesc('THR GAJI');
 *
 * const detector = getDynamicColumnDetector();
 * const columns = detector.detectColumns(['PREMI BRONDOL', 'BONUS']);
 *
 * const thr = getThrProcessor();
 * const eligibility = thr.checkEligibility(joinDate, periodDate, religion);
 * ```
 *
 * @module payroll/otherIncomes
 */

export { IncomeCategorizer, getIncomeCategorizer } from './IncomeCategorizer';
export type { IncomeType, CategorizedIncome, IncomeFormula } from './IncomeCategorizer';

export { DynamicColumnDetector, getDynamicColumnDetector, normalizeDocDesc, getDisplayTitle, detectCategory } from './DynamicColumnDetector';
export type { DynamicColumn } from './DynamicColumnDetector';

export { ThrProcessor, getThrProcessor } from './ThrProcessor';
export type { ThrEligibility, ThrCalculation, ThrConfig } from './ThrProcessor';

export { OtherIncomeProcessor, getOtherIncomeProcessor } from './OtherIncomeProcessor';
export type { OtherIncome } from './OtherIncomeProcessor';
