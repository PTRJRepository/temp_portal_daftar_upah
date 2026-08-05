/**
 * Payroll Components Services
 *
 * Central export point for all payroll component services.
 * All components are registered in the PayrollComponentRegistry.
 */

import { payrollComponentRegistry } from './PayrollComponentRegistry';
import { lemburService } from './components/LemburService';
import { premiService } from './components/PremiService';
import { tunjanganService } from './components/TunjanganService';
import { potonganService } from './components/PotonganService';
import { pph21TerService } from './components/Pph21TerService';
import { gajiPokokService } from './components/GajiPokokService';

// Register all component services with version numbers
payrollComponentRegistry.register('lembur', lemburService, 1);
payrollComponentRegistry.register('premi', premiService, 1);
payrollComponentRegistry.register('tunjangan', tunjanganService, 1);
payrollComponentRegistry.register('potongan', potonganService, 1);
payrollComponentRegistry.register('pph21_ter', pph21TerService, 1);
payrollComponentRegistry.register('gaji_pokok', gajiPokokService, 1);

// Export services for direct use
export * from './BasePayrollComponentService';
export * from './PayrollComponentRegistry';
export * from './components/LemburService';
export * from './components/PremiService';
export * from './components/TunjanganService';
export * from './components/PotonganService';
export * from './components/Pph21TerService';
export * from './components/GajiPokokService';

// Export registry
export { payrollComponentRegistry };
