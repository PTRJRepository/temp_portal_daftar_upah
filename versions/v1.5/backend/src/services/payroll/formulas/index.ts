/**
 * Payroll Formulas - Public API
 *
 * Single Source of Truth for all payroll calculation formulas.
 *
 * Usage:
 *   import { calculateUpahKotor, calculateUpahBersih, mapBerasRateToPTKP } from './services/payroll/formulas';
 */

// Types
export * from './types';

// PTKP Mapper
export {
    mapBerasRateToPTKP,
    mapPTKPToTER,
    getPTKPAmount,
    getTERCategory,
} from './PTKPMapper';

// Pure Formula Functions
export {
    calculateUpahKotor,
    calculateKomponenKotor,
    calculateJumlahUpahKotor,
    calculateKomponenPotongan,
    calculateTotalPotongan,
    calculateUpahKotorPajak,
    calculatePenghasilanBruto,
    calculateTotalPotonganBersih,
    calculateUpahBersih,
} from './PayrollFormulas';

// Adapters
export { rowToPayrollCalculatorInput } from './adapters/aggregationAdapter';
