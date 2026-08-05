/**
 * DivisionDefinition - Backward compatibility wrapper for DivisionConfigService
 */
import { divisionConfigService } from "./config/DivisionConfigService";

export class DivisionDefinitionWrapper {
    private static instance: DivisionDefinitionWrapper;

    private constructor() {}

    public static getInstance(): DivisionDefinitionWrapper {
        if (!DivisionDefinitionWrapper.instance) {
            DivisionDefinitionWrapper.instance = new DivisionDefinitionWrapper();
        }
        return DivisionDefinitionWrapper.instance;
    }

    public isVirtualDivision(div: string): boolean {
        return divisionConfigService.isVirtualDivision(div);
    }

    public async getSourceDivisionsForAggregation(div: string): Promise<string[]> {
        return divisionConfigService.getSourceDivisions(div);
    }

    public getVirtualDivisionConfig(div: string) {
        return divisionConfigService.getDivision(div);
    }

    public resolveDivisionCode(div: string): string {
        return divisionConfigService.getDivision(div)?.code || div;
    }

    public async getAllDivisions(includeVirtual: boolean = true): Promise<string[]> {
        return divisionConfigService.getAllDivisionCodes(includeVirtual);
    }

    public async getGangsForDivision(div: string, includeVirtual: boolean = false) {
        return divisionConfigService.getGangsForDivision(div);
    }

    public getVirtualDivisionForGang(gangCode: string, locCode: string, gangDesc?: string): string | null {
        return divisionConfigService.resolveVirtualDivision(gangCode, locCode, gangDesc);
    }

    public getVirtualDivisionByPatternOnly(gangCode: string, gangDesc?: string): string | null {
        return divisionConfigService.resolveVirtualDivision(gangCode, "", gangDesc);
    }

    public matchGangToVirtualDivision(gangCode: string, virtualDiv: string): boolean {
        return divisionConfigService.isGangInVirtualDivision(gangCode, virtualDiv);
    }

    public getAsistensiFromGang(gangCode: string, division: string): string | null {
        // Logic moved to more appropriate places but kept here for compatibility
        const gc = gangCode.trim().toUpperCase();
        if (gc.startsWith('K2')) return '1';
        const match = gc.match(/\d+/);
        return match ? match[0] : null;
    }

    public get VIRTUAL_DIVISION_ORDER() {
        return ["INF", "NRS", "WKS_AR", "WKS_PG", "WORKSHOP", "MILL"];
    }
}

export const divisionDefinition = DivisionDefinitionWrapper.getInstance();
