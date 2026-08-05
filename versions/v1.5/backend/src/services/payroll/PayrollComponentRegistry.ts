/**
 * Payroll Component Registry
 *
 * Central registry for all payroll component services.
 * Provides:
 * - Service registration and retrieval
 * - Batch calculation coordination
 * - Service health monitoring
 */

import {
    PayrollCalculationInput,
    PayrollCalculationResult,
    IPayrollComponentService,
} from '../../types/payroll/BasePayrollTypes';

/**
 * Central registry for all payroll component services
 */
class PayrollComponentRegistry {
    private static instance: PayrollComponentRegistry;
    private components: Map<string, IPayrollComponentService>;
    private serviceVersions: Map<string, number>;

    private constructor() {
        this.components = new Map();
        this.serviceVersions = new Map();
    }

    public static getInstance(): PayrollComponentRegistry {
        if (!PayrollComponentRegistry.instance) {
            PayrollComponentRegistry.instance = new PayrollComponentRegistry();
        }
        return PayrollComponentRegistry.instance;
    }

    /**
     * Register a component service
     */
    public register(name: string, service: IPayrollComponentService, version: number = 1): void {
        this.components.set(name, service);
        this.serviceVersions.set(name, version);
        console.log(`[PayrollComponentRegistry] Registered component: ${name} (v${version})`);
    }

    /**
     * Get a component service by name
     */
    public get(name: string): IPayrollComponentService {
        const service = this.components.get(name);
        if (!service) {
            throw new Error(`Component service not found: ${name}`);
        }
        return service;
    }

    /**
     * Check if a component is registered
     */
    public has(name: string): boolean {
        return this.components.has(name);
    }

    /**
     * Get all registered component names
     */
    public getRegisteredComponents(): string[] {
        return Array.from(this.components.keys());
    }

    /**
     * Get service version
     */
    public getServiceVersion(name: string): number | undefined {
        return this.serviceVersions.get(name);
    }

    /**
     * Get all service versions
     */
    public getAllServiceVersions(): Record<string, number> {
        const versions: Record<string, number> = {};
        for (const [name, version] of this.serviceVersions.entries()) {
            versions[name] = version;
        }
        return versions;
    }

    /**
     * Calculate all registered components for a single employee
     */
    public async calculateAll(
        input: PayrollCalculationInput,
        componentNames?: string[],
        options?: { useCache?: boolean; forceRecalculate?: boolean }
    ): Promise<Record<string, PayrollCalculationResult>> {
        const components = componentNames || this.getRegisteredComponents();
        const results: Record<string, PayrollCalculationResult> = {};

        // Calculate all components in parallel
        const promises = components.map(async (name) => {
            try {
                const service = this.get(name);
                const result = await service.calculate(input, options);
                return { name, result };
            } catch (error) {
                console.error(`[PayrollComponentRegistry] Error calculating ${name}:`, error);
                return {
                    name,
                    result: {
                        component_name: name,
                        input,
                        output: { value: null, meta: {} as any },
                        errors: [error instanceof Error ? error.message : String(error)],
                    },
                };
            }
        });

        const settledResults = await Promise.all(promises);

        // Organize results
        for (const { name, result } of settledResults) {
            results[name] = result;
        }

        return results;
    }

    /**
     * Calculate all registered components for multiple employees (batch)
     */
    public async calculateAllBatch(
        inputs: PayrollCalculationInput[],
        componentNames?: string[],
        options?: { useCache?: boolean; forceRecalculate?: boolean }
    ): Promise<Record<string, Record<string, PayrollCalculationResult>>> {
        const components = componentNames || this.getRegisteredComponents();
        const allResults: Record<string, Record<string, PayrollCalculationResult>> = {};

        // Initialize results structure
        for (const input of inputs) {
            allResults[input.emp_code] = {};
        }

        // Calculate each component for all employees
        for (const componentName of components) {
            try {
                const service = this.get(componentName);
                const batchResult = await service.calculateBatch(inputs, options);

                // Add results for each employee
                for (const [empCode, result] of batchResult.results.entries()) {
                    allResults[empCode][componentName] = result;
                }
            } catch (error) {
                console.error(`[PayrollComponentRegistry] Error in batch ${componentName}:`, error);

                // Add error results for all employees
                for (const input of inputs) {
                    allResults[input.emp_code][componentName] = {
                        component_name: componentName,
                        input,
                        output: { value: null, meta: {} as any },
                        errors: [error instanceof Error ? error.message : String(error)],
                    };
                }
            }
        }

        return allResults;
    }

    /**
     * Get registry health status
     */
    public getHealthStatus(): {
        registered_count: number;
        components: string[];
        versions: Record<string, number>;
    } {
        return {
            registered_count: this.components.size,
            components: this.getRegisteredComponents(),
            versions: this.getAllServiceVersions(),
        };
    }
}

// Export singleton instance
export const payrollComponentRegistry = PayrollComponentRegistry.getInstance();
