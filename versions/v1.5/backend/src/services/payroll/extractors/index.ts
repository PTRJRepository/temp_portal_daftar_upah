/**
 * Payroll Extractors Module
 *
 * This module extracts raw payroll data from the database.
 * These were formerly part of dataExtractorService.ts (149KB, 2845 lines).
 *
 * ARCHITECTURE:
 * Each extractor is a focused service that handles ONE domain:
 * - EmployeeExtractor: Employee master data from HR_EMPLOYEE, HR_GANGLN, HR_GANG
 * - AttendanceExtractor: Work days (HK), attendance records from PR_TASKREGLN
 * - LeaveExtractor: Cuti (leave) data from PR_TASKREGLN
 * - OvertimeExtractor: Lembur (overtime) from PR_TASKREGLN (OT=1)
 * - PremiumExtractor: Premi from PR_ADTRANS
 * - DeductionExtractor: Potongan from PR_ADTRANS
 * - HarvestExtractor: FFB harvesting data from PR_TASKREGLN
 *
 * All extractors use the same Database instance pattern.
 * The DataExtractorService orchestrates them and combines results.
 *
 * USAGE:
 * ```typescript
 * import { getEmployeeExtractor, getAttendanceExtractor, ... } from './payroll/extractors';
 *
 * const employees = await getEmployeeExtractor().extract(gangCondition, month, year);
 * const attendance = await getAttendanceExtractor().extract(empCodes, startDate, endDate);
 * ```
 *
 * @module payroll/extractors
 */

export { EmployeeExtractor, getEmployeeExtractor } from './EmployeeExtractor';
export { AttendanceExtractor, getAttendanceExtractor } from './AttendanceExtractor';
export { LeaveExtractor, getLeaveExtractor } from './LeaveExtractor';
export { OvertimeExtractor, getOvertimeExtractor } from './OvertimeExtractor';
export { PremiumExtractor, getPremiumExtractor } from './PremiumExtractor';
export { DeductionExtractor, getDeductionExtractor } from './DeductionExtractor';
export { HarvestExtractor, getHarvestExtractor } from './HarvestExtractor';
