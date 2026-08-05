const DEFAULT_DESKTOP_SCALE = 1;

export const getPayrollResponsiveScaleForWidth = (containerWidth = 0) => {
    const width = Number(containerWidth) || 0;

    if (width >= 1920) return DEFAULT_DESKTOP_SCALE;
    if (width >= 1600) return 0.95;
    if (width >= 1366) return 0.9;
    if (width >= 1200) return 0.85;
    return 0.8;
};

export const clampPayrollScale = (value, min = 0.72, max = 1.2) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
};

export const getPayrollEffectiveScale = ({ containerWidth = 0, fontSize = 100 } = {}) => {
    const responsiveScale = getPayrollResponsiveScaleForWidth(containerWidth);
    const manualScale = clampPayrollScale((Number(fontSize) || 100) / 100, 0.5, 1.5);
    return clampPayrollScale(responsiveScale * manualScale);
};

